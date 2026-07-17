(function(){
  'use strict';

  var active=false,pointerId=null,start=null,current=null,startClient=null,mode='replace';
  var preview=null,previewContext=null,previewRaf=0,previousBounds=null;

  function ensurePreview(){
    if(!preview){preview=document.createElement('canvas');preview.id='rectangle-selection-preview';preview.style.cssText='position:absolute;left:0;top:0;display:none;pointer-events:none;z-index:7;';document.getElementById('canvas-wrap').appendChild(preview);}
    if(preview.width!==CW||preview.height!==CH){preview.width=CW;preview.height=CH;previewContext=preview.getContext('2d');}
  }
  function rect(){if(!start||!current)return null;var x=Math.min(start.x,current.x),y=Math.min(start.y,current.y);return{x:x,y:y,w:Math.abs(current.x-start.x),h:Math.abs(current.y-start.y)};}
  function clearPreview(){if(previewContext&&previousBounds)previewContext.clearRect(previousBounds.x,previousBounds.y,previousBounds.w,previousBounds.h);previousBounds=null;}
  function drawPreview(){
    previewRaf=0;if(!active)return;ensurePreview();clearPreview();var r=rect();if(!r||!r.w||!r.h)return;
    var pad=4/Math.max(.0001,zoom);previousBounds={x:Math.floor(r.x-pad),y:Math.floor(r.y-pad),w:Math.ceil(r.w+pad*2),h:Math.ceil(r.h+pad*2)};
    previewContext.save();previewContext.strokeStyle='#7f77dd';previewContext.lineWidth=Math.max(1,1/Math.max(.0001,zoom));previewContext.setLineDash([5/Math.max(.0001,zoom),3/Math.max(.0001,zoom)]);previewContext.strokeRect(r.x,r.y,r.w,r.h);previewContext.restore();
  }
  function schedulePreview(){if(!previewRaf)previewRaf=requestAnimationFrame(drawPreview);}
  function cancel(){
    if(!active)return false;var capturedId=pointerId;active=false;pointerId=null;start=null;current=null;startClient=null;
    if(previewRaf){cancelAnimationFrame(previewRaf);previewRaf=0;}clearPreview();if(preview)preview.style.display='none';if(activeC.hasPointerCapture&&activeC.hasPointerCapture(capturedId))activeC.releasePointerCapture(capturedId);return true;
  }
  function meaningful(event){return startClient&&Math.abs(event.clientX-startClient.x)>=3&&Math.abs(event.clientY-startClient.y)>=3;}
  function commit(event){
    if(!meaningful(event)){cancel();return;}var r=rect(),x0=Math.max(0,Math.floor(r.x)),y0=Math.max(0,Math.floor(r.y)),x1=Math.min(CW,Math.ceil(r.x+r.w)),y1=Math.min(CH,Math.ceil(r.y+r.h));
    if(x1<=x0||y1<=y0){cancel();return;}var incoming=new Uint8ClampedArray(CW*CH);for(var y=y0;y<y1;y++)incoming.fill(255,y*CW+x0,y*CW+x1);
    var selectedMode=mode;cancel();if(window.PixelSelection)PixelSelection.applyMask(incoming,CW,CH,selectedMode,'rectangle');
  }
  function pointerDown(event){
    if(tool!=='rectangle-select'||activeGroupId||panning||spaceHeld)return;
    if(event.pointerType==='mouse'?event.button!==0:(!(event.buttons&1)&&event.pointerType!=='touch'))return;
    event.preventDefault();event.stopImmediatePropagation();ensurePreview();preview.style.display='block';active=true;pointerId=event.pointerId;start=current=getPos(event);startClient={x:event.clientX,y:event.clientY};mode=window.SelectionToolSettings?SelectionToolSettings.modeFromEvent('rectangle-select',event):(window.PixelSelection?PixelSelection.modeFromEvent(event):'replace');previousBounds=null;activeC.setPointerCapture(event.pointerId);schedulePreview();
  }
  function pointerMove(event){if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();current=getPos(event);schedulePreview();}
  function pointerEnd(event){
    if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();var capturedId=pointerId;if(event.type==='pointercancel')cancel();else{current=getPos(event);commit(event);}if(activeC.hasPointerCapture&&activeC.hasPointerCapture(capturedId))activeC.releasePointerCapture(capturedId);
  }
  activeC.addEventListener('pointerdown',pointerDown,true);activeC.addEventListener('pointermove',pointerMove,true);activeC.addEventListener('pointerup',pointerEnd,true);activeC.addEventListener('pointercancel',pointerEnd,true);
  activeC.addEventListener('lostpointercapture',function(event){if(active&&event.pointerId===pointerId)cancel();},true);
  document.addEventListener('keydown',function(event){if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();var capturedId=pointerId;cancel();if(activeC.hasPointerCapture&&activeC.hasPointerCapture(capturedId))activeC.releasePointerCapture(capturedId);}},true);
  window.addEventListener('tool-changed',function(event){if(active&&event.detail&&event.detail.tool!=='rectangle-select')cancel();});
  window.RectangleSelection={cancel:cancel,isActive:function(){return active;}};
})();
