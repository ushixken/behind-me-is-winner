// src/brush/hard-round-aa-off-alternating-width.test.js
//
// Phase 9E.7 -- proves that a constant-pressure AA Off stroke, in the
// 9E.6 floor regime (radius below half an output pixel -- i.e. the exact
// "lightest pressure" scenario both bug-report pictures show, at two
// different base brush sizes), renders a STABLE 1-output-pixel-wide
// staircase instead of alternating 1px -> 2px -> 1px along the line. See
// hard-round-capsule-math.js's Phase 9E.7 comment on
// pixelCoveredByCapsuleForStroke/_dominantAxisPerpendicularDistance for
// the root cause (an isotropic distance test sampled on a direction-
// dependent pixel grid) and the fix (an anisotropic, Bresenham-style
// minor-axis-only test, used only in the floor regime).
//
// Run with: node src/brush/hard-round-aa-off-alternating-width.test.js

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
async function renderToGrid(w, h, segments) {
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments(segments);
  await renderer.endStroke();
  const grid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = renderer._outCtx._pixel(x, y)[3];
  return grid;
}
function widthOfCol(grid, w, h, x) {
  let minY = -1, maxY = -1;
  for (let y = 0; y < h; y++) if (grid[y * w + x] > 0) { if (minY === -1) minY = y; maxY = y; }
  return minY === -1 ? 0 : (maxY - minY + 1);
}
function widthOfRow(grid, w, y) {
  let minX = -1, maxX = -1;
  for (let x = 0; x < w; x++) if (grid[y * w + x] > 0) { if (minX === -1) minX = x; maxX = x; }
  return minX === -1 ? 0 : (maxX - minX + 1);
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

// Same "no artificial widening/gapping" check used by the widths-per-
// column/row scan below, factored out so every angle/size combination
// below can share it.
function assertNoAlternation(widths, label) {
  const distinct = [...new Set(widths)];
  assert.strictEqual(distinct.length, 1,
    `expected a stable, non-alternating width for ${label}, got widths {${distinct.join(',')}} in sample ${widths.slice(0, 24).join(',')}`);
}

// Sweep several sub-half-pixel radii (the 9E.6 floor regime -- exactly
// what "lightest nonzero pressure" resolves to for any base brush size)
// across shallow, 45-degree, and steep angles. This is the exact bug
// report scenario: pic 1 (smaller brush) and pic 2 (slightly larger
// brush) are the SAME lightest-pressure case at two different base
// sizes -- both resolve to a sub-half-pixel radius, both hit this floor.
const FLOOR_RADII = [0.15, 0.25, 0.35, 0.45, 0.49, 0.5];
const ANGLES = [
  { dx: 0.4, dy: 0.12, label: 'shallow diagonal', metric: 'col' },
  { dx: 0.35, dy: 0.35, label: '45-degree diagonal', metric: 'row' },
  { dx: 0.12, dy: 0.4, label: 'steep diagonal', metric: 'row' },
];

for (const r of FLOOR_RADII) {
  for (const { dx, dy, label, metric } of ANGLES) {
    test(`floor-regime radius ${r}, ${label}: stable width, no 1px/2px alternation`, async () => {
      const w = 100, h = 100;
      const segs = straightStroke(5.07, 10.19, dx, dy, 220, r);
      const grid = await renderToGrid(w, h, segs);
      const widths = [];
      if (metric === 'col') {
        for (let x = 8; x < w - 8; x++) { const width = widthOfCol(grid, w, h, x); if (width > 0) widths.push(width); }
      } else {
        for (let y = 8; y < h - 8; y++) { const width = widthOfRow(grid, w, y); if (width > 0) widths.push(width); }
      }
      assert.ok(widths.length > 0, 'expected the stroke to paint something');
      assertNoAlternation(widths, `radius ${r} ${label}`);
    });
  }
}

test('floor-regime shallow diagonal has no gap rows (connectivity preserved by 9E.7)', async () => {
  const w = 100, h = 100;
  const segs = straightStroke(5.07, 10.19, 0.4, 0.12, 220, 0.3);
  const grid = await renderToGrid(w, h, segs);
  assert.ok(hasNoGapRows(grid, w, h), 'expected a continuous stroke with no gap rows');
});

test('above-floor (real pressure) radius keeps normal isotropic circular geometry, unaffected by 9E.7', () => {
  // Deep inside the segment body (h far from 0/1), well above halfPixel,
  // straight isotropic radius test must be completely untouched.
  const covered = CapsuleMath.pixelCoveredByCapsuleForStroke(5, 5, 0, 5, 3, 10, 5, 3, 1);
  const notCovered = CapsuleMath.pixelCoveredByCapsuleForStroke(5, 8.5, 0, 5, 3, 10, 5, 3, 1);
  assert.strictEqual(covered, 1);
  assert.strictEqual(notCovered, 0);
});

test('a point beyond the segment\'s own extent still falls back to ordinary (non-anisotropic) rejection', () => {
  // Regression guard for the "endpoint overreach" bug the anisotropic
  // test would otherwise introduce (a minor-axis-only test has no idea
  // it should stop at the segment's actual endpoint) -- see
  // _dominantAxisPerpendicularDistance's null-fallback path.
  const covered = CapsuleMath.pixelCoveredByCapsuleForStroke(-0.5, 0.5, 0, 0, 0.3, 10, 0, 0.3, 1);
  assert.strictEqual(covered, 0, 'expected a point past the segment start to remain rejected');
});

test('increasing pressure through and past the floor boundary keeps output stable/binary, no regression', async () => {
  const w = 60, h = 60;
  for (const r of [0.1, 0.3, 0.5, 0.5000001, 0.7, 1.2]) {
    const segs = straightStroke(5, 5, 0.4, 0.12, 90, r);
    const grid = await renderToGrid(w, h, segs);
    for (let i = 0; i < grid.length; i++) {
      assert.ok(grid[i] === 0 || grid[i] === 255, `expected strictly binary output at radius ${r}`);
    }
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
