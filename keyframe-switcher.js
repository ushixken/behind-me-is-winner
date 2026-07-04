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
    // Without this, focus stays on the checkbox after clicking it, and the
    // app's global keydown handler ignores keys while any <input> is
    // focused (see ui-controls.js) — silently breaking the Next/Prev Frame
    // keybinds until the user clicks elsewhere first.
    chkBypass.blur();
  };

  // Krita's docker polled with a 400ms QTimer (plus a handful of Krita
  // notifier signals) since there's no single choke point every frame/layer
  // change passes through. This app doesn't have that either, so mirror the
  // same polling approach here — cheap, and immune to missing a hook.
  setInterval(refresh,400);
  refresh();
})();