// Phase 11A.6 -- finish geometry must be presented before pointer-up commit.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PrototypeStrokeCore } = require("../../../prototype-stroke-core");
let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL - ${name}\n    ${e.stack || e}`);
  }
}
function sample(x, y, p, t) {
  return { x, y, pressure: p, timeStamp: t, pointerType: "pen" };
}
function run(points, { pressure = 0.5, holdTicks = 0 } = {}) {
  const core = new PrototypeStrokeCore({
    brushSize: 700,
    stabilization: 0.65,
    zoom: 1,
  });
  let t = 0;
  const live = [
    core.beginStroke(sample(points[0][0], points[0][1], pressure, t), {}),
  ];
  for (let i = 1; i < points.length; i++) {
    t += 8;
    live.push(
      ...core.pushSamples([sample(points[i][0], points[i][1], pressure, t)]),
    );
  }
  const held = [];
  for (let i = 0; i < holdTicks; i++) held.push(...core.tickHold(16.7));
  t += 8;
  const finish = core.finishStroke(
    sample(points.at(-1)[0], points.at(-1)[1], pressure, t),
  );
  const lastLive = held.at(-1) || live.at(-1),
    lastFinish = finish.segments.at(-1);
  const extension =
    lastLive && lastFinish
      ? Math.hypot(lastFinish.x1 - lastLive.x1, lastFinish.y1 - lastLive.y1)
      : 0;
  return { live, held, finish, extension };
}

const scenarios = {
  stationary: [
    [0, 0],
    [50, 0],
  ],
  slow: [
    [0, 0],
    [5, 1],
    [10, 2],
    [15, 3],
    [20, 4],
  ],
  fast: [
    [0, 0],
    [40, 5],
    [90, 12],
    [150, 20],
  ],
  flick: [
    [0, 0],
    [80, 8],
    [180, 18],
  ],
};
for (const [name, points] of Object.entries(scenarios))
  test(`${name} release emits geometry absent from the last live frame`, () => {
    const r = run(points);
    assert.ok(
      r.finish.segments.length > 0,
      "finish must emit catch-up segments",
    );
    assert.ok(
      r.extension > 1,
      `expected visible endpoint extension, got ${r.extension}`,
    );
  });
test("live hold ticks drain stabilization catch-up before release", () => {
  const without = run(scenarios.stationary),
    withHold = run(scenarios.stationary, { holdTicks: 90 });
  assert.ok(withHold.held.length > 0);
  assert.ok(
    withHold.extension < without.extension / 100,
    `${withHold.extension} vs ${without.extension}`,
  );
});
test("constant input pressure remains constant through finish geometry", () => {
  const r = run(scenarios.fast, { pressure: 0.5 });
  for (const s of r.finish.segments) {
    assert.ok(Math.abs(s.pressure0 - 0.5) < 1e-12);
    assert.ok(Math.abs(s.pressure1 - 0.5) < 1e-12);
  }
});
test("pointer-up lifecycle detaches the renderer, resolves an owned result, then commits it", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "brush-engine.js"),
    "utf8",
  );
  const finish = src.indexOf("const finish=_hardRoundCore.finishStroke");
  const flush = src.indexOf("_hardRoundFlushPending(renderer)", finish);
  const detach = src.indexOf("_hardRoundActiveContext=null", flush);
  const finalize = src.indexOf(
    "_hardRoundFinalizeOwnedContext(ownedContext,e)",
    detach,
  );
  const ownedEnd = src.indexOf(
    "context.renderer.endStroke({readback:context.gpuCommit,includeCpuMaskData:context.smartRaster,dirtyRect:context.dirtyRect})",
  );
  const copy = src.indexOf("const stable=_hardRoundCopyCanvas", ownedEnd);
  const commit = src.indexOf(
    "if(ready.smartRaster)_commitFinishedSmartRasterStroke(ready);else _commitFinishedHardRoundStroke(ready)",
    copy,
  );
  assert.ok(
    finish < flush &&
      flush < detach &&
      detach < finalize &&
      ownedEnd < copy &&
      copy < commit,
    { finish, flush, detach, finalize, ownedEnd, copy, commit },
  );
});
test("finished frame presentation no longer pays an artificial CPU paint delay", () => {
  // The old CPU path added a fixed 2-rAF wait after peekStroke() before
  // resolving, purely to give the browser a chance to paint the finished
  // frame before the overlay was exchanged. This was intentionally removed
  // because it added latency after every lift; GPU synchronization safety
  // is preserved separately, via the isGpuActive() early-return (skip
  // presenting when the shared GPU presenter is still live) and the
  // readback barrier in endStroke({readback:...}) at commit time.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "brush-engine.js"),
    "utf8",
  );
  const start = src.indexOf("function _hardRoundPresentFinishedFrame(");
  assert.ok(start >= 0, "_hardRoundPresentFinishedFrame not found");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);
  assert.ok(
    !/requestAnimationFrame\(\(\)=>requestAnimationFrame\(resolve\)\)/.test(
      body,
    ),
    "CPU path must not reintroduce the artificial 2-rAF wait",
  );
  assert.ok(
    /isGpuActive\(\)\)return Promise\.resolve\(\)/.test(body),
    "must still bail out when the shared GPU presenter is live",
  );
  assert.ok(
    /renderer\.peekStroke\(\)/.test(body),
    "must still peek the renderer to capture the finished preview canvas",
  );
});
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
