const assert = require("assert");
const test = require("node:test");

globalThis.StrokeTrajectoryCoreModule = require("../../stroke-trajectory-core.js");
const { PrototypeStrokeCore } = require("../../prototype-stroke-core.js");

const ZOOM_COMP_MIN_ZOOM = 0.05;
const ZOOM_COMP_ZERO_ZOOM = 5.0;
const ZOOM_COMP_MAX_AMOUNT = 0.15;
const ZOOM_COMP_FADE_UI_LIMIT = 0.2;
const OLD_STABILIZER_TAU_MAX = 0.05;
const OLD_STABILIZER_LAG_MAX_SCREEN_PX = 16;
const OLD_STABILIZER_FLOOR_FADE_LIMIT = 0.12;

function zoomMinimum(zoom) {
  const clampedZoom = Math.min(Math.max(zoom, ZOOM_COMP_MIN_ZOOM), ZOOM_COMP_ZERO_ZOOM);
  const t =
    (Math.log(clampedZoom) - Math.log(ZOOM_COMP_MIN_ZOOM)) /
    (Math.log(ZOOM_COMP_ZERO_ZOOM) - Math.log(ZOOM_COMP_MIN_ZOOM));
  return ZOOM_COMP_MAX_AMOUNT * (1 - t);
}

function movingAverageWindow(
  zoom,
  uiStabilization,
  sharedZoomMinimumDisabled = false,
  positionWindowOverride = null,
) {
  if (positionWindowOverride != null) {
    const rounded = Math.round(Number(positionWindowOverride));
    if (Number.isFinite(rounded) && rounded >= 1 && rounded <= 5) return rounded;
  }
  const u = Math.max(0, Math.min(1, uiStabilization || 0));
  const t = Math.min(Math.max(u / ZOOM_COMP_FADE_UI_LIMIT, 0), 1);
  const compW = 1 - t * t * (3 - 2 * t);
  const zMin = sharedZoomMinimumDisabled && u === 0 ? 0 : zoomMinimum(zoom);
  const internal = Math.min(1, Math.max(0, u + zMin * compW));
  return internal <= 0 ? 1 : Math.max(2, Math.round(internal * 200));
}

function oldFloorWeight(amount) {
  const t = Math.min(Math.max(amount / OLD_STABILIZER_FLOOR_FADE_LIMIT, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

function makeOldFloor(zoom, disabled) {
  let x = 0;
  let y = 0;
  let speed = 0;
  let lastT = 0;
  return {
    reset(px, py, t) {
      x = px;
      y = py;
      speed = 0;
      lastT = t;
    },
    apply(targetX, targetY, uiAmount, now) {
      if (disabled) return { x: targetX, y: targetY };
      const weight = oldFloorWeight(uiAmount);
      if (weight <= 0) return { x: targetX, y: targetY };
      const dt = Math.max(0.00025, Math.min(0.05, (now - (lastT || now)) / 1000));
      lastT = now;
      const dist = Math.hypot(targetX - x, targetY - y);
      const instSpeed = dist / dt;
      speed = speed * 0.7 + instSpeed * 0.3;
      const maxLagCanvas = OLD_STABILIZER_LAG_MAX_SCREEN_PX / Math.max(0.05, zoom);
      const expectedLagRatio = (speed * OLD_STABILIZER_TAU_MAX) / Math.max(0.01, maxLagCanvas);
      const tau = OLD_STABILIZER_TAU_MAX / (1 + Math.max(0, expectedLagRatio));
      const alpha = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
      x += (targetX - x) * alpha;
      y += (targetY - y) * alpha;
      return {
        x: targetX + (x - targetX) * weight,
        y: targetY + (y - targetY) * weight,
      };
    },
  };
}

function makeLine(count, speedDocPxPerSample, angleRad, dtMs) {
  const out = [];
  const ux = Math.cos(angleRad);
  const uy = Math.sin(angleRad);
  for (let i = 0; i < count; i++) {
    out.push({
      x: 100 + ux * speedDocPxPerSample * i,
      y: 100 + uy * speedDocPxPerSample * i,
      pressure: 0.7,
      pointerType: "pen",
      timeStamp: i * dtMs,
    });
  }
  return out;
}

function makeCurve(count, radius, dtMs) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(1, count - 1)) * Math.PI * 0.75;
    out.push({
      x: 200 + Math.cos(t) * radius,
      y: 200 + Math.sin(t) * radius,
      pressure: 0.7,
      pointerType: "pen",
      timeStamp: i * dtMs,
    });
  }
  return out;
}

function signedOffset(input, output, prev, zoom) {
  if (!input || !output || !prev) return null;
  const dx = input.x - prev.x;
  const dy = input.y - prev.y;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const ox = output.x - input.x;
  const oy = output.y - input.y;
  return {
    along: (ox * ux + oy * uy) * zoom,
    cross: (ox * -uy + oy * ux) * zoom,
  };
}

function stats(values) {
  const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return { mean: null, p95: null, max: null };
  const pick = (p) => arr[Math.min(arr.length - 1, Math.floor((arr.length - 1) * p))];
  return {
    mean: arr.reduce((a, b) => a + b, 0) / arr.length,
    p95: pick(0.95),
    max: arr[arr.length - 1],
  };
}

function replay(samples, { zoom, oldFloorDisabled, sharedTrajectoryZoomMinimumDisabled }) {
  globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum =
    !!sharedTrajectoryZoomMinimumDisabled;
  globalThis.HardRoundDebugSharedTrajectoryPositionWindow = null;
  globalThis.HardRoundDebugDisablePrototypeZoomMinimum = false;
  const core = new PrototypeStrokeCore({
    brushSize: 20,
    zoom,
    stabilization: 0,
    minStepPx: 0.1,
    subdivisionScale: 0.6,
  });
  const floor = makeOldFloor(zoom, oldFloorDisabled);
  floor.reset(samples[0].x, samples[0].y, samples[0].timeStamp);
  core.beginStroke(samples[0], { zoom, stabilization: 0 });
  const values = {
    rawToStabilized: [],
    coreInputToTrajectoryOutput: [],
    trajectoryOutputToEmittedEndpoint: [],
    rawToEmittedEndpoint: [],
    alongCoreInputToTrajectoryOutput: [],
    crossCoreInputToTrajectoryOutput: [],
    alongRawToEmittedEndpoint: [],
    crossRawToEmittedEndpoint: [],
  };
  let prevRaw = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const raw = samples[i];
    const stabilized = floor.apply(raw.x, raw.y, 0, raw.timeStamp);
    const segments = core.pushSamples([
      {
        x: stabilized.x,
        y: stabilized.y,
        pressure: raw.pressure,
        pointerType: raw.pointerType,
        timeStamp: raw.timeStamp,
      },
    ]);
    const trajectoryOutput = core.lastRaw;
    const emitted = segments.length ? segments[segments.length - 1] : null;
    if (emitted) {
      values.rawToStabilized.push(Math.hypot(stabilized.x - raw.x, stabilized.y - raw.y) * zoom);
      values.coreInputToTrajectoryOutput.push(
        Math.hypot(trajectoryOutput.x - stabilized.x, trajectoryOutput.y - stabilized.y) * zoom,
      );
      values.trajectoryOutputToEmittedEndpoint.push(
        Math.hypot(emitted.x1 - trajectoryOutput.x, emitted.y1 - trajectoryOutput.y) * zoom,
      );
      values.rawToEmittedEndpoint.push(Math.hypot(emitted.x1 - raw.x, emitted.y1 - raw.y) * zoom);
      const coreSigned = signedOffset(stabilized, trajectoryOutput, prevRaw, zoom);
      const emittedSigned = signedOffset(raw, { x: emitted.x1, y: emitted.y1 }, prevRaw, zoom);
      if (coreSigned) {
        values.alongCoreInputToTrajectoryOutput.push(coreSigned.along);
        values.crossCoreInputToTrajectoryOutput.push(coreSigned.cross);
      }
      if (emittedSigned) {
        values.alongRawToEmittedEndpoint.push(emittedSigned.along);
        values.crossRawToEmittedEndpoint.push(emittedSigned.cross);
      }
    }
    prevRaw = raw;
  }
  return {
    movingAverageWindow: movingAverageWindow(zoom, 0, sharedTrajectoryZoomMinimumDisabled),
    rawToStabilized: stats(values.rawToStabilized),
    coreInputToTrajectoryOutput: stats(values.coreInputToTrajectoryOutput),
    trajectoryOutputToEmittedEndpoint: stats(values.trajectoryOutputToEmittedEndpoint),
    rawToEmittedEndpoint: stats(values.rawToEmittedEndpoint),
    signed: {
      coreInputToTrajectoryOutputAlong: stats(values.alongCoreInputToTrajectoryOutput),
      coreInputToTrajectoryOutputCross: stats(values.crossCoreInputToTrajectoryOutput),
      rawToEmittedEndpointAlong: stats(values.alongRawToEmittedEndpoint),
      rawToEmittedEndpointCross: stats(values.crossRawToEmittedEndpoint),
    },
  };
}

function replaySharedCoreOnly(
  samples,
  {
    zoom,
    positionWindowOverride = null,
    speedAdaptiveWindow = null,
    zoomWindowOverride = null,
  },
) {
  globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum = false;
  globalThis.HardRoundDebugSharedTrajectoryPositionWindow = positionWindowOverride;
  globalThis.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow = speedAdaptiveWindow;
  globalThis.HardRoundDebugSharedTrajectoryZoomWindow = zoomWindowOverride;
  globalThis.HardRoundDebugShortLookaheadTrajectory = false;
  globalThis.HardRoundDebugOneSampleDelayedCurveReconstruction = false;
  globalThis.HardRoundDebugOneEuroTrajectoryFilter = null;
  const core = new globalThis.StrokeTrajectoryCoreModule.StrokeTrajectoryCore({
    zoom,
    stabilization: 0,
  });
  core.beginStroke(samples[0], { zoom, stabilization: 0 });
  const inputToOutput = [];
  const pressureInputToOutput = [];
  for (let i = 1; i < samples.length; i++) {
    const raw = samples[i];
    const out = core.pushSamples([raw])[0];
    inputToOutput.push(Math.hypot(out.x - raw.x, out.y - raw.y) * zoom);
    pressureInputToOutput.push(Math.abs(out.pressure - raw.pressure));
  }
  const diagnostic = core.diagnosticState();
  return {
    diagnostic,
    inputToOutput: stats(inputToOutput),
    pressureInputToOutput: stats(pressureInputToOutput),
  };
}

function replaySharedCoreOneEuro(samples, { zoom, enabled, config = true, stabilization = 0 }) {
  globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum = false;
  globalThis.HardRoundDebugSharedTrajectoryPositionWindow = null;
  globalThis.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow = null;
  globalThis.HardRoundDebugSharedTrajectoryZoomWindow = null;
  globalThis.HardRoundDebugShortLookaheadTrajectory = false;
  globalThis.HardRoundDebugOneSampleDelayedCurveReconstruction = false;
  globalThis.HardRoundDebugOneEuroTrajectoryFilter = enabled ? config : null;
  globalThis.HardRoundOneEuroTrajectoryFilterData = null;
  const core = new globalThis.StrokeTrajectoryCoreModule.StrokeTrajectoryCore({
    zoom,
    stabilization,
  });
  const begin = core.beginStroke(samples[0], { zoom, stabilization });
  const emitted = [begin];
  for (let i = 1; i < samples.length; i++) {
    emitted.push(...core.pushSamples([samples[i]]));
  }
  const beforeFinishCount = emitted.length;
  emitted.push(...core.finishStroke());
  return {
    emitted,
    beforeFinishCount,
    diagnostic: core.diagnosticState(),
    data: globalThis.HardRoundOneEuroTrajectoryFilterData,
  };
}

function replaySharedCoreLookahead(samples, { zoom, enabled }) {
  globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum = false;
  globalThis.HardRoundDebugSharedTrajectoryPositionWindow = null;
  globalThis.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow = null;
  globalThis.HardRoundDebugSharedTrajectoryZoomWindow = null;
  globalThis.HardRoundDebugShortLookaheadTrajectory = !!enabled;
  globalThis.HardRoundDebugOneSampleDelayedCurveReconstruction = false;
  globalThis.HardRoundDebugOneEuroTrajectoryFilter = null;
  globalThis.HardRoundShortLookaheadTrajectoryData = null;
  const core = new globalThis.StrokeTrajectoryCoreModule.StrokeTrajectoryCore({
    zoom,
    stabilization: 0,
  });
  const begin = core.beginStroke(samples[0], { zoom, stabilization: 0 });
  const emitted = [begin];
  for (let i = 1; i < samples.length; i++) {
    emitted.push(...core.pushSamples([samples[i]]));
  }
  const beforeFinishCount = emitted.length;
  emitted.push(...core.finishStroke());
  return {
    emitted,
    beforeFinishCount,
    diagnostic: core.diagnosticState(),
    data: globalThis.HardRoundShortLookaheadTrajectoryData,
  };
}

function replaySharedCoreCurveReconstruction(samples, { zoom, enabled }) {
  globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum = false;
  globalThis.HardRoundDebugSharedTrajectoryPositionWindow = null;
  globalThis.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow = null;
  globalThis.HardRoundDebugSharedTrajectoryZoomWindow = null;
  globalThis.HardRoundDebugShortLookaheadTrajectory = false;
  globalThis.HardRoundDebugOneSampleDelayedCurveReconstruction = !!enabled;
  globalThis.HardRoundDebugOneEuroTrajectoryFilter = null;
  globalThis.HardRoundOneSampleDelayedCurveReconstructionData = null;
  const core = new globalThis.StrokeTrajectoryCoreModule.StrokeTrajectoryCore({
    zoom,
    stabilization: 0,
  });
  const begin = core.beginStroke(samples[0], { zoom, stabilization: 0 });
  const emitted = [begin];
  for (let i = 1; i < samples.length; i++) {
    emitted.push(...core.pushSamples([samples[i]]));
  }
  const beforeFinishCount = emitted.length;
  emitted.push(...core.finishStroke());
  return {
    emitted,
    beforeFinishCount,
    diagnostic: core.diagnosticState(),
    data: globalThis.HardRoundOneSampleDelayedCurveReconstructionData,
  };
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function compactReport(report) {
  const rows = [];
  for (const [zoomKey, paths] of Object.entries(report)) {
    for (const [pathName, modes] of Object.entries(paths)) {
      for (const [modeName, result] of Object.entries(modes)) {
        rows.push({
          zoom: zoomKey,
          path: pathName,
          mode: modeName,
          window: result.movingAverageWindow,
          rawToStabilized: round(result.rawToStabilized.mean),
          coreInputToTrajectoryOutput: round(result.coreInputToTrajectoryOutput.mean),
          trajectoryOutputToEmittedEndpoint: round(
            result.trajectoryOutputToEmittedEndpoint.mean,
          ),
          rawToEmittedEndpoint: round(result.rawToEmittedEndpoint.mean),
          alongCoreInputToTrajectoryOutput: round(
            result.signed.coreInputToTrajectoryOutputAlong.mean,
          ),
          crossCoreInputToTrajectoryOutput: round(
            result.signed.coreInputToTrajectoryOutputCross.mean,
          ),
        });
      }
    }
  }
  return rows;
}

test("deterministic Hard Round trajectory latency decomposition", () => {
  const zooms = [0.5, 1.0, 2.0];
  const pathFactories = {
    slowLine: () => makeLine(90, 0.6, Math.PI / 5, 8),
    mediumLine: () => makeLine(90, 2.0, Math.PI / 5, 8),
    fastLine: () => makeLine(90, 5.5, Math.PI / 5, 8),
    curve: () => makeCurve(100, 90, 8),
  };
  const modes = {
    A_current: { oldFloorDisabled: false, sharedTrajectoryZoomMinimumDisabled: false },
    B_sharedZoomMinimumOff: { oldFloorDisabled: false, sharedTrajectoryZoomMinimumDisabled: true },
    C_oldFloorOff: { oldFloorDisabled: true, sharedTrajectoryZoomMinimumDisabled: false },
    D_bothOff: { oldFloorDisabled: true, sharedTrajectoryZoomMinimumDisabled: true },
  };
  const report = {};
  for (const zoom of zooms) {
    const zoomKey = "zoom" + zoom;
    report[zoomKey] = {};
    for (const [pathName, makeSamples] of Object.entries(pathFactories)) {
      report[zoomKey][pathName] = {};
      for (const [modeName, opts] of Object.entries(modes)) {
        report[zoomKey][pathName][modeName] = replay(makeSamples(), {
          zoom,
          ...opts,
        });
      }
    }
  }

  console.log(JSON.stringify(compactReport(report), null, 2));

  assert.ok(report["zoom0.5"].fastLine.A_current.coreInputToTrajectoryOutput.mean > 0);
  assert.ok(
    Number.isFinite(
      report["zoom0.5"].fastLine.A_current.signed.coreInputToTrajectoryOutputAlong.mean,
    ),
  );
  assert.ok(report["zoom0.5"].fastLine.A_current.trajectoryOutputToEmittedEndpoint.mean > 0);
  assert.equal(report["zoom0.5"].fastLine.A_current.movingAverageWindow, 15);
  assert.equal(report["zoom0.5"].fastLine.D_bothOff.movingAverageWindow, 1);
  assert.ok(report["zoom0.5"].fastLine.D_bothOff.coreInputToTrajectoryOutput.mean < 0.001);
});

test("shared trajectory position window override affects only position smoothing", () => {
  const samples = makeLine(60, 5.5, Math.PI / 5, 8).map((sample, i) => ({
    ...sample,
    pressure: i % 2 ? 0.2 : 0.8,
  }));
  const normal = replaySharedCoreOnly(samples, {
    zoom: 0.5,
    positionWindowOverride: null,
  });
  assert.equal(normal.diagnostic.positionWindowOverride, null);
  assert.equal(normal.diagnostic.positionMovingAverageWindow, 15);
  assert.equal(normal.diagnostic.pressureMovingAverageWindow, 15);

  const results = [];
  for (let win = 1; win <= 5; win++) {
    const result = replaySharedCoreOnly(samples, {
      zoom: 0.5,
      positionWindowOverride: win,
    });
    results.push({
      window: win,
      positionLagMean: Number(result.inputToOutput.mean.toFixed(3)),
      pressureLagMean: Number(result.pressureInputToOutput.mean.toFixed(3)),
      pressureWindow: result.diagnostic.pressureMovingAverageWindow,
    });
    assert.equal(result.diagnostic.positionWindowOverride, win);
    assert.equal(result.diagnostic.positionMovingAverageWindow, win);
    assert.equal(
      result.diagnostic.pressureMovingAverageWindow,
      normal.diagnostic.pressureMovingAverageWindow,
    );
  }
  assert.equal(results[0].positionLagMean, 0);
  assert.ok(results[4].positionLagMean > results[0].positionLagMean);
  assert.ok(results.every((r) => r.pressureWindow === 15));
  console.log(JSON.stringify({ positionWindowOverrideSweep: results }, null, 2));
});

test("shared trajectory zoom-window override selects diagnostic position buckets only", () => {
  const samples = makeLine(60, 5.5, Math.PI / 5, 8).map((sample, i) => ({
    ...sample,
    pressure: i % 2 ? 0.15 : 0.85,
  }));
  const zoomWindowOverride = {
    veryLowZoom: 4,
    lowZoom: 3,
    normalZoom: 2,
    highZoom: 1,
  };
  const cases = [
    { zoom: 0.1, bucket: "veryLowZoom", window: 4 },
    { zoom: 0.3, bucket: "lowZoom", window: 3 },
    { zoom: 0.5, bucket: "normalZoom", window: 2 },
    { zoom: 1.0, bucket: "normalZoom", window: 2 },
    { zoom: 2.0, bucket: "highZoom", window: 1 },
  ];
  const normal = replaySharedCoreOnly(samples, {
    zoom: 0.5,
    positionWindowOverride: null,
    zoomWindowOverride: null,
  });

  const rows = [];
  for (const one of cases) {
    const result = replaySharedCoreOnly(samples, {
      zoom: one.zoom,
      positionWindowOverride: null,
      zoomWindowOverride,
    });
    rows.push({
      zoom: one.zoom,
      bucket: result.diagnostic.positionZoomWindowBucket,
      selected: result.diagnostic.selectedPositionWindow,
      source: result.diagnostic.positionWindowOverrideSource,
      pressureWindow: result.diagnostic.pressureMovingAverageWindow,
    });
    assert.equal(result.diagnostic.positionWindowOverrideSource, "zoom");
    assert.equal(result.diagnostic.positionZoomWindowBucket, one.bucket);
    assert.equal(result.diagnostic.positionZoomWindowOverride, one.window);
    assert.equal(result.diagnostic.selectedPositionWindow, one.window);
    assert.equal(result.diagnostic.positionMovingAverageWindow, one.window);
    assert.equal(
      result.diagnostic.pressureMovingAverageWindow,
      movingAverageWindow(one.zoom, 0),
    );
  }

  const fixedWins = replaySharedCoreOnly(samples, {
    zoom: 0.1,
    positionWindowOverride: 2,
    zoomWindowOverride,
  });
  assert.equal(fixedWins.diagnostic.positionWindowOverrideSource, "fixed");
  assert.equal(fixedWins.diagnostic.positionWindowOverride, 2);
  assert.equal(fixedWins.diagnostic.positionZoomWindowOverride, null);
  assert.equal(fixedWins.diagnostic.positionMovingAverageWindow, 2);

  assert.equal(normal.diagnostic.positionWindowOverrideSource, "normal");
  assert.equal(normal.diagnostic.positionZoomWindowOverride, null);
  assert.equal(normal.diagnostic.selectedPositionWindow, null);
  assert.equal(normal.diagnostic.positionMovingAverageWindow, 15);
  assert.equal(normal.diagnostic.pressureMovingAverageWindow, 15);
  console.log(JSON.stringify({ zoomWindowOverrideSweep: rows }, null, 2));
});

test("shared trajectory speed-adaptive window override selects by screen speed", () => {
  const config = {
    slowWindow: 4,
    mediumWindow: 4,
    fastWindow: 3,
    veryFastWindow: 2,
    slowMaxScreenPxPerMs: 0.15,
    mediumMaxScreenPxPerMs: 0.45,
    fastMaxScreenPxPerMs: 1.0,
    speedEmaAlpha: 1,
  };
  const cases = [
    { name: "slow", speedDocPxPerSample: 0.8, expectedWindow: 4 },
    { name: "medium", speedDocPxPerSample: 2.0, expectedWindow: 4 },
    { name: "fast", speedDocPxPerSample: 5.6, expectedWindow: 3 },
    { name: "veryFast", speedDocPxPerSample: 10.0, expectedWindow: 2 },
  ];
  const rows = [];
  for (const one of cases) {
    const samples = makeLine(60, one.speedDocPxPerSample, Math.PI / 5, 8);
    const result = replaySharedCoreOnly(samples, {
      zoom: 1,
      speedAdaptiveWindow: config,
    });
    rows.push({
      name: one.name,
      source: result.diagnostic.positionWindowOverrideSource,
      bucket: result.diagnostic.positionSpeedAdaptiveBucket,
      selected: result.diagnostic.selectedPositionWindow,
      pressureWindow: result.diagnostic.pressureMovingAverageWindow,
    });
    assert.equal(result.diagnostic.positionWindowOverrideSource, "speed");
    assert.equal(result.diagnostic.positionSpeedAdaptiveBucket, one.name);
    assert.equal(result.diagnostic.selectedPositionWindow, one.expectedWindow);
    assert.equal(result.diagnostic.positionMovingAverageWindow, one.expectedWindow);
    assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(1, 0));
  }

  const zoomWindowOverride = {
    veryLowZoom: 5,
    lowZoom: 5,
    normalZoom: 5,
    highZoom: 5,
  };
  const speedWinsOverZoom = replaySharedCoreOnly(makeLine(60, 10, Math.PI / 5, 8), {
    zoom: 1,
    speedAdaptiveWindow: config,
    zoomWindowOverride,
  });
  assert.equal(speedWinsOverZoom.diagnostic.positionWindowOverrideSource, "speed");
  assert.equal(speedWinsOverZoom.diagnostic.selectedPositionWindow, 2);

  const fixedWins = replaySharedCoreOnly(makeLine(60, 10, Math.PI / 5, 8), {
    zoom: 1,
    positionWindowOverride: 1,
    speedAdaptiveWindow: config,
    zoomWindowOverride,
  });
  assert.equal(fixedWins.diagnostic.positionWindowOverrideSource, "fixed");
  assert.equal(fixedWins.diagnostic.selectedPositionWindow, 1);

  const normal = replaySharedCoreOnly(makeLine(60, 10, Math.PI / 5, 8), {
    zoom: 1,
  });
  assert.equal(normal.diagnostic.positionWindowOverrideSource, "normal");
  assert.equal(normal.diagnostic.positionSpeedAdaptiveWindow, null);
  assert.equal(normal.diagnostic.pressureMovingAverageWindow, movingAverageWindow(1, 0));

  console.log(JSON.stringify({ speedAdaptiveWindowSweep: rows }, null, 2));
});

test("one euro trajectory filter smooths stationary position noise without changing pressure smoothing", () => {
  const samples = [];
  for (let i = 0; i < 80; i++) {
    const sign = i % 2 ? -1 : 1;
    samples.push({
      x: 100 + sign * 0.8,
      y: 100 + (i % 4 < 2 ? 0.6 : -0.6),
      pressure: i % 2 ? 0.2 : 0.8,
      pointerType: "pen",
      timeStamp: i * 8,
    });
  }
  const result = replaySharedCoreOneEuro(samples, {
    zoom: 1,
    enabled: true,
    config: { minCutoff: 1.2, beta: 0.04, derivativeCutoff: 1.0, maxLagScreenPx: 12 },
  });
  const rawDistances = samples.slice(10).map((p) => Math.hypot(p.x - 100, p.y - 100));
  const emittedDistances = result.emitted
    .slice(10, result.beforeFinishCount)
    .map((p) => Math.hypot(p.x - 100, p.y - 100));
  assert.equal(result.diagnostic.oneEuroTrajectoryFilterEnabled, true);
  assert.equal(result.diagnostic.positionMovingAverageWindow, movingAverageWindow(1, 0));
  assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(1, 0));
  assert.ok(stats(emittedDistances).mean < stats(rawDistances).mean);
  assert.ok(result.data.values.rawToRepresentedScreenPx.length > 0);
});

test("one euro trajectory filter lowers lag at high speed and keeps final endpoint exact", () => {
  const config = { minCutoff: 1.2, beta: 0.04, derivativeCutoff: 1.0, maxLagScreenPx: 12 };
  const slow = replaySharedCoreOneEuro(makeLine(50, 0.6, Math.PI / 5, 8), {
    zoom: 0.1,
    enabled: true,
    config,
  });
  const fastSamples = makeLine(50, 10, Math.PI / 5, 8);
  const fast = replaySharedCoreOneEuro(fastSamples, {
    zoom: 1,
    enabled: true,
    config,
  });
  const fastLast = fastSamples[fastSamples.length - 1];
  const fastEmittedLast = fast.emitted[fast.emitted.length - 1];

  assert.equal(slow.diagnostic.oneEuroTrajectoryFilterEnabled, true);
  assert.equal(fast.diagnostic.oneEuroTrajectoryFilterEnabled, true);
  assert.ok(fast.data.latest.currentAdaptiveCutoff > slow.data.latest.currentAdaptiveCutoff);
  assert.ok(fast.data.latest.currentAlpha >= slow.data.latest.currentAlpha);
  assert.ok(fast.data.speedBuckets.veryFast.count > 0);
  assert.equal(fast.diagnostic.pressureMovingAverageWindow, movingAverageWindow(1, 0));
  assert.ok(Math.hypot(fastEmittedLast.x - fastLast.x, fastEmittedLast.y - fastLast.y) < 1e-6);
  assert.equal(fastEmittedLast._debugSeq, fastSamples.length - 1);
});

test("one euro trajectory filter handles curves corners duplicates and UI stabilization gating", () => {
  const config = { minCutoff: 1.2, beta: 0.04, derivativeCutoff: 1.0, maxLagScreenPx: 12 };
  const paths = [
    makeCurve(32, 45, 8),
    [
      ...makeLine(10, 3, 0, 8),
      ...makeLine(10, 3, Math.PI / 2, 8).map((p) => ({
        ...p,
        x: 127,
        y: 100 + p.y - 100,
      })),
    ],
    makeLine(10, 3, Math.PI / 6, 8).map((p, i) => ({
      ...p,
      timeStamp: i === 4 ? 24 : p.timeStamp,
    })),
  ];
  for (const samples of paths) {
    const result = replaySharedCoreOneEuro(samples, {
      zoom: 0.5,
      enabled: true,
      config,
    });
    assert.ok(result.emitted.length >= 2);
    assert.ok(result.emitted.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(result.emitted[result.emitted.length - 1]._debugSeq, samples.length - 1);
    assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(0.5, 0));
  }

  const disabledByUiStabilization = replaySharedCoreOneEuro(makeLine(20, 4, Math.PI / 5, 8), {
    zoom: 0.5,
    enabled: true,
    config,
    stabilization: 0.25,
  });
  assert.equal(disabledByUiStabilization.diagnostic.oneEuroTrajectoryFilterEnabled, false);
  assert.equal(disabledByUiStabilization.data, null);
});

test("one euro trajectory filter disabled preserves shared moving-average behavior", () => {
  const samples = makeLine(24, 5.5, Math.PI / 5, 8);
  const disabled = replaySharedCoreOneEuro(samples, { zoom: 0.5, enabled: false });
  const normal = replaySharedCoreOnly(samples, { zoom: 0.5 });
  assert.equal(disabled.diagnostic.oneEuroTrajectoryFilterEnabled, false);
  assert.equal(disabled.diagnostic.positionMovingAverageWindow, normal.diagnostic.positionMovingAverageWindow);
  assert.equal(disabled.diagnostic.pressureMovingAverageWindow, normal.diagnostic.pressureMovingAverageWindow);
  assert.equal(disabled.beforeFinishCount, samples.length);
});

test("short-lookahead trajectory emits previous raw sample and flushes newest on finish", () => {
  const samples = makeLine(8, 4, Math.PI / 6, 8);
  const result = replaySharedCoreLookahead(samples, { zoom: 0.1, enabled: true });
  assert.equal(result.diagnostic.shortLookaheadTrajectoryEnabled, true);
  assert.equal(result.emitted[0]._debugSeq, 0);
  assert.equal(result.emitted[1]._debugSeq, 1);
  assert.ok(result.beforeFinishCount < samples.length);
  assert.equal(result.emitted[result.emitted.length - 1]._debugSeq, samples.length - 1);
  assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(0.1, 0));
  assert.ok(result.data.segmentCount > 0);
});

test("short-lookahead trajectory handles slow fast curve corner and duplicate timestamps", () => {
  const paths = [
    makeLine(20, 0.6, Math.PI / 5, 8),
    makeLine(20, 7.5, Math.PI / 5, 8),
    makeCurve(24, 40, 8),
    [
      ...makeLine(8, 3, 0, 8),
      ...makeLine(8, 3, Math.PI / 2, 8).map((p) => ({ ...p, x: 121, y: 100 + p.y - 100 })),
    ],
    makeLine(8, 3, Math.PI / 6, 8).map((p, i) => ({
      ...p,
      timeStamp: i === 4 ? 24 : p.timeStamp,
    })),
  ];
  for (const samples of paths) {
    const result = replaySharedCoreLookahead(samples, { zoom: 0.5, enabled: true });
    assert.ok(result.emitted.length >= 2);
    assert.ok(result.emitted.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(result.emitted[result.emitted.length - 1]._debugSeq, samples.length - 1);
    assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(0.5, 0));
  }
});

test("short-lookahead disabled preserves shared moving-average behavior", () => {
  const samples = makeLine(20, 5.5, Math.PI / 5, 8);
  const disabled = replaySharedCoreLookahead(samples, { zoom: 0.5, enabled: false });
  const normal = replaySharedCoreOnly(samples, { zoom: 0.5 });
  assert.equal(disabled.diagnostic.shortLookaheadTrajectoryEnabled, false);
  assert.equal(disabled.diagnostic.positionMovingAverageWindow, normal.diagnostic.positionMovingAverageWindow);
  assert.equal(disabled.diagnostic.pressureMovingAverageWindow, normal.diagnostic.pressureMovingAverageWindow);
  assert.equal(disabled.beforeFinishCount, samples.length);
  assert.ok(disabled.emitted.length >= samples.length);
});

test("one-sample delayed curve reconstruction handles slow fast curve corner duplicate timestamps", () => {
  const paths = [
    makeLine(20, 0.6, Math.PI / 5, 8),
    makeLine(20, 7.5, Math.PI / 5, 8),
    makeCurve(28, 45, 8),
    [
      ...makeLine(8, 3, 0, 8),
      ...makeLine(8, 3, Math.PI / 2, 8).map((p) => ({
        ...p,
        x: 121,
        y: 100 + p.y - 100,
      })),
    ],
    makeLine(10, 3, Math.PI / 6, 8).map((p, i) => ({
      ...p,
      timeStamp: i === 4 ? 24 : p.timeStamp,
    })),
  ];
  for (const samples of paths) {
    const result = replaySharedCoreCurveReconstruction(samples, {
      zoom: 0.5,
      enabled: true,
    });
    assert.equal(result.diagnostic.oneSampleCurveReconstructionEnabled, true);
    assert.ok(result.emitted.length >= 2);
    assert.ok(result.emitted.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    assert.equal(result.emitted[result.emitted.length - 1]._debugSeq, samples.length - 1);
    assert.equal(result.diagnostic.pressureMovingAverageWindow, movingAverageWindow(0.5, 0));
    assert.ok(result.data.reconstructedSegmentCount > 0);
  }
});

test("one-sample delayed curve reconstruction disabled preserves shared moving-average behavior", () => {
  const samples = makeCurve(24, 55, 8);
  const disabled = replaySharedCoreCurveReconstruction(samples, {
    zoom: 0.5,
    enabled: false,
  });
  const normal = replaySharedCoreOnly(samples, { zoom: 0.5 });
  assert.equal(disabled.diagnostic.oneSampleCurveReconstructionEnabled, false);
  assert.equal(disabled.diagnostic.positionMovingAverageWindow, normal.diagnostic.positionMovingAverageWindow);
  assert.equal(disabled.diagnostic.pressureMovingAverageWindow, normal.diagnostic.pressureMovingAverageWindow);
  assert.equal(disabled.beforeFinishCount, samples.length);
});

test("one-sample delayed curve reconstruction uses cubic path for distinct shallow curve", () => {
  const samples = makeCurve(36, 80, 8);
  const result = replaySharedCoreCurveReconstruction(samples, {
    zoom: 1,
    enabled: true,
  });
  assert.ok(result.data.reconstructedSegmentCount > 0);
  assert.ok(result.data.generatedSubdivisionCount > 0);
  assert.ok(result.data.lineFallbackCount < result.data.reconstructedSegmentCount);
  assert.equal(result.data.duplicatePointCount, 0);
  assert.equal(result.data.fallbackReasons.duplicateSegmentEndpoints || 0, 0);
  assert.equal(result.data.fallbackReasons.duplicateLookahead || 0, 0);
});
