const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { StrokeTrajectoryCore } = require('../../stroke-trajectory-core.js');

test('queued preview entry cannot flush or replace an owned flight', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../brush-engine.js'), 'utf8');
  const start = source.slice(source.indexOf('function _hardRoundStartPreviewFlight('),
    source.indexOf('let _hardRoundLastHoldTickTime'));
  const token = {};
  const context = {
    _activeStrokeSession: 7, _inStroke: true,
    _hardRoundPreviewInFlight: true, _hardRoundPreviewInFlightToken: token,
    _hardRoundPreviewNeedsFollowup: false,
    _hardRoundFlushPending() { assert.fail('owned preview must not flush again'); },
  };
  vm.createContext(context);
  vm.runInContext(start, context);
  assert.equal(context._hardRoundStartPreviewFlight({}, 7), false);
  assert.equal(context._hardRoundPreviewInFlightToken, token);
  assert.equal(context._hardRoundPreviewNeedsFollowup, true);
});

test('One Euro input interleaved with hold never returns to the initial average buffer', () => {
  globalThis.HardRoundDebugOneEuroTrajectoryFilter = true;
  try {
    const core = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 0 });
    core.beginStroke({ x: 0, y: 0, pressure: 0.5, pointerType: 'pen', timeStamp: 0 });
    for (let i = 1; i <= 80; i++) {
      const target = { x: i * 20, y: i * 10, pressure: 0.5, pointerType: 'pen', timeStamp: i * 8 };
      const [point] = core.pushSamples([target]);
      const before = Math.hypot(target.x - point.x, target.y - point.y);
      for (const held of core.tickHold(8)) {
        assert.ok(held.x >= point.x && held.y >= point.y, 'hold must not jump backward');
        assert.ok(Math.hypot(target.x - held.x, target.y - held.y) <= before + 1e-9);
        assert.equal(held._debugSeq, point._debugSeq);
      }
      assert.equal(core.lastRaw.x, core.oneEuro.x);
      assert.equal(core.lastRaw.y, core.oneEuro.y);
    }
    const final = core.finishStroke().at(-1);
    assert.equal(final.x, 1600);
    assert.equal(final.y, 800);
  } finally { delete globalThis.HardRoundDebugOneEuroTrajectoryFilter; }
});

test('100% stabilization retains identical pull and hold with One Euro flag set', () => {
  function replay(enabled) {
    globalThis.HardRoundDebugOneEuroTrajectoryFilter = enabled;
    const core = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 1 });
    core.beginStroke({ x: 0, y: 0, pressure: 0.5, timeStamp: 0 });
    const points = [];
    for (let i = 1; i <= 20; i++) {
      points.push(...core.pushSamples([{ x: i * 10, y: i, pressure: 0.5, timeStamp: i * 8 }]));
      points.push(...core.tickHold(8));
    }
    return points.map(({ x, y, pressure }) => ({ x, y, pressure }));
  }
  try { assert.deepEqual(replay(true), replay(false)); }
  finally { delete globalThis.HardRoundDebugOneEuroTrajectoryFilter; }
});
