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

// Phase 9E.1 -- Hard Round AA mode wiring.
//
// Legacy engine's AA mode floors (_AA_MODE_EDGE_PX in brush-engine.js:
// none:0, weak:0.85, medium:1.6, strong:2.6) set a *relative* progression
// of edge-band widths: weak is the narrowest non-aliased band, medium
// ~1.9x weak, strong ~3.1x weak, off/none is a hard step. This table
// carries that SAME relative progression (ratios preserved from the
// legacy px floors) as a multiplier on the analytic edge band
// (edgeCoverage's `aa` argument / the GPU shader's `fwidth(d)`), so
// switching modes only changes how wide the antialiased rim is -- never
// the underlying SDF, the capsule geometry, or the subpixel-area
// compensation. 'off'/'none' scale to 0, which edgeCoverage's own
// `Math.max(aa, 1e-4)` floor turns into a sub-pixel-fraction band --
// i.e. a hard, aliased step, matching "AA Off remains aliased".
// A missing/undefined mode (no caller opinion) preserves the ORIGINAL
// unscaled behavior (scale 1, same as 'weak') so every pre-Phase-9E.1
// caller/test that never passed a mode keeps producing identical output.
const AA_MODE_SCALE = { off: 0, none: 0, weak: 1, medium: 1.6 / 0.85, strong: 2.6 / 0.85 };
function aaModeScale(mode) {
  if (mode === undefined) return 1; // no mode supplied -- legacy unscaled behavior
  if (mode === 'off' || mode === 'none') return AA_MODE_SCALE.off;
  if (mode === 'weak') return AA_MODE_SCALE.weak;
  if (mode === 'strong') return AA_MODE_SCALE.strong;
  // 'medium', and anything unrecognized (e.g. the adapter's 'normal'
  // default) -- mirrors _normalizeAAMode's own unknown-mode fallback.
  return AA_MODE_SCALE.medium;
}

// Full per-fragment coverage for one capsule segment, combining signed
// distance, edge AA, and subpixel-area compensation -- the complete
// right-hand side of the prototype fragment shader's `return vec4f(...)`
// line, minus color/alpha (callers apply those).
// @param {string} [aaMode] - 'off'|'none'|'weak'|'medium'|'strong'; see
//   AA_MODE_SCALE/aaModeScale above. Omit to keep the original unscaled band.
// @returns {number} coverage 0..1
function capsuleCoverage(px, py, ax, ay, r0, bx, by, r1, aaMode) {
  const { dist, h, isRoundDab } = capsuleAxisDistance(px, py, ax, ay, bx, by);
  const localRadius = r0 + (r1 - r0) * h;
  const d = isRoundDab ? (dist - r0) : (dist - localRadius);
  // Phase 9E.2: 'off'/'none' is a hard, pixel-perfect step -- NOT a
  // narrow-band approximation of one. Previously this fell through to
  // edgeCoverage() with a floored (but nonzero) band, and to
  // subpixelAreaFactor()'s continuous area compensation, both of which
  // still produce fractional (gray) coverage near an edge or for a small
  // radius. TVPaint's AA-off is a true binary in/out test, so short-
  // circuit entirely: no band, no smoothstep, no subpixel-area
  // compensation -- just the sign of the signed distance.
  if (aaMode === 'off' || aaMode === 'none') {
    return d <= 0 ? 1.0 : 0.0;
  }
  // Round caps (isRoundDab, or h clamped to 0/1 at a capsule's rounded
  // end) are a pure circular distance field -- band is exactly 1. Only
  // the straight, unclamped part of a tapered capsule needs the wider
  // taper-aware band (see aaBand's doc comment above).
  const baseAa = (isRoundDab || h <= 0 || h >= 1) ? 1.0 : aaBand(r0, r1, ax, ay, bx, by);
  const aa = baseAa * aaModeScale(aaMode);
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
  AA_MODE_SCALE,
  aaModeScale,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HardRoundCapsuleMathExports;
}
if (typeof window !== 'undefined') {
  window.HardRoundCapsuleMath = HardRoundCapsuleMathExports;
}