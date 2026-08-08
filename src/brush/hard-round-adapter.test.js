// src/brush/hard-round-adapter.test.js
//
// Minimal, dependency-free deterministic tests for hard-round-adapter.js.
// Run with: node src/brush/hard-round-adapter.test.js
//
// Also exercises the adapter combined with PrototypeStrokeCore (Phase 8B) to
// cover the Phase 8C §10 checklist directly (size 28 at full pressure ->
// diameter 28, size 2 at full pressure -> diameter 2, etc).

'use strict';

const assert = require('assert');
const { isHardRoundEligible, resolveEffectiveRadius } = require('./hard-round-adapter');
const { PrototypeStrokeCore, pressureInfluence } = require('./prototype-stroke-core');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error('    ' + (err && err.stack ? err.stack.split('\n').join('\n    ') : err));
  }
}

function baseCtx(overrides) {
  return Object.assign({
    tool: 'brush',
    isPen: true,
    hasCustomTip: false,
    hardness: 1,
    sizeControl: 'pressure',
    roundness: 1,
    scatterEnabled: false,
    textureEnabled: false,
    airbrush: false,
  }, overrides || {});
}

console.log('hard-round-adapter deterministic tests');

// ---------------------------------------------------------------------
// Eligibility (§9)
// ---------------------------------------------------------------------
test('eligible: canonical Hard Round pen stroke', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx()), true);
});

test('not eligible: eraser tool', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ tool: 'eraser' })), false);
});

test('not eligible: mouse input (no natural pressure tail to fix)', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ isPen: false })), false);
});

test('not eligible: custom tip present', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ hasCustomTip: true })), false);
});

test('not eligible: softened hardness (Soft Round etc.)', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ hardness: 0.9 })), false);
});

test('not eligible: size control not pressure-driven', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ sizeControl: 'off' })), false);
});

test('not eligible: roundness squashed (calligraphic-style tip)', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ roundness: 0.5 })), false);
});

test('not eligible: scatter enabled', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ scatterEnabled: true })), false);
});

test('not eligible: texture enabled', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ textureEnabled: true })), false);
});

test('not eligible: airbrush mode', () => {
  assert.strictEqual(isHardRoundEligible(baseCtx({ airbrush: true })), false);
});

test('eligibility does not key off a preset name/id at all', () => {
  // No `presetId` field exists on ctx; passing one should have no effect,
  // proving the check is purely procedural (§9 requirement).
  const ctx = baseCtx({ presetId: 'totally-unrelated-name' });
  assert.strictEqual(isHardRoundEligible(ctx), true);
});

// ---------------------------------------------------------------------
// Radius adaptation (§2, §3)
// ---------------------------------------------------------------------
test('size 28 at full pressure -> diameter 28 (radius 14)', () => {
  const r = resolveEffectiveRadius({ baseSize: 28, minSizeFrac: 0.05, curveKey: 'linear', influence: 1 });
  assert.strictEqual(r, 14);
});

test('size 2 at full pressure -> diameter 2 (radius 1)', () => {
  const r = resolveEffectiveRadius({ baseSize: 2, minSizeFrac: 0.05, curveKey: 'linear', influence: 1 });
  assert.strictEqual(r, 1);
});

test('pressure 0.5 gives a smaller radius than full pressure', () => {
  const rFull = resolveEffectiveRadius({ baseSize: 28, minSizeFrac: 0.05, curveKey: 'linear', influence: pressureInfluence(1) });
  const rHalf = resolveEffectiveRadius({ baseSize: 28, minSizeFrac: 0.05, curveKey: 'linear', influence: pressureInfluence(0.5) });
  assert.ok(rHalf < rFull, `expected half-pressure radius (${rHalf}) < full-pressure radius (${rFull})`);
});

test('no artificial taper: radius is a pure function of pressure/influence, not stroke position', () => {
  // Same influence, called at two different (imaginary) points in a stroke,
  // must resolve to exactly the same radius -- nothing here depends on
  // elapsed distance/time.
  const a = resolveEffectiveRadius({ baseSize: 20, minSizeFrac: 0.05, curveKey: 'linear', influence: 0.6 });
  const b = resolveEffectiveRadius({ baseSize: 20, minSizeFrac: 0.05, curveKey: 'linear', influence: 0.6 });
  assert.strictEqual(a, b);
});

test('default (linear) curve uses prototype influence directly, ignoring a stale `pressure` field', () => {
  // Even if a caller passes a different `pressure`, the linear/default path
  // must resolve purely from `influence` (pressure^1.2) -- never blending
  // both sources, per "do not apply both" in the Phase 8C brief.
  const r1 = resolveEffectiveRadius({ baseSize: 20, minSizeFrac: 0, curveKey: 'linear', influence: 0.7, pressure: 0.1 });
  const r2 = resolveEffectiveRadius({ baseSize: 20, minSizeFrac: 0, curveKey: 'linear', influence: 0.7, pressure: 0.99 });
  assert.strictEqual(r1, r2);
});

test('non-linear curve routes through the main-app pressure curve, not raw influence', () => {
  const fakeCurve = (pressure, curveKey) => {
    assert.strictEqual(curveKey, 'hard');
    return pressure; // identity, just to prove it was actually called with `pressure`
  };
  const r = resolveEffectiveRadius({
    baseSize: 20, minSizeFrac: 0, curveKey: 'hard',
    influence: 0.99, pressure: 0.3, applyPressureCurve: fakeCurve,
  });
  // With minSizeFrac 0, r = maxR * effectiveInfluence = 10 * 0.3 = 3, NOT
  // 10 * 0.99 -- proving `influence` was ignored on this path.
  assert.strictEqual(r, 3);
});

test('identical resolved segment input produces identical adapter output (CPU/GPU share one source)', () => {
  const input = { baseSize: 16, minSizeFrac: 0.1, curveKey: 'linear', influence: 0.42 };
  const cpuSide = resolveEffectiveRadius(input);
  const gpuSide = resolveEffectiveRadius(input);
  assert.strictEqual(cpuSide, gpuSide);
});

// ---------------------------------------------------------------------
// End-to-end with PrototypeStrokeCore: full-pressure straight strokes at
// two sizes must resolve to exactly baseSize/2 radius throughout (§3, §10).
// ---------------------------------------------------------------------
function radiiForFullPressureStroke(baseSize) {
  const core = new PrototypeStrokeCore({ brushSize: baseSize, stabilization: 0, zoom: 1 });
  let t = 0;
  core.beginStroke({ x: 0, y: 0, pressure: 1, pointerType: 'pen', timeStamp: t });
  const radii = [];
  for (let i = 1; i < 20; i++) {
    t += 8;
    const segs = core.pushSamples([{ x: i * 3, y: 0, pressure: 1, pointerType: 'pen', timeStamp: t }]);
    for (const seg of segs) {
      radii.push(resolveEffectiveRadius({
        baseSize, minSizeFrac: 0.05, curveKey: 'linear', influence: seg.influence1,
      }));
    }
  }
  return radii;
}

test('full-pressure stroke at size 28: every resolved dab has radius 14 (diameter == selected size)', () => {
  const radii = radiiForFullPressureStroke(28);
  assert.ok(radii.length > 5);
  for (const r of radii) assert.strictEqual(r, 14);
});

test('full-pressure stroke at size 2: every resolved dab has radius 1 (diameter == selected size)', () => {
  const radii = radiiForFullPressureStroke(2);
  assert.ok(radii.length > 5);
  for (const r of radii) assert.strictEqual(r, 1);
});

test('decreasing-pressure stroke: resolved radii stay continuous (no jump) between consecutive segments', () => {
  const core = new PrototypeStrokeCore({ brushSize: 24, stabilization: 0.3, zoom: 1 });
  let t = 0;
  core.beginStroke({ x: 0, y: 0, pressure: 1, pointerType: 'pen', timeStamp: t });
  const radii = [];
  for (let i = 1; i < 40; i++) {
    t += 8;
    const pressure = Math.max(0, 1 - i / 40);
    const segs = core.pushSamples([{ x: i * 3, y: 0, pressure, pointerType: 'pen', timeStamp: t }]);
    for (const seg of segs) {
      radii.push(resolveEffectiveRadius({ baseSize: 24, minSizeFrac: 0.05, curveKey: 'linear', influence: seg.influence1 }));
    }
  }
  assert.ok(radii.length > 20);
  let maxJump = 0;
  for (let i = 1; i < radii.length; i++) maxJump = Math.max(maxJump, Math.abs(radii[i] - radii[i - 1]));
  // Consecutive resolved dabs are sub-3px-radius apart in pressure terms;
  // a broken/discontinuous taper would show as one huge jump instead.
  assert.ok(maxJump < 1.5, `expected small continuous radius steps, got a jump of ${maxJump}`);
  // And the overall trend must be downward (narrowing tail, §7).
  assert.ok(radii[radii.length - 1] < radii[5], 'expected radius to trend downward as pressure releases');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
