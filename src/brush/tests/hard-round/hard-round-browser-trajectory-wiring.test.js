"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "../../../..");
const indexSource = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const trajectorySource = fs.readFileSync(
  path.join(repoRoot, "src/brush/stroke-trajectory-core.js"),
  "utf8",
);
const prototypeSource = fs.readFileSync(
  path.join(repoRoot, "src/brush/prototype-stroke-core.js"),
  "utf8",
);

const trajectoryTag = '<script src="src/brush/stroke-trajectory-core.js"></script>';
const prototypeTag = '<script src="src/brush/prototype-stroke-core.js"></script>';
const trajectoryIndex = indexSource.indexOf(trajectoryTag);
const prototypeIndex = indexSource.indexOf(prototypeTag);

assert.ok(trajectoryIndex >= 0, "index.html must load stroke-trajectory-core.js");
assert.ok(prototypeIndex >= 0, "index.html must load prototype-stroke-core.js");
assert.ok(
  trajectoryIndex < prototypeIndex,
  "the shared trajectory browser global must load before PrototypeStrokeCore",
);

// Evaluate exactly as ordered classic browser scripts: no CommonJS module or
// require is provided, so this catches browser/Node wiring mismatches.
const browserGlobal = {
  performance: { now: () => 1000 },
};
browserGlobal.window = browserGlobal;
browserGlobal.self = browserGlobal;
const context = vm.createContext(browserGlobal);

vm.runInContext(trajectorySource, context, {
  filename: "stroke-trajectory-core.js",
});

assert.ok(browserGlobal.StrokeTrajectoryCoreModule);
assert.equal(
  typeof browserGlobal.StrokeTrajectoryCoreModule.StrokeTrajectoryCore,
  "function",
);

vm.runInContext(prototypeSource, context, {
  filename: "prototype-stroke-core.js",
});

const prototype = new browserGlobal.PrototypeStrokeCore({
  zoom: 0.1,
  stabilization: 0,
  trajectoryExperimentMode: "CURRENT",
});
assert.notEqual(prototype.trajectoryCore, null);

prototype.beginStroke({
  x: 0,
  y: 0,
  pressure: 0.5,
  pointerType: "pen",
  timeStamp: 0,
});
const live = prototype.pushSamples([
  {
    x: 10,
    y: 0,
    pressure: 0.5,
    pointerType: "pen",
    timeStamp: 16,
  },
]);
const finish = prototype.finishStroke({
  x: 10,
  y: 0,
  pressure: 0.5,
  pointerType: "pen",
  timeStamp: 32,
});

assert.ok(Array.isArray(live), "CURRENT/default shared-core live path should run");
assert.ok(
  finish && Array.isArray(finish.segments),
  "CURRENT/default shared-core finish path should run",
);
assert.equal(prototype.drawing, false, "finishStroke should close the stroke");

const missingGlobal = {
  performance: { now: () => 1000 },
};
missingGlobal.window = missingGlobal;
missingGlobal.self = missingGlobal;
vm.runInContext(prototypeSource, vm.createContext(missingGlobal), {
  filename: "prototype-stroke-core-without-commonjs.js",
});
const missingPrototype = new missingGlobal.PrototypeStrokeCore();
assert.equal(
  missingPrototype.trajectoryCore,
  null,
  "browser mode without CommonJS require should not crash if the shared global is absent",
);

console.log("Hard Round browser trajectory wiring production test passed.");
