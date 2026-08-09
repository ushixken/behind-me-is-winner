// Phase 10.1 -- raw stylus batching and stabilization invariants.
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {PrototypeStrokeCore}=require('./prototype-stroke-core.js');
const {PrototypeRenderer}=require('./prototype-renderer.js');
let passed=0,failed=0;const pending=[];function test(n,f){pending.push(Promise.resolve().then(f).then(()=>{passed++;console.log(`  ok - ${n}`)},e=>{failed++;console.error(`  FAIL - ${n}\n    ${e.stack||e}`)}));}
function ctx(w,h){const data=new Uint8ClampedArray(w*h*4);return{data,createImageData:(iw,ih)=>({data:new Uint8ClampedArray(iw*ih*4),width:iw,height:ih}),putImageData(img,dx,dy){for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const s=(y*img.width+x)*4,d=((dy+y)*w+dx+x)*4;data.set(img.data.subarray(s,s+4),d)}},clearRect(){data.fill(0)}}}
function samples(pointerType='pen'){return Array.from({length:80},(_,i)=>({x:20+i*1.7,y:40+Math.sin(i/9)*8,pressure:pointerType==='pen'?.15+i/160:1,pointerType,timeStamp:100+i*2}));}
function coreRun(batched,pointerType='pen'){const c=new PrototypeStrokeCore({brushSize:700,stabilization:.55,zoom:1}),all=samples(pointerType);c.beginStroke({...all[0],timeStamp:98});const out=[];if(batched)out.push(...c.pushSamples(all));else for(const s of all)out.push(...c.pushSamples([s]));return out;}
test('coalesced stylus batch and individual raw events produce identical stabilized segments',()=>assert.deepStrictEqual(coreRun(true,'pen'),coreRun(false,'pen')));
test('mouse and pressure-fixed pen samples produce identical stabilized geometry',()=>{const pen=samples('pen').map(s=>({...s,pressure:1})),run=a=>{const c=new PrototypeStrokeCore({brushSize:700,stabilization:.55,zoom:1});c.beginStroke({...a[0],timeStamp:98});return c.pushSamples(a).map(s=>[s.x0,s.y0,s.x1,s.y1])};assert.deepStrictEqual(run(pen),run(samples('mouse')));});
async function render(batch){const r=new PrototypeRenderer({width:320,height:220});r._outCanvas={};r._outCtx=ctx(320,220);const s=Array.from({length:30},(_,i)=>({x0:60+i*.8,y0:100+i*.1,x1:60+(i+1)*.8,y1:100+(i+1)*.1,r0:90,r1:90,alpha0:1,alpha1:1,rgb:[0,0,0],aaMode:'medium'}));r.beginStroke();if(batch)r.drawSegments(s);else for(const q of s)r.drawSegments([q]);await r.endStroke();return r._outCtx.data;}
test('frame-batched and per-event segment dispatch are pixel-identical',async()=>assert.deepStrictEqual(await render(true),await render(false)));
test('pen raw events use one exclusive input path and preserve coalesced samples',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/if\(_hasRawUpdate && e\.pointerType === 'pen'\) return/.test(src));assert.ok(/getCoalescedEvents/.test(src));assert.ok(!/getPredictedEvents/.test(src));});
test('movement rasterization flushes at RAF while first/final segments flush explicitly',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/requestAnimationFrame\(\(\)=>\{[\s\S]*?_hardRoundFlushPending\(renderer\);[\s\S]*?_hardRoundPresentLivePreview/.test(src));assert.ok(/_hardRoundPendingRenderSegments\.push\(\.\.\.renderSegs\)/.test(src));});
test('expensive live frames yield an input window without dropping queued segments',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/rasterMs>8\?Math\.min\(50,rasterMs\):0/.test(src));assert.ok(/setTimeout\(\(\)=>\{[\s\S]*?_hardRoundSchedulePreviewFrame\(renderer\)/.test(src));assert.ok(/if\(_hardRoundPendingRenderSegments\.length\)_hardRoundRequestLivePreview\(renderer\)/.test(src));assert.ok(/splice\(0,_hardRoundPendingRenderSegments\.length\)/.test(src));});
test('stroke completion cancels both preview scheduling mechanisms',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');const start=src.indexOf('function _hardRoundCancelLivePreview(');const body=src.slice(start,src.indexOf('\n}',start)+2);assert.ok(/cancelAnimationFrame/.test(body));assert.ok(/clearTimeout/.test(body));});
test('cancelLivePreview only hides the GPU overlay when explicitly asked, and pointerup finish defers the hide to commit time',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');const start=src.indexOf('function _hardRoundCancelLivePreview(');const body=src.slice(start,src.indexOf('\n}',start)+2);assert.ok(/hideOverlay/.test(body),'cancelLivePreview should take a hideOverlay flag');assert.ok(/if\(hideOverlay\)_hardRoundSetGpuOverlayVisible\(false\)/.test(body),'overlay hide must be conditional');assert.ok(/_hardRoundCancelLivePreview\(false\)/.test(src),'pointerup finish path must defer the overlay hide');});
test('a stale in-flight peekStroke() resolve cannot re-show the overlay after cancelLivePreview has already run (prevents post-commit duplicate)',()=>{
  const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
  // _activeStrokeSession only advances on the next pointerdown and _inStroke
  // only flips false partway through the async commit -- neither guard is
  // set at the moment cancelLivePreview runs. A dedicated generation token,
  // bumped there and checked before ANY of those guards inside the
  // peekStroke().then() callback, is what actually closes the race.
  const presentStart=src.indexOf('function _hardRoundPresentLivePreview(');
  const presentBody=src.slice(presentStart,src.indexOf('\n}',presentStart)+2);
  assert.ok(/const previewGeneration\s*=\s*_hardRoundPreviewGeneration/.test(presentBody),'must snapshot the generation before the async call');
  assert.ok(/if\(previewGeneration!==_hardRoundPreviewGeneration\)\s*return;/.test(presentBody),'resolved callback must bail on a stale generation');
  const cancelStart=src.indexOf('function _hardRoundCancelLivePreview(');
  const cancelBody=src.slice(cancelStart,src.indexOf('\n}',cancelStart)+2);
  assert.ok(/_hardRoundPreviewGeneration\+\+/.test(cancelBody),'cancelLivePreview must invalidate the generation so in-flight previews cannot land after it');
});
Promise.all(pending).then(()=>{console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1)});
