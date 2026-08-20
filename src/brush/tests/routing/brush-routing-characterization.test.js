// src/brush/tests/routing/brush-routing-characterization.test.js
//
// Comprehensive characterization tests for stroke pipeline routing resolution.
// Verifies 100% parity with existing routes across all 4 primary brush configurations
// and various capability permutations.

"use strict";

const assert = require("assert");
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

// CONFIG 1: Default Hard Round (tip=false, tex=false)
test("Config 1: Default Hard Round resolves to HARD_ROUND / SHARED_STROKE_TRAJECTORY_CORE / HARD_ROUND_CAPSULE_GPU", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: false,
    hardness: 1.0,
    roundness: 1.0,
    scatterEnabled: false,
    textureEnabled: false,
    airbrush: false,
    isHardRoundEligible: true,
    isCustomTipGpuEligible: false,
  });

  assert.strictEqual(res.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(res.geometryType, "PROCEDURAL_ROUND_CAPSULE");
  assert.strictEqual(res.renderBackend, "HARD_ROUND_CAPSULE_GPU");
  assert.strictEqual(res.routeName, "HARD_ROUND");
  assert.strictEqual(res.isHardRoundActive, true);
  assert.strictEqual(res.isCustomTipGpuActive, false);
});

// CONFIG 2: Procedural Hard Round + Texture (tip=false, tex=true)
test("Config 2: Hard Round + Texture resolves to PROCEDURAL_ROUND_TEXTURE_GPU / SHARED_STROKE_TRAJECTORY_CORE / CUSTOM_TIP_GPU", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: false,
    hardness: 1.0,
    roundness: 1.0,
    scatterEnabled: false,
    textureEnabled: true,
    airbrush: false,
    isHardRoundEligible: false, // Disqualified by texture from continuous capsule path
    isCustomTipGpuEligible: true,
  });

  assert.strictEqual(res.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(res.geometryType, "PROCEDURAL_ROUND_DABS");
  assert.strictEqual(res.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.routeName, "PROCEDURAL_ROUND_TEXTURE_GPU");
  assert.strictEqual(res.material.texture, true);
  assert.strictEqual(res.isHardRoundActive, false);
  assert.strictEqual(res.isCustomTipGpuActive, true);
});

// CONFIG 3: Custom Tip Only (tip=true, tex=false)
test("Config 3: Custom Tip Only resolves to CUSTOM_TIP_GPU / SHARED_STROKE_TRAJECTORY_CORE / CUSTOM_TIP_GPU", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: true,
    hardness: 1.0,
    roundness: 1.0,
    scatterEnabled: false,
    textureEnabled: false,
    airbrush: false,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: true,
  });

  assert.strictEqual(res.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(res.geometryType, "BITMAP_CUSTOM_TIP");
  assert.strictEqual(res.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.routeName, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.isCustomTipGpuActive, true);
});

// CONFIG 4: Custom Tip + Texture (tip=true, tex=true)
test("Config 4: Custom Tip + Texture resolves to CUSTOM_TIP_GPU / SHARED_STROKE_TRAJECTORY_CORE / CUSTOM_TIP_GPU", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: true,
    hardness: 1.0,
    roundness: 1.0,
    scatterEnabled: false,
    textureEnabled: true,
    airbrush: false,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: true,
  });

  assert.strictEqual(res.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(res.geometryType, "BITMAP_CUSTOM_TIP");
  assert.strictEqual(res.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.routeName, "CUSTOM_TIP_GPU");
  assert.strictEqual(res.material.texture, true);
  assert.strictEqual(res.isCustomTipGpuActive, true);
});

// Capability Permutation Tests
test("Capability: hardness < 0.995 falls to LEGACY for procedural tip", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: false,
    hardness: 0.8,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: false,
  });
  assert.strictEqual(res.routeName, "LEGACY");
});

test("Capability: scatter enabled falls to LEGACY for procedural tip", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: true,
    hasCustomTip: false,
    scatterEnabled: true,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: false,
  });
  assert.strictEqual(res.routeName, "LEGACY");
  assert.strictEqual(res.material.scatter, true);
});

test("Capability: non-pen input falls to LEGACY for procedural tip", () => {
  const res = resolveStrokePipeline({
    tool: "brush",
    isPen: false,
    hasCustomTip: false,
    isHardRoundEligible: false,
    isCustomTipGpuEligible: false,
  });
  assert.strictEqual(res.routeName, "LEGACY");
});

console.log(`Brush routing characterization tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
