// Phase 11A.8 -- committed Hard Round geometry must equal the last live mask.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { PrototypeStrokeCore } = require("../../../prototype-stroke-core");
const { PrototypeRenderer } = require("../../../prototype-renderer");
const Adapter = require("../../../hard-round-adapter");
let passed = 0,
  failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(
        () => {
          passed++;
          console.log(`  ok - ${name}`);
        },
        (e) => {
          failed++;
          console.error(`  FAIL - ${name}\n    ${e.stack || e}`);
        },
      ),
  );
}
function ctx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return {
    data,
    createImageData: (iw, ih) => ({
      data: new Uint8ClampedArray(iw * ih * 4),
      width: iw,
      height: ih,
    }),
    putImageData(img, dx, dy) {
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const s = (y * img.width + x) * 4,
            d = ((dy + y) * w + dx + x) * 4;
          data.set(img.data.subarray(s, s + 4), d);
        }
    },
    clearRect() {
      data.fill(0);
    },
  };
}
function geometry(stabilization) {
  const core = new PrototypeStrokeCore({
    brushSize: 70,
    stabilization,
    zoom: 1,
  });
  const raw = Array.from({ length: 31 }, (_, i) => ({
    x: 40 + i * 8,
    y: 150 + Math.sin(i / 4) * 45,
    pressure: 0.7,
    pointerType: "pen",
    timeStamp: i * 8,
  }));
  const live = [core.beginStroke(raw[0], {})];
  for (let i = 1; i < raw.length; i++) live.push(...core.pushSamples([raw[i]]));
  return { live, finish: core.finishStroke(raw.at(-1)).segments };
}
function adapt(s) {
  return Adapter.resolveSegmentRenderParams(s, {
    baseSize: 70,
    minSizeFrac: 0,
    curveKey: "linear",
    matchPrototypePressure: true,
    rgb: [0, 0, 0],
    aaMode: "medium",
    getEffectiveAlpha: () => 1,
  });
}
async function render(segments) {
  const r = new PrototypeRenderer({ width: 340, height: 300 }),
    c = ctx(340, 300);
  r._outCanvas = {};
  r._outCtx = c;
  r.beginStroke();
  r.drawSegments(segments.map(adapt));
  await r.endStroke();
  return c.data;
}
function metrics(data) {
  let minX = 340,
    minY = 300,
    maxX = -1,
    maxY = -1,
    pixels = 0,
    maxAlpha = 0;
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 340; x++) {
      const a = data[(y * 340 + x) * 4 + 3];
      if (a) {
        pixels++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        maxAlpha = Math.max(maxAlpha, a);
      }
    }
  return { bounds: [minX, minY, maxX, maxY], pixels, maxAlpha };
}

test("normal stabilization finish replay changes an otherwise final live mask", async () => {
  const g = geometry(0.65),
    live = await render(g.live),
    replayed = await render([...g.live, ...g.finish]);
  assert.ok(g.finish.length > 0);
  assert.notDeepStrictEqual(replayed, live);
  assert.ok(metrics(replayed).pixels > metrics(live).pixels);
});
test("stabilization zero still emits finish replay and changes coverage", async () => {
  const g = geometry(0),
    live = await render(g.live),
    replayed = await render([...g.live, ...g.finish]);
  assert.ok(
    g.finish.length > 0,
    "finish must still emit catch-up segments at stabilization 0",
  );
  assert.notDeepStrictEqual(replayed, live);
});
test("finish-disabled diagnostic preserves the exact live pixels and opacity", async () => {
  const g = geometry(0.65),
    live = await render(g.live),
    committed = await render(g.live);
  assert.deepStrictEqual(committed, live);
  assert.strictEqual(metrics(committed).maxAlpha, 255);
});
test("Hard Round pointer-up closes core and submits finish segments for render", () => {
  // The old finalization path discarded finishStroke().segments entirely
  // (hence the historical "submits zero post-release segments" name); this
  // was an intentional fix -- pointer-up now stamps finish segments into
  // the renderer so the canonical closure geometry is actually drawn.
  // Detaching the renderer into a local `renderer` var (so a rapid next
  // pointerdown can't reset it out from under this finishing stroke) also
  // means the flush call no longer references the global `_hardRoundRenderer`
  // directly at this call site -- so anchor on the flush of the *local*
  // variable instead.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "brush-engine.js"),
    "utf8",
  );
  const start = src.indexOf("const finish=_hardRoundCore.finishStroke");
  const flush = src.indexOf("_hardRoundFlushPending(renderer)", start);
  const body = src.slice(start, flush);
  assert.ok(start >= 0 && flush > start);
  assert.ok(
    /_hardRoundStampSegments\(finish\.segments/.test(body),
    "finish segments must be stamped into the renderer before flush",
  );
});
test("renderer starts once, accumulates batches once, and resolves once", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "brush-engine.js"),
    "utf8",
  );
  // beginStroke() now takes an AA-supersampling argument ({ss:...}); the
  // "exactly once" invariant is unchanged, so match the call regardless of
  // its arguments instead of pinning the old empty-parens call.
  assert.strictEqual(
    (src.match(/hardRoundRenderer\.beginStroke\([^)]*\)/g) || []).length,
    1,
  );
  assert.ok(
    /_hardRoundPendingRenderSegments\.push\(\.\.\.renderSegs\)/.test(src),
  );
  assert.ok(/renderer\.endStroke\(\{readback:gpuCommit\}\)/.test(src));
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
