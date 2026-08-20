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
    }

    updateSettings(settings = {}) {
      Object.assign(this.settings, settings);
    }

    _movingAverageAmount() {
      const uAmount = Math.max(0, Math.min(1, this.settings.stabilization || 0));
      const zMin = zoomStabilizationMinimum(this.settings.zoom || 1.0);
      const compW = zoomCompensationWeight(uAmount);
      const internalAmount = Math.min(1, Math.max(0, uAmount + zMin * compW));
      if (internalAmount <= 0) return 1;
      return Math.max(2, Math.round(internalAmount * 200));
    }

    _resetBuffers() {
      this.smoothBuf = [];
      this.pressureBuf = [];
      this.lastInputRaw = null;
      this.lastInputPressure = 1;
      this.lastRaw = null;
      this.delayedPressure = 1;
      this.lastMoveEventTime = 0;
    }

    beginStroke(sample, settings) {
      if (settings) this.updateSettings(settings);
      this._resetBuffers();

      const p = { x: sample.x, y: sample.y };
      this.drawing = true;
      this.lastRaw = p;

      const amount = this._movingAverageAmount();
      this.smoothBuf = Array.from({ length: amount }, () => ({ x: p.x, y: p.y }));

      const rawPressure = normalizeRawPressure(sample.pointerType, sample.pressure);
      this.pressureBuf = Array.from({ length: amount }, () => rawPressure);
      this.delayedPressure = rawPressure;
      this.lastInputRaw = p;
      this.lastInputPressure = rawPressure;
      this.lastMoveEventTime = Number.isFinite(sample.timeStamp) ? sample.timeStamp : performance.now();

      return {
        x: p.x,
        y: p.y,
        pressure: rawPressure,
        timeStamp: this.lastMoveEventTime,
      };
    }

    _pushSmoothBuf(p) {
      if (!this.smoothBuf || !this.smoothBuf.length) return { x: p.x, y: p.y };
      const amount = this._movingAverageAmount();
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
      const amount = this._movingAverageAmount();
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

        this.lastInputRaw = inputRaw;
        this.lastInputPressure = rawPressure;
        this.lastMoveEventTime = timeStamp;

        this.delayedPressure = this._pushPressureBuf(rawPressure);
        const raw = this._pushSmoothBuf(inputRaw);
        this.lastRaw = raw;

        out.push({
          x: raw.x,
          y: raw.y,
          pressure: this.delayedPressure,
          timeStamp,
        });
      }
      return out;
    }

    tickHold(dtMs) {
      if (!this.drawing || !this.lastInputRaw || !this.lastRaw) return [];
      const dt = Math.min(dtMs, 100);
      const catchUpDurationMs = 350;
      const ticksPerMs = this._movingAverageAmount() / catchUpDurationMs;
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
      const amount = this._movingAverageAmount();
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
