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

test("default Hard Round live preview uses canvas stack without requiring a debug global", () => {
  assert.match(
    renderer,
    /HardRoundDebugLivePresentationMode == null\s*\?\s*"NORMAL_CANVAS_STACK"/,
  );
  assert.doesNotMatch(
    renderer,
    /window\.HardRoundDebugLivePresentationMode\s*=\s*"NORMAL_CANVAS_STACK"/,
  );
  assert.match(renderer, /_livePresentationMode\s*===\s*"NORMAL_CANVAS_STACK"/);
  assert.match(renderer, /_canvasLivePresentationOn && _isLivePreviewMeta/);
  assert.match(renderer, /await this\._resolveToOutput\(true,\s*_diagMeta\)/);
  assert.match(renderer, /canvasLivePresentation:\s*true/);
});

test("canvas-stack live result is accepted without GPU presentation metadata", () => {
  const rejectionGuard = engine.slice(
    engine.indexOf("if (\n        renderer.isGpuActive"),
    engine.indexOf('_hr11b6Log("presentLivePreview-accepted"'),
  );
  assert.match(
    rejectionGuard,
    /renderer\.isGpuActive\s*&&\s*renderer\.isGpuActive\(\)\s*&&\s*!result\.canvasLivePresentation\s*&&\s*\(!result\.presentation\s*\|\|\s*result\.presentation\.presented\s*!==\s*true\)/,
  );
  assert.match(
    rejectionGuard,
    /presentLivePreviewRejectedCount/,
    "ordinary GPU results should still be rejected by this guard when not presented",
  );
});

test("explicit diagnostic live presentation override is still honored", () => {
  assert.match(
    renderer,
    /: window\.HardRoundDebugLivePresentationMode/,
  );
  assert.match(renderer, /_livePresentationMode\s*===\s*"READBACK_2D"/);
  assert.match(renderer, /_livePresentationMode\s*===\s*"NORMAL_CANVAS_STACK"/);
});

test("canvas-stack Hard Round pointerup holds live representation until final commit", () => {
  assert.match(engine, /function _hrNormalCanvasStackLivePresentationActive\(\)/);
  assert.match(engine, /window\.HardRoundDebugLivePresentationMode == null/);
  assert.match(engine, /window\.HardRoundDebugLivePresentationMode === "NORMAL_CANVAS_STACK"/);
  assert.match(engine, /function _hrShouldHoldNormalCanvasStackLiveUntilCommit\(\)/);
  assert.match(
    engine,
    /ownedContext\.holdNormalCanvasStackLiveUntilCommit\s*=\s*_hrShouldHoldNormalCanvasStackLiveUntilCommit\(\)/,
  );
});

test("hold behavior is production behavior, not gated by a debug hold flag", () => {
  assert.doesNotMatch(engine, /HardRoundDebugHoldNormalCanvasStackLiveUntilCommit/);
  const assignment = engine.match(
    /ownedContext\.holdNormalCanvasStackLiveUntilCommit\s*=\s*([\s\S]*?);/,
  );
  assert.ok(assignment, "hold assignment should exist");
  assert.match(assignment[1], /_hrShouldHoldNormalCanvasStackLiveUntilCommit\(\)/);
  assert.doesNotMatch(assignment[1], /HardRoundDebug/);
});

test("other live presentation modes still retire live state at pointerup", () => {
  const pointerup = engine.slice(
    engine.indexOf("ownedContext.holdNormalCanvasStackLiveUntilCommit"),
    engine.indexOf("ownedContext.presentFinishedFrame = ownedContext.gpuCommit"),
  );
  const retireConditionIndex = pointerup.indexOf(
    "if (_inStroke && !ownedContext.holdNormalCanvasStackLiveUntilCommit)",
  );
  const retireMutationIndex = pointerup.indexOf("_inStroke = false;", retireConditionIndex);
  assert.ok(retireConditionIndex >= 0, "non-held modes should test pointerup retirement");
  assert.ok(
    retireMutationIndex > retireConditionIndex,
    "non-held modes should retire _inStroke at pointerup",
  );
});

test("held live state is retired immediately before committed recomposite", () => {
  const commitStart = engine.indexOf('"_hardRoundFinalizeOwnedContext(context, e)"');
  assert.equal(commitStart, -1, "sanity: source should not contain quoted call");
  const finalizer = engine.slice(
    engine.indexOf("function _hardRoundFinalizeOwnedContext(context, e)"),
    engine.indexOf("// TEMP DIAGNOSTIC (Phase 11A routing probe)"),
  );
  const clearIndex = finalizer.indexOf(
    "if (ready.holdNormalCanvasStackLiveUntilCommit && _inStroke)",
  );
  const commitIndex = finalizer.indexOf("_commitFinishedHardRoundStroke(ready)");
  assert.ok(clearIndex >= 0, "held live state should be cleared at final commit");
  assert.ok(commitIndex >= 0, "normal raster commit call should exist");
  assert.ok(
    clearIndex < commitIndex,
    "held live state must be retired before final committed recomposite",
  );
  assert.match(finalizer, /if \(ready\.holdNormalCanvasStackLiveUntilCommit && _inStroke\)/);
  assert.match(finalizer, /_inStroke = false;/);
});

test("readback/error cleanup clears held live state and scratch canvas", () => {
  const errorCleanup = engine.slice(
    engine.indexOf("(error) => {"),
    engine.indexOf("rejectOwnedResult(error);") + "rejectOwnedResult(error);".length,
  );
  assert.match(errorCleanup, /context\.holdNormalCanvasStackLiveUntilCommit/);
  assert.match(errorCleanup, /_inStroke = false;/);
  assert.match(errorCleanup, /_strokeCtx\.clearRect/);
});

test("finally cleanup prevents held live state from remaining stuck", () => {
  const finallyCleanup = engine.slice(
    engine.indexOf("const settled = commit.finally"),
    engine.indexOf("_hardRoundCommitTail = settled.catch"),
  );
  assert.match(finallyCleanup, /context\.holdNormalCanvasStackLiveUntilCommit/);
  assert.match(finallyCleanup, /_inStroke = false;/);
  assert.match(finallyCleanup, /_strokeCtx\.clearRect/);
});

test("temporal stroke timing diagnostic is wired to authoritative presentation stages", () => {
  assert.match(engine, /function _hrTemporalActive\(\)/);
  const acceptedSetup = engine.slice(
    engine.indexOf('_hr11b6Log("presentLivePreview-accepted"'),
    engine.indexOf("_hrLcInc(\"previewAccepted\")"),
  );
  assert.match(
    acceptedSetup,
    /_hrTemporalActive\(\)/,
    "temporal diagnostic should create the accepted represented endpoint without older diagnostics",
  );
  assert.match(engine, /_hrTemporalRecordAccepted\(_hrTipLagLastAcceptedPreviewEndpoint\)/);
  assert.match(
    engine,
    /_hrTemporalRecordStrokeCanvasUpdate\(\s*_hrTipLagLastDisplayedBodyEndpoint,\s*\)/,
  );
  assert.match(
    engine,
    /_hrTemporalRecordVisible\(_hrTipLagLastDisplayedBodyEndpoint\)/,
  );
});
