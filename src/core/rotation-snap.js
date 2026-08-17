// src/core/rotation-snap.js
//
// Fast-swipe / flick-activated magnetic rotation snapping with spring-bounce settle.
//
// Interaction model:
// 1. Slow / deliberate rotation remains 100% free with NO snapping or springing (even crossing 45°).
// 2. Fast swipe / flick rotation (angular velocity >= threshold) projects the likely landing angle
//    and/or catches near a 45° target (including overshooting past it).
// 3. When the rotation gesture releases with an armed flick target, a smooth damped spring-bounce
//    animation settles the canvas precisely at the 45° target.
// 4. Any new gesture immediately cancels the spring animation and takes control from the current display angle.

"use strict";

(function (root) {
  const SNAP_STEP_DEG = 45;

  // Velocity threshold to qualify as a "fast swipe / flick" (0.25 deg/ms = 250 deg/sec).
  // Slow deliberate rotation is typically 0.02 - 0.10 deg/ms (20 - 100 deg/sec).
  const FLICK_VELOCITY_THRESHOLD_DEG_PER_MS = 0.25;

  // Duration in milliseconds that a fast flick keeps the snapping / settle target armed.
  const FLICK_ARM_DURATION_MS = 160;

  // Time ahead in milliseconds to project the gesture landing angle during a flick.
  const FLICK_PROJECTION_MS = 50;

  // Maximum angular distance from target to project or catch an overshoot (±22°).
  const SNAP_CAPTURE_THRESHOLD_DEG = 22;

  // Spring animation tuning parameters:
  const SPRING_DURATION_MS = 220;
  const SPRING_OVERSHOOT_FACTOR = 0.12; // Subtle, responsive bounce (~12% overshoot)

  /**
   * Returns shortest signed difference (angleA - angleB) in degrees in range (-180, 180].
   */
  function angleDifferenceDeg(angleA, angleB) {
    let diff = (angleA - angleB) % 360;
    if (diff > 180) diff -= 360;
    if (diff <= -180) diff += 360;
    return diff;
  }

  /**
   * Underdamped spring interpolation function.
   * Produces a quick, crisp approach, a subtle overshoot, and precise settling at t=1.
   *
   * @param {number} t - Normalized progress 0..1
   * @returns {number} Progress factor (passes slightly > 1, then settles at 1)
   */
  function springProgress(t) {
    const clampedT = Math.max(0, Math.min(1, t));
    if (clampedT >= 1) return 1;
    // Damped harmonic oscillation curve: 1 - e^(-decay * t) * cos(omega * t)
    // Scaled and tuned for subtle bounce:
    const decay = 4.5;
    const omega = 7.5;
    const envelope = Math.exp(-decay * clampedT);
    const rawVal = 1 - envelope * Math.cos(omega * clampedT);
    // Boundary normalization ensuring f(0) === 0 and f(1) === 1:
    const startVal = 0;
    const endEnvelope = Math.exp(-decay);
    const endVal = 1 - endEnvelope * Math.cos(omega);
    const norm =
      (rawVal - (1 - (1 - clampedT) * (1 - startVal))) /
        (endVal !== 0 ? endVal : 1) +
      (1 - clampedT) * 0;
    return 1 - envelope * Math.cos(omega * clampedT) + (1 - clampedT) * 0;
  }

  /**
   * Compact damped spring step function for delta-time simulation.
   */
  function springStep(
    current,
    target,
    velocity,
    stiffness,
    damping,
    dtSeconds,
  ) {
    const displacement = current - target;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * velocity;
    const acceleration = springForce + dampingForce;
    const newVelocity = velocity + acceleration * dtSeconds;
    const newPosition = current + newVelocity * dtSeconds;
    return { position: newPosition, velocity: newVelocity };
  }

  /**
   * Resolves display rotation and flick settle target based on raw angle and velocity.
   *
   * @param {object} params
   * @param {number} params.rawAngleDeg - Continuous unconstrained angle from gesture
   * @param {number} params.timestampMs - Current event timestamp (in ms)
   * @param {number|null} [params.prevRawAngleDeg] - Previous raw angle
   * @param {number|null} [params.prevTimestampMs] - Previous event timestamp
   * @param {number|null} [params.activeSnapTarget] - Current locked snap target (or null)
   * @param {number|null} [params.snapArmedUntilMs] - Expiration timestamp for armed flick (or null)
   * @param {object} [options] - Optional overrides for thresholds
   * @returns {{
   *   displayAngle: number,
   *   snapTarget: number|null,
   *   snapArmedUntilMs: number|null,
   *   isSnapped: boolean,
   *   velocityDegPerMs: number,
   *   projectedAngleDeg: number
   * }}
   */
  function resolveFlickRotation(params, options) {
    const p = params || {};
    const rawAngleDeg = p.rawAngleDeg;
    const now =
      typeof p.timestampMs === "number" && Number.isFinite(p.timestampMs)
        ? p.timestampMs
        : typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

    const prevAngle = p.prevRawAngleDeg;
    const prevTime = p.prevTimestampMs;
    let activeTarget = p.activeSnapTarget;
    let armedUntil =
      typeof p.snapArmedUntilMs === "number" &&
      Number.isFinite(p.snapArmedUntilMs)
        ? p.snapArmedUntilMs
        : 0;

    const velThreshold =
      options && typeof options.flickVelocityThreshold === "number"
        ? options.flickVelocityThreshold
        : FLICK_VELOCITY_THRESHOLD_DEG_PER_MS;
    const armDuration =
      options && typeof options.flickArmDurationMs === "number"
        ? options.flickArmDurationMs
        : FLICK_ARM_DURATION_MS;
    const projectionMs =
      options && typeof options.flickProjectionMs === "number"
        ? options.flickProjectionMs
        : FLICK_PROJECTION_MS;
    const captureThresh =
      options && typeof options.captureThreshold === "number"
        ? options.captureThreshold
        : SNAP_CAPTURE_THRESHOLD_DEG;
    const step =
      options && typeof options.snapStep === "number"
        ? options.snapStep
        : SNAP_STEP_DEG;

    if (!Number.isFinite(rawAngleDeg)) {
      return {
        displayAngle: 0,
        snapTarget: null,
        snapArmedUntilMs: null,
        isSnapped: false,
        velocityDegPerMs: 0,
        projectedAngleDeg: 0,
      };
    }

    // Calculate signed angular velocity from raw continuous angle
    let signedVelocity = 0;
    let speed = 0;
    if (
      typeof prevAngle === "number" &&
      Number.isFinite(prevAngle) &&
      typeof prevTime === "number" &&
      Number.isFinite(prevTime)
    ) {
      const dt = now - prevTime;
      if (dt > 0.001 && dt < 1000) {
        signedVelocity = (rawAngleDeg - prevAngle) / dt;
        speed = Math.abs(signedVelocity);
      }
    }

    const isFlicking = speed >= velThreshold;
    if (isFlicking) {
      armedUntil = Math.max(armedUntil, now + armDuration);
    }

    const isArmed = armedUntil > now;
    const projectedAngle =
      rawAngleDeg + (isFlicking ? signedVelocity * projectionMs : 0);

    // Target Selection:
    // If armed by a fast flick, determine if the gesture targeted, crossed, or projected onto a 45° multiple.
    let candidateTarget = null;
    if (isArmed) {
      // 1. Nearest 45° multiple to current raw angle
      let rawNearest = Math.round(rawAngleDeg / step) * step;
      if (Object.is(rawNearest, -0)) rawNearest = 0;
      const diffToRawNearest = Math.abs(rawAngleDeg - rawNearest);

      // 2. Nearest 45° multiple to projected angle
      let projNearest = Math.round(projectedAngle / step) * step;
      if (Object.is(projNearest, -0)) projNearest = 0;
      const diffToProjNearest = Math.abs(projectedAngle - projNearest);
      const diffProjToRaw = Math.abs(rawAngleDeg - projNearest);

      // 3. Did we cross a target between prevAngle and rawAngle (overshoot)?
      let crossedTarget = null;
      if (typeof prevAngle === "number" && Number.isFinite(prevAngle)) {
        const candidateCross = Math.round(prevAngle / step) * step;
        const diffCrossToRaw = Math.abs(rawAngleDeg - candidateCross);
        const diffCrossToPrev = Math.abs(prevAngle - candidateCross);
        if (diffCrossToPrev <= 12 && diffCrossToRaw <= captureThresh) {
          crossedTarget = Object.is(candidateCross, -0) ? 0 : candidateCross;
        }
      }

      if (crossedTarget !== null) {
        candidateTarget = crossedTarget;
      } else if (diffToRawNearest <= captureThresh) {
        candidateTarget = rawNearest;
      } else if (
        diffToProjNearest <= captureThresh &&
        diffProjToRaw <= captureThresh
      ) {
        candidateTarget = projNearest;
      }
    }

    if (candidateTarget !== null) {
      activeTarget = candidateTarget;
    } else {
      activeTarget = null;
    }

    // During the active drag gesture, rotation remains raw/continuous on screen so the user's hand
    // retains direct 1:1 control without lag or magnetic sticking.
    // The armed `snapTarget` is retained and returned so `_spaceDragEnd()` can trigger the spring settle.
    return {
      displayAngle: rawAngleDeg,
      snapTarget: activeTarget,
      snapArmedUntilMs: isArmed ? armedUntil : null,
      isSnapped: activeTarget !== null,
      velocityDegPerMs: speed,
      projectedAngleDeg: projectedAngle,
    };
  }

  const RotationSnapExports = {
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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = RotationSnapExports;
  }
  if (typeof window !== "undefined") {
    window.RotationSnap = RotationSnapExports;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
