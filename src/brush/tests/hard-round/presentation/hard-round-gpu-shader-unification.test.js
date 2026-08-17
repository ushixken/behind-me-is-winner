// Phase 11A.2 -- proves RESOLVE_SHADER_WGSL (commit/readback pass) and
// PRESENT_SHADER_WGSL (live preview pass) compute coverage through one
// shared WGSL function instead of two independently hand-copied box-filter
// loops. This is a static source check (no WebGPU device is available in
// this test environment), but it directly targets the actual regression:
// commit 6a9a25d touched the live shader's math without a mechanism
// forcing the commit shader to stay in lock-step, which is what let the
// two diverge. If this test passes, that class of drift is now structurally
// impossible -- both shaders literally call the same `resolveCoverage()`
// function body, defined once, string-interpolated into both modules.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
let passed = 0,
  failed = 0;
const pending = [];
function test(n, f) {
  pending.push(
    Promise.resolve()
      .then(f)
      .then(
        () => {
          passed++;
          console.log(`  ok - ${n}`);
        },
        (e) => {
          failed++;
          console.error(`  FAIL - ${n}\n    ${e.stack || e}`);
        },
      ),
  );
}

const src = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "prototype-renderer.js"),
  "utf8",
);

test("a single shared coverage function exists", () => {
  assert.ok(/function COVERAGE_CORE_WGSL\(ss\)/.test(src));
  assert.ok(
    /fn resolveCoverage\(tex: texture_2d<f32>, outPos: vec2i\) -> f32/.test(
      src,
    ),
  );
});

test("the SS x SS box-filter loop appears exactly once in the source (inside the shared function), not once per shader", () => {
  const loopPattern =
    /for \(var y = 0; y < \$\{ss\}; y = y \+ 1\) \{\s*for \(var x = 0; x < \$\{ss\}; x = x \+ 1\) \{/g;
  const matches = src.match(loopPattern) || [];
  assert.strictEqual(
    matches.length,
    1,
    `expected exactly one box-filter loop definition, found ${matches.length}`,
  );
});

test("RESOLVE_SHADER_WGSL (commit path) calls the shared function and applies no opacity -- unchanged, downstream Canvas2D globalAlpha still owns opacity", () => {
  const fnMatch = src.match(
    /function RESOLVE_SHADER_WGSL\(ss\)[\s\S]*?\n  \};?\r?\n/,
  );
  assert.ok(fnMatch, "RESOLVE_SHADER_WGSL not found");
  const body = fnMatch[0];
  assert.ok(
    /\$\{COVERAGE_CORE_WGSL\(ss\)\}/.test(body),
    "RESOLVE_SHADER_WGSL must interpolate the shared coverage core",
  );
  assert.ok(
    /let cov = resolveCoverage\(tex, vec2i\(in\.pos\.xy\)\);/.test(body),
  );
  assert.ok(
    !/color\.opacity/.test(body),
    "commit/resolve pass must not apply opacity in-shader (unchanged behavior)",
  );
  assert.ok(/return vec4f\(cov, cov, cov, cov\);/.test(body));
});

test("PRESENT_SHADER_WGSL (live path) calls the same shared function and still applies presentationOpacity + premultiplication -- unchanged behavior, only the coverage math is now shared", () => {
  const fnMatch = src.match(
    /function PRESENT_SHADER_WGSL\(ss\)[\s\S]*?\n  \};?\r?\n/,
  );
  assert.ok(fnMatch, "PRESENT_SHADER_WGSL not found");
  const body = fnMatch[0];
  assert.ok(
    /\$\{COVERAGE_CORE_WGSL\(ss\)\}/.test(body),
    "PRESENT_SHADER_WGSL must interpolate the shared coverage core",
  );
  assert.ok(
    /let cov = resolveCoverage\(mask, vec2i\(in\.pos\.xy\)\) \* color\.opacity;/.test(
      body,
    ),
  );
  assert.ok(/return vec4f\(color\.rgb \* cov, cov\);/.test(body));
});

test("no per-frame GPU readback was introduced -- live preview still resolves via gpu.present(), commit still the only readback call site", () => {
  assert.ok(
    /else return this\.gpu\.present\(this\._rgb, this\._composite, this\.presentationOpacity, meta\)/.test(
      src,
    ),
  );
  assert.ok(
    /if \(readback\) \{[\s\S]*?await this\.gpu\.resolveInto\(this\._outCtx, this\._rgb, this\._composite\)/.test(
      src,
    ),
  );
  // The production direct-present branch returns gpu.present(). The separate
  // opt-in CanvasLivePresentation diagnostic is intentionally allowed to
  // request a readback and is not the normal live path.
  assert.ok(
    /const _canvasLivePresentationOn[\s\S]*?if \(_canvasLivePresentationOn && _isLivePreviewMeta\)[\s\S]*?_resolveToOutput\(true/.test(
      src,
    ),
  );
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
});
