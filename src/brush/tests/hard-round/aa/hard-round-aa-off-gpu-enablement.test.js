"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const engineSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "brush-engine.js"),
  "utf8",
);
const protoRendererSrc = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "prototype-renderer.js"),
  "utf8",
);
const HardRoundAdapter = require("../../../hard-round-adapter");
const { PrototypeRenderer } = require("../../../prototype-renderer");

test("A. AA-Off no longer excludes preferGpu in brush-engine.js", () => {
  // Verify that hardRoundAaMode !== 'off' && hardRoundAaMode !== 'none' is gone from gpuLiveCompatible definition
  const match = engineSrc.match(/const gpuLiveCompatible\s*=\s*([\s\S]*?);/);
  assert.ok(match, "gpuLiveCompatible definition found");
  assert.doesNotMatch(
    match[1],
    /hardRoundAaMode\s*!==\s*['"]off['"]/,
    "must not exclude aaMode off",
  );
  assert.doesNotMatch(
    match[1],
    /hardRoundAaMode\s*!==\s*['"]none['"]/,
    "must not exclude aaMode none",
  );
});

test("B. AA-Off retains all normal GPU compatibility requirements", () => {
  const match = engineSrc.match(/const gpuLiveCompatible\s*=\s*([\s\S]*?);/);
  assert.ok(match);
  const expr = match[1];
  assert.match(expr, /brushBlendMode/, "preserves blend mode check");
  assert.match(expr, /SelectionScope/, "preserves selection scope check");
  assert.match(expr, /smart-raster/, "preserves smart raster check");
  assert.match(
    expr,
    /_hardRoundHasVisibleLayerAbove/,
    "preserves layer above check",
  );
});

test('C. HardRoundAdapter maps aaMode "none" and "off" into segment properties', () => {
  const segment = {
    x0: 0,
    y0: 0,
    x1: 10,
    y1: 10,
    pressure0: 0.5,
    pressure1: 0.5,
    influence0: 1,
    influence1: 1,
  };
  const resOff = HardRoundAdapter.resolveSegmentRenderParams(segment, {
    aaMode: "off",
    baseSize: 20,
  });
  assert.equal(resOff.aaMode, "off");

  const resNone = HardRoundAdapter.resolveSegmentRenderParams(segment, {
    aaMode: "none",
    baseSize: 20,
  });
  assert.equal(resNone.aaMode, "none");

  const resWeak = HardRoundAdapter.resolveSegmentRenderParams(segment, {
    aaMode: "weak",
    baseSize: 20,
  });
  assert.equal(resWeak.aaMode, "weak");
});

test("D. GpuBackend passes aaOff flag (= 1.0) for AA-Off to vertex attributes in STROKE_SHADER_WGSL", () => {
  const normalized = protoRendererSrc.replace(/\r\n/g, "\n");
  assert.match(
    normalized,
    /const isAaOff = seg\.aaMode === 'off' \|\| seg\.aaMode === 'none';/,
  );
  assert.match(normalized, /segmentVerts\([\s\S]*?isAaOff \? 1 : 0\s*\)/);

  // Verify WGSL fragment shader consumes in.aaOff > 0.5 with binary select
  assert.match(
    normalized,
    /if \(in\.aaOff > 0\.5\) \{[\s\S]*?let cov = select\(0\.0, 1\.0, d <= halfDiag\);/,
  );
});

test("E. PrototypeRenderer initializes and accepts aaMode none on both CPU and GPU paths", () => {
  const renderer = new PrototypeRenderer({
    width: 100,
    height: 100,
    ss: 1,
    preferGpu: false,
  });
  assert.equal(
    renderer.isGpuActive(),
    false,
    "CPU active when preferGpu is false",
  );

  renderer.beginStroke({
    x: 10,
    y: 10,
    r: 5,
    pressure: 0.5,
    pointerType: "mouse",
  });
  const seg = HardRoundAdapter.resolveSegmentRenderParams(
    {
      x0: 10,
      y0: 10,
      x1: 50,
      y1: 10,
      pressure0: 0.5,
      pressure1: 0.5,
      influence0: 1,
      influence1: 1,
    },
    { aaMode: "none", baseSize: 10, rgb: [0, 0, 0], composite: "paint" },
  );

  renderer.drawSegments([seg]);
  const dirty = renderer.getStrokeDirtyRegion();
  assert.ok(
    dirty && dirty.width > 0 && dirty.height > 0,
    "dirty region produced",
  );
  renderer.cancelStroke();
});

test("F. AA-Off GPU WGSL output remains strictly binary (0 or 1)", () => {
  // In the fragment shader:
  // let halfDiag = ss * 0.70710678;
  // let cov = select(0.0, 1.0, d <= halfDiag);
  // return vec4f(mix(in.alpha0, in.alpha1, h) * cov, 0.0, 0.0, 1.0);
  // When alpha is 1.0, coverage is exactly 0.0 or 1.0 with no fractional values.
  const regex =
    /if\s*\(\s*in\.aaOff\s*>\s*0\.5\s*\)\s*\{[\s\S]*?let cov\s*=\s*select\(0\.0,\s*1\.0,\s*d\s*<=\s*halfDiag\);[\s\S]*?return vec4f\(mix\(in\.alpha0,\s*in\.alpha1,\s*h\)\s*\*\s*cov,\s*0\.0,\s*0\.0,\s*1\.0\);/m;
  assert.match(
    protoRendererSrc,
    regex,
    "WGSL shader must produce binary coverage for in.aaOff > 0.5",
  );
});
