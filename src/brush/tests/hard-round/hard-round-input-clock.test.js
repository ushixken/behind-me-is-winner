const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const engine = fs.readFileSync(path.join(__dirname, '../../brush-engine.js'), 'utf8');
const source = engine.slice(engine.indexOf('const _OLD_STABILIZER_TAU_MAX'),
  engine.indexOf('let _activeStrokePipeline = null;'));
function harness(zoom = 0.1, hardRound = true) {
  const ctx = { performance: { now: () => 1000 }, window: {}, zoom,
    _hardRoundStrokeActive: hardRound, _stabilizerTargetX: 0, _stabilizerTargetY: 0 };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  ctx._oldStabilizerReset(0, 0, 1000);
  return {
    ctx,
    push(x, y, wall, sample, amount = 0.01) {
      ctx._stabilizerTargetX = x;
      ctx._stabilizerTargetY = y;
      const p = ctx._applyOldStabilizerFloor(x, y, amount, wall, sample);
      return [p.x, p.y];
    },
  };
}

test('Hard Round low-strength filtering is independent of coalesced event delivery batches', () => {
  for (const zoom of [0.1, 0.35, 1, 16]) {
    const direct = harness(zoom);
    const batched = harness(zoom);
    for (let i = 1; i <= 160; i++) {
      const t = 1000 + i * 4;
      const x = i * 0.5 / zoom;
      const y = (i * 0.25 + (i % 2 ? 0.3 : -0.3)) / zoom;
      assert.deepEqual(batched.push(x, y, 1000 + Math.ceil(i / 4) * 16, t),
        direct.push(x, y, t, t));
    }
  }
});

test('low-strength filter still suppresses alternating perpendicular jitter', () => {
  const h = harness();
  const errors = [];
  for (let i = 1; i <= 160; i++) {
    // A horizontal stroke with +/- 0.3 CSS-pixel input noise.
    const [, y] = h.push(i * 5, i % 2 ? 3 : -3, 1000 + i * 4, 1000 + i * 4);
    if (i > 40) errors.push(Math.abs(y) * 0.1);
  }
  assert.ok(errors.reduce((a, b) => a + b, 0) / errors.length < 0.1);
});

test('idle catch-up converges and input clock resets between strokes', () => {
  const h = harness();
  h.push(100, 50, 1016, 1016);
  let lastError = Infinity;
  for (let wall = 1032; wall <= 2000; wall += 16) {
    const [x, y] = h.push(100, 50, wall, undefined);
    const error = Math.hypot(100 - x, 50 - y);
    assert.ok(error <= lastError);
    lastError = error;
  }
  assert.ok(lastError < 0.001);
  h.ctx._oldStabilizerReset(0, 0, 1000);
  assert.deepEqual(h.push(10, 5, 1016, 1016), harness().push(10, 5, 1016, 1016));
});

test('duplicate/backward timestamps stay finite and do not overshoot', () => {
  const h = harness();
  for (const t of [1004, 1004, 1002, 1008, NaN, 1012]) {
    const [x, y] = h.push(100, 50, 1020, t);
    assert.ok(Number.isFinite(x) && x >= 0 && x <= 100);
    assert.ok(Number.isFinite(y) && y >= 0 && y <= 50);
  }
});

test('100% bypass and other brushes keep existing clock behavior', () => {
  const h = harness();
  assert.deepEqual(h.push(100, 50, 1020, 1004, 1), [100, 50]);
  const a = harness(0.1, false), b = harness(0.1, false);
  for (let i = 1; i <= 20; i++) {
    const wall = 1000 + Math.ceil(i / 4) * 16;
    assert.deepEqual(a.push(i * 5, i, wall, 1000 + i * 4), b.push(i * 5, i, wall, undefined));
  }
});

test('zoomed-out zero-strength denoising reduces perpendicular input jitter', () => {
  for (const zoom of [0.1, 0.35]) {
    const h = harness(zoom);
    const errors = [];
    for (let i = 1; i <= 160; i++) {
      const inputY = i % 2 ? 0.3 : -0.3;
      const out = h.ctx._hardRoundDenoiseLowZoom(i * 0.5 / zoom, inputY / zoom, 0);
      if (i > 40) errors.push(Math.abs(out.y) * zoom);
    }
    assert.ok(errors.reduce((a, b) => a + b, 0) / errors.length < 0.24,
      'at least 20% reduction in alternating cross-motion noise');
  }
});

test('extra spatial lag is bounded at all speeds, curves and reversals', () => {
  for (const zoom of [0.05, 0.1, 0.35, 0.99]) {
    for (const step of [0.01, 0.5, 5, 50]) {
      const h = harness(zoom);
      let previous = { x: 0, y: 0 };
      for (let i = 1; i <= 100; i++) {
        const target = { x: Math.sin(i / 12) * step * 12 / zoom,
          y: (i <= 50 ? i : 100 - i) * step / zoom };
        const out = h.ctx._hardRoundDenoiseLowZoom(target.x, target.y, 0);
        const distance = Math.hypot(out.x - target.x, out.y - target.y) * zoom;
        assert.ok(distance <= 0.5 * (1 - zoom) + 1e-9);
        for (const axis of ['x', 'y']) {
          assert.ok(out[axis] >= Math.min(previous[axis], target[axis]) - 1e-9);
          assert.ok(out[axis] <= Math.max(previous[axis], target[axis]) + 1e-9);
        }
        previous = out;
      }
    }
  }
});

test('spatial denoising bypasses positive stabilization, normal zoom and other brushes', () => {
  for (const amount of [0.01, 0.05, 0.5, 1]) {
    const p = harness().ctx._hardRoundDenoiseLowZoom(40, 30, amount);
    assert.equal(p.x, 40);
    assert.equal(p.y, 30);
  }
  for (const zoom of [1, 2, 16]) {
    const p = harness(zoom).ctx._hardRoundDenoiseLowZoom(40, 30, 0);
    assert.equal(p.x, 40);
    assert.equal(p.y, 30);
  }
  const p = harness(0.1, false).ctx._hardRoundDenoiseLowZoom(40, 30, 0);
  assert.equal(p.x, 40);
  assert.equal(p.y, 30);
});

test('zero-strength spatial denoising converges at rest and resets at stroke start', () => {
  const h = harness();
  for (let i = 0; i < 200; i++) h.ctx._hardRoundDenoiseLowZoom(100, 50, 0);
  const p = h.ctx._hardRoundDenoiseLowZoom(100, 50, 0);
  assert.ok(Math.hypot(p.x - 100, p.y - 50) * 0.1 < 0.003);
  h.ctx._oldStabilizerReset(-100, -50, 2000);
  const first = h.ctx._hardRoundDenoiseLowZoom(-100, -50, 0);
  assert.equal(first.x, -100);
  assert.equal(first.y, -50);
});
