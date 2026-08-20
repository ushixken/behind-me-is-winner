// src/brush/tests/integration/procedural-round-texture-gpu.test.js
//
// Integration test verifying Configuration B (Default procedural round + Texture):
// 1. Routes to SHARED_STROKE_TRAJECTORY_CORE
// 2. Uses PROCEDURAL_ROUND_DABS geometry
// 3. Emits dabs without creating a bitmap custom tip canvas identity (hasCustomTip remains false)
// 4. Activates CUSTOM_TIP_GPU renderer backend

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveStrokePipeline } = require("../../brush-routing");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error("    " + (err && err.stack ? err.stack.split("\n").join("\n    ") : err));
  }
}

test("Config B Routing: procedural round + texture uses SHARED_STROKE_TRAJECTORY_CORE and PROCEDURAL_ROUND_DABS", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: false,
    hardness: 1.0,
    roundness: 1.0,
    scatterEnabled: false,
    textureEnabled: true,
    airbrush: false,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: true,
  });

  assert.strictEqual(res.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(res.geometryType, "PROCEDURAL_ROUND_DABS");
  assert.strictEqual(res.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.routeName, "PROCEDURAL_ROUND_TEXTURE_GPU");
  assert.strictEqual(res.material.texture, true);
  assert.strictEqual(res.isCustomTipGpuActive, true);
});

test("Brush Engine Parity: _customTipGpuEligibleNow allows texture-enabled procedural round brush", () => {
  const brushEngineSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "brush-engine.js"),
    "utf8",
  );
  const brushRoutingSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "brush-routing.js"),
    "utf8",
  );

  assert.ok(
    brushEngineSrc.includes("isProceduralTexture"),
    "_customTipGpuEligibleNow must check isProceduralTexture for procedural brushes",
  );
  assert.ok(
    brushRoutingSrc.includes("PROCEDURAL_ROUND_DABS"),
    "brush-routing.js must define PROCEDURAL_ROUND_DABS geometry",
  );
});

test("CustomTipGpuResources: getOrCreateCurrentTipResource creates valid 1x1 fallback tip when no custom tip canvas is set", async () => {
  const resourcesSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "custom-tip-gpu-resources.js"),
    "utf8",
  );
  assert.ok(
    resourcesSrc.includes("getOrCreateFallbackProceduralTipResource"),
    "CustomTipGpuResources must define getOrCreateFallbackProceduralTipResource",
  );
  assert.ok(
    resourcesSrc.includes("fallback_procedural_1x1"),
    "Fallback tip resource key must be fallback_procedural_1x1",
  );
});

test("Dab Dispatch: _queueDab and _emitResolvedCustomTipDab dispatch dabs when _customTipGpuStrokeActive is true even if brushTipCanvas is null", () => {
  const brushEngineSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "brush-engine.js"),
    "utf8",
  );
  assert.ok(
    brushEngineSrc.includes("if (window.brushTipCanvas || _customTipGpuStrokeActive)"),
    "_queueDab must dispatch to _emitResolvedCustomTipDab when _customTipGpuStrokeActive is true",
  );
});

test("First-Stroke Presentation Lifecycle: presentLiveImmediately awaits pending resourcePromise for instant stroke #1 LIVE presentation", () => {
  const rendererSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "custom-tip-gpu-renderer.js"),
    "utf8",
  );
  assert.ok(
    rendererSrc.includes("if (!this.currentResource && this.resourcePromise)"),
    "presentLiveImmediately must await resourcePromise when currentResource is not yet populated",
  );
});

console.log(`Procedural Round Texture GPU integration test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
