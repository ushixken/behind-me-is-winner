// src/brush/hard-round-aa-off-connectivity.test.js
//
// Phase 9E.3 -- Phase 9E.2 made AA Off pixel-perfect binary by sampling
// each output pixel once at its block center. That fixed the "still gray"
// bug but introduced a regression for fast strokes/flicks: consecutive
// segments in a stroke's release tail shrink in radius quickly, and a
// thin capsule sweeping along a shallow diagonal can pass BETWEEN pixel
// centers without ever reaching one, dropping pixels -- a dotted/gapped
// tail. This file proves the fix (pixelCoveredByCapsule's conservative
// pixel-square test) restores connectivity without reintroducing any
// fractional/gray alpha.
//
// Run with: node src/brush/hard-round-aa-off-connectivity.test.js

'use strict';

const assert = require('assert');
const CapsuleMath = require('../../../hard-round-capsule-math');
const { PrototypeRenderer } = require('../../../prototype-renderer');

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

// A synthetic fast-flick release tail: a chain of segments with a shallow
// (near-horizontal) diagonal and rapidly shrinking radius, spaced further
// apart than the radius itself -- exactly the shape that dropped pixels
// under 9E.2's plain center-point sampling.
function flickTailSegments() {
  const segs = [];
  let x = 5, y = 5, r = 2.5;
  for (let i = 0; i < 25; i++) {
    const nx = x + 1.9, ny = y + 0.9, nr = Math.max(0.05, r * 0.80);
    segs.push({
      x0: x, y0: y, x1: nx, y1: ny, r0: r, r1: nr,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode: 'off',
    });
    x = nx; y = ny; r = nr;
  }
  return segs;
}

// True if there is no empty row sandwiched between two rows that DO have
// opaque pixels (a "gap row" splitting the tail's own span).
function hasNoGapRows(alphaGrid, w, h) {
  const rowHasInk = [];
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w; x++) if (alphaGrid[y * w + x] > 0) { any = true; break; }
    rowHasInk.push(any);
  }
  const firstInk = rowHasInk.indexOf(true);
  const lastInk = rowHasInk.lastIndexOf(true);
  if (firstInk === -1) return true;
  for (let y = firstInk; y <= lastInk; y++) {
    if (!rowHasInk[y]) return false;
  }
  return true;
}

test('pixelCoveredByCapsule: covers a pixel the capsule sweeps through even when its center is outside the radius', () => {
  const missedByExact = CapsuleMath.capsuleCoverage(5, 5, 0, 5.6, 0.3, 10, 5.6, 0.3, 'off');
  assert.strictEqual(missedByExact, 0, 'sanity check: exact point test should miss this off-center capsule');
  const covered = CapsuleMath.pixelCoveredByCapsule(5, 5, 0, 5.6, 0.3, 10, 5.6, 0.3, 1);
  assert.strictEqual(covered, 1, 'expected pixelCoveredByCapsule to catch a capsule that grazes this pixel');
});

test('PrototypeRenderer CPU pipeline: AA-off fast-flick tapering tail has no gap rows', async () => {
  const w = 60, h = 60;
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments(flickTailSegments());
  await renderer.endStroke();
  const grid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) grid[y * w + x] = renderer._outCtx._pixel(x, y)[3];
  }
  assert.ok(hasNoGapRows(grid, w, h), 'expected the flick tail to have no empty rows within its own span');
});

test('PrototypeRenderer CPU pipeline: connectivity fix does not reintroduce fractional/gray alpha', async () => {
  const w = 60, h = 60;
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments(flickTailSegments());
  await renderer.endStroke();
  const nonBinary = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = renderer._outCtx._pixel(x, y)[3];
      if (a !== 0 && a !== 255) nonBinary.push(a);
    }
  }
  assert.strictEqual(nonBinary.length, 0, `expected only 0/255 alpha, found ${nonBinary.length} gray pixels: ${nonBinary.slice(0, 10)}`);
});

test('PrototypeRenderer CPU pipeline: a single round dab (zero-length segment) at a tiny radius is still filled, not dropped', async () => {
  const w = 20, h = 20;
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments([{
    x0: 10.3, y0: 10.3, x1: 10.3, y1: 10.3, r0: 0.15, r1: 0.15,
    alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
    hardness: 1, aaMode: 'off',
  }]);
  await renderer.endStroke();
  let anyOpaque = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (renderer._outCtx._pixel(x, y)[3] > 0) anyOpaque = true;
  assert.ok(anyOpaque, 'expected a tiny round dab to still paint at least one pixel under AA-off');
});

test('PrototypeRenderer CPU pipeline: Off boundary dilation is small (≈1px, not several) vs an exact reference', async () => {
  // Compare Off's resolved span against Weak's (near-exact, narrow-band)
  // span for the identical geometry -- the difference isolates just the
  // connectivity dilation, independent of the capsule's true full size.
  async function span(aaMode) {
    const w = 100, h = 60;
    const renderer = makeRenderer(w, h);
    renderer.beginStroke();
    renderer.drawSegments([{
      x0: 20, y0: 30, x1: 80, y1: 30, r0: 20, r1: 20,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode,
    }]);
    await renderer.endStroke();
    let minX = w, maxX = 0;
    for (let x = 0; x < w; x++) {
      if (renderer._outCtx._pixel(x, 30)[3] > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    return maxX - minX;
  }
  const offSpan = await span('off');
  const weakSpan = await span('weak');
  assert.ok(offSpan - weakSpan <= 3, `expected Off's span (${offSpan}) to be within ~1-2px of Weak's (${weakSpan}), not ballooned`);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
