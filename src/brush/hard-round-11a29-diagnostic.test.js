// src/brush/hard-round-11a29-diagnostic.test.js
//
// Phase 11A.29 — dependency-free tests for the pointerup skip-flush
// diagnostic switch added to brush-engine.js's _pointerEndStroke hard-round
// branch. brush-engine.js itself is a browser script (DOM/canvas globals
// throughout) and isn't require()-able in Node, so this test extracts the
// exact branch logic as a pure function and exercises it in isolation,
// plus a syntax check on the real file. Run with:
//   node src/brush/hard-round-11a29-diagnostic.test.js

'use strict';

const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.error(`  FAIL - ${name}`); console.error('    ' + (err && err.stack || err)); }
}

// Mirrors the branch added at the pointerup call site in brush-engine.js.
// `flushPending` stands in for the real _hardRoundFlushPending(renderer).
function pointerUpFlushBranch(pendingQueue, skipFlag, flushPending, log) {
  let flushedCount;
  if (skipFlag) {
    const pendingCount = pendingQueue.length;
    const firstPending = pendingCount ? Object.assign({}, pendingQueue[0]) : null;
    const lastPending = pendingCount ? Object.assign({}, pendingQueue[pendingCount - 1]) : null;
    log({ pendingCount, firstPending, lastPending });
    pendingQueue.length = 0;
    flushedCount = 0;
  } else {
    flushedCount = flushPending(pendingQueue);
  }
  return flushedCount;
}

test('default (false) preserves normal flush: all pending segments dispatched', () => {
  const pending = [{ id: 1 }, { id: 2 }, { id: 3 }];
  let dispatched = null;
  const flushed = pointerUpFlushBranch(pending, false, (q) => { dispatched = q.splice(0, q.length); return dispatched.length; }, () => {});
  assert.strictEqual(flushed, 3);
  assert.deepStrictEqual(dispatched, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.strictEqual(pending.length, 0);
});

test('skip=true: pending segments are NOT dispatched to the renderer', () => {
  const pending = [{ id: 1 }, { id: 2 }];
  let flushPendingCalled = false;
  const flushed = pointerUpFlushBranch(pending, true, () => { flushPendingCalled = true; return 999; }, () => {});
  assert.strictEqual(flushPendingCalled, false, 'flushPending must never be invoked when skip=true');
  assert.strictEqual(flushed, 0);
});

test('skip=true: queue is cleared afterward so segments cannot leak into the next stroke', () => {
  const pending = [{ id: 1 }, { id: 2 }, { id: 3 }];
  pointerUpFlushBranch(pending, true, () => 0, () => {});
  assert.strictEqual(pending.length, 0);
});

test('skip=true: diagnostic log receives correct pendingCount / first / last before clearing', () => {
  const pending = [{ x0: 1, y0: 1 }, { x0: 2, y0: 2 }, { x0: 3, y0: 3 }];
  let captured = null;
  pointerUpFlushBranch(pending, true, () => 0, (info) => { captured = info; });
  assert.strictEqual(captured.pendingCount, 3);
  assert.deepStrictEqual(captured.firstPending, { x0: 1, y0: 1 });
  assert.deepStrictEqual(captured.lastPending, { x0: 3, y0: 3 });
});

test('skip=true with an empty queue: no crash, pendingCount 0, first/last null', () => {
  const pending = [];
  let captured = null;
  const flushed = pointerUpFlushBranch(pending, true, () => 0, (info) => { captured = info; });
  assert.strictEqual(flushed, 0);
  assert.strictEqual(captured.pendingCount, 0);
  assert.strictEqual(captured.firstPending, null);
  assert.strictEqual(captured.lastPending, null);
});

test('default off (undefined/false) is falsy just like explicit false', () => {
  const pending = [{ id: 1 }];
  let dispatched = null;
  pointerUpFlushBranch(pending, undefined, (q) => { dispatched = q.splice(0, q.length); return dispatched.length; }, () => {});
  assert.deepStrictEqual(dispatched, [{ id: 1 }]);
});

test('syntax validation: brush-engine.js parses cleanly (node --check)', () => {
  const target = path.join(__dirname, 'brush-engine.js');
  execSync(`node --check "${target}"`, { stdio: 'pipe' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
