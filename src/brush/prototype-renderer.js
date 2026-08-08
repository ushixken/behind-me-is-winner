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
      // Float32 single-channel coverage accumulator, backing-store resolution.
      this.coverage = new Float32Array(this.bw * this.bh);
      // Phase 9C.2: union of every drawSegment() bounding box (in
      // backing-store/SS-space pixels) accumulated since the dirty region
      // was last consumed by a resolve. Null means "nothing dirty". This
      // is exactly the bounding box drawSegment() already computes per
      // segment (via CapsuleMath.capsuleBounds) to know which pixels to
      // rasterize -- it was simply being discarded before; nothing new is
      // computed here, it's just retained.
      this._dirty = null;
    }

    reset() {
      this.coverage.fill(0);
      this._dirty = null;
    }

    // Rasterizes one render-ready segment's coverage into the backing
    // store at (x*ss, y*ss) scale, max-blended against whatever is
    // already accumulated there (never additive -- overlapping dabs in a
    // single stroke must not darken past one segment's own coverage,
    // matching the GPU pipeline's max blend op).
    drawSegment(seg) {
      const ss = this.ss;
      const x0 = seg.x0 * ss, y0 = seg.y0 * ss, x1 = seg.x1 * ss, y1 = seg.y1 * ss;
      const r0 = seg.r0 * ss, r1 = seg.r1 * ss;
      const alpha0 = seg.alpha0 == null ? 1 : seg.alpha0;
      const alpha1 = seg.alpha1 == null ? 1 : seg.alpha1;
      const b = CapsuleMath.capsuleBounds(x0, y0, x1, y1, r0, r1);
      const sx = Math.max(0, b.sx), sy = Math.max(0, b.sy);
      const ex = Math.min(this.bw, b.ex), ey = Math.min(this.bh, b.ey);
      if (ex <= sx || ey <= sy) return;

      // Phase 9C.2: grow the pending dirty region to cover this segment's
      // bounds too -- same bbox already computed above for rasterization,
      // just unioned into the running total instead of thrown away.
      if (this._dirty === null) {
        this._dirty = { sx, sy, ex, ey };
      } else {
        const d = this._dirty;
        if (sx < d.sx) d.sx = sx;
        if (sy < d.sy) d.sy = sy;
        if (ex > d.ex) d.ex = ex;
        if (ey > d.ey) d.ey = ey;
      }

      const cov = this.coverage;
      const bw = this.bw;
      for (let py = sy; py < ey; py++) {
        const wy = py + 0.5;
        const rowOff = py * bw;
        for (let px = sx; px < ex; px++) {
          const wx = px + 0.5;
          const axis = CapsuleMath.capsuleAxisDistance(wx, wy, x0, y0, x1, y1);
          const cov01 = CapsuleMath.capsuleCoverage(wx, wy, x0, y0, r0, x1, y1, r1);
          if (cov01 <= 0) continue;
          // Alpha (Flow/Opacity) is interpolated along the same `h` param
          // as radius, then folded into the accumulated value -- matches
          // the GPU fragment shader's `in.alpha * cov * subpixelArea`
          // (see hard-round-capsule-gpu.js's STROKE_SHADER_WGSL `fs`).
          const segAlpha = alpha0 + (alpha1 - alpha0) * axis.h;
          const c = cov01 * segAlpha;
          if (c <= 0) continue;
          const idx = rowOff + px;
          if (c > cov[idx]) cov[idx] = c; // max blend, matches GPU strokeMaskTex
        }
      }
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
      return true;
    }

    // Shared box-filter/color-mix core for both resolveInto() (full
    // canvas) and resolveDirtyInto() (a sub-rectangle) -- identical math
    // to the original resolveInto() body, just parameterized over which
    // output-pixel rectangle to iterate and where to putImageData it, so
    // the two never risk producing different pixel values for the same
    // coverage data.
    _resolveRegion(outCtx, rgb, composite, ox, oy, ow, oh) {
      const ss = this.ss, bw = this.bw;
      const cov = this.coverage;
      const img = outCtx.createImageData(ow, oh);
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
          const a = Math.max(0, Math.min(1, sum * norm));
          d[p] = cr; d[p + 1] = cg; d[p + 2] = cb; d[p + 3] = Math.round(a * 255);
        }
      }
      outCtx.putImageData(img, ox, oy);
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
    }

    // Lazily creates its own device/textures. Callers must not assume this
    // succeeds -- always check isAvailable() before relying on the GPU
    // path; the CPU path is the source of truth this phase.
    async init() {
      if (this.ready) return true;
      if (typeof navigator === 'undefined' || !navigator.gpu) return false;
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return false;
        const device = await adapter.requestDevice();
        this.device = device;

        const shaderModule = device.createShaderModule({ code: STROKE_SHADER_WGSL });
        this.strokePipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module: shaderModule, entryPoint: 'vs',
            buffers: [{
              arrayStride: 36,
              attributes: [
                { format: 'float32x2', offset: 0, shaderLocation: 0 },
                { format: 'float32x2', offset: 8, shaderLocation: 1 },
                { format: 'float32x2', offset: 16, shaderLocation: 2 },
                { format: 'float32', offset: 24, shaderLocation: 3 },
                { format: 'float32', offset: 28, shaderLocation: 4 },
                { format: 'float32', offset: 32, shaderLocation: 5 },
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

        this.ready = true;
        return true;
      } catch (err) {
        this.ready = false;
        return false;
      }
    }

    isAvailable() {
      return this.ready;
    }

    reset() {
      if (!this.ready) return;
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.strokeMaskTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
      });
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }

    drawSegment(seg) {
      const ss = this.ss;
      const verts = segmentVerts(
        seg.x0 * ss, seg.y0 * ss, seg.x1 * ss, seg.y1 * ss,
        seg.r0 * ss, seg.r1 * ss, Math.max(seg.alpha0, seg.alpha1)
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
      const uniforms = new Float32Array([this.bw, this.bh, 0, 0, 0, 0, 0, 0]);
      this.device.queue.writeBuffer(this.strokeUniformBuf, 0, uniforms);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: this.strokeMaskTex.createView(), loadOp: 'load', storeOp: 'store' }],
      });
      pass.setPipeline(this.strokePipeline);
      pass.setBindGroup(0, this.strokeBindGroup);
      pass.setVertexBuffer(0, this.vertexBuf);
      pass.draw(data.length / 9);
      pass.end();
      this.device.queue.submit([enc.finish()]);
      this.pendingVerts = [];
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
  }

  // Ported verbatim (semantics-preserving) from prototype's strokeShader /
  // hard-round-capsule-gpu.js's STROKE_SHADER_WGSL, minus the base-layer
  // color mix (this module's GPU output is coverage-only, same split as
  // the CPU backend above).
  const STROKE_SHADER_WGSL = `
    struct Uniforms { size: vec2f, color: vec3f, mode: f32 };
    @group(0) @binding(0) var<uniform> u: Uniforms;
    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) p0: vec2f, @location(1) p1: vec2f,
      @location(2) r0: f32, @location(3) r1: f32, @location(4) alpha: f32,
    };
    @vertex
    fn vs(@location(0) position: vec2f, @location(1) p0: vec2f, @location(2) p1: vec2f,
          @location(3) r0: f32, @location(4) r1: f32, @location(5) alpha: f32) -> VSOut {
      var out: VSOut;
      let ndc = vec2f((position.x / u.size.x) * 2.0 - 1.0, 1.0 - (position.y / u.size.y) * 2.0);
      out.pos = vec4f(ndc, 0.0, 1.0);
      out.p0 = p0; out.p1 = p1; out.r0 = r0; out.r1 = r1; out.alpha = alpha;
      return out;
    }
    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let pa = in.pos.xy - in.p0;
      let ba = in.p1 - in.p0;
      let denom = dot(ba, ba);
      let rawH = dot(pa, ba) / max(denom, 1e-6);
      let h = clamp(rawH, 0.0, 1.0);
      let localRadius = mix(in.r0, in.r1, h);
      let isRoundDab = denom < 1e-6;
      let roundDabDistance = length(pa) - in.r0;
      let segmentDistance = length(pa - ba * h) - localRadius;
      let d = select(segmentDistance, roundDabDistance, isRoundDab);
      let aa = max(fwidth(d), 1e-4);
      let cov = clamp(0.5 - d / aa, 0.0, 1.0);
      let circleArea = min(1.0, 3.14159265 * localRadius * localRadius);
      let strokeWidth = min(1.0, 2.0 * localRadius);
      let subpixelArea = select(strokeWidth, circleArea, isRoundDab);
      return vec4f(in.alpha * cov * subpixelArea, 0.0, 0.0, 1.0);
    }
  `;

  // Ported from prototype's blitShader, minus the *16 4x4 hardcode -- this
  // module parameterizes the box size by `ss` so it isn't silently wrong
  // if this renderer is ever constructed with a non-4 supersample factor.
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
      @fragment
      fn fs(in: VSOut) -> @location(0) vec4f {
        let sourceOrigin = vec2i(in.pos.xy) * ${ss};
        var sum = 0.0;
        for (var y = 0; y < ${ss}; y = y + 1) {
          for (var x = 0; x < ${ss}; x = x + 1) {
            sum = sum + textureLoad(tex, sourceOrigin + vec2i(x, y), 0).r;
          }
        }
        let cov = sum * (1.0 / ${(ss * ss).toFixed(1)});
        return vec4f(cov, cov, cov, cov);
      }
    `;
  }

  const AA_MARGIN = 2.0;
  function segmentVerts(x0, y0, x1, y1, r0, r1, alpha) {
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
    const v = (p) => [p.x, p.y, x0, y0, x1, y1, r0, r1, alpha];
    const out = [];
    out.push.apply(out, v(c0)); out.push.apply(out, v(c1)); out.push.apply(out, v(c2));
    out.push.apply(out, v(c0)); out.push.apply(out, v(c2)); out.push.apply(out, v(c3));
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
      this._gpuInitPromise = null;

      this._active = false;
      this._usingGpu = false;
      this._composite = 'paint';
      this._rgb = [0, 0, 0];
      this._segmentCount = 0;

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
      if (this._active) this.cancelStroke();
      this._active = true;
      this._segmentCount = 0;
      this._composite = 'paint';
      this._rgb = [0, 0, 0];
      this.cpu.reset();
      if (this._outCtx) this._outCtx.clearRect(0, 0, this.width, this.height);

      if (this.preferGpu && !this._gpuInitPromise) {
        this._gpuInitPromise = this.gpu.init();
      }
      this._usingGpu = this.preferGpu && this.gpu.isAvailable();
      if (this._usingGpu) this.gpu.reset();
    }

    // Accumulates render-ready segments (see module doc for shape) into
    // the current stroke's backing store. Safe to call multiple times per
    // stroke (once per pointermove batch), matching how the rest of this
    // app already batches segment dispatch.
    drawSegments(segments) {
      if (!this._active || !segments || !segments.length) return;
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        this._rgb = seg.rgb || this._rgb;
        this._composite = seg.composite || this._composite;
        if (this._usingGpu) this.gpu.drawSegment(seg);
        else this.cpu.drawSegment(seg);
        this._segmentCount++;
      }
      if (this._usingGpu) this.gpu.flush();
    }

    // Shared resolve step: reads (does not mutate) the current backing-store
    // accumulation into _outCtx/_outCanvas. Used by both endStroke() (which
    // also deactivates the stroke) and peekStroke() (which does not), so
    // there is exactly one resolve code path for both -- no separate
    // preview-only pixel path exists to drift out of sync with the real one.
    async _resolveToOutput() {
      if (this._usingGpu) {
        const ok = await this.gpu.resolveInto(this._outCtx, this._rgb, this._composite);
        if (!ok) {
          // GPU resolve failed unexpectedly mid-stroke -- there is no CPU
          // accumulation to fall back to for THIS stroke (segments already
          // went to the GPU path only), so surface an empty result rather
          // than silently drawing nothing believable.
          this._outCtx && this._outCtx.clearRect(0, 0, this.width, this.height);
        }
      } else {
        this.cpu.resolveInto(this._outCtx, this._rgb, this._composite);
      }
    }

    // Resolves the accumulated backing store down to logical resolution
    // and returns the finished stroke canvas. Synchronous on the CPU path;
    // the GPU path's readback is async, so callers awaiting a GPU-backed
    // result should `await` this. `_commitStrokeCanvas()` (elsewhere, not
    // touched by this module) is the intended consumer of the returned
    // canvas.
    //
    // @returns {Promise<{canvas: HTMLCanvasElement|OffscreenCanvas, composite: string, segmentCount: number}>}
    async endStroke() {
      if (!this._active) return { canvas: this._outCanvas, composite: this._composite, segmentCount: 0 };
      this._active = false;
      await this._resolveToOutput();
      return { canvas: this._outCanvas, composite: this._composite, segmentCount: this._segmentCount };
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
    async peekStroke() {
      if (!this._active) return { canvas: this._outCanvas, composite: this._composite, segmentCount: this._segmentCount };
      if (this._usingGpu) {
        await this._resolveToOutput();
      } else {
        this.cpu.resolveDirtyInto(this._outCtx, this._rgb, this._composite);
      }
      return { canvas: this._outCanvas, composite: this._composite, segmentCount: this._segmentCount };
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
    }
  }

  const PrototypeRendererExports = { PrototypeRenderer, DEFAULT_SS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PrototypeRendererExports;
  }
  if (typeof window !== 'undefined') {
    window.PrototypeRenderer = PrototypeRenderer;
    window.PrototypeRendererModule = PrototypeRendererExports;
  }
})(typeof window !== 'undefined' ? window : globalThis);