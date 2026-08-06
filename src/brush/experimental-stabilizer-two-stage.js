// experimental-stabilizer-two-stage.js
//
// ISOLATED ARCHITECTURAL EXPERIMENT — two-stage anchor + brush-follower
// model, kept entirely separate from experimental-stabilizer.js (the
// existing single-stage spring), from the production stabilizer, and
// from brush-engine.js.
//
// Purpose: this file exists ONLY to let us observe whether inserting an
// independent anchor stage between raw pointer input and the brush
// follower changes path-level travel speed the way TVPaint-style
// stabilization appears to. It is not a replacement for
// experimental-stabilizer.js and does not modify it.
//
//   Raw pointer  --[stage 1: anchor solver]-->  Anchor  --[stage 2: brush
//   follower solver]-->  Brush tip
//
// Both stages use the exact same position+velocity spring-damper model
// as experimental-stabilizer.js (semi-implicit Euler: a = (k*dx - c*v)/m,
// v += a*dt, x += v*dt), just chained: stage 2's target is stage 1's
// output instead of raw input directly.
//
// NOT TUNED. Constants below are placeholders carried over from
// experimental-stabilizer.js's own defaults (k=180, c=26, m=1) applied
// to BOTH stages, purely so the architecture can be exercised. This
// pass is about validating the state model (does a distinct anchor
// stage exist / matter), not about picking real anchor-stage constants.
//
// NOT ACTIVE BY DEFAULT — not <script>-included by index.html unless
// explicitly added for this experiment, not called from brush-engine.js
// or from the production stabilizer, and never instantiated by anything
// other than its own debug harness
// (src/debug/stabilizer-debug-harness-two-stage.js).
//
// No recovery/catch-up/finish logic, no deadzones. Each stage is a
// plain, always-on spring toward its own target, exactly like the
// single-stage experiment — the only architectural change under test
// is the extra hop.

(function (root) {
  'use strict';

  function makeSpringState() {
    return { x: 0, y: 0, vx: 0, vy: 0 };
  }

  // One position+velocity spring-damper stage. Deliberately identical
  // math to experimental-stabilizer.js's _step(), just factored so it
  // can be instantiated twice (anchor stage, brush stage) and chained.
  function stepSpring(state, target, stiffness, damping, mass, dt) {
    const k = stiffness;
    const c = damping;
    const m = mass || 1;

    const dx = target.x - state.x;
    const dy = target.y - state.y;

    const ax = (k * dx - c * state.vx) / m;
    const ay = (k * dy - c * state.vy) / m;

    state.vx += ax * dt;
    state.vy += ay * dt;

    state.x += state.vx * dt;
    state.y += state.vy * dt;

    return { x: ax, y: ay };
  }

  class TwoStageExperimentalStabilizer {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.anchorStiffness=180]
     * @param {number} [opts.anchorDamping=26]
     * @param {number} [opts.anchorMass=1]
     * @param {number} [opts.brushStiffness=180]
     * @param {number} [opts.brushDamping=26]
     * @param {number} [opts.brushMass=1]
     * @param {number} [opts.maxDt=0.05]  same numerical-safety clamp as
     *                                    experimental-stabilizer.js; not
     *                                    a stabilization "hack", just a
     *                                    dt ceiling after tab-away/stalls.
     * @param {boolean} [opts.debug=false]
     */
    constructor(opts) {
      opts = opts || {};

      // --- Stage 1: anchor solver (raw pointer -> anchor) ---
      this.anchorStiffness = typeof opts.anchorStiffness === 'number' ? opts.anchorStiffness : 180;
      this.anchorDamping = typeof opts.anchorDamping === 'number' ? opts.anchorDamping : 26;
      this.anchorMass = typeof opts.anchorMass === 'number' ? opts.anchorMass : 1;

      // --- Stage 2: brush follower solver (anchor -> brush tip) ---
      this.brushStiffness = typeof opts.brushStiffness === 'number' ? opts.brushStiffness : 180;
      this.brushDamping = typeof opts.brushDamping === 'number' ? opts.brushDamping : 26;
      this.brushMass = typeof opts.brushMass === 'number' ? opts.brushMass : 1;

      this.maxDt = typeof opts.maxDt === 'number' ? opts.maxDt : 0.05;
      this.debug = !!opts.debug;

      // Raw pointer target — mirrors experimental-stabilizer.js's
      // _target exactly: pushSample() writes here directly, unfiltered.
      this._raw = { x: 0, y: 0, pressure: 0 };

      // Stage 1 output / stage 2's target.
      this._anchor = makeSpringState();

      // Stage 2 output — the brush tip.
      this._brush = makeSpringState();
      this._brush.pressure = 0;

      this._lastAnchorAccel = { x: 0, y: 0 };
      this._lastBrushAccel = { x: 0, y: 0 };

      this._initialized = false;
      this._running = false;
      this._rafHandle = null;
      this._lastFrameTime = null;

      this._frameListeners = [];

      this._diagnostics = {
        raw: { x: 0, y: 0 },
        anchor: { x: 0, y: 0 },
        brush: { x: 0, y: 0 },
        rawToAnchorDistance: 0,
        anchorToBrushDistance: 0,
        anchorVelocity: { x: 0, y: 0, magnitude: 0 },
        brushVelocity: { x: 0, y: 0, magnitude: 0 },
        anchorAcceleration: { x: 0, y: 0, magnitude: 0 },
        brushAcceleration: { x: 0, y: 0, magnitude: 0 },
        dt: 0,
        lastUpdatedAt: 0,
      };

      this._tick = this._tick.bind(this);
    }

    // ------------------------------------------------------------------
    // Input: raw pointer samples only, same contract as
    // experimental-stabilizer.js's pushSample(). Writes _raw ONLY —
    // never touches _anchor or _brush directly (except the one-time
    // initialization snap below), so nothing here can be mistaken for
    // a shortcut/hack that bypasses either spring stage.
    // ------------------------------------------------------------------
    pushSample(sample) {
      if (!sample) return;
      const { x, y, pressure, t } = sample;

      if (typeof x === 'number') this._raw.x = x;
      if (typeof y === 'number') this._raw.y = y;
      if (typeof pressure === 'number') this._raw.pressure = pressure;

      if (!this._initialized) {
        // Snap both stages on first sample, same rationale as the
        // single-stage experiment: don't let either spring fly in from
        // (0,0). This happens once per instance lifetime, not per stroke.
        this._anchor.x = this._raw.x;
        this._anchor.y = this._raw.y;
        this._anchor.vx = 0;
        this._anchor.vy = 0;

        this._brush.x = this._raw.x;
        this._brush.y = this._raw.y;
        this._brush.vx = 0;
        this._brush.vy = 0;
        this._brush.pressure = this._raw.pressure;

        this._initialized = true;
      }

      this._lastSampleAt = typeof t === 'number' ? t : (root.performance ? root.performance.now() : Date.now());
    }

    // ------------------------------------------------------------------
    // Lifecycle — identical shape to experimental-stabilizer.js.
    // ------------------------------------------------------------------
    start() {
      if (this._running) return;
      this._running = true;
      this._lastFrameTime = null;
      this._rafHandle = root.requestAnimationFrame(this._tick);
    }

    stop() {
      this._running = false;
      if (this._rafHandle != null) {
        root.cancelAnimationFrame(this._rafHandle);
        this._rafHandle = null;
      }
    }

    onFrame(listener) {
      if (typeof listener === 'function') this._frameListeners.push(listener);
      return () => {
        const i = this._frameListeners.indexOf(listener);
        if (i !== -1) this._frameListeners.splice(i, 1);
      };
    }

    getState() {
      return {
        x: this._brush.x,
        y: this._brush.y,
        pressure: this._brush.pressure,
        anchor: { x: this._anchor.x, y: this._anchor.y },
      };
    }

    getDiagnostics() {
      return JSON.parse(JSON.stringify(this._diagnostics));
    }

    // ------------------------------------------------------------------
    // RAF loop — advances BOTH stages every frame, independent of
    // whether a new pointer sample arrived, same as the single-stage
    // experiment. Order matters: anchor stage steps first (toward raw),
    // then brush stage steps using the anchor's position AFTER this
    // tick's anchor step (i.e. brush chases where the anchor just
    // moved to, not where it was a frame ago).
    // ------------------------------------------------------------------
    _tick(now) {
      if (!this._running) return;

      if (this._lastFrameTime == null) {
        this._lastFrameTime = now;
        this._rafHandle = root.requestAnimationFrame(this._tick);
        return;
      }

      let dt = (now - this._lastFrameTime) / 1000;
      this._lastFrameTime = now;
      if (dt > this.maxDt) dt = this.maxDt;
      if (dt < 0) dt = 0;

      if (this._initialized && dt > 0) {
        this._lastAnchorAccel = stepSpring(
          this._anchor, this._raw,
          this.anchorStiffness, this.anchorDamping, this.anchorMass, dt
        );

        this._lastBrushAccel = stepSpring(
          this._brush, this._anchor,
          this.brushStiffness, this.brushDamping, this.brushMass, dt
        );

        const pressureFollow = 1 - Math.exp(-dt * 30);
        this._brush.pressure += (this._raw.pressure - this._brush.pressure) * pressureFollow;
      }

      if (this.debug) this._recordDiagnostics(dt);

      const out = this.getState();
      for (let i = 0; i < this._frameListeners.length; i++) {
        try {
          this._frameListeners[i](out);
        } catch (err) {
          if (root.console && root.console.error) {
            root.console.error('[TwoStageExperimentalStabilizer] onFrame listener error:', err);
          }
        }
      }

      this._rafHandle = root.requestAnimationFrame(this._tick);
    }

    _recordDiagnostics(dt) {
      const rawToAnchorDx = this._raw.x - this._anchor.x;
      const rawToAnchorDy = this._raw.y - this._anchor.y;
      const rawToAnchorDistance = Math.sqrt(rawToAnchorDx * rawToAnchorDx + rawToAnchorDy * rawToAnchorDy);

      const anchorToBrushDx = this._anchor.x - this._brush.x;
      const anchorToBrushDy = this._anchor.y - this._brush.y;
      const anchorToBrushDistance = Math.sqrt(anchorToBrushDx * anchorToBrushDx + anchorToBrushDy * anchorToBrushDy);

      const anchorVMag = Math.sqrt(this._anchor.vx * this._anchor.vx + this._anchor.vy * this._anchor.vy);
      const brushVMag = Math.sqrt(this._brush.vx * this._brush.vx + this._brush.vy * this._brush.vy);

      const aAcc = this._lastAnchorAccel || { x: 0, y: 0 };
      const bAcc = this._lastBrushAccel || { x: 0, y: 0 };
      const aAccMag = Math.sqrt(aAcc.x * aAcc.x + aAcc.y * aAcc.y);
      const bAccMag = Math.sqrt(bAcc.x * bAcc.x + bAcc.y * bAcc.y);

      this._diagnostics = {
        raw: { x: this._raw.x, y: this._raw.y },
        anchor: { x: this._anchor.x, y: this._anchor.y },
        brush: { x: this._brush.x, y: this._brush.y },
        rawToAnchorDistance: rawToAnchorDistance,
        anchorToBrushDistance: anchorToBrushDistance,
        anchorVelocity: { x: this._anchor.vx, y: this._anchor.vy, magnitude: anchorVMag },
        brushVelocity: { x: this._brush.vx, y: this._brush.vy, magnitude: brushVMag },
        anchorAcceleration: { x: aAcc.x, y: aAcc.y, magnitude: aAccMag },
        brushAcceleration: { x: bAcc.x, y: bAcc.y, magnitude: bAccMag },
        dt: dt,
        lastUpdatedAt: root.performance ? root.performance.now() : Date.now(),
      };
    }
  }

  // Exposed under its own namespace only — separate from
  // window.ExperimentalStabilizer (the single-stage experiment), and
  // touches nothing production uses.
  root.TwoStageExperimentalStabilizer = TwoStageExperimentalStabilizer;

})(typeof window !== 'undefined' ? window : globalThis);
