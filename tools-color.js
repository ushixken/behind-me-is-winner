// ════════════════════════════════════════════════════════════════
// ONION SKIN
// ════════════════════════════════════════════════════════════════
function updateOnion(){
  octx.clearRect(0,0,CW,CH);
  if(!document.getElementById('onion-chk').checked) return;
  const p=getHeldKey(curLayer,curFrame-1);if(p){octx.globalAlpha=0.28;octx.drawImage(p,0,0);octx.globalAlpha=1;}
  const n=getExactKey(curLayer,curFrame+1);if(n){octx.globalAlpha=0.15;octx.drawImage(n,0,0);octx.globalAlpha=1;}
}

// ════════════════════════════════════════════════════════════════
// UNDO / REDO
// ════════════════════════════════════════════════════════════════
function _currentUndoSnapshot(){
  const layer=layers[curLayer];
  const layerType=layer&&layer.type==='smart-raster'?'smart-raster':'bitmap';
  if(layerType==='smart-raster'){
    const styleBundle=typeof getStyleFrameBundle==='function'?getStyleFrameBundle(curLayer,curFrame):null;
    return {snap:null,styleBundle,frame:curFrame,layer:curLayer,layerType};
  }
  const snap=mkLayerCanvas();
  snap.getContext('2d').drawImage(activeC,0,0);
  return {snap,styleBundle:null,frame:curFrame,layer:curLayer,layerType};
}

function pushUndo(){
  undoStack.push(_currentUndoSnapshot());
  if(undoStack.length>40) undoStack.shift();
  redoStack=[];
}

function restoreBitmapUndo(action){
  if(action.layer!==curLayer) switchLayer(action.layer);
  if(action.frame!==curFrame) curFrame=action.frame;
  const layer=layers[action.layer];
  if(!layer||!action.snap) return;
  if(!layer.frames[action.frame]) layer.frames[action.frame]=mkLayerCanvas();
  ctx.clearRect(0,0,CW,CH);
  ctx.drawImage(action.snap,0,0);
  const frameCtx=layer.frames[action.frame].getContext('2d');
  frameCtx.clearRect(0,0,CW,CH);
  frameCtx.drawImage(activeC,0,0);
  recomposite(curLayer,curFrame);
  renderTimeline();
}

function restoreSmartRasterUndo(action){
  if(action.layer!==curLayer) switchLayer(action.layer);
  if(action.frame!==curFrame) curFrame=action.frame;
  const layer=layers[action.layer];
  if(!layer) return;
  SmartRasterLayer.restoreFrameBundle(action.layer,action.frame,action.styleBundle);
  recomposite(curLayer,curFrame);
  renderTimeline();
}
function _restoreUndoAction(action){
  const layer=layers[action.layer];
  if(layer&&layer.type==='smart-raster') restoreSmartRasterUndo(action);
  else restoreBitmapUndo(action);
}

function _showSmartRasterDuplicateFrame(action,slot,frameIndex){
  if(action.layer!==curLayer)switchLayer(action.layer);
  _restoreSmartRasterFrameSlot(action.layer,action.targetFrame,slot);
  curFrame=frameIndex;
  loadFrame(curLayer,curFrame);
  recomposite(curLayer,curFrame);
  renderTimeline();
}
function _undoSmartRasterDuplicateLayer(action){
  if(action.index>=0&&action.index<layers.length)layers.splice(action.index,1);
  curLayer=Math.max(0,Math.min(action.sourceIndex,layers.length-1));
  selectedLayerIndices.clear();
  loadFrame(curLayer,curFrame);
  renderLayerPanel();renderTimeline();recomposite(curLayer,curFrame);
}
function _redoSmartRasterDuplicateLayer(action){
  layers.splice(Math.min(action.index,layers.length),0,_deepCopyLayer(action.layerSnapshot));
  curLayer=Math.min(action.index,layers.length-1);
  selectedLayerIndices.clear();
  loadFrame(curLayer,curFrame);
  renderLayerPanel();renderTimeline();recomposite(curLayer,curFrame);
}
function _undoLayerCut(action){
  if(action.wasOnlyLayer&&layers.length===1)layers.splice(0,1);
  const index=Math.max(0,Math.min(action.index,layers.length));
  layers.splice(index,0,_deepCopyLayer(action.layerSnapshot));
  curLayer=index;
  selectedLayerIndices.clear();
  _reanchorAllStencils();
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();recomposite(curLayer,curFrame);
}
function _redoLayerCut(action){
  const index=Math.max(0,Math.min(action.index,layers.length-1));
  _doDeleteLayer(index);
}
function undo(){
  if(!undoStack.length)return;
  const action=undoStack.pop();
  if(action.type==='layer-cut'){
    _undoLayerCut(action);
    redoStack.push(action);return;
  }
  if(action.type==='smart-raster-duplicate-frame'){
    _showSmartRasterDuplicateFrame(action,action.before,action.sourceFrame);
    redoStack.push(action);return;
  }
  if(action.type==='smart-raster-duplicate-layer'){
    _undoSmartRasterDuplicateLayer(action);
    redoStack.push(action);return;
  }
  if(action.type==='timeline-frames'){
    _restoreFrameMaps(action.before);redoStack.push(action);selectedKFs.clear();
    loadFrame(curLayer,curFrame);recomposite(curLayer,curFrame);renderTimeline();return;
  }
  redoStack.push(_currentUndoSnapshot());
  _restoreUndoAction(action);
}
function redo(){
  if(!redoStack.length)return;
  const action=redoStack.pop();
  if(action.type==='layer-cut'){
    _redoLayerCut(action);
    undoStack.push(action);return;
  }
  if(action.type==='smart-raster-duplicate-frame'){
    _showSmartRasterDuplicateFrame(action,action.after,action.targetFrame);
    undoStack.push(action);return;
  }
  if(action.type==='smart-raster-duplicate-layer'){
    _redoSmartRasterDuplicateLayer(action);
    undoStack.push(action);return;
  }
  if(action.type==='timeline-frames'){
    _restoreFrameMaps(action.after);undoStack.push(action);selectedKFs.clear();
    loadFrame(curLayer,curFrame);recomposite(curLayer,curFrame);renderTimeline();return;
  }
  undoStack.push(_currentUndoSnapshot());
  _restoreUndoAction(action);
}const szSlider=document.getElementById('ts-size');
const szValEl=document.getElementById('ts-size-val');
// Swap the Brush Presets docker's contents between the Brush Presets body
// and the Transform body depending on the active tool, instead of opening
// a separate docker — same shell, same dock position/size, just different
// contents (and title) shown.
function _syncBrushPresetsDocker(t){
  const shell=document.getElementById('brush-presets-panel');
  if(!shell) return;
  const bpBody=shell.querySelector('.fp-body[data-body="brush-presets"]');
  const tfBody=shell.querySelector('.fp-body[data-body="transform"]');
  const nameEl=shell.querySelector('.fp-name');
  const showTransform=(t==='transform');
  if(bpBody) bpBody.classList.toggle('active',!showTransform);
  if(tfBody) tfBody.classList.toggle('active',showTransform);
  if(nameEl) nameEl.textContent=showTransform?'Transform':'Brush Presets';
}
function setTool(t,lbl){
  // Leaving the Transform tool for anything else commits the current
  // move/scale/rotate into the layer (baking it into the active canvas)
  // before the new tool takes over.
  if(tool==='transform'&&t!=='transform'&&typeof commitTransformTool==='function') commitTransformTool();
  if(tool==='lasso'&&t!=='lasso'&&window.LassoSelection) LassoSelection.cancel();
  tool=t;
  _syncBrushPresetsDocker(t);
  document.querySelectorAll('.tbtn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('btn-'+t);if(btn) btn.classList.add('active');
  const tpBtn=document.getElementById('tp-btn-'+t);if(tpBtn) tpBtn.classList.add('active');
  document.getElementById('stat-tool').textContent=lbl;
  const s=toolSizes[t]||6;szSlider.value=s;
  if(typeof refreshSizeUI==='function') refreshSizeUI(); else szValEl.textContent=s;
  if(typeof refreshColorSwatches==='function') refreshColorSwatches();
  if(t==='transform'&&typeof enterTransformTool==='function') enterTransformTool();
  window.dispatchEvent(new CustomEvent('tool-changed',{detail:{tool:t,label:lbl}}));
}
document.getElementById('btn-undo').onclick=undo;
document.getElementById('btn-redo').onclick=redo;
document.getElementById('btn-flip-h').onclick=toggleFlipH;
document.getElementById('btn-flip-v').onclick=toggleFlipV;

const swatchEl=document.getElementById('color-swatch');
const colorIn=document.getElementById('color-input');
const csStack=document.getElementById('color-swatch-stack');
swatchEl.style.background=color;
colorIn.oninput=e=>{color=e.target.value;swatchEl.style.background=color;document.getElementById('stat-color').textContent='Color: '+color;if(typeof refreshColorSwatches==='function')refreshColorSwatches();if(typeof syncColorPanelSwatches==='function')syncColorPanelSwatches();};

// ════════════════════════════════════════════════════════════════
// TOOLS PANEL — button bindings (floating panel duplicate of the
// old toolbar's Brush/Eraser/Fill/Line, see setTool() below)
// ════════════════════════════════════════════════════════════════
document.getElementById('tp-btn-brush').onclick=()=>setTool('brush','Brush');
document.getElementById('tp-btn-eraser').onclick=()=>setTool('eraser','Eraser');
document.getElementById('tp-btn-fill').onclick=()=>setTool('fill','Fill');
document.getElementById('tp-btn-line').onclick=()=>setTool('line','Line');
document.getElementById('tp-btn-selection').onclick=()=>setTool('lasso','Lasso Select');
document.getElementById('tp-btn-transform').onclick=()=>setTool('transform','Transform');

// ════════════════════════════════════════════════════════════════
// FOREGROUND COLOR SWATCH (Tools panel)
// ════════════════════════════════════════════════════════════════
// `color` (declared earlier) is the existing foreground/brush color —
// untouched, still drives _stampDab() exactly as before. `bgDrawColor`
// and `colorTarget` still back the full Color panel's own fg/bg
// swatches (cpSwFg/cpSwBg) further below — unrelated to this single
// swatch. Click opens the native color input; dragging the swatch out
// detaches/pops out the full Color panel instead.
let bgDrawColor='#ffffff';
let colorTarget='fg'; // which swatch the Color panel is currently editing: 'fg' | 'bg'

function refreshColorSwatches(){
  // keep the relocated swatch in sync with the current foreground color
  swatchEl.style.background=tool==='eraser'?'':color;
  swatchEl.classList.toggle('cs-swatch-checker',tool==='eraser');
}
refreshColorSwatches();

// Tap or press the swatch → mini picker opens immediately on pointerdown so
// you can drag straight into the picker to select a color without lifting the pen.
// Dragging far (>24px) within the first 200ms still detaches the full Color panel.
(function(){
  let dragging=false,startX=0,startY=0,pressTime=0;
  let draggedOut=false;

  csStack.addEventListener('pointerdown',e=>{
    dragging=true;draggedOut=false;
    startX=e.clientX;startY=e.clientY;pressTime=Date.now();
    // Open immediately so the user can drag to color-pick without re-tapping.
    openMiniPicker(csStack.getBoundingClientRect(),e);
  });
  document.addEventListener('pointermove',e=>{
    if(!dragging||draggedOut) return;
    const dist=Math.hypot(e.clientX-startX,e.clientY-startY);
    const elapsed=Date.now()-pressTime;
    // Large fast drag = intent to detach the Color panel, not pick a color.
    if(dist>24&&elapsed<200){
      draggedOut=true;
      closeMiniPicker();
    }
  });
  document.addEventListener('pointerup',e=>{
    if(dragging&&draggedOut){
      // Detach the full Color panel at the drop position.
      const car=canvasArea.getBoundingClientRect();
      const colorPanel=document.getElementById('color-panel');
      if(colorPanel._mergedInto){
        FloatPanels.setVisible('color',true);
      }
      colorPanel.classList.remove('fp-hidden');
      colorPanel.classList.remove('dock-left','dock-right','dock-top','dock-bottom','docked');
      // Reset to a sane floating size — without this the panel inherits whatever
      // unconstrained dimensions it had while docked/merged, which can be enormous.
      if(!colorPanel.style.width||parseFloat(colorPanel.style.width)>400) colorPanel.style.width='200px';
      if(!colorPanel.style.height||parseFloat(colorPanel.style.height)>500) colorPanel.style.height='240px';
      colorPanel.style.left=(e.clientX-car.left-20)+'px';
      colorPanel.style.top=(e.clientY-car.top-10)+'px';
      if(FloatPanels.setFloatSize){
        FloatPanels.setFloatSize('color',parseFloat(colorPanel.style.width),parseFloat(colorPanel.style.height));
      }
      FloatPanels.bringToFront(colorPanel);
      if(FloatPanels.saveLayout) FloatPanels.saveLayout();
      syncColorPanelInputs();
      updateWindowChecks();
    }
    dragging=false;draggedOut=false;
  });
})();

function openColorPanel(){
  FloatPanels.setVisible('color',true);
  syncColorPanelInputs();
}

// ════════════════════════════════════════════════════════════════
// MINI COLOR PICKER POPUP
// ════════════════════════════════════════════════════════════════
(function(){
  const SQ=180;
  const mp=document.getElementById('mini-picker');
  const sqCanvas=document.getElementById('mini-sq');
  const hueCanvas=document.getElementById('mini-hue');
  const sqCtx=sqCanvas.getContext('2d');
  const hCtx=hueCanvas.getContext('2d');

  let mpH=0,mpS=1,mpV=1;
  let mpOpen=false;
  let sqX=SQ-1,sqY=0,hueY=0;

  function hsvToHex(h,s,v){const[r,g,b]=hsvToRgb(h,s,v);return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function hexToHsv(hex){const[r,g,b]=hexToRgb(hex);return rgbToHsv(r,g,b);}

  function drawSq(){
    const gH=sqCtx.createLinearGradient(0,0,SQ,0);
    gH.addColorStop(0,'#fff');gH.addColorStop(1,`hsl(${mpH},100%,50%)`);
    sqCtx.fillStyle=gH;sqCtx.fillRect(0,0,SQ,SQ);
    const gV=sqCtx.createLinearGradient(0,0,0,SQ);
    gV.addColorStop(0,'rgba(0,0,0,0)');gV.addColorStop(1,'#000');
    sqCtx.fillStyle=gV;sqCtx.fillRect(0,0,SQ,SQ);
    sqCtx.beginPath();sqCtx.arc(sqX,sqY,7,0,Math.PI*2);
    sqCtx.strokeStyle='#fff';sqCtx.lineWidth=2;sqCtx.stroke();
    sqCtx.beginPath();sqCtx.arc(sqX,sqY,5,0,Math.PI*2);
    sqCtx.strokeStyle='rgba(0,0,0,0.5)';sqCtx.lineWidth=1.5;sqCtx.stroke();
  }

  function drawHue(){
    const g=hCtx.createLinearGradient(0,0,0,SQ);
    for(let i=0;i<=360;i+=30) g.addColorStop(i/360,`hsl(${i},100%,50%)`);
    hCtx.fillStyle=g;hCtx.fillRect(0,0,16,SQ);
    const ty=Math.round(hueY);
    hCtx.fillStyle='rgba(0,0,0,0.35)';hCtx.fillRect(0,ty-3,16,6);
    hCtx.strokeStyle='#fff';hCtx.lineWidth=2;hCtx.strokeRect(1,ty-3,14,6);
  }

  function syncThumbs(){
    sqX=Math.min(SQ-1,Math.max(0,Math.round(mpS*SQ)));
    sqY=Math.min(SQ-1,Math.max(0,Math.round((1-mpV)*SQ)));
    hueY=Math.min(SQ-1,Math.max(0,Math.round((mpH/360)*SQ)));
  }

  function commitColor(){
    const hex=hsvToHex(mpH,mpS,mpV);
    color=hex;swatchEl.style.background=hex;
    document.getElementById('stat-color').textContent='Color: '+hex;
    if(typeof refreshColorSwatches==='function') refreshColorSwatches();
    if(typeof syncColorPanelSwatches==='function') syncColorPanelSwatches();
    if(typeof syncColorPanelInputs==='function') syncColorPanelInputs();
  }

  function onSqMove(e){
    const r=sqCanvas.getBoundingClientRect();
    sqX=Math.min(SQ-1,Math.max(0,Math.round(e.clientX-r.left)));
    sqY=Math.min(SQ-1,Math.max(0,Math.round(e.clientY-r.top)));
    mpS=sqX/SQ;mpV=1-sqY/SQ;drawSq();drawHue();commitColor();
  }
  function onSqUp(){
    sqCanvas.removeEventListener('pointermove',onSqMove);
    sqCanvas.removeEventListener('pointerup',onSqUp);
    sqCanvas.removeEventListener('pointercancel',onSqUp);
  }
  sqCanvas.addEventListener('pointerdown',e=>{
    e.preventDefault();sqCanvas.setPointerCapture(e.pointerId);
    onSqMove(e);
    sqCanvas.addEventListener('pointermove',onSqMove);
    sqCanvas.addEventListener('pointerup',onSqUp);
    sqCanvas.addEventListener('pointercancel',onSqUp);
  });

  function onHueMove(e){
    const r=hueCanvas.getBoundingClientRect();
    hueY=Math.min(SQ-1,Math.max(0,Math.round(e.clientY-r.top)));
    mpH=(hueY/SQ)*360;drawSq();drawHue();commitColor();
  }
  function onHueUp(){
    hueCanvas.removeEventListener('pointermove',onHueMove);
    hueCanvas.removeEventListener('pointerup',onHueUp);
    hueCanvas.removeEventListener('pointercancel',onHueUp);
  }
  hueCanvas.addEventListener('pointerdown',e=>{
    e.preventDefault();hueCanvas.setPointerCapture(e.pointerId);
    onHueMove(e);
    hueCanvas.addEventListener('pointermove',onHueMove);
    hueCanvas.addEventListener('pointerup',onHueUp);
    hueCanvas.addEventListener('pointercancel',onHueUp);
  });

  // Pending-drag: after the picker opens on pointerdown, use setPointerCapture
  // on csStack so events follow the pen. Capture auto-releases on pointerup,
  // so pen-tablet hover after lifting never triggers color changes.
  let pendingDragPointerId=null;

  function onPendingMove(e){
    if(e.pointerId!==pendingDragPointerId) return;
    // Stop tracking if pointer moves outside the mini picker bounds.
    const mr=mp.getBoundingClientRect();
    if(e.clientX<mr.left||e.clientX>mr.right||e.clientY<mr.top||e.clientY>mr.bottom) return;
    const hr=hueCanvas.getBoundingClientRect();
    if(e.clientX>=hr.left&&e.clientX<=hr.right){
      hueY=Math.min(SQ-1,Math.max(0,Math.round(e.clientY-hr.top)));
      mpH=(hueY/SQ)*360;
    } else {
      const r=sqCanvas.getBoundingClientRect();
      sqX=Math.min(SQ-1,Math.max(0,Math.round(e.clientX-r.left)));
      sqY=Math.min(SQ-1,Math.max(0,Math.round(e.clientY-r.top)));
      mpS=sqX/SQ;mpV=1-sqY/SQ;
    }
    drawSq();drawHue();commitColor();
  }
  function onPendingUp(e){
    if(e.pointerId!==pendingDragPointerId) return;
    pendingDragPointerId=null;
    csStack.removeEventListener('pointermove',onPendingMove);
    csStack.removeEventListener('pointerup',onPendingUp);
    csStack.removeEventListener('pointercancel',onPendingUp);
    try{ csStack.releasePointerCapture(e.pointerId); }catch(_){}
  }

  window.openMiniPicker=function(anchorRect,triggerEvent){
    // Clean up any stale pending drag from a previous gesture before starting fresh.
    if(pendingDragPointerId!=null){
      csStack.removeEventListener('pointermove',onPendingMove);
      csStack.removeEventListener('pointerup',onPendingUp);
      csStack.removeEventListener('pointercancel',onPendingUp);
      try{ csStack.releasePointerCapture(pendingDragPointerId); }catch(_){}
      pendingDragPointerId=null;
    }
    [mpH,mpS,mpV]=hexToHsv(color&&color!=='transparent'?color:'#000000');
    syncThumbs();drawSq();drawHue();
    const W=220,H=202;
    let left=anchorRect.left,top=anchorRect.bottom+6;
    if(left+W>window.innerWidth-8) left=window.innerWidth-W-8;
    if(top+H>window.innerHeight-8) top=anchorRect.top-H-6;
    mp.style.left=left+'px';mp.style.top=top+'px';
    mp.style.display='block';mpOpen=true;

    // If opened from a tap gesture (triggerEvent provided), capture the pointer
    // on csStack so the user can drag to pick a color immediately. Capture
    // auto-releases on pointerup — pen-tablet hover after lifting is ignored.
    if(triggerEvent&&triggerEvent.pointerId!=null){
      pendingDragPointerId=triggerEvent.pointerId;
      csStack.setPointerCapture(triggerEvent.pointerId);
      csStack.addEventListener('pointermove',onPendingMove);
      csStack.addEventListener('pointerup',onPendingUp);
      csStack.addEventListener('pointercancel',onPendingUp);
    }
  };

  function closeMiniPicker(){
    if(!mpOpen)return;
    mp.style.display='none';mpOpen=false;
  }
  window.closeMiniPicker=closeMiniPicker;

  document.addEventListener('pointerdown',e=>{
    if(mpOpen&&!mp.contains(e.target)&&!csStack.contains(e.target)) closeMiniPicker();
  },{capture:true});
  document.addEventListener('keydown',e=>{
    if(mpOpen&&e.key==='Escape'){closeMiniPicker();e.stopPropagation();}
  },{capture:true});
})();
const cpWheelCanvas=document.getElementById('cp-wheel-canvas');
const cpSqCanvas=document.getElementById('cp-sq-canvas');
const cpSwFg=document.getElementById('cp-sw-fg');
const cpSwBg=document.getElementById('cp-sw-bg');
const cpSwTransparent=document.getElementById('cp-sw-transparent');
const cpShapeSquare=document.getElementById('cp-shape-square');
const cpShapeTriangle=document.getElementById('cp-shape-triangle');
const cpModeRGB=document.getElementById('cp-mode-rgb');
const cpModeHSV=document.getElementById('cp-mode-hsv');
const cpModeHSL=document.getElementById('cp-mode-hsl');
const cpModeV=document.getElementById('cp-mode-v');
const cpL1=document.getElementById('cp-l1'),cpL2=document.getElementById('cp-l2'),cpL3=document.getElementById('cp-l3');
const cpS1=document.getElementById('cp-s1'),cpS2=document.getElementById('cp-s2'),cpS3=document.getElementById('cp-s3');
const cpN1=document.getElementById('cp-n1'),cpN2=document.getElementById('cp-n2'),cpN3=document.getElementById('cp-n3');
const cpRow2=document.getElementById('cp-row2'),cpRow3=document.getElementById('cp-row3');
const cpNative=document.getElementById('cp-native');

let cpShape='square';
let cpMode='rgb'; // 'rgb'|'hsv'|'hsl'|'v'
let cpHue=0,cpSat=1,cpVal=0;
const WHEEL_R_BASE=120,WHEEL_THICK_BASE=18;
// Dynamic getters — read current canvas size so drawing always matches scale
function getWheelR(){return cpWheelCanvas.width/2;}
function getWheelThick(){return Math.round(WHEEL_THICK_BASE*(cpWheelCanvas.width/(WHEEL_R_BASE*2)));}
// Keep backward-compat aliases used in hitWheel/hitInner (they use WHEEL_R and WHEEL_THICK)
Object.defineProperty(window,'WHEEL_R',{get:getWheelR});
Object.defineProperty(window,'WHEEL_THICK',{get:getWheelThick});

// ── Color math ──
function hsvToRgb(h,s,v){const i=Math.floor(h/60)%6,f=h/60-Math.floor(h/60),p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);return[[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i].map(x=>Math.round(x*255));}
function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0,s=mx?d/mx:0,v=mx;if(d){if(mx===r)h=((g-b)/d+6)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}return[h,s,v];}
function hslToRgb(h,s,l){const a=s*Math.min(l,1-l),f=n=>{const k=(n+h/30)%12;return Math.round((l-a*Math.max(-1,Math.min(k-3,9-k,1)))*255);};return[f(0),f(8),f(4)];}
function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0,l=(mx+mn)/2;const d=mx-mn;if(d){s=d/(1-Math.abs(2*l-1));if(mx===r)h=((g-b)/d+6)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}return[h,s,l];}
function hexToRgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];}
function rgbToHex(r,g,b){return'#'+[r,g,b].map(v=>Math.max(0,Math.min(255,v|0)).toString(16).padStart(2,'0')).join('');}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

// ── Draw wheel ──
function drawWheel(){
  const ctx=cpWheelCanvas.getContext('2d');
  const WR=getWheelR(),WT=getWheelThick();
  const size=WR*2;
  const cx=WR,cy=WR,r=WR-2,ri=r-WT;
  ctx.clearRect(0,0,size,size);
  // draw hue ring segment by segment
  for(let a=0;a<360;a++){
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,(a-1)*Math.PI/180,(a+1)*Math.PI/180);ctx.closePath();
    ctx.fillStyle=`hsl(${a},100%,50%)`;ctx.fill();
  }
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath();ctx.arc(cx,cy,ri,0,Math.PI*2);ctx.fill();
  ctx.globalCompositeOperation='source-over';
  // hue wheel visibility: hide in V mode
  if(cpMode==='v'){cpWheelCanvas.style.opacity='0.25';}else{cpWheelCanvas.style.opacity='1';}
  // marker
  const ha=cpHue*Math.PI/180,mr=(r+ri)/2;
  ctx.beginPath();ctx.arc(cx+mr*Math.cos(ha),cy+mr*Math.sin(ha),6,0,Math.PI*2);
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.stroke();
}

// ── Draw inner shape ──
function drawInner(){
  const WR=getWheelR(),WT=getWheelThick();
  const innerR=WR-WT-6;
  if(cpShape==='square'){
    const side=innerR*Math.sqrt(2);
    const cx=WR,cy=WR;
    cpSqCanvas.width=side;cpSqCanvas.height=side;
    cpSqCanvas.style.left=(cx-side/2)+'px';cpSqCanvas.style.top=(cy-side/2)+'px';
    const ctx=cpSqCanvas.getContext('2d');
    if(cpMode==='v'){
      // black to white only
      const g=ctx.createLinearGradient(0,0,side,0);
      g.addColorStop(0,'#000');g.addColorStop(1,'#fff');
      ctx.fillStyle=g;ctx.fillRect(0,0,side,side);
    } else {
      const gH=ctx.createLinearGradient(0,0,side,0);
      gH.addColorStop(0,'#fff');gH.addColorStop(1,`hsl(${cpHue},100%,50%)`);
      ctx.fillStyle=gH;ctx.fillRect(0,0,side,side);
      const gV=ctx.createLinearGradient(0,0,0,side);
      gV.addColorStop(0,'rgba(0,0,0,0)');gV.addColorStop(1,'#000');
      ctx.fillStyle=gV;ctx.fillRect(0,0,side,side);
    }
    const mx=cpSat*side,my=(1-cpVal)*side;
    ctx.beginPath();ctx.arc(mx,my,6,0,Math.PI*2);
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
    ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.stroke();
  } else {
    // Triangle: equilateral inscribed in innerR circle.
    // v0 = top (white), v1 = bottom-left (black), v2 = bottom-right (hue)
    // Rotated so the "hue" vertex points toward the current hue angle on the wheel.
    const sz=innerR*2,cx=WR,cy=WR;
    cpSqCanvas.width=sz;cpSqCanvas.height=sz;
    cpSqCanvas.style.left=(cx-sz/2)+'px';cpSqCanvas.style.top=(cy-sz/2)+'px';
    const ctx2=cpSqCanvas.getContext('2d');
    ctx2.clearRect(0,0,sz,sz);
    const ocx=sz/2,ocy=sz/2;
    const hueRad=cpHue*Math.PI/180;
    // Three corners at 120° apart; hue corner at hueRad, white at hueRad+120°, black at hueRad+240°
    const angleHue=hueRad;
    const angleWhite=hueRad+2*Math.PI/3;
    const angleBlack=hueRad+4*Math.PI/3;
    const vH=[ocx+innerR*Math.cos(angleHue),  ocy+innerR*Math.sin(angleHue)];
    const vW=[ocx+innerR*Math.cos(angleWhite), ocy+innerR*Math.sin(angleWhite)];
    const vB=[ocx+innerR*Math.cos(angleBlack), ocy+innerR*Math.sin(angleBlack)];

    ctx2.save();
    ctx2.beginPath();ctx2.moveTo(...vH);ctx2.lineTo(...vW);ctx2.lineTo(...vB);ctx2.closePath();ctx2.clip();

    if(cpMode==='v'){
      // black→white gradient
      const g=ctx2.createLinearGradient(vB[0],vB[1],vW[0],vW[1]);
      g.addColorStop(0,'#000');g.addColorStop(1,'#fff');
      ctx2.fillStyle=g;ctx2.fillRect(0,0,sz,sz);
    } else {
      // Layer 1: white → hue color
      const g1=ctx2.createLinearGradient(vW[0],vW[1],vH[0],vH[1]);
      g1.addColorStop(0,'#ffffff');g1.addColorStop(1,`hsl(${cpHue},100%,50%)`);
      ctx2.fillStyle=g1;ctx2.fillRect(0,0,sz,sz);
      // Layer 2: transparent → black, perpendicular from mid(hue,white) toward black vertex
      const midHW=[(vH[0]+vW[0])/2,(vH[1]+vW[1])/2];
      const g2=ctx2.createLinearGradient(midHW[0],midHW[1],vB[0],vB[1]);
      g2.addColorStop(0,'rgba(0,0,0,0)');g2.addColorStop(1,'rgba(0,0,0,1)');
      ctx2.fillStyle=g2;ctx2.fillRect(0,0,sz,sz);
    }
    ctx2.restore();

    // Cursor: barycentric interpolation — sat selects hue↔white axis, val selects brightness
    // Point = vW*(1-cpSat)*cpVal + vH*cpSat*cpVal + vB*(1-cpVal)
    const px=vW[0]*(1-cpSat)*cpVal + vH[0]*cpSat*cpVal + vB[0]*(1-cpVal);
    const py=vW[1]*(1-cpSat)*cpVal + vH[1]*cpSat*cpVal + vB[1]*(1-cpVal);
    ctx2.beginPath();ctx2.arc(px,py,6,0,Math.PI*2);
    ctx2.strokeStyle='#fff';ctx2.lineWidth=2;ctx2.stroke();
    ctx2.strokeStyle='#000';ctx2.lineWidth=1;ctx2.stroke();
  }
}
function drawPicker(){drawWheel();drawInner();}

// ── Mode UI ──
const MODE_CONFIG={
  rgb:{labels:['R','G','B'],max:[255,255,255],show3:true},
  hsv:{labels:['H','S','V'],max:[360,100,100],show3:true},
  hsl:{labels:['H','S','L'],max:[360,100,100],show3:true},
  v:  {labels:['V','',''],max:[100,0,0],show3:false},
};
function applyModeUI(){
  const cfg=MODE_CONFIG[cpMode];
  cpL1.textContent=cfg.labels[0];cpL2.textContent=cfg.labels[1];cpL3.textContent=cfg.labels[2];
  cpS1.max=cfg.max[0];cpN1.max=cfg.max[0];
  cpS2.max=cfg.max[1];cpN2.max=cfg.max[1];
  cpS3.max=cfg.max[2];cpN3.max=cfg.max[2];
  cpRow2.style.display=cfg.show3?'':'none';
  cpRow3.style.display=cfg.show3?'':'none';
  [cpModeRGB,cpModeHSV,cpModeHSL,cpModeV].forEach(b=>b.classList.remove('active'));
  if(cpSlidersVisible){({rgb:cpModeRGB,hsv:cpModeHSV,hsl:cpModeHSL,v:cpModeV})[cpMode].classList.add('active');}
}
function getSliderValues(){
  const rgb=hsvToRgb(cpHue,cpSat,cpVal);
  if(cpMode==='rgb') return rgb;
  if(cpMode==='hsv') return[Math.round(cpHue),Math.round(cpSat*100),Math.round(cpVal*100)];
  if(cpMode==='hsl'){const[h,s,l]=rgbToHsl(...rgb);return[Math.round(h),Math.round(s*100),Math.round(l*100)];}
  if(cpMode==='v')  return[Math.round(cpVal*100),0,0];
  return rgb;
}
function syncSliders(){
  const vals=getSliderValues();
  cpS1.value=vals[0];cpN1.value=vals[0];
  cpS2.value=vals[1];cpN2.value=vals[1];
  cpS3.value=vals[2];cpN3.value=vals[2];
}

// ── Apply color live ──
function _applyColorLive(hex){
  if(colorTarget==='fg'){
    color=hex;colorIn.value=hex;document.getElementById('stat-color').textContent='Color: '+hex;
    if(tool==='eraser') setTool('brush','Brush');
  } else {bgDrawColor=hex;}
  refreshColorSwatches();
  syncColorPanelSwatches();
  if(colorTarget==='fg'&&window.PaletteDocker&&typeof window.PaletteDocker.updateActiveAdvancedStyleFromColorPanel==='function') window.PaletteDocker.updateActiveAdvancedStyleFromColorPanel(hex);
}
function syncColorPanelSwatches(){
  cpSwFg.style.background=tool==='eraser'?'':color;
  cpSwFg.classList.toggle('cs-swatch-checker',tool==='eraser');
  cpSwBg.style.background=bgDrawColor;
  cpSwTransparent.classList.toggle('active',tool==='eraser');
  // Selected border highlight + bring selected swatch to front
  const fgSel=colorTarget==='fg';
  cpSwFg.classList.toggle('cp-swatch-selected',fgSel);
  cpSwBg.classList.toggle('cp-swatch-selected',!fgSel);
  cpSwFg.style.zIndex=fgSel?'3':'1';
  cpSwBg.style.zIndex=fgSel?'1':'3';
}
function currentEditColor(){return colorTarget==='fg'?(tool==='eraser'?'#000000':color):bgDrawColor;}
function setFromHsv(h,s,v){
  cpHue=h;cpSat=s;cpVal=v;
  const rgb=hsvToRgb(h,s,v);
  const hex=rgbToHex(...rgb);
  _applyColorLive(hex);
  syncSliders();
  drawPicker();
}
function setFromHex(hex){
  const rgb=hexToRgb(hex);
  [cpHue,cpSat,cpVal]=rgbToHsv(...rgb);
  _applyColorLive(hex);
  syncSliders();
  drawPicker();
}
function syncColorPanelInputs(){
  setFromHex(currentEditColor());
  syncColorPanelSwatches();
}
window.setForegroundColorFromPalette=function(hex,openPicker,skipPaletteRender){
  colorTarget='fg';
  setFromHex(hex);
  if(openPicker){
    const panel=document.getElementById('color-panel');
    if(typeof FloatPanels!=='undefined'&&FloatPanels.setVisible) FloatPanels.setVisible('color',true);
    if(panel&&typeof FloatPanels!=='undefined'&&FloatPanels.bringToFront) FloatPanels.bringToFront(panel);
  }
  if(!skipPaletteRender&&window.PaletteDocker&&typeof window.PaletteDocker.renderCurrentColors==='function') window.PaletteDocker.renderCurrentColors();
};

// ── Slider / number input interaction ──
function _advancedHistoryRgba(){
  return window.PaletteDocker&&typeof window.PaletteDocker.getActiveAdvancedStyleColorForHistory==='function'
    ?window.PaletteDocker.getActiveAdvancedStyleColorForHistory():null;
}
function _sameHistoryRgba(a,b){return !!(a&&b&&a.length===4&&b.length===4&&a.every((value,index)=>value===b[index]));}
function _recordAdvancedHistoryAfter(start){
  const finalRgba=_advancedHistoryRgba();
  if(start&&finalRgba&&!_sameHistoryRgba(start,finalRgba)&&window.AdvancedColorHistory) window.AdvancedColorHistory.record(finalRgba);
}
function onSliderChange(){
  let rgb;
  if(cpMode==='rgb'){rgb=[+cpS1.value,+cpS2.value,+cpS3.value];}
  else if(cpMode==='hsv'){[cpHue,cpSat,cpVal]=[+cpS1.value,+cpS2.value/100,+cpS3.value/100];rgb=hsvToRgb(cpHue,cpSat,cpVal);}
  else if(cpMode==='hsl'){rgb=hslToRgb(+cpS1.value,+cpS2.value/100,+cpS3.value/100);[cpHue,cpSat,cpVal]=rgbToHsv(...rgb);}
  else if(cpMode==='v'){const v=+cpS1.value/100;cpSat=0;cpVal=v;rgb=hsvToRgb(cpHue,0,v);}
  if(rgb){_applyColorLive(rgbToHex(...rgb));cpN1.value=cpS1.value;cpN2.value=cpS2.value;cpN3.value=cpS3.value;drawPicker();}
}
function onNumberChange(){cpS1.value=cpN1.value;cpS2.value=cpN2.value;cpS3.value=cpN3.value;onSliderChange();}
[cpS1,cpS2,cpS3].forEach(s=>s.addEventListener('input',onSliderChange));
[cpN1,cpN2,cpN3].forEach(n=>n.addEventListener('change',onNumberChange));
const _colorControlStarts=new WeakMap();
[cpS1,cpS2,cpS3,cpN1,cpN2,cpN3].forEach(input=>{
  const begin=()=>{const rgba=_advancedHistoryRgba();if(rgba)_colorControlStarts.set(input,rgba);else _colorControlStarts.delete(input);};
  const commit=()=>{if(!_colorControlStarts.has(input))return;const start=_colorControlStarts.get(input);_colorControlStarts.delete(input);_recordAdvancedHistoryAfter(start);};
  input.addEventListener('focus',begin);
  input.addEventListener('pointerdown',begin);
  input.addEventListener('change',commit);
  if(input.type==='number'){
    input.addEventListener('keydown',event=>{if(event.key==='Enter'&&input.checkValidity()){onNumberChange();commit();}});
    input.addEventListener('blur',()=>{if(input.checkValidity())commit();else _colorControlStarts.delete(input);});
  }else input.addEventListener('pointerup',commit);
});

// ── Wheel / inner interaction ──
(function(){
  let wheelDown=false,sqDown=false,historyStart=null;
  function hitWheel(e){
    const rect=cpWheelCanvas.getBoundingClientRect();
    const x=e.clientX-rect.left-WHEEL_R,y=e.clientY-rect.top-WHEEL_R;
    const dist=Math.sqrt(x*x+y*y),ri=WHEEL_R-WHEEL_THICK-2;
    // Initial click: only start a wheel drag if cursor is actually in the ring band
    if(!wheelDown&&(dist<ri||dist>WHEEL_R-2)) return false;
    // While dragging: always compute hue from angle regardless of distance
    if(cpMode!=='v') cpHue=(Math.atan2(y,x)*180/Math.PI+360)%360;
    setFromHsv(cpHue,cpSat,cpVal);return true;
  }
  function hitInner(e){
    const rect=cpSqCanvas.getBoundingClientRect();
    const x=clamp(e.clientX-rect.left,0,cpSqCanvas.width);
    const y=clamp(e.clientY-rect.top,0,cpSqCanvas.height);
    if(cpShape==='square'){
      if(cpMode==='v'){cpVal=x/cpSqCanvas.width;cpSat=0;}
      else{cpSat=x/cpSqCanvas.width;cpVal=1-y/cpSqCanvas.height;}
    } else {
      // Triangle mode: derive sat/val using the same vertex layout as drawInner
      const innerR=WHEEL_R-WHEEL_THICK-6;
      const ocx=cpSqCanvas.width/2,ocy=cpSqCanvas.height/2;
      const hueRad=cpHue*Math.PI/180;
      const vH=[ocx+innerR*Math.cos(hueRad),         ocy+innerR*Math.sin(hueRad)];
      const vW=[ocx+innerR*Math.cos(hueRad+2*Math.PI/3), ocy+innerR*Math.sin(hueRad+2*Math.PI/3)];
      const vB=[ocx+innerR*Math.cos(hueRad+4*Math.PI/3), ocy+innerR*Math.sin(hueRad+4*Math.PI/3)];
      // Barycentric coords of click point relative to the three triangle verts
      const denom=(vW[1]-vB[1])*(vH[0]-vB[0])+(vB[0]-vW[0])*(vH[1]-vB[1]);
      if(Math.abs(denom)<0.001){setFromHsv(cpHue,cpSat,cpVal);return;}
      const lH=((vW[1]-vB[1])*(x-vB[0])+(vB[0]-vW[0])*(y-vB[1]))/denom;
      const lW=((vB[1]-vH[1])*(x-vB[0])+(vH[0]-vB[0])*(y-vB[1]))/denom;
      const lB=1-lH-lW;
      // Clamp to inside triangle
      const sum=Math.max(lH,0)+Math.max(lW,0)+Math.max(lB,0)||1;
      const bH=Math.max(lH,0)/sum,bW=Math.max(lW,0)/sum;
      if(cpMode==='v'){
        cpVal=clamp(bW+bH,0,1);cpSat=0;
      } else {
        // val = bH+bW (everything that isn't black), sat = bH / (bH+bW) (how much hue vs white)
        const val=clamp(bH+bW,0,1);
        const sat=val>0.001?clamp(bH/val,0,1):0;
        cpSat=sat;cpVal=val;
      }
    }
    setFromHsv(cpHue,cpSat,cpVal);
  }
  // Synthetic pick-point indicator — see #cp-pick-cursor in style.css for why.
  let _cpPickEl=document.getElementById('cp-pick-cursor');
  if(!_cpPickEl){
    _cpPickEl=document.createElement('div');
    _cpPickEl.id='cp-pick-cursor';
    document.body.appendChild(_cpPickEl);
  }
  function _showPickCursor(e){ _cpPickEl.style.left=e.clientX+'px'; _cpPickEl.style.top=e.clientY+'px'; _cpPickEl.style.display='block'; }
  function _hidePickCursor(){ _cpPickEl.style.display='none'; }

  // Use setPointerCapture so drag tracking is tied to the physical press.
  // Capture auto-releases on pointerup — pen-tablet hover after lifting is ignored.
  function onWheelMove(e){if(wheelDown)hitWheel(e);else if(sqDown)hitInner(e);_showPickCursor(e);}
  function onWheelUp(e){
    const shouldCommit=e.type!=='pointercancel';
    wheelDown=false;sqDown=false;_hidePickCursor();
    if(shouldCommit)_recordAdvancedHistoryAfter(historyStart);historyStart=null;
    cpWheelCanvas.removeEventListener('pointermove',onWheelMove);
    cpWheelCanvas.removeEventListener('pointerup',onWheelUp);
    cpWheelCanvas.removeEventListener('pointercancel',onWheelUp);
  }
  cpWheelCanvas.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const start=_advancedHistoryRgba();
    if(hitWheel(e)){wheelDown=true;historyStart=start;}
    else{
      const sqRect=cpSqCanvas.getBoundingClientRect();
      if(e.clientX>=sqRect.left&&e.clientX<=sqRect.right&&e.clientY>=sqRect.top&&e.clientY<=sqRect.bottom){
        sqDown=true;historyStart=start;hitInner(e);
      } else {
        return;
      }
    }
    _showPickCursor(e);
    cpWheelCanvas.setPointerCapture(e.pointerId);
    cpWheelCanvas.addEventListener('pointermove',onWheelMove);
    cpWheelCanvas.addEventListener('pointerup',onWheelUp);
    cpWheelCanvas.addEventListener('pointercancel',onWheelUp);
  });
  function onSqMove(e){if(sqDown)hitInner(e);_showPickCursor(e);}
  function onSqUp(e){
    const shouldCommit=e.type!=='pointercancel';
    sqDown=false;_hidePickCursor();
    if(shouldCommit)_recordAdvancedHistoryAfter(historyStart);historyStart=null;
    cpSqCanvas.removeEventListener('pointermove',onSqMove);
    cpSqCanvas.removeEventListener('pointerup',onSqUp);
    cpSqCanvas.removeEventListener('pointercancel',onSqUp);
  }
  cpSqCanvas.addEventListener('pointerdown',e=>{
    e.preventDefault();historyStart=_advancedHistoryRgba();sqDown=true;hitInner(e);
    _showPickCursor(e);
    cpSqCanvas.setPointerCapture(e.pointerId);
    cpSqCanvas.addEventListener('pointermove',onSqMove);
    cpSqCanvas.addEventListener('pointerup',onSqUp);
    cpSqCanvas.addEventListener('pointercancel',onSqUp);
  });
})();

// ── Shape toggle ──
cpShapeSquare.onclick=()=>{cpShape='square';cpShapeSquare.classList.add('active');cpShapeTriangle.classList.remove('active');drawPicker();};
cpShapeTriangle.onclick=()=>{cpShape='triangle';cpShapeTriangle.classList.add('active');cpShapeSquare.classList.remove('active');drawPicker();};

// ── Mode toggle — clicking a mode button shows sliders; clicking the active one hides them ──
let cpSlidersVisible=false;
function setSlidersVisible(v){
  cpSlidersVisible=v;
  const sw=document.getElementById('cp-sliders-wrap');
  sw.style.display=v?'flex':'none';
  // Sliders change panel content height — recalc wheel size
  requestAnimationFrame(()=>{if(window._cpUpdateWheel)_cpUpdateWheel();});
}
[{btn:cpModeRGB,mode:'rgb'},{btn:cpModeHSV,mode:'hsv'},{btn:cpModeHSL,mode:'hsl'},{btn:cpModeV,mode:'v'}].forEach(({btn,mode})=>{
  btn.onclick=()=>{
    if(cpMode===mode&&cpSlidersVisible){
      // Tap same active mode button → hide sliders, deactivate button
      setSlidersVisible(false);
      [cpModeRGB,cpModeHSV,cpModeHSL,cpModeV].forEach(b=>b.classList.remove('active'));
    } else {
      cpMode=mode;
      setSlidersVisible(true); // set BEFORE applyModeUI so active class is applied
      applyModeUI();syncSliders();drawPicker();
    }
  };
});

// ── Swatch buttons (no labels, just click the swatch) ──
cpSwFg.addEventListener('click',()=>{colorTarget='fg';syncColorPanelInputs();});
cpSwBg.addEventListener('click',()=>{colorTarget='bg';syncColorPanelInputs();});
cpSwTransparent.addEventListener('click',()=>{setTool('eraser','Eraser');syncColorPanelSwatches();});


// ── Color panel: free edge/corner resize ───────────────────────
// Width and height are independently resizable via 4 edges + 4 corners.
// The color wheel is always a square centered in the available space,
// sized to min(available_w, available_h_for_wheel).
// Sliders stretch to the full panel width. Buttons never overflow.
(function(){
  const panel=document.getElementById('color-panel');
  const body=document.getElementById('color-panel-body');
  const wrap=panel.querySelector('.cp-wheel-wrap');
  const toggleRowsEl=document.getElementById('cp-toggle-rows');
  const MIN_W=160,MIN_H=180,MAX_W=700,MAX_H=900;
  const MIN_WHEEL=80; // smallest the wheel may shrink to when measuring "needed" height

  // Set initial panel size. NOTE: the panel is hidden (display:none) at this
  // point, so we do NOT measure/layout anything yet — offsetWidth/offsetHeight
  // would read as 0 while hidden. The real fit-to-content pass runs the first
  // time the panel is actually shown (see openColorPanel()).
  // Preserve a fixed/default preferred size, but don't stomp a size already
  // restored from the saved layout (FloatPanels.init()/_restoreLayout() run
  // before this script, so panel.style.width/height are already applied if
  // a prior session had resized/persisted this panel).
  const INIT_W=200,INIT_H=240;
  if(!panel.style.width) panel.style.width=INIT_W+'px';
  if(!panel.style.height) panel.style.height=INIT_H+'px';
  if(typeof FloatPanels!=='undefined'&&FloatPanels.setFloatSize){
    FloatPanels.setFloatSize('color',parseFloat(panel.style.width)||INIT_W,parseFloat(panel.style.height)||INIT_H);
  }

  function isPanelVisible(){
    return !panel.classList.contains('fp-hidden') && panel.offsetParent!==null;
  }

  // Decide row vs. stacked ("compact") toggle-button layout by actually
  // measuring whether the buttons fit at the given panel width, instead of
  // comparing against a hardcoded panel-width threshold. Returns the
  // resulting height of the toggle-row block once the layout is applied.
  function layoutToggleRows(panelW){
    const availW=panelW-16; // #color-panel-body has 8px padding left+right
    const prevWrap=toggleRowsEl.style.flexWrap;
    const wasCompact=body.classList.contains('cp-compact');
    if(wasCompact) body.classList.remove('cp-compact');
    toggleRowsEl.style.flexWrap='nowrap'; // measure the natural single-line width
    const naturalW=toggleRowsEl.scrollWidth;
    toggleRowsEl.style.flexWrap=prevWrap;
    body.classList.toggle('cp-compact',naturalW>availW+1);
    return toggleRowsEl.offsetHeight||24;
  }

  // Minimum panel height needed to show the titlebar, the toggle-row
  // buttons (in whichever layout fits at panelW) and the sliders (if
  // visible) without clipping, leaving just enough room for a small wheel.
  function measureNeededHeight(panelW){
    const titleH=panel.querySelector('.fp-titlebar').offsetHeight||22;
    const toggleH=layoutToggleRows(panelW);
    const slidersEl=document.getElementById('cp-sliders-wrap');
    const slidersVisible=slidersEl&&slidersEl.style.display!=='none';
    const slidersH=slidersVisible?slidersEl.offsetHeight:0;
    const gaps=slidersVisible?3:2; // wheel-wrap + toggle-rows [+ sliders-wrap]
    const padV=8*2+5*gaps;
    return titleH+toggleH+slidersH+MIN_WHEEL+padV;
  }

  function updateWheel(){
    if(!isPanelVisible()) return; // nothing to measure/draw while hidden
    // Measure available space: panel height minus everything that isn't the wheel
    const panelW=panel.offsetWidth;
    const panelH=panel.offsetHeight;
    const titleH=panel.querySelector('.fp-titlebar').offsetHeight||22;
    const toggleH=layoutToggleRows(panelW); // also applies/clears cp-compact
    const slidersEl=document.getElementById('cp-sliders-wrap');
    const slidersVisible=slidersEl&&slidersEl.style.display!=='none';
    const slidersH=slidersVisible?slidersEl.offsetHeight:0;
    const gaps=slidersVisible?3:2;
    const pad=8*2+5*gaps; // padding + gaps
    const availH=panelH-titleH-toggleH-slidersH-pad;
    const availW=panelW-pad;
    const wheelPx=Math.max(MIN_WHEEL,Math.min(availW,availH,300));
    const sc=wheelPx/240;
    document.documentElement.style.setProperty('--cp-scale',sc);
    // Size the wheel wrap and canvas
    wrap.style.width=wheelPx+'px';
    wrap.style.height=wheelPx+'px';
    cpWheelCanvas.width=wheelPx;
    cpWheelCanvas.height=wheelPx;
    cpWheelCanvas.style.width=wheelPx+'px';
    cpWheelCanvas.style.height=wheelPx+'px';
    drawPicker();
  }

  // Grow (never shrink) the panel height so the toggle-row buttons and
  // sliders are never clipped. Used right after the panel is first shown.
  function ensureHeightFits(){
    if(!isPanelVisible()) return;
    const neededH=measureNeededHeight(panel.offsetWidth);
    if(neededH>panel.offsetHeight){
      const h=Math.min(MAX_H,neededH);
      panel.style.height=h+'px';
      if(typeof FloatPanels!=='undefined'&&FloatPanels.setFloatSize) FloatPanels.setFloatSize('color',null,h);
    }
  }

  // Snugly fit the panel height to a given target width — used during a
  // width-only (W/E edge) drag. Unlike ensureHeightFits this can shrink as
  // well as grow: narrowing the panel shrinks the wheel too, so the height
  // is recomputed to match exactly, instead of leaving empty space below
  // the wheel/buttons/sliders.
  function fitHeightToWidth(panelW){
    const titleH=panel.querySelector('.fp-titlebar').offsetHeight||22;
    const toggleH=layoutToggleRows(panelW);
    const slidersEl=document.getElementById('cp-sliders-wrap');
    const slidersVisible=slidersEl&&slidersEl.style.display!=='none';
    const slidersH=slidersVisible?slidersEl.offsetHeight:0;
    const gaps=slidersVisible?3:2;
    const pad=8*2+5*gaps;
    const availW=panelW-pad;
    const wheelWanted=Math.max(MIN_WHEEL,Math.min(availW,500));
    const idealH=titleH+toggleH+slidersH+wheelWanted+pad;
    const h=Math.max(MIN_H,Math.min(MAX_H,idealH));
    panel.style.height=h+'px';
    if(typeof FloatPanels!=='undefined'&&FloatPanels.setFloatSize) FloatPanels.setFloatSize('color',null,h);
  }

  function applyPanelSize(w,h){
    w=Math.max(MIN_W,Math.min(MAX_W,w));
    h=Math.max(MIN_H,Math.min(MAX_H,h));
    panel.style.width=w+'px';
    panel.style.height=h+'px';
    if(typeof FloatPanels!=='undefined'&&FloatPanels.setFloatSize) FloatPanels.setFloatSize('color',w,h);
    updateWheel();
  }

  // Build 8 resize handles and inject into panel
  const EDGES=['n','s','w','e','nw','ne','sw','se'];
  EDGES.forEach(side=>{
    const el=document.createElement('div');
    el.className='cp-re cp-re-'+side;
    el.dataset.side=side;
    panel.appendChild(el);
    let active=false,sx=0,sy=0,sw=0,sh=0,sl=0,st=0,dockedDrag=false,startDockW=0;
    el.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      active=true;el.setPointerCapture(e.pointerId);
      sx=e.clientX;sy=e.clientY;
      sw=panel.offsetWidth;sh=panel.offsetHeight;
      sl=parseFloat(panel.style.left)||0;st=parseFloat(panel.style.top)||0;
      dockedDrag=!!(typeof FloatPanels!=='undefined'&&FloatPanels.isDocked&&FloatPanels.isDocked('color'));
      if(dockedDrag) startDockW=FloatPanels.getDockWidth('color')||sw;
    });
    el.addEventListener('pointermove',e=>{
      if(!active)return;
      const dx=e.clientX-sx,dy=e.clientY-sy;
      if(dockedDrag){
        // While docked/stacked, width is shared by the whole column (e.g.
        // Color + Brush Presets) — drive that shared width instead of this
        // panel's own style.width, so every panel in the stack resizes
        // together. Height isn't handled here: a docked stack's height is
        // owned by the split seam between panels, not free N/S edges.
        if(!side.includes('w')&&!side.includes('e')) return; // pure n/s: no-op while docked
        let nw=side.includes('w')?startDockW-dx:startDockW+dx;
        FloatPanels.setDockWidth('color',nw);
        return;
      }
      let nw=sw,nh=sh,nl=sl,nt=st;
      if(side.includes('e')) nw=Math.max(MIN_W,Math.min(MAX_W,sw+dx));
      if(side.includes('w')){nw=Math.max(MIN_W,Math.min(MAX_W,sw-dx));nl=sl+(sw-nw);}
      if(side.includes('s')) nh=Math.max(MIN_H,Math.min(MAX_H,sh+dy));
      if(side.includes('n')){nh=Math.max(MIN_H,Math.min(MAX_H,sh-dy));nt=st+(sh-nh);}
      panel.style.width=nw+'px';panel.style.height=nh+'px';
      panel.style.left=nl+'px';panel.style.top=nt+'px';
      // Pure width-only drag (no height component): re-fit the height to
      // exactly match the new wheel size instead of leaving dead space
      // (or clipping buttons) — this overrides the nh set just above.
      if(side==='w'||side==='e') fitHeightToWidth(nw);
      updateWheel();
      if(typeof FloatPanels!=='undefined'&&FloatPanels.setFloatSize){
        FloatPanels.setFloatSize('color',parseFloat(panel.style.width),parseFloat(panel.style.height));
      }
    });
    function endResize(){
      if(!active) return;
      active=false;
      if(typeof FloatPanels!=='undefined'&&FloatPanels.saveLayout) FloatPanels.saveLayout();
    }
    el.addEventListener('pointerup',endResize);
    el.addEventListener('pointercancel',endResize);
  });

  // Whenever the color panel transitions from hidden to visible — no matter
  // which code path did it (Window menu toggle, dragging the swatch out to
  // pop out a panel, openColorPanel(), tab un-merge, etc.) — re-fit and
  // redraw once layout has actually settled. This is what fixes the wheel/
  // buttons/swatches looking "scrambled" right after opening: previously
  // only one specific call site re-measured after showing the panel, so
  // other ways of opening it left stale sizing in place until the user
  // nudged a resize handle.
  let pendingShowFix=false;
  function scheduleShowFix(){
    if(pendingShowFix) return;
    pendingShowFix=true;
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        pendingShowFix=false;
        if(!isPanelVisible()) return;
        ensureHeightFits();
        updateWheel();
      });
    });
  }
  // Only trigger the show-fix when the panel transitions from hidden→visible
  // (fp-hidden removed). Reacting to every class change (dock-left, dragging-panel,
  // etc.) caused a feedback loop during titlebar drags: ensureHeightFits() grew
  // the panel, which changed its class, which triggered ensureHeightFits() again.
  let _wasHidden=panel.classList.contains('fp-hidden');
  new MutationObserver(()=>{
    const hidden=panel.classList.contains('fp-hidden');
    if(_wasHidden && !hidden) scheduleShowFix(); // became visible
    _wasHidden=hidden;
  }).observe(panel,{attributes:true,attributeFilter:['class']});

  // Expose so other code (e.g. when sliders toggle) can ask for a redraw.
  window._cpUpdateWheel=updateWheel;
  window._cpEnsureHeightFits=ensureHeightFits;

  // Re-fit the wheel whenever the panel's actual rendered size changes for
  // ANY reason — not just this file's own 8 resize handles. When the panel
  // is docked, its width/height are driven externally (dock-width drag,
  // the split seam between stacked panels, a timeline-resize-triggered
  // FloatPanels.render() reflow, browser window resize, etc.), and none of
  // those code paths know to call updateWheel() themselves. A ResizeObserver
  // catches all of them uniformly instead of us having to hunt down and
  // hook every external trigger individually.
  let _roPending=false;
  const _ro=new ResizeObserver(()=>{
    if(_roPending) return;
    _roPending=true;
    requestAnimationFrame(()=>{
      _roPending=false;
      if(!isPanelVisible()) return;
      updateWheel();
    });
  });
  _ro.observe(panel);
})();

// ── Init mode UI ──
applyModeUI();

// ── Open color panel ──
function openColorPanel(){
  FloatPanels.setVisible('color',true);
  syncColorPanelInputs();
}
function openColorPanelAt(){}

szSlider.oninput=e=>{const v=+e.target.value;toolSizes[tool]=v;if(typeof refreshSizeUI==='function')refreshSizeUI();else szValEl.textContent=v;_aaDabCache.clear();_stampCache.clear();};
