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

// ── Perspective guide overlay (VPs / horizon line) ─────────────────
// Drawn on a SEPARATE canvas sized to the canvas-area viewport, not to
// the artwork — see #perspective-guide-canvas in index.html/style.css for
// why. tfCtx (transformC) stays CW×CH and clips guides to the artwork's
// own bounds, which is what made VPs/horizon invisible outside the
// canvas in the first place.
const perspGuideC=document.getElementById('perspective-guide-canvas');
const perspGuideCtx=perspGuideC.getContext('2d');

function _tfResizeGuideCanvas(){
  const r=canvasArea.getBoundingClientRect();
  const w=Math.max(1,Math.round(r.width)), h=Math.max(1,Math.round(r.height));
  if(perspGuideC.width!==w) perspGuideC.width=w;
  if(perspGuideC.height!==h) perspGuideC.height=h;
}
window.addEventListener('resize',_tfResizeGuideCanvas);
_tfResizeGuideCanvas();

// perspGuideC only needs to *receive pointer events* while Perspective mode
// is actually active — otherwise it must stay pointer-events:none so it
// doesn't block clicks/drags meant for the canvas underneath (drawing,
// free-transform, etc). It sits ABOVE transformC (z-index) and covers the
// whole viewport (a superset of transformC's CW×CH area), so once it's
// interactive it becomes the sole target for perspective pointer events —
// see the perspGuideC listeners below, which replace transformC's
// perspective-branch handling (VPs/horizon can be outside transformC's own
// bounds, where transformC never receives the event at all).
function _tfSyncGuideCanvasActive(){
  perspGuideC.classList.toggle('tf-persp-active', !!(tfActive&&tfPerspective));
}

// Map a point from LOCAL/original canvas coords (the same space tfCorners
// live in) to canvas-area VIEWPORT coords — i.e. reproduce, in JS, exactly
// what canvas-wrap's CSS transform chain in applyTransform() does to a
// point, so guides drawn on perspGuideC line up pixel-for-pixel with the
// artwork under whatever pan/zoom/rotation/flip is currently active.
// (See core-state.js applyTransform(): translate(pivot) scale(flip)
// translate(-pivot) translate(pan) rotate(rotation) scale(zoom) — applied
// to a point right-to-left, which is the order reproduced below.)
function _tfToViewportPoint(p){
  const pivot=getNavPivot();
  const rad=rotation*Math.PI/180;
  const cos=Math.cos(rad), sin=Math.sin(rad);
  let x=p.x*zoom, y=p.y*zoom;
  const rx=x*cos-y*sin, ry=x*sin+y*cos;
  x=rx+panX; y=ry+panY;
  const fx=flipX?-1:1, fy=flipY?-1:1;
  x=pivot.cx+(x-pivot.cx)*fx;
  y=pivot.cy+(y-pivot.cy)*fy;
  return {x,y};
}

// Re-express a PerspectiveController.analyze() result (all in local canvas
// coords) in viewport coords, so PerspectiveController.draw()'s own
// width/height clip rect can clip to the visible workspace instead of the
// artwork. Only the point fields are transformed; converged/axisId etc.
// pass through untouched.
function _tfAnalysisToViewport(analysis){
  const vp=p=>_tfToViewportPoint(p);
  return {
    type:analysis.type,
    axes:analysis.axes.map(a=>Object.assign({},a,{
      nearA:vp(a.nearA),farA:vp(a.farA),nearB:vp(a.nearB),farB:vp(a.farB),
      vp:a.vp?vp(a.vp):null,
    })),
    vanishingPoints:analysis.vanishingPoints.map(v=>Object.assign({},v,vp(v))),
    horizon:analysis.horizon?{p0:vp(analysis.horizon.p0),p1:vp(analysis.horizon.p1)}:null,
  };
}

let tfActive=false;
let tfGroupMode=false;   // true when the transform is acting on a whole active group, not a single layer
let tfGroupId=null;
let tfMemberIdx=null;    // layer indices belonging to the active group (group mode only)
let tfMembers=null;      // [{li, base}] pristine per-layer content snapshots (group mode only)
let tfSnapshot=null;     // pristine copy of activeC content when the tool was entered (single-layer mode)
let tfSmartMove=null;      // independent typed ownership snapshot for Smart Raster Free Transform
let tfBox=null;          // {x,y,w,h} axis-aligned bbox of the artwork, in original canvas coords
let tfState=null;        // {tx,ty,scale,rotation} — cumulative transform applied to tfBox's center
let tfDrag=null;         // current drag mode: 'move' | 'scale' | 'rotate' | 'pivot' | null
let tfDragInfo=null;     // scratch data for the active drag
// Pivot point — the origin rotation/scaling is performed around. Stored in
// local/original canvas coords (same space as tfBox), independent of the
// current tx/ty/scale/rotation, so it stays put relative to the artwork as
// the transform changes. Defaults to the box center; user-draggable.
// Deliberately generic (just a local-space point + helpers to convert it
// to/from world space under *any* state) so Perspective, Warp, and future
// transform modes can read/drive the same pivot without duplicating logic.
let tfPivot=null;        // {x,y} in local/original canvas coords, or null when no transform is active
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

function _tfCenter(state){
  state=state||tfState;
  return {x:tfBox.x+tfBox.w/2+state.tx, y:tfBox.y+tfBox.h/2+state.ty};
}

// ── Pivot helpers ───────────────────────────────────────────────
// Generic local-space <-> world-space conversion for a point under a given
// transform state (defaults to the live tfState). "Local" is the same
// coordinate space as tfBox — i.e. original, untransformed canvas coords.
// Kept separate from any single mode's math so Free, Perspective, Warp,
// etc. can all place/read the pivot consistently.
function _tfLocalToWorld(local,state){
  state=state||tfState;
  const c=_tfCenter(state);
  const rad=state.rotation*Math.PI/180, cosR=Math.cos(rad), sinR=Math.sin(rad);
  const bx=tfBox.x+tfBox.w/2, by=tfBox.y+tfBox.h/2;
  const dx=(local.x-bx)*state.scale, dy=(local.y-by)*state.scale;
  return {x:c.x+dx*cosR-dy*sinR, y:c.y+dx*sinR+dy*cosR};
}
function _tfWorldToLocal(world,state){
  state=state||tfState;
  const c=_tfCenter(state);
  const rad=-state.rotation*Math.PI/180, cosR=Math.cos(rad), sinR=Math.sin(rad);
  const dx=world.x-c.x, dy=world.y-c.y;
  const s=state.scale||1;
  const lx=(dx*cosR-dy*sinR)/s, ly=(dx*sinR+dy*cosR)/s;
  const bx=tfBox.x+tfBox.w/2, by=tfBox.y+tfBox.h/2;
  return {x:bx+lx, y:by+ly};
}
// Current on-screen position of the pivot handle.
function _tfPivotWorld(state){ return _tfLocalToWorld(tfPivot,state); }
// Update tfState's rotation/scale to the given values while recomputing
// tx/ty so that `pivotWorld` (the pivot's canvas position, captured before
// the change) stays exactly where it was — i.e. rotation/scaling orbits the
// pivot instead of the box center. This is the one bit of math any
// transform mode needs to make its rotate/scale interactions pivot-aware.
function _tfSetStateForPivot(pivotWorld,rotation,scale){
  const rad=rotation*Math.PI/180, cosR=Math.cos(rad), sinR=Math.sin(rad);
  const bx=tfBox.x+tfBox.w/2, by=tfBox.y+tfBox.h/2;
  const dx=(tfPivot.x-bx)*scale, dy=(tfPivot.y-by)*scale;
  tfState.tx=(pivotWorld.x-(dx*cosR-dy*sinR))-bx;
  tfState.ty=(pivotWorld.y-(dx*sinR+dy*cosR))-by;
  tfState.rotation=rotation;
  tfState.scale=scale;
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
    const safe=Math.abs(det)>1e-6;
    g=safe?(dx3*dy2-dx2*dy3)/det:0;
    h=safe?(dx1*dy3-dx3*dy1)/det:0;
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
// Small destination-space overdraw applied to every triangle's clip path
// (not to the source sampling) so adjacent triangles overlap by a
// sub-pixel amount instead of abutting exactly. Canvas anti-aliases each
// clip path independently, so triangles that only *touch* leave a hairline
// gap/seam along shared edges; a tiny outward bleed toward each triangle's
// own centroid closes that gap without visibly duplicating content, since
// the overlap is <1px of the same continuous image.
const TF_TRI_BLEED=0.75;
function _tfOutset(p,cx,cy,amt){
  const dx=p.x-cx, dy=p.y-cy;
  const len=Math.hypot(dx,dy)||1;
  return {x:p.x+dx/len*amt, y:p.y+dy/len*amt};
}
function _tfDrawTri(dctx,img,s0,s1,s2,d0,d1,d2){
  const denom=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
  if(!denom) return;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/denom;
  const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/denom;
  const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/denom;
  const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/denom;
  const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/denom;
  const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/denom;
  const cx=(d0.x+d1.x+d2.x)/3, cy=(d0.y+d1.y+d2.y)/3;
  const e0=_tfOutset(d0,cx,cy,TF_TRI_BLEED), e1=_tfOutset(d1,cx,cy,TF_TRI_BLEED), e2=_tfOutset(d2,cx,cy,TF_TRI_BLEED);
  dctx.save();
  dctx.beginPath();
  dctx.moveTo(e0.x,e0.y);dctx.lineTo(e1.x,e1.y);dctx.lineTo(e2.x,e2.y);dctx.closePath();
  dctx.clip();
  // Affine mapping itself is computed from the true (un-outset) triangle
  // correspondence above, so the extra bleed only extends sampling a
  // fraction of a pixel past the source triangle's own edge — into
  // immediately-adjacent, visually identical source content — rather than
  // distorting the mapping.
  dctx.transform(a,b,c,d,e,f);
  dctx.imageSmoothingEnabled=true;
  if('imageSmoothingQuality' in dctx) dctx.imageSmoothingQuality='high';
  dctx.drawImage(img,0,0);
  dctx.restore();
}
// Warp `img`'s (sx,sy,sw,sh) source rect onto the quad `corners`
// (TL,TR,BR,BL, destination canvas coords) using an NxN triangle grid.
function _tfDrawPerspective(dctx,img,sx,sy,sw,sh,corners,gridN){
  const H=_tfQuadH(corners[0],corners[1],corners[2],corners[3]);
  const n=gridN||18;
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

function _tfCaptureSmartMove(li,fi,bounds){
  const layer=layers[li];
  if(!layer||layer.type!=='smart-raster'||!window.SmartRasterLayer)return null;
  const frame=SmartRasterLayer.ensureFrame(li,fi);
  if(!frame)return null;
  return {
    layer:li,
    frame:fi,
    width:frame.width,
    height:frame.height,
    bounds:{x:bounds.x,y:bounds.y,w:bounds.w,h:bounds.h},
    styleIds:frame.styleIds.slice(),
    meta:SmartRasterLayer.cloneMeta(frame.meta)
  };
}

function _tfCommitSmartFreeTransform(){
  if(!tfSmartMove)return;
  const source=tfSmartMove;
  const layer=layers[source.layer];
  if(!layer||layer.type!=='smart-raster')return;

  // RGBA is already rendered into activeC by _tfRedraw() with this matrix:
  // destination = transformed center + rotation * scale * (source - box center).
  // Walk destination pixels and apply its exact inverse, sampling ownership
  // with nearest-neighbor so style indexes remain integers.
  const outputIds=new Uint16Array(source.width*source.height);
  const outputRgba=ctx.getImageData(0,0,source.width,source.height).data;
  const sourceRgba=tfSnapshot.getContext('2d',{willReadFrequently:true})
    .getImageData(0,0,source.width,source.height).data;
  const boxCenterX=tfBox.x+tfBox.w/2,boxCenterY=tfBox.y+tfBox.h/2;
  const center=_tfCenter(tfState);
  const scale=tfState.scale||1;
  const radians=tfState.rotation*Math.PI/180;
  const cosR=Math.cos(radians),sinR=Math.sin(radians);

  const transformedCorners=[
    {x:tfBox.x,y:tfBox.y},
    {x:tfBox.x+tfBox.w,y:tfBox.y},
    {x:tfBox.x+tfBox.w,y:tfBox.y+tfBox.h},
    {x:tfBox.x,y:tfBox.y+tfBox.h}
  ].map(point=>{
    const dx=(point.x-boxCenterX)*scale,dy=(point.y-boxCenterY)*scale;
    return {x:center.x+dx*cosR-dy*sinR,y:center.y+dx*sinR+dy*cosR};
  });
  const minX=Math.max(0,Math.floor(Math.min(...transformedCorners.map(p=>p.x)))-2);
  const minY=Math.max(0,Math.floor(Math.min(...transformedCorners.map(p=>p.y)))-2);
  const maxX=Math.min(source.width,Math.ceil(Math.max(...transformedCorners.map(p=>p.x)))+2);
  const maxY=Math.min(source.height,Math.ceil(Math.max(...transformedCorners.map(p=>p.y)))+2);

  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const destinationOffset=y*source.width+x;
    if(outputRgba[destinationOffset*4+3]===0)continue;
    const worldX=x+0.5-center.x,worldY=y+0.5-center.y;
    const localX=(worldX*cosR+worldY*sinR)/scale+boxCenterX;
    const localY=(-worldX*sinR+worldY*cosR)/scale+boxCenterY;
    if(localX<tfBox.x||localX>=tfBox.x+tfBox.w||localY<tfBox.y||localY>=tfBox.y+tfBox.h)continue;
    const sourceX=Math.floor(localX),sourceY=Math.floor(localY);
    if(sourceX<0||sourceX>=source.width||sourceY<0||sourceY>=source.height)continue;
    const sourceOffset=sourceY*source.width+sourceX;
    if(sourceRgba[sourceOffset*4+3]===0)continue;
    outputIds[destinationOffset]=source.styleIds[sourceOffset]||0;
  }

  if(!layer.smartStyleFrames)layer.smartStyleFrames={};
  layer.smartStyleFrames[source.frame]={
    width:source.width,
    height:source.height,
    styleIds:outputIds,
    meta:SmartRasterLayer.cloneMeta(source.meta)
  };
}

function _tfInvertHomography(H){
  const a=H.a,b=H.b,c=H.c,d=H.d,e=H.e,f=H.f,g=H.g,h=H.h,i=1;
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e;
  const D=f*g-d*i,E=a*i-c*g,F=c*d-a*f;
  const G=d*h-e*g,Hc=b*g-a*h,I=a*e-b*d;
  const determinant=a*A+b*D+c*G;
  if(Math.abs(determinant)<1e-10)return null;
  const inv=1/determinant;
  return {a:A*inv,b:B*inv,c:C*inv,d:D*inv,e:E*inv,f:F*inv,g:G*inv,h:Hc*inv,i:I*inv};
}

function _tfCommitSmartPerspectiveTransform(){
  if(!tfSmartMove||!tfCorners)return;
  const source=tfSmartMove;
  const layer=layers[source.layer];
  if(!layer||layer.type!=='smart-raster')return;
  const homography=_tfQuadH(tfCorners[0],tfCorners[1],tfCorners[2],tfCorners[3]);
  const inverse=_tfInvertHomography(homography);
  if(!inverse)return;

  const outputIds=new Uint16Array(source.width*source.height);
  const outputRgba=ctx.getImageData(0,0,source.width,source.height).data;
  const sourceRgba=tfSnapshot.getContext('2d',{willReadFrequently:true})
    .getImageData(0,0,source.width,source.height).data;
  const minX=Math.max(0,Math.floor(Math.min(...tfCorners.map(p=>p.x)))-2);
  const minY=Math.max(0,Math.floor(Math.min(...tfCorners.map(p=>p.y)))-2);
  const maxX=Math.min(source.width,Math.ceil(Math.max(...tfCorners.map(p=>p.x)))+2);
  const maxY=Math.min(source.height,Math.ceil(Math.max(...tfCorners.map(p=>p.y)))+2);

  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const destinationOffset=y*source.width+x;
    if(outputRgba[destinationOffset*4+3]===0)continue;
    const px=x+0.5,py=y+0.5;
    const denominator=inverse.g*px+inverse.h*py+inverse.i;
    if(Math.abs(denominator)<1e-10)continue;
    const u=(inverse.a*px+inverse.b*py+inverse.c)/denominator;
    const v=(inverse.d*px+inverse.e*py+inverse.f)/denominator;
    if(u<0||u>=1||v<0||v>=1)continue;
    const sourceX=Math.floor(source.bounds.x+u*source.bounds.w);
    const sourceY=Math.floor(source.bounds.y+v*source.bounds.h);
    if(sourceX<0||sourceX>=source.width||sourceY<0||sourceY>=source.height)continue;
    const sourceOffset=sourceY*source.width+sourceX;
    if(sourceRgba[sourceOffset*4+3]===0)continue;
    outputIds[destinationOffset]=source.styleIds[sourceOffset]||0;
  }

  if(!layer.smartStyleFrames)layer.smartStyleFrames={};
  layer.smartStyleFrames[source.frame]={
    width:source.width,
    height:source.height,
    styleIds:outputIds,
    meta:SmartRasterLayer.cloneMeta(source.meta)
  };
}

function enterTransformTool(){
  if(tfActive) return;
  tfSmartMove=null;

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
    tfSmartMove=_tfCaptureSmartMove(curLayer,curFrame,tfBox);
    _tfHiddenLayers=new Set();
    pushUndo();
  }

  tfState={tx:0,ty:0,scale:1,rotation:0};
  tfPivot={x:tfBox.x+tfBox.w/2, y:tfBox.y+tfBox.h/2}; // reset to box center for every new transform
  tfPerspective=false;
  tfCorners=null;
  tfActive=true;
  transformC.classList.add('tf-active');
  _tfSyncToggleUI();
  _tfSyncGuideCanvasActive();
  _tfRedraw();
}

function commitTransformTool(){
  if(!tfActive) return;
  tfActive=false;
  transformC.classList.remove('tf-active');
  tfCtx.clearRect(0,0,CW,CH);
  perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);
  _tfSyncGuideCanvasActive();

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
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfBox=null;tfState=null;tfPivot=null;
    tfPerspective=false;tfCorners=null;
    return;
  }

  if(tfPerspective){
    const out=mkLayerCanvas();
    _tfDrawPerspective(out.getContext('2d'),tfSnapshot,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,28);
    ctx.clearRect(0,0,CW,CH);
    ctx.drawImage(out,0,0);
  }

  if(tfPerspective)_tfCommitSmartPerspectiveTransform();
  else _tfCommitSmartFreeTransform();
  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfSmartMove=null;tfBox=null;tfState=null;tfPivot=null;
  tfPerspective=false;tfCorners=null;
}

function cancelTransformTool(){
  if(!tfActive) return;
  tfActive=false;
  transformC.classList.remove('tf-active');
  tfCtx.clearRect(0,0,CW,CH);
  perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);
  _tfSyncGuideCanvasActive();

  if(tfGroupMode){
    _tfHiddenLayers=new Set();
    recomposite(curLayer,curFrame);
    renderTimeline();
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfBox=null;tfState=null;tfPivot=null;
    tfPerspective=false;tfCorners=null;
    return;
  }

  ctx.clearRect(0,0,CW,CH);
  if(tfSnapshot) ctx.drawImage(tfSnapshot,0,0);
  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  tfSnapshot=null;tfSmartMove=null;tfBox=null;tfState=null;tfPivot=null;
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
  _tfDrawPivotHandle();
  tfCtx.restore();
}

// Pivot handle — a small circled crosshair, drawn distinctly (yellow) from
// the corner/rotate handles so it reads as "the origin", not another
// resize control. Shared by every mode that has a rotate/scale pivot;
// currently only Free transform draws it, but the drawing + hit-test logic
// live here so Perspective/Warp can opt in later without duplicating this.
function _tfDrawPivotHandle(){
  if(!tfPivot) return;
  const p=_tfPivotWorld();
  const hr=TF_HANDLE_R/zoom;
  tfCtx.save();
  tfCtx.strokeStyle='#ffd24d';
  tfCtx.fillStyle='rgba(255,210,77,0.25)';
  tfCtx.lineWidth=Math.max(1,1.5/zoom);
  tfCtx.beginPath();tfCtx.arc(p.x,p.y,hr*0.7,0,Math.PI*2);tfCtx.fill();tfCtx.stroke();
  tfCtx.beginPath();tfCtx.moveTo(p.x-hr/2,p.y);tfCtx.lineTo(p.x+hr/2,p.y);
  tfCtx.moveTo(p.x,p.y-hr/2);tfCtx.lineTo(p.x,p.y+hr/2);tfCtx.stroke();
  tfCtx.restore();
}

// Perspective-mode handle drawing: the quad outline, its 4 independently-
// draggable corner handles (square), and 4 edge-midpoint handles (diamond)
// that move+adjust a whole edge at once. No rotate handle or pivot —
// corner/edge dragging alone covers move/scale/skew/perspective.
function _tfDrawHandlesPerspective(clearFirst){
  if(clearFirst) tfCtx.clearRect(0,0,CW,CH);
  _tfResizeGuideCanvas();
  perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);
  if(tfOptionValues.perspectiveGuidesEnabled){
    // Detected fresh from the *current* quad every redraw — never from
    // which handle was last touched — so it's always in sync, and shows
    // nothing at all once the quad is back to an unconverged rectangle.
    // Analyzed in local canvas coords, then re-expressed in viewport coords
    // and drawn on the viewport-sized overlay canvas, so VPs/horizon can
    // render out past the artwork edge and only get clipped at the visible
    // workspace edge (canvas-area), not the artwork's own bounds. Points
    // are already in on-screen pixel units after the transform, so scale:1
    // here (zoom compensation happens implicitly via _tfToViewportPoint).
    const analysis=PerspectiveController.analyze(tfCorners);
    const viewAnalysis=_tfAnalysisToViewport(analysis);
    PerspectiveController.draw(perspGuideCtx,viewAnalysis,{scale:1,width:perspGuideC.width,height:perspGuideC.height});
  }
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
  const mids=_tfPolyEdgeMidpoints(tfCorners);
  const dr=hr*0.62;
  mids.forEach(p=>{
    tfCtx.beginPath();
    tfCtx.moveTo(p.x,p.y-dr);tfCtx.lineTo(p.x+dr,p.y);
    tfCtx.lineTo(p.x,p.y+dr);tfCtx.lineTo(p.x-dr,p.y);
    tfCtx.closePath();tfCtx.fill();tfCtx.stroke();
  });
  tfCtx.restore();
}

function _tfDist(ax,ay,bx,by){ return Math.hypot(ax-bx,ay-by); }

// Midpoint of every consecutive edge of an arbitrary point-array poly
// (wrapping last->first). Generic on purpose: works for the 4-point
// Perspective quad today, and for any N-point control cage a future Mesh,
// Warp, or Cage transform mode would use — those modes can reuse this same
// helper (plus the edge hit-test / drag-translate pattern below) instead of
// re-deriving edge handles themselves.
function _tfPolyEdgeMidpoints(poly){
  return poly.map((p,i)=>{
    const q=poly[(i+1)%poly.length];
    return {x:(p.x+q.x)/2, y:(p.y+q.y)/2};
  });
}

function _tfHitTest(p){
  const hitR=TF_HANDLE_R/zoom+4/zoom;
  if(tfPivot){
    const pivP=_tfPivotWorld();
    if(_tfDist(p.x,p.y,pivP.x,pivP.y)<=hitR) return {mode:'pivot'};
  }
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
  // VP / horizon handles are checked before edge-midpoint handles: once
  // one axis has been dragged, the *other* (still-unconverged) axis's
  // placeholder handle is re-derived from the now-skewed quad and can
  // land close to an edge midpoint. Edge midpoints previously took
  // priority here, which could make that VP's own hit circle
  // unreachable even though the pointer was legitimately over it — VP1
  // and VP2 need identical, order-independent access to their handles.
  if(tfOptionValues.perspectiveGuidesEnabled){
    const analysis=PerspectiveController.analyze(tfCorners);
    const vpAxisId=PerspectiveController.hitTestVP(p,analysis,hitR*1.3);
    if(vpAxisId) return {mode:'vp',axisId:vpAxisId};
    if(PerspectiveController.hitTestHorizon(p,analysis,hitR)) return {mode:'horizon'};
  }
  const mids=_tfPolyEdgeMidpoints(tfCorners);
  for(let i=0;i<mids.length;i++){
    if(_tfDist(p.x,p.y,mids[i].x,mids[i].y)<=hitR) return {mode:'pedge',edgeIndex:i};
  }
  if(_tfPointInPoly(p,tfCorners)) return {mode:'pmove'};
  return null;
}

function _tfPerspPointerDown(e){
  if(!tfActive||!tfPerspective) return;
  e.preventDefault();
  const p=getPos(e);
  const hit=_tfHitTestPerspective(p);
  if(!hit) return;
  perspGuideC.setPointerCapture(e.pointerId);
  tfDrag=hit.mode;
  if(hit.mode==='pcorner'){
    tfCornerDrag=hit.cornerIndex;
    tfDragInfo={startP:p,startCorner:Object.assign({},tfCorners[hit.cornerIndex])};
  } else if(hit.mode==='pedge'){
    const i0=hit.edgeIndex, i1=(hit.edgeIndex+1)%tfCorners.length;
    tfDragInfo={startP:p,edgeIndex:hit.edgeIndex,
      startA:Object.assign({},tfCorners[i0]), startB:Object.assign({},tfCorners[i1])};
  } else if(hit.mode==='vp'){
    // Capture the *other* axis's current VP once, here at drag start —
    // this is the fixed world-space constraint that must NOT move for
    // the rest of this drag. It is deliberately not recomputed inside
    // the pointermove handler below; doing so from the live (already
    // partially re-solved) quad every frame is what previously let it
    // drift as the two VPs converged.
    const analysis=PerspectiveController.analyze(tfCorners);
    const otherVP=analysis.vanishingPoints.find(v=>v.axisId!==hit.axisId);
    tfDragInfo={axisId:hit.axisId,startP:p,startCorners:tfCorners.map(c=>({x:c.x,y:c.y})),
      fixedOtherVP:otherVP?{x:otherVP.x,y:otherVP.y}:null};
  } else if(hit.mode==='horizon'){
    // Same idea: capture both starting VPs once, fixed for the whole
    // drag, and measure dy from this same start every frame (rather
    // than incrementally re-basing startP each move, which would
    // otherwise re-read the "current" VPs off the live quad).
    const analysis=PerspectiveController.analyze(tfCorners);
    tfDragInfo={startP:p,startCorners:tfCorners.map(c=>({x:c.x,y:c.y})),
      startVP1:Object.assign({},analysis.vanishingPoints[0]),
      startVP2:Object.assign({},analysis.vanishingPoints[1])};
  } else {
    tfDragInfo={startP:p,startCorners:tfCorners.map(c=>({x:c.x,y:c.y}))};
  }
}
// perspGuideC is a viewport-sized canvas that sits ABOVE transformC and
// becomes pointer-interactive only in Perspective mode (see
// _tfSyncGuideCanvasActive) — this is what lets VP/horizon handles be
// grabbed even when they're rendered outside the artwork's own bounds,
// where transformC (clipped to CW×CH) never receives the pointer event at
// all. transformC's own perspective branch below early-returns in that
// case since perspGuideC is now the sole handler for perspective drags.
perspGuideC.addEventListener('pointerdown',_tfPerspPointerDown);

transformC.addEventListener('pointerdown',e=>{
  if(!tfActive) return;
  if(tfPerspective) return; // handled by perspGuideC instead — see above
  e.preventDefault();
  const p=getPos(e);
  const hit=_tfHitTest(p);
  if(!hit) return;
  transformC.setPointerCapture(e.pointerId);
  tfDrag=hit.mode;
  if(hit.mode==='pivot'){
    tfDragInfo={};
    return;
  }
  const c=_tfCenter();
  tfDragInfo={
    startP:p,
    startState:Object.assign({},tfState),
    startCenter:c,
    startDist:_tfDist(p.x,p.y,c.x,c.y),
    startAngle:Math.atan2(p.y-c.y,p.x-c.x),
    // Fixed pivot world-position for the duration of a scale/rotate drag —
    // captured once here so scale/rotate can keep re-solving tx/ty against
    // the *same* anchor point rather than one that drifts frame to frame.
    startPivotWorld:_tfPivotWorld(tfState),
  };
});
function _tfPerspPointerMoveDrag(e){
  if(!tfActive||!tfDrag) return;
  e.preventDefault();
  const p=getPos(e);
  let candidate=tfCorners;
  if(tfDrag==='pcorner'){
    candidate=tfCorners.map((c,i)=>i===tfCornerDrag?{
      x:tfDragInfo.startCorner.x+(p.x-tfDragInfo.startP.x),
      y:tfDragInfo.startCorner.y+(p.y-tfDragInfo.startP.y)
    }:c);
  } else if(tfDrag==='pedge'){
    // Translate both endpoints of the edge by the same delta — moves
    // that whole side (and drags the perspective distortion along with
    // it) while leaving the edge's own length/angle, and the opposite
    // side, untouched.
    const dx=p.x-tfDragInfo.startP.x, dy=p.y-tfDragInfo.startP.y;
    const i0=tfDragInfo.edgeIndex, i1=(tfDragInfo.edgeIndex+1)%tfCorners.length;
    candidate=tfCorners.map((c,i)=>{
      if(i===i0) return {x:tfDragInfo.startA.x+dx,y:tfDragInfo.startA.y+dy};
      if(i===i1) return {x:tfDragInfo.startB.x+dx,y:tfDragInfo.startB.y+dy};
      return c;
    });
  } else if(tfDrag==='pmove'){
    const dx=p.x-tfDragInfo.startP.x, dy=p.y-tfDragInfo.startP.y;
    candidate=tfCorners.map((c,i)=>({x:tfDragInfo.startCorners[i].x+dx, y:tfDragInfo.startCorners[i].y+dy}));
  } else if(tfDrag==='vp'){
    // Dragging a vanishing point rotates that axis's two edges rigidly
    // about their own near anchors (never pulls/stretches a corner) so
    // the resulting VP lands under the pointer and neither edge
    // touching the dragged axis ever shrinks or expands. Solved from
    // tfDragInfo.startCorners — the quad exactly as it was at
    // pointer-down — rather than the live tfCorners, so every frame is
    // an independent, from-scratch solve against the same fixed
    // starting shape instead of compounding small changes onto
    // whatever the previous frame's output happened to be.
    candidate=PerspectiveController.dragAxisVP(tfDragInfo.startCorners,tfDragInfo.axisId,p,tfDragInfo.fixedOtherVP);
  } else if(tfDrag==='horizon'){
    const dy=p.y-tfDragInfo.startP.y;
    candidate=PerspectiveController.dragHorizon(tfDragInfo.startCorners,tfDragInfo.startVP1,tfDragInfo.startVP2,dy);
  }
  // Reject any update that would fold the quad into a self-intersecting
  // or reflex shape — that's exactly the configuration that sends the
  // Heckbert homography's perspective divide through zero inside the
  // unit square (points shoot to infinity, warp looks "tangled"). This
  // caps every perspective interaction — corner, edge, VP, horizon — at
  // the same source of instability instead of patching each one.
  if(PerspectiveController.isValidQuad(candidate)) tfCorners=candidate;
  _tfRedraw();
}
// Pointer capture (set in _tfPerspPointerDown) redirects every subsequent
// pointermove/up/cancel to whichever element called setPointerCapture —
// so once a perspective drag starts on perspGuideC, transformC never sees
// these events again regardless of where the cursor actually is. That's
// exactly what we want: it's what lets a VP be dragged from way outside
// the artwork all the way back in without the drag ever "letting go".
perspGuideC.addEventListener('pointermove',_tfPerspPointerMoveDrag);

transformC.addEventListener('pointermove',e=>{
  if(!tfActive||!tfDrag||tfPerspective) return;
  e.preventDefault();
  const p=getPos(e);
  if(tfDrag==='pivot'){
    // Pivot handle itself: re-derive its local coord from the mouse's
    // current world position under the *live* (unchanging during this
    // drag) state, so it tracks the cursor exactly.
    tfPivot=_tfWorldToLocal(p,tfState);
    _tfRedraw();
    return;
  }
  if(tfDrag==='move'){
    const nextX=tfDragInfo.startState.tx+(p.x-tfDragInfo.startP.x);
    const nextY=tfDragInfo.startState.ty+(p.y-tfDragInfo.startP.y);
    tfState.tx=nextX;
    tfState.ty=nextY;
  }else if(tfDrag==='scale'){
    const d=_tfDist(p.x,p.y,tfDragInfo.startCenter.x,tfDragInfo.startCenter.y);
    const ratio=tfDragInfo.startDist>1?d/tfDragInfo.startDist:1;
    const newScale=Math.max(0.02,Math.min(50,tfDragInfo.startState.scale*ratio));
    // Scale around the pivot, not the box center: re-solve tx/ty so the
    // pivot's on-screen position (captured at drag start) doesn't move.
    _tfSetStateForPivot(tfDragInfo.startPivotWorld,tfDragInfo.startState.rotation,newScale);
  }else if(tfDrag==='rotate'){
    const ang=Math.atan2(p.y-tfDragInfo.startCenter.y,p.x-tfDragInfo.startCenter.x);
    const deltaDeg=(ang-tfDragInfo.startAngle)*180/Math.PI;
    let newRot=tfDragInfo.startState.rotation+deltaDeg;
    if(e.shiftKey) newRot=Math.round(newRot/15)*15;
    // Rotate around the pivot, not the box center — same idea as scale above.
    _tfSetStateForPivot(tfDragInfo.startPivotWorld,newRot,tfDragInfo.startState.scale);
  }
  _tfRedraw();
});
function _tfEndDrag(e){
  if(!tfDrag) return;
  if(transformC.hasPointerCapture&&transformC.hasPointerCapture(e.pointerId)) transformC.releasePointerCapture(e.pointerId);
  if(perspGuideC.hasPointerCapture&&perspGuideC.hasPointerCapture(e.pointerId)) perspGuideC.releasePointerCapture(e.pointerId);
  tfDrag=null;tfDragInfo=null;tfCornerDrag=null;
}
transformC.addEventListener('pointerup',_tfEndDrag);
transformC.addEventListener('pointercancel',_tfEndDrag);
perspGuideC.addEventListener('pointerup',_tfEndDrag);
perspGuideC.addEventListener('pointercancel',_tfEndDrag);

perspGuideC.addEventListener('pointermove',e=>{
  if(!tfActive||tfDrag||!tfPerspective) return;
  const hit=_tfHitTestPerspective(getPos(e));
  perspGuideC.style.cursor=hit?((hit.mode==='pcorner'||hit.mode==='pedge'||hit.mode==='vp')?'crosshair':hit.mode==='horizon'?'ns-resize':'move'):'default';
});

transformC.addEventListener('pointermove',e=>{
  if(!tfActive||tfDrag||tfPerspective) return;
  const hit=_tfHitTest(getPos(e));
  transformC.style.cursor=hit?(hit.mode==='pivot'?'crosshair':hit.mode==='rotate'?'grab':hit.mode==='scale'?'nwse-resize':'move'):'default';
});

document.addEventListener('keydown',e=>{
  if(!tfActive) return;
  if(e.target.tagName==='INPUT') return;
  if(e.key==='Enter'){ e.preventDefault(); setTool('brush','Brush'); }
  else if(e.key==='Escape'){ e.preventDefault(); cancelTransformTool(); setTool('brush','Brush'); }
});

// ── Transform Options panel ─────────────────────────────────────
// Per-mode checkbox options rendered into the "Transform Options" section
// of the Transform panel (index.html #tf-options-body). Purely-visual
// overlays — toggling them only affects what's drawn on the tfCtx overlay
// canvas, never the artwork itself (commit/cancel never read tfOptionValues).
// Keyed by mode so a future Warp/Mesh/Cage mode can register its own
// options list here without touching the render/wiring code below.
const TF_MODE_OPTIONS={
  free:[],
  perspective:[
    {id:'perspectiveGuidesEnabled',label:'Perspective Guides (Beta)',default:true},
  ],
};
let tfOptionValues={};
Object.values(TF_MODE_OPTIONS).forEach(list=>list.forEach(o=>{ tfOptionValues[o.id]=o.default; }));

const _tfOptionsBody=document.getElementById('tf-options-body');

// Current mode key into TF_MODE_OPTIONS. Only 'free'/'perspective' exist
// today; a future mode just needs to make this resolve to its own key
// (e.g. via a shared tfMode variable) once it's wired up.
function _tfCurrentModeKey(){ return tfPerspective?'perspective':'free'; }

// Rebuilds the checkbox list for whichever mode is active. Free Transform
// has no options registered, so the section renders empty and hides itself.
function _tfRenderOptionsPanel(){
  if(!_tfOptionsBody) return;
  const opts=TF_MODE_OPTIONS[_tfCurrentModeKey()]||[];
  _tfOptionsBody.innerHTML='';
  _tfOptionsBody.style.display=opts.length?'':'none';
  opts.forEach(o=>{
    const row=document.createElement('label');
    row.className='tf-option-row';
    row.style.cssText='display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text);cursor:pointer;user-select:none;';
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked=!!tfOptionValues[o.id];
    cb.addEventListener('change',()=>{
      tfOptionValues[o.id]=cb.checked;
      if(tfActive) _tfRedraw(); // live-update the overlay while transforming
    });
    row.appendChild(cb);
    row.appendChild(document.createTextNode(o.label));
    _tfOptionsBody.appendChild(row);
  });
}
_tfRenderOptionsPanel();

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
  _tfRenderOptionsPanel();
}

// Switch between Free (move/scale/rotate) and Perspective (independent
// corner drag) without leaving the transform tool — same snapshot/box,
// same commit/cancel flow, just a different interaction+render path.
function _tfSetPerspective(on){
  if(!tfActive||on===tfPerspective) return;
  if(on){
    tfCorners=_tfFreeCorners().map(p=>({x:p.x,y:p.y}));
    if(tfSmartMove)tfSmartMove.sourceCorners=tfCorners.map(p=>({x:p.x,y:p.y}));
  } else {
    tfCorners=null;
  }
  tfPerspective=on;
  _tfSyncToggleUI();
  _tfSyncGuideCanvasActive();
  _tfRedraw();
}
// ── Continuous guide re-sync during zoom/pan/rotate ─────────────────
// perspGuideC's guide points are computed in viewport (screen) space at
// draw-time (_tfToViewportPoint), unlike everything drawn on tfCtx, which
// stays correct automatically under any zoom/pan/rotate because it's
// inside canvas-wrap and rides along with its CSS transform for free.
// Zooming/panning the canvas doesn't route through any of transform-tool's
// own drag handlers (it's handled entirely in core-state.js), so without
// this, the guide overlay would only refresh on the next VP/corner drag —
// visibly drifting out of alignment with the artwork the moment you zoom
// or pan while Perspective mode is active. A lightweight per-frame resync
// (same pattern as brush-size-cursor.js's loop) keeps it pixel-locked to
// the artwork no matter what moved the view.
(function _tfGuideSyncLoop(){
  if(tfActive&&tfPerspective) _tfDrawHandlesPerspective(true);
  requestAnimationFrame(_tfGuideSyncLoop);
})();