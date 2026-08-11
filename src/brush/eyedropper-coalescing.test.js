const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');

function makeCoalescer(){
  let active=1,pending=false,latest=null,last=null,samples=[];
  return {
    down(position,rgba){active=position.pointerId;last=null;samples.push({position,rgba});last=rgba;},
    move(position){latest=position;if(!pending)pending=true;},
    frame(rgba){if(!pending)return;pending=false;const position=latest;latest=null;if(!position||position.pointerId!==active)return;if(rgba===last)return;samples.push({position,rgba});last=rgba;},
    end(pointerId){if(pointerId===active){active=null;pending=false;latest=null;}},
    get samples(){return samples;}
  };
}

test('many raw updates produce one sample and newest coordinate wins',()=>{
  const picker=makeCoalescer();picker.down({pointerId:1,clientX:0},'1,2,3,255');
  picker.move({pointerId:1,clientX:10});picker.move({pointerId:1,clientX:20});picker.move({pointerId:1,clientX:30});
  picker.frame('4,5,6,255');
  assert.equal(picker.samples.length,2);assert.equal(picker.samples[1].position.clientX,30);
});

test('unchanged RGBA skips downstream application',()=>{
  const picker=makeCoalescer();picker.down({pointerId:1,clientX:0},'1,2,3,255');picker.move({pointerId:1,clientX:5});picker.frame('1,2,3,255');
  assert.equal(picker.samples.length,1);
});

test('pointer end prevents stale queued application',()=>{
  for(const kind of ['up','cancel']){const picker=makeCoalescer();picker.down({pointerId:1},'0,0,0,255');picker.move({pointerId:1,clientX:9});picker.end(1);picker.frame('9,9,9,255');assert.equal(picker.samples.length,1,kind);}
});

test('source keeps immediate down and coalesces both mouse and pen movement',()=>{
  assert.match(source,/_eyedropperLastAppliedRgba=null;activeC\.setPointerCapture\(e\.pointerId\);_sampleVisibleCanvasColor\(e\)/);
  const queueCalls=source.match(/_queueVisibleCanvasColorSample\(e\)/g)||[];
  assert.equal(queueCalls.length,3); // definition plus pointermove and pointerrawupdate
  assert.match(source,/compCtx\.getImageData\(x,y,1,1\)/);
  assert.match(source,/cancelAnimationFrame\(_eyedropperSampleRaf\)/);
});
