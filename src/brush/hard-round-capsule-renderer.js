// src/brush/hard-round-capsule-renderer.js
//
// Phase 8C completion — the actual continuous capsule rasterizer for
// migrated Hard Round strokes.
//
// Consumes the render-ready segment object produced by
// HardRoundAdapter.resolveSegmentRenderParams():
//   { x0, y0, x1, y1, r0, r1, alpha0, alpha1, rgb, composite, hardness, aaMode }
//
// and paints ONE continuous tapered capsule directly into a 2D canvas
// context's pixel buffer, using the same analytic distance-field model as
// prototype/prototype.html's WebGPU shader (see hard-round-capsule-math.js
// for the ported math) -- NOT a re-walk of spaced circles, and NOT
// `_stampDab()`.
//
// This intentionally mirrors the existing `_dabAACpu` dab rasterizer's
// approach (getImageData over a bounded dirty rect, per-pixel analytic
// coverage, hand-rolled source-over / destination-out compositing,
// putImageData) -- same style, same compositing math, same target canvas
// -- so it reuses this app's existing per-pixel CPU rasterization
// technique rather than inventing a new one. The only thing that's new is
// the *shape* being rasterized (a continuous tapered capsule instead of a
// single circle).

'use strict';

(function (root) {
  const Math_ = (typeof module !== 'undefined' && module.exports)
    ? require('./hard-round-capsule-math.js')
    : root.HardRoundCapsuleMath;

  // Rasterize one render-ready segment onto `dc` (a CanvasRenderingContext2D).
  // Alpha is linearly interpolated between alpha0/alpha1 along the same `h`
  // parameter used for radius, so Flow/Opacity tapers continuously too.
  //
  // @param {CanvasRenderingContext2D} dc
  // @param {object} seg - see module doc above
  function drawHardRoundCapsuleCPU(dc, seg) {
    if (!dc || !seg) return;
    const { x0, y0, x1, y1, r0, r1, alpha0, alpha1, rgb, composite } = seg;
    const maxR = Math.max(r0, r1);
    if (!(maxR > 0)) return;
    const cw = dc.canvas.width, ch = dc.canvas.height;
    const b = Math_.capsuleBounds(x0, y0, x1, y1, r0, r1);
    const sx = Math.max(0, b.sx), sy = Math.max(0, b.sy);
    const ex = Math.min(cw, b.ex), ey = Math.min(ch, b.ey);
    const rw = ex - sx, rh = ey - sy;
    if (rw <= 0 || rh <= 0) return;

    const isErase = composite === 'erase';
    const cr = isErase ? 0 : rgb[0], cg = isErase ? 0 : rgb[1], cb = isErase ? 0 : rgb[2];

    const imgData = dc.getImageData(sx, sy, rw, rh);
    const d = imgData.data;
    let p = 0;
    for (let py = 0; py < rh; py++) {
      const wy = sy + py + 0.5;
      for (let px = 0; px < rw; px++, p += 4) {
        const wx = sx + px + 0.5;
        const axis = Math_.capsuleAxisDistance(wx, wy, x0, y0, x1, y1);
        const localRadius = axis.isRoundDab ? r0 : (r0 + (r1 - r0) * axis.h);
        const sdist = axis.isRoundDab ? (axis.dist - r0) : (axis.dist - localRadius);
        const cov = Math_.edgeCoverage(sdist, Math_.aaBand());
        if (cov <= 0) continue;
        const area = Math_.subpixelAreaFactor(localRadius, axis.isRoundDab);
        const segAlpha = alpha0 + (alpha1 - alpha0) * axis.h;
        let a = cov * area * segAlpha;
        a = Math.min(1, Math.max(0, a));
        if (a <= 0) continue;
        if (isErase) {
          // Matches globalCompositeOperation='destination-out'.
          d[p + 3] = d[p + 3] * (1 - a);
        } else {
          // Matches default 'source-over', same math as _dabAACpu.
          const da = d[p + 3] / 255;
          const outA = a + da * (1 - a);
          if (outA <= 0) {
            d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 0;
          } else {
            d[p]     = (cr * a + d[p]     * da * (1 - a)) / outA;
            d[p + 1] = (cg * a + d[p + 1] * da * (1 - a)) / outA;
            d[p + 2] = (cb * a + d[p + 2] * da * (1 - a)) / outA;
            d[p + 3] = outA * 255;
          }
        }
      }
    }
    dc.putImageData(imgData, sx, sy);
    return { sx, sy, rw, rh, radiusX: maxR + Math_.AA_MARGIN, radiusY: maxR + Math_.AA_MARGIN };
  }

  const HardRoundCapsuleRendererExports = { drawHardRoundCapsuleCPU };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HardRoundCapsuleRendererExports;
  }
  if (typeof window !== 'undefined') {
    window.HardRoundCapsuleRenderer = HardRoundCapsuleRendererExports;
  }
})(typeof window !== 'undefined' ? window : globalThis);
