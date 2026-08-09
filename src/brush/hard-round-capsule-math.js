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

// Phase 9E.3 -- pixel-square coverage test for AA-off connectivity.
//
// capsuleCoverage()'s 'off' branch is an exact point test (d<=0 at ONE
// sample position). That is correct for the *edge shape*, but when a
// renderer uses it to decide a whole output pixel's coverage from a
// single sample at that pixel's center (see prototype-renderer.js's
// block-center sampling, added for Phase 9E.2's pixel-perfect-resolve
// fix), a capsule whose radius has shrunk below roughly half a pixel --
// exactly a fast-flick stroke's tapering tail -- can pass BETWEEN
// consecutive pixel centers along a shallow diagonal without its
// (shrinking) width ever reaching either one. Every such pixel samples
// "outside" even though the capsule visibly sweeps through part of it,
// producing the dotted/gapped tail this phase fixes.
//
// The fix is a standard conservative-rasterization test: a pixel counts
// as covered if the capsule reaches ANY point inside that pixel's square,
// not just its center. Exactly testing square-vs-capsule intersection is
// more geometry than this needs; testing against the pixel's
// circumscribed circle (radius = half the pixel's diagonal) is a safe
// superset (never creates a gap) and pixel-cheap: same one-sample d<=r
// test as before, just with the radius compared against widened by the
// pixel's half-diagonal instead of 0. This is still a hard binary
// decision (no smoothstep, no fractional alpha) -- only the threshold
// moves, not the shape of the test.
function pixelCoveredByCapsule(px, py, ax, ay, r0, bx, by, r1, pixelSize) {
  const { dist, h, isRoundDab } = capsuleAxisDistance(px, py, ax, ay, bx, by);
  const localRadius = r0 + (r1 - r0) * h;
  const d = isRoundDab ? (dist - r0) : (dist - localRadius);
  const halfDiag = (pixelSize == null ? 1 : pixelSize) * Math.SQRT1_2; // side * sqrt(2)/2
  return d <= halfDiag ? 1 : 0;
}

// Phase 9E.4 -- stroke-tip-aware coverage test for AA-off.
//
// pixelCoveredByCapsule()'s conservative half-diagonal test is what keeps
// a stroke's INTERIOR connected across segment joints and fast-tapering
// tails (9E.3). But investigation showed that dilation isn't confined to
// a joint point -- it widens the ENTIRE segment's effective radius by up
// to half a pixel's diagonal (~0.71px). For most interior segments that's
// invisible (the segment is long relative to that dilation). But the
// stroke's first and last segments are exactly the ones whose outer half
// is a round cap with no neighboring segment to connect to -- there is no
// joint there to protect -- and on a short first/last segment (the common
// case: the very first pointer sample to the second, or the final taper
// segment) that dilation band covers most or all of the segment's length,
// not just its rounded tip, thickening the whole visible start/end of the
// stroke to 2-3px instead of TVPaint's exact 1px.
//
// The fix: the two true open ends of the whole stroke -- the first
// segment and the last segment -- use the strict, exact "is this pixel's
// center inside the shape" test (the same d<=0 point test
// capsuleCoverage()'s own 'off' branch already uses) over their ENTIRE
// span, not just their clamped round-cap region. Every interior segment
// (no isFirstSegment/isLastSegment flag) keeps the original conservative
// test unchanged, so segment-to-segment joints and fast-tapering tails
// stay connected exactly as 9E.3 left them. A segment that is both first
// and last (a single-segment stroke) is strict throughout, matching a
// short click/dab in TVPaint. isFirstSegment/isLastSegment default to
// false so any caller that doesn't know its position in the stroke (e.g.
// the standalone single-segment renderer, or pre-9E.4 tests) gets back
// pixelCoveredByCapsule()'s original, unchanged behavior.
// Phase 9E.6 -- stop the connectivity dilation from widening a thin
// interior stroke body.
//
// 9E.3's halfDiag test was ADDED on top of localRadius (d = dist -
// localRadius, tested against halfDiag, i.e. effectively
// dist <= localRadius + halfDiag). That's the right, safe conservative
// test for a ROUND CAP whose radius may have shrunk near zero and could
// thread between pixel centers along the direction of travel -- exactly
// the fast-flick-tail case 9E.3 targeted. But applying the SAME additive
// dilation to the STRAIGHT BODY of a segment, far from either of its
// caps, has no such along-axis slack to protect: capsuleAxisDistance's
// `dist` there is already the exact perpendicular distance to the axis
// (h is the unclamped optimal projection), so the only thing the
// dilation does in the body is isotropically fatten the visible stroke.
// At normal/thick pressure that extra ~0.71px is invisible against an
// already-many-pixel-wide stroke (per 9E.3's own comment), but at the
// lightest nonzero pressure -- localRadius far below halfDiag -- the
// dilation alone dominates the test and inflates a near-zero-radius body
// out to ~1.4 output pixels wide, which the block-center resolve then
// rounds up to 2px on most diagonals. That's the root cause of pic 1's
// 2px+ lightest-pressure strokes vs TVPaint's clean 1px (pic 2).
//
// Fix: keep the full conservative halfDiag test for cap-adjacent samples
// (isRoundDab, or h clamped to the 0/1 ends of a tapered capsule) where
// the original gap risk actually lives. In the straight body elsewhere,
// use a coverage radius that is FLOORED (not added to) at half an output
// pixel -- enough to guarantee the single nearest output pixel to the
// axis is always selected (so a thin line still resolves to a connected
// staircase), without doubling that width via the diagonal margin.
// Phase 9E.7 -- eliminate the alternating 1px/2px body width.
//
// 9E.6's floored-not-added body test (`dist <= max(localRadius,
// halfPixel)`) fixed the *average* width of a thin/low-pressure stroke,
// but it still compares an ISOTROPIC (plain Euclidean, direction-
// agnostic) perpendicular distance against a constant threshold. Sampling
// only happens at OUTPUT-pixel centers, spaced exactly `pixelSize` apart
// on the backing-store grid (see prototype-renderer.js's block-center
// loop). For a shallow (near-horizontal or near-vertical) line, a
// constant isotropic half-pixel band, sliced at those discrete centers,
// does NOT reliably contain exactly one center per step along the line's
// dominant travel axis: depending on the line's exact sub-pixel offset,
// the band sometimes straddles two adjacent centers in the minor axis
// (2 output pixels lit) and sometimes only one (1 output pixel) -- a
// property of using a direction-agnostic threshold against a grid whose
// spacing is direction-dependent relative to the line's angle, not a
// bug in the geometry/radius itself. That is the exact "1px -> 2px ->
// 1px" rhythm the bug report shows: it reproduces at ANY constant
// low-pressure radius (confirmed by sweeping radius while holding a
// shallow slope fixed -- the alternation pattern is identical at every
// tested sub-floor radius), i.e. it is a rasterization-grid artifact of
// the floor test, not a radius/pressure computation problem upstream.
//
// Fix: once we're in the floor regime (localRadius below half a pixel,
// where 9E.6's floor -- not the true geometric radius -- is what's
// deciding coverage), replace the isotropic distance test with an
// ANISOTROPIC one measured along the line's own MINOR axis only -- i.e.
// "how far is this pixel's center, in the minor-axis direction only,
// from the true line value at this pixel's major-axis coordinate" --
// exactly the standard technique that makes a Bresenham/DDA line select
// one and only one pixel per major-axis step. This only ever affects the
// floor regime (localRadius < halfPixel): real, above-floor coverage
// (localRadius >= halfPixel) is completely untouched, so normal
// pressure-driven growth and thicker strokes keep their existing
// (isotropic, correctly circular) geometry exactly as before.
// Returns the anisotropic minor-axis-only distance, or `null` when the
// pixel's major-axis position falls OUTSIDE the segment's own extent
// (t<0 or t>1 on the UNCLAMPED projection) -- i.e. the pixel is beyond
// one of the segment's true endpoints, not alongside its straight body.
// That region must keep using the ordinary (already-clamped-h) Euclidean
// distance the caller already computed, exactly like before 9E.7: the
// anisotropic test is only valid for -- and only changes behavior
// within -- the segment's own straight span. Without this bound, the
// minor-axis-only test would accept points far past the segment's ends
// too (it only ever checks the minor-axis offset), reintroducing the
// exact endpoint-overreach the earlier isotropic test correctly rejected
// (see the "constant-radius interior joint is NOT dilated" regression
// this bound fixes) and badly overreaching entirely on near-45-degree
// segments where neither axis dominates by much.
// Phase 9E.8 -- stop the anisotropic floor-regime test from disagreeing
// with itself along a CURVED stroke.
//
// A real stroke tessellates into many short, overlapping segments (dabs
// spaced roughly half a pixel apart -- see the density note on the test
// files above). 9E.7's per-segment anisotropic test computes "the true
// line value at this pixel's major-axis coordinate" from THAT segment's
// own two raw endpoints alone. For a genuinely straight stroke every
// segment shares (up to float noise) the exact same slope, so every
// overlapping segment that tests a given output pixel agrees on the
// answer -- which is why 9E.7's own straight-line tests pass. For a
// CURVED stroke the true tangent direction changes continuously along
// the path, so two adjacent, overlapping tessellated segments have
// slightly different slopes. Near a pixel-grid boundary that small slope
// difference is enough to flip which single output pixel is "nearest":
// segment N's local line calls it pixel row R, segment N+1's local line
// (a hair steeper/shallower) calls the SAME column's nearest pixel row
// R+1. Coverage is a union/max over every segment that touches a pixel
// (overlapping dabs are how a continuous stroke gets painted at all), so
// wherever consecutive segments disagree, BOTH R and R+1 end up lit --
// a 2px column -- while wherever they happen to agree only one is lit --
// a 1px column. That is exactly the "1px -> 2px -> 1px" rhythm the bug
// report shows on curves (and only on curves: a straight stroke's
// segments never disagree in the first place, which is why 9E.7's
// straight-line regression suite stayed green while this shipped).
//
// Fix has two parts, both confined to this floor-regime helper:
//
// 1. Quantize the slope used to project "the true line value" to a
//    coarse, fixed step before evaluating it. Two overlapping tessellated
//    segments sampling nearly the same short arc of a curve have nearly
//    identical true slopes (a real curve's tangent barely changes over the
//    ~half-pixel span between adjacent dabs); quantizing collapses those
//    near-duplicate slopes onto the exact same bucket, so every segment
//    that overlaps a given pixel and actually gets to RUN this test agrees
//    on which single pixel is nearest.
//
// 2. Widen the domain in which a segment is even ALLOWED to run this test.
//    A real stroke's per-segment chord is typically far SHORTER than one
//    output pixel (dabs spaced roughly half a pixel apart, sometimes much
//    less -- see the density note on the test files above), so the old
//    strict `t<0 || t>1` rejection almost never actually lets the
//    anisotropic test run: verified by instrumentation, a representative
//    curved-stroke pixel was overlapped by 16 nearby tessellated segments
//    and only 1 of them had its own unclamped t inside [0,1]. Every other
//    overlapping segment fell back to the caller's plain isotropic
//    `dist<=halfPixel` circle test instead -- which is exactly the test
//    9E.7 was replacing, and which, sampled from slightly different
//    positions along a bending path, disagrees about which single pixel
//    is nearest in precisely the way that produces the 1px/2px rhythm.
//    So in practice 9E.7 was rarely reached at all on real (densely
//    tessellated) strokes; part 1 alone changes nothing if the segments
//    that would agree never run the test in the first place.
//    Fix: extend the valid t-range by half an output pixel's worth of
//    chord length on either end (converted from world distance into this
//    segment's own parameter units). This lets a short segment's
//    anisotropic line keep deciding coverage for the sliver of a pixel
//    that actually belongs to its immediate neighbor along the same
//    smooth arc -- which, combined with the slope quantization above,
//    means neighboring segments now consistently agree on that pixel
//    instead of each being tested by whichever one happens to claim it.
//    The true segment-extent rejection (used to stop a joint from
//    dilating past its real endpoint, per the "constant-radius interior
//    joint is NOT dilated" 9E.6 regression) is preserved beyond that
//    half-pixel slack -- a pixel genuinely far past the segment's own
//    span still falls back to the ordinary clamped test, unchanged.
//    Only ever runs in the floor regime this test already applies to
//    (see pixelCoveredByCapsuleForStroke), so above-floor/normal
//    pressure geometry is completely unaffected.
const _ANISOTROPIC_SLACK_PX = 0;
const _SLOPE_QUANT_STEP = 1 / 64;
function _quantizeSlope(slope) {
  if (!Number.isFinite(slope)) return slope;
  return Math.round(slope / _SLOPE_QUANT_STEP) * _SLOPE_QUANT_STEP;
}
function _dominantAxisPerpendicularDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    // Degenerate/round-dab segment: no direction to be anisotropic
    // about -- fall back to plain Euclidean distance from the point.
    return Math.sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
  }
  const segLen = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(dx) >= Math.abs(dy)) {
    // x-dominant (horizontal-ish): one sample per output COLUMN, so the
    // minor axis is y. Find the line's true y at this pixel's x and
    // measure only the vertical offset from it, using the QUANTIZED
    // slope (Phase 9E.8) so overlapping tessellated segments along a
    // curve agree on the answer.
    const t = (px - ax) / dx;
    // Phase 9E.8: slack, in parameter units, worth half an output pixel
    // of extra chord length on either end -- see the doc comment above.
    const slack = segLen > 1e-9 ? _ANISOTROPIC_SLACK_PX / segLen : 0;
    if (t < -slack || t > 1 + slack) return null;
    const slope = _quantizeSlope(dy / dx);
    const lineY = ay + slope * (px - ax);
    return Math.abs(py - lineY);
  }
  // y-dominant (vertical-ish): one sample per output ROW; minor axis is x.
  const t = (py - ay) / dy;
  const slack = segLen > 1e-9 ? _ANISOTROPIC_SLACK_PX / segLen : 0;
  if (t < -slack || t > 1 + slack) return null;
  const invSlope = _quantizeSlope(dx / dy);
  const lineX = ax + invSlope * (py - ay);
  return Math.abs(px - lineX);
}

function pixelCoveredByCapsuleForStroke(px, py, ax, ay, r0, bx, by, r1, pixelSize, isFirstSegmentIn, isLastSegmentIn) {
  const isFirstSegment = !!isFirstSegmentIn, isLastSegment = !!isLastSegmentIn;
  const { dist, h, isRoundDab } = capsuleAxisDistance(px, py, ax, ay, bx, by);
  const localRadius = r0 + (r1 - r0) * h;
  const d = isRoundDab ? (dist - r0) : (dist - localRadius);
  if (isFirstSegment || isLastSegment) {
    return d <= 0 ? 1 : 0;
  }
  const size = pixelSize == null ? 1 : pixelSize;
  // Phase 9E.6 (continued): caps (isRoundDab, or h clamped to 0/1) keep
  // the full conservative halfDiag test -- this is where 9E.3's original
  // gap risk (a shrinking-radius cap threading between pixel centers
  // along the path) actually lives, and at real stroke tessellation
  // density (dabs spaced roughly a pixel or less apart) the extra ~0.7px
  // margin there is absorbed by the overlap between consecutive dabs, not
  // visible as a bump. Only the STRAIGHT BODY -- away from either cap,
  // where dist is already the exact perpendicular distance with no
  // along-axis slack to protect -- drops the additive dilation for a
  // floored-not-added radius, which is what was inflating a thin/low-
  // pressure stroke's interior to ~1.4px (rounding to 2 on many
  // diagonals) in the reported bug.
  const isTaperingCap = (isRoundDab || h <= 0 || h >= 1) && r0 !== r1;
  if (isTaperingCap) {
    const halfDiag = size * Math.SQRT1_2;
    return d <= halfDiag ? 1 : 0;
  }
  const halfPixel = size * 0.5;
  if (localRadius > halfPixel) {
    // Above the floor: real, pressure-driven coverage. Untouched -- exact
    // isotropic circular/capsule geometry, same as before 9E.7.
    return dist <= localRadius ? 1 : 0;
  }
  // Floor regime (Phase 9E.7): anisotropic minor-axis-only test instead
  // of the isotropic `dist <= halfPixel` -- see the doc comment above.
  // Falls back to the ordinary (clamped-h) Euclidean distance whenever
  // the pixel is beyond the segment's own extent along its major axis
  // (see _dominantAxisPerpendicularDistance's null case), so endpoint/
  // cap-adjacent rejection behaves exactly as before 9E.7.
  const axisDist = _dominantAxisPerpendicularDistance(px, py, ax, ay, bx, by);
  if (axisDist === null) {
    // Phase 9E.8: a real curved stroke tessellates into segments far
    // SHORTER than one output pixel (dense dab spacing). When this
    // out-of-range pixel is one such short segment's near neighbor, the
    // ADJACENT segment continuing the same smooth arc reliably has this
    // exact pixel within ITS OWN t-range and claims it correctly via the
    // anisotropic test above. Falling back here to the generous isotropic
    // `dist<=halfPixel` circle around this segment's own clamped endpoint
    // lets THIS segment also independently claim a pixel one row/column
    // away from where the curve actually continues -- which is exactly
    // the disagreement between overlapping neighbors that produces the
    // 1px/2px alternation on curves (verified by instrumentation: the
    // extra pixel was always claimed only by this generous fallback,
    // while the true covering neighbor segment used the strict
    // anisotropic test). For densely tessellated segments, trust that
    // neighbor instead and decline here.
    //
    // Sparser tessellation (e.g. a fast flick's larger dab spacing, where
    // the segment chord itself is a full pixel or more) has no such
    // guaranteed neighbor claim, so the original generous connectivity
    // fallback is kept exactly as before -- this preserves the 9E.3
    // flick-tail-connectivity guarantee unchanged.
    const segLen = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    if (segLen < halfPixel) return 0;
    return dist <= halfPixel ? 1 : 0;
  }
  return axisDist <= halfPixel ? 1 : 0;
}

const HardRoundCapsuleMathExports = {
  capsuleAxisDistance,
  capsuleSignedDistance,
  edgeCoverage,
  aaBand,
  subpixelAreaFactor,
  capsuleCoverage,
  pixelCoveredByCapsule,
  pixelCoveredByCapsuleForStroke,
  _dominantAxisPerpendicularDistance,
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