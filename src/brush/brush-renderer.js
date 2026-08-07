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
  active: null,
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
  },
  getActiveRenderer(){
    return this._activeName;
  },
  drawDab(d,rendererContext){ return this.active.drawDab(d,rendererContext); },
  beginStroke(){ return this.active.beginStroke(); },
  endStroke(){ return this.active.endStroke(); },
  invalidateCaches(which){ return this.active.invalidateCaches(which); },
  getCacheStats(){ return this.active.getCacheStats(); },
  getLineContinuity(){ return this.active.getLineContinuity(); },
  setLineContinuity(value){ return this.active.setLineContinuity(value); },
  getTipAlphaBuffer(){ return this.active.getTipAlphaBuffer(); },
  setTipAlphaSeedPixels(value){ return this.active.setTipAlphaSeedPixels(value); },
  setTipAlphaInvalidationReason(value){ return this.active.setTipAlphaInvalidationReason(value); },
  getTipAlphaInvalidationReason(){ return this.active.getTipAlphaInvalidationReason(); },
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
  drawDab(d,rendererContext){
    // intentionally empty
  },
  beginStroke(){
    // intentionally empty
  },
  endStroke(){
    // intentionally empty
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
        return false;
      }
      const adapter=await navigator.gpu.requestAdapter();
      if(!adapter){
        _gpuState.initError='adapter-unavailable';
        return false;
      }
      const device=await adapter.requestDevice();
      if(!device){
        _gpuState.initError='device-unavailable';
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
      _gpuState.initialized=true;
      _gpuState.initError=null;
      return true;
    }catch(err){
      _gpuState.initError=(err&&err.message)||'gpu-init-failed';
      _gpuState.adapter=null;
      _gpuState.device=null;
      _gpuState.queue=null;
      _gpuState.adapterFeatures=null;
      _gpuState.adapterLimits=null;
      _gpuState.deviceFeatures=null;
      _gpuState.deviceLimits=null;
      _gpuState.preferredCanvasFormat=null;
      _gpuState.initialized=false;
      return false;
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

window.CpuBrushRenderer = CpuBrushRenderer;
window.BrushRenderer = BrushRenderer;