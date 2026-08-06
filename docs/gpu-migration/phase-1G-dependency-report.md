# Phase 1G — Dependency Investigation Report (brush-renderer.js)

Investigation only. No files modified.

## 1. External dependency table

| Identifier | Owner | Category |
|-|-|-|
| `ctx` | core-state.js (`const ctx=activeC.getContext('2d')`, line 268) | Renderer Context candidate — target canvas |
| `_strokeCtx` | brush-engine.js (`let _strokeCtx`, written in `_ensureStrokeCanvas`/stroke lifecycle) | Renderer Context candidate — stroke-scratch canvas |
| `_inStroke` | brush-engine.js (`let _inStroke=false`, toggled throughout stroke start/commit/undo-restore code) | Renderer Context candidate — stroke lifecycle flag |
| `flipX` / `flipY` | core-state.js (`let flipX=false,flipY=false`, view mirroring) | Renderer Context candidate — view state (used once, line 569, for tip-rotation sign correction) |
| `tool` | core-state.js (`let tool='brush', ...`) | Renderer Context candidate — active tool name (used once, line 337, to gate the Soft-Round fast path) |
| `brushHardness` | core-state.js (`let brushHardness=1.0`) | Renderer Context candidate — brush setting, read in nearly every rasterization function |
| `window.brushTipCanvas` | brush-engine.js (`window.brushTipCanvas=null`, mutated on tip import/clear in brush-engine.js and read/written from brush-presets.js UI) | Brush Asset State |
| `window.brushTipVersion` | brush-engine.js | Brush Asset State |
| `window.brushTipSoftAlpha` | brush-engine.js | Brush Asset State |
| `window.brushTipMode` | brush-engine.js, brush-presets.js (UI writes it) | Brush Asset State |
| `window.brushTipRoundness` | brush-engine.js, brush-presets.js (UI/preset load writes it) | Brush Asset State |
| `window.brushTipMinimumRoundness` | brush-engine.js, brush-presets.js | Brush Asset State |
| `window.brushTipFlipX` / `window.brushTipFlipY` | brush-engine.js, brush-presets.js | Brush Asset State |
| `window._brushAirbrush` | brush-engine.js (airbrush toggle) | Brush Asset State / brush-setting flag |
| `window._activeBrushPresetId` | brush-engine.js / preset system | Brush Asset State |
| `_activeDabRotation` / `_activeDabRoundness` | brush-engine.js (`let`, written in `_drawDabNow` immediately before calling `BrushRenderer.drawDab`) | **Already-flagged side-channel** (Phase 1D/1F-A note in file header) — per-dab state that duplicates `d.rotation`/`d.roundness`; only remaining read is the fallback branch in `_buildTipStamp` (line 119) |
| `_currentAAMode`, `_roundBrushFalloff`, `_proceduralBrushFalloff`, `_effectiveInnerFrac`, `_quant`, `_quantAlpha`, `_Q_R`, `_Q_ALPHA`, `_AA_MODE_EDGE_MAX_PX`, `_AA_MODE_STOPS` | brush-engine.js | Shared Math / Intentional Globals — explicitly kept shared per Phase 1C |
| `_brushPerf` | brush-engine.js | Shared helper (diagnostics gate) — same category as diagnostics below |
| `window.FirstDabLatencyProbe` | external/diagnostics module | Diagnostics |
| `window.CustomFirstDabTrace` | external/diagnostics module | Diagnostics |
| `window.CustomTipCacheTrace` | external/diagnostics module | Diagnostics |
| `window.TipReadbackExperiment` | external/diagnostics/experiment module | Diagnostics |
| `window.BrushLatencyProfiler` (via `_brushPerf()`) | external/diagnostics module | Diagnostics |

## 2. Category breakdown

### Renderer Context candidates (7)
```
ctx
_strokeCtx
_inStroke
flipX
flipY
tool
brushHardness
```
All confirmed as ambient reads from core-state.js or brush-engine.js. None of these are declared locally in brush-renderer.js. Usage density varies a lot:
- `ctx` / `_strokeCtx` / `_inStroke` — read together everywhere via the repeated pattern `const dc=(_inStroke&&composite!=='erase')?_strokeCtx:ctx;` (9 call sites: `_dabAliased`, `_drawAutoHardRoundSegment`, `_drawSoftRoundMask`, `_dabAATinyCoverage`, `_drawUnifiedTipStamp`, `_dabAAGpu` x2, `_dabAACpu` x2). These three are really one bundle and should land in `rendererContext` together.
- `brushHardness` — read in nearly every rasterization function (`_buildSoftRoundMask`, `_dabAATinyCoverage`, `_dabTipTinyCoverage`, `_drawSoftRoundMask`, `_dabAAGpu`, `_dabAACpu`, `_dabAA`, `_buildTipStamp` call sites). Straightforward context field.
- `flipX`/`flipY` — only read once, at line 569, inside the tip-rotation helper (`_viewAdjustedTipRotation`), to detect whether the view is mirrored on exactly one axis (`reflected=(!!flipX)!=(!!flipY)`) and correct rotation sign accordingly. This is view state, not a brush/tool setting — belongs in `rendererContext` per the plan, low usage risk.
- `tool` — only read once, at line 337, inside `_isStandardProceduralSoftRound()`, purely to confirm the active tool is `'brush'` before taking the Soft-Round fast path. Low usage risk, but worth flagging: this is the only place brush-renderer.js needs to know the *tool*, as opposed to a brush *setting* — arguably this check belongs in brush-engine.js instead of the renderer, but moving it is out of scope for a context-only phase, so it should just move into `rendererContext.tool`.

### Brush Asset State (not context — should very likely stay global)
```
window.brushTipCanvas
window.brushTipVersion
window.brushTipSoftAlpha
window.brushTipMode
window.brushTipRoundness
window.brushTipMinimumRoundness
window.brushTipFlipX
window.brushTipFlipY
window._brushAirbrush
window._activeBrushPresetId
```
These are already `window.*`-qualified (unlike the context candidates, which are bare identifiers), already mutated from a second file (brush-presets.js UI/preset load code), and change on a totally different cadence than a single `drawDab` call (tip import, preset switch) rather than per-stroke or per-frame. Bundling them into `rendererContext` would mean reconstructing/re-passing the object on every dab even though nothing about them is per-dab or per-stroke — they should stay as-is (global asset state), not migrate into the context object. This matches how the file already treats them.

### Already-flagged side-channel (separate from this phase's context work)
```
_activeDabRotation
_activeDabRoundness
```
The file header already documents these as the "known remaining coupling," proposed for a *different* future phase (originally called "Phase 1E" in the 1C report) — threading rotation/roundness through the `d` descriptor instead of a side-channel global. `d.rotation`/`d.roundness` already exist and are already used as the primary source (`_buildTipStamp` line 119 only falls back to `_activeDabRotation`/`_activeDabRoundness` when `roundness==null`). This is a dab-descriptor concern, not a rendererContext concern — recommend keeping it out of Phase 1G-A's scope and tracking it separately, consistent with the existing header note.

### Shared Math / Intentional Globals — confirmed, unchanged
```
_currentAAMode
_roundBrushFalloff
_proceduralBrushFalloff
_effectiveInnerFrac
_quant / _quantAlpha / _Q_R / _Q_ALPHA
_AA_MODE_EDGE_MAX_PX / _AA_MODE_STOPS
_brushPerf
```
All confirmed declared/owned in brush-engine.js, exactly as the file header states. No action.

### Diagnostics — confirmed, unchanged
```
window.FirstDabLatencyProbe
window.CustomFirstDabTrace
window.CustomTipCacheTrace
window.TipReadbackExperiment
window.BrushLatencyProfiler (via _brushPerf())
```
No action.

## 3. Recommendation for Phase 1G-A

Proceed with the plan exactly as specified:

```js
const rendererContext = {
    ctx,
    strokeCtx: _strokeCtx,
    inStroke: _inStroke,
    flipX,
    flipY,
    tool,
    brushHardness
};
```

All 7 identifiers are confirmed hidden ambient dependencies with no local declaration in brush-renderer.js, and none of them are asset state, shared math, or diagnostics. `BrushRenderer.drawDab(d)` → `BrushRenderer.drawDab(d, rendererContext)` should thread this object down through the same call chain already used for `d.rotation`/`d.roundness` in Phase 1F-A1 (`drawDab` → `_dabAA`/`_dabAliased`/`_drawAutoHardRoundSegment` → `_dabAAGpu`/`_dabAACpu` → `_drawUnifiedTipStamp`/`_buildTipStamp`), replacing each bare read of `ctx`, `_strokeCtx`, `_inStroke`, `flipX`, `flipY`, `tool`, `brushHardness` inside brush-renderer.js with a read from the passed-in context object.

No other identifier in brush-renderer.js needs to move. Brush asset state stays global (it's multi-writer, cross-file state on a different cadence than per-dab), shared math stays in brush-engine.js, diagnostics stay untouched, and the `_activeDabRotation`/`_activeDabRoundness` side-channel is a separate, already-tracked concern that Phase 1G-A should not attempt to fix.

No code was modified as part of this investigation.
