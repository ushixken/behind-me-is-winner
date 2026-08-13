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
// Diagnostic-only aggregate brush performance recorder. It is deliberately
// counter/timing based: no pixel reads, stack capture, DOM queries, or
// per-dab log entries are introduced by this diagnostic.
if(typeof window.BrushDebugPerf==='undefined')window.BrushDebugPerf=false;
const _brushDiagPerfRecords=[];
let _brushDiagPerfActive=null;
const _brushDiagPerfByStroke=new Map();
let _brushDiagPerfLastTipVersion=window.brushTipVersion||0;
function _brushDiagPerfBegin(strokeId){
  if(!window.BrushDebugPerf){_brushDiagPerfActive=null;return;}
  const custom=!!window.brushTipCanvas,hard=!!_hardRoundStrokeActive,tipVersion=window.brushTipVersion||0;
  _brushDiagPerfActive={strokeId,startTime:performance.now(),route:hard?'migrated-hard-round':(custom?'legacy-custom-tip-dabs':'legacy-procedural-dabs'),backend:hard?'pending':(custom?'canvas2d':'canvas2d'),customTip:custom,texture:!!window.brushTextureEnabled,
    rawSampleCount:1,stabilizedSampleCount:1,resolvedDabCount:0,tinyDabCount:0,normalDabCount:0,radiusCount:0,radiusSum:0,minRadius:null,maxRadius:null,spacingCount:0,spacingSum:0,minSpacing:null,maxSpacing:null,
    tinyCoverageCalls:0,stampCacheHits:0,stampCacheMisses:0,stampBuilds:0,canvasDrawCallCount:0,canvasGetImageDataCalls:0,canvasPutImageDataCalls:0,temporaryCanvasAllocations:0,gpuInstanceCount:0,gpuBatchCount:0,gpuDrawCallCount:0,gpuInitializationMs:0,totalProcessingMs:0,firstGpuInitializationThisStroke:false,cacheInvalidatedThisStroke:tipVersion!==_brushDiagPerfLastTipVersion,tipVersion};
  _brushDiagPerfLastTipVersion=tipVersion;
  _brushDiagPerfByStroke.set(strokeId,_brushDiagPerfActive);
}
function _brushDiagPerfNote(type,detail){
  const a=_brushDiagPerfActive;if(!window.BrushDebugPerf||!a)return;const d=detail||{};
  if(type==='raw-samples')a.rawSampleCount+=d.count||0;
  else if(type==='stabilized-sample')a.stabilizedSampleCount++;
  else if(type==='resolved'){const n=d.count||1;a.resolvedDabCount+=n;if(Number.isFinite(d.radius)){a.radiusCount+=n;a.radiusSum+=d.radius*n;}const lo=Number.isFinite(d.minRadius)?d.minRadius:d.radius,hi=Number.isFinite(d.maxRadius)?d.maxRadius:d.radius;if(Number.isFinite(lo))a.minRadius=a.minRadius==null?lo:Math.min(a.minRadius,lo);if(Number.isFinite(hi))a.maxRadius=a.maxRadius==null?hi:Math.max(a.maxRadius,hi);}
  else if(type==='spacing'&&Number.isFinite(d.step)){a.spacingCount++;a.spacingSum+=d.step;a.minSpacing=a.minSpacing==null?d.step:Math.min(a.minSpacing,d.step);a.maxSpacing=a.maxSpacing==null?d.step:Math.max(a.maxSpacing,d.step);}
  else if(type==='tiny'){a.tinyDabCount++;a.tinyCoverageCalls++;}
  else if(type==='normal')a.normalDabCount++;
  else if(type==='stamp-cache'){if(d.hit)a.stampCacheHits++;else a.stampCacheMisses++;}
  else if(type==='stamp-build')a.stampBuilds++;
  else if(type==='canvas-draw')a.canvasDrawCallCount++;
  else if(type==='get-image-data')a.canvasGetImageDataCalls++;
  else if(type==='put-image-data')a.canvasPutImageDataCalls++;
  else if(type==='temp-canvas')a.temporaryCanvasAllocations+=d.count||1;
  else if(type==='gpu-init'){a.gpuInitializationMs+=d.ms||0;a.firstGpuInitializationThisStroke=a.firstGpuInitializationThisStroke||!!d.first;}
  else if(type==='gpu-state'){if(d.backend)a.backend=d.backend;}
  else if(type==='gpu-work'){a.gpuInstanceCount+=d.instances||0;a.gpuBatchCount+=d.batches||0;a.gpuDrawCallCount+=d.drawCalls||0;}
  else if(type==='processing')a.totalProcessingMs+=d.ms||0;
  else if(type==='cache-invalidated')a.cacheInvalidatedThisStroke=true;
}
window.BrushPerfNote=_brushDiagPerfNote;
function _brushDiagPerfEnd(strokeId){
  const a=_brushDiagPerfByStroke.get(strokeId);if(!a)return;a.endTime=performance.now();a.strokeDurationMs=a.endTime-a.startTime;a.avgRadius=a.radiusCount?a.radiusSum/a.radiusCount:null;a.avgSpacing=a.spacingCount?a.spacingSum/a.spacingCount:null;a.minSpacingDistance=a.minSpacing;a.maxSpacingDistance=a.maxSpacing;a.avgSpacingDistance=a.avgSpacing;a.tinyCoverageCallCount=a.tinyCoverageCalls;a.stampBuildCount=a.stampBuilds;a.stampCacheHitCount=a.stampCacheHits;a.stampCacheMissCount=a.stampCacheMisses;a.getImageDataCount=a.canvasGetImageDataCalls;a.putImageDataCount=a.canvasPutImageDataCalls;a.temporaryCanvasCount=a.temporaryCanvasAllocations;a.initializationMs=a.gpuInitializationMs;a.strokeProcessingMs=a.totalProcessingMs;delete a.radiusSum;delete a.spacingSum;_brushDiagPerfRecords.push(a);if(_brushDiagPerfRecords.length>24)_brushDiagPerfRecords.splice(0,_brushDiagPerfRecords.length-24);_brushDiagPerfByStroke.delete(strokeId);if(_brushDiagPerfActive===a)_brushDiagPerfActive=null;
}
window.BrushAnalyzePerf=function(){const strokes=_brushDiagPerfRecords.map(x=>Object.assign({},x));return{available:true,enabled:!!window.BrushDebugPerf,count:strokes.length,latest:strokes[strokes.length-1]||null,strokes};};
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
  if(typeof _aaDabCache!=='undefined')_aaDabCache.clear();
  if(typeof _stampCache!=='undefined')_stampCache.clear();
  if(typeof _tipDabCache!=='undefined')_tipDabCache.clear();
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
  _flushTinyTipCoverageTiles();
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


// TEMP DIAGNOSTIC (Phase 11A.16) -- four-point GPU capture, read-only.
// Hashes/bounds a canvas without mutating renderer state. Removed with the
// rest of the HR-DEBUG instrumentation once the merge hypothesis is
// resolved.
function _hrCaptureCanvas(canvas,label){
  if(!canvas)return null;
  const w=canvas.width,h=canvas.height;
  let data;
  try{
    const cctx=canvas.getContext&&(canvas.getContext('2d')||canvas.getContext('webgpu')&&null);
    if(cctx&&cctx.getImageData){data=cctx.getImageData(0,0,w,h).data;}
    else{
      const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
      const tctx=tmp.getContext('2d');tctx.drawImage(canvas,0,0);
      data=tctx.getImageData(0,0,w,h).data;
    }
  }catch(err){
    console.warn('[HR-CAPTURE] failed to read',label,err);
    return {label,w,h,error:String(err)};
  }
  let minX=w,minY=h,maxX=-1,maxY=-1,nonTransparent=0,maxAlpha=0,hash=0;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const idx=(y*w+x)*4,a=data[idx+3];
      if(a>0){
        nonTransparent++;
        if(a>maxAlpha)maxAlpha=a;
        if(x<minX)minX=x; if(x>maxX)maxX=x;
        if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
      hash=(hash*31+data[idx]+data[idx+1]*3+data[idx+2]*7+a*13)|0;
    }
  }
  return {
    label,w,h,
    bounds:maxX>=minX?{minX,minY,maxX,maxY}:null,
    nonTransparent,maxAlpha,hash,
  };
}
function _hrDiffCaptures(a,b){
  if(!a||!b)return null;
  if(a.w!==b.w||a.h!==b.h)return {sizeMismatch:true,aSize:[a.w,a.h],bSize:[b.w,b.h]};
  return {
    hashEqual:a.hash===b.hash,
    nonTransparentDelta:(b.nonTransparent||0)-(a.nonTransparent||0),
    maxAlphaDelta:(b.maxAlpha||0)-(a.maxAlpha||0),
    boundsA:a.bounds,boundsB:b.bounds,
  };
}
// Phase 11A.37 -- real pixel-level diff, read-only. _hrDiffCaptures above
// only compares the summary numbers (hash/bounds/counts) already produced
// by _hrCaptureCanvas; it cannot report differingPixelCount or
// maxChannelDiff because those require the actual pixel buffers, not just
// their summary. This re-reads both canvases (getImageData only, no
// writes) purely to produce those two numbers for the D/E1/E2/E3 compare
// requested for Stage E. Canvases of mismatched size are reported as such
// instead of compared pixel-by-pixel.
function _hrStageDiagPixelDiff(canvasA,canvasB){
  if(!canvasA||!canvasB)return null;
  if(canvasA.width!==canvasB.width||canvasA.height!==canvasB.height){
    return {sizeMismatch:true,aSize:[canvasA.width,canvasA.height],bSize:[canvasB.width,canvasB.height]};
  }
  const w=canvasA.width,h=canvasA.height;
  let da,db;
  try{
    const ra=document.createElement('canvas');ra.width=w;ra.height=h;
    const rb=document.createElement('canvas');rb.width=w;rb.height=h;
    const rca=ra.getContext('2d'),rcb=rb.getContext('2d');
    rca.drawImage(canvasA,0,0);rcb.drawImage(canvasB,0,0);
    da=rca.getImageData(0,0,w,h).data;db=rcb.getImageData(0,0,w,h).data;
  }catch(err){
    return {error:String(err)};
  }
  let differingPixelCount=0,maxChannelDiff=0;
  for(let i=0;i<da.length;i+=4){
    const dr=Math.abs(da[i]-db[i]),dg=Math.abs(da[i+1]-db[i+1]),
          dbch=Math.abs(da[i+2]-db[i+2]),dal=Math.abs(da[i+3]-db[i+3]);
    const pixelMax=Math.max(dr,dg,dbch,dal);
    if(pixelMax>0)differingPixelCount++;
    if(pixelMax>maxChannelDiff)maxChannelDiff=pixelMax;
  }
  return {differingPixelCount,maxChannelDiff,w,h};
}
// Combines the existing summary diff with the new pixel-level diff so each
// D/E1/E2/E3 comparison reports bounds/nonTransparent/maxAlpha/hash deltas
// AND differingPixelCount/maxChannelDiff in one object.
function _hrStageDiagFullCompare(labelA,captureA,canvasA,labelB,captureB,canvasB){
  return {
    from:labelA,to:labelB,
    summary:_hrDiffCaptures(captureA,captureB),
    pixels:_hrStageDiagPixelDiff(canvasA,canvasB),
  };
}
// Phase 11A.37 -- capture points for E1/E2/E3, called directly from the
// REAL recomposite() implementation in panels.js (not via monkey-patch --
// see comment above _hrStageDiagPatchRecomposite for why that approach is
// unreliable, now superseded by these direct call sites). Each is a
// guarded no-op unless window.HardRoundStageDiag is on and a commit is
// pending (cap.pendingE, set by _hrStageDiagCaptureD).
function _hrStageDiagCaptureE1(artworkCompositeCanvas){
  if(!_hrStageDiagEnabled())return;
  const cap=window.HardRoundStageCapture;
  if(!cap||!cap.pendingE)return;
  cap.E1=_hrStageCaptureFull(artworkCompositeCanvas,'E1-artworkCompositeC-post-layer-draw');
  cap._E1canvas=artworkCompositeCanvas;
}
function _hrStageDiagCaptureE2(compCanvas){
  if(!_hrStageDiagEnabled())return;
  const cap=window.HardRoundStageCapture;
  if(!cap||!cap.pendingE||!cap.E1)return;
  cap.E2=_hrStageCaptureFull(compCanvas,'E2-compC-post-artwork-composite');
  cap._E2canvas=compCanvas;
}
function _hrStageDiagCaptureE3(displayCanvas){
  if(!_hrStageDiagEnabled())return;
  const cap=window.HardRoundStageCapture;
  if(!cap||!cap.pendingE||!cap.E2)return;
  cap.pendingE=false;
  cap.E3=_hrStageCaptureFull(displayCanvas,'E3-displayC-final-visible');
  cap._E3canvas=displayCanvas;
  // D was captured as a REGION (see _hrStageDiagCaptureD/_hrStageCaptureRegion),
  // E1/E2/E3 above are captured FULL-canvas, so D's capture object can't be
  // pixel-diffed against a full canvas without re-reading D's own source
  // canvas at full size. We only have D's already-read summary object here
  // (activeC region), so D-vs-E1 below uses the summary-only comparison
  // (bounds/nonTransparent/maxAlpha/hash); pixel-level
  // differingPixelCount/maxChannelDiff are reported for E1->E2 and E2->E3,
  // which are full-canvas-to-full-canvas.
  cap.diffsE={
    DtoE1:{from:'D-activeC-post-commit',to:'E1-artworkCompositeC-post-layer-draw',summary:_hrDiffCaptures(cap.D,cap.E1)},
    E1toE2:_hrStageDiagFullCompare('E1-artworkCompositeC-post-layer-draw',cap.E1,cap._E1canvas,'E2-compC-post-artwork-composite',cap.E2,cap._E2canvas),
    E2toE3:_hrStageDiagFullCompare('E2-compC-post-artwork-composite',cap.E2,cap._E2canvas,'E3-displayC-final-visible',cap.E3,cap._E3canvas),
  };
  console.log('[HR-STAGE-DIAG 11A.37] D->E1->E2->E3 captured. Inspect window.HardRoundStageCapture (E1/E2/E3/diffsE) or call window.HardRoundStageDiagSummary().');
  // Phase 11A.38 -- one-shot, read-only follow-up. E2->E3 showed 602
  // differing pixels across the FULL 1920x1080 canvas; this narrows that
  // down to just the real stroke bounds (from D/E1, +4px pad) so we can
  // tell whether the brush's own appearance changes between compC and
  // displayC, or whether those 602 pixels are unrelated to the stroke
  // (e.g. onionC content, or displayCtx.filter blur touching non-stroke
  // pixels). Reuses cap._E2canvas/_E3canvas already captured above --
  // no new capture call sites, no writes, nothing auto-logged beyond one
  // line pointing at where to inspect the result.
  try{_hrStageDiagE2E3BrushRegion(cap);}catch(err){console.warn('[HR-STAGE-DIAG 11A.38] brush-region compare failed',err);}
}
function _hrStageDiagE2E3BrushRegion(cap){
  cap=cap||window.HardRoundStageCapture;
  if(!cap||!cap._E2canvas||!cap._E3canvas)return null;
  // Real stroke bounds: prefer D (activeC post-commit region, proven
  // identical to A/B/E1), fall back to E1's own full-canvas bounds.
  const boundsSrc=(cap.D&&cap.D.bounds)?cap.D:(cap.E1&&cap.E1.bounds?cap.E1:null);
  if(!boundsSrc||!boundsSrc.bounds){console.warn('[HR-STAGE-DIAG 11A.38] no stroke bounds available on D/E1');return null;}
  // D is a REGION capture (relative to its own rect), so its bounds are
  // region-local; D's region.rx/ry (set by _hrStageCaptureRegion) must be
  // added back to get full-canvas coordinates. E1 is captured FULL-canvas,
  // so its bounds need no offset.
  const off=(boundsSrc.region)?{x:boundsSrc.region.rx,y:boundsSrc.region.ry}:{x:0,y:0};
  const b=boundsSrc.bounds;
  const pad=4;
  const e2c=cap._E2canvas,e3c=cap._E3canvas;
  const W=e2c.width,H=e2c.height;
  const rx=Math.max(0,off.x+b.minX-pad);
  const ry=Math.max(0,off.y+b.minY-pad);
  const rMaxX=Math.min(W-1,off.x+b.maxX+pad);
  const rMaxY=Math.min(H-1,off.y+b.maxY+pad);
  const rw=rMaxX-rx+1,rh=rMaxY-ry+1;
  if(rw<=0||rh<=0){console.warn('[HR-STAGE-DIAG 11A.38] empty brush region');return null;}
  let e2Data,e3Data;
  try{
    const ta=document.createElement('canvas');ta.width=rw;ta.height=rh;
    const tb=document.createElement('canvas');tb.width=rw;tb.height=rh;
    ta.getContext('2d').drawImage(e2c,rx,ry,rw,rh,0,0,rw,rh);
    tb.getContext('2d').drawImage(e3c,rx,ry,rw,rh,0,0,rw,rh);
    e2Data=ta.getContext('2d').getImageData(0,0,rw,rh).data;
    e3Data=tb.getContext('2d').getImageData(0,0,rw,rh).data;
  }catch(err){console.warn('[HR-STAGE-DIAG 11A.38] region read failed',err);return null;}
  let differingPixelCount=0,maxChannelDiff=0;
  let minX=rw,minY=rh,maxX=-1,maxY=-1;
  const first10=[];
  for(let yy=0;yy<rh;yy++){
    for(let xx=0;xx<rw;xx++){
      const idx=(yy*rw+xx)*4;
      const dr=Math.abs(e2Data[idx]-e3Data[idx]),dg=Math.abs(e2Data[idx+1]-e3Data[idx+1]),
            dbch=Math.abs(e2Data[idx+2]-e3Data[idx+2]),dal=Math.abs(e2Data[idx+3]-e3Data[idx+3]);
      const pixelMax=Math.max(dr,dg,dbch,dal);
      if(pixelMax>0){
        differingPixelCount++;
        if(pixelMax>maxChannelDiff)maxChannelDiff=pixelMax;
        const gx=rx+xx,gy=ry+yy;
        if(xx<minX)minX=xx; if(xx>maxX)maxX=xx;
        if(yy<minY)minY=yy; if(yy>maxY)maxY=yy;
        if(first10.length<10){
          first10.push({
            x:gx,y:gy,
            e2:[e2Data[idx],e2Data[idx+1],e2Data[idx+2],e2Data[idx+3]],
            e3:[e3Data[idx],e3Data[idx+1],e3Data[idx+2],e3Data[idx+3]],
          });
        }
      }
    }
  }
  const diffBoundsGlobal=maxX>=minX?{minX:rx+minX,minY:ry+minY,maxX:rx+maxX,maxY:ry+maxY}:null;
  // Cross-check against the already-known full-canvas E2->E3 diff count
  // (602, per the 11A.37 run) to see whether the brush region accounts
  // for all of it, some of it, or none of it.
  const fullCanvasCount=(cap.diffsE&&cap.diffsE.E2toE3&&cap.diffsE.E2toE3.pixels)?cap.diffsE.E2toE3.pixels.differingPixelCount:null;
  const allDiffsInBrushRegion=(fullCanvasCount!=null)?(differingPixelCount===fullCanvasCount):null;
  // Requirement 4: E1 (transparent) can't be compared raw against E2
  // (opaque, has background under it). The one fair, read-only check we
  // CAN do without recomputing compositing: wherever E1 is fully opaque
  // (alpha===255) inside this same region, no background can show through,
  // so E2's RGB there must equal E1's RGB regardless of what's underneath.
  // That isolates "did the opaque core of the stroke change" from "did the
  // background/edges change", without simulating compositing math.
  let e1OpaqueCheck=null;
  if(cap._E1canvas){
    try{
      const t1=document.createElement('canvas');t1.width=rw;t1.height=rh;
      t1.getContext('2d').drawImage(cap._E1canvas,rx,ry,rw,rh,0,0,rw,rh);
      const e1Data=t1.getContext('2d').getImageData(0,0,rw,rh).data;
      let opaquePixels=0,opaqueMismatches=0,opaqueMaxDiff=0;
      for(let i=0;i<e1Data.length;i+=4){
        if(e1Data[i+3]===255){
          opaquePixels++;
          const dr=Math.abs(e1Data[i]-e2Data[i]),dg=Math.abs(e1Data[i+1]-e2Data[i+1]),dbc=Math.abs(e1Data[i+2]-e2Data[i+2]);
          const m=Math.max(dr,dg,dbc);
          if(m>0)opaqueMismatches++;
          if(m>opaqueMaxDiff)opaqueMaxDiff=m;
        }
      }
      e1OpaqueCheck={opaquePixels,opaqueMismatches,opaqueMaxDiff,note:'Compares E1 vs E2 RGB only where E1 alpha=255 (background cannot show through there, so this is a valid raw comparison; partial-alpha edge pixels are excluded since those genuinely need background compositing to compare fairly).'};
    }catch(err){e1OpaqueCheck={error:String(err)};}
  }
  window.HardRoundStageCapture=window.HardRoundStageCapture||{};
  window.HardRoundStageCapture.brushRegionE2E3={
    region:{x:rx,y:ry,w:rw,h:rh,pad},
    differingPixelCount,
    maxChannelDiff,
    diffBounds:diffBoundsGlobal,
    first10DifferingPixels:first10,
    fullCanvasE2toE3Count:fullCanvasCount,
    allFullCanvasDiffsInsideBrushRegion:allDiffsInBrushRegion,
    e1OpaqueVsE2Check:e1OpaqueCheck,
  };
  console.log('[HR-STAGE-DIAG 11A.38] brush-region E2->E3 compare done. Print with: window.HardRoundStageCapture.brushRegionE2E3');
  return window.HardRoundStageCapture.brushRegionE2E3;
}
window.HardRoundDebugCapture=window.HardRoundDebugCapture||{};
// TEMP DIAGNOSTIC (Phase 11A.19): hashes a rectangular region of activeC's
// real backing store via ctx.getImageData -- read-only, no writes. Reuses
// the same hash/bounds/count formula as _hrCaptureCanvas so results are
// directly comparable across phases.
function _hrHashActiveCRegion(x,y,w,h,label){
  let data;
  try{ data=ctx.getImageData(x,y,w,h).data; }
  catch(err){ console.warn('[HR-ACTIVEC-PROBE] read failed',label,err); return {label,error:String(err)}; }
  let minX=w,minY=h,maxX=-1,maxY=-1,nonTransparent=0,maxAlpha=0,hash=0;
  for(let yy=0;yy<h;yy++){
    for(let xx=0;xx<w;xx++){
      const idx=(yy*w+xx)*4,a=data[idx+3];
      if(a>0){
        nonTransparent++;
        if(a>maxAlpha)maxAlpha=a;
        if(xx<minX)minX=xx; if(xx>maxX)maxX=xx;
        if(yy<minY)minY=yy; if(yy>maxY)maxY=yy;
      }
      hash=(hash*31+data[idx]+data[idx+1]*3+data[idx+2]*7+a*13)|0;
    }
  }
  return {label,x,y,w,h,bounds:maxX>=minX?{minX,minY,maxX,maxY}:null,nonTransparent,maxAlpha,hash};
}
// TEMP DIAGNOSTIC (Phase 11A.20): hashes an off-DOM canvas the same way
// _hrHashActiveCRegion hashes a live activeC region, so results from a
// resolveInto()-produced scratch canvas (PRE_END/FINAL_GPU) are directly
// comparable to a committed-layer capture (COMMITTED). Read-only, no
// writes to the passed canvas.
function _hrHashCanvas(canvas,label){
  if(!canvas)return{label,error:'no-canvas'};
  let data;
  try{ data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; }
  catch(err){ console.warn('[11A.20] hash failed',label,err); return {label,error:String(err)}; }
  const w=canvas.width,h=canvas.height;
  let minX=w,minY=h,maxX=-1,maxY=-1,nonTransparent=0,maxAlpha=0,hash=0;
  for(let yy=0;yy<h;yy++){
    for(let xx=0;xx<w;xx++){
      const idx=(yy*w+xx)*4,a=data[idx+3];
      if(a>0){
        nonTransparent++;
        if(a>maxAlpha)maxAlpha=a;
        if(xx<minX)minX=xx; if(xx>maxX)maxX=xx;
        if(yy<minY)minY=yy; if(yy>maxY)maxY=yy;
      }
      hash=(hash*31+data[idx]+data[idx+1]*3+data[idx+2]*7+a*13)|0;
    }
  }
  return {label,w,h,bounds:maxX>=minX?{minX,minY,maxX,maxY}:null,nonTransparent,maxAlpha,hash};
}
// Same comparison shape as _hrDiffCaptures, kept as its own named function
// per the Phase 11A.20 patch spec (does not replace or alias the existing
// _hrDiffCaptures used by the 11A.19 B/C/D summary).
// TEMP DIAGNOSTIC (Phase 11A.27): hashes a raw {data,w,h} buffer (as
// returned by GpuBackend.diagResolveIntoBuffer(), reused unmodified from
// Phase 11A.25) using the exact same formula as _hrHashCanvas/
// _hrHashActiveCRegion, so a LAST_LIVE capture (buffer) is directly
// comparable to a PRE_END capture (canvas) without a second hashing
// scheme to reconcile. Read-only.
function _hrHashBuffer(buf,label){
  if(!buf||!buf.data)return{label,error:'no-buffer'};
  const {data,w,h}=buf;
  let minX=w,minY=h,maxX=-1,maxY=-1,nonTransparent=0,maxAlpha=0,hash=0;
  for(let yy=0;yy<h;yy++){
    for(let xx=0;xx<w;xx++){
      const idx=(yy*w+xx)*4,a=data[idx+3];
      if(a>0){
        nonTransparent++;
        if(a>maxAlpha)maxAlpha=a;
        if(xx<minX)minX=xx; if(xx>maxX)maxX=xx;
        if(yy<minY)minY=yy; if(yy>maxY)maxY=yy;
      }
      hash=(hash*31+data[idx]+data[idx+1]*3+data[idx+2]*7+a*13)|0;
    }
  }
  return {label,w,h,bounds:maxX>=minX?{minX,minY,maxX,maxY}:null,nonTransparent,maxAlpha,hash};
}
function _hrDiffHashes(a,b){
  if(!a||!b)return null;
  if(a.error||b.error)return {error:true,aError:a.error,bError:b.error};
  if(a.w!==b.w||a.h!==b.h)return {sizeMismatch:true,aSize:[a.w,a.h],bSize:[b.w,b.h]};
  return {
    hashEqual:a.hash===b.hash,
    nonTransparentDelta:(b.nonTransparent||0)-(a.nonTransparent||0),
    maxAlphaDelta:(b.maxAlpha||0)-(a.maxAlpha||0),
    boundsA:a.bounds,boundsB:b.bounds,
  };
}
function _hrRunCaptureSummary(){
  const c=window.HardRoundDebugCapture;
  const bc=_hrDiffCaptures(c.B,c.C),cd=_hrDiffCaptures(c.C,c.D),presentVsResolve=_hrDiffCaptures(c.A1_present,c.A2_resolve);
  c.diffs={BtoC:bc,CtoD:cd,presentVsResolve};
  // Phase 11A.30: this used to unconditionally console.log('[HR-CAPTURE]', ...)
  // on every GPU-committed stroke -- routine console noise left over from
  // earlier Phase 11A experiments, no longer needed for this investigation.
  // The full diagnostic object (c, including c.diffs) remains on
  // window.HardRoundDebugCapture for manual inspection; only the automatic
  // print was removed.
}

// ============================================================================
// PHASE 11A.36 -- opt-in A/B/C/D/E commit-pipeline stage diagnostic.
//
// Off by default. Enable with:
//   window.HardRoundStageDiag = true;
// before drawing a stroke on an EMPTY normal-raster layer (bounds tracking
// is written to be correct for that case first -- see note on stage C/D).
//
// Captures, per user's Phase 11A.36 spec:
//   A = final GPU-resolved stroke result immediately before it is
//       copied/committed (result.canvas from renderer.endStroke(), BEFORE
//       it is drawn into _strokeCanvas).
//   B = the actual stroke source canvas (_strokeCanvas) immediately before
//       _commitStrokeCanvas() runs.
//   C = activeC immediately BEFORE _commitStrokeCanvas()'s composite draw.
//   D = activeC immediately AFTER _commitStrokeCanvas()'s composite draw.
//   E = the display/composite canvas immediately after recomposite() next
//       runs following commit.
//
// Each stage is hashed/measured with the existing _hrCaptureCanvas() helper
// (bounds, nonTransparent count, maxAlpha, hash) -- no new pixel-reading
// logic, just new call sites. Results land on window.HardRoundStageCapture
// and window.HardRoundStageCapture.diffs; nothing is logged automatically
// to avoid reintroducing console spam -- inspect manually or call
// window.HardRoundStageDiagSummary().
//
// IMPORTANT: this diagnostic only READS canvases (getImageData/drawImage
// into throwaway scratch canvases). It never mutates _strokeCanvas, activeC,
// or renderer state, and it does not change: pressure, stabilization, AA,
// segment generation, GPU shaders, finishStroke geometry, or backend
// selection. It is a pure observer bolted onto existing call sites.
// ============================================================================
function _hrStageCaptureFull(canvas,label){
  // Thin wrapper around the existing capture helper, kept separate so this
  // diagnostic's call sites read clearly and can be grepped/removed as a
  // unit later.
  return _hrCaptureCanvas(canvas,label);
}
// Stage C/D capture a REGION of activeC, not the whole canvas, because
// activeC can already contain other artwork (explicitly called out in the
// Phase 11A.36 request). On an empty normal-raster layer this region is
// irrelevant (whole canvas is empty anyway), but the region-based capture
// is written now so it stays correct once this is pointed at a non-empty
// layer later. Region defaults to the full canvas unless a rect is given.
function _hrStageCaptureRegion(canvas,label,rect){
  if(!canvas)return null;
  const w=canvas.width,h=canvas.height;
  const rx=rect?Math.max(0,Math.floor(rect.minX)):0;
  const ry=rect?Math.max(0,Math.floor(rect.minY)):0;
  const rw=rect?Math.min(w,Math.ceil(rect.maxX)+1)-rx:w;
  const rh=rect?Math.min(h,Math.ceil(rect.maxY)+1)-ry:h;
  if(rw<=0||rh<=0)return {label,w:0,h:0,bounds:null,nonTransparent:0,maxAlpha:0,hash:0,region:{rx,ry,rw,rh}};
  const tmp=document.createElement('canvas');tmp.width=rw;tmp.height=rh;
  try{
    tmp.getContext('2d').drawImage(canvas,rx,ry,rw,rh,0,0,rw,rh);
  }catch(err){
    return {label,error:String(err)};
  }
  const capture=_hrCaptureCanvas(tmp,label);
  if(capture)capture.region={rx,ry,rw,rh};
  return capture;
}
function _hrStageDiagEnabled(){return !!window.HardRoundStageDiag;}
function _hrStageDiagReset(){
  window.HardRoundStageCapture={A:null,B:null,C:null,D:null,E:null,
    E1:null,E2:null,E3:null,diffsE:null,
    commitDetail:null,diffs:null,pendingE:false};
}
function _hrStageDiagCaptureA(canvas){
  if(!_hrStageDiagEnabled())return;
  if(!window.HardRoundStageCapture)_hrStageDiagReset();
  window.HardRoundStageCapture.A=_hrStageCaptureFull(canvas,'A-gpu-resolved-pre-copy');
}
function _hrStageDiagCaptureB(canvas){
  if(!_hrStageDiagEnabled())return;
  if(!window.HardRoundStageCapture)_hrStageDiagReset();
  window.HardRoundStageCapture.B=_hrStageCaptureFull(canvas,'B-strokeCanvas-pre-commit');
}
// Called from inside _commitStrokeCanvas(), before/after its composite draw.
// `rect` is the stroke's dirty rect if available (undefined -> full canvas,
// which is the correct/easiest case for an empty test layer per the request).
function _hrStageDiagCaptureC(activeCanvas,rect){
  if(!_hrStageDiagEnabled())return;
  if(!window.HardRoundStageCapture)_hrStageDiagReset();
  window.HardRoundStageCapture.C=_hrStageCaptureRegion(activeCanvas,'C-activeC-pre-commit',rect);
}
function _hrStageDiagCaptureD(activeCanvas,rect,detail){
  if(!_hrStageDiagEnabled())return;
  if(!window.HardRoundStageCapture)_hrStageDiagReset();
  window.HardRoundStageCapture.D=_hrStageCaptureRegion(activeCanvas,'D-activeC-post-commit',rect);
  window.HardRoundStageCapture.commitDetail=detail;
  window.HardRoundStageCapture.pendingE=true; // next recomposite() call should capture E
}
// SUPERSEDED as of Phase 11A.37 -- see _hrStageDiagCaptureE1/E2/E3 above,
// which are called DIRECTLY from inside the real recomposite() in
// panels.js instead of relying on this monkey-patch. Left in place
// (harmless, still read-only) as a fallback for cap.E only. Root cause of
// why this wrapper alone was unreliable: panels.js and brush-engine.js are
// both plain classic (non-module) top-level scripts sharing one global
// object, so `function recomposite(li,fi,dirtyRect){...}` in panels.js IS
// a real global -- but this IIFE below runs synchronously at PARSE time of
// brush-engine.js. If brush-engine.js's <script> tag executes before
// panels.js's does (script tag order in the HTML host page, which is not
// part of these four files), `typeof recomposite` is `'undefined'` at the
// moment this IIFE runs, line below silently returns, and the whole patch
// never attaches -- no error, cap.E just stays null forever. That silent
// failure mode is exactly why Stage E previously produced nothing to
// compare: it never depended on what recomposite() actually does
// internally, only on load order of two unrelated <script> tags.
//
// Monkey-patch recomposite() exactly once, purely to capture E right after
// the NEXT call following a commit (pendingE flag). Every other call
// behaves completely unchanged -- this wrapper always calls straight
// through to the original and returns its result untouched.
function _hrStageDiagMaybeCaptureE(){
  if(!_hrStageDiagEnabled())return;
  const cap=window.HardRoundStageCapture;
  if(!cap||!cap.pendingE)return;
  cap.pendingE=false;
  const displayCanvas=(typeof window.HardRoundStageDiagDisplayCanvas==='function')
    ?window.HardRoundStageDiagDisplayCanvas()
    :(window.HardRoundStageDiagDisplayCanvas||document.getElementById('display-canvas')||document.getElementById('displayCanvas')||activeC);
  cap.E=_hrStageCaptureFull(displayCanvas,'E-display-post-recomposite');
  cap.diffs={
    AtoB:_hrDiffCaptures(cap.A,cap.B),
    CtoD:_hrDiffCaptures(cap.C,cap.D),
    DtoE:_hrDiffCaptures(cap.D,cap.E),
  };
}
(function _hrStageDiagPatchRecomposite(){
  if(typeof recomposite!=='function')return; // not reachable as a bare global here
  if(recomposite.__hrStageWrapped)return;
  const _origRecomposite=recomposite;
  const wrapped=function(...args){
    const result=_origRecomposite.apply(this,args);
    try{_hrStageDiagMaybeCaptureE();}catch(err){console.warn('[HR-STAGE-DIAG] stage E capture failed',err);}
    return result;
  };
  wrapped.__hrStageWrapped=true;
  try{recomposite=wrapped;}catch(err){/* recomposite may be const in some builds */}
  try{window.recomposite=wrapped;}catch(err){}
})();
window.HardRoundStageDiagSummary=function(){
  const cap=window.HardRoundStageCapture;
  if(!cap){console.log('[HR-STAGE-DIAG] no capture yet -- enable window.HardRoundStageDiag and draw a stroke');return null;}
  console.log('[HR-STAGE-DIAG] A (gpu resolved, pre-copy):',cap.A);
  console.log('[HR-STAGE-DIAG] B (strokeCanvas, pre-commit):',cap.B);
  console.log('[HR-STAGE-DIAG] C (activeC, pre-commit):',cap.C);
  console.log('[HR-STAGE-DIAG] D (activeC, post-commit):',cap.D);
  console.log('[HR-STAGE-DIAG] E (display, post-recomposite, legacy monkey-patch path):',cap.E);
  console.log('[HR-STAGE-DIAG 11A.37] E1 (artworkCompositeC, post layer-draw):',cap.E1);
  console.log('[HR-STAGE-DIAG 11A.37] E2 (compC, post artwork-composite):',cap.E2);
  console.log('[HR-STAGE-DIAG 11A.37] E3 (displayC, final visible surface):',cap.E3);
  console.log('[HR-STAGE-DIAG] commit detail (globalAlpha/compositeOp/etc used by _commitStrokeCanvas):',cap.commitDetail);
  console.log('[HR-STAGE-DIAG] diffs A->B / C->D / D->E (legacy):',cap.diffs);
  console.log('[HR-STAGE-DIAG 11A.37] diffs D->E1 / E1->E2 / E2->E3:',cap.diffsE);
  return cap;
};
function _commitStrokeCanvas(){
  _flushTinyTipCoverageTiles();
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
  // Phase 11A.36 stage C: activeC immediately BEFORE this function's
  // composite draw touches it. rect is the stroke's dirty rect when known
  // (undefined -> _hrStageCaptureRegion falls back to the whole canvas,
  // which is what the request asked for as the easy/reliable case on an
  // empty test layer).
  const _hrStage36Rect=_strokeDirty?{minX:_strokeDirty.minX,minY:_strokeDirty.minY,maxX:_strokeDirty.maxX,maxY:_strokeDirty.maxY}:null;
  _hrStageDiagCaptureC(activeC,_hrStage36Rect);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, brushOpacity));
  // Phase 11A.36: record exactly what this commit draw used, answering the
  // "is brushOpacity applied here even though the GPU result may already
  // have opacity baked in" / "what composite op" questions directly from
  // the real values in play, on the real stroke, without guessing.
  if(_hrStageDiagEnabled()){
    window.HardRoundStageCapture=window.HardRoundStageCapture||{};
    window.HardRoundStageCapture.commitDetail={
      globalAlphaApplied:ctx.globalAlpha,
      brushOpacityValue:brushOpacity,
      compositeOperation:_brushPaintCompositeOperation(),
      blendMode:window.brushBlendMode,
      usesBrushPaintPipeline:_usesBrushPaintPipeline(),
      smartOwnership:!!smartOwnership,
      srcW:src&&src.width,srcH:src&&src.height,
    };
  }
  _drawBrushComposite(ctx,src);
  ctx.restore();
  // Phase 11A.36 stage D: activeC immediately AFTER the composite draw.
  // Sets pendingE so the next recomposite() call (whichever call site
  // triggers it) captures stage E.
  _hrStageDiagCaptureD(activeC,_hrStage36Rect,window.HardRoundStageCapture&&window.HardRoundStageCapture.commitDetail);
  if(smartOwnership&&typeof commitSmartRasterBrush==='function'){
    _traceStrokeLifecycle('smart-metadata-start',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,dirtyRect:ownershipDirtyRect});
    commitSmartRasterBrush(src,styleId,brushOpacity,ownershipDirtyRect,ownershipBefore,brushBlendMode);
    _traceStrokeLifecycle('smart-metadata-end',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,dirtyRect:ownershipDirtyRect});
  }
  _strokeCtx.clearRect(0, 0, _strokeCanvas.width, _strokeCanvas.height);
  _traceStrokeLifecycle('commit-end',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame,smartRaster:!!(layers[commitLayer]&&layers[commitLayer].type==='smart-raster')});
  _traceStrokeLifecycle('temporary-stroke-cleared',{sessionId:commitSession,sourceLayer:commitLayer,sourceFrame:commitFrame});
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
  _aaDabCache.clear();_softRoundMaskCache.clear();_tipDabCache.clear();_stampCache.clear();
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
  const saved={frameDirty:_frameDirty,strokeDirty:_strokeDirty,texPending:_texPendingRect,inStroke:_inStroke,flowSpacing:_flowSpacingRatio,isPen:_isDrawingWithPen,currentPressure,_smoothedPressure,lastKnownPressure:_lastKnownPressure,strokeFirstSample:_strokeFirstSample,strokeDabCount:_strokeDabCount,strokeDist:_strokeDistSoFar,autoPrev:_autoHardRoundPrevDab,rotationValid:_rotationPrevValid,rotationPrevX:_rotationPrevX,rotationPrevY:_rotationPrevY,rotationDirection:_rotationDirection,disposablePrewarm:_disposableDabPrewarm};
  let rect=null,alphaPixels=0;
  try{
    const prepareStart=perf?performance.now():0;
    _ensureStrokeCanvas();_disposableDabPrewarm=true;_frameDirty=null;_strokeDirty=null;_texPendingRect=null;_autoHardRoundPrevDab=null;_strokeReplayDabs.length=0;_inStroke=true;
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
    _frameDirty=saved.frameDirty;_strokeDirty=saved.strokeDirty;_texPendingRect=saved.texPending;_inStroke=saved.inStroke;_flowSpacingRatio=saved.flowSpacing;_isDrawingWithPen=saved.isPen;currentPressure=saved.currentPressure;_smoothedPressure=saved.smoothedPressure;_lastKnownPressure=saved.lastKnownPressure;_strokeFirstSample=saved.strokeFirstSample;_strokeDabCount=saved.strokeDabCount;_strokeDistSoFar=saved.strokeDist;_autoHardRoundPrevDab=saved.autoPrev;_rotationPrevValid=saved.rotationValid;_rotationPrevX=saved.rotationPrevX;_rotationPrevY=saved.rotationPrevY;_rotationDirection=saved.rotationDirection;_disposableDabPrewarm=saved.disposablePrewarm;
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
const _aaDabCache=new Map(); // key -> {canvas,w,h}
const _AA_DAB_CACHE_MAX=64;

// Standard Soft Round caches only its neutral shape; colour and alpha stay live.
const _softRoundMaskCache=new Map();
const _SOFT_ROUND_MASK_CACHE_MAX=64;
let _softRoundTintCanvas=null;
function _isStandardProceduralSoftRound(){
  return tool==='brush' && window._activeBrushPresetId==='soft-round' && !window._brushAirbrush && !window.brushTipCanvas;
}
function _buildSoftRoundMask(rRaw){
  const diameter=Math.max(1,Math.round(Math.max(0.05,rRaw)*2*4)/4);
  const radius=diameter/2;
  const hardness=Math.round(Math.max(0,Math.min(1,brushHardness))*1000)/1000;
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
function _drawSoftRoundMask(x,y,r,rgb,alpha,composite){
  const stamp=_buildSoftRoundMask(r);
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
  const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;
  dc.save();
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  dc.globalAlpha=Math.max(0,Math.min(1,alpha));
  dc.imageSmoothingEnabled=brushHardness<0.999;
  if(dc.imageSmoothingEnabled) dc.imageSmoothingQuality='high';
  dc.drawImage(tint,x-stamp.w/2,y-stamp.h/2);
  dc.restore();
}

//  Tip-shaped dab cache
// Mirrors _aaDabCache but for dabs whose shape comes from brushTipCanvas.
// Keyed on (r, rgb, alpha, composite, hardness, tipVersion, softAlpha, mode)
// so any tip change (new import, clear) busts every entry automatically.
const _tipDabCache=new Map();
const _TIP_DAB_CACHE_MAX=32;

// Build a stamp canvas pre-shaped by the current brushTipCanvas.
// Returns {canvas,w,h} Ã¢â‚¬â€ same contract as _buildAAStamp.
function _buildTipStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
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
  _brushDiagPerfNote('stamp-cache',{hit:!!hit});
  if(latencyProbe&&latencyProbe.enabled)latencyProbe.cache({key,hit:!!hit,sizeBeforeLookup:_tipDabCache.size});
  if(trace&&trace.enabled){trace.stage('custom-tip-cache-lookup',lookupStart,{tipId:trace.objectId(tipC),tipVersion:tipV,invalidationReason:hit?null:(_tipAlphaInvalidationReason||'stamp-key-miss')});trace.instant('stamp-cache-lookup',{hit:!!hit,key,scaleBucket:r.toFixed(2),rotationBucket:Math.round(_viewAdjustedTipRotation()*180/Math.PI),roundnessBucket:tipRoundness.toFixed(3)});}
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
  _brushDiagPerfNote('temp-canvas');
  const tc=tmp.getContext('2d',{willReadFrequently:true});

  const cr=composite==='erase'?0:rgb[0];
  const cg=composite==='erase'?0:rgb[1];
  const cb=composite==='erase'?0:rgb[2];

  // Rasterize the tip into a mask-only canvas. The source grayscale RGB
  // never enters the output stamp canvas; only the resolved mask alpha is
  // copied into a fresh brush-coloured ImageData buffer.
  const maskCanvas=document.createElement('canvas');
  _brushDiagPerfNote('temp-canvas');
  maskCanvas.width=w; maskCanvas.height=h;
  const maskCtx=maskCanvas.getContext('2d',{willReadFrequently:true});
  maskCtx.imageSmoothingEnabled=true;
  maskCtx.imageSmoothingQuality='high';
  const scaleStart=trace&&trace.enabled?performance.now():0;maskCtx.drawImage(tipC,0,0,tipNativeW,tipNativeH,(w-dabW)/2,(h-dabH)/2,dabW,dabH);
  if(trace&&trace.enabled)trace.stage('tip-scaling-resampling',scaleStart,{sourceWidth:tipNativeW,sourceHeight:tipNativeH,dabWidth:dabW,dabHeight:dabH,stampWidth:w,stampHeight:h,scaleBucket:r.toFixed(2)});
  _brushDiagPerfNote('get-image-data');
  const maskReadStart=trace&&trace.enabled?performance.now():0,maskData=maskCtx.getImageData(0,0,w,h).data;
  if(trace&&trace.enabled)trace.stage('get-image-data',maskReadStart,{source:'scaled-mask',width:w,height:h});

  let legacyAlphaOnlyMask=false;
  try{
    const sourceCtx=tipC.getContext('2d',{willReadFrequently:true});
    const sourceReadStart=performance.now();
    _brushDiagPerfNote('get-image-data');
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
  _brushDiagPerfNote('put-image-data');
  const outputCopyStart=trace&&trace.enabled?performance.now():0;tc.putImageData(output,0,0);
  if(trace&&trace.enabled)trace.stage('temporary-canvas-copy',outputCopyStart,{operation:'putImageData',width:w,height:h});

  const stamp={canvas:tmp,w,h};
  _brushDiagPerfNote('stamp-build');
  if(_tipDabCache.size>=_TIP_DAB_CACHE_MAX) _tipDabCache.delete(_tipDabCache.keys().next().value);
  _tipDabCache.set(key,stamp);
  if(latencyProbe&&latencyProbe.enabled){latencyProbe.renderer('custom-stamp',{effectiveRadius:r,stampWidth:w,stampHeight:h});latencyProbe.measure('buildTipStamp',latencyBuildStart);}
  if(trace&&trace.enabled)trace.stage('stamp-generation',generationStart,{key,stampWidth:w,stampHeight:h,scaleBucket:r.toFixed(2),rotationBucket:Math.round(_viewAdjustedTipRotation()*180/Math.PI)});
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
// stroke Ã¢â‚¬â€ it only fills in uncovered/lighter areas. This matches TVPaint's
// behavior where one slow stroke builds to solid coverage without dabs
// stacking and re-darkening the same spots (which required multiple strokes).
// Eraser and direct-to-activeC paths are unaffected.
function _strokeDabComposite(composite){
  if(composite==='erase') return 'destination-out';
  return 'source-over';
}
function _drawUnifiedTipStamp(x,y,r,rgb,alpha,composite){
  const trace=window.CustomFirstDabTrace,identityStart=trace&&trace.enabled?performance.now():0;
  const dc=(_inStroke && composite!=='erase')?_strokeCtx:ctx;
  if(trace&&trace.enabled)trace.stage('custom-tip-identity-lookup',identityStart,{tipId:trace.objectId(window.brushTipCanvas),tipVersion:window.brushTipVersion||0});
  const stamp=_buildTipStamp(r,rgb,alpha,composite,brushHardness);
  const transformStart=trace&&trace.enabled?performance.now():0;
  dc.save();
  dc.globalCompositeOperation=_strokeDabComposite(composite);
  dc.imageSmoothingEnabled=true;
  dc.translate(x,y);
  const adjustedRotation=_viewAdjustedTipRotation();
  if(adjustedRotation) dc.rotate(adjustedRotation);
  if(window.brushTipFlipX||window.brushTipFlipY) dc.scale(window.brushTipFlipX?-1:1,window.brushTipFlipY?-1:1);
  if(trace&&trace.enabled)trace.stage('transformed-tip-generation',transformStart,{rotation:adjustedRotation,rotationBucket:Math.round(adjustedRotation*180/Math.PI),stampWidth:stamp.w,stampHeight:stamp.h});
  const latencyDrawStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const blendStart=trace&&trace.enabled?performance.now():0;dc.drawImage(stamp.canvas,-stamp.w/2,-stamp.h/2);
  if(window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.measure('cachedStampDrawImage',latencyDrawStart);
  if(trace&&trace.enabled)trace.stage('blend-dab-into-stroke-canvas',blendStart,{operation:'drawImage',stampWidth:stamp.w,stampHeight:stamp.h});
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
  const isProceduralAirbrush=typeof window!=='undefined'&&!!window._brushAirbrush&&!window.brushTipCanvas;
  // Only procedural Airbrush uses the analytic cached mask. Ordinary round
  // brushes retain their original radial-gradient GPU renderer exactly.
  if(isProceduralAirbrush){
    const stamp=_buildAAStamp(r,rgb,alpha,composite,brushHardness);
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
// version, but it now matches the GPU
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
      let a=alpha*_proceduralBrushFalloff(t,brushHardness,rr,aaModeCpu,isAirbrush);
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
// Software fallback retained for internal diagnostics. Normal drawing always
// uses the Canvas 2D accelerated path below.
function _dabAATinyCoverage(x,y,r,rgb,alpha,composite){
  _brushDiagPerfNote('tiny');
  _hardRoundTraceLegacyDabDuringGpu(r);
  const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;
  const rr=Math.max(0.05,r),pad=1;
  const sx=Math.max(0,Math.floor(x-rr-pad)),sy=Math.max(0,Math.floor(y-rr-pad));
  const ex=Math.min(dc.canvas.width,Math.ceil(x+rr+pad)),ey=Math.min(dc.canvas.height,Math.ceil(y+rr+pad));
  const width=ex-sx,height=ey-sy;
  if(width<=0||height<=0) return;
  const _hrRtGidStart = window.HardRoundDebugRoutingTrace ? performance.now() : null;
  _brushDiagPerfNote('get-image-data');
  const image=dc.getImageData(sx,sy,width,height),data=image.data;
  if(_hrRtGidStart!=null) _hrRtNoteDabAATinyCoverage(performance.now()-_hrRtGidStart);
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
  _brushDiagPerfNote('put-image-data');
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
// Tiny custom-tip coverage is still evaluated dab-by-dab, pixel-for-pixel,
// in submission order. The only change is ownership of the destination
// ImageData: fixed-size tiles retain it until the existing frame-coalesced
// presentation boundary, amortizing Canvas2D synchronization across all
// tiny dabs that overlap the same tile in that frame.
const _TINY_TIP_TILE_SIZE=32;
const _tinyTipCoverageTiles=new Map();
let _tinyTipCoverageTileCtx=null;
function _tinyTipCoverageTileFor(dc,px,py){
  if(_tinyTipCoverageTileCtx&&_tinyTipCoverageTileCtx!==dc)_flushTinyTipCoverageTiles();
  _tinyTipCoverageTileCtx=dc;
  const tx=Math.floor(px/_TINY_TIP_TILE_SIZE)*_TINY_TIP_TILE_SIZE;
  const ty=Math.floor(py/_TINY_TIP_TILE_SIZE)*_TINY_TIP_TILE_SIZE;
  const key=tx+'|'+ty;
  let tile=_tinyTipCoverageTiles.get(key);
  if(!tile){
    const w=Math.min(_TINY_TIP_TILE_SIZE,dc.canvas.width-tx),h=Math.min(_TINY_TIP_TILE_SIZE,dc.canvas.height-ty);
    _brushDiagPerfNote('get-image-data');
    tile={x:tx,y:ty,w,h,image:dc.getImageData(tx,ty,w,h),dirty:false};
    _tinyTipCoverageTiles.set(key,tile);
  }
  return tile;
}
function _flushTinyTipCoverageTiles(){
  const brushDiagStart=window.BrushDebugPerf?performance.now():0;
  const dc=_tinyTipCoverageTileCtx;
  if(dc){
    for(const tile of _tinyTipCoverageTiles.values()){
      if(!tile.dirty)continue;
      _brushDiagPerfNote('put-image-data');
      dc.putImageData(tile.image,tile.x,tile.y);
    }
  }
  _tinyTipCoverageTiles.clear();
  _tinyTipCoverageTileCtx=null;
  if(brushDiagStart)_brushDiagPerfNote('processing',{ms:performance.now()-brushDiagStart});
}
function _dabTipTinyCoverageBatched(x,y,r,rgb,alpha,composite,tipInfo){
  const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;
  // Erasing and direct-to-artwork paths retain their established immediate
  // behavior; the normal custom-tip brush path owns a stroke scratch canvas.
  if(!_inStroke||composite==='erase'||dc!==_strokeCtx){_flushTinyTipCoverageTiles();return false;}
  const rr=Math.max(0.05,r),softAlpha=!!window.brushTipSoftAlpha,tipMode=window.brushTipMode||'multiply';
  const baseRoundness=(typeof _activeDabRoundness!=='undefined'&&_activeDabRoundness!=null)?_activeDabRoundness:(window.brushTipRoundness==null?1:window.brushTipRoundness);
  const tipRoundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,baseRoundness));
  const tipNativeW=tipInfo.w,tipNativeH=tipInfo.h,tipScale=(2*rr)/Math.max(tipNativeW,tipNativeH),compressWidth=tipNativeW<tipNativeH;
  const dabW=Math.max(0.02,tipNativeW*tipScale*(compressWidth?tipRoundness:1));
  const dabH=Math.max(0.02,tipNativeH*tipScale*(compressWidth?1:tipRoundness));
  const semiW=dabW/2,semiH=dabH/2,rotation=_viewAdjustedTipRotation(),cosR=Math.cos(-rotation),sinR=Math.sin(-rotation);
  const flipXsign=window.brushTipFlipX?-1:1,flipYsign=window.brushTipFlipY?-1:1,pad=1,halfSpan=Math.max(semiW,semiH)+pad;
  const sx=Math.max(0,Math.floor(x-halfSpan)),sy=Math.max(0,Math.floor(y-halfSpan));
  const ex=Math.min(dc.canvas.width,Math.ceil(x+halfSpan)),ey=Math.min(dc.canvas.height,Math.ceil(y+halfSpan));
  if(ex<=sx||ey<=sy)return true;
  const applyFalloff=softAlpha&&tipMode!=='replace';
  const inner=applyFalloff?_effectiveInnerFrac(rr,brushHardness,_currentAAMode()):1;
  const samples=4,invSamples=1/(samples*samples),cr=composite==='erase'?0:rgb[0],cg=composite==='erase'?0:rgb[1],cb=composite==='erase'?0:rgb[2],tipBuf=tipInfo.data;
  for(let py=sy;py<ey;py++)for(let px=sx;px<ex;px++){
    let coverage=0;
    for(let sampleY=0;sampleY<samples;sampleY++)for(let sampleX=0;sampleX<samples;sampleX++){
      const wx=px+(sampleX+0.5)/samples,wy=py+(sampleY+0.5)/samples;let rx=wx-x,ry=wy-y;
      if(rotation){const rrx=rx*cosR-ry*sinR,rry=rx*sinR+ry*cosR;rx=rrx;ry=rry;}
      rx*=flipXsign;ry*=flipYsign;
      const tipA=_sampleTipAlphaBilinear(tipBuf,tipNativeW,tipNativeH,(rx/dabW+0.5)*tipNativeW,(ry/dabH+0.5)*tipNativeH);
      if(tipA<=0)continue;
      coverage+=applyFalloff?tipA*_roundBrushFalloff(Math.sqrt((rx/Math.max(0.02,semiW))**2+(ry/Math.max(0.02,semiH))**2),inner,brushHardness):tipA;
    }
    const sourceAlpha=Math.max(0,Math.min(1,alpha*coverage*invSamples));if(sourceAlpha<=0)continue;
    const tile=_tinyTipCoverageTileFor(dc,px,py),offset=((py-tile.y)*tile.w+(px-tile.x))*4,data=tile.image.data;
    const destinationAlpha=data[offset+3]/255,outputAlpha=sourceAlpha+destinationAlpha*(1-sourceAlpha);
    data[offset]=(cr*sourceAlpha+data[offset]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
    data[offset+1]=(cg*sourceAlpha+data[offset+1]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
    data[offset+2]=(cb*sourceAlpha+data[offset+2]*destinationAlpha*(1-sourceAlpha))/outputAlpha;
    data[offset+3]=outputAlpha*255;tile.dirty=true;
  }
  return true;
}
function _dabTipTinyCoverage(x,y,r,rgb,alpha,composite){
  _brushDiagPerfNote('tiny');
  if(window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled)window.FirstDabLatencyProbe.renderer('tiny-custom-tip',{effectiveRadius:r});
  const tipInfo=_getTipAlphaBuffer();
  if(!tipInfo){_flushTinyTipCoverageTiles();_dabAATinyCoverage(x,y,r,rgb,alpha,composite);return;}
  if(_dabTipTinyCoverageBatched(x,y,r,rgb,alpha,composite,tipInfo))return;
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
  _brushDiagPerfNote('get-image-data');
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
  _brushDiagPerfNote('put-image-data');
  dc.putImageData(image,sx,sy);
}
function _dabAA(x,y,r,rgb,alpha,composite){
  // AA mode 'none' is fully pixel-snapped/binary (Requirement 2), so it uses
  // the exact same aliased/quantized stamp path as the legacy AA-off toggle
  // -- no partial-alpha edge pixels at all, regardless of hardness.
  if(_currentAAMode()==='none'){_dabAliased(x,y,r,rgb,alpha,composite);return;}
  const tinyGeneratedHardRound=r<=1&&!window._brushAirbrush&&!window.brushTipCanvas&&brushHardness>=0.995;
  if(tinyGeneratedHardRound){
    // Phase 11B.16 causal test only: use the existing accelerated AA
    // renderer instead of the analytic CPU read/modify/write path while a
    // migrated GPU stroke is still active. Default-off preserves the exact
    // tiny-coverage appearance and return contract.
    if(_hardRoundShouldBypassTinyCoverageDuringGpu()){
      _dabAAGpu(x,y,r,rgb,alpha,composite);
      return;
    }
    _dabAATinyCoverage(x,y,r,rgb,alpha,composite);return;
  }
  // Same cutoff (r<=1) as Hard Round above, so custom tips remain visible
  // down to approximately the same minimum size Hard Round hits, via the
  // same class of genuine supersampled-coverage rendering.
  const tinyTipDab=r<=1&&!window._brushAirbrush&&!!window.brushTipCanvas;
  if(tinyTipDab){_dabTipTinyCoverage(x,y,r,rgb,alpha,composite);return;}
  // A stroke may cross the 1px threshold as pressure changes. Make all
  // earlier tiny dabs visible before a normal Canvas2D stamp overlaps them.
  _flushTinyTipCoverageTiles();
  _brushDiagPerfNote('normal');
  if(_isStandardProceduralSoftRound()){
    _drawSoftRoundMask(x,y,r,rgb,alpha,composite);
    return;
  }
  _dabAAGpu(x,y,r,rgb,alpha,composite);
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
}

function _shouldRunCustomTipGpuDiagnostic() {
  return typeof window !== 'undefined' && (
    !!window.CustomBrushDebugGpuTipRenderer ||
    !!window.CustomBrushDebugGpuTipPreview ||
    !!window.CustomBrushDebugGpuPresenter
  );
}

function _emitResolvedCustomTipDab(d, options = {}) {
  if (!window.brushTipCanvas) return;
  if (window.CustomBrushDebugResolvedDabs) {
    if (!window._resolvedCustomTipDabLog) window._resolvedCustomTipDabLog = [];
    window._resolvedCustomTipDabLog.push({
      strokeId: _activeStrokeSession || 1,
      isTaperReplay: !!options.isTaperReplay,
      x: d.x,
      y: d.y,
      r: d.r,
      alpha: d.alpha,
      rgb: d.rgb ? d.rgb.slice() : null,
      composite: d.composite,
      rotation: d.rotation || 0,
      roundness: d.roundness != null ? d.roundness : (window.brushTipRoundness == null ? 1 : window.brushTipRoundness),
      tipVersion: window.brushTipVersion || 0
    });
  }
  if (window._customTipRenderer && typeof window._customTipRenderer.onResolvedDab === 'function') {
    window._customTipRenderer.onResolvedDab(d, options);
  }
  if (_shouldRunCustomTipGpuDiagnostic() && window._customTipGpuRenderer && typeof window._customTipGpuRenderer.onResolvedDab === 'function') {
    window._customTipGpuRenderer.onResolvedDab(d, options);
  }
}

function _dabDirtyRadii(d){
  let x=d.r,y=d.r;
  if(window.brushTipCanvas){
    const tipW=window.brushTipCanvas.width||1,tipH=window.brushTipCanvas.height||1;
    const reference=Math.max(tipW,tipH);
    const roundness=Math.max(window.brushTipMinimumRoundness||0,Math.min(1,_activeDabRoundness==null?(window.brushTipRoundness==null?1:window.brushTipRoundness):_activeDabRoundness));
    const compressWidth=tipW<tipH;
    const width=tipW*((d.r*2)/reference)*(compressWidth?roundness:1);
    const height=tipH*((d.r*2)/reference)*(compressWidth?1:roundness);
    const cosine=Math.abs(Math.cos(_activeDabRotation)),sine=Math.abs(Math.sin(_activeDabRotation));
    x=(width*cosine+height*sine)/2;
    y=(width*sine+height*cosine)/2;
  }
  return {x,y};
}
function _drawDabNow(d){
  const brushDiagStart=window.BrushDebugPerf?performance.now():0;
  _brushDiagPerfNote('canvas-draw');
  if (window.CustomBrushDebugResolvedDabs && window.brushTipCanvas) {
    window._resolvedCustomTipDrawDabNowCount = (window._resolvedCustomTipDrawDabNowCount || 0) + 1;
  }
  if(window.HardRoundDebugRoutingTrace) _hrRtNoteDrawDabNow();
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
  if(!_drawAutoHardRoundSegment(d)){
    if(_currentAAMode()!=='none') _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
    else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  }
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
  if(brushDiagStart)_brushDiagPerfNote('processing',{ms:performance.now()-brushDiagStart});
}
function _taperDistance(amount){return 320*amount;}
function _queueDab(d){
  _brushDiagPerfNote('resolved',{radius:d.r});
  if (window.brushTipCanvas) {
    _emitResolvedCustomTipDab(d, { isTaperReplay: false });
  }
  if(!_replayingTaper&&(_getStartTaper()>0||_getEndTaper()>0)) _strokeReplayDabs.push(Object.assign({},d,{rgb:d.rgb.slice()}));
  _drawDabNow(d);
}
function _flushStrokeTail(){
  _flushTinyTipCoverageTiles();
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
    const replayedDab=Object.assign({},d,{r:Math.max(0.05,d.r*factors[i])});
    if (window.brushTipCanvas) {
      _emitResolvedCustomTipDab(replayedDab, { isTaperReplay: true });
    }
    _drawDabNow(replayedDab);
  }
  _replayingTaper=false;
  _autoHardRoundPrevDab=null;
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

  // Phase 11A.30: routine [stabilizer debug] console spam (unrelated to
  // this investigation, left over from earlier stabilizer work) removed.

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
function _emitHardRoundStabilizedPoint(x,y,pressure,ev,timeStamp,eventType){
  if(!_hardRoundCore) return;
  _hardRoundCore.updateSettings({brushSize:getBrushSize(),stabilization:0,zoom});
  const sample={
    x,y,
    pressure,
    pointerType:ev?ev.pointerType:'pen',
    timeStamp:Number.isFinite(timeStamp)?timeStamp:performance.now()
  };
  const segments=_hardRoundCore.pushSamples([sample]);
  _hardRoundStampSegments(segments,ev||_lastPointerEvent);
  lx=x;ly=y;currentPressure=pressure;if(ev)_lastPointerEvent=ev;

  if(window.BrushDebugStabilizerParity){
    if(!window._stabilizerParityLog)window._stabilizerParityLog=[];
    window._stabilizerParityLog.push({
      eventType,
      rawX:_stabilizerRawX,
      rawY:_stabilizerRawY,
      stabilizedX:_stabilizerX,
      stabilizedY:_stabilizerY,
      gpuInputX:x,
      gpuInputY:y,
      distanceToTarget:Math.hypot(_stabilizerTargetX-_stabilizerX,_stabilizerTargetY-_stabilizerY),
      catchupActive:_stabilizerCatchupActive,
      pointerHeld:drawing&&!_stabilizerFinishing,
      finalizing:_stabilizerFinishing,
      time:performance.now()
    });
    if(window._stabilizerParityLog.length>200){
      window._stabilizerParityLog.splice(0,window._stabilizerParityLog.length-200);
    }
  }
}

function _stabilizerEmit(x,y,now){
  _updateVelocity(x,y,now);
  if(window._brushAirbrush&&Math.hypot(x-lx,y-ly)>0.01)_airbrushLastMovementTime=performance.now();
  const e=_stabilizerEvent||_lastPointerEvent;
  if(_hardRoundStrokeActive && _hardRoundCore){
    const eventType=_stabilizerFinishing?'finish-catchup':'idle-catchup';
    _emitHardRoundStabilizedPoint(x,y,_stabilizerSmoothedPressure,e,now,eventType);
  }else{
    _curveAddPoint(x,y,_stabilizerSmoothedPressure,e);
    _baselineConditionerSync(_baselineSampleFromStabilizedPoint(e,{x,y,pressure:_stabilizerSmoothedPressure},now));
    lx=x;ly=y;currentPressure=_stabilizerSmoothedPressure;
    _scheduleRecomposite();
  }
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
    _brushDiagPerfNote('spacing',{step});
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
  _autoHardRoundPrevDab=null;
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
    _flushTinyTipCoverageTiles();
    const rect=(drawing||_inStroke)?_consumeDirtyRect():null;
    if(perf)perf.point('first-dab-immediate-recomposite',{mode:firstDabExperiment?firstDabExperiment.mode:experiment.mode,rect,scheduledWork});
    const immediateStart=performance.now();_flushLiveColorEraserPreview();recomposite(curLayer,curFrame,rect);const immediateDuration=performance.now()-immediateStart;
    _hrMtRecord('_scheduleRecomposite-immediate-recomposite', immediateStart, immediateStart+immediateDuration);
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
    _flushTinyTipCoverageTiles();
    const rect=(drawing||_inStroke)?_consumeDirtyRect():null;
    const scheduledStart=performance.now();_flushLiveColorEraserPreview();recomposite(layerIndex,frameIndex,rect);const scheduledDuration=performance.now()-scheduledStart;
    _hrMtRecord('_scheduleRecomposite-scheduled-recomposite', scheduledStart, scheduledStart+scheduledDuration);
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
  _autoHardRoundPrevDab=null;
  if(drawing){
    drawing=false;
    // Phase 8C/9C: an eligible Hard Round stroke has no legacy tail to
    // flush. Discard PrototypeStrokeCore's buffered state AND
    // PrototypeRenderer's in-progress backing-store accumulation for this
    // aborted stroke, so cancelling here guarantees nothing from this
    // stroke is ever committed.
    //
    // Phase 9D fix: the paragraph above stopped being true the moment
    // Phase 9C.1 added the RAF-coalesced live preview -- that preview
    // writes the in-progress stroke's pixels into _strokeCanvas/_strokeCtx
    // *while still drawing*, the same scratch surface _commitStrokeCanvas()
    // below reads from. So by the time a cancellation reaches this branch,
    // _strokeCanvas usually already holds partial live-preview pixels from
    // this now-aborted stroke, and the unconditional _commitStrokeCanvas()
    // a few lines down would paint them onto the active layer -- silently
    // committing a stroke that was supposed to be fully discarded. Clearing
    // _strokeCanvas/_strokeCtx here (mirroring how the line/curve-tool
    // cancel branch just below already clears its own preview surface on
    // abort) and skipping the commit call restores the guarantee the
    // comment above actually promises.
    let _hardRoundStrokeWasCancelled = false;
    if(_hardRoundStrokeActive && _hardRoundCore){
      _hardRoundCore.cancelStroke();
      if(_hardRoundRenderer) _hardRoundRenderer.cancelStroke();
      // Phase 9C.1 perf fix: also drop any RAF-scheduled live preview for
      // this stroke -- otherwise it could fire after cancelStroke() has
      // already reset the renderer's backing store, resolving/painting
      // stale or empty data into _strokeCtx for a stroke that no longer
      // exists.
      _hardRoundCancelLivePreview();
      _clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);
      _hardRoundStrokeWasCancelled = true;
    }
    else { _flushStrokeTail(); }
    if(_inStroke){_inStroke=false;if(!_hardRoundStrokeWasCancelled)_commitStrokeCanvas();}_restoreSelectionScopePixels();_cleanupErasedSmartOwnership();saveActiveToKey();
  }
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

// Phase 9E.5: stateless prototype-equivalent pressure read for the migrated
// Hard Round path ONLY. Ported exactly from prototype/prototype.html's
// `getPressure(e)` -- clamp/normalize the raw hardware sample and nothing
// else. Deliberately does NOT hold last-known-value on a 0 reading and does
// NOT rate-limit sample-to-sample change (see _getPressure below, which does
// both): PrototypeStrokeCore already has its own, faithfully-ported
// release-artifact handling (CONTACT_PRESSURE_FLOOR / isReleaseTailSample /
// pushPressureBuf moving average) that is designed to run on the true raw
// signal. Feeding it through _getPressure's legacy hold+clamp first was
// hiding the real near-zero release samples that classifier depends on, and
// stacking an extra unrelated smoothing pass on top of the core's own.
// Do not use this for any non-Hard-Round path -- those still need
// _getPressure's legacy behavior.
function _getPrototypePressure(e){
  if(e.pointerType === 'pen' && typeof e.pressure === 'number')
    return Math.max(0, Math.min(1, e.pressure));
  if(e.pointerType === 'mouse') return 1;
  return typeof e.pressure === 'number' ? Math.max(0, Math.min(1, e.pressure)) : 1;
}

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
  // Phase 8C (completed): migrated Hard Round strokes no longer flow
  // through _stampDab/_getEffectiveBrushParams for radius at all -- they
  // render as continuous capsules with their own r0/r1 (see
  // _hardRoundStampSegments / HardRoundCapsuleRenderer). This function is
  // still called once per segment endpoint purely to reuse the existing
  // Flow/Opacity alpha pipeline (its `r` output is discarded by the
  // caller in that case), so no override switch is needed here any more.
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

// ---------------------------------------------------------------------
// Phase 8C — Hard Round -> PrototypeStrokeCore integration
//
// Scope: brush tool, pen input, Hard Round only (see _hardRoundEligibleNow
// below for the exact procedural condition, §9). Everything else (Soft
// Round, custom tips, texture, scatter, eraser, mouse strokes) keeps using
// the legacy pointerdown/_handleMoveEvent/_pointerEndStroke pipeline above,
// completely unmodified.
//
// Integration boundary (Phase 9C):
//   pointer/coalesced input -> PrototypeStrokeCore -> resolved segments
//   -> HardRoundAdapter.resolveSegmentRenderParams() -> PrototypeRenderer
//   .drawSegments() (its own true SS=4 backing-store accumulation) -- NOT
//   `_stampDab()`, and (as of Phase 9C) no longer the per-segment
//   HardRoundCapsuleRenderer/HardRoundCapsuleGPU draw calls Phase 8C used
//   either. Color/composite/hardness/AA-mode are still resolved the normal
//   way and passed through unchanged; only the rendering backend changed.
//   At stroke end, PrototypeRenderer.endStroke() resolves its backing store
//   to one finished logical-resolution canvas, which is drawn into the
//   existing `_strokeCanvas`/`_strokeCtx` scratch surface so the existing
//   `_commitStrokeCanvas()` commit/persistence path is reused unmodified.
//   See hard-round-adapter.js, prototype-renderer.js.
//
// HardRoundCapsuleRenderer/HardRoundCapsuleGPU (hard-round-capsule-
// renderer.js / hard-round-capsule-gpu.js) are left in place, unmodified,
// per the "do not remove legacy code yet" scope -- they are simply no
// longer called from this migrated path.
// ---------------------------------------------------------------------

let _hardRoundCore = null;          // single PrototypeStrokeCore instance, reused across strokes
let _hardRoundStrokeActive = false; // decided once at pointerdown, for the life of that stroke only

function _hardRoundGetCore(){
  if(!_hardRoundCore && typeof window!=='undefined' && window.PrototypeStrokeCore){
    _hardRoundCore = new window.PrototypeStrokeCore();
  }
  return _hardRoundCore;
}

// Phase 9C: single reused PrototypeRenderer instance, sized to match the
// live scratch stroke canvas (activeC.width/height -- the same logical
// resolution _ensureStrokeCanvas already allocates _strokeCanvas at).
// Recreated whenever that size changes (canvas resize), exactly like
// _ensureStrokeCanvas's own allocatedOrResized check.
let _hardRoundRenderer = null;
let _hardRoundActiveContext = null;
const _hardRoundRendererPool = [];
const _hardRoundFinishingContexts = new Map();
let _hardRoundCommitTail = Promise.resolve();
let _hardRoundPendingCommitCount = 0;
if(typeof window.HardRoundDebugRapidPresentation==='undefined')window.HardRoundDebugRapidPresentation=false;
const _hardRoundRapidPresentationLog=[];
function _hrRapidPresentation(event,strokeId,extra){
  if(!window.HardRoundDebugRapidPresentation)return;
  const overlay=_hardRoundGpuOverlay();
  _hardRoundRapidPresentationLog.push(Object.assign({time:performance.now(),event,strokeId:strokeId==null?_activeStrokeSession:strokeId,
    activeSession:_activeStrokeSession,overlayOwner:window.HardRoundOverlayOwnerStrokeId==null?null:window.HardRoundOverlayOwnerStrokeId,
    overlayPresentedStrokeId:window.HardRoundOverlayPresentedStrokeId==null?null:window.HardRoundOverlayPresentedStrokeId,
    overlayVisible:!!(overlay&&!overlay.hidden&&overlay.style.display!=='none'),pendingCommitCount:_hardRoundPendingCommitCount},extra||{}));
  if(_hardRoundRapidPresentationLog.length>200)_hardRoundRapidPresentationLog.splice(0,_hardRoundRapidPresentationLog.length-200);
}
window.HardRoundAnalyzeRapidPresentation=function(){
  const log=_hardRoundRapidPresentationLog.slice(),byStroke={};
  log.forEach(entry=>{const key=entry.strokeId==null?'none':String(entry.strokeId),bucket=byStroke[key]||(byStroke[key]={commitStarted:0,readbackCompleted:0,commitCompleted:0,recompositeCompleted:0,finalizerCompleted:0});if(Object.prototype.hasOwnProperty.call(bucket,entry.event))bucket[entry.event]++;});
  const incomplete=Object.entries(byStroke).filter(([,v])=>v.commitStarted!==v.commitCompleted||v.commitCompleted!==v.finalizerCompleted).map(([strokeId,counts])=>({strokeId,counts}));
  return {count:log.length,byStroke,incompleteStrokeCount:incomplete.length,incomplete,log};
};
window.BrushAnalyzeStabilizerParity=function(){
  const log = (window._stabilizerParityLog || []).slice();
  return {
    enabled: !!window.BrushDebugStabilizerParity,
    count: log.length,
    log
  };
};
// Phase 10.1: raw pen input can arrive near 1000Hz. Core stabilization and
// adapter mapping still run for every event immediately, but render-ready
// segments wait for the next presentation frame and are then submitted in
// their original order. PrototypeRenderer.drawSegments already performs a
// sequential max-blend loop, so one array call is mathematically identical
// to N one-segment calls while avoiding N synchronous raster stalls in the
// input handler.
const _hardRoundPendingRenderSegments = [];
// Phase 11A.30: single master flag for this diagnostic phase. Default
// false = no routine Phase 11A.30 console logging. When true, only the
// concise [11A.30] ... results are printed (see _pointerEndStroke and
// _hardRoundPresentLivePreview below). This replaces the now-removed,
// completed Phase 11A.29 experiment flag
// (window.HardRoundDebugSkipPointerUpPendingFlush) -- see item 8/§8 of the
// Phase 11A.30 plan: that causality experiment concluded (skip=false and
// skip=true both reproduced the bug), so its flag, special pointerup
// behavior, and window.HardRoundLastSkippedPointerUpFlush have all been
// removed; normal pointerup pending-flush behavior is restored exactly as
// it was before that experiment.
if(typeof window!=='undefined' && window.HardRoundDebugPhase11A30===undefined){
  window.HardRoundDebugPhase11A30 = false;
}
// Phase 11A.32: causal test only. When true AND the active Hard Round
// renderer is GPU-active, pointerup skips _hardRoundPresentFinishedFrame()
// entirely (no peekStroke()/gpu.present() of the flushed catch-up
// segments, no two-RAF wait) and goes straight from the normal pending
// flush to renderer.endStroke({readback:true}) and the existing commit
// path. This is expected to reintroduce the old pointerup blink -- that is
// the whole point of the experiment, and is deliberately NOT compensated
// for here. Does NOT touch the CPU path (the CPU branch never reaches this
// bypass -- see the gpuCommit guard at the call site below), pending-
// segment semantics, finishStroke, pressure, stabilization, AA, shaders,
// opacity, or commit. Default false.
if(typeof window!=='undefined' && window.HardRoundDebugBypassFinishedGpuPreview===undefined){
  window.HardRoundDebugBypassFinishedGpuPreview = false;
}
// Gates the single [11A.32 BYPASS RESULT] console line below. Default
// false -- no routine console output even while the bypass itself is
// active, unless explicitly opted into.
if(typeof window!=='undefined' && window.HardRoundDebugPhase11A32===undefined){
  window.HardRoundDebugPhase11A32 = false;
}
// Phase 11A.33: causal test only. When true AND the active Hard Round
// renderer is GPU-active, the normal endStroke/_commitStrokeCanvas/
// saveActiveToKey/recomposite sequence at pointerup runs completely
// unchanged -- only the #hard-round-gpu-overlay hide step (normally the
// very next line after endStroke resolves) is suppressed, so the last GPU
// overlay frame stays visible on top of the freshly committed layer.
// Default false.
if(typeof window!=='undefined' && window.HardRoundDebugKeepGpuOverlayAfterCommit===undefined){
  window.HardRoundDebugKeepGpuOverlayAfterCommit = false;
}
// Gates the single [11A.33 HANDOFF] console line. Default false.
if(typeof window!=='undefined' && window.HardRoundDebugPhase11A33===undefined){
  window.HardRoundDebugPhase11A33 = false;
}
// Phase 11A.33: read-only geometry snapshot for the surfaces involved in
// the WebGPU-overlay -> Canvas2D handoff, for the "ALSO RECORD DOM/CANVAS
// GEOMETRY" deliverable. Never called automatically; call
// window.HardRoundDebugHandoffGeometry() from the console during Test A or
// Test B. Purely diagnostic -- reads DOM/canvas state, mutates nothing.
// NOTE: `activeC` is defined elsewhere (not in this file) and is used
// as-is. This module does not define or know the id of a separate
// "display canvas" if one exists distinctly from activeC -- pass it in
// explicitly (displayCanvasEl) if the app has one, otherwise that field
// reports null rather than guessing at an id.
if(typeof window!=='undefined'){
  window.HardRoundDebugHandoffGeometry = function(displayCanvasEl){
    const report=(el)=>{
      if(!el) return null;
      const rect=el.getBoundingClientRect();
      const cs=typeof getComputedStyle==='function'?getComputedStyle(el):null;
      return {
        canvasWidth: el.width, canvasHeight: el.height,
        rectWidth: rect.width, rectHeight: rect.height,
        styleTransform: el.style && el.style.transform,
        styleImageRendering: el.style && el.style.imageRendering,
        styleOpacity: el.style && el.style.opacity,
        computedTransform: cs && cs.transform,
        computedImageRendering: cs && cs.imageRendering,
        computedOpacity: cs && cs.opacity,
      };
    };
    return {
      devicePixelRatio: typeof window!=='undefined'?window.devicePixelRatio:null,
      overlay: report(typeof document!=='undefined'?document.getElementById('hard-round-gpu-overlay'):null),
      activeCanvas: typeof activeC!=='undefined'?report(activeC):null,
      displayCanvas: displayCanvasEl?report(displayCanvasEl):null,
    };
  };
}
// ---------------------------------------------------------------------
// PHASE 11B.13 DIAGNOSTIC (opt-in via window.HardRoundDebugFrameStall,
// default off/no-op). Read-only, timestamp/counter-only instrumentation.
// Goal: determine whether the live-stroke blink/cut correlates with a
// main-thread/frame stall rather than missing stroke geometry.
//
// Deliberately does NOT call getImageData, any GPU readback, canvas
// capture, getComputedStyle, or elementFromPoint -- see call sites below.
// Never touches geometry, pressure, stabilization, AA, shaders,
// strokeMaskTex, presentation, commit/finalization, or overlay visibility.
//
// Log is bounded to ~200 lightweight records (oldest dropped first).
// Cheap running aggregates (counters/maxes) are always updated so
// summary stats stay accurate even once individual records roll off.
// ---------------------------------------------------------------------
window.HardRoundFrameStallLog = window.HardRoundFrameStallLog || [];
const _hrFsAgg = {
  frames: 0,
  maxRafDeltaMs: 0,
  countRafOver20ms: 0,
  countRafOver33ms: 0,
  countRafOver50ms: 0,
  countRafOver100ms: 0,
  maxFlushPendingMs: 0,
  maxDrawSegmentsMs: 0,
  maxPresentPromiseMs: 0,
  maxInputEventGapMs: 0,
};
const _HR_FS_MAX_LOG = 200;
const _HR_FS_STALL_THRESHOLD_MS = 20; // only individually log windows >= this
function _hrFsPush(entry){
  window.HardRoundFrameStallLog.push(entry);
  if(window.HardRoundFrameStallLog.length > _HR_FS_MAX_LOG) window.HardRoundFrameStallLog.shift();
}
function _hrFsCursorSnapshot(e){
  // Cheap only: no getComputedStyle, no elementFromPoint, no layout forcing.
  let hasCapture = null;
  try{ hasCapture = (e && typeof e.pointerId==='number' && activeC && activeC.hasPointerCapture) ? activeC.hasPointerCapture(e.pointerId) : null; }catch(_){}
  return {
    eventTarget: (e && e.target && (e.target.id || e.target.tagName)) || null,
    pointerId: (e && e.pointerId!=null) ? e.pointerId : null,
    pointerCapture: hasCapture,
    cursor: (typeof activeC!=='undefined' && activeC && activeC.style) ? activeC.style.cursor : null,
  };
}
function _hrFsCounts(){
  return {
    pendingSegmentCount: (typeof _hardRoundPendingRenderSegments!=='undefined' && _hardRoundPendingRenderSegments) ? _hardRoundPendingRenderSegments.length : null,
    rendererSegmentCount: (typeof _hardRoundRenderer!=='undefined' && _hardRoundRenderer) ? _hardRoundRenderer._segmentCount : null,
  };
}
function _hrFsStrokeId(){
  return typeof _activeStrokeSession!=='undefined' ? _activeStrokeSession : null;
}
function _hrFsActive(){
  return !!(window.HardRoundDebugFrameStall && typeof _inStroke!=='undefined' && _inStroke);
}
// -- rAF delta tracking: a persistent, self-perpetuating rAF loop. It is
// always scheduled (negligible cost when the flag is off) but only records
// anything while HardRoundDebugFrameStall is on AND a stroke is active.
let _hrFsLastRafT = null;
function _hrFsRafTick(t){
  if(_hrFsActive()){
    if(_hrFsLastRafT!=null){
      const delta = t - _hrFsLastRafT;
      _hrFsAgg.frames++;
      if(delta > _hrFsAgg.maxRafDeltaMs) _hrFsAgg.maxRafDeltaMs = delta;
      if(delta > 20) _hrFsAgg.countRafOver20ms++;
      if(delta > 33) _hrFsAgg.countRafOver33ms++;
      if(delta > 50) _hrFsAgg.countRafOver50ms++;
      if(delta > 100) _hrFsAgg.countRafOver100ms++;
      if(delta >= _HR_FS_STALL_THRESHOLD_MS){
        _hrFsPush(Object.assign({type:'raf', timestamp:t, strokeId:_hrFsStrokeId(), rafDeltaMs:delta}, _hrFsCounts(), _hrFsCursorSnapshot(_lastPointerEvent)));
      }
    }
    _hrFsLastRafT = t;
  } else {
    _hrFsLastRafT = null;
  }
  requestAnimationFrame(_hrFsRafTick);
}
requestAnimationFrame(_hrFsRafTick);
// -- input event gap tracking. Call from pointerdown/pointermove/
// pointerrawupdate handlers. Cheap: only performance.now() + the same
// no-layout cursor snapshot above.
let _hrFsLastInputT = null;
function _hrFsRecordInput(eventType, e){
  if(!_hrFsActive()) return;
  const t = performance.now();
  let gap = null;
  if(_hrFsLastInputT!=null) gap = t - _hrFsLastInputT;
  _hrFsLastInputT = t;
  if(gap!=null){
    if(gap > _hrFsAgg.maxInputEventGapMs) _hrFsAgg.maxInputEventGapMs = gap;
    if(gap >= _HR_FS_STALL_THRESHOLD_MS){
      _hrFsPush(Object.assign({type:'input', timestamp:t, strokeId:_hrFsStrokeId(), inputGapMs:gap, eventType}, _hrFsCounts(), _hrFsCursorSnapshot(e)));
    }
  }
}
// -- schedule/flush/present timing hooks. Populated by call sites in
// _hardRoundSchedulePreviewFrame / _hardRoundFlushPending /
// _hardRoundPresentLivePreview below.
function _hrFsRecordSchedule(){
  if(!_hrFsActive()) return;
  _hrFsPush(Object.assign({type:'schedulePreviewFrame', timestamp:performance.now(), strokeId:_hrFsStrokeId()}, _hrFsCounts()));
}
function _hrFsRecordPreviewRafStart(){
  if(!_hrFsActive()) return;
  _hrFsPush(Object.assign({type:'previewRafStart', timestamp:performance.now(), strokeId:_hrFsStrokeId()}, _hrFsCounts()));
}
function _hrFsRecordFlushPending(durationMs, drawSegmentsMs, dispatchedCount){
  if(!_hrFsActive()) return;
  if(durationMs > _hrFsAgg.maxFlushPendingMs) _hrFsAgg.maxFlushPendingMs = durationMs;
  if(drawSegmentsMs!=null && drawSegmentsMs > _hrFsAgg.maxDrawSegmentsMs) _hrFsAgg.maxDrawSegmentsMs = drawSegmentsMs;
  if(durationMs >= _HR_FS_STALL_THRESHOLD_MS || (drawSegmentsMs!=null && drawSegmentsMs >= _HR_FS_STALL_THRESHOLD_MS)){
    _hrFsPush(Object.assign({type:'flushPending', timestamp:performance.now(), strokeId:_hrFsStrokeId(), flushPendingMs:durationMs, drawSegmentsMs, dispatchedCount}, _hrFsCounts(), _hrFsCursorSnapshot(_lastPointerEvent)));
  }
}
function _hrFsRecordPresentStart(){
  if(!_hrFsActive()) return null;
  const t = performance.now();
  _hrFsPush(Object.assign({type:'presentLivePreviewStart', timestamp:t, strokeId:_hrFsStrokeId()}, _hrFsCounts()));
  return t;
}
function _hrFsRecordPresentResolve(startT){
  if(!_hrFsActive() || startT==null) return;
  const t = performance.now();
  const dur = t - startT;
  if(dur > _hrFsAgg.maxPresentPromiseMs) _hrFsAgg.maxPresentPromiseMs = dur;
  if(dur >= _HR_FS_STALL_THRESHOLD_MS){
    _hrFsPush(Object.assign({type:'presentLivePreviewResolve', timestamp:t, strokeId:_hrFsStrokeId(), presentPromiseMs:dur}, _hrFsCounts(), _hrFsCursorSnapshot(_lastPointerEvent)));
  }
}
window.HardRoundAnalyzeFrameStalls = function(){
  const log = window.HardRoundFrameStallLog.slice();
  const scored = log.map(r => ({
    r,
    score: Math.max(r.rafDeltaMs||0, r.inputGapMs||0, r.flushPendingMs||0, r.drawSegmentsMs||0, r.presentPromiseMs||0),
  })).sort((a,b) => b.score - a.score).slice(0, 10);
  const worst = scored.map(({r}) => ({
    timestamp: r.timestamp,
    strokeId: r.strokeId,
    rafDeltaMs: r.rafDeltaMs!=null ? r.rafDeltaMs : null,
    inputGapMs: r.inputGapMs!=null ? r.inputGapMs : null,
    flushPendingMs: r.flushPendingMs!=null ? r.flushPendingMs : null,
    drawSegmentsMs: r.drawSegmentsMs!=null ? r.drawSegmentsMs : null,
    presentPromiseMs: r.presentPromiseMs!=null ? r.presentPromiseMs : null,
    pendingSegmentCount: r.pendingSegmentCount!=null ? r.pendingSegmentCount : null,
    rendererSegmentCount: r.rendererSegmentCount!=null ? r.rendererSegmentCount : null,
    pointerCapture: r.pointerCapture!=null ? r.pointerCapture : null,
    cursor: r.cursor!=null ? r.cursor : null,
  }));
  const summary = Object.assign({}, _hrFsAgg, {totalActiveStrokeRafFrames: _hrFsAgg.frames});
  const out = {summary, worstStallWindows: worst};
  console.log('[HardRoundFrameStall] summary', summary);
  console.table ? console.table(worst) : console.log('[HardRoundFrameStall] worst windows', worst);
  return out;
};

// ---------------------------------------------------------------------
// PHASE 11B.14 DIAGNOSTIC (opt-in via window.HardRoundDebugMainThreadCost,
// default off/no-op). Read-only, performance.now()-only timing of every
// remaining synchronous chunk of work in the Hard Round pointermove/
// pointerrawupdate path, to find what -- if anything measured here --
// accounts for the ~100ms rAF gaps found in Phase 11B.13 (which showed
// drawSegments/_hardRoundFlushPending were NOT big enough to explain it).
//
// No GPU readbacks, no getImageData, no pixel captures. Only
// performance.now() around existing call sites.
//
// Never touches geometry, pressure, stabilization, AA, shaders, commit/
// finalization, Smart Raster, legacy/custom-tip brushes, or panels/
// core-state display composition.
// ---------------------------------------------------------------------
window.HardRoundMainThreadCostLog = window.HardRoundMainThreadCostLog || [];
const _hrMtAgg = {}; // name -> {max, over8, over16, over33, count}
const _HR_MT_MAX_LOG = 200;
const _HR_MT_THRESHOLD_MS = 2;
function _hrMtActive(){
  return !!(window.HardRoundDebugMainThreadCost && typeof _inStroke!=='undefined' && _inStroke);
}
function _hrMtRecord(name, startT, endT){
  if(!window.HardRoundDebugMainThreadCost) return; // aggregate even if !_inStroke edge, but gate on flag
  const duration = endT - startT;
  let agg = _hrMtAgg[name];
  if(!agg){ agg = _hrMtAgg[name] = {max:0, over8:0, over16:0, over33:0, count:0}; _hrMtAgg[name]=agg; }
  agg.count++;
  if(duration > agg.max) agg.max = duration;
  if(duration > 8) agg.over8++;
  if(duration > 16) agg.over16++;
  if(duration > 33) agg.over33++;
  if(duration >= _HR_MT_THRESHOLD_MS){
    const entry = {
      name,
      strokeId: _hrFsStrokeId(),
      start: startT,
      durationMs: duration,
      pendingSegmentCount: (typeof _hardRoundPendingRenderSegments!=='undefined' && _hardRoundPendingRenderSegments) ? _hardRoundPendingRenderSegments.length : null,
      rendererSegmentCount: (typeof _hardRoundRenderer!=='undefined' && _hardRoundRenderer) ? _hardRoundRenderer._segmentCount : null,
    };
    window.HardRoundMainThreadCostLog.push(entry);
    if(window.HardRoundMainThreadCostLog.length > _HR_MT_MAX_LOG) window.HardRoundMainThreadCostLog.shift();
  }
}
// Tiny helper for wrapping a synchronous call inline: _hrMtWrap('name', () => expr)
function _hrMtWrap(name, fn){
  if(!window.HardRoundDebugMainThreadCost) return fn();
  const s = performance.now();
  const r = fn();
  _hrMtRecord(name, s, performance.now());
  return r;
}
window.HardRoundAnalyzeMainThreadCost = function(){
  const perOp = Object.keys(_hrMtAgg).map(name => Object.assign({name}, _hrMtAgg[name]));
  const log = window.HardRoundMainThreadCostLog.slice();
  const top10 = log.slice().sort((a,b) => b.durationMs - a.durationMs).slice(0, 10);
  const maxSingleOp = perOp.reduce((m, o) => Math.max(m, o.max), 0);
  const explainsGap = maxSingleOp >= 60; // rough: a single op within ~60ms+ of the ~100ms gap is a plausible sole cause
  const note = maxSingleOp < 20
    ? 'No single instrumented synchronous operation exceeds ~20ms. If rAF is still gapping by ~100ms, that time is NOT accounted for by the instrumented brush JS in this file -- likely outside JS entirely (browser rendering/compositor scheduling, GC, driver/GPU synchronization, or another app subsystem).'
    : (explainsGap
      ? 'At least one instrumented operation is large enough on its own to plausibly account for most of the ~100ms gap -- see perOperationMax for which one.'
      : 'Instrumented operations show some cost but none individually reaches the ~100ms gap size; the gap may be the SUM of several of these back-to-back, or may still include time outside JS. Check top10SlowestOperations for clustering around the same timestamp as the blink.');
  const out = {perOperationMax: perOp, top10SlowestOperations: top10, maxSingleOperationMs: maxSingleOp, note};
  console.log('[HardRoundMainThreadCost] per-operation max/counts', perOp);
  console.table ? console.table(top10) : console.log('[HardRoundMainThreadCost] top10', top10);
  console.log('[HardRoundMainThreadCost] note:', note);
  return out;
};

// ---------------------------------------------------------------------
// PHASE 11B.15 DIAGNOSTIC (opt-in via window.HardRoundDebugRoutingTrace,
// default off/no-op). Read-only. Purpose: confirm, per stroke, whether the
// migrated Hard Round GPU path and the legacy per-dab CPU path
// (_stampDab/_dabAA/_dabAATinyCoverage) are ever BOTH entered for the same
// stroke, or whether a given stroke runs exactly one of the two --
// source tracing shows _handleMoveEvent's Hard Round branch always
// `return`s before the legacy `for(const ev of events)` loop, so the two
// should be mutually exclusive per stroke; this diagnostic exists to
// empirically confirm that and to capture WHY eligibility failed when it
// does (see the eligibility snapshot recorded at pointerdown below).
//
// Never touches geometry, pressure, stabilization, AA math, shaders,
// commit, or the final display-composition fix.
// ---------------------------------------------------------------------
window.HardRoundRoutingTraceLog = window.HardRoundRoutingTraceLog || [];
const _HR_RT_MAX_LOG = 200;
let _hrRtCurrentStroke = null; // per-stroke counters, reset at pointerdown
function _hrRtNewStroke(strokeId, eligibilitySnapshot, hardRoundStrokeActive){
  if(!window.HardRoundDebugRoutingTrace) return;
  _hrRtCurrentStroke = {
    strokeId,
    hardRoundStrokeActive,
    eligibilitySnapshot,
    migratedHardRoundSegmentsGenerated: 0,
    legacyDabPathEntered: false,
    drawDabNowCount: 0,
    dabAATinyCoverageCount: 0,
    getImageDataCount: 0,
    totalGetImageDataMs: 0,
  };
}
function _hrRtFinalizeStroke(){
  if(!window.HardRoundDebugRoutingTrace || !_hrRtCurrentStroke) return;
  let isGpuActive = null;
  try{ isGpuActive = (typeof _hardRoundRenderer!=='undefined' && _hardRoundRenderer && _hardRoundRenderer.isGpuActive) ? _hardRoundRenderer.isGpuActive() : null; }catch(_){}
  const entry = Object.assign({}, _hrRtCurrentStroke, {isGpuActive, timestamp:performance.now()});
  window.HardRoundRoutingTraceLog.push(entry);
  if(window.HardRoundRoutingTraceLog.length > _HR_RT_MAX_LOG) window.HardRoundRoutingTraceLog.shift();
  _hrRtCurrentStroke = null;
}
function _hrRtNoteMigratedSegments(count){
  if(!window.HardRoundDebugRoutingTrace || !_hrRtCurrentStroke) return;
  _hrRtCurrentStroke.migratedHardRoundSegmentsGenerated += (count||0);
}
function _hrRtNoteLegacyPathEntered(){
  if(!window.HardRoundDebugRoutingTrace || !_hrRtCurrentStroke) return;
  _hrRtCurrentStroke.legacyDabPathEntered = true;
}
function _hrRtNoteDrawDabNow(){
  if(!window.HardRoundDebugRoutingTrace || !_hrRtCurrentStroke) return;
  _hrRtCurrentStroke.drawDabNowCount++;
}
function _hrRtNoteDabAATinyCoverage(getImageDataMs){
  if(!window.HardRoundDebugRoutingTrace || !_hrRtCurrentStroke) return;
  _hrRtCurrentStroke.dabAATinyCoverageCount++;
  _hrRtCurrentStroke.getImageDataCount++;
  _hrRtCurrentStroke.totalGetImageDataMs += getImageDataMs;
}
window.HardRoundAnalyzeRoutingTrace = function(){
  const log = window.HardRoundRoutingTraceLog.slice();
  const bothRoutesSameStroke = log.filter(s => s.hardRoundStrokeActive && s.legacyDabPathEntered);
  const legacyOnlyStrokes = log.filter(s => !s.hardRoundStrokeActive && s.legacyDabPathEntered);
  const migratedOnlyStrokes = log.filter(s => s.hardRoundStrokeActive && !s.legacyDabPathEntered);
  const out = {
    strokes: log,
    bothRoutesEnteredSameStrokeCount: bothRoutesSameStroke.length, // should always be 0 if source-level mutual exclusion holds
    legacyOnlyStrokeCount: legacyOnlyStrokes.length,
    migratedOnlyStrokeCount: migratedOnlyStrokes.length,
  };
  console.log('[HardRoundRoutingTrace] result', out);
  console.table ? console.table(log) : console.log(log);
  return out;
};

// ---------------------------------------------------------------------
// PHASE 11B.16 MINIMAL CAUSAL TRACE / BYPASS (both default off).
// Records only entry into the real tiny-coverage CPU renderer while the
// stroke-level migrated-route flag is still true. No readback or stack
// capture is added by this diagnostic.
// ---------------------------------------------------------------------
if(window.HardRoundDebugLegacyDabDuringGpu===undefined) window.HardRoundDebugLegacyDabDuringGpu=false;
if(window.HardRoundDebugBypassTinyCoverageDuringGpu===undefined) window.HardRoundDebugBypassTinyCoverageDuringGpu=false;
window.HardRoundLegacyDabDuringGpuLog=window.HardRoundLegacyDabDuringGpuLog||[];
window.HardRoundLegacyDabDuringGpuCount=window.HardRoundLegacyDabDuringGpuCount||0;
const _HR_LEGACY_DAB_DURING_GPU_MAX=100;
function _hardRoundRendererIsGpuActive(){
  try{return !!(_hardRoundRenderer&&_hardRoundRenderer.isGpuActive&&_hardRoundRenderer.isGpuActive());}
  catch(_){return false;}
}
function _hardRoundTraceLegacyDabDuringGpu(radius){
  if(!window.HardRoundDebugLegacyDabDuringGpu||_hardRoundStrokeActive!==true)return;
  const entry={
    timestamp:performance.now(),
    strokeId:_activeStrokeSession,
    activeStrokeSession:_activeStrokeSession,
    hardRoundStrokeActive:true,
    gpuActive:_hardRoundRendererIsGpuActive(),
    radius:Number.isFinite(radius)?radius:null,
    hardness:Number.isFinite(brushHardness)?brushHardness:null,
    reason:'tiny-generated-hard-round',
  };
  window.HardRoundLegacyDabDuringGpuCount++;
  window.HardRoundLegacyDabDuringGpuLog.push(entry);
  if(window.HardRoundLegacyDabDuringGpuLog.length>_HR_LEGACY_DAB_DURING_GPU_MAX)window.HardRoundLegacyDabDuringGpuLog.shift();
}
function _hardRoundShouldBypassTinyCoverageDuringGpu(){
  return window.HardRoundDebugBypassTinyCoverageDuringGpu===true&&
    _hardRoundStrokeActive===true&&_hardRoundRendererIsGpuActive();
}
window.HardRoundAnalyzeLegacyDabDuringGpu=function(){
  const log=window.HardRoundLegacyDabDuringGpuLog||[];
  return{
    count:window.HardRoundLegacyDabDuringGpuCount||0,
    strokeIds:Array.from(new Set(log.map(entry=>entry.strokeId))),
    firstEntry:log.length?log[0]:null,
    lastEntry:log.length?log[log.length-1]:null,
  };
};

// PHASE 11B.17: session-aware observation/guard for shared state mutations
// made after Hard Round pointer-up has crossed an async boundary.
if(window.HardRoundDebugStaleFinalizer===undefined)window.HardRoundDebugStaleFinalizer=false;
if(window.HardRoundDebugGuardStaleFinalizer===undefined)window.HardRoundDebugGuardStaleFinalizer=false;
window.HardRoundStaleFinalizerLog=window.HardRoundStaleFinalizerLog||[];
const _HR_STALE_FINALIZER_MAX=100;
function _hrStaleFinalizerMutation(originStrokeId,mutation,before,after,apply){
  const stale=originStrokeId!==_activeStrokeSession;
  if(window.HardRoundDebugStaleFinalizer){
    const entry={timestamp:performance.now(),originStrokeId,currentActiveStrokeSession:_activeStrokeSession,mutation,before,after,stale};
    window.HardRoundStaleFinalizerLog.push(entry);
    if(window.HardRoundStaleFinalizerLog.length>_HR_STALE_FINALIZER_MAX)window.HardRoundStaleFinalizerLog.shift();
  }
  if(stale&&window.HardRoundDebugGuardStaleFinalizer)return false;
  apply();
  return true;
}
window.HardRoundAnalyzeStaleFinalizer=function(){
  const log=(window.HardRoundStaleFinalizerLog||[]).slice();
  const stale=log.filter(entry=>entry.stale);
  const mutationsByName={};
  for(const entry of log)mutationsByName[entry.mutation]=(mutationsByName[entry.mutation]||0)+1;
  return{staleMutationCount:stale.length,firstStaleMutation:stale.length?stale[0]:null,mutationsByName,log};
};

// ---------------------------------------------------------------------
// PHASE 11B.16 DIAGNOSTIC (opt-in via window.HardRoundDebugPerfMarks,
// default off/no-op). performance.mark() ONLY -- no getImageData, no GPU
// readback, no canvas capture, no console output. Purpose: make confirmed
// migrated Hard Round GPU strokes and their pointer events trivially
// findable in Chrome DevTools Performance recordings, so a specific
// stroke's pointerdown/rawupdate mark can be located right next to a
// visible blink and the long main-thread task around it inspected.
//
// Marks are only ever emitted for strokes already confirmed migrated/GPU
// (i.e. _hardRoundStrokeActive is true for that stroke) -- never for
// legacy/CPU-dab strokes. No rendering behavior is touched.
// ---------------------------------------------------------------------
let _hrPerfMarkStrokeId = null;
let _hrPerfMarkRawCounter = 0;
function _hrPerfMarkStrokeStart(strokeId){
  if(!window.HardRoundDebugPerfMarks) return;
  _hrPerfMarkStrokeId = strokeId;
  _hrPerfMarkRawCounter = 0;
  try{ performance.mark('HR-GPU-stroke-'+strokeId+'-pointerdown'); }catch(_){}
}
function _hrPerfMarkRaw(strokeId){
  if(!window.HardRoundDebugPerfMarks) return;
  _hrPerfMarkRawCounter++;
  try{ performance.mark('HR-GPU-stroke-'+strokeId+'-raw-'+_hrPerfMarkRawCounter); }catch(_){}
}
function _hrPerfMarkPreviewRaf(strokeId){
  if(!window.HardRoundDebugPerfMarks) return;
  try{ performance.mark('HR-GPU-stroke-'+strokeId+'-preview-raf'); }catch(_){}
}
function _hrPerfMarkPointerup(strokeId){
  if(!window.HardRoundDebugPerfMarks) return;
  try{ performance.mark('HR-GPU-stroke-'+strokeId+'-pointerup'); }catch(_){}
}

function _hardRoundFlushPending(renderer){
  if(!renderer||!_hardRoundPendingRenderSegments.length)return 0;
  const _hrFsFlushStart = _hrFsActive() ? performance.now() : null;
  const pending=_hardRoundPendingRenderSegments.splice(0,_hardRoundPendingRenderSegments.length);
  const _hrFsDrawStart = _hrFsActive() ? performance.now() : null;
  renderer.drawSegments(pending);
  if(_hrFsDrawStart!=null){
    const _hrFsDrawMs = performance.now() - _hrFsDrawStart;
    _hrFsRecordFlushPending(performance.now() - _hrFsFlushStart, _hrFsDrawMs, pending.length);
  }
  // Bookkeeping only (no console output -- see Phase 11A.30 console
  // cleanup). Logs exactly what this flush dispatched into
  // renderer.drawSegments() -- this function is the sole path from
  // _hardRoundPendingRenderSegments into the renderer, so this log entry is
  // a complete record of every drawSegments() call this phase asked for.
  if(window.HardRoundDebugCaptureLastLiveFrame&&window.HardRoundGeometryMutationLog){
    window.HardRoundGeometryMutationLog.push({
      fn:'_hardRoundFlushPending',
      timestamp:performance.now(),
      dispatchedCount:pending.length,
      pendingQueueLengthAfter:_hardRoundPendingRenderSegments.length,
      flushedIntoRenderer:true,
    });
  }
  _hr11b6Log('flushPending', null, {flushedCount:pending.length});
  return pending.length;
}
function _hardRoundGetRenderer(){
  if(typeof window==='undefined' || !window.PrototypeRenderer) return null;
  const w = activeC.width, h = activeC.height;
  if(!_hardRoundRenderer || _hardRoundRenderer.width!==w || _hardRoundRenderer.height!==h){
    const pooledIndex=_hardRoundRendererPool.findIndex(renderer=>renderer.width===w&&renderer.height===h&&!renderer._hardRoundFinishingOwner);
    _hardRoundRenderer=pooledIndex>=0?_hardRoundRendererPool.splice(pooledIndex,1)[0]:new window.PrototypeRenderer({width:w, height:h, preferGpu:true});
  }
  return _hardRoundRenderer;
}
function _hardRoundHasVisibleLayerAbove(layerIndex,frameIndex){
  for(let index=layerIndex+1;index<layers.length;index++){
    const layer=layers[index];
    if(!layer||layer.visible===false)continue;
    if(typeof _layerGroupChainVisible==='function'&&!_layerGroupChainVisible(layer))continue;
    // A held frame is the compositor's authoritative contribution for a
    // non-active artwork layer. Conservatively choosing the layer-aware
    // path is harmless when that frame happens to be transparent.
    if(typeof getHeldKey!=='function'||getHeldKey(index,frameIndex))return true;
  }
  return false;
}
function _hardRoundCopyCanvas(source){
  if(!source)return null;
  const copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;
  copy.getContext('2d').drawImage(source,0,0);
  return copy;
}
function _hardRoundCapturedCompositeOperation(blendMode){
  switch(blendMode){
    case 'draw-behind':return'destination-over';case'darken':return'darken';case'multiply':return'multiply';
    case'color-burn':return'color-burn';case'lighten':return'lighten';case'screen':return'screen';
    case'color-dodge':return'color-dodge';case'add':case'add-glow':return'lighter';case'overlay':return'overlay';
    case'soft-light':return'soft-light';case'hard-light':return'hard-light';case'difference':return'difference';
    case'exclusion':return'exclusion';case'hue':return'hue';case'saturation':return'saturation';
    case'color':return'color';case'luminosity':return'luminosity';default:return'source-over';
  }
}
if(typeof window.HardRoundDebugSmartPointerupTiming==='undefined')window.HardRoundDebugSmartPointerupTiming=false;
const _hardRoundSmartPointerupTimingRecords=[];
function _hrSmartPointerupBegin(strokeId,smartRaster,eventTimestamp){
  if(!window.HardRoundDebugSmartPointerupTiming)return null;
  const now=performance.now(),record={strokeId,smartRaster:!!smartRaster,pointerupEventTimestamp:eventTimestamp,pointerupStart:now,pointerupSyncEnd:null,pointerupSyncDuration:0,ownershipBeforeMs:0,endStrokeSyncSetupMs:0,maskCopyMs:0,smartCommitMs:0,saveMs:0,recompositeMs:0,firstPostUpPenEvent:null,firstCursorApply:null,longestSyncOperation:null,totalMainThreadSyncMs:0};
  _hardRoundSmartPointerupTimingRecords.push(record);if(_hardRoundSmartPointerupTimingRecords.length>20)_hardRoundSmartPointerupTimingRecords.shift();
  return record;
}
function _hrSmartPointerupStage(record,name,started){if(record)record[name]=(record[name]||0)+(performance.now()-started);}
function _hrSmartPointerupFinish(record){
  if(!record)return;record.pointerupSyncEnd=performance.now();record.pointerupSyncDuration=record.pointerupSyncEnd-record.pointerupStart;_hrSmartPointerupSummarize(record);
}
function _hrSmartPointerupSummarize(record){
  if(!record)return record;
  const stages=['ownershipBeforeMs','endStrokeSyncSetupMs','maskCopyMs','smartCommitMs','saveMs','recompositeMs'];
  const slowest=stages.reduce((best,name)=>record[name]>(best.ms||-1)?{name,ms:record[name]}:best,{});
  record.longestSyncOperation=slowest.name?slowest:null;
  record.totalMainThreadSyncMs=record.pointerupSyncDuration+record.maskCopyMs+record.smartCommitMs+record.saveMs+record.recompositeMs;
  return record;
}
window.HardRoundSmartPointerupTimingNote=function(type,event){
  if(!window.HardRoundDebugSmartPointerupTiming)return;
  const record=[..._hardRoundSmartPointerupTimingRecords].reverse().find(item=>item.pointerupStart!=null);
  if(!record)return;const now=performance.now();
  if(type==='pen-event'&&!record.firstPostUpPenEvent&&event&&event.pointerType==='pen'&&(event.type==='pointermove'||event.type==='pointerrawupdate'))record.firstPostUpPenEvent={type:event.type,eventTimestamp:event.timeStamp,performanceTimestamp:now,afterPointerupStartMs:now-record.pointerupStart,afterPointerupSyncEndMs:record.pointerupSyncEnd==null?null:now-record.pointerupSyncEnd};
  if(type==='cursor-apply'&&record.firstPostUpPenEvent&&!record.firstCursorApply)record.firstCursorApply={performanceTimestamp:now,x:event&&event.x,y:event&&event.y,sourceEventType:event&&event.sourceEventType,sourceEventTimestamp:event&&event.sourceEventTimestamp,afterPointerupStartMs:now-record.pointerupStart,afterPointerupSyncEndMs:record.pointerupSyncEnd==null?null:now-record.pointerupSyncEnd,afterFirstPostUpPenEventMs:now-record.firstPostUpPenEvent.performanceTimestamp};
};
window.HardRoundAnalyzeSmartPointerupTiming=function(){
  const smart=[..._hardRoundSmartPointerupTimingRecords].reverse().find(record=>record.smartRaster)||null;
  const normal=[..._hardRoundSmartPointerupTimingRecords].reverse().find(record=>!record.smartRaster)||null;
  if(smart)_hrSmartPointerupSummarize(smart);if(normal)_hrSmartPointerupSummarize(normal);
  return {smartRaster:smart,normalRaster:normal,smartVsNormalDifference:smart&&normal?{pointerupSyncDuration:smart.pointerupSyncDuration-normal.pointerupSyncDuration,totalMainThreadSyncMs:smart.totalMainThreadSyncMs-normal.totalMainThreadSyncMs,firstHoverDelayMs:smart.firstPostUpPenEvent&&normal.firstPostUpPenEvent?smart.firstPostUpPenEvent.afterPointerupStartMs-normal.firstPostUpPenEvent.afterPointerupStartMs:null}:null,slowestSmartOperation:smart&&smart.longestSyncOperation||null};
};
function _commitFinishedHardRoundStroke(context){
  const src=context.resolvedCanvas;if(!src)return;
  const currentDestination=curLayer===context.layerIndex&&curFrame===context.frameIndex;
  const target=currentDestination?ctx:(context.destinationCanvas&&context.destinationCanvas.getContext('2d'));
  if(!target)return;
  target.save();target.globalAlpha=context.opacity;target.globalCompositeOperation=context.compositeOperation;
  target.drawImage(src,0,0);
  if(context.blendMode==='add-glow'){target.globalAlpha=context.opacity*.65;target.drawImage(src,0,0);}
  target.restore();
  if(currentDestination){
    const key=layers[context.layerIndex]&&layers[context.layerIndex].frames[context.frameIndex];
    if(key){const keyCtx=key.getContext('2d');keyCtx.clearRect(0,0,key.width,key.height);keyCtx.drawImage(activeC,0,0);}
    recomposite(context.layerIndex,context.frameIndex);_hrRapidPresentation('recompositeCompleted',context.strokeId,{kind:'normal-raster'});
  }
  context.state='committed';
}
function _commitFinishedSmartRasterStroke(context){
  const mask=context.resolvedMaskCanvas;if(!mask)return;
  const currentDestination=curLayer===context.layerIndex&&curFrame===context.frameIndex;
  const targetCanvas=currentDestination?activeC:context.destinationCanvas;
  const target=targetCanvas&&targetCanvas.getContext('2d');if(!target)return;
  target.save();target.globalAlpha=context.opacity;target.globalCompositeOperation=context.compositeOperation;
  const rect=context.dirtyRect;
  if(rect&&rect.w>0&&rect.h>0)target.drawImage(mask,rect.x,rect.y,rect.w,rect.h,rect.x,rect.y,rect.w,rect.h);else target.drawImage(mask,0,0);
  target.restore();
  if(typeof window.commitSmartRasterBrushAt==='function'){
    const commitStarted=context.pointerupTiming?performance.now():0;
    if(context.pointerupTiming)window.HardRoundSmartCommitTimingLast=null;
    window.commitSmartRasterBrushAt(context.layerIndex,context.frameIndex,mask,context.styleId,context.opacity,context.dirtyRect,context.ownershipBefore,context.blendMode,context.resolvedMaskData);
    _hrSmartPointerupStage(context.pointerupTiming,'smartCommitMs',commitStarted);
    if(context.pointerupTiming)context.pointerupTiming.smartCommitBreakdown=window.HardRoundSmartCommitTimingLast||null;
  }
  if(currentDestination){
    const saveStarted=context.pointerupTiming?performance.now():0;
    const key=context.destinationCanvas;if(key){const keyCtx=key.getContext('2d');keyCtx.clearRect(0,0,key.width,key.height);keyCtx.drawImage(activeC,0,0);}
    _hrSmartPointerupStage(context.pointerupTiming,'saveMs',saveStarted);
    const recompositeStarted=context.pointerupTiming?performance.now():0;
    recomposite(context.layerIndex,context.frameIndex);_hrRapidPresentation('recompositeCompleted',context.strokeId,{kind:'smart-raster'});
    _hrSmartPointerupStage(context.pointerupTiming,'recompositeMs',recompositeStarted);
  }
  _hrSmartPointerupSummarize(context.pointerupTiming);
  context.state='committed';
}
function _hardRoundReleaseFinishingContext(context){
  context.renderer._hardRoundFinishingOwner=null;
  _hardRoundRendererPool.push(context.renderer);
  _hardRoundFinishingContexts.delete(context.strokeId);
}
function _hardRoundFinalizeOwnedContext(context,e){
  _hrRapidPresentation('commitStarted',context.strokeId,{kind:context.smartRaster?'smart-raster':'normal-raster'});
  context.state='finishing';context.renderer._hardRoundFinishingOwner=context.strokeId;
  _hardRoundFinishingContexts.set(context.strokeId,context);
  const endStrokeStarted=context.pointerupTiming?performance.now():0;
  const cpuTimingCount=context.pointerupTiming&&Array.isArray(window.HardRoundCpuResolveTimingLog)?window.HardRoundCpuResolveTimingLog.length:0;
  const endStrokeResult=context.renderer.endStroke({readback:context.gpuCommit,includeCpuMaskData:context.smartRaster,dirtyRect:context.dirtyRect});
  _hrSmartPointerupStage(context.pointerupTiming,'endStrokeSyncSetupMs',endStrokeStarted);
  if(context.pointerupTiming&&Array.isArray(window.HardRoundCpuResolveTimingLog)&&window.HardRoundCpuResolveTimingLog.length>cpuTimingCount)context.pointerupTiming.cpuResolveBreakdown=window.HardRoundCpuResolveTimingLog[window.HardRoundCpuResolveTimingLog.length-1]||null;
  const resolution=endStrokeResult.then(result=>{
    const copyStarted=context.pointerupTiming?performance.now():0;
    const stable=_hardRoundCopyCanvas(result&&result.canvas);
    _hrSmartPointerupStage(context.pointerupTiming,'maskCopyMs',copyStarted);
    if(context.smartRaster){context.resolvedMaskCanvas=stable;context.resolvedMaskData=result&&result.maskData||null;}else context.resolvedCanvas=stable;
    context.state='ready';
    _hrRapidPresentation('readbackCompleted',context.strokeId);
    _hardRoundReleaseFinishingContext(context);
    return context;
  });
  _hardRoundPendingCommitCount++;
  const commit=_hardRoundCommitTail.then(()=>resolution).then(ready=>{
    if(ready.smartRaster)_commitFinishedSmartRasterStroke(ready);else _commitFinishedHardRoundStroke(ready);
    _hrRapidPresentation('commitCompleted',ready.strokeId,{kind:ready.smartRaster?'smart-raster':'normal-raster'});
    if(ready.strokeId===_activeStrokeSession){
      _hardRoundSetGpuOverlayVisible(false,'owned-finalization-current-session');
      _finalizePointerEndStroke(e,ready.strokeId,false);
    }else if(window.HardRoundOverlayPresentedStrokeId===ready.strokeId){
      // A newer stroke may already own the presenter, but until its first
      // frame lands the shared canvas can still contain this just-committed
      // stroke. Retire that old representation only after recomposite made
      // the committed replacement visible.
      _hardRoundSetGpuOverlayVisible(false,'owned-finalization-retire-committed-overlay');
    }
  });
  const settled=commit.finally(()=>{_hardRoundPendingCommitCount=Math.max(0,_hardRoundPendingCommitCount-1);_hrRapidPresentation('finalizerCompleted',context.strokeId);});
  _hardRoundCommitTail=settled.catch(err=>{console.error('[Hard Round finalization]',err);});
  return settled;
}
// TEMP DIAGNOSTIC (Phase 11A routing probe). Purely visual, appended once,
// never read by any other code path. Safe to delete wholesale once the
// routing matrix is confirmed.
function _hrDebugBadge(info){
  if(typeof document==='undefined') return;
  let el=document.getElementById('hr-debug-badge');
  if(!el){
    el=document.createElement('div');
    el.id='hr-debug-badge';
    el.style.cssText='position:fixed;bottom:8px;left:8px;z-index:99999;font:11px monospace;'+
      'background:rgba(0,0,0,0.75);color:#0f0;padding:4px 8px;border-radius:4px;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
  }
  el.textContent='HR#'+info.strokeId+' route='+info.route+' backend='+info.backend+
    ' tip='+info.hasCustomTip+' tex='+info.textureEnabled;
}
function _hardRoundGpuOverlay(){return document.getElementById('hard-round-gpu-overlay');}
// Phase 11B.9 TEMP DIAGNOSTIC (opt-in, default off, off by default and never
// polls). Gate: window.HardRoundDebugPresentationBoundary. Purpose: record
// every state transition at the live presentation/visibility boundary
// (the GPU overlay canvas + activeC) during an active Hard Round GPU
// stroke, per Phase 11B.7's conclusion that segment accumulation /
// strokeMaskTex accumulation / GPU resolve-readback are all healthy and the
// remaining suspect is presentation/DOM visibility. Read-only: never
// mutates overlay/activeC state itself, only observes call sites that
// already exist. Call sites instrumented:
//   - _hardRoundSetGpuOverlayVisible(visible) itself (every call, with the
//     caller-supplied reason string and whether the DOM state actually
//     changed)
//   - PrototypeRenderer.init()'s outputContext.configure() (one-time GPU
//     surface (re)configuration; see prototype-renderer.js)
// Bounded ring buffer (last 200 entries) so this stays inspectable after
// the fact via window.HardRoundPresentationBoundaryLog even if console
// logging (window.HardRoundDebugPresentationBoundary) was off when the
// repro happened -- flip the flag on, reproduce, then read the buffer.
window.HardRoundPresentationBoundaryLog = window.HardRoundPresentationBoundaryLog || [];
window.HardRoundResetPresentationBoundaryLog = function(){
  window.HardRoundPresentationBoundaryLog = [];
};
function _hrPresentBoundarySnapshot(reason){
  const overlay=_hardRoundGpuOverlay();
  const overlayCs=(overlay&&typeof getComputedStyle==='function')?getComputedStyle(overlay):null;
  const activeCs=(typeof activeC!=='undefined'&&activeC&&typeof getComputedStyle==='function')?getComputedStyle(activeC):null;
  const renderer=typeof _hardRoundRenderer!=='undefined'?_hardRoundRenderer:null;
  return {
    tag:'[11B.9 PRESENT-BOUNDARY]',
    timestamp:performance.now(),
    strokeId:typeof _activeStrokeSession!=='undefined'?_activeStrokeSession:null,
    reason,
    strokeActive:typeof _inStroke!=='undefined'?_inStroke:null,
    hardRoundStrokeActive:typeof _hardRoundStrokeActive!=='undefined'?_hardRoundStrokeActive:null,
    rendererSegmentCount:renderer?renderer._segmentCount:null,
    overlay:overlay?{
      display:overlay.style.display,
      visibility:overlay.style.visibility,
      opacity:overlay.style.opacity,
      hidden:overlay.hidden,
      width:overlay.width,
      height:overlay.height,
      clientWidth:overlay.clientWidth,
      clientHeight:overlay.clientHeight,
      isConnected:overlay.isConnected,
      computedDisplay:overlayCs?overlayCs.display:null,
      computedVisibility:overlayCs?overlayCs.visibility:null,
      computedOpacity:overlayCs?overlayCs.opacity:null,
    }:null,
    activeC:(typeof activeC!=='undefined'&&activeC)?{
      display:activeC.style.display,
      visibility:activeC.style.visibility,
      computedDisplay:activeCs?activeCs.display:null,
      computedVisibility:activeCs?activeCs.visibility:null,
    }:null,
  };
}
function _hrPresentBoundaryLog(reason){
  if(!window.HardRoundDebugPresentationBoundary)return;
  const snap=_hrPresentBoundarySnapshot(reason);
  window.HardRoundPresentationBoundaryLog.push(snap);
  if(window.HardRoundPresentationBoundaryLog.length>200){
    window.HardRoundPresentationBoundaryLog.splice(0,window.HardRoundPresentationBoundaryLog.length-200);
  }
  console.log(snap.tag,snap);
}
// Phase 11B.10 TEMP DIAGNOSTIC (opt-in, default off, no polling). Gate:
// window.HardRoundDebugLivePreviewCrossover. Purpose: Phase 11B.9 proved
// the overlay's DOM visibility/opacity/size never changes unexpectedly, but
// exposed a timing pattern instead -- live-preview peekStroke()/present()
// calls that are still in flight when pointerup begins, whose JS-side
// generation/session bookkeeping only gets checked AFTER peekStroke() (and
// therefore after any real GPU present() submit) has already resolved. This
// records one lifecycle entry per live-preview request so that crossover
// can be measured directly instead of inferred.
//
// Fields captured per live preview (see _hardRoundPresentLivePreview and
// its .then() continuation below): strokeId, livePreviewId, requestTime,
// presentSubmitTime (when available -- only populated for real GPU
// present() calls, not the CanvasLivePresentation diagnostic's
// resolveInto()-only path, and not the CPU backend), resolveTime,
// pointerupStartedAt / finishedFrameStartedAt (looked up by strokeId,
// filled in even if they happen AFTER this preview's request), generation
// at request / at submit (if available) / at resolve, whether GPU
// presentation work was actually submitted, and whether the JS accepted or
// rejected the resolved result (and why).
//
// window.HardRoundGetPreviewGeneration() is a read-only accessor (added
// solely so prototype-renderer.js's GpuBackend.present() -- which has no
// other way to see brush-engine.js's private _hardRoundPreviewGeneration
// counter -- can stamp what the generation was at the exact instant its
// real GPU submit happened, without present() needing to know anything
// else about stroke lifecycle).
window.HardRoundLivePreviewCrossoverLog = window.HardRoundLivePreviewCrossoverLog || [];
window.HardRoundResetLivePreviewCrossoverLog = function(){
  window.HardRoundLivePreviewCrossoverLog = [];
  window.HardRoundLivePreviewSubmitInfo = {};
};
// livePreviewId -> {submitTime, generationAtSubmit} written by
// GpuBackend.present() in prototype-renderer.js when it actually runs for a
// live-preview call (meta.livePreviewId set). Absence of an entry after
// resolve means this particular live preview never reached a real GPU
// present() call (e.g. CPU backend, or the CanvasLivePresentation
// diagnostic's resolveInto()-only branch) -- itself part of "was
// presentation GPU work submitted".
window.HardRoundLivePreviewSubmitInfo = window.HardRoundLivePreviewSubmitInfo || {};
window.HardRoundGetPreviewGeneration = function(){ return _hardRoundPreviewGeneration; };
let _hr1110LivePreviewIdCounter = 0;
// Keyed by strokeId (session). Recorded at the earliest possible instant of
// each event so a live preview requested BEFORE that instant can still see
// it filled in once it resolves later.
let _hr1110PointerupStartedAtBySession = {};
let _hr1110FinishedFrameStartedAtBySession = {};
// Phase 11B.11: strokeId (session) -> {time, requestedVisible, reason} for
// the overlay-visibility call made from beginStroke (see
// _hardRoundSetGpuOverlayVisible below) -- the authoritative record of
// whether/how early reveal happened for a given stroke, independent of the
// separate 11B.9 boundary-log flag and its string-matching quirks.
let _hr1110EarlyRevealBySession = {};
function _hr1110PushRequest(entry){
  if(!window.HardRoundDebugLivePreviewCrossover)return null;
  window.HardRoundLivePreviewCrossoverLog.push(entry);
  if(window.HardRoundLivePreviewCrossoverLog.length>300){
    window.HardRoundLivePreviewCrossoverLog.splice(0,window.HardRoundLivePreviewCrossoverLog.length-300);
  }
  return entry;
}
// Console summary: joins each recorded live preview against the
// pointerup/finished-frame timestamps for its stroke and reports exactly
// the two crossover conditions Phase 11B.10 asked about, plus the "overlay
// shown but zero accepted live previews before pointerup" fast-stroke case.
// Read-only -- only reads window.HardRoundLivePreviewCrossoverLog and
// window.HardRoundPresentationBoundaryLog (from 11B.9, if present).
window.HardRoundLivePreviewCrossoverSummary = function(){
  const log = window.HardRoundLivePreviewCrossoverLog || [];
  const submittedAfterPointerup = log.filter(e=>
    e.presentationSubmitted && e.presentSubmitTime!=null && e.pointerupStartedAt!=null &&
    e.presentSubmitTime > e.pointerupStartedAt
  );
  const resolvedAfterFinishedFrameStarted = log.filter(e=>
    e.resolveTime!=null && e.finishedFrameStartedAt!=null &&
    e.resolveTime > e.finishedFrameStartedAt
  );
  const byStroke = {};
  log.forEach(e=>{
    byStroke[e.strokeId] = byStroke[e.strokeId] || {strokeId:e.strokeId, total:0, accepted:0};
    byStroke[e.strokeId].total++;
    if(e.accepted) byStroke[e.strokeId].accepted++;
  });
  const boundaryLog = window.HardRoundPresentationBoundaryLog || [];
  // Phase 11B.11 fix: the original join here filtered
  // window.HardRoundPresentationBoundaryLog (11B.9, a SEPARATE opt-in flag
  // -- window.HardRoundDebugPresentationBoundary -- often not enabled in
  // the same run as this diagnostic, so the log could be empty regardless)
  // by `reason.indexOf('beginStroke-earlyReveal')===0`. But the string
  // actually recorded there is `'setGpuOverlayVisible(true) via
  // beginStroke-earlyReveal'` (see _hardRoundSetGpuOverlayVisible), which
  // never starts at index 0 -- so the filter matched nothing even when the
  // boundary log DID have data. Both problems are why
  // strokesWithEarlyRevealButZeroAcceptedLivePreviews came back empty.
  // Fixed by reading _hr1110EarlyRevealBySession instead: it's populated by
  // this SAME diagnostic flag (window.HardRoundDebugLivePreviewCrossover),
  // independent of 11B.9, directly inside _hardRoundSetGpuOverlayVisible
  // whenever its `reason` argument starts with 'beginStroke' -- no string
  // scanning of a differently-formatted log required.
  const earlyRevealStrokeIds = Object.keys(_hr1110EarlyRevealBySession)
    .map(Number)
    .filter(id=>_hr1110EarlyRevealBySession[id].requestedVisible===true);
  const zeroAcceptedFastStrokes = earlyRevealStrokeIds.filter(id=>{
    const stats = byStroke[id];
    return !stats || stats.accepted===0;
  });
  return {
    totalLivePreviewsRecorded: log.length,
    submittedAfterPointerupCount: submittedAfterPointerup.length,
    submittedAfterPointerupEntries: submittedAfterPointerup,
    resolvedAfterFinishedFrameStartedCount: resolvedAfterFinishedFrameStarted.length,
    resolvedAfterFinishedFrameStartedEntries: resolvedAfterFinishedFrameStarted,
    strokesWithEarlyRevealButZeroAcceptedLivePreviews: zeroAcceptedFastStrokes,
    earlyRevealJoinFixNote: 'Phase 11B.11: this field now reads _hr1110EarlyRevealBySession, not the 11B.9 boundary log -- see comment above. If you previously saw [] here, that was the join bug, not evidence early reveal never happened.',
    perStrokeAcceptedCounts: byStroke,
  };
};
// Phase 11B.11: compact analyzer for strokes where live previews were
// requested but NONE were accepted (stroke 4/6/7's total>0, accepted==0
// pattern). Only strokes matching that exact condition are reported, with
// every rejected live preview's full diagnostic record plus whether early
// reveal happened for that stroke (via the fixed _hr1110EarlyRevealBySession
// source above, not the broken boundary-log join).
window.HardRoundAnalyzeZeroAcceptedPreviews = function(){
  const log = window.HardRoundLivePreviewCrossoverLog || [];
  const byStroke = {};
  log.forEach(e=>{
    byStroke[e.strokeId] = byStroke[e.strokeId] || {strokeId:e.strokeId, total:0, accepted:0, entries:[]};
    byStroke[e.strokeId].total++;
    if(e.accepted) byStroke[e.strokeId].accepted++;
    byStroke[e.strokeId].entries.push(e);
  });
  const zeroAcceptedStrokes = Object.values(byStroke).filter(s=>s.total>0 && s.accepted===0);
  const results = zeroAcceptedStrokes.map(s=>{
    const earlyReveal = _hr1110EarlyRevealBySession[s.strokeId] || null;
    const rejectedPreviews = s.entries.map(e=>({
      strokeId: e.strokeId,
      livePreviewId: e.livePreviewId,
      requestTime: e.requestTime,
      resolveTime: e.resolveTime,
      rejectReason: e.rejectReason,
      generationAtRequest: e.generationAtRequest,
      generationAtResolve: e.generationAtResolve,
      activeStrokeSessionAtResolve: e.activeStrokeSessionAtResolve,
      hardRoundStrokeActiveAtResolve: e.hardRoundStrokeActiveAtResolve,
      rendererSegmentCountAtResolve: e.rendererSegmentCountAtResolve,
      presentationSubmitted: e.presentationSubmitted,
    }));
    return {
      strokeId: s.strokeId,
      totalLivePreviewsRequested: s.total,
      accepted: s.accepted,
      overlayRevealedAtBeginStroke: earlyReveal ? earlyReveal.requestedVisible : null,
      earlyRevealTime: earlyReveal ? earlyReveal.time : null,
      earlyRevealReason: earlyReveal ? earlyReveal.reason : null,
      rejectedPreviews,
    };
  });
  return {
    strokeCountWithZeroAccepted: results.length,
    strokes: results,
  };
};
function _hardRoundSetGpuOverlayVisible(visible,reason){
  const overlay=_hardRoundGpuOverlay();
  // Log the call itself (including calls that no-op because the overlay
  // element isn't in the DOM) whenever the diagnostic is enabled -- this is
  // the "log every call, including whether it actually changed DOM state"
  // requirement, independent of the before/after snapshots below.
  if(window.HardRoundDebugPresentationBoundary){
    const before=overlay?{hidden:overlay.hidden,display:overlay.style.display}:null;
    const willChange=overlay?(overlay.hidden!==!visible||overlay.style.display!==(visible?'block':'none')):false;
    console.log('[11B.9 SET-OVERLAY-VISIBLE]',{
      timestamp:performance.now(),
      requestedVisible:visible,
      reason:reason||null,
      overlayFound:!!overlay,
      before,
      willChangeDomState:willChange,
      strokeId:typeof _activeStrokeSession!=='undefined'?_activeStrokeSession:null,
      strokeActive:typeof _inStroke!=='undefined'?_inStroke:null,
    });
  }
  // Phase 11B.11 TEMP DIAGNOSTIC (opt-in via window.HardRoundDebugLivePreviewCrossover,
  // same flag as the rest of the 11B.10/11B.11 lifecycle diagnostic --
  // deliberately NOT gated behind window.HardRoundDebugPresentationBoundary,
  // since 11B.11's analyzer must work correctly even when that separate
  // 11B.9 flag is off. Records, per stroke session, every time the overlay
  // is made visible for the "beginStroke" reasons (both the normal
  // beginStroke-earlyReveal path and the CanvasLivePresentation-diagnostic
  // suppression, which explicitly requests visible=false) -- this is the
  // authoritative, always-available source for "was early reveal true for
  // this stroke", independent of the 11B.9 boundary log's own gating and
  // string format.
  if(window.HardRoundDebugLivePreviewCrossover && reason && reason.indexOf('beginStroke')===0){
    _hr1110EarlyRevealBySession[_activeStrokeSession] = {
      time: performance.now(),
      requestedVisible: !!visible,
      reason,
    };
  }
  if(!overlay)return;
  overlay.hidden=!visible;
  overlay.style.display=visible?'block':'none';
  if(!visible)window.HardRoundOverlayPresentedStrokeId=null;
  _hrRapidPresentation(visible?'overlayShown':'overlayHidden',_activeStrokeSession,{reason:reason||null});
  _hrPresentBoundaryLog('setGpuOverlayVisible('+visible+')'+(reason?' via '+reason:''));
}
// TEMP DIAGNOSTIC (Phase 11A.35): one concise timestamped surface-state log,
// plus optional two-rAF-boundary checkpoints to sample what the browser has
// actually painted (as opposed to what the DOM currently says). Opt-in via
// window.HardRoundDebug1135 (default off). Read-only: never touches
// geometry, pressure, stabilization, AA, shaders, opacity math,
// finishStroke, segment generation, or commit behavior.
function _hr1135Snapshot(event){
  const overlay=_hardRoundGpuOverlay();
  return {
    tag:'[11A.35 SURFACES]',
    time:performance.now(),
    event,
    overlayVisible:overlay?!overlay.hidden&&overlay.style.display!=='none':null,
    overlayOpacity:overlay?getComputedStyle(overlay).opacity:null,
    displayBackend:(window.DisplayBackend&&window.DisplayBackend.mode)||'canvas2d',
    activeCanvasOpacity:(typeof activeC!=='undefined'&&activeC)?activeC.style.opacity:null,
    strokeId:_activeStrokeSession,
  };
}
// Persistent ring buffer of the last 30 [11A.35 SURFACES] entries, kept
// independently of whether console logging is enabled, so a stroke can be
// captured and inspected after the fact via window.HardRound1135Log.
window.HardRound1135Log = window.HardRound1135Log || [];
window.HardRoundReset1135Log = function(){
  window.HardRound1135Log = [];
};
function _hr1135Store(snap){
  window.HardRound1135Log.push(snap);
  if(window.HardRound1135Log.length>30)window.HardRound1135Log.splice(0,window.HardRound1135Log.length-30);
}
function _hr1135Log(event){
  const snap=_hr1135Snapshot(event);
  _hr1135Store(snap);
  if(window.HardRoundDebug1135)console.log(snap.tag,snap);
}
// Samples the same snapshot after two rAF boundaries (i.e. after the
// browser has had the chance to actually paint the DOM state as it stands
// right now), so we can tell whether a given synchronous state was ever
// the thing the browser composited, not just a value that existed in the
// DOM for zero frames.
function _hr1135LogAfterPaint(event){
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const snap=_hr1135Snapshot(event+'-post-paint');
    _hr1135Store(snap);
    if(window.HardRoundDebug1135)console.log(snap.tag,snap);
  }));
}
// Give device/pipeline creation the hover interval before pointer-down.
activeC.addEventListener('pointerenter',()=>{
  if(tool==='brush'&&typeof window!=='undefined'&&window.PrototypeRenderer)_hardRoundGetRenderer();
},{passive:true});

// Exact eligibility condition (Phase 8C §9). Procedural, not a preset-name
// check: any brush whose settings match this exactly gets the migrated
// behavior, and Hard Round itself would NOT match if the user changed any
// of these (e.g. lowered hardness, added a custom tip, turned on scatter),
// correctly falling back to the legacy path. See hard-round-adapter.js for
// the pure, unit-tested implementation.
function _hardRoundEligibleNow(){
  const fn = typeof window!=='undefined' && window.HardRoundAdapter && window.HardRoundAdapter.isHardRoundEligible;
  if(!fn) return false;
  return fn({
    tool,
    isPen: _isDrawingWithPen,
    hasCustomTip: !!window.brushTipCanvas,
    hardness: brushHardness,
    sizeControl: _getSizeControl(),
    roundness: window.brushTipRoundness,
    scatterEnabled: !!window._tsScatterEnabled,
    textureEnabled: !!(window.brushTextureEnabled && window.brushTextureCanvas && (typeof window.brushTextureStrength === 'undefined' || window.brushTextureStrength > 0)),
    airbrush: !!window._brushAirbrush,
  });
}

// Phase 8C completion: renders every PrototypeStrokeCore resolved segment
// as ONE continuous tapered capsule (x0,y0,r0)->(x1,y1,r1) via
// HardRoundCapsuleRenderer/HardRoundCapsuleGPU -- NOT via `_stampDab()`.
// This is the fix for the Phase 8C.1 finding: the old version above
// discarded x0/y0/pressure0/influence0 and stamped a single point dab per
// segment through the legacy rasterizer, which is exactly what made Hard
// Round still feel like the old brush. Every field of every resolved
// segment is now consumed: x0/y0/x1/y1 define the capsule axis, r0/r1
// (derived from pressure0/influence0 and pressure1/influence1 via
// HardRoundAdapter.resolveSegmentRenderParams, the SAME radius primitive
// used everywhere else in this module) define its continuous taper.
let _hardRoundNextStampIsFirst = false; // Phase 9E.4 -- see _hardRoundStampSegments doc
let _hardRoundNextStampIsLast = false;

// ---------------------------------------------------------------------
// Phase 11B.6 DIAGNOSTIC (opt-in via window.HardRoundDebugPhase11B6,
// default off/no-op). Read-only: never touches geometry, pressure,
// stabilization, AA, shaders, commit, pointer capture, or cursor CSS --
// it only OBSERVES existing counters/DOM state and records them.
//
// Correlates, per stage of the live-stroke path, the running segment/queue
// counts with the current cursor/hit-test/pointer-capture state, so a
// blink/cut can be checked against (a) whether any monitored count ever
// regresses and (b) whether the browser cursor was showing something other
// than the app's own crosshair at that same moment.
// ---------------------------------------------------------------------
window.HardRoundPhase11B6Log = window.HardRoundPhase11B6Log || [];
window.HardRoundReset11B6Log = function(){ window.HardRoundPhase11B6Log = []; };
let _hr11b6InputSampleCount = 0;
let _hr11b6GeneratedSegmentCount = 0;
let _hr11b6MaxPending = 0;
let _hr11b6MaxRendererSegments = 0;
function _hr11b6CursorSnapshot(e){
  if(!e || typeof e.clientX!=='number') return null;
  let elAtPoint=null, cursorAtPoint=null;
  try{
    elAtPoint = document.elementFromPoint(e.clientX, e.clientY);
    cursorAtPoint = elAtPoint ? getComputedStyle(elAtPoint).cursor : null;
  }catch(_){}
  let hasCapture=null;
  try{ hasCapture = typeof e.pointerId==='number' && activeC.hasPointerCapture ? activeC.hasPointerCapture(e.pointerId) : null; }catch(_){}
  return {
    eventTarget: e.target && (e.target.id||e.target.tagName) || null,
    pointerId: e.pointerId!=null?e.pointerId:null,
    activeCHasCapture: hasCapture,
    elementAtPoint: elAtPoint && (elAtPoint.id||elAtPoint.tagName) || null,
    cursorAtPoint,
    activeCCursorStyle: activeC && activeC.style ? activeC.style.cursor : null,
  };
}
function _hr11b6Log(stage, e, extra){
  if(!window.HardRoundDebugPhase11B6) return;
  const renderer=_hardRoundRenderer;
  const entry = Object.assign({
    stage,
    timestamp: performance.now(),
    strokeId: _activeStrokeSession,
    previewGeneration: _hardRoundPreviewGeneration,
    inputSampleCount: _hr11b6InputSampleCount,
    generatedSegmentCount: _hr11b6GeneratedSegmentCount,
    pendingQueueLength: _hardRoundPendingRenderSegments.length,
    rendererSegmentCount: renderer ? renderer._segmentCount : null,
  }, _hr11b6CursorSnapshot(e), extra||{});
  // First-regression tracking: a monitored count dropping below its own
  // running max for this stroke is the signal deliverables 2-4 ask about.
  if(entry.pendingQueueLength>_hr11b6MaxPending) _hr11b6MaxPending=entry.pendingQueueLength;
  else if(entry.pendingQueueLength<_hr11b6MaxPending && !window.HardRoundFirst11B6Regression){
    window.HardRoundFirst11B6Regression = Object.assign({kind:'pendingQueueLength', maxSoFar:_hr11b6MaxPending}, entry);
  }
  if(entry.rendererSegmentCount!=null){
    if(entry.rendererSegmentCount>_hr11b6MaxRendererSegments) _hr11b6MaxRendererSegments=entry.rendererSegmentCount;
    else if(entry.rendererSegmentCount<_hr11b6MaxRendererSegments && !window.HardRoundFirst11B6Regression){
      window.HardRoundFirst11B6Regression = Object.assign({kind:'rendererSegmentCount', maxSoFar:_hr11b6MaxRendererSegments}, entry);
    }
  }
  const log=window.HardRoundPhase11B6Log;
  log.push(entry);
  if(log.length>500) log.splice(0, log.length-500);
}
// Summarizes the log: whether any monitored count ever regressed
// (deliverables 2-4), and whether any entry recorded a non-crosshair
// cursor while pointer capture was still held on activeC (i.e. cursor
// changed WITHOUT input actually leaving the drawing surface -- deliverable
// 4-5). Read-only.
window.HardRoundAnalyze11B6 = function(){
  const log=(window.HardRoundPhase11B6Log||[]).slice();
  const cursorAnomalies = log.filter(e=>e.activeCHasCapture===true && e.elementAtPoint && e.elementAtPoint!=='active-canvas');
  return {
    totalEntries: log.length,
    firstRegression: window.HardRoundFirst11B6Regression || null,
    cursorAnomalyCount: cursorAnomalies.length,
    firstCursorAnomaly: cursorAnomalies[0]||null,
    // Same-timestamp-neighborhood check: does a cursor anomaly land within
    // ~1 frame (16ms) of the first regression, if any?
    cursorNearFirstRegression: (window.HardRoundFirst11B6Regression && cursorAnomalies.length)
      ? cursorAnomalies.some(e=>Math.abs(e.timestamp-window.HardRoundFirst11B6Regression.timestamp)<16)
      : null,
    log,
  };
};
function _hardRoundStampSegments(segments, e){
  if(!segments || !segments.length) return;
  const brushDiagStart=window.BrushDebugPerf?performance.now():0;
  // Phase 9E.4: mark the stroke's true open start/end (not just this
  // batch's first/last -- batches are per pointermove, the stroke's own
  // first/last segment is only ever the single beginStroke() dab and the
  // final finishStroke() segment respectively) so the renderer can give
  // those two tips a strict 1px point test instead of the conservative
  // connectivity dilation used everywhere else. Callers set
  // _hardRoundNextStampIsFirst/_hardRoundNextStampIsLast just before
  // invoking this function (see call sites below) rather than an added
  // parameter, so this function keeps its original two-argument
  // signature for source-matching tests elsewhere in this suite.
  if(_hardRoundNextStampIsFirst){ segments[0].isStrokeStart = true; _hardRoundNextStampIsFirst = false; }
  if(_hardRoundNextStampIsLast){ segments[segments.length-1].isStrokeEnd = true; _hardRoundNextStampIsLast = false; }
  const adapter = typeof window!=='undefined' && window.HardRoundAdapter;
  const renderer = _hardRoundRenderer;
  if(!adapter || !renderer) return;
  const baseSize = getBrushSize();
  const minSizeFrac = _getMinSize();
  const curveKey = _getPressureCurve('size');
  const isErase = tool==='eraser';
  const rgb = isErase ? [0,0,0] : _hexToRGB(color);
  const composite = isErase ? 'erase' : 'paint';
  const aaMode = _currentAAMode();
  const previousFlowRatio = _flowSpacingRatio;
  const savedPressure = currentPressure;
  // Flow/Opacity dynamics (§9/§10 of Phase 8C.1's scope note: "do not
  // patch pressure again") still run through the existing, untouched
  // _getEffectiveBrushParams alpha pipeline, once per endpoint -- only its
  // radius output is discarded here, since the segment's own r0/r1 (from
  // PrototypeStrokeCore, via HardRoundAdapter) replace that per-dab
  // Size-dynamics computation entirely for migrated Hard Round strokes.
  _flowSpacingRatio = 1;
  const renderSegs = [];
  const _hrMtAdapterStart = _hrMtActive() ? performance.now() : null;
  for(const seg of segments){
    currentPressure = seg.pressure0;
    const alpha0 = _getEffectiveBrushParams(e).alpha;
    currentPressure = seg.pressure1;
    const alpha1 = _getEffectiveBrushParams(e).alpha;

    const resolved=adapter.resolveSegmentRenderParams(seg, {
      baseSize, minSizeFrac, curveKey, applyPressureCurve: _applyPressureCurve,
      matchPrototypePressure: true,
      rgb, composite, hardness: brushHardness, aaMode,
      getEffectiveAlpha: (pressure) => (pressure===seg.pressure0 ? alpha0 : alpha1),
    });
    renderSegs.push(resolved);
    _brushDiagPerfNote('resolved',{count:1,radius:(resolved.r0+resolved.r1)/2,minRadius:Math.min(resolved.r0,resolved.r1),maxRadius:Math.max(resolved.r0,resolved.r1)});
    const resolvedLength=Math.hypot(resolved.x1-resolved.x0,resolved.y1-resolved.y0);
    if(resolvedLength>0)_brushDiagPerfNote('spacing',{step:resolvedLength});
  }
  if(_hrMtAdapterStart!=null) _hrMtRecord('HardRoundAdapter.resolveSegmentRenderParams-loop', _hrMtAdapterStart, performance.now());
  // PrototypeRenderer.drawSegments() accumulates into its own private SS=4
  // backing store (max-blended coverage). It is not painted to any
  // on-screen/scratch canvas by drawSegments() itself, so no per-segment
  // dirty-rect growth or direct canvas draw happens here -- but
  // _hardRoundPresentLivePreview() below resolves the CURRENT accumulation
  // (via PrototypeRenderer.peekStroke(), Phase 9C.1) into the existing
  // live-preview scratch surface after every batch, so the stroke stays
  // continuously visible while drawing, matching prototype/prototype.html's
  // own per-batch present(). The final, authoritative resolve still happens
  // once via endStroke() at pointerup (see the pointerup call site below).
  _hardRoundPendingRenderSegments.push(...renderSegs);
  // TEMP DIAGNOSTIC (Phase 11A.27): opt-in only. Logs how many render-ready
  // segments this call added to the pending queue, and the queue's total
  // length afterward -- the two numbers the phase asks for
  // ("_hardRoundStampSegments count" and "_hardRoundPendingRenderSegments
  // count").
  if(window.HardRoundDebugCaptureLastLiveFrame&&window.HardRoundGeometryMutationLog){
    window.HardRoundGeometryMutationLog.push({
      fn:'_hardRoundStampSegments',
      timestamp:performance.now(),
      addedCount:renderSegs.length,
      pendingQueueLengthAfter:_hardRoundPendingRenderSegments.length,
    });
  }
  currentPressure = savedPressure;
  _flowSpacingRatio = previousFlowRatio;
  _hr11b6Log('stampSegments-pushed-pending', e);
  const _hrMtReqPreviewStart = _hrMtActive() ? performance.now() : null;
  _hardRoundRequestLivePreview(renderer);
  if(brushDiagStart)_brushDiagPerfNote('processing',{ms:performance.now()-brushDiagStart});
  if(_hrMtReqPreviewStart!=null) _hrMtRecord('_hardRoundRequestLivePreview', _hrMtReqPreviewStart, performance.now());
}

// Phase 9C.1: resolves PrototypeRenderer's CURRENT (still in-progress)
// backing-store accumulation into the existing live-preview scratch
// surface (_strokeCanvas/_strokeCtx -- the exact same surface
// _getLiveStrokePreview()/recomposite() already read for every other
// brush's live preview) without ending the stroke, then asks for a
// recomposite so it's actually shown. Reuses the existing preview pipeline
// end-to-end: PrototypeRenderer.peekStroke() is the only new capability;
// everything downstream of writing into _strokeCtx is unchanged.
//
// peekStroke() is async (the opt-in GPU path's readback is), so the paint
// happens inside a .then() continuation rather than synchronously. The
// CPU path used in production resolves on the very next microtask, which
// always runs before the browser dispatches the next pointer event, so
// this stays visually continuous. A session guard discards a stale
// resolve that lands after this stroke already ended (pointerup/cancel) or
// after a different stroke has since started.
//
// Phase 9C.1 perf fix: this used to be invoked directly, once per
// pointermove/pointerrawupdate event, which made it call
// PrototypeRenderer.peekStroke() -> _resolveToOutput() (a full box-filter
// downsample of the entire SS=4 backing store) as often as the input
// device fires -- up to ~1000Hz for a pen via pointerrawupdate. That is
// the source of the added lag: drawSegments() (the actual sample
// accumulation) is cheap and must stay per-event so no sample is ever
// dropped, but resolving+presenting is expensive and only needs to happen
// as often as the screen can show it. prototype/prototype.html keeps this
// same split -- moveStroke() only pushes samples into a queue, and a
// persistent requestAnimationFrame loop (strokeHoldTick) is the sole
// place that composites/presents, at most once per display frame. This
// function is now only the "do the resolve" half; the per-event path
// calls _hardRoundRequestLivePreview() (below) instead.
//
// ---------------------------------------------------------------------
// Phase 11A.30 -- generation-safe LAST_LIVE bookkeeping.
//
// _hardRoundLiveFrameGeneration is a monotonically increasing counter
// representing PRESENTATION order (the order frames are accepted below),
// NOT asynchronous readback-completion order. It is bumped once per
// accepted frame, for every stroke/session, and never reset -- so a
// generation number alone is enough to tell two accepted frames apart
// regardless of which stroke they belong to.
//
// _hardRoundLastAcceptedLiveMetadataBySession records, per stroke/session
// id, the metadata for the newest frame that has been ACCEPTED (passed the
// session/generation/result checks below) -- updated synchronously at
// accept time, before any GPU diagnostic readback starts. This is what
// _pointerEndStroke's synchronous freeze (window.HardRoundFrozenLiveMetadata)
// reads, so that freeze never has to wait on an in-flight readback.
//
// window.HardRoundLiveCaptureLog keeps only the most recent ~25 accepted
// entries, each recording generation, strokeId/sessionId,
// segmentCountAtAccept, acceptedAt, readbackStartedAt, readbackCompletedAt,
// becameLastLive, wasStale, and staleReason -- enough to prove whether
// diagnostic readbacks complete out of presentation order.
// ---------------------------------------------------------------------
let _hardRoundLiveFrameGeneration = 0;
const _hardRoundLastAcceptedLiveMetadataBySession = {};
if(typeof window!=='undefined' && !window.HardRoundLiveCaptureLog){
  window.HardRoundLiveCaptureLog = [];
}
function _hardRoundPushLiveCaptureLogEntry(entry){
  const log = window.HardRoundLiveCaptureLog || (window.HardRoundLiveCaptureLog=[]);
  log.push(entry);
  if(log.length>25) log.splice(0, log.length-25);
}
// ---------------------------------------------------------------------
// Phase 11A.31 (DIAGNOSTIC ONLY -- no behavior change) -- fast-stroke
// live-preview blink investigation.
//
// Opt-in via window.HardRoundDebugPreviewOrder = true. When off (default),
// every line this block adds is a no-op (a single boolean check) and the
// original scheduling/present/overlay logic below is untouched byte-for-
// byte in its control flow -- this only ADDS observation points, it never
// changes what runs, when it runs, or what it returns.
//
// Purpose: prove or disprove whether an older peekStroke()/present() call
// can complete (and show its pixels) AFTER a newer one, i.e. whether
// presentation COMPLETION order can differ from presentation REQUEST
// order. That would explain "already-visible live GPU stroke disappears
// for a frame, then recovers" without touching segment generation,
// pressure, stabilization, AA, commit, or finishStroke.
//
// Each request to _hardRoundPresentLivePreview gets one monotonically
// increasing generation number, assigned at REQUEST time (i.e. request
// order == generation order, by construction). We then log, per
// generation: segment counts at request/submit/resolve, the three
// timestamps, whether this resolve was already stale by generation/
// session at resolve time, and whether it ended up actually showing
// pixels (overlayShown). window.HardRoundAnalyzePreviewOrder() then
// checks whether any generation's resolveTime is later than a
// numerically-later generation's resolveTime that already committed
// pixels -- i.e. completion order differing from request order.
// ---------------------------------------------------------------------
let _hardRoundPreviewOrderGeneration = 0;
if (typeof window !== 'undefined' && !window.HardRoundPreviewOrderLog) {
  window.HardRoundPreviewOrderLog = [];
}
function _hardRoundPreviewOrderPush(entry) {
  const log = window.HardRoundPreviewOrderLog || (window.HardRoundPreviewOrderLog = []);
  log.push(entry);
  if (log.length > 300) log.splice(0, log.length - 300);
}
if (typeof window !== 'undefined') {
  // Summarizes window.HardRoundPreviewOrderLog for the CURRENT (or most
  // recent) stroke and reports whether any accepted (overlayShown=true)
  // entry resolved after a numerically later generation had already been
  // accepted -- i.e. proof of out-of-order presentation completion.
  window.HardRoundAnalyzePreviewOrder = function () {
    const log = (window.HardRoundPreviewOrderLog || []).slice();
    const accepted = log.filter(e => e.overlayShown).sort((a, b) => a.resolveTime - b.resolveTime);
    let outOfOrder = [];
    let highestGenSoFar = -1;
    for (const e of accepted) {
      if (e.generation < highestGenSoFar) {
        outOfOrder.push({
          generation: e.generation,
          resolvedAfterGeneration: highestGenSoFar,
          segmentCountAtResolve: e.segmentCountAtResolve,
          resolveTime: e.resolveTime,
        });
      } else {
        highestGenSoFar = e.generation;
      }
    }
    return {
      totalEntries: log.length,
      acceptedEntries: accepted.length,
      outOfOrderCount: outOfOrder.length,
      outOfOrderEvents: outOfOrder,
      provesOutOfOrderCompletion: outOfOrder.length > 0,
      log,
    };
  };
}
// ---------------------------------------------------------------------
// Phase 11B.7 DIAGNOSTIC (opt-in via window.HardRoundDebugLiveFrameRegression,
// default off/no-op). Read-only: never touches geometry, pressure,
// stabilization, AA, shaders, commit, pointer capture, cursor CSS, or the
// existing display-composition fix. Invoked ONLY at the real GPU-overlay
// accept point inside _hardRoundPresentLivePreview below (the production
// path -- not the 11B.5 canvas-live-presentation diagnostic redirect,
// which never touches the overlay).
//
// Purpose: answer whether an ACCEPTED live-preview frame ever visually
// loses stroke coverage that a strictly-earlier accepted frame from the
// SAME stroke already had, even though rendererSegmentCount is monotonic
// non-decreasing between them. If so, the blink is a genuinely regressed
// presented frame; if not (no coverage loss is ever recorded across
// accepted frames while the blink is reproduced), the blink is an
// overlay/display visibility issue rather than bad pixel content.
//
// Each accepted GPU frame is drawn (via drawImage, a cheap
// CanvasImageSource copy) into a small downscaled off-screen 2D canvas
// (longest side capped at DIAG_11B7_MAX_DIM px) so cost stays bounded
// regardless of document size. Only ONE previous downscaled coverage
// snapshot is retained at a time (not a per-frame history), so memory
// stays flat. A binary coverage mask (alpha > threshold) is compared
// bit-for-bit against the previous snapshot: pixels that were covered
// before and are NOT covered now are "lost coverage". Pure AA/color/
// alpha-magnitude shifts that don't cross the coverage threshold in
// either direction are deliberately excluded from that count, so normal
// antialiasing/opacity changes don't register as false positives.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Phase 11B.8 CORRECTION (opt-in via window.HardRoundDebugLiveFrameRegression,
// default off/no-op). Read-only.
//
// Phase 11B.7's drawImage()-based capture of the WebGPU overlay canvas
// (_hardRoundGpuOverlay()) reported differingPixelCount:0 across 25
// consecutive accepted frames even while rendererSegmentCount rose
// 131->491. That is not evidence the presented pixels were actually
// identical -- it's a known WebGPU-canvas sampling gap:
//
//   present() awaits device.queue.onSubmittedWorkDone(), which only
//   confirms the GPU finished executing the submitted commands. It says
//   nothing about whether the browser has performed its own "update the
//   rendering" step that copies/composites the configured canvas context's
//   current texture into that <canvas> element's presented output bitmap.
//   That step is tied to the UA's rendering opportunities (effectively
//   rAF-timed), not to GPU command completion. drawImage()/getImageData()
//   read from the canvas element's OUTPUT bitmap, not from strokeMaskTex or
//   the just-submitted texture directly -- so a synchronous capture taken
//   immediately after present() resolves (as 11B.7 did, inside the same
//   microtask chain, before any rendering opportunity has occurred) can
//   legitimately observe a stale/unchanged output bitmap on every call,
//   producing a systematic false "no diff" across an entire stroke. This
//   is a capture-timing gap in the diagnostic, not proof the real
//   displayed frames were identical.
//
// Fix for the DIAGNOSTIC (not the app): stop sampling the presentation
// canvas at all. Read directly from strokeMaskTex instead, via the
// existing renderer.gpu.diagResolveIntoBuffer() -- the same non-mutating,
// read-only GPU buffer readback already used by the 11A.27 LAST_LIVE
// diagnostic. It renders strokeMaskTex through the real resolve pipeline
// into a scratch texture and reads that back with copyTextureToBuffer(),
// entirely independent of the outputContext/swapchain/canvas element --
// so its timing can't be confounded by canvas-presentation lag the way
// drawImage() was. _hrHashBuffer() (already defined above, used by
// 11A.27) gives nonTransparent count + a content hash for it.
// ---------------------------------------------------------------------
let _hr11b7Counter = 0;
let _hr11b7PrevHash = null; // { strokeId, previewId, rendererSegmentCount, hashed }
if (typeof window !== 'undefined' && !window.HardRoundLiveFrameRegressionLog) {
  window.HardRoundLiveFrameRegressionLog = [];
}
function _hr11b7PushLog(entry) {
  const log = window.HardRoundLiveFrameRegressionLog || (window.HardRoundLiveFrameRegressionLog = []);
  log.push(entry);
  if (log.length > 100) log.splice(0, log.length - 100);
}
// Reads strokeMaskTex directly (bypassing the presentation canvas
// entirely) and compares against the previous accepted frame from the
// SAME strokeId. Fire-and-forget async -- callers must not await this in
// the production accept path, so it can never delay
// _hardRoundSetGpuOverlayVisible(true) or any other real behavior.
async function _hr11b7CompareAndRecord(renderer, strokeId, rendererSegmentCount) {
  if (!renderer || !renderer.gpu || !renderer.gpu.ready) return;
  let buf = null;
  try { buf = await renderer.gpu.diagResolveIntoBuffer(renderer._rgb, renderer._composite); } catch (err) { return; }
  const hashed = _hrHashBuffer(buf, '11B8-accepted');
  const previewId = ++_hr11b7Counter;
  const prev = _hr11b7PrevHash;
  if (prev && prev.strokeId === strokeId) {
    const diff = _hrDiffHashes(prev.hashed, hashed);
    const segmentsMonotonic = rendererSegmentCount >= prev.rendererSegmentCount;
    const entry = {
      strokeId,
      previousPreviewId: prev.previewId,
      newPreviewId: previewId,
      previousRendererSegmentCount: prev.rendererSegmentCount,
      newRendererSegmentCount: rendererSegmentCount,
      segmentsMonotonic,
      previousNonTransparent: prev.hashed.nonTransparent,
      newNonTransparent: hashed.nonTransparent,
      previousHash: prev.hashed.hash,
      newHash: hashed.hash,
      imageChanged: diff ? !diff.hashEqual : null,
      nonTransparentDelta: diff ? diff.nonTransparentDelta : null,
      timestamp: performance.now(),
    };
    _hr11b7PushLog(entry);
    // A real regression: segment count didn't drop, but strokeMaskTex's
    // own coverage count did -- this can no longer be blamed on canvas-
    // presentation lag, since diagResolveIntoBuffer() never touches the
    // canvas/swapchain.
    if (segmentsMonotonic && entry.nonTransparentDelta != null && entry.nonTransparentDelta < 0 && !window.HardRoundFirstLiveFrameRegression) {
      window.HardRoundFirstLiveFrameRegression = entry;
    }
  }
  _hr11b7PrevHash = { strokeId, previewId, rendererSegmentCount, hashed };
}
window.HardRoundAnalyzeLiveFrameRegression = function () {
  const log = (window.HardRoundLiveFrameRegressionLog || []).slice();
  return {
    totalComparisons: log.length,
    // "Suspicious" = image genuinely unchanged (by hash) despite the
    // renderer segment count having grown between the two accepted frames
    // -- the exact symptom being checked for, now measured against
    // strokeMaskTex directly instead of the presentation canvas.
    suspiciousNoChangeWhileGrowing: log.filter(e => e.segmentsMonotonic && e.newRendererSegmentCount > e.previousRendererSegmentCount && e.imageChanged === false).length,
    regressionsFound: log.filter(e => e.segmentsMonotonic && e.nonTransparentDelta != null && e.nonTransparentDelta < 0).length,
    firstRegression: window.HardRoundFirstLiveFrameRegression || null,
    log,
  };
};
// Phase 11B.12 TEMP DIAGNOSTIC (opt-in via
// window.HardRoundDebugPaintedOverlayCompare, default off). Everything
// established so far (11B.7/11B.8/11B.9/11B.10/11B.11) reads strokeMaskTex
// directly and never looks at what the browser actually painted for the
// WebGPU presentation canvas itself. This closes that gap: for an accepted
// live GPU preview, capture the reliable expected frame (same non-mutating
// diagResolveIntoBuffer() readback 11B.7/11B.8 already use) and, completely
// separately and without awaiting/delaying the real preview path, sample
// what the overlay canvas actually shows after the browser has genuinely
// had a chance to paint it (two rAF boundaries -- a single rAF callback
// runs BEFORE paint, not after, same reasoning already used by
// _hardRoundPresentFinishedFrame's own two-rAF wait). Then diffs the two
// pixel-for-pixel to find coverage present in strokeMaskTex but missing
// from what was actually painted.
//
// Fire-and-forget only: callers (see the accepted-frame branch in
// _hardRoundPresentLivePreview below) must call this with .catch(()=>{})
// and never await it. Never calls GpuBackend.present(), never touches
// overlay visibility/display, never mutates strokeMaskTex or geometry --
// diagResolveIntoBuffer() and reading the overlay via drawImage()/
// getImageData() are both read-only.
window.HardRoundPaintedOverlayCompareLog = window.HardRoundPaintedOverlayCompareLog || [];
window.HardRoundResetPaintedOverlayCompareLog = function(){
  window.HardRoundPaintedOverlayCompareLog = [];
};
let _hr1112PreviewIdCounter = 0;
// Tracks the most recently ACCEPTED preview id so a comparison started for
// an earlier preview can detect it was superseded by a later accepted
// preview before its own painted capture happened -- distinct from (and in
// addition to) the existing _hardRoundPreviewGeneration check, which only
// changes on cancel/stroke-end, not on every accepted frame within one
// stroke.
let _hr1112LatestAcceptedPreviewId = 0;
let _hr1112PaintedCompareCanvas = null; // reused scratch 2D canvas
function _hr1112PushLog(entry){
  window.HardRoundPaintedOverlayCompareLog.push(entry);
  if (window.HardRoundPaintedOverlayCompareLog.length > 50) {
    window.HardRoundPaintedOverlayCompareLog.splice(0, window.HardRoundPaintedOverlayCompareLog.length - 50);
  }
}
// Pixel-for-pixel diff: coverage present in `expectedBuf` (strokeMaskTex
// readback) but alpha===0 in `paintedData` (what the overlay canvas
// actually shows). Both are same-size RGBA buffers by construction (the
// overlay canvas is always sized renderer.w x renderer.h -- see
// GpuBackend.init() -- matching diagResolveIntoBuffer()'s own output).
function _hr1112ComputeLostCoverage(expectedBuf, paintedData, w, h){
  let lostCount = 0, minX = w, minY = h, maxX = -1, maxY = -1;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const idx = (yy * w + xx) * 4;
      const expectedAlpha = expectedBuf[idx + 3];
      const paintedAlpha = paintedData[idx + 3];
      if (expectedAlpha > 0 && paintedAlpha === 0) {
        lostCount++;
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
      }
    }
  }
  return { lostCoveragePixelCount: lostCount, lostCoverageBounds: maxX >= minX ? { minX, minY, maxX, maxY } : null };
}
async function _hr1112CompareAndRecord(renderer, strokeId, rendererSegmentCount, previewGenerationAtAccept){
  if (!renderer || !renderer.gpu || !renderer.gpu.ready) return;
  const previewId = ++_hr1112PreviewIdCounter;
  _hr1112LatestAcceptedPreviewId = previewId;
  // present() for this accepted frame has already run and resolved by the
  // time this branch executes (peekStroke() already returned) -- this is
  // the best available approximation of its submit time without hooking
  // present() itself, which this diagnostic deliberately does not do.
  const presentSubmitTime = performance.now();
  let expectedBuf = null;
  try { expectedBuf = await renderer.gpu.diagResolveIntoBuffer(renderer._rgb, renderer._composite); }
  catch (err) { return; }
  if (!expectedBuf) return;
  const expectedReadbackTime = performance.now();
  const expectedHashed = _hrHashBuffer(expectedBuf, '11B12-expected');

  // Give the browser a genuine rendering opportunity before sampling what
  // it actually painted. A rAF callback runs BEFORE the browser paints, so
  // one boundary is the minimum; wait a second as a safety margin (same
  // pattern already used by _hardRoundPresentFinishedFrame).
  let rafBoundariesWaited = 0;
  await new Promise(resolve => requestAnimationFrame(() => { rafBoundariesWaited = 1; resolve(); }));
  await new Promise(resolve => requestAnimationFrame(() => { rafBoundariesWaited = 2; resolve(); }));

  // Supersede check, done AFTER the paint wait (i.e. right before the
  // painted capture): if a later preview has since been accepted, or the
  // stroke has since been cancelled/ended (generation bump), the overlay
  // may legitimately show different/newer content by now -- comparing it
  // against THIS preview's expected buffer would compare mismatched
  // frames, not demonstrate lost coverage. Excluded from conclusions, not
  // silently dropped, so it's still visible in the log.
  const supersededByNewerPreview = _hr1112LatestAcceptedPreviewId !== previewId;
  const supersededByGenerationChange = previewGenerationAtAccept !== _hardRoundPreviewGeneration;
  const superseded = supersededByNewerPreview || supersededByGenerationChange;

  const overlay = _hardRoundGpuOverlay();
  let paintedHashed = { error: 'no-overlay' };
  let lostCoverage = { lostCoveragePixelCount: null, lostCoverageBounds: null };
  if (overlay) {
    try {
      if (!_hr1112PaintedCompareCanvas) _hr1112PaintedCompareCanvas = document.createElement('canvas');
      const cap = _hr1112PaintedCompareCanvas;
      if (cap.width !== expectedBuf.w || cap.height !== expectedBuf.h) {
        cap.width = expectedBuf.w; cap.height = expectedBuf.h;
      }
      const capCtx = cap.getContext('2d');
      capCtx.clearRect(0, 0, cap.width, cap.height);
      capCtx.drawImage(overlay, 0, 0, cap.width, cap.height);
      const paintedData = capCtx.getImageData(0, 0, cap.width, cap.height).data;
      paintedHashed = _hrHashBuffer({ data: paintedData, w: cap.width, h: cap.height }, '11B12-painted');
      if (!superseded) {
        lostCoverage = _hr1112ComputeLostCoverage(expectedBuf.data, paintedData, expectedBuf.w, expectedBuf.h);
      }
    } catch (err) {
      paintedHashed = { error: String(err) };
    }
  }
  const paintedCaptureTime = performance.now();
  _hr1112PushLog({
    strokeId,
    previewId,
    rendererSegmentCount,
    presentSubmitTime,
    expectedReadbackTime,
    paintedCaptureTime,
    rafBoundariesWaited,
    expectedNonTransparent: expectedHashed.nonTransparent != null ? expectedHashed.nonTransparent : null,
    paintedNonTransparent: paintedHashed.nonTransparent != null ? paintedHashed.nonTransparent : null,
    lostCoveragePixelCount: lostCoverage.lostCoveragePixelCount,
    lostCoverageBounds: lostCoverage.lostCoverageBounds,
    expectedHash: expectedHashed.hash != null ? expectedHashed.hash : null,
    paintedHash: paintedHashed.hash != null ? paintedHashed.hash : null,
    superseded,
    supersededReason: superseded ? (supersededByNewerPreview ? 'superseded-by-newer-accepted-preview' : 'preview-generation-changed') : null,
  });
}
// Console entry point. Excludes superseded comparisons from the
// lost-coverage conclusion (their painted-vs-expected mismatch may simply
// reflect legitimate newer content, not lost coverage) but keeps them in
// the returned log for inspection.
window.HardRoundAnalyzePaintedOverlayCompare = function(){
  const log = (window.HardRoundPaintedOverlayCompareLog || []).slice();
  const usable = log.filter(e => !e.superseded && e.lostCoveragePixelCount != null);
  const withLostCoverage = usable.filter(e => e.lostCoveragePixelCount > 0);
  let maxLost = 0;
  withLostCoverage.forEach(e => { if (e.lostCoveragePixelCount > maxLost) maxLost = e.lostCoveragePixelCount; });
  return {
    totalComparisons: log.length,
    comparisonsWithLostCoverage: withLostCoverage.length,
    maxLostCoveragePixelCount: withLostCoverage.length ? maxLost : 0,
    firstLostCoverage: withLostCoverage.length ? withLostCoverage[0] : null,
    log,
  };
};
function _hardRoundPresentLivePreview(renderer){
  if(!renderer || !_inStroke || !_strokeCtx || !_strokeCanvas) return;
  const _hrMtSetupStart = _hrMtActive() ? performance.now() : null;
  const session = _activeStrokeSession;
  // Phase 11A.5: capture the current preview generation. See
  // _hardRoundPreviewGeneration below for why this check exists in
  // addition to the session/_inStroke checks already here.
  const previewGeneration = _hardRoundPreviewGeneration;
  // --- diagnostic (11A.31): request-time bookkeeping, opt-in, read-only ---
  const _dbgOrderOn = typeof window!=='undefined' && !!window.HardRoundDebugPreviewOrder;
  let _dbgOrderEntry = null;
  if (_dbgOrderOn) {
    _dbgOrderEntry = {
      generation: ++_hardRoundPreviewOrderGeneration,
      strokeId: session,
      segmentCountAtRequest: renderer._segmentCount,
      segmentCountAtPresentSubmit: null,
      segmentCountAtResolve: null,
      requestTime: performance.now(),
      presentSubmitTime: performance.now(), // peekStroke() call below is the submit point
      resolveTime: null,
      staleAtResolve: false,
      staleReason: null,
      overlayShown: false,
      isGpu: !!(renderer.isGpuActive && renderer.isGpuActive()),
    };
  }
  // --- end diagnostic request-time bookkeeping ---
  // --- diagnostic (11B.10): request-time bookkeeping, opt-in, read-only ---
  const livePreviewId = window.HardRoundDebugLivePreviewCrossover ? ++_hr1110LivePreviewIdCounter : null;
  const _hr1110Entry = livePreviewId!=null ? _hr1110PushRequest({
    strokeId: session,
    livePreviewId,
    requestTime: performance.now(),
    presentSubmitTime: null,
    resolveTime: null,
    pointerupStartedAt: _hr1110PointerupStartedAtBySession[session]!=null ? _hr1110PointerupStartedAtBySession[session] : null,
    finishedFrameStartedAt: _hr1110FinishedFrameStartedAtBySession[session]!=null ? _hr1110FinishedFrameStartedAtBySession[session] : null,
    generationAtRequest: previewGeneration,
    generationAtSubmit: null,
    generationAtResolve: null,
    presentationSubmitted: false,
    accepted: false,
    rejectReason: null,
    // Phase 11B.11 additions: state at resolve time, for the
    // zero-accepted-stroke analyzer.
    activeStrokeSessionAtResolve: null,
    hardRoundStrokeActiveAtResolve: null,
    inStrokeAtResolve: null,
    rendererSegmentCountAtResolve: null,
  }) : null;
  // --- end 11B.10 request-time bookkeeping ---
  // --- 11B.13 frame-stall diagnostic: request-time bookkeeping ---
  const _hrFsPresentStart = _hrFsRecordPresentStart();
  // --- end 11B.13 request-time bookkeeping ---
  if(_hrMtSetupStart!=null) _hrMtRecord('_hardRoundPresentLivePreview-sync-setup', _hrMtSetupStart, performance.now());
  // Phase 11A.39: pass this call's strokeId (session) through to
  // peekStroke() -> GpuBackend.present() purely so the opt-in
  // window.HardRoundGpuPresentLog diagnostic can attribute each real
  // present()/submit() to the stroke that requested it. Read-only; does not
  // change which frame is requested, resolved, or accepted below.
  // livePreviewId (11B.10, opt-in) is likewise passed through untouched, so
  // GpuBackend.present() can record submit-time info keyed by it -- see
  // window.HardRoundLivePreviewSubmitInfo above. Neither field affects
  // which frame is requested, resolved, or accepted.
  const presentationBarrier=_hardRoundActiveContext&&_hardRoundActiveContext.strokeId===session
    ?_hardRoundActiveContext.presentationBarrier:null;
  return Promise.resolve(presentationBarrier).then(()=>{
    if(previewGeneration!==_hardRoundPreviewGeneration||session!==_activeStrokeSession||!_inStroke)return null;
    return renderer.peekStroke({ strokeId: session, segmentCount: renderer._segmentCount, livePreviewId });
  }).then(async result=>{
    if(previewGeneration!==_hardRoundPreviewGeneration)return;
    // --- 11B.13 frame-stall diagnostic: resolve-time bookkeeping ---
    _hrFsRecordPresentResolve(_hrFsPresentStart);
    // --- end 11B.13 resolve-time bookkeeping ---
    // --- diagnostic (11A.31): resolve-time bookkeeping, opt-in, read-only.
    // Runs BEFORE the real guards below so we see every resolve, including
    // ones the real logic is about to reject as stale -- that rejection
    // path is exactly what we're trying to characterize (does it reject
    // correctly, or does a stale frame ever slip past because nothing here
    // re-checks completion order against a numerically newer generation
    // that already got shown)?
    if (_dbgOrderEntry) {
      _dbgOrderEntry.resolveTime = performance.now();
      _dbgOrderEntry.segmentCountAtResolve = renderer._segmentCount;
      if (previewGeneration!==_hardRoundPreviewGeneration) { _dbgOrderEntry.staleAtResolve=true; _dbgOrderEntry.staleReason='preview-generation-cancelled'; }
      else if (session!==_activeStrokeSession) { _dbgOrderEntry.staleAtResolve=true; _dbgOrderEntry.staleReason='session-changed'; }
      else if (!_inStroke || !_strokeCtx || !_strokeCanvas) { _dbgOrderEntry.staleAtResolve=true; _dbgOrderEntry.staleReason='stroke-ended'; }
      else if (!result || !result.canvas) { _dbgOrderEntry.staleAtResolve=true; _dbgOrderEntry.staleReason='no-result'; }
    }
    // --- end diagnostic resolve-time bookkeeping (pre-guard) ---
    // --- diagnostic (11B.10): resolve-time bookkeeping, opt-in, read-only.
    // Computed once, before the real guards run, so a stale/rejected
    // preview is recorded exactly like an accepted one -- only the
    // accepted/rejectReason fields differ.
    if (_hr1110Entry) {
      _hr1110Entry.resolveTime = performance.now();
      _hr1110Entry.generationAtResolve = _hardRoundPreviewGeneration;
      _hr1110Entry.activeStrokeSessionAtResolve = _activeStrokeSession;
      _hr1110Entry.hardRoundStrokeActiveAtResolve = typeof _hardRoundStrokeActive!=='undefined' ? _hardRoundStrokeActive : null;
      _hr1110Entry.inStrokeAtResolve = _inStroke;
      _hr1110Entry.rendererSegmentCountAtResolve = renderer ? renderer._segmentCount : null;
      const submitInfo = window.HardRoundLivePreviewSubmitInfo[livePreviewId];
      if (submitInfo) {
        _hr1110Entry.presentationSubmitted = true;
        _hr1110Entry.presentSubmitTime = submitInfo.submitTime;
        _hr1110Entry.generationAtSubmit = submitInfo.generationAtSubmit;
        delete window.HardRoundLivePreviewSubmitInfo[livePreviewId];
      }
      if (previewGeneration!==_hardRoundPreviewGeneration) _hr1110Entry.rejectReason='preview-generation-cancelled';
      else if (session!==_activeStrokeSession) _hr1110Entry.rejectReason='session-changed';
      else if (!_inStroke || !_strokeCtx || !_strokeCanvas) _hr1110Entry.rejectReason='stroke-ended';
      else if (!result || !result.canvas) _hr1110Entry.rejectReason='no-result';
      else if(result.presentation&&result.presentation.presented===false) _hr1110Entry.rejectReason=result.presentation.reason||'presentation-rejected';
      else _hr1110Entry.accepted = true;
    }
    // --- end 11B.10 resolve-time bookkeeping ---
    if(previewGeneration!==_hardRoundPreviewGeneration) { _hr11b6Log('presentLivePreview-stale',_lastPointerEvent,{reason:'preview-generation-cancelled'}); if(_dbgOrderEntry)_hardRoundPreviewOrderPush(_dbgOrderEntry); return; }
    if(session!==_activeStrokeSession || !_inStroke || !_strokeCtx || !_strokeCanvas) { _hr11b6Log('presentLivePreview-stale',_lastPointerEvent,{reason:'session-or-stroke-ended'}); if(_dbgOrderEntry)_hardRoundPreviewOrderPush(_dbgOrderEntry); return; }
    if(!result || !result.canvas) { _hr11b6Log('presentLivePreview-stale',_lastPointerEvent,{reason:'no-result'}); if(_dbgOrderEntry)_hardRoundPreviewOrderPush(_dbgOrderEntry); return; }
    if(renderer.isGpuActive&&renderer.isGpuActive()&&(!result.presentation||result.presentation.presented!==true)){
      _hr11b6Log('presentLivePreview-rejected',_lastPointerEvent,{reason:result.presentation&&result.presentation.reason||'not-presented'});
      if(_dbgOrderEntry){_dbgOrderEntry.staleAtResolve=true;_dbgOrderEntry.staleReason=result.presentation&&result.presentation.reason||'not-presented';_hardRoundPreviewOrderPush(_dbgOrderEntry);}
      return;
    }
    _hr11b6Log('presentLivePreview-accepted',_lastPointerEvent,{resultSegmentCount:result.segmentCount});
    if(renderer.isGpuActive&&renderer.isGpuActive()){
      // Phase 11B.5 TEMP DIAGNOSTIC (opt-in, default off): when
      // window.HardRoundDebugCanvasLivePresentation is true,
      // renderer.peekStroke() (see prototype-renderer.js) already redirected
      // this live-preview call away from GpuBackend.present()/the WebGPU
      // overlay and instead did a non-mutating gpu.resolveInto() readback
      // into a plain Canvas2D canvas, returned here as result.canvas. Route
      // it through the EXACT SAME _strokeCtx draw + _scheduleRecomposite()
      // the CPU backend's branch below already uses, and explicitly keep
      // the WebGPU overlay hidden -- never call
      // _hardRoundSetGpuOverlayVisible(true) in this mode, for ANY live
      // preview frame. GPU accumulation/strokeMaskTex/rasterization are
      // untouched; only which surface the resolved pixels are drawn to
      // changes. finishStroke()/commit/_hardRoundPresentFinishedFrame() are
      // NOT touched by this flag -- it only affects this function.
      if(window.HardRoundDebugCanvasLivePresentation){
        if(result.canvas){
          _hardRoundSetGpuOverlayVisible(false,'presentLivePreview-canvasLivePresentationMode');
          _strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
          _strokeCtx.drawImage(result.canvas,0,0);
        }
        if(_dbgOrderEntry){ _dbgOrderEntry.overlayShown=false; _hardRoundPreviewOrderPush(_dbgOrderEntry); }
        _scheduleRecomposite();
        return;
      }
      // Phase 11A.30: this is the exact point a real live-preview frame has
      // been ACCEPTED for the current stroke session (session/generation/
      // result checks above all passed) and is about to be shown
      // (present() already ran inside peekStroke()/_resolveToOutput()
      // above). This accept-time bookkeeping runs whenever
      // window.HardRoundDebugCaptureLastLiveFrame is on (default off/
      // undefined -- normal live-preview behavior, overlay visibility and
      // timing, is completely unchanged either way). Never updated during
      // pointerup/finalization -- that path calls
      // _hardRoundPresentFinishedFrame(), a different function, which is
      // NOT hooked here.
      if(window.HardRoundDebugCaptureLastLiveFrame&&renderer.gpu&&renderer.gpu.ready){
        // Assign this frame's generation and record it as the newest
        // accepted generation for this session THE INSTANT presentation
        // order accepts it -- before the (asynchronous) diagnostic
        // readback below even starts. This is what makes the freeze in
        // _pointerEndStroke race-free: it never has to wait on a readback,
        // and any earlier generation's readback that completes later can
        // check against this value to detect it has been superseded.
        const generation = ++_hardRoundLiveFrameGeneration;
        const acceptedAt = performance.now();
        const segmentCountAtAccept = renderer._segmentCount;
        _hardRoundLastAcceptedLiveMetadataBySession[session] = {generation,strokeId:session,segmentCountAtAccept,acceptedAt};
        const logEntry = {generation,strokeId:session,segmentCountAtAccept,acceptedAt,readbackStartedAt:null,readbackCompletedAt:null,becameLastLive:false,wasStale:false,staleReason:null};
        _hardRoundPushLiveCaptureLogEntry(logEntry);
        try{
          logEntry.readbackStartedAt=performance.now();
          const buf=await renderer.gpu.diagResolveIntoBuffer(renderer._rgb,renderer._composite);
          logEntry.readbackCompletedAt=performance.now();
          const hashed=_hrHashBuffer(buf,'LAST_LIVE');
          // Generation-safe overwrite guard (Phase 11A.30 §2): only accept
          // this readback into window.HardRoundLastLiveFrame if (a) it
          // still belongs to the CURRENT stroke/session, AND (b) its
          // generation is still the latest accepted generation for that
          // session -- i.e. no newer frame was accepted while this
          // readback was in flight. A readback that resolves out of order
          // is marked stale and explicitly does NOT overwrite LAST_LIVE.
          const stillCurrentSession = session===_activeStrokeSession;
          const latestGenerationForSession = _hardRoundLastAcceptedLiveMetadataBySession[session]&&_hardRoundLastAcceptedLiveMetadataBySession[session].generation;
          const isLatestGeneration = generation===latestGenerationForSession;
          if(stillCurrentSession && isLatestGeneration){
            window.HardRoundLastLiveFrame={
              timestamp:performance.now(),
              strokeId:session,
              generation,
              segmentCount:segmentCountAtAccept,
              bounds:hashed.bounds,
              nonTransparent:hashed.nonTransparent,
              maxAlpha:hashed.maxAlpha,
              hash:hashed.hash,
            };
            logEntry.becameLastLive=true;
          } else {
            logEntry.wasStale=true;
            logEntry.staleReason=!stillCurrentSession?'old-session':'superseded-generation';
          }
        }catch(err){
          logEntry.wasStale=true;
          logEntry.staleReason='readback-error';
          console.warn('[11A.27] LAST_LIVE capture failed',err);
        }
      }
      // The WebGPU canvas is already a visible document-space overlay in
      // canvas-wrap. Never copy its live pixels through Canvas2D.
      // Phase 11B.8 DIAGNOSTIC (opt-in, default off, see
      // _hr11b7CompareAndRecord above _hardRoundPresentLivePreview for
      // full rationale): reads strokeMaskTex directly via the existing
      // non-mutating diagResolveIntoBuffer() readback -- NOT the
      // presentation canvas -- so it can't be confounded by
      // canvas-presentation timing. Deliberately not awaited: this must
      // never delay the real _hardRoundSetGpuOverlayVisible(true) call
      // immediately below.
      if (window.HardRoundDebugLiveFrameRegression) {
        _hr11b7CompareAndRecord(renderer, session, renderer._segmentCount).catch(()=>{});
      }
      // Phase 11B.12 DIAGNOSTIC (opt-in, default off): same fire-and-forget
      // shape as the 11B.8 call directly above -- never awaited, so it
      // cannot delay the real _hardRoundSetGpuOverlayVisible(true) call
      // immediately below. `previewGeneration` is this closure's own
      // captured generation value (see the top of
      // _hardRoundPresentLivePreview), used to detect if this preview gets
      // superseded before its own painted-overlay capture completes.
      if (window.HardRoundDebugPaintedOverlayCompare) {
        _hr1112CompareAndRecord(renderer, session, renderer._segmentCount, previewGeneration).catch(()=>{});
      }
      window.HardRoundOverlayPresentedStrokeId=session;
      _hardRoundSetGpuOverlayVisible(true,'presentLivePreview-accepted-frame');
      // --- diagnostic (11A.31): this generation's pixels were actually shown ---
      if(_dbgOrderEntry){ _dbgOrderEntry.overlayShown=true; _hardRoundPreviewOrderPush(_dbgOrderEntry); }
      return;
    }
    const dirty=result.dirtyRegion;
    if(dirty){
      if(dirty.width<=0||dirty.height<=0){ if(_dbgOrderEntry)_hardRoundPreviewOrderPush(_dbgOrderEntry); return; }
      _strokeCtx.clearRect(dirty.x,dirty.y,dirty.width,dirty.height);
      _strokeCtx.drawImage(result.canvas,dirty.x,dirty.y,dirty.width,dirty.height,dirty.x,dirty.y,dirty.width,dirty.height);
    }else{
      _strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
      _strokeCtx.drawImage(result.canvas,0,0);
    }
    // --- diagnostic (11A.31): this generation's pixels were actually shown ---
    if(_dbgOrderEntry){ _dbgOrderEntry.overlayShown=true; _hardRoundPreviewOrderPush(_dbgOrderEntry); }
    _scheduleRecomposite();
  });
}

// Phase 9C.1 perf fix: RAF-coalesced entry point for the live preview.
// Sample accumulation (renderer.drawSegments()) still happens synchronously
// on every pointer event in _hardRoundStampSegments -- nothing here ever
// skips or batches segments, so no stroke fidelity is lost. This function
// only decides WHEN to spend the expensive resolve+present step: it marks
// "a preview is due" and, if a resolve isn't already scheduled for this
// animation frame, schedules exactly one. Any further calls before that
// frame fires just find one already pending and return immediately, so no
// matter how many pointer events land in a single frame, at most one
// peekStroke()/_resolveToOutput() happens for it -- matching
// prototype.html's present-once-per-frame cadence.
let _hardRoundPreviewRAF = null;
let _hardRoundPreviewRAFSession = null;
let _hardRoundPreviewSession = null;
let _hardRoundPreviewInFlight = false;
let _hardRoundPreviewInFlightToken = null;
let _hardRoundPreviewNeedsFollowup = false;
let _hardRoundPreviewRequestedRenderer = null;
function _hardRoundSchedulePreviewFrame(renderer){
  if(_hardRoundPreviewRAF!==null)return;
  const scheduledSession=_activeStrokeSession;
  _hardRoundPreviewRAFSession=scheduledSession;
  _hrFsRecordSchedule();
  _hardRoundPreviewRAF=requestAnimationFrame(()=>{
    const _hrMtCbStart = _hrMtActive() ? performance.now() : null;
    _hardRoundPreviewRAF=null;
    _hardRoundPreviewRAFSession=null;
    _hrFsRecordPreviewRafStart();
    if(scheduledSession!==_activeStrokeSession||!_inStroke)return;
    _hrPerfMarkPreviewRaf(scheduledSession);
    _hardRoundFlushPending(renderer);
    const flightToken={sessionId:scheduledSession,renderer};
    _hardRoundPreviewInFlight=true;
    _hardRoundPreviewInFlightToken=flightToken;
    _hardRoundPreviewNeedsFollowup=false;
    Promise.resolve(_hardRoundPresentLivePreview(renderer)).finally(()=>{
      if(_hardRoundPreviewInFlightToken!==flightToken)return;
      _hardRoundPreviewInFlight=false;
      _hardRoundPreviewInFlightToken=null;
      const requestedRenderer=_hardRoundPreviewRequestedRenderer;
      const needsFollowup=_hardRoundPreviewNeedsFollowup||_hardRoundPendingRenderSegments.length>0;
      _hardRoundPreviewNeedsFollowup=false;
      if(needsFollowup&&requestedRenderer&&_hardRoundPreviewSession===_activeStrokeSession&&_inStroke){
        _hardRoundRequestLivePreview(requestedRenderer);
      }
    });
    if(_hrMtCbStart!=null) _hrMtRecord('_hardRoundSchedulePreviewFrame-callback-total', _hrMtCbStart, performance.now());
  });
}
function _hardRoundRequestLivePreview(renderer){
  if(!renderer || !_inStroke || !_strokeCtx || !_strokeCanvas) return;
  _hardRoundPreviewRequestedRenderer=renderer;
  _hardRoundPreviewSession = _activeStrokeSession;
  if(_hardRoundPreviewInFlight){_hardRoundPreviewNeedsFollowup=true;return;}
  if(_hardRoundPreviewRAF !== null){
    if(_hardRoundPreviewRAFSession===_activeStrokeSession)return;
    cancelAnimationFrame(_hardRoundPreviewRAF);
    _hardRoundPreviewRAF=null;
    _hardRoundPreviewRAFSession=null;
  }
  _hardRoundSchedulePreviewFrame(renderer);
}

// Cancels any pending RAF-scheduled live preview. Called on stroke
// end/cancel so a preview resolve never fires (or races the final
// endStroke() resolve) after the stroke it was for is already done.
//
// hideOverlay controls whether the GPU overlay is hidden immediately.
// Default true is correct for a genuine abort (the stroke is being thrown
// away, so there is nothing pending to show and the overlay should
// disappear right away). The normal pointerup finish path, however, calls
// this with hideOverlay=false: at that point the final segments have
// already been pushed into the renderer's backing store but NOT yet
// presented anywhere (the live-preview RAF that would have shown them is
// exactly what this function just cancelled), and the authoritative
// resolved pixels won't reach the real artwork layer until the async
// renderer.endStroke() promise resolves and _commitStrokeCanvas() runs.
// Hiding the overlay here, before that commit, blanks the on-screen stroke
// for however long that promise takes to settle -- an empty gap between
// "overlay hidden" and "layer painted" that reads as a blink/flicker. The
// caller is responsible for hiding the overlay itself once the commit is
// actually in hand, in the same synchronous step, so there is never a
// frame where neither surface shows the finished stroke.
// Phase 11A.5: independent invalidation token for the live-preview loop's
// async peekStroke() calls. session (_activeStrokeSession) only changes on
// the NEXT pointerdown, and _inStroke only flips false partway through the
// async commit itself -- neither one is set at the moment we actually want
// to stop trusting old previews, which is the instant pointerup begins
// finishing/committing the stroke. A peekStroke() that was already in
// flight at that instant (its RAF had already fired before pointerup, so
// cancelling the *next* RAF here doesn't touch it) would otherwise resolve
// later, sail past both of those stale guards, and call
// _hardRoundSetGpuOverlayVisible(true) with pre-final pixels -- showing the
// overlay's old content stacked on top of the artwork layer that already
// has the finished stroke committed into it. That reads as the stroke
// being duplicated. Bumping this counter in _hardRoundCancelLivePreview
// (called at the very start of both the finish and the abort paths, before
// the commit) guarantees any such stale resolve is a no-op, regardless of
// how the two promises happen to interleave.
let _hardRoundPreviewGeneration = 0;
function _hardRoundCancelLivePreview(hideOverlay=true){
  _hardRoundPreviewGeneration++;
  if(_hardRoundPreviewRAF !== null){
    cancelAnimationFrame(_hardRoundPreviewRAF);
    _hardRoundPreviewRAF = null;
    _hardRoundPreviewRAFSession = null;
  }
  _hardRoundPreviewSession = null;
  _hardRoundPreviewRequestedRenderer = null;
  _hardRoundPreviewNeedsFollowup = false;
  if(hideOverlay)_hardRoundSetGpuOverlayVisible(false);
}

// Present the renderer state after finishStroke() has supplied its catch-up
// geometry, then leave that exact frame visible for one browser paint before
// endStroke() reads it back and the overlay is exchanged for committed pixels.
// Two RAF boundaries are intentional: RAF callbacks run before paint, so the
// first boundary makes the submitted final frame paintable and the second is
// the earliest safe point at which commit may replace it.
function _hardRoundPresentFinishedFrame(renderer,originStrokeId=_activeStrokeSession){
  if(!renderer)return Promise.resolve();
  // The shared GPU presenter belongs exclusively to the live active
  // session. Pointerup accumulation is resolved by endStroke({readback:true})
  // and committed through the finishing context; it must never present or
  // toggle the shared overlay while a newer stroke may already be active.
  if(renderer.isGpuActive&&renderer.isGpuActive())return Promise.resolve();
  // Phase 11B.10 TEMP DIAGNOSTIC (opt-in, default off): record the instant
  // the finished-frame path begins, keyed by the still-active session, so
  // any live preview that resolves AFTER this point (even one requested
  // earlier) can be identified as crossing this boundary.
  if (window.HardRoundDebugLivePreviewCrossover) {
    _hr1110FinishedFrameStartedAtBySession[_activeStrokeSession] = performance.now();
  }
  return renderer.peekStroke().then(result=>{
    if(result&&result.canvas){
      if(_strokeCtx&&_strokeCanvas){
        _hrStaleFinalizerMutation(originStrokeId,'finishedPreviewStrokeScratchCanvas','current-shared-stroke','old-finished-preview',()=>{
          _strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
          _strokeCtx.drawImage(result.canvas,0,0);
          _scheduleRecomposite();
        });
      }
    }
    return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
}

// Carry-over: leftover distance from the end of each segment so the first
// dab of the next segment lands on the correct inter-dab grid.
// Resets to 0 at stroke start/end.
let _strokeSegCarryOver = 0;

//


//  Brush Tip / Texture public API
let _lastNormalizedTipPixels=null;
let _tipAssetIdCounter=0;
function _ensureTipAssetId(canvas, previousCanvas) {
  if (!canvas) return null;
  if (canvas._tipAssetId) return canvas._tipAssetId;
  const w = canvas.width || canvas.naturalWidth || 1;
  const h = canvas.height || canvas.naturalHeight || 1;
  if (previousCanvas && previousCanvas._tipAssetId && (canvas === previousCanvas || (canvas.src && canvas.src === previousCanvas.src))) {
    canvas._tipAssetId = previousCanvas._tipAssetId;
    canvas._tipAssetVersion = previousCanvas._tipAssetVersion || 1;
  } else {
    canvas._tipAssetId = `tip_asset_${++_tipAssetIdCounter}_${w}x${h}`;
    canvas._tipAssetVersion = 1;
  }
  return canvas._tipAssetId;
}

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
  const normalizeStart=performance.now(),c2d=canvas.getContext('2d',{willReadFrequently:true}),readStart=performance.now();
  let id;
  try{ id=c2d.getImageData(0,0,w,h);if(window.TipReadbackExperiment)window.TipReadbackExperiment.record('tip-normalization-read',{width:w,height:h,duration:performance.now()-readStart,totalDuration:performance.now()-normalizeStart}); }catch(e){ return canvas; } // tainted canvas (cross-origin) — leave as-is
  const d=id.data;
  let minA=255,maxA=0;
  for(let i=3;i<d.length;i+=4){ const a=d[i]; if(a<minA)minA=a; if(a>maxA)maxA=a; }
  // Real transparency already present (e.g. a proper alpha-masked tip, or
  // this function already having run on it) — leave it untouched.
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
  _brushDiagPerfNote('cache-invalidated');
  const trace=window.CustomTipCacheTrace,previousCanvas=window.brushTipCanvas,previousVersion=window.brushTipVersion||0,previousAlphaBuffer=_tipAlphaBuf;
  _lastNormalizedTipPixels=null;
  const normalized=canvas?_normalizeTipAlpha(canvas):null;
  if(normalized){
    _ensureTipAssetId(normalized,previousCanvas);
    if(canvas&&canvas!==normalized&&!canvas._tipAssetId){
      canvas._tipAssetId=normalized._tipAssetId;
      canvas._tipAssetVersion=normalized._tipAssetVersion||1;
    }
  }
  window.brushTipCanvas=normalized;
  window.brushTipSpacingBasis=canvas?'image-width':'diameter';
  window.brushTipReferenceDiameter=canvas&&Number.isFinite(Number(referenceDiameter))&&Number(referenceDiameter)>0?Number(referenceDiameter):null;
  window.brushTipVersion=(window.brushTipVersion||0)+1;
  _tipAlphaSeedPixels=window.TipReadbackExperiment&&window.TipReadbackExperiment.mode==='D'&&_lastNormalizedTipPixels?{data:_lastNormalizedTipPixels.data,w:_lastNormalizedTipPixels.w,h:_lastNormalizedTipPixels.h,version:window.brushTipVersion}:null;
  _tipDabCache.clear();
  _aaDabCache.clear();
  _stampCache.clear();
  _tipAlphaInvalidationReason=invalidationReason||'setBrushTip-call';
  if(trace)trace.invalidated({reason:_tipAlphaInvalidationReason,previousVersion,tipVersion:window.brushTipVersion,previousTipCanvasId:trace.objectId(previousCanvas,'tip-canvas'),tipCanvasId:trace.objectId(window.brushTipCanvas,'tip-canvas'),sameCanvas:previousCanvas===window.brushTipCanvas,alphaBufferId:trace.objectId(previousAlphaBuffer,'alpha-buffer'),stack:(new Error()).stack});
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
let _eyedropperSampleRaf=0;
let _eyedropperLatestPosition=null;
let _eyedropperLastAppliedRgba=null;
function _sampleVisibleCanvasColor(e){
  const p=getPos(e),x=Math.floor(p.x),y=Math.floor(p.y);
  if(x<0||y<0||x>=CW||y>=CH)return;
  const pixel=compCtx.getImageData(x,y,1,1).data;
  const rgba=pixel[0]+','+pixel[1]+','+pixel[2]+','+pixel[3];
  if(rgba===_eyedropperLastAppliedRgba)return;
  _eyedropperLastAppliedRgba=rgba;
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
function _queueVisibleCanvasColorSample(e){
  _eyedropperLatestPosition={clientX:e.clientX,clientY:e.clientY,pointerId:e.pointerId};
  if(_eyedropperSampleRaf)return;
  _eyedropperSampleRaf=requestAnimationFrame(()=>{
    _eyedropperSampleRaf=0;
    const latest=_eyedropperLatestPosition;
    _eyedropperLatestPosition=null;
    if(!latest||latest.pointerId!==_eyedropperPointerId)return;
    _sampleVisibleCanvasColor(latest);
  });
}
function _endVisibleCanvasColorSampling(pointerId){
  if(pointerId!==_eyedropperPointerId)return false;
  _eyedropperPointerId=null;
  _eyedropperLatestPosition=null;
  if(_eyedropperSampleRaf){cancelAnimationFrame(_eyedropperSampleRaf);_eyedropperSampleRaf=0;}
  return true;
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
  _hrFsRecordInput('pointerdown', e);
  const diagnosticPointerdownEntry=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  const customTraceEntry=window.CustomFirstDabTrace&&window.CustomFirstDabTrace.enabled?performance.now():0;
  // e.button can be -1 on some tablet drivers for pen primary contact; use e.buttons&1 instead
  if(activeGroupId||panning||(typeof _zoomDrag!=='undefined'&&_zoomDrag)||spaceHeld||tool==='transform') return;
  if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
  if(tool==='eyedropper'){
    e.preventDefault();_eyedropperPointerId=e.pointerId;_eyedropperLastAppliedRgba=null;activeC.setPointerCapture(e.pointerId);_sampleVisibleCanvasColor(e);return;
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
  if(latencyProfiler)latencyProfiler.startStroke({tool,pointerType:e.pointerType,presetId:window._activeBrushPresetId||null,size:getBrushSize(),flow:brushFlow,opacity:brushOpacity,hardness:brushHardness,tip:!!window.brushTipCanvas,texture:!!window.brushTextureEnabled,airbrush:!!window._brushAirbrush,layerType:layers[curLayer]&&layers[curLayer].type,caches:{analytic:_aaDabCache.size,softRound:_softRoundMaskCache.size,tip:_tipDabCache.size},buffers:{stroke:!!_strokeCanvas,preview:!!_strokePreviewCanvas}});
  if(window.TipReadbackExperiment)window.TipReadbackExperiment.strokeStart();
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.beginStroke({entryAt:customTraceEntry,tip:!!window.brushTipCanvas,presetId:window._activeBrushPresetId||null,settings:{size:getBrushSize(),spacing:window.brushSpacing,hardness:brushHardness,opacity:brushOpacity,flow:brushFlow,pressureSize:window._brushPressureSize,pressureOpacity:window._brushPressureOpacity,zoom:typeof zoom==='number'?zoom:null}});
  if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.event('stroke-state-initialization-begins');
  if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.strokeStart();
  if(latencyProfiler){latencyProfiler.point('pointerdown-received',{visibility:document.visibilityState,focused:document.hasFocus(),framePhaseMs:performance.now()%16.67});latencyProfiler.point('stroke-initialization-begins');}
  if(window.BrushRafExperiment)window.BrushRafExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if(window.BrushFirstDabExperiment)window.BrushFirstDabExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if(window.KeyframeLatencyExperiment)window.KeyframeLatencyExperiment.strokeBegins({layerIndex:curLayer,frameIndex:curFrame,layerType:layers[curLayer]&&layers[curLayer].type});
  if ((window.CustomBrushDebugRasterParity || window.CustomBrushDebugResolvedDabs) && window.brushTipCanvas) {
    window._resolvedCustomTipDabLog = [];
    window._resolvedCustomTipDrawDabNowCount = 0;
    window._customTipRasterRepresentativeDab = null;
    window._customTipRasterDabsSeen = 0;
    window._customTipRasterMaxRadiusSeen = 0;
  }
  if (_shouldRunCustomTipGpuDiagnostic() && window._customTipGpuRenderer && typeof window._customTipGpuRenderer.beginStroke === 'function') {
    window._customTipGpuRenderer.beginStroke();
  }
  if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.setupMeasure('latencyHooksInitialization',diagnosticSetupStart);
  const inputStateStart=latencyProfiler?performance.now():0;
  diagnosticSetupStart=window.FirstDabLatencyProbe&&window.FirstDabLatencyProbe.enabled?performance.now():0;
  _isDrawingWithPen = (e.pointerType === 'pen');
  // Phase 8C: decided once, for the whole stroke, right after pointerType is
  // known. Re-evaluating mid-stroke (e.g. if the user hot-swapped a setting
  // while held down) would risk switching renderers under a live stroke.
  _hardRoundStrokeActive = tool==='brush' && _hardRoundEligibleNow() && !!_hardRoundGetCore() && !!_hardRoundGetRenderer();
  if(window.HardRoundDebugRoutingTrace){
    _hrRtNewStroke(_activeStrokeSession, {
      tool, isPen:_isDrawingWithPen, hasCustomTip:!!window.brushTipCanvas,
      hardness:brushHardness, sizeControl:_getSizeControl(), roundness:window.brushTipRoundness,
      scatterEnabled:!!window._tsScatterEnabled, textureEnabled:!!window.brushTextureEnabled,
      airbrush:!!window._brushAirbrush, eligibleNowResult:_hardRoundEligibleNow(),
      hasCore:!!_hardRoundGetCore(), hasRenderer:!!_hardRoundGetRenderer(),
    }, _hardRoundStrokeActive);
  }
  _strokeFirstSample = true; // this stroke's first _getPressure() call snaps immediately, no de-jitter clamping
  currentPressure=_getPressure(e);
  _smoothedPressure = currentPressure; // snap smoothing to actual pressure at stroke start (no ramp-in lag)
  _lastKnownPressure = currentPressure;
  if (window.CustomBrushDebugResolvedDabs && window.brushTipCanvas) {
    window._resolvedCustomTipDabLog = [];
    window._resolvedCustomTipDrawDabNowCount = 0;
  }
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
  _brushDiagPerfBegin(_activeStrokeSession);
  if(_hardRoundStrokeActive) _hrPerfMarkStrokeStart(_activeStrokeSession);
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
  _autoHardRoundPrevDab=null;
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
  try{
    if(_hardRoundStrokeActive){
      // Phase 8C: Hard Round's initial dab comes from PrototypeStrokeCore's
      // beginStroke() zero-length segment instead of a direct _stampDab call,
      // so the very first mark already has this stroke's continuous-taper
      // radius source instead of the legacy pressure-curve one.
      // Phase 9C: PrototypeRenderer's own accumulation also starts here, in
      // lockstep with PrototypeStrokeCore's buffers -- _hardRoundGetRenderer()
      // was already confirmed non-null by _hardRoundEligibleNow's caller
      // (see _hardRoundStrokeActive's assignment above), so this is a plain
      // reset of that existing instance, not a fallible lookup.
      _hardRoundCore.updateSettings({brushSize:getBrushSize(),stabilization:_stabilizationAmount(),zoom});
      // Phase 9E.5: feed PrototypeStrokeCore the stateless prototype-
      // equivalent pressure read, not the legacy _getPressure-derived
      // currentPressure (hold-last-known + rate-limited) used above for the
      // non-Hard-Round pointerdown path -- see _getPrototypePressure doc.
      const beginSeg=_hardRoundCore.beginStroke({x:p.x,y:p.y,pressure:_getPrototypePressure(e),pointerType:e.pointerType,timeStamp:e.timeStamp||performance.now()});
      const hardRoundRenderer=_hardRoundGetRenderer();
      const hardRoundAaMode=_currentAAMode();
      // Phase 11A: AA-On owns a direct WebGPU overlay. AA Off retains the
      // exact CPU station-winner implementation until GPU parity exists.
      // Blend modes, selection clipping, and Smart Raster need their own
      // GPU compositor parity; keep them on the established CPU preview so
      // the visible stroke cannot disagree with the pointer-up commit.
      const gpuLiveCompatible=hardRoundAaMode!=='off'&&hardRoundAaMode!=='none'&&
        (!window.brushBlendMode||window.brushBlendMode==='normal')&&
        !(window.SelectionScope&&SelectionScope.isRestricted&&SelectionScope.isRestricted())&&
        !(layers[curLayer]&&layers[curLayer].type==='smart-raster')&&
        !_hardRoundHasVisibleLayerAbove(curLayer,curFrame);
      hardRoundRenderer.preferGpu=gpuLiveCompatible;
      // TEMP DIAGNOSTIC (Phase 11A.14) -- manual backend override for
      // isolation testing only. Does not touch eligibility; route stays
      // 'migrated' either way. Remove alongside the rest of the HR-DEBUG
      // instrumentation once the routing matrix is resolved.
      if(window.HardRoundDebugForceBackend==='cpu') hardRoundRenderer.preferGpu=false;
      else if(window.HardRoundDebugForceBackend==='gpu') hardRoundRenderer.preferGpu=true;
      hardRoundRenderer.presentationOpacity=Math.max(0,Math.min(1,brushOpacity));
      // TEMP DIAGNOSTIC (Phase 11A.19): read-only activeC hash immediately
      // before beginStroke() touches anything. Whole-canvas region since
      // stroke 1's bounding box isn't tracked separately here.
      const _hrProbeBefore=_hrHashActiveCRegion(0,0,activeC.width,activeC.height,'beforeBeginStroke');
      _hardRoundActiveContext={
        strokeId:_activeStrokeSession,renderer:hardRoundRenderer,layerIndex:curLayer,frameIndex:curFrame,
        destinationCanvas:layers[curLayer]&&layers[curLayer].frames[curFrame]||null,
        opacity:Math.max(0,Math.min(1,brushOpacity)),blendMode:window.brushBlendMode||'normal',
        compositeOperation:_hardRoundCapturedCompositeOperation(window.brushBlendMode||'normal'),
        styleId:typeof activeAdvancedStyleIdForPainting==='function'?activeAdvancedStyleIdForPainting():null,
        smartRaster:!!(layers[curLayer]&&layers[curLayer].type==='smart-raster'),
        smartRasterMode:layers[curLayer]&&layers[curLayer].renderMode||null,
        smartRasterVersion:window.SmartRasterV4?'v4':'current',ownershipBefore:null,
        resolvedCanvas:null,resolvedMaskCanvas:null,dirtyRect:null,state:'active',gpuCommit:false,
        presentationBarrier:_hardRoundCommitTail,
      };
      window.HardRoundOverlayOwnerStrokeId=_activeStrokeSession;
      hardRoundRenderer.beginStroke();
      _brushDiagPerfNote('gpu-state',{backend:hardRoundRenderer.isGpuActive&&hardRoundRenderer.isGpuActive()?'webgpu':'cpu'});
      // TEMP DIAGNOSTIC (Phase 11A.19): same region, immediately after
      // beginStroke() returns, before the overlay is toggled visible.
      const _hrProbeAfter=_hrHashActiveCRegion(0,0,activeC.width,activeC.height,'afterBeginStroke');
      // TEMP DIAGNOSTIC (Phase 11A.22): this call shows the GPU overlay
      // immediately after beginStroke() -- before this stroke's first
      // drawSegments()/peekStroke() has resolved, i.e. before any new
      // frame has actually been presented for THIS stroke. If the overlay
      // canvas/swapchain still holds the previous stroke's last presented
      // pixels at this point (gpu.reset() is only proven to clear
      // strokeMaskTex, not necessarily force a cleared present), showing
      // it here can briefly reveal stale Stroke N-1 pixels stacked on top
      // of the already-committed Stroke N-1 result -- reading as a
      // doubled/duplicated stroke. window.HardRoundDebugDelayOverlayShow
      // is an opt-in diagnostic toggle (default off = unchanged behavior)
      // that skips this early show and instead relies solely on the
      // existing gated reveal in _hardRoundPresentLivePreview (shows the
      // overlay only once this stroke's own peekStroke() has resolved a
      // real frame) and _hardRoundPresentFinishedFrame (pointerdown-only
      // strokes with no intervening pointermove). No other behavior is
      // changed; this does not touch brush math, geometry, or the commit
      // path. Remove once Phase 11A.22 is resolved either way.
      _hr1135Log('next-stroke-pre-overlay-show');
      // Phase 11B.5 TEMP DIAGNOSTIC: when window.HardRoundDebugCanvasLivePresentation
      // is true, never do this early unconditional overlay reveal either --
      // otherwise the overlay would flash visible here (before this
      // stroke's own peekStroke() has even resolved once) even though every
      // subsequent live-preview frame in this mode intentionally keeps it
      // hidden (see _hardRoundPresentLivePreview above). Explicitly hide it
      // instead, so "overlay stays hidden throughout diagnostic mode" holds
      // from the very first frame of the stroke, not just after the first
      // peek resolves.
      if(window.HardRoundDebugCanvasLivePresentation){
        _hardRoundSetGpuOverlayVisible(false,'beginStroke-canvasLivePresentationMode');
        _traceStrokeLifecycle('hardround-overlay-show-suppressed-canvas-live-presentation',{gpuActive:!!(hardRoundRenderer.isGpuActive&&hardRoundRenderer.isGpuActive())});
      }else{
        const preservePriorUntilCommit=!!(hardRoundRenderer.isGpuActive&&hardRoundRenderer.isGpuActive()&&_hardRoundPendingCommitCount>0&&_hardRoundGpuOverlay()&&!_hardRoundGpuOverlay().hidden);
        if(!preservePriorUntilCommit)_hardRoundSetGpuOverlayVisible(false,'beginStroke-await-first-present');
        _traceStrokeLifecycle('hardround-overlay-show-deferred',{gpuActive:!!(hardRoundRenderer.isGpuActive&&hardRoundRenderer.isGpuActive()),reason:preservePriorUntilCommit?'preserve-prior-until-commit':'await-first-successful-present'});
      }
      // TEMP DIAGNOSTIC (Phase 11A.19): same region, immediately after the
      // GPU overlay has been made visible for this new stroke (or, under
      // the 11A.22 delayed-show diagnostic, immediately after the decision
      // to defer that visibility).
      const _hrProbeAfterOverlay=_hrHashActiveCRegion(0,0,activeC.width,activeC.height,'afterOverlayVisible');
      window.HardRoundActiveCProbe={
        beforeBeginStroke:_hrProbeBefore,
        afterBeginStroke:_hrProbeAfter,
        afterOverlayVisible:_hrProbeAfterOverlay,
        beforeToAfterBeginStrokeChanged:_hrProbeBefore.hash!==_hrProbeAfter.hash,
        afterBeginStrokeToOverlayChanged:_hrProbeAfter.hash!==_hrProbeAfterOverlay.hash,
        beforeToOverlayChanged:_hrProbeBefore.hash!==_hrProbeAfterOverlay.hash,
      };
      // Phase 11A.30: routine [HR-ACTIVEC-PROBE] console spam from Phase
      // 11A.19 removed. window.HardRoundActiveCProbe is still populated
      // every stroke for manual inspection.
      // TEMP DIAGNOSTIC (Phase 11A.17 fix): the capture bucket must exist
      // BEFORE drawSegments() runs during the stroke (pointermove), not
      // just at pointerup -- that's why segment/vertex counters were
      // reading 0 previously (the bucket was created too late, at
      // finalize time, after all the real accumulation already happened).
      window.HardRoundDebugCapture={rawSegmentCount:0,cpuEquivalentMergedCount:0,gpuDispatchedCount:0,
        gpuDrawSegmentCalls:0,gpuFlushCalls:0,vertexCountGenerated:0,vertexCountUploaded:0,vertexCountDrawn:0};
      // TEMP DIAGNOSTIC (Phase 11A routing probe) -- read-only, does not
      // affect eligibility, backend selection, or any excluded subsystem.
      // Remove after the routing matrix is confirmed.
      (function(){
        window._hrDebugStrokeId = (window._hrDebugStrokeId||0)+1;
        const usingGpu = !!(hardRoundRenderer._usingGpu);
        window.HardRoundDebug = {
          strokeId: window._hrDebugStrokeId,
          route: 'migrated',
          backend: usingGpu ? 'GPU' : 'CPU',
          gpuLiveCompatible: !!gpuLiveCompatible,
          preferGpuFlagAtBeginStroke: !!gpuLiveCompatible,
          hasCustomTip: !!window.brushTipCanvas,
          textureEnabled: !!window.brushTextureEnabled,
        };
        // Phase 11A.30: routine [HR-DEBUG] console spam removed.
        // window.HardRoundDebug and the on-screen badge are unaffected.
        _hrDebugBadge(window.HardRoundDebug);
      })();
      _hardRoundPendingRenderSegments.length=0;
      _hardRoundNextStampIsFirst = true;
      _hardRoundStampSegments([beginSeg],e);
      // Preserve the original immediate first-dab behavior; only movement
      // segments are frame-batched.
      _hardRoundFlushPending(_hardRoundRenderer);
    } else {
      // TEMP DIAGNOSTIC (Phase 11A routing probe) -- read-only.
      window._hrDebugStrokeId = (window._hrDebugStrokeId||0)+1;
      window.HardRoundDebug = {
        strokeId: window._hrDebugStrokeId,
        route: 'legacy',
        backend: 'LEGACY',
        hasCustomTip: !!window.brushTipCanvas,
        textureEnabled: !!window.brushTextureEnabled,
      };
      // Phase 11A.30: routine [HR-DEBUG] console spam removed.
      _hrDebugBadge(window.HardRoundDebug);
      _stampDab(p.x,p.y,e);
    }
  }
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
    if(!(_hardRoundRenderer&&_hardRoundRenderer.isGpuActive&&_hardRoundRenderer.isGpuActive()))_scheduleRecomposite();
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
  const _hrMtMoveStart = _hrMtActive() ? performance.now() : null;
  _hrFsRecordInput(e.type||'pointermove', e);
  if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending'){
    if(activeGroupId)return;const p=getPos(e);_lastPointerEvent=e;_curveToolGesture.control={x:p.x,y:p.y};_scheduleLinePreview(p.x,p.y,e);return;
  }
  if((!drawing&&!_lineDragging)||activeGroupId||_strokeCompletionStarted) return;
  if(_activeStrokePointerId!=null&&e.pointerId!==_activeStrokePointerId) return;
  if(!(e.buttons&1)){_endStroke(e.pointerId);return;}
  e.preventDefault();
  const _hrMtCoalesceStart = _hrMtActive() ? performance.now() : null;
  const events=(typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
  _brushDiagPerfNote('raw-samples',{count:events.length});
  if(_hrMtCoalesceStart!=null) _hrMtRecord('getCoalescedEvents', _hrMtCoalesceStart, performance.now());
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
    _brushDiagPerfNote('stabilized-sample');
    if(window.HardRoundDebugRoutingTrace && !_hardRoundStrokeActive) _hrRtNoteLegacyPathEntered();
    const newPressure = _hardRoundStrokeActive ? _getPrototypePressure(ev) : _getPressure(ev);
    const raw=getPos(ev);
    if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.sample({source:e.type,eventTime:ev.timeStamp,x:raw.x,y:raw.y,pressure:newPressure,coalescedCount:events.length});
    const effPressure=_contactFilteredPressure(newPressure,raw.x,raw.y,ev.pointerType);
    _stabilizerSetSampleContext(effPressure,ev);
    const evTime=Number.isFinite(ev.timeStamp)&&ev.timeStamp>0?ev.timeStamp:performance.now();
    const p=_stabilizePoint(raw.x,raw.y,evTime);
    _tipDisplayRecordAuthoritative(p.x,p.y,performance.now());
    _updateVelocity(p.x,p.y,evTime);
    if(window._brushAirbrush&&Math.hypot(p.x-lx,p.y-ly)>0.01)_airbrushLastMovementTime=performance.now();

    if(_hardRoundStrokeActive && _hardRoundCore){
      _emitHardRoundStabilizedPoint(p.x,p.y,p.pressure,ev,evTime,'move');
    }else{
      const conditionedSamples=_baselineConditionerPush(_baselineSampleFromStabilizedPoint(ev,p,evTime));
      for(const conditioned of conditionedSamples){
        _curveAddPoint(conditioned.x,conditioned.y,conditioned.pressure,conditioned.event);
        currentPressure=conditioned.pressure;lx=conditioned.x;ly=conditioned.y;_lastPointerEvent=conditioned.event;
      }
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
  if(tool==='eyedropper'&&e.pointerId===_eyedropperPointerId){if(e.buttons&1){e.preventDefault();_queueVisibleCanvasColorSample(e);}return;}
  if(_hasRawUpdate && e.pointerType === 'pen') return; // handled exclusively by pointerrawupdate below
  _handleMoveEvent(e);
});
if(_hasRawUpdate){
  activeC.addEventListener('pointerrawupdate', e=>{
    if(e.pointerType !== 'pen') return;
    if(tool==='eyedropper'&&e.pointerId===_eyedropperPointerId){if(e.buttons&1){e.preventDefault();_queueVisibleCanvasColorSample(e);}return;}
    _handleMoveEvent(e);
  });
}
function _pointerEndStroke(e){
  const finalizingStrokeSession=_activeStrokeSession;
  const smartPointerupTiming=drawing&&_hardRoundStrokeActive&&_hardRoundActiveContext?_hrSmartPointerupBegin(finalizingStrokeSession,!!_hardRoundActiveContext.smartRaster,e.timeStamp):null;
  if(_hardRoundStrokeActive) _hrPerfMarkPointerup(_activeStrokeSession);
  // Phase 11B.10 TEMP DIAGNOSTIC (opt-in, default off): record the instant
  // pointerup begins finishing this stroke, keyed by the session that is
  // still active right now (it does not change until the NEXT
  // pointerdown), so any live preview -- already in flight or requested
  // later -- can be checked against it. Deliberately the very first line,
  // ahead of even the 11A.30 freeze below, since this is the earliest
  // possible timestamp for "pointerup started".
  if (window.HardRoundDebugLivePreviewCrossover) {
    _hr1110PointerupStartedAtBySession[_activeStrokeSession] = performance.now();
  }
  // Phase 11A.30 §3: must be the very first thing this function does --
  // synchronously copies the metadata for the newest ACCEPTED live frame
  // (generation, strokeId/sessionId, segmentCountAtAccept, acceptedAt) into
  // window.HardRoundFrozenLiveMetadata, before ANY of finishStroke(), final
  // stamping, pending flush, _hardRoundPresentFinishedFrame(), peekStroke(),
  // or endStroke() run below. This freeze is race-free by construction: it
  // reads only the synchronous accept-time bookkeeping recorded by
  // _hardRoundPresentLivePreview at the moment presentation order accepted
  // that frame -- it never waits on (or depends on) that frame's GPU
  // diagnostic readback, which can still be in flight or may finish out of
  // order (see _hardRoundLastAcceptedLiveMetadataBySession below).
  //
  // Also retained: the legacy HardRoundFrozenLastLiveFrame snapshot (of
  // whatever window.HardRoundLastLiveFrame -- the generation-safe corrected
  // value -- last held) and a fresh mutation log, both still used by the
  // LIVE_VS_PRE_END_SUMMARY comparison further down in this function.
  // Opt-in (window.HardRoundDebugCaptureLastLiveFrame, default off) -- a
  // no-op property read/write when off, no effect on control flow.
  if(window.HardRoundDebugCaptureLastLiveFrame){
    const frozenSource=_hardRoundLastAcceptedLiveMetadataBySession[_activeStrokeSession];
    window.HardRoundFrozenLiveMetadata=frozenSource?Object.assign({},frozenSource):null;
    window.HardRoundFrozenLastLiveFrame=window.HardRoundLastLiveFrame?Object.assign({},window.HardRoundLastLiveFrame):null;
    window.HardRoundGeometryMutationLog=[];
    if(window.HardRoundDebugPhase11A30){
      console.log('[11A.30] FROZEN_LIVE_METADATA',window.HardRoundFrozenLiveMetadata);
    }
  }
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
    _renderLineDrag(p.x,p.y,e,'commit');
    if(_inStroke){_inStroke=false;_commitStrokeCanvas();}_cleanupErasedSmartOwnership();_clearLinePreviewCanvas(_strokeCanvas,_strokeCtx);_clearLinePreviewCanvas(_texturedStrokeCanvas,_texturedStrokeCtx);_clearLinePreviewCanvas(_strokePreviewCanvas,_strokePreviewCtx);lineStart=null;_lineDragging=false;_linePressureSamples=[];_lineGesture=null;_linePreviewBounds=null;_linePreviewPreviousEndpoint=null;saveActiveToKey();
  }else if(drawing && _hardRoundStrokeActive && _hardRoundCore){
    drawing=false;
    const finalRaw=getPos(e);
    const finalPressure=_getPrototypePressure(e);

    _stabilizerFinalize(finalRaw.x, finalRaw.y, finalPressure, e, ()=>{
      const finish=_hardRoundCore.finishStroke({x:finalRaw.x,y:finalRaw.y,pressure:finalPressure,pointerType:e.pointerType,timeStamp:e.timeStamp||performance.now()});
      _traceStrokeLifecycle('hardround-finishStroke',{segmentCount:finish.segments?finish.segments.length:0,submittedSegmentCount:0,mode:finish.mode});
      if(window.HardRoundDebugCaptureLastLiveFrame&&window.HardRoundGeometryMutationLog){
        window.HardRoundGeometryMutationLog.push({
          fn:'finishStroke',
          timestamp:performance.now(),
          finishSegmentCount:finish.segments?finish.segments.length:0,
          flushedIntoRenderer:false,
        });
      }
      _hardRoundNextStampIsLast = false;
      _traceStrokeLifecycle('hardround-stampSegments',{queuedSegments:_hardRoundPendingRenderSegments.length,previewRAFPending:_hardRoundPreviewRAF,previewInFlight:_hardRoundPreviewInFlight,previewFollowupPending:_hardRoundPreviewNeedsFollowup});
      const flushedCount=_hardRoundFlushPending(_hardRoundRenderer);
      _traceStrokeLifecycle('hardround-flushPending',{flushedSegments:flushedCount,overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});
      const previewGenerationAtFinish=_hardRoundPreviewGeneration;
      _hardRoundCancelLivePreview(false);
      _hardRoundStrokeActive=false;
      if(window.HardRoundDebugRoutingTrace) _hrRtFinalizeStroke();
      _traceStrokeLifecycle('hardround-cancelLivePreview',{previewGenerationAtFinish,previewGenerationAfterCancel:_hardRoundPreviewGeneration,overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});

      if (window.BrushDebugStabilizerParity) {
        if (!window._stabilizerParityLog) window._stabilizerParityLog = [];
        window._stabilizerParityLog.push({
          eventType: 'finalized',
          rawX: _stabilizerRawX,
          rawY: _stabilizerRawY,
          stabilizedX: _stabilizerX,
          stabilizedY: _stabilizerY,
          gpuInputX: _stabilizerX,
          gpuInputY: _stabilizerY,
          distanceToTarget: Math.hypot(_stabilizerTargetX - _stabilizerX, _stabilizerTargetY - _stabilizerY),
          catchupActive: false,
          pointerHeld: false,
          finalizing: false,
          time: performance.now()
        });
        if (window._stabilizerParityLog.length > 200) {
          window._stabilizerParityLog.splice(0, window._stabilizerParityLog.length - 200);
        }
      }
    // That canvas is this stroke's entire visible output -- draw it into
    // the existing _strokeCanvas/_strokeCtx scratch surface (exactly what
    // the legacy per-dab path already left there for _commitStrokeCanvas()
    // to pick up) and then fall through to the SAME commit/cleanup calls
    // every other branch of this function already uses, unmodified.
    // endStroke() is async only because its (best-effort, opt-in) GPU path
    // awaits a readback; the CPU path used here resolves on the next
    // microtask, which always runs before the browser dispatches the next
    // pointer event, so this stays effectively synchronous with the rest
    // of pointerup for the only path actually exercised in this phase.
    const renderer=_hardRoundRenderer;
    const finishHardRoundStroke=()=>{
      _hrStaleFinalizerMutation(finalizingStrokeSession,'postCommitCleanupAndSave','pending','complete',()=>{
        _restoreSelectionScopePixels();_cleanupErasedSmartOwnership();saveActiveToKey();
      });
      _finalizePointerEndStroke(e,finalizingStrokeSession,true);
      _traceStrokeLifecycle('hardround-recomposite-after-finalize',{overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});
    };
    if(renderer){
      const gpuCommit=!!(renderer.isGpuActive&&renderer.isGpuActive());
      // TEMP DIAGNOSTIC (Phase 11A.17): do NOT reset window.HardRoundDebugCapture
      // here -- it was created at beginStroke (pointerdown) and has been
      // accumulating real segment/vertex counts throughout the stroke.
      // Resetting it here would wipe that data right before we read it.
      if(gpuCommit)window.HardRoundDebugCapture=window.HardRoundDebugCapture||{};
      const finishedPreviewCalledAt=performance.now();
      _traceStrokeLifecycle('hardround-finished-preview-call',{gpuActive:gpuCommit,overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});
      // Phase 11A.32 causal test: when the bypass flag is on AND this
      // stroke is GPU-active, skip _hardRoundPresentFinishedFrame()
      // entirely -- go straight to the same .then() continuation that
      // normally runs after it. Resolve to undefined immediately (no
      // peekStroke()/gpu.present() of the flushed catch-up segments, no
      // two-RAF wait). CPU strokes (gpuCommit===false) always take the
      // unmodified _hardRoundPresentFinishedFrame() path below, regardless
      // of this flag -- see the gpuCommit condition.
      const hr32Bypass=!!(gpuCommit&&window.HardRoundDebugBypassFinishedGpuPreview);
      const hr32FinishedFramePromise=hr32Bypass?Promise.resolve():_hardRoundPresentFinishedFrame(renderer,finalizingStrokeSession);
      if(hr32Bypass&&window.HardRoundDebugPhase11A32){
        console.log('[11A.32 BYPASS RESULT]','skipping _hardRoundPresentFinishedFrame(); going straight to endStroke({readback:true})');
      }
      hr32FinishedFramePromise.then(async ()=>{
        _traceStrokeLifecycle('hardround-finished-preview-presented',{elapsedMs:performance.now()-finishedPreviewCalledAt,overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null,hr32Bypassed:hr32Bypass});
        const endStrokeCalledAt=performance.now();
        _traceStrokeLifecycle('hardround-endStroke-call',{gpuActive:gpuCommit,readback:gpuCommit,overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});
        // TEMP DIAGNOSTIC (Phase 11A.17): capture B via the SAME resolve
        // pipeline endStroke's readback uses (gpu.resolveInto(), i.e.
        // RESOLVE_SHADER_WGSL -> copyTextureToBuffer -> mapAsync), called
        // directly against a scratch context instead of the app's real
        // _outCtx. This is non-mutating (resolveInto() only reads
        // strokeMaskTex) and happens strictly before endStroke() below, so
        // it cannot influence what endStroke() itself resolves.
        // TEMP DIAGNOSTIC (Phase 11A.20): PRE_END capture. Uses only the
        // real, existing renderer.gpu.resolveInto() method -- no
        // diagPresentToBuffer()/diagCoverageToBuffer() or any other
        // nonexistent GPU method. Entirely wrapped in try/catch: a failure
        // here only skips logging and can never block or alter the real
        // endStroke()/commit path below.
        let hr20PreEnd=null;
        if(gpuCommit&&renderer.gpu&&renderer.gpu.ready){
          try{
            const preEndCanvas=document.createElement('canvas');
            preEndCanvas.width=renderer.width;preEndCanvas.height=renderer.height;
            await renderer.gpu.resolveInto(preEndCanvas.getContext('2d'),renderer._rgb,renderer._composite);
            hr20PreEnd=_hrHashCanvas(preEndCanvas,'PRE_END');
            // Phase 11A.30: routine [11A.20] PRE_END console spam removed.
            // hr20PreEnd still feeds LIVE_VS_PRE_END_SUMMARY below and the
            // FINAL_GPU comparison further down.
            if(window.HardRoundDebugPhase11A30) console.log('[11A.30] PRE_END',hr20PreEnd);
          }catch(err){console.warn('[11A.20] PRE_END capture failed',err);}
        }
        // Phase 11A.30 §4: keep the frozen live metadata (captured
        // race-free/synchronously at _pointerEndStroke entry, before
        // finishStroke()/stamping/flush/_hardRoundPresentFinishedFrame()/
        // peekStroke()/endStroke() ran) and PRE_END (captured just above,
        // via the same resolveInto() pipeline production's own readback
        // uses), and build ONE concise, generation-safe comparison result.
        // Read-only, wrapped in try/catch, cannot affect endStroke()/commit
        // below.
        if(gpuCommit&&window.HardRoundDebugCaptureLastLiveFrame){
          try{
            const frozenMeta=window.HardRoundFrozenLiveMetadata;
            const lastLive=window.HardRoundLastLiveFrame;
            const captureLog=window.HardRoundLiveCaptureLog||[];
            const staleReadbackCount=captureLog.filter(entry=>entry.wasStale).length;
            const newestGeneration=frozenMeta?frozenMeta.generation:null;
            const newestGenerationReadbackCompleted=!!(lastLive&&newestGeneration!=null&&lastLive.generation===newestGeneration);
            const pixelPerfectMatch=(lastLive&&hr20PreEnd&&!hr20PreEnd.error)?(lastLive.hash===hr20PreEnd.hash):null;
            const boundsEqual=(lastLive&&hr20PreEnd&&!hr20PreEnd.error)?(JSON.stringify(lastLive.bounds)===JSON.stringify(hr20PreEnd.bounds)):null;
            const preEndSegmentCount=(hr20PreEnd&&renderer)?renderer._segmentCount:null;
            const segmentCountDelta=(frozenMeta&&renderer)?(renderer._segmentCount-frozenMeta.segmentCountAtAccept):null;
            let conclusion;
            if(!frozenMeta) conclusion='no-live-metadata-captured-for-this-stroke';
            else if(!newestGenerationReadbackCompleted) conclusion='newest-generation-readback-not-completed-in-time';
            else if(segmentCountDelta) conclusion='segment-counts-differ-renderer-state-genuinely-changed-after-newest-live-frame';
            else if(pixelPerfectMatch===false) conclusion='segment-counts-equal-pixels-differ-investigate-diagnostic-readback-presentation-timing';
            else if(pixelPerfectMatch===true) conclusion='match';
            else conclusion='incomplete-data';
            const summary={
              newestGeneration,
              frozenLiveSegmentCount:frozenMeta?frozenMeta.segmentCountAtAccept:null,
              preEndSegmentCount,
              segmentCountDelta,
              pixelPerfectMatch,
              hashEqual:pixelPerfectMatch,
              nonTransparentDelta:(lastLive&&hr20PreEnd&&!hr20PreEnd.error)?((hr20PreEnd.nonTransparent||0)-(lastLive.nonTransparent||0)):null,
              maxAlphaDelta:(lastLive&&hr20PreEnd&&!hr20PreEnd.error)?((hr20PreEnd.maxAlpha||0)-(lastLive.maxAlpha||0)):null,
              boundsEqual,
              staleReadbackCount,
              newestGenerationReadbackCompleted,
              conclusion,
            };
            window.HardRoundLiveVsPreEndSummary=summary;
            if(window.HardRoundDebugPhase11A30){
              console.log('[11A.30] LAST_LIVE_CORRECTED',lastLive);
              console.log('[11A.30] LIVE_CAPTURE_LOG',captureLog);
              console.log('[11A.30] LIVE_VS_PRE_END_SUMMARY',summary);
              console.log('[11A.30] STALE_READBACKS_SUMMARY',{staleReadbackCount,totalLoggedEntries:captureLog.length,staleEntries:captureLog.filter(entry=>entry.wasStale)});
            }
          }catch(err){console.warn('[11A.30] LIVE_VS_PRE_END_SUMMARY failed',err);}
        }
        // TEMP DIAGNOSTIC (Phase 11A.25): opt-in only (window.
        // HardRoundDebugCapturePresentVsResolve, default off/undefined --
        // normal pointerup timing and the real endStroke() call directly
        // below are completely unchanged either way). Runs
        // LIVE_PRESENT_DIAG then FINAL_RESOLVE_DIAG back-to-back against
        // the SAME strokeMaskTex this stroke is about to commit from --
        // no drawSegments() call happens between them or before
        // endStroke() below, matching the "immediately before pointerup
        // finalization mutates anything" requirement. Both diagnostic
        // passes are read-only (they render strokeMaskTex into their own
        // scratch textures, never writing to strokeMaskTex, _outCtx, or
        // the swapchain), so this cannot influence what endStroke()
        // itself resolves or commits.
        if(gpuCommit&&window.HardRoundDebugCapturePresentVsResolve&&renderer.gpu&&renderer.gpu.ready){
          try{
            window.HardRoundPresentVsResolveResult=await window.HardRoundRunPresentVsResolveDiagnostic(renderer);
            console.log('[11A.25] LIVE_PRESENT_DIAG vs FINAL_RESOLVE_DIAG',window.HardRoundPresentVsResolveResult);
          }catch(err){console.warn('[11A.25] present-vs-resolve diagnostic failed',err);}
        }
        // The debug-only session guard must also cover the shared renderer:
        // after a new beginStroke(), ending it here would end the new stroke.
        let endStrokePromise=null;
        const mayEndRenderer=_hrStaleFinalizerMutation(finalizingStrokeSession,'renderer.endStroke',gpuCommit?'gpu-active':'cpu-active','ended',()=>{
          endStrokePromise=renderer.endStroke({readback:gpuCommit});
        });
        if(!mayEndRenderer)return{result:null,endStrokeCalledAt,hr20PreEnd};
        return endStrokePromise.then(result=>({result,endStrokeCalledAt,hr20PreEnd}));
      }).then(({result,endStrokeCalledAt,hr20PreEnd})=>{
        _traceStrokeLifecycle('hardround-endStroke-resolve',{elapsedMs:performance.now()-endStrokeCalledAt,hasCanvas:!!(result&&result.canvas),segmentCount:result&&result.segmentCount,overlayVisibleBeforeHide:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null,inStroke:_inStroke});
        // Phase 11B.2 cleanup: Phase 11A.16/11A.20's C/FINAL_GPU captures used
        // to run unconditionally on every gpuCommit stroke, each doing a
        // full-canvas ctx.getImageData() -- source of the recurring
        // "getImageData performance warnings" console noise and needless
        // per-stroke CPU cost. The out-of-order-completion hypothesis these
        // captures existed to test has already been disproven
        // (provesOutOfOrderCompletion:false, see 11A.31), so they are now
        // gated behind an explicit opt-in flag (default off) instead of
        // removed outright, in case a later phase needs to re-run them.
        let hr20FinalGpu=null;
        if(gpuCommit&&window.HardRoundDebugPhase11A16Captures){
          window.HardRoundDebugCapture.C=_hrCaptureCanvas(result&&result.canvas,'C-endStroke-readback');
          try{
            hr20FinalGpu=result&&result.canvas?_hrHashCanvas(result.canvas,'FINAL_GPU'):null;
            if(window.HardRoundDebugPhase11A30){
              console.log('[11A.30] FINAL_GPU',hr20FinalGpu);
              console.log('[11A.30] PRE_END vs FINAL_GPU',_hrDiffHashes(hr20PreEnd,hr20FinalGpu));
            }
          }catch(err){console.warn('[11A.20] FINAL_GPU capture failed',err);}
        }
        // Phase 11A.33 causal test: window.HardRoundDebugKeepGpuOverlayAfterCommit
        // (default false), gates ONLY this overlay-hide call. When true and
        // this is a GPU-committed stroke, endStroke/_commitStrokeCanvas/
        // saveActiveToKey/recomposite below all still run completely
        // normally -- only the act of hiding #hard-round-gpu-overlay is
        // suppressed, leaving the last-presented GPU overlay frame visibly
        // on top of (not instead of) the freshly committed Canvas2D layer.
        // Nothing is redrawn or re-presented into the overlay here.
        const hr33KeepOverlay=!!(gpuCommit&&window.HardRoundDebugKeepGpuOverlayAfterCommit);
        _hr1135Log('pre-overlay-hide');
        if(!hr33KeepOverlay){
          const overlay=_hardRoundGpuOverlay(),overlayBefore=overlay?!overlay.hidden:null;
          _hrStaleFinalizerMutation(finalizingStrokeSession,'gpuOverlayVisible',overlayBefore,false,()=>_hardRoundSetGpuOverlayVisible(false,'endStroke-post-commit-hide'));
        } else if(window.HardRoundDebugPhase11A33){
          console.log('[11A.33 HANDOFF]','overlay-hide suppressed after commit; run document.getElementById(\'hard-round-gpu-overlay\').style.display=\'none\' manually to observe the handoff');
        }
        if(_inStroke){
          const mayMutateSharedStroke=_hrStaleFinalizerMutation(finalizingStrokeSession,'strokeScratchCanvas','current-shared-stroke','old-finalized-stroke',()=>{});
          if(mayMutateSharedStroke){
          // Phase 11A.36 stage A: the GPU-resolved result exactly as
          // returned by renderer.endStroke(), BEFORE it is copied into
          // _strokeCanvas. Captured here (not earlier) so it reflects
          // whatever endStroke({readback:gpuCommit}) actually produced --
          // no assumptions about which internal shader path was used.
          if(gpuCommit&&result&&result.canvas)_hrStageDiagCaptureA(result.canvas);
          if(result&&result.canvas&&_strokeCtx&&_strokeCanvas){
            // NOTE (11A.36 diagnostic note, not a fix): this drawImage runs
            // with WHATEVER globalAlpha/globalCompositeOperation _strokeCtx
            // currently has -- there is no ctx.save()/reset here. If a
            // prior CPU-path stroke left _strokeCtx.globalAlpha or
            // globalCompositeOperation non-default (_strokeCanvas is not
            // guaranteed to be recreated between strokes, only resized when
            // dimensions change), this copy would silently inherit that
            // stale state. Left unchanged per Phase 11A.36 scope (no fix
            // yet) -- but stage A vs stage B below will reveal it directly:
            // if A and B differ in anything other than the clearRect
            // region, that stale-ctx-state path is a live suspect.
            _strokeCtx.clearRect(0,0,_strokeCanvas.width,_strokeCanvas.height);
            _strokeCtx.drawImage(result.canvas,0,0);
          }
          // Phase 11A.36 stage B: the actual stroke source canvas exactly
          // as _commitStrokeCanvas() -> _getTexturedStrokeCanvas() will
          // read it.
          if(gpuCommit)_hrStageDiagCaptureB(_strokeCanvas);
          _hrStaleFinalizerMutation(finalizingStrokeSession,'_inStroke',_inStroke,false,()=>{_inStroke=false;});
          _commitStrokeCanvas();
          // Phase 11B.2 cleanup: Phase 11A.16 capture D + _hrRunCaptureSummary()
          // used to run unconditionally on every gpuCommit stroke (another
          // full-canvas getImageData(), stacked on top of A/B/C above) to
          // compare against the now-disproven out-of-order-completion
          // hypothesis. Gated behind the same opt-in flag as the C/FINAL_GPU
          // captures above; off by default.
          if(gpuCommit&&result&&result.canvas&&window.HardRoundDebugPhase11A16Captures){
            try{
              const w=result.canvas.width,h=result.canvas.height;
              const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
              tmp.getContext('2d').drawImage(activeC,0,0,w,h,0,0,w,h);
              window.HardRoundDebugCapture.D=_hrCaptureCanvas(tmp,'D-committed-layer-region');
            }catch(err){console.warn('[HR-CAPTURE] D failed',err);}
            _hrRunCaptureSummary();
          }
          }
        }
        _traceStrokeLifecycle('hardround-committed',{overlayVisible:_hardRoundGpuOverlay()?!_hardRoundGpuOverlay().hidden:null});
        _hr1135Log('post-commit-pre-recomposite');
        finishHardRoundStroke();
        _hr1135Log('post-recomposite');
        _hr1135LogAfterPaint('post-recomposite');
      });
    } else {
      if(_inStroke){_inStroke=false;_commitStrokeCanvas();}
      finishHardRoundStroke();
    }
    });
    return; // finalization happens in the continuation above, not the shared tail below
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
function _finalizePointerEndStroke(e,originStrokeId=_activeStrokeSession,fromAsync=false){
  if (_shouldRunCustomTipGpuDiagnostic() && window._customTipGpuRenderer && typeof window._customTipGpuRenderer.endStroke === 'function') {
    window._customTipGpuRenderer.endStroke();
  }
  const mutate=(name,before,after,apply)=>fromAsync?_hrStaleFinalizerMutation(originStrokeId,name,before,after,apply):(apply(),true);
  mutate('_hardRoundStrokeActive',_hardRoundStrokeActive,false,()=>{_hardRoundStrokeActive=false;}); // Phase 8C safety net
  if(window.HardRoundDebugRoutingTrace)mutate('routingTraceCurrentStroke','active','finalized',()=>_hrRtFinalizeStroke());
  mutate('colorEraserStrokeState','active','ended',()=>_endColorEraserStroke());
  mutate('postStrokePresentation','pending','complete',()=>_completePostStrokePresentation(_strokeOwnerLayer,_strokeOwnerFrame));
  mutate('strokeCompletionObservers','active','finished',()=>{
    _brushDiagPerfEnd(originStrokeId);
    const latencyProfiler=_brushPerf();if(latencyProfiler)latencyProfiler.finishStroke({tool,sourceLayer:_strokeOwnerLayer,sourceFrame:_strokeOwnerFrame});
    if(window.CompositionPrewarm)window.CompositionPrewarm.noteStrokeComplete();
    if(window.BrushRafExperiment)window.BrushRafExperiment.strokeEnds({dabCount:_strokeDabCount});
    if(window.BrushFirstDabExperiment)window.BrushFirstDabExperiment.strokeEnds({dabCount:_strokeDabCount});
    if(window.KeyframeLatencyExperiment)window.KeyframeLatencyExperiment.strokeEnds({dabCount:_strokeDabCount});
    if(window.TipReadbackExperiment)window.TipReadbackExperiment.strokeEnd();
    if(window.CustomFirstDabTrace)window.CustomFirstDabTrace.endStroke();
    if(window.CustomTipCacheTrace)window.CustomTipCacheTrace.strokeEnd();
    if(window.FirstDabLatencyProbe)window.FirstDabLatencyProbe.strokeComplete();
  });
  mutate('_baselineConditionerState',!!_baselineConditionerState,false,()=>_baselineConditionerFinish(false));
  mutate('_pendingDabs.length',_pendingDabs.length,0,()=>{_pendingDabs.length=0;});
  mutate('_curveP0',_curveP0,null,()=>{_curveP0=null;});
  mutate('_curveP1',_curveP1,null,()=>{_curveP1=null;});
  mutate('_strokeSegCarryOver',_strokeSegCarryOver,0,()=>{_strokeSegCarryOver=0;});
  mutate('_activeStrokePointerId',_activeStrokePointerId,null,()=>{_activeStrokePointerId=null;});
  mutate('_strokeOwnerLayer',_strokeOwnerLayer,-1,()=>{_strokeOwnerLayer=-1;});
  mutate('_strokeOwnerFrame',_strokeOwnerFrame,-1,()=>{_strokeOwnerFrame=-1;});
  _hrRapidPresentation('sharedFinalizerCompleted',originStrokeId,{fromAsync:!!fromAsync});
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
  if(_endVisibleCanvasColorSampling(e.pointerId)){if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);return;}
  _pointerEndStroke(e);
  if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);
});
activeC.addEventListener('pointercancel',e=>{_endVisibleCanvasColorSampling(e.pointerId);_endStroke(e.pointerId);});
activeC.addEventListener('lostpointercapture',e=>{_endVisibleCanvasColorSampling(e.pointerId);if(tool==='curve'&&_curveToolGesture&&_curveToolGesture.phase==='bending')return;_endStroke(e.pointerId);});

window.CustomBrushAnalyzeResolvedDabs = function() {
  const log = window._resolvedCustomTipDabLog || [];
  const firstDab = log.length > 0 ? log[0] : null;
  const lastDab = log.length > 0 ? log[log.length - 1] : null;
  const fieldsPresent = firstDab ? Object.keys(firstDab) : [];
  const taperReplayCount = log.filter(d => d.isTaperReplay).length;

  return {
    strokeId: firstDab ? firstDab.strokeId : null,
    customTipActive: !!window.brushTipCanvas,
    resolvedDabCount: log.length,
    drawDabNowCount: window._resolvedCustomTipDrawDabNowCount || 0,
    firstDab,
    lastDab,
    fieldsPresent,
    taperReplayCount
  };
};

