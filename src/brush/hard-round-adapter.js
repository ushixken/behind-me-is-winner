// src/brush/hard-round-adapter.js
//
// Phase 8C — pure, DOM-free helpers for routing the main-app Hard Round
// brush through PrototypeStrokeCore (Phase 8B).
//
// This module owns ONLY:
//   - the eligibility test for "is this stroke Hard Round, migrated" (§9)
//   - the radius adaptation point: prototype influence/pressure -> a main-app
//     effective radius in the SAME coordinate space as the brush's selected
//     size (§2, §3)
//
// It does NOT own (and must never import/touch):
//   - pointer events, DOM, canvas rendering
//   - PrototypeStrokeCore's internal stroke buffers (see prototype-stroke-core.js)
//   - the main-app dab rasterizer (_stampDab) or layer/undo system
//
// Kept separate from brush-engine.js so the eligibility condition and the
// radius math -- the two places most likely to hide an accidental
// double-divide/multiply or a brittle "brush name" check -- can be unit
// tested headlessly (see hard-round-adapter.test.js).

'use strict';

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------
// Eligibility (Phase 8C §9)
//
// Deliberately procedural, not "preset name === 'hard-round'": a renamed or
// duplicated Hard Round preset, or a custom preset that happens to share
// Hard Round's exact settings, must still route through here, while a
// preset that merely CALLS itself "Hard Round" but has a custom tip,
// softened hardness, scatter, texture, or non-pressure size control must
// NOT. This mirrors the definition the legacy engine already used for its
// own `isHardRoundPressure` special case (brush-engine.js, "Radius
// correctness"/_computeSpacingRadius): no custom tip + hardness>=0.995 +
// pressure-driven size, while a real brush tool + pen input.
//
// Deliberately excludes:
//   - non-pen input (mouse/touch always report pressure===1, so the legacy
//     path's fixed-pressure math already matches the prototype exactly --
//     the natural pressure tail this migration fixes has no effect there).
//   - the eraser tool (out of scope for Phase 8C; only the brush tool's
//     Hard Round geometry migrates in this phase).
//   - roundness < ~1, scatter, texture, and airbrush (all explicitly
//     un-migrated brush behaviors per the Phase 8C brief).
//
// @param {object} ctx
// @param {string} ctx.tool - active tool id ('brush', 'eraser', ...)
// @param {boolean} ctx.isPen - true if the active stroke's pointerType is 'pen'
// @param {boolean} ctx.hasCustomTip - true if a custom brush tip image is active
// @param {number} ctx.hardness - brush hardness, 0..1
// @param {string} ctx.sizeControl - Tool Settings "Size" dynamics control id
// @param {number|null|undefined} ctx.roundness - brush tip roundness, 0..1 (null/undefined == 1)
// @param {boolean} ctx.scatterEnabled
// @param {boolean} ctx.textureEnabled
// @param {boolean} ctx.airbrush
// @returns {boolean}
function isHardRoundEligible(ctx) {
  if (!ctx) return false;
  if (ctx.tool !== 'brush') return false;
  if (!ctx.isPen) return false;
  if (ctx.hasCustomTip) return false;
  if (!(ctx.hardness >= 0.995)) return false;
  if (ctx.sizeControl !== 'pressure') return false;
  const roundness = ctx.roundness == null ? 1 : ctx.roundness;
  if (roundness < 0.995) return false;
  if (ctx.scatterEnabled) return false;
  if (ctx.textureEnabled) return false;
  if (ctx.airbrush) return false;
  return true;
}

// ---------------------------------------------------------------------
// Radius adaptation (Phase 8C §2, §3)
//
// Exactly one of two influence sources is used per dab, never both:
//
//   - curveKey === 'linear' (the default / what most users have): use
//     PrototypeStrokeCore's own `pressureInfluence` (pressure^1.2) directly,
//     unmodified. This is what makes default Hard Round behavior match the
//     prototype exactly, per the brief's requirement.
//   - curveKey !== 'linear' (the user explicitly picked Soft/Hard/S-curve in
//     Tool Settings): the main app still owns that choice. Feed the
//     PrototypeStrokeCore's smoothed `pressure` (not `influence`) through
//     the caller-supplied `applyPressureCurve(pressure, curveKey)` -- the
//     same function the legacy engine itself uses (_applyPressureCurve) --
//     instead. This is the "prototype smoothed pressure -> main-app
//     selected pressure curve -> effective radius" adaptation point the
//     brief calls for.
//
// No artificial start/end taper factor is applied here or anywhere in this
// module (Phase 8C §7): the only shaping of `r` across a stroke comes from
// pressure, exactly as in the prototype.
//
// @param {object} opts
// @param {number} opts.baseSize - selected brush size (SAME units as the
//   brush cursor diameter -- caller must not have already scaled this by
//   zoom or a supersample factor; see §3).
// @param {number} opts.minSizeFrac - main-app "Minimum Size" setting, 0..1
// @param {string} opts.curveKey - main-app selected pressure curve id
//   ('linear' | 'soft' | 'hard' | 's' | a custom bezier control array)
// @param {number} opts.pressure - PrototypeStrokeCore's smoothed pressure, 0..1
// @param {number} opts.influence - PrototypeStrokeCore's pressureInfluence
//   (pressure^1.2) for the same sample, 0..1
// @param {function(number,string):number} [opts.applyPressureCurve] - the
//   main app's `_applyPressureCurve`. Required only when curveKey !== 'linear'.
// @returns {number} effective radius, in the same units as opts.baseSize
function resolveEffectiveRadius(opts) {
  const o = opts || {};
  const baseSize = Math.max(0, o.baseSize || 0);
  const minSizeFrac = clamp01(o.minSizeFrac == null ? 0.05 : o.minSizeFrac);
  const curveKey = o.curveKey || 'linear';
  const influence = clamp01(o.influence == null ? 1 : o.influence);

  const usesDefaultCurve = curveKey === 'linear' || typeof o.applyPressureCurve !== 'function';
  let effectiveInfluence;
  if (usesDefaultCurve) {
    effectiveInfluence = influence;
  } else {
    const pressure = clamp01(o.pressure == null ? influence : o.pressure);
    effectiveInfluence = clamp01(o.applyPressureCurve(pressure, curveKey));
  }

  const maxR = baseSize / 2;
  const minR = maxR * minSizeFrac;
  const r = minR + (maxR - minR) * effectiveInfluence;
  // Same-spirit absolute visibility floor as the legacy engine's
  // _computeEffectiveParams (never literally zero-size / non-finite
  // downstream), not a taper -- see module doc above.
  return Math.max(0.1, r);
}

// ---------------------------------------------------------------------
// Segment render-parameter adaptation (Phase 8C completion, §2)
//
// Takes one PrototypeStrokeCore resolved segment
// ({x0,y0,pressure0,influence0,x1,y1,pressure1,influence1}) plus the
// caller's current brush/color/composite state, and returns the minimal
// render-ready segment object the capsule renderer actually consumes:
//
//   { x0, y0, x1, y1, r0, r1, alpha0, alpha1, rgb, composite, hardness, aaMode }
//
// r0/r1 are derived here (once, in one place) by feeding each endpoint's
// own pressure/influence through the SAME resolveEffectiveRadius() used
// everywhere else in this module, so CPU and GPU dispatch always agree --
// neither renderer recomputes pressure independently (§7 requirement).
//
// alpha0/alpha1 track Flow/Opacity per endpoint the same way _stampDab's
// per-dab alpha did (via the caller-supplied getEffectiveAlpha, which
// wraps the existing _getEffectiveBrushParams-style Flow logic); this
// module still owns no DOM/canvas state, so the caller must supply that
// function rather than this module reading window.* itself.
//
// @param {object} segment - one PrototypeStrokeCore resolved segment
// @param {object} opts - same shape as resolveEffectiveRadius's opts,
//   plus:
//   @param {number[]} opts.rgb - [r,g,b] 0..255
//   @param {string} opts.composite - 'paint' | 'erase'
//   @param {number} opts.hardness - brush hardness 0..1 (Hard Round is
//     always >=0.995 per eligibility, but passed through rather than
//     hardcoded so the renderer doesn't need a second source of truth)
//   @param {string} opts.aaMode - active AA mode id
//   @param {function(number,number):number} [opts.getEffectiveAlpha] -
//     (pressure, influence) -> alpha 0..1. Defaults to a constant 1 if
//     omitted (matches "no Flow dynamics configured").
// @returns {object} render-ready segment, see shape above
function resolveSegmentRenderParams(segment, opts) {
  const seg = segment || {};
  const o = opts || {};
  const getAlpha = typeof o.getEffectiveAlpha === 'function' ? o.getEffectiveAlpha : () => 1;
  const r0 = resolveEffectiveRadius({
    baseSize: o.baseSize, minSizeFrac: o.minSizeFrac, curveKey: o.curveKey,
    pressure: seg.pressure0, influence: seg.influence0,
    applyPressureCurve: o.applyPressureCurve,
  });
  const r1 = resolveEffectiveRadius({
    baseSize: o.baseSize, minSizeFrac: o.minSizeFrac, curveKey: o.curveKey,
    pressure: seg.pressure1, influence: seg.influence1,
    applyPressureCurve: o.applyPressureCurve,
  });
  const alpha0 = clamp01(getAlpha(seg.pressure0, seg.influence0));
  const alpha1 = clamp01(getAlpha(seg.pressure1, seg.influence1));
  return {
    x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1,
    r0, r1, alpha0, alpha1,
    rgb: o.rgb || [0, 0, 0],
    composite: o.composite || 'paint',
    hardness: o.hardness == null ? 1 : o.hardness,
    aaMode: o.aaMode || 'normal',
  };
}

const HardRoundAdapterExports = { isHardRoundEligible, resolveEffectiveRadius, resolveSegmentRenderParams };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HardRoundAdapterExports;
}
if (typeof window !== 'undefined') {
  window.HardRoundAdapter = HardRoundAdapterExports;
}