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

  // Lets the Preferences-open handler above refresh the list so it always
  // reflects the current stored preference when the modal is opened.
  window._renderRendererPreference=renderList;

  // Keep the UI in sync if something elsewhere in the app changes the
  // preference (e.g. another panel, or a future settings-sync feature).
  // #modal-preferences is a static overlay (index.html) that's toggled
  // via the .visible class and never removed/recreated, so there's no
  // unmount point to tie a removal call to today. The listener is still
  // kept as a named, stored reference — matching the removable-listener
  // pattern used elsewhere in this codebase (e.g. site-dialog.js) — so
  // BrushRenderer.removePreferenceChanged(_prefRendererListener) is a
  // trivial one-liner if a teardown path is ever introduced.
  function _prefRendererListener(){ renderList(); }
  window._prefRendererListener=_prefRendererListener;
  if(typeof window.BrushRenderer.onPreferenceChanged==='function'){
    window.BrushRenderer.onPreferenceChanged(_prefRendererListener);
  }

  renderList();
})();
document.getElementById('modal-preferences-close').onclick=()=>{
  document.getElementById('modal-preferences').classList.remove('visible');
};
document.getElementById('modal-preferences').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-preferences'))
    document.getElementById('modal-preferences').classList.remove('visible');
});