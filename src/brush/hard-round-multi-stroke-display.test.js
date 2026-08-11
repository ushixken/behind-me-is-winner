const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');

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
