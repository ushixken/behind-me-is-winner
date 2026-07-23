(function(){
  'use strict';

  var gesture=null,lastHoverEvent=null,cursorApplied=false;
  var DRAG_THRESHOLD=4;

  function primary(event){return event.pointerType!=='mouse'||event.button===0;}
  function modifier(event){return !!(event.ctrlKey||event.metaKey);}
  function available(){return window.PixelSelection&&PixelSelection.isActive();}
  function setMoveCursor(on){
    if(on===cursorApplied)return;
    cursorApplied=on;
    if(on){canvasArea.style.cursor='move';activeC.style.cursor='move';}
    else{canvasArea.style.cursor='';if(typeof _refreshActiveCursor==='function')_refreshActiveCursor();}
  }
  function updateHover(event){
    lastHoverEvent=event;
    setMoveCursor(!!(available()&&modifier(event)&&PixelSelection.containsEvent(event)));
  }
  function capture(event){try{activeC.setPointerCapture(event.pointerId);}catch(_){} }
  function release(pointerId){try{if(activeC.hasPointerCapture(pointerId))activeC.releasePointerCapture(pointerId);}catch(_){} }
  function cleanup(){if(!gesture)return;var pointerId=gesture.pointerId;gesture=null;release(pointerId);setMoveCursor(false);}

  function pointerDown(event){
    if(!primary(event)||!modifier(event)||!available())return;
    var point=getPos(event),inside=PixelSelection.containsEvent(event);
    gesture={pointerId:event.pointerId,startX:point.x,startY:point.y,startClientX:event.clientX,startClientY:event.clientY,inside:inside,started:false,dragged:false,lastX:point.x,lastY:point.y};
    capture(event);event.preventDefault();event.stopImmediatePropagation();
    if(inside)setMoveCursor(true);
  }
  function pointerMove(event){
    if(!gesture){updateHover(event);return;}
    if(event.pointerId!==gesture.pointerId)return;
    var point=getPos(event);gesture.lastX=point.x;gesture.lastY=point.y;
    var distance=Math.hypot(event.clientX-gesture.startClientX,event.clientY-gesture.startClientY);
    if(distance>=DRAG_THRESHOLD)gesture.dragged=true;
    if(gesture.dragged&&gesture.inside&&!gesture.started)gesture.started=true;
    if(gesture.started)PixelSelection.setOverlayOffset(point.x-gesture.startX,point.y-gesture.startY);
    event.preventDefault();event.stopImmediatePropagation();
  }
  function pointerUp(event){
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    var current=gesture;
    if(current.started){
      var point=getPos(event);PixelSelection.translate(point.x-current.startX,point.y-current.startY);
    }else if(!current.dragged&&window.LinkedPixelSelection&&LinkedPixelSelection.handleCanvasPointer){
      LinkedPixelSelection.handleCanvasPointer(event,true);
    }
    event.preventDefault();event.stopImmediatePropagation();cleanup();
  }
  function cancel(event){
    if(!gesture||(event.pointerId!==undefined&&event.pointerId!==gesture.pointerId))return;
    if(gesture.started)PixelSelection.setOverlayOffset(0,0);cleanup();
    if(event.preventDefault)event.preventDefault();
  }

  canvasArea.addEventListener('pointerdown',pointerDown,true);
  canvasArea.addEventListener('pointermove',pointerMove,true);
  canvasArea.addEventListener('pointerup',pointerUp,true);
  canvasArea.addEventListener('pointercancel',cancel,true);
  activeC.addEventListener('lostpointercapture',cancel);
  canvasArea.addEventListener('pointerleave',function(){if(!gesture)setMoveCursor(false);});
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&gesture){event.preventDefault();event.stopImmediatePropagation();cancel(event);return;}
    if((event.key==='Control'||event.key==='Meta')&&lastHoverEvent)updateHover({clientX:lastHoverEvent.clientX,clientY:lastHoverEvent.clientY,ctrlKey:event.ctrlKey||event.key==='Control',metaKey:event.metaKey||event.key==='Meta'});
  },true);
  document.addEventListener('keyup',function(event){if(event.key==='Control'||event.key==='Meta')setMoveCursor(false);},true);
  window.addEventListener('blur',function(){if(gesture)cancel({});else setMoveCursor(false);});
  window.addEventListener('tool-changed',function(){if(gesture)cancel({});lastHoverEvent=null;setMoveCursor(false);});
})();
