// ════════════════════════════════════════════════════════════════
// DELETE LAYER / GROUP
// ════════════════════════════════════════════════════════════════
let skipLayerDeleteConfirm=false;
let _pendingDeleteLayerIdx=null;
let _pendingDeleteGroupId=null;

function deleteLayer(idx){
  if(skipLayerDeleteConfirm&&layers.length>1){
    _doDeleteLayer(idx);return;
  }
  _pendingDeleteLayerIdx=idx;
  const name=layers[idx]?.name||'this layer';
  const isLast=layers.length<=1;
  document.getElementById('del-layer-msg').textContent=isLast
    ?`"${name}" is the last layer. Deleting it will create a new blank layer.`
    :`Are you sure you want to delete "${name}"? This cannot be undone.`;
  document.getElementById('del-layer-skip-confirm').checked=false;
  document.getElementById('modal-del-layer').classList.add('visible');
}
function _doDeleteLayer(idx){
  layers.splice(idx,1);
  if(layers.length===0) layers.push({name:'Layer 1',visible:true,onTimeline:true,color:'transparent',frames:{},opacity:1,stencil:'none',clipTo:null,groupId:null});
  if(curLayer>=layers.length) curLayer=layers.length-1;
  if(curLayer<0) curLayer=0;
  selectedLayerIndices.clear();
  // Stencil/clip always targets the item immediately below in visual order.
  // After deletion, re-point any active clip (layers and groups) at the new neighbor below.
  _reanchorAllStencils();
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();
}
function deleteGroup(gid){
  _pendingDeleteGroupId=gid;
  const grp=groups.find(g=>g.id===gid);
  const name=grp?.name||'this group';
  document.getElementById('del-group-msg').textContent=`How do you want to delete "${name}"?`;
  document.querySelector('input[name="del-group-mode"][value="with-children"]').checked=true;
  document.getElementById('modal-del-group').classList.add('visible');
}

// Modal wiring — delete layer
document.getElementById('del-layer-cancel').onclick=()=>{
  document.getElementById('modal-del-layer').classList.remove('visible');
  _pendingDeleteLayerIdx=null;
};
document.getElementById('del-layer-ok').onclick=()=>{
  skipLayerDeleteConfirm=document.getElementById('del-layer-skip-confirm').checked;
  document.getElementById('modal-del-layer').classList.remove('visible');
  if(_pendingDeleteLayerIdx!=null){_doDeleteLayer(_pendingDeleteLayerIdx);_pendingDeleteLayerIdx=null;}
};

// ── Bulk delete
let _pendingDeleteAllLayers=false;
function _selectedGroupsFullIdSet(){
  // selectedGroupIds + every subgroup nested inside any of them, at any depth
  const out=new Set();
  selectedGroupIds.forEach(gid=>{_allDescendantGroupIds(gid).forEach(id=>out.add(id));});
  return out;
}
function deleteBulk(){
  const layerCount=selectedLayerIndices.size;
  const groupCount=selectedGroupIds.size;
  const fullGroupIds=_selectedGroupsFullIdSet();
  let childCount=0;
  fullGroupIds.forEach(gid=>{childCount+=layers.filter(l=>l.groupId===gid).length;});
  const unselectedLayers=layers.filter((_,i)=>!selectedLayerIndices.has(i)&&!fullGroupIds.has(layers[i].groupId)).length;
  _pendingDeleteAllLayers=(unselectedLayers===0);
  const parts=[];
  if(layerCount>0) parts.push(layerCount===1?'1 layer':`${layerCount} layers`);
  if(groupCount>0) parts.push(groupCount===1?'1 group':`${groupCount} groups`);
  document.getElementById('del-bulk-msg').textContent=`Are you sure you want to delete ${parts.join(' and ')}? This cannot be undone.`;
  const warnEl=document.getElementById('del-bulk-group-warn');
  if(_pendingDeleteAllLayers){
    warnEl.textContent='⚠ This deletes ALL layers and groups. A new blank layer will be created afterward.';
    warnEl.style.display='';
  } else if(groupCount>0){
    const childNote=childCount>0?` (includes ${childCount} layer${childCount===1?'':'s'} inside the group${groupCount===1?'':'s'}, including any nested subgroups)`:'';
    warnEl.textContent=`⚠ Selected group${groupCount===1?'':'s'} and all their contents will be permanently deleted${childNote}.`;
    warnEl.style.display='';
  } else {
    warnEl.style.display='none';
  }
  document.getElementById('modal-del-bulk').classList.add('visible');
}
document.getElementById('del-bulk-cancel').onclick=()=>{
  document.getElementById('modal-del-bulk').classList.remove('visible');
  _pendingDeleteAllLayers=false;
};
document.getElementById('del-bulk-ok').onclick=()=>{
  document.getElementById('modal-del-bulk').classList.remove('visible');
  const fullGroupIds=_selectedGroupsFullIdSet();
  const toRemove=new Set(selectedLayerIndices);
  fullGroupIds.forEach(gid=>{layers.forEach((l,i)=>{if(l.groupId===gid) toRemove.add(i);});});
  groups=groups.filter(g=>!fullGroupIds.has(g.id));
  if(activeGroupId&&fullGroupIds.has(activeGroupId)) activeGroupId=null;
  selectedGroupIds.clear();
  const sorted=[...toRemove].sort((a,b)=>b-a);
  if(_pendingDeleteAllLayers){
    layers=[];
    groups=[];
    activeGroupId=null;
  } else {
    sorted.forEach(idx=>{if(layers.length>1) layers.splice(idx,1);});
  }
  _pendingDeleteAllLayers=false;
  // If every layer was removed, create a fresh blank layer so the project always has at least one.
  if(layers.length===0) layers.push({name:'Layer 1',visible:true,onTimeline:true,color:'transparent',frames:{},opacity:1,stencil:'none',clipTo:null,groupId:null});
  if(curLayer>=layers.length) curLayer=layers.length-1;
  if(curLayer<0) curLayer=0;
  selectedLayerIndices.clear();
  _reanchorAllStencils();
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();
};


// Modal wiring — delete group
document.getElementById('del-group-cancel').onclick=()=>{
  document.getElementById('modal-del-group').classList.remove('visible');
  _pendingDeleteGroupId=null;
};
document.getElementById('del-group-ok').onclick=()=>{
  document.getElementById('modal-del-group').classList.remove('visible');
  if(_pendingDeleteGroupId==null) return;
  const gid=_pendingDeleteGroupId;_pendingDeleteGroupId=null;
  const mode=document.querySelector('input[name="del-group-mode"]:checked')?.value||'group-only';
  const idSet=_allDescendantGroupIds(gid); // gid + every nested subgroup, at any depth
  if(mode==='with-children'){
    // Remove this group, every nested subgroup, and all of their layers
    layers=layers.filter(l=>!(l.groupId&&idSet.has(l.groupId)));
    // If no layers remain, add a blank Layer 1
    if(layers.length===0) layers.push({name:'Layer 1',visible:true,onTimeline:true,color:'transparent',frames:{},opacity:1,stencil:'none',clipTo:null,groupId:null});
    if(curLayer>=layers.length) curLayer=Math.max(0,layers.length-1);
    selectedLayerIndices.clear();
    // Stencil/clip always targets the item immediately below in visual order.
    // After removal, re-point any active clip (layers and groups) at the new neighbor below.
    _reanchorAllStencils();
    loadFrame(curLayer,curFrame);
    groups=groups.filter(g=>!idSet.has(g.id));
  } else {
    // Ungroup: remove ONLY this group's own folder, moving its direct contents
    // (layers and nested subgroups) up to where it used to sit.
    const grp=groups.find(g=>g.id===gid);
    const newParentId=grp?grp.parentId:null;
    layers.forEach(l=>{if(l.groupId===gid) l.groupId=newParentId;});
    groups.forEach(g=>{if(g.parentId===gid) g.parentId=newParentId;});
    groups=groups.filter(g=>g.id!==gid);
  }
  idSet.forEach(id=>{if(activeGroupId===id) activeGroupId=null;selectedGroupIds.delete(id);});
  renderLayerPanel();renderTimeline();
};

// ── Drag a layer's label FROM THE TIMELINE (not the layers panel) onto the "Hide" zone
// beside the ruler to remove its row from the timeline. Its frames/keyframes stay intact
// on the layer — only the timeline row disappears.
const tlHideZone=document.getElementById('tl-hide-zone');
// Native HTML5 drag listeners removed — drag-to-hide is now handled via pointer events
// in timeline.js (onTlLabelDragMove/onTlLabelDragUp) so it works with pen/stylus input too.

// ── Drag a hidden layer from the layers panel onto the timeline body to restore its row
// (with all its stored keyframes/drawings still there)
const tlBodyEl=document.getElementById('tl-body');
tlBodyEl.addEventListener('dragover',e=>{if(dragLayerIdx===null) return;e.preventDefault();tlBodyEl.classList.add('tl-drop-restore');});
tlBodyEl.addEventListener('dragleave',()=>tlBodyEl.classList.remove('tl-drop-restore'));
tlBodyEl.addEventListener('drop',e=>{
  e.preventDefault();tlBodyEl.classList.remove('tl-drop-restore');
  if(dragLayerIdx===null) return;
  if(layers[dragLayerIdx].onTimeline===false){layers[dragLayerIdx].onTimeline=true;renderLayerPanel();renderTimeline();}
});

// ════════════════════════════════════════════════════════════════
// COPY / CUT / PASTE / DUPLICATE
// ════════════════════════════════════════════════════════════════
function copyFrame(){const k=layers[curLayer].frames[curFrame];if(!k){clipboard=null;return;}clipboard=mkLayerCanvas();clipboard.getContext('2d').drawImage(k,0,0);}
function cutFrame(){copyFrame();delete layers[curLayer].frames[curFrame];ctx.clearRect(0,0,CW,CH);const h=getHeldKey(curLayer,curFrame);if(h)ctx.drawImage(h,0,0);saveActiveToKey();loadFrame(curLayer,curFrame);renderTimeline();}
function pasteFrame(){if(!clipboard) return;ensureKey();ctx.clearRect(0,0,CW,CH);ctx.drawImage(clipboard,0,0);saveActiveToKey();recomposite(curLayer,curFrame);}
function duplicateFrame(){const k=layers[curLayer].frames[curFrame];const n=curFrame+1;if(n>=TOTAL) return;const d=mkLayerCanvas();if(k) d.getContext('2d').drawImage(k,0,0);layers[curLayer].frames[n]=d;goToFrame(n);renderTimeline();}

// ════════════════════════════════════════════════════════════════
// CONTEXT MENUS
// ════════════════════════════════════════════════════════════════
const ctxMenu=document.getElementById('ctx-menu');
const rulerCtxMenu=document.getElementById('ruler-ctx-menu');
const layerCtxMenu=document.getElementById('layer-ctx-menu');
let _layerCtxTargetIdx=null,_layerCtxTargetGid=null;
function hideAllMenus(){ctxMenu.classList.remove('visible');rulerCtxMenu.classList.remove('visible');layerCtxMenu.classList.remove('visible');const bpCtx=document.getElementById('brush-preset-ctx-menu');if(bpCtx)bpCtx.classList.remove('visible');const bgCtx=document.getElementById('brush-group-ctx-menu');if(bgCtx)bgCtx.classList.remove('visible');closeAllDropdowns();}
document.addEventListener('contextmenu',e=>{
  if(rulerEl.contains(e.target)) return;
  // Suppress canvas ctx-menu when right-clicking in the layer panel, timeline label column, or brush presets panel
  const inLayerPanel=document.getElementById('right-panel').contains(e.target);
  const inTlLabels=document.getElementById('tl-labels-col').contains(e.target);
  const inBrushPresets=document.getElementById('brush-presets-panel').contains(e.target);
  if(inTlLabels||inBrushPresets){e.preventDefault();return;}
  if(inLayerPanel) return; // handled by the layer panel's own contextmenu listener
  // Only show the canvas ctx-menu when right-clicking inside the timeline (tl-scroll), not on the canvas itself
  const inTlScroll=document.getElementById('tl-scroll').contains(e.target);
  if(!inTlScroll){e.preventDefault();return;}
  e.preventDefault();hideAllMenus();
  ctxMenu.style.left=Math.min(e.clientX,window.innerWidth-180)+'px';ctxMenu.style.top=Math.min(e.clientY,window.innerHeight-220)+'px';
  ctxMenu.classList.add('visible');
});
document.addEventListener('click',e=>{const bpCtx=document.getElementById('brush-preset-ctx-menu');const bgCtx=document.getElementById('brush-group-ctx-menu');if(!ctxMenu.contains(e.target)&&!rulerCtxMenu.contains(e.target)&&!layerCtxMenu.contains(e.target)&&(!bpCtx||!bpCtx.contains(e.target))&&(!bgCtx||!bgCtx.contains(e.target))) hideAllMenus();});
document.addEventListener('mousedown',e=>{if(e.button===2) return;const bpCtx=document.getElementById('brush-preset-ctx-menu');const bgCtx=document.getElementById('brush-group-ctx-menu');if(!ctxMenu.contains(e.target)&&!rulerCtxMenu.contains(e.target)&&!layerCtxMenu.contains(e.target)&&(!bpCtx||!bpCtx.contains(e.target))&&(!bgCtx||!bgCtx.contains(e.target))){if(ctxMenu.classList.contains('visible')||rulerCtxMenu.classList.contains('visible')||layerCtxMenu.classList.contains('visible')||(bpCtx&&bpCtx.classList.contains('visible'))||(bgCtx&&bgCtx.classList.contains('visible'))) hideAllMenus();}},{capture:true});
document.getElementById('ctx-cut').onclick=()=>{cutFrame();hideAllMenus();};
document.getElementById('ctx-copy').onclick=()=>{copyFrame();hideAllMenus();};
document.getElementById('ctx-paste').onclick=()=>{pasteFrame();hideAllMenus();};
document.getElementById('ctx-duplicate').onclick=()=>{duplicateFrame();hideAllMenus();};
document.getElementById('ctx-delete').onclick=()=>{delete layers[curLayer].frames[curFrame];ctx.clearRect(0,0,CW,CH);loadFrame(curLayer,curFrame);renderTimeline();hideAllMenus();};
// Layer panel context menu actions
function _startLayerRename(idx,gid){
  if(gid!=null){
    // Rename group: find the name span in the group row
    const row=document.querySelector(`.layer-group-row[data-gid="${gid}"]`);
    if(!row) return;
    const span=row.querySelector('.layer-group-name');
    if(!span) return;
    const grp=groups.find(g=>g.id===gid);if(!grp) return;
    const old=span.textContent;
    span.contentEditable='true';span.focus();
    const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(span);sel.removeAllRanges();sel.addRange(range);
    const done=()=>{span.contentEditable='false';grp.name=span.textContent.trim()||old;renderLayerPanel();};
    span.addEventListener('blur',done,{once:true});
    span.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();span.blur();}if(ev.key==='Escape'){span.textContent=old;span.blur();}});
  } else {
    // Rename layer: find the name span in the layer row
    const row=document.querySelector(`.layer-row[data-idx="${idx}"]`);
    if(!row) return;
    const span=row.querySelector('.layer-name');
    if(!span) return;
    const l=layers[idx];if(!l) return;
    const old=span.textContent;
    span.contentEditable='true';span.focus();
    const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(span);sel.removeAllRanges();sel.addRange(range);
    const done=()=>{span.contentEditable='false';l.name=span.textContent.trim()||old;renderLayerPanel();};
    span.addEventListener('blur',done,{once:true});
    span.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();span.blur();}if(ev.key==='Escape'){span.textContent=old;span.blur();}});
  }
}
document.getElementById('layer-ctx-rename').onclick=()=>{hideAllMenus();_startLayerRename(_layerCtxTargetIdx,_layerCtxTargetGid);};

// ── Layer-level operations
let _layerObjClipboard=null; // stores a deep copy of a layer object

function _deepCopyLayer(l){
  const copy={...l,frames:{}};
  Object.entries(l.frames).forEach(([f,src])=>{
    const c=mkLayerCanvas();c.getContext('2d').drawImage(src,0,0);copy.frames[f]=c;
  });
  return copy;
}

document.getElementById('layer-ctx-copy-layer').onclick=()=>{
  const l=layers[_layerCtxTargetIdx];if(!l){hideAllMenus();return;}
  _layerObjClipboard=_deepCopyLayer(l);
  hideAllMenus();
};
document.getElementById('layer-ctx-cut-layer').onclick=()=>{
  const idx=_layerCtxTargetIdx;const l=layers[idx];if(!l){hideAllMenus();return;}
  _layerObjClipboard=_deepCopyLayer(l);
  hideAllMenus();
  deleteLayer(idx);
};
document.getElementById('layer-ctx-paste-layer').onclick=()=>{
  if(!_layerObjClipboard){hideAllMenus();return;}
  const copy=_deepCopyLayer(_layerObjClipboard);
  copy.name=_layerObjClipboard.name+' Copy';
  copy.groupId=null; // paste at top level
  const insertAt=(_layerCtxTargetIdx!=null?_layerCtxTargetIdx:curLayer)+1;
  layers.splice(insertAt,0,copy);
  curLayer=insertAt;
  selectedLayerIndices.clear();
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();
  hideAllMenus();
};
document.getElementById('layer-ctx-duplicate-layer').onclick=()=>{
  const idx=_layerCtxTargetIdx;const l=layers[idx];if(!l){hideAllMenus();return;}
  const copy=_deepCopyLayer(l);
  copy.name=l.name+' Copy';
  layers.splice(idx+1,0,copy);
  curLayer=idx+1;
  selectedLayerIndices.clear();
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();
  hideAllMenus();
};
document.getElementById('layer-ctx-delete-layer').onclick=()=>{
  hideAllMenus();
  if(_layerCtxTargetIdx!=null) deleteLayer(_layerCtxTargetIdx);
};

// ── Group-level operations (Copy / Paste / Duplicate / Delete group)
let _groupObjClipboard=null; // {groups:[...], layers:[...]}

// Deep-copies a group AND every subgroup nested inside it (any depth), remapping ids
// so the result can be pasted/duplicated as an independent, fully-nested copy.
function _deepCopyGroupData(gid){
  const grp=groups.find(g=>g.id===gid);if(!grp) return null;
  const idSet=_allDescendantGroupIds(gid);
  const idMap=new Map();idSet.forEach(id=>idMap.set(id,'g'+(Date.now()+Math.random()).toString(36)+Math.random().toString(36).slice(2,6)));
  const groupCopies=[...idSet].map(id=>{
    const g=groups.find(g2=>g2.id===id);
    return {...g,id:idMap.get(id),parentId:g.parentId&&idMap.has(g.parentId)?idMap.get(g.parentId):null};
  });
  const memberLayers=layers.filter(l=>l.groupId&&idSet.has(l.groupId))
    .map(l=>_deepCopyLayer({...l,groupId:idMap.get(l.groupId)}));
  return {rootId:idMap.get(gid),groups:groupCopies,layers:memberLayers};
}

document.getElementById('layer-ctx-copy-group').onclick=()=>{
  const data=_deepCopyGroupData(_layerCtxTargetGid);if(!data){hideAllMenus();return;}
  _groupObjClipboard=data;
  hideAllMenus();
};
document.getElementById('layer-ctx-cut-group').onclick=()=>{
  const gid=_layerCtxTargetGid;if(!gid){hideAllMenus();return;}
  _groupObjClipboard=_deepCopyGroupData(gid);
  hideAllMenus();
  deleteGroup(gid);
};

// ── Right-click on empty space inside the layer panel → open menu targeting curLayer
document.getElementById('right-panel').addEventListener('contextmenu',e=>{
  // Row-level listeners call stopPropagation, so this only fires on empty panel space
  e.preventDefault();
  hideAllMenus();
  _layerCtxTargetIdx=curLayer;_layerCtxTargetGid=null;
  layerCtxMenu.classList.remove('mode-group');layerCtxMenu.classList.add('mode-layer');
  layerCtxMenu.style.left=Math.min(e.clientX,window.innerWidth-180)+'px';
  layerCtxMenu.style.top=Math.min(e.clientY,window.innerHeight-200)+'px';
  layerCtxMenu.classList.add('visible');
});
document.getElementById('layer-ctx-paste-group').onclick=()=>{
  if(!_groupObjClipboard){hideAllMenus();return;}
  const rootSuffix=' Copy';
  const idMap=new Map();
  _groupObjClipboard.groups.forEach(g=>{const fresh='g'+(Date.now()+Math.random()).toString(36)+Math.random().toString(36).slice(2,6);idMap.set(g.id,fresh);});
  _groupObjClipboard.groups.forEach(g=>{
    const isRoot=g.id===_groupObjClipboard.rootId;
    groups.push({...g,id:idMap.get(g.id),parentId:g.parentId&&idMap.has(g.parentId)?idMap.get(g.parentId):null,name:isRoot?g.name+rootSuffix:g.name});
  });
  const newLayers=_groupObjClipboard.layers.map(l=>_deepCopyLayer({...l,groupId:idMap.get(l.groupId)}));
  layers.push(...newLayers);
  renderLayerPanel();renderTimeline();
  hideAllMenus();
};
document.getElementById('layer-ctx-duplicate-group').onclick=()=>{
  const data=_deepCopyGroupData(_layerCtxTargetGid);if(!data){hideAllMenus();return;}
  const idMap=new Map();
  data.groups.forEach(g=>{const fresh='g'+(Date.now()+Math.random()).toString(36)+Math.random().toString(36).slice(2,6);idMap.set(g.id,fresh);});
  data.groups.forEach(g=>{
    const isRoot=g.id===data.rootId;
    groups.push({...g,id:idMap.get(g.id),parentId:g.parentId&&idMap.has(g.parentId)?idMap.get(g.parentId):null,name:isRoot?g.name+' Copy':g.name});
  });
  const newLayers=data.layers.map(l=>_deepCopyLayer({...l,groupId:idMap.get(l.groupId)}));
  layers.push(...newLayers);
  renderLayerPanel();renderTimeline();
  hideAllMenus();
};
document.getElementById('layer-ctx-delete-group').onclick=()=>{
  hideAllMenus();
  if(_layerCtxTargetGid!=null) deleteGroup(_layerCtxTargetGid);
};

// ════════════════════════════════════════════════════════════════
// MENU BAR DROPDOWNS
// ════════════════════════════════════════════════════════════════
function closeAllDropdowns(){document.querySelectorAll('.mb-item.open').forEach(m=>m.classList.remove('open'));}
document.querySelectorAll('.mb-item').forEach(item=>{
  item.addEventListener('click',e=>{
    e.stopPropagation();
    const wasOpen=item.classList.contains('open');
    closeAllDropdowns();
    if(!wasOpen) item.classList.add('open');
  });
});
document.addEventListener('click',closeAllDropdowns);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAllDropdowns();hideAllMenus();}},{capture:true});

// File menu
document.getElementById('dd-new').onclick=()=>{document.getElementById('modal-new-project').classList.add('visible');closeAllDropdowns();};
document.getElementById('modal-new-project-cancel').onclick=()=>document.getElementById('modal-new-project').classList.remove('visible');
document.getElementById('modal-new-project').addEventListener('click',e=>{if(e.target===document.getElementById('modal-new-project'))document.getElementById('modal-new-project').classList.remove('visible');});
document.getElementById('modal-new-project-ok').onclick=()=>{
  document.getElementById('modal-new-project').classList.remove('visible');
  groups=[];
  layers=[{name:'Layer 1',visible:true,onTimeline:true,color:'transparent',frames:{},opacity:1,stencil:'none',clipTo:null,groupId:null}];
  curLayer=0;curFrame=0;
  undoStack=[];redoStack=[];
  selectedFrames.clear();selectedFrames.add(0);selectedKFs.clear();
  initCanvas();
  // Explicitly clear activeC — if canvas dimensions are unchanged, resizing
  // in initCanvas does NOT clear it, so old drawing would bleed through.
  ctx.clearRect(0,0,CW,CH);
  renderLayerPanel();renderTimeline();loadFrame(0,0);
  // Re-center the canvas for the new project
  fitCanvasToView();
};
document.getElementById('dd-export').onclick=async()=>{
  closeAllDropdowns();
  if(typeof JSZip==='undefined'){showInfo('JSZip not loaded. Check your internet connection.','Export Error');return;}
  const zip=new JSZip();
  const folder=zip.folder('frames');
  const exp=document.createElement('canvas');exp.width=CW;exp.height=CH;
  const ec=exp.getContext('2d');
  let count=0;
  for(let f=0;f<TOTAL;f++){
    ec.clearRect(0,0,CW,CH);
    if(bgColor==='transparent'){const pat=document.createElement('canvas');pat.width=14;pat.height=14;const pc=pat.getContext('2d');pc.fillStyle='#aaa';pc.fillRect(0,0,14,14);pc.fillStyle='#ddd';pc.fillRect(0,0,7,7);pc.fillRect(7,7,7,7);ec.fillStyle=ec.createPattern(pat,'repeat');ec.fillRect(0,0,CW,CH);}
    else{ec.fillStyle=bgColor;ec.fillRect(0,0,CW,CH);}
    for(let i=0;i<layers.length;i++){
      const l=layers[i];if(!l.visible)continue;
      if(!_layerGroupChainVisible(l))continue;
      const k=getHeldKey(i,f);if(!k)continue;
      ec.globalAlpha=(l.opacity??1)*_layerGroupChainOpacity(l);
      ec.drawImage(k,0,0);ec.globalAlpha=1;
    }
    const name='frame_'+(f+1).toString().padStart(4,'0')+'.png';
    const blob=await new Promise(r=>exp.toBlob(r,'image/png'));
    folder.file(name,blob);count++;
  }
  const zipBlob=await zip.generateAsync({type:'blob'});
  const a=document.createElement('a');a.href=URL.createObjectURL(zipBlob);
  a.download='animation_frames.zip';a.click();
  showInfo(`Exported ${count} frames as PNG in animation_frames.zip`,'Export Complete');
};

// Edit menu
document.getElementById('dd-undo').onclick=()=>{undo();closeAllDropdowns();};
document.getElementById('dd-redo').onclick=()=>{redo();closeAllDropdowns();};
document.getElementById('dd-cut').onclick=()=>{cutFrame();closeAllDropdowns();};
document.getElementById('dd-copy').onclick=()=>{copyFrame();closeAllDropdowns();};
document.getElementById('dd-paste').onclick=()=>{pasteFrame();closeAllDropdowns();};
document.getElementById('dd-duplicate').onclick=()=>{duplicateFrame();closeAllDropdowns();};
function clearCurrentFrame(){pushUndo();ensureKey();ctx.clearRect(0,0,CW,CH);saveActiveToKey();recomposite(curLayer,curFrame);}
document.getElementById('dd-clear').onclick=()=>{clearCurrentFrame();closeAllDropdowns();};

// Window menu
function updateWindowChecks(){
  document.getElementById('chk-tools').textContent=FloatPanels.isVisible('tools')?'✓':'';
  document.getElementById('chk-brush-presets').textContent=FloatPanels.isVisible('brush-presets')?'✓':'';
  document.getElementById('chk-colorpanel').textContent=FloatPanels.isVisible('color')?'✓':'';
  document.getElementById('chk-layers').textContent=FloatPanels.isVisible('layers')?'✓':'';
  document.getElementById('chk-timeline').textContent=showTimeline?'✓':'';
  document.getElementById('chk-toolbar').textContent=showToolbar?'✓':'';
  document.getElementById('chk-keyframe-switcher').textContent=FloatPanels.isVisible('keyframe-switcher')?'✓':'';
  document.getElementById('chk-keyframe-exposure').textContent=FloatPanels.isVisible('keyframe-exposure')?'✓':'';
}
// Keep the Window-menu checkmarks in sync whenever a panel is shown/hidden/merged
// from anywhere else (close button, drag-to-merge, drag-tab-out, etc.)
FloatPanels.setWindowCheckHook(()=>updateWindowChecks());
updateWindowChecks();

document.getElementById('dd-show-tools').onclick=()=>{
  FloatPanels.setVisible('tools',!FloatPanels.isVisible('tools'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-show-brush-presets').onclick=()=>{
  FloatPanels.setVisible('brush-presets',!FloatPanels.isVisible('brush-presets'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-show-colorpanel').onclick=()=>{
  FloatPanels.setVisible('color',!FloatPanels.isVisible('color'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-show-layers').onclick=()=>{
  FloatPanels.setVisible('layers',!FloatPanels.isVisible('layers'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-show-timeline').onclick=()=>{
  showTimeline=!showTimeline;
  bottomArea.classList.toggle('hidden',!showTimeline);
  updateWindowChecks();centerCanvas();closeAllDropdowns();
};
document.getElementById('dd-show-toolbar').onclick=()=>{
  showToolbar=!showToolbar;
  toolbarEl.style.display=showToolbar?'':'none';
  updateWindowChecks();centerCanvas();closeAllDropdowns();
};
document.getElementById('dd-show-keyframe-switcher').onclick=()=>{
  FloatPanels.setVisible('keyframe-switcher',!FloatPanels.isVisible('keyframe-switcher'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-show-keyframe-exposure').onclick=()=>{
  FloatPanels.setVisible('keyframe-exposure',!FloatPanels.isVisible('keyframe-exposure'));
  updateWindowChecks();closeAllDropdowns();
};
document.getElementById('dd-reset-layout').onclick=()=>{
  showTimeline=true;showToolbar=true;
  bottomArea.classList.remove('hidden');toolbarEl.style.display='';
  FloatPanels.resetLayout();
  updateWindowChecks();fitCanvasToView();closeAllDropdowns();
};
document.getElementById('dd-center-canvas').onclick=()=>{centerCanvas();closeAllDropdowns();};

// Settings menu
document.getElementById('dd-canvas-settings').onclick=()=>{openCanvasModal();closeAllDropdowns();};
document.getElementById('dd-zoom-settings').onclick=()=>{
  document.getElementById('zoom-speed-input').value=zoomSpeed;
  document.getElementById('zoom-min-input').value=zoomMin;
  document.getElementById('zoom-max-input').value=zoomMax;
  document.getElementById('modal-zoom').classList.add('visible');closeAllDropdowns();
};

// Prevent trackpad/wheel scroll from bubbling to the canvas
['#right-panel .fp-body','#tools-panel .fp-body'].forEach(sel=>{
  const el=document.querySelector(sel);
  if(el) el.addEventListener('wheel',e=>{e.stopPropagation();},{passive:true});
});