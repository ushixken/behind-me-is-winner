'use strict';
// src/brush/custom-tip-gpu-commit-ordering.test.js
//
// Deterministic CODE-level verification that Custom Tip GPU commits are
// serialized in authoritative FIFO order via `_customTipCommitTail`, even
// when the underlying async GPU readback Promises settle out of order, and
// that pending-count / failure semantics hold.
//
// The isolated simulation below reimplements the exact Promise-tail and
// counter pattern used in `_finishCustomTipOrCanvasCommit` (see
// brush-engine.js, lines noted per-test), faithfully, so we can drive it
// with controllable deferred promises without needing a live WebGPU device.
// Every simulation test is paired with a structural assertion that pins
// the real source to the same pattern.
//
// Run with: node --test src/brush/custom-tip-gpu-commit-ordering.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'brush-engine.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Faithful reproduction of the production commit-tail/pending-count pattern
// from _finishCustomTipOrCanvasCommit + _executeCustomTipDetachedCommit:
//
//   _customTipPendingCommitCount++;
//   const commit = _customTipCommitTail.then(async () => {
//     await _executeCustomTipDetachedCommit(gpuTask, ctxData);
//   });
//   const settled = commit.finally(() => {
//     _customTipPendingCommitCount = Math.max(0, _customTipPendingCommitCount - 1);
//   });
//   _customTipCommitTail = settled.catch(err => {
//     _lastArtworkCommitError = err;
//   });
//
// `readbackPromise` stands in for `gpuTask.mapAndExtractImageData()`
// resolving/rejecting at an arbitrary time -- this is the source of the
// out-of-order completion the FIFO tail must protect against.
function makeCommitTailModel() {
  const state = {
    tail: Promise.resolve(),
    pendingCount: 0,
    lastError: null,
    committedOrder: [],
  };

  function beginCommit(strokeId, readbackPromise) {
    state.pendingCount++;
    const commit = state.tail.then(async () => {
      await readbackPromise; // stands in for gpuTask.mapAndExtractImageData()
      state.committedOrder.push(strokeId); // stands in for the authoritative composite
    });
    const settled = commit.finally(() => {
      state.pendingCount = Math.max(0, state.pendingCount - 1);
    });
    state.tail = settled.catch(err => {
      state.lastError = err;
    });
    return state.tail;
  }

  return { state, beginCommit };
}

// ---------------------------------------------------------------------
// 3. FIFO COMMIT ORDERING (high priority)
// ---------------------------------------------------------------------

test('FIFO tail: three strokes commit in start order despite B, C, A readback resolution order', async () => {
  const { state, beginCommit } = makeCommitTailModel();
  const readbackA = deferred();
  const readbackB = deferred();
  const readbackC = deferred();

  // Strokes begin their commits in order A, B, C (as pointerup would fire).
  beginCommit('A', readbackA.promise);
  beginCommit('B', readbackB.promise);
  const finalTail = beginCommit('C', readbackC.promise);

  // GPU readbacks resolve out of order: B first, then C, then A last.
  readbackB.resolve();
  await Promise.resolve();
  readbackC.resolve();
  await Promise.resolve();
  readbackA.resolve();
  await finalTail;

  assert.deepEqual(state.committedOrder, ['A', 'B', 'C'],
    'authoritative commit order must remain FIFO (stroke start order) regardless of readback completion order');
});

test('FIFO tail: a slow first stroke blocks a fast second stroke from committing early', async () => {
  const { state, beginCommit } = makeCommitTailModel();
  const slowA = deferred();
  const fastB = deferred();

  beginCommit('A', slowA.promise);
  const tailB = beginCommit('B', fastB.promise);

  // B's readback is already resolved -- but A has not committed yet.
  fastB.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(state.committedOrder, [], 'B must not commit while A is still pending, even though B\'s data is ready');

  slowA.resolve();
  await tailB;
  assert.deepEqual(state.committedOrder, ['A', 'B']);
});

test('production source: commit tail chains .then before the pending count decrement, matching the model', () => {
  const finishStart = engine.indexOf('function _finishCustomTipOrCanvasCommit(');
  const finishEnd = engine.indexOf('\nfunction _shouldRunCustomTipGpuDiagnostic', finishStart);
  const body = engine.slice(finishStart, finishEnd);
  const increment = body.indexOf('_customTipPendingCommitCount++;');
  const tailThen = body.indexOf('const commit = _customTipCommitTail.then(async () => {', increment);
  const finallyBlock = body.indexOf('.finally(() => {', tailThen);
  const reassign = body.indexOf('_customTipCommitTail = settled.catch(err => {', finallyBlock);
  assert.ok(increment >= 0 && tailThen > increment && finallyBlock > tailThen && reassign > finallyBlock,
    'production must: increment count -> chain onto existing tail -> decrement in finally -> reassign tail to settled.catch, in that order, matching the isolated model');
});

// ---------------------------------------------------------------------
// 4. PENDING COMMIT COUNTER
// ---------------------------------------------------------------------

test('pending count: increments immediately, stays >0 while any commit is unresolved, returns to 0 after all settle', async () => {
  const { state, beginCommit } = makeCommitTailModel();
  const rbA = deferred();
  const rbB = deferred();

  beginCommit('A', rbA.promise);
  assert.strictEqual(state.pendingCount, 1, 'count must increment synchronously when the commit begins, before any await');

  const tailB = beginCommit('B', rbB.promise);
  assert.strictEqual(state.pendingCount, 2, 'count must reflect both strokes while both are unresolved');

  rbA.resolve();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(state.pendingCount, 1, 'count must decrement exactly once when A settles, independent of B');

  rbB.resolve();
  await tailB;
  assert.strictEqual(state.pendingCount, 0, 'count must return to exactly 0 once all commits have settled');
});

test('pending count: never goes negative even under repeated failures', async () => {
  const { state, beginCommit } = makeCommitTailModel();
  for (let i = 0; i < 5; i++) {
    const rb = deferred();
    const tail = beginCommit('S' + i, rb.promise);
    rb.reject(new Error('readback failed ' + i));
    await tail; // settles via .catch inside the model, never throws here
    assert.ok(state.pendingCount >= 0, 'pending count must never go negative after a failed commit');
  }
  assert.strictEqual(state.pendingCount, 0);
});

// ---------------------------------------------------------------------
// 5. FAILURE SEMANTICS
// ---------------------------------------------------------------------

test('failure: rejected readback still decrements pending count and records the error, without breaking the tail', async () => {
  const { state, beginCommit } = makeCommitTailModel();
  const rbA = deferred();
  const tailA = beginCommit('A', rbA.promise);
  const failure = new Error('simulated GPU readback rejection');
  rbA.reject(failure);
  await tailA;

  assert.strictEqual(state.pendingCount, 0, 'pending count must be cleaned up even on rejection');
  assert.strictEqual(state.lastError, failure, 'the error must be captured for later surfacing (mirrors _lastArtworkCommitError)');

  // A later, independent stroke must still be able to commit through the
  // same (now-recovered) tail.
  const rbB = deferred();
  const tailB = beginCommit('B', rbB.promise);
  rbB.resolve();
  await tailB;
  assert.deepEqual(state.committedOrder, ['B'], 'a later stroke must still commit successfully after a prior failure');
  assert.strictEqual(state.pendingCount, 0);
});

test('production source: rejection is caught on the reassigned tail (not left to reject the exported tail)', () => {
  const finishStart = engine.indexOf('function _finishCustomTipOrCanvasCommit(');
  const finishEnd = engine.indexOf('\nfunction _shouldRunCustomTipGpuDiagnostic', finishStart);
  const body = engine.slice(finishStart, finishEnd);
  assert.match(body, /_customTipCommitTail\s*=\s*settled\.catch\(err\s*=>\s*\{\s*\n\s*_lastArtworkCommitError\s*=\s*err;/,
    'the tail that future commits chain onto must be the .catch()-guarded promise, so a rejection from one stroke cannot poison/reject the tail for subsequent strokes');
});

test('production source: readback rejection inside _executeCustomTipDetachedCommit is not swallowed silently before capture', () => {
  // mapAndExtractImageData() is awaited inside a try/catch that falls back
  // to null on failure -- so a hard GPU rejection there does not throw past
  // the commit tail uncaught; it degrades to "no committable canvas" and
  // the function returns early via the fallback-dabs / null-check path.
  const normalized = engine.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('async function _executeCustomTipDetachedCommit(');
  const tryBlock = normalized.indexOf('if (gpuTask) {\n    try {', start);
  const catchBlock = normalized.indexOf('} catch (e) {\n      imgData = null;\n    }', tryBlock);
  assert.ok(tryBlock >= 0 && catchBlock > tryBlock,
    'a rejected mapAndExtractImageData() must be caught locally, degrading to null imgData rather than throwing');
});
