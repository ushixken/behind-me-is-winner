(()=>{
  'use strict';

  let requested=false;
  let presenting=false;
  let renderFrame=0;
  let magnification=1;
  let offsetX=0;
  let offsetY=0;
  let navigation=null;
  let previewSpaceHeld=false;
  let previewCtrlHeld=false;

  const host=document.getElementById('camera-view-preview');
  const preview=document.getElementById('camera-view-canvas');
  const empty=document.getElementById('camera-view-empty');
  const activate=document.getElementById('camera-view-activate');

  window.addEventListener('keydown',event=>{
    if(event.code==='Space')previewSpaceHeld=true;
    if(event.key==='Control'||event.code==='ControlLeft'||event.code==='ControlRight')previewCtrlHeld=true;
  },{capture:true});
  window.addEventListener('keyup',event=>{
    if(event.code==='Space')previewSpaceHeld=false;
    if(event.key==='Control'||event.code==='ControlLeft'||event.code==='ControlRight')previewCtrlHeld=false;
  },{capture:true});
  window.addEventListener('blur',()=>{previewSpaceHeld=false;previewCtrlHeld=false;});
  function hasCamera(){
    return !!(window.CameraSystem&&CameraSystem.value&&CameraSystem.value.enabled);
  }

  function clearArea(){
    if(typeof _getClearArea==='function')return _getClearArea();
    return{left:0,top:0,clearW:canvasArea.clientWidth,clearH:canvasArea.clientHeight};
  }

  function presentationGeometry(camera,zoomValue){
    const area=clearArea();
    const output=camera.output||{};
    const width=Math.max(1,Number(output.width)||CW);
    const height=Math.max(1,Number(output.height)||CH);
    const fitScale=Math.min(area.clearW/width,area.clearH/height);
    const scale=fitScale*(zoomValue==null?magnification:zoomValue);
    const displayW=Math.max(1,width*scale);
    const displayH=Math.max(1,height*scale);
    return{
      area,displayW,displayH,
      left:area.left+(area.clearW-displayW)/2+offsetX,
      top:area.top+(area.clearH-displayH)/2+offsetY
    };
  }

  function layout(camera){
    const geometry=presentationGeometry(camera);
    preview.style.width=geometry.displayW+'px';
    preview.style.height=geometry.displayH+'px';
    preview.style.left=geometry.left+'px';
    preview.style.top=geometry.top+'px';
  }

  function render(){
    renderFrame=0;
    if(!presenting||!hasCamera())return;
    const camera=CameraSystem.value;
    CameraSystem.renderCameraOutput({
      frame:typeof curFrame==='number'?curFrame:0,
      camera,
      source:artworkCompositeC,
      background:typeof bgColor==='string'?bgColor:'transparent',
      target:preview,
      includeEditorOverlays:false
    });
    layout(camera);
  }

  function invalidate(){
    if(!presenting||renderFrame)return;
    renderFrame=requestAnimationFrame(render);
  }

  function sync(){
    const available=hasCamera();
    presenting=requested&&available;
    document.body.classList.toggle('camera-view-active',presenting);
    document.querySelectorAll('#btn-camera-view').forEach(button=>{
      button.setAttribute('aria-pressed',requested?'true':'false');
      button.setAttribute('aria-checked',requested?'true':'false');
      button.classList.toggle('active',requested);
    });
    host.hidden=!requested;
    host.setAttribute('aria-hidden',requested?'false':'true');
    preview.hidden=!presenting;
    empty.hidden=!requested||available;
    host.style.cursor=presenting?'grab':'default';
    if(presenting)invalidate();
    else if(renderFrame){cancelAnimationFrame(renderFrame);renderFrame=0;}
  }

  function resetPresentationView(){
    magnification=1;
    offsetX=0;
    offsetY=0;
    if(presenting)layout(CameraSystem.value);
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest&&event.target.closest('#btn-camera-view');
    if(!button)return;
    event.preventDefault();
    event.stopPropagation();
    requested=!requested;
    sync();
  });

  activate.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();
    if(window.CameraSystem)CameraSystem.activate();
    sync();
  });

  function setMagnification(nextMagnification,clientX,clientY){
    if(!presenting)return false;
    const camera=CameraSystem.value;
    const oldGeometry=presentationGeometry(camera);
    const rect=host.getBoundingClientRect();
    const pointerX=Number.isFinite(clientX)?clientX-rect.left:oldGeometry.area.left+oldGeometry.area.clearW/2;
    const pointerY=Number.isFinite(clientY)?clientY-rect.top:oldGeometry.area.top+oldGeometry.area.clearH/2;
    nextMagnification=Math.max(.1,Math.min(8,nextMagnification));
    if(nextMagnification===magnification)return false;
    const ratio=nextMagnification/magnification;
    const nextWidth=oldGeometry.displayW*ratio;
    const nextHeight=oldGeometry.displayH*ratio;
    const nextCenteredLeft=oldGeometry.area.left+(oldGeometry.area.clearW-nextWidth)/2;
    const nextCenteredTop=oldGeometry.area.top+(oldGeometry.area.clearH-nextHeight)/2;
    const anchoredLeft=pointerX-(pointerX-oldGeometry.left)*ratio;
    const anchoredTop=pointerY-(pointerY-oldGeometry.top)*ratio;
    magnification=nextMagnification;
    offsetX=anchoredLeft-nextCenteredLeft;
    offsetY=anchoredTop-nextCenteredTop;
    layout(camera);
    return true;
  }

  function zoomBy(direction,clientX,clientY){
    return setMagnification(magnification*(direction>0?1.2:1/1.2),clientX,clientY);
  }

  host.addEventListener('wheel',event=>{
    if(!presenting)return;
    event.preventDefault();
    event.stopPropagation();
    setMagnification(magnification*Math.exp(-event.deltaY*.0015),event.clientX,event.clientY);
  },{capture:true,passive:false});

  function beginPointerNavigation(event,forceCtrl){
    if(!presenting||event.isPrimary===false)return false;
    if(event.target===activate||event.target===empty)return false;
    const primaryDrag=event.pointerType==='pen'
      ? (event.button===0||event.buttons===1)
      : event.button===0;
    const navigate=event.button===1||primaryDrag;
    if(!navigate)return false;
    event.preventDefault();
    event.stopPropagation();
    const zoomDrag=primaryDrag&&(forceCtrl||event.ctrlKey||previewCtrlHeld);
    navigation={
      pointerId:event.pointerId,
      kind:zoomDrag?'zoom':'pan',
      startX:event.clientX,
      startY:event.clientY,
      offsetX,
      offsetY,
      magnification
    };
    try{canvasArea.setPointerCapture(event.pointerId);}catch(_){}
    host.style.cursor=zoomDrag?'zoom-in':'grabbing';
    return true;
  }

  canvasArea.addEventListener('pointerdown',event=>{
    if(event.target!==canvasArea&&!host.contains(event.target))return;
    beginPointerNavigation(event,false);
  },{capture:true});

  canvasArea.addEventListener('pointermove',event=>{
    if(!navigation||event.pointerId!==navigation.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    if(navigation.kind==='zoom'){
      const next=navigation.magnification*Math.pow(2,(event.clientX-navigation.startX)/300);
      setMagnification(next,navigation.startX,navigation.startY);
    }else{
      offsetX=navigation.offsetX+event.clientX-navigation.startX;
      offsetY=navigation.offsetY+event.clientY-navigation.startY;
      layout(CameraSystem.value);
    }
  });

  function endNavigation(event){
    if(!navigation||event.pointerId!==navigation.pointerId)return;
    event.preventDefault();
    event.stopPropagation();
    try{if(canvasArea.hasPointerCapture(event.pointerId))canvasArea.releasePointerCapture(event.pointerId);}catch(_){}
    navigation=null;
    host.style.cursor=presenting?'grab':'default';
  }

  canvasArea.addEventListener('pointerup',endNavigation,{capture:true});
  canvasArea.addEventListener('pointercancel',endNavigation,{capture:true});
  canvasArea.addEventListener('lostpointercapture',event=>{
    if(navigation&&event.pointerId===navigation.pointerId){navigation=null;host.style.cursor=presenting?'grab':'default';}
  });
  host.addEventListener('dblclick',event=>{
    if(!presenting||event.target===activate)return;
    event.preventDefault();
    event.stopPropagation();
    resetPresentationView();
  });
  for(const type of ['click','contextmenu']){
    host.addEventListener(type,event=>{
      if(event.target===activate)return;
      event.preventDefault();
      event.stopPropagation();
    });
  }

  window.addEventListener('camera-changed',sync);
  window.addEventListener('resize',invalidate);
  window.addEventListener('active-artwork-changed',invalidate);
  window.addEventListener('timeline-frame-changed',invalidate);
  window.addEventListener('project-loaded',sync);
  if(window.ResizeObserver)new ResizeObserver(invalidate).observe(canvasArea);

  window.CameraView={
    invalidate,
    resetView:resetPresentationView,
    zoomBy,
    beginPointerNavigation,
    toggle(){requested=!requested;sync();},
    get enabled(){return requested;},
    get active(){return presenting;},
    get magnification(){return magnification;}
  };
})();