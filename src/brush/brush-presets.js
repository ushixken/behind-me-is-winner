//  TOOL SETTINGS PANEL  wiring
(function(){
  // Helper: range + display
  function bindRange(id,dispId,suffix,onchange){
    const el=document.getElementById(id);
    const disp=document.getElementById(dispId);
    if(!el||!disp) return;
    el.oninput=()=>{disp.textContent=el.value+(suffix||'');if(onchange)onchange(+el.value);};
  }
  // Opacity (stroke-level cap)
  bindRange('ts-opacity','ts-opacity-val','',v=>{brushOpacity=v/100;});
  // Flow (per-dab build-up within the stroke)
  bindRange('ts-flow','ts-flow-val','',v=>{brushFlow=v/100;});
  // Density (per-dab alpha build-up, works alongside Flow/Opacity)
  bindRange('ts-density','ts-density-val','',v=>{brushDensity=v/100;});
  // Hardness
  bindRange('ts-hardness','ts-hardness-val','',v=>{brushHardness=v/100;_aaDabCache.clear();_tipDabCache.clear();_stampCache.clear();});
  bindRange('ts-spacing','ts-spacing-val','%',v=>{window._tsSpacing=v/100;});
  const spacingEl=document.getElementById('ts-spacing');
  window._tsSpacing=spacingEl?(+spacingEl.value/100):0.12;
  // Spacing is fixed, not a user-adjustable Tool Setting — the brush
  // engine's _effectiveSpacingFrac() just uses its built-in default (0.12)
  // and never varies with stroke velocity or acceleration.
  // Airbrush spray rate (dabs/sec while held, independent of movement)
  bindRange('ts-airbrush-rate','ts-airbrush-rate-val','',v=>{window._tsAirbrushRate=v/100;});
  // Dynamics
  bindRange('ts-min-size','ts-min-size-val','%');
  bindRange('ts-start-taper','ts-start-taper-val','%');
  bindRange('ts-end-taper','ts-end-taper-val','%');
  function syncTaperMode(){
    const mode=document.getElementById('ts-taper-mode');
    const enabled=!!mode&&mode.value==='percentage';
    ['ts-start-taper','ts-end-taper'].forEach(id=>{const control=document.getElementById(id);if(control) control.disabled=!enabled;});
  }
  const taperMode=document.getElementById('ts-taper-mode');
  if(taperMode) taperMode.addEventListener('input',syncTaperMode);
  syncTaperMode();
  bindRange('ts-angle','ts-angle-val','\u00B0',v=>{window._tsBrushAngle=v;if(typeof window._syncTipUI==='function')window._syncTipUI();});
  const rotationModeEl=document.getElementById('ts-rotation-mode');
  const angleEl=document.getElementById('ts-angle');
  function syncRotation(){
    window._tsRotationMode=rotationModeEl?rotationModeEl.value:'fixed-rotation';
    window._tsBrushAngle=angleEl?+angleEl.value:0;
    if(angleEl) angleEl.disabled=window._tsRotationMode!=='fixed-rotation';
  }
  if(rotationModeEl){rotationModeEl.addEventListener('input',syncRotation);rotationModeEl.addEventListener('change',syncRotation);}
  syncRotation();
  const tipRoundnessEl=document.getElementById('ts-tip-roundness');
  const tipFlipXEl=document.getElementById('ts-tip-flip-x');
  const tipFlipYEl=document.getElementById('ts-tip-flip-y');
  function syncTipShape(){
    const roundness=tipRoundnessEl?+tipRoundnessEl.value/100:1;
    if(typeof window._setBrushTipShape==='function') window._setBrushTipShape(roundness,tipFlipXEl?.checked,tipFlipYEl?.checked);
    if(typeof window._syncTipUI==='function') window._syncTipUI();
  }
  bindRange('ts-tip-roundness','ts-tip-roundness-val','%',syncTipShape);
  if(tipFlipXEl) tipFlipXEl.addEventListener('input',syncTipShape);
  if(tipFlipYEl) tipFlipYEl.addEventListener('input',syncTipShape);
  syncTipShape();
  // Shape Dynamics jitter: Size/Angle/Roundness Jitter + Minimum Roundness.
  // These are resolved fresh per-dab inside _stampDab (brush-engine.js), so
  // they just need to publish the current slider value as a 0..1 fraction.
  bindRange('ts-size-jitter','ts-size-jitter-val','%',v=>{window.brushTipSizeJitter=v/100;});
  bindRange('ts-angle-jitter','ts-angle-jitter-val','%',v=>{window.brushTipAngleJitter=v/100;});
  bindRange('ts-round-jitter','ts-round-jitter-val','%',v=>{window.brushTipRoundnessJitter=v/100;_stampCache.clear();});
  bindRange('ts-tip-min-roundness','ts-tip-min-roundness-val','%',v=>{window.brushTipMinimumRoundness=v/100;_tipDabCache.clear();_stampCache.clear();});
  bindRange('ts-scatter-amount','ts-scatter-amount-val','%',v=>{window._tsScatterAmount=v/100;});
  bindRange('ts-scatter-count','ts-scatter-count-val','',v=>{window._tsScatterCount=Math.min(50,Math.max(1,Math.round(v)));});
  if(window._tsScatterBothAxes==null) window._tsScatterBothAxes=true;
  const scatterEnabledEl=document.getElementById('ts-scatter-enabled');
  const scatterAmountEl=document.getElementById('ts-scatter-amount');
  const scatterCountEl=document.getElementById('ts-scatter-count');
  function syncScatter(){
    window._tsScatterEnabled=!!scatterEnabledEl?.checked;
    window._tsScatterAmount=scatterAmountEl?(+scatterAmountEl.value/100):0;
    window._tsScatterCount=scatterCountEl?Math.min(50,Math.max(1,Math.round(+scatterCountEl.value))):1;
    if(scatterAmountEl) scatterAmountEl.disabled=!window._tsScatterEnabled;
    if(scatterCountEl) scatterCountEl.disabled=!window._tsScatterEnabled;
  }
  if(scatterEnabledEl) scatterEnabledEl.addEventListener('input',syncScatter);
  syncScatter();
  bindRange('ts-min-flow','ts-min-flow-val','%');
  function syncDynamicsMinimums(){
    const sizeControl=document.getElementById('ts-size-control');
    const flowControl=document.getElementById('ts-flow-control');
    const minSizeRow=document.getElementById('ts-min-size-row');
    const minFlowRow=document.getElementById('ts-min-flow-row');
    if(minSizeRow) minSizeRow.style.display=sizeControl&&sizeControl.value==='pressure'?'':'none';
    if(minFlowRow) minFlowRow.style.display=flowControl&&flowControl.value==='pressure'?'':'none';
  }
  const sizeControl=document.getElementById('ts-size-control');
  const flowControl=document.getElementById('ts-flow-control');
  if(sizeControl) sizeControl.addEventListener('input',syncDynamicsMinimums);
  if(flowControl) flowControl.addEventListener('input',syncDynamicsMinimums);
  syncDynamicsMinimums();
  // Transfer / Texture
  bindRange('ts-texture-scale','ts-texture-scale-val','%');
  bindRange('ts-texture-strength','ts-texture-strength-val','');

  //  AA off = pixelated pencil mode
  // Anti-aliasing off is meant to give a hard, pixel-perfect stamp — so it
  // shouldn't also be softened by a partial hardness value or have its
  // opacity wobbling with pen pressure. Turning AA off snapshots whatever
  // Opacity-Control + Hardness the user had, then forces flat opacity
  // (ignores pressure — every dab is the same solid alpha) and hardness to
  // 100 (fully solid disc, no feather). Turning AA back on restores the
  // exact settings that were there before, so nothing is lost.
  let _preAA=null; // {opacityCtrl, hardness} snapshot taken the moment AA was switched off
  // Last non-'none' AA mode -- restored when the AA checkbox/toolbar button
  // is toggled back on (Requirement 11: clicking AA toggles 'none' <-> the
  // last enabled mode; the dropdown itself only ever chooses weak/medium/strong).
  let _lastEnabledAAMode=(window.brushAAMode&&window.brushAAMode!=='none')?window.brushAAMode:'medium';
  function _syncAAModeUI(){
    const select=document.getElementById('ts-aa-mode');
    if(select) select.value=_lastEnabledAAMode;
    const row=document.getElementById('ts-aa-mode-row');
    if(row) row.style.display=brushAA?'':'none';
    const advRow=document.getElementById('ts-advanced-aa-mode-row');
    if(advRow) advRow.style.display=brushAA?'':'none';
    const advSelect=advRow?advRow.querySelector('select'):null;
    if(advSelect) advSelect.value=_lastEnabledAAMode;
  }
  function _setBrushAA(on){
    const nextAA=!!on;
    const changed=nextAA!==!!brushAA;
    const ctrlEl=document.getElementById('ts-opacity-control');
    if(changed&&!nextAA){
      _preAA={opacityCtrl:ctrlEl?ctrlEl.value:'pressure',hardness:brushHardness};
      if(ctrlEl) ctrlEl.value='off';
      brushHardness=1;
      const hEl=document.getElementById('ts-hardness');if(hEl)hEl.value=100;
      const hVal=document.getElementById('ts-hardness-val');if(hVal)hVal.textContent=100;
    }else if(changed&&nextAA&&_preAA){
      if(ctrlEl) ctrlEl.value=_preAA.opacityCtrl;
      brushHardness=_preAA.hardness;
      const hardnessPercent=Math.round(_preAA.hardness*100);
      const hEl=document.getElementById('ts-hardness');if(hEl)hEl.value=hardnessPercent;
      const hVal=document.getElementById('ts-hardness-val');if(hVal)hVal.textContent=hardnessPercent;
      _preAA=null;
    }
    brushAA=nextAA;
    window.brushAAMode=nextAA?_lastEnabledAAMode:'none';
    if(changed){_aaDabCache.clear();_stampCache.clear();_tipDabCache.clear();}
    const checkbox=document.getElementById('ts-aa');
    if(checkbox){
      checkbox.checked=brushAA;
      checkbox.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const button=document.getElementById('btn-aa');if(button)button.classList.toggle('active',brushAA);
    document.getElementById('stat-tool').textContent=(tool==='brush'?(brushAA?'Brush':'Pencil'):tool.charAt(0).toUpperCase()+tool.slice(1));
    _syncAAModeUI();
    if(typeof applyTransform==='function')applyTransform();
  }  window._setBrushAA=_setBrushAA;

  // AA strength dropdown (None/Weak/Medium/Strong) -- separate from the
  // on/off checkbox. Selecting weak/medium/strong here always implies AA is
  // ON (matches Requirement 11); it never sets 'none' itself -- that's only
  // reachable via the checkbox/toolbar toggle.
  function _setBrushAAMode(mode){
    const m=(mode==='weak'||mode==='medium'||mode==='strong')?mode:'medium';
    _lastEnabledAAMode=m;
    window.brushAAMode=m;
    if(!brushAA) _setBrushAA(true); else { _aaDabCache.clear();_stampCache.clear();_tipDabCache.clear(); }
    _syncAAModeUI();
    if(typeof applyTransform==='function')applyTransform();
  }
  window._setBrushAAMode=_setBrushAAMode;

  // AA checkbox in Tool Settings mirrors toolbar AA button
  const tsAA=document.getElementById('ts-aa');
  tsAA.checked=brushAA;
  tsAA.onchange=()=>{
    _setBrushAA(tsAA.checked);
  };
  const tsAAMode=document.getElementById('ts-aa-mode');
  if(tsAAMode){
    tsAAMode.value=_lastEnabledAAMode;
    tsAAMode.onchange=()=>{ _setBrushAAMode(tsAAMode.value); };
  }
  _syncAAModeUI();

  // ── Airbrush mode — Tool Settings checkbox (activate/deactivate from
  // Tool Settings only; no separate toolbar button)
  window._tsAirbrushRate = window._tsAirbrushRate!==undefined ? window._tsAirbrushRate : 0.55;
  function _setAirbrush(on){
    window._brushAirbrush=!!on;
    const cb=document.getElementById('ts-airbrush'); if(cb) cb.checked=window._brushAirbrush;
    if(!window._brushAirbrush && typeof window._stopAirbrushSpray==='function') window._stopAirbrushSpray();
  }
  window._setAirbrush=_setAirbrush;
  const tsAirbrush=document.getElementById('ts-airbrush');
  if(tsAirbrush){
    tsAirbrush.checked=!!window._brushAirbrush;
    tsAirbrush.onchange=()=>{ _setAirbrush(tsAirbrush.checked); };
  }

  //  PS-style sidebar navigation
  // Clicking a nav item switches the active panel on the right.
  // Clicking the checkbox inside a nav item toggles the effect
  // without changing which panel is shown.
  (function initPsNav(){
    const navItems=document.querySelectorAll('.ts-ps-nav-item');
    const panels=document.querySelectorAll('.ts-ps-panel');

    function activatePanel(panelId){
      // Update nav items
      navItems.forEach(item=>{
        item.classList.toggle('active', item.dataset.panel===panelId);
      });
      // Update panels
      panels.forEach(panel=>{
        panel.classList.toggle('active', panel.dataset.panel===panelId);
      });
      // Remember last panel (per-session)
      try{ sessionStorage.setItem('tsPsPanel', panelId); }catch(e){}
    }

    navItems.forEach(item=>{
      item.addEventListener('click', e=>{
        // Don't switch panels when the checkbox itself is clicked
        if(e.target.classList.contains('ts-ps-nav-check')) return;
        if(e.target.closest && e.target.closest('.ts-eye-btn')) return;
        const panelId=item.dataset.panel;
        if(panelId) activatePanel(panelId);
      });
    });

    // Restore last panel or default to Tip Shape
    let lastPanel='tip-image';
    try{ lastPanel=sessionStorage.getItem('tsPsPanel')||'tip-image'; }catch(e){}
    if(lastPanel==='basic') lastPanel='tip-image';
    activatePanel(lastPanel);

    // Re-activate correct panel when switching to advanced mode
    // (the setTsMode function below calls applyTsMode which we hook here)
    window._tsPsActivateDefault=()=>activatePanel(lastPanel);
  })();

  //  Checkbox-gated panels (Tip Image / Dynamics / Texture / Pressure)
  // Unchecked should mean the panel is truly off, not just grayed out
  // any "Control" dropdown inside (e.g. Size/Opacity pressure control in
  // Dynamics) is forced to its "Off" option so nothing keeps applying
  // behind the gray-out, and the prior selection is restored when the box
  // is checked again (same snapshot/restore idea as the AA off/on toggle
  // above for hardness/opacity control).
  (function initPsCheckGating(){
    const GATED=['tip-image','dynamics','texture','pressure'];
    const _preGate={}; // panelId -> {selectId: previousValue}

    function panelFor(id){ return document.querySelector('.ts-ps-panel[data-panel="'+id+'"]'); }

    function setGateState(id,on){
      const panel=panelFor(id);
      if(!panel) return;
      panel.classList.toggle('ts-ps-panel--disabled',!on);
      // Only selects that actually have an "Off" option are pressure/
      // dynamics-style controls — force those to Off while gated off.
      const selects=panel.querySelectorAll('select.ts-select');
      if(!on){
        const snap={};
        selects.forEach(sel=>{
          if(!sel.querySelector('option[value="off"]')) return;
          snap[sel.id]=sel.value;
          sel.value='off';
        });
        _preGate[id]=snap;
      } else if(_preGate[id]){
        selects.forEach(sel=>{
          if(_preGate[id][sel.id]!==undefined) sel.value=_preGate[id][sel.id];
        });
        delete _preGate[id];
      }
    }

    GATED.forEach(id=>{
      const cb=document.getElementById('ts-ps-check-'+id);
      if(!cb) return;
      setGateState(id,cb.checked);
      cb.addEventListener('change',()=>setGateState(id,cb.checked));
    });
  })();

  //  Per-setting Simple-tab visibility ("eye" toggles)
  // Each eyeable field in Advanced mode gets an eye button; clicking it
  // shows/hides that individual setting in the Simple tab, like toggling
  // a layer's visibility. Choice persists across sessions.
  (function initSimpleVisibilityEyes(){
    const EYE_KEY='tsSimpleFieldVisibility';
    // What shows in Simple by default, before the user customizes anything.
    const DEFAULTS={size:true,opacity:false,flow:true,density:false,hardness:true,spacing:false,aa:true};
    let vis={};
    try{ vis=JSON.parse(localStorage.getItem(EYE_KEY)||'{}'); }catch(e){ vis={}; }

    function isVisible(key){
      return vis[key]!==undefined ? vis[key] : (DEFAULTS[key]!==undefined?DEFAULTS[key]:true);
    }
    function applyField(key){
      const field=document.querySelector('.ts-field[data-eye="'+key+'"]');
      const buttons=document.querySelectorAll('.ts-eye-btn[data-eye-btn="'+key+'"]');
      const on=isVisible(key);
      if(field) field.classList.toggle('ts-simple-hidden',!on);
      buttons.forEach(btn=>{
        btn.classList.toggle('ts-eye-off',!on);
        btn.title=on?'Visible in Simple tab — click to hide':'Hidden in Simple tab — click to show';
      });
    }
    // Apply initial state to whatever eye buttons/fields exist right now.
    document.querySelectorAll('.ts-eye-btn[data-eye-btn]').forEach(btn=>{
      applyField(btn.dataset.eyeBtn);
    });

    // Delegated click handler — works even if this script runs before the
    // modal's markup is fully parsed, and needs no per-button listeners.
    document.addEventListener('click',e=>{
      const btn=e.target.closest && e.target.closest('.ts-eye-btn[data-eye-btn]');
      if(!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const key=btn.dataset.eyeBtn;
      vis[key]=!isVisible(key);
      try{ localStorage.setItem(EYE_KEY,JSON.stringify(vis)); }catch(err){}
      applyField(key);
    });
  })();

  //  Whole-section Simple-tab visibility + drag-to-reorder
  // Eye button (inside the section heading in Advanced mode) toggles whether
  // that section appears in Simple tab. Drag handle reorders sections in
  // Simple tab — same pointer-event pattern as the timeline label drag.
  (function initSimpleSectionEyes(){
    const SECTION_EYE_KEY='tsSimpleSectionVisibility';
    const SECTION_ORDER_KEY='tsSimpleSectionOrder';
    // Default order matches DOM order: tip-image, dynamics, texture, pressure
    const ALL_SECTIONS=['tip-image','dynamics','texture','pressure'];

    let vis={};
    try{ vis=JSON.parse(localStorage.getItem(SECTION_EYE_KEY)||'{}'); }catch(e){ vis={}; }
    let order=ALL_SECTIONS.slice();
    try{
      const saved=JSON.parse(localStorage.getItem(SECTION_ORDER_KEY)||'null');
      if(Array.isArray(saved) && saved.length===ALL_SECTIONS.length) order=saved;
    }catch(e){}

    function isVisible(key){ return !!vis[key]; }

    function applySection(key){
      const panel=document.querySelector('.ts-ps-panel[data-panel="'+key+'"]');
      const btn=document.querySelector('.ts-eye-btn[data-eye-section="'+key+'"]');
      const on=isVisible(key);
      if(panel) panel.classList.toggle('ts-simple-section-visible',on);
      if(btn){
        btn.classList.toggle('ts-eye-off',!on);
        btn.title=on?'Shown in Simple tab — click to hide':'Hidden from Simple tab — click to show';
      }
    }

    // Apply saved DOM order — move panels inside ts-ps-panels to match
    function applyOrder(){
      const container=document.querySelector('.ts-ps-panels');
      if(!container) return;
      // basic panel stays first, then reorder the section panels
      const basicPanel=container.querySelector('.ts-ps-panel[data-panel="basic"]');
      const importPanel=container.querySelector('.ts-ps-panel[data-panel="import"]');
      // Remove and re-insert in saved order
      order.forEach(key=>{
        const panel=container.querySelector('.ts-ps-panel[data-panel="'+key+'"]');
        if(panel) container.appendChild(panel);
      });
      // import always last
      if(importPanel) container.appendChild(importPanel);
    }

    function saveOrder(){
      try{ localStorage.setItem(SECTION_ORDER_KEY,JSON.stringify(order)); }catch(e){}
    }

    // Init: apply all sections
    applyOrder();
    ALL_SECTIONS.forEach(applySection);

    // Eye toggle click
    document.addEventListener('click',e=>{
      const btn=e.target.closest && e.target.closest('.ts-eye-btn[data-eye-section]');
      if(!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const key=btn.dataset.eyeSection;
      vis[key]=!isVisible(key);
      try{ localStorage.setItem(SECTION_EYE_KEY,JSON.stringify(vis)); }catch(err){}
      applySection(key);
    });

    // ── Drag-to-reorder (pointer events, same pattern as timeline label drag)
    let dragKey=null, dragEl=null;

    document.addEventListener('pointerdown',e=>{
      const handle=e.target.closest && e.target.closest('.ts-section-draghandle');
      if(!handle) return;
      const panel=handle.closest('.ts-ps-panel[data-panel]');
      if(!panel) return;
      dragKey=panel.dataset.panel;
      dragEl=panel;
      e.preventDefault();
      e.stopPropagation();
      dragEl.classList.add('ts-section-dragging');
      document.addEventListener('pointermove',onSectionDragMove);
      document.addEventListener('pointerup',onSectionDragUp);
    });

    function onSectionDragMove(e){
      if(!dragKey) return;
      // Find which panel the pointer is over
      const panels=Array.from(document.querySelectorAll('.ts-ps-panels .ts-ps-panel[data-panel]'))
        .filter(p=>p.dataset.panel!=='basic'&&p.dataset.panel!=='import'&&p!==dragEl);
      // Clear all indicators
      panels.forEach(p=>{p.classList.remove('ts-section-drop-above','ts-section-drop-below');});
      let target=null,above=true;
      for(const p of panels){
        const r=p.getBoundingClientRect();
        if(e.clientY>=r.top&&e.clientY<=r.bottom){
          target=p;
          above=e.clientY<r.top+r.height/2;
          break;
        }
      }
      if(target){
        target.classList.add(above?'ts-section-drop-above':'ts-section-drop-below');
      }
    }

    function onSectionDragUp(e){
      document.removeEventListener('pointermove',onSectionDragMove);
      document.removeEventListener('pointerup',onSectionDragUp);
      if(!dragEl){ dragKey=null; return; }
      dragEl.classList.remove('ts-section-dragging');
      // Find drop target
      const panels=Array.from(document.querySelectorAll('.ts-ps-panels .ts-ps-panel[data-panel]'))
        .filter(p=>p.dataset.panel!=='basic'&&p.dataset.panel!=='import'&&p!==dragEl);
      let targetKey=null, above=true;
      panels.forEach(p=>{
        if(p.classList.contains('ts-section-drop-above')){ targetKey=p.dataset.panel; above=true; }
        if(p.classList.contains('ts-section-drop-below')){ targetKey=p.dataset.panel; above=false; }
        p.classList.remove('ts-section-drop-above','ts-section-drop-below');
      });
      if(targetKey && targetKey!==dragKey){
        // Reorder the `order` array
        const fromIdx=order.indexOf(dragKey);
        let toIdx=order.indexOf(targetKey);
        if(fromIdx!==-1&&toIdx!==-1){
          order.splice(fromIdx,1);
          toIdx=order.indexOf(targetKey);
          order.splice(above?toIdx:toIdx+1,0,dragKey);
          saveOrder();
          applyOrder();
        }
      }
      dragKey=null; dragEl=null;
    }
  })();

  // Pressure curve — drives the preview AND the actual brush pressure→size
  // mapping (see PRESSURE_CURVES / _applyPressureCurve in brush-engine.js).
  const curveCanvas=document.getElementById('ts-pressure-curve');
  if(curveCanvas){
    const curves=(typeof window!=='undefined' && window.PRESSURE_CURVES) || {
      linear:[[0,1],[1,0]],
      soft:[[0,1],[0.3,0.55],[0.7,0.2],[1,0]],
      hard:[[0,1],[0.3,0.85],[0.7,0.4],[1,0]],
      s:[[0,1],[0.2,0.8],[0.8,0.25],[1,0]]
    };
    let activeCurve=(typeof window!=='undefined' && window._tsPressureCurve) || 'linear';
    window._tsPressureCurve = activeCurve;
    function drawCurve(){
      const c=curveCanvas;const ctx2=c.getContext('2d');
      const W=c.width,H=c.height;
      ctx2.clearRect(0,0,W,H);
      ctx2.strokeStyle='#3a3a46';ctx2.lineWidth=1;
      // grid
      for(let i=0;i<=4;i++){ctx2.beginPath();ctx2.moveTo(i*W/4,0);ctx2.lineTo(i*W/4,H);ctx2.stroke();}
      for(let i=0;i<=2;i++){ctx2.beginPath();ctx2.moveTo(0,i*H/2);ctx2.lineTo(W,i*H/2);ctx2.stroke();}
      // curve
      const pts=curves[activeCurve];
      ctx2.strokeStyle='#7F77DD';ctx2.lineWidth=2;
      ctx2.beginPath();
      ctx2.moveTo(pts[0][0]*W,(pts[0][1])*H);
      if(pts.length===4){
        ctx2.bezierCurveTo(pts[1][0]*W,pts[1][1]*H,pts[2][0]*W,pts[2][1]*H,pts[3][0]*W,pts[3][1]*H);
      } else {
        ctx2.lineTo(pts[1][0]*W,pts[1][1]*H);
      }
      ctx2.stroke();
    }
    ['linear','soft','hard','s'].forEach(k=>{
      const btn=document.getElementById('ts-curve-'+k);
      if(!btn) return;
      btn.onclick=()=>{
        activeCurve=k;
        window._tsPressureCurve=k;
        document.querySelectorAll('#tool-settings-body .ts-pill').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        drawCurve();
      };
    });
    // Draw initial curve when panel becomes visible (ResizeObserver fires)
    const ro=new ResizeObserver(()=>{
      curveCanvas.width=curveCanvas.offsetWidth||180;
      drawCurve();
    });
    ro.observe(curveCanvas.parentElement);
    drawCurve();
  }

  // Move the authoritative Simple controls into the dock. Moving (rather
  // than cloning) preserves every existing value, listener and reset action.
  const dockedSimpleSettings=document.getElementById('brush-tool-settings-content');
  const basicSettings=document.querySelector('#tool-settings-body .ts-ps-panel[data-panel="basic"] .ts-section-body');
  if(dockedSimpleSettings&&basicSettings){
    ['size','flow','hardness','aa'].forEach(key=>{
      const field=basicSettings.querySelector(`.ts-field[data-eye="${key}"]`);
      if(field)dockedSimpleSettings.appendChild(field);
    });
  }

  // The toolbar gear opens the remaining Advanced modal.
  const tsBtnOpen=document.getElementById('btn-open-tool-settings');
  if(tsBtnOpen) tsBtnOpen.onclick=()=>{
    setTsMode('advanced');
    document.getElementById('tool-settings-modal-overlay').classList.add('visible');
  };
  document.getElementById('tool-settings-modal-close').onclick=()=>{
    document.getElementById('tool-settings-modal-overlay').classList.remove('visible');
  };
  document.getElementById('tool-settings-modal-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('tool-settings-modal-overlay'))
      document.getElementById('tool-settings-modal-overlay').classList.remove('visible');
  });

  //  Simple / Advanced settings mode
  // Simple shows only Size, Flow, Hardness & Anti-alias (the rows/sections
  // NOT marked .ts-advanced-only). Advanced shows everything, same as before
  // this feature existed. Choice is remembered across sessions.
  const TS_MODE_KEY='toolSettingsMode';
  let tsMode='simple';
  try{ tsMode=localStorage.getItem(TS_MODE_KEY)||'simple'; }catch(e){}
  function applyTsMode(){
    const body=document.getElementById('tool-settings-body');
    if(body) body.classList.toggle('ts-mode-simple',tsMode==='simple');
    const sBtn=document.getElementById('ts-mode-simple'),aBtn=document.getElementById('ts-mode-advanced');
    if(sBtn) sBtn.classList.toggle('active',tsMode==='simple');
    if(aBtn) aBtn.classList.toggle('active',tsMode==='advanced');
    // Ensure correct panel is active after mode switch
    if(tsMode==='advanced' && typeof window._tsPsActivateDefault==='function') window._tsPsActivateDefault();
  }
  function setTsMode(m){
    tsMode=m;
    try{ localStorage.setItem(TS_MODE_KEY,tsMode); }catch(e){}
    applyTsMode();
  }
  document.getElementById('ts-mode-simple')?.addEventListener('click',()=>setTsMode('simple'));
  document.getElementById('ts-mode-advanced')?.addEventListener('click',()=>setTsMode('advanced'));
  applyTsMode();

  (function initAdvancedMainControlMirrors(){
    document.querySelectorAll('.ts-advanced-mirror-row[data-mirror-target]').forEach(row=>{
      const source=document.getElementById(row.dataset.mirrorTarget);
      const mirror=row.querySelector('input[type="range"],input[type="checkbox"],select');
      const value=row.querySelector('.ts-val');
      if(!source||!mirror) return;
      const syncFromSource=()=>{
        if(source.type==='checkbox') mirror.checked=source.checked;
        else mirror.value=source.value;
        mirror.disabled=source.disabled;
        if(value){
          if(row.dataset.mirrorTarget==='ts-size' && window._brushSizeUnit){
            const px=+source.value;
            value.textContent=window._brushSizeUnit.unit==='mm'?String(Math.round(window._brushSizeUnit.pxToMm(px)*100)/100):String(Math.round(px*10)/10);
          } else value.textContent=source.value+(row.dataset.mirrorSuffix||'');
        }
      };
      const syncToSource=()=>{
        if(source.type==='checkbox') source.checked=mirror.checked;
        else source.value=mirror.value;
        source.dispatchEvent(new Event('input',{bubbles:true}));
        source.dispatchEvent(new Event('change',{bubbles:true}));
        syncFromSource();
      };
      mirror.addEventListener('input',syncToSource);
      mirror.addEventListener('change',syncToSource);
      source.addEventListener('input',syncFromSource);
      source.addEventListener('change',syncFromSource);
      syncFromSource();
    });
  })();

  (function initSpacingMode(){
    const mode=document.getElementById('ts-spacing-mode');
    if(!mode) return;
    const sync=()=>{
      const fixed=mode.value==='fixed';
      const simpleRow=document.getElementById('ts-spacing-manual-row');
      const advancedRow=document.getElementById('ts-advanced-spacing-manual-row');
      if(simpleRow){ simpleRow.style.display=fixed?'':'none'; simpleRow.title=fixed?'':'Auto spacing automatically adjusts spacing for smoother brush strokes.'; }
      if(advancedRow){ advancedRow.style.display=fixed?'':'none'; advancedRow.title=fixed?'':'Auto spacing automatically adjusts spacing for smoother brush strokes.'; }
      const spacing=document.getElementById('ts-spacing');
      if(spacing){
        spacing.disabled=!fixed;
        spacing.title=fixed?'':'Auto spacing automatically adjusts spacing for smoother brush strokes.';
        spacing.dispatchEvent(new Event('change',{bubbles:true}));
      }
    };
    mode.addEventListener('input',sync);
    mode.addEventListener('change',sync);
    sync();
  })();

  (function initEditableToolValues(){
    document.querySelectorAll('.ts-row').forEach(row=>{
      const slider=row.querySelector('input[type="range"][id]');
      const display=row.querySelector('.ts-val');
      if(!slider||!display||display.classList.contains('size-val-edit')) return;
      display.classList.add('ts-value-edit');
      display.dataset.valueTarget=display.dataset.valueTarget||slider.id;
      display.tabIndex=0;
    });
    function beginEdit(display){
      if(display.querySelector('input')) return;
      const source=document.getElementById(display.dataset.valueTarget);
      if(!source) return;
      const original=display.textContent;
      const input=document.createElement('input');
      input.type='number';input.className='size-val-input';
      input.min=source.min;input.max=source.max;input.step=source.step||'1';
      input.value=parseFloat(original)||0;
      display.textContent='';display.appendChild(input);input.focus();input.select();
      let finished=false;
      const finish=apply=>{
        if(finished) return;finished=true;
        if(apply){
          let value=parseFloat(input.value);
          if(Number.isFinite(value)){
            if(display.dataset.sizeValue==='true' && window._brushSizeUnit?.unit==='mm') value=window._brushSizeUnit.mmToPx(value);
            value=Math.max(+source.min,Math.min(+source.max,value));
            source.value=value;source.dispatchEvent(new Event('input',{bubbles:true}));source.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }
        display.textContent=original;
        source.dispatchEvent(new Event('input',{bubbles:true}));
      };
      input.addEventListener('keydown',event=>{if(event.key==='Enter') finish(true);else if(event.key==='Escape') finish(false);});
      input.addEventListener('blur',()=>finish(true));
    }
    document.addEventListener('click',event=>{const display=event.target.closest&&event.target.closest('.ts-value-edit');if(display) beginEdit(display);});
    document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.classList?.contains('ts-value-edit')){event.preventDefault();beginEdit(event.target);}});
    const advancedUnit=document.querySelector('.ts-advanced-size-unit');
    const simpleUnit=document.getElementById('ts-size-unit');
    if(advancedUnit&&simpleUnit){
      const syncUnit=()=>{advancedUnit.textContent=simpleUnit.textContent;advancedUnit.classList.toggle('active-mm',simpleUnit.classList.contains('active-mm'));document.getElementById('ts-size')?.dispatchEvent(new Event('input',{bubbles:true}));};
      advancedUnit.addEventListener('click',()=>{simpleUnit.click();syncUnit();});
      simpleUnit.addEventListener('click',()=>setTimeout(syncUnit,0));
      syncUnit();
    }
  })();

  (function initPressureCurveEditors(){
    const popup=document.getElementById('ts-pressure-editor-popup');
    const editor=document.getElementById('ts-pressure-editor-canvas');
    if(!popup||!editor) return;
    window._tsCustomPressureCurves=window._tsCustomPressureCurves||{};
    const presets=window.PRESSURE_CURVES||{linear:[[0,1],[1,0]]};
    let activeSetting=null,points=null,dragIndex=-1;
    function curvePoints(setting){
      const select=document.getElementById('ts-'+setting+'-pressure-curve');
      const mode=select?select.value:'linear';
      const custom=window._tsCustomPressureCurves[setting];
      if(mode==='custom'&&custom) return custom.map(point=>point.slice());
      const source=presets[mode]||presets.linear;
      if(source.length===2) return [[0,1],[1/3,2/3],[2/3,1/3],[1,0]];
      return source.map(point=>point.slice());
    }
    function draw(canvas,curve,handles){
      const context=canvas.getContext('2d'),width=canvas.width,height=canvas.height,pad=handles?12:4;
      context.clearRect(0,0,width,height);context.fillStyle='#17191f';context.fillRect(0,0,width,height);
      context.strokeStyle='rgba(255,255,255,.09)';context.lineWidth=1;
      for(let i=0;i<=4;i++){const x=pad+(width-pad*2)*i/4,y=pad+(height-pad*2)*i/4;context.beginPath();context.moveTo(x,pad);context.lineTo(x,height-pad);context.stroke();context.beginPath();context.moveTo(pad,y);context.lineTo(width-pad,y);context.stroke();}
      context.strokeStyle='#7aa2ff';context.lineWidth=2;context.beginPath();
      for(let i=0;i<=64;i++){const x=i/64,y=_evalPressureCurveYFromPoints(curve,x);const px=pad+x*(width-pad*2),py=pad+y*(height-pad*2);if(i===0)context.moveTo(px,py);else context.lineTo(px,py);}context.stroke();
      if(handles){context.fillStyle='#d8e2ff';curve.forEach(point=>{context.beginPath();context.arc(pad+point[0]*(width-pad*2),pad+point[1]*(height-pad*2),4,0,Math.PI*2);context.fill();});}
    }
    function _evalPressureCurveYFromPoints(curve,x){
      if(curve.length===2) return 1-x;
      let lo=0,hi=1;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(_bezierPointAt(curve,mid)[0]<x)lo=mid;else hi=mid;}return _bezierPointAt(curve,(lo+hi)/2)[1];
    }
    function refreshPreviews(){document.querySelectorAll('.ts-pressure-preview').forEach(canvas=>draw(canvas,curvePoints(canvas.dataset.pressureSetting),false));}
    function openEditor(setting,anchor){activeSetting=setting;points=curvePoints(setting);popup.classList.add('open');popup.setAttribute('aria-hidden','false');const rect=anchor.getBoundingClientRect();popup.style.left=Math.min(window.innerWidth-popup.offsetWidth-8,rect.right+8)+'px';popup.style.top=Math.max(8,Math.min(window.innerHeight-popup.offsetHeight-8,rect.top))+'px';draw(editor,points,true);}
    function closeEditor(){popup.classList.remove('open');popup.setAttribute('aria-hidden','true');dragIndex=-1;}
    window._openPressureCurveEditor=openEditor;
    document.querySelectorAll('.ts-pressure-preview').forEach(canvas=>canvas.addEventListener('click',()=>openEditor(canvas.dataset.pressureSetting,canvas)));
    document.querySelectorAll('[id$="-pressure-curve"]').forEach(select=>select.addEventListener('input',()=>{const setting=select.id.replace('ts-','').replace('-pressure-curve','');if(select.value!=='custom')delete window._tsCustomPressureCurves[setting];refreshPreviews();}));
    editor.addEventListener('pointerdown',event=>{const rect=editor.getBoundingClientRect(),pad=12,x=(event.clientX-rect.left-pad)/(rect.width-pad*2),y=(event.clientY-rect.top-pad)/(rect.height-pad*2);let best=Infinity;points.forEach((point,index)=>{const distance=Math.hypot(point[0]-x,point[1]-y);if(distance<best){best=distance;dragIndex=index;}});editor.setPointerCapture(event.pointerId);});
    editor.addEventListener('pointermove',event=>{if(dragIndex<0)return;const rect=editor.getBoundingClientRect(),pad=12;let x=Math.max(0,Math.min(1,(event.clientX-rect.left-pad)/(rect.width-pad*2))),y=Math.max(0,Math.min(1,(event.clientY-rect.top-pad)/(rect.height-pad*2)));if(dragIndex===0)x=0;if(dragIndex===points.length-1)x=1;if(dragIndex>0)x=Math.max(points[dragIndex-1][0]+.01,x);if(dragIndex<points.length-1)x=Math.min(points[dragIndex+1][0]-.01,x);points[dragIndex]=[x,y];window._tsCustomPressureCurves[activeSetting]=points.map(point=>point.slice());const select=document.getElementById('ts-'+activeSetting+'-pressure-curve');if(select){select.value='custom';select.dispatchEvent(new Event('input',{bubbles:true}));}draw(editor,points,true);refreshPreviews();});
    editor.addEventListener('pointerup',()=>{dragIndex=-1;});
    document.getElementById('ts-pressure-reset').addEventListener('click',()=>{const select=document.getElementById('ts-'+activeSetting+'-pressure-curve');if(select&&select.value==='custom'){select.value='linear';delete window._tsCustomPressureCurves[activeSetting];select.dispatchEvent(new Event('input',{bubbles:true}));}points=curvePoints(activeSetting);draw(editor,points,true);refreshPreviews();});
    document.getElementById('ts-pressure-done').addEventListener('click',closeEditor);
    window._refreshPressureCurvePreviews=refreshPreviews;
    refreshPreviews();
  })();
  (function initSimpleSettingsPopup(){
    const popup=document.getElementById('ts-simple-settings-popup');
    const modal=document.getElementById('tool-settings-modal');
    if(!popup||!modal) return;
    // These auxiliary editors also belong to the docked Simple controls, so
    // keep them outside the hidden Advanced-modal overlay.
    document.body.appendChild(popup);
    const pressurePopup=document.getElementById('ts-pressure-editor-popup');
    if(pressurePopup)document.body.appendChild(pressurePopup);
    const configs={
      size:{title:'Size Settings',controls:[['Control','ts-size-control'],['Minimum Size','ts-min-size'],['Pressure Curve','ts-size-pressure-curve']]},
      flow:{title:'Flow Settings',controls:[['Control','ts-flow-control'],['Minimum Flow','ts-min-flow'],['Pressure Curve','ts-flow-pressure-curve']]},
      opacity:{title:'Opacity Settings',controls:[['Control','ts-opacity-control'],['Pressure Curve','ts-opacity-pressure-curve']]}
    };
    function closePopup(){
      popup.classList.remove('open');popup.setAttribute('aria-hidden','true');
      document.querySelectorAll('.ts-simple-settings-btn.active').forEach(btn=>btn.classList.remove('active'));
    }
    function addControl(labelText,sourceId){
      const source=document.getElementById(sourceId);
      if(!source) return;
      const row=document.createElement('div');row.className='ts-row';
      const label=document.createElement('span');label.className='ts-label';label.textContent=labelText;
      const control=source.cloneNode(true);control.removeAttribute('id');
      control.value=source.value;
      control.addEventListener('input',()=>{source.value=control.value;source.dispatchEvent(new Event('input',{bubbles:true}));});
      row.append(label,control);
      if(sourceId.endsWith('-pressure-curve')){
        const preview=document.createElement('canvas');preview.className='ts-pressure-preview';preview.width=92;preview.height=38;preview.dataset.pressureSetting=sourceId.replace('ts-','').replace('-pressure-curve','');preview.title='Click to edit pressure curve';preview.addEventListener('click',()=>window._openPressureCurveEditor?.(preview.dataset.pressureSetting,preview));row.appendChild(preview);setTimeout(()=>window._refreshPressureCurvePreviews?.(),0);
      }
      if(source.type==='range'){
        const value=document.createElement('span');value.className='ts-val';
        const update=()=>{value.textContent=control.value+'%';};control.addEventListener('input',update);update();row.appendChild(value);
      }
      popup.appendChild(row);
    }
    function openPopup(button,key){
      popup.replaceChildren();
      const config=configs[key];
      const title=document.createElement('div');title.className='ts-simple-popup-title';title.textContent=config?config.title:key[0].toUpperCase()+key.slice(1)+' Settings';popup.appendChild(title);
      if(config) config.controls.forEach(control=>addControl(control[0],control[1]));
      else{const empty=document.createElement('div');empty.className='ts-simple-popup-empty';empty.textContent='No extra settings yet.';popup.appendChild(empty);}
      document.querySelectorAll('.ts-simple-settings-btn.active').forEach(btn=>btn.classList.remove('active'));
      button.classList.add('active');popup.classList.add('open');popup.setAttribute('aria-hidden','false');
      const modalOpen=document.getElementById('tool-settings-modal-overlay')?.classList.contains('visible');
      const rect=(modalOpen?modal:button).getBoundingClientRect();
      let left=rect.right+8;
      if(left+popup.offsetWidth>window.innerWidth-8)left=rect.left-popup.offsetWidth-8;
      popup.style.left=Math.max(8,left)+'px';popup.style.top=Math.max(8,Math.min(window.innerHeight-popup.offsetHeight-8,modalOpen?rect.top+52:rect.top))+'px';
    }
    document.addEventListener('click',event=>{
      const button=event.target.closest&&event.target.closest('.ts-simple-settings-btn');
      if(button){event.preventDefault();event.stopPropagation();if(button.classList.contains('active')) closePopup();else openPopup(button,button.dataset.simpleSettings);return;}
      if(!popup.contains(event.target)) closePopup();
    });
    document.getElementById('ts-mode-advanced')?.addEventListener('click',closePopup);
    document.getElementById('tool-settings-modal-close')?.addEventListener('click',closePopup);
  })();

  // (Window menu toggle is wired below in the window menu block)

  // Import/Export preset buttons (show info since actual parsing is format-specific)
  const importBtn=document.getElementById('ts-btn-import-preset');
  const pasteBtn=document.getElementById('ts-btn-paste-json');
  const exportBtn=document.getElementById('ts-btn-export-json');
  if(importBtn) importBtn.onclick=()=>{
    const fi=document.createElement('input');fi.type='file';fi.accept='.json,.abr,.sut,.kpp,.tpl';
    fi.onchange=()=>{
      const f=fi.files[0];if(!f) return;
      // Route ABR files to the dedicated binary parser; everything else
      // stays on the JSON path so legacy presets keep working unchanged.
      if(f.name.toLowerCase().endsWith('.abr')){
        const r=new FileReader();
        r.onload=ev=>{
          try{
            const brushes=parseABR(ev.target.result);
            if(!brushes||!brushes.length){
              showInfo('No readable brush tips found in this ABR file. Only sampled-image tips are supported currently.','ABR Import');
              return;
            }
            showABRImportResults(brushes, f.name, () => showABRPicker(brushes, f.name));
          } catch(e){
            showInfo('Could not parse the ABR file: '+e.message,'ABR Import Error');
          }
        };
        r.readAsArrayBuffer(f);
        return;
      }
      // JSON / other text-based formats
      const r=new FileReader();
      r.onload=ev=>{
        try{
          const json=JSON.parse(ev.target.result);
          applyToolPreset(json);
          showInfo('Preset loaded: '+f.name,'Tool Settings');
        } catch(e2){
          showInfo('Could not parse preset. Make sure it is a JSON export from this app, or use the Paste JSON option for converted presets.','Import Error');
        }
      };
      r.readAsText(f);
    };
    fi.click();
  };
  if(pasteBtn) pasteBtn.onclick=async()=>{
    try{
      const text=await navigator.clipboard.readText();
      const json=JSON.parse(text);
      applyToolPreset(json);
      showInfo('Preset applied from clipboard.','Tool Settings');
    } catch(e3){
      showInfo('Could not read clipboard or parse JSON. Copy a valid JSON preset first.','Paste Error');
    }
  };
  if(exportBtn) exportBtn.onclick=()=>{
    const preset=getToolPreset();
    const blob=new Blob([JSON.stringify(preset,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='brush-preset.json';a.click();
  };

  // Flush display values on load
  document.getElementById('ts-opacity-val').textContent=document.getElementById('ts-opacity').value;
  document.getElementById('ts-flow-val').textContent=document.getElementById('ts-flow').value;
  document.getElementById('ts-density-val').textContent=document.getElementById('ts-density').value;
  document.getElementById('ts-hardness-val').textContent=document.getElementById('ts-hardness').value;
  document.getElementById('ts-spacing-val').textContent=document.getElementById('ts-spacing').value+'%';

  //
  // BRUSH TIP IMAGE — UI wiring
  //
  (function(){

    //  Draw the 6464 tip preview showing how the alpha mask looks
    function _drawTipPreview(){
      const c=document.getElementById('ts-tip-preview');
      if(!c) return;
      const ctx2=c.getContext('2d');
      ctx2.clearRect(0,0,64,64);
      if(!window.brushTipCanvas){
        // Default: draw a simple circle preview
        ctx2.fillStyle='var(--text2)';
        ctx2.globalAlpha=0.25;
        ctx2.beginPath();ctx2.arc(32,32,26,0,Math.PI*2);ctx2.fill();
        ctx2.globalAlpha=1;
        ctx2.strokeStyle='var(--border2)';ctx2.lineWidth=1;
        ctx2.beginPath();ctx2.arc(32,32,26,0,Math.PI*2);ctx2.stroke();
        return;
      }
      // Checkerboard background (shows transparency)
      for(let gy=0;gy<8;gy++) for(let gx=0;gx<8;gx++){
        ctx2.fillStyle=(gx+gy)%2===0?'#555':'#444';
        ctx2.fillRect(gx*8,gy*8,8,8);
      }
      // Draw the tip with white fill (tip alpha mask → white silhouette)
      ctx2.save();
      ctx2.fillStyle='#ffffff';
      ctx2.fillRect(0,0,64,64);
      ctx2.globalCompositeOperation='destination-in';
      const tipW=window.brushTipCanvas.width||1,tipH=window.brushTipCanvas.height||1;
      const rotation=((Number(window._tsBrushAngle)||0)*Math.PI)/180;
      const roundness=Math.max(window.brushTipMinimumRoundness||0,window.brushTipRoundness==null?1:window.brushTipRoundness);
      const compressWidth=tipW<tipH;
      const shapedW=tipW*(compressWidth?roundness:1),shapedH=tipH*(compressWidth?1:roundness);
      const rotatedW=Math.abs(shapedW*Math.cos(rotation))+Math.abs(shapedH*Math.sin(rotation));
      const rotatedH=Math.abs(shapedW*Math.sin(rotation))+Math.abs(shapedH*Math.cos(rotation));
      const scale=Math.min(56/Math.max(1,rotatedW),56/Math.max(1,rotatedH));
      ctx2.translate(32,32);
      if(rotation) ctx2.rotate(rotation);
      if(window.brushTipFlipX||window.brushTipFlipY) ctx2.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
      ctx2.drawImage(window.brushTipCanvas,-shapedW*scale/2,-shapedH*scale/2,shapedW*scale,shapedH*scale);
      ctx2.restore();
    }

    //  Sync all tip-related UI visibility to current state
    window._syncTipUI=function(){
      const hasTip=!!window.brushTipCanvas;
      const loadBtn=document.getElementById('ts-tip-load-btn');
      const clearBtn=document.getElementById('ts-tip-clear-btn');
      const filename=document.getElementById('ts-tip-filename');
      const modeRow=document.getElementById('ts-tip-mode-row');
      const softRow=document.getElementById('ts-tip-soft-row');
      const helpEl=document.getElementById('ts-tip-help');
      if(clearBtn) clearBtn.style.display=hasTip?'':'none';
      if(modeRow) modeRow.style.display=hasTip?'':'none';
      if(softRow) softRow.style.display=hasTip?'':'none';
      if(helpEl) helpEl.style.display=hasTip?'none':'';
      if(!hasTip && filename){ filename.style.display='none'; filename.textContent=''; }
      // Sync select + checkbox to engine globals
      const modeEl=document.getElementById('ts-tip-mode');
      if(modeEl && window.brushTipMode) modeEl.value=window.brushTipMode;
      const softEl=document.getElementById('ts-tip-soft-alpha');
      if(softEl) softEl.checked=(window.brushTipSoftAlpha!==false);
      _drawTipPreview();
    };

    //  Load an image file into a canvas and set as brush tip
    function _loadTipFromFile(file){
      if(!file||!file.type.startsWith('image/')) return;
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(url);
        const c=document.createElement('canvas');
        c.width=img.naturalWidth; c.height=img.naturalHeight;
        c.getContext('2d').drawImage(img,0,0);
        if(typeof window.setBrushTip==='function') window.setBrushTip(c);
        const fn=document.getElementById('ts-tip-filename');
        if(fn){ fn.textContent=file.name; fn.style.display=''; }
        window._syncTipUI();
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); };
      img.src=url;
    }

    const tipFileInput=document.getElementById('ts-tip-file-input');
    const tipLoadBtn=document.getElementById('ts-tip-load-btn');
    const tipClearBtn=document.getElementById('ts-tip-clear-btn');
    const tipModeEl=document.getElementById('ts-tip-mode');
    const tipSoftEl=document.getElementById('ts-tip-soft-alpha');

    if(tipLoadBtn && tipFileInput){
      tipLoadBtn.onclick=()=>{ tipFileInput.value=''; tipFileInput.click(); };
      tipFileInput.onchange=()=>{
        const f=tipFileInput.files&&tipFileInput.files[0];
        if(f) _loadTipFromFile(f);
      };
    }
    if(tipClearBtn){
      tipClearBtn.onclick=()=>{
        if(typeof window.clearBrushTip==='function') window.clearBrushTip();
        const fn=document.getElementById('ts-tip-filename');
        if(fn){ fn.textContent=''; fn.style.display='none'; }
        if(tipFileInput) tipFileInput.value='';
        window._syncTipUI();
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
    }
    if(tipModeEl){
      tipModeEl.onchange=()=>{
        window.brushTipMode=tipModeEl.value;
        // Bust caches so the new mode takes effect on the next dab.
        if(typeof window.setBrushTip==='function' && window.brushTipCanvas)
          window.setBrushTip(window.brushTipCanvas);
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
    }
    if(tipSoftEl){
      tipSoftEl.onchange=()=>{
        window.brushTipSoftAlpha=tipSoftEl.checked;
        if(typeof window.setBrushTip==='function' && window.brushTipCanvas)
          window.setBrushTip(window.brushTipCanvas);
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
    }

    // Initial draw
    window._syncTipUI();

  })();

  //
  // BRUSH TEXTURE IMAGE — UI wiring
  //
  (function(){

    //  Draw the 6464 texture preview
    function _drawTexturePreview(){
      const c=document.getElementById('ts-texture-preview');
      if(!c) return;
      const ctx2=c.getContext('2d');
      ctx2.clearRect(0,0,64,64);
      if(!window.brushTextureCanvas) return;
      ctx2.drawImage(window.brushTextureCanvas,0,0,64,64);
    }

    //  Sync texture UI visibility
    window._syncTextureUI=function(){
      const hasTex=!!window.brushTextureCanvas;
      const clearBtn=document.getElementById('ts-texture-clear-btn');
      const depthRow=document.getElementById('ts-texture-strength-row');
      const scaleRow=document.getElementById('ts-texture-scale-row');
      const buildupRow=document.getElementById('ts-texture-buildup-row');
      const brightRow=document.getElementById('ts-texture-brightness-row');
      const contrastRow=document.getElementById('ts-texture-contrast-row');
      const helpEl=document.getElementById('ts-texture-img-help');
      const filename=document.getElementById('ts-texture-filename');
      if(clearBtn) clearBtn.style.display=hasTex?'':'none';
      if(depthRow) depthRow.style.display=hasTex?'':'none';
      if(scaleRow) scaleRow.style.display=hasTex?'':'none';
      if(buildupRow) buildupRow.style.display=hasTex?'':'none';
      if(brightRow) brightRow.style.display=hasTex?'':'none';
      if(contrastRow) contrastRow.style.display=hasTex?'':'none';
      if(helpEl) helpEl.style.display=hasTex?'none':'';
      if(!hasTex && filename){ filename.style.display='none'; filename.textContent=''; }
      // Sync invert checkbox to engine global
      const invertEl=document.getElementById('ts-texture-invert');
      if(invertEl) invertEl.checked=!!window.brushTextureInvert;
      // Sync brightness slider to engine global
      const brightEl=document.getElementById('ts-texture-brightness');
      const brightVal=document.getElementById('ts-texture-brightness-val');
      const brightN=(window.brushTextureBrightness!=null?window.brushTextureBrightness:0);
      if(brightEl) brightEl.value=brightN;
      if(brightVal) brightVal.textContent=String(brightN);
      // Sync contrast slider to engine global
      const contrastEl=document.getElementById('ts-texture-contrast');
      const contrastVal=document.getElementById('ts-texture-contrast-val');
      const contrastN=(window.brushTextureContrast!=null?window.brushTextureContrast:0);
      if(contrastEl) contrastEl.value=contrastN;
      if(contrastVal) contrastVal.textContent=String(contrastN);
      // Sync strength slider to engine global
      const depthEl=document.getElementById('ts-texture-strength');
      const depthVal=document.getElementById('ts-texture-strength-val');
      const pct=Math.round((window.brushTextureStrength!=null?window.brushTextureStrength:1.0)*100);
      if(depthEl) depthEl.value=pct;
      if(depthVal) depthVal.textContent=pct+'%';
      // Sync scale slider to engine global
      const scaleEl=document.getElementById('ts-texture-scale');
      const scaleVal=document.getElementById('ts-texture-scale-val');
      const scalePct=Math.round((window.brushTextureScale||1.0)*100);
      if(scaleEl) scaleEl.value=scalePct;
      if(scaleVal) scaleVal.textContent=scalePct+'%';
      // Sync buildup slider to engine global
      const buildupEl=document.getElementById('ts-texture-buildup');
      const buildupValEl=document.getElementById('ts-texture-buildup-val');
      const buildupPct=Math.round((window.brushTextureBuildup!=null?window.brushTextureBuildup:1.0)*100);
      if(buildupEl) buildupEl.value=buildupPct;
      if(buildupValEl) buildupValEl.textContent=buildupPct+'%';
      _drawTexturePreview();
    };

    //  Load an image file into a canvas and set as brush texture
    function _loadTextureFromFile(file){
      if(!file||!file.type.startsWith('image/')) return;
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(url);
        const c=document.createElement('canvas');
        c.width=img.naturalWidth; c.height=img.naturalHeight;
        c.getContext('2d').drawImage(img,0,0);
        if(typeof window.setBrushTexture==='function') window.setBrushTexture(c);
        const fn=document.getElementById('ts-texture-filename');
        if(fn){ fn.textContent=file.name; fn.style.display=''; }
        window._syncTextureUI();
        // Persist the texture image into the active preset so it survives
        // page refresh. captureTip=true is required to write the data URL
        // into _presetSettings (slider values are captured automatically by
        // the input-event listener, but image data only via captureTip=true).
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); };
      img.src=url;
    }

    const texFileInput=document.getElementById('ts-texture-file-input');
    const texLoadBtn=document.getElementById('ts-texture-load-btn');
    const texClearBtn=document.getElementById('ts-texture-clear-btn');
    const texDepthEl=document.getElementById('ts-texture-strength');
    const texDepthVal=document.getElementById('ts-texture-strength-val');

    if(texLoadBtn && texFileInput){
      texLoadBtn.onclick=()=>{ texFileInput.value=''; texFileInput.click(); };
      texFileInput.onchange=()=>{
        const f=texFileInput.files&&texFileInput.files[0];
        if(f) _loadTextureFromFile(f);
      };
    }
    if(texClearBtn){
      texClearBtn.onclick=()=>{
        if(typeof window.clearBrushTexture==='function') window.clearBrushTexture();
        const fn=document.getElementById('ts-texture-filename');
        if(fn){ fn.textContent=''; fn.style.display='none'; }
        if(texFileInput) texFileInput.value='';
        window._syncTextureUI();
        // Remove the texture dataurl from the persisted preset.
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(true);
      };
    }
    if(texDepthEl){
      texDepthEl.oninput=()=>{
        window.brushTextureStrength=+texDepthEl.value/100;
        if(texDepthVal) texDepthVal.textContent=texDepthEl.value+'%';
      };
    }

    // Texture Buildup slider — controls how fast overlapping dabs within one
    // stroke fill in the grain holes and build up to solid coverage.
    // At 100% (default) the centre of a stroke becomes dense in a single pass
    // (TVPaint-style). At 0% each dab shows the same static grain with no
    // accumulation across dabs. Does NOT affect normal (non-textured) brushes.
    const texBuildupEl  = document.getElementById('ts-texture-buildup');
    const texBuildupVal = document.getElementById('ts-texture-buildup-val');
    if(texBuildupEl){
      texBuildupEl.oninput=()=>{
        window.brushTextureBuildup = +texBuildupEl.value / 100;
        if(texBuildupVal) texBuildupVal.textContent = texBuildupEl.value + '%';
      };
    }

    // Texture Scale slider — controls zoom/tile-density of the tiled pattern.
    // Changing scale only rebuilds the cached pre-scaled canvas (cheap); it
    // does not bump brushTextureVersion, so the tip/stamp caches are unaffected.
    const texScaleEl=document.getElementById('ts-texture-scale');
    const texScaleVal=document.getElementById('ts-texture-scale-val');
    if(texScaleEl){
      texScaleEl.oninput=()=>{
        window.brushTextureScale=+texScaleEl.value/100;
        if(texScaleVal) texScaleVal.textContent=texScaleEl.value+'%';
        if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
      };
    }

    // Invert checkbox — flips which side of the texture (light/dark) keeps paint.
    const texInvertEl=document.getElementById('ts-texture-invert');
    if(texInvertEl){
      texInvertEl.onchange=()=>{
        window.brushTextureInvert=!!texInvertEl.checked;
        if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
        if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(false);
      };
    }

    // Brightness slider — shifts the normalized grain value up/down (opens or
    // closes the grain holes), same intent as Clip Studio's Brightness control.
    const texBrightEl=document.getElementById('ts-texture-brightness');
    const texBrightVal=document.getElementById('ts-texture-brightness-val');
    if(texBrightEl){
      texBrightEl.oninput=()=>{
        window.brushTextureBrightness=+texBrightEl.value;
        if(texBrightVal) texBrightVal.textContent=texBrightEl.value;
        if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
      };
      texBrightEl.onchange=()=>{ if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(false); };
    }

    // Contrast slider — sharpens or softens the grain boundary around the
    // midpoint, same intent as Clip Studio's Contrast control in the Texture
    // panel. Previously present in the DOM with no wiring at all.
    const texContrastEl=document.getElementById('ts-texture-contrast');
    const texContrastVal=document.getElementById('ts-texture-contrast-val');
    if(texContrastEl){
      texContrastEl.oninput=()=>{
        window.brushTextureContrast=+texContrastEl.value;
        if(texContrastVal) texContrastVal.textContent=texContrastEl.value;
        if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
      };
      texContrastEl.onchange=()=>{ if(typeof window._captureActiveBrushPreset==='function') window._captureActiveBrushPreset(false); };
    }

    // Drag-and-drop image files onto the texture panel (preview canvas or the
    // surrounding panel area) — mirrors the file-button workflow without
    // requiring the user to open a file picker.
    (function(){
      const texPanel=document.querySelector('.ts-ps-panel[data-panel="texture"]');
      const texPreview=document.getElementById('ts-texture-preview');
      const dropTargets=[texPanel,texPreview].filter(Boolean);
      dropTargets.forEach(el=>{
        el.addEventListener('dragover',e=>{
          if(!e.dataTransfer||![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect='copy';
          el.classList.add('tex-drop-hover');
        });
        el.addEventListener('dragleave',e=>{
          // Only clear highlight when leaving this element entirely (not a child)
          if(el.contains(e.relatedTarget)) return;
          el.classList.remove('tex-drop-hover');
        });
        el.addEventListener('drop',e=>{
          el.classList.remove('tex-drop-hover');
          if(!e.dataTransfer) return;
          e.preventDefault();
          e.stopPropagation(); // don't let the global image-import handler also fire
          // image-import.js listens on `document` for drop and resets
          // _dragCounter + hides the overlay there. Since we stopped
          // propagation, that cleanup never runs — do it manually so the
          // "Drop image to import" overlay doesn't stay stuck after the drop.
          const ov=document.getElementById('img-drop-overlay');
          if(ov) ov.classList.remove('active','over-canvas');
          const files=e.dataTransfer.files;
          for(const f of (files||[])){
            if(f.type.startsWith('image/')){
              _loadTextureFromFile(f);
              break;
            }
          }
        });
      });
    })();

    // Initial draw
    window._syncTextureUI();

  })();

})(); // end Tool Settings panel init

// Preset get/apply
function getToolPreset(){
  const ids=['ts-size','ts-opacity','ts-flow','ts-density','ts-hardness','ts-spacing','ts-spacing-mode','ts-rotation-mode','ts-angle','ts-angle-jitter','ts-tip-roundness','ts-round-jitter','ts-tip-min-roundness','ts-tip-flip-x','ts-tip-flip-y','ts-scatter-enabled','ts-scatter-amount','ts-scatter-count','ts-airbrush','ts-airbrush-rate',
    'ts-min-size','ts-size-jitter','ts-taper-mode','ts-start-taper','ts-end-taper','ts-size-control','ts-size-pressure-curve','ts-flow-control','ts-flow-pressure-curve','ts-opacity-control','ts-opacity-pressure-curve','ts-min-flow',
    'ts-texture-scale','ts-texture-strength','ts-texture-buildup','ts-texture-brightness','ts-texture-contrast','ts-texture-invert','ts-texture-each','ts-texture-mode'];
  const out={};
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(el) out[id]=(el.type==='checkbox'?el.checked:el.value);
  });
  out['ts-aa']=document.getElementById('ts-aa').checked;
  out['ts-aa-mode']=window.brushAAMode&&window.brushAAMode!=='none'?window.brushAAMode:'medium';
  out['ts-pressure-curves']=JSON.parse(JSON.stringify(window._tsCustomPressureCurves||{}));

  //  Brush tip & texture image data (stored as data URLs for JSON export)
  // These are only written when an image is actually loaded; absent keys mean
  // "no custom tip/texture" so legacy presets silently skip this code path.
  if(window.brushTipCanvas){
    try{ out['ts-tip-dataurl']=window.brushTipCanvas.toDataURL('image/png'); }catch(e){}
    out['ts-tip-mode']=(window.brushTipMode||'multiply');
    out['ts-tip-soft-alpha']=!!(window.brushTipSoftAlpha!==false);
    out['ts-scatter-both-axes']=window._tsScatterBothAxes!==false;
    if(Number.isFinite(Number(window.brushTipReferenceDiameter))&&Number(window.brushTipReferenceDiameter)>0) out['ts-tip-reference-diameter']=Number(window.brushTipReferenceDiameter);
    out['ts-tip-roundness']=Math.round((window.brushTipRoundness==null?1:window.brushTipRoundness)*100);
    out['ts-tip-min-roundness']=Math.round((window.brushTipMinimumRoundness||0)*100);
    out['ts-tip-roundness-dynamics']=!!window.brushTipRoundnessDynamics;
    out['ts-tip-flip-x']=!!window.brushTipFlipX;
    out['ts-tip-flip-y']=!!window.brushTipFlipY;
  }
  if(window.brushTextureCanvas){
    try{ out['ts-texture-dataurl']=window.brushTextureCanvas.toDataURL('image/png'); }catch(e){}
    out['ts-texture-strength']=Math.round((window.brushTextureStrength!=null?window.brushTextureStrength:1.0)*100);
    out['ts-texture-buildup-custom']=Math.round((window.brushTextureBuildup!=null?window.brushTextureBuildup:1.0)*100);
    out['ts-texture-scale']=Math.round((window.brushTextureScale||1.0)*100);
    out['ts-texture-invert']=!!window.brushTextureInvert;
    out['ts-texture-brightness']=window.brushTextureBrightness||0;
    out['ts-texture-contrast']=window.brushTextureContrast||0;
  }
  return out;
}

// Load a data-URL string into a canvas; returns a Promise<HTMLCanvasElement>.
function _dataURLToCanvas(dataURL){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas');
      c.width=img.naturalWidth; c.height=img.naturalHeight;
      c.getContext('2d').drawImage(img,0,0);
      resolve(c);
    };
    img.onerror=()=>reject(new Error('Failed to decode data URL'));
    img.src=dataURL;
  });
}

function applyToolPreset(json){
  Object.entries(json).forEach(([id,val])=>{
    // Skip virtual/non-DOM keys handled separately below.
    if(id==='ts-tip-dataurl'||id==='ts-texture-dataurl'||
       id==='ts-tip-mode'||id==='ts-tip-soft-alpha'||id==='ts-tip-reference-diameter'||id==='ts-tip-roundness-dynamics'||id==='ts-texture-strength'||id==='ts-texture-buildup-custom'||id==='ts-pressure-curves') return;
    const el=document.getElementById(id);
    if(!el) return;
    if(el.type==='checkbox') el.checked=!!val;
    else el.value=val;
    el.dispatchEvent(new Event('input'));
  });

  window._tsCustomPressureCurves=JSON.parse(JSON.stringify(json['ts-pressure-curves']||{}));
  if(typeof window._refreshPressureCurvePreviews==='function') window._refreshPressureCurvePreviews();

  //  Restore tip image
  window._tsScatterBothAxes=json['ts-scatter-both-axes']!==false;
  window.brushTipRoundness=Math.max(0.01,Math.min(1,(json['ts-tip-roundness']??100)/100));
  window.brushTipMinimumRoundness=Math.max(0,Math.min(1,(json['ts-tip-min-roundness']??0)/100));
  window.brushTipRoundnessDynamics=!!json['ts-tip-roundness-dynamics'];
  window.brushTipFlipX=!!json['ts-tip-flip-x'];
  window.brushTipFlipY=!!json['ts-tip-flip-y'];

  const tipLoadGeneration=(window._brushTipLoadGeneration||0)+1;
  window._brushTipLoadGeneration=tipLoadGeneration;
  if(json['ts-tip-dataurl']){
    _dataURLToCanvas(json['ts-tip-dataurl']).then(c=>{
      if(window._brushTipLoadGeneration!==tipLoadGeneration) return;
      if(typeof window.setBrushTip==='function') window.setBrushTip(c,json['ts-tip-reference-diameter']);
      if(json['ts-tip-mode']) window.brushTipMode=json['ts-tip-mode'];
      if(json['ts-tip-soft-alpha']!==undefined) window.brushTipSoftAlpha=!!json['ts-tip-soft-alpha'];
      if(typeof _syncTipUI==='function') _syncTipUI();
    }).catch(()=>{});
  } else {
    // Preset has no tip — clear any currently loaded one so switching presets
    // doesn't leak the tip from the previous preset.
    if(typeof window.clearBrushTip==='function') window.clearBrushTip();
    if(typeof _syncTipUI==='function') _syncTipUI();
  }

  //  Restore texture image
  if(json['ts-texture-dataurl']){
    _dataURLToCanvas(json['ts-texture-dataurl']).then(c=>{
      if(typeof window.setBrushTexture==='function') window.setBrushTexture(c);
      const strengthValue=json['ts-texture-strength']??json['ts-texture-depth-custom']??json['ts-texture-depth'];
      const strength=strengthValue!=null?(+strengthValue/100):1.0;
      window.brushTextureStrength=strength;
      // Restore buildup — default 1.0 (100%) for legacy presets
      const buildup=json['ts-texture-buildup-custom']!=null?(+json['ts-texture-buildup-custom']/100):1.0;
      window.brushTextureBuildup=buildup;
      // Restore texture scale — default to 1.0 (100%) for legacy presets
      if(json['ts-texture-scale']!=null){
        window.brushTextureScale=+json['ts-texture-scale']/100;
      } else {
        window.brushTextureScale=1.0;
      }
      // Restore invert/brightness/contrast — default to neutral for legacy presets
      window.brushTextureInvert = !!json['ts-texture-invert'];
      window.brushTextureBrightness = json['ts-texture-brightness']!=null?+json['ts-texture-brightness']:0;
      window.brushTextureContrast = json['ts-texture-contrast']!=null?+json['ts-texture-contrast']:0;
      if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
      if(typeof window._syncTextureUI==='function') window._syncTextureUI();
    }).catch(()=>{});
  } else {
    if(typeof window.clearBrushTexture==='function') window.clearBrushTexture();
    if(typeof window._syncTextureUI==='function') window._syncTextureUI();
  }
}

//
// BRUSH PRESET SYSTEM (Photoshop-style)
//
(function(){
  //  Built-in brush shape presets
  // NOTE: there is no separate "eraser preset" list anymore. The eraser is
  // just the brush engine compositing with destination-out (see the brush
  // engine comment a few hundred lines up: "the eraser always uses the same
  // mode as the current brush") — so it picks its *shape* from this exact
  // same list. What used to be 4 hard-coded "eraser presets" was redundant
  // and out of sync with the real brush shapes. Brush and Eraser each just
  // remember their OWN last-picked preset + size/hardness/flow/etc, tracked
  // in _toolState below, completely independently of one another.
  // ========================================
  // DEFAULT BUILT-IN BRUSH PRESETS
  // ========================================
  // Add future built-in brushes to BRUSH_PRESETS and override only the values
  // that differ from this complete editable baseline.
  const DEFAULT_BUILTIN_BRUSH_SETTINGS = {
    'ts-size':6,
    'ts-opacity':100,
    'ts-flow':100,
    'ts-density':100,
    'ts-hardness':100,
    'ts-spacing':1,
    'ts-spacing-mode':'fixed',
    'ts-roundness':100,
    'ts-tip-roundness':100,
    'ts-tip-flip-x':false,
    'ts-tip-flip-y':false,
    'ts-rotation-mode':'fixed-rotation',
    'ts-angle':0,
    'ts-scatter-enabled':false,
    'ts-scatter-amount':0,
    'ts-scatter-count':1,
    'ts-aa':true,
    'ts-aa-mode':'medium',
    'ts-size-control':'pressure',
    // Was 1 (a hidden 1% minimum-size floor). Hard Round was the only
    // preset that explicitly overrode this down to 0, which is why it
    // could taper all the way to a true sub-pixel point at light pressure
    // while every other brush -- including any imported/custom tip, which
    // never set its own override -- stayed stuck with a non-zero floor.
    // That forced custom tips to need a bigger base Size + heavier
    // pressure just to reach the same visual minimum Hard Round hit
    // effortlessly. 0 is now the shared default so every brush (including
    // custom tips) gets Hard Round's full pressure range unless a preset
    // deliberately opts into a floor.
    'ts-min-size':0,
    'ts-taper-mode':'off',
    'ts-start-taper':0,
    'ts-end-taper':0,
    'ts-size-pressure-curve':'linear',
    'ts-flow-control':'off',
    'ts-min-flow':0,
    'ts-flow-pressure-curve':'linear',
    'ts-opacity-control':'off',
    'ts-opacity-pressure-curve':'linear',
    'ts-airbrush':false,
    'ts-airbrush-rate':55,
    'ts-tip-mode':'multiply',
    'ts-tip-soft-alpha':true,
    'ts-texture-invert':false,
    'ts-texture-scale':100,
    'ts-texture-brightness':0,
    'ts-texture-contrast':0,
    'ts-texture-each':false,
    'ts-texture-mode':'multiply',
    'ts-texture-strength':100,
    'ts-texture-buildup':100,
    'ts-pressure-curves':{}
  };
  function normalizeTextureSettings(settings){
    const normalized=Object.assign({},settings||{});
    if(normalized['ts-texture-strength']==null && normalized['ts-texture-depth-custom']!=null){
      normalized['ts-texture-strength']=normalized['ts-texture-depth-custom'];
    }
    if(normalized['ts-texture-strength']==null && normalized['ts-texture-depth']!=null){
      normalized['ts-texture-strength']=normalized['ts-texture-depth'];
    }
    if(normalized['ts-texture-buildup-custom']==null && normalized['ts-texture-buildup']!=null){
      normalized['ts-texture-buildup-custom']=normalized['ts-texture-buildup'];
    }
    if(normalized['ts-texture-brightness']==null && normalized['ts-brightness']!=null){
      normalized['ts-texture-brightness']=normalized['ts-brightness'];
    }
    if(normalized['ts-texture-contrast']==null && normalized['ts-contrast']!=null){
      normalized['ts-texture-contrast']=normalized['ts-contrast'];
    }
    return normalized;
  }
  const builtinBrushSettings=overrides=>Object.assign({},DEFAULT_BUILTIN_BRUSH_SETTINGS,{'ts-pressure-curves':{}},normalizeTextureSettings(overrides));

  const BRUSH_PRESETS = [
    {
      id:'hard-round',
      name:'Hard Round',
      preview:{shape:'circle',hardness:0.95},
      settings:builtinBrushSettings({
        'ts-size':6,
        'ts-spacing':1,
        'ts-hardness':100,
        'ts-spacing-mode':'auto',
        'ts-min-size':0,
        'ts-min-flow':0,
        'ts-taper-mode':'off',
        'ts-start-taper':0,
        'ts-end-taper':0,
      })
    },
    {
      id:'soft-round',
      name:'Soft Round',
      preview:{shape:'circle',hardness:0.08},
      settings:builtinBrushSettings({
        'ts-size':32,
        'ts-hardness':6,
        'ts-spacing-mode':'auto',
        'ts-size-control':'off',
        'ts-spacing':5,
        'ts-flow':60,
      })
    },
    {
      id:'soft-airbrush',
      name:'Soft Airbrush',
      preview:{shape:'circle',hardness:0},
      settings:builtinBrushSettings({
        'ts-size':400,
        'ts-flow':10,
        'ts-hardness':0,
        'ts-spacing':40,
        'ts-size-control':'off'
      })
    },

  ];  // User-created presets (saved via the ➕ button). Restored from storage.
  let _customPresets = [];
  // Built-in "preset packs" loaded from assets/brush-presets/<folder>/ at
  // startup (see _loadBrushPresetPacks below). Kept separate from
  // _customPresets so they're never written into localStorage/persist() --
  // they're re-loaded fresh from disk every session, same as the app's own
  // built-in Hard Round/Soft Round/etc.
  let _assetPackPresets = [];

  //  Groups (folders)
  // A single ordered list now (no more separate brush/eraser group sets
  // both tools browse the same folders). The first/default folder holds all
  // the built-in shapes and is called "General Brushes" since it's the
  // default set everything ships with. Users can drag it (and any custom
  // folder) to reorder, drag brushes between folders to reorganize, and
  // create new empty folders via the 📁+ button for brushes they add later.
  let _groups = [
    { id:'general', label:'General Brushes', icon:'🖌', default:true, collapsed:false,
      ids:['hard-round','soft-round','soft-airbrush'] }
  ];

  //  Per-preset settings store
  // Each preset stores its own independent settings snapshot.
  // Keys are preset IDs; values mirror the full getToolPreset() shape.
  // Built-ins are seeded from their BRUSH_PRESETS[].settings; user tweaks
  // are written here whenever the slider values change while that preset is
  // active, so switching presets never bleeds settings between them.
  let _presetSettings = {}; // { [presetId]: { 'ts-size':…, 'ts-hardness':…, … } }
  const _presetSettingsKey=(presetId,toolType='brush')=>toolType+':'+presetId;

  function _seedPresetSettings(preset,toolType='brush'){
    const key=_presetSettingsKey(preset.id,toolType);
    // Deep-clone the built-in settings so the original BRUSH_PRESETS entry
    // is never mutated by later UI captures or Object.assign merges.
    if(!_presetSettings[key]){
      _presetSettings[key]=JSON.parse(JSON.stringify(preset.settings||{}));
    } else {
      // Always re-inject URL-based tip/texture references from the pack preset
      // definition even when persisted settings already exist. Persisted data
      // never contains 'ts-tip-url' (only 'ts-tip-dataurl' for user images),
      // so a stale localStorage entry would permanently hide the pack tip image
      // without this merge. Only inject the URL when no user-supplied data URL
      // has overridden the tip for this slot.
      const ps = preset.settings || {};
      const existing = _presetSettings[key];
      if(ps['ts-tip-url'] && !existing['ts-tip-dataurl']){
        existing['ts-tip-url'] = ps['ts-tip-url'];
      }
      if(ps['ts-texture-url'] && !existing['ts-texture-dataurl']){
        existing['ts-texture-url'] = ps['ts-texture-url'];
      }
    }
  }
  // Seed built-ins immediately
  BRUSH_PRESETS.forEach(_seedPresetSettings);

  // Capture the current slider state into the active preset's per-preset slot
  function _captureToPreset(presetId,captureTip=false,toolType=(tool==='eraser'?'eraser':'brush')){
    if(!presetId) return;
    const key=_presetSettingsKey(presetId,toolType);
    const settings=_presetSettings[key]||(_presetSettings[key]={});
    document.querySelectorAll('#tool-settings-body input[id]:not([type=file]),#tool-settings-body select[id]').forEach(control=>{
      settings[control.id]=control.type==='checkbox'?control.checked:control.value;
    });
    settings['ts-pressure-curves']=JSON.parse(JSON.stringify(window._tsCustomPressureCurves||{}));
    if(captureTip){
      if(window.brushTipCanvas){
        try{settings['ts-tip-dataurl']=window.brushTipCanvas.toDataURL('image/png');}catch(e){}
        settings['ts-tip-mode']=window.brushTipMode||'multiply';
        settings['ts-tip-soft-alpha']=!!window.brushTipSoftAlpha;
        settings['ts-scatter-both-axes']=window._tsScatterBothAxes!==false;
        if(Number.isFinite(Number(window.brushTipReferenceDiameter))&&Number(window.brushTipReferenceDiameter)>0) settings['ts-tip-reference-diameter']=Number(window.brushTipReferenceDiameter);
        else delete settings['ts-tip-reference-diameter'];
      } else {delete settings['ts-tip-dataurl'];delete settings['ts-tip-mode'];delete settings['ts-tip-soft-alpha'];delete settings['ts-tip-reference-diameter'];}
      // Capture texture image alongside tip — both are images and both are
      // gated behind captureTip so that normal slider input events (which
      // pass captureTip=false) don't re-encode the PNG on every drag tick.
      // The slider numeric values are captured by the querySelectorAll loop
      // above; the data URL only needs to be captured when the image itself
      // changes (load / clear), at which point callers pass captureTip=true.
      if(window.brushTextureCanvas){
        try{settings['ts-texture-dataurl']=window.brushTextureCanvas.toDataURL('image/png');}catch(e){}
        settings['ts-texture-strength']=Math.round((window.brushTextureStrength!=null?window.brushTextureStrength:1.0)*100);
        settings['ts-texture-buildup-custom']=Math.round((window.brushTextureBuildup!=null?window.brushTextureBuildup:1.0)*100);
        settings['ts-texture-scale']=Math.round((window.brushTextureScale||1.0)*100);
      } else {
        delete settings['ts-texture-dataurl'];
      }
    }
  }

  //  Per-tool memory
  // Brush and Eraser each keep their OWN preset + slider values. Switching
  // tools snapshots the outgoing tool's live settings and restores the
  // incoming tool's saved settings — so "brush=preset1, eraser=preset2" each
  // stick, and manual tweaks to either are remembered too.
  let _toolState = {
    brush:  {presetId:'hard-round', size:6, hardness:100,  opacity:100, flow:100, density:100, spacing:1, roundness:100, aa:true, airbrush:false},
    eraser: {presetId:'hard-round', size:20, hardness:100, opacity:100, flow:100, density:100, spacing:1, roundness:100, aa:true, airbrush:false},
  };
  let _toolPresetSizes={brush:{'hard-round':6},eraser:{'hard-round':20}};
  // Which tab is shown in the preset panel (brush|eraser) — follows setTool()
  let _activeTab = 'brush';
  // Which preset is currently shown active/highlighted in the grid
  let _activePresetId = 'hard-round';
  let _applyingPresetSettings=false;
  // Drag state (kept in JS, not dataTransfer — reading dataTransfer.getData
  // during dragover is unreliable cross-browser, so we just track it here)
  let _drag = null; // {type:'group',id} | {type:'item',id,fromGroup}

  //  Persistence
  const STORE_KEY='animatorBrushPresetsV2';
  function persist(){
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v:2, customPresets:_customPresets, groups:_groups, toolState:_toolState, toolPresetSizes:_toolPresetSizes, presetSettings:_presetSettings
      }));
    }catch(e){ /* storage unavailable — fail silently, in-memory state still works */ }
  }
  window._captureActiveBrushPreset=(captureTip=false)=>{_captureToPreset(_activePresetId,captureTip);persist();};

  let _persistSettingsTimer=null;
  const TIP_SETTING_IDS=new Set(['ts-tip-mode','ts-tip-soft-alpha']);
  function captureActivePresetFromEvent(event){
    if(_applyingPresetSettings||!event.target||!event.target.closest('#tool-settings-body')||!event.target.id) return;
    if(!event.target.matches('input:not([type=file]),select')) return;
    const captureTip=TIP_SETTING_IDS.has(event.target.id);
    _captureToPreset(_activePresetId, captureTip);

    clearTimeout(_persistSettingsTimer);
    _persistSettingsTimer=setTimeout(persist,100);
  }
  document.addEventListener('input',captureActivePresetFromEvent);
  document.addEventListener('change',captureActivePresetFromEvent);

  function loadPersisted(){
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(!raw) return;
      const data=JSON.parse(raw);
      if(data && Array.isArray(data.customPresets)) _customPresets=data.customPresets;
      if(data && Array.isArray(data.groups) && data.groups.length) _groups=data.groups;
      if(data && data.toolState){
        if(data.toolState.brush)  _toolState.brush  = Object.assign({}, _toolState.brush,  data.toolState.brush);
        if(data.toolState.eraser) _toolState.eraser = Object.assign({}, _toolState.eraser, data.toolState.eraser);
      }
      if(data && data.toolPresetSizes){
        if(data.toolPresetSizes.brush) Object.assign(_toolPresetSizes.brush,data.toolPresetSizes.brush);
        if(data.toolPresetSizes.eraser) Object.assign(_toolPresetSizes.eraser,data.toolPresetSizes.eraser);
      }
      // Restore per-preset settings; built-ins will be merged/overridden with
      // the user's saved tweaks so they survive a page reload
      if(data && data.presetSettings && typeof data.presetSettings === 'object'){
        Object.entries(data.presetSettings).forEach(([key,value])=>{
          if(key.includes(':')){
            const restored=Object.assign({},value);
            if(key==='eraser:hard-round') restored['ts-aa']=true;
            // Migration: brush:hard-round with hardness=55 is a contaminated
            // entry caused by the HTML slider default (55) being captured
            // during initialisation before the preset was fully applied.
            // Restore the canonical Hard Round hardness to 100 while
            // preserving any other settings the user genuinely changed.
            if(key==='brush:hard-round'){
              // Migration: hardness=55 is a contamination from the old HTML
              // slider default being captured before the preset was applied.
              if(Number(restored['ts-hardness'])===55) restored['ts-hardness']=100;
              // Migration: old persisted data may have taper-mode='percentage'
              // from when Hard Round shipped with taper on. The canonical
              // default is now 'off'; migrate any non-user-initiated percentage
              // entry that still carries the original start=1/end=10 values.
              if(restored['ts-taper-mode']==='percentage' &&
                 Number(restored['ts-start-taper'])===1 &&
                 Number(restored['ts-end-taper'])===10){
                restored['ts-taper-mode']='off';
                restored['ts-start-taper']=0;
                restored['ts-end-taper']=0;
              }
              // Always enforce canonical structural values — these are never
              // user-adjustable for Hard Round and must survive any stale
              // capture that wrote the wrong value before the fix was deployed.
              restored['ts-min-size']=0;
              restored['ts-spacing-mode']='auto';
            }
            _presetSettings[key]=restored;
            return;
          }
          const migrated=Object.assign({},value);
          if(key==='hard-round'){
            // V1 key format (no tool prefix) — migrate contaminated defaults.
            if(Number(migrated['ts-hardness'])===55) migrated['ts-hardness']=100;
            // Migrate old taper-mode:'percentage' with original values → 'off'.
            if(migrated['ts-taper-mode']==='percentage' &&
               Number(migrated['ts-start-taper'])===1 &&
               Number(migrated['ts-end-taper'])===10){
              migrated['ts-taper-mode']='off';
              migrated['ts-start-taper']=0;
              migrated['ts-end-taper']=0;
            }
            // Always enforce canonical structural values unconditionally.
            migrated['ts-min-size']=0;
            migrated['ts-spacing-mode']='auto';
            if(Number(migrated['ts-spacing'])===12) migrated['ts-spacing']=1;
          }
          _presetSettings[_presetSettingsKey(key,'brush')]=migrated;
        });
      }
    }catch(e){ /* corrupt/unavailable storage — just use defaults */ }
  }
  loadPersisted();
  const generalGroup=_groups.find(group=>group.id==='general')||_groups.find(group=>group.default)||_groups[0];
  if(generalGroup){
    ['hard-round','soft-round','soft-airbrush'].forEach(id=>{
      if(!generalGroup.ids.includes(id)) generalGroup.ids.push(id);
    });
  }

  function allPresets(){ return BRUSH_PRESETS.concat(_customPresets).concat(_assetPackPresets); }
  function findPreset(id){ return allPresets().find(p=>p.id===id); }

  //  Draw preview canvas
  function drawPreview(canvas, cfg){
    const W=48,H=48;
    canvas.width=W; canvas.height=H;
    const c=canvas.getContext('2d');
    c.clearRect(0,0,W,H);
    const cx=W/2, cy=H/2;
    const maxR = cfg.isEraser ? 16 : 18;
    const r = maxR;
    const hard = Math.max(0, Math.min(1, cfg.hardness));
    const innerStop = cfg.aliased ? 1 : hard;
    if(cfg.shape === 'square'){
      const s = r*1.5;
      c.fillStyle = cfg.isEraser ? 'rgba(226,75,74,0.7)' : '#e8e8f0';
      c.fillRect(cx-s/2, cy-s/2, s, s);
    } else if(cfg.shape === 'ellipse'){
      const ry = r * 0.32;
      const grad = c.createRadialGradient(cx,cy,0,cx,cy,r);
      const clr = cfg.isEraser ? '226,75,74' : '232,232,240';
      grad.addColorStop(0,`rgba(${clr},0.95)`);
      grad.addColorStop(innerStop,`rgba(${clr},0.95)`);
      grad.addColorStop(1,`rgba(${clr},0)`);
      c.save();
      c.scale(1, ry/r);
      c.beginPath();c.arc(cx, cy*(r/ry), r, 0, Math.PI*2);
      c.fillStyle=grad; c.fill();
      c.restore();
    } else {
      // circle
      const grad = c.createRadialGradient(cx,cy,0,cx,cy,r);
      const clr = cfg.isEraser ? '226,75,74' : '232,232,240';
      grad.addColorStop(0,`rgba(${clr},0.95)`);
      grad.addColorStop(innerStop,`rgba(${clr},0.95)`);
      grad.addColorStop(1,`rgba(${clr},0)`);
      c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);
      c.fillStyle=grad; c.fill();
    }
  }

  // ── Draw a preset's grid thumbnail, using its real tip image when the
  //    preset has one (imported ABR / custom-uploaded tips) instead of
  //    always falling back to the generic circle/square/ellipse shapes.
  function _paintTipThumbnail(canvas,img,settings,width,height,allowUpscale=false){
    canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d');
    context.clearRect(0,0,width,height);
    const pad=6,maxW=width-pad*2,maxH=height-pad*2;
    const rotation=((Number(settings&&settings['ts-angle'])||0)*Math.PI)/180;
    const minimumRoundness=(Number(settings&&settings['ts-tip-min-roundness'])||0)/100;
    const roundness=Math.max(minimumRoundness,(Number(settings&&settings['ts-tip-roundness'])||100)/100);
    const imageWidth=img.width||img.naturalWidth||1,imageHeight=img.height||img.naturalHeight||1;
    const compressWidth=imageWidth<imageHeight;
    const shapedWidth=imageWidth*(compressWidth?roundness:1);
    const shapedHeight=imageHeight*(compressWidth?1:roundness);
    const rotatedWidth=Math.abs(shapedWidth*Math.cos(rotation))+Math.abs(shapedHeight*Math.sin(rotation));
    const rotatedHeight=Math.abs(shapedWidth*Math.sin(rotation))+Math.abs(shapedHeight*Math.cos(rotation));
    const scale=Math.min(maxW/Math.max(1,rotatedWidth),maxH/Math.max(1,rotatedHeight),allowUpscale?Infinity:1);
    context.save();
    context.fillStyle='rgba(232,232,240,0.95)';
    context.fillRect(0,0,width,height);
    context.globalCompositeOperation='destination-in';
    context.translate(width/2,height/2);
    if(rotation) context.rotate(rotation);
    if(settings&&(settings['ts-tip-flip-x']||settings['ts-tip-flip-y'])) context.scale(settings['ts-tip-flip-x']?-1:1,settings['ts-tip-flip-y']?-1:1);
    context.drawImage(img,-shapedWidth*scale/2,-shapedHeight*scale/2,shapedWidth*scale,shapedHeight*scale);
    context.restore();
  }
  window._paintTipThumbnail=_paintTipThumbnail;
  // presetId -> {alphaCanvas: HTMLCanvasElement, src: string}
  //
  // 'alphaCanvas' is always a luminance-as-alpha canvas — the same format that
  // setBrushTip() produces and that _paintTipThumbnail()'s destination-in
  // compositing relies on.  We never store the raw HTMLImageElement here.
  //
  // 'src' is the raw string passed to img.src (before the browser resolves it),
  // used for cache-hit checks.  We cannot use img.src for this because the
  // browser silently turns relative paths into absolute URLs, which would never
  // compare equal to the relative 'ts-tip-url' string stored in preset settings.
  const _tipThumbCache = {};

  // Convert any raw image (HTMLImageElement or canvas) into a canvas whose
  // ALPHA CHANNEL encodes the tip mask: bright pixels → opaque, dark → transparent.
  // This is the same transform that setBrushTip() applies to the brush engine's
  // working copy.  Without it, file-URL tip PNGs (which are fully opaque — no
  // alpha channel) would cause _paintTipThumbnail's destination-in fill to keep
  // the entire white rectangle → solid white square thumbnail.
  function _tipImageToAlphaCanvas(img){
    const w = (img.naturalWidth || img.width) || 1;
    const h = (img.naturalHeight || img.height) || 1;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    for(let i = 0; i < d.length; i += 4){
      // Perceived luminance of the source pixel.
      const lum = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
      // If the source already has partial transparency (e.g. processed data-URL
      // tips that went through setBrushTip once already), respect that alpha
      // rather than replacing it with luminance again.
      const a = d[i+3] < 254 ? Math.min(d[i+3], lum) : lum;
      d[i] = d[i+1] = d[i+2] = 255; // RGB → white (the thumbnail foreground colour)
      d[i+3] = a;                     // alpha = tip mask
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  function drawPresetThumb(canvas, p){
    const s = _presetSettings[_presetSettingsKey(p.id,'brush')];
    // Support both data-URL tips (imported ABR / user upload) and file-URL tips
    // (on-disk brush-preset packs). Either key is a valid Image.src value.
    const tipSrc = s && (s['ts-tip-dataurl'] || s['ts-tip-url']);
    if(!tipSrc){
      drawPreview(canvas, Object.assign({}, p.preview, {isEraser:_activeTab==='eraser'}));
      return;
    }
    const W=48,H=48;
    canvas.width=W; canvas.height=H;
    const settings=s; // alias for closure

    function paintOnto(c, alphaCanvas){
      _paintTipThumbnail(c, alphaCanvas, settings, W, H, false);
    }

    const cached=_tipThumbCache[p.id];
    // Cache hit: alphaCanvas already converted and source unchanged.
    if(cached && cached.src===tipSrc && cached.alphaCanvas){
      paintOnto(canvas, cached.alphaCanvas);
      return;
    }

    // Cache miss or stale entry — (re)load and convert.
    canvas.getContext('2d').clearRect(0,0,W,H);
    const img=new Image();
    const presetId=p.id;
    img.onload=()=>{
      // Convert raw image → alpha-channel canvas so destination-in compositing
      // in _paintTipThumbnail works correctly regardless of the source format.
      const alphaCanvas=_tipImageToAlphaCanvas(img);
      _tipThumbCache[presetId]={alphaCanvas, src:tipSrc};

      // Paint the canvas that was live when this load started (may be detached
      // if buildGrid ran again before the decode finished).
      paintOnto(canvas, alphaCanvas);

      // Also repaint every currently-DOM-attached canvas for this preset so
      // a subsequent buildGrid() that created new canvas elements is covered.
      document.querySelectorAll('.bp-item .bp-preview canvas').forEach(liveCanvas=>{
        if(liveCanvas===canvas) return; // already painted above
        const item=liveCanvas.closest('.bp-item');
        if(item && item.dataset.presetId===presetId){
          liveCanvas.width=W; liveCanvas.height=H;
          paintOnto(liveCanvas, alphaCanvas);
        }
      });
    };
    img.onerror=()=>{
      // File missing or unloadable — fall back to the generic shape preview so
      // the thumbnail never stays blank.
      drawPreview(canvas, Object.assign({}, p.preview, {isEraser:_activeTab==='eraser'}));
    };
    img.src=tipSrc;
  }

  //  Brush Preset right-click context menu
  let _bpCtxTargetId = null;
  let _bpCopiedPreset = null;

  const bpCtxMenu = document.getElementById('brush-preset-ctx-menu');

  function showBpCtxMenu(e, presetId){
    e.preventDefault();
    e.stopPropagation();
    _bpCtxTargetId = presetId;
    // Auto-select the preset that was right-clicked
    selectPreset(presetId);
    // Update paste item visibility
    const pasteItem = document.getElementById('bp-ctx-paste');
    if(pasteItem) pasteItem.style.opacity = _bpCopiedPreset ? '1' : '0.4';
    // Dim cut/delete for built-in (non-custom) presets
    const preset = allPresets().find(p=>p.id===presetId);
    const isCustom = preset && preset.custom;
    const cutItem = document.getElementById('bp-ctx-cut');
    const delItem = document.getElementById('bp-ctx-delete');
    if(cutItem) cutItem.style.opacity = isCustom ? '1' : '0.4';
    if(delItem) delItem.style.opacity = isCustom ? '1' : '0.4';
    bpCtxMenu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
    bpCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 160) + 'px';
    bpCtxMenu.classList.add('visible');
  }

  if(bpCtxMenu){
    document.getElementById('bp-ctx-rename').onclick = ()=>{
      bpCtxMenu.classList.remove('visible');
      if(!_bpCtxTargetId) return;
      const item = document.querySelector(`.bp-item[data-preset-id="${_bpCtxTargetId}"]`);
      if(!item) return;
      const lbl = item.querySelector('.bp-name');
      if(!lbl) return;
      const preset = allPresets().find(p=>p.id===_bpCtxTargetId);
      if(!preset) return;
      const old = lbl.textContent;
      lbl.contentEditable = 'true';
      lbl.focus();
      const sel = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(lbl); sel.removeAllRanges(); sel.addRange(range);
      const done = ()=>{
        lbl.contentEditable = 'false';
        const newName = lbl.textContent.trim() || old;
        preset.name = newName;
        lbl.textContent = newName;
        persist();
      };
      lbl.addEventListener('blur', done, {once:true});
      lbl.addEventListener('keydown', ev=>{
        if(ev.key==='Enter'){ ev.preventDefault(); lbl.blur(); }
        if(ev.key==='Escape'){ lbl.textContent=old; lbl.blur(); }
      });
    };

    document.getElementById('bp-ctx-copy').onclick = ()=>{
      bpCtxMenu.classList.remove('visible');
      if(!_bpCtxTargetId) return;
      const preset = allPresets().find(p=>p.id===_bpCtxTargetId);
      if(!preset) return;
      _bpCopiedPreset = JSON.parse(JSON.stringify(preset));
    };

    document.getElementById('bp-ctx-paste').onclick = ()=>{
      bpCtxMenu.classList.remove('visible');
      if(!_bpCopiedPreset) return;
      const id = 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      const pasted = Object.assign({}, JSON.parse(JSON.stringify(_bpCopiedPreset)), {id, name: _bpCopiedPreset.name+' Copy', custom:true});
      _customPresets.push(pasted);
      // Seed the pasted preset's own settings slot (copied from the source preset's saved settings)
      _presetSettings[_presetSettingsKey(id,tool==='eraser'?'eraser':'brush')] = JSON.parse(JSON.stringify(_presetSettings[_presetSettingsKey(_bpCopiedPreset.id,tool==='eraser'?'eraser':'brush')] || pasted.settings || {}));
      // Insert after the target if we have one, otherwise append to general group
      const targetGroupId = _bpCtxTargetId
        ? (_groups.find(g=>g.ids.includes(_bpCtxTargetId))||_groups.find(g=>g.default)||_groups[0]).id
        : (_groups.find(g=>g.default)||_groups[0]).id;
      const grp = _groups.find(g=>g.id===targetGroupId) || _groups[0];
      if(_bpCtxTargetId){
        const idx = grp.ids.indexOf(_bpCtxTargetId);
        if(idx !== -1){ grp.ids.splice(idx+1,0,id); } else { grp.ids.push(id); }
      } else {
        grp.ids.push(id);
      }
      persist();
      buildGrid();
      selectPreset(id);
    };

    document.getElementById('bp-ctx-cut').onclick = ()=>{
      bpCtxMenu.classList.remove('visible');
      if(!_bpCtxTargetId) return;
      const preset = allPresets().find(p=>p.id===_bpCtxTargetId);
      if(!preset || !preset.custom) return;
      _bpCopiedPreset = JSON.parse(JSON.stringify(preset));
      // Remove from customPresets
      const ci = _customPresets.findIndex(p=>p.id===_bpCtxTargetId);
      if(ci !== -1) _customPresets.splice(ci, 1);
      // Remove from all groups
      _groups.forEach(g=>{ const i=g.ids.indexOf(_bpCtxTargetId); if(i!==-1) g.ids.splice(i,1); });
      persist();
      buildGrid();
      // Select first available preset
      const first = allPresets()[0];
      if(first) selectPreset(first.id);
    };

    document.getElementById('bp-ctx-delete').onclick = ()=>{
      bpCtxMenu.classList.remove('visible');
      if(!_bpCtxTargetId) return;
      const preset = allPresets().find(p=>p.id===_bpCtxTargetId);
      if(!preset || !preset.custom) return;
      const ci = _customPresets.findIndex(p=>p.id===_bpCtxTargetId);
      if(ci !== -1) _customPresets.splice(ci, 1);
      _groups.forEach(g=>{ const i=g.ids.indexOf(_bpCtxTargetId); if(i!==-1) g.ids.splice(i,1); });
      persist();
      buildGrid();
      const first = allPresets()[0];
      if(first) selectPreset(first.id);
    };
  }

  //  Brush Group right-click + double-click context menu
  let _bgCtxTargetId = null;
  let _bpCopiedGroup = null; // { label, icon, presetIds (deep copies of custom presets + refs to builtins) }

  const bgCtxMenu = document.getElementById('brush-group-ctx-menu');

  function _startGroupRename(grpId){
    const grp = _groups.find(g=>g.id===grpId);
    if(!grp) return;
    const hd = document.querySelector(`.bp-group[data-group-id="${grpId}"] .bp-group-hd`);
    if(!hd) return;
    const nameSpan = hd.querySelector('.bp-group-name');
    if(!nameSpan) return;
    // Strip the icon prefix for editing
    const oldLabel = grp.label;
    const editText = oldLabel;
    nameSpan.contentEditable = 'true';
    // Only make the text part editable — set content to just the label without icon
    nameSpan.textContent = editText;
    nameSpan.focus();
    const sel = window.getSelection(); const range = document.createRange();
    range.selectNodeContents(nameSpan); sel.removeAllRanges(); sel.addRange(range);
    const done = ()=>{
      nameSpan.contentEditable = 'false';
      const newLabel = nameSpan.textContent.trim() || oldLabel;
      grp.label = newLabel;
      // Restore icon + label display
      nameSpan.textContent = grp.icon + ' ' + grp.label;
      persist();
    };
    nameSpan.addEventListener('blur', done, {once:true});
    nameSpan.addEventListener('keydown', ev=>{
      if(ev.key==='Enter'){ ev.preventDefault(); nameSpan.blur(); }
      if(ev.key==='Escape'){ nameSpan.textContent = grp.icon + ' ' + oldLabel; nameSpan.blur(); }
    });
  }

  function showBgCtxMenu(e, grpId){
    e.preventDefault();
    e.stopPropagation();
    _bgCtxTargetId = grpId;
    const pasteItem = document.getElementById('bg-ctx-paste');
    if(pasteItem) pasteItem.style.opacity = _bpCopiedGroup ? '1' : '0.4';
    const deleteItem=document.getElementById('bg-ctx-delete');
    const targetGroup=_groups.find(group=>group.id===grpId);
    const containsBuiltin=!!(targetGroup&&targetGroup.ids.some(id=>BRUSH_PRESETS.some(preset=>preset.id===id)));
    const canDelete=!!targetGroup&&!targetGroup.default&&!containsBuiltin;
    if(deleteItem){deleteItem.style.opacity=canDelete?'1':'0.4';deleteItem.style.pointerEvents=canDelete?'auto':'none';}
    bgCtxMenu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
    bgCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 150) + 'px';
    bgCtxMenu.classList.add('visible');
  }

  if(bgCtxMenu){
    document.getElementById('bg-ctx-rename').onclick = ()=>{
      bgCtxMenu.classList.remove('visible');
      if(!_bgCtxTargetId) return;
      _startGroupRename(_bgCtxTargetId);
    };

    document.getElementById('bg-ctx-copy').onclick = ()=>{
      bgCtxMenu.classList.remove('visible');
      if(!_bgCtxTargetId) return;
      const grp = _groups.find(g=>g.id===_bgCtxTargetId);
      if(!grp) return;
      // Deep-copy the group: for custom presets copy the full preset data,
      // for built-ins just store the id reference
      const presetSnapshots = grp.ids.map(id=>{
        const custom = _customPresets.find(p=>p.id===id);
        return custom ? JSON.parse(JSON.stringify(custom)) : {builtinId: id};
      });
      _bpCopiedGroup = { label: grp.label, icon: grp.icon, presetSnapshots };
    };

    document.getElementById('bg-ctx-paste').onclick = ()=>{
      bgCtxMenu.classList.remove('visible');
      if(!_bpCopiedGroup) return;
      const newGrpId = 'grp'+Date.now().toString(36)+Math.random().toString(36).slice(2,4);
      const newIds = [];
      _bpCopiedGroup.presetSnapshots.forEach(snap=>{
        if(snap.builtinId){
          // Reference to a built-in preset — just reuse the id
          newIds.push(snap.builtinId);
        } else {
          // Custom preset — create a new copy with a fresh id
          const newId = 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
          const cloned = Object.assign({}, JSON.parse(JSON.stringify(snap)), {id: newId, custom: true});
          _customPresets.push(cloned);
          newIds.push(newId);
        }
      });
      const newGrp = {
        id: newGrpId,
        label: _bpCopiedGroup.label + ' Copy',
        icon: _bpCopiedGroup.icon,
        default: false,
        collapsed: false,
        ids: newIds
      };
      // Insert after target group if we have one, otherwise append
      if(_bgCtxTargetId){
        const idx = _groups.findIndex(g=>g.id===_bgCtxTargetId);
        if(idx !== -1){ _groups.splice(idx+1, 0, newGrp); } else { _groups.push(newGrp); }
      } else {
        _groups.push(newGrp);
      }
      persist();
      buildGrid();
    };

    const deleteGroupModal=document.getElementById('modal-delete-brush-group');
    let pendingDeleteGroupId=null;
    const closeDeleteGroupModal=()=>{
      pendingDeleteGroupId=null;
      deleteGroupModal.classList.remove('visible');
    };
    const deleteBrushGroup=groupId=>{
      const group=_groups.find(candidate=>candidate.id===groupId);
      if(!group||group.default) return;
      const containsBuiltin=group.ids.some(id=>BRUSH_PRESETS.some(preset=>preset.id===id));
      if(containsBuiltin) return;
      const deletedIds=new Set(group.ids);
      if(deletedIds.has(_activePresetId)) selectPreset('hard-round');
      for(const toolType of ['brush','eraser']){
        if(deletedIds.has(_toolState[toolType].presetId)) _toolState[toolType].presetId='hard-round';
        for(const id of deletedIds) delete _toolPresetSizes[toolType][id];
      }
      _customPresets=_customPresets.filter(preset=>!deletedIds.has(preset.id));
      for(const id of deletedIds){delete _presetSettings[_presetSettingsKey(id,'brush')];delete _presetSettings[_presetSettingsKey(id,'eraser')];}
      _groups=_groups.filter(candidate=>candidate.id!==group.id);
      _bgCtxTargetId=null;
      persist();
      buildGrid();
      refreshGrid();
    };

    document.getElementById('bg-ctx-delete').onclick=()=>{
      bgCtxMenu.classList.remove('visible');
      pendingDeleteGroupId=_bgCtxTargetId;
      deleteGroupModal.classList.add('visible');
    };

    window._openBrushGroupDeleteModal=groupId=>{
      _bgCtxTargetId=groupId;
      pendingDeleteGroupId=groupId;
      deleteGroupModal.classList.add('visible');
    };
    document.getElementById('delete-brush-group-cancel').onclick=closeDeleteGroupModal;
    document.getElementById('delete-brush-group-confirm').onclick=()=>{
      const groupId=pendingDeleteGroupId;
      closeDeleteGroupModal();
      if(groupId) deleteBrushGroup(groupId);
    };
    deleteGroupModal.addEventListener('click',event=>{
      if(event.target===deleteGroupModal) closeDeleteGroupModal();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&deleteGroupModal.classList.contains('visible')) closeDeleteGroupModal();
    });
  }

  //  Create a single bp-item element (draggable + reorderable)
  function makeBpItem(p, groupId){
    const item = document.createElement('div');
    item.className='bp-item'+(p.id===_activePresetId?' active':'');
    item.dataset.presetId=p.id;
    item.dataset.groupId=groupId;
    item.draggable=true;
    const prev = document.createElement('div');
    prev.className='bp-preview';
    const cvs = document.createElement('canvas');
    drawPresetThumb(cvs, p);
    prev.appendChild(cvs);
    const lbl = document.createElement('div');
    lbl.className='bp-name';
    lbl.textContent=p.name;
    lbl.title=p.name;
    item.title=p.name;
    item.appendChild(prev);
    item.appendChild(lbl);
    item.onclick=()=>selectPreset(p.id);
    item.addEventListener('contextmenu', e=>showBpCtxMenu(e, p.id));

    item.addEventListener('dragstart', e=>{
      _drag={type:'item', id:p.id, fromGroup:groupId};
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      try{ e.dataTransfer.setData('text/plain', 'item:'+p.id); }catch(err){}
    });
    item.addEventListener('dragend', ()=>{
      item.classList.remove('dragging');
      document.querySelectorAll('.bp-item.drop-before,.bp-item.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
      _drag=null;
    });
    item.addEventListener('dragover', e=>{
      if(!_drag || _drag.type!=='item') return;
      if(item.dataset.presetId===_drag.id) return;
      e.preventDefault();
      const r=item.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width/2;
      document.querySelectorAll('.bp-item.drop-before,.bp-item.drop-after').forEach(el=>{if(el!==item) el.classList.remove('drop-before','drop-after');});
      item.classList.toggle('drop-before', before);
      item.classList.toggle('drop-after', !before);
    });
    item.addEventListener('drop', e=>{
      if(!_drag || _drag.type!=='item') return;
      e.preventDefault(); e.stopPropagation();
      const before = item.classList.contains('drop-before');
      item.classList.remove('drop-before','drop-after');
      moveItem(_drag.id, _drag.fromGroup, groupId, p.id, before);
    });
    return item;
  }

  //  Move a preset id from one group to another (or reorder within)
  function moveItem(presetId, fromGroupId, toGroupId, targetId, before){
    const fromGrp = _groups.find(g=>g.id===fromGroupId);
    const toGrp = _groups.find(g=>g.id===toGroupId);
    if(!fromGrp || !toGrp) return;
    const fi = fromGrp.ids.indexOf(presetId);
    if(fi===-1) return;
    fromGrp.ids.splice(fi,1);
    let ti = toGrp.ids.indexOf(targetId);
    if(ti===-1) ti = toGrp.ids.length;
    else if(!before) ti += 1;
    toGrp.ids.splice(ti,0,presetId);
    persist();
    buildGrid(_bpSearchVal());
  }

  function _bpSearchVal(){ const el=document.getElementById('bp-search'); return el?el.value:''; }

  //  Build the grid (groups + items, draggable/reorderable, scrollable)
  function buildGrid(searchQuery){
    const grid = document.getElementById('brush-preset-grid');
    const noResults = document.getElementById('bp-no-results');
    if(!grid) return;
    grid.innerHTML='';
    const q = (searchQuery||'').trim().toLowerCase();

    if(q){
      // Flat search results across every group, no folders shown
      const matched = allPresets().filter(p=>p.name.toLowerCase().includes(q));
      if(matched.length===0){
        if(noResults) noResults.style.display='block';
      } else {
        if(noResults) noResults.style.display='none';
        const flatGrid = document.createElement('div');
        flatGrid.className='bp-group-grid';
        matched.forEach(p=>{
          // find which group currently owns it, so drag still works sensibly
          const owner = _groups.find(g=>g.ids.includes(p.id));
          flatGrid.appendChild(makeBpItem(p, owner?owner.id:_groups[0].id));
        });
        grid.appendChild(flatGrid);
      }
      return;
    }
    if(noResults) noResults.style.display='none';

    _groups.forEach(grp=>{
      const grpEl = document.createElement('div');
      grpEl.className='bp-group';
      grpEl.dataset.groupId=grp.id;

      const hd = document.createElement('div');
      hd.className='bp-group-hd'+(grp.collapsed?' collapsed':'');
      hd.draggable=true;
      hd.innerHTML=`<span class="bp-group-grip">⠿</span><span class="bp-group-toggle">▾</span><span class="bp-group-name">${grp.icon} ${grp.label}</span><span class="bp-group-count">${grp.ids.length}</span>`+
        (grp.default ? '' : '<span class="bp-group-del" title="Delete group">✕</span>');
      hd.addEventListener('click', e=>{
        if(e.target.classList.contains('bp-group-del')) return; // handled separately
        if(e.target.closest('.bp-group-name') && e.detail===2) return; // double-click handled below
        hd.classList.toggle('collapsed');
        grp.collapsed = hd.classList.contains('collapsed');
        persist();
      });
      // Double-click on group name to rename
      const nameSpan = hd.querySelector('.bp-group-name');
      if(nameSpan){
        nameSpan.addEventListener('dblclick', e=>{
          e.stopPropagation();
          _startGroupRename(grp.id);
        });
      }
      // Right-click on group header to show group ctx menu
      hd.addEventListener('contextmenu', e=>{
        if(e.target.classList.contains('bp-group-del')) return;
        showBgCtxMenu(e, grp.id);
      });
      const delBtn = hd.querySelector('.bp-group-del');
      if(delBtn){
        delBtn.addEventListener('click',e=>{
          e.stopPropagation();
          if(typeof window._openBrushGroupDeleteModal==='function') window._openBrushGroupDeleteModal(grp.id);
        });
      }
      hd.addEventListener('dragstart', e=>{
        _drag={type:'group', id:grp.id};
        hd.classList.add('dragging');
        e.dataTransfer.effectAllowed='move';
        try{ e.dataTransfer.setData('text/plain','group:'+grp.id); }catch(err){}
      });
      hd.addEventListener('dragend', ()=>{
        hd.classList.remove('dragging');
        document.querySelectorAll('.bp-group.drop-before,.bp-group.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
        _drag=null;
      });
      hd.addEventListener('dragover', e=>{
        if(!_drag || _drag.type!=='group' || _drag.id===grp.id) return;
        e.preventDefault();
        const r=grpEl.getBoundingClientRect();
        const before=(e.clientY-r.top) < r.height/2;
        document.querySelectorAll('.bp-group.drop-before,.bp-group.drop-after').forEach(el=>{if(el!==grpEl) el.classList.remove('drop-before','drop-after');});
        grpEl.classList.toggle('drop-before', before);
        grpEl.classList.toggle('drop-after', !before);
      });
      hd.addEventListener('drop', e=>{
        if(!_drag || _drag.type!=='group') return;
        e.preventDefault(); e.stopPropagation();
        const before=grpEl.classList.contains('drop-before');
        grpEl.classList.remove('drop-before','drop-after');
        moveGroup(_drag.id, grp.id, before);
      });

      const innerGrid = document.createElement('div');
      innerGrid.className='bp-group-grid';
      innerGrid.addEventListener('dragover', e=>{
        if(!_drag || _drag.type!=='item') return;
        e.preventDefault();
        if(grp.ids.length===0) innerGrid.classList.add('drag-over');
      });
      innerGrid.addEventListener('dragleave', ()=>innerGrid.classList.remove('drag-over'));
      innerGrid.addEventListener('drop', e=>{
        innerGrid.classList.remove('drag-over');
        if(!_drag || _drag.type!=='item') return;
        e.preventDefault();
        if(grp.ids.includes(_drag.id)) return; // handled by item-level drop already
        // dropped on empty space within this folder -> append to end
        moveItem(_drag.id, _drag.fromGroup, grp.id, grp.ids[grp.ids.length-1], false);
      });

      grp.ids.forEach(id=>{
        const p=findPreset(id);
        if(p) innerGrid.appendChild(makeBpItem(p, grp.id));
      });
      if(grp.ids.length===0){
        const hint=document.createElement('div');
        hint.className='bp-group-empty-hint';
        hint.textContent='Drag brushes here, or use ➕ to add one';
        innerGrid.appendChild(hint);
      }

      grpEl.appendChild(hd);
      grpEl.appendChild(innerGrid);
      grid.appendChild(grpEl);
    });
  }

  //  Reorder folders
  function moveGroup(draggedId, targetId, before){
    const fi=_groups.findIndex(g=>g.id===draggedId);
    if(fi===-1) return;
    const [g]=_groups.splice(fi,1);
    let ti=_groups.findIndex(x=>x.id===targetId);
    if(ti===-1) ti=_groups.length;
    else if(!before) ti+=1;
    _groups.splice(ti,0,g);
    persist();
    buildGrid(_bpSearchVal());
  }

  //  Apply a preset's settings to the tool settings sliders
  function applyPresetSettings(p){
    const s = p.settings;
    if(!('ts-rotation-mode' in s)||s['ts-rotation-mode']==='fixed') s['ts-rotation-mode']='fixed-rotation';
    if(!('ts-angle' in s)) s['ts-angle']=0;
    if(!('ts-tip-roundness' in s)) s['ts-tip-roundness']=100;
    if(!('ts-size-jitter' in s)) s['ts-size-jitter']=0;
    if(!('ts-angle-jitter' in s)) s['ts-angle-jitter']=0;
    if(!('ts-round-jitter' in s)) s['ts-round-jitter']=0;
    if(!('ts-tip-min-roundness' in s)) s['ts-tip-min-roundness']=0;
    if(!('ts-tip-flip-x' in s)) s['ts-tip-flip-x']=false;
    if(!('ts-tip-flip-y' in s)) s['ts-tip-flip-y']=false;
    if(!('ts-scatter-enabled' in s)) s['ts-scatter-enabled']=false;
    if(!('ts-scatter-amount' in s)) s['ts-scatter-amount']=0;
    if(!('ts-scatter-count' in s)) s['ts-scatter-count']=1;
    window._tsScatterBothAxes=s['ts-scatter-both-axes']!==false;
    window.brushTipRoundness=Math.max(0.01,Math.min(1,(s['ts-tip-roundness']??100)/100));
    window.brushTipMinimumRoundness=Math.max(0,Math.min(1,(s['ts-tip-min-roundness']??0)/100));
    window.brushTipRoundnessDynamics=!!s['ts-tip-roundness-dynamics'];
    window.brushTipFlipX=!!s['ts-tip-flip-x'];
    window.brushTipFlipY=!!s['ts-tip-flip-y'];
    window._tsCustomPressureCurves=JSON.parse(JSON.stringify(s['ts-pressure-curves']||{}));
    if(typeof window._refreshPressureCurvePreviews==='function') window._refreshPressureCurvePreviews();
    const spacingMode=document.getElementById('ts-spacing-mode');
    if(spacingMode){
      const savedMode=s['ts-spacing-mode'];
      s['ts-spacing-mode']=(savedMode==='auto'||savedMode==='fixed')?savedMode:'fixed';
    }
    Object.entries(s).forEach(([id,value])=>{
      const control=document.getElementById(id);
      if(!control||!control.matches('#tool-settings-body input:not([type=file]),#tool-settings-body select')) return;
      if(control.type==='checkbox') control.checked=!!value;
      else control.value=value;
    });
    if(spacingMode) spacingMode.dispatchEvent(new Event('input',{bubbles:true}));
    const taperMode=document.getElementById('ts-taper-mode');
    if(taperMode) taperMode.dispatchEvent(new Event('input',{bubbles:true}));
    const mapping = {
      'ts-size': {slider:'ts-size', val:'ts-size-val', suffix:'', extra: v=>{toolSizes[tool]=v; const bpSz=document.getElementById('bp-sz'); if(bpSz)bpSz.value=v; if(typeof refreshSizeUI==='function')refreshSizeUI(); _aaDabCache.clear();_stampCache.clear();}},
      'ts-hardness': {slider:'ts-hardness', val:'ts-hardness-val', suffix:'', extra: v=>{brushHardness=v/100; _aaDabCache.clear();_stampCache.clear();}},
      'ts-opacity': {slider:'ts-opacity', val:'ts-opacity-val', suffix:'', extra: v=>{brushOpacity=v/100;}},
      'ts-flow': {slider:'ts-flow', val:'ts-flow-val', suffix:'', extra: v=>{brushFlow=v/100;}},
      'ts-density': {slider:'ts-density', val:'ts-density-val', suffix:'', extra: v=>{brushDensity=v/100;}},
      'ts-spacing': {slider:'ts-spacing', val:'ts-spacing-val', suffix:'%', extra: v=>{window._tsSpacing=v/100;}},
      'ts-roundness': {slider:'ts-roundness', val:'ts-roundness-val', suffix:'', extra: v=>{window._tsRoundness=v/100; _aaDabCache.clear();_stampCache.clear();}},
      'ts-aa': null,
      'ts-aa-mode': null,
      'ts-airbrush': null,
      'ts-airbrush-rate': {slider:'ts-airbrush-rate', val:'ts-airbrush-rate-val', suffix:'', extra: v=>{window._tsAirbrushRate=v/100;}},
    };
    ['ts-size-pressure-curve','ts-flow-pressure-curve','ts-opacity-pressure-curve'].forEach(id=>{
      const el=document.getElementById(id);if(el){el.value=s[id]||'linear';el.dispatchEvent(new Event('input',{bubbles:true}));}
    });
    Object.entries(s).forEach(([key,val])=>{
      if(key==='ts-pressure-curves') return;
      if(key==='ts-aa-mode'){
        // Only apply an explicit mode if AA is (or will be) enabled; a
        // 'none' from old exports is ignored here since ts-aa itself
        // already governs on/off (see backward-compat mapping below).
        if(val&&val!=='none') window._setBrushAAMode(val);
        return;
      }
      if(key==='ts-aa'){
        // Backward compatibility: legacy boolean. false -> AA mode 'none',
        // true -> AA mode 'medium' (unless a ts-aa-mode value elsewhere in
        // this same settings object overrides it -- handled by relying on
        // object key order: modern saves always include both keys, so
        // ts-aa-mode is processed too and simply wins by being applied
        // after/independently of this boolean's mode side-effect).
        _setBrushAA(!!val);
        return;
      }
      if(key==='ts-airbrush'){
        if(typeof window._setAirbrush==='function') window._setAirbrush(!!val);
        return;
      }
      const m=mapping[key];
      if(m){
        const sl=document.getElementById(m.slider);
        const vl=document.getElementById(m.val);
        if(sl){sl.value=val;}
        if(vl){vl.textContent=val+(m.suffix||'');}
        if(m.extra) m.extra(+val);
      }
    });
    Object.keys(s).forEach(key=>{
      const source=document.getElementById(key);
      if(source&&source.matches('#tool-settings-body input:not([type=file]),#tool-settings-body select')) source.dispatchEvent(new Event('input',{bubbles:true}));
    });
    // Airbrush is a per-preset on/off, like Photoshop/CSP — presets that
    // don't mention it explicitly should switch it off rather than leaking
    // the previous preset's airbrush state.
    if(!('ts-airbrush' in s) && typeof window._setAirbrush==='function') window._setAirbrush(false);

    // Tip image: restore from preset data URL if present; clear if absent.
    // This matches what applyToolPreset does for JSON imports.
    // NEW: 'ts-tip-url'/'ts-texture-url' (a plain relative file path, e.g.
    // 'assets/brush-presets/rough-pencil/tip.png') are supported as an
    // alternative to 'ts-tip-dataurl'/'ts-texture-dataurl' -- Image.src
    // happily loads a real URL exactly like a data: URL, so the SAME
    // _dataURLToCanvas() loader below works unmodified for both. This lets
    // built-in preset packs ship real PNG files on disk (see the
    // Brush-Preset asset-pack loader further down) instead of inlining
    // huge base64 blobs into the JS, while user-saved/exported custom
    // presets keep using data URLs exactly as before.
    const tipSrc=s['ts-tip-dataurl']||s['ts-tip-url'];
    const textureSrc=s['ts-texture-dataurl']||s['ts-texture-url'];
    const tipLoadGeneration=(window._brushTipLoadGeneration||0)+1;
    window._brushTipLoadGeneration=tipLoadGeneration;
    if(tipSrc){
      if(typeof _dataURLToCanvas==='function'){
        _dataURLToCanvas(tipSrc).then(c=>{
          if(window._brushTipLoadGeneration!==tipLoadGeneration) return;
          if(typeof window.setBrushTip==='function') window.setBrushTip(c,s['ts-tip-reference-diameter']);
          if(s['ts-tip-mode']) window.brushTipMode=s['ts-tip-mode'];
          if(s['ts-tip-soft-alpha']!==undefined) window.brushTipSoftAlpha=!!s['ts-tip-soft-alpha'];
          if(typeof window._syncTipUI==='function') window._syncTipUI();
        }).catch(()=>{});
      }
    } else {
      if(typeof window.clearBrushTip==='function') window.clearBrushTip();
      if(typeof window._syncTipUI==='function') window._syncTipUI();
    }

    // Texture image: same pattern.
    if(textureSrc){
      if(typeof _dataURLToCanvas==='function'){
        _dataURLToCanvas(textureSrc).then(c=>{
          if(typeof window.setBrushTexture==='function') window.setBrushTexture(c);
          const depth=s['ts-texture-strength']!=null?(+s['ts-texture-strength']/100):1.0;
          window.brushTextureStrength=depth;
          const buildup=s['ts-texture-buildup-custom']!=null?(+s['ts-texture-buildup-custom']/100):1.0;
          window.brushTextureBuildup=buildup;
          window.brushTextureScale=s['ts-texture-scale']!=null?(+s['ts-texture-scale']/100):1.0;
          window.brushTextureInvert=!!s['ts-texture-invert'];
          window.brushTextureBrightness=s['ts-texture-brightness']!=null?+s['ts-texture-brightness']:0;
          window.brushTextureContrast=s['ts-texture-contrast']!=null?+s['ts-texture-contrast']:0;
          if(typeof window._invalidateTextureCache==='function') window._invalidateTextureCache();
          if(typeof window._syncTextureUI==='function') window._syncTextureUI();
        }).catch(()=>{});
      }
    } else {
      if(typeof window.clearBrushTexture==='function') window.clearBrushTexture();
      if(typeof window._syncTextureUI==='function') window._syncTextureUI();
    }
  }

  //  Snapshot / restore per-tool live settings
  // This is what actually makes Brush and Eraser remember separate presets
  // AND separate manual tweaks (size/hardness/flow/spacing/roundness/AA),
  // since the underlying brushHardness/brushOpacity/brushAA/etc globals are
  // shared by the engine and would otherwise leak between the two tools.
  function rememberToolPresetSize(t,presetId){
    if((t!=='brush'&&t!=='eraser')||!presetId) return;
    _toolPresetSizes[t][presetId]=toolSizes[t];
  }
  function restoreToolPresetSize(t,presetId,fallback){
    const stored=_toolPresetSizes[t][presetId];
    const size=Number.isFinite(+stored)?+stored:+fallback;
    _toolPresetSizes[t][presetId]=size;
    _toolState[t].size=size;
    toolSizes[t]=size;
    const sizeControl=document.getElementById('ts-size');
    if(sizeControl){sizeControl.value=size;sizeControl.dispatchEvent(new Event('input',{bubbles:true}));}
    const presetSize=document.getElementById('bp-sz');
    if(presetSize) presetSize.value=size;
    if(typeof refreshSizeUI==='function') refreshSizeUI();
  }
  function captureLiveState(t){
    if(t!=='brush' && t!=='eraser') return;
    const st=_toolState[t];
    st.size = toolSizes[t];
    rememberToolPresetSize(t,_activePresetId);
    st.hardness = Math.round(brushHardness*100);
    st.opacity = Math.round(brushOpacity*100);
    st.flow = Math.round(brushFlow*100);
    st.density = Math.round(brushDensity*100);
    st.spacing = Math.round(((window._tsSpacing!=null?window._tsSpacing:0.12))*100);
    st.roundness = Math.round(((window._tsRoundness!=null?window._tsRoundness:1))*100);
    st.aa = !!brushAA;
    st.airbrush = !!window._brushAirbrush;
    // Also persist to the active preset's own settings slot so slider tweaks
    // are remembered per-preset independently of other presets
    if(_activePresetId) _captureToPreset(_activePresetId);
    persist();
  }
  function restoreLiveState(t){
    if(t!=='brush' && t!=='eraser') return;
    const presetId=_toolState[t].presetId;
    const preset=findPreset(presetId);
    if(!preset) return;
    _seedPresetSettings(preset,t);
    _activePresetId=presetId;
    const savedSettings=Object.assign({},preset.settings||{},_presetSettings[_presetSettingsKey(presetId,t)]||{});
    // Non-custom presets: structural settings always come from the preset definition.
    const PRESET_STRUCTURAL_KEYS=['ts-taper-mode','ts-start-taper','ts-end-taper','ts-min-size','ts-spacing-mode','ts-texture-scale','ts-texture-strength','ts-texture-buildup-custom','ts-texture-brightness','ts-texture-contrast','ts-texture-invert','ts-texture-each','ts-texture-mode','ts-texture-url'];
    if(!preset.custom && preset.settings){
      PRESET_STRUCTURAL_KEYS.forEach(k=>{ if(k in preset.settings) savedSettings[k]=preset.settings[k]; });
    }
    if(t==='eraser') savedSettings['ts-aa']=true;
    _applyingPresetSettings=true;
    try{
      applyPresetSettings({settings:savedSettings});
      restoreToolPresetSize(t,presetId,savedSettings['ts-size']);

    }finally{_applyingPresetSettings=false;}
  }

  //  Select a preset (always for the currently active tab/tool)
  function selectPreset(id){
    const p = findPreset(id);
    if(!p) return;
    const targetTool = (_activeTab==='eraser') ? 'eraser' : 'brush';
    if(tool!==targetTool) setTool(targetTool, targetTool==='brush'?'Brush':'Eraser');

    // Save the outgoing preset's current slider state before switching away
    if(_activePresetId && _activePresetId !== id){
      rememberToolPresetSize(targetTool,_activePresetId);
      _captureToPreset(_activePresetId);
    }

    // Ensure the incoming preset has its own settings slot (seed from preset.settings if first visit)
    _seedPresetSettings(p,targetTool);

    // Build a merged settings object: preset.settings as base, then any user-saved
    // tweaks on top, so the preset remembers whatever the user last set on it.
    const savedSettings = Object.assign({},p.settings||{},_presetSettings[_presetSettingsKey(p.id,targetTool)]||{});
    // For non-custom (built-in / pack) presets, structural settings defined
    // in the preset itself always win over any stale localStorage capture.
    // This prevents a user accidentally turning off taper on Hard Round and
    // having that stick permanently across sessions — the preset definition
    // is authoritative for these, while cosmetic slider values (size,
    // hardness, flow, opacity) are still freely remembered per-user.
    const PRESET_STRUCTURAL_KEYS=['ts-taper-mode','ts-start-taper','ts-end-taper','ts-min-size','ts-spacing-mode','ts-texture-scale','ts-texture-strength','ts-texture-buildup-custom','ts-texture-brightness','ts-texture-contrast','ts-texture-invert','ts-texture-each','ts-texture-mode','ts-texture-url'];
    if(!p.custom && p.settings){
      PRESET_STRUCTURAL_KEYS.forEach(k=>{ if(k in p.settings) savedSettings[k]=p.settings[k]; });
    }
    if(targetTool==='eraser') savedSettings['ts-aa']=true;
    _activePresetId = id;
    _toolState[targetTool].presetId = id;
    _applyingPresetSettings=true;
    try{
      applyPresetSettings({ settings: savedSettings });
      restoreToolPresetSize(targetTool,id,savedSettings['ts-size']);
    }finally{ _applyingPresetSettings=false; }
    captureLiveState(targetTool);
    persist();
    refreshGrid();
  }

  //  Refresh grid active states
  function refreshGrid(){
    document.querySelectorAll('.bp-item').forEach(el=>{
      el.classList.toggle('active', el.dataset.presetId===_activePresetId);
    });
  }

  //  Brush preset "packs" (folder-based, on-disk assets)
  // File layout on disk (see assets/brush-presets/README.md for the full
  // spec):
  //
  //   assets/brush-presets/<slug>/
  //     tip.png        (optional -- brush tip / stamp shape)
  //     texture.png     (optional -- grain/texture overlay)
  //     settings.json   (required -- name + all the ts-* numeric settings)
  //
  // To add a new preset: drop a new folder in assets/brush-presets/ with
  // that layout, then add its folder name to assets/brush-presets/manifest.json.
  // Nothing else needs to change -- this loader fetches settings.json,
  // wires 'ts-tip-url'/'ts-texture-url' to the sibling PNGs automatically
  // (only if settings.json says they exist), and adds the preset to the
  // General Brushes folder just like a built-in.
  const BRUSH_PRESET_PACKS=['rough-pencil'];
  async function _getBrushPresetPackSlugs(){
    try{
      const res=await fetch('assets/brush-presets/manifest.json',{cache:'no-store'});
      if(!res.ok) throw new Error('manifest fetch failed: '+res.status);
      const json=await res.json();
      if(Array.isArray(json.presets)){
        const slugs=json.presets
          .filter(slug=>typeof slug==='string')
          .map(slug=>slug.trim())
          .filter(Boolean);
        if(slugs.length) return Array.from(new Set(slugs));
      }
    }catch(err){
      console.warn('[brush-presets] failed to load preset manifest; using fallback list:',err);
    }
    return BRUSH_PRESET_PACKS;
  }
  async function _loadBrushPresetPacks(){
    const packSlugs=await _getBrushPresetPackSlugs();
    for(const slug of packSlugs){
      const base=`assets/brush-presets/${slug}/`;
      try{
        const res=await fetch(base+'settings.json');
        if(!res.ok) throw new Error('settings.json fetch failed: '+res.status);
        const json=await res.json();
        const id='pack:'+slug;
        if(allPresets().some(p=>p.id===id)) continue; // already loaded (e.g. hot-reload)
        const settings=builtinBrushSettings(Object.assign({},json.settings||{}));
        if(json.hasTip!==false) settings['ts-tip-url']=base+(json.tipFile||'tip.png');
        if(json.hasTexture!==false && (json.hasTexture||json.textureFile||true)){
          // hasTexture defaults to "try it, ignore failure" since the
          // texture loader below already .catch()es a missing file quietly.
          settings['ts-texture-url']=base+(json.textureFile||'texture.png');
        }
        const preset={
          id, name:json.name||slug, custom:false, pack:slug,
          preview:{ shape:(json.settings&&json.settings['ts-roundness']<60)?'ellipse':'circle',
                    hardness:(json.settings&&json.settings['ts-hardness']!=null)?json.settings['ts-hardness']/100:0.5 },
          settings
        };
        _assetPackPresets.push(preset);
        _seedPresetSettings(preset);
        const general=_groups.find(g=>g.default)||_groups[0];
        if(general && !general.ids.includes(id)) general.ids.push(id);
      }catch(err){
        console.warn('[brush-presets] failed to load preset pack "'+slug+'":',err);
      }
    }
    buildGrid();
  }
  _loadBrushPresetPacks();

  // ── Switch preset panel tab (brush|eraser) — both show the SAME
  //    folders/presets; only the highlighted preset + size bar differ
  function switchTab(toolType){
    _activeTab = toolType;
    document.querySelectorAll('.bp-tool-tab').forEach(t=>{
      t.classList.toggle('active', t.dataset.bpTool===toolType);
    });
    _activePresetId = _toolState[toolType].presetId;
    const bpSearch = document.getElementById('bp-search');
    if(bpSearch) bpSearch.value='';
    buildGrid();
  }

  //  Hook tab buttons
  document.querySelectorAll('.bp-tool-tab').forEach(btn=>{
    btn.onclick=()=>{
      const t=btn.dataset.bpTool;
      if(tool!==t) window.setTool(t,t==='brush'?'Brush':'Eraser');
      else {switchTab(t);restoreLiveState(t);refreshGrid();}
    };
  });

  //  Patch setTool: snapshot the outgoing tool, restore the incoming one
  const _origSetTool = setTool;
  window.setTool = function(t, lbl){
    const prevTool = tool;
    if(prevTool==='brush' || prevTool==='eraser') captureLiveState(prevTool);
    _origSetTool(t, lbl);
    if(t==='brush' || t==='eraser'){
      if(_activeTab!==t){ _activeTab=t; document.querySelectorAll('.bp-tool-tab').forEach(b=>b.classList.toggle('active',b.dataset.bpTool===t)); buildGrid(); }
      restoreLiveState(t);
      refreshGrid();
    }
  };

  //  Add Group / Add Brush
  const addGroupBtn=document.getElementById('bp-add-group');
  if(addGroupBtn) addGroupBtn.onclick=()=>{
    const name=(prompt('Name for the new brush folder:','New Group')||'').trim();
    if(!name) return;
    _groups.push({ id:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), label:name, icon:'📁', default:false, collapsed:false, ids:[] });
    persist();
    buildGrid();
  };
  const addBrushBtn=document.getElementById('bp-add-brush');
  if(addBrushBtn) addBrushBtn.onclick=()=>{
    const name=(prompt('Name this brush preset (saves the current size/hardness/flow/etc):','My Brush')||'').trim();
    if(!name) return;
    const id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
    const sizeEl=document.getElementById('ts-size'), spEl=document.getElementById('ts-spacing'), rdEl=document.getElementById('ts-roundness');
    const size = sizeEl ? +sizeEl.value : toolSizes[tool]||12;
    const hardness = Math.round(brushHardness*100);
    const opacity = Math.round(brushOpacity*100);
    const flow = Math.round(brushFlow*100);
    const density = Math.round(brushDensity*100);
    const spacing = spEl ? +spEl.value : 12;
    const roundness = rdEl ? +rdEl.value : 100;
    const preset = {
      id, name, custom:true,
      preview:{ shape: roundness<60?'ellipse':'circle', hardness: hardness/100, aliased:!brushAA },
      settings:{ 'ts-size':size, 'ts-hardness':hardness, 'ts-opacity':opacity, 'ts-flow':flow, 'ts-density':density, 'ts-spacing':spacing, 'ts-spacing-mode':document.getElementById('ts-spacing-mode')?.value||'fixed', 'ts-rotation-mode':document.getElementById('ts-rotation-mode')?.value||'fixed-rotation', 'ts-angle':+(document.getElementById('ts-angle')?.value||0), 'ts-tip-roundness':+(document.getElementById('ts-tip-roundness')?.value||100), 'ts-tip-flip-x':!!document.getElementById('ts-tip-flip-x')?.checked, 'ts-tip-flip-y':!!document.getElementById('ts-tip-flip-y')?.checked, 'ts-scatter-enabled':!!document.getElementById('ts-scatter-enabled')?.checked, 'ts-scatter-amount':+(document.getElementById('ts-scatter-amount')?.value||0), 'ts-scatter-count':+(document.getElementById('ts-scatter-count')?.value||1), 'ts-roundness':roundness, 'ts-aa':!!brushAA, 'ts-aa-mode':(window.brushAAMode&&window.brushAAMode!=='none'?window.brushAAMode:'medium') }
    };
    _customPresets.push(preset);
    _seedPresetSettings(preset); // give it its own settings slot immediately
    const general = _groups.find(g=>g.default) || _groups[0];
    general.ids.push(id);
    persist();
    buildGrid();
    selectPreset(id);
  };

  //  Import Brush (from .abr)
  // Mirrors the "+ Layer" pattern: the button opens a file picker and,
  // once a tip is chosen from the ABR picker modal, a brand-new preset
  // tile is appended to the grid (in the same folder the "+" brush
  // button uses) so the imported tip sticks around like any other
  // saved preset rather than only affecting the live tool state.
  const importBrushBtn=document.getElementById('bp-import-brush');
  if(importBrushBtn) importBrushBtn.onclick=()=>{
    const fi=document.createElement('input');
    fi.type='file'; fi.accept='.abr';
    fi.onchange=()=>{
      const file=fi.files[0]; if(!file) return;
      const reader=new FileReader();
      reader.onload=event=>{
        try{
          const brushes=parseABR(event.target.result);
          if(!brushes||!brushes.length){
            showInfo('No readable brush tips found in this ABR file.','ABR Import');
            return;
          }
          const fileBase=file.name.replace(/\.abr$/i,'').trim()||'Imported ABR';
          const detectedGroupName=String(brushes.groupName||'').trim();
          const resolvedBaseName=brush=>{
            const parsed=String(brush.name||'').trim().replace(/\s+/g,' ');
            return !parsed||/^(?:ABR )?Brush\s+\d+$/i.test(parsed)?fileBase:parsed;
          };
          const nameCounts=new Map();
          brushes.forEach(brush=>{
            const base=resolvedBaseName(brush);
            const key=base.toLocaleLowerCase();
            nameCounts.set(key,(nameCounts.get(key)||0)+1);
          });
          const nameIndexes=new Map();
          const names=brushes.map(brush=>{
            const base=resolvedBaseName(brush);
            const key=base.toLocaleLowerCase();
            if((nameCounts.get(key)||0)===1) return base;
            const index=(nameIndexes.get(key)||0)+1;
            nameIndexes.set(key,index);
            return base+' '+String(index).padStart(2,'0');
          });

          function createPreset(brush,name,group){
            const id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
            const sizeControl=document.getElementById('ts-size');
            const clampedSize=Math.max(sizeControl?+sizeControl.min:1,Math.min(sizeControl?+sizeControl.max:2000,brush.size));
            const mapped=_mapABRValuesToSettings(brush.values,brush.features);
            const preset={
              id,name,custom:true,
              preview:{shape:'image',hardness:1,aliased:false},
              settings:{
                'ts-size':clampedSize,
                'ts-spacing':Math.min(200,Math.max(1,brush.spacing||25)),
                'ts-spacing-mode':'fixed',
                'ts-rotation-mode':'fixed-rotation',
                'ts-angle':0,
                'ts-scatter-enabled':false,
                'ts-scatter-amount':0,
                'ts-scatter-count':1,
                'ts-tip-dataurl':brush.canvas.toDataURL('image/png'),
                'ts-tip-reference-diameter':brush.referenceDiameter||null,
                'ts-tip-mode':'replace',
                'ts-tip-soft-alpha':true,
                ...mapped
              },
              abrMeta:{
                sourceFile:file.name,
                importedName:brush.name,
                groupName:detectedGroupName||fileBase,
                features:Object.assign({},brush.features||{}),
                values:Object.assign({},brush.values||{}),
                detectedSettings:_abrDetectedSettings(brush,mapped),
                unsupported:_abrUnsupportedList(brush.features)
              }
            };
            _customPresets.push(preset);
            _seedPresetSettings(preset);
            group.ids.push(id);
            return id;
          }

          showABRImportResults(brushes,file.name,()=>{
            if(brushes.length===1){
              showABRPicker(brushes,file.name,brush=>{
                const general=_groups.find(group=>group.default)||_groups[0];
                const id=createPreset(brush,names[0],general);
                persist(); buildGrid(); selectPreset(id);
              });
              return;
            }

            const groupBaseName=detectedGroupName||fileBase;
            let groupName=groupBaseName,groupSuffix=2;
            while(_groups.some(group=>group.label.toLocaleLowerCase()===groupName.toLocaleLowerCase())){
              groupName=groupBaseName+' ('+groupSuffix+++')';
            }
            const group={id:'g'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),label:groupName,icon:'',default:false,collapsed:false,ids:[]};
            _groups.push(group);
            let firstId=null;
            brushes.forEach((brush,index)=>{
              const id=createPreset(brush,names[index],group);
              if(!firstId) firstId=id;
            });
            persist(); buildGrid();
            if(firstId) selectPreset(firstId);
            showInfo('Imported '+brushes.length+' brushes into "'+groupName+'".','ABR Import');
          });
        }catch(error){
          if(/Unsupported ABR version/i.test(error&&error.message||'')){
            showInfo('This ABR version is not supported yet.','ABR Import Error');
          }else{
            showInfo('Could not parse the ABR file: '+error.message,'ABR Import Error');
          }
        }
      };
      reader.readAsArrayBuffer(file);
    };
    fi.click();
  };
  //  Initial state
  buildGrid();
  selectPreset(_toolState.brush.presetId);

  //  Search input
  const bpSearch = document.getElementById('bp-search');
  if(bpSearch){
    bpSearch.addEventListener('input',()=>{
      buildGrid(bpSearch.value);
    });
  }

  //  Size bar (panel)
  const bpSz = document.getElementById('bp-sz');
  const bpSzVal = document.getElementById('bp-sz-val');
  if(bpSz){
    bpSz.addEventListener('input',()=>{
      const v=parseFloat(bpSz.value);
      toolSizes[tool]=v;
      const tsSz=document.getElementById('ts-size'); if(tsSz) tsSz.value=v;
      if(typeof refreshSizeUI==='function') refreshSizeUI(); else if(bpSzVal) bpSzVal.textContent=v;
      if(tool==='brush'||tool==='eraser') captureLiveState(tool);
    });
  }

  // expose for external use
  window._brushPresets = {selectPreset, refreshGrid, switchTab, BRUSH_PRESETS, get groups(){return _groups;}, get customPresets(){return _customPresets;}};

  //  Prevent trackpad/wheel scroll from bubbling up to the canvas
  const bpPanelBody = document.querySelector('#brush-presets-panel .fp-body');
  if(bpPanelBody){
    bpPanelBody.addEventListener('wheel', e=>{ e.stopPropagation(); }, {passive:true});
  }
})();


// TVPaint brush parameter controls
// AA toggle — mirrors TVPaint aliasing=1/0 and Clip Studio AA on/off
(function(){
  const btn=document.getElementById('btn-aa');
  function updateAABtn(){
    btn.classList.toggle('active',brushAA);
    btn.title=brushAA
      ?'Antialiasing ON — sub-pixel smooth edges (TVPaint PenBrush / Clip Studio normal pen). Click to switch to pixel-perfect.'
      :'Antialiasing OFF — hard pixel edges (TVPaint Pencil / Clip Studio pixel pen). Click to switch to smooth.';
    // When AA is off, also snap hardness to 1 for the display; actual hardness is ignored in aliased mode
    document.getElementById('stat-tool').textContent=(tool==='brush'?(brushAA?'Brush':'Pencil'):tool.charAt(0).toUpperCase()+tool.slice(1));
    if(typeof applyTransform==='function') applyTransform();
  }
  btn.onclick=()=>{
    window._setBrushAA(!brushAA);
    const tsAA2=document.getElementById('ts-aa');if(tsAA2)tsAA2.checked=brushAA;
    // Don't let the button keep keyboard focus after the click — otherwise
    // a later Space press (or any other key that can trigger :focus-visible)
    // makes the browser's themed focus ring latch onto this button on top
    // of the .active state outline, and since nothing else blurs it, that
    // extra ring just stays there forever even as AA keeps toggling fine.
    btn.blur();
  };
  updateAABtn();
})();
document.getElementById('onion-chk').onchange=updateOnion;

//
// ABR FEATURE DETECTION — best-effort compatibility scan
// Full Photoshop brush descriptors (scattering, dual brush, texture,
// dynamics, transfer, smoothing, etc.) are deeply-nested variable-length
// binary structures that are impractical to fully parse reliably (see the
// note above parseABR). But Photoshop descriptors store each brush
// engine's class/key name as plain text right in the file — 4-char ASCII
// OSType keys (e.g. "Opct", "Hrdn") for values, and full UTF-16BE class
// names (e.g. "Scattering", "Dual Brush") for feature sections — so a
// lightweight text scan can reliably detect *presence* of a feature even
// without parsing its exact parameter tree. This never blocks or fails
// the tip import itself; it only powers the compatibility report.
//
// Each entry maps one Photoshop brush concept to this app's real control:
//   `applied`  : true  -> _extractABRDescriptorValues (below) can pull an
//                         actual value out of the file for this one, and
//                         it gets pushed into the matching control.
//                false -> we can only detect *presence*, never a value.
//   `uiStatus` : reflects THIS app's own control, independent of the file:
//     'implemented' -> live/wired control on the Tool Settings panel
//     'coming_soon' -> control exists in the UI but is disabled (see the
//                      ts-soon-badge / _tsNotImplemented list above)
//     'none'        -> no equivalent control at all
//
const _ABR_FEATURE_MAP = {
  size:        { label:'Size (Diameter)',      needles:['Dmtr'],                          control:'ts-size',        applied:true,  uiStatus:'implemented' },
  spacing:     { label:'Spacing',               needles:['Spcn'],                          control:'ts-spacing',     applied:true,  uiStatus:'implemented' },
  hardness:    { label:'Hardness',              needles:['Hrdn'],                          control:'ts-hardness',    applied:false, uiStatus:'implemented', sampledInapplicable:true },
  opacity:     { label:'Opacity',               needles:['Opct'],                          control:'ts-opacity',     applied:true,  uiStatus:'implemented' },
  flipX:       { label:'Flip X',                needles:['Flip X','flipX'],                control:'ts-tip-flip-x',  applied:true,  uiStatus:'implemented' },
  flipY:       { label:'Flip Y',                needles:['Flip Y','flipY'],                control:'ts-tip-flip-y',  applied:true,  uiStatus:'implemented' },
  flow:        { label:'Flow',                  needles:['Flow'],                          control:'ts-flow',        applied:true,  uiStatus:'implemented' },
  angle:       { label:'Angle',                 needles:['Angl'],                          control:'ts-angle',       applied:true,  uiStatus:'implemented' },
  angleDynamics:{label:'Angle Dynamics', needles:['angleDynamics'], control:'ts-rotation-mode', applied:false, uiStatus:'implemented' },
  roundness:   { label:'Roundness',             needles:['Rndn'],                          control:'ts-tip-roundness', applied:true, uiStatus:'implemented' },
  scatter:     { label:'Scatter',               needles:['useScatter'],                    control:'ts-scatter-enabled', applied:true, uiStatus:'implemented', valueKey:'useScatter' },
  scatterAmount:{label:'Scatter Amount',         needles:['useScatter','Spcn'],             control:'ts-scatter-amount', applied:true, uiStatus:'implemented', valueKey:'scatterAmount' },
  scatterBoth: { label:'Scatter - Both Axes',   needles:['bothAxes'],                      control:null, applied:false, uiStatus:'none', metadataOnly:true, valueKey:'scatterBothAxes' },
  count:       { label:'Scatter Count',         needles:['Cnt'],                           control:'ts-scatter-count', applied:true, uiStatus:'implemented', valueKey:'scatterCount' },
  countJitter: { label:'Scatter Count Jitter',  needles:['countDynamics'],                 control:null, applied:false, uiStatus:'none', metadataOnly:true, valueKey:'countJitter' },
  scatterDynamics:{label:'Scatter Dynamics',    needles:['scatterDynamics'],               control:null, applied:false, uiStatus:'none', metadataOnly:true, valueKey:'scatterDynamics' },
  texture:     { label:'Texture',               needles:['Texture'],                       control:'ts-texture',     applied:false, uiStatus:'coming_soon' },
  sizeJitter:  { label:'Size Jitter (Shape Dynamics)', needles:['Shape Dynamics','sizeJitter','useTipDynamics','szVr'], control:'ts-size-jitter', applied:true, uiStatus:'implemented' },
  angleJitter: { label:'Angle Jitter',           needles:['angleJitter'],                   control:'ts-angle-jitter', applied:true, uiStatus:'implemented' },
  roundJitter: { label:'Roundness Jitter',       needles:['roundnessJitter'],               control:'ts-round-jitter', applied:true, uiStatus:'implemented' },
  colorDynamics:{label:'Color Dynamics',         needles:['Color Dynamics'],                control:'ts-hue-jitter',  applied:false, uiStatus:'coming_soon' },
  transfer:    { label:'Transfer (Opacity/Flow Jitter)', needles:['Transfer'],              control:'ts-min-flow',    applied:false, uiStatus:'coming_soon' },
  smoothing:   { label:'Smoothing',              needles:['Smoothing'],                     control:'ts-stabilize-mode', applied:false, uiStatus:'coming_soon' },
  dualBrush:   { label:'Dual Brush',             needles:['Dual Brush'],                    control:null, applied:false, uiStatus:'none' },
  noise:       { label:'Noise',                  needles:['Noise'],                         control:null, applied:false, uiStatus:'none' },
  wetEdges:    { label:'Wet Edges',               needles:['Wet Edges'],                     control:null, applied:false, uiStatus:'none' },
  buildUp:     { label:'Build-up (Airbrush mode)',needles:['buildUp'],                       control:'ts-airbrush', applied:false, uiStatus:'implemented' },
  protectTex:  { label:'Protect Texture',         needles:['Protect Texture'],               control:null, applied:false, uiStatus:'none' },
  brushGroup:  { label:'Brush Pose / Tilt Scale', needles:['Brush Pose','tiltScale'],        control:null, applied:false, uiStatus:'none' }
};

// Decode the buffer once as UTF-16BE text (Photoshop's descriptor string
// encoding) and search it for each feature's known substrings. Falls back
// to a manual big-endian decode if TextDecoder('utf-16be') isn't available.
function _scanABRFeatures(buffer) {
  let text = '';
  try {
    text = new TextDecoder('utf-16be').decode(buffer);
  } catch (e) {
    const u = new Uint8Array(buffer);
    const chars = new Array(Math.floor(u.length / 2));
    for (let i = 0; i < chars.length; i++) chars[i] = String.fromCharCode((u[i*2] << 8) | u[i*2+1]);
    text = chars.join('');
  }
  // Also scan the raw bytes as plain ASCII — the 4-char OSType value keys
  // (Dmtr, Spcn, Hrdn, Opct, Angl, Rndn, ...) are stored as ASCII, not
  // UTF-16, so a UTF-16BE-only scan misses them entirely.
  let ascii = '';
  try { ascii = new TextDecoder('latin1').decode(buffer); } catch (e) {}
  const detected = {};
  for (const key in _ABR_FEATURE_MAP) {
    const f = _ABR_FEATURE_MAP[key];
    detected[key] = f.needles.some(n => text.indexOf(n) !== -1 || (ascii && ascii.indexOf(n) !== -1));
  }
  return detected;
}

// Best-effort extraction of actual numeric values for the handful of
// settings we can apply (size/spacing come from the sampled-tip header
// already; opacity/hardness live in the surrounding Photoshop descriptor
// as short ASCII OSType keys followed by a typed value: `doub` = raw
// 8-byte double, `UntF` = 4-byte unit code + 8-byte double — the format
// Photoshop uses for percent/angle unit fields like Opct/Hrdn/Angl/Rndn).
// This is intentionally simple pattern-matching, not a full descriptor
// parser — it returns the FIRST match in the file, which is correct for
// single-tip files and a reasonable best-effort default for multi-tip
// files (each tile can still be fine-tuned manually after import).
function _extractABRDescriptorValues(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const n = bytes.length;
  function keyAt(off, k) {
    return off >= 0 && off + 4 <= n &&
      bytes[off]===k.charCodeAt(0) && bytes[off+1]===k.charCodeAt(1) &&
      bytes[off+2]===k.charCodeAt(2) && bytes[off+3]===k.charCodeAt(3);
  }
  function valueAfterKey(off) {
    if (keyAt(off, 'doub') && off+12<=n) { const v=dv.getFloat64(off+4,false); return isFinite(v)?v:null; }
    if (keyAt(off, 'UntF') && off+16<=n) { const v=dv.getFloat64(off+8,false); return isFinite(v)?v:null; }
    return null;
  }
  function findFirst(key) {
    for (let i=0;i<n-12;i++) { if (keyAt(i,key)) { const v=valueAfterKey(i+4); if (v!=null) return v; } }
    return null;
  }
  function findSequence(sequence) {
    const ascii=Array.from(sequence,ch=>ch.charCodeAt(0));
    const utf16=[];
    for(const code of ascii) utf16.push(0,code);
    for(const pattern of [ascii,utf16]){
      outer:for(let i=0;i<=n-pattern.length;i++){
        for(let j=0;j<pattern.length;j++) if(bytes[i+j]!==pattern[j]) continue outer;
        return i;
      }
    }
    return -1;
  }
  function findLongAfter(marker,key) {
    const start=findSequence(marker);
    if(start<0) return null;
    const end=Math.min(n-12,start+8192);
    for(let i=start;i<=end;i++){
      if(!keyAt(i,key)) continue;
      if(keyAt(i+4,'long')&&i+12<=n) return dv.getInt32(i+8,false);
    }
    return null;
  }
  function findBoolean(marker) {
    const start=findSequence(marker);
    if(start<0) return null;
    const end=Math.min(n-5,start+128);
    for(let i=start;i<=end;i++){
      if(keyAt(i,'bool')&&i+5<=n) return bytes[i+4]!==0;
    }
    return null;
  }
  function findNumber(marker) {
    const start=findSequence(marker);
    if(start<0) return null;
    const end=Math.min(n-16,start+256);
    for(let i=start;i<=end;i++){
      const value=valueAfterKey(i);
      if(value!=null) return value;
    }
    return null;
  }
  function findNumberAfter(marker,key) {
    const start=findSequence(marker);
    if(start<0) return null;
    const end=Math.min(n-16,start+1024);
    for(let i=start;i<=end;i++){
      if(!keyAt(i,key)) continue;
      const value=valueAfterKey(i+4);
      if(value!=null) return value;
    }
    return null;
  }
  // The brush preset's display name ("soft strokes", etc.) is stored as a
  // descriptor key too, but unlike Dmtr/Spcn/Angl/Rndn (fixed 4-char OSType
  // keys) the `Nm` key is a variable-length ASCII key: a 4-byte length
  // (here always 2, for "Nm"), then the key bytes themselves, then a 4-byte
  // type code ('TEXT'), then a 4-byte string length and the UTF-16BE
  // characters. The very first `Nm`/TEXT pair in the file is the top-level
  // brushPreset's own name — any later ones belong to nested objects (e.g.
  // the sampled tip's own auto-generated name) — so returning on first
  // match is exactly what's needed here, matching findFirst() above.
  function findName() {
    function readText(typeOff){
      if(!keyAt(typeOff,'TEXT')||typeOff+8>n) return null;
      const strLen=dv.getUint32(typeOff+4,false);
      const charsOff=typeOff+8;
      if(strLen<=0||strLen>500||charsOff+strLen*2>n) return null;
      let str='';
      for(let c=0;c<strLen;c++){
        const code=dv.getUint16(charsOff+c*2,false);
        if(code!==0) str+=String.fromCharCode(code);
      }
      str=str.trim();
      return str||null;
    }
    for(let i=0;i<n-14;i++){
      if(dv.getUint32(i,false)===2&&bytes[i+4]===0x4e&&bytes[i+5]===0x6d){
        const name=readText(i+6);
        if(name) return name;
      }
      if(bytes[i]===0x4e&&bytes[i+1]===0x6d){
        for(let typeOff=i+2;typeOff<=Math.min(i+12,n-8);typeOff++){
          const name=readText(typeOff);
          if(name) return name;
        }
      }
    }
    return null;
  }
  return {
    name:      findName(),
    diameter:  findFirst('Dmtr'),
    spacing:   findFirst('Spcn'),
    opacity:   findFirst('Opct'),
    flow:      findFirst('Flow'),
    hardness:  findFirst('Hrdn'),
    angle:     findFirst('Angl'),
    roundness: findFirst('Rndn'),
    angleDynamicsType: findLongAfter('angleDynamics','bVTy'),
    useBrushSize: findBoolean('useBrushSize'),
    useTipDynamics: findBoolean('useTipDynamics'),
    sizeVariation: findNumber('szVr'),
    minimumDiameter: findNumber('minimumDiameter'),
    minimumRoundness: findNumber('minimumRoundness'),
    roundnessDynamics: findBoolean('useRoundnessDynamics'),
    // "jitter" is stored under each *Dynamics descriptor block (szVr/angleDynamics/
    // roundnessDynamics all share the same brVr sub-structure with a 'jitter' key) --
    // reuse findNumberAfter the same way scatter/count jitter already do above.
    angleJitter: findNumberAfter('angleDynamics','jitter'),
    roundnessJitter: findNumberAfter('roundnessDynamics','jitter'),
    useScatter: findBoolean('useScatter'),
    scatterAmount: findNumberAfter('useScatter','Spcn'),
    scatterCount: findNumber('Cnt'),
    scatterBothAxes: findBoolean('bothAxes'),
    countDynamicsType: findLongAfter('countDynamics','bVTy'),
    countJitter: findNumber('countDynamics'),
    scatterDynamicsType: findLongAfter('scatterDynamics','bVTy'),
    scatterJitter: findNumber('scatterDynamics'),
    flipX: findBoolean('flipX'),
    flipY: findBoolean('flipY')
  };
}

//
// ABR → INTERNAL PARAMETER MAPPING LAYER
// Single source of truth converting extracted ABR descriptor values
// (see _extractABRDescriptorValues) into this app's internal brush-engine
// control ids. Only emits entries for settings this app actually has a
// LIVE, wired control for (_ABR_FEATURE_MAP[key].applied===true) — every
// Photoshop-specific setting without a real effect here (scattering, dual
// brush, texture, dynamics jitter, transfer, smoothing, etc.) is skipped
// gracefully rather than guessed at. Both import entry points (the ABR
// picker tile click and the "Import Brush" preset flow) route through
// this + _applyABRSettingsToUI so there is exactly one place that knows
// how an ABR value becomes an internal setting.
//
function _mapABRValuesToSettings(values, features) {
  const v = values || {};
  const f = features || {};
  const out = {};
  const hasSizeDynamics=v.useTipDynamics===true&&Number(v.sizeVariation)>0;
  if(v.useBrushSize===true||hasSizeDynamics) out['ts-size-control']='pressure';
  else if(v.useBrushSize===false||v.useTipDynamics===false) out['ts-size-control']='off';
  if(v.minimumDiameter!=null) out['ts-min-size']=Math.max(0,Math.min(100,Math.round(Number(v.minimumDiameter))));
  if(v.roundness!=null) out['ts-tip-roundness']=Math.max(1,Math.min(100,Number(v.roundness)));
  if(v.minimumRoundness!=null) out['ts-tip-min-roundness']=Math.max(0,Math.min(100,Number(v.minimumRoundness)));
  if(typeof v.roundnessDynamics==='boolean') out['ts-tip-roundness-dynamics']=v.roundnessDynamics;
  // Shape Dynamics jitter: Photoshop's Size Jitter reuses the szVr number
  // already extracted as sizeVariation; Angle/Roundness Jitter come from
  // their own *Dynamics descriptor blocks above.
  if(hasSizeDynamics&&v.sizeVariation!=null) out['ts-size-jitter']=Math.max(0,Math.min(100,Number(v.sizeVariation)));
  if(v.angleJitter!=null) out['ts-angle-jitter']=Math.max(0,Math.min(100,Number(v.angleJitter)));
  if(v.roundnessJitter!=null) out['ts-round-jitter']=Math.max(0,Math.min(100,Number(v.roundnessJitter)));
  if(typeof v.flipX==='boolean') out['ts-tip-flip-x']=v.flipX;
  if(typeof v.flipY==='boolean') out['ts-tip-flip-y']=v.flipY;
  if(typeof v.useScatter==='boolean') out['ts-scatter-enabled']=v.useScatter;
  if(v.scatterJitter!=null||v.scatterAmount!=null) out['ts-scatter-amount']=Math.max(0,Math.min(100,Number(v.scatterJitter??v.scatterAmount)));
  if(v.scatterCount!=null) out['ts-scatter-count']=Math.max(1,Math.min(50,Math.round(Number(v.scatterCount))-1));
  if(typeof v.scatterBothAxes==='boolean') out['ts-scatter-both-axes']=v.scatterBothAxes;
  if(v.angleDynamicsType===6) out['ts-rotation-mode']='stroke-direction';
  else out['ts-rotation-mode']='fixed-rotation';
  // Hardness intentionally NOT mapped: this parser only ever extracts
  // sampled (raster) tips, and Photoshop's own descriptor format only
  // stores Hrdn on procedural "computedBrush" presets — it's explicitly
  // deleted when a brush becomes a sampledBrush, so it has no meaning on
  // an image-based tip. See _ABR_FEATURE_MAP.hardness.sampledInapplicable
  // and showABRImportResults, which surfaces this explicitly instead of
  // silently overwriting the user's Hardness with an irrelevant value.
  if (v.opacity != null) out['ts-opacity'] = Math.max(1, Math.min(100, Math.round(v.opacity)));
  if (v.flow != null) out['ts-flow'] = Math.max(1, Math.min(100, Math.round(v.flow)));
  if (v.angle != null) out['ts-angle'] = ((-Math.round(v.angle) % 360) + 360) % 360;
  return out;
}

// Applies size (px) + spacing (%) + a mapped-settings object (from
// _mapABRValuesToSettings) to the live Tool Settings / Brush Presets UI
// and underlying state, dispatching 'input' on every touched control so
// caches, presets, and other listeners react exactly as if the user had
// dragged the slider themselves. Returns the clamped size actually used.
function _applyABRSettingsToUI(size, spacing, settings) {
  const tsSz = document.getElementById('ts-size');
  const bpSz = document.getElementById('bp-sz');
  const clampedSize = Math.max(tsSz?+tsSz.min:1, Math.min(tsSz?+tsSz.max:2000, size));
  if (tsSz) { tsSz.value = clampedSize; tsSz.dispatchEvent(new Event('input')); }
  if (bpSz) { bpSz.value = clampedSize; bpSz.dispatchEvent(new Event('input')); }
  if (typeof toolSizes !== 'undefined' && typeof tool !== 'undefined') toolSizes[tool] = clampedSize;

  const spcEl = document.getElementById('ts-spacing');
  if (spcEl && spacing != null) {
    spcEl.value = Math.min(200, Math.max(1, spacing));
    spcEl.dispatchEvent(new Event('input'));
  }

  for (const ctrlId in (settings || {})) {
    if(ctrlId==='ts-scatter-both-axes'){window._tsScatterBothAxes=settings[ctrlId]!==false;continue;}
    if(ctrlId==='ts-tip-roundness-dynamics'){window.brushTipRoundnessDynamics=!!settings[ctrlId];continue;}
    const el = document.getElementById(ctrlId);
    if (!el) continue;
    if(el.type==='checkbox') el.checked=!!settings[ctrlId];
    else el.value=settings[ctrlId];
    el.dispatchEvent(new Event('input'));
  }

  if (typeof window._syncTipUI === 'function') window._syncTipUI();
  if (typeof window.refreshSizeUI === 'function') window.refreshSizeUI();

  return clampedSize;
}

// List of detected-but-unsupported ABR features, kept separately (rather
// than discarded) so a brush's abrMeta can be inspected later if support
// for one of these is added — see _ABR_FEATURE_MAP for the full catalog.
function _abrDetectedSettings(brush, mappedSettings) {
  const features=brush.features||{};
  const values=brush.values||{};
  return {
    size:brush.size??null,
    diameter:values.diameter??null,
    spacing:brush.spacing??null,
    opacity:values.opacity??null,
    useBrushSize:typeof values.useBrushSize==='boolean'?values.useBrushSize:null,
    useTipDynamics:typeof values.useTipDynamics==='boolean'?values.useTipDynamics:null,
    sizeVariation:values.sizeVariation??null,
    minimumDiameter:values.minimumDiameter??null,
    flow:values.flow??null,
    angle:values.angle??null,
    roundness:values.roundness??null,
    minimumRoundness:values.minimumRoundness??null,
    roundnessDynamics:typeof values.roundnessDynamics==='boolean'?values.roundnessDynamics:null,
    scatter:typeof values.useScatter==='boolean'?values.useScatter:!!features.scatter,
    scatterAmount:values.scatterAmount??null,
    scatterBothAxes:typeof values.scatterBothAxes==='boolean'?values.scatterBothAxes:!!features.scatterBoth,
    scatterCount:values.scatterCount??null,
    countJitter:values.countJitter??null,
    countDynamics:{controlType:values.countDynamicsType??null,jitter:values.countJitter??null},
    scatterDynamics:{controlType:values.scatterDynamicsType??null,jitter:values.scatterJitter??null},
    flipX:typeof values.flipX==='boolean'?values.flipX:!!features.flipX,
    flipY:typeof values.flipY==='boolean'?values.flipY:!!features.flipY,
    texture:!!features.texture,
    angleDynamics:!!features.angleDynamics,
    angleDynamicsType:values.angleDynamicsType??null,
    mappedSettings:Object.assign({},mappedSettings||{})
  };
}

function _abrUnsupportedList(features) {
  const f = features || {};
  const list = [];
  for (const key in _ABR_FEATURE_MAP) {
    if (!f[key]) continue;
    const entry = _ABR_FEATURE_MAP[key];
    if (entry.applied||entry.metadataOnly) continue;
    list.push({ key, label: entry.label, uiStatus: entry.uiStatus });
  }
  return list;
}


// Supports ABR v1/v2 (CS and earlier) and v6/v10 (CS2 through CC).
// Only "sampled" brush tips carry raster pixel data; computed tips
// (procedural / circular) produce a null imageData and are omitted
// from the picker so the user never gets a blank tile.
//
// The v6/v10 layout wraps each sampled tip's raw bounds/depth/
// compression fields in a large, deeply-nested Photoshop descriptor
// (variable-length, version-dependent). Parsing that descriptor tree
// generically is fragile — real files vary enough that a full parser
// misses many of them (this is what caused "No readable brush tips
// found" for otherwise-normal files). Every working ABR reader we
// could find instead skips a small FIXED number of header bytes to
// land directly on the bounds fields — 47 bytes for the older v6.1
// layout, 301 bytes for v6.2/CS6+ — falling back to a short local
// scan if neither fixed offset lines up. That approach is used here.
//

/**
 * Parse an ArrayBuffer containing an ABR file.
 * Returns an array of brush-tip objects:
 *   { name, size, spacing, canvas }
 * `canvas` is an HTMLCanvasElement whose alpha channel encodes the
 * brush tip grayscale mask — white = full paint, black = transparent
 * — exactly what setBrushTip() expects.
 */
function parseABR(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  function eof(n) { return offset + n > buffer.byteLength; }
  function readUint8()  { if (eof(1)) throw new Error('Unexpected end of file'); const v = dv.getUint8(offset); offset += 1; return v; }
  function readInt16()  { if (eof(2)) throw new Error('Unexpected end of file'); const v = dv.getInt16(offset, false); offset += 2; return v; }
  function readUint16() { if (eof(2)) throw new Error('Unexpected end of file'); const v = dv.getUint16(offset, false); offset += 2; return v; }
  function readInt32()  { if (eof(4)) throw new Error('Unexpected end of file'); const v = dv.getInt32(offset, false); offset += 4; return v; }
  function readUint32() { if (eof(4)) throw new Error('Unexpected end of file'); const v = dv.getUint32(offset, false); offset += 4; return v; }
  function skipBytes(n) { offset += n; }
  function remaining()  { return buffer.byteLength - offset; }
  function readKey4() {
    if (eof(4)) return '';
    const s = String.fromCharCode(bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]);
    offset += 4;
    return s;
  }
  function readUCS2Text() {
    const length = readInt32() * 2;
    if (length <= 0) return '';
    if (eof(length)) throw new Error('Unexpected end of file');
    let str = '';
    for (let i = 0; i < length; i += 2) {
      const code = dv.getUint16(offset + i, false);
      if (code !== 0) str += String.fromCharCode(code);
    }
    offset += length;
    return str;
  }

  // ── Classic ABR "RLE" (PackBits) decode: `height` scanlines, each
  //    `bytesPerRow` bytes wide once decoded. Matches the format used
  //    by every ABR version for compressed sampled-tip data.
  function abrRleDecode(height, bytesPerRow) {
    const scanlineLengths = [];
    for (let i = 0; i < height; i++) scanlineLengths.push(readInt16());
    const out = new Uint8Array(height * bytesPerRow);
    let dataPos = 0;
    for (let i = 0; i < height; i++) {
      let j = 0;
      const rowLen = scanlineLengths[i];
      while (j < rowLen) {
        let n = readUint8(); j += 1;
        if (n >= 128) n -= 256;
        if (n < 0) {
          if (n === -128) continue; // NOP
          n = -n + 1;
          const ch = readUint8(); j += 1;
          for (let c = 0; c < n; c++) { if (dataPos < out.length) out[dataPos++] = ch; }
        } else {
          for (let c = 0; c < n + 1; c++) {
            const ch = readUint8(); j += 1;
            if (dataPos < out.length) out[dataPos++] = ch;
          }
        }
      }
    }
    return out;
  }

  function bytesPerRowFor(width, depth) {
    return depth === 1 ? Math.ceil(width / 8) : Math.round(width * depth / 8);
  }

  // ── Convert whatever bit depth the tip was stored at into an 8-bit
  //    grayscale byte array. `raw` must be sized bytesPerRow*height.
  function toGrayscale8(raw, width, height, depth) {
    if (!raw) return null;
    if (depth === 8) return raw;
    if (depth === 16) {
      const out = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) out[i] = raw[i * 2]; // high byte, big-endian
      return out;
    }
    if (depth === 1) {
      const out = new Uint8Array(width * height);
      const rowBytes = Math.ceil(width / 8);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const byteVal = raw[row * rowBytes + (col >> 3)];
          const bit = 7 - (col & 7);
          out[row * width + col] = ((byteVal >> bit) & 1) ? 0 : 255;
        }
      }
      return out;
    }
    return null; // unsupported depth (e.g. 24/32-bit colour sampled tips)
  }

  // Convert a grayscale brush mask to a canvas alpha mask.
  // Light pixels paint; dark pixels are transparent.
  function grayscaleToTipCanvas(pixels, w, h) {
    const TRANSPARENT_THRESHOLD = 5;
    let minX=w,minY=h,maxX=-1,maxY=-1;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      if(pixels[y*w+x] > TRANSPARENT_THRESHOLD){
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      }
    }
    if(maxX<minX||maxY<minY){minX=0;minY=0;maxX=w-1;maxY=h-1;}
    const cropW=maxX-minX+1,cropH=maxY-minY+1;
    const c=document.createElement('canvas');c.width=cropW;c.height=cropH;
    const ctx2=c.getContext('2d');
    const id=ctx2.createImageData(cropW,cropH),d=id.data;
    for(let y=0,p=0;y<cropH;y++) for(let x=0;x<cropW;x++,p+=4){
      const raw=pixels[(minY+y)*w+minX+x];
      const alpha=raw<=TRANSPARENT_THRESHOLD?0:raw;
      d[p]=d[p+1]=d[p+2]=255; d[p+3]=alpha;
    }
    ctx2.putImageData(id,0,0);
    return c;
  }
  // ── Read one sampled tip's raw pixel data, already positioned right
  //    after top/left/bottom/right/depth/compression have been read.
  function readSampledPixels(width, height, depth, compressed) {
    const bytesPerRow = bytesPerRowFor(width, depth);
    let raw;
    if (!compressed) {
      const dataSize = bytesPerRow * height;
      if (eof(dataSize)) return null;
      raw = bytes.slice(offset, offset + dataSize);
      offset += dataSize;
    } else {
      raw = abrRleDecode(height, bytesPerRow);
    }
    return toGrayscale8(raw, width, height, depth);
  }

  if (buffer.byteLength < 4) throw new Error('File too small to be ABR');
  const version = readUint16();
  const countOrSub = readUint16();
  const brushes = [];

  //
  //  ABR v1 / v2  (Photoshop ≤ CS)
  //
  if (version === 1 || version === 2) {
    for (let i = 0; i < countOrSub && remaining() > 0; i++) {
      try {
        const brushType = readUint16();
        const brushSize = readUint32();
        const blockEnd = offset + brushSize;
        if (brushType !== 2) { offset = blockEnd; continue; } // skip computed brushes

        /*misc*/ readInt32();
        const spacing = readInt16();
        let name = '';
        if (version === 2) name = readUCS2Text();
        /*antialiasing*/ readUint8();
        // Legacy 16-bit bounds — unused; the real bounds are the 32-bit ones below
        readInt16(); readInt16(); readInt16(); readInt16();
        const top = readInt32(), left = readInt32(), bottom = readInt32(), right = readInt32();
        const depth = readInt16();
        const width = right - left, height = bottom - top;
        if (height > 16384 || width <= 0 || height <= 0) { offset = blockEnd; continue; }
        const compressed = readUint8();

        const pixels = readSampledPixels(width, height, depth, compressed);
        if (pixels) {
          brushes.push({
            name: name || ('Brush ' + (i + 1)),
            size: Math.max(width, height),
            spacing: spacing || 25,
            canvas: grayscaleToTipCanvas(pixels, width, height)
          });
        }
        offset = blockEnd;
      } catch (e) { break; }
    }

  //
  //  ABR v6 (CS2+) / v10 (CS6+) — descriptor-wrapped sampled tips
  //
  } else if (version === 6 || version === 10) {

    function reachSection(key) {
      while (remaining() >= 8) {
        const marker = readKey4();
        if (marker !== '8BIM') return false;
        const sectionKey = readKey4();
        if (sectionKey === key) return true;
        const size = readUint32();
        skipBytes(size);
      }
      return false;
    }

    // ── Pass 1: extract all per-tip names from the 8BIM 'desc' section ──
    // The 'desc' section is a Photoshop descriptor tree that holds the
    // complete brush-preset definitions for every tip in the file, in the
    // same order as the pixel blocks inside 'samp'. Each brush preset is a
    // sub-descriptor that contains an 'Nm  ' or 'Nm' TEXT key with the
    // brush's display name. Collecting all TEXT values in file order gives
    // us the per-tip name list; we then apply names[i] to samp tip i.
    let tipNamesFromDesc = [];
    {
      const savedOffset = offset;
      if (reachSection('desc')) {
        const descSize = readUint32();
        const descStart = offset;
        const descEnd   = Math.min(descStart + descSize, buffer.byteLength);
        const dscBytes  = new Uint8Array(buffer, descStart, descEnd - descStart);
        const dscDv     = new DataView(buffer, descStart, descEnd - descStart);
        const dscLen    = dscBytes.length;

        // Associate names only with descriptors that actually reference
        // sampledData. This avoids shifting names when computed brushes or
        // nested Sampled Brush labels appear between sampled image tips.
        let pendingPresetName=null;
        for(let textOff=0;textOff<dscLen-8;textOff++){
          if(dscBytes[textOff]!==0x54||dscBytes[textOff+1]!==0x45||dscBytes[textOff+2]!==0x58||dscBytes[textOff+3]!==0x54) continue;
          const stringLength=dscDv.getUint32(textOff+4,false);
          if(stringLength<=0||stringLength>500||textOff+8+stringLength*2>dscLen) continue;
          let value='';
          for(let character=0;character<stringLength;character++){
            const code=dscDv.getUint16(textOff+8+character*2,false);
            if(code!==0) value+=String.fromCharCode(code);
          }
          value=value.trim().replace(/\s+/g,' ');
          let key='',cursor=textOff-1;
          while(cursor>=0&&dscBytes[cursor]>=32&&dscBytes[cursor]<=126&&key.length<50){
            key=String.fromCharCode(dscBytes[cursor--])+key;
          }
          key=key.trim();
          if(/(?:^|\s)Nm$/.test(key)){
            if(value&&!/^Sampled Brush\s+\d+$/i.test(value)) pendingPresetName=value;
          }else if(/sampledData$/.test(key)&&pendingPresetName){
            tipNamesFromDesc.push(pendingPresetName);
            pendingPresetName=null;
          }
          textOff+=8+stringLength*2-1;
        }
      }
      offset = savedOffset; // restore so reachSection('samp') scans from the start
    }

    if (!reachSection('samp')) {
      throw new Error('Could not find a sampled-brush ("samp") section in this ABR file.');
    }
    const sampSize = readUint32();
    const sampEnd = offset + sampSize;
    let index = 0;

    while (offset < sampEnd - 4) {
      let brushSize;
      try { brushSize = readUint32(); } catch (e) { break; }
      let padded = brushSize; while (padded % 4 !== 0) padded++;
      const nextBrush = offset + padded;
      if (nextBrush > buffer.byteLength || nextBrush <= offset) break;

      // Each sampled tip is preceded by a Photoshop descriptor whose
      // length depends on the ABR sub-format. Rather than parse it, jump
      // straight to where the bounds live: 47 bytes in for the v6.1
      // layout, 301 bytes in for v6.2/CS6+. If the file's declared
      // sub-format doesn't match either known offset, scan a bit further
      // for a plausible bounds+depth pattern before giving up on this tip.
      const headerStart = offset;
      const fixedOffsets = countOrSub === 1 ? [47] : countOrSub === 2 ? [301] : [301, 47];
      let boundsOffset = -1;
      for (const skip of fixedOffsets) {
        const tryOff = headerStart + skip;
        if (tryOff + 19 > nextBrush || tryOff + 19 > buffer.byteLength) continue;
        const top = dv.getInt32(tryOff, false), left = dv.getInt32(tryOff+4, false),
              bottom = dv.getInt32(tryOff+8, false), right = dv.getInt32(tryOff+12, false),
              depth = dv.getUint16(tryOff+16, false);
        const w = right - left, h = bottom - top;
        if (w > 0 && w < 10000 && h > 0 && h < 10000 && (depth===1||depth===8||depth===16||depth===24||depth===32)) {
          boundsOffset = tryOff; break;
        }
      }
      if (boundsOffset === -1) {
        const scanLimit = Math.min(nextBrush, headerStart + 520) - 19;
        for (let o = headerStart; o <= scanLimit; o++) {
          const top = dv.getInt32(o, false), left = dv.getInt32(o+4, false),
                bottom = dv.getInt32(o+8, false), right = dv.getInt32(o+12, false),
                depth = dv.getUint16(o+16, false);
          const w = right - left, h = bottom - top;
          if (w > 0 && w < 10000 && h > 0 && h < 10000 && top >= 0 && left >= 0 &&
              (depth===1||depth===8||depth===16||depth===24||depth===32)) {
            boundsOffset = o; break;
          }
        }
      }

      if (boundsOffset !== -1) {
        offset = boundsOffset;
        try {
          const top = readInt32(), left = readInt32(), bottom = readInt32(), right = readInt32();
          const depth = readUint16();
          const compressed = readUint8();
          const width = right - left, height = bottom - top;
          const pixels = readSampledPixels(width, height, depth, compressed);
          if (pixels) {
            // Use the name collected from the 'desc' section at the matching
            // index. tipNamesFromDesc[index] was populated in order, so
            // tip 0 gets names[0], tip 1 gets names[1], etc.
            const tipName = tipNamesFromDesc[index] || ('Brush ' + (index + 1));
            index++;
            brushes.push({
              name: tipName,
              size: Math.max(width, height),
              spacing: 25,
              canvas: grayscaleToTipCanvas(pixels, width, height)
            });
          }
        } catch (e) { /* skip this tip, keep scanning the rest of the file */ }
      }

      offset = nextBrush;
    }

  } else {
    throw new Error('Unsupported ABR version: ' + version + '.' + countOrSub +
      ' — only v1, v2, v6 and v10 are supported.');
  }

  // Best-effort compatibility scan + value extraction (see above). Attached
  // as extra properties on the array so existing callers that only check
  // `.length` / iterate the array are unaffected.
  const features = _scanABRFeatures(buffer);
  const values = _extractABRDescriptorValues(buffer);
  brushes.features = features;
  brushes.values = values;
  // The file-level descriptor name (first Nm/TEXT in the whole file) is the
  // Photoshop group/preset name that contains all tips. Use it as groupName
  // only — do NOT overwrite each tip's own name with it.
  const fileLevelName=String(values.name||'').trim().replace(/\s+/g,' ');
  const groupBaseName=fileLevelName.replace(/[\s._-]*\d{3,}[\s._-]*$/,'').trim()||fileLevelName;
  // The first Nm is a brush name, not a reliable Photoshop folder name.
  // Keep folder identity separate; the import flow falls back to the ABR filename.

  // Resolve each tip's display name first, then count duplicates so we only
  // append a disambiguating index when names are truly duplicated.
  function resolveTipName(rawName) {
    const n=(rawName||'').trim().replace(/\s+/g,' ');
    const isFallback=!n||/^(?:ABR )?Brush\s+\d+$/i.test(n);
    if(isFallback) return fileLevelName||(groupBaseName?groupBaseName+' Brush':'')||'ABR Brush';
    return n;
  }
  const nameCounts=new Map();
  brushes.forEach(b=>{
    const key=resolveTipName(b.name).toLocaleLowerCase();
    nameCounts.set(key,(nameCounts.get(key)||0)+1);
  });
  const nameIndexes=new Map();

  brushes.forEach((b,i)=>{
    // Resolve the best name for this tip:
    //   1. The per-tip name extracted from its own descriptor (already in b.name
    //      for v6/v10, or from readUCS2Text for v1/v2).
    //   2. Fall back to the file-level name (single-tip files, legacy formats).
    //   3. Last resort: generic numbered placeholder.
    let tipName=resolveTipName(b.name);

    // Append a disambiguating counter only when the same name appears more
    // than once in this file (e.g. two tips literally both named "DRAW - Loose").
    const key=tipName.toLocaleLowerCase();
    if((nameCounts.get(key)||0)>1){
      const idx=(nameIndexes.get(key)||0)+1;
      nameIndexes.set(key,idx);
      tipName=tipName+' '+String(idx).padStart(2,'0');
    }
    b.name=tipName||('ABR Brush '+String(i+1).padStart(2,'0'));

    if(values.diameter!=null&&Number(values.diameter)>0){const photoshopDiameter=Number(values.diameter);b.referenceDiameter=photoshopDiameter;b.size=photoshopDiameter;}
    if(values.spacing!=null) b.spacing=Math.max(1,Math.min(200,Math.round(values.spacing)));
    b.features=features;
    b.values=values;
  });

  return brushes;
}


// ABR IMPORT RESULTS
// ABR IMPORT COMPATIBILITY MODAL
// Shown right after a successful parse, before the tip picker. For every
// Photoshop brush setting we know how to look for, this reports one of:
//   Imported Successfully - a readable value was found and can be applied.
//     app has a live control for it, so it's applied automatically.
//   Partially Supported - detected but not fully wired or readable.
//     not wired up yet ("Coming Soon" in Tool Settings), or (b) this app
//     fully supports the control but the ABR file doesn't carry a value
//     for it (e.g. Flow), so nothing was found to import.
//   Not Supported Yet - no equivalent control exists in this app.
//     has no equivalent control for at all (e.g. Dual Brush).
// Never blocks import; onContinue always fires when dismissed.
//
// NOTE: this uses the shared `.modal-overlay` / `.modal` classes (see
// style.css). The inner box must use .modal so it receives the shared styling.
// renders with no background/padding/border like the rest of the app's
// modals.

function showABRImportResults(brushes, filename, onContinue) {
  const features = brushes.features || {};
  const values    = brushes.values   || {};

  const imported = [];
  const partial  = [];
  const unsupported = [];

  imported.push('Brush Tip Image ('+brushes.length+' tip'+(brushes.length===1?'':'s')+')');
  imported.push('Size (Diameter)');
  imported.push('Spacing');

  for (const key in _ABR_FEATURE_MAP) {
    if (key==='size' || key==='spacing') continue; // always applied directly from the sampled-tip header, handled above
    const f = _ABR_FEATURE_MAP[key];

    if (f.applied) {
      // We know how to apply this one IF the file actually has a value.
      const v = values[f.valueKey||key];
      if (v!=null) {
        const unit = (key==='angle') ? ' deg' : (key==='opacity'||key==='hardness'||key==='roundness') ? '%' : '';
        imported.push(f.label+' ('+Math.round(v)+unit+')');
      } else if (features[key]) {
        partial.push(f.label+' - detected but no readable value, left at current setting');
      }
      continue;
    }

    if(f.metadataOnly){
      const v=values[f.valueKey||key];
      if(v!=null||features[key]) partial.push(f.label+' - stored as metadata for future support');
      continue;
    }

    // Has a live control in this app, but isn't auto-applied for a reason
    // specific to this parser (e.g. Hardness only means something on
    // Photoshop's procedural round brushes; every imported tip here is
    // a sampled/image tip, so applying it would overwrite the user's
    // Hardness with a value that was never meaningful here). Report this
    // distinctly from "coming soon" or "no equivalent" so it's clear the
    // control itself works fine, it's just not something ABR import sets.
    if (f.sampledInapplicable) {
      const v = values[f.valueKey||key];
      const found = v!=null || features[key];
      if (found) partial.push(f.label+" - only applies to Photoshop's procedural round brushes, not image-based tips (left at current setting)");
      continue;
    }

    // Not something we apply automatically. If the file appears to use it,
    // say so explicitly; otherwise still list it under "Not Supported Yet"
    // (rather than staying silent) so people can see the full set of
    // Photoshop features this app has no equivalent for, matching
    // the "keep unsupported settings listed separately for future support"
    // requirement regardless of what any one file happens to contain.
    if (f.uiStatus==='coming_soon') {
      if (features[key]) partial.push(f.label+" - detected, but this control isn't wired up yet");
      continue;
    }
    unsupported.push(features[key] ? (f.label+' - detected, no equivalent in this app') : (f.label+' - no equivalent in this app'));
  }

  // Flow/Density are fully implemented in this app but Photoshop doesn't
  // store per-brush values for them in .abr files, so they never have
  // anything to import; always surface that plainly rather than silently
  // leaving them out of the report.
  partial.push('Density - not stored in ABR files, left at current setting');

  let overlay = document.getElementById('modal-abr-results');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-abr-results';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="min-width:380px;max-width:440px;display:flex;flex-direction:column;max-height:85vh;overflow:hidden;">
        <h2 style="margin-bottom:4px;">Import Results</h2>
        <p id="modal-abr-results-sub" style="font-size:10px;color:var(--text2);margin-bottom:10px;"></p>
        <div id="modal-abr-results-body" style="overflow-y:auto;flex:1;"></div>
        <div class="modal-actions" style="margin-top:12px;">
          <button class="modal-btn primary" id="modal-abr-results-ok">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('#modal-abr-results-sub').textContent =
    filename + ' - ' + brushes.length + ' brush tip' + (brushes.length===1?'':'s') + ' found';

  function section(title, items, color) {
    if (!items.length) return '';
    const rows = items.map(i => `<li style="padding:2px 0;">${i}</li>`).join('');
    return `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:4px;">${title}</div>
      <ul style="list-style:none;margin:0;padding:0;font-size:10px;color:var(--text2);">${rows}</ul>
    </div>`;
  }

  const body = overlay.querySelector('#modal-abr-results-body');
  body.innerHTML =
    section('Imported Successfully', imported, '#4caf7d') +
    section('Partially Supported', partial, '#e0a03c') +
    section('Not Supported Yet', unsupported, '#c85a5a') +
    '<div style="font-size:9px;color:var(--text2);line-height:1.4;">Unsupported or partial settings are skipped gracefully - the brush tip and every setting above it still import normally. Values shown are read from the file and applied when you pick a tip in the next step.</div>';

  const okBtn = overlay.querySelector('#modal-abr-results-ok');
  okBtn.onclick = () => {
    overlay.classList.remove('visible');
    if (typeof onContinue === 'function') onContinue();
  };
  overlay.classList.add('visible');
}


// grid. Clicking a tile applies it as the current brush tip via
// the same setBrushTip() path used by the manual PNG upload.
//

function showABRPicker(brushes, filename, onImport) {
  // Re-use an existing modal element if possible; otherwise create one.
  let overlay = document.getElementById('modal-abr-picker');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'modal-abr-picker';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="min-width:420px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;">
        <h2 id="modal-abr-title" style="margin-bottom:4px;">ABR Brushes</h2>
        <p id="modal-abr-sub" style="font-size:10px;color:var(--text2);margin-bottom:10px;"></p>
        <div id="modal-abr-grid"
          style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:6px;
                 overflow-y:auto;flex:1;padding:2px 2px 6px;">
        </div>
        <div class="modal-actions">
          <button class="modal-btn" id="modal-abr-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('modal-abr-cancel').onclick = () =>
      overlay.classList.remove('visible');
    overlay.addEventListener('click', e => {
      if(e.target===overlay) overlay.classList.remove('visible');
    });
  }

  // Populate title
  document.getElementById('modal-abr-title').textContent =
    'ABR Brushes — ' + filename;
  document.getElementById('modal-abr-sub').textContent =
    brushes.length + ' tip' + (brushes.length===1?'':'s') +
    ' found. Click one to load it as the brush tip.';

  // Build tiles
  const grid = document.getElementById('modal-abr-grid');
  grid.innerHTML = '';

  brushes.forEach((b, i) => {
    const tile = document.createElement('div');
    tile.title = b.name + '\n' + b.size + 'px  spacing:' + b.spacing + '%';
    Object.assign(tile.style, {
      display:'flex', flexDirection:'column', alignItems:'center',
      gap:'3px', padding:'5px', borderRadius:'6px',
      border:'1.5px solid var(--border2)', background:'var(--bg2)',
      cursor:'pointer', transition:'border-color .15s,background .15s',
    });

    // Render directly from the decoded ABR tip using the same path as preset thumbnails.
    const cv=document.createElement('canvas');
    Object.assign(cv.style,{width:'60px',height:'60px',borderRadius:'4px',imageRendering:'pixelated'});
    const previewSettings=_mapABRValuesToSettings(b.values,b.features);
    window._paintTipThumbnail(cv,b.canvas,previewSettings,64,64,true);
    // Label
    const lbl = document.createElement('span');
    Object.assign(lbl.style,{
      fontSize:'8px', color:'var(--text2)', textAlign:'center',
      wordBreak:'break-all', lineHeight:'1.2',
      maxWidth:'64px', overflow:'hidden',
      display:'-webkit-box', WebkitLineClamp:'2', WebkitBoxOrient:'vertical',
    });
    lbl.textContent = b.name || ('Brush '+(i+1));

    // Size badge
    const sz = document.createElement('span');
    sz.textContent = b.size+'px';
    Object.assign(sz.style,{
      fontSize:'7px', color:'var(--accent)', fontWeight:'600',
    });

    tile.appendChild(cv);
    tile.appendChild(lbl);
    tile.appendChild(sz);
    grid.appendChild(tile);

    tile.addEventListener('mouseenter',()=>{
      tile.style.borderColor='var(--accent)';
      tile.style.background='var(--bg3)';
    });
    tile.addEventListener('mouseleave',()=>{
      tile.style.borderColor='var(--border2)';
      tile.style.background='var(--bg2)';
    });

    tile.addEventListener('click',()=>{
      overlay.classList.remove('visible');
      // Preset-panel imports create and select their isolated preset before
      // touching live state. Otherwise the outgoing preset captures ABR data.
      if(typeof onImport==='function'){
        onImport(b);
        showInfo('Imported "'+b.name+'" from '+filename+'.','ABR Import');
        return;
      }

      // Tool Settings imports do not create presets, so retain live apply.
      if(typeof window.setBrushTip==='function') window.setBrushTip(b.canvas,b.referenceDiameter);
      const mapped=_mapABRValuesToSettings(b.values,b.features);
      const clampedSize=_applyABRSettingsToUI(b.size,b.spacing,mapped);
      const fn=document.getElementById('ts-tip-filename');
      if(fn){fn.textContent=b.name;fn.style.display='';}
      showInfo('Loaded "'+b.name+'" ('+clampedSize+'px) from '+filename+'.','ABR Import');
    });
  });

  overlay.classList.add('visible');
}