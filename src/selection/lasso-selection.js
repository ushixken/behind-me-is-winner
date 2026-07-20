(function(){
  'use strict';
  var active=false,pointerId=null,points=[],mode='replace',preview=null,previewContext=null,previewRaf=0;
  function ensurePreview(){
    if(!preview){preview=document.createElement('canvas');preview.id='lasso-selection-preview';preview.setAttribute('aria-hidden','true');preview.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;z-index:4;';canvasArea.appendChild(preview);}
    var rect=canvasArea.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(preview.width!==w||preview.height!==h){preview.width=w;preview.height=h;}previewContext=preview.getContext('2d');return{dpr:dpr};
  }
  function clearPreview(){if(!previewContext||!preview)return;previewContext.setTransform(1,0,0,1,0,0);previewContext.clearRect(0,0,preview.width,preview.height);}
  function toScreen(p){
    var pivot=(flipX||flipY)?getNavPivot():{cx:0,cy:0},rad=rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),x=p.x*zoom,y=p.y*zoom;
    var sx=x*cos-y*sin+panX,sy=x*sin+y*cos+panY;if(flipX)sx=pivot.cx-(sx-pivot.cx);if(flipY)sy=pivot.cy-(sy-pivot.cy);return{x:sx,y:sy};
  }
  function drawPreview(){
    previewRaf=0;if(!active)return;var geometry=ensurePreview();clearPreview();if(points.length<2)return;
    var c=previewContext;c.setTransform(geometry.dpr,0,0,geometry.dpr,0,0);c.strokeStyle='#7f77dd';c.lineWidth=1.5;c.lineJoin='round';c.lineCap='round';c.setLineDash([5,3]);c.beginPath();
    var first=toScreen(points[0]);c.moveTo(first.x,first.y);for(var i=1;i<points.length;i++){var p=toScreen(points[i]);c.lineTo(p.x,p.y);}c.stroke();
  }
  function schedulePreview(){if(!previewRaf)previewRaf=requestAnimationFrame(drawPreview);}
  function cancel(){if(!active)return false;active=false;pointerId=null;points=[];if(previewRaf){cancelAnimationFrame(previewRaf);previewRaf=0;}clearPreview();if(preview)preview.style.display='none';return true;}
  function meaningfulArea(){if(points.length<3)return false;var twiceArea=0;for(var i=0,j=points.length-1;i<points.length;j=i++)twiceArea+=points[j].x*points[i].y-points[i].x*points[j].y;return Math.abs(twiceArea)>=8;}
  function pathBounds(padding){if(!points.length)return null;var minX=points[0].x,minY=points[0].y,maxX=minX,maxY=minY;for(var i=1;i<points.length;i++){var p=points[i];if(p.x<minX)minX=p.x;if(p.x>maxX)maxX=p.x;if(p.y<minY)minY=p.y;if(p.y>maxY)maxY=p.y;}return{x:Math.floor(minX-padding),y:Math.floor(minY-padding),w:Math.ceil(maxX-minX+padding*2),h:Math.ceil(maxY-minY+padding*2)};}
  function commit(){
    if(!meaningfulArea()){cancel();return;}var bounds=pathBounds(1),x=Math.max(0,bounds.x),y=Math.max(0,bounds.y),ex=Math.min(CW,bounds.x+bounds.w),ey=Math.min(CH,bounds.y+bounds.h);if(ex<=x||ey<=y){cancel();return;}
    var maskCanvas=document.createElement('canvas');maskCanvas.width=CW;maskCanvas.height=CH;var maskContext=maskCanvas.getContext('2d');maskContext.fillStyle='#fff';maskContext.beginPath();maskContext.moveTo(points[0].x,points[0].y);for(var i=1;i<points.length;i++)maskContext.lineTo(points[i].x,points[i].y);maskContext.closePath();maskContext.fill();
    var image=maskContext.getImageData(x,y,ex-x,ey-y).data,incoming=new Uint8ClampedArray(CW*CH),width=ex-x,height=ey-y;for(var row=0;row<height;row++)for(var col=0;col<width;col++)if(image[(row*width+col)*4+3]>0)incoming[(y+row)*CW+x+col]=255;
    var selectedMode=mode;cancel();if(window.PixelSelection)PixelSelection.applyMask(incoming,CW,CH,selectedMode,'lasso');
  }
  function pointerDown(event){if(tool!=='lasso'||activeGroupId||panning||spaceHeld)return;if(event.pointerType==='mouse'?event.button!==0:(!(event.buttons&1)&&event.pointerType!=='touch'))return;event.preventDefault();event.stopImmediatePropagation();ensurePreview();preview.style.display='block';active=true;pointerId=event.pointerId;points=[getPos(event)];mode=window.SelectionToolSettings?SelectionToolSettings.modeFromEvent('lasso-select',event):(window.PixelSelection?PixelSelection.modeFromEvent(event):'replace');activeC.setPointerCapture(event.pointerId);schedulePreview();}
  function pointerMove(event){if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();var p=getPos(event),last=points[points.length-1];if(Math.hypot(p.x-last.x,p.y-last.y)>=1){points.push(p);schedulePreview();}}
  function pointerEnd(event){if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(activeC.hasPointerCapture&&activeC.hasPointerCapture(pointerId))activeC.releasePointerCapture(pointerId);if(event.type==='pointercancel')cancel();else commit();}
  activeC.addEventListener('pointerdown',pointerDown,true);activeC.addEventListener('pointermove',pointerMove,true);activeC.addEventListener('pointerup',pointerEnd,true);activeC.addEventListener('pointercancel',pointerEnd,true);
  window.addEventListener('canvas-view-transform-changed',function(){if(active)schedulePreview();});window.addEventListener('resize',function(){if(active)schedulePreview();});
  document.addEventListener('keydown',function(event){if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}},true);window.LassoSelection={cancel:cancel,isActive:function(){return active;}};
})();
