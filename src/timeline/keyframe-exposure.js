// ════════════════════════════════════════════════════════════════
// KEYFRAME EXPOSURE — ported from the Krita "Keyframe Exposure" docker
// (keyframe_exposure.py). Lets you insert or remove hold frames at the
// CURRENT keyframe (Normal mode), or snap the gap to the next/prev
// keyframe to exactly the Exposure value (Bypass mode).
//
// Mapping from Krita's model to this app's:
//   node.hasKeyframeAtTime(f)        ->  !!layers[li].frames[f]
//   insert_hold_frame action         ->  insertHoldFrame(li, f)
//   remove_hold_frame action         ->  removeHoldFrame(li, f)
//   doc.currentTime()                ->  curFrame
//   doc.activeNode()                 ->  layers[curLayer]
//   fullClipRange start/end          ->  0 / TOTAL-1
// ════════════════════════════════════════════════════════════════
(function(){

  const STORE_KEY_AMOUNT  = 'animator_kfexp_amount';
  const STORE_KEY_BYPASS  = 'animator_kfexp_bypass';

  const spinAmount  = document.getElementById('kfexp-amount');
  const chkBypass   = document.getElementById('kfexp-bypass');
  const btnIncrease = document.getElementById('kfexp-btn-increase');
  const btnDecrease = document.getElementById('kfexp-btn-decrease');
  const lblStatus   = document.getElementById('kfexp-status');
  const lblInfo     = document.getElementById('kfexp-info');

  // ── Restore saved prefs ────────────────────────────────────────
  try {
    const savedAmount = parseInt(localStorage.getItem(STORE_KEY_AMOUNT));
    if (savedAmount >= 1) spinAmount.value = Math.max(1, Math.min(999, savedAmount));
  } catch(e) {}
  try {
    chkBypass.checked = localStorage.getItem(STORE_KEY_BYPASS) === '1';
  } catch(e) {}

  // Apply bypass UI state on load.
  applyBypassUI();

  // ── Helpers ────────────────────────────────────────────────────

  // Returns sorted array of frame indices that have a keyframe on layer li.
  // Mirrors Krita's _keyframe_times(node, doc).
  function keyframeTimes(li) {
    const layer = layers[li];
    if (!layer) return [];
    return Object.keys(layer.frames).map(Number).sort((a, b) => a - b);
  }
  function selectedExposureFrame(li) {
    if (typeof selectedKFs !== 'undefined' && selectedKFs && selectedKFs.size) {
      const frames = Array.from(selectedKFs).map(id => {
        const match = /^(\d+):(\d+)$/.exec(id);
        return match && Number(match[1]) === li ? Number(match[2]) : null;
      }).filter(frame => frame !== null);
      if (frames.length === 1) return frames[0];
    }
    return layers[li] && layers[li].frames[curFrame] ? curFrame : null;
  }

  // Insert a hold frame at position `at` on layer `li`: shift every keyframe
  // at >= `at` one step to the right (clamped to TOTAL-1).
  // This is the JS equivalent of Krita's insert_hold_frame action.
  function insertHoldFrame(li, at) {
    const layer = layers[li];
    if (!layer) return;
    const kf = Object.keys(layer.frames).map(Number).sort((a, b) => b - a); // descending
    kf.forEach(f => {
      if (f >= at) {
        const nf = f + 1;
        if (nf < TOTAL) {
          layer.frames[nf] = layer.frames[f];
          // Carry the mark forward with its drawing
          if (!layer.frameMeta) layer.frameMeta = {};
          if (layer.frameMeta[f]) layer.frameMeta[nf] = Object.assign({}, layer.frameMeta[f]);
          else delete layer.frameMeta[nf];
          if (typeof restoreStyleFrameBundle==='function'&&typeof getStyleFrameBundle==='function') restoreStyleFrameBundle(li,nf,getStyleFrameBundle(li,f));
        }
        delete layer.frames[f];
        if (layer.frameMeta) delete layer.frameMeta[f];
        if (typeof deleteStyleFrame==='function') deleteStyleFrame(li,f);
      }
    });
  }

  // Remove a hold frame at position `at` on layer `li`: shift every keyframe
  // AFTER `at` one step to the left.
  // This is the JS equivalent of Krita's remove_hold_frame action.
  function removeHoldFrame(li, at) {
    const layer = layers[li];
    if (!layer) return;
    // Delete the frame at `at` (the hold frame being removed); keep the
    // keyframe AT `at` by only shifting frames strictly after it.
    const kf = Object.keys(layer.frames).map(Number).sort((a, b) => a - b); // ascending
    kf.forEach(f => {
      if (f > at) {
        const nf = f - 1;
        if (nf >= 0) {
          layer.frames[nf] = layer.frames[f];
          // Carry the mark back with its drawing
          if (!layer.frameMeta) layer.frameMeta = {};
          if (layer.frameMeta[f]) layer.frameMeta[nf] = Object.assign({}, layer.frameMeta[f]);
          else delete layer.frameMeta[nf];
          if (typeof restoreStyleFrameBundle==='function'&&typeof getStyleFrameBundle==='function') restoreStyleFrameBundle(li,nf,getStyleFrameBundle(li,f));
        }
        delete layer.frames[f];
        if (layer.frameMeta) delete layer.frameMeta[f];
        if (typeof deleteStyleFrame==='function') deleteStyleFrame(li,f);
      }
    });
  }

  function setStatus(msg) {
    lblStatus.textContent = msg;
  }

  // ── Bypass UI ──────────────────────────────────────────────────
  // Mirrors _on_bypass_toggled() from the Python docker.
  function applyBypassUI() {
    if (chkBypass.checked) {
      lblInfo.innerHTML =
        '<b>Bypass ON</b> — gap to next keyframe will be forced to exactly the Exposure value.';
      btnIncrease.innerHTML =
        '<span class="kfexp-label-full">Set Exposure [Bypass]</span>' +
        '<span class="kfexp-label-short">+</span>';
      btnDecrease.innerHTML =
        '<span class="kfexp-label-full">Decrease Exposure</span>' +
        '<span class="kfexp-label-short">−</span>';
      btnDecrease.disabled = true;
      btnDecrease.style.opacity = '0.4';
    } else {
      lblInfo.innerHTML =
        'Insert/Remove hold frames at the <b>current</b> keyframe only. ' +
        'Seek to a keyframe, set value, then Increase or Decrease.';
      btnIncrease.innerHTML =
        '<span class="kfexp-label-full">Increase Exposure</span>' +
        '<span class="kfexp-label-short">+</span>';
      btnDecrease.innerHTML =
        '<span class="kfexp-label-full">Decrease Exposure</span>' +
        '<span class="kfexp-label-short">−</span>';
      btnDecrease.disabled = false;
      btnDecrease.style.opacity = '';
    }
  }

  // ── Normal mode ────────────────────────────────────────────────
  // Mirrors _normal_exposure() from the Python docker.
  function normalExposure(forcePositive) {
    const layer = layers[curLayer];
    if (!layer) { setStatus('⚠ No active layer.'); return; }

    const amount = Math.max(1, Math.min(999, parseInt(spinAmount.value) || 2));
    const shift = forcePositive ? amount : -amount;
    const targetFrame = selectedExposureFrame(curLayer);

    if (targetFrame === null || !layer.frames[targetFrame]) {
      setStatus('⚠ Select one keyframe first.');
      return;
    }

    if (shift > 0) {
      pushUndo();
      for (let i = 0; i < shift; i++) insertHoldFrame(curLayer, targetFrame + 1);
      setStatus(`✔ Frame ${targetFrame + 1}: inserted ${shift} hold frame(s).`);
    } else {
      const nextFrame = keyframeTimes(curLayer).find(frame => frame > targetFrame);
      const removable = nextFrame === undefined ? 0 : Math.max(0, nextFrame - targetFrame - 1);
      const actualShift = Math.min(Math.abs(shift), removable);
      if (!actualShift) {
        setStatus(`✔ Frame ${targetFrame + 1} is already at minimum exposure.`);
        return;
      }
      pushUndo();
      for (let i = 0; i < actualShift; i++) removeHoldFrame(curLayer, targetFrame + 1);
      setStatus(`✔ Frame ${targetFrame + 1}: removed ${actualShift} hold frame(s).`);
    }

    renderTimeline();
    recomposite(curLayer, targetFrame);
    updateStatus();
  }

  // Bypass mode
  function bypassExposure(forward) {
    const layer = layers[curLayer];
    if (!layer) { setStatus('⚠ No active layer.'); return; }

    if (!layer.frames[curFrame]) {
      setStatus(`⚠ No keyframe at frame ${curFrame + 1}. Seek to a keyframe first.`);
      return;
    }

    const exposure = Math.max(1, Math.min(999, parseInt(spinAmount.value) || 2));
    const kf = keyframeTimes(curLayer);

    let neighbour, currentGap, neededShift, dirLabel;

    if (forward) {
      const next = kf.find(f => f > curFrame);
      if (next === undefined) { setStatus('⚠ No next keyframe found.'); return; }
      neighbour    = next;
      currentGap   = neighbour - curFrame;
      neededShift  = exposure - currentGap; // +ve = insert, -ve = remove
      dirLabel     = 'next';
    } else {
      const prev = kf.filter(f => f < curFrame);
      if (!prev.length) { setStatus('⚠ No previous keyframe found.'); return; }
      neighbour    = prev[prev.length - 1];
      currentGap   = curFrame - neighbour;
      neededShift  = currentGap - exposure;
      dirLabel     = 'prev';
    }

    if (neededShift === 0) {
      setStatus(`✔ Gap to ${dirLabel} keyframe is already ${exposure} — nothing to do.`);
      return;
    }

    pushUndo();

    if (neededShift > 0) {
      // Need to INSERT frames to widen the gap.
      // In "forward" bypass we insert after curFrame;
      // in "backward" bypass we insert after the prev neighbour.
      const insertAt = forward ? curFrame + 1 : neighbour + 1;
      for (let i = 0; i < neededShift; i++) {
        insertHoldFrame(curLayer, insertAt);
      }
      setStatus(`✔ Bypass: inserted ${neededShift} hold frame(s). Gap to ${dirLabel} keyframe is now ${exposure}.`);
    } else {
      const absShift = Math.abs(neededShift);
      const removeAt = forward ? curFrame + 1 : neighbour + 1;
      for (let i = 0; i < absShift; i++) {
        removeHoldFrame(curLayer, removeAt);
      }
      setStatus(`✔ Bypass: removed ${absShift} hold frame(s). Gap to ${dirLabel} keyframe is now ${exposure}.`);
    }

    renderTimeline();
    recomposite(curLayer, curFrame);
    updateStatus();
  }

  // ── Route to the right mode ────────────────────────────────────
  // Mirrors _apply_exposure() from the Python docker.
  function applyExposure(forcePositive) {
    if (chkBypass.checked) {
      bypassExposure(forcePositive);
    } else {
      normalExposure(forcePositive);
    }
  }

  // ── Event wiring ───────────────────────────────────────────────
  btnIncrease.onclick = () => applyExposure(true);
  btnDecrease.onclick = () => applyExposure(false);

  // Keyboard shortcuts (Settings ▸ Keybinds — default '1' / '2'). Same
  // "don't steal keys from text inputs" guard used elsewhere (e.g.
  // brush-size-drag.js), and respects the Decrease button being disabled
  // in Bypass mode so the shortcut doesn't do something the UI hides.
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.target && (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA' || e.target.isContentEditable)) return;
    if (typeof matchBind !== 'function') return;
    if (matchBind(e, 'increaseExposure')) { e.preventDefault(); applyExposure(true); }
    else if (matchBind(e, 'decreaseExposure')) {
      if (btnDecrease.disabled) return;
      e.preventDefault(); applyExposure(false);
    }
  });

  spinAmount.onchange = () => {
    const v = Math.max(1, Math.min(999, parseInt(spinAmount.value) || 2));
    spinAmount.value = v;
    try { localStorage.setItem(STORE_KEY_AMOUNT, v); } catch(e) {}
  };

  chkBypass.onchange = () => {
    try { localStorage.setItem(STORE_KEY_BYPASS, chkBypass.checked ? '1' : '0'); } catch(e) {}
    applyBypassUI();
    setStatus('');
    // Remove leftover focus outline (same pattern as keyframe-switcher.js).
    setTimeout(() => chkBypass.blur(), 0);
  };

  // ── Stop scroll from reaching the canvas ──────────────────────
  // Same pattern as keyframe-switcher.js and layers.js.
  const kfexpBody = document.querySelector('#keyframe-exposure-panel .fp-body');
  if (kfexpBody) {
    kfexpBody.addEventListener('wheel', e => { e.stopPropagation(); }, { passive: true });
  }

  // ── Responsive compact mode ────────────────────────────────────
  // Progressive row-hiding as the panel shrinks, matching keyframe-switcher.js.
  //
  // The flicker/vibration fix: setting minHeight inside a ResizeObserver
  // callback triggers another ResizeObserver notification, which sets
  // minHeight again, creating an infinite feedback loop that makes the panel
  // shake. The fix is two-pronged:
  //   1. Guard with `_updating` so re-entrant callbacks are dropped.
  //   2. Only write minHeight / classList when the value actually changes,
  //      so the DOM mutation that would re-trigger the observer is avoided
  //      entirely in the steady state.
  const kfexpPanel = document.getElementById('keyframe-exposure-panel');
  if (kfexpPanel && typeof ResizeObserver !== 'undefined') {

    const HEIGHT_SEQ = [
      'kfexp-hide-hint',
      'kfexp-hide-info',
      'kfexp-compact',
    ];

    let _updating = false;
    let _lastMinH = '';
    let _lastClasses = '';

    function measuredContentHeight() {
      const titlebar = kfexpPanel.querySelector('.fp-titlebar');
      const body     = kfexpPanel.querySelector('.fp-body');
      if (!body) return 0;
      const tbH = titlebar ? titlebar.offsetHeight : 0;
      const gap = 8;
      let total = tbH + gap;
      Array.from(body.children).forEach((c, i, arr) => {
        if (getComputedStyle(c).display === 'none') return;
        total += c.offsetHeight;
        if (i < arr.length - 1) total += gap;
      });
      return total + gap;
    }

    const ro = new ResizeObserver(() => {
      if (_updating) return;
      _updating = true;

      const w        = kfexpPanel.offsetWidth;
      const h        = kfexpPanel.offsetHeight;
      const isDocked = kfexpPanel.classList.contains('docked');
      const compact  = w < 140;

      // ── width axis: compact toggle ───────────────────────────
      if (kfexpPanel.classList.contains('kfexp-compact') !== compact) {
        kfexpPanel.classList.toggle('kfexp-compact', compact);
      }

      // ── height axis: progressive row hiding ──────────────────
      if (!compact) {
        // Reset all height-driven classes first, then add back what's needed.
        HEIGHT_SEQ.forEach(cls => { if (cls !== 'kfexp-compact') kfexpPanel.classList.remove(cls); });
        for (const cls of HEIGHT_SEQ) {
          if (measuredContentHeight() <= h) break;
          kfexpPanel.classList.add(cls);
        }
      }

      // ── minHeight: only write when the value changes ─────────
      // Writing the same string twice still counts as a DOM mutation and
      // can re-fire the observer, so skip it when nothing would change.
      let newMinH = '';
      if (!isDocked && compact) {
        newMinH = measuredContentHeight() + 'px';
      }
      if (newMinH !== _lastMinH) {
        kfexpPanel.style.minHeight = newMinH;
        _lastMinH = newMinH;
      }

      _updating = false;
    });

    ro.observe(kfexpPanel);
  }

})();
