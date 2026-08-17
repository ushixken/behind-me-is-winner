"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const engine = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "brush-engine.js"),
  "utf8",
);
const renderer = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "prototype-renderer.js"),
  "utf8",
);
const { PrototypeStrokeCore } = require("../../../prototype-stroke-core.js");

test("pointerdown creates drawable core geometry without waiting for movement", () => {
  const core = new PrototypeStrokeCore({
    brushSize: 12,
    stabilization: 0,
    zoom: 1,
  });
  const segment = core.beginStroke({
    x: 20,
    y: 30,
    pressure: 0.5,
    pointerType: "pen",
    timeStamp: 1,
  });
  assert.equal(segment.x0, 20);
  assert.equal(segment.x1, 20);
  assert.equal(segment.y0, 30);
  assert.equal(segment.y1, 30);
  assert.ok(segment.pressure0 > 0);
  assert.match(engine, /_hardRoundStampSegments\(\[beginSeg\],e\)/);
  assert.match(
    engine,
    /_hardRoundRequestLivePreview\(_hardRoundRenderer,true\)/,
  );
});

test("input latency diagnostic is default-off, bounded, and covers every startup boundary", () => {
  assert.match(
    engine,
    /HardRoundDebugInputLatency==='undefined'\)window\.HardRoundDebugInputLatency=false/,
  );
  assert.match(engine, /_hardRoundInputLatencyRecords\.length<8/);
  for (const field of [
    "pointerDownTime",
    "firstRawEventType",
    "firstRawEventTime",
    "firstPressureAcceptedTime",
    "firstStabilizerInputTime",
    "firstStabilizerOutputTime",
    "firstCoreInputTime",
    "firstCoreGeometryTime",
    "firstRendererGeometryTime",
    "firstGpuSubmitTime",
    "firstPresentCallTime",
    "firstOverlayVisibleTime",
    "firstGeometrySourceEvent",
  ])
    assert.match(engine, new RegExp(field));
  assert.match(engine, /window\.HardRoundAnalyzeInputLatency=function/);
});

test("diagnostic distinguishes barrier wait from GPU completion wait", () => {
  assert.match(
    engine,
    /_hrInputLatencyNote\(session,'presentationBarrierStartTime'/,
  );
  assert.match(
    engine,
    /_hrInputLatencyNote\(session,'presentationBarrierEndTime'\)/,
  );
  assert.match(
    renderer,
    /HardRoundInputLatencyNote\(meta\.strokeId, 'firstGpuSubmitTime'\)/,
  );
  assert.match(
    renderer,
    /HardRoundInputLatencyNote\(meta\.strokeId, 'firstGpuWorkDoneTime'\)/,
  );
  assert.match(engine, /presentationBarrierWaitMs/);
  assert.match(engine, /gpuSubmitToWorkDoneMs/);
});

test("movement uses coalesced raw samples and external stabilizer before core input", () => {
  const start = engine.indexOf("function _handleMoveEvent(e)");
  const end = engine.indexOf("activeC.addEventListener('pointermove'", start);
  const body = engine.slice(start, end);
  assert.match(body, /getCoalescedEvents/);
  assert.ok(
    body.indexOf("_stabilizePoint(") <
      body.indexOf("_emitHardRoundStabilizedPoint("),
  );
  assert.match(
    engine,
    /_hardRoundCore\.updateSettings\(\{brushSize:getBrushSize\(\),stabilization:0,zoom\}\)/,
  );
});

test("pointerdown dispatch is not blocked by the legacy full-canvas active-canvas probe", () => {
  assert.match(
    engine,
    /HardRoundDebugActiveCProbe==='undefined'\)window\.HardRoundDebugActiveCProbe=false/,
  );
  assert.match(
    engine,
    /const activeCProbeEnabled=!!window\.HardRoundDebugActiveCProbe/,
  );
  assert.match(engine, /activeCProbeEnabled\?_hrHashActiveCRegion/);
  const flushStart = engine.indexOf(
    "function _hardRoundFlushPending(renderer)",
  );
  const flushEnd = engine.indexOf(
    "function _hardRoundGetRenderer()",
    flushStart,
  );
  const flushBody = engine.slice(flushStart, flushEnd);
  assert.match(
    flushBody,
    /_hrInputLatencyNote\(_activeStrokeSession,'firstRendererGeometryTime'\);\s*renderer\.drawSegments\(pending\)/,
  );
});
