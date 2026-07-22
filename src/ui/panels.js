// ════════════════════════════════════════════════════════════════
// FLOOD FILL
// ════════════════════════════════════════════════════════════════
function floodFill(x,y,fc){
  const img=ctx.getImageData(0,0,CW,CH),d=img.data;
  const smartFill=layers[curLayer]&&layers[curLayer].type==='smart-raster'&&advancedPalettePaintingEnabled();
  const smartFillStyle=smartFill?activeAdvancedStyleIdForPainting():null;
  const fillPixelAllowed=window.SelectionScope?pixel=>SelectionScope.allowsPixel(pixel):()=>true;
  const beforeSmartFill=smartFillStyle?{data:d.slice()}:null;
  const px=Math.max(0,Math.min(CW-1,Math.round(x)));
  const py=Math.max(0,Math.min(CH-1,Math.round(y)));
  const i=(py*CW+px)*4;
  const tr=d[i],tg=d[i+1],tb=d[i+2],ta=d[i+3];
  const fr=parseInt(fc.slice(1,3),16),fg=parseInt(fc.slice(3,5),16),fb=parseInt(fc.slice(5,7),16);
  if(tr===fr&&tg===fg&&tb===fb&&ta===255) return;

  const pixelCount=CW*CH;
  const visited=new Uint8Array(pixelCount);
  const region=new Uint8Array(pixelCount);
  let minFillX=CW,minFillY=CH,maxFillX=-1,maxFillY=-1;
  const queue=new Int32Array(pixelCount);
  let head=0,tail=0;
  const start=py*CW+px;
  if(!fillPixelAllowed(start))return;
  visited[start]=1;
  queue[tail++]=start;

  while(head<tail){
    const pixel=queue[head++];
    const cx=pixel%CW;
    const cy=Math.floor(pixel/CW);
    const j=(cy*CW+cx)*4;
    if(!fillPixelAllowed(pixel))continue;
    const matches=ta===0?d[j+3]===0:
      d[j]===tr&&d[j+1]===tg&&d[j+2]===tb&&d[j+3]===ta;
    if(!matches) continue;

    region[pixel]=1;if(cx<minFillX)minFillX=cx;if(cx>maxFillX)maxFillX=cx;if(cy<minFillY)minFillY=cy;if(cy>maxFillY)maxFillY=cy;

    if(cx>0){
      const left=pixel-1;
      if(!visited[left]){visited[left]=1;queue[tail++]=left;}
    }
    if(cx+1<CW){
      const right=pixel+1;
      if(!visited[right]){visited[right]=1;queue[tail++]=right;}
    }
    if(cy>0){
      const up=pixel-CW;
      if(!visited[up]){visited[up]=1;queue[tail++]=up;}
    }
    if(cy+1<CH){
      const down=pixel+CW;
      if(!visited[down]){visited[down]=1;queue[tail++]=down;}
    }
  }
  if(maxFillX<minFillX||maxFillY<minFillY)return;
  const dirtyBounds={x:minFillX,y:minFillY,w:maxFillX-minFillX+1,h:maxFillY-minFillY+1};
  const fillSettings=window.FillMaskEngine?FillMaskEngine.getSettings():null;
  if(fillSettings&&fillSettings.antialiasing&&window.BucketFillAA){
    BucketFillAA.apply(region,dirtyBounds,fc);return;
  }
  for(let row=minFillY;row<=maxFillY;row++)for(let col=minFillX;col<=maxFillX;col++)if(region[row*CW+col]){
    const offset=(row*CW+col)*4;d[offset]=fr;d[offset+1]=fg;d[offset+2]=fb;d[offset+3]=255;
  }
  ctx.putImageData(img,0,0);
  if(beforeSmartFill&&typeof applyStyleDiffFromBefore==='function'){
    applyStyleDiffFromBefore(beforeSmartFill,smartFillStyle);
  }
}

// ════════════════════════════════════════════════════════════════
// LAYER CANVAS
// ════════════════════════════════════════════════════════════════
function mkLayerCanvas(){const o=document.createElement('canvas');o.width=CW;o.height=CH;return o;}
// ── Smart Raster index canvas helpers ────────────────────────────
// All Smart Raster logic has moved to smart-raster-layer.js which must be
// loaded before this file.  The helpers below are thin shims that forward
// calls to window.SmartRasterLayer so that existing callers in
// brush-engine.js, palette.js, tools-color.js, layers.js, and ui-controls.js
// continue to work without any changes.

// Local aliases used by callers outside this file through the
// window.* shims below.
function mkStyleIndexCanvas(){return window.SmartRasterLayer._mkIndexCanvas();}
function cloneStyleCanvas(src){return window.SmartRasterLayer.cloneIndexCanvas(src);}
function cloneStyleMeta(meta){return window.SmartRasterLayer.cloneMeta(meta);}
function makeEmptyStyleMeta(){return window.SmartRasterLayer._makeEmptyMeta();}

// ensureLayerStyleStorage: kept for _deepCopyLayer in layers.js which checks
// that the new field names exist.  Works on both old (styleFrames) and new
// (indexFrames) shapes so it is safe during any migration window.
function ensureLayerStyleStorage(layer){
  if(!layer) return null;
  if(!layer.indexFrames)  layer.indexFrames={};
  if(!layer.indexMeta)    layer.indexMeta={};
  return layer;
}

function resetStyleFrame(li,fi){window.SmartRasterLayer.resetFrame(li,fi);}
function ensureStyleFrame(li,fi){return window.SmartRasterLayer.ensureFrame(li==null?curLayer:li,fi==null?curFrame:fi);}
function ensureStyleIndexForFrame(li,fi,styleId){return window.SmartRasterLayer.ensureStyleIndex(li,fi,styleId);}
function encodeStyleIndexToPixel(data,offset,index){window.SmartRasterLayer._encodePixel(data,offset,index);}

function activeAdvancedStyleIdForPainting(){
  if(typeof window==='undefined') return null;
  if(typeof window.getActiveAdvancedPaletteStyleId==='function') return window.getActiveAdvancedPaletteStyleId();
  if(window.PaletteDocker&&typeof window.PaletteDocker.getActiveAdvancedPaletteStyleId==='function') return window.PaletteDocker.getActiveAdvancedPaletteStyleId();
  return null;
}

function advancedPalettePaintingEnabled(){
  if(typeof window==='undefined') return false;
  if(typeof window.isAdvancedPalettePaintingEnabled==='function') return !!window.isAdvancedPalettePaintingEnabled();
  return !!(window.PaletteDocker&&typeof window.PaletteDocker.isAdvancedPalettePaintingEnabled==='function'&&window.PaletteDocker.isAdvancedPalettePaintingEnabled());
}

// ── Global shims: old names used by brush-engine.js / palette.js / tools-color.js ──

function renderSmartRasterFrame(li,fi,targetCanvas){
  if(li==null) li=curLayer;
  if(fi==null) fi=curFrame;
  return window.SmartRasterLayer.renderFrame(li,fi,targetCanvas);
}

function commitSmartRasterBrush(maskCanvas,styleId,strokeOpacity,dirtyRect,beforeImage,brushBlendMode){
  if(!advancedPalettePaintingEnabled()||!styleId||!maskCanvas) return false;
  return window.SmartRasterLayer.commitBrushMask(curLayer,curFrame,maskCanvas,styleId,strokeOpacity,dirtyRect,beforeImage,brushBlendMode);
}

function rerenderAllSmartRasterFrames(){
  window.SmartRasterLayer.rerenderAll();
}

function applyStyleMaskFromCanvas(maskCanvas,styleId){
  if(!advancedPalettePaintingEnabled()||!styleId||!maskCanvas) return;
  window.SmartRasterLayer.applyMask(curLayer,curFrame,maskCanvas,styleId);
}

function applyStyleDiffFromBefore(beforeImage,styleId){
  if(!advancedPalettePaintingEnabled()||!styleId||!beforeImage) return;
  window.SmartRasterLayer.applyDiff(curLayer,curFrame,beforeImage,styleId);
}

function clearStyleIndexWhereTransparent(rect){
  window.SmartRasterLayer.clearWhereTransparent(curLayer,curFrame,rect);
}

function deleteStyleFrame(li,fi){window.SmartRasterLayer.resetFrame(li,fi);}

// Serialization: the payload format is unchanged.  The new field names are
// used internally; the serialized JSON keys ('frames', 'meta') are the same.
function serializeLayerStyleFrames(layer){
  return window.SmartRasterLayer.serializeLayer(layer);
}
function deserializeLayerStyleFrames(layer,data){
  return window.SmartRasterLayer.deserializeLayer(layer,data);
}

function resizeAllStyleFrames(nw,nh){
  window.SmartRasterLayer.resizeAllFrames(nw,nh);
}

function markStyleDeleted(styleId){
  window.SmartRasterLayer.markDeleted(styleId);
}

// ── Publish shims on window so external callers (brush-engine.js, etc.) find them ──
window.commitSmartRasterBrush=commitSmartRasterBrush;
window.renderSmartRasterFrame=renderSmartRasterFrame;
window.rerenderAllSmartRasterFrames=rerenderAllSmartRasterFrames;
window.getStyleFrameBundle=function(li,fi){return window.SmartRasterLayer.getFrameBundle(li,fi);};
window.restoreStyleFrameBundle=function(li,fi,bundle){window.SmartRasterLayer.restoreFrameBundle(li,fi,bundle);};
window.applyStyleMaskFromCanvas=applyStyleMaskFromCanvas;
window.applyStyleDiffFromBefore=applyStyleDiffFromBefore;
window.clearStyleIndexWhereTransparent=clearStyleIndexWhereTransparent;
window.deleteStyleFrame=deleteStyleFrame;
window.resizeAllStyleFrames=resizeAllStyleFrames;
window.markStyleDeleted=markStyleDeleted;
window.serializeLayerStyleFrames=serializeLayerStyleFrames;
window.deserializeLayerStyleFrames=deserializeLayerStyleFrames;

// PERF FIX: recomposite() runs on every animation frame while a stroke is in
// progress (RAF-scheduled from pointermove). Previously, every group-clipped
// or layer-clipped (stencil) layer caused 1-2 brand-new full-resolution
// (e.g. 1920×1080) <canvas> elements to be allocated EVERY frame just to
// build a mask/result buffer, then thrown away — serious GC
// churn and allocation cost piling up 60×/sec while drawing, on top of the
// actual compositing work. Reuse two persistent scratch canvases instead;
// they're only resized (re-allocated) when the document's canvas size
// actually changes, and cleared (not reallocated) before each reuse.
let _scratchMask=null,_scratchTmp=null;
function _ensureScratchCanvases(){
  if(!_scratchMask||_scratchMask.width!==CW||_scratchMask.height!==CH) _scratchMask=mkLayerCanvas();
  if(!_scratchTmp||_scratchTmp.width!==CW||_scratchTmp.height!==CH) _scratchTmp=mkLayerCanvas();
}
function getExactKey(li,fi){return layers[li].frames[fi]||null;}
function getHeldKey(li,fi){for(let f=fi;f>=0;f--)if(layers[li].frames[f])return layers[li].frames[f];return null;}

// ── Group-to-group clip helpers ───────────────────────────────
// If a layer has no clip of its own but belongs to a group that is itself
// clipped to another group, the layer inherits that group's clip for masking
// purposes (so every member of the clipped group gets masked individually,
// the same way a layer-to-group clip already works).
function _effectiveLayerClip(l){
  if(l.stencil!=='none') return {stencil:l.stencil,clipTo:l.clipTo,clipToGroup:l.clipToGroup};
  if(l.groupId){
    // Walk up the full ancestor chain (innermost first) — the nearest ancestor
    // folder with an active clip/stencil wins, same way a direct parent group did before.
    for(const gid of [..._groupChain(l.groupId)].reverse()){
      const g=groups.find(gr=>gr.id===gid);
      if(g&&g.stencil&&g.stencil!=='none'){
        if(g.clipToGroup){
          return {stencil:g.stencil==='outside'?'group-outside':'group-inside',clipTo:null,clipToGroup:g.clipToGroup};
        }
        if(g.clipTo!=null&&layers[g.clipTo]){
          return {stencil:g.stencil==='outside'?'outside':'inside',clipTo:g.clipTo,clipToGroup:null};
        }
      }
    }
  }
  return {stencil:'none',clipTo:null,clipToGroup:null};
}
// True if group `gid` is being used as the mask source for some OTHER group's clip.
function _groupUsedAsGroupMaskSource(gid){
  return groups.some(g2=>g2.id!==gid&&g2.clipToGroup===gid&&g2.stencil&&g2.stencil!=='none');
}

function createBlankKey(){
  if(!layers[curLayer].frames[curFrame]){
    layers[curLayer].frames[curFrame]=mkLayerCanvas();
    ctx.clearRect(0,0,CW,CH);
    renderTimeline();updateStatus();
  }
}
let _deferredKeyVisualRefreshPending=false;
let _deferredKeyVisualRefreshRaf=0;
function _queueDeferredKeyVisualRefresh(){
  if(_deferredKeyVisualRefreshRaf){cancelAnimationFrame(_deferredKeyVisualRefreshRaf);_deferredKeyVisualRefreshRaf=0;}
  _deferredKeyVisualRefreshPending=true;
}
function _scheduleDeferredKeyVisualRefreshAfterPresentation(){
  if(!_deferredKeyVisualRefreshPending||_deferredKeyVisualRefreshRaf)return;
  _deferredKeyVisualRefreshRaf=requestAnimationFrame(()=>{
    _deferredKeyVisualRefreshRaf=0;
    if(!_deferredKeyVisualRefreshPending)return;
    _deferredKeyVisualRefreshPending=false;
    updateOnion();
    renderTimeline();
    updateStatus();
  });
}
window._scheduleDeferredKeyVisualRefreshAfterPresentation=_scheduleDeferredKeyVisualRefreshAfterPresentation;
function ensureKey(options){
  const deferVisualRefresh=!!(options&&options.deferVisualRefresh);
  const profiler=window.BrushLatencyProfiler&&window.BrushLatencyProfiler.enabled?window.BrushLatencyProfiler:null,totalStart=profiler?performance.now():0;
  if(!layers[curLayer].frames[curFrame]){
    let diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
    let started=profiler?performance.now():0;const key=mkLayerCanvas();if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyCanvasAllocation',diagnosticStarted);if(profiler)profiler.measure('key-canvas-allocation',started,{width:CW,height:CH});
    diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;layers[curLayer].frames[curFrame]=key;if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyFrameMapInsertion',diagnosticStarted);if(profiler)profiler.measure('key-frame-map-insertion',started,{layerIndex:curLayer,frameIndex:curFrame});
    diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;ctx.clearRect(0,0,CW,CH);if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyActiveCanvasClear',diagnosticStarted);if(profiler)profiler.measure('key-initialization-clear',started,{width:CW,height:CH,copiedHeldExposure:false});
    diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;recomposite(curLayer,curFrame);if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyRecompose',diagnosticStarted);if(profiler)profiler.measure('key-creation-recomposite',started,{fullCanvas:true});
    if(deferVisualRefresh){
      _queueDeferredKeyVisualRefresh();
    }else{
      diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;updateOnion();if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyUpdateOnion',diagnosticStarted);if(profiler)profiler.measure('key-creation-onion-update',started);
      diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;renderTimeline();if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyRenderTimeline',diagnosticStarted);if(profiler)profiler.measure('key-creation-timeline-refresh',started);
      diagnosticStarted=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;started=profiler?performance.now():0;updateStatus();if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.ensureKeyStage('ensureKeyUpdateStatus',diagnosticStarted);if(profiler)profiler.measure('key-creation-status-update',started);
    }
    if(profiler){const noThumbnailStart=performance.now();profiler.measure('key-thumbnail-work',noThumbnailStart,{performed:false,reason:'timeline has no keyframe thumbnail renderer'});profiler.measure('ensure-key-created-total',totalStart,{created:true});}
    return true;
  }
  if(profiler)profiler.measure('ensure-key-noop-total',totalStart,{created:false});
  return false;
}
function saveActiveToKey(){
  const kf=layers[curLayer].frames[curFrame];if(!kf)return;
  const kctx=kf.getContext('2d');kctx.clearRect(0,0,CW,CH);kctx.drawImage(activeC,0,0);
}

function loadFrame(li,fi){
  if(typeof window.finishActiveDrawingBeforeArtworkChange==='function')window.finishActiveDrawingBeforeArtworkChange(li,fi);
  ctx.clearRect(0,0,CW,CH);
  const k=getHeldKey(li,fi);if(k)ctx.drawImage(k,0,0);
  recomposite(li,fi);updateOnion();updatePlayhead();
  document.getElementById('frame-info').textContent=frameLabel(fi)+' / '+frameLabel(TOTAL-1);
  updateStatus();
  window.dispatchEvent(new CustomEvent('active-artwork-changed',{detail:{layerIndex:li,frameIndex:fi}}));
}
// PERF: recomposite() now accepts an optional `dirtyRect` ({x,y,w,h} in
// canvas pixel space). When provided, the expensive per-layer compositing
// loop below (which is what actually costs time — multiple canvas
// allocations/clears for masked layers, N drawImage calls, etc.) is
// clipped to that region via compCtx.clip(), so a single dab's worth of
// change only re-touches the pixels around it instead of the entire
// document, every single animation frame while a stroke is in progress.
// When dirtyRect is omitted/null (every existing call site: loadFrame,
// switchLayer, tool actions, undo, etc.), behavior is 100% unchanged —
// full-canvas recomposite exactly as before. drawBg() and every layer draw
// call is untouched code-wise; clip() just restricts which pixels those
// same calls are allowed to touch, so compositing, masks, clipping,
// opacity and blend order are all identical to the full-canvas path.
function recomposite(li,fi,dirtyRect){
  const firstDabDiagnosticStart=window.FirstDabLatencyProbe?window.FirstDabLatencyProbe.recomposeStart():0;
  const latencyProfiler=window.BrushLatencyProfiler&&window.BrushLatencyProfiler.enabled?window.BrushLatencyProfiler:null;
  if(latencyProfiler)latencyProfiler.point('recomposite-begins',{dirtyRect:dirtyRect||null});
  if(window.BrushRafExperiment)window.BrushRafExperiment.noteRecompositeBegin();
  const presentationStart=latencyProfiler?latencyProfiler.presentationStart():0;
  const compositeStart=presentationStart?performance.now():0;
  const preparationStart=presentationStart?performance.now():0;
  const clip = (dirtyRect && dirtyRect.w>0 && dirtyRect.h>0) ? dirtyRect : null;
  if(clip){
    compCtx.save();
    compCtx.beginPath();
    compCtx.rect(clip.x,clip.y,clip.w,clip.h);
    compCtx.clip();
  }
  if(presentationStart)latencyProfiler.measure('recomposite-preparation',preparationStart,{clip,layerCount:layers.length,canvas:{width:CW,height:CH},liveStroke:typeof _inStroke!=='undefined'&&_inStroke});
  const clearStart=presentationStart?performance.now():0;
  drawBg();
  if(presentationStart)latencyProfiler.measure('composite-clear-and-background',clearStart,latencyProfiler.canvasDetail(compC,compCtx,{clip}));
  const scratchStart=presentationStart?performance.now():0;
  const scratchAllocated=!_scratchMask||!_scratchTmp||_scratchMask.width!==CW||_scratchMask.height!==CH||_scratchTmp.width!==CW||_scratchTmp.height!==CH;
  _ensureScratchCanvases();
  if(presentationStart)latencyProfiler.measure('composite-scratch-preparation',scratchStart,{allocatedOrResized:scratchAllocated,width:CW,height:CH});
  const curLForMask=layers[li];
  const curIsMaskForCheck=curLForMask&&(layers.some(ol=>ol!==curLForMask&&ol.stencil!=='none'&&ol.clipTo===li)||groups.some(g=>g.clipTo===li&&g.stencil&&g.stencil!=='none'));
  const layersStart=presentationStart?performance.now():0;
  let persistentLayerDraws=0,livePreviewDraws=0,maskPasses=0;
  // Draw layers bottom-to-top (index 0 = bottom, length-1 = top visually)
  // But the panel shows them top=highest index, so we draw 0..length-1
  for(let idx=0;idx<layers.length;idx++){
    const l=layers[idx];
    if(typeof _tfHiddenLayers!=='undefined'&&_tfHiddenLayers.has(idx)) continue;
    const grp=l.groupId?groups.find(g=>g.id===l.groupId):null;
    const layerVisible=l.visible&&_layerGroupChainVisible(l);
    const layerAlpha=(l.opacity??1)*_layerGroupChainOpacity(l);
    const eff=_effectiveLayerClip(l);

    // Determine what to draw: active layer uses activeC, others use stored key
    let srcCanvas;
    if(idx===li){
      if(!layerVisible){activeC.style.opacity='0';continue;}
      const isGrpStencil=(eff.stencil==='group-inside'||eff.stencil==='group-outside')&&eff.clipToGroup;
      const isCurGrpMask=l.groupId&&(layers.some(ol=>ol.clipToGroup===l.groupId&&(ol.stencil==='group-inside'||ol.stencil==='group-outside'))||_groupUsedAsGroupMaskSource(l.groupId));
      activeC.style.opacity='0';
      // Mid-stroke, dabs live on the offscreen stroke-scratch canvas (not
      // activeC) until pointerup commits them — see brush-engine.js. Use
      // the live preview (activeC + in-progress stroke, pre-blended at
      // brushOpacity) so the stroke is visible as it's drawn instead of
      // only appearing once the stroke ends.
      if(typeof _inStroke!=='undefined'&&_inStroke&&typeof _getLiveStrokePreview==='function'){
        const liveStart=presentationStart?performance.now():0;
        srcCanvas=_getLiveStrokePreview();livePreviewDraws++;
        if(presentationStart)latencyProfiler.measure('live-preview-draw',liveStart,{layerIndex:idx,width:srcCanvas.width,height:srcCanvas.height});
      }else{srcCanvas=activeC;persistentLayerDraws++;}
    } else {
      if(!layerVisible) continue;
      srcCanvas=getHeldKey(idx,fi);
      if(!srcCanvas) continue;
      persistentLayerDraws++;
    }

    // Apply stencil clipping if set
    if((eff.stencil==='group-inside'||eff.stencil==='group-outside')&&eff.clipToGroup){
      maskPasses++;
      // Merge all visible layers of the target group into a single mask canvas
      const maskCanvas=_scratchMask;const mc=maskCanvas.getContext('2d');mc.clearRect(0,0,CW,CH);
      layers.forEach((ml,mi)=>{
        if(ml.groupId!==eff.clipToGroup) return;
        const mgrp=groups.find(g=>g.id===ml.groupId);
        if(!ml.visible||!mgrp||!mgrp.visible) return;
        const ms=mi===li?activeC:getHeldKey(mi,fi);
        if(ms){mc.globalAlpha=ml.opacity??1;mc.drawImage(ms,0,0);mc.globalAlpha=1;}
      });
      const tmp=_scratchTmp;const tc=tmp.getContext('2d');tc.clearRect(0,0,CW,CH);
      tc.drawImage(srcCanvas,0,0);
      tc.globalCompositeOperation=eff.stencil==='group-inside'?'destination-in':'destination-out';
      tc.drawImage(maskCanvas,0,0);
      tc.globalCompositeOperation='source-over';
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(tmp,0,0);
      compCtx.globalAlpha=1;
      continue;
    }
    if(eff.stencil!=='none'&&eff.stencil!=='group-inside'&&eff.stencil!=='group-outside'&&eff.clipTo!=null&&layers[eff.clipTo]){
      maskPasses++;
      const maskCanvas=eff.clipTo===li?activeC:getHeldKey(eff.clipTo,fi);
      if(maskCanvas){
        const tmp=_scratchTmp;const tc=tmp.getContext('2d');tc.clearRect(0,0,CW,CH);
        tc.drawImage(srcCanvas,0,0);
        // inside = destination-in keeps only pixels where mask is opaque (alpha>0)
        // outside = destination-out keeps only pixels where mask is transparent
        tc.globalCompositeOperation=eff.stencil==='inside'?'destination-in':'destination-out';
        tc.drawImage(maskCanvas,0,0);
        tc.globalCompositeOperation='source-over';
        compCtx.globalAlpha=layerAlpha;
        compCtx.drawImage(tmp,0,0);
        compCtx.globalAlpha=1;
        continue;
      }
    }

    const curIsGrpMask=idx===li&&l.groupId&&(layers.some(ol=>ol.clipToGroup===l.groupId&&(ol.stencil==='group-inside'||ol.stencil==='group-outside'))||_groupUsedAsGroupMaskSource(l.groupId));
    // Always draw into composite at the correct stack position (including active layer).
    // activeC itself stays hidden (opacity 0) the whole time now — its pixels are only
    // ever shown via this draw into compC, never as a separate DOM-topmost overlay.
    if(idx!==li||curIsMaskForCheck||curIsGrpMask){
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(srcCanvas,0,0);
      compCtx.globalAlpha=1;
    } else {
      // Active layer, not a mask — draw into composite at its proper z-position
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(srcCanvas,0,0);
      compCtx.globalAlpha=1;
    }
  }
  if(presentationStart)latencyProfiler.measure('persistent-layers-masks-and-clipping',layersStart,{persistentLayerDraws,livePreviewDraws,maskPasses,layerCount:layers.length,clip});
  compCtx.globalAlpha=1;
  // activeC's content is already baked into compC at the correct stack position
  // by the loop above, so keep it hidden — showing it again here (it's always the
  // topmost DOM canvas) made mask-source layers render in front of whatever was
  // clipped to them whenever that layer was selected.
  activeC.style.opacity=0;

  const stateRestoreStart=presentationStart?performance.now():0;
  if(clip) compCtx.restore();
  if(presentationStart)latencyProfiler.measure('composite-state-restore',stateRestoreStart,{restoredClip:!!clip});

  // Final blit to the visible canvas is always full-canvas, unchanged from
  // before: it's a single cheap drawImage (plus optional blur filter), and
  // keeping it whole avoids any blur-edge seam at the dirty-rect boundary.
  // compC itself already only had its dirty region touched above, so
  // everything outside that region is simply the unchanged prior frame.
  if(presentationStart)latencyProfiler.measure('layer-composite',compositeStart,{dirty:!!clip,rect:clip});
  const displayUploadStart=presentationStart?performance.now():0;
  if(presentationStart)latencyProfiler.point('display-upload-begins');
  if(presentationStart)latencyProfiler.point('final-composite-copy-ready',{canvas:{width:CW,height:CH}});
  displayCtx.clearRect(0,0,CW,CH);
  displayCtx.imageSmoothingEnabled=true;
  displayCtx.imageSmoothingQuality='high';
  displayCtx.filter = _displayBlurPx>0.05 ? `blur(${_displayBlurPx}px)` : 'none';
  const firstDabDisplayBlitStart=firstDabDiagnosticStart?performance.now():0;
  displayCtx.drawImage(compC,0,0);
  const firstDabDisplayBlitDuration=firstDabDisplayBlitStart?performance.now()-firstDabDisplayBlitStart:0;
  displayCtx.filter='none';
  if(presentationStart)latencyProfiler.point('display-upload-finishes');
  if(presentationStart){latencyProfiler.measure('canvas-display-upload',displayUploadStart,{width:CW,height:CH,blur:typeof _displayBlurPx==='number'?_displayBlurPx:null});latencyProfiler.presentationEnd(presentationStart,{dirty:!!clip});}
  if(firstDabDiagnosticStart&&window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.displayComplete(firstDabDiagnosticStart,firstDabDisplayBlitDuration);
  if(window.CompositionPrewarm)window.CompositionPrewarm.noteComposite();
}

const CompositionPrewarm=(function(){
  let compositionWarm=true,warmupPending=false,warmupRaf=0,warming=false;
  let lastCompositeAt=performance.now(),lastVisibilityResumeAt=0,idleThresholdMs=12000;
  let runCount=0,lastDuration=0,lastReason='',lastError='',lastPath='';
  let experimentPending=null,experimentSerial=0;
  const experimentRecords=[];
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function stageMap(record){const map={};for(const stage of record&&record.stages||[]){const values=map[stage.name]||(map[stage.name]=[]);values.push(stage.duration);}return Object.fromEntries(Object.entries(map).map(([name,values])=>[name,{total:values.reduce((a,b)=>a+b,0),calls:values.length,max:Math.max(...values)}]));}
  function markCold(reason){compositionWarm=false;lastReason=reason||'unknown';}
  function refreshIdleState(){if(performance.now()-lastCompositeAt>=idleThresholdMs)markCold('idle');}
  function noteComposite(){lastCompositeAt=performance.now();compositionWarm=true;}
  function run(reason){
    warmupPending=false;warmupRaf=0;refreshIdleState();
    if(compositionWarm||document.hidden||warming||experimentPending||window.__suspendAutomaticCompositionPrewarm||(window.BrushRafExperiment&&window.BrushRafExperiment.pending)||(typeof drawing!=='undefined'&&drawing)||(typeof _inStroke!=='undefined'&&_inStroke))return false;
    const started=performance.now();warming=true;
    const profiler=window.BrushLatencyProfiler&&window.BrushLatencyProfiler.enabled?window.BrushLatencyProfiler:null;
    if(profiler)profiler.beginPrewarm({reason:reason||lastReason,mode:'automatic-existing',layerIndex:curLayer,frameIndex:curFrame,canvas:{width:CW,height:CH}});
    try{
      const livePath=typeof window._prewarmLiveStrokeComposition==='function'&&window._prewarmLiveStrokeComposition();
      if(!livePath)recomposite(curLayer,curFrame);
      lastPath=livePath?'live-stroke-clipped':'settled-frame';runCount++;lastDuration=performance.now()-started;lastReason=reason||lastReason;lastError='';return true;
    }catch(error){compositionWarm=false;lastError=String(error&&error.message||error);return false;}
    finally{if(profiler)profiler.endPrewarm({path:lastPath||'failed',reason:reason||lastReason,error:lastError||null});warming=false;}
  }
  function schedule(reason){refreshIdleState();if(compositionWarm||warmupPending||document.hidden||experimentPending||window.__suspendAutomaticCompositionPrewarm||(window.BrushRafExperiment&&window.BrushRafExperiment.pending))return false;warmupPending=true;lastReason=reason||lastReason;warmupRaf=requestAnimationFrame(()=>run(lastReason));return true;}
  function beforeStroke(){
    refreshIdleState();if(warmupPending){cancelAnimationFrame(warmupRaf);warmupPending=false;warmupRaf=0;}
    if(experimentPending&&window.BrushLatencyProfiler)window.BrushLatencyProfiler.labelNextStroke('experiment-'+experimentPending.mode);
    return compositionWarm;
  }
  function noteStrokeComplete(){
    if(!experimentPending)return;
    const profiler=window.BrushLatencyProfiler,stroke=profiler&&profiler.latest?profiler.latest():null;
    const visible=stroke&&stroke.points&&stroke.points.find(point=>point.name==='first-display-presented');
    experimentPending.stroke=stroke;
    experimentPending.pointerDownToFirstVisibleDab=visible?visible.fromPointerDown:null;
    experimentPending.totalFirstStrokeLatency=stroke?stroke.totalToPointerUp:null;
    experimentPending.strokeStages=stageMap(stroke);
    experimentPending.completedAt=performance.now();experimentRecords.push(experimentPending);experimentPending=null;
  }
  function cancelScheduled(){if(warmupPending){cancelAnimationFrame(warmupRaf);warmupPending=false;warmupRaf=0;}}
  function armExperiment(mode){
    cancelScheduled();if(experimentPending)throw new Error('Finish the currently armed experiment stroke before starting another mode.');
    const profiler=window.BrushLatencyProfiler;if(profiler)profiler.enable(true);
    markCold('experiment-'+mode);
    const record={id:++experimentSerial,mode,armedAt:performance.now(),coldIdleMs:performance.now()-lastCompositeAt,prewarm:null,stroke:null};
    experimentPending=record;
    if(mode==='none'){record.prewarm={mode,path:'none',requestAnimationFrameWait:0,totalDuration:0,result:{success:true,skipped:true},stages:{}};return Promise.resolve(clone(record));}
    return new Promise(resolve=>{
      const scheduledAt=performance.now();
      requestAnimationFrame(()=>{
        const rafWait=performance.now()-scheduledAt;if(profiler){profiler.beginPrewarm({reason:'controlled-experiment',mode,layerIndex:curLayer,frameIndex:curFrame,canvas:{width:CW,height:CH}});profiler.measure('prewarm-raf-wait',scheduledAt,{mode});}const started=performance.now();let result,path,error='';warming=true;
        try{
          if(mode==='existing'){result={success:!!(window._prewarmLiveStrokeComposition&&window._prewarmLiveStrokeComposition())};path='existing-empty-1x1';}
          else{result=window._prewarmRealDisposableDab?window._prewarmRealDisposableDab():{success:false,error:'Real-dab hook unavailable'};path='real-disposable-dab';}
          if(!result.success)error=result.error||'Prewarm returned false';
        }catch(caught){error=String(caught&&caught.message||caught);result={success:false,error};}
        finally{
          const duration=performance.now()-started;
          if(profiler)profiler.endPrewarm({path,mode,error:error||null,result});
          record.prewarm={mode,path,requestAnimationFrameWait:rafWait,totalDuration:duration,result,stages:profiler&&profiler.prewarmResults?stageMap(profiler.prewarmResults().slice(-1)[0]):{}};
          lastDuration=duration;lastPath=path;lastError=error;runCount++;warming=false;resolve(clone(record));
        }
      });
    });
  }
  function resume(reason){lastVisibilityResumeAt=performance.now();markCold(reason);schedule(reason);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)markCold('hidden');else resume('visible');});
  window.addEventListener('blur',()=>markCold('blur'));window.addEventListener('focus',()=>resume('focus'));window.addEventListener('pageshow',()=>resume('pageshow'));
  canvasArea.addEventListener('pointerenter',event=>{if(!event.buttons)schedule('pointerenter-after-idle');},{passive:true});
  canvasArea.addEventListener('pointermove',event=>{if(!event.buttons)schedule('pointer-hover-after-idle');},{passive:true});
  return{
    noteComposite,beforeStroke,noteStrokeComplete,schedule,markCold,cancelPending(){cancelScheduled();},
    testNone(){return armExperiment('none');},testExisting(){return armExperiment('existing');},testRealDab(){return armExperiment('real-dab');},
    compareModes(){return{instructions:['Wait for the desired cold period.','Call one test method and await it.','Draw exactly one normal stroke.','Repeat for all three modes under the same brush/layer conditions.'],methods:['CompositionPrewarm.testNone()','CompositionPrewarm.testExisting()','CompositionPrewarm.testRealDab()'],results:experimentRecords.map(clone),pending:experimentPending&&clone(experimentPending)};},
    experimentResults(){return experimentRecords.map(clone);},clearExperimentResults(){experimentRecords.length=0;experimentPending=null;return true;},
    get compositionWarm(){refreshIdleState();return compositionWarm;},get warmupPending(){return warmupPending;},get lastCompositeAt(){return lastCompositeAt;},get lastVisibilityResumeAt(){return lastVisibilityResumeAt;},
    get idleThresholdMs(){return idleThresholdMs;},set idleThresholdMs(value){const next=Number(value);if(Number.isFinite(next)&&next>=1000)idleThresholdMs=next;},
    debug(){return{compositionWarm,warmupPending,lastCompositeAt,lastVisibilityResumeAt,idleThresholdMs,runCount,lastDuration,lastReason,lastError,lastPath,experimentPending:experimentPending&&clone(experimentPending)};}
  };
})();
window.CompositionPrewarm=CompositionPrewarm;
// Debug-only first-dab RAF scheduling experiment. No production mode is
// selected unless prepareTrial() is explicitly called from DevTools.
const BrushRafExperiment=(function(){
  const MODES=new Set(['current','immediate','deadline-aware','prewarm-current']);
  let mode='off',pending=null,preparing=false,baseline=null,trialSerial=0,nativeRaf=null,rafInstalled=false,rafExecutions=0;
  const records=[];
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function installRafObserver(){
    if(rafInstalled)return;nativeRaf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=function(callback){return nativeRaf(timestamp=>{rafExecutions++;callback(timestamp);});};rafInstalled=true;
  }
  function uninstallRafObserver(){if(rafInstalled){window.requestAnimationFrame=nativeRaf;rafInstalled=false;nativeRaf=null;}}
  function hashBytes(data){let hash=2166136261,nonEmpty=false;for(let i=0;i<data.length;i++){hash^=data[i];hash=Math.imul(hash,16777619);if((i&3)===3&&data[i])nonEmpty=true;}return{hash:(hash>>>0).toString(16),nonEmpty};}
  function artworkDigest(){return hashBytes(activeC.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH).data);}
  function smartDigest(layer){if(!layer||layer.type!=='smart-raster')return null;if(typeof window.SmartRasterV4DebugDigest==='function'){const v4=window.SmartRasterV4DebugDigest();if(v4)return v4;}const frame=layer.smartStyleFrames&&layer.smartStyleFrames[curFrame],text=JSON.stringify(frame||null),bytes=new TextEncoder().encode(text);return{fallback:true,length:text.length,hash:hashBytes(bytes).hash};}
  function setupSnapshot(){
    const layer=layers[curLayer],key=layer&&layer.frames&&layer.frames[curFrame],artwork=artworkDigest();
    return{layerIndex:curLayer,frameIndex:curFrame,layerType:layer&&layer.type,renderMode:layer&&layer.renderMode||null,keyExists:!!key,nonEmpty:!!key&&artwork.nonEmpty,artworkDigest:artwork.hash,smartDigest:smartDigest(layer),canvas:{width:CW,height:CH},brush:{presetId:window._activeBrushPresetId||null,size:getBrushSize(),hardness:brushHardness,opacity:brushOpacity,flow:brushFlow,spacing:window.brushSpacing,tip:!!window.brushTipCanvas,texture:!!window.brushTextureEnabled,blend:window.brushBlendMode||'normal'},zoom:typeof zoom==='number'?zoom:null};
  }
  function signature(s){return JSON.stringify({layerType:s.layerType,canvas:s.canvas,brush:s.brush,zoom:s.zoom,artworkDigest:s.artworkDigest,smartDigest:s.smartDigest});}
  function point(record,name){return record&&record.points&&record.points.find(item=>item.name===name);}
  function stage(record,name){return record&&record.stages&&record.stages.find(item=>item.name===name);}
  function metric(record,name){const item=point(record,name);return item?item.fromPointerDown:null;}
  function percentile(values,p){if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];}
  function stats(values){values=values.filter(Number.isFinite);if(!values.length)return{n:0,median:null,min:null,max:null,p90:null};return{n:values.length,median:percentile(values,.5),min:Math.min(...values),max:Math.max(...values),p90:percentile(values,.9)};}
  async function prepareTrial(nextMode,coldMs=12000){
    if(!MODES.has(nextMode))throw new Error('Mode must be current, immediate, deadline-aware, or prewarm-current.');
    if(pending||preparing)throw new Error('Finish the pending/preparing trial before starting another.');
    installRafObserver();window.__suspendAutomaticCompositionPrewarm=true;if(window.CompositionPrewarm)window.CompositionPrewarm.cancelPending();window.BrushLatencyProfiler.enable(true);
    const setup=setupSnapshot();if(!setup.keyExists)throw new Error('Controlled trial rejected: the current frame has no exact keyframe.');if(!setup.nonEmpty)throw new Error('Controlled trial rejected: the exact keyframe is empty.');
    if(!baseline)baseline=setup;else if(signature(setup)!==signature(baseline))throw new Error('Controlled trial rejected: artwork, Smart Raster ownership, brush, zoom, canvas, or layer type differs from the series baseline. Undo the prior trial first.');
    coldMs=Math.max(1000,Number(coldMs)||12000);preparing=true;mode=nextMode;const coldStartedAt=performance.now();
    await new Promise(resolve=>setTimeout(resolve,coldMs));
    if(curLayer!==setup.layerIndex||curFrame!==setup.frameIndex){preparing=false;mode='off';throw new Error('Controlled trial rejected: layer or frame changed during the cold wait.');}
    const actualColdMs=performance.now()-window.CompositionPrewarm.lastCompositeAt;if(actualColdMs<coldMs-5){preparing=false;mode='off';throw new Error('Controlled trial rejected: a recomposite occurred during the cold wait.');}
    let prewarm=null;
    if(mode==='prewarm-current'){
      const scheduled=performance.now();prewarm=await new Promise(resolve=>requestAnimationFrame(()=>{const started=performance.now(),success=!!(window._prewarmLiveStrokeComposition&&window._prewarmLiveStrokeComposition());resolve({success,rafWait:started-scheduled,duration:performance.now()-started,path:'existing-empty-1x1'});}));
    }
    preparing=false;pending={id:++trialSerial,mode,preparedAt:performance.now(),coldStartedAt,requestedColdMs:coldMs,actualColdMs,setup,prewarm,events:[],coalescedRequests:0};
    window.BrushLatencyProfiler.labelNextStroke('raf-'+mode);return clone(pending);
  }
  function strokeBegins(detail){if(!pending)return;pending.strokeStartedAt=performance.now();pending.strokeStart=detail;pending.undoBefore=undoStack.length;pending.redoBefore=redoStack.length;}
  function noteKeyCheck(detail){if(pending)pending.keyCheck=detail;}
  function noteRecompositeRequest(detail){if(pending)pending.events.push(Object.assign({type:'request',time:performance.now()},detail));}
  function noteCoalescedRequest(){if(pending)pending.coalescedRequests++;}
  function shouldPresentImmediately(detail){return!!pending&&detail.firstDab&&(mode==='immediate'||mode==='deadline-aware'&&!detail.rafAlreadyPending);}
  function rafState(){return{executions:rafExecutions};}
  function anotherRafRanFirst(state){return state?rafExecutions>state.executions+1:null;}
  function noteRafCallback(detail){if(pending)pending.raf=detail;}
  function noteRecompositeBegin(){if(pending)pending.recompositeBeginAt=performance.now();}
  function strokeEnds(detail){
    if(!pending)return;const stroke=window.BrushLatencyProfiler.latest(),visible=point(stroke,'first-display-presented'),scheduled=point(stroke,'recomposite-raf-scheduled'),callback=point(stroke,'recomposite-raf-callback-begin'),recomp=stage(stroke,'layer-composite'),upload=stage(stroke,'canvas-display-upload');
    const result=Object.assign(pending,{stroke,metrics:{pointerdownToRafScheduling:scheduled?scheduled.fromPointerDown:null,pointerdownToFirstDabGenerated:metric(stroke,'first-dab-generated'),rafSchedulingWait:stage(stroke,'raf-wakeup-wait')?.duration||0,recompositeTime:recomp?.duration||null,displayUploadTime:upload?.duration||null,pointerdownToFirstVisibleDab:visible?visible.fromPointerDown:null,rafCallbackAt:callback?callback.fromPointerDown:null},safety:{autoCreatedKey:!!(pending.keyCheck&&pending.keyCheck.autoCreatedKey),ensureKeyDuration:pending.keyCheck&&pending.keyCheck.duration,undoDelta:undoStack.length-pending.undoBefore,redoBefore:pending.redoBefore,redoAfter:redoStack.length,layerUnchanged:curLayer===pending.setup.layerIndex,frameUnchanged:curFrame===pending.setup.frameIndex,dabCount:detail&&detail.dabCount,spacing:window.brushSpacing,pressurePointerType:stroke&&stroke.detail&&stroke.detail.pointerType,firstDab:stage(stroke,'dab-rasterization')&&stage(stroke,'dab-rasterization').detail,laterRequestsCoalesced:pending.coalescedRequests,finalArtworkDigest:artworkDigest().hash,finalSmartDigest:smartDigest(layers[curLayer])},completedAt:performance.now()});records.push(result);pending=null;mode='off';
  }
  function table(layerType){const rows=records.filter(r=>!layerType||r.setup.layerType===layerType),names=['current','immediate','deadline-aware','prewarm-current'];return names.map(name=>{const group=rows.filter(r=>r.mode===name);return{mode:name,trials:group.length,pointerdownToFirstDabGenerated:stats(group.map(r=>r.metrics.pointerdownToFirstDabGenerated)),rafSchedulingWait:stats(group.map(r=>r.metrics.rafSchedulingWait)),recompositeTime:stats(group.map(r=>r.metrics.recompositeTime)),displayUploadTime:stats(group.map(r=>r.metrics.displayUploadTime)),pointerdownToFirstVisibleDab:stats(group.map(r=>r.metrics.pointerdownToFirstVisibleDab))};});}
  function safetyReport(){return records.map(r=>({id:r.id,mode:r.mode,layerType:r.setup.layerType,safety:r.safety,valid:!r.safety.autoCreatedKey&&r.safety.layerUnchanged&&r.safety.frameUnchanged&&r.safety.undoDelta===1&&r.safety.redoAfter===0}));}
  function clear(){records.length=0;pending=null;preparing=false;baseline=null;mode='off';trialSerial=0;window.__suspendAutomaticCompositionPrewarm=true;if(window.CompositionPrewarm)window.CompositionPrewarm.cancelPending();window.BrushLatencyProfiler.clear();return true;}
  function stop(){pending=null;preparing=false;mode='off';window.__suspendAutomaticCompositionPrewarm=false;uninstallRafObserver();return true;}
  return{prepareTrial,clear,stop,results(){return records.map(clone);},table,safetyReport,get mode(){return mode;},get preparing(){return preparing;},get pending(){return pending&&clone(pending);},noteRecompositeRequest,noteCoalescedRequest,shouldPresentImmediately,rafState,anotherRafRanFirst,noteRafCallback,noteRecompositeBegin,strokeBegins,noteKeyCheck,strokeEnds};
})();
window.BrushRafExperiment=BrushRafExperiment;
// Debug-only production-path experiment; current remains the default.
// Deadline-aware treats any pending recomposition RAF as imminent. It presents
// synchronously only when no RAF is pending; JavaScript cannot safely inspect
// compositor deadlines or interrupt a RAF callback already executing.
const BrushFirstDabExperiment=(function(){
  const MODES=new Set(['current','immediate-first-dab','deadline-aware-first-dab']);let mode='current',active=null,serial=0,rafExecutions=0;const records=[];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const stage=(stroke,name)=>stroke&&stroke.stages&&stroke.stages.find(item=>item.name===name);
  const point=(stroke,name)=>stroke&&stroke.points&&stroke.points.find(item=>item.name===name);
  const stageTotal=(stroke,name)=>stroke&&stroke.stages?stroke.stages.filter(item=>item.name===name).reduce((sum,item)=>sum+(Number(item.duration)||0),0):0;
  function stats(rows,key){const a=rows.map(row=>row.metrics[key]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return{n:0,median:null,min:null,max:null,p90:null};return{n:a.length,median:a[Math.ceil(a.length*.5)-1],min:a[0],max:a[a.length-1],p90:a[Math.ceil(a.length*.9)-1]};}
  function setMode(next){if(!MODES.has(next))throw new Error('Mode must be current, immediate-first-dab, or deadline-aware-first-dab.');mode=next;if(window.BrushLatencyProfiler)window.BrushLatencyProfiler.enable(true);return mode;}
  function strokeBegins(detail){active={id:++serial,mode,startedAt:performance.now(),detail,presentations:[],scheduledDisposition:'none'};}
  function decide({firstDab,rafAlreadyPending}){if(!firstDab||mode==='current')return{immediate:false};if(mode==='immediate-first-dab')return{immediate:true};return{immediate:!rafAlreadyPending};}
  function noteRecompositeRequest(detail){if(active)(active.requests||(active.requests=[])).push(Object.assign({at:performance.now()},detail));}
  function noteCoalescedRequest(){if(active)active.coalescedRequests=(active.coalescedRequests||0)+1;}
  function noteScheduledDisposition(value){if(active)active.scheduledDisposition=value;}
  function notePresentation(detail){if(!active)return;active.presentations.push(Object.assign({at:performance.now()},detail));active.scheduledDisposition=detail.scheduledWork||active.scheduledDisposition;}
  function rafState(){return{executions:rafExecutions};}function anotherRafRanFirst(){return null;}function noteRafCallback(detail){rafExecutions++;if(active)active.raf=detail;}
  function strokeEnds(detail){if(!active)return;const stroke=window.BrushLatencyProfiler&&window.BrushLatencyProfiler.latest(),visible=point(stroke,'first-display-presented'),firstDab=stage(stroke,'first-dab-pipeline-total'),sync=stage(stroke,'synchronous-first-dab-recomposite'),raf=stage(stroke,'raf-wakeup-wait'),scheduled=stage(stroke,'scheduled-recomposite-duration'),upload=stage(stroke,'canvas-display-upload');active.metrics={pointerdownToFirstVisible:visible?visible.fromPointerDown:null,firstDabRasterization:firstDab?firstDab.duration:null,synchronousFirstDabRecomposite:sync?sync.duration:0,rafWait:raf?raf.duration:0,scheduledRecomposite:scheduled?scheduled.duration:0,displayUpload:upload?upload.duration:null,smartEnsureKey:stageTotal(stroke,'smart-raster-ensure-key'),smartStyleResolution:stageTotal(stroke,'smart-raster-active-style-resolution'),smartPreviewState:stageTotal(stroke,'smart-raster-preview-state-resolution'),smartRectClipping:stageTotal(stroke,'smart-raster-preview-rect-clipping'),smartStyleBundleSync:stageTotal(stroke,'smart-raster-style-bundle-synchronization'),smartMaskReadback:stageTotal(stroke,'smart-raster-preview-mask-readback'),smartStyleIndexUpdate:stageTotal(stroke,'smart-raster-style-index-canvas-update'),smartOwnershipResolution:stageTotal(stroke,'smart-raster-preview-ownership-resolution'),smartPreviewUpload:stageTotal(stroke,'smart-raster-preview-canvas-upload'),smartPreviewGeneration:stageTotal(stroke,'smart-raster-preview-generation-total'),smartPreviewCanvasSwap:stageTotal(stroke,'smart-raster-preview-canvas-swap')};active.dabCount=detail&&detail.dabCount;active.duplicatePresentationCount=Math.max(0,active.presentations.length-1);active.dirtyRect=active.presentations[0]&&active.presentations[0].rect||firstDab&&firstDab.detail&&firstDab.detail.dirtyRect||null;records.push(active);active=null;}
  function compare(){const layerTypes=[...new Set(records.map(row=>row.detail&&row.detail.layerType))];return layerTypes.flatMap(layerType=>[...MODES].map(selected=>{const rows=records.filter(row=>row.mode===selected&&row.detail&&row.detail.layerType===layerType);return{layerType,mode:selected,trials:rows.length,pointerdownToFirstVisible:stats(rows,'pointerdownToFirstVisible'),firstDabRasterization:stats(rows,'firstDabRasterization'),synchronousFirstDabRecomposite:stats(rows,'synchronousFirstDabRecomposite'),rafWait:stats(rows,'rafWait'),scheduledRecomposite:stats(rows,'scheduledRecomposite'),displayUpload:stats(rows,'displayUpload'),smartEnsureKey:stats(rows,'smartEnsureKey'),smartStyleResolution:stats(rows,'smartStyleResolution'),smartPreviewState:stats(rows,'smartPreviewState'),smartRectClipping:stats(rows,'smartRectClipping'),smartStyleBundleSync:stats(rows,'smartStyleBundleSync'),smartMaskReadback:stats(rows,'smartMaskReadback'),smartStyleIndexUpdate:stats(rows,'smartStyleIndexUpdate'),smartOwnershipResolution:stats(rows,'smartOwnershipResolution'),smartPreviewUpload:stats(rows,'smartPreviewUpload'),smartPreviewGeneration:stats(rows,'smartPreviewGeneration'),smartPreviewCanvasSwap:stats(rows,'smartPreviewCanvasSwap'),duplicatePresentations:rows.reduce((sum,row)=>sum+row.duplicatePresentationCount,0)};}));}
  function clear(){records.length=0;active=null;serial=0;if(window.BrushLatencyProfiler)window.BrushLatencyProfiler.clear();return true;}
  return{clear,setMode,results(){return records.map(clone);},compare,decide,noteRecompositeRequest,noteCoalescedRequest,noteScheduledDisposition,notePresentation,rafState,anotherRafRanFirst,noteRafCallback,strokeBegins,strokeEnds,get mode(){return mode;}};
})();
window.BrushFirstDabExperiment=BrushFirstDabExperiment;
const KeyframeLatencyExperiment=(function(){
  const KEY_STATES=new Set(['empty','precreated']),PRESENTATIONS=new Set(['current','immediate','deadline-aware']);
  let pending=null,preparing=false,baseline=null,original=null,historyBaseline=null,serial=0;const records=[];
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function config(){return{layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type,canvas:{width:CW,height:CH},brush:{preset:window._activeBrushPresetId||null,size:getBrushSize(),hardness:brushHardness,opacity:brushOpacity,flow:brushFlow,spacing:window.brushSpacing,tipVersion:window.brushTipVersion||0,texture:!!window.brushTextureEnabled,blend:window.brushBlendMode||'normal'},zoom:typeof zoom==='number'?zoom:null};}
  function signature(value){return JSON.stringify(value);}
  function point(stroke,name){return stroke&&stroke.points&&stroke.points.find(item=>item.name===name);}
  function stage(stroke,name){return stroke&&stroke.stages&&stroke.stages.find(item=>item.name===name);}
  function duration(stroke,name){const item=stage(stroke,name);return item?item.duration:0;}
  function fromPointer(stroke,name){const item=point(stroke,name);return item?item.fromPointerDown:null;}
  function percentile(values,p){values=values.filter(Number.isFinite).sort((a,b)=>a-b);return values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]:null;}
  function stats(values){values=values.filter(Number.isFinite);return{n:values.length,median:percentile(values,.5),min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,p90:percentile(values,.9)};}
  async function prepareTrial(keyState,presentation,coldMs=12000){
    if(!KEY_STATES.has(keyState)||!PRESENTATIONS.has(presentation))throw new Error('Use keyState empty/precreated and presentation current/immediate/deadline-aware.');
    if(pending||preparing)throw new Error('Finish the current trial first.');
    const current=config();if(current.layerType!=='bitmap')throw new Error('This six-condition series requires a Normal Raster layer.');if(!baseline){baseline=current;const layer=layers[curLayer],slot=layer.frames&&layer.frames[curFrame],slotCopy=slot?mkLayerCanvas():null,activeCopy=mkLayerCanvas();if(slotCopy)slotCopy.getContext('2d').drawImage(slot,0,0);activeCopy.getContext('2d').drawImage(activeC,0,0);original={layerIndex:curLayer,frameIndex:curFrame,hadKey:!!slot,slot:slotCopy,active:activeCopy};historyBaseline={undo:undoStack.slice(),redo:redoStack.slice()};}else if(signature(current)!==signature(baseline))throw new Error('Layer, frame, brush, zoom, or canvas differs from the baseline.');
    preparing=true;window.__suspendAutomaticCompositionPrewarm=true;if(window.CompositionPrewarm)window.CompositionPrewarm.cancelPending();window.BrushLatencyProfiler.enable(true);
    undoStack.splice(0,undoStack.length,...historyBaseline.undo);redoStack.splice(0,redoStack.length,...historyBaseline.redo);
    const layer=layers[curLayer];ctx.clearRect(0,0,CW,CH);
    if(keyState==='empty')delete layer.frames[curFrame];else{const blank=mkLayerCanvas();blank.getContext('2d').clearRect(0,0,CW,CH);layer.frames[curFrame]=blank;}
    recomposite(curLayer,curFrame);renderTimeline();updateStatus();
    coldMs=Math.max(1000,Number(coldMs)||12000);const coldStartedAt=performance.now();await new Promise(resolve=>setTimeout(resolve,coldMs));
    if(curLayer!==current.layerIndex||curFrame!==current.frameIndex){preparing=false;throw new Error('Layer or frame changed during cold wait.');}
    const actualColdMs=performance.now()-window.CompositionPrewarm.lastCompositeAt;if(actualColdMs<coldMs-5){preparing=false;throw new Error('A recomposite occurred during the cold wait.');}
    const exactKey=!!(layers[curLayer].frames&&layers[curLayer].frames[curFrame]);if(exactKey!==(keyState==='precreated')){preparing=false;throw new Error('Exact keyframe state changed during the cold wait.');}
    pending={id:++serial,keyState,presentation,condition:keyState+'/'+presentation,setup:current,coldMs:actualColdMs,undoBefore:undoStack.length,redoBefore:redoStack.length,events:[],coalesced:0};preparing=false;
    window.BrushLatencyProfiler.labelNextStroke('keyframe-'+keyState+'-'+presentation);return clone(pending);
  }
  function strokeBegins(detail){if(pending){pending.strokeBeginsAt=performance.now();pending.strokeDetail=detail;}}
  function noteKeyCheck(detail){if(pending)pending.keyCheck=detail;}
  function noteRecompositeRequest(detail){if(pending)pending.events.push(Object.assign({time:performance.now()},detail));}
  function noteCoalescedRequest(){if(pending)pending.coalesced++;}
  function shouldPresentImmediately(detail){return!!pending&&detail.firstDab&&(pending.presentation==='immediate'||pending.presentation==='deadline-aware'&&!detail.rafAlreadyPending);}
  function rafState(){return window.BrushRafExperiment?window.BrushRafExperiment.rafState():null;}
  function anotherRafRanFirst(state){return window.BrushRafExperiment?window.BrushRafExperiment.anotherRafRanFirst(state):null;}
  function noteRafCallback(detail){if(pending)pending.raf=detail;}
  function noteRecompositeBegin(){if(pending)pending.recompositeBeginsAt=performance.now();}
  function strokeEnds(detail){
    if(!pending)return;const stroke=window.BrushLatencyProfiler.latest(),visible=point(stroke,'first-display-presented');
    pending.stroke=stroke;pending.metrics={pointerdownToPushUndoComplete:fromPointer(stroke,'push-undo-complete'),pushUndoDuration:duration(stroke,'undo-snapshot-setup'),ensureKeyDuration:pending.keyCheck&&pending.keyCheck.duration,keyCanvasAllocation:duration(stroke,'key-canvas-allocation'),keyInitializationCopy:duration(stroke,'key-frame-map-insertion')+duration(stroke,'key-initialization-clear'),smartRasterInitialization:duration(stroke,'smart-raster-key-initialization'),timelineRefresh:duration(stroke,'key-creation-timeline-refresh'),drawingMarkUpdates:duration(stroke,'drawing-mark-lookup-work'),thumbnailWork:duration(stroke,'key-thumbnail-work'),firstDabGeneration:fromPointer(stroke,'first-dab-generated'),rafSchedulingWait:duration(stroke,'raf-wakeup-wait'),recomposite:duration(stroke,'layer-composite'),displayUpload:duration(stroke,'canvas-display-upload'),pointerdownToFirstVisibleDab:visible?visible.fromPointerDown:null};
    pending.safety={expectedCreation:pending.keyState==='empty',actualCreation:!!(pending.keyCheck&&pending.keyCheck.autoCreatedKey),undoDelta:undoStack.length-pending.undoBefore,redoAfter:redoStack.length,layerStable:curLayer===pending.setup.layerIndex,frameStable:curFrame===pending.setup.frameIndex,dabCount:detail&&detail.dabCount,spacing:window.brushSpacing,pointerType:stroke&&stroke.detail&&stroke.detail.pointerType,laterRequestsCoalesced:pending.coalesced};pending.completedAt=performance.now();records.push(pending);pending=null;
  }
  function table(){const rows=[];for(const keyState of KEY_STATES)for(const presentation of PRESENTATIONS){const group=records.filter(item=>item.keyState===keyState&&item.presentation===presentation),row={condition:keyState+'/'+presentation,trials:group.length};for(const name of ['pointerdownToPushUndoComplete','pushUndoDuration','ensureKeyDuration','keyCanvasAllocation','keyInitializationCopy','smartRasterInitialization','timelineRefresh','drawingMarkUpdates','thumbnailWork','firstDabGeneration','rafSchedulingWait','recomposite','displayUpload','pointerdownToFirstVisibleDab'])row[name]=stats(group.map(item=>item.metrics[name]));rows.push(row);}return rows;}
  function clear(){if(original)stop();pending=null;preparing=false;baseline=null;original=null;historyBaseline=null;serial=0;records.length=0;window.__suspendAutomaticCompositionPrewarm=true;if(window.CompositionPrewarm)window.CompositionPrewarm.cancelPending();window.BrushLatencyProfiler.clear();return true;}
  function stop(){pending=null;preparing=false;if(original){const layer=layers[original.layerIndex];if(layer&&layer.frames){if(original.hadKey)layer.frames[original.frameIndex]=original.slot;else delete layer.frames[original.frameIndex];}if(curLayer===original.layerIndex&&curFrame===original.frameIndex){ctx.clearRect(0,0,CW,CH);ctx.drawImage(original.active,0,0);recomposite(curLayer,curFrame);renderTimeline();updateStatus();}}if(historyBaseline){undoStack.splice(0,undoStack.length,...historyBaseline.undo);redoStack.splice(0,redoStack.length,...historyBaseline.redo);}window.__suspendAutomaticCompositionPrewarm=false;return true;}
  return{prepareTrial,clear,stop,results(){return records.map(clone);},table,get active(){return!!pending;},get pending(){return pending&&clone(pending);},get preparing(){return preparing;},strokeBegins,noteKeyCheck,noteRecompositeRequest,noteCoalescedRequest,shouldPresentImmediately,rafState,anotherRafRanFirst,noteRafCallback,noteRecompositeBegin,strokeEnds};
})();
window.KeyframeLatencyExperiment=KeyframeLatencyExperiment;
function goToFrame(f,addSel,noSel,selectionOnly){
  saveActiveToKey();curFrame=Math.max(0,Math.min(TOTAL-1,f));
  if(!noSel){if(!addSel) selectedFrames.clear();selectedFrames.add(curFrame);}
  loadFrame(curLayer,curFrame);
  if(selectionOnly&&typeof refreshTimelineSelection==='function')refreshTimelineSelection();
  else renderTimeline();
}
function switchLayer(li,options){
  options=options||{};
  saveActiveToKey();curLayer=li;activeGroupId=null;selectedGroupIds.clear();layerShiftAnchor=li;groupShiftAnchor=null;
  if(!options.preserveTimelineSelection&&typeof syncTimelineSelectionToActiveLayer==='function')syncTimelineSelectionToActiveLayer();
  if(!options.skipLoadFrame)loadFrame(curLayer,curFrame);
  syncOpacityControls();renderLayerPanel();
  if(options.skipTimelineRender&&typeof refreshTimelineSelection==='function')refreshTimelineSelection();
  else renderTimeline();
  if(window.PaletteDocker&&typeof window.PaletteDocker.refresh==='function') window.PaletteDocker.refresh();
  window.dispatchEvent(new CustomEvent('active-layer-changed',{detail:{layerIndex:curLayer,layer:layers[curLayer]}}));
}

// ════════════════════════════════════════════════════════════════
// GENERIC FLOATING / DOCKABLE PANEL MANAGER
// Powers the Tools, Color, Brush Presets, and Layers panels: free
// float anywhere over the canvas, snap-dock to any of the 4 canvas
// edges, and drag-to-merge into tabbed groups (Photoshop/Clip Studio
// style).
//
// ── ARCHITECTURE ────────────────────────────────────────────────
// Previously, "docked or floating", "which side", "stacking order",
// and "size" were all inferred on demand from a mix of CSS classes,
// inline styles, DOM order, and a `_mergedInto` pointer stashed on
// each element. Several independent call sites (this file, and two
// more resize implementations in ui-controls.js) each read *and*
// wrote that scattered state, which is what caused drop layouts to
// come out wrong, panels to overlap/collapse, resizing to fight
// itself, and floating/docked state to desync.
//
// This version keeps ONE authoritative model — a small layout tree —
// and everything else (CSS classes, inline styles, resize handles)
// is a deterministic *projection* of it, recomputed by render().
// Nothing outside this module is allowed to mutate panel dock state
// directly any more; ui-controls.js's per-panel resize handles now
// call FloatPanels.resizePanel()/resizeFloating() instead of poking
// styles and calling a reflow function by hand.
//
//   dockOrder[side] : string[]        — ordered keys docked to that edge
//   dockSize[key]   : number          — px size along that edge's cross-axis
//   floatRect[key]  : {x,y,w,h}       — px rect while floating
//   panelMode[key]  : 'docked' | 'floating' | 'merged'
//   mergedHost[key] : key of the shell hosting this panel's tab (if merged)
//   hiddenState[key]: bool            — explicitly closed (Window menu / ✕)
//
// A panel's *rendered* classes/styles are always fully rebuilt from
// this state in render(); nothing reads live layout back out of the
// DOM to decide what to do next (the old code's `panel.offsetWidth`,
// `classList.contains(...)`, and getBoundingClientRect() reads during
// drag *math* still happen — that's just measuring the mouse against
// other panels' current geometry — but the panel's OWN state is never
// derived from its own rendered DOM after the fact).
// ════════════════════════════════════════════════════════════════
const FloatPanels=(function(){
  const EDGE_DOCK_ENTER_THRESHOLD=5; // pointer distance for every edge-dock target
  const EDGE_DOCK_EXIT_THRESHOLD=7;  // minimal hysteresis for the active target
  const STACK_DOCK_ENTER_THRESHOLD=5; // pointer distance for vertical stack boundaries
  const STACK_DOCK_EXIT_THRESHOLD=7;  // minimal hysteresis for the active stack boundary
  const dz={left:document.getElementById('fp-dz-left'),right:document.getElementById('fp-dz-right'),
            top:document.getElementById('fp-dz-top'),bottom:document.getElementById('fp-dz-bottom')};
  const mergeZoneEl=document.getElementById('fp-mergezone');
  const allPanels=[]; // every top-level .float-panel element (one per registered panel)
  const titles={};    // panelKey -> display title, for rebuilding tabs

  // ── Authoritative state (single source of truth) ────────────────
  const dockOrder={left:[],right:[],top:[],bottom:[]};
  const dockSize={};
  const floatRect={};
  const panelMode={};
  const mergedHost={};
  const hiddenState={};
  let reopenCascade=0;

  // ── Vertical sub-split state ─────────────────────────────────────
  // splitChildren[hostKey] = [childKey, ...] — panels stacked vertically
  //   INSIDE the host's rendered column (left/right dock only for now).
  //   The host takes the top portion, children fill remaining height top→down.
  // splitSize[childKey] = px — height of this child in the split stack.
  //   When null/missing the child gets 50% of remaining space after the host.
  // splitHost[childKey] = hostKey — reverse lookup.
  const splitChildren={};  // hostKey → [childKey,…]
  const splitSize={};      // childKey → px height
  const splitHost={};      // childKey → hostKey

  // Per-panel behavior config. `fixedSize`: docked size never changes
  // (Tools panel is a fixed 40px rail on left/right). `minSize`/`maxSize`:
  // clamp for docked cross-axis resize. `floatResizable`: whether the 4
  // floating edge-handles are attached at all (only Tools + Layers had
  // free-floating resize before; preserved as-is, not expanded).
  // ── HOW TO ADD A NEW DOCKER ─────────────────────────────────────
  // 1. HTML  (index.html): Add a <div class="float-panel" data-panel="YOUR-KEY"> block
  //    following the same structure as the other panels (fp-tabbar, fp-titlebar,
  //    fp-body-wrap > fp-body[data-body="YOUR-KEY"]).  The panel is auto-registered
  //    by the querySelectorAll('.float-panel') loop in init() — no other wiring needed.
  // 2. Config (here, PANEL_CFG): Add an entry keyed to YOUR-KEY with at minimum
  //    minSize and maxSize (px width when docked left/right). Set floatResizable:true
  //    to get the 4-edge floating resize handles.  Add a `get minHeight()` if the panel
  //    has a responsive compact mode that locks its own min-height (see keyframe-switcher).
  // 3. Default layout (DEFAULT_LAYOUT below): Optionally add YOUR-KEY so resetLayout()
  //    restores a sensible default position (dock side + size, or float x/y/w/h).
  // 4. Window menu (index.html #dd-show-YOUR-KEY + #chk-YOUR-KEY): Add a menu item
  //    so the user can show/hide the panel via the Window menu.
  // 5. Script: Load your panel's JS at the bottom of index.html (after panels.js).
  // ───────────────────────────────────────────────────────────────
  const PANEL_CFG={
    tools:        {minSize:38,  maxSize:400, floatResizable:true,  contentFitHeight:true},
    'brush-presets':{minSize:150,maxSize:500, floatResizable:true},
    palette:      {minSize:160, maxSize:500, floatResizable:true},
    layers:       {minSize:120, maxSize:500, floatResizable:true},
    color:        {minSize:120, maxSize:500, floatResizable:false},
    'keyframe-switcher':{minSize:106,maxSize:500,floatResizable:true,get minHeight(){const p=document.getElementById('keyframe-switcher-panel');return p&&parseFloat(p.style.minHeight)||120;}},
    'keyframe-exposure':{minSize:106,maxSize:500,floatResizable:true,get minHeight(){const p=document.getElementById('keyframe-exposure-panel');return p&&parseFloat(p.style.minHeight)||160;}},
    'drawing-marks':{get minSize(){return 40;},maxSize:500,floatResizable:true,get minHeight(){const p=document.getElementById('drawing-marks-panel');if(!p)return 40;const tb=p.querySelector('.fp-titlebar');const body=p.querySelector('.fp-body');const tbH=tb?tb.offsetHeight:0;const cs=body?getComputedStyle(body):null;const pt=cs?(parseFloat(cs.paddingTop)||0):0;const pb=cs?(parseFloat(cs.paddingBottom)||0):0;const kids=body?Array.from(body.children).filter(c=>getComputedStyle(c).display!=='none'):[];const kH=kids.reduce((s,c)=>s+c.offsetHeight,0);return tbH+pt+kH+pb;}},
  };
  function cfgOf(key){ return PANEL_CFG[key]||{minSize:120,maxSize:500}; }

  function panelByKey(key){ return allPanels.find(p=>p.dataset.panel===key)||null; }
  function registerTitle(panelEl){titles[panelEl.dataset.panel]=panelEl.querySelector('.fp-name').textContent;}

  // ── Split state helpers ──────────────────────────────────────────
  function _removeSplitChild(childKey){
    const host=splitHost[childKey];
    if(host&&splitChildren[host]){
      const idx=splitChildren[host].indexOf(childKey);
      if(idx!==-1) splitChildren[host].splice(idx,1);
      if(splitChildren[host].length===0) delete splitChildren[host];
    }
    delete splitHost[childKey];
    delete splitSize[childKey];
  }
  function _addSplitChild(hostKey,childKey,afterChildKey){
    _removeSplitChild(childKey);
    if(!splitChildren[hostKey]) splitChildren[hostKey]=[];
    const arr=splitChildren[hostKey];
    if(afterChildKey){
      const i=arr.indexOf(afterChildKey);
      arr.splice(i>=0?i+1:arr.length,0,childKey);
    } else {
      arr.push(childKey);
    }
    splitHost[childKey]=hostKey;
    if(splitSize[childKey]==null) splitSize[childKey]=180;
  }
  function _isSplitChild(key){ return !!splitHost[key]; }
  function _splitHostOf(key){ return splitHost[key]||null; }
  function _stackHostOf(key){ return splitHost[key]||key; }
  function _dockSideOf(key){
    const hostKey=_stackHostOf(key);
    return ['left','right','top','bottom'].find(s=>dockOrder[s].includes(hostKey))||null;
  }
  function _stackKeys(hostKey){
    return [hostKey,..._splitChildrenOf(hostKey)].filter(k=>!hiddenState[k]);
  }
  function _stackWidthLimits(hostKey){
    const keys=_stackKeys(_stackHostOf(hostKey));
    const configs=(keys.length?keys:[hostKey]).map(cfgOf);
    return {
      min:Math.max(...configs.map(cfg=>Number(cfg.minSize)||0)),
      max:Math.min(...configs.map(cfg=>Number(cfg.maxSize)||500)),
    };
  }
  // Return all visible split children for a host in order
  function _splitChildrenOf(hostKey){
    return (splitChildren[hostKey]||[]).filter(k=>!hiddenState[k]);
  }
  function _stackLayout(hostKey){
    const side=_dockSideOf(hostKey);
    if(side!=='left'&&side!=='right') return null;
    const car=canvasArea.getBoundingClientRect();
    const items=_stackKeys(hostKey).map(key=>{
      const panel=panelByKey(key);
      if(!panel||hiddenState[key]) return null;
      return {key,panel,rect:panel.getBoundingClientRect()};
    }).filter(Boolean);
    if(!items.length) return null;
    const first=items[0].rect;
    return {
      side,
      hostKey,
      items,
      left:first.left,
      right:first.right,
      top:items[0].rect.top,
      bottom:items[items.length-1].rect.bottom,
      columnTop:car.top,
      columnBottom:car.bottom
    };
  }
  function _stackInsertPoint(hostKey,clientY,activeDrop){
    const layout=_stackLayout(hostKey);
    if(!layout) return null;
    let best=null;
    for(let i=0;i<=layout.items.length;i++){
      const lineY=i<layout.items.length?layout.items[i].rect.top:layout.items[layout.items.length-1].rect.bottom;
      const threshold=activeDrop&&activeDrop.hostKey===hostKey&&activeDrop.atIndex===i
        ?STACK_DOCK_EXIT_THRESHOLD:STACK_DOCK_ENTER_THRESHOLD;
      const distance=Math.abs(clientY-lineY);
      if(distance<=threshold&&(!best||distance<best.distance)){
        best={hostKey,side:layout.side,atIndex:i,lineY,left:layout.left,width:layout.right-layout.left,distance};
      }
    }
    return best;
  }
  // Stack zone: insertion line for vertical stack drops inside a dock column.
  const stackZoneEl=(function(){
    const el=document.createElement('div');
    el.className='fp-stackzone';
    el.style.display='none';
    document.body.appendChild(el);
    return el;
  })();
  function showStackZone(left,lineY,width){
    stackZoneEl.style.cssText=`position:fixed;left:${left}px;top:${lineY-2}px;width:${width}px;height:4px;display:block;pointer-events:none;z-index:10000;background:var(--accent);border-radius:3px;`;
  }
  function hideStackZone(){ stackZoneEl.style.display='none'; }

  function hideZones(){Object.values(dz).forEach(z=>z.classList.remove('show'));mergeZoneEl.classList.remove('show');hideStackZone();}
  function showEdgeZone(side,edgeOffset){
    hideZones();
    if(!side) return;
    const z=dz[side];
    const car=canvasArea.getBoundingClientRect();
    const off=edgeOffset||0;
    // Use fixed positioning so the line renders at the real screen seam
    // between panels, not relative to canvasArea's interior.
    // Center the 4px bar on the seam by subtracting 2px.
    if(side==='left'){
      const x=car.left+off-2;
      z.style.cssText=`position:fixed;left:${x}px;top:${car.top}px;height:${car.height}px;width:4px;`;
    } else if(side==='right'){
      const x=car.right-off-2;
      z.style.cssText=`position:fixed;left:${x}px;top:${car.top}px;height:${car.height}px;width:4px;`;
    } else if(side==='top'){
      const y=car.top+off-2;
      z.style.cssText=`position:fixed;top:${y}px;left:${car.left}px;width:${car.width}px;height:4px;`;
    } else if(side==='bottom'){
      const y=car.bottom-off-2;
      z.style.cssText=`position:fixed;top:${y}px;left:${car.left}px;width:${car.width}px;height:4px;`;
    }
    z.classList.add('show');
  }
  function showMergeZone(targetPanel){
    hideZones();
    const car=canvasArea.getBoundingClientRect();
    const r=targetPanel.getBoundingClientRect();
    mergeZoneEl.style.cssText=`left:${r.left-car.left}px;top:${r.top-car.top}px;width:${r.width}px;height:${r.height}px;`;
    mergeZoneEl.classList.add('show');
  }

  // ── State-mutation primitives (the ONLY functions allowed to change
  // dockOrder / floatRect / panelMode) ────────────────────────────
  function _removeFromAllDockOrders(key){
    // Capture where key was docked BEFORE we remove it, so if it was a
    // stack host we can hand its slot to the next-in-line child instead of
    // just orphaning everyone to floating.
    let hostSide=null,hostIndex=-1;
    ['left','right','top','bottom'].forEach(s=>{
      const i=dockOrder[s].indexOf(key);
      if(i!==-1){hostSide=s;hostIndex=i;dockOrder[s].splice(i,1);}
    });
    // Also remove from vertical split state
    _removeSplitChild(key);
    // If key was a split host, promote its first remaining child to take
    // over its dock slot (same side/index/dockSize) so the stack keeps
    // occupying the docker instead of collapsing to floating — the
    // remaining children re-parent under the promoted one.
    if(splitChildren[key]){
      const orphans=[...splitChildren[key]];
      delete splitChildren[key];
      const promoted=orphans.shift();
      if(promoted&&hostSide){
        delete splitHost[promoted];
        panelMode[promoted]='docked';
        dockOrder[hostSide].splice(hostIndex,0,promoted);
        dockSize[promoted]=dockSize[key];
        orphans.forEach(ck=>_addSplitChild(promoted,ck));
      } else {
        // No dock slot to hand off (key wasn't actually docked anywhere,
        // e.g. it was already floating) — fall back to floating them.
        orphans.forEach(ck=>{
          delete splitHost[ck];
          if(panelMode[ck]==='docked'){
            panelMode[ck]='floating';
            _removeFromAllDockOrders(ck);
          }
        });
      }
    }
  }
  function dockPanel(key,side,atIndex){
    _removeFromAllDockOrders(key);
    delete mergedHost[key];
    panelMode[key]='docked';
    if(atIndex==null||atIndex<0||atIndex>dockOrder[side].length) dockOrder[side].push(key);
    else dockOrder[side].splice(atIndex,0,key);
    if(dockSize[key]==null){
      const cfg=cfgOf(key);
      dockSize[key]=(key==='tools')?40:Math.min(cfg.maxSize,Math.max(cfg.minSize,220));
    }
  }
  function undockToFloat(key,x,y,w,h){
    _removeFromAllDockOrders(key);
    delete mergedHost[key];
    panelMode[key]='floating';
    floatRect[key]=Object.assign(floatRect[key]||{},{x,y});
    if(w!=null) floatRect[key].w=w;
    // Tools panel auto-fits height to its own content when it becomes a
    // free-floating window (matches its old fitHeightToContent behavior),
    // unless the caller explicitly passed a height (a user-driven floating
    // resize should stick, not get silently overridden back to fit-content).
    if(h!=null) floatRect[key].h=h;
    else if(key==='tools') floatRect[key].h=_toolsMinHeight();
  }
  function markMerged(key,hostKey){
    _removeFromAllDockOrders(key);
    panelMode[key]='merged';
    mergedHost[key]=hostKey;
  }
  function clearMerged(key){
    delete mergedHost[key];
    // Caller is responsible for immediately calling undockToFloat/dockPanel
    // afterward — merged panels always resolve into exactly one of those.
  }

  // ── Render: rebuild every panel's classes/styles from state ─────
  function render(){
    ['left','right','top','bottom'].forEach(renderSide);
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const mode=panelMode[key];
      if(mode==='floating'){
        panel.classList.remove('dock-left','dock-right','dock-top','dock-bottom','docked');
        const r=floatRect[key]||{x:16,y:16};
        panel.style.left=r.x+'px'; panel.style.top=r.y+'px';
        panel.style.right=''; panel.style.bottom='';
        panel.style.width=r.w!=null?r.w+'px':(panel._savedWidth||panel.style.width||'');
        panel.style.height=r.h!=null?r.h+'px':(panel.style.height||'');
      }
      // Split children are positioned by renderSide; hide their split handle if not split
      if((!_isSplitChild(key)||hiddenState[key])&&panel._splitResizeEl){
        panel._splitResizeEl.style.display='none';
      }
      const visuallyHidden=!!hiddenState[key]||mode==='merged';
      panel.classList.toggle('fp-hidden',visuallyHidden);
      _syncDockResizeHandle(panel);
    });
    if(typeof centerCanvas==='function') centerCanvas();
  }

  function renderSide(side){
    let offset=0;
    dockOrder[side].forEach(key=>{
      const panel=panelByKey(key);
      if(!panel||hiddenState[key]) return;
      panel.classList.remove('dock-left','dock-right','dock-top','dock-bottom');
      panel.classList.add('dock-'+side,'docked');
      panel.style.left='';panel.style.right='';panel.style.top='';panel.style.bottom='';
      let size=dockSize[key];
      if(side==='left'||side==='right'){
        const limits=_stackWidthLimits(key);
        size=Math.max(limits.min,Math.min(limits.max,Number.isFinite(+size)?+size:220));
        dockSize[key]=size;
      }
      if(side==='left')  panel.style.left=offset+'px';
      if(side==='right') panel.style.right=offset+'px';
      if(side==='top')   panel.style.top=offset+'px';
      if(side==='bottom')panel.style.bottom=offset+'px';

      // ── Vertical sub-split (left/right columns only) ──────────────
      // If this panel has split children, divide the full column height
      // between host and children with a resize handle between each pair.
      if((side==='left'||side==='right')&&_splitChildrenOf(key).length>0){
        const children=_splitChildrenOf(key);
        // Sum of all child heights
        const totalChildPx=children.reduce((s,ck)=>s+(splitSize[ck]||180),0);
        // Host gets remaining height; children get their splitSize each.
        // We use top/height inline style to set positions within the column.
        panel.style.width=size+'px';
        panel.style.position='absolute';
        // Host height = 100% - totalChildPx (expressed via calc, but calc
        // won't update when the window resizes unless we set it in px. We'll
        // let it be '': full height minus a data-bottom offset handled by CSS.)
        // Simplest: use top:0, height:'calc(100% - Xpx)' for the host.
        panel.style.height=`calc(100% - ${totalChildPx}px)`;
        panel.style.top='0';
        panel.style.bottom='';

        // Position each child below the host
        let childTop=`calc(100% - ${totalChildPx}px)`;
        let cumulativePx=0;
        children.forEach((ck,ci)=>{
          const cp=panelByKey(ck);
          if(!cp||hiddenState[ck]) return;
          cp.classList.remove('dock-left','dock-right','dock-top','dock-bottom');
          cp.classList.add('dock-'+side,'docked');
          cp.style.left='';cp.style.right='';cp.style.top='';cp.style.bottom='';
          cp.style.width=size+'px';
          cp.style.position='absolute';
          const prevChildrenPx=children.slice(0,ci).reduce((s,k)=>s+(splitSize[k]||180),0);
          cp.style.top=`calc(100% - ${totalChildPx - prevChildrenPx}px)`;
          cp.style.height=(splitSize[ck]||180)+'px';
          if(side==='left') cp.style.left=offset+'px';
          if(side==='right') cp.style.right=offset+'px';
          cp.style.bottom='';
          // Attach (or move) the split resize handle between host and this child
          _syncSplitResizeHandle(key,ck,side,offset,size);
          _syncDockResizeHandle(cp);
        });
        offset+=size;
        return; // skip the normal width/height assignment below
      }

      if(side==='left'||side==='right'){
        panel.style.width=size+'px';
        panel.style.height='';
        panel.style.position='';
        panel.style.top='';
      } else {
        panel.style.width='';
        panel.style.height=size+'px';
      }
      offset+=size;
    });
    // Tools panel docked top/bottom sizes itself to its content rather than
    // a user-set px value; recompute that size AFTER the geometric pass
    // above so its neighbors already have correct left/right offsets, then
    // do one corrective re-pass so nothing after it inherits a stale offset.
    if((side==='top'||side==='bottom')&&dockOrder[side].includes('tools')){
      const tp=panelByKey('tools');
      if(tp){
        const tb=tp.querySelector('.fp-titlebar');
        const bd=document.getElementById('tools-panel-body');
        const tbH=tb?tb.offsetHeight:0, bodyH=bd?bd.scrollHeight:0;
        const fitH=tbH+bodyH;
        if(dockSize.tools!==fitH){ dockSize.tools=fitH; renderSide(side); return; }
      }
    }
    // Exterior gutters use viewport coordinates, so reposition every column
    // handle after this side's widths and offsets have settled.
    dockOrder[side].forEach(key=>{
      const panel=panelByKey(key);
      if(panel) _syncDockResizeHandle(panel);
    });
  }

  function applyDock(panel,side,atIndex){
    const key=panel.dataset.panel;
    if(panelMode[key]==='docked'){
      const cur=['left','right','top','bottom'].find(s=>dockOrder[s].includes(key));
      const curIdx=cur?dockOrder[cur].indexOf(key):-1;
      if(cur===side&&(atIndex==null||atIndex===curIdx||atIndex===curIdx+1)) return; // no real change
    }
    dockPanel(key,side,atIndex);
    render();
    _saveLayout();
  }
  function _applyStackInsert(panel,hostKey,atIndex){
    const key=panel.dataset.panel;
    const side=_dockSideOf(hostKey);
    if(side!=='left'&&side!=='right') return;
    const hostIndex=dockOrder[side].indexOf(hostKey);
    if(hostIndex===-1) return;

    const visibleStack=_stackKeys(hostKey).filter(k=>k!==key);
    const insertIndex=Math.max(0,Math.min(atIndex,visibleStack.length));
    visibleStack.splice(insertIndex,0,key);

    const hiddenChildren=(splitChildren[hostKey]||[]).filter(k=>hiddenState[k]&&k!==key);
    const rebuiltStack=[...visibleStack,...hiddenChildren];
    const newHost=rebuiltStack[0];
    const newChildren=rebuiltStack.slice(1);
    const sharedWidth=(dockSize[hostKey]??dockSize[newHost]??cfgOf(newHost).minSize??180);

    _removeFromAllDockOrders(key);

    dockOrder[side]=dockOrder[side].filter(k=>k!==hostKey&&!rebuiltStack.includes(k));
    delete splitChildren[hostKey];
    rebuiltStack.forEach(k=>{ delete splitHost[k]; });

    panelMode[key]='docked';
    panelMode[newHost]='docked';
    dockOrder[side].splice(hostIndex,0,newHost);
    dockSize[newHost]=sharedWidth;
    newChildren.forEach(childKey=>{
      panelMode[childKey]='docked';
      _addSplitChild(newHost,childKey);
      if(!splitSize[childKey]) splitSize[childKey]=180;
    });
    const limits=_stackWidthLimits(newHost);
    dockSize[newHost]=Math.max(limits.min,Math.min(limits.max,sharedWidth));

    render();
    _saveLayout();
  }
  // Stack panel with a specific docked panel (vertical sub-split).
  function applyStackDock(panel,targetPanel,pos){
    const targetKey=targetPanel.dataset.panel;
    const hostKey=_stackHostOf(targetKey);
    const visibleStack=_stackKeys(hostKey).filter(k=>k!==panel.dataset.panel);
    const targetIndex=visibleStack.indexOf(targetKey);
    if(targetIndex===-1) return;
    _applyStackInsert(panel,hostKey,pos==='before'?targetIndex:targetIndex+1);
  }

  function floatAt(panel,x,y){
    const key=panel.dataset.panel;
    undockToFloat(key,x,y);
    render();
    _saveLayout();
  }
  function _centerFloatingPanel(key){
    if(panelMode[key]!=='floating') return;
    const panel=panelByKey(key);
    if(!panel) return;
    const car=canvasArea.getBoundingClientRect();
    const width=(floatRect[key]&&floatRect[key].w) || panel.offsetWidth || 240;
    const height=(floatRect[key]&&floatRect[key].h) || panel.offsetHeight || 180;
    const baseX=Math.round((car.width-width)/2);
    const baseY=Math.round((car.height-height)/2);
    const offsets=[
      {x:0,y:0},
      {x:28,y:20},
      {x:-24,y:32},
      {x:36,y:-18},
      {x:-32,y:-10},
      {x:18,y:42},
    ];
    const offset=offsets[reopenCascade%offsets.length];
    reopenCascade++;
    const maxX=Math.max(8,car.width-width-8);
    const maxY=Math.max(8,car.height-height-8);
    const x=Math.min(maxX,Math.max(8,baseX+offset.x));
    const y=Math.min(maxY,Math.max(8,baseY+offset.y));
    floatRect[key]=Object.assign(floatRect[key]||{},{
      x,y,
      w:(floatRect[key]&&floatRect[key].w)!=null?floatRect[key].w:width,
      h:(floatRect[key]&&floatRect[key].h)!=null?floatRect[key].h:height
    });
  }

  // Let a panel with its own bespoke resize logic (e.g. the Color panel's
  // wheel-fit resize handles) report its current floating size back into
  // floatRect — the single source of truth render() reads from. Without
  // this, any unrelated render() pass (docking/undocking another panel,
  // switching tabs, etc.) would blank the panel's size back to its last
  // known floatRect value (or auto), fighting with whatever the panel's
  // own resize code had just set. Deliberately does NOT call render() or
  // _saveLayout() itself — callers drive their own live-resize/pointerup
  // cadence exactly like bindFloatingResize does.
  function setFloatSize(key,w,h){
    if(panelMode[key]!=='floating') return;
    floatRect[key]=Object.assign(floatRect[key]||{},
      {w:w!=null?w:(floatRect[key]&&floatRect[key].w),h:h!=null?h:(floatRect[key]&&floatRect[key].h)});
  }
  function getFloatSize(key){
    const r=floatRect[key];
    return r?{w:r.w,h:r.h}:null;
  }

  // ── Tab management ────────────────────────────────────────────
  function tabbarOf(panel){return panel.querySelector('.fp-tabbar');}
  function bodyWrapOf(panel){return panel.querySelector('.fp-body-wrap');}
  function nameOf(panel){return panel.querySelector('.fp-name');}

  function refreshTabbarVisibility(panel){
    const tb=tabbarOf(panel);
    const count=tb.children.length;
    tb.style.display=count>1?'flex':'none';
    if(count>1){
      const activeTab=tb.querySelector('.fp-tab.active');
      if(activeTab) nameOf(panel).textContent=titles[activeTab.dataset.key]||activeTab.textContent;
    } else {
      nameOf(panel).textContent=titles[panel.dataset.panel];
    }
  }

  function activateTab(panel,key){
    bodyWrapOf(panel).querySelectorAll('.fp-body').forEach(b=>b.classList.toggle('active',b.dataset.body===key));
    tabbarOf(panel).querySelectorAll('.fp-tab').forEach(t=>t.classList.toggle('active',t.dataset.key===key));
    refreshTabbarVisibility(panel);
  }

  function addTab(hostPanel,key){
    const tb=tabbarOf(hostPanel);
    if(tb.querySelector(`.fp-tab[data-key="${key}"]`)) return;
    const tab=document.createElement('div');
    tab.className='fp-tab';tab.dataset.key=key;tab.textContent=titles[key]||key;
    tab.title='Drag out to undock this tab';
    bindTabDrag(tab,hostPanel);
    tab.addEventListener('click',()=>{if(!tab._justDragged) activateTab(hostPanel,key);});
    tb.appendChild(tab);
  }

  // Merge sourcePanel (an entire shell, possibly itself holding several tabs)
  // into targetPanel: move all of its fp-body nodes + tabs across, hide its
  // shell, and record the merge in state (not just a DOM pointer).
  function mergeInto(sourcePanel,targetPanel){
    if(sourcePanel===targetPanel) return;
    const srcKey=sourcePanel.dataset.panel, targetKey=targetPanel.dataset.panel;
    const srcWrap=bodyWrapOf(sourcePanel);
    const srcTabs=tabbarOf(sourcePanel);
    const bodies=[...srcWrap.querySelectorAll('.fp-body')];
    const keys=bodies.map(b=>b.dataset.body);
    const existingTargetBodies=[...bodyWrapOf(targetPanel).querySelectorAll('.fp-body')];
    if(tabbarOf(targetPanel).children.length===0){
      existingTargetBodies.forEach(b=>addTab(targetPanel,b.dataset.body));
      const activeExisting=existingTargetBodies.find(b=>b.classList.contains('active'))||existingTargetBodies[0];
      if(activeExisting) activateTab(targetPanel,activeExisting.dataset.body);
    }
    bodies.forEach(b=>{b.classList.remove('active');bodyWrapOf(targetPanel).appendChild(b);});
    keys.forEach(k=>addTab(targetPanel,k));
    srcTabs.innerHTML='';
    activateTab(targetPanel,keys[keys.length-1]);
    // Every key that physically moved (including keys that were already
    // tabbed inside sourcePanel before this merge) now reports targetKey
    // as its host — recomputed from what's actually in targetPanel right
    // now, so multi-level merges stay consistent with the DOM.
    [...bodyWrapOf(targetPanel).querySelectorAll('.fp-body')].forEach(b=>{
      if(b.dataset.body===targetKey) return; // the host's own body isn't "merged into" anything
      markMerged(b.dataset.body,targetKey);
    });
    setWindowCheck(srcKey,false,true); // hidden via merge, not via close
    render();
    _saveLayout();
  }

  // Pop a tab (by key) out of its current host into its own floating shell at (x,y)
  function popOutTab(hostPanel,key,x,y){
    const ownShell=panelByKey(key);
    const body=bodyWrapOf(hostPanel).querySelector(`.fp-body[data-body="${key}"]`);
    if(!ownShell||!body) return;
    const tabEl=tabbarOf(hostPanel).querySelector(`.fp-tab[data-key="${key}"]`);
    if(tabEl) tabEl.remove();
    bodyWrapOf(ownShell).appendChild(body);
    body.classList.add('active');
    refreshTabbarVisibility(hostPanel);
    const remaining=[...bodyWrapOf(hostPanel).querySelectorAll('.fp-body')];
    if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(hostPanel,remaining[0].dataset.body);
    clearMerged(key);
    const w=ownShell._savedWidth?parseFloat(ownShell._savedWidth):null;
    undockToFloat(key,x,y,w,null);
    hiddenState[key]=false;
    render();
    bringToFront(ownShell);
    setWindowCheck(key,true);
    _saveLayout();
  }

  let zTop=700;
  function bringToFront(panel){zTop++;panel.style.zIndex=zTop;}

  let windowCheckHook=null;
  function setWindowCheck(key,visible,viaMerge){windowCheckHook&&windowCheckHook(key,visible,viaMerge);}

  // ── Visibility (Window menu / close button) ────────────────────
  function isVisible(key){
    if(hiddenState[key]) return false;
    if(panelMode[key]==='merged') return !hiddenState[mergedHost[key]];
    return true;
  }
  function setVisible(key,visible){
    const shell=panelByKey(key);
    if(!shell) return;
    if(visible){
      const wasHidden=!!hiddenState[key];
      hiddenState[key]=false;
      if(panelMode[key]==='merged'){
        activateTab(panelByKey(mergedHost[key]),key);
        hiddenState[mergedHost[key]]=false;
      } else {
        if(wasHidden&&panelMode[key]==='floating') _centerFloatingPanel(key);
        render();
        bringToFront(shell);
      }
    } else {
      if(panelMode[key]==='merged'){
        const hostKey=mergedHost[key];
        const host=panelByKey(hostKey);
        const body=bodyWrapOf(host).querySelector(`.fp-body[data-body="${key}"]`);
        const tabEl=tabbarOf(host).querySelector(`.fp-tab[data-key="${key}"]`);
        if(tabEl) tabEl.remove();
        if(body){bodyWrapOf(shell).appendChild(body);body.classList.add('active');}
        refreshTabbarVisibility(host);
        const remaining=[...bodyWrapOf(host).querySelectorAll('.fp-body')];
        if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(host,remaining[0].dataset.body);
        clearMerged(key);
      }
      hiddenState[key]=true;
    }
    setWindowCheck(key,visible);
    render();
    _saveLayout();
  }

  const DEFAULT_LAYOUT={
    tools:{dock:'left',size:40},
    'brush-presets':{dock:'left',size:220},
    palette:{x:590,y:16,w:220,h:320},
    layers:{dock:'right',size:200},
    color:{x:130,y:16,w:200,h:240},
  };
  const DEFAULT_VISIBILITY={
    tools:true,
    'brush-presets':true,
    palette:false,
    layers:true,
    color:false,
    'keyframe-switcher':false,
    'keyframe-exposure':false,
    'drawing-marks':false,
  };
  function resetLayout(){
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      [...tabbarOf(panel).querySelectorAll('.fp-tab')].forEach(t=>{if(t.dataset.key!==key) popOutTab(panel,t.dataset.key,0,0);});
      if(panelMode[key]==='merged') popOutTab(panelByKey(mergedHost[key]),key,0,0);
    });
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const d=DEFAULT_LAYOUT[key]||{};
      panel._savedWidth=d.size?d.size+'px':(d.w?d.w+'px':null);
      if(d.dock){
        dockSize[key]=d.size;
        dockPanel(key,d.dock);
      } else {
        undockToFloat(key,d.x||16,d.y||16,d.w||null,d.h||null);
      }
      hiddenState[key]=!(DEFAULT_VISIBILITY[key] ?? true);
    });
    render();
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      setWindowCheck(key,isVisible(key));
    });
    _saveLayout();
    if(typeof fitCanvasToView==='function') requestAnimationFrame(()=>requestAnimationFrame(fitCanvasToView));
    else if(typeof centerCanvas==='function') requestAnimationFrame(centerCanvas);
  }

  function dockResizeBlocked(){
    return !!document.querySelector('.modal-overlay.visible, #palette-color-modal');
  }

  // ── Docked-state resize (one exterior gutter per dock column) ──
  // Writes ONLY to dockSize[key] — never reads offsetWidth/Height back
  // to decide the next frame's size, so repeated drags can't drift.
  function bindDockResize(panel,rh){
    let resizing=false,startPx=0,startSize=0,side=null,hostKey=null,activePointerId=null;
    rh.addEventListener('pointerdown',e=>{
      if(dockResizeBlocked()) return;
      e.preventDefault();e.stopPropagation();
      const ownKey=panel.dataset.panel;
      // Split children are not in dockOrder — resolve to the stack host so
      // dragging the child's inner edge resizes the shared column width,
      // same as dragging the host's edge. Without this, split children would
      // never find a side and silently bail on every pointerdown.
      hostKey=_splitHostOf(ownKey)||ownKey;
      side=['left','right','top','bottom'].find(s=>dockOrder[s].includes(hostKey));
      if(!side) return;
      resizing=true;activePointerId=e.pointerId;
      rh.setPointerCapture(e.pointerId);rh.classList.add('dragging');
      startPx=(side==='left'||side==='right')?e.clientX:e.clientY;
      startSize=dockSize[hostKey];
    });
    rh.addEventListener('pointermove',e=>{
      if(!resizing) return;
      const cur=(side==='left'||side==='right')?e.clientX:e.clientY;
      let delta=cur-startPx;
      if(side==='right'||side==='bottom') delta=-delta;
      const limits=_stackWidthLimits(hostKey);
      dockSize[hostKey]=Math.max(limits.min,Math.min(limits.max,startSize+delta));
      renderSide(side);
      if(typeof centerCanvas==='function') centerCanvas();
    });
    function endResize(){
      if(!resizing) return;
      const pointerId=activePointerId;
      resizing=false;activePointerId=null;rh.classList.remove('dragging');
      if(pointerId!=null&&rh.hasPointerCapture&&rh.hasPointerCapture(pointerId)){
        rh.releasePointerCapture(pointerId);
      }
      _saveLayout();
    }
    rh.addEventListener('pointerup',endResize);
    rh.addEventListener('pointercancel',endResize);
    rh.addEventListener('lostpointercapture',endResize);
    // Safety net: if pointer capture gets stolen or released elsewhere
    // (e.g. by another drag's global pointer relay, such as the timeline
    // scrubber) the handle's own pointerup may never fire, leaving
    // `resizing` stuck true forever — the docker separator then stays
    // glued to the mouse. Force-clear on any global pointerup/blur too.
    window.addEventListener('pointerup',()=>{ if(resizing) endResize(); });
    window.addEventListener('blur',()=>{ if(resizing) endResize(); });
  }

  // ── Floating-state resize (4 edge handles, only for panels whose
  // config opts in). Writes ONLY to floatRect[key]. ─────────────────
  function bindFloatingResize(panel){
    const key=panel.dataset.panel;
    const cfg=cfgOf(key);
    if(!cfg.floatResizable) return;
    const EDGE=8;
    const EDGE_CSS={
      right:`right:0;top:0;bottom:0;width:${EDGE}px;`,
      left:`left:0;top:0;bottom:0;width:${EDGE}px;`,
      bottom:`bottom:0;left:0;right:0;height:${EDGE}px;`,
      top:`top:0;left:0;right:0;height:${EDGE}px;`,
    };
    Object.keys(EDGE_CSS).forEach(side=>{
      const el=document.createElement('div');
      el.className='fp-float-resize fp-float-resize-'+side;
      el.style.cssText='position:absolute;'+EDGE_CSS[side]+'z-index:10;touch-action:none;';
      panel.appendChild(el);
      const cursorMap={right:'col-resize',left:'col-resize',bottom:'row-resize',top:'row-resize'};
      let active=false,sx=0,sy=0,startRect=null,startMinH=120,startMinW=0;
      el.addEventListener('pointerdown',e=>{
        if(panelMode[key]!=='floating') return;
        e.preventDefault();e.stopPropagation();
        active=true;el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        // Lock the cursor on <body> so it stays visible even when the pointer
        // drifts outside the narrow resize handle strip during fast drags.
        document.body.style.cursor=cursorMap[side]||'default';
        sx=e.clientX;sy=e.clientY;
        const r=floatRect[key]||{x:panel.offsetLeft,y:panel.offsetTop};
        startRect={x:r.x,y:r.y,w:panel.offsetWidth,h:panel.offsetHeight};
        // Snapshot minH once at drag-start so the floor doesn't chase the
        // panel height during the drag (e.g. drawing-marks reads offsetHeight
        // live, which would rise as you drag taller and prevent shrinking back).
        startMinH=cfg.contentFitHeight?_toolsMinHeight():(cfg.minHeight||120);
        startMinW=cfg.minSize;
      });
      el.addEventListener('pointermove',e=>{
        if(!active) return;
        const dx=e.clientX-sx, dy=e.clientY-sy;
        const r=Object.assign({},floatRect[key]||{},startRect);
        const minH=startMinH;
        if(side==='right'){ r.w=Math.max(startMinW,Math.min(cfg.maxSize,startRect.w+dx)); }
        else if(side==='left'){ r.w=Math.max(startMinW,Math.min(cfg.maxSize,startRect.w-dx)); r.x=startRect.x+(startRect.w-r.w); }
        else if(side==='bottom'){ r.h=Math.max(minH,Math.min(700,startRect.h+dy)); }
        else if(side==='top'){ r.h=Math.max(minH,Math.min(700,startRect.h-dy)); r.y=startRect.y+(startRect.h-r.h); }
        floatRect[key]=r;
        // Live-apply without a full render() pass (cheap, avoids layout
        // thrash of every panel on every pointermove of a drag).
        panel.style.left=r.x+'px'; panel.style.top=r.y+'px';
        if(r.w!=null) panel.style.width=r.w+'px';
        if(r.h!=null) panel.style.height=r.h+'px';
        if(typeof centerCanvas==='function') centerCanvas();
      });
      function end(){ if(!active) return; active=false; el.classList.remove('dragging'); document.body.style.cursor=''; _saveLayout(); }
      el.addEventListener('pointerup',end);
      el.addEventListener('pointercancel',end);
    });
  }
  // Content-driven minimum height for the Tools panel (titlebar + buttons),
  // used as the floating-resize floor so it can never be crushed smaller
  // than its own contents.
  function _toolsMinHeight(){
    const tp=panelByKey('tools');
    if(!tp) return 120;
    const tb=tp.querySelector('.fp-titlebar');
    const bd=document.getElementById('tools-panel-body');
    return (tb?tb.offsetHeight:0)+(bd?bd.scrollHeight:0);
  }

  function _syncDockResizeHandle(panel){
    const rh=panel._dockResizeEl;
    if(!rh) return;
    const key=panel.dataset.panel;
    const hostKey=_stackHostOf(key);
    const side=_dockSideOf(hostKey);
    // A stack owns exactly one column-width gutter. Split children must not
    // create overlapping resize strips beside their individual scrollbars.
    const isSharedHost=key===hostKey&&panelMode[key]==='docked'&&!hiddenState[key]&&!!side;
    if(!isSharedHost){ rh.style.display='none'; return; }

    let left,top,width,height,cursor;
    if(side==='left'||side==='right'){
      const layout=_stackLayout(hostKey);
      const rect=panel.getBoundingClientRect();
      const stackTop=layout?layout.top:rect.top;
      const stackBottom=layout?layout.bottom:rect.bottom;
      top=Math.ceil(stackTop);
      height=Math.max(0,Math.floor(stackBottom)-top);
      width=6;cursor='col-resize';
      // Keep the complete hit area on the workspace side of the boundary.
      if(side==='left') left=Math.ceil(layout?layout.right:rect.right);
      else left=Math.floor(layout?layout.left:rect.left)-width;
    }else{
      const rect=panel.getBoundingClientRect();
      left=rect.left;width=rect.width;height=6;cursor='row-resize';
      top=side==='top'?Math.ceil(rect.bottom):Math.floor(rect.top)-height;
    }
    rh.dataset.dockSide=side;
    rh.style.cssText=`display:block;position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;cursor:${cursor};z-index:699;background:transparent;touch-action:none;`;
  }
  // ── Split resize handles (between a host and each child in a vertical stack) ──
  // Each handle is a fixed-positioned element that sits at the seam between
  // the host panel and a child. It's stored on the child: child._splitResizeEl
  function _syncSplitResizeHandle(hostKey,childKey,side,colOffset,colWidth){
    const childPanel=panelByKey(childKey);
    if(!childPanel) return;
    let rh=childPanel._splitResizeEl;
    if(!rh){
      rh=document.createElement('div');
      rh.className='fp-split-resize';
      const divider=document.createElement('div');
      divider.className='fp-split-divider';
      rh.appendChild(divider);
      document.body.appendChild(rh);
      childPanel._splitResizeEl=rh;
      // Bind once; hostKey is NOT passed — the drag handler resolves it
      // dynamically via splitHost[childKey] so re-stacking under a new host
      // never leaves a stale closure pointing at the wrong dock side.
      _bindSplitResizeDrag(rh,childKey);
    }
    // Position: horizontal bar at the top edge of the child panel
    const car=canvasArea.getBoundingClientRect();
    const children=_splitChildrenOf(hostKey);
    const childIdx=children.indexOf(childKey);
    const prevChildrenPx=children.slice(0,childIdx).reduce((s,k)=>s+(splitSize[k]||180),0);
    const totalChildPx=children.reduce((s,k)=>s+(splitSize[k]||180),0);
    // top of this child in viewport coords
    const seamY=car.top+(car.height - totalChildPx + prevChildrenPx);
    if(side==='left'){
      rh.style.cssText=`position:fixed;left:${car.left+colOffset}px;top:${seamY-4}px;width:${colWidth}px;height:8px;cursor:row-resize;z-index:9999;background:transparent;touch-action:none;`;
    } else {
      rh.style.cssText=`position:fixed;right:${window.innerWidth-(car.right-colOffset)}px;top:${seamY-4}px;width:${colWidth}px;height:8px;cursor:row-resize;z-index:9999;background:transparent;touch-action:none;`;
    }
    rh.style.display='block';
  }

  function _hideSplitResizeHandle(childKey){
    const cp=panelByKey(childKey);
    if(cp&&cp._splitResizeEl) cp._splitResizeEl.style.display='none';
  }

  // hostKey is NOT a parameter — it is resolved at drag time via splitHost[childKey].
  // A stale closure-captured hostKey (from when the handle was first created) would
  // look up the wrong dock side after a panel is re-stacked under a different host,
  // making the seam handle silently do nothing on drag. Dynamic lookup fixes this for
  // all panels, including the keyframe-switcher which gets re-stacked most often.
  function _bindSplitResizeDrag(rh,childKey){
    let active=false,startY=0,startSize=0,activePointerId=null;
    rh.addEventListener('pointerdown',e=>{
      if(dockResizeBlocked()) return;
      e.preventDefault();e.stopPropagation();
      active=true;activePointerId=e.pointerId;
      rh.setPointerCapture(e.pointerId);
      startY=e.clientY;startSize=splitSize[childKey]||180;
    });
    rh.addEventListener('pointermove',e=>{
      if(!active) return;
      const dy=startY-e.clientY; // drag up = more space for child
      splitSize[childKey]=Math.max(60,Math.min(window.innerHeight-100,startSize+dy));
      // Resolve the current host dynamically — never use a cached value.
      const currentHost=splitHost[childKey];
      if(!currentHost) return;
      renderSide(['left','right','top','bottom'].find(s=>dockOrder[s].includes(currentHost))||'left');
      // Reposition this handle live (renderSide already calls _syncSplitResizeHandle)
    });
    function end(){
      if(!active) return;
      const pointerId=activePointerId;
      active=false;activePointerId=null;
      if(pointerId!=null&&rh.hasPointerCapture&&rh.hasPointerCapture(pointerId)){
        rh.releasePointerCapture(pointerId);
      }
      _saveLayout();
    }
    rh.addEventListener('pointerup',end);
    rh.addEventListener('pointercancel',end);
    rh.addEventListener('lostpointercapture',end);
    // Same safety net as bindDockResize: don't let a stolen pointer
    // capture (e.g. from dragging the timeline) leave this split seam
    // permanently glued to the mouse.
    window.addEventListener('pointerup',()=>{ if(active) end(); });
    window.addEventListener('blur',()=>{ if(active) end(); });
  }

  function bindTabDrag(tabEl,hostPanel){
    let dragging=false,moved=false;
    tabEl.addEventListener('pointerdown',e=>{
      e.preventDefault();dragging=true;moved=false;tabEl._justDragged=false;tabEl.setPointerCapture(e.pointerId);
    });
    tabEl.addEventListener('pointermove',e=>{
      if(!dragging) return;
      const tb=tabbarOf(hostPanel);
      const r=tb.getBoundingClientRect();
      if(!moved && (e.clientY<r.top-6||e.clientY>r.bottom+6||e.clientX<r.left-30||e.clientX>r.right+30)) moved=true;
    });
    function endDrag(e){
      if(!dragging) return;
      dragging=false;
      if(moved){
        tabEl._justDragged=true;
        const car=canvasArea.getBoundingClientRect();
        popOutTab(hostPanel,tabEl.dataset.key,e.clientX-car.left-20,e.clientY-car.top-10);
      }
      moved=false;
    }
    tabEl.addEventListener('pointerup',endDrag);
    tabEl.addEventListener('pointercancel',endDrag);
  }

  // ── Drag handling for a panel's titlebar (move/dock/merge) ─────
  function bindTitlebarDrag(panel){
    const bar=panel.querySelector('.fp-titlebar');
    const key=panel.dataset.panel;
    const DRAG_THRESHOLD=4;
    let dragging=false,moved=false,dx=0,dy=0,curDock=null,curMergeTarget=null,curAtIndex=null;
    let curStackDrop=null; // {hostKey, side, atIndex, lineY, left, width}
    let startX=0,startY=0,wasDocked=false,origDockSide=null;
    bar.addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('fp-close')) return;
      e.preventDefault();
      dragging=true;moved=false;bar.setPointerCapture(e.pointerId);
      startX=e.clientX;startY=e.clientY;
      wasDocked=panelMode[key]==='docked';
      origDockSide=wasDocked?_dockSideOf(key):null;
      if(wasDocked) panel._savedWidth=panel.offsetWidth+'px';
      bringToFront(panel);
      const r=panel.getBoundingClientRect();
      dx=e.clientX-r.left;dy=e.clientY-r.top;
    });
    document.addEventListener('pointermove',e=>{
      if(!dragging) return;
      if(!moved){
        if(Math.abs(e.clientX-startX)<DRAG_THRESHOLD&&Math.abs(e.clientY-startY)<DRAG_THRESHOLD) return;
        moved=true;
        if(wasDocked){
          const car0=canvasArea.getBoundingClientRect();
          const r=panel.getBoundingClientRect();
          panel._savedWidth=r.width+'px';
          undockToFloat(key,r.left-car0.left,r.top-car0.top,r.width,null);
          render();
        }
        panel.classList.add('dragging-panel');
      }
      const car=canvasArea.getBoundingClientRect();
      let nx=e.clientX-car.left-dx, ny=e.clientY-car.top-dy;
      panel.style.left=nx+'px';panel.style.top=ny+'px';
      floatRect[key]=Object.assign(floatRect[key]||{},{x:nx,y:ny});

      // ── Stack-target check (top or bottom half of a left/right docked
      // panel) ── Do this FIRST so it can suppress the top/bottom edge-dock
      // line that would otherwise fire when the cursor is near car.top/bottom.
      let _earlyStackDrop=null;
      ['left','right'].forEach(side=>{
        if(_earlyStackDrop) return;
        dockOrder[side].forEach(hostKey=>{
          if(_earlyStackDrop||hiddenState[hostKey]) return;
          const layout=_stackLayout(hostKey);
          if(!layout) return;
          const withinX=e.clientX>=layout.left&&e.clientX<=layout.right;
          const withinY=e.clientY>=layout.columnTop&&e.clientY<=layout.columnBottom;
          if(!withinX||!withinY) return;
          _earlyStackDrop=_stackInsertPoint(hostKey,e.clientY,curStackDrop);
        });
      });

      // Check dock boundaries FIRST. Reaching the true outer edge of an
      // already-occupied side means hovering over the panel sitting
      // there (there's no empty space further out to hover in) — if we
      // checked "am I over some other panel" first, that would always
      // win and a dock line could never appear at an occupied edge. So:
      // a hover close enough to a real dock boundary always means "dock
      // here," and only hovers that AREN'T near any boundary fall
      // through to "am I dropping onto a panel to merge/tab with it."
      let best=null; // {side, atIndex, dist, lineOffset}
      // Skip top/bottom edge-dock scan when we're hovering a panel's top/bottom half
      const _skipSides=_earlyStackDrop?['top','bottom']:[];
      ['left','right','top','bottom'].filter(s=>!_skipSides.includes(s)).forEach(side=>{
        const stack=dockOrder[side].filter(k=>k!==key);
        const axisPos=(side==='left'||side==='right')?e.clientX:e.clientY;
        const within=(side==='left'||side==='right')
          ?(e.clientY>=car.top&&e.clientY<=car.bottom)
          :(e.clientX>=car.left&&e.clientX<=car.right);
        if(!within) return;
        let cum=0;
        for(let i=0;i<=stack.length;i++){
          const lineOffset=cum; // px from this side's canvas wall
          const linePos=(side==='left')?car.left+lineOffset
                      :(side==='right')?car.right-lineOffset
                      :(side==='top')?car.top+lineOffset
                      :car.bottom-lineOffset;
          const dist=Math.abs(axisPos-linePos);
          const threshold=curDock===side&&curAtIndex===i
            ?EDGE_DOCK_EXIT_THRESHOLD:EDGE_DOCK_ENTER_THRESHOLD;
          if(dist<=threshold&&(!best||dist<best.dist)) best={side,atIndex:i,dist,lineOffset};
          if(i<stack.length) cum+=dockSize[stack[i]]||0;
        }
      });

      const preferEdgeDock=!!(best&&(best.side==='left'||best.side==='right'));

      if(preferEdgeDock){
        curDock=best.side;curAtIndex=best.atIndex;curMergeTarget=null;curStackDrop=null;
        hideStackZone();
        showEdgeZone(best.side,best.lineOffset);
      } else if(_earlyStackDrop){
        curStackDrop=_earlyStackDrop;curDock=null;curMergeTarget=null;
        hideZones();
        showStackZone(_earlyStackDrop.left,_earlyStackDrop.lineY,_earlyStackDrop.width);
      } else if(best){
        curDock=best.side;curAtIndex=best.atIndex;curMergeTarget=null;curStackDrop=null;
        hideStackZone();
        showEdgeZone(best.side,best.lineOffset);
      } else {
        curStackDrop=null;
        {
          // Fall through to merge check (only if not hovering a docked panel at all)
          let mergeTarget=null;
          for(const other of allPanels){
            if(other===panel||other.classList.contains('fp-hidden')) continue;
            const ok=other.dataset.panel;
            if(_dockSideOf(ok)) continue; // docked → not merge
            const orc=other.getBoundingClientRect();
            if(e.clientX>=orc.left&&e.clientX<=orc.right&&e.clientY>=orc.top&&e.clientY<=orc.bottom){mergeTarget=other;break;}
          }
          if(mergeTarget){
            curMergeTarget=mergeTarget;curDock=null;curStackDrop=null;
            hideStackZone();
            showMergeZone(mergeTarget);
          } else {
            curMergeTarget=null;curDock=null;curStackDrop=null;
            hideZones();
          }
        }
      }
    });
    function endDrag(){
      if(!dragging) return;
      dragging=false;moved=false;panel.classList.remove('dragging-panel');
      hideZones();
      if(curStackDrop){
        _applyStackInsert(panel,curStackDrop.hostKey,curStackDrop.atIndex);
      } else if(curMergeTarget){
        mergeInto(panel,curMergeTarget);
      } else if(curDock){
        applyDock(panel,curDock,curAtIndex);
      } else {
        // Plain floating move (no dock/merge/stack change): the panel's
        // position was already applied live during pointermove, so just
        // persist it. Calling the full render() here would also trigger
        // its unconditional centerCanvas() call, snapping the canvas back
        // to center just because a floating panel was nudged.
        _saveLayout();
      }
      curDock=null;curMergeTarget=null;curStackDrop=null;origDockSide=null;
    }
    document.addEventListener('pointerup',endDrag);
    document.addEventListener('pointercancel',endDrag);
    // Safety net: if the drag ends any way other than a normal pointerup on
    // the titlebar (pointer capture lost, released outside the window while
    // alt-tabbing, etc.), `dragging` would otherwise stay true forever and
    // the blue dock-zone highlight would stay lit with no way to dismiss it
    // or actually dock into it — exactly the "blue outline won't accept a
    // drop" symptom. Force-clear on any global pointerup/window blur too.
    window.addEventListener('pointerup',()=>{ if(dragging) endDrag(); });
    window.addEventListener('blur',()=>{
      if(!dragging) return;
      dragging=false;moved=false;panel.classList.remove('dragging-panel');
      hideZones();
      curDock=null;curMergeTarget=null;curStackDrop=null;origDockSide=null;
    });
  }

  function init(){
    document.querySelectorAll('.float-panel').forEach(panel=>{
      allPanels.push(panel);
      registerTitle(panel);
      bindTitlebarDrag(panel);
      panel._savedWidth=panel.style.width||null;
      const closeBtn=panel.querySelector('.fp-close');
      if(closeBtn){
        closeBtn.addEventListener('click',e=>{
          e.stopPropagation();
          setVisible(panel.dataset.panel,false);
        });
      }
      const rh=document.createElement('div');
      rh.className='fp-dock-resize';
      rh.style.display='none';
      // Top-level placement prevents the resize gutter from covering panel
      // content or being clipped by a scrolling panel body.
      document.body.appendChild(rh);
      panel._dockResizeEl=rh;
      bindDockResize(panel,rh);
      bindFloatingResize(panel);

      // Seed initial state from whatever markup the page shipped with, so a
      // fresh load (no saved layout yet) behaves exactly like today.
      const key=panel.dataset.panel;
      if(panel.classList.contains('docked')){
        const side=['left','right','top','bottom'].find(s=>panel.classList.contains('dock-'+s));
        const cssSize=(side==='left'||side==='right')?panel.offsetWidth:panel.offsetHeight;
        dockSize[key]=cssSize||(key==='tools'?40:220);
        dockPanel(key,side);
      } else {
        const r=panel.getBoundingClientRect();
        const car=canvasArea.getBoundingClientRect();
        undockToFloat(key,parseFloat(panel.style.left)||(r.left-car.left),parseFloat(panel.style.top)||(r.top-car.top));
      }
      hiddenState[key]=panel.classList.contains('fp-hidden');
    });
    render();
    _restoreLayout();
  }

  // ── Layout persistence ───────────────────────────────────────────
  // Persists the state tree directly (not scraped DOM styles), so a
  // save can never capture a transitional/mid-drag value, and restore
  // is just "set state, then render()" — the same code path used for
  // every other layout change.
  const LAYOUT_KEY='animator_panel_layout_v4';
  function _saveLayout(){
    const state={
      dockOrder,dockSize,floatRect,panelMode,mergedHost,hiddenState,
      splitChildren,splitSize,splitHost,
      savedWidths:Object.fromEntries(allPanels.map(p=>[p.dataset.panel,p._savedWidth||null])),
    };
    try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(state));}catch(e){}
  }
  function _restoreLayout(){
    let state;
    try{state=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');}catch(e){return;}
    if(!state||!state.panelMode) return;
    ['left','right','top','bottom'].forEach(s=>{dockOrder[s]=(state.dockOrder&&state.dockOrder[s])||[]; });
    Object.assign(dockSize,state.dockSize||{});
    Object.assign(floatRect,state.floatRect||{});
    Object.assign(panelMode,state.panelMode||{});
    Object.assign(mergedHost,state.mergedHost||{});
    Object.assign(hiddenState,state.hiddenState||{});
    // Restore split state
    Object.assign(splitChildren,state.splitChildren||{});
    Object.assign(splitSize,state.splitSize||{});
    Object.assign(splitHost,state.splitHost||{});
    // Old layouts may contain a width valid for the stack host but too narrow
    // for one of its children. Clamp before rendering with the live limits.
    ['left','right'].forEach(side=>dockOrder[side].forEach(hostKey=>{
      const limits=_stackWidthLimits(hostKey);
      const width=Number(dockSize[hostKey]);
      dockSize[hostKey]=Math.max(limits.min,Math.min(limits.max,Number.isFinite(width)?width:220));
    }));
    allPanels.forEach(p=>{
      const sw=state.savedWidths&&state.savedWidths[p.dataset.panel];
      if(sw) p._savedWidth=sw;
    });
    // Re-home merged panels' DOM bodies into their host shells (state was
    // restored, but the actual .fp-body elements are still sitting wherever
    // the page markup put them).
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      if(panelMode[key]==='merged'&&mergedHost[key]){
        const host=panelByKey(mergedHost[key]);
        if(!host) { panelMode[key]='floating'; return; }
        const body=bodyWrapOf(panel).querySelector(`.fp-body[data-body="${key}"]`)||bodyWrapOf(panel).firstElementChild;
        if(body){ body.classList.remove('active'); bodyWrapOf(host).appendChild(body); addTab(host,key); }
      }
    });
    // Every panel shell needs exactly one active tab/body. Re-homing above
    // may have left hosts with tabs but no active selection — fix that up
    // deterministically (last tab wins) rather than guessing from the DOM.
    allPanels.forEach(panel=>{
      const wrap=bodyWrapOf(panel);
      const bodies=[...wrap.querySelectorAll('.fp-body')];
      if(bodies.length&&!bodies.some(b=>b.classList.contains('active'))){
        activateTab(panel,bodies[bodies.length-1].dataset.body);
      }
      refreshTabbarVisibility(panel);
    });
    render();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(typeof fitCanvasToView==='function') fitCanvasToView();
      else if(typeof centerCanvas==='function') centerCanvas();
      if(windowCheckHook) windowCheckHook();
    }));
  }

  init();

  return {
    setVisible,isVisible,bringToFront,resetLayout,
    saveLayout:_saveLayout,
    syncDockResizeHandle:_syncDockResizeHandle,
    setFloatSize,getFloatSize,
    setWindowCheckHook(fn){windowCheckHook=fn;},
    // New, explicit API for the (now-deduplicated) resize handles that used
    // to live in ui-controls.js. They no longer touch panel state directly.
    isDocked(key){ return panelMode[key]==='docked'; },
    getDockSide(key){ return _dockSideOf(key); },
    // Whole-stack width resize. When panels are stacked (split) in the same
    // dock column they all share one width — the host's dockSize — so any
    // of their edges can drive it. `key` may be the host OR any of its
    // split children; we resolve to the shared host automatically.
    isSplitChild:_isSplitChild,
    getStackHost(key){ return _stackHostOf(key); },
    getDockWidth(key){ return dockSize[_splitHostOf(key)||key]; },
    setDockWidth(key,widthPx){
      const hostKey=_splitHostOf(key)||key;
      const side=['left','right'].find(s=>dockOrder[s].includes(hostKey));
      if(!side) return;
      const limits=_stackWidthLimits(hostKey);
      dockSize[hostKey]=Math.max(limits.min,Math.min(limits.max,widthPx));
      renderSide(side);
      if(typeof centerCanvas==='function') centerCanvas();
    },
    // Full layout reflow. Needed by anything that changes canvasArea's
    // rect from outside panels.js (e.g. resizing the timeline) — render()
    // is what repositions docked/split panels and their seam handles off
    // canvasArea.getBoundingClientRect(), and nothing else re-runs it.
    // Without calling this, those elements freeze at stale coordinates
    // until a panels.js-owned drag happens to trigger render() again.
    render,
  };
})();
