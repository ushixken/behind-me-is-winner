(function(){
  'use strict';

  var selectionMask=null,outlineMask=null,contourSegments=new Float32Array(0),contourPath=null;
  var selectionRevision=0;
  var selectionWidth=0,selectionHeight=0;
  var selectionBounds=null,selectionActive=false;
  var selectionLayerIndex=-1,selectionFrameIndex=-1;
  var overlay=null,maskCanvas=null,overlayVisible=true;
  var overlayRaf=0;
  var overlayOffsetX=0,overlayOffsetY=0;
  var transformPreviewSegments=null,transformPreviewPath=null;
  var selectionScopeMode='all',selectionScopeCanvas=null,selectionScopeContext=null;
  try{var savedScope=localStorage.getItem('animate.selectionScope.v1');if(['all','inside','outside'].indexOf(savedScope)>=0)selectionScopeMode=savedScope;else{var legacyScope=localStorage.getItem('animate.fillScope.v1');if(legacyScope==='inside'||legacyScope==='outside')selectionScopeMode=legacyScope;localStorage.setItem('animate.selectionScope.v1',selectionScopeMode);}}catch(_){}

  function heldFrameIndex(layer,frameIndex){
    if(!layer)return frameIndex;
    for(var f=frameIndex;f>=0;f--)if(layer.frames&&layer.frames[f])return f;
    return frameIndex;
  }

  function ensureMaskCanvas(width,height){
    if(!maskCanvas)maskCanvas=document.createElement('canvas');
    if(maskCanvas.width!==width||maskCanvas.height!==height){maskCanvas.width=width;maskCanvas.height=height;}
  }

  function ensureOverlay(){
    if(!overlay){
      overlay=document.createElement('canvas');
      overlay.id='linked-pixel-selection-canvas';
      overlay.setAttribute('aria-hidden','true');
      overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:3;';
      canvasArea.appendChild(overlay);
    }
    var rect=canvasArea.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1);
    var width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(overlay.width!==width||overlay.height!==height){overlay.width=width;overlay.height=height;}
    return {width:rect.width,height:rect.height,dpr:dpr};
  }

  // Display-only cleanup and contour extraction run once per selection
  // revision. Navigation only reuses contourSegments.
  function rebuildOutlineAndContours(width,height,bounds){
    outlineMask=new Uint8Array(width*height);contourSegments=new Float32Array(0);contourPath=null;
    if(!selectionMask||!bounds)return;
    var visited=new Uint8Array(width*height),queue=new Int32Array(bounds.width*bounds.height);
    var minX=bounds.x,minY=bounds.y,maxX=minX+bounds.width,maxY=minY+bounds.height;
    for(var sy=minY;sy<maxY;sy++)for(var sx=minX;sx<maxX;sx++){
      var start=sy*width+sx;if(selectionMask[start]!==255||visited[start])continue;
      var head=0,tail=0;queue[tail++]=start;visited[start]=1;
      while(head<tail){
        var p=queue[head++],x=p%width,y=(p/width)|0;
        for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
          if((dx===0&&dy===0)||x+dx<minX||x+dx>=maxX||y+dy<minY||y+dy>=maxY)continue;
          var n=(y+dy)*width+x+dx;
          if(!visited[n]&&selectionMask[n]===255){visited[n]=1;queue[tail++]=n;}
        }
      }
      if(tail>2)for(var i=0;i<tail;i++)outlineMask[queue[i]]=255;
    }
    function selected(x,y){return x>=minX&&y>=minY&&x<maxX&&y<maxY&&outlineMask[y*width+x]===255;}
    var edges=0;
    for(var y=minY;y<maxY;y++)for(var x=minX;x<maxX;x++)if(selected(x,y)){
      if(!selected(x,y-1))edges++;if(!selected(x+1,y))edges++;
      if(!selected(x,y+1))edges++;if(!selected(x-1,y))edges++;
    }
    contourSegments=new Float32Array(edges*4);var at=0;
    if(typeof Path2D!=='undefined')contourPath=new Path2D();
    function add(x1,y1,x2,y2){contourSegments[at++]=x1;contourSegments[at++]=y1;contourSegments[at++]=x2;contourSegments[at++]=y2;if(contourPath){contourPath.moveTo(x1,y1);contourPath.lineTo(x2,y2);}}
    for(var y=minY;y<maxY;y++)for(var x=minX;x<maxX;x++)if(selected(x,y)){
      if(!selected(x,y-1))add(x,y,x+1,y);
      if(!selected(x+1,y))add(x+1,y,x+1,y+1);
      if(!selected(x,y+1))add(x+1,y+1,x,y+1);
      if(!selected(x-1,y))add(x,y+1,x,y);
    }
  }

  function rebuildMaskCanvasAndBounds(){
    var width=selectionWidth||CW,height=selectionHeight||CH;
    ensureMaskCanvas(width,height);
    var mc=maskCanvas.getContext('2d'),image=mc.createImageData(width,height),d=image.data;
    var minX=width,minY=height,maxX=-1,maxY=-1,count=0;
    mc.clearRect(0,0,width,height);
    if(selectionMask){
      for(var y=0;y<height;y++)for(var x=0;x<width;x++){
        var p=y*width+x;if(selectionMask[p]!==255)continue;
        d[p*4+3]=255;count++;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      }
      mc.putImageData(image,0,0);
    }
    selectionBounds=count?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null;
    rebuildOutlineAndContours(width,height,selectionBounds);selectionRevision++;
    selectionActive=count>0;
    window.pixelSelectionState={active:selectionActive,mask:selectionMask,maskCanvas:maskCanvas,bounds:selectionBounds,width:width,height:height,count:count,revision:selectionRevision,layerIndex:selectionLayerIndex,frameIndex:selectionFrameIndex};
    return count;
  }

  function canvasToViewport(x,y){
    var rad=rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad);
    var rx=(x*zoom)*cos-(y*zoom)*sin+panX;
    var ry=(x*zoom)*sin+(y*zoom)*cos+panY;
    var pivot=getNavPivot();
    if(flipX)rx=pivot.cx-(rx-pivot.cx);
    if(flipY)ry=pivot.cy-(ry-pivot.cy);
    return{x:rx,y:ry};
  }

  function renderSelection(){
    overlayRaf=0;
    var geometry=ensureOverlay(),c=overlay.getContext('2d'),dpr=geometry.dpr;
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,overlay.width,overlay.height);
    overlay.style.display=overlayVisible?'block':'none';
    var drawSegments=transformPreviewSegments||contourSegments,drawPath=transformPreviewSegments?transformPreviewPath:contourPath;
    if(!overlayVisible||!selectionActive||!drawSegments.length)return;
    c.strokeStyle='#7f77dd';c.lineCap='butt';c.lineJoin='miter';
    if(drawPath){
      var pivot=getNavPivot(),fx=flipX?-1:1,fy=flipY?-1:1;
      c.setTransform(dpr,0,0,dpr,0.5,0.5);
      c.translate(pivot.cx,pivot.cy);c.scale(fx,fy);c.translate(-pivot.cx,-pivot.cy);
      c.translate(panX,panY);c.rotate(rotation*Math.PI/180);c.scale(zoom,zoom);
      c.translate(overlayOffsetX,overlayOffsetY);
      c.lineWidth=1/(dpr*Math.max(0.0001,zoom));c.stroke(drawPath);
    }else{
      c.setTransform(dpr,0,0,dpr,0,0);c.lineWidth=1/dpr;c.beginPath();
      for(var i=0;i<drawSegments.length;i+=4){
        var a=canvasToViewport(drawSegments[i]+overlayOffsetX,drawSegments[i+1]+overlayOffsetY);
        var b=canvasToViewport(drawSegments[i+2]+overlayOffsetX,drawSegments[i+3]+overlayOffsetY);
        c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
      }
      c.stroke();
    }
  }

  function scheduleOverlayRender(){
    if(!selectionActive||overlayRaf)return;
    overlayRaf=requestAnimationFrame(renderSelection);
  }

  function combineMask(incoming,mode){
    if(mode==='replace')selectionMask=incoming;
    else if(!selectionMask||selectionMask.length!==incoming.length){
      selectionMask=mode==='add'?incoming:new Uint8ClampedArray(incoming.length);
    }else for(var i=0;i<incoming.length;i++){
      var current=selectionMask[i]===255,next=incoming[i]===255,selected;
      if(mode==='add')selected=current||next;
      else if(mode==='subtract')selected=current&&!next;
      else selected=current&&next;
      selectionMask[i]=selected?255:0;
    }
  }


  function selectionModeFromEvent(event,binding){
    binding=binding||{};
    var extraShift=!!event.shiftKey&&!binding.shift,extraAlt=!!event.altKey&&!binding.alt;
    return extraShift&&extraAlt?'intersect':extraShift?'add':extraAlt?'subtract':'replace';
  }

  function applyCanonicalMask(incoming,width,height,mode,source){
    if(!(incoming instanceof Uint8Array||incoming instanceof Uint8ClampedArray)||incoming.length!==width*height)return false;
    var incomingCount=0;for(var p=0;p<incoming.length;p++)if(incoming[p]===255)incomingCount++;
    if(!incomingCount)return false;
    var layer=layers[curLayer],targetFrame=layer&&layer.type==='smart-raster'?heldFrameIndex(layer,curFrame):curFrame;
    if(selectionLayerIndex!==curLayer)selectionMask=null;
    if(selectionMask&&selectionLayerIndex===curLayer)targetFrame=selectionFrameIndex;
    selectionWidth=width;selectionHeight=height;selectionLayerIndex=curLayer;selectionFrameIndex=targetFrame;
    combineMask(incoming,mode||'replace');var selectedCount=rebuildMaskCanvasAndBounds();
    overlayVisible=true;if(selectedCount)scheduleOverlayRender();else renderSelection();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:selectedCount>0,mode:mode||'replace',source:source||'selection-tool',matchedPixelCount:selectedCount,mask:selectionMask.slice(),maskCanvas:maskCanvas,bounds:selectionBounds&&Object.assign({},selectionBounds),width:width,height:height,layerIndex:curLayer,frameIndex:targetFrame}}));
    return true;
  }

  function selectLinkedPixels(styleId,event,source){
    var layer=layers[curLayer];
    if(!layer||layer.type!=='smart-raster'||!styleId)return false;
    var frameIndex=heldFrameIndex(layer,curFrame),frame=layer.smartStyleFrames&&layer.smartStyleFrames[frameIndex];
    if(!frame||!frame.meta||!(frame.styleIds instanceof Uint16Array))return true;
    var index=Number(frame.meta.styleIdToIndex&&frame.meta.styleIdToIndex[styleId])||0;
    var width=frame.width||CW,height=frame.height||CH,incoming=new Uint8ClampedArray(width*height);
    var incomingCount=0;
    if(index){
      var rgba=ctx.getImageData(0,0,width,height).data;
      for(var y=0;y<height;y++)for(var x=0;x<width;x++){
        var p=y*width+x,o=p*4;if(frame.styleIds[p]===index&&rgba[o+3]>0){incoming[p]=255;incomingCount++;}
      }
    }
    var binding=keybinds.selectLinkedPixels||{};
    var mode=selectionModeFromEvent(event,binding);
    // An unused style is not an empty geometric selection operation. Leave
    // the canonical selection untouched in every mode.
    if(!incomingCount)return true;
    if(selectionLayerIndex!==curLayer||selectionFrameIndex!==frameIndex)selectionMask=null;
    selectionWidth=width;selectionHeight=height;selectionLayerIndex=curLayer;selectionFrameIndex=frameIndex;
    combineMask(incoming,mode);var matchedCount=rebuildMaskCanvasAndBounds();
    overlayVisible=true;if(!matchedCount){renderSelection();return true;}scheduleOverlayRender();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:true,mode:mode,source:source||'linked-style',styleId:styleId,ownershipIndex:index,matchedPixelCount:matchedCount,mask:selectionMask.slice(),maskCanvas:maskCanvas,bounds:selectionBounds&&Object.assign({},selectionBounds),width:width,height:height,layerIndex:curLayer,frameIndex:frameIndex}}));
    return true;
  }

  function handleStylePointer(event,styleId){
    if(typeof matchPointerBind!=='function'||!matchPointerBind(event,'selectLinkedPixels',true))return false;
    event.preventDefault();event.stopPropagation();selectLinkedPixels(styleId,event);return true;
  }

  function handleCanvasPointer(event,force){
    if(typeof matchPointerBind!=='function'||!matchPointerBind(event,'selectLinkedPixels',true))return;
    if(selectionActive&&!force)return;
    event.preventDefault();event.stopImmediatePropagation();
    var layer=layers[curLayer];if(!layer||layer.type!=='smart-raster')return;
    var frameIndex=heldFrameIndex(layer,curFrame),frame=layer.smartStyleFrames&&layer.smartStyleFrames[frameIndex];
    if(!frame||!frame.meta||!(frame.styleIds instanceof Uint16Array))return;
    var point=getPos(event),x=Math.floor(point.x),y=Math.floor(point.y),width=frame.width||CW,height=frame.height||CH;
    if(x<0||y<0||x>=width||y>=height)return;
    var offset=y*width+x,index=frame.styleIds[offset];
    if(!index||ctx.getImageData(x,y,1,1).data[3]===0)return;
    var styleId=frame.meta.indexToStyleId&&frame.meta.indexToStyleId[index];if(!styleId)return;
    selectLinkedPixels(styleId,event,'linked-canvas');
  }
  canvasArea.addEventListener('pointerdown',handleCanvasPointer,true);

  function clearSelection(){
    overlayOffsetX=overlayOffsetY=0;transformPreviewSegments=transformPreviewPath=null;
    selectionMask=null;outlineMask=null;contourSegments=new Float32Array(0);contourPath=null;selectionBounds=null;selectionActive=false;
    selectionLayerIndex=selectionFrameIndex=-1;
    if(overlayRaf){cancelAnimationFrame(overlayRaf);overlayRaf=0;}
    rebuildMaskCanvasAndBounds();renderSelection();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:false,source:'deselect'}}));
  }

  function deleteSelectedPixels(){
    if(!selectionActive||!selectionMask)return false;
    var state=window.pixelSelectionState,layer=layers[curLayer];if(!state||state.layerIndex!==curLayer||!layer)return false;
    pushUndo();var image=ctx.getImageData(0,0,state.width,state.height),rgba=image.data;
    var frame=layer.type==='smart-raster'&&layer.smartStyleFrames&&layer.smartStyleFrames[state.frameIndex];
    for(var p=0,o=0;p<selectionMask.length;p++,o+=4)if(selectionMask[p]===255){
      rgba[o]=rgba[o+1]=rgba[o+2]=rgba[o+3]=0;if(frame&&frame.styleIds)frame.styleIds[p]=0;
    }
    ctx.putImageData(image,0,0);saveActiveToKey();recomposite(curLayer,curFrame);renderTimeline();clearSelection();return true;
  }

  function replaceSelectedWithStyle(styleId,rgba){
    var state=window.pixelSelectionState,layer=layers[curLayer];
    if(!selectionActive||!selectionMask||!state||state.layerIndex!==curLayer||!layer||layer.type!=='smart-raster'||!styleId||!Array.isArray(rgba))return false;
    var frameIndex=state.frameIndex,frame=layer.smartStyleFrames&&layer.smartStyleFrames[frameIndex];
    if(!frame||!(frame.styleIds instanceof Uint16Array)||frame.styleIds.length!==selectionMask.length)return false;
    var image=ctx.getImageData(0,0,state.width,state.height),pixels=image.data,hasVisible=false,hasStaleTransparentOwnership=false;
    for(var p=0,o=0;p<selectionMask.length;p++,o+=4)if(selectionMask[p]===255){
      if(pixels[o+3]>0)hasVisible=true;
      else if(frame.styleIds[p]!==0)hasStaleTransparentOwnership=true;
      if(hasVisible&&hasStaleTransparentOwnership)break;
    }
    if(!hasVisible&&!hasStaleTransparentOwnership)return false;
    pushUndo();
    var destinationIndex=SmartRasterLayer.ensureStyleIndex(curLayer,frameIndex,styleId);
    if(!destinationIndex)return false;
    for(var p=0,o=0;p<selectionMask.length;p++,o+=4){
      if(selectionMask[p]!==255)continue;
      if(pixels[o+3]===0){frame.styleIds[p]=0;continue;}
      frame.styleIds[p]=destinationIndex;
      pixels[o]=rgba[0];pixels[o+1]=rgba[1];pixels[o+2]=rgba[2];
    }
    ctx.putImageData(image,0,0);
    var stored=layer.frames&&layer.frames[frameIndex];
    if(stored){var storedContext=stored.getContext('2d');storedContext.clearRect(0,0,state.width,state.height);storedContext.drawImage(activeC,0,0);}
    recomposite(curLayer,curFrame);renderTimeline();scheduleOverlayRender();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:true,source:'replace-selected-style',styleId:styleId,mask:selectionMask.slice(),maskCanvas:maskCanvas,bounds:selectionBounds&&Object.assign({},selectionBounds),width:state.width,height:state.height,layerIndex:curLayer,frameIndex:frameIndex}}));
    return true;
  }

  function setOverlayVisible(visible){overlayVisible=!!visible;if(overlayVisible)scheduleOverlayRender();else if(overlay)overlay.style.display='none';}

  function containsEvent(event){
    if(!selectionActive||!selectionMask)return false;
    var point=getPos(event),x=Math.floor(point.x),y=Math.floor(point.y);
    return x>=0&&y>=0&&x<selectionWidth&&y<selectionHeight&&selectionMask[y*selectionWidth+x]===255;
  }

  function setOverlayOffset(x,y){overlayOffsetX=Number(x)||0;overlayOffsetY=Number(y)||0;scheduleOverlayRender();}

  function translateSelection(dx,dy){
    if(!selectionActive||!selectionMask)return false;
    dx=Math.round(Number(dx)||0);dy=Math.round(Number(dy)||0);
    var moved=new Uint8ClampedArray(selectionMask.length);
    for(var y=0;y<selectionHeight;y++)for(var x=0;x<selectionWidth;x++)if(selectionMask[y*selectionWidth+x]===255){
      var nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<selectionWidth&&ny<selectionHeight)moved[ny*selectionWidth+nx]=255;
    }
    selectionMask=moved;overlayOffsetX=overlayOffsetY=0;
    var count=rebuildMaskCanvasAndBounds();overlayVisible=true;if(count)scheduleOverlayRender();else renderSelection();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:count>0,source:'selection-move',mask:selectionMask.slice(),maskCanvas:maskCanvas,bounds:selectionBounds&&Object.assign({},selectionBounds),width:selectionWidth,height:selectionHeight,layerIndex:selectionLayerIndex,frameIndex:selectionFrameIndex}}));
    return true;
  }

  function maskBounds(mask,width,height){
    var minX=width,minY=height,maxX=-1,maxY=-1,count=0;
    if(mask)for(var y=0;y<height;y++)for(var x=0;x<width;x++)if(mask[y*width+x]===255){count++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
    return {count:count,bounds:count?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null};
  }

  function setTransformPreview(mask,width,height){
    transformPreviewSegments=transformPreviewPath=null;
    if(!selectionActive||!mask||mask.length!==width*height){scheduleOverlayRender();return;}
    var info=maskBounds(mask,width,height);
    var savedMask=selectionMask,savedOutline=outlineMask,savedSegments=contourSegments,savedPath=contourPath;
    selectionMask=mask;rebuildOutlineAndContours(width,height,info.bounds);
    transformPreviewSegments=contourSegments;transformPreviewPath=contourPath;
    selectionMask=savedMask;outlineMask=savedOutline;contourSegments=savedSegments;contourPath=savedPath;
    overlayOffsetX=overlayOffsetY=0;scheduleOverlayRender();
  }

  function clearTransformPreview(){transformPreviewSegments=transformPreviewPath=null;overlayOffsetX=overlayOffsetY=0;scheduleOverlayRender();}

  function replaceCanonicalMask(mask,width,height,source,snapshot){
    transformPreviewSegments=transformPreviewPath=null;overlayOffsetX=overlayOffsetY=0;
    if(!mask||mask.length!==width*height){clearSelection();return false;}
    selectionMask=new Uint8ClampedArray(mask);selectionWidth=width;selectionHeight=height;
    if(snapshot){selectionLayerIndex=snapshot.layerIndex;selectionFrameIndex=snapshot.frameIndex;}
    else{selectionLayerIndex=curLayer;selectionFrameIndex=(layers[curLayer]&&layers[curLayer].type==='smart-raster')?heldFrameIndex(layers[curLayer],curFrame):curFrame;}
    var count=rebuildMaskCanvasAndBounds();overlayVisible=true;if(count)scheduleOverlayRender();else renderSelection();
    window.dispatchEvent(new CustomEvent('pixel-selection-changed',{detail:{active:count>0,source:source||'selection-transform',mask:selectionMask.slice(),maskCanvas:maskCanvas,bounds:selectionBounds&&Object.assign({},selectionBounds),width:width,height:height,layerIndex:selectionLayerIndex,frameIndex:selectionFrameIndex}}));
    return count>0;
  }

  function captureSelection(){return selectionActive&&selectionMask?{mask:selectionMask.slice(),width:selectionWidth,height:selectionHeight,layerIndex:selectionLayerIndex,frameIndex:selectionFrameIndex}:null;}
  function restoreSelection(snapshot){if(!snapshot){clearSelection();return;}replaceCanonicalMask(snapshot.mask,snapshot.width,snapshot.height,'selection-history',snapshot);}

  function scopedSelectionState(){
    var state=window.pixelSelectionState;
    return selectionScopeMode!=='all'&&selectionActive&&state&&state.layerIndex===curLayer&&state.width===CW&&state.height===CH?state:null;
  }
  function selectionScopeAllowsPixel(pixel){
    var state=scopedSelectionState();if(!state)return true;
    return selectionScopeMode==='inside'?state.mask[pixel]===255:state.mask[pixel]!==255;
  }
  function clipCanvasToSelectionScope(source){
    var state=scopedSelectionState();if(!state||!source)return source;
    if(!selectionScopeCanvas){selectionScopeCanvas=document.createElement('canvas');selectionScopeContext=selectionScopeCanvas.getContext('2d');}
    if(selectionScopeCanvas.width!==state.width||selectionScopeCanvas.height!==state.height){selectionScopeCanvas.width=state.width;selectionScopeCanvas.height=state.height;}
    selectionScopeContext.clearRect(0,0,state.width,state.height);selectionScopeContext.globalCompositeOperation='source-over';selectionScopeContext.globalAlpha=1;selectionScopeContext.drawImage(source,0,0);
    selectionScopeContext.globalCompositeOperation=selectionScopeMode==='inside'?'destination-in':'destination-out';selectionScopeContext.drawImage(maskCanvas,0,0);selectionScopeContext.globalCompositeOperation='source-over';
    return selectionScopeCanvas;
  }
  function captureSelectionScopedArtwork(source){
    if(!scopedSelectionState()||!source)return null;
    var copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;copy.getContext('2d').drawImage(source,0,0);return copy;
  }
  function restoreSelectionScopeProtectedPixels(context,beforeCanvas){
    var state=scopedSelectionState();if(!state||!beforeCanvas)return false;
    var current=context.getImageData(0,0,state.width,state.height),before=beforeCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,state.width,state.height),mask=state.mask;
    for(var pixel=0,offset=0;pixel<mask.length;pixel++,offset+=4){var allowed=selectionScopeMode==='inside'?mask[pixel]===255:mask[pixel]!==255;if(allowed)continue;current.data[offset]=before.data[offset];current.data[offset+1]=before.data[offset+1];current.data[offset+2]=before.data[offset+2];current.data[offset+3]=before.data[offset+3];}
    context.putImageData(current,0,0);return true;
  }
  function setSelectionScope(mode){if(['all','inside','outside'].indexOf(mode)<0)return;selectionScopeMode=mode;try{localStorage.setItem('animate.selectionScope.v1',mode);}catch(_){}window.dispatchEvent(new CustomEvent('selection-scope-changed',{detail:{mode:mode}}));}

  document.addEventListener('keydown',function(event){
    if(window.LassoSelection&&LassoSelection.isActive())return;
    if(window.RectangleSelection&&RectangleSelection.isActive())return;
    if(window.EllipseSelection&&EllipseSelection.isActive())return;
    if(!selectionActive)return;var transformActive=typeof tfActive!=='undefined'&&tfActive;
    var target=event.target instanceof Element?event.target:null;
    if(target&&(target.isContentEditable||target.closest('input,textarea,[contenteditable="true"]')))return;
    if(event.key==='Escape'&&!transformActive){event.preventDefault();event.stopImmediatePropagation();clearSelection();return;}
    if(!transformActive&&(event.key==='Delete'||event.key==='Backspace'||(typeof matchBind==='function'&&matchBind(event,'clearFrame')))){
      event.preventDefault();event.stopImmediatePropagation();deleteSelectedPixels();
    }
  },true);

  window.addEventListener('canvas-view-transform-changed',scheduleOverlayRender);
  window.addEventListener('active-artwork-changed',function(){if(selectionActive)clearSelection();});
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(scheduleOverlayRender).observe(canvasArea);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)scheduleOverlayRender();});

  window.PixelSelection={isActive:function(){return selectionActive;},getState:function(){return window.pixelSelectionState;},applyMask:applyCanonicalMask,modeFromEvent:selectionModeFromEvent,clear:clearSelection,deleteSelected:deleteSelectedPixels,setOverlayVisible:setOverlayVisible,containsEvent:containsEvent,setOverlayOffset:setOverlayOffset,translate:translateSelection,setTransformPreview:setTransformPreview,clearTransformPreview:clearTransformPreview,replaceMask:replaceCanonicalMask,capture:captureSelection,restore:restoreSelection};
  window.SelectionScope={get:function(){return selectionScopeMode;},set:setSelectionScope,isRestricted:function(){return !!scopedSelectionState();},allowsPixel:selectionScopeAllowsPixel,clipCanvas:clipCanvasToSelectionScope,captureArtwork:captureSelectionScopedArtwork,restoreProtectedPixels:restoreSelectionScopeProtectedPixels};
  window.LinkedPixelSelection={handleStylePointer:handleStylePointer,handleCanvasPointer:handleCanvasPointer,selectStyle:selectLinkedPixels,replaceSelectedWithStyle:replaceSelectedWithStyle,getMask:function(){return selectionMask?selectionMask.slice():null;},getMaskCanvas:function(){return maskCanvas;},getBounds:function(){return selectionBounds&&Object.assign({},selectionBounds);},clear:clearSelection};
})();
