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
const tfUiC=document.getElementById('transform-ui-canvas');
const tfUiCtx=tfUiC.getContext('2d');
const tfActionControls=document.createElement('div');tfActionControls.className='tf-floating-actions';tfActionControls.hidden=true;
const tfConfirmButton=document.createElement('button'),tfCancelButton=document.createElement('button');
tfConfirmButton.type=tfCancelButton.type='button';tfConfirmButton.className='tf-floating-action tf-floating-confirm';tfCancelButton.className='tf-floating-action tf-floating-cancel';tfConfirmButton.textContent='\u2713';tfCancelButton.textContent='\u00d7';tfConfirmButton.title='Confirm transform';tfCancelButton.title='Cancel transform';tfConfirmButton.setAttribute('aria-label','Confirm transform');tfCancelButton.setAttribute('aria-label','Cancel transform');tfActionControls.append(tfConfirmButton,tfCancelButton);document.getElementById('canvas-area').appendChild(tfActionControls);


// ── Perspective guide overlay (VPs / horizon line) ─────────────────
// Drawn on a SEPARATE canvas sized to the canvas-area viewport, not to
// the artwork — see #perspective-guide-canvas in index.html/style.css for
// why. tfCtx (transformC) stays CW×CH and clips guides to the artwork's
// own bounds, which is what made VPs/horizon invisible outside the
// canvas in the first place.
const perspGuideC=document.getElementById('perspective-guide-canvas');
const perspGuideCtx=perspGuideC.getContext('2d');

function _tfResizeGuideCanvas(){
  const r=canvasArea.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1);
  const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(perspGuideC.width!==w)perspGuideC.width=w;if(perspGuideC.height!==h)perspGuideC.height=h;
  if(tfUiC.width!==w)tfUiC.width=w;if(tfUiC.height!==h)tfUiC.height=h;
  perspGuideCtx.setTransform(dpr,0,0,dpr,0,0);tfUiCtx.setTransform(dpr,0,0,dpr,0,0);
  return{width:r.width,height:r.height,dpr};
}
function _tfClearUi(){
  tfUiCtx.setTransform(1,0,0,1,0,0);tfUiCtx.clearRect(0,0,tfUiC.width,tfUiC.height);
  const dpr=Math.max(1,window.devicePixelRatio||1);tfUiCtx.setTransform(dpr,0,0,dpr,0,0);
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
  tfUiC.classList.toggle('tf-free-active', !!(tfActive&&!tfPerspective));
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
let tfSnapshot=null;     // pristine full-frame content; _tfOriginX/_tfOriginY place it in document space
let tfSmartMove=null;      // independent typed ownership snapshot for Smart Raster Free Transform
let tfPixelSelection=null; // canonical selected source/background split, when a pixel selection is active
let tfViewportPreviewEntries=null; // bounds-sized immutable sources used only for the off-canvas live preview
let tfRasterPerspectivePreview=null; // bounds-sized immutable RGBA source for normal Raster final rasterization
let tfPerspectiveFastPreview=null; // reusable half-size, fully covered inverse-mapped drag preview
let tfPerspectivePreviewRaf=0;
let tfFreePreviewRaf=0;
let tfPerspectivePreviewFast=false;
let tfPerspectivePreviewExact=false;
const TF_ANTIALIAS_KEY='transform_antialiasing';
const TF_ANTIALIAS_ENABLED_KEY='transform_antialiasing_enabled';
const TF_ANTIALIAS_QUALITY_KEY='transform_antialiasing_quality';
let tfAntialiasingEnabled=true,tfAntialiasingQuality='medium',tfAntialiasing='medium';
try{
  const legacy=localStorage.getItem(TF_ANTIALIAS_KEY),savedEnabled=localStorage.getItem(TF_ANTIALIAS_ENABLED_KEY),savedQuality=localStorage.getItem(TF_ANTIALIAS_QUALITY_KEY);
  if(['weak','medium','strong'].includes(savedQuality))tfAntialiasingQuality=savedQuality;else if(['weak','medium','strong'].includes(legacy))tfAntialiasingQuality=legacy;
  tfAntialiasingEnabled=savedEnabled===null?legacy!=='none':savedEnabled==='true';
  tfAntialiasing=tfAntialiasingEnabled?tfAntialiasingQuality:'none';
}catch(_){}
function _tfPersistAntialiasing(){
  tfAntialiasing=tfAntialiasingEnabled?tfAntialiasingQuality:'none';
  try{localStorage.setItem(TF_ANTIALIAS_ENABLED_KEY,String(tfAntialiasingEnabled));localStorage.setItem(TF_ANTIALIAS_QUALITY_KEY,tfAntialiasingQuality);localStorage.setItem(TF_ANTIALIAS_KEY,tfAntialiasing);}catch(_){}
  if(tfActive)_tfRedraw(false);
}
let tfBox=null;          // {x,y,w,h} axis-aligned bbox of the artwork, in original canvas coords
let tfState=null;        // {tx,ty,scale,rotation} — cumulative transform applied to tfBox's center
let tfLastCommittedOperation=null; // operation-relative delta retained for TVPaint-style repeated Enter
let tfAwaitingRepeat=false; // committed Free Transform state: tool remains active, controls hidden until repeat preview
let tfPendingRepeatUndo=null; // recaptured committed state, promoted to undo only when the repeated preview is confirmed
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

function _tfConfigureSmoothing(context){
  const enabled=tfAntialiasing!=='none';context.imageSmoothingEnabled=enabled;
  if(enabled&&'imageSmoothingQuality' in context)context.imageSmoothingQuality=tfAntialiasing==='weak'?'low':tfAntialiasing==='strong'?'high':'medium';
}
function _tfResetPreviewContext(context){
  if(typeof context.resetTransform==='function')context.resetTransform();else context.setTransform(1,0,0,1,0,0);
  context.globalAlpha=1;context.globalCompositeOperation='source-over';
}
function _tfIsIntegerTranslation(state){
  state=state||tfState;if(!state)return false;const rotation=((state.rotation%360)+360)%360;
  return Math.abs(state.scale-1)<1e-9&&(rotation<1e-9||Math.abs(rotation-360)<1e-9)&&Math.abs(state.tx-Math.round(state.tx))<1e-6&&Math.abs(state.ty-Math.round(state.ty))<1e-6;
}
function _tfDrawFreeSource(context,source,state){
  state=state||tfState;const originX=Number(source&&source._tfOriginX)||0,originY=Number(source&&source._tfOriginY)||0;
  if(_tfIsIntegerTranslation(state)){context.imageSmoothingEnabled=false;context.drawImage(source,originX+Math.round(state.tx),originY+Math.round(state.ty));return;}
  const center=_tfCenter(state);context.save();context.translate(center.x,center.y);context.rotate(state.rotation*Math.PI/180);context.scale(state.scale,state.scale);context.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));_tfConfigureSmoothing(context);context.drawImage(source,originX,originY);context.restore();
}

function _tfCropViewportPreviewSource(source){
  const originX=Number(source&&source._tfOriginX)||0,originY=Number(source&&source._tfOriginY)||0;
  const worldX=Math.max(originX,Math.floor(tfBox.x)),worldY=Math.max(originY,Math.floor(tfBox.y));
  const right=Math.min(originX+source.width,Math.ceil(tfBox.x+tfBox.w)),bottom=Math.min(originY+source.height,Math.ceil(tfBox.y+tfBox.h));
  const width=Math.max(1,right-worldX),height=Math.max(1,bottom-worldY),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  canvas.getContext('2d').drawImage(source,worldX-originX,worldY-originY,width,height,0,0,width,height);return {canvas,x:worldX,y:worldY};
}
function _tfDrawViewportFreePreview(){
  if(tfPerspective||!tfViewportPreviewEntries||!tfViewportPreviewEntries.length)return;
  const hasLiveTransform=tfState&&(Math.abs(tfState.tx)>1e-9||Math.abs(tfState.ty)>1e-9||Math.abs(tfState.scale-1)>1e-9||Math.abs(tfState.rotation)>1e-9);
  if(!hasLiveTransform)return;
  const dpr=Math.max(1,window.devicePixelRatio||1),viewportWidth=tfUiC.width/dpr,viewportHeight=tfUiC.height/dpr;
  const documentCorners=[{x:0,y:0},{x:CW,y:0},{x:CW,y:CH},{x:0,y:CH}].map(_tfToViewportPoint),origin=_tfToViewportPoint({x:0,y:0}),axisX=_tfToViewportPoint({x:1,y:0}),axisY=_tfToViewportPoint({x:0,y:1});
  const c=tfUiCtx;c.save();c.beginPath();c.rect(0,0,viewportWidth,viewportHeight);c.moveTo(documentCorners[0].x,documentCorners[0].y);for(let index=1;index<documentCorners.length;index++)c.lineTo(documentCorners[index].x,documentCorners[index].y);c.closePath();c.clip('evenodd');
  c.transform(axisX.x-origin.x,axisX.y-origin.y,axisY.x-origin.x,axisY.y-origin.y,origin.x,origin.y);
  const center=_tfCenter(tfState);c.translate(center.x,center.y);c.rotate(tfState.rotation*Math.PI/180);c.scale(tfState.scale,tfState.scale);c.translate(-(tfBox.x+tfBox.w/2),-(tfBox.y+tfBox.h/2));_tfConfigureSmoothing(c);
  tfViewportPreviewEntries.forEach(entry=>{const layer=entry.layerIndex==null?null:layers[entry.layerIndex];if(layer&&(!layer.visible||(typeof _layerGroupChainVisible==='function'&&!_layerGroupChainVisible(layer))))return;c.save();if(layer)c.globalAlpha=(layer.opacity??1)*(typeof _layerGroupChainOpacity==='function'?_layerGroupChainOpacity(layer):1);c.drawImage(entry.canvas,entry.x,entry.y);c.restore();});c.restore();
}

// ── Pivot helpers ───────────────────────────────────────────────
// Generic local-space <-> world-space conversion for a point under a given
// transform state (defaults to the live tfState). "Local" is the same
// coordinate space as tfBox — i.e. original, untransformed canvas coords.
// Kept separate from any single mode's math so Free, Perspective, Warp,
// etc. can all place/read the pivot consistently.
function _tfTransformSelectionMaskFree(){
  if(!tfPixelSelection)return null;
  const width=tfPixelSelection.width||CW,height=tfPixelSelection.height||CH,source=tfPixelSelection.mask,output=new Uint8ClampedArray(width*height);
  if(_tfIsIntegerTranslation(tfState)){
    const dx=Math.round(tfState.tx),dy=Math.round(tfState.ty);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(source[y*width+x]===255){const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<width&&ny<height)output[ny*width+nx]=255;}
    return output;
  }
  const boxCenterX=tfBox.x+tfBox.w/2,boxCenterY=tfBox.y+tfBox.h/2,center=_tfCenter(tfState),scale=tfState.scale||1,radians=tfState.rotation*Math.PI/180,cosR=Math.cos(radians),sinR=Math.sin(radians);
  const corners=[{x:tfBox.x,y:tfBox.y},{x:tfBox.x+tfBox.w,y:tfBox.y},{x:tfBox.x+tfBox.w,y:tfBox.y+tfBox.h},{x:tfBox.x,y:tfBox.y+tfBox.h}].map(point=>{const dx=(point.x-boxCenterX)*scale,dy=(point.y-boxCenterY)*scale;return{x:center.x+dx*cosR-dy*sinR,y:center.y+dx*sinR+dy*cosR};});
  const minX=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.x)))),minY=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.y)))),maxX=Math.min(width,Math.ceil(Math.max(...corners.map(point=>point.x)))),maxY=Math.min(height,Math.ceil(Math.max(...corners.map(point=>point.y))));
  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const worldX=x+0.5-center.x,worldY=y+0.5-center.y,localX=(worldX*cosR+worldY*sinR)/scale+boxCenterX,localY=(-worldX*sinR+worldY*cosR)/scale+boxCenterY;
    const sx=Math.floor(localX),sy=Math.floor(localY);if(sx>=0&&sy>=0&&sx<width&&sy<height&&source[sy*width+sx]===255)output[y*width+x]=255;
  }
  return output;
}
function _tfTransformSelectionMaskPerspective(){
  if(!tfPixelSelection||!tfCorners)return null;
  const width=tfPixelSelection.width||CW,height=tfPixelSelection.height||CH,source=tfPixelSelection.mask,output=new Uint8ClampedArray(width*height),inverse=_tfInvertHomography(_tfQuadH(tfCorners[0],tfCorners[1],tfCorners[2],tfCorners[3]));if(!inverse)return output;
  const minX=Math.max(0,Math.floor(Math.min(...tfCorners.map(point=>point.x)))),minY=Math.max(0,Math.floor(Math.min(...tfCorners.map(point=>point.y)))),maxX=Math.min(width,Math.ceil(Math.max(...tfCorners.map(point=>point.x)))),maxY=Math.min(height,Math.ceil(Math.max(...tfCorners.map(point=>point.y))));
  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const px=x+0.5,py=y+0.5,denominator=inverse.g*px+inverse.h*py+inverse.i;if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-10)continue;
    const u=(inverse.a*px+inverse.b*py+inverse.c)/denominator,v=(inverse.d*px+inverse.e*py+inverse.f)/denominator;if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>=1||v<0||v>=1)continue;
    const sx=Math.floor(tfBox.x+u*tfBox.w),sy=Math.floor(tfBox.y+v*tfBox.h);if(sx>=0&&sy>=0&&sx<width&&sy<height&&source[sy*width+sx]===255)output[y*width+x]=255;
  }
  return output;
}
function _tfCurrentSelectionMask(){return tfPerspective?_tfTransformSelectionMaskPerspective():_tfTransformSelectionMaskFree();}
function _tfPreviewSelectionMask(){if(tfPixelSelection&&window.PixelSelection){const mask=_tfCurrentSelectionMask();if(mask)PixelSelection.setTransformPreview(mask,tfPixelSelection.width||CW,tfPixelSelection.height||CH);}}

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
  _tfConfigureSmoothing(dctx);
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
  const originX=Number(canvas&&canvas._tfOriginX)||0,originY=Number(canvas&&canvas._tfOriginY)||0;
  if(maxX<minX) return {x:originX,y:originY,w:w,h:h};
  return {x:minX+originX,y:minY+originY,w:(maxX-minX+1),h:(maxY-minY+1)};
}

function _tfCaptureSmartMove(li,fi,bounds,styleId){
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
    meta:SmartRasterLayer.cloneMeta(frame.meta),
    contribution:styleId&&typeof window.SmartRasterV4CaptureStyleTransform==='function'?SmartRasterV4CaptureStyleTransform(styleId,layer,fi):null
  };
}

function _tfCanvasFromRgba(data,width,height){
  const canvas=mkLayerCanvas(),context=canvas.getContext('2d'),image=context.createImageData(width,height);image.data.set(data);context.putImageData(image,0,0);return canvas;
}
function _tfSampleCoverageBilinear(coverage,width,height,x,y){
  const fx=x-.5,fy=y-.5,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;
  function value(px,py){return px>=0&&py>=0&&px<width&&py<height?coverage[py*width+px]:0;}
  const top=value(x0,y0)*(1-tx)+value(x0+1,y0)*tx,bottom=value(x0,y0+1)*(1-tx)+value(x0+1,y0+1)*tx;return Math.max(0,Math.min(65535,Math.round(top*(1-ty)+bottom*ty)));
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
  const outputIds=tfPixelSelection?source.styleIds.slice():new Uint16Array(source.width*source.height);
  const contribution=source.contribution,outputCoverage=contribution?new Uint16Array(source.width*source.height):null;
  if(tfPixelSelection)for(let p=0;p<tfPixelSelection.mask.length;p++)if(tfPixelSelection.mask[p]===255)outputIds[p]=0;
  const outputRgba=ctx.getImageData(0,0,source.width,source.height).data;
  const sourceRgba=source.previewSourceImage
    ? source.previewSourceImage.data
    : tfSnapshot.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height).data;
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
    if(!contribution&&outputRgba[destinationOffset*4+3]===0)continue;
    const worldX=x+0.5-center.x,worldY=y+0.5-center.y;
    const localX=(worldX*cosR+worldY*sinR)/scale+boxCenterX;
    const localY=(-worldX*sinR+worldY*cosR)/scale+boxCenterY;
    if(localX<tfBox.x||localX>=tfBox.x+tfBox.w||localY<tfBox.y||localY>=tfBox.y+tfBox.h)continue;
    const sourceX=Math.floor(localX),sourceY=Math.floor(localY);
    if(sourceX<0||sourceX>=source.width||sourceY<0||sourceY>=source.height)continue;
    const sourceOffset=sourceY*source.width+sourceX;
    if(contribution){outputCoverage[destinationOffset]=_tfSampleCoverageBilinear(contribution.coverage,source.width,source.height,localX,localY);continue;}
    if(tfPixelSelection&&tfPixelSelection.mask[sourceOffset]!==255)continue;
    if(sourceRgba[sourceOffset*4+3]===0)continue;
    outputIds[destinationOffset]=source.styleIds[sourceOffset]||0;
  }

  if(contribution&&typeof window.SmartRasterV4ReplaceStyleTransform==='function'&&SmartRasterV4ReplaceStyleTransform(contribution,layer,source.frame,outputCoverage))return;
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

function _tfSampleRgba(src,width,height,bounds,sx,sy){
  const minX=bounds.x,minY=bounds.y,maxX=bounds.x+bounds.w-1,maxY=bounds.y+bounds.h-1;
  function pixel(x,y){x=Math.max(minX,Math.min(maxX,x));y=Math.max(minY,Math.min(maxY,y));const offset=(y*width+x)*4;return [src[offset],src[offset+1],src[offset+2],src[offset+3]/255];}
  function combine(samples,weights){let alpha=0,red=0,green=0,blue=0;for(let i=0;i<samples.length;i++){const value=samples[i],weight=weights[i];alpha+=value[3]*weight;red+=value[0]*value[3]*weight;green+=value[1]*value[3]*weight;blue+=value[2]*value[3]*weight;}alpha=Math.max(0,Math.min(1,alpha));if(alpha<=1e-8)return [0,0,0,0];return [Math.max(0,Math.min(255,red/alpha)),Math.max(0,Math.min(255,green/alpha)),Math.max(0,Math.min(255,blue/alpha)),alpha];}
  const nearest=pixel(Math.round(sx),Math.round(sy));if(tfAntialiasing==='none')return nearest;
  const x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0,bilinear=combine([pixel(x0,y0),pixel(x0+1,y0),pixel(x0,y0+1),pixel(x0+1,y0+1)],[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty]);
  if(tfAntialiasing==='weak')return combine([nearest,bilinear],[.65,.35]);
  if(tfAntialiasing!=='strong')return bilinear;
  function cubicWeight(value){const x=Math.abs(value),a=-.5;if(x<=1)return (a+2)*x*x*x-(a+3)*x*x+1;if(x<2)return a*x*x*x-5*a*x*x+8*a*x-4*a;return 0;}
  const samples=[],weights=[];for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){samples.push(pixel(x0+xx,y0+yy));weights.push(cubicWeight(xx-tx)*cubicWeight(yy-ty));}
  return combine(samples,weights);
}

function _tfDrawSmartPerspectiveInverse(destinationContext,sourceCanvas,sourceBounds,corners,backgroundCanvas){
  const homography=_tfQuadH(corners[0],corners[1],corners[2],corners[3]);
  const inverse=_tfInvertHomography(homography);if(!inverse)return false;
  const source=tfSmartMove&&tfSmartMove.previewSourceImage?tfSmartMove.previewSourceImage:sourceCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  const cachedBackground=tfSmartMove&&tfSmartMove.previewBackgroundImage;
  const output=cachedBackground?new ImageData(cachedBackground.data.slice(),cachedBackground.width,cachedBackground.height):(backgroundCanvas?backgroundCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH):destinationContext.createImageData(CW,CH));
  const src=source.data,dst=output.data;
  const minX=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.x))));
  const minY=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.y))));
  const maxX=Math.min(CW,Math.ceil(Math.max(...corners.map(point=>point.x))));
  const maxY=Math.min(CH,Math.ceil(Math.max(...corners.map(point=>point.y))));

  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const px=x+0.5,py=y+0.5,denominator=inverse.g*px+inverse.h*py+inverse.i;
    if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-10)continue;
    const u=(inverse.a*px+inverse.b*py+inverse.c)/denominator;
    const v=(inverse.d*px+inverse.e*py+inverse.f)/denominator;
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)continue;
    const sx=sourceBounds.x+u*sourceBounds.w-0.5,sy=sourceBounds.y+v*sourceBounds.h-0.5;
    const sampled=_tfSampleRgba(src,source.width,source.height,sourceBounds,sx,sy),red=sampled[0],green=sampled[1],blue=sampled[2],alpha=sampled[3];
    if(alpha<=0)continue;
    const offset=(y*CW+x)*4,destinationAlpha=dst[offset+3]/255,outputAlpha=alpha+destinationAlpha*(1-alpha);
    dst[offset]=Math.round((red*alpha+dst[offset]*destinationAlpha*(1-alpha))/outputAlpha);
    dst[offset+1]=Math.round((green*alpha+dst[offset+1]*destinationAlpha*(1-alpha))/outputAlpha);
    dst[offset+2]=Math.round((blue*alpha+dst[offset+2]*destinationAlpha*(1-alpha))/outputAlpha);
    dst[offset+3]=Math.round(outputAlpha*255);
  }
  destinationContext.clearRect(0,0,CW,CH);destinationContext.putImageData(output,0,0);return true;
}


function _tfDrawRasterPerspectiveInverse(destinationContext,corners,backgroundCanvas){
  const cached=tfRasterPerspectivePreview;if(!cached)return false;
  const homography=_tfQuadH(corners[0],corners[1],corners[2],corners[3]);
  const inverse=_tfInvertHomography(homography);if(!inverse)return false;
  const output=backgroundCanvas?backgroundCanvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH):destinationContext.createImageData(CW,CH);
  const src=cached.image.data,dst=output.data,sourceBounds={x:0,y:0,w:cached.width,h:cached.height};
  const minX=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))),minY=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))));
  const maxX=Math.min(CW,Math.ceil(Math.max(...corners.map(p=>p.x)))),maxY=Math.min(CH,Math.ceil(Math.max(...corners.map(p=>p.y))));
  _tfInverseMapRgba(src,cached.width,cached.height,sourceBounds,dst,CW,CH,{minX,minY,maxX,maxY},inverse,1,true);
  destinationContext.clearRect(0,0,CW,CH);destinationContext.putImageData(output,0,0);return true;
}

function _tfInverseMapRgba(src,srcWidth,srcHeight,sourceBounds,dst,dstWidth,dstHeight,bounds,inverse,destinationScale,composite){

  for(let y=bounds.minY;y<bounds.maxY;y++)for(let x=bounds.minX;x<bounds.maxX;x++){
    const px=(x+0.5)/destinationScale,py=(y+0.5)/destinationScale,denominator=inverse.g*px+inverse.h*py+inverse.i;
    if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-10)continue;
    const u=(inverse.a*px+inverse.b*py+inverse.c)/denominator,v=(inverse.d*px+inverse.e*py+inverse.f)/denominator;
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)continue;
    const sx=sourceBounds.x+u*sourceBounds.w-0.5,sy=sourceBounds.y+v*sourceBounds.h-0.5,sampled=_tfSampleRgba(src,srcWidth,srcHeight,sourceBounds,sx,sy);
    const red=sampled[0],green=sampled[1],blue=sampled[2],alpha=sampled[3];if(alpha<=0)continue;
    const offset=(y*dstWidth+x)*4;
    if(composite){
      const destinationAlpha=dst[offset+3]/255,outputAlpha=alpha+destinationAlpha*(1-alpha);
      dst[offset]=Math.round((red*alpha+dst[offset]*destinationAlpha*(1-alpha))/outputAlpha);dst[offset+1]=Math.round((green*alpha+dst[offset+1]*destinationAlpha*(1-alpha))/outputAlpha);dst[offset+2]=Math.round((blue*alpha+dst[offset+2]*destinationAlpha*(1-alpha))/outputAlpha);dst[offset+3]=Math.round(outputAlpha*255);
    }else{dst[offset]=Math.round(red);dst[offset+1]=Math.round(green);dst[offset+2]=Math.round(blue);dst[offset+3]=Math.round(alpha*255);}
  }
}

function _tfDrawFastPerspectiveInverse(destinationContext,source,sourceBounds,corners){
  const preview=tfPerspectiveFastPreview;if(!preview)return false;
  const inverse=_tfInvertHomography(_tfQuadH(corners[0],corners[1],corners[2],corners[3]));if(!inverse)return false;
  const scale=preview.scale,minX=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x))*scale)),minY=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))*scale));
  const maxX=Math.min(preview.canvas.width,Math.ceil(Math.max(...corners.map(p=>p.x))*scale)),maxY=Math.min(preview.canvas.height,Math.ceil(Math.max(...corners.map(p=>p.y))*scale));
  const current={minX,minY,maxX,maxY},previous=preview.dirty||current,dirty={minX:Math.min(current.minX,previous.minX),minY:Math.min(current.minY,previous.minY),maxX:Math.max(current.maxX,previous.maxX),maxY:Math.max(current.maxY,previous.maxY)};
  const data=preview.image.data;
  for(let y=dirty.minY;y<dirty.maxY;y++)data.fill(0,(y*preview.canvas.width+dirty.minX)*4,(y*preview.canvas.width+dirty.maxX)*4);
  _tfInverseMapRgba(source.data,source.width,source.height,sourceBounds,data,preview.canvas.width,preview.canvas.height,current,inverse,scale,false);
  preview.context.clearRect(dirty.minX,dirty.minY,dirty.maxX-dirty.minX,dirty.maxY-dirty.minY);
  preview.context.putImageData(preview.image,0,0,dirty.minX,dirty.minY,dirty.maxX-dirty.minX,dirty.maxY-dirty.minY);preview.dirty=current;
  destinationContext.save();_tfConfigureSmoothing(destinationContext);destinationContext.drawImage(preview.canvas,0,0,CW,CH);destinationContext.restore();return true;
}

function _tfCommitSmartPerspectiveTransform(){
  if(!tfSmartMove||!tfCorners)return;
  const source=tfSmartMove;
  const layer=layers[source.layer];
  if(!layer||layer.type!=='smart-raster')return;
  const homography=_tfQuadH(tfCorners[0],tfCorners[1],tfCorners[2],tfCorners[3]);
  const inverse=_tfInvertHomography(homography);
  if(!inverse)return;

  const outputIds=tfPixelSelection?source.styleIds.slice():new Uint16Array(source.width*source.height);
  const contribution=source.contribution,outputCoverage=contribution?new Uint16Array(source.width*source.height):null;
  if(tfPixelSelection)for(let p=0;p<tfPixelSelection.mask.length;p++)if(tfPixelSelection.mask[p]===255)outputIds[p]=0;
  const outputRgba=ctx.getImageData(0,0,source.width,source.height).data;
  const sourceRgba=source.previewSourceImage
    ? source.previewSourceImage.data
    : tfSnapshot.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height).data;
  const minX=Math.max(0,Math.floor(Math.min(...tfCorners.map(p=>p.x)))-2);
  const minY=Math.max(0,Math.floor(Math.min(...tfCorners.map(p=>p.y)))-2);
  const maxX=Math.min(source.width,Math.ceil(Math.max(...tfCorners.map(p=>p.x)))+2);
  const maxY=Math.min(source.height,Math.ceil(Math.max(...tfCorners.map(p=>p.y)))+2);

  for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++){
    const destinationOffset=y*source.width+x;
    if(!contribution&&outputRgba[destinationOffset*4+3]===0)continue;
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
    if(contribution){outputCoverage[destinationOffset]=_tfSampleCoverageBilinear(contribution.coverage,source.width,source.height,source.bounds.x+u*source.bounds.w,source.bounds.y+v*source.bounds.h);continue;}
    if(tfPixelSelection&&tfPixelSelection.mask[sourceOffset]!==255)continue;
    if(sourceRgba[sourceOffset*4+3]===0)continue;
    outputIds[destinationOffset]=source.styleIds[sourceOffset]||0;
  }

  if(contribution&&typeof window.SmartRasterV4ReplaceStyleTransform==='function'&&SmartRasterV4ReplaceStyleTransform(contribution,layer,source.frame,outputCoverage))return;
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
  tfAwaitingRepeat=false;
  tfSmartMove=null;
  tfPixelSelection=null;
  tfRasterPerspectivePreview=null;
  tfPerspectiveFastPreview=null;
  tfPerspectivePreviewExact=false;

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
      const heldInfo=typeof getPreviousVisibleDrawingKey==='function'?getPreviousVisibleDrawingKey(li,curFrame):null,held=heldInfo&&heldInfo.canvas||getHeldKey(li,curFrame),extended=heldInfo&&typeof getExtendedLayerFrame==='function'?getExtendedLayerFrame(li,heldInfo.frameIndex):null;
      let base;if(extended){base=document.createElement('canvas');base.width=extended.canvas.width;base.height=extended.canvas.height;base.getContext('2d').drawImage(extended.canvas,0,0);base._tfOriginX=extended.x;base._tfOriginY=extended.y;}else{base=mkLayerCanvas();if(held)base.getContext('2d').drawImage(held,0,0);base._tfOriginX=0;base._tfOriginY=0;}return {li,base};
    });
    const memberBoxes=tfMembers.map(member=>_computeOpaqueBBox(member.base)),minMemberX=Math.min(...memberBoxes.map(box=>box.x)),minMemberY=Math.min(...memberBoxes.map(box=>box.y)),maxMemberX=Math.max(...memberBoxes.map(box=>box.x+box.w)),maxMemberY=Math.max(...memberBoxes.map(box=>box.y+box.h));
    tfBox={x:minMemberX,y:minMemberY,w:maxMemberX-minMemberX,h:maxMemberY-minMemberY};
    tfViewportPreviewEntries=tfMembers.map(member=>Object.assign({layerIndex:member.li},_tfCropViewportPreviewSource(member.base)));
    _tfHiddenLayers=new Set(tfMemberIdx);
    recomposite(curLayer,curFrame);
  } else {
    const pixelState=window.PixelSelection&&PixelSelection.isActive()?PixelSelection.getState():null;
    const extended=!pixelState&&typeof getExtendedLayerFrame==='function'?getExtendedLayerFrame(curLayer,curFrame):null;
    if(extended){tfSnapshot=document.createElement('canvas');tfSnapshot.width=extended.canvas.width;tfSnapshot.height=extended.canvas.height;tfSnapshot.getContext('2d').drawImage(extended.canvas,0,0);tfSnapshot._tfOriginX=extended.x;tfSnapshot._tfOriginY=extended.y;}
    else{tfSnapshot=mkLayerCanvas();tfSnapshot.getContext('2d').drawImage(activeC,0,0);tfSnapshot._tfOriginX=0;tfSnapshot._tfOriginY=0;}
    if(pixelState&&pixelState.layerIndex===curLayer&&pixelState.bounds){
      const selected=mkLayerCanvas(),background=mkLayerCanvas();
      const selectedCtx=selected.getContext('2d'),backgroundCtx=background.getContext('2d');
      selectedCtx.drawImage(tfSnapshot,0,0);
      selectedCtx.globalCompositeOperation='destination-in';selectedCtx.drawImage(pixelState.maskCanvas,0,0);selectedCtx.globalCompositeOperation='source-over';
      backgroundCtx.drawImage(tfSnapshot,0,0);
      backgroundCtx.globalCompositeOperation='destination-out';backgroundCtx.drawImage(pixelState.maskCanvas,0,0);backgroundCtx.globalCompositeOperation='source-over';
      tfPixelSelection={mask:pixelState.mask.slice(),width:pixelState.width,height:pixelState.height,source:selected,background:background};
      tfBox={x:pixelState.bounds.x,y:pixelState.bounds.y,w:pixelState.bounds.width,h:pixelState.bounds.height};
      PixelSelection.clearTransformPreview();PixelSelection.setOverlayVisible(true);
    } else tfBox=_computeOpaqueBBox(tfSnapshot);
    tfSmartMove=_tfCaptureSmartMove(curLayer,pixelState&&pixelState.frameIndex!=null?pixelState.frameIndex:curFrame,tfBox,pixelState&&pixelState.styleId);
    if(tfSmartMove){
      if(tfSmartMove.contribution&&tfPixelSelection){
        tfPixelSelection.source=_tfCanvasFromRgba(tfSmartMove.contribution.sourceRgba,CW,CH);
        tfPixelSelection.background=_tfCanvasFromRgba(tfSmartMove.contribution.backgroundRgba,CW,CH);
        tfPixelSelection.above=_tfCanvasFromRgba(tfSmartMove.contribution.aboveRgba,CW,CH);
      }
      const previewSource=tfPixelSelection?tfPixelSelection.source:tfSnapshot;
      tfSmartMove.previewSourceImage=previewSource.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH);
      tfSmartMove.previewBackgroundImage=tfPixelSelection?tfPixelSelection.background.getContext('2d',{willReadFrequently:true}).getImageData(0,0,CW,CH):null;
    }else{
      const previewSource=tfPixelSelection?tfPixelSelection.source:tfSnapshot;
      const x=Math.floor(tfBox.x),y=Math.floor(tfBox.y);
      const width=Math.max(1,Math.ceil(tfBox.x+tfBox.w)-x);
      const height=Math.max(1,Math.ceil(tfBox.y+tfBox.h)-y);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const sourceOriginX=Number(previewSource&&previewSource._tfOriginX)||0,sourceOriginY=Number(previewSource&&previewSource._tfOriginY)||0;canvas.getContext('2d').drawImage(previewSource,x-sourceOriginX,y-sourceOriginY,width,height,0,0,width,height);
      tfRasterPerspectivePreview={canvas,x,y,width,height,image:canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,width,height)};
    }
    const viewportSource=tfPixelSelection?tfPixelSelection.source:tfSnapshot;
    tfViewportPreviewEntries=[_tfCropViewportPreviewSource(viewportSource)];
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
  _tfRenderOptionsPanel();
  _tfRedraw();
}

function _tfStoreFullTransform(layerIndex,frameIndex,source,options){
  if(!source||typeof setExtendedLayerFrame!=='function')return null;options=options||{};
  const perspective=!!options.perspective,corners=perspective?tfCorners:_tfCorners(),padding=perspective?3:2;
  let minX=Math.floor(Math.min(...corners.map(point=>point.x)))-padding,minY=Math.floor(Math.min(...corners.map(point=>point.y)))-padding,maxX=Math.ceil(Math.max(...corners.map(point=>point.x)))+padding,maxY=Math.ceil(Math.max(...corners.map(point=>point.y)))+padding;
  if(options.background){minX=Math.min(minX,0);minY=Math.min(minY,0);maxX=Math.max(maxX,CW);maxY=Math.max(maxY,CH);}
  const full=document.createElement('canvas');full.width=Math.max(1,maxX-minX);full.height=Math.max(1,maxY-minY);const fullContext=full.getContext('2d');fullContext.translate(-minX,-minY);
  if(options.background)fullContext.drawImage(options.background,0,0);
  if(perspective){const originX=Number(source._tfOriginX)||0,originY=Number(source._tfOriginY)||0,sourceRect=options.sourceRect||{x:tfBox.x-originX,y:tfBox.y-originY,w:tfBox.w,h:tfBox.h};_tfDrawPerspective(fullContext,source,sourceRect.x,sourceRect.y,sourceRect.w,sourceRect.h,tfCorners,32);}else _tfDrawFreeSource(fullContext,source,tfState);
  if(options.above)fullContext.drawImage(options.above,0,0);setExtendedLayerFrame(layerIndex,frameIndex,full,minX,minY);return {canvas:full,x:minX,y:minY};
}

function commitTransformTool(options){
  if(!tfActive) return;
  _tfHideFloatingActions();
  if(window.DEBUG_TOOL_LIFECYCLE)console.log('[ToolLifecycle] commitTransformTool',{activeTool:tool,repeatable:!!(window.RepeatableTransformController&&RepeatableTransformController.active),stack:(new Error('Transform commit')).stack});
  const preserveSessionShell=!!(options&&options.preserveSessionShell);
  _tfCancelFreePreview(false);
  if(!tfGroupMode&&!tfPerspective)_tfRedraw(false);
  _tfCancelPerspectivePreview();
  tfActive=false;
  if(!preserveSessionShell){
    transformC.classList.remove('tf-active');
    tfCtx.clearRect(0,0,CW,CH);
    _tfClearUi();
    perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);
    _tfSyncGuideCanvasActive();
  }

  if(tfGroupMode){
    const c=_tfCenter();
    const rad=tfState.rotation*Math.PI/180;
    tfMembers.forEach(m=>{_tfStoreFullTransform(m.li,curFrame,m.base,{perspective:tfPerspective});if(m.li===curLayer){ctx.clearRect(0,0,CW,CH);const key=layers[m.li].frames[curFrame];if(key)ctx.drawImage(key,0,0);}});
    _tfHiddenLayers=new Set();
    recomposite(curLayer,curFrame);
    renderTimeline();
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfViewportPreviewEntries=null;tfBox=null;tfState=null;tfPivot=null;
    tfPerspective=false;tfCorners=null;
    return;
  }

  if(tfPerspective){
    if(tfSmartMove){
      const perspectiveSource=tfPixelSelection?tfPixelSelection.source:tfSnapshot;
      _tfDrawSmartPerspectiveInverse(ctx,perspectiveSource,tfBox,tfCorners,tfPixelSelection?tfPixelSelection.background:null);
      tfPerspectivePreviewExact=true;
    }else{
      _tfDrawRasterPerspectiveInverse(ctx,tfCorners,tfPixelSelection?tfPixelSelection.background:null);
      tfPerspectivePreviewExact=true;
    }
  }

  const storageSource=tfPerspective&&tfRasterPerspectivePreview?tfRasterPerspectivePreview.canvas:(tfPixelSelection?tfPixelSelection.source:tfSnapshot),storageOptions={perspective:tfPerspective,background:tfPixelSelection&&tfPixelSelection.background,above:tfPixelSelection&&tfPixelSelection.above};
  if(tfPerspective&&tfRasterPerspectivePreview)storageOptions.sourceRect={x:0,y:0,w:tfRasterPerspectivePreview.width,h:tfRasterPerspectivePreview.height};
  const storedExtended=!!_tfStoreFullTransform(curLayer,curFrame,storageSource,storageOptions);
  if(tfPerspective)_tfCommitSmartPerspectiveTransform();
  else _tfCommitSmartFreeTransform();
  if(!storedExtended)saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  if(tfPixelSelection&&window.PixelSelection){const transformedMask=_tfCurrentSelectionMask(),selectionIdentity=tfSmartMove&&tfSmartMove.contribution?{layerIndex:tfSmartMove.layer,frameIndex:tfSmartMove.frame,styleId:tfSmartMove.contribution.styleId}:null;PixelSelection.clearTransformPreview();if(transformedMask)PixelSelection.replaceMask(transformedMask,tfPixelSelection.width||CW,tfPixelSelection.height||CH,'selection-transform',selectionIdentity);}
  tfSnapshot=null;tfSmartMove=null;tfPixelSelection=null;tfViewportPreviewEntries=null;tfRasterPerspectivePreview=null;tfPerspectiveFastPreview=null;tfBox=null;tfState=null;tfPivot=null;
  tfPerspective=false;tfCorners=null;
}

function cancelTransformTool(){
  if(!tfActive) return;
  _tfHideFloatingActions();
  _tfCancelFreePreview(false);
  _tfCancelPerspectivePreview();
  tfActive=false;
  transformC.classList.remove('tf-active');
  tfCtx.clearRect(0,0,CW,CH);
  _tfClearUi();
  perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);
  _tfSyncGuideCanvasActive();

  if(tfGroupMode){
    _tfHiddenLayers=new Set();
    recomposite(curLayer,curFrame);
    renderTimeline();
    tfMembers=null;tfMemberIdx=null;tfGroupMode=false;tfGroupId=null;tfViewportPreviewEntries=null;tfBox=null;tfState=null;tfPivot=null;
    tfPerspective=false;tfCorners=null;
    return;
  }

  ctx.clearRect(0,0,CW,CH);
  if(tfSnapshot) ctx.drawImage(tfSnapshot,Number(tfSnapshot._tfOriginX)||0,Number(tfSnapshot._tfOriginY)||0);
  saveActiveToKey();
  recomposite(curLayer,curFrame);
  renderTimeline();
  if(tfPixelSelection&&window.PixelSelection){PixelSelection.clearTransformPreview();PixelSelection.setOverlayVisible(true);}
  tfSnapshot=null;tfSmartMove=null;tfPixelSelection=null;tfViewportPreviewEntries=null;tfRasterPerspectivePreview=null;tfPerspectiveFastPreview=null;tfBox=null;tfState=null;tfPivot=null;
  tfPerspective=false;tfCorners=null;
}

function _tfScheduleFreePreview(){
  if(tfFreePreviewRaf)return;
  tfFreePreviewRaf=requestAnimationFrame(()=>{tfFreePreviewRaf=0;if(tfActive&&!tfPerspective)_tfRedraw(false);});
}
function _tfCancelFreePreview(flush){
  if(tfFreePreviewRaf){cancelAnimationFrame(tfFreePreviewRaf);tfFreePreviewRaf=0;}
  if(flush&&tfActive&&!tfPerspective)_tfRedraw(false);
}

function _tfSchedulePerspectivePreview(fast){
  tfPerspectivePreviewFast=!!fast;
  if(fast)tfPerspectivePreviewExact=false;
  if(tfPerspectivePreviewRaf)return;
  tfPerspectivePreviewRaf=requestAnimationFrame(()=>{
    tfPerspectivePreviewRaf=0;
    const useFast=tfPerspectivePreviewFast;tfPerspectivePreviewFast=false;
    if(tfActive&&tfPerspective)_tfRedraw(useFast);
  });
}
function _tfCancelPerspectivePreview(){
  if(tfPerspectivePreviewRaf){cancelAnimationFrame(tfPerspectivePreviewRaf);tfPerspectivePreviewRaf=0;}
  tfPerspectivePreviewFast=false;
}

function _tfRedraw(fastPerspectivePreview){
  if(!tfActive) return;
  _tfSyncStateFields();
  if(tfGroupMode){
    _tfDrawGroupPreview(fastPerspectivePreview);
    if(tfPerspective) _tfDrawHandlesPerspective(false); else _tfDrawHandles(false);
  } else {
    _tfResetPreviewContext(ctx);
    ctx.clearRect(0,0,CW,CH);
    if(tfPixelSelection)ctx.drawImage(tfPixelSelection.background,0,0);
    const transformSource=tfPixelSelection?tfPixelSelection.source:tfSnapshot;
    if(tfPerspective){
      if(fastPerspectivePreview){
        if(tfSmartMove)_tfDrawFastPerspectiveInverse(ctx,tfSmartMove.previewSourceImage,tfBox,tfCorners);
        else if(tfRasterPerspectivePreview)_tfDrawFastPerspectiveInverse(ctx,tfRasterPerspectivePreview.image,{x:0,y:0,w:tfRasterPerspectivePreview.width,h:tfRasterPerspectivePreview.height},tfCorners);
        else _tfDrawPerspective(ctx,transformSource,tfBox.x,tfBox.y,tfBox.w,tfBox.h,tfCorners,28);
      }else if(tfSmartMove){
        _tfDrawSmartPerspectiveInverse(ctx,transformSource,tfBox,tfCorners,tfPixelSelection?tfPixelSelection.background:null);
        tfPerspectivePreviewExact=true;
      }
      else{_tfDrawRasterPerspectiveInverse(ctx,tfCorners,tfPixelSelection?tfPixelSelection.background:null);tfPerspectivePreviewExact=true;}
    } else {
      _tfDrawFreeSource(ctx,transformSource,tfState);
    }
    if(tfPixelSelection&&tfPixelSelection.above)ctx.drawImage(tfPixelSelection.above,0,0);
    _scheduleRecomposite();
    _tfPreviewSelectionMask();
    if(tfPerspective) _tfDrawHandlesPerspective(true); else _tfDrawHandles(true);
  }
}

function _tfDrawGroupPreview(fastPerspectivePreview){
  const c=_tfCenter();
  const rad=tfState.rotation*Math.PI/180;
  _tfResetPreviewContext(tfCtx);
  tfCtx.clearRect(0,0,CW,CH);
  tfMembers.forEach(m=>{
    const l=layers[m.li];
    if(!l.visible||(typeof _layerGroupChainVisible==='function'&&!_layerGroupChainVisible(l))) return;
    const layerAlpha=(l.opacity??1)*(typeof _layerGroupChainOpacity==='function'?_layerGroupChainOpacity(l):1);
    tfCtx.save();
    tfCtx.globalAlpha=layerAlpha;
    if(tfPerspective){
      const originX=Number(m.base._tfOriginX)||0,originY=Number(m.base._tfOriginY)||0;_tfDrawPerspective(tfCtx,m.base,tfBox.x-originX,tfBox.y-originY,tfBox.w,tfBox.h,tfCorners,28);
    } else {
      _tfDrawFreeSource(tfCtx,m.base,tfState);
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

function _tfHideFloatingActions(){tfActionControls.hidden=true;}
function _tfPositionFloatingActions(points){
  if(!tfActive||tfAwaitingRepeat||!points||!points.length){_tfHideFloatingActions();return;}
  const area=document.getElementById('canvas-area'),width=area.clientWidth,height=area.clientHeight,minX=Math.min(...points.map(point=>point.x)),maxX=Math.max(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y)),maxY=Math.max(...points.map(point=>point.y)),controlWidth=68,controlHeight=32,gap=10;
  let left=(minX+maxX-controlWidth)/2,top=maxY+gap;if(top+controlHeight>height-6)top=minY-controlHeight-gap;
  tfActionControls.style.left=Math.max(6,Math.min(width-controlWidth-6,left))+'px';tfActionControls.style.top=Math.max(6,Math.min(height-controlHeight-6,top))+'px';tfActionControls.hidden=false;
}

function _tfDrawHandles(clearFirst){
  _tfResizeGuideCanvas();const corners=_tfCorners().map(_tfToViewportPoint),rHandle=_tfToViewportPoint(_tfRotateHandlePos());_tfClearUi();
  const idle=tfAwaitingRepeat,c=tfUiCtx;c.save();c.globalAlpha=idle?.38:1;c.strokeStyle=idle?'#9a9aa6':(tfGroupMode?'#ff9f4d':'#4da3ff');c.lineWidth=1.5;c.lineJoin='round';c.lineCap='round';c.setLineDash([6,4]);
  c.beginPath();corners.forEach((p,i)=>{i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.closePath();c.stroke();c.setLineDash([]);
  const topMid={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};c.beginPath();c.moveTo(topMid.x,topMid.y);c.lineTo(rHandle.x,rHandle.y);c.stroke();
  _tfPositionFloatingActions(corners);
  const hr=TF_HANDLE_R;c.fillStyle=idle?'#8c8c96':'#fff';corners.forEach(p=>{c.beginPath();c.rect(p.x-hr/2,p.y-hr/2,hr,hr);c.fill();c.stroke();});c.beginPath();c.arc(rHandle.x,rHandle.y,hr/2,0,Math.PI*2);c.fill();c.stroke();_tfDrawPivotHandle();c.restore();
}

function _tfDrawPivotHandle(){
  if(!tfPivot)return;const p=_tfToViewportPoint(_tfPivotWorld()),hr=TF_HANDLE_R,c=tfUiCtx;c.save();c.strokeStyle=tfAwaitingRepeat?'#92929c':'#ffd24d';c.fillStyle=tfAwaitingRepeat?'rgba(146,146,156,.2)':'rgba(255,210,77,0.25)';c.lineWidth=1.5;c.lineCap='round';
  c.beginPath();c.arc(p.x,p.y,hr*.7,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.moveTo(p.x-hr/2,p.y);c.lineTo(p.x+hr/2,p.y);c.moveTo(p.x,p.y-hr/2);c.lineTo(p.x,p.y+hr/2);c.stroke();c.restore();
}

function _tfDrawHandlesPerspective(clearFirst){
  const geometry=_tfResizeGuideCanvas();_tfClearUi();perspGuideCtx.setTransform(1,0,0,1,0,0);perspGuideCtx.clearRect(0,0,perspGuideC.width,perspGuideC.height);perspGuideCtx.setTransform(geometry.dpr,0,0,geometry.dpr,0,0);
  if(tfOptionValues.perspectiveGuidesEnabled){const analysis=PerspectiveController.analyze(tfCorners),viewAnalysis=_tfAnalysisToViewport(analysis);PerspectiveController.draw(perspGuideCtx,viewAnalysis,{scale:1,width:geometry.width,height:geometry.height});}
  const corners=tfCorners.map(_tfToViewportPoint),idle=tfAwaitingRepeat,c=tfUiCtx,hr=TF_HANDLE_R;c.save();c.globalAlpha=idle?.38:1;c.strokeStyle=idle?'#9a9aa6':(tfGroupMode?'#ff9f4d':'#a24dff');c.lineWidth=1.5;c.lineJoin='round';c.lineCap='round';c.setLineDash([6,4]);c.beginPath();corners.forEach((p,i)=>{i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});c.closePath();c.stroke();c.setLineDash([]);c.fillStyle=idle?'#8c8c96':'#fff';corners.forEach(p=>{c.beginPath();c.rect(p.x-hr/2,p.y-hr/2,hr,hr);c.fill();c.stroke();});
  _tfPositionFloatingActions(corners);
  const mids=_tfPolyEdgeMidpoints(corners),dr=hr*.62;mids.forEach(p=>{c.beginPath();c.moveTo(p.x,p.y-dr);c.lineTo(p.x+dr,p.y);c.lineTo(p.x,p.y+dr);c.lineTo(p.x-dr,p.y);c.closePath();c.fill();c.stroke();});c.restore();
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

function _tfFreePointerDown(e){
  if(!tfActive) return;
  if(tfPerspective) return; // handled by perspGuideC instead — see above
  e.preventDefault();
  const p=getPos(e);
  const hit=_tfHitTest(p);
  if(!hit)return;
  if(tfAwaitingRepeat){tfAwaitingRepeat=false;_tfRedraw(false);}
  e.currentTarget.setPointerCapture(e.pointerId);
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
}
transformC.addEventListener('pointerdown',_tfFreePointerDown);
tfUiC.addEventListener('pointerdown',_tfFreePointerDown);
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
  _tfSchedulePerspectivePreview(true);
}
// Pointer capture (set in _tfPerspPointerDown) redirects every subsequent
// pointermove/up/cancel to whichever element called setPointerCapture —
// so once a perspective drag starts on perspGuideC, transformC never sees
// these events again regardless of where the cursor actually is. That's
// exactly what we want: it's what lets a VP be dragged from way outside
// the artwork all the way back in without the drag ever "letting go".
perspGuideC.addEventListener('pointermove',_tfPerspPointerMoveDrag);

function _tfFreePointerMoveDrag(e){
  if(!tfActive||!tfDrag||tfPerspective)return;
  e.preventDefault();
  const p=getPos(e);
  if(tfDrag==='pivot'){
    // Pivot handle itself: re-derive its local coord from the mouse's
    // current world position under the *live* (unchanging during this
    // drag) state, so it tracks the cursor exactly.
    tfPivot=_tfWorldToLocal(p,tfState);
    _tfSyncStateFields();
    _tfScheduleFreePreview();
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
  _tfSyncStateFields();
  _tfScheduleFreePreview();
}
transformC.addEventListener('pointermove',_tfFreePointerMoveDrag);
tfUiC.addEventListener('pointermove',_tfFreePointerMoveDrag);
function _tfEndDrag(e){
  if(!tfDrag) return;
  const settlePerspective=tfPerspective;
  if(transformC.hasPointerCapture&&transformC.hasPointerCapture(e.pointerId)) transformC.releasePointerCapture(e.pointerId);
  if(perspGuideC.hasPointerCapture&&perspGuideC.hasPointerCapture(e.pointerId)) perspGuideC.releasePointerCapture(e.pointerId);
  if(tfUiC.hasPointerCapture&&tfUiC.hasPointerCapture(e.pointerId)) tfUiC.releasePointerCapture(e.pointerId);
  tfDrag=null;tfDragInfo=null;tfCornerDrag=null;
  if(settlePerspective){_tfCancelPerspectivePreview();_tfRedraw(false);}else _tfCancelFreePreview(true);
}
transformC.addEventListener('pointerup',_tfEndDrag);
transformC.addEventListener('pointercancel',_tfEndDrag);
tfUiC.addEventListener('pointerup',_tfEndDrag);
tfUiC.addEventListener('pointercancel',_tfEndDrag);
perspGuideC.addEventListener('pointerup',_tfEndDrag);
perspGuideC.addEventListener('pointercancel',_tfEndDrag);

perspGuideC.addEventListener('pointermove',e=>{
  if(!tfActive||tfDrag||!tfPerspective) return;
  const hit=_tfHitTestPerspective(getPos(e));
  perspGuideC.style.cursor=hit?((hit.mode==='pcorner'||hit.mode==='pedge'||hit.mode==='vp')?'crosshair':hit.mode==='horizon'?'ns-resize':'move'):'default';
});

function _tfFreePointerHover(e){
  if(!tfActive||tfDrag||tfPerspective)return;
  const hit=_tfHitTest(getPos(e)),cursor=hit?(hit.mode==='pivot'?'crosshair':hit.mode==='rotate'?'grab':hit.mode==='scale'?'nwse-resize':'move'):'default';
  transformC.style.cursor=cursor;tfUiC.style.cursor=cursor;
}
transformC.addEventListener('pointermove',_tfFreePointerHover);
tfUiC.addEventListener('pointermove',_tfFreePointerHover);

function _tfRememberCurrentFreeOperation(){
  const boxCenter={x:tfBox.x+tfBox.w/2,y:tfBox.y+tfBox.h/2},pivotOffset={x:tfPivot.x-boxCenter.x,y:tfPivot.y-boxCenter.y},hasLiveOperation=Math.abs(tfState.tx)>1e-9||Math.abs(tfState.ty)>1e-9||Math.abs(tfState.scale-1)>1e-9||Math.abs(tfState.rotation)>1e-9||Math.abs(pivotOffset.x)>1e-9||Math.abs(pivotOffset.y)>1e-9;
  if(hasLiveOperation)tfLastCommittedOperation={state:Object.assign({},tfState),pivotOffset};return hasLiveOperation;
}
function _tfShowRepeatedFreePreview(){
  if(!tfLastCommittedOperation||!tfActive||tfPerspective)return false;const boxCenter={x:tfBox.x+tfBox.w/2,y:tfBox.y+tfBox.h/2};tfState=Object.assign({},tfLastCommittedOperation.state);tfPivot={x:boxCenter.x+tfLastCommittedOperation.pivotOffset.x,y:boxCenter.y+tfLastCommittedOperation.pivotOffset.y};tfAwaitingRepeat=false;_tfRedraw(false);return true;
}
function _tfConfirmAction(){
  if(!tfActive)return false;if(!tfPerspective&&tfAwaitingRepeat)return _tfShowRepeatedFreePreview();
  const wasPerspective=tfPerspective;if(!wasPerspective&&!_tfRememberCurrentFreeOperation()&&tfLastCommittedOperation)return _tfShowRepeatedFreePreview();
  if(!wasPerspective&&tfPendingRepeatUndo){undoStack.push(tfPendingRepeatUndo);if(undoStack.length>40)undoStack.shift();redoStack=[];tfPendingRepeatUndo=null;}
  commitTransformTool();if(tool==='transform'){enterTransformTool();if(!wasPerspective){tfPendingRepeatUndo=undoStack.pop()||null;tfAwaitingRepeat=true;_tfHideFloatingActions();_tfDrawHandles(true);}}return true;
}
function _tfCancelAction(){
  if(!tfActive||tfAwaitingRepeat)return false;const wasPerspective=tfPerspective;cancelTransformTool();if(tool==='transform'){enterTransformTool();if(!wasPerspective){tfPendingRepeatUndo=undoStack.pop()||tfPendingRepeatUndo;tfAwaitingRepeat=true;_tfHideFloatingActions();_tfDrawHandles(true);}}return true;
}
tfConfirmButton.addEventListener('pointerdown',event=>event.stopPropagation());tfCancelButton.addEventListener('pointerdown',event=>event.stopPropagation());tfConfirmButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();_tfConfirmAction();});tfCancelButton.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();_tfCancelAction();});
document.addEventListener('keydown',e=>{
  if(!tfActive||e.target.tagName==='INPUT')return;
  if(e.key==='Enter'){e.preventDefault();e.stopImmediatePropagation();_tfConfirmAction();}
  else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();_tfCancelAction();}
},{capture:true});

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

function _tfStateFieldValue(key){
  if(!tfState)return 0;
  if(key==='scale')return tfState.scale*100;
  if(key==='pivotX'||key==='pivotY'){
    const pivot=tfPivot?_tfPivotWorld(tfState):{x:0,y:0},center=tfBox?{x:tfBox.x+tfBox.w/2,y:tfBox.y+tfBox.h/2}:{x:0,y:0};
    return key==='pivotX'?pivot.x-center.x:pivot.y-center.y;
  }
  return key==='translateX'?tfState.tx:key==='translateY'?tfState.ty:tfState.rotation;
}
function _tfFormatStateField(key,value){
  const rounded=Math.round(value*100)/100;
  return key==='scale'?rounded+'%':String(rounded);
}
function _tfSyncStateFields(){
  if(!_tfOptionsBody||!tfState)return;
  _tfOptionsBody.querySelectorAll('[data-tf-state-field]').forEach(input=>{
    if(document.activeElement===input)return;
    input.value=_tfFormatStateField(input.dataset.tfStateField,_tfStateFieldValue(input.dataset.tfStateField));
  });
}
function _tfApplyStateField(key,raw){
  if(!tfActive||!tfState)return;
  const parsed=Number.parseFloat(String(raw).replace('%',''));
  if(!Number.isFinite(parsed))return;
  if(key==='translateX')tfState.tx=parsed;
  else if(key==='translateY')tfState.ty=parsed;
  else if(key==='rotation')_tfSetStateForPivot(_tfPivotWorld(tfState),parsed,tfState.scale);
  else if(key==='scale'&&parsed>0)_tfSetStateForPivot(_tfPivotWorld(tfState),tfState.rotation,parsed/100);
  else if((key==='pivotX'||key==='pivotY')&&tfPivot&&tfBox){
    const pivotWorld=_tfPivotWorld(tfState),center={x:tfBox.x+tfBox.w/2,y:tfBox.y+tfBox.h/2};
    pivotWorld[key==='pivotX'?'x':'y']=(key==='pivotX'?center.x:center.y)+parsed;
    tfPivot=_tfWorldToLocal(pivotWorld,tfState);
  }
  _tfRedraw(false);
}
function _tfAppendStateFields(root){
  if(tfPerspective||!tfState)return;
  [['Panning X','translateX'],['Panning Y','translateY'],['Scale','scale'],['Angle','rotation'],['Pivot X','pivotX'],['Pivot Y','pivotY']].forEach(([label,key])=>{
    const row=document.createElement('label');row.className='tf-option-row tf-state-row';
    const text=document.createElement('span');text.textContent=label;
    const input=document.createElement('input');input.type='text';input.className='tf-state-input';input.dataset.tfStateField=key;input.value=_tfFormatStateField(key,_tfStateFieldValue(key));
    input.addEventListener('input',()=>_tfApplyStateField(key,input.value));
    input.addEventListener('blur',()=>{input.value=_tfFormatStateField(key,_tfStateFieldValue(key));});
    row.append(text,input);root.appendChild(row);
  });
}

// Rebuilds the checkbox list for whichever mode is active. Free Transform
// has no options registered, so the section shows an explicit quiet state.
function _tfRenderOptionsPanel(){
  if(!_tfOptionsBody) return;
  const opts=TF_MODE_OPTIONS[_tfCurrentModeKey()]||[];
  _tfOptionsBody.innerHTML='';
  _tfAppendStateFields(_tfOptionsBody);
  if(window.ToolSettingsUI&&typeof ToolSettingsUI.antialiasing==='function')ToolSettingsUI.antialiasing(_tfOptionsBody,{
    enabled:tfAntialiasingEnabled,quality:tfAntialiasingQuality,
    onEnabledChange:enabled=>{tfAntialiasingEnabled=!!enabled;_tfPersistAntialiasing();},
    onQualityChange:quality=>{if(['weak','medium','strong'].includes(quality))tfAntialiasingQuality=quality;_tfPersistAntialiasing();}
  });
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
window.addEventListener('tool-groups-ready',_tfRenderOptionsPanel);
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
    if(!tfPerspectiveFastPreview){const scale=1,canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(CW*scale));canvas.height=Math.max(1,Math.ceil(CH*scale));const context=canvas.getContext('2d');tfPerspectiveFastPreview={scale,canvas,context,image:context.createImageData(canvas.width,canvas.height),dirty:null};}
    tfCorners=_tfFreeCorners().map(p=>({x:p.x,y:p.y}));
    if(tfSmartMove)tfSmartMove.sourceCorners=tfCorners.map(p=>({x:p.x,y:p.y}));
  } else {
    tfCorners=null;
  }
  tfPerspective=on;
  _tfSyncToggleUI();
  _tfSyncGuideCanvasActive();
  _tfRenderOptionsPanel();
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
  if(tfActive){if(tfPerspective)_tfDrawHandlesPerspective(true);else _tfDrawHandles(true);}
  requestAnimationFrame(_tfGuideSyncLoop);
})();
