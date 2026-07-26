// core-state.js — State, DOM refs, Canvas init, Zoom & Pan
function showInfo(msg,title){
  document.getElementById('modal-info-title').textContent=title||'Notice';
  document.getElementById('modal-info-msg').textContent=msg;
  document.getElementById('modal-info').classList.add('visible');
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('modal-info-ok').onclick=()=>document.getElementById('modal-info').classList.remove('visible');
  document.getElementById('modal-info').addEventListener('click',e=>{if(e.target===document.getElementById('modal-info'))document.getElementById('modal-info').classList.remove('visible');});
});
// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
let CW=1920,CH=1080,TOTAL=48,MAX_FPS=24;
let CellW=28;const CellH=28;
let curFrame=0,curLayer=0,playing=false,playTimer=null;
let tool='brush',color='#000000',bgColor='#ffffff';
let rangeStart=0,rangeEnd=47,loopRange=false,rulerCtxFrame=0;
const toolSizes={brush:6,eraser:20,fill:6};
// The Line tool is a brush geometry mode, not a separate brush preset. Keep
// its public legacy key as an alias so older callers/settings continue to
// work while every read and write uses the Brush tool's canonical size.
Object.defineProperty(toolSizes,'line',{
  enumerable:true,
  configurable:false,
  get(){return this.brush;},
  set(value){
    this.brush=value;
    window.dispatchEvent(new CustomEvent('brush-size-changed',{detail:{tool:'line',size:value,source:window._lineSizeUpdateSource||'unknown'}}));
  }
});
Object.defineProperty(toolSizes,'curve',{
  enumerable:true,
  configurable:false,
  get(){return this.brush;},
  set(value){this.line=value;}
});
let drawing=false,lx=0,ly=0,lineStart=null;
// TVPaint-style brush engine state
let brushOpacity=1.0; // flow/opacity 0-1
let brushHardness=1.0; // edge softness 0-1 (1=hard, 0=very soft airbrush)
// Antialiasing mode: true = sub-pixel soft edges (TVPaint PenBrush / Clip Studio normal)
//                   false = hard pixel-snapped edges (TVPaint Pencil / Clip Studio pixel pen)
let brushAA=true;
// Antialiasing STRENGTH mode: 'none' | 'weak' | 'medium' | 'strong'.
// Independent of brushHardness (radial falloff) -- controls only edge
// pixel coverage / subpixel smoothing width. brushAA (legacy boolean) is
// kept in sync for old code paths/UI: brushAA === (brushAAMode !== 'none').
// Backward compatibility: old saved settings with ts-aa=false map to
// 'none', ts-aa=true maps to 'medium' (also the default for Hard Round).
window.brushAAMode='medium';
let undoStack=[],redoStack=[],clipboard=null,styleClipboard=null;
const LCOLORS=['#7F77DD','#1D9E75','#EF9F27','#e24b4a','#D4537E','#378ADD'];

// ════════════════════════════════════════════════════════════════
// DRAWING MARK SYSTEM (Toon Boom Harmony-style)
// A "drawing mark" annotates each keyframe with its role in the
// animation. Only the mark's ID string is stored on each drawing
// (layer.frameMeta[frameIndex].markType). The full definition —
// abbreviation, display name, color — lives here in one place.
//
// Built-in mark IDs:
//   "keyframe"   — KF, the principal drawing for a movement
//   "breakdown"  — BD, a passing position between two keyframes
//   "inbetween"  — IB, an interpolated in-between drawing
//
// Drawings without an explicit markType default to "inbetween".
// ════════════════════════════════════════════════════════════════
const DRAWING_MARKS = {
  keyframe: {
    id:          'keyframe',
    abbrev:      'KF',
    displayName: 'Keyframe',
    color:       '#e24b4a'   // red — principal poses
  },
  breakdown: {
    id:          'breakdown',
    abbrev:      'BD',
    displayName: 'Breakdown',
    color:       '#EF9F27'   // amber — passing positions
  },
  inbetween: {
    id:          'inbetween',
    abbrev:      'IB',
    displayName: 'Inbetween',
    color:       '#7F77DD'   // violet — interpolated drawings
  }
};

// The mark ID applied when no markType is stored (new drawings,
// old projects without markType). "inbetween" matches Harmony's
// default — every cell starts unmarked / as a plain inbetween.
const DRAWING_MARK_DEFAULT = 'inbetween';

// ── Drawing mark helpers ───────────────────────────────────────
// These are the ONLY way other modules should read/write markType,
// so the storage location (layer.frameMeta) is encapsulated here.

/** Returns the DRAWING_MARKS entry for a given mark ID (or default). */
function getMarkDef(markId) {
  return DRAWING_MARKS[markId] || DRAWING_MARKS[DRAWING_MARK_DEFAULT];
}

/**
 * Returns the markType string for layer `li` at frame `fi`.
 * Falls back to DRAWING_MARK_DEFAULT for drawings that pre-date
 * this system or that have never been explicitly marked.
 */
let _drawingMarkLookupCount=0,_drawingMarkLookupDuration=0;
function getDrawingMark(li, fi) {
  const started=performance.now();_drawingMarkLookupCount++;
  const layer=layers[li],meta=layer&&layer.frameMeta&&layer.frameMeta[fi];
  const result=(meta&&meta.markType)?meta.markType:DRAWING_MARK_DEFAULT;_drawingMarkLookupDuration+=performance.now()-started;return result;
}

/**
 * Sets the markType for layer `li` at frame `fi`.
 * Creates frameMeta / the per-frame entry as needed.
 * Pass null / undefined to reset to the default (removes the key).
 */
function setDrawingMark(li, fi, markType) {
  const layer = layers[li];
  if (!layer) return;
  if (!layer.frameMeta) layer.frameMeta = {};
  if (!markType || markType === DRAWING_MARK_DEFAULT) {
    // Removing an explicit mark — delete the key to keep storage lean
    if (layer.frameMeta[fi]) {
      delete layer.frameMeta[fi].markType;
      // Clean up the per-frame object entirely if nothing else lives in it
      if (Object.keys(layer.frameMeta[fi]).length === 0) {
        delete layer.frameMeta[fi];
      }
    }
  } else {
    if (!DRAWING_MARKS[markType]) {
      console.warn('[DrawingMark] Unknown mark ID:', markType, '— ignoring.');
      return;
    }
    if (!layer.frameMeta[fi]) layer.frameMeta[fi] = {};
    layer.frameMeta[fi].markType = markType;
  }
}

/** Hidden drawings remain stored, but are ignored by exposure resolution. */
function isDrawingFrameHidden(li, fi) {
  const layer=layers[li],meta=layer&&layer.frameMeta&&layer.frameMeta[fi];
  return !!(meta&&meta.hidden);
}

function setDrawingFrameHidden(li, fi, hidden) {
  const layer=layers[li];
  if(!layer||!layer.frames||!layer.frames[fi]) return false;
  if(!layer.frameMeta) layer.frameMeta={};
  if(hidden){
    if(!layer.frameMeta[fi]) layer.frameMeta[fi]={};
    layer.frameMeta[fi].hidden=true;
  }else if(layer.frameMeta[fi]){
    delete layer.frameMeta[fi].hidden;
    if(Object.keys(layer.frameMeta[fi]).length===0) delete layer.frameMeta[fi];
  }
  return true;
}
// Layer object shape: {name, visible, onTimeline, color, frames, opacity(0-1), stencil('none'|'inside'|'outside'), clipTo(layerIdx|null), groupId(string|null)}
// Group object shape: {id, name, visible, collapsed, opacity(0-1), color, parentId(string|null — id of the group this group is nested inside, null = top level)}
let groups=[];
function defaultLayerNameForType(layerType){
  const type=layerType==='smart-raster'?'smart-raster':'bitmap';
  const label=type==='smart-raster'?'Smart Raster Layer':'Layer';
  const count=layers.filter(l=>(l.type||'bitmap')===type).length;
  return label+' '+(count+1);
}
function makeBlankLayer(layerType,extra){
  const type=layerType==='smart-raster'?'smart-raster':'bitmap';
  return Object.assign({
    name:defaultLayerNameForType(type),
    visible:true,
    onTimeline:true,
    color:'transparent',
    frames:{},
    frameMeta:{},
    indexFrames:{},
    indexMeta:{},
    type,
    renderMode:'legacy',
    smartRasterV4Native:type==='smart-raster',
    opacity:1,
    stencil:'none',
    clipTo:null,
    groupId:null
  },extra||{});
}
let layers=[{name:'Layer 1',visible:true,onTimeline:true,color:'transparent',frames:{},frameMeta:{},indexFrames:{},indexMeta:{},type:'bitmap',opacity:1,stencil:'none',clipTo:null,groupId:null}];

// Zoom / Pan / Rotate — stored in canvas-area coordinate space
let zoom=1,panX=0,panY=0;
let zoomSpeed=0.15,zoomMin=0.1,zoomMax=16;
let rotation=0; // canvas rotation in degrees, clockwise
let flipX=false,flipY=false; // canvas mirrored horizontally / vertically (view-only, like rotation)

// Selection
let selectedFrames=new Set([0]);
let selectedKFs=new Set();
let tlSelDrag=null;

// Panel visibility
let showLayers=true,showTimeline=true,showToolbar=true;

// ════════════════════════════════════════════════════════════════
// DOM REFS
// ════════════════════════════════════════════════════════════════
const compC=document.getElementById('composite-canvas');
const displayC=document.getElementById('display-canvas');
const onionC=document.getElementById('onion-canvas');
const activeC=document.getElementById('active-canvas');
const compCtx=compC.getContext('2d');
const displayCtx=displayC.getContext('2d');
const octx=onionC.getContext('2d');
// NOTE: deliberately NOT using {desynchronized:true} here. activeC is read
// back synchronously via drawImage in saveActiveToKey() every time you
// switch layers/frames (panels.js), right around when recomposite() also
// toggles activeC's opacity on a rAF callback. desynchronized rendering
// lets the browser present this canvas through an independently-timed
// buffer for lower input latency, but that means a same-tick drawImage
// read-back of it is not guaranteed to reflect the very latest paint in
// every browser/GPU combo — which intermittently made a layer switch save
// a stale/blank copy of what was just drawn, looking like lost work.
const ctx=activeC.getContext('2d');
const wrap=document.getElementById('canvas-wrap');
const canvasArea=document.getElementById('canvas-area');
const rulerEl=document.getElementById('tl-ruler');
const tlScroll=document.getElementById('tl-scroll');
const zoomInd=document.getElementById('zoom-indicator');
const toolbarEl=document.getElementById('toolbar');
const rightPanel=document.getElementById('right-panel');
const bottomArea=document.getElementById('bottom-area');
const rhBottom=document.getElementById('rh-bottom');
const mainArea=document.getElementById('main-area');
const timelineArea=document.getElementById('timeline-area');
const fpsTl=document.getElementById('fps-tl');
const fpsVal=document.getElementById('fps-val');

// ════════════════════════════════════════════════════════════════
// CANVAS INIT
// ════════════════════════════════════════════════════════════════
function initCanvas(){
  const transformC=document.getElementById('transform-canvas');
  [compC,displayC,onionC,activeC,transformC].forEach(c=>{c.width=CW;c.height=CH;});
  wrap.style.width=CW+'px';wrap.style.height=CH+'px';
  drawBg();
  document.getElementById('stat-canvas').textContent=CW+'×'+CH;
}

// PERF FIX: drawBg() runs on EVERY animation frame while a stroke is in
// progress (recomposite() is RAF-scheduled from every pointermove). For a
// transparent background it used to create a brand-new <canvas>, fill it,
// and build a brand-new repeat-pattern from it on every single call — up to
// 60×/sec while drawing, just to redraw a checkerboard that never changes.
// Build the tiny tile + pattern ONCE and reuse the cached pattern object.
let _bgCheckerPattern=null;
function _getBgCheckerPattern(){
  if(_bgCheckerPattern) return _bgCheckerPattern;
  const pat=document.createElement('canvas');pat.width=14;pat.height=14;
  const pc=pat.getContext('2d');
  pc.fillStyle='#aaa';pc.fillRect(0,0,14,14);
  pc.fillStyle='#ddd';pc.fillRect(0,0,7,7);pc.fillRect(7,7,7,7);
  _bgCheckerPattern=compCtx.createPattern(pat,'repeat');
  return _bgCheckerPattern;
}
function drawBg(){
  compCtx.fillStyle = (bgColor==='transparent') ? _getBgCheckerPattern() : bgColor;
  compCtx.fillRect(0,0,CW,CH);
}

// ════════════════════════════════════════════════════════════════
// ZOOM & PAN  — all coordinates in canvas-area space
// ════════════════════════════════════════════════════════════════

// Docked panels (Tools, Layers, Brush Presets, etc.) sit on top of
// canvas-area via absolute positioning, so canvas-area's own box never
// shrinks for them — compute the actual visually-clear rect by
// subtracting whichever docked, visible panels currently occupy each edge.
// Shared by centerCanvas() and getNavPivot() so "center" always means the
// same thing for layout and for the rotation pivot.
function _getClearArea(){
  const r=canvasArea.getBoundingClientRect();
  // Draw Mode hides the complete dock layer. Its child panels can still
  // match the dock selectors while returning zero-sized rectangles at the
  // viewport origin, which must not be interpreted as occupied dock space.
  if(document.body.classList.contains('draw-mode')){
    return {
      r,left:0,right:0,top:0,bottom:0,
      clearW:r.width,
      clearH:r.height
    };
  }
  let left=0,right=0,top=0,bottom=0;
  document.querySelectorAll('.float-panel.docked:not(.fp-hidden)').forEach(panel=>{
    const pr=panel.getBoundingClientRect();
    // Use the actual canvas-facing edge, including the panel's live dock
    // offset. Width alone is insufficient when several dock columns sit
    // side-by-side on the same edge.
    if(panel.classList.contains('dock-left')){
      left=Math.max(left,Math.min(r.width,Math.max(0,pr.right-r.left)));
    }else if(panel.classList.contains('dock-right')){
      right=Math.max(right,Math.min(r.width,Math.max(0,r.right-pr.left)));
    }else if(panel.classList.contains('dock-top')){
      top=Math.max(top,Math.min(r.height,Math.max(0,pr.bottom-r.top)));
    }else if(panel.classList.contains('dock-bottom')){
      bottom=Math.max(bottom,Math.min(r.height,Math.max(0,r.bottom-pr.top)));
    }
  });
  return {
    r,left,right,top,bottom,
    clearW:Math.max(0,r.width-left-right),
    clearH:Math.max(0,r.height-top-bottom)
  };
}

/** Center canvas within the visible canvas-area */
function centerCanvas(){
  const {left,top,clearW,clearH}=_getClearArea();
  panX=left+(clearW-CW*zoom)/2;
  panY=top+(clearH-CH*zoom)/2;
  applyTransform();
}

/** Center of the visually-clear canvas-area (docked panels excluded).
 * Returns both:
 *  - cx,cy: LOCAL coords (relative to canvas-area's own box) — the same
 *    space panX/panY live in, so this is what rotateCanvasTo()/zoom-drag
 *    math and the crosshair's CSS left/top (it's absolutely positioned
 *    inside canvas-area) must use.
 *  - gcx,gcy: GLOBAL/client coords (viewport-relative) — for comparing
 *    against raw mouse/pointer event clientX/clientY (e.g. rotate-drag
 *    angle tracking).
 * Used as the pivot for canvas rotation (and the rotation crosshair) so it
 * always sits in the middle of the visible drawing space rather than the
 * middle of canvas-area's full underlying box, which docked panels would
 * otherwise throw off-center. */
function getNavPivot(){
  const {r,left,top,clearW,clearH}=_getClearArea();
  return {cx:left+clearW/2, cy:top+clearH/2, gcx:r.left+left+clearW/2, gcy:r.top+top+clearH/2};
}

function _toUnflippedNavPoint(x,y){
  const pivot=getNavPivot();
  return {
    x:pivot.cx+(x-pivot.cx)*(flipX?-1:1),
    y:pivot.cy+(y-pivot.cy)*(flipY?-1:1)
  };
}

/** Compute a zoom level that fits the whole canvas inside canvas-area (with padding), then center it.
 * Used for initial layout and "Reset Layout" so large canvases (e.g. 1920×1080) don't start zoomed
 * in past the visible viewport. */
function fitCanvasToView(){
  const {clearW,clearH}=_getClearArea();
  if(clearW<=0||clearH<=0) return; // layout not settled yet
  const pad=40;
  const fitZoom=Math.min((clearW-pad)/CW,(clearH-pad)/CH);
  zoom=Math.max(zoomMin,Math.min(zoomMax,fitZoom>0?fitZoom:1));
  centerCanvas();showZoom();
}

function applyTransform(){
  // Flip is applied OUTSIDE rotate/scale, as a screen-space mirror around
  // the nav pivot (translate(pivot) scale(±1) translate(-pivot) wrapping
  // the normal translate/rotate/scale chain). Folding the flip into the
  // local scale axes instead (as a previous version did) makes "horizontal"
  // and "vertical" rotate along with the canvas — at 90° a "horizontal"
  // flip would visually mirror top/bottom. Doing it in screen space keeps
  // Flip Horizontal always left/right and Flip Vertical always up/down,
  // no matter the current rotation. The pivot is recomputed live each call
  // (same as getNavPivot() everywhere else); it only changes pan/rotate
  // doesn't move it, so no pan compensation is needed when toggling.
  const pivot=getNavPivot();
  const fx=flipX?-1:1,fy=flipY?-1:1;
  wrap.style.transform=
    `translate(${pivot.cx}px,${pivot.cy}px) scale(${fx},${fy}) translate(${-pivot.cx}px,${-pivot.cy}px) `+
    `translate(${panX}px,${panY}px) rotate(${rotation}deg) scale(${zoom})`;
  // TVPaint behaviour: nearest-neighbour (crisp) once zoomed in enough,
  // bilinear (soft) below that. At exact/high zoom this preserves the true
  // hard-edged pixels instead of applying a second display blur.
  const useNN=zoom>=2;
  const transformC=document.getElementById('transform-canvas');
  [displayC,onionC,activeC,transformC].forEach(c=>{
    c.style.imageRendering=useNN?'pixelated':'auto';
  });
  _updateDisplayBlur();
  window.dispatchEvent(new Event('canvas-view-transform-changed'));
}

function toggleFlipH(){
  flipX=!flipX;applyTransform();
  const btn=document.getElementById('btn-flip-h');if(btn)btn.classList.toggle('active',flipX);
}
function toggleFlipV(){
  flipY=!flipY;applyTransform();
  const btn=document.getElementById('btn-flip-v');if(btn)btn.classList.toggle('active',flipY);
}

// ── Zoomed-out shimmer fix ──────────────────────────────────────────────
// compC (the data canvas) gets redrawn at full resolution every frame while
// drawing, then shown on screen via CSS transform: scale(zoom). When
// zoom<1 the browser has to re-downsample that full-res bitmap EVERY
// FRAME (since it just changed), and browsers generally use a cheap
// single-tap filter for that continuous case rather than a proper
// mipmap/box-filter — which aliases a hard antialiased stroke edge into a
// shimmering "wave" as you draw. (At zoom>=1 there's no minification, so
// it never shows up — matches the reported symptom exactly.)
// Fix: pre-blur the DISPLAY-ONLY copy (compC -> displayC) by an amount
// proportional to how much it's about to be shrunk, before the browser's
// own downscale runs. This is the standard "pre-filter before minifying"
// technique and is what a correct box-filtered downsample would already
// be doing; compC itself is never touched, so eyedropper/export/etc. stay
// pixel-exact.
let _displayBlurPx=0;
const _ZOOM_BLUR_START=0.5; // zoom level below which the pre-blur starts (was ~1.0 — engaged almost immediately on any zoom-out)
function _updateDisplayBlur(){
  _displayBlurPx = zoom<_ZOOM_BLUR_START ? Math.min(6, (_ZOOM_BLUR_START/zoom - 1) * 0.8) : 0;
}

function showZoom(){
  const pct=Math.round(zoom*100)+'%';
  zoomInd.textContent=pct;
  zoomInd.classList.add('show');
  document.getElementById('stat-zoom').textContent='Zoom: '+pct;
  clearTimeout(zoomInd._t);
  zoomInd._t=setTimeout(()=>zoomInd.classList.remove('show'),1100);
}

const rotInd=document.getElementById('rotation-indicator');
// Keep the angle HUD in the main application overlay layer, outside the
// lower canvas stacking context used beneath docked panels.
document.getElementById('main-area')?.appendChild(rotInd);
function showRotation(){
  // Normalize to (-180, 180] for a friendlier readout while keeping
  // the underlying `rotation` value unbounded (simpler drag math).
  let disp=((rotation+180)%360+360)%360-180;
  if(disp===-180) disp=180;
  const deg=Math.round(disp)+'°';
  if(rotInd){
    rotInd.textContent=deg;
    rotInd.classList.toggle('show',rotation!==0);
    if(rotation!==0){
      clearTimeout(rotInd._t);
      rotInd._t=setTimeout(()=>rotInd.classList.remove('show'),1100);
    } else {
      clearTimeout(rotInd._t);
    }
  }
  document.getElementById('stat-rotation').textContent='Rotation: '+deg;
}

/**
 * Rotate the canvas to `newRot` degrees, keeping the canvas-space point
 * currently under the pivot (pivotX,pivotY, in canvas-area LOCAL
 * coordinates — the same space panX/panY live in) visually fixed on
 * screen — mirrors how doZoom() anchors zoom to a point.
 */
function rotateCanvasTo(newRot,pivotX,pivotY){
  const rad=rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const dx=pivotX-panX,dy=pivotY-panY;
  // Un-rotate + un-scale to get the canvas-space point under the pivot.
  const ux=(dx*cosR+dy*sinR)/zoom;
  const uy=(-dx*sinR+dy*cosR)/zoom;
  rotation=newRot;
  const rad2=rotation*Math.PI/180;
  const cos2=Math.cos(rad2),sin2=Math.sin(rad2);
  panX=pivotX-(ux*cos2-uy*sin2)*zoom;
  panY=pivotY-(ux*sin2+uy*cos2)*zoom;
  applyTransform();showRotation();
}

/** Reset rotation back to 0°, keeping the canvas-space point under the
 *  nav pivot visually fixed — same pivot-preserving math as rotateCanvasTo().
 *  Pan, zoom, and flip are all preserved; only rotation changes. */
function resetRotation(){
  const p=getNavPivot();
  rotateCanvasTo(0,p.cx,p.cy);
}

/**
 * Zoom toward a point (cx,cy) in canvas-area client coordinates.
 * cx,cy are relative to canvasArea element top-left.
 */
function doZoom(delta,cx,cy){
  ({x:cx,y:cy}=_toUnflippedNavPoint(cx,cy));
  const oldZoom=zoom;
  zoom=Math.max(zoomMin,Math.min(zoomMax,zoom*(1+delta*zoomSpeed)));
  // Adjust pan so that the canvas-space point under cursor stays fixed:
  // canvasX = (cx - panX) / oldZoom  →  after zoom: panX_new = cx - canvasX * zoom
  panX=cx-(cx-panX)*(zoom/oldZoom);
  panY=cy-(cy-panY)*(zoom/oldZoom);
  applyTransform();showZoom();
}

// Scroll to zoom toward cursor
canvasArea.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=canvasArea.getBoundingClientRect();
  const cx=e.clientX-r.left;
  const cy=e.clientY-r.top;
  // Trackpad pinch-to-zoom sets ctrlKey=true; plain two-finger scroll does not
  if(e.ctrlKey){
    // Pinch-to-zoom: use deltaY magnitude for smooth zoom
    const navPoint=_toUnflippedNavPoint(cx,cy);
    const navX=navPoint.x,navY=navPoint.y;
    const factor=1-e.deltaY*0.01;
    const oldZoom=zoom;
    zoom=Math.max(zoomMin,Math.min(zoomMax,zoom*factor));
    panX=navX-(navX-panX)*(zoom/oldZoom);
    panY=navY-(navY-panY)*(zoom/oldZoom);
    applyTransform();showZoom();
  } else {
    // Two-finger scroll pan OR mouse wheel zoom
    if(e.deltaX!==0||Math.abs(e.deltaY)<50){
      // Trackpad scroll: pan the canvas. Same un-mirroring as the
      // space-drag pan is needed here so scroll direction stays natural
      // regardless of flip state.
      const fx=flipX?-1:1,fy=flipY?-1:1;
      panX-=fx*e.deltaX;
      panY-=fy*e.deltaY;
      applyTransform();
    } else {
      // Mouse wheel: zoom
      const dir=e.deltaY<0?1:-1;
      doZoom(dir,cx,cy);
    }
  }
},{passive:false});

// Pan (Space+drag or middle mouse); Rotate (Shift+Space+drag)
let panning=false,panSX=0,panSY=0,panSPX=0,panSPY=0;
let spaceHeld=false,ctrlHeld=false,shiftHeld=false;
let _zoomDrag=false,_zoomDragSX=0,_zoomDragStartZoom=0,_zoomDragCX=0,_zoomDragCY=0;
let _rotateDrag=false,_rotateDragSX=0,_rotateDragSY=0,_rotateDragStartRot=0,_rotateDragCX=0,_rotateDragCY=0,_rotateDragGCX=0,_rotateDragGCY=0;

// Capture phase on window + stopPropagation: Space (and especially Ctrl+Space)
// must be stopped BEFORE it can reach the browser's own shortcut handling.
// Some browsers treat Ctrl+Space as "focus the address/search bar" — a plain
// document-level bubble-phase listener with only preventDefault() isn't
// always early/forceful enough to stop that, so we intercept as early as
// possible and explicitly stop the event from propagating any further.
// Real text-entry inputs (where Space should type a literal space) get
// exempted from the pan handler; other <input> types (range sliders,
// checkboxes, color pickers, etc.) do NOT need typed spaces and must not be
// able to keep Ctrl+Space from being captured just because they're focused.
const _TEXT_ENTRY_TYPES=new Set(['text','search','number','email','password','tel','url']);
function _isTextEntryTarget(t){
  if(t.tagName==='TEXTAREA') return true;
  if(t.tagName==='INPUT') return _TEXT_ENTRY_TYPES.has((t.type||'text').toLowerCase());
  return false;
}

// Elements over which Space/Ctrl+Space/Shift+Space drag navigation should
// NOT engage — dockers, floating panels, the menu/toolbar, timeline,
// status bar, modals, and any interactive control. Everywhere else
// (including outside canvas-area itself, e.g. over empty space, the
// timeline, or status bar) is fair game for navigating the canvas.
const _NAV_BLOCKED_SELECTOR='.float-panel,#toolbar,#menubar,.dropdown,#bottom-area,#status,.modal-overlay,.modal,[data-space-pan],button,input,select,textarea,a';
function _isNavBlocked(t){
  return !!(t&&typeof t.closest==='function'&&t.closest(_NAV_BLOCKED_SELECTOR));
}

const rotPivotEl=document.getElementById('rotation-pivot');
function _updateRotPivotVisibility(){
  if(!rotPivotEl) return;
  const show=_rotateDrag||(spaceHeld&&shiftHeld&&!ctrlHeld);
  rotPivotEl.classList.toggle('show',show);
  if(show){
    // rotation-pivot is absolutely positioned inside canvas-area, so it
    // needs LOCAL (canvas-area-relative) coords, not raw client coords.
    const p=_rotateDrag?{cx:_rotateDragCX,cy:_rotateDragCY}:getNavPivot();
    rotPivotEl.style.left=p.cx+'px';
    rotPivotEl.style.top=p.cy+'px';
  }
}

window.addEventListener('keydown',e=>{
  if(e.key==='Control'||e.code==='ControlLeft'||e.code==='ControlRight'){
    ctrlHeld=true;
    if(spaceHeld&&!panning&&!_zoomDrag&&!_rotateDrag) activeC.style.cursor='zoom-in';
  }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ shiftHeld=true; _updateRotPivotVisibility(); }
  if(e.code==='Space'&&!_isTextEntryTarget(e.target)){
    e.preventDefault();e.stopPropagation();spaceHeld=true;
    // Space is a canvas-only shortcut — if a toolbar button/control still
    // has keyboard focus from an earlier click (e.g. the AA toggle), drop
    // it now. Otherwise a focus-visible ring can latch onto that control
    // and never clear, since nothing else would blur it afterwards.
    if(document.activeElement&&document.activeElement!==document.body&&document.activeElement.blur) document.activeElement.blur();
    if(!panning&&!_zoomDrag&&!_rotateDrag) activeC.style.cursor=ctrlHeld?'zoom-in':(shiftHeld?'alias':'grab');
    _updateRotPivotVisibility();
  }
},{capture:true});
window.addEventListener('keyup',e=>{
  if(e.key==='Control'||e.code==='ControlLeft'||e.code==='ControlRight'){
    ctrlHeld=false;
    if(spaceHeld&&!panning&&!_zoomDrag&&!_rotateDrag) activeC.style.cursor=shiftHeld?'alias':'grab';
  }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ shiftHeld=false; _updateRotPivotVisibility(); }
  if(e.code==='Space'){
    e.preventDefault();e.stopPropagation();
    spaceHeld=false;
    if(!panning&&!_zoomDrag&&!_rotateDrag) activeC.style.cursor=activeGroupId?'not-allowed':_baseCursorCSS();
    _updateRotPivotVisibility();
  }
},{capture:true});

function _spaceDragStart(clientX,isCtrl){
  if(isCtrl||ctrlHeld){
    _zoomDrag=true;_zoomDragSX=clientX;_zoomDragStartZoom=zoom;
    canvasArea.style.cursor='zoom-in';
  } else if(shiftHeld){
    const p=getNavPivot();
    _rotateDrag=true;_rotateDragSX=clientX;_rotateDragSY=0;
    _rotateDragStartRot=rotation;
    _rotateDragCX=p.cx;_rotateDragCY=p.cy;_rotateDragGCX=p.gcx;_rotateDragGCY=p.gcy;
    canvasArea.style.cursor='alias';
    _updateRotPivotVisibility();
  } else {
    panning=true;panSX=clientX;panSY=0;panSPX=panX;panSPY=panY;
    canvasArea.style.cursor='grabbing';
  }
}
function _spaceDragStartXY(clientX,clientY,isCtrl){
  if(isCtrl||ctrlHeld){
    _zoomDrag=true;_zoomDragSX=clientX;_zoomDragStartZoom=zoom;
    // Anchor the zoom to wherever the drag actually started (in local
    // canvas-area coordinates), not the canvas-area center — this matches
    // how scroll-wheel zoom already anchors to the cursor position.
    const r=canvasArea.getBoundingClientRect();
    const navPoint=_toUnflippedNavPoint(clientX-r.left,clientY-r.top);
    _zoomDragCX=navPoint.x;_zoomDragCY=navPoint.y;
    canvasArea.style.cursor='zoom-in';
  } else if(shiftHeld){
    const p=getNavPivot();
    _rotateDrag=true;_rotateDragSX=clientX;_rotateDragSY=clientY;
    _rotateDragStartRot=rotation;
    _rotateDragCX=p.cx;_rotateDragCY=p.cy;_rotateDragGCX=p.gcx;_rotateDragGCY=p.gcy;
    canvasArea.style.cursor='alias';
    _updateRotPivotVisibility();
  } else {
    panning=true;panSX=clientX;panSY=clientY;panSPX=panX;panSPY=panY;
    canvasArea.style.cursor='grabbing';
  }
}
function _spaceDragMove(clientX,clientY){
  if(_zoomDrag){
    // drag right = zoom in, drag left = zoom out; 300px = 2x
    const dx=clientX-_zoomDragSX;
    // Zoom anchored to where the drag started, not the canvas-area center —
    // matches scroll-wheel zoom's cursor-anchored behavior.
    const cx=_zoomDragCX,cy=_zoomDragCY;
    const newZoom=Math.max(zoomMin,Math.min(zoomMax,_zoomDragStartZoom*Math.pow(2,dx/300)));
    panX=cx-(cx-panX)*(newZoom/zoom);
    panY=cy-(cy-panY)*(newZoom/zoom);
    zoom=newZoom;
    applyTransform();
  } else if(_rotateDrag){
    // Rotate proportional to the swept angle around the canvas-area
    // center, so dragging in an arc feels like spinning the canvas.
    // Angle tracking compares against raw clientX/clientY, so it uses the
    // GLOBAL pivot; the actual pan adjustment (rotateCanvasTo) needs the
    // LOCAL pivot, since that's the coordinate space panX/panY live in.
    const a0=Math.atan2(_rotateDragSY-_rotateDragGCY,_rotateDragSX-_rotateDragGCX);
    const a1=Math.atan2(clientY-_rotateDragGCY,clientX-_rotateDragGCX);
    const reflectionDirection=(flipX!==flipY)?-1:1;
    const deltaDeg=(a1-a0)*180/Math.PI*reflectionDirection;
    rotateCanvasTo(_rotateDragStartRot+deltaDeg,_rotateDragCX,_rotateDragCY);
  } else if(panning){
    // panX/panY live inside the flip mirror (applied outside them in
    // applyTransform), so a screen-space mouse delta must be un-mirrored
    // (sign-flipped) before being added to them — otherwise dragging right
    // moves the canvas left whenever flipX (or flipY) is active.
    const fx=flipX?-1:1,fy=flipY?-1:1;
    panX=panSPX+fx*(clientX-panSX);
    panY=panSPY+fy*(clientY-panSY);
    applyTransform();
  }
}
function _spaceDragEnd(){
  if(panning){panning=false;canvasArea.style.cursor='';activeC.style.cursor=activeGroupId?'not-allowed':_baseCursorCSS();}
  if(_zoomDrag){_zoomDrag=false;canvasArea.style.cursor='';activeC.style.cursor=activeGroupId?'not-allowed':_baseCursorCSS();}
  if(_rotateDrag){_rotateDrag=false;canvasArea.style.cursor='';activeC.style.cursor=activeGroupId?'not-allowed':_baseCursorCSS();_updateRotPivotVisibility();}
}

// Mouse (and trackpad) — bound to window (capture) rather than just
// canvas-area so Space/Ctrl+Space/Shift+Space drag works anywhere in the
// app (timeline, status bar, empty space around the canvas, etc.), while
// _isNavBlocked() keeps it from engaging over dockers, floating panels,
// the toolbar/menu, modals, or other interactive controls.
window.addEventListener('mousedown',e=>{
  if(e.button!==1&&!(e.button===0&&spaceHeld)) return;
  if(_isNavBlocked(e.target)) return;
  e.preventDefault();_spaceDragStartXY(e.clientX,e.clientY,e.ctrlKey);
},{capture:true});
document.addEventListener('mousemove',e=>{
  if(!panning&&!_zoomDrag&&!_rotateDrag) return;
  _spaceDragMove(e.clientX,e.clientY);
});
document.addEventListener('mouseup',()=>{ _spaceDragEnd(); });

// Pointer Events are the primary navigation path for both mouse and pen.
// Handling mouse here prevents a canvas pointerdown from suppressing the
// later compatibility mousedown before Ctrl+Space zoom can begin.
let _navPointerId=null;
window.addEventListener('pointerdown',e=>{
  const isMouse=e.pointerType==='mouse';
  const isPen=e.pointerType==='pen';
  const middleMouse=isMouse&&e.button===1;
  const primaryWithSpace=(isMouse||isPen)&&spaceHeld&&e.button===0;
  if(!middleMouse&&!primaryWithSpace) return;
  if(_isNavBlocked(e.target)) return;
  e.preventDefault();e.stopImmediatePropagation();
  _navPointerId=e.pointerId;
  if(e.target&&e.target.setPointerCapture){
    try{e.target.setPointerCapture(e.pointerId);}catch(_){}
  }
  _spaceDragStartXY(e.clientX,e.clientY,e.ctrlKey||ctrlHeld);
},{capture:true});
document.addEventListener('pointermove',e=>{
  if(e.pointerId===_navPointerId&&(panning||_zoomDrag||_rotateDrag)){
    _spaceDragMove(e.clientX,e.clientY);
  }
});
function _endPointerNavigation(e){
  if(_navPointerId==null||(e&&e.pointerId!==_navPointerId)) return;
  _navPointerId=null;
  _spaceDragEnd();
}
document.addEventListener('pointerup',_endPointerNavigation);
document.addEventListener('pointercancel',_endPointerNavigation);
