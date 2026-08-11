'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'brush-size-cursor.js'),'utf8');

test('brush cursor consumes high-rate raw pointer input',()=>{
  assert.match(src,/addEventListener\('pointerrawupdate',track,true\)/);
});

test('cursor event ordering rejects an older position',()=>{
  assert.match(src,/if\(eventTime<latestPointerTime\)return/);
  assert.match(src,/latestPointerTime=eventTime/);
});

test('raw events coalesce into one latest-state RAF',()=>{
  assert.match(src,/if\(!cursorRaf\)cursorRaf=requestAnimationFrame/);
  assert.match(src,/cursorRaf=0;update\(false\)/);
});

test('all four custom paint cursor renderers draw the white center point',()=>{
  assert.match(src,/function drawCenterDot\(c\)/);
  assert.match(src,/fillStyle='#fff'/);
  for(const name of ['drawPoint','drawCross','drawCircle','drawShape']){
    const start=src.indexOf('function '+name+'('),next=src.indexOf('\n  function ',start+10);
    assert.match(src.slice(start,next<0?src.length:next),/drawCenterDot\(c\)/,name);
  }
});

