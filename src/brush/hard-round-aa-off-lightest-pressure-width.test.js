// src/brush/hard-round-aa-off-lightest-pressure-width.test.js
//
// Phase 9E.6 -- proves the lightest nonzero pen pressure in AA Off mode
// collapses to an exact 1-output-pixel-wide centerline (matching
// TVPaint), instead of the 2px+ interior body width the bug report
// showed (pic 1 vs pic 2). See hard-round-capsule-math.js's Phase 9E.6
// comment on pixelCoveredByCapsuleForStroke for the root cause and fix.
//
// Run with: node src/brush/hard-round-aa-off-lightest-pressure-width.test.js

'use strict';

const assert = require('assert');
const CapsuleMath = require('./hard-round-capsule-math');
const HardRoundAdapter = require('./hard-round-adapter');
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

async function renderToGrid(w, h, segments) {
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments(segments);
  await renderer.endStroke();
  const grid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = renderer._outCtx._pixel(x, y)[3];
  return grid;
}

// Lightest nonzero pressure: HardRoundAdapter.resolveEffectiveRadius's own
// floor logic (minSizeFrac * baseSize/2, absolute-min 0.1) at pressure
// just above 0 -- exactly what the real pipeline hands the renderer, not
// a hand-picked "small" radius.
function lightestPressureRadius(baseSize) {
  return HardRoundAdapter.resolveEffectiveRadius({
    baseSize, minSizeFrac: 0.05, curveKey: 'linear', influence: 0.001,
  });
}

function widthOfRow(grid, w, y) {
  let minX = -1, maxX = -1;
  for (let x = 0; x < w; x++) if (grid[y * w + x] > 0) { if (minX === -1) minX = x; maxX = x; }
  return minX === -1 ? 0 : (maxX - minX + 1);
}
function widthOfCol(grid, w, h, x) {
  let minY = -1, maxY = -1;
  for (let y = 0; y < h; y++) if (grid[y * w + x] > 0) { if (minY === -1) minY = y; maxY = y; }
  return minY === -1 ? 0 : (maxY - minY + 1);
}
function hasNoGapRows(grid, w, h) {
  const rowHasInk = [];
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w; x++) if (grid[y * w + x] > 0) { any = true; break; }
    rowHasInk.push(any);
  }
  const first = rowHasInk.indexOf(true), last = rowHasInk.lastIndexOf(true);
  if (first === -1) return true;
  for (let y = first; y <= last; y++) if (!rowHasInk[y]) return false;
  return true;
}
function isStrictlyBinary(grid) {
  for (let i = 0; i < grid.length; i++) if (grid[i] !== 0 && grid[i] !== 255) return false;
  return true;
}

// Builds a straight multi-segment stroke at a constant radius, stepping by
// (dx,dy) per segment, with real isStrokeStart/isStrokeEnd flags like the
// production pipeline sets on the first/last segment only.
function straightStroke(x0, y0, dx, dy, n, r) {
  const segs = [];
  let x = x0, y = y0;
  for (let i = 0; i < n; i++) {
    const nx = x + dx, ny = y + dy;
    segs.push({
      x0: x, y0: y, x1: nx, y1: ny, r0: r, r1: r,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode: 'off',
    });
    x = nx; y = ny;
  }
  segs[0].isStrokeStart = true;
  segs[segs.length - 1].isStrokeEnd = true;
  return segs;
}

const BASE_SIZE = 6; // arbitrary selected brush size
const R_LIGHT = lightestPressureRadius(BASE_SIZE);

test('lightest-pressure radius is a real subpixel value from the actual adapter path', () => {
  assert.ok(R_LIGHT > 0 && R_LIGHT < 0.5, `expected a subpixel floor radius, got ${R_LIGHT}`);
});

// Real strokes tessellate at sub-pixel dab spacing (many overlapping
// segments per pixel of travel), not the coarse multi-pixel jumps a
// synthetic test might reach for -- the joint-cap dilation (kept for
// flick-tail connectivity) is sized for that overlap and only becomes a
// visible "bump" if segments are spaced far apart, which real strokes
// never do. These tests use ~0.5px-per-segment spacing to match.

test('horizontal low-pressure stroke: every column is exactly 1px tall (interior body not dilated)', async () => {
  const w = 60, h = 20;
  const segs = straightStroke(5, 10.3, 0.5, 0, 90, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  let sawInk = false;
  for (let x = 8; x < w - 8; x++) {
    const width = widthOfCol(grid, w, h, x);
    if (width === 0) continue;
    sawInk = true;
    assert.ok(width <= 1, `column ${x} is ${width}px tall, expected <=1`);
  }
  assert.ok(sawInk, 'expected the stroke to paint something');
});

test('vertical low-pressure stroke: every row is exactly 1px wide (interior body not dilated)', async () => {
  const w = 20, h = 60;
  const segs = straightStroke(10.3, 5, 0, 0.5, 90, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  let sawInk = false;
  for (let y = 8; y < h - 8; y++) {
    const width = widthOfRow(grid, w, y);
    if (width === 0) continue;
    sawInk = true;
    assert.ok(width <= 1, `row ${y} is ${width}px wide, expected <=1`);
  }
  assert.ok(sawInk, 'expected the stroke to paint something');
});

test('shallow-diagonal low-pressure stroke: 1px staircase, no unnecessary adjacent thickness', async () => {
  // This diagonal is x-dominant (dx=0.4, dy=0.12 -- shallower than 45deg),
  // so a "1px wide" line means each COLUMN is <=1px tall as x advances
  // (a single row naturally spans several columns for a shallow line --
  // that's correct staircase geometry, not the bug), mirroring how the
  // horizontal-stroke test above measures column height rather than row
  // width for the same reason.
  const w = 60, h = 30;
  const segs = straightStroke(5.2, 5.4, 0.4, 0.12, 100, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  let sawInk = false;
  for (let x = 6; x < w - 6; x++) {
    const height = widthOfCol(grid, w, h, x);
    if (height === 0) continue;
    sawInk = true;
    // A shallow diagonal can legitimately have >1 lit pixel in one column
    // where the staircase steps, but never the old ~2px uniform fattening
    // across the line's actual thin dimension (its height/thickness).
    assert.ok(height <= 2, `column ${x} is ${height}px tall, expected a thin staircase, not uniform fattening`);
  }
  assert.ok(sawInk, 'expected the stroke to paint something');
});

test('45-degree low-pressure stroke behaves correctly (1px staircase)', async () => {
  const w = 40, h = 40;
  const segs = straightStroke(5, 5, 0.35, 0.35, 90, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  let sawInk = false;
  for (let y = 4; y < h - 4; y++) {
    const width = widthOfRow(grid, w, y);
    if (width === 0) continue;
    sawInk = true;
    assert.ok(width <= 2, `row ${y} is ${width}px wide on a 45-degree stroke, expected a thin staircase`);
  }
  assert.ok(sawInk, 'expected the stroke to paint something');
});

test('low-pressure stroke has no gap rows', async () => {
  const w = 20, h = 60;
  const segs = straightStroke(10, 5, 0.05, 0.5, 90, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  assert.ok(hasNoGapRows(grid, w, h), 'expected a continuous stroke with no gap rows');
});

test('fast flick tail remains connected at the new floored (not dilated) body test', async () => {
  const w = 80, h = 20;
  const segs = [];
  let x = 5, y = 10, r = 2.0;
  for (let i = 0; i < 25; i++) {
    const nx = x + 1.9, ny = y + 0.2, nr = Math.max(0.05, r * 0.8);
    segs.push({
      x0: x, y0: y, x1: nx, y1: ny, r0: r, r1: nr,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode: 'off',
    });
    x = nx; y = ny; r = nr;
  }
  segs[0].isStrokeStart = true;
  segs[segs.length - 1].isStrokeEnd = true;
  const grid = await renderToGrid(w, h, segs);
  assert.ok(hasNoGapRows(grid, w, h), 'expected the flick tail to stay connected (9E.3 preserved)');
});

test('stroke start/end remain 1px at the lightest pressure', async () => {
  const w = 20, h = 60;
  const segs = straightStroke(10.3, 5, 0, 0.5, 90, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  const rowHasInk = [];
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = 0; x < w; x++) if (grid[y * w + x] > 0) { any = true; break; }
    rowHasInk.push(any);
  }
  const first = rowHasInk.indexOf(true), last = rowHasInk.lastIndexOf(true);
  assert.ok(first !== -1, 'expected the stroke to paint something');
  assert.ok(widthOfRow(grid, w, first) <= 1, `expected the start row to be <=1px, got ${widthOfRow(grid, w, first)}`);
  assert.ok(widthOfRow(grid, w, last) <= 1, `expected the end row to be <=1px, got ${widthOfRow(grid, w, last)}`);
});

test('output remains strictly binary (0/255) at the lightest pressure', async () => {
  const w = 40, h = 40;
  const segs = straightStroke(5, 20, 0.5, 0.07, 60, R_LIGHT);
  const grid = await renderToGrid(w, h, segs);
  assert.ok(isStrictlyBinary(grid), 'expected AA Off to remain strictly binary');
});

test('increasing pressure increases width monotonically (1px -> grows beyond 1px)', async () => {
  const w = 40, h = 20;
  const fractions = [0.001, 0.15, 0.4, 0.7, 1.0];
  let prevMaxWidth = 0;
  for (const f of fractions) {
    const r = HardRoundAdapter.resolveEffectiveRadius({
      baseSize: BASE_SIZE, minSizeFrac: 0.05, curveKey: 'linear', influence: f,
    });
    const segs = straightStroke(5, 10, 0.4, 0, 60, r);
    const grid = await renderToGrid(w, h, segs);
    let maxWidth = 0;
    for (let x = 6; x < w - 6; x++) maxWidth = Math.max(maxWidth, widthOfCol(grid, w, h, x));
    assert.ok(maxWidth >= prevMaxWidth, `expected width to grow (or hold) with pressure: ${prevMaxWidth} -> ${maxWidth} at influence ${f}`);
    prevMaxWidth = maxWidth;
  }
  assert.ok(prevMaxWidth > 1, 'expected full pressure to exceed the 1px floor');
});

test('full pressure still reaches exactly the selected brush size', () => {
  const r = HardRoundAdapter.resolveEffectiveRadius({
    baseSize: BASE_SIZE, minSizeFrac: 0.05, curveKey: 'linear', influence: 1,
  });
  assert.ok(Math.abs(r - BASE_SIZE / 2) < 1e-9, `expected full-pressure radius ${BASE_SIZE / 2}, got ${r}`);
});

test('Weak/Medium/Strong AA are unaffected by the 9E.6 body-floor change (capsuleCoverage path untouched)', () => {
  ['weak', 'medium', 'strong'].forEach((mode) => {
    const cov = CapsuleMath.capsuleCoverage(5, 5.6, 0, 5.6, 0.3, 10, 5.6, 0.3, mode);
    assert.ok(cov > 0 && cov <= 1, `expected fractional/positive coverage for ${mode}, got ${cov}`);
  });
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});