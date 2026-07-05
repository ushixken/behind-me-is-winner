// ═══ TOOL SETTINGS PANEL — wiring ═══════════════════════════
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
  bindRange('ts-hardness','ts-hardness-val','',v=>{brushHardness=v/100;_aaDabCache.clear();_stampCache.clear();});
  // Spacing is fixed, not a user-adjustable Tool Setting — the brush
  // engine's _effectiveSpacingFrac() just uses its built-in default (0.12)
  // and never varies with stroke velocity or acceleration.
  // Airbrush spray rate (dabs/sec while held, independent of movement)
  bindRange('ts-airbrush-rate','ts-airbrush-rate-val','',v=>{window._tsAirbrushRate=v/100;});
  // Dynamics
  bindRange('ts-min-size','ts-min-size-val','%');
  bindRange('ts-min-flow','ts-min-flow-val','%');
  // Transfer / Texture
  bindRange('ts-texture-scale','ts-texture-scale-val','%');
  bindRange('ts-texture-depth','ts-texture-depth-val','');

  // ── AA off = pixelated pencil mode ──────────────────────────────────
  // Anti-aliasing off is meant to give a hard, pixel-perfect stamp — so it
  // shouldn't also be softened by a partial hardness value or have its
  // opacity wobbling with pen pressure. Turning AA off snapshots whatever
  // Opacity-Control + Hardness the user had, then forces flat opacity
  // (ignores pressure — every dab is the same solid alpha) and hardness to
  // 100 (fully solid disc, no feather). Turning AA back on restores the
  // exact settings that were there before, so nothing is lost.
  let _preAA=null; // {opacityCtrl, hardness} snapshot taken the moment AA was switched off
  function _setBrushAA(on){
    if(!!on===!!brushAA) return;
    const ctrlEl=document.getElementById('ts-opacity-control');
    if(!on){
      _preAA={ opacityCtrl: ctrlEl?ctrlEl.value:'pressure', hardness: brushHardness };
      if(ctrlEl) ctrlEl.value='off';
      brushHardness=1;
      const hEl=document.getElementById('ts-hardness'); if(hEl) hEl.value=100;
      const hVal=document.getElementById('ts-hardness-val'); if(hVal) hVal.textContent=100;
    } else if(_preAA){
      if(ctrlEl) ctrlEl.value=_preAA.opacityCtrl;
      brushHardness=_preAA.hardness;
      const hPct=Math.round(_preAA.hardness*100);
      const hEl=document.getElementById('ts-hardness'); if(hEl) hEl.value=hPct;
      const hVal=document.getElementById('ts-hardness-val'); if(hVal) hVal.textContent=hPct;
      _preAA=null;
    }
    brushAA=!!on;
    _aaDabCache.clear();_stampCache.clear();
    const cb=document.getElementById('ts-aa'); if(cb) cb.checked=brushAA;
    const btn=document.getElementById('btn-aa'); if(btn) btn.classList.toggle('active',brushAA);
    document.getElementById('stat-tool').textContent=(tool==='brush'?(brushAA?'Brush':'Pencil'):tool.charAt(0).toUpperCase()+tool.slice(1));
    if(typeof applyTransform==='function') applyTransform();
  }
  window._setBrushAA=_setBrushAA;

  // AA checkbox in Tool Settings mirrors toolbar AA button
  const tsAA=document.getElementById('ts-aa');
  tsAA.checked=brushAA;
  tsAA.onchange=()=>{
    _setBrushAA(tsAA.checked);
  };

  // ── Airbrush mode — Tool Settings checkbox (activate/deactivate from
  // Tool Settings only; no separate toolbar button) ──────────────────
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

  // ── PS-style sidebar navigation ─────────────────────────────
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

    // Restore last panel or default to basic
    let lastPanel='basic';
    try{ lastPanel=sessionStorage.getItem('tsPsPanel')||'basic'; }catch(e){}
    activatePanel(lastPanel);

    // Re-activate correct panel when switching to advanced mode
    // (the setTsMode function below calls applyTsMode which we hook here)
    window._tsPsActivateDefault=()=>activatePanel(lastPanel);
  })();

  // ── Checkbox-gated panels (Tip Image / Dynamics / Texture / Pressure) ──
  // Unchecked should mean the panel is truly off, not just grayed out —
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

  // ── Per-setting Simple-tab visibility ("eye" toggles) ───────────────
  // Each eyeable field in Advanced mode gets an eye button; clicking it
  // shows/hides that individual setting in the Simple tab, like toggling
  // a layer's visibility. Choice persists across sessions.
  (function initSimpleVisibilityEyes(){
    const EYE_KEY='tsSimpleFieldVisibility';
    // What shows in Simple by default, before the user customizes anything.
    const DEFAULTS={opacity:false,flow:true,density:false,hardness:true,aa:true,'dyn-size':true,'dyn-opacity':true};
    let vis={};
    try{ vis=JSON.parse(localStorage.getItem(EYE_KEY)||'{}'); }catch(e){ vis={}; }

    function isVisible(key){
      return vis[key]!==undefined ? vis[key] : (DEFAULTS[key]!==undefined?DEFAULTS[key]:true);
    }
    function applyField(key){
      const field=document.querySelector('.ts-field[data-eye="'+key+'"]');
      const btn=document.querySelector('.ts-eye-btn[data-eye-btn="'+key+'"]');
      const on=isVisible(key);
      if(field) field.classList.toggle('ts-simple-hidden',!on);
      if(btn){
        btn.classList.toggle('ts-eye-off',!on);
        btn.title=on?'Visible in Simple tab — click to hide':'Hidden in Simple tab — click to show';
      }
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

  // ── Whole-section Simple-tab visibility + drag-to-reorder ──────────────
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

  // Toolbar "Tool Settings" button opens the panel via FloatPanels
  const tsBtnOpen=document.getElementById('btn-open-tool-settings');
  if(tsBtnOpen) tsBtnOpen.onclick=()=>{
    document.getElementById('tool-settings-modal-overlay').classList.add('visible');
  };
  document.getElementById('tool-settings-modal-close').onclick=()=>{
    document.getElementById('tool-settings-modal-overlay').classList.remove('visible');
  };
  document.getElementById('tool-settings-modal-overlay').addEventListener('click',e=>{
    if(e.target===document.getElementById('tool-settings-modal-overlay'))
      document.getElementById('tool-settings-modal-overlay').classList.remove('visible');
  });

  // ── Simple / Advanced settings mode ─────────────────────────
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

  // ════════════════════════════════════════════════════════════════
  // BRUSH TIP IMAGE — UI wiring
  // ════════════════════════════════════════════════════════════════
  (function(){

    // ── Draw the 64×64 tip preview showing how the alpha mask looks ────
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
      ctx2.drawImage(window.brushTipCanvas,0,0,64,64);
      ctx2.restore();
    }

    // ── Sync all tip-related UI visibility to current state ────────────
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

    // ── Load an image file into a canvas and set as brush tip ──────────
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
      };
    }
    if(tipModeEl){
      tipModeEl.onchange=()=>{
        window.brushTipMode=tipModeEl.value;
        // Bust caches so the new mode takes effect on the next dab.
        if(typeof window.setBrushTip==='function' && window.brushTipCanvas)
          window.setBrushTip(window.brushTipCanvas);
      };
    }
    if(tipSoftEl){
      tipSoftEl.onchange=()=>{
        window.brushTipSoftAlpha=tipSoftEl.checked;
        if(typeof window.setBrushTip==='function' && window.brushTipCanvas)
          window.setBrushTip(window.brushTipCanvas);
      };
    }

    // Initial draw
    window._syncTipUI();

  })();

  // ════════════════════════════════════════════════════════════════
  // BRUSH TEXTURE IMAGE — UI wiring
  // ════════════════════════════════════════════════════════════════
  (function(){

    // ── Draw the 64×64 texture preview ────────────────────────────────
    function _drawTexturePreview(){
      const c=document.getElementById('ts-texture-preview');
      if(!c) return;
      const ctx2=c.getContext('2d');
      ctx2.clearRect(0,0,64,64);
      if(!window.brushTextureCanvas) return;
      ctx2.drawImage(window.brushTextureCanvas,0,0,64,64);
    }

    // ── Sync texture UI visibility ─────────────────────────────────────
    window._syncTextureUI=function(){
      const hasTex=!!window.brushTextureCanvas;
      const clearBtn=document.getElementById('ts-texture-clear-btn');
      const depthRow=document.getElementById('ts-texture-depth-custom-row');
      const helpEl=document.getElementById('ts-texture-img-help');
      const filename=document.getElementById('ts-texture-filename');
      if(clearBtn) clearBtn.style.display=hasTex?'':'none';
      if(depthRow) depthRow.style.display=hasTex?'':'none';
      if(helpEl) helpEl.style.display=hasTex?'none':'';
      if(!hasTex && filename){ filename.style.display='none'; filename.textContent=''; }
      // Sync depth slider to engine global
      const depthEl=document.getElementById('ts-texture-depth-custom');
      const depthVal=document.getElementById('ts-texture-depth-custom-val');
      const pct=Math.round((window.brushTextureDepth||0.5)*100);
      if(depthEl) depthEl.value=pct;
      if(depthVal) depthVal.textContent=pct+'%';
      _drawTexturePreview();
    };

    // ── Load an image file into a canvas and set as brush texture ──────
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
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); };
      img.src=url;
    }

    const texFileInput=document.getElementById('ts-texture-file-input');
    const texLoadBtn=document.getElementById('ts-texture-load-btn');
    const texClearBtn=document.getElementById('ts-texture-clear-btn');
    const texDepthEl=document.getElementById('ts-texture-depth-custom');
    const texDepthVal=document.getElementById('ts-texture-depth-custom-val');

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
      };
    }
    if(texDepthEl){
      texDepthEl.oninput=()=>{
        window.brushTextureDepth=+texDepthEl.value/100;
        if(texDepthVal) texDepthVal.textContent=texDepthEl.value+'%';
      };
    }

    // Initial draw
    window._syncTextureUI();

  })();

})(); // end Tool Settings panel init

// Preset get/apply
function getToolPreset(){
  const ids=['ts-size','ts-opacity','ts-flow','ts-density','ts-hardness','ts-spacing','ts-airbrush','ts-airbrush-rate',
    'ts-min-size','ts-size-control','ts-opacity-control','ts-min-flow',
    'ts-texture-scale','ts-texture-depth'];
  const out={};
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(el) out[id]=(el.type==='checkbox'?el.checked:el.value);
  });
  out['ts-aa']=document.getElementById('ts-aa').checked;

  // ── Brush tip & texture image data (stored as data URLs for JSON export) ──
  // These are only written when an image is actually loaded; absent keys mean
  // "no custom tip/texture" so legacy presets silently skip this code path.
  if(window.brushTipCanvas){
    try{ out['ts-tip-dataurl']=window.brushTipCanvas.toDataURL('image/png'); }catch(e){}
    out['ts-tip-mode']=(window.brushTipMode||'multiply');
    out['ts-tip-soft-alpha']=!!(window.brushTipSoftAlpha!==false);
  }
  if(window.brushTextureCanvas){
    try{ out['ts-texture-dataurl']=window.brushTextureCanvas.toDataURL('image/png'); }catch(e){}
    out['ts-texture-depth-custom']=Math.round((window.brushTextureDepth||0.5)*100);
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
       id==='ts-tip-mode'||id==='ts-tip-soft-alpha'||id==='ts-texture-depth-custom') return;
    const el=document.getElementById(id);
    if(!el) return;
    if(el.type==='checkbox') el.checked=!!val;
    else el.value=val;
    el.dispatchEvent(new Event('input'));
  });

  // ── Restore tip image ──────────────────────────────────────────────────
  if(json['ts-tip-dataurl']){
    _dataURLToCanvas(json['ts-tip-dataurl']).then(c=>{
      if(typeof window.setBrushTip==='function') window.setBrushTip(c);
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

  // ── Restore texture image ──────────────────────────────────────────────
  if(json['ts-texture-dataurl']){
    _dataURLToCanvas(json['ts-texture-dataurl']).then(c=>{
      if(typeof window.setBrushTexture==='function') window.setBrushTexture(c);
      const depth=json['ts-texture-depth-custom']!=null?(+json['ts-texture-depth-custom']/100):0.5;
      window.brushTextureDepth=depth;
      if(typeof _syncTextureUI==='function') _syncTextureUI();
    }).catch(()=>{});
  } else {
    if(typeof window.clearBrushTexture==='function') window.clearBrushTexture();
    if(typeof _syncTextureUI==='function') _syncTextureUI();
  }
}

// ════════════════════════════════════════════════════════════════
// BRUSH PRESET SYSTEM (Photoshop-style)
// ════════════════════════════════════════════════════════════════
(function(){
  // ── Built-in brush shape presets ───────────────────────────────
  // NOTE: there is no separate "eraser preset" list anymore. The eraser is
  // just the brush engine compositing with destination-out (see the brush
  // engine comment a few hundred lines up: "the eraser always uses the same
  // mode as the current brush") — so it picks its *shape* from this exact
  // same list. What used to be 4 hard-coded "eraser presets" was redundant
  // and out of sync with the real brush shapes. Brush and Eraser each just
  // remember their OWN last-picked preset + size/hardness/flow/etc, tracked
  // in _toolState below, completely independently of one another.
  const BRUSH_PRESETS = [
    {
      id:'hard-round', name:'Hard Round',
      // Photoshop/Photopea's "Hard Round" is a crisp, essentially unfeathered
      // disc — only a hairline of antialiasing at the rim, not a 50/50 soft
      // falloff. hardness=50 (the old value) made the soft-edge BAND half the
      // brush's radius wide, which is invisible on a small brush but turns
      // into a huge blurry gradient on a large one (see brush-engine.js edge
      // rendering fix for the pixel-width clamp that makes hardness=100 read
      // as "hard" at any size instead of a razor-thin single-pixel ring).
      preview:{shape:'circle',hardness:0.95},
      settings:{'ts-size':8.1,'ts-hardness':100,'ts-opacity':100,'ts-flow':100,'ts-density':100,'ts-spacing':1,'ts-roundness':100,'ts-aa':true}
    },
  ];
  // User-created presets (saved via the ➕ button). Restored from storage.
  let _customPresets = [];

  // ── Groups (folders) ───────────────────────────────────────────
  // A single ordered list now (no more separate brush/eraser group sets —
  // both tools browse the same folders). The first/default folder holds all
  // the built-in shapes and is called "General Brushes" since it's the
  // default set everything ships with. Users can drag it (and any custom
  // folder) to reorder, drag brushes between folders to reorganize, and
  // create new empty folders via the 📁+ button for brushes they add later.
  let _groups = [
    { id:'general', label:'General Brushes', icon:'🖌', default:true, collapsed:false,
      ids:['hard-round'] }
  ];

  // ── Per-preset settings store ───────────────────────────────────
  // Each preset stores its own independent settings snapshot.
  // Keys are preset IDs; values mirror the full getToolPreset() shape.
  // Built-ins are seeded from their BRUSH_PRESETS[].settings; user tweaks
  // are written here whenever the slider values change while that preset is
  // active, so switching presets never bleeds settings between them.
  let _presetSettings = {}; // { [presetId]: { 'ts-size':…, 'ts-hardness':…, … } }

  function _seedPresetSettings(preset){
    if(!_presetSettings[preset.id]){
      _presetSettings[preset.id] = Object.assign({}, preset.settings || {});
    }
  }
  // Seed built-ins immediately
  BRUSH_PRESETS.forEach(_seedPresetSettings);

  // Capture the current slider state into the active preset's per-preset slot
  function _captureToPreset(presetId){
    if(!presetId) return;
    const sizeEl = document.getElementById('ts-size');
    const spEl   = document.getElementById('ts-spacing');
    const rdEl   = document.getElementById('ts-roundness');
    const arEl   = document.getElementById('ts-airbrush-rate');
    _presetSettings[presetId] = Object.assign(
      _presetSettings[presetId] || {},
      {
        'ts-size':       sizeEl ? +sizeEl.value : toolSizes[tool] || 12,
        'ts-hardness':   Math.round(brushHardness * 100),
        'ts-opacity':    Math.round(brushOpacity * 100),
        'ts-flow':       Math.round(brushFlow * 100),
        'ts-density':    Math.round(brushDensity * 100),
        'ts-spacing':    spEl  ? +spEl.value  : 12,
        'ts-roundness':  rdEl  ? +rdEl.value  : 100,
        'ts-aa':         !!brushAA,
        'ts-airbrush':   !!window._brushAirbrush,
        'ts-airbrush-rate': arEl ? +arEl.value : 55,
      }
    );
  }

  // ── Per-tool memory ─────────────────────────────────────────────
  // Brush and Eraser each keep their OWN preset + slider values. Switching
  // tools snapshots the outgoing tool's live settings and restores the
  // incoming tool's saved settings — so "brush=preset1, eraser=preset2" each
  // stick, and manual tweaks to either are remembered too.
  let _toolState = {
    brush:  {presetId:'hard-round', size:8.1, hardness:50,  opacity:100, flow:100, density:100, spacing:1, roundness:100, aa:true, airbrush:false},
    eraser: {presetId:'hard-round', size:20, hardness:55, opacity:100, flow:100, density:100, spacing:12, roundness:100, aa:true, airbrush:false},
  };
  // Which tab is shown in the preset panel (brush|eraser) — follows setTool()
  let _activeTab = 'brush';
  // Which preset is currently shown active/highlighted in the grid
  let _activePresetId = 'hard-round';
  // Drag state (kept in JS, not dataTransfer — reading dataTransfer.getData
  // during dragover is unreliable cross-browser, so we just track it here)
  let _drag = null; // {type:'group',id} | {type:'item',id,fromGroup}

  // ── Persistence ──────────────────────────────────────────────
  const STORE_KEY='animatorBrushPresetsV2';
  function persist(){
    try{
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v:2, customPresets:_customPresets, groups:_groups, toolState:_toolState, presetSettings:_presetSettings
      }));
    }catch(e){ /* storage unavailable — fail silently, in-memory state still works */ }
  }
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
      // Restore per-preset settings; built-ins will be merged/overridden with
      // the user's saved tweaks so they survive a page reload
      if(data && data.presetSettings && typeof data.presetSettings === 'object'){
        Object.assign(_presetSettings, data.presetSettings);
      }
    }catch(e){ /* corrupt/unavailable storage — just use defaults */ }
  }
  loadPersisted();

  function allPresets(){ return BRUSH_PRESETS.concat(_customPresets); }
  function findPreset(id){ return allPresets().find(p=>p.id===id); }

  // ── Draw preview canvas ───────────────────────────────────────
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
  const _tipThumbCache = {}; // presetId -> HTMLImageElement (decoded once, reused)
  function drawPresetThumb(canvas, p){
    const s = _presetSettings[p.id];
    const dataURL = s && s['ts-tip-dataurl'];
    if(!dataURL){
      drawPreview(canvas, Object.assign({}, p.preview, {isEraser:_activeTab==='eraser'}));
      return;
    }
    const W=48,H=48;
    canvas.width=W; canvas.height=H;
    const ctx2=canvas.getContext('2d');
    function paint(img){
      ctx2.clearRect(0,0,W,H);
      const pad=6;
      const maxW=W-pad*2, maxH=H-pad*2;
      const scale=Math.min(maxW/img.width, maxH/img.height, 1);
      const dw=Math.max(1,img.width*scale), dh=Math.max(1,img.height*scale);
      const dx=(W-dw)/2, dy=(H-dh)/2;
      ctx2.save();
      ctx2.fillStyle = _activeTab==='eraser' ? 'rgba(226,75,74,0.95)' : 'rgba(232,232,240,0.95)';
      ctx2.fillRect(dx,dy,dw,dh);
      ctx2.globalCompositeOperation='destination-in';
      ctx2.drawImage(img,dx,dy,dw,dh);
      ctx2.restore();
    }
    const cached=_tipThumbCache[p.id];
    if(cached && cached.complete && cached.src===dataURL){
      paint(cached);
    } else {
      ctx2.clearRect(0,0,W,H);
      const img=new Image();
      img.onload=()=>{ _tipThumbCache[p.id]=img; paint(img); };
      img.src=dataURL;
    }
  }

  // ── Brush Preset right-click context menu ─────────────────────
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
      _presetSettings[id] = JSON.parse(JSON.stringify(_presetSettings[_bpCopiedPreset.id] || pasted.settings || {}));
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

  // ── Brush Group right-click + double-click context menu ────────
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
    bgCtxMenu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
    bgCtxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 110) + 'px';
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
  }

  // ── Create a single bp-item element (draggable + reorderable) ──
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

  // ── Move a preset id from one group to another (or reorder within) ──
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

  // ── Build the grid (groups + items, draggable/reorderable, scrollable) ──
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
        (grp.default ? '' : '<span class="bp-group-del" title="Delete folder (brushes move to General Brushes)">✕</span>');
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
        delBtn.addEventListener('click', e=>{
          e.stopPropagation();
          if(!confirm(`Delete folder "${grp.label}"? Its brushes will move into General Brushes.`)) return;
          const general = _groups.find(g=>g.default) || _groups[0];
          general.ids = general.ids.concat(grp.ids.filter(id=>!general.ids.includes(id)));
          _groups = _groups.filter(g=>g.id!==grp.id);
          persist();
          buildGrid();
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

  // ── Reorder folders ─────────────────────────────────────────────
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

  // ── Apply a preset's settings to the tool settings sliders ───
  function applyPresetSettings(p){
    const s = p.settings;
    const mapping = {
      'ts-size': {slider:'ts-size', val:'ts-size-val', suffix:'', extra: v=>{toolSizes[tool]=v; const bpSz=document.getElementById('bp-sz'); if(bpSz)bpSz.value=v; if(typeof refreshSizeUI==='function')refreshSizeUI(); _aaDabCache.clear();_stampCache.clear();}},
      'ts-hardness': {slider:'ts-hardness', val:'ts-hardness-val', suffix:'', extra: v=>{brushHardness=v/100; _aaDabCache.clear();_stampCache.clear();}},
      'ts-opacity': {slider:'ts-opacity', val:'ts-opacity-val', suffix:'', extra: v=>{brushOpacity=v/100;}},
      'ts-flow': {slider:'ts-flow', val:'ts-flow-val', suffix:'', extra: v=>{brushFlow=v/100;}},
      'ts-density': {slider:'ts-density', val:'ts-density-val', suffix:'', extra: v=>{brushDensity=v/100;}},
      'ts-spacing': {slider:'ts-spacing', val:'ts-spacing-val', suffix:'%', extra: v=>{window._tsSpacing=v/100;}},
      'ts-roundness': {slider:'ts-roundness', val:'ts-roundness-val', suffix:'', extra: v=>{window._tsRoundness=v/100; _aaDabCache.clear();_stampCache.clear();}},
      'ts-aa': null,
      'ts-airbrush': null,
      'ts-airbrush-rate': {slider:'ts-airbrush-rate', val:'ts-airbrush-rate-val', suffix:'', extra: v=>{window._tsAirbrushRate=v/100;}},
    };
    Object.entries(s).forEach(([key,val])=>{
      if(key==='ts-aa'){
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
    // Airbrush is a per-preset on/off, like Photoshop/CSP — presets that
    // don't mention it explicitly should switch it off rather than leaking
    // the previous preset's airbrush state.
    if(!('ts-airbrush' in s) && typeof window._setAirbrush==='function') window._setAirbrush(false);

    // Tip image: restore from preset data URL if present; clear if absent.
    // This matches what applyToolPreset does for JSON imports.
    if(s['ts-tip-dataurl']){
      if(typeof _dataURLToCanvas==='function'){
        _dataURLToCanvas(s['ts-tip-dataurl']).then(c=>{
          if(typeof window.setBrushTip==='function') window.setBrushTip(c);
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
    if(s['ts-texture-dataurl']){
      if(typeof _dataURLToCanvas==='function'){
        _dataURLToCanvas(s['ts-texture-dataurl']).then(c=>{
          if(typeof window.setBrushTexture==='function') window.setBrushTexture(c);
          const depth=s['ts-texture-depth-custom']!=null?(+s['ts-texture-depth-custom']/100):0.5;
          window.brushTextureDepth=depth;
          if(typeof window._syncTextureUI==='function') window._syncTextureUI();
        }).catch(()=>{});
      }
    } else {
      if(typeof window.clearBrushTexture==='function') window.clearBrushTexture();
      if(typeof window._syncTextureUI==='function') window._syncTextureUI();
    }
  }

  // ── Snapshot / restore per-tool live settings ──────────────────
  // This is what actually makes Brush and Eraser remember separate presets
  // AND separate manual tweaks (size/hardness/flow/spacing/roundness/AA),
  // since the underlying brushHardness/brushOpacity/brushAA/etc globals are
  // shared by the engine and would otherwise leak between the two tools.
  function captureLiveState(t){
    if(t!=='brush' && t!=='eraser') return;
    const st=_toolState[t];
    st.size = toolSizes[t];
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
    const st=_toolState[t];
    toolSizes[t]=st.size;
    brushHardness=st.hardness/100;
    brushOpacity=(st.opacity!=null?st.opacity:100)/100;
    brushFlow=(st.flow!=null?st.flow:100)/100;
    brushDensity=(st.density!=null?st.density:100)/100;
    window._tsSpacing=st.spacing/100;
    window._tsRoundness=st.roundness/100;
    brushAA=!!st.aa;
    _aaDabCache.clear();_stampCache.clear();
    _activePresetId=st.presetId;
    const setv=(id,v,suf)=>{const el=document.getElementById(id); if(el) el.value=v; const ve=document.getElementById(id+'-val'); if(ve) ve.textContent=v+(suf||'');};
    setv('ts-hardness',st.hardness); setv('ts-opacity',st.opacity!=null?st.opacity:100); setv('ts-flow',st.flow!=null?st.flow:100); setv('ts-density',st.density!=null?st.density:100);
    setv('ts-spacing',st.spacing,'%'); setv('ts-roundness',st.roundness);
    const tsAaEl=document.getElementById('ts-aa'); if(tsAaEl) tsAaEl.checked=st.aa;
    const aaBtn=document.getElementById('btn-aa'); if(aaBtn) aaBtn.classList.toggle('active',st.aa);
    if(typeof window._setAirbrush==='function') window._setAirbrush(!!st.airbrush);
    const tsSzEl=document.getElementById('ts-size'); if(tsSzEl) tsSzEl.value=st.size;
    const bpSzEl=document.getElementById('bp-sz'); if(bpSzEl) bpSzEl.value=st.size;
    if(typeof refreshSizeUI==='function') refreshSizeUI();
    if(typeof applyTransform==='function') applyTransform();
  }

  // ── Select a preset (always for the currently active tab/tool) ─
  function selectPreset(id){
    const p = findPreset(id);
    if(!p) return;
    const targetTool = (_activeTab==='eraser') ? 'eraser' : 'brush';
    if(tool!==targetTool) setTool(targetTool, targetTool==='brush'?'Brush':'Eraser');

    // Save the outgoing preset's current slider state before switching away
    if(_activePresetId && _activePresetId !== id){
      _captureToPreset(_activePresetId);
    }

    // Ensure the incoming preset has its own settings slot (seed from preset.settings if first visit)
    _seedPresetSettings(p);

    // Build a merged settings object: preset.settings as base, then any user-saved
    // tweaks on top, so the preset remembers whatever the user last set on it.
    const savedSettings = Object.assign({}, p.settings || {}, _presetSettings[p.id] || {});
    applyPresetSettings({ settings: savedSettings });

    _activePresetId = id;
    _toolState[targetTool].presetId = id;
    captureLiveState(targetTool);
    persist();
    refreshGrid();
  }

  // ── Refresh grid active states ────────────────────────────────
  function refreshGrid(){
    document.querySelectorAll('.bp-item').forEach(el=>{
      el.classList.toggle('active', el.dataset.presetId===_activePresetId);
    });
  }

  // ── Switch preset panel tab (brush|eraser) — both show the SAME
  //    folders/presets; only the highlighted preset + size bar differ ──
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

  // ── Hook tab buttons ──────────────────────────────────────────
  document.querySelectorAll('.bp-tool-tab').forEach(btn=>{
    btn.onclick=()=>{
      const t=btn.dataset.bpTool;
      switchTab(t);
      if(tool!==t) setTool(t, t==='brush'?'Brush':'Eraser');
      else { restoreLiveState(t); refreshGrid(); }
    };
  });

  // ── Patch setTool: snapshot the outgoing tool, restore the incoming one ──
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

  // ── Add Group / Add Brush ───────────────────────────────────────
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
      settings:{ 'ts-size':size, 'ts-hardness':hardness, 'ts-opacity':opacity, 'ts-flow':flow, 'ts-density':density, 'ts-spacing':spacing, 'ts-roundness':roundness, 'ts-aa':!!brushAA }
    };
    _customPresets.push(preset);
    _seedPresetSettings(preset); // give it its own settings slot immediately
    const general = _groups.find(g=>g.default) || _groups[0];
    general.ids.push(id);
    persist();
    buildGrid();
    selectPreset(id);
  };

  // ── Import Brush (from .abr) ────────────────────────────────────
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
      const f=fi.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload=ev=>{
        try{
          const brushes=parseABR(ev.target.result);
          if(!brushes||!brushes.length){
            showInfo('No readable brush tips found in this ABR file.','ABR Import');
            return;
          }
          // onImport receives the chosen tip and turns it into a saved
          // brush preset, exactly like the ➕ "add brush" flow above.
          showABRImportResults(brushes, f.name, () => showABRPicker(brushes,f.name,(b)=>{
            const id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
            const sizeEl=document.getElementById('ts-size');
            const clampedSize=Math.max(sizeEl?+sizeEl.min:1,Math.min(sizeEl?+sizeEl.max:2000,b.size));
            // Same mapping layer used by the picker's live-apply path, so a
            // saved preset always reflects the exact same parameters that
            // would have been applied had this tip been picked directly.
            const mapped=_mapABRValuesToSettings(b.values);
            const preset={
              id, name:b.name||f.name.replace(/\.abr$/i,''), custom:true,
              preview:{ shape:'image', hardness:1, aliased:false },
              settings:{
                'ts-size':clampedSize,
                'ts-spacing':Math.min(200,Math.max(1,b.spacing||25)),
                'ts-tip-dataurl':b.canvas.toDataURL('image/png'),
                'ts-tip-mode':'replace',
                'ts-tip-soft-alpha':true,
                ...mapped
              },
              abrMeta:{ features:b.features||{}, values:b.values||{}, unsupported:_abrUnsupportedList(b.features) }
            };
            _customPresets.push(preset);
            _seedPresetSettings(preset);
            const general=_groups.find(g=>g.default)||_groups[0];
            general.ids.push(id);
            persist();
            buildGrid();
            selectPreset(id);
          }));
        } catch(e){
          showInfo('Could not parse the ABR file: '+e.message,'ABR Import Error');
        }
      };
      r.readAsArrayBuffer(f);
    };
    fi.click();
  };

  // ── Initial state ─────────────────────────────────────────────
  buildGrid();
  selectPreset(_toolState.brush.presetId);

  // ── Search input ──────────────────────────────────────────────
  const bpSearch = document.getElementById('bp-search');
  if(bpSearch){
    bpSearch.addEventListener('input',()=>{
      buildGrid(bpSearch.value);
    });
  }

  // ── Size bar (panel) ────────────────────────────────────────────
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

  // ── Prevent trackpad/wheel scroll from bubbling up to the canvas ──
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

// ════════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════════
const _ABR_FEATURE_MAP = {
  size:        { label:'Size (Diameter)',      needles:['Dmtr'],                          control:'ts-size',        applied:true,  uiStatus:'implemented' },
  spacing:     { label:'Spacing',               needles:['Spcn'],                          control:'ts-spacing',     applied:true,  uiStatus:'implemented' },
  hardness:    { label:'Hardness',              needles:['Hrdn'],                          control:'ts-hardness',    applied:false, uiStatus:'implemented', sampledInapplicable:true },
  opacity:     { label:'Opacity',               needles:['Opct'],                          control:'ts-opacity',     applied:true,  uiStatus:'implemented' },
  flipX:       { label:'Flip X',                needles:['Flip X','flipX'],                control:'ts-flip-x',      applied:false, uiStatus:'coming_soon' },
  flipY:       { label:'Flip Y',                needles:['Flip Y','flipY'],                control:'ts-flip-y',      applied:false, uiStatus:'coming_soon' },
  flow:        { label:'Flow',                  needles:['Flow'],                          control:'ts-flow',        applied:false, uiStatus:'implemented' },
  angle:       { label:'Angle',                 needles:['Angl'],                          control:'ts-angle',       applied:false, uiStatus:'coming_soon' },
  roundness:   { label:'Roundness',             needles:['Rndn'],                          control:'ts-roundness',   applied:false, uiStatus:'coming_soon' },
  scatter:     { label:'Scatter',               needles:['Scattering'],                    control:'ts-scatter',     applied:false, uiStatus:'coming_soon' },
  scatterBoth: { label:'Scatter — Both Axes',   needles:['bothAxes'],                      control:'ts-scatter-both-axes', applied:false, uiStatus:'coming_soon' },
  count:       { label:'Count (multi-stamp)',   needles:['Count'],                         control:'ts-count',       applied:false, uiStatus:'coming_soon' },
  texture:     { label:'Texture',               needles:['Texture'],                       control:'ts-texture',     applied:false, uiStatus:'coming_soon' },
  sizeJitter:  { label:'Size Jitter (Shape Dynamics)', needles:['Shape Dynamics','sizeJitter'], control:'ts-size-jitter', applied:false, uiStatus:'coming_soon' },
  angleJitter: { label:'Angle Jitter',           needles:['angleJitter'],                   control:'ts-angle-jitter', applied:false, uiStatus:'coming_soon' },
  roundJitter: { label:'Roundness Jitter',       needles:['roundnessJitter'],               control:'ts-round-jitter', applied:false, uiStatus:'coming_soon' },
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
    for (let i=0;i<n-14;i++) {
      if (dv.getUint32(i,false)!==2) continue;           // keyLength === 2
      if (bytes[i+4]!==0x4e || bytes[i+5]!==0x6d) continue; // 'N','m'
      if (!keyAt(i+6,'TEXT')) continue;
      const strLenOff=i+10;
      if (strLenOff+4>n) continue;
      const strLen=dv.getUint32(strLenOff,false);
      const charsOff=strLenOff+4;
      if (strLen<=0 || strLen>200 || charsOff+strLen*2>n) continue;
      let str='';
      for (let c=0;c<strLen;c++){
        const code=dv.getUint16(charsOff+c*2,false);
        if (code!==0) str+=String.fromCharCode(code);
      }
      str=str.trim();
      if (str) return str;
    }
    return null;
  }
  return {
    name:      findName(),
    opacity:   findFirst('Opct'),
    hardness:  findFirst('Hrdn'),
    angle:     findFirst('Angl'),
    roundness: findFirst('Rndn')
  };
}

// ════════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════════
function _mapABRValuesToSettings(values) {
  const v = values || {};
  const out = {};
  // Hardness intentionally NOT mapped: this parser only ever extracts
  // sampled (raster) tips, and Photoshop's own descriptor format only
  // stores Hrdn on procedural "computedBrush" presets — it's explicitly
  // deleted when a brush becomes a sampledBrush, so it has no meaning on
  // an image-based tip. See _ABR_FEATURE_MAP.hardness.sampledInapplicable
  // and showABRImportResults, which surfaces this explicitly instead of
  // silently overwriting the user's Hardness with an irrelevant value.
  if (v.opacity != null) out['ts-opacity'] = Math.max(1, Math.min(100, Math.round(v.opacity)));
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
    const el = document.getElementById(ctrlId);
    if (!el) continue;
    el.value = settings[ctrlId];
    el.dispatchEvent(new Event('input'));
  }

  if (typeof window._syncTipUI === 'function') window._syncTipUI();
  if (typeof window.refreshSizeUI === 'function') window.refreshSizeUI();

  return clampedSize;
}

// List of detected-but-unsupported ABR features, kept separately (rather
// than discarded) so a brush's abrMeta can be inspected later if support
// for one of these is added — see _ABR_FEATURE_MAP for the full catalog.
function _abrUnsupportedList(features) {
  const f = features || {};
  const list = [];
  for (const key in _ABR_FEATURE_MAP) {
    if (!f[key]) continue;
    const entry = _ABR_FEATURE_MAP[key];
    if (entry.applied) continue; // already handled by _mapABRValuesToSettings
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
// ════════════════════════════════════════════════════════════════

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

  // ── Convert a w×h grayscale byte array (0=black/opaque,255=white/transparent
  //    in Photoshop's inverted brush convention) to a canvas whose alpha mask
  //    follows our convention: 255=full-paint (black in PS), 0=transparent.
  function grayscaleToTipCanvas(pixels, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx2 = c.getContext('2d');
    const id = ctx2.createImageData(w, h); const d = id.data;
    for (let i = 0, p = 0; i < pixels.length; i++, p += 4) {
      const a = 255 - pixels[i];
      d[p] = d[p+1] = d[p+2] = 0;
      d[p+3] = a;
    }
    ctx2.putImageData(id, 0, 0);
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

  // ──────────────────────────────────────────────────────────────
  //  ABR v1 / v2  (Photoshop ≤ CS)
  // ──────────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────────
  //  ABR v6 (CS2+) / v10 (CS6+) — descriptor-wrapped sampled tips
  // ──────────────────────────────────────────────────────────────
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
            index++;
            brushes.push({
              name: 'Brush ' + index,
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
  // Prefer the actual Photoshop preset name (e.g. "soft strokes") pulled
  // from the descriptor over the generic "Brush N" placeholder. For a
  // single-tip file this is unambiguous; for multi-tip files it's the
  // shared preset name Photoshop groups all these tips under, so append
  // an index to keep tiles distinguishable.
  if (values.name) {
    brushes.forEach((b, i) => {
      b.name = brushes.length > 1 ? (values.name + ' ' + (i + 1)) : values.name;
    });
  }
  brushes.forEach(b => { b.features = features; b.values = values; });

  return brushes;
}


// ════════════════════════════════════════════════════════════════
// ABR IMPORT COMPATIBILITY MODAL
// Shown right after a successful parse, before the tip picker. For every
// Photoshop brush setting we know how to look for, this reports one of:
//   ✔ Imported Successfully — a real value was found in the file AND this
//     app has a live control for it, so it's applied automatically.
//   ◐ Partially Supported   — either (a) this app has the control but it's
//     not wired up yet ("Coming Soon" in Tool Settings), or (b) this app
//     fully supports the control but the ABR file doesn't carry a value
//     for it (e.g. Flow), so nothing was found to import.
//   ✕ Not Supported Yet     — the file uses a Photoshop feature this app
//     has no equivalent control for at all (e.g. Dual Brush).
// Never blocks import — `onContinue` always fires when dismissed.
//
// NOTE: this uses the shared `.modal-overlay` / `.modal` classes (see
// style.css) — the inner box MUST be `.modal`, not a one-off class, or it
// renders with no background/padding/border like the rest of the app's
// modals.
// ════════════════════════════════════════════════════════════════
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
      const v = values[key];
      if (v!=null) {
        const unit = (key==='angle') ? '°' : (key==='opacity'||key==='hardness'||key==='roundness') ? '%' : '';
        imported.push(f.label+' ('+Math.round(v)+unit+')');
      } else if (features[key]) {
        partial.push(f.label+' — detected but no readable value, left at current setting');
      }
      continue;
    }

    // Has a live control in this app, but isn't auto-applied for a reason
    // specific to this parser (e.g. Hardness only means something on
    // Photoshop's procedural round brushes — every tip this app imports is
    // a sampled/image tip, so applying it would overwrite the user's
    // Hardness with a value that was never meaningful here). Report this
    // distinctly from "coming soon" or "no equivalent" so it's clear the
    // control itself works fine, it's just not something ABR import sets.
    if (f.sampledInapplicable) {
      const v = values[key];
      const found = v!=null || features[key];
      if (found) partial.push(f.label+' — only applies to Photoshop\u2019s procedural round brushes, not image-based tips (left at current setting)');
      continue;
    }

    // Not something we apply automatically. If the file appears to use it,
    // say so explicitly; otherwise still list it under "Not Supported Yet"
    // (rather than staying silent) so people can see the full set of
    // Photoshop features this app has no equivalent for at all — matching
    // the "keep unsupported settings listed separately for future support"
    // requirement regardless of what any one file happens to contain.
    if (f.uiStatus==='coming_soon') {
      if (features[key]) partial.push(f.label+' — detected, but this control isn\u2019t wired up yet');
      continue;
    }
    unsupported.push(features[key] ? (f.label+' — detected, no equivalent in this app') : (f.label+' — no equivalent in this app'));
  }

  // Flow/Density are fully implemented in this app but Photoshop doesn't
  // store per-brush values for them in .abr files, so they never have
  // anything to import — always surface that plainly rather than silently
  // leaving them out of the report.
  partial.push('Density — not stored in ABR files, left at current setting');

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
    filename + ' — ' + brushes.length + ' brush tip' + (brushes.length===1?'':'s') + ' found';

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
    section('✔ Imported Successfully', imported, '#4caf7d') +
    section('◐ Partially Supported', partial, '#e0a03c') +
    section('✕ Not Supported Yet', unsupported, '#c85a5a') +
    '<div style="font-size:9px;color:var(--text2);line-height:1.4;">Unsupported or partial settings are skipped gracefully — the brush tip and every setting above it still import normally. Values shown are read from the file and applied when you pick a tip in the next step.</div>';

  const okBtn = overlay.querySelector('#modal-abr-results-ok');
  okBtn.onclick = () => {
    overlay.classList.remove('visible');
    if (typeof onContinue === 'function') onContinue();
  };
  overlay.classList.add('visible');
}


// grid. Clicking a tile applies it as the current brush tip via
// the same setBrushTip() path used by the manual PNG upload.
// ════════════════════════════════════════════════════════════════

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

    // Preview canvas — checkerboard so transparency reads clearly
    const cv = document.createElement('canvas');
    cv.width=64; cv.height=64;
    Object.assign(cv.style,{width:'60px',height:'60px',
      borderRadius:'4px',imageRendering:'pixelated'});
    const cx2=cv.getContext('2d');
    // checker
    for(let gy=0;gy<8;gy++) for(let gx=0;gx<8;gx++){
      cx2.fillStyle=(gx+gy)%2===0?'#3a3a3a':'#2a2a2a';
      cx2.fillRect(gx*8,gy*8,8,8);
    }
    // tip silhouette (white on checker)
    cx2.save();
    cx2.fillStyle='#ffffff';
    cx2.fillRect(0,0,64,64);
    cx2.globalCompositeOperation='destination-in';
    cx2.drawImage(b.canvas,0,0,64,64);
    cx2.restore();

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
      // Apply tip to engine
      if(typeof window.setBrushTip==='function') window.setBrushTip(b.canvas);
      // Route every other extracted parameter through the single ABR →
      // internal mapping layer, then apply size/spacing/mapped settings to
      // the live UI in one pass. Never overwrites with a guess — only with
      // a value this app actually found in the file.
      const mapped=_mapABRValuesToSettings(b.values);
      const clampedSize=_applyABRSettingsToUI(b.size, b.spacing, mapped);
      // Sync brush tip UI panel
      const fn=document.getElementById('ts-tip-filename');
      if(fn){fn.textContent=b.name;fn.style.display='';}
      overlay.classList.remove('visible');
      // When invoked from the "Import Brush" panel button, onImport saves
      // this tip as a brand-new persistent preset tile. When invoked from
      // the Tool Settings import (legacy path), onImport is omitted and
      // only the live tool tip is affected, as before.
      if(typeof onImport==='function') onImport(b);
      showInfo('Loaded "'+b.name+'" ('+clampedSize+'px) from '+filename+'.','ABR Import');
    });
  });

  overlay.classList.add('visible');
}