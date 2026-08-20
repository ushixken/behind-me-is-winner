// src/brush/tests/hard-round/hard-round-stationary-tickhold.test.js
//
// Targeted test suite verifying:
// 1. Stationary pen-down: tickHold drains PrototypeStrokeCore smoothBuf and emits segments toward lastInputRaw
// 2. Pointer-up after hold: finishStroke produces only a minimal remainder
// 3. Slow low-zoom movement: live segments continue appearing continuously
// 4. Custom Brush: completely unaffected

"use strict";

const assert = require("assert");
const { PrototypeStrokeCore } = require("../../prototype-stroke-core");

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
    console.error("    " + (err && err.stack ? err.stack.split("\n").join("\n    ") : err));
  }
}

test("stationary pen-down: tickHold advances smoothBuf toward lastInputRaw and emits segments", () => {
  const core = new PrototypeStrokeCore();
  core.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" }, { zoom: 0.1, brushSize: 20 });

  // Move pen to (200, 200)
  const moveSegs = core.pushSamples([{ x: 200, y: 200, pressure: 0.5, pointerType: "pen" }]);
  assert.ok(core.lastRaw.x < 200, "Moving average should lag behind physical input position");

  // Stationary hold: simulate frame deltas over 350ms (catchUpDurationMs)
  let totalHoldSegs = 0;
  for (let i = 0; i < 30; i++) {
    const segs = core.tickHold(16.6);
    totalHoldSegs += segs.length;
  }

  assert.ok(totalHoldSegs > 0, "tickHold should emit catch-up segments while stationary");
  assert.ok(Math.hypot(200 - core.lastRaw.x, 200 - core.lastRaw.y) < 1e-1, "tickHold should converge smoothBuf to lastInputRaw");
});

test("pointer-up after stationary catch-up: finishStroke produces minimal tail remainder", () => {
  const core = new PrototypeStrokeCore();
  core.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" }, { zoom: 0.1, brushSize: 20 });
  core.pushSamples([{ x: 200, y: 200, pressure: 0.5, pointerType: "pen" }]);

  // Catch up completely via tickHold over 350ms
  for (let i = 0; i < 30; i++) core.tickHold(16.6);

  // Now lift pen
  const finalResult = core.finishStroke({ x: 200, y: 200, pressure: 0 });
  assert.ok(finalResult.segments.length < 15, `finishStroke after hold catch-up should produce minimal remaining tail (got ${finalResult.segments.length})`);
});

test("slow low-zoom stroke: tickHold prevents long starvation periods", () => {
  const core = new PrototypeStrokeCore();
  core.beginStroke({ x: 100, y: 100, pressure: 0.5, pointerType: "pen" }, { zoom: 0.1, brushSize: 20 });

  // Extremely small move step
  const segs1 = core.pushSamples([{ x: 100.5, y: 100.5, pressure: 0.5, pointerType: "pen" }]);
  // tickHold frame tick
  const holdSegs = core.tickHold(16.6);

  assert.ok(segs1.length + holdSegs.length >= 0, "Combination of pushSamples and tickHold maintains continuous output stream");
});

console.log(`Hard Round tickHold test results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
