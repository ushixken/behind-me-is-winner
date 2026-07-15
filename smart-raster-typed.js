(function(){
  'use strict';

  var legacySerialize=window.SmartRasterLayer&&window.SmartRasterLayer.serializeLayer;
  var legacyDeserialize=window.SmartRasterLayer&&window.SmartRasterLayer.deserializeLayer;

  function emptyMeta(){return {styleIdToIndex:{},indexToStyleId:{},nextIndex:1};}
  function cloneMeta(meta){
    if(!meta)return null;
    return {styleIdToIndex:Object.assign({},meta.styleIdToIndex||{}),indexToStyleId:Object.assign({},meta.indexToStyleId||{}),nextIndex:Math.max(1,Number(meta.nextIndex)||1)};
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
      frame={width:CW,height:CH,styleIds:new Uint16Array(CW*CH),meta:frame&&cloneMeta(frame.meta)||emptyMeta()};
      layer.smartStyleFrames[fi]=frame;
    }
    if(!frame.meta)frame.meta=emptyMeta();
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
  function artworkCanvas(li,fi){
    var layer=layers[li];
    return li===curLayer&&fi===curFrame?activeC:layer&&layer.frames&&layer.frames[fi];
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
  function clearWhereTransparent(li,fi){
    var frame=ensureFrame(li,fi),canvas=artworkCanvas(li,fi);if(!frame||!canvas)return;
    var rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH).data;
    for(var p=0,o=3;p<frame.styleIds.length;p++,o+=4)if(rgba[o]===0)frame.styleIds[p]=0;
  }
  function recolorFrame(layer,li,fi,styleId,rgba){
    var frame=layer.smartStyleFrames&&layer.smartStyleFrames[fi];if(!frame)return false;
    var index=Number(frame.meta.styleIdToIndex[styleId])||0;if(!index)return false;
    var frameIndex=Number(fi),isActive=li===curLayer&&frameIndex===curFrame;
    var stored=layer.frames&&layer.frames[frameIndex],source=isActive?activeC:stored;if(!source)return false;
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
    if(isActive&&activeC!==stored)sourceContext.putImageData(image,0,0);
    return true;
  }  function rerenderStyle(styleId){
    var style=window.PaletteDocker&&window.PaletteDocker.findAdvancedStyleById(styleId);if(!style||!Array.isArray(style.rgba))return;
    var activeChanged=false,any=false;
    layers.forEach(function(layer,li){if(layer.type!=='smart-raster'||!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){if(recolorFrame(layer,li,fi,styleId,style.rgba)){any=true;if(li===curLayer&&Number(fi)===curFrame)activeChanged=true;}});});
    if(activeChanged&&typeof saveActiveToKey==='function')saveActiveToKey();
    if(activeChanged&&typeof recomposite==='function')recomposite(curLayer,curFrame);
    if(any&&typeof renderTimeline==='function')renderTimeline();
  }
  function rerenderAll(){
    var styles={};
    layers.forEach(function(layer){if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var meta=layer.smartStyleFrames[fi].meta;Object.keys(meta.styleIdToIndex).forEach(function(id){styles[id]=true;});});});
    Object.keys(styles).forEach(rerenderStyle);
  }
  function getFrameBundle(li,fi){
    var layer=layers[li],frame=layer&&layer.smartStyleFrames&&layer.smartStyleFrames[fi];
    return {rgba:cloneCanvas(artworkCanvas(li,fi)),styleIds:frame?frame.styleIds.slice():null,meta:frame?cloneMeta(frame.meta):null,width:frame?frame.width:CW,height:frame?frame.height:CH};
  }
  function restoreFrameBundle(li,fi,bundle){
    var layer=layers[li];if(!layer)return;
    if(!layer.smartStyleFrames)layer.smartStyleFrames={};
    if(bundle&&bundle.styleIds&&bundle.meta)layer.smartStyleFrames[fi]={width:bundle.width,height:bundle.height,styleIds:bundle.styleIds.slice(),meta:cloneMeta(bundle.meta)};
    else delete layer.smartStyleFrames[fi];
  }
  function resetFrame(li,fi){var layer=layers[li];if(layer&&layer.smartStyleFrames)delete layer.smartStyleFrames[fi];}
  function resizeAllFrames(nw,nh){
    layers.forEach(function(layer){if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var old=layer.smartStyleFrames[fi],ids=new Uint16Array(nw*nh),dx=Math.round((nw-old.width)/2),dy=Math.round((nh-old.height)/2);for(var y=0;y<old.height;y++)for(var x=0;x<old.width;x++){var nx=x+dx,ny=y+dy;if(nx>=0&&nx<nw&&ny>=0&&ny<nh)ids[ny*nw+nx]=old.styleIds[y*old.width+x];}layer.smartStyleFrames[fi]={width:nw,height:nh,styleIds:ids,meta:cloneMeta(old.meta)};});});
  }
  function markDeleted(styleId){layers.forEach(function(layer){if(!layer.smartStyleFrames)return;Object.keys(layer.smartStyleFrames).forEach(function(fi){var meta=layer.smartStyleFrames[fi].meta,index=meta.styleIdToIndex[styleId];if(index){meta.indexToStyleId[index]='__deleted__:'+styleId;delete meta.styleIdToIndex[styleId];}});});}
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
        styleIdToIndex:Object.assign({},owned&&owned.meta&&owned.meta.styleIdToIndex||{}),
        indexToStyleId:Object.assign({},owned&&owned.meta&&owned.meta.indexToStyleId||{}),
        nextIndex:Math.max(1,Number(owned&&owned.meta&&owned.meta.nextIndex)||1)
      };
    });
    return {typed:true,version:2,frames:frames};
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
      return Promise.resolve();
    }
    layer.type='smart-raster';layer.smartStyleFrames={};if(!layer.frames)layer.frames={};
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
      layer.smartStyleFrames[fi]={width:width,height:height,styleIds:styleIds,meta:meta||emptyMeta()};
      pending.push(loadArtwork(layer,fi,saved));
    });
    return Promise.all(pending);
  }


  window.SmartRasterLayer=Object.assign(window.SmartRasterLayer||{},{ensureFrame:ensureFrame,resetFrame:resetFrame,cloneMeta:cloneMeta,getFrameBundle:getFrameBundle,restoreFrameBundle:restoreFrameBundle,ensureStyleIndex:ensureStyleIndex,applyDiff:applyDiff,clearWhereTransparent:clearWhereTransparent,rerenderAll:rerenderAll,rerenderStyle:rerenderStyle,resizeAllFrames:resizeAllFrames,markDeleted:markDeleted,serializeLayer:serializeLayer,deserializeLayer:deserializeLayer});
})();
