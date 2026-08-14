# Persistence & Regression-Safety Audit

Comprehensive READ-ONLY audit of all persistence architecture, storage backends, save/load lifecycle, asset identity, concurrency hazards, and failure modes.

---

## 1. Project Save Format

### Serialization Entry Point
[`exportProject()`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L29-L51) in [`project-io.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js)

- Iterates all `layers[]`, encoding each frame canvas as PNG blob
- Packages into a `.awproj` ZIP archive via JSZip (DEFLATE level 6)
- Triggers browser download via dynamic `<a download>` anchor + `URL.createObjectURL`

### Deserialization Entry Points
- [`stageProject(file)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L60-L70): Unpacks ZIP, validates manifest, decodes PNGs
- [`commit(staged)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L73-L79): Replaces in-memory project state transactionally
- [`importProject(file)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L80): Orchestrates `stageProject` → `commit`

### Format & Version
- Magic: `FORMAT = 'AnimateWebsiteProject'`
- Current: `VERSION = 2`
- Extension: `.awproj`
- Manifest: `project.json` inside the ZIP root

### Migration Logic
- Supports versions 1 through 2
- Gracefully handles missing modern extensions (`extendedFrames`, `smartRaster`, `cmFrames`, `frameLabelOffset`, `audioWaveformHeight`)
- **No destructive migration**: version 1 files are loaded with defaults for missing fields

### Validation Logic
- [`validate(manifest)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L53-L58): Checks format string, version bounds (1–2), document dimensions (1–16384), frame counts (1–100000), FPS (1–120), layer array integrity, duplicate frame detection, asset path presence
- PNG dimension verification against project canvas size
- CRC32 verification on ZIP (`JSZip.loadAsync(file, {checkCRC32: true})`)
- Base64 CM buffer length verification (`width * height * 4`)

> **Classification: SAFE** — Versioned format with CRC32 integrity, dimensional validation, and transactional rollback.

---

## 2. Persistent User Data

### Data that survives reload via `localStorage`

| Category | Storage Key | File |
|:---|:---|:---|
| **Brush presets, groups, tool state** | `animatorBrushPresetsV2` | [`brush-presets.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-presets.js) |
| **Palette collection & styles** | `animatorPaletteV1` | [`palette.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/palette.js) |
| **Palette view preferences** | `animatorPaletteViewV1` | [`palette.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/palette.js) |
| **Color history** | `animatorAdvancedPaletteColorHistoryV1` | [`palette.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/palette.js) |
| **Keyboard shortcuts** | `keybinds_v1` | [`keybinds.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/keybinds.js) |
| **Panel layout** | `animator_panel_layout_v4` | [`panels.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/panels.js) |
| **Onion skin settings** | `animator_onion_skin_settings_v1` | [`tools-color.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/tools-color.js) |
| **Tool group subtools** | `animate.toolGroups.v1` | [`tool-groups.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/tool-groups.js) |
| **Tool drawer states** | `animate.toolGroupDrawers.v1` | [`tool-groups.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/tool-groups.js) |
| **Cursor style** | `animator_cursor_style` | [`cursor-prefs.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/cursor-prefs.js) |
| **Brush blend mode** | `brushBlendMode` | [`brush-presets.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-presets.js) |
| **Eraser mode** | `eraserMode` | [`brush-presets.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-presets.js) |
| **Line AA settings** | `animate.lineAA.v1` | [`brush-engine.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-engine.js) |
| **Fill tool settings** | `animate.fillTool.v1` | [`fill-mask-engine.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/fill/fill-mask-engine.js) |
| **Magic wand settings** | `animate.magicWand.v1` | [`magic-wand-selection.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/selection/magic-wand-selection.js) |
| **Selection scope** | `animate.selectionScope.v1` | [`linked-pixel-selection.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/selection/linked-pixel-selection.js) |
| **Transform AA** | `transform_antialiasing` + `_enabled` + `_quality` | [`transform-tool.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/transform/transform-tool.js) |
| **Keyframe exposure** | `animator_kfexp_amount`, `animator_kfexp_bypass` | [`keyframe-exposure.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/timeline/keyframe-exposure.js) |
| **Keyframe switcher** | `animator_kfsw_step`, `animator_kfsw_bypass`, `animator_kfsw_flipthrough` | [`keyframe-switcher.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/timeline/keyframe-switcher.js) |
| **Audio clips** | `behindMe.audioTimeline.clips` | [`audio-clips-advanced.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/timeline/audio-clips-advanced.js) |
| **Audio tracks** | `behindMe.audioTimeline.tracks` | [`audio-timeline.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/timeline/audio-timeline.js) |
| **Audio UI state** | `behindMe.audioTimeline.collapsed`, `height`, `waveformHeight` | [`audio-timeline.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/timeline/audio-timeline.js) |
| **Tool settings mode** | `toolSettingsMode` | [`brush-presets.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-presets.js) |
| **Simple tab visibility** | `tsSimpleFieldVisibility`, `tsSimpleSectionVisibility`, `tsSimpleSectionOrder` | [`brush-presets.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-presets.js) |

### Data that does NOT survive reload
- **Drawings / layers / frames** — in-memory only (`layers[]`, `activeC`)
- **Undo/redo history** — in-memory only (`undoStack[]`, `redoStack[]`)
- **Selections** — in-memory only
- **Recent projects** — not tracked at all
- **Autosaves** — do not exist

> **Classification: DATA LOSS RISK** — All artwork is ephemeral. A browser crash, accidental tab close, or reload destroys all unsaved work with zero recovery path.

---

## 3. Storage Backends

| Backend | Used? | Purpose |
|:---|:---:|:---|
| **localStorage** | ✅ | All persisted settings, presets, palette, keybinds, UI layout (~40 keys) |
| **IndexedDB** | ❌ | Not used anywhere |
| **File System Access API** | ❌ | Not used (`showSaveFilePicker`, `showOpenFilePicker` absent) |
| **Downloadable project files** | ✅ | `.awproj` ZIP via `<a download>` + `URL.createObjectURL` |
| **Blobs / Object URLs** | ✅ | Frame PNG encoding, project ZIP, export formats, image import |
| **sessionStorage** | ✅ | Tool Settings panel tab memory (`tsPsPanel`) — session only |

> **Classification: SHOULD IMPROVE** — localStorage is the sole persistent store. No IndexedDB means artwork cannot be persisted without explicit user action. localStorage has a ~5–10 MB quota which constrains preset/palette data size.

---

## 4. Autosave

> [!CAUTION]
> **There is no autosave mechanism for project artwork.**

- The strings `'autosave'`, `'auto-save'`, `'autoSave'` appear **zero times** in the codebase.
- No `setInterval` or `setTimeout` is wired to any project-level save operation.
- Settings (brush presets, palette, keybinds) are debounce-persisted to localStorage on UI input events (100–120ms delays), but these are **preferences only**, not artwork.
- The only way to save a project is the explicit **File → Save Project…** menu item.

> **Classification: DATA LOSS RISK** — A single browser crash, tab close, or `beforeunload` can destroy hours of work. There is no periodic checkpoint, no IndexedDB artwork cache, no `beforeunload` dirty-document warning.

---

## 5. Migration Safety

### Project Format Migration
- Version 1 → 2 migration is **additive only** (missing fields default gracefully)
- Old data is **never mutated in place** — `stageProject()` creates fresh layer objects from the manifest
- The original file is never modified (download-based save model)
- Import uses full transactional rollback on error ([`commit()`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L73-L79) snapshots entire prior state and restores on throw)
- **Migration cannot be rolled back** in the sense of re-exporting version 1, but since the file is read-only, the original `.awproj` remains intact on disk

### Settings Migration
- **Keybinds**: Legacy default conflicts auto-migrated, user customizations preserved
- **Palette**: v1→v2 schema migration (single→multi-palette, legacy swatch size keys)
- **Brush presets**: Historical contamination detection (`hardness=55` from old HTML sliders), auto-repair
- **All migrations**: Wrapped in try/catch with fallback to defaults

> **Classification: SAFE** — Additive migration, transactional rollback, original files untouched.

---

## 6. Custom Brush Asset Identity

### Custom Tip Identification
- **Built-in presets**: Static string IDs (`'hard-round'`, `'soft-round'`, `'soft-airbrush'`)
- **Pack presets**: `'pack:' + slug` (e.g. `'pack:rough-pencil'`), tip loaded from `assets/brush-presets/<slug>/tip.png`
- **Custom user presets**: Generated ID `'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,5)` — **stable across reload** because it's generated once at creation time and persisted in `animatorBrushPresetsV2`
- **Tip artwork**: Stored as **PNG data URL** in `settings['ts-tip-dataurl']` — embedded in the preset, not a separate file reference

### Texture Identification
- Custom presets: base64 PNG in `settings['ts-texture-dataurl']`
- Pack presets: relative URL in `settings['ts-texture-url']`
- **No `textureId` field exists** (0 occurrences) — textures are identified by canvas reference identity at runtime

### Runtime Cache Keys
- Engine tip asset ID: `` `tip_asset_${++counter}_${w}x${h}` `` — transient, regenerated each session
- WebGPU resource cache key: `` `${assetId}_v${version}_${w}x${h}` `` — transient
- Preview hash: composite of `[presetId, tab, color, kind, dimensions, settings].join('|')`

### Stability Analysis
- Preset IDs are **stable across reload** (persisted in localStorage)
- Tip/texture artwork is **embedded as data URLs** in the preset — no external file dependency for custom presets
- Pack preset assets reference files in `assets/` — stable as long as the deployment is intact
- **Unused assets cannot be accidentally deleted** — they're embedded in the preset object itself

> **Classification: SAFE** — Stable IDs, embedded artwork, no dangling references.

---

## 7. Undo / History

### Persistence
- Undo/redo stacks are **strictly in-memory and ephemeral**
- Not serialized to localStorage, IndexedDB, or `.awproj` files
- Stack depth capped at 40 entries
- Stacks are explicitly cleared on project load (`undoStack=[]; redoStack=[];`)
- Stacks are cleared on timeline clear

### Async Commit Interaction

> [!WARNING]
> **Undo snapshots are captured before async GPU commit completes.**

The undo snapshot is captured inside [`pushUndoAt(layerIndex, frameIndex)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/tools-color.js#L180-L196) which is called from [`_commitFinishedHardRoundStroke()`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/brush/brush-engine.js#L6403). This captures the canvas state **before** the commit writes new pixels — which is correct for undo (it saves the pre-stroke state). The commit then writes the stroke pixels. This ordering is sound.

However, if `exportProject()` fires between `pushUndoAt()` and the pixel write, the exported canvas would be missing the stroke. See §8.

> **Classification: SAFE** for undo correctness; **DATA LOSS RISK** for save-during-commit (§8).

---

## 8. Save Concurrency

> [!CAUTION]
> **Critical race condition: Save Project can export incomplete artwork.**

### The Race

```
pointerup on Hard Round GPU stroke
  → _hardRoundFinalizeOwnedContext() begins async GPU readback
  → _hardRoundPendingCommitCount++ (synchronous)
  → _hardRoundCommitTail = previous.then(() => readback).then(() => commit pixels)
  → user immediately clicks File → Save Project…

exportProject():
  → finishActiveDrawingBeforeArtworkChange(curLayer, curFrame)
      → _endStroke() — ends live pointer tracking synchronously
      → _stabilizerAccelerateToCompletion() — catches stabilizer
      → ❌ does NOT await _hardRoundCommitTail
      → ❌ does NOT check _hardRoundPendingCommitCount === 0
  → iterates layers[li].frames[fi] — reads canvas pixels NOW
  → the async readback promise has NOT resolved yet
  → the stroke pixels have NOT been written to layer.frames[fi]
  → exported .awproj is missing the last stroke
```

### Impact
- The last 1–N GPU Hard Round / Smart Raster strokes may be silently missing from the saved file
- The user sees the strokes on screen (GPU overlay / committed canvas), so they believe the save is complete
- No error is shown — the save "succeeds" with stale pixel data

### Same race exists for project import
[`commit(staged)`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L73-L79) calls `finishActiveDrawingBeforeArtworkChange` then immediately replaces `layers`. If an unawaited GPU finalizer resolves afterward, it writes to the old layer reference — harmless for the new project but the old stroke is lost if the user expected it saved.

> **Classification: DATA LOSS RISK** — The fix is straightforward: `exportProject()` should `await _hardRoundCommitTail` (or expose a `window.awaitPendingBrushCommits()` promise) before iterating frame canvases.

---

## 9. Failure Cases

| Scenario | Current Handling | Classification |
|:---|:---|:---:|
| **Browser closes during save** | Download may be incomplete. No temp file or atomic write. User's previous `.awproj` on disk is untouched (browser download is a new file). | **SAFE** |
| **localStorage quota exceeded** | All `setItem` calls are wrapped in `try/catch` with silent fallback. In-memory state continues working. | **SAFE** |
| **Malformed project file** | [`validate()`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L53-L58) catches structural errors. [`commit()`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/core/project-io.js#L73-L79) rolls back on any exception. CRC32 catches ZIP corruption. | **SAFE** |
| **Partial/missing brush asset** | Pack presets load from `assets/` with async fetch + error handling. Custom tip/texture data URLs are self-contained in the preset. | **SAFE** |
| **Unsupported newer version** | `manifest.version > VERSION` → explicit error: "This project was created by a newer unsupported version" | **SAFE** |
| **Canvas backing-store loss (tab background)** | `visibilitychange` handler reloads `activeC` from saved keyframe on tab resume | **SAFE** |
| **Browser crash mid-drawing** | All artwork lost — no autosave, no IndexedDB checkpoint, no `beforeunload` guard | **DATA LOSS RISK** |
| **Accidental tab close** | All artwork lost — no `beforeunload` "unsaved changes" confirmation | **DATA LOSS RISK** |
| **Unwrapped `localStorage.setItem` calls** | 6 call sites lack `try/catch` (audio clips/tracks/waveform, blend mode init, tool group defaults) — could throw `QuotaExceededError` | **SHOULD IMPROVE** |

---

## 10. Recovery

| Mechanism | Present? | Notes |
|:---|:---:|:---|
| **Crash recovery** | ❌ | No mechanism exists |
| **Previous autosave generations** | ❌ | Autosave does not exist |
| **Backup files** | ❌ | No `.bak` or versioned save system |
| **Corruption recovery** | ✅ | Project import has full transactional rollback; brush preset loader falls back to defaults on parse error; palette loader falls back to defaults |
| **`beforeunload` dirty warning** | ❌ | No unsaved-changes prompt on tab close/navigate |
| **localStorage export** | ✅ | [`local-storage-panel.js`](file:///c:/Users/Ushirou/Pictures/AnimateWebsite/behind-me-is-winner/src/ui/local-storage-panel.js) provides ZIP export of all localStorage keys for manual backup |

> **Classification: DATA LOSS RISK** — Zero crash/close recovery for artwork. Settings recovery is adequate.

---

## 11. Regression Test Candidates (Golden Project Fixtures)

The minimum set of `.awproj` fixture files that should be preserved and round-trip tested:

| Fixture | Tests | Priority |
|:---|:---|:---:|
| **Single-layer raster** | Basic save/load fidelity, PNG pixel integrity, canvas dimensions | 🔴 Critical |
| **Multi-layer raster** | Layer ordering, visibility, opacity, clipping, group hierarchy | 🔴 Critical |
| **Animation (multi-frame)** | Frame dictionary sparseness, frameMeta labels/colors/hidden, FPS, range | 🔴 Critical |
| **Smart Raster layer** | Style ID map encoding/decoding, underlay preservation, V4 shadow data, render mode | 🟡 High |
| **Custom tip preset** | Data URL tip artwork round-trip, reference diameter, pressure curves | 🟡 High |
| **Brush texture preset** | Data URL texture round-trip, strength/scale/invert parameters | 🟡 High |
| **Extended frames (infinite canvas)** | Extended canvas dimensions, x/y offsets, separate PNG assets | 🟡 High |
| **CM frames (color model)** | Base64 Uint32Array round-trip, dimension validation | 🟡 High |
| **Camera keyframes** | CameraSystem serialize/load round-trip, bezier curves | 🟡 High |
| **Version 1 project** | Backward compatibility, missing-field defaults, no migration crash | 🟡 High |
| **Maximum dimensions (16384×16384)** | Boundary validation, memory handling | 🟢 Medium |
| **Empty layer (no frames)** | Sparse frame dictionary edge case | 🟢 Medium |
| **Audio clips + tracks** | localStorage round-trip (not in `.awproj`) | 🟢 Medium |

---

## 12. Summary Classification

### 🟢 SAFE

| Finding | Reason |
|:---|:---|
| Project file format | Versioned, validated, CRC32-checked, transactional rollback |
| Project import error handling | Full prior-state snapshot and restore on any exception |
| Brush preset identity stability | IDs are generated once, persisted, and stable across reload |
| Custom tip/texture embedding | Artwork is self-contained as data URLs in the preset object |
| Settings migration | Additive-only, try/catch with defaults fallback, original files untouched |
| localStorage quota handling | ~34 of ~40 `setItem` calls are wrapped in `try/catch` |
| Canvas backing-store recovery | `visibilitychange` reloads authoritative keyframe on tab resume |
| Palette import validation | JSON structure, hex format, RGB bounds, GPL syntax all validated |
| Keybinds import validation | Unknown actions filtered, malformed entries rejected |

### 🟡 SHOULD IMPROVE

| Finding | Recommendation |
|:---|:---|
| 6 unwrapped `localStorage.setItem` calls | Wrap in `try/catch`: audio clips/tracks/waveform, blend mode init, tool group defaults |
| No `beforeunload` dirty-document warning | Add `window.onbeforeunload` returning a string when artwork has been modified since last save |
| No recent projects list | Track last-opened filenames in localStorage for quick re-access |
| Layers identified by array index, not stable ID | Layer reordering changes all downstream index references (undo snapshots, clipping, groups). Stable UUIDs would be more robust. |
| Undo depth capped at 40 with no overflow warning | Consider progressive snapshot compression or warning when approaching limit |

### 🔴 DATA LOSS RISK

| Finding | Severity | Recommendation |
|:---|:---:|:---|
| **No autosave for artwork** | Critical | Implement periodic IndexedDB checkpoint (every 30–60s when dirty) |
| **No crash/close recovery** | Critical | IndexedDB autosave + `beforeunload` guard |
| **Save-during-async-GPU-commit race** | High | `exportProject()` must `await _hardRoundCommitTail` before reading frame canvases |
| **No `beforeunload` unsaved-changes prompt** | High | Trivial to add, prevents accidental tab close data loss |
| **Undo history not persisted** | Medium | Acceptable for now, but IndexedDB snapshots would enable crash-recovery undo |
