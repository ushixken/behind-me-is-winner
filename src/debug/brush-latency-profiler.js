(function(){
  'use strict';
  let enabled=(new URLSearchParams(location.search)).get('brushPerf')==='1',current=null,currentPrewarm=null,serial=0,prewarmSerial=0,lastActivity=performance.now(),nextScenario='',resumePending=false;
  const records=[],prewarms=[],lifecycle=[];
  function memory(){const m=performance.memory;return m?{usedJSHeapSize:m.usedJSHeapSize,totalJSHeapSize:m.totalJSHeapSize,jsHeapSizeLimit:m.jsHeapSizeLimit}:null;}
  function event(type){lifecycle.push({type,time:performance.now(),hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus()});if(type==='visibilitychange'&&!document.hidden||type==='focus'||type==='pageshow')resumePending=true;if(lifecycle.length>100)lifecycle.shift();}
  document.addEventListener('visibilitychange',()=>event('visibilitychange'));window.addEventListener('focus',()=>event('focus'));window.addEventListener('blur',()=>event('blur'));window.addEventListener('pageshow',()=>event('pageshow'));
  function active(){return current||currentPrewarm;}
  function canvasDetail(canvas,context,extra){return Object.assign({canvas:canvas&&canvas.id||canvas&&canvas.dataset&&canvas.dataset.role||null,width:canvas&&canvas.width||0,height:canvas&&canvas.height||0,context:context&&context.constructor&&context.constructor.name||null},extra||{});}
  function classify(idle){
    if(nextScenario){const result=nextScenario;nextScenario='';return result;}
    if(!records.length)return 'reload-cold';
    if(resumePending){resumePending=false;return 'tab-resume-cold';}
    if(idle>=12000)return 'idle-cold';
    const prior=records[records.length-1].scenario||'';
    if(prior.endsWith('-cold'))return prior.replace(/-cold$/,'-warm');
    return 'warm';
  }
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function stageMap(record){const map={};(record.stages||[]).forEach(stage=>{(map[stage.name]||(map[stage.name]=[])).push(stage.duration);});return Object.fromEntries(Object.entries(map).map(([name,values])=>[name,{total:values.reduce((a,b)=>a+b,0),calls:values.length,max:Math.max(...values)}]));}
  const api={
    enable(value=true){enabled=!!value;if(enabled)event('profiler-enabled');return enabled;},get enabled(){return enabled;},
    clear(){records.length=0;prewarms.length=0;lifecycle.length=0;current=null;currentPrewarm=null;lastActivity=performance.now();resumePending=false;},
    labelNextStroke(label){nextScenario=String(label||'');return nextScenario;},
    startStroke(detail){if(!enabled)return;const now=performance.now(),idle=now-lastActivity;current={kind:'stroke',id:++serial,scenario:classify(idle),startedAt:now,idleMs:idle,hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus(),renderer:'gpu',memoryStart:memory(),detail:detail||{},stages:[],points:[],firstDabAt:0,firstPresentationAt:0};},
    beginPrewarm(detail){if(!enabled||currentPrewarm)return 0;const now=performance.now();currentPrewarm={kind:'prewarm',id:++prewarmSerial,scenario:'prewarm',startedAt:now,detail:detail||{},stages:[],points:[],firstPresentationAt:0,memoryStart:memory()};return now;},
    endPrewarm(detail){if(!enabled||!currentPrewarm)return;const now=performance.now();currentPrewarm.endedAt=now;currentPrewarm.duration=now-currentPrewarm.startedAt;currentPrewarm.memoryEnd=memory();currentPrewarm.finishDetail=detail||null;prewarms.push(currentPrewarm);if(prewarms.length>100)prewarms.shift();currentPrewarm=null;},
    point(name,detail){const target=active();if(!enabled||!target)return;const now=performance.now();target.points.push({name,time:now,fromStart:now-target.startedAt,fromPointerDown:target.kind==='stroke'?now-target.startedAt:null,detail:detail||null});if(name==='first-dab-generated'&&target.kind==='stroke')target.firstDabAt=now;},
    measure(name,start,detail){const target=active();if(!enabled||!target||!start)return;target.stages.push({name,start:start-target.startedAt,duration:performance.now()-start,ranDuring:target.kind,detail:detail||null});},
    recordDuration(name,duration,detail){const target=active();if(!enabled||!target)return;const now=performance.now();target.stages.push({name,start:now-target.startedAt-Math.max(0,Number(duration)||0),duration:Math.max(0,Number(duration)||0),ranDuring:target.kind,detail:detail||null});},
    canvasDetail,
    presentationStart(){const target=active();if(!enabled||!target||target.firstPresentationAt)return 0;if(target.kind==='stroke'&&!target.firstDabAt)return 0;return performance.now();},
    presentationEnd(start,detail){const target=active();if(!start||!enabled||!target||target.firstPresentationAt)return;const now=performance.now();target.firstPresentationAt=now;target.stages.push({name:'presentation-total',start:start-target.startedAt,duration:now-start,ranDuring:target.kind,detail:detail||null});target.points.push({name:'first-display-presented',time:now,fromStart:now-target.startedAt,fromPointerDown:target.kind==='stroke'?now-target.startedAt:null});},
    finishStroke(detail){if(!enabled||!current)return;const now=performance.now();current.endedAt=now;current.totalToPointerUp=now-current.startedAt;current.memoryEnd=memory();current.finishDetail=detail||null;current.lifecycle=lifecycle.filter(e=>e.time>=lastActivity&&e.time<=now);records.push(current);if(records.length>100)records.shift();current=null;lastActivity=now;},
    results(){return records.map(clone);},prewarmResults(){return prewarms.map(clone);},latest(){return records.length?clone(records[records.length-1]):null;},lifecycle(){return lifecycle.slice();},
    summary(){return records.map(r=>({id:r.id,scenario:r.scenario,idleMs:r.idleMs,focused:r.focused,visibility:r.visibility,pointerDownToDisplay:(r.points.find(p=>p.name==='first-display-presented')||{}).fromPointerDown||null,totalToPointerUp:r.totalToPointerUp,stages:r.stages}));},
    compareColdWarm(){
      const comparisons=[];
      for(let i=0;i<records.length;i++){const cold=records[i],scenario=cold.scenario||'';if(!scenario.endsWith('-cold'))continue;const wanted=scenario.replace(/-cold$/,'-warm'),warm=records.slice(i+1).find(r=>r.scenario===wanted);if(!warm)continue;const prewarm=[...prewarms].reverse().find(p=>p.startedAt<cold.startedAt)||null;comparisons.push({scenario:scenario.replace(/-cold$/,''),prewarm:prewarm?{id:prewarm.id,duration:prewarm.duration,path:prewarm.finishDetail&&prewarm.finishDetail.path,stages:stageMap(prewarm)}:null,cold:{id:cold.id,idleMs:cold.idleMs,pointerDownToDisplay:(cold.points.find(p=>p.name==='first-display-presented')||{}).fromPointerDown||null,stages:stageMap(cold)},warm:{id:warm.id,idleMs:warm.idleMs,pointerDownToDisplay:(warm.points.find(p=>p.name==='first-display-presented')||{}).fromPointerDown||null,stages:stageMap(warm)}});}
      return clone(comparisons);
    }
  };window.BrushLatencyProfiler=api;
})();