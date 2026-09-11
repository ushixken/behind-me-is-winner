const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { StrokeTrajectoryCore } = require('../../stroke-trajectory-core');
const { PrototypeStrokeCore } = require('../../prototype-stroke-core');

test('production Hard Round factory identifies already-stabilized positions', () => {
  const engine = fs.readFileSync(path.join(__dirname, '../../brush-engine.js'), 'utf8');
  const start = engine.indexOf('function _hardRoundGetCore()');
  const end = engine.indexOf('// Phase 9C:', start);
  const context = { window: { PrototypeStrokeCore }, _hardRoundCore: null };
  vm.createContext(context);
  vm.runInContext(engine.slice(start, end), context);
  const core = context._hardRoundGetCore();
  core.beginStroke({ x: 0, y: 0, pressure: 0.5, timeStamp: 0 }, { zoom: 0.1 });
  assert.equal(core.trajectoryCore.diagnosticState().positionMovingAverageWindow, 1);
  assert.equal(core.trajectoryCore.diagnosticState().pressureMovingAverageWindow, 1);
  assert.equal(context._hardRoundGetCore(), core);
});

test('already-stabilized slow and fast input has no second position lag at any zoom', () => {
  for (const zoom of [0.1, 0.35, 1, 16]) {
    for (const speed of [0.1, 2]) {
      const core = new StrokeTrajectoryCore({ zoom, stabilization: 0, positionAlreadyStabilized: true });
      const legacy = new StrokeTrajectoryCore({ zoom, stabilization: 0 });
      const first = { x: 0, y: 0, pressure: 0.2, pointerType: 'pen', timeStamp: 0 };
      core.beginStroke(first);
      legacy.beginStroke(first);
      for (let i = 1; i <= 80; i++) {
        const input = { x: i * 8 * speed / zoom, y: Math.sin(i / 10) / zoom,
          pressure: 0.2 + (i % 20) / 30, pointerType: 'pen', timeStamp: i * 8 };
        const [out] = core.pushSamples([input]);
        const [old] = legacy.pushSamples([input]);
        assert.ok(Math.hypot(out.x - input.x, out.y - input.y) * zoom < 1e-9);
        assert.equal(out.pressure, old.pressure, 'pressure averaging must remain identical');
      }
      const point = { ...core.lastRaw };
      for (const out of core.tickHold(16.7)) {
        assert.ok(Math.hypot(out.x - point.x, out.y - point.y) < 1e-9);
      }
      for (const out of core.finishStroke()) {
        assert.ok(Math.hypot(out.x - point.x, out.y - point.y) < 1e-9);
      }
    }
  }
});

test('explicit stabilization retains its pull and other shared-core consumers keep their default', () => {
  const ordinary = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 0 });
  assert.ok(ordinary.diagnosticState().positionMovingAverageWindow > 1);
  function replay(positionAlreadyStabilized) {
    const core = new StrokeTrajectoryCore({ zoom: 0.1, stabilization: 1, positionAlreadyStabilized });
    core.beginStroke({ x: 0, y: 0, pressure: 0.5, timeStamp: 0 });
    const outputs = [];
    for (let i = 1; i <= 50; i++) {
      outputs.push(...core.pushSamples([{ x: i * 10, y: i, pressure: 0.5, timeStamp: i * 8 }]));
      outputs.push(...core.tickHold(8));
    }
    return outputs.map(({ x, y, pressure }) => ({ x, y, pressure }));
  }
  assert.deepEqual(replay(true), replay(false));
});
