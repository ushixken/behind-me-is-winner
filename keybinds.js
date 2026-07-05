// ════════════════════════════════════════════════════════════════
// KEYBINDS — user-customizable keyboard shortcuts
// Edited via Settings ▸ Keybinds. Persisted to localStorage.
// ════════════════════════════════════════════════════════════════
const KEYBIND_STORE_KEY='keybinds_v1';

const KEYBIND_DEFAULTS={
  undo:        {label:'Undo',               key:'z',          ctrl:true,  shift:false, alt:false},
  redo:        {label:'Redo',               key:'y',          ctrl:true,  shift:false, alt:false},
  copyFrame:   {label:'Copy Frame',         key:'c',          ctrl:true,  shift:false, alt:false},
  cutFrame:    {label:'Cut Frame',          key:'x',          ctrl:true,  shift:false, alt:false},
  pasteFrame:  {label:'Paste Frame',        key:'v',          ctrl:true,  shift:false, alt:false},
  pasteImage:  {label:'Paste Image',        key:'v',          ctrl:true,  shift:true,  alt:false},
  clearFrame:  {label:'Clear Frame',        key:'Delete',     ctrl:false, shift:false, alt:false},
  toolBrush:   {label:'Brush Tool',         key:'b',          ctrl:false, shift:false, alt:false},
  toolEraser:  {label:'Eraser Tool',        key:'e',          ctrl:false, shift:false, alt:false},
  toolFill:    {label:'Fill Tool',          key:'f',          ctrl:false, shift:false, alt:false},
  toolLine:    {label:'Line Tool',          key:'l',          ctrl:false, shift:false, alt:false},
  toolTransform: {label:'Transform Tool',   key:'t',          ctrl:false, shift:false, alt:false},
  newFrame:    {label:'New Blank Keyframe', key:'n',          ctrl:false, shift:false, alt:false},
  delKeyframe: {label:'Delete Keyframe',    key:'Delete',     ctrl:false, shift:true,  alt:false},
  nextFrame:   {label:'Next Frame',         key:'ArrowRight', ctrl:false, shift:false, alt:false},
  prevFrame:   {label:'Previous Frame',     key:'ArrowLeft',  ctrl:false, shift:false, alt:false},
  zoomIn:      {label:'Zoom In',            key:'=',          ctrl:true,  shift:false, alt:false},
  zoomOut:     {label:'Zoom Out',           key:'-',          ctrl:true,  shift:false, alt:false},
  zoomReset:   {label:'Reset Zoom',         key:'0',          ctrl:true,  shift:false, alt:false},
  rotateReset: {label:'Reset Rotation',     key:'0',          ctrl:true,  shift:true,  alt:false},
  flipHorizontal: {label:'Flip Horizontal', key:'h',          ctrl:false, shift:false, alt:false},
  flipVertical:   {label:'Flip Vertical',   key:'v',          ctrl:false, shift:false, alt:false},
  brushResize:    {label:'Resize Brush (hold + drag)', key:'s', ctrl:false, shift:false, alt:false},
  flipperBypass:  {label:'Flipper: Enable Bypass (hold)', key:'Shift', ctrl:false, shift:false, alt:false},
};

let keybinds={};

function loadKeybinds(){
  keybinds=JSON.parse(JSON.stringify(KEYBIND_DEFAULTS));
  try{
    const raw=localStorage.getItem(KEYBIND_STORE_KEY);
    if(raw){
      const saved=JSON.parse(raw);
      for(const action in saved){
        if(keybinds[action]) Object.assign(keybinds[action],saved[action]);
      }
    }
  }catch(e){}
}
function saveKeybinds(){
  try{
    const toSave={};
    for(const action in keybinds){
      const b=keybinds[action];
      toSave[action]={key:b.key,ctrl:b.ctrl,shift:b.shift,alt:b.alt};
    }
    localStorage.setItem(KEYBIND_STORE_KEY,JSON.stringify(toSave));
  }catch(e){}
}
loadKeybinds();

// '+' and '=' share a physical key (Shift+= types '+'); treat them as one
// so rebinding either still matches the same combo the user pressed.
function _normKey(k){ return k==='+' ? '=' : k; }

// Returns true if the given KeyboardEvent matches the bound combo for `action`
function matchBind(e,action){
  const b=keybinds[action];
  if(!b) return false;
  const bk=_normKey(b.key.length===1?b.key.toLowerCase():b.key);
  const ek=_normKey(e.key.length===1?e.key.toLowerCase():e.key);
  if(ek!==bk) return false;
  // When the flipper bypass hold is active, its modifier key (e.g. Shift)
  // should be transparent — don't let it break other keybinds that don't
  // require that modifier. Strip it from the event's effective modifiers.
  let ctrlHeld=!!e.ctrlKey, shiftHeld=!!e.shiftKey, altHeld=!!e.altKey;
  if(action!=='flipperBypass' && window._flipperBypassHeld){
    const bypassKey=(keybinds['flipperBypass']||{}).key||'';
    // Only strip the bypass modifier if THIS bind doesn't itself require it —
    // otherwise a bind like Shift+E would never see its required shift.
    if(bypassKey==='Shift' && !b.shift) shiftHeld=false;
    else if(bypassKey==='Control' && !b.ctrl) ctrlHeld=false;
    else if(bypassKey==='Alt' && !b.alt) altHeld=false;
  }
  if(!!b.ctrl!==ctrlHeld) return false;
  if(!!b.shift!==shiftHeld) return false;
  if(!!b.alt!==altHeld) return false;
  return true;
}

function formatBind(b){
  const parts=[];
  if(b.ctrl) parts.push('Ctrl');
  if(b.shift) parts.push('Shift');
  if(b.alt) parts.push('Alt');
  let k=b.key;
  if(k==='ArrowRight') k='→';
  else if(k==='ArrowLeft') k='←';
  else if(k==='ArrowUp') k='↑';
  else if(k==='ArrowDown') k='↓';
  else if(k===' ') k='Space';
  else k=k.length===1?k.toUpperCase():k;
  parts.push(k);
  return parts.join('+');
}

// Find another action already bound to this exact combo, if any
function findBindConflict(action,combo){
  for(const a in keybinds){
    if(a===action) continue;
    const b=keybinds[a];
    if(_normKey(b.key.toLowerCase())===_normKey(combo.key.toLowerCase())&&
       !!b.ctrl===!!combo.ctrl&&!!b.shift===!!combo.shift&&!!b.alt===!!combo.alt) return a;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// KEYBINDS MODAL UI
// ════════════════════════════════════════════════════════════════
function renderKeybindsList(){
  const list=document.getElementById('keybinds-list');
  if(!list) return;
  const searchEl=document.getElementById('keybinds-search');
  const q=(searchEl?searchEl.value:'').trim().toLowerCase();
  list.innerHTML='';
  let anyVisible=false;
  for(const action in keybinds){
    const b=keybinds[action];
    if(q && !b.label.toLowerCase().includes(q) && !formatBind(b).toLowerCase().includes(q)) continue;
    anyVisible=true;
    const row=document.createElement('div');
    row.className='modal-row';
    const label=document.createElement('label');
    label.style.width='150px';
    label.textContent=b.label;
    const btn=document.createElement('button');
    btn.className='modal-btn';
    btn.style.flex='1';
    btn.textContent=formatBind(b);
    btn.title='Click, then press a new key combo';
    btn.onclick=()=>startRebind(action,btn);
    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  }
  if(!anyVisible){
    const empty=document.createElement('div');
    empty.style.cssText='padding:14px 0;text-align:center;font-size:12px;color:var(--text2);';
    empty.textContent='No keybinds match "'+q+'"';
    list.appendChild(empty);
  }
}

let _rebindListener=null;

function startRebind(action,btn){
  cancelRebind();
  const prevText=btn.textContent;
  btn.textContent='Press a key…';
  btn.classList.add('primary');
  _rebindListener=(e)=>{
    e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){ cancelRebind(); renderKeybindsList(); return; }
    if(['Control','Shift','Alt','Meta'].includes(e.key)) return; // wait for a real key
    const combo={key:e.key,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey};
    const conflict=findBindConflict(action,combo);
    cancelRebind();
    if(conflict){
      showKeybindConflict(combo,keybinds[conflict].label,keybinds[action].label,()=>{
        keybinds[action]=Object.assign({},keybinds[action],combo);
        saveKeybinds();
        renderKeybindsList();
        syncKeybindMenuLabels();
      },()=>{
        renderKeybindsList();
      });
      return;
    }
    keybinds[action]=Object.assign({},keybinds[action],combo);
    saveKeybinds();
    renderKeybindsList();
    syncKeybindMenuLabels();
  };
  window.addEventListener('keydown',_rebindListener,{capture:true});
}

// Modal shown when a chosen key combo conflicts with an existing bind.
// onSwap is called if the user confirms; onCancel if they back out.
function showKeybindConflict(combo,conflictLabel,actionLabel,onSwap,onCancel){
  const modal=document.getElementById('modal-keybind-conflict');
  document.getElementById('modal-keybind-conflict-msg').textContent=
    `"${formatBind(combo)}" is already used by "${conflictLabel}". Swap it onto "${actionLabel}"? This will clear it from "${conflictLabel}".`;
  modal.classList.add('visible');
  const swapBtn=document.getElementById('modal-keybind-conflict-swap');
  const cancelBtn=document.getElementById('modal-keybind-conflict-cancel');
  const cleanup=()=>{
    modal.classList.remove('visible');
    swapBtn.onclick=null;cancelBtn.onclick=null;
    modal.onclick=null;
  };
  swapBtn.onclick=()=>{ cleanup(); if(onSwap) onSwap(); };
  cancelBtn.onclick=()=>{ cleanup(); if(onCancel) onCancel(); };
  modal.onclick=(e)=>{ if(e.target===modal){ cleanup(); if(onCancel) onCancel(); } };
}
function cancelRebind(){
  if(_rebindListener) window.removeEventListener('keydown',_rebindListener,{capture:true});
  _rebindListener=null;
}

// Keep the static menu-bar shortcut labels (Edit menu, etc.) in sync
const KEYBIND_MENU_LABELS={
  undo:'dd-undo', redo:'dd-redo', cutFrame:'dd-cut', copyFrame:'dd-copy',
  pasteFrame:'dd-paste', pasteImage:'dd-paste-image', clearFrame:'dd-clear'
};
function syncKeybindMenuLabels(){
  for(const action in KEYBIND_MENU_LABELS){
    const item=document.getElementById(KEYBIND_MENU_LABELS[action]);
    if(!item) continue;
    const span=item.querySelector('.dd-shortcut');
    if(span) span.textContent=formatBind(keybinds[action]);
  }
}
syncKeybindMenuLabels();

const _keybindSearchInput=document.getElementById('keybinds-search');
if(_keybindSearchInput){
  _keybindSearchInput.addEventListener('input',()=>{
    renderKeybindsList();
  });
  // Prevent the search box keystrokes from being swallowed by the global
  // key handler or triggering a rebind that's in progress.
  _keybindSearchInput.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Escape'){
      _keybindSearchInput.value='';
      renderKeybindsList();
    }
  });
}

function _openKeybindsModal(){
  if(_keybindSearchInput) _keybindSearchInput.value='';
  renderKeybindsList();
  document.getElementById('modal-keybinds').classList.add('visible');
  if(_keybindSearchInput) setTimeout(()=>_keybindSearchInput.focus(),50);
}
function _closeKeybindsModal(){
  cancelRebind();
  if(_keybindSearchInput) _keybindSearchInput.value='';
  document.getElementById('modal-keybinds').classList.remove('visible');
}

document.getElementById('dd-keybind-settings').onclick=()=>{
  _openKeybindsModal();
  closeAllDropdowns();
};
document.getElementById('modal-keybinds-close').onclick=_closeKeybindsModal;
document.getElementById('modal-keybinds').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-keybinds')) _closeKeybindsModal();
});
document.getElementById('modal-keybinds-reset').onclick=()=>{
  if(!confirm('Reset all keybinds to their defaults?')) return;
  keybinds=JSON.parse(JSON.stringify(KEYBIND_DEFAULTS));
  saveKeybinds();
  const q=_keybindSearchInput?_keybindSearchInput.value:'';
  renderKeybindsList();
  syncKeybindMenuLabels();
};

// ── PREFERENCES MODAL (Edit ▸ Preferences) ──────────────────────────────
document.getElementById('dd-preferences').onclick=()=>{
  const gpuRadio=document.getElementById('pref-renderer-gpu');
  const cpuRadio=document.getElementById('pref-renderer-cpu');
  (brushRenderer==='cpu'?cpuRadio:gpuRadio).checked=true;
  const cursorRadio=document.getElementById('pref-cursor-'+cursorStyle);
  (cursorRadio||document.getElementById('pref-cursor-crosshair')).checked=true;
  document.getElementById('modal-preferences').classList.add('visible');
  closeAllDropdowns();
};
function _setBrushRenderer(v){
  brushRenderer=v;
  try{ localStorage.setItem('animator_renderer',v); }catch(e){}
}
document.getElementById('pref-renderer-gpu').onchange=e=>{ if(e.target.checked) _setBrushRenderer('gpu'); };
document.getElementById('pref-renderer-cpu').onchange=e=>{ if(e.target.checked) _setBrushRenderer('cpu'); };
document.getElementById('pref-cursor-crosshair').onchange=e=>{ if(e.target.checked) _setCursorStyle('crosshair'); };
document.getElementById('pref-cursor-point').onchange=e=>{ if(e.target.checked) _setCursorStyle('point'); };
document.getElementById('pref-cursor-brush').onchange=e=>{ if(e.target.checked) _setCursorStyle('brush'); };
document.getElementById('modal-preferences-close').onclick=()=>{
  document.getElementById('modal-preferences').classList.remove('visible');
};
document.getElementById('modal-preferences').addEventListener('click',e=>{
  if(e.target===document.getElementById('modal-preferences'))
    document.getElementById('modal-preferences').classList.remove('visible');
});