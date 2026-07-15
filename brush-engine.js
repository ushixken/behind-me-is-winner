//
// DRAWING Ã¢â‚¬â€ getPos uses activeC's own getBoundingClientRect()
// which accounts for the CSS transform, giving pixel-perfect coords
//
function getPos(e){
  // getBoundingClientRect() on activeC only gives the axis-aligned bounding
  // box of the rotated element, NOT its true rotated geometry Ã¢â‚¬â€ using it
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
// accumulate Ã¢â‚¬â€ the same "build up density" feel as professional apps.
// Declared here (not core-state.js) but shared globally across all
// non-module <script> tags on the page, same as brushOpacity/brushHardness.
let brushDensity = 1;

//  Brush Tip Image (ABR / custom upload)
// When non-null, this canvas holds a grayscale alpha mask that replaces the
// default circle/gradient dab shape.  The tip image is stored at its native
// resolution and scaled to the effective brush diameter on every dab.
// brushTipVersion is bumped whenever the canvas is replaced so that every
// stamp cache that keyed on it is automatically invalidated without a
// manual cache.clear() call at the use site.
window.brushTipCanvas   = null;   // HTMLCanvasElement | null
window.brushTipVersion  = 0;      // integer, incremented on each tip change
window.brushTipReferenceDiameter = null;
window.brushTipSpacingBasis = 'diameter';
// When true the tip mask is multiplied by the standard radial hardness
// falloff Ã¢â‚¬â€ giving a soft feathered edge even on an imported ABR tip.
// When false the tip image alpha is used verbatim (hard-edged custom shape).
window.brushTipSoftAlpha = true;
// 'multiply' applies the tip as an alpha-mask on top of the normal dab.
// 'replace'  uses the tip as the sole shape with no circle falloff at all.
window.brushTipMode = 'multiply';
window.brushTipRoundness = 1;
window.brushTipMinimumRoundness = 0;
window.brushTipRoundnessDynamics = false;
window.brushTipFlipX = false;
window.brushTipFlipY = false;
// Shape Dynamics jitter (Photoshop "Shape Dynamics" panel: Size Jitter,
// Angle Jitter, Roundness Jitter). Each is a 0..1 fraction of full jitter
// range, resolved freshly per dab in _stampDab so every stamp in a stroke
// varies independently -- this is what gives an imported tip (e.g. a grass
// blade) its natural scattered look instead of every dab being an identical
// stencil copy of the last one.
window.brushTipSizeJitter = 0;
window.brushTipAngleJitter = 0;
window.brushTipRoundnessJitter = 0;

//  Brush Texture Image
// When non-null, this canvas is tiled as a repeating texture over each dab
// with globalCompositeOperation='multiply' at strength-controlled opacity.
// Completely independent from the tip shape above.
window.brushTextureCanvas  = null; // HTMLCanvasElement | null
window.brushTextureVersion = 0;    // integer, incremented on each texture change
// True only when the active preset has Texture explicitly enabled.
// Distinct from brushTextureCanvas !== null: a previous preset's canvas may
// linger in memory after switching to a non-textured brush, so checking
// the canvas alone is not a reliable "texture is active" test.
// _getTexturedStrokeCanvas gates on both this flag AND brushTextureCanvas to
// prevent stale canvas state from masking solid-brush strokes.
window.brushTextureEnabled = false;
// 0–1 blend strength for the texture overlay (mirrors ts-texture-strength slider).
// At 1.0 (100%) the texture grain is fully applied — texture-dark areas lose
// coverage, texture-bright areas keep it. At 0.0 the stroke is solid/unaffected.
window.brushTextureStrength   = 1.0;
Object.defineProperty(window,'brushTextureDepth',{
  configurable:true,
  get(){ return window.brushTextureStrength; },
  set(value){ window.brushTextureStrength=value; }
});
// Texture zoom/scale (1.0 = native resolution, 0.25 = 25%, 4.0 = 400%).
// Controlled by the ts-texture-scale slider (25–400%).
window.brushTextureScale   = 1.0;
// Texture buildup strength (0–1). Controls how aggressively overlapping dabs
// within one stroke fill in the grain holes — producing the TVPaint-style
// density accumulation where the centre darkens in a single pass.
// At 1.0 (100%): full build-up — a single stroke becomes dense quickly.
// At 0.0 (0%): no build-up — every dab gets the same static grain cut.
// Controlled by the ts-texture-buildup slider.
window.brushTextureBuildup = 1.0;
// Invert light/dark roles of the texture mask (mirrors the ts-texture-invert checkbox).
window.brushTextureInvert = false;
// Brightness shift for the texture mask, -100..100 (mirrors ts-texture-brightness slider).
// Positive values let more of the texture through (lighter grain holes); negative
// values darken/close the grain holes down, same intent as Clip Studio's Brightness.
window.brushTextureBrightness = 0;
// Contrast for the texture mask, -100..100 (mirrors ts-texture-contrast slider).
// Positive values sharpen the grain boundary (more binary black/white cut);
// negative values soften it into a smoother gradient, same intent as Clip
// Studio's Contrast control in the Texture panel.
window.brushTextureContrast = 0;

// brushFlow: per-dab paint accumulation rate (0Ã¢â‚¬â€œ1).
// Controls how much alpha each individual dab deposits while the stroke is
// in progress. Dabs composite on top of each other freely Ã¢â‚¬â€ so dragging
// slowly over the same spot builds up to full coverage. This is "Flow" in
// Photoshop / Clip Studio Paint.
// Distinct from brushOpacity (see below), which caps the ENTIRE stroke's
// final transparency as a layer-level composite Ã¢â‚¬â€ not individual dabs.
let brushFlow = 1;

//  Dynamic Opacity tracking (Dynamics tab  "Opacity" control)
// This dropdown used to be labeled "Opacity / Flow" but its influence was
// actually only ever applied to per-dab Flow alpha below Ã¢â‚¬â€ the real
// stroke-level Opacity (brushOpacity, applied once in _commitStrokeCanvas)
// never responded to pressure at all, despite the label.
//
// A later revision tried fixing this by averaging/peaking the influence
// across the whole stroke and applying it ONCE, as a single multiplier,
// when the stroke committed on pointerup. That made the control feel
// broken in a different way: while actually drawing, every dab painted at
// full alpha (the live preview only ever used brushOpacity, never the
// dynamic multiplier), so a light touch still looked solid black in real
// time Ã¢â‚¬â€ the opacity would only "snap" down to some fixed low value after
// lifting the pen, instead of tracking pressure as it happened.
//
// Fixed here by applying the pressure influence PER DAB, in real time
// exactly like Size dynamics already does Ã¢â‚¬â€ instead of deferring it to
// stroke-end. Each dab's alpha is scaled by its own instantaneous pressure
// reading, so light pressure paints light immediately and heavy pressure
// paints dark immediately, live, matching what the user is actually doing
// with the pen at that moment. brushOpacity itself remains a separate,
// constant stroke-level cap applied once at commit (see
// _commitStrokeCanvas), unaffected by this per-dab control.

//  Stroke temp canvas
// Opacity (brushOpacity) works at the stroke level: all dabs within a single
// stroke accumulate on a scratch canvas; when the stroke ends the scratch is
// composited onto activeC with globalAlpha = brushOpacity. This means:
//   Ã¢â‚¬Â¢ Flow  = how dabs build up within the stroke (per-dab alpha = brushFlow).
//   Ã¢â‚¬Â¢ Opacity = the maximum final transparency of the completed stroke.
// This matches Photoshop's and Clip Studio's Opacity / Flow behavior exactly.
let _strokeCanvas = null; // offscreen scratch canvas for the current stroke
let _strokeCtx    = null; // its 2D context
// True while a stroke is being painted to _strokeCanvas (between pointerdown
// and the end-of-stroke composite). Used to switch dab targets.
let _inStroke = false;
let _strokeReplayDabs = [];
let _strokeReplayBase = null;
let _replayingTaper = false;

function _beginEndTaperCapture(){
  _strokeReplayDabs.length=0;
  _strokeReplayBase=null;
  if((_getStartTaper()<=0&&_getEndTaper()<=0)||tool!=='eraser') return;
  _strokeReplayBase=document.createElement('canvas');
  _strokeReplayBase.width=activeC.width;
  _strokeReplayBase.height=activeC.height;
  _strokeReplayBase.getContext('2d').drawImage(activeC,0,0);
}

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
  if(typeof _resetTexturedStrokeCanvas==='function') _resetTexturedStrokeCanvas();
}

// Composite the stroke scratch canvas onto activeC with stroke-level opacity,
// then clear the scratch for the next stroke. Per-dab pressure influence on
// Opacity is already baked into each dab's alpha as it was painted (see
// _computeEffectiveParams), so this only needs to apply the constant
// brushOpacity ceiling Ã¢â‚¬â€ no separate end-of-stroke multiplier.
function _commitStrokeCanvas(){
  if(!_strokeCanvas) return;
  // forceFull=true: make sure the ENTIRE stroke is masked (not just whatever
  // region was still pending), so the committed result always matches what
  // the live preview was showing, even if a frame's mask pass got skipped.
  const src = _getTexturedStrokeCanvas(_strokeCanvas, true);
  const styleId=typeof activeAdvancedStyleIdForPainting==='function'
    ?activeAdvancedStyleIdForPainting():null;
  const smartCommitted=tool==='brush'&&styleId&&typeof commitSmartRasterBrush==='function'
    ?commitSmartRasterBrush(src,styleId,brushOpacity):false;
  if(!smartCommitted){
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
  _strokeCtx.clearRect(0, 0, _strokeCanvas.width, _strokeCanvas.height);
}

//  Live stroke preview
// While a stroke is in progress, dabs land on the offscreen _strokeCanvas
// (not activeC) so stroke-level Opacity/Flow can be composited correctly
// once at stroke-end (see _commitStrokeCanvas above). But recomposite()
// only ever reads activeC for the active layer Ã¢â‚¬â€ so without this, nothing
// the user is currently drawing shows up until pointerup finally commits
// the scratch canvas, which is exactly the "stroke only appears when you
// let go" bug. Fix: build a live preview canvas that layers the in-
// progress _strokeCanvas over activeC at brushOpacity Ã¢â‚¬â€ the same blend
// _commitStrokeCanvas will eventually perform for real Ã¢â‚¬â€ and hand THAT to
// recomposite() as the active layer's source while `_inStroke` is true.
// This is purely a read-side preview: activeC itself is untouched, so the
// stroke-canvas pipeline and its opacity handling at commit time are
// unaffected.
let _strokePreviewCanvas = null;
let _strokePreviewCtx    = null;
// Scratch canvas used only inside _getLiveStrokePreview to tint the raw
// stroke mask with the active Smart Raster palette color.  Kept persistent
// so we never allocate inside the per-frame preview path.
let _srPreviewTintCanvas = null;
let _srPreviewTintCtx    = null;
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
    const src = _getTexturedStrokeCanvas(_strokeCanvas, false);

    // Smart Raster live preview fix:
    // _commitStrokeCanvas routes through commitSmartRasterBrush which calls
    // SmartRasterLayer.renderFrame — resolving index -> palette RGBA and
    // painting the correct style color.  _getLiveStrokePreview previously
    // just blitted the raw _strokeCanvas, which contains dabs drawn in the
    // default brush color (black/whatever color is), so the preview showed
    // the wrong color while drawing even though the committed result was
    // correct.  We now detect the same Smart Raster condition here and tint
    // the stroke coverage with the active palette style's RGBA before
    // compositing into the preview — making the preview match the final
    // committed render exactly.
    const styleId = typeof activeAdvancedStyleIdForPainting === 'function'
      ? activeAdvancedStyleIdForPainting() : null;
    const isSmartRaster = tool === 'brush' && !!styleId
      && typeof advancedPalettePaintingEnabled === 'function'
      && advancedPalettePaintingEnabled();

    let strokeSrc = src; // default: raw stroke canvas (bitmap layers, eraser, etc.)

    if(isSmartRaster){
      // Resolve the active style's RGBA from the palette once per preview frame.
      let rgba = null;
      if(window.PaletteDocker && typeof window.PaletteDocker.findAdvancedStyleById === 'function'){
        const style = window.PaletteDocker.findAdvancedStyleById(styleId);
        if(style && Array.isArray(style.rgba)) rgba = style.rgba;
      }

      if(rgba){
        // Build (or reuse) the tint scratch canvas.
        if(!_srPreviewTintCanvas || _srPreviewTintCanvas.width !== w || _srPreviewTintCanvas.height !== h){
          _srPreviewTintCanvas = document.createElement('canvas');
          _srPreviewTintCanvas.width  = w;
          _srPreviewTintCanvas.height = h;
          _srPreviewTintCtx = _srPreviewTintCanvas.getContext('2d', {willReadFrequently: true});
        } else {
          _srPreviewTintCtx.clearRect(0, 0, w, h);
        }

        // Step 1: flood the tint canvas with a solid rectangle of the palette
        // color.  Alpha channel of rgba[3] (0-255) scales the fill, matching
        // the same rgba lookup renderFrame uses.
        const styleAlpha = rgba[3] == null ? 1 : rgba[3] / 255;
        _srPreviewTintCtx.save();
        _srPreviewTintCtx.globalCompositeOperation = 'source-over';
        _srPreviewTintCtx.fillStyle =
          'rgba(' + rgba[0] + ',' + rgba[1] + ',' + rgba[2] + ',' + styleAlpha + ')';
        _srPreviewTintCtx.fillRect(0, 0, w, h);
        _srPreviewTintCtx.restore();

        // Step 2: mask the solid color fill by the stroke's alpha coverage
        // (destination-in keeps only the pixels where the stroke canvas is
        // opaque, so the resulting canvas has the palette color shaped exactly
        // like the stroke).  brushOpacity is then applied below as globalAlpha
        // when blitting into the preview, exactly as it is at commit time.
        _srPreviewTintCtx.save();
        _srPreviewTintCtx.globalCompositeOperation = 'destination-in';
        _srPreviewTintCtx.drawImage(src, 0, 0);
        _srPreviewTintCtx.restore();

        strokeSrc = _srPreviewTintCanvas;
      }
      // If palette lookup failed (style not found yet), fall through to the
      // raw src so the preview is at least visible, even if temporarily the
      // wrong color — better than a blank preview.
    }

    _strokePreviewCtx.save();
    _strokePreviewCtx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
    _strokePreviewCtx.globalCompositeOperation = 'source-over';
    _strokePreviewCtx.drawImage(strokeSrc, 0, 0);
    _strokePreviewCtx.restore();
  }
  return _strokePreviewCanvas;
}
window._getLiveStrokePreview = _getLiveStrokePreview;
//
// TVPAINT / CLIP STUDIO STYLE BRUSH ENGINE
//
// Two antialiasing modes, matching how professional animation apps work:
//
//  AA ON  (brushAA=true) Ã¢â‚¬â€ sub-pixel radial gradient dabs.
//    Each dab is a radial gradient: fully opaque core Ã¢â€ â€™ transparent edge.
//    The feather zone is controlled by brushHardness.
//    This is TVPaint's PenBrush / Clip Studio Paint's normal pen/brush:
//    smooth diagonal edges, anti-aliased curves, soft feel.
//
//  AA OFF (brushAA=false) Ã¢â‚¬â€ pixel-snapped hard stamps.
//    Each dab is filled with ctx.arc() at full opacity, then the result
//    is quantised to whole pixels via getImageData/putImageData.
//    This is TVPaint's Pencil (type 6) / Clip Studio's "pixel pen":
//    every edge pixel is fully ON or fully OFF Ã¢â‚¬â€ no partial alpha.
//    Ideal for cel-animation clean line work.
//
// The eraser always uses the same mode as the current brush.
//

function _currentAAMode(){
  return _normalizeAAMode(typeof window!=='undefined'?window.brushAAMode:null);
}
function _hexToRGB(hex){
  const h=hex.replace('#','');
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}

//  Cache key quantization
// Pressure/velocity/fade/taper dynamics nudge r and alpha by tiny fractions
// on basically every dab, so keying the stamp cache on their EXACT values
// (old code: r.toFixed(2), raw alpha) made the cache miss almost every
// single dab Ã¢â‚¬â€ defeating the whole point of caching and forcing a fresh
// gradient/canvas (AA) or getImageData/putImageData readback (aliased) per
// dab, which is what actually caused the lag in BOTH modes. Quantizing to a
// coarse step means a stroke with continuously-varying pressure still hits
// the same handful of cache entries almost every time Ã¢â‚¬â€ the size/alpha
// difference between two quantization buckets is sub-pixel/imperceptible,
// but the perf difference (cache hit vs. full rebuild) is enormous.
const _Q_R = 0.25;      // px
const _Q_ALPHA = 0.02;  // ~2% alpha steps
function _quant(v,step){return Math.round(v/step)*step;}

//  Edge width: Photoshop/Photopea-style constant-ish antialiasing
// The old falloff used `outerSpan = 1-hardness` as a FRACTION OF THE RADIUS,
// so the soft edge band was literally (1-hardness)*r pixels wide Ã¢â‚¬â€ fine on a
// small brush, but on a large one (say r=150 at hardness=0.5) that's a 75px
// blurry gradient, exactly the fat soft edge seen on big brushes vs.
// Photopea's crisp hairline rim at the same size. Real hard-round brushes in
// Photoshop/Photopea keep the antialiased rim at only a couple of pixels
// wide regardless of brush size Ã¢â‚¬â€ hardness controls how MUCH of the radius
// is solid core, but the transition itself doesn't keep growing forever.
// Fix: compute the edge band in actual pixels and clamp it to a small max,
// so a big hard brush still gets a crisp, near-constant-width edge instead
// of a soft gradient that scales with size.
const _EDGE_PX_MIN = 0.6;  // legacy floor, kept for airbrush-only math elsewhere

//  AA strength modes (Edit ▸ Tool Settings ▸ Antialiasing dropdown)
// Root cause of the "chunky, stair-stepped" Hard Round edge (see bug report /
// reference pics): for a near-100%-hardness brush, (1-hardness)*r collapses
// to ~0, so the old _edgeWidthPx fell all the way down to its ONE global
// floor, _EDGE_PX_MIN = 0.6px. A 0.6px-wide antialiasing ramp is barely more
// than a single pixel row of partial coverage — on any diagonal/curved edge
// that reads as a near-binary, stair-stepped boundary even though a
// gradient/coverage calc technically ran. The GPU path made this worse by
// only using extra gradient stops (12) when hardness<0.95; Hard Round
// (hardness>=0.95) got just 3 stops across that already-tiny 0.6px band —
// effectively a linear, unantialiased-looking cliff.
//
// Fix: the edge-pixel floor is now driven by an explicit AA MODE that is
// fully independent of Hardness. Hardness still controls the radial
// falloff/core size exactly as before ((1-hardness)*r contributes to the
// edge width for soft brushes); AA mode only sets the MINIMUM edge-pixel
// coverage band and the number of samples/gradient stops used to render it.
// For a 100%-hardness Hard Round, hardness contributes ~0px, so the AA mode
// floor determines the whole visible rim — giving predictable, selectable
// smoothing (None/Weak/Medium/Strong) without ever touching Hardness (the
// solid core / "hard" feel is untouched; only the 1-2px boundary ring is).
const _AA_MODE_EDGE_PX = { none:0, weak:0.85, medium:1.6, strong:2.6 };
const _AA_MODE_EDGE_MAX_PX = { none:0, weak:2, medium:4, strong:7 };
// Gradient stop / supersample counts per mode — more stops means the
// (necessarily coarse, linearly-interpolated) canvas gradient reads as a
// smooth curve instead of a visibly faceted ramp across the edge band.
const _AA_MODE_STOPS = { none:2, weak:8, medium:14, strong:20 };
function _normalizeAAMode(mode){
  return (mode==='none'||mode==='weak'||mode==='medium'||mode==='strong')?mode:'medium';
}
function _edgeWidthPx(r, hardness, mode){
  const m=_normalizeAAMode(mode);
  if(m==='none') return 0;
  const aaFloor=_AA_MODE_EDGE_PX[m];
  // Edge width in pixels: hardness controls how wide the feather is across
  // the full radius (no pixel cap), while AA mode sets only a minimum floor
  // so even a 100%-hardness Hard Round gets a smooth antialiased rim.
  // The OLD code capped this at _AA_MODE_EDGE_MAX_PX (e.g. 4px) which
  // destroyed the hardness signal on large brushes: both 0% and 100%
  // hardness collapsed to a ~4px feather out of 150px radius (~0.97 inner),
  // making them look identical. The cap is removed: hardness freely sets
  // the feather from 0px (hardness=1) to r px (hardness=0).
  return Math.max(aaFloor, (1-hardness)*r);
}
// Returns the inner-core fraction (0..1) where the falloff begins.
//   hardness=1.0  -> edgePx ~ AA_floor (e.g. 1.6px on 150r = 0.989 inner)
//   hardness=0.5  -> edgePx = r/2 = 75px -> inner = 0.5
//   hardness=0.0  -> edgePx = r   = 150px -> inner = 0.0
function _effectiveInnerFrac(r, hardness, mode){
  const rr = Math.max(0.05, r);
  const h = Math.max(0, Math.min(1, hardness));
  const edgePx = _edgeWidthPx(rr, h, mode);
  return Math.max(0, Math.min(0.999, 1 - edgePx/rr));
}

function _roundBrushFalloff(t,inner,hardness){
  if(t>=1) return 0;
  if(t<=inner) return 1;
  const u=(t-inner)/Math.max(0.0001,1-inner);
  // Always use the smooth hermite (smoothstep) curve for the feather zone.
  // Previously hardness>=0.95 used a linear ramp, but since inner is now
  // driven by hardness directly (hardness=1 -> inner~1, tiny feather zone),
  // the curve shape in that tiny zone doesn't matter visually. Using the
  // same curve everywhere keeps the falloff consistent and avoids a
  // sudden transition in feel around hardness=0.95.
  return 1-u*u*(3-2*u);
}

// _aaDabCache (defined below, near _buildAAStamp) is a real Map cache of
// CPU-rendered stamps, keyed by quantized size/color/alpha/composite/hardness.
// Other files call _aaDabCache.clear() whenever a brush setting that
// affects the stamp's appearance changes (size, hardness, roundness, AA
// toggle) Ã¢â‚¬â€ this invalidates every cached stamp so the next dab rebuilds.

// Ã¢â€â‚¬Ã¢â€â‚¬ AA dab: soft, sub-pixel accurate Ã¢â‚¬â€ GPU or CPU rasterized, selectable
// via Edit Ã¢â€“Â¸ Preferences Ã¢â€“Â¸ Renderer (brushRenderer in core-state.js).
//
// GPU mode (_dabAAGpu, default): ctx.createRadialGradient()+fill() Ã¢â‚¬â€ hands
// rasterization to the browser's hardware-accelerated canvas backend.
// Cheap and smooth; this is the recommended default and matches how most
// browser drawing apps behave.
//
// CPU mode (_dabAACpu): computes each dab's alpha falloff by hand,
// pixel-by-pixel, in plain JS (see _buildAAStamp below) into an ImageData
// buffer Ã¢â‚¬â€ closer to how TVPaint's own software brush engine works. This
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
//      per-pixel falloff loop Ã¢â‚¬â€ no gradient/scaling involved at all, so
//      none of the v3/v4 resampling artifacts apply Ã¢â‚¬â€ then blit it at the
//      dab's true fractional x/y with normal bilinear smoothing. Only the
//      STAMP's own size is quantized (0.25px steps Ã¢â‚¬â€ imperceptible,
//      already proven fine by the aliased path below); the on-screen
//      *position* stays fully sub-pixel accurate every single dab. This is
//      the current CPU-mode implementation.
//  Airbrush-only falloff: true gaussian, no flat opaque core
// Every other brush (hard/soft round, pencil, eraser) intentionally uses a
// flat inner core + linear ramp (see _effectiveInnerFrac/_edgeWidthPx)
// that's what gives a "round brush" its defined, paintable body. A real
// airbrush/spray-can tip has NO flat core at all: peak density sits at the
// exact center and fades continuously the whole way to the edge, which is
// what makes Photopea's/Clip Studio's airbrush read as a soft cloud rather
// than a disc with a blurry rim. Reusing the linear inner/outer model (even
// with the widened edge from _edgeWidthPx) still leaves a visible plateau
// where overlapping dabs saturate to solid Ã¢â‚¬â€ this bypasses that model
// entirely for airbrush dabs only.
// t: distance/radius (0 at center, 1 at edge). Returns 0..1 alpha multiplier.
// Normalized so f(0)=1 and f(1)=0 exactly (no ring/pop at the boundary).
function _airbrushFalloff(t){
  if(t>=1) return 0;
  // Higher k = a tight, dense core with a long soft tail (matches
  // Photopea's look: a clearly darker center, not an evenly pale disc).
  // The previous k=2.0 spread density too evenly across the whole radius,
  // which Ã¢â‚¬â€ combined with a heavily dampened peak alpha Ã¢â‚¬â€ made a single
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
// alpha of an INDIVIDUAL dab must stay strong Ã¢â‚¬â€ that's what gives the
// dark-center/soft-edge radial contrast Photopea shows even from one
// stamp. Only a mild compensation is applied here (not a heavy dampening)
// so tighter spacing doesn't cause the stroke to over-saturate too fast,
// without erasing each dab's own visible falloff.
const _aaDabCache=new Map(); // key -> {canvas,w,h}
const _AA_DAB_CACHE_MAX=64;

//  Tip-shaped dab cache
// Mirrors _aaDabCache but for dabs whose shape comes from brushTipCanvas.
// Keyed on (r, rgb, alpha, composite, hardness, tipVersion, softAlpha, mode)
// so any tip change (new import, clear) busts every entry automatically.
const _tipDabCache=new Map();
const _TIP_DAB_CACHE_MAX=32;

// Build a stamp canvas pre-shaped by the current brushTipCanvas.
// Returns {canvas,w,h} Ã¢â‚¬â€ same contract as _buildAAStamp.
function _buildTipStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
  const tipC=window.brushTipCanvas;
  const tipV=tipC?(window.brushTipVersion||0):-1;
  const softAlpha=!!window.brushTipSoftAlpha;
  const tipMode=window.brushTipMode||'multiply';
  // Per-dab roundness override (set by _drawDabNow from the dab's own
  // jittered roundness, see Roundness Jitter in _stampDab) takes priority
  // over the static brushTipRoundness slider so Shape Dynamics can vary the
  // squish of every individual stamp, exactly like Photoshop.
  const baseRoundness=(typeof _activeDabRoundness!=='undefined'&&_activeDabRoundness!=null)?_activeDabRoundness:(window.brushTipRoundness==null?1:window.brushTipRoundness);
  const tipRoundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,baseRoundness));
  // Cache granularity: 0.25px steps are fine for normal-sized dabs, but at
  // small pressure-driven radii a 0.25px bucket is a large fraction of the
  // whole dab -- consecutive dabs along a smoothly shrinking taper would
  // visibly jump between a handful of cached sizes ("stepping") instead of
  // shrinking continuously. Use a much finer bucket once the dab gets
  // small; still cheap since there are only ever a few distinct tiny sizes
  // alive in a stroke at once relative to the cache's max size.
  const rQuantStep=rRaw<=4?0.02:_Q_R;
  const r=_quant(rRaw,rQuantStep), alpha=_quant(alphaRaw,_Q_ALPHA);
  const hardness=Math.round(Math.max(0,Math.min(0.99,hardnessRaw))*100)/100;
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|'+
            hardness.toFixed(2)+'|t'+tipV+'|'+(softAlpha?'s':'h')+'|'+tipMode+'|rd'+tipRoundness.toFixed(3);
  const hit=_tipDabCache.get(key);
  if(hit) return hit;

  const rr=Math.max(0.05,r);
  // Preserve the tip's native aspect ratio instead of forcing it into a
  // square dab sized purely off the radius. Previously the tip image was
  // always drawn into a square canvas (w=h, based on r alone) Ã¢â‚¬â€ a tall,
  // thin tip like a calligraphy bar got stretched to fill that square and
  // then clipped by the radial falloff below into a plain filled circle,
  // losing its actual shape entirely. Scaling by the tip's own aspect
  // ratio (its longer side maps to the current brush diameter, 2*rr) keeps
  // the true silhouette at every brush size.
  const tipNativeW=tipC?(tipC.width||tipC.naturalWidth||1):1;
  const tipNativeH=tipC?(tipC.height||tipC.naturalHeight||1):1;
  const tipScale=(2*rr)/Math.max(tipNativeW,tipNativeH);
  const compressWidth=tipNativeW<tipNativeH;
  // NOTE: genuinely tiny dabs (r<=1, matching Hard Round's own cutoff) are
  // now rendered by _dabTipTinyCoverage instead (see _dabAA), via direct
  // supersampled coverage sampling of the ORIGINAL tip source. That path
  // preserves true float size/position and produces genuine fractional-
  // pixel antialiased coverage, so light-pressure strokes get their pale
  // look from real AA coverage the same way Hard Round's tiny dabs do --
  // never from an artificial alpha multiplier. This function only ever
  // handles r>1 now, where a >=1px raster is a true, non-floored
  // representation of the dab.
  const dabW=Math.max(1,tipNativeW*tipScale*(compressWidth?tipRoundness:1));
  const dabH=Math.max(1,tipNativeH*tipScale*(compressWidth?1:tipRoundness));

  const pad=2;
  const w=Math.ceil(dabW)+pad*2+1, h=Math.ceil(dabH)+pad*2+1;
  const cx=w/2, cy=h/2;

  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});

  const cr=composite==='erase'?0:rgb[0];
  const cg=composite==='erase'?0:rgb[1];
  const cb=composite==='erase'?0:rgb[2];

  // Rasterize the tip into a mask-only canvas. The source grayscale RGB
  // never enters the output stamp canvas; only the resolved mask alpha is
  // copied into a fresh brush-coloured ImageData buffer.
  const maskCanvas=document.createElement('canvas');
  maskCanvas.width=w; maskCanvas.height=h;
  const maskCtx=maskCanvas.getContext('2d',{willReadFrequently:true});
  maskCtx.imageSmoothingEnabled=true;
  maskCtx.imageSmoothingQuality='high';
  maskCtx.drawImage(tipC,0,0,tipNativeW,tipNativeH,(w-dabW)/2,(h-dabH)/2,dabW,dabH);
  const maskData=maskCtx.getImageData(0,0,w,h).data;

  let legacyAlphaOnlyMask=false;
  try{
    const sourceCtx=tipC.getContext('2d',{willReadFrequently:true});
    const sourceData=sourceCtx.getImageData(0,0,tipNativeW,tipNativeH).data;
    let maximumVisibleLuminance=0;
    for(let p=0;p<sourceData.length;p+=4){
      if(sourceData[p+3]===0) continue;
      const sourceLuminance=(sourceData[p]*0.2126+sourceData[p+1]*0.7152+sourceData[p+2]*0.0722)/255;
      if(sourceLuminance>maximumVisibleLuminance) maximumVisibleLuminance=sourceLuminance;
    }
    legacyAlphaOnlyMask=maximumVisibleLuminance<0.01;
  }catch(error){
    legacyAlphaOnlyMask=false;
  }

  const output=tc.createImageData(w,h); const outputData=output.data;
  // Apply the SAME radial hardness falloff every other brush already gets
  // (see _roundBrushFalloff/_effectiveInnerFrac used by the procedural
  // round-brush renderers). Previously `hardness`/`softAlpha` were read and
  // even baked into the cache key, but never actually multiplied into the
  // output alpha below -- so Hardness had zero effect on imported tips and
  // every dab's edge was exactly as raw/jagged as the source image, with no
  // AA feather at all. This is the main cause of the blocky, stamp-like
  // edges on custom tips. Fixed by feathering the mask's outer band by an
  // elliptical falloff sized to the dab's own (possibly non-square) aspect
  // ratio, so non-circular tips (e.g. a calligraphy bar) still feather
  // correctly along their own silhouette instead of a plain circle.
  const aaMode=_currentAAMode();
  // Falloff is gated on tipMode, not just softAlpha: per brushTipMode's own
  // contract ('multiply' = tip as an alpha-mask ON TOP OF the round dab;
  // 'replace' = tip alpha IS the sole shape, no circle at all), 'replace'
  // must never get the radial falloff layered on top of it -- doing so
  // would silently clip a non-circular tip's corners and double up the
  // antialiasing (once from the tip's own edge, once from the falloff).
  const applyFalloff=softAlpha&&tipMode!=='replace';
  const inner=applyFalloff?_effectiveInnerFrac(rr,hardness,aaMode):1;
  const semiW=Math.max(0.5,dabW/2), semiH=Math.max(0.5,dabH/2);
  for(let p=0;p<maskData.length;p+=4){
    const sourceAlpha=maskData[p+3]/255;
    const luminance=(maskData[p]*0.2126+maskData[p+1]*0.7152+maskData[p+2]*0.0722)/255;
    let tipAlpha=legacyAlphaOnlyMask?sourceAlpha:sourceAlpha*luminance;
    if(tipAlpha<=0) continue;
    if(applyFalloff){
      const i=p/4, px=i%w, py=Math.floor(i/w);
      const dx=(px+0.5-cx)/semiW, dy=(py+0.5-cy)/semiH;
      const t=Math.sqrt(dx*dx+dy*dy);
      tipAlpha*=_roundBrushFalloff(t,inner,hardness);
      if(tipAlpha<=0) continue;
    }
    outputData[p]=cr; outputData[p+1]=cg; outputData[p+2]=cb;
    outputData[p+3]=Math.round(Math.min(1,alpha*tipAlpha)*255);
  }
  tc.putImageData(output,0,0);

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
  const aaMode=_currentAAMode();
  // Include the current tip version in the cache key so that loading a new
  // tip (or clearing it) automatically invalidates all previous CPU stamps
  // without an extra cache.clear() call. AA mode is included so switching
  // None/Weak/Medium/Strong correctly rebuilds every cached stamp instead of
  // reusing a stale edge width.
  const tipV=(window.brushTipCanvas?(window.brushTipVersion||0):-1);
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|'+hardness.toFixed(2)+'|'+(isAirbrush?'ab':'n')+'|tv'+tipV+'|aa'+aaMode;
  const hit=_aaDabCache.get(key);
  if(hit) return hit;
  const rr=Math.max(0.05,r);
  // Padding must cover the widest possible edge band (Strong mode can push
  // the antialiased rim up to _AA_MODE_EDGE_MAX_PX.strong px past r), or the
  // stamp bitmap would clip the soft tail and reintroduce a hard cutoff.
  const pad=Math.max(2,Math.ceil(_AA_MODE_EDGE_MAX_PX[aaMode]||2)),ir=Math.ceil(rr);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  const cx=w/2,cy=h/2;
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  const id=tc.createImageData(w,h);
  const d=id.data;
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const inner=_effectiveInnerFrac(rr,hardness,aaMode);
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
      a=alpha*_roundBrushFalloff(t,inner,hardness);
      if(a<=0) continue; // leave fully transparent (already zeroed by createImageData)
      // When a tip image is loaded, use its alpha channel as the shape mask.
      // setBrushTip() normalizes flat-alpha (fully opaque) grayscale tips into
      // real alpha on load (white shape -> opaque, black background -> transparent),
      // so by now the tip's alpha channel already fully encodes the shape/gradient.
      if(tipPixels){
        const tipFactor=tipPixels[p+3]/255;    // tip alpha at this pixel
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
let _activeDabRotation=0;
function _viewAdjustedTipRotation(){
  const reflected=(!!flipX)!=(!!flipY);
  return reflected?-_activeDabRotation:_activeDabRotation;
}
// Per-dab roundness override for the current dab being drawn (Roundness
// Jitter). null means "use the static brushTipRoundness slider value".
let _activeDabRoundness=null;
// TVPaint-style dab compositing within a stroke:
// When dabs land on the stroke scratch canvas (_inStroke=true), use 'lighten'
// instead of 'source-over'. 'lighten' takes the per-channel maximum, so a
// new dab NEVER darkens pixels already covered by an earlier dab in the same
// stroke — it only fills in uncovered/lighter areas. This matches TVPaint's
// behavior where one slow stroke builds to solid coverage without dabs
// stacking and re-darkening the same spots (which required multiple strokes).
// Eraser and direct-to-activeC paths are unaffected.
function _strokeDabComposite(composite){
  if(composite==='erase') return 'destination-out';
  return 'source-over';
}
function _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite){
  const dc=(_inStroke && composite!=='erase')?_strokeCtx:ctx;
  const stamp=_buildTipStamp(r,rgb,alpha,composite,brushHardness);
  dc.save();
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  dc.imageSmoothingEnabled=true;
  dc.translate(x,y);
  const adjustedRotation=_viewAdjustedTipRotation();
  if(adjustedRotation) dc.rotate(adjustedRotation);
  if(window.brushTipFlipX||window.brushTipFlipY) dc.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
  dc.drawImage(stamp.canvas,-stamp.w/2,-stamp.h/2);
  dc.restore();
}
function _dabAAGpu(x,y,r,rgb,alpha,composite){
  if(window.brushTipCanvas){
    _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite);
    return;
  }
  // When a custom tip image is loaded, build a pre-shaped stamp (cached)
  // and blit it Ã¢â‚¬â€ no gradient is drawn. Falls back to the radial gradient
  // path below when no tip is set, preserving existing behaviour exactly.
  if(window.brushTipCanvas){
    const dc=(_inStroke && composite!=='erase')?_strokeCtx:ctx;
    const stamp=_buildTipStamp(r,rgb,alpha,composite,brushHardness);
    if(stamp){
      const x0=x-(stamp.w/2), y0=y-(stamp.h/2);
      dc.save();
      dc.globalCompositeOperation=_strokeDabComposite(composite);
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
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  const grad=dc.createRadialGradient(x,y,0,x,y,rr);
  const c0=composite==='erase'?[0,0,0]:rgb;
  const aaMode=_currentAAMode();
  {
    // Build gradient stops DENSE inside the feather zone [inner..1] and
    // sparse in the solid core [0..inner].
    //
    // Old approach: uniform stops at t=i/STOPS across 0..1. For a hard
    // brush (inner=0.989 on a 300px brush) the feather zone is <1.1% of
    // the gradient range. With 12 uniform stops, the nearest core stop is
    // at t=11/12=0.917 and the only feather stop is t=1.0. The browser
    // linearly interpolates between them -> a ~12px ramp instead of 1.6px,
    // creating the wide blurry halo at large sizes.
    // Fix: pin two stops at t=0 and t=inner (both full alpha, solid core),
    // then place STOPS densely within [inner, 1.0] to faithfully represent
    // the narrow falloff curve at whatever pixel width it actually spans.
    const inner=_effectiveInnerFrac(rr,brushHardness,aaMode);
    const STOPS=Math.max(8,_AA_MODE_STOPS[aaMode]||14);
    // Solid core: two anchors so the browser never interpolates across it.
    grad.addColorStop(0,`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    if(inner>0.0001){
      grad.addColorStop(Math.min(0.9999,inner),`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    }
    // Feather zone: dense stops from inner to 1.0.
    for(let i=1;i<=STOPS;i++){
      const t=inner+(1-inner)*(i/STOPS);
      const a=alpha*_roundBrushFalloff(t,inner,brushHardness);
      grad.addColorStop(Math.min(1,t),`rgba(${c0[0]},${c0[1]},${c0[2]},${Math.max(0,a)})`);
    }
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
//      the GPU path uses Ã¢â‚¬â€ pressure response looked subtly "stepped".
//   2. Sub-pixel positioning came from the browser's bilinear resample of
//      the cached bitmap Ã¢â‚¬â€ an EXTRA blur pass on top of the already-soft
//      falloff. The GPU path never resamples anything; it draws the exact
//      gradient at the exact (x,y) every time. Net result: CPU strokes
//      looked softer/blurrier than GPU strokes at the same hardness.
// Fix: compute the exact same analytic falloff the GPU radial gradient
// uses (flat core out to `inner`, linear ramp to 0 at the true,
// unquantized radius `r`), sampled at the dab's true fractional center
// then composite it by hand (standard source-over / destination-out alpha
// math) directly into the canvas's pixel buffer instead of drawing a
// pre-baked bitmap. This is intentionally heavier than the old cached
// version (that's the whole point of choosing the CPU renderer Ã¢â‚¬â€ see the
// brushRenderer comment in core-state.js) but it now matches the GPU
// renderer's stroke quality, pressure response and edge softness exactly;
// only the rasterization backend differs (hand-written per-pixel math vs.
// the browser's hardware gradient/fill).
function _dabAACpu(x,y,r,rgb,alpha,composite){
  if(window.brushTipCanvas){
    _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite);
    return;
  }
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
      dc0.globalCompositeOperation=_strokeDabComposite(composite);
      dc0.drawImage(stamp.canvas,x0,y0);
      dc0.restore();
      return;
    }
  }
  const dc = (_inStroke && composite !== 'erase') ? _strokeCtx : ctx;
  const rr=Math.max(0.05,r);
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  const aaModeCpu=_currentAAMode();
  const inner=_effectiveInnerFrac(rr,brushHardness,aaModeCpu);
  const cw=dc.canvas.width, ch=dc.canvas.height;
  // Pad enough to cover the widest possible edge band for the active AA
  // mode (Strong can extend several px past r) so the falloff tail isn't
  // clipped by the sample rect, which would reintroduce a hard cutoff.
  const pad=Math.max(1,Math.ceil(_AA_MODE_EDGE_MAX_PX[aaModeCpu]||1)), ir=Math.ceil(rr)+pad;
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
      let a=alpha*_roundBrushFalloff(t,inner,brushHardness);
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
// Renderer preference dispatch Ã¢â‚¬â€ see brushRenderer in core-state.js and the
// Preferences modal (Edit Ã¢â€“Â¸ Preferences).
function _dabAATinyCoverage(x,y,r,rgb,alpha,composite){
  const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;
  const rr=Math.max(0.05,r),pad=1;
  const sx=Math.max(0,Math.floor(x-rr-pad)),sy=Math.max(0,Math.floor(y-rr-pad));
  const ex=Math.min(dc.canvas.width,Math.ceil(x+rr+pad)),ey=Math.min(dc.canvas.height,Math.ceil(y+rr+pad));
  const width=ex-sx,height=ey-sy;
  if(width<=0||height<=0) return;
  const image=dc.getImageData(sx,sy,width,height),data=image.data;
  const inner=_effectiveInnerFrac(rr,brushHardness,_currentAAMode());
  const samples=4,invSamples=1/(samples*samples);
  for(let py=0;py<height;py++){
    for(let px=0;px<width;px++){
      let coverage=0;
      for(let sampleY=0;sampleY<samples;sampleY++){
        for(let sampleX=0;sampleX<samples;sampleX++){
          const wx=sx+px+(sampleX+0.5)/samples;
          const wy=sy+py+(sampleY+0.5)/samples;
          const t=Math.hypot(wx-x,wy-y)/rr;
          coverage+=_roundBrushFalloff(t,inner,brushHardness);
        }
      }
      const sourceAlpha=Math.max(0,Math.min(1,alpha*coverage*invSamples));
      if(sourceAlpha<=0) continue;
      const offset=(py*width+px)*4;
      if(composite==='erase'){
        data[offset+3]*=1-sourceAlpha;
      }else{
        const destinationAlpha=data[offset+3]/255;
        const outputAlpha=sourceAlpha+destinationAlpha*(1-sourceAlpha);
        data[offset]=(rgb[0]*sourceAlpha+data[offset]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+1]=(rgb[1]*sourceAlpha+data[offset+1]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+2]=(rgb[2]*sourceAlpha+data[offset+2]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+3]=outputAlpha*255;
      }
    }
  }
  dc.putImageData(image,sx,sy);
}// ---- Tiny custom-tip coverage renderer (matches _dabAATinyCoverage) ----
// Hard Round gets its light-pressure "pale, thin, still visible" look from
// _dabAATinyCoverage: at r<=1 it stops using a cached, integer-rasterized
// bitmap and instead supersamples the ANALYTIC falloff directly into the
// destination per output pixel, so a 0.2px-radius dab really does render as
// a faint partial-coverage smudge instead of jumping to some floored
// minimum size. Custom tips never had an equivalent -- _buildTipStamp always
// rasterized into an integer-pixel canvas with a 1px floor, so a tip dab
// that should be much smaller than 1px still occupied a full 1px cell.
// (An earlier fix compensated by multiplying alpha down proportionally,
// which worked visually but was exactly the "fake it by reducing alpha"
// shortcut this task asks NOT to do.)
//
// This function is the real fix: it supersamples the tip's OWN alpha mask
// directly (bilinear-sampled from the original tip source, never from a
// pre-scaled cached bitmap) at the true floating-point size/position/
// rotation, so the pale appearance comes from genuine fractional-pixel
// coverage -- identical in spirit to Hard Round, just sampling a tip mask
// instead of an analytic circle.
let _tipAlphaBuf=null,_tipAlphaBufVersion=-1,_tipAlphaBufW=0,_tipAlphaBufH=0,_tipAlphaBufLegacy=false;
function _getTipAlphaBuffer(){
  const tipC=window.brushTipCanvas;
  if(!tipC) return null;
  const v=window.brushTipVersion||0;
  if(_tipAlphaBufVersion!==v){
    const w=tipC.width||1,h=tipC.height||1;
    const sctx=tipC.getContext('2d',{willReadFrequently:true});
    const d=sctx.getImageData(0,0,w,h).data;
    // Same legacy-mask detection as _buildTipStamp: if the source has no
    // real luminance variation (a pure alpha-channel mask, RGB≈white),
    // treat alpha alone as the mask instead of alpha*luminance.
    let maxLum=0;
    for(let p=0;p<d.length;p+=4){
      if(d[p+3]===0) continue;
      const lum=(d[p]*0.2126+d[p+1]*0.7152+d[p+2]*0.0722)/255;
      if(lum>maxLum) maxLum=lum;
    }
    const legacy=maxLum<0.01;
    const buf=new Float32Array(w*h);
    for(let i=0,p=0;p<d.length;p+=4,i++){
      const a=d[p+3]/255;
      const lum=(d[p]*0.2126+d[p+1]*0.7152+d[p+2]*0.0722)/255;
      buf[i]=legacy?a:a*lum;
    }
    _tipAlphaBuf=buf;_tipAlphaBufW=w;_tipAlphaBufH=h;_tipAlphaBufVersion=v;_tipAlphaBufLegacy=legacy;
  }
  return{data:_tipAlphaBuf,w:_tipAlphaBufW,h:_tipAlphaBufH};
}
function _sampleTipAlphaBilinear(buf,w,h,u,v){
  if(u<0||v<0||u>=w||v>=h) return 0;
  const x0=Math.floor(u),y0=Math.floor(v);
  const x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=u-x0,fy=v-y0;
  const a00=buf[y0*w+x0],a10=buf[y0*w+x1],a01=buf[y1*w+x0],a11=buf[y1*w+x1];
  const top=a00+(a10-a00)*fx, bot=a01+(a11-a01)*fx;
  return top+(bot-top)*fy;
}
function _dabTipTinyCoverage(x,y,r,rgb,alpha,composite){
  const tipInfo=_getTipAlphaBuffer();
  if(!tipInfo){_dabAATinyCoverage(x,y,r,rgb,alpha,composite);return;}
  const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;
  const rr=Math.max(0.05,r);
  const softAlpha=!!window.brushTipSoftAlpha;
  const tipMode=window.brushTipMode||'multiply';
  const baseRoundness=(typeof _activeDabRoundness!=='undefined'&&_activeDabRoundness!=null)?_activeDabRoundness:(window.brushTipRoundness==null?1:window.brushTipRoundness);
  const tipRoundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,baseRoundness));
  const tipNativeW=tipInfo.w,tipNativeH=tipInfo.h;
  const tipScale=(2*rr)/Math.max(tipNativeW,tipNativeH);
  const compressWidth=tipNativeW<tipNativeH;
  // True, unfloored float size -- this is the whole point: a dab that's
  // "really" 0.3px wide stays 0.3px wide all the way to rasterization.
  const dabW=Math.max(0.02,tipNativeW*tipScale*(compressWidth?tipRoundness:1));
  const dabH=Math.max(0.02,tipNativeH*tipScale*(compressWidth?1:tipRoundness));
  const semiW=dabW/2, semiH=dabH/2;
  const rotation=_viewAdjustedTipRotation();
  const cosR=Math.cos(-rotation), sinR=Math.sin(-rotation); // world -> tip-local
  const flipXsign=window.brushTipFlipX?-1:1, flipYsign=window.brushTipFlipY?-1:1;

  const pad=1;
  const halfSpan=Math.max(semiW,semiH)+pad;
  const sx=Math.max(0,Math.floor(x-halfSpan)),sy=Math.max(0,Math.floor(y-halfSpan));
  const ex=Math.min(dc.canvas.width,Math.ceil(x+halfSpan)),ey=Math.min(dc.canvas.height,Math.ceil(y+halfSpan));
  const width=ex-sx,height=ey-sy;
  if(width<=0||height<=0) return;
  const image=dc.getImageData(sx,sy,width,height),data=image.data;

  const aaMode=_currentAAMode();
  const applyFalloff=softAlpha&&tipMode!=='replace';
  const inner=applyFalloff?_effectiveInnerFrac(rr,brushHardness,aaMode):1;
  const samples=4,invSamples=1/(samples*samples);
  const cr=composite==='erase'?0:rgb[0],cg=composite==='erase'?0:rgb[1],cb=composite==='erase'?0:rgb[2];
  const tipBuf=tipInfo.data;

  for(let py=0;py<height;py++){
    for(let px=0;px<width;px++){
      let coverage=0;
      for(let sampleY=0;sampleY<samples;sampleY++){
        for(let sampleX=0;sampleX<samples;sampleX++){
          const wx=sx+px+(sampleX+0.5)/samples;
          const wy=sy+py+(sampleY+0.5)/samples;
          let rx=wx-x, ry=wy-y;
          if(rotation){
            const rrx=rx*cosR-ry*sinR, rry=rx*sinR+ry*cosR;
            rx=rrx; ry=rry;
          }
          rx*=flipXsign; ry*=flipYsign;
          const u=(rx/dabW+0.5)*tipNativeW;
          const v=(ry/dabH+0.5)*tipNativeH;
          const tipA=_sampleTipAlphaBilinear(tipBuf,tipNativeW,tipNativeH,u,v);
          if(tipA<=0) continue;
          if(applyFalloff){
            const t=Math.sqrt((rx/Math.max(0.02,semiW))**2+(ry/Math.max(0.02,semiH))**2);
            coverage+=tipA*_roundBrushFalloff(t,inner,brushHardness);
          } else {
            coverage+=tipA;
          }
        }
      }
      const sourceAlpha=Math.max(0,Math.min(1,alpha*coverage*invSamples));
      if(sourceAlpha<=0) continue;
      const offset=(py*width+px)*4;
      if(composite==='erase'){
        data[offset+3]*=1-sourceAlpha;
      }else{
        const destinationAlpha=data[offset+3]/255;
        const outputAlpha=sourceAlpha+destinationAlpha*(1-sourceAlpha);
        data[offset]=(cr*sourceAlpha+data[offset]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+1]=(cg*sourceAlpha+data[offset+1]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+2]=(cb*sourceAlpha+data[offset+2]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
        data[offset+3]=outputAlpha*255;
      }
    }
  }
  dc.putImageData(image,sx,sy);
}
function _dabAA(x,y,r,rgb,alpha,composite){
  // AA mode 'none' is fully pixel-snapped/binary (Requirement 2), so it uses
  // the exact same aliased/quantized stamp path as the legacy AA-off toggle
  // -- no partial-alpha edge pixels at all, regardless of hardness.
  if(_currentAAMode()==='none'){_dabAliased(x,y,r,rgb,alpha,composite);return;}
  const tinyGeneratedHardRound=r<=1&&!window._brushAirbrush&&!window.brushTipCanvas&&brushHardness>=0.995;
  if(tinyGeneratedHardRound){_dabAATinyCoverage(x,y,r,rgb,alpha,composite);return;}
  // Same cutoff (r<=1) as Hard Round above, so custom tips remain visible
  // down to approximately the same minimum size Hard Round hits, via the
  // same class of genuine supersampled-coverage rendering.
  const tinyTipDab=r<=1&&!window._brushAirbrush&&!!window.brushTipCanvas;
  if(tinyTipDab){_dabTipTinyCoverage(x,y,r,rgb,alpha,composite);return;}
  if(brushRenderer==='cpu') _dabAACpu(x,y,r,rgb,alpha,composite);
  else _dabAAGpu(x,y,r,rgb,alpha,composite);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Aliased dab: solid circle, quantised edge pixels to full on/off.
// Mirrors TVPaint Pencil and Clip Studio pixel pen behaviour exactly.
//
// PERF FIX: the old version allocated a brand-new <canvas> and called
// getImageData/putImageData on EVERY single dab (every ~12% of brush
// diameter moved, i.e. many times per pointermove). getImageData forces
// a GPUÃ¢â€ â€™CPU pixel readback; doing that dozens of times per second is
// what caused the severe lag/latency when antialiasing was OFF.
// Fix: build the quantised stamp ONCE per (size,color,alpha,composite)
// combo and cache it. Every dab after that is just ctx.drawImage of the
// cached bitmap Ã¢â‚¬â€ no readback, no allocation, same pixel-perfect result.
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
  // Snap EVERY channel to full on/off Ã¢â‚¬â€ not just alpha. The arc() fill
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
  const stamp=window.brushTipCanvas?_buildTipStamp(r,rgb,alpha,composite,brushHardness):_getAliasedStamp(r,rgb,alpha,composite);
  // drawImage() defaults to imageSmoothingEnabled=true, so even a
  // perfectly hard-edged, fully-on/off-alpha stamp gets bilinearly resampled
  // (blurred) on the way into the destination canvas. Turning smoothing OFF
  // (nearest-neighbour sampling) keeps every "on" pixel fully opaque and
  // every "off" pixel fully transparent Ã¢â‚¬â€ no blended fringe Ã¢â‚¬â€ while still
  // letting the stamp be placed at the pointer's true sub-pixel (x,y), so
  // strokes track the pointer smoothly instead of snapping to whole pixels.
  const x0=x-(stamp.w/2),y0=y-(stamp.h/2);
  dc.save();
  dc.imageSmoothingEnabled=false;
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  const adjustedRotation=window.brushTipCanvas?_viewAdjustedTipRotation():0;
  if(window.brushTipCanvas&&(adjustedRotation||window.brushTipFlipX||window.brushTipFlipY)){
    dc.translate(x,y);
    if(adjustedRotation) dc.rotate(adjustedRotation);
    if(window.brushTipFlipX||window.brushTipFlipY) dc.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
    dc.drawImage(stamp.canvas,-stamp.w/2,-stamp.h/2);
  } else dc.drawImage(stamp.canvas,x0,y0);
  dc.restore();
}

//  Tail taper (the other half of the "flick" feel)
// The head taper above can be applied the instant a dab is computed, because
// we already know how far into the stroke we are. The TAIL can't work that
// way Ã¢â‚¬â€ we don't know a stroke is ending until pointerup actually fires, by
// which point the final dabs would already be drawn at full width.
// Fix: hold back the last few dabs in a small queue instead of drawing them
// immediately (draw the OLDEST one once the queue is full, so steady-state
// drawing is only a few dabs behind the pointer Ã¢â‚¬â€ imperceptible). When the
// stroke ends, whatever's still sitting in the queue gets a tail-taper
// factor applied (shrinking toward the very last dab) before being drawn.
// Buffering by DAB COUNT rather than fixed pixels is what makes the tail
// length scale with brush size automatically: dab spacing is ~12% of the
// current diameter, so a bigger brush naturally gets a longer-looking flick
// tail and a smaller brush a shorter one Ã¢â‚¬â€ exactly like the head taper.
//  Dirty-rect tracking for recomposite()
// Every dab that actually lands on a canvas (immediate, tail-buffered, or
// airbrush-timer) passes through _drawDabNow, so this is the one place
// that can accurately accumulate "what actually changed since the last
// recomposite" without duplicating logic at every call site. The rect
// accumulates across all dabs drawn within a single animation frame, gets
// handed to recomposite() by _scheduleRecomposite below, then resets
// so each frame's recomposite only has to touch the region that changed
// THIS frame, not the whole stroke's bounding box.
let _frameDirty = null; // {minX,minY,maxX,maxY} in canvas pixel space, or null
function _growDirtyRect(x,y,radiusX,radiusY=radiusX){
  // Pad beyond the raw dab radius: AA feather can extend slightly past r,
  // and CPU-mode stamps add a couple more px of margin (see _buildAAStamp's
  // own `pad`). A little extra headroom here is cheap insurance against
  // clipping off the soft edge of a dab.
  const padX=radiusX+4,padY=radiusY+4;
  const minX=x-padX,minY=y-padY,maxX=x+padX,maxY=y+padY;
  if(!_frameDirty){
    _frameDirty = {minX,minY,maxX,maxY};
  } else {
    if(minX<_frameDirty.minX)_frameDirty.minX=minX;
    if(minY<_frameDirty.minY)_frameDirty.minY=minY;
    if(maxX>_frameDirty.maxX)_frameDirty.maxX=maxX;
    if(maxY>_frameDirty.maxY)_frameDirty.maxY=maxY;
  }
}
//  Texture dirty-rect tracking (separate accumulator/consumer from the
// recomposite dirty-rect above). Grown at the exact same call site
// (_drawDabNow) but consumed independently by the texture pass in
// _getLiveStrokePreview/_commitStrokeCanvas, since those may run on a
// different cadence than recomposite's own consumer. This lets the texture
// mask be (re)applied only over the region that actually changed since the
// texture pass last ran, instead of reprocessing the whole stroke canvas —
// the key to keeping texture real-time on fast strokes.
let _texPendingRect = null;
function _growTexDirtyRect(x,y,radiusX,radiusY=radiusX){
  const padX=radiusX+4,padY=radiusY+4;
  const minX=x-padX,minY=y-padY,maxX=x+padX,maxY=y+padY;
  if(!_texPendingRect){
    _texPendingRect={minX,minY,maxX,maxY};
  } else {
    if(minX<_texPendingRect.minX)_texPendingRect.minX=minX;
    if(minY<_texPendingRect.minY)_texPendingRect.minY=minY;
    if(maxX>_texPendingRect.maxX)_texPendingRect.maxX=maxX;
    if(maxY>_texPendingRect.maxY)_texPendingRect.maxY=maxY;
  }
}
function _consumeTexDirtyRect(){
  const r=_texPendingRect; _texPendingRect=null; return r;
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

//  Per-dab texture overlay — ALPHA-ONLY masking pipeline
//
// The texture modulates the ALPHA channel of the dab only. The brush color
// is never changed by the texture. Pipeline per dab:
//   1. Brush dab is already painted onto dc (stroke canvas or activeC).
//   2. We build a small temporary canvas covering just the dab footprint.
//   3. We fill it with the brush color at the computed dab alpha (solid flat fill).
//   4. We tile the grayscale texture mask over it using 'destination-in':
//      this multiplies each pixel's alpha by the texture's grayscale value —
//      texture-white keeps full alpha, texture-black zeroes alpha.
//   5. depth lerps between "no texture" (flat fill) and "full texture mask".
//   6. The result is blitted onto dc with source-over — color is always the
//      brush color, only coverage/alpha varies with the texture.
//
// CACHE: Two cached canvases are maintained:
//   _texCachedCanvas    — the source texture scaled to brushTextureScale.
//   _texGrayMaskCanvas  — the same canvas converted to white+alpha (grayscale
//                         luminance → alpha, RGB set to 255). Used as the
//                         destination-in mask. Rebuilt only when version/scale
//                         or invert setting changes.
//
// PERF: The hot path per dab is:
//   - One small canvas allocation (dab footprint, typically <100x100 px).
//   - One fillRect (flat color fill).
//   - One createPattern + fillRect (tile gray mask).
//   - One drawImage onto dc.
// No getImageData/putImageData on the stroke canvas; no per-dab pixel loops.
let _texCachedCanvas   = null; // scaled copy of brushTextureCanvas (for display)
let _texGrayMaskCanvas = null; // white+alpha grayscale mask, same dimensions
let _texCacheVersion   = -1;   // brushTextureVersion when caches were built
let _texCacheScale     = -1;   // brushTextureScale when caches were built
let _texCacheInvert    = null; // brushTextureInvert when caches were built
let _texCacheBrightness = null; // brushTextureBrightness when caches were built
let _texCacheContrast   = null; // brushTextureContrast when caches were built

function _getScaledTextureCanvas(){
  const texC=window.brushTextureCanvas;
  if(!texC) return null;
  const scale=typeof window.brushTextureScale==='number'?window.brushTextureScale:1.0;
  const ver=window.brushTextureVersion||0;
  const inv=!!window.brushTextureInvert;
  const brightness=typeof window.brushTextureBrightness==='number'?window.brushTextureBrightness:0;
  const contrast=typeof window.brushTextureContrast==='number'?window.brushTextureContrast:0;
  if(_texCachedCanvas && _texCacheVersion===ver && Math.abs(_texCacheScale-scale)<0.0001 && _texCacheInvert===inv
     && _texCacheBrightness===brightness && _texCacheContrast===contrast){
    return _texCachedCanvas;
  }
  // Build (or rebuild) the pre-scaled canvas and its grayscale-alpha mask.
  // This only runs when texture/scale/invert changes — never on the per-dab hot path.
  const sw=Math.max(1,Math.round(texC.width*scale));
  const sh=Math.max(1,Math.round(texC.height*scale));

  // Scaled source canvas (kept for any external use / preview).
  const c=document.createElement('canvas');
  c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(texC,0,0,sw,sh);
  _texCachedCanvas=c;

  // Grayscale-alpha mask: luminance → alpha, RGB forced to white (255,255,255).
  // This way 'destination-in' compositing only touches alpha, never color.
  //
  // Paper-grain behavior:
  //   - The texture image is treated as a "paper grain" mask.
  //   - Light texture pixels = paint is kept (high alpha).
  //   - Dark texture pixels = paint is removed (low alpha).
  //   - Raw luminance is used as-is — no automatic normalization or forced
  //     contrast curve, so mid-gray texture pixels stay mid-alpha instead of
  //     always being pushed toward solid/transparent (which was crushing
  //     edges to solid black — a "wet ink" look nobody asked for).
  //   - The Invert flag flips light/dark roles (for dark-on-light textures).
  //   - Brightness/Contrast (both default to neutral/0) are the only knobs
  //     that reshape the curve, and only when the user actually moves them.
  const gm=document.createElement('canvas');
  gm.width=sw; gm.height=sh;
  const gctx=gm.getContext('2d',{willReadFrequently:true});
  gctx.drawImage(texC,0,0,sw,sh);
  try{
    const id=gctx.getImageData(0,0,sw,sh);
    const d=id.data;
    const n=d.length;

    // Brightness: -100..100 -> shifts the luminance value by up to ±0.5,
    // same feel as Clip Studio's Brightness (opens up / closes down the grain holes).
    const brightShift = brightness/100 * 0.5;
    // Contrast: -100..100 -> a slope multiplier around the 0.5 midpoint.
    // 0 = neutral (slope 1, i.e. the raw texture, unmodified).
    const contrastSlope = Math.pow(3, contrast/100);
    for(let i=0,p=0;i<n;i+=4,p++){
      let t=(d[i]*0.2126+d[i+1]*0.7152+d[i+2]*0.0722)/255; // raw luminance, 0..1
      if(inv) t=1-t;                    // invert: dark areas keep paint
      t=t+brightShift;
      t=0.5+(t-0.5)*contrastSlope;
      t=Math.max(0,Math.min(1,t));
      // Full range [0..1]: dark grain → alpha 0 (transparent, shows canvas),
      // bright grain → alpha 255 (opaque, full paint color).
      d[i]=255; d[i+1]=255; d[i+2]=255; // white — color ignored by destination-in
      d[i+3]=Math.round(t*255);
    }
    gctx.putImageData(id,0,0);
  }catch(e){
    // Cross-origin / tainted canvas: fall back to drawing the source as-is.
    // Texture color will bleed through slightly in this edge case but it won't crash.
  }
  _texGrayMaskCanvas=gm;

  _texCacheVersion=ver;
  _texCacheScale=scale;
  _texCacheInvert=inv;
  _texCacheBrightness=brightness;
  _texCacheContrast=contrast;
  return _texCachedCanvas;
}

// Exposed so brush-presets can force a rebuild when the Scale slider moves
// without needing to re-call setBrushTexture (which would bump the version
// and needlessly clear other caches like _tipDabCache).
window._invalidateTextureCache=function(){
  _texCacheVersion=-1; _texPatternVersion=-1;
  if(typeof _resetTexturedStrokeCanvas==='function') _resetTexturedStrokeCanvas();
};

// Cached CanvasPattern for the texture mask — recreated only when the mask
// canvas changes (version/scale/invert). On the per-dab hot path this is a
// single property read + setTransform, with no canvas allocations at all.
let _texPatternCache = null;
let _texPatternVersion = -1;

function _getTexturePattern(ctx2d){
  _getScaledTextureCanvas(); // ensure _texGrayMaskCanvas is current
  if(!_texGrayMaskCanvas) return null;
  const ver = (_texCacheVersion * 1000 + Math.round(_texCacheScale * 100));
  if(_texPatternCache && _texPatternVersion === ver) return _texPatternCache;
  _texPatternCache = ctx2d.createPattern(_texGrayMaskCanvas, 'repeat');
  _texPatternVersion = ver;
  return _texPatternCache;
}

// Mask a rectangular region of `dc` in place against the cached texture
// pattern, blending by `strength`. Shared by both the rare direct-to-ctx
// path and the stroke-canvas accumulation path below. `dc` must already
// contain the painted (unmasked) pixels for the region [rx,ry,rw,rh] —
// this function only changes alpha via destination-in, never color.
function _maskRegionInPlace(dc, rx, ry, rw, rh, strength){
  const pat = _getTexturePattern(dc);
  if(!pat) return;
  // Align tiling to canvas origin (not the region origin) so the texture
  // is continuous across dabs/regions/frames instead of re-tiling from
  // whatever rect happens to be processed this time.
  pat.setTransform(new DOMMatrix());

  if(strength >= 0.999){
    dc.save();
    dc.beginPath(); dc.rect(rx, ry, rw, rh); dc.clip();
    dc.globalCompositeOperation = 'destination-in';
    dc.globalAlpha = 1;
    dc.fillStyle = pat;
    dc.fillRect(rx, ry, rw, rh);
    dc.restore();
    return;
  }

  // strength < 1: result = original*(1-strength) + masked*strength.
  // 1. Snapshot the original (unmasked) region.
  if(!_maskRegionInPlace._orig || _maskRegionInPlace._orig.width<rw || _maskRegionInPlace._orig.height<rh){
    _maskRegionInPlace._orig = document.createElement('canvas');
    _maskRegionInPlace._orig.width = Math.max(rw,64);
    _maskRegionInPlace._orig.height = Math.max(rh,64);
    _maskRegionInPlace._origCtx = _maskRegionInPlace._orig.getContext('2d');
  }
  const origCanvas = _maskRegionInPlace._orig, origCtx = _maskRegionInPlace._origCtx;
  origCtx.clearRect(0,0,rw,rh);
  origCtx.drawImage(dc.canvas, rx, ry, rw, rh, 0, 0, rw, rh);

  // 2. Build the fully-masked version of that same region in a second tmp.
  if(!_maskRegionInPlace._masked || _maskRegionInPlace._masked.width<rw || _maskRegionInPlace._masked.height<rh){
    _maskRegionInPlace._masked = document.createElement('canvas');
    _maskRegionInPlace._masked.width = Math.max(rw,64);
    _maskRegionInPlace._masked.height = Math.max(rh,64);
    _maskRegionInPlace._maskedCtx = _maskRegionInPlace._masked.getContext('2d');
  }
  const maskedCanvas = _maskRegionInPlace._masked, maskedCtx = _maskRegionInPlace._maskedCtx;
  maskedCtx.clearRect(0,0,rw,rh);
  maskedCtx.drawImage(origCanvas, 0, 0, rw, rh, 0, 0, rw, rh);
  // Re-anchor the pattern to this tmp canvas's own (0,0)-at-canvas-origin
  // coordinate space: since tmp's (0,0) corresponds to canvas (rx,ry),
  // shift the pattern by (-rx,-ry) so the grain still tiles continuously
  // with the rest of the canvas instead of restarting at (0,0).
  const patLocal = _getTexturePattern(maskedCtx);
  const m = new DOMMatrix(); m.translateSelf(-rx, -ry);
  patLocal.setTransform(m);
  maskedCtx.globalCompositeOperation = 'destination-in';
  maskedCtx.fillStyle = patLocal;
  maskedCtx.fillRect(0, 0, rw, rh);
  maskedCtx.globalCompositeOperation = 'source-over';

  // 3. Blend the unmasked and fully-masked versions by strength.
  // Drawing the original at full alpha first makes every sub-100% value look
  // almost solid because source-over preserves the opaque original underneath.
  // Instead, draw the solid copy only for the untextured remainder, then draw
  // the masked copy for the textured portion.
  dc.clearRect(rx, ry, rw, rh);
  dc.save();
  dc.globalAlpha = 1 - strength;
  dc.drawImage(origCanvas, 0, 0, rw, rh, rx, ry, rw, rh);
  dc.globalAlpha = strength;
  dc.drawImage(maskedCanvas, 0, 0, rw, rh, rx, ry, rw, rh);
  dc.globalAlpha = 1;
  dc.restore();
}

// Rare direct-to-ctx path: a paint dab landed straight on ctx with no stroke
// buffer to defer masking to (composite!=='erase' but !_inStroke). Masks
// immediately, restricted to just this dab's own footprint.
function _applyTextureToDabDirect(dc, x, y, r, alpha){
  if(!window.brushTextureEnabled) return;
  if(!window.brushTextureCanvas) return;
  const strength = typeof window.brushTextureStrength !== 'undefined' ? window.brushTextureStrength : 1.0;
  if(strength <= 0) return;
  if(r < 0.25) return;
  _getScaledTextureCanvas();
  if(!_texGrayMaskCanvas) return;
  const pad = Math.min(1, r) + 1;
  const rx = Math.floor(x - r - pad), ry = Math.floor(y - r - pad);
  const rw = Math.ceil((x + r + pad) - rx), rh = Math.ceil((y + r + pad) - ry);
  _maskRegionInPlace(dc, rx, ry, rw, rh, strength);
}

//  Stroke-canvas-level texture masking — flat single-pass stencil
//
// Texture is applied as a static grain mask over whatever the stroke's
// CURRENT alpha looks like, recomputed fresh from the live stroke canvas
// every call. This matches Clip Studio / Photoshop paper-texture behavior:
// the grain reads the same whether a pixel was touched by one dab or by
// twenty overlapping dabs (e.g. a single zigzag stroke crossing itself) —
// only actual ink buildup (Flow/Opacity, a separate and intentional control)
// changes how dark a pixel is, never the texture pass itself.
//
// An earlier revision accumulated the mask incrementally per-dab so that
// self-overlapping strokes progressively darkened toward solid black at
// every crossing/turn-around point — a deliberate TVPaint-style effect, but
// not what Clip Studio does and not what most people expect from a paper
// texture. That accumulation has been removed; brushTextureBuildup is no
// longer read here and has no effect on texture darkness.
//
// PERFORMANCE: one clearRect + drawImage + mask pass per call, over the
// full stroke-canvas bounds. Simpler and cheaper than the old delta/snapshot
// diffing, at the cost of always processing the whole canvas rather than
// just the dirty region — acceptable since stroke canvases are small.

let _texturedStrokeCanvas = null, _texturedStrokeCtx = null;

function _ensureTexHelper(w, h, existing, existingCtx){
  if(existing && existing.width === w && existing.height === h) return {c: existing, x: existingCtx};
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return {c, x: c.getContext('2d')};
}

function _getTexturedStrokeCanvas(srcCanvas, forceFull){
  // Bypass all texture masking when:
  //   • brushTextureEnabled is false (preset has Texture turned off), OR
  //   • brushTextureCanvas is null (no texture image loaded), OR
  //   • brushTextureStrength is 0 (strength slider is at minimum).
  // The enabled flag is the critical guard: a canvas may linger from a
  // previously-loaded textured preset after the user switches to a solid
  // brush (Hard Round, etc.) without an explicit clearBrushTexture() call.
  // Without this flag, those stale alpha-zero grain pixels would punch
  // transparent holes through solid strokes and corrupt Smart Raster
  // ownership by making `commitBrushMask` receive a mask with gaps.
  if(!window.brushTextureEnabled) return srcCanvas;
  if(!window.brushTextureCanvas) return srcCanvas;
  const strength = typeof window.brushTextureStrength !== 'undefined' ? window.brushTextureStrength : 1.0;
  if(strength <= 0) return srcCanvas;
  _getScaledTextureCanvas();
  if(!_texGrayMaskCanvas) return srcCanvas;

  const w = srcCanvas.width, h = srcCanvas.height;

  // Ensure output canvas.
  {const t=_ensureTexHelper(w,h,_texturedStrokeCanvas,_texturedStrokeCtx);
   _texturedStrokeCanvas=t.c; _texturedStrokeCtx=t.x;}

  const tc = _texturedStrokeCtx;
  tc.clearRect(0, 0, w, h);
  tc.globalCompositeOperation = 'source-over';
  tc.drawImage(srcCanvas, 0, 0);
  _maskRegionInPlace(tc, 0, 0, w, h, strength);

  return _texturedStrokeCanvas;
}
// Reset accumulation state at stroke start (called by _ensureStrokeCanvas
// and setBrushTexture/_invalidateTextureCache).
function _resetTexturedStrokeCanvas(){
  _texPendingRect = null;
  if(_texturedStrokeCtx && _texturedStrokeCanvas)
    _texturedStrokeCtx.clearRect(0,0,_texturedStrokeCanvas.width,_texturedStrokeCanvas.height);
}

const _TAIL_BUFFER = 3;
const _TAIL_MIN = 0.12; // how thin the very last point of a flick gets
let _pendingDabs = [];
let _autoHardRoundPrevDab=null;
// Tracks the RGB of the dab currently being drawn so _applyTextureToDabDirect can
// access it without needing an extra parameter through the call chain.
let _lastDabRGB=[0,0,0];
function _drawAutoHardRoundSegment(d){
  const eligible=d.composite==='paint'&&_usesAutoHardRoundRaster(d.r);
  if(!eligible){_autoHardRoundPrevDab=null;return false;}
  const previous=_autoHardRoundPrevDab;
  _autoHardRoundPrevDab={x:d.x,y:d.y,r:d.r,rgb:d.rgb.slice(),alpha:d.alpha};
  const dc=_inStroke?_strokeCtx:ctx;
  let x0=previous?Math.round(previous.x):Math.round(d.x);
  let y0=previous?Math.round(previous.y):Math.round(d.y);
  const x1=Math.round(d.x),y1=Math.round(d.y);
  const dx=Math.abs(x1-x0),sx=x0<x1?1:-1;
  const dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;
  let error=dx+dy,first=!!previous;
  dc.save();
  dc.globalCompositeOperation='source-over';
  dc.globalAlpha=d.alpha;
  dc.fillStyle='rgb('+d.rgb[0]+','+d.rgb[1]+','+d.rgb[2]+')';
  while(true){
    if(!first) dc.fillRect(x0,y0,1,1);
    first=false;
    if(x0===x1&&y0===y1) break;
    const twice=error*2;
    if(twice>=dy){error+=dy;x0+=sx;}
    if(twice<=dx){error+=dx;y0+=sy;}
  }
  dc.restore();
  return true;
}function _drawDabNow(d){
  _activeDabRotation=window.brushTipCanvas?(d.rotation||0):0;
  _activeDabRoundness=window.brushTipCanvas&&d.roundness!=null?d.roundness:null;
  // Track current dab color so _applyTextureToDabDirect can use it for alpha-only masking.
  _lastDabRGB=d.rgb;
  if(!_drawAutoHardRoundSegment(d)){
    if(brushAA) _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
    else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  }
  let dirtyRadiusX=d.r,dirtyRadiusY=d.r;
  if(window.brushTipCanvas){
    const tipW=window.brushTipCanvas.width||1,tipH=window.brushTipCanvas.height||1;
    const reference=Math.max(tipW,tipH);
    const roundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,_activeDabRoundness==null?(window.brushTipRoundness==null?1:window.brushTipRoundness):_activeDabRoundness));
    const compressWidth=tipW<tipH;
    const width=tipW*((d.r*2)/reference)*(compressWidth?roundness:1);
    const height=tipH*((d.r*2)/reference)*(compressWidth?1:roundness);
    const cosine=Math.abs(Math.cos(_activeDabRotation)),sine=Math.abs(Math.sin(_activeDabRotation));
    dirtyRadiusX=(width*cosine+height*sine)/2;
    dirtyRadiusY=(width*sine+height*cosine)/2;
  }
  _activeDabRotation=0;
  _activeDabRoundness=null;
  // Texture is NO LONGER masked per-dab here. Masking every dab individually
  // meant reading back the stroke canvas and re-applying the texture mask to
  // pixels that earlier, overlapping dabs had already been masked against —
  // each overlap multiplied the mask into the same pixels again, so coverage
  // decayed the more a stroke overlapped itself (the "too faint" bug), and
  // the per-dab readback/clip/redraw was the main real-time-drawing lag
  // source on fast strokes. Instead, while inside a buffered stroke we only
  // grow the texture dirty-rect here; the actual masking happens once per
  // changed region in _getLiveStrokePreview (for the live preview) and once
  // more at _commitStrokeCanvas (stroke end) — see _getTexturedStrokeCanvas.
  // Direct-to-ctx dabs (composite!=='erase' but not inside a stroke buffer,
  // a rare path with no stroke canvas to defer to) still mask immediately.
  if(window.brushTextureEnabled && window.brushTextureCanvas && d.composite!=='erase'){
    _growTexDirtyRect(d.x,d.y,dirtyRadiusX,dirtyRadiusY);
    if(!_inStroke) _applyTextureToDabDirect(ctx,d.x,d.y,d.r,d.alpha);
  }
  _growDirtyRect(d.x,d.y,dirtyRadiusX,dirtyRadiusY);
}
function _taperDistance(amount){return 320*amount;}
function _queueDab(d){
  if(!_replayingTaper&&(_getStartTaper()>0||_getEndTaper()>0)) _strokeReplayDabs.push(Object.assign({},d,{rgb:d.rgb.slice()}));
  _drawDabNow(d);
}
function _flushStrokeTail(){
  const startAmount=_getStartTaper(),endAmount=_getEndTaper();
  if((startAmount<=0&&endAmount<=0)||!_strokeReplayDabs.length){_strokeReplayDabs.length=0;_strokeReplayBase=null;return;}
  const factors=new Array(_strokeReplayDabs.length).fill(1);
  const distances=new Array(_strokeReplayDabs.length).fill(0);
  for(let i=1;i<_strokeReplayDabs.length;i++){
    const previous=_strokeReplayDabs[i-1],current=_strokeReplayDabs[i];
    distances[i]=distances[i-1]+Math.hypot(current.x-previous.x,current.y-previous.y);
  }
  const totalDistance=distances[distances.length-1];
  let startDistance=_taperDistance(startAmount),endDistance=_taperDistance(endAmount);
  const requestedDistance=startDistance+endDistance;
  if(totalDistance>0&&requestedDistance>totalDistance){
    const scale=totalDistance/requestedDistance;
    startDistance*=scale;
    endDistance*=scale;
  }
  if(totalDistance>0){
    for(let i=0;i<_strokeReplayDabs.length;i++){
      if(startDistance>0){const progress=Math.max(0,Math.min(1,distances[i]/startDistance));factors[i]=progress*progress*(3-2*progress);}
      if(endDistance>0){const progress=Math.max(0,Math.min(1,(totalDistance-distances[i])/endDistance));factors[i]=Math.min(factors[i],progress*progress*(3-2*progress));}
    }
  }
  if(tool==='eraser'){
    if(!_strokeReplayBase){_strokeReplayDabs.length=0;return;}
    ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.drawImage(_strokeReplayBase,0,0);ctx.restore();
  }else if(_strokeCtx){
    _strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
  }
  _autoHardRoundPrevDab=null;
  _replayingTaper=true;
  for(let i=0;i<_strokeReplayDabs.length;i++){
    const d=_strokeReplayDabs[i];
    _drawDabNow(Object.assign({},d,{r:Math.max(0.05,d.r*factors[i])}));
  }
  _replayingTaper=false;
  _autoHardRoundPrevDab=null;
  _strokeReplayDabs.length=0;
  _strokeReplayBase=null;
}
//  Input smoothing (TVPaint calls this "Line Smoothing")
// Raw pointer input Ã¢â‚¬â€ especially high-frequency pointerrawupdate samples on
// pen tablets, but mouse jitter too Ã¢â‚¬â€ is never perfectly straight; stamping
// dabs directly along the RAW points (as before) draws every tiny wobble in
// the input, which is what made strokes look wavy/rippled compared to
// TVPaint.
//
// v1 of this used a pure time-constant exponential moving average (EMA):
// smoothX += (rawX - smoothX) * (1 - exp(-dt/tau)). That's the "averages
// distance" feel Ã¢â‚¬â€ the smoothed point is a running average pulled toward
// wherever the pen HAS been, so on a fast flick it trails the real pen tip
// by a gap that grows with speed (a fixed TIME lag becomes a big SPATIAL
// lag once velocity goes up), and only crawls back once the pen slows down.
// It also stuttered on real pen data: pointerrawupdate delivers very
// uneven dt between coalesced samples (sub-millisecond bursts mixed with
// occasional bigger gaps), so `a` swings between "almost 0" and "almost 1"
// event to event Ã¢â‚¬â€ the smoothed point advances in uneven little jump/creep
// steps instead of a steady glide, which reads as stutter even though the
// math is technically working.
//
// v2: same gentle EMA for de-jittering slow, deliberate strokes (that part
// felt fine), but on top of it we clamp how far the smoothed point is
// allowed to trail the raw pen position Ã¢â‚¬â€ a "leash". As soon as the gap
// would exceed the leash, we pull the smoothed point back to leash-distance
// from the pen instead of continuing to let it lag proportionally to speed.
// That's the "brush catches up to the tip" feel: on a flick the tip snaps
// to just-behind-the-pen and stays there (constant small offset) rather
// than trailing further and further back, and it removes the stutter too,
// since the leash turns the uneven jump/creep steps into one consistent
// "keep pace at leash distance" motion during fast movement.
// v3: One Euro Filter (Casiez et al.) Ã¢â‚¬â€ the same class of filter most pro
// drawing/tracking apps use, chosen specifically because it has no fixed
// catch-up lag: its cutoff frequency adapts to the point's own speed every
// sample, so it barely filters at all once the pen is moving fast (stays
// glued to the raw position, no trailing gap that "catches up" later)
// while still knocking down the high-frequency micro-jitter that reads as
// wobble on slow, deliberate strokes/mouse input. Replaces the earlier
// "no smoothing at all" pass-through, which baked every raw hand-tremor
// sample straight into the stroke.
const _OEF_MINCUTOFF = 1.2;  // Hz Ã¢â‚¬â€ filtering strength at rest (higher = less smoothing)
const _OEF_BETA      = 0.02; // speed coefficient Ã¢â‚¬â€ how fast cutoff opens up as speed rises
const _OEF_DCUTOFF   = 1.0;  // Hz Ã¢â‚¬â€ cutoff for the derivative/speed estimate itself
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
  // Filter the derivative (speed) first, at a fixed low cutoff Ã¢â‚¬â€ this is
  // what lets the position cutoff react to true speed instead of raw noise.
  const rawDX=(x-_smoothX)/dt, rawDY=(y-_smoothY)/dt;
  const aD=_oefAlpha(_OEF_DCUTOFF,dt);
  _oefDX=_oefDX+aD*(rawDX-_oefDX);
  _oefDY=_oefDY+aD*(rawDY-_oefDY);
  const speed=Math.hypot(_oefDX,_oefDY);
  // Adaptive cutoff: opens up (less smoothing, tighter tracking) as speed
  // rises, so fast flicks stay glued to the pen while slow strokes get the
  // de-wobble benefit Ã¢â‚¬â€ no fixed spatial or temporal lag either way.
  const cutoff=_OEF_MINCUTOFF+_OEF_BETA*speed;
  const a=_oefAlpha(cutoff,dt);
  _smoothX=_smoothX+a*(x-_smoothX);
  _smoothY=_smoothY+a*(y-_smoothY);
  return{x:_smoothX,y:_smoothY};
}

let _rotationPrevX=0,_rotationPrevY=0,_rotationPrevValid=false,_rotationDirection=0;
function _resolveDabRotation(x,y){
  const fixed=(Number(window._tsBrushAngle)||0)*Math.PI/180;
  if(_rotationPrevValid){
    const dx=x-_rotationPrevX,dy=y-_rotationPrevY;
    if(dx||dy) _rotationDirection=Math.atan2(dy,dx);
  } else _rotationDirection=fixed;
  _rotationPrevX=x;_rotationPrevY=y;_rotationPrevValid=true;
  return window._tsRotationMode==='stroke-direction'?_rotationDirection:fixed;
}

function _stampDab(x,y,e){
  const {r,alpha}=_getEffectiveBrushParams(e);
  const isErase=tool==='eraser';
  const rgb=isErase?[0,0,0]:_hexToRGB(color);
  const composite=isErase?'erase':'paint';
  const rotation=_resolveDabRotation(x,y);
  const scatterEnabled=!!window._tsScatterEnabled;
  const count=scatterEnabled?Math.min(50,Math.max(1,Math.round(window._tsScatterCount||1))):1;
  const scatterRotation=Math.random()*Math.PI*2;
  const goldenAngle=Math.PI*(3-Math.sqrt(5));
  for(let dabIndex=0;dabIndex<count;dabIndex++){
    let dabX=x,dabY=y;
    if(scatterEnabled&&window._tsScatterAmount>0){
      if(window._tsScatterBothAxes===false){
        const perpendicularAngle=_rotationDirection+Math.PI/2;
        const distance=(Math.random()*2-1)*r*2*window._tsScatterAmount;
        dabX+=Math.cos(perpendicularAngle)*distance;
        dabY+=Math.sin(perpendicularAngle)*distance;
      } else {
        const radialSample=count===1?Math.random():(dabIndex+Math.random())/count;
        const angularJitter=(Math.random()-0.5)*(Math.PI*2/count);
        const angle=scatterRotation+dabIndex*goldenAngle+angularJitter;
        const distance=Math.sqrt(radialSample)*r*2*window._tsScatterAmount;
        dabX+=Math.cos(angle)*distance;
        dabY+=Math.sin(angle)*distance;
      }
    }
    // Shape Dynamics jitter -- resolved independently for every dab (and
    // every scattered copy within a dab) so consecutive stamps never look
    // identical. This matches Photoshop's Size/Angle/Roundness Jitter and is
    // what turns a single repeated tip stencil (e.g. one grass blade) into a
    // naturally varied cluster instead of a uniform stripe of clones.
    let dabR=r;
    const sizeJit=window.brushTipCanvas?(window.brushTipSizeJitter||0):0;
    if(sizeJit>0) dabR=Math.max(0.05,r*(1-Math.random()*sizeJit));
    let dabRotation=rotation;
    const angleJit=window.brushTipCanvas?(window.brushTipAngleJitter||0):0;
    if(angleJit>0) dabRotation+=(Math.random()*2-1)*Math.PI*angleJit;
    let dabRoundness=null;
    const roundJit=window.brushTipCanvas?(window.brushTipRoundnessJitter||0):0;
    if(roundJit>0){
      const baseR=window.brushTipRoundness==null?1:window.brushTipRoundness;
      const minR=Math.max(window.brushTipMinimumRoundness||0,baseR-roundJit*(baseR-(window.brushTipMinimumRoundness||0)));
      dabRoundness=minR+Math.random()*(baseR-minR);
    }
    _queueDab({x:dabX,y:dabY,r:dabR,alpha,rgb,composite,rotation:dabRotation,roundness:dabRoundness});
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Airbrush continuous spray (Photoshop "Airbrush" toggle / Clip Studio
// Airbrush sub tool feel)
// Every other brush here only stamps in response to pointer movement
// (_strokeSegment walks dabs along the path you actually drew). A real
// airbrush also keeps depositing paint for as long as the pen is held
// down, even dead still Ã¢â‚¬â€ that's what lets you build density in one spot
// just by holding the pen there, on top of a soft low-flow tip. This timer
// is the one thing that adds that behavior: while drawing && airbrush mode
// is on, it fires extra stamps at the last known position on its own
// clock, independent of whether pointermove ever fires again.
let _airbrushTimer=null;
let _lastPointerEvent=null;
let _airbrushTimerX=0,_airbrushTimerY=0;
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
  _airbrushTimerX=lx;
  _airbrushTimerY=ly;
  _airbrushTimer=setInterval(()=>{
    if(!drawing || !window._brushAirbrush){ _stopAirbrushSpray(); return; }
    if(lx!==_airbrushTimerX || ly!==_airbrushTimerY){
      _airbrushTimerX=lx;
      _airbrushTimerY=ly;
      return;
    }
    _stampDab(lx,ly,_lastPointerEvent);
    _scheduleRecomposite();
  }, _airbrushIntervalMs());
}
function _stopAirbrushSpray(){
  if(_airbrushTimer){ clearInterval(_airbrushTimer); _airbrushTimer=null; }
}
window._stopAirbrushSpray=_stopAirbrushSpray;

// Stamp dabs along a line segment from (ax,ay)Ã¢â€ â€™(bx,by). Step = ~12% of the
// CURRENT effective diameter (matches TVPaint's default stepval=12.5%)
// not the brush's fixed max size. Walking adaptively like this is essential
// for smooth pressure tapers: if spacing were based on max size, a thin
// (low-pressure) stretch of the stroke would have its dabs spaced as if it
// were full-size, leaving each round dab visible as a separate bump/notch
// instead of blending into a continuous taper.
// Pressure is interpolated linearly from startPressure to endPressure along
// the segment Ã¢â‚¬â€ this prevents sudden size jumps at event boundaries when
// the tablet reports large pressure changes between coalesced events.
//  Stroke-start taper (TVPaint-style natural pen tip)
// TVPaint's pen eases in from a point at the start of every stroke Ã¢â‚¬â€ this
// happens even with a mouse (constant pressure=1.0 the whole time), so it
// can't be pressure-driven; it has to be driven by distance traveled since
// the stroke began. Without this, a stroke starts at full width/opacity
// immediately, which also makes very thin base sizes (e.g. 1.2px) feel like
// "nothing happened" unless pressed hard, since there's no built-in ramp to
// carry a faint first touch into a visible line.
let _strokeDistSoFar = 0;
function _strokeTaperFactor(baseSize){
  const amount=_getStartTaper();
  if(amount<=0) return 1;
  const length=_taperDistance(amount);
  const progress=Math.max(0,Math.min(1,_strokeDistSoFar/length));
  return progress*progress*(3-2*progress);
}

// Resolve the spacing FRACTION (of effective diameter) to use for the dab
// currently being placed. This used to be duplicated inline in both
// _strokeSegment and _stampQuadCurve Ã¢â‚¬â€ centralized here so both call sites
// stay in sync. Spacing is always fixed: it never widens or narrows based
// on stroke velocity or acceleration, only on the Spacing slider (and the
// airbrush cap).
function _effectiveSpacingFrac(){
  const mode=document.getElementById('ts-spacing-mode');
  const isAuto=mode&&mode.value==='auto'&&tool==='brush'&&!window._brushAirbrush;
  // Auto mode's whole purpose (per its own UI tooltip: "automatically
  // adjusts spacing for smoother brush strokes") is to force dabs dense
  // enough that consecutive stamps blend into a continuous stroke instead
  // of reading as separate circles. It previously only ever did this for
  // the procedural hard-round brush (`!window.brushTipCanvas` excluded
  // imported tips), so a custom tip brush left on Auto silently fell back
  // to the raw manual Spacing % and kept showing visible stamp-to-stamp
  // seams -- Auto looked like it did nothing. Imported tips need this at
  // least as much as the round brush (arguably more, since their edges
  // aren't a uniform soft circle), so they now get the same tight spacing.
  if(isAuto&&!window.brushTipCanvas&&brushHardness>=0.995) return 0.01;
  if(isAuto&&window.brushTipCanvas) return 0.01;
  return (typeof window!=='undefined' && window._tsSpacing!=null) ? window._tsSpacing : 0;
}

let _hardRoundTailCoverageOnly=false;
let _flowSpacingRatio=1;
function _flowRatioForStep(step,radius){
  // Treat Flow as paint deposited per unit of travel. For source-over dabs,
  // preserving transmittance makes a group of dense low-alpha dabs match a
  // smaller group of wider-spaced dabs over the same stroke distance.
  const pressureSized=_isDrawingWithPen&&_getSizeControl()==='pressure';
  const referenceStep=Math.max(pressureSized?0.05:0.5,radius*2*0.12);
  return Math.max(0.01,Math.min(4,step/referenceStep));
}
function _usesAutoHardRoundRaster(radius){
  return false;
}
function _walkDabArc(length,pointAt,e,startPressure,endPressure){
  if(length<=0){currentPressure=endPressure;return;}
  let distance=0;
  while(distance<length){
    const sample=pointAt(distance);
    const pressure=startPressure+(endPressure-startPressure)*sample.t;
    const spacingR=_computeSpacingRadius(e,pressure);
    const step=Math.max(0.5,spacingR*2*_effectiveSpacingFrac());
    const needed=Math.max(0,step-_strokeSegCarryOver);
    const remaining=length-distance;
    if(needed>remaining){
      _strokeSegCarryOver+=remaining;
      break;
    }
    distance+=needed;
    const dab=pointAt(distance);
    currentPressure=startPressure+(endPressure-startPressure)*dab.t;
    _strokeDistSoFar+=step;
    _flowSpacingRatio=_flowRatioForStep(step,spacingR);
    try{_stampDab(dab.x,dab.y,e);}
    finally{_flowSpacingRatio=1;}
    _strokeSegCarryOver=0;
    if(needed===0&&remaining===0) break;
  }
  currentPressure=endPressure;
}
function _strokeSegment(ax,ay,bx,by,e,startPressure,endPressure){
  const sp = (startPressure !== undefined) ? startPressure : currentPressure;
  const ep = (endPressure   !== undefined) ? endPressure   : currentPressure;
  const dx=bx-ax,dy=by-ay,dist=Math.sqrt(dx*dx+dy*dy);
  _walkDabArc(dist,d=>{
    const t=dist>0?d/dist:1;
    return{x:ax+dx*t,y:ay+dy*t,t};
  },e,sp,ep);
  return;
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
    if(traveled > dist) break; // past end Ã¢â‚¬â€ save remainder as carry-over
    const t = traveled / dist;
    _strokeDistSoFar += step;
    currentPressure = sp + (ep - sp) * t;
    _stampDab(ax + dx*t, ay + dy*t, e);
  }
  _strokeSegCarryOver = Math.max(0, traveled - dist);
  currentPressure = ep;
}

//  Quadratic-curve stamping (fixes angular/wavy fast strokes)
// _strokeSegment (above) stamps a STRAIGHT LINE between two consecutive raw
// samples. At normal speed samples are dense enough that this is invisible,
// but on a fast flick Ã¢â‚¬â€ even at pointerrawupdate's ~1000Hz ceiling Ã¢â‚¬â€ the
// pen can cover a lot of distance between samples, especially through a
// curve, so straight segments chained together render as a series of
// visible angular facets ("wavy/jittery") instead of one smooth arc. This
// is a geometry problem, not a latency problem: no amount of dab-cache or
// rAF tuning fixes it, because the samples themselves are being connected
// with straight lines.
// Fix: use the standard quadratic-bezier midpoint technique (the same one
// virtually every pro drawing app uses for freehand ink) Ã¢â‚¬â€ for three
// consecutive points A,B,C, draw the curve from mid(A,B) to mid(B,C) using
// B as the control point. This turns every joint between samples into a
// smooth arc instead of a corner, using ONLY points that already exist
// (the current sample and the two before it) Ã¢â‚¬â€ no lookahead, no waiting
// for a future point, so it adds no catch-up delay. The only cost is that
// the segment actually drawn on a given sample ends at mid(B,C) rather
// than at C itself Ã¢â‚¬â€ half a sample-spacing behind the raw pen position at
// full drawing speed, i.e. sub-millisecond at 1000Hz Ã¢â‚¬â€ which is flushed to
// the real endpoint at stroke-end (see _flushCurveTail) so the line always
// still finishes exactly under the pen.
function _quadPoint(x0,y0,cx,cy,x1,y1,t){
  const mt=1-t;
  return{
    x: mt*mt*x0 + 2*mt*t*cx + t*t*x1,
    y: mt*mt*y0 + 2*mt*t*cy + t*t*y1
  };
}
// Rough arc-length estimate (control-polygon length) Ã¢â‚¬â€ good enough to pick
// a dab count; exact arc length isn't needed since dab spacing is already
// approximate/adaptive elsewhere in this engine.
function _quadArcTable(x0,y0,cx,cy,x1,y1){
  const controlLen=Math.hypot(cx-x0,cy-y0)+Math.hypot(x1-cx,y1-cy);
  const chordLen=Math.hypot(x1-x0,y1-y0);
  const divisions=Math.max(8,Math.min(256,Math.ceil(Math.max(controlLen,chordLen)/0.5)));
  const table=new Array(divisions+1);
  let prev={x:x0,y:y0},length=0;
  table[0]={t:0,x:x0,y:y0,length:0};
  for(let i=1;i<=divisions;i++){
    const t=i/divisions;
    const pt=_quadPoint(x0,y0,cx,cy,x1,y1,t);
    length+=Math.hypot(pt.x-prev.x,pt.y-prev.y);
    table[i]={t,x:pt.x,y:pt.y,length};
    prev=pt;
  }
  return table;
}
function _quadPointAtLength(table,distance){
  let lo=1,hi=table.length-1;
  while(lo<hi){
    const mid=(lo+hi)>>1;
    if(table[mid].length<distance) lo=mid+1; else hi=mid;
  }
  const b=table[lo],a=table[lo-1];
  const span=b.length-a.length;
  const f=span>0?(distance-a.length)/span:0;
  return{t:a.t+(b.t-a.t)*f,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
function _stampQuadCurve(x0,y0,cx,cy,x1,y1,e,startPressure,endPressure){
  const arcTable=_quadArcTable(x0,y0,cx,cy,x1,y1);
  const len=arcTable[arcTable.length-1].length;
  _walkDabArc(len,d=>_quadPointAtLength(arcTable,d),e,startPressure,endPressure);
  return;
  if(len<0.1){
    // BUG FIX: this used to always call _stampDab() here regardless of
    // Spacing. Heavily-smoothed slow strokes (see _smoothPoint's adaptive
    // One Euro filter Ã¢â‚¬â€ it dampens hard at low speed) constantly produce
    // curve segments under this 0.1px threshold, so a dab was stamped on
    // almost every single pointermove no matter what Spacing % was set
    // to Ã¢â‚¬â€ which is exactly why slow strokes looked continuous while fast
    // strokes (whose bigger segments actually ran the real spacing loop
    // below) showed correct gaps. We can't divide by this near-zero `len`
    // safely (that's why the early-out exists at all), so instead of
    // stamping, bank this sliver of distance into the shared carry-over
    // and only stamp once enough slivers add up to a real spacing step
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
  let traveled=-_strokeSegCarryOver;
  while(true){
    const sampleNow=_quadPointAtLength(arcTable,Math.max(0,Math.min(len,traveled)));
    const interpP = startPressure + (endPressure - startPressure) * sampleNow.t;
    const spacing = _effectiveSpacingFrac();
    const spacingR = _computeSpacingRadius(e, interpP);
    const step = Math.max(0.5, spacingR * 2 * spacing);
    traveled += step;
    if(traveled > len) break;
    const pt=_quadPointAtLength(arcTable,traveled);
    currentPressure = startPressure + (endPressure - startPressure) * pt.t;
    _strokeDistSoFar += step;
    _stampDab(pt.x, pt.y, e);
  }
  _strokeSegCarryOver = Math.max(0, traveled - len);
  currentPressure = endPressure;
}
// Rolling 3-point buffer feeding the curve above. Reset at stroke start so
// the first two segments of a stroke (before 3 real points exist) fall
// back to a straight stamp Ã¢â‚¬â€ there's no earlier geometry to curve through
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
// perceptible "still catching up" tail Ã¢â‚¬â€ this is a one-time geometric
// closeout, not an ongoing lag).
function _flushCurveTail(e){
  if(_curveP0===null||_curveP1===null) return;
  const B=_curveP1;
  const isGeneratedHardRound=tool==='brush'&&!window.brushTipCanvas&&brushHardness>=0.995;
  if(isGeneratedHardRound){
    const startPt={x:(_curveP0.x+B.x)/2,y:(_curveP0.y+B.y)/2};
    _stampQuadCurve(startPt.x,startPt.y,B.x,B.y,B.x,B.y,_lastPointerEvent||e,(_curvePr0+_curvePr1)/2,_curvePr1);
  } else {
    currentPressure=_curvePr1;
    _stampDab(B.x,B.y,_lastPointerEvent||e);
  }
  // Fill the gap between the last smoothed curve point (B) and the true
  // raw pen-up position. On a fast flick the One Euro Filter trails the
  // real pen tip by several pixels at lift time, leaving an undrawn gap
  // of disconnected dots. _strokeSegment walks dabs across that gap and
  // tapers pressure to 0 so the stroke ends in a natural point rather
  // than a blunt cut-off.
  const endPos=getPos(e);
  const gapDist=Math.hypot(endPos.x-B.x,endPos.y-B.y);
  if(gapDist>0.5){
    _strokeSegment(B.x,B.y,endPos.x,endPos.y,e,_curvePr1,0);
  }
  _strokeSegCarryOver=0;
  _curveP0=null;_curveP1=null;
}

// PERF FIX: recompositing flattens every layer/group (full-canvas
// drawImage per layer, plus mask canvases) Ã¢â‚¬â€ that's fine to do once per
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
    // painted (drawing/_inStroke). Outside of that Ã¢â‚¬â€ first frame after a
    // tool switch, undo, layer visibility change, etc. Ã¢â‚¬â€ pass no rect so
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
// The next time the pointer simply MOVES over the canvas Ã¢â‚¬â€ with no
// button pressed at all Ã¢â‚¬â€ the old mousemove handler still saw
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
//     (e.buttons & 1) on every pointermove before drawing Ã¢â‚¬â€ if it isn't
//     (e.g. the up-event was lost), stop the stroke instead of trusting
//     the old `drawing` flag blindly.
function _endStroke(){
  _stopAirbrushSpray();
  _autoHardRoundPrevDab=null;
  if(drawing){drawing=false;_flushStrokeTail();if(_inStroke){_inStroke=false;_commitStrokeCanvas();}if(tool==='eraser'&&typeof clearStyleIndexWhereTransparent==='function') clearStyleIndexWhereTransparent();saveActiveToKey();_scheduleRecomposite();}
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
    // saved key still has the real content Ã¢â‚¬â€ drawing on it now would
    // then overwrite the key with "blank + new stroke" on the next save,
    // destroying everything drawn before the tab switch. Reloading from
    // the saved key on return guarantees activeC always matches the
    // source of truth before any new stroke can touch it.
    loadFrame(curLayer,curFrame);
  }
});
window.addEventListener('blur',_endStroke);

//  Pressure tracking
// Pressure state: updated per pointer event
let currentPressure = 1.0; // 0Ã¢â‚¬â€œ1 from pen digitizer; always 1.0 for mouse
let _lastKnownPressure = 1.0; // last non-zero pressure reading (preserves pressure through coalesced gaps)
let _isDrawingWithPen = false; // true when the active stroke is from a pen/stylus

// Exponential smoothing for pressure Ã¢â‚¬â€ reduces jitter without adding lag.
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
const _MAX_PRESSURE_JUMP = 0.09; // max change allowed per raw sample Ã¢â‚¬â€ tightened from 0.15 so pressure can fall off fast enough during a flick lift without holding the dab size artificially high into the last few samples
let _strokeFirstSample = true; // true for the very first sample of a stroke (no clamping Ã¢â‚¬â€ should snap immediately)

function _getPressure(e){
  // e.pressure: 0 = pen hovering or just lifted (NOT zero pressure contact)
  //             0.5 = mouse or device with no pressure support
  //             0Ã¢â‚¬â€œ1 = real pen with pressure
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

// Stroke velocity tracking (pixels per ms) Ã¢â‚¬â€ used only by the "flick tail"
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
// once more per "peek" step in _strokeSegment/_stampQuadCurve Ã¢â‚¬â€ so a single
// fast pointermove with several coalesced samples could trigger hundreds of
// DOM lookups synchronously on the input thread. That's real, measurable
// per-dab overhead stacking up faster than frames can drain it, which is
// exactly what shows up as the pen outrunning the rendered stroke and only
// "catching up" once movement (and dab generation) stops. Fix: resolve each
// element reference once and cache it Ã¢â‚¬â€ el.value is still read fresh every
// call (so live slider changes still apply instantly), only the expensive
// getElementById traversal is removed from the hot path.
let _elSizeControl, _elFlowControl, _elOpacityControl, _elMinSize, _elMinFlow, _elTaperMode, _elStartTaper, _elEndTaper;
function _getSizeControl(){ if(_elSizeControl===undefined) _elSizeControl=document.getElementById('ts-size-control'); return _elSizeControl?_elSizeControl.value:'pressure'; }
function _getFlowControl(){ if(_elFlowControl===undefined) _elFlowControl=document.getElementById('ts-flow-control'); return _elFlowControl?_elFlowControl.value:'off'; }
function _getOpacityControl(){ if(_elOpacityControl===undefined) _elOpacityControl=document.getElementById('ts-opacity-control'); return _elOpacityControl?_elOpacityControl.value:'pressure'; }
function _getMinSize(){ if(_elMinSize===undefined) _elMinSize=document.getElementById('ts-min-size'); return _elMinSize?(+_elMinSize.value/100):0.05; }
function _getMinFlow(){ if(_elMinFlow===undefined) _elMinFlow=document.getElementById('ts-min-flow'); return _elMinFlow?(+_elMinFlow.value/100):0; }
function _getTaperMode(){ if(_elTaperMode===undefined) _elTaperMode=document.getElementById('ts-taper-mode'); return _elTaperMode?_elTaperMode.value:'off'; }
function _getStartTaper(){ if(_getTaperMode()!=='percentage') return 0; if(_elStartTaper===undefined) _elStartTaper=document.getElementById('ts-start-taper'); return _elStartTaper?(+_elStartTaper.value/100):0; }
function _getEndTaper(){ if(_getTaperMode()!=='percentage') return 0; if(_elEndTaper===undefined) _elEndTaper=document.getElementById('ts-end-taper'); return _elEndTaper?(+_elEndTaper.value/100):0; }
function _getPressureCurve(setting){ const el=document.getElementById('ts-'+setting+'-pressure-curve'); const mode=el?el.value:'linear'; if(mode==='custom'){const custom=window._tsCustomPressureCurves&&window._tsCustomPressureCurves[setting];return custom||'linear';} return mode; }

// Pressure curve Ã¢â‚¬â€ the Tool Settings panel draws a Linear/Soft/Hard/S-curve preview
// (see brush-presets.js) using these exact control points, in "plot space" where
// x = input pressure (0..1) and y is canvas-style position: y=0 is the TOP of the
// preview (= max size output) and y=1 is the BOTTOM (= min size output). Both files
// share this same table so the curve you see is exactly the curve that's applied.
//   linear Ã¢â‚¬â€ input maps straight through, no remapping.
//   soft   Ã¢â‚¬â€ reaches near-full size quickly, then flattens (more size early).
//   hard   Ã¢â‚¬â€ stays thin through most of the pressure range, only ramping up to
//            full size near max pressure. THIS is what makes thin/light-pressure
//            strokes reachable on devices whose lightest reported touch is still
//            a fairly high raw pressure value.
//   s      Ã¢â‚¬â€ gentle at both ends, steeper through the middle.
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
// search on the bezier parameter t reliably converges (curves are static
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
// Apply the user-selected pressure curve (Tool Settings Ã¢â€ â€™ Pressure Curve).
// Falls back to true linear (identity) when none is selected, so default
// behaviour for users who never touch this control is unchanged.
function _applyPressureCurve(p,curveKey='linear'){
  if(curveKey==='linear') return p;
  const pressure=Math.max(0,Math.min(1,p));
  let y;
  if(Array.isArray(curveKey)){
    let lo=0,hi=1;for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(_bezierPointAt(curveKey,mid)[0]<pressure)lo=mid;else hi=mid;}y=_bezierPointAt(curveKey,(lo+hi)/2)[1];
  } else y=_evalPressureCurveY(curveKey,pressure);
  return Math.max(0, Math.min(1, 1-y));
}

// Resolve the 0-1 influence value for a given dynamics control type.
function _resolveControl(ctrl, e){
  switch(ctrl){
    case 'pressure': {
      // Apply exponential smoothing to reduce digitizer jitter.
      _smoothedPressure = _smoothedPressure*(1-_PRESSURE_SMOOTH) + currentPressure*_PRESSURE_SMOOTH;
      // No artificial floor here Ã¢â‚¬â€ let true light pressure reach true low
      // influence; the final dab radius is still floored to a 1px-diameter
      // minimum further downstream, so the mark never fully disappears.
      return Math.max(0,Math.min(1,_smoothedPressure));
    }
    default: return 1.0; // 'off' or unknown
  }
}

// Return effective brush radius and alpha for the current dab, factoring in
// Pen Pressure when the Tool Settings panel has it selected (the only
// dynamics control supported Ã¢â‚¬â€ mouse/trackpad always have
// currentPressure===1.0, so they are unaffected).
// Pure (no side effects) so callers can "peek" at the current radius Ã¢â‚¬â€ e.g.
// to compute dab spacing.
function _computeEffectiveParams(e){
  const baseSize=getBrushSize();
  // Flow (brushFlow) controls per-dab alpha Ã¢â‚¬â€ how fast paint builds up within
  // a stroke. brushOpacity is applied at the stroke level (see _commitStrokeCanvas).
  let baseAlpha=brushFlow;
  const isPenStroke = _isDrawingWithPen;
  let r=baseSize/2;
  let alpha=baseAlpha;

  const sizeCtrl   = _getSizeControl();
  const flowCtrl   = _getFlowControl();
  const opacityCtrl= _getOpacityControl();

  // Both Size and Opacity dynamics read the SAME underlying pressure signal
  // when both are set to Pen Pressure. Resolving it independently for each
  // (two separate calls into _resolveControl, each advancing the shared
  // pressure-smoothing EMA by its own step) made Opacity settle one extra
  // EMA step further toward the live reading than Size within the very
  // same dab Ã¢â‚¬â€ a small but constant phase/lag mismatch between width and
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

  if(flowCtrl !== 'off'&&!_hardRoundTailCoverageOnly){
    const applyFlow=(flowCtrl==='pressure')?isPenStroke:true;
    if(applyFlow){
      let influence=(flowCtrl==='pressure')?_applyPressureCurve(_getPressureInfluence(),_getPressureCurve('flow')):_resolveControl(flowCtrl,e);
      if(flowCtrl==='pressure'&&sizeCtrl==='pressure'&&isPenStroke) influence=Math.sqrt(influence);
      const minFlow=_getMinFlow();
      baseAlpha*=Math.max(0,Math.min(1,minFlow+(1-minFlow)*influence));
      alpha=baseAlpha;
    }
  }

  if(_flowSpacingRatio!==1&&alpha<1){
    alpha=1-Math.pow(1-alpha,_flowSpacingRatio);
    baseAlpha=alpha;
  }

  // Size dynamics
  if(sizeCtrl !== 'off'){
    // Pressure: only auto-apply when drawing with a pen (mouse has no real pressure).
    const applySize = (sizeCtrl === 'pressure') ? isPenStroke : true;
    if(applySize){
      const influence = (sizeCtrl === 'pressure') ? _applyPressureCurve(_getPressureInfluence(),_getPressureCurve('size')) : _resolveControl(sizeCtrl, e);
      const minR = (baseSize/2) * _getMinSize();
      r = minR + (baseSize/2 - minR) * influence;
    }
  }

  // Opacity dynamics Ã¢â‚¬â€ applied per dab, in real time, exactly like Size
  // above: each dab's alpha is scaled by its own instantaneous pressure
  // reading right now, so a light touch paints light immediately and a
  // hard press paints dark immediately, live, while the stroke is still
  // being drawn. brushOpacity (the stroke-level cap) is applied separately
  // and unchanged, once, at commit time (see _commitStrokeCanvas).
  if(opacityCtrl !== 'off'&&!_hardRoundTailCoverageOnly){
    const applyOpacity = (opacityCtrl === 'pressure') ? isPenStroke : true;
    if(applyOpacity){
      const influence = (opacityCtrl === 'pressure') ? _applyPressureCurve(_getPressureInfluence(),_getPressureCurve('opacity')) : _resolveControl(opacityCtrl, e);
      alpha *= Math.max(0,Math.min(1,influence));
    }
  }

  // Absolute visibility floor: percentage-based min-size dynamics (above)
  // can shrink r to near-zero for an already-thin base brush (e.g. a 1.2px
  // brush with the default 5% min-size + light pressure could compute
  // rÃ¢â€°Ë†0.03px) Ã¢â‚¬â€ at that scale a dab is essentially invisible no matter the
  // rendering mode, forcing users to mash full pressure just to see
  // anything. Floor the PRESSURE-DRIVEN radius at 0.5px (1px diameter) so a
  // thin brush stays visibly paintable across its whole pressure range.
  // The deliberate stroke-start taper below is applied AFTER this floor and
  // is allowed to go thinner than it Ã¢â‚¬â€ that's the intentional tapered point
  // at the very tip of a stroke, not an accidental disappearance.
  // Absolute visibility floor -- LOWERED from 0.5px radius (1px diameter)
  // to 0.1px radius (0.2px diameter). The old 0.5px floor silently
  // overrode Minimum Size entirely: even with ts-min-size set to 0%, every
  // dab was still clamped up to a 1px-diameter minimum, so a light flick
  // could never taper to a true fine point (a real needle-point taper, like
  // Clip Studio/TVPaint, needs the tip to shrink to sub-pixel width before
  // antialiasing fades it out -- 1px was simply too coarse a floor for that).
  // This floor still exists purely so a dab can never render as literally
  // zero-size (which would be invisible/divide-by-zero downstream); it's
  // just set low enough now to stay out of the way of an intentional thin
  // tip instead of being the thing that defines how thin "thin" can be.
  r=Math.max(0.1,r);

  // Stroke-start taper: DISABLED per request Ã¢â‚¬â€ every dab now draws at its
  // full computed width/alpha from the very first point of the stroke, no
  // ease-in from a point. (Previously this fixed-distance ramp kept making
  // large brushes look like they were "still growing" for a big chunk of
  // any normal-length stroke Ã¢â‚¬â€ see taper history above.) _strokeTaperFactor
  // is left defined but unused, so this can be re-enabled by restoring the
  // line below if a tapered start is wanted again later.

  // Only ease ALPHA with the taper in AA mode. AA-off (pencil/pixelated)
  // mode is meant to be a flat, solid, hard-edged stamp with no partial
  // alpha anywhere Ã¢â‚¬â€ fading opacity in at the tip would put in-between
  // (non-solid) colors back in, exactly the gradient the pixelated mode is
  // supposed to avoid. In AA-off mode the taper is carried entirely by
  // width (r), same as a real pencil point narrowing rather than fading.


  // Density: scales the per-dab alpha contribution independently of
  // opacity/flow and pressure dynamics above (applied last so it works
  // together with, not instead of, those). Each dab still composites with
  // normal source-over/destination-out alpha blending (see _dabAA*/
  // _dabAliased), so lower density doesn't cap final coverage Ã¢â‚¬â€ it just
  // means more overlapping dabs/strokes are needed to reach solid paint,
  // which is what gives smooth, artifact-free accumulation rather than a
  // hard ceiling or banding.
  // Reserved for a future tip-mask density implementation. Applying it to
  // alpha here would make Density functionally identical to Flow.

  // Airbrush-only: dabs are placed ~5x more densely than a normal brush
  // (see _AIRBRUSH_SPACING_FRAC in _strokeSegment/_stampQuadCurve), so each
  // individual dab needs to be proportionally fainter to keep the overall
  // paint-buildup rate similar to before Ã¢â‚¬â€ otherwise the denser spacing
  // alone would make the airbrush deposit color much faster than its
  // Flow/Opacity settings intend. This keeps user Flow/Opacity/pressure
  // behavior fully intact (it scales the already-computed alpha, doesn't
  // replace it) and only ever applies while Airbrush mode is on.
  return{r:Math.max(0.05,r), alpha:Math.max(0.01,Math.min(1,alpha))};
}
function _getEffectiveBrushParams(e){
  const params=_computeEffectiveParams(e);
  _strokeDabCount++;
  return params;
}

// Returns the pressure-scaled radius for spacing calculations ONLY.
// Excludes taper and the visibility floor so the step size always tracks the
// actual rendered dab size Ã¢â‚¬â€ matching CSP's behaviour where spacing is always
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
      const rawInfluence = _resolveControl(sizeCtrl,e);
      const influence = sizeCtrl==='pressure' ? _applyPressureCurve(rawInfluence,_getPressureCurve('size')) : rawInfluence;
      currentPressure = savedPressure;
      _smoothedPressure = savedSmoothed;
      const minR = (baseSize / 2) * _getMinSize();
      r = minR + (baseSize / 2 - minR) * influence;
    }
  }
  if(window.brushTipCanvas && window.brushTipSpacingBasis === 'image-width'){
    const tipNativeW = window.brushTipCanvas.width || window.brushTipCanvas.naturalWidth || 1;
    const tipNativeH = window.brushTipCanvas.height || window.brushTipCanvas.naturalHeight || 1;
    const referenceDiameter = Number(window.brushTipReferenceDiameter);
    const spacingReference = Number.isFinite(referenceDiameter) && referenceDiameter > 0
      ? referenceDiameter
      : Math.max(tipNativeW, tipNativeH);
    const tipRoundness = Math.max(
      window.brushTipMinimumRoundness || 0,
      Math.min(1, window.brushTipRoundness == null ? 1 : window.brushTipRoundness)
    );
    const compressWidth = tipNativeW < tipNativeH;
    const transformedTipWidth = Math.max(
      0.1,
      tipNativeW * ((r * 2) / spacingReference) * (compressWidth ? tipRoundness : 1)
    );
    return transformedTipWidth / 2;
  }
  const isHardRoundPressure=tool==='brush'&&_isDrawingWithPen&&!window.brushTipCanvas&&brushHardness>=0.995&&sizeCtrl==='pressure';
  return Math.max(isHardRoundPressure?0.25:0.05,r);
}

// Carry-over: leftover distance from the end of each segment so the first
// dab of the next segment lands on the correct inter-dab grid.
// Resets to 0 at stroke start/end.
let _strokeSegCarryOver = 0;

//


//  Brush Tip / Texture public API
// These are the only entry points that should mutate the tip/texture state.
// They bump the version counter (invalidating caches) and clear the relevant
// stamp caches so the very next dab rebuilds with the new data.
window._setBrushTipShape=function(roundness,flipX,flipY){
  window.brushTipRoundness=Math.max(0.01,Math.min(1,Number(roundness)||1));
  window.brushTipFlipX=!!flipX;
  window.brushTipFlipY=!!flipY;
  _tipDabCache.clear();
  _stampCache.clear();
};
// Many exported tip images (including the morrowshore.com ABR-extractor's
// PNGs) are plain OPAQUE grayscale pictures — a white shape on a black
// background — with NO real transparency at all (every pixel's alpha is
// 255). The GPU stamp path (_buildTipStamp) masks purely off the ALPHA
// channel via destination-in, so a flat-alpha image like that produces no
// masking whatsoever: every dab came out as a solid filled rectangle (the
// tip's bounding box), not the tip's actual silhouette.
// Fix: whenever a newly-set tip canvas has essentially no alpha variation,
// synthesize real alpha from luminance instead — white pixels (the painted
// shape) become opaque, black pixels (background) become transparent. This
// matches the same "white = paint" convention _buildAAStamp's CPU path
// already assumes for the luminance factor, so both renderers agree, and a
// brush tip painted the intuitive way (light shape on dark background)
// stops rendering as an inverted blob / solid box.
function _normalizeTipAlpha(canvas){
  if(!canvas || !canvas.width || !canvas.height) return canvas;
  const w=canvas.width, h=canvas.height;
  const c2d=canvas.getContext('2d',{willReadFrequently:true});
  let id;
  try{ id=c2d.getImageData(0,0,w,h); }catch(e){ return canvas; } // tainted canvas (cross-origin) — leave as-is
  const d=id.data;
  let minA=255,maxA=0;
  for(let i=3;i<d.length;i+=4){ const a=d[i]; if(a<minA)minA=a; if(a>maxA)maxA=a; }
  // Real transparency already present (e.g. a proper alpha-masked tip, or
  // this function already having run on it) — leave it untouched.
  if(maxA-minA>4) return canvas;
  for(let i=0;i<d.length;i+=4){
    const lum=(d[i]+d[i+1]+d[i+2])/3;
    d[i]=d[i+1]=d[i+2]=255; // colour is irrelevant to the mask, keep it neutral
    d[i+3]=Math.round(lum);  // white shape -> opaque, black background -> transparent
  }
  c2d.putImageData(id,0,0);
  return canvas;
}
window.setBrushTip=function(canvas,referenceDiameter){
  window.brushTipCanvas=canvas?_normalizeTipAlpha(canvas):null;
  window.brushTipSpacingBasis=canvas?'image-width':'diameter';
  window.brushTipReferenceDiameter=canvas&&Number.isFinite(Number(referenceDiameter))&&Number(referenceDiameter)>0?Number(referenceDiameter):null;
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
  // Mark texture as intentionally active only when a real canvas is supplied.
  // clearBrushTexture() and preset loaders for non-textured brushes must call
  // this with null (or call clearBrushTexture) to deactivate masking.
  window.brushTextureEnabled=!!(canvas);
  window.brushTextureVersion=(window.brushTextureVersion||0)+1;
  _texCacheVersion=-1;   // force scaled-canvas rebuild on next dab
  _texPatternVersion=-1; // force pattern rebuild on next dab
  if(typeof _resetTexturedStrokeCanvas==='function') _resetTexturedStrokeCanvas();
};
window.clearBrushTexture=function(){
  window.setBrushTexture(null);
  // brushTextureEnabled is set to false inside setBrushTexture(null) above.
};

//  Pointer latency fix: touch-action
// Neither activeC nor canvasArea ever had CSS touch-action set, so every
// pen/touch pointerdown/move had to pass through the browser's built-in
// gesture-recognition delay (deciding "is this a scroll/pinch?") before
// the event even reached these listeners Ã¢â‚¬â€ a real, measurable chunk of
// perceived latency stacked on top of anything JS-side, and worst on fast
// strokes where every extra millisecond of dispatch delay widens the gap
// between the pen tip and the rendered line. preventDefault() in the
// handlers below stops the browser from ACTING on a gesture, but does
// nothing about this up-front recognition delay Ã¢â‚¬â€ only the CSS property
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
  _rotationPrevValid=false;
  _resetSmoothing(p.x,p.y,e.timeStamp||performance.now());
  _updateVelocity(p.x, p.y, e.timeStamp);
  if(tool==='fill'){pushUndo();ensureKey();floodFill(p.x,p.y,color);saveActiveToKey();recomposite(curLayer,curFrame);return;}
  if(tool==='line'){lineStart=p;return;}
  activeC.setPointerCapture(e.pointerId);
  pushUndo();ensureKey();_beginEndTaperCapture();drawing=true;lx=p.x;ly=p.y;
  _autoHardRoundPrevDab=null;
  _resetCurve(p.x,p.y,currentPressure);
  _lastPointerEvent=e;
  if(tool!=='eraser'){_ensureStrokeCanvas();_inStroke=true;}
  _stampDab(p.x,p.y,e);
  _scheduleRecomposite();
  if(window._brushAirbrush) _startAirbrushSpray();
});
// _handleMoveEvent: shared by pointermove + pointerrawupdate.
// pointerrawupdate fires at the full OS/Windows Ink sampling rate (up to 1000Hz)
// before the browser throttles events to display refresh rate Ã¢â‚¬â€ giving every
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
    // Curve (not straight-line) interpolation between samples Ã¢â‚¬â€ see
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
// pointermove for the same physical pen movement Ã¢â‚¬â€ it does not replace it.
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
    pushUndo();ensureKey();_beginEndTaperCapture();const p=getPos(e);
    if(tool!=='eraser'){_ensureStrokeCanvas();_inStroke=true;}
    // Line tool: stamp dabs along the line (respects hardness/opacity)
    _strokeSegment(lineStart.x,lineStart.y,p.x,p.y,e,currentPressure,currentPressure);
    _flushStrokeTail();
    if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
    if(tool==='eraser'&&typeof clearStyleIndexWhereTransparent==='function') clearStyleIndexWhereTransparent();lineStart=null;saveActiveToKey();recomposite(curLayer,curFrame);return;
  }
  if(drawing){drawing=false;_flushCurveTail(e);_flushStrokeTail();if(_inStroke){_inStroke=false;_commitStrokeCanvas();}if(tool==='eraser'&&typeof clearStyleIndexWhereTransparent==='function') clearStyleIndexWhereTransparent();saveActiveToKey();_scheduleRecomposite();}
}
activeC.addEventListener('pointerup',e=>{
  if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);
  _pointerEndStroke(e);
});
activeC.addEventListener('pointercancel',()=>{_endStroke();});z