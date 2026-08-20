// src/brush/brush-routing.js
//
// Phase 12A — Isolated, pure routing resolver for brush strokes.
// Separates trajectory engine selection, geometry type selection,
// material/effect flags, and renderer backend resolution into explicit,
// independent architectural concerns.
//
// Behavior-preserving refactor: produces bit-identical route resolutions
// for all 4 primary brush configurations (Default Hard Round, Hard Round + Texture,
// Custom Tip, Custom Tip + Texture).

"use strict";

(function (root) {
  function resolveStrokePipeline(ctx) {
    if (!ctx) {
      return {
        trajectoryEngine: "LEGACY_STABILIZED",
        geometryType: "PROCEDURAL_ROUND_CAPSULE",
        material: { texture: false, scatter: false, airbrush: false },
        renderBackend: "LEGACY_CANVAS",
        routeName: "LEGACY",
        isHardRoundActive: false,
        isCustomTipGpuActive: false,
      };
    }

    // 1. Material & Dynamics Flags
    const material = {
      texture: !!ctx.textureEnabled,
      scatter: !!ctx.scatterEnabled,
      airbrush: !!ctx.airbrush,
    };

    // 2. Geometry / Tip Type Selection
    let geometryType = ctx.hasCustomTip
      ? "BITMAP_CUSTOM_TIP"
      : "PROCEDURAL_ROUND_CAPSULE";

    // 3. Current Parity Eligibility Checks
    const isHardRoundEligible =
      typeof ctx.isHardRoundEligible === "boolean"
        ? ctx.isHardRoundEligible
        : false;
    const isCustomTipGpuEligible =
      typeof ctx.isCustomTipGpuEligible === "boolean"
        ? ctx.isCustomTipGpuEligible
        : false;

    // Check for procedural round + texture GPU path (Configuration B)
    const isProceduralTextureGpuEligible =
      !ctx.hasCustomTip &&
      material.texture &&
      !material.scatter &&
      !material.airbrush &&
      ctx.tool === "brush" &&
      ctx.isPen &&
      (typeof ctx.roundness === "undefined" || ctx.roundness === null || ctx.roundness >= 0.995) &&
      isCustomTipGpuEligible;

    // 4. Trajectory Engine Selection
    let trajectoryEngine = "LEGACY_STABILIZED";
    if (isHardRoundEligible || (ctx.hasCustomTip && isCustomTipGpuEligible) || isProceduralTextureGpuEligible) {
      trajectoryEngine = "SHARED_STROKE_TRAJECTORY_CORE";
    }

    // 5. Renderer Backend Resolution
    let renderBackend = "LEGACY_CANVAS";
    let routeName = "LEGACY";

    if (isHardRoundEligible) {
      renderBackend = "HARD_ROUND_CAPSULE_GPU";
      routeName = "HARD_ROUND";
    } else if (isProceduralTextureGpuEligible) {
      geometryType = "PROCEDURAL_ROUND_DABS";
      renderBackend = "CUSTOM_TIP_GPU";
      routeName = "PROCEDURAL_ROUND_TEXTURE_GPU";
    } else if (ctx.hasCustomTip && isCustomTipGpuEligible) {
      renderBackend = "CUSTOM_TIP_GPU";
      routeName = "CUSTOM_TIP_GPU";
    }

    return {
      trajectoryEngine,
      geometryType,
      material,
      renderBackend,
      routeName,
      isHardRoundActive: isHardRoundEligible,
      isCustomTipGpuActive:
        (ctx.hasCustomTip && isCustomTipGpuEligible) || isProceduralTextureGpuEligible,
    };
  }

  const BrushRoutingExports = { resolveStrokePipeline };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = BrushRoutingExports;
  }
  if (root) {
    root.BrushRouting = BrushRoutingExports;
  }
})(typeof self !== "undefined" ? self : this);
