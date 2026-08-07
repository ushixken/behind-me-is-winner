(function(){
  'use strict';

  var legacySerialize=window.SmartRasterLayer&&window.SmartRasterLayer.serializeLayer;
  var legacyDeserialize=window.SmartRasterLayer&&window.SmartRasterLayer.deserializeLayer;

  function emptyMeta(){return {styleIdToIndex:{},indexToStyleId:{},nextIndex:1};}
  function cloneMeta(meta){
    if(!meta)return null;
    return {styleIdToIndex:Object.assign({},meta.styleIdToIndex||{}),indexToStyleId:Object.assign({},meta.indexToStyleId||{}),nextIndex:Math.max(1,Number(meta.nextIndex)||1)};
  }
  function cloneUnderlays(underlays){
    var copy=Object.create(null);if(!underlays)return copy;
    Object.keys(underlays).forEach(function(offset){copy[offset]=underlays[offset].map(function(entry){return {index:entry.index,rgba:entry.rgba.slice()};});});
    return copy;
  }
  function cloneCanvas(src){
    if(!src)return null;
    var canvas=document.createElement('canvas');canvas.width=src.width;canvas.height=src.height;
    var source=src.getContext('2d',{willReadFrequently:true});
    canvas.getContext('2d').putImageData(source.getImageData(0,0,src.width,src.height),0,0);return canvas;
  }
  function ensureFrame(li,fi){
    if(li==null)li=curLayer;if(fi==null)fi=curFrame;
    var layer=layers[li];if(!layer||layer.type!=='smart-raster')return null;
    if(!layer.smartStyleFrames)layer.smartStyleFrames={};
    var frame=layer.smartStyleFrames[fi];
    if(!frame||frame.width!==CW||frame.height!==CH||!(frame.styleIds instanceof Uint16Array)){
      frame={width:CW,height:CH,styleIds:new Uint16Array(CW*CH),underlays:Object.create(null),meta:frame&&cloneMeta(frame.meta)||emptyMeta()};
      layer.smartStyleFrames[fi]=frame;
    }
    if(!frame.meta)frame.meta=emptyMeta();
    if(!frame.underlays)frame.underlays=Object.create(null);
    return frame;
  }
  function ensureStyleIndex(li,fi,styleId){
    var frame=ensureFrame(li,fi);if(!frame||!styleId)return 0;
    var existing=Number(frame.meta.styleIdToIndex[styleId])||0;
    if(existing)return existing;
    var index=Math.max(1,Number(frame.meta.nextIndex)||1);
    while(frame.meta.indexToStyleId[index])index++;
    if(index>65535)throw new Error('Smart Raster style index limit reached');
    frame.meta.nextIndex=index+1;
    frame.meta.styleIdToIndex[styleId]=index;
    frame.meta.indexToStyleId[index]=styleId;
    return index;
  }
  function getStyleIdAt(li,fi,x,y){
    var layer=layers[li];
    if(!layer||layer.type!=='smart-raster'||!layer.smartStyleFrames)return null;
    var frame=layer.smartStyleFrames[fi];
    if(!frame||!(frame.styleIds instanceof Uint16Array)||!frame.meta)return null;
    var px=Math.floor(Number(x)),py=Math.floor(Number(y));
    if(!Number.isFinite(px)||!Number.isFinite(py)||px<0||py<0||px>=frame.width||py>=frame.height)return null;
    var index=frame.styleIds[py*frame.width+px];
    if(!index)return null;
    var styleId=frame.meta.indexToStyleId&&frame.meta.indexToStyleId[index];
    if(!styleId||String(styleId).indexOf('__deleted__:')===0)return null;
    return styleId;
  }
  function getStyleOwnership(li,fi,styleId){
    var layer=layers[li];
    if(!layer||layer.type!=='smart-raster'||!layer.smartStyleFrames||!styleId)return null;
    var frame=layer.smartStyleFrames[fi];
    if(!frame||!(frame.styleIds instanceof Uint16Array)||!frame.meta)return null;
    var index=Number(frame.meta.styleIdToIndex[styleId])||0;
    return index?{styleIds:frame.styleIds,index:index,width:frame.width,height:frame.height}:null;
  }
  function beginStyleErase(li,fi,styleId){
    var frame=ensureFrame(li,fi),index=frame&&frame.meta&&Number(frame.meta.styleIdToIndex[styleId])||0;
    return index?{frame:frame,index:index,layerIndex:li,frameIndex:fi,styleId:styleId,coverage:new Float32Array(frame.width*frame.height),touched:[],lastDabChanged:[],previewIndexes:new Set(),previewRect:null}:null;
  }
  function blendSnapshot(data,local,top,under,amount){
    var topA=top[3]/255,underA=under[3]/255,outA=topA+(underA-topA)*amount;
    for(var channel=0;channel<3;channel++){
      var premul=(top[channel]/255)*topA+((under[channel]/255)*underA-(top[channel]/255)*topA)*amount;
      data[local+channel]=outA>1e-7?Math.round(Math.max(0,Math.min(1,premul/outA))*255):0;
    }
    data[local+3]=Math.round(Math.max(0,Math.min(1,outA))*255);
  }
  function applyStyleEraseRegion(state,rect,imageData,strokeBase,dabBefore){
    if(!state||!rect||!imageData||!strokeBase)return false;
    var frame=state.frame,data=imageData.data,base=strokeBase.data||strokeBase,before=dabBefore&&(dabBefore.data||dabBefore),width=rect.w,height=rect.h;
    var layer=layers[state.layerIndex],layering=!!(layer&&layer.renderMode==='style-layering'&&before);
    state.lastDabChanged.length=0;
    for(var row=0;row<height;row++)for(var col=0;col<width;col++){
      var offset=(rect.y+row)*frame.width+rect.x+col,local=(row*width+col)*4,source=offset*4;
      // Style Layering erases a contribution plane, not the flattened v3
      // pixel. Measure this dab against the exact pixels captured immediately
      // before it, then restore those pixels until the transient v4 compositor
      // uploads the palette-priority result. This keeps every stage in the
      // same canvas coordinate system and avoids compounding earlier previews.
      if(layering){
        var beforeA=before[local+3]/255,afterA=data[local+3]/255;
        var dab=beforeA>1e-7?Math.max(0,Math.min(1,1-afterA/beforeA)):0;
        var previous=state.coverage[offset],combined=1-(1-previous)*(1-dab);
        if(combined>previous){if(previous===0)state.touched.push(offset);state.coverage[offset]=combined;state.lastDabChanged.push(offset);}
        data[local]=before[local];data[local+1]=before[local+1];data[local+2]=before[local+2];data[local+3]=before[local+3];
        continue;
      }
      if(frame.styleIds[offset]!==state.index){
        data[local]=base[source];data[local+1]=base[source+1];data[local+2]=base[source+2];data[local+3]=base[source+3];continue;
      }
      var stack=frame.underlays[offset],entry=stack&&stack.length?stack[stack.length-1]:null;
      var under=entry?entry.rgba:[0,0,0,0],previous=state.coverage[offset];
      var top=[base[source],base[source+1],base[source+2],base[source+3]],topA=top[3]/255,underA=under[3]/255;
      var expectedA=topA+(underA-topA)*previous,afterA=data[local+3]/255;
      var dab=expectedA>1e-7?Math.max(0,Math.min(1,1-afterA/expectedA)):0;
      var combined=1-(1-previous)*(1-dab);
      if(combined>previous){if(previous===0)state.touched.push(offset);state.coverage[offset]=combined;}
      blendSnapshot(data,local,top,under,combined);
    }
    return true;
  }
  function finishStyleErase(state){
    if(!state)return false;var frame=state.frame,changed=false;
    state.touched.forEach(function(offset){
      if(state.coverage[offset]<0.999)return;
      var stack=frame.underlays[offset],entry=stack&&stack.length?stack.pop():null;
      frame.styleIds[offset]=entry?entry.index:0;
      if(!stack||!stack.length)delete frame.underlays[offset];changed=true;
    });
    if(typeof window.SmartRasterV4ShadowColorErase==='function'){
      try{window.SmartRasterV4ShadowColorErase({layerIndex:state.layerIndex,frameIndex:state.frameIndex,styleId:state.styleId,width:frame.width,height:frame.height,touched:state.touched,coverage:state.coverage});window.__smartRasterV4LastError=null;}
      catch(shadowError){window.__smartRasterV4LastError=shadowError;}
    }
    return changed;
  }  // Revised GPU integration: reads through BrushRenderer.getActiveSurface()
  // instead of hardcoded activeC when this is the active layer/frame's
  // live surface, so style-diffing (applyDiff/commitBrushMask/
  // clearWhereTransparent/getFrameBundle) reflects whichever renderer is
  // actually authoritative — CpuBrushRenderer's getLayerSurface() returns
  // activeC (identical behavior to before, already has a 2D context, so
  // callers' .getContext('2d',...) works unchanged). GpuBrushRenderer's
  // getLayerSurface() returns its own WebGPU-context canvas, which CANNOT
  // also be given a 2D context (a canvas element only ever has one
  // context type) — so every caller here that needs getImageData/
  // putImageData on it would throw. For that case, drawImage the GPU
  // surface onto a private 2D scratch canvas and return that instead —
  // the same drawImage-only technique panels.js's recomposite()/
  // artworkDigest() already use to read GPU's canvas, never
  // getImageData/readPixels straight off the GPU context.
  var _artworkScratch=null;
  function artworkCanvas(li,fi){
    var layer=layers[li];
    if(li===curLayer&&fi===curFrame){
      var surface=(window.BrushRenderer&&typeof BrushRenderer.getActiveSurface==='function')?BrushRenderer.getActiveSurface():activeC;
      if(surface===activeC) return activeC;
      if(!_artworkScratch){_artworkScratch=document.createElement('canvas');}
      if(_artworkScratch.width!==CW||_artworkScratch.height!==CH){_artworkScratch.width=CW;_artworkScratch.height=CH;}
      var sctx=_artworkScratch.getContext('2d',{willReadFrequently:true});
      sctx.clearRect(0,0,CW,CH);sctx.drawImage(surface,0,0);
      return _artworkScratch;
    }
    return layer&&layer.frames&&layer.frames[fi];
  }
  // Revised GPU integration: pushes a CPU-computed pixel write for the
  // active layer/frame into whichever renderer is actually authoritative.
  // Smart-raster recoloring/restoring is index-based and intrinsically
  // requires CPU getImageData/putImageData — this is the one-time
  // CPU->GPU sync step after such a write, not a per-frame readback.
  function _syncActiveSurfaceToGpu(){
    if(window.BrushRenderer&&typeof BrushRenderer.loadActiveSurface==='function'&&BrushRenderer.getActiveRenderer()==='gpu'){
      BrushRenderer.loadActiveSurface(activeC);
    }
  }
  function applyDiff(li,fi,beforeImage,styleId){
    if(!beforeImage||!styleId)return false;
    var frame=ensureFrame(li,fi),index=ensureStyleIndex(li,fi,styleId);
    var canvas=artworkCanvas(li,fi);if(!frame||!index||!canvas)return false;
    var after=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH).data;
    var before=beforeImage.data||beforeImage;var changed=false;
    for(var p=0,o=0;p<frame.styleIds.length;p++,o+=4){
      if(after[o]!==before[o]||after[o+1]!==before[o+1]||after[o+2]!==before[o+2]||after[o+3]!==before[o+3]){
        frame.styleIds[p]=after[o+3]===0?0:index;changed=true;
      }
    }
    return changed;
  }
  function commitBrushMask(li,fi,maskCanvas,styleId,strokeOpacity,dirtyRect,beforeImage,brushBlendMode){
    if(!maskCanvas||!styleId)return false;
    if(layers[li]&&layers[li].renderMode==='style-layering')brushBlendMode='normal';
    var frame=ensureFrame(li,fi),index=ensureStyleIndex(li,fi,styleId);
    if(!frame||!index)return false;
    var opacity=Math.max(0,Math.min(1,Number(strokeOpacity)));
    if(opacity<=0)return true;
    var x=dirtyRect?Math.max(0,Math.floor(dirtyRect.x)):0;
    var y=dirtyRect?Math.max(0,Math.floor(dirtyRect.y)):0;
    var ex=dirtyRect?Math.min(frame.width,Math.ceil(dirtyRect.x+dirtyRect.w)):frame.width;
    var ey=dirtyRect?Math.min(frame.height,Math.ceil(dirtyRect.y+dirtyRect.h)):frame.height;
    var width=ex-x,height=ey-y;if(width<=0||height<=0)return true;
    var mask=maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(x,y,width,height).data;
    var before=beforeImage&&(beforeImage.data||beforeImage);
    var artwork=artworkCanvas(li,fi),after=artwork?artwork.getContext('2d',{willReadFrequently:true}).getImageData(x,y,width,height).data:null;
    var nextIds=frame.styleIds.slice(),changed=false;
    for(var row=0;row<height;row++)for(var col=0;col<width;col++){
      var local=(row*width+col)*4;if(mask[local+3]===0)continue;
      if(before&&after&&before[local]===after[local]&&before[local+1]===after[local+1]&&before[local+2]===after[local+2]&&before[local+3]===after[local+3])continue;
      var offset=(y+row)*frame.width+x+col;
      if(brushBlendMode==='draw-behind'&&nextIds[offset]!==0)continue;
      if(nextIds[offset]!==index){
        var stack=frame.underlays[offset]||(frame.underlays[offset]=[]);
        if(before)stack.push({index:nextIds[offset],rgba:[before[local],before[local+1],before[local+2],before[local+3]]});
        nextIds[offset]=index;changed=true;
      }
    }
    if(changed)frame.styleIds=nextIds;
    if(typeof window.SmartRasterV4ShadowRecorder==='function'){
      try{
        window.SmartRasterV4ShadowRecorder({layerIndex:li,frameIndex:fi,styleId:styleId,blendMode:brushBlendMode||'normal',strokeOpacity:opacity,maskData:mask,beforeData:before,rect:{x:x,y:y,width:width,height:height},frameWidth:frame.width,frameHeight:frame.height});
        window.__smartRasterV4LastError=null;
      }catch(shadowError){window.__smartRasterV4LastError=shadowError;}
    }
    return true;
  }
  function clearWhereTransparent(li,fi,rect){
    var frame=ensureFrame(li,fi),canvas=artworkCanvas(li,fi);if(!frame||!canvas)return;
    var x=rect?Math.max(0,Math.floor(rect.x)):0,y=rect?Math.max(0,Math.floor(rect.y)):0;
    var ex=rect?Math.min(CW,Math.ceil(rect.x+rect.w)):CW,ey=rect?Math.min(CH,Math.ceil(rect.y+rect.h)):CH;
    var width=ex-x,height=ey-y;if(width<=0||height<=0)return;
    var rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(x,y,width,height).data;
    for(var row=0;row<height;row++)for(var col=0;col<width;col++){
      var local=(row*width+col)*4,offset=(y+row)*CW+x+col;
      if(rgba[local+3]===0)frame.styleIds[offset]=0;
    }
  }
  function heldArtworkFrameIndex(layer,fi){
    if(!layer||!layer.frames)return -1;
    for(var frameIndex=fi;frameIndex>=0;frameIndex--)if(layer.frames[frameIndex])return frameIndex;
    return -1;
  }
  function recolorFrame(layer,li,fi,styleId,rgba){
    if(typeof window.SmartRasterV4StyleIsAuthoritative==='function'&&window.SmartRasterV4StyleIsAuthoritative(layer,fi,styleId))return false;
    var frame=layer.smartStyleFrames&&layer.smartStyleFrames[fi];if(!frame)return false;
    var index=Number(frame.meta.styleIdToIndex[styleId])||0;if(!index)return false;
    var frameIndex=Number(fi),activeFrame=li===curLayer?heldArtworkFrameIndex(layer,curFrame):-1,isActive=li===curLayer&&frameIndex===activeFrame;
    var stored=layer.frames&&layer.frames[frameIndex];
    // Revised GPU integration: reads through artworkCanvas() (which
    // resolves to whichever renderer is actually authoritative for the
    // live layer/frame, drawImage-snapshotted to a 2D-readable scratch
    // when GPU is active — see artworkCanvas() above) instead of
    // hardcoded activeC, so recoloring is computed against current
    // pixels rather than a possibly-stale CPU canvas.
    var source=isActive?artworkCanvas(li,fi):stored;if(!source)return false;
    var sourceContext=source.getContext('2d',{willReadFrequently:true});
    var image=sourceContext.getImageData(0,0,frame.width,frame.height),data=image.data;
    var rewritten=0;
    for(var p=0,o=0;p<frame.styleIds.length;p++,o+=4){
      if(frame.styleIds[p]!==index)continue;
      data[o]=rgba[0];data[o+1]=rgba[1];data[o+2]=rgba[2];rewritten++;
    }
    if(!rewritten)return false;
    if(!stored){
      stored=document.createElement('canvas');stored.width=frame.width;stored.height=frame.height;
      if(!layer.frames)layer.frames={};layer.frames[frameIndex]=stored;
    }
    stored.getContext('2d').putImageData(image,0,0);
    // Revised GPU integration: the write-back for the live layer/frame
    // must land on activeC (CPU's actual writable 2D surface — `source`
    // above may be a throwaway scratch snapshot, not the real surface)
    // and then be pushed into GPU's surface too via
    // BrushRenderer.loadActiveSurface() (one-time CPU->GPU upload per
    // recolor), so both stay in sync instead of only `stored` updating.
    if(isActive&&activeC!==stored){
      activeC.getContext('2d').putImageData(image,0,0);
      _syncActiveSurfaceToGpu();
    }
    return true;
  }  function rerenderStyle(styleId){
    var style=window.PaletteDocker&&window.PaletteDocker.findAdvancedStyleById(styleId);if(!style||!Array.isArray(style.rgba))return;
    var activeChanged=false,any=false;
    var activeFrame=heldArtworkFrameIndex(layers[curLayer],curFrame);
    layers.forEach(function(layer,li){if(layer.type!=='smart-raster'||!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){if(recolorFrame(layer,li,fi,styleId,style.rgba)){any=true;if(li===curLayer&&Number(fi)===activeFrame)activeChanged=true;}});});
    if(activeChanged&&typeof saveActiveToKey==='function')saveActiveToKey();
    if(any&&typeof recomposite==='function')recomposite(curLayer,curFrame);
    if(any&&typeof renderTimeline==='function')renderTimeline();
  }
  function rerenderAll(){
    var styles={};
    layers.forEach(function(layer){if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var meta=layer.smartStyleFrames[fi].meta;Object.keys(meta.styleIdToIndex).forEach(function(id){styles[id]=true;});});});
    Object.keys(styles).forEach(rerenderStyle);
  }
  function getFrameBundle(li,fi){
    var layer=layers[li],frame=layer&&layer.smartStyleFrames&&layer.smartStyleFrames[fi];
    return {rgba:cloneCanvas(artworkCanvas(li,fi)),styleIds:frame?frame.styleIds.slice():null,underlays:frame?cloneUnderlays(frame.underlays):null,meta:frame?cloneMeta(frame.meta):null,width:frame?frame.width:CW,height:frame?frame.height:CH,v4:window.SmartRasterV4Document&&typeof window.SmartRasterV4Document.captureFrame==='function'?window.SmartRasterV4Document.captureFrame(layer,fi):null};
  }
  function restoreFrameBundle(li,fi,bundle){
    var layer=layers[li];if(!layer)return;
    if(window.SmartRasterV4Document&&typeof window.SmartRasterV4Document.restoreFrame==='function')window.SmartRasterV4Document.restoreFrame(layer,fi,bundle&&bundle.v4||null);
    if(!layer.smartStyleFrames)layer.smartStyleFrames={};
    var frame=null;
    if(bundle&&bundle.styleIds&&bundle.meta){
      frame={width:bundle.width,height:bundle.height,styleIds:bundle.styleIds.slice(),underlays:cloneUnderlays(bundle.underlays),meta:cloneMeta(bundle.meta)};
      layer.smartStyleFrames[fi]=frame;
    } else delete layer.smartStyleFrames[fi];
    if(!bundle||!bundle.rgba)return;
    var width=bundle.width||CW,height=bundle.height||CH;
    var source=bundle.rgba.getContext('2d',{willReadFrequently:true});
    var image=source.getImageData(0,0,width,height),data=image.data;
    // Undo/redo restores the captured RGBA bytes verbatim. Re-resolving
    // ownership to the style's base RGB here destroys the original edge RGB
    // carried by partially covered antialiased pixels.
    if(!layer.frames)layer.frames={};
    var stored=layer.frames[fi];
    if(!stored){stored=document.createElement('canvas');stored.width=width;stored.height=height;layer.frames[fi]=stored;}
    stored.getContext('2d').putImageData(image,0,0);
    stored.getContext('2d').putImageData(image,0,0);
    if(li===curLayer&&Number(fi)===curFrame){
      // Revised GPU integration: undo/redo restore writes the captured
      // RGBA bytes into activeC (CPU's writable surface) then pushes
      // the result into GPU's surface too, mirroring the same pattern
      // used by recolorFrame() above and tools-color.js's restoreBitmapUndo().
      activeC.getContext('2d').putImageData(image,0,0);
      _syncActiveSurfaceToGpu();
    }
  }
  function resetFrame(li,fi){var layer=layers[li];if(layer&&layer.smartStyleFrames)delete layer.smartStyleFrames[fi];if(layer&&window.SmartRasterV4Document&&typeof window.SmartRasterV4Document.deleteFrame==='function')window.SmartRasterV4Document.deleteFrame(layer,fi);}
  function resizeAllFrames(nw,nh,offsetX,offsetY){
    layers.forEach(function(layer){
      Object.keys(layer.indexFrames||{}).forEach(function(fi){var src=layer.indexFrames[fi];if(!src)return;var nc=document.createElement('canvas');nc.width=nw;nc.height=nh;var dx=Number.isFinite(offsetX)?Math.round(offsetX):Math.round((nw-src.width)/2),dy=Number.isFinite(offsetY)?Math.round(offsetY):Math.round((nh-src.height)/2);var srcCtx=src.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'}),nctx=nc.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});nctx.putImageData(srcCtx.getImageData(0,0,src.width,src.height),dx,dy);layer.indexFrames[fi]=nc;});
      if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var old=layer.smartStyleFrames[fi],ids=new Uint16Array(nw*nh),dx=Number.isFinite(offsetX)?Math.round(offsetX):Math.round((nw-old.width)/2),dy=Number.isFinite(offsetY)?Math.round(offsetY):Math.round((nh-old.height)/2);for(var y=0;y<old.height;y++)for(var x=0;x<old.width;x++){var nx=x+dx,ny=y+dy;if(nx>=0&&nx<nw&&ny>=0&&ny<nh)ids[ny*nw+nx]=old.styleIds[y*old.width+x];}var underlays=Object.create(null);Object.keys(old.underlays||{}).forEach(function(offset){var ox=Number(offset)%old.width,oy=Math.floor(Number(offset)/old.width),nx=ox+dx,ny=oy+dy;if(nx>=0&&nx<nw&&ny>=0&&ny<nh)underlays[ny*nw+nx]=old.underlays[offset];});layer.smartStyleFrames[fi]={width:nw,height:nh,styleIds:ids,underlays:underlays,meta:cloneMeta(old.meta)};});});
    if(window.SmartRasterV4Document&&typeof window.SmartRasterV4Document.resizeAllFrames==='function')window.SmartRasterV4Document.resizeAllFrames(nw,nh,offsetX,offsetY);
  }
  function isStyleUsed(styleId){
    if(!styleId)return false;
    for(var li=0;li<layers.length;li++){
      var layer=layers[li];
      if(!layer||!layer.smartStyleFrames)continue;
      var frameKeys=Object.keys(layer.smartStyleFrames);
      for(var f=0;f<frameKeys.length;f++){
        var frame=layer.smartStyleFrames[frameKeys[f]];
        var index=frame&&frame.meta&&Number(frame.meta.styleIdToIndex[styleId])||0;
        if(index&&frame.styleIds instanceof Uint16Array&&frame.styleIds.includes(index))return true;
      }
    }
    return false;
  }
  function markDeleted(styleId){
    layers.forEach(function(layer){if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var meta=layer.smartStyleFrames[fi].meta,index=meta.styleIdToIndex[styleId];if(index){meta.indexToStyleId[index]='__deleted__:'+styleId;delete meta.styleIdToIndex[styleId];}});});
    if(typeof window.SmartRasterV4ShadowDeleteStyle==='function'){
      try{window.SmartRasterV4ShadowDeleteStyle(styleId);window.__smartRasterV4LastError=null;}
      catch(shadowError){window.__smartRasterV4LastError=shadowError;}
    }
  }
  function encodeStyleIds(styleIds){
    var bytes=new Uint8Array(styleIds.length*2);
    for(var i=0,o=0;i<styleIds.length;i++,o+=2){var value=styleIds[i];bytes[o]=value&255;bytes[o+1]=value>>>8;}
    var binary='';
    for(var start=0;start<bytes.length;start+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(start,start+0x8000));
    return btoa(binary);
  }
  function decodeStyleIds(encoded,expectedLength){
    var binary=atob(encoded||''),byteLength=expectedLength*2;
    if(binary.length!==byteLength)throw new Error('Smart Raster ownership length mismatch');
    var styleIds=new Uint16Array(expectedLength);
    for(var i=0,o=0;i<expectedLength;i++,o+=2)styleIds[i]=binary.charCodeAt(o)|(binary.charCodeAt(o+1)<<8);
    return styleIds;
  }
  function frameKeys(layer){
    var keys={};
    Object.keys(layer.frames||{}).forEach(function(fi){keys[fi]=true;});
    Object.keys(layer.smartStyleFrames||{}).forEach(function(fi){keys[fi]=true;});
    return Object.keys(keys);
  }
  function serializeLayer(layer){
    if(!layer||layer.type!=='smart-raster')return legacySerialize?legacySerialize(layer):null;
    var frames={};
    frameKeys(layer).forEach(function(fi){
      var artwork=layer.frames&&layer.frames[fi],owned=layer.smartStyleFrames&&layer.smartStyleFrames[fi];
      var width=owned?owned.width:(artwork?artwork.width:CW),height=owned?owned.height:(artwork?artwork.height:CH);
      if(width!==CW||height!==CH)throw new Error('Smart Raster frame dimensions do not match the project canvas');
      var styleIds=owned?owned.styleIds:new Uint16Array(width*height);
      if(styleIds.length!==width*height)throw new Error('Smart Raster ownership length does not match frame dimensions');
      frames[fi]={
        width:width,
        height:height,
        rgba:artwork?artwork.toDataURL('image/png'):null,
        styleIds:encodeStyleIds(styleIds),
        underlays:owned?cloneUnderlays(owned.underlays):{},
        styleIdToIndex:Object.assign({},owned&&owned.meta&&owned.meta.styleIdToIndex||{}),
        indexToStyleId:Object.assign({},owned&&owned.meta&&owned.meta.indexToStyleId||{}),
        nextIndex:Math.max(1,Number(owned&&owned.meta&&owned.meta.nextIndex)||1)
      };
    });
    var result={typed:true,version:3,frames:frames,renderMode:layer.renderMode==='style-layering'?'style-layering':'legacy'};
    if(window.SmartRasterV4Serialization&&typeof window.SmartRasterV4Serialization.serializeLayer==='function'){
      try{var v4Payload=window.SmartRasterV4Serialization.serializeLayer(layer);if(v4Payload)result.v4=v4Payload;window.__smartRasterV4SerializationError=null;}
      catch(v4Error){window.__smartRasterV4SerializationError=v4Error;}
    }
    return result;
  }
  function loadArtwork(layer,fi,saved){
    if(!saved.rgba)return Promise.resolve();
    return new Promise(function(resolve,reject){
      var image=new Image();
      image.onload=function(){
        if(image.width!==saved.width||image.height!==saved.height){reject(new Error('Smart Raster RGBA dimensions do not match ownership dimensions'));return;}
        var canvas=document.createElement('canvas');canvas.width=saved.width;canvas.height=saved.height;
        canvas.getContext('2d').drawImage(image,0,0);
        layer.frames[fi]=canvas;resolve();
      };
      image.onerror=function(){reject(new Error('Smart Raster RGBA frame could not be decoded'));};
      image.src=saved.rgba;
    });
  }
  function deserializeLayer(layer,data){
    if(!data||!data.typed||!data.frames){
      if(legacyDeserialize)legacyDeserialize(layer,data);
      if(window.SmartRasterV4Serialization&&typeof window.SmartRasterV4Serialization.markLegacyLayer==='function')window.SmartRasterV4Serialization.markLegacyLayer(layer);
      return Promise.resolve();
    }
    layer.type='smart-raster';layer.renderMode='legacy';layer.smartRasterV4Native=false;layer.smartStyleFrames={};if(!layer.frames)layer.frames={};
    var pending=[];
    Object.keys(data.frames).forEach(function(fi){
      var saved=data.frames[fi],width=Number(saved.width),height=Number(saved.height);
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width!==CW||height!==CH)throw new Error('Smart Raster saved dimensions do not match the project canvas');
      var styleIds=decodeStyleIds(saved.styleIds,width*height);
      var meta=saved.meta?cloneMeta(saved.meta):cloneMeta({
        styleIdToIndex:saved.styleIdToIndex,
        indexToStyleId:saved.indexToStyleId,
        nextIndex:saved.nextIndex
      });
      layer.smartStyleFrames[fi]={width:width,height:height,styleIds:styleIds,underlays:cloneUnderlays(saved.underlays),meta:meta||emptyMeta()};
      pending.push(loadArtwork(layer,fi,saved));
    });
    var v4Load=null;
    if(window.SmartRasterV4Serialization){
      if(data.v4&&typeof window.SmartRasterV4Serialization.deserializeLayer==='function'){v4Load=window.SmartRasterV4Serialization.deserializeLayer(layer,data.v4);layer.smartRasterV4Native=true;}
      else if(typeof window.SmartRasterV4Serialization.markLegacyLayer==='function')window.SmartRasterV4Serialization.markLegacyLayer(layer);
    }
    return Promise.all(pending).then(function(){
      if(data.renderMode==='style-layering'&&window.SmartRasterStyleLayering){
        var activation=window.SmartRasterStyleLayering.setEnabled(layer,true);
        if(!activation||!activation.success)layer.renderMode='legacy';
      }
      return v4Load;
    });
  }


  window.SmartRasterLayer=Object.assign(window.SmartRasterLayer||{},{ensureFrame:ensureFrame,resetFrame:resetFrame,cloneMeta:cloneMeta,getFrameBundle:getFrameBundle,restoreFrameBundle:restoreFrameBundle,ensureStyleIndex:ensureStyleIndex,getStyleIdAt:getStyleIdAt,getStyleOwnership:getStyleOwnership,beginStyleErase:beginStyleErase,applyStyleEraseRegion:applyStyleEraseRegion,finishStyleErase:finishStyleErase,commitBrushMask:commitBrushMask,applyDiff:applyDiff,clearWhereTransparent:clearWhereTransparent,rerenderAll:rerenderAll,rerenderStyle:rerenderStyle,resizeAllFrames:resizeAllFrames,isStyleUsed:isStyleUsed,markDeleted:markDeleted,serializeLayer:serializeLayer,deserializeLayer:deserializeLayer});
})();