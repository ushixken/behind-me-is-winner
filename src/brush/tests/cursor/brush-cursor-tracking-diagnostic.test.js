const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname, '..', '..', 'brush-size-cursor.js'),'utf8');

test('tracking diagnostic is default-off, bounded, and quiet',()=>{
  assert.match(source,/typeof window\.BrushCursorDebugTracking==='undefined'/);
  assert.match(source,/if\(!window\.BrushCursorDebugTracking\)return/);
  assert.match(source,/if\(log\.length>100\)log\.splice\(0,log\.length-100\)/);
  assert.doesNotMatch(source,/console\.(?:log|debug|warn)/);
});

test('diagnostic distinguishes timestamp rejection from RAF application',()=>{
  assert.match(source,/timestamp-older-than-latest/);
  assert.match(source,/type:'cursor-raf-apply'/);
  assert.match(source,/sourceEventType:latestSourceEventType/);
  assert.match(source,/sourceEventTimestamp:latestSourceEventTime/);
});

test('contact transition events are traced',()=>{
  for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])assert.match(source,new RegExp("addEventListener\\('"+type+"'"));
  assert.match(source,/window\.BrushCursorAnalyzeTracking=function/);
});

test('diagnostic does not change timestamp acceptance or newest-position RAF behavior',()=>{
  assert.match(source,/if\(eventTime<latestPointerTime\)/);
  assert.match(source,/lastX=event\.clientX;lastY=event\.clientY/);
  assert.match(source,/requestAnimationFrame\(\(\)=>\{cursorRaf=0;update\(false\)/);
});
