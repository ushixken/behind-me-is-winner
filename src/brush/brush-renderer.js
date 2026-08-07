//
// BrushRenderer abstraction (Phase 1B — architecture refactor only)
//
// Goal of this file: separate "how a dab gets rasterized onto a Canvas2D
// context" from brush-engine.js, which remains solely responsible for
// brush LOGIC (stabilization, spacing, pressure, taper, scatter, geometry
// generation, brush-parameter computation). None of that logic lives here
// or moves here.
//
// This phase performs NO behavior change and NO WebGPU work. Every line of
// rendering code inside CpuBrushRenderer.drawDab() below is moved VERBATIM
// from brush-engine.js's _drawDabNow() — same functions, same arguments,
// same call order, same guard logic. See the Phase 1A investigation notes
// in brush-engine.js (_drawDabNow, _drawAutoHardRoundSegment, _dabAA,
// _dabAliased) for why this exact call sequence was chosen as the
// abstraction boundary: _drawDabNow is the single point every dab-producing
// code path (pointerdown's first dab, move-driven curve/segment walking,
// line/curve tools, airbrush timer ticks, taper replay) already converges
// on, and its dab descriptor `d` is already a clean, renderer-agnostic
// data structure.
//
// Interface contract:
//   BrushRenderer.drawDab(d) -> boolean
//     d: the existing dab descriptor {x,y,r,rgb,alpha,composite,rotation,roundness}
//        exactly as produced by _stampDab()/_queueDab() today — unchanged.
//     returns true if a dedicated segment-raster path (the currently-dormant
//     "auto hard round" bresenham fast path) consumed the dab instead of a
//     standalone stamp — mirrors what the inline `if(!_drawAutoHardRoundSegment(d))`
//     check in the old _drawDabNow did, so call-site control flow is
//     identical to before.
//   BrushRenderer.beginStroke() / endStroke()
//     Lifecycle no-ops for the CPU renderer in this phase. They exist so
//     _ensureStrokeCanvas()/_commitStrokeCanvas() can notify whichever
//     renderer is active without brush-engine.js needing to change again
//     when a future (Phase 2+) GPU renderer is introduced. The CPU
//     renderer's actual stroke-canvas allocation/commit logic is NOT moved
//     here — per the Phase 1B/1C/1D instructions, _ensureStrokeCanvas() and
//     _commitStrokeCanvas() keep doing exactly what they do today.
//
// ---------------------------------------------------------------------------
// Phase 1D update: the CPU rasterization implementation itself now lives
// here (moved verbatim from brush-engine.js — no logic changes, no cache
// changes, no algorithm changes). This file now owns:
//   • dab rendering:        _dabAA, _dabAliased, _dabAAGpu, _dabAACpu
//   • tiny-dab rendering:   _dabAATinyCoverage, _dabTipTinyCoverage
//                           (+ its tip-alpha-buffer helpers)
//   • stamp generation:     _buildAAStamp, _buildTipStamp,
//                           _buildSoftRoundMask, _drawSoftRoundMask,
//                           _drawUnifiedTipStamp, _drawAutoHardRoundSegment
//   • rendering caches:     _stampCache, _tipDabCache, _aaDabCache,
//                           _softRoundMaskCache (+ their MAX/eviction consts)
//   • small rendering-only helpers: _getAliasedStamp, _getTipPixelsForStamp,
//     _isStandardProceduralSoftRound, _strokeDabComposite,
//     _viewAdjustedTipRotation
//
// brush-engine.js still owns (unchanged, NOT moved):
//   • _drawDabNow (the dispatcher/orchestrator that calls BrushRenderer),
//     _stampDab, _queueDab
//   • stabilization, spacing, pressure, scatter, taper, geometry
//   • dirty-rectangle tracking (_dabDirtyRadii, _growDirtyRect, ...)
//   • color-eraser capture/filtering
//   • texture masking (_getScaledTextureCanvas, _maskRegionInPlace, ...)
//   • _ensureStrokeCanvas, _commitStrokeCanvas
//   • the shared falloff/AA-mode math: _currentAAMode, _roundBrushFalloff,
//     _proceduralBrushFalloff (+ _effectiveInnerFrac, _edgeWidthPx,
//     _airbrushFalloff, _normalizeAAMode, _quant/_quantAlpha, the
//     _AA_MODE_* tables). These are deliberately NOT renderer-owned: per
//     Phase 1C, _proceduralBrushFalloff is explicitly shared outside the
//     renderer (window._proceduralBrushFalloff is consumed by the preset
//     preview UI), so pulling the falloff family in here would wrongly
//     couple presentation code to this file. brush-renderer.js calls these
//     by bare name — safe in this codebase because every <script> in
//     index.html shares one global scope, but it IS a real dependency
//     edge: this file depends on brush-engine.js for AA-mode/falloff math,
//     not the other way around.
//
// KNOWN REMAINING COUPLING (flagged, not fixed, per Phase 1C/1D instructions):
//   _buildTipStamp(), _dabTipTinyCoverage(), and _viewAdjustedTipRotation()
//   below read `_activeDabRotation` / `_activeDabRoundness` as ambient
//   globals. Those two `let` bindings are declared and WRITTEN in
//   brush-engine.js, inside _drawDabNow(), immediately before it calls
//   BrushRenderer.drawDab(d) — i.e. brush-engine.js hands rotation/
//   roundness to this file through a side-channel global instead of
//   through the `d` parameter, even though `d.rotation`/`d.roundness`
//   already exist on the dab descriptor per the interface contract above.
//   This phase intentionally does NOT redesign that — behavior must stay
//   pixel-identical — but it's the clearest remaining architectural
//   dependency of brush-renderer.js on brush-engine.js-owned mutable state,
//   and should be threaded through the descriptor explicitly in a later
//   phase (proposed as Phase 1E in the 1C report).
//
// Only CpuBrushRenderer exists in this phase. A future GpuHardRoundRenderer
// would implement the same drawDab(d)/beginStroke()/endStroke() contract
// and be swapped in via BrushRenderer.active — nothing else in
// brush-engine.js would need to change to support that swap.

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
function _buildTipStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw,rotation,roundness,rendererContext){
  const latencyProbe=window.FirstDabLatencyProbe,latencyBuildStart=latencyProbe&&latencyProbe.enabled?performance.now():0;
  const trace=window.CustomFirstDabTrace,lookupStart=trace&&trace.enabled?performance.now():0,generationStart=lookupStart;
  const tipC=window.brushTipCanvas;
  const tipV=tipC?(window.brushTipVersion||0):-1;
  const softAlpha=!!window.brushTipSoftAlpha;
  const tipMode=window.brushTipMode||'multiply';
  // Per-dab roundness override (set by _drawDabNow from the dab's own
  // jittered roundness, see Roundness Jitter in _stampDab) takes priority
  // over the static brushTipRoundness slider so Shape Dynamics can vary the
  // squish of every individual stamp, exactly like Photoshop.
  const baseRoundness=(roundness!=null)?roundness:((typeof _activeDabRoundness!=='undefined'&&_activeDabRoundness!=null)?_activeDabRoundness:(window.brushTipRoundness==null?1:window.brushTipRoundness));
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
  if(latencyProbe&&latencyProbe.enabled)latencyProbe.cache({key,hit:!!hit,sizeBeforeLookup:_tipDabCache.size});
  if(trace&&trace.enabled){trace.stage('custom-tip-cache-lookup',lookupStart,{tipId:trace.objectId(tipC),tipVersion:tipV,invalidationReason:hit?null:(_tipAlphaInvalidationReason||'stamp-key-miss')});trace.instant('stamp-cache-lookup',{hit:!!hit,key,scaleBucket:r.toFixed(2),rotationBucket:Math.round(_viewAdjustedTipRotation(rotation,rendererContext)*180/Math.PI),roundnessBucket:tipRoundness.toFixed(3)});}
  const tipPerf=_brushPerf();if(tipPerf)tipPerf.point(hit?'tip-stamp-cache-hit':'tip-stamp-cache-miss',{key});
  if(hit){if(latencyProbe&&latencyProbe.enabled){latencyProbe.renderer('custom-stamp',{effectiveRadius:r,stampWidth:hit.w,stampHeight:hit.h});latencyProbe.measure('buildTipStamp',latencyBuildStart);}return hit;}

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
  const scaleStart=trace&&trace.enabled?performance.now():0;maskCtx.drawImage(tipC,0,0,tipNativeW,tipNativeH,(w-dabW)/2,(h-dabH)/2,dabW,dabH);
  if(trace&&trace.enabled)trace.stage('tip-scaling-resampling',scaleStart,{sourceWidth:tipNativeW,sourceHeight:tipNativeH,dabWidth:dabW,dabHeight:dabH,stampWidth:w,stampHeight:h,scaleBucket:r.toFixed(2)});
  const maskReadStart=trace&&trace.enabled?performance.now():0,maskData=maskCtx.getImageData(0,0,w,h).data;
  if(trace&&trace.enabled)trace.stage('get-image-data',maskReadStart,{source:'scaled-mask',width:w,height:h});

  let legacyAlphaOnlyMask=false;
  try{
    const sourceCtx=tipC.getContext('2d',{willReadFrequently:true});
    const sourceReadStart=performance.now();
    const sourceData=sourceCtx.getImageData(0,0,tipNativeW,tipNativeH).data;
    if(trace&&trace.enabled)trace.stage('get-image-data',sourceReadStart,{source:'tip-source',width:tipNativeW,height:tipNativeH});
    if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.record('direct-tip-source-read',{path:'_buildTipStamp',tipVersion:window.brushTipVersion||0,tipCanvasId:window.CustomTipCacheTrace.objectId(tipC,'tip-canvas'),width:tipNativeW,height:tipNativeH,getImageDataDuration:performance.now()-sourceReadStart});
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
  const outputCopyStart=trace&&trace.enabled?performance.now():0;tc.putImageData(output,0,0);
  if(trace&&trace.enabled)trace.stage('temporary-canvas-copy',outputCopyStart,{operation:'putImageData',width:w,height:h});

  const stamp={canvas:tmp,w,h};
  if(_tipDabCache.size>=_TIP_DAB_CACHE_MAX) _tipDabCache.delete(_tipDabCache.keys().next().value);
  _tipDabCache.set(key,stamp);
  if(latencyProbe&&latencyProbe.enabled){latencyProbe.renderer('custom-stamp',{effectiveRadius:r,stampWidth:w,stampHeight:h});latencyProbe.measure('buildTipStamp',latencyBuildStart);}
  if(trace&&trace.enabled)trace.stage('stamp-generation',generationStart,{key,stampWidth:w,stampHeight:h,scaleBucket:r.toFixed(2),rotationBucket:Math.round(_viewAdjustedTipRotation(rotation,rendererContext)*180/Math.PI)});
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
  const readStart=performance.now(),data=tc.getImageData(0,0,w,h).data;
  if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.record('direct-tip-source-read',{path:'_getTipPixelsForStamp',tipVersion:window.brushTipVersion||0,tipCanvasId:window.CustomTipCacheTrace.objectId(tipC,'tip-canvas'),width:w,height:h,getImageDataDuration:performance.now()-readStart});
  return data;
}
function _buildAAStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
  const r=_quant(rRaw,_Q_R), alpha=_quantAlpha(alphaRaw);
  const hardness=Math.round(Math.max(0,Math.min(1,hardnessRaw))*100)/100;
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  const aaMode=_currentAAMode();
  // Include the current tip version in the cache key so that loading a new
  // tip (or clearing it) automatically invalidates all previous CPU stamps
  // without an extra cache.clear() call. AA mode is included so switching
  // None/Weak/Medium/Strong correctly rebuilds every cached stamp instead of
  // reusing a stale edge width.
  const tipV=(window.brushTipCanvas?(window.brushTipVersion||0):-1);
  const alphaKey=alpha<=0.25?alpha.toFixed(4):alpha.toFixed(2);
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alphaKey+'|'+composite+'|'+hardness.toFixed(2)+'|'+(isAirbrush?'ab':'n')+'|tv'+tipV+'|aa'+aaMode;
  const hit=_aaDabCache.get(key);
  const aaPerf=_brushPerf();if(aaPerf)aaPerf.point(hit?'analytic-stamp-cache-hit':'analytic-stamp-cache-miss',{key});
  if(hit) return hit;
  const rr=Math.max(0.05,r);
  // Padding must cover the widest possible edge band (Strong mode can push
  // the antialiased rim up to _AA_MODE_EDGE_MAX_PX.strong px past r), or the
  // stamp bitmap would clip the soft tail and reintroduce a hard cutoff.
  const pad=Math.max(2,Math.ceil(_AA_MODE_EDGE_MAX_PX[aaMode]||2)),ir=Math.ceil(rr);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  // Procedural masks are evaluated above target resolution, then reduced
  // exactly once. The cached result is already the final 1:1 dab size, so
  // fractional placement never repeatedly rescales a coarse source mask.
  const supersample=window.brushTipCanvas?1:(rr<=64&&hardness<0.25?4:(rr<=256?2:1));
  const sampleW=w*supersample,sampleH=h*supersample;
  const sampleR=rr*supersample,cx=sampleW/2,cy=sampleH/2;
  const sampleCanvas=document.createElement('canvas');sampleCanvas.width=sampleW;sampleCanvas.height=sampleH;
  const sampleCtx=sampleCanvas.getContext('2d',{willReadFrequently:true});
  const id=sampleCtx.createImageData(sampleW,sampleH);
  const d=id.data;
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const inner=_effectiveInnerFrac(rr,hardness,aaMode);
  // Custom tips retain their existing renderer; this remains a safe fallback
  // for other callers that may request a tip-backed AA stamp directly.
  const tipPixels=_getTipPixelsForStamp(sampleW,sampleH);
  const tipSoft=!!window.brushTipSoftAlpha;
  const tipReplace=(window.brushTipMode==='replace');
  let p=0;
  for(let py=0;py<sampleH;py++){
    for(let px=0;px<sampleW;px++,p+=4){
      const dx=(px+0.5)-cx,dy=(py+0.5)-cy;
      const t=Math.sqrt(dx*dx+dy*dy)/sampleR;
      let a=alpha*_proceduralBrushFalloff(t,hardness,rr,aaMode,isAirbrush);
      if(a<=0)continue;
      if(tipPixels){
        const tipFactor=tipPixels[p+3]/255;
        if(tipReplace)a=alpha*tipFactor;
        else if(tipSoft)a*=tipFactor;
        else a=alpha*tipFactor;
        if(a<=0)continue;
      }
      d[p]=cr;d[p+1]=cg;d[p+2]=cb;d[p+3]=Math.round(Math.min(1,a)*255);
    }
  }
  sampleCtx.putImageData(id,0,0);
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d');
  tc.imageSmoothingEnabled=true;tc.imageSmoothingQuality='high';
  tc.drawImage(sampleCanvas,0,0,sampleW,sampleH,0,0,w,h);
  const stamp={canvas:tmp,w,h};
  if(_aaDabCache.size>=_AA_DAB_CACHE_MAX) _aaDabCache.delete(_aaDabCache.keys().next().value); // evict oldest
  _aaDabCache.set(key,stamp);
  return stamp;
}
// Standard Soft Round caches only its neutral shape; colour and alpha stay live.
const _softRoundMaskCache=new Map();
const _SOFT_ROUND_MASK_CACHE_MAX=64;
let _softRoundTintCanvas=null;
function _isStandardProceduralSoftRound(rendererContext){
  return rendererContext.tool==='brush' && window._activeBrushPresetId==='soft-round' && !window._brushAirbrush && !window.brushTipCanvas;
}
function _buildSoftRoundMask(rRaw,rendererContext){
  const diameter=Math.max(1,Math.round(Math.max(0.05,rRaw)*2*4)/4);
  const radius=diameter/2;
  const hardness=Math.round(Math.max(0,Math.min(1,rendererContext.brushHardness))*1000)/1000;
  const aaMode=_currentAAMode();
  const key=diameter.toFixed(2)+'|'+hardness.toFixed(3)+'|aa'+aaMode;
  const cached=_softRoundMaskCache.get(key);
  const softPerf=_brushPerf();if(softPerf)softPerf.point(cached?'soft-round-mask-cache-hit':'soft-round-mask-cache-miss',{key});
  if(cached) return cached;
  const pad=Math.max(2,Math.ceil(_AA_MODE_EDGE_MAX_PX[aaMode]||2));
  const size=Math.ceil(diameter)+pad*2+1;
  const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
  const maskContext=canvas.getContext('2d',{willReadFrequently:true});
  const image=maskContext.createImageData(size,size),pixels=image.data,center=size/2;
  const inner=_effectiveInnerFrac(radius,hardness,aaMode);
  let offset=0;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++,offset+=4){
    const dx=x+0.5-center,dy=y+0.5-center;
    const coverage=_roundBrushFalloff(Math.sqrt(dx*dx+dy*dy)/radius,inner,hardness);
    if(coverage<=0) continue;
    pixels[offset]=pixels[offset+1]=pixels[offset+2]=255;
    pixels[offset+3]=Math.round(coverage*255);
  }
  maskContext.putImageData(image,0,0);
  const stamp={canvas,w:size,h:size};
  if(_softRoundMaskCache.size>=_SOFT_ROUND_MASK_CACHE_MAX) _softRoundMaskCache.delete(_softRoundMaskCache.keys().next().value);
  _softRoundMaskCache.set(key,stamp);
  return stamp;
}
function _drawSoftRoundMask(x,y,r,rgb,alpha,composite,rendererContext){
  const stamp=_buildSoftRoundMask(r,rendererContext);
  if(!_softRoundTintCanvas) _softRoundTintCanvas=document.createElement('canvas');
  const tint=_softRoundTintCanvas;
  if(tint.width!==stamp.w||tint.height!==stamp.h){tint.width=stamp.w;tint.height=stamp.h;}
  const tc=tint.getContext('2d');
  tc.clearRect(0,0,tint.width,tint.height);
  tc.globalCompositeOperation='source-over';
  tc.fillStyle='rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
  tc.fillRect(0,0,tint.width,tint.height);
  tc.globalCompositeOperation='destination-in'; tc.drawImage(stamp.canvas,0,0);
  tc.globalCompositeOperation='source-over';
  const dc=(rendererContext.inStroke&&composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
  dc.save();
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  dc.globalAlpha=Math.max(0,Math.min(1,alpha));
  dc.imageSmoothingEnabled=rendererContext.brushHardness<0.999;
  if(dc.imageSmoothingEnabled) dc.imageSmoothingQuality='high';
  dc.drawImage(tint,x-stamp.w/2,y-stamp.h/2);
  dc.restore();
}
// Software fallback retained for internal diagnostics. Normal drawing always
// uses the Canvas 2D accelerated path below.
function _dabAATinyCoverage(x,y,r,rgb,alpha,composite,rendererContext){
  const dc=(rendererContext.inStroke&&composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
  const rr=Math.max(0.05,r),pad=1;
  const sx=Math.max(0,Math.floor(x-rr-pad)),sy=Math.max(0,Math.floor(y-rr-pad));
  const ex=Math.min(dc.canvas.width,Math.ceil(x+rr+pad)),ey=Math.min(dc.canvas.height,Math.ceil(y+rr+pad));
  const width=ex-sx,height=ey-sy;
  if(width<=0||height<=0) return;
  const image=dc.getImageData(sx,sy,width,height),data=image.data;
  const inner=_effectiveInnerFrac(rr,rendererContext.brushHardness,_currentAAMode());
  const samples=4,invSamples=1/(samples*samples);
  for(let py=0;py<height;py++){
    for(let px=0;px<width;px++){
      let coverage=0;
      for(let sampleY=0;sampleY<samples;sampleY++){
        for(let sampleX=0;sampleX<samples;sampleX++){
          const wx=sx+px+(sampleX+0.5)/samples;
          const wy=sy+py+(sampleY+0.5)/samples;
          const t=Math.hypot(wx-x,wy-y)/rr;
          coverage+=_roundBrushFalloff(t,inner,rendererContext.brushHardness);
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
let _tipAlphaBuf=null,_tipAlphaBufVersion=-1,_tipAlphaBufW=0,_tipAlphaBufH=0,_tipAlphaBufLegacy=false,_tipAlphaSeedPixels=null,_tipReadbackCanvas=null,_tipReadbackCtx=null,_tipAlphaInvalidationReason='initial-unbuilt';
function _tipAlphaFromPixels(d,w,h){
  let maxLum=0;for(let p=0;p<d.length;p+=4){if(d[p+3]===0)continue;const lum=(d[p]*.2126+d[p+1]*.7152+d[p+2]*.0722)/255;if(lum>maxLum)maxLum=lum;}
  const legacy=maxLum<.01,buf=new Float32Array(w*h);for(let i=0,p=0;p<d.length;p+=4,i++){const a=d[p+3]/255,lum=(d[p]*.2126+d[p+1]*.7152+d[p+2]*.0722)/255;buf[i]=legacy?a:a*lum;}return{buf,legacy};
}
function _getTipAlphaBuffer(){
  const alphaTrace=window.CustomFirstDabTrace,alphaLookupStart=alphaTrace&&alphaTrace.enabled?performance.now():0;
  const callStarted=performance.now(),tipC=window.brushTipCanvas;if(!tipC)return null;
  const v=window.brushTipVersion||0,w=tipC.width||1,h=tipC.height||1,trace=window.CustomTipCacheTrace,tipCanvasId=trace?trace.objectId(tipC,'tip-canvas'):null,cacheKey=v+'|'+tipCanvasId+'|'+w+'x'+h;
  const hit=_tipAlphaBufVersion===v&&_tipAlphaBufW===w&&_tipAlphaBufH===h,priorBuffer=_tipAlphaBuf,priorVersion=_tipAlphaBufVersion;let getImageDataDuration=0,alphaExtractionDuration=0,source='cached',allocated=false,resized=false;
  if(!hit){
    const perf=_brushPerf(),experiment=window.TipReadbackExperiment,totalStart=performance.now();let d;
    if(experiment&&experiment.mode==='D'&&_tipAlphaSeedPixels&&_tipAlphaSeedPixels.version===v&&_tipAlphaSeedPixels.w===w&&_tipAlphaSeedPixels.h===h){d=_tipAlphaSeedPixels.data;source='normalization-image-data';}
    else if(experiment&&experiment.mode==='B'){
      source='dedicated-readback';allocated=!_tipReadbackCanvas;if(!_tipReadbackCanvas){_tipReadbackCanvas=document.createElement('canvas');_tipReadbackCtx=_tipReadbackCanvas.getContext('2d',{willReadFrequently:true});}
      resized=_tipReadbackCanvas.width!==w||_tipReadbackCanvas.height!==h;if(resized){_tipReadbackCanvas.width=w;_tipReadbackCanvas.height=h;}
      const copyStart=performance.now();_tipReadbackCtx.clearRect(0,0,w,h);_tipReadbackCtx.drawImage(tipC,0,0);const readStart=performance.now();d=_tipReadbackCtx.getImageData(0,0,w,h).data;getImageDataDuration=performance.now()-readStart;
      if(perf){perf.measure('tip-readback-copy',copyStart,{width:w,height:h,dedicated:true});perf.recordDuration('tip-get-image-data',getImageDataDuration,{width:w,height:h,source,willReadFrequently:true});}
    }else{
      source='tip-canvas';const contextStart=performance.now(),sctx=tipC.getContext('2d',{willReadFrequently:true}),attributes=typeof sctx.getContextAttributes==='function'?sctx.getContextAttributes():null,readStart=performance.now();d=sctx.getImageData(0,0,w,h).data;getImageDataDuration=performance.now()-readStart;
      if(perf){perf.measure('tip-readback-context-access',contextStart,{width:w,height:h,requestedWillReadFrequently:true,actualWillReadFrequently:attributes&&attributes.willReadFrequently});perf.recordDuration('tip-get-image-data',getImageDataDuration,{width:w,height:h,source,requestedWillReadFrequently:true});}
    }
    const processStart=performance.now(),built=_tipAlphaFromPixels(d,w,h);alphaExtractionDuration=performance.now()-processStart;_tipAlphaBuf=built.buf;_tipAlphaBufW=w;_tipAlphaBufH=h;_tipAlphaBufVersion=v;_tipAlphaBufLegacy=built.legacy;
    if(perf){perf.recordDuration('tip-alpha-buffer-processing',alphaExtractionDuration,{width:w,height:h,pixels:w*h});perf.measure('tip-alpha-buffer-initialization',totalStart,{width:w,height:h,source,mode:experiment&&experiment.mode||'control',allocated,resized});}
    if(experiment)experiment.record('tip-alpha-buffer-initialized',{tipVersion:v,width:w,height:h,source,allocated,resized,totalDuration:performance.now()-totalStart});
  }
  const alphaBufferId=trace?trace.objectId(_tipAlphaBuf,'alpha-buffer'):null;
  if(alphaTrace&&alphaTrace.enabled)alphaTrace.stage('alpha-buffer-cache-lookup',alphaLookupStart,{hit,tipVersion:v,width:w,height:h,bufferId:alphaTrace.objectId(_tipAlphaBuf),invalidationReason:hit?null:_tipAlphaInvalidationReason,getImageDataDuration,alphaExtractionDuration});
  if(trace)trace.tipCall({tipVersion:v,cacheKey,cacheHit:hit,invalidationReason:hit?null:_tipAlphaInvalidationReason,priorTipVersion:priorVersion,priorAlphaBufferId:trace.objectId(priorBuffer,'alpha-buffer'),alphaBufferId,alphaBufferReplaced:priorBuffer!==_tipAlphaBuf,tipCanvasId,width:w,height:h,getImageDataDuration,alphaExtractionDuration,source,totalCallDuration:performance.now()-callStarted});
  if(hit&&window.TipReadbackExperiment)window.TipReadbackExperiment.cacheHit(v);else _tipAlphaInvalidationReason=null;
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
function _dabTipTinyCoverage(x,y,r,rgb,alpha,composite,rotationParam,roundnessParam,rendererContext){
  if(window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.renderer('tiny-custom-tip',{effectiveRadius:r});
  const tipInfo=_getTipAlphaBuffer();
  if(!tipInfo){_dabAATinyCoverage(x,y,r,rgb,alpha,composite,rendererContext);return;}
  const dc=(rendererContext.inStroke&&composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
  const rr=Math.max(0.05,r);
  const softAlpha=!!window.brushTipSoftAlpha;
  const tipMode=window.brushTipMode||'multiply';
  const baseRoundness=(roundnessParam!=null)?roundnessParam:((typeof _activeDabRoundness!=='undefined'&&_activeDabRoundness!=null)?_activeDabRoundness:(window.brushTipRoundness==null?1:window.brushTipRoundness));
  const tipRoundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,baseRoundness));
  const tipNativeW=tipInfo.w,tipNativeH=tipInfo.h;
  const tipScale=(2*rr)/Math.max(tipNativeW,tipNativeH);
  const compressWidth=tipNativeW<tipNativeH;
  // True, unfloored float size -- this is the whole point: a dab that's
  // "really" 0.3px wide stays 0.3px wide all the way to rasterization.
  const dabW=Math.max(0.02,tipNativeW*tipScale*(compressWidth?tipRoundness:1));
  const dabH=Math.max(0.02,tipNativeH*tipScale*(compressWidth?1:tipRoundness));
  const semiW=dabW/2, semiH=dabH/2;
  const rotation=_viewAdjustedTipRotation(rotationParam,rendererContext);
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
  const inner=applyFalloff?_effectiveInnerFrac(rr,rendererContext.brushHardness,aaMode):1;
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
            coverage+=tipA*_roundBrushFalloff(t,inner,rendererContext.brushHardness);
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
function _viewAdjustedTipRotation(rotation,rendererContext){
  const effectiveRotation=(rotation!=null)?rotation:_activeDabRotation;
  const reflected=(!!rendererContext.flipX)!=(!!rendererContext.flipY);
  return reflected?-effectiveRotation:effectiveRotation;
}
// TVPaint-style dab compositing within a stroke:
// When dabs land on the stroke scratch canvas (_inStroke=true), use 'lighten'
// instead of 'source-over'. 'lighten' takes the per-channel maximum, so a
// new dab NEVER darkens pixels already covered by an earlier dab in the same
// stroke Ã¢â‚¬â€ it only fills in uncovered/lighter areas. This matches TVPaint's
// behavior where one slow stroke builds to solid coverage without dabs
// stacking and re-darkening the same spots (which required multiple strokes).
// Eraser and direct-to-activeC paths are unaffected.
function _strokeDabComposite(composite){
  if(composite==='erase') return 'destination-out';
  return 'source-over';
}
function _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext){
  const trace=window.CustomFirstDabTrace,identityStart=trace&&trace.enabled?performance.now():0;
  const dc=(rendererContext.inStroke && composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
  if(trace&&trace.enabled)trace.stage('custom-tip-identity-lookup',identityStart,{tipId:trace.objectId(window.brushTipCanvas),tipVersion:window.brushTipVersion||0});
  const stamp=_buildTipStamp(r,rgb,alpha,composite,rendererContext.brushHardness,rotation,roundness,rendererContext);
  const transformStart=trace&&trace.enabled?performance.now():0;
  dc.save();
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  dc.imageSmoothingEnabled=true;
  dc.translate(x,y);
  const adjustedRotation=_viewAdjustedTipRotation(rotation,rendererContext);
  if(adjustedRotation) dc.rotate(adjustedRotation);
  if(window.brushTipFlipX||window.brushTipFlipY) dc.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
  if(trace&&trace.enabled)trace.stage('transformed-tip-generation',transformStart,{rotation:adjustedRotation,rotationBucket:Math.round(adjustedRotation*180/Math.PI),stampWidth:stamp.w,stampHeight:stamp.h});
  const latencyDrawStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const blendStart=trace&&trace.enabled?performance.now():0;dc.drawImage(stamp.canvas,-stamp.w/2,-stamp.h/2);
  if(window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.measure('cachedStampDrawImage',latencyDrawStart);
  if(trace&&trace.enabled)trace.stage('blend-dab-into-stroke-canvas',blendStart,{operation:'drawImage',stampWidth:stamp.w,stampHeight:stamp.h});
  dc.restore();
}
function _dabAAGpu(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext){
  if(window.brushTipCanvas){
    _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext);
    return;
  }
  // When a custom tip image is loaded, build a pre-shaped stamp (cached)
  // and blit it Ã¢â‚¬â€ no gradient is drawn. Falls back to the radial gradient
  // path below when no tip is set, preserving existing behaviour exactly.
  if(window.brushTipCanvas){
    const dc=(rendererContext.inStroke && composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
    const stamp=_buildTipStamp(r,rgb,alpha,composite,rendererContext.brushHardness,rotation,roundness,rendererContext);
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
  const dc = (rendererContext.inStroke && composite !== 'erase') ? rendererContext.strokeCtx : rendererContext.ctx;
  const rr=Math.max(0.05,r);
  const isProceduralAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush&&!window.brushTipCanvas;
  // Only procedural Airbrush uses the analytic cached mask. Ordinary round
  // brushes retain their original radial-gradient GPU renderer exactly.
  if(isProceduralAirbrush){
    const stamp=_buildAAStamp(r,rgb,alpha,composite,rendererContext.brushHardness);
    if(stamp){
      dc.save();
      dc.globalCompositeOperation=_strokeDabComposite(composite);
      dc.imageSmoothingEnabled=true;
      dc.imageSmoothingQuality='high';
      dc.drawImage(stamp.canvas,x-stamp.w/2,y-stamp.h/2);
      dc.restore();
      return;
    }
  }
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
    const inner=_effectiveInnerFrac(rr,rendererContext.brushHardness,aaMode);
    const STOPS=Math.max(8,_AA_MODE_STOPS[aaMode]||14);
    // Solid core: two anchors so the browser never interpolates across it.
    grad.addColorStop(0,`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    if(inner>0.0001){
      grad.addColorStop(Math.min(0.9999,inner),`rgba(${c0[0]},${c0[1]},${c0[2]},${alpha})`);
    }
    // Feather zone: dense stops from inner to 1.0.
    for(let i=1;i<=STOPS;i++){
      const t=inner+(1-inner)*(i/STOPS);
      const a=alpha*_roundBrushFalloff(t,inner,rendererContext.brushHardness);
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
// version, but it now matches the GPU
// renderer's stroke quality, pressure response and edge softness exactly;
// only the rasterization backend differs (hand-written per-pixel math vs.
// the browser's hardware gradient/fill).
function _dabAACpu(x,y,r,rgb,alpha,composite,rendererContext){
  if(window.brushTipCanvas){
    _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite,undefined,undefined,rendererContext);
    return;
  }
  // When a custom tip image is loaded, use the exact same pre-shaped tip
  // stamp the GPU path uses (see _dabAAGpu) instead of the plain radial
  // falloff below. Without this branch, switching to the CPU renderer
  // silently ignored brushTipCanvas entirely and always drew a procedural
  // circle, even with an ABR tip imported.
  if(window.brushTipCanvas){
    const dc0=(rendererContext.inStroke && composite!=='erase')?rendererContext.strokeCtx:rendererContext.ctx;
    const stamp=_buildTipStamp(r,rgb,alpha,composite,rendererContext.brushHardness,undefined,undefined,rendererContext);
    if(stamp){
      const x0=x-(stamp.w/2), y0=y-(stamp.h/2);
      dc0.save();
      dc0.globalCompositeOperation=_strokeDabComposite(composite);
      dc0.drawImage(stamp.canvas,x0,y0);
      dc0.restore();
      return;
    }
  }
  const dc = (rendererContext.inStroke && composite !== 'erase') ? rendererContext.strokeCtx : rendererContext.ctx;
  const rr=Math.max(0.05,r);
  const isAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush;
  const aaModeCpu=_currentAAMode();
  const inner=_effectiveInnerFrac(rr,rendererContext.brushHardness,aaModeCpu);
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
      let a=alpha*_proceduralBrushFalloff(t,rendererContext.brushHardness,rr,aaModeCpu,isAirbrush);
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
function _dabAA(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext){
  // AA mode 'none' is fully pixel-snapped/binary (Requirement 2), so it uses
  // the exact same aliased/quantized stamp path as the legacy AA-off toggle
  // -- no partial-alpha edge pixels at all, regardless of hardness.
  if(_currentAAMode()==='none'){_dabAliased(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext);return;}
  const tinyGeneratedHardRound=r<=1&&!window._brushAirbrush&&!window.brushTipCanvas&&rendererContext.brushHardness>=0.995;
  if(tinyGeneratedHardRound){_dabAATinyCoverage(x,y,r,rgb,alpha,composite,rendererContext);return;}
  // Same cutoff (r<=1) as Hard Round above, so custom tips remain visible
  // down to approximately the same minimum size Hard Round hits, via the
  // same class of genuine supersampled-coverage rendering.
  const tinyTipDab=r<=1&&!window._brushAirbrush&&!!window.brushTipCanvas;
  if(tinyTipDab){_dabTipTinyCoverage(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext);return;}
  if(_isStandardProceduralSoftRound(rendererContext)){
    _drawSoftRoundMask(x,y,r,rgb,alpha,composite,rendererContext);
    return;
  }
  _dabAAGpu(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext);
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
function _dabAliased(x,y,r,rgb,alpha,composite,rotation,roundness,rendererContext){
  const dc = (rendererContext.inStroke && composite !== 'erase') ? rendererContext.strokeCtx : rendererContext.ctx;
  const stamp=window.brushTipCanvas?_buildTipStamp(r,rgb,alpha,composite,rendererContext.brushHardness,rotation,roundness,rendererContext):_getAliasedStamp(r,rgb,alpha,composite);
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
  const adjustedRotation=window.brushTipCanvas?_viewAdjustedTipRotation(rotation,rendererContext):0;
  if(window.brushTipCanvas&&(adjustedRotation||window.brushTipFlipX||window.brushTipFlipY)){
    dc.translate(x,y);
    if(adjustedRotation) dc.rotate(adjustedRotation);
    if(window.brushTipFlipX||window.brushTipFlipY) dc.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
    const latencyDrawStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled&&window.brushTipCanvas?performance.now():0;
    dc.drawImage(stamp.canvas,-stamp.w/2,-stamp.h/2);
    if(latencyDrawStart)window.FirstDabLatencyProbe.measure('cachedStampDrawImage',latencyDrawStart);
  } else {
    const latencyDrawStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled&&window.brushTipCanvas?performance.now():0;
    dc.drawImage(stamp.canvas,x0,y0);
    if(latencyDrawStart)window.FirstDabLatencyProbe.measure('cachedStampDrawImage',latencyDrawStart);
  }
  dc.restore();
}
let _autoHardRoundPrevDab=null;
function _drawAutoHardRoundSegment(d,rendererContext){
  const eligible=d.composite==='paint'&&_usesAutoHardRoundRaster(d.r);
  if(!eligible){_autoHardRoundPrevDab=null;return false;}
  const previous=_autoHardRoundPrevDab;
  _autoHardRoundPrevDab={x:d.x,y:d.y,r:d.r,rgb:d.rgb.slice(),alpha:d.alpha};
  const dc=rendererContext.inStroke?rendererContext.strokeCtx:rendererContext.ctx;
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
}

const CpuBrushRenderer = {
  // Verbatim body of the old _drawDabNow() rasterization branch:
  //   if(!_drawAutoHardRoundSegment(d)){
  //     if(_currentAAMode()!=='none') _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  //     else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  //   }
  // _drawAutoHardRoundSegment, _dabAA, and _dabAliased are now defined
  // above, in this file (moved from brush-engine.js in Phase 1D — see the
  // file header). _currentAAMode still lives in brush-engine.js (shared
  // AA-mode/falloff math, per Phase 1C — see file header) and is reachable
  // here because brush-engine.js and this file share the same
  // classic-script global scope (no bundler/module boundary exists in this
  // codebase today).
  drawDab(d,rendererContext){
    if(_drawAutoHardRoundSegment(d,rendererContext)) return true;
    if(_currentAAMode()!=='none') _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite,d.rotation,d.roundness,rendererContext);
    else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite,d.rotation,d.roundness,rendererContext);
    return false;
  },
  // No-ops in this phase — see file header. Intentionally do nothing so
  // that wiring these calls into _ensureStrokeCanvas()/_commitStrokeCanvas()
  // cannot change observable behavior.
  beginStroke(){},
  endStroke(){},
  // Phase 6F.8: CPU readback (ctx.drawImage from activeC) is already
  // synchronous with drawing here, so there is nothing to wait on. Exists
  // purely so dispatcher-level callers (BrushRenderer.waitForGPU()) can
  // call this unconditionally on whichever renderer is active.
  async onGPUIdle(){ return true; },
  // Revised GPU integration: this renderer's authoritative drawing
  // surface is activeC itself — dabs are composited onto it directly by
  // brush-engine.js's _commitStrokeCanvas() (mid-stroke, dabs live on
  // the private _strokeCanvas scratch and _getLiveStrokePreview() is
  // used for display instead — see brush-engine.js). Mirrors
  // GpuBrushRenderer.getLayerSurface() so BrushRenderer.getActiveSurface()
  // can read either renderer through one call, without either renderer
  // needing to know about the other's storage.
  getLayerSurface(){
    if(typeof _inStroke!=='undefined'&&_inStroke&&typeof _getLiveStrokePreview==='function'){
      return _getLiveStrokePreview();
    }
    return typeof activeC!=='undefined'?activeC:null;
  },
  // CPU counterpart of GpuBrushRenderer.loadIntoLayer(): activeC already
  // IS this renderer's permanent surface, so loading a frame is a plain
  // 2D drawImage — unchanged from what brush-engine.js/panels.js did
  // directly before this pass, just reachable through the same
  // dispatcher method GPU uses.
  loadIntoLayer(source){
    if(typeof ctx==='undefined'||typeof activeC==='undefined') return false;
    ctx.clearRect(0,0,activeC.width,activeC.height);
    if(source) ctx.drawImage(source,0,0);
    return true;
  },
  // Phase 1F-B: cache ownership API. brush-engine.js previously reached
  // into this file's Map caches directly (_aaDabCache.clear(), etc.) —
  // these two methods give it an API surface instead, so the renderer's
  // cache internals stay private to this file. `which` lets a call site
  // clear only the subset of caches it used to clear directly; omitting
  // it clears everything, matching every full-clear call site that used
  // to list all four caches explicitly.
  invalidateCaches(which){
    const all=!which;
    if(all||which.aa) _aaDabCache.clear();
    if(all||which.stamp) _stampCache.clear();
    if(all||which.tip) _tipDabCache.clear();
    if(all||which.softRound) _softRoundMaskCache.clear();
  },
  getCacheStats(){
    return {
      analytic: _aaDabCache.size,
      softRound: _softRoundMaskCache.size,
      tip: _tipDabCache.size
    };
  },
  // Phase 1G-B1: renderer-owned auto hard round continuity state
  // (_autoHardRoundPrevDab). brush-engine.js previously read/wrote this
  // module-level variable directly across snapshot save/restore and
  // various reset points. These two methods give it an API surface
  // instead, so the variable stays private to this file. No cloning or
  // transformation — reference identity is preserved exactly.
  getLineContinuity(){ return _autoHardRoundPrevDab; },
  setLineContinuity(value){ _autoHardRoundPrevDab=value; },
  // Phase 1G-B2: renderer-owned tip alpha bookkeeping (_tipAlphaBuf,
  // _tipAlphaSeedPixels, _tipAlphaInvalidationReason). brush-engine.js
  // previously read/wrote these module-level variables directly from
  // window.setBrushTip. These methods give it an API surface instead, so
  // the variables stay private to this file. No cloning or transformation
  // — values/reference identity are preserved exactly.
  getTipAlphaBuffer(){ return _tipAlphaBuf; },
  setTipAlphaSeedPixels(value){ _tipAlphaSeedPixels=value; },
  setTipAlphaInvalidationReason(value){ _tipAlphaInvalidationReason=value; },
  getTipAlphaInvalidationReason(){ return _tipAlphaInvalidationReason; },
  // Phase 4N: trivial diagnostic contract member — CPU has no async
  // initialization step, so its self-test is simply "yes, available".
  // Not initialization logic, not rendering logic; purely a diagnostic
  // signal for the dispatcher's selfTestRenderer().
  selfTest(){
    return true;
  },
  // Phase 4R: no-op. CPU rendering has no initialization state to clear
  // and must not change behavior on reset.
  reset(){
    return true;
  },
  // Phase 4T: metadata only — CPU renderer is fully implemented and
  // rendering today. Does not change rendering behavior.
  getCapabilities(){
    return {
      rendering: true,
      initialized: true,
      experimental: false
    };
  },
};

// Phase 2E: Renderer interface freeze. The methods below constitute the
// frozen public contract between brush-engine.js and BrushRenderer. Any
// current or future renderer implementation (CpuBrushRenderer,
// GpuBrushRenderer, or others registered later) must implement every
// method in this contract with matching signatures. No new methods should
// be added to this contract without a corresponding phase; no existing
// method should change signature or meaning.
//
//   drawDab(d, rendererContext)
//     Renders a single dab descriptor `d` (x, y, r, rgb, alpha, composite,
//     rotation, roundness, ...) using ambient rendering surfaces and view
//     state carried in `rendererContext` (ctx, strokeCtx, inStroke, flipX,
//     flipY, tool, brushHardness — see Phase 1G-A). Return value is a
//     boolean: true if the auto-hard-round continuity path handled the
//     dab (segment already drawn), false if the caller's normal AA/aliased
//     path was used instead.
//
//   beginStroke()
//     Called when a paint stroke starts. No return value. May be a no-op
//     (CPU renderer: intentionally always a no-op — see Phase 1D header).
//
//   endStroke()
//     Called when a paint stroke ends/commits. No return value. May be a
//     no-op, same as beginStroke().
//
//   invalidateCaches(which)
//     Clears renderer-internal dab/stamp caches. `which` is an optional
//     object of boolean flags ({aa, stamp, tip, softRound}) selecting a
//     subset to clear; omitting it clears everything. No return value.
//
//   getCacheStats()
//     Returns a snapshot object { analytic, softRound, tip } describing
//     current cache sizes, for diagnostics only. Read-only, no side
//     effects.
//
//   getLineContinuity()
//     Returns the renderer's current auto-hard-round continuity value
//     (an opaque {x,y,r,rgb,alpha} object, or null if no continuous
//     segment is in progress). Reference identity is preserved — callers
//     must not assume a particular shape beyond "opaque or null".
//
//   setLineContinuity(value)
//     Overwrites the renderer's auto-hard-round continuity value (used by
//     brush-engine.js's undo/pointercancel snapshot restore and stroke/
//     tool reset points). No return value.
//
//   getTipAlphaBuffer()
//     Returns the renderer's current cached tip-alpha buffer (opaque
//     Float32Array, or null if unbuilt), for diagnostics/trace use only.
//
//   setTipAlphaSeedPixels(value)
//     Overwrites the renderer's tip-alpha seed-pixels bookkeeping (opaque
//     {data,w,h,version} object, or null). Used by window.setBrushTip when
//     a new tip is imported. No return value.
//
//   setTipAlphaInvalidationReason(value)
//     Overwrites the renderer's recorded reason string for the next tip-
//     alpha cache rebuild (used for diagnostics/tracing). No return value.
//
//   getTipAlphaInvalidationReason()
//     Returns the currently recorded tip-alpha invalidation reason
//     (string or null).
//
//   registerRenderer(name, renderer)
//     Registers a renderer implementation object under a string `name` in
//     the internal registry. Does not activate it. No return value.
//
//   setActiveRenderer(name)
//     Activates a previously-registered renderer by name; all dispatch
//     methods above will forward to it from this point on. Throws if
//     `name` was never registered. No return value.
//
//   getActiveRenderer()
//     Returns the string name of the currently active renderer (e.g.
//     'cpu'), or null if none has been activated yet.
//
// Phase 2A: BrushRenderer is a thin dispatcher only. Every method simply
// forwards to the active renderer implementation (CpuBrushRenderer today);
// no renderer logic or state access lives here directly. This is the
// stable interface brush-engine.js (and any future renderer swap) code
// against.
//
// Phase 2B: renderer selection is now a generic name -> implementation
// registry instead of a hardcoded `active: CpuBrushRenderer` field.
// registerRenderer()/setActiveRenderer()/getActiveRenderer() are the only
// additions in this phase; every dispatch method below is unchanged in
// behavior — they still simply forward to whichever implementation is
// currently active, which remains CpuBrushRenderer.
const BrushRenderer = {
  _renderers: {},
  _activeName: null,
  _preferredName: 'cpu',
  _preferenceListeners: [],
  active: null,
  // Phase 5J: frame-integration diagnostics — plain counter/timestamp
  // only, owned by the dispatcher itself (not _gpuState), since
  // withFrame() is a dispatcher-level convenience and applies
  // regardless of which renderer is active.
  _wrappedFrames: 0,
  _lastWrapTime: null,
  // Phase 5K: stroke-frame-wrapper diagnostics — plain counter/
  // timestamp only, separate from the Phase 5J generic frame-wrap
  // counters since withStrokeFrame() is specifically for batched
  // stroke operations.
  _wrappedStrokes: 0,
  _lastStrokeFrameTime: null,
  // Phase 4O: startup diagnostics only. These record the outcome of the
  // most recent applyPreferredRenderer() call (result, failure reason,
  // and timestamp) purely for status reporting — no GPU resources
  // (adapter/device/queue/pipeline/etc.) are ever stored here.
  _lastApplyResult: null,
  _lastApplyError: null,
  _lastApplyTime: null,
  // Phase 4Q: bounded history of applyPreferredRenderer() attempts.
  // Diagnostics only — newest-10 records, no GPU resources stored.
  _applyHistory: [],
  // Phase 4S: lifecycle state per registered renderer name. Diagnostics
  // only — never hardcoded to "cpu"/"gpu"; built/updated dynamically as
  // renderers are activated/reset.
  _rendererStates: {},
  // Phase 4S: internal helper to set a renderer's lifecycle record.
  // Diagnostics only — does not affect activation/registration.
  _setRendererState(name,state,error){
    this._rendererStates[name]={
      state,
      updatedAt: Date.now(),
      error: error||null
    };
  },
  // Registers a renderer implementation under `name`. Does not activate it.
  registerRenderer(name,renderer){
    this._renderers[name]=renderer;
  },
  // Switches the active renderer to a previously-registered name.
  setActiveRenderer(name){
    const renderer=this._renderers[name];
    if(!renderer) throw new Error('BrushRenderer: no renderer registered under "'+name+'"');
    this._activeName=name;
    this.active=renderer;
    // Architecture fix (GPU-integration pass): renderer switching no
    // longer swaps which on-screen canvas is visible. activeC is the
    // single logical drawing surface for every renderer — gpu-canvas is
    // now a private, always-hidden scratch surface owned by
    // GpuBrushRenderer (see getStrokeCanvas()/_clearAccumTexture()
    // above and brush-engine.js's _commitGpuStroke()), the same role
    // _strokeCanvas plays for CpuBrushRenderer. There is nothing left
    // to toggle here.
  },
  getActiveRenderer(){
    return this._activeName;
  },
  drawDab(d,rendererContext){ return this.active.drawDab(d,rendererContext); },
  beginStroke(){ return this.active.beginStroke(); },
  endStroke(){ return this.active.endStroke(); },
  // Phase 6F.8: the single choke point CPU-readback call sites should
  // await before reading the active renderer's surface (getActiveSurface())
  // into a 2D canvas/undo snapshot/etc. Forwards to whichever renderer is
  // active's onGPUIdle() — GpuBrushRenderer's genuinely waits on
  // device.queue.onSubmittedWorkDone(); CpuBrushRenderer's resolves
  // immediately since its surface is already CPU-side. Callers that
  // can't be made async yet are unaffected — this is purely additive.
  async waitForGPU(){
    if(this.active && typeof this.active.onGPUIdle==='function'){
      return this.active.onGPUIdle();
    }
    return true;
  },
  // Revised GPU integration: the single choke point every downstream
  // consumer (recomposite, saveActiveToKey/undo-history, export,
  // sampling, transforms, ...) should call instead of reading the
  // module-level `activeC` directly. Forwards to whichever renderer is
  // active's getLayerSurface() — CpuBrushRenderer's returns activeC (or
  // the live stroke preview mid-stroke); GpuBrushRenderer's returns its
  // own persistent, GPU-owned canvas. Falls back to activeC only if no
  // renderer is active yet (startup) or the active renderer doesn't
  // implement getLayerSurface(), so existing single-renderer code paths
  // are never left without a surface.
  getActiveSurface(){
    if(this.active && typeof this.active.getLayerSurface==='function'){
      const surface=this.active.getLayerSurface();
      if(surface) return surface;
    }
    return typeof activeC!=='undefined'?activeC:null;
  },
  // Revised GPU integration: loads `source` (a plain 2D
  // canvas/image/null) into the active renderer's own surface —
  // CpuBrushRenderer draws it onto activeC via 2D drawImage;
  // GpuBrushRenderer uploads it onto layerTexture via
  // copyExternalImageToTexture. Used by frame/layer/undo loading (see
  // panels.js's loadFrame()) so switching artwork populates whichever
  // renderer is currently active instead of assuming CPU/activeC.
  loadActiveSurface(source){
    if(this.active && typeof this.active.loadIntoLayer==='function'){
      return this.active.loadIntoLayer(source);
    }
    return false;
  },
  // Phase 5G: dispatcher-level flush support. Forwards to the active
  // renderer's flushPendingDabs() if it implements one (GpuBrushRenderer
  // does, as of Phase 5G; CpuBrushRenderer does not, and is left
  // completely unmodified). Not renderer-switching or fallback logic —
  // it never changes `this.active`, it just optionally calls a method
  // on whichever renderer is already active. A renderer with nothing
  // to flush (no flushPendingDabs method, e.g. CPU) is treated as an
  // automatic no-op success, since "nothing queued to flush" and
  // "flushed nothing successfully" are the same observable outcome.
  flushActiveRenderer(){
    if(this.active && typeof this.active.flushPendingDabs==='function'){
      return this.active.flushPendingDabs();
    }
    return true;
  },
  // Phase 5H: dispatcher-level manual flush support — mirrors
  // flushActiveRenderer() above, but forwards to manualFlush() so the
  // resulting flush metadata is explicitly tagged reason:'manual'
  // rather than being conflated with a per-frame/stroke-end flush.
  // Never reassigns `this.active` — no renderer switching/fallback.
  // A renderer with no manualFlush() (e.g. CPU) is a no-op success.
  manualFlushActiveRenderer(){
    if(this.active && typeof this.active.manualFlush==='function'){
      return this.active.manualFlush();
    }
    return true;
  },
  // Phase 5O: dispatcher-level renderer-present notification. Pure
  // forwarder — calls the active renderer's presentFrame() only if it
  // implements one (GpuBrushRenderer does, as of Phase 5O;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind —
  // a renderer with no presentFrame() is a no-op success.
  presentActiveRenderer(){
    if(this.active && typeof this.active.presentFrame==='function'){
      return this.active.presentFrame();
    }
    return true;
  },
  // Phase 5P: dispatcher-level renderer-idle notification. Pure
  // forwarder — calls the active renderer's rendererIdle() only if it
  // implements one (GpuBrushRenderer does, as of Phase 5P;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind —
  // a renderer with no rendererIdle() is a no-op success.
  notifyRendererIdle(){
    if(this.active && typeof this.active.rendererIdle==='function'){
      return this.active.rendererIdle();
    }
    return true;
  },
  // Phase 5Q: dispatcher-level renderer-session diagnostics accessor.
  // Pure forwarder — calls the active renderer's
  // getSessionDiagnostics() only if it implements one (GpuBrushRenderer
  // does, as of Phase 5Q; CpuBrushRenderer does not and is left
  // unmodified), and never reassigns `this.active`. No
  // setActiveRenderer()/activateRenderer()/applyPreferredRenderer()
  // call, no renderer switching of any kind. Returns null (not true)
  // when unavailable, since this is a diagnostics accessor, not a
  // fire-and-forget notification.
  getRendererSessionDiagnostics(){
    if(this.active && typeof this.active.getSessionDiagnostics==='function'){
      return this.active.getSessionDiagnostics();
    }
    return null;
  },
  // Phase 5R: dispatcher-level renderer-performance diagnostics
  // accessor. Pure forwarder — calls the active renderer's
  // getPerformanceDiagnostics() only if it implements one
  // (GpuBrushRenderer does, as of Phase 5R; CpuBrushRenderer does not
  // and is left unmodified), and never reassigns `this.active`. No
  // setActiveRenderer()/activateRenderer()/applyPreferredRenderer()
  // call, no renderer switching of any kind. Returns null when
  // unavailable, matching getRendererSessionDiagnostics() above.
  getRendererPerformanceDiagnostics(){
    if(this.active && typeof this.active.getPerformanceDiagnostics==='function'){
      return this.active.getPerformanceDiagnostics();
    }
    return null;
  },
  // Phase 5S: dispatcher-level renderer memory diagnostics accessor.
  // Pure forwarder — calls the active renderer's getMemoryDiagnostics()
  // only if it implements one (GpuBrushRenderer does, as of Phase 5S;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind.
  // Returns null when unavailable, matching the other diagnostics
  // forwarders above.
  getRendererMemoryDiagnostics(){
    if(this.active && typeof this.active.getMemoryDiagnostics==='function'){
      return this.active.getMemoryDiagnostics();
    }
    return null;
  },
  // Phase 5T: dispatcher-level renderer error diagnostics accessor.
  // Pure forwarder — calls the active renderer's getErrorDiagnostics()
  // only if it implements one (GpuBrushRenderer does, as of Phase 5T;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind.
  // Returns null when unavailable, matching the other diagnostics
  // forwarders above.
  getRendererErrorDiagnostics(){
    if(this.active && typeof this.active.getErrorDiagnostics==='function'){
      return this.active.getErrorDiagnostics();
    }
    return null;
  },
  // Phase 5U: dispatcher-level combined diagnostics export accessor.
  // Pure forwarder — calls the active renderer's exportDiagnostics()
  // only if it implements one (GpuBrushRenderer does, as of Phase 5U;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind.
  // Returns null when unavailable, matching the other diagnostics
  // forwarders above. This is the single implementation of this method.
  exportRendererDiagnostics(){
    if(this.active && typeof this.active.exportDiagnostics==='function'){
      return this.active.exportDiagnostics();
    }
    return null;
  },
  // Phase 5I: dispatcher-level frame lifecycle forwarding. Pure
  // forwarders — each calls the corresponding method on the active
  // renderer only if it implements one (GpuBrushRenderer does;
  // CpuBrushRenderer does not and is left unmodified), and never
  // reassigns `this.active`. No setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() call, no renderer switching of any kind —
  // a renderer with no beginFrame()/endFrame() is a no-op success.
  beginFrame(){
    if(this.active && typeof this.active.beginFrame==='function'){
      return this.active.beginFrame();
    }
    return true;
  },
  endFrame(){
    if(this.active && typeof this.active.endFrame==='function'){
      return this.active.endFrame();
    }
    return true;
  },
  // Phase 5J: lightweight frame integration helper. Calls this.beginFrame()
  // (itself a pure forwarder — see above, safely a no-op if the active
  // renderer doesn't implement frame lifecycle methods), runs the
  // callback, then calls this.endFrame() in a finally block so the
  // frame is always closed out even if the callback throws, and
  // returns the callback's own result. Does not switch renderers — no
  // setActiveRenderer()/activateRenderer()/applyPreferredRenderer()
  // call anywhere in this method. Increments the dispatcher-level
  // wrappedFrames counter and records lastWrapTime regardless of
  // whether the active renderer actually supports beginFrame/endFrame,
  // since "a frame was wrapped" is true either way.
  withFrame(callback){
    this.beginFrame();
    try{
      return (typeof callback==='function')?callback():undefined;
    }finally{
      this.endFrame();
      this._wrappedFrames+=1;
      this._lastWrapTime=Date.now();
    }
  },
  // Phase 5J: read-only frame-integration diagnostics. Exposes only
  // plain numbers/timestamps — never _gpuState or any adapter/device/
  // queue/pipeline/shader/buffer/texture/context object.
  getFrameIntegrationDiagnostics(){
    return {
      wrappedFrames: this._wrappedFrames,
      lastWrapTime: this._lastWrapTime
    };
  },
  // Phase 5K: dispatcher helper for batched brush/stroke operations.
  // Begins a renderer frame (this.beginFrame() — the existing pure
  // forwarder from Phase 5I, unchanged), runs the stroke callback, and
  // always ends the frame via a finally block (this.endFrame(), also
  // unchanged) so the frame is closed out even if the callback throws.
  // Returns the callback's own result. Does not call
  // setActiveRenderer()/activateRenderer()/applyPreferredRenderer() —
  // it never switches, initializes, or activates any renderer; it only
  // forwards to the already-active one via beginFrame()/endFrame().
  withStrokeFrame(callback){
    this.beginFrame();
    try{
      return (typeof callback==='function')?callback():undefined;
    }finally{
      this.endFrame();
      this._wrappedStrokes+=1;
      this._lastStrokeFrameTime=Date.now();
    }
  },
  // Phase 5K: read-only stroke-frame diagnostics. Exposes only plain
  // numbers/timestamps — never _gpuState or any adapter/device/queue/
  // pipeline/shader/buffer/texture/context object.
  getStrokeFrameDiagnostics(){
    return {
      wrappedStrokes: this._wrappedStrokes,
      lastStrokeFrameTime: this._lastStrokeFrameTime
    };
  },
  invalidateCaches(which){ return this.active.invalidateCaches(which); },
  getCacheStats(){ return this.active.getCacheStats(); },
  getLineContinuity(){ return this.active.getLineContinuity(); },
  setLineContinuity(value){ return this.active.setLineContinuity(value); },
  getTipAlphaBuffer(){ return this.active.getTipAlphaBuffer(); },
  setTipAlphaSeedPixels(value){ return this.active.setTipAlphaSeedPixels(value); },
  setTipAlphaInvalidationReason(value){ return this.active.setTipAlphaInvalidationReason(value); },
  getTipAlphaInvalidationReason(){ return this.active.getTipAlphaInvalidationReason(); },
  // Phase 4A: safe public API for switching renderers. Unlike
  // setActiveRenderer() (the low-level setter, unchanged above), this
  // validates the name is registered, no-ops if it's already active,
  // and — if the target renderer exposes an initialize() method —
  // awaits it before switching, leaving the current renderer active on
  // failure. Not called from anywhere yet; does not auto-activate GPU.
  async activateRenderer(name){
    const renderer=this._renderers[name];
    if(!renderer) return false;
    if(this._activeName===name) return true;
    this._setRendererState(name,'initializing',null);
    if(typeof renderer.initialize==='function'){
      const ok=await renderer.initialize();
      if(!ok){
        const err=(typeof renderer.getInitError==='function')?renderer.getInitError():null;
        this._setRendererState(name,'failed',err);
        return false;
      }
    }
    this.setActiveRenderer(name);
    this._setRendererState(name,'active',null);
    return true;
  },
  // Phase 4B: read-only, high-level status snapshot. Exposes only
  // renderer names/flags — no internal GPU resources (adapter, device,
  // queue, canvas, context, pipeline, shaderModule, bindGroup,
  // commandEncoder, etc.) are ever surfaced here. `available` is built
  // dynamically from whatever is currently registered, never hardcoded.
  getRendererStatus(){
    // Phase 4M: errors built dynamically by asking each registered
    // renderer for its own safe diagnostic string via getInitError()
    // (if it exposes one) — no renderer name is hardcoded here, and
    // only string error data is ever included, never GPU objects.
    const errors={};
    for(const name of Object.keys(this._renderers)){
      const renderer=this._renderers[name];
      const err=(renderer && typeof renderer.getInitError==='function')
        ?renderer.getInitError()
        :null;
      if(err) errors[name]=err;
    }
    return {
      active: this._activeName,
      available: Object.keys(this._renderers),
      initialized: {
        cpu: true,
        gpu: _gpuState.initialized
      },
      errors,
      capabilities: this.getRendererCapabilities(),
      health: this.getRendererHealth()
    };
  },
  // Phase 4T: read-only capability metadata, built dynamically from
  // every registered renderer name (never hardcoded to "cpu"/"gpu").
  // Renderers without a getCapabilities() method contribute an empty
  // object, matching the spec's "else return {}" behavior per-renderer.
  getRendererCapabilities(){
    const out={};
    for(const name of Object.keys(this._renderers)){
      const renderer=this._renderers[name];
      out[name]=(renderer && typeof renderer.getCapabilities==='function')
        ?renderer.getCapabilities()
        :{};
    }
    return out;
  },
  // Phase 4N: generic self-test dispatcher. Looks the renderer up by
  // name in the registry and, if it exposes a selfTest() method, awaits
  // it; otherwise treats "no selfTest()" as a pass. This never
  // activates anything — no setActiveRenderer()/activateRenderer()/
  // applyPreferredRenderer() calls — it only checks whether the named
  // renderer can initialize/verify itself.
  async selfTestRenderer(name){
    const renderer=this._renderers[name];
    if(!renderer) return false;
    if(typeof renderer.selfTest==='function'){
      return await renderer.selfTest();
    }
    return true;
  },
  // Phase 4R: resets a registered renderer's initialization/diagnostic
  // state via its own reset() method, if it exposes one. Does not
  // activate, switch, or change the preferred/active renderer in any
  // way — purely delegates to the renderer's own cleanup.
  resetRenderer(name){
    const renderer=this._renderers[name];
    if(!renderer) return false;
    if(typeof renderer.reset==='function') renderer.reset();
    this._setRendererState(name,'idle',null);
    return true;
  },
  // Phase 4R: resets whichever renderer is currently active, by name,
  // via resetRenderer(). No switching — the active renderer stays the
  // same before and after this call.
  resetActiveRenderer(){
    const name=this.getActiveRenderer();
    return this.resetRenderer(name);
  },
  // Phase 4C: preference storage only. setPreferredRenderer() merely
  // records a name string — it never calls activateRenderer() or
  // setActiveRenderer(), so storing a preference has no effect on which
  // renderer is currently active. getPreferredRenderer() defaults to
  // 'cpu' when nothing has been stored yet. No GPU resources are
  // touched or exposed by either method.
  setPreferredRenderer(name){
    this._preferredName=name;
    this.savePreferredRenderer();
    this._notifyPreferenceChanged();
  },
  getPreferredRenderer(){
    return this._preferredName;
  },
  // Phase 4H: simple internal pub/sub for preference-change
  // notifications. Storage/listener management only — no activation,
  // no renderer switching, no DOM/UI involvement. Listeners receive
  // only { name: <preferred renderer name> }, never any GPU resource.
  onPreferenceChanged(callback){
    this._preferenceListeners.push(callback);
  },
  removePreferenceChanged(callback){
    const idx=this._preferenceListeners.indexOf(callback);
    if(idx!==-1) this._preferenceListeners.splice(idx,1);
  },
  _notifyPreferenceChanged(){
    const payload={name:this._preferredName};
    for(const cb of this._preferenceListeners.slice()){
      try{
        cb(payload);
      }catch(e){
        // Listener errors must not break preference storage.
      }
    }
  },
  // Phase 4E: localStorage persistence for the preference only — never
  // activates a renderer. loadPreferredRenderer() reads the stored
  // value and updates _preferredName if present (leaving the current
  // value, default 'cpu', untouched if missing or on any storage
  // error). savePreferredRenderer() writes the current _preferredName
  // back to the same key. Neither calls activateRenderer() or
  // applyPreferredRenderer().
  loadPreferredRenderer(){
    try{
      if(typeof localStorage==='undefined') return;
      const stored=localStorage.getItem('preferredRenderer');
      if(stored!==null && stored!==undefined){
        this._preferredName=stored;
      }
    }catch(e){
      // Storage unavailable/blocked — keep current _preferredName.
    }
  },
  savePreferredRenderer(){
    try{
      if(typeof localStorage==='undefined') return;
      localStorage.setItem('preferredRenderer',this._preferredName);
    }catch(e){
      // Storage unavailable/blocked — no-op.
    }
  },
  // Phase 4G: UI-facing helpers. getRendererOptions() builds its list
  // dynamically from the registry (never hardcoded) so it reflects
  // whatever's currently registered. selectPreferredRenderer() only
  // validates the name and delegates to setPreferredRenderer() — it
  // never activates or initializes a renderer, and never calls
  // applyPreferredRenderer().
  getRendererOptions(){
    return Object.keys(this._renderers).map(name=>({
      name,
      available: true
    }));
  },
  selectPreferredRenderer(name){
    if(!this._renderers[name]) return false;
    this.setPreferredRenderer(name);
    return true;
  },
  // Phase 4D: pure delegation — applies whatever preference is
  // currently stored by calling the existing activateRenderer() with
  // it. No duplicated activation logic, no new state, not called from
  // anywhere (including module init), so storing a GPU preference
  // still has no effect until this is explicitly invoked elsewhere.
  async applyPreferredRenderer(){
    const preferred=this.getPreferredRenderer();
    let result=false;
    let error=null;
    try{
      result=await this.activateRenderer(preferred);
      if(!result){
        const renderer=this._renderers[preferred];
        error=(renderer && typeof renderer.getInitError==='function')
          ?renderer.getInitError()
          :'renderer activation failed';
        if(!error) error='renderer activation failed';
      }
    }catch(e){
      result=false;
      error=(e && e.message)?e.message:String(e);
    }
    this._lastApplyResult=result;
    this._lastApplyError=error;
    this._lastApplyTime=Date.now();

    // Phase 4Q: append this attempt to the bounded history, keeping only
    // the newest 10 records. Diagnostics only — same fields as the
    // single-snapshot state above, plus the active renderer name.
    this._applyHistory.push({
      result,
      error,
      preferred,
      active: this.getActiveRenderer(),
      time: this._lastApplyTime
    });
    if(this._applyHistory.length>10){
      this._applyHistory.splice(0,this._applyHistory.length-10);
    }

    return result;
  },
  // Phase 4O: read-only status snapshot of the last applyPreferredRenderer()
  // call. Diagnostics only — no GPU resources are exposed here, only the
  // recorded boolean result, error string (if any), timestamp, and the
  // current preferred/active renderer names.
  getRendererApplyStatus(){
    return {
      result: this._lastApplyResult,
      error: this._lastApplyError,
      time: this._lastApplyTime,
      preferred: this.getPreferredRenderer(),
      active: this.getActiveRenderer()
    };
  },
  // Phase 4Q: returns a copy of the apply-attempt history (newest-10),
  // so callers cannot mutate internal state directly.
  getRendererApplyHistory(){
    return this._applyHistory.map(record=>({...record}));
  },
  // Phase 4S: read-only lifecycle status, built dynamically from every
  // registered renderer name (never hardcoded to "cpu"/"gpu"). Renderers
  // with no recorded state yet default to "idle" with no error/time.
  getRendererLifecycleStatus(){
    const out={};
    for(const name of Object.keys(this._renderers)){
      const record=this._rendererStates[name];
      out[name]=record
        ? {...record}
        : {state:'idle',updatedAt:null,error:null};
    }
    return out;
  },
  // Phase 4U: returns a copy of the newest apply-history entry whose
  // `preferred` field matches `name`, or null if none exists. Never
  // exposes the internal _applyHistory array itself.
  getRendererLastApply(name){
    for(let i=this._applyHistory.length-1;i>=0;i--){
      const entry=this._applyHistory[i];
      if(entry && entry.preferred===name) return {...entry};
    }
    return null;
  },
  // Phase 4U: read-only health snapshot, built dynamically from every
  // registered renderer name (never hardcoded to "cpu"/"gpu"). Combines
  // lifecycle state, capability metadata, current initialized flag, and
  // the latest apply-history entry for that renderer into a single
  // "healthy" boolean per the following rules:
  //   healthy = true  if lifecycle.state === "active"
  //             OR (name === "cpu" AND renderer is registered/available)
  //   healthy = false if lifecycle.state === "failed"
  //             OR the latest apply attempt for this renderer failed
  // Does not activate, switch, or initialize anything.
  getRendererHealth(){
    const lifecycleAll=this.getRendererLifecycleStatus();
    const capabilitiesAll=this.getRendererCapabilities();
    const out={};
    for(const name of Object.keys(this._renderers)){
      const lifecycle=lifecycleAll[name]||{state:'idle',updatedAt:null,error:null};
      const capabilities=capabilitiesAll[name]||{};
      const lastApply=this.getRendererLastApply(name);
      const initialized=(name==='cpu')?true:!!(capabilities && capabilities.initialized);

      let healthy;
      if(lifecycle.state==='failed' || (lastApply && lastApply.result===false)){
        healthy=false;
      }else if(lifecycle.state==='active' || name==='cpu'){
        healthy=true;
      }else{
        healthy=false;
      }

      out[name]={
        available: true,
        lifecycle,
        capabilities,
        initialized,
        lastApply,
        healthy
      };
    }
    return out;
  },
  // Phase 4V: unified, read-only diagnostics snapshot combining every
  // existing diagnostics API into one object. Deep-cloned via
  // JSON round-trip (all source values are plain strings/numbers/
  // booleans/null/plain-objects/arrays already) so the caller cannot
  // mutate any BrushRenderer internal state through the returned
  // object. No activation, no switching, no GPU internals exposed —
  // purely aggregates existing public getters.
  getRendererDiagnostics(){
    const snapshot={
      timestamp: Date.now(),
      active: this.getActiveRenderer(),
      preferred: this.getPreferredRenderer(),
      status: this.getRendererStatus(),
      health: this.getRendererHealth(),
      capabilities: this.getRendererCapabilities(),
      lifecycle: this.getRendererLifecycleStatus(),
      apply: this.getRendererApplyStatus(),
      history: this.getRendererApplyHistory()
    };
    try{
      return JSON.parse(JSON.stringify(snapshot));
    }catch(e){
      return snapshot;
    }
  },
};

// Phase 2D: GpuBrushRenderer owns its own private state object, entirely
// separate from CpuBrushRenderer's module-level variables. Nothing here
// is shared with the CPU renderer's state. This is still not a real
// implementation — cache stats stay at their harmless zeroed defaults,
// and drawDab/beginStroke/endStroke/invalidateCaches remain no-ops — but
// the line-continuity and tip-alpha methods now read/write this object
// instead of returning hardcoded nulls.
//
// Phase 3A: adds GPU device lifecycle fields (adapter, device, queue,
// initialized, initError). These are populated only by initialize()
// below and are never touched by drawDab/beginStroke/endStroke/etc. in
// this phase — no rendering work reads or writes them yet.
//
// Phase 3B: adds GPU capability-discovery fields (adapterFeatures,
// adapterLimits, deviceFeatures, deviceLimits, preferredCanvasFormat).
// These are populated only by initialize() by reading information the
// adapter/device already expose — no optional features are requested,
// no optional limits are enabled, and no canvas/texture/buffer/shader/
// pipeline resources are created.
//
// Phase 3C: adds GPU canvas-context fields (canvas, context, canvasFormat,
// configured). initialize() now also locates the app's drawing canvas,
// acquires a GPUCanvasContext from it, and configures that context once
// (device + preferred format + premultiplied alpha). No texture, buffer,
// shader, pipeline, bind group, command encoder, or render pass is
// created — configuration only.
//
// Phase 3D: adds command-submission transient fields (commandEncoder,
// commandBuffer), used only by createCommandEncoder()/submitCommands().
//
// Phase 3E: adds render-pass transient fields (currentTexture,
// currentTextureView, renderPass), used only by beginRenderPass()/
// endRenderPass().
//
// Phase 3F: adds pipeline-resource placeholder fields (pipeline,
// pipelineLayout, shaderModule, bindGroupLayout, bindGroup). All
// initialized to null and never assigned anywhere in this phase — no
// createShaderModule/createRenderPipeline/createPipelineLayout/
// createBindGroupLayout/createBindGroup call exists yet. These fields
// exist purely so a future phase has somewhere to store pipeline
// resources; nothing reads or writes them in this phase.
const _gpuState = {
  lineContinuity: null,
  tipAlphaBuffer: null,
  tipAlphaSeedPixels: null,
  tipAlphaInvalidationReason: null,
  adapter: null,
  device: null,
  queue: null,
  initialized: false,
  initError: null,
  adapterFeatures: null,
  adapterLimits: null,
  deviceFeatures: null,
  deviceLimits: null,
  preferredCanvasFormat: null,
  canvas: null,
  context: null,
  canvasFormat: null,
  configured: false,
  commandEncoder: null,
  commandBuffer: null,
  currentTexture: null,
  currentTextureView: null,
  renderPass: null,
  pipeline: null,
  pipelineLayout: null,
  shaderModule: null,
  bindGroupLayout: null,
  bindGroup: null,
  // Phase 5A: receive counters only — track how many times this
  // renderer has been called through the same beginStroke/drawDab/
  // endStroke path CpuBrushRenderer receives. No rendering, no GPU
  // resource creation; these are plain numbers for diagnostics.
  strokesReceived: 0,
  dabsReceived: 0,
  inStroke: false,
  // Phase 5B: frame submission counter only. No new GPU resources —
  // plain numbers for diagnostics of the existing command-submission
  // flow (createCommandEncoder/beginRenderPass/endRenderPass/
  // submitCommands), reused as-is.
  framesSubmitted: 0,
  lastFrameTime: null,
  // Phase 5S: renderer-owned resource-count diagnostics only. No new
  // GPU resources are created because of these fields — they are
  // incremented at existing creation/destruction sites and never reset,
  // matching the cumulative-diagnostic-history pattern used by every
  // other counter in this object.
  vertexBuffersCreated: 0,
  vertexBuffersDestroyed: 0,
  pipelinesCreated: 0,
  pipelinesDestroyed: 0,
  shaderModulesCreated: 0,
  shaderModulesDestroyed: 0,
  commandEncodersCreated: 0,
  renderPassesStarted: 0,
  // Phase 5T: cumulative error diagnostics only. No rendering/behavior
  // is driven by these fields — they are populated solely by
  // _recordError() below, which reuses (not duplicates) the existing
  // initError/catch bookkeeping already present in this file.
  lastError: null,
  lastErrorTime: null,
  errorCount: 0,
  errorHistory: [],
  // Phase 5C: dedicated resources for the minimal visible dab quad.
  // Kept entirely separate from the Phase 3H fullscreen-triangle
  // pipeline/shader (_gpuState.pipeline/shaderModule) so that pipeline's
  // existing behavior (submitEmptyFrame/renderFrame/selfTest) is left
  // completely untouched. No textures, samplers, or bind groups — a
  // single flat-color pipeline plus a small vertex buffer holding one
  // quad (2 triangles / 6 vertices) that is overwritten per dab.
  dabPipeline: null,
  dabShaderModule: null,
  dabPipelineLayout: null,
  dabVertexBuffer: null,
  // Diagnostics only: counts actual submitted GPU dab draw calls, as
  // opposed to dabsReceived (Phase 5A), which counts every drawDab()
  // call regardless of whether the GPU was initialized/able to draw.
  dabsDrawn: 0,
  lastDabTime: null,
  // Phase 5D: counts drawDab() calls that reached real GPU submission
  // work but did not complete successfully (encoder/texture/pipeline
  // failure, or an exception from the GPU API itself). Does not count
  // calls that were simple no-ops because the GPU wasn't initialized —
  // those only increment dabsReceived, since nothing was attempted.
  failedDabs: 0,
  // Phase 5E: minimal dab queue — preparation infrastructure only. Does
  // NOT change what drawDab() already renders (Phase 5D's immediate
  // per-dab submission is left completely intact, so appearance/timing
  // of what appears on screen is unchanged). This queue simply
  // accumulates the exact raw `d` object each drawDab() call already
  // received, unmodified, so a future phase can submit multiple dabs
  // in one batched command buffer instead of one-per-call. A hard cap
  // prevents unbounded growth if flushDabQueue() is never called;
  // overflow entries are dropped (counted, never silently lost) rather
  // than resized/reallocated per push.
  dabQueue: [],
  dabQueueMaxSize: 4096,
  queuedDabs: 0,
  // Phase 6B: persistent accumulation texture that dab batches are
  // rendered into (loadOp:'load', same texture object reused across
  // every flush) so previously drawn strokes are never lost. The
  // canvas's own swapchain texture (context.getCurrentTexture())
  // cannot be used for this — a new, blank texture is handed back for
  // presentation, so anything drawn to a previous one is gone once
  // that frame presents. This texture is not part of the swapchain;
  // it is only ever blitted onto the current swapchain texture (a
  // plain GPU-to-GPU copy, not a second render/draw pipeline) inside
  // the existing flushDabQueue() so the canvas reflects the
  // accumulated result. Sized to match the GPU canvas; recreated (and
  // re-cleared) only when that size changes.
  accumTexture: null,
  accumTextureWidth: 0,
  accumTextureHeight: 0,
  // Revised GPU integration: the persistent, permanent per-layer surface.
  // Unlike accumTexture (per-stroke scratch, cleared at every
  // beginStroke — see _clearAccumTexture()), layerTexture is only ever
  // created blank once (or on a genuine size change) and otherwise
  // accumulates every committed stroke for the lifetime of the active
  // layer, exactly the same role activeC/ctx plays for CpuBrushRenderer.
  // It is composed into FROM accumTexture (never the reverse) by
  // _composeStrokeOntoLayer(), entirely on the GPU (render-pass blend,
  // no getImageData/readPixels, no CPU canvas involved). This is the
  // texture getLayerSurface()'s returned canvas is kept in sync with.
  layerTexture: null,
  layerTextureWidth: 0,
  layerTextureHeight: 0,
  composePipeline: null,
  composePipelineLayout: null,
  composeShaderModule: null,
  composeBindGroupLayout: null,
  composeSampler: null,
  composeUniformBuffer: null,
  submittedDabs: 0,
  droppedDabs: 0,
  lastBatchTime: null,
  // Phase 5F: batch-buffer capacity (in dabs, not bytes) currently
  // allocated for _gpuState.dabVertexBuffer, and batch-level
  // (as opposed to Phase 5D's dab-level) submission diagnostics.
  dabBatchCapacity: 0,
  batchesSubmitted: 0,
  failedBatches: 0,
  // Phase 5H: flush metadata — plain diagnostic data only (a string
  // reason, a boolean result, a timestamp), never any GPU
  // resource/object. Updated by every flush attempt regardless of
  // where it was triggered from (stroke-end, an optional per-frame
  // flushPendingDabs() call, or an explicit manual flush), so a caller
  // can always tell what the most recent flush attempt was, what
  // triggered it, and whether it succeeded — without exposing the
  // encoder/pipeline/buffer/device internals that produced that result.
  lastFlushReason: null,
  lastFlushResult: null,
  lastFlushTime: null,
  // Phase 5I: frame lifecycle diagnostics — plain fields only (counts,
  // timestamps, a boolean). No GPU resources are created or tracked
  // here; this exists purely so callers can verify when queued dabs
  // are flushed relative to frame/stroke boundaries.
  framesStarted: 0,
  framesEnded: 0,
  lastFrameStartTime: null,
  lastFrameEndTime: null,
  lastFrameFlushResult: null,
  // Phase 5O: renderer-present notification diagnostics — plain fields
  // only (a count, a timestamp). No GPU resources are created or
  // tracked here; presentFrame() itself performs no GPU work (no
  // submission, no flush, no command encoder/pipeline/shader/buffer/
  // texture) — it exists purely so callers can verify the engine
  // notified the renderer after a frame was presented.
  presentedFrames: 0,
  lastPresentTime: null,
  // Phase 5P: renderer-idle diagnostics — plain fields only (a count, a
  // timestamp). No GPU resources are created or destroyed here;
  // rendererIdle() itself performs no flush, no command submission, no
  // shader/pipeline/buffer/texture work — it exists purely so callers
  // can verify the engine notified the renderer once all pending
  // stroke-completion work had finished.
  idleTransitions: 0,
  lastIdleTime: null,
  // Phase 5Q: renderer session lifetime diagnostics — plain fields
  // only (timestamps, counts). No GPU resources are created or
  // destroyed here; these track when the current session started,
  // when it was last active, and cumulative stroke/frame counts for
  // that session.
  sessionStartedAt: null,
  sessionLastActivity: null,
  sessionStrokeCount: 0,
  sessionFrameCount: 0,
  // Phase 5R: renderer performance timing diagnostics — plain
  // numbers only. lastXDuration/totalXTime are in milliseconds
  // (performance.now()-based, falling back to Date.now() if
  // performance is unavailable). Counts/totals are cumulative history,
  // matching every other counter in this object; averages are derived
  // on demand in getPerformanceDiagnostics() rather than stored.
  lastFlushDuration: 0,
  lastFrameDuration: 0,
  lastPresentDuration: 0,
  totalFlushTime: 0,
  totalFrameTime: 0,
  totalPresentTime: 0,
  flushCount: 0,
  frameCount: 0,
  presentCount: 0,
};

// Phase 2C: GpuBrushRenderer skeleton. Implements the exact same public
// renderer interface as CpuBrushRenderer, but every method is an
// intentionally empty stub — no rendering, no state, no GPU APIs of any
// kind. Registered below but NOT activated; CpuBrushRenderer remains the
// active renderer. This exists purely to verify the registry/dispatcher
// architecture supports a second implementation.
//
// Phase 3A: adds initialize() — WebGPU adapter/device acquisition only.
// No pipelines, shaders, textures, or buffers are created. initialize()
// is not part of the frozen BrushRenderer dispatch contract (Phase 2E);
// it is GPU-renderer-specific lifecycle setup that must be called
// explicitly and does not affect the active renderer.
const GpuBrushRenderer = {
  // Phase 5T: cumulative error-diagnostics recorder. Converts Error
  // objects to their message string (falling back to String(error) for
  // non-Error values), stores lastError/lastErrorTime, increments
  // errorCount, and appends {message,time} to errorHistory, trimmed to
  // the newest 20 entries. Diagnostics only — never throws, never
  // changes any rendering/activation/GPU-resource state, and does not
  // itself set _gpuState.initError (call sites keep setting that
  // separately, exactly as before, since getInitError() depends on it).
  _recordError(error){
    const message=(error instanceof Error)?error.message:String(error);
    _gpuState.lastError=message;
    _gpuState.lastErrorTime=Date.now();
    _gpuState.errorCount+=1;
    _gpuState.errorHistory.push({message,time:_gpuState.lastErrorTime});
    if(_gpuState.errorHistory.length>20){
      _gpuState.errorHistory.splice(0,_gpuState.errorHistory.length-20);
    }
  },
  // Phase 5R: timing helper only — no GPU work, no rendering. Uses
  // performance.now() when available (sub-millisecond, monotonic),
  // falling back to Date.now() otherwise. Used solely to measure
  // flushDabQueue()/endFrame()/presentFrame() durations for
  // diagnostics.
  _now(){
    return (typeof performance!=='undefined' && typeof performance.now==='function')
      ? performance.now()
      : Date.now();
  },
  // Phase 5A: minimal lifecycle receive-tracking only. Receives the
  // exact same calls CpuBrushRenderer gets via the unchanged
  // BrushRenderer dispatcher (this.active.beginStroke/drawDab/
  // endStroke) — no rendering, no shader/pipeline/buffer/texture work,
  // no brush appearance/stabilization/pressure logic touched.
  // Phase 5C: connects drawDab() to a minimal real GPU draw call. Still
  // no stabilization/pressure/spacing/hardness/texture/blending logic —
  // those all remain entirely in brush-engine.js and are never read
  // here. This only takes the already-computed dab position/radius
  // (d.x, d.y, d.r) and submits a single flat-color quad at that
  // location using the existing command-encoder/submit helpers
  // (createCommandEncoder/submitCommands) from Phase 3D. If the GPU
  // renderer isn't initialized (e.g. GPU was registered but never
  // manually activated/initialized), this is a no-op beyond the
  // existing receive-counter bookkeeping — no fallback to CPU is
  // performed here or anywhere else.
  //
  // Phase 5D: hardening only — no coordinate-formula change (the
  // pixel->NDC math below was already correct: activeC.width/height is
  // the same raw pixel space d.x/d.y are already expressed in
  // elsewhere in brush-engine.js, and the y-flip already accounted for
  // canvas 2D's top-left-down origin vs WebGPU's NDC y-up). What Phase
  // 5D adds:
  //   - wraps the whole submission in try/catch so any GPU error
  //     (e.g. a lost device) can never throw out of drawDab() — it is
  //     caught, counted in failedDabs, and returns false safely.
  //   - returns a boolean (true = a dab was actually submitted to the
  //     GPU queue, false = it was not, for any reason) instead of
  //     nothing, so callers/diagnostics can tell success from no-op.
  //   - guards against a zero-size canvas (division by zero in the
  //     pixel->NDC conversion) before doing any GPU work.
  //   - no new GPU resources are created per call beyond what's
  //     strictly per-frame/per-submission in WebGPU's model (a command
  //     encoder and a texture view must be re-acquired every call —
  //     that's inherent to the API, not something to cache). The
  //     pipeline, shader modules, pipeline layout, and vertex buffer
  //     are all created exactly once (createDabPipeline() is
  //     idempotent) and reused on every subsequent dab.
  //
  // Phase 5E: also stages the exact raw `d` object into
  // _gpuState.dabQueue, unmodified, as batching-preparation bookkeeping
  // for a future phase. This is purely additive — it does not replace,
  // delay, or skip the Phase 5D immediate GPU submission above/below,
  // so what actually renders and when is unchanged. If the queue is at
  // capacity the incoming dab is dropped from the queue only (counted
  // in droppedDabs); the immediate GPU submission still happens as
  // before regardless.
  // Phase 5F: drawDab() now ONLY enqueues — it performs no GPU
  // submission of its own. All per-dab immediate command-encoder/
  // render-pass/submit work from Phase 5D has been removed from this
  // method; that work now happens once per batch inside
  // flushDabQueue() below. No brush appearance/stabilization/pressure/
  // spacing/hardness/texture/blending logic is read or added — this
  // still only stages the exact raw `d` object drawDab() already
  // received, unmodified.
  drawDab(d,rendererContext){
    _gpuState.dabsReceived+=1;
    return this._enqueueDab(d);
  },
  // Phase 5C: smallest possible GPU-side dab representation — a single
  // flat-color quad (2 triangles, 6 vertices, no indices), no bind
  // group, no uniforms, no texture/sampler. Idempotent: returns true
  // immediately once created. Entirely separate from createPipeline()
  // (Phase 3H), which remains untouched and still used by
  // renderFrame()/submitEmptyFrame()/selfTest().
  //
  // Phase 5F: no longer creates a fixed 1-dab vertex buffer here — the
  // vertex buffer is now a growable batch buffer managed separately by
  // _ensureDabBatchCapacity(), since a flush submits many dabs' worth
  // of vertices in one draw call. Pipeline/shader creation itself is
  // unchanged (same shader, same single-color output, same vertex
  // layout — one quad's worth of attributes, repeated per dab in the
  // batch buffer).
  // Phase 6E: appearance-parity update. The dab pipeline now also takes
  // a per-vertex RGBA color (location 1) instead of emitting a fixed
  // solid black, and the color target has standard source-over alpha
  // blending enabled — matching the CPU renderer's compositing
  // (ctx.globalAlpha + normal 'source-over' fill, see
  // CpuBrushRenderer.drawDab()) for the two most visible appearance
  // gaps: dab color and dab opacity. Position math, topology, and the
  // one-draw-call-per-batch structure are all unchanged from Phase 5F.
  // Phase 6E: appearance-parity update. The dab pipeline now also takes
  // a per-vertex RGBA color (location 1) instead of emitting a fixed
  // solid black, and the color target has standard source-over alpha
  // blending enabled — matching the CPU renderer's compositing
  // (ctx.globalAlpha + normal 'source-over' fill, see
  // CpuBrushRenderer.drawDab()) for the two most visible appearance
  // gaps: dab color and dab opacity. Position math, topology, and the
  // one-draw-call-per-batch structure are all unchanged from Phase 5F.
  // Phase 6F: adds a per-vertex local UV (location 2, quad-space
  // coordinate in [-1,1]) so the fragment shader can mask each quad
  // down to a circle. This is the single largest remaining visual
  // mismatch found in this phase's investigation — every dab was a
  // literal hard-edged square, whereas CpuBrushRenderer always draws a
  // round dab (see e.g. _dabAA/_dabAliased's circular falloff). Color,
  // blending, and batching from Phase 6E are otherwise untouched.
  createDabPipeline(){
    if(_gpuState.dabPipeline) return true;

    if(!_gpuState.device || !_gpuState.canvasFormat) return false;
    const device=_gpuState.device;

    const shaderCode=`
      struct VertexOut {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) uv: vec2<f32>,
      };

      @vertex
      fn vs_main(@location(0) pos: vec2<f32>, @location(1) color: vec4<f32>, @location(2) uv: vec2<f32>) -> VertexOut {
        var out: VertexOut;
        out.position = vec4<f32>(pos, 0.0, 1.0);
        out.color = color;
        out.uv = uv;
        return out;
      }

      @fragment
      fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
        // Phase 6F: mask the quad down to a circle. dist is the
        // fragment's distance from the dab center in quad-space, where
        // 1.0 is exactly at the dab radius. A single smoothstep gives
        // the circle a clean (~1px) edge instead of a jagged hard cutoff
        // — required just to render a circle at all, not the CPU
        // renderer's separate, larger hardness-falloff gradient, which
        // remains unimplemented here.
        let dist = length(in.uv);
        let coverage = 1.0 - smoothstep(0.9, 1.0, dist);
        if (coverage <= 0.0) {
          discard;
        }
        // Phase 6E: per-dab color/opacity, alpha-premultiplied for the
        // blend state below (out-of-scope-for-blending straight alpha
        // would double-apply alpha under 'src-alpha' blending).
        let a = in.color.a * coverage;
        return vec4<f32>(in.color.rgb * a, a);
      }
    `;

    const shaderModule=device.createShaderModule({code:shaderCode});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[]});

    const pipeline=device.createRenderPipeline({
      layout:pipelineLayout,
      vertex:{
        module:shaderModule,
        entryPoint:'vs_main',
        buffers:[{
          arrayStride: 8*4,
          attributes:[
            {shaderLocation:0, offset:0, format:'float32x2'},
            {shaderLocation:1, offset:2*4, format:'float32x4'},
            {shaderLocation:2, offset:6*4, format:'float32x2'},
          ],
        }],
      },
      fragment:{
        module:shaderModule,
        entryPoint:'fs_main',
        targets:[{
          format:_gpuState.canvasFormat,
          blend:{
            color:{srcFactor:'one', dstFactor:'one-minus-src-alpha', operation:'add'},
            alpha:{srcFactor:'one', dstFactor:'one-minus-src-alpha', operation:'add'},
          },
        }],
      },
      primitive:{
        topology:'triangle-list',
      },
    });

    // Phase 5F: no fixed-size buffer created here anymore — see
    // _ensureDabBatchCapacity(), which lazily creates/grows
    // _gpuState.dabVertexBuffer only when a flush needs more capacity
    // than it currently has.
    _gpuState.dabShaderModule=shaderModule;
    _gpuState.dabPipelineLayout=pipelineLayout;
    _gpuState.dabPipeline=pipeline;
    // Phase 5S: diagnostics only — mirrors the resources just created
    // above; does not change what was created.
    _gpuState.shaderModulesCreated++;
    _gpuState.pipelinesCreated++;
    return true;
  },
  // Phase 5F: ensures the shared batch vertex buffer can hold at least
  // `dabCount` dabs (6 vertices * 2 floats each). Reused across
  // flushes — only recreated when an incoming batch is larger than
  // what's already allocated ("grow buffer only when required"),
  // never once per dab and never once per flush if the existing
  // buffer is already big enough. Growth doubles capacity (starting
  // from a small minimum) rather than allocating exactly what's
  // needed each time, to reduce how often reallocation happens across
  // consecutive flushes of similar size.
  _ensureDabBatchCapacity(dabCount){
    if(_gpuState.dabVertexBuffer && _gpuState.dabBatchCapacity>=dabCount) return true;
    if(!_gpuState.device) return false;
    let capacity=_gpuState.dabBatchCapacity||64;
    while(capacity<dabCount) capacity*=2;
    if(_gpuState.dabVertexBuffer){
      _gpuState.dabVertexBuffer.destroy();
      _gpuState.dabVertexBuffer=null;
      // Phase 5S: diagnostics only — records the destroy() above.
      _gpuState.vertexBuffersDestroyed++;
    }
    _gpuState.dabVertexBuffer=_gpuState.device.createBuffer({
      // Phase 6E: each vertex is now 6 floats (2 position + 4 rgba, see
      // createDabPipeline()'s buffer layout) instead of 2 — same 6
      // vertices/dab, just a wider per-vertex stride to carry color.
      // Phase 6F: widened again to 8 floats/vertex (+2 for UV) to mask
      // the quad into a circle — see createDabPipeline().
      size: capacity*6*8*4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    // Phase 5S: diagnostics only — records the createBuffer() above.
    _gpuState.vertexBuffersCreated++;
    _gpuState.dabBatchCapacity=capacity;
    return true;
  },
  // Phase 6B: lazily creates (or recreates, on a canvas size change)
  // the persistent accumulation texture dab batches are rendered into.
  // Created once per size and then reused — "recreated only when
  // required", same growth-avoidance principle as
  // _ensureDabBatchCapacity() above. A fresh/resized texture is
  // cleared exactly once, right here, via its own tiny clear pass; every
  // subsequent flush into it uses loadOp:'load' (see
  // _flushDabQueueImplTimed) so prior strokes already drawn into it are
  // preserved rather than replayed.
  _ensureAccumTexture(width,height){
    if(_gpuState.accumTexture && _gpuState.accumTextureWidth===width && _gpuState.accumTextureHeight===height){
      return true;
    }
    if(!_gpuState.device || !_gpuState.canvasFormat) return false;
    if(_gpuState.accumTexture){
      _gpuState.accumTexture.destroy();
      _gpuState.accumTexture=null;
    }
    _gpuState.accumTexture=_gpuState.device.createTexture({
      size:{width,height},
      format:_gpuState.canvasFormat,
      // TEXTURE_BINDING added (revised GPU integration) so
      // _composeStrokeOntoLayer()'s compose pipeline can sample this
      // stroke's finished dabs as an input texture when blending them
      // onto layerTexture — a GPU render-pass read, not a CPU readback.
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    _gpuState.accumTextureWidth=width;
    _gpuState.accumTextureHeight=height;
    // Clear the freshly (re)created texture to transparent exactly once,
    // via the same helper beginStroke() uses to reset it between strokes
    // (see _clearAccumTexture() below) — a brand-new/resized texture
    // starts from the identical blank state a stroke boundary produces.
    this._clearAccumTexture();
    return true;
  },
  // Revised GPU integration: accumTexture is this renderer's per-STROKE
  // scratch surface — the exact same role _strokeCanvas plays for
  // CpuBrushRenderer (see brush-engine.js's
  // _ensureStrokeCanvas/_commitStrokeCanvas). It is reset on every
  // beginStroke() (below) so it holds only the in-progress stroke's
  // dabs. Where this now differs from the rejected GPU-integration-pass
  // design: accumTexture's contents are never copied onto activeC.
  // Instead, at stroke-end, _composeStrokeOntoLayer() blends accumTexture
  // onto layerTexture — a second, GPU-owned texture that persists across
  // strokes — via a GPU render pass (see createComposePipeline()/
  // _composeStrokeOntoLayer() below). layerTexture, not activeC, is this
  // renderer's permanent drawing surface; it is what getLayerSurface()
  // exposes to the rest of the app.
  _clearAccumTexture(){
    if(!_gpuState.accumTexture || !_gpuState.device || !_gpuState.queue) return false;
    const clearEncoder=_gpuState.device.createCommandEncoder();
    const clearPass=clearEncoder.beginRenderPass({
      colorAttachments: [{
        view:_gpuState.accumTexture.createView(),
        loadOp:'clear',
        clearValue:{r:0,g:0,b:0,a:0},
        storeOp:'store',
      }],
    });
    clearPass.end();
    _gpuState.queue.submit([clearEncoder.finish()]);
    return true;
  },
  // Revised GPU integration: lazily creates (or resizes) layerTexture,
  // this renderer's permanent per-layer surface. Mirrors
  // _ensureAccumTexture() above, with one deliberate difference — this
  // texture is cleared only when first created or when its size
  // actually changes, never on a stroke boundary, since it must retain
  // every previously committed stroke.
  _ensureLayerTexture(width,height){
    if(_gpuState.layerTexture && _gpuState.layerTextureWidth===width && _gpuState.layerTextureHeight===height){
      return true;
    }
    if(!_gpuState.device || !_gpuState.canvasFormat) return false;
    if(_gpuState.layerTexture){
      _gpuState.layerTexture.destroy();
      _gpuState.layerTexture=null;
    }
    _gpuState.layerTexture=_gpuState.device.createTexture({
      size:{width,height},
      format:_gpuState.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
    });
    _gpuState.layerTextureWidth=width;
    _gpuState.layerTextureHeight=height;
    const clearEncoder=_gpuState.device.createCommandEncoder();
    const clearPass=clearEncoder.beginRenderPass({
      colorAttachments:[{view:_gpuState.layerTexture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}],
    });
    clearPass.end();
    _gpuState.queue.submit([clearEncoder.finish()]);
    return true;
  },
  // Revised GPU integration: loads a plain 2D canvas/image (a stored
  // keyframe, an undo snapshot, a freshly-loaded project, etc.) into
  // layerTexture, so switching frames/layers/undo-state while GPU is
  // the active renderer updates the renderer's OWN authoritative
  // surface instead of relying on activeC. This is a CPU->GPU upload
  // (queue.copyExternalImageToTexture), the opposite direction from —
  // and unrelated to — the per-frame GPU->CPU stroke readback this pass
  // exists to remove; it happens only on an explicit, infrequent,
  // user-initiated frame/layer/undo change, never during stroke
  // painting. `source===null` clears layerTexture to blank (an empty
  // frame). No 2D context/getImageData involved either way.
  loadIntoLayer(source){
    if(!_gpuState.device||!_gpuState.queue||!_gpuState.canvas) return false;
    const w=_gpuState.canvas.width,h=_gpuState.canvas.height;
    if(!this._ensureLayerTexture(w,h)) return false;
    if(!_gpuState.layerTexture) return false;
    // _ensureLayerTexture() already clears a freshly (re)created
    // texture; if it already existed at this size, clear it explicitly
    // so a blank/loaded frame doesn't inherit whatever was drawn before.
    const clearEncoder=_gpuState.device.createCommandEncoder();
    const clearPass=clearEncoder.beginRenderPass({
      colorAttachments:[{view:_gpuState.layerTexture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}],
    });
    clearPass.end();
    _gpuState.queue.submit([clearEncoder.finish()]);
    if(source){
      try{
        _gpuState.queue.copyExternalImageToTexture({source},{texture:_gpuState.layerTexture},{width:w,height:h});
      }catch(err){
        this._recordError(err||'load-into-layer-failed');
        return false;
      }
    }
    this._presentLayerToCanvas(false,0);
    return true;
  },
  // Revised GPU integration: builds the compose pipeline used by
  // _composeStrokeOntoLayer() to blend a finished stroke (accumTexture)
  // onto the persistent layer surface (layerTexture), and by
  // _blitLiveStrokePreview() to blend the in-progress stroke onto the
  // swapchain for live preview without touching layerTexture. A plain
  // full-screen textured quad (no vertex buffer — positions/uv are
  // computed from @builtin(vertex_index)) whose fragment shader samples
  // accumTexture and scales its alpha (and premultiplied color) by a
  // uniform opacity, matching brush-engine.js's
  // ctx.globalAlpha=brushOpacity CPU-side step, but performed as a GPU
  // render pass instead of a canvas-to-canvas 2D drawImage. The blend
  // state mirrors the dab pipeline's premultiplied source-over blend so
  // stacking here matches stacking there.
  createComposePipeline(){
    if(_gpuState.composePipeline) return true;
    if(!_gpuState.device || !_gpuState.canvasFormat) return false;
    const device=_gpuState.device;
    const shaderCode=`
      struct VertexOut {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      };
      @vertex
      fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOut {
        var pos = array<vec2<f32>, 6>(
          vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
          vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0)
        );
        var out: VertexOut;
        let p = pos[idx];
        out.position = vec4<f32>(p, 0.0, 1.0);
        out.uv = vec2<f32>((p.x+1.0)*0.5, (1.0-p.y)*0.5);
        return out;
      }
      @group(0) @binding(0) var srcSampler: sampler;
      @group(0) @binding(1) var srcTexture: texture_2d<f32>;
      struct Opacity { value: f32 };
      @group(0) @binding(2) var<uniform> opacityUniform: Opacity;
      @fragment
      fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
        let sample = textureSample(srcTexture, srcSampler, in.uv);
        // sample is already premultiplied (see dab pipeline fs_main);
        // scaling both components by opacity keeps it premultiplied.
        return sample * opacityUniform.value;
      }
    `;
    const shaderModule=device.createShaderModule({code:shaderCode});
    const bindGroupLayout=device.createBindGroupLayout({
      entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
        {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
      ],
    });
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
    const pipeline=device.createRenderPipeline({
      layout:pipelineLayout,
      vertex:{module:shaderModule,entryPoint:'vs_main'},
      fragment:{
        module:shaderModule,
        entryPoint:'fs_main',
        targets:[{
          format:_gpuState.canvasFormat,
          blend:{
            color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
            alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
          },
        }],
      },
      primitive:{topology:'triangle-list'},
    });
    _gpuState.composeShaderModule=shaderModule;
    _gpuState.composePipelineLayout=pipelineLayout;
    _gpuState.composeBindGroupLayout=bindGroupLayout;
    _gpuState.composePipeline=pipeline;
    _gpuState.composeSampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    _gpuState.composeUniformBuffer=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    _gpuState.shaderModulesCreated++;
    _gpuState.pipelinesCreated++;
    return true;
  },
  // Revised GPU integration: runs the compose pass described above,
  // reading `srcTexture` (either accumTexture, the just-finished
  // stroke, or layerTexture itself for the live-preview base) and
  // writing into `targetView` at the given opacity. loadOp is 'load'
  // when compositing onto existing content (the normal case) so
  // whatever is already in the target is preserved underneath.
  _runComposePass(srcTexture,targetView,opacity,loadOp){
    if(!this.createComposePipeline()) return false;
    const device=_gpuState.device;
    device.queue.writeBuffer(_gpuState.composeUniformBuffer,0,new Float32Array([Math.max(0,Math.min(1,opacity)),0,0,0]));
    const bindGroup=device.createBindGroup({
      layout:_gpuState.composeBindGroupLayout,
      entries:[
        {binding:0,resource:_gpuState.composeSampler},
        {binding:1,resource:srcTexture.createView()},
        {binding:2,resource:{buffer:_gpuState.composeUniformBuffer}},
      ],
    });
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({
      colorAttachments:[{view:targetView,loadOp:loadOp||'load',storeOp:'store'}],
    });
    pass.setPipeline(_gpuState.composePipeline);
    pass.setBindGroup(0,bindGroup);
    pass.draw(6);
    pass.end();
    _gpuState.queue.submit([encoder.finish()]);
    return true;
  },
  // Revised GPU integration: the GPU-owned replacement for the rejected
  // _commitGpuStroke() CPU-side copy. Blends accumTexture (this
  // stroke's finished dabs, already fully flushed by endStroke() before
  // this is called) onto layerTexture — the persistent per-layer
  // surface — at brushOpacity, entirely via _runComposePass() above. No
  // getImageData/readPixels, no 2D canvas context, no activeC. Once
  // this returns, layerTexture (not activeC) holds the authoritative
  // result of the stroke, matching CpuBrushRenderer's contract of
  // "committed strokes live on the renderer's own surface".
  _composeStrokeOntoLayer(opacity){
    const w=_gpuState.accumTextureWidth,h=_gpuState.accumTextureHeight;
    if(!w||!h) return false;
    if(!this._ensureLayerTexture(w,h)) return false;
    if(!_gpuState.accumTexture||!_gpuState.layerTexture) return false;
    return this._runComposePass(_gpuState.accumTexture,_gpuState.layerTexture.createView(),opacity,'load');
  },
  // Revised GPU integration: refreshes the swapchain canvas (gpu-canvas)
  // so it always shows layerTexture's committed content, optionally
  // blended with the in-progress stroke on top (live preview) without
  // ever writing that in-progress blend into layerTexture itself. This
  // is what keeps getLayerSurface()'s returned canvas correct both
  // mid-stroke (committed + live stroke) and at rest (committed only).
  _presentLayerToCanvas(includeLiveStroke,liveOpacity){
    if(!_gpuState.context||!_gpuState.canvas) return false;
    const currentTexture=_gpuState.context.getCurrentTexture();
    if(!currentTexture) return false;
    const w=_gpuState.canvas.width,h=_gpuState.canvas.height;
    if(!this._ensureLayerTexture(w,h)) return false;
    const encoder=_gpuState.device.createCommandEncoder();
    encoder.copyTextureToTexture({texture:_gpuState.layerTexture},{texture:currentTexture},{width:w,height:h});
    _gpuState.queue.submit([encoder.finish()]);
    if(includeLiveStroke && _gpuState.accumTexture){
      this._runComposePass(_gpuState.accumTexture,currentTexture.createView(),liveOpacity,'load');
    }
    return true;
  },
  // Architecture fix: returns this renderer's current stroke-scratch
  // surface as a CanvasImageSource, mirroring the (private, brush-
  // engine.js-owned) _strokeCanvas that CpuBrushRenderer's dabs land
  // on. brush-engine.js uses this — via BrushRenderer.active — to
  // composite the in-progress/finished GPU stroke onto activeC through
  // the exact same drawImage()+globalAlpha+blend-mode pipeline
  // (_drawBrushComposite) CPU strokes already go through, instead of
  // gpu-canvas being shown to the user directly as a competing surface.
  // Returns the live #gpu-canvas element itself (already kept in sync
  // with accumTexture by every flush's copyTextureToTexture blit) —
  // no pixel readback, no new texture/buffer, no duplicate render.
  // Revised GPU integration: the canvas this returns is now kept
  // current with layerTexture (committed strokes) at rest, and with
  // layerTexture + the in-progress stroke blended on top while a
  // stroke is active (see flushDabQueue()'s _presentLayerToCanvas(true,
  // ...) call and endStroke()'s _presentLayerToCanvas(false,...) call
  // above) — never with accumTexture alone. This is this renderer's
  // authoritative drawing surface, the GPU counterpart of activeC.
  getLayerSurface(){
    return _gpuState.canvas||null;
  },
  // Retained for any existing caller still asking for "the stroke
  // surface" by its old name; identical to getLayerSurface() now that
  // the canvas always reflects the persistent, composited result rather
  // than a disconnected per-stroke scratch. New code should prefer
  // BrushRenderer.getActiveSurface() (which calls getLayerSurface()).
  getStrokeCanvas(){
    return this.getLayerSurface();
  },
  // Phase 5C: converts the dab's existing pixel-space position/radius
  // (d.x, d.y, d.r — the same values CpuBrushRenderer.drawDab() already
  // receives; no new fields are read from d) into a single NDC quad and
  // uploads it to the vertex buffer. No pressure, hardness, rotation,
  // roundness, or texture is read or applied — a plain axis-aligned
  // square the size of the dab radius.
  // Phase 5F: same pixel->NDC math as before (unchanged formula — see
  // Phase 5D verification), but now writes one dab's 12 floats into a
  // caller-provided Float32Array at a given vertex offset instead of
  // uploading a whole buffer itself, so a full batch of dabs can be
  // assembled into one typed array and uploaded in a single
  // queue.writeBuffer() call from flushDabQueue().
  // Phase 6C: brush-engine.js's _stampDab() already resolves the
  // pressure-controlled radius once, via _getEffectiveBrushParams(e) ->
  // _computeEffectiveParams(e), and stores it as d.r on the very same
  // dab object that is handed to CpuBrushRenderer.drawDab(d,...) AND
  // BrushRenderer.drawDab(d,...) (the dispatcher) for the active
  // renderer — GpuBrushRenderer.drawDab() enqueues that exact object
  // (_enqueueDab(), unmodified) and this method reads d.r straight off
  // it below. So the quad this method emits is already sized from the
  // identical pressure-scaled radius the CPU path uses for the same
  // dab — no pressure is recomputed from pointer/pressure data here,
  // no second pipeline, dab order in the queue is untouched. Verified
  // by inspection; no functional change was required in this method.
  // Phase 6E: writes 6 floats per vertex now (2 position + 4 rgba)
  // instead of 2 — reads d.rgb (0-255, same array CpuBrushRenderer
  // already reads for its fillStyle) and d.alpha (0-1, same value
  // CPU already applies via ctx.globalAlpha) and writes them
  // unmodified, per vertex, alongside the existing NDC position math
  // (untouched). No new fields are read from d; hardness/roundness/
  // rotation/texture/erase-compositing are still not read here — see
  // the arr[offset+N] color writes below for exactly what's added.
  // Phase 6F: writes 8 floats per vertex now (2 position + 4 rgba + 2
  // uv) instead of 6 — uv is the vertex's local position within the
  // quad in [-1,1], i.e. how far this corner is from the dab center as
  // a fraction of its radius, letting the fragment shader mask the
  // quad into a circle (length(uv) <= 1). Color writes (Phase 6E) and
  // position/NDC math are unchanged.
  _writeDabQuadInto(arr,offset,d,w,h){
    const r=(d&&typeof d.r==='number')?d.r:1;
    const cx=(d&&typeof d.x==='number')?d.x:0;
    const cy=(d&&typeof d.y==='number')?d.y:0;
    const rgb=(d&&d.rgb)?d.rgb:[0,0,0];
    const cr=Math.max(0,Math.min(1,(rgb[0]||0)/255));
    const cg=Math.max(0,Math.min(1,(rgb[1]||0)/255));
    const cb=Math.max(0,Math.min(1,(rgb[2]||0)/255));
    const ca=(d&&typeof d.alpha==='number')?Math.max(0,Math.min(1,d.alpha)):1;

    const toNdc=(px,py)=>[ (px/w)*2-1, 1-(py/h)*2 ];

    const [x0,y0]=toNdc(cx-r, cy-r);
    const [x1,y1]=toNdc(cx+r, cy-r);
    const [x2,y2]=toNdc(cx+r, cy+r);
    const [x3,y3]=toNdc(cx-r, cy+r);

    const stride=8;
    const writeVertex=(base,x,y,u,v)=>{
      arr[base+0]=x; arr[base+1]=y;
      arr[base+2]=cr; arr[base+3]=cg; arr[base+4]=cb; arr[base+5]=ca;
      arr[base+6]=u; arr[base+7]=v;
    };
    writeVertex(offset+0*stride, x0,y0, -1,-1);
    writeVertex(offset+1*stride, x1,y1,  1,-1);
    writeVertex(offset+2*stride, x2,y2,  1, 1);
    writeVertex(offset+3*stride, x0,y0, -1,-1);
    writeVertex(offset+4*stride, x2,y2,  1, 1);
    writeVertex(offset+5*stride, x3,y3, -1, 1);
  },
  // Phase 5E: pushes the raw dab data (exact object reference, no
  // transform/copy of its fields — "queue only raw dab data already
  // provided by drawDab()") onto the queue. Enforces
  // dabQueueMaxSize so an app that never calls flushDabQueue() can't
  // grow this unboundedly; anything past the cap is dropped and
  // counted, never silently discarded without a trace.
  // Phase 6D: this is also where stabilization parity with the CPU
  // renderer lives — or rather, doesn't need to, because there's
  // nothing GPU-specific to add. d.x/d.y arrive here already fully
  // resolved by brush-engine.js's stabilizer/arc-length-conditioner
  // pipeline (_stabilizePoint -> _baselineConditionerPush ->
  // _curveAddPoint -> _stampDab), the exact same pipeline that
  // produces the x/y CpuBrushRenderer.drawDab() draws with — this
  // method (and this file generally) never reads a PointerEvent, never
  // calls getPos()/_stabilizePoint(), and pushes the object reference
  // it's given unmodified. Verified by inspection; no functional
  // change was required.
  _enqueueDab(d){
    if(_gpuState.dabQueue.length>=_gpuState.dabQueueMaxSize){
      _gpuState.droppedDabs+=1;
      return false;
    }
    _gpuState.dabQueue.push(d);
    _gpuState.queuedDabs=_gpuState.dabQueue.length;
    return true;
  },
  // Phase 5E: flush method. Drains the queue built up by drawDab()'s
  // Phase 5E staging step. Preparation only — this phase does not
  // introduce a real batched multi-dab-per-pass draw (that would mean
  // building/altering the render pipeline, which Phase 5E explicitly
  // must not do). What actually renders on screen already happened via
  // Phase 5D's unchanged immediate per-dab submission inside drawDab();
  // flushDabQueue() only clears the bookkeeping queue and updates
  // diagnostics (submittedDabs, lastBatchTime) to mark that batch as
  // accounted for. Safe to call at any time, including when the queue
  // is empty (a no-op batch) or when the GPU isn't initialized.
  // Phase 5F: real batched GPU submission. Consumes every dab
  // currently in the queue and submits them in exactly one GPU command
  // buffer / one render pass / one draw call — this is the actual
  // "efficient multiple-dab submission" the queue was built for in
  // Phase 5E. Reuses the existing dab pipeline (createDabPipeline(),
  // unchanged shape/shader/appearance) and the existing
  // createCommandEncoder()/submitCommands() helpers from Phase 3D — no
  // new rendering pipeline is introduced. The queue is only cleared
  // after a successful submission ("submit all queued dabs before
  // clearing the queue"); on failure the queue is left untouched so a
  // caller could inspect/retry, and the failure is counted in
  // failedBatches (batch-level) and failedDabs (dab-level, reusing the
  // Phase 5D counter — "keep failed dabs counted"). Never throws, never
  // switches the active renderer, never touches CPU state. Safe to
  // call with an empty queue (a true no-op — no GPU work, no counters
  // touched) or when the GPU isn't initialized (also a no-op, since
  // there is nothing to submit against).
  // Phase 5H: reason is a plain diagnostic string identifying what
  // triggered this flush ('stroke-end', 'frame', 'manual', etc.) —
  // purely informational, it does not change how the flush behaves.
  // Every call, including the empty-queue no-op and every failure
  // path, records {lastFlushReason, lastFlushResult, lastFlushTime}
  // before returning, via the shared _recordFlush() helper, so the
  // most recent flush attempt is always inspectable regardless of
  // outcome or trigger.
  // Phase 5R: flushDabQueue() is measured for performance diagnostics.
  // The implementation itself (every check, early return, and the
  // try/catch around the actual GPU submission) is renamed to
  // _flushDabQueueImplTimed verbatim and unchanged; this wrapper only
  // records elapsed time around it and accumulates the result — no
  // rendering/batching logic added, removed, or reordered.
  flushDabQueue(reason){
    const __t0=this._now();
    try{
      return this._flushDabQueueImplTimed(reason);
    }finally{
      const __duration=this._now()-__t0;
      _gpuState.lastFlushDuration=__duration;
      _gpuState.totalFlushTime+=__duration;
      _gpuState.flushCount+=1;
    }
  },
  _flushDabQueueImplTimed(reason){
    const flushReason=reason||'unspecified';
    const dabCount=_gpuState.dabQueue.length;
    if(dabCount===0){
      this._recordFlush(flushReason,true);
      return true;
    }
    try{
      if(!_gpuState.initialized){
        this._recordFlush(flushReason,false);
        return false;
      }
      if(!_gpuState.device || !_gpuState.context || !_gpuState.canvas){
        this._recordFlush(flushReason,false);
        return false;
      }
      const canvas=_gpuState.canvas;
      if(!canvas.width || !canvas.height){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      if(!this.createDabPipeline()){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      if(!this._ensureDabBatchCapacity(dabCount)){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      // Phase 6B: ensure the persistent accumulation texture (see
      // _gpuState.accumTexture) exists and matches the canvas's current
      // size before drawing into it.
      if(!this._ensureAccumTexture(canvas.width,canvas.height)){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }

      // Build the whole batch's vertex data in one typed array and
      // upload it in a single queue.writeBuffer() call, instead of one
      // write per dab.
      // Phase 6E: 36 floats/dab now (6 vertices * 6 floats: 2 position +
      // 4 rgba), up from 12 (6 vertices * 2 position-only floats) —
      // matches _writeDabQuadInto()'s new per-vertex stride and
      // createDabPipeline()'s buffer layout. Batch-per-draw-call
      // structure is unchanged.
      // Phase 6F: 48 floats/dab now (6 vertices * 8 floats: 2 position +
      // 4 rgba + 2 uv), up from 36 — matches _writeDabQuadInto()'s new
      // per-vertex stride and createDabPipeline()'s buffer layout.
      // Batch-per-draw-call structure is unchanged.
      const verts=new Float32Array(dabCount*48);
      for(let i=0;i<dabCount;i++){
        this._writeDabQuadInto(verts,i*48,_gpuState.dabQueue[i],canvas.width,canvas.height);
      }
      _gpuState.queue.writeBuffer(_gpuState.dabVertexBuffer,0,verts);

      if(!this.createCommandEncoder()){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      const currentTexture=_gpuState.context.getCurrentTexture();
      if(!currentTexture){
        _gpuState.commandEncoder=null;
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      // Phase 6B: this batch is now drawn into the persistent
      // accumulation texture, not directly into the swapchain's
      // currentTexture — loadOp:'load' here composites onto everything
      // previously flushed into accumTexture (this stroke's earlier
      // batches AND every prior stroke's), since it is the same texture
      // object every time rather than a fresh per-frame swapchain
      // texture.
      const view=_gpuState.accumTexture.createView();
      const pass=_gpuState.commandEncoder.beginRenderPass({
        colorAttachments: [{
          view,
          loadOp: 'load',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(_gpuState.dabPipeline);
      pass.setVertexBuffer(0,_gpuState.dabVertexBuffer);
      // Single draw call for the entire batch: 6 vertices per dab,
      // dabCount dabs, no indices, no instancing.
      pass.draw(dabCount*6);
      pass.end();
      if(!this.submitCommands()){
        _gpuState.failedBatches+=1;
        _gpuState.failedDabs+=dabCount;
        this._recordFlush(flushReason,false);
        return false;
      }
      // Revised GPU integration: the swapchain no longer receives a raw
      // copy of accumTexture alone (that showed only the in-progress
      // stroke, disconnected from anything already committed). Instead
      // the canvas is refreshed from layerTexture (the persistent,
      // committed surface) with accumTexture blended on top at
      // brushOpacity — matching CpuBrushRenderer's live-preview
      // contract of "committed content + in-progress stroke, blended,
      // never written back to the committed surface". See
      // _presentLayerToCanvas()/_composeStrokeOntoLayer() above.
      const liveOpacity=(typeof brushOpacity==='number')?brushOpacity:1;
      this._presentLayerToCanvas(true,liveOpacity);

      _gpuState.dabsDrawn+=dabCount;
      _gpuState.submittedDabs+=dabCount;
      _gpuState.batchesSubmitted+=1;
      _gpuState.lastDabTime=Date.now();
      _gpuState.lastBatchTime=Date.now();
      _gpuState.dabQueue.length=0;
      _gpuState.queuedDabs=0;
      this._recordFlush(flushReason,true);
      return true;
    }catch(err){
      // Any GPU-side failure (e.g. device lost, validation error) lands
      // here. Never throws out of flushDabQueue(), never switches the
      // active renderer, never touches CPU state — just counted and
      // reported. Queue is intentionally left intact on this path too.
      _gpuState.failedBatches+=1;
      _gpuState.failedDabs+=dabCount;
      _gpuState.commandEncoder=null;
      // Phase 5T: reuse the shared error recorder instead of duplicating
      // bookkeeping logic — diagnostics only, does not change the
      // counters/behavior above.
      this._recordError(err||'flush-failed');
      this._recordFlush(flushReason,false);
      return false;
    }
  },
  // Phase 5H: shared helper — records plain diagnostic flush metadata
  // only (string reason, boolean result, timestamp). Never touches any
  // GPU resource/object and never touches counters (those are updated
  // by flushDabQueue() itself, right next to the GPU work they
  // describe).
  _recordFlush(reason,result){
    _gpuState.lastFlushReason=reason;
    _gpuState.lastFlushResult=result;
    _gpuState.lastFlushTime=Date.now();
  },
  // Phase 5H: explicit manual flush entry point. Purely a named,
  // intentional way for external code (dev tools, tests, an explicit
  // "flush now" UI action) to trigger the exact same flushDabQueue()
  // path already used by endStroke()/flushPendingDabs() — no
  // duplicate/parallel submission logic, no new pipeline, and it is
  // never called automatically from anywhere in this file. Tags the
  // flush metadata with reason 'manual' so it's distinguishable from
  // stroke-end/frame flushes in diagnostics.
  manualFlush(){
    return this.flushDabQueue('manual');
  },
  // Phase 5E/5F: read-only queue diagnostics. Exposes only plain
  // numbers/timestamps, never the queued dab objects or any GPU
  // resource.
  getQueueStats(){
    return {
      queuedDabs: _gpuState.queuedDabs,
      submittedDabs: _gpuState.submittedDabs,
      droppedDabs: _gpuState.droppedDabs,
      batchesSubmitted: _gpuState.batchesSubmitted,
      failedBatches: _gpuState.failedBatches,
      lastBatchTime: _gpuState.lastBatchTime
    };
  },
  // Phase 5H: read-only flush metadata diagnostics. Exposes only plain
  // strings/booleans/timestamps — never any GPU resource/object.
  getFlushDiagnostics(){
    return {
      lastFlushReason: _gpuState.lastFlushReason,
      lastFlushResult: _gpuState.lastFlushResult,
      lastFlushTime: _gpuState.lastFlushTime
    };
  },
  // Phase 5I: frame lifecycle tracking — diagnostics only. beginFrame()
  // just counts and timestamps; it creates no GPU resources and does
  // not touch/reset any existing counter (dabsReceived, dabsDrawn,
  // submittedDabs, droppedDabs, batchesSubmitted, failedBatches,
  // failedDabs, strokesReceived, or the flush-metadata fields are all
  // left exactly as they were).
  beginFrame(){
    _gpuState.framesStarted+=1;
    _gpuState.lastFrameStartTime=Date.now();
  },
  // Phase 5I: endFrame() wires the existing flush path
  // (flushDabQueue(), unchanged since Phase 5F/5H) into a frame-end
  // lifecycle point, tagged with reason 'frame-end' so it's
  // distinguishable in getFlushDiagnostics() from a stroke-end or
  // manual flush. No new rendering path, no pipeline/buffer/texture
  // work beyond what flushDabQueue() already does, and it never
  // switches the active renderer.
  endFrame(){
    const __t0=this._now();
    const result=this.flushDabQueue('frame-end');
    _gpuState.framesEnded+=1;
    _gpuState.lastFrameEndTime=Date.now();
    _gpuState.lastFrameFlushResult=result;
    // Phase 5Q: session-lifetime tracking — a frame ending counts as
    // session activity. Plain counter/timestamp only, no new rendering
    // path and no change to the flush result computed above.
    _gpuState.sessionFrameCount+=1;
    _gpuState.sessionLastActivity=Date.now();
    // Phase 5R: performance timing diagnostics — measures this whole
    // endFrame() call (including the flushDabQueue() it wires in
    // above, which is separately measured/accumulated by
    // flushDabQueue() itself). Plain elapsed-time bookkeeping only, no
    // rendering/behavior change.
    const __duration=this._now()-__t0;
    _gpuState.lastFrameDuration=__duration;
    _gpuState.totalFrameTime+=__duration;
    _gpuState.frameCount+=1;
    return result;
  },
  // Phase 5I: read-only frame lifecycle diagnostics. Exposes only
  // plain numbers/booleans/timestamps, never any GPU resource/object.
  getFrameLifecycleDiagnostics(){
    return {
      framesStarted: _gpuState.framesStarted,
      framesEnded: _gpuState.framesEnded,
      lastFrameStartTime: _gpuState.lastFrameStartTime,
      lastFrameEndTime: _gpuState.lastFrameEndTime,
      lastFrameFlushResult: _gpuState.lastFrameFlushResult
    };
  },
  // Phase 5O: renderer-present notification. Called by the dispatcher
  // (BrushRenderer.presentActiveRenderer()) after the engine's own
  // authoritative recomposite()/presentation step has already
  // completed — this method itself never submits GPU work, never
  // flushes any queue, never creates a command encoder, pipeline,
  // shader, buffer, or texture. It only increments a diagnostics
  // counter and records a timestamp, then returns true.
  presentFrame(){
    const __t0=this._now();
    _gpuState.presentedFrames+=1;
    _gpuState.lastPresentTime=Date.now();
    // Phase 5R: performance timing diagnostics — measures this
    // presentFrame() call itself. Still no GPU submission, flush, or
    // resource work; plain elapsed-time bookkeeping only.
    const __duration=this._now()-__t0;
    _gpuState.lastPresentDuration=__duration;
    _gpuState.totalPresentTime+=__duration;
    _gpuState.presentCount+=1;
    return true;
  },
  // Phase 5O: read-only presentation diagnostics. Exposes only plain
  // numbers/timestamps, never any GPU resource/object.
  getPresentationDiagnostics(){
    return {
      presentedFrames: _gpuState.presentedFrames,
      lastPresentTime: _gpuState.lastPresentTime
    };
  },
  // Phase 5R: read-only performance timing diagnostics. Exposes only
  // plain numbers — never any GPU resource/object, and never the raw
  // cumulative totals (totalFlushTime/totalFrameTime/totalPresentTime
  // stay internal to _gpuState); averages are computed on demand here
  // from the totals/counts rather than stored.
  getPerformanceDiagnostics(){
    const avg=(total,count)=>count>0?total/count:0;
    return {
      lastFlushDuration: _gpuState.lastFlushDuration,
      lastFrameDuration: _gpuState.lastFrameDuration,
      lastPresentDuration: _gpuState.lastPresentDuration,
      averageFlushDuration: avg(_gpuState.totalFlushTime,_gpuState.flushCount),
      averageFrameDuration: avg(_gpuState.totalFrameTime,_gpuState.frameCount),
      averagePresentDuration: avg(_gpuState.totalPresentTime,_gpuState.presentCount),
      flushCount: _gpuState.flushCount,
      frameCount: _gpuState.frameCount,
      presentCount: _gpuState.presentCount
    };
  },
  // Phase 5P: dispatcher-level renderer-idle notification lives on
  // BrushRenderer (the dispatcher), not here — see BrushRenderer.
  // notifyRendererIdle() below. rendererIdle() itself, the
  // GPU-specific implementation, is defined further down alongside
  // getIdleDiagnostics().
  // Phase 5P: renderer-idle notification. Called by the dispatcher
  // (BrushRenderer.notifyRendererIdle()) after the engine's own
  // authoritative stroke-completion sequence (endStroke ->
  // flushActiveRenderer -> recomposite -> presentActiveRenderer) has
  // already finished — this method itself performs no flush, no
  // command submission, and creates or destroys no GPU resource (no
  // shader, pipeline, buffer, or texture). It only increments a
  // diagnostics counter and records a timestamp, then returns true.
  rendererIdle(){
    _gpuState.idleTransitions+=1;
    _gpuState.lastIdleTime=Date.now();
    // Phase 5Q: session-lifetime tracking — going idle still counts as
    // session activity (it marks when the session was last touched,
    // not when it was busy). Plain timestamp only.
    _gpuState.sessionLastActivity=Date.now();
    return true;
  },
  // Phase 5P: read-only idle diagnostics. Exposes only plain
  // numbers/timestamps, never any GPU resource/object.
  getIdleDiagnostics(){
    return {
      idleTransitions: _gpuState.idleTransitions,
      lastIdleTime: _gpuState.lastIdleTime
    };
  },
  // Phase 5Q: read-only renderer-session diagnostics. Exposes only
  // plain numbers/timestamps, never any GPU resource/object.
  getSessionDiagnostics(){
    return {
      sessionStartedAt: _gpuState.sessionStartedAt,
      sessionLastActivity: _gpuState.sessionLastActivity,
      sessionStrokeCount: _gpuState.sessionStrokeCount,
      sessionFrameCount: _gpuState.sessionFrameCount
    };
  },
  // Phase 5G: stroke lifecycle integration. beginStroke() clears any
  // stale, not-yet-flushed queue left over from a previous stroke
  // (e.g. if that stroke's endStroke() flush failed — see
  // flushDabQueue()'s "queue left intact on failure" behavior) so a
  // new stroke never accidentally batches a prior stroke's dabs
  // together with its own. This only touches the live queue array —
  // it does NOT clear any diagnostic history counter (dabsReceived,
  // dabsDrawn, submittedDabs, droppedDabs, batchesSubmitted,
  // failedBatches, failedDabs all untouched).
  beginStroke(){
    _gpuState.inStroke=true;
    _gpuState.strokesReceived+=1;
    if(_gpuState.dabQueue.length>0){
      _gpuState.dabQueue.length=0;
      _gpuState.queuedDabs=0;
    }
    // Reset the per-stroke accumulation surface (see
    // _clearAccumTexture()'s comment) so this stroke starts from blank,
    // exactly like _strokeCtx.clearRect() does for CpuBrushRenderer's
    // scratch canvas in brush-engine.js's _ensureStrokeCanvas(). A
    // no-op the first time (accumTexture doesn't exist yet — the first
    // flush's _ensureAccumTexture() call creates and clears it). Note
    // this only clears the stroke scratch — layerTexture, the
    // persistent surface, is untouched here.
    this._clearAccumTexture();
    // Phase 5Q: session-lifetime tracking. A session begins at the
    // first stroke since the last reset() (sessionStartedAt stays
    // null, and is only set once, until reset() clears it again);
    // every stroke increments the cumulative session stroke count and
    // updates the last-activity timestamp. Plain counters/timestamps
    // only — no new rendering path.
    if(_gpuState.sessionStartedAt===null){
      _gpuState.sessionStartedAt=Date.now();
    }
    _gpuState.sessionStrokeCount+=1;
    _gpuState.sessionLastActivity=Date.now();
  },
  // Phase 5G: endStroke() now submits whatever dabs this stroke queued
  // by calling the existing flushDabQueue() (Phase 5F) — no new
  // rendering path, just wiring the existing batch-submission method
  // into the existing stroke-end lifecycle point so a stroke's dabs
  // are guaranteed to reach the GPU before the stroke is considered
  // complete. Returns flushDabQueue()'s own success/failure boolean.
  endStroke(){
    _gpuState.inStroke=false;
    const flushed=this.flushDabQueue('stroke-end');
    // Revised GPU integration: this is the GPU renderer's own commit
    // step — the direct replacement for the rejected
    // brush-engine.js._commitGpuStroke() CPU-side copy. It runs
    // regardless of flushDabQueue()'s result (a stroke with zero queued
    // dabs at stroke-end, e.g. a single already-flushed dab, is a valid
    // no-op-composite, not a failure) as long as there is something in
    // accumTexture to compose. brushOpacity is read directly (shared
    // classic-script scope with brush-engine.js/core-state.js — see
    // file header), the same global CpuBrushRenderer's commit path
    // reads via ctx.globalAlpha in _commitStrokeCanvas().
    const opacity=(typeof brushOpacity==='number')?brushOpacity:1;
    this._composeStrokeOntoLayer(opacity);
    this._presentLayerToCanvas(false,0);
    return flushed;
  },
  // Phase 6F.8: GPU synchronization for CPU readback points.
  // Every queue.submit() above (flushDabQueue's batch submit,
  // _composeStrokeOntoLayer's compose pass, _presentLayerToCanvas's copy)
  // only enqueues work — it returns before the GPU has actually finished
  // executing it. A CPU-side readback that runs right after (e.g.
  // saveActiveToKey()'s ctx.drawImage(activeSurface,...)) can therefore
  // capture gpu-canvas mid-flight, before the just-submitted commands have
  // landed, silently reading a stale/partial frame — this is the
  // "previous stroke disappears" bug. onGPUIdle() resolves once every
  // command submitted so far has completed, via the standard WebGPU
  // completion signal. It deliberately does NOT wait per-dab (that would
  // reintroduce a stall on every brush dab) — callers must only await this
  // at explicit CPU-readback sites, never inside the dab-drawing loop.
  // No shader, pipeline, or per-dab timing is touched.
  async onGPUIdle(){
    const device=_gpuState.device;
    if(!device||!device.queue||typeof device.queue.onSubmittedWorkDone!=='function') return true;
    try{
      await device.queue.onSubmittedWorkDone();
      return true;
    }catch(e){
      console.warn('[GpuBrushRenderer] onSubmittedWorkDone failed:',e);
      return false;
    }
  },
  // Phase 5G: optional frame-lifecycle helper. Flushes the queue only
  // if there's actually something queued ("flush queued dabs only when
  // needed") — an empty queue is a true no-op, no GPU work performed,
  // no counters touched. Delegates to the existing flushDabQueue()
  // (Phase 5F) rather than creating a second/duplicate submission path.
  flushPendingDabs(){
    if(_gpuState.dabQueue.length===0) return true;
    return this.flushDabQueue('frame');
  },
  invalidateCaches(which){
    // intentionally empty
  },
  getCacheStats(){
    return { analytic:0, softRound:0, tip:0 };
  },
  getLineContinuity(){
    return _gpuState.lineContinuity;
  },
  setLineContinuity(value){
    _gpuState.lineContinuity=value;
  },
  getTipAlphaBuffer(){
    return _gpuState.tipAlphaBuffer;
  },
  setTipAlphaSeedPixels(value){
    _gpuState.tipAlphaSeedPixels=value;
  },
  setTipAlphaInvalidationReason(value){
    _gpuState.tipAlphaInvalidationReason=value;
  },
  getTipAlphaInvalidationReason(){
    return _gpuState.tipAlphaInvalidationReason;
  },
  // Phase 3A: initialization/lifecycle only — detects WebGPU support,
  // requests an adapter and device, and stores them in the renderer's
  // private _gpuState. Does NOT create a pipeline, shader, texture, or
  // buffer, and does NOT render anything. Returns a Promise<boolean>:
  // true on success, false on any failure (unsupported browser, adapter
  // unavailable, device request rejected, etc.). Never throws — every
  // failure path is caught internally so no exception can escape to the
  // caller. Calling this does NOT switch the active renderer; that
  // remains an explicit, separate decision via
  // BrushRenderer.setActiveRenderer(), which this method never calls.
  async initialize(){
    if(_gpuState.initialized) return true;
    try{
      if(!navigator||!navigator.gpu){
        _gpuState.initError='webgpu-unsupported';
        this._recordError('webgpu-unsupported');
        return false;
      }
      const adapter=await navigator.gpu.requestAdapter();
      if(!adapter){
        _gpuState.initError='adapter-unavailable';
        this._recordError('adapter-unavailable');
        return false;
      }
      const device=await adapter.requestDevice();
      if(!device){
        _gpuState.initError='device-unavailable';
        this._recordError('device-unavailable');
        return false;
      }
      _gpuState.adapter=adapter;
      _gpuState.device=device;
      _gpuState.queue=device.queue;
      // Phase 3B: capability discovery only — reads information the
      // adapter/device already expose via their `features`/`limits`
      // properties and GPU.getPreferredCanvasFormat(). Does not request
      // any optional feature and does not enable any optional limit.
      _gpuState.adapterFeatures=adapter.features?Array.from(adapter.features):null;
      _gpuState.adapterLimits=adapter.limits?{...adapter.limits}:null;
      _gpuState.deviceFeatures=device.features?Array.from(device.features):null;
      _gpuState.deviceLimits=device.limits?{...device.limits}:null;
      _gpuState.preferredCanvasFormat=(typeof navigator.gpu.getPreferredCanvasFormat==='function')?navigator.gpu.getPreferredCanvasFormat():null;
      // Phase 3C: locate the app's drawing canvas.
      // Phase 5V: this now looks for the DEDICATED WebGPU canvas
      // (#gpu-canvas), NOT active-canvas. active-canvas is permanently
      // bound to a 2D context in core-state.js (const ctx=
      // activeC.getContext('2d')) — a canvas element can only ever be
      // bound to one context type for its lifetime, so requesting a
      // 'webgpu' context on that same element always returns null (see
      // the Phase 5 GPU-init investigation). gpu-canvas is a separate
      // element added in index.html specifically so this call can
      // eventually succeed; it is not yet used for any rendering, and
      // this file still does not touch or reconfigure the 2D context
      // that CpuBrushRenderer uses. No DOM/global fallback to
      // active-canvas is used here — activeC intentionally never
      // appears in this lookup.
      const canvas=(typeof document!=='undefined')?document.getElementById('gpu-canvas'):null;
      if(!canvas){
        _gpuState.initError='canvas-unavailable';
        this._recordError('canvas-unavailable');
        _gpuState.canvas=null;
        _gpuState.context=null;
        _gpuState.configured=false;
        return false;
      }
      const context=canvas.getContext('webgpu');
      if(!context){
        _gpuState.initError='webgpu-context-unavailable';
        this._recordError('webgpu-context-unavailable');
        _gpuState.canvas=null;
        _gpuState.context=null;
        _gpuState.configured=false;
        return false;
      }
      _gpuState.canvas=canvas;
      _gpuState.context=context;
      _gpuState.canvasFormat=_gpuState.preferredCanvasFormat;
      // Configure the context exactly once, using the device from Phase
      // 3A and the preferred format discovered in Phase 3B. No texture,
      // buffer, shader, pipeline, bind group, command encoder, or render
      // pass is created here — configuration only.
      context.configure({
        device: device,
        format: _gpuState.canvasFormat,
        alphaMode: 'premultiplied',
      });
      _gpuState.configured=true;
      _gpuState.initialized=true;
      _gpuState.initError=null;
      return true;
    }catch(err){
      _gpuState.initError=(err&&err.message)||'gpu-init-failed';
      this._recordError(err||'gpu-init-failed');
      _gpuState.adapter=null;
      _gpuState.device=null;
      _gpuState.queue=null;
      _gpuState.adapterFeatures=null;
      _gpuState.adapterLimits=null;
      _gpuState.deviceFeatures=null;
      _gpuState.deviceLimits=null;
      _gpuState.preferredCanvasFormat=null;
      _gpuState.canvas=null;
      _gpuState.context=null;
      _gpuState.canvasFormat=null;
      _gpuState.configured=false;
      _gpuState.initialized=false;
      return false;
    }
  },
  // Phase 3D: minimal command-submission skeleton. Neither method is
  // called anywhere yet — they exist only as infrastructure for a future
  // rendering phase. No shader, pipeline, bind group, texture, buffer,
  // render pass, or compute pass is created by either method.
  //
  // Creates a fresh command encoder from the initialized device and
  // stores it in _gpuState.commandEncoder. Clears any stale
  // commandBuffer left over from a prior submitCommands() call. Returns
  // false (no-op) if the GPU renderer isn't initialized or has no
  // device; returns true after the encoder is created and stored.
  createCommandEncoder(){
    if(!_gpuState.initialized) return false;
    if(!_gpuState.device) return false;
    _gpuState.commandEncoder=_gpuState.device.createCommandEncoder();
    // Phase 5S: diagnostics only — records the createCommandEncoder() above.
    _gpuState.commandEncodersCreated++;
    _gpuState.commandBuffer=null;
    return true;
  },
  // Finishes the current command encoder into a single command buffer,
  // submits that one buffer to the queue, stores it temporarily in
  // _gpuState.commandBuffer, and clears _gpuState.commandEncoder back to
  // null. Returns false (no-op) if there is no command encoder to
  // finish; returns true after submission.
  submitCommands(){
    if(!_gpuState.commandEncoder) return false;
    const commandBuffer=_gpuState.commandEncoder.finish();
    _gpuState.queue.submit([commandBuffer]);
    _gpuState.commandBuffer=commandBuffer;
    _gpuState.commandEncoder=null;
    return true;
  },
  // Phase 3E: minimal render-pass infrastructure. Neither method is
  // called anywhere yet — they exist only as infrastructure for a future
  // rendering phase. No pipeline, shader module, bind group, or GPU
  // buffer is created by either method; the only texture involved is the
  // current swapchain texture acquired from the already-configured
  // canvas context.
  //
  // Requires an existing command encoder (from createCommandEncoder()).
  // Acquires the current swapchain texture from the configured canvas
  // context, creates a view from it, stores both in _gpuState, and opens
  // a render pass on the command encoder with a single color attachment
  // that clears to a transparent color and stores the result. Returns
  // false (no-op) if there's no command encoder or no configured
  // context; returns true once the render pass has begun.
  beginRenderPass(){
    if(!_gpuState.commandEncoder) return false;
    if(!_gpuState.context) return false;
    const currentTexture=_gpuState.context.getCurrentTexture();
    if(!currentTexture) return false;
    const currentTextureView=currentTexture.createView();
    _gpuState.currentTexture=currentTexture;
    _gpuState.currentTextureView=currentTextureView;
    _gpuState.renderPass=_gpuState.commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: currentTextureView,
        clearValue: { r:0, g:0, b:0, a:0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    // Phase 5S: diagnostics only — records the beginRenderPass() above.
    _gpuState.renderPassesStarted++;
    // Phase 3I: bind the pipeline to the freshly-opened render pass, if
    // one exists. This only sets the pipeline state on the pass — it
    // does not issue draw()/drawIndexed()/drawIndirect()/
    // dispatchWorkgroups(), and no buffers, bind groups, textures, or
    // samplers are created here or anywhere else. Returns false if
    // there's no render pass or no pipeline.
    if(!_gpuState.renderPass) return false;
    if(!_gpuState.pipeline) return false;
    _gpuState.renderPass.setPipeline(_gpuState.pipeline);
    // Phase 3J: issue exactly one draw call to verify the pipeline
    // executes. Draws the 3 hardcoded fullscreen-triangle vertices from
    // the vertex shader — no vertex/index/instance/uniform/storage
    // buffers, bind groups, textures, or samplers are involved.
    _gpuState.renderPass.draw(3);
    return true;
  },
  // Safely ends the current render pass (if one is open) and clears the
  // stored render-pass reference. Does not clear currentTexture/
  // currentTextureView — those simply remain the last-acquired swapchain
  // texture/view until the next beginRenderPass() call overwrites them.
  // Returns false (no-op) if there is no render pass to end; returns
  // true after ending it.
  endRenderPass(){
    if(!_gpuState.renderPass) return false;
    _gpuState.renderPass.end();
    _gpuState.renderPass=null;
    return true;
  },
  // Phase 3H: creates the smallest valid WebGPU render pipeline —
  // a fullscreen-triangle vertex shader paired with a fragment shader
  // that outputs transparent black. No uniforms, textures, samplers,
  // storage buffers, or vertex buffers are used. bindGroupLayout and
  // bindGroup are intentionally left null (nothing to bind yet). This
  // method is idempotent (returns true immediately if a pipeline
  // already exists) and is still not called from anywhere else in the
  // file — creating it here does not activate the GPU renderer or wire
  // it into any render pass.
  createPipeline(){
    if(!_gpuState.initialized) return false;
    if(!_gpuState.device) return false;
    if(!_gpuState.canvasFormat) return false;
    if(_gpuState.pipeline) return true;

    const device=_gpuState.device;

    const shaderCode=`
      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
        var pos = array<vec2<f32>, 3>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>( 3.0, -1.0),
          vec2<f32>(-1.0,  3.0)
        );
        return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment
      fn fs_main() -> @location(0) vec4<f32> {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
      }
    `;

    const shaderModule=device.createShaderModule({code:shaderCode});

    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[]});

    const renderPipeline=device.createRenderPipeline({
      layout:pipelineLayout,
      vertex:{
        module:shaderModule,
        entryPoint:'vs_main',
      },
      fragment:{
        module:shaderModule,
        entryPoint:'fs_main',
        targets:[{format:_gpuState.canvasFormat}],
      },
      primitive:{
        topology:'triangle-list',
      },
    });

    _gpuState.shaderModule=shaderModule;
    _gpuState.pipelineLayout=pipelineLayout;
    _gpuState.pipeline=renderPipeline;
    // bindGroupLayout and bindGroup remain null — nothing to bind yet.

    // Phase 5S: diagnostics only — mirrors the resources just created
    // above; does not change what was created.
    _gpuState.shaderModulesCreated++;
    _gpuState.pipelinesCreated++;

    return true;
  },
  // Phase 3K: orchestrates one complete GPU frame by calling the
  // existing helpers in sequence. Does not add any new GPU work itself
  // — createPipeline()/createCommandEncoder()/beginRenderPass()/
  // endRenderPass()/submitCommands() are all unchanged; this just
  // chains them and short-circuits on the first failure. Not called
  // from anywhere yet, and does not activate the GPU renderer.
  renderFrame(){
    if(!_gpuState.initialized) return false;
    if(!_gpuState.pipeline){
      if(!this.createPipeline()) return false;
    }
    if(!this.createCommandEncoder()) return false;
    if(!this.beginRenderPass()) return false;
    if(!this.endRenderPass()) return false;
    if(!this.submitCommands()) return false;
    return true;
  },
  // Phase 5B: submits a minimal, valid GPU frame that only clears the
  // canvas — reuses createCommandEncoder()/beginRenderPass()/
  // endRenderPass()/submitCommands() exactly as they already exist.
  // Deliberately does NOT call createPipeline(): no shader module,
  // pipeline, or bind group is created by this method. beginRenderPass()
  // opens the render pass with its existing clear-to-transparent color
  // attachment before it ever checks for a pipeline, so the clear still
  // happens even though no pipeline draw is issued; the resulting
  // "no pipeline" false from beginRenderPass() is expected here and is
  // not treated as a hard failure as long as a render pass actually
  // opened (i.e. endRenderPass() succeeds). Returns false if the
  // renderer isn't initialized, or if any real step (encoder creation,
  // opening a pass at all, or submission) fails. On success, increments
  // the frame counter and timestamp.
  submitEmptyFrame(){
    if(!_gpuState.initialized) return false;
    if(!this.createCommandEncoder()) return false;
    this.beginRenderPass();
    if(!this.endRenderPass()) return false;
    if(!this.submitCommands()) return false;
    _gpuState.framesSubmitted+=1;
    _gpuState.lastFrameTime=Date.now();
    return true;
  },
  // Phase 3L: minimal self-test entry point. Reuses initialize() and
  // renderFrame() as-is — no duplicated init or render logic. Not
  // called from anywhere yet, and does not activate the GPU renderer.
  async selfTest(){
    if(!(await this.initialize())) return false;
    return this.renderFrame();
  },
  // Phase 4M: safe, read-only diagnostic accessor. Exposes only the
  // recorded initError string (already produced by initialize()'s own
  // catch path) — never the adapter/device/queue/canvas/context/pipeline
  // objects that live alongside it in _gpuState. Returns null when there
  // is no error to report.
  getInitError(){
    return _gpuState.initError;
  },
  // Phase 4R: diagnostics/resource cleanup only. Clears initialization
  // flags and all lifecycle/resource fields back to their pre-init
  // defaults. Does not create anything (no adapter/device request, no
  // shader/pipeline creation) and does not touch CpuBrushRenderer or
  // any BrushRenderer active/preferred state.
  reset(){
    _gpuState.initialized=false;
    _gpuState.initError=null;
    _gpuState.adapter=null;
    _gpuState.device=null;
    _gpuState.queue=null;
    _gpuState.canvas=null;
    _gpuState.context=null;
    _gpuState.configured=false;
    _gpuState.commandEncoder=null;
    _gpuState.commandBuffer=null;
    _gpuState.currentTexture=null;
    _gpuState.currentTextureView=null;
    _gpuState.renderPass=null;
    _gpuState.pipeline=null;
    _gpuState.pipelineLayout=null;
    _gpuState.shaderModule=null;
    _gpuState.bindGroupLayout=null;
    _gpuState.bindGroup=null;
    // Phase 5C: dab-pipeline resources are GPU-device-bound (like the
    // Phase 3H pipeline above) and must be recreated after a reset.
    _gpuState.dabPipeline=null;
    _gpuState.dabShaderModule=null;
    _gpuState.dabPipelineLayout=null;
    _gpuState.dabVertexBuffer=null;
    // Phase 5F: the batch buffer's capacity tracking must reset
    // alongside the buffer itself, so the next flush after a fresh
    // initialize() correctly reallocates rather than assuming stale
    // capacity from a destroyed buffer.
    _gpuState.dabBatchCapacity=0;
    // Phase 6B: the persistent accumulation texture is GPU-device-bound
    // exactly like the dab pipeline/buffer above and cannot survive a
    // device teardown — drop the reference (and its size tracking) so
    // the next flush after a fresh initialize() recreates it via
    // _ensureAccumTexture() instead of touching a destroyed texture.
    // This is a reset of the accumulated *GPU resource*, not of drawing
    // behavior — flushDabQueue()/endStroke() are untouched.
    if(_gpuState.accumTexture){
      _gpuState.accumTexture.destroy();
    }
    _gpuState.accumTexture=null;
    _gpuState.accumTextureWidth=0;
    _gpuState.accumTextureHeight=0;
    // Revised GPU integration: layerTexture and the compose pipeline
    // resources are equally GPU-device-bound and cannot survive a
    // device teardown. Dropping them here means every committed stroke
    // held only in layerTexture is lost on a renderer reset — same
    // caveat that already applied to CpuBrushRenderer's activeC never
    // surviving e.g. a WebGPU device loss for the GPU side specifically;
    // out of scope for this pass (device-loss recovery/persistence is a
    // separate concern from the activeC-copy regression being fixed
    // here).
    if(_gpuState.layerTexture){
      _gpuState.layerTexture.destroy();
    }
    _gpuState.layerTexture=null;
    _gpuState.layerTextureWidth=0;
    _gpuState.layerTextureHeight=0;
    _gpuState.composePipeline=null;
    _gpuState.composePipelineLayout=null;
    _gpuState.composeShaderModule=null;
    _gpuState.composeBindGroupLayout=null;
    _gpuState.composeSampler=null;
    _gpuState.composeUniformBuffer=null;
    // Phase 5E: the live queue itself (pending, not-yet-flushed dabs)
    // is cleared on reset since it was staged for a GPU device that is
    // being torn down — those dabs can never be submitted against it.
    // This mirrors clearing the GPU-bound pipeline/buffer fields above.
    // submittedDabs/droppedDabs/batchesSubmitted/failedBatches counters
    // are NOT cleared, matching the cumulative-diagnostic-history
    // pattern used for every other counter in this object.
    _gpuState.dabQueue.length=0;
    _gpuState.queuedDabs=0;
    // Phase 5A/5C/5D: reset does not clear receive/draw/failure
    // counters — those are a cumulative diagnostic history, not
    // initialization state. Resetting GPU init state must not hide how
    // many strokes/dabs were received, drawn, or failed.
    // Phase 5Q: reset() ends the current renderer session by clearing
    // only sessionStartedAt/sessionLastActivity — the next beginStroke()
    // will start a new session. sessionStrokeCount/sessionFrameCount
    // are cumulative diagnostics (matching every other counter in this
    // object) and are intentionally NOT cleared here.
    _gpuState.sessionStartedAt=null;
    _gpuState.sessionLastActivity=null;
    // Phase 5T: reset clears only the latest-error snapshot fields.
    // errorCount/errorHistory are cumulative diagnostic history (same
    // pattern as every other counter in this object) and are
    // intentionally NOT cleared here.
    _gpuState.lastError=null;
    _gpuState.lastErrorTime=null;
    return true;
  },
  // Phase 4T: metadata only — GPU renderer does not draw yet, so
  // rendering must stay false regardless of initialization state.
  // Exposes only booleans, never adapter/device/queue/pipeline/shader/
  // texture/buffer objects from _gpuState.
  getCapabilities(){
    return {
      rendering: false,
      initialized: _gpuState.initialized,
      experimental: true
    };
  },
  // Phase 5A: read-only receive-counter diagnostics. Exposes only plain
  // numbers/booleans — never adapter/device/queue/pipeline/shader/
  // texture/buffer objects. Confirms the GPU renderer is receiving the
  // same beginStroke/drawDab/endStroke calls CPU does, without
  // implementing any rendering.
  getReceiveCounters(){
    return {
      strokesReceived: _gpuState.strokesReceived,
      dabsReceived: _gpuState.dabsReceived,
      inStroke: _gpuState.inStroke
    };
  },
  // Phase 5C: read-only diagnostics confirming real GPU dab draw calls
  // were submitted (as opposed to merely received — see
  // getReceiveCounters()). Exposes only plain numbers/timestamps, never
  // any GPU resource object.
  // Phase 5D: dabsReceived/dabsDrawn/failedDabs/lastDabTime in one
  // place, per the Phase 5D minimal-diagnostics requirement. Exposes
  // only plain numbers/timestamps, never any GPU resource object.
  getDabDrawStats(){
    return {
      dabsReceived: _gpuState.dabsReceived,
      dabsDrawn: _gpuState.dabsDrawn,
      failedDabs: _gpuState.failedDabs,
      lastDabTime: _gpuState.lastDabTime
    };
  },
  // Phase 5B: read-only frame-submission diagnostics. Exposes only
  // plain numbers/timestamps — never adapter/device/queue/pipeline/
  // shader/texture/buffer objects. Confirms submitEmptyFrame() is
  // successfully producing and submitting GPU command buffers.
  getFrameStats(){
    return {
      framesSubmitted: _gpuState.framesSubmitted,
      lastFrameTime: _gpuState.lastFrameTime
    };
  },
  // Phase 5S: read-only renderer-owned resource-count diagnostics.
  // Exposes only plain cumulative numbers — never any GPU resource
  // object. Metadata only; does not affect rendering behavior or
  // resource lifetime, and counters are never reset here.
  getMemoryDiagnostics(){
    return {
      vertexBuffersCreated: _gpuState.vertexBuffersCreated,
      vertexBuffersDestroyed: _gpuState.vertexBuffersDestroyed,
      pipelinesCreated: _gpuState.pipelinesCreated,
      pipelinesDestroyed: _gpuState.pipelinesDestroyed,
      shaderModulesCreated: _gpuState.shaderModulesCreated,
      shaderModulesDestroyed: _gpuState.shaderModulesDestroyed,
      commandEncodersCreated: _gpuState.commandEncodersCreated,
      renderPassesStarted: _gpuState.renderPassesStarted
    };
  },
  // Phase 5T: read-only cumulative error diagnostics. Exposes only
  // plain strings/numbers/timestamps — never any GPU resource object.
  // errorHistory is returned as a defensive copy (new array of shallow
  // copies) so callers cannot mutate internal state.
  getErrorDiagnostics(){
    return {
      lastError: _gpuState.lastError,
      lastErrorTime: _gpuState.lastErrorTime,
      errorCount: _gpuState.errorCount,
      errorHistory: _gpuState.errorHistory.map(entry=>({...entry}))
    };
  },
  // Phase 5U: single public export combining every existing renderer
  // diagnostic getter into one object. Each section is produced by
  // calling the corresponding existing public getter (never rebuilt
  // manually), so this stays in lockstep with whatever those getters
  // already return. Deep-cloned via JSON round-trip — every source
  // getter already returns plain strings/numbers/booleans/null/plain
  // objects/arrays, so the round-trip is a safe defensive copy that
  // guarantees the caller cannot mutate any internal _gpuState
  // reference through the returned object. Diagnostics only — no
  // rendering, activation, or GPU resource is touched or exposed.
  exportDiagnostics(){
    const snapshot={
      receive: this.getReceiveCounters(),
      frame: this.getFrameStats(),
      dab: this.getDabDrawStats(),
      queue: this.getQueueStats(),
      flush: this.getFlushDiagnostics(),
      lifecycle: this.getFrameLifecycleDiagnostics(),
      presentation: this.getPresentationDiagnostics(),
      idle: this.getIdleDiagnostics(),
      session: this.getSessionDiagnostics(),
      performance: this.getPerformanceDiagnostics(),
      memory: this.getMemoryDiagnostics(),
      errors: this.getErrorDiagnostics()
    };
    try{
      return JSON.parse(JSON.stringify(snapshot));
    }catch(e){
      return snapshot;
    }
  },
};

// CPU renderer registers itself and becomes the active renderer. This is
// the only registration call in the codebase today — the exact same
// runtime state (BrushRenderer.active === CpuBrushRenderer) as before
// Phase 2B, just reached via the registry instead of a hardcoded field.
BrushRenderer.registerRenderer('cpu',CpuBrushRenderer);
BrushRenderer.setActiveRenderer('cpu');

// GPU renderer registers itself but is NOT activated. CPU stays active.
BrushRenderer.registerRenderer('gpu',GpuBrushRenderer);

// Phase 4F: load any saved renderer preference from localStorage now
// that BrushRenderer is fully constructed and registered. This only
// updates _preferredName — it does not call activateRenderer(),
// applyPreferredRenderer(), or setActiveRenderer(), so the active
// renderer remains 'cpu' regardless of what preference was loaded.
BrushRenderer.loadPreferredRenderer();

// Phase 4J: minimal startup hook — attempt the loaded preference once,
// through the existing applyPreferredRenderer() -> activateRenderer()
// path only. No new activation logic is added here: activateRenderer()
// already leaves the current renderer active and returns false if the
// target's initialize() fails (see Phase 4A), so a GPU preference that
// fails to initialize simply leaves CPU active, exactly as it already
// did before this call existed. setActiveRenderer('gpu') is never
// called directly — only activateRenderer(), via applyPreferredRenderer().
BrushRenderer.applyPreferredRenderer();

window.CpuBrushRenderer = CpuBrushRenderer;
window.BrushRenderer = BrushRenderer;