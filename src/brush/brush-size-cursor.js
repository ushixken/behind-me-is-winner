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
  let latestPointerTime=-Infinity,cursorRaf=0;
  let latestSourceEventType='',latestSourceEventTime=-Infinity;
  if(typeof window.BrushCursorDebugTracking==='undefined')window.BrushCursorDebugTracking=false;
  if(!Array.isArray(window.BrushCursorTrackingLog))window.BrushCursorTrackingLog=[];
  if(typeof window.BrushCursorDebugNativeFlash==='undefined')window.BrushCursorDebugNativeFlash=false;
  if(!Array.isArray(window.BrushCursorNativeFlashLog))window.BrushCursorNativeFlashLog=[];

  function cursorElementId(element){return element?(element.id||element.tagName||null):null;}
  function nativeFlashRecord(event,eventType,extra){
    if(!window.BrushCursorDebugNativeFlash)return;
    let hit=null,activeComputed=null,bodyComputed=null,capture=null;
    try{if(event&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY))hit=document.elementFromPoint(event.clientX,event.clientY);}catch(_){}
    try{activeComputed=activeC?getComputedStyle(activeC).cursor:null;}catch(_){}
    try{bodyComputed=getComputedStyle(document.body).cursor;}catch(_){}
    try{capture=!!(event&&event.pointerId!=null&&activeC&&activeC.hasPointerCapture&&activeC.hasPointerCapture(event.pointerId));}catch(_){}
    const entry=Object.assign({
      time:performance.now(),eventType:eventType||(event&&event.type)||'cursor-state',pointerType:event&&event.pointerType||null,
      pointerId:event&&event.pointerId!=null?event.pointerId:null,clientX:event&&Number.isFinite(event.clientX)?event.clientX:null,
      clientY:event&&Number.isFinite(event.clientY)?event.clientY:null,targetId:cursorElementId(event&&event.target),
      currentTargetId:cursorElementId(event&&event.currentTarget),elementFromPointId:cursorElementId(hit),
      elementFromPointInCanvasStack:!!(hit&&canvasArea&&(hit===canvasArea||canvasArea.contains(hit))),
      activeCanvasCursorInline:activeC&&activeC.style?activeC.style.cursor:null,activeCanvasCursorComputed:activeComputed,
      bodyCursorComputed:bodyComputed,customCursorVisible:cursorCanvas.style.display!=='none',pointerCapture:capture,
      inStroke:typeof _inStroke!=='undefined'&&!!_inStroke,hardRoundStrokeActive:typeof _hardRoundStrokeActive!=='undefined'&&!!_hardRoundStrokeActive,
    },extra||{});
    const log=window.BrushCursorNativeFlashLog;log.push(entry);if(log.length>200)log.splice(0,log.length-200);
  }
  window.BrushCursorNativeFlashNoteWrite=function(element,value,source){
    nativeFlashRecord(null,'cursor-style-write',{writeTargetId:cursorElementId(element),writtenCursor:value==null?null:String(value),writeSource:source||null});
  };
  window.BrushCursorAnalyzeNativeFlash=function(){
    const log=Array.isArray(window.BrushCursorNativeFlashLog)?window.BrushCursorNativeFlashLog:[],writes=log.filter(e=>e.eventType==='cursor-style-write');
    const nonCanvasTargets=log.filter(e=>e.elementFromPointId&&!e.elementFromPointInCanvasStack);
    const nonNoneCursor=log.filter(e=>e.activeCanvasCursorComputed&&e.activeCanvasCursorComputed!=='none');
    const captureDrops=[];for(let i=1;i<log.length;i++)if(log[i-1].pointerCapture===true&&log[i].pointerCapture===false)captureDrops.push(log[i]);
    const hiddenWithNative=log.filter(e=>!e.customCursorVisible&&e.activeCanvasCursorComputed&&e.activeCanvasCursorComputed!=='none');
    const unexplainedPaintMissCandidates=log.filter(e=>!e.customCursorVisible&&e.activeCanvasCursorComputed==='none'&&e.elementFromPointInCanvasStack);
    return {count:log.length,nonCanvasTargetCount:nonCanvasTargets.length,firstNonCanvasTarget:nonCanvasTargets[0]||null,
      nonNoneCursorCount:nonNoneCursor.length,firstNonNoneCursor:nonNoneCursor[0]||null,captureDropCount:captureDrops.length,
      firstCaptureDrop:captureDrops[0]||null,customHiddenWithNativeCount:hiddenWithNative.length,firstCustomHiddenWithNative:hiddenWithNative[0]||null,
      explicitWrites:writes,unexplainedPaintMissCandidateCount:unexplainedPaintMissCandidates.length,
      firstUnexplainedPaintMissCandidate:unexplainedPaintMissCandidates[0]||null,log:log.slice()};
  };

  function setCustomCursorVisible(visible,reason,event){
    const next=visible?'block':'none';if(cursorCanvas.style.display===next)return;
    cursorCanvas.style.display=next;nativeFlashRecord(event,'custom-cursor-visibility',{visible:!!visible,reason:reason||null});
  }

  function pointerCaptured(event){
    try{return !!(event&&event.target&&event.target.hasPointerCapture&&event.target.hasPointerCapture(event.pointerId));}catch(_){return false;}
  }
  function trace(event,accepted,rejectionReason,override){
    if(!window.BrushCursorDebugTracking)return;
    const entry=Object.assign({
      type:event&&event.type||'cursor-event',pointerType:event&&event.pointerType||'',pointerId:event&&event.pointerId,
      buttons:event&&event.buttons,button:event&&event.button,clientX:event&&event.clientX,clientY:event&&event.clientY,
      eventTimestamp:event&&Number.isFinite(event.timeStamp)?event.timeStamp:null,performanceTimestamp:performance.now(),
      accepted:!!accepted,rejectionReason:rejectionReason||'',rafPending:!!cursorRaf,cursorX:lastX,cursorY:lastY,
      pointerCapture:pointerCaptured(event)
    },override||{});
    const log=window.BrushCursorTrackingLog;log.push(entry);if(log.length>100)log.splice(0,log.length-100);
  }
  window.BrushCursorAnalyzeTracking=function(){
    const log=Array.isArray(window.BrushCursorTrackingLog)?window.BrushCursorTrackingLog:[];
    const rejected=log.filter(entry=>entry.accepted===false);
    const byReason={};rejected.forEach(entry=>{const reason=entry.rejectionReason||'unknown';byReason[reason]=(byReason[reason]||0)+1;});
    return {count:log.length,acceptedCount:log.filter(entry=>entry.accepted===true).length,rejectedCount:rejected.length,rejectionsByReason:byReason,firstEntry:log[0]||null,lastEntry:log[log.length-1]||null,log:log.slice()};
  };

  function paintTool(){return tool==='brush'||tool==='eraser';}
  function strokeActive(){return typeof drawing!=='undefined'&&drawing&&paintTool();}
  function shouldShow(){
    const transformActive=(typeof tool!=='undefined'&&tool==='transform')||(typeof window.LightTable!=='undefined'&&window.LightTable.transformMode);
    return paintTool()&&(hovering||strokeActive())&&!activeGroupId&&!panning&&!_zoomDrag&&!_rotateDrag&&!spaceHeld&&!window._brushResizePreviewActive&&!transformActive;
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
  function drawCenterDot(c){
    ctx.save();ctx.beginPath();ctx.arc(c,c,1.25,0,Math.PI*2);
    ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle='rgba(0,0,0,.72)';ctx.lineWidth=.75;ctx.stroke();ctx.restore();
  }
  function drawPoint(){
    const size=7,c=size/2;prepare(size);drawCenterDot(c);
  }
  function drawCross(){
    const size=9,c=size/2;prepare(size);ctx.beginPath();
    ctx.moveTo(c,1.5);ctx.lineTo(c,7.5);ctx.moveTo(1.5,c);ctx.lineTo(7.5,c);
    ctx.strokeStyle='rgba(30,30,30,0.9)';ctx.lineWidth=1;ctx.lineCap='butt';ctx.stroke();
    drawCenterDot(c);
  }
  function brushDiameter(){return Math.max(1,(toolSizes[tool]||6)*zoom);}
  function drawCircle(){
    const diameter=brushDiameter(),size=Math.max(7,Math.ceil(diameter+6)),c=size/2,r=Math.max(2,diameter/2);
    prepare(size);const path=new Path2D();path.arc(c,c,r,0,Math.PI*2);contrastStroke(path,1);
    // Center crosshair so the exact pointer position stays visible alongside the size ring.
    ctx.save();ctx.beginPath();
    ctx.moveTo(c,c-3);ctx.lineTo(c,c+3);ctx.moveTo(c-3,c);ctx.lineTo(c+3,c);
    ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineWidth=1;ctx.lineCap='butt';ctx.stroke();ctx.restore();drawCenterDot(c);
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
      ctx.strokeStyle='rgba(110,110,110,0.85)';ctx.lineWidth=1/Math.max(roundness,.2);ctx.stroke(path);ctx.restore();drawCenterDot(c);return;
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
    ctx.save();ctx.drawImage(previewCanvas,0,0,pw,pw,0,0,size,size);ctx.globalCompositeOperation='source-in';ctx.fillStyle='rgba(255,255,255,.82)';ctx.fillRect(0,0,size,size);ctx.globalCompositeOperation='destination-over';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;ctx.drawImage(previewCanvas,0,0,pw,pw,0,0,size,size);ctx.restore();drawCenterDot(c);
  }
  function signature(){
    const tip=window.brushTipCanvas;
    return [cursorStyle,tool,toolSizes[tool]||6,zoom,window.brushTipVersion||0,tip&&tip.width,tip&&tip.height,window.brushTipRoundness,window._tsBrushAngle,strokeActive()&&typeof _activeDabRotation!=='undefined'?_activeDabRotation:'idle',!!window.brushTipFlipX,!!window.brushTipFlipY,lastPointerType].join('|');
  }
  function update(force){
    if(!shouldShow()){setCustomCursorVisible(false,'shouldShow-false');lastSignature='';return;}
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
    setCustomCursorVisible(true,'cursor-update');
  }
  function track(event){
    nativeFlashRecord(event,event.type);
    if(window.HardRoundSmartPointerupTimingNote)window.HardRoundSmartPointerupTimingNote('pen-event',event);
    const active=strokeActive(),target=event.target;
    const inCanvas=!!(target&&(target===canvasArea||canvasArea.contains(target)));
    if(!active&&!inCanvas){trace(event,false,'outside-canvas-and-no-stroke');return;}
    const eventTime=Number.isFinite(event.timeStamp)?event.timeStamp:performance.now();
    if(eventTime<latestPointerTime){trace(event,false,'timestamp-older-than-latest',{latestPointerTime});return;}
    latestPointerTime=eventTime;latestSourceEventType=event.type;latestSourceEventTime=eventTime;hovering=inCanvas||active;lastX=event.clientX;lastY=event.clientY;lastPointerType=event.pointerType||lastPointerType;
    trace(event,true,'',{latestPointerTime});
    if(!cursorRaf)cursorRaf=requestAnimationFrame(()=>{cursorRaf=0;update(false);nativeFlashRecord(event,'cursor-raf-apply',{sourceEventType:latestSourceEventType,sourceEventTimestamp:latestSourceEventTime});if(window.HardRoundSmartPointerupTimingNote)window.HardRoundSmartPointerupTimingNote('cursor-apply',{x:lastX,y:lastY,sourceEventType:latestSourceEventType,sourceEventTimestamp:latestSourceEventTime});trace(null,true,'',{type:'cursor-raf-apply',x:lastX,y:lastY,sourceEventType:latestSourceEventType,sourceEventTimestamp:latestSourceEventTime,rafPending:false,cursorX:lastX,cursorY:lastY});});
  }
  canvasArea.addEventListener('pointerenter',track,true);
  window.addEventListener('pointermove',track,true);
  window.addEventListener('pointerrawupdate',track,true);
  canvasArea.addEventListener('pointerleave',event=>{nativeFlashRecord(event,'pointerleave');hovering=false;trace(event,true,'');if(!strokeActive())setCustomCursorVisible(false,'pointerleave',event);});
  window.addEventListener('pointerdown',event=>trace(event,true,''),true);
  window.addEventListener('pointerup',event=>{nativeFlashRecord(event,'pointerup');const eventTime=Number.isFinite(event.timeStamp)?event.timeStamp:performance.now();latestPointerTime=Math.max(latestPointerTime,eventTime);latestSourceEventType=event.type;latestSourceEventTime=eventTime;lastX=event.clientX;lastY=event.clientY;hovering=!!document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#canvas-area');update(true);trace(event,true,'',{latestPointerTime});},true);
  window.addEventListener('pointercancel',event=>{nativeFlashRecord(event,'pointercancel');hovering=false;setCustomCursorVisible(false,'pointercancel',event);trace(event,true,'');},true);
  window.addEventListener('lostpointercapture',event=>{nativeFlashRecord(event,'lostpointercapture');trace(event,true,'');},true);
  window.addEventListener('blur',event=>{nativeFlashRecord(event,'blur');hovering=false;setCustomCursorVisible(false,'blur',event);});
  window.addEventListener('tool-changed',()=>update(true));
  window.addEventListener('brush-resize-preview-toggle',()=>update(true));
  (function loop(){update(false);requestAnimationFrame(loop);})();
})();
