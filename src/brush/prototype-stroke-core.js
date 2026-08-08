// src/brush/prototype-stroke-core.js
//
// Phase 8B — extracted from prototype/prototype.html.
//
// This module owns ONLY:
//   - raw pressure normalization
//   - effective/contact pressure handling
//   - pressure smoothing (moving average)
//   - position stabilization (moving average)
//   - stroke sample buffering
//   - midpoint/quadratic interpolation
//   - stroke finalization / finish replay behavior
//   - resolved sample/segment output
//
// It does NOT own (and must never import/touch):
//   - GPU rendering, CPU rasterization, shaders
//   - layers, frames, timeline, undo
//   - active canvas / renderer activation
//   - brush presets, custom tips, textures
//   - Smart Raster, Transform
//
// SOURCE OF TRUTH: the live JavaScript path in prototype/prototype.html
// (the useWebGPU branch). The prototype's embedded WASM module is
// instantiated there but never called from the live stroke path (Phase 8A
// finding) — it is intentionally NOT ported here.
//
// -----------------------------------------------------------------------
// Adaptations made to decouple this from the prototype's browser/rAF/view
// context (documented explicitly, per Phase 8B instructions, rather than
// silently "improving" the original behavior):
//
//  1. Coordinates in/out of this module are in whatever space the caller
//     supplies (the prototype's `screenToCanvas`, which applies pan/zoom/
//     supersample-factor conversion, is a view/rendering concern owned
//     elsewhere and is not reproduced here).
//
//  2. The prototype queues raw pointer samples (`pendingStrokeSamples`)
//     and drains them once per animation frame (`flushPendingStrokeSamples`
//     via `strokeHoldTick`/rAF). That queueing exists purely to batch
//     browser pointer events to the display's frame rate — it is not part
//     of the actual pressure/stabilization math. This module instead
//     processes whatever batch of samples the caller passes to
//     `pushSamples()` immediately and synchronously, preserving the
//     *within-batch* and *across-batch* ordering/smoothing semantics
//     exactly, without reproducing the rAF scheduling itself.
//
//  3. `strokeHoldTick`'s "replay the last known input while the pen is
//     held still" behavior is preserved as `tickHold(dtMs)`, which the
//     caller invokes with an explicit elapsed-time delta (instead of the
//     prototype's implicit rAF timestamp), so it is deterministic and
//     testable outside a browser.
//
//  4. `endStroke`/`finishTick`'s accelerated finish replay is time-paced
//     in the prototype (real elapsed ms since pointer-up, via rAF). For a
//     deterministic, headless module this module runs the same tick
//     formulas synchronously using a fixed nominal frame delta
//     (`FINISH_TICK_DT_MS`, 16.7ms — a typical display frame interval)
//     until the finish converges, instead of waiting on real wall-clock
//     time. The per-tick math (pacing curve, moving-average draining,
//     stationary-hold vs moving-release pressure handling) is otherwise
//     unchanged from the prototype.
//
//  5. `computeWasStoppedBeforeLift`'s check against samples still sitting
//     in `pendingStrokeSamples` doesn't apply here because this module has
//     no async queue (see #2) — samples are always processed before
//     `finishStroke()` can see them. The stationary/moving classification
//     is preserved using the same `HOLD_BEFORE_LIFT_MS` idle-time
//     threshold against the last real movement.
//
//  6. Paint-only concepts that have no meaning outside a renderer —
//     `pressureAlpha` (constant opacity), backing-store/supersample radius
//     math (`SS`, `MIN_ABS_RADIUS_BACKING`) — are NOT ported. Instead this
//     module exposes `pressureInfluence` (the prototype's
//     `Math.pow(pressure, 1.2)` ease-in curve), which later phases can
//     combine with a brush size and any renderer-specific floor/backing
//     scale to compute an actual radius. This keeps the module ignorant of
//     supersampling/backing-store details, per the Phase 8A boundary.
//
//  7. Long-jump curve subdivision (`maxStep`) used
//     `scaledBrushSize() * 0.6` where `scaledBrushSize = getBrushSize() *
//     SS`. Since this module doesn't own the supersample factor, the
//     equivalent here is `settings.brushSize * subdivisionScale` (default
//     `subdivisionScale = 0.6`), operating in the caller's coordinate
//     space. Callers that supersample their own space should pass an
//     already-scaled `brushSize`.
//
// Everything else (pressure normalization formula, contact-pressure
// tracking, release-tail classification, moving-average window sizing,
// zoom-based stabilization compensation, midpoint-quadratic tessellation,
// stationary-hold vs moving-release finish selection, and the finish
// pacing curve) is ported with the same formulas and ordering as the
// prototype.

'use strict';

// ---- Ported constants (identical values to prototype/prototype.html) ----

const CONTACT_PRESSURE_FLOOR = 0.02;
const HOLD_BEFORE_LIFT_MS = 120;

const ZOOM_COMP_MIN_ZOOM = 0.05;   // zoom (5%) at which the hidden minimum is largest
const ZOOM_COMP_ZERO_ZOOM = 5.0;   // zoom (500%) at which the hidden minimum reaches 0
const ZOOM_COMP_MAX_AMOUNT = 0.15; // largest hidden stabilization added, at ZOOM_COMP_MIN_ZOOM
const ZOOM_COMP_FADE_UI_LIMIT = 0.20; // UI stabilization (0-1) above which no compensation remains

const MIN_FINISH_MS = 80;
const MAX_FINISH_MS = 260;
const FINISH_TICK_DT_MS = 16.7; // nominal display frame interval (see adaptation #4 above)
const FINISH_TICK_MAX_TICKS = 100000; // safety bound against infinite loop in headless replay

const JITTER_FLOOR_BASE_PX = 1.5;
const DEFAULT_SUBDIVISION_SCALE = 0.6;
const DEFAULT_MIN_STEP_PX = 2;

// ---- Small pure helpers (ported) ----------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function zoomSmoothingFactor(zoom) {
  return Math.min(4, Math.max(1, 1 / (zoom || 1)));
}

// Ported from prototype `getPressure`. Callers already know the pointer
// type and raw hardware pressure; this only normalizes it.
function normalizeRawPressure(pointerType, rawPressure) {
  if (pointerType === 'pen' && typeof rawPressure === 'number') {
    return clamp01(rawPressure);
  }
  if (pointerType === 'mouse') return 1;
  return typeof rawPressure === 'number' ? clamp01(rawPressure) : 1;
}

// Ported from prototype `pressureInfluence`. Pressure controls a
// renderer's dab diameter via a mild ease-in; this module exposes the
// influence value only, not a pixel radius (see adaptation #6 above).
function pressureInfluence(pressure) {
  const p = clamp01(pressure == null ? 1 : pressure);
  return Math.pow(p, 1.2);
}

// Ported from prototype `isReleaseTailSample`.
function isReleaseTailSample({
  pointerType, idleGapMs, screenDistance, pressure,
  previousContactPressure, continuing, previousTailPressure
}) {
  if (pointerType !== 'pen' || idleGapMs <= 250 || screenDistance > 1.25) return false;
  if (!Number.isFinite(pressure) || pressure > 0.20) return false;
  const sharplyLower = previousContactPressure > CONTACT_PRESSURE_FLOOR &&
    pressure <= previousContactPressure * 0.75;
  const stillFalling = continuing && pressure <= previousTailPressure;
  return sharplyLower || stillFalling;
}

// Ported from prototype `zoomStabilizationMinimum`.
function zoomStabilizationMinimum(z) {
  const clampedZoom = Math.min(Math.max(z, ZOOM_COMP_MIN_ZOOM), ZOOM_COMP_ZERO_ZOOM);
  const logMin = Math.log(ZOOM_COMP_MIN_ZOOM);
  const logMax = Math.log(ZOOM_COMP_ZERO_ZOOM);
  const t = (Math.log(clampedZoom) - logMin) / (logMax - logMin);
  return ZOOM_COMP_MAX_AMOUNT * (1 - t);
}

// Ported from prototype `zoomCompensationWeight`.
function zoomCompensationWeight(userAmount) {
  const edge0 = 0, edge1 = ZOOM_COMP_FADE_UI_LIMIT;
  const t = Math.min(Math.max((userAmount - edge0) / (edge1 - edge0), 0), 1);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

function smoothstep01(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

// -----------------------------------------------------------------------
// PrototypeStrokeCore
//
// One instance is intended to represent one in-progress stroke's buffers.
// Create a fresh instance (or call beginStroke) for every new stroke.
// -----------------------------------------------------------------------

class PrototypeStrokeCore {
  /**
   * @param {object} [settings]
   * @param {number} [settings.brushSize=10] - caller-space brush size, used
   *   only for long-jump curve subdivision (see adaptation #7). Rendering
   *   phases decide the actual dab radius from `pressureInfluence`.
   * @param {number} [settings.stabilization=0] - UI stabilization amount, 0-1.
   * @param {number} [settings.zoom=1] - current view zoom, used only for the
   *   prototype's hidden zoom-compensation minimum.
   * @param {number} [settings.subdivisionScale=0.6]
   * @param {number} [settings.minStepPx=2]
   * @param {boolean} [settings.debugConstantPressure=false] - mirrors the
   *   prototype's `setStabDebugConstantPressure` debug hook.
   */
  constructor(settings = {}) {
    this._resetBuffers();
    this.updateSettings(settings);
  }

  updateSettings(settings = {}) {
    this.settings = Object.assign({
      brushSize: 10,
      stabilization: 0,
      zoom: 1,
      subdivisionScale: DEFAULT_SUBDIVISION_SCALE,
      minStepPx: DEFAULT_MIN_STEP_PX,
      debugConstantPressure: false,
    }, this.settings || {}, settings);
  }

  _resetBuffers() {
    this.drawing = false;
    this.strokeMoved = false;

    this.prevRaw = null;
    this.lastRaw = null;
    this.lastMid = null;
    this.lastInfluence = null; // last resolved pressureInfluence at lastRaw
    this.lastPressure = null;  // last resolved (smoothed) pressure at lastRaw

    this.smoothBuf = [];
    this.pressureBuf = [];

    this.lastInputRaw = null;
    this.lastInputPressure = 0;
    this.lastContactPressure = 0;
    this.delayedPressure = 0;

    this.positionBufferAdvanceCount = 0;
    this.pressureBufferAdvanceCount = 0;

    this.recentSpeedPxMs = 0;
    this.lastVelRaw = null;
    this.lastVelTime = 0;

    this.releaseTailClassifierActive = false;
    this.releaseTailLastPressure = Infinity;

    this.lastMoveEventTime = 0;
  }

  // ---- internal: moving-average window sizing (ported) ------------------

  _computeInternalStabilization() {
    const userAmount = clamp01(this.settings.stabilization);
    const zoomMinimum = zoomStabilizationMinimum(this.settings.zoom);
    const compensationWeight = zoomCompensationWeight(userAmount);
    return Math.min(1, Math.max(0, userAmount + zoomMinimum * compensationWeight));
  }

  _movingAverageAmount() {
    const internalAmount = this._computeInternalStabilization();
    if (internalAmount <= 0) return 1;
    return Math.max(2, Math.round(internalAmount * 100));
  }

  _pushPressureBuf(p) {
    const maxLen = this._movingAverageAmount();
    this.pressureBuf.push(p);
    while (this.pressureBuf.length > maxLen) this.pressureBuf.shift();
    if (maxLen === 1) return p;
    let s = 0;
    for (const v of this.pressureBuf) s += v;
    return s / this.pressureBuf.length;
  }

  _pushSmoothBuf(p) {
    const maxLen = this._movingAverageAmount();
    this.smoothBuf.push({ x: p.x, y: p.y });
    while (this.smoothBuf.length > maxLen) this.smoothBuf.shift();
    if (maxLen === 1) return { x: p.x, y: p.y };
    let sx = 0, sy = 0;
    for (const pt of this.smoothBuf) { sx += pt.x; sy += pt.y; }
    return { x: sx / this.smoothBuf.length, y: sy / this.smoothBuf.length };
  }

  _effectivePressure(p) {
    return this.settings.debugConstantPressure ? 0.7 : p;
  }

  _trackVelocity(raw, timeStamp) {
    const now = Number.isFinite(timeStamp) ? timeStamp : (this.lastVelTime + FINISH_TICK_DT_MS);
    if (this.lastVelRaw && this.lastVelTime) {
      const dt = now - this.lastVelTime;
      if (dt > 0) {
        const dist = Math.hypot(raw.x - this.lastVelRaw.x, raw.y - this.lastVelRaw.y);
        const inst = dist / dt;
        this.recentSpeedPxMs = this.recentSpeedPxMs * 0.7 + inst * 0.3;
      }
    }
    this.lastVelRaw = raw;
    this.lastVelTime = now;
  }

  // ---- internal: midpoint/quadratic interpolation (ported) --------------
  //
  // Ported from `drawQuadCurve` + `feedPoint`. The prototype emits GPU
  // vertex floats per tessellation step; this emits plain segment records
  // {x0,y0,pressure0,influence0,x1,y1,pressure1,influence1} instead, per
  // the Phase 8B output contract.

  _drawQuadCurve(out, p0, control, p1, influence0, influence1, pressure0, pressure1, steps) {
    let prevPt = p0;
    let prevInfluence = influence0;
    let prevPressure = pressure0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const x = mt * mt * p0.x + 2 * mt * t * control.x + t * t * p1.x;
      const y = mt * mt * p0.y + 2 * mt * t * control.y + t * t * p1.y;
      const influence = influence0 + (influence1 - influence0) * t;
      const pressure = pressure0 + (pressure1 - pressure0) * t;
      out.push({
        x0: prevPt.x, y0: prevPt.y, pressure0: prevPressure, influence0: prevInfluence,
        x1: x, y1: y, pressure1: pressure, influence1: influence,
      });
      prevPt = { x, y };
      prevInfluence = influence;
      prevPressure = pressure;
    }
    return prevPt;
  }

  _feedPoint(out, raw, pressure) {
    this.strokeMoved = true;
    const influence = pressureInfluence(pressure);
    const midStart = this.lastMid;
    const midEnd = { x: (this.lastRaw.x + raw.x) / 2, y: (this.lastRaw.y + raw.y) / 2 };
    const startInfluence = this.lastInfluence == null ? influence : this.lastInfluence;
    const startPressure = this.lastPressure == null ? pressure : this.lastPressure;
    this.lastMid = this._drawQuadCurve(
      out, midStart, this.lastRaw, midEnd,
      startInfluence, influence, startPressure, pressure, 10
    );
    this.lastInfluence = influence;
    this.lastPressure = pressure;
    this.prevRaw = this.lastRaw;
    this.lastRaw = raw;
  }

  // ---- public API ---------------------------------------------------

  /**
   * Begins a new stroke.
   * @param {{x:number,y:number,pressure:number,pointerType?:string,timeStamp?:number}} sample
   * @param {object} [settings] - optional settings update (see constructor).
   * @returns {{x0,y0,pressure0,influence0,x1,y1,pressure1,influence1}} the
   *   initial zero-length "dab" segment (x0==x1, y0==y1) representing the
   *   stroke's starting point, matching the prototype's initial
   *   `circleVerts` dab at pointer-down.
   */
  beginStroke(sample, settings) {
    if (settings) this.updateSettings(settings);
    this._resetBuffers();

    const p = { x: sample.x, y: sample.y };
    this.drawing = true;
    this.prevRaw = p;
    this.lastRaw = p;
    this.lastMid = p;
    this.strokeMoved = false;

    const amount = this._movingAverageAmount();
    // Prefill both buffers to the full moving-average window length at
    // stroke start (ported exactly): otherwise stabilization strength
    // ramps from "off" to "full" over the first N samples instead of
    // being constant from the very first move.
    this.smoothBuf = Array.from({ length: amount }, () => ({ x: p.x, y: p.y }));

    const rawPressure = normalizeRawPressure(sample.pointerType, sample.pressure);
    const startPressure = this._effectivePressure(rawPressure);
    this.pressureBuf = Array.from({ length: amount }, () => startPressure);
    this.delayedPressure = startPressure;
    this.lastInputRaw = p;
    this.lastInputPressure = startPressure;
    this.lastContactPressure = startPressure;

    this.positionBufferAdvanceCount = 0;
    this.pressureBufferAdvanceCount = 0;
    this.recentSpeedPxMs = 0;
    this.lastVelRaw = p;
    this.lastVelTime = Number.isFinite(sample.timeStamp) ? sample.timeStamp : 0;
    this.lastMoveEventTime = this.lastVelTime;

    this.releaseTailClassifierActive = false;
    this.releaseTailLastPressure = Infinity;

    const influence = pressureInfluence(startPressure);
    this.lastInfluence = influence;
    this.lastPressure = startPressure;

    return {
      x0: p.x, y0: p.y, pressure0: startPressure, influence0: influence,
      x1: p.x, y1: p.y, pressure1: startPressure, influence1: influence,
    };
  }

  /**
   * Processes a batch of real input samples (already in caller coordinate
   * space; typically the coalesced events of one pointermove). Mirrors
   * `processStrokeBatch` (ported minus the rAF queueing — see adaptation #2).
   *
   * @param {Array<{x:number,y:number,pressure:number,pointerType?:string,timeStamp?:number}>} samples
   * @returns {Array<object>} resolved segments produced by this batch.
   */
  pushSamples(samples) {
    if (!this.drawing || !samples || !samples.length) return [];

    const maxStep = Math.max(
      this.settings.minStepPx,
      this.settings.brushSize * this.settings.subdivisionScale
    );

    const out = [];
    for (const ev of samples) {
      const inputRaw = { x: ev.x, y: ev.y };
      const rawPressure = normalizeRawPressure(ev.pointerType, ev.pressure);
      const pressure = this._effectivePressure(rawPressure);
      const timeStamp = Number.isFinite(ev.timeStamp) ? ev.timeStamp : (this.lastVelTime + FINISH_TICK_DT_MS);
      this._trackVelocity(inputRaw, timeStamp);

      const JITTER_FLOOR_PX = JITTER_FLOOR_BASE_PX * zoomSmoothingFactor(this.settings.zoom);
      const idleGapMs = timeStamp - this.lastMoveEventTime;
      const movementDistance = this.lastInputRaw
        ? Math.hypot(inputRaw.x - this.lastInputRaw.x, inputRaw.y - this.lastInputRaw.y) : 0;
      const releaseTailSample = isReleaseTailSample({
        pointerType: ev.pointerType || 'unknown',
        idleGapMs,
        screenDistance: movementDistance * this.settings.zoom,
        pressure: rawPressure,
        previousContactPressure: this.lastContactPressure,
        continuing: this.releaseTailClassifierActive,
        previousTailPressure: this.releaseTailLastPressure,
      });

      if (!this.lastInputRaw || movementDistance > JITTER_FLOOR_PX) {
        if (!releaseTailSample) {
          this.lastMoveEventTime = timeStamp;
          this.releaseTailClassifierActive = false;
        } else {
          this.releaseTailClassifierActive = true;
          this.releaseTailLastPressure = rawPressure;
        }
      }

      this.lastInputRaw = inputRaw;
      this.lastInputPressure = pressure;
      if (pressure > CONTACT_PRESSURE_FLOOR) this.lastContactPressure = pressure;

      this.delayedPressure = this._pushPressureBuf(pressure);
      this.pressureBufferAdvanceCount++;
      const raw = this._pushSmoothBuf(inputRaw);
      this.positionBufferAdvanceCount++;

      const jumpDx = raw.x - this.lastRaw.x, jumpDy = raw.y - this.lastRaw.y;
      const jumpDist = Math.hypot(jumpDx, jumpDy);
      if (jumpDist > maxStep) {
        const origin = this.lastRaw;
        const steps = Math.ceil(jumpDist / maxStep);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          this._feedPoint(out, {
            x: origin.x + jumpDx * t,
            y: origin.y + jumpDy * t,
          }, this.delayedPressure);
        }
      } else {
        this._feedPoint(out, raw, this.delayedPressure);
      }
    }
    return out;
  }

  /**
   * Replays the last known input position/pressure while the pointer is
   * held stationary (no new real samples this "frame"). Mirrors
   * `strokeHoldTick`'s catch-up drain, driven by an explicit dt instead of
   * an rAF timestamp (see adaptation #3).
   *
   * @param {number} dtMs - elapsed time since the previous tick, ms.
   * @returns {Array<object>} resolved segments produced by this tick.
   */
  tickHold(dtMs) {
    if (!this.drawing) return [];
    if (!this.lastInputRaw || !this.lastRaw) return [];

    const dt = Math.min(dtMs, 100); // clamp big gaps (ported)
    this.recentSpeedPxMs *= Math.max(0, 1 - dt / 120);

    const catchUpDurationMs = 350;
    const ticksPerMs = this._movingAverageAmount() / catchUpDurationMs;
    const ticks = Math.max(1, Math.round(dt * ticksPerMs));

    const out = [];
    for (let i = 0; i < ticks; i++) {
      const raw = this._pushSmoothBuf(this.lastInputRaw);
      this.positionBufferAdvanceCount++;
      this.delayedPressure = this._pushPressureBuf(this.lastInputPressure);
      this.pressureBufferAdvanceCount++;
      const dx = raw.x - this.lastRaw.x, dy = raw.y - this.lastRaw.y;
      if (Math.hypot(dx, dy) <= 1e-4) break;
      this._feedPoint(out, raw, this.delayedPressure);
    }
    return out;
  }

  // ---- internal: finish/finalization (ported) ----------------------

  _computeWasStoppedBeforeLift(nowMs) {
    if (!this.lastInputRaw) return false;
    // NOTE (adaptation #5): the prototype also inspects any samples still
    // sitting in its async pendingStrokeSamples queue here. This module has
    // no such queue — pushSamples() always processes samples synchronously
    // before finishStroke() can observe them — so that part of the check
    // is not applicable and is omitted.
    const stationaryDurationMs = (Number.isFinite(nowMs) ? nowMs : this.lastMoveEventTime) - this.lastMoveEventTime;
    return stationaryDurationMs >= HOLD_BEFORE_LIFT_MS;
  }

  /**
   * Finalizes the stroke, replaying the moving-average catch-up to the
   * lift point exactly as `endStroke`/`finishTick` do (stationary-hold vs
   * moving-release pressure handling; accelerated position catch-up).
   * Runs synchronously to a fixed nominal frame delta (adaptation #4)
   * instead of real elapsed time, so it is deterministic.
   *
   * @param {{x?:number,y?:number,pressure?:number,timeStamp?:number}} [endpointSample]
   *   the pointer-up sample. x/y default to the last known input position
   *   if omitted (matches the prototype's `e && Number.isFinite(...)` guard).
   * @returns {{segments: Array<object>, mode: 'stationary-hold'|'moving-release'|'none', ticksEmitted: number}}
   */
  finishStroke(endpointSample) {
    if (!this.drawing) return { segments: [], mode: 'none', ticksEmitted: 0 };

    const nowMs = endpointSample && Number.isFinite(endpointSample.timeStamp)
      ? endpointSample.timeStamp
      : this.lastMoveEventTime;

    const wasStoppedBeforeLift = this._computeWasStoppedBeforeLift(nowMs);

    let finishPressure;
    if (wasStoppedBeforeLift) {
      finishPressure = this.delayedPressure;
    } else {
      finishPressure = this.lastInputPressure;
    }
    this.drawing = false;

    const nextFinishPressure = () => {
      return wasStoppedBeforeLift ? finishPressure : this._pushPressureBuf(finishPressure);
    };

    if (!(this.strokeMoved && this.lastMid && this.lastRaw)) {
      this._resetBuffers();
      return { segments: [], mode: wasStoppedBeforeLift ? 'stationary-hold' : 'moving-release', ticksEmitted: 0 };
    }

    const endpoint = endpointSample && Number.isFinite(endpointSample.x) && Number.isFinite(endpointSample.y)
      ? { x: endpointSample.x, y: endpointSample.y }
      : this.lastInputRaw;

    const startDist = endpoint ? Math.hypot(endpoint.x - this.lastRaw.x, endpoint.y - this.lastRaw.y) : 0;
    const segments = [];

    if (!endpoint || startDist < 0.15) {
      if (endpoint) this._feedPoint(segments, endpoint, nextFinishPressure());
      this._resetBuffers();
      return { segments, mode: wasStoppedBeforeLift ? 'stationary-hold' : 'moving-release', ticksEmitted: segments.length ? 1 : 0 };
    }

    const targetDurationMsRaw = mix(
      MIN_FINISH_MS, MAX_FINISH_MS,
      Math.max(0, Math.min(1, startDist / 400))
    ) / Math.max(0.5, Math.min(3, 0.6 + this.recentSpeedPxMs * 1.2));
    const targetDurationMs = Math.max(MIN_FINISH_MS, Math.min(MAX_FINISH_MS, targetDurationMsRaw));

    const totalTicksNeeded = this._movingAverageAmount();
    const avgTicksPerMs = totalTicksNeeded / targetDurationMs;
    const startRatePerMs = avgTicksPerMs * 0.6;
    const endRatePerMs = avgTicksPerMs * 1.6;

    let elapsedMs = 0;
    let ticksEmitted = 0;
    let safety = 0;

    while (safety++ < FINISH_TICK_MAX_TICKS) {
      const remaining = Math.hypot(endpoint.x - this.lastRaw.x, endpoint.y - this.lastRaw.y);
      if (remaining <= 0.15 || this.smoothBuf.length === 0) {
        const finalPressure = nextFinishPressure();
        this._feedPoint(segments, endpoint, finalPressure);
        ticksEmitted++;
        break;
      }

      const dt = FINISH_TICK_DT_MS;
      elapsedMs += dt;
      const timeProgress = Math.max(0, Math.min(1, elapsedMs / targetDurationMs));
      const ticksPerMs = mix(startRatePerMs, endRatePerMs, smoothstep01(timeProgress));
      const maxTicks = this._movingAverageAmount();
      const ticks = Math.max(1, Math.min(maxTicks, Math.round(dt * ticksPerMs)));

      let producedThisFrame = false;
      for (let i = 0; i < ticks; i++) {
        const caught = this._pushSmoothBuf(endpoint);
        const stepDist = Math.hypot(caught.x - this.lastRaw.x, caught.y - this.lastRaw.y);
        if (stepDist <= 1e-4) break;
        const emittedPressure = nextFinishPressure();
        this._feedPoint(segments, caught, emittedPressure);
        ticksEmitted++;
        producedThisFrame = true;
      }
      if (!producedThisFrame) {
        // No further movement possible (already converged); emit the final
        // exact-endpoint sample and stop, mirroring the prototype's
        // `remaining <= 0.15` exit on the next tick.
        const finalPressure = nextFinishPressure();
        this._feedPoint(segments, endpoint, finalPressure);
        ticksEmitted++;
        break;
      }
    }

    this._resetBuffers();
    return { segments, mode: wasStoppedBeforeLift ? 'stationary-hold' : 'moving-release', ticksEmitted };
  }

  /**
   * Abandons the in-progress stroke without any finish replay.
   */
  cancelStroke() {
    this._resetBuffers();
  }
}

module.exports = {
  PrototypeStrokeCore,
  // exported for the deterministic test harness / future callers that need
  // the pure helpers directly without a stroke instance:
  normalizeRawPressure,
  pressureInfluence,
  isReleaseTailSample,
  HOLD_BEFORE_LIFT_MS,
  CONTACT_PRESSURE_FLOOR,
};
