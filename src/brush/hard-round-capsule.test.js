// src/brush/hard-round-capsule.test.js
//
// Minimal, dependency-free deterministic tests for the Phase 8C completion:
// the capsule math module, the CPU capsule renderer, and the adapter's
// resolveSegmentRenderParams. Run with:
//   node src/brush/hard-round-capsule.test.js

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Math_ = require('./hard-round-capsule-math');
const { drawHardRoundCapsuleCPU } = require('./hard-round-capsule-renderer');
const { resolveSegmentRenderParams, resolveEffectiveRadius } = require('./hard-round-adapter');
const { PrototypeStrokeCore } = require('./prototype-stroke-core');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error('    ' + (err && err.stack ? err.stack.split('\n').join('\n    ') : err));
  }
}

// ---------------------------------------------------------------------
// Minimal fake CanvasRenderingContext2D backed by a plain Uint8ClampedArray,
// enough to exercise drawHardRoundCapsuleCPU's getImageData/putImageData
// contract headlessly (no real DOM/canvas available under plain node).
function makeFakeCtx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4); // all zero = transparent black
  return {
    canvas: { width: w, height: h },
    getImageData(sx, sy, rw, rh) {
      const out = new Uint8ClampedArray(rw * rh * 4);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const srcI = ((sy + y) * w + (sx + x)) * 4;
          const dstI = (y * rw + x) * 4;
          out[dstI] = data[srcI]; out[dstI + 1] = data[srcI + 1];
          out[dstI + 2] = data[srcI + 2]; out[dstI + 3] = data[srcI + 3];
        }
      }
      return { data: out, width: rw, height: rh };
    },
    putImageData(imgData, sx, sy) {
      const { data: src, width: rw, height: rh } = imgData;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const srcI = (y * rw + x) * 4;
          const dstI = ((sy + y) * w + (sx + x)) * 4;
          data[dstI] = src[srcI]; data[dstI + 1] = src[srcI + 1];
          data[dstI + 2] = src[srcI + 2]; data[dstI + 3] = src[srcI + 3];
        }
      }
    },
    _raw: data, _w: w, _h: h,
    alphaAt(x, y) { return data[(y * w + x) * 4 + 3]; },
  };
}

// ---------------------------------------------------------------------
// Math module

test('capsuleAxisDistance: zero-length segment is a round dab', () => {
  const r = Math_.capsuleAxisDistance(5, 0, 0, 0, 0, 0);
  assert.ok(r.isRoundDab);
  assert.ok(Math.abs(r.dist - 5) < 1e-9);
});

test('capsuleSignedDistance: point on axis midpoint is inside for r>0', () => {
  const d = Math_.capsuleSignedDistance(5, 0, 0, 0, 10, 10, 0, 10);
  assert.ok(d < 0);
});

test('capsuleSignedDistance: radius interpolates continuously along the axis (r0 -> r1)', () => {
  // Horizontal axis (0,0)->(20,0), r0=2 at x=0, r1=10 at x=20. For any t in
  // [0,1], the point directly above the axis at the LOCAL interpolated
  // radius should sit exactly on the boundary (signed distance ~0) --
  // confirms the SDF really interpolates radius continuously, not stepped.
  for (let t = 0; t <= 1; t += 0.1) {
    const x = t * 20;
    const localR = 2 + (10 - 2) * t;
    const d = Math_.capsuleSignedDistance(x, localR, 0, 0, 2, 20, 0, 10);
    assert.ok(Math.abs(d) < 1e-6, `t=${t}: expected ~0, got ${d}`);
  }
});

test('edgeCoverage: 1 well inside, 0 well outside, ~0.5 at the boundary', () => {
  assert.ok(Math_.edgeCoverage(-10, 1) > 0.99);
  assert.ok(Math_.edgeCoverage(10, 1) < 0.01);
  assert.ok(Math.abs(Math_.edgeCoverage(0, 1) - 0.5) < 1e-9);
});

test('subpixelAreaFactor: sub-pixel round dab scales down by true circle area, not 1', () => {
  const tiny = Math_.subpixelAreaFactor(0.05, true); // r=0.05 -> area = pi*0.0025 ~ 0.00785
  assert.ok(tiny < 0.01, `expected tiny area factor, got ${tiny}`);
  const big = Math_.subpixelAreaFactor(50, true);
  assert.ok(Math.abs(big - 1) < 1e-9); // clamped to 1 for large dabs
});

test('capsuleBounds: covers both endpoints plus max radius plus AA margin', () => {
  const b = Math_.capsuleBounds(0, 0, 10, 0, 2, 4);
  assert.ok(b.sx <= 0 - (4 + Math_.AA_MARGIN));
  assert.ok(b.ex >= 10 + (4 + Math_.AA_MARGIN));
});

// ---------------------------------------------------------------------
// CPU capsule renderer

test('CPU renderer: full-pressure 28px segment paints diameter ~28 across its width', () => {
  const ctx = makeFakeCtx(80, 80);
  const seg = { x0: 40, y0: 40, y1: 40, x1: 40, r0: 14, r1: 14, alpha0: 1, alpha1: 1, rgb: [255, 0, 0], composite: 'paint' };
  drawHardRoundCapsuleCPU(ctx, seg);
  // Scan a horizontal line through the dab center; count solid-ish pixels.
  let solid = 0;
  for (let x = 0; x < 80; x++) if (ctx.alphaAt(x, 40) > 250) solid++;
  // diameter 28 -> expect roughly 26-30 solid-alpha pixels across the core.
  assert.ok(solid >= 24 && solid <= 30, `expected ~28 solid px, got ${solid}`);
});

test('CPU renderer: no artificial taper -- alpha is uniform across a constant-alpha capsule interior', () => {
  const ctx = makeFakeCtx(60, 60);
  const seg = { x0: 5, y0: 30, x1: 55, y1: 30, r0: 8, r1: 8, alpha0: 1, alpha1: 1, rgb: [0, 255, 0], composite: 'paint' };
  drawHardRoundCapsuleCPU(ctx, seg);
  const samples = [15, 25, 30, 35, 45].map((x) => ctx.alphaAt(x, 30));
  for (const a of samples) assert.ok(a > 250, `expected solid core alpha, got ${a}`);
});

test('CPU renderer: continuous r0->r1 taper produces a monotonically shrinking dab, not separated dots', () => {
  const ctx = makeFakeCtx(120, 40);
  const seg = { x0: 10, y0: 20, x1: 110, y1: 20, r0: 12, r1: 1, alpha0: 1, alpha1: 1, rgb: [0, 0, 255], composite: 'paint' };
  drawHardRoundCapsuleCPU(ctx, seg);
  // Measure the painted width (count of alpha>0 pixels) at several x slices
  // along the taper -- must be present (no gap) and non-increasing overall.
  function widthAt(x) {
    let count = 0;
    for (let y = 0; y < 40; y++) if (ctx.alphaAt(x, y) > 0) count++;
    return count;
  }
  const xs = [12, 30, 50, 70, 90, 108];
  const widths = xs.map(widthAt);
  for (const w of widths) assert.ok(w > 0, 'taper must never gap to zero coverage mid-segment');
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] <= widths[i - 1] + 1, `width should not grow along the taper: ${widths}`);
  }
});

test('CPU renderer: zero-length segment (r0===r1, same point) renders a round dab, not nothing', () => {
  const ctx = makeFakeCtx(20, 20);
  const seg = { x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5, alpha0: 1, alpha1: 1, rgb: [255, 255, 0], composite: 'paint' };
  drawHardRoundCapsuleCPU(ctx, seg);
  assert.ok(ctx.alphaAt(10, 10) > 250);
  assert.ok(ctx.alphaAt(10, 6) > 200); // inside the r=5 circle
  assert.ok(ctx.alphaAt(10, 19) === 0); // well outside
});

test('CPU renderer: erase composite reduces existing alpha instead of painting color', () => {
  const ctx = makeFakeCtx(20, 20);
  // Pre-fill with opaque red.
  for (let i = 0; i < ctx._raw.length; i += 4) { ctx._raw[i] = 255; ctx._raw[i + 3] = 255; }
  const seg = { x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5, alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'erase' };
  drawHardRoundCapsuleCPU(ctx, seg);
  assert.ok(ctx.alphaAt(10, 10) < 10); // fully erased at center
  assert.ok(ctx.alphaAt(19, 19) === 255); // untouched far corner
});

// ---------------------------------------------------------------------
// Adapter segment-render-params (r0/r1/alpha0/alpha1 derivation)

test('resolveSegmentRenderParams: 28px full pressure -> r0 = r1 = 14', () => {
  const seg = { x0: 0, y0: 0, pressure0: 1, influence0: 1, x1: 5, y1: 5, pressure1: 1, influence1: 1 };
  const out = resolveSegmentRenderParams(seg, { baseSize: 28, minSizeFrac: 0, curveKey: 'linear' });
  assert.ok(Math.abs(out.r0 - 14) < 1e-9);
  assert.ok(Math.abs(out.r1 - 14) < 1e-9);
});

test('resolveSegmentRenderParams: 2px full pressure -> r0 = r1 = 1', () => {
  const seg = { x0: 0, y0: 0, pressure0: 1, influence0: 1, x1: 5, y1: 5, pressure1: 1, influence1: 1 };
  const out = resolveSegmentRenderParams(seg, { baseSize: 2, minSizeFrac: 0, curveKey: 'linear' });
  assert.ok(Math.abs(out.r0 - 1) < 1e-9);
  assert.ok(Math.abs(out.r1 - 1) < 1e-9);
});

test('resolveSegmentRenderParams: decreasing-pressure segment gives r0 > r1 with no artificial floor jump', () => {
  const seg = { x0: 0, y0: 0, pressure0: 1, influence0: 1, x1: 5, y1: 5, pressure1: 0.1, influence1: 0.1 };
  const out = resolveSegmentRenderParams(seg, { baseSize: 20, minSizeFrac: 0, curveKey: 'linear' });
  assert.ok(out.r0 > out.r1);
  const expectedR1 = resolveEffectiveRadius({ baseSize: 20, minSizeFrac: 0, curveKey: 'linear', influence: 0.1 });
  assert.ok(Math.abs(out.r1 - expectedR1) < 1e-9);
});

test('resolveSegmentRenderParams: same resolved segment input produces identical output (CPU/GPU share one source)', () => {
  const seg = { x0: 1, y0: 2, pressure0: 0.4, influence0: 0.35, x1: 6, y1: 8, pressure1: 0.9, influence1: 0.87 };
  const opts = { baseSize: 40, minSizeFrac: 0.05, curveKey: 'linear', rgb: [1, 2, 3], composite: 'paint' };
  const a = resolveSegmentRenderParams(seg, opts);
  const b = resolveSegmentRenderParams(seg, opts);
  assert.deepStrictEqual(a, b);
});

test('resolveSegmentRenderParams: zero-length first segment (beginStroke dab) is valid', () => {
  const core = new PrototypeStrokeCore();
  const beginSeg = core.beginStroke({ x: 50, y: 50, pressure: 0.6, pointerType: 'pen', timeStamp: 0 });
  assert.strictEqual(beginSeg.x0, beginSeg.x1);
  assert.strictEqual(beginSeg.y0, beginSeg.y1);
  const out = resolveSegmentRenderParams(beginSeg, { baseSize: 20, minSizeFrac: 0.05, curveKey: 'linear' });
  assert.ok(Number.isFinite(out.r0) && out.r0 > 0);
  assert.ok(Number.isFinite(out.r1) && out.r1 > 0);
});

// ---------------------------------------------------------------------
// Static source check: Hard Round's visible stroke body no longer calls
// _stampDab(). This is checked at the source level (rather than by
// instrumenting the real DOM-dependent brush-engine.js module, which can't
// be required under plain node) -- it greps the exact function body of
// _hardRoundStampSegments and asserts it contains no _stampDab( call, per
// the brief's explicit acceptance criterion.
test('_hardRoundStampSegments source no longer calls _stampDab()', () => {
  const src = fs.readFileSync(path.join(__dirname, 'brush-engine.js'), 'utf8');
  const start = src.indexOf('function _hardRoundStampSegments(segments, e){');
  assert.ok(start >= 0, 'could not locate _hardRoundStampSegments in brush-engine.js');
  // Find the matching closing brace by simple depth counting from the
  // opening brace of the function body.
  let depth = 0, i = start, bodyEnd = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { bodyEnd = i; break; } }
  }
  assert.ok(bodyEnd > start, 'could not find end of _hardRoundStampSegments body');
  const body = src.slice(start, bodyEnd + 1);
  assert.ok(!/_stampDab\(/.test(body), 'Hard Round segment stamping must not call _stampDab()');
  assert.ok(/HardRoundCapsuleRenderer/.test(body), 'expected the capsule renderer to be used instead');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
