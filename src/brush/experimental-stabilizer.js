// experimental-stabilizer.js
//
// ISOLATED STABILIZATION EXPERIMENT — position + velocity spring model.
//
// Status: NOT wired into production. This file is not <script>-included
// by index.html and is not called from brush-engine.js. It has no
// references to _stabilizerBuf, _stabilizerWindowLen, _stabilizerAdvance,
// or any production stabilizer/recovery/catch-up/finish logic.
//
// It owns its state and its own RAF loop, and consumes only raw input
// samples (x, y, pressure, timestamp) handed to it through pushSample().
// Nothing in production calls pushSample() yet — see notes at bottom of
// this file / the accompanying report for how that wiring would work
// once this is ready to be evaluated.
//
// Usage (manual / console-only, for now):
//   const exp = new ExperimentalStabilizer({ stiffness: 180, damping: 26, mass: 1 });
//   exp.start();
//   exp.pushSample({ x, y, pressure, t: performance.now() });
//   exp.onFrame(({ x, y, pressure }) => { /* draw preview dot, etc */ });
//   exp.stop();

(function (root) {
  'use strict';

  class ExperimentalStabilizer {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.stiffness=180]  spring constant (k)
     * @param {number} [opts.damping=26]     damping coefficient (c)
     * @param {number} [opts.mass=1]         point mass (m)
     * @param {number} [opts.maxDt=0.05]     dt clamp (seconds) to avoid
     *                                       explosive steps after tab-away
     *                                       or long stalls
     * @param {boolean} [opts.debug=false]   collect diagnostics each frame
     */
    constructor(opts) {
      opts = opts || {};

      // --- Tunable parameters (not tuned in this pass; sane defaults only) ---
      this.stiffness = typeof opts.stiffness === 'number' ? opts.stiffness : 180;
      this.damping = typeof opts.damping === 'number' ? opts.damping : 26;
      this.mass = typeof opts.mass === 'number' ? opts.mass : 1;
      this.maxDt = typeof opts.maxDt === 'number' ? opts.maxDt : 0.05;
      this.debug = !!opts.debug;

      // --- Own state (deliberately namespaced away from production names) ---
      this._state = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        pressure: 0,
        // simple critically-damped-ish follow for pressure; no spring needed
        // for a scalar that doesn't overshoot visually the way position does
      };

      this._target = {
        x: 0,
        y: 0,
        pressure: 0,
      };

      this._initialized = false; // becomes true on first pushSample
      this._running = false;
      this._rafHandle = null;
      this._lastFrameTime = null;

      this._frameListeners = [];

      // Debug-only diagnostics snapshot, updated once per RAF tick.
      this._diagnostics = {
        brush: { x: 0, y: 0 },
        target: { x: 0, y: 0 },
        leashDistance: 0,
        velocity: { x: 0, y: 0, magnitude: 0 },
        acceleration: { x: 0, y: 0, magnitude: 0 },
        dt: 0,
        lastUpdatedAt: 0,
      };

      this._tick = this._tick.bind(this);
    }

    // ------------------------------------------------------------------
    // Input: raw pointer samples only. No knowledge of production
    // stabilizer buffers, windows, or advance/recovery/catch-up/finish
    // logic. Caller is responsible for sourcing x/y/pressure/t.
    // ------------------------------------------------------------------
    pushSample(sample) {
      if (!sample) return;
      const { x, y, pressure, t } = sample;

      if (typeof x === 'number') this._target.x = x;
      if (typeof y === 'number') this._target.y = y;
      if (typeof pressure === 'number') this._target.pressure = pressure;

      if (!this._initialized) {
        // Snap on first sample so the spring doesn't fly in from (0,0).
        this._state.x = this._target.x;
        this._state.y = this._target.y;
        this._state.pressure = this._target.pressure;
        this._state.vx = 0;
        this._state.vy = 0;
        this._initialized = true;
      }

      // t is accepted for diagnostics / future use (e.g. input-rate
      // logging) but the RAF loop is authoritative for solver dt, per
      // the "own RAF loop" requirement — we do not step the solver here.
      this._lastSampleAt = typeof t === 'number' ? t : (root.performance ? root.performance.now() : Date.now());
    }

    // ------------------------------------------------------------------
    // Lifecycle
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
        x: this._state.x,
        y: this._state.y,
        pressure: this._state.pressure,
      };
    }

    getDiagnostics() {
      // Shallow-cloned so callers can't mutate internal state via the
      // debug snapshot.
      return JSON.parse(JSON.stringify(this._diagnostics));
    }

    // ------------------------------------------------------------------
    // Internal: RAF loop. Advances the solver every frame regardless of
    // whether a new pointer sample arrived — the spring relaxes toward
    // whatever the current target is.
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

      this._step(dt);

      if (this.debug) this._recordDiagnostics(dt);

      const out = this.getState();
      for (let i = 0; i < this._frameListeners.length; i++) {
        try {
          this._frameListeners[i](out);
        } catch (err) {
          // Isolate listener errors from the solver loop.
          if (root.console && root.console.error) {
            root.console.error('[ExperimentalStabilizer] onFrame listener error:', err);
          }
        }
      }

      this._rafHandle = root.requestAnimationFrame(this._tick);
    }

    // Position + velocity spring-damper (semi-implicit Euler):
    //   a = (k * (target - x) - c * v) / m
    //   v += a * dt
    //   x += v * dt
    _step(dt) {
      if (!this._initialized || dt === 0) return;

      const k = this.stiffness;
      const c = this.damping;
      const m = this.mass || 1;

      const dx = this._target.x - this._state.x;
      const dy = this._target.y - this._state.y;

      const ax = (k * dx - c * this._state.vx) / m;
      const ay = (k * dy - c * this._state.vy) / m;

      this._state.vx += ax * dt;
      this._state.vy += ay * dt;

      this._state.x += this._state.vx * dt;
      this._state.y += this._state.vy * dt;

      // Pressure: simple exponential follow, independent of the spatial
      // spring. Kept intentionally basic since this pass is architecture,
      // not tuning.
      const pressureFollow = 1 - Math.exp(-dt * 30);
      this._state.pressure += (this._target.pressure - this._state.pressure) * pressureFollow;

      this._lastAccel = { x: ax, y: ay };
    }

    _recordDiagnostics(dt) {
      const dx = this._target.x - this._state.x;
      const dy = this._target.y - this._state.y;
      const leash = Math.sqrt(dx * dx + dy * dy);
      const vMag = Math.sqrt(this._state.vx * this._state.vx + this._state.vy * this._state.vy);
      const a = this._lastAccel || { x: 0, y: 0 };
      const aMag = Math.sqrt(a.x * a.x + a.y * a.y);

      this._diagnostics = {
        brush: { x: this._state.x, y: this._state.y },
        target: { x: this._target.x, y: this._target.y },
        leashDistance: leash,
        velocity: { x: this._state.vx, y: this._state.vy, magnitude: vMag },
        acceleration: { x: a.x, y: a.y, magnitude: aMag },
        dt,
        lastUpdatedAt: root.performance ? root.performance.now() : Date.now(),
      };
    }
  }

  // Exposed under its own namespace only — does not touch any existing
  // global used by the production brush engine.
  root.ExperimentalStabilizer = ExperimentalStabilizer;

})(typeof window !== 'undefined' ? window : globalThis);

// ---------------------------------------------------------------------
// NOT ACTIVE BY DEFAULT.
//
// This module defines the class and attaches it to
// window.ExperimentalStabilizer, but it:
//   - is not included via a <script> tag in index.html or prototype.html
//   - does not attach any pointer event listeners itself
//   - does not call start() or pushSample() on its own
//   - is never instantiated anywhere else in this codebase
//
// It is inert until something outside this file chooses to
// `new ExperimentalStabilizer(...)`, feed it samples, and start its loop.
// ---------------------------------------------------------------------
