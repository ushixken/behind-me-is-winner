// src/brush/hard-round-prototype-integration.test.js
//
// Phase 9C — focused integration tests for the production wiring:
//   pointer input -> PrototypeStrokeCore -> resolved segments
//   -> HardRoundAdapter.resolveSegmentRenderParams() -> PrototypeRenderer
//   -> finished logical-resolution stroke canvas
//
// This exercises the exact same three modules brush-engine.js's
// _hardRoundStampSegments/_brushPointerDown/_pointerEndStroke wiring calls,
// in the same order, without needing a DOM (brush-engine.js itself is not
// require()-able headlessly -- it assumes `document`/`window` globals from
// index.html). The static check at the bottom instead greps the actual
// brush-engine.js source to confirm the migrated call path never reaches
// `_stampDab()`.
//
// Run with: node src/brush/hard-round-prototype-integration.test.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PrototypeStrokeCore } = require('./prototype-stroke-core');
const { PrototypeRenderer } = require('./prototype-renderer');
const HardRoundAdapter = require('./hard-round-adapter');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const run = Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok - ${name}`); })
    .catch((err) => {
      failed++;
      console.error(`  FAIL - ${name}`);
      console.error('    ' + (err && err.stack ? err.stack.split('\n').join('\n    ') : err));
    });
  pending.push(run);
}

// Minimal 2D-context stand-in, same shape as prototype-renderer.test.js's,
// so PrototypeRenderer can run headlessly here too.
function makeFakeCtx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    createImageData(cw, ch) { return { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }; },
    putImageData(img) { data.set(img.data); },
    clearRect() { data.fill(0); },
    _pixel(x, y) { const p = (y * w + x) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; },
  };
}

function makeRenderer(w, h) {
  const r = new PrototypeRenderer({ width: w, height: h });
  // r._outCanvas is null under plain Node (no `document`/OffscreenCanvas) --
  // stand in a plain width/height object, same role a real HTMLCanvasElement
  // plays in the browser (endStroke() only reads/returns it, never touches
  // it as a canvas itself; all pixel writes go through _outCtx).
  r._outCanvas = { width: w, height: h };
  r._outCtx = makeFakeCtx(w, h);
  return r;
}

// Drives one straight-line stroke through the full production pipeline:
// PrototypeStrokeCore -> HardRoundAdapter -> PrototypeRenderer, exactly as
// _brushPointerDown/_handleMoveEvent/_pointerEndStroke's Hard Round branch
// does. Returns the awaited endStroke() result plus the per-endpoint radii
// HardRoundAdapter actually resolved, for size-fidelity assertions.
async function runMigratedStroke({ w = 64, h = 64, baseSize = 28, n = 12, stepPx = 4, pressure = 1 }) {
  const core = new PrototypeStrokeCore({ brushSize: baseSize, stabilization: 0, zoom: 1 });
  const renderer = makeRenderer(w, h);
  const adapterOpts = { baseSize, minSizeFrac: 0.05, curveKey: 'linear', rgb: [10, 20, 30], composite: 'paint', hardness: 1, aaMode: 'normal' };
  const radii = [];

  const stampSegments = (segments) => {
    if (!segments || !segments.length) return;
    const renderSegs = segments.map((seg) => {
      const rs = HardRoundAdapter.resolveSegmentRenderParams(seg, adapterOpts);
      radii.push(rs.r0, rs.r1);
      return rs;
    });
    renderer.drawSegments(renderSegs);
  };

  renderer.beginStroke();
  const beginSeg = core.beginStroke({ x: 10, y: 10, pressure, pointerType: 'pen', timeStamp: 0 });
  stampSegments([beginSeg]);

  let t = 8;
  for (let i = 1; i <= n; i++) {
    const segs = core.pushSamples([{ x: 10 + i * stepPx, y: 10, pressure, pointerType: 'pen', timeStamp: t }]);
    stampSegments(segs);
    t += 8;
  }

  const finish = core.finishStroke({ x: 10 + n * stepPx, y: 10, pressure, pointerType: 'pen', timeStamp: t });
  stampSegments(finish.segments);

  const result = await renderer.endStroke();
  return { result, radii, renderer };
}

test('Hard Round eligibility: legacy engine\'s procedural condition matches HardRoundAdapter.isHardRoundEligible', () => {
  const eligible = {
    tool: 'brush', isPen: true, hasCustomTip: false, hardness: 1,
    sizeControl: 'pressure', roundness: 1, scatterEnabled: false, textureEnabled: false, airbrush: false,
  };
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(eligible), true);

  // Each of these must independently disqualify the stroke -- mirrors the
  // "renamed/duplicated preset must still route correctly" requirement.
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { tool: 'eraser' })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { isPen: false })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { hasCustomTip: true })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { hardness: 0.9 })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { sizeControl: 'fixed' })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { roundness: 0.5 })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { scatterEnabled: true })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { textureEnabled: true })), false);
  assert.strictEqual(HardRoundAdapter.isHardRoundEligible(Object.assign({}, eligible, { airbrush: true })), false);
});

test('begin -> drawSegments -> end lifecycle produces a resolved, opaque stroke', async () => {
  const { result } = await runMigratedStroke({ w: 64, h: 64, baseSize: 28, pressure: 1 });
  assert.ok(result.canvas, 'endStroke() must return a canvas');
  assert.strictEqual(result.composite, 'paint');
  assert.ok(result.segmentCount > 0, 'at least one segment must have been drawn');
});

test('returned canvas dimensions are logical CW x CH (not supersampled)', async () => {
  const { result, renderer } = await runMigratedStroke({ w: 96, h: 40 });
  assert.strictEqual(result.canvas.width, 96);
  assert.strictEqual(result.canvas.height, 40);
  assert.strictEqual(renderer.width, 96);
  assert.strictEqual(renderer.height, 40);
});

test('full-pressure 28px brush remains 28px logical diameter (r ~= 14)', async () => {
  const { radii } = await runMigratedStroke({ baseSize: 28, pressure: 1 });
  for (const r of radii) {
    assert.ok(Math.abs(r - 14) < 0.5, `expected r ~= 14 at full pressure/size 28, got ${r}`);
  }
});

test('2px brush remains 2px logical diameter (r ~= 1) at full pressure', async () => {
  const { radii } = await runMigratedStroke({ baseSize: 2, pressure: 1 });
  for (const r of radii) {
    assert.ok(Math.abs(r - 1) < 0.15, `expected r ~= 1 at full pressure/size 2, got ${r}`);
  }
});

test('Phase 9C.1: mid-stroke peekStroke shows the stroke before endStroke is ever called (live-preview fix)', async () => {
  const renderer = makeRenderer(64, 64);
  const core = new PrototypeStrokeCore({ brushSize: 28, stabilization: 0, zoom: 1 });
  const adapterOpts = { baseSize: 28, minSizeFrac: 0.05, curveKey: 'linear', rgb: [200, 0, 0], composite: 'paint', hardness: 1, aaMode: 'normal' };

  renderer.beginStroke();
  const beginSeg = core.beginStroke({ x: 20, y: 20, pressure: 1, pointerType: 'pen', timeStamp: 0 });
  renderer.drawSegments([HardRoundAdapter.resolveSegmentRenderParams(beginSeg, adapterOpts)]);

  // The whole point of the 9C.1 fix: peekStroke() must show paint here,
  // BEFORE endStroke() is ever invoked -- this is what _hardRoundStampSegments
  // now calls after every drawSegments() batch during pointermove.
  const midStrokePreview = await renderer.peekStroke();
  assert.ok(midStrokePreview.canvas, 'peekStroke must return a canvas mid-stroke');
  assert.strictEqual(midStrokePreview.segmentCount, 1);
  const [pr, , , pa] = renderer._outCtx._pixel(20, 20);
  assert.strictEqual(pr, 200, 'mid-stroke preview must already show the stroke color');
  assert.ok(pa > 240, 'mid-stroke preview must already be visibly opaque, not transparent');

  // Accumulation must still be live afterward -- more segments, then a
  // second peek, then the real end.
  const moveSegs = core.pushSamples([{ x: 40, y: 20, pressure: 1, pointerType: 'pen', timeStamp: 8 }]);
  renderer.drawSegments(moveSegs.map((s) => HardRoundAdapter.resolveSegmentRenderParams(s, adapterOpts)));
  const midStrokePreview2 = await renderer.peekStroke();
  assert.ok(midStrokePreview2.segmentCount > midStrokePreview.segmentCount, 'accumulation must continue after a peek');

  const finish = core.finishStroke({ x: 40, y: 20, pressure: 1, pointerType: 'pen', timeStamp: 16 });
  renderer.drawSegments(finish.segments.map((s) => HardRoundAdapter.resolveSegmentRenderParams(s, adapterOpts)));
  const final = await renderer.endStroke();
  assert.ok(final.canvas, 'endStroke must still produce the final canvas after live-preview peeks');
});

test('cancelStroke produces no committed output (backing store cleared, stroke inactive)', async () => {
  const renderer = makeRenderer(32, 32);
  renderer.beginStroke();
  renderer.drawSegments([{ x0: 16, y0: 16, x1: 16, y1: 16, r0: 8, r1: 8, alpha0: 1, alpha1: 1, rgb: [255, 0, 0], composite: 'paint' }]);
  renderer.cancelStroke();
  // Coverage backing store must be fully reset -- resolving it now (as if a
  // stray endStroke() were somehow called) must show nothing painted.
  const zeroed = renderer.cpu.coverage.every((v) => v === 0);
  assert.strictEqual(zeroed, true, 'backing store must be cleared after cancelStroke()');

  // The stroke session itself is also inactive: a subsequent drawSegments()
  // call (e.g. a stray late segment) must be a no-op, same as the real
  // _hardRoundStampSegments()/_strokeCtx flow never drawing anything for an
  // aborted stroke.
  renderer.drawSegments([{ x0: 16, y0: 16, x1: 16, y1: 16, r0: 8, r1: 8, alpha0: 1, alpha1: 1, rgb: [255, 0, 0], composite: 'paint' }]);
  assert.strictEqual(renderer._segmentCount, 0, 'drawSegments() after cancelStroke() must be ignored');
});

// Static check: the migrated Hard Round call path (_hardRoundStampSegments,
// and everything it calls into) must never reach `_stampDab()`. This can't
// be checked by calling into brush-engine.js (it isn't require()-able
// headlessly -- see file banner), so instead this asserts against the
// actual source text of the function body, which is exactly the artifact
// that would regress if a future edit reintroduced a dab-rasterizer call.
test('migrated Hard Round path does not call _stampDab()', () => {
  const src = fs.readFileSync(path.join(__dirname, 'brush-engine.js'), 'utf8');
  const start = src.indexOf('function _hardRoundStampSegments(segments, e){');
  assert.ok(start >= 0, '_hardRoundStampSegments not found in brush-engine.js');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, 'could not locate end of _hardRoundStampSegments');
  const body = src.slice(start, end);
  assert.ok(!/_stampDab\s*\(/.test(body), '_hardRoundStampSegments must not call _stampDab()');
  assert.ok(/renderer\.drawSegments\(/.test(body), '_hardRoundStampSegments must route segments through PrototypeRenderer.drawSegments()');
});

// Phase 9C.1: guards against the exact regression that was just fixed --
// _hardRoundStampSegments (called on every pointermove batch) must present
// a live preview via PrototypeRenderer.peekStroke(), not only resolve at
// endStroke()/pointerup.
test('Phase 9C.1: pointermove path presents a live preview via peekStroke(), not only at endStroke', () => {
  const src = fs.readFileSync(path.join(__dirname, 'brush-engine.js'), 'utf8');
  const start = src.indexOf('function _hardRoundStampSegments(segments, e){');
  const end = src.indexOf('\n}\n', start);
  const stampBody = src.slice(start, end);
  assert.ok(/_hardRoundPresentLivePreview\(/.test(stampBody), '_hardRoundStampSegments must call the live-preview presenter after drawSegments()');

  const previewFnStart = src.indexOf('function _hardRoundPresentLivePreview(renderer){');
  assert.ok(previewFnStart >= 0, '_hardRoundPresentLivePreview not found in brush-engine.js');
  const previewFnEnd = src.indexOf('\n}\n', previewFnStart);
  const previewBody = src.slice(previewFnStart, previewFnEnd);
  assert.ok(/renderer\.peekStroke\(\)/.test(previewBody), '_hardRoundPresentLivePreview must call PrototypeRenderer.peekStroke() (not endStroke) to avoid ending the stroke');
  assert.ok(/_strokeCtx\.drawImage\(/.test(previewBody), '_hardRoundPresentLivePreview must draw the peeked canvas into the live _strokeCtx preview surface');
  assert.ok(/_scheduleRecomposite\(\)/.test(previewBody), '_hardRoundPresentLivePreview must request a recomposite so the preview is actually shown');
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});