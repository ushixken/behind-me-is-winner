// src/brush/stroke-trajectory-core.js
//
// Phase 12B — Renderer-Neutral Shared Trajectory Core.
// Encapsulates ONLY renderer-neutral trajectory, positional/pressure smoothing,
// anti-jitter window calculation, stationary hold catch-up, and pointer-up finish semantics.
//
// Outputs pure renderer-neutral samples: { x, y, pressure, timeStamp }
// Knows NOTHING about Hard Round, custom tips, textures, capsules, dabs, or GPU renderers.

"use strict";

(function (root) {
  const CONTACT_PRESSURE_FLOOR = 0.02;
  const HOLD_BEFORE_LIFT_MS = 120;
  const ZOOM_COMP_MIN_ZOOM = 0.05;
  const ZOOM_COMP_ZERO_ZOOM = 5.0;
  const ZOOM_COMP_MAX_AMOUNT = 0.15;
  const ZOOM_COMP_FADE_UI_LIMIT = 0.2;
  const FINISH_TICK_DT_MS = 16.7;

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function normalizeRawPressure(pointerType, rawPressure) {
    if (pointerType === "pen" && typeof rawPressure === "number") {
      return clamp01(rawPressure);
    }
    if (pointerType === "mouse") return 1;
    return typeof rawPressure === "number" ? clamp01(rawPressure) : 1;
  }

  function zoomStabilizationMinimum(z) {
    const clampedZoom = Math.min(
      Math.max(z, ZOOM_COMP_MIN_ZOOM),
      ZOOM_COMP_ZERO_ZOOM,
    );
    const logMin = Math.log(ZOOM_COMP_MIN_ZOOM);
    const logMax = Math.log(ZOOM_COMP_ZERO_ZOOM);
    const t = (Math.log(clampedZoom) - logMin) / (logMax - logMin);
    return ZOOM_COMP_MAX_AMOUNT * (1 - t);
  }

  function zoomCompensationWeight(userAmount) {
    const edge0 = 0,
      edge1 = ZOOM_COMP_FADE_UI_LIMIT;
    const t = Math.min(Math.max((userAmount - edge0) / (edge1 - edge0), 0), 1);
    const smooth = t * t * (3 - 2 * t);
    return 1 - smooth;
  }

  function debugRoot() {
    return typeof globalThis !== "undefined" ? globalThis : root;
  }

  function boundedWindow(value) {
    const rounded = Math.round(Number(value));
    if (!Number.isFinite(rounded)) return null;
    return rounded >= 1 && rounded <= 5 ? rounded : null;
  }

  function speedAdaptiveData() {
    const g = debugRoot();
    if (!g) return null;
    if (!g.HardRoundSharedTrajectorySpeedAdaptiveData) {
      g.HardRoundSharedTrajectorySpeedAdaptiveData = {
        startedAt: performance.now(),
        bucketCounts: { slow: 0, medium: 0, fast: 0, veryFast: 0 },
        windowCounts: Object.create(null),
        latest: null,
      };
    }
    return g.HardRoundSharedTrajectorySpeedAdaptiveData;
  }

  function shortLookaheadEnabled() {
    const g = debugRoot();
    return !!(g && g.HardRoundDebugShortLookaheadTrajectory);
  }

  function curveReconstructionEnabled() {
    const g = debugRoot();
    return !!(g && g.HardRoundDebugOneSampleDelayedCurveReconstruction);
  }

  function oneEuroEnabled(settings) {
    const g = debugRoot();
    return !!(
      g &&
      g.HardRoundDebugOneEuroTrajectoryFilter &&
      Math.max(0, Math.min(1, settings && settings.stabilization || 0)) === 0
    );
  }

  function oneEuroConfig() {
    const g = debugRoot();
    const config = g && g.HardRoundDebugOneEuroTrajectoryFilter;
    const object = config && typeof config === "object" ? config : {};
    return {
      minCutoff: Number.isFinite(Number(object.minCutoff))
        ? Math.max(0.001, Number(object.minCutoff))
        : 1.2,
      beta: Number.isFinite(Number(object.beta))
        ? Math.max(0, Number(object.beta))
        : 0.04,
      derivativeCutoff: Number.isFinite(Number(object.derivativeCutoff))
        ? Math.max(0.001, Number(object.derivativeCutoff))
        : 1.0,
      maxLagScreenPx: Number.isFinite(Number(object.maxLagScreenPx))
        ? Math.max(0, Number(object.maxLagScreenPx))
        : 12,
    };
  }

  function oneEuroData() {
    const g = debugRoot();
    if (!g) return null;
    if (!g.HardRoundOneEuroTrajectoryFilterData) {
      g.HardRoundOneEuroTrajectoryFilterData = {
        startedAt: performance.now(),
        values: {
          rawToRepresentedScreenPx: [],
        },
        speedBuckets: {
          slow: { distances: [], count: 0 },
          medium: { distances: [], count: 0 },
          fast: { distances: [], count: 0 },
          veryFast: { distances: [], count: 0 },
        },
        latest: null,
      };
    }
    return g.HardRoundOneEuroTrajectoryFilterData;
  }

  function oneEuroContinuityActive() {
    const g = debugRoot();
    return !!(g && g.HardRoundDebugOneEuroSegmentContinuity);
  }

  function oneEuroContinuityData() {
    const g = debugRoot();
    if (!g) return null;
    if (!g.HardRoundOneEuroSegmentContinuityData) {
      g.HardRoundOneEuroSegmentContinuityData = {
        startedAt: performance.now(),
        filteredOutputs: [],
        filteredBySeq: Object.create(null),
        coreSegments: [],
        renderSegments: [],
        suspiciousSegments: [],
        duplicateRepresentedSeqCount: 0,
        backwardSequenceCount: 0,
        nonLocalSegmentCount: 0,
        maxNonLocalSegmentDistance: 0,
        lastFilteredSeq: null,
        lastCoreSegmentSeq: null,
        lastRenderSegmentSeq: null,
        seenCoreSeq: Object.create(null),
        seenRenderSeq: Object.create(null),
      };
    }
    return g.HardRoundOneEuroSegmentContinuityData;
  }

  function shortLookaheadData() {
    const g = debugRoot();
    if (!g) return null;
    if (!g.HardRoundShortLookaheadTrajectoryData) {
      g.HardRoundShortLookaheadTrajectoryData = {
        startedAt: performance.now(),
        values: {
          rawToRepresentedScreenPx: [],
        },
        segmentCount: 0,
        lineFallbackCount: 0,
        tangentClampCount: 0,
        latest: null,
      };
    }
    return g.HardRoundShortLookaheadTrajectoryData;
  }

  function curveReconstructionData() {
    const g = debugRoot();
    if (!g) return null;
    if (!g.HardRoundOneSampleDelayedCurveReconstructionData) {
      g.HardRoundOneSampleDelayedCurveReconstructionData = {
        startedAt: performance.now(),
        values: {
          rawToRepresentedScreenPx: [],
          subdivisionsPerSegment: [],
        },
        reconstructedSegmentCount: 0,
        generatedSubdivisionCount: 0,
        lineFallbackCount: 0,
        cornerHandleReductionCount: 0,
        duplicatePointCount: 0,
        fallbackReasons: {
          duplicateSegmentEndpoints: 0,
          duplicateLookahead: 0,
          missingPreviousRaw: 0,
          missingLookahead: 0,
          zeroTimeDelta: 0,
          zeroChordLength: 0,
          invalidTangent: 0,
          finishFlush: 0,
          other: 0,
        },
        failedSamples: [],
        latest: null,
      };
    }
    return g.HardRoundOneSampleDelayedCurveReconstructionData;
  }

  function pushLimited(list, value, limit = 512) {
    if (!list || !Number.isFinite(value)) return;
    list.push(value);
    while (list.length > limit) list.shift();
  }

  class StrokeTrajectoryCore {
    constructor(settings = {}) {
      this.settings = {
        zoom: 1.0,
        stabilization: 0,
        ...settings,
      };
      this.drawing = false;
      this.smoothBuf = [];
      this.pressureBuf = [];
      this.lastInputRaw = null;
      this.lastInputPressure = 1;
      this.lastRaw = null;
      this.delayedPressure = 1;
      this.lastMoveEventTime = 0;
      this.lastInputForSpeed = null;
      this.currentSpeedScreenPxPerMs = 0;
      this.smoothedSpeedScreenPxPerMs = 0;
      this.lastPositionWindowSelection = {
        source: "normal",
        bucket: null,
        window: null,
      };
      this.inputSeq = 0;
      this.lookaheadBuf = [];
      this.lookaheadLastEmittedSeq = null;
      this.lookaheadLastRawSeq = null;
      this.curveBuf = [];
      this.curveLastEmittedSeq = null;
      this.curveLastRawSeq = null;
      this.curveLastRepresentedPoint = null;
      this.oneEuro = null;
      this.oneEuroRawSeq = null;
      this.oneEuroRepresentedSeq = null;
    }

    updateSettings(settings = {}) {
      Object.assign(this.settings, settings);
    }

    _sharedTrajectoryZoomMinimumDisabledForPosition(userAmount) {
      return (
        userAmount === 0 &&
        (this.settings.positionAlreadyStabilized === true ||
          (typeof globalThis !== "undefined" &&
            !!globalThis.HardRoundDebugDisableSharedTrajectoryZoomMinimum))
      );
    }

    _positionWindowOverride() {
      if (typeof globalThis === "undefined") return null;
      const value = globalThis.HardRoundDebugSharedTrajectoryPositionWindow;
      if (value == null) return null;
      return boundedWindow(value);
    }

    _speedAdaptiveWindowSelection() {
      const g = debugRoot();
      if (!g) return null;
      const config = g.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow;
      if (!config || typeof config !== "object") return null;
      const slowWindow = boundedWindow(config.slowWindow);
      const mediumWindow = boundedWindow(config.mediumWindow);
      const fastWindow = boundedWindow(config.fastWindow);
      const veryFastWindow = boundedWindow(config.veryFastWindow);
      if (
        slowWindow == null ||
        mediumWindow == null ||
        fastWindow == null ||
        veryFastWindow == null
      )
        return null;
      const slowMax = Number(config.slowMaxScreenPxPerMs);
      const mediumMax = Number(config.mediumMaxScreenPxPerMs);
      const fastMax = Number(config.fastMaxScreenPxPerMs);
      if (
        !Number.isFinite(slowMax) ||
        !Number.isFinite(mediumMax) ||
        !Number.isFinite(fastMax)
      )
        return null;
      const speed = Math.max(0, this.currentSpeedScreenPxPerMs || 0);
      const selectedSpeed = this.smoothedSpeedScreenPxPerMs;
      let bucket = "veryFast";
      let win = veryFastWindow;
      if (selectedSpeed <= slowMax) {
        bucket = "slow";
        win = slowWindow;
      } else if (selectedSpeed <= mediumMax) {
        bucket = "medium";
        win = mediumWindow;
      } else if (selectedSpeed <= fastMax) {
        bucket = "fast";
        win = fastWindow;
      }
      return {
        source: "speed",
        bucket,
        window: win,
        currentSpeedScreenPxPerMs: speed,
        smoothedSpeedScreenPxPerMs: selectedSpeed,
      };
    }

    _zoomWindowBucket() {
      const z = Number(this.settings.zoom) || 1.0;
      if (z < 0.25) return "veryLowZoom";
      if (z < 0.5) return "lowZoom";
      if (z < 1.5) return "normalZoom";
      return "highZoom";
    }

    _positionWindowSelection() {
      const fixed = this._positionWindowOverride();
      if (fixed != null) {
        return {
          source: "fixed",
          bucket: null,
          window: fixed,
        };
      }
      const speed = this._speedAdaptiveWindowSelection();
      if (speed && speed.window != null) return speed;
      if (typeof globalThis === "undefined")
        return { source: "normal", bucket: this._zoomWindowBucket(), window: null };
      const config = globalThis.HardRoundDebugSharedTrajectoryZoomWindow;
      if (!config || typeof config !== "object")
        return { source: "normal", bucket: this._zoomWindowBucket(), window: null };
      const bucket = this._zoomWindowBucket();
      const value = config[bucket];
      const rounded = Math.round(Number(value));
      if (!Number.isFinite(rounded) || rounded < 1 || rounded > 5)
        return { source: "normal", bucket, window: null };
      return {
        source: "zoom",
        bucket,
        window: rounded,
      };
    }

    _effectiveStabilizationAmount(kind = "position") {
      const uAmount = Math.max(0, Math.min(1, this.settings.stabilization || 0));
      const zMin =
        (kind === "position" && this._sharedTrajectoryZoomMinimumDisabledForPosition(uAmount)) ||
        (kind === "pressure" && uAmount === 0 && this.settings.pressureAlreadyStabilized === true)
          ? 0
          : zoomStabilizationMinimum(this.settings.zoom || 1.0);
      const compW = zoomCompensationWeight(uAmount);
      return Math.min(1, Math.max(0, uAmount + zMin * compW));
    }

    _movingAverageAmount(kind = "position") {
      if (kind === "position") {
        const selection = this._positionWindowSelection();
        this.lastPositionWindowSelection = selection;
        if (selection.window != null) return selection.window;
      }
      const internalAmount = this._effectiveStabilizationAmount(kind);
      if (internalAmount <= 0) return 1;
      return Math.max(2, Math.round(internalAmount * 200));
    }

    diagnosticState() {
      const uiAmount = Math.max(0, Math.min(1, this.settings.stabilization || 0));
      const positionZoomMinimumDisabled =
        this._sharedTrajectoryZoomMinimumDisabledForPosition(uiAmount);
      const positionWindowSelection = this._positionWindowSelection();
      const positionZoomMinimum = positionZoomMinimumDisabled
        ? 0
        : zoomStabilizationMinimum(this.settings.zoom || 1.0);
      const compW = zoomCompensationWeight(uiAmount);
      const positionEffectiveAmount = this._effectiveStabilizationAmount("position");
      const pressureEffectiveAmount = this._effectiveStabilizationAmount("pressure");
      return {
        uiAmount,
        zoom: this.settings.zoom || 1.0,
        positionAlreadyStabilized: this.settings.positionAlreadyStabilized === true,
        pressureAlreadyStabilized: this.settings.pressureAlreadyStabilized === true,
        positionZoomMinimumDisabled,
        positionWindowOverride:
          positionWindowSelection.source === "fixed"
            ? positionWindowSelection.window
            : null,
        positionZoomWindowBucket: positionWindowSelection.bucket,
        positionZoomWindowOverride:
          positionWindowSelection.source === "zoom"
            ? positionWindowSelection.window
            : null,
        positionWindowOverrideSource: positionWindowSelection.source,
        selectedPositionWindow: positionWindowSelection.window,
        positionSpeedAdaptiveWindow:
          positionWindowSelection.source === "speed"
            ? positionWindowSelection.window
            : null,
        positionSpeedAdaptiveBucket:
          positionWindowSelection.source === "speed"
            ? positionWindowSelection.bucket
            : null,
        currentSpeedScreenPxPerMs:
          positionWindowSelection.currentSpeedScreenPxPerMs || 0,
        smoothedSpeedScreenPxPerMs:
          positionWindowSelection.smoothedSpeedScreenPxPerMs || 0,
        shortLookaheadTrajectoryEnabled: shortLookaheadEnabled(),
        shortLookaheadRepresentedSeq: this.lookaheadLastEmittedSeq,
        shortLookaheadRawSeq: this.lookaheadLastRawSeq,
        oneSampleCurveReconstructionEnabled: curveReconstructionEnabled(),
        oneSampleCurveRepresentedSeq: this.curveLastEmittedSeq,
        oneSampleCurveRawSeq: this.curveLastRawSeq,
        oneEuroTrajectoryFilterEnabled: oneEuroEnabled(this.settings),
        oneEuroRepresentedSeq: this.oneEuroRepresentedSeq,
        oneEuroRawSeq: this.oneEuroRawSeq,
        positionZoomMinimum,
        compensationWeight: compW,
        positionEffectiveAmount,
        pressureEffectiveAmount,
        positionMovingAverageWindow: this._movingAverageAmount("position"),
        pressureMovingAverageWindow: this._movingAverageAmount("pressure"),
      };
    }

    _resetBuffers() {
      this.smoothBuf = [];
      this.pressureBuf = [];
      this.lastInputRaw = null;
      this.lastInputPressure = 1;
      this.lastRaw = null;
      this.delayedPressure = 1;
      this.lastMoveEventTime = 0;
      this.lastInputForSpeed = null;
      this.currentSpeedScreenPxPerMs = 0;
      this.smoothedSpeedScreenPxPerMs = 0;
      this.lastPositionWindowSelection = {
        source: "normal",
        bucket: null,
        window: null,
      };
      this.inputSeq = 0;
      this.lookaheadBuf = [];
      this.lookaheadLastEmittedSeq = null;
      this.lookaheadLastRawSeq = null;
      this.curveBuf = [];
      this.curveLastEmittedSeq = null;
      this.curveLastRawSeq = null;
      this.curveLastRepresentedPoint = null;
      this.oneEuro = null;
      this.oneEuroRawSeq = null;
      this.oneEuroRepresentedSeq = null;
    }

    beginStroke(sample, settings) {
      if (settings) this.updateSettings(settings);
      this._resetBuffers();

      const p = { x: sample.x, y: sample.y };
      this.drawing = true;
      this.lastRaw = p;

      const positionAmount = this._movingAverageAmount("position");
      const pressureAmount = this._movingAverageAmount("pressure");
      this.smoothBuf = Array.from({ length: positionAmount }, () => ({ x: p.x, y: p.y }));

      const rawPressure = normalizeRawPressure(sample.pointerType, sample.pressure);
      this.pressureBuf = Array.from({ length: pressureAmount }, () => rawPressure);
      this.delayedPressure = rawPressure;
      this.lastInputRaw = p;
      this.lastInputPressure = rawPressure;
      this.lastMoveEventTime = Number.isFinite(sample.timeStamp) ? sample.timeStamp : performance.now();
      this.lastInputForSpeed = {
        x: p.x,
        y: p.y,
        timeStamp: this.lastMoveEventTime,
      };
      this.lookaheadBuf = [{
        x: p.x,
        y: p.y,
        pressure: rawPressure,
        timeStamp: this.lastMoveEventTime,
        _debugSeq: this.inputSeq,
      }];
      this.lookaheadLastRawSeq = this.inputSeq;
      this.lookaheadLastEmittedSeq = this.inputSeq;
      this.curveBuf = [{
        x: p.x,
        y: p.y,
        pressure: rawPressure,
        timeStamp: this.lastMoveEventTime,
        _debugSeq: this.inputSeq,
      }];
      this.curveLastRawSeq = this.inputSeq;
      this.curveLastEmittedSeq = this.inputSeq;
      this.curveLastRepresentedPoint = this.curveBuf[0];
      this.oneEuro = {
        x: p.x,
        y: p.y,
        dx: 0,
        dy: 0,
        lastRawX: p.x,
        lastRawY: p.y,
        lastTime: this.lastMoveEventTime,
      };
      this.oneEuroRawSeq = this.inputSeq;
      this.oneEuroRepresentedSeq = this.inputSeq;

      return {
        x: p.x,
        y: p.y,
        pressure: rawPressure,
        timeStamp: this.lastMoveEventTime,
        _debugSeq: this.inputSeq,
      };
    }

    _pushSmoothBuf(p) {
      if (!this.smoothBuf || !this.smoothBuf.length) return { x: p.x, y: p.y };
      const amount = this._movingAverageAmount("position");
      this.smoothBuf.push({ x: p.x, y: p.y });
      while (this.smoothBuf.length > amount) this.smoothBuf.shift();

      let sx = 0, sy = 0;
      for (const pt of this.smoothBuf) {
        sx += pt.x;
        sy += pt.y;
      }
      return { x: sx / this.smoothBuf.length, y: sy / this.smoothBuf.length };
    }

    _pushPressureBuf(p) {
      if (!this.pressureBuf || !this.pressureBuf.length) return p;
      const amount = this._movingAverageAmount("pressure");
      this.pressureBuf.push(p);
      while (this.pressureBuf.length > amount) this.pressureBuf.shift();

      let sp = 0;
      for (const val of this.pressureBuf) sp += val;
      return sp / this.pressureBuf.length;
    }

    pushSamples(samples) {
      if (!this.drawing || !samples || !samples.length) return [];
      const out = [];

      for (const ev of samples) {
        const inputRaw = { x: ev.x, y: ev.y };
        const rawPressure = normalizeRawPressure(ev.pointerType, ev.pressure);
        const timeStamp = Number.isFinite(ev.timeStamp) ? ev.timeStamp : performance.now();
        const debugSeq = ++this.inputSeq;
        this._updateScreenSpeed(inputRaw, timeStamp);

        this.lastInputRaw = inputRaw;
        this.lastInputPressure = rawPressure;
        this.lastMoveEventTime = timeStamp;

        this.delayedPressure = this._pushPressureBuf(rawPressure);
        if (oneEuroEnabled(this.settings)) {
          const represented = this._pushOneEuroRaw({
            x: inputRaw.x,
            y: inputRaw.y,
            pressure: this.delayedPressure,
            timeStamp,
            _debugSeq: debugSeq,
          });
          out.push(represented);
          continue;
        }
        if (shortLookaheadEnabled()) {
          const rawSample = {
            x: inputRaw.x,
            y: inputRaw.y,
            pressure: this.delayedPressure,
            timeStamp,
            _debugSeq: debugSeq,
          };
          this.lookaheadLastRawSeq = debugSeq;
          const represented = this._pushShortLookaheadRaw(rawSample);
          if (represented) out.push(represented);
          continue;
        }
        if (curveReconstructionEnabled()) {
          const rawSample = {
            x: inputRaw.x,
            y: inputRaw.y,
            pressure: this.delayedPressure,
            timeStamp,
            _debugSeq: debugSeq,
          };
          this.curveLastRawSeq = debugSeq;
          out.push(...this._pushCurveReconstructionRaw(rawSample, false));
          continue;
        }
        const raw = this._pushSmoothBuf(inputRaw);
        this.lastRaw = raw;

        out.push({
          x: raw.x,
          y: raw.y,
          pressure: this.delayedPressure,
          timeStamp,
          _debugSeq: debugSeq,
        });
        this._recordSpeedAdaptiveDiagnostic(out[out.length - 1]);
      }
      return out;
    }

    _pushCurveReconstructionRaw(rawSample, flushNewest) {
      this.curveBuf.push(rawSample);
      while (this.curveBuf.length > 3) this.curveBuf.shift();
      if (!flushNewest && this.curveBuf.length < 3) return [];
      return this._emitCurveReconstructionSegment(flushNewest);
    }

    _oneEuroAlpha(cutoff, dtSeconds) {
      const tau = 1 / (2 * Math.PI * Math.max(0.001, cutoff));
      return 1 / (1 + tau / Math.max(0.000001, dtSeconds));
    }

    _pushOneEuroRaw(rawSample) {
      const config = oneEuroConfig();
      if (!this.oneEuro) {
        this.oneEuro = {
          x: rawSample.x,
          y: rawSample.y,
          dx: 0,
          dy: 0,
          lastRawX: rawSample.x,
          lastRawY: rawSample.y,
          lastTime: rawSample.timeStamp,
        };
      }
      const previousFiltered = { x: this.oneEuro.x, y: this.oneEuro.y };
      const dtMs = Math.max(0.001, rawSample.timeStamp - this.oneEuro.lastTime);
      const dt = dtMs / 1000;
      const rawDx = (rawSample.x - this.oneEuro.lastRawX) / dt;
      const rawDy = (rawSample.y - this.oneEuro.lastRawY) / dt;
      const dAlpha = this._oneEuroAlpha(config.derivativeCutoff, dt);
      this.oneEuro.dx += (rawDx - this.oneEuro.dx) * dAlpha;
      this.oneEuro.dy += (rawDy - this.oneEuro.dy) * dAlpha;

      const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
      const speedScreenPxPerSec = Math.hypot(this.oneEuro.dx, this.oneEuro.dy) * zoomValue;
      const cutoff = config.minCutoff + config.beta * speedScreenPxPerSec;
      const alpha = this._oneEuroAlpha(cutoff, dt);
      this.oneEuro.x += (rawSample.x - this.oneEuro.x) * alpha;
      this.oneEuro.y += (rawSample.y - this.oneEuro.y) * alpha;

      if (config.maxLagScreenPx > 0) {
        const lagDoc = Math.hypot(rawSample.x - this.oneEuro.x, rawSample.y - this.oneEuro.y);
        const maxLagDoc = config.maxLagScreenPx / zoomValue;
        if (lagDoc > maxLagDoc && lagDoc > 1e-9) {
          const s = maxLagDoc / lagDoc;
          this.oneEuro.x = rawSample.x + (this.oneEuro.x - rawSample.x) * s;
          this.oneEuro.y = rawSample.y + (this.oneEuro.y - rawSample.y) * s;
        }
      }

      this.oneEuro.lastRawX = rawSample.x;
      this.oneEuro.lastRawY = rawSample.y;
      this.oneEuro.lastTime = rawSample.timeStamp;
      this.oneEuroRawSeq = rawSample._debugSeq;
      this.oneEuroRepresentedSeq = rawSample._debugSeq;
      const represented = {
        x: this.oneEuro.x,
        y: this.oneEuro.y,
        pressure: rawSample.pressure,
        timeStamp: rawSample.timeStamp,
        _debugSeq: rawSample._debugSeq,
        _debugPreviousFilteredX: previousFiltered.x,
        _debugPreviousFilteredY: previousFiltered.y,
      };
      this.lastRaw = { x: represented.x, y: represented.y };
      this._recordOneEuroDiagnostic({
        rawSample,
        represented,
        previousFiltered,
        speedScreenPxPerSec,
        cutoff,
        alpha,
      });
      return represented;
    }

    _recordOneEuroDiagnostic(detail) {
      const d = oneEuroData();
      if (!d || !detail || !detail.rawSample || !detail.represented) return;
      const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
      const distance = Math.hypot(
        detail.rawSample.x - detail.represented.x,
        detail.rawSample.y - detail.represented.y,
      ) * zoomValue;
      pushLimited(d.values.rawToRepresentedScreenPx, distance);
      const bucket = this._oneEuroSpeedBucket(detail.speedScreenPxPerSec);
      const bucketData = d.speedBuckets[bucket];
      if (bucketData) {
        bucketData.count++;
        pushLimited(bucketData.distances, distance);
      }
      d.latest = {
        enabled: true,
        zoom: this.settings.zoom || 1.0,
        currentSpeedScreenPxPerSec: detail.speedScreenPxPerSec,
        currentAdaptiveCutoff: detail.cutoff,
        currentAlpha: detail.alpha,
        rawSeq: detail.rawSample._debugSeq,
        representedSeq: detail.represented._debugSeq,
        representedSeqLag: 0,
        currentRawToRepresentedScreenPx: distance,
      };
      if (oneEuroContinuityActive()) {
        const c = oneEuroContinuityData();
        if (c) {
          const seq = detail.represented._debugSeq;
          const previousSeq = c.lastFilteredSeq;
          const sample = {
            rawSeq: detail.rawSample._debugSeq,
            representedSeq: seq,
            previousRepresentedSeq: previousSeq,
            raw: { x: detail.rawSample.x, y: detail.rawSample.y },
            previousFiltered: detail.previousFiltered
              ? { x: detail.previousFiltered.x, y: detail.previousFiltered.y }
              : null,
            filtered: { x: detail.represented.x, y: detail.represented.y },
            distancePreviousFilteredToFiltered: detail.previousFiltered
              ? Math.hypot(
                  detail.represented.x - detail.previousFiltered.x,
                  detail.represented.y - detail.previousFiltered.y,
                )
              : null,
            speedScreenPxPerSec: detail.speedScreenPxPerSec,
            cutoff: detail.cutoff,
            alpha: detail.alpha,
            timeStamp: detail.represented.timeStamp,
          };
          pushLimited(c.filteredOutputs, sample, 2000);
          if (Number.isFinite(seq)) c.filteredBySeq[seq] = sample;
          if (
            Number.isFinite(previousSeq) &&
            Number.isFinite(seq) &&
            seq <= previousSeq
          )
            c.backwardSequenceCount++;
          c.lastFilteredSeq = seq;
        }
      }
    }

    _oneEuroSpeedBucket(speedPxPerSec) {
      if (!Number.isFinite(speedPxPerSec)) return "slow";
      const speedPxPerMs = speedPxPerSec / 1000;
      if (speedPxPerMs <= 0.15) return "slow";
      if (speedPxPerMs <= 0.45) return "medium";
      if (speedPxPerMs <= 1.0) return "fast";
      return "veryFast";
    }

    _emitCurveReconstructionSegment(flushNewest) {
      const buf = this.curveBuf;
      if (!buf.length) return [];
      const end = flushNewest
        ? buf[buf.length - 1]
        : buf.length >= 3
          ? buf[1]
          : null;
      if (!end || this.curveLastEmittedSeq === end._debugSeq) return [];

      const startPoint = this.curveLastRepresentedPoint || this.lastRaw || buf[0];
      const start = {
        x: startPoint.x,
        y: startPoint.y,
        pressure:
          Number.isFinite(startPoint.pressure) ? startPoint.pressure : end.pressure,
        timeStamp: Number.isFinite(startPoint.timeStamp)
          ? startPoint.timeStamp
          : end.timeStamp,
        _debugSeq: this.curveLastEmittedSeq,
      };
      const rawCurrent = buf[buf.length - 1];
      const meta = this._curveReconstructionControls(start, end, rawCurrent, flushNewest);
      const subdivisions = this._curveReconstructionSubdivisionCount(
        start,
        meta.c1,
        meta.c2,
        end,
        meta.lineFallback,
      );
      const out = [];
      for (let i = 1; i <= subdivisions; i++) {
        const t = i / subdivisions;
        const mt = 1 - t;
        const x = meta.lineFallback
          ? start.x + (end.x - start.x) * t
          : mt * mt * mt * start.x +
            3 * mt * mt * t * meta.c1.x +
            3 * mt * t * t * meta.c2.x +
            t * t * t * end.x;
        const y = meta.lineFallback
          ? start.y + (end.y - start.y) * t
          : mt * mt * mt * start.y +
            3 * mt * mt * t * meta.c1.y +
            3 * mt * t * t * meta.c2.y +
            t * t * t * end.y;
        out.push({
          x,
          y,
          pressure: start.pressure + (end.pressure - start.pressure) * t,
          timeStamp: start.timeStamp + (end.timeStamp - start.timeStamp) * t,
          _debugSeq: end._debugSeq,
          _debugRepresentedSeq: end._debugSeq,
          _debugGeneratedSubdivision: i < subdivisions,
        });
      }
      this.lastRaw = { x: end.x, y: end.y };
      this.curveLastEmittedSeq = end._debugSeq;
      this.curveLastRepresentedPoint = {
        x: end.x,
        y: end.y,
        pressure: end.pressure,
        timeStamp: end.timeStamp,
        _debugSeq: end._debugSeq,
      };
      this._recordCurveReconstructionDiagnostics({
        start,
        end,
        rawCurrent,
        rawPrevious: buf[0] || null,
        subdivisions,
        lineFallback: meta.lineFallback,
        fallbackReason: meta.fallbackReason,
        cornerReduced: meta.cornerReduced,
        duplicatePoint: meta.duplicatePoint,
      });
      return out;
    }

    _curveReconstructionControls(start, end, rawCurrent, flushNewest) {
      const c1 = { x: start.x, y: start.y };
      const c2 = { x: end.x, y: end.y };
      const dt = end.timeStamp - start.timeStamp;
      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      let lineFallback = !!flushNewest;
      let cornerReduced = false;
      let duplicatePoint = false;
      let fallbackReason = flushNewest ? "finishFlush" : null;
      if (dt <= 0 || dist <= 1e-6) {
        lineFallback = true;
        if (dt <= 0) fallbackReason = "zeroTimeDelta";
        if (dist <= 1e-6) {
          duplicatePoint = true;
          fallbackReason = "duplicateSegmentEndpoints";
        }
      }
      if (!lineFallback) {
        const prev = this.curveBuf[0] || start;
        const next = rawCurrent || end;
        if (!prev) {
          lineFallback = true;
          fallbackReason = "missingPreviousRaw";
        }
        if (!next) {
          lineFallback = true;
          fallbackReason = "missingLookahead";
        }
        if (lineFallback) {
          return { c1, c2, lineFallback, cornerReduced, duplicatePoint, fallbackReason };
        }
        const dtPrev = Math.max(0.001, end.timeStamp - prev.timeStamp);
        const dtNext = Math.max(0.001, next.timeStamp - start.timeStamp);
        const vStart = {
          x: (end.x - start.x) / Math.max(0.001, dt),
          y: (end.y - start.y) / Math.max(0.001, dt),
        };
        const vEnd = {
          x: (next.x - prev.x) / Math.max(0.001, dtNext),
          y: (next.y - prev.y) / Math.max(0.001, dtNext),
        };
        const before = { x: end.x - start.x, y: end.y - start.y };
        const after = { x: next.x - end.x, y: next.y - end.y };
        const beforeLen = Math.hypot(before.x, before.y);
        const afterLen = Math.hypot(after.x, after.y);
        let handleScale = 1;
        if (beforeLen <= 1e-6 || afterLen <= 1e-6) {
          duplicatePoint = true;
          lineFallback = true;
          handleScale = 0;
          if (beforeLen <= 1e-6) fallbackReason = "zeroChordLength";
          else fallbackReason = "duplicateLookahead";
        } else {
          const cos =
            (before.x * after.x + before.y * after.y) /
            Math.max(1e-9, beforeLen * afterLen);
          if (cos < Math.cos((70 * Math.PI) / 180)) {
            handleScale = Math.max(0.15, (cos + 1) * 0.35);
            cornerReduced = true;
          }
        }
        const maxHandle = dist * 0.45;
        let h1 = {
          x: vStart.x * dt / 3,
          y: vStart.y * dt / 3,
        };
        let h2 = {
          x: vEnd.x * dt / 3,
          y: vEnd.y * dt / 3,
        };
        if (
          !Number.isFinite(h1.x) ||
          !Number.isFinite(h1.y) ||
          !Number.isFinite(h2.x) ||
          !Number.isFinite(h2.y)
        ) {
          return {
            c1,
            c2,
            lineFallback: true,
            cornerReduced,
            duplicatePoint,
            fallbackReason: "invalidTangent",
          };
        }
        h1 = this._clampHandle(h1, maxHandle * handleScale);
        h2 = this._clampHandle(h2, maxHandle * handleScale);
        c1.x = start.x + h1.x;
        c1.y = start.y + h1.y;
        c2.x = end.x - h2.x;
        c2.y = end.y - h2.y;
      }
      return { c1, c2, lineFallback, cornerReduced, duplicatePoint, fallbackReason };
    }

    _clampHandle(handle, maxLen) {
      const len = Math.hypot(handle.x, handle.y);
      if (!Number.isFinite(len) || len <= 1e-9 || maxLen <= 0)
        return { x: 0, y: 0 };
      if (len <= maxLen) return handle;
      const s = maxLen / len;
      return { x: handle.x * s, y: handle.y * s };
    }

    _curveReconstructionSubdivisionCount(start, c1, c2, end, lineFallback) {
      const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
      const chord = Math.hypot(end.x - start.x, end.y - start.y) * zoomValue;
      if (lineFallback) return Math.max(1, Math.ceil(chord / 1.5));
      const controlNet =
        Math.hypot(c1.x - start.x, c1.y - start.y) +
        Math.hypot(c2.x - c1.x, c2.y - c1.y) +
        Math.hypot(end.x - c2.x, end.y - c2.y);
      const excess = Math.max(0, (controlNet - Math.hypot(end.x - start.x, end.y - start.y)) * zoomValue);
      return Math.max(1, Math.min(12, Math.ceil(chord / 1.5 + excess / 0.35)));
    }

    _recordCurveReconstructionDiagnostics(detail) {
      const d = curveReconstructionData();
      if (!d || !detail || !detail.end || !detail.rawCurrent) return;
      const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
      const gap = Math.hypot(
        detail.rawCurrent.x - detail.end.x,
        detail.rawCurrent.y - detail.end.y,
      ) * zoomValue;
      pushLimited(d.values.rawToRepresentedScreenPx, gap);
      pushLimited(d.values.subdivisionsPerSegment, detail.subdivisions);
      d.reconstructedSegmentCount++;
      d.generatedSubdivisionCount += Math.max(0, detail.subdivisions - 1);
      if (detail.lineFallback) {
        d.lineFallbackCount++;
        const reason = detail.fallbackReason || "other";
        if (!d.fallbackReasons[reason]) d.fallbackReasons[reason] = 0;
        d.fallbackReasons[reason]++;
        if (d.failedSamples.length < 10) {
          const start = detail.start || {};
          const mid = detail.end || {};
          const next = detail.rawCurrent || {};
          const prev = detail.rawPrevious || {};
          d.failedSamples.push({
            rawSeqNm2: Number.isFinite(prev._debugSeq) ? prev._debugSeq : null,
            rawSeqNm1: Number.isFinite(mid._debugSeq) ? mid._debugSeq : null,
            rawSeqN: Number.isFinite(next._debugSeq) ? next._debugSeq : null,
            previousRepresentedSeq: Number.isFinite(start._debugSeq)
              ? start._debugSeq
              : null,
            pNm2: { x: prev.x, y: prev.y },
            pNm1: { x: mid.x, y: mid.y },
            pN: { x: next.x, y: next.y },
            previousRepresentedPoint: { x: start.x, y: start.y },
            chordLength: Math.hypot(mid.x - start.x, mid.y - start.y),
            previousToMiddleDistance: Math.hypot(mid.x - prev.x, mid.y - prev.y),
            middleToLookaheadDistance: Math.hypot(next.x - mid.x, next.y - mid.y),
            dtPrevious: mid.timeStamp - prev.timeStamp,
            dtNext: next.timeStamp - mid.timeStamp,
            fallbackReason: reason,
          });
        }
      }
      if (detail.cornerReduced) d.cornerHandleReductionCount++;
      if (detail.duplicatePoint) d.duplicatePointCount++;
      d.latest = {
        enabled: true,
        zoom: this.settings.zoom || 1.0,
        rawSeq: detail.rawCurrent._debugSeq,
        representedSeq: detail.end._debugSeq,
        representedSeqLag: Math.max(0, detail.rawCurrent._debugSeq - detail.end._debugSeq),
        currentRawToRepresentedScreenPx: gap,
        reconstructedSegmentCount: d.reconstructedSegmentCount,
        generatedSubdivisionCount: d.generatedSubdivisionCount,
        lineFallbackCount: d.lineFallbackCount,
        cornerHandleReductionCount: d.cornerHandleReductionCount,
        duplicatePointCount: d.duplicatePointCount,
      };
    }

    _pushShortLookaheadRaw(rawSample) {
      this.lookaheadBuf.push(rawSample);
      while (this.lookaheadBuf.length > 3) this.lookaheadBuf.shift();
      if (this.lookaheadBuf.length < 3) return null;
      return this._emitShortLookaheadRepresented(false);
    }

    _emitShortLookaheadRepresented(flushNewest) {
      const buf = this.lookaheadBuf;
      if (!buf.length) return null;
      const represented = flushNewest
        ? buf[buf.length - 1]
        : buf.length >= 3
          ? buf[1]
          : null;
      if (!represented) return null;
      if (this.lookaheadLastEmittedSeq === represented._debugSeq) return null;
      this._recordShortLookaheadTangentDiagnostics(flushNewest);
      this.lastRaw = { x: represented.x, y: represented.y };
      this.lookaheadLastEmittedSeq = represented._debugSeq;
      return {
        x: represented.x,
        y: represented.y,
        pressure: represented.pressure,
        timeStamp: represented.timeStamp,
        _debugSeq: represented._debugSeq,
      };
    }

    _recordShortLookaheadTangentDiagnostics(flushNewest) {
      const d = shortLookaheadData();
      if (!d) return;
      const buf = this.lookaheadBuf;
      const currentRaw = buf[buf.length - 1];
      const represented = flushNewest
        ? currentRaw
        : buf.length >= 3
          ? buf[1]
          : currentRaw;
      if (!currentRaw || !represented) return;
      const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
      const gap = Math.hypot(
        currentRaw.x - represented.x,
        currentRaw.y - represented.y,
      ) * zoomValue;
      pushLimited(d.values.rawToRepresentedScreenPx, gap);
      d.segmentCount++;

      let lineFallback = !!flushNewest || buf.length < 3;
      let tangentClamp = false;
      if (buf.length >= 3 && !flushNewest) {
        const a = buf[0], b = buf[1], c = buf[2];
        const dtAB = b.timeStamp - a.timeStamp;
        const dtBC = c.timeStamp - b.timeStamp;
        const ab = Math.hypot(b.x - a.x, b.y - a.y);
        const bc = Math.hypot(c.x - b.x, c.y - b.y);
        if (dtAB <= 0 || dtBC <= 0 || ab <= 1e-6 || bc <= 1e-6) {
          lineFallback = true;
        } else {
          const vABx = (b.x - a.x) / dtAB;
          const vABy = (b.y - a.y) / dtAB;
          const vBCx = (c.x - b.x) / dtBC;
          const vBCy = (c.y - b.y) / dtBC;
          const dot = vABx * vBCx + vABy * vBCy;
          const magAB = Math.hypot(vABx, vABy);
          const magBC = Math.hypot(vBCx, vBCy);
          const cos = dot / Math.max(1e-9, magAB * magBC);
          const turnIsSharp = cos < Math.cos((110 * Math.PI) / 180);
          lineFallback = turnIsSharp;
          const tangentMag = Math.hypot((vABx + vBCx) * 0.5, (vABy + vBCy) * 0.5);
          const maxExpected = Math.max(magAB, magBC) * 1.5;
          tangentClamp = tangentMag > maxExpected;
        }
      }
      if (lineFallback) d.lineFallbackCount++;
      if (tangentClamp) d.tangentClampCount++;
      d.latest = {
        enabled: true,
        zoom: this.settings.zoom || 1.0,
        rawSeq: currentRaw._debugSeq,
        representedSeq: represented._debugSeq,
        lookaheadSamples: Math.max(0, currentRaw._debugSeq - represented._debugSeq),
        currentRawToRepresentedScreenPx: gap,
        segmentCount: d.segmentCount,
        lineFallbackCount: d.lineFallbackCount,
        tangentClampCount: d.tangentClampCount,
      };
    }

    _updateScreenSpeed(inputRaw, timeStamp) {
      if (!inputRaw || !Number.isFinite(timeStamp)) return;
      const prev = this.lastInputForSpeed;
      if (prev && Number.isFinite(prev.timeStamp)) {
        const dt = Math.max(0.001, timeStamp - prev.timeStamp);
        const zoomValue = Math.max(0.0001, Number(this.settings.zoom) || 1.0);
        const dist = Math.hypot(inputRaw.x - prev.x, inputRaw.y - prev.y);
        this.currentSpeedScreenPxPerMs = (dist * zoomValue) / dt;
      } else {
        this.currentSpeedScreenPxPerMs = 0;
      }
      const g = debugRoot();
      const config =
        g && g.HardRoundDebugSharedTrajectorySpeedAdaptiveWindow;
      const alpha =
        config &&
        Number.isFinite(Number(config.speedEmaAlpha)) &&
        Number(config.speedEmaAlpha) > 0 &&
        Number(config.speedEmaAlpha) <= 1
          ? Number(config.speedEmaAlpha)
          : 0.35;
      this.smoothedSpeedScreenPxPerMs =
        this.smoothedSpeedScreenPxPerMs > 0
          ? this.smoothedSpeedScreenPxPerMs +
            (this.currentSpeedScreenPxPerMs - this.smoothedSpeedScreenPxPerMs) *
              alpha
          : this.currentSpeedScreenPxPerMs;
      this.lastInputForSpeed = {
        x: inputRaw.x,
        y: inputRaw.y,
        timeStamp,
      };
    }

    _recordSpeedAdaptiveDiagnostic(outputSample) {
      const selection = this.lastPositionWindowSelection;
      if (!selection || selection.source !== "speed") return;
      const d = speedAdaptiveData();
      if (!d) return;
      const bucket = selection.bucket || "unknown";
      if (d.bucketCounts[bucket] == null) d.bucketCounts[bucket] = 0;
      d.bucketCounts[bucket]++;
      const key = String(selection.window);
      d.windowCounts[key] = (d.windowCounts[key] || 0) + 1;
      d.latest = {
        zoom: this.settings.zoom || 1.0,
        currentSpeedScreenPxPerMs: selection.currentSpeedScreenPxPerMs || 0,
        smoothedSpeedScreenPxPerMs: selection.smoothedSpeedScreenPxPerMs || 0,
        selectedBucket: bucket,
        selectedWindow: selection.window,
        overrideSource: selection.source,
        rawInputSeq:
          outputSample && Number.isFinite(outputSample._debugSeq)
            ? outputSample._debugSeq
            : null,
        emittedSeq:
          outputSample && Number.isFinite(outputSample._debugSeq)
            ? outputSample._debugSeq
            : null,
      };
    }

    tickHold(dtMs) {
      if (!this.drawing || !this.lastInputRaw || !this.lastRaw) return [];
      if (shortLookaheadEnabled() || curveReconstructionEnabled()) return [];
      if (oneEuroEnabled(this.settings) && this.oneEuro) {
        // Raw One Euro input bypasses smoothBuf. Replaying that buffer here
        // would reconnect the stroke to its old, pre-filter position.
        const alpha = this._oneEuroAlpha(oneEuroConfig().minCutoff,
          Math.max(0, Math.min(dtMs, 100)) / 1000);
        const previous = this.lastRaw;
        this.oneEuro.x += (this.lastInputRaw.x - this.oneEuro.x) * alpha;
        this.oneEuro.y += (this.lastInputRaw.y - this.oneEuro.y) * alpha;
        this.lastRaw = { x: this.oneEuro.x, y: this.oneEuro.y };
        this.delayedPressure = this._pushPressureBuf(this.lastInputPressure);
        if (Math.hypot(previous.x - this.lastRaw.x, previous.y - this.lastRaw.y) <= 1e-4)
          return [];
        return [{ ...this.lastRaw, pressure: this.delayedPressure,
          timeStamp: performance.now(), _debugSeq: this.oneEuroRepresentedSeq }];
      }
      const dt = Math.min(dtMs, 100);
      const catchUpDurationMs = 350;
      const ticksPerMs = this._movingAverageAmount("position") / catchUpDurationMs;
      const ticks = Math.max(1, Math.round(dt * ticksPerMs));

      const out = [];
      for (let i = 0; i < ticks; i++) {
        const raw = this._pushSmoothBuf(this.lastInputRaw);
        this.delayedPressure = this._pushPressureBuf(this.lastInputPressure);
        const dx = raw.x - this.lastRaw.x;
        const dy = raw.y - this.lastRaw.y;
        this.lastRaw = raw;
        if (Math.hypot(dx, dy) <= 1e-4) break;

        out.push({
          x: raw.x,
          y: raw.y,
          pressure: this.delayedPressure,
          timeStamp: performance.now(),
        });
      }
      return out;
    }

    finishStroke() {
      if (!this.drawing) return [];
      const out = [];
      if (shortLookaheadEnabled()) {
        const represented = this._emitShortLookaheadRepresented(true);
        if (represented) out.push(represented);
        this.drawing = false;
        return out;
      }
      if (curveReconstructionEnabled()) {
        out.push(...this._emitCurveReconstructionSegment(true));
        this.drawing = false;
        return out;
      }
      if (oneEuroEnabled(this.settings)) {
        if (this.lastInputRaw && this.lastRaw) {
          const dx = this.lastInputRaw.x - this.lastRaw.x;
          const dy = this.lastInputRaw.y - this.lastRaw.y;
          if (Math.hypot(dx, dy) > 1e-6) {
            this.lastRaw = { x: this.lastInputRaw.x, y: this.lastInputRaw.y };
            out.push({
              x: this.lastInputRaw.x,
              y: this.lastInputRaw.y,
              pressure: this.delayedPressure,
              timeStamp: performance.now(),
              _debugSeq: this.oneEuroRawSeq,
            });
          }
        }
        this.drawing = false;
        return out;
      }
      const amount = this._movingAverageAmount("position");
      for (let i = 0; i < amount * 2; i++) {
        const raw = this._pushSmoothBuf(this.lastInputRaw);
        this.delayedPressure = this._pushPressureBuf(this.lastInputPressure);
        const dx = raw.x - this.lastRaw.x;
        const dy = raw.y - this.lastRaw.y;
        this.lastRaw = raw;

        out.push({
          x: raw.x,
          y: raw.y,
          pressure: this.delayedPressure,
          timeStamp: performance.now(),
        });

        if (Math.hypot(dx, dy) <= 1e-4) break;
      }
      this.drawing = false;
      return out;
    }
  }

  const Exports = { StrokeTrajectoryCore, normalizeRawPressure, zoomStabilizationMinimum };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Exports;
  }
  if (root) {
    root.StrokeTrajectoryCoreModule = Exports;
  }
})(typeof self !== "undefined" ? self : this);
