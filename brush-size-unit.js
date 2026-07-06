// brush-size-unit.js — px/mm display unit for brush size + tap-to-type exact value
// The underlying stored size (toolSizes[tool]) always stays in px (that's what the
// brush engine draws with — see getBrushSize() in brush-engine.js). This module only
// changes how that px number is *displayed* (px or mm) and lets the user type an exact
// number in whichever unit is currently shown. Because the stored value is a float and
// the pressure-driven radius (_computeEffectiveParams in brush-engine.js) already
// interpolates continuously, switching to mm — with its sub-pixel-equivalent decimals —
// makes it easy to dial in a precise, print-accurate size that pressure then scales
// smoothly from.
(function(){
  // Screen px <-> mm at a standard 96 CSS-px-per-inch reference (same assumption
  // browsers use everywhere else, e.g. CSS "1in" == 96px).
  const PX_PER_MM = 96 / 25.4; // ≈ 3.7795

  let sizeUnit = (function(){
    try{ return localStorage.getItem('brushSizeUnit') === 'mm' ? 'mm' : 'px'; }
    catch(e){ return 'px'; }
  })();

  function pxToMm(px){ return px / PX_PER_MM; }
  function mmToPx(mm){ return mm * PX_PER_MM; }

  // How many decimals to show, so small sizes stay readable but big ones aren't noisy.
  function fmt(n, decimals){
    const r = Math.round(n*Math.pow(10,decimals))/Math.pow(10,decimals);
    return (r % 1 === 0) ? String(r) : r.toFixed(decimals).replace(/0+$/,'').replace(/\.$/,'');
  }

  function displayValue(px){
    if(sizeUnit==='mm'){
      const mm = pxToMm(px);
      return fmt(mm, mm<10?2:1);
    }
    return fmt(px, px<10?1:0);
  }

  // Re-render both size readouts (Brush Presets size bar + Tool Settings modal)
  // from the single source of truth, toolSizes[tool]. Call this any time the
  // underlying px size changes instead of writing the number directly.
  function refreshSizeUI(){
    const px = (typeof toolSizes!=='undefined' && toolSizes[tool]!=null) ? toolSizes[tool] : 6;
    const txt = displayValue(px);
    const tsVal=document.getElementById('ts-size-val'); if(tsVal && document.activeElement!==tsVal._editingInput) tsVal.textContent=txt;
    const bpVal=document.getElementById('bp-sz-val'); if(bpVal) bpVal.textContent=txt;
    const tsUnitBtn=document.getElementById('ts-size-unit'); if(tsUnitBtn){tsUnitBtn.textContent=sizeUnit;tsUnitBtn.classList.toggle('active-mm',sizeUnit==='mm');}
    const bpUnitBtn=document.getElementById('bp-sz-unit'); if(bpUnitBtn){bpUnitBtn.textContent=sizeUnit;bpUnitBtn.classList.toggle('active-mm',sizeUnit==='mm');}
  }
  window.refreshSizeUI = refreshSizeUI;
  window._brushSizeUnit = { get unit(){return sizeUnit;}, pxToMm, mmToPx };

  // Apply a newly-typed/parsed px size: clamp to slider bounds, push to every
  // synced control, and let the rest of the app react exactly like a slider drag would.
  function applyNewSize(px){
    const slider = document.getElementById('ts-size');
    const min = slider ? +slider.min : 0.1, max = slider ? +slider.max : 200;
    px = Math.max(min, Math.min(max, px));
    px = Math.round(px*10)/10; // keep one decimal of px precision
    toolSizes[tool] = px;
    const tsSz=document.getElementById('ts-size'); if(tsSz) tsSz.value=px;
    const bpSz=document.getElementById('bp-sz'); if(bpSz) bpSz.value=px;
    if(typeof _aaDabCache!=='undefined') _aaDabCache.clear();
    if(typeof _stampCache!=='undefined') _stampCache.clear();
    refreshSizeUI();
    if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(false);
  }

  // Turn a size readout span into a tap/click-to-type text field.
  function makeEditable(span){
    if(!span) return;
    function beginEdit(){
      if(span.querySelector('input')) return; // already editing
      const px = (typeof toolSizes!=='undefined' && toolSizes[tool]!=null) ? toolSizes[tool] : 6;
      const current = sizeUnit==='mm' ? pxToMm(px) : px;
      const input=document.createElement('input');
      input.type='text';
      input.inputMode='decimal';
      input.className='size-val-input';
      input.value=fmt(current, sizeUnit==='mm'?2:1);
      span._editingInput=input;
      span.textContent='';
      span.appendChild(input);
      input.focus();
      input.select();
      function commit(){
        const raw=(input.value||'').replace(',', '.').trim();
        const n=parseFloat(raw);
        span._editingInput=null;
        if(!isNaN(n) && n>0){
          const px2 = sizeUnit==='mm' ? mmToPx(n) : n;
          applyNewSize(px2);
        } else {
          refreshSizeUI();
        }
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); input.blur(); }
        else if(e.key==='Escape'){ e.preventDefault(); span._editingInput=null; refreshSizeUI(); }
        e.stopPropagation();
      });
      input.addEventListener('pointerdown', e=>e.stopPropagation());
    }
    span.addEventListener('click', beginEdit);
    span.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); beginEdit(); } });
  }

  function toggleUnit(){
    sizeUnit = sizeUnit==='mm' ? 'px' : 'mm';
    try{ localStorage.setItem('brushSizeUnit', sizeUnit); }catch(e){}
    refreshSizeUI();
  }

  // ── Robust slider dragging ──────────────────────────────────────
  // Native <input type=range> dragging can stop tracking once the pointer
  // leaves the element's bounding box (most noticeable on touch/pen, but
  // also happens with fast mouse drags past the bar's top/bottom edge).
  // Fix: take over pointer handling ourselves with setPointerCapture, so
  // once a drag starts on the slider, every subsequent pointermove keeps
  // updating the value from the pointer's horizontal position — no matter
  // how far above/below/beside the bar the cursor travels — exactly like
  // professional apps (Photoshop, Krita) behave.
  function wireRobustDrag(slider){
    if(!slider || slider._robustDragWired) return;
    slider._robustDragWired = true;
    function setFromClientX(clientX){
      const rect = slider.getBoundingClientRect();
      let t = rect.width ? (clientX - rect.left) / rect.width : 0;
      t = Math.max(0, Math.min(1, t));
      const min = +slider.min || 0, max = +slider.max || 100, step = +slider.step || 1;
      let v = min + t*(max-min);
      v = Math.round(v/step)*step;
      v = Math.max(min, Math.min(max, v));
      // Avoid redundant 'input' events (and re-renders) when the value didn't change.
      if(+slider.value === v) return;
      slider.value = v;
      slider.dispatchEvent(new Event('input', {bubbles:true}));
    }
    slider.addEventListener('pointerdown', e=>{
      if(e.button!==undefined && e.button!==0 && e.pointerType==='mouse') return;
      e.preventDefault();
      slider.focus();
      try{ slider.setPointerCapture(e.pointerId); }catch(err){}
      setFromClientX(e.clientX);
      const onMove=ev=>{ ev.preventDefault(); setFromClientX(ev.clientX); };
      const onUp=ev=>{
        try{ slider.releasePointerCapture(ev.pointerId); }catch(err){}
        slider.removeEventListener('pointermove', onMove);
        slider.removeEventListener('pointerup', onUp);
        slider.removeEventListener('pointercancel', onUp);
        // Don't leave the slider holding keyboard focus after the drag ends —
        // a focused <input> (even type=range) would otherwise be excluded by
        // the Space/Ctrl+Space pan handler's "don't steal space from text
        // fields" check, letting the browser treat Ctrl+Space as its own
        // shortcut (jumping to the address/search bar) right after resizing.
        slider.blur();
      };
      slider.addEventListener('pointermove', onMove);
      slider.addEventListener('pointerup', onUp);
      slider.addEventListener('pointercancel', onUp);
    });
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    makeEditable(document.getElementById('ts-size-val'));
    makeEditable(document.getElementById('bp-sz-val'));
    const tsUnitBtn=document.getElementById('ts-size-unit'); if(tsUnitBtn) tsUnitBtn.addEventListener('click', toggleUnit);
    const bpUnitBtn=document.getElementById('bp-sz-unit'); if(bpUnitBtn) bpUnitBtn.addEventListener('click', toggleUnit);
    wireRobustDrag(document.getElementById('ts-size'));
    wireRobustDrag(document.getElementById('bp-sz'));
    const tsSize=document.getElementById('ts-size');
    const presetSize=document.getElementById('bp-sz');
    if(tsSize) tsSize.addEventListener('input',()=>applyNewSize(+tsSize.value));
    if(presetSize) presetSize.addEventListener('input',()=>applyNewSize(+presetSize.value));
    refreshSizeUI();
  });
})();

