// src/brush/hard-round-aa-off-curve-alternating-width.test.js
//
// Phase 9E.8 -- proves that a CURVED, lightest-pressure AA Off stroke (an
// arc, not a straight line -- see hard-round-aa-off-alternating-width.test.js
// for the straight-line case 9E.7 already covers) renders a STABLE
// 1-output-pixel-wide staircase along its own minor axis, instead of
// alternating 1px <-> 2px the way the bug report's two curved-stroke
// screenshots both show. See hard-round-capsule-math.js's Phase 9E.8
// comment on pixelCoveredByCapsuleForStroke/_dominantAxisPerpendicularDistance
// for the root cause (9E.7's own anisotropic test was rarely even reached
// on real, densely-tessellated segments -- most pixels fell back to the
// old generous isotropic endpoint test, and on a CURVING path that
// generous fallback and a neighboring segment's correct anisotropic
// answer can independently claim two different pixels for the same
// column/row) and the fix (segment-length-gated fallback, plus quantized
// slope in the anisotropic test itself).
//
// Run with: node src/brush/hard-round-aa-off-curve-alternating-width.test.js

'use strict';

const assert = require('assert');
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

// Genuine curved stroke: a densely-tessellated circular arc, matching how
// PrototypeStrokeCore actually feeds the renderer for a curving hand
// gesture (many short, slightly-differently-angled segments -- NOT the
// synthetic constant-dx/dy straightStroke() helper the 9E.7 suite uses).
// Segment count is chosen so consecutive chords are a fraction of an
// output pixel apart, matching real dab spacing.
function arcStroke(cx, cy, radius, startAngle, endAngle, n, r) {
  const segs = [];
  let prevX = cx + radius * Math.cos(startAngle), prevY = cy + radius * Math.sin(startAngle);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const ang = startAngle + (endAngle - startAngle) * t;
    const x = cx + radius * Math.cos(ang), y = cy + radius * Math.sin(ang);
    segs.push({
      x0: prevX, y0: prevY, x1: x, y1: y, r0: r, r1: r,
      alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
      hardness: 1, aaMode: 'off',
    });
    prevX = x; prevY = y;
  }
  segs[0].isStrokeStart = true;
  segs[segs.length - 1].isStrokeEnd = true;
  return segs;
}

function assertNoAlternation(widths, label) {
  const distinct = [...new Set(widths)];
  assert.strictEqual(distinct.length, 1,
    `expected a stable, non-alternating width for ${label}, got widths {${distinct.join(',')}} in sample ${widths.slice(0, 24).join(',')}`);
}

// Same lightest-pressure floor-regime radii the straight-line 9E.7 suite
// sweeps, now on a genuinely curving path. Each case picks a curve whose
// tangent stays clearly on one side of the x/y dominant-axis boundary
// (shallow, steep) so the measured minor axis is unambiguous, mirroring
// the "shallow diagonal measures column height" convention already used
// elsewhere in this suite.
const CURVE_CASES = [
  { name: 'gentle shallow arc, small brush', cx: 50, cy: 300, radius: 260, a0: -1.35, a1: -1.05, n: 200, r: 0.15, metric: 'col' },
  { name: 'gentle shallow arc, slightly larger brush', cx: 50, cy: 300, radius: 260, a0: -1.35, a1: -1.05, n: 200, r: 0.35, metric: 'col' },
  { name: 'tighter shallow arc', cx: 50, cy: 120, radius: 90, a0: -1.3, a1: -0.85, n: 200, r: 0.25, metric: 'col' },
  { name: 'steep arc (near-vertical tangent)', cx: 20, cy: 160, radius: 140, a0: 0.05, a1: 0.35, n: 200, r: 0.3, metric: 'row' },
];

for (const c of CURVE_CASES) {
  test(`${c.name}: stable width along a real curved stroke, no 1px/2px alternation`, async () => {
    const w = 220, h = 320;
    const segs = arcStroke(c.cx, c.cy, c.radius, c.a0, c.a1, c.n, c.r);
    const grid = await renderToGrid(w, h, segs);
    const widths = [];
    if (c.metric === 'col') {
      for (let x = 8; x < w - 8; x++) { const width = widthOfCol(grid, w, h, x); if (width > 0) widths.push(width); }
    } else {
      for (let y = 8; y < h - 8; y++) { const width = widthOfRow(grid, w, y); if (width > 0) widths.push(width); }
    }
    assert.ok(widths.length > 0, 'expected the curved stroke to paint something');
    assertNoAlternation(widths, c.name);
  });
}

test('curved stroke has no gap rows (connectivity preserved by 9E.8)', async () => {
  const w = 220, h = 320;
  const segs = arcStroke(50, 300, 260, -1.35, -1.05, 200, 0.3);
  const grid = await renderToGrid(w, h, segs);
  assert.ok(hasNoGapRows(grid, w, h), 'expected a continuous curved stroke with no gap rows');
});

test('sparsely-tessellated (fast flick) curved connectivity is unaffected by 9E.8', async () => {
  // Large per-segment steps, like a fast pointer flick -- this is exactly
  // the case the 9E.8 fix intentionally leaves on the old generous
  // fallback (see the segLen<halfPixel guard), so it must stay connected.
  const w = 300, h = 100;
  const segs = [];
  let x = 10, y = 50, r = 2.0;
  for (let i = 0; i < 25; i++) {
    const nx = x + 1.9, ny = y + 0.15 * i, nr = Math.max(0.05, r * 0.85);
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
  assert.ok(hasNoGapRows(grid, w, h), 'expected the fast-flick tail to stay connected (9E.3 preserved)');
});

test('output remains strictly binary (0/255) on a curved stroke', async () => {
  const w = 220, h = 320;
  const segs = arcStroke(50, 300, 260, -1.35, -1.05, 200, 0.3);
  const grid = await renderToGrid(w, h, segs);
  for (let i = 0; i < grid.length; i++) {
    assert.ok(grid[i] === 0 || grid[i] === 255, `expected strictly binary output, found ${grid[i]}`);
  }
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
