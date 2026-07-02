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
// Perspective sub-mode: each corner can move independently for 4-point
// perspective distortion, Photoshop/CSP/Krita-style. Reuses the same
// enter/preview/commit/cancel flow as the normal (free) transform — only
// the interaction (corner-only drag) and rendering (projective warp
// instead of translate/scale/rotate) differ.
let tfPerspective=false;    // true while Perspective mode is active
let tfCorners=null;         // [{x,y}×4] TL,TR,BR,BL — independently draggable, canvas coords
let tfCornerDrag=null;      // index of corner currently being dragged, or null


const TF_HANDLE_R=9;       // corner handle hit radius, canvas px (scales visually with zoom via CSS)
const TF_ROTATE_OFFSET=36; // distance above the box the rotate handle sits, canvas px

function _tfCenter(){
  return {x:tfBox.x+tfBox.w/2+tfState.tx, y:tfBox.y+tfBox.h/2+tfState.ty};
}

// ── Perspective warp math ───────────────────────────────────────
// Standard unit-square → quadrilateral projective mapping (Heckbert).
// d0..d3 are the destination corners for source-space (0,0),(1,0),(1,1),(0,1).
function _tfQuadH(d0,d1,d2,d3){
  const dx1=d1.x-d2.x, dx2=d3.x-d2.x, dx3=d0.x-d1.x+d2.x-d3.x;
  const dy1=d1.y-d2.y, dy2=d3.y-d2.y, dy3=d0.y-d1.y+d2.y-d3.y;
  let a,b,c,d,e,f,g,h;
  if(Math.abs(dx3)<1e-9&&Math.abs(dy3)<1e-9){
    a=d1.x-d0.x;b=d2.x-d1.x;c=d0.x;
    d=d1.y-d0.y;e=d2.y-d1.y;f=d0.y;
    g=0;h=0;
  } else {
    const det=dx1*dy2-dx2*dy1;
    g=det?(dx3*dy2-dx2*dy3)/det:0;
    h=det?(dx1*dy3-dx3*dy1)/det:0;
    a=d1.x-d0.x+g*d1.x;b=d3.x-d0.x+h*d3.x;c=d0.x;
    d=d1.y-d0.y+g*d1.y;e=d3.y-d0.y+h*d3.y;f=d0.y;
  }
  return {a,b,c,d,e,f,g,h};
}
function _tfApplyQuadH(H,u,v){
  const w=H.g*u+H.h*v+1;
  return {x:(H.a*u+H.b*v+H.c)/w, y:(H.d*u+H.e*v+H.f)/w};
}
// Draw one source triangle (s0,s1,s2 in `img` pixel coords) warped onto
// destination triangle (d0,d1,d2), via an affine transform + clip. Used to
// approximate the projective warp with a fine triangle grid.
function _tfDrawTri(dctx,img,s0,s1,s2,d0,d1,d2){
  const denom=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
  if(!denom) return;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/denom;
  const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/denom;
  const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/denom;
  const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/denom;
  const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/denom;
  const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/denom;
  dctx.save();
  dctx.beginPath();
  dctx.moveTo(d0.x,d0.y);dctx.lineTo(d1.x,d1.y);dctx.lineTo(d2.x,d2.y);dctx.closePath();
  dctx.clip();
  dctx.transform(a,b,c,d,e,f);
  dctx.imageSmoothingEnabled=true;
  dctx.drawImage(img,0,0);
  dctx.restore();
}
// Warp `img`'s (sx,sy,sw,sh) source rect onto the quad `corners`
// (TL,TR,BR,BL, destination canvas coords) using an NxN triangle grid.
function _tfDrawPerspective(dctx,img,sx,sy,sw,sh,corners,gridN){
  const H=_tfQuadH(corners[0],corners[1],corners[2],corners[3]);
  const n=gridN||14;
  for(let j=0;j<n;j++){
    const v0=j/n, v1=(j+1)/n;
    for(let i=0;i<n;i++){
      const u0=i/n, u1=(i+1)/n;
      const p00=_tfApplyQuadH(H,u0,v0), p10=_tfApplyQuadH(H,u1,v0);
      const p11=_tfApplyQuadH(H,u1,v1), p01=_tfApplyQuadH(H,u0,v1);
      const s00={x:sx+u0*sw,y:sy+v0*sh}, s10={x:sx+u1*sw,y:sy+v0*sh};
      const s11={x:sx+u1*sw,y:sy+v1*sh}, s01={x:sx+u0*sw,y:sy+v1*sh};
      _tfDrawTri(dctx,img,s00,s10,s11,p00,p10,p11);
      _tfDrawTri(dctx,img,s00,s11,s01,p00,p11,p01);
    }
  }
}
// The four corners of the current axis-aligned box under the *free*
// transform (tx/ty/scale/rotation) — used as the starting quad when
// switching into Perspective mode, so distortion begins from whatever
// move/scale/rotation was already dialed in.
function _tfFreeCorners(){ return _tfCorners(); }

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
  tfPerspective=false;
  tfCorners=null;
  tfActive=true;
  transformC.classList.add('tf-active');
  _tfSyncToggleUI();
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
      if(tfPerspective){
        _tfDrawPerspective(octx2,m.base,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,28);
      } else {
        octx2.save();
        octx2.translate(c.x,c.y);
        octx2.rotate(rad);
        octx2.scale(tfState.scale,tfState.scale);
        octx2.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
        octx2.drawImage(m.base,0,0);
        octx2.restore();
      }
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
    tfPerspective=false;tfCorners=null;
    return;
  }

  if(tfPerspective){
    const out=mkLayerCanvas();
    _tfDrawPerspective(out.getContext('2d'),tfSnapshot,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,28);
    ctx.clearRect(0,0,CW,CH);
    ctx.drawImage(out,0,0);
  }

  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfBox=null;tfState=null;
  tfPerspective=false;tfCorners=null;
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
    tfPerspective=false;tfCorners=null;
    return;
  }

  ctx.clearRect(0,0,CW,CH);
  if(tfSnapshot) ctx.drawImage(tfSnapshot,0,0);
  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfBox=null;tfState=null;
  tfPerspective=false;tfCorners=null;
}

function _tfRedraw(){
  if(!tfActive) return;
  if(tfGroupMode){
    _tfDrawGroupPreview();
    if(tfPerspective) _tfDrawHandlesPerspective(false); else _tfDrawHandles(false);
  } else {
    ctx.clearRect(0,0,CW,CH);
    if(tfPerspective){
      _tfDrawPerspective(ctx,tfSnapshot,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,12);
    } else {
      const c=_tfCenter();
      ctx.save();
      ctx.translate(c.x,c.y);
      ctx.rotate(tfState.rotation*Math.PI/180);
      ctx.scale(tfState.scale,tfState.scale);
      ctx.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
      ctx.drawImage(tfSnapshot,0,0);
      ctx.restore();
    }
    _scheduleRecomposite();
    if(tfPerspective) _tfDrawHandlesPerspective(true); else _tfDrawHandles(true);
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
    if(tfPerspective){
      _tfDrawPerspective(tfCtx,m.base,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,12);
    } else {
      tfCtx.translate(c.x,c.y);
      tfCtx.rotate(rad);
      tfCtx.scale(tfState.scale,tfState.scale);
      tfCtx.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));
      tfCtx.drawImage(m.base,0,0);
    }
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

// Perspective-mode handle drawing: the quad outline plus its 4
// independently-draggable corner handles. No rotate handle or center
// crosshair — corner dragging alone covers move/scale/skew/perspective.
function _tfDrawHandlesPerspective(clearFirst){
  if(clearFirst) tfCtx.clearRect(0,0,CW,CH);
  tfCtx.save();
  tfCtx.strokeStyle=tfGroupMode?'#ff9f4d':'#a24dff';
  tfCtx.lineWidth=Math.max(1,1.5/zoom);
  tfCtx.setLineDash([6/zoom,4/zoom]);
  tfCtx.beginPath();
  tfCorners.forEach((p,i)=>{ i===0?tfCtx.moveTo(p.x,p.y):tfCtx.lineTo(p.x,p.y); });
  tfCtx.closePath();
  tfCtx.stroke();
  tfCtx.setLineDash([]);
  const hr=TF_HANDLE_R/zoom;
  tfCtx.fillStyle='#fff';
  tfCorners.forEach(p=>{
    tfCtx.beginPath();tfCtx.rect(p.x-hr/2,p.y-hr/2,hr,hr);tfCtx.fill();tfCtx.stroke();
  });
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

// Point-in-polygon (ray casting) — used to hit-test the perspective quad's
// interior for whole-quad dragging, since it's not axis-aligned like the
// free-transform box.
function _tfPointInPoly(p,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x,yi=poly[i].y, xj=poly[j].x,yj=poly[j].y;
    const intersect=((yi>p.y)!==(yj>p.y)) && (p.x < (xj-xi)*(p.y-yi)/(yj-yi)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function _tfHitTestPerspective(p){
  const hitR=TF_HANDLE_R/zoom+4/zoom;
  for(let i=0;i<tfCorners.length;i++){
    if(_tfDist(p.x,p.y,tfCorners[i].x,tfCorners[i].y)<=hitR) return {mode:'pcorner',cornerIndex:i};
  }
  if(_tfPointInPoly(p,tfCorners)) return {mode:'pmove'};
  return null;
}

transformC.addEventListener('pointerdown',e=>{
  if(!tfActive) return;
  e.preventDefault();
  const p=getPos(e);
  if(tfPerspective){
    const hit=_tfHitTestPerspective(p);
    if(!hit) return;
    transformC.setPointerCapture(e.pointerId);
    tfDrag=hit.mode;
    if(hit.mode==='pcorner'){
      tfCornerDrag=hit.cornerIndex;
      tfDragInfo={startP:p,startCorner:Object.assign({},tfCorners[hit.cornerIndex])};
    } else {
      tfDragInfo={startP:p,startCorners:tfCorners.map(c=>({x:c.x,y:c.y}))};
    }
    return;
  }
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
  if(tfPerspective){
    if(tfDrag==='pcorner'){
      tfCorners[tfCornerDrag].x=tfDragInfo.startCorner.x+(p.x-tfDragInfo.startP.x);
      tfCorners[tfCornerDrag].y=tfDragInfo.startCorner.y+(p.y-tfDragInfo.startP.y);
    } else if(tfDrag==='pmove'){
      const dx=p.x-tfDragInfo.startP.x, dy=p.y-tfDragInfo.startP.y;
      tfCorners.forEach((c,i)=>{ c.x=tfDragInfo.startCorners[i].x+dx; c.y=tfDragInfo.startCorners[i].y+dy; });
    }
    _tfRedraw();
    return;
  }
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
  tfDrag=null;tfDragInfo=null;tfCornerDrag=null;
}
transformC.addEventListener('pointerup',_tfEndDrag);
transformC.addEventListener('pointercancel',_tfEndDrag);

transformC.addEventListener('pointermove',e=>{
  if(!tfActive||tfDrag) return;
  if(tfPerspective){
    const hit=_tfHitTestPerspective(getPos(e));
    transformC.style.cursor=hit?(hit.mode==='pcorner'?'crosshair':'move'):'default';
    return;
  }
  const hit=_tfHitTest(getPos(e));
  transformC.style.cursor=hit?(hit.mode==='rotate'?'grab':hit.mode==='scale'?'nwse-resize':'move'):'default';
});

document.addEventListener('keydown',e=>{
  if(!tfActive) return;
  if(e.target.tagName==='INPUT') return;
  if(e.key==='Enter'){ e.preventDefault(); setTool('brush','Brush'); }
  else if(e.key==='Escape'){ e.preventDefault(); cancelTransformTool(); setTool('brush','Brush'); }
});

// ── Transform mode buttons — Free / Perspective ────────────────────
// Live inside the Brush Presets docker's "transform" body (see
// index.html / _syncBrushPresetsDocker in tools-color.js), which swaps
// in over the Brush Presets contents whenever the Transform tool is
// selected, and swaps back out when it isn't. Only one mode button is
// active at a time.
const _tfBtnFree=document.getElementById('transform-mode-free');
const _tfBtnPersp=document.getElementById('transform-mode-perspective');
if(_tfBtnFree) _tfBtnFree.onclick=()=>_tfSetPerspective(false);
if(_tfBtnPersp) _tfBtnPersp.onclick=()=>_tfSetPerspective(true);

function _tfSyncToggleUI(){
  if(_tfBtnFree) _tfBtnFree.classList.toggle('active',!tfPerspective);
  if(_tfBtnPersp) _tfBtnPersp.classList.toggle('active',tfPerspective);
}

// Switch between Free (move/scale/rotate) and Perspective (independent
// corner drag) without leaving the transform tool — same snapshot/box,
// same commit/cancel flow, just a different interaction+render path.
function _tfSetPerspective(on){
  if(!tfActive||on===tfPerspective) return;
  if(on){
    tfCorners=_tfFreeCorners().map(p=>({x:p.x,y:p.y}));
  } else {
    tfCorners=null;
  }
  tfPerspective=on;
  _tfSyncToggleUI();
  _tfRedraw();
}