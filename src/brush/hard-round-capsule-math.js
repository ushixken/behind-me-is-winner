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

// CPU equivalent of prototype's fwidth(d).
//
// Investigation (Phase 9E): in the round-cap regions (isRoundDab, or the
// clamped h===0/h===1 ends of a tapered capsule) d is a plain circular
// distance field, |grad d| === 1 exactly, so a constant 1px band is
// correct there -- this was already right.
//
// But in the STRAIGHT part of a tapered capsule (0 < h < 1, r0 !== r1),
// d = perpendicularDistance - localRadius(h), and localRadius changes
// along the axis as h advances. That extra term means d's true rate of
// change per screen pixel -- exactly what the GPU shader's fwidth(d)
// measures -- is sqrt(1 + taperRate^2), not 1, where taperRate =
// (r1-r0)/len is how fast the radius shrinks/grows per pixel travelled
// along the capsule's axis. A constant 1.0 under-estimates this for any
// segment whose radius changes appreciably over its length -- exactly a
// thin pressure-release tail, or any small brush where a fixed absolute
// radius delta is a large fraction of a short tessellation step -- which
// narrows the true AA transition into a harder, more aliased edge than
// the prototype's shader produces there. This is the source of the
// "small brush / thin tail" blockiness relative to prototype.html: not a
// difference in the SDF or the coverage formula, but in the width of the
// edge band those feed into.
//
// Kept as its own function, with a parameterless fallback (still exactly
// 1.0) for callers that can't supply taper info.
function aaBand(r0, r1, ax, ay, bx, by) {
  if (r0 === undefined) return 1.0;
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return 1.0; // degenerate/round-dab segment -- caller should use 1.0 (circular field)
  const taperRate = (r1 - r0) / len;
  return Math.sqrt(1 + taperRate * taperRate);
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
  // Round caps (isRoundDab, or h clamped to 0/1 at a capsule's rounded
  // end) are a pure circular distance field -- band is exactly 1. Only
  // the straight, unclamped part of a tapered capsule needs the wider
  // taper-aware band (see aaBand's doc comment above).
  const aa = (isRoundDab || h <= 0 || h >= 1) ? 1.0 : aaBand(r0, r1, ax, ay, bx, by);
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