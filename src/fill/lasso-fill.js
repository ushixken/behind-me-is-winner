(function(){
  'use strict';
  var active=false,pointerId=null,points=[],preview=null,previewContext=null,previewRaf=0;
  function ensurePreview(){
    if(!preview){preview=document.createElement('canvas');preview.id='lasso-fill-preview';preview.setAttribute('aria-hidden','true');preview.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;z-index:4;';canvasArea.appendChild(preview);}
    var rect=canvasArea.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1),width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(preview.width!==width||preview.height!==height){preview.width=width;preview.height=height;}previewContext=preview.getContext('2d');return{dpr:dpr};
  }
  function clearPreview(){if(previewContext&&preview){previewContext.setTransform(1,0,0,1,0,0);previewContext.clearRect(0,0,preview.width,preview.height);}}
  function toScreen(point){var pivot=(flipX||flipY)?getNavPivot():{cx:0,cy:0},rad=rotation*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),x=point.x*zoom,y=point.y*zoom,sx=x*cos-y*sin+panX,sy=x*sin+y*cos+panY;if(flipX)sx=pivot.cx-(sx-pivot.cx);if(flipY)sy=pivot.cy-(sy-pivot.cy);return{x:sx,y:sy};}
  function drawPreview(){previewRaf=0;if(!active)return;var geometry=ensurePreview();clearPreview();if(points.length<2)return;var c=previewContext;c.setTransform(geometry.dpr,0,0,geometry.dpr,0,0);c.strokeStyle='#7f77dd';c.lineWidth=1.5;c.lineJoin='round';c.lineCap='round';c.setLineDash([5,3]);c.beginPath();var first=toScreen(points[0]);c.moveTo(first.x,first.y);for(var i=1;i<points.length;i++){var point=toScreen(points[i]);c.lineTo(point.x,point.y);}c.stroke();}
  function schedulePreview(){if(!previewRaf)previewRaf=requestAnimationFrame(drawPreview);}
  function cancel(){if(!active)return false;active=false;pointerId=null;points=[];if(previewRaf){cancelAnimationFrame(previewRaf);previewRaf=0;}clearPreview();if(preview)preview.style.display='none';return true;}
  function bounds(){if(!points.length)return null;var minX=points[0].x,minY=points[0].y,maxX=minX,maxY=minY;for(var i=1;i<points.length;i++){var p=points[i];if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y;}var x=Math.max(0,Math.floor(minX-1)),y=Math.max(0,Math.floor(minY-1)),ex=Math.min(CW,Math.ceil(maxX+1)),ey=Math.min(CH,Math.ceil(maxY+1));return{x:x,y:y,w:Math.max(0,ex-x),h:Math.max(0,ey-y)};}
  function meaningful(){if(points.length<3)return false;var rect=bounds();return !!(rect&&rect.w>=2&&rect.h>=2);}
  function commit(){
    if(!meaningful()){cancel();return;}var rect=bounds();if(!rect||!rect.w||!rect.h){cancel();return;}
    // Preserve the original floating-point geometry through rasterization.
    var path=points.map(function(point){return{x:point.x,y:point.y};});cancel();if(window.FillMaskEngine)FillMaskEngine.applyPolygon(path,rect,{source:'lasso-fill'});
  }
  function pointerDown(event){if(tool!=='lasso-fill'||activeGroupId||panning||spaceHeld)return;if(event.pointerType==='mouse'?event.button!==0:(!(event.buttons&1)&&event.pointerType!=='touch'))return;event.preventDefault();event.stopImmediatePropagation();ensurePreview();preview.style.display='block';active=true;pointerId=event.pointerId;points=[getPos(event)];activeC.setPointerCapture(event.pointerId);schedulePreview();}
  function pointerMove(event){if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();var p=getPos(event),last=points[points.length-1];if(Math.hypot(p.x-last.x,p.y-last.y)>=1){points.push(p);schedulePreview();}}
  function pointerEnd(event){if(!active||event.pointerId!==pointerId)return;event.preventDefault();event.stopImmediatePropagation();if(activeC.hasPointerCapture&&activeC.hasPointerCapture(pointerId))activeC.releasePointerCapture(pointerId);if(event.type==='pointercancel')cancel();else commit();}
  activeC.addEventListener('pointerdown',pointerDown,true);activeC.addEventListener('pointermove',pointerMove,true);activeC.addEventListener('pointerup',pointerEnd,true);activeC.addEventListener('pointercancel',pointerEnd,true);
  window.addEventListener('canvas-view-transform-changed',function(){if(active)schedulePreview();});window.addEventListener('resize',function(){if(active)schedulePreview();});document.addEventListener('keydown',function(event){if(active&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}},true);
  window.LassoFill={cancel:cancel,isActive:function(){return active;}};
})();
