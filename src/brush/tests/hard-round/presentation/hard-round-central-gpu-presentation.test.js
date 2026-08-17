const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "prototype-renderer.js"),
  "utf8",
);
const engineSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "brush-engine.js"),
  "utf8",
);

test("the DOM WebGPU context is configured only by the central presenter", () => {
  assert.equal(
    (rendererSource.match(/^\s*this\.context\.configure\s*\(/gm) || []).length,
    1,
  );
  assert.match(
    rendererSource,
    /class HardRoundGpuPresenter[\s\S]*?this\.context\.configure\(/,
  );
  assert.match(
    rendererSource,
    /HardRoundGpuPresenter\.acquire\(this\.w, this\.h\)/,
  );
  assert.doesNotMatch(
    rendererSource,
    /class GpuBackend[\s\S]*?this\.outputContext\.configure\(/,
  );
});

test("pooled GPU backends obtain one shared presenter device and pipeline family", () => {
  assert.match(
    rendererSource,
    /const device = presenter\.device;\s*this\.device = device;/,
  );
  assert.match(
    rendererSource,
    /this\.presentPipeline = presenter\.pipelineFor\(this\.ss\)/,
  );
  assert.match(rendererSource, /this\._pipelines = new Map\(\)/);
});

test("presentation rejection is explicit and propagated to the live-preview gate", () => {
  assert.match(rendererSource, /presented: false, reason: 'not-overlay-owner'/);
  assert.match(
    rendererSource,
    /return \{ presented: true, reason: null, canvas: this\.outputCanvas \}/,
  );
  assert.match(engineSource, /result\.presentation\.presented!==true/);
  assert.match(engineSource, /presentLivePreview-rejected/);
});

test("beginStroke never reveals stale content and only preserves a prior frame behind a pending commit barrier", () => {
  assert.doesNotMatch(
    engineSource,
    /_hardRoundSetGpuOverlayVisible\([^\n]*'beginStroke-earlyReveal'/,
  );
  assert.match(
    engineSource,
    /_hardRoundSetGpuOverlayVisible\(false,'beginStroke-await-first-present'\)/,
  );
  assert.match(engineSource, /preservePriorUntilCommit/);
  assert.match(
    engineSource,
    /_hardRoundSetGpuOverlayVisible\(true,'presentLivePreview-accepted-frame'\)/,
  );
});

test("GPU finishing contexts cannot present or toggle the shared overlay", () => {
  assert.match(
    engineSource,
    /function _hardRoundPresentFinishedFrame[\s\S]*?if\(renderer\.isGpuActive&&renderer\.isGpuActive\(\)\)return Promise\.resolve\(\)/,
  );
  assert.doesNotMatch(engineSource, /finishedPreviewGpuOverlayVisible/);
});

test("visible artwork above the active layer forces layer-aware CPU preview", () => {
  assert.match(engineSource, /function _hardRoundHasVisibleLayerAbove\(/);
  assert.match(
    engineSource,
    /!_hardRoundHasVisibleLayerAbove\(curLayer,curFrame\)/,
  );
  assert.match(
    engineSource,
    /if\(typeof getHeldKey!=='function'\|\|getHeldKey\(index,frameIndex\)\)return true/,
  );
});

test("Smart Raster remains CPU-backed after cadence scheduling changes", () => {
  assert.match(
    engineSource,
    /!\(layers\[curLayer\]&&layers\[curLayer\]\.type==='smart-raster'\)/,
  );
  assert.doesNotMatch(engineSource, /_hardRoundPreviewNotBefore/);
});
