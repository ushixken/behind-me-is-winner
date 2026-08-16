// Phase 11A.3 -- proves the live Hard Round GPU overlay canvas
// (#hard-round-gpu-overlay) receives the exact same zoom-dependent
// `image-rendering` treatment as its sibling canvas-wrap canvases
// (display-canvas, onion-canvas, active-canvas, transform-canvas) in
// applyTransform(). This is a static source check (core-state.js requires
// a real `document`/DOM and isn't unit-testable headlessly in this suite),
// but it targets the actual proven regression: the overlay was left out of
// that canvas list, so at zoom>=1.5 every sibling canvas switched to crisp
// 'pixelated' CSS scaling while the overlay silently kept the browser
// default 'auto' (bilinear) scaling -- which is what made the live Hard
// Round stroke look softer than the committed one, and why it visibly
// sharpened the instant pointerup hid the overlay.
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
let passed=0,failed=0;const pending=[];
function test(n,f){pending.push(Promise.resolve().then(f).then(()=>{passed++;console.log(`  ok - ${n}`)},e=>{failed++;console.error(`  FAIL - ${n}\n    ${e.stack||e}`)}));}

const src=fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'core','core-state.js'),'utf8');

test('core-state.js holds a DOM ref to the Hard Round GPU overlay canvas',()=>{
  assert.ok(/const hardRoundOverlayC=document\.getElementById\('hard-round-gpu-overlay'\);/.test(src));
});

test('applyTransform()\'s zoom image-rendering sync includes the overlay canvas alongside its siblings',()=>{
  const fnMatch=src.match(/function applyTransform\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch,'applyTransform() not found');
  const body=fnMatch[0];
  // A further sibling (customTipC, the Custom Tip GPU overlay) has since
  // been added to the same synchronized list -- hardRoundOverlayC's
  // membership and treatment is unaffected. Match membership in the
  // forEach array rather than pinning its exact (now longer) contents.
  const listMatch=body.match(/\[([^\]]*)\]\.forEach/);
  assert.ok(listMatch,'applyTransform() must have an image-rendering forEach list');
  const members=listMatch[1].split(',').map(s=>s.trim());
  for(const required of ['displayC','onionC','activeC','hardRoundOverlayC','transformC']){
    assert.ok(members.includes(required),`the image-rendering forEach list must include ${required}`);
  }
});

test('the image-rendering assignment is null-guarded (overlay element may be absent in non-browser test harnesses)',()=>{
  const fnMatch=src.match(/function applyTransform\(\)\{[\s\S]*?\n\}/);
  const body=fnMatch[0];
  assert.ok(/if\(c\)c\.style\.imageRendering=useNN\?'pixelated':'auto';/.test(body));
});

test('no other code path sets image-rendering on the overlay, so applyTransform() is the single source of truth for it',()=>{
  const brushEngine=fs.readFileSync(path.join(__dirname, '..', '..', '..', 'brush-engine.js'),'utf8');
  const rendererSrc=fs.readFileSync(path.join(__dirname, '..', '..', '..', 'prototype-renderer.js'),'utf8');
  assert.ok(!/hard-round-gpu-overlay[\s\S]{0,200}imageRendering/.test(brushEngine));
  assert.ok(!/imageRendering/.test(rendererSrc));
});

Promise.all(pending).then(()=>{console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1)});