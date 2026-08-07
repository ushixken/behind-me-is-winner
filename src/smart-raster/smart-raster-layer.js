// smart-raster-layer.js
// Phase 1: isolation only.  All logic is identical to what was previously
// spread across panels.js.  The only changes are:
//   - layer.styleFrames  -> layer.indexFrames
//   - layer.styleFrameMeta -> layer.indexMeta
//   - layer.type is introduced ('bitmap' | 'smart-raster')
//   - functions are exposed under window.SmartRasterLayer
//   - old global names (commitSmartRasterBrush, etc.) remain as shims in
//     panels.js so existing callers (brush-engine.js, palette.js, etc.) need
//     no changes.
//
// LOAD ORDER: must come before panels.js (panels.js calls SmartRasterLayer.*
// at definition time for the shim assignments).
//
// MIGRATION: on first load, any layer that has the old styleFrames /
// styleFrameMeta fields is migrated in-place to indexFrames / indexMeta and
// given type:'smart-raster'.  Layers without those fields get type:'bitmap'.
// The migration runs once at DOMContentLoaded (after core-state.js has
// initialised the layers array).

(function(){
  'use strict';

  // ── Internal canvas factories (same logic as the old panels.js helpers) ──

  function _mkIndexCanvas(){
    var o=document.createElement('canvas');
    o.width=CW;o.height=CH;
    // willReadFrequently + colorSpace:'srgb' are critical: the canvas stores
    // integer style indices in RGB channels.  Without these flags some browsers
    // apply sRGB gamma transforms on getImageData readback, corrupting the
    // small values (e.g. R=1 -> R=0 after gamma linearisation).
    var c=o.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    if(c){c.globalAlpha=1;c.globalCompositeOperation='source-over';c.imageSmoothingEnabled=false;}
    return o;
  }

  function _makeEmptyMeta(){
    return {indexToStyleId:{},styleIdToIndex:{},nextIndex:1};
  }

  // Clone meta as a plain object with correctly-typed keys.
  function _cloneMeta(meta){
    if(!meta) return null;
    var idxToId={};
    Object.entries(meta.indexToStyleId||{}).forEach(function(e){idxToId[Number(e[0])]=e[1];});
    var idToIdx={};
    Object.entries(meta.styleIdToIndex||{}).forEach(function(e){var n=Number(e[1]);if(n>0)idToIdx[e[0]]=n;});
    return {indexToStyleId:idxToId,styleIdToIndex:idToIdx,nextIndex:Math.max(1,meta.nextIndex||1)};
  }

  // Clone an index canvas using pixel-level copy only — never drawImage —
  // to avoid any color-space or premultiplication transform.
  function _cloneIndexCanvas(src){
    if(!src) return null;
    var c=_mkIndexCanvas();
    var srcCtx=src.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var dstCtx=c.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    dstCtx.putImageData(srcCtx.getImageData(0,0,src.width,src.height),0,0);
    return c;
  }

  // ── Ensure a layer has the new storage fields ─────────────────────────────

  function _ensureStorage(layer){
    if(!layer) return null;
    if(!layer.indexFrames) layer.indexFrames={};
    if(!layer.indexMeta)   layer.indexMeta={};
    return layer;
  }

  // Store a 16-bit style index in R/G and coverage in B. Alpha is only an
  // ownership marker and stays 255, preventing premultiplication data loss.
  function _encodePixel(data,offset,index,coverage){
    data[offset  ]=index&255;
    data[offset+1]=(index>>8)&255;
    data[offset+2]=coverage==null?255:Math.max(1,Math.min(255,coverage));
    data[offset+3]=255;
  }

  function _decodePixel(data,offset,meta){
    if(!data[offset+3]) return {index:0,coverage:0};
    var legacyIndex=data[offset]|(data[offset+1]<<8)|(data[offset+2]<<16);
    if(meta&&meta.indexToStyleId&&meta.indexToStyleId[legacyIndex]){
      return {index:legacyIndex,coverage:data[offset+3]};
    }
    return {index:data[offset]|(data[offset+1]<<8),coverage:data[offset+2]};
  }
  // ── Public API ────────────────────────────────────────────────────────────

  // ensureFrame(li, fi)
  // Returns the live {canvas, meta} for (li, fi), creating them if absent.
  // Always returns a reference into the layer's own objects.
  function ensureFrame(li,fi){
    if(li==null) li=curLayer;
    if(fi==null) fi=curFrame;
    var l=layers[li];if(!l) return null;
    _ensureStorage(l);
    var hasC=!!l.indexFrames[fi],hasM=!!l.indexMeta[fi];
    if(hasC!==hasM) resetFrame(li,fi);
    if(!l.indexFrames[fi]) l.indexFrames[fi]=_mkIndexCanvas();
    if(!l.indexMeta[fi])   l.indexMeta[fi]=_makeEmptyMeta();
    return {canvas:l.indexFrames[fi],meta:l.indexMeta[fi]};
  }

  // resetFrame(li, fi)
  // Deletes both the index canvas and meta for this frame.
  function resetFrame(li,fi){
    var l=layers[li];if(!l) return;
    _ensureStorage(l);
    delete l.indexFrames[fi];
    delete l.indexMeta[fi];
  }

  // cloneIndexCanvas(canvas)
  function cloneIndexCanvas(src){
    return _cloneIndexCanvas(src);
  }

  // cloneMeta(meta)
  function cloneMeta(meta){
    return _cloneMeta(meta);
  }

  // getFrameBundle(li, fi)
  // Returns a fully independent snapshot of both index pixels and metadata.
  // Undo entries must never retain the live frame canvas because later brush
  // commits would mutate the pixels stored in earlier history entries.
  function getFrameBundle(li,fi){
    var l=layers[li];
    if(!l) return {canvas:null,meta:null};
    _ensureStorage(l);
    return {
      canvas:_cloneIndexCanvas(l.indexFrames[fi]||null),
      meta:_cloneMeta(l.indexMeta[fi]||null)
    };
  }

  // restoreFrameBundle(li, fi, bundle)
  // Replaces the frame's index canvas and meta with deep copies from `bundle`.
  // Passing null/undefined bundle resets the frame.
  function restoreFrameBundle(li,fi,bundle){
    var l=layers[li];if(!l) return;
    _ensureStorage(l);
    if(bundle&&bundle.canvas&&bundle.meta){
      l.indexFrames[fi]=_cloneIndexCanvas(bundle.canvas);
      l.indexMeta[fi]=_cloneMeta(bundle.meta)||_makeEmptyMeta();
    } else {
      resetFrame(li,fi);
    }
  }

  // ensureStyleIndex(li, fi, styleId)
  // Registers styleId in the frame's meta (if not already) and returns its
  // numeric index (>=1).  Both forward and reverse mappings are written
  // atomically before returning.
  function ensureStyleIndex(li,fi,styleId){
    var bundle=ensureFrame(li,fi);if(!bundle||!styleId) return 0;
    var meta=bundle.meta;
    var existing=meta.styleIdToIndex.hasOwnProperty(styleId)?Number(meta.styleIdToIndex[styleId]):0;
    if(existing>0){
      if(!meta.indexToStyleId.hasOwnProperty(existing)||meta.indexToStyleId[existing]!==styleId){
        meta.indexToStyleId[Number(existing)]=styleId;
      }
      return existing;
    }
    var maxExisting=Object.keys(meta.indexToStyleId).reduce(function(m,k){return Math.max(m,Number(k));},0);
    var idx=Math.max(1,meta.nextIndex||1,maxExisting+1);
    meta.nextIndex=idx+1;
    meta.styleIdToIndex[styleId]=idx;
    meta.indexToStyleId[Number(idx)]=styleId;
    return idx;
  }

  // commitBrushMask(li, fi, maskCanvas, styleId, strokeOpacity)
  // Equivalent to the old commitSmartRasterBrush.  Writes coverage + index
  // for every non-transparent pixel in maskCanvas into the index canvas, then
  // calls renderFrame to update the RGBA canvas.
  function commitBrushMask(li,fi,maskCanvas,styleId,strokeOpacity,dirtyRect,beforeImage,brushBlendMode){
    if(!styleId||!maskCanvas) return false;
    var index=ensureStyleIndex(li,fi,styleId);
    var bundle=ensureFrame(li,fi);
    if(!index||!bundle) return false;
    var mask=maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH).data;
    var sctx=bundle.canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var opacity=Math.max(0,Math.min(1,Number(strokeOpacity)));
    if(opacity<=0) return true;
    var wrote=false;
    for(var y=0;y<CH;y++){
      var x=0;
      while(x<CW){
        while(x<CW&&mask[(y*CW+x)*4+3]===0) x++;
        var runStart=x;
        while(x<CW&&mask[(y*CW+x)*4+3]>0) x++;
        var runWidth=x-runStart;
        if(runWidth===0) continue;
        var img=sctx.getImageData(runStart,y,runWidth,1);
        var smart=img.data;
        for(var runX=0;runX<runWidth;runX++){
          var maskAlpha=mask[(y*CW+runStart+runX)*4+3];
          var incoming=Math.max(1,Math.round(maskAlpha*opacity));
          var smartOffset=runX*4;
          var previousPixel=_decodePixel(smart,smartOffset,bundle.meta);
          var previous=previousPixel.coverage;
          if(brushBlendMode==='draw-behind'&&previousPixel.index&&previousPixel.index!==index) continue;
          var coverage=Math.min(255,incoming+Math.round(previous*(255-incoming)/255));
          _encodePixel(smart,smartOffset,previousPixel.index||index,coverage);
        }
        sctx.putImageData(img,runStart,y);
        wrote=true;
      }
    }
    if(!wrote) return true;
    renderFrame(li,fi,activeC);
    return true;
  }

  // applyDiff(li, fi, beforeImageData, styleId)
  // Equivalent to the old applyStyleDiffFromBefore.  Compares the current
  // ctx pixels against beforeImageData and marks changed pixels with styleId.
  function applyDiff(li,fi,beforeImage,styleId){
    if(!styleId||!beforeImage) return;
    var after=ctx.getImageData(0,0,CW,CH);
    var before=beforeImage.data,now=after.data;
    var idx=ensureStyleIndex(li,fi,styleId);if(!idx) return;
    var bundle=ensureFrame(li,fi);if(!bundle) return;
    var sctx=bundle.canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var img=sctx.getImageData(0,0,CW,CH);var out=img.data;
    for(var i=0;i<now.length;i+=4){
      if(now[i]!==before[i]||now[i+1]!==before[i+1]||now[i+2]!==before[i+2]||now[i+3]!==before[i+3]){
        if(now[i+3]>0) _encodePixel(out,i,idx);
        else{out[i]=0;out[i+1]=0;out[i+2]=0;out[i+3]=0;}
      }
    }
    sctx.putImageData(img,0,0);

  }

  // applyMask(li, fi, maskCanvas, styleId)
  // Equivalent to the old applyStyleMaskFromCanvas.  Marks every opaque pixel
  // in maskCanvas with styleId in the index canvas.
  function applyMask(li,fi,maskCanvas,styleId){
    if(!styleId||!maskCanvas) return;
    var idx=ensureStyleIndex(li,fi,styleId);if(!idx) return;
    var bundle=ensureFrame(li,fi);if(!bundle) return;
    var mctx=maskCanvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var sctx=bundle.canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var mask=mctx.getImageData(0,0,CW,CH).data;
    var img=sctx.getImageData(0,0,CW,CH);var out=img.data;
    for(var i=0;i<mask.length;i+=4){
      if(mask[i+3]>0) _encodePixel(out,i,idx);
    }
    sctx.putImageData(img,0,0);

  }

  // clearWhereTransparent(li, fi)
  // Equivalent to the old clearStyleIndexWhereTransparent.  Clears index
  // canvas pixels that correspond to fully transparent RGBA pixels on activeC/ctx.
  function clearWhereTransparent(li,fi){
    var l=layers[li];
    if(!l||!l.indexFrames||!l.indexFrames[fi]) return;
    var pixels=ctx.getImageData(0,0,CW,CH).data;
    var sctx=l.indexFrames[fi].getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var img=sctx.getImageData(0,0,CW,CH);var data=img.data;
    var changed=false;
    for(var i=0;i<pixels.length;i+=4){
      if(pixels[i+3]===0&&data[i+3]!==0){data[i]=0;data[i+1]=0;data[i+2]=0;data[i+3]=0;changed=true;}
    }
    if(changed) sctx.putImageData(img,0,0);
  }

  // Revised GPU integration: smart-raster recoloring is index-based and
  // intrinsically requires CPU getImageData/putImageData — there is no
  // GPU-native path for it here. When the write target is the active
  // layer's own live surface (activeC), push the finished CPU-computed
  // result into whichever renderer is actually authoritative via
  // BrushRenderer.loadActiveSurface() (a one-time CPU->GPU upload per
  // recolor, not a per-frame readback) so GPU doesn't silently diverge.
  function _syncActiveSurfaceToGpu(){
    if(window.BrushRenderer&&typeof BrushRenderer.loadActiveSurface==='function'&&BrushRenderer.getActiveRenderer()==='gpu'){
      BrushRenderer.loadActiveSurface(activeC);
    }
  }

  // renderFrame(li, fi, targetCanvas)
  // Equivalent to the old renderSmartRasterFrame.  Converts index data into
  // RGBA pixels on targetCanvas by looking up each style ID in the palette.
  function renderFrame(li,fi,targetCanvas){
    if(li==null) li=curLayer;
    if(fi==null) fi=curFrame;
    var layer=layers[li];
    if(!layer||!layer.indexFrames||!layer.indexFrames[fi]) return false;
    var meta=layer.indexMeta&&layer.indexMeta[fi];
    var target=targetCanvas||(li===curLayer&&fi===curFrame?activeC:layer.frames&&layer.frames[fi]);
    if(!meta||!target) return false;
    var sctx=layer.indexFrames[fi].getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    var tctx=target.getContext('2d',{willReadFrequently:true});
    var smart=sctx.getImageData(0,0,CW,CH).data;
    var rendered=tctx.getImageData(0,0,CW,CH);
    var out=rendered.data;
    var styleCache={};
    for(var i=0;i<smart.length;i+=4){
      var decoded=_decodePixel(smart,i,meta);
      var coverage=decoded.coverage;
      if(!coverage){
        out[i]=0;out[i+1]=0;out[i+2]=0;out[i+3]=0;
        continue;
      }
      var index=decoded.index;
      var styleId=meta.indexToStyleId&&meta.indexToStyleId[index];
      if(!styleId){
        continue;
      }
      if(styleId.startsWith('__deleted__:')) continue;
      var rgba=styleCache[styleId];
      if(!rgba){
        var style=window.PaletteDocker&&window.PaletteDocker.findAdvancedStyleById(styleId);
        rgba=style&&Array.isArray(style.rgba)?style.rgba:null;
        styleCache[styleId]=rgba;
      }
      if(!rgba) continue;
      out[i]=rgba[0];out[i+1]=rgba[1];out[i+2]=rgba[2];
      out[i+3]=Math.round(coverage*(rgba[3]==null?255:rgba[3])/255);
    }
    tctx.putImageData(rendered,0,0);
    if(target===activeC) _syncActiveSurfaceToGpu();
    return true;
  }

  // rerenderAll()
  // Re-renders every index frame across all layers.  Called by palette.js
  // when a style colour changes.
  function rerenderAll(){
    layers.forEach(function(layer,li){
      if(!layer.indexFrames) return;
      Object.keys(layer.indexFrames).forEach(function(fi){
        var frameIndex=Number(fi);
        var target=li===curLayer&&frameIndex===curFrame?activeC:layer.frames&&layer.frames[frameIndex];
        if(target) renderFrame(li,frameIndex,target);
      });
    });
    if(typeof saveActiveToKey==='function') saveActiveToKey();
    if(typeof recomposite==='function') recomposite(curLayer,curFrame);
  }

  function rerenderStyle(styleId){
    if(!styleId) return;
    var activeAffected=false;
    var anyAffected=false;
    layers.forEach(function(layer,li){
      if(!layer||layer.type!=='smart-raster'||!layer.indexFrames||!layer.indexMeta) return;
      Object.keys(layer.indexFrames).forEach(function(fi){
        var meta=layer.indexMeta[fi];
        if(!meta||!meta.styleIdToIndex||!meta.styleIdToIndex[styleId]) return;
        var frameIndex=Number(fi);
        if(!layer.frames) layer.frames={};
        if(!layer.frames[frameIndex]){
          var frame=document.createElement('canvas');
          frame.width=CW;frame.height=CH;
          layer.frames[frameIndex]=frame;
        }
        renderFrame(li,frameIndex,layer.frames[frameIndex]);
        anyAffected=true;
        if(li===curLayer&&frameIndex===curFrame){
          ctx.clearRect(0,0,CW,CH);
          ctx.drawImage(layer.frames[frameIndex],0,0);
          activeAffected=true;
        }
      });
    });
    if(activeAffected&&typeof recomposite==='function') recomposite(curLayer,curFrame);
    if(anyAffected&&typeof renderTimeline==='function') renderTimeline();
  }
  // resizeAllFrames(nw, nh)
  // Resizes every index canvas to nw x nh, centring existing content.
  // Call after CW/CH change, before initCanvas().
  function resizeAllFrames(nw,nh,offsetX,offsetY){
    layers.forEach(function(layer){
      if(!layer.indexFrames) return;
      Object.keys(layer.indexFrames).forEach(function(fi){
        var src=layer.indexFrames[fi];if(!src) return;
        var nc=document.createElement('canvas');nc.width=nw;nc.height=nh;
        var nctx=nc.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
        var dx=Number.isFinite(offsetX)?Math.round(offsetX):Math.round((nw-src.width)/2);
        var dy=Number.isFinite(offsetY)?Math.round(offsetY):Math.round((nh-src.height)/2);
        var srcCtx=src.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
        nctx.putImageData(srcCtx.getImageData(0,0,src.width,src.height),dx,dy);
        layer.indexFrames[fi]=nc;
      });
    });
  }

  // markDeleted(styleId)
  // Marks all index pixels for a deleted style as orphaned so they are not
  // silently reassigned.
  function markDeleted(styleId){
    if(!styleId) return;
    layers.forEach(function(layer){
      if(!layer.indexMeta) return;
      Object.keys(layer.indexMeta).forEach(function(fi){
        var meta=layer.indexMeta[fi];if(!meta) return;
        var idx=meta.styleIdToIndex&&meta.styleIdToIndex[styleId];
        if(!idx) return;
        if(meta.indexToStyleId) meta.indexToStyleId[idx]='__deleted__:'+styleId;
        delete meta.styleIdToIndex[styleId];
      });
    });
  }

  // serializeLayer(layer)
  // Returns a JSON-safe representation of a layer's index frames + meta.
  // Returns null if the layer has no index data.
  function serializeLayer(layer){
    if(!layer||!layer.indexFrames) return null;
    var keys=Object.keys(layer.indexFrames);
    if(!keys.length) return null;
    var frames={};
    keys.forEach(function(fi){
      var c=layer.indexFrames[fi];if(!c) return;
      try{frames[fi]=c.toDataURL('image/png');}catch(e){}
    });
    var meta={};
    if(layer.indexMeta){
      Object.keys(layer.indexMeta).forEach(function(fi){
        if(layer.indexMeta[fi]) meta[fi]=_cloneMeta(layer.indexMeta[fi]);
      });
    }
    return {frames:frames,meta:meta};
  }

  // deserializeLayer(layer, data)
  // Restores a layer's index frames + meta from the serialized form produced
  // by serializeLayer().  Safe to call with null/undefined data (old projects
  // without index data).
  function deserializeLayer(layer,data){
    _ensureStorage(layer);
    if(!data||!data.frames) return;
    var frameKeys=Object.keys(data.frames);
    if(!frameKeys.length) return;
    layer.type='smart-raster';
    frameKeys.forEach(function(fi){
      var url=data.frames[fi];
      if(!url) return;
      var img=new Image();
      img.onload=function(){
        // Draw into an intermediate canvas with willReadFrequently + colorSpace
        // BEFORE copying to the index canvas — skipping this step lets some
        // browsers apply sRGB gamma on getImageData, corrupting small indices
        // like R=1 or R=2 into 0.
        var tmp=document.createElement('canvas');tmp.width=img.width||CW;tmp.height=img.height||CH;
        var tctx=tmp.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
        if(tctx){tctx.imageSmoothingEnabled=false;}
        tctx.drawImage(img,0,0);
        var pixelData=tctx.getImageData(0,0,tmp.width,tmp.height);
        var c=_mkIndexCanvas();
        var sctx=c.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
        sctx.putImageData(pixelData,0,0);
        layer.indexFrames[fi]=c;
        if(data.meta&&data.meta[fi]) layer.indexMeta[fi]=_cloneMeta(data.meta[fi]);
        else layer.indexMeta[fi]={indexToStyleId:{},styleIdToIndex:{},nextIndex:1};
      };
      img.onerror=function(){};
      img.src=url;
    });
  }

  // ── Backward-compat helpers: old serialization used 'styleFrames' field names.
  // deserializeLayerLegacy handles saved data that still has the old field names
  // inside the serialized payload (the payload itself is unchanged; only the
  // layer storage fields are renamed).
  // This is only relevant if the project JSON itself stores the bundle under
  // a key like 'styleData' that callers then pass to deserializeLayerStyleFrames.
  // That path is handled by the shim in panels.js.

  // ── One-time migration ────────────────────────────────────────────────────
  // Walks the live layers array and renames styleFrames -> indexFrames,
  // styleFrameMeta -> indexMeta, and sets layer.type.
  // Called at DOMContentLoaded so all scripts have run and layers[] is fully
  // initialised.
  function _migrateExistingLayers(){
    if(typeof layers==='undefined') return;
    layers.forEach(function(layer){
      if(!layer) return;
      // Migrate old field names if present.
      if(layer.styleFrames&&!layer.indexFrames){
        layer.indexFrames=layer.styleFrames;
        delete layer.styleFrames;
      }
      if(layer.styleFrameMeta&&!layer.indexMeta){
        layer.indexMeta=layer.styleFrameMeta;
        delete layer.styleFrameMeta;
      }
      // Indexed experimental data is authoritative evidence of a Smart Raster
      // layer, including projects saved before layer.type was introduced.
      var hasIndexData=!!(layer.indexFrames&&Object.keys(layer.indexFrames).length>0);
      if(hasIndexData) layer.type='smart-raster';
      else if(layer.type!=='smart-raster') layer.type='bitmap';
    });
  }

  // ── Export ────────────────────────────────────────────────────────────────

  window.SmartRasterLayer={
    ensureFrame:         ensureFrame,
    resetFrame:          resetFrame,
    cloneIndexCanvas:    cloneIndexCanvas,
    cloneMeta:           cloneMeta,
    getFrameBundle:      getFrameBundle,
    restoreFrameBundle:  restoreFrameBundle,
    ensureStyleIndex:    ensureStyleIndex,
    commitBrushMask:     commitBrushMask,
    applyDiff:           applyDiff,
    applyMask:           applyMask,
    clearWhereTransparent: clearWhereTransparent,
    renderFrame:         renderFrame,
    rerenderAll:         rerenderAll,
    rerenderStyle:       rerenderStyle,
    resizeAllFrames:     resizeAllFrames,
    markDeleted:         markDeleted,
    serializeLayer:      serializeLayer,
    deserializeLayer:    deserializeLayer,

    _mkIndexCanvas:      _mkIndexCanvas,
    _makeEmptyMeta:      _makeEmptyMeta,
    _encodePixel:        _encodePixel,
    _decodePixel:        _decodePixel,
  };

  window.addEventListener('advanced-palette-style-color-changed',function(event){
    var styleId=event&&event.detail&&event.detail.styleId;
    if(styleId&&window.SmartRasterLayer&&typeof window.SmartRasterLayer.rerenderStyle==='function') window.SmartRasterLayer.rerenderStyle(styleId);
  });

  // Run migration after DOM is ready (layers[] is populated by core-state.js
  // which runs before this file).
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',_migrateExistingLayers);
  } else {
    _migrateExistingLayers();
  }

})();