const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const engine = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "brush-engine.js"),
  "utf8",
);
const cursorPrefs = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "ui", "cursor-prefs.js"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "style.css"),
  "utf8",
);

test("new GPU strokes retain the preceding overlay without waiting for its authoritative commit", () => {
  assert.match(engine, /presentationBarrier:_hardRoundCommitTail/);
  assert.match(
    engine,
    /preservePriorUntilCommit=.*_hardRoundPendingCommitCount>0/,
  );
  assert.match(engine, /preserve-prior-until-commit/);
  assert.match(
    engine,
    /const gpuLivePreview=!!\(renderer\.isGpuActive&&renderer\.isGpuActive\(\)\)/,
  );
  // The presentation-barrier gate has since evolved across two further
  // intentional fixes (rapid-handoff and AA-none-latency reductions): it
  // now waits on the active context's barrier specifically when GPU live
  // preview is active (previously it was skipped for GPU live preview and
  // applied for canvas preview -- the opposite), and is combined with a
  // second gate (basePresentationGate) that guards against presenting a
  // stale WebGPU base revision. Assert on the current, more precise gate.
  assert.match(
    engine,
    /const presentationBarrier = \(gpuLivePreview && _hardRoundActiveContext\)/,
  );
  assert.match(
    engine,
    /const waitBarrier = basePresentationGate \|\| presentationBarrier/,
  );
  assert.match(
    engine,
    /presentationBarrierDependency:gpuLivePreview\?\(staleBaseRevision!=null\?'gated-stale-base-webgpu':'none-private-gpu-renderer'\):'ordered-canvas-base'/,
  );
  assert.match(
    engine,
    /Promise\.resolve\(waitBarrier\)[\s\S]*?renderer\.peekStroke/,
  );
});

test("authoritative ordering remains tied to the commit tail, not GPU live presentation", () => {
  assert.match(
    engine,
    /const commit=_hardRoundCommitTail\.then\(\(\)=>resolution\)/,
  );
  assert.match(engine, /_hardRoundCommitTail=settled\.catch/);
  const presentStart = engine.indexOf(
    "function _hardRoundPresentLivePreview(renderer)",
  );
  const presentEnd = engine.indexOf("let _hardRoundPreviewRAF", presentStart);
  const liveBody = engine.slice(presentStart, presentEnd);
  assert.doesNotMatch(liveBody, /_hardRoundCommitTail/);
});

test("private GPU preview can run while an older ordered commit remains pending", async () => {
  let releaseCommit;
  const oldCommit = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  const events = [];
  const present = (gpuActive, barrier) =>
    Promise.resolve(gpuActive ? null : barrier).then(() =>
      events.push("preview"),
    );
  const preview = present(true, oldCommit);
  await preview;
  assert.deepEqual(events, ["preview"]);
  let committed = false;
  oldCommit.then(() => {
    committed = true;
  });
  assert.equal(committed, false);
  releaseCommit();
  await oldCommit;
});

test("committed replacement retires only the overlay pixels belonging to that stroke", () => {
  assert.match(engine, /window\.HardRoundOverlayPresentedStrokeId=session/);
  // The outer `HardRoundOverlayPresentedStrokeId===ready.strokeId` gate was
  // intentionally removed: retirement is now always attempted on commit
  // completion (previously it silently no-op'd if that presentation-
  // tracking flag had been reassigned/cleared elsewhere, potentially
  // leaving a stale overlay visible indefinitely). Ownership safety is
  // preserved instead via the isNewerOwner / isNewerNow checks against
  // HardRoundOverlayOwnerStrokeId / HardRoundOverlayVisibilityOwnerStrokeId
  // and the active session, asserted below.
  assert.match(
    engine,
    /isNewerOwner=\(overlayOwner!=null&&overlayOwner!==ready\.strokeId\)\|\|\(visibilityOwner!=null&&visibilityOwner!==ready\.strokeId\)/,
  );
  assert.match(engine, /owned-finalization-retire-committed-overlay/);
  assert.match(engine, /overlayHideSuppressed/);
  assert.match(engine, /older-finalizer-newer-owner/);
  assert.match(
    engine,
    /if\(!visible\)window\.HardRoundOverlayPresentedStrokeId=null/,
  );
});

test("old finalizer preserves continuity when a newer session owns the shared overlay", () => {
  const retireStart = engine.indexOf(
    "function _hardRoundFinalizeOwnedContext(",
  );
  assert.ok(retireStart >= 0, "_hardRoundFinalizeOwnedContext not found");
  const retireEnd = engine.indexOf("\n}\n", retireStart);
  const body = engine.slice(retireStart, retireEnd);
  assert.match(body, /overlayOwner!=null&&overlayOwner!==ready\.strokeId/);
  assert.match(
    body,
    /visibilityOwner!=null&&visibilityOwner!==ready\.strokeId/,
  );
  assert.match(body, /_hrRapidPresentation\('overlayHideSuppressed'/);
  assert.match(
    body,
    /_hardRoundSetGpuOverlayVisible\(false,'owned-finalization-retire-committed-overlay'\)/,
  );

  const retire = (state, finalizingStrokeId) => {
    if (
      (state.owner != null && state.owner !== finalizingStrokeId) ||
      (state.visibilityOwner != null &&
        state.visibilityOwner !== finalizingStrokeId)
    ) {
      state.events.push("overlayHideSuppressed");
      return;
    }
    state.visible = false;
    state.events.push("overlayHidden");
  };
  const overlap = {
    owner: 3,
    visibilityOwner: 3,
    presented: 2,
    visible: true,
    events: [],
  };
  retire(overlap, 2);
  assert.equal(overlap.visible, true);
  assert.deepEqual(overlap.events, ["overlayHideSuppressed"]);
  overlap.presented = 3; // Stroke 3's accepted present atomically supersedes 2.
  assert.equal(overlap.visible, true);
});

test("finalizer may retire its overlay when no newer session owns it", () => {
  const state = { owner: 2, visibilityOwner: 2, presented: 2, visible: true };
  if (
    state.presented === 2 &&
    !(
      (state.owner != null && state.owner !== 2) ||
      (state.visibilityOwner != null && state.visibilityOwner !== 2)
    )
  )
    state.visible = false;
  assert.equal(state.visible, false);
});

test("RAF callbacks and async completions own immutable session tokens", () => {
  assert.match(engine, /const scheduledSession=_activeStrokeSession/);
  assert.match(
    engine,
    /if\(scheduledSession!==_activeStrokeSession\|\|!_inStroke\)return/,
  );
  assert.match(engine, /const flightToken=\{sessionId:session,renderer\}/);
  assert.match(
    engine,
    /if\(_hardRoundPreviewInFlightToken!==flightToken\)return/,
  );
  assert.match(
    engine,
    /if\(!immediate&&_hardRoundPreviewRAFSession===_activeStrokeSession\)return/,
  );
});

test("a stale queued RAF is replaced rather than consuming the next stroke request", () => {
  assert.match(
    engine,
    /cancelAnimationFrame\(_hardRoundPreviewRAF\);\s*_hardRoundPreviewRAF=null;\s*_hardRoundPreviewRAFSession=null/,
  );
});

test("normal brush native cursor remains hidden and GPU overlay cannot become hit target", () => {
  assert.match(
    cursorPrefs,
    /if\(paintTool&&\(cursorStyle==='crosshair'[\s\S]*?return 'none'/,
  );
  // Same selector-grouping change as elsewhere: #hard-round-gpu-overlay's
  // pointer-events/z-index rule is now shared with #custom-tip-gpu-overlay
  // rather than standalone; the declared properties are unchanged.
  assert.match(
    css,
    /#hard-round-gpu-overlay[^{]*\{[^}]*pointer-events:none;[^}]*z-index:1;[^}]*\}/,
  );
  assert.doesNotMatch(
    engine,
    /hard-round-gpu-overlay[^\n]*pointerEvents\s*=\s*['"]auto/,
  );
});

test("adversarial old completion cannot clear a newer flight token", async () => {
  let currentToken = null,
    inFlight = false;
  let releaseOld;
  const old = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const finish = (token, promise) =>
    promise.finally(() => {
      if (currentToken !== token) return;
      inFlight = false;
      currentToken = null;
    });
  const oldToken = { sessionId: 1 };
  currentToken = oldToken;
  inFlight = true;
  const oldDone = finish(oldToken, old);
  const newToken = { sessionId: 2 };
  currentToken = newToken;
  inFlight = true;
  releaseOld();
  await oldDone;
  assert.equal(currentToken, newToken);
  assert.equal(inFlight, true);
});
