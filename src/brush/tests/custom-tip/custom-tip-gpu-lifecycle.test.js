"use strict";
// src/brush/custom-tip-gpu-lifecycle.test.js
//
// Deterministic CODE-level verification of the Custom Tip GPU pipeline's
// lifecycle: path selection, stroke state transitions, the pending-commit
// counter, per-stroke resource cleanup, and overlay ownership.
//
// This file does NOT simulate a physical stylus, real hardware timing, or
// brush feel. It verifies that the shipped source performs the documented
// operations in the documented order, and (where a guard function is small
// and dependency-free enough) actually executes that production logic
// against controlled fake globals via vm, rather than a fake browser.
//
// Run with: node --test src/brush/custom-tip-gpu-lifecycle.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const engine = fs.readFileSync(
  path.join(__dirname, "..", "..", "brush-engine.js"),
  "utf8",
);
const rendererSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "custom-tip-gpu-renderer.js"),
  "utf8",
);

function extractFunction(source, name) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `could not find function ${name} in source`);
  // Walk braces to find the matching closing brace for this function body.
  const braceOpen = source.indexOf("{", start);
  assert.ok(braceOpen >= 0);
  let depth = 0;
  let i = braceOpen;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `unbalanced braces while extracting ${name}`);
  return source.slice(start, i + 1);
}

// ---------------------------------------------------------------------
// 1. GPU PATH SELECTION -- _customTipGpuEligibleNow()
// ---------------------------------------------------------------------
// This guard's only external dependencies are `window`, `navigator`,
// `tool`, and `_usesBrushPaintPipeline`. That's small and pure enough to
// extract the real source and execute it in a vm sandbox with controlled
// fake globals, rather than only pattern-matching the source text. No
// fake WebGPU device/queue/texture machinery is constructed; the renderer
// itself is a plain object stub exposing exactly the fields the guard reads.

const eligibleFnSource = extractFunction(engine, "_customTipGpuEligibleNow");

function runEligibleNow({
  hasWindow = true,
  hasGpu = true,
  hasResourcesClass = true,
  hasRendererClass = true,
  tipCanvas = { width: 32, height: 32 },
  tool = "brush",
  usesBrushPaintPipeline = true,
  airbrush = false,
  rendererInstance = { deviceLost: false },
} = {}) {
  const sandboxWindow = hasWindow
    ? {
        CustomTipGpuResources: hasResourcesClass ? function () {} : undefined,
        CustomTipGpuRenderer: hasRendererClass ? function () {} : undefined,
        brushTipCanvas: tipCanvas,
        _brushAirbrush: airbrush,
        _customTipGpuRenderer: rendererInstance
          ? { instance: rendererInstance }
          : null,
      }
    : undefined;

  const sandbox = {
    window: sandboxWindow,
    navigator: { gpu: hasGpu ? {} : undefined },
    tool,
    _usesBrushPaintPipeline: () => usesBrushPaintPipeline,
    result: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${eligibleFnSource}\nresult = _customTipGpuEligibleNow();`,
    sandbox,
  );
  return sandbox.result;
}

test("GPU path selection: eligible when Custom Tip + GPU renderer are ready", () => {
  assert.strictEqual(runEligibleNow(), true);
});

test("GPU path selection: falls back to CPU when navigator.gpu is unavailable", () => {
  assert.strictEqual(runEligibleNow({ hasGpu: false }), false);
});

test("GPU path selection: falls back to CPU when Custom Tip GPU classes are missing", () => {
  assert.strictEqual(runEligibleNow({ hasResourcesClass: false }), false);
  assert.strictEqual(runEligibleNow({ hasRendererClass: false }), false);
});

test("GPU path selection: falls back to CPU when there is no Custom Tip set", () => {
  assert.strictEqual(runEligibleNow({ tipCanvas: null }), false);
  assert.strictEqual(
    runEligibleNow({ tipCanvas: { width: 0, height: 0 } }),
    false,
  );
});

test("GPU path selection: falls back to CPU for non-brush tools", () => {
  assert.strictEqual(runEligibleNow({ tool: "eraser" }), false);
  assert.strictEqual(runEligibleNow({ tool: "fill" }), false);
});

test("GPU path selection: falls back to CPU outside the brush paint pipeline", () => {
  assert.strictEqual(runEligibleNow({ usesBrushPaintPipeline: false }), false);
});

test("GPU path selection: falls back to CPU for airbrush", () => {
  assert.strictEqual(runEligibleNow({ airbrush: true }), false);
});

test("GPU path selection: falls back to CPU when no renderer instance exists yet", () => {
  assert.strictEqual(runEligibleNow({ rendererInstance: null }), false);
});

test("GPU path selection: falls back to CPU when the GPU device is lost", () => {
  assert.strictEqual(
    runEligibleNow({ rendererInstance: { deviceLost: true } }),
    false,
  );
});

// ---------------------------------------------------------------------
// 2. STROKE LIFECYCLE STATE -- ordering in the shipped source
// ---------------------------------------------------------------------

test("stroke start: eligibility is (re)computed and beginStroke is called only when active", () => {
  const activeAssign = engine.indexOf(
    "_customTipGpuStrokeActive = _customTipGpuEligibleNow();",
  );
  const beginStrokeGuard = engine.indexOf(
    "if (_customTipGpuStrokeActive) {",
    activeAssign,
  );
  const beginStrokeCall = engine.indexOf(
    "window._customTipGpuRenderer.beginStroke({",
    beginStrokeGuard,
  );
  assert.ok(
    activeAssign >= 0 &&
      beginStrokeGuard > activeAssign &&
      beginStrokeCall > beginStrokeGuard,
    "pointerdown must decide GPU eligibility before calling beginStroke, and beginStroke must be gated by that flag",
  );
});

test("live dabs: _queueDab buffers fallback dabs while active instead of drawing to CPU canvas", () => {
  const queueDabStart = engine.indexOf("function _queueDab(d){");
  const queueDabEnd = engine.indexOf(
    "\nfunction _flushStrokeTail",
    queueDabStart,
  );
  const body = engine.slice(queueDabStart, queueDabEnd);
  assert.match(
    body,
    /if\s*\(\s*_customTipGpuStrokeActive\s*\)\s*\{\s*\n\s*_customTipGpuFallbackDabs\.push/,
    "while a Custom Tip GPU stroke is active, dabs must be buffered, not rasterized to the CPU stroke canvas",
  );
  assert.match(
    body,
    /\}\s*else\s*\{\s*\n\s*_drawDabNow\(d\);/,
    "the CPU raster path (_drawDabNow) must only run in the else branch, i.e. when the GPU path is not active",
  );
});

test("finish: captureFinishingTask happens before the stroke is marked inactive", () => {
  const finishStart = engine.indexOf(
    "function _finishCustomTipOrCanvasCommit(",
  );
  const captureCall = engine.indexOf(
    "captureFinishingTask({ paperResource });",
    finishStart,
  );
  const deactivate = engine.indexOf(
    "_customTipGpuStrokeActive = false;",
    finishStart,
  );
  assert.ok(
    finishStart >= 0 && captureCall > finishStart && deactivate > captureCall,
    "the finishing GPU task must be captured from the live renderer before the stroke flag flips to inactive, otherwise the wrong (already-reset) renderer state could be captured",
  );
});

test("finish: pending-commit count increments before the commit tail is chained", () => {
  const finishStart = engine.indexOf(
    "function _finishCustomTipOrCanvasCommit(",
  );
  const increment = engine.indexOf(
    "_customTipPendingCommitCount++;",
    finishStart,
  );
  const tailChain = engine.indexOf(
    "_customTipCommitTail = settled.catch",
    finishStart,
  );
  assert.ok(
    increment >= 0 && tailChain > increment,
    'the pending counter must be incremented before the tail promise is reassigned, so any concurrent awaitPendingBrushCommits() poll never observes a false "nothing pending" state',
  );
});

test("authoritative commit: readback -> undo -> composite -> save -> recomposite -> destroy -> retire overlay", () => {
  const commitStart = engine.indexOf(
    "async function _executeCustomTipDetachedCommit(",
  );
  const commitEnd = engine.indexOf(
    "\nfunction _finishCustomTipOrCanvasCommit",
    commitStart,
  );
  const body = engine.slice(commitStart, commitEnd);

  const readback = body.indexOf("await gpuTask.mapAndExtractImageData();");
  const undo = body.indexOf("pushUndoAt(ownerLayer, ownerFrame);");
  const composite = body.indexOf(
    "destCtx.drawImage(finalSource, drawX, drawY);",
  );
  const save = body.indexOf("_saveExplicitFrameToKey(ownerLayer, ownerFrame);");
  const recomposite = body.indexOf("_scheduleRecomposite();");
  const destroy = body.indexOf("gpuTask.destroy();", recomposite);
  const retire = body.indexOf("_retireCustomTipOverlay(sessionId);", destroy);

  assert.ok(readback >= 0, "must read back GPU result");
  assert.ok(
    undo > readback,
    "undo snapshot must be pushed after the GPU readback resolves, against pre-commit artwork",
  );
  assert.ok(
    composite > undo,
    "artwork must be composited only after the undo snapshot exists",
  );
  assert.ok(save > composite, "keyframe must be saved only after compositing");
  assert.ok(
    recomposite > save,
    "recomposite must be scheduled after the keyframe save",
  );
  assert.ok(
    destroy > recomposite,
    "the per-stroke GPU task must be destroyed after it has been fully consumed",
  );
  assert.ok(
    retire > destroy,
    "the overlay must only be retired after the task is destroyed and artwork committed",
  );
});

// ---------------------------------------------------------------------
// 4 (partial). PENDING COMMIT COUNTER -- structural guarantees
// ---------------------------------------------------------------------

test("pending count: decremented exactly once, inside .finally(), and clamped at 0", () => {
  const finishStart = engine.indexOf(
    "function _finishCustomTipOrCanvasCommit(",
  );
  const finishEnd = engine.indexOf(
    "\nfunction _shouldRunCustomTipGpuDiagnostic",
    finishStart,
  );
  const body = engine.slice(finishStart, finishEnd);
  const decrements =
    body.match(
      /_customTipPendingCommitCount\s*=\s*Math\.max\(0,\s*_customTipPendingCommitCount\s*-\s*1\)/g,
    ) || [];
  assert.strictEqual(
    decrements.length,
    1,
    "expected exactly one decrement site in the finishing function",
  );
  assert.match(
    body,
    /\.finally\(\(\)\s*=>\s*\{\s*\n\s*_customTipPendingCommitCount\s*=\s*Math\.max\(0,/,
    "the decrement must run inside .finally() so it happens on both success and rejection",
  );
});

// ---------------------------------------------------------------------
// 12. RESOURCE CLEANUP -- per-stroke vs intentionally cached
// ---------------------------------------------------------------------

test("per-stroke GPU task: readBuffer destroy is idempotent and guarded by a destroyed flag", () => {
  const taskStart = rendererSource.indexOf("const task = {");
  const taskEnd = rendererSource.indexOf("\n      return task;", taskStart);
  const body = rendererSource.slice(taskStart, taskEnd);
  assert.match(
    body,
    /destroyed:\s*false,/,
    "task must start with an explicit not-destroyed flag",
  );
  assert.match(
    body,
    /if\s*\(this\.destroyed\s*\|\|\s*!this\.readBuffer\)\s*return null;/,
    "mapAndExtractImageData must refuse to run twice against an already-destroyed/consumed buffer",
  );
  assert.match(
    body,
    /destroy\(\)\s*\{\s*\n\s*if\s*\(!this\.destroyed\s*&&\s*this\.readBuffer\)\s*\{/,
    "destroy() must be idempotent: safe to call even if mapAndExtractImageData already destroyed the buffer",
  );
});

test("cleanup distinguishes per-stroke destruction from intentionally cached/reusable GPU resources", () => {
  // Per-stroke: the finishing task's readBuffer must be destroyed once consumed.
  assert.match(
    rendererSource,
    /this\.readBuffer\.destroy\(\);\s*\n\s*this\.destroyed\s*=\s*true;/,
  );
  // Intentionally cached: shared paper texture / sampler resources are looked
  // up and reused across strokes via CustomTipGpuResources, never destroyed
  // inline in the per-stroke finishing path.
  const finishStart = engine.indexOf(
    "function _finishCustomTipOrCanvasCommit(",
  );
  const finishEnd = engine.indexOf(
    "\nfunction _shouldRunCustomTipGpuDiagnostic",
    finishStart,
  );
  const finishBody = engine.slice(finishStart, finishEnd);
  assert.match(
    finishBody,
    /mgr\.cachedPaperTexture/,
    "the finishing path must read the cached paper texture rather than recreating it",
  );
  assert.doesNotMatch(
    finishBody,
    /cachedPaperTexture\.destroy\(\)/,
    "the finishing path must not destroy the shared cached paper texture",
  );
});

// ---------------------------------------------------------------------
// 11. OVERLAY OWNERSHIP -- _retireCustomTipOverlay()
// ---------------------------------------------------------------------

test("overlay retirement checks ownership both at call time and again after the commit-revision wait", () => {
  const start = engine.indexOf("function _retireCustomTipOverlay(strokeId) {");
  const end = engine.indexOf(
    "\nasync function _executeCustomTipDetachedCommit",
    start,
  );
  const body = engine.slice(start, end);
  const earlyGuard = body.indexOf(
    "const isNewerOwner = (overlayOwner != null && overlayOwner !== strokeId);",
  );
  const earlyReturn = body.indexOf("if (isNewerOwner) {", earlyGuard);
  const lateGuard = body.indexOf("const isNewerNow =", earlyReturn);
  const lateReturn = body.indexOf("if (isNewerNow) {", lateGuard);
  const hideCall = body.indexOf("hideLiveOverlay(strokeId);", lateReturn);
  assert.ok(
    earlyGuard >= 0 && earlyReturn > earlyGuard,
    "must bail out early if a newer stroke already owns the overlay",
  );
  assert.ok(
    lateGuard > earlyReturn && lateReturn > lateGuard && hideCall > lateReturn,
    "ownership must be re-checked again just before hiding, since ownership can change while awaiting the revision-presented callback",
  );
  // The re-check considers both the recorded overlay owner AND the live
  // active-stroke session, so a GPU stroke that started after retirement was
  // scheduled (but before it ran) is still correctly treated as "newer".
  const lateCheckBody = body.slice(lateGuard, lateReturn);
  assert.match(lateCheckBody, /ownerNow/);
  assert.match(lateCheckBody, /activeNow/);
  // ownerNow/activeNow are re-read from window/_activeStrokeSession state
  // immediately before the late check, not cached from the early check.
  const ownerNowAssign = body.indexOf(
    "const ownerNow = window.CustomTipOverlayOwnerStrokeId;",
  );
  const activeNowAssign = body.indexOf(
    "const activeNow = _activeStrokeSession;",
  );
  assert.ok(
    ownerNowAssign >= 0 && ownerNowAssign < lateGuard,
    "ownerNow must be freshly re-read from window state inside the retire() closure, not reused from the earlier snapshot",
  );
  assert.ok(
    activeNowAssign >= 0 && activeNowAssign < lateGuard,
    "activeNow must be freshly re-read from _activeStrokeSession inside the retire() closure",
  );
});

test("overlay ownership predicate: isolated simulation matches the production guard", () => {
  // Faithful extraction of the two-owner-source boolean from
  // _retireCustomTipOverlay's `retire` inner closure (see source above),
  // exercised in isolation with controlled inputs instead of a live overlay.
  function isNewerOwner(
    strokeId,
    overlayOwner,
    gpuStrokeActive,
    activeStrokeSession,
  ) {
    return (
      (overlayOwner != null && overlayOwner !== strokeId) ||
      (gpuStrokeActive &&
        activeStrokeSession != null &&
        activeStrokeSession !== strokeId)
    );
  }

  // Stroke A finishing after B has become the current owner: A must not
  // clear/hide B's overlay.
  assert.strictEqual(
    isNewerOwner("A", "B", false, null),
    true,
    "A must be treated as stale once B owns the overlay",
  );
  // Stroke A finishing while it is still the recognized owner: allowed to retire.
  assert.strictEqual(isNewerOwner("A", "A", false, null), false);
  // No explicit overlay owner recorded yet, but a newer GPU stroke session
  // (B) is already active: A must still be treated as stale.
  assert.strictEqual(isNewerOwner("A", null, true, "B"), true);
  // No newer owner and no newer active session: retire proceeds normally.
  assert.strictEqual(isNewerOwner("A", null, true, "A"), false);
  assert.strictEqual(isNewerOwner("A", null, false, null), false);
});

test("overlay retirement is deferred until the committed revision has actually presented, when tracked", () => {
  const start = engine.indexOf("function _retireCustomTipOverlay(strokeId) {");
  const end = engine.indexOf(
    "\nasync function _executeCustomTipDetachedCommit",
    start,
  );
  const body = engine.slice(start, end);
  assert.match(
    body,
    /whenRevisionPresented\(committedRevision, retire\)/,
    "when a WebGPU display backend revision is tracked, retirement must wait for that revision to actually present before hiding the overlay, to avoid a visible flash/gap",
  );
  assert.match(
    body,
    /\}\s*else\s*\{\s*\n\s*retire\(\);\s*\n\s*\}/,
    "when no revision tracking is available, retirement must still run synchronously as a fallback",
  );
});
