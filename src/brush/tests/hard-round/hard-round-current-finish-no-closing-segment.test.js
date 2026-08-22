"use strict";

const assert = require("assert");
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

function sample(x, y, timeStamp, pressure = 0.5) {
  return { x, y, pressure, pointerType: "pen", timeStamp };
}

function cStrokePoints() {
  const points = [];
  const cx = 100;
  const cy = 100;
  const r = 80;
  for (let i = 0; i <= 24; i++) {
    const angle = (-60 + (i * 300) / 24) * Math.PI / 180;
    points.push(sample(cx + r * Math.cos(angle), cy + r * Math.sin(angle), i * 16));
  }
  return points;
}

function segmentLength(seg) {
  return Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
}

test("CURRENT shared trajectory finish does not emit a distant C-stroke closing segment", () => {
  const core = new PrototypeStrokeCore();
  const points = cStrokePoints();
  core.beginStroke(points[0], {
    zoom: 0.1,
    brushSize: 20,
    stabilization: 0,
    trajectoryExperimentMode: "CURRENT",
  });

  const liveSegments = [];
  for (const point of points.slice(1)) liveSegments.push(...core.pushSamples([point]));
  const finish = core.finishStroke(points[points.length - 1]);
  const finishSegments = finish.segments;
  const maxFinishLength = Math.max(0, ...finishSegments.map(segmentLength));

  assert.strictEqual(core.drawing, false, "finishStroke should close the active PrototypeStrokeCore stroke");
  assert.ok(liveSegments.length > 0, "sanity check: C stroke should emit live geometry");
  assert.ok(finishSegments.length > 0, "CURRENT smoothing should still emit release catch-up geometry");
  assert.ok(
    maxFinishLength < 5,
    `finish replay must remain locally ordered, not close the C shape with a long chord (max ${maxFinishLength})`,
  );
});

test("a second CURRENT stroke cannot connect to the previous stroke during finish", () => {
  const core = new PrototypeStrokeCore();
  const first = [sample(20, 20, 0), sample(120, 20, 16), sample(120, 120, 32)];
  core.beginStroke(first[0], { zoom: 0.1, brushSize: 20, stabilization: 0, trajectoryExperimentMode: "CURRENT" });
  for (const point of first.slice(1)) core.pushSamples([point]);
  core.finishStroke(first[first.length - 1]);

  const second = [sample(300, 300, 100), sample(320, 300, 116), sample(340, 300, 132)];
  core.beginStroke(second[0], { zoom: 0.1, brushSize: 20, stabilization: 0, trajectoryExperimentMode: "CURRENT" });
  for (const point of second.slice(1)) core.pushSamples([point]);
  const finish = core.finishStroke(second[second.length - 1]);
  const maxFinishLength = Math.max(0, ...finish.segments.map(segmentLength));

  assert.ok(
    maxFinishLength < 5,
    `new stroke finish must not connect back to previous stroke geometry (max ${maxFinishLength})`,
  );
});

console.log(`Hard Round CURRENT finish closing-segment test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
