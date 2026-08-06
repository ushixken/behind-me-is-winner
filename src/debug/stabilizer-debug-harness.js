// stabilizer-debug-harness.js
//
// DEBUG-ONLY input bridge for experimental-stabilizer.js.
//
// What this file is:
//   - A standalone listener that observes pointer events on the drawing
//     surface and forwards raw samples (x, y, pressure, t) into a
//     window.ExperimentalStabilizer instance.
//   - A standalone visual overlay (its own <canvas>, pointer-events:none)
//     that renders the experimental solver's internal state for
//     inspection: experimental brush position, target position, leash
//     line, velocity, acceleration, dt.
//   - A second, dedicated onset panel that records target position,
//     current (brush) position, velocity magnitude, and acceleration
//     magnitude for the first 500ms after each pointerdown, and plots
//     them as small strip-chart graphs plus a live numeric readout —
//     purely so you can see whether the spring starts from rest and
//     ramps up gradually, or not. This only reads values already
//     produced by getDiagnostics()/onFrame(); it does not touch, wrap,
//     or reimplement any solver math.
//   - A single ON/OFF toggle that controls ONLY this debug bridge/overlay.
//
// What this file is NOT:
//   - It does not attach to, replace, wrap, or remove any production
//     pointerdown/pointermove/pointerup listener. It only ever calls
//     addEventListener (additive), never removeEventListener on anything
//     it didn't add itself, never calls preventDefault/stopPropagation,
//     never calls setPointerCapture/releasePointerCapture.
//   - It never draws into activeC, compC, displayC, or any other
//     production canvas. It owns one private <canvas> that it creates,
//     positions on top of everything with pointer-events:none, and draws
//     into.
//   - It does not read from or write to any production stabilizer state
//     (_stabilizerBuf, _stabilizerWindowLen, _stabilizerAdvance, etc).
//   - It does not modify brush-engine.js, and does not call any function
//     defined there. It only reads `canvasArea` (declared as a top-level
//     `const` in core-state.js) to know where the drawing surface is on
//     screen, purely so the debug overlay can size itself. Nothing here
//     depends on brush-engine.js's internal coordinate-transform math.
//   - It does not tune the experimental stabilizer. It is constructed
//     with no stiffness/damping/mass/maxDt/pressure overrides, so it
//     uses whatever defaults experimental-stabilizer.js currently ships
//     with.
//
// Toggle:
//   A small floating "Stabilizer Debug: OFF/ON" button is injected into
//   the corner of the page. Flipping it only starts/stops this harness's
//   own listeners' effect (sample forwarding + overlay rendering + the
//   experimental solver's own RAF loop). It never touches production
//   drawing, production listeners, or brush-engine.js state.
//
// Optional auto-enable for convenience during this experiment:
//   ?stabilizerDebug=1 in the URL starts it enabled, same as clicking
//   the toggle. This is additive convenience, not a requirement — the
//   manual toggle always works regardless of the URL.

(function (root) {
  'use strict';

  if (typeof root.ExperimentalStabilizer !== 'function') {
    if (root.console && root.console.warn) {
      root.console.warn('[StabilizerDebugHarness] ExperimentalStabilizer not found — is experimental-stabilizer.js loaded before this file?');
    }
    return;
  }

  var enabled = false;
  var experimental = null;
  var unsubscribeFrame = null;

  var overlayCanvas = null;
  var overlayCtx = null;

  var toggleBtn = null;

  // Last raw sample, kept only so the overlay can draw the "target"
  // marker (raw input position) alongside the solver's smoothed output.
  var lastRaw = { x: null, y: null };

  // ------------------------------------------------------------------
  // Pointerdown-onset recording: captures diagnostics for the first
  // 500ms after each pointerdown so the ramp-up can be inspected.
  // Read-only consumer of getDiagnostics() — records values, computes
  // nothing the solver doesn't already expose.
  // ------------------------------------------------------------------
  var ONSET_WINDOW_MS = 500;
  var onsetRecording = null; // { startAt, baseline:{target:{x,y},brush:{x,y}}, samples:[] }

  // Diagnostic-only epsilon used to detect "the brush has visibly
  // displaced" for the mechanism-comparison instrumentation below. This
  // is NOT a deadzone/threshold added to the solver — the solver never
  // sees this value and nothing is gated on it. It only exists so this
  // harness can log the moment displacement crosses float noise.
  var MOVEMENT_DETECT_EPSILON_PX = 0.02;

  var panelCanvas = null;
  var panelCtx = null;

  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function beginOnsetRecording() {
    onsetRecording = {
      startAt: null,
      baseline: null,
      samples: [],
      pointerDownAt: root.performance ? root.performance.now() : Date.now(),
      rawSamples: [],      // every raw sample fed to pushSample() this stroke: {x,y,t}
      movementStart: null  // filled in once brush displacement is first detected
    };
  }

  // ------------------------------------------------------------------
  // Overlay canvas: separate element, covers the viewport, never
  // touched by production code, never used as an input target.
  // ------------------------------------------------------------------
  function ensureOverlay() {
    if (overlayCanvas) return;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'stabilizer-debug-overlay';
    overlayCanvas.style.position = 'fixed';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.width = '100vw';
    overlayCanvas.style.height = '100vh';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '999999';
    overlayCanvas.style.display = 'none';

    overlayCtx = overlayCanvas.getContext('2d');
    document.body.appendChild(overlayCanvas);

    resizeOverlay();
    root.addEventListener('resize', resizeOverlay);
  }

  function resizeOverlay() {
    if (!overlayCanvas) return;
    var dpr = root.devicePixelRatio || 1;
    overlayCanvas.width = Math.round(root.innerWidth * dpr);
    overlayCanvas.height = Math.round(root.innerHeight * dpr);
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------
  // Onset panel canvas: separate private element (own <canvas>,
  // pointer-events:none, never an input target, never drawn into
  // anything production). Shows the pointerdown-onset graphs/readout.
  // ------------------------------------------------------------------
  function ensurePanel() {
    if (panelCanvas) return;

    panelCanvas = document.createElement('canvas');
    panelCanvas.id = 'stabilizer-debug-onset-panel';
    panelCanvas.style.position = 'fixed';
    panelCanvas.style.top = '12px';
    panelCanvas.style.left = '12px';
    panelCanvas.style.width = '340px';
    panelCanvas.style.height = '460px';
    panelCanvas.style.pointerEvents = 'none';
    panelCanvas.style.zIndex = '999999';
    panelCanvas.style.display = 'none';
    panelCanvas.style.background = 'rgba(0, 0, 0, 0.7)';
    panelCanvas.style.border = '1px solid #444';
    panelCanvas.style.borderRadius = '4px';

    var dpr = root.devicePixelRatio || 1;
    panelCanvas.width = Math.round(340 * dpr);
    panelCanvas.height = Math.round(460 * dpr);
    panelCtx = panelCanvas.getContext('2d');
    panelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    document.body.appendChild(panelCanvas);
  }

  // ------------------------------------------------------------------
  // Toggle button: the only UI this harness adds. Controls this file's
  // own behavior exclusively.
  // ------------------------------------------------------------------
  function ensureToggle() {
    if (toggleBtn) return;

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'stabilizer-debug-toggle';
    toggleBtn.type = 'button';
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.bottom = '12px';
    toggleBtn.style.right = '12px';
    toggleBtn.style.zIndex = '1000000';
    toggleBtn.style.font = '12px monospace';
    toggleBtn.style.padding = '6px 10px';
    toggleBtn.style.background = '#1a1a1a';
    toggleBtn.style.color = '#0f0';
    toggleBtn.style.border = '1px solid #444';
    toggleBtn.style.borderRadius = '4px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.opacity = '0.85';
    updateToggleLabel();

    toggleBtn.addEventListener('click', function () {
      setEnabled(!enabled);
    });

    document.body.appendChild(toggleBtn);
  }

  function updateToggleLabel() {
    if (!toggleBtn) return;
    toggleBtn.textContent = 'Stabilizer Debug: ' + (enabled ? 'ON' : 'OFF');
    toggleBtn.style.color = enabled ? '#0f0' : '#888';
  }

  // ------------------------------------------------------------------
  // Enable / disable — the ONLY thing the toggle controls.
  // ------------------------------------------------------------------
  function setEnabled(next) {
    enabled = !!next;
    updateToggleLabel();

    if (enabled) {
      if (!experimental) {
        // No stiffness/damping/mass/maxDt overrides — current defaults only.
        experimental = new root.ExperimentalStabilizer({ debug: true });
      }
      experimental.start();
      if (!unsubscribeFrame) {
        unsubscribeFrame = experimental.onFrame(drawOverlay);
      }
      ensureOverlay();
      overlayCanvas.style.display = 'block';

      ensurePanel();
      panelCanvas.style.display = 'block';
    } else {
      if (experimental) experimental.stop();
      if (overlayCanvas) {
        overlayCanvas.style.display = 'none';
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
      if (panelCanvas) {
        panelCanvas.style.display = 'none';
      }
    }
  }

  // ------------------------------------------------------------------
  // Raw pointer -> experimental stabilizer. Additive listeners only;
  // never replaces or removes anything production attached.
  // ------------------------------------------------------------------
  function feedSample(e) {
    if (!enabled || !experimental) return;

    var x = e.clientX;
    var y = e.clientY;
    var pressure = typeof e.pressure === 'number' ? e.pressure : 0.5;
    var t = typeof e.timeStamp === 'number' ? e.timeStamp : (root.performance ? root.performance.now() : Date.now());

    lastRaw.x = x;
    lastRaw.y = y;

    if (onsetRecording) {
      onsetRecording.rawSamples.push({ x: x, y: y, t: t });
    }

    experimental.pushSample({ x: x, y: y, pressure: pressure, t: t });
  }

  function onPointerDown(e) {
    if (enabled && experimental) {
      beginOnsetRecording();
    }
    feedSample(e);
    if (enabled && experimental) {

      // getState() is live/synchronous (reads _state directly), so this
      // is the true x/y right after pushSample() ran for this pointerdown.
      var stateNow = experimental.getState();
      // getDiagnostics() is only refreshed once per RAF tick inside
      // _tick()'s debug branch — it is NOT updated by pushSample(). So
      // the velocity/target read here reflects the *last completed RAF
      // tick*, not this exact instant. Logged as such below; this is a
      // real limitation of the current instrumentation, not something
      // this harness silently papers over.
      var diagNow = experimental.getDiagnostics();

      onsetRecording.afterPointerDown = {
        stateXY: { x: stateNow.x, y: stateNow.y },
        targetXY: { x: diagNow.target.x, y: diagNow.target.y },
        velocityStale: diagNow.velocity, // see staleness note above
        note: 'stateXY is live (getState()); velocityStale is from the last completed RAF tick, not necessarily this instant'
      };

      if (root.console && root.console.log) {
        root.console.log('[StabilizerDebugHarness] pointerdown investigation snapshot', onsetRecording.afterPointerDown);
      }
    }
  }

  function onPointerMove(e) {
    if (enabled && experimental && onsetRecording && !onsetRecording.firstMove) {
      // Synchronous "before" snapshot — captured BEFORE feedSample()
      // updates _target, and before any further RAF _step() has run
      // against this new target.
      var stateBefore = experimental.getState();
      var diagBefore = experimental.getDiagnostics(); // last-tick velocity, see staleness note

      onsetRecording.firstMove = {
        targetBeforeMove: diagBefore.target,
        stateBeforeMove: { x: stateBefore.x, y: stateBefore.y },
        velocityBeforeMove: diagBefore.velocity, // last-tick value, see staleness note
        targetAtMove: { x: e.clientX, y: e.clientY },
        wallTimeAtMove: root.performance ? root.performance.now() : Date.now(),
        capturedFirstFrameAfter: false,
        firstFrameAfter: null
      };

      if (root.console && root.console.log) {
        root.console.log('[StabilizerDebugHarness] first pointermove investigation snapshot (before)', {
          targetBeforeMove: onsetRecording.firstMove.targetBeforeMove,
          stateBeforeMove: onsetRecording.firstMove.stateBeforeMove,
          velocityBeforeMove: onsetRecording.firstMove.velocityBeforeMove,
          targetAtMove: onsetRecording.firstMove.targetAtMove,
          moveDistancePx: dist(onsetRecording.firstMove.targetAtMove, onsetRecording.firstMove.stateBeforeMove)
        });
      }
    }
    feedSample(e);
  }
  function onPointerUp(e) { feedSample(e); }

  function attachListeners() {
    // Prefer canvasArea (declared in core-state.js) so debug samples
    // track the same region the real brush listens on; fall back to
    // window if it isn't available for any reason. Either way this is
    // an ADDITIONAL listener, not a replacement of production's own.
    var target = (typeof canvasArea !== 'undefined' && canvasArea) ? canvasArea : root;

    target.addEventListener('pointerdown', onPointerDown, { passive: true });
    target.addEventListener('pointermove', onPointerMove, { passive: true });
    target.addEventListener('pointerup', onPointerUp, { passive: true });
    target.addEventListener('pointercancel', onPointerUp, { passive: true });
  }

  // ------------------------------------------------------------------
  // Overlay rendering — diagnostics only, drawn into the private
  // overlay canvas, never into any production canvas.
  // ------------------------------------------------------------------
  function drawOverlay() {
    if (!enabled || !overlayCtx || !experimental) return;

    var diag = experimental.getDiagnostics();
    var w = root.innerWidth;
    var h = root.innerHeight;

    overlayCtx.clearRect(0, 0, w, h);

    // Leash line: target (raw input) -> experimental brush position.
    if (lastRaw.x != null) {
      overlayCtx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
      overlayCtx.lineWidth = 1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(diag.target.x, diag.target.y);
      overlayCtx.lineTo(diag.brush.x, diag.brush.y);
      overlayCtx.stroke();
    }

    // Target marker (raw pointer position).
    overlayCtx.fillStyle = 'rgba(255, 60, 60, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(diag.target.x, diag.target.y, 4, 0, Math.PI * 2);
    overlayCtx.fill();

    // Experimental brush marker (solver output).
    overlayCtx.fillStyle = 'rgba(60, 180, 255, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(diag.brush.x, diag.brush.y, 6, 0, Math.PI * 2);
    overlayCtx.fill();

    // Text readout.
    var lines = [
      'brush   x=' + diag.brush.x.toFixed(1) + ' y=' + diag.brush.y.toFixed(1),
      'target  x=' + diag.target.x.toFixed(1) + ' y=' + diag.target.y.toFixed(1),
      'leash   ' + diag.leashDistance.toFixed(2) + 'px',
      'vel     ' + diag.velocity.magnitude.toFixed(2) + 'px/s',
      'accel   ' + diag.acceleration.magnitude.toFixed(2) + 'px/s\u00B2',
      'dt      ' + (diag.dt * 1000).toFixed(2) + 'ms'
    ];

    overlayCtx.font = '12px monospace';
    overlayCtx.textBaseline = 'top';
    var boxX = 12, boxY = 12, lineH = 16, pad = 8;
    var boxW = 220, boxH = pad * 2 + lineH * lines.length;

    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    overlayCtx.fillRect(boxX, boxY, boxW, boxH);

    overlayCtx.fillStyle = '#0f0';
    for (var i = 0; i < lines.length; i++) {
      overlayCtx.fillText(lines[i], boxX + pad, boxY + pad + i * lineH);
    }

    recordOnsetSample(diag);
    drawOnsetPanel();
  }

  // ------------------------------------------------------------------
  // Onset recording: append one sample per RAF tick while within
  // ONSET_WINDOW_MS of the most recent pointerdown. Purely reads
  // diag (from getDiagnostics()) — records numbers, doesn't derive
  // anything the solver isn't already producing.
  // ------------------------------------------------------------------
  function recordOnsetSample(diag) {
    if (!onsetRecording) return;

    var now = root.performance ? root.performance.now() : Date.now();

    if (onsetRecording.startAt == null) {
      onsetRecording.startAt = now;
      onsetRecording.baseline = {
        target: { x: diag.target.x, y: diag.target.y },
        brush: { x: diag.brush.x, y: diag.brush.y }
      };
    }

    var elapsed = now - onsetRecording.startAt;
    if (elapsed > ONSET_WINDOW_MS) return; // freeze — keep prior samples visible

    var brushDistFromStart = dist(diag.brush, onsetRecording.baseline.brush);

    onsetRecording.samples.push({
      t: elapsed,
      targetPos: { x: diag.target.x, y: diag.target.y },
      brushPos: { x: diag.brush.x, y: diag.brush.y },
      targetDistFromStart: dist(diag.target, onsetRecording.baseline.target),
      brushDistFromStart: brushDistFromStart,
      velocity: diag.velocity.magnitude,
      acceleration: diag.acceleration.magnitude
    });

    // First RAF tick to run its _step() after the first pointermove
    // updated _target — i.e. "first frame displacement after the
    // target moves". Captured once per recording, read-only.
    if (onsetRecording.firstMove && !onsetRecording.firstMove.capturedFirstFrameAfter) {
      var fm = onsetRecording.firstMove;
      fm.capturedFirstFrameAfter = true;
      fm.firstFrameAfter = {
        stateAfter: { x: diag.brush.x, y: diag.brush.y },
        velocityAfter: diag.velocity,
        accelerationAfter: diag.acceleration,
        dt: diag.dt,
        displacementThisFrame: dist({ x: diag.brush.x, y: diag.brush.y }, fm.stateBeforeMove)
      };

      if (root.console && root.console.log) {
        root.console.log('[StabilizerDebugHarness] first frame after target moved', fm.firstFrameAfter);
      }
    }

    // ------------------------------------------------------------------
    // Mechanism-comparison instrumentation (diagnostics only — no
    // deadzone/buffer/threshold is added to the solver; nothing here
    // gates or delays anything the solver does).
    //
    // Detects the first RAF tick where the brush has visibly moved from
    // its stroke-start position (brushDistFromStart crosses a tiny
    // float-noise epsilon, MOVEMENT_DETECT_EPSILON_PX), and records,
    // against that single moment:
    //   - time from pointerdown to first brush displacement
    //   - time from the first pointermove to first brush displacement
    //   - accumulated raw pointer path length before that moment
    //   - how many raw samples had been fed before that moment
    //   - target position vs. brush position at that moment
    // ------------------------------------------------------------------
    if (!onsetRecording.movementStart && brushDistFromStart > MOVEMENT_DETECT_EPSILON_PX) {
      var nowWall = root.performance ? root.performance.now() : Date.now();

      var accumulatedRawDistance = 0;
      var raw = onsetRecording.rawSamples;
      for (var i = 1; i < raw.length; i++) {
        accumulatedRawDistance += dist(raw[i], raw[i - 1]);
      }

      onsetRecording.movementStart = {
        timeFromPointerdownMs: nowWall - onsetRecording.pointerDownAt,
        timeFromFirstMoveMs: onsetRecording.firstMove ? (nowWall - onsetRecording.firstMove.wallTimeAtMove) : null,
        accumulatedRawDistancePx: accumulatedRawDistance,
        rawSampleCountBeforeMovement: raw.length,
        targetPos: { x: diag.target.x, y: diag.target.y },
        brushPos: { x: diag.brush.x, y: diag.brush.y },
        brushDisplacementFromStart: brushDistFromStart
      };

      if (root.console && root.console.log) {
        root.console.log('[StabilizerDebugHarness] MECHANISM CHECK — first visible brush displacement', onsetRecording.movementStart);
        root.console.log(
          '[StabilizerDebugHarness] hypothesis check: ' +
          'accumulated raw distance before movement = ' + accumulatedRawDistance.toFixed(3) + 'px, ' +
          'samples before movement = ' + raw.length + ', ' +
          'time from first move to movement = ' + (onsetRecording.movementStart.timeFromFirstMoveMs != null ? onsetRecording.movementStart.timeFromFirstMoveMs.toFixed(1) + 'ms' : 'n/a')
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Onset panel rendering: three strip-chart graphs (position offset,
  // velocity magnitude, acceleration magnitude, each vs. time since
  // pointerdown) plus a live numeric readout, drawn into the private
  // panel canvas only. Graphs cover 0–500ms on the x-axis; each is
  // independently auto-scaled on the y-axis to its own recorded max
  // so a small ramp is still visible.
  // ------------------------------------------------------------------
  function drawOnsetPanel() {
    if (!panelCtx) return;

    var W = 340, H = 460;
    panelCtx.clearRect(0, 0, W, H);

    panelCtx.font = '11px monospace';
    panelCtx.fillStyle = '#0f0';
    panelCtx.textBaseline = 'top';
    panelCtx.fillText('Onset (0\u2013500ms after pointerdown)', 10, 8);

    if (!onsetRecording || onsetRecording.samples.length === 0) {
      panelCtx.fillStyle = '#888';
      panelCtx.fillText('waiting for a stroke\u2026', 10, 28);
      return;
    }

    var samples = onsetRecording.samples;
    var latest = samples[samples.length - 1];

    // Numeric readout.
    panelCtx.fillStyle = '#0f0';
    var readout = [
      't=' + latest.t.toFixed(0) + 'ms',
      'target  x=' + latest.targetPos.x.toFixed(1) + ' y=' + latest.targetPos.y.toFixed(1),
      'current x=' + latest.brushPos.x.toFixed(1) + ' y=' + latest.brushPos.y.toFixed(1),
      'vel     ' + latest.velocity.toFixed(2) + 'px/s',
      'accel   ' + latest.acceleration.toFixed(2) + 'px/s\u00B2'
    ];

    var pd = onsetRecording.afterPointerDown;
    if (pd) {
      readout.push('--- pointerdown ---');
      readout.push('init x=' + pd.stateXY.x.toFixed(1) + ' y=' + pd.stateXY.y.toFixed(1));
    }

    var fm = onsetRecording.firstMove;
    if (fm && fm.firstFrameAfter) {
      readout.push('--- 1st move\u21921st frame ---');
      readout.push('vel  0\u2192' + fm.firstFrameAfter.velocityAfter.magnitude.toFixed(1) + 'px/s');
      readout.push('accel ' + fm.firstFrameAfter.accelerationAfter.magnitude.toFixed(0) + 'px/s\u00B2');
      readout.push('disp ' + fm.firstFrameAfter.displacementThisFrame.toFixed(2) + 'px in ' + (fm.firstFrameAfter.dt * 1000).toFixed(1) + 'ms');
    }

    var ms = onsetRecording.movementStart;
    if (ms) {
      readout.push('--- mechanism check ---');
      readout.push('t(pointerdown\u2192move) ' + ms.timeFromPointerdownMs.toFixed(1) + 'ms');
      readout.push('t(1st move\u2192move) ' + (ms.timeFromFirstMoveMs != null ? ms.timeFromFirstMoveMs.toFixed(1) + 'ms' : 'n/a'));
      readout.push('raw dist before ' + ms.accumulatedRawDistancePx.toFixed(2) + 'px');
      readout.push('samples before ' + ms.rawSampleCountBeforeMovement);
    }

    for (var r = 0; r < readout.length; r++) {
      panelCtx.fillText(readout[r], 10, 24 + r * 13);
    }

    // Three stacked strip charts: position offset, velocity, acceleration.
    var chartX = 10, chartW = W - 20;
    var chartTop = 24 + readout.length * 13 + 8;
    var chartH = 58, chartGap = 10;

    drawStripChart(chartX, chartTop, chartW, chartH, samples,
      function (s) { return s.targetDistFromStart; },
      function (s) { return s.brushDistFromStart; },
      'position offset from stroke start (px)  red=target blue=current');

    drawStripChart(chartX, chartTop + (chartH + chartGap), chartW, chartH, samples,
      function (s) { return s.velocity; },
      null,
      'velocity magnitude (px/s)');

    drawStripChart(chartX, chartTop + 2 * (chartH + chartGap), chartW, chartH, samples,
      function (s) { return s.acceleration; },
      null,
      'acceleration magnitude (px/s\u00B2)');
  }

  // Generic small strip chart: plots seriesA (and optionally seriesB)
  // over samples[].t across [0, ONSET_WINDOW_MS], auto-scaled on the
  // y-axis to the max value seen in this recording.
  function drawStripChart(x, y, w, h, samples, seriesA, seriesB, label) {
    panelCtx.strokeStyle = '#333';
    panelCtx.lineWidth = 1;
    panelCtx.strokeRect(x, y, w, h);

    var maxVal = 0.0001;
    for (var i = 0; i < samples.length; i++) {
      maxVal = Math.max(maxVal, seriesA(samples[i]));
      if (seriesB) maxVal = Math.max(maxVal, seriesB(samples[i]));
    }

    function plot(series, color) {
      panelCtx.strokeStyle = color;
      panelCtx.lineWidth = 1.5;
      panelCtx.beginPath();
      for (var i = 0; i < samples.length; i++) {
        var px = x + (samples[i].t / ONSET_WINDOW_MS) * w;
        var py = y + h - (series(samples[i]) / maxVal) * h;
        if (i === 0) panelCtx.moveTo(px, py);
        else panelCtx.lineTo(px, py);
      }
      panelCtx.stroke();
    }

    plot(seriesA, 'rgba(255, 60, 60, 0.9)');
    if (seriesB) plot(seriesB, 'rgba(60, 180, 255, 0.9)');

    panelCtx.fillStyle = '#888';
    panelCtx.font = '9px monospace';
    panelCtx.fillText(label, x, y + h + 1);
    panelCtx.fillText(maxVal.toFixed(1) + ' max', x + w - 55, y + 2);
  }

  // ------------------------------------------------------------------
  // Init: build UI, wire additive listeners, honor optional URL flag.
  // ------------------------------------------------------------------
  function init() {
    ensureToggle();
    attachListeners();

    var autoOn = false;
    try {
      autoOn = new URLSearchParams(root.location.search).get('stabilizerDebug') === '1';
    } catch (err) {
      autoOn = false;
    }
    if (autoOn) setEnabled(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposed for manual/console use, under its own namespace only.
  root.StabilizerDebugHarness = {
    enable: function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    isEnabled: function () { return enabled; },
    getOnsetRecording: function () {
      return onsetRecording ? JSON.parse(JSON.stringify(onsetRecording)) : null;
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);