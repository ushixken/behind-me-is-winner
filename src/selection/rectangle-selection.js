(function(){
  'use strict';

  var active=false,pointerId=null,start=null,current=null,startClient=null,mode='replace';
  var preview=null;

  function ensurePreview(){
    if(preview||!window.EditorOverlayRenderer)return;
    preview=EditorOverlayRenderer.create('rectangle-selection-preview',{zIndex:7,draw:function(context,geometry){
      var r=rect();if(!active||!r||!r.w||!r.h)return;
      var p0=geometry.worldToScreen({x:r.x,y:r.y}),p1=geometry.worldToScreen({x:r.x+r.w,y:r.y}),p2=geometry.worldToScreen({x:r.x+r.w,y:r.y+r.h}),p3=geometry.worldToScreen({x:r.x,y:r.y+r.h});
      context.strokeStyle='#7f77dd';context.lineWidth=1.5;context.setLineDash([5,3]);context.beginPath();context.moveTo(p0.x,p0.y);context.lineTo(p1.x,p1.y);context.lineTo(p2.x,p2.y);context.lineTo(p3.x,p3.y);context.closePath();context.stroke();
    }});
  }  function rect(){if(!start||!current)return null;var x=Math.min(start.x,current.x),y=Math.min(start.y,current.y);return{x:x,y:y,w:Math.abs(current.x-start.x),h:Math.abs(current.y-start.y)};}
  function clearPreview(){if(preview)preview.setVisible(false);}
  function schedulePreview(){ensurePreview();if(preview){preview.setVisible(active);preview.invalidate();}}  function cancel(){
    if(!active)return false;var capturedId=pointerId;active=false;pointerId=null;start=null;current=null;startClient=null;
    clearPreview();if(activeC.hasPointerCapture&&activeC.hasPointerCapture(capturedId))activeC.releasePointerCapture(capturedId);return true;
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
    event.preventDefault();event.stopImmediatePropagation();ensurePreview();active=true;pointerId=event.pointerId;start=current=getPos(event);startClient={x:event.clientX,y:event.clientY};mode=window.SelectionToolSettings?SelectionToolSettings.modeFromEvent('rectangle-select',event):(window.PixelSelection?PixelSelection.modeFromEvent(event):'replace');activeC.setPointerCapture(event.pointerId);schedulePreview();
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
