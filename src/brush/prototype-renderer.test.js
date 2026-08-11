// src/brush/prototype-renderer.test.js
//
// Deterministic tests for prototype-renderer.js's CPU path (the GPU path
// needs a real WebGPU device and isn't exercised headlessly, same
// convention as hard-round-capsule-gpu.js). A tiny getImageData/putImageData
// shim stands in for a canvas 2D context so this runs under plain Node.
//
// Run with: node src/brush/prototype-renderer.test.js

'use strict';

const assert = require('assert');
const { PrototypeRenderer } = require('./prototype-renderer');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const run = Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok - ${name}`); })
    .catch((err) => {
      failed++;
      console.error(`  FAIL - ${name}`);
      console.error('    ' + (err && err.stack ? err.stack.split('\n').join('\n    ') : err));
    });
  pending.push(run);
}

// Minimal 2D-context stand-in backed by a plain RGBA buffer.
function makeFakeCtx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    createImageData(cw, ch) { return { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }; },
    putImageData(img, dx = 0, dy = 0) { for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const src=(y*img.width+x)*4,dst=((dy+y)*w+dx+x)*4;data[dst]=img.data[src];data[dst+1]=img.data[src+1];data[dst+2]=img.data[src+2];data[dst+3]=img.data[src+3];} },
    clearRect() { data.fill(0); },
    _pixel(x, y) { const p = (y * w + x) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; },
    _data: data,
  };
}

function makeRenderer(w, h) {
  const r = new PrototypeRenderer({ width: w, height: h });
  const ctx = makeFakeCtx(w, h);
  r._outCtx = ctx; // bypass DOM canvas creation for headless testing
  return { r, ctx };
}

test('a single centered dab resolves to opaque color at the center pixel', async () => {
  const { r, ctx } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([{
    x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5,
    alpha0: 1, alpha1: 1, rgb: [200, 50, 50], composite: 'paint',
  }]);
  const result = await r.endStroke();
  assert.strictEqual(result.composite, 'paint');
  assert.strictEqual(result.segmentCount, 1);
  const [pr, pg, pb, pa] = ctx._pixel(10, 10);
  assert.ok(pa > 240, `center alpha should be near-opaque, got ${pa}`);
  assert.strictEqual(pr, 200); assert.strictEqual(pg, 50); assert.strictEqual(pb, 50);
});

test('far corner outside any segment stays fully transparent', async () => {
  const { r, ctx } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([{
    x0: 10, y0: 10, x1: 10, y1: 10, r0: 3, r1: 3,
    alpha0: 1, alpha1: 1, rgb: [0, 0, 0], composite: 'paint',
  }]);
  await r.endStroke();
  const [, , , pa] = ctx._pixel(0, 0);
  assert.strictEqual(pa, 0);
});

test('overlapping dabs in one stroke max-blend rather than darken additively', async () => {
  const { r, ctx } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([
    { x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5, alpha0: 0.5, alpha1: 0.5, rgb: [100, 100, 100], composite: 'paint' },
    { x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5, alpha0: 0.5, alpha1: 0.5, rgb: [100, 100, 100], composite: 'paint' },
  ]);
  const result = await r.endStroke();
  assert.strictEqual(result.segmentCount, 2);
  const [, , , pa] = ctx._pixel(10, 10);
  // Single-segment alpha 0.5 -> ~127; if this were additive it would clip to 255.
  assert.ok(pa < 200, `overlapping same-alpha dabs must not stack past one dab's own coverage, got ${pa}`);
});

test('cancelStroke discards accumulation without resolving', async () => {
  const { r } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([{ x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5, alpha0: 1, alpha1: 1, rgb: [1, 2, 3], composite: 'paint' }]);
  r.cancelStroke();
  assert.strictEqual(r._active, false);
  assert.ok(r.cpu.coverage.every((v) => v === 0), 'backing store must be cleared on cancel');
});

test('erase composite paints coverage into alpha with rgb forced to 0', async () => {
  const { r, ctx } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([{
    x0: 10, y0: 10, x1: 10, y1: 10, r0: 5, r1: 5,
    alpha0: 1, alpha1: 1, rgb: [255, 255, 255], composite: 'erase',
  }]);
  const result = await r.endStroke();
  assert.strictEqual(result.composite, 'erase');
  const [pr, pg, pb, pa] = ctx._pixel(10, 10);
  assert.strictEqual(pr, 0); assert.strictEqual(pg, 0); assert.strictEqual(pb, 0);
  assert.ok(pa > 240);
});

test('beginStroke after an unfinished stroke implicitly cancels the prior one', () => {
  const { r } = makeRenderer(20, 20);
  r.beginStroke();
  r.drawSegments([{ x0: 5, y0: 5, x1: 5, y1: 5, r0: 3, r1: 3, alpha0: 1, alpha1: 1, rgb: [9, 9, 9], composite: 'paint' }]);
  r.beginStroke(); // no endStroke() in between
  assert.strictEqual(r._segmentCount, 0);
  assert.ok(r.cpu.coverage.every((v) => v === 0));
});

test('CPU endStroke resolves only post-preview dirty pixels with full-resolve-identical output', async () => {
  const { r, ctx } = makeRenderer(64, 64);
  r.beginStroke();
  r.drawSegments([{x0:12,y0:12,x1:24,y1:12,r0:3,r1:3,alpha0:1,alpha1:1,rgb:[25,50,75],composite:'paint'}]);
  await r.peekStroke();
  r.drawSegments([{x0:24,y0:12,x1:30,y1:18,r0:3,r1:3,alpha0:1,alpha1:1,rgb:[25,50,75],composite:'paint'}]);
  const result=await r.endStroke({readback:false});
  assert.ok(result.dirtyRegion&&result.dirtyRegion.width<64&&result.dirtyRegion.height<64,'final resolve should be dirty-region scoped');
  const optimized=ctx._data.slice();
  r.cpu.resolveInto(ctx,r._rgb,r._composite);
  for(let p=0;p<optimized.length;p+=4){
    assert.strictEqual(optimized[p+3],ctx._data[p+3],'dirty final resolve must preserve exact alpha coverage');
    if(optimized[p+3])assert.deepStrictEqual(Array.from(optimized.slice(p,p+3)),Array.from(ctx._data.slice(p,p+3)),'covered-pixel RGB must match full resolve');
  }
});

test('short stroke on 1920x1080 retains a substantially smaller stroke-lifetime dirty region', async()=>{
  const r=new PrototypeRenderer({width:1920,height:1080,ss:1});r._outCtx=makeFakeCtx(1920,1080);r.beginStroke();
  r.drawSegments([{x0:100,y0:100,x1:140,y1:120,r0:6,r1:6,alpha0:1,alpha1:1,rgb:[1,2,3],composite:'paint'}]);
  const dirty=r.getStrokeDirtyRegion();assert.ok(dirty);assert.ok(dirty.width*dirty.height<1920*1080/100,'short stroke must not degrade to full-canvas commit bounds');
  await r.endStroke();
});

test('stroke dirty bounds contain every nonzero mask pixel and survive preview consumption', async()=>{
  const {r,ctx}=makeRenderer(96,72);r.beginStroke();
  r.drawSegments([{x0:20,y0:20,x1:45,y1:30,r0:7,r1:4,alpha0:1,alpha1:.6,rgb:[8,9,10],composite:'paint'}]);await r.peekStroke();
  r.drawSegments([{x0:45,y0:30,x1:70,y1:50,r0:4,r1:8,alpha0:.6,alpha1:1,rgb:[8,9,10],composite:'paint'}]);
  const dirty=r.getStrokeDirtyRegion();await r.endStroke();
  for(let y=0;y<72;y++)for(let x=0;x<96;x++)if(ctx._pixel(x,y)[3])assert.ok(x>=dirty.x&&x<dirty.x+dirty.width&&y>=dirty.y&&y<dirty.y+dirty.height,`painted pixel ${x},${y} escaped dirty bounds`);
});

test('stroke dirty bounds clamp at canvas edges',()=>{
  const {r}=makeRenderer(80,60);r.beginStroke();r.drawSegments([{x0:-5,y0:-3,x1:8,y1:7,r0:12,r1:12,alpha0:1,alpha1:1,rgb:[1,1,1],composite:'paint'}]);
  const dirty=r.getStrokeDirtyRegion();assert.ok(dirty);assert.strictEqual(dirty.x,0);assert.strictEqual(dirty.y,0);assert.ok(dirty.x+dirty.width<=80&&dirty.y+dirty.height<=60);
});

test('large and multiple segments union their exact changed regions',()=>{
  const {r}=makeRenderer(160,120);r.beginStroke();r.drawSegments([{x0:10,y0:12,x1:25,y1:18,r0:3,r1:3,alpha0:1,alpha1:1,rgb:[2,2,2],composite:'paint'}]);
  const first=r.getStrokeDirtyRegion();r.drawSegments([{x0:110,y0:80,x1:150,y1:105,r0:18,r1:22,alpha0:1,alpha1:1,rgb:[2,2,2],composite:'paint'}]);
  const union=r.getStrokeDirtyRegion();assert.ok(union.x<=first.x&&union.y<=first.y);assert.ok(union.x+union.width>140&&union.y+union.height>100);assert.ok(union.width>first.width&&union.height>first.height);
});

test('CPU-owned mask data matches resolved canvas pixels in the captured dirty region',async()=>{
  const {r,ctx}=makeRenderer(90,70);r.beginStroke();r.drawSegments([{x0:14,y0:18,x1:62,y1:48,r0:7,r1:4,alpha0:.85,alpha1:.45,rgb:[31,63,95],composite:'paint'}]);
  const dirty=r.getStrokeDirtyRegion(),result=await r.endStroke({readback:false,includeCpuMaskData:true,dirtyRect:dirty});
  assert.ok(result.maskData instanceof Uint8ClampedArray);assert.strictEqual(result.maskData.length,dirty.width*dirty.height*4);
  for(let y=0;y<dirty.height;y++)for(let x=0;x<dirty.width;x++){const p=(y*dirty.width+x)*4,actual=ctx._pixel(dirty.x+x,dirty.y+y);assert.deepStrictEqual(Array.from(result.maskData.slice(p,p+4)),actual);}
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
