// src/brush/prototype-stroke-core.test.js
//
// Minimal, dependency-free deterministic test harness for
// prototype-stroke-core.js. Run with: node src/brush/prototype-stroke-core.test.js
//
// No rendering/canvas is touched — only resolved sample/segment output is
// asserted, per the Phase 8B "extraction only" scope.

'use strict';

const assert = require('assert');
const { PrototypeStrokeCore, pressureInfluence } = require('./prototype-stroke-core');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error('    ' + (err && err.stack ? err.stack.split('\n').join('\n    ') : err));
  }
}

function makeSample(x, y, pressure, t, pointerType) {
  return { x, y, pressure, timeStamp: t, pointerType: pointerType || 'pen' };
}

// Feeds a straight-line stroke of `n` samples spaced `stepPx` apart, with a
// pressure function p(i). Returns { beginSeg, allSegments, finish }.
function runStraightStroke({ n = 40, stepPx = 3, dtMs = 8, pressureAt, settings }) {
  const core = new PrototypeStrokeCore(Object.assign({
    brushSize: 20, stabilization: 0.3, zoom: 1,
  }, settings));

  let t = 0;
  const beginSeg = core.beginStroke(makeSample(0, 0, pressureAt(0), t), {});
  const allSegments = [];
  for (let i = 1; i < n; i++) {
    t += dtMs;
    const seg = core.pushSamples([makeSample(i * stepPx, 0, pressureAt(i), t)]);
    allSegments.push(...seg);
  }
  t += dtMs;
  const finish = core.finishStroke(makeSample(n * stepPx, 0, pressureAt(n), t));
  return { core, beginSeg, allSegments, finish };
}

function segmentsFinite(segments) {
  return segments.every(s =>
    Number.isFinite(s.x0) && Number.isFinite(s.y0) &&
    Number.isFinite(s.x1) && Number.isFinite(s.y1) &&
    Number.isFinite(s.pressure0) && Number.isFinite(s.pressure1) &&
    Number.isFinite(s.influence0) && Number.isFinite(s.influence1)
  );
}

console.log('prototype-stroke-core deterministic tests');

// ---------------------------------------------------------------------
test('pure helper: pressureInfluence is monotonic and bounded [0,1]', () => {
  const vals = [0, 0.1, 0.25, 0.5, 0.75, 1].map(pressureInfluence);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] >= vals[i - 1], `expected monotonic increase at index ${i}`);
  }
  assert.ok(vals[0] === 0, 'pressure 0 -> influence 0');
  assert.ok(Math.abs(vals[vals.length - 1] - 1) < 1e-9, 'pressure 1 -> influence 1');
});

// ---------------------------------------------------------------------
test('constant pressure straight stroke: output finite, pressures stable', () => {
  const { beginSeg, allSegments, finish } = runStraightStroke({
    pressureAt: () => 0.6,
  });
  assert.ok(Number.isFinite(beginSeg.pressure0));
  assert.ok(allSegments.length > 0, 'expected interpolated segments');
  assert.ok(segmentsFinite(allSegments), 'all segments finite');
  assert.ok(segmentsFinite(finish.segments), 'finish segments finite');

  // After the moving-average window fills, pressure should converge close
  // to the constant input value.
  const tail = allSegments.slice(-5);
  for (const s of tail) {
    assert.ok(Math.abs(s.pressure1 - 0.6) < 0.05, `expected pressure near 0.6, got ${s.pressure1}`);
  }
});

// ---------------------------------------------------------------------
test('increasing pressure stroke: resolved pressure trends upward', () => {
  const { allSegments } = runStraightStroke({
    n: 60,
    pressureAt: (i) => Math.min(1, i / 60),
  });
  assert.ok(allSegments.length > 10);
  const early = allSegments[5].pressure1;
  const late = allSegments[allSegments.length - 1].pressure1;
  assert.ok(late > early, `expected pressure to increase over stroke (${early} -> ${late})`);
});

// ---------------------------------------------------------------------
test('decreasing pressure stroke: resolved pressure trends downward', () => {
  const { allSegments } = runStraightStroke({
    n: 60,
    pressureAt: (i) => Math.max(0, 1 - i / 60),
  });
  const early = allSegments[5].pressure1;
  const late = allSegments[allSegments.length - 1].pressure1;
  assert.ok(late < early, `expected pressure to decrease over stroke (${early} -> ${late})`);
});

// ---------------------------------------------------------------------
test('short stroke (2 samples): does not throw, produces finite output', () => {
  const core = new PrototypeStrokeCore({ brushSize: 20, stabilization: 0.2 });
  core.beginStroke(makeSample(0, 0, 0.5, 0));
  const seg = core.pushSamples([makeSample(1, 0, 0.5, 8)]);
  const finish = core.finishStroke(makeSample(1.5, 0, 0.5, 16));
  assert.ok(segmentsFinite(seg));
  assert.ok(segmentsFinite(finish.segments));
});

// ---------------------------------------------------------------------
test('fast sample spacing (large jumps) subdivides without huge gaps', () => {
  const core = new PrototypeStrokeCore({ brushSize: 10, stabilization: 0 });
  core.beginStroke(makeSample(0, 0, 0.8, 0));
  // Single huge jump far beyond maxStep (brushSize*0.6 = 6px).
  const seg = core.pushSamples([makeSample(500, 0, 0.8, 8)]);
  assert.ok(seg.length > 10, `expected subdivision to produce many segments, got ${seg.length}`);
  // No individual segment should span an enormous distance.
  for (const s of seg) {
    const d = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    assert.ok(d < 100, `expected subdivided segment length < 100, got ${d}`);
  }
});

// ---------------------------------------------------------------------
test('stationary hold then release: finish uses stationary-hold mode and frozen pressure', () => {
  const core = new PrototypeStrokeCore({ brushSize: 20, stabilization: 0.5 });
  let t = 0;
  core.beginStroke(makeSample(0, 0, 0.4, t));
  t += 8;
  core.pushSamples([makeSample(10, 0, 0.4, t)]);

  // Simulate holding the pen still for several frames (tickHold), then a
  // long idle gap before pointer-up, well past HOLD_BEFORE_LIFT_MS (120ms).
  for (let i = 0; i < 5; i++) {
    core.tickHold(16.7);
  }
  const preFinishPressure = core.delayedPressure;

  // finishStroke's timeStamp determines idle gap relative to
  // lastMoveEventTime; push it far enough past HOLD_BEFORE_LIFT_MS.
  const finish = core.finishStroke(makeSample(10, 0, 0.4, t + 500));
  assert.strictEqual(finish.mode, 'stationary-hold');
  for (const s of finish.segments) {
    assert.ok(Math.abs(s.pressure1 - preFinishPressure) < 1e-9,
      'stationary-hold finish pressure must stay frozen at the pre-finish delayed pressure');
  }
});

// ---------------------------------------------------------------------
test('moving release: finish uses moving-release mode and converges to endpoint', () => {
  const { core, finish } = (() => {
    const core = new PrototypeStrokeCore({ brushSize: 20, stabilization: 0.6 });
    let t = 0;
    core.beginStroke(makeSample(0, 0, 0.7, t));
    for (let i = 1; i < 20; i++) {
      t += 8;
      core.pushSamples([makeSample(i * 4, 0, 0.7, t)]);
    }
    t += 8; // small gap, well under HOLD_BEFORE_LIFT_MS
    const finish = core.finishStroke(makeSample(20 * 4 + 30, 0, 0.7, t));
    return { core, finish };
  })();
  assert.strictEqual(finish.mode, 'moving-release');
  assert.ok(finish.segments.length > 0, 'expected finish catch-up segments');
  const last = finish.segments[finish.segments.length - 1];
  assert.ok(Math.abs(last.x1 - (20 * 4 + 30)) < 1e-6, 'finish must land exactly on endpoint x');
  assert.ok(Math.abs(last.y1 - 0) < 1e-6, 'finish must land exactly on endpoint y');
});

// ---------------------------------------------------------------------
test('cancelStroke discards state without emitting a finish', () => {
  const core = new PrototypeStrokeCore({ brushSize: 20, stabilization: 0.3 });
  core.beginStroke(makeSample(0, 0, 0.5, 0));
  core.pushSamples([makeSample(5, 0, 0.5, 8)]);
  core.cancelStroke();
  assert.strictEqual(core.drawing, false);
  const finish = core.finishStroke(makeSample(5, 0, 0.5, 16));
  assert.strictEqual(finish.mode, 'none');
  assert.strictEqual(finish.segments.length, 0);
});

// ---------------------------------------------------------------------
test('determinism: identical input produces identical output across runs', () => {
  const run = () => {
    const core = new PrototypeStrokeCore({ brushSize: 15, stabilization: 0.4, zoom: 1 });
    let t = 0;
    core.beginStroke(makeSample(0, 0, 0.5, t));
    const segs = [];
    for (let i = 1; i < 25; i++) {
      t += 8;
      segs.push(...core.pushSamples([makeSample(i * 3, Math.sin(i) * 2, 0.3 + 0.4 * (i / 25), t)]));
    }
    t += 8;
    const finish = core.finishStroke(makeSample(25 * 3 + 20, 0, 0.7, t));
    return JSON.stringify({ segs, finish });
  };
  assert.strictEqual(run(), run(), 'identical inputs must produce byte-identical resolved output');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
