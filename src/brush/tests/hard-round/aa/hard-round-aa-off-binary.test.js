// src/brush/hard-round-aa-off-binary.test.js
//
// Phase 9E.2 -- proves AA Off is truly pixel-perfect/aliased, not merely a
// narrower AA band (which is all Phase 9E.1 delivered). Specifically:
//   1. capsuleCoverage() with aaMode 'off'/'none' returns ONLY 0 or 1 --
//      never any fractional value -- for any sample point, including ones
//      that would have produced fractional coverage before (edge-band
//      fringe, sub-pixel-radius area compensation).
//   2. PrototypeRenderer's full CPU pipeline (SS=4 accumulate + box-filter
//      resolve) -- the actual production path -- also resolves every
//      pixel to exactly alpha 0 or 255 when aaMode is Off, on both a
//      straight and a diagonal (worst-case for a box filter) capsule.
//   3. Weak/Medium/Strong are unaffected (still produce fractional/AA
//      output), proving this change is scoped to Off/None only.
//
// Run with: node src/brush/hard-round-aa-off-binary.test.js

"use strict";

const assert = require("assert");
const CapsuleMath = require("../../../hard-round-capsule-math");
const { PrototypeRenderer } = require("../../../prototype-renderer");

let passed = 0,
  failed = 0;
const pending = [];
function test(name, fn) {
  const run = Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  FAIL - ${name}`);
      console.error(
        "    " +
          (err && err.stack ? err.stack.split("\n").join("\n    ") : err),
      );
    });
  pending.push(run);
}

function makeFakeCtx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    createImageData(cw, ch) {
      return {
        data: new Uint8ClampedArray(cw * ch * 4),
        width: cw,
        height: ch,
      };
    },
    putImageData(img, dx = 0, dy = 0) {
      for (let y = 0; y < img.height; y++) {
        const ty = dy + y;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < img.width; x++) {
          const tx = dx + x;
          if (tx < 0 || tx >= w) continue;
          const si = (y * img.width + x) * 4;
          const di = (ty * w + tx) * 4;
          data[di] = img.data[si];
          data[di + 1] = img.data[si + 1];
          data[di + 2] = img.data[si + 2];
          data[di + 3] = img.data[si + 3];
        }
      }
    },
    clearRect() {
      data.fill(0);
    },
    _pixel(x, y) {
      const p = (y * w + x) * 4;
      return [data[p], data[p + 1], data[p + 2], data[p + 3]];
    },
  };
}

function makeRenderer(w, h) {
  const r = new PrototypeRenderer({ width: w, height: h });
  r._outCanvas = { width: w, height: h };
  r._outCtx = makeFakeCtx(w, h);
  return r;
}

// ---------------------------------------------------------------------
// Layer 1: pure math -- exhaustively sample across the edge band and
// confirm capsuleCoverage() with aaMode off/none is ALWAYS exactly 0 or 1.
// ---------------------------------------------------------------------
test("capsuleCoverage: Off is exactly binary (0 or 1) at every sample across the edge, including sub-pixel radius", () => {
  const ax = 0,
    ay = 0,
    bx = 20,
    by = 0,
    r = 5;
  let sawFraction = false;
  for (let t = -3; t <= 3; t += 0.01) {
    const px = bx + r + t,
      py = by;
    const cov = CapsuleMath.capsuleCoverage(
      px,
      py,
      ax,
      ay,
      r,
      bx,
      by,
      r,
      "off",
    );
    if (cov !== 0 && cov !== 1) sawFraction = true;
  }
  assert.ok(
    !sawFraction,
    'expected only 0 or 1 from capsuleCoverage with aaMode="off"',
  );

  // Sub-pixel radius: previously subpixelAreaFactor() alone guaranteed a
  // fractional value near the round-dab center for any radius < ~0.56px.
  const tinyR = 0.3;
  let sawFractionTiny = false;
  for (let t = -1; t <= 1; t += 0.01) {
    const cov = CapsuleMath.capsuleCoverage(
      t,
      0,
      0,
      0,
      tinyR,
      0,
      0,
      tinyR,
      "off",
    );
    if (cov !== 0 && cov !== 1) sawFractionTiny = true;
  }
  assert.ok(
    !sawFractionTiny,
    'expected only 0 or 1 for a sub-pixel radius with aaMode="off"',
  );
});

test('capsuleCoverage: "none" matches "off" exactly, sample for sample', () => {
  const ax = 0,
    ay = 0,
    bx = 20,
    by = 0,
    r = 5;
  for (let t = -3; t <= 3; t += 0.13) {
    const px = bx + r + t;
    const off = CapsuleMath.capsuleCoverage(
      px,
      by,
      ax,
      ay,
      r,
      bx,
      by,
      r,
      "off",
    );
    const none = CapsuleMath.capsuleCoverage(
      px,
      by,
      ax,
      ay,
      r,
      bx,
      by,
      r,
      "none",
    );
    assert.strictEqual(off, none, `off/none disagree at t=${t}`);
  }
});

test("capsuleCoverage: Weak/Medium/Strong still produce fractional coverage (unaffected by 9E.2)", () => {
  const ax = 0,
    ay = 0,
    bx = 20,
    by = 0,
    r = 5;
  for (const mode of ["weak", "medium", "strong"]) {
    let sawFraction = false;
    for (let t = -3; t <= 3; t += 0.05) {
      const cov = CapsuleMath.capsuleCoverage(
        bx + r + t,
        by,
        ax,
        ay,
        r,
        bx,
        by,
        r,
        mode,
      );
      if (cov > 1e-9 && cov < 1 - 1e-9) sawFraction = true;
    }
    assert.ok(
      sawFraction,
      `expected ${mode} to still produce fractional (AA) coverage`,
    );
  }
});

// ---------------------------------------------------------------------
// Layer 2: full production CPU pipeline -- confirm the RESOLVED output
// (after SS=4 accumulate + box-filter resolve) is exactly 0 or 255 alpha
// for every pixel the segment's bounding box touches, for both a
// horizontal capsule and a 37deg diagonal one (the worst case for a box
// filter smearing a hard edge into gray, and the case in the bug report's
// reference image).
// ---------------------------------------------------------------------
async function resolvedAlphas(seg, w, h) {
  const renderer = makeRenderer(w, h);
  renderer.beginStroke();
  renderer.drawSegments([seg]);
  await renderer.endStroke();
  const ctx = renderer._outCtx;
  const alphas = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) alphas.push(ctx._pixel(x, y)[3]);
  }
  return alphas;
}

test("PrototypeRenderer CPU pipeline: Off resolves every pixel to exactly alpha 0 or 255 (horizontal capsule)", async () => {
  const seg = {
    x0: 20,
    y0: 32,
    x1: 40,
    y1: 32,
    r0: 10,
    r1: 10,
    alpha0: 1,
    alpha1: 1,
    rgb: [0, 0, 0],
    composite: "paint",
    hardness: 1,
    aaMode: "off",
  };
  const alphas = await resolvedAlphas(seg, 64, 64);
  const nonBinary = alphas.filter((a) => a !== 0 && a !== 255);
  assert.strictEqual(
    nonBinary.length,
    0,
    `expected no gray pixels, found ${nonBinary.length}: ${nonBinary.slice(0, 10)}`,
  );
  assert.ok(
    alphas.some((a) => a === 255),
    "expected at least some fully-opaque pixels",
  );
});

test("PrototypeRenderer CPU pipeline: Off resolves every pixel to exactly alpha 0 or 255 (37deg diagonal capsule, matches reference image)", async () => {
  const cx = 32,
    cy = 32,
    len = 20,
    angle = (37 * Math.PI) / 180;
  const dx = Math.cos(angle) * len,
    dy = Math.sin(angle) * len;
  const seg = {
    x0: cx - dx,
    y0: cy - dy,
    x1: cx + dx,
    y1: cy + dy,
    r0: 6,
    r1: 6,
    alpha0: 1,
    alpha1: 1,
    rgb: [0, 0, 0],
    composite: "paint",
    hardness: 1,
    aaMode: "off",
  };
  const alphas = await resolvedAlphas(seg, 64, 64);
  const nonBinary = alphas.filter((a) => a !== 0 && a !== 255);
  assert.strictEqual(
    nonBinary.length,
    0,
    `expected no gray stair-step pixels on a diagonal edge, found ${nonBinary.length}: ${nonBinary.slice(0, 10)}`,
  );
});

test('PrototypeRenderer CPU pipeline: "none" also resolves to exactly alpha 0 or 255', async () => {
  const seg = {
    x0: 20,
    y0: 32,
    x1: 40,
    y1: 32,
    r0: 10,
    r1: 10,
    alpha0: 1,
    alpha1: 1,
    rgb: [0, 0, 0],
    composite: "paint",
    hardness: 1,
    aaMode: "none",
  };
  const alphas = await resolvedAlphas(seg, 64, 64);
  const nonBinary = alphas.filter((a) => a !== 0 && a !== 255);
  assert.strictEqual(
    nonBinary.length,
    0,
    `expected no gray pixels for aaMode="none", found ${nonBinary.length}`,
  );
});

test("PrototypeRenderer CPU pipeline: Weak/Medium/Strong still resolve with gray (AA) edge pixels (unaffected by 9E.2)", async () => {
  for (const mode of ["weak", "medium", "strong"]) {
    const seg = {
      x0: 20,
      y0: 32,
      x1: 40,
      y1: 32,
      r0: 10,
      r1: 10,
      alpha0: 1,
      alpha1: 1,
      rgb: [0, 0, 0],
      composite: "paint",
      hardness: 1,
      aaMode: mode,
    };
    const alphas = await resolvedAlphas(seg, 64, 64);
    const nonBinary = alphas.filter((a) => a !== 0 && a !== 255);
    assert.ok(
      nonBinary.length > 0,
      `expected ${mode} to still resolve gray AA edge pixels`,
    );
  }
});

test("PrototypeRenderer CPU pipeline: Off capsule geometry/opaque core is identical to prior aaMode behavior", async () => {
  const seg = {
    x0: 20,
    y0: 32,
    x1: 40,
    y1: 32,
    r0: 10,
    r1: 10,
    alpha0: 1,
    alpha1: 1,
    rgb: [0, 0, 0],
    composite: "paint",
    hardness: 1,
    aaMode: "off",
  };
  const renderer = makeRenderer(64, 64);
  renderer.beginStroke();
  renderer.drawSegments([seg]);
  await renderer.endStroke();
  const [, , , a] = renderer._outCtx._pixel(30, 32); // dead center
  assert.strictEqual(
    a,
    255,
    "capsule interior must remain fully opaque under Off",
  );
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
