// ════════════════════════════════════════════════════════════════
// KEYBINDS — user-customizable keyboard shortcuts
// Edited via Settings ▸ Keybinds. Persisted to localStorage.
// ════════════════════════════════════════════════════════════════
const KEYBIND_STORE_KEY='keybinds_v1';
const KEYBIND_IS_MAC=/Mac|iPhone|iPad|iPod/.test(navigator.platform||'');

const KEYBIND_DEFAULTS={
  undo:        {label:'Undo',               key:'z',          ctrl:true,  shift:false, alt:false},
  redo:        {label:'Redo',               key:'y',          ctrl:true,  shift:false, alt:false},
  copyFrame:   {label:'Copy Frame',         key:'c',          ctrl:true,  shift:false, alt:true},
  cutFrame:    {label:'Cut Frame',          key:'x',          ctrl:true,  shift:false, alt:true},
  pasteFrame:  {label:'Paste Frame',        key:'v',          ctrl:true,  shift:false, alt:true},
  duplicateFrame:{label:'Duplicate Frame',  key:'d',          ctrl:true,  shift:false, alt:true},
  pasteImage:  {label:'Paste Image',        key:'v',          ctrl:true,  shift:true,  alt:false},
  clearFrame:  {label:'Clear Frame',        key:'w',          ctrl:false, shift:false, alt:false},
  copyLayer:   {label:'Copy Layer',          key:'c',          ctrl:true,  shift:false, alt:false},
  cutLayer:    {label:'Cut Layer',           key:'x',          ctrl:true,  shift:false, alt:false},
  pasteLayer:  {label:'Paste Layer',         key:'v',          ctrl:true,  shift:false, alt:false},
  duplicateLayer:{label:'Duplicate Layer',   key:'d',          ctrl:true,  shift:false, alt:false},
  deleteLayer: {label:'Delete Layer',        key:'Delete',     ctrl:false, shift:false, alt:false},
  selectLinkedPixels:{label:'Select Linked Pixels',key:'Click',ctrl:true,shift:false,alt:false,pointer:true},
  toolBrush:   {label:'Brush Tool',         key:'b',          ctrl:false, shift:false, alt:false},
  toolEraser:  {label:'Eraser Tool',        key:'e',          ctrl:false, shift:false, alt:false},
  toolSelection:{label:'Selection Tool',     key:'g',          ctrl:false, shift:false, alt:false},
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
  increaseExposure: {label:'Increase Exposure', key:'1', ctrl:false, shift:false, alt:false},
  decreaseExposure: {label:'Decrease Exposure', key:'2', ctrl:false, shift:false, alt:false},
};

// Migrate only untouched clipboard defaults from the previous layout.
// Any binding that differs from these exact legacy combinations is custom
// and remains authoritative.
const LEGACY_CLIPBOARD_DEFAULTS={
  copyFrame:{key:'c',ctrl:true,shift:false,alt:false},
  cutFrame:{key:'x',ctrl:true,shift:false,alt:false},
  pasteFrame:{key:'v',ctrl:true,shift:false,alt:false},
  clearFrame:{key:'Delete',ctrl:false,shift:false,alt:false},
  copyLayer:{key:'c',ctrl:true,shift:false,alt:true},
  cutLayer:{key:'x',ctrl:true,shift:false,alt:true},
  pasteLayer:{key:'v',ctrl:true,shift:false,alt:true},
  duplicateLayer:{key:'d',ctrl:true,shift:false,alt:true},
  deleteLayer:{key:'Backspace',ctrl:true,shift:false,alt:true}
};
function _matchesStoredBind(binding,expected){
  return !!binding&&binding.key===expected.key&&
    !!binding.ctrl===expected.ctrl&&!!binding.shift===expected.shift&&!!binding.alt===expected.alt;
}

let keybinds={};

// Grouping only — purely cosmetic for the Settings ▸ Keybinds list, doesn't
// affect matchBind/storage/rebinding at all. Order here = display order.
const KEYBIND_CATEGORIES=[
  {name:'History',        actions:['undo','redo']},
  {name:'Frame Clipboard', actions:['copyFrame','cutFrame','pasteFrame','duplicateFrame','clearFrame']},
  {name:'Layer Clipboard', actions:['copyLayer','cutLayer','pasteLayer','duplicateLayer','deleteLayer']},
  {name:'Selection',      actions:['selectLinkedPixels']},
  {name:'Tool Controls',   actions:['brushResize']},
  {name:'Frames & Keyframes', actions:['newFrame','delKeyframe','nextFrame','prevFrame','flipperBypass','increaseExposure','decreaseExposure']},
  {name:'View',           actions:['zoomIn','zoomOut','zoomReset','rotateReset']},
  {name:'Transform',      actions:['flipHorizontal','flipVertical']},
];

function loadKeybinds(){
  keybinds=JSON.parse(JSON.stringify(KEYBIND_DEFAULTS));
  try{
    const raw=localStorage.getItem(KEYBIND_STORE_KEY);
    if(raw){
      const saved=JSON.parse(raw);
      let migrated=false;
      for(const action in saved){
        if(!keybinds[action])continue;
        const legacy=LEGACY_CLIPBOARD_DEFAULTS[action];
        if(legacy&&_matchesStoredBind(saved[action],legacy)){migrated=true;continue;}
        Object.assign(keybinds[action],saved[action]);
      }
      if(migrated)saveKeybinds();
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

const TOOL_GROUP_EXPANDED_KEY='keybind_tool_groups_expanded_v1';
let _expandedToolGroups={};
try{_expandedToolGroups=JSON.parse(localStorage.getItem(TOOL_GROUP_EXPANDED_KEY)||'{}')||{};}catch(_){_expandedToolGroups={};}
function _toolSubActionId(groupId,subToolId){return 'toolSubTool.'+groupId+'.'+subToolId;}
function _saveExpandedToolGroups(){try{localStorage.setItem(TOOL_GROUP_EXPANDED_KEY,JSON.stringify(_expandedToolGroups));}catch(_){}}
function syncToolGroupKeybindCommands(){
  if(!window.ToolGroups||typeof ToolGroups.getGroups!=='function')return;
  let stored={};try{stored=JSON.parse(localStorage.getItem(KEYBIND_STORE_KEY)||'{}')||{};}catch(_){}
  ToolGroups.getGroups().forEach(group=>{
    if(group.shortcutActionId&&!KEYBIND_DEFAULTS[group.shortcutActionId])KEYBIND_DEFAULTS[group.shortcutActionId]={label:group.name+' Tool',key:'',ctrl:false,shift:false,alt:false};
    if(group.shortcutActionId&&!keybinds[group.shortcutActionId])keybinds[group.shortcutActionId]=Object.assign({},KEYBIND_DEFAULTS[group.shortcutActionId],stored[group.shortcutActionId]||{});
    if(group.shortcutActionId==='toolSelection'&&keybinds[group.shortcutActionId]&&keybinds[group.shortcutActionId].key==='')keybinds[group.shortcutActionId].key='g';
    group.subTools.forEach(subTool=>{const action=_toolSubActionId(group.id,subTool.id),definition={label:subTool.name,key:'',ctrl:false,shift:false,alt:false};if(!KEYBIND_DEFAULTS[action])KEYBIND_DEFAULTS[action]=definition;if(!keybinds[action])keybinds[action]=Object.assign({},definition,stored[action]||{});});
  });
}
window.addEventListener('tool-groups-ready',()=>{syncToolGroupKeybindCommands();});
function handleToolGroupKeybind(event){
  syncToolGroupKeybindCommands();if(!window.ToolGroups||typeof ToolGroups.getGroups!=='function')return false;
  const groups=ToolGroups.getGroups();
  for(const group of groups){for(const subTool of group.subTools){const action=_toolSubActionId(group.id,subTool.id);if(keybinds[action]&&matchBind(event,action)){ToolGroups.activateSubTool(group.id,subTool.id,{fromShortcut:true});return true;}}}
  for(const group of groups){if(group.shortcutActionId&&keybinds[group.shortcutActionId]&&matchBind(event,group.shortcutActionId)){ToolGroups.activateGroup(group.id);return true;}}
  return false;
}

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
  let ctrlHeld=KEYBIND_IS_MAC?!!e.metaKey:!!e.ctrlKey, shiftHeld=!!e.shiftKey, altHeld=!!e.altKey;
  if(action!=='flipperBypass' && window._flipperBypassHeld){
    const bypassKey=(keybinds['flipperBypass']||{}).key||'';
    const rawCtrl=KEYBIND_IS_MAC?!!e.metaKey:!!e.ctrlKey, rawShift=!!e.shiftKey, rawAlt=!!e.altKey;
    const bypassModRaw =
      bypassKey==='Shift'?rawShift : bypassKey==='Control'?rawCtrl : bypassKey==='Alt'?rawAlt : false;
    if(bypassModRaw){
      // If the raw combo already matches THIS bind exactly, it wants the
      // modifier on purpose — never strip it for its own check.
      const rawMatchesThis = !!b.ctrl===rawCtrl && !!b.shift===rawShift && !!b.alt===rawAlt;
      if(!rawMatchesThis){
        // Also don't strip if some OTHER action is bound to this same key
        // with this exact raw combo — that other bind wants the modifier
        // intentionally (e.g. Shift+E for fill), so stripping it here would
        // make both that bind AND this one match the same keystroke.
        const exactOtherWantsModifier = Object.keys(keybinds).some(a=>{
          if(a===action) return false;
          const ob=keybinds[a];
          const obk=_normKey(ob.key.length===1?ob.key.toLowerCase():ob.key);
          return obk===bk && !!ob.ctrl===rawCtrl && !!ob.shift===rawShift && !!ob.alt===rawAlt;
        });
        if(!exactOtherWantsModifier){
          if(bypassKey==='Shift') shiftHeld=false;
          else if(bypassKey==='Control') ctrlHeld=false;
          else if(bypassKey==='Alt') altHeld=false;
        }
      }
    }
  }
  if(!!b.ctrl!==ctrlHeld) return false;
  if(!!b.shift!==shiftHeld) return false;
  if(!!b.alt!==altHeld) return false;
  return true;
}

// Pointer actions share the shortcut store and modifier configuration. Shift
// and Alt can additionally select add/subtract/intersect modes at click time.
function matchPointerBind(e,action,allowSelectionModes){
  const b=keybinds[action];
  if(!b||b.key!=='Click'||e.button!==0)return false;
  const ctrlHeld=KEYBIND_IS_MAC?!!e.metaKey:!!e.ctrlKey;
  if(!!b.ctrl!==ctrlHeld)return false;
  if(b.shift&&!e.shiftKey)return false;
  if(b.alt&&!e.altKey)return false;
  if(!allowSelectionModes&&((!!b.shift!==!!e.shiftKey)||(!!b.alt!==!!e.altKey)))return false;
  return true;
}

function formatBind(b){
  const parts=[];
  if(b.ctrl) parts.push(KEYBIND_IS_MAC?'Cmd':'Ctrl');
  if(b.shift) parts.push('Shift');
  if(b.alt) parts.push('Alt');
  let k=b.key;
  if(!k)return 'Unassigned';
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
let _collapsedCats={}; // category name -> bool, persists while modal stays open

function renderKeybindsList(){
  syncToolGroupKeybindCommands();
  const list=document.getElementById('keybinds-list');if(!list)return;
  const searchEl=document.getElementById('keybinds-search'),q=(searchEl?searchEl.value:'').trim().toLowerCase();list.replaceChildren();
  const matches=action=>{const b=keybinds[action];return !!b&&(!q||b.label.toLowerCase().includes(q)||formatBind(b).toLowerCase().includes(q));};
  function buildRow(action,options){
    const b=keybinds[action],opts=options||{},row=document.createElement('div');row.className='modal-row keybinds-row'+(opts.child?' keybinds-tool-child':'')+(opts.disabled?' disabled':'');
    const label=document.createElement('span');label.className='keybinds-row-label';label.textContent=b.label;row.appendChild(label);
    if(opts.status){const status=document.createElement('span');status.className='keybinds-row-status';status.textContent=opts.status;row.appendChild(status);}
    const btn=document.createElement('button');btn.className='modal-btn keybinds-shortcut-button';btn.textContent=formatBind(b);btn.title=opts.disabled?'Shortcut unavailable until this sub-tool is implemented':'Click, then press a new key combo';btn.disabled=!!opts.disabled;btn.onclick=event=>{event.stopPropagation();startRebind(action,btn);};row.appendChild(btn);return row;
  }
  function buildSection(name,actions){
    const visible=actions.filter(action=>keybinds[action]&&matches(action));if(!visible.length)return false;const forceOpen=!!q,collapsed=!forceOpen&&!!_collapsedCats[name];
    const header=document.createElement('div');header.className='keybinds-cat-header';
    const arrow=document.createElement('span');arrow.className='keybinds-cat-chevron';arrow.textContent=collapsed?'\u25b6':'\u25bc';
    const title=document.createElement('span');title.textContent=name;const count=document.createElement('span');count.className='keybinds-cat-count';count.textContent=visible.length;header.append(arrow,title,count);
    header.onclick=()=>{_collapsedCats[name]=!collapsed;renderKeybindsList();};list.appendChild(header);if(!collapsed)visible.forEach(action=>list.appendChild(buildRow(action)));return true;
  }
  function buildToolGroups(){
    if(!window.ToolGroups||typeof ToolGroups.getGroups!=='function')return false;
    const visibleGroups=ToolGroups.getGroups().map(group=>{const mainAction=group.shortcutActionId,children=group.subTools.map(subTool=>({subTool,action:_toolSubActionId(group.id,subTool.id)})),visibleChildren=children.filter(item=>matches(item.action)),parentMatches=mainAction&&matches(mainAction);return {group,mainAction,children,visibleChildren,parentMatches};}).filter(item=>item.mainAction&&keybinds[item.mainAction]&&(!q||item.parentMatches||item.visibleChildren.length));
    if(!visibleGroups.length)return false;
    const categoryExpanded=!!q||_expandedToolGroups.__toolGroupsCategory!==false,header=document.createElement('div');header.className='keybinds-cat-header';
    const arrow=document.createElement('span');arrow.className='keybinds-cat-chevron';arrow.textContent=categoryExpanded?'\u25bc':'\u25b6';const title=document.createElement('span');title.textContent='Tool Groups';const count=document.createElement('span');count.className='keybinds-cat-count';count.textContent=visibleGroups.length;header.append(arrow,title,count);
    header.onclick=()=>{_expandedToolGroups.__toolGroupsCategory=!categoryExpanded;_saveExpandedToolGroups();renderKeybindsList();};list.appendChild(header);if(!categoryExpanded)return true;
    visibleGroups.forEach(({group,mainAction,children,visibleChildren,parentMatches})=>{
      const expanded=!!q||_expandedToolGroups[group.id]!==false,parent=document.createElement('div');parent.className='modal-row keybinds-row keybinds-tool-parent';
      const toggle=document.createElement('button');toggle.type='button';toggle.className='keybinds-tool-toggle';toggle.setAttribute('aria-expanded',String(expanded));
      const chevron=document.createElement('span');chevron.className='keybinds-tool-chevron';chevron.textContent=expanded?'\u25bc':'\u25b6';const name=document.createElement('span');name.className='keybinds-tool-name';name.textContent=keybinds[mainAction].label;toggle.append(chevron,name);
      toggle.onclick=()=>{_expandedToolGroups[group.id]=!expanded;_saveExpandedToolGroups();renderKeybindsList();};
      const shortcut=document.createElement('button');shortcut.className='modal-btn keybinds-shortcut-button';shortcut.textContent=formatBind(keybinds[mainAction]);shortcut.title='Click, then press a new key combo';shortcut.onclick=event=>{event.stopPropagation();startRebind(mainAction,shortcut);};parent.append(toggle,shortcut);list.appendChild(parent);
      const displayedChildren=q&&parentMatches?children:visibleChildren;if(expanded)displayedChildren.forEach(({subTool,action})=>{const disabled=subTool.status!=='implemented',status=subTool.id==='style-select'?'Smart Raster Only':(disabled?'Coming Soon':'');list.appendChild(buildRow(action,{child:true,disabled,status}));});
    });
    return true;
  }

  let anyVisible=buildToolGroups(),seen=new Set();if(window.ToolGroups&&typeof ToolGroups.getGroups==='function')ToolGroups.getGroups().forEach(group=>{if(group.shortcutActionId)seen.add(group.shortcutActionId);group.subTools.forEach(subTool=>seen.add(_toolSubActionId(group.id,subTool.id)));});
  KEYBIND_CATEGORIES.forEach(category=>{category.actions.forEach(action=>{if(keybinds[action])seen.add(action);});if(buildSection(category.name,category.actions))anyVisible=true;});
  const leftover=Object.keys(keybinds).filter(action=>!seen.has(action));if(leftover.length&&buildSection('Other',leftover))anyVisible=true;
  if(!anyVisible){const empty=document.createElement('div');empty.className='keybinds-empty';empty.textContent='No keybinds match "'+q+'"';list.appendChild(empty);}
}

let _rebindListener=null;
let _rebindPointerListener=null;

function startRebind(action,btn){
  cancelRebind();
  const prevText=btn.textContent;
  const pointerAction=!!keybinds[action].pointer;
  btn.textContent=pointerAction?'Press modifiers + click\u2026':'Press a key\u2026';
  btn.classList.add('primary');
  _rebindListener=(e)=>{
    e.preventDefault();e.stopPropagation();
    if(e.key==='Escape'){ cancelRebind(); renderKeybindsList(); return; }
    if(['Control','Shift','Alt','Meta'].includes(e.key)) return; // wait for a real key
    if(pointerAction)return; // pointer actions are rebound with modifiers + click
    const combo={key:e.key,ctrl:KEYBIND_IS_MAC?e.metaKey:e.ctrlKey,shift:e.shiftKey,alt:e.altKey};
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
  if(pointerAction){
    _rebindPointerListener=(e)=>{
      if(e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      const combo={key:'Click',ctrl:KEYBIND_IS_MAC?e.metaKey:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,pointer:true};
      const conflict=findBindConflict(action,combo);
      cancelRebind();
      const apply=()=>{keybinds[action]=Object.assign({},keybinds[action],combo);saveKeybinds();renderKeybindsList();syncKeybindMenuLabels();};
      if(conflict)showKeybindConflict(combo,keybinds[conflict].label,keybinds[action].label,apply,renderKeybindsList);
      else apply();
    };
    window.addEventListener('pointerdown',_rebindPointerListener,{capture:true});
  }
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
  if(_rebindPointerListener) window.removeEventListener('pointerdown',_rebindPointerListener,{capture:true});
  _rebindListener=null;
  _rebindPointerListener=null;
}

// Keep the static menu-bar shortcut labels (Edit menu, etc.) in sync
const KEYBIND_MENU_LABELS={
  undo:'dd-undo', redo:'dd-redo', cutLayer:'dd-cut', copyLayer:'dd-copy',
  pasteLayer:'dd-paste', duplicateLayer:'dd-duplicate', pasteImage:'dd-paste-image', clearFrame:'dd-clear',
  rotateReset:'dd-reset-rotation'
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
  // Preferences directly to a specific tab instead of always "Renderer".
  window._prefPsActivate=activate;
})();

document.getElementById('dd-preferences').onclick=()=>{
  const gpuRadio=document.getElementById('pref-renderer-gpu');
  const cpuRadio=document.getElementById('pref-renderer-cpu');
  (brushRenderer==='cpu'?cpuRadio:gpuRadio).checked=true;
  const cursorRadio=document.getElementById('pref-cursor-'+cursorStyle);
  (cursorRadio||document.getElementById('pref-cursor-crosshair')).checked=true;
  document.getElementById('modal-preferences').classList.add('visible');
  // If Storage happens to still be the active tab from a prior open, make
  // sure its list reflects anything saved/changed since then.
  const storagePanel=document.querySelector('.pref-ps-panel[data-panel="storage"]');
  if(storagePanel && storagePanel.classList.contains('active') && typeof window._renderLocalStorage==='function'){
    window._renderLocalStorage();
  }
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