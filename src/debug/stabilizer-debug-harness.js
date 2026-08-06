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
    } else {
      if (experimental) experimental.stop();
      if (overlayCanvas) {
        overlayCanvas.style.display = 'none';
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
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

    experimental.pushSample({ x: x, y: y, pressure: pressure, t: t });
  }

  function onPointerDown(e) { feedSample(e); }
  function onPointerMove(e) { feedSample(e); }
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
    isEnabled: function () { return enabled; }
  };

})(typeof window !== 'undefined' ? window : globalThis);
