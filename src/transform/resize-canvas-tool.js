(function(){
  'use strict';
  const settings=document.getElementById('resize-canvas-settings');
  const actions=document.getElementById('resize-canvas-actions');
  const widthInput=document.getElementById('rc-width');
  const heightInput=document.getElementById('rc-height');
  const anchorGrid=document.getElementById('rc-anchor-grid');
  const HANDLE_RADIUS=10;
  const SNAP_THRESHOLD_SCREEN=8;
  const SNAP_RELEASE_SCREEN=12;
  let active=false,previousTool=null,previousStatus='',bounds=null,original=null,anchor={x:1,y:1},drag=null;

  const overlay=window.EditorOverlayRenderer.create('resize-canvas-overlay',{
    zIndex:18,pointerEvents:'auto',draw:drawOverlay
  });
  overlay.canvas.style.touchAction='none';

  function clampSize(value){return Math.max(1,Math.min(32768,Math.round(Number(value)||1)));}
  function points(){
    const l=bounds.left,t=bounds.top,r=bounds.right,b=bounds.bottom,cx=(l+r)/2,cy=(t+b)/2;
    return [{id:'nw',x:l,y:t},{id:'n',x:cx,y:t},{id:'ne',x:r,y:t},{id:'e',x:r,y:cy},{id:'se',x:r,y:b},{id:'s',x:cx,y:b},{id:'sw',x:l,y:b},{id:'w',x:l,y:cy}];
  }
  function screenPoints(){return points().map(p=>Object.assign({},p,EditorOverlayRenderer.worldToScreen(p)));}
  function syncInputs(){widthInput.value=Math.max(1,Math.round(bounds.right-bounds.left));heightInput.value=Math.max(1,Math.round(bounds.bottom-bounds.top));}
  function positionActions(){
    if(!active)return;
    const p=EditorOverlayRenderer.worldToScreen({x:(bounds.left+bounds.right)/2,y:bounds.bottom});
    const area=canvasArea.getBoundingClientRect(),w=actions.offsetWidth||72,h=actions.offsetHeight||34,margin=8,gap=12;
    const centerX=Math.max(margin+w/2,Math.min(area.width-margin-w/2,p.x));
    const below=p.y+gap,top=below+h<=area.height-margin?below:Math.max(margin,p.y-h-gap);
    actions.style.left=centerX+'px';
    actions.style.top=Math.max(margin,Math.min(area.height-h-margin,top))+'px';
  }
  function drawOverlay(ctx,g){
    if(!active)return;
    const world=points(),ps=world.map(p=>EditorOverlayRenderer.worldToScreen(p));
    const outline=()=>{ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);ctx.lineTo(ps[2].x,ps[2].y);ctx.lineTo(ps[4].x,ps[4].y);ctx.lineTo(ps[6].x,ps[6].y);ctx.closePath();};
    ctx.save();ctx.fillStyle='rgba(7,8,14,.58)';ctx.fillRect(0,0,g.width,g.height);
    ctx.globalCompositeOperation='destination-out';outline();ctx.fill();
    ctx.globalCompositeOperation='source-over';ctx.save();outline();ctx.clip();
    const l=bounds.left,t=bounds.top,w=bounds.right-l,h=bounds.bottom-t;
    const gridLines=[
      [{x:l+w/3,y:t},{x:l+w/3,y:bounds.bottom}],
      [{x:l+w*2/3,y:t},{x:l+w*2/3,y:bounds.bottom}],
      [{x:l,y:t+h/3},{x:bounds.right,y:t+h/3}],
      [{x:l,y:t+h*2/3},{x:bounds.right,y:t+h*2/3}]
    ];
    gridLines.forEach(line=>{const a=EditorOverlayRenderer.worldToScreen(line[0]),b=EditorOverlayRenderer.worldToScreen(line[1]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle='rgba(0,0,0,.32)';ctx.lineWidth=2;ctx.stroke();ctx.strokeStyle='rgba(245,244,255,.34)';ctx.lineWidth=1;ctx.stroke();});
    ctx.restore();
    const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#8175e8';
    ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.setLineDash([6,4]);outline();ctx.stroke();ctx.setLineDash([]);
    if(drag&&drag.snap){ctx.save();ctx.strokeStyle=accent;ctx.globalAlpha=.95;ctx.lineWidth=2.5;Object.keys(drag.snap).filter(edge=>drag.snap[edge]).forEach(edge=>{const pair=edge==='w'?[ps[0],ps[6]]:edge==='e'?[ps[2],ps[4]]:edge==='n'?[ps[0],ps[2]]:[ps[6],ps[4]];ctx.beginPath();ctx.moveTo(pair[0].x,pair[0].y);ctx.lineTo(pair[1].x,pair[1].y);ctx.stroke();});ctx.restore();}
    ps.forEach(p=>{ctx.fillStyle='#f5f4ff';ctx.strokeStyle='#6259d9';ctx.lineWidth=1.5;ctx.fillRect(Math.round(p.x)-4,Math.round(p.y)-4,8,8);ctx.strokeRect(Math.round(p.x)-4,Math.round(p.y)-4,8,8);});ctx.restore();
    positionActions();
  }
  function hitHandle(clientX,clientY){
    const rect=canvasArea.getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top;
    let best=null,distance=Infinity;screenPoints().forEach(p=>{const d=Math.hypot(x-p.x,y-p.y);if(d<distance){distance=d;best=p.id;}});return distance<=HANDLE_RADIUS?best:null;
  }
  const cursors={n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize'};
  function pointerWorld(e){return getPos(e);}
  function snapEdge(edge,value,target){
    const wasSnapped=!!drag.snap[edge],threshold=(wasSnapped?SNAP_RELEASE_SCREEN:SNAP_THRESHOLD_SCREEN)/Math.max(.0001,Math.abs(zoom));
    if(Math.abs(value-target)<=threshold){drag.snap[edge]=true;return target;}
    drag.snap[edge]=false;return value;
  }
  function onPointerDown(e){if(!active)return;const handle=hitHandle(e.clientX,e.clientY);if(!handle)return;e.preventDefault();e.stopPropagation();drag={handle,pointerId:e.pointerId,snap:Object.create(null)};overlay.canvas.setPointerCapture(e.pointerId);overlay.canvas.style.cursor=cursors[handle];}
  function onPointerMove(e){
    if(!active)return;if(!drag){const h=hitHandle(e.clientX,e.clientY);overlay.canvas.style.cursor=h?cursors[h]:'default';return;}if(e.pointerId!==drag.pointerId)return;
    e.preventDefault();const p=pointerWorld(e),h=drag.handle;
    if(h.includes('w'))bounds.left=Math.min(Math.round(snapEdge('w',p.x,0)),bounds.right-1);
    if(h.includes('e'))bounds.right=Math.max(Math.round(snapEdge('e',p.x,original.width)),bounds.left+1);
    if(h.includes('n'))bounds.top=Math.min(Math.round(snapEdge('n',p.y,0)),bounds.bottom-1);
    if(h.includes('s'))bounds.bottom=Math.max(Math.round(snapEdge('s',p.y,original.height)),bounds.top+1);
    syncInputs();overlay.invalidate();
  }
  function endDrag(e){if(!drag||e.pointerId!==drag.pointerId)return;try{if(overlay.canvas.hasPointerCapture(e.pointerId))overlay.canvas.releasePointerCapture(e.pointerId);}catch(_){}drag=null;overlay.invalidate();}
  overlay.canvas.addEventListener('pointerdown',onPointerDown);
  overlay.canvas.addEventListener('pointermove',onPointerMove);
  overlay.canvas.addEventListener('pointerup',endDrag);
  overlay.canvas.addEventListener('pointercancel',endDrag);
  overlay.canvas.addEventListener('lostpointercapture',()=>{drag=null;overlay.invalidate();});

  function applyNumeric(){if(!active)return;const nw=clampSize(widthInput.value),nh=clampSize(heightInput.value);const fixedX=original.width*(anchor.x/2),fixedY=original.height*(anchor.y/2);bounds.left=Math.round(fixedX-nw*(anchor.x/2));bounds.right=bounds.left+nw;bounds.top=Math.round(fixedY-nh*(anchor.y/2));bounds.bottom=bounds.top+nh;syncInputs();overlay.invalidate();}
  widthInput.addEventListener('input',applyNumeric);heightInput.addEventListener('input',applyNumeric);

  for(let y=0;y<3;y++)for(let x=0;x<3;x++){const button=document.createElement('button');button.type='button';button.className='rc-anchor';button.dataset.x=x;button.dataset.y=y;button.setAttribute('role','radio');button.setAttribute('aria-label',['Top left','Top','Top right','Left','Center','Right','Bottom left','Bottom','Bottom right'][y*3+x]);button.innerHTML='<span></span>';button.onclick=()=>{anchor={x,y};refreshAnchors();};anchorGrid.appendChild(button);}
  function refreshAnchors(){anchorGrid.querySelectorAll('.rc-anchor').forEach(b=>{const selected=Number(b.dataset.x)===anchor.x&&Number(b.dataset.y)===anchor.y;b.classList.toggle('active',selected);b.setAttribute('aria-checked',selected?'true':'false');});}

  function captureViewport(){return{zoom,panX,panY,rotation,flipX,flipY};}
  function restoreViewport(view,originOffset){
    if(!view)return;
    zoom=view.zoom;rotation=view.rotation;flipX=view.flipX;flipY=view.flipY;
    const offset=originOffset||{x:0,y:0},r=rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
    panX=view.panX+(offset.x*c-offset.y*s)*zoom;
    panY=view.panY+(offset.x*s+offset.y*c)*zoom;
    applyTransform();showZoom();
  }
  function cloneExtended(){return layers.map(layer=>{const result={};Object.entries(layer.extendedFrames||{}).forEach(([fi,record])=>{const copy=cloneExtendedFrameRecord(record);if(copy)result[fi]=copy;});return result;});}
  function captureHistory(){return{width:CW,height:CH,frames:_snapshotFrameMaps(layers.map((_,i)=>i)),extended:cloneExtended()};}
  function restoreHistory(snapshot){if(!snapshot)return false;const view=captureViewport();CW=snapshot.width;CH=snapshot.height;_restoreFrameMaps(snapshot.frames);layers.forEach((layer,i)=>{layer.extendedFrames={};Object.entries(snapshot.extended[i]||{}).forEach(([fi,record])=>{const copy=cloneExtendedFrameRecord(record);if(copy)layer.extendedFrames[fi]=copy;});});initCanvas();loadFrame(curLayer,curFrame);recomposite(curLayer,curFrame);renderTimeline();updateOnion();updateStatus();restoreViewport(view);return true;}

  function resizeDocument(nw,nh,dx,dy){
    layers.forEach((layer,li)=>{const next={};Object.keys(layer.frames||{}).forEach(fi=>{const out=document.createElement('canvas');out.width=nw;out.height=nh;const record=getExtendedLayerFrame(li,fi),src=record&&record.canvas||layer.frames[fi],x=record?record.x+dx:dx,y=record?record.y+dy:dy;out.getContext('2d').drawImage(src,x,y);next[fi]=out;});layer.frames=next;if(layer.extendedFrames)Object.values(layer.extendedFrames).forEach(record=>{if(record){record.x+=dx;record.y+=dy;}});});
    if(typeof resizeAllStyleFrames==='function')resizeAllStyleFrames(nw,nh,dx,dy);
    CW=nw;CH=nh;initCanvas();loadFrame(curLayer,curFrame);recomposite(curLayer,curFrame);renderTimeline();updateOnion();updateStatus();
  }
  function finish(){active=false;window.resizeCanvasModeActive=false;overlay.setVisible(false);settings.classList.remove('visible');actions.classList.remove('visible');settings.setAttribute('aria-hidden','true');actions.setAttribute('aria-hidden','true');drag=null;document.body.classList.remove('resize-canvas-active');const status=document.getElementById('stat-tool');if(status&&tool==='resize-canvas')status.textContent='Resize Canvas';}
  function enter(){if(active)return;if(tool==='transform'&&typeof cancelTransformTool==='function')cancelTransformTool();previousTool=tool;const status=document.getElementById('stat-tool');previousStatus=status?status.textContent:'';if(status)status.textContent='Resize Canvas';original={width:CW,height:CH};bounds={left:0,top:0,right:CW,bottom:CH};anchor={x:1,y:1};active=true;window.resizeCanvasModeActive=true;syncInputs();refreshAnchors();settings.classList.add('visible');actions.classList.add('visible');settings.setAttribute('aria-hidden','false');actions.setAttribute('aria-hidden','false');document.body.classList.add('resize-canvas-active');overlay.setVisible(true);overlay.invalidate();}
  function cancel(){if(!active)return;finish();}
  function confirm(){if(!active)return;const left=Math.round(bounds.left),top=Math.round(bounds.top),nw=clampSize(bounds.right-bounds.left),nh=clampSize(bounds.bottom-bounds.top),dx=-left,dy=-top;if(nw===CW&&nh===CH&&dx===0&&dy===0){finish();return;}const view=captureViewport(),before=captureHistory();resizeDocument(nw,nh,dx,dy);restoreViewport(view,{x:left,y:top});const after=captureHistory();undoStack.push({type:'canvas-resize',before,after});if(undoStack.length>40)undoStack.shift();redoStack.length=0;finish();}

  document.getElementById('rc-confirm').onclick=confirm;document.getElementById('rc-cancel').onclick=cancel;
  window.addEventListener('pointerdown',e=>{if(!active)return;if(settings.contains(e.target)||actions.contains(e.target)||e.target===overlay.canvas||(e.target.closest&&e.target.closest('#tools-panel-body .tbtn')))return;e.preventDefault();e.stopImmediatePropagation();},true);
  window.addEventListener('keydown',e=>{if(!active)return;if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();confirm();}else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}},true);
  window.addEventListener('canvas-view-transform-changed',()=>{if(active)overlay.invalidate();});
  window.CanvasResizeTool={get active(){return active;},enter,cancel,confirm,restoreHistory};
})();
