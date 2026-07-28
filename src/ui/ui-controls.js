// ════════════════════════════════════════════════════════════════
// Form accessibility normalization. Existing IDs remain authoritative; controls
// created by tool panels receive collision-free IDs/names as they enter the DOM.
(function initFormControlAccessibility(){
  const selector='input:not([type="hidden"]),select,textarea';
  let generatedId=0;
  const slug=value=>String(value||'field').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'field';
  const uniqueId=base=>{
    let id=slug(base),candidate=id;
    while(document.getElementById(candidate))candidate=id+'-'+(++generatedId);
    return candidate;
  };
  const contextName=control=>{
    const mirror=control.closest('[data-mirror-target]')?.dataset.mirrorTarget;
    if(mirror)return mirror+'-mirror-'+(control.type||control.tagName.toLowerCase());
    if(control.name)return control.name+(control.value?'-'+control.value:'');
    const owner=control.closest('[id],[data-panel],[data-body]');
    const ownerName=owner&&(owner.id||owner.dataset.panel||owner.dataset.body);
    return (ownerName||'app')+'-'+(control.type||control.tagName.toLowerCase());
  };
  const readableName=control=>{
    const wrapping=control.closest('label');
    if(wrapping){const text=wrapping.textContent.trim();if(text)return text;}
    const row=control.closest('.ts-row,.modal-row,.selection-option-field,.tool-group-option-row,.cp-slider-row,.palette-size-control');
    const text=row?.querySelector('.ts-label,.ts-label-sm,.selection-option-label,label,span')?.textContent?.trim();
    if(text)return text;
    return slug(control.id).replace(/-/g,' ');
  };
  function normalizeControl(control){
    if(!control.id)control.id=uniqueId(contextName(control));
    if(!control.name)control.name=control.id;
    const wrapping=control.closest('label');
    if(wrapping&&!wrapping.htmlFor)wrapping.htmlFor=control.id;
    let explicit=document.querySelector('label[for="'+CSS.escape(control.id)+'"]');
    if(!explicit){
      const row=control.closest('.ts-row,.modal-row,.selection-option-field,.tool-group-option-row,.cp-slider-row,.palette-size-control');
      const label=row?.querySelector('label:not([for])');
      if(label){label.htmlFor=control.id;explicit=label;}
    }
    if(!explicit&&!wrapping&&!control.hasAttribute('aria-label')&&!control.hasAttribute('aria-labelledby')){
      control.setAttribute('aria-label',readableName(control));
    }
  }
  function normalize(root){
    if(root.nodeType!==Node.ELEMENT_NODE&&root!==document)return;
    const controls=[];
    if(root.matches?.(selector))controls.push(root);
    root.querySelectorAll?.(selector).forEach(control=>controls.push(control));
    controls.forEach(normalizeControl);
    root.querySelectorAll?.('label:not([for])').forEach(label=>{
      const control=label.querySelector(selector)||label.parentElement?.querySelector(selector);
      if(control)label.htmlFor=control.id;
    });
  }
  normalize(document);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(normalize)))
    .observe(document.documentElement,{childList:true,subtree:true});
})();
// Panel resizing (Tools / Layers, docked or floating) now lives
// entirely inside panels.js's FloatPanels module — a single layout
// state owns dock order, dock size, and floating rect for every
// panel, and renders them deterministically. This file used to have
// two more hand-rolled edge-resize implementations here that read
// panel.offsetWidth/Height and wrote styles directly, independently
// of (and sometimes in conflict with) FloatPanels' own resize handle
// and reflow — that duplication was the root cause of the unstable
// resizing / incorrect split / overlapping-panel bugs. Removed.
// ════════════════════════════════════════════════════════════════

// ── Timeline resize (vertical)
// Uses pointer events + setPointerCapture so pen-tablet drag continues when
// the stylus moves outside the handle element (no more "stops at edge" issue).
(function(){
  let dragging=false,startY=0,startH=0;
  rhBottom.addEventListener('pointerdown',e=>{
    if(!showTimeline) return;
    e.preventDefault();e.stopPropagation();
    dragging=true;startY=e.clientY;startH=timelineArea.offsetHeight;
    rhBottom.setPointerCapture(e.pointerId);
    rhBottom.classList.add('dragging');
  });
  rhBottom.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const newH=Math.max(80,Math.min(500,startH-(e.clientY-startY)));
    timelineArea.style.height=newH+'px';
    if(typeof centerCanvas==='function') centerCanvas();
    // canvasArea's rect just changed height — docked/split panels (and their
    // seam handles) are positioned off that rect but only panels.js's own
    // drag events normally trigger a re-layout. Without this they freeze at
    // stale coordinates until some unrelated panel drag happens to fix them.
    if(typeof FloatPanels!=='undefined') FloatPanels.render();
  });
  rhBottom.addEventListener('pointerup',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
  rhBottom.addEventListener('pointercancel',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
  // Safety net: if the pointer is released/lost in a way that doesn't fire
  // pointerup on rhBottom itself (e.g. the button comes up while another
  // element still thinks it's mid-drag), `dragging` would otherwise stay
  // true forever and this handle would keep tracking the mouse — which in
  // turn stalls the reflow-driven repositioning that other resize handles
  // (like the docker split seam) rely on. Force-clear on any global
  // pointerup/blur too.
  window.addEventListener('pointerup',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
  window.addEventListener('blur',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
})();

// ── Timeline label column resize (horizontal)
// Uses pointer events + setPointerCapture so pen-tablet drag continues when
// the stylus moves outside the handle element.
(function(){
  const handle=document.getElementById('tl-labels-resize');
  const labelsCol=document.getElementById('tl-labels-col');
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('pointerdown',e=>{
    e.preventDefault();
    dragging=true;startX=e.clientX;startW=labelsCol.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const newW=Math.max(60,Math.min(400,startW+(e.clientX-startX)));
    labelsCol.style.width=newW+'px';
  });
  handle.addEventListener('pointerup',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
  handle.addEventListener('pointercancel',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
  // Same safety net as rhBottom above.
  window.addEventListener('pointerup',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
  window.addEventListener('blur',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
})();

// ════════════════════════════════════════════════════════════════
// CANVAS SETTINGS MODAL
// ════════════════════════════════════════════════════════════════
// ── Seconds:Frames timing helpers
// normalise: e.g. 0:24 @ fps=24 → 1:00, 0:25 → 1:01, 0:14 @ fps=12 → 1:02
function normalizeSecFr(sec,fr,fps){
  const total=sec*fps+fr;
  return{sec:Math.floor(total/fps),fr:total%fps,total};
}
function totalToSecFr(total,fps){return{sec:Math.floor(total/fps),fr:total%fps};}
function secFrToTotal(sec,fr,fps){return sec*fps+fr;}

// ── Canvas settings modal
function openCanvasModal(){
  document.getElementById('canvas-w-input').value=CW;
  document.getElementById('canvas-h-input').value=CH;
  document.getElementById('canvas-maxfps-input').value=MAX_FPS;
  const {sec,fr}=totalToSecFr(TOTAL,MAX_FPS);
  document.getElementById('canvas-frames-sec-input').value=sec;
  document.getElementById('canvas-frames-fr-input').value=fr;
  document.getElementById('canvas-frames-fps-label').textContent=MAX_FPS;
  document.getElementById('canvas-frames-total-label').textContent=TOTAL;
  document.getElementById('canvas-bg-color-input').value=bgColor==='transparent'?'#ffffff':bgColor;
  document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.toggle('active',s.dataset.color===bgColor));
  document.getElementById('modal-canvas').classList.add('visible');
}
function updateCanvasFramesModalTotal(){
  const fps=Math.max(1,parseInt(document.getElementById('canvas-maxfps-input').value)||MAX_FPS);
  const sec=Math.max(0,parseInt(document.getElementById('canvas-frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('canvas-frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,fps);
  document.getElementById('canvas-frames-sec-input').value=norm.sec;
  document.getElementById('canvas-frames-fr-input').value=norm.fr;
  document.getElementById('canvas-frames-fps-label').textContent=fps;
  document.getElementById('canvas-frames-total-label').textContent=norm.total;
}
document.getElementById('canvas-frames-sec-input').addEventListener('change',updateCanvasFramesModalTotal);
document.getElementById('canvas-frames-fr-input').addEventListener('change',updateCanvasFramesModalTotal);
document.getElementById('canvas-maxfps-input').addEventListener('input',()=>{
  const fps=Math.max(1,Math.min(120,parseInt(document.getElementById('canvas-maxfps-input').value)||PROJECT_DEFAULTS.fps));
  document.getElementById('canvas-frames-fps-label').textContent=fps;
  updateCanvasFramesModalTotal();
});
function closeCanvasModal(){document.getElementById('modal-canvas').classList.remove('visible');}
document.getElementById('modal-canvas-cancel').onclick=closeCanvasModal;
document.getElementById('modal-canvas').addEventListener('click',e=>{if(e.target===document.getElementById('modal-canvas'))closeCanvasModal();});
document.querySelectorAll('.preset-btn').forEach(btn=>{btn.onclick=()=>{document.getElementById('canvas-w-input').value=btn.dataset.w;document.getElementById('canvas-h-input').value=btn.dataset.h;};});
document.querySelectorAll('.bg-swatch').forEach(sw=>{
  sw.onclick=()=>{document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.remove('active'));sw.classList.add('active');if(sw.dataset.color!=='transparent')document.getElementById('canvas-bg-color-input').value=sw.dataset.color;};
});
document.getElementById('canvas-bg-color-input').oninput=()=>document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.remove('active'));
document.getElementById('modal-canvas-ok').onclick=()=>{
  const nw=parseInt(document.getElementById('canvas-w-input').value)||1920;
  const nh=parseInt(document.getElementById('canvas-h-input').value)||1080;
  if(nw<8||nh<8||nw>4096||nh>4096){showInfo('Dimensions must be 8–4096.','Invalid Size');return;}
  MAX_FPS=Math.max(1,Math.min(120,parseInt(document.getElementById('canvas-maxfps-input').value)||PROJECT_DEFAULTS.fps));
  const fSec=Math.max(0,parseInt(document.getElementById('canvas-frames-sec-input').value)||0);
  const fFr=Math.max(0,parseInt(document.getElementById('canvas-frames-fr-input').value)||0);
  const norm=normalizeSecFr(fSec,fFr,MAX_FPS);
  const nf=norm.total;
  if(nf<2||nf>9999){showInfo('Frame count must be 2–9999.','Invalid Frame Count');return;}
  fpsTl.max=MAX_FPS;
  const cf=Math.min(getFPS(),MAX_FPS);fpsTl.value=cf;fpsVal.textContent=cf;
  updateFpsSliderColor();
  const actSw=document.querySelector('.bg-swatch.active');
  bgColor=actSw?actSw.dataset.color:document.getElementById('canvas-bg-color-input').value;
  applyTotalFrames(nf);
  applyCanvasResize(nw,nh);closeCanvasModal();
};
function applyCanvasResize(nw,nh){
  layers.forEach(l=>{const nf={};Object.keys(l.frames).forEach(fi=>{const oc=document.createElement('canvas');oc.width=nw;oc.height=nh;const octx=oc.getContext('2d');const src=l.frames[fi];const dx=Math.round((nw-src.width)/2);const dy=Math.round((nh-src.height)/2);octx.drawImage(src,dx,dy);nf[fi]=oc;});l.frames=nf;});
  // Resize style-index buffers to match the new canvas dimensions so pixel
  // coordinates remain valid. resizeAllStyleFrames is defined in panels.js.
  if(typeof resizeAllStyleFrames==='function') resizeAllStyleFrames(nw,nh);
  CW=nw;CH=nh;initCanvas();loadFrame(curLayer,curFrame);renderTimeline();fitCanvasToView();
}

function applyTotalFrames(n){
  TOTAL=n;rangeStart=Math.min(rangeStart,TOTAL-1);rangeEnd=Math.min(rangeEnd,TOTAL-1);
  if(rangeEnd<rangeStart) rangeEnd=rangeStart;curFrame=Math.min(curFrame,TOTAL-1);
  document.getElementById('frame-info').textContent='Frame '+frameLabel(curFrame)+' / '+TOTAL;
  renderTimeline();
}

// ── Frame count modal (opened by clicking "Frame n / n" label)
document.getElementById('frame-info').addEventListener('click',()=>{
  const {sec,fr}=totalToSecFr(TOTAL,MAX_FPS);
  document.getElementById('frames-sec-input').value=sec;
  document.getElementById('frames-fr-input').value=fr;
  document.getElementById('frames-maxfps-input').value=MAX_FPS;
  document.getElementById('frames-fps-label').textContent=MAX_FPS;
  document.getElementById('frames-total-label').textContent=TOTAL;
  document.getElementById('modal-frames').classList.add('visible');
});
function updateFramesModalTotal(){
  const fps=Math.max(1,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS);
  const sec=Math.max(0,parseInt(document.getElementById('frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,fps);
  document.getElementById('frames-sec-input').value=norm.sec;
  document.getElementById('frames-fr-input').value=norm.fr;
  document.getElementById('frames-fps-label').textContent=fps;
  document.getElementById('frames-total-label').textContent=norm.total;
}
document.getElementById('frames-sec-input').addEventListener('change',updateFramesModalTotal);
document.getElementById('frames-fr-input').addEventListener('change',updateFramesModalTotal);
document.getElementById('frames-maxfps-input').addEventListener('input',()=>{
  document.getElementById('frames-fps-label').textContent=Math.max(1,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS);
  updateFramesModalTotal();
});
document.getElementById('modal-frames-cancel').onclick=()=>document.getElementById('modal-frames').classList.remove('visible');
document.getElementById('modal-frames').addEventListener('click',e=>{if(e.target===document.getElementById('modal-frames'))document.getElementById('modal-frames').classList.remove('visible');});
document.getElementById('modal-frames-ok').onclick=()=>{
  const newMax=Math.max(1,Math.min(120,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS));
  MAX_FPS=newMax;
  fpsTl.max=MAX_FPS;
  const cf=Math.min(getFPS(),MAX_FPS);fpsTl.value=cf;fpsVal.textContent=cf;
  updateFpsSliderColor();
  const sec=Math.max(0,parseInt(document.getElementById('frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,MAX_FPS);
  const n=norm.total;
  if(n<2||n>9999){showInfo('Frame count must be 2–9999.','Invalid Frame Count');return;}
  applyTotalFrames(n);
  document.getElementById('modal-frames').classList.remove('visible');
};

// Zoom settings modal
document.getElementById('modal-zoom-cancel').onclick=()=>document.getElementById('modal-zoom').classList.remove('visible');
document.getElementById('modal-zoom').addEventListener('click',e=>{if(e.target===document.getElementById('modal-zoom'))document.getElementById('modal-zoom').classList.remove('visible');});
document.getElementById('modal-zoom-ok').onclick=()=>{
  zoomSpeed=Math.max(0.001,Math.min(1,parseFloat(document.getElementById('zoom-speed-input').value)||0.15));
  zoomMin=Math.max(0.05,Math.min(1,parseFloat(document.getElementById('zoom-min-input').value)||0.1));
  zoomMax=Math.max(1,Math.min(32,parseFloat(document.getElementById('zoom-max-input').value)||16));
  document.getElementById('modal-zoom').classList.remove('visible');
};

// ════════════════════════════════════════════════════════════════
// DRAW MODE — temporary, deliberately not persisted
// ════════════════════════════════════════════════════════════════
let drawModeActive=false;
function setDrawMode(enabled){
  const next=!!enabled;
  if(drawModeActive===next)return;
  drawModeActive=next;
  document.body.classList.toggle('draw-mode',drawModeActive);
  const exitZone=document.getElementById('draw-mode-exit-zone');
  exitZone.setAttribute('aria-hidden',String(!drawModeActive));
  document.getElementById('draw-mode-exit').tabIndex=drawModeActive?0:-1;
  if(typeof closeAllDropdowns==='function')closeAllDropdowns();
  if(typeof hideAllMenus==='function')hideAllMenus();
  if(typeof updateWindowChecks==='function')updateWindowChecks();
  requestAnimationFrame(()=>{
    if(typeof centerCanvas==='function')centerCanvas();
    else if(typeof applyTransform==='function')applyTransform();
  });
}
function toggleDrawMode(){setDrawMode(!drawModeActive);}
window.setDrawMode=setDrawMode;
window.toggleDrawMode=toggleDrawMode;
window.isDrawModeActive=()=>drawModeActive;
document.body.classList.remove('draw-mode');
document.getElementById('draw-mode-exit').tabIndex=-1;
document.getElementById('draw-mode-exit').addEventListener('click',()=>setDrawMode(false));

// ════════════════════════════════════════════════════════════════
// Alt temporarily samples the visible canvas color without changing the
// user's permanent drawing-tool choice.
let _temporaryEyedropperRestore=null,_temporaryEyedropperActivating=false;
function _shortcutTargetIsEditable(target){
  return target instanceof Element&&!!(target.isContentEditable||target.closest('input,textarea,select,[contenteditable="true"]'));
}
function _restoreTemporaryEyedropper(){
  if(!_temporaryEyedropperRestore)return;
  const previous=_temporaryEyedropperRestore;_temporaryEyedropperRestore=null;
  if(tool!=='eyedropper')return;
  if(previous.groupId&&previous.subToolId&&window.ToolGroups&&typeof ToolGroups.activateSubTool==='function'&&ToolGroups.activateSubTool(previous.groupId,previous.subToolId,{fromTemporaryTool:true}))return;
  setTool(previous.toolId,previous.label);
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Alt'||e.repeat||_temporaryEyedropperRestore||_shortcutTargetIsEditable(e.target)||document.querySelector('.modal-overlay.visible'))return;
  if(!['brush','eraser','fill','line','curve'].includes(tool))return;
  const group=window.ToolGroups&&ToolGroups.getGroup(ToolGroups.activeGroupId);
  e.preventDefault();_temporaryEyedropperRestore={toolId:tool,label:document.getElementById('stat-tool').textContent,groupId:group&&group.id||null,subToolId:group&&group.activeSubToolId||null};
  _temporaryEyedropperActivating=true;try{setTool('eyedropper','Eyedropper');}finally{_temporaryEyedropperActivating=false;}
});
window.addEventListener('tool-changed',()=>{if(_temporaryEyedropperRestore&&!_temporaryEyedropperActivating)_temporaryEyedropperRestore=null;});
document.addEventListener('keyup',e=>{if(e.key==='Alt')_restoreTemporaryEyedropper();});
window.addEventListener('blur',_restoreTemporaryEyedropper);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')_restoreTemporaryEyedropper();});

// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'&&e.target.type!=='checkbox') return;
  if(matchBind(e,'undo')){e.preventDefault();undo();return;}
  if(matchBind(e,'redo')){e.preventDefault();redo();return;}
  const shortcutTarget=e.target instanceof Element?e.target:null;
  const clipboardShortcutBlocked=!!(
    (shortcutTarget&&(shortcutTarget.isContentEditable||shortcutTarget.closest('input,textarea,[contenteditable="true"]')))||
    document.querySelector('.modal-overlay.visible')
  );
  if(!clipboardShortcutBlocked&&window.CameraTimeline&&CameraTimeline.selected){
    if(matchBind(e,'copyFrame')){e.preventDefault();CameraTimeline.handleShortcut('copy');return;}
    if(matchBind(e,'cutFrame')){e.preventDefault();CameraTimeline.handleShortcut('cut');return;}
    if(matchBind(e,'pasteFrame')){e.preventDefault();CameraTimeline.handleShortcut('paste');return;}
    if(matchBind(e,'duplicateFrame')){e.preventDefault();CameraTimeline.handleShortcut('duplicate');return;}
    if(matchBind(e,'clearFrame')){e.preventDefault();CameraTimeline.handleShortcut('delete');return;}
  }
  if(!clipboardShortcutBlocked){
    if(matchBind(e,'copyFrame')){e.preventDefault();copyFrame();return;}
    if(matchBind(e,'cutFrame')){e.preventDefault();cutFrame();return;}
    if(matchBind(e,'pasteImage')){e.preventDefault();if(typeof pasteImageFromClipboard==='function')pasteImageFromClipboard();return;}
    if(matchBind(e,'pasteFrame')){e.preventDefault();pasteFrame();return;}
    if(matchBind(e,'duplicateFrame')){e.preventDefault();duplicateFrame();return;}
    if(matchBind(e,'clearFrame')){e.preventDefault();clearCurrentFrame();return;}
    if(matchBind(e,'copyLayer')){e.preventDefault();copyLayer(curLayer);return;}
    if(matchBind(e,'cutLayer')){e.preventDefault();cutLayer(curLayer);return;}
    if(matchBind(e,'pasteLayer')){e.preventDefault();pasteLayer(curLayer);return;}
    if(matchBind(e,'duplicateLayer')){e.preventDefault();duplicateLayer(curLayer);return;}
    if(matchBind(e,'deleteLayer')){e.preventDefault();deleteLayer(curLayer);return;}
  }
  const toolShortcutBlocked=!!(shortcutTarget&&(shortcutTarget.isContentEditable||shortcutTarget.closest('input,textarea,select,[contenteditable="true"]')))||document.querySelector('.modal-overlay.visible');
  if(!toolShortcutBlocked&&!e.repeat&&matchBind(e,'toggleDrawMode')){e.preventDefault();toggleDrawMode();return;}
  if(!toolShortcutBlocked&&!e.repeat&&matchBind(e,'toggleOnionSkin')){e.preventDefault();toggleOnionSkin();return;}
  if(!toolShortcutBlocked&&typeof handleToolGroupKeybind==='function'&&handleToolGroupKeybind(e)){e.preventDefault();return;}
  if(!toolShortcutBlocked&&(!window.ToolGroups||typeof ToolGroups.getGroups!=='function')){
    const toolMap={toolBrush:['brush','Brush'],toolEraser:['eraser','Eraser'],toolFill:['fill','Fill'],toolLine:['line','Line'],toolCurve:['curve','Curve'],toolEyedropper:['eyedropper','Eyedropper'],toolTransform:['transform','Transform']};
    for(const action in toolMap){if(matchBind(e,action)){e.preventDefault();setTool(...toolMap[action]);return;}}
  }
  if(matchBind(e,'newFrame')){if(window.CameraTimeline&&CameraTimeline.selected)CameraTimeline.addOrUpdateKey();else{createBlankKey();loadFrame(curLayer,curFrame);}}
  if(matchBind(e,'delKeyframe')){e.preventDefault();if(window.CameraTimeline&&CameraTimeline.selected)CameraTimeline.handleShortcut('delete');else deleteKeyframe();}
  if(matchBind(e,'nextFrame')){e.preventDefault();kfswNavigate(+1);}
  if(matchBind(e,'prevFrame')){e.preventDefault();kfswNavigate(-1);}
  // Space is reserved for canvas pan — Tab toggles play (handled in timeline.js)
  // Zoom keyboard shortcuts — center of canvas-area
  if(matchBind(e,'zoomIn')){e.preventDefault();const r=canvasArea.getBoundingClientRect();doZoom(1,r.width/2,r.height/2);}
  if(matchBind(e,'zoomOut')){e.preventDefault();const r=canvasArea.getBoundingClientRect();doZoom(-1,r.width/2,r.height/2);}
  if(matchBind(e,'zoomReset')){e.preventDefault();zoom=1;centerCanvas();showZoom();}
  if(matchBind(e,'rotateReset')){e.preventDefault();resetRotation();}
  if(matchBind(e,'flipHorizontal')){e.preventDefault();toggleFlipH();}
  if(matchBind(e,'flipVertical')){e.preventDefault();toggleFlipV();}
});

// ════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════
initCanvas();
renderLayerPanel();
renderTimeline();
loadFrame(curLayer,curFrame);
// Fit & center after layout settles
requestAnimationFrame(()=>requestAnimationFrame(fitCanvasToView));

// ════════════════════════════════════════════════════════════════
// IMAGE IMPORT SYSTEM
// — Drag-and-drop images anywhere on the app
// — File menu "Import Image…" button
// — Modal asks: New Layer / Current Layer / New Layer in Group
// — Fit modes: fit, fill, stretch, center
// ════════════════════════════════════════════════════════════════