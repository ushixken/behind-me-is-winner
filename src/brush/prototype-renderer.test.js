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
    putImageData(img) { data.set(img.data); },
    clearRect() { data.fill(0); },
    _pixel(x, y) { const p = (y * w + x) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; },
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

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
