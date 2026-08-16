const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname, '..', '..', '..', 'brush-engine.js'),'utf8');
const toolsColorSource=fs.readFileSync(path.join(__dirname, '../../../../ui/tools-color.js'),'utf8');

test('pointerup contains no references to removed cadence scheduler state',()=>{
  assert.doesNotMatch(source,/_hardRoundPreviewTimer/);
  assert.doesNotMatch(source,/_hardRoundPreviewNotBefore/);
  assert.match(source,/previewInFlight:_hardRoundPreviewInFlight/);
  assert.match(source,/previewFollowupPending:_hardRoundPreviewNeedsFollowup/);
});

test('normal and Smart owned finalization still enter the ordered commit queue',()=>{
  assert.match(source,/const commit=_hardRoundCommitTail\.then\(\(\)=>resolution\)\.then\(ready=>\{/);
  assert.match(source,/if\(ready\.smartRaster\)_commitFinishedSmartRasterStroke\(ready\);else _commitFinishedHardRoundStroke\(ready\)/);
  assert.match(source,/_hardRoundCommitTail=settled\.catch/);
});

test('normal commit preserves existing destination pixels and refreshes its key',()=>{
  const start=source.indexOf('function _commitFinishedHardRoundStroke(');
  const end=source.indexOf('function _commitFinishedSmartRasterStroke(',start);
  const body=source.slice(start,end);
  assert.match(body,/target\.drawImage\(src,0,0\)/);
  assert.doesNotMatch(body,/target\.clearRect/);
  assert.match(body,/keyCtx\.clearRect[\s\S]*?keyCtx\.drawImage\(activeC,0,0\)/);
  assert.match(body,/recomposite\(context\.layerIndex,context\.frameIndex\)/);
});

test('Smart commit preserves destination accumulation and explicit style ownership commit',()=>{
  const start=source.indexOf('function _commitFinishedSmartRasterStroke(');
  const end=source.indexOf('function _hardRoundReleaseFinishingContext(',start);
  const body=source.slice(start,end);
  assert.match(body,/target\.drawImage\(mask/);
  assert.doesNotMatch(body,/target\.clearRect/);
  assert.match(body,/commitSmartRasterBrushAt\(context\.layerIndex,context\.frameIndex/);
  assert.match(body,/recomposite\(context\.layerIndex,context\.frameIndex\)/);
});

test('rapid contexts retain independent results and commit in stroke order',async()=>{
  let release;
  const order=[];
  let tail=Promise.resolve();
  const enqueue=(strokeId,promise)=>{const commit=tail.then(()=>promise).then(()=>order.push(strokeId));tail=commit.catch(()=>{});return commit;};
  const first=new Promise(resolve=>{release=resolve;});
  const p1=enqueue(1,first),p2=enqueue(2,Promise.resolve()),p3=enqueue(3,Promise.resolve());
  release();await Promise.all([p1,p2,p3]);
  assert.deepEqual(order,[1,2,3]);
});

test('pointerup reserves the owned authoritative commit before asynchronous presentation/readback',()=>{
  const finalizeStart=source.indexOf('function _hardRoundFinalizeOwnedContext(');
  const finalizeEnd=source.indexOf('// TEMP DIAGNOSTIC',finalizeStart);
  const body=source.slice(finalizeStart,finalizeEnd);
  const reserve=body.indexOf('const resolution=new Promise');
  const presentation=body.indexOf('_hardRoundPresentFinishedFrame');
  const endStroke=body.indexOf('context.renderer.endStroke');
  const queue=body.indexOf('const commit=_hardRoundCommitTail.then(()=>resolution)');
  assert.ok(reserve>=0&&presentation>reserve&&endStroke>presentation&&queue>endStroke,{reserve,presentation,endStroke,queue});
  assert.doesNotMatch(body,/_hrStaleFinalizerMutation[\s\S]*?renderer\.endStroke/);
});

test('mandatory old-stroke commit is independent of shared live scratch state',()=>{
  const pointerup=source.indexOf('const ownedContext=_hardRoundActiveContext');
  const handoff=source.indexOf('_hardRoundFinalizeOwnedContext(ownedContext,e)',pointerup);
  assert.ok(pointerup>=0&&handoff>pointerup);
  const handoffBody=source.slice(pointerup,handoff);
  assert.match(handoffBody,/_hardRoundActiveContext=null/);
  assert.match(handoffBody,/ownedContext\.renderer=renderer/);
  // presentFinishedFrame is no longer unconditionally true: the CPU path no
  // longer needs the finished-frame presentation step (see the removal of
  // the artificial 2-rAF paint wait), so this now only applies when the
  // stroke is a GPU commit.
  assert.match(handoffBody,/ownedContext\.presentFinishedFrame=ownedContext\.gpuCommit/);
});

test('ten reversed resolve completions still commit exactly once in pointerup order',async()=>{
  const deferreds=Array.from({length:10},()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};});
  let tail=Promise.resolve();const commits=[];
  const queued=deferreds.map((item,index)=>{
    const commit=tail.then(()=>item.promise).then(()=>commits.push(index+1));
    tail=commit.catch(()=>{});return commit;
  });
  for(let index=deferreds.length-1;index>=0;index--)deferreds[index].resolve();
  await Promise.all(queued);
  assert.deepEqual(commits,[1,2,3,4,5,6,7,8,9,10]);
  assert.equal(new Set(commits).size,10);
});

test('ordered commits capture undo from their explicit layer/frame immediately before paint',()=>{
  const normalStart=source.indexOf('function _commitFinishedHardRoundStroke(');
  const normalEnd=source.indexOf('function _commitFinishedSmartRasterStroke(',normalStart);
  const normal=source.slice(normalStart,normalEnd);
  assert.ok(normal.indexOf('pushUndoAt(context.layerIndex,context.frameIndex)')<normal.indexOf('target.drawImage(src,0,0)'));
  // The pushUndo() guard has since been extended to also exclude Custom Tip
  // GPU strokes (which, like Hard Round, push their own undo snapshot via
  // pushUndoAt at their explicit layer/frame instead) -- the invariant that
  // Hard Round strokes never trigger the generic pushUndo() is unchanged.
  assert.match(source,/if\(!_hardRoundStrokeActive&&!_customTipGpuStrokeActive\)pushUndo\(\)/);
  assert.match(toolsColorSource,/function pushUndoAt\(layerIndex,frameIndex\)/);
  assert.match(toolsColorSource,/layer\.frames\[frameIndex\]/);
  assert.match(toolsColorSource,/getStyleFrameBundle\(layerIndex,frameIndex\)/);
});