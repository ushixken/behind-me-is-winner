// src/brush/hard-round-aa-mode.test.js
//
// Phase 9E.1 -- proves the fix for the confirmed bug: Hard Round segments
// carry `aaMode` but neither PrototypeRenderer's CpuBackend nor
// hard-round-capsule-math.js used to consume it, so Weak/Medium/Strong all
// produced the exact same edge. These tests exercise the SAME straight,
// same-angle capsule (only `aaMode` varies) at both layers:
//   1. hard-round-capsule-math.js's capsuleCoverage() directly -- the
//      pure-math edge-band width itself.
//   2. PrototypeRenderer's full CPU pipeline (SS=4 accumulate + resolve)
//      -- the actual production path (_hardRoundStampSegments ->
//      HardRoundAdapter -> PrototypeRenderer.drawSegments).
// Per the investigation notes, comparisons are all done along the SAME
// perpendicular ray on a horizontal (0deg) capsule, never across different
// slopes, so the measured "edge width" isn't confounded by a diagonal
// edge's inherently wider footprint.
//
// Run with: node src/brush/hard-round-aa-mode.test.js

'use strict';

const assert = require('assert');
const CapsuleMath = require('./hard-round-capsule-math');
const { PrototypeRenderer } = require('./prototype-renderer');

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

// Minimal 2D-context stand-in (same shape as prototype-renderer.test.js's).
function makeFakeCtx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    createImageData(cw, ch) { return { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }; },
    putImageData(img, dx = 0, dy = 0) {
      for (let y = 0; y < img.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < img.width; x++) {
          const tx = dx + x;
          if (tx < 0 || tx >= w) continue;
          const si = (y * img.width + x) * 4;
          const di = (ty * w + tx) * 4;
          data[di] = img.data[si]; data[di + 1] = img.data[si + 1];
          data[di + 2] = img.data[si + 2]; data[di + 3] = img.data[si + 3];
        }
      }
    },
    clearRect() { data.fill(0); },
    _pixel(x, y) { const p = (y * w + x) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; },
  };
}

function makeRenderer(w, h) {
  const r = new PrototypeRenderer({ width: w, height: h });
  r._outCanvas = { width: w, height: h };
  r._outCtx = makeFakeCtx(w, h);
  return r;
}

// ---------------------------------------------------------------------
// Layer 1: pure math -- capsuleCoverage()'s edge-band width per aaMode.
//
// Uses ONE horizontal (same-angle) uniform-radius capsule (r0===r1, so
// there's no taper-band confound either) and measures, along the SAME
// vertical ray straight out from its right end-cap, how far coverage
// takes to fall from ~1 to ~0. That "10%-to-90% transition width" is the
// edge band width this phase wires `aaMode` into.
// ---------------------------------------------------------------------
function edgeTransitionWidth(aaMode) {
  const ax = 0, ay = 0, bx = 20, by = 0, r = 5;
  // Sample straight out along +x from the round-cap center (bx, by),
  // i.e. purely radially -- an unambiguous, single-angle probe. The
  // boundary itself sits at distance r from the cap center, so scan a
  // window straddling bx + r rather than bx.
  const step = 0.02;
  let loD = null, hiD = null; // distances from the boundary where cov crosses 0.9 / 0.1
  for (let t = -3; t <= 3; t += step) {
    const px = bx + r + t, py = by;
    const cov = CapsuleMath.capsuleCoverage(px, py, ax, ay, r, bx, by, r, aaMode);
    if (loD === null && cov <= 0.9) loD = t;
    if (hiD === null && cov <= 0.1) { hiD = t; break; }
  }
  assert.ok(loD !== null && hiD !== null, `aaMode=${aaMode}: coverage never crossed both thresholds`);
  return hiD - loD;
}

test('capsuleCoverage: Off produces an aliased (near-zero-width) edge transition', () => {
  const w = edgeTransitionWidth('off');
  assert.ok(w < 0.05, `expected a near-instant step for Off, got transition width ${w}`);
});

test('capsuleCoverage: none is treated the same as Off (aliased)', () => {
  const w = edgeTransitionWidth('none');
  assert.ok(w < 0.05, `expected a near-instant step for 'none', got transition width ${w}`);
});

test('capsuleCoverage: Weak, Medium, Strong each produce a different (non-aliased) edge width', () => {
  const weak = edgeTransitionWidth('weak');
  const medium = edgeTransitionWidth('medium');
  const strong = edgeTransitionWidth('strong');
  assert.notStrictEqual(weak, medium, 'weak and medium must differ');
  assert.notStrictEqual(medium, strong, 'medium and strong must differ');
  assert.notStrictEqual(weak, strong, 'weak and strong must differ');
  assert.ok(weak > 0.05, 'weak must still be smoothed (non-aliased), unlike Off');
});

test('capsuleCoverage: Medium is smoother/wider than Weak, same angle/geometry', () => {
  const weak = edgeTransitionWidth('weak');
  const medium = edgeTransitionWidth('medium');
  assert.ok(medium > weak, `expected medium (${medium}) > weak (${weak})`);
});

test('capsuleCoverage: Strong is smoother/wider than Medium, same angle/geometry', () => {
  const medium = edgeTransitionWidth('medium');
  const strong = edgeTransitionWidth('strong');
  assert.ok(strong > medium, `expected strong (${strong}) > medium (${medium})`);
});

test('capsuleCoverage: Weak matches the original (pre-9E.1) unscaled band -- back-compat', () => {
  const ax = 0, ay = 0, bx = 20, by = 0, r = 5;
  const px = bx + 0.37, py = by;
  const withMode = CapsuleMath.capsuleCoverage(px, py, ax, ay, r, bx, by, r, 'weak');
  const noMode = CapsuleMath.capsuleCoverage(px, py, ax, ay, r, bx, by, r); // legacy call site shape
  assert.ok(Math.abs(withMode - noMode) < 1e-9, `weak (${withMode}) must equal the unscaled legacy result (${noMode})`);
});

test('aaModeScale: monotonic Off(0) < Weak < Medium < Strong', () => {
  const off = CapsuleMath.aaModeScale('off');
  const weak = CapsuleMath.aaModeScale('weak');
  const medium = CapsuleMath.aaModeScale('medium');
  const strong = CapsuleMath.aaModeScale('strong');
  assert.strictEqual(off, 0);
  assert.ok(weak > off && medium > weak && strong > medium,
    `expected off(${off}) < weak(${weak}) < medium(${medium}) < strong(${strong})`);
});

// ---------------------------------------------------------------------
// Layer 2: full production pipeline -- PrototypeRenderer's CPU backend
// (SS=4 accumulate + box-filter resolve), the actual code path
// _hardRoundStampSegments feeds. Draws the SAME horizontal, same-radius,
// same-position segment for each aaMode and measures the resolved output
// canvas's alpha falloff width along a horizontal ray straight out from
// the capsule's right end-cap -- same-angle comparison, per the
// investigation note.
// ---------------------------------------------------------------------
async function resolvedEdgeWidth(aaMode) {
  const w = 64, h = 64;
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  const seg = {
    x0: 20, y0: 32, x1: 40, y1: 32, r0: 10, r1: 10,
    alpha0: 1, alpha1: 1, rgb: [255, 255, 255], composite: 'paint',
    hardness: 1, aaMode,
  };
  renderer.drawSegments([seg]);
  await renderer.endStroke();
  const ctx = renderer._outCtx;
  // Walk straight out (+x) from the right cap's center (40, 32), collect
  // the alpha profile, then find the SUBPIXEL x positions where it
  // crosses 90% and 10% (linear interpolation between samples) -- coarser
  // than the pure-math probe above (this pixel grid + SS=4 box filter
  // quantize to 1/16th steps), so a fractional/interpolated crossing is
  // needed to tell Medium and Strong apart at this resolution.
  const xs = [], as = [];
  for (let x = 40; x < w; x++) {
    xs.push(x);
    as.push(ctx._pixel(x, 32)[3] / 255);
  }
  function crossing(threshold) {
    for (let i = 0; i < as.length - 1; i++) {
      if (as[i] >= threshold && as[i + 1] < threshold) {
        const t = (as[i] - threshold) / (as[i] - as[i + 1]);
        return xs[i] + t;
      }
    }
    return null;
  }
  const hi = crossing(0.9), lo = crossing(0.1);
  assert.ok(hi !== null && lo !== null,
    `aaMode=${aaMode}: could not bracket the edge in the resolved alpha profile`);
  return lo - hi;
}

test('PrototypeRenderer CPU pipeline: Off remains aliased (narrowest possible resolved edge)', async () => {
  const offWidth = await resolvedEdgeWidth('off');
  const weakWidth = await resolvedEdgeWidth('weak');
  assert.ok(offWidth < weakWidth, `expected Off's resolved edge (${offWidth}) < Weak's (${weakWidth})`);
});

test('PrototypeRenderer CPU pipeline: Weak, Medium, Strong resolve to different coverage widths', async () => {
  const weak = await resolvedEdgeWidth('weak');
  const medium = await resolvedEdgeWidth('medium');
  const strong = await resolvedEdgeWidth('strong');
  assert.notStrictEqual(weak, medium, 'resolved weak and medium widths must differ');
  assert.notStrictEqual(medium, strong, 'resolved medium and strong widths must differ');
  assert.notStrictEqual(weak, strong, 'resolved weak and strong widths must differ');
});

test('PrototypeRenderer CPU pipeline: Strong resolves smoother/wider than Medium (same angle)', async () => {
  const medium = await resolvedEdgeWidth('medium');
  const strong = await resolvedEdgeWidth('strong');
  assert.ok(strong >= medium, `expected resolved strong (${strong}) >= medium (${medium})`);
});

test('PrototypeRenderer CPU pipeline: Medium resolves smoother/wider than Weak (same angle)', async () => {
  const weak = await resolvedEdgeWidth('weak');
  const medium = await resolvedEdgeWidth('medium');
  assert.ok(medium >= weak, `expected resolved medium (${medium}) >= weak (${weak})`);
});

test('PrototypeRenderer CPU pipeline: capsule geometry (opaque core radius) is unchanged across aaMode', async () => {
  // The solid interior -- well inside the capsule, far from any edge --
  // must read fully opaque regardless of aaMode: only the boundary band
  // may move, never the shape/size of the capsule itself.
  for (const mode of ['off', 'weak', 'medium', 'strong']) {
    const renderer = makeRenderer(64, 64);
    renderer.beginStroke();
    renderer.drawSegments([{
      x0: 20, y0: 32, x1: 40, y1: 32, r0: 10, r1: 10,
      alpha0: 1, alpha1: 1, rgb: [255, 255, 255], composite: 'paint',
      hardness: 1, aaMode: mode,
    }]);
    const result = await renderer.endStroke();
    const [, , , a] = renderer._outCtx._pixel(30, 32); // dead center
    assert.ok(a >= 250, `aaMode=${mode}: capsule interior must remain opaque (got alpha ${a})`);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
