// src/brush/hard-round-capsule-math.js
//
// Phase 8C completion — pure, DOM-free capsule geometry/coverage math.
//
// Ported directly from prototype/prototype.html's WebGPU fragment shader
// (`sdSegment` + the coverage/AA/subpixel-area logic in `fs`, lines
// ~529-570) and its `segmentVerts`/`circleVerts` bounding-quad builders
// (lines ~826-863). This is the SAME analytic model on both the CPU
// rasterizer (hard-round-capsule-renderer.js) and the GPU shader
// (hard-round-capsule-gpu.js) consume, so a segment produces pixel-identical
// coverage regardless of which backend renders it (§7).
//
// Kept free of canvas/DOM/WebGPU calls so it can be unit tested headlessly.

'use strict';

// Distance from point p=(px,py) to the segment a=(ax,ay)->b=(bx,by).
// Degenerates to |p-a| when a===b (a round dab), matching prototype's
// sdSegment exactly (denom < 1e-6 branch).
function capsuleAxisDistance(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom < 1e-6 ? 0 : Math.max(0, Math.min(1, (pax * bax + pay * bay) / denom));
  const dx = pax - bax * h, dy = pay - bay * h;
  return { dist: Math.sqrt(dx * dx + dy * dy), h, isRoundDab: denom < 1e-6 };
}

// Signed distance from p to the tapered capsule (a,r0)->(b,r1): negative
// inside, 0 on the boundary, positive outside. Radius is linearly
// interpolated by the same `h` used for the axis projection, exactly as
// `localRadius = mix(in.r0, in.r1, h)` in the prototype fragment shader.
function capsuleSignedDistance(px, py, ax, ay, r0, bx, by, r1) {
  const { dist, h, isRoundDab } = capsuleAxisDistance(px, py, ax, ay, bx, by);
  const localRadius = r0 + (r1 - r0) * h;
  return isRoundDab ? (dist - r0) : (dist - localRadius);
}

// Antialiased coverage (0..1) for one fragment/pixel at signed distance
// `d`, given an edge band width `aa` (prototype's `fwidth(d)`, i.e. "how
// fast does d change per pixel here"; a 2D canvas has no built-in fwidth,
// so callers pass an approximation -- see aaBandForScale below). Mirrors
// `clamp(0.5 - d/aa, 0, 1)` exactly.
function edgeCoverage(d, aa) {
  const band = Math.max(aa, 1e-4);
  return Math.max(0, Math.min(1, 0.5 - d / band));
}

// CPU equivalent of prototype's fwidth(d): for a capsule (not rotated
// per-fragment, distance gradient magnitude is ~1 in world units away from
// the two round caps and exactly 1 radially at a cap), a constant 1px-wide
// band reproduces the same crisp, zoom-invariant ~1px transition the
// shader's screen-space derivative gives it. Kept as its own function so
// the "1" can be tuned in one place if a future zoom-aware caller needs it.
function aaBand() {
  return 1.0;
}

// Subpixel-area compensation for very small dabs/capsules (prototype
// lines ~562-567): an SDF step overestimates coverage for a shape smaller
// than one pixel (a near-zero circle centered on a fragment can still read
// ~50% from the step alone), so scale by the shape's true physical area
// for a round dab, or by its width for a thin capsule segment.
function subpixelAreaFactor(localRadius, isRoundDab) {
  const circleArea = Math.min(1, Math.PI * localRadius * localRadius);
  const strokeWidth = Math.min(1, 2 * localRadius);
  return isRoundDab ? circleArea : strokeWidth;
}

// Full per-fragment coverage for one capsule segment, combining signed
// distance, edge AA, and subpixel-area compensation -- the complete
// right-hand side of the prototype fragment shader's `return vec4f(...)`
// line, minus color/alpha (callers apply those).
// @returns {number} coverage 0..1
function capsuleCoverage(px, py, ax, ay, r0, bx, by, r1) {
  const { dist, h, isRoundDab } = capsuleAxisDistance(px, py, ax, ay, bx, by);
  const localRadius = r0 + (r1 - r0) * h;
  const d = isRoundDab ? (dist - r0) : (dist - localRadius);
  const aa = aaBand();
  const cov = edgeCoverage(d, aa);
  const area = subpixelAreaFactor(localRadius, isRoundDab);
  return cov * area;
}

// Bounding box (integer-expanded) for a tapered capsule, in the same units
// as x0/y0/x1/y1/r0/r1. Mirrors segmentVerts'/circleVerts' AA_MARGIN
// padding so no antialiased edge pixel is ever left outside the sampled
// rectangle.
const AA_MARGIN = 2.0;
function capsuleBounds(x0, y0, x1, y1, r0, r1) {
  const maxR = Math.max(r0, r1) + AA_MARGIN;
  const minX = Math.min(x0, x1) - maxR, maxX = Math.max(x0, x1) + maxR;
  const minY = Math.min(y0, y1) - maxR, maxY = Math.max(y0, y1) + maxR;
  return {
    sx: Math.floor(minX), sy: Math.floor(minY),
    ex: Math.ceil(maxX), ey: Math.ceil(maxY),
  };
}

const HardRoundCapsuleMathExports = {
  capsuleAxisDistance,
  capsuleSignedDistance,
  edgeCoverage,
  aaBand,
  subpixelAreaFactor,
  capsuleCoverage,
  capsuleBounds,
  AA_MARGIN,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HardRoundCapsuleMathExports;
}
if (typeof window !== 'undefined') {
  window.HardRoundCapsuleMath = HardRoundCapsuleMathExports;
}
