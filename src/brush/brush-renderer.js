//
// BrushRenderer abstraction (Phase 1B — architecture refactor only)
//
// Goal of this file: separate "how a dab gets rasterized onto a Canvas2D
// context" from brush-engine.js, which remains solely responsible for
// brush LOGIC (stabilization, spacing, pressure, taper, scatter, geometry
// generation, brush-parameter computation). None of that logic lives here
// or moves here.
//
// This phase performs NO behavior change and NO WebGPU work. Every line of
// rendering code inside CpuBrushRenderer.drawDab() below is moved VERBATIM
// from brush-engine.js's _drawDabNow() — same functions, same arguments,
// same call order, same guard logic. See the Phase 1A investigation notes
// in brush-engine.js (_drawDabNow, _drawAutoHardRoundSegment, _dabAA,
// _dabAliased) for why this exact call sequence was chosen as the
// abstraction boundary: _drawDabNow is the single point every dab-producing
// code path (pointerdown's first dab, move-driven curve/segment walking,
// line/curve tools, airbrush timer ticks, taper replay) already converges
// on, and its dab descriptor `d` is already a clean, renderer-agnostic
// data structure.
//
// Interface contract:
//   BrushRenderer.drawDab(d) -> boolean
//     d: the existing dab descriptor {x,y,r,rgb,alpha,composite,rotation,roundness}
//        exactly as produced by _stampDab()/_queueDab() today — unchanged.
//     returns true if a dedicated segment-raster path (the currently-dormant
//     "auto hard round" bresenham fast path) consumed the dab instead of a
//     standalone stamp — mirrors what the inline `if(!_drawAutoHardRoundSegment(d))`
//     check in the old _drawDabNow did, so call-site control flow is
//     identical to before.
//   BrushRenderer.beginStroke() / endStroke()
//     Lifecycle no-ops for the CPU renderer in this phase. They exist so
//     _ensureStrokeCanvas()/_commitStrokeCanvas() can notify whichever
//     renderer is active without brush-engine.js needing to change again
//     when a future (Phase 2+) GPU renderer is introduced. The CPU
//     renderer's actual stroke-canvas allocation/commit logic is NOT moved
//     here — per the Phase 1B instructions, _ensureStrokeCanvas() and
//     _commitStrokeCanvas() keep doing exactly what they do today.
//
// Only CpuBrushRenderer exists in this phase. A future GpuHardRoundRenderer
// would implement the same drawDab(d)/beginStroke()/endStroke() contract
// and be swapped in via BrushRenderer.active — nothing else in
// brush-engine.js would need to change to support that swap.

const CpuBrushRenderer = {
  // Verbatim body of the old _drawDabNow() rasterization branch:
  //   if(!_drawAutoHardRoundSegment(d)){
  //     if(_currentAAMode()!=='none') _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  //     else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  //   }
  // _drawAutoHardRoundSegment, _currentAAMode, _dabAA, and _dabAliased all
  // still live in brush-engine.js (they are Canvas2D-context-bound
  // implementation detail, not part of the interface), and remain
  // reachable here because brush-engine.js and this file share the same
  // classic-script global scope (no bundler/module boundary exists in this
  // codebase today).
  drawDab(d){
    if(_drawAutoHardRoundSegment(d)) return true;
    if(_currentAAMode()!=='none') _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
    else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
    return false;
  },
  // No-ops in this phase — see file header. Intentionally do nothing so
  // that wiring these calls into _ensureStrokeCanvas()/_commitStrokeCanvas()
  // cannot change observable behavior.
  beginStroke(){},
  endStroke(){},
};

const BrushRenderer = {
  // Single active renderer. Phase 1B only ever sets/uses CpuBrushRenderer;
  // this indirection exists purely so a future renderer can be swapped in
  // without touching any call site in brush-engine.js.
  active: CpuBrushRenderer,
  drawDab(d){ return this.active.drawDab(d); },
  beginStroke(){ return this.active.beginStroke(); },
  endStroke(){ return this.active.endStroke(); },
};

window.CpuBrushRenderer = CpuBrushRenderer;
window.BrushRenderer = BrushRenderer;
