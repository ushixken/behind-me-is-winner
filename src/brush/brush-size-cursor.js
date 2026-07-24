// Persistent paint-tool cursor overlay. Native pen cursors can disappear while
// Pointer Capture is active, so Brush and Eraser use this overlay for every
// cursor preference. Other tools retain their existing native/transform cursors.
(function(){
  const cursorCanvas=document.createElement('canvas');
  cursorCanvas.id='brush-cursor-overlay';
  Object.assign(cursorCanvas.style,{
    position:'fixed',left:'0',top:'0',width:'1px',height:'1px',pointerEvents:'none',
    zIndex:'9998',display:'none',transform:'translate(-50%,-50%)'
  });
  document.body.appendChild(cursorCanvas);
  const ctx=cursorCanvas.getContext('2d');
  const previewCanvas=document.createElement('canvas');
  const previewCtx=previewCanvas.getContext('2d');
  let hovering=false,lastX=0,lastY=0,lastPointerType='mouse',lastSignature='';

  function paintTool(){return tool==='brush'||tool==='eraser';}
  function strokeActive(){return typeof drawing!=='undefined'&&drawing&&paintTool();}
  function shouldShow(){
    return paintTool()&&(hovering||strokeActive())&&!activeGroupId&&!panning&&!_zoomDrag&&!_rotateDrag&&!spaceHeld&&!window._brushResizePreviewActive;
  }
  function setPosition(){cursorCanvas.style.left=lastX+'px';cursorCanvas.style.top=lastY+'px';}
  function prepare(cssSize){
    const dpr=Math.max(1,window.devicePixelRatio||1),size=Math.max(1,Math.ceil(cssSize));
    const pixels=Math.max(1,Math.ceil(size*dpr));
    if(cursorCanvas.width!==pixels||cursorCanvas.height!==pixels){cursorCanvas.width=pixels;cursorCanvas.height=pixels;}
    cursorCanvas.style.width=size+'px';cursorCanvas.style.height=size+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,size,size);
    return size;
  }
  // Single thin grey ring — no double-stroke halo.
  function contrastStroke(path,width){
    ctx.save();ctx.lineCap='butt';ctx.lineJoin='round';
    ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineWidth=width;ctx.stroke(path);ctx.restore();
  }
  function drawPoint(){
    const size=7,c=size/2;prepare(size);ctx.beginPath();ctx.arc(c,c,1.25,0,Math.PI*2);ctx.fillStyle='rgba(30,30,30,0.9)';ctx.fill();
  }
  function drawCross(){
    const size=9,c=size/2;prepare(size);ctx.beginPath();
    ctx.moveTo(c,1.5);ctx.lineTo(c,7.5);ctx.moveTo(1.5,c);ctx.lineTo(7.5,c);
    ctx.strokeStyle='rgba(30,30,30,0.9)';ctx.lineWidth=1;ctx.lineCap='butt';ctx.stroke();
  }
  function brushDiameter(){return Math.max(1,(toolSizes[tool]||6)*zoom);}
  function drawCircle(){
    const diameter=brushDiameter(),size=Math.max(7,Math.ceil(diameter+6)),c=size/2,r=Math.max(2,diameter/2);
    prepare(size);const path=new Path2D();path.arc(c,c,r,0,Math.PI*2);contrastStroke(path,1);
    // Center crosshair so the exact pointer position stays visible alongside the size ring.
    ctx.save();ctx.beginPath();
    ctx.moveTo(c,c-3);ctx.lineTo(c,c+3);ctx.moveTo(c-3,c);ctx.lineTo(c+3,c);
    ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineWidth=1;ctx.lineCap='butt';ctx.stroke();ctx.restore();
  }
  function drawShape(){
    const diameter=brushDiameter(),tip=window.brushTipCanvas,roundness=Math.max(.01,Math.min(1,window.brushTipRoundness==null?1:window.brushTipRoundness));
    const liveRotation=strokeActive()&&typeof _activeDabRotation!=='undefined'?_activeDabRotation:null;
    const angle=Number.isFinite(liveRotation)?liveRotation:((Number(window._tsBrushAngle)||0)*Math.PI)/180;
    if(!tip||!tip.width||!tip.height){
      const w=diameter,h=diameter*roundness,cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle));
      const size=Math.max(7,Math.ceil(Math.max(w*cos+h*sin,w*sin+h*cos)+6)),c=size/2;
      prepare(size);ctx.save();ctx.translate(c,c);ctx.rotate(angle);ctx.scale(1,roundness);const path=new Path2D();path.arc(0,0,Math.max(2,diameter/2),0,Math.PI*2);ctx.restore();
      // Stroke the transformed ellipse explicitly because Path2D retains its coordinates.
      ctx.save();ctx.translate(c,c);ctx.rotate(angle);ctx.scale(1,roundness);
      ctx.strokeStyle='rgba(110,110,110,0.85)';ctx.lineWidth=1/Math.max(roundness,.2);ctx.stroke(path);ctx.restore();return;
    }
    const nativeW=tip.width||1,nativeH=tip.height||1,scale=diameter/Math.max(nativeW,nativeH);
    const compressWidth=nativeW<nativeH,w=nativeW*scale*(compressWidth?roundness:1),h=nativeH*scale*(compressWidth?1:roundness);
    const cos=Math.abs(Math.cos(angle)),sin=Math.abs(Math.sin(angle)),bound=Math.max(w*cos+h*sin,w*sin+h*cos);
    const size=Math.max(9,Math.ceil(bound+8)),c=size/2,dpr=Math.max(1,window.devicePixelRatio||1);
    prepare(size);
    const pw=Math.max(1,Math.ceil(size*dpr));
    if(previewCanvas.width!==pw||previewCanvas.height!==pw){previewCanvas.width=pw;previewCanvas.height=pw;}
    previewCtx.setTransform(dpr,0,0,dpr,0,0);previewCtx.clearRect(0,0,size,size);previewCtx.save();previewCtx.translate(c,c);previewCtx.rotate(angle);
    previewCtx.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);previewCtx.drawImage(tip,-w/2,-h/2,w,h);previewCtx.restore();
    ctx.save();ctx.drawImage(previewCanvas,0,0,pw,pw,0,0,size,size);ctx.globalCompositeOperation='source-in';ctx.fillStyle='rgba(255,255,255,.82)';ctx.fillRect(0,0,size,size);ctx.globalCompositeOperation='destination-over';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;ctx.drawImage(previewCanvas,0,0,pw,pw,0,0,size,size);ctx.restore();
  }
  function signature(){
    const tip=window.brushTipCanvas;
    return [cursorStyle,tool,toolSizes[tool]||6,zoom,window.brushTipVersion||0,tip&&tip.width,tip&&tip.height,window.brushTipRoundness,window._tsBrushAngle,strokeActive()&&typeof _activeDabRotation!=='undefined'?_activeDabRotation:'idle',!!window.brushTipFlipX,!!window.brushTipFlipY,lastPointerType].join('|');
  }
  function update(force){
    if(!shouldShow()){cursorCanvas.style.display='none';lastSignature='';return;}
    setPosition();const next=signature();
    // No difference blend mode needed — cross/point are now dark, circle is grey.
    cursorCanvas.style.mixBlendMode='normal';
    if(force||next!==lastSignature){
      // Eraser always shows the circle regardless of cursor style pref.
      if(tool==='eraser')  drawCircle();
      else if(cursorStyle==='point')drawPoint();
      else if(cursorStyle==='crosshair')drawCross();
      else if(cursorStyle==='brush-shape')drawShape();
      else drawCircle();
      lastSignature=next;
    }
    cursorCanvas.style.display='block';
  }
  function track(event){
    const active=strokeActive(),target=event.target;
    const inCanvas=!!(target&&(target===canvasArea||canvasArea.contains(target)));
    if(!active&&!inCanvas)return;
    hovering=inCanvas||active;lastX=event.clientX;lastY=event.clientY;lastPointerType=event.pointerType||lastPointerType;update(false);
  }
  canvasArea.addEventListener('pointerenter',track,true);
  window.addEventListener('pointermove',track,true);
  canvasArea.addEventListener('pointerleave',()=>{hovering=false;if(!strokeActive())cursorCanvas.style.display='none';});
  window.addEventListener('pointerup',event=>{lastX=event.clientX;lastY=event.clientY;hovering=!!document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#canvas-area');update(true);},true);
  window.addEventListener('pointercancel',()=>{hovering=false;cursorCanvas.style.display='none';},true);
  window.addEventListener('blur',()=>{hovering=false;cursorCanvas.style.display='none';});
  window.addEventListener('tool-changed',()=>update(true));
  window.addEventListener('brush-resize-preview-toggle',()=>update(true));
  (function loop(){update(false);requestAnimationFrame(loop);})();
})();