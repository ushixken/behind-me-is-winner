(function(){
  'use strict';

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
    var canvas=artworkCanvas(li,Number(fi));if(!canvas)return false;
    var context=canvas.getContext('2d',{willReadFrequently:true});var image=context.getImageData(0,0,frame.width,frame.height);var data=image.data;
    var changed=false;
    for(var p=0,o=0;p<frame.styleIds.length;p++,o+=4)if(frame.styleIds[p]===index&&data[o+3]>0){data[o]=rgba[0];data[o+1]=rgba[1];data[o+2]=rgba[2];changed=true;}
    if(changed)context.putImageData(image,0,0);return changed;
  }
  function rerenderStyle(styleId){
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
  function serializeLayer(layer){
    if(!layer||!layer.smartStyleFrames)return legacySerialize?legacySerialize(layer):null;var frames={};
    Object.keys(layer.smartStyleFrames).forEach(function(fi){var frame=layer.smartStyleFrames[fi],bytes=new Uint8Array(frame.styleIds.buffer),binary='';for(var i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));frames[fi]={width:frame.width,height:frame.height,styleIds:btoa(binary),meta:cloneMeta(frame.meta)};});
    return {typed:true,frames:frames};
  }
  function deserializeLayer(layer,data){
    if(!data||!data.typed||!data.frames){if(legacyDeserialize)legacyDeserialize(layer,data);return;}if(!layer.smartStyleFrames)layer.smartStyleFrames={};layer.type='smart-raster';
    Object.keys(data.frames).forEach(function(fi){var saved=data.frames[fi],binary=atob(saved.styleIds),bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);var copy=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);layer.smartStyleFrames[fi]={width:saved.width,height:saved.height,styleIds:new Uint16Array(copy),meta:cloneMeta(saved.meta)};});
  }
  function debugPixel(x,y,li,fi){
    if(li==null)li=curLayer;if(fi==null)fi=curFrame;var frame=layers[li]&&layers[li].smartStyleFrames&&layers[li].smartStyleFrames[fi];if(!frame)return {styleIndex:0,styleId:null,styleName:null,rgbaAlpha:0};
    x=Math.max(0,Math.min(frame.width-1,Math.round(x)));y=Math.max(0,Math.min(frame.height-1,Math.round(y)));var index=frame.styleIds[y*frame.width+x],id=frame.meta.indexToStyleId[index]||null,style=id&&window.PaletteDocker&&window.PaletteDocker.findAdvancedStyleById(id),canvas=artworkCanvas(li,fi),alpha=canvas?canvas.getContext('2d',{willReadFrequently:true}).getImageData(x,y,1,1).data[3]:0;
    return {styleIndex:index,styleId:id,styleName:style&&style.name||null,rgbaAlpha:alpha};
  }

  window.SmartRasterLayer=Object.assign(window.SmartRasterLayer||{},{ensureFrame:ensureFrame,resetFrame:resetFrame,cloneMeta:cloneMeta,getFrameBundle:getFrameBundle,restoreFrameBundle:restoreFrameBundle,ensureStyleIndex:ensureStyleIndex,applyDiff:applyDiff,clearWhereTransparent:clearWhereTransparent,rerenderAll:rerenderAll,rerenderStyle:rerenderStyle,resizeAllFrames:resizeAllFrames,markDeleted:markDeleted,serializeLayer:serializeLayer,deserializeLayer:deserializeLayer,debugPixel:debugPixel});
})();
