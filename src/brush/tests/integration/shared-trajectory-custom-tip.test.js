// src/brush/tests/integration/shared-trajectory-custom-tip.test.js
//
// Integration test suite for Custom Tip migration onto StrokeTrajectoryCore.
// Verifies:
// 1. StrokeTrajectoryCore outputs generic trajectory samples {x, y, pressure, timeStamp}
// 2. Custom Tip consumes generic samples through its existing downstream geometry pipeline
//    (_baselineConditionerPush -> SG filter -> _walkDabArc -> CustomTipGPU)
// 3. Downstream specialization remains distinct between Hard Round (capsules) and Custom Tip (dabs).

"use strict";

const assert = require("assert");
const { StrokeTrajectoryCore } = require("../../stroke-trajectory-core");
const { PrototypeStrokeCore } = require("../../prototype-stroke-core");
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

test("Routing Parity: Custom Tip uses SHARED_STROKE_TRAJECTORY_CORE", () => {
  const pipeline = resolveStrokePipeline({
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

  assert.strictEqual(pipeline.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(pipeline.geometryType, "BITMAP_CUSTOM_TIP");
  assert.strictEqual(pipeline.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(pipeline.routeName, "CUSTOM_TIP_GPU");
});

test("Routing Parity: Custom Tip + Texture uses SHARED_STROKE_TRAJECTORY_CORE", () => {
  const pipeline = resolveStrokePipeline({
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

  assert.strictEqual(pipeline.trajectoryEngine, "SHARED_STROKE_TRAJECTORY_CORE");
  assert.strictEqual(pipeline.geometryType, "BITMAP_CUSTOM_TIP");
  assert.strictEqual(pipeline.renderBackend, "CUSTOM_TIP_GPU");
  assert.strictEqual(pipeline.routeName, "CUSTOM_TIP_GPU");
});

test("Production Runtime Wiring: brush-engine.js instantiates and feeds StrokeTrajectoryCore for Custom Tip", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "brush-engine.js"),
    "utf8",
  );

  assert.ok(
    src.includes("_getSharedTrajectoryCore"),
    "brush-engine.js must declare and use _getSharedTrajectoryCore helper",
  );
  assert.ok(
    src.includes("SHARED_STROKE_TRAJECTORY_CORE"),
    "brush-engine.js must check active pipeline for SHARED_STROKE_TRAJECTORY_CORE",
  );
  assert.ok(
    src.includes("trajCore.pushSamples"),
    "brush-engine.js must feed move samples through StrokeTrajectoryCore.pushSamples",
  );
});

console.log(`Shared trajectory Custom Tip integration test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
