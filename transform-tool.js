// ════════════════════════════════════════════════════════════════
// TRANSFORM TOOL — move / scale / rotate the current frame's drawing,
// TVPaint-style. T (or Tools panel button) enters the tool; dragging
// inside the box moves it, corner handles scale, the handle above
// top-center rotates. Switching to another tool (or pressing Enter)
// bakes the result in; Escape cancels.
//
// GROUP-FOLDER SELECTION: if a group folder is active (activeGroupId)
// instead of a single layer, the tool treats every layer inside that
// group (and any nested subgroups) as one combined unit — one bounding
// box, one move/scale/rotate — while still baking the result back into
// each individual layer's own current frame, so their contents stay
// separately editable afterwards.
// ════════════════════════════════════════════════════════════════
const transformC=document.getElementById('transform-canvas');
const tfCtx=transformC.getContext('2d');

let tfActive=false;
let tfGroupMode=false;   // true when the transform is acting on a whole active group, not a single layer
let tfGroupId=null;
let tfMemberIdx=null;    // layer indices belonging to the active group (group mode only)
let tfMembers=null;      // [{li, base}] pristine per-layer content snapshots (group mode only)
let tfSnapshot=null;     // pristine copy of activeC content when the tool was entered (single-layer mode)
let tfBox=null;          // {x,y,w,h} axis-aligned bbox of the artwork, in original canvas coords
let tfState=null;        // {tx,ty,scale,rotation} — cumulative transform applied to tfBox's center
let tfDrag=null;         // current drag mode: 'move' | 'scale' | 'rotate' | null
let tfDragInfo=null;     // scratch data for the active drag
// Layer indices to hide from the normal per-layer compositing pass while
// the Transform tool has its own live preview drawn on top instead —
// read by recomposite() in panels.js. Only meaningful in group mode.
let _tfHiddenLayers=new Set();

const TF_HANDLE_R=9;       // corner handle hit radius, canvas px (scales visually with zoom via CSS)
const TF_ROTATE_OFFSET=36; // distance above the box the rotate handle sits, canvas px

function _tfCenter(){
  return {x:tfBox.x+tfBox.w/2+tfState.tx, y:tfBox.y+tfBox.h/2+tfState.ty};
}

// Find the bounding box of non-transparent pixels in `canvas`. Falls back
// to the full canvas if everything is transparent (nothing to grab onto,
// but the user can still move an empty frame's guide box).
function _computeOpaqueBBox(canvas){
  const w=canvas.width,h=canvas.height;
  const data=canvas.getContext('2d').getImageData(0,0,w,h).data;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(data[(y*w+x)*4+3]!==0){
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
  }
  if(maxX<minX) return {x:0,y:0,w:w,h:h};
  return {x:minX,y:minY,w:(maxX-minX+1),h:(maxY-minY+1)};
}

function enterTransformTool(){
  if(tfActive) return;

  // Collect every layer that should move together: layers inside the
  // active group folder, layers inside any multi-selected group folders
  // (and their nested subgroups), and any individually multi-selected
  // layers — plus the current active layer, since it's part of the
  // selection too whenever anything else is picked alongside it.
  const groupIdSet=new Set();
  if(activeGroupId) _allDescendantGroupIds(activeGroupId).forEach(id=>groupIdSet.add(id));
  if(typeof _selectedGroupsFullIdSet==='function') _selectedGroupsFullIdSet().forEach(id=>groupIdSet.add(id));

  const memberSet=new Set(typeof selectedLayerIndices!=='undefined'?selectedLayerIndices:[]);
  layers.forEach((l,i)=>{ if(l.groupId&&groupIdSet.has(l.groupId)) memberSet.add(i); });
  if(groupIdSet.size>0||memberSet.size>0) memberSet.add(curLayer);

  tfGroupMode=groupIdSet.size>0||memberSet.size>1;
  tfGroupId=activeGroupId||null;

  if(tfGroupMode){
    tfMemberIdx=[...memberSet].sort((a,b)=>a-b);
    if(!tfMemberIdx.length){
      if(typeof showInfo==='function') showInfo('Nothing to transform.','Transform');
      setTool('brush','Brush');
      return;
    }
    tfMembers=tfMemberIdx.map(li=>{
      const held=getHeldKey(li,curFrame);
      const base=mkLayerCanvas();
      if(held) base.getContext('2d').drawImage(held,0,0);
      return {li,base};
    });
    const composite=mkLayerCanvas();
    const cc=composite.getContext('2d');
    tfMembers.forEach(m=>cc.drawImage(m.base,0,0));
    tfBox=_computeOpaqueBBox(composite);
    _tfHiddenLayers=new Set(tfMemberIdx);
    recomposite(curLayer,curFrame);
  } else {
    tfSnapshot=mkLayerCanvas();
    tfSnapshot.getContext('2d').drawImage(activeC,0,0);
    tfBox=_computeOpaqueBBox(tfSnapshot);
    _tfHiddenLayers=new Set();
    pushUndo();
  }

  tfState={tx:0,ty:0,scale:1,rotation:0};
  tfActive=true;
  transformC.classList.add('tf-active');
  _tfRedraw();
}

function commitTransformTool(){
  if(!tfActive) return;
  tfActive=false;
  transformC.classList.remove('tf-active');
  tfCtx.clearRect(0,0,CW,CH);

  if(tfGroupMode){
    const c=_tfCenter();
    const rad=tfState.rotation*Math.PI/180;
    tfMembers.forEach(m=>{
      const out=mkLayerCanvas();
      const octx2=out.getContext('2d');
      octx2.save();
      octx2.translate(c.x,c.y);
      octx2.rotate(rad);
      octx2.scale(tfState.scale,tfState.scale);
      octx2.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
      octx2.drawImage(m.base,0,0);
      octx2.restore();
      layers[m.li].frames[curFrame]=out;
      // The active layer is always rendered from activeC during compositing
      // (not from its frame key) — without this, that member would visually
      // snap back to its pre-transform position on commit while every other
      // member correctly kept the new transform.
      if(m.li===curLayer){
        ctx.clearRect(0,0,CW,CH);
        ctx.drawImage(out,0,0);
      }
    });
    _tfHiddenLayers=new Set();
    recomposite(curLayer,curFrame);
    renderTimeline();
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfBox=null;tfState=null;
    return;
  }

  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfBox=null;tfState=null;
}

function cancelTransformTool(){
  if(!tfActive) return;
  tfActive=false;
  transformC.classList.remove('tf-active');
  tfCtx.clearRect(0,0,CW,CH);

  if(tfGroupMode){
    _tfHiddenLayers=new Set();
    recomposite(curLayer,curFrame);
    renderTimeline();
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfBox=null;tfState=null;
    return;
  }

  ctx.clearRect(0,0,CW,CH);
  if(tfSnapshot) ctx.drawImage(tfSnapshot,0,0);
  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfBox=null;tfState=null;
}

function _tfRedraw(){
  if(!tfActive) return;
  if(tfGroupMode){
    _tfDrawGroupPreview();
    _tfDrawHandles(false);
  } else {
    const c=_tfCenter();
    ctx.clearRect(0,0,CW,CH);
    ctx.save();
    ctx.translate(c.x,c.y);
    ctx.rotate(tfState.rotation*Math.PI/180);
    ctx.scale(tfState.scale,tfState.scale);
    ctx.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
    ctx.drawImage(tfSnapshot,0,0);
    ctx.restore();
    _scheduleRecomposite();
    _tfDrawHandles(true);
  }
}

function _tfDrawGroupPreview(){
  const c=_tfCenter();
  const rad=tfState.rotation*Math.PI/180;
  tfCtx.clearRect(0,0,CW,CH);
  tfMembers.forEach(m=>{
    const l=layers[m.li];
    if(!l.visible||(typeof _layerGroupChainVisible==='function'&&!_layerGroupChainVisible(l))) return;
    const layerAlpha=(l.opacity??1)*(typeof _layerGroupChainOpacity==='function'?_layerGroupChainOpacity(l):1);
    tfCtx.save();
    tfCtx.globalAlpha=layerAlpha;
    tfCtx.translate(c.x,c.y);
    tfCtx.rotate(rad);
    tfCtx.scale(tfState.scale,tfState.scale);
    tfCtx.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
    tfCtx.drawImage(m.base,0,0);
    tfCtx.restore();
  });
}

function _tfCorners(){
  const c=_tfCenter();
  const hw=(tfBox.w/2)*tfState.scale, hh=(tfBox.h/2)*tfState.scale;
  const rad=tfState.rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  return pts.map(([lx,ly])=>({x:c.x+lx*cosR-ly*sinR, y:c.y+lx*sinR+ly*cosR}));
}
function _tfRotateHandlePos(){
  const c=_tfCenter();
  const hh=(tfBox.h/2)*tfState.scale;
  const rad=tfState.rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const lx=0, ly=-hh-TF_ROTATE_OFFSET;
  return {x:c.x+lx*cosR-ly*sinR, y:c.y+lx*sinR+ly*cosR};
}

function _tfDrawHandles(clearFirst){
  const corners=_tfCorners();
  const rHandle=_tfRotateHandlePos();
  const c=_tfCenter();
  if(clearFirst) tfCtx.clearRect(0,0,CW,CH);
  tfCtx.save();
  tfCtx.strokeStyle=tfGroupMode?'#ff9f4d':'#4da3ff';
  tfCtx.lineWidth=Math.max(1,1.5/zoom);
  tfCtx.setLineDash([6/zoom,4/zoom]);
  tfCtx.beginPath();
  corners.forEach((p,i)=>{ i===0?tfCtx.moveTo(p.x,p.y):tfCtx.lineTo(p.x,p.y); });
  tfCtx.closePath();
  tfCtx.stroke();
  tfCtx.setLineDash([]);
  const topMid={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};
  tfCtx.beginPath();tfCtx.moveTo(topMid.x,topMid.y);tfCtx.lineTo(rHandle.x,rHandle.y);tfCtx.stroke();
  const hr=TF_HANDLE_R/zoom;
  tfCtx.fillStyle='#fff';
  corners.forEach(p=>{
    tfCtx.beginPath();tfCtx.rect(p.x-hr/2,p.y-hr/2,hr,hr);tfCtx.fill();tfCtx.stroke();
  });
  tfCtx.beginPath();tfCtx.arc(rHandle.x,rHandle.y,hr/2,0,Math.PI*2);tfCtx.fill();tfCtx.stroke();
  tfCtx.beginPath();tfCtx.moveTo(c.x-hr/2,c.y);tfCtx.lineTo(c.x+hr/2,c.y);
  tfCtx.moveTo(c.x,c.y-hr/2);tfCtx.lineTo(c.x,c.y+hr/2);tfCtx.stroke();
  tfCtx.restore();
}

function _tfDist(ax,ay,bx,by){ return Math.hypot(ax-bx,ay-by); }

function _tfHitTest(p){
  const hitR=TF_HANDLE_R/zoom+4/zoom;
  const rHandle=_tfRotateHandlePos();
  if(_tfDist(p.x,p.y,rHandle.x,rHandle.y)<=hitR) return {mode:'rotate'};
  const corners=_tfCorners();
  for(let i=0;i<corners.length;i++){
    if(_tfDist(p.x,p.y,corners[i].x,corners[i].y)<=hitR) return {mode:'scale',cornerIndex:i};
  }
  const c=_tfCenter();
  const rad=-tfState.rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const dx=p.x-c.x, dy=p.y-c.y;
  const lx=dx*cosR-dy*sinR, ly=dx*sinR+dy*cosR;
  const hw=(tfBox.w/2)*tfState.scale, hh=(tfBox.h/2)*tfState.scale;
  if(Math.abs(lx)<=hw&&Math.abs(ly)<=hh) return {mode:'move'};
  return null;
}

transformC.addEventListener('pointerdown',e=>{
  if(!tfActive) return;
  e.preventDefault();
  const p=getPos(e);
  const hit=_tfHitTest(p);
  if(!hit) return;
  transformC.setPointerCapture(e.pointerId);
  tfDrag=hit.mode;
  const c=_tfCenter();
  tfDragInfo={
    startP:p,
    startState:Object.assign({},tfState),
    startCenter:c,
    startDist:_tfDist(p.x,p.y,c.x,c.y),
    startAngle:Math.atan2(p.y-c.y,p.x-c.x),
  };
});
transformC.addEventListener('pointermove',e=>{
  if(!tfActive||!tfDrag) return;
  e.preventDefault();
  const p=getPos(e);
  if(tfDrag==='move'){
    tfState.tx=tfDragInfo.startState.tx+(p.x-tfDragInfo.startP.x);
    tfState.ty=tfDragInfo.startState.ty+(p.y-tfDragInfo.startP.y);
  }else if(tfDrag==='scale'){
    const d=_tfDist(p.x,p.y,tfDragInfo.startCenter.x,tfDragInfo.startCenter.y);
    const ratio=tfDragInfo.startDist>1?d/tfDragInfo.startDist:1;
    tfState.scale=Math.max(0.02,Math.min(50,tfDragInfo.startState.scale*ratio));
  }else if(tfDrag==='rotate'){
    const ang=Math.atan2(p.y-tfDragInfo.startCenter.y,p.x-tfDragInfo.startCenter.x);
    const deltaDeg=(ang-tfDragInfo.startAngle)*180/Math.PI;
    let newRot=tfDragInfo.startState.rotation+deltaDeg;
    if(e.shiftKey) newRot=Math.round(newRot/15)*15;
    tfState.rotation=newRot;
  }
  _tfRedraw();
});
function _tfEndDrag(e){
  if(!tfDrag) return;
  if(transformC.hasPointerCapture&&transformC.hasPointerCapture(e.pointerId)) transformC.releasePointerCapture(e.pointerId);
  tfDrag=null;tfDragInfo=null;
}
transformC.addEventListener('pointerup',_tfEndDrag);
transformC.addEventListener('pointercancel',_tfEndDrag);

transformC.addEventListener('pointermove',e=>{
  if(!tfActive||tfDrag) return;
  const hit=_tfHitTest(getPos(e));
  transformC.style.cursor=hit?(hit.mode==='rotate'?'grab':hit.mode==='scale'?'nwse-resize':'move'):'default';
});

document.addEventListener('keydown',e=>{
  if(!tfActive) return;
  if(e.target.tagName==='INPUT') return;
  if(e.key==='Enter'){ e.preventDefault(); setTool('brush','Brush'); }
  else if(e.key==='Escape'){ e.preventDefault(); cancelTransformTool(); setTool('brush','Brush'); }
});
