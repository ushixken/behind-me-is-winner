// ════════════════════════════════════════════════════════════════
// DRAWING — getPos uses activeC's own getBoundingClientRect()
// which accounts for the CSS transform, giving pixel-perfect coords
// ════════════════════════════════════════════════════════════════
function getPos(e){
  // getBoundingClientRect() on activeC only gives the axis-aligned bounding
  // box of the rotated element, NOT its true rotated geometry — using it
  // directly (as before) works fine at rotation=0 but drifts the stroke
  // away from the pen tip at any other rotation. Instead, map the client
  // point through canvas-area's rect and invert the same
  // outer-mirror + translate/rotate/scale transform applied to canvas-wrap
  // (mirrors the math in rotateCanvasTo()/applyTransform()) to get exact
  // canvas-pixel coordinates.
  const r=canvasArea.getBoundingClientRect();
  const clientX=e.touches?e.touches[0].clientX:e.clientX;
  const clientY=e.touches?e.touches[0].clientY:e.clientY;
  const ax=clientX-r.left,ay=clientY-r.top;
  // Undo the outer screen-space flip mirror around the (live) nav pivot first.
  const pivot=getNavPivot();
  const fx=flipX?-1:1,fy=flipY?-1:1;
  const qx=pivot.cx+(ax-pivot.cx)*fx;
  const qy=pivot.cy+(ay-pivot.cy)*fy;
  // Then undo the inner translate/rotate/scale chain (flip-agnostic).
  const rad=rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const dx=qx-panX,dy=qy-panY;
  const x=(dx*cosR+dy*sinR)/zoom;
  const y=(-dx*sinR+dy*cosR)/zoom;
  return{x,y};
}

function getBrushSize(){return toolSizes[tool]||6;}
// Brush Density (Photoshop/CSP "Density"/"Flow build-up" style control).
// Distinct from brushOpacity (Flow): opacity/flow sets the ceiling alpha a
// single dab can reach; density scales how much of that ceiling each
// individual stamp actually deposits. At 100% a dab lays down its full
// opacity-driven alpha in one pass (current/legacy behavior, unchanged).
// Below 100%, each dab is proportionally lighter/more transparent, so
// solid coverage only appears after enough overlapping dabs/strokes
// accumulate — the same "build up density" feel as professional apps.
// Declared here (not core-state.js) but shared globally across all
// non-module <script> tags on the page, same as brushOpacity/brushHardness.
let brushDensity = 1;

// ── Brush Tip Image (ABR / custom upload) ──────────────────────────────────
// When non-null, this canvas holds a grayscale alpha mask that replaces the
// default circle/gradient dab shape.  The tip image is stored at its native
// resolution and scaled to the effective brush diameter on every dab.
// brushTipVersion is bumped whenever the canvas is replaced so that every
// stamp cache that keyed on it is automatically invalidated without a
// manual cache.clear() call at the use site.
window.brushTipCanvas   = null;   // HTMLCanvasElement | null
window.brushTipVersion  = 0;      // integer, incremented on each tip change
// When true the tip mask is multiplied by the standard radial hardness
// falloff — giving a soft feathered edge even on an imported ABR tip.
// When false the tip image alpha is used verbatim (hard-edged custom shape).
window.brushTipSoftAlpha = true;
// 'multiply' applies the tip as an alpha-mask on top of the normal dab.
// 'replace'  uses the tip as the sole shape with no circle falloff at all.
window.brushTipMode = 'multiply';

// ── Brush Texture Image ────────────────────────────────────────────────────
// When non-null, this canvas is tiled as a repeating texture over each dab
// with globalCompositeOperation='multiply' at depth-controlled opacity.
// Completely independent from the tip shape above.
window.brushTextureCanvas  = null; // HTMLCanvasElement | null
window.brushTextureVersion = 0;    // integer, incremented on each texture change
// 0–1 blend strength for the texture overlay (mirrors ts-texture-depth slider)
window.brushTextureDepth   = 0.5;

// brushFlow: per-dab paint accumulation rate (0–1).
// Controls how much alpha each individual dab deposits while the stroke is
// in progress. Dabs composite on top of each other freely — so dragging
// slowly over the same spot builds up to full coverage. This is "Flow" in
// Photoshop / Clip Studio Paint.
// Distinct from brushOpacity (see below), which caps the ENTIRE stroke's
// final transparency as a layer-level composite — not individual dabs.
let brushFlow = 1;

// ── Dynamic Opacity tracking (Dynamics tab ▸ "Opacity" control) ─────────
// This dropdown used to be labeled "Opacity / Flow" but its influence was
// actually only ever applied to per-dab Flow alpha below — the real
// stroke-level Opacity (brushOpacity, applied once in _commitStrokeCanvas)
// never responded to pressure at all, despite the label.
//
// A later revision tried fixing this by averaging/peaking the influence
// across the whole stroke and applying it ONCE, as a single multiplier,
// when the stroke committed on pointerup. That made the control feel
// broken in a different way: while actually drawing, every dab painted at
// full alpha (the live preview only ever used brushOpacity, never the
// dynamic multiplier), so a light touch still looked solid black in real
// time — the opacity would only "snap" down to some fixed low value after
// lifting the pen, instead of tracking pressure as it happened.
//
// Fixed here by applying the pressure influence PER DAB, in real time —
// exactly like Size dynamics already does — instead of deferring it to
// stroke-end. Each dab's alpha is scaled by its own instantaneous pressure
// reading, so light pressure paints light immediately and heavy pressure
// paints dark immediately, live, matching what the user is actually doing
// with the pen at that moment. brushOpacity itself remains a separate,
// constant stroke-level cap applied once at commit (see
// _commitStrokeCanvas), unaffected by this per-dab control.

// ── Stroke temp canvas ──────────────────────────────────────────────────
// Opacity (brushOpacity) works at the stroke level: all dabs within a single
// stroke accumulate on a scratch canvas; when the stroke ends the scratch is
// composited onto activeC with globalAlpha = brushOpacity. This means:
//   • Flow  = how dabs build up within the stroke (per-dab alpha = brushFlow).
//   • Opacity = the maximum final transparency of the completed stroke.
// This matches Photoshop's and Clip Studio's Opacity / Flow behavior exactly.
let _strokeCanvas = null; // offscreen scratch canvas for the current stroke
let _strokeCtx    = null; // its 2D context
// True while a stroke is being painted to _strokeCanvas (between pointerdown
// and the end-of-stroke composite). Used to switch dab targets.
let _inStroke = false;

function _ensureStrokeCanvas(){
  const w = activeC.width, h = activeC.height;
  if(!_strokeCanvas || _strokeCanvas.width !== w || _strokeCanvas.height !== h){
    _strokeCanvas = document.createElement('canvas');
    _strokeCanvas.width  = w;
    _strokeCanvas.height = h;
    _strokeCtx = _strokeCanvas.getContext('2d', {willReadFrequently: true});
  } else {
    _strokeCtx.clearRect(0, 0, w, h);
  }
}

// Composite the stroke scratch canvas onto activeC with stroke-level opacity,
// then clear the scratch for the next stroke. Per-dab pressure influence on
// Opacity is already baked into each dab's alpha as it was painted (see
// _computeEffectiveParams), so this only needs to apply the constant
// brushOpacity ceiling — no separate end-of-stroke multiplier.
function _commitStrokeCanvas(){
  if(!_strokeCanvas) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(_strokeCanvas, 0, 0);
  ctx.restore();
  _strokeCtx.clearRect(0, 0, _strokeCanvas.width, _strokeCanvas.height);
}

// ── Live stroke preview ─────────────────────────────────────────────────
// While a stroke is in progress, dabs land on the offscreen _strokeCanvas
// (not activeC) so stroke-level Opacity/Flow can be composited correctly
// once at stroke-end (see _commitStrokeCanvas above). But recomposite()
// only ever reads activeC for the active layer — so without this, nothing
// the user is currently drawing shows up until pointerup finally commits
// the scratch canvas, which is exactly the "stroke only appears when you
// let go" bug. Fix: build a live preview canvas that layers the in-
// progress _strokeCanvas over activeC at brushOpacity — the same blend
// _commitStrokeCanvas will eventually perform for real — and hand THAT to
// recomposite() as the active layer's source while `_inStroke` is true.
// This is purely a read-side preview: activeC itself is untouched, so the
// stroke-canvas pipeline and its opacity handling at commit time are
// unaffected.
let _strokePreviewCanvas = null;
let _strokePreviewCtx    = null;
function _getLiveStrokePreview(){
  const w = activeC.width, h = activeC.height;
  if(!_strokePreviewCanvas || _strokePreviewCanvas.width !== w || _strokePreviewCanvas.height !== h){
    _strokePreviewCanvas = document.createElement('canvas');
    _strokePreviewCanvas.width  = w;
    _strokePreviewCanvas.height = h;
    _strokePreviewCtx = _strokePreviewCanvas.getContext('2d');
  } else {
    _strokePreviewCtx.clearRect(0, 0, w, h);
  }
  _strokePreviewCtx.drawImage(activeC, 0, 0);
  if(_strokeCanvas){
    _strokePreviewCtx.save();
    _strokePreviewCtx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
    _strokePreviewCtx.globalCompositeOperation = 'source-over';
    _strokePreviewCtx.drawImage(_strokeCanvas, 0, 0);
    _strokePreviewCtx.restore();
  }
  return _strokePreviewCanvas;
}
window._getLiveStrokePreview = _getLiveStrokePreview;
// ════════════════════════════════════════════════════════════════
// TVPAINT / CLIP STUDIO STYLE BRUSH ENGINE
//
// Two antialiasing modes, matching how professional animation apps work:
//
//  AA ON  (brushAA=true) — sub-pixel radial gradient dabs.
//    Each dab is a radial gradient: fully opaque core → transparent edge.
//    The feather zone is controlled by brushHardness.
//    This is TVPaint's PenBrush / Clip Studio Paint's normal pen/brush:
//    smooth diagonal edges, anti-aliased curves, soft feel.
//
//  AA OFF (brushAA=false) — pixel-snapped hard stamps.
//    Each dab is filled with ctx.arc() at full opacity, then the result
//    is quantised to whole pixels via getImageData/putImageData.
//    This is TVPaint's Pencil (type 6) / Clip Studio's "pixel pen":
//    every edge pixel is fully ON or fully OFF — no partial alpha.
//    Ideal for cel-animation clean line work.
//
// The eraser always uses the same mode as the current brush.
// ════════════════════════════════════════════════════════════════

function _hexToRGB(hex){
  const h=hex.replace('#','');
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}

// ── Cache key quantization ──────────────────────────────────────────────
// Pressure/velocity/fade/taper dynamics nudge r and alpha by tiny fractions
// on basically every dab, so keying the stamp cache on their EXACT values
// (old code: r.toFixed(2), raw alpha) made the cache miss almost every
// single dab — defeating the whole point of caching and forcing a fresh
// gradient/canvas (AA) or getImageData/putImageData readback (aliased) per
// dab, which is what actually caused the lag in BOTH modes. Quantizing to a
// coarse step means a stroke with continuously-varying pressure still hits
// the same handful of cache entries almost every time — the size/alpha
// difference between two quantization buckets is sub-pixel/imperceptible,
// but the perf difference (cache hit vs. full rebuild) is enormous.
const _Q_R = 0.25;      // px
const _Q_ALPHA = 0.02;  // ~2% alpha steps
function _quant(v,step){return Math.round(v/step)*step;}

// ── Edge width: Photoshop/Photopea-style constant-ish antialiasing ─────────
// The old falloff used `outerSpan = 1-hardness` as a FRACTION OF THE RADIUS,
// so the soft edge band was literally (1-hardness)*r pixels wide — fine on a
// small brush, but on a large one (say r=150 at hardness=0.5) that's a 75px
// blurry gradient, exactly the fat soft edge seen on big brushes vs.
// Photopea's crisp hairline rim at the same size. Real hard-round brushes in
// Photoshop/Photopea keep the antialiased rim at only a couple of pixels
// wide regardless of brush size — hardness controls how MUCH of the radius
// is solid core, but the transition itself doesn't keep growing forever.
// Fix: compute the edge band in actual pixels and clamp it to a small max,
// so a big hard brush still gets a crisp, near-constant-width edge instead
// of a soft gradient that scales with size.
const _EDGE_PX_MIN = 0.6;  // thinnest the AA rim is ever allowed to be
const _EDGE_PX_MAX = 3.0;  // widest the AA rim is ever allowed to be, at any brush size
function _edgeWidthPx(r, hardness){
  const raw = (1-hardness) * r; // old behavior: proportional to radius
  // Hard Round / Soft Round / eraser etc. keep the exact original
  // behavior: rim width is proportional to (1-hardness)*r, clamped to a
  // flat 3px max at any size. Left untouched on purpose.
  const cap = _EDGE_PX_MAX;
  // Airbrush-only exception: the Airbrush preset (hardness=0, size 60) is
  // meant to be a true soft spray-cone dot — like Clip Studio's airbrush —
  // where the feather spans the ENTIRE radius, not just a thin 3px rim
  // around a flat opaque core. That's what made it look like a hard-edged
  // blob instead of a smooth gaussian spray. Scoped strictly to
  // window._brushAirbrush so Hard Round/Soft Round/eraser are unaffected.
  if(typeof window!=='undefined' && window._brushAirbrush){
    const airbrushCap = Math.max(_EDGE_PX_MAX, r*0.9);
    return Math.max(_EDGE_PX_MIN, Math.min(airbrushCap, raw));
  }
  return Math.max(_EDGE_PX_MIN, Math.min(cap, raw));
}
// Returns the inner-core fraction (0..1) equivalent to a clamped, constant-
// pixel-width edge band for a brush of true radius r. Everything downstream
// still just uses `inner` as before (a fraction of r), so this is a drop-in
// replacement for `hardness` at the point each renderer computes its falloff.
function _effectiveInnerFrac(r, hardness){
  const rr = Math.max(0.05, r);
  const edgePx = _edgeWidthPx(rr, Math.max(0,Math.min(0.99,hardness)));
  return Math.max(0, Math.min(0.999, 1 - edgePx/rr));
}

// _aaDabCache (defined below, near _buildAAStamp) is a real Map cache of
// CPU-rendered stamps, keyed by quantized size/color/alpha/composite/hardness.
// Other files call _aaDabCache.clear() whenever a brush setting that
// affects the stamp's appearance changes (size, hardness, roundness, AA
// toggle) — this invalidates every cached stamp so the next dab rebuilds.

// ── AA dab: soft, sub-pixel accurate — GPU or CPU rasterized, selectable
// via Edit ▸ Preferences ▸ Renderer (brushRenderer in core-state.js).
//
// GPU mode (_dabAAGpu, default): ctx.createRadialGradient()+fill() — hands
// rasterization to the browser's hardware-accelerated canvas backend.
// Cheap and smooth; this is the recommended default and matches how most
// browser drawing apps behave.
//
// CPU mode (_dabAACpu): computes each dab's alpha falloff by hand,
// pixel-by-pixel, in plain JS (see _buildAAStamp below) into an ImageData
// buffer — closer to how TVPaint's own software brush engine works. This
// is heavier on the CPU by nature (that's the whole point of the option),
// so it's opt-in rather than forced on everyone.
//
// History/why the CPU path is a cached stamp instead of a fresh per-dab draw:
//  v1: cached one bitmap per EXACT radius -> cache thrashed on virtually
//      every dab (pressure/taper nudge r by tiny fractions constantly) ->
//      laggy, since it fell back to a full rebuild almost every time.
//  v2: quantized radius into buckets to fix the cache thrash -> fixed lag
//      but the brush WIDTH visibly stepped between buckets along a stroke
//      (banded / "no subpixel" look).
//  v3: cached one fixed-size reference bitmap and scaled it down to any
//      target radius -> fixed banding, but a typical dab is a >10x
//      downscale; drawImage has no mipmapping, so the bilinear sampler
//      only reads 1-2 source texels per destination pixel and exactly
//      which texels shifts with each dab's subpixel position -> a
//      flickering/scalloped WAVE along the stroke edge.
//  v4: capped the downscale ratio at 2x via size tiers -> reduced the wave
//      but `imageSmoothingQuality='high'` forced a noticeably slower
//      resampling algorithm on every single dab, making it laggy again,
//      while a milder version of the same sampling artifact persisted.
//  v5: build the stamp bitmap ONCE per quantized
//      (size,hardness,color,alpha,composite) combo via a hand-written
//      per-pixel falloff loop — no gradient/scaling involved at all, so
//      none of the v3/v4 resampling artifacts apply — then blit it at the
//      dab's true fractional x/y with normal bilinear smoothing. Only the
//      STAMP's own size is quantized (0.25px steps — imperceptible,
//      already proven fine by the aliased path below); the on-screen
//      *position* stays fully sub-pixel accurate every single dab. This is
//      the current CPU-mode implementation.
// ── Airbrush-only falloff: true gaussian, no flat opaque core ───────────
// Every other brush (hard/soft round, pencil, eraser) intentionally uses a
// flat inner core + linear ramp (see _effectiveInnerFrac/_edgeWidthPx) —
// that's what gives a "round brush" its defined, paintable body. A real
// airbrush/spray-can tip has NO flat core at all: peak density sits at the
// exact center and fades continuously the whole way to the edge, which is
// what makes Photopea's/Clip Studio's airbrush read as a soft cloud rather
// than a disc with a blurry rim. Reusing the linear inner/outer model (even
// with the widened edge from _edgeWidthPx) still leaves a visible plateau
// where overlapping dabs saturate to solid — this bypasses that model
// entirely for airbrush dabs only.
// t: distance/radius (0 at center, 1 at edge). Returns 0..1 alpha multiplier.
// Normalized so f(0)=1 and f(1)=0 exactly (no ring/pop at the boundary).
function _airbrushFalloff(t){
  if(t>=1) return 0;
  // Higher k = a tight, dense core with a long soft tail (matches
  // Photopea's look: a clearly darker center, not an evenly pale disc).
  // The previous k=2.0 spread density too evenly across the whole radius,
  // which — combined with a heavily dampened peak alpha — made a single
  // dab read as a flat, uniformly pale circle instead of a proper radial
  // gradient.
  const k=4.0; // shape: higher = more concentrated toward center, lower = flatter/broader
  const raw=Math.exp(-k*t*t);
  const floor=Math.exp(-k);
  return Math.max(0,(raw-floor)/(1-floor));
}
// Airbrush needs denser dab placement than a normal round brush so
// overlapping dabs blend into continuous fog instead of separate visible
// stamps along a stroke (see _strokeSegment/_stampQuadCurve). But the peak
// alpha of an INDIVIDUAL dab must stay strong — that's what gives the
// dark-center/soft-edge radial contrast Photopea shows even from one
// stamp. Only a mild compensation is applied here (not a heavy dampening)
// so tighter spacing doesn't cause the stroke to over-saturate too fast,
// without erasing each dab's own visible falloff.
const _AIRBRUSH_SPACING_FRAC = 0.025;
const _AIRBRUSH_ALPHA_SCALE  = 0.85;
const _aaDabCache=new Map(); // key -> {canvas,w,h}
const _AA_DAB_CACHE_MAX=64;

// ── Tip-shaped dab cache ────────────────────────────────────────────────────
// Mirrors _aaDabCache but for dabs whose shape comes from brushTipCanvas.
// Keyed on (r, rgb, alpha, composite, hardness, tipVersion, softAlpha, mode)
// so any tip change (new import, clear) busts every entry automatically.
const _tipDabCache=new Map();
const _TIP_DAB_CACHE_MAX=32;

// Build a stamp canvas pre-shaped by the current brushTipCanvas.
// Returns {canvas,w,h} — same contract as _buildAAStamp.
function _buildTipStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
  const tipC=window.brushTipCanvas;
  if(!tipC) return null;
  const tipV=window.brushTipVersion||0;
  const softAlpha=!!window.brushTipSoftAlpha;
  const tipMode=window.brushTipMode||'multiply';
  const r=_quant(rRaw,_Q_R), alpha=_quant(alphaRaw,_Q_ALPHA);
  const hardness=Math.round(Math.max(0,Math.min(0.99,hardnessRaw))*100)/100;
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|'+
            hardness.toFixed(2)+'|t'+tipV+'|'+(softAlpha?'s':'h')+'|'+tipMode;
  const hit=_tipDabCache.get(key);
  if(hit) return hit;

  const rr=Math.max(0.05,r);
  // Preserve the tip's native aspect ratio instead of forcing it into a
  // square dab sized purely off the radius. Previously the tip image was
  // always drawn into a square canvas (w=h, based on r alone) — a tall,
  // thin tip like a calligraphy bar got stretched to fill that square and
  // then clipped by the radial falloff below into a plain filled circle,
  // losing its actual shape entirely. Scaling by the tip's own aspect
  // ratio (its longer side maps to the current brush diameter, 2*rr) keeps
  // the true silhouette at every brush size.
  const tipNativeW=tipC.width||tipC.naturalWidth||1;
  const tipNativeH=tipC.height||tipC.naturalHeight||1;
  const tipScale=(2*rr)/Math.max(tipNativeW,tipNativeH);
  const dabW=Math.max(1,tipNativeW*tipScale), dabH=Math.max(1,tipNativeH*tipScale);

  const pad=2;
  const w=Math.ceil(dabW)+pad*2+1, h=Math.ceil(dabH)+pad*2+1;
  const cx=w/2, cy=h/2;

  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});

  const cr=composite==='erase'?0:rgb[0];
  const cg=composite==='erase'?0:rgb[1];
  const cb=composite==='erase'?0:rgb[2];

  // Step 1: Fill with solid brush colour.
  tc.fillStyle=`rgb(${cr},${cg},${cb})`;
  tc.fillRect(0,0,w,h);

  // Step 2: Mask with the tip image (destination-in keeps only pixels where
  // the tip has alpha > 0, and scales that alpha proportionally). Drawn at
  // its aspect-correct size (dabW×dabH), centered in the padded canvas —
  // not stretched to fill the whole w×h square.
  tc.globalCompositeOperation='destination-in';
  tc.drawImage(tipC,0,0,tipNativeW,tipNativeH,(w-dabW)/2,(h-dabH)/2,dabW,dabH);
  tc.globalCompositeOperation='source-over';

  // Step 3: Per-pixel — apply the radial hardness falloff on top of the tip
  // mask (soft-alpha mode) or just scale by the requested alpha (hard mode),
  // and clamp to the actual dab alpha.
  const id=tc.getImageData(0,0,w,h); const d=id.data;
  const inner=_effectiveInnerFrac(rr,hardness);
  const outerSpan=Math.max(0.0001,1-inner);
  for(let py=0;py<h;py++){
    for(let px=0;px<w;px++){
      const p=(py*w+px)*4;
      if(d[p+3]===0) continue;
      const tipAlphaFrac=d[p+3]/255; // alpha the tip image provided
      const dx=(px+0.5)-cx, dy=(py+0.5)-cy;
      const t=Math.sqrt(dx*dx+dy*dy)/rr;
      let falloff;
      if(softAlpha && tipMode!=='replace'){
        if(t>=1) falloff=0;
        else if(t<=inner) falloff=1;
        else falloff=1-(t-inner)/outerSpan;
      } else {
        // Hard / replace mode: no radial blend — use tip alpha verbatim.
        falloff=t>=1?0:1;
      }
      const finalAlpha=alpha*tipAlphaFrac*falloff;
      d[p]=cr; d[p+1]=cg; d[p+2]=cb;
      d[p+3]=Math.round(Math.min(1,finalAlpha)*255);
    }
  }
  tc.putImageData(id,0,0);

  const stamp={canvas:tmp,w,h};
  if(_tipDabCache.size>=_TIP_DAB_CACHE_MAX) _tipDabCache.delete(_tipDabCache.keys().next().value);
  _tipDabCache.set(key,stamp);
  return stamp;
}

// Helper: retrieve the tip canvas pixels at a given stamp resolution.
// Returns a Uint8ClampedArray (length w*h*4) or null when no tip is set.
// Called from _buildAAStamp (CPU path) to multiply falloff by tip alpha.
function _getTipPixelsForStamp(w,h){
  const tipC=window.brushTipCanvas;
  if(!tipC) return null;
  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  const tc=tmp.getContext('2d');
  tc.drawImage(tipC,0,0,tipC.width||tipC.naturalWidth||w,tipC.height||tipC.naturalHeight||h,0,0,w,h);
  return tc.getImageData(0,0,w,h).data;
}
function _buildAAStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
  const r=_quant(rRaw,_Q_R), alpha=_quant(alphaRaw,_Q_ALPHA);
  const hardness=Math.round(Math.max(0,Math.min(0.99,hardnessRaw))*100)/100;
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  // Include the current tip version in the cache key so that loading a new
  // tip (or clearing it) automatically invalidates all previous CPU stamps
  // without an extra cache.clear() call.
  const tipV=(window.brushTipCanvas?(window.brushTipVersion||0):-1);
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|'+hardness.toFixed(2)+'|'+(isAirbrush?'ab':'n')+'|tv'+tipV;
  const hit=_aaDabCache.get(key);
  if(hit) return hit;
  const rr=Math.max(0.05,r);
  const pad=2,ir=Math.ceil(rr);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  const cx=w/2,cy=h/2;
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  const id=tc.createImageData(w,h);
  const d=id.data;
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const inner=_effectiveInnerFrac(rr,hardness);
  const outerSpan=Math.max(0.0001,1-inner);
  // Sample tip pixels at this stamp's resolution once (null when no tip loaded).
  const tipPixels=_getTipPixelsForStamp(w,h);
  const tipSoft=!!window.brushTipSoftAlpha;
  const tipReplace=(window.brushTipMode==='replace');
  let p=0;
  for(let py=0;py<h;py++){
    for(let px=0;px<w;px++,p+=4){
      const dx=(px+0.5)-cx, dy=(py+0.5)-cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const t=dist/rr;
      let a;
      if(isAirbrush){
        a=alpha*_airbrushFalloff(t);
      } else if(t>=1) a=0;
      else if(t<=inner) a=alpha;
      else a=alpha*(1-(t-inner)/outerSpan);
      if(a<=0) continue; // leave fully transparent (already zeroed by createImageData)
      // When a tip image is loaded, multiply the computed falloff alpha by the
      // tip pixel's luminance (average of RGB channels — tip images are stored
      // as grayscale-on-alpha or pure alpha masks from ABR imports).
      if(tipPixels){
        const ta=tipPixels[p+3]/255;           // tip alpha at this pixel
        const tl=(tipPixels[p]+tipPixels[p+1]+tipPixels[p+2])/(255*3); // luminance
        const tipFactor=(ta>0?tl:0);           // use luminance; fully transparent tip pixels always 0
        if(tipReplace){
          // Replace mode: radial circle is ignored; tip shape is authoritative.
          a=alpha*tipFactor;
        } else if(tipSoft){
          // Multiply mode with soft-alpha: tip modulates the existing falloff.
          a*=tipFactor;
        } else {
          // Hard mode: tip alpha replaces the edge falloff but keeps center flat.
          a=alpha*tipFactor;
        }
        if(a<=0) continue;
      }
      d[p]=cr;d[p+1]=cg;d[p+2]=cb;d[p+3]=Math.round(Math.min(1,a)*255);
    }
  }
  tc.putImageData(id,0,0);
  const stamp={canvas:tmp,w,h};
  if(_aaDabCache.size>=_AA_DAB_CACHE_MAX) _aaDabCache.delete(_aaDabCache.keys().next().value); // evict oldest
  _aaDabCache.set(key,stamp);
  return stamp;
}
function _dabAAGpu(x,y,r,rgb,alpha,composite){
  // When a custom tip image is loaded, build a pre-shaped stamp (cached)
  // and blit it — no gradient is drawn. Falls back to the radial gradient
  // path below when no tip is set, preserving existing behaviour exactly.
  if(window.brushTipCanvas){
    const dc=(_inStroke && composite!=='erase')?_strokeCtx:ctx;
    const stamp=_buildTipStamp(r,rgb,alpha,composite,brushHardness);
    if(stamp){
      const x0=x-(stamp.w/2), y0=y-(stamp.h/2);
      dc.save();
      dc.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
      dc.drawImage(stamp.canvas,x0,y0);
      dc.restore();
      return;
    }
  }
  // During a stroke, paint dabs onto the stroke scratch canvas so that
  // brushOpacity can be applied as a stroke-level composite at the end.
  // Eraser dabs must always go directly to activeC (they cut through the
  // real layer pixels, not the scratch).
  const dc = (_inStroke && composite !== 'erase') ? _strokeCtx : ctx;
  const rr=Math.max(0.05,r);
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  dc.save();
  dc.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
  const grad=dc.createRadialGradient(x,y,0,x,y,rr);
  const c0=composite==='erase'?[0,0,0]:rgb;
  if(isAirbrush){
    // Sample the true-gaussian curve at several stops — canvas gradients
    // only interpolate linearly BETWEEN stops, so enough stops are needed
    // to read as a smooth curve rather than a linear ramp. Every other
    // brush (below, in the else branch) is completely untouched.
    const STOPS=10;
    for(let i=0;i<=STOPS;i++){
      const t=i/STOPS;
      const a=alpha*_airbrushFalloff(t);
      grad.addColorStop(t,`rgba(${c0[0]},${c0[1]},${c0[2]},${a})`);
    }
  } else {
    const inner=_effectiveInnerFrac(rr,brushHardness);
    grad.addColorStop(0,`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    grad.addColorStop(inner,`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    grad.addColorStop(1,`rgba(${c0[0]},${c0[1]},${c0[2]},0)`);
  }
  dc.fillStyle=grad;
  dc.beginPath();dc.arc(x,y,rr,0,Math.PI*2);dc.fill();
  dc.restore();
}
// FIX: the previous CPU path baked each dab into a size-QUANTIZED cached
// bitmap (see _buildAAStamp/_aaDabCache above) and then blitted it at the
// dab's fractional position via ctx.drawImage() with bilinear smoothing.
// That gave a visibly different result from the GPU path:
//   1. The rendered radius snapped to the nearest 0.25px cache bucket
//      instead of the exact, continuously-varying pressure-driven radius
//      the GPU path uses — pressure response looked subtly "stepped".
//   2. Sub-pixel positioning came from the browser's bilinear resample of
//      the cached bitmap — an EXTRA blur pass on top of the already-soft
//      falloff. The GPU path never resamples anything; it draws the exact
//      gradient at the exact (x,y) every time. Net result: CPU strokes
//      looked softer/blurrier than GPU strokes at the same hardness.
// Fix: compute the exact same analytic falloff the GPU radial gradient
// uses (flat core out to `inner`, linear ramp to 0 at the true,
// unquantized radius `r`), sampled at the dab's true fractional center —
// then composite it by hand (standard source-over / destination-out alpha
// math) directly into the canvas's pixel buffer instead of drawing a
// pre-baked bitmap. This is intentionally heavier than the old cached
// version (that's the whole point of choosing the CPU renderer — see the
// brushRenderer comment in core-state.js) but it now matches the GPU
// renderer's stroke quality, pressure response and edge softness exactly;
// only the rasterization backend differs (hand-written per-pixel math vs.
// the browser's hardware gradient/fill).
function _dabAACpu(x,y,r,rgb,alpha,composite){
  // When a custom tip image is loaded, use the exact same pre-shaped tip
  // stamp the GPU path uses (see _dabAAGpu) instead of the plain radial
  // falloff below. Without this branch, switching to the CPU renderer
  // silently ignored brushTipCanvas entirely and always drew a procedural
  // circle, even with an ABR tip imported.
  if(window.brushTipCanvas){
    const dc0=(_inStroke && composite!=='erase')?_strokeCtx:ctx;
    const stamp=_buildTipStamp(r,rgb,alpha,composite,brushHardness);
    if(stamp){
      const x0=x-(stamp.w/2), y0=y-(stamp.h/2);
      dc0.save();
      dc0.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
      dc0.drawImage(stamp.canvas,x0,y0);
      dc0.restore();
      return;
    }
  }
  const dc = (_inStroke && composite !== 'erase') ? _strokeCtx : ctx;
  const rr=Math.max(0.05,r);
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  const inner=_effectiveInnerFrac(rr,brushHardness);
  const cw=dc.canvas.width, ch=dc.canvas.height;
  const pad=1, ir=Math.ceil(rr)+pad;
  const sx=Math.max(0,Math.floor(x-ir)), sy=Math.max(0,Math.floor(y-ir));
  const ex=Math.min(cw,Math.ceil(x+ir)), ey=Math.min(ch,Math.ceil(y+ir));
  const rw=ex-sx, rh=ey-sy;
  if(rw<=0||rh<=0) return;
  const outerSpan=Math.max(0.0001,1-inner);
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const imgData=dc.getImageData(sx,sy,rw,rh);
  const d=imgData.data;
  let p=0;
  for(let py=0;py<rh;py++){
    const wy=sy+py+0.5;
    for(let px=0;px<rw;px++,p+=4){
      const wx=sx+px+0.5;
      const dx=wx-x, dy=wy-y;
      const t=Math.sqrt(dx*dx+dy*dy)/rr;
      if(t>=1) continue;
      let a = isAirbrush ? alpha*_airbrushFalloff(t) : (t<=inner ? alpha : alpha*(1-(t-inner)/outerSpan));
      a=Math.min(1,Math.max(0,a));
      if(a<=0) continue;
      if(composite==='erase'){
        // Matches ctx.globalCompositeOperation='destination-out': scale
        // destination alpha down by (1-a), leave its RGB untouched.
        d[p+3]=d[p+3]*(1-a);
      } else {
        // Matches the default 'source-over' compositing the GPU path uses.
        const da=d[p+3]/255;
        const outA=a+da*(1-a);
        if(outA<=0){ d[p]=0;d[p+1]=0;d[p+2]=0;d[p+3]=0; }
        else{
          d[p]  =(cr*a+d[p]  *da*(1-a))/outA;
          d[p+1]=(cg*a+d[p+1]*da*(1-a))/outA;
          d[p+2]=(cb*a+d[p+2]*da*(1-a))/outA;
          d[p+3]=outA*255;
        }
      }
    }
  }
  dc.putImageData(imgData,sx,sy);
}
// Renderer preference dispatch — see brushRenderer in core-state.js and the
// Preferences modal (Edit ▸ Preferences).
function _dabAA(x,y,r,rgb,alpha,composite){
  if(brushRenderer==='cpu') _dabAACpu(x,y,r,rgb,alpha,composite);
  else _dabAAGpu(x,y,r,rgb,alpha,composite);
}

// ── Aliased dab: solid circle, quantised edge pixels to full on/off.
// Mirrors TVPaint Pencil and Clip Studio pixel pen behaviour exactly.
//
// PERF FIX: the old version allocated a brand-new <canvas> and called
// getImageData/putImageData on EVERY single dab (every ~12% of brush
// diameter moved, i.e. many times per pointermove). getImageData forces
// a GPU→CPU pixel readback; doing that dozens of times per second is
// what caused the severe lag/latency when antialiasing was OFF.
// Fix: build the quantised stamp ONCE per (size,color,alpha,composite)
// combo and cache it. Every dab after that is just ctx.drawImage of the
// cached bitmap — no readback, no allocation, same pixel-perfect result.
let _stampCache=new Map(); // key -> {canvas,w,h}
const _STAMP_CACHE_MAX=64;
function _getAliasedStamp(rRaw,rgb,alphaRaw,composite){
  const r=_quant(rRaw,_Q_R), alpha=_quant(alphaRaw,_Q_ALPHA);
  // Include tip version so the stamp is rebuilt whenever the tip changes.
  const tipV=(window.brushTipCanvas?(window.brushTipVersion||0):-1);
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|tv'+tipV;
  const hit=_stampCache.get(key);
  if(hit) return hit;
  const pad=2,ir=Math.ceil(r);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  tc.fillStyle=composite==='erase'?'black':`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  tc.beginPath();tc.arc(w/2,h/2,r,0,Math.PI*2);tc.fill();
  // If a tip image is loaded, mask the disc with it so the aliased pencil
  // also respects the custom tip shape.
  if(window.brushTipCanvas){
    tc.globalCompositeOperation='destination-in';
    tc.drawImage(window.brushTipCanvas,0,0,
      window.brushTipCanvas.width||w,window.brushTipCanvas.height||h,0,0,w,h);
    tc.globalCompositeOperation='source-over';
  }
  const id=tc.getImageData(0,0,w,h);
  const d=id.data;
  const fa=Math.round(alpha*255);
  // Snap EVERY channel to full on/off — not just alpha. The arc() fill
  // that produced this bitmap is itself antialiased, so edge pixels come
  // out with partial alpha AND blended RGB (the canvas blends the fill
  // color against the transparent black backing, so a half-covered edge
  // pixel's RGB is pulled toward black/other colors, not the pure brush
  // color). Snapping only alpha left that blended RGB in place, which is
  // why edge pixels showed a stray saturated/black fringe at full
  // opacity once alpha was forced on. Forcing R/G/B too guarantees every
  // "on" pixel is the exact, solid brush color with no fringe.
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]>0){ // covered at all -> fully on, exact solid color
      d[i]=cr;d[i+1]=cg;d[i+2]=cb;d[i+3]=fa;
    } else {
      d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;
    }
  }
  tc.putImageData(id,0,0);
  const stamp={canvas:tmp,w,h};
  if(_stampCache.size>=_STAMP_CACHE_MAX) _stampCache.delete(_stampCache.keys().next().value); // evict oldest
  _stampCache.set(key,stamp);
  return stamp;
}
function _dabAliased(x,y,r,rgb,alpha,composite){
  const dc = (_inStroke && composite !== 'erase') ? _strokeCtx : ctx;
  const stamp=_getAliasedStamp(r,rgb,alpha,composite);
  // drawImage() defaults to imageSmoothingEnabled=true, so even a
  // perfectly hard-edged, fully-on/off-alpha stamp gets bilinearly resampled
  // (blurred) on the way into the destination canvas. Turning smoothing OFF
  // (nearest-neighbour sampling) keeps every "on" pixel fully opaque and
  // every "off" pixel fully transparent — no blended fringe — while still
  // letting the stamp be placed at the pointer's true sub-pixel (x,y), so
  // strokes track the pointer smoothly instead of snapping to whole pixels.
  const x0=x-(stamp.w/2),y0=y-(stamp.h/2);
  dc.save();
  dc.imageSmoothingEnabled=false;
  dc.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
  dc.drawImage(stamp.canvas,x0,y0);
  dc.restore();
}

// ── Tail taper (the other half of the "flick" feel) ─────────────────────────
// The head taper above can be applied the instant a dab is computed, because
// we already know how far into the stroke we are. The TAIL can't work that
// way — we don't know a stroke is ending until pointerup actually fires, by
// which point the final dabs would already be drawn at full width.
// Fix: hold back the last few dabs in a small queue instead of drawing them
// immediately (draw the OLDEST one once the queue is full, so steady-state
// drawing is only a few dabs behind the pointer — imperceptible). When the
// stroke ends, whatever's still sitting in the queue gets a tail-taper
// factor applied (shrinking toward the very last dab) before being drawn.
// Buffering by DAB COUNT rather than fixed pixels is what makes the tail
// length scale with brush size automatically: dab spacing is ~12% of the
// current diameter, so a bigger brush naturally gets a longer-looking flick
// tail and a smaller brush a shorter one — exactly like the head taper.
// ── Dirty-rect tracking for recomposite() ───────────────────────────────
// Every dab that actually lands on a canvas (immediate, tail-buffered, or
// airbrush-timer) passes through _drawDabNow, so this is the one place
// that can accurately accumulate "what actually changed since the last
// recomposite" without duplicating logic at every call site. The rect
// accumulates across all dabs drawn within a single animation frame, gets
// handed to recomposite() by _scheduleRecomposite below, then resets —
// so each frame's recomposite only has to touch the region that changed
// THIS frame, not the whole stroke's bounding box.
let _frameDirty = null; // {minX,minY,maxX,maxY} in canvas pixel space, or null
function _growDirtyRect(x,y,r){
  // Pad beyond the raw dab radius: AA feather can extend slightly past r,
  // and CPU-mode stamps add a couple more px of margin (see _buildAAStamp's
  // own `pad`). A little extra headroom here is cheap insurance against
  // clipping off the soft edge of a dab.
  const pad = r + 4;
  const minX=x-pad, minY=y-pad, maxX=x+pad, maxY=y+pad;
  if(!_frameDirty){
    _frameDirty = {minX,minY,maxX,maxY};
  } else {
    if(minX<_frameDirty.minX)_frameDirty.minX=minX;
    if(minY<_frameDirty.minY)_frameDirty.minY=minY;
    if(maxX>_frameDirty.maxX)_frameDirty.maxX=maxX;
    if(maxY>_frameDirty.maxY)_frameDirty.maxY=maxY;
  }
}
// Pull the accumulated dirty rect (clamped/rounded to canvas bounds) and
// clear the accumulator for the next frame. Returns null if nothing was
// drawn since the last call (caller should fall back to a full recomposite
// in that case, e.g. the very first frame of a stroke or non-drawing calls).
function _consumeDirtyRect(){
  if(!_frameDirty) return null;
  const r=_frameDirty; _frameDirty=null;
  const cw=activeC.width, ch=activeC.height;
  const x=Math.max(0,Math.floor(r.minX));
  const y=Math.max(0,Math.floor(r.minY));
  const ex=Math.min(cw,Math.ceil(r.maxX));
  const ey=Math.min(ch,Math.ceil(r.maxY));
  const w=ex-x, h=ey-y;
  if(w<=0||h<=0) return null;
  return {x,y,w,h};
}

// ── Per-dab texture overlay ─────────────────────────────────────────────────
// Tiles brushTextureCanvas over the freshly-painted dab area using
// 'multiply' blending at brushTextureDepth opacity.  The arc clip ensures
// texture is only applied within the circular dab footprint, not to
// surrounding already-painted pixels. No-op when brushTextureCanvas is null.
function _applyTextureToDab(dc, x, y, r, alpha){
  const texC=window.brushTextureCanvas;
  if(!texC) return;
  const depth=typeof window.brushTextureDepth!=='undefined'?window.brushTextureDepth:0.5;
  if(depth<=0) return;
  const rr=Math.max(1,r);
  const pat=dc.createPattern(texC,'repeat');
  if(!pat) return;
  dc.save();
  // Clip to the dab's circular footprint so texture doesn't bleed outside.
  dc.beginPath();
  dc.arc(x,y,rr+1,0,Math.PI*2);
  dc.clip();
  dc.globalCompositeOperation='multiply';
  dc.globalAlpha=Math.min(1,depth*alpha);
  dc.fillStyle=pat;
  dc.fillRect(x-rr-2,y-rr-2,rr*2+4,rr*2+4);
  dc.restore();
}

const _TAIL_BUFFER = 3;
const _TAIL_MIN = 0.12; // how thin the very last point of a flick gets
let _pendingDabs = [];
function _drawDabNow(d){
  if(brushAA) _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  // Apply the texture overlay on the same target context the dab went to.
  // Eraser dabs target ctx directly (not the stroke scratch), so we need
  // to match that routing here as well.
  if(window.brushTextureCanvas && d.composite!=='erase'){
    const dc=_inStroke?_strokeCtx:ctx;
    _applyTextureToDab(dc,d.x,d.y,d.r,d.alpha);
  }
  _growDirtyRect(d.x,d.y,d.r);
}
function _queueDab(d){
  _pendingDabs.push(d);
  // Only hold dabs back while the stroke is actually moving fast enough for
  // a deceleration "flick tail" to be meaningful. On a slow/deliberate
  // stroke _strokeVelocity stays low, so there's no reason to withhold
  // drawing — doing so just creates a visible static gap between the pen
  // and the rendered line that only closes on pointerup (exactly the
  // "brush lagging behind on a slow stroke" bug). Draw immediately whenever
  // we're below the fast-stroke threshold.
  const isFastEnoughForTail = _strokeVelocity > 0.5; // px/ms-ish threshold, tune to taste
  if(!isFastEnoughForTail){
    while(_pendingDabs.length) _drawDabNow(_pendingDabs.shift());
    return;
  }
  if(_pendingDabs.length>_TAIL_BUFFER) _drawDabNow(_pendingDabs.shift());
}
function _flushStrokeTail(){
  const n=_pendingDabs.length;
  for(let i=0;i<n;i++){
    const d=_pendingDabs[i];
    const t = n>1 ? i/(n-1) : 1;
    const eased = t*t*(3-2*t); // smoothstep, 0 at oldest -> 1 at newest/last
    const tailFactor = 1 - eased*(1-_TAIL_MIN);
    d.r *= tailFactor;
    if(brushAA) d.alpha *= (0.35 + 0.65*tailFactor);
    _drawDabNow(d);
  }
  _pendingDabs.length=0;
}

// ── Input smoothing (TVPaint calls this "Line Smoothing") ──────────────────
// Raw pointer input — especially high-frequency pointerrawupdate samples on
// pen tablets, but mouse jitter too — is never perfectly straight; stamping
// dabs directly along the RAW points (as before) draws every tiny wobble in
// the input, which is what made strokes look wavy/rippled compared to
// TVPaint.
//
// v1 of this used a pure time-constant exponential moving average (EMA):
// smoothX += (rawX - smoothX) * (1 - exp(-dt/tau)). That's the "averages
// distance" feel — the smoothed point is a running average pulled toward
// wherever the pen HAS been, so on a fast flick it trails the real pen tip
// by a gap that grows with speed (a fixed TIME lag becomes a big SPATIAL
// lag once velocity goes up), and only crawls back once the pen slows down.
// It also stuttered on real pen data: pointerrawupdate delivers very
// uneven dt between coalesced samples (sub-millisecond bursts mixed with
// occasional bigger gaps), so `a` swings between "almost 0" and "almost 1"
// event to event — the smoothed point advances in uneven little jump/creep
// steps instead of a steady glide, which reads as stutter even though the
// math is technically working.
//
// v2: same gentle EMA for de-jittering slow, deliberate strokes (that part
// felt fine), but on top of it we clamp how far the smoothed point is
// allowed to trail the raw pen position — a "leash". As soon as the gap
// would exceed the leash, we pull the smoothed point back to leash-distance
// from the pen instead of continuing to let it lag proportionally to speed.
// That's the "brush catches up to the tip" feel: on a flick the tip snaps
// to just-behind-the-pen and stays there (constant small offset) rather
// than trailing further and further back, and it removes the stutter too,
// since the leash turns the uneven jump/creep steps into one consistent
// "keep pace at leash distance" motion during fast movement.
// v3: One Euro Filter (Casiez et al.) — the same class of filter most pro
// drawing/tracking apps use, chosen specifically because it has no fixed
// catch-up lag: its cutoff frequency adapts to the point's own speed every
// sample, so it barely filters at all once the pen is moving fast (stays
// glued to the raw position, no trailing gap that "catches up" later)
// while still knocking down the high-frequency micro-jitter that reads as
// wobble on slow, deliberate strokes/mouse input. Replaces the earlier
// "no smoothing at all" pass-through, which baked every raw hand-tremor
// sample straight into the stroke.
const _OEF_MINCUTOFF = 1.2;  // Hz — filtering strength at rest (higher = less smoothing)
const _OEF_BETA      = 0.02; // speed coefficient — how fast cutoff opens up as speed rises
const _OEF_DCUTOFF   = 1.0;  // Hz — cutoff for the derivative/speed estimate itself
function _oefAlpha(cutoffHz, dt){
  const tau = 1/(2*Math.PI*Math.max(0.0001,cutoffHz));
  return 1/(1+tau/Math.max(0.0001,dt));
}
let _smoothX=0,_smoothY=0,_smoothInit=false,_lastSmoothT=0;
let _oefDX=0,_oefDY=0; // filtered derivative (px/s) for x and y
function _resetSmoothing(x,y,t){
  _smoothX=x;_smoothY=y;_smoothInit=true;_lastSmoothT=t;
  _oefDX=0;_oefDY=0;
}
function _smoothPoint(x,y,t){
  if(!_smoothInit){ _resetSmoothing(x,y,t); return {x,y}; }
  const dt=Math.max(0.001,(t-_lastSmoothT)/1000); // seconds
  _lastSmoothT=t;
  // Filter the derivative (speed) first, at a fixed low cutoff — this is
  // what lets the position cutoff react to true speed instead of raw noise.
  const rawDX=(x-_smoothX)/dt, rawDY=(y-_smoothY)/dt;
  const aD=_oefAlpha(_OEF_DCUTOFF,dt);
  _oefDX=_oefDX+aD*(rawDX-_oefDX);
  _oefDY=_oefDY+aD*(rawDY-_oefDY);
  const speed=Math.hypot(_oefDX,_oefDY);
  // Adaptive cutoff: opens up (less smoothing, tighter tracking) as speed
  // rises, so fast flicks stay glued to the pen while slow strokes get the
  // de-wobble benefit — no fixed spatial or temporal lag either way.
  const cutoff=_OEF_MINCUTOFF+_OEF_BETA*speed;
  const a=_oefAlpha(cutoff,dt);
  _smoothX=_smoothX+a*(x-_smoothX);
  _smoothY=_smoothY+a*(y-_smoothY);
  return{x:_smoothX,y:_smoothY};
}

function _stampDab(x,y,e){
  const {r,alpha}=_getEffectiveBrushParams(e);
  const isErase=tool==='eraser';
  const rgb=isErase?[0,0,0]:_hexToRGB(color);
  const composite=isErase?'erase':'paint';
  _queueDab({x,y,r,alpha,rgb,composite});
}

// ── Airbrush continuous spray (Photoshop "Airbrush" toggle / Clip Studio
// Airbrush sub tool feel) ──────────────────────────────────────────────
// Every other brush here only stamps in response to pointer movement
// (_strokeSegment walks dabs along the path you actually drew). A real
// airbrush also keeps depositing paint for as long as the pen is held
// down, even dead still — that's what lets you build density in one spot
// just by holding the pen there, on top of a soft low-flow tip. This timer
// is the one thing that adds that behavior: while drawing && airbrush mode
// is on, it fires extra stamps at the last known position on its own
// clock, independent of whether pointermove ever fires again.
let _airbrushTimer=null;
let _lastPointerEvent=null;
function _airbrushIntervalMs(){
  const rate=(typeof window!=='undefined' && window._tsAirbrushRate!=null) ? window._tsAirbrushRate : 0.55;
  // rate 0..1 -> interval 50ms (gentle, slow build-up) down to 6ms (dense,
  // fast spray). Tightened from the original 90ms..16ms range: paired with
  // the much fainter per-dab alpha above, more frequent/fainter dabs blend
  // into continuous fog while held still, instead of visible discrete pops.
  return 50 - Math.max(0,Math.min(1,rate))*44;
}
function _startAirbrushSpray(){
  _stopAirbrushSpray();
  _airbrushTimer=setInterval(()=>{
    if(!drawing || !window._brushAirbrush){ _stopAirbrushSpray(); return; }
    _stampDab(lx,ly,_lastPointerEvent);
    _scheduleRecomposite();
  }, _airbrushIntervalMs());
}
function _stopAirbrushSpray(){
  if(_airbrushTimer){ clearInterval(_airbrushTimer); _airbrushTimer=null; }
}
window._stopAirbrushSpray=_stopAirbrushSpray;

// Stamp dabs along a line segment from (ax,ay)→(bx,by). Step = ~12% of the
// CURRENT effective diameter (matches TVPaint's default stepval=12.5%) —
// not the brush's fixed max size. Walking adaptively like this is essential
// for smooth pressure tapers: if spacing were based on max size, a thin
// (low-pressure) stretch of the stroke would have its dabs spaced as if it
// were full-size, leaving each round dab visible as a separate bump/notch
// instead of blending into a continuous taper.
// Pressure is interpolated linearly from startPressure to endPressure along
// the segment — this prevents sudden size jumps at event boundaries when
// the tablet reports large pressure changes between coalesced events.
// ── Stroke-start taper (TVPaint-style natural pen tip) ─────────────────────
// TVPaint's pen eases in from a point at the start of every stroke — this
// happens even with a mouse (constant pressure=1.0 the whole time), so it
// can't be pressure-driven; it has to be driven by distance traveled since
// the stroke began. Without this, a stroke starts at full width/opacity
// immediately, which also makes very thin base sizes (e.g. 1.2px) feel like
// "nothing happened" unless pressed hard, since there's no built-in ramp to
// carry a faint first touch into a visible line.
let _strokeDistSoFar = 0;
function _strokeTaperFactor(baseSize){
  // Taper disabled — every stroke now starts at full width immediately,
  // no ease-in from a point. (Previously eased in over a capped distance;
  // removed entirely per request since it was still visible/unwanted.)
  return 1;
}

// Resolve the spacing FRACTION (of effective diameter) to use for the dab
// currently being placed. This used to be duplicated inline in both
// _strokeSegment and _stampQuadCurve — centralized here so both call sites
// stay in sync. Spacing is always fixed: it never widens or narrows based
// on stroke velocity or acceleration, only on the Spacing slider (and the
// airbrush cap).
function _effectiveSpacingFrac(){
  let spacing = (typeof window!=='undefined' && window._tsSpacing!=null) ? window._tsSpacing : 0;
  if(typeof window!=='undefined' && window._brushAirbrush) spacing = Math.min(spacing, _AIRBRUSH_SPACING_FRAC);
  return spacing;
}

function _strokeSegment(ax,ay,bx,by,e,startPressure,endPressure){
  const sp = (startPressure !== undefined) ? startPressure : currentPressure;
  const ep = (endPressure   !== undefined) ? endPressure   : currentPressure;
  const dx=bx-ax,dy=by-ay,dist=Math.sqrt(dx*dx+dy*dy);
  if(dist<0.1){
    // Same fix as the equivalent branch in _stampQuadCurve: bank the tiny
    // distance instead of unconditionally stamping, so Spacing is still
    // respected instead of bypassed for sub-0.1px segments.
    _strokeSegCarryOver += dist;
    const spacing=_effectiveSpacingFrac();
    const spacingR=_computeSpacingRadius(e, ep);
    const step=Math.max(0.5, spacingR*2*spacing);
    currentPressure=ep;
    if(_strokeSegCarryOver >= step){
      _strokeSegCarryOver -= step;
      _strokeDistSoFar += step;
      _stampDab(bx,by,e);
    }
    return;
  }
  // Start with negative carry-over so the first dab lands exactly one step
  // after the last dab of the previous segment (no remainder discarded).
  let traveled = -_strokeSegCarryOver;
  while(true){
    const tNow = Math.max(0, Math.min(1, traveled / dist));
    const interpP = sp + (ep - sp) * tNow;
    const spacing = _effectiveSpacingFrac();
    // CSP-style: step is always relative to the EFFECTIVE diameter at this
    // position (pressure/tilt scaled), not the base size. This keeps dab
    // overlap perfectly consistent regardless of pressure or stroke speed.
    const spacingR = _computeSpacingRadius(e, interpP);
    const step = Math.max(0.5, spacingR * 2 * spacing);
    traveled += step;
    if(traveled > dist) break; // past end — save remainder as carry-over
    const t = traveled / dist;
    _strokeDistSoFar += step;
    currentPressure = sp + (ep - sp) * t;
    _stampDab(ax + dx*t, ay + dy*t, e);
  }
  _strokeSegCarryOver = Math.max(0, traveled - dist);
  currentPressure = ep;
}

// ── Quadratic-curve stamping (fixes angular/wavy fast strokes) ─────────────
// _strokeSegment (above) stamps a STRAIGHT LINE between two consecutive raw
// samples. At normal speed samples are dense enough that this is invisible,
// but on a fast flick — even at pointerrawupdate's ~1000Hz ceiling — the
// pen can cover a lot of distance between samples, especially through a
// curve, so straight segments chained together render as a series of
// visible angular facets ("wavy/jittery") instead of one smooth arc. This
// is a geometry problem, not a latency problem: no amount of dab-cache or
// rAF tuning fixes it, because the samples themselves are being connected
// with straight lines.
// Fix: use the standard quadratic-bezier midpoint technique (the same one
// virtually every pro drawing app uses for freehand ink) — for three
// consecutive points A,B,C, draw the curve from mid(A,B) to mid(B,C) using
// B as the control point. This turns every joint between samples into a
// smooth arc instead of a corner, using ONLY points that already exist
// (the current sample and the two before it) — no lookahead, no waiting
// for a future point, so it adds no catch-up delay. The only cost is that
// the segment actually drawn on a given sample ends at mid(B,C) rather
// than at C itself — half a sample-spacing behind the raw pen position at
// full drawing speed, i.e. sub-millisecond at 1000Hz — which is flushed to
// the real endpoint at stroke-end (see _flushCurveTail) so the line always
// still finishes exactly under the pen.
function _quadPoint(x0,y0,cx,cy,x1,y1,t){
  const mt=1-t;
  return{
    x: mt*mt*x0 + 2*mt*t*cx + t*t*x1,
    y: mt*mt*y0 + 2*mt*t*cy + t*t*y1
  };
}
// Rough arc-length estimate (control-polygon length) — good enough to pick
// a dab count; exact arc length isn't needed since dab spacing is already
// approximate/adaptive elsewhere in this engine.
function _quadApproxLen(x0,y0,cx,cy,x1,y1){
  const d1=Math.hypot(cx-x0,cy-y0), d2=Math.hypot(x1-cx,y1-cy), d3=Math.hypot(x1-x0,y1-y0);
  return (d1+d2+d3)/2;
}
function _stampQuadCurve(x0,y0,cx,cy,x1,y1,e,startPressure,endPressure){
  const len=_quadApproxLen(x0,y0,cx,cy,x1,y1);
  if(len<0.1){
    // BUG FIX: this used to always call _stampDab() here regardless of
    // Spacing. Heavily-smoothed slow strokes (see _smoothPoint's adaptive
    // One Euro filter — it dampens hard at low speed) constantly produce
    // curve segments under this 0.1px threshold, so a dab was stamped on
    // almost every single pointermove no matter what Spacing % was set
    // to — which is exactly why slow strokes looked continuous while fast
    // strokes (whose bigger segments actually ran the real spacing loop
    // below) showed correct gaps. We can't divide by this near-zero `len`
    // safely (that's why the early-out exists at all), so instead of
    // stamping, bank this sliver of distance into the shared carry-over
    // and only stamp once enough slivers add up to a real spacing step —
    // same rule the main loop below enforces.
    _strokeSegCarryOver += len;
    const spacing=_effectiveSpacingFrac();
    const spacingR=_computeSpacingRadius(e, endPressure);
    const step=Math.max(0.5, spacingR*2*spacing);
    currentPressure=endPressure;
    if(_strokeSegCarryOver >= step){
      _strokeSegCarryOver -= step;
      _strokeDistSoFar += step;
      _stampDab(x1,y1,e);
    }
    return;
  }
  let traveled=-_strokeSegCarryOver, px=x0, py=y0;
  while(true){
    const tNow = Math.max(0, Math.min(1, traveled / len));
    const interpP = startPressure + (endPressure - startPressure) * tNow;
    const spacing = _effectiveSpacingFrac();
    const spacingR = _computeSpacingRadius(e, interpP);
    const step = Math.max(0.5, spacingR * 2 * spacing);
    traveled += step;
    if(traveled > len) break;
    const t = traveled / len;
    currentPressure = startPressure + (endPressure - startPressure) * t;
    const pt = _quadPoint(x0,y0,cx,cy,x1,y1,t);
    _strokeDistSoFar += Math.hypot(pt.x-px, pt.y-py);
    px=pt.x; py=pt.y;
    _stampDab(pt.x, pt.y, e);
  }
  _strokeSegCarryOver = Math.max(0, traveled - len);
  currentPressure = endPressure;
}
// Rolling 3-point buffer feeding the curve above. Reset at stroke start so
// the first two segments of a stroke (before 3 real points exist) fall
// back to a straight stamp — there's no earlier geometry to curve through
// yet, and this matches the existing stroke-start taper behavior.
let _curveP0=null,_curveP1=null,_curvePr0=0,_curvePr1=0;
function _resetCurve(x,y,pressure){
  _curveP0={x,y};_curveP1={x,y};_curvePr0=pressure;_curvePr1=pressure;
}
// Feed one new raw sample (x,y,pressure) into the curve buffer and stamp
// the newly-completed segment, if any. Returns nothing; mutates lx/ly-style
// via direct dab stamping same as _strokeSegment did.
function _curveAddPoint(x,y,pressure,e){
  if(_curveP0===null){_resetCurve(x,y,pressure);return;}
  const A=_curveP0,B=_curveP1,C={x,y};
  const startPt = {x:(A.x+B.x)/2, y:(A.y+B.y)/2};
  const endPt   = {x:(B.x+C.x)/2, y:(B.y+C.y)/2};
  const startPr = (_curvePr0+_curvePr1)/2;
  const endPr   = (_curvePr1+pressure)/2;
  _stampQuadCurve(startPt.x,startPt.y,B.x,B.y,endPt.x,endPt.y,e,startPr,endPr);
  _curveP0=B;_curveP1=C;_curvePr0=_curvePr1;_curvePr1=pressure;
}
// Called once at stroke end to draw the final bit of curve from the last
// completed midpoint segment all the way out to the true last pen
// position, so the stroke always ends exactly under the pen (no
// perceptible "still catching up" tail — this is a one-time geometric
// closeout, not an ongoing lag).
function _flushCurveTail(e){
  if(_curveP0===null||_curveP1===null) return;
  const B=_curveP1;
  const startPt = {x:(_curveP0.x+B.x)/2, y:(_curveP0.y+B.y)/2};
  _stampQuadCurve(startPt.x,startPt.y,B.x,B.y,B.x,B.y,e,(_curvePr0+_curvePr1)/2,_curvePr1);
  _curveP0=null;_curveP1=null;
}

// PERF FIX: recompositing flattens every layer/group (full-canvas
// drawImage per layer, plus mask canvases) — that's fine to do once per
// frame, but the old code called it synchronously on EVERY pointermove,
// and pointermove can fire 100+ times/sec on a fast mouse or tablet.
// That full-stack re-flatten on every single input event is the main
// reason this felt laggy compared to TVPaint even WITH antialiasing on.
// Fix: coalesce to at most one recomposite per animation frame.
let _recompRAF=false;
function _scheduleRecomposite(){
  if(_recompRAF) return;
  _recompRAF=true;
  requestAnimationFrame(()=>{
    _recompRAF=false;
    // Only hand recomposite() a dirty rect while a stroke is actually being
    // painted (drawing/_inStroke). Outside of that — first frame after a
    // tool switch, undo, layer visibility change, etc. — pass no rect so
    // recomposite() keeps its original full-canvas behavior untouched.
    const rect = (drawing||_inStroke) ? _consumeDirtyRect() : null;
    recomposite(curLayer,curFrame,rect);
  });
}

// BUG FIX ("brush turns into an eraser / smears the canvas after
// switching tabs and back"): the old code only cleared the `drawing`
// flag on a 'mouseup'/'mouseleave' fired ON THE CANVAS ITSELF. If you
// switch browser tabs (or alt-tab) while the mouse button is still down,
// that mouseup never reaches the canvas, so `drawing` stays stuck `true`.
// The next time the pointer simply MOVES over the canvas — with no
// button pressed at all — the old mousemove handler still saw
// drawing===true and kept calling _strokeSegment from wherever the
// stroke last left off, painting/erasing a trail that followed the
// cursor with no click. Fixes:
//  1. Use Pointer Events + setPointerCapture so the element reliably
//     gets pointerup/pointercancel no matter where the button is
//     released (this alone fixes most "stuck stroke" cases).
//  2. Belt-and-suspenders: force-end any in-progress stroke the instant
//     the tab is hidden or the window loses focus, so a stray stroke
//     can never survive a tab switch.
//  3. Always verify the primary button is actually still down
//     (e.buttons & 1) on every pointermove before drawing — if it isn't
//     (e.g. the up-event was lost), stop the stroke instead of trusting
//     the old `drawing` flag blindly.
function _endStroke(){
  _stopAirbrushSpray();
  if(drawing){drawing=false;_flushStrokeTail();if(_inStroke){_inStroke=false;_commitStrokeCanvas();}saveActiveToKey();_scheduleRecomposite();}
  lineStart=null;
  _pendingDabs.length=0;
  _curveP0=null;_curveP1=null; // discard in-flight curve geometry, no event to flush a tail with
  _strokeSegCarryOver=0;
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){_endStroke();}
  else{
    // Some browsers silently discard a canvas's backing-store pixels
    // while its tab is backgrounded (memory pressure, GPU context loss).
    // If that happened, activeC would come back blank even though the
    // saved key still has the real content — drawing on it now would
    // then overwrite the key with "blank + new stroke" on the next save,
    // destroying everything drawn before the tab switch. Reloading from
    // the saved key on return guarantees activeC always matches the
    // source of truth before any new stroke can touch it.
    loadFrame(curLayer,curFrame);
  }
});
window.addEventListener('blur',_endStroke);

// ── Pressure tracking ──────────────────────────────────────────────────────
// Pressure state: updated per pointer event
let currentPressure = 1.0; // 0–1 from pen digitizer; always 1.0 for mouse
let _lastKnownPressure = 1.0; // last non-zero pressure reading (preserves pressure through coalesced gaps)
let _isDrawingWithPen = false; // true when the active stroke is from a pen/stylus

// Exponential smoothing for pressure — reduces jitter without adding lag.
// Alpha=0.25 is a good balance: smooth enough to avoid spiky dab-size
// changes from noisy digitizers, still snappy enough to feel responsive.
// 0=max smooth, 1=no smooth.
const _PRESSURE_SMOOTH = 0.25;
let _smoothedPressure = 1.0;

// De-jitter: some digitizers occasionally report a single noisy outlier
// sample (a brief spike or dip in pressure) in the middle of an otherwise
// steady stroke. Left unfiltered, that one sample produces a visible
// thick/thin blob right at that point (a real pressure CHANGE happens over
// several samples and isn't affected by this; it's only single-sample
// spikes that get capped). _prevRawPressure tracks the last accepted raw
// reading so each new sample's jump can be limited.
let _prevRawPressure = 1.0;
const _MAX_PRESSURE_JUMP = 0.15; // max change allowed per raw sample
let _strokeFirstSample = true; // true for the very first sample of a stroke (no clamping — should snap immediately)

function _getPressure(e){
  // e.pressure: 0 = pen hovering or just lifted (NOT zero pressure contact)
  //             0.5 = mouse or device with no pressure support
  //             0–1 = real pen with pressure
  let p;
  if(e.pointerType === 'pen'){
    // Only trust a pressure reading > 0 while drawing (0 means hovering/lifted).
    // When pen is down but reports 0 (rare driver quirk), keep the last known value
    // so we don't get a sudden thin spot mid-stroke.
    if(e.pressure > 0){
      _lastKnownPressure = e.pressure;
      p = e.pressure;
    } else {
      // If we're mid-stroke and get a 0, hold the last pressure rather than
      // snapping to 0.5 (which caused random thin spots in strokes).
      p = drawing ? _lastKnownPressure : 0.0;
    }
    if(_strokeFirstSample){
      _prevRawPressure = p; _strokeFirstSample = false;
    } else {
      const delta = p - _prevRawPressure;
      if(delta > _MAX_PRESSURE_JUMP) p = _prevRawPressure + _MAX_PRESSURE_JUMP;
      else if(delta < -_MAX_PRESSURE_JUMP) p = _prevRawPressure - _MAX_PRESSURE_JUMP;
      _prevRawPressure = p;
    }
    return p;
  }
  if(e.pointerType === 'touch'){
    // Touch force is 0..1 on devices that support it (force touch);
    // fall back to full pressure if not supported (force===0 means unsupported).
    return (e.pressure > 0) ? e.pressure : 1.0;
  }
  // mouse / trackpad: always full pressure
  return 1.0;
}

// Stroke velocity tracking (pixels per ms) — used only by the "flick tail"
// buffering heuristic in _queueDab, not by any size/opacity dynamics control
// (those support Pen Pressure only).
let _strokeVelocity = 0;
let _lastMoveTime = 0;
let _lastMoveX = 0, _lastMoveY = 0;
function _updateVelocity(x, y, t){
  if(_lastMoveTime > 0){
    const dt = Math.max(1, t - _lastMoveTime);
    const dx = x - _lastMoveX, dy = y - _lastMoveY;
    const spd = Math.sqrt(dx*dx+dy*dy) / dt;
    _strokeVelocity = _strokeVelocity * 0.7 + spd * 0.3; // EMA smoothing
  }
  _lastMoveTime = t; _lastMoveX = x; _lastMoveY = y;
}

let _strokeDabCount = 0;
// Read the size/opacity dynamics controls set in the Tool Settings panel.
// Default size control is 'pressure' (not 'off') so pen pressure works immediately.
// PERF FIX (stroke trailing/backlog on fast strokes): each of these was
// calling document.getElementById() fresh on EVERY dab. Adaptive spacing
// stamps many dabs per segment, and _computeEffectiveParams calls these
// (via _resolveControl/_getMinSize/_getMinFlow) at least once per dab plus
// once more per "peek" step in _strokeSegment/_stampQuadCurve — so a single
// fast pointermove with several coalesced samples could trigger hundreds of
// DOM lookups synchronously on the input thread. That's real, measurable
// per-dab overhead stacking up faster than frames can drain it, which is
// exactly what shows up as the pen outrunning the rendered stroke and only
// "catching up" once movement (and dab generation) stops. Fix: resolve each
// element reference once and cache it — el.value is still read fresh every
// call (so live slider changes still apply instantly), only the expensive
// getElementById traversal is removed from the hot path.
let _elSizeControl, _elOpacityControl, _elMinSize, _elMinFlow;
function _getSizeControl(){ if(_elSizeControl===undefined) _elSizeControl=document.getElementById('ts-size-control'); return _elSizeControl?_elSizeControl.value:'pressure'; }
function _getOpacityControl(){ if(_elOpacityControl===undefined) _elOpacityControl=document.getElementById('ts-opacity-control'); return _elOpacityControl?_elOpacityControl.value:'pressure'; }
function _getMinSize(){ if(_elMinSize===undefined) _elMinSize=document.getElementById('ts-min-size'); return _elMinSize?(+_elMinSize.value/100):0.05; }
function _getMinFlow(){ if(_elMinFlow===undefined) _elMinFlow=document.getElementById('ts-min-flow'); return _elMinFlow?(+_elMinFlow.value/100):0; }

// Pressure curve — the Tool Settings panel draws a Linear/Soft/Hard/S-curve preview
// (see brush-presets.js) using these exact control points, in "plot space" where
// x = input pressure (0..1) and y is canvas-style position: y=0 is the TOP of the
// preview (= max size output) and y=1 is the BOTTOM (= min size output). Both files
// share this same table so the curve you see is exactly the curve that's applied.
//   linear — input maps straight through, no remapping.
//   soft   — reaches near-full size quickly, then flattens (more size early).
//   hard   — stays thin through most of the pressure range, only ramping up to
//            full size near max pressure. THIS is what makes thin/light-pressure
//            strokes reachable on devices whose lightest reported touch is still
//            a fairly high raw pressure value.
//   s      — gentle at both ends, steeper through the middle.
const PRESSURE_CURVES = {
  linear:[[0,1],[1,0]],
  soft:[[0,1],[0.3,0.55],[0.7,0.2],[1,0]],
  hard:[[0,1],[0.3,0.85],[0.7,0.4],[1,0]],
  s:[[0,1],[0.2,0.8],[0.8,0.25],[1,0]]
};
if(typeof window!=='undefined') window.PRESSURE_CURVES = PRESSURE_CURVES;

function _bezierPointAt(pts,t){
  if(pts.length===2){
    return [pts[0][0]+(pts[1][0]-pts[0][0])*t, pts[0][1]+(pts[1][1]-pts[0][1])*t];
  }
  const [p0,p1,p2,p3]=pts, mt=1-t;
  const x = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0];
  const y = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1];
  return [x,y];
}
// Given input pressure x (0..1), find the curve's plot-space y at that x.
// Control-point x-coordinates are monotonic increasing, so a short binary
// search on the bezier parameter t reliably converges (curves are static —
// cheap enough to solve per-call, no need to cache).
function _evalPressureCurveY(curveKey, x){
  const pts = PRESSURE_CURVES[curveKey] || PRESSURE_CURVES.linear;
  if(pts.length===2){
    const t = Math.max(0,Math.min(1, (x-pts[0][0])/((pts[1][0]-pts[0][0])||1)));
    return pts[0][1] + (pts[1][1]-pts[0][1])*t;
  }
  let lo=0, hi=1;
  for(let i=0;i<24;i++){
    const mid=(lo+hi)/2;
    if(_bezierPointAt(pts,mid)[0] < x) lo=mid; else hi=mid;
  }
  return _bezierPointAt(pts,(lo+hi)/2)[1];
}
// Apply the user-selected pressure curve (Tool Settings → Pressure Curve).
// Falls back to true linear (identity) when none is selected, so default
// behaviour for users who never touch this control is unchanged.
function _applyPressureCurve(p){
  const curveKey=(typeof window!=='undefined' && window._tsPressureCurve) || 'linear';
  if(curveKey==='linear') return p;
  const y=_evalPressureCurveY(curveKey, Math.max(0,Math.min(1,p)));
  return Math.max(0, Math.min(1, 1-y));
}

// Resolve the 0-1 influence value for a given dynamics control type.
function _resolveControl(ctrl, e){
  switch(ctrl){
    case 'pressure': {
      // Apply exponential smoothing to reduce digitizer jitter.
      _smoothedPressure = _smoothedPressure*(1-_PRESSURE_SMOOTH) + currentPressure*_PRESSURE_SMOOTH;
      // No artificial floor here — let true light pressure reach true low
      // influence; the final dab radius is still floored to a 1px-diameter
      // minimum further downstream, so the mark never fully disappears.
      return Math.max(0, Math.min(1, _applyPressureCurve(_smoothedPressure)));
    }
    default: return 1.0; // 'off' or unknown
  }
}

// Return effective brush radius and alpha for the current dab, factoring in
// Pen Pressure when the Tool Settings panel has it selected (the only
// dynamics control supported — mouse/trackpad always have
// currentPressure===1.0, so they are unaffected).
// Pure (no side effects) so callers can "peek" at the current radius — e.g.
// to compute dab spacing.
function _computeEffectiveParams(e){
  const baseSize=getBrushSize();
  // Flow (brushFlow) controls per-dab alpha — how fast paint builds up within
  // a stroke. brushOpacity is applied at the stroke level (see _commitStrokeCanvas).
  const baseAlpha=brushFlow;
  const isPenStroke = _isDrawingWithPen;
  let r=baseSize/2;
  let alpha=baseAlpha;

  const sizeCtrl   = _getSizeControl();
  const opacityCtrl= _getOpacityControl();

  // Both Size and Opacity dynamics read the SAME underlying pressure signal
  // when both are set to Pen Pressure. Resolving it independently for each
  // (two separate calls into _resolveControl, each advancing the shared
  // pressure-smoothing EMA by its own step) made Opacity settle one extra
  // EMA step further toward the live reading than Size within the very
  // same dab — a small but constant phase/lag mismatch between width and
  // darkness. Once dabs overlap at tight spacing that mismatch shows up as
  // a periodic "twisted rope" / bead pattern along the stroke instead of a
  // smooth taper (this is the "visible circles" look vs. TVPaint's smooth
  // transition). Fix: resolve pressure exactly once per dab and share the
  // result, so width and opacity always move in lockstep with the same
  // instantaneous pressure sample.
  let _pressureInfluence = null;
  function _getPressureInfluence(){
    if(_pressureInfluence===null) _pressureInfluence = _resolveControl('pressure', e);
    return _pressureInfluence;
  }

  // Size dynamics
  if(sizeCtrl !== 'off'){
    // Pressure: only auto-apply when drawing with a pen (mouse has no real pressure).
    const applySize = (sizeCtrl === 'pressure') ? isPenStroke : true;
    if(applySize){
      const influence = (sizeCtrl === 'pressure') ? _getPressureInfluence() : _resolveControl(sizeCtrl, e);
      const minR = (baseSize/2) * _getMinSize();
      r = minR + (baseSize/2 - minR) * influence;
    }
  }

  // Opacity dynamics — applied per dab, in real time, exactly like Size
  // above: each dab's alpha is scaled by its own instantaneous pressure
  // reading right now, so a light touch paints light immediately and a
  // hard press paints dark immediately, live, while the stroke is still
  // being drawn. brushOpacity (the stroke-level cap) is applied separately
  // and unchanged, once, at commit time (see _commitStrokeCanvas).
  if(opacityCtrl !== 'off'){
    const applyOpacity = (opacityCtrl === 'pressure') ? isPenStroke : true;
    if(applyOpacity){
      const influence = (opacityCtrl === 'pressure') ? _getPressureInfluence() : _resolveControl(opacityCtrl, e);
      const minO = _getMinFlow();
      alpha *= Math.max(0, Math.min(1, minO + (1 - minO) * influence));
    }
  }

  // Absolute visibility floor: percentage-based min-size dynamics (above)
  // can shrink r to near-zero for an already-thin base brush (e.g. a 1.2px
  // brush with the default 5% min-size + light pressure could compute
  // r≈0.03px) — at that scale a dab is essentially invisible no matter the
  // rendering mode, forcing users to mash full pressure just to see
  // anything. Floor the PRESSURE-DRIVEN radius at 0.5px (1px diameter) so a
  // thin brush stays visibly paintable across its whole pressure range.
  // The deliberate stroke-start taper below is applied AFTER this floor and
  // is allowed to go thinner than it — that's the intentional tapered point
  // at the very tip of a stroke, not an accidental disappearance.
  r = Math.max(0.5, r);

  // Stroke-start taper: DISABLED per request — every dab now draws at its
  // full computed width/alpha from the very first point of the stroke, no
  // ease-in from a point. (Previously this fixed-distance ramp kept making
  // large brushes look like they were "still growing" for a big chunk of
  // any normal-length stroke — see taper history above.) _strokeTaperFactor
  // is left defined but unused, so this can be re-enabled by restoring the
  // line below if a tapered start is wanted again later.
  const taper = 1; // was: _strokeTaperFactor(baseSize);
  r *= taper;
  // Only ease ALPHA with the taper in AA mode. AA-off (pencil/pixelated)
  // mode is meant to be a flat, solid, hard-edged stamp with no partial
  // alpha anywhere — fading opacity in at the tip would put in-between
  // (non-solid) colors back in, exactly the gradient the pixelated mode is
  // supposed to avoid. In AA-off mode the taper is carried entirely by
  // width (r), same as a real pencil point narrowing rather than fading.
  if(brushAA) alpha *= (0.35 + 0.65*taper); // width carries most of the taper; opacity eases more gently so the tip stays visible rather than vanishing

  // Density: scales the per-dab alpha contribution independently of
  // opacity/flow and pressure dynamics above (applied last so it works
  // together with, not instead of, those). Each dab still composites with
  // normal source-over/destination-out alpha blending (see _dabAA*/
  // _dabAliased), so lower density doesn't cap final coverage — it just
  // means more overlapping dabs/strokes are needed to reach solid paint,
  // which is what gives smooth, artifact-free accumulation rather than a
  // hard ceiling or banding.
  alpha *= Math.max(0, Math.min(1, brushDensity));

  // Airbrush-only: dabs are placed ~5x more densely than a normal brush
  // (see _AIRBRUSH_SPACING_FRAC in _strokeSegment/_stampQuadCurve), so each
  // individual dab needs to be proportionally fainter to keep the overall
  // paint-buildup rate similar to before — otherwise the denser spacing
  // alone would make the airbrush deposit color much faster than its
  // Flow/Opacity settings intend. This keeps user Flow/Opacity/pressure
  // behavior fully intact (it scales the already-computed alpha, doesn't
  // replace it) and only ever applies while Airbrush mode is on.
  if(typeof window!=='undefined' && window._brushAirbrush) alpha *= _AIRBRUSH_ALPHA_SCALE;

  return{r:Math.max(0.05,r), alpha:Math.max(0.01,Math.min(1,alpha))};
}
function _getEffectiveBrushParams(e){
  const params=_computeEffectiveParams(e);
  _strokeDabCount++;
  return params;
}

// Returns the pressure-scaled radius for spacing calculations ONLY.
// Excludes taper and the visibility floor so the step size always tracks the
// actual rendered dab size — matching CSP's behaviour where spacing is always
// relative to the current effective brush diameter, not the base size.
function _computeSpacingRadius(e, interpolatedPressure){
  const baseSize = getBrushSize();
  const sizeCtrl = _getSizeControl();
  let r = baseSize / 2;
  if(sizeCtrl !== 'off'){
    const applySize = (sizeCtrl === 'pressure') ? _isDrawingWithPen : true;
    if(applySize){
      const savedPressure = currentPressure;
      const savedSmoothed = _smoothedPressure;
      currentPressure = interpolatedPressure;
      const influence = _resolveControl(sizeCtrl, e);
      currentPressure = savedPressure;
      _smoothedPressure = savedSmoothed;
      const minR = (baseSize / 2) * _getMinSize();
      r = minR + (baseSize / 2 - minR) * influence;
    }
  }
  return Math.max(0.05, r);
}

// Carry-over: leftover distance from the end of each segment so the first
// dab of the next segment lands on the correct inter-dab grid.
// Resets to 0 at stroke start/end.
let _strokeSegCarryOver = 0;

// ─────────────────────────────────────────────────────────────────────────────


// ── Brush Tip / Texture public API ─────────────────────────────────────────
// These are the only entry points that should mutate the tip/texture state.
// They bump the version counter (invalidating caches) and clear the relevant
// stamp caches so the very next dab rebuilds with the new data.
window.setBrushTip=function(canvas){
  window.brushTipCanvas=canvas||null;
  window.brushTipVersion=(window.brushTipVersion||0)+1;
  _tipDabCache.clear();
  _aaDabCache.clear();
  _stampCache.clear();
};
window.clearBrushTip=function(){
  window.setBrushTip(null);
};
window.setBrushTexture=function(canvas){
  window.brushTextureCanvas=canvas||null;
  window.brushTextureVersion=(window.brushTextureVersion||0)+1;
};
window.clearBrushTexture=function(){
  window.setBrushTexture(null);
};

// ── Pointer latency fix: touch-action ───────────────────────────────────
// Neither activeC nor canvasArea ever had CSS touch-action set, so every
// pen/touch pointerdown/move had to pass through the browser's built-in
// gesture-recognition delay (deciding "is this a scroll/pinch?") before
// the event even reached these listeners — a real, measurable chunk of
// perceived latency stacked on top of anything JS-side, and worst on fast
// strokes where every extra millisecond of dispatch delay widens the gap
// between the pen tip and the rendered line. preventDefault() in the
// handlers below stops the browser from ACTING on a gesture, but does
// nothing about this up-front recognition delay — only the CSS property
// does. Setting it directly here (rather than requiring a CSS file edit)
// guarantees the canvas always gets the fast, non-scrolling pointer
// dispatch path regardless of how the surrounding page is styled.
activeC.style.touchAction='none';
canvasArea.style.touchAction='none';

activeC.addEventListener('pointerdown',e=>{
  // e.button can be -1 on some tablet drivers for pen primary contact; use e.buttons&1 instead
  if(activeGroupId||panning||(typeof _zoomDrag!=='undefined'&&_zoomDrag)||spaceHeld||tool==='transform') return;
  if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
  // Prevent browser from hijacking tablet/stylus events (scroll, pan, zoom)
  e.preventDefault();
  _isDrawingWithPen = (e.pointerType === 'pen');
  _strokeFirstSample = true; // this stroke's first _getPressure() call snaps immediately, no de-jitter clamping
  currentPressure=_getPressure(e);
  _smoothedPressure = currentPressure; // snap smoothing to actual pressure at stroke start (no ramp-in lag)
  _lastKnownPressure = currentPressure;
  _strokeDabCount = 0; // reset fade counter
  _strokeDistSoFar = 0; // reset start-of-stroke taper
  _pendingDabs.length = 0; // discard any unflushed tail from a previous stroke
  _frameDirty = null; // discard any stale accumulation from a previous/aborted stroke
  _strokeVelocity = 0; // reset velocity
  _lastMoveTime = 0;
  _strokeSegCarryOver = 0; // reset inter-segment dab carry-over
  const p=getPos(e);
  _resetSmoothing(p.x,p.y,e.timeStamp||performance.now());
  _updateVelocity(p.x, p.y, e.timeStamp);
  if(tool==='fill'){pushUndo();ensureKey();floodFill(p.x,p.y,color);saveActiveToKey();recomposite(curLayer,curFrame);return;}
  if(tool==='line'){lineStart=p;return;}
  activeC.setPointerCapture(e.pointerId);
  pushUndo();ensureKey();drawing=true;lx=p.x;ly=p.y;
  _resetCurve(p.x,p.y,currentPressure);
  _lastPointerEvent=e;
  if(tool!=='eraser'){_ensureStrokeCanvas();_inStroke=true;}
  _stampDab(p.x,p.y,e);
  _scheduleRecomposite();
  if(window._brushAirbrush) _startAirbrushSpray();
});
// _handleMoveEvent: shared by pointermove + pointerrawupdate.
// pointerrawupdate fires at the full OS/Windows Ink sampling rate (up to 1000Hz)
// before the browser throttles events to display refresh rate — giving every
// real pressure value the tablet digitizer reports, not just the surviving ones.
function _handleMoveEvent(e){
  if(!drawing||activeGroupId) return;
  if(!(e.buttons&1)){_endStroke();return;}
  e.preventDefault();
  const events=(typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
  for(const ev of events){
    const prevPressure = currentPressure;
    const newPressure = _getPressure(ev);
    const raw=getPos(ev);
    const t=ev.timeStamp || performance.now();
    const p=_smoothPoint(raw.x,raw.y,t);
    _updateVelocity(p.x, p.y, t);
    // Curve (not straight-line) interpolation between samples — see
    // _curveAddPoint/_stampQuadCurve above. Pressure is carried through via
    // the rolling curve buffer's own midpoint averaging, same intent as the
    // old per-segment pressure interpolation.
    _curveAddPoint(p.x,p.y,newPressure,ev);
    currentPressure = newPressure;
    lx=p.x;ly=p.y;
    _lastPointerEvent=ev;
  }
  _scheduleRecomposite();
}
// pointerrawupdate (Chromium 77+ / Windows Ink API) fires IN ADDITION TO
// pointermove for the same physical pen movement — it does not replace it.
// Wiring both to draw the same stroke caused every segment to be stamped
// twice from two independent coordinate streams sampled at different times,
// producing a visible forked/doubled line. Fix: when pointerrawupdate is
// available, it becomes the SOLE source of truth for pen movement, and the
// regular pointermove listener ignores pen events (mouse/touch still use it
// normally).
const _hasRawUpdate = (typeof window !== 'undefined' && 'onpointerrawupdate' in window);
activeC.addEventListener('pointermove', e=>{
  if(_hasRawUpdate && e.pointerType === 'pen') return; // handled exclusively by pointerrawupdate below
  _handleMoveEvent(e);
});
if(_hasRawUpdate){
  activeC.addEventListener('pointerrawupdate', e=>{
    if(e.pointerType !== 'pen') return;
    _handleMoveEvent(e);
  });
}
function _pointerEndStroke(e){
  _stopAirbrushSpray();
  if(activeGroupId){drawing=false;lineStart=null;_pendingDabs.length=0;return;}
  if(tool==='line'&&lineStart){
    pushUndo();ensureKey();const p=getPos(e);
    if(tool!=='eraser'){_ensureStrokeCanvas();_inStroke=true;}
    // Line tool: stamp dabs along the line (respects hardness/opacity)
    _strokeSegment(lineStart.x,lineStart.y,p.x,p.y,e,currentPressure,currentPressure);
    _flushStrokeTail();
    if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
    lineStart=null;saveActiveToKey();recomposite(curLayer,curFrame);return;
  }
  if(drawing){drawing=false;_flushCurveTail(e);_flushStrokeTail();if(_inStroke){_inStroke=false;_commitStrokeCanvas();}saveActiveToKey();_scheduleRecomposite();}
}
activeC.addEventListener('pointerup',e=>{
  if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);
  _pointerEndStroke(e);
});
activeC.addEventListener('pointercancel',()=>{_endStroke();});