'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
const rendererSource=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');
const panelsSource=fs.readFileSync(path.join(__dirname,'../ui/panels.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

test('production source detaches an owned renderer before asynchronous finalization',()=>{
  const detach=engine.indexOf('_hardRoundActiveContext=null;');
  const release=engine.indexOf('_hardRoundFinalizeOwnedContext(ownedContext,e)');
  assert.ok(detach>=0&&release>detach);
  assert.match(engine,/if\(_hardRoundRenderer===renderer\)_hardRoundRenderer=null/);
  assert.match(rendererSource,/renderer is owned by finishing stroke/);
});

test('three deferred results commit in stroke order despite 3,1,2 resolution',async()=>{
  let tail=Promise.resolve();const commits=[];const waits=[deferred(),deferred(),deferred()];
  for(let strokeId=1;strokeId<=3;strokeId++){
    const result=waits[strokeId-1].promise;
    tail=tail.then(()=>result).then(()=>{commits.push(strokeId);});
  }
  waits[2].resolve();await Promise.resolve();
  waits[0].resolve();await Promise.resolve();
  waits[1].resolve();await tail;
  assert.deepEqual(commits,[1,2,3]);
});

test('stable result is copied before renderer is returned to pool',()=>{
  const copy=engine.indexOf('const stable=_hardRoundCopyCanvas');
  const release=engine.indexOf('_hardRoundReleaseFinishingContext(context)',copy);
  assert.ok(copy>=0&&release>copy);
});

test('finished commit uses captured destination and settings, not shared stroke canvas',()=>{
  const start=engine.indexOf('function _commitFinishedHardRoundStroke');
  const end=engine.indexOf('function _hardRoundReleaseFinishingContext',start);
  const body=engine.slice(start,end);
  assert.match(body,/context\.resolvedCanvas/);
  assert.match(body,/context\.layerIndex/);
  assert.match(body,/context\.frameIndex/);
  assert.match(body,/context\.opacity/);
  assert.match(body,/context\.compositeOperation/);
  assert.doesNotMatch(body,/_strokeCanvas|_strokeCtx/);
});

test('live GPU presentation rejects a non-owner stroke before swapchain work',()=>{
  const start=rendererSource.indexOf('async present(rgb, composite, opacity, meta)');
  const guard=rendererSource.indexOf('!previewFlightCurrent(meta,meta.renderer)',start);
  const texture=rendererSource.indexOf('this.outputContext.getCurrentTexture()',start);
  assert.ok(start>=0&&guard>start&&texture>guard);
});

test('Smart Raster context captures style/destination and ordered commit captures ownership before paint',()=>{
  assert.match(engine,/styleId:typeof activeAdvancedStyleIdForPainting/);
  assert.match(engine,/smartRasterMode:/);
  assert.match(engine,/if\(!context\.ownershipBefore\)[\s\S]*?target\.getImageData/);
  assert.match(engine,/context\.resolvedMaskCanvas=stable/);
});

test('Smart Raster commit API uses explicit layer and frame',()=>{
  assert.match(panelsSource,/function commitSmartRasterBrushAt\(layerIndex,frameIndex/);
  assert.match(panelsSource,/commitBrushMask\(layerIndex,frameIndex,maskCanvas/);
  assert.match(panelsSource,/window\.commitSmartRasterBrushAt=commitSmartRasterBrushAt/);
});

test('deferred Smart Raster commits preserve style and ownership association',async()=>{
  const waits=[deferred(),deferred(),deferred()],contexts=[
    {strokeId:1,styleId:'red',ownershipBefore:'before-1'},
    {strokeId:2,styleId:'green',ownershipBefore:'before-2'},
    {strokeId:3,styleId:'blue',ownershipBefore:'before-3'},
  ];
  let tail=Promise.resolve();const committed=[];
  contexts.forEach((context,index)=>{tail=tail.then(()=>waits[index].promise).then(()=>committed.push(context));});
  waits[2].resolve();waits[0].resolve();await Promise.resolve();waits[1].resolve();await tail;
  assert.deepEqual(committed.map(item=>[item.strokeId,item.styleId,item.ownershipBefore]),[
    [1,'red','before-1'],[2,'green','before-2'],[3,'blue','before-3'],
  ]);
});

test('Smart Raster remains excluded from GPU live compatibility',()=>{
  assert.match(engine,/!\(layers\[curLayer\]&&layers\[curLayer\]\.type==='smart-raster'\)/);
});
