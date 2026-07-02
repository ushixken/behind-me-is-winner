// ═══ TOOL SETTINGS PANEL — wiring ═══════════════════════════
(function(){
  // Helper: range + display
  function bindRange(id,dispId,suffix,onchange){
    const el=document.getElementById(id);
    const disp=document.getElementById(dispId);
    if(!el||!disp) return;
    el.oninput=()=>{disp.textContent=el.value+(suffix||'');if(onchange)onchange(+el.value);};
  }
  // Flow / Opacity
  bindRange('ts-flow','ts-flow-val','',v=>{brushOpacity=v/100;});
  // Hardness
  bindRange('ts-hardness','ts-hardness-val','',v=>{brushHardness=v/100;_aaDabCache.clear();_stampCache.clear();});
  // Spacing (stored but influences stroke step)
  bindRange('ts-spacing','ts-spacing-val','%',v=>{window._tsSpacing=v/100;});
  // Airbrush spray rate (dabs/sec while held, independent of movement)
  bindRange('ts-airbrush-rate','ts-airbrush-rate-val','',v=>{window._tsAirbrushRate=v/100;});
  // Shape
  bindRange('ts-roundness','ts-roundness-val','',v=>{window._tsRoundness=v/100;_aaDabCache.clear();_stampCache.clear();});
  bindRange('ts-angle','ts-angle-val','°');
  // Dynamics
  bindRange('ts-size-jitter','ts-size-jitter-val','');
  bindRange('ts-min-size','ts-min-size-val','%');
  bindRange('ts-min-flow','ts-min-flow-val','%');
  bindRange('ts-angle-jitter','ts-angle-jitter-val','');
  bindRange('ts-round-jitter','ts-round-jitter-val','');
  bindRange('ts-min-round','ts-min-round-val','%');
  // Scattering
  bindRange('ts-scatter','ts-scatter-val','%');
  bindRange('ts-count','ts-count-val','');
  bindRange('ts-count-jitter','ts-count-jitter-val','');
  // Color Dynamics
  bindRange('ts-fgbg-jitter','ts-fgbg-jitter-val','');
  bindRange('ts-hue-jitter','ts-hue-jitter-val','');
  bindRange('ts-sat-jitter','ts-sat-jitter-val','');
  bindRange('ts-bri-jitter','ts-bri-jitter-val','');
  bindRange('ts-purity','ts-purity-val','');
  // Transfer / Texture
  bindRange('ts-texture-scale','ts-texture-scale-val','%');
  bindRange('ts-texture-depth','ts-texture-depth-val','');
  // Stabilizer
  bindRange('ts-stabilize-strength','ts-stabilize-str-val','');
  bindRange('ts-stabilize-delay','ts-stabilize-delay-val','');
  // Correction
  bindRange('ts-postcorrect','ts-postcorrect-val','');
  bindRange('ts-ink-amount','ts-ink-amount-val','');
  // Wetness
  bindRange('ts-wetness','ts-wetness-val','');
  bindRange('ts-mix-color','ts-mix-color-val','');
  bindRange('ts-persistence','ts-persistence-val','');

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

  // Section collapse/expand
  document.querySelectorAll('.ts-section-hd').forEach(hd=>{
    hd.onclick=()=>{
      const body=hd.nextElementSibling;
      const collapsed=hd.classList.toggle('collapsed');
      body.style.display=collapsed?'none':'flex';
    };
  });

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
  document.getElementById('ts-flow-val').textContent=document.getElementById('ts-flow').value;
  document.getElementById('ts-hardness-val').textContent=document.getElementById('ts-hardness').value;

  // ── Mark not-yet-implemented controls as Coming Soon ────────────────
  const COMING_SOON='Coming Soon — This feature will be available in a future update.';
  const _tsNotImplemented=['ts-tip-shape','ts-roundness','ts-angle','ts-flip-x','ts-flip-y',
    'ts-size-jitter','ts-angle-jitter','ts-angle-control','ts-round-jitter','ts-min-round',
    'ts-scatter-both-axes','ts-scatter','ts-count','ts-count-jitter',
    'ts-color-apply','ts-fgbg-jitter','ts-hue-jitter','ts-sat-jitter','ts-bri-jitter','ts-purity',
    'ts-blend-mode','ts-texture','ts-texture-scale','ts-texture-depth','ts-texture-each',
    'ts-stabilize-mode','ts-stabilize-strength','ts-stabilize-delay','ts-tail-action',
    'ts-postcorrect','ts-correct-begin','ts-correct-end','ts-ink-amount','ts-ink-type',
    'ts-wetness','ts-mix-color','ts-persistence','ts-smear-color'];
  _tsNotImplemented.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.disabled=true;
    const row=el.closest('.ts-row');
    if(row && !row.classList.contains('ts-disabled')){
      row.classList.add('ts-disabled');
      row.title=COMING_SOON;
      const label=row.querySelector('.ts-label,.ts-label-sm');
      if(label && !label.querySelector('.ts-lock-icon')){
        const lock=document.createElement('span');
        lock.className='ts-lock-icon';
        lock.textContent='🔒';
        label.prepend(lock);
      }
      if(!row.querySelector('.ts-soon-badge')){
        const badge=document.createElement('span');
        badge.className='ts-soon-badge';
        badge.textContent='Coming Soon';
        row.appendChild(badge);
      }
    }
  });

})(); // end Tool Settings panel init

// Preset get/apply
function getToolPreset(){
  const ids=['ts-size','ts-flow','ts-hardness','ts-spacing','ts-roundness','ts-angle','ts-airbrush','ts-airbrush-rate',
    'ts-size-jitter','ts-min-size','ts-size-control','ts-opacity-control','ts-min-flow','ts-angle-jitter','ts-angle-control',
    'ts-round-jitter','ts-min-round','ts-scatter','ts-count','ts-count-jitter',
    'ts-fgbg-jitter','ts-hue-jitter','ts-sat-jitter','ts-bri-jitter','ts-purity',
    'ts-blend-mode','ts-texture','ts-texture-scale','ts-texture-depth',
    'ts-stabilize-mode','ts-stabilize-strength','ts-stabilize-delay',
    'ts-postcorrect','ts-ink-amount','ts-ink-type',
    'ts-wetness','ts-mix-color','ts-persistence'];
  const out={};
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(el) out[id]=(el.type==='checkbox'?el.checked:el.value);
  });
  out['ts-aa']=document.getElementById('ts-aa').checked;
  out['ts-flip-x']=document.getElementById('ts-flip-x').checked;
  out['ts-flip-y']=document.getElementById('ts-flip-y').checked;
  return out;
}
function applyToolPreset(json){
  Object.entries(json).forEach(([id,val])=>{
    const el=document.getElementById(id);
    if(!el) return;
    if(el.type==='checkbox') el.checked=!!val;
    else el.value=val;
    el.dispatchEvent(new Event('input'));
  });
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
      preview:{shape:'circle',hardness:0.55},
      settings:{'ts-size':12,'ts-hardness':55,'ts-flow':100,'ts-spacing':12,'ts-roundness':100,'ts-aa':true}
    },
    {
      id:'soft-round', name:'Soft Round',
      preview:{shape:'circle',hardness:0.05},
      settings:{'ts-size':30,'ts-hardness':0,'ts-flow':80,'ts-spacing':15,'ts-roundness':100,'ts-aa':true}
    },
    {
      // Photoshop / Clip Studio style airbrush: very soft round tip, low
      // per-dab flow, tight spacing for a smooth spray-cone edge, and the
      // 'ts-airbrush' flag turns on the "keeps spraying/building up while
      // held still" behavior in the engine (see _startAirbrushSpray in
      // brush-engine.js) — this is the one thing that makes it feel like a
      // real airbrush instead of just another soft round brush.
      id:'airbrush', name:'Airbrush',
      preview:{shape:'circle',hardness:0},
      settings:{'ts-size':60,'ts-hardness':0,'ts-flow':18,'ts-spacing':8,'ts-roundness':100,'ts-aa':true,'ts-airbrush':true,'ts-airbrush-rate':55}
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
      ids:['hard-round','soft-round','airbrush'] }
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
        'ts-flow':       Math.round(brushOpacity * 100),
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
    brush:  {presetId:'hard-round', size:12, hardness:55,  flow:100, spacing:12, roundness:100, aa:true, airbrush:false},
    eraser: {presetId:'hard-round', size:20, hardness:55, flow:100, spacing:12, roundness:100, aa:true, airbrush:false},
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
    drawPreview(cvs, Object.assign({}, p.preview, {isEraser:_activeTab==='eraser'}));
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
      'ts-flow': {slider:'ts-flow', val:'ts-flow-val', suffix:'', extra: v=>{brushOpacity=v/100;}},
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
    st.flow = Math.round(brushOpacity*100);
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
    brushOpacity=st.flow/100;
    window._tsSpacing=st.spacing/100;
    window._tsRoundness=st.roundness/100;
    brushAA=!!st.aa;
    _aaDabCache.clear();_stampCache.clear();
    _activePresetId=st.presetId;
    const setv=(id,v,suf)=>{const el=document.getElementById(id); if(el) el.value=v; const ve=document.getElementById(id+'-val'); if(ve) ve.textContent=v+(suf||'');};
    setv('ts-hardness',st.hardness); setv('ts-flow',st.flow);
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
    const flow = Math.round(brushOpacity*100);
    const spacing = spEl ? +spEl.value : 12;
    const roundness = rdEl ? +rdEl.value : 100;
    const preset = {
      id, name, custom:true,
      preview:{ shape: roundness<60?'ellipse':'circle', hardness: hardness/100, aliased:!brushAA },
      settings:{ 'ts-size':size, 'ts-hardness':hardness, 'ts-flow':flow, 'ts-spacing':spacing, 'ts-roundness':roundness, 'ts-aa':!!brushAA }
    };
    _customPresets.push(preset);
    _seedPresetSettings(preset); // give it its own settings slot immediately
    const general = _groups.find(g=>g.default) || _groups[0];
    general.ids.push(id);
    persist();
    buildGrid();
    selectPreset(id);
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
  // Keyboard shortcut: A
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT') return;
    if(e.key==='a'||e.key==='A'){window._setBrushAA(!brushAA);}
  });
  updateAABtn();
})();
document.getElementById('onion-chk').onchange=updateOnion;