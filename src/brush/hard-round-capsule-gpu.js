// src/brush/hard-round-capsule-gpu.js
//
// Phase 8C completion — optional WebGPU capsule renderer for migrated
// Hard Round strokes, ported from prototype/prototype.html's `strokeShader`
// + `segmentVerts`/`circleVerts` + accumulation-texture/blit pipeline
// (lines ~488-863 of the prototype).
//
// IMPORTANT / honest status: this repo's production WebGPU usage
// (src/core/display-backend.js) is a PRESENTATION-only backend -- it
// uploads an already-composited 2D canvas as a texture for smooth
// zoom/pan display, and owns no persistent paint-time accumulation
// texture or per-stroke rasterization pipeline. There is therefore no
// existing live "paint" GPU device/surface for this module to attach to
// on this branch, and per §12/§6 of the brief this module does NOT create
// a second, independent WebGPU canvas/device to fill that gap.
//
// This module is written to the same analytic capsule model as the CPU
// renderer (hard-round-capsule-math.js) and is fully wired for future use
// -- if a host application supplies a real GPUDevice + presentable
// surface via HardRoundCapsuleGPU.attach(device, target), segments will
// render on the GPU. Until attach() is called, isAvailable() reports
// false and the shared dispatch seam (see hard-round-adapter usage in
// brush-engine.js) transparently uses the CPU capsule renderer instead.
// This GPU path has NOT been runtime-verified (no browser/GPU in the
// environment this phase was implemented in) -- see the Phase 8C report,
// §"Known remaining limitations", for what full GPU wiring still needs.

'use strict';

(function (root) {
  // Ported verbatim (semantics-preserving) from prototype's strokeShader.
  // p0/p1/r0/r1/alpha are per-vertex; the fragment shader resolves the
  // exact analytic capsule distance per fragment, same as
  // hard-round-capsule-math.js's capsuleSignedDistance/capsuleCoverage.
  const STROKE_SHADER_WGSL = `
    struct Uniforms {
      size: vec2f,
      color: vec3f,
      mode: f32,
    };
    @group(0) @binding(0) var<uniform> u: Uniforms;

    struct VSOut {
      @builtin(position) pos: vec4f,
      @location(0) p0: vec2f,
      @location(1) p1: vec2f,
      @location(2) r0: f32,
      @location(3) r1: f32,
      @location(4) alpha: f32,
    };

    @vertex
    fn vs(
      @location(0) position: vec2f,
      @location(1) p0: vec2f,
      @location(2) p1: vec2f,
      @location(3) r0: f32,
      @location(4) r1: f32,
      @location(5) alpha: f32
    ) -> VSOut {
      var out: VSOut;
      let ndc = vec2f(
        (position.x / u.size.x) * 2.0 - 1.0,
        1.0 - (position.y / u.size.y) * 2.0
      );
      out.pos = vec4f(ndc, 0.0, 1.0);
      out.p0 = p0;
      out.p1 = p1;
      out.r0 = r0;
      out.r1 = r1;
      out.alpha = alpha;
      return out;
    }

    fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
      let pa = p - a;
      let ba = b - a;
      let denom = dot(ba, ba);
      let h = select(clamp(dot(pa, ba) / denom, 0.0, 1.0), 0.0, denom < 1e-6);
      return length(pa - ba * h);
    }

    @fragment
    fn fs(in: VSOut) -> @location(0) vec4f {
      let eraseColor = vec3f(1.0, 1.0, 1.0);
      let rgb = select(u.color, eraseColor, u.mode > 0.5);
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

  const AA_MARGIN = 2.0;

  // Bounding-quad builder for one tapered capsule -- identical geometry to
  // prototype's segmentVerts (2 triangles, 6 verts, 9 floats/vert:
  // position.xy, p0.xy, p1.xy, r0, r1, alpha).
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

  let _device = null;
  let _pipeline = null;
  let _uniformBuf = null;
  let _bindGroup = null;
  let _vertexBuf = null;
  let _pendingVerts = []; // batched across draw() calls until flush()

  // Attach a real GPUDevice + a target this module renders capsules into.
  // Not called anywhere in this branch's production code yet -- see module
  // doc above. Exposed so a future integration (or a test harness with a
  // WebGPU shim) can opt in without touching this file.
  function attach(device, targetFormat) {
    if (!device) return false;
    _device = device;
    const shaderModule = device.createShaderModule({ code: STROKE_SHADER_WGSL });
    _pipeline = device.createRenderPipeline({
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
          format: targetFormat || 'r8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    _uniformBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    _bindGroup = device.createBindGroup({
      layout: _pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: _uniformBuf } }],
    });
    _vertexBuf = device.createBuffer({
      size: 4 * 1024 * 1024, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    return true;
  }

  function isAvailable() {
    return !!_device && !!_pipeline;
  }

  // Queue one render-ready segment (see hard-round-capsule-renderer.js's
  // doc comment for the object shape) for the next flush(). Batches
  // multiple segments into one persistent/reused vertex buffer instead of
  // submitting once per segment (§6 requirement).
  function drawSegment(seg) {
    if (!seg) return;
    const verts = segmentVerts(seg.x0, seg.y0, seg.x1, seg.y1, seg.r0, seg.r1,
      Math.max(seg.alpha0, seg.alpha1));
    _pendingVerts.push.apply(_pendingVerts, verts);
  }

  // Submit every segment queued since the last flush() in a single GPU
  // command buffer.
  function flush(renderPassTarget) {
    if (!isAvailable() || !_pendingVerts.length || !renderPassTarget) {
      _pendingVerts = [];
      return;
    }
    const data = new Float32Array(_pendingVerts);
    const bytesNeeded = data.byteLength;
    if (bytesNeeded > _vertexBuf.size) {
      _vertexBuf.destroy();
      let sz = _vertexBuf.size;
      while (sz < bytesNeeded) sz *= 2;
      _vertexBuf = _device.createBuffer({ size: sz, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    _device.queue.writeBuffer(_vertexBuf, 0, data);
    const encoder = _device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: renderPassTarget, loadOp: 'load', storeOp: 'store',
      }],
    });
    pass.setPipeline(_pipeline);
    pass.setBindGroup(0, _bindGroup);
    pass.setVertexBuffer(0, _vertexBuf);
    pass.draw(data.length / 9);
    pass.end();
    _device.queue.submit([encoder.finish()]);
    _pendingVerts = [];
  }

  const HardRoundCapsuleGPUExports = {
    STROKE_SHADER_WGSL, segmentVerts, attach, isAvailable, drawSegment, flush,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HardRoundCapsuleGPUExports;
  }
  if (typeof root !== 'undefined') {
    root.HardRoundCapsuleGPU = HardRoundCapsuleGPUExports;
  }
})(typeof window !== 'undefined' ? window : globalThis);
