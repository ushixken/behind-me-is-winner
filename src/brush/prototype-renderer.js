// src/brush/prototype-renderer.js
//
// Phase 9B — extraction of the actual pixel-producing "renderer" half of
// prototype/prototype.html's WebGPU-branch stroke pipeline (the SS=4
// backing-store accumulation + box-filter resolve, lines ~195-863 of the
// prototype) into one self-contained module.
//
// Phase 9C wired this into production for Hard Round. Phase 9C.1 added
// peekStroke() (below) after runtime verification showed the migrated
// stroke was invisible while drawing -- prototype/prototype.html itself
// resolves-and-presents after every accumulated batch, not just at stroke
// end (see its present()/compositeStroke() calls), and this module had no
// way to do that without also ending the stroke. Public surface is now
// five methods:
//
//   beginStroke()
//   drawSegments(segments)
//   peekStroke()   -- Phase 9C.1: resolve the CURRENT accumulation for a
//                      live preview, without ending the stroke
//   endStroke()
//   cancelStroke()
//
// It internally owns:
//   - the SS=4 supersampled backing store
//   - per-stroke coverage accumulation (max-blend, same as the prototype's
//     `strokeMaskTex` + 'max' blend GPU pipeline)
//   - the resolve step (the prototype's 4x4 box-filter `blitShader`,
//     ported to a CPU-equivalent box downsample for the CPU path)
//   - a CPU rasterization path (always available)
//   - a GPU rasterization path (WebGPU, opt-in / best-effort, mirrors
//     hard-round-capsule-gpu.js's shader so both backends agree pixel-for-
//     pixel with the CPU path via hard-round-capsule-math.js)
//
// The only output is a finished canvas that `_commitStrokeCanvas()`
// already knows how to consume: a plain logical-resolution (non-
// supersampled) RGBA canvas holding this stroke's accumulated color +
// coverage, exactly like every other scratch stroke canvas this app
// already produces and hands to `_commitStrokeCanvas()`. peekStroke()
// returns that SAME canvas mid-stroke, already-resolved, for a live
// preview surface (e.g. _strokeCanvas) to draw.
//
// This module does NOT own (and must never import/touch):
//   - pointer events / DOM event wiring
//   - layers, undo, frames, timeline
//   - tool selection / brush presets / dynamics resolution
//   - `_commitStrokeCanvas()` or any other commit-pipeline call site
//
// Segment shape consumed by drawSegments() is the SAME render-ready
// segment object HardRoundAdapter.resolveSegmentRenderParams() already
// produces (see hard-round-adapter.js):
//   { x0, y0, x1, y1, r0, r1, alpha0, alpha1, rgb, composite, hardness, aaMode }
// Coordinates are expected in the SAME logical (non-supersampled) space as
// the renderer's configured width/height -- this module applies the SS
// scale internally, the same way the prototype's own `screenToCanvas`
// multiplied by SS before anything touched the backing store (this module
// does not reproduce screenToCanvas itself; that is a view/input concern
// owned elsewhere, per the same boundary prototype-stroke-core.js already
// documents).

'use strict';

(function (root) {
  const CapsuleMath = (typeof module !== 'undefined' && module.exports)
    ? require('./hard-round-capsule-math.js')
    : root.HardRoundCapsuleMath;

  const DEFAULT_SS = 4; // backing-store supersample factor, ported verbatim
                          // from prototype/prototype.html's `const SS = 4`.

  // ---------------------------------------------------------------------
  // CPU path
  //
  // Mirrors the GPU path's two stages exactly, just executed on the CPU:
  //   1. accumulate every segment's coverage into a single-channel,
  //      max-blended backing-store buffer (matches strokeMaskTex's
  //      `blend: { operation: 'max' }`).
  //   2. resolve: box-average every SSxSS block down to one logical pixel
  //      (matches blitShader's 4x4 box read), then paint that resolved
  //      coverage as this stroke's color into the output RGBA canvas.
  // ---------------------------------------------------------------------
  class CpuBackend {
    constructor(width, height, ss) {
      this.w = width;
      this.h = height;
      this.ss = ss;
      this.bw = width * ss;
      this.bh = height * ss;
      // CPU fallback storage is intentionally lazy. A GPU-ready Hard Round
      // stroke never touches this backend, so eagerly allocating ~126 MiB
      // at 1920x1080/SS=4 made renderer preparation itself a cold-start
      // hazard. reset() allocates it before the first real CPU stroke.
      this.coverage = null;
      this._resolvedAlpha = null;
      // Phase 9C.2: union of every drawSegment() bounding box (in
      // backing-store/SS-space pixels) accumulated since the dirty region
      // was last consumed by a resolve. Null means "nothing dirty". This
      // is exactly the bounding box drawSegment() already computes per
      // segment (via CapsuleMath.capsuleBounds) to know which pixels to
      // rasterize -- it was simply being discarded before; nothing new is
      // computed here, it's just retained.
      this._dirty = null;
      this._strokeDirty = null;
      // Phase 9E.9: stroke-level smoothed direction, used ONLY to pick the
      // x-dominant-vs-y-dominant axis in the floor-regime anisotropic test
      // (see hard-round-capsule-math.js's _dominantAxisPerpendicularDistance
      // doc comment). Persists across drawSegment() calls for the whole
      // stroke -- NOT per segment -- so a real curve's many short,
      // independently-noisy tessellated segments all agree on which axis
      // is dominant near a 45-degree tangent, instead of each one flipping
      // on its own tiny (and largely arbitrary, at that scale) dx/dy.
      this._axisHintDx = 0;
      this._axisHintDy = 0;
      // Phase 9E.11: replaceable, stroke-local winners for thin AA-Off
      // centerline stations. Ordinary coverage remains in `coverage`.
      this._stationWinners = new Map();
      this._winnerPixels = new Map();
      // Phase 9F.2: direction-independent spatial lanes for each axis /
      // station. Reversing over the same centerline finds the same lane
      // instead of creating a second permanent winner namespace.
      this._stationBuckets = new Map();
      this._nextStationLaneId = 1;
      this._coverageTileSize = 16;
      this._coverageTileCols = Math.ceil(this.bw / this._coverageTileSize);
      this._coverageFullCounts = new Uint16Array(this._coverageTileCols * Math.ceil(this.bh / this._coverageTileSize));
    }

    _ensureStorage() {
      if (this.coverage && this._resolvedAlpha) return false;
      this.coverage = new Float32Array(this.bw * this.bh);
      this._resolvedAlpha = new Uint8ClampedArray(this.w * this.h);
      if (typeof window !== 'undefined' && window.BrushDebugPerf && window.BrushPerfNote) {
        window.BrushPerfNote('hard-round-cpu-allocation', {
          bytes: this.coverage.byteLength + this._resolvedAlpha.byteLength,
        });
      }
      return true;
    }

    reset() {
      const allocated=this._ensureStorage();
      if(!allocated){this.coverage.fill(0);this._resolvedAlpha.fill(0);}
      this._dirty = null;
      this._strokeDirty = null;
      this._axisHintDx = 0;
      this._axisHintDy = 0;
      this._stationWinners.clear();
      this._winnerPixels.clear();
      this._stationBuckets.clear();
      this._nextStationLaneId = 1;
      this._coverageFullCounts.fill(0);
    }

    _markOutputPixelDirty(ox, oy) {
      const ss = this.ss;
      const sx = ox * ss, sy = oy * ss, ex = sx + ss, ey = sy + ss;
      this._unionDirtyBounds('_dirty',sx,sy,ex,ey);
      this._unionDirtyBounds('_strokeDirty',sx,sy,ex,ey);
    }

    _markBackingDirty(sx, sy, ex, ey) {
      if (ex <= sx || ey <= sy) return;
      this._unionDirtyBounds('_dirty',sx,sy,ex,ey);
      this._unionDirtyBounds('_strokeDirty',sx,sy,ex,ey);
    }

    _unionDirtyBounds(field,sx,sy,ex,ey) {
      if (!this[field]) this[field] = { sx, sy, ex, ey };
      else {
        if (sx < this[field].sx) this[field].sx = sx;
        if (sy < this[field].sy) this[field].sy = sy;
        if (ex > this[field].ex) this[field].ex = ex;
        if (ey > this[field].ey) this[field].ey = ey;
      }
    }

    getStrokeDirtyRegion() {
      const d=this._strokeDirty;if(!d)return null;const ss=this.ss;
      const x=Math.max(0,Math.floor(d.sx/ss)),y=Math.max(0,Math.floor(d.sy/ss));
      const ex=Math.min(this.w,Math.ceil(d.ex/ss)),ey=Math.min(this.h,Math.ceil(d.ey/ss));
      return ex>x&&ey>y?{x,y,width:ex-x,height:ey-y}:null;
    }

    _removeStationOwner(stationKey, winner) {
      const pixelKey = winner.oy * this.w + winner.ox;
      const owners = this._winnerPixels.get(pixelKey);
      if (!owners) return;
      owners.delete(stationKey);
      if (!owners.size) this._winnerPixels.delete(pixelKey);
      this._markOutputPixelDirty(winner.ox, winner.oy);
    }

    _setStationWinner(stationKey, candidate) {
      const previous = this._stationWinners.get(stationKey);
      const eps = 1e-12;
      candidate.contenders = previous ? (previous.contenders || 1) + 1 : 1;
      if (previous && (candidate.distance > previous.distance + eps ||
        (Math.abs(candidate.distance - previous.distance) <= eps &&
          (candidate.oy > previous.oy || (candidate.oy === previous.oy && candidate.ox >= previous.ox))))) {
        previous.contenders = candidate.contenders;
        return;
      }
      if (previous) this._removeStationOwner(stationKey, previous);
      this._stationWinners.set(stationKey, candidate);
      const pixelKey = candidate.oy * this.w + candidate.ox;
      let owners = this._winnerPixels.get(pixelKey);
      if (!owners) this._winnerPixels.set(pixelKey, owners = new Map());
      owners.set(stationKey, candidate.alpha);
      this._markOutputPixelDirty(candidate.ox, candidate.oy);
    }

    _submitStationCandidate(axis, station, candidate) {
      const bucketKey = axis + ':' + station;
      let lanes = this._stationBuckets.get(bucketKey);
      if (!lanes) this._stationBuckets.set(bucketKey, lanes = []);
      // Candidate pixels one row/column apart can represent the two
      // nearest raster choices for one subpixel centerline. Group by the
      // projected centerline itself, not travel direction or chosen pixel.
      let lane = null, bestDelta = Infinity;
      for (const item of lanes) {
        const delta = Math.abs(item.centerlineMinor - candidate.centerlineMinor);
        if (delta <= this.ss * 0.5 + 1e-9 && delta < bestDelta) {
          lane = item; bestDelta = delta;
        }
      }
      if (!lane) {
        lane = { key: 'lane:' + this._nextStationLaneId++, centerlineMinor: candidate.centerlineMinor };
        lanes.push(lane);
      }
      this._setStationWinner(lane.key, candidate);
      const winner = this._stationWinners.get(lane.key);
      if (winner) lane.centerlineMinor = winner.centerlineMinor;
    }

    // Rasterizes one render-ready segment's coverage into the backing
    // store at (x*ss, y*ss) scale, max-blended against whatever is
    // already accumulated there (never additive -- overlapping dabs in a
    // single stroke must not darken past one segment's own coverage,
    // matching the GPU pipeline's max blend op).
    drawSegment(seg) {
      // TEMP DIAGNOSTIC (Phase 11A.23): log exactly what CpuBackend
      // receives, in call order, before any of this function's own math
      // runs. Read-only -- appends to window.HardRoundSegmentLog.cpu only.
      if (typeof window !== 'undefined' && window.HardRoundSegmentLog) {
        if (!seg.__hrDebugId) seg.__hrDebugId = ++window.HardRoundSegmentLog._nextId;
        window.HardRoundSegmentLog.cpu.push({
          index: window.HardRoundSegmentLog.cpu.length,
          identity: seg.__hrDebugId,
          start: { x: seg.x0, y: seg.y0 },
          end: { x: seg.x1, y: seg.y1 },
          radius: { r0: seg.r0, r1: seg.r1 },
          alpha: { alpha0: seg.alpha0, alpha1: seg.alpha1 },
          composite: seg.composite,
          hardness: seg.hardness,
          aaMode: seg.aaMode,
          // Phase 11A.23 finding: render-ready segments (see
          // hard-round-adapter.js's resolveSegmentRenderParams()) no
          // longer carry a `pressure` field -- pressure was already
          // resolved into r0/r1/alpha0/alpha1 upstream, in
          // brush-engine.js's _hardRoundStampSegments(), before either
          // backend ever sees the segment. Logged as `undefined` here
          // rather than omitted so that fact is visible in the log
          // itself instead of silently absent.
          pressure: seg.pressure,
          isStrokeStart: !!seg.isStrokeStart,
          isStrokeEnd: !!seg.isStrokeEnd,
        });
      }
      const ss = this.ss;
      const x0 = seg.x0 * ss, y0 = seg.y0 * ss, x1 = seg.x1 * ss, y1 = seg.y1 * ss;
      const r0 = seg.r0 * ss, r1 = seg.r1 * ss;
      const alpha0 = seg.alpha0 == null ? 1 : seg.alpha0;
      const alpha1 = seg.alpha1 == null ? 1 : seg.alpha1;
      const b = CapsuleMath.capsuleBounds(x0, y0, x1, y1, r0, r1);
      const isAaOff = seg.aaMode === 'off' || seg.aaMode === 'none';
      // Phase 9E.4: whether this segment carries the stroke's true open
      // start/end (set by the caller -- see hard-round-adapter.js /
      // brush-engine.js's _hardRoundStampSegments) so the tip test below
      // can use the strict point test only there, not on every joint.
      const isFirstSegment = !!seg.isStrokeStart;
      const isLastSegment = !!seg.isStrokeEnd;
      // Phase 9E.9: update this stroke's smoothed axis-hint direction with
      // THIS segment's own raw (unquantized) vector, normalized so wildly
      // different segment lengths (dense curve dabs vs. a fast flick's
      // longer chords) don't skew the smoothing -- then blend it into the
      // running hint with a fixed weight. A real curve's tangent turns
      // gradually from one short segment to the next, so this hint tracks
      // it smoothly and crosses any axis boundary (45 degrees) exactly
      // ONCE for the whole stroke, instead of once per tiny segment.
      {
        const rawLen = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        if (rawLen > 1e-9) {
          const ndx = (x1 - x0) / rawLen, ndy = (y1 - y0) / rawLen;
          const w = 0.25; // smoothing weight -- see comment above
          if (this._axisHintDx === 0 && this._axisHintDy === 0) {
            this._axisHintDx = ndx; this._axisHintDy = ndy;
          } else {
            this._axisHintDx = this._axisHintDx * (1 - w) + ndx * w;
            this._axisHintDy = this._axisHintDy * (1 - w) + ndy * w;
          }
        }
      }
      // 9E.3: pixelCoveredByCapsule()'s conservative half-diagonal test
      // reaches slightly further out than an exact d<=0 test (see below),
      // so the bounding box needs the same extra margin or blocks right
      // at the edge of the plain AA_MARGIN bbox get PARTIALLY filled
      // (clipped mid-block by this bbox) instead of uniformly -- which
      // would silently reintroduce fractional/gray resolved pixels right
      // where 9E.2 was trying to eliminate them.
      const extraMargin = isAaOff ? Math.ceil(ss * Math.SQRT1_2) : 0;
      const sx = Math.max(0, b.sx - extraMargin), sy = Math.max(0, b.sy - extraMargin);
      const ex = Math.min(this.bw, b.ex + extraMargin), ey = Math.min(this.bh, b.ey + extraMargin);
      if (ex <= sx || ey <= sy) return;

      const cov = this.coverage;
      const bw = this.bw;
      // Phase 10.0: max blending can never increase a sample already at
      // least max(alpha0,alpha1), because capsule coverage is <=1 and the
      // interpolated segment alpha cannot exceed that endpoint maximum.
      // Skip those saturated samples before any distance/SDF math.
      const maxSegmentAlpha = Math.max(alpha0, alpha1);
      const maxStoredAlpha = Math.fround(maxSegmentAlpha);
      // Phase 9E.2/9E.3: AA Off must resolve to a TRUE binary output pixel
      // that is also always CONNECTED (no dropout on thin/fast-tapering
      // strokes). resolveInto()/resolveDirtyInto() box-average every ss x
      // ss block of the backing store down to one output pixel (§ SS=4
      // resolve, unmodified -- see below), so even with capsuleCoverage()
      // itself returning a hard 0/1 per subpixel, independently sampling
      // all 16 subpixels of a block still produces fractional counts
      // (e.g. 6/16) wherever the edge crosses that block diagonally --
      // the "still gray" bug 9E.2 fixed. The fix is NOT to touch the
      // resolve's box-filter math (kept identical for every aaMode) but
      // to make every subpixel *within one output pixel's block agree*:
      // sample ONCE at that output pixel's own center, then fill its
      // whole ss x ss block with that single binary value -- a uniform
      // block box-averages to exactly that value, so the resolved output
      // is always exactly 0.0 or 1.0.
      //
      // 9E.3: that single center-point sample, by itself, can miss a
      // capsule whose radius has shrunk below ~half a pixel (a fast
      // flick's release tail) if it threads between pixel centers along a
      // shallow diagonal -- producing a dotted/gapped tail. Use
      // pixelCoveredByCapsule() (conservative pixel-square vs capsule
      // test, see hard-round-capsule-math.js) instead of an exact d<=0
      // point test, so any pixel the capsule visibly sweeps through --
      // not only ones whose exact center it crosses -- gets filled.
      // Every block this loop visits is filled OVER ITS FULL EXTENT
      // (clamped only to the canvas, never to sx/sy/ex/ey -- that bbox
      // already has extraMargin baked in above precisely so no block gets
      // cut off mid-way and left non-uniform).
      if (isAaOff) {
        const ss = this.ss;
        const obx0 = Math.floor(sx / ss), oby0 = Math.floor(sy / ss);
        const obx1 = Math.ceil(ex / ss), oby1 = Math.ceil(ey / ss);
        for (let oy = oby0; oy < oby1; oy++) {
          const by0 = oy * ss, by1 = Math.min(this.bh, by0 + ss);
          if (by1 <= 0 || by0 >= this.bh) continue;
          const wy = by0 + ss * 0.5; // output pixel's center, in backing-store units
          for (let ox = obx0; ox < obx1; ox++) {
            const bx0 = ox * ss, bx1 = Math.min(this.bw, bx0 + ss);
            if (bx1 <= 0 || bx0 >= this.bw) continue;
            let blockSaturated = true;
            for (let py = Math.max(0, by0); py < Math.min(this.bh, by1) && blockSaturated; py++) {
              const rowOff = py * bw;
              for (let px = Math.max(0, bx0); px < Math.min(this.bw, bx1); px++) {
                if (cov[rowOff + px] < maxStoredAlpha) { blockSaturated = false; break; }
              }
            }
            if (blockSaturated) continue;
            const wx = bx0 + ss * 0.5;
            const axis = CapsuleMath.capsuleAxisDistance(wx, wy, x0, y0, x1, y1);
            const stationCandidate = CapsuleMath.floorRegimeStationCandidate(
              wx, wy, x0, y0, r0, x1, y1, r1, ss, isFirstSegment, isLastSegment,
              this._axisHintDx, this._axisHintDy
            );
            if (stationCandidate) {
              if (stationCandidate.accepted) {
                const segAlpha = alpha0 + (alpha1 - alpha0) * axis.h;
                const station = stationCandidate.majorAxis === 'x' ? ox : oy;
                this._submitStationCandidate(stationCandidate.majorAxis, station, {
                  ox, oy, alpha: segAlpha, distance: stationCandidate.centerlineDistanceSq,
                  centerlineMinor: stationCandidate.centerlineMinor,
                });
              }
              continue;
            }
            const cov01 = CapsuleMath.pixelCoveredByCapsuleForStroke(
              wx, wy, x0, y0, r0, x1, y1, r1, ss, isFirstSegment, isLastSegment,
              this._axisHintDx, this._axisHintDy
            );
            if (cov01 <= 0) continue;
            const segAlpha = alpha0 + (alpha1 - alpha0) * axis.h;
            const c = cov01 * segAlpha;
            if (c <= 0) continue;
            const fillY0 = Math.max(0, by0), fillY1 = Math.min(this.bh, by1);
            const fillX0 = Math.max(0, bx0), fillX1 = Math.min(this.bw, bx1);
            let changed = false;
            for (let py = fillY0; py < fillY1; py++) {
              const rowOff = py * bw;
              for (let px = fillX0; px < fillX1; px++) {
                const idx = rowOff + px;
                const next = Math.fround(c);
                if (next > cov[idx]) { cov[idx] = next; changed = true; }
              }
            }
            if (changed) this._markOutputPixelDirty(ox, oy);
          }
        }
        return;
      }
      let changedSx = ex, changedSy = ey, changedEx = sx, changedEy = sy;
      const tileSize = this._coverageTileSize, tileCols = this._coverageTileCols;
      const fullCounts = this._coverageFullCounts;
      const maxAaBand = CapsuleMath.aaBand(r0, r1, x0, y0, x1, y1) * CapsuleMath.aaModeScale(seg.aaMode);
      const maxCoverageRadius = Math.max(r0, r1) + maxAaBand * 0.5;
      const guaranteedOpaqueCoreRadius = Math.min(r0, r1) - maxAaBand * 0.5;
      for (let tileY = Math.floor(sy / tileSize); tileY <= Math.floor((ey - 1) / tileSize); tileY++) {
        const py0 = Math.max(sy, tileY * tileSize), py1 = Math.min(ey, (tileY + 1) * tileSize);
        for (let tileX = Math.floor(sx / tileSize); tileX <= Math.floor((ex - 1) / tileSize); tileX++) {
          const px0 = Math.max(sx, tileX * tileSize), px1 = Math.min(ex, (tileX + 1) * tileSize);
          const tileW = Math.min(tileSize, this.bw - tileX * tileSize);
          const tileH = Math.min(tileSize, this.bh - tileY * tileSize);
          const tileIndex = tileY * tileCols + tileX;
          if (fullCounts[tileIndex] === tileW * tileH) continue;
          // Conservative tile rejection: every sample in the tile lies
          // within its center's half diagonal. If even that expanded
          // circle cannot reach the capsule's maximum radius + AA band,
          // every per-pixel coverage result is provably zero.
          const tileCenterX = tileX * tileSize + tileW * 0.5;
          const tileCenterY = tileY * tileSize + tileH * 0.5;
          const tileHalfDiag = Math.hypot(tileW, tileH) * 0.5;
          const tileAxisDistance = CapsuleMath.capsuleAxisDistance(tileCenterX, tileCenterY, x0, y0, x1, y1).dist;
          if (tileAxisDistance > maxCoverageRadius + tileHalfDiag) continue;
          // For an opaque constant-alpha segment, a tile wholly inside the
          // guaranteed coverage=1 core has one exact result for every
          // sample. Bulk-fill its rows instead of repeating identical SDF,
          // sqrt, interpolation, and max-blend work per backing pixel.
          if (maxStoredAlpha >= 1 && alpha0 === 1 && alpha1 === 1 &&
              tileAxisDistance + tileHalfDiag <= guaranteedOpaqueCoreRadius) {
            for (let py = py0; py < py1; py++) cov.fill(1, py * bw + px0, py * bw + px1);
            fullCounts[tileIndex] = tileW * tileH;
            if (px0 < changedSx) changedSx = px0;
            if (py0 < changedSy) changedSy = py0;
            if (px1 > changedEx) changedEx = px1;
            if (py1 > changedEy) changedEy = py1;
            continue;
          }
          for (let py = py0; py < py1; py++) {
            const wy = py + 0.5;
            const rowOff = py * bw;
            for (let px = px0; px < px1; px++) {
              const wx = px + 0.5;
              const idx = rowOff + px;
              if (cov[idx] >= maxStoredAlpha) continue;
              // Hard Round pressure normally changes radius while alpha is
              // constant. capsuleCoverage() already computes the axis
              // projection internally, so only compute a separate one when
              // alpha actually needs h interpolation.
              const axis = alpha0 === alpha1 ? null : CapsuleMath.capsuleAxisDistance(wx, wy, x0, y0, x1, y1);
          // Phase 9E.1: seg.aaMode (Off/Weak/Medium/Strong) now actually
          // reaches the rasterizer -- see hard-round-capsule-math.js's
          // aaModeScale for the width progression this drives.
              const cov01 = CapsuleMath.capsuleCoverage(wx, wy, x0, y0, r0, x1, y1, r1, seg.aaMode);
              if (cov01 <= 0) continue;
          // Alpha (Flow/Opacity) is interpolated along the same `h` param
          // as radius, then folded into the accumulated value -- matches
          // the GPU fragment shader's `in.alpha * cov * subpixelArea`
          // (see hard-round-capsule-gpu.js's STROKE_SHADER_WGSL `fs`).
              const segAlpha = axis ? alpha0 + (alpha1 - alpha0) * axis.h : alpha0;
              const next = Math.fround(cov01 * segAlpha);
              if (next <= 0) continue;
              if (next > cov[idx]) {
                const wasFull = cov[idx] >= 1;
                cov[idx] = next; // max blend, matches GPU strokeMaskTex
                if (!wasFull && next >= 1) fullCounts[tileIndex]++;
                if (px < changedSx) changedSx = px;
                if (py < changedSy) changedSy = py;
                if (px + 1 > changedEx) changedEx = px + 1;
                if (py + 1 > changedEy) changedEy = py + 1;
              }
            }
          }
        }
      }
      this._markBackingDirty(changedSx, changedSy, changedEx, changedEy);
    }

    // Box-downsamples the backing store by `ss` and paints the resolved
    // coverage as flat `rgb`/`alpha` into `outCtx` (a 2D context sized
    // w x h), matching the prototype's blitShader box filter followed by
    // its per-pixel color mix. `composite === 'erase'` paints coverage into
    // the alpha channel only (color left transparent-black), which is the
    // same shape existing erase-mode scratch canvases in this app already
    // use -- the caller (a future integration, not this phase) decides how
    // to composite that onto a layer.
    resolveInto(outCtx, rgb, composite) {
      this._resolveRegion(outCtx, rgb, composite, 0, 0, this.w, this.h);
      this._dirty = null;
    }

    // Phase 9C.2: same box-filter/color-mix math as resolveInto(), but
    // restricted to the accumulated dirty region (union of every
    // drawSegment() bbox since the last resolve) instead of the whole
    // w x h output. Returns false and does nothing if nothing is dirty
    // (e.g. a peek requested before any segment has been drawn this
    // frame) -- callers should treat that as "output already correct,
    // nothing new to paint". Consumes (clears) the dirty region on return.
    resolveDirtyInto(outCtx, rgb, composite) {
      const d = this._dirty;
      if (!d) return false;
      const ss = this.ss;
      // Backing-store pixel bounds -> output pixel bounds: floor/ceil so
      // every output pixel that reads ANY touched backing-store pixel in
      // its ssxss block is included, even at the dirty region's edges.
      const ox0 = Math.max(0, Math.floor(d.sx / ss));
      const oy0 = Math.max(0, Math.floor(d.sy / ss));
      const ox1 = Math.min(this.w, Math.ceil(d.ex / ss));
      const oy1 = Math.min(this.h, Math.ceil(d.ey / ss));
      this._dirty = null;
      if (ox1 <= ox0 || oy1 <= oy0) return false;
      this._resolveRegion(outCtx, rgb, composite, ox0, oy0, ox1 - ox0, oy1 - oy0);
      return { x: ox0, y: oy0, width: ox1 - ox0, height: oy1 - oy0 };
    }

    // Shared box-filter/color-mix core for both resolveInto() (full
    // canvas) and resolveDirtyInto() (a sub-rectangle) -- identical math
    // to the original resolveInto() body, just parameterized over which
    // output-pixel rectangle to iterate and where to putImageData it, so
    // the two never risk producing different pixel values for the same
    // coverage data.
    _resolveRegion(outCtx, rgb, composite, ox, oy, ow, oh) {
      const timingEnabled = typeof window !== 'undefined' && !!window.HardRoundDebugSmartPointerupTiming;
      const timingStart = timingEnabled ? performance.now() : 0;
      const ss = this.ss, bw = this.bw;
      const cov = this.coverage;
      const img = outCtx.createImageData(ow, oh);
      const imageDataMs = timingEnabled ? performance.now() - timingStart : 0;
      const d = img.data;
      const isErase = composite === 'erase';
      const cr = isErase ? 0 : rgb[0], cg = isErase ? 0 : rgb[1], cb = isErase ? 0 : rgb[2];
      const norm = 1 / (ss * ss);
      let p = 0;
      for (let y = 0; y < oh; y++) {
        const srcY = (oy + y) * ss;
        for (let x = 0; x < ow; x++, p += 4) {
          const srcX = (ox + x) * ss;
          let sum = 0;
          for (let by = 0; by < ss; by++) {
            const rowOff = (srcY + by) * bw + srcX;
            for (let bx = 0; bx < ss; bx++) sum += cov[rowOff + bx];
          }
          let winnerAlpha = 0;
          const owners = this._winnerPixels.get((oy + y) * this.w + (ox + x));
          if (owners) for (const alpha of owners.values()) if (alpha > winnerAlpha) winnerAlpha = alpha;
          const a = Math.max(0, Math.min(1, Math.max(sum * norm, winnerAlpha)));
          this._resolvedAlpha[(oy+y)*this.w+ox+x]=Math.round(a*255);
          d[p] = cr; d[p + 1] = cg; d[p + 2] = cb; d[p + 3] = Math.round(a * 255);
        }
      }
      const loopMs = timingEnabled ? performance.now() - timingStart - imageDataMs : 0;
      const putStarted = timingEnabled ? performance.now() : 0;
      outCtx.putImageData(img, ox, oy);
      if (timingEnabled) {
        const entry={width:ow,height:oh,pixels:ow*oh,backingSamples:ow*oh*ss*ss,imageDataMs,resolveLoopMs:loopMs,putImageDataMs:performance.now()-putStarted,totalMs:performance.now()-timingStart};
        const log=window.HardRoundCpuResolveTimingLog||(window.HardRoundCpuResolveTimingLog=[]);log.push(entry);if(log.length>20)log.shift();
      }
    }

    copyResolvedMaskRegion(rect,rgb,composite) {
      if(!rect)return null;const x=Math.max(0,Math.floor(rect.x)),y=Math.max(0,Math.floor(rect.y));
      const width=Math.max(0,Math.min(this.w-x,Math.ceil(rect.width==null?rect.w:rect.width))),height=Math.max(0,Math.min(this.h-y,Math.ceil(rect.height==null?rect.h:rect.height)));
      if(!width||!height)return null;const data=new Uint8ClampedArray(width*height*4),erase=composite==='erase';
      const cr=erase?0:rgb[0],cg=erase?0:rgb[1],cb=erase?0:rgb[2];let p=0;
      for(let row=0;row<height;row++){let source=(y+row)*this.w+x;for(let col=0;col<width;col++,source++,p+=4){data[p]=cr;data[p+1]=cg;data[p+2]=cb;data[p+3]=this._resolvedAlpha[source];}}
      return data;
    }
  }

  // ---------------------------------------------------------------------
  // GPU path
  //
  // Same accumulation-texture + resolve-shader structure as prototype's
  // WebGPU branch (accTex replaced here by a coverage-only strokeMaskTex,
  // since composing onto a base layer is explicitly NOT this module's
  // job -- see module doc above). Shares its shader source with
  // hard-round-capsule-gpu.js so CPU/GPU stay pixel-identical (§7 in that
  // module's doc comment). Best-effort / opt-in, same status as
  // hard-round-capsule-gpu.js: not runtime-verified outside a browser with
  // WebGPU, and never the only path -- isAvailable() gates every call site.
  // ---------------------------------------------------------------------
  let _hardRoundGpuPresenterPromise = null;
  class HardRoundGpuPresenter {
    constructor() {
      this.device = null;
      this.canvas = null;
      this.context = null;
      this.format = null;
      this.ready = false;
      this.lost = false;
      this.configureCount = 0;
      this._pipelines = new Map();
    }

    static acquire(width, height) {
      if (!_hardRoundGpuPresenterPromise) {
        const presenter = new HardRoundGpuPresenter();
        _hardRoundGpuPresenterPromise = presenter.init(width, height).then(ok => ok ? presenter : null);
      }
      return _hardRoundGpuPresenterPromise.then(presenter => {
        if (presenter) presenter.ensureSize(width, height);
        return presenter;
      });
    }

    async init(width, height) {
      if (typeof navigator === 'undefined' || !navigator.gpu) return false;
      if (typeof window !== 'undefined' && window.DisplayBackend) {
        if (!window.DisplayBackend.device && typeof window.DisplayBackend.initialize === 'function') {
          try { await window.DisplayBackend.initialize(); } catch (_) {}
        }
        if (window.DisplayBackend.device) {
          this.device = window.DisplayBackend.device;
        }
      }
      if (!this.device) {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return false;
        this.device = await adapter.requestDevice();
      }
      this.canvas = document.getElementById('hard-round-gpu-overlay') || document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) return false;
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
      if(typeof window!=='undefined'&&window.BrushDebugPerf&&window.BrushPerfNote)window.BrushPerfNote('hard-round-overlay-configured');
      this.configureCount++;
      this.ready = true;
      this.device.lost.then(() => {
        this.ready = false;
        this.lost = true;
        if (_hardRoundGpuPresenterPromise) _hardRoundGpuPresenterPromise = null;
      }).catch(() => {});
      return true;
    }

    ensureSize(width, height) {
      if (!this.canvas) return;
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
    }

    pipelineFor(ss) {
      if (this._pipelines.has(ss)) return this._pipelines.get(ss);
      const shader = this.device.createShaderModule({ code: PRESENT_SHADER_WGSL(ss) });
      const pipeline = this.device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs' },
        fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
      this._pipelines.set(ss, pipeline);
      return pipeline;
    }
  }

  class GpuBackend {
    constructor(width, height, ss) {
      this.w = width;
      this.h = height;
      this.ss = ss;
      this.bw = width * ss;
      this.bh = height * ss;
      this.device = null;
      this.strokePipeline = null;
      this.blitPipeline = null;
      this.strokeMaskTex = null;
      this.strokeUniformBuf = null;
      this.strokeBindGroup = null;
      this.blitBindGroup = null;
      this.vertexBuf = null;
      this.pendingVerts = [];
      this.ready = false;
      this.outputCanvas = null;
      this.outputContext = null;
      this.presentPipeline = null;
      this.presentUniformBuf = null;
      this.presentBindGroup = null;
      this.presenter = null;
    }

    // Lazily creates its own device/textures. Callers must not assume this
    // succeeds -- always check isAvailable() before relying on the GPU
    // path; the CPU path is the source of truth this phase.
    async init() {
      if (this.ready) return true;
      if (typeof navigator === 'undefined' || !navigator.gpu) return false;
      const brushPerfInitStart=(typeof window!=='undefined'&&window.BrushDebugPerf)?performance.now():0;
      try {
        const presenter = await HardRoundGpuPresenter.acquire(this.w, this.h);
        if (!presenter || !presenter.ready) return false;
        this.presenter = presenter;
        const device = presenter.device;
        this.device = device;
        this.outputCanvas = presenter.canvas;
        this.outputContext = presenter.context;
        const outputFormat = presenter.format;
        this.outputFormat = outputFormat;
        // Phase 11B.9 TEMP DIAGNOSTIC (opt-in, default off): record this
        // (re)configure at the presentation boundary. This module only
        // calls configure() here, once, inside init() -- so a second entry
        // in the log for the same renderer instance would itself be
        // evidence worth investigating. Guarded so it's a no-op unless
        // brush-engine.js's window.HardRoundDebugPresentationBoundary flag
        // is on and its logger happens to be loaded first; wrapped in
        // try/catch so a missing global can never break real init().
        if (typeof window !== 'undefined' && window.HardRoundDebugPresentationBoundary) {
          try {
            console.log('[11B.9 OUTPUT-CONTEXT-CONFIGURE]', {
              timestamp: performance.now(),
              outputFormat,
              canvasWidth: this.outputCanvas.width,
              canvasHeight: this.outputCanvas.height,
              isConnected: this.outputCanvas.isConnected,
            });
          } catch (_) {}
        }
        // Phase 11B.4 TEMP DIAGNOSTIC: bump whenever the output context is
        // (re)configured. This module only calls configure() here, once,
        // inside init() -- so under normal operation this should never
        // change again for the lifetime of a renderer instance. Read by
        // present()'s diagnostic to catch an external reconfigure (e.g. a
        // canvas resize elsewhere in the app) coinciding with a stall.
        this._contextConfigGeneration = (this._contextConfigGeneration || 0) + 1;

        const shaderModule = device.createShaderModule({ code: STROKE_SHADER_WGSL });
        this.strokePipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: shaderModule, entryPoint: 'vs',
            buffers: [{
              arrayStride: 48,
              attributes: [
                { format: 'float32x2', offset: 0, shaderLocation: 0 },
                { format: 'float32x2', offset: 8, shaderLocation: 1 },
                { format: 'float32x2', offset: 16, shaderLocation: 2 },
                { format: 'float32', offset: 24, shaderLocation: 3 },
                { format: 'float32', offset: 28, shaderLocation: 4 },
                { format: 'float32', offset: 32, shaderLocation: 5 },
                { format: 'float32', offset: 36, shaderLocation: 6 },
                { format: 'float32', offset: 40, shaderLocation: 7 },
                { format: 'float32', offset: 44, shaderLocation: 8 },
              ],
            }],
          },
          fragment: {
            module: shaderModule, entryPoint: 'fs',
            targets: [{
              format: 'r8unorm',
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
                alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
              },
            }],
          },
          primitive: { topology: 'triangle-list' },
        });
        this.strokeUniformBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.strokeBindGroup = device.createBindGroup({
          layout: this.strokePipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: this.strokeUniformBuf } }],
        });
        this.strokeMaskTex = device.createTexture({
          size: [this.bw, this.bh], format: 'r8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.vertexBuf = device.createBuffer({
          size: 4 * 1024 * 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        const blitShader = device.createShaderModule({ code: RESOLVE_SHADER_WGSL(this.ss) });
        this.blitPipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module: blitShader, entryPoint: 'vs' },
          fragment: { module: blitShader, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
          primitive: { topology: 'triangle-list' },
        });
        this.blitBindGroup = device.createBindGroup({
          layout: this.blitPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: this.strokeMaskTex.createView() }],
        });

        this.presentPipeline = presenter.pipelineFor(this.ss);
        this.presentUniformBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.presentBindGroup = device.createBindGroup({
          layout: this.presentPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.strokeMaskTex.createView() },
            { binding: 1, resource: { buffer: this.presentUniformBuf } },
          ],
        });

        this.ready = true;
        if(typeof window!=='undefined'&&window.BrushDebugPerf&&window.BrushPerfNote)window.BrushPerfNote('hard-round-gpu-resources',{pipeline:true,buffers:3,textures:1});
        if(brushPerfInitStart&&window.BrushPerfNote)window.BrushPerfNote('gpu-init',{ms:performance.now()-brushPerfInitStart,first:true});
        return true;
      } catch (err) {
        this.ready = false;
        if(brushPerfInitStart&&window.BrushPerfNote)window.BrushPerfNote('gpu-init',{ms:performance.now()-brushPerfInitStart,first:true});
        return false;
      }
    }

    isAvailable() {
      return this.ready;
    }

    reset() {
      if (!this.ready) return;
      // Phase 11B.4 TEMP DIAGNOSTIC: bump a generation counter every time
      // strokeMaskTex is cleared (real bookkeeping already done by this
      // method -- beginStroke()/cancelStroke() are its only callers). Read
      // by present()'s diagnostic above to detect whether a NEW stroke
      // reset strokeMaskTex out from under a still-in-flight present() from
      // the PREVIOUS stroke.
      this._maskResetGeneration = (this._maskResetGeneration || 0) + 1;
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.strokeMaskTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }

    drawSegment(seg) {
      // TEMP DIAGNOSTIC (Phase 11A.23): log exactly what GpuBackend
      // receives, in call order, before any of this function's own vertex
      // math runs. Read-only -- appends to window.HardRoundSegmentLog.gpu
      // only; does not touch pendingVerts, the vertex buffer, or the
      // shader pipeline.
      if (typeof window !== 'undefined' && window.HardRoundSegmentLog) {
        if (!seg.__hrDebugId) seg.__hrDebugId = ++window.HardRoundSegmentLog._nextId;
        window.HardRoundSegmentLog.gpu.push({
          index: window.HardRoundSegmentLog.gpu.length,
          identity: seg.__hrDebugId,
          start: { x: seg.x0, y: seg.y0 },
          end: { x: seg.x1, y: seg.y1 },
          radius: { r0: seg.r0, r1: seg.r1 },
          alpha: { alpha0: seg.alpha0, alpha1: seg.alpha1 },
          composite: seg.composite,
          hardness: seg.hardness,
          aaMode: seg.aaMode,
          pressure: seg.pressure,
          isStrokeStart: !!seg.isStrokeStart,
          isStrokeEnd: !!seg.isStrokeEnd,
        });
      }
      const ss = this.ss;
      // Phase 9E.1: pass the same aaModeScale() the CPU backend applies
      // (via capsuleCoverage) as a per-vertex attribute, so the GPU
      // fragment shader widens/narrows its fwidth(d)-based band by the
      // identical factor -- CPU and GPU interpret aaMode consistently.
      const aaScale = CapsuleMath.aaModeScale(seg.aaMode);
      const isAaOff = seg.aaMode === 'off' || seg.aaMode === 'none';
      const verts = segmentVerts(
        seg.x0 * ss, seg.y0 * ss, seg.x1 * ss, seg.y1 * ss,
        seg.r0 * ss, seg.r1 * ss, seg.alpha0, seg.alpha1, aaScale, isAaOff ? 1 : 0
      );
      this.pendingVerts.push.apply(this.pendingVerts, verts);
    }

    flush() {
      if (!this.ready || !this.pendingVerts.length) { this.pendingVerts = []; return; }
      const data = new Float32Array(this.pendingVerts);
      const bytesNeeded = data.byteLength;
      if (bytesNeeded > this.vertexBuf.size) {
        this.vertexBuf.destroy();
        let sz = this.vertexBuf.size;
        while (sz < bytesNeeded) sz *= 2;
        this.vertexBuf = this.device.createBuffer({ size: sz, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      }
      this.device.queue.writeBuffer(this.vertexBuf, 0, data);
      const uniforms = new Float32Array([this.bw, this.bh, this.ss, 0, 0, 0, 0, 0]);
      this.device.queue.writeBuffer(this.strokeUniformBuf, 0, uniforms);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.strokeMaskTex.createView(), loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this.strokePipeline);
      pass.setBindGroup(0, this.strokeBindGroup);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.draw(data.length / 12);
      pass.end();
      this.device.queue.submit([enc.finish()]);
      if(typeof window!=='undefined'&&window.BrushDebugPerf&&window.BrushPerfNote)window.BrushPerfNote('gpu-work',{instances:data.length/72,batches:1,drawCalls:1});
      this.pendingVerts = [];
    }

    // Prototype-equivalent live presentation: resolve SS=4 and color the
    // coverage directly into a WebGPU canvas. Unlike resolveInto(), this
    // performs no texture-to-buffer copy, mapAsync stall, ImageData
    // allocation, JavaScript pixel loop, or Canvas2D upload.
    async present(rgb, composite, opacity, meta) {
      if (!this.ready || !this.presenter || !this.presenter.ready || !this.outputContext) {
        return { presented: false, reason: 'presenter-unavailable', canvas: this.outputCanvas };
      }
      if (meta && meta.strokeId != null && typeof window !== 'undefined' &&
          window.HardRoundOverlayOwnerStrokeId != null &&
          meta.strokeId !== window.HardRoundOverlayOwnerStrokeId) {
        return { presented: false, reason: 'not-overlay-owner', canvas: this.outputCanvas };
      }
      const isErase = composite === 'erase';
      const cr = isErase ? 0 : rgb[0] / 255;
      const cg = isErase ? 0 : rgb[1] / 255;
      const cb = isErase ? 0 : rgb[2] / 255;
      const strokeOpacity = Math.max(0, Math.min(1, opacity == null ? 1 : opacity));
      // --- DIAGNOSTIC (Phase 11A.39): opt-in (window.HardRoundGpuPresentDiag),
      // read-only instrumentation at the REAL present() call site. The
      // out-of-order-preview hypothesis has already been ruled out
      // (provesOutOfOrderCompletion: false); this exists solely to check
      // whether the fast-stroke blink/cut instead correlates with GPU
      // presentation backlog/stalls -- i.e. the submit->onSubmittedWorkDone
      // duration, and how many other present() calls are in flight at once.
      // Purely additive bookkeeping around the existing submit/fence calls
      // below. Does NOT change rendering behavior, ordering, throttling,
      // pressure, stabilization, AA, shaders, commit, pointerup, or segment
      // generation.
      const _diagOn = typeof window !== 'undefined' && !!window.HardRoundGpuPresentDiag;
      let _diagEntry = null;
      if (_diagOn) {
        if (!window.HardRoundGpuPresentLog) window.HardRoundGpuPresentLog = [];
        GpuBackend._presentIdCounter = (GpuBackend._presentIdCounter || 0) + 1;
        GpuBackend._inFlightCount = GpuBackend._inFlightCount || 0;
        _diagEntry = {
          presentationId: GpuBackend._presentIdCounter,
          strokeId: (meta && meta.strokeId != null) ? meta.strokeId : null,
          segmentCount: (meta && meta.segmentCount != null) ? meta.segmentCount : null,
          canvasWidth: this.w,
          canvasHeight: this.h,
          enterPresentTime: performance.now(),
          beforeSubmitTime: null,
          afterSubmitTime: null,
          workDoneTime: null,
          submitToWorkDoneMs: null,
          // Other present() calls already between their own submit() and
          // onSubmittedWorkDone() resolution at the moment THIS call
          // entered present() -- i.e. concurrently in-flight GPU work.
          otherPresentsInFlightAtEnter: GpuBackend._inFlightCount,
          // --- Phase 11B.4 additions below: fine-grained stage timing and
          // swapchain/context state, requested to answer questions 1-3, 7-8
          // (does a stalled present clear/replace visible content early,
          // is getCurrentTexture()/context reconfiguration involved, does
          // strokeMaskTex stay intact, is there a full-canvas clear/resize).
          // All read-only: these read existing state or timestamps around
          // existing calls, they do not add any new GPU work or change
          // ordering.
          beforeGetCurrentTextureTime: null,
          afterGetCurrentTextureTime: null,
          getCurrentTextureMs: null,
          beforeRenderPassTime: null,
          outputCanvasWidthBefore: this.outputCanvas ? this.outputCanvas.width : null,
          outputCanvasHeightBefore: this.outputCanvas ? this.outputCanvas.height : null,
          outputCanvasWidthAfter: null,
          outputCanvasHeightAfter: null,
          // Bumped only inside reset() (see below) -- if this present's
          // "before" and "after" values differ, strokeMaskTex was cleared
          // by a NEW stroke's beginStroke()/reset() while this present's
          // GPU work was still in flight (a genuinely different bug class
          // than swapchain/present() behavior itself).
          maskResetGenerationBefore: this._maskResetGeneration || 0,
          maskResetGenerationAfter: null,
          // Bumped only inside init()'s outputContext.configure() call --
          // this module never calls configure() again after the first
          // init(), so under normal operation before/after should always
          // match; a mismatch would mean something outside this diagnostic
          // reconfigured the context mid-present.
          contextConfigGenerationBefore: this._contextConfigGeneration || 0,
          contextConfigGenerationAfter: null,
          // Phase 11B.4: did this specific present() skip the
          // onSubmittedWorkDone() fence (see the flag below)?
          skippedWorkDoneWait: false,
        };
        GpuBackend._inFlightCount++;
      }
      // --- end diagnostic setup ---
      this.device.queue.writeBuffer(this.presentUniformBuf, 0, new Float32Array([cr, cg, cb, strokeOpacity]));
      const enc = this.device.createCommandEncoder();
      if (_diagEntry) _diagEntry.beforeGetCurrentTextureTime = performance.now();
      const currentTextureView = this.outputContext.getCurrentTexture().createView();
      if (_diagEntry) {
        _diagEntry.afterGetCurrentTextureTime = performance.now();
        _diagEntry.getCurrentTextureMs = _diagEntry.afterGetCurrentTextureTime - _diagEntry.beforeGetCurrentTextureTime;
        _diagEntry.beforeRenderPassTime = _diagEntry.afterGetCurrentTextureTime;
      }
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: currentTextureView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.presentBindGroup);
      pass.draw(3);
      pass.end();
      if (_diagEntry) _diagEntry.beforeSubmitTime = performance.now();
      this.device.queue.submit([enc.finish()]);
      if (_diagEntry) _diagEntry.afterSubmitTime = performance.now();
      // Phase 11B.10 TEMP DIAGNOSTIC (opt-in, default off): record that
      // real GPU presentation work was actually submitted for this
      // meta.livePreviewId (set only by a live-preview peekStroke() call in
      // brush-engine.js's _hardRoundPresentLivePreview, never by the
      // finished-frame path), plus the submit time and what
      // brush-engine.js's preview generation counter was at that exact
      // instant -- read via window.HardRoundGetPreviewGeneration(), a
      // read-only accessor with no other effect. Independent of the
      // window.HardRoundGpuPresentDiag flag above so this diagnostic works
      // on its own. Purely additive bookkeeping; does not change what gets
      // submitted or when.
      if (typeof window !== 'undefined' && window.HardRoundDebugLivePreviewCrossover && meta && meta.livePreviewId != null) {
        window.HardRoundLivePreviewSubmitInfo = window.HardRoundLivePreviewSubmitInfo || {};
        window.HardRoundLivePreviewSubmitInfo[meta.livePreviewId] = {
          submitTime: _diagEntry ? _diagEntry.afterSubmitTime : performance.now(),
          generationAtSubmit: window.HardRoundGetPreviewGeneration ? window.HardRoundGetPreviewGeneration() : null,
        };
      }
      // Phase 11B.4 TEMP DIAGNOSTIC CAUSAL FLAG (default false): when true,
      // ONLY for a live preview present() (meta.strokeId set -- see the
      // strokeId!=null check below; finish-frame calls, which pass no meta/
      // no strokeId, are NEVER affected and always keep the wait), skip
      // awaiting queue.onSubmittedWorkDone() before this promise resolves.
      // The render pass above and the submit() call are completely
      // unchanged either way -- this flag only controls whether present()
      // blocks the JS-side live-preview lifecycle on GPU completion before
      // returning. If skipping the wait removes the blink, the fence itself
      // (or what the caller does while synchronously blocked on it) is
      // causally involved; if the blink remains, the stall is not caused by
      // this await and must be in swapchain/present() behavior itself
      // (getCurrentTexture()/clear/etc. above, already timestamped above
      // regardless of this flag).
      const _isLivePreviewCall = !!(meta && meta.strokeId != null);
      const _skipWait = typeof window !== 'undefined' && !!window.HardRoundDebugSkipLivePresentWorkDoneWait && _isLivePreviewCall;
      if (_diagEntry) _diagEntry.skippedWorkDoneWait = _skipWait;
      if (!_skipWait) {
        // The caller immediately drawImage()s this WebGPU canvas into the
        // app's established 2D preview/commit surface. Command submission is
        // asynchronous; without this fence that copy can observe the prior
        // (freshly cleared) canvas frame and make the live stroke invisible.
        await this.device.queue.onSubmittedWorkDone();
      }
      // --- DIAGNOSTIC (Phase 11A.39 / 11B.4): resolve-time bookkeeping ---
      if (_diagEntry) {
        _diagEntry.workDoneTime = performance.now();
        _diagEntry.submitToWorkDoneMs = _diagEntry.workDoneTime - _diagEntry.afterSubmitTime;
        _diagEntry.outputCanvasWidthAfter = this.outputCanvas ? this.outputCanvas.width : null;
        _diagEntry.outputCanvasHeightAfter = this.outputCanvas ? this.outputCanvas.height : null;
        _diagEntry.maskResetGenerationAfter = this._maskResetGeneration || 0;
        _diagEntry.contextConfigGenerationAfter = this._contextConfigGeneration || 0;
        GpuBackend._inFlightCount = Math.max(0, GpuBackend._inFlightCount - 1);
        window.HardRoundGpuPresentLog.push(_diagEntry);
        // Bounded window: keep memory flat during long diagnostic sessions.
        if (window.HardRoundGpuPresentLog.length > 500) window.HardRoundGpuPresentLog.shift();
      }
      // --- end diagnostic resolve-time bookkeeping ---
      return { presented: true, reason: null, canvas: this.outputCanvas };
    }
    // --- DIAGNOSTIC (Phase 11B.2): summarize window.HardRoundGpuPresentLog
    // (populated above, opt-in via window.HardRoundGpuPresentDiag) grouped
    // by strokeId, to check whether GPU presentation backlog/concurrency
    // correlates with the visible fast-stroke blink. Read-only: only reads
    // window.HardRoundGpuPresentLog, never mutates it or anything else.
    //
    // Live-preview entries (meta.strokeId set by _hardRoundPresentLivePreview)
    // and finish-frame entries (strokeId===null, from
    // _hardRoundPresentFinishedFrame(), which calls peekStroke() with no
    // meta) are kept in SEPARATE buckets on purpose -- mixing a single ~239ms
    // finish-frame readback into a live-stroke's stats would badly skew that
    // stroke's max/average latency and falsely implicate live presentation.
    static analyzePresentBacklog() {
      const log = (window.HardRoundGpuPresentLog || []).slice();
      const liveByStroke = {};
      const finishEntries = [];
      for (const e of log) {
        if (e.strokeId === null || e.strokeId === undefined) { finishEntries.push(e); continue; }
        (liveByStroke[e.strokeId] || (liveByStroke[e.strokeId] = [])).push(e);
      }
      function summarize(entries) {
        const durations = entries.map(e => e.submitToWorkDoneMs).filter(v => typeof v === 'number');
        const sum = durations.reduce((a, b) => a + b, 0);
        // Phase 11B.4 additions: getCurrentTexture() cost distribution (does
        // acquiring the swapchain texture itself stall?), how many entries
        // in this bucket skipped the workDone wait (so an A/B comparison of
        // window.HardRoundDebugSkipLivePresentWorkDoneWait can be read
        // straight out of this summary), and whether strokeMaskTex or the
        // output context were ever observed to change mid-present.
        const gctDurations = entries.map(e => e.getCurrentTextureMs).filter(v => typeof v === 'number');
        const gctSum = gctDurations.reduce((a, b) => a + b, 0);
        const skippedCount = entries.filter(e => e.skippedWorkDoneWait).length;
        const maskResetDuringPresent = entries.filter(e =>
          typeof e.maskResetGenerationBefore === 'number' && typeof e.maskResetGenerationAfter === 'number' &&
          e.maskResetGenerationAfter !== e.maskResetGenerationBefore).length;
        const contextReconfiguredDuringPresent = entries.filter(e =>
          typeof e.contextConfigGenerationBefore === 'number' && typeof e.contextConfigGenerationAfter === 'number' &&
          e.contextConfigGenerationAfter !== e.contextConfigGenerationBefore).length;
        return {
          presentationCount: entries.length,
          maxInFlight: entries.reduce((m, e) => Math.max(m, (e.otherPresentsInFlightAtEnter || 0) + 1), 0),
          maxSubmitToWorkDoneMs: durations.length ? Math.max(...durations) : null,
          averageSubmitToWorkDoneMs: durations.length ? sum / durations.length : null,
          countOver16ms: durations.filter(v => v > 16).length,
          countOver33ms: durations.filter(v => v > 33).length,
          countOver100ms: durations.filter(v => v > 100).length,
          maxGetCurrentTextureMs: gctDurations.length ? Math.max(...gctDurations) : null,
          averageGetCurrentTextureMs: gctDurations.length ? gctSum / gctDurations.length : null,
          skippedWorkDoneWaitCount: skippedCount,
          maskResetDuringPresentCount: maskResetDuringPresent,
          contextReconfiguredDuringPresentCount: contextReconfiguredDuringPresent,
        };
      }
      const strokes = {};
      Object.keys(liveByStroke).forEach(strokeId => { strokes[strokeId] = summarize(liveByStroke[strokeId]); });
      return {
        strokes,
        finishFrames: summarize(finishEntries),
        finishFrameEntriesExcludedFromStrokeSummary: finishEntries.length,
      };
    }

    // Resolves the backing-store coverage texture down to a logical-
    // resolution RGBA texture (box filter, same math as blitShader), then
    // reads it back into `outCtx` (a 2D context sized w x h). Coloring
    // (rgb/erase) is applied here on read-back, same responsibility split
    // as the CPU backend's resolveInto().
    async resolveInto(outCtx, rgb, composite) {
      if (!this.ready) return false;
      const device = this.device;
      const resolveTex = device.createTexture({
        size: [this.w, this.h], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: resolveTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.setPipeline(this.blitPipeline);
      pass.setBindGroup(0, this.blitBindGroup);
      pass.draw(3);
      pass.end();

      const bytesPerRow = Math.ceil((this.w * 4) / 256) * 256;
      const readBuf = device.createBuffer({
        size: bytesPerRow * this.h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      enc.copyTextureToBuffer(
        { texture: resolveTex },
        { buffer: readBuf, bytesPerRow },
        [this.w, this.h]
      );
      device.queue.submit([enc.finish()]);

      await readBuf.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuf.getMappedRange());
      const img = outCtx.createImageData(this.w, this.h);
      const d = img.data;
      const isErase = composite === 'erase';
      const cr = isErase ? 0 : rgb[0], cg = isErase ? 0 : rgb[1], cb = isErase ? 0 : rgb[2];
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const srcOff = y * bytesPerRow + x * 4;
          const dstOff = (y * this.w + x) * 4;
          const coverage = mapped[srcOff] / 255; // resolve shader writes coverage into .r (and g/b/a identically)
          d[dstOff] = cr; d[dstOff + 1] = cg; d[dstOff + 2] = cb; d[dstOff + 3] = Math.round(coverage * 255);
        }
      }
      outCtx.putImageData(img, 0, 0);
      readBuf.unmap();
      readBuf.destroy();
      resolveTex.destroy();
      return true;
    }

    // TEMP DIAGNOSTIC (Phase 11A.25): renders the CURRENT strokeMaskTex
    // through the real PRESENT_SHADER_WGSL pipeline (same presentPipeline/
    // presentBindGroup present() uses) into a fresh off-screen COPY_SRC
    // texture instead of the visible swapchain, then reads it back to a
    // plain RGBA byte array. Output is PREMULTIPLIED alpha (rgb already
    // scaled by coverage*opacity), matching exactly what present() writes
    // to the swapchain -- this method changes only the render target
    // (scratch texture vs. swapchain) and the post-render readback step;
    // the shader, uniforms, and bind group are identical to production.
    // Never touches strokeMaskTex (read-only binding), outputContext, or
    // the swapchain.
    async diagPresentIntoBuffer(rgb, composite, opacity) {
      if (!this.ready) return null;
      const device = this.device;
      const isErase = composite === 'erase';
      const cr = isErase ? 0 : rgb[0] / 255;
      const cg = isErase ? 0 : rgb[1] / 255;
      const cb = isErase ? 0 : rgb[2] / 255;
      const strokeOpacity = Math.max(0, Math.min(1, opacity == null ? 1 : opacity));
      device.queue.writeBuffer(this.presentUniformBuf, 0, new Float32Array([cr, cg, cb, strokeOpacity]));
      // Phase 11A.25.1 fix: presentPipeline's fragment target was created
      // with `format: this.outputFormat` (navigator.gpu.getPreferredCanvasFormat(),
      // e.g. 'bgra8unorm' on most desktop browsers) -- NOT 'rgba8unorm'.
      // A render pass's color attachment format must exactly match its
      // pipeline's declared target format; using a mismatched scratch
      // texture format here is a WebGPU validation error that drops the
      // draw silently, leaving the texture at its cleared (fully
      // transparent) state. That produced the all-zero LIVE_PRESENT_DIAG
      // seen in the first run -- a bug in this diagnostic method, not a
      // real present-vs-resolve difference. The scratch texture below now
      // matches presentPipeline's actual target format.
      const scratchFormat = this.outputFormat || 'rgba8unorm';
      const scratchTex = device.createTexture({
        size: [this.w, this.h], format: scratchFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: scratchTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.presentBindGroup);
      pass.draw(3);
      pass.end();
      const bytesPerRow = Math.ceil((this.w * 4) / 256) * 256;
      const readBuf = device.createBuffer({ size: bytesPerRow * this.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: scratchTex }, { buffer: readBuf, bytesPerRow }, [this.w, this.h]);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuf.getMappedRange());
      const out = new Uint8ClampedArray(this.w * this.h * 4);
      // copyTextureToBuffer copies raw texel bytes in the texture's native
      // channel order. 'bgra8unorm' stores B,G,R,A per texel; every other
      // format WebGPU's getPreferredCanvasFormat() can return is
      // 'rgba8unorm' (R,G,B,A already). Swizzle only in the bgra8unorm
      // case so the returned buffer is always RGBA, matching
      // diagResolveIntoBuffer()'s output and this module's comparison
      // utilities.
      const isBgra = scratchFormat === 'bgra8unorm';
      for (let y = 0; y < this.h; y++) {
        const srcRow = y * bytesPerRow;
        const dstRow = y * this.w * 4;
        if (!isBgra) {
          out.set(mapped.subarray(srcRow, srcRow + this.w * 4), dstRow);
        } else {
          for (let x = 0; x < this.w; x++) {
            const s = srcRow + x * 4, d = dstRow + x * 4;
            out[d] = mapped[s + 2];     // R <- B
            out[d + 1] = mapped[s + 1]; // G
            out[d + 2] = mapped[s];     // B <- R
            out[d + 3] = mapped[s + 3]; // A
          }
        }
      }
      readBuf.unmap();
      readBuf.destroy();
      scratchTex.destroy();
      return { data: out, w: this.w, h: this.h, premultiplied: true, source: 'PRESENT_SHADER_WGSL', renderedFormat: scratchFormat };
    }

    // TEMP DIAGNOSTIC (Phase 11A.25): renders the CURRENT strokeMaskTex
    // through the real RESOLVE_SHADER_WGSL pipeline (same blitPipeline/
    // blitBindGroup resolveInto() uses) into a fresh off-screen COPY_SRC
    // texture, reads it back, then applies the SAME coloring step
    // resolveInto() applies on readback (fixed rgb, coverage -> alpha,
    // straight/non-premultiplied). This is the exact byte-for-byte
    // equivalent of what resolveInto() produces, just returned as a raw
    // buffer instead of written into a 2D context. Never touches
    // strokeMaskTex (read-only binding).
    async diagResolveIntoBuffer(rgb, composite) {
      if (!this.ready) return null;
      const device = this.device;
      const scratchTex = device.createTexture({
        size: [this.w, this.h], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: scratchTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.setPipeline(this.blitPipeline);
      pass.setBindGroup(0, this.blitBindGroup);
      pass.draw(3);
      pass.end();
      const bytesPerRow = Math.ceil((this.w * 4) / 256) * 256;
      const readBuf = device.createBuffer({ size: bytesPerRow * this.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: scratchTex }, { buffer: readBuf, bytesPerRow }, [this.w, this.h]);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuf.getMappedRange());
      const isErase = composite === 'erase';
      const cr = isErase ? 0 : rgb[0], cg = isErase ? 0 : rgb[1], cb = isErase ? 0 : rgb[2];
      const out = new Uint8ClampedArray(this.w * this.h * 4);
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const srcOff = y * bytesPerRow + x * 4;
          const dstOff = (y * this.w + x) * 4;
          const coverage = mapped[srcOff] / 255; // resolve shader writes coverage into .r (and g/b/a identically)
          out[dstOff] = cr; out[dstOff + 1] = cg; out[dstOff + 2] = cb; out[dstOff + 3] = Math.round(coverage * 255);
        }
      }
      readBuf.unmap();
      readBuf.destroy();
      scratchTex.destroy();
      return { data: out, w: this.w, h: this.h, premultiplied: false, source: 'RESOLVE_SHADER_WGSL' };
    }
  }

  // Ported verbatim (semantics-preserving) from prototype's strokeShader /
  // hard-round-capsule-gpu.js's STROKE_SHADER_WGSL, minus the base-layer
  // color mix (this module's GPU output is coverage-only, same split as
  // the CPU backend above).
  const STROKE_SHADER_WGSL = `
    struct Uniforms { size: vec2f, ss: f32, mode: f32 };
    @group(0) @binding(0) var<uniform> u: Uniforms;
    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) p0: vec2f, @location(1) p1: vec2f,
      @location(2) r0: f32, @location(3) r1: f32,
      @location(4) alpha0: f32, @location(5) alpha1: f32,
      @location(6) aaScale: f32, @location(7) aaOff: f32,
    };
    @vertex
    fn vs(@location(0) position: vec2f, @location(1) p0: vec2f, @location(2) p1: vec2f,
          @location(3) r0: f32, @location(4) r1: f32,
          @location(5) alpha0: f32, @location(6) alpha1: f32,
          @location(7) aaScale: f32, @location(8) aaOff: f32) -> VSOut {
      var out: VSOut;
      let ndc = vec2f((position.x / u.size.x) * 2.0 - 1.0, 1.0 - (position.y / u.size.y) * 2.0);
      out.pos = vec4f(ndc, 0.0, 1.0);
      out.p0 = p0; out.p1 = p1; out.r0 = r0; out.r1 = r1;
      out.alpha0 = alpha0; out.alpha1 = alpha1;
      out.aaScale = aaScale; out.aaOff = aaOff;
      return out;
    }
    fn capsuleD(fragPos: vec2f, p0: vec2f, p1: vec2f, r0: f32, r1: f32) -> f32 {
      let pa = fragPos - p0;
      let ba = p1 - p0;
      let denom = dot(ba, ba);
      let rawH = dot(pa, ba) / max(denom, 1e-6);
      let h = clamp(rawH, 0.0, 1.0);
      let localRadius = mix(r0, r1, h);
      let isRoundDab = denom < 1e-6;
      let roundDabDistance = length(pa) - r0;
      let segmentDistance = length(pa - ba * h) - localRadius;
      return select(segmentDistance, roundDabDistance, isRoundDab);
    }
    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      // Phase 9E.2: AA Off is a hard, pixel-perfect step -- not just a
      // narrower fwidth() band. A per-subpixel binary test alone would
      // still be box-averaged into fractional (gray) alpha by the SS=4
      // resolve pass, exactly like the CPU backend's drawSegment(). So
      // when aaOff is set, sample ONCE at this fragment's ss x ss output
      // block center (every subpixel in the block agrees), giving a
      // uniform 0/1 value that resolves to exactly 0.0 or 1.0.
      let ss = max(u.ss, 1.0);
      let blockCenter = (floor(in.pos.xy / ss) * ss) + vec2f(ss * 0.5, ss * 0.5);
      let samplePos = select(in.pos.xy, blockCenter, in.aaOff > 0.5);
      let d = capsuleD(samplePos, in.p0, in.p1, in.r0, in.r1);
      let denom = dot(in.p1 - in.p0, in.p1 - in.p0);
      let rawH = dot(samplePos - in.p0, in.p1 - in.p0) / max(denom, 1e-6);
      let h = clamp(rawH, 0.0, 1.0);
      if (in.aaOff > 0.5) {
        // Phase 9E.3: conservative pixel-square test (see
        // hard-round-capsule-math.js's pixelCoveredByCapsule) instead of
        // an exact d<=0 point test, so a fast-flick's shrinking-radius
        // tail can't thread between block centers and drop pixels.
        let halfDiag = ss * 0.70710678;
        let cov = select(0.0, 1.0, d <= halfDiag);
        return vec4f(mix(in.alpha0, in.alpha1, h) * cov, 0.0, 0.0, 1.0);
      }
      let localRadius = mix(in.r0, in.r1, h);
      let isRoundDab = denom < 1e-6;
      // Phase 9E.1: same aaModeScale() multiplier the CPU backend applies
      // in hard-round-capsule-math.js's capsuleCoverage, so Off/Weak/
      // Medium/Strong widen the band by the identical factor on GPU.
      let segmentLength = sqrt(max(denom, 1e-6));
      let taperRate = (in.r1 - in.r0) / segmentLength;
      let taperBand = sqrt(1.0 + taperRate * taperRate);
      let insideBody = rawH > 0.0 && rawH < 1.0 && !isRoundDab;
      let analyticBand = select(1.0, taperBand, insideBody);
      let aa = max(analyticBand * in.aaScale, 1e-4);
      let cov = clamp(0.5 - d / aa, 0.0, 1.0);
      let circleArea = min(1.0, 3.14159265 * localRadius * localRadius);
      let strokeWidth = min(1.0, 2.0 * localRadius);
      let subpixelArea = select(strokeWidth, circleArea, isRoundDab);
      let alpha = mix(in.alpha0, in.alpha1, h);
      return vec4f(alpha * cov * subpixelArea, 0.0, 0.0, 1.0);
    }
  `;

  // Phase 11A.2: SS=4 box-filter/coverage-average core, shared verbatim by
  // both the commit-time resolve pass (RESOLVE_SHADER_WGSL) and the live
  // preview present pass (PRESENT_SHADER_WGSL). Before this phase, each
  // shader carried its own hand-copied version of this loop; the copies
  // happened to agree at the time (verified by the Phase 11A investigation
  // -- same sample offsets, same normalization, same source texture) but
  // had no mechanism keeping them that way, which is exactly the kind of
  // drift that must not be able to happen silently again. `resolveCoverage`
  // is now the single source of truth for "what fraction of this output
  // pixel's ss x ss block is covered" -- neither shader below computes
  // coverage any other way, so a future change to AA/SS/box-filter math
  // only has one place to be made, and live/final can never disagree on
  // the coverage value itself (only on what happens to it afterward, which
  // is intentionally still different -- see each shader's own comment).
  function COVERAGE_CORE_WGSL(ss) {
    return `
      fn resolveCoverage(tex: texture_2d<f32>, outPos: vec2i) -> f32 {
        let origin = outPos * ${ss};
        var sum = 0.0;
        for (var y = 0; y < ${ss}; y = y + 1) {
          for (var x = 0; x < ${ss}; x = x + 1) {
            sum = sum + textureLoad(tex, origin + vec2i(x, y), 0).r;
          }
        }
        return sum * (1.0 / ${(ss * ss).toFixed(1)});
      }
    `;
  }

  // Ported from prototype's blitShader, minus the *16 4x4 hardcode -- this
  // module parameterizes the box size by `ss` so it isn't silently wrong
  // if this renderer is ever constructed with a non-4 supersample factor.
  //
  // Deliberately does NOT apply opacity or premultiplication: this pass
  // feeds the commit/readback path, whose result is colorized (in JS, on
  // readback) and opacity-composited once, downstream, by
  // _commitStrokeCanvas()'s Canvas2D globalAlpha -- unchanged by Phase
  // 11A.2. Coverage is written raw into all four channels; only .r is
  // ever read back (see resolveInto()).
  function RESOLVE_SHADER_WGSL(ss) {
    return `
      struct VSOut { @builtin(position) pos: vec4f };
      @vertex
      fn vs(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
        var out: VSOut;
        out.pos = vec4f(p[i], 0.0, 1.0);
        return out;
      }
      @group(0) @binding(0) var tex: texture_2d<f32>;
      ${COVERAGE_CORE_WGSL(ss)}
      @fragment
      fn fs(in: VSOut) -> @location(0) vec4f {
        let cov = resolveCoverage(tex, vec2i(in.pos.xy));
        return vec4f(cov, cov, cov, cov);
      }
    `;
  }

  // Live preview pass: same resolveCoverage() core as the commit path
  // above (Phase 11A.2 -- see its comment), then opacity + premultiply +
  // color, which stay in-shader here because this pass writes directly to
  // the visible swapchain (alphaMode:'premultiplied') with no further
  // downstream compositing stage to apply them -- unlike the resolve pass,
  // there is no Canvas2D step coming after this one. This is the same
  // opacity-application behavior as before Phase 11A.2; only the coverage
  // computation itself was deduplicated.
  function PRESENT_SHADER_WGSL(ss) {
    return `
      struct VSOut { @builtin(position) pos: vec4f };
      struct ColorUniform { rgb: vec3f, opacity: f32 };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
        var p = array<vec2f,3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
        var out: VSOut; out.pos = vec4f(p[i], 0.0, 1.0); return out;
      }
      @group(0) @binding(0) var mask: texture_2d<f32>;
      @group(0) @binding(1) var<uniform> color: ColorUniform;
      ${COVERAGE_CORE_WGSL(ss)}
      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let cov = resolveCoverage(mask, vec2i(in.pos.xy)) * color.opacity;
        return vec4f(color.rgb * cov, cov);
      }
    `;
  }

  const AA_MARGIN = 2.0;
  function segmentVerts(x0, y0, x1, y1, r0, r1, alpha0, alpha1, aaScale, aaOff) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const maxR = Math.max(r0, r1);
    const ext = maxR + AA_MARGIN;
    const hw = maxR + AA_MARGIN;
    const p0 = { x: x0 - ux * ext, y: y0 - uy * ext };
    const p1 = { x: x1 + ux * ext, y: y1 + uy * ext };
    const c0 = { x: p0.x + nx * hw, y: p0.y + ny * hw };
    const c1 = { x: p1.x + nx * hw, y: p1.y + ny * hw };
    const c2 = { x: p1.x - nx * hw, y: p1.y - ny * hw };
    const c3 = { x: p0.x - nx * hw, y: p0.y - ny * hw };
    const as = aaScale == null ? 1 : aaScale;
    const off = aaOff ? 1 : 0;
    // Phase 9E.2: aaOff (1/0) travels alongside aaScale so the fragment
    // shader can switch to block-center point sampling (see fs below)
    // instead of just narrowing fwidth's band -- narrowing alone still
    // lets the SS=4 resolve's box filter re-introduce gray edge pixels.
    const v = (p) => [p.x, p.y, x0, y0, x1, y1, r0, r1, alpha0, alpha1, as, off];
    const out = [];
    out.push.apply(out, v(c0)); out.push.apply(out, v(c1)); out.push.apply(out, v(c2));
    out.push.apply(out, v(c0)); out.push.apply(out, v(c2)); out.push.apply(out, v(c3));
    return out;
  }

  // Phase 10.1: the union/max-blend of contiguous, collinear capsules with
  // one constant radius and alpha is exactly the capsule from the first
  // endpoint to the last. This removes raw-stylus tessellation redundancy
  // without discarding an input sample or approximating any geometry.
  function mergeEquivalentConstantCapsules(segments) {
    const out = [];
    for (const source of segments) {
      if (!source) continue;
      const seg = source;
      const previous = out[out.length - 1];
      const aaOff = seg.aaMode === 'off' || seg.aaMode === 'none';
      if (previous && !aaOff && previous.aaMode === seg.aaMode &&
          previous.composite === seg.composite && previous.hardness === seg.hardness &&
          previous.r0 === previous.r1 && seg.r0 === seg.r1 && previous.r1 === seg.r0 &&
          previous.alpha0 === previous.alpha1 && seg.alpha0 === seg.alpha1 && previous.alpha1 === seg.alpha0 &&
          previous.x1 === seg.x0 && previous.y1 === seg.y0) {
        const ax = previous.x1 - previous.x0, ay = previous.y1 - previous.y0;
        const bx = seg.x1 - seg.x0, by = seg.y1 - seg.y0;
        const scale = Math.max(1, Math.hypot(ax, ay) * Math.hypot(bx, by));
        if (Math.abs(ax * by - ay * bx) <= 1e-10 * scale && ax * bx + ay * by >= 0) {
          previous.x1 = seg.x1; previous.y1 = seg.y1;
          previous.isStrokeEnd = !!seg.isStrokeEnd;
          continue;
        }
      }
      out.push(Object.assign({}, seg));
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // PrototypeRenderer -- the five-method public surface (peekStroke added
  // Phase 9C.1, see module doc above).
  // -----------------------------------------------------------------------
  //
  // @param {object} opts
  // @param {number} opts.width - logical (non-supersampled) canvas width
  // @param {number} opts.height - logical (non-supersampled) canvas height
  // @param {number} [opts.ss=4] - backing-store supersample factor
  // @param {boolean} [opts.preferGpu=false] - attempt the GPU path first;
  //   the CPU path is always used as the fallback (and as the only path
  //   until init()/first drawSegments() has had a chance to try the GPU).
  class PrototypeRenderer {
    constructor(opts) {
      const o = opts || {};
      this.width = Math.max(1, Math.floor(o.width || 0));
      this.height = Math.max(1, Math.floor(o.height || 0));
      this.ss = o.ss || DEFAULT_SS;
      this.preferGpu = !!o.preferGpu;

      this.cpu = new CpuBackend(this.width, this.height, this.ss);
      this.gpu = new GpuBackend(this.width, this.height, this.ss);
      this._gpuInitPromise = this.preferGpu ? this.gpu.init() : null;

      this._active = false;
      this._usingGpu = false;
      this._composite = 'paint';
      this._rgb = [0, 0, 0];
      this._segmentCount = 0;
      this.presentationOpacity = 1;
      // Phase 11B.3 TEMP DIAGNOSTIC: gated by window.HardRoundDebugSerializeGpuPreview
      // (default false, opt-in). Tracks whether a live GPU preview present()
      // is currently in flight for THIS stroke, and whether newer stroke
      // geometry has arrived since that present() was kicked off. Does not
      // affect endStroke()/finished-frame presentation, the CPU renderer, or
      // anything else -- see peekStroke()/_peekStrokeGpuSerialized() below,
      // the only place these fields are read/written.
      this._livePresentInFlight = false;
      this._livePreviewDirty = false;

      // Output canvas: logical resolution, reused across strokes.
      this._outCanvas = (typeof document !== 'undefined')
        ? document.createElement('canvas')
        : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(this.width, this.height) : null);
      if (this._outCanvas) {
        this._outCanvas.width = this.width;
        this._outCanvas.height = this.height;
        this._outCtx = this._outCanvas.getContext('2d');
      } else {
        this._outCtx = null;
      }
    }

    // Starts a new stroke's accumulation. Resets the backing store.
    //
    // Phase 9C.2: also clears the output canvas immediately, synchronously.
    // Previously it was left untouched until the first resolve, on the
    // theory that a caller peeking between strokes should still see the
    // last finished result -- true, but that peeking-between-strokes case
    // only happens while `_active` is false, i.e. strictly BEFORE this
    // method runs, so clearing here doesn't affect it. It's required now
    // because peekStroke() only repaints the DIRTY region of _outCtx (see
    // resolveDirtyInto() below) -- if the previous stroke's finished
    // pixels were left in place outside the new stroke's first dirty
    // rectangle, they'd leak into this stroke's live preview instead of
    // being cleared. The clear itself is one clearRect() call, not a
    // per-frame cost.
    beginStroke() {
      if (this._hardRoundFinishingOwner != null) {
        throw new Error('PrototypeRenderer.beginStroke(): renderer is owned by finishing stroke '+this._hardRoundFinishingOwner);
      }
      if (this._active) this.cancelStroke();
      this._active = true;
      this._segmentCount = 0;
      this._composite = 'paint';
      this._rgb = [0, 0, 0];
      // Phase 11B.3 TEMP DIAGNOSTIC: fresh per-stroke state for the opt-in
      // serialized-live-preview experiment (see constructor comment above).
      this._livePresentInFlight = false;
      this._livePreviewDirty = false;
      // TEMP DIAGNOSTIC (Phase 11A.23): fresh, empty per-backend segment
      // log for this stroke. `_nextId` is NOT reset -- identity tags stay
      // unique across the whole session so a duplicate-submission check
      // can't collide with a previous stroke's ids.
      if (typeof window !== 'undefined') {
        const prevNextId = window.HardRoundSegmentLog ? window.HardRoundSegmentLog._nextId : 0;
        window.HardRoundSegmentLog = { cpu: [], gpu: [], dispatchCalls: [], _nextId: prevNextId };
      }
      if (this._outCtx) this._outCtx.clearRect(0, 0, this.width, this.height);

      if (this.preferGpu && !this._gpuInitPromise) {
        this._gpuInitPromise = this.gpu.init();
      }
      this._usingGpu = this.preferGpu && this.gpu.isAvailable();
      // Reset only the backend that owns this stroke. The previous order
      // synchronously cleared the entire SS=4 CPU fallback even after GPU
      // availability was already established.
      if (this._usingGpu) this.gpu.reset();
      else this.cpu.reset();
    }

    // Accumulates render-ready segments (see module doc for shape) into
    // the current stroke's backing store. Safe to call multiple times per
    // stroke (once per pointermove batch), matching how the rest of this
    // app already batches segment dispatch.
    drawSegments(segments) {
      if (!this._active || !segments || !segments.length) return;
      // TEMP DIAGNOSTIC (Phase 11A.24): when armed, deep-clone this exact
      // batch (BEFORE the merge/no-merge branch below, i.e. the true
      // render-ready segment stream as produced upstream) into
      // window.HardRoundCapturedStream.batches, preserving batch
      // boundaries (mergeEquivalentConstantCapsules() only merges within
      // a single drawSegments() call, so batch boundaries matter for a
      // faithful replay). Read-only w.r.t. `segments`/`dispatchSegments`
      // and does not affect which backend this live call uses.
      if (typeof window !== 'undefined' && window.HardRoundCaptureArmed && window.HardRoundCapturedStream) {
        window.HardRoundCapturedStream.batches.push(segments.map(s => (s ? Object.assign({}, s) : s)));
      }
      // TEMP DIAGNOSTIC (Phase 11A.23): record exactly what drawSegments()
      // received (pre-dispatch) and which branch it took, before any
      // backend-specific transformation (merge, unit conversion, etc.)
      // happens. Read-only bookkeeping -- does not alter `segments`,
      // `dispatchSegments`, or which backend gets called.
      if (typeof window !== 'undefined' && window.HardRoundSegmentLog) {
        window.HardRoundSegmentLog.dispatchCalls.push({
          usingGpu: this._usingGpu,
          inputCount: segments.length,
          willMerge: !this._usingGpu,
        });
      }
      const dispatchSegments = this._usingGpu ? segments : mergeEquivalentConstantCapsules(segments);
      // TEMP DIAGNOSTIC (Phase 11A.23): CPU is handed the OUTPUT of
      // mergeEquivalentConstantCapsules(segments) (collinear/constant-radius
      // runs merged into one capsule); GPU is handed `segments` completely
      // unmerged. This is the actual, provable first divergence between
      // what the two backends are asked to draw for the same stroke input
      // -- it happens here, before either drawSegment() below is ever
      // called. Both backends' blend pipelines use order-independent max
      // blending (see CpuBackend's Phase 10.0 comment and GpuBackend's
      // `operation: 'max'` fragment blend state), so this merge is
      // documented as a CPU-side perf optimization that should be a no-op
      // on final coverage -- this diagnostic exists to make that claim
      // checkable rather than assumed.
      if (typeof window !== 'undefined' && window.HardRoundSegmentLog) {
        window.HardRoundSegmentLog.dispatchCalls[window.HardRoundSegmentLog.dispatchCalls.length - 1].mergedCount = dispatchSegments.length;
      }
      for (let i = 0; i < dispatchSegments.length; i++) {
        const seg = dispatchSegments[i];
        if (!seg) continue;
        this._rgb = seg.rgb || this._rgb;
        this._composite = seg.composite || this._composite;
        if (this._usingGpu) this.gpu.drawSegment(seg);
        else this.cpu.drawSegment(seg);
      }
      this._segmentCount += segments.reduce((count, seg) => count + (seg ? 1 : 0), 0);
      if (this._usingGpu) this.gpu.flush();
    }

    // Shared resolve step: reads (does not mutate) the current backing-store
    // accumulation into _outCtx/_outCanvas. Used by both endStroke() (which
    // also deactivates the stroke) and peekStroke() (which does not), so
    // there is exactly one resolve code path for both -- no separate
    // preview-only pixel path exists to drift out of sync with the real one.
    async _resolveToOutput(readback, meta) {
      if (this._usingGpu) {
        if (readback) {
          await this.gpu.resolveInto(this._outCtx, this._rgb, this._composite);
          return { presented: false, reason: 'readback' };
        }
        // meta (optional; e.g. {strokeId, segmentCount}) is passed through
        // untouched to GpuBackend.present() purely for the Phase 11A.39
        // opt-in present() diagnostic below -- it has no effect on what
        // gets drawn or when.
        else return this.gpu.present(this._rgb, this._composite, this.presentationOpacity, meta);
      } else {
        this.cpu.resolveInto(this._outCtx, this._rgb, this._composite);
        return { presented: false, reason: 'cpu' };
      }
    }

    _resultCanvas() {
      return this._usingGpu && this.gpu.outputCanvas ? this.gpu.outputCanvas : this._outCanvas;
    }

    getStrokeDirtyRegion() {
      return this._usingGpu ? null : this.cpu.getStrokeDirtyRegion();
    }

    // Resolves the accumulated backing store down to logical resolution
    // and returns the finished stroke canvas. Synchronous on the CPU path;
    // the GPU path's readback is async, so callers awaiting a GPU-backed
    // result should `await` this. `_commitStrokeCanvas()` (elsewhere, not
    // touched by this module) is the intended consumer of the returned
    // canvas.
    //
    // @returns {Promise<{canvas: HTMLCanvasElement|OffscreenCanvas, composite: string, segmentCount: number}>}
    async endStroke(options) {
      if (!this._active) return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: 0 };
      const readback = !!(options && options.readback);
      this._active = false;
      let dirtyRegion = null;
      if (!this._usingGpu && !readback) dirtyRegion = this.cpu.resolveDirtyInto(this._outCtx, this._rgb, this._composite) || null;
      else await this._resolveToOutput(readback);
      const maskData=!this._usingGpu&&options&&options.includeCpuMaskData?this.cpu.copyResolvedMaskRegion(options.dirtyRect||this.cpu.getStrokeDirtyRegion(),this._rgb,this._composite):null;
      return { canvas: readback ? this._outCanvas : this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount, dirtyRegion, maskData };
    }

    // Phase 9C.1: resolves the CURRENT in-progress accumulation to the
    // output canvas for a live preview, WITHOUT ending the stroke --
    // drawSegments() can keep accumulating normally afterward. Safe to
    // call repeatedly during a stroke (once per pointermove batch, same
    // cadence as drawSegments()); a no-op returning the last resolved
    // canvas if no stroke is currently active.
    //
    // Phase 9C.2: no longer calls the full _resolveToOutput() on the CPU
    // path. Investigation found resolveInto()/_resolveToOutput() always
    // re-box-filtered the ENTIRE SS=4 backing store (this.bw x this.bh,
    // 16x the output pixel count) on every call, regardless of how little
    // of the canvas actually changed since the previous peek -- for a
    // small brush moving a short distance between frames, that's a huge
    // amount of wasted work repeated every animation frame. drawSegment()
    // already computes each segment's bounding box (to know which pixels
    // to rasterize); CpuBackend now retains the union of those boxes as a
    // running dirty rectangle instead of discarding it, and
    // resolveDirtyInto() (see prototype-renderer.js's CpuBackend) resolves
    // only that rectangle, consuming (clearing) it afterward. The GPU path
    // is untouched -- its resolve is already a fixed-cost full-screen
    // shader pass, not a per-pixel JS loop, so there's no equivalent win
    // available there, and this phase doesn't touch it.
    // The pixel result is unchanged either way: _resolveRegion() (the
    // shared box-filter/color-mix core) computes the exact same value for
    // any given output pixel whether it's part of a full or partial
    // resolve, and pixels outside the current dirty rectangle are already
    // correct in _outCtx from the previous resolve (coverage only grows
    // via max-blend, never shrinks, and beginStroke() clears _outCtx up
    // front -- see its comment -- so there is no stale data for a partial
    // resolve to accidentally leave behind).
    // endStroke() (below) is untouched and still always does the full
    // resolve, as the single authoritative commit-time result.
    //
    // @returns {Promise<{canvas: HTMLCanvasElement|OffscreenCanvas, composite: string, segmentCount: number}>}
    async peekStroke(meta) {
      if (!this._active) return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount };
      if (this._usingGpu) {
        // Phase 11B.5 TEMP DIAGNOSTIC (opt-in, default off): when
        // window.HardRoundDebugCanvasLivePresentation is true, a LIVE
        // PREVIEW peekStroke() call (meta.strokeId set -- same gating the
        // Phase 11B.4 skip-wait flag uses to distinguish a live-preview
        // request from the strokeId-less finished-frame request) does NOT
        // call GpuBackend.present() / touch the WebGPU overlay at all.
        // Instead it uses the SAME non-mutating GPU resolve/readback path
        // endStroke({readback:true}) already uses (gpu.resolveInto(), which
        // box-filters strokeMaskTex into a plain Canvas2D _outCtx/_outCanvas
        // -- it does not clear, reset, or otherwise mutate strokeMaskTex),
        // and returns that 2D canvas instead of the GPU outputCanvas, so the
        // caller (_hardRoundPresentLivePreview in brush-engine.js) can draw
        // it into the existing _strokeCanvas/_strokeCtx exactly like the
        // CPU backend's result already is. GPU accumulation/rasterization,
        // strokeMaskTex, segment generation, and the finished-frame path
        // (meta with no strokeId) are completely unaffected.
        const _canvasLivePresentationOn = typeof window !== 'undefined' && !!window.HardRoundDebugCanvasLivePresentation;
        const _isLivePreviewMeta = !!(meta && meta.strokeId != null);
        if (_canvasLivePresentationOn && _isLivePreviewMeta) {
          const _diagMeta = Object.assign({ segmentCount: this._segmentCount }, meta || {});
          await this._resolveToOutput(true, _diagMeta);
          return { canvas: this._outCanvas, composite: this._composite, segmentCount: this._segmentCount, canvasLivePresentation: true };
        }
        // Phase 11B.3 TEMP DIAGNOSTIC (opt-in, default off): when
        // window.HardRoundDebugSerializeGpuPreview is true, route the live
        // GPU preview through the one-in-flight coalescing gate below
        // instead of calling _resolveToOutput() directly on every
        // peekStroke(). This ONLY changes the live-preview present() path --
        // endStroke()/finished-frame presentation, the CPU renderer, Smart
        // Raster, segment generation, pressure, stabilization, AA, shaders,
        // and commit are all untouched (peekStroke() is never called by any
        // of those).
        if (typeof window !== 'undefined' && window.HardRoundDebugSerializeGpuPreview) {
          return this._peekStrokeGpuSerialized(meta);
        }
        // Phase 11A.39: fill in segmentCount for the present() diagnostic
        // from the renderer's own counter when the caller didn't supply one,
        // so window.HardRoundGpuPresentLog entries aren't left null.
        const _diagMeta = Object.assign({ segmentCount: this._segmentCount }, meta || {});
        const presentation = await this._resolveToOutput(false, _diagMeta);
        return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount, presentation };
      } else {
        const dirtyRegion = this.cpu.resolveDirtyInto(this._outCtx, this._rgb, this._composite);
        return { canvas: this._outCanvas, composite: this._composite, segmentCount: this._segmentCount, dirtyRegion: dirtyRegion || null };
      }
      return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount };
    }

    // Phase 11B.3 TEMP DIAGNOSTIC: the actual "one live present in flight,
    // coalesce intermediate states" experiment described in the task. Only
    // reached when window.HardRoundDebugSerializeGpuPreview is true AND
    // this._usingGpu (see peekStroke() above) -- never touches the CPU path,
    // endStroke(), or cancelStroke()'s own reset logic.
    //
    // Behavior:
    //   - If a live present() is already in flight for this stroke, this
    //     call does NOT start a second one. It just marks the preview dirty
    //     (there is newer accumulated geometry than what's currently being
    //     presented) and returns immediately with the last-resolved canvas.
    //   - If no present is in flight, this call becomes the one in-flight
    //     present. When it resolves, if the stroke is still active AND new
    //     geometry arrived while it was presenting (dirty), it immediately
    //     starts exactly one more present of the NEWEST accumulated state
    //     (not one-per-arrival -- multiple arrivals while presenting all
    //     collapse into that single follow-up present, i.e. coalesced, not
    //     queued). That loop repeats until there's nothing left dirty.
    async _peekStrokeGpuSerialized(meta) {
      this._livePreviewDirty = true;
      if (this._livePresentInFlight) {
        return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount, coalesced: true };
      }
      this._livePresentInFlight = true;
      try {
        // eslint-disable-next-line no-unmodified-loop-condition -- _livePreviewDirty
        // is reassigned inside this loop's own body every iteration.
        while (this._livePreviewDirty) {
          this._livePreviewDirty = false;
          if (!this._active) break; // stroke ended/cancelled while we were looping
          const _diagMeta = Object.assign({ segmentCount: this._segmentCount }, meta || {});
          await this._resolveToOutput(false, _diagMeta);
        }
      } finally {
        this._livePresentInFlight = false;
      }
      return { canvas: this._resultCanvas(), composite: this._composite, segmentCount: this._segmentCount };
    }

    // Abandons the in-progress stroke's accumulation without resolving.
    // The output canvas from the previous finished stroke (if any) is left
    // untouched.
    cancelStroke() {
      this._active = false;
      this._segmentCount = 0;
      this.cpu.reset();
      if (this._usingGpu) this.gpu.reset();
      this._usingGpu = false;
      // Phase 11B.3 TEMP DIAGNOSTIC: an in-flight present()'s own `await`
      // will still resolve after cancelStroke() runs, but its dirty-check
      // loop re-tests `this._active` (now false) before requesting another
      // present, so it will not keep presenting a cancelled stroke. Clearing
      // the dirty flag here is just extra hygiene, not load-bearing.
      this._livePreviewDirty = false;
    }

    isGpuActive() { return this._usingGpu; }
  }

  // TEMP DIAGNOSTIC (Phase 11A.24): exposed read-only so the A/B/C
  // diagnostic harness below can build a "GPU + merge" variant without
  // duplicating the merge algorithm. Not called anywhere in the
  // production dispatch path except drawSegments() itself, unchanged.
  const PrototypeRendererExports = { PrototypeRenderer, DEFAULT_SS, mergeEquivalentConstantCapsules };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PrototypeRendererExports;
  }
  if (typeof window !== 'undefined') {
    window.PrototypeRenderer = PrototypeRenderer;
    // Phase 11B.3 TEMP DIAGNOSTIC: default OFF. Set to true to run the
    // one-in-flight live-GPU-preview-present coalescing experiment (see
    // PrototypeRenderer.peekStroke()/_peekStrokeGpuSerialized() above).
    // Declared here (rather than left implicitly undefined) purely so it is
    // discoverable/greppable as a real, documented flag with an explicit
    // default, matching how the other window.HardRound* diagnostic flags in
    // this file are introduced.
    if (typeof window.HardRoundDebugSerializeGpuPreview === 'undefined') {
      window.HardRoundDebugSerializeGpuPreview = false;
    }
    // Phase 11B.4 TEMP DIAGNOSTIC CAUSAL FLAG: default OFF. See
    // GpuBackend.present() above for exactly what it does/doesn't skip.
    if (typeof window.HardRoundDebugSkipLivePresentWorkDoneWait === 'undefined') {
      window.HardRoundDebugSkipLivePresentWorkDoneWait = false;
    }
    // Phase 11B.5 TEMP DIAGNOSTIC CAUSAL FLAG: default OFF. See
    // PrototypeRenderer.peekStroke() above for exactly what it redirects
    // (live-preview-tagged GPU peeks only) when true.
    if (typeof window.HardRoundDebugCanvasLivePresentation === 'undefined') {
      window.HardRoundDebugCanvasLivePresentation = false;
    }
    window.PrototypeRendererModule = PrototypeRendererExports;
    // Phase 11B.2: console entry point for the present()-backlog diagnostic
    // summary defined on GpuBackend above. Read-only.
    window.HardRoundAnalyzePresentBacklog = () => GpuBackend.analyzePresentBacklog();
    // TEMP DIAGNOSTIC (Phase 11A.23): compares window.HardRoundSegmentLog.cpu
    // and .gpu after a stroke. Since PrototypeRenderer.drawSegments()
    // dispatches to exactly one backend per stroke (this._usingGpu), a
    // single normal stroke only ever populates one of the two arrays --
    // this helper is meant to be run after two otherwise-identical strokes
    // (e.g. one with window.HardRoundDebugForceBackend='cpu', one with
    // 'gpu'), or after a manual test harness that calls both backends'
    // drawSegment() directly with the same input list. Read-only: does not
    // draw, clear, or reset anything.
    window.HardRoundCompareSegmentLogs = function () {
      const log = window.HardRoundSegmentLog || { cpu: [], gpu: [], dispatchCalls: [] };
      const cpu = log.cpu, gpu = log.gpu;
      const report = {
        cpuCount: cpu.length,
        gpuCount: gpu.length,
        countsMatch: cpu.length === gpu.length,
        dispatchCalls: log.dispatchCalls,
        firstDifference: null,
        duplicateIdentitiesOnGpu: [],
        duplicateIdentitiesOnCpu: [],
      };
      const seenGpu = new Map();
      gpu.forEach(entry => {
        seenGpu.set(entry.identity, (seenGpu.get(entry.identity) || 0) + 1);
      });
      seenGpu.forEach((count, id) => { if (count > 1) report.duplicateIdentitiesOnGpu.push({ identity: id, count }); });
      const seenCpu = new Map();
      cpu.forEach(entry => {
        seenCpu.set(entry.identity, (seenCpu.get(entry.identity) || 0) + 1);
      });
      seenCpu.forEach((count, id) => { if (count > 1) report.duplicateIdentitiesOnCpu.push({ identity: id, count }); });
      const n = Math.max(cpu.length, gpu.length);
      for (let i = 0; i < n; i++) {
        const a = cpu[i], b = gpu[i];
        if (!a || !b) {
          report.firstDifference = { index: i, reason: !a ? 'missing-on-cpu' : 'missing-on-gpu', cpu: a || null, gpu: b || null };
          break;
        }
        const fieldsToCompare = ['start', 'end', 'radius', 'alpha', 'composite', 'hardness', 'aaMode'];
        const mismatched = fieldsToCompare.filter(f => JSON.stringify(a[f]) !== JSON.stringify(b[f]));
        if (mismatched.length) {
          report.firstDifference = { index: i, reason: 'value-mismatch', fields: mismatched, cpu: a, gpu: b };
          break;
        }
      }
      return report;
    };

    // ------------------------------------------------------------------
    // TEMP DIAGNOSTIC (Phase 11A.24): deterministic CPU/GPU A/B/C harness.
    //
    // Opt-in only -- nothing here runs unless explicitly called. Every
    // renderer instance created below is brand new and isolated; the
    // production `_hardRoundRenderer` singleton, its live stroke state,
    // and _commitStrokeCanvas()/saveActiveToKey()/recomposite() are never
    // touched. This answers exactly one question: given IDENTICAL input
    // geometry, does GPU rasterization differ from CPU, and does
    // CPU-equivalent merging make GPU match CPU?
    // ------------------------------------------------------------------

    // Call once, before drawing a stroke, to start capturing that stroke's
    // exact render-ready segment stream (per-batch, deep-cloned, captured
    // in drawSegments() above before the merge/no-merge branch runs).
    window.HardRoundArmSegmentCapture = function () {
      window.HardRoundCaptureArmed = true;
      window.HardRoundCapturedStream = { batches: [] };
    };
    // Call after the stroke's pointerup (or whenever no more batches
    // should be captured). Capturing more than one stroke into the same
    // buffer would silently corrupt the A/B/C comparison, so this must be
    // called before the diagnostic harness runs.
    window.HardRoundDisarmSegmentCapture = function () {
      window.HardRoundCaptureArmed = false;
    };

    function _hrDeepCloneBatches(batches) {
      return batches.map(batch => batch.map(seg => (seg ? Object.assign({}, seg) : seg)));
    }

    // Hashes/measures a canvas the same way _hrCaptureCanvas() does in
    // brush-engine.js (kept independent here so this module has no
    // dependency on brush-engine.js), plus a full pixel-by-pixel diff
    // against a second canvas of the same size.
    function _hrDiagCaptureCanvas(canvas) {
      const w = canvas.width, h = canvas.height;
      const cctx = canvas.getContext('2d');
      const data = cctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1, nonTransparent = 0, maxAlpha = 0, hash = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4, a = data[idx + 3];
          if (a > 0) {
            nonTransparent++;
            if (a > maxAlpha) maxAlpha = a;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
          hash = (hash * 31 + data[idx] + data[idx + 1] * 3 + data[idx + 2] * 7 + a * 13) | 0;
        }
      }
      return { w, h, data, bounds: maxX >= minX ? { minX, minY, maxX, maxY } : null, nonTransparent, maxAlpha, hash };
    }

    function _hrDiagCompareCaptures(a, b) {
      if (a.w !== b.w || a.h !== b.h) {
        return { sizeMismatch: true, aSize: [a.w, a.h], bSize: [b.w, b.h] };
      }
      let differingPixelCount = 0, maxChannelDiff = 0;
      const n = a.w * a.h * 4;
      for (let i = 0; i < n; i += 4) {
        let pixelDiffers = false;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(a.data[i + c] - b.data[i + c]);
          if (d > maxChannelDiff) maxChannelDiff = d;
          if (d !== 0) pixelDiffers = true;
        }
        if (pixelDiffers) differingPixelCount++;
      }
      return {
        hashEqual: a.hash === b.hash,
        boundsA: a.bounds, boundsB: b.bounds,
        boundsEqual: JSON.stringify(a.bounds) === JSON.stringify(b.bounds),
        nonTransparentA: a.nonTransparent, nonTransparentB: b.nonTransparent,
        nonTransparentDelta: b.nonTransparent - a.nonTransparent,
        maxAlphaA: a.maxAlpha, maxAlphaB: b.maxAlpha,
        maxAlphaDelta: b.maxAlpha - a.maxAlpha,
        differingPixelCount,
        maxChannelDiff,
        pixelPerfectMatch: differingPixelCount === 0,
      };
    }

    // Runs the captured stream through:
    //   A = a fresh CpuBackend via PrototypeRenderer's own production
    //       drawSegments() dispatch (preferGpu:false -> merge branch taken,
    //       exactly as production CPU strokes do today)
    //   B = a fresh GpuBackend via PrototypeRenderer's own production
    //       drawSegments() dispatch (preferGpu:true -> no-merge branch
    //       taken, exactly as production GPU strokes do today)
    //   C = a fresh GpuBackend, but bypassing drawSegments()'s dispatch to
    //       manually apply mergeEquivalentConstantCapsules() to each batch
    //       before calling the SAME gpu.drawSegment()/gpu.flush() production
    //       methods B uses -- this is the diagnostic-only variant, and the
    //       ONLY place in this harness that doesn't call production
    //       drawSegments() unmodified.
    // Each variant is resolved via the SAME endStroke({readback:true}) call
    // production Hard Round GPU commit already uses (see brush-engine.js's
    // _pointerEndStroke Hard Round branch), so the resolve path itself is
    // identical to what ships today -- this harness only controls what
    // segments go in, never how they're resolved.
    // TEMP DIAGNOSTIC (Phase 11A.25): same bounds/nonTransparent/maxAlpha/
    // hash bookkeeping as _hrDiagCaptureCanvas() (Phase 11A.24), but
    // operating directly on a {data,w,h} buffer -- diagPresentIntoBuffer()/
    // diagResolveIntoBuffer() never touch a canvas, so there is nothing to
    // getImageData() from.
    function _hrDiagCaptureBuffer(buf) {
      const { data, w, h } = buf;
      let minX = w, minY = h, maxX = -1, maxY = -1, nonTransparent = 0, maxAlpha = 0, hash = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4, a = data[idx + 3];
          if (a > 0) {
            nonTransparent++;
            if (a > maxAlpha) maxAlpha = a;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
          hash = (hash * 31 + data[idx] + data[idx + 1] * 3 + data[idx + 2] * 7 + a * 13) | 0;
        }
      }
      return { w, h, data, bounds: maxX >= minX ? { minX, minY, maxX, maxY } : null, nonTransparent, maxAlpha, hash };
    }

    // Un-premultiplies a PRESENT_SHADER_WGSL buffer (rgb was written as
    // color*cov*opacity, alpha as cov*opacity) back to straight alpha
    // (rgb, alpha) -- the same final-displayed-RGBA semantics
    // RESOLVE_SHADER_WGSL's buffer already uses (fixed rgb, coverage in
    // alpha). Where alpha is 0 there is no color information to recover,
    // so rgb is left at 0 (matches the fully-transparent pixel it already
    // represents either way -- doesn't affect nonTransparent/bounds/hash
    // comparisons, which are alpha-gated).
    function _hrDiagUnpremultiply(buf) {
      const { data, w, h } = buf;
      const out = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 0; continue; }
        out[i] = Math.round(data[i] * 255 / a);
        out[i + 1] = Math.round(data[i + 1] * 255 / a);
        out[i + 2] = Math.round(data[i + 2] * 255 / a);
        out[i + 3] = a;
      }
      return { data: out, w, h };
    }

    // Runs LIVE_PRESENT_DIAG and FINAL_RESOLVE_DIAG back-to-back against
    // whatever the current strokeMaskTex holds RIGHT NOW, with no
    // drawSegments()/reset() call permitted in between by the caller (both
    // diagnostic methods only read strokeMaskTex, so nothing here can
    // itself introduce one). Opt-in, read-only, does not call
    // present()/resolveInto()/endStroke() or touch the swapchain.
    window.HardRoundRunPresentVsResolveDiagnostic = async function (renderer) {
      if (!renderer || !renderer.gpu || !renderer.gpu.ready) {
        return { error: 'GPU renderer unavailable -- cannot run PRESENT vs RESOLVE diagnostic here.' };
      }
      const gpu = renderer.gpu;
      const rgb = renderer._rgb;
      const composite = renderer._composite;
      const opacity = renderer.presentationOpacity == null ? 1 : renderer.presentationOpacity;

      let livePresentRaw, finalResolveRaw;
      try {
        // Back-to-back, no drawSegments()/reset() between them.
        livePresentRaw = await gpu.diagPresentIntoBuffer(rgb, composite, opacity);
        finalResolveRaw = await gpu.diagResolveIntoBuffer(rgb, composite);
      } catch (err) {
        return { error: 'Diagnostic GPU pass failed: ' + (err && err.message ? err.message : String(err)) };
      }
      if (!livePresentRaw || !finalResolveRaw) {
        return { error: 'One or both diagnostic passes returned null (GPU not ready).' };
      }

      // Normalize PRESENT (premultiplied, color*opacity baked in) to the
      // same straight-alpha semantics RESOLVE already uses, so a
      // premultiplication difference isn't misreported as a geometry
      // difference. At opacity=1 this recovers color.rgb exactly (up to
      // 8-bit rounding); at opacity<1 it recovers color.rgb still, since
      // un-premultiplying divides out cov*opacity from both channels.
      const livePresentNormalized = _hrDiagUnpremultiply(livePresentRaw);

      const capLive = _hrDiagCaptureBuffer(livePresentNormalized);
      const capFinal = _hrDiagCaptureBuffer(finalResolveRaw);

      return {
        opacityUsed: opacity,
        compositeUsed: composite,
        rgbUsed: rgb,
        LIVE_PRESENT_DIAG: {
          source: livePresentRaw.source,
          wasPremultiplied: true,
          normalizedForComparison: true,
          bounds: capLive.bounds,
          nonTransparent: capLive.nonTransparent,
          maxAlpha: capLive.maxAlpha,
          hash: capLive.hash,
        },
        FINAL_RESOLVE_DIAG: {
          source: finalResolveRaw.source,
          wasPremultiplied: false,
          normalizedForComparison: false,
          bounds: capFinal.bounds,
          nonTransparent: capFinal.nonTransparent,
          maxAlpha: capFinal.maxAlpha,
          hash: capFinal.hash,
        },
        LIVE_vs_FINAL: _hrDiagCompareCaptures(capLive, capFinal),
      };
    };

    window.HardRoundRunSegmentABDiagnostic = async function (opts) {
      const o = opts || {};
      const captured = window.HardRoundCapturedStream;
      if (!captured || !captured.batches.length) {
        return { error: 'No captured segment stream. Call window.HardRoundArmSegmentCapture() before drawing the stroke, draw it, then window.HardRoundDisarmSegmentCapture(), then run this.' };
      }
      const width = o.width || (window._hardRoundRenderer && window._hardRoundRenderer.width);
      const height = o.height || (window._hardRoundRenderer && window._hardRoundRenderer.height);
      if (!width || !height) {
        return { error: 'width/height not provided and no production renderer found to infer them from.' };
      }
      const ss = o.ss || DEFAULT_SS;

      const result = { segmentCounts: {}, A: null, B: null, C: null, AvB: null, AvC: null, BvC: null };
      // Phase 11A.24.1 fix: capA/capB/capC were previously declared with
      // `const` inside their own if/else block (e.g. `const capB = ...`
      // inside the B else-branch). That scopes them to that block only --
      // referencing capB later, inside C's block, threw
      // "ReferenceError: capB is not defined" and aborted the function
      // before it ever reached `return result`. Hoisting all three to
      // function-level `let`s (initialized null, assigned once each
      // variant actually produces a capture) lets every later comparison
      // see whichever ones succeeded, regardless of which block set them.
      let capA = null, capB = null, capC = null;

      // --- A: CPU, production dispatch ---
      try {
        const rA = new PrototypeRenderer({ width, height, ss, preferGpu: false });
        rA.beginStroke();
        const batchesA = _hrDeepCloneBatches(captured.batches);
        let submittedA = 0;
        batchesA.forEach(batch => { submittedA += batch.length; rA.drawSegments(batch); });
        const outA = await rA.endStroke({ readback: true });
        capA = _hrDiagCaptureCanvas(outA.canvas);
        result.A = { backend: 'cpu-production', usingGpu: false, ...capA, data: undefined };
        result.segmentCounts.cpuSubmittedRaw = submittedA;
        result.segmentCounts.cpuFinalSegmentCount = outA.segmentCount;
      } catch (err) {
        result.A = { error: 'CPU variant failed: ' + (err && err.message ? err.message : String(err)) };
      }

      // --- B: GPU, production dispatch (unmerged) ---
      try {
        const rB = new PrototypeRenderer({ width, height, ss, preferGpu: true });
        if (rB._gpuInitPromise) await rB._gpuInitPromise;
        rB.beginStroke();
        if (!rB._usingGpu) {
          result.B = { error: 'GPU unavailable in this environment -- cannot run the GPU-production variant here.' };
        } else {
          const batchesB = _hrDeepCloneBatches(captured.batches);
          let submittedB = 0;
          batchesB.forEach(batch => { submittedB += batch.length; rB.drawSegments(batch); });
          const outB = await rB.endStroke({ readback: true });
          capB = _hrDiagCaptureCanvas(outB.canvas);
          result.B = { backend: 'gpu-production-unmerged', usingGpu: true, ...capB, data: undefined };
          result.segmentCounts.gpuUnmergedSubmittedRaw = submittedB;
          result.segmentCounts.gpuUnmergedFinalSegmentCount = outB.segmentCount;
        }
      } catch (err) {
        result.B = { error: 'GPU-production variant failed: ' + (err && err.message ? err.message : String(err)) };
      }
      if (capA && capB) result.AvB = _hrDiagCompareCaptures(capA, capB);

      // --- C: GPU, diagnostic dispatch (merged before gpu.drawSegment()) ---
      try {
        const rC = new PrototypeRenderer({ width, height, ss, preferGpu: true });
        if (rC._gpuInitPromise) await rC._gpuInitPromise;
        rC.beginStroke();
        if (!rC._usingGpu) {
          result.C = { error: 'GPU unavailable in this environment -- cannot run the GPU-merged-diagnostic variant here.' };
        } else {
          const batchesC = _hrDeepCloneBatches(captured.batches);
          let submittedC = 0;
          batchesC.forEach(batch => {
            if (!batch.length) return;
            const merged = mergeEquivalentConstantCapsules(batch);
            submittedC += merged.length;
            for (const seg of merged) {
              if (!seg) continue;
              rC._rgb = seg.rgb || rC._rgb;
              rC._composite = seg.composite || rC._composite;
              rC.gpu.drawSegment(seg);
            }
            rC._segmentCount += batch.reduce((n, s) => n + (s ? 1 : 0), 0);
            rC.gpu.flush();
          });
          const outC = await rC.endStroke({ readback: true });
          capC = _hrDiagCaptureCanvas(outC.canvas);
          result.C = { backend: 'gpu-diagnostic-merged', usingGpu: true, ...capC, data: undefined };
          result.segmentCounts.gpuMergedSubmitted = submittedC;
          result.segmentCounts.gpuMergedFinalSegmentCount = outC.segmentCount;
        }
      } catch (err) {
        result.C = { error: 'GPU-merged-diagnostic variant failed: ' + (err && err.message ? err.message : String(err)) };
      }
      // capA/capB/capC are now function-scoped, so both comparisons below
      // can see whichever pair actually succeeded, independent of block
      // boundaries -- this is the direct fix for the reported crash.
      if (capA && capC) result.AvC = _hrDiagCompareCaptures(capA, capC);
      if (capB && capC) result.BvC = _hrDiagCompareCaptures(capB, capC);

      return result;
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
