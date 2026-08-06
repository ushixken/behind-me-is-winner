// stabilizer-debug-harness-two-stage.js
//
// DEBUG-ONLY input bridge + overlay for
// experimental-stabilizer-two-stage.js.
//
// Same non-invasiveness guarantees as stabilizer-debug-harness.js (the
// single-stage harness), kept as a fully separate instance so the two
// architectures can be compared side by side without either affecting
// the other:
//   - Additive pointer listeners only (never replaces/removes production
//     or the other harness's listeners; no preventDefault/
//     stopPropagation/setPointerCapture).
//   - Its own private <canvas> overlay, pointer-events:none, never
//     drawn into any production canvas.
//   - Its own toggle (bottom-LEFT, to avoid overlapping the single-stage
//     harness's bottom-right toggle), controlling ONLY this harness.
//   - Does not modify brush-engine.js, the production stabilizer, or
//     experimental-stabilizer.js (the single-stage experiment).
//   - No recovery/catch-up logic, no deadzones, no constant tuning —
//     TwoStageExperimentalStabilizer is constructed with no overrides,
//     using whatever defaults that file ships with.
//
// Diagnostics shown (all read straight from getDiagnostics(), computed
// by the two-stage solver itself — this file does not derive its own
// versions of these numbers):
//   - raw pointer position
//   - anchor position
//   - brush position
//   - raw-to-anchor distance
//   - anchor-to-brush distance
//   - anchor velocity
//   - brush velocity
//
// Optional auto-enable: ?stabilizerDebug2=1

(function (root) {
  'use strict';

  if (typeof root.TwoStageExperimentalStabilizer !== 'function') {
    if (root.console && root.console.warn) {
      root.console.warn('[StabilizerDebugHarnessTwoStage] TwoStageExperimentalStabilizer not found — is experimental-stabilizer-two-stage.js loaded before this file?');
    }
    return;
  }

  var enabled = false;
  var solver = null;
  var unsubscribeFrame = null;

  var overlayCanvas = null;
  var overlayCtx = null;
  var toggleBtn = null;

  var lastRaw = { x: null, y: null };

  function ensureOverlay() {
    if (overlayCanvas) return;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'stabilizer-debug-overlay-two-stage';
    overlayCanvas.style.position = 'fixed';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';
    overlayCanvas.style.width = '100vw';
    overlayCanvas.style.height = '100vh';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '999998'; // just under the single-stage overlay
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

  function ensureToggle() {
    if (toggleBtn) return;

    toggleBtn = document.createElement('button');
    toggleBtn.id = 'stabilizer-debug-toggle-two-stage';
    toggleBtn.type = 'button';
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.bottom = '12px';
    toggleBtn.style.left = '12px';
    toggleBtn.style.zIndex = '1000000';
    toggleBtn.style.font = '12px monospace';
    toggleBtn.style.padding = '6px 10px';
    toggleBtn.style.background = '#1a1a1a';
    toggleBtn.style.color = '#0af';
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
    toggleBtn.textContent = 'Two-Stage Debug: ' + (enabled ? 'ON' : 'OFF');
    toggleBtn.style.color = enabled ? '#0af' : '#888';
  }

  function setEnabled(next) {
    enabled = !!next;
    updateToggleLabel();

    if (enabled) {
      if (!solver) {
        // No stiffness/damping/mass overrides for either stage —
        // current defaults only. Not a tuning pass.
        solver = new root.TwoStageExperimentalStabilizer({ debug: true });
      }
      solver.start();
      if (!unsubscribeFrame) {
        unsubscribeFrame = solver.onFrame(drawOverlay);
      }
      ensureOverlay();
      overlayCanvas.style.display = 'block';
    } else {
      if (solver) solver.stop();
      if (overlayCanvas) {
        overlayCanvas.style.display = 'none';
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      }
    }
  }

  function feedSample(e) {
    if (!enabled || !solver) return;

    var x = e.clientX;
    var y = e.clientY;
    var pressure = typeof e.pressure === 'number' ? e.pressure : 0.5;
    var t = typeof e.timeStamp === 'number' ? e.timeStamp : (root.performance ? root.performance.now() : Date.now());

    lastRaw.x = x;
    lastRaw.y = y;

    solver.pushSample({ x: x, y: y, pressure: pressure, t: t });
  }

  function onPointerDown(e) { feedSample(e); }
  function onPointerMove(e) { feedSample(e); }
  function onPointerUp(e) { feedSample(e); }

  function attachListeners() {
    var target = (typeof canvasArea !== 'undefined' && canvasArea) ? canvasArea : root;

    target.addEventListener('pointerdown', onPointerDown, { passive: true });
    target.addEventListener('pointermove', onPointerMove, { passive: true });
    target.addEventListener('pointerup', onPointerUp, { passive: true });
    target.addEventListener('pointercancel', onPointerUp, { passive: true });
  }

  function drawOverlay() {
    if (!enabled || !overlayCtx || !solver) return;

    var diag = solver.getDiagnostics();
    var w = root.innerWidth;
    var h = root.innerHeight;

    overlayCtx.clearRect(0, 0, w, h);

    // raw -> anchor leash
    if (lastRaw.x != null) {
      overlayCtx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
      overlayCtx.lineWidth = 1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(diag.raw.x, diag.raw.y);
      overlayCtx.lineTo(diag.anchor.x, diag.anchor.y);
      overlayCtx.stroke();
    }

    // anchor -> brush leash
    overlayCtx.strokeStyle = 'rgba(120, 255, 120, 0.8)';
    overlayCtx.beginPath();
    overlayCtx.moveTo(diag.anchor.x, diag.anchor.y);
    overlayCtx.lineTo(diag.brush.x, diag.brush.y);
    overlayCtx.stroke();

    // raw marker
    overlayCtx.fillStyle = 'rgba(255, 60, 60, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(diag.raw.x, diag.raw.y, 4, 0, Math.PI * 2);
    overlayCtx.fill();

    // anchor marker
    overlayCtx.fillStyle = 'rgba(255, 220, 0, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(diag.anchor.x, diag.anchor.y, 5, 0, Math.PI * 2);
    overlayCtx.fill();

    // brush marker
    overlayCtx.fillStyle = 'rgba(60, 180, 255, 0.9)';
    overlayCtx.beginPath();
    overlayCtx.arc(diag.brush.x, diag.brush.y, 6, 0, Math.PI * 2);
    overlayCtx.fill();

    var lines = [
      'raw     x=' + diag.raw.x.toFixed(1) + ' y=' + diag.raw.y.toFixed(1),
      'anchor  x=' + diag.anchor.x.toFixed(1) + ' y=' + diag.anchor.y.toFixed(1),
      'brush   x=' + diag.brush.x.toFixed(1) + ' y=' + diag.brush.y.toFixed(1),
      'raw\u2192anchor   ' + diag.rawToAnchorDistance.toFixed(2) + 'px',
      'anchor\u2192brush ' + diag.anchorToBrushDistance.toFixed(2) + 'px',
      'anchor vel  ' + diag.anchorVelocity.magnitude.toFixed(2) + 'px/s',
      'brush vel   ' + diag.brushVelocity.magnitude.toFixed(2) + 'px/s',
      'dt          ' + (diag.dt * 1000).toFixed(2) + 'ms'
    ];

    overlayCtx.font = '12px monospace';
    overlayCtx.textBaseline = 'top';
    var boxX = w - 260, boxY = 12, lineH = 16, pad = 8;
    var boxW = 248, boxH = pad * 2 + lineH * lines.length;

    overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    overlayCtx.fillRect(boxX, boxY, boxW, boxH);

    overlayCtx.fillStyle = '#0af';
    for (var i = 0; i < lines.length; i++) {
      overlayCtx.fillText(lines[i], boxX + pad, boxY + pad + i * lineH);
    }
  }

  function init() {
    ensureToggle();
    attachListeners();

    var autoOn = false;
    try {
      autoOn = new URLSearchParams(root.location.search).get('stabilizerDebug2') === '1';
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

  root.StabilizerDebugHarnessTwoStage = {
    enable: function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    isEnabled: function () { return enabled; },
    getDiagnostics: function () { return solver ? solver.getDiagnostics() : null; }
  };

})(typeof window !== 'undefined' ? window : globalThis);
