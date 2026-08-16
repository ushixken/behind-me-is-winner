'use strict';
// src/brush/custom-tip-gpu-barriers.test.js
//
// Deterministic CODE-level verification of the commit barrier and its
// consumers: window.awaitPendingBrushCommits(), the deferred-pointerdown
// input queue, the Eraser ordering invariant, Clear Frame ordering, and
// undo-snapshot ordering relative to a pending Custom Tip GPU commit.
//
// No jsdom, no fake physical stylus/flick timing. Event-order verification
// only, using source-text structural assertions (mirroring the existing
// hard-round-session-finalization.test.js convention) plus small isolated
// simulations of the queue-replay and polling-loop logic.
//
// Run with: node --test src/brush/custom-tip-gpu-barriers.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'brush-engine.js'), 'utf8');
const layersSource = fs.readFileSync(path.join(__dirname, '../../../core/layers.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------
// 6. awaitPendingBrushCommits()
// ---------------------------------------------------------------------

test('production source: awaitPendingBrushCommits awaits BOTH Hard Round and Custom Tip tails', () => {
  const start = engine.indexOf('window.awaitPendingBrushCommits=async function(){');
  const end = engine.indexOf('\ndocument.addEventListener(\'visibilitychange\'', start);
  const body = engine.slice(start, end);
  assert.match(body, /tails\.push\(_hardRoundCommitTail\)/);
  assert.match(body, /tails\.push\(_customTipCommitTail\)/);
  assert.match(body, /await Promise\.all\(tails\)/);
  assert.match(body, /pendingHardRound=typeof _hardRoundPendingCommitCount/);
  assert.match(body, /pendingCustomTip=typeof _customTipPendingCommitCount/);
  assert.match(body, /if\(!pendingHardRound&&!pendingCustomTip\)\{\s*\n\s*break;/,
    'the wait loop must only exit once BOTH pending counts are 0, not either one');
});

test('production source: awaitPendingBrushCommits surfaces a stored commit error instead of resolving silently', () => {
  const start = engine.indexOf('window.awaitPendingBrushCommits=async function(){');
  const end = engine.indexOf('\ndocument.addEventListener(\'visibilitychange\'', start);
  const body = engine.slice(start, end);
  const breakIdx = body.indexOf('break;');
  const errorCheck = body.indexOf('if(_lastArtworkCommitError){', breakIdx);
  const throwIdx = body.indexOf('throw new Error(', errorCheck);
  assert.ok(breakIdx >= 0 && errorCheck > breakIdx && throwIdx > errorCheck,
    'the stored error must be checked and thrown after the wait loop exits, not swallowed');
  assert.match(body, /const err=_lastArtworkCommitError;\s*\n\s*_lastArtworkCommitError=null;\s*\n\s*throw new Error\(/,
    'the error field must be cleared as it is consumed (before throwing), so a single failure is not re-thrown forever on subsequent calls');
});

test('isolated model: waiting resolves once both counts are 0, and re-loops if a new commit starts mid-wait', async () => {
  // Faithful reproduction of the while(true){ await Promise.all(tails); if(!pending) break; } loop.
  const model = {
    hardRoundTail: Promise.resolve(),
    customTipTail: Promise.resolve(),
    hardRoundPending: 0,
    customTipPending: 0,
  };
  async function awaitPendingBrushCommits() {
    while (true) {
      await Promise.all([model.hardRoundTail, model.customTipTail]);
      if (!(model.hardRoundPending > 0) && !(model.customTipPending > 0)) break;
    }
  }

  const rb = deferred();
  model.customTipPending = 1;
  model.customTipTail = rb.promise.then(() => { model.customTipPending = 0; });

  let resolved = false;
  const waiter = awaitPendingBrushCommits().then(() => { resolved = true; });
  await Promise.resolve();
  assert.strictEqual(resolved, false, 'must not resolve while the Custom Tip GPU commit is still pending');

  rb.resolve();
  await waiter;
  assert.strictEqual(resolved, true, 'must resolve once the pending Custom Tip GPU commit settles');
});

test('isolated model: waits for both Hard Round and Custom Tip pending commits when both exist', async () => {
  const model = { hardRoundTail: Promise.resolve(), customTipTail: Promise.resolve(), hardRoundPending: 0, customTipPending: 0 };
  async function awaitPendingBrushCommits() {
    while (true) {
      await Promise.all([model.hardRoundTail, model.customTipTail]);
      if (!(model.hardRoundPending > 0) && !(model.customTipPending > 0)) break;
    }
  }
  const rbHR = deferred();
  const rbCT = deferred();
  model.hardRoundPending = 1;
  model.customTipPending = 1;
  model.hardRoundTail = rbHR.promise.then(() => { model.hardRoundPending = 0; });
  model.customTipTail = rbCT.promise.then(() => { model.customTipPending = 0; });

  let resolved = false;
  const waiter = awaitPendingBrushCommits().then(() => { resolved = true; });

  rbCT.resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(resolved, false, 'must not resolve with only the Custom Tip commit settled while Hard Round is still pending');

  rbHR.resolve();
  await waiter;
  assert.strictEqual(resolved, true);
});

// ---------------------------------------------------------------------
// 7. DEFERRED POINTERDOWN BARRIER / 9. ERASER ORDERING
// ---------------------------------------------------------------------

test('production source: _brushPointerDown checks _hasPendingBrushCommits before pushUndo and stroke init, for ANY tool (including eraser)', () => {
  const start = engine.indexOf('function _brushPointerDown(e){');
  const end = engine.indexOf('\nfunction _endStroke', start);
  const body = engine.slice(start, end);

  const toolGate = body.indexOf("if(tool!=='brush'&&tool!=='eraser'&&tool!=='fill'&&tool!=='line'&&tool!=='curve') return;");
  const barrierCheck = body.indexOf('if(_hasPendingBrushCommits()){', toolGate);
  const deferCall = body.indexOf('_deferBrushPointerDown(e);', barrierCheck);
  const pushUndoCall = body.indexOf('if(!_hardRoundStrokeActive&&!_customTipGpuStrokeActive)pushUndo();', barrierCheck);

  assert.ok(toolGate >= 0, 'tool gate must exist and does not exclude eraser -- the barrier below therefore applies to eraser strokes too');
  assert.ok(barrierCheck > toolGate, 'the pending-commit barrier check must come after the tool gate, so it applies uniformly regardless of which paint tool is starting');
  assert.ok(deferCall > barrierCheck && deferCall < pushUndoCall,
    'when commits are pending, the stroke must be deferred BEFORE pushUndo/destructive init runs -- this is the exact invariant that protects Eraser from racing a pending Custom Tip commit');
  assert.match(body.slice(barrierCheck, deferCall + 60), /return;/,
    'after deferring, _brushPointerDown must return immediately without falling through to stroke initialization');
});

test('production source: _hasPendingBrushCommits reflects Custom Tip GPU pending count (not just Hard Round)', () => {
  const start = engine.indexOf('function _hasPendingBrushCommits(){');
  const end = engine.indexOf('\nfunction _clonePointerEvent', start);
  const body = engine.slice(start, end);
  assert.match(body, /pendingCustomTip = typeof _customTipPendingCommitCount === 'number' && _customTipPendingCommitCount > 0/);
  assert.match(body, /return pendingHardRound \|\| pendingCustomTip;/);
});

test('production source: deferred stroke initialization waits on awaitPendingBrushCommits before running pointerdown', () => {
  const start = engine.indexOf('function _deferBrushPointerDown(e){');
  const end = engine.indexOf('\nfunction _brushPointerDown(e){', start);
  const body = engine.slice(start, end);
  const waitCall = body.indexOf('window.awaitPendingBrushCommits().then(');
  const pointerDownCall = body.indexOf('_brushPointerDown(deferred.downEvent);', waitCall);
  assert.ok(waitCall >= 0 && pointerDownCall > waitCall,
    'the deferred pointerdown must not fire _brushPointerDown until the barrier promise (which drains _customTipCommitTail) resolves');
});

// ---------------------------------------------------------------------
// 8. DEFERRED MOVE / UP QUEUE
// ---------------------------------------------------------------------

test('production source: matching moves are queued (not dropped) while a pointerdown is deferred', () => {
  const start = engine.indexOf('function _handleMoveEvent(e){');
  const firstLines = engine.slice(start, start + 300);
  assert.match(firstLines, /if\(_pendingDeferredStroke && e\.pointerId === _pendingDeferredStroke\.pointerId\)\{\s*\n\s*_pendingDeferredStroke\.queuedMoves\.push\(_clonePointerEvent\(e\)\);\s*\n\s*return;/,
    'matching pointer moves must be cloned and appended to queuedMoves, then return early without touching live stroke state');
});

test('production source: a pointerup for the deferred pointer is stored, not processed immediately', () => {
  const start = engine.indexOf('function _pointerEndStroke(e){');
  const firstLines = engine.slice(start, start + 300);
  assert.match(firstLines, /if\(_pendingDeferredStroke && e\.pointerId === _pendingDeferredStroke\.pointerId\)\{\s*\n\s*_pendingDeferredStroke\.upEvent = _clonePointerEvent\(e\);\s*\n\s*return;/,
    'pointerup must be captured as deferred.upEvent and the function must return early, deferring stroke-finish logic until after the barrier');
});

test('production source: replay order is downEvent -> queuedMoves in order -> upEvent, then deferred state is cleared', () => {
  const start = engine.indexOf('function _deferBrushPointerDown(e){');
  const end = engine.indexOf('\nfunction _brushPointerDown(e){', start);
  const body = engine.slice(start, end);

  const clearBeforeReplay = body.indexOf('_pendingDeferredStroke = null;');
  const downCall = body.indexOf('_brushPointerDown(deferred.downEvent);', clearBeforeReplay);
  const forLoop = body.indexOf('for (const mv of deferred.queuedMoves) {', downCall);
  const moveHandle = body.indexOf('_handleMoveEvent(mv);', forLoop);
  const upCheck = body.indexOf('if (deferred.upEvent && !deferred.cancelled) {', moveHandle);
  const upCall = body.indexOf('_pointerEndStroke(deferred.upEvent);', upCheck);

  assert.ok(clearBeforeReplay >= 0 && downCall > clearBeforeReplay,
    '_pendingDeferredStroke must be cleared to null before replaying, so nested/queued events during replay are not re-captured into the same deferred object');
  assert.ok(forLoop > downCall, 'the down event must replay before any queued moves');
  assert.ok(moveHandle > forLoop, 'each queued move must be replayed through the normal _handleMoveEvent, preserving array (chronological) order since queuedMoves is a plain push-ordered array');
  assert.ok(upCheck > moveHandle, 'the stored pointerup must only run after all queued moves have replayed');
  assert.ok(upCall > upCheck);
});

test('production source: a cancelled deferred stroke is not replayed, and queued-move replay checks cancellation per-iteration', () => {
  const start = engine.indexOf('function _deferBrushPointerDown(e){');
  const end = engine.indexOf('\nfunction _brushPointerDown(e){', start);
  const body = engine.slice(start, end);
  assert.match(body, /if \(_pendingDeferredStroke !== deferred \|\| deferred\.cancelled\) return;/,
    'if the deferred stroke was cancelled (or superseded) before the barrier resolved, replay must be skipped entirely');
  assert.match(body, /for \(const mv of deferred\.queuedMoves\) \{\s*\n\s*if \(deferred\.cancelled\) break;/,
    'cancellation during replay (e.g. a lostpointercapture firing mid-loop) must stop further move replay');
});

test('production source: pointercancel and lostpointercapture clear deferred state safely', () => {
  const cancelStart = engine.indexOf("activeC.addEventListener('pointercancel'");
  const cancelEnd = engine.indexOf("activeC.addEventListener('lostpointercapture'", cancelStart);
  const cancelBody = engine.slice(cancelStart, cancelEnd);
  assert.match(cancelBody, /_pendingDeferredStroke\.cancelled = true;\s*\n\s*_pendingDeferredStroke = null;/,
    'pointercancel must mark the deferred stroke cancelled AND clear the module-level reference, so a late-resolving barrier promise sees deferred.cancelled=true and _pendingDeferredStroke !== deferred');

  const lostStart = cancelEnd;
  const lostEnd = engine.indexOf('\n\nwindow.CustomBrushAnalyzeResolvedDabs', lostStart);
  const lostBody = engine.slice(lostStart, lostEnd);
  assert.match(lostBody, /_pendingDeferredStroke\.cancelled = true;\s*\n\s*_pendingDeferredStroke = null;/,
    'lostpointercapture must clear deferred state the same way as pointercancel');
});

test('isolated model: queued moves replay in chronological (push) order, then the stored pointerup runs last', () => {
  const events = [];
  const deferredStroke = { queuedMoves: [], upEvent: null, cancelled: false };

  // Simulate: down deferred, then moves m1,m2,m3 arrive in order, then up.
  deferredStroke.queuedMoves.push('m1');
  deferredStroke.queuedMoves.push('m2');
  deferredStroke.queuedMoves.push('m3');
  deferredStroke.upEvent = 'up';

  // Replay, mirroring the production loop shape.
  events.push('down');
  for (const mv of deferredStroke.queuedMoves) {
    if (deferredStroke.cancelled) break;
    events.push(mv);
  }
  if (deferredStroke.upEvent && !deferredStroke.cancelled) {
    events.push(deferredStroke.upEvent);
  }

  assert.deepEqual(events, ['down', 'm1', 'm2', 'm3', 'up']);
});

// ---------------------------------------------------------------------
// 10. CLEAR FRAME ORDERING
// ---------------------------------------------------------------------

test('production source: clearCurrentFrame finishes active drawing, awaits the barrier, THEN pushes undo / clears / saves / recomposites', () => {
  const start = layersSource.indexOf('async function clearCurrentFrame(){');
  const end = layersSource.indexOf('\ndocument.getElementById(\'dd-clear\')', start);
  const body = layersSource.slice(start, end);

  const finish = body.indexOf('finishActiveDrawingBeforeArtworkChange');
  const await1 = body.indexOf('await window.awaitPendingBrushCommits();');
  const pushUndo = body.indexOf('pushUndo();');
  const clear = body.indexOf('ctx.clearRect(');
  const save = body.indexOf('saveActiveToKey();');
  const recomp = body.indexOf('recomposite(');

  assert.ok(finish >= 0 && await1 > finish, 'must finish any active in-progress drawing before awaiting the commit barrier');
  assert.ok(pushUndo > await1, 'undo snapshot must not be pushed until the barrier (which drains a pending Custom Tip GPU commit) has resolved');
  assert.ok(clear > pushUndo, 'clear must happen only after the undo snapshot exists');
  assert.ok(save > clear, 'save must happen only after clearing');
  assert.ok(recomp > save, 'recomposite must be the final step');

  assert.match(body, /await window\.awaitPendingBrushCommits\(\);/,
    'clearCurrentFrame must use the same public barrier that drains _customTipCommitTail, so it cannot clear stale artwork and then receive a late Custom Tip commit');
});

// ---------------------------------------------------------------------
// 13. UNDO SNAPSHOT ORDERING
// ---------------------------------------------------------------------

test('production source: a pending Custom Tip commit\'s own undo snapshot is pushed before ITS composite, inside the barrier-drained tail', () => {
  const start = engine.indexOf('async function _executeCustomTipDetachedCommit(');
  const end = engine.indexOf('\nfunction _finishCustomTipOrCanvasCommit', start);
  const body = engine.slice(start, end);
  const undo = body.indexOf('pushUndoAt(ownerLayer, ownerFrame);');
  const composite = body.indexOf('destCtx.drawImage(finalSource, drawX, drawY);');
  assert.ok(undo >= 0 && composite > undo,
    'the Custom Tip stroke\'s own undo snapshot must exist before its result is composited onto authoritative artwork');
});

test('isolated model: a subsequent destructive action\'s undo snapshot cannot begin until the barrier (and thus the prior Custom Tip commit) has resolved', async () => {
  // Mirrors: Custom Tip GPU stroke B pending -> new destructive stroke (Eraser)
  // begins -> _hasPendingBrushCommits() true -> deferred -> awaitPendingBrushCommits()
  // resolves only after B's authoritative commit (including its own pushUndoAt)
  // has run -> THEN the eraser's pushUndo/init proceeds.
  const order = [];
  let customTipPending = 1;
  const readback = deferred();
  const customTipTail = readback.promise.then(() => {
    order.push('customTip-pushUndoAt');
    order.push('customTip-composite');
    customTipPending = 0;
  });

  function hasPendingBrushCommits() { return customTipPending > 0; }
  async function awaitPendingBrushCommits() {
    while (true) {
      await customTipTail;
      if (!hasPendingBrushCommits()) break;
    }
  }

  async function eraserPointerDown() {
    if (hasPendingBrushCommits()) {
      await awaitPendingBrushCommits();
    }
    order.push('eraser-pushUndo');
    order.push('eraser-init');
  }

  const eraserDone = eraserPointerDown();
  // The Custom Tip commit resolves after the eraser attempt has already deferred.
  await Promise.resolve();
  readback.resolve();
  await eraserDone;

  assert.deepEqual(order, ['customTip-pushUndoAt', 'customTip-composite', 'eraser-pushUndo', 'eraser-init'],
    'must NOT be [eraser-pushUndo, eraser-init, customTip-pushUndoAt, customTip-composite] -- that ordering would mean the eraser undo snapshot excludes the completed Custom Tip stroke');
});
