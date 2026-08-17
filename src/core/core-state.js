// core-state.js — State, DOM refs, Canvas init, Zoom & Pan
function showInfo(msg, title) {
  document.getElementById("modal-info-title").textContent = title || "Notice";
  document.getElementById("modal-info-msg").textContent = msg;
  document.getElementById("modal-info").classList.add("visible");
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("modal-info-ok").onclick = () =>
    document.getElementById("modal-info").classList.remove("visible");
  document.getElementById("modal-info").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal-info"))
      document.getElementById("modal-info").classList.remove("visible");
  });
});
// ════════════════════════════════════════════════════════════════
// PROJECT DIRTY / UNSAVED-CHANGES STATE
// ════════════════════════════════════════════════════════════════
let _projectDirty = false;

window.ProjectDirtyDebug = false;
const _projectStateTransitions = [];

function _recordStateTransition(action, reason, wasDirty) {
  const stackHint = (new Error().stack || "")
    .split("\n")
    .slice(2, 6)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" -> ");
  const record = {
    time: performance.now(),
    isoDate: new Date().toISOString(),
    action,
    reason: String(reason || "unknown"),
    alreadyDirty: wasDirty,
    stackHint,
  };
  _projectStateTransitions.push(record);
  if (_projectStateTransitions.length > 50) {
    _projectStateTransitions.shift();
  }
  if (window.ProjectDirtyDebug) {
    console.log(
      `[ProjectState] ${action.toUpperCase()}: ${reason} (alreadyDirty=${wasDirty})`,
    );
  }
}

let _currentProjectName =
  typeof window !== "undefined" && window._projectName
    ? String(window._projectName)
    : "Untitled";

function _updateProjectTitleUI() {
  if (typeof document === "undefined") return;
  const dirty = !!_projectDirty;
  const projectName = _currentProjectName || "";
  const display =
    projectName && projectName !== "Untitled"
      ? `${projectName} — Animator`
      : "Animator — Frame-by-Frame";
  document.title = dirty ? `* ${display}` : display;
}

if (typeof window !== "undefined") {
  try {
    Object.defineProperty(window, "_projectName", {
      get() {
        return _currentProjectName;
      },
      set(val) {
        _currentProjectName = val ? String(val).trim() : "Untitled";
        _updateProjectTitleUI();
      },
      configurable: true,
      enumerable: true,
    });
  } catch (_) {
    window._projectName = _currentProjectName;
  }
}

window.markProjectDirty = function (reason) {
  const wasDirty = _projectDirty;
  _recordStateTransition("dirty", reason, wasDirty);
  _projectDirty = true;
  _updateProjectTitleUI();
  if (
    window.ProjectRecovery &&
    typeof window.ProjectRecovery.notifyMutation === "function"
  ) {
    window.ProjectRecovery.notifyMutation(reason, !wasDirty);
  }
};

window.markProjectClean = function (reason) {
  const wasDirty = _projectDirty;
  _recordStateTransition("clean", reason, wasDirty);
  _projectDirty = false;
  _updateProjectTitleUI();
  if (
    window.ProjectRecovery &&
    typeof window.ProjectRecovery.notifyClean === "function"
  ) {
    window.ProjectRecovery.notifyClean(reason);
  }
};

window.isProjectDirty = function () {
  return _projectDirty;
};

window.ProjectStateAnalyze = function () {
  return {
    dirty: _projectDirty,
    transitions: _projectStateTransitions.slice(),
    totalTransitions: _projectStateTransitions.length,
  };
};

window._updateProjectTitleUI = _updateProjectTitleUI;

if (typeof document !== "undefined") {
  _updateProjectTitleUI();
  document.addEventListener("DOMContentLoaded", _updateProjectTitleUI);
}

window.confirmDiscardUnsavedChanges = async function () {
  if (!_projectDirty) return true;
  const msg = "You have unsaved changes in this project. Discard them?";
  if (typeof window.siteConfirm === "function") {
    return await window.siteConfirm(msg, {
      title: "Unsaved Changes",
      okText: "Discard Changes",
      danger: true,
    });
  }
  if (typeof confirm === "function") {
    return confirm(msg);
  }
  return true;
};

window.addEventListener("beforeunload", (e) => {
  if (_projectDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════
const PROJECT_DEFAULTS = (() => {
  const fps = 24,
    durationSeconds = 2,
    durationFrames = 15;
  return Object.freeze({
    fps: fps,
    durationSeconds: durationSeconds,
    durationFrames: durationFrames,
    totalFrames: durationSeconds * fps + durationFrames,
    outPointFrame: 40,
  });
})();
let CW = 1920,
  CH = 1080,
  TOTAL = PROJECT_DEFAULTS.totalFrames,
  MAX_FPS = PROJECT_DEFAULTS.fps;
let CellW = 28;
const CellH = 28;
let curFrame = 0,
  curLayer = 0,
  playing = false,
  playTimer = null;
let tool = "brush",
  color = "#000000",
  bgColor = "#ffffff";
let rangeStart = 0,
  rangeEnd = Math.min(TOTAL, PROJECT_DEFAULTS.outPointFrame) - 1,
  loopRange = false,
  rulerCtxFrame = 0;
const toolSizes = { brush: 6, eraser: 20, fill: 6 };
// The Line tool is a brush geometry mode, not a separate brush preset. Keep
// its public legacy key as an alias so older callers/settings continue to
// work while every read and write uses the Brush tool's canonical size.
Object.defineProperty(toolSizes, "line", {
  enumerable: true,
  configurable: false,
  get() {
    return this.brush;
  },
  set(value) {
    this.brush = value;
    window.dispatchEvent(
      new CustomEvent("brush-size-changed", {
        detail: {
          tool: "line",
          size: value,
          source: window._lineSizeUpdateSource || "unknown",
        },
      }),
    );
  },
});
Object.defineProperty(toolSizes, "curve", {
  enumerable: true,
  configurable: false,
  get() {
    return this.brush;
  },
  set(value) {
    this.line = value;
  },
});
let drawing = false,
  lx = 0,
  ly = 0,
  lineStart = null;
// TVPaint-style brush engine state
let brushOpacity = 1.0; // flow/opacity 0-1
let brushHardness = 1.0; // edge softness 0-1 (1=hard, 0=very soft airbrush)
// Antialiasing mode: true = sub-pixel soft edges (TVPaint PenBrush / Clip Studio normal)
//                   false = hard pixel-snapped edges (TVPaint Pencil / Clip Studio pixel pen)
let brushAA = true;
// Antialiasing STRENGTH mode: 'none' | 'weak' | 'medium' | 'strong'.
// Independent of brushHardness (radial falloff) -- controls only edge
// pixel coverage / subpixel smoothing width. brushAA (legacy boolean) is
// kept in sync for old code paths/UI: brushAA === (brushAAMode !== 'none').
// Backward compatibility: old saved settings with ts-aa=false map to
// 'none', ts-aa=true maps to 'medium' (also the default for Hard Round).
window.brushAAMode = "medium";
let undoStack = [],
  redoStack = [],
  clipboard = null,
  styleClipboard = null;
const LCOLORS = [
  "#7F77DD",
  "#1D9E75",
  "#EF9F27",
  "#e24b4a",
  "#D4537E",
  "#378ADD",
];

// ════════════════════════════════════════════════════════════════
// DRAWING MARK SYSTEM (Toon Boom Harmony-style)
// A "drawing mark" annotates each keyframe with its role in the
// animation. Only the mark's ID string is stored on each drawing
// (layer.frameMeta[frameIndex].markType). The full definition —
// abbreviation, display name, color — lives here in one place.
//
// Built-in mark IDs:
//   "keyframe"   — KF, the principal drawing for a movement
//   "breakdown"  — BD, a passing position between two keyframes
//   "inbetween"  — IB, an interpolated in-between drawing
//
// Drawings without an explicit markType default to "inbetween".
// ════════════════════════════════════════════════════════════════
const DRAWING_MARKS = {
  keyframe: {
    id: "keyframe",
    abbrev: "KF",
    displayName: "Keyframe",
    color: "#e24b4a", // red — principal poses
  },
  breakdown: {
    id: "breakdown",
    abbrev: "BD",
    displayName: "Breakdown",
    color: "#EF9F27", // amber — passing positions
  },
  inbetween: {
    id: "inbetween",
    abbrev: "IB",
    displayName: "Inbetween",
    color: "#7F77DD", // violet — interpolated drawings
  },
};

// The mark ID applied when no markType is stored (new drawings,
// old projects without markType). "inbetween" matches Harmony's
// default — every cell starts unmarked / as a plain inbetween.
const DRAWING_MARK_DEFAULT = "inbetween";

// ── Drawing mark helpers ───────────────────────────────────────
// These are the ONLY way other modules should read/write markType,
// so the storage location (layer.frameMeta) is encapsulated here.

/** Returns the DRAWING_MARKS entry for a given mark ID (or default). */
function getMarkDef(markId) {
  return DRAWING_MARKS[markId] || DRAWING_MARKS[DRAWING_MARK_DEFAULT];
}

/**
 * Returns the markType string for layer `li` at frame `fi`.
 * Falls back to DRAWING_MARK_DEFAULT for drawings that pre-date
 * this system or that have never been explicitly marked.
 */
let _drawingMarkLookupCount = 0,
  _drawingMarkLookupDuration = 0;
function getDrawingMark(li, fi) {
  const started = performance.now();
  _drawingMarkLookupCount++;
  const layer = layers[li],
    meta = layer && layer.frameMeta && layer.frameMeta[fi];
  const result = meta && meta.markType ? meta.markType : DRAWING_MARK_DEFAULT;
  _drawingMarkLookupDuration += performance.now() - started;
  return result;
}

/**
 * Sets the markType for layer `li` at frame `fi`.
 * Creates frameMeta / the per-frame entry as needed.
 * Pass null / undefined to reset to the default (removes the key).
 */
function setDrawingMark(li, fi, markType) {
  const layer = layers[li];
  if (!layer) return;
  if (!layer.frameMeta) layer.frameMeta = {};
  if (!markType || markType === DRAWING_MARK_DEFAULT) {
    // Removing an explicit mark — delete the key to keep storage lean
    if (layer.frameMeta[fi]) {
      delete layer.frameMeta[fi].markType;
      // Clean up the per-frame object entirely if nothing else lives in it
      if (Object.keys(layer.frameMeta[fi]).length === 0) {
        delete layer.frameMeta[fi];
      }
    }
  } else {
    if (!DRAWING_MARKS[markType]) {
      console.warn("[DrawingMark] Unknown mark ID:", markType, "— ignoring.");
      return;
    }
    if (!layer.frameMeta[fi]) layer.frameMeta[fi] = {};
    layer.frameMeta[fi].markType = markType;
  }
}

/** Hidden drawings remain stored, but are ignored by exposure resolution. */
function isDrawingFrameHidden(li, fi) {
  const layer = layers[li],
    meta = layer && layer.frameMeta && layer.frameMeta[fi];
  return !!(meta && meta.hidden);
}

function setDrawingFrameHidden(li, fi, hidden) {
  const layer = layers[li];
  if (!layer || !layer.frames || !layer.frames[fi]) return false;
  if (!layer.frameMeta) layer.frameMeta = {};
  if (hidden) {
    if (!layer.frameMeta[fi]) layer.frameMeta[fi] = {};
    layer.frameMeta[fi].hidden = true;
  } else if (layer.frameMeta[fi]) {
    delete layer.frameMeta[fi].hidden;
    if (Object.keys(layer.frameMeta[fi]).length === 0)
      delete layer.frameMeta[fi];
  }
  return true;
}
// Layer object shape: {name, visible, onTimeline, color, frames, opacity(0-1), stencil('none'|'inside'|'outside'), clipTo(layerIdx|null), groupId(string|null)}
// Group object shape: {id, name, visible, collapsed, opacity(0-1), color, parentId(string|null — id of the group this group is nested inside, null = top level)}
let groups = [];
function defaultLayerNameForType(layerType) {
  const type = layerType === "smart-raster" ? "smart-raster" : "bitmap";
  const label = type === "smart-raster" ? "Smart Raster Layer" : "Layer";
  const count = layers.filter((l) => (l.type || "bitmap") === type).length;
  return label + " " + (count + 1);
}
function makeBlankLayer(layerType, extra) {
  const type = layerType === "smart-raster" ? "smart-raster" : "bitmap";
  return Object.assign(
    {
      name: defaultLayerNameForType(type),
      visible: true,
      locked: false,
      onionSkin: false,
      onTimeline: true,
      color: "transparent",
      frames: {},
      frameMeta: {},
      indexFrames: {},
      indexMeta: {},
      type,
      renderMode: "legacy",
      smartRasterV4Native: type === "smart-raster",
      opacity: 1,
      stencil: "none",
      clipTo: null,
      groupId: null,
    },
    extra || {},
  );
}
let layers = [
  {
    name: "Layer 1",
    visible: true,
    locked: false,
    onionSkin: false,
    onTimeline: true,
    color: "transparent",
    frames: {},
    frameMeta: {},
    indexFrames: {},
    indexMeta: {},
    type: "bitmap",
    opacity: 1,
    stencil: "none",
    clipTo: null,
    groupId: null,
  },
];
function isLayerLocked(layerIndex = curLayer) {
  const layer = layers[layerIndex];
  if (!layer) return false;
  if (layer.locked) return true;
  let groupId = layer.groupId,
    seen = new Set();
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId);
    const group = groups.find((item) => item.id === groupId);
    if (!group) break;
    if (group.locked) return true;
    groupId = group.parentId || null;
  }
  return false;
}
function setLayerLocked(layerIndex, locked) {
  const layer = layers[layerIndex];
  if (!layer) return false;
  layer.locked = !!locked;
  window.dispatchEvent(
    new CustomEvent("layer-lock-changed", {
      detail: { layerIndex, locked: layer.locked },
    }),
  );
  return layer.locked;
}
window.isLayerLocked = isLayerLocked;
window.setLayerLocked = setLayerLocked;

// Zoom / Pan / Rotate — stored in canvas-area coordinate space
let zoom = 1,
  panX = 0,
  panY = 0;
const ZOOM_SPEED_FACTORS = {
  1: 0.05,
  2: 0.08,
  3: 0.11,
  4: 0.15,
  5: 0.2,
  6: 0.25,
  7: 0.31,
  8: 0.37,
  9: 0.43,
  10: 0.5,
};
const DEFAULT_ZOOM_SPEED_LEVEL = 4;
function clampZoomSpeedLevel(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 10) return DEFAULT_ZOOM_SPEED_LEVEL;
  return n;
}
let zoomSpeedLevel = DEFAULT_ZOOM_SPEED_LEVEL;
try {
  const storedZoomSpeed = localStorage.getItem("animator_zoom_speed");
  if (storedZoomSpeed != null) {
    zoomSpeedLevel = clampZoomSpeedLevel(storedZoomSpeed);
  }
} catch (e) {}
let zoomSpeed = ZOOM_SPEED_FACTORS[zoomSpeedLevel];
let zoomMin = 0.1,
  zoomMax = 16;
function setZoomSpeedLevel(level) {
  zoomSpeedLevel = clampZoomSpeedLevel(level);
  zoomSpeed = ZOOM_SPEED_FACTORS[zoomSpeedLevel];
  try {
    localStorage.setItem("animator_zoom_speed", String(zoomSpeedLevel));
  } catch (e) {}
  return zoomSpeedLevel;
}
window.clampZoomSpeedLevel = clampZoomSpeedLevel;
window.setZoomSpeedLevel = setZoomSpeedLevel;
window.ZOOM_SPEED_FACTORS = ZOOM_SPEED_FACTORS;
let rotation = 0; // canvas rotation in degrees, clockwise
let flipX = false,
  flipY = false; // canvas mirrored horizontally / vertically (view-only, like rotation)

// Selection
let selectedFrames = new Set([0]);
let selectedKFs = new Set();
let tlSelDrag = null;

// Panel visibility
let showLayers = true,
  showTimeline = true,
  showToolbar = true;

// ════════════════════════════════════════════════════════════════
// DOM REFS
// ════════════════════════════════════════════════════════════════
const compC = document.getElementById("composite-canvas");
const displayC = document.getElementById("display-canvas");
const onionC = document.getElementById("onion-canvas");
const activeC = document.getElementById("active-canvas");
// Phase 11A.3: the live Hard Round GPU preview surface (see
// prototype-renderer.js's GpuBackend / brush-engine.js's
// _hardRoundGpuOverlay()). It sits in the same canvas-wrap stack as
// activeC and shares its exact backing-store resolution, so it must also
// share applyTransform()'s zoom-dependent image-rendering below -- see
// that function's comment for why this canvas being left out of that list
// is exactly what made the live stroke look softer than the committed one.
const hardRoundOverlayC = document.getElementById("hard-round-gpu-overlay");
const customTipOverlayC = document.getElementById("custom-tip-gpu-overlay");
// Transparent current-frame composite used only for display ordering. compC
// remains the exact background + artwork composite used by export and sampling.
const artworkCompositeC = document.createElement("canvas");
const compCtx = compC.getContext("2d");
const displayCtx = displayC.getContext("2d");
const octx = onionC.getContext("2d");
const artworkCompositeCtx = artworkCompositeC.getContext("2d");
function refreshDisplayComposite() {
  displayCtx.clearRect(0, 0, CW, CH);
  displayCtx.imageSmoothingEnabled = true;
  displayCtx.imageSmoothingQuality = "high";
  displayCtx.filter =
    _displayBlurPx > 0.05 ? "blur(" + _displayBlurPx + "px)" : "none";
  // Onion skin must render BELOW the current artwork and ABOVE the
  // background (see src/ui/panels.js recomposite() for the matching fix
  // and rationale). compC is the persistent background+artwork composite
  // used by export/color-sampling, so its bg+artwork invariant must still
  // hold when this function returns -- we briefly redraw compC to
  // background-only (drawBg()) to source the background layer for
  // display, then immediately restore compC to bg+artwork exactly as
  // before. artworkCompositeC (current artwork only, transparent
  // elsewhere) is drawn to the display exactly once, on top of onion.
  drawBg();
  if (window.LightTable && typeof window.LightTable.render === "function")
    window.LightTable.render(compCtx);
  displayCtx.drawImage(compC, 0, 0);
  displayCtx.drawImage(onionC, 0, 0);
  compCtx.globalAlpha = 1;
  compCtx.drawImage(artworkCompositeC, 0, 0);
  displayCtx.drawImage(artworkCompositeC, 0, 0);
  displayCtx.filter = "none";
  if (window.DisplayBackend) window.DisplayBackend.scheduleUpload();
  if (window.CameraView) window.CameraView.invalidate();
}
// NOTE: deliberately NOT using {desynchronized:true} here. activeC is read
// back synchronously via drawImage in saveActiveToKey() every time you
// switch layers/frames (panels.js), right around when recomposite() also
// toggles activeC's opacity on a rAF callback. desynchronized rendering
// lets the browser present this canvas through an independently-timed
// buffer for lower input latency, but that means a same-tick drawImage
// read-back of it is not guaranteed to reflect the very latest paint in
// every browser/GPU combo — which intermittently made a layer switch save
// a stale/blank copy of what was just drawn, looking like lost work.
const ctx = activeC.getContext("2d", { willReadFrequently: true });
const wrap = document.getElementById("canvas-wrap");
const canvasArea = document.getElementById("canvas-area");
const rulerEl = document.getElementById("tl-ruler");
const tlScroll = document.getElementById("tl-scroll");
const zoomInd = document.getElementById("zoom-indicator");
const toolbarEl = document.getElementById("toolbar");
const rightPanel = document.getElementById("right-panel");
const bottomArea = document.getElementById("bottom-area");
const rhBottom = document.getElementById("rh-bottom");
const mainArea = document.getElementById("main-area");
const timelineArea = document.getElementById("timeline-area");
const fpsTl = document.getElementById("fps-tl");
const fpsVal = document.getElementById("fps-val");

// ════════════════════════════════════════════════════════════════
// CANVAS INIT
// ════════════════════════════════════════════════════════════════
function initCanvas() {
  const transformC = document.getElementById("transform-canvas");
  [compC, displayC, onionC, activeC, transformC, artworkCompositeC].forEach(
    (c) => {
      c.width = CW;
      c.height = CH;
    },
  );
  wrap.style.width = CW + "px";
  wrap.style.height = CH + "px";
  drawBg();
  document.getElementById("stat-canvas").textContent = CW + "×" + CH;
}

// PERF FIX: drawBg() runs on EVERY animation frame while a stroke is in
// progress (recomposite() is RAF-scheduled from every pointermove). For a
// transparent background it used to create a brand-new <canvas>, fill it,
// and build a brand-new repeat-pattern from it on every single call — up to
// 60×/sec while drawing, just to redraw a checkerboard that never changes.
// Build the tiny tile + pattern ONCE and reuse the cached pattern object.
let _bgCheckerPattern = null;
function _getBgCheckerPattern() {
  if (_bgCheckerPattern) return _bgCheckerPattern;
  const pat = document.createElement("canvas");
  pat.width = 14;
  pat.height = 14;
  const pc = pat.getContext("2d");
  pc.fillStyle = "#aaa";
  pc.fillRect(0, 0, 14, 14);
  pc.fillStyle = "#ddd";
  pc.fillRect(0, 0, 7, 7);
  pc.fillRect(7, 7, 7, 7);
  _bgCheckerPattern = compCtx.createPattern(pat, "repeat");
  return _bgCheckerPattern;
}
function drawBg() {
  compCtx.fillStyle =
    bgColor === "transparent" ? _getBgCheckerPattern() : bgColor;
  compCtx.fillRect(0, 0, CW, CH);
}

// ════════════════════════════════════════════════════════════════
// ZOOM & PAN  — all coordinates in canvas-area space
// ════════════════════════════════════════════════════════════════

// Docked panels (Tools, Layers, Brush Presets, etc.) sit on top of
// canvas-area via absolute positioning, so canvas-area's own box never
// shrinks for them — compute the actual visually-clear rect by
// subtracting whichever docked, visible panels currently occupy each edge.
// Shared by centerCanvas() and getNavPivot() so "center" always means the
// same thing for layout and for the rotation pivot.
function _getClearArea() {
  const r = canvasArea.getBoundingClientRect();
  // Draw Mode hides the complete dock layer. Its child panels can still
  // match the dock selectors while returning zero-sized rectangles at the
  // viewport origin, which must not be interpreted as occupied dock space.
  if (document.body.classList.contains("draw-mode")) {
    return {
      r,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      clearW: r.width,
      clearH: r.height,
    };
  }
  let left = 0,
    right = 0,
    top = 0,
    bottom = 0;
  document
    .querySelectorAll(".float-panel.docked:not(.fp-hidden)")
    .forEach((panel) => {
      const pr = panel.getBoundingClientRect();
      // Use the actual canvas-facing edge, including the panel's live dock
      // offset. Width alone is insufficient when several dock columns sit
      // side-by-side on the same edge.
      if (panel.classList.contains("dock-left")) {
        left = Math.max(
          left,
          Math.min(r.width, Math.max(0, pr.right - r.left)),
        );
      } else if (panel.classList.contains("dock-right")) {
        right = Math.max(
          right,
          Math.min(r.width, Math.max(0, r.right - pr.left)),
        );
      } else if (panel.classList.contains("dock-top")) {
        top = Math.max(top, Math.min(r.height, Math.max(0, pr.bottom - r.top)));
      } else if (panel.classList.contains("dock-bottom")) {
        bottom = Math.max(
          bottom,
          Math.min(r.height, Math.max(0, r.bottom - pr.top)),
        );
      }
    });
  return {
    r,
    left,
    right,
    top,
    bottom,
    clearW: Math.max(0, r.width - left - right),
    clearH: Math.max(0, r.height - top - bottom),
  };
}

/** Center canvas within the visible canvas-area */
function centerCanvas() {
  const { left, top, clearW, clearH } = _getClearArea();
  panX = left + (clearW - CW * zoom) / 2;
  panY = top + (clearH - CH * zoom) / 2;
  applyTransform();
}

/** Center of the visually-clear canvas-area (docked panels excluded).
 * Returns both:
 *  - cx,cy: LOCAL coords (relative to canvas-area's own box) — the same
 *    space panX/panY live in, so this is what rotateCanvasTo()/zoom-drag
 *    math and the crosshair's CSS left/top (it's absolutely positioned
 *    inside canvas-area) must use.
 *  - gcx,gcy: GLOBAL/client coords (viewport-relative) — for comparing
 *    against raw mouse/pointer event clientX/clientY (e.g. rotate-drag
 *    angle tracking).
 * Used as the pivot for canvas rotation (and the rotation crosshair) so it
 * always sits in the middle of the visible drawing space rather than the
 * middle of canvas-area's full underlying box, which docked panels would
 * otherwise throw off-center. */
function getNavPivot() {
  const { r, left, top, clearW, clearH } = _getClearArea();
  return {
    cx: left + clearW / 2,
    cy: top + clearH / 2,
    gcx: r.left + left + clearW / 2,
    gcy: r.top + top + clearH / 2,
  };
}

function _toUnflippedNavPoint(x, y) {
  const pivot = getNavPivot();
  return {
    x: pivot.cx + (x - pivot.cx) * (flipX ? -1 : 1),
    y: pivot.cy + (y - pivot.cy) * (flipY ? -1 : 1),
  };
}

/** Compute a zoom level that fits the whole canvas inside the actual clear canvas-area, then center it.
 * Used for initial layout and "Reset Layout" so large canvases (e.g. 1920×1080) don't start zoomed
 * in past the visible viewport. */
function fitCanvasToView() {
  const { clearW, clearH } = _getClearArea();
  if (clearW <= 0 || clearH <= 0) return; // layout not settled yet
  // canvas-area already ends exactly at the Timeline and _getClearArea()
  // already subtracts every visible dock. Adding another fixed inset here
  // made the default zoom smaller than the real available space and left a
  // visible gap beside the limiting edge.
  const fitZoom = Math.min(clearW / CW, clearH / CH);
  // Keep breathing room around standard-size canvases so boundary handles
  // remain visible and reachable. Small workspaces may still fit below 50%.
  const defaultFitZoom = Math.min(0.5, fitZoom > 0 ? fitZoom : 1);
  zoom = Math.max(zoomMin, Math.min(zoomMax, defaultFitZoom));
  centerCanvas();
  showZoom();
}

function applyTransform() {
  // Flip is applied OUTSIDE rotate/scale, as a screen-space mirror around
  // the nav pivot (translate(pivot) scale(±1) translate(-pivot) wrapping
  // the normal translate/rotate/scale chain). Folding the flip into the
  // local scale axes instead (as a previous version did) makes "horizontal"
  // and "vertical" rotate along with the canvas — at 90° a "horizontal"
  // flip would visually mirror top/bottom. Doing it in screen space keeps
  // Flip Horizontal always left/right and Flip Vertical always up/down,
  // no matter the current rotation. The pivot is recomputed live each call
  // (same as getNavPivot() everywhere else); it only changes pan/rotate
  // doesn't move it, so no pan compensation is needed when toggling.
  const pivot = getNavPivot();
  const fx = flipX ? -1 : 1,
    fy = flipY ? -1 : 1;
  wrap.style.transform =
    `translate(${pivot.cx}px,${pivot.cy}px) scale(${fx},${fy}) translate(${-pivot.cx}px,${-pivot.cy}px) ` +
    `translate(${panX}px,${panY}px) rotate(${rotation}deg) scale(${zoom})`;
  // TVPaint behaviour: nearest-neighbour (crisp) once zoomed in enough,
  // bilinear (soft) below that. At exact/high zoom this preserves the true
  // hard-edged pixels instead of applying a second display blur.
  //
  // Phase 11A.3: hardRoundOverlayC MUST be in this list. It's a sibling
  // canvas in the same canvas-wrap stack, scaled by the exact same
  // wrap.style.transform (including this zoom factor) as every canvas
  // below it -- but being a WebGPU canvas, it was never touched by this
  // function before, so it silently kept the browser's default
  // image-rendering:auto (bilinear) at every zoom level. At zoom>=1.5,
  // every other canvas here switched to crisp 'pixelated' scaling while
  // this one alone stayed bilinear-softened by the CSS transform scale --
  // which is the entire live-preview-looks-blurry bug: the live stroke is
  // shown through this overlay while drawing, then instantly looks sharp
  // the moment pointerup hides it and reveals the (correctly 'pixelated')
  // committed pixels on activeC/displayC underneath. No shader, coverage,
  // or compositing-order change fixes this -- only matching this CSS
  // property across every canvas in the stack does.
  const useNN = zoom >= 1.5;
  const transformC = document.getElementById("transform-canvas");
  const customTipC =
    document.getElementById("custom-tip-gpu-overlay") || customTipOverlayC;
  [
    displayC,
    onionC,
    activeC,
    hardRoundOverlayC,
    customTipC,
    transformC,
  ].forEach((c) => {
    if (c) c.style.imageRendering = useNN ? "pixelated" : "auto";
  });
  const previousDisplayBlur = _displayBlurPx;
  _updateDisplayBlur();
  // The low-zoom prefilter is baked into displayC, not applied by CSS.
  // Rebuild it as soon as zoom changes the required blur; otherwise the
  // blurred 10% bitmap stays cached until another brush dab recomposites it.
  if (Math.abs(previousDisplayBlur - _displayBlurPx) > 1e-6)
    refreshDisplayComposite();
  _syncZoomStatus();
  if (window.DisplayBackend) window.DisplayBackend.renderView();
  window.dispatchEvent(new Event("canvas-view-transform-changed"));
}

function toggleFlipH() {
  flipX = !flipX;
  applyTransform();
  const btn = document.getElementById("btn-flip-h");
  if (btn) btn.classList.toggle("active", flipX);
}
function toggleFlipV() {
  flipY = !flipY;
  applyTransform();
  const btn = document.getElementById("btn-flip-v");
  if (btn) btn.classList.toggle("active", flipY);
}

// ── Zoomed-out shimmer fix ──────────────────────────────────────────────
// compC (the data canvas) gets redrawn at full resolution every frame while
// drawing, then shown on screen via CSS transform: scale(zoom). When
// zoom<1 the browser has to re-downsample that full-res bitmap EVERY
// FRAME (since it just changed), and browsers generally use a cheap
// single-tap filter for that continuous case rather than a proper
// mipmap/box-filter — which aliases a hard antialiased stroke edge into a
// shimmering "wave" as you draw. (At zoom>=1 there's no minification, so
// it never shows up — matches the reported symptom exactly.)
// Fix: pre-blur the DISPLAY-ONLY copy (compC -> displayC) by an amount
// proportional to how much it's about to be shrunk, before the browser's
// own downscale runs. This is the standard "pre-filter before minifying"
// technique and is what a correct box-filtered downsample would already
// be doing; compC itself is never touched, so eyedropper/export/etc. stay
// pixel-exact.
let _displayBlurPx = 0;
let _displayBlurEnabled = true;
const _ZOOM_BLUR_START = 0.5; // zoom level below which the pre-blur starts (was ~1.0 — engaged almost immediately on any zoom-out)
function _updateDisplayBlur() {
  _displayBlurPx =
    _displayBlurEnabled && zoom < _ZOOM_BLUR_START
      ? Math.min(6, (_ZOOM_BLUR_START / zoom - 1) * 0.8)
      : 0;
}
window.ExperimentalDisplayBlur = {
  set(enabled) {
    const next = !!enabled;
    if (next === _displayBlurEnabled) return _displayBlurEnabled;
    _displayBlurEnabled = next;
    _updateDisplayBlur();
    refreshDisplayComposite();
    return _displayBlurEnabled;
  },
  get enabled() {
    return _displayBlurEnabled;
  },
};

function _syncZoomStatus() {
  const status = document.getElementById("stat-zoom");
  if (status) status.textContent = "Zoom: " + Math.round(zoom * 100) + "%";
}

function showZoom() {
  const pct = Math.round(zoom * 100) + "%";
  zoomInd.textContent = pct;
  zoomInd.classList.add("show");
  _syncZoomStatus();
  clearTimeout(zoomInd._t);
  zoomInd._t = setTimeout(() => zoomInd.classList.remove("show"), 1100);
}

const rotInd = document.getElementById("rotation-indicator");
// Keep the angle HUD in the main application overlay layer, outside the
// lower canvas stacking context used beneath docked panels.
document.getElementById("main-area")?.appendChild(rotInd);
function showRotation() {
  // Normalize to (-180, 180] for a friendlier readout while keeping
  // the underlying `rotation` value unbounded (simpler drag math).
  let disp = ((((rotation + 180) % 360) + 360) % 360) - 180;
  if (disp === -180) disp = 180;
  const deg = Math.round(disp) + "°";
  if (rotInd) {
    rotInd.textContent = deg;
    rotInd.classList.toggle("show", rotation !== 0);
    if (rotation !== 0) {
      clearTimeout(rotInd._t);
      rotInd._t = setTimeout(() => rotInd.classList.remove("show"), 1100);
    } else {
      clearTimeout(rotInd._t);
    }
  }
  document.getElementById("stat-rotation").textContent = "Rotation: " + deg;
}

/**
 * Rotate the canvas to `newRot` degrees, keeping the canvas-space point
 * currently under the pivot (pivotX,pivotY, in canvas-area LOCAL
 * coordinates — the same space panX/panY live in) visually fixed on
 * screen — mirrors how doZoom() anchors zoom to a point.
 */
function rotateCanvasTo(newRot, pivotX, pivotY) {
  const rad = (rotation * Math.PI) / 180;
  const cosR = Math.cos(rad),
    sinR = Math.sin(rad);
  const dx = pivotX - panX,
    dy = pivotY - panY;
  // Un-rotate + un-scale to get the canvas-space point under the pivot.
  const ux = (dx * cosR + dy * sinR) / zoom;
  const uy = (-dx * sinR + dy * cosR) / zoom;
  rotation = newRot;
  const rad2 = (rotation * Math.PI) / 180;
  const cos2 = Math.cos(rad2),
    sin2 = Math.sin(rad2);
  panX = pivotX - (ux * cos2 - uy * sin2) * zoom;
  panY = pivotY - (ux * sin2 + uy * cos2) * zoom;
  applyTransform();
  showRotation();
}

/** Reset rotation back to 0°, keeping the canvas-space point under the
 *  nav pivot visually fixed — same pivot-preserving math as rotateCanvasTo().
 *  Pan, zoom, and flip are all preserved; only rotation changes. */
function resetRotation() {
  _cancelRotateSettle();
  const p = getNavPivot();
  rotateCanvasTo(0, p.cx, p.cy);
}

/**
 * Zoom toward a point (cx,cy) in canvas-area client coordinates.
 * cx,cy are relative to canvasArea element top-left.
 */
function doZoom(delta, cx, cy) {
  if (window.CameraView && CameraView.active) return;
  ({ x: cx, y: cy } = _toUnflippedNavPoint(cx, cy));
  const oldZoom = zoom;
  const factor = delta > 0 ? 1 + zoomSpeed : 1 / (1 + zoomSpeed);
  zoom = Math.max(zoomMin, Math.min(zoomMax, zoom * factor));
  // Adjust pan so that the canvas-space point under cursor stays fixed:
  // canvasX = (cx - panX) / oldZoom  →  after zoom: panX_new = cx - canvasX * zoom
  panX = cx - (cx - panX) * (zoom / oldZoom);
  panY = cy - (cy - panY) * (zoom / oldZoom);
  applyTransform();
  showZoom();
}

// Scroll to zoom toward cursor
canvasArea.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (window.CameraView && CameraView.active) {
      CameraView.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
      return;
    }
    const r = canvasArea.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // Trackpad pinch-to-zoom sets ctrlKey=true; plain two-finger scroll does not
    if (e.ctrlKey) {
      // Pinch-to-zoom: use deltaY magnitude for smooth zoom
      const navPoint = _toUnflippedNavPoint(cx, cy);
      const navX = navPoint.x,
        navY = navPoint.y;
      const factor = 1 - e.deltaY * 0.01;
      const oldZoom = zoom;
      zoom = Math.max(zoomMin, Math.min(zoomMax, zoom * factor));
      panX = navX - (navX - panX) * (zoom / oldZoom);
      panY = navY - (navY - panY) * (zoom / oldZoom);
      applyTransform();
      showZoom();
    } else {
      // Two-finger scroll pan OR mouse wheel zoom
      if (e.deltaX !== 0 || Math.abs(e.deltaY) < 50) {
        // Trackpad scroll: pan the canvas. Same un-mirroring as the
        // space-drag pan is needed here so scroll direction stays natural
        // regardless of flip state.
        const fx = flipX ? -1 : 1,
          fy = flipY ? -1 : 1;
        panX -= fx * e.deltaX;
        panY -= fy * e.deltaY;
        applyTransform();
      } else {
        // Mouse wheel: zoom
        const dir = e.deltaY < 0 ? 1 : -1;
        doZoom(dir, cx, cy);
      }
    }
  },
  { passive: false },
);

// Pan (Space+drag or middle mouse); Rotate (Shift+Space+drag)
let panning = false,
  panSX = 0,
  panSY = 0,
  panSPX = 0,
  panSPY = 0;
let spaceHeld = false,
  ctrlHeld = false,
  shiftHeld = false;
let _zoomDrag = false,
  _zoomDragSX = 0,
  _zoomDragStartZoom = 0,
  _zoomDragCX = 0,
  _zoomDragCY = 0;
let _rotateDrag = false,
  _rotateDragSX = 0,
  _rotateDragSY = 0,
  _rotateDragStartRot = 0,
  _rotateDragCX = 0,
  _rotateDragCY = 0,
  _rotateDragGCX = 0,
  _rotateDragGCY = 0;
let _rotateSnapTarget = null;
let _rotatePrevRawRot = null;
let _rotatePrevTimestamp = null;
let _rotateSnapArmedUntil = null;
let _rotateSettleRaf = null;

function _cancelRotateSettle() {
  if (_rotateSettleRaf) {
    cancelAnimationFrame(_rotateSettleRaf);
    _rotateSettleRaf = null;
  }
}

function _startRotateSpringSettle(startAngle, targetAngle, pivotX, pivotY) {
  _cancelRotateSettle();
  if (
    !Number.isFinite(startAngle) ||
    !Number.isFinite(targetAngle) ||
    Math.abs(startAngle - targetAngle) < 0.01
  ) {
    rotateCanvasTo(targetAngle, pivotX, pivotY);
    return;
  }
  const startTime =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const duration =
    typeof window !== "undefined" &&
    window.RotationSnap &&
    window.RotationSnap.SPRING_DURATION_MS
      ? window.RotationSnap.SPRING_DURATION_MS
      : 220;
  const progressFn =
    typeof window !== "undefined" &&
    window.RotationSnap &&
    typeof window.RotationSnap.springProgress === "function"
      ? window.RotationSnap.springProgress
      : (t) => 1 - Math.exp(-4.5 * t) * Math.cos(7.5 * t);
  const diff = targetAngle - startAngle;

  function step() {
    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    if (t >= 1) {
      rotateCanvasTo(targetAngle, pivotX, pivotY);
      _rotateSettleRaf = null;
      return;
    }
    const p = progressFn(t);
    const currentAngle = startAngle + diff * p;
    rotateCanvasTo(currentAngle, pivotX, pivotY);
    _rotateSettleRaf = requestAnimationFrame(step);
  }
  _rotateSettleRaf = requestAnimationFrame(step);
}

// Capture phase on window + stopPropagation: Space (and especially Ctrl+Space)
// must be stopped BEFORE it can reach the browser's own shortcut handling.
// Some browsers treat Ctrl+Space as "focus the address/search bar" — a plain
// document-level bubble-phase listener with only preventDefault() isn't
// always early/forceful enough to stop that, so we intercept as early as
// possible and explicitly stop the event from propagating any further.
// Real text-entry inputs (where Space should type a literal space) get
// exempted from the pan handler; other <input> types (range sliders,
// checkboxes, color pickers, etc.) do NOT need typed spaces and must not be
// able to keep Ctrl+Space from being captured just because they're focused.
const _TEXT_ENTRY_TYPES = new Set([
  "text",
  "search",
  "number",
  "email",
  "password",
  "tel",
  "url",
]);
function _isTextEntryTarget(t) {
  if (t.tagName === "TEXTAREA") return true;
  if (t.tagName === "INPUT")
    return _TEXT_ENTRY_TYPES.has((t.type || "text").toLowerCase());
  return false;
}

// Elements over which Space/Ctrl+Space/Shift+Space drag navigation should
// NOT engage — dockers, floating panels, the menu/toolbar, timeline,
// status bar, modals, and any interactive control. Everywhere else
// (including outside canvas-area itself, e.g. over empty space, the
// timeline, or status bar) is fair game for navigating the canvas.
const _NAV_BLOCKED_SELECTOR =
  ".float-panel,#toolbar,#menubar,.dropdown,#bottom-area,#status,.modal-overlay,.modal,#camera-view-preview,[data-space-pan],button,input,select,textarea,a";
function _isNavBlocked(t) {
  return !!(
    t &&
    typeof t.closest === "function" &&
    t.closest(_NAV_BLOCKED_SELECTOR)
  );
}

const rotPivotEl = document.getElementById("rotation-pivot");
function _writeNavigationCursor(element, value, source) {
  element.style.cursor = value;
  if (window.BrushCursorNativeFlashNoteWrite)
    window.BrushCursorNativeFlashNoteWrite(
      element,
      value,
      "core-state:" + source,
    );
}
function _updateRotPivotVisibility() {
  if (!rotPivotEl) return;
  const show = _rotateDrag || (spaceHeld && shiftHeld && !ctrlHeld);
  rotPivotEl.classList.toggle("show", show);
  if (show) {
    // rotation-pivot is absolutely positioned inside canvas-area, so it
    // needs LOCAL (canvas-area-relative) coords, not raw client coords.
    const p = _rotateDrag
      ? { cx: _rotateDragCX, cy: _rotateDragCY }
      : getNavPivot();
    rotPivotEl.style.left = p.cx + "px";
    rotPivotEl.style.top = p.cy + "px";
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    if (
      e.key === "Control" ||
      e.code === "ControlLeft" ||
      e.code === "ControlRight"
    ) {
      ctrlHeld = true;
      if (spaceHeld && !panning && !_zoomDrag && !_rotateDrag)
        _writeNavigationCursor(activeC, "zoom-in", "control-down");
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      shiftHeld = true;
      _updateRotPivotVisibility();
    }
    if (e.code === "Space" && !_isTextEntryTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      spaceHeld = true;
      // Space is a canvas-only shortcut — if a toolbar button/control still
      // has keyboard focus from an earlier click (e.g. the AA toggle), drop
      // it now. Otherwise a focus-visible ring can latch onto that control
      // and never clear, since nothing else would blur it afterwards.
      if (
        document.activeElement &&
        document.activeElement !== document.body &&
        document.activeElement.blur
      )
        document.activeElement.blur();
      if (!panning && !_zoomDrag && !_rotateDrag)
        _writeNavigationCursor(
          activeC,
          ctrlHeld ? "zoom-in" : shiftHeld ? "alias" : "grab",
          "space-down",
        );
      _updateRotPivotVisibility();
    }
  },
  { capture: true },
);
window.addEventListener(
  "keyup",
  (e) => {
    if (
      e.key === "Control" ||
      e.code === "ControlLeft" ||
      e.code === "ControlRight"
    ) {
      ctrlHeld = false;
      if (spaceHeld && !panning && !_zoomDrag && !_rotateDrag)
        _writeNavigationCursor(
          activeC,
          shiftHeld ? "alias" : "grab",
          "control-up",
        );
    }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
      shiftHeld = false;
      _updateRotPivotVisibility();
    }
    if (e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      spaceHeld = false;
      if (!panning && !_zoomDrag && !_rotateDrag)
        _writeNavigationCursor(
          activeC,
          activeGroupId ? "not-allowed" : _baseCursorCSS(),
          "space-up",
        );
      _updateRotPivotVisibility();
    }
  },
  { capture: true },
);

function _spaceDragStart(clientX, isCtrl) {
  _cancelRotateSettle();
  if (isCtrl || ctrlHeld) {
    _zoomDrag = true;
    _zoomDragSX = clientX;
    _zoomDragStartZoom = zoom;
    _writeNavigationCursor(canvasArea, "zoom-in", "space-zoom-start");
  } else if (shiftHeld) {
    const p = getNavPivot();
    _rotateDrag = true;
    _rotateDragSX = clientX;
    _rotateDragSY = 0;
    _rotateDragStartRot = rotation;
    _rotateSnapTarget = null;
    _rotatePrevRawRot = null;
    _rotatePrevTimestamp = null;
    _rotateSnapArmedUntil = null;
    _rotateDragCX = p.cx;
    _rotateDragCY = p.cy;
    _rotateDragGCX = p.gcx;
    _rotateDragGCY = p.gcy;
    _writeNavigationCursor(canvasArea, "alias", "space-rotate-start");
    _updateRotPivotVisibility();
  } else {
    panning = true;
    panSX = clientX;
    panSY = 0;
    panSPX = panX;
    panSPY = panY;
    _writeNavigationCursor(canvasArea, "grabbing", "space-pan-start");
  }
}
function _spaceDragStartXY(clientX, clientY, isCtrl) {
  _cancelRotateSettle();
  if (isCtrl || ctrlHeld) {
    _zoomDrag = true;
    _zoomDragSX = clientX;
    _zoomDragStartZoom = zoom;
    // Anchor the zoom to wherever the drag started (in local
    // canvas-area coordinates), not the canvas-area center — this matches
    // how scroll-wheel zoom already anchors to the cursor position.
    const r = canvasArea.getBoundingClientRect();
    const navPoint = _toUnflippedNavPoint(clientX - r.left, clientY - r.top);
    _zoomDragCX = navPoint.x;
    _zoomDragCY = navPoint.y;
    _writeNavigationCursor(canvasArea, "zoom-in", "space-zoom-start-xy");
  } else if (shiftHeld) {
    const p = getNavPivot();
    _rotateDrag = true;
    _rotateDragSX = clientX;
    _rotateDragSY = clientY;
    _rotateDragStartRot = rotation;
    _rotateSnapTarget = null;
    _rotatePrevRawRot = null;
    _rotatePrevTimestamp = null;
    _rotateSnapArmedUntil = null;
    _rotateDragCX = p.cx;
    _rotateDragCY = p.cy;
    _rotateDragGCX = p.gcx;
    _rotateDragGCY = p.gcy;
    _writeNavigationCursor(canvasArea, "alias", "space-rotate-start-xy");
    _updateRotPivotVisibility();
  } else {
    panning = true;
    panSX = clientX;
    panSY = clientY;
    panSPX = panX;
    panSPY = panY;
    _writeNavigationCursor(canvasArea, "grabbing", "space-pan-start-xy");
  }
}
function _spaceDragMove(clientX, clientY, eventTimestamp) {
  if (_zoomDrag) {
    // drag right = zoom in, drag left = zoom out; 300px = 2x
    const dx = clientX - _zoomDragSX;
    // Zoom anchored to where the drag started, not the canvas-area center —
    // matches scroll-wheel zoom's cursor-anchored behavior.
    const cx = _zoomDragCX,
      cy = _zoomDragCY;
    const newZoom = Math.max(
      zoomMin,
      Math.min(zoomMax, _zoomDragStartZoom * Math.pow(2, dx / 300)),
    );
    panX = cx - (cx - panX) * (newZoom / zoom);
    panY = cy - (cy - panY) * (newZoom / zoom);
    zoom = newZoom;
    applyTransform();
  } else if (_rotateDrag) {
    // Rotate proportional to the swept angle around the canvas-area
    // center, so dragging in an arc feels like spinning the canvas.
    // Angle tracking compares against raw clientX/clientY, so it uses the
    // GLOBAL pivot; the actual pan adjustment (rotateCanvasTo) needs the
    // LOCAL pivot, since that's the coordinate space panX/panY live in.
    const a0 = Math.atan2(
      _rotateDragSY - _rotateDragGCY,
      _rotateDragSX - _rotateDragGCX,
    );
    const a1 = Math.atan2(clientY - _rotateDragGCY, clientX - _rotateDragGCX);
    const reflectionDirection = flipX !== flipY ? -1 : 1;
    const deltaDeg = (((a1 - a0) * 180) / Math.PI) * reflectionDirection;
    const rawRot = _rotateDragStartRot + deltaDeg;
    const now =
      typeof eventTimestamp === "number" &&
      Number.isFinite(eventTimestamp) &&
      eventTimestamp > 0
        ? eventTimestamp
        : typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
    const snapHelper =
      typeof window !== "undefined" &&
      window.RotationSnap &&
      typeof window.RotationSnap.resolveFlickRotation === "function"
        ? window.RotationSnap.resolveFlickRotation
        : typeof resolveFlickRotation === "function"
          ? resolveFlickRotation
          : null;
    let targetRot = rawRot;
    if (snapHelper) {
      const snapRes = snapHelper({
        rawAngleDeg: rawRot,
        timestampMs: now,
        prevRawAngleDeg: _rotatePrevRawRot,
        prevTimestampMs: _rotatePrevTimestamp,
        activeSnapTarget: _rotateSnapTarget,
        snapArmedUntilMs: _rotateSnapArmedUntil,
      });
      _rotateSnapTarget = snapRes.snapTarget;
      _rotateSnapArmedUntil = snapRes.snapArmedUntilMs;
      targetRot = snapRes.displayAngle;
    }
    rotateCanvasTo(targetRot, _rotateDragCX, _rotateDragCY);
    _rotatePrevRawRot = rawRot;
    _rotatePrevTimestamp = now;
  } else if (panning) {
    // panX/panY live inside the flip mirror (applied outside them in
    // applyTransform), so a screen-space mouse delta must be un-mirrored
    // (sign-flipped) before being added to them — otherwise dragging right
    // moves the canvas left whenever flipX (or flipY) is active.
    const fx = flipX ? -1 : 1,
      fy = flipY ? -1 : 1;
    panX = panSPX + fx * (clientX - panSX);
    panY = panSPY + fy * (clientY - panSY);
    applyTransform();
  }
}
function _spaceDragEnd() {
  if (panning) {
    panning = false;
    _writeNavigationCursor(canvasArea, "", "pan-end");
    _writeNavigationCursor(
      activeC,
      activeGroupId ? "not-allowed" : _baseCursorCSS(),
      "pan-end-active",
    );
  }
  if (_zoomDrag) {
    _zoomDrag = false;
    _writeNavigationCursor(canvasArea, "", "zoom-end");
    _writeNavigationCursor(
      activeC,
      activeGroupId ? "not-allowed" : _baseCursorCSS(),
      "zoom-end-active",
    );
  }
  if (_rotateDrag) {
    const settleTarget = _rotateSnapTarget;
    const settlePivotX = _rotateDragCX;
    const settlePivotY = _rotateDragCY;
    const currentRot = rotation;

    _rotateDrag = false;
    _rotateSnapTarget = null;
    _rotatePrevRawRot = null;
    _rotatePrevTimestamp = null;
    _rotateSnapArmedUntil = null;
    _writeNavigationCursor(canvasArea, "", "rotate-end");
    _writeNavigationCursor(
      activeC,
      activeGroupId ? "not-allowed" : _baseCursorCSS(),
      "rotate-end-active",
    );
    _updateRotPivotVisibility();

    if (settleTarget !== null && Number.isFinite(settleTarget)) {
      _startRotateSpringSettle(
        currentRot,
        settleTarget,
        settlePivotX,
        settlePivotY,
      );
    }
  }
}

// Mouse (and trackpad) — bound to window (capture) rather than just
// canvas-area so Space/Ctrl+Space/Shift+Space drag works anywhere in the
// app (timeline, status bar, empty space around the canvas, etc.), while
// _isNavBlocked() keeps it from engaging over dockers, floating panels,
// the toolbar/menu, modals, or other interactive controls.
window.addEventListener(
  "mousedown",
  (e) => {
    if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
    if (_isNavBlocked(e.target)) return;
    e.preventDefault();
    _spaceDragStartXY(e.clientX, e.clientY, e.ctrlKey);
  },
  { capture: true },
);
document.addEventListener("mousemove", (e) => {
  if (!panning && !_zoomDrag && !_rotateDrag) return;
  _spaceDragMove(e.clientX, e.clientY, e.timeStamp);
});
document.addEventListener("mouseup", () => {
  _spaceDragEnd();
});

// Pointer Events are the primary navigation path for both mouse and pen.
// Handling mouse here prevents a canvas pointerdown from suppressing the
// later compatibility mousedown before Ctrl+Space zoom can begin.
let _navPointerId = null;
window.addEventListener(
  "pointerdown",
  (e) => {
    const isMouse = e.pointerType === "mouse";
    const isPen = e.pointerType === "pen";
    const middleMouse = isMouse && e.button === 1;
    const primaryWithSpace = (isMouse || isPen) && spaceHeld && e.button === 0;
    if (!middleMouse && !primaryWithSpace) return;
    if (
      window.CameraView &&
      CameraView.active &&
      CameraView.beginPointerNavigation(e, e.ctrlKey || ctrlHeld)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (_isNavBlocked(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    _navPointerId = e.pointerId;
    if (e.target && e.target.setPointerCapture) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
    _spaceDragStartXY(e.clientX, e.clientY, e.ctrlKey || ctrlHeld);
  },
  { capture: true },
);
document.addEventListener("pointermove", (e) => {
  if (e.pointerId === _navPointerId && (panning || _zoomDrag || _rotateDrag)) {
    _spaceDragMove(e.clientX, e.clientY, e.timeStamp);
  }
});
function _endPointerNavigation(e) {
  if (_navPointerId == null || (e && e.pointerId !== _navPointerId)) return;
  _navPointerId = null;
  _spaceDragEnd();
}
document.addEventListener("pointerup", _endPointerNavigation);
document.addEventListener("pointercancel", _endPointerNavigation);
