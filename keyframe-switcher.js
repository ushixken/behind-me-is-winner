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

  const elFrame=document.getElementById('kfsw-frame');
  const elLayer=document.getElementById('kfsw-layer');
  const elCount=document.getElementById('kfsw-count');
  const elPrev=document.getElementById('kfsw-prev');
  const elNext=document.getElementById('kfsw-next');
  const btnPrev=document.getElementById('kfsw-btn-prev');
  const btnNext=document.getElementById('kfsw-btn-next');
  const spinStep=document.getElementById('kfsw-step');
  const chkBypass=document.getElementById('kfsw-bypass');

  // Restore saved options (step + bypass), same pattern as other prefs in this app.
  try{
    const savedStep=parseInt(localStorage.getItem(STORE_KEY_STEP));
    if(savedStep>=1) spinStep.value=Math.max(1,Math.min(100,savedStep));
  }catch(e){}
  try{
    chkBypass.checked=localStorage.getItem(STORE_KEY_BYPASS)==='1';
  }catch(e){}

  // Returns the sorted list of frame indices on `li` that hold an actual
  // keyframe (i.e. layers[li].frames[f] exists) — the equivalent of
  // Krita's node.hasKeyframeAtTime() scan in _keyframe_times().
  function keyframeTimes(li){
    const layer=layers[li];
    if(!layer) return [];
    return Object.keys(layer.frames).map(Number).sort((a,b)=>a-b);
  }

  function refresh(){
    const layer=layers[curLayer];
    if(!layer){
      elFrame.textContent='—';elLayer.textContent='—';elCount.textContent='—';
      elPrev.textContent='—';elNext.textContent='—';
      return;
    }
    const kf=keyframeTimes(curLayer);
    const prev=kf.filter(f=>f<curFrame);
    const next=kf.filter(f=>f>curFrame);
    elFrame.textContent=(curFrame+1)+' / '+TOTAL;
    elLayer.textContent=layer.name;
    elCount.textContent=kf.length;
    elPrev.textContent=prev.length?(prev[prev.length-1]+1):'—';
    elNext.textContent=next.length?(next[0]+1):'—';
  }

  function navigate(direction){
    if(!layers[curLayer]) return;
    const step=Math.max(1,Math.min(100,parseInt(spinStep.value)||1));
    let target;

    if(chkBypass.checked){
      // Bypass: always move by the frame step, ignore keyframes entirely.
      target=curFrame+direction*step;
    } else {
      // Normal: jump to the next/prev keyframe on the active layer,
      // falling back to a plain step if there isn't one that direction.
      const kf=keyframeTimes(curLayer);
      if(direction>0){
        target=kf.find(f=>f>curFrame);
      } else {
        const earlier=kf.filter(f=>f<curFrame);
        target=earlier.length?earlier[earlier.length-1]:undefined;
      }
      if(target===undefined) target=curFrame+direction*step;
    }

    target=Math.max(0,Math.min(TOTAL-1,target));
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

  spinStep.onchange=()=>{
    const v=Math.max(1,Math.min(100,parseInt(spinStep.value)||1));
    spinStep.value=v;
    try{localStorage.setItem(STORE_KEY_STEP,v);}catch(e){}
  };
  chkBypass.onchange=()=>{
    try{localStorage.setItem(STORE_KEY_BYPASS,chkBypass.checked?'1':'0');}catch(e){}
    // Without this, focus (and its blue outline) stays on the checkbox after
    // clicking it. The keydown guard in ui-controls.js now lets shortcuts
    // through even while a checkbox is focused, but clearing focus here too
    // avoids the leftover outline. Deferred a tick so it runs after the
    // browser's own click-focus handling settles.
    setTimeout(()=>chkBypass.blur(),0);
  };

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
      'kfsw-compact',
    ];

    const ro = new ResizeObserver(entries => {
      for(const entry of entries){
        const w = entry.contentRect.width;
        const h = availableHeight();
        const isDocked = kfswPanel.classList.contains('docked');

        // Width axis: collapse whole state block at extreme narrow width only.
        kfswPanel.classList.toggle('kfsw-compact', w < 106);

        // Height axis: reset, then progressively hide rows until content fits.
        HEIGHT_SEQ.forEach(cls => { if(cls !== 'kfsw-compact') kfswPanel.classList.remove(cls); });
        if(!kfswPanel.classList.contains('kfsw-compact')){
          for(const cls of HEIGHT_SEQ){
            if(measuredContentHeight() <= h) break;
            kfswPanel.classList.add(cls);
          }
        }

        // Floating: lock min-height at compact floor so panel can't shrink further.
        // Docked: clear min-height — split handle controls height, body scrolls.
        if(!isDocked && kfswPanel.classList.contains('kfsw-compact')){
          kfswPanel.style.minHeight = measuredContentHeight() + 'px';
        } else {
          kfswPanel.style.minHeight = '';
        }
      }
    });
    ro.observe(kfswPanel);
  }

  // Stop wheel events from bubbling to the canvas when scrolling the body
  // (same pattern as the Layers and Brush Presets panels in layers.js).
  const kfswBody = document.querySelector('#keyframe-switcher-panel .fp-body');
  if(kfswBody) kfswBody.addEventListener('wheel', e => { e.stopPropagation(); }, {passive:true});
})();