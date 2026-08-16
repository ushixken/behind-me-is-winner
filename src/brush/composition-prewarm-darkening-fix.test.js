'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
const panels=fs.readFileSync(path.join(__dirname,'..','ui','panels.js'),'utf8');

function fnBody(source,fnSignaturePattern){
  const m=fnSignaturePattern.exec(source);
  assert.ok(m,`expected to find ${fnSignaturePattern}`);
  const start=m.index;
  // Find the matching closing brace for the function starting at `start`.
  const openIdx=source.indexOf('{',start);
  let depth=0,i=openIdx;
  for(;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'){depth--;if(depth===0)break;}
  }
  return source.slice(start,i+1);
}

test('A: _prewarmLiveStrokeComposition no longer calls the real recomposite()',()=>{
  const body=fnBody(engine,/function _prewarmLiveStrokeComposition\(\)/);
  assert.doesNotMatch(body,/recomposite\(/,'prewarm must not route through the shared compositor');
  assert.match(body,/_getLiveStrokePreview\(\)/,'prewarm should still warm the live-preview path directly');
});

test('B: prewarm never references the real display/composite surfaces by name',()=>{
  const body=fnBody(engine,/function _prewarmLiveStrokeComposition\(\)/);
  for(const forbidden of ['displayC','compC','artworkCompositeC']){
    assert.doesNotMatch(body,new RegExp('\\b'+forbidden+'\\b'),`prewarm must not touch ${forbidden}`);
  }
  // activeC is legitimately READ (via _getLiveStrokePreview's internal
  // drawImage(activeC,...)) but prewarm's own body must never assign to it.
  assert.doesNotMatch(body,/activeC\s*=[^=]/,'prewarm must not write to activeC');
});

test('C: prewarm still exercises the scratch/live-preview allocation path',()=>{
  const body=fnBody(engine,/function _prewarmLiveStrokeComposition\(\)/);
  assert.match(body,/_ensureStrokeCanvas\(\)/);
  assert.match(body,/_getLiveStrokePreview\(\)/);
  assert.match(body,/_strokePreviewCtx/);
  assert.match(body,/_texturedStrokeCtx/);
  assert.match(body,/_srPreviewTintCtx/);
  // _getLiveStrokePreview itself must remain read-only with respect to the
  // real compositor -- it should never appear alongside compC/displayC.
  const preview=fnBody(engine,/function _getLiveStrokePreview\(\)/);
  for(const forbidden of ['displayC','compC','artworkCompositeC']){
    assert.doesNotMatch(preview,new RegExp('\\b'+forbidden+'\\b'),`_getLiveStrokePreview must not touch ${forbidden}`);
  }
});

test('D: CompositionPrewarm.run()/focus scheduling remains intact',()=>{
  assert.match(panels,/const CompositionPrewarm=\(function\(\)\{/);
  assert.match(panels,/function run\(reason\)\{/);
  assert.match(panels,/function schedule\(reason\)\{/);
  assert.match(panels,/function markCold\(reason\)\{/);
  assert.match(panels,/window\.addEventListener\('focus',\(\)=>resume\('focus'\)\);/);
  assert.match(panels,/const livePath=typeof window\._prewarmLiveStrokeComposition==='function'&&window\._prewarmLiveStrokeComposition\(\);/);
  assert.match(panels,/if\(!livePath\)recomposite\(curLayer,curFrame\);/);
});

test('E: normal real strokes still call recomposite() as before',()=>{
  assert.match(engine,/function _scheduleRecomposite\(options\)\{/);
  const scheduleBody=fnBody(engine,/function _scheduleRecomposite\(options\)\{/);
  assert.match(scheduleBody,/recomposite\(curLayer,curFrame,rect\)/);
  assert.match(scheduleBody,/recomposite\(layerIndex,frameIndex,rect\)/);
  assert.match(engine,/function _completePostStrokePresentation\(layerIndex,frameIndex\)\{/);
  const postStroke=fnBody(engine,/function _completePostStrokePresentation\(layerIndex,frameIndex\)\{/);
  assert.match(postStroke,/recomposite\(layerIndex,frameIndex\)/);
});

test('F: existing dirty-rect live-stroke callers and recomposite() itself are unchanged',()=>{
  assert.match(panels,/function recomposite\(li,fi,dirtyRect\)\{/);
  const recompositeBody=fnBody(panels,/function recomposite\(li,fi,dirtyRect\)\{/);
  // The clip/display-assembly asymmetry documented during the investigation
  // is untouched by this patch -- recomposite() itself was not modified.
  assert.match(recompositeBody,/const clip = \(dirtyRect && dirtyRect\.w>0 && dirtyRect\.h>0\) \? dirtyRect : null;/);
  assert.match(recompositeBody,/displayCtx\.clearRect\(0,0,CW,CH\);/);
  assert.match(recompositeBody,/displayCtx\.drawImage\(compC,0,0\);/);
  assert.match(recompositeBody,/displayCtx\.drawImage\(onionC,0,0\);/);
  assert.match(recompositeBody,/displayCtx\.drawImage\(artworkCompositeC,0,0\);/);
});

test('G: no temporary darkening-investigation diagnostics remain in production source',()=>{
  for(const source of [engine,panels]){
    assert.doesNotMatch(source,/darken-investigation/i);
    assert.doesNotMatch(source,/_hrChecksum/);
    assert.doesNotMatch(source,/_hrFullHash/);
    assert.doesNotMatch(source,/_hrLogCanvasState/);
    assert.doesNotMatch(source,/_hrDarkenEvent/);
    assert.doesNotMatch(source,/debugDarkenInvestigation/);
    assert.doesNotMatch(source,/_hrInsideCompositionPrewarm/);
    assert.doesNotMatch(source,/_hrDisablePrewarmLiveStroke/);
    assert.doesNotMatch(source,/HR-DARKEN/);
  }
});

test('H: unrelated pre-existing diagnostics (Hard Round stage capture, Custom Tip) are preserved',()=>{
  assert.match(panels,/_hrStageDiagCaptureE1/);
  assert.match(panels,/_hrStageDiagCaptureE2/);
  assert.match(panels,/_hrStageDiagCaptureE3/);
  assert.match(engine,/_hrStageDiagCaptureC/);
  assert.match(engine,/_hrStageDiagCaptureD/);
  assert.match(engine,/HardRoundStageDiag|_hrStageDiagEnabled/);
});