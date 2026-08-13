'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const renderer=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');
const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');

test('reserve warmup never submits a transparent shared frame while the surface is owned or presented',()=>{
  const start=renderer.indexOf('warmPresentation()');
  const end=renderer.indexOf('async prepareGpuPresentation()',start);
  const body=renderer.slice(start,end);
  const occupied=body.indexOf('const sharedSurfaceOccupied');
  const suppressed=body.indexOf("sharedPresentTrace('sharedBlankPresentSuppressed'",occupied);
  const sharedPresent=body.indexOf("await this.present([0, 0, 0], 'paint', 0, { warmup: true })",occupied);
  assert.ok(occupied>=0&&suppressed>occupied&&sharedPresent>suppressed,{occupied,suppressed,sharedPresent});
  assert.match(body,/if\(sharedSurfaceOccupied\)[\s\S]*?return true/);
});

test('shared presentation telemetry identifies blank submissions and bridge state at queue submit',()=>{
  assert.match(renderer,/event === 'sharedPresentSubmit'/);
  assert.match(renderer,/sharedPresentStrokeId:producingStrokeId/);
  assert.match(renderer,/sharedPresentOpacity:strokeOpacity/);
  assert.match(renderer,/sharedPresentClearAlpha:0/);
  assert.match(renderer,/sharedPresentLoadOp:'clear'/);
  assert.match(renderer,/sharedPresentWasBlank:strokeOpacity<=0\|\|!containsGeometry/);
  assert.match(renderer,/sharedPresentDuringBridge:presentedBefore!=null&&owner!=null&&presentedBefore!==owner/);
  assert.match(renderer,/window\.HardRoundAnalyzeSharedPresentation/);
});

test('new visible presentation directly supersedes the old bridge without an intermediate blank',()=>{
  const state={owner:3,presented:2,visible:true,submissions:[]};
  const submit=(strokeId,opacity,geometry,purpose)=>{
    const blank=opacity<=0||!geometry;
    if(purpose==='prewarm'&&(state.owner!=null||state.presented!=null))return 'suppressed';
    state.submissions.push({strokeId,blank});
    if(!blank)state.presented=strokeId;
    return 'submitted';
  };
  assert.equal(submit(null,0,false,'prewarm'),'suppressed');
  assert.equal(state.presented,2);
  assert.equal(state.visible,true);
  assert.equal(submit(3,1,true,'live-preview'),'submitted');
  assert.equal(state.presented,3);
  assert.equal(state.visible,true);
  assert.equal(state.submissions.some(item=>item.blank),false);
});

test('old finalizer remains unable to alter shared presentation after newer ownership',()=>{
  assert.match(engine,/overlayHideSuppressed/);
  assert.match(engine,/older-finalizer-newer-owner/);
  const presentStart=renderer.indexOf('async present(rgb, composite, opacity, meta)');
  const ownerGuard=renderer.indexOf("return { presented: false, reason: 'not-overlay-owner'",presentStart);
  const texture=renderer.indexOf('getCurrentTexture()',presentStart);
  assert.ok(ownerGuard>presentStart&&texture>ownerGuard);
});
