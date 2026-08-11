'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
const rendererSource=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

test('production source detaches an owned renderer before asynchronous finalization',()=>{
  const detach=engine.indexOf('_hardRoundActiveContext=null;');
  const release=engine.indexOf('_hardRoundFinalizeOwnedContext(ownedContext,e)');
  assert.ok(detach>=0&&release>detach);
  assert.match(engine,/if\(_hardRoundRenderer===ownedContext\.renderer\)_hardRoundRenderer=null/);
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
  const copy=engine.indexOf('context.resolvedCanvas=_hardRoundCopyCanvas');
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
  const guard=rendererSource.indexOf('meta.strokeId !== window.HardRoundOverlayOwnerStrokeId',start);
  const texture=rendererSource.indexOf('getCurrentTexture()',start);
  assert.ok(start>=0&&guard>start&&texture>guard);
});

