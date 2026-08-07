// ════════════════════════════════════════════════════════════════
// PREFERENCES — app-wide settings modal (Edit ▸ Preferences)
// Sidebar-tabbed panel (Cursor / Performance / Local Storage). Each
// tab's settings are saved to localStorage independently by their
// respective owning modules (cursor style, renderer preference, etc.)
// This file only owns the modal shell, tab switching, and the
// per-tab UI wiring — it does not own any of the underlying state.
// Split out of keybinds.js, which historically also held this modal.
// ════════════════════════════════════════════════════════════════

// ── PREFERENCES MODAL (Edit ▸ Preferences) ──────────────────────────────
// Sidebar tab-switching, mirroring the Advanced Tool Settings layout but
// scoped to pref-ps-* elements only (ts-ps-* is queried globally by
// brush-presets.js, so reusing those classes here would collide with it).
(function initPrefPsNav(){
  const navItems=document.querySelectorAll('#pref-ps-sidebar .pref-ps-nav-item');
  const panels=document.querySelectorAll('.pref-ps-panels .pref-ps-panel');
  function activate(panelId){
    navItems.forEach(item=>item.classList.toggle('active',item.dataset.panel===panelId));
    panels.forEach(panel=>panel.classList.toggle('active',panel.dataset.panel===panelId));
    if(panelId==='storage' && typeof window._renderLocalStorage==='function') window._renderLocalStorage();
  }
  navItems.forEach(item=>{
    item.addEventListener('click',()=>{
      const panelId=item.dataset.panel;
      if(panelId) activate(panelId);
    });
  });
  // Lets other modules (e.g. local-storage-panel.js's menu item) open
  // Preferences directly to a specific tab instead of always "Cursor".
  window._prefPsActivate=activate;
})();

document.getElementById('dd-preferences').onclick=()=>{
  const cursorRadio=document.getElementById('pref-cursor-'+cursorStyle);
  (cursorRadio||document.getElementById('pref-cursor-crosshair')).checked=true;
  document.getElementById('modal-preferences').classList.add('visible');
  // If Storage happens to still be the active tab from a prior open, make
  // sure its list reflects anything saved/changed since then.
  const storagePanel=document.querySelector('.pref-ps-panel[data-panel="storage"]');
  if(storagePanel && storagePanel.classList.contains('active') && typeof window._renderLocalStorage==='function'){
    window._renderLocalStorage();
  }
  if(typeof window._renderRendererPreference==='function') window._renderRendererPreference();
  closeAllDropdowns();
};
document.getElementById('pref-cursor-crosshair').onchange=e=>{ if(e.target.checked) _setCursorStyle('crosshair'); };
document.getElementById('pref-cursor-point').onchange=e=>{ if(e.target.checked) _setCursorStyle('point'); };
document.getElementById('pref-cursor-brush').onchange=e=>{ if(e.target.checked) _setCursorStyle('brush'); };
document.getElementById('pref-cursor-brush-shape').onchange=e=>{ if(e.target.checked) _setCursorStyle('brush-shape'); };

// ── PERFORMANCE ▸ RENDERER PREFERENCE ────────────────────────────────
// Renderer options are pulled from BrushRenderer.getRendererOptions(),
// never hardcoded here — this list is display-only, selection-only.
// Choosing an option only calls BrushRenderer.selectPreferredRenderer(),
// which stores the preference; it never activates or switches renderers
// (that remains a separate, later step). Labels show only the renderer
// name — no adapter/device/pipeline/GPU internals are ever surfaced.
(function initPrefRenderer(){
  const listEl=document.getElementById('pref-renderer-list');
  if(!listEl || typeof window.BrushRenderer==='undefined') return;

  // Phase 4K: status block lives right under the option list. Created
  // once here (not recreated every render) and reused by renderStatus()
  // below, matching the same "query once, update in place" approach
  // used by the rest of this panel.
  const statusEl=document.createElement('div');
  statusEl.id='pref-renderer-status';
  statusEl.style.cssText='margin-top:10px;padding:8px;border-radius:8px;border:1px solid var(--border2);font-size:11px;color:var(--text2);line-height:1.6;';
  listEl.insertAdjacentElement('afterend',statusEl);

  // Phase 4L: explicit Apply button. Selecting an option only ever
  // stores a preference (see the radio onchange below) — this button
  // is the single place in the Preferences UI allowed to trigger
  // activation, via the existing applyPreferredRenderer().
  const applyBtn=document.createElement('button');
  applyBtn.type='button';
  applyBtn.id='pref-renderer-apply';
  applyBtn.className='modal-btn';
  applyBtn.style.cssText='margin-top:10px;';
  applyBtn.textContent='Apply Renderer';
  statusEl.insertAdjacentElement('afterend',applyBtn);

  // Phase 4N: Run Renderer Test button — checks whether the currently
  // preferred renderer can initialize/verify itself, without switching
  // the active renderer. Sits right below Apply Renderer.
  const testBtn=document.createElement('button');
  testBtn.type='button';
  testBtn.id='pref-renderer-test';
  testBtn.className='modal-btn';
  testBtn.style.cssText='margin-top:6px;';
  testBtn.textContent='Run Renderer Test';
  applyBtn.insertAdjacentElement('afterend',testBtn);

  // Phase 4R: Reset Active Renderer button — resets the currently
  // active renderer's diagnostic/resource state via
  // BrushRenderer.resetActiveRenderer(). No activation, no switching:
  // never calls applyPreferredRenderer()/activateRenderer()/
  // setActiveRenderer().
  const resetBtn=document.createElement('button');
  resetBtn.type='button';
  resetBtn.id='pref-renderer-reset';
  resetBtn.className='modal-btn';
  resetBtn.style.cssText='margin-top:6px;';
  resetBtn.textContent='Reset Active Renderer';
  testBtn.insertAdjacentElement('afterend',resetBtn);

  // Phase 4P: diagnostics block for the last applyPreferredRenderer()
  // outcome. Sits below the existing status section (after the test
  // button). Read-only — sourced only from
  // BrushRenderer.getRendererApplyStatus(), never from _gpuState or any
  // GPU internals. No activation call is made here.
  const diagnosticsEl=document.createElement('div');
  diagnosticsEl.id='pref-renderer-diagnostics';
  diagnosticsEl.style.cssText='margin-top:10px;padding:8px;border-radius:8px;border:1px solid var(--border2);font-size:11px;color:var(--text2);line-height:1.6;';
  resetBtn.insertAdjacentElement('afterend',diagnosticsEl);

  // Phase 4Q: read-only Renderer History section, below diagnostics.
  // Sourced only from BrushRenderer.getRendererApplyHistory() — a
  // public API returning a copy of the bounded (newest-10) history.
  // No activation calls, no GPU internals.
  const historyEl=document.createElement('div');
  historyEl.id='pref-renderer-history';
  historyEl.style.cssText='margin-top:10px;padding:8px;border-radius:8px;border:1px solid var(--border2);font-size:11px;color:var(--text2);line-height:1.6;';
  diagnosticsEl.insertAdjacentElement('afterend',historyEl);

  function renderList(){
    if(typeof window.BrushRenderer.getRendererOptions!=='function') return;
    const options=window.BrushRenderer.getRendererOptions();
    const current=typeof window.BrushRenderer.getPreferredRenderer==='function'
      ?window.BrushRenderer.getPreferredRenderer()
      :null;
    listEl.innerHTML='';
    options.forEach(opt=>{
      const label=document.createElement('label');
      label.style.cssText='display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:8px;border:1px solid var(--border2);cursor:pointer;margin-bottom:6px;';
      const input=document.createElement('input');
      input.type='radio';
      input.name='pref-renderer';
      input.id='pref-renderer-'+opt.name;
      input.value=opt.name;
      input.style.marginTop='2px';
      input.checked=(opt.name===current);
      input.disabled=!opt.available;
      input.onchange=e=>{
        if(e.target.checked && typeof window.BrushRenderer.selectPreferredRenderer==='function'){
          window.BrushRenderer.selectPreferredRenderer(opt.name);
        }
      };
      const span=document.createElement('span');
      const title=document.createElement('span');
      title.style.cssText='font-weight:600;color:var(--text);display:block;';
      title.textContent=opt.name.toUpperCase();
      span.appendChild(title);
      if(!opt.available){
        const sub=document.createElement('span');
        sub.style.cssText='font-size:11px;color:var(--text2);';
        sub.textContent='Not available on this device.';
        span.appendChild(sub);
      }
      label.appendChild(input);
      label.appendChild(span);
      listEl.appendChild(label);
    });
  }

  // Phase 4K: pure status readout — active renderer, preferred
  // renderer, and a plain-language availability line, sourced only
  // from getRendererStatus()/getPreferredRenderer()/getActiveRenderer().
  // Preferred and active are always shown as two separate lines so a
  // mismatch (e.g. preferred "gpu" while active is still "cpu" because
  // GPU init failed) is never hidden or merged into one line.
  function renderStatus(){
    if(typeof window.BrushRenderer.getRendererStatus!=='function'){
      statusEl.textContent='';
      return;
    }
    const status=window.BrushRenderer.getRendererStatus();
    const preferred=(typeof window.BrushRenderer.getPreferredRenderer==='function'
      ?window.BrushRenderer.getPreferredRenderer()
      :status.active)||'';
    const active=(typeof window.BrushRenderer.getActiveRenderer==='function'
      ?window.BrushRenderer.getActiveRenderer()
      :status.active)||'';

    statusEl.innerHTML='';
    const preferredLine=document.createElement('div');
    preferredLine.innerHTML='<b style="color:var(--text);">Preferred:</b> '+(preferred?preferred.toUpperCase():'—');
    const activeLine=document.createElement('div');
    activeLine.innerHTML='<b style="color:var(--text);">Active:</b> '+(active?active.toUpperCase():'—');
    statusEl.appendChild(preferredLine);
    statusEl.appendChild(activeLine);

    // Plain-language status line. Only compares names/init flags already
    // exposed by getRendererStatus() — no _gpuState/adapter/device access.
    const statusLine=document.createElement('div');
    let statusText;
    if(preferred && active && preferred!==active){
      const initialized=status.initialized && status.initialized[preferred];
      const errorMsg=status.errors && status.errors[preferred];
      statusText=preferred.toUpperCase()+' unavailable';
      if(errorMsg) statusText+=': '+errorMsg;
      else if(initialized===false) statusText+=' (not initialized)';
    }else if(active){
      statusText=active.toUpperCase()+' active';
    }else{
      statusText='Unknown';
    }
    statusLine.innerHTML='<b style="color:var(--text);">Status:</b> '+statusText;
    statusEl.appendChild(statusLine);

    // Phase 4M: per-renderer initialization diagnostic line, sourced
    // only from getRendererStatus().errors — a plain safe string per
    // renderer (e.g. "webgpu-unsupported"), never a GPU object. Shown
    // only for the preferred renderer when it isn't CPU, since that's
    // the renderer whose init outcome the user actually cares about
    // right now. "Ready" is shown when initialized with no error.
    if(preferred){
      const diagLine=document.createElement('div');
      const preferredErr=status.errors && status.errors[preferred];
      const preferredInitialized=status.initialized && status.initialized[preferred];
      let diagText;
      if(preferredErr){
        diagText=preferredErr;
      }else if(preferredInitialized){
        diagText='Ready';
      }else{
        diagText='Not yet initialized';
      }
      diagLine.innerHTML='<b style="color:var(--text);">'+preferred.toUpperCase()+' status:</b> '+diagText;
      statusEl.appendChild(diagLine);
    }
  }

  // Phase 4P: read-only readout of the last applyPreferredRenderer()
  // result, sourced solely from BrushRenderer.getRendererApplyStatus().
  // Renderer names stay dynamic (whatever the status reports) — never
  // hardcoded to "cpu"/"gpu". No activation call is made from here.
  function renderDiagnostics(){
    if(typeof window.BrushRenderer.getRendererApplyStatus!=='function'){
      diagnosticsEl.textContent='';
      return;
    }
    const applyStatus=window.BrushRenderer.getRendererApplyStatus();

    diagnosticsEl.innerHTML='';

    const heading=document.createElement('div');
    heading.style.cssText='font-weight:600;color:var(--text);';
    heading.textContent='Last Apply Result';
    diagnosticsEl.appendChild(heading);

    const resultLine=document.createElement('div');
    let resultText;
    if(applyStatus.result===true) resultText='Success';
    else if(applyStatus.result===false) resultText='Failed';
    else resultText='Not run yet';
    resultLine.innerHTML='<b style="color:var(--text);">Result:</b> '+resultText;
    diagnosticsEl.appendChild(resultLine);

    const preferredLine=document.createElement('div');
    preferredLine.innerHTML='<b style="color:var(--text);">Preferred used:</b> '+
      (applyStatus.preferred?String(applyStatus.preferred).toUpperCase():'—');
    diagnosticsEl.appendChild(preferredLine);

    const activeLine=document.createElement('div');
    activeLine.innerHTML='<b style="color:var(--text);">Active after apply:</b> '+
      (applyStatus.active?String(applyStatus.active).toUpperCase():'—');
    diagnosticsEl.appendChild(activeLine);

    if(applyStatus.error){
      const errorLine=document.createElement('div');
      errorLine.innerHTML='<b style="color:var(--text);">Error:</b> '+applyStatus.error;
      diagnosticsEl.appendChild(errorLine);
    }

    const timeLine=document.createElement('div');
    let timeText='—';
    if(applyStatus.time){
      try{
        timeText=new Date(applyStatus.time).toLocaleString();
      }catch(e){
        timeText=String(applyStatus.time);
      }
    }
    timeLine.innerHTML='<b style="color:var(--text);">Timestamp:</b> '+timeText;
    diagnosticsEl.appendChild(timeLine);
  }

  // Phase 4Q: read-only readout of the apply-attempt history, sourced
  // solely from BrushRenderer.getRendererApplyHistory(). Renderer names
  // stay dynamic — never hardcoded. No activation call is made here.
  function renderHistory(){
    if(typeof window.BrushRenderer.getRendererApplyHistory!=='function'){
      historyEl.textContent='';
      return;
    }
    const history=window.BrushRenderer.getRendererApplyHistory();

    historyEl.innerHTML='';

    const heading=document.createElement('div');
    heading.style.cssText='font-weight:600;color:var(--text);';
    heading.textContent='Renderer History';
    historyEl.appendChild(heading);

    if(!history || history.length===0){
      const emptyLine=document.createElement('div');
      emptyLine.textContent='No apply attempts yet.';
      historyEl.appendChild(emptyLine);
      return;
    }

    // Newest first for readability.
    history.slice().reverse().forEach(record=>{
      const entry=document.createElement('div');
      entry.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid var(--border2);';

      const resultText=record.result===true?'Success':(record.result===false?'Failed':'Not run yet');
      let timeText='—';
      if(record.time){
        try{
          timeText=new Date(record.time).toLocaleString();
        }catch(e){
          timeText=String(record.time);
        }
      }

      const line1=document.createElement('div');
      line1.innerHTML='<b style="color:var(--text);">'+timeText+'</b> — '+resultText;
      entry.appendChild(line1);

      const line2=document.createElement('div');
      line2.textContent='Preferred: '+(record.preferred?String(record.preferred).toUpperCase():'—')+
        '  •  Active: '+(record.active?String(record.active).toUpperCase():'—');
      entry.appendChild(line2);

      if(record.error){
        const line3=document.createElement('div');
        line3.textContent='Error: '+record.error;
        entry.appendChild(line3);
      }

      historyEl.appendChild(entry);
    });
  }

  function renderAll(){
    renderList();
    renderStatus();
    renderDiagnostics();
    renderHistory();
  }

  // Phase 4L: guards against duplicate simultaneous apply requests and
  // restores the button's label/enabled state once the attempt settles,
  // whether it succeeds or fails. applyPreferredRenderer() already
  // leaves the current renderer active on failure (see Phase 4A/4J) —
  // this handler just re-reads status afterward and never throws.
  let _applyInProgress=false;
  applyBtn.addEventListener('click',async()=>{
    if(_applyInProgress) return;
    if(typeof window.BrushRenderer.applyPreferredRenderer!=='function') return;
    _applyInProgress=true;
    const originalLabel=applyBtn.textContent;
    applyBtn.disabled=true;
    applyBtn.textContent='Applying…';
    try{
      await window.BrushRenderer.applyPreferredRenderer();
    }catch(e){
      // Swallow — failure is reflected via renderStatus() below, not
      // by throwing out of a UI click handler.
    }finally{
      renderAll();
      applyBtn.disabled=false;
      applyBtn.textContent=originalLabel;
      _applyInProgress=false;
    }
  });

  // Phase 4N: tests the currently preferred renderer only —
  // BrushRenderer.getPreferredRenderer() supplies the name, so this
  // never hardcodes "cpu"/"gpu". selfTestRenderer() only checks/
  // initializes; it never activates. Same guard/restore pattern as
  // the Apply button above.
  let _testInProgress=false;
  testBtn.addEventListener('click',async()=>{
    if(_testInProgress) return;
    if(typeof window.BrushRenderer.selfTestRenderer!=='function') return;
    if(typeof window.BrushRenderer.getPreferredRenderer!=='function') return;
    _testInProgress=true;
    const originalLabel=testBtn.textContent;
    testBtn.disabled=true;
    testBtn.textContent='Testing…';
    let passed=false;
    try{
      const name=window.BrushRenderer.getPreferredRenderer();
      passed=await window.BrushRenderer.selfTestRenderer(name);
    }catch(e){
      passed=false;
    }finally{
      renderAll();
      testBtn.disabled=false;
      testBtn.textContent=originalLabel;
      _testInProgress=false;
      if(typeof window.siteAlert==='function'){
        window.siteAlert(passed?'Renderer test passed':'Renderer test failed',{title:'Renderer Test'});
      }
    }
  });

  // Phase 4R: guards against duplicate simultaneous reset requests and
  // restores the button's label/enabled state once it settles.
  // resetActiveRenderer() never activates or switches renderers —
  // applyPreferredRenderer()/activateRenderer()/setActiveRenderer() are
  // never called from this handler.
  let _resetInProgress=false;
  resetBtn.addEventListener('click',()=>{
    if(_resetInProgress) return;
    if(typeof window.BrushRenderer.resetActiveRenderer!=='function') return;
    _resetInProgress=true;
    const originalLabel=resetBtn.textContent;
    resetBtn.disabled=true;
    resetBtn.textContent='Resetting…';
    try{
      window.BrushRenderer.resetActiveRenderer();
    }catch(e){
      // Swallow — any resulting state is reflected via renderAll() below.
    }finally{
      renderAll();
      resetBtn.disabled=false;
      resetBtn.textContent=originalLabel;
      _resetInProgress=false;
    }
  });

  // Lets the Preferences-open handler above refresh the list so it always
  // reflects the current stored preference when the modal is opened.
  window._renderRendererPreference=renderAll;

  // Keep the UI in sync if something elsewhere in the app changes the
  // preference (e.g. another panel, or a future settings-sync feature).
  // #modal-preferences is a static overlay (index.html) that's toggled
  // via the .visible class and never removed/recreated, so there's no
  // unmount point to tie a removal call to today — cleanup is therefore
  // not required under the existing architecture, and none is faked
  // here. The listener is still kept as a named, stored reference —
  // matching the removable-listener pattern used elsewhere in this
  // codebase (e.g. site-dialog.js) — so
  // BrushRenderer.removePreferenceChanged(_prefRendererListener) is a
  // trivial one-liner if a teardown path is ever introduced.
  function _prefRendererListener(){ renderAll(); }
  window._prefRendererListener=_prefRendererListener;
  if(typeof window.BrushRenderer.onPreferenceChanged==='function'){
    window.BrushRenderer.onPreferenceChanged(_prefRendererListener);
  }

  renderAll();
})();
document.getElementById('modal-preferences-close').onclick=()=>{
  document.getElementById('modal-preferences').classList.remove('visible');
};
document.getElementById('modal-preferences').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-preferences'))
    document.getElementById('modal-preferences').classList.remove('visible');
});