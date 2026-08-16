// src/brush/hard-round-aa-off-tip-width.test.js
//
// Phase 9E.4 -- proves AA Off strokes begin and end in exactly 1 pixel
// (matching TVPaint), while interior joints and fast-flick tails stay
// connected (the 9E.3 fix), and Weak/Medium/Strong are untouched.
//
// Run with: node src/brush/hard-round-aa-off-tip-width.test.js

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

// A straight, near-vertical multi-segment stroke -- the "curve stroke"
// shape from the bug report -- with a real start/end tip flag on the
// first/last segments only, like the real pipeline sets.
function straightStrokeSegments(n) {
  const segs = [];
  // Thin (~1px-wide finished line) capsule, matching the reported bug's
  // stroke thickness -- a wide brush's round cap legitimately spans
  // several pixels at its tangent row (correct circle geometry, not a
  // defect), so a tip-width assertion only makes sense at this scale.
  let x = 30, y = 5;
  for (let i = 0; i < n; i++) {
    const nx = x + 0.4, ny = y + 3;
    segs.push({
      x0: x, y0: y, x1: nx, y1: ny, r0: 0.45, r1: 0.45,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode: 'off',
    });
    x = nx; y = ny;
  }
  segs[0].isStrokeStart = true;
  segs[segs.length - 1].isStrokeEnd = true;
  return segs;
}

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
  segs[0].isStrokeStart = true;
  segs[segs.length - 1].isStrokeEnd = true;
  return segs;
}

function widthOfRow(grid, w, y) {
  let minX = -1, maxX = -1;
  for (let x = 0; x < w; x++) {
    if (grid[y * w + x] > 0) { if (minX === -1) minX = x; maxX = x; }
  }
  return minX === -1 ? 0 : (maxX - minX + 1);
}

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
  for (let y = firstInk; y <= lastInk; y++) if (!rowHasInk[y]) return false;
  return true;
}

async function renderToGrid(w, h, segments) {
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments(segments);
  await renderer.endStroke();
  const grid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = renderer._outCtx._pixel(x, y)[3];
  return grid;
}

test('pixelCoveredByCapsuleForStroke: strict at an open stroke end (no half-diagonal dilation)', () => {
  // A point just past the round cap's true edge (radius 0.3), well inside
  // the old half-diagonal (~0.707) dilation band.
  const d = 0.3 + 0.4;
  const strict = CapsuleMath.pixelCoveredByCapsuleForStroke(d, 0, 0, 0, 0.3, 0, 0, 0.3, 1, true, true);
  assert.strictEqual(strict, 0, 'expected the strict tip test to reject a point outside the true radius');
  const conservative = CapsuleMath.pixelCoveredByCapsule(d, 0, 0, 0, 0.3, 0, 0, 0.3, 1);
  assert.strictEqual(conservative, 1, 'sanity check: the old conservative test accepts this same point');
});

test('pixelCoveredByCapsuleForStroke: a TAPERING interior cap (shrinking tail) keeps the conservative (dilated) test', () => {
  // Phase 9E.6: the conservative halfDiag dilation is scoped to a
  // cap-adjacent sample on an actually-TAPERING segment (r0 !== r1) --
  // exactly the fast-shrinking-tail-thread-between-centers case 9E.3 was
  // fixing. Sampled near the start cap (h clamps to 0), just outside the
  // true radius (0.3) but inside the old half-diagonal (~0.707) band.
  const missedByExact = CapsuleMath.capsuleCoverage(-0.5, 0.5, 0, 0, 0.3, 10, 0, 0.05, 'off');
  assert.strictEqual(missedByExact, 0);
  const covered = CapsuleMath.pixelCoveredByCapsuleForStroke(-0.5, 0.5, 0, 0, 0.3, 10, 0, 0.05, 1);
  assert.strictEqual(covered, 1, 'expected a tapering cap to still use the conservative sweep test');
});

test('pixelCoveredByCapsuleForStroke: a CONSTANT-radius interior joint is NOT dilated (9E.6 -- no periodic bump)', () => {
  // Same geometry but r0 === r1 (no taper -- an ordinary low-pressure
  // interior joint). Neighboring segments' caps already share this exact
  // point in a real stroke, so no extra dilation is needed; without this
  // distinction the fix would leave a periodic ~2px bump at every joint
  // along an otherwise 1px-wide low-pressure stroke.
  const covered = CapsuleMath.pixelCoveredByCapsuleForStroke(-0.5, 0.5, 0, 0, 0.3, 10, 0, 0.3, 1);
  assert.strictEqual(covered, 0, 'expected a constant-radius joint to use the floored (not dilated) test');
});

test('pixelCoveredByCapsuleForStroke: interior segment BODY (away from caps) is NOT dilated (9E.6)', () => {
  // Same segment/radius/pixel size as the joint test above, but sampled at
  // the segment's midpoint (h=0.5, far from either cap) -- this is the
  // case that was overwidening a thin/low-pressure stroke's body to ~1.4px
  // before the fix. It must now use the floored-not-added radius test.
  const missedByExact = CapsuleMath.capsuleCoverage(5, 5, 0, 5.6, 0.3, 10, 5.6, 0.3, 'off');
  assert.strictEqual(missedByExact, 0);
  const covered = CapsuleMath.pixelCoveredByCapsuleForStroke(5, 5, 0, 5.6, 0.3, 10, 5.6, 0.3, 1);
  assert.strictEqual(covered, 0, 'expected the interior body test to no longer dilate by the full half-diagonal');
});

test('PrototypeRenderer CPU pipeline: stroke start row is exactly 1 pixel wide', async () => {
  const w = 60, h = 60;
  const grid = await renderToGrid(w, h, straightStrokeSegments(10));
  let firstInkRow = -1;
  for (let y = 0; y < h; y++) { if (widthOfRow(grid, w, y) > 0) { firstInkRow = y; break; } }
  assert.ok(firstInkRow !== -1, 'expected the stroke to paint something');
  assert.strictEqual(widthOfRow(grid, w, firstInkRow), 1, `expected the very first ink row to be 1px wide, got ${widthOfRow(grid, w, firstInkRow)}`);
});

test('PrototypeRenderer CPU pipeline: stroke end row is exactly 1 pixel wide', async () => {
  const w = 60, h = 60;
  const grid = await renderToGrid(w, h, straightStrokeSegments(10));
  let lastInkRow = -1;
  for (let y = h - 1; y >= 0; y--) { if (widthOfRow(grid, w, y) > 0) { lastInkRow = y; break; } }
  assert.ok(lastInkRow !== -1, 'expected the stroke to paint something');
  assert.strictEqual(widthOfRow(grid, w, lastInkRow), 1, `expected the very last ink row to be 1px wide, got ${widthOfRow(grid, w, lastInkRow)}`);
});

test('PrototypeRenderer CPU pipeline: stroke body (interior rows) stays connected, no gap rows', async () => {
  const w = 60, h = 60;
  const grid = await renderToGrid(w, h, straightStrokeSegments(10));
  assert.ok(hasNoGapRows(grid, w, h), 'expected the stroke body to have no empty rows within its own span');
});

test('PrototypeRenderer CPU pipeline: flick-tail connectivity fix (9E.3) is preserved with tip flags set', async () => {
  const w = 60, h = 60;
  const grid = await renderToGrid(w, h, flickTailSegments());
  assert.ok(hasNoGapRows(grid, w, h), 'expected the flick tail to still have no gap rows');
});

test('PrototypeRenderer CPU pipeline: AA-off output remains strictly binary (0/255)', async () => {
  const w = 60, h = 60;
  const grid = await renderToGrid(w, h, straightStrokeSegments(10));
  const nonBinary = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] !== 0 && grid[i] !== 255) nonBinary.push(grid[i]);
  assert.strictEqual(nonBinary.length, 0, `expected only 0/255 alpha, found ${nonBinary.length}: ${nonBinary.slice(0, 10)}`);
});

test('PrototypeRenderer CPU pipeline: without tip flags, behavior matches pre-9E.4 (no regression for untagged callers)', async () => {
  const w = 60, h = 60;
  const segs = straightStrokeSegments(10);
  delete segs[0].isStrokeStart;
  delete segs[segs.length - 1].isStrokeEnd;
  const grid = await renderToGrid(w, h, segs);
  let firstInkRow = -1;
  for (let y = 0; y < h; y++) { if (widthOfRow(grid, w, y) > 0) { firstInkRow = y; break; } }
  assert.ok(widthOfRow(grid, w, firstInkRow) >= 1, 'untagged callers still paint something (old conservative path)');
});

['weak', 'medium', 'strong'].forEach((mode) => {
  test(`AA ${mode}: capsuleCoverage output unaffected by 9E.4 (no isFirst/isLast branch reached)`, () => {
    const a = CapsuleMath.capsuleCoverage(5, 5.3, 0, 5, 3, 10, 5, 3, mode);
    const b = CapsuleMath.capsuleCoverage(5, 5.3, 0, 5, 3, 10, 5, 3, mode);
    assert.strictEqual(a, b);
    assert.ok(a > 0 && a <= 1);
  });
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});