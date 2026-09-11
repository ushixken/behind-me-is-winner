const test = require('node:test');
const assert = require('node:assert/strict');
const { StrokeTrajectoryCore } = require('../../stroke-trajectory-core');
const { PrototypeStrokeCore } = require('../../prototype-stroke-core');

function sample(i, pressure) {
  return { x: i * 3, y: i, pressure, pointerType: 'pen', timeStamp: i * 8 };
}
const pressures = [...Array(30).fill(0.8), 0.6, 0.4, 0.2, 0.08, 0.02];

test('Hard Round pressure release reaches geometry without a second zoom-dependent delay', () => {
  for (const zoom of [0.1, 0.35, 1, 16]) {
    const core = new PrototypeStrokeCore({ zoom, stabilization: 0,
      positionAlreadyStabilized: true, pressureAlreadyStabilized: true });
    core.beginStroke(sample(0, pressures[0]));
    let last;
    for (let i = 1; i < pressures.length; i++) {
      last = core.pushSamples([sample(i, pressures[i])]).at(-1);
      assert.ok(last);
      assert.ok(Math.abs(last.pressure1 - pressures[i]) < 1e-12);
    }
    assert.ok(last.pressure1 < 0.03, 'release must not retain the old high pressure');
    const finish = core.finishStroke(sample(pressures.length - 1, 0));
    for (const segment of finish.segments) {
      assert.ok(segment.pressure1 <= 0.020000000001);
      assert.ok(Math.hypot(segment.x1 - segment.x0, segment.y1 - segment.y0) < 4);
    }
  }
});

test('pressure pass-through is opt-in and does not bypass explicit stabilization', () => {
  function run(settings) {
    const core = new StrokeTrajectoryCore(settings);
    core.beginStroke(sample(0, pressures[0]));
    return pressures.slice(1).map((p, i) => core.pushSamples([sample(i + 1, p)])[0].pressure);
  }
  const normal = run({ zoom: 0.1, stabilization: 0 });
  assert.ok(normal.at(-1) > 0.5, 'reproduce the previous release pressure delay');
  const responsive = run({ zoom: 0.1, stabilization: 0, pressureAlreadyStabilized: true });
  assert.deepEqual(responsive, pressures.slice(1));
  assert.deepEqual(run({ zoom: 0.1, stabilization: 1 }),
    run({ zoom: 0.1, stabilization: 1, pressureAlreadyStabilized: true }));
});

test('constant contact pressure is preserved rather than forcing an artificial taper', () => {
  const core = new PrototypeStrokeCore({ zoom: 0.1, stabilization: 0,
    positionAlreadyStabilized: true, pressureAlreadyStabilized: true });
  core.beginStroke(sample(0, 0.8));
  for (let i = 1; i <= 20; i++) core.pushSamples([sample(i, 0.8)]);
  const finish = core.finishStroke(sample(20, 0));
  for (const segment of finish.segments) assert.ok(Math.abs(segment.pressure1 - 0.8) < 1e-12);
});
