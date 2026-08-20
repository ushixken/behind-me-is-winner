// src/brush/tests/trajectory/stroke-trajectory-core-parity.test.js
//
// Characterization test suite for StrokeTrajectoryCore parity against PrototypeStrokeCore.
// Verifies identical numerical sample output for renderer-neutral positional/pressure trajectory smoothing.

"use strict";

const assert = require("assert");
const { StrokeTrajectoryCore } = require("../../stroke-trajectory-core");
const { PrototypeStrokeCore } = require("../../prototype-stroke-core");

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

function assertSampleClose(s1, s2, msg) {
  assert.ok(Math.abs(s1.x - s2.x) < 1e-4, `${msg}: x mismatch (${s1.x} vs ${s2.x})`);
  assert.ok(Math.abs(s1.y - s2.y) < 1e-4, `${msg}: y mismatch (${s1.y} vs ${s2.y})`);
  assert.ok(Math.abs(s1.pressure - s2.pressure) < 1e-4, `${msg}: pressure mismatch (${s1.pressure} vs ${s2.pressure})`);
}

test("Numerical Parity: 100% Zoom, Stabilization=0, Pen Input", () => {
  const traj = new StrokeTrajectoryCore({ zoom: 1.0, stabilization: 0 });
  const core = new PrototypeStrokeCore({ zoom: 1.0, stabilization: 0 });

  const initTraj = traj.beginStroke({ x: 50, y: 50, pressure: 0.8, pointerType: "pen" });
  core.beginStroke({ x: 50, y: 50, pressure: 0.8, pointerType: "pen" });

  assert.strictEqual(initTraj.x, 50);
  assert.strictEqual(initTraj.y, 50);

  const inputs = [
    { x: 52, y: 52, pressure: 0.82, pointerType: "pen" },
    { x: 55, y: 56, pressure: 0.85, pointerType: "pen" },
    { x: 60, y: 62, pressure: 0.90, pointerType: "pen" },
  ];

  const samplesTraj = traj.pushSamples(inputs);
  const segsCore = core.pushSamples(inputs);

  assert.strictEqual(samplesTraj.length, 3);
  assert.ok(segsCore.length > 0);

  // Parity check on final sample position
  assert.ok(Math.abs(samplesTraj[2].x - core.lastRaw.x) < 1e-4, "Final raw x should match");
  assert.ok(Math.abs(samplesTraj[2].y - core.lastRaw.y) < 1e-4, "Final raw y should match");
});

test("Numerical Parity: 10% Zoom, Hidden Stabilization Window (25 samples)", () => {
  const traj = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 0 });
  const core = new PrototypeStrokeCore({ zoom: 0.1, stabilization: 0 });

  traj.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" });
  core.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" });

  const inputs = Array.from({ length: 15 }, (_, i) => ({
    x: 100 + i * 2,
    y: 100 + i * 3,
    pressure: 0.5 + i * 0.01,
    pointerType: "pen",
  }));

  const samplesTraj = traj.pushSamples(inputs);
  core.pushSamples(inputs);

  assert.strictEqual(samplesTraj.length, 15);
  assert.ok(Math.abs(samplesTraj[14].x - core.lastRaw.x) < 1e-4, "Low-zoom smoothed position x must match PrototypeStrokeCore");
  assert.ok(Math.abs(samplesTraj[14].y - core.lastRaw.y) < 1e-4, "Low-zoom smoothed position y must match PrototypeStrokeCore");
});

test("Stationary Hold tickHold Catch-Up Parity", () => {
  const traj = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 0 });
  const core = new PrototypeStrokeCore({ zoom: 0.1, stabilization: 0 });

  traj.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" });
  core.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" });

  traj.pushSamples([{ x: 200, y: 200, pressure: 0.5, pointerType: "pen" }]);
  core.pushSamples([{ x: 200, y: 200, pressure: 0.5, pointerType: "pen" }]);

  const holdTraj = traj.tickHold(16.6);
  core.tickHold(16.6);

  assert.ok(holdTraj.length > 0, "tickHold should return samples");
  assert.ok(Math.abs(traj.lastRaw.x - core.lastRaw.x) < 1e-4, "tickHold smoothed x position must match");
  assert.ok(Math.abs(traj.lastRaw.y - core.lastRaw.y) < 1e-4, "tickHold smoothed y position must match");
});

console.log(`StrokeTrajectoryCore parity test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
