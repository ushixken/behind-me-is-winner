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

test("selection and hover prewarm a real transparent GPU presentation once", () => {
  assert.match(engine, /function _hardRoundPrewarmPresentation\(\)/);
  assert.match(engine, /window\.HardRoundPresenterWarm/);
  assert.match(engine, /renderer\.prepareGpuPresentation\(\)/);
  assert.match(renderer, /async prepareGpuPresentation\(\)/);
  assert.match(renderer, /warmPresentation\(\)/);
  assert.match(renderer, /pass\.draw\(0\)/);
  assert.match(
    renderer,
    /await this\.present\(\[0, 0, 0\], 'paint', 0, \{ warmup: true \}\)/,
  );
});

test("warmed begin keeps the overlay mounted but transparent until accepted presentation", () => {
  assert.match(engine, /function _hardRoundConcealMountedOverlay/);
  assert.match(
    engine,
    /overlay\.hidden=false;overlay\.style\.display='block';overlay\.style\.opacity='0'/,
  );
  assert.match(engine, /beginStroke-await-first-present-mounted-transparent/);
  assert.match(
    engine,
    /_hardRoundSetGpuOverlayVisible\(true,'presentLivePreview-accepted-frame'\)/,
  );
});

test("first-five-stroke timing is bounded and records production presentation stages", () => {
  assert.match(engine, /_hardRoundFirstPresentTiming\.length<5/);
  for (const field of [
    "pointerDownTime",
    "beginStrokeStart",
    "beginStrokeEnd",
    "firstRawInputTime",
    "firstStabilizedInputTime",
    "firstSegmentGeneratedTime",
    "firstGpuEncodeStart",
    "firstGpuSubmitTime",
    "firstPresentCallTime",
    "firstOverlayVisibleTime",
  ])
    assert.match(engine, new RegExp(field));
  assert.match(engine, /window\.HardRoundAnalyzeFirstPresentTiming=function/);
  assert.match(
    renderer,
    /HardRoundFirstPresentNote\(meta\.strokeId, 'firstGpuEncodeStart'\)/,
  );
  assert.match(
    renderer,
    /HardRoundFirstPresentNote\(meta\.strokeId, 'firstGpuSubmitTime'\)/,
  );
});

test("startup work does not alter ordered finalization or commit ownership", () => {
  assert.match(
    engine,
    /const commit=_hardRoundCommitTail\.then\(\(\)=>resolution\)/,
  );
  assert.match(engine, /_hardRoundFinalizeOwnedContext\(ownedContext,e\)/);
  const prewarm = engine.slice(
    engine.indexOf("function _hardRoundPrewarmPresentation"),
    engine.indexOf("// Exact eligibility condition"),
  );
  assert.doesNotMatch(
    prewarm,
    /_hardRoundCommitTail|_hardRoundActiveContext|resolvedCanvas|pushUndo/,
  );
});

test("fresh first dab bypasses the frame scheduler and enters the existing preview flight immediately", () => {
  assert.match(
    engine,
    /function _hardRoundStartPreviewFlight\(renderer,session\)/,
  );
  assert.match(
    engine,
    /_hardRoundRequestLivePreview\(_hardRoundRenderer,true\)/,
  );
  assert.match(
    engine,
    /if\(!immediate&&_hardRoundPreviewRAFSession===_activeStrokeSession\)return/,
  );
  const start = engine.indexOf("function _hardRoundStartPreviewFlight");
  const end = engine.indexOf("function _hardRoundSchedulePreviewFrame", start);
  const body = engine.slice(start, end);
  assert.match(body, /_hardRoundFlushPending\(renderer\)/);
  assert.match(body, /_hardRoundPresentLivePreview\(renderer\)/);
});

test("first-stroke trace distinguishes missed scheduling, rejection, ownership and opacity reveal", () => {
  for (const field of [
    "backend",
    "previewGenerationAtBegin",
    "overlayOwnerAtBegin",
    "presentLivePreviewCallCount",
    "presentLivePreviewAcceptedCount",
    "presentLivePreviewRejectedCount",
    "overlayShownCount",
    "gpuClearCountThisStroke",
    "gpuGeometrySubmitCountThisStroke",
    "gpuPresentSubmitCountThisStroke",
    "firstPresentReason",
  ])
    assert.match(engine, new RegExp(field));
  assert.match(engine, /presentLivePreviewRejectedCount','stale-generation'/);
  assert.match(
    engine,
    /presentLivePreviewRejectedCount',session!==_activeStrokeSession\?'wrong-stroke-id':'pending-preview-cancelled'/,
  );
  assert.match(
    engine,
    /gpuPreviewAccepted\?'presentLivePreviewAcceptedCount':'cpuPreviewAcceptedCount'/,
  );
  assert.match(engine, /overlayShownCount/);
});

test("a bounded GPU-ready reserve prevents rapid detached renderers from forcing a cold CPU stroke", () => {
  assert.match(engine, /const _HARD_ROUND_WARM_RESERVE = 2/);
  assert.match(engine, /function _hardRoundReplenishWarmReserve\(\)/);
  assert.match(engine, /while\(readyCount<_HARD_ROUND_WARM_RESERVE\)/);
  assert.match(engine, /await renderer\.prepareGpuPresentation\(\)/);
  assert.match(engine, /renderer\.gpu\.isAvailable\(\)/);
  assert.match(
    engine,
    /_hardRoundReleaseFinishingContext[\s\S]*?_hardRoundReplenishWarmReserve\(\)/,
  );
  assert.match(engine, /warmReserveAvailableAtBegin/);
});

test("cold primary cannot hide two GPU-ready reserves on first acquisition", () => {
  const ready = () => ({
    width: 640,
    height: 480,
    _active: false,
    _hardRoundFinishingOwner: null,
    gpu: { isAvailable: () => true },
  });
  const cold = {
    width: 640,
    height: 480,
    _active: false,
    _hardRoundFinishingOwner: null,
    gpu: { isAvailable: () => false },
  };
  const pool = [ready(), ready()];
  const select = (primary, reserve) => {
    if (primary && primary._active)
      return { renderer: primary, created: false };
    if (primary && primary.gpu.isAvailable())
      return { renderer: primary, created: false };
    const index = reserve.findIndex(
      (renderer) =>
        !renderer._hardRoundFinishingOwner && renderer.gpu.isAvailable(),
    );
    if (index >= 0) {
      if (primary && !reserve.includes(primary)) reserve.push(primary);
      return { renderer: reserve.splice(index, 1)[0], created: false };
    }
    return { renderer: primary, created: !primary };
  };
  const selected = select(cold, pool);
  assert.equal(selected.created, false);
  assert.equal(selected.renderer.gpu.isAvailable(), true);
  assert.equal(
    pool.filter((renderer, index) => pool.indexOf(renderer) !== index).length,
    0,
  );
  assert.equal(pool.length, 2); // one warm consumed, cold primary queued for replenishment

  const getStart = engine.indexOf("function _hardRoundGetRenderer()");
  const getEnd = engine.indexOf(
    "function _hardRoundHasVisibleLayerAbove",
    getStart,
  );
  const production = engine.slice(getStart, getEnd);
  assert.ok(
    production.indexOf("const readyIndex=_hardRoundRendererPool.findIndex") <
      production.indexOf("new window.PrototypeRenderer"),
  );
  assert.match(
    production,
    /_hardRoundRenderer=_hardRoundRendererPool\.splice\(readyIndex,1\)\[0\]/,
  );
  assert.match(production, /_hardRoundRendererCreatedPending=false/);
  assert.match(production, /_hardRoundReplenishWarmReserve\(\)/);
});
