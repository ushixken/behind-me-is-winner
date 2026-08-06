# Phase 1C — BrushRenderer Extraction Investigation

Repo: `ushixken/behind-me-is-winner` @ `brush-development`
Scope: `src/brush/brush-engine.js` (5091 lines) → `src/brush/brush-renderer.js` (81 lines, Phase 1B)
No code was changed to produce this report.

**Terminology used below**, per your framing:
- **main** = `index.html` + everything except `/prototype`
- **prototype** = `/prototype/prototype.html`, reference-only, not touched by this work

**Important environment fact that shapes every recommendation:** this app has no bundler and no ES modules. Every file in `index.html`'s `<script>` list (`core-state.js` → ... → `brush-engine.js` → `brush-renderer.js` → ...) shares one global `window` scope. Top-level `function foo(){}` declarations become `window.foo` automatically. So there is **no hard circular-dependency risk** the way there would be with `import`/`require` — brush-renderer.js can already call brush-engine.js functions and vice versa, at runtime, regardless of file location. The real risk in this codebase isn't "will it throw a circular-import error," it's **architectural**: which file *conceptually* owns a given piece of state, and whether moving a function's *text* into brush-renderer.js while its *dependencies* stay behind in brush-engine.js quietly re-creates the coupling Phase 1C is trying to remove.

---

## 1. Dependency Graph

```
                         ┌────────────────────────────────────────┐
                         │   brush-engine.js (stays)               │
                         │   stabilization / spacing / pressure /  │
                         │   geometry / scatter / taper             │
                         └───────────────┬──────────────────────────┘
                                          │
                     produces dab descriptor d
                     {x,y,r,rgb,alpha,composite,rotation,roundness}
                                          │
                                          ▼
                         _drawDabNow(d)  [STAYS — orchestrator]
                         ├─ dirty-rect bookkeeping (_dabDirtyRadii, _growDirtyRect)
                         ├─ color-eraser capture/filter
                         ├─ perf/trace hooks
                         └─ BrushRenderer.drawDab(d)  ──────────────┐
                                                                     ▼
                         ┌───────────────────────────────────────────────────┐
                         │  brush-renderer.js (CpuBrushRenderer)               │
                         │  MOVE CANDIDATES — pure Canvas2D rasterization      │
                         │                                                      │
                         │  drawDab(d)                                         │
                         │  ├─ _drawAutoHardRoundSegment(d)                    │
                         │  ├─ _dabAA(x,y,r,rgb,alpha,composite)               │
                         │  │   ├─ _dabAliased ─── _getAliasedStamp (+cache)   │
                         │  │   ├─ _dabAATinyCoverage                         │
                         │  │   ├─ _dabTipTinyCoverage                        │
                         │  │   │    ├─ _getTipAlphaBuffer                    │
                         │  │   │    ├─ _tipAlphaFromPixels                   │
                         │  │   │    └─ _sampleTipAlphaBilinear               │
                         │  │   ├─ _drawSoftRoundMask ── _buildSoftRoundMask  │
                         │  │   └─ _dabAAGpu                                  │
                         │  │        ├─ _drawUnifiedTipStamp ── _buildTipStamp│
                         │  │        └─ _buildAAStamp ── _getTipPixelsForStamp│
                         │  └─ _dabAliased (AA-off path)                      │
                         │                                                      │
                         │  Texture-mask sub-tree (called from _drawDabNow /   │
                         │  _commitStrokeCanvas, not from drawDab directly):   │
                         │  _getScaledTextureCanvas, _getTexturePattern,       │
                         │  _maskRegionInPlace, _applyTextureToDabDirect,      │
                         │  _getTexturedStrokeCanvas, _resetTexturedStrokeCanvas│
                         └──────────────────┬──────────────────────────────────┘
                                             │ reads (does NOT own)
                                             ▼
                         ┌───────────────────────────────────────────────────┐
                         │  SHARED, READ-ONLY DEPENDENCIES                     │
                         │  (currently defined in brush-engine.js; renderer    │
                         │   functions call these but don't mutate them)      │
                         │                                                      │
                         │  _currentAAMode()          — reads `tool`, window.* │
                         │  _effectiveInnerFrac / _edgeWidthPx / _roundBrush-  │
                         │    Falloff / _proceduralBrushFalloff / _airbrush-   │
                         │    Falloff / _normalizeAAMode / _AA_MODE_* consts   │
                         │  _quant / _quantAlpha / _Q_R / _Q_ALPHA*            │
                         │  _viewAdjustedTipRotation() — reads _activeDab-     │
                         │    Rotation (SET by _drawDabNow before dispatch)    │
                         │  _strokeDabComposite(composite)                    │
                         │  window.brushHardness, window.brushTipCanvas,      │
                         │  window.brushTip*, window.brushTexture*, tool,     │
                         │  _inStroke, _strokeCtx, ctx  (globals from         │
                         │  core-state.js — NOT brush-engine-owned)           │
                         └───────────────────────────────────────────────────┘
```

Two dependency classes matter here:

1. **Config globals from `core-state.js`** (`ctx`, `activeC`, `brushHardness`, `tool`, `_inStroke`, `_strokeCtx`, `window.brushTip*`, `window.brushTexture*`). These are already loaded *before* brush-engine.js in `index.html`, and neither engine nor renderer "owns" them — both are consumers. Moving a function that only reads these does not create a new coupling; it's the same coupling that exists today.
2. **Brush-engine-owned helper functions** (`_currentAAMode`, the falloff/edge-width family, `_quant`/`_quantAlpha`, `_viewAdjustedTipRotation`, `_activeDabRotation`/`_activeDabRoundness`). These *are* engine-owned today, and every rasterization function leans on them. This is the real dependency edge to track.

---

## 2. Functions That Should Move First (Group A — safe, self-contained rasterizers)

These have no dependency on brush-engine *state*, only on the shared config globals in class (1) above, plus `dc`/`ctx`/`_strokeCtx` (the render target) which is exactly the kind of thing a renderer should own:

| Function | Why it belongs in the renderer | Dependencies | Circular risk |
|---|---|---|---|
| `_dabAliased` + `_getAliasedStamp` (+`_stampCache`) | Pure Canvas2D stamp build/blit, keyed only on r/rgb/alpha/composite/tipVersion | `window.brushTipCanvas`, `_quant`, `_buildTipStamp` | None — reads config globals + one engine helper (`_quant`) |
| `_dabAATinyCoverage` | Per-pixel supersampled rasterization into `dc` | `brushHardness`, `_currentAAMode`, `_effectiveInnerFrac`, `_roundBrushFalloff` | None functionally; textually depends on falloff family (see §5) |
| `_dabTipTinyCoverage` + `_getTipAlphaBuffer` + `_tipAlphaFromPixels` + `_sampleTipAlphaBilinear` | Same — supersampled rasterization of a tip mask | `window.brushTip*`, `_viewAdjustedTipRotation`, `_activeDabRotation` (engine state), falloff family | Low — this is the one place a moved function reads live engine-set state (`_activeDabRotation`) rather than just config |
| `_buildSoftRoundMask` + `_drawSoftRoundMask` (+ caches) | Builds/blits a cached procedural mask | `brushHardness`, `_currentAAMode`, `_effectiveInnerFrac`, `_roundBrushFalloff`, `_strokeDabComposite` | None functionally |
| `_buildTipStamp` | Rasterizes the custom-tip stamp cache | `window.brushTip*`, `_activeDabRoundness`, `_currentAAMode`, `_effectiveInnerFrac`, `_roundBrushFalloff`, `_viewAdjustedTipRotation` | Low — same engine-state read as above |
| `_getTipPixelsForStamp` | Pure canvas readback helper for `_buildAAStamp` | none beyond `window.brushTipCanvas` | None |
| `_buildAAStamp` (+`_aaDabCache`) | Supersampled procedural mask builder | `brushHardness`, `_currentAAMode`, `_proceduralBrushFalloff`, `_getTipPixelsForStamp` | None functionally |
| `_drawUnifiedTipStamp` | Transforms + blits the tip stamp | `_buildTipStamp`, `_strokeDabComposite`, `_viewAdjustedTipRotation` | Low, same as `_buildTipStamp` |
| `_dabAAGpu` | GPU-gradient rasterization path | `brushHardness`, `_currentAAMode`, `_effectiveInnerFrac`, `_roundBrushFalloff`, `_buildAAStamp`, `_drawUnifiedTipStamp` | None functionally |
| `_dabAACpu` | Hand-rolled pixel compositing path | same falloff family, `_buildTipStamp`, `_drawUnifiedTipStamp` | None functionally |
| `_dabAA` (top-level dispatcher, already referenced from `CpuBrushRenderer.drawDab`) | This *is* the renderer's own dispatch logic — currently the renderer calls out to it in brush-engine.js instead of owning it | all of the above | None |
| `_drawAutoHardRoundSegment` (+`_autoHardRoundPrevDab`) | Bresenham fast-path rasterizer, already the first thing `CpuBrushRenderer.drawDab` calls | `_inStroke`, `_strokeCtx`/`ctx`, `_usesAutoHardRoundRaster` (spacing-related, stays in engine) | None — it's already invoked directly from brush-renderer.js today, just not physically located there |
| `_strokeDabComposite` | One-line composite-mode mapper, used by nearly every rasterizer above | none | None |

**Recommendation:** move this entire group verbatim in Phase 1D. It's the largest chunk of `brush-engine.js` that is unambiguously "how a dab gets rasterized," matches the Phase 1B file header's own framing (`_drawAutoHardRoundSegment`, `_dabAA`, `_dabAliased` were explicitly named as the boundary), and none of it is called from anywhere except the dab-rasterization path.

---

## 3. Functions That Should Move Second (Group B — texture masking)

| Function | Why it belongs in the renderer | Dependencies | Circular risk |
|---|---|---|---|
| `_getScaledTextureCanvas` | Builds/caches the scaled texture + grayscale-alpha mask canvases | `window.brushTexture*` only | None |
| `_getTexturePattern` | Wraps the mask canvas in a `CanvasPattern` | `_getScaledTextureCanvas` | None |
| `_maskRegionInPlace` | Applies texture as a destination-in mask over a canvas region | `_getTexturePattern` | None |
| `_applyTextureToDabDirect` | Direct-to-`ctx` masking for the rare non-stroke-buffered path | `window.brushTexture*`, `_getScaledTextureCanvas`, `_maskRegionInPlace` | None |
| `_getTexturedStrokeCanvas` + `_resetTexturedStrokeCanvas` (+`_ensureTexHelper`) | Stroke-canvas-level masking pass | `window.brushTexture*`, `_maskRegionInPlace` | None |

**Why second, not first:** this group is functionally independent (only reads `window.brushTexture*` config), but it's called from two different places — `_drawDabNow` (per-dab, non-stroke path) and `_commitStrokeCanvas` (stroke-level, at commit). Moving it means those two engine call sites start reaching into brush-renderer.js, which is fine, but it's a second wave of call-site changes worth doing as its own reviewable step rather than bundling into the larger Group A move.

**Should stay temporarily:** `_ensureStrokeCanvas` and `_commitStrokeCanvas` themselves. They're the stroke lifecycle entry/exit hooks identified in Phase 1A, and per the Phase 1B header comment they're explicitly *not* supposed to move — they already call `BrushRenderer.beginStroke()`/`endStroke()` as no-op notifications. `_commitStrokeCanvas` also does Smart Raster ownership bookkeeping (`commitSmartRasterBrush`, `_consumeStrokeDirtyRect`) that is unambiguously engine/app-state logic, not rendering. Only the `_getTexturedStrokeCanvas` call and the `_drawBrushComposite` call inside it should end up pointing at brush-renderer.js; the function itself stays.

`_brushPaintCompositeOperation` and `_drawBrushComposite` (stroke-commit compositing) are borderline: they're pure Canvas2D compositing (renderer-shaped) but `_brushPaintCompositeOperation` reads `tool` and `_usesBrushPaintPipeline()` directly, which are engine/tool-state concerns. **Recommend: stay for now**, revisit once `_commitStrokeCanvas`'s call site is the only caller and the tool-gating logic can be resolved by the caller instead of the callee.

---

## 4. Functions That Should Remain in brush-engine.js

| Function/group | Why it stays |
|---|---|
| `_drawDabNow`, `_queueDab`, `_taperDistance` | Orchestration: decides *when* to rasterize, tracks dirty rects, drives color-eraser capture, perf/trace hooks. This is the boundary function itself — it dispatches into the renderer, it doesn't rasterize. |
| `_dabDirtyRadii`, `_growDirtyRect`, `_growTexDirtyRect`, `_frameDirty`/`_strokeDirty` state | Dirty-rect accounting for `recomposite()` — bookkeeping, not rasterization, and needed regardless of which renderer backend is active. |
| `_captureColorEraserDab`, `_endColorEraserStroke`, `_filterColorEraserRegion`, `_colorEraserOwnership` state | Tool-specific (color eraser) logic layered on top of rasterization, not rasterization itself. |
| `_ensureStrokeCanvas`, `_commitStrokeCanvas` | Stroke lifecycle owners per Phase 1A/1B — explicitly the "stroke entry/exit" boundary, already wired to call `BrushRenderer.beginStroke()/endStroke()`. |
| `_currentAAMode`, `_normalizeAAMode`, `_AA_MODE_*` consts | Reads `tool` (line/curve vs brush) — this is a brush/tool-state resolver, not rasterization itself, even though every rasterizer consumes its output. See §5 for the longer-term plan. |
| `_edgeWidthPx`, `_effectiveInnerFrac`, `_roundBrushFalloff`, `_airbrushFalloff`, `_proceduralBrushFalloff`, `_quant`, `_quantAlpha`, `_Q_R`/`_Q_ALPHA*` | Shared brush-shape math. Critically, `_proceduralBrushFalloff` is explicitly exposed as `window._proceduralBrushFalloff` and its own comment says it's "**shared by cached GPU stamps, CPU dabs, and the preset preview**" — i.e. it already has a consumer *outside* both brush-engine.js and brush-renderer.js (the preset-preview UI). Moving it into brush-renderer.js would make presentation-layer code depend on the renderer module, which is backwards. |
| `_viewAdjustedTipRotation`, `_activeDabRotation`, `_activeDabRoundness` | These are per-dab transient state *set by `_drawDabNow`* before calling into the renderer, then read by `_buildTipStamp`/`_dabTipTinyCoverage`/`_dabDirtyRadii`. This is real engine→renderer state coupling via a side channel instead of the `d` parameter — see §5 for the fix. |
| `_hexToRGB`, `_sampleVisibleCanvasColor`, `_normalizeTipAlpha` | General-purpose helpers unrelated to the rasterization boundary; not evaluated in depth here as they're outside this phase's scope. |

---

## 5. The One Real Coupling Worth Flagging

`BrushRenderer.drawDab(d)`'s contract already includes `d.rotation` and `d.roundness` in its documented dab descriptor. But several of the functions in Group A (`_buildTipStamp`, `_dabTipTinyCoverage`, `_dabDirtyRadii`) don't read rotation/roundness from `d` — they read the module-level `_activeDabRotation`/`_activeDabRoundness` globals, which `_drawDabNow` sets *before* calling `BrushRenderer.drawDab(d)` and clears *after*. That's an implicit side-channel, not a clean parameter pass.

This doesn't block the Phase 1D move (the globals will still be readable from brush-renderer.js — same window scope), but it's exactly the kind of dependency the prompt asks to flag: **once Group A has physically moved, `_activeDabRotation`/`_activeDabRoundness` should be threaded through as `d.rotation`/`d.roundness` directly** (already present on the descriptor per the Phase 1B contract comment) instead of being read as ambient engine state. That's a Phase 1E cleanup, not a Phase 1D blocker — doing it now would be a behavior-risk-bearing refactor of the dab descriptor's call sites, not a pure file move.

Similarly, `_currentAAMode()`'s dependency on `tool` (line/curve vs brush) and the whole falloff family's status as a "shared math module" (per `_proceduralBrushFalloff`'s own comment) suggests a **future Phase** (not 1D) where this becomes its own third file — e.g. `brush-falloff.js` — consumed by both brush-renderer.js and the preset-preview UI, rather than living inside brush-engine.js and being reached into by the renderer. Flagging this now; not proposing it for 1D since it touches a consumer outside the brush-engine/brush-renderer pair.

---

## 6. Safest Migration Order

1. **Group A** (stamp/mask/dab rasterizers + `_drawAutoHardRoundSegment` + `_strokeDabComposite`) — largest, most self-contained, already the documented Phase 1B boundary. Move as one commit, verbatim, updating only the `CpuBrushRenderer.drawDab` body (already does this) and removing the now-dead copies from brush-engine.js.
2. **Group B** (texture masking: `_getScaledTextureCanvas` → `_maskRegionInPlace` → `_applyTextureToDabDirect`/`_getTexturedStrokeCanvas`) — second commit, since it changes two call sites in brush-engine.js (`_drawDabNow` and `_commitStrokeCanvas`) rather than one.
3. **Leave everything in §4 in place.** No code motion needed for Phase 1D beyond updating call-site references (e.g. `_getTexturedStrokeCanvas(...)` in `_commitStrokeCanvas` becomes `BrushRenderer` — or a new `CpuBrushRenderer.applyTexture(...)`-style entry point, if you want the texture group behind the same interface rather than called by bare function name).

## 7. Risks

| Group | Risk | Mitigation |
|---|---|---|
| A | None functional — every function is called exactly once, from the existing `_dabAA`/`drawDab` chain. Risk is purely mechanical (typos in a large verbatim cut/paste across ~700 lines). | Diff the moved block byte-for-byte against the original; no logic edits, only relocation. |
| A | `_buildTipStamp`/`_dabTipTinyCoverage` reading `_activeDabRotation`/`_activeDabRoundness` as ambient state rather than via `d` | Leave the globals in brush-engine.js for Phase 1D (they're still reachable via shared scope); don't attempt the descriptor-threading cleanup in the same commit as the file move. |
| B | Two call sites (`_drawDabNow`, `_commitStrokeCanvas`) need their function references updated, not just the definitions moved | Keep as a separate commit from Group A so a regression is easy to bisect to "texture path" vs "core rasterization path." |
| — | Falloff/AA-mode family (`_roundBrushFalloff`, `_currentAAMode`, etc.) staying in brush-engine.js means brush-renderer.js's Group A functions will still call back into brush-engine.js by bare name | This is expected and safe in this global-script codebase — flag it in code comments (as Phase 1B already does) so a future contributor doesn't assume brush-renderer.js is dependency-free. |
| — | `window._proceduralBrushFalloff` has an external consumer (preset preview) outside both files | Do not move falloff functions in Phase 1D under any circumstance — doing so would require also touching the preset-preview call site, which is out of scope and raises real behavior risk for a config-preview UI element. |

## 8. Recommended Phase 1D Plan

1. Move **Group A** verbatim into `brush-renderer.js`, under `CpuBrushRenderer` (or as module-private helpers `CpuBrushRenderer` calls, matching how `_drawDabNow` already delegates). Delete the now-unused copies from `brush-engine.js`.
2. Leave `_drawAutoHardRoundSegment`'s state (`_autoHardRoundPrevDab`) colocated with the function itself in its new home — no reason to split state from behavior here.
3. Verify pixel-identical output: run a manual regression pass (procedural round, custom tip, textured brush, airbrush, eraser, each AA mode, each blend mode) comparing against the pre-move build, since this is the whole point of the phase.
4. Move **Group B** (texture masking) as a second, separately reviewable commit, updating the two call sites in `_drawDabNow`/`_commitStrokeCanvas`.
5. Do **not** touch: falloff/AA-mode math, `_activeDabRotation`/`_activeDabRoundness` threading, `_currentAAMode`'s `tool` dependency, or `_brushPaintCompositeOperation`/`_drawBrushComposite`. Log these as **Phase 1E candidates** (dab-descriptor cleanup + shared falloff module) rather than attempting them alongside the file split.
6. After 1D lands, `brush-engine.js` should contain zero canvas-rasterization code paths for dabs — every remaining canvas touch should be either dirty-rect/lifecycle bookkeeping or tool-specific logic (color eraser, taper). That's a good acceptance check for "did this phase actually finish its stated goal."
