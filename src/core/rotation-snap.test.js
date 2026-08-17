'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SNAP_STEP_DEG,
  FLICK_VELOCITY_THRESHOLD_DEG_PER_MS,
  FLICK_ARM_DURATION_MS,
  FLICK_PROJECTION_MS,
  SNAP_CAPTURE_THRESHOLD_DEG,
  SPRING_DURATION_MS,
  SPRING_OVERSHOOT_FACTOR,
  angleDifferenceDeg,
  springProgress,
  springStep,
  resolveFlickRotation,
} = require('./rotation-snap');

test('A. slow rotation still never snaps (completely free)', () => {
  // Slow rotation: 1 degree every 50ms (0.02 deg/ms < 0.25 threshold)
  let prevAngle = null;
  let prevTime = null;
  let activeSnap = null;
  let armedUntil = null;

  const slowSequence = [38, 40, 42, 44, 44.9, 45, 45.1, 46, 48, 52];
  let time = 1000;

  for (const raw of slowSequence) {
    const res = resolveFlickRotation({
      rawAngleDeg: raw,
      timestampMs: time,
      prevRawAngleDeg: prevAngle,
      prevTimestampMs: prevTime,
      activeSnapTarget: activeSnap,
      snapArmedUntilMs: armedUntil,
    });

    assert.strictEqual(res.displayAngle, raw, `Slow rotation at ${raw}° must remain free`);
    assert.strictEqual(res.isSnapped, false, `Slow rotation at ${raw}° isSnapped must be false`);
    assert.strictEqual(res.snapTarget, null, `Slow rotation at ${raw}° snapTarget must be null`);

    prevAngle = raw;
    prevTime = time;
    activeSnap = res.snapTarget;
    armedUntil = res.snapArmedUntilMs;
    time += 50;
  }
});

test('B. flick that slightly overshoots 0° still chooses 0°', () => {
  // Fast CCW flick starting near 0°: 0 -> -6 -> -14 -> -18 in short time
  // At -18°, target is 0°
  const res = resolveFlickRotation({
    rawAngleDeg: -18,
    timestampMs: 1032,
    prevRawAngleDeg: -6,
    prevTimestampMs: 1016, // vel = 12/16 = 0.75 deg/ms
    activeSnapTarget: null,
    snapArmedUntilMs: null,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 0, 'Overshoot to -18° must catch 0° target');
  assert.strictEqual(res.displayAngle, -18, 'Display angle during drag tracks raw angle 1:1');
});

test('C. flick that overshoots 45° still chooses 45°', () => {
  // Fast CW flick: 45 -> 54 -> 61 in short time
  const res = resolveFlickRotation({
    rawAngleDeg: 61,
    timestampMs: 1032,
    prevRawAngleDeg: 45,
    prevTimestampMs: 1016, // vel = 16/16 = 1.0 deg/ms
    activeSnapTarget: null,
    snapArmedUntilMs: null,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 45, 'Overshoot to 61° must catch 45° target');
});

test('D. same behavior clockwise (0 -> +18° catches 0°)', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 18,
    timestampMs: 1032,
    prevRawAngleDeg: 6,
    prevTimestampMs: 1016,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 0);
});

test('E. same behavior counterclockwise (45 -> 27° catches 45°)', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 27,
    timestampMs: 1032,
    prevRawAngleDeg: 45,
    prevTimestampMs: 1016,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 45);
});

test('F. projected angle selects nearest valid 45° target during normal flick', () => {
  // Flick from 20° -> 34° quickly (projected = 34 + (14/16)*50 = 77.75 -> nearest 90 or 45)
  // At 34°, nearest is 45° (diff 11° <= 22° capture)
  const res = resolveFlickRotation({
    rawAngleDeg: 34,
    timestampMs: 1016,
    prevRawAngleDeg: 20,
    prevTimestampMs: 1000,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 45);
});

test('G. flick with no reasonable target does not snap (e.g. flick landing at 22.5°)', () => {
  // Flick from 18° to 22.5° (projected = 22.5 + (4.5/16)*15 = 26.7°)
  // Distance from 22.5° to 0° is 22.5°, and to 45° is 22.5° (neither is within 18° capture)
  const res = resolveFlickRotation({
    rawAngleDeg: 22.5,
    timestampMs: 1016,
    prevRawAngleDeg: 18,
    prevTimestampMs: 1000,
  }, { captureThreshold: 18 });

  assert.strictEqual(res.isSnapped, false);
  assert.strictEqual(res.snapTarget, null);
});

test('H. projected target remains continuous at 360°', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 372,
    timestampMs: 1016,
    prevRawAngleDeg: 355,
    prevTimestampMs: 1000,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 360, 'Flick overshooting 360° to 372° must target 360°');
});

test('I. negative-angle target works (-45°, -90°)', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: -58,
    timestampMs: 1016,
    prevRawAngleDeg: -45,
    prevTimestampMs: 1000,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, -45);
});

test('J. multi-turn target works (720°, 765°)', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 735,
    timestampMs: 1016,
    prevRawAngleDeg: 720,
    prevTimestampMs: 1000,
  });

  assert.strictEqual(res.isSnapped, true);
  assert.strictEqual(res.snapTarget, 720);
});

test('K. slow release at 45° does NOT spring (no snap target formed)', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 45,
    timestampMs: 1200,
    prevRawAngleDeg: 44,
    prevTimestampMs: 1100, // dt=100ms, vel=0.01
    activeSnapTarget: null,
    snapArmedUntilMs: null,
  });

  assert.strictEqual(res.isSnapped, false);
  assert.strictEqual(res.snapTarget, null);
  assert.strictEqual(res.displayAngle, 45);
});

test('L. springProgress properties: starts at 0, finishes at 1, has subtle overshoot', () => {
  assert.strictEqual(springProgress(0), 0, 'Progress at t=0 must be 0');
  assert.strictEqual(springProgress(1), 1, 'Progress at t=1 must be 1');

  // Check that there is an overshoot region where progress > 1
  let maxProgress = 0;
  for (let t = 0; t <= 1; t += 0.02) {
    const val = springProgress(t);
    if (val > maxProgress) maxProgress = val;
  }
  assert.ok(maxProgress > 1.02 && maxProgress < 1.25, `Overshoot should be subtle (got ${maxProgress})`);
});

test('M. spring finishes exactly on target in simulation', () => {
  const startAngle = -18;
  const targetAngle = 0;
  const diff = targetAngle - startAngle;

  const intermediateAngles = [];
  for (let t = 0; t <= 1; t += 0.1) {
    const angle = startAngle + diff * springProgress(t);
    intermediateAngles.push(angle);
  }

  const finalAngle = startAngle + diff * springProgress(1);
  assert.strictEqual(finalAngle, 0, 'Final simulated angle must be exactly 0°');

  // Verify intermediate angles passed slightly above 0 (overshoot)
  const hasOvershoot = intermediateAngles.some(a => a > 0.2);
  assert.ok(hasOvershoot, 'Spring must exhibit subtle bounce above 0°');
});

test('N. timestamp safety: no NaN/Infinity on zero or negative delta-time', () => {
  const res = resolveFlickRotation({
    rawAngleDeg: 45,
    timestampMs: 1000,
    prevRawAngleDeg: 40,
    prevTimestampMs: 1000, // dt = 0
  });

  assert.strictEqual(res.isSnapped, false);
  assert.strictEqual(res.velocityDegPerMs, 0);
  assert.ok(Number.isFinite(res.displayAngle));
  assert.ok(Number.isFinite(res.projectedAngleDeg));
});

test('O. integration & structural check in core-state.js', () => {
  const coreStateSrc = fs.readFileSync(path.join(__dirname, 'core-state.js'), 'utf8');

  // Verify spring cancel and start functions exist
  assert.match(coreStateSrc, /function\s+_cancelRotateSettle\(\)/);
  assert.match(coreStateSrc, /function\s+_startRotateSpringSettle\(startAngle,\s*targetAngle,\s*pivotX,\s*pivotY\)/);

  // Verify cancel is called on drag starts and reset
  assert.match(coreStateSrc, /_spaceDragStart[^{]*\{[\s\S]*?_cancelRotateSettle\(\);/);
  assert.match(coreStateSrc, /_spaceDragStartXY[^{]*\{[\s\S]*?_cancelRotateSettle\(\);/);
  assert.match(coreStateSrc, /resetRotation[^{]*\{[\s\S]*?_cancelRotateSettle\(\);/);

  // Verify _spaceDragEnd triggers spring when settleTarget is present
  assert.match(coreStateSrc, /if\(settleTarget\s*!==\s*null\s*&&/);
  assert.match(coreStateSrc, /_startRotateSpringSettle\(currentRot,\s*settleTarget,\s*settlePivotX,\s*settlePivotY\)/);

  // Verify rotateCanvasTo receives the captured fixed pivot
  assert.match(coreStateSrc, /rotateCanvasTo\(currentAngle,\s*pivotX,\s*pivotY\)/);
});
