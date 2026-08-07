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
//  Brush Tip Image (ABR / custom upload)
// When non-null, this canvas holds a grayscale alpha mask that replaces the
// default circle/gradient dab shape.  The tip image is stored at its native
// resolution and scaled to the effective brush diameter on every dab.
// brushTipVersion is bumped whenever the canvas is replaced so that every
// stamp cache that keyed on it is automatically invalidated without a
// manual cache.clear() call at the use site.
const TipReadbackExperiment=(function(){
  const requested=(new URLSearchParams(location.search)).get('tipReadback')||'control';
  const mode=['control','A','B','C','D'].includes(requested)?requested:'control',records=[];
  let strokeSerial=0,activeStroke=0;const reportedHits=new Set();
  function record(type,detail){const item=Object.assign({type,mode,time:performance.now(),strokeId:activeStroke,visibility:document.visibilityState,focused:document.hasFocus()},detail||{});records.push(item);return item;}
  return{
    mode,record,strokeStart(){activeStroke=++strokeSerial;record('stroke-start');return activeStroke;},strokeEnd(){record('stroke-end');activeStroke=0;},
    contextOptions(){return mode==='A'?{willReadFrequently:true}:undefined;},cacheHit(version){const key=activeStroke+'|'+version;if(reportedHits.has(key))return;reportedHits.add(key);record('tip-alpha-cache-hit',{tipVersion:version});},
    results(){return JSON.parse(JSON.stringify(records));},labelNextStroke(label){window.BrushLatencyProfiler.enable(true);return window.BrushLatencyProfiler.labelNextStroke(label);},report(){return window.BrushLatencyProfiler.results().map(stroke=>{const get=name=>stroke.stages.find(stage=>stage.name===name);const display=stroke.points.find(point=>point.name==='first-display-presented');return{id:stroke.id,scenario:stroke.scenario,idleMs:stroke.idleMs,pointerdownToDisplay:display&&display.fromPointerDown,tipGetImageData:get('tip-get-image-data')?.duration||0,tipInitialization:get('tip-alpha-buffer-initialization')?.duration||0,firstDab:get('first-dab-pipeline-total')?.duration||0,rafWait:get('raf-wakeup-wait')?.duration||0,presentation:get('presentation-total')?.duration||0};});},clear(){records.length=0;reportedHits.clear();strokeSerial=0;activeStroke=0;return true;},
    reloadUrls(){const base=location.href.replace(/([?&])tipReadback=[^&]*&?/,'$1').replace(/[?&]$/,'');return Object.fromEntries(['control','A','B','C','D'].map(value=>[value,base+(base.includes('?')?'&':'?')+'tipReadback='+value+'&brushPerf=1']));}
  };
})();
window.TipReadbackExperiment=TipReadbackExperiment;
const CustomTipCacheTrace=(function(){
  let enabled=(new URLSearchParams(location.search)).get('tipCacheTrace')==='1',strokeSerial=0,activeStroke=0,lastCallAt=0,serial=0;
  const records=[],ids=new WeakMap();
  function objectId(value,prefix){if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,(prefix||'object')+'-'+(++serial));return ids.get(value);}
  function record(type,detail){if(!enabled)return null;const now=performance.now(),item=Object.assign({type,time:now,strokeId:activeStroke,presetId:window._activeBrushPresetId||null,visibility:document.visibilityState,focused:document.hasFocus()},detail||{});records.push(item);return item;}
  function tipCall(detail){if(!enabled)return;const now=performance.now();record('get-tip-alpha-buffer',Object.assign({timeSincePreviousCall:lastCallAt?now-lastCallAt:null},detail));lastCallAt=now;}
  function lifecycle(type){record('lifecycle',{event:type,tipVersion:window.brushTipVersion||0,tipCanvasId:objectId(window.brushTipCanvas,'tip-canvas')});}
  document.addEventListener('visibilitychange',()=>lifecycle('visibilitychange-'+document.visibilityState));window.addEventListener('blur',()=>lifecycle('blur'));window.addEventListener('focus',()=>lifecycle('focus'));window.addEventListener('pageshow',()=>lifecycle('pageshow'));window.addEventListener('resize',()=>lifecycle('resize'));
  return{
    get enabled(){return enabled;},enable(value=true){enabled=!!value;return enabled;},record,tipCall,objectId,lifecycle,
    strokeStart(){activeStroke=++strokeSerial;record('stroke-start',{tipVersion:window.brushTipVersion||0,tipCanvasId:objectId(window.brushTipCanvas,'tip-canvas')});},
    strokeEnd(){record('stroke-end');activeStroke=0;},
    invalidated(detail){record('cache-invalidated',detail);},
    results(){return JSON.parse(JSON.stringify(records));},clear(){records.length=0;strokeSerial=0;activeStroke=0;lastCallAt=0;return true;},
    summary(){const calls=records.filter(item=>item.type==='get-tip-alpha-buffer');return calls.map(item=>({time:item.time,strokeId:item.strokeId,presetId:item.presetId,tipVersion:item.tipVersion,cacheKey:item.cacheKey,cacheHit:item.cacheHit,invalidationReason:item.invalidationReason,alphaBufferId:item.alphaBufferId,tipCanvasId:item.tipCanvasId,width:item.width,height:item.height,getImageDataDuration:item.getImageDataDuration,alphaExtractionDuration:item.alphaExtractionDuration,timeSincePreviousCall:item.timeSincePreviousCall,visibility:item.visibility,focused:item.focused}));},
    export(){return{calls:this.summary(),events:this.results(),strokes:window.TipReadbackExperiment?window.TipReadbackExperiment.report():[]};},
    reloadUrl(){const url=new URL(location.href);url.searchParams.set('tipCacheTrace','1');url.searchParams.set('brushPerf','1');return url.href;}
  };
})();
window.CustomTipCacheTrace=CustomTipCacheTrace;
const CustomFirstDabTrace=(function(){
  let enabled=false,strokeSerial=0,active=null,nextLabel=null,dab=null,objectSerial=0;const strokes=[],ids=new WeakMap();
  function objectId(value){if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,'tip-'+(++objectSerial));return ids.get(value);}
  function now(){return performance.now();}
  function beginStroke(detail){if(!enabled)return;const t=now();active={id:++strokeSerial,label:nextLabel,startedAt:detail.entryAt||t,brush:detail.tip?'custom-tip':'procedural',presetId:detail.presetId||null,tipId:objectId(window.brushTipCanvas),tipVersion:window.brushTipVersion||0,timeline:[{name:'pointerdown-handler-entry',at:detail.entryAt||t},{name:'preset-settings-resolved',at:t,detail:detail.settings||null}],samples:[],samplesBeforeFirstDab:0,movementSamplesBeforeFirstDab:0,firstDabDispatched:false,dabs:[]};nextLabel=null;}
  function endStroke(){if(!active)return;const prof=window.BrushLatencyProfiler&&window.BrushLatencyProfiler.latest?window.BrushLatencyProfiler.latest():null,visible=prof&&prof.points&&prof.points.find(point=>point.name==='first-display-presented');active.firstVisibleAt=visible?active.startedAt+visible.fromPointerDown:null;active.pointerdownToFirstVisible=visible?visible.fromPointerDown:null;active.duration=now()-active.startedAt;strokes.push(active);active=null;dab=null;}
  function beginDab(detail){if(!active)return;dab={index:active.dabs.length+1,startedAt:now(),detail,stages:[]};active.dabs.push(dab);}
  function endDab(){if(!dab)return;dab.duration=now()-dab.startedAt;dab=null;}
  function stage(name,start,detail){if(!dab)return;dab.stages.push({name,duration:now()-start,detail:detail||null});}
  function instant(name,detail){if(!dab)return;dab.stages.push({name,duration:0,detail:detail||null});}
  function event(name,detail){if(!active)return;if(name==='brush-parameters-resolved'&&active.timeline.some(item=>item.name===name))return;const t=now();active.timeline.push({name,at:t,fromPointerdown:t-active.startedAt,detail:detail||null});}
  function sample(detail){if(!active)return;const item=Object.assign({at:now(),fromPointerdown:now()-active.startedAt},detail||{});active.samples.push(item);if(!active.firstDabDispatched){active.samplesBeforeFirstDab++;if(item.source!=='pointerdown')active.movementSamplesBeforeFirstDab++;}}
  function firstDabDispatch(detail){if(!active)return;active.firstDabDispatched=true;active.timeline.push({name:'first-dab-dispatch',at:now(),fromPointerdown:now()-active.startedAt,detail:Object.assign({samplesBeforeFirstDab:active.samplesBeforeFirstDab,movementSamplesBeforeFirstDab:active.movementSamplesBeforeFirstDab},detail||{})});}
  function clear(){strokes.length=0;strokeSerial=0;active=null;dab=null;enabled=true;if(window.BrushLatencyProfiler){window.BrushLatencyProfiler.enable(true);window.BrushLatencyProfiler.clear();}return true;}
  function compare(){const groups={};strokes.forEach(stroke=>{const key=stroke.brush+'|'+(stroke.label||'unlabelled'),first=stroke.dabs[0];if(!first)return;const group=groups[key]||(groups[key]={brush:stroke.brush,label:stroke.label||'unlabelled',trials:0,stages:{}});group.trials++;first.stages.forEach(item=>(group.stages[item.name]||(group.stages[item.name]=[])).push(item.duration));});return Object.values(groups).map(group=>{const out={brush:group.brush,label:group.label,trials:group.trials,stages:{}};Object.keys(group.stages).forEach(name=>{const a=group.stages[name].slice().sort((x,y)=>x-y);out.stages[name]={median:a[Math.ceil(a.length*.5)-1],min:a[0],max:a[a.length-1],p90:a[Math.ceil(a.length*.9)-1]};});return out;});}
  return{clear,export(){return JSON.parse(JSON.stringify(strokes));},compare,labelNext(label){nextLabel=String(label);return nextLabel;},enable(value=true){enabled=!!value;return enabled;},beginStroke,endStroke,beginDab,endDab,stage,instant,event,sample,firstDabDispatch,objectId,get enabled(){return enabled;}};
})();
window.CustomFirstDabTrace=CustomFirstDabTrace;
// Diagnostic-only first-dab latency probe. Disabled by default and never
// changes cache, scheduling, or rendering decisions.
const FirstDabLatencyProbe=(function(){
  let enabled=false,serial=0,current=null,lastStrokeAt=0,tipPending=false,visiblePending=false;
  const reports=[];
  function now(){return performance.now();}
  function begin(detail){
    if(!enabled)return;
    const at=detail&&detail.pointerdownAt||now(),idleMs=lastStrokeAt?at-lastStrokeAt:null;
    current={stroke:++serial,timestamp:new Date().toISOString(),trigger:visiblePending?'tab-restore':tipPending?'preset-switch':idleMs!=null&&idleMs>=15000?'idle':serial>1?'warm':'unknown',idleMs,visibility:document.visibilityState,firstAfterVisible:visiblePending,firstAfterSetBrushTip:tipPending,presetId:window._activeBrushPresetId||null,tipVersion:window.brushTipVersion||0,layerType:detail&&detail.layerType||null,renderer:'unknown',tipCache:null,measurements:{},setupDetails:{},pointerdownAt:at,capturingDab:false,readyForPresentation:false};
    visiblePending=false;tipPending=false;
  }
  function firstDabStart(){if(!current)return 0;current.capturingDab=true;current.firstDabAt=now();return current.firstDabAt;}
  function firstDabEnd(start){if(!current||!current.capturingDab)return;current.measurements.stampDab=now()-start;current.firstDabGeneratedAt=now();current.capturingDab=false;}
  function cache(detail){if(current&&current.capturingDab)current.tipCache=detail;}
  function renderer(name,detail){if(current&&current.capturingDab){current.renderer=name;if(detail)Object.assign(current,detail);}}
  function measure(name,start){if(current&&current.capturingDab&&start)current.measurements[name]=now()-start;}
  function setupMeasure(name,start,detail){if(!current||!start)return;current.measurements[name]=(current.measurements[name]||0)+(now()-start);if(detail)Object.assign(current.setupDetails,detail);}
  function ensureKeyStage(name,start){if(current&&start)current.measurements[name]=(current.measurements[name]||0)+(now()-start);}
  function renderTimelineStage(name,start,duration){if(!current||!start)return;current.measurements[name]=(current.measurements[name]||0)+(duration==null?now()-start:duration);}
  function finishRenderTimeline(start){if(!current||!start)return;const total=now()-start,names=['renderTimelineCanvasClear','renderTimelineBackgroundDrawing','renderTimelineGridDrawing','renderTimelineFrameDrawing','renderTimelineLayerDrawing','renderTimelineThumbnails','renderTimelineDrawingMarks','renderTimelinePlayhead','renderTimelineSelectionsHighlights','renderTimelineTextRendering','renderTimelineScrollbarRendering','renderTimelineOverlays'];names.forEach(name=>{if(current.measurements[name]==null)current.measurements[name]=0;});const measured=names.reduce((sum,name)=>sum+current.measurements[name],0),classified=Math.min(total,measured);current.measurements.renderTimeline=total;current.measurements.renderTimelineClassifiedTotal=classified;current.measurements.renderTimelineUnclassified=total-classified;}
  function finishEnsureKey(start,created){if(!current||!start)return;const total=now()-start,names=['ensureKeyCanvasAllocation','ensureKeyFrameMapInsertion','ensureKeyActiveCanvasClear','ensureKeyCanvasCopyDrawImage','ensureKeyRecompose','ensureKeyUpdateOnion','ensureKeyRenderTimeline','ensureKeyUpdateStatus'];names.forEach(name=>{if(current.measurements[name]==null)current.measurements[name]=0;});const classified=names.reduce((sum,name)=>sum+current.measurements[name],0);current.measurements.ensureKey=total;current.measurements.ensureKeyClassifiedTotal=classified;current.measurements.ensureKeyUnclassified=Math.max(0,total-classified);current.setupDetails.ensureKeyCreatedNewKeyframe=!!created;}
  function finalizeSetup(at){if(!current)return;const end=at||now(),total=end-current.pointerdownAt,names=['eventValidationAndPreventDefault','pendingPrewarmCancellation','latencyHooksInitialization','pressureAndStateInitialization','coordinateMappingAndTransforms','setPointerCapture','pushUndo','ensureKey','eraserSetup','taperSetup','selectionSetup','ensureStrokeCanvas','spacingAndFlowInitialization'],classified=names.reduce((sum,name)=>sum+(current.measurements[name]||0),0);current.measurements.pointerdownToStampDabStart=total;current.measurements.unclassifiedSetup=Math.max(0,total-classified);current.measurements.classifiedSetupTotal=classified;}
  function beforeSchedule(){if(!current)return;const at=now();current.measurements.pointerdownToScheduleRecomposite=at-current.pointerdownAt;current.measurements.firstDabToScheduleRecomposite=current.firstDabGeneratedAt?at-current.firstDabGeneratedAt:null;current.readyForPresentation=true;}
  function rafScheduled(at){if(current&&current.readyForPresentation)current.rafScheduledAt=at;}
  function rafCallback(at){if(current&&current.readyForPresentation)current.measurements.rafWait=at-(current.rafScheduledAt||at);}
  function recomposeStart(){return current&&current.readyForPresentation?now():0;}
  function displayComplete(recomposeStart,displayBlit){
    if(!current||!current.readyForPresentation)return;
    current.measurements.compCToDisplayCDrawImage=displayBlit;
    current.measurements.recompose=now()-recomposeStart;
    current.measurements.totalToDisplayDrawImageReturn=now()-current.pointerdownAt;
    const report=current;current=null;reports.push(report);
    const cacheState=report.tipCache?(report.tipCache.hit?'HIT':'MISS'):'N/A',m=report.measurements;
    console.groupCollapsed('[BrushLatency] stroke #'+report.stroke+' | trigger='+report.trigger);
    console.log(report);
    console.table(Object.assign({renderer:report.renderer,tipCache:cacheState},m));
    console.log('[BrushLatencySummary] trigger='+report.trigger+' renderer='+report.renderer+' tipCache='+cacheState+' buildTipStamp='+(m.buildTipStamp||0).toFixed(3)+' stampDraw='+(m.cachedStampDrawImage||0).toFixed(3)+' pointerdownToSchedule='+(m.pointerdownToScheduleRecomposite||0).toFixed(3)+' rafWait='+(m.rafWait||0).toFixed(3)+' recompose='+(m.recompose||0).toFixed(3)+' displayBlit='+(m.compCToDisplayCDrawImage||0).toFixed(3)+' totalToDisplayCall='+(m.totalToDisplayDrawImageReturn||0).toFixed(3));
    console.groupEnd();
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)visiblePending=true;});
  return{enable(value=true){enabled=!!value;return enabled;},get enabled(){return enabled;},begin,firstDabStart,firstDabEnd,cache,renderer,measure,setupMeasure,ensureKeyStage,finishEnsureKey,renderTimelineStage,finishRenderTimeline,finalizeSetup,beforeSchedule,rafScheduled,rafCallback,recomposeStart,displayComplete,tipChanged(){if(enabled)tipPending=true;},strokeComplete(){if(enabled)lastStrokeAt=now();},reports(){return JSON.parse(JSON.stringify(reports));},clear(){reports.length=0;serial=0;current=null;lastStrokeAt=0;tipPending=false;visiblePending=false;return true;}};
})();
window.FirstDabLatencyProbe=FirstDabLatencyProbe;
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
// 0Ã¢â‚¬â€œ1 blend strength for the texture overlay (mirrors ts-texture-strength slider).
// At 1.0 (100%) the texture grain is fully applied Ã¢â‚¬â€ texture-dark areas lose
// coverage, texture-bright areas keep it. At 0.0 the stroke is solid/unaffected.
window.brushTextureStrength   = 1.0;
Object.defineProperty(window,'brushTextureDepth',{
  configurable:true,
  get(){ return window.brushTextureStrength; },
  set(value){ window.brushTextureStrength=value; }
});
// Texture zoom/scale (1.0 = native resolution, 0.25 = 25%, 4.0 = 400%).
// Controlled by the ts-texture-scale slider (25Ã¢â‚¬â€œ400%).
window.brushTextureScale   = 1.0;
// Texture buildup strength (0Ã¢â‚¬â€œ1). Controls how aggressively overlapping dabs
// within one stroke fill in the grain holes Ã¢â‚¬â€ producing the TVPaint-style
// density accumulation where the centre darkens in a single pass.
// At 1.0 (100%): full build-up Ã¢â‚¬â€ a single stroke becomes dense quickly.
// At 0.0 (0%): no build-up Ã¢â‚¬â€ every dab gets the same static grain cut.
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

//  Line tool Ã¢â‚¬â€ Pressure Mode (Toon Boom Harmony-style)
// 'fixed'  Ã¢â‚¬â€ constant-width line at the current brush size, tablet
//            pressure ignored entirely (also what mouse/touch always get).
// 'pen'    Ã¢â‚¬â€ width follows the smoothed pressure profile recorded while
//            dragging, projected onto the final straight line.
let _linePressureMode = 'pen';
try{
  const _savedLinePressureMode = localStorage.getItem('animate.linePressureMode.v1');
  if(_savedLinePressureMode==='fixed'||_savedLinePressureMode==='pen') _linePressureMode=_savedLinePressureMode;
}catch(_){}
function getLinePressureMode(){ return _linePressureMode; }
function setLinePressureMode(mode){
  _linePressureMode = (mode==='fixed') ? 'fixed' : 'pen';
  try{ localStorage.setItem('animate.linePressureMode.v1',_linePressureMode); }catch(_){}
}
window.getLinePressureMode=getLinePressureMode;
window.setLinePressureMode=setLinePressureMode;

const LINE_AA_STORE_KEY='animate.lineAA.v1';
let _lineAAEnabled=true,_lineAAQuality='medium';
function _normalizeLineAAQuality(value){
  const mode=String(value||'').toLowerCase();
  if(mode==='weak'||mode==='low')return'weak';
  if(mode==='strong'||mode==='high')return'strong';
  return'medium';
}
try{
  const saved=localStorage.getItem(LINE_AA_STORE_KEY);
  const legacy=localStorage.getItem('animate.lineAAMode.v1');
  const raw=saved!==null?saved:legacy;
  let value=raw;
  if(raw!==null){try{value=JSON.parse(raw);}catch(_){value=raw;}}
  if(value&&typeof value==='object'){
    _lineAAEnabled=value.enabled!==false&&String(value.quality||'').toLowerCase()!=='none';
    _lineAAQuality=_normalizeLineAAQuality(value.quality);
  }else if(typeof value==='string'){
    _lineAAEnabled=value.toLowerCase()!=='none';
    _lineAAQuality=_normalizeLineAAQuality(value);
  }
}catch(_){}
function _persistLineAA(){
  try{localStorage.setItem(LINE_AA_STORE_KEY,JSON.stringify({enabled:_lineAAEnabled,quality:_lineAAQuality}));}catch(_){}
}
function _clearLineAACaches(){
  if(typeof BrushRenderer!=='undefined')BrushRenderer.invalidateCaches({aa:true,stamp:true,tip:true});
}
function getLineAASettings(){return{enabled:_lineAAEnabled,quality:_lineAAQuality};}
function setLineAAEnabled(enabled){_lineAAEnabled=!!enabled;_persistLineAA();_clearLineAACaches();}
function setLineAAQuality(quality){_lineAAQuality=_normalizeLineAAQuality(quality);_persistLineAA();_clearLineAACaches();}
window.getLineAASettings=getLineAASettings;
window.setLineAAEnabled=setLineAAEnabled;
window.setLineAAQuality=setLineAAQuality;
// Continuous pointer+pressure samples recorded while dragging the Line
// tool, in canvas coordinates. Cleared at the start/end of every drag.
let _lineDragging = false;
let _linePressureSamples = [];
let _lineGesture=null;
let _curveToolGesture=null,_curveGuideOverlay=null,_curveCommitPointerId=null;
let _linePreviewBounds=null,_linePreviewPreviousEndpoint=null;
let _linePreviewFrameId=0,_linePreviewMoveSequence=0,_linePreviewGeneration=0;
let _lineDiagnosticCurrentT=0,_lineEffectivePressureSamples=[];
let _selectionScopeBase = null;
let _colorEraserBase = null;
let _colorEraserOwnership = null;
// A stroke owns the artwork slot captured on pointer-down. Frame/layer
// navigation finalizes that slot before active artwork state may change.
let _strokeOwnerLayer=-1,_strokeOwnerFrame=-1,_endingForArtworkChange=false;
let _strokeSessionSerial=0,_activeStrokeSession=0;
function _traceStrokeLifecycle(event,detail){
  if(!window.debugStrokeLifecycle)return;
  const trace=window.__strokeLifecycleTrace||(window.__strokeLifecycleTrace=[]);
  trace.push(Object.assign({event,sessionId:_activeStrokeSession,time:performance.now(),activeLayer:curLayer,activeFrame:curFrame},detail||{}));
  if(trace.length>500)trace.splice(0,trace.length-500);
}

function _brushPerf(){return window.BrushLatencyProfiler&&window.BrushLatencyProfiler.enabled?window.BrushLatencyProfiler:null;}

function _beginColorEraserStroke(){
  _colorEraserBase=null;_colorEraserOwnership=null;
  if(tool!=='eraser'||window.eraserMode!=='color')return;
  const layer=layers[curLayer];
  const colorModeAvailable=typeof window.eraserColorModeAvailable==='function'?window.eraserColorModeAvailable():!!(layer&&layer.type==='smart-raster');
  if(!colorModeAvailable){window.eraserMode='normal';return;}
  _colorEraserBase=ctx.getImageData(0,0,CW,CH);
  const styleId=typeof activeAdvancedStyleIdForPainting==='function'?activeAdvancedStyleIdForPainting():null;
  if(layer&&layer.type==='smart-raster'&&styleId&&window.SmartRasterLayer&&typeof window.SmartRasterLayer.beginStyleErase==='function'){
    _colorEraserOwnership=window.SmartRasterLayer.beginStyleErase(curLayer,curFrame,styleId);
  }
}
function _colorEraserDabRect(centerX,centerY,radiusX,radiusY){
  const pad=3,x=Math.max(0,Math.floor(centerX-radiusX-pad)),y=Math.max(0,Math.floor(centerY-radiusY-pad));
  const right=Math.min(CW,Math.ceil(centerX+radiusX+pad)),bottom=Math.min(CH,Math.ceil(centerY+radiusY+pad));
  return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
}
function _captureColorEraserDab(centerX,centerY,radiusX,radiusY){
  if(!_colorEraserBase||tool!=='eraser'||window.eraserMode!=='color'||!layers[curLayer]||layers[curLayer].renderMode!=='style-layering')return null;
  const rect=_colorEraserDabRect(centerX,centerY,radiusX,radiusY);
  return rect?{rect,image:ctx.getImageData(rect.x,rect.y,rect.w,rect.h)}:null;
}
function _queueLiveColorEraserPreview(ownership,rect){
  if(!ownership||!ownership.lastDabChanged||!ownership.lastDabChanged.length)return;
  for(let i=0;i<ownership.lastDabChanged.length;i++)ownership.previewIndexes.add(ownership.lastDabChanged[i]);
  const pending=ownership.previewRect,right=rect.x+rect.w,bottom=rect.y+rect.h;
  if(!pending)ownership.previewRect={x:rect.x,y:rect.y,w:rect.w,h:rect.h};
  else{const nextRight=Math.max(pending.x+pending.w,right),nextBottom=Math.max(pending.y+pending.h,bottom);pending.x=Math.min(pending.x,rect.x);pending.y=Math.min(pending.y,rect.y);pending.w=nextRight-pending.x;pending.h=nextBottom-pending.y;}
}
function _flushLiveColorEraserPreview(){
  const ownership=_colorEraserOwnership;
  if(!ownership||!ownership.previewIndexes||!ownership.previewIndexes.size||!ownership.previewRect)return false;
  if(!layers[curLayer]||layers[curLayer].renderMode!=='style-layering'||typeof window.SmartRasterV4LiveColorErasePreview!=='function'){ownership.previewIndexes.clear();ownership.previewRect=null;return false;}
  const indexes=ownership.previewIndexes,rect=ownership.previewRect;
  window.SmartRasterV4LiveColorErasePreview({styleId:ownership.styleId,coverage:ownership.coverage,dabIndexes:indexes,rect});
  indexes.clear();ownership.previewRect=null;
  return true;
}function _filterColorEraserRegion(centerX,centerY,radiusX,radiusY,beforeDab){
  if(!_colorEraserBase||tool!=='eraser'||window.eraserMode!=='color')return;
  const rect=_colorEraserDabRect(centerX,centerY,radiusX,radiusY);if(!rect)return;
  const image=ctx.getImageData(rect.x,rect.y,rect.w,rect.h),ownership=_colorEraserOwnership;
  if(!ownership||!window.SmartRasterLayer||typeof window.SmartRasterLayer.applyStyleEraseRegion!=='function')return;
  const exactBefore=beforeDab&&beforeDab.rect.x===rect.x&&beforeDab.rect.y===rect.y&&beforeDab.rect.w===rect.w&&beforeDab.rect.h===rect.h?beforeDab.image:null;
  window.SmartRasterLayer.applyStyleEraseRegion(ownership,rect,image,_colorEraserBase,exactBefore);
  ctx.putImageData(image,rect.x,rect.y);
  if(layers[curLayer]&&layers[curLayer].renderMode==='style-layering')_queueLiveColorEraserPreview(ownership,rect);
}
function _endColorEraserStroke(){_flushLiveColorEraserPreview();if(_colorEraserOwnership&&window.SmartRasterLayer&&typeof window.SmartRasterLayer.finishStyleErase==='function')window.SmartRasterLayer.finishStyleErase(_colorEraserOwnership);_colorEraserBase=null;_colorEraserOwnership=null;}
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
  const perf=_brushPerf(),started=perf?performance.now():0;
  const w = activeC.width, h = activeC.height;
  const allocatedOrResized=!_strokeCanvas||_strokeCanvas.width!==w||_strokeCanvas.height!==h;
  if(!_strokeCanvas || _strokeCanvas.width !== w || _strokeCanvas.height !== h){
    _strokeCanvas = document.createElement('canvas');
    _strokeCanvas.width  = w;
    _strokeCanvas.height = h;
    _strokeCtx = _strokeCanvas.getContext('2d', {willReadFrequently: true});
  } else {
    _strokeCtx.clearRect(0, 0, w, h);
  }
  if(typeof _resetTexturedStrokeCanvas==='function') _resetTexturedStrokeCanvas();
  if(perf)perf.measure('scratch-canvas-preparation',started,perf.canvasDetail(_strokeCanvas,_strokeCtx,{allocatedOrResized,willReadFrequently:true,getImageData:false}));
  // Phase 1B: notify the active renderer that a stroke's rendering surface
  // is ready. CpuBrushRenderer.beginStroke() is a no-op today — the stroke
  // scratch canvas itself is still owned and allocated right here, exactly
  // as before. This hook exists only so a future renderer can react to
  // stroke start without brush-engine.js needing to change again.
  if(window.BrushRenderer) BrushRenderer.beginStroke();
}

// Composite the stroke scratch canvas onto activeC with stroke-level opacity,
// then clear the scratch for the next stroke. Per-dab pressure influence on
// Opacity is already baked into each dab's alpha as it was painted (see
// _computeEffectiveParams), so this only needs to apply the constant
// brushOpacity ceiling Ã¢â‚¬â€ no separate end-of-stroke multiplier.
function _usesBrushPaintPipeline(){return tool==='brush'||tool==='line'||tool==='curve';}
function _brushPaintCompositeOperation(){
  if(!_usesBrushPaintPipeline()) return 'source-over';
  switch(window.brushBlendMode){
    case 'draw-behind': return 'destination-over';
    case 'darken': return 'darken';
    case 'multiply': return 'multiply';
    case 'color-burn': return 'color-burn';
    case 'lighten': return 'lighten';
    case 'screen': return 'screen';
    case 'color-dodge': return 'color-dodge';
    case 'add': return 'lighter';
    case 'add-glow': return 'lighter';
    case 'overlay': return 'overlay';
    case 'soft-light': return 'soft-light';
    case 'hard-light': return 'hard-light';
    case 'difference': return 'difference';
    case 'exclusion': return 'exclusion';
    case 'hue': return 'hue';
    case 'saturation': return 'saturation';
    case 'color': return 'color';
    case 'luminosity': return 'luminosity';
    default: return 'source-over';
  }
}

// Add uses one premultiplied-alpha additive pass. Add (Glow) uses a second,
// lower-strength contribution from the same stroke source.
function _drawBrushComposite(targetCtx,src){
  const alpha=targetCtx.globalAlpha;
  targetCtx.globalCompositeOperation=_brushPaintCompositeOperation();
  targetCtx.drawImage(src,0,0);
  if(_usesBrushPaintPipeline()&&window.brushBlendMode==='add-glow'){
    targetCtx.globalAlpha=alpha*0.65;
    targetCtx.drawImage(src,0,0);
    targetCtx.globalAlpha=alpha;
  }
}


function _commitStrokeCanvas(){
  if(!_strokeCanvas) return;
  const commitSession=_activeStrokeSession,commitLayer=curLayer,commitFrame=curFrame;
  _traceStrokeLifecycle('commit-start',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,dirtyRect:_strokeDirty?{minX:_strokeDirty.minX,minY:_strokeDirty.minY,maxX:_strokeDirty.maxX,maxY:_strokeDirty.maxY}:null});
  // forceFull=true: make sure the ENTIRE stroke is masked (not just whatever
  // region was still pending), so the committed result always matches what
  // the live preview was showing, even if a frame's mask pass got skipped.
  let src = _getTexturedStrokeCanvas(_strokeCanvas, true);
  if(window.SelectionScope)src=SelectionScope.clipCanvas(src);
  const styleId=typeof activeAdvancedStyleIdForPainting==='function'
    ?activeAdvancedStyleIdForPainting():null;
  const brushBlendMode=_usesBrushPaintPipeline()&&typeof window.brushBlendMode==='string'?window.brushBlendMode:'normal';
  const smartOwnership=_usesBrushPaintPipeline()&&styleId&&
    typeof advancedPalettePaintingEnabled==='function'&&advancedPalettePaintingEnabled()&&
    layers[curLayer]&&layers[curLayer].type==='smart-raster';
  const ownershipDirtyRect=smartOwnership?_consumeStrokeDirtyRect():null;
  const ownershipBefore=smartOwnership?(ownershipDirtyRect?ctx.getImageData(ownershipDirtyRect.x,ownershipDirtyRect.y,ownershipDirtyRect.w,ownershipDirtyRect.h):ctx.getImageData(0,0,CW,CH)):null;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
  _drawBrushComposite(ctx,src);
  ctx.restore();
  if(smartOwnership&&typeof commitSmartRasterBrush==='function'){
    _traceStrokeLifecycle('smart-metadata-start',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,dirtyRect:ownershipDirtyRect});
    commitSmartRasterBrush(src,styleId,brushOpacity,ownershipDirtyRect,ownershipBefore,brushBlendMode);
    _traceStrokeLifecycle('smart-metadata-end',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,dirtyRect:ownershipDirtyRect});
  }
  _strokeCtx.clearRect(0, 0, _strokeCanvas.width, _strokeCanvas.height);
  _traceStrokeLifecycle('commit-end',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,smartRaster:!!(layers[commitLayer]&&layers[commitLayer].type==='smart-raster')});
  _traceStrokeLifecycle('temporary-stroke-cleared',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame});
  // Phase 1B: symmetric no-op notification to the active renderer that the
  // stroke has been committed to activeC. The actual commit (globalAlpha +
  // _drawBrushComposite onto ctx, above) is still performed right here,
  // exactly as before.
  if(window.BrushRenderer) BrushRenderer.endStroke();
  // Phase 5M: after the stroke has been ended via the existing
  // BrushRenderer.endStroke() call above (unchanged, unmoved), flush any
  // GPU work the active renderer queued during the stroke, via the
  // dispatcher-level BrushRenderer.flushActiveRenderer() API only — no
  // renderer switching, no direct queue/batch access, no change to
  // brush appearance/stabilization/spacing/pressure/taper/texture/
  // opacity/hardness.
  if(window.BrushRenderer) BrushRenderer.flushActiveRenderer();
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
let _disposableDabPrewarm = false;
function _getLiveStrokePreview(){
  const perf=_brushPerf(),previewTotalStart=perf?performance.now():0;
  const w = activeC.width, h = activeC.height;
  const previewAllocated=!_strokePreviewCanvas||_strokePreviewCanvas.width!==w||_strokePreviewCanvas.height!==h;
  const previewBufferStart=perf?performance.now():0;
  if(!_strokePreviewCanvas || _strokePreviewCanvas.width !== w || _strokePreviewCanvas.height !== h){
    _strokePreviewCanvas = document.createElement('canvas');
    _strokePreviewCanvas.width  = w;
    _strokePreviewCanvas.height = h;
    _strokePreviewCtx = _strokePreviewCanvas.getContext('2d');
  } else {
    _strokePreviewCtx.clearRect(0, 0, w, h);
  }
  _strokePreviewCtx.drawImage(activeC, 0, 0);
  if(perf)perf.measure('live-preview-buffer-preparation',previewBufferStart,perf.canvasDetail(_strokePreviewCanvas,_strokePreviewCtx,{allocatedOrResized:previewAllocated,source:'activeC',getImageData:false}));
  if(_strokeCanvas){
    const textureStart=perf?performance.now():0,textureCanvasExisted=!!_texturedStrokeCanvas;
    const src = _getTexturedStrokeCanvas(_strokeCanvas, false);
    if(perf)perf.measure('texture-mask-processing',textureStart,{canvas:'textured-stroke',width:src.width,height:src.height,enabled:!!window.brushTextureEnabled,cacheHit:!window.brushTextureEnabled||textureCanvasExisted,getImageData:!!window.brushTextureEnabled});

    // Smart Raster live preview fix:
    // _commitStrokeCanvas routes through commitSmartRasterBrush which calls
    // SmartRasterLayer.renderFrame Ã¢â‚¬â€ resolving index -> palette RGBA and
    // painting the correct style color.  _getLiveStrokePreview previously
    // just blitted the raw _strokeCanvas, which contains dabs drawn in the
    // default brush color (black/whatever color is), so the preview showed
    // the wrong color while drawing even though the committed result was
    // correct.  We now detect the same Smart Raster condition here and tint
    // the stroke coverage with the active palette style's RGBA before
    // compositing into the preview Ã¢â‚¬â€ making the preview match the final
    // committed render exactly.
    const smartStyleStart=perf?performance.now():0;
    const styleId = typeof activeAdvancedStyleIdForPainting === 'function'
      ? activeAdvancedStyleIdForPainting() : null;
    if(perf&&layers[curLayer]&&layers[curLayer].type==='smart-raster')perf.measure('smart-raster-active-style-resolution',smartStyleStart,{styleId});
    const isSmartRaster = _usesBrushPaintPipeline() && !!styleId
      && typeof advancedPalettePaintingEnabled === 'function'
      && advancedPalettePaintingEnabled();

    let strokeSrc = src; // default: raw stroke canvas (bitmap layers, eraser, etc.)

    if(isSmartRaster&&layers[curLayer]&&layers[curLayer].renderMode==='style-layering'&&typeof window.SmartRasterV4LivePaintPreview==='function'){
      let liveMask=src;const selectionStart=perf?performance.now():0;if(window.SelectionScope)liveMask=SelectionScope.clipCanvas(liveMask);
      if(perf)perf.measure('selection-clipping',selectionStart,{active:!!window.SelectionScope,width:w,height:h,getImageData:false});
      const dirty=_strokeDirty;
      const rect=dirty?{x:Math.max(0,Math.floor(dirty.minX)),y:Math.max(0,Math.floor(dirty.minY)),w:Math.min(w,Math.ceil(dirty.maxX))-Math.max(0,Math.floor(dirty.minX)),h:Math.min(h,Math.ceil(dirty.maxY))-Math.max(0,Math.floor(dirty.minY))}:null;
      const smartStart=perf?performance.now():0;
      const live=window.SmartRasterV4LivePaintPreview({maskCanvas:liveMask,targetCanvas:_strokePreviewCanvas,styleId,opacity:brushOpacity,rect,nonDestructive:_disposableDabPrewarm});
      if(perf)perf.measure('smart-raster-contribution-preview',smartStart,{styleId,rect,getImageData:true,tiles:live&&live.tiles&&live.tiles.length||0});
      const previewSwapStart=perf?performance.now():0;
      if(live&&live.success){if(perf){perf.measure('smart-raster-preview-canvas-swap',previewSwapStart,{target:'stroke-preview',tiles:live&&live.tiles&&live.tiles.length||0});perf.measure('live-preview-total',previewTotalStart,{path:'smart-raster-v4',width:w,height:h});}return _strokePreviewCanvas;}
    }

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
      // wrong color Ã¢â‚¬â€ better than a blank preview.
    }

    const selectionStart=perf?performance.now():0;
    if(window.SelectionScope)strokeSrc=SelectionScope.clipCanvas(strokeSrc);
    if(perf)perf.measure('selection-clipping',selectionStart,{active:!!window.SelectionScope,width:w,height:h,getImageData:false});
    const blendStart=perf?performance.now():0;
    _strokePreviewCtx.save();
    _strokePreviewCtx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
    _drawBrushComposite(_strokePreviewCtx,strokeSrc);
    _strokePreviewCtx.restore();
    if(perf)perf.measure('live-stroke-compositing',blendStart,{blendMode:_usesBrushPaintPipeline()?window.brushBlendMode:'eraser',opacity:brushOpacity,width:w,height:h});
  }
  if(perf)perf.measure('live-preview-total',previewTotalStart,{path:'normal-raster-or-v3',width:w,height:h});
  return _strokePreviewCanvas;
}
window._getLiveStrokePreview = _getLiveStrokePreview;
window.addEventListener('project-loaded',()=>{
  BrushRenderer.invalidateCaches();
  if(typeof window._invalidateTextureCache==='function')window._invalidateTextureCache();
  _pendingDabs.length=0;_frameDirty=null;_strokeDirty=null;
});

// Exercise the same clipped live-stroke composition branch used by the first
// painted dab without changing artwork or stroke state. CompositionPrewarm
// calls this between strokes; the empty scratch mask makes the recomposited
// pixel identical while still touching the persistent preview/texture/tint
// surfaces that Chromium otherwise initializes on the first real dab.
function _prewarmLiveStrokeComposition(){
  if(_inStroke||drawing||!activeC||typeof recomposite!=='function')return false;
  const previousFrameDirty=_frameDirty;
  const previousStrokeDirty=_strokeDirty;
  const previousTexPending=_texPendingRect;
  const previousInStroke=_inStroke;
  try{
    _ensureStrokeCanvas();
    const x=Math.max(0,Math.min(activeC.width-1,Math.floor(activeC.width/2)));
    const y=Math.max(0,Math.min(activeC.height-1,Math.floor(activeC.height/2)));
    _strokeDirty={minX:x,minY:y,maxX:x+1,maxY:y+1};
    _inStroke=true;
    recomposite(curLayer,curFrame,{x,y,w:1,h:1});
    return true;
  }finally{
    _inStroke=previousInStroke;
    _frameDirty=previousFrameDirty;
    _strokeDirty=previousStrokeDirty;
    _texPendingRect=previousTexPending;
    if(_strokeCtx&&_strokeCanvas)_strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
    if(_strokePreviewCtx&&_strokePreviewCanvas)_strokePreviewCtx.clearRect(0,0,_strokePreviewCanvas.width,_strokePreviewCanvas.height);
    if(_srPreviewTintCtx&&_srPreviewTintCanvas)_srPreviewTintCtx.clearRect(0,0,_srPreviewTintCanvas.width,_srPreviewTintCanvas.height);
    if(_texturedStrokeCtx&&_texturedStrokeCanvas)_texturedStrokeCtx.clearRect(0,0,_texturedStrokeCanvas.width,_texturedStrokeCanvas.height);
  }
}
window._prewarmLiveStrokeComposition=_prewarmLiveStrokeComposition;
// Debug-only A/B hook: one production brush stamp on the disposable live
// stroke surfaces, followed by a clipped presentation and immediate restore.
function _prewarmRealDisposableDab(){
  if(_inStroke||drawing||tool!=='brush'||!activeC||typeof recomposite!=='function')return{success:false,error:'Select Brush and finish the active stroke first.'};
  const perf=_brushPerf(),totalStart=performance.now();
  const saved={frameDirty:_frameDirty,strokeDirty:_strokeDirty,texPending:_texPendingRect,inStroke:_inStroke,flowSpacing:_flowSpacingRatio,isPen:_isDrawingWithPen,currentPressure,_smoothedPressure,lastKnownPressure:_lastKnownPressure,strokeFirstSample:_strokeFirstSample,strokeDabCount:_strokeDabCount,strokeDist:_strokeDistSoFar,autoPrev:BrushRenderer.getLineContinuity(),rotationValid:_rotationPrevValid,rotationPrevX:_rotationPrevX,rotationPrevY:_rotationPrevY,rotationDirection:_rotationDirection,disposablePrewarm:_disposableDabPrewarm};
  let rect=null,alphaPixels=0;
  try{
    const prepareStart=perf?performance.now():0;
    _ensureStrokeCanvas();_disposableDabPrewarm=true;_frameDirty=null;_strokeDirty=null;_texPendingRect=null;BrushRenderer.setLineContinuity(null);_strokeReplayDabs.length=0;_inStroke=true;
    _isDrawingWithPen=false;currentPressure=1;_smoothedPressure=1;_lastKnownPressure=1;_strokeFirstSample=true;_strokeDabCount=0;_strokeDistSoFar=0;_rotationPrevValid=false;
    const synthetic={pointerType:'mouse',pressure:0.5,buttons:1,timeStamp:performance.now()};
    const size=Math.max(1,getBrushSize()),margin=Math.min(Math.max(4,Math.ceil(size*2)),Math.max(4,Math.floor(Math.min(activeC.width,activeC.height)/2)));
    const x=Math.max(margin,Math.min(activeC.width-margin,Math.floor(activeC.width/2))),y=Math.max(margin,Math.min(activeC.height-margin,Math.floor(activeC.height/2)));
    _flowSpacingRatio=_initialDabSpacingRatio(synthetic,1);
    if(perf)perf.measure('real-dab-preparation',prepareStart,{size,hardness:brushHardness,opacity:brushOpacity,flow:brushFlow,spacing:window.brushSpacing,tip:!!window.brushTipCanvas,texture:!!window.brushTextureEnabled,blendMode:window.brushBlendMode});
    _stampDab(x,y,synthetic);
    if(!_strokeDirty)throw new Error('Production stamp produced no dirty bounds.');
    rect={x:Math.max(0,Math.floor(_strokeDirty.minX)),y:Math.max(0,Math.floor(_strokeDirty.minY))};rect.w=Math.min(activeC.width,Math.ceil(_strokeDirty.maxX))-rect.x;rect.h=Math.min(activeC.height,Math.ceil(_strokeDirty.maxY))-rect.y;
    const verifyStart=perf?performance.now():0,pixels=_strokeCtx.getImageData(rect.x,rect.y,rect.w,rect.h).data;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i])alphaPixels++;
    if(perf)perf.measure('real-dab-alpha-verification',verifyStart,{rect,alphaPixels,getImageData:true});
    if(!alphaPixels)throw new Error('Production stamp did not produce non-zero alpha.');
    // V4 Smart Raster replaces the ordinary preview blend with its tint/index
    // preview. Touch _drawBrushComposite on the same live preview surface too,
    // without feeding that extra disposable draw into the presentation.
    if(layers[curLayer]&&layers[curLayer].type==='smart-raster'){
      const preview=_getLiveStrokePreview(),src=_getTexturedStrokeCanvas(_strokeCanvas,false),blendStart=perf?performance.now():0;
      _strokePreviewCtx.save();_strokePreviewCtx.globalAlpha=Math.max(0,Math.min(1,brushOpacity));_drawBrushComposite(_strokePreviewCtx,src);_strokePreviewCtx.restore();
      if(perf)perf.measure('live-stroke-compositing',blendStart,{path:'smart-raster-disposable-explicit',width:preview.width,height:preview.height});
    }
    recomposite(curLayer,curFrame,rect);
    return{success:true,rect,alphaPixels,duration:performance.now()-totalStart};
  }catch(error){return{success:false,rect,alphaPixels,error:String(error&&error.message||error),duration:performance.now()-totalStart};}
  finally{
    _inStroke=false;
    if(_strokeCtx&&_strokeCanvas)_strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
    if(_strokePreviewCtx&&_strokePreviewCanvas)_strokePreviewCtx.clearRect(0,0,_strokePreviewCanvas.width,_strokePreviewCanvas.height);
    if(_srPreviewTintCtx&&_srPreviewTintCanvas)_srPreviewTintCtx.clearRect(0,0,_srPreviewTintCanvas.width,_srPreviewTintCanvas.height);
    if(_texturedStrokeCtx&&_texturedStrokeCanvas)_texturedStrokeCtx.clearRect(0,0,_texturedStrokeCanvas.width,_texturedStrokeCanvas.height);
    if(rect)recomposite(curLayer,curFrame,rect);
    _frameDirty=saved.frameDirty;_strokeDirty=saved.strokeDirty;_texPendingRect=saved.texPending;_inStroke=saved.inStroke;_flowSpacingRatio=saved.flowSpacing;_isDrawingWithPen=saved.isPen;currentPressure=saved.currentPressure;_smoothedPressure=saved.smoothedPressure;_lastKnownPressure=saved.lastKnownPressure;_strokeFirstSample=saved.strokeFirstSample;_strokeDabCount=saved.strokeDabCount;_strokeDistSoFar=saved.strokeDist;BrushRenderer.setLineContinuity(saved.autoPrev);_rotationPrevValid=saved.rotationValid;_rotationPrevX=saved.rotationPrevX;_rotationPrevY=saved.rotationPrevY;_rotationDirection=saved.rotationDirection;_disposableDabPrewarm=saved.disposablePrewarm;
    if(perf)perf.measure('real-dab-prewarm-total',totalStart,{rect,alphaPixels});
  }
}
window._prewarmRealDisposableDab=_prewarmRealDisposableDab;
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
  if(tool==='line'||tool==='curve')return _lineAAEnabled?_lineAAQuality:'none';
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
const _Q_ALPHA = 0.02;  // cache-friendly steps for medium/high-opacity dabs
const _Q_ALPHA_LOW = 1/255; // retain low-Flow differences instead of collapsing them
function _quant(v,step){return Math.round(v/step)*step;}
function _quantAlpha(v){return _quant(v,v<0.1?_Q_ALPHA_LOW:_Q_ALPHA);}

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

//  AA strength modes (Edit Ã¢â€“Â¸ Tool Settings Ã¢â€“Â¸ Antialiasing dropdown)
// Root cause of the "chunky, stair-stepped" Hard Round edge (see bug report /
// reference pics): for a near-100%-hardness brush, (1-hardness)*r collapses
// to ~0, so the old _edgeWidthPx fell all the way down to its ONE global
// floor, _EDGE_PX_MIN = 0.6px. A 0.6px-wide antialiasing ramp is barely more
// than a single pixel row of partial coverage Ã¢â‚¬â€ on any diagonal/curved edge
// that reads as a near-binary, stair-stepped boundary even though a
// gradient/coverage calc technically ran. The GPU path made this worse by
// only using extra gradient stops (12) when hardness<0.95; Hard Round
// (hardness>=0.95) got just 3 stops across that already-tiny 0.6px band Ã¢â‚¬â€
// effectively a linear, unantialiased-looking cliff.
//
// Fix: the edge-pixel floor is now driven by an explicit AA MODE that is
// fully independent of Hardness. Hardness still controls the radial
// falloff/core size exactly as before ((1-hardness)*r contributes to the
// edge width for soft brushes); AA mode only sets the MINIMUM edge-pixel
// coverage band and the number of samples/gradient stops used to render it.
// For a 100%-hardness Hard Round, hardness contributes ~0px, so the AA mode
// floor determines the whole visible rim Ã¢â‚¬â€ giving predictable, selectable
// smoothing (None/Weak/Medium/Strong) without ever touching Hardness (the
// solid core / "hard" feel is untouched; only the 1-2px boundary ring is).
const _AA_MODE_EDGE_PX = { none:0, weak:0.85, medium:1.6, strong:2.6 };
const _AA_MODE_EDGE_MAX_PX = { none:0, weak:2, medium:4, strong:7 };
// Gradient stop / supersample counts per mode Ã¢â‚¬â€ more stops means the
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

// AA dab: soft, sub-pixel accurate. Canvas 2D is the production path.
// The CPU rasterizer below is retained only as an internal fallback.
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
// Shared by cached GPU stamps, CPU dabs, and the preset preview.
function _proceduralBrushFalloff(t,hardness,radius,aaMode,isAirbrush){
  const h=Math.max(0,Math.min(1,hardness));
  const inner=_effectiveInnerFrac(Math.max(0.05,radius),h,aaMode);
  if(isAirbrush){
    if(t<=inner) return 1;
    const featherT=(t-inner)/Math.max(0.0001,1-inner);
    return _airbrushFalloff(featherT);
  }
  return _roundBrushFalloff(t,inner,h);
}
window._proceduralBrushFalloff=_proceduralBrushFalloff;
// Airbrush needs denser dab placement than a normal round brush so
// overlapping dabs blend into continuous fog instead of separate visible
// stamps along a stroke (see _strokeSegment/_stampQuadCurve). But the peak
// alpha of an INDIVIDUAL dab must stay strong Ã¢â‚¬â€ that's what gives the
// dark-center/soft-edge radial contrast Photopea shows even from one
// stamp. Only a mild compensation is applied here (not a heavy dampening)
// so tighter spacing doesn't cause the stroke to over-saturate too fast,
// without erasing each dab's own visible falloff.


let _activeDabRotation=0;
// Per-dab roundness override for the current dab being drawn (Roundness
// Jitter). null means "use the static brushTipRoundness slider value".
let _activeDabRoundness=null;


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
let _strokeDirty = null; // full affected bounds retained until the stroke commits
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
  if(!_strokeDirty){
    _strokeDirty={minX,minY,maxX,maxY};
  } else {
    if(minX<_strokeDirty.minX)_strokeDirty.minX=minX;
    if(minY<_strokeDirty.minY)_strokeDirty.minY=minY;
    if(maxX>_strokeDirty.maxX)_strokeDirty.maxX=maxX;
    if(maxY>_strokeDirty.maxY)_strokeDirty.maxY=maxY;
  }
}
function _consumeStrokeDirtyRect(){
  const r=_strokeDirty;_strokeDirty=null;
  if(!r)return null;
  const x=Math.max(0,Math.floor(r.minX)),y=Math.max(0,Math.floor(r.minY));
  const ex=Math.min(activeC.width,Math.ceil(r.maxX)),ey=Math.min(activeC.height,Math.ceil(r.maxY));
  return ex>x&&ey>y?{x,y,w:ex-x,h:ey-y}:null;
}
function _cleanupErasedSmartOwnership(){
  const rect=_consumeStrokeDirtyRect();
  if(tool==='eraser'&&rect&&layers[curLayer]&&layers[curLayer].type==='smart-raster'&&typeof clearStyleIndexWhereTransparent==='function'){
    clearStyleIndexWhereTransparent(rect);
  }
}
//  Texture dirty-rect tracking (separate accumulator/consumer from the
// recomposite dirty-rect above). Grown at the exact same call site
// (_drawDabNow) but consumed independently by the texture pass in
// _getLiveStrokePreview/_commitStrokeCanvas, since those may run on a
// different cadence than recomposite's own consumer. This lets the texture
// mask be (re)applied only over the region that actually changed since the
// texture pass last ran, instead of reprocessing the whole stroke canvas Ã¢â‚¬â€
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

//  Per-dab texture overlay Ã¢â‚¬â€ ALPHA-ONLY masking pipeline
//
// The texture modulates the ALPHA channel of the dab only. The brush color
// is never changed by the texture. Pipeline per dab:
//   1. Brush dab is already painted onto dc (stroke canvas or activeC).
//   2. We build a small temporary canvas covering just the dab footprint.
//   3. We fill it with the brush color at the computed dab alpha (solid flat fill).
//   4. We tile the grayscale texture mask over it using 'destination-in':
//      this multiplies each pixel's alpha by the texture's grayscale value Ã¢â‚¬â€
//      texture-white keeps full alpha, texture-black zeroes alpha.
//   5. depth lerps between "no texture" (flat fill) and "full texture mask".
//   6. The result is blitted onto dc with source-over Ã¢â‚¬â€ color is always the
//      brush color, only coverage/alpha varies with the texture.
//
// CACHE: Two cached canvases are maintained:
//   _texCachedCanvas    Ã¢â‚¬â€ the source texture scaled to brushTextureScale.
//   _texGrayMaskCanvas  Ã¢â‚¬â€ the same canvas converted to white+alpha (grayscale
//                         luminance Ã¢â€ â€™ alpha, RGB set to 255). Used as the
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
  // This only runs when texture/scale/invert changes Ã¢â‚¬â€ never on the per-dab hot path.
  const sw=Math.max(1,Math.round(texC.width*scale));
  const sh=Math.max(1,Math.round(texC.height*scale));

  // Scaled source canvas (kept for any external use / preview).
  const c=document.createElement('canvas');
  c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(texC,0,0,sw,sh);
  _texCachedCanvas=c;

  // Grayscale-alpha mask: luminance Ã¢â€ â€™ alpha, RGB forced to white (255,255,255).
  // This way 'destination-in' compositing only touches alpha, never color.
  //
  // Paper-grain behavior:
  //   - The texture image is treated as a "paper grain" mask.
  //   - Light texture pixels = paint is kept (high alpha).
  //   - Dark texture pixels = paint is removed (low alpha).
  //   - Raw luminance is used as-is Ã¢â‚¬â€ no automatic normalization or forced
  //     contrast curve, so mid-gray texture pixels stay mid-alpha instead of
  //     always being pushed toward solid/transparent (which was crushing
  //     edges to solid black Ã¢â‚¬â€ a "wet ink" look nobody asked for).
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

    // Brightness: -100..100 -> shifts the luminance value by up to Ã‚Â±0.5,
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
      // Full range [0..1]: dark grain Ã¢â€ â€™ alpha 0 (transparent, shows canvas),
      // bright grain Ã¢â€ â€™ alpha 255 (opaque, full paint color).
      d[i]=255; d[i+1]=255; d[i+2]=255; // white Ã¢â‚¬â€ color ignored by destination-in
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

// Cached CanvasPattern for the texture mask Ã¢â‚¬â€ recreated only when the mask
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
// contain the painted (unmasked) pixels for the region [rx,ry,rw,rh] Ã¢â‚¬â€
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

//  Stroke-canvas-level texture masking Ã¢â‚¬â€ flat single-pass stencil
//
// Texture is applied as a static grain mask over whatever the stroke's
// CURRENT alpha looks like, recomputed fresh from the live stroke canvas
// every call. This matches Clip Studio / Photoshop paper-texture behavior:
// the grain reads the same whether a pixel was touched by one dab or by
// twenty overlapping dabs (e.g. a single zigzag stroke crossing itself) Ã¢â‚¬â€
// only actual ink buildup (Flow/Opacity, a separate and intentional control)
// changes how dark a pixel is, never the texture pass itself.
//
// An earlier revision accumulated the mask incrementally per-dab so that
// self-overlapping strokes progressively darkened toward solid black at
// every crossing/turn-around point Ã¢â‚¬â€ a deliberate TVPaint-style effect, but
// not what Clip Studio does and not what most people expect from a paper
// texture. That accumulation has been removed; brushTextureBuildup is no
// longer read here and has no effect on texture darkness.
//
// PERFORMANCE: one clearRect + drawImage + mask pass per call, over the
// full stroke-canvas bounds. Simpler and cheaper than the old delta/snapshot
// diffing, at the cost of always processing the whole canvas rather than
// just the dirty region Ã¢â‚¬â€ acceptable since stroke canvases are small.

let _texturedStrokeCanvas = null, _texturedStrokeCtx = null;

function _ensureTexHelper(w, h, existing, existingCtx){
  if(existing && existing.width === w && existing.height === h) return {c: existing, x: existingCtx};
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return {c, x: c.getContext('2d')};
}

function _getTexturedStrokeCanvas(srcCanvas, forceFull){
  // Bypass all texture masking when:
  //   Ã¢â‚¬Â¢ brushTextureEnabled is false (preset has Texture turned off), OR
  //   Ã¢â‚¬Â¢ brushTextureCanvas is null (no texture image loaded), OR
  //   Ã¢â‚¬Â¢ brushTextureStrength is 0 (strength slider is at minimum).
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
// Tracks the RGB of the dab currently being drawn so _applyTextureToDabDirect can
// access it without needing an extra parameter through the call chain.
let _lastDabRGB=[0,0,0];
function _dabDirtyRadii(d){
  let x=d.r,y=d.r;
  if(window.brushTipCanvas){
    const tipW=window.brushTipCanvas.width||1,tipH=window.brushTipCanvas.height||1;
    const reference=Math.max(tipW,tipH);
    const roundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,d.roundness==null?(window.brushTipRoundness==null?1:window.brushTipRoundness):d.roundness));
    const compressWidth=tipW<tipH;
    const width=tipW*((d.r*2)/reference)*(compressWidth?roundness:1);
    const height=tipH*((d.r*2)/reference)*(compressWidth?1:roundness);
    const cosine=Math.abs(Math.cos(d.rotation||0)),sine=Math.abs(Math.sin(d.rotation||0));
    x=(width*cosine+height*sine)/2;
    y=(width*sine+height*cosine)/2;
  }
  return {x,y};
}
function _drawDabNow(d){
  const customTrace=window.CustomFirstDabTrace,customTraceStart=customTrace&&customTrace.enabled?performance.now():0;
  if(customTrace&&customTrace.enabled)customTrace.beginDab({custom:!!window.brushTipCanvas,radius:d.r,rotation:d.rotation||0,roundness:d.roundness,tipId:customTrace.objectId(window.brushTipCanvas),tipVersion:window.brushTipVersion||0});
  const perf=_brushPerf(),perfStart=perf?performance.now():0;
  _activeDabRotation=window.brushTipCanvas?(d.rotation||0):0;
  _activeDabRoundness=window.brushTipCanvas&&d.roundness!=null?d.roundness:null;
  if(window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.renderer(window.brushTipCanvas?'other-custom-tip-path':'procedural',{effectiveRadius:d.r});
  const dirtyRadius=_dabDirtyRadii(d);
  // Capture the exact destination rectangle before this destructive eraser
  // dab. The same rectangle is reused for coverage measurement and upload.
  const colorEraserBefore=_captureColorEraserDab(d.x,d.y,dirtyRadius.x,dirtyRadius.y);
  // Track current dab color so _applyTextureToDabDirect can use it for alpha-only masking.
  _lastDabRGB=d.rgb;
  // Phase 1B: the actual Canvas2D rasterization (previously inlined here as
  // `if(!_drawAutoHardRoundSegment(d)){ _dabAA(...) or _dabAliased(...) }`)
  // now lives in CpuBrushRenderer.drawDab(), reached via this dispatcher.
  // Same functions, same arguments, same order, same guard — see
  // src/brush/brush-renderer.js for the moved code. Everything else in this
  // function (dirty-rect tracking, texture masking, color-eraser filtering,
  // trace/perf hooks) is brush-engine bookkeeping, not rendering, and stays
  // here unchanged.
  const rendererContext={
    ctx,
    strokeCtx:_strokeCtx,
    inStroke:_inStroke,
    flipX,
    flipY,
    tool,
    brushHardness
  };
  BrushRenderer.drawDab(d,rendererContext);
  _activeDabRotation=0;
  _activeDabRoundness=null;
  // Texture is NO LONGER masked per-dab here. Masking every dab individually
  // meant reading back the stroke canvas and re-applying the texture mask to
  // pixels that earlier, overlapping dabs had already been masked against.
  if(window.brushTextureEnabled && window.brushTextureCanvas && d.composite!=='erase'){
    _growTexDirtyRect(d.x,d.y,dirtyRadius.x,dirtyRadius.y);
    if(!_inStroke) _applyTextureToDabDirect(ctx,d.x,d.y,d.r,d.alpha);
  }
  _filterColorEraserRegion(d.x,d.y,dirtyRadius.x,dirtyRadius.y,colorEraserBefore);
  const dirtyStart=perf?performance.now():0;
  _growDirtyRect(d.x,d.y,dirtyRadius.x,dirtyRadius.y);
  if(perf)perf.measure('dirty-rectangle-expansion',dirtyStart,{radiusX:dirtyRadius.x,radiusY:dirtyRadius.y,rect:_frameDirty&&{minX:_frameDirty.minX,minY:_frameDirty.minY,maxX:_frameDirty.maxX,maxY:_frameDirty.maxY}});
  if(perf)perf.measure('dab-rasterization',perfStart,{dabNumber:_strokeDabCount,radius:d.r,alpha:d.alpha,tip:!!window.brushTipCanvas,airbrush:!!window._brushAirbrush});
  if(customTrace&&customTrace.enabled){customTrace.stage(window.brushTipCanvas?'custom-tip-dab-rasterization':'procedural-dab-rasterization',customTraceStart,{radius:d.r});customTrace.endDab();}
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
  BrushRenderer.setLineContinuity(null);
  _replayingTaper=true;
  for(let i=0;i<_strokeReplayDabs.length;i++){
    const d=_strokeReplayDabs[i];
    _drawDabNow(Object.assign({},d,{r:Math.max(0.05,d.r*factors[i])}));
  }
  _replayingTaper=false;
  BrushRenderer.setLineContinuity(null);
  _strokeReplayDabs.length=0;
  _strokeReplayBase=null;
}
// Brush stabilization stage.
// Input position is stabilized here, then continues unchanged through the
// existing curve reconstruction, spacing, pressure interpolation, and
// stamping pipeline.
//
// This is a time-windowed moving average (boxcar filter): the output point
// is the average of every raw sample received in the last N milliseconds,
// where N scales with the Stabilization slider. This intentionally matches
// TVPaint's "Average (Points)" line-smoothing mode rather than a clamped
// exponential low-pass — there is no hard maximum-lag clamp here, so a
// fast sweeping stroke can genuinely pull the brush tip far behind the
// pointer, the same way it does in TVPaint/prototype. A window in TIME
// (not raw sample count) keeps this zoom-invariant by construction, unlike
// prototype's fixed-sample-count average, which needed a separate
// zoom-compensation hack to stay effective when zoomed out — see the
// zoom-compensation discussion earlier for why that approach was avoided.
//
// Range remap carried over from the previous exponential design: the old
// 100% strength is now the 0% floor (a light, fast-converging window),
// there is no more true bypass, and 100% reaches a much heavier window.
function _stabilizationAmount(){
  const raw=Number(window._tsStabilization);
  return Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):0;
}
// Point-count window, matching prototype/prototype.html's movingAverageAmount()
// exactly: the window is a fixed number of retained SAMPLES, not a span of
// wall-clock time. This is what "Average (Points)" actually names — TVPaint
// counts points, not milliseconds. A time-window trim (the previous design
// here) silently changes effective smoothing strength with drawing speed,
// since a fixed ms span holds more or fewer points depending on how fast
// samples are arriving; a point-count window doesn't have that drift.
function _stabilizerWindowLen(amount){
  const a=Math.max(0,Math.min(1,amount));
  if(a<=0)return 1; // true bypass, matching prototype's maxLen=1 at 0%
  return Math.max(2,Math.round(a*200));
}
// While the pointer is idle mid-stroke (paused, or after lift), synthetic
// samples of the held target position keep getting pushed into the window
// at roughly this cadence, so the average keeps gliding toward the target
// instead of freezing — this is the "Catch Up" glide TVPaint's Average
// (Points) mode shows after you stop moving or release the pen.
const _STABILIZER_IDLE_DELAY_MS=18;
const _STABILIZER_EPS_SCREEN_PX=0.30;
// Mid-stroke catch-up uses hysteresis so a large gap can drain while small
// incoming corrections continue to refine the target.
const _STABILIZER_CATCHUP_ENTER_SCREEN_PX=12;
const _STABILIZER_CATCHUP_EXIT_SCREEN_PX=4;
const _STABILIZER_RECOVERY_PEAK_MIN_SCREEN_PX_PER_MS=0.20;
const _STABILIZER_RECOVERY_DECEL_RATIO=0.45;
const _STABILIZER_RECOVERY_RESUME_RATIO=0.80;
const _STABILIZER_RECOVERY_PEAK_DECAY_MS=280;
// Pressure is 0-1, so this needs its own small epsilon rather than reusing
// the screen-pixel one above — see the convergence gate in _stabilizerAdvance.
const _STABILIZER_PRESSURE_EPS=0.002;

let _stabilizerActive=false;
let _stabilizerX=0,_stabilizerY=0;
let _stabilizerSmoothedPressure=1;
let _stabilizerRawX=0,_stabilizerRawY=0;
let _stabilizerTargetX=0,_stabilizerTargetY=0;
let _stabilizerTargetPressure=1;
let _stabilizerBuf=[]; // {x,y,t} samples (t in performance.now() ms), oldest first
// Pressure moving-average buffer, kept in lockstep with _stabilizerBuf (same
// push/trim calls, same windowLen, every tick). Pressure used to be held flat
// at _stabilizerTargetPressure for the whole catch-up/finish glide, which
// painted a uniform-width thread all the way to the anchor instead of
// continuing the taper the live stroke was already doing. Running it through
// the same point-count average as position — matching prototype's
// pushPressureBuf exactly — lets width keep converging as position converges,
// so a taper that was already narrowing keeps narrowing instead of freezing.
let _stabilizerPressureBuf=[];
let _stabilizerLastSampleT=0;
let _stabilizerLastAdvanceT=0;
let _stabilizerLastInputWallT=0;
let _stabilizerEvent=null;
let _stabilizerRAF=0;
let _stabilizerFinishing=false;
let _stabilizerCatchupActive=false;
let _stabilizerRecoveryActive=false;
let _stabilizerRawSpeed=0,_stabilizerRawPeakSpeed=0;
let _stabilizerRawLastX=0,_stabilizerRawLastY=0,_stabilizerRawLastT=0;
let _stabilizerRecoveryStartT=0,_stabilizerRecoveryLastT=0,_stabilizerRecoveryTickCarry=0;
// Fractional tick carry for the idle-hold/finish catch-up path, mirroring
// the recovery carry above. Ticks-per-ms is often well under 1 (small
// windowLen / long _STABILIZER_CATCHUP_MS), so rounding a fresh
// dtMs*ticksPerMs to an integer every frame -- with a Math.max(1,...)
// floor -- forced at least one full boxcar push per frame regardless of
// the true continuous rate. That manufactured a velocity floor: the tip
// advanced in same-size bursts every frame instead of a continuously
// scaled amount, which is the "slow -> slightly faster -> slow" stepping
// TVPaint doesn't show. Accumulating a persistent fractional carry (and
// only emitting a whole tick once it crosses 1) lets sub-1-tick/frame
// rates actually skip frames instead of being rounded up, so the
// long-run average speed stays correct while the instantaneous velocity
// stops being quantized.
let _stabilizerCatchupLastT=0,_stabilizerCatchupTickCarry=0;
let _stabilizerFinalizeCB=null;

function _stabilizerTrimBuf(maxLen){
  const buf=_stabilizerBuf;
  while(buf.length>maxLen)buf.shift();
  const pbuf=_stabilizerPressureBuf;
  while(pbuf.length>maxLen)pbuf.shift();
}
function _stabilizerBufAverage(){
  const buf=_stabilizerBuf;
  if(!buf.length)return{x:_stabilizerX,y:_stabilizerY};
  let sx=0,sy=0;
  for(let i=0;i<buf.length;i++){sx+=buf[i].x;sy+=buf[i].y;}
  return{x:sx/buf.length,y:sy/buf.length};
}
function _stabilizerPressureAverage(){
  const pbuf=_stabilizerPressureBuf;
  if(!pbuf.length)return _stabilizerSmoothedPressure;
  let sp=0;
  for(let i=0;i<pbuf.length;i++)sp+=pbuf[i];
  return sp/pbuf.length;
}
function _resetStabilization(x,y,t){
  _stabilizerX=x;_stabilizerY=y;
  _stabilizerRawX=x;_stabilizerRawY=y;
  _stabilizerTargetX=x;_stabilizerTargetY=y;
  _stabilizerLastSampleT=t||performance.now();
  _stabilizerLastAdvanceT=performance.now();
  _stabilizerLastInputWallT=_stabilizerLastAdvanceT;
  _stabilizerTargetPressure=currentPressure;
  _stabilizerSmoothedPressure=currentPressure;
  _stabilizerRawSpeed=0;_stabilizerRawPeakSpeed=0;
  _stabilizerRawLastX=x;_stabilizerRawLastY=y;_stabilizerRawLastT=_stabilizerLastSampleT;
  _stabilizerRecoveryActive=false;_stabilizerRecoveryStartT=_stabilizerLastAdvanceT;_stabilizerRecoveryLastT=_stabilizerLastAdvanceT;_stabilizerRecoveryTickCarry=0;
  _stabilizerCatchupLastT=_stabilizerLastAdvanceT;_stabilizerCatchupTickCarry=0;
  // Prefill both buffers to the full moving-average window length at
  // pointer-down, instead of starting from a single sample. Without this,
  // the first N samples of a stroke get averaged over a buffer that is
  // still filling up (1 sample, then 2, then 3, ... up to windowLen), so
  // stabilization strength ramps from "off" to "full" over the first N
  // points instead of being constant from the very first move — this is
  // what produces the localized kink/bump early in a curving stroke.
  // Ported from prototype/prototype.html's beginStroke() (see its comment
  // at the smoothBuf/pressureBuf prefill). Each entry is its own object
  // literal so later in-place mutation of one buffer slot can't alias
  // another.
  const _resetWindowLen=_stabilizerWindowLen(_stabilizationAmount());
  _stabilizerBuf=Array.from({length:_resetWindowLen},()=>({x,y,t:performance.now()}));
  _stabilizerPressureBuf=Array.from({length:_resetWindowLen},()=>currentPressure);
  _stabilizerEvent=null;
  _stabilizerActive=true;
  _stabilizerFinishing=false;
  _stabilizerCatchupActive=false;
  _stabilizerFinalizeCB=null;
  if(_stabilizerRAF){cancelAnimationFrame(_stabilizerRAF);_stabilizerRAF=0;}
  _oldStabilizerReset(x,y);
  _tipDisplayReset(x,y,performance.now());
}
function _stabilizerCancel(){
  _stabilizerActive=false;
  _stabilizerFinishing=false;
  _stabilizerCatchupActive=false;
  _stabilizerRecoveryActive=false;
  _stabilizerRecoveryTickCarry=0;
  _stabilizerCatchupTickCarry=0;
  _stabilizerFinalizeCB=null;
  _stabilizerBuf=[];
  _stabilizerPressureBuf=[];
  if(_stabilizerRAF){cancelAnimationFrame(_stabilizerRAF);_stabilizerRAF=0;}
  _hideStabilizerLeash();
  _tipDisplayCancel();
  _oldStabilizerCancel();
}
function _stabilizerSchedule(){
  if(_stabilizerActive&&!_stabilizerRAF)_stabilizerRAF=requestAnimationFrame(_stabilizerStep);
}
function _stabilizerUpdateCatchupState(){
  const gapScreenPx=_stabilizerGapCanvas()*Math.max(0.05,zoom);
  if(_stabilizerCatchupActive){
    if(gapScreenPx<=_STABILIZER_CATCHUP_EXIT_SCREEN_PX)_stabilizerCatchupActive=false;
  }else if(gapScreenPx>=_STABILIZER_CATCHUP_ENTER_SCREEN_PX){
    _stabilizerCatchupActive=true;
  }
  return _stabilizerCatchupActive;
}
function _stabilizerUpdateRawVelocity(x,y,t){
  const sampleT=Number.isFinite(t)&&t>0?t:performance.now();
  const dt=Math.max(1,sampleT-_stabilizerRawLastT);
  const distanceScreenPx=Math.hypot(x-_stabilizerRawLastX,y-_stabilizerRawLastY)*Math.max(0.05,zoom);
  const instantSpeed=distanceScreenPx/dt;
  _stabilizerRawSpeed=_stabilizerRawSpeed*0.65+instantSpeed*0.35;
  const peakDecay=Math.exp(-dt/_STABILIZER_RECOVERY_PEAK_DECAY_MS);
  _stabilizerRawPeakSpeed=Math.max(_stabilizerRawSpeed,_stabilizerRawPeakSpeed*peakDecay);
  _stabilizerRawLastX=x;_stabilizerRawLastY=y;_stabilizerRawLastT=sampleT;
}
function _stabilizerUpdateRecoveryState(now){
  const gapScreenPx=_stabilizerGapCanvas()*Math.max(0.05,zoom);
  const decelerating=_stabilizerRawPeakSpeed>=_STABILIZER_RECOVERY_PEAK_MIN_SCREEN_PX_PER_MS&&
    _stabilizerRawSpeed<=_stabilizerRawPeakSpeed*_STABILIZER_RECOVERY_DECEL_RATIO;
  if(_stabilizerRecoveryActive){
    if(gapScreenPx<=_STABILIZER_CATCHUP_EXIT_SCREEN_PX||
      _stabilizerRawSpeed>_stabilizerRawPeakSpeed*_STABILIZER_RECOVERY_RESUME_RATIO){
      _stabilizerRecoveryActive=false;
      _stabilizerRecoveryTickCarry=0;
      // Falling back to the plain catch-up path after recovery ends --
      // reseed its clock so the next _stabilizerCatchupTicks call measures
      // elapsed time from now, not from whenever catch-up ticks last ran
      // before recovery took over (which would otherwise dump a large
      // burst of carried-up ticks in one frame).
      _stabilizerCatchupLastT=now;_stabilizerCatchupTickCarry=0;
    }
  }else if(gapScreenPx>=_STABILIZER_CATCHUP_ENTER_SCREEN_PX&&decelerating){
    _stabilizerRecoveryActive=true;
    _stabilizerRecoveryStartT=now;
    _stabilizerRecoveryLastT=now;
    _stabilizerRecoveryTickCarry=0;
  }
  return _stabilizerRecoveryActive;
}

// ---------------------------------------------------------------------
// Legacy exponential-low-pass floor, ported from brush-engineold.js. That
// file forced its whole Stabilization slider to behave like its strongest
// setting (see its _STABILIZER_FORCE_MAX_PLACEHOLDER), which is why its 0%
// never looked raw/jittery -- 0% wasn't really 0% there. The point-count
// moving-average engine above this comment is the real, correct 0-100%
// engine (a true bypass at 0%, so raw sensor/hand jitter is genuinely
// visible there, same as e.g. Krita/Clip Studio's stabilizer at 0). Per
// product decision, 0% should still not look raw -- so this old engine is
// reintroduced ONLY as a fade-in floor that blends in near the very bottom
// of the slider and fades OUT completely by _OLD_STABILIZER_FLOOR_FADE_LIMIT.
// Every setting from there up to 100% -- including 100% itself -- is
// untouched: the floor's blend weight is exactly 0, so the point-count
// engine's output passes through unmodified, bit-identical to before this
// change.
const _OLD_STABILIZER_TAU_MAX=0.050;           // brush-engineold.js's TAU_MAX ("fully on" old engine)
const _OLD_STABILIZER_LAG_MAX_SCREEN_PX=16;    // brush-engineold.js's LAG_MAX_SCREEN_PX
const _OLD_STABILIZER_FLOOR_FADE_LIMIT=0.12;   // UI amount (0-1) above which the floor contributes 0
let _oldStabX=0,_oldStabY=0,_oldStabSpeed=0,_oldStabLastT=0;
function _oldStabilizerFloorWeight(amount){
  const t=Math.min(Math.max(amount/_OLD_STABILIZER_FLOOR_FADE_LIMIT,0),1);
  const smooth=t*t*(3-2*t); // smoothstep
  return 1-smooth; // 1 at UI 0, 0 at/after the fade limit
}
function _oldStabilizerReset(x,y){
  _oldStabX=x;_oldStabY=y;_oldStabSpeed=0;_oldStabLastT=performance.now();
}
function _oldStabilizerCancel(){_oldStabSpeed=0;}
// Advances the old engine's exponential filter toward (targetX,targetY) and
// returns its smoothed position. Mirrors brush-engineold.js's
// _stabilizerEffectiveTau: a speed-adaptive tau so a fast stroke shortens
// the time constant instead of opening an ever-growing gap (that file's
// filter, unlike the point-count engine above, is not meant to rubberband --
// it exists purely to eat jitter at the low end).
function _oldStabilizerAdvance(targetX,targetY,now){
  const dt=Math.max(0.00025,Math.min(0.05,(now-(_oldStabLastT||now))/1000));
  _oldStabLastT=now;
  const dist=Math.hypot(targetX-_oldStabX,targetY-_oldStabY);
  const instSpeed=dist/dt;
  _oldStabSpeed=_oldStabSpeed*0.7+instSpeed*0.3;
  const maxLagCanvas=_OLD_STABILIZER_LAG_MAX_SCREEN_PX/Math.max(0.05,zoom);
  const expectedLagRatio=(_oldStabSpeed*_OLD_STABILIZER_TAU_MAX)/Math.max(0.01,maxLagCanvas);
  const tau=_OLD_STABILIZER_TAU_MAX/(1+Math.max(0,expectedLagRatio));
  const alpha=tau>0?1-Math.exp(-dt/tau):1;
  _oldStabX+=(targetX-_oldStabX)*alpha;
  _oldStabY+=(targetY-_oldStabY)*alpha;
  return{x:_oldStabX,y:_oldStabY};
}
// Blends the point-count engine's output with the old engine's output by
// the fade weight above. Returns {x,y} unchanged (zero extra cost) once the
// weight reaches 0, i.e. for every UI setting at/above the fade limit.
function _applyOldStabilizerFloor(x,y,amount,now){
  const weight=_oldStabilizerFloorWeight(amount);
  if(weight<=0)return{x,y};
  const old=_oldStabilizerAdvance(_stabilizerTargetX,_stabilizerTargetY,now);
  return{x:x+(old.x-x)*weight,y:y+(old.y-y)*weight};
}
// ---------------------------------------------------------------------


// uniform screen-space arc-length intervals. Coordinates and pen attributes
// are interpolated together; no averaging filter or intentional trailing.
const _BASELINE_CANONICAL_STEP_MIN_SCREEN_PX=0.5;
const _BASELINE_CANONICAL_STEP_MAX_SCREEN_PX=2;
const _BASELINE_MAX_GAP_MS=32;
function _baselineCanonicalStepScreenPx(){
  // Below 100%, generate fractional screen-space samples instead of letting
  // one input pixel become a long document-space segment. The interval
  // reaches 0.65px at 10% and returns smoothly to 2px at 100%+.
  const viewScale=Math.max(0,Math.min(1,Number(zoom)||1));
  return _BASELINE_CANONICAL_STEP_MIN_SCREEN_PX+
    (_BASELINE_CANONICAL_STEP_MAX_SCREEN_PX-_BASELINE_CANONICAL_STEP_MIN_SCREEN_PX)*viewScale;
}
const _BASELINE_CORNER_ANGLE_RAD=Math.PI/6;
let _baselineConditionerState=null;
const _baselineConditionerReports=[];
function _baselineSampleFromEvent(e,p,pressure){return{x:p.x,y:p.y,screenX:Number.isFinite(e.clientX)?e.clientX:p.x*zoom,screenY:Number.isFinite(e.clientY)?e.clientY:p.y*zoom,pressure:Number.isFinite(pressure)?pressure:0,tiltX:Number.isFinite(e.tiltX)?e.tiltX:0,tiltY:Number.isFinite(e.tiltY)?e.tiltY:0,twist:Number.isFinite(e.twist)?e.twist:(Number.isFinite(e.rotationAngle)?e.rotationAngle:0),time:Number.isFinite(e.timeStamp)&&e.timeStamp>0?e.timeStamp:performance.now(),pointerId:e.pointerId,event:e};}
function _baselineNewStats(){return{rawSampleCount:0,forwardedSampleCount:0,exactDuplicatesRejected:0,tinyMovementsConsolidated:0,timeGapEmissions:0,attributeChangeEmissions:0,cornerEmissions:0,screenDistance:{sum:0,min:Infinity,max:0,count:0},dt:{sum:0,min:Infinity,max:0,count:0}};}
function _baselineSameSample(a,b){return!!a&&Math.abs(a.x-b.x)<=1e-12&&Math.abs(a.y-b.y)<=1e-12&&Math.abs(a.pressure-b.pressure)<=1e-12&&Math.abs(a.tiltX-b.tiltX)<=1e-12&&Math.abs(a.tiltY-b.tiltY)<=1e-12&&Math.abs(a.twist-b.twist)<=1e-12;}
function _baselineLerpSample(a,b,t){const l=(x,y)=>x+(y-x)*t;return{x:l(a.x,b.x),y:l(a.y,b.y),screenX:l(a.screenX,b.screenX),screenY:l(a.screenY,b.screenY),pressure:l(a.pressure,b.pressure),tiltX:l(a.tiltX,b.tiltX),tiltY:l(a.tiltY,b.tiltY),twist:l(a.twist,b.twist),time:l(a.time,b.time),pointerId:b.pointerId,event:b.event};}
function _baselineEmit(s,sample,out,reason){if(_baselineSameSample(s.lastForwarded,sample))return;if(s.lastForwarded){const d=Math.hypot(sample.screenX-s.lastForwarded.screenX,sample.screenY-s.lastForwarded.screenY),dt=Math.max(0,sample.time-s.lastForwarded.time),ds=s.stats.screenDistance,ts=s.stats.dt;ds.sum+=d;ds.min=Math.min(ds.min,d);ds.max=Math.max(ds.max,d);ds.count++;ts.sum+=dt;ts.min=Math.min(ts.min,dt);ts.max=Math.max(ts.max,dt);ts.count++;}s.lastForwarded=sample;s.stats.forwardedSampleCount++;if(reason==='time')s.stats.timeGapEmissions++;else if(reason==='attribute')s.stats.attributeChangeEmissions++;else if(reason==='corner')s.stats.cornerEmissions++;out.push(sample);}
function _baselineConditionerReset(sample){_baselineConditionerState={previousRaw:null,lastRaw:sample,lastForwarded:null,distanceCarry:0,stats:_baselineNewStats()};_baselineConditionerState.stats.rawSampleCount=1;const out=[];_baselineEmit(_baselineConditionerState,sample,out,'initial');return out;}
// Updates the conditioner's reference point (lastRaw/previousRaw/lastForwarded)
// to match a catch-up/finalize glide sample WITHOUT running distance-stepping
// or emitting anything -- see the call site in _stabilizerEmit for why this
// exists. Catch-up points must never be pushed through the real
// _baselineConditionerPush: that function treats its input as raw, unpaced
// pointer hardware samples and re-interpolates any two consecutive samples
// as a STRAIGHT chord (_baselineLerpSample), which flattens the moving-
// average glide's actual curved convergence path into a straight line. The
// glide is already finely and evenly paced (see _stabilizerAdvance's
// per-tick emission), so it needs none of the conditioner's resampling --
// only its bookkeeping needs to stay current, so that when real pointer
// samples resume after a hold, the conditioner's corner/distance
// calculations start from the position the curve actually converged to,
// not a stale pre-hold reference (see the hold+redirect hook fix above).
function _baselineConditionerSync(sample){
  const s=_baselineConditionerState;if(!s)return;
  s.previousRaw=s.lastRaw;s.lastRaw=sample;s.lastForwarded=sample;s.distanceCarry=0;
}
function _baselineIsCorner(a,b,c){if(!a||!b)return false;const abx=b.screenX-a.screenX,aby=b.screenY-a.screenY,bcx=c.screenX-b.screenX,bcy=c.screenY-b.screenY,ab=Math.hypot(abx,aby),bc=Math.hypot(bcx,bcy);if(ab<0.25||bc<0.25)return false;const cosine=Math.max(-1,Math.min(1,(abx*bcx+aby*bcy)/(ab*bc)));return Math.acos(cosine)>=_BASELINE_CORNER_ANGLE_RAD;}
function _baselineConditionerPush(sample,options={}){
  const s=_baselineConditionerState;if(!s)return[sample];const n=s.stats,out=[];n.rawSampleCount++;
  const a=s.lastRaw,segmentDistance=Math.hypot(sample.screenX-a.screenX,sample.screenY-a.screenY),rawDt=Math.max(0,sample.time-a.time);
  if(segmentDistance<=1e-12&&rawDt<=1e-9&&sample.pointerId===a.pointerId&&_baselineSameSample(sample,a)){n.exactDuplicatesRejected++;return out;}
  if(_baselineIsCorner(s.previousRaw,a,sample)){_baselineEmit(s,a,out,'corner');s.distanceCarry=0;}
  if(segmentDistance>1e-12){const canonicalStep=_baselineCanonicalStepScreenPx();let consumed=0;while(s.distanceCarry+(segmentDistance-consumed)>=canonicalStep){const needed=canonicalStep-s.distanceCarry;consumed+=needed;_baselineEmit(s,_baselineLerpSample(a,sample,Math.min(1,consumed/segmentDistance)),out,'distance');s.distanceCarry=0;}s.distanceCarry+=Math.max(0,segmentDistance-consumed);}else n.tinyMovementsConsolidated++;
  if(!out.length&&s.lastForwarded&&sample.time-s.lastForwarded.time>=_BASELINE_MAX_GAP_MS){_baselineEmit(s,sample,out,segmentDistance<=1e-12?'attribute':'time');s.distanceCarry=0;}
  if(options.force){_baselineEmit(s,sample,out,'forced');s.distanceCarry=0;}
  s.previousRaw=a;s.lastRaw=sample;return out;
}
// Builds a conditioner sample from an ALREADY-STABILIZED point rather than
// a raw event. screenX/screenY intentionally do NOT read e.clientX/clientY
// (the raw pointer's screen position) -- they're derived from the
// stabilized world coordinates instead, because once stabilization runs
// first (see _handleMoveEvent), the canonical-arc-length resampler needs to
// walk the SAME path the stroke is actually being drawn along, not the raw
// pointer path it lagged behind. See _handleMoveEvent for why stabilization
// now runs before conditioning instead of after.
function _baselineSampleFromStabilizedPoint(e,p,time){
  const s=Math.max(0.05,Number(zoom)||1);
  return{x:p.x,y:p.y,screenX:p.x*s,screenY:p.y*s,pressure:Number.isFinite(p.pressure)?p.pressure:0,tiltX:Number.isFinite(e.tiltX)?e.tiltX:0,tiltY:Number.isFinite(e.tiltY)?e.tiltY:0,twist:Number.isFinite(e.twist)?e.twist:(Number.isFinite(e.rotationAngle)?e.rotationAngle:0),time:Number.isFinite(time)&&time>0?time:performance.now(),pointerId:e.pointerId,event:e};
}
function _baselineConditionerFinish(cancelled=false){const s=_baselineConditionerState;if(!s)return;if(window.BaselineStrokeConditionerDiagnostics?.enabled){const n=s.stats,f=v=>({average:v.count?v.sum/v.count:0,min:v.count?v.min:0,max:v.count?v.max:0});_baselineConditionerReports.push({cancelled,rawSampleCount:n.rawSampleCount,forwardedSampleCount:n.forwardedSampleCount,exactDuplicatesRejected:n.exactDuplicatesRejected,tinyMovementsConsolidated:n.tinyMovementsConsolidated,timeGapEmissions:n.timeGapEmissions,attributeChangeEmissions:n.attributeChangeEmissions,cornerEmissions:n.cornerEmissions,screenDistance:f(n.screenDistance),dt:f(n.dt)});if(_baselineConditionerReports.length>100)_baselineConditionerReports.shift();}_baselineConditionerState=null;}
window.BaselineStrokeConditionerDiagnostics={enabled:false,enable(v=true){this.enabled=!!v;return this.enabled;},results(){return JSON.parse(JSON.stringify(_baselineConditionerReports));},latest(){const a=this.results();return a.length?a[a.length-1]:null;},clear(){_baselineConditionerReports.length=0;}};let _stabilizerDebugLastLogT=0;
function _stabilizePoint(x,y,t){
  const amount=_stabilizationAmount();
  // True bypass at 0% for the point-count engine itself (windowLen=1, see
  // _stabilizerWindowLen) -- _applyOldStabilizerFloor below is what actually
  // keeps 0% from looking raw/jittery, not this engine.
  if(!_stabilizerActive)_resetStabilization(x,y,t);

  _stabilizerUpdateRawVelocity(x,y,t);
  _stabilizerLastSampleT=t;
  _stabilizerRawX=x;_stabilizerRawY=y;
  _stabilizerTargetX=x;_stabilizerTargetY=y;
  _stabilizerLastInputWallT=performance.now();

  _stabilizerBuf.push({x,y,t:_stabilizerLastInputWallT});
  _stabilizerPressureBuf.push(_stabilizerTargetPressure);
  const windowLen=_stabilizerWindowLen(amount);
  _stabilizerTrimBuf(windowLen);
  const avg=_stabilizerBufAverage();
  _stabilizerX=avg.x;_stabilizerY=avg.y;
  _stabilizerSmoothedPressure=_stabilizerPressureAverage();

  if(t-_stabilizerDebugLastLogT>500){
    _stabilizerDebugLastLogT=t;
    console.log('[stabilizer debug]',{
      sliderPercent:Math.round(amount*100),
      amount,
      windowLen,
      bufferedSamples:_stabilizerBuf.length,
      lagScreenPx:(Math.hypot(_stabilizerRawX-avg.x,_stabilizerRawY-avg.y)*Math.max(0.05,zoom)).toFixed(2),
      zoom
    });
  }

  _stabilizerLastAdvanceT=performance.now();
  _stabilizerSchedule();
  const floored=_applyOldStabilizerFloor(avg.x,avg.y,amount,_stabilizerLastAdvanceT);
  _stabilizerX=floored.x;_stabilizerY=floored.y;
  _stabilizerUpdateCatchupState();
  _stabilizerUpdateRecoveryState(_stabilizerLastInputWallT);
  _updateStabilizerLeash();
  return{x:_stabilizerX,y:_stabilizerY,pressure:_stabilizerSmoothedPressure};
}
function _stabilizerSetSampleContext(pressure,event){
  _stabilizerTargetPressure=pressure;
  _stabilizerEvent=event;
}
function _stabilizerGapCanvas(){
  return Math.hypot(_stabilizerTargetX-_stabilizerX,_stabilizerTargetY-_stabilizerY);
}
function _stabilizerEmit(x,y,now){
  _updateVelocity(x,y,now);
  if(window._brushAirbrush&&Math.hypot(x-lx,y-ly)>0.01)_airbrushLastMovementTime=performance.now();
  // Pressure is the smoothed/delayed value from the same point-count moving
  // average buffer position uses (see _stabilizerPressureBuf) — NOT held
  // flat at the raw target pressure. This is what lets width keep
  // converging/tapering during the catch-up glide instead of painting a
  // uniform-width thread at whatever pressure happened to be last recorded.
  //
  // Feeds the curve DIRECTLY, same as before the hold+redirect hook fix --
  // routing this through _baselineConditionerPush was tried and reverted
  // (see _baselineConditionerSync's comment): that function re-interpolates
  // consecutive samples as straight chords, which flattened the glide's
  // actual curved convergence into a visible straight line cutting across
  // the stroke on a quick flick-then-release. Only the conditioner's
  // reference state is kept in sync (below), not its resampling.
  const e=_stabilizerEvent||_lastPointerEvent;
  _curveAddPoint(x,y,_stabilizerSmoothedPressure,e);
  _baselineConditionerSync(_baselineSampleFromStabilizedPoint(e,{x,y,pressure:_stabilizerSmoothedPressure},now));
  lx=x;ly=y;currentPressure=_stabilizerSmoothedPressure;
  _scheduleRecomposite();
  _tipDisplayRecordAuthoritative(x,y,now);
  _updateStabilizerLeash();
}

// Stabilizer leash indicator: a dashed line from the raw pointer position
// (anchor) to the stabilized brush position currently being painted (tip),
// matching the lazybrush.dulnan.net-style visualization in
// prototype/prototype.html's drawStabilizerLeash. Uses the same
// EditorOverlayRenderer other tools (curve guide, selection previews) use,
// rather than a dedicated canvas, so it participates in the normal
// resize/view-transform invalidation the other overlays get for free.
let _stabilizerLeashOverlay=null;
// ---------------------------------------------------------------------
// Render-only brush-tip / leash interpolation.
//
// Purely cosmetic. This block never reads back into, and never writes,
// any stabilization state: _stabilizerX/_stabilizerY, _stabilizerBuf,
// _stabilizerTargetX/Y, _stabilizerRAF, or any of the catch-up/recovery
// timing constants are untouched. It does not call _curveAddPoint. It
// exists solely to decide WHERE the leash overlay draws its tip dot on
// a given animation frame -- the authoritative stabilizer tick cadence
// (and everything downstream of it: dabs, spacing, pressure, the
// committed stroke) is completely unaffected by anything here.
//
// Mechanism: every time an authoritative stabilized point is produced
// (a real pointer-driven update in _handleMoveEvent, or a catch-up/
// recovery/finish tick in _stabilizerEmit, or the final lift-off point),
// _tipDisplayRecordAuthoritative() is called with that real point. It
// re-anchors a short glide FROM wherever the dot is currently showing
// TO that new authoritative point, over a duration matched to how much
// time actually elapsed since the previous authoritative update. The
// overlay's draw() call reads the eased position along that segment at
// its own current paint time -- never past the authoritative endpoint,
// never predicting anything beyond it.
// ---------------------------------------------------------------------
let _tipDisplayFromX=0,_tipDisplayFromY=0,_tipDisplayFromT=0;
let _tipDisplayToX=0,_tipDisplayToY=0,_tipDisplayToT=0;
let _tipDisplayLastEmitT=0;
let _tipDisplayRAF=0;
const _TIP_DISPLAY_MIN_SPAN_MS=1;   // guard divide-by-zero on same-instant updates
const _TIP_DISPLAY_MAX_SPAN_MS=40;  // cap so a long gap doesn't read as a slow crawl-in

// Position of the displayed dot at time `now`, eased along the current
// from->to segment. Never extrapolates past `_tipDisplayToX/Y` -- once
// t>=1 the dot simply sits at the last known authoritative point until
// the next real update re-anchors the segment.
function _tipDisplayCurrent(now){
  if(_tipDisplayToT<=_tipDisplayFromT)return{x:_tipDisplayToX,y:_tipDisplayToY};
  const t=Math.max(0,Math.min(1,(now-_tipDisplayFromT)/(_tipDisplayToT-_tipDisplayFromT)));
  const eased=t*t*(3-2*t); // smoothstep -- same easing shape already used elsewhere in this file
  return{
    x:_tipDisplayFromX+(_tipDisplayToX-_tipDisplayFromX)*eased,
    y:_tipDisplayFromY+(_tipDisplayToY-_tipDisplayFromY)*eased
  };
}

// Called with a REAL authoritative stabilized point (never a guess).
// Re-anchors from the dot's current on-screen position (not from the
// previous authoritative target) so a mid-glide update never snaps --
// this is what satisfies "immediately re-anchor / discard any previous
// interpolation target / continue smoothly toward the newest position."
function _tipDisplayRecordAuthoritative(x,y,now){
  const cur=_tipDisplayCurrent(now);
  const span=_tipDisplayLastEmitT
    ?Math.max(_TIP_DISPLAY_MIN_SPAN_MS,Math.min(_TIP_DISPLAY_MAX_SPAN_MS,now-_tipDisplayLastEmitT))
    :_TIP_DISPLAY_MIN_SPAN_MS;
  _tipDisplayFromX=cur.x;_tipDisplayFromY=cur.y;_tipDisplayFromT=now;
  _tipDisplayToX=x;_tipDisplayToY=y;_tipDisplayToT=now+span;
  _tipDisplayLastEmitT=now;
  _tipDisplayScheduleRepaint();
}

// Hard reset at stroke start / cancel -- no glide-in from a stale
// previous-stroke position.
function _tipDisplayReset(x,y,now){
  _tipDisplayFromX=_tipDisplayToX=x;
  _tipDisplayFromY=_tipDisplayToY=y;
  _tipDisplayFromT=_tipDisplayToT=now;
  _tipDisplayLastEmitT=0;
}

// A SEPARATE rAF loop from _stabilizerRAF/_stabilizerSchedule. This one
// only ever calls _updateStabilizerLeash() (an existing, already-safe
// invalidate-the-overlay call) -- it never calls _stabilizerStep or
// _stabilizerAdvance, so stabilization timing (_STABILIZER_IDLE_DELAY_MS,
// _stabilizerLastAdvanceT, tick counts, etc.) is not touched by this loop
// existing or running at a different cadence than tick updates do.
function _tipDisplayScheduleRepaint(){
  if(_tipDisplayRAF)return;
  _tipDisplayRAF=requestAnimationFrame(_tipDisplayRepaintTick);
}
function _tipDisplayRepaintTick(now){
  _tipDisplayRAF=0;
  if(!_stabilizerActive)return; // nothing to glide toward; overlay hides itself
  _updateStabilizerLeash();
  if(now<_tipDisplayToT||_stabilizerActive)_tipDisplayScheduleRepaint();
}
function _tipDisplayCancel(){
  if(_tipDisplayRAF){cancelAnimationFrame(_tipDisplayRAF);_tipDisplayRAF=0;}
}
function _ensureStabilizerLeash(){
  if(_stabilizerLeashOverlay||!window.EditorOverlayRenderer)return;
  _stabilizerLeashOverlay=EditorOverlayRenderer.create('stabilizer-leash',{zIndex:6,draw:function(g,geometry){
    if(!_stabilizerActive)return;
    const anchor=geometry.worldToScreen({x:_stabilizerRawX,y:_stabilizerRawY});
    const tipWorld=_tipDisplayCurrent(performance.now());
    const tip=geometry.worldToScreen(tipWorld);
    const dist=Math.hypot(anchor.x-tip.x,anchor.y-tip.y);
    if(dist<1)return;
    g.save();g.lineCap='round';
    g.beginPath();g.moveTo(anchor.x,anchor.y);g.lineTo(tip.x,tip.y);
    g.setLineDash([5,5]);g.lineDashOffset=0;g.lineWidth=1.25;g.strokeStyle='rgba(20,20,20,0.55)';g.stroke();
    g.setLineDash([]);
    // Anchor dot (raw pointer position) intentionally not drawn -- the
    // native OS cursor already marks that spot, so a second solid dot
    // there was redundant. Only the stabilized brush-tip dot is drawn.
    g.beginPath();g.arc(tip.x,tip.y,3,0,Math.PI*2);g.fillStyle='#5aa9ff';g.fill();
    g.lineWidth=1.25;g.strokeStyle='#ffffff';g.stroke();
    g.restore();
  }});
}
function _updateStabilizerLeash(){
  _ensureStabilizerLeash();if(!_stabilizerLeashOverlay)return;
  const enabled=window._tsLeashEnabled!==false;
  const atFloor=_stabilizationAmount()<=0;
  const dist=Math.hypot(_stabilizerRawX-_stabilizerX,_stabilizerRawY-_stabilizerY);
  const visible=enabled&&!atFloor&&_stabilizerActive&&dist>0.15/Math.max(0.05,zoom);
  _stabilizerLeashOverlay.setVisible(visible);
  if(visible)_stabilizerLeashOverlay.invalidate();
}
function _hideStabilizerLeash(){if(_stabilizerLeashOverlay)_stabilizerLeashOverlay.setVisible(false);}
// Fixed real-world convergence time for the idle/catch-up glide, matching
// prototype/prototype.html's strokeHoldTick: however many points are in the
// window (2 at low stabilization, 100 at max), the catch-up always drains
// it in about this many milliseconds. Without this, catch-up speed is tied
// to window length — a heavier stabilization setting would make the brush
// tip visibly crawl toward the pen after you stop, which is the "so slow
// after I stroke" symptom this constant exists to prevent.
const _STABILIZER_CATCHUP_MS=350;
const _STABILIZER_RECOVERY_RAMP_MS=180;
const _STABILIZER_RECOVERY_MAX_RATE=2.1;
const _STABILIZER_RECOVERY_ERROR_FULL_SCREEN_PX=96;
// Keep the main catch-up rate unchanged while the tip is far behind, then
// drain the last part of an active mid-stroke catch-up more decisively.
// This only applies after the large-gap state has engaged, so slow strokes
// retain their existing moving-average feel.
const _STABILIZER_NEAR_TARGET_SCREEN_PX=24;
const _STABILIZER_NEAR_TARGET_RATE_MAX=2.4;
// Finish-line (pointer-up) pacing — deliberately faster and range-bound
// compared to the idle-hold constant above, matching prototype's endStroke.
const _STABILIZER_FINISH_MIN_MS=80;
const _STABILIZER_FINISH_MAX_MS=260;
let _stabilizerFinishStartT=0;
let _stabilizerFinishTargetMs=_STABILIZER_FINISH_MIN_MS;
function _stabilizerNearTargetRateMultiplier(){
  if(!_stabilizerCatchupActive)return 1;
  const gapScreenPx=_stabilizerGapCanvas()*Math.max(0.05,zoom);
  const near=Math.max(0,Math.min(1,1-gapScreenPx/_STABILIZER_NEAR_TARGET_SCREEN_PX));
  const eased=near*near*(3-2*near);
  return 1+(_STABILIZER_NEAR_TARGET_RATE_MAX-1)*eased;
}
function _stabilizerRecoveryRateMultiplier(now){
  const gapScreenPx=_stabilizerGapCanvas()*Math.max(0.05,zoom);
  const errorStrength=Math.max(0,Math.min(1,
    (gapScreenPx-_STABILIZER_CATCHUP_EXIT_SCREEN_PX)/
    (_STABILIZER_RECOVERY_ERROR_FULL_SCREEN_PX-_STABILIZER_CATCHUP_EXIT_SCREEN_PX)));
  const speedRatio=_stabilizerRawPeakSpeed>0?_stabilizerRawSpeed/_stabilizerRawPeakSpeed:1;
  const decelerationStrength=Math.max(0,Math.min(1,
    (_STABILIZER_RECOVERY_RESUME_RATIO-speedRatio)/_STABILIZER_RECOVERY_RESUME_RATIO));
  const ramp=Math.max(0,Math.min(1,(now-_stabilizerRecoveryStartT)/_STABILIZER_RECOVERY_RAMP_MS));
  const rampStrength=ramp*ramp*(3-2*ramp);
  const strength=errorStrength*decelerationStrength*rampStrength;
  return 1+(_STABILIZER_RECOVERY_MAX_RATE-1)*strength;
}
function _stabilizerRecoveryTicks(windowLen,now){
  if(!_stabilizerRecoveryActive)return null;
  const elapsedMs=Math.max(0,now-_stabilizerRecoveryLastT);
  _stabilizerRecoveryLastT=now;
  _stabilizerRecoveryTickCarry+=elapsedMs*windowLen/_STABILIZER_CATCHUP_MS*
    _stabilizerRecoveryRateMultiplier(now);
  const ticks=Math.min(windowLen,Math.floor(_stabilizerRecoveryTickCarry));
  _stabilizerRecoveryTickCarry-=ticks;
  return ticks;
}
function _stabilizerCatchupTicks(dtMs,windowLen,now){
  // Carry-based accumulation (see _stabilizerCatchupTickCarry above): the
  // instantaneous ticks-per-ms rate below is unchanged from before, but
  // instead of converting dtMs*ticksPerMs to an integer in isolation every
  // frame (which a Math.max(1,...) floor then rounded up to a same-size
  // burst any time the true rate was under 1 tick/frame), the fractional
  // remainder now persists across frames. A frame that computes 0.4 ticks
  // simply carries 0.4 forward and emits nothing; the following frame
  // emits once the accumulated carry crosses 1. Same long-run average
  // rate, continuous instantaneous velocity.
  const elapsedMs=Math.max(0,now-_stabilizerCatchupLastT);
  _stabilizerCatchupLastT=now;
  let ticksPerMs;
  if(_stabilizerFinishing){
    // Ramp from 0.6x to 1.6x the average rate across the finish window, so
    // the tip visibly accelerates into the endpoint rather than crawling at
    // a flat rate the whole time.
    const elapsed=Math.max(0,now-_stabilizerFinishStartT);
    const timeProgress=Math.max(0,Math.min(1,elapsed/_stabilizerFinishTargetMs));
    const s=timeProgress*timeProgress*(3-2*timeProgress); // smoothstep
    const avgTicksPerMs=windowLen/_stabilizerFinishTargetMs;
    ticksPerMs=avgTicksPerMs*0.6+(avgTicksPerMs*1.6-avgTicksPerMs*0.6)*s;
  }else{
    ticksPerMs=(windowLen/_STABILIZER_CATCHUP_MS)*_stabilizerNearTargetRateMultiplier();
  }
  _stabilizerCatchupTickCarry+=elapsedMs*ticksPerMs;
  const ticks=Math.max(0,Math.min(windowLen,Math.floor(_stabilizerCatchupTickCarry)));
  _stabilizerCatchupTickCarry-=ticks;
  return ticks;
}
function _stabilizerAdvance(dt,now){
  if(!_stabilizerActive)return true;
  const amount=_stabilizationAmount();
  const windowLen=_stabilizerWindowLen(amount);
  // Pointer isn't producing new real samples right now (paused, or the
  // stroke is finishing). Keep pushing the held target position into the
  // window at the same cadence real samples would arrive, so the average
  // keeps gliding toward it instead of freezing mid-lag — this is the
  // visible "catch up" glide, matching TVPaint's Catch Up option for
  // Average (Points) mode. Multiple ticks are pushed per call (scaled by
  // dt and window length) so a large window still converges in a fixed
  // real-world time instead of one point-per-frame — and finishing uses a
  // faster, accelerating rate than a mid-stroke idle hold (see
  // _stabilizerCatchupTicks).
  const dtMs=Math.max(0,dt*1000);
  const recoveryTicks=!_stabilizerFinishing?_stabilizerRecoveryTicks(windowLen,now):null;
  const ticks=recoveryTicks===null?_stabilizerCatchupTicks(dtMs,windowLen,now):recoveryTicks;
  // Feed the curve constructor on EVERY tick, not just the last one this
  // frame -- matching prototype/prototype.html's strokeHoldTick, which
  // calls feedPoint() inside its per-tick loop rather than once per RAF.
  // The stroke curve is a rolling 3-point (A,B,C) C1 quadratic (see
  // _curveAddReconstructedPoint); feeding it one coarse jump per frame
  // instead of many fine per-tick steps means each new sample can be a
  // large leap from the last drawn point. Right after a curving stroke
  // stops, the moving average is converging back toward the held anchor
  // from the trailing/outer side of that curve -- a single big jump
  // captured as the new sample point, paired with an equally stale
  // control point, makes the quadratic overshoot past the true
  // convergence path before bending back onto it, which is exactly the
  // hook/loop artifact. Emitting every intermediate tick keeps the curve
  // densely sampled through the bend so it converges smoothly instead.
  // This also explains the rarer kink mid-stroke: any single frame where
  // a coalesced-event gap briefly exceeds the idle threshold hits this
  // same coarse-jump path for one frame.
  for(let i=0;i<ticks;i++){
    _stabilizerBuf.push({x:_stabilizerTargetX,y:_stabilizerTargetY,t:now});
    _stabilizerPressureBuf.push(_stabilizerTargetPressure);
    _stabilizerTrimBuf(windowLen);
    const step=_stabilizerBufAverage();
    _stabilizerSmoothedPressure=_stabilizerPressureAverage();
    const moved=Math.hypot(step.x-_stabilizerX,step.y-_stabilizerY)>1e-4;
    _stabilizerX=step.x;_stabilizerY=step.y;
    if(!moved)break;
    // Same low-end floor blend as _stabilizePoint (see
    // _applyOldStabilizerFloor) -- keeps the idle-hold/finish glide
    // consistent with live drawing at very low Stabilization settings.
    // No-op (weight 0) at/above the fade limit, so this never touches
    // mid-to-high settings, including 100%. Applied per-tick now so the
    // floor blend doesn't itself reintroduce a coarse per-frame jump.
    const floored=_applyOldStabilizerFloor(_stabilizerX,_stabilizerY,amount,now);
    _stabilizerX=floored.x;_stabilizerY=floored.y;
    _stabilizerEmit(_stabilizerX,_stabilizerY,now);
  }

  // Convergence must require BOTH position and pressure to have actually
  // reached their targets. Pressure's boxcar average is a LINEAR ramp — it
  // only becomes exactly the target once all `windowLen` old samples have
  // been evicted, which at 100% (windowLen=100) can take far longer than
  // position needs. Position often has very little left to travel at
  // lift-off (most people slow down before lifting), so its loose 0.3px
  // epsilon used to get satisfied after just a few ticks — ending the whole
  // glide, and the finish callback, while pressure was still mid-ramp. That
  // locked in a partially-converged (thin but nonzero) pressure value for
  // the rest of the stroke: a flat, faint thread instead of a continuing
  // taper. Gating on pressure too makes position simply hold still (target
  // minus target is zero motion) while pressure keeps ramping the
  // remaining ticks, which is exactly the visible "still narrowing while
  // planted at the anchor" look a real taper needs.
  const gapCanvas=_stabilizerGapCanvas();
  const pressureGap=Math.abs(_stabilizerSmoothedPressure-_stabilizerTargetPressure);
  const positionConverged=gapCanvas*Math.max(0.05,zoom)<_STABILIZER_EPS_SCREEN_PX&&gapCanvas<0.4;
  const pressureConverged=pressureGap<=_STABILIZER_PRESSURE_EPS;
  const converged=positionConverged&&pressureConverged;
  if(converged){
    _stabilizerCatchupActive=false;
    _stabilizerRecoveryActive=false;
    _stabilizerRecoveryTickCarry=0;
    // End on the true input point/pressure. The remaining segment is
    // sub-pixel and keeps endpoint behavior exact without a visible snap.
    if(gapCanvas>0.001||pressureGap>0){
      _stabilizerX=_stabilizerTargetX;_stabilizerY=_stabilizerTargetY;
      _stabilizerSmoothedPressure=_stabilizerTargetPressure;
      _stabilizerEmit(_stabilizerX,_stabilizerY,now);
    }
    if(_stabilizerFinishing){
      const cb=_stabilizerFinalizeCB;
      _stabilizerFinalizeCB=null;
      _stabilizerFinishing=false;
      _stabilizerActive=false;
      _stabilizerBuf=[];
      _stabilizerPressureBuf=[];
      _hideStabilizerLeash();
      if(cb)cb();
    }
    return true;
  }
  return false;
}
function _stabilizerStep(now){
  _stabilizerRAF=0;
  if(!_stabilizerActive)return;
  // Normal following keeps the idle delay. Once a large gap is active,
  // fresh low-amplitude samples refine the target without pausing catch-up.
  const shouldCatchUp=_stabilizerFinishing||_stabilizerUpdateCatchupState()||_stabilizerUpdateRecoveryState(now);
  if(!shouldCatchUp&&now-_stabilizerLastInputWallT<_STABILIZER_IDLE_DELAY_MS){
    _stabilizerSchedule();
    return;
  }
  const dt=Math.max(0.00025,Math.min(0.05,(now-_stabilizerLastAdvanceT)/1000));
  _stabilizerLastAdvanceT=now;
  if(!_stabilizerAdvance(dt,now))_stabilizerSchedule();
}
function _stabilizerFinalize(x,y,pressure,event,cb){
  const ownerSession=_activeStrokeSession;
  _stabilizerTargetX=x;_stabilizerTargetY=y;
  _stabilizerTargetPressure=pressure;
  _stabilizerEvent=event||_stabilizerEvent;
  _stabilizerFinishing=true;
  _stabilizerRecoveryActive=false;
  _stabilizerRecoveryTickCarry=0;
  _stabilizerCatchupTickCarry=0;
  _stabilizerCatchupLastT=performance.now();
  // Finish-line pacing: a small remaining gap gets a short, gentle finish;
  // a large flick gets a faster one, and either is quickened further by how
  // fast the pen was actually moving at lift-off. This mirrors prototype's
  // finish loop, which is why pointer-up needs to be visibly snappier than
  // the mid-stroke idle-hold glide (_STABILIZER_CATCHUP_MS) — that constant
  // is tuned for a still-held pen, not for release.
  const startDist=Math.hypot(x-_stabilizerX,y-_stabilizerY);
  const gapNorm=Math.max(0,Math.min(1,startDist/400));
  const speedNorm=Math.max(0.5,Math.min(3,0.6+(_strokeVelocity||0)*1.2));
  let targetMs=(_STABILIZER_FINISH_MIN_MS+gapNorm*(_STABILIZER_FINISH_MAX_MS-_STABILIZER_FINISH_MIN_MS))/speedNorm;
  targetMs=Math.max(_STABILIZER_FINISH_MIN_MS,Math.min(_STABILIZER_FINISH_MAX_MS,targetMs));
  _stabilizerFinishStartT=performance.now();
  _stabilizerFinishTargetMs=targetMs;
  _stabilizerFinalizeCB=()=>{
    if(ownerSession!==_activeStrokeSession){_traceStrokeLifecycle('stabilizer-finalize-rejected',{ownerSession,reason:'obsolete-session'});return;}
    cb();
  };
  _stabilizerLastAdvanceT=performance.now();
  _stabilizerSchedule();
}
function _stabilizerAccelerateToCompletion(){
  if(!(_stabilizerFinishing&&_stabilizerFinalizeCB)){
    _stabilizerCancel();
    return;
  }
  if(_stabilizerRAF){cancelAnimationFrame(_stabilizerRAF);_stabilizerRAF=0;}
  let iterations=0;
  while(_stabilizerActive&&iterations<32){
    if(_stabilizerAdvance(1/30,performance.now()))return;
    iterations++;
  }
  // A destructive edit or artwork switch is a synchronous ownership barrier.
  // If convergence still has a sub-pixel remainder, finish at the true input
  // endpoint and run the existing commit callback before that edit proceeds.
  if(_stabilizerActive&&_stabilizerFinishing&&_stabilizerFinalizeCB){
    _stabilizerX=_stabilizerTargetX;_stabilizerY=_stabilizerTargetY;
    _stabilizerSmoothedPressure=_stabilizerTargetPressure;
    _stabilizerEmit(_stabilizerX,_stabilizerY,performance.now());
    const cb=_stabilizerFinalizeCB;
    _stabilizerFinalizeCB=null;_stabilizerFinishing=false;_stabilizerActive=false;
    cb();
  }
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
  const startTrace=window.CustomFirstDabTrace,startTraceAt=startTrace&&startTrace.enabled?performance.now():0;
  const perf=_brushPerf(),paramsStart=perf?performance.now():0;
  const {r,alpha}=_getEffectiveBrushParams(e);
  if(startTrace&&startTrace.enabled)startTrace.event('brush-parameters-resolved',{duration:performance.now()-startTraceAt,radius:r,alpha});
  if(perf)perf.measure('brush-parameter-resolution',paramsStart,{dabNumber:_strokeDabCount});
  const isErase=tool==='eraser';
  const rgb=isErase?[0,0,0]:_hexToRGB(color);
  const blendSetupStart=perf?performance.now():0;
  const composite=isErase?'erase':'paint';
  if(perf)perf.measure('blend-mode-setup',blendSetupStart,{tool,brushBlendMode:tool==='brush'?window.brushBlendMode:null,composite});
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
let _airbrushLastMovementTime=0;
let _activeStrokePointerId=null;
let _strokeCompletionStarted=true;
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
  if(!window._brushAirbrush||!window._brushContinuousSpraying) return;
  _airbrushTimerX=lx;
  _airbrushTimerY=ly;
  _airbrushLastMovementTime=performance.now();
  _airbrushTimer=setInterval(()=>{
    if(!drawing || !window._brushAirbrush || !window._brushContinuousSpraying){ _stopAirbrushSpray(); return; }
    if(lx!==_airbrushTimerX || ly!==_airbrushTimerY){
      _airbrushTimerX=lx;
      _airbrushTimerY=ly;
      _airbrushLastMovementTime=performance.now();
      return;
    }
    // Movement owns deposition until the stabilized path has been still for
    // two spray ticks. This prevents slow movement and the timer from both
    // painting the same region at full strength.
    if(performance.now()-_airbrushLastMovementTime<Math.max(50,_airbrushIntervalMs()*2))return;
    const previousSpacingRatio=_flowSpacingRatio;
    _flowSpacingRatio=_airbrushCanonicalSpacingRatio(_lastPointerEvent,currentPressure);
    try{_stampDab(lx,ly,_lastPointerEvent);}
    finally{_flowSpacingRatio=previousSpacingRatio;}
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

// Resolve the user-selected brush-relative spacing fraction. Actual dab
// placement also passes through _effectiveDabStep(), which supplies the
// engine-level density floor shared by straight and curved stroke paths.
function _effectiveSpacingFrac(settings){
  const fromSettings=!!settings;
  const mode=fromSettings?settings['ts-spacing-mode']:document.getElementById('ts-spacing-mode')?.value;
  const isAirbrush=fromSettings?!!settings['ts-airbrush']:!!window._brushAirbrush;
  const raw=fromSettings?Number(settings['ts-spacing'])/100:((typeof window!=='undefined'&&window._tsSpacing!=null)?Number(window._tsSpacing):NaN);
  const base=Number.isFinite(raw)&&raw>0?raw:(isAirbrush?0.02:0.12);
  if(mode==='velocity'&&!fromSettings)return base;
  return base;
}
window._resolveBrushSpacingFrac=_effectiveSpacingFrac;
// Professional paint engines cannot rely on brush-relative spacing alone:
// a large brush, a wide preset spacing, or a fast input segment can otherwise
// leave a visibly polygonal chain of dabs. Keep the preset's spacing as the
// upper bound, then cap it by a screen-space density that tightens smoothly as
// pen speed rises. The 0.25px canvas floor is only a runaway-work guard; it is
// twice as dense as the former 0.5px minimum and remains subpixel throughout.
const _DAB_STEP_MIN_CANVAS_PX=0.25;
const _DAB_STEP_SCREEN_CAP_SLOW_PX=1.5;
const _DAB_STEP_SCREEN_CAP_FAST_PX=0.65;
const _DAB_STEP_SPEED_HALF_PX_PER_MS=0.45;
function _effectiveDabStep(radius,settings){
  const brushStep=Math.max(0,radius*2*_effectiveSpacingFrac(settings));
  const speed=Math.max(0,_strokeVelocity);
  const speedMix=speed/(speed+_DAB_STEP_SPEED_HALF_PX_PER_MS);
  const screenCap=_DAB_STEP_SCREEN_CAP_SLOW_PX+
    (_DAB_STEP_SCREEN_CAP_FAST_PX-_DAB_STEP_SCREEN_CAP_SLOW_PX)*speedMix;
  const screenSpaceStep=screenCap/Math.max(0.05,zoom);
  return Math.max(_DAB_STEP_MIN_CANVAS_PX,Math.min(brushStep,screenSpaceStep));
}
window._resolveEffectiveDabStep=_effectiveDabStep;
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
function _airbrushCanonicalSpacingRatio(e,pressure){
  const radius=_computeSpacingRadius(e||_lastPointerEvent,pressure==null?currentPressure:pressure);
  const step=Math.max(0.5,radius*2*0.02);
  return _flowRatioForStep(step,radius);
}
function _initialDabSpacingRatio(e,pressure){
  const radius=_computeSpacingRadius(e,pressure);
  const step=_effectiveDabStep(radius);
  return _flowRatioForStep(step,radius);
}
function _walkDabArc(length,pointAt,e,startPressure,endPressure,pressureAt){
  const pAt = pressureAt || (t=>startPressure+(endPressure-startPressure)*t);
  if(length<=0){currentPressure=pAt(1);return;}
  let distance=0;
  while(distance<length){
    const sample=pointAt(distance);
    const pressure=pAt(sample.t);
    const spacingR=_computeSpacingRadius(e,pressure);
    const step=_effectiveDabStep(spacingR);
    const needed=Math.max(0,step-_strokeSegCarryOver);
    const remaining=length-distance;
    if(needed>remaining){
      _strokeSegCarryOver+=remaining;
      break;
    }
    distance+=needed;
    const dab=pointAt(distance);
    currentPressure=pAt(dab.t);
    _strokeDistSoFar+=step;
    _flowSpacingRatio=_flowRatioForStep(step,spacingR);
    try{_stampDab(dab.x,dab.y,e);}
    finally{_flowSpacingRatio=1;}
    _strokeSegCarryOver=0;
    if(needed===0&&remaining===0) break;
  }
  currentPressure=pAt(1);
}
// Stamp a straight segment using an arbitrary pressureAt(t) profile (t is
// 0..1 progress along the segment) instead of a simple linear ramp between
// two endpoint pressures. Used by the Line tool's Pen Pressure mode so the
// entire recorded pressure curve Ã¢â‚¬â€ not just its start/end values Ã¢â‚¬â€ shapes
// the rendered width.
function _strokeSegmentProfile(ax,ay,bx,by,e,pressureAt){
  const dx=bx-ax,dy=by-ay,dist=Math.sqrt(dx*dx+dy*dy);
  _walkDabArc(dist,d=>{
    const t=dist>0?d/dist:1;
    return{x:ax+dx*t,y:ay+dy*t,t};
  },e,0,0,pressureAt);
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
// Flatness-adaptive arc-length table (replaces the old length-only, 256-cap
// scheme). Rather than deciding "how many divisions" from total estimated
// length up front (which starves long curves once the cap is hit), this
// recursively de-Casteljau splits the quadratic wherever it is locally NOT
// flat, and stops subdividing wherever it already is. A long, gently-curving
// stroke ends up with very few segments (each is nearly straight already); a
// short, sharp curve gets many. Perfectly straight input degenerates to a
// single segment. Total sample count now tracks curvature, not length.
//
// Flatness test: for a quadratic (P0,P1,P2), the maximum deviation of the
// curve from the chord P0->P2 is bounded by (perpendicular distance of P1
// from that chord) / 2. If that's under the tolerance, the chord is an
// acceptable stand-in for the curve over this sub-range.
//
// _QUAD_FLATNESS_TOLERANCE is in canvas-space px (coordinates arriving here
// are already canvas-space, so this is intentionally NOT scaled by zoom).
const _QUAD_FLATNESS_TOLERANCE = 0.25;
// Recursion-depth safety net only Ã¢â‚¬â€ not a length-based cap. Depth 12 allows
// up to ~4096 segments for a single curve in the extreme case where every
// split fails the flatness test at every level, which does not happen for
// any curve a real pen stroke produces; this exists purely to guarantee
// termination on pathological/degenerate input.
const _QUAD_MAX_SPLIT_DEPTH = 12;
const _QUAD_MAX_SEGMENTS = 4096; // paired safety net (segment-count based)
function _quadFlatnessDeviation(x0,y0,cx,cy,x1,y1){
  // Perpendicular distance from control point to the chord, halved (the
  // standard bound on a quadratic's max deviation from its chord).
  const dx=x1-x0,dy=y1-y0;
  const chordLenSq=dx*dx+dy*dy;
  if(chordLenSq<1e-9){
    // Degenerate/near-zero chord (curve doubles back on itself or is a
    // point): fall back to raw control-point offset from the shared
    // endpoint so we still split instead of dividing by ~0.
    return Math.hypot(cx-x0,cy-y0);
  }
  const cross=(cx-x0)*dy-(cy-y0)*dx;
  return Math.abs(cross)/Math.sqrt(chordLenSq)/2;
}
function _quadArcTable(x0,y0,cx,cy,x1,y1){
  const table=[{t:0,x:x0,y:y0,length:0}];
  let length=0,prevX=x0,prevY=y0,segmentCount=0;
  // Iterative stack (avoids recursion-depth concerns) of quadratic
  // sub-segments still needing a flatness decision. Each entry is the
  // sub-segment's own control polygon plus its [t0,t1] range within the
  // original curve and its split depth so far.
  const stack=[{x0,y0,cx,cy,x1,y1,t0:0,t1:1,depth:0}];
  while(stack.length){
    const seg=stack.pop();
    const flat = seg.depth>=_QUAD_MAX_SPLIT_DEPTH
      || segmentCount>=_QUAD_MAX_SEGMENTS
      || _quadFlatnessDeviation(seg.x0,seg.y0,seg.cx,seg.cy,seg.x1,seg.y1) <= _QUAD_FLATNESS_TOLERANCE;
    if(flat){
      length+=Math.hypot(seg.x1-prevX,seg.y1-prevY);
      table.push({t:seg.t1,x:seg.x1,y:seg.y1,length});
      prevX=seg.x1;prevY=seg.y1;segmentCount++;
      continue;
    }
    // De Casteljau split at the sub-segment's own midpoint (t=0.5 of THIS
    // sub-segment, i.e. tmid of the original curve's [t0,t1] range).
    const m0x=(seg.x0+seg.cx)/2, m0y=(seg.y0+seg.cy)/2;
    const m1x=(seg.cx+seg.x1)/2, m1y=(seg.cy+seg.y1)/2;
    const mx=(m0x+m1x)/2, my=(m0y+m1y)/2;
    const tmid=(seg.t0+seg.t1)/2;
    // Push right half first, then left, so the stack (LIFO) pops left
    // half first Ã¢â‚¬â€ keeps emitted table entries in increasing-t order.
    stack.push({x0:mx,y0:my,cx:m1x,cy:m1y,x1:seg.x1,y1:seg.y1,t0:tmid,t1:seg.t1,depth:seg.depth+1});
    stack.push({x0:seg.x0,y0:seg.y0,cx:m0x,cy:m0y,x1:mx,y1:my,t0:seg.t0,t1:tmid,depth:seg.depth+1});
  }
  // Stash the original control points so _quadPointAtLength can evaluate
  // the TRUE curve at an interpolated t, instead of lerping between two
  // table chord endpoints. (Attached as a plain property; `table` is still
  // used as a normal array everywhere else via its indices/length.)
  table.coeffs={x0,y0,cx,cy,x1,y1};
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
  const t=a.t+(b.t-a.t)*f;
  const coeffs=table.coeffs;
  if(coeffs){
    // Evaluate the true quadratic at the interpolated t so stamp centers
    // land on the mathematical curve rather than on a table chord. This is
    // still an approximate arc-length parameterization (t isn't exactly
    // proportional to true arc length between table entries), but the
    // (x,y) position itself is now exact for that t, not a lerp.
    const pt=_quadPoint(coeffs.x0,coeffs.y0,coeffs.cx,coeffs.cy,coeffs.x1,coeffs.y1,t);
    return{t,x:pt.x,y:pt.y};
  }
  return{t,x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f};
}
function _stampQuadCurve(x0,y0,cx,cy,x1,y1,e,startPressure,endPressure){
  const arcTable=_quadArcTable(x0,y0,cx,cy,x1,y1);
  const len=arcTable[arcTable.length-1].length;
  _walkDabArc(len,d=>_quadPointAtLength(arcTable,d),e,startPressure,endPressure);
  return;
  if(len<0.1){
    // BUG FIX: this used to always call _stampDab() here regardless of
    // Spacing. Stabilized slow strokes can produce many closely spaced
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
// -- Deadband REMOVED (Phase 3 stroke-reconstruction fix) ---------------
// The rolling-quadratic construction below (_curveAddPoint/_stampQuadCurve)
// is C1-continuous BY CONSTRUCTION when the raw sample B is used directly
// as the control point: segment N's endpoint is midpoint(B,C) and its
// tangent there points along (C-B); segment N+1's start point is that same
// midpoint(B,C) and its tangent there also points along (C-B) (since its
// control point is C). The two arcs meet with matching tangents at every
// single joint, with no special-casing required.
//
// The deadband that used to sit here broke that guarantee. It scored each
// independent A,B,C triplet by perpendicular-deviation-of-B divided by
// chord length (a RATIO, not a curvature), and fully or partially projected
// B onto the A->C chord when that ratio was small, on the theory that a
// small ratio meant "hand tremor, not intent."
//
// That reasoning doesn't hold: for a fixed real curve of radius R, the
// sagitta of a 3-sample window scales as ~chord^2/R, so the ratio
// (sagitta/chord) scales as ~chord/R -- i.e. it shrinks as sampling gets
// denser, independent of whether the curve is genuine or not. Any broad,
// gently-curving hand-drawn arc, sampled at typical tablet/mouse rates,
// produces the same tiny ratio as real tremor does. The deadband couldn't
// tell them apart, so it silently flattened arbitrary 3-point windows of
// legitimate curves to straight chords. Because only SOME windows along a
// stroke crossed the threshold, the result was a patchwork of true curved
// arcs and force-straightened arcs stitched together -- and every stitch
// point broke the tangent-matching guarantee above, producing a visible
// kink. That is the source of the "polygonal/boxy" appearance reported at
// Stabilization = 0 (which never touched this code path -- confirmed
// _stabilizePoint() is a true bypass at amount 0).
//
// Simulated against synthetic strokes (large/small ellipses, spirals,
// S-curves, slow diagonals, sharp L/V corners, at 0.25x-4x zoom, with
// mouse-jitter amplitudes from 0.3px up to a deliberately heavy 2.0px):
// removing this function entirely dropped the average inter-segment
// tangent-angle deviation from ~8-9deg (with the old deadband, spiking to
// 130-180deg at some joints -- visible kinks) down to ~0.1-1.0deg even
// under heavy synthetic jitter, while genuine sharp corners still showed
// up correctly as real angle changes (~5-6deg per micro-segment at the
// corner apex, not smeared out). No unacceptable jitter was introduced, so
// per the lowest-risk-first directive this fix stops here: full bypass,
// no replacement blend. Left in place (unused) rather than deleted in case
// a future pass wants to reintroduce a properly density-invariant version.
const _COLLINEAR_LOW_RATIO  = 0.015; // no longer used by the hot path
const _COLLINEAR_HIGH_RATIO = 0.08;  // no longer used by the hot path
function _deadbandControlPoint(A,B,C){
  return B; // bypassed -- see comment block above
}
// Rolling 3-point buffer feeding the curve above. Reset at stroke start so
// the first two segments of a stroke (before 3 real points exist) fall
// back to a straight stamp Ã¢â‚¬â€ there's no earlier geometry to curve through
// yet, and this matches the existing stroke-start taper behavior.
let _curveP0=null,_curveP1=null,_curvePr0=0,_curvePr1=0;
let _curveSubpixelConditioning=false,_curveBaselineSamples=null,_curveBaselineNext=0,_curveBaselineRadius=0;
function _resetCurve(x,y,pressure){
  _curveP0={x,y};_curveP1={x,y};_curvePr0=pressure;_curvePr1=pressure;
  _curveSubpixelConditioning=zoom<1;
  // Keep the reconstruction span large enough in screen space at low zoom.
  const viewScale=Math.max(0,Math.min(1,Number(zoom)||1));
  _curveBaselineRadius=_curveSubpixelConditioning?Math.max(1,Math.round(1+6*(1-viewScale))):0;
  _curveBaselineSamples=[];_curveBaselineNext=0;
}
// Feed one new raw sample (x,y,pressure) into the curve buffer and stamp
// the newly-completed segment, if any. Returns nothing; mutates lx/ly-style
// via direct dab stamping same as _strokeSegment did.
function _curveAddReconstructedPoint(x,y,pressure,e){
  if(_curveP0===null){_resetCurve(x,y,pressure);return;}
  const A=_curveP0,B=_curveP1,C={x,y};
  // Only the control point used for THIS emitted arc is softened; the
  // rolling buffer below still stores the real, un-blended B so later
  // segments keep seeing true sample geometry.
  const Bc=_deadbandControlPoint(A,B,C);
  const startPt = {x:(A.x+Bc.x)/2, y:(A.y+Bc.y)/2};
  const endPt   = {x:(Bc.x+C.x)/2, y:(Bc.y+C.y)/2};
  const startPr = (_curvePr0+_curvePr1)/2;
  const endPr   = (_curvePr1+pressure)/2;
  _stampQuadCurve(startPt.x,startPt.y,Bc.x,Bc.y,endPt.x,endPt.y,e,startPr,endPr);
  _curveP0=B;_curveP1=C;_curvePr0=_curvePr1;_curvePr1=pressure;
}
// At low zoom one CSS-pixel tablet step covers many document pixels. Merely
// inserting more points along those quantized chords preserves the staircase
// as a broad wave. Reconstruct the underlying path with a short, symmetric
// screen-space local-polynomial window before feeding the existing C1 curve.
//
// A quadratic Savitzky-Golay centre estimator preserves straight lines and
// quadratic curvature while rejecting the high-frequency 1px coordinate
// staircase. Its radius grows as zoom falls, removing wider low-zoom waves
// without routing 0% through the user-facing stabilizer.
const _BASELINE_SG_COEFFICIENTS=new Map();
function _baselineSGCoefficients(radius){
  if(_BASELINE_SG_COEFFICIENTS.has(radius))return _BASELINE_SG_COEFFICIENTS.get(radius);
  const n=radius*2+1;
  let s2=0,s4=0;
  for(let i=-radius;i<=radius;i++){const q=i*i;s2+=q;s4+=q*q;}
  const denominator=n*s4-s2*s2;
  const coefficients=[];
  for(let i=-radius;i<=radius;i++)coefficients.push((s4-s2*i*i)/denominator);
  _BASELINE_SG_COEFFICIENTS.set(radius,coefficients);
  return coefficients;
}
const _BASELINE_PRESERVE_CORNER_RAD=Math.PI/3;
function _curveBaselineIsCorner(samples,index,radius){
  if(radius<2)return false;
  const a=samples[index-radius],b=samples[index],c=samples[index+radius];
  const abx=b.x-a.x,aby=b.y-a.y,bcx=c.x-b.x,bcy=c.y-b.y;
  const ab=Math.hypot(abx,aby),bc=Math.hypot(bcx,bcy);
  if(ab<1e-9||bc<1e-9)return false;
  const cosine=Math.max(-1,Math.min(1,(abx*bcx+aby*bcy)/(ab*bc)));
  return Math.acos(cosine)>=_BASELINE_PRESERVE_CORNER_RAD;
}
function _curveBaselineEmit(index,finalizing=false){
  const samples=_curveBaselineSamples,n=samples.length,source=samples[index];
  if(!source)return;
  if(index===0||finalizing&&index===n-1){
    _curveAddReconstructedPoint(source.x,source.y,source.pressure,source.event);
    return;
  }
  const radius=Math.min(_curveBaselineRadius,index,n-1-index);
  if(radius<=0||_curveBaselineIsCorner(samples,index,radius)){
    _curveAddReconstructedPoint(source.x,source.y,source.pressure,source.event);
    return;
  }
  const coeffs=_baselineSGCoefficients(radius);
  let x=0,y=0;
  for(let j=-radius;j<=radius;j++){
    const weight=coeffs[j+radius],sample=samples[index+j];
    x+=sample.x*weight;y+=sample.y*weight;
  }
  _curveAddReconstructedPoint(x,y,source.pressure,source.event);
}
function _curveAddPoint(x,y,pressure,e){
  if(!_curveSubpixelConditioning){_curveAddReconstructedPoint(x,y,pressure,e);return;}
  const samples=_curveBaselineSamples;
  samples.push({x,y,pressure,event:e});
  if(samples.length===1){
    _curveBaselineEmit(0);
    _curveBaselineNext=1;
    return;
  }
  while(_curveBaselineNext+_curveBaselineRadius<samples.length){
    _curveBaselineEmit(_curveBaselineNext++);
  }
}
// Called once at stroke end to draw the final bit of curve from the last

// completed midpoint segment all the way out to the true last pen
// position, so the stroke always ends exactly under the pen (no
// perceptible "still catching up" tail Ã¢â‚¬â€ this is a one-time geometric
// closeout, not an ongoing lag).
function _flushCurveTail(e){
  // Complete the reconstruction window with progressively smaller symmetric
  // kernels, then emit the final raw pen position exactly.
  if(_curveSubpixelConditioning&&_curveBaselineSamples){
    while(_curveBaselineNext<_curveBaselineSamples.length){
      _curveBaselineEmit(_curveBaselineNext++,true);
    }
  }
  if(_curveP0===null||_curveP1===null) return;
  const B=_curveP1;
  // Finalization uses the same arc-length spacing path as movement. For a
  // stationary tap startPt===B, so this emits no second dab.
  const startPt={x:(_curveP0.x+B.x)/2,y:(_curveP0.y+B.y)/2};
  _stampQuadCurve(startPt.x,startPt.y,B.x,B.y,B.x,B.y,_lastPointerEvent||e,(_curvePr0+_curvePr1)/2,_curvePr1);
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
  _curveBaselineSamples=null;_curveBaselineNext=0;_curveBaselineRadius=0;_curveSubpixelConditioning=false;
}

// Line tool editable pressure profile. Samples live in a mutable distance
// domain. Shortening destructively truncates the tail; extension appends
// fresh tablet pressure; rotation at effectively constant length changes
// geometry only.
const _LINE_LENGTH_EDIT_EPSILON=.75;
function _linePressureAtDistance(samples,distance){
  if(!samples||!samples.length)return 1;
  if(distance<=samples[0].distance)return samples[0].pressure;
  let lo=samples[0];
  for(let i=1;i<samples.length;i++){
    const hi=samples[i];
    if(distance<=hi.distance){const span=hi.distance-lo.distance,f=span>0?(distance-lo.distance)/span:0;return lo.pressure+(hi.pressure-lo.pressure)*f;}
    lo=hi;
  }
  return samples[samples.length-1].pressure;
}
function _cropLinePressureProfile(newLength){
  const gesture=_lineGesture,samples=gesture.pressureSamples;
  const removed=samples.reduce((count,sample)=>count+(sample.distance>newLength+.0001?1:0),0);
  const boundaryPressure=_linePressureAtDistance(samples,newLength);
  const retained=samples.filter(sample=>sample.distance<newLength-.0001);
  if(!retained.length||retained[0].distance>0)retained.unshift({distance:0,pressure:samples[0].pressure});
  const last=retained[retained.length-1];
  if(!last||Math.abs(last.distance-newLength)>.0001)retained.push({distance:newLength,pressure:boundaryPressure});
  else last.pressure=boundaryPressure;
  gesture.pressureSamples=retained;
  gesture.recordedLength=newLength;
  currentPressure=boundaryPressure;_prevRawPressure=boundaryPressure;_lastKnownPressure=boundaryPressure;
  return removed;
}
function _editLinePressureProfile(lineEvents){
  const gesture=_lineGesture,latest=lineEvents[lineEvents.length-1];
  const sx=gesture.startPoint.x,sy=gesture.startPoint.y;
  const previousLength=gesture.currentLength;
  const sampleCountBefore=gesture.pressureSamples.length;
  let action='rotate',removedSampleCount=0,appendedSampleCount=0,currentEventPressure=Number(latest.event.pressure);
  if(getLinePressureMode()==='pen'){
    // Process the coalesced packet chronologically. A packet may extend and
    // retract before its final event; sequential editing guarantees that an
    // overshot tail is destructively cropped instead of surviving hidden.
    for(const sample of lineEvents){
      const distance=Math.hypot(sample.point.x-sx,sample.point.y-sy);
      if(distance<gesture.recordedLength-_LINE_LENGTH_EDIT_EPSILON){
        action='crop';removedSampleCount+=_cropLinePressureProfile(distance);
        currentEventPressure=gesture.pressureSamples[gesture.pressureSamples.length-1].pressure;
      }else if(distance>gesture.recordedLength+_LINE_LENGTH_EDIT_EPSILON){
        action='extend';
        const pressure=_getPressure(sample.event);
        gesture.pressureSamples.push({distance,pressure});
        _linePressureSamples.push({x:sample.point.x,y:sample.point.y,pressure});
        gesture.recordedLength=distance;currentEventPressure=pressure;appendedSampleCount++;
      }
    }
  }
  const newLength=Math.hypot(latest.point.x-sx,latest.point.y-sy);
  gesture.currentLength=newLength;gesture.endPoint={x:latest.point.x,y:latest.point.y};gesture.currentEventPressure=currentEventPressure;
  const samples=gesture.pressureSamples;
  gesture.lastEditDiagnostic={previousLength,newLength,recordedLength:gesture.recordedLength,action,currentEventPressure,sampleCountBefore,sampleCountAfter:samples.length,removedSampleCount,appendedSampleCount,maxStoredDistance:samples.length?samples[samples.length-1].distance:0};
  return gesture.lastEditDiagnostic;
}
function _getLinePressureProfile(sx,sy,ex,ey){
  const length=Math.max(.0001,Math.hypot(ex-sx,ey-sy));
  if(!_lineGesture||!_lineGesture.pressureSamples.length)return[{t:0,pressure:1,distance:0},{t:1,pressure:1,distance:length}];
  const profile=_lineGesture.pressureSamples.map(sample=>({t:Math.max(0,Math.min(1,sample.distance/length)),pressure:sample.pressure,distance:sample.distance}));
  const last=profile[profile.length-1];
  if(last.t<1)profile.push({t:1,pressure:last.pressure,distance:length});
  return profile;
}
function _buildLinePressureProfile(sx,sy,ex,ey){
  const length=Math.max(.0001,Math.hypot(ex-sx,ey-sy));
  const samples=_lineGesture&&_lineGesture.pressureSamples||[];
  return function pressureAt(t){
    t=Math.max(0,Math.min(1,t));if(window.DEBUG_LINE_TOOL)_lineDiagnosticCurrentT=t;
    return _linePressureAtDistance(samples,t*length);
  };
}
// Renders the Line tool's current drag (or its final committed state) into
// _strokeCanvas from scratch: clears any previous stamp, then re-walks the
// whole line so both live preview (called every pointermove) and the final
// commit (called once at pointerup) share the exact same code path Ã¢â‚¬â€ the
// preview IS what gets committed, not an approximation of it. Reuses the
// normal brush engine (_strokeSegment/_strokeSegmentProfile -> _stampDab)
// so hardness, flow, opacity, AA, and brush tip all stay consistent with
// every other tool.
function _curvePressureProfile(){
  const samples=_lineGesture&&_lineGesture.pressureSamples||[],domain=Math.max(.0001,_lineGesture&&_lineGesture.recordedLength||1);
  return t=>_linePressureAtDistance(samples,Math.max(0,Math.min(1,t))*domain);
}
function _strokeQuadraticProfile(p0,p1,p2,e,pressureAt){
  const table=_quadArcTable(p0.x,p0.y,p1.x,p1.y,p2.x,p2.y),length=table[table.length-1].length;
  _walkDabArc(length,d=>{const point=_quadPointAtLength(table,d);point.t=length>0?d/length:1;return point;},e,0,0,pressureAt);
}
function _ensureCurveGuide(){
  if(_curveGuideOverlay||!window.EditorOverlayRenderer)return;
  _curveGuideOverlay=EditorOverlayRenderer.create('curve-tool-guide',{zIndex:5,draw:function(g,geometry){
    if(!_curveToolGesture||_curveToolGesture.phase!=='bending')return;
    const p0=geometry.worldToScreen(_curveToolGesture.start),p1=geometry.worldToScreen(_curveToolGesture.control),p2=geometry.worldToScreen(_curveToolGesture.end);
    g.strokeStyle='rgba(127,119,221,.9)';g.fillStyle='#7f77dd';g.lineWidth=1;g.setLineDash([4,3]);g.beginPath();g.moveTo(p0.x,p0.y);g.lineTo(p1.x,p1.y);g.lineTo(p2.x,p2.y);g.stroke();g.setLineDash([]);
    for(const p of[p0,p1,p2]){g.beginPath();g.arc(p.x,p.y,4,0,Math.PI*2);g.fill();g.strokeStyle='rgba(255,255,255,.9)';g.stroke();}
  }});
}
function _clearCurveGuide(){if(_curveGuideOverlay)_curveGuideOverlay.setVisible(false);}
function _drawCurveGuide(){
  _ensureCurveGuide();if(!_curveGuideOverlay)return;
  const visible=!!(_curveToolGesture&&_curveToolGesture.phase==='bending');
  _curveGuideOverlay.setVisible(visible);if(visible)_curveGuideOverlay.invalidate();
}
function _includeLinePreviewFrameBounds(bounds){
  if(!bounds)return;
  if(!_frameDirty)_frameDirty={minX:bounds.minX,minY:bounds.minY,maxX:bounds.maxX,maxY:bounds.maxY};
  else{
    _frameDirty.minX=Math.min(_frameDirty.minX,bounds.minX);_frameDirty.minY=Math.min(_frameDirty.minY,bounds.minY);
    _frameDirty.maxX=Math.max(_frameDirty.maxX,bounds.maxX);_frameDirty.maxY=Math.max(_frameDirty.maxY,bounds.maxY);
  }
}
function _clearLinePreviewCanvas(canvas,context){
  if(!canvas||!context)return;
  context.save();
  context.setTransform(1,0,0,1,0,0);
  context.globalAlpha=1;
  context.globalCompositeOperation='source-over';
  context.clearRect(0,0,canvas.width,canvas.height);
  context.restore();
  context.setTransform(1,0,0,1,0,0);
  context.globalAlpha=1;
  context.globalCompositeOperation='source-over';
}
function _renderLineDrag(ex,ey,e,phase){
  if(!lineStart) return;
  // Phase 5L: route this function's full stroke execution (the entire
  // line/curve replay below — every dab from start to end of the current
  // stroke) through BrushRenderer.withStrokeFrame(). This wraps the whole
  // batched stroke exactly once per call; it does not touch, reorder, or
  // duplicate any individual beginStroke()/drawDab()/endStroke() call
  // inside the wrapped code — those still happen exactly as before, via
  // _ensureStrokeCanvas()/_stampDab()/_queueDab()/_drawDabNow(), in the
  // same order. withStrokeFrame() only brackets this existing work with
  // the renderer's begin/end-frame lifecycle; it never selects or
  // switches renderers.
  return BrushRenderer.withStrokeFrame(()=>{
  const curveBending=tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending';
  const curveControl=curveBending?{x:ex,y:ey}:null;
  if(curveBending){ex=_curveToolGesture.end.x;ey=_curveToolGesture.end.y;_curveToolGesture.control=curveControl;}

  const previousEndpoint=_linePreviewPreviousEndpoint&&{x:_linePreviewPreviousEndpoint.x,y:_linePreviewPreviousEndpoint.y};
  const previousBounds=_linePreviewBounds&&{minX:_linePreviewBounds.minX,minY:_linePreviewBounds.minY,maxX:_linePreviewBounds.maxX,maxY:_linePreviewBounds.maxY};
  const transformBeforeClear=_strokeCtx&&typeof _strokeCtx.getTransform==='function'?_strokeCtx.getTransform():null;
  const dabsBefore=_strokeDabCount,previewFrameId=++_linePreviewFrameId;
  _includeLinePreviewFrameBounds(previousBounds);
  _clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);
  _clearLinePreviewCanvas(_texturedStrokeCanvas,_texturedStrokeCtx);
  _strokeDirty=null;
  _texPendingRect=null;
  _pendingDabs.length=0;
  _strokeSegCarryOver=0;
  _strokeDistSoFar=0;
  BrushRenderer.setLineContinuity(null);
  _rotationPrevValid=false;
  _beginEndTaperCapture();
  const usePenPressure=_isDrawingWithPen&&getLinePressureMode()==='pen';
  if(window.DEBUG_LINE_TOOL)_lineEffectivePressureSamples=[];
  // Deterministic pressure-smoothing seed for THIS replay ------------------
  // _renderLineDrag fully re-walks the whole line from t=0 on every single
  // pointermove (live preview) and once more at commit -- each call is an
  // independent, from-scratch replay of the same line. _smoothedPressure
  // (the EMA that _resolveControl('pressure',e) maintains inside
  // _computeEffectiveParams, and which the rendered dab radius actually
  // comes from) is a persistent module-level variable that is meant to
  // carry over *within* a stroke -- that's what gives freehand brush
  // strokes their natural taper. But because the Line tool calls this
  // function repeatedly for the SAME stroke, each replay was inheriting
  // whatever pressure the *previous* frame's *last* dab (near the current,
  // still-moving endpoint) left the EMA at, instead of starting clean. As
  // the line direction rotated during the drag, that leftover seed changed
  // every frame -- producing a start-of-line width that visibly grew and
  // shrank even though the pinned start pressure (pAt(0)) itself was
  // already perfectly stable.
  // Fix: snap _smoothedPressure to the correct starting value for this
  // replay before walking (matching the same "no ramp-in lag" snap already
  // used at real stroke start, see pointerdown), let it evolve normally
  // across this walk's dabs exactly as before (this is what preserves the
  // taper), then restore whatever _smoothedPressure held beforehand once
  // the replay finishes. Restoring afterward scopes the reset to this
  // replay only, so it can't leak into the next preview frame's seed choice
  // (moot, since we always reset explicitly) nor into an unrelated stroke
  // started right after (e.g. switching to Brush immediately after drawing
  // a line).
  const _savedSmoothedPressureForLinePreview=_smoothedPressure;
  _smoothedPressure = usePenPressure
    ? ((_linePressureSamples&&_linePressureSamples.length) ? _linePressureSamples[0].pressure : currentPressure)
    : 1; // Fixed Pressure / mouse / touch: matches the constant currentPressure=1 used below
  try{
    if(usePenPressure){
      const pressureAt=curveBending?_curvePressureProfile():_buildLinePressureProfile(lineStart.x,lineStart.y,ex,ey);
      const startPressure=pressureAt(0),savedFlowSpacingRatio=_flowSpacingRatio;
      currentPressure=startPressure;_flowSpacingRatio=_initialDabSpacingRatio(e,startPressure);
      try{_stampDab(lineStart.x,lineStart.y,e);}finally{_flowSpacingRatio=savedFlowSpacingRatio;}
      currentPressure=pressureAt(1);
      if(curveBending)_strokeQuadraticProfile(lineStart,curveControl,{x:ex,y:ey},e,pressureAt);
      else _strokeSegmentProfile(lineStart.x,lineStart.y,ex,ey,e,pressureAt);
    }else{
      // Fixed Pressure (and the mouse/touch fallback): temporarily behave as
      // if this weren't a pen stroke at all, which is exactly how the rest
      // of the brush engine already renders constant, pressure-independent
      // width/flow/opacity for mouse input (_computeSpacingRadius's
      // sizeCtrl==='pressure' branch only applies scaling when
      // _isDrawingWithPen is true). That gives a true constant-width line at
      // the current brush size with zero tablet-pressure influence.
      const savedIsDrawingWithPen=_isDrawingWithPen;
      _isDrawingWithPen=false;
      currentPressure=1;
      try{
        const savedFlowSpacingRatio=_flowSpacingRatio;_flowSpacingRatio=_initialDabSpacingRatio(e,1);
        try{_stampDab(lineStart.x,lineStart.y,e);}finally{_flowSpacingRatio=savedFlowSpacingRatio;}
        if(curveBending)_strokeQuadraticProfile(lineStart,curveControl,{x:ex,y:ey},e,()=>1);
        else _strokeSegment(lineStart.x,lineStart.y,ex,ey,e,1,1);
      }
      finally{ _isDrawingWithPen=savedIsDrawingWithPen; }
    }
  } finally {
    _smoothedPressure=_savedSmoothedPressureForLinePreview;
  }
  _flushStrokeTail();
  _linePreviewBounds=_strokeDirty?{minX:_strokeDirty.minX,minY:_strokeDirty.minY,maxX:_strokeDirty.maxX,maxY:_strokeDirty.maxY}:null;
  _linePreviewPreviousEndpoint={x:ex,y:ey};
  if(curveBending)_drawCurveGuide();
  if(window.DEBUG_LINE_TOOL){
    const storedProfile=usePenPressure?_getLinePressureProfile(lineStart.x,lineStart.y,ex,ey):[{t:0,pressure:1},{t:1,pressure:1}];
    const diagnostic={
      tool:'line',phase:_lineGesture?_lineGesture.phase:'unknown',renderPhase:phase||'preview',pressureMode:getLinePressureMode(),
      rawPressureSamples:_linePressureSamples.map(sample=>({x:sample.x,y:sample.y,pressure:sample.pressure})),
      storedPressureSamples:storedProfile,
      effectivePressureSamples:_lineEffectivePressureSamples.slice(),
      canonicalBrushSize:toolSizes.brush,
      lineSliderSize:Number(document.querySelector('[data-option-kind="line-size"]')?.value||toolSizes.line),
      shortcutUpdatedSize:window._lastLineShortcutSize||null,
      effectiveDiameter:getBrushSize(),canvasScale:1,zoom,
      stampCount:_strokeDabCount-dabsBefore,
      currentEventPressure:_lineGesture?_lineGesture.currentEventPressure:null,
      storedPressureProfile:_lineGesture?_lineGesture.pressureSamples.map(sample=>({distance:sample.distance,pressure:sample.pressure})):storedProfile,
      profileSampleCount:_lineGesture?_lineGesture.pressureSamples.length:storedProfile.length,
      lineLength:Math.hypot(ex-lineStart.x,ey-lineStart.y),
      endpoint:{x:ex,y:ey},
      ...(_lineGesture&&_lineGesture.lastEditDiagnostic||{})
    };
    const records=window.__lineToolDiagnostics||(window.__lineToolDiagnostics=[]);records.push(diagnostic);if(records.length>200)records.splice(0,records.length-200);
    console.debug('[LineToolDiagnostics]',diagnostic);
  }
  if(window.DEBUG_LINE_PREVIEW){
    const matrix=transformBeforeClear?{a:transformBeforeClear.a,b:transformBeforeClear.b,c:transformBeforeClear.c,d:transformBeforeClear.d,e:transformBeforeClear.e,f:transformBeforeClear.f}:null;
    console.debug('[LinePreview]',{previewFrameId,pointermoveSequence:_linePreviewMoveSequence,generation:_linePreviewGeneration,canvasWidth:_strokeCanvas&&_strokeCanvas.width||0,canvasHeight:_strokeCanvas&&_strokeCanvas.height||0,transformBeforeClear:matrix,clearRectangle:{x:0,y:0,width:_strokeCanvas&&_strokeCanvas.width||0,height:_strokeCanvas&&_strokeCanvas.height||0},previousEndpoint,currentEndpoint:{x:ex,y:ey},brushTipDiameter:getBrushSize(),stampCount:_strokeDabCount-dabsBefore,stalePreviewDiscarded:false,previousBounds,currentBounds:_linePreviewBounds});
  }
  });
}

// PERF FIX: recompositing flattens every layer/group (full-canvas
// drawImage per layer, plus mask canvases) Ã¢â‚¬â€ that's fine to do once per
// frame, but the old code called it synchronously on EVERY pointermove,
// and pointermove can fire 100+ times/sec on a fast mouse or tablet.
// That full-stack re-flatten on every single input event is the main
// reason this felt laggy compared to TVPaint even WITH antialiasing on.
// Fix: coalesce to at most one recomposite per animation frame.
let _recompRAF=false,_recompRAFHandle=0,_recompGeneration=0,_recompCoalescedRequests=0,_deferredKeyVisualRefreshAfterNextPresentation=false;
function _flushDeferredKeyVisualRefreshAfterPresentation(){
  if(!_deferredKeyVisualRefreshAfterNextPresentation)return;
  _deferredKeyVisualRefreshAfterNextPresentation=false;
  if(window._scheduleDeferredKeyVisualRefreshAfterPresentation)window._scheduleDeferredKeyVisualRefreshAfterPresentation();
}
function _scheduleRecomposite(options){
  const firstDab=!!(options&&options.firstDab),perf=_brushPerf(),firstDabExperiment=window.BrushFirstDabExperiment,legacyExperiment=window.KeyframeLatencyExperiment&&window.KeyframeLatencyExperiment.active?window.KeyframeLatencyExperiment:window.BrushRafExperiment,experiment=firstDabExperiment||legacyExperiment;
  if(firstDab)_deferredKeyVisualRefreshAfterNextPresentation=true;
  if(firstDab&&window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.beforeSchedule();
  if(perf)perf.point('recomposite-requested',{firstDab,rafAlreadyPending:_recompRAF,visibility:document.visibilityState,focused:document.hasFocus(),framePhaseMs:performance.now()%16.67});
  if(experiment)experiment.noteRecompositeRequest({firstDab,rafAlreadyPending:_recompRAF});
  const decision=firstDabExperiment?firstDabExperiment.decide({firstDab,rafAlreadyPending:_recompRAF}):null;
  const immediate=decision?decision.immediate:experiment&&experiment.shouldPresentImmediately({firstDab,rafAlreadyPending:_recompRAF});
  if(immediate){
    let scheduledWork='none';
    if(_recompRAF&&_recompRAFHandle){cancelAnimationFrame(_recompRAFHandle);_recompRAFHandle=0;_recompRAF=false;_recompCoalescedRequests=0;scheduledWork='cancelled-and-merged';}
    const rect=(drawing||_inStroke)?_consumeDirtyRect():null;
    if(perf)perf.point('first-dab-immediate-recomposite',{mode:firstDabExperiment?firstDabExperiment.mode:experiment.mode,rect,scheduledWork});
    const immediateStart=performance.now();_flushLiveColorEraserPreview();recomposite(curLayer,curFrame,rect);const immediateDuration=performance.now()-immediateStart;
    _flushDeferredKeyVisualRefreshAfterPresentation();
    if(perf)perf.recordDuration('synchronous-first-dab-recomposite',immediateDuration,{rect,scheduledWork});
    if(firstDabExperiment)firstDabExperiment.notePresentation({kind:'synchronous-first-dab',rect,duration:immediateDuration,scheduledWork});return;
  }
  if(_recompRAF){_recompCoalescedRequests++;if(firstDabExperiment&&firstDab)firstDabExperiment.noteScheduledDisposition('reused');if(experiment)experiment.noteCoalescedRequest();return;}
  _recompRAF=true;_recompCoalescedRequests=0;
  const generation=_recompGeneration,layerIndex=curLayer,frameIndex=curFrame,sessionId=_activeStrokeSession;
  _traceStrokeLifecycle('recomposite-scheduled',{sessionId,sourceLayer:layerIndex,sourceFrame:frameIndex});
  const scheduleProfiler=_brushPerf(),scheduledAt=performance.now(),phase=scheduledAt%16.67,estimatedNextDeadlineMs=16.67-phase;
  if(firstDab&&window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.rafScheduled(scheduledAt);
  if(scheduleProfiler)scheduleProfiler.point('recomposite-raf-scheduled',{firstDab,rafAlreadyPending:false,visibility:document.visibilityState,focused:document.hasFocus(),framePhaseMs:phase,estimatedNextDeadlineMs,intentionallyDeferred:!!firstDab});
  const rafState=experiment?experiment.rafState():null;
  _recompRAFHandle=requestAnimationFrame(()=>{
    const callbackAt=performance.now(),wait=callbackAt-scheduledAt,coalesced=_recompCoalescedRequests;
    if(firstDab&&window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.rafCallback(callbackAt);
    if(scheduleProfiler){scheduleProfiler.point('recomposite-raf-callback-begin',{waitMs:wait,coalescedRequests:coalesced,framePhaseMs:callbackAt%16.67,estimatedMissedUpcomingDeadline:wait>estimatedNextDeadlineMs+1,anotherAppRafCallbackRanFirst:experiment?experiment.anotherRafRanFirst(rafState):null});scheduleProfiler.measure('raf-wakeup-wait',scheduledAt,{coalescedRequests:coalesced});}
    if(experiment)experiment.noteRafCallback({scheduledAt,callbackAt,waitMs:wait,coalescedRequests:coalesced,estimatedNextDeadlineMs,estimatedMissedUpcomingDeadline:wait>estimatedNextDeadlineMs+1,anotherAppRafCallbackRanFirst:experiment.anotherRafRanFirst(rafState)});
    if(generation!==_recompGeneration){_traceStrokeLifecycle('recomposite-rejected',{sessionId,reason:'generation',sourceLayer:layerIndex,sourceFrame:frameIndex});_flushDeferredKeyVisualRefreshAfterPresentation();return;}
    if(sessionId!==_activeStrokeSession){_traceStrokeLifecycle('recomposite-rejected',{sessionId,reason:'obsolete-session',sourceLayer:layerIndex,sourceFrame:frameIndex});_flushDeferredKeyVisualRefreshAfterPresentation();return;}
    _recompRAF=false;_recompRAFHandle=0;_recompCoalescedRequests=0;
    if(curLayer!==layerIndex||curFrame!==frameIndex){_traceStrokeLifecycle('recomposite-rejected',{sessionId,reason:'artwork-changed',sourceLayer:layerIndex,sourceFrame:frameIndex});_flushDeferredKeyVisualRefreshAfterPresentation();return;}
    const rect=(drawing||_inStroke)?_consumeDirtyRect():null;
    const scheduledStart=performance.now();_flushLiveColorEraserPreview();recomposite(layerIndex,frameIndex,rect);const scheduledDuration=performance.now()-scheduledStart;
    _flushDeferredKeyVisualRefreshAfterPresentation();
    if(scheduleProfiler)scheduleProfiler.recordDuration('scheduled-recomposite-duration',scheduledDuration,{rect,firstDab});
    if(firstDabExperiment&&firstDab)firstDabExperiment.notePresentation({kind:'scheduled-first-dab',rect,duration:scheduledDuration,scheduledWork:'used'});
  });
}
function _completePostStrokePresentation(layerIndex,frameIndex){
  _traceStrokeLifecycle('pointerup-barrier',{sourceLayer:layerIndex,sourceFrame:frameIndex});
  // Pointerup is the authoritative barrier: invalidate every preview frame
  // queued while the stroke was moving, then present the committed source
  // synchronously before pointerup returns.
  _recompGeneration++;if(_recompRAFHandle)cancelAnimationFrame(_recompRAFHandle);_recompRAFHandle=0;_recompRAF=false;
  _flushLiveColorEraserPreview();
  if(_strokeCtx&&_strokeCanvas)_strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
  if(_strokePreviewCtx&&_strokePreviewCanvas)_strokePreviewCtx.clearRect(0,0,_strokePreviewCanvas.width,_strokePreviewCanvas.height);
  if(_srPreviewTintCtx&&_srPreviewTintCanvas)_srPreviewTintCtx.clearRect(0,0,_srPreviewTintCanvas.width,_srPreviewTintCanvas.height);
  _frameDirty=null;_strokeDirty=null;
  if(layerIndex>=0&&frameIndex>=0&&curLayer===layerIndex&&curFrame===frameIndex)recomposite(layerIndex,frameIndex);
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
function _restoreSelectionScopePixels(){
  if(_selectionScopeBase&&window.SelectionScope)SelectionScope.restoreProtectedPixels(ctx,_selectionScopeBase);
  _selectionScopeBase=null;
}
function _isStyleLayeringColorErase(){
  return tool==='eraser'&&window.eraserMode==='color'&&layers[curLayer]&&layers[curLayer].renderMode==='style-layering';
}
function _endStroke(pointerId){
  // Cancellation paths stop live stabilization, but lost pointer capture
  // must not interrupt the short endpoint convergence started by pointerup.
  if(_stabilizerActive&&!_stabilizerFinishing)_stabilizerCancel();
  if(_strokeCompletionStarted) return;
  if(pointerId!=null&&_activeStrokePointerId!=null&&pointerId!==_activeStrokePointerId) return;
  _strokeCompletionStarted=true;
  _baselineConditionerFinish(true);
  _stopAirbrushSpray();
  BrushRenderer.setLineContinuity(null);
  if(drawing){drawing=false;_flushStrokeTail();if(_inStroke){_inStroke=false;_commitStrokeCanvas();}_restoreSelectionScopePixels();_cleanupErasedSmartOwnership();saveActiveToKey();}
  if(lineStart&&(_lineDragging||_curveToolGesture)){
    // Line drag aborted mid-gesture (pointercancel, tab blur, etc.) -- undo
    // was never pushed and the layer was never touched, so just discard the
    // uncommitted scratch preview rather than committing a partial line.
    _cancelLinePreview();
    if(_inStroke){_inStroke=false;_clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);}
    _clearLinePreviewCanvas(_texturedStrokeCanvas,_texturedStrokeCtx);
    _clearLinePreviewCanvas(_strokePreviewCanvas,_strokePreviewCtx);
  }
  _endColorEraserStroke();_completePostStrokePresentation(_strokeOwnerLayer,_strokeOwnerFrame);
  lineStart=null;
  _lineDragging=false;
  _linePreviewBounds=null;_linePreviewPreviousEndpoint=null;
  _linePressureSamples=[];
  _lineGesture=null;
  _curveToolGesture=null;_clearCurveGuide();
  _pendingDabs.length=0;
  _curveP0=null;_curveP1=null;
  _strokeSegCarryOver=0;
  _activeStrokePointerId=null;
  _strokeOwnerLayer=-1;_strokeOwnerFrame=-1;
}
window.finishActiveDrawingBeforeArtworkChange=function(nextLayer,nextFrame){
  // Pointer-up stabilization catch-up still owns an uncommitted stroke even
  // though `drawing` is already false. Resolve that session synchronously so
  // a following clear/switch cannot be followed by a delayed old commit.
  if(_stabilizerFinishing&&_stabilizerFinalizeCB){
    _traceStrokeLifecycle('artwork-change-finishes-stabilizer',{destinationLayer:nextLayer,destinationFrame:nextFrame});
    _stabilizerAccelerateToCompletion();
  }
  const active=drawing||_inStroke||lineStart||_colorEraserOwnership;
  if(!active){
    _recompGeneration++;if(_recompRAFHandle)cancelAnimationFrame(_recompRAFHandle);_recompRAFHandle=0;_recompRAF=false;_frameDirty=null;_strokeDirty=null;
    if(_strokePreviewCtx&&_strokePreviewCanvas)_strokePreviewCtx.clearRect(0,0,_strokePreviewCanvas.width,_strokePreviewCanvas.height);
    return false;
  }
  const destinationLayer=nextLayer,destinationFrame=nextFrame;
  _endingForArtworkChange=true;
  try{
    if(_strokeOwnerLayer>=0)curLayer=_strokeOwnerLayer;
    if(_strokeOwnerFrame>=0)curFrame=_strokeOwnerFrame;
    _endStroke(_activeStrokePointerId);
  }finally{
    _endingForArtworkChange=false;
    _recompGeneration++;if(_recompRAFHandle)cancelAnimationFrame(_recompRAFHandle);_recompRAFHandle=0;_recompRAF=false;_frameDirty=null;_strokeDirty=null;
    curLayer=destinationLayer;curFrame=destinationFrame;
  }
  return true;
};
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
// Contact-pressure floor: some pen/tablet stacks emit trailing pointermove
// samples with pressure decaying toward 0 as the tip physically leaves the
// surface, arriving BEFORE pointerup fires. Left unfiltered, one of these
// release-artifact samples becomes _stabilizerTargetPressure/currentPressure
// right as the stroke ends, so the entire finish glide paints at near-zero
// width — a hairline reaching the anchor instead of a natural taper. This
// mirrors prototype/prototype.html's lastContactPressure/CONTACT_PRESSURE_FLOOR
// guard: a sample is treated as a release artifact (and the last genuine
// contact pressure is reused instead) only when it's low, dropped sharply
// from the last real contact pressure, AND barely moved — genuine light
// strokes that actually move don't get held back.
const _CONTACT_PRESSURE_FLOOR=0.02;
const _RELEASE_TAIL_PRESSURE_MAX=0.20;
const _RELEASE_TAIL_DROP_RATIO=0.75;
const _RELEASE_TAIL_MAX_SCREEN_PX=1.25;
let _lastContactPressure=0;
function _contactFilteredPressure(pressure,x,y,pointerType){
  const distScreenPx=Math.hypot(x-lx,y-ly)*Math.max(0.05,zoom);
  const isReleaseArtifact=pointerType==='pen'&&
    _lastContactPressure>_CONTACT_PRESSURE_FLOOR&&
    Number.isFinite(pressure)&&
    pressure<=_RELEASE_TAIL_PRESSURE_MAX&&
    pressure<=_lastContactPressure*_RELEASE_TAIL_DROP_RATIO&&
    distScreenPx<=_RELEASE_TAIL_MAX_SCREEN_PX;
  if(isReleaseArtifact)return _lastContactPressure;
  if(Number.isFinite(pressure)&&pressure>_CONTACT_PRESSURE_FLOOR)_lastContactPressure=pressure;
  return pressure;
}
let _lastMoveTime = 0;
let _lastMoveX = 0, _lastMoveY = 0;
function _updateVelocity(x, y, t){
  if(_lastMoveTime > 0){
    const dt = Math.max(1, t - _lastMoveTime);
    const dx = x - _lastMoveX, dy = y - _lastMoveY;
    // x/y are canvas-space (post /zoom), so raw canvas-space speed scales
    // with 1/zoom for the same physical motion. _strokeVelocity feeds the
    // "velocity" spacing mode (_effectiveSpacingFrac), and spacing must be
    // zoom-independent (see PART 2), so convert back to screen/physical
    // speed here rather than letting zoom alone change perceived velocity.
    const spd = (Math.sqrt(dx*dx+dy*dy) * zoom) / dt;
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
    if(_pressureInfluence===null){
      _pressureInfluence = _resolveControl('pressure', e);
      if(window.DEBUG_LINE_TOOL&&tool==='line')_lineEffectivePressureSamples.push({t:_lineDiagnosticCurrentT,rawPressure:currentPressure,effectivePressure:_pressureInfluence});
    }
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
  // Do not raise low-Flow coverage: spacing compensation may legitimately
  // produce sub-1% dabs. Raising those to 1% causes periodic over-deposition.
  const minimumAlpha=(window._brushAirbrush&&!window.brushTipCanvas)?0:0.01;
  return{r:Math.max(0.05,r), alpha:Math.max(minimumAlpha,Math.min(1,alpha))};
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
  BrushRenderer.invalidateCaches({tip:true,stamp:true});
};
// Many exported tip images (including the morrowshore.com ABR-extractor's
// PNGs) are plain OPAQUE grayscale pictures Ã¢â‚¬â€ a white shape on a black
// background Ã¢â‚¬â€ with NO real transparency at all (every pixel's alpha is
// 255). The GPU stamp path (_buildTipStamp) masks purely off the ALPHA
// channel via destination-in, so a flat-alpha image like that produces no
// masking whatsoever: every dab came out as a solid filled rectangle (the
// tip's bounding box), not the tip's actual silhouette.
// Fix: whenever a newly-set tip canvas has essentially no alpha variation,
// synthesize real alpha from luminance instead Ã¢â‚¬â€ white pixels (the painted
// shape) become opaque, black pixels (background) become transparent. This
// matches the same "white = paint" convention _buildAAStamp's CPU path
// already assumes for the luminance factor, so both renderers agree, and a
// brush tip painted the intuitive way (light shape on dark background)
// stops rendering as an inverted blob / solid box.
let _lastNormalizedTipPixels=null;
function _normalizeTipAlpha(canvas){
  if(!canvas || !canvas.width || !canvas.height) return canvas;
  const w=canvas.width, h=canvas.height;
  const normalizeStart=performance.now(),c2d=canvas.getContext('2d',{willReadFrequently:true}),readStart=performance.now();
  let id;
  try{ id=c2d.getImageData(0,0,w,h);if(window.TipReadbackExperiment)window.TipReadbackExperiment.record('tip-normalization-read',{width:w,height:h,duration:performance.now()-readStart,totalDuration:performance.now()-normalizeStart}); }catch(e){ return canvas; } // tainted canvas (cross-origin) Ã¢â‚¬â€ leave as-is
  const d=id.data;
  let minA=255,maxA=0;
  for(let i=3;i<d.length;i+=4){ const a=d[i]; if(a<minA)minA=a; if(a>maxA)maxA=a; }
  // Real transparency already present (e.g. a proper alpha-masked tip, or
  // this function already having run on it) Ã¢â‚¬â€ leave it untouched.
  if(maxA-minA>4){_lastNormalizedTipPixels={data:new Uint8ClampedArray(d),w,h};return canvas;}
  for(let i=0;i<d.length;i+=4){
    const lum=(d[i]+d[i+1]+d[i+2])/3;
    d[i]=d[i+1]=d[i+2]=255; // colour is irrelevant to the mask, keep it neutral
    d[i+3]=Math.round(lum);  // white shape -> opaque, black background -> transparent
  }
  c2d.putImageData(id,0,0);
  _lastNormalizedTipPixels={data:new Uint8ClampedArray(d),w,h};
  return canvas;
}
window.setBrushTip=function(canvas,referenceDiameter,invalidationReason){
  const trace=window.CustomTipCacheTrace,previousCanvas=window.brushTipCanvas,previousVersion=window.brushTipVersion||0,previousAlphaBuffer=BrushRenderer.getTipAlphaBuffer();
  _lastNormalizedTipPixels=null;window.brushTipCanvas=canvas?_normalizeTipAlpha(canvas):null;
  window.brushTipSpacingBasis=canvas?'image-width':'diameter';
  window.brushTipReferenceDiameter=canvas&&Number.isFinite(Number(referenceDiameter))&&Number(referenceDiameter)>0?Number(referenceDiameter):null;
  window.brushTipVersion=(window.brushTipVersion||0)+1;
  BrushRenderer.setTipAlphaSeedPixels(window.TipReadbackExperiment&&window.TipReadbackExperiment.mode==='D'&&_lastNormalizedTipPixels?{data:_lastNormalizedTipPixels.data,w:_lastNormalizedTipPixels.w,h:_lastNormalizedTipPixels.h,version:window.brushTipVersion}:null);
  BrushRenderer.invalidateCaches({tip:true,aa:true,stamp:true});
  BrushRenderer.setTipAlphaInvalidationReason(invalidationReason||'setBrushTip-call');
  if(trace)trace.invalidated({reason:BrushRenderer.getTipAlphaInvalidationReason(),previousVersion,tipVersion:window.brushTipVersion,previousTipCanvasId:trace.objectId(previousCanvas,'tip-canvas'),tipCanvasId:trace.objectId(window.brushTipCanvas,'tip-canvas'),sameCanvas:previousCanvas===window.brushTipCanvas,alphaBufferId:trace.objectId(previousAlphaBuffer,'alpha-buffer'),stack:(new Error()).stack});
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.tipChanged();
};
window.clearBrushTip=function(){
  window.setBrushTip(null,null,'clearBrushTip');
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

let _eyedropperPointerId=null;
function _sampleVisibleCanvasColor(e){
  const p=getPos(e),x=Math.floor(p.x),y=Math.floor(p.y);
  if(x<0||y<0||x>=CW||y>=CH)return;
  const pixel=compCtx.getImageData(x,y,1,1).data;
  const hex='#'+[pixel[0],pixel[1],pixel[2]].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(typeof colorTarget!=='undefined')colorTarget='fg';
  const palette=window.PaletteDocker;
  if(palette&&typeof palette.setForegroundFromSample==='function')palette.setForegroundFromSample(hex);
  else if(typeof _applyColorLive==='function')_applyColorLive(hex);
  else{color=hex;const input=document.getElementById('color-input');if(input){input.value=hex;input.dispatchEvent(new Event('input',{bubbles:true}));}}
  let selectedOwnedStyle=false;
  const layer=layers[curLayer];
  const layerVisible=layer&&layer.visible!==false&&(typeof _layerGroupChainVisible!=='function'||_layerGroupChainVisible(layer));
  if(layerVisible&&layer.type==='smart-raster'&&window.SmartRasterLayer&&typeof window.SmartRasterLayer.getStyleIdAt==='function'&&palette&&typeof palette.selectAdvancedStyleById==='function'){
    const styleId=window.SmartRasterLayer.getStyleIdAt(curLayer,curFrame,x,y);
    if(styleId)selectedOwnedStyle=palette.selectAdvancedStyleById(styleId);
  }
  if(!selectedOwnedStyle&&palette&&typeof palette.selectMatchingRgba==='function')palette.selectMatchingRgba(pixel[0],pixel[1],pixel[2],pixel[3]);
}


// Stroke initiation outside canvas bounds
// -----------------------------------------------------------------------
// Historically this pointerdown handler was ONLY bound to activeC, so a
// press that landed outside the canvas element (but still inside the
// pannable canvas-area viewport, e.g. in the zoomed-out margin around a
// small canvas) never reached this code at all: no stroke session was
// created, and dragging in from outside began painting from wherever the
// pointer happened to be the moment it crossed the canvas edge, with no
// warm stabilizer/pressure/velocity state and a hard "snap-in" look.
//
// Fix: keep this exact handler (unchanged) bound to activeC for the
// normal in-canvas case, but ALSO invoke it Ã¢â‚¬â€ via _brushPointerDownOutside
// below Ã¢â‚¬â€ when the press lands on canvas-area outside activeC itself. The
// handler doesn't need to know which path it came from: getPos() maps
// through canvas-area's rect using plain client coordinates with no
// clamping, so it already produces correct (possibly negative / >CW,CH)
// canvas-space coordinates for an outside point. activeC.setPointerCapture
// is likewise valid to call even though the pointerdown event's target
// wasn't activeC Ã¢â‚¬â€ capture only requires an active pointer, not that the
// captor be the original target Ã¢â‚¬â€ and once captured, every subsequent
// pointermove/up/cancel event is redirected to activeC's own listeners
// automatically, so no other code needs to change.
//
// The very first dab this handler stamps (see _stampDab call below) may
// land outside [0,CW)x[0,CH) when the stroke starts off-canvas. That's
// safe by construction: _strokeCanvas is allocated at exactly CW x CH, and
// a canvas 2D context can never rasterize past its own backing store, so
// an out-of-bounds stamp is a guaranteed no-op rather than a visible mark
// or an out-of-canvas raster write. As the pointer moves and eventually
// crosses into the canvas, dab-walking naturally starts producing visible
// pixels exactly where the stroke path enters the canvas Ã¢â‚¬â€ no special
// "entry" case needed, no gap, no restart.
function _brushPointerDown(e){
  const diagnosticPointerdownEntry=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const customTraceEntry=window.CustomFirstDabTrace&&window.CustomFirstDabTrace.enabled?performance.now():0;
  // e.button can be -1 on some tablet drivers for pen primary contact; use e.buttons&1 instead
  if(activeGroupId||panning||(typeof _zoomDrag!=='undefined'&&_zoomDrag)||spaceHeld||tool==='transform') return;
  if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
  if(tool==='eyedropper'){
    e.preventDefault();_eyedropperPointerId=e.pointerId;activeC.setPointerCapture(e.pointerId);_sampleVisibleCanvasColor(e);return;
  }
  if(tool!=='brush'&&tool!=='eraser'&&tool!=='fill'&&tool!=='line'&&tool!=='curve') return;
  if(typeof isDrawingFrameHidden==='function'&&isDrawingFrameHidden(curLayer,curFrame)) return;
  if(typeof isLayerLocked==='function'&&isLayerLocked(curLayer)) return;
  // Prevent browser from hijacking tablet/stylus events (scroll, pan, zoom)
  e.preventDefault();
  // A new stroke must not reset shared scratch/dirty/pressure state while the
  // prior stroke still owns a stabilization finalizer or an active session.
  // Resolve the old session before any new-stroke initialization below.
  if(_stabilizerFinishing&&_stabilizerFinalizeCB){
    _traceStrokeLifecycle('next-pointerdown-finishes-previous',{nextPointerId:e.pointerId});
    _stabilizerAccelerateToCompletion();
  }
  if(drawing||_inStroke||lineStart||_colorEraserOwnership){
    _traceStrokeLifecycle('next-pointerdown-ends-previous',{nextPointerId:e.pointerId});
    _endStroke(_activeStrokePointerId);
  }
  if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending'){_curveCommitPointerId=e.pointerId;_commitCurveTool(e);return;}
  if((tool==='brush'||tool==='eraser')&&window.FirstDabLatencyProbe){window.FirstDabLatencyProbe.begin({layerType:layers[curLayer]&&layers[curLayer].type,pointerdownAt:diagnosticPointerdownEntry});window.FirstDabLatencyProbe.setupMeasure('eventValidationAndPreventDefault',diagnosticPointerdownEntry);}
  let diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  if(window.CompositionPrewarm)window.CompositionPrewarm.beforeStroke();
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pendingPrewarmCancellation',diagnosticSetupStart);
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const latencyProfiler=_brushPerf();
  if(latencyProfiler)latencyProfiler.startStroke({tool,pointerType:e.pointerType,presetId:window._activeBrushPresetId||null,size:getBrushSize(),flow:brushFlow,opacity:brushOpacity,hardness:brushHardness,tip:!!window.brushTipCanvas,texture:!!window.brushTextureEnabled,airbrush:!!window._brushAirbrush,layerType:layers[curLayer]&&layers[curLayer].type,caches:BrushRenderer.getCacheStats(),buffers:{stroke:!!_strokeCanvas,preview:!!_strokePreviewCanvas}});
  if(window.TipReadbackExperiment)window.TipReadbackExperiment.strokeStart();
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.beginStroke({entryAt:customTraceEntry,tip:!!window.brushTipCanvas,presetId:window._activeBrushPresetId||null,settings:{size:getBrushSize(),spacing:window.brushSpacing,hardness:brushHardness,opacity:brushOpacity,flow:brushFlow,pressureSize:window._brushPressureSize,pressureOpacity:window._brushPressureOpacity,zoom:typeof zoom==='number'?zoom:null}});
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('stroke-state-initialization-begins');
  if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.strokeStart();
  if(latencyProfiler){latencyProfiler.point('pointerdown-received',{visibility:document.visibilityState,focused:document.hasFocus(),framePhaseMs:performance.now()%16.67});latencyProfiler.point('stroke-initialization-begins');}
  if(window.BrushRafExperiment)window.BrushRafExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if(window.BrushFirstDabExperiment)window.BrushFirstDabExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if(window.KeyframeLatencyExperiment)window.KeyframeLatencyExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('latencyHooksInitialization',diagnosticSetupStart);
  const inputStateStart=latencyProfiler?performance.now():0;
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  _isDrawingWithPen = (e.pointerType === 'pen');
  _strokeFirstSample = true; // this stroke's first _getPressure() call snaps immediately, no de-jitter clamping
  currentPressure=_getPressure(e);
  _smoothedPressure = currentPressure; // snap smoothing to actual pressure at stroke start (no ramp-in lag)
  _lastKnownPressure = currentPressure;
  _strokeDabCount = 0; // reset fade counter
  _strokeDistSoFar = 0; // reset start-of-stroke taper
  _pendingDabs.length = 0; // discard any unflushed tail from a previous stroke
  _frameDirty = null; // discard any stale accumulation from a previous/aborted stroke
  _strokeDirty = null; // begin affected-pixel tracking for this complete stroke
  _strokeVelocity = 0; // reset velocity
  _lastContactPressure = 0; // reset release-artifact contact-pressure guard
  _lastMoveTime = 0;
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pressureAndStateInitialization',diagnosticSetupStart);
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('pressure-input-initialization-complete',{pressure:currentPressure,pointerType:e.pointerType});
  _strokeSegCarryOver = 0; // reset inter-segment dab carry-over
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const p=getPos(e);
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('coordinateMappingAndTransforms',diagnosticSetupStart);
  if(window.CustomFirstDabTrace){window.CustomFirstDabTrace.sample({source:'pointerdown',eventTime:e.timeStamp,x:p.x,y:p.y,pressure:currentPressure});window.CustomFirstDabTrace.event('first-pointer-sample-processed',{x:p.x,y:p.y});}
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  _rotationPrevValid=false;
  _resetStabilization(p.x,p.y,e.timeStamp||performance.now());
  _updateVelocity(p.x, p.y, e.timeStamp);
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pressureAndStateInitialization',diagnosticSetupStart);
  if(latencyProfiler)latencyProfiler.measure('pointer-and-dynamics-init',inputStateStart);
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  if(tool==='fill'){pushUndo();ensureKey();floodFill(p.x,p.y,color);saveActiveToKey();recomposite(curLayer,curFrame);return;}
  _activeStrokePointerId=e.pointerId;
  _strokeOwnerLayer=curLayer;_strokeOwnerFrame=curFrame;_activeStrokeSession=++_strokeSessionSerial;
  _traceStrokeLifecycle('stroke-start',{sourceLayer:curLayer,sourceFrame:curFrame});
  _strokeCompletionStarted=false;
  if(tool==='line'||tool==='curve'){
    lineStart=p;
    _lineDragging=true;
    const fixedLinePressure=getLinePressureMode()==='fixed';
    const storedLinePressure=fixedLinePressure?1:currentPressure;
    _linePressureSamples=[{x:p.x,y:p.y,pressure:storedLinePressure}];
    _lineGesture={phase:'editing',startPoint:{x:p.x,y:p.y},endPoint:{x:p.x,y:p.y},currentLength:0,recordedLength:0,pressureSamples:[{distance:0,pressure:storedLinePressure}],currentEventPressure:Number(e.pressure),lastEditDiagnostic:null};
    if(tool==='curve')_curveToolGesture={phase:'endpoints',start:{x:p.x,y:p.y},end:{x:p.x,y:p.y},control:{x:p.x,y:p.y}};
    _linePreviewBounds=null;_linePreviewPreviousEndpoint=null;_linePreviewFrameId=0;_linePreviewMoveSequence=0;_linePreviewGeneration++;
    activeC.setPointerCapture(e.pointerId);
    _ensureStrokeCanvas();
    _inStroke=true;
    _renderLineDrag(p.x,p.y,e,'preview');
    _scheduleRecomposite({firstDab:true});
    return;
  }
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pressureAndStateInitialization',diagnosticSetupStart);
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  activeC.setPointerCapture(e.pointerId);
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('setPointerCapture',diagnosticSetupStart);
const strokeSetupStart=latencyProfiler?performance.now():0;
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  let stageStart=latencyProfiler?performance.now():0;pushUndo();
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pushUndo',diagnosticSetupStart,{pushUndoSnapshotMethod:layers[curLayer]&&layers[curLayer].type==='smart-raster'?'style-bundle-copy':'canvas-drawImage'});
  if(latencyProfiler)latencyProfiler.point('push-undo-complete');
  if(latencyProfiler)latencyProfiler.measure('undo-snapshot-setup',stageStart,{canvas:{width:CW,height:CH},snapshotMethod:layers[curLayer]&&layers[curLayer].type==='smart-raster'?'style-bundle-copy':'canvas-drawImage',getImageData:false,layerIndex:curLayer,frameIndex:curFrame});
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  stageStart=latencyProfiler?performance.now():0;const autoCreatedKey=ensureKey({deferVisualRefresh:true});
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.finishEnsureKey(diagnosticSetupStart,autoCreatedKey);
  if(latencyProfiler&&layers[curLayer]&&layers[curLayer].type==='smart-raster')latencyProfiler.measure('smart-raster-ensure-key',stageStart,{autoCreatedKey:!!autoCreatedKey,layerIndex:curLayer,frameIndex:curFrame});
  if(window.BrushRafExperiment)window.BrushRafExperiment.noteKeyCheck({autoCreatedKey:!!autoCreatedKey,duration:performance.now()-stageStart});
  if(window.KeyframeLatencyExperiment)window.KeyframeLatencyExperiment.noteKeyCheck({autoCreatedKey:!!autoCreatedKey,duration:performance.now()-stageStart});
  if(latencyProfiler)latencyProfiler.measure('keyframe-and-session-binding',stageStart,{autoCreatedKey:!!autoCreatedKey,layerIndex:curLayer,frameIndex:curFrame});
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  stageStart=latencyProfiler?performance.now():0;_beginColorEraserStroke();
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('eraserSetup',diagnosticSetupStart);
  if(latencyProfiler)latencyProfiler.measure('color-eraser-session-setup',stageStart,{active:tool==='eraser'&&window.eraserMode==='color',getImageData:tool==='eraser'&&window.eraserMode==='color'});
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  stageStart=latencyProfiler?performance.now():0;_beginEndTaperCapture();
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('taperSetup',diagnosticSetupStart);
  if(latencyProfiler)latencyProfiler.measure('taper-buffer-preparation',stageStart,{active:!!_strokeReplayBase,canvas:{width:CW,height:CH}});
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  stageStart=latencyProfiler?performance.now():0;_selectionScopeBase=tool==='eraser'&&window.SelectionScope?SelectionScope.captureArtwork(activeC):null;
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('selectionSetup',diagnosticSetupStart);
  if(latencyProfiler)latencyProfiler.measure('selection-scope-setup',stageStart,{active:!!window.SelectionScope,captured:!!_selectionScopeBase,getImageData:!!_selectionScopeBase});
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  drawing=true;lx=p.x;ly=p.y;
  _baselineConditionerReset(_baselineSampleFromEvent(e,p,currentPressure));
  BrushRenderer.setLineContinuity(null);
  _resetCurve(p.x,p.y,currentPressure);
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('spacing-path-initialization-complete',{carryOver:_strokeSegCarryOver});
  _lastPointerEvent=e;
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('pressureAndStateInitialization',diagnosticSetupStart);
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  stageStart=latencyProfiler?performance.now():0;
  if(tool!=='eraser'){_ensureStrokeCanvas();_inStroke=true;}
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('ensureStrokeCanvas',diagnosticSetupStart);
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('stroke-state-initialization-complete',{strokeCanvas:!!_strokeCanvas,inStroke:_inStroke});
  if(latencyProfiler){latencyProfiler.measure('stroke-live-buffer-activation',stageStart,{active:tool!=='eraser',canvas:{width:_strokeCanvas&&_strokeCanvas.width||0,height:_strokeCanvas&&_strokeCanvas.height||0}});latencyProfiler.measure('pointerdown-setup-total',strokeSetupStart,{tool});}
  // Pointer-down uses the same spacing-derived transmittance ratio as every
  // arc-walked movement dab, so Flow is identical for isolated stamps.
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const previousSpacingRatio=_flowSpacingRatio;
  _flowSpacingRatio=_initialDabSpacingRatio(e,currentPressure);
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('spacingAndFlowInitialization',diagnosticSetupStart);
  if(window.CustomFirstDabTrace){window.CustomFirstDabTrace.event('first-dab-eligibility',{eligible:true,reason:'unconditional-pointerdown-dab',distanceThreshold:0,flowSpacingRatio:_flowSpacingRatio});window.CustomFirstDabTrace.firstDabDispatch({source:'pointerdown',x:p.x,y:p.y});}
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.finalizeSetup(performance.now());
  const diagnosticDabStart=window.FirstDabLatencyProbe?window.FirstDabLatencyProbe.firstDabStart():0;
  const firstDabStart=latencyProfiler?performance.now():0;if(latencyProfiler)latencyProfiler.point('first-dab-rasterization-start');
  try{_stampDab(p.x,p.y,e);}
  finally{_flowSpacingRatio=previousSpacingRatio;}
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.firstDabEnd(diagnosticDabStart);
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('first-dab-rasterization-complete');
  if(latencyProfiler){latencyProfiler.point('first-dab-rasterization-finish');latencyProfiler.measure('first-dab-pipeline-total',firstDabStart,{dirtyRect:_frameDirty?{minX:_frameDirty.minX,minY:_frameDirty.minY,maxX:_frameDirty.maxX,maxY:_frameDirty.maxY}:null,blendMode:_usesBrushPaintPipeline()?window.brushBlendMode:'eraser'});latencyProfiler.point('first-dab-generated');}
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('recomposite-scheduling-begins');
  _scheduleRecomposite({firstDab:true});
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('recomposite-scheduled');
  if(window._brushAirbrush&&window._brushContinuousSpraying) _startAirbrushSpray();
}
activeC.addEventListener('pointerdown',_brushPointerDown);
// Lightweight outside-canvas entry point. Only brush/eraser strokes are
// eligible to start off-canvas (fill/line/curve/eyedropper keep their
// existing on-canvas-only behavior Ã¢â‚¬â€ nothing about them regresses since
// this listener simply never calls through for those tools). Interactive
// controls that happen to live inside canvas-area (resize-canvas fields,
// the camera-view activation button, etc.) are excluded so this never
// hijacks a normal UI click; anything else in the viewport Ã¢â‚¬â€ empty
// panning margin, the guide/transform overlay canvases, canvas-area
// itself Ã¢â‚¬â€ is treated as "outside the canvas" and handed to the exact
// same stroke-start logic used for an on-canvas press.
canvasArea.addEventListener('pointerdown',e=>{
  if(e.target===activeC) return; // already handled by the listener above
  if(tool!=='brush'&&tool!=='eraser') return;
  if(e.target.closest&&e.target.closest('button,input,select,textarea,[contenteditable],.tf-floating-action,#resize-canvas-settings,#camera-view-preview')) return;
  _brushPointerDown(e);
});
// Line tool preview scheduler ------------------------------------------
// pointerrawupdate deliberately fires at full tablet/OS sampling rate (up
// to ~1000Hz) so no pressure sample is ever lost -- see the note on
// _handleMoveEvent below. Sample RECORDING must stay at that rate. But
// _renderLineDrag() fully replays and re-rasterizes the WHOLE line from
// scratch every time it's called, so calling it synchronously once per raw
// input event made rendering cost scale with input frequency (and with
// current line length) instead of with display refresh rate: once
// per-event render time exceeded the gap between events, pointer events
// queued up behind a still-running render and the preview visibly trailed
// the cursor.
// Fix: decouple recording from rendering. Every pointerrawupdate still
// pushes a sample into _linePressureSamples (unchanged, full rate, no
// pressure data lost) and stores the latest endpoint, but only marks the
// preview dirty and schedules (at most) one requestAnimationFrame. If more
// samples/endpoints arrive before that frame fires, they keep updating the
// stored "latest endpoint" and pressure samples, but no extra render or
// extra RAF is queued -- the callback always renders exactly once, using
// whatever the newest endpoint is by the time it actually runs. This caps
// rendering at the display's own frame rate regardless of input frequency,
// while every sample in between still lands in _linePressureSamples and
// therefore still shapes the pressure profile / final commit exactly as
// before.
//
// This intentionally does NOT reuse _scheduleRecomposite()'s RAF machinery.
// That scheduler coalesces the CANVAS COMPOSITE step (flattening layers to
// the screen) and carries first-dab-latency experiment/telemetry logic
// that's specific to that job. Bolting line-preview rendering onto it would
// conflate two different pieces of work with different coalescing
// semantics (and different "what counts as stale" rules) for no shared
// benefit -- _renderLineDrag must run BEFORE _scheduleRecomposite() can do
// anything useful anyway (there'd be nothing new to composite otherwise).
// A small dedicated scheduler keeps that ordering explicit and keeps this
// concern isolated from the compositing pipeline.
let _linePreviewRAFPending=false,_linePreviewRAFHandle=0;
let _linePreviewLatestX=0,_linePreviewLatestY=0,_linePreviewLatestEvent=null;
// Preview rendering is frame-coalesced, but every rendered frame uses the
// same full brush replay as pointerup. The replay targets _strokeCanvas only;
// it does not touch the active layer or undo history.
function _scheduleLinePreview(x,y,e){
  _linePreviewLatestX=x;_linePreviewLatestY=y;_linePreviewLatestEvent=e;
  _linePreviewMoveSequence++;_linePreviewGeneration++;
  if(_linePreviewRAFPending) return;
  _linePreviewRAFPending=true;
  _linePreviewRAFHandle=requestAnimationFrame(()=>{
    _linePreviewRAFPending=false;_linePreviewRAFHandle=0;
    if(!lineStart||(!_lineDragging&&!(_curveToolGesture&&_curveToolGesture.phase==='bending'))) return;
    _renderLineDrag(_linePreviewLatestX,_linePreviewLatestY,_linePreviewLatestEvent,'preview');
    _scheduleRecomposite();
  });
}
function _cancelLinePreview(){
  const discarded=_linePreviewRAFPending;
  if(_linePreviewRAFHandle){cancelAnimationFrame(_linePreviewRAFHandle);_linePreviewRAFHandle=0;}
  _linePreviewRAFPending=false;_linePreviewGeneration++;
  if(discarded&&window.DEBUG_LINE_PREVIEW)console.debug('[LinePreview]',{generation:_linePreviewGeneration,pointermoveSequence:_linePreviewMoveSequence,stalePreviewDiscarded:true});
}

function _resetCurveToolGesture(){
  _cancelLinePreview();_clearCurveGuide();
  if(_inStroke){_inStroke=false;_clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);}
  _clearLinePreviewCanvas(_texturedStrokeCanvas,_texturedStrokeCtx);_clearLinePreviewCanvas(_strokePreviewCanvas,_strokePreviewCtx);
  lineStart=null;_lineDragging=false;_linePressureSamples=[];_lineGesture=null;_curveToolGesture=null;_curveCommitPointerId=null;_pendingDabs.length=0;_activeStrokePointerId=null;_strokeCompletionStarted=false;
}
function _cancelCurveTool(){if(!_curveToolGesture)return;const layer=_strokeOwnerLayer,frame=_strokeOwnerFrame;_resetCurveToolGesture();_strokeOwnerLayer=-1;_strokeOwnerFrame=-1;if(layer>=0&&frame>=0&&curLayer===layer&&curFrame===frame)recomposite(layer,frame);}
function _commitCurveTool(e){
  if(!_curveToolGesture||_curveToolGesture.phase!=='bending')return false;
  _cancelLinePreview();pushUndo();ensureKey();if(!_strokeCanvas||!_inStroke){_ensureStrokeCanvas();_inStroke=true;}
  _renderLineDrag(_curveToolGesture.control.x,_curveToolGesture.control.y,e||_lastPointerEvent||{pointerType:'mouse',pressure:.5},'commit');
  if(_inStroke){_inStroke=false;_commitStrokeCanvas();}_cleanupErasedSmartOwnership();saveActiveToKey();
  const layer=_strokeOwnerLayer,frame=_strokeOwnerFrame;_resetCurveToolGesture();_completePostStrokePresentation(layer,frame);_strokeOwnerLayer=-1;_strokeOwnerFrame=-1;return true;
}
window.cancelCurveTool=_cancelCurveTool;
// _handleMoveEvent: shared by pointermove + pointerrawupdate.
// pointerrawupdate fires at the full OS/Windows Ink sampling rate (up to 1000Hz)
// before the browser throttles events to display refresh rate Ã¢â‚¬â€ giving every
// real pressure value the tablet digitizer reports, not just the surviving ones.
function _handleMoveEvent(e){
  if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending'){
    if(activeGroupId)return;const p=getPos(e);_lastPointerEvent=e;_curveToolGesture.control={x:p.x,y:p.y};_scheduleLinePreview(p.x,p.y,e);return;
  }
  if((!drawing&&!_lineDragging)||activeGroupId||_strokeCompletionStarted) return;
  if(_activeStrokePointerId!=null&&e.pointerId!==_activeStrokePointerId) return;
  if(!(e.buttons&1)){_endStroke(e.pointerId);return;}
  e.preventDefault();
  const events=(typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
  if((tool==='line'||tool==='curve')&&_lineDragging){
    // Record every coalesced sample (position + pressure) at full input
    // rate -- this is what lets Pen Pressure preserve the whole recorded
    // curve instead of collapsing it to one value. The line itself stays
    // straight (start -> current raw pointer position); only the WIDTH
    // profile comes from the sampled path, so no smoothing/curving is
    // applied to the endpoint tracking itself. Recording happens on every
    // call regardless of rendering -- see _scheduleLinePreview above for
    // why rendering itself is decoupled from this.
    const lineEvents=events.map(ev=>({event:ev,point:getPos(ev)}));
    const latest=lineEvents[lineEvents.length-1];
    _editLinePressureProfile(lineEvents);
    const retained=_lineGesture.pressureSamples;
    currentPressure=retained.length?retained[retained.length-1].pressure:1;
    lx=latest.point.x;ly=latest.point.y;_lastPointerEvent=latest.event;
    _scheduleLinePreview(latest.point.x,latest.point.y,latest.event);
    return;
  }
  for(const ev of events){
    const newPressure = _getPressure(ev);
    const raw=getPos(ev);
    if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.sample({source:e.type,eventTime:ev.timeStamp,x:raw.x,y:raw.y,pressure:newPressure,coalescedCount:events.length});
    // Stabilization now consumes the RAW per-event sample directly -- one
    // _stabilizePoint call per real hardware/coalesced event, matching
    // prototype/prototype.html's pushSmoothBuf (which also runs on raw
    // events, before any resampling). Previously this ran on the output of
    // _baselineConditionerPush below, which resamples the raw path into
    // fixed SCREEN-DISTANCE steps (~0.5-2px apart) regardless of how fast
    // the pointer is moving. Since the stabilizer's window is a fixed
    // SAMPLE COUNT, feeding it distance-resampled points made the window
    // span a roughly constant screen distance no matter the stroke speed --
    // a fixed-length lag ("pulling a string"). Feeding it raw, time-paced
    // events instead lets the window's screen-space span grow with speed
    // (more raw samples arrive over a wider path when moving fast) and
    // collapse quickly once the pointer slows or stops -- the rubberband
    // feel. The arc-length conditioner still runs (see below), just after
    // stabilization now, so curve tessellation/texture spacing keeps its
    // even canonical density along the STABILIZED path.
    const effPressure=_contactFilteredPressure(newPressure,raw.x,raw.y,ev.pointerType);
    _stabilizerSetSampleContext(effPressure,ev);
    const evTime=Number.isFinite(ev.timeStamp)&&ev.timeStamp>0?ev.timeStamp:performance.now();
    const p=_stabilizePoint(raw.x,raw.y,evTime);
    _tipDisplayRecordAuthoritative(p.x,p.y,performance.now());
    _updateVelocity(p.x,p.y,evTime);
    if(window._brushAirbrush&&Math.hypot(p.x-lx,p.y-ly)>0.01)_airbrushLastMovementTime=performance.now();
    const conditionedSamples=_baselineConditionerPush(_baselineSampleFromStabilizedPoint(ev,p,evTime));
    for(const conditioned of conditionedSamples){
      _curveAddPoint(conditioned.x,conditioned.y,conditioned.pressure,conditioned.event);
      currentPressure=conditioned.pressure;lx=conditioned.x;ly=conditioned.y;_lastPointerEvent=conditioned.event;
    }
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
  if(tool==='eyedropper'&&e.pointerId===_eyedropperPointerId){if(e.buttons&1){e.preventDefault();_sampleVisibleCanvasColor(e);}return;}
  if(_hasRawUpdate && e.pointerType === 'pen') return; // handled exclusively by pointerrawupdate below
  _handleMoveEvent(e);
});
if(_hasRawUpdate){
  activeC.addEventListener('pointerrawupdate', e=>{
    if(e.pointerType !== 'pen') return;
    if(tool==='eyedropper'&&e.pointerId===_eyedropperPointerId){if(e.buttons&1){e.preventDefault();_sampleVisibleCanvasColor(e);}return;}
    _handleMoveEvent(e);
  });
}
function _pointerEndStroke(e){
  if(_strokeCompletionStarted) return;
  if(_activeStrokePointerId!=null&&e.pointerId!==_activeStrokePointerId) return;
  _strokeCompletionStarted=true;
  _stopAirbrushSpray();
  _cancelLinePreview();
  if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='endpoints'){
    const p=getPos(e);if(_lineGesture)_editLinePressureProfile([{event:e,point:p}]);
    _curveToolGesture.end={x:p.x,y:p.y};_curveToolGesture.control={x:(lineStart.x+p.x)/2,y:(lineStart.y+p.y)/2};_curveToolGesture.phase='bending';
    _lineDragging=false;_activeStrokePointerId=null;_strokeCompletionStarted=false;_renderLineDrag(_curveToolGesture.control.x,_curveToolGesture.control.y,e,'preview');_scheduleRecomposite();return;
  }
  if(activeGroupId){drawing=false;lineStart=null;_lineDragging=false;_linePressureSamples=[];_lineGesture=null;_linePreviewBounds=null;_linePreviewPreviousEndpoint=null;_pendingDabs.length=0;_endColorEraserStroke();_activeStrokePointerId=null;return;}
  if(tool==='line'&&lineStart){
    pushUndo();ensureKey();const p=getPos(e);
    if(_lineGesture)_editLinePressureProfile([{event:e,point:p}]);
    const retainedPressure=_lineGesture&&_lineGesture.pressureSamples.length?_lineGesture.pressureSamples[_lineGesture.pressureSamples.length-1].pressure:currentPressure;
    currentPressure=retainedPressure;
    if(!_strokeCanvas||!_inStroke){_ensureStrokeCanvas();_inStroke=true;}
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('stroke-state-initialization-complete',{strokeCanvas:!!_strokeCanvas,inStroke:_inStroke});
    // Final commit shares the exact same renderer used for every live
    // preview frame during the drag, so what the user saw IS what gets
    // written to the layer (no "collapsing to one average value"). Any
    // preview RAF that was still pending from the last pointermove was
    // already cancelled above -- this call always uses the true final
    // pointerup position, never a stale queued endpoint.
    _renderLineDrag(p.x,p.y,e,'commit');
    if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
    _cleanupErasedSmartOwnership();_clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);_clearLinePreviewCanvas(_texturedStrokeCanvas,_texturedStrokeCtx);_clearLinePreviewCanvas(_strokePreviewCanvas,_strokePreviewCtx);lineStart=null;_lineDragging=false;_linePressureSamples=[];_lineGesture=null;_linePreviewBounds=null;_linePreviewPreviousEndpoint=null;saveActiveToKey();
  }else if(drawing){
    const finalRaw=getPos(e);
    const finalConditioned=_baselineConditionerPush(_baselineSampleFromEvent(e,finalRaw,currentPressure),{force:true});
    if(_stabilizationAmount()>0&&_stabilizerActive){
      drawing=false;
      _stabilizerFinalize(finalRaw.x,finalRaw.y,_stabilizerTargetPressure,e,()=>{
        _flushCurveTail(_lastPointerEvent||e);
        _flushStrokeTail();
        if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
        _restoreSelectionScopePixels();_cleanupErasedSmartOwnership();saveActiveToKey();
        _finalizePointerEndStroke(e);
      });
      return;
    }
    drawing=false;
    for(const conditioned of finalConditioned){
      _stabilizerSetSampleContext(conditioned.pressure,e);
      const finalPoint=_stabilizePoint(conditioned.x,conditioned.y,conditioned.time);
      _updateVelocity(finalPoint.x,finalPoint.y,conditioned.time);
      _curveAddPoint(finalPoint.x,finalPoint.y,finalPoint.pressure,e);
      _tipDisplayRecordAuthoritative(finalPoint.x,finalPoint.y,performance.now());
      currentPressure=finalPoint.pressure;lx=finalPoint.x;ly=finalPoint.y;_lastPointerEvent=e;
    }
    _flushCurveTail(e);
    _flushStrokeTail();
    if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
    _restoreSelectionScopePixels();_cleanupErasedSmartOwnership();saveActiveToKey();
  }
  _finalizePointerEndStroke(e);
}
function _finalizePointerEndStroke(e){
  _endColorEraserStroke();
  _completePostStrokePresentation(_strokeOwnerLayer,_strokeOwnerFrame);
  const latencyProfiler=_brushPerf();if(latencyProfiler)latencyProfiler.finishStroke({tool,sourceLayer:_strokeOwnerLayer,sourceFrame:_strokeOwnerFrame});
  if(window.CompositionPrewarm)window.CompositionPrewarm.noteStrokeComplete();
  if(window.BrushRafExperiment)window.BrushRafExperiment.strokeEnds({dabCount:_strokeDabCount});
  if(window.BrushFirstDabExperiment)window.BrushFirstDabExperiment.strokeEnds({dabCount:_strokeDabCount});
  if(window.KeyframeLatencyExperiment)window.KeyframeLatencyExperiment.strokeEnds({dabCount:_strokeDabCount});
  if(window.TipReadbackExperiment)window.TipReadbackExperiment.strokeEnd();
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.endStroke();
  if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.strokeEnd();
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.strokeComplete();
  _baselineConditionerFinish(false);
  _pendingDabs.length=0;
  _curveP0=null;_curveP1=null;
  _strokeSegCarryOver=0;
  _activeStrokePointerId=null;
  _strokeOwnerLayer=-1;_strokeOwnerFrame=-1;
}
document.addEventListener('keydown',e=>{
  if(!_curveToolGesture)return;const target=e.target instanceof Element?e.target:null;
  if(target&&(target.isContentEditable||target.closest('input,textarea,select,[contenteditable="true"]')))return;
  if(e.key==='Escape'){e.preventDefault();_cancelCurveTool();}
  else if(e.key==='Enter'&&_curveToolGesture.phase==='bending'){e.preventDefault();_commitCurveTool(_lastPointerEvent);}
});
activeC.addEventListener('contextmenu',e=>{if(tool==='curve'&&_curveToolGesture){e.preventDefault();_cancelCurveTool();}});
window.addEventListener('tool-changed',e=>{if(_curveToolGesture&&(!e.detail||e.detail.tool!=='curve'))_cancelCurveTool();});
activeC.addEventListener('pointerup',e=>{
  if(e.pointerId===_curveCommitPointerId){_curveCommitPointerId=null;return;}
  if(e.pointerId===_eyedropperPointerId){_eyedropperPointerId=null;if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);return;}
  _pointerEndStroke(e);
  if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);
});
activeC.addEventListener('pointercancel',e=>{if(e.pointerId===_eyedropperPointerId)_eyedropperPointerId=null;_endStroke(e.pointerId);});
activeC.addEventListener('lostpointercapture',e=>{if(e.pointerId===_eyedropperPointerId)_eyedropperPointerId=null;if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending')return;_endStroke(e.pointerId);});