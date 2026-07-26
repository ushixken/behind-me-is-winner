// ════════════════════════════════════════════════════════════════
// KEYFRAME SWITCHER — ported from the Krita "Keyframe Switcher" docker
// (keyframe_switcher.py). Shows the current frame/layer/keyframe state
// and lets you jump to the previous/next keyframe on the active layer,
// or (with "Bypass keyframes" checked) just step by a fixed frame count.
//
// Mapping from Krita's model to this app's:
//   Krita node.hasKeyframeAtTime(f)  ->  !!layers[li].frames[f]
//   doc.currentTime()/setCurrentTime ->  curFrame / goToFrame()
//   doc.activeNode()                 ->  layers[curLayer]
//   fullClipRange start/end          ->  0 / TOTAL-1
// ════════════════════════════════════════════════════════════════
(function(){
  const STORE_KEY_STEP='animator_kfsw_step';
  const STORE_KEY_BYPASS='animator_kfsw_bypass';
  const STORE_KEY_FLIPTHROUGH='animator_kfsw_flipthrough';

  const elFrame=document.getElementById('kfsw-frame');
  const elLayer=document.getElementById('kfsw-layer');
  const elCount=document.getElementById('kfsw-count');
  const elPrev=document.getElementById('kfsw-prev');
  const elNext=document.getElementById('kfsw-next');
  const btnPrev=document.getElementById('kfsw-btn-prev');
  const btnNext=document.getElementById('kfsw-btn-next');
  const spinStep=document.getElementById('kfsw-step');
  const chkBypass=document.getElementById('kfsw-bypass');

  // ── Flip Through DOM refs ──────────────────────────────────────
  const chkFtKf = document.getElementById('kfsw-ft-kf');
  const chkFtBd = document.getElementById('kfsw-ft-bd');
  const chkFtIb = document.getElementById('kfsw-ft-ib');
  const ftChips = document.querySelectorAll('.kfsw-ft-chip');

  // ── Drawing Mark DOM refs (Drawing Marks panel) ───────────────
  const markSwatch  = document.getElementById('dm-swatch');
  const markName    = document.getElementById('dm-label');
  const markBtns    = document.querySelectorAll('.dm-btn[data-mark]');
  const hiddenBtn   = document.getElementById('dm-btn-hidden');

  // ── Highlight helpers ──────────────────────────────────────────
  // Apply --kfsw-mark-color as a CSS custom property so the active button
  // tints via CSS without needing per-element inline styles beyond one var.
  function _applyMarkColor(btn, colorHex){
    btn.style.setProperty('--kfsw-mark-color', colorHex);
  }

  function _refreshMarkButtons(currentMarkId){
    const hasKey = !!(layers[curLayer] && layers[curLayer].frames[curFrame]);
    const def = (typeof DRAWING_MARKS !== 'undefined') ? DRAWING_MARKS : null;
    const hidden = hasKey && typeof isDrawingFrameHidden==='function' && isDrawingFrameHidden(curLayer,curFrame);
    if(hiddenBtn){hiddenBtn.classList.toggle('dm-btn-active',hidden);hiddenBtn.disabled=!hasKey;}

    markBtns.forEach(btn => {
      const id = btn.dataset.mark;
      const isActive = hasKey && id === currentMarkId;
      btn.classList.toggle('dm-btn-active', isActive);
      btn.disabled = false;
      if(def && def[id]){
        _applyMarkColor(btn, def[id].color);
      }
    });

    // Swatch + label reflect the current frame's mark (or dim if no key)
    if(hasKey && def && def[currentMarkId]){
      const m = def[currentMarkId];
      markSwatch.style.background = m.color;
      markSwatch.style.borderColor = m.color;
      markName.textContent = hidden ? 'Hidden - '+m.displayName : m.displayName;
      markName.style.color = '';
    } else {
      markSwatch.style.background = '';
      markSwatch.style.borderColor = '';
      markName.textContent = hasKey ? '—' : 'No drawing';
      markName.style.color = 'var(--text2)';
    }
  }

  // ── refreshMarks — called from the polling loop ────────────────
  function refreshMarks(){
    if(typeof getDrawingMark !== 'function') return;
    const id = getDrawingMark(curLayer, curFrame);
    _refreshMarkButtons(id);
  }

  // ── Assign mark on button click ────────────────────────────────
  markBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = layers[curLayer];
      if(!layer || !layer.frames[curFrame]) return; // no drawing to mark
      const id = btn.dataset.mark;
      if(typeof setDrawingMark === 'function') setDrawingMark(curLayer, curFrame, id);
      refreshMarks();
      if(typeof renderTimeline === 'function') renderTimeline();
    });
  });

  if(hiddenBtn){
    hiddenBtn.addEventListener('click',()=>{
      const layer=layers[curLayer];
      if(!layer||!layer.frames[curFrame])return;
      const before=typeof isDrawingFrameHidden==='function'&&isDrawingFrameHidden(curLayer,curFrame);
      if(!before&&typeof saveActiveToKey==='function')saveActiveToKey();
      if(typeof setDrawingFrameHidden!=='function'||!setDrawingFrameHidden(curLayer,curFrame,!before))return;
      undoStack.push({type:'drawing-frame-hidden',layer:curLayer,frame:curFrame,before,after:!before});
      if(undoStack.length>40)undoStack.shift();
      redoStack=[];
      loadFrame(curLayer,curFrame);
      renderTimeline();
      refreshMarks();
    });
  }
  // Restore saved options (step + bypass), same pattern as other prefs in this app.
  try{
    const savedStep=parseInt(localStorage.getItem(STORE_KEY_STEP));
    if(savedStep>=1) spinStep.value=Math.max(1,Math.min(100,savedStep));
  }catch(e){}
  try{
    chkBypass.checked=localStorage.getItem(STORE_KEY_BYPASS)==='1';
  }catch(e){}

  // ── Flip Through filter state ──────────────────────────────────
  // Controls which drawing marks Prev/Next navigation will visit.
  // At least one filter must always remain enabled.
  let _flipThrough = { keyframe: true, breakdown: true, inbetween: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY_FLIPTHROUGH));
    if(saved && typeof saved === 'object'){
      const v = { keyframe: !!saved.keyframe, breakdown: !!saved.breakdown, inbetween: !!saved.inbetween };
      if(v.keyframe || v.breakdown || v.inbetween) _flipThrough = v;
    }
  } catch(e) {}

  function _saveFlipThrough(){
    try{ localStorage.setItem(STORE_KEY_FLIPTHROUGH, JSON.stringify(_flipThrough)); }catch(e){}
  }

  // Apply mark colors from DRAWING_MARKS to chips as CSS custom properties,
  // mirroring the _applyMarkColor() pattern used by the mark buttons above.
  function _initFlipThroughChips(){
    const def = (typeof DRAWING_MARKS !== 'undefined') ? DRAWING_MARKS : null;
    ftChips.forEach(chip => {
      const mark = chip.dataset.mark;
      if(def && def[mark]) chip.style.setProperty('--kfsw-mark-color', def[mark].color);
    });
    chkFtKf.checked = _flipThrough.keyframe;
    chkFtBd.checked = _flipThrough.breakdown;
    chkFtIb.checked = _flipThrough.inbetween;
  }
  _initFlipThroughChips();

  function _onFlipThroughChange(markId, chk){
    if(!chk.checked){
      // Reject the uncheck if it would leave nothing enabled.
      const othersEnabled = Object.entries(_flipThrough)
        .filter(([k]) => k !== markId)
        .some(([, v]) => v);
      if(!othersEnabled){ chk.checked = true; return; }
    }
    _flipThrough[markId] = chk.checked;
    _saveFlipThrough();
    refresh();
  }

  chkFtKf.addEventListener('change', () => _onFlipThroughChange('keyframe',   chkFtKf));
  chkFtBd.addEventListener('change', () => _onFlipThroughChange('breakdown',  chkFtBd));
  chkFtIb.addEventListener('change', () => _onFlipThroughChange('inbetween',  chkFtIb));

  // Returns the sorted list of frame indices on `li` that hold an actual
  // keyframe (i.e. layers[li].frames[f] exists) — the equivalent of
  // Krita's node.hasKeyframeAtTime() scan in _keyframe_times().
  function keyframeTimes(li){
    const layer=layers[li];
    if(!layer) return [];
    return Object.keys(layer.frames).map(Number).sort((a,b)=>a-b);
  }

  // Returns only the frames whose drawing mark is enabled in _flipThrough.
  // Used exclusively by navigate() and the Prev/Next display in refresh() —
  // the total Keyframes count and Drawing Mark section are always unfiltered.
  function filteredFrameTimes(li){
    const times = keyframeTimes(li).filter(f=>!(typeof isDrawingFrameHidden==='function'&&isDrawingFrameHidden(li,f)));
    if(_flipThrough.keyframe && _flipThrough.breakdown && _flipThrough.inbetween) return times;
    return times.filter(f => {
      const mark = (typeof getDrawingMark === 'function') ? getDrawingMark(li, f) : 'inbetween';
      return !!_flipThrough[mark];
    });
  }

  function refresh(){
    const layer=layers[curLayer];
    if(!layer){
      elFrame.textContent='—';elLayer.textContent='—';elCount.textContent='—';
      elPrev.textContent='—';elNext.textContent='—';
      refreshMarks();
      return;
    }
    const kf=keyframeTimes(curLayer);
    const fkf=filteredFrameTimes(curLayer);
    const prev=fkf.filter(f=>f<curFrame);
    const next=fkf.filter(f=>f>curFrame);
    elFrame.textContent=frameLabel(curFrame)+' / '+TOTAL;
    elLayer.textContent=layer.name;
    elCount.textContent=kf.length;
    elPrev.textContent=prev.length?frameLabel(prev[prev.length-1]):'—';
    elNext.textContent=next.length?frameLabel(next[0]):'—';
    refreshMarks();
  }

function _visibleStepTarget(start,direction){
    for(let f=start;f>=rangeStart&&f<=rangeEnd;f+=direction){
      if(!(typeof isDrawingFrameHidden==='function'&&isDrawingFrameHidden(curLayer,f)))return f;
    }
    return null;
  }
  function navigate(direction){
    if(!layers[curLayer]) return;
    const step=Math.max(1,Math.min(100,parseInt(spinStep.value)||1));

    // At the out point, "next frame" wraps to the in point (and vice versa),
    // same as the timeline's step forward/back buttons — this takes priority
    // over jumping to the next/prev keyframe or bypass-stepping.
    if(direction>0&&curFrame>=rangeEnd){const target=chkBypass.checked?rangeStart:_visibleStepTarget(rangeStart,1);if(target!==null)goToFrame(target);refresh();return;}
    if(direction<0&&curFrame<=rangeStart){const target=chkBypass.checked?rangeEnd:_visibleStepTarget(rangeEnd,-1);if(target!==null)goToFrame(target);refresh();return;}

    let target;

    if(chkBypass.checked){
      // Bypass: always move by the frame step, ignore keyframes entirely.
      target=curFrame+direction*step;
    } else {
      // Normal: jump to the next/prev drawing that passes the Flip Through
      // filter (KF / BD / IB checkboxes), falling back to a plain step if
      // there is no matching frame in that direction.
      const kf=filteredFrameTimes(curLayer);
      if(direction>0){
        target=kf.find(f=>f>curFrame);
      } else {
        const earlier=kf.filter(f=>f<curFrame);
        target=earlier.length?earlier[earlier.length-1]:undefined;
      }
      if(target===undefined) target=curFrame+direction*step;
    }

    target=Math.max(0,Math.min(TOTAL-1,target));
    if(!chkBypass.checked&&typeof isDrawingFrameHidden==='function'&&isDrawingFrameHidden(curLayer,target)){const visible=_visibleStepTarget(target,direction);if(visible===null){refresh();return;}target=visible;}
    goToFrame(target);
    refresh();
  }

  btnPrev.onclick=()=>navigate(-1);
  btnNext.onclick=()=>navigate(+1);

  // Exposed so the "Next Frame"/"Previous Frame" keybinds (see keybinds.js /
  // ui-controls.js) can drive frame stepping through the same keyframe-aware
  // (or bypass-step) logic as the Prev/Next buttons in this panel, instead
  // of a plain curFrame±1.
  window.kfswNavigate=navigate;

  function _commitStep(){
    const v=Math.max(1,Math.min(100,parseInt(spinStep.value)||1));
    spinStep.value=v;
    try{localStorage.setItem(STORE_KEY_STEP,v);}catch(e){}
    refresh();
  }
  spinStep.oninput=_commitStep;
  spinStep.onchange=_commitStep;
  chkBypass.onchange=()=>{
    try{localStorage.setItem(STORE_KEY_BYPASS,chkBypass.checked?'1':'0');}catch(e){}
    setTimeout(()=>chkBypass.blur(),0);
  };

  // ── Hold-key bypass (default: Shift) ──────────────────────────
  // Holding the bound key force-enables bypass as a temporary mode.
  // The key is also "transparent" — matchBind() in keybinds.js strips it
  // from modifier checks so other keybinds (nextFrame, prevFrame, etc.)
  // still fire normally while it's held.
  let _bypassHoldActive=false;
  let _bypassBeforeHold=false;
  window._flipperBypassHeld=false;

  function _matchFlipperBypass(e){
    const b=keybinds['flipperBypass'];
    if(!b) return false;
    const k=b.key;
    // Lone modifier keys arrive as e.key === 'Shift' etc.
    if(k==='Shift'||k==='Control'||k==='Alt'){
      return e.key===k && !!b.ctrl===!!e.ctrlKey && !!b.alt===!!e.altKey;
    }
    return matchBind(e,'flipperBypass');
  }

  document.addEventListener('keydown',e=>{
    if(e.repeat) return;
    if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)) return;
    if(!_matchFlipperBypass(e)) return;
    if(_bypassHoldActive) return;
    _bypassHoldActive=true;
    window._flipperBypassHeld=true;
    _bypassBeforeHold=chkBypass.checked;
    if(!chkBypass.checked){
      chkBypass.checked=true;
      chkBypass.dispatchEvent(new Event('change'));
    }
  });

  function _releaseBypassHold(){
    if(!_bypassHoldActive) return;
    _bypassHoldActive=false;
    window._flipperBypassHeld=false;
    if(!_bypassBeforeHold&&chkBypass.checked){
      chkBypass.checked=false;
      chkBypass.dispatchEvent(new Event('change'));
    }
  }

  document.addEventListener('keyup',e=>{ if(_matchFlipperBypass(e)) _releaseBypassHold(); });
  window.addEventListener('blur',_releaseBypassHold);

  // Krita's docker polled with a 400ms QTimer (plus a handful of Krita
  // notifier signals) since there's no single choke point every frame/layer
  // change passes through. This app doesn't have that either, so mirror the
  // same polling approach here — cheap, and immune to missing a hook.
  setInterval(refresh,400);
  refresh();

  // ── Responsive compact mode — progressive row hiding, then scroll ────
  //
  // Both floating and docked use the same row-hiding sequence (height-driven).
  // After all rows are hidden (kfsw-compact), behaviour differs:
  //   FLOATING  — min-height is locked to compact height; can't shrink further.
  //   DOCKED    — body becomes scrollable (like Layers panel); no min-height
  //               enforced because the split handle controls height externally.
  //
  // Width never hides rows; only collapses the whole state block at ≤106px.
  const kfswPanel = document.getElementById('keyframe-switcher-panel');
  if(kfswPanel && typeof ResizeObserver !== 'undefined'){

    function measuredContentHeight(){
      const titlebar = kfswPanel.querySelector('.fp-titlebar');
      const body     = kfswPanel.querySelector('.fp-body');
      if(!body) return 0;
      const tbH = titlebar ? titlebar.offsetHeight : 0;
      const gap = 8;
      let total = tbH + gap;
      Array.from(body.children).forEach((c, i, arr) => {
        if(getComputedStyle(c).display === 'none') return;
        total += c.offsetHeight;
        if(i < arr.length - 1) total += gap;
      });
      return total + gap;
    }

    function availableHeight(){
      return kfswPanel.offsetHeight;
    }

    const HEIGHT_SEQ = [
      'kfsw-hide-next',
      'kfsw-hide-prev',
      'kfsw-hide-keyframes',
      'kfsw-hide-layer',
      'kfsw-hide-state',
    ];

    // _resizeDragging: true while a float-edge drag is active.
    let _resizeDragging = false;

    function _applyLayout(){
      const w = kfswPanel.offsetWidth;
      const h = availableHeight();
      const isDocked = kfswPanel.classList.contains('docked');

      // Width axis collapse
      kfswPanel.classList.toggle('kfsw-compact', w < 106);

      // Height axis: reset all hide classes, then re-apply until content fits
      HEIGHT_SEQ.forEach(cls => kfswPanel.classList.remove(cls));
      if(!kfswPanel.classList.contains('kfsw-compact')){
        for(const cls of HEIGHT_SEQ){
          if(measuredContentHeight() <= h) break;
          kfswPanel.classList.add(cls);
        }
      }

      // minHeight strategy (floating only):
      //   Once all Current State rows are hidden (state block gone), lock
      //   minHeight to the remaining content — nav + flipthrough + options —
      //   so the panel can't be squished any further.
      //   While state rows are still collapsing, keep minHeight clear so the
      //   drag handle can keep moving without fighting back.
      if(!isDocked){
        const stateFullyHidden = kfswPanel.classList.contains('kfsw-hide-state');
        if(stateFullyHidden){
          kfswPanel.style.minHeight = measuredContentHeight() + 'px';
        } else {
          kfswPanel.style.minHeight = '';
        }
      } else {
        kfswPanel.style.minHeight = '';
      }
    }

    kfswPanel.addEventListener('pointerdown', e => {
      if(e.target && e.target.classList && e.target.classList.contains('fp-float-resize')){
        _resizeDragging = true;
      }
    }, true);
    function _onKfswResizeEnd(){
      if(!_resizeDragging) return;
      _resizeDragging = false;
      _applyLayout();
    }
    document.addEventListener('pointerup',    _onKfswResizeEnd, true);
    document.addEventListener('pointercancel',_onKfswResizeEnd, true);

    const ro = new ResizeObserver(() => {
      // Run the full layout pass on every resize (including during drag).
      // minHeight is only written when all rows are already hidden, so it
      // never freezes the floor mid-drag and never fights panels.js.
      _applyLayout();
    });
    ro.observe(kfswPanel);
  }

  // ── Drawing Marks panel — responsive layout ──────────────────────
  // Responsive Drawing Marks layout. Measurements come from the current
  // contents so adding another mark button does not require new breakpoints.
  const dmPanel = document.getElementById('drawing-marks-panel');
  if(dmPanel && typeof ResizeObserver !== 'undefined'){
    const dmButtons=dmPanel.querySelector('.dm-btns');
    const dmLabelWrap=dmPanel.querySelector('.dm-swatch-wrap');
    const dmLabel=dmPanel.querySelector('.dm-label');
    const dmSwatch=dmPanel.querySelector('.dm-swatch');
    const dmTitlebar=dmPanel.querySelector('.fp-titlebar');
    const dmBody=dmPanel.querySelector('.fp-body');
    let _dmState='';
    let _dmRafPending=false;
    let _dmKnownLabelWidth=72;

    function _dmApplyLayout(){
      _dmRafPending=false;
      if(!dmButtons||!dmBody)return;

      // Temporarily rely on intrinsic row width, not the panel's current width.
      const bodyStyle=getComputedStyle(dmBody);
      const horizontalPadding=(parseFloat(bodyStyle.paddingLeft)||0)+(parseFloat(bodyStyle.paddingRight)||0);
      const buttonStyle=getComputedStyle(dmButtons);
      const buttonGap=parseFloat(buttonStyle.columnGap||buttonStyle.gap)||0;
      const buttons=Array.from(dmButtons.children).filter(button=>getComputedStyle(button).display!=='none');
      const buttonRowWidth=buttons.reduce((width,button)=>width+button.offsetWidth,0)
        +Math.max(0,buttons.length-1)*buttonGap;
      const safeMinimum=Math.ceil(buttonRowWidth+horizontalPadding+2);
      const safeMinimumCss=safeMinimum+'px';
      if(dmPanel.style.minWidth!==safeMinimumCss)dmPanel.style.minWidth=safeMinimumCss;

      if(dmLabelWrap&&getComputedStyle(dmLabelWrap).display!=='none'){
        const labelGap=5;
        _dmKnownLabelWidth=Math.max(_dmKnownLabelWidth,(dmSwatch?dmSwatch.offsetWidth:0)+labelGap+(dmLabel?dmLabel.scrollWidth:0));
      }
      const normalWidth=safeMinimum+_dmKnownLabelWidth+6;
      const titleHeight=dmTitlebar?dmTitlebar.offsetHeight:0;
      const verticalHeight=titleHeight+(parseFloat(bodyStyle.paddingTop)||0)+(parseFloat(bodyStyle.paddingBottom)||0)
        +Math.max(dmLabelWrap?dmLabelWrap.scrollHeight:0,12)+6+dmButtons.scrollHeight;
      const hasHorizontalRoom=dmPanel.clientWidth>=normalWidth;
      const hasVerticalRoom=dmPanel.clientHeight>=verticalHeight;
      const next=hasHorizontalRoom?'normal':(hasVerticalRoom?'vertical':'compact');
      if(next===_dmState)return;
      _dmState=next;
      dmPanel.classList.toggle('dm-compact',next==='compact');
      dmPanel.classList.toggle('dm-vertical',next==='vertical');
    }

    function _dmSchedule(){
      if(_dmRafPending)return;
      _dmRafPending=true;
      requestAnimationFrame(_dmApplyLayout);
    }

    new ResizeObserver(_dmSchedule).observe(dmPanel);
    _dmSchedule();
  }
  // Stop wheel events from bubbling to the canvas when scrolling the body
  // (same pattern as the Layers and Brush Presets panels in layers.js).
  const kfswBody = document.querySelector('#keyframe-switcher-panel .fp-body');
  if(kfswBody) kfswBody.addEventListener('wheel', e => { e.stopPropagation(); }, {passive:true});
})();