// src/brush/custom-tip-gpu-renderer.js
//
// Phase 3B: Generic WebGPU Custom-Tip Stamper (Shadow/Diagnostic Mode)
// Consumes resolved dabs from _emitResolvedCustomTipDab seam.
// Pure WebGPU instanced sprite rasterization into an offscreen render target.
//

(() => {
  'use strict';

  const INSTANCE_FLOAT_COUNT = 12; // pos(2), radius(1), rotation(1), roundness(1), opacity(1), color(3), composite(1), flipX(1), flipY(1)
  const MAX_INSTANCES_PER_BATCH = 2048;

  const SHADER_WGSL = `
    struct Uniforms {
      canvasSize: vec2f,
      tipAspect: vec2f,
    };

    struct InstanceInput {
      @location(0) pos: vec2f,
      @location(1) radius: f32,
      @location(2) rotation: f32,
      @location(3) roundness: f32,
      @location(4) opacity: f32,
      @location(5) color: vec3f,
      @location(6) composite: f32,
      @location(7) flipX: f32,
      @location(8) flipY: f32,
    };

    struct VertexOutput {
      @builtin(position) clipPos: vec4f,
      @location(0) uv: vec2f,
      @location(1) opacity: f32,
      @location(2) color: vec3f,
      @location(3) composite: f32,
    };

    @group(0) @binding(0) var<uniform> u: Uniforms;
    @group(0) @binding(1) var tipSampler: sampler;
    @group(0) @binding(2) var tipTexture: texture_2d<f32>;

    @vertex
    fn vs(
      @builtin(vertex_index) vertexIndex: u32,
      instance: InstanceInput
    ) -> VertexOutput {
      // Unit quad centered at (0,0): 6 vertices for 2 triangles
      var quadOffsets = array<vec2f, 6>(
        vec2f(-0.5, -0.5),
        vec2f( 0.5, -0.5),
        vec2f(-0.5,  0.5),
        vec2f(-0.5,  0.5),
        vec2f( 0.5, -0.5),
        vec2f( 0.5,  0.5)
      );

      var quadUVs = array<vec2f, 6>(
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0)
      );

      let localOffset = quadOffsets[vertexIndex];
      let uv = quadUVs[vertexIndex];

      // Custom tip aspect ratio scaling
      let compressWidth = u.tipAspect.x < u.tipAspect.y;
      let roundFactor = max(0.01, min(1.0, instance.roundness));
      let scaleW = u.tipAspect.x * (select(1.0, roundFactor, compressWidth));
      let scaleH = u.tipAspect.y * (select(roundFactor, 1.0, compressWidth));

      // Dab dimensions (diameter = 2.0 * radius)
      let dabW = scaleW * 2.0 * instance.radius * instance.flipX;
      let dabH = scaleH * 2.0 * instance.radius * instance.flipY;

      let scaledLocal = vec2f(localOffset.x * dabW, localOffset.y * dabH);

      // Rotation around dab center
      let cosR = cos(instance.rotation);
      let sinR = sin(instance.rotation);
      let rotatedLocal = vec2f(
        scaledLocal.x * cosR - scaledLocal.y * sinR,
        scaledLocal.x * sinR + scaledLocal.y * cosR
      );

      let worldPos = instance.pos + rotatedLocal;

      // Map canvas pixel coords (0..width, 0..height) to WebGPU clip space (-1..1, 1..-1)
      let clipX = (worldPos.x / u.canvasSize.x) * 2.0 - 1.0;
      let clipY = 1.0 - (worldPos.y / u.canvasSize.y) * 2.0;

      var out: VertexOutput;
      out.clipPos = vec4f(clipX, clipY, 0.0, 1.0);
      out.uv = uv;
      out.opacity = max(0.0, min(1.0, instance.opacity));
      out.color = instance.color;
      out.composite = instance.composite;
      return out;
    }

    @fragment
    fn fs(in: VertexOutput) -> @location(0) vec4f {
      let sampled = textureSample(tipTexture, tipSampler, in.uv);
      let maskAlpha = sampled.a;
      let finalAlpha = maskAlpha * in.opacity;

      if (finalAlpha <= 0.001) {
        discard;
      }

      if (in.composite > 0.5) {
        // Erase / destination-out mode
        return vec4f(0.0, 0.0, 0.0, finalAlpha);
      } else {
        // Paint / source-over mode (premultiplied alpha)
        return vec4f(in.color * finalAlpha, finalAlpha);
      }
    }
  `;

  class CustomTipGpuRenderer {
    constructor() {
      this.device = null;
      this.paintPipeline = null;
      this.erasePipeline = null;
      this.uniformBuffer = null;
      this.instanceBuffer = null;
      this.instanceData = new Float32Array(MAX_INSTANCES_PER_BATCH * INSTANCE_FLOAT_COUNT);
      this.instanceCount = 0;

      this.shadowTexture = null;
      this.shadowTextureView = null;
      this.targetWidth = 1000;
      this.targetHeight = 1000;

      this.active = false;
      this.currentStrokeId = null;
      this.resolvedDabCount = 0;
      this.gpuInstanceCount = 0;
      this.batchCount = 0;
      this.drawCallCount = 0;
      this.unsupportedDabCount = 0;
      this.fallbackReason = null;
      this.currentResource = null;
      this.taperCleared = false;
    }

    async initPipeline() {
      if (this.paintPipeline) return true;

      if (typeof window.CustomTipGpuResources === 'undefined') {
        this.fallbackReason = 'CustomTipGpuResources module unavailable';
        return false;
      }

      this.device = await window.CustomTipGpuResources.instance.getDevice();
      if (!this.device) {
        this.fallbackReason = 'No shared WebGPU device available';
        return false;
      }

      try {
        const shaderModule = this.device.createShaderModule({ code: SHADER_WGSL });

        this.uniformBuffer = this.device.createBuffer({
          size: 16, // vec2f canvasSize + vec2f tipAspect = 16 bytes
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.instanceBuffer = this.device.createBuffer({
          size: MAX_INSTANCES_PER_BATCH * INSTANCE_FLOAT_COUNT * 4,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });

        const vertexBufferLayout = {
          arrayStride: INSTANCE_FLOAT_COUNT * 4,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos
            { shaderLocation: 1, offset: 8, format: 'float32' },    // radius
            { shaderLocation: 2, offset: 12, format: 'float32' },   // rotation
            { shaderLocation: 3, offset: 16, format: 'float32' },   // roundness
            { shaderLocation: 4, offset: 20, format: 'float32' },   // opacity
            { shaderLocation: 5, offset: 24, format: 'float32x3' },  // color
            { shaderLocation: 6, offset: 36, format: 'float32' },   // composite
            { shaderLocation: 7, offset: 40, format: 'float32' },   // flipX
            { shaderLocation: 8, offset: 44, format: 'float32' },   // flipY
          ]
        };

        const bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ]
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout]
        });

        // Paint pipeline: premultiplied source-over alpha blending
        this.paintPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: 'vs',
            buffers: [vertexBufferLayout]
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list' }
        });

        // Erase pipeline: destination-out alpha blending
        this.erasePipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: {
            module: shaderModule,
            entryPoint: 'vs',
            buffers: [vertexBufferLayout]
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs',
            targets: [{
              format: 'rgba8unorm',
              blend: {
                color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' }
              }
            }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.bindGroupLayout = bindGroupLayout;
        return true;
      } catch (e) {
        this.fallbackReason = 'Failed to create WebGPU pipelines: ' + (e.message || String(e));
        return false;
      }
    }

    ensureShadowTexture(w, h) {
      if (this.shadowTexture && this.targetWidth === w && this.targetHeight === h) return;
      if (this.shadowTexture) {
        try { this.shadowTexture.destroy(); } catch (e) {}
      }
      this.targetWidth = w;
      this.targetHeight = h;
      if (!this.device) return;

      this.shadowTexture = this.device.createTexture({
        size: [w, h, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.shadowTextureView = this.shadowTexture.createView();
    }

    clearShadowTarget() {
      if (!this.device || !this.shadowTextureView) return;
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.shadowTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }

    async beginStroke(settings = {}) {
      if (!window.CustomBrushDebugGpuTipRenderer) return;

      const targetCanvas = (typeof _strokeCanvas !== 'undefined' && _strokeCanvas) ? _strokeCanvas : (typeof activeC !== 'undefined' && activeC ? activeC : null);
      const w = settings.width || (targetCanvas ? targetCanvas.width : 1000);
      const h = settings.height || (targetCanvas ? targetCanvas.height : 1000);

      this.active = true;
      this.currentStrokeId = settings.strokeId || (typeof _activeStrokeSession !== 'undefined' ? _activeStrokeSession : 1);
      this.resolvedDabCount = 0;
      this.gpuInstanceCount = 0;
      this.batchCount = 0;
      this.drawCallCount = 0;
      this.unsupportedDabCount = 0;
      this.instanceCount = 0;
      this.taperCleared = false;
      this.currentResource = null;
      this.pendingDabsQueue = [];

      this.resourcePromise = (async () => {
        const ok = await this.initPipeline();
        if (!ok) return false;

        this.ensureShadowTexture(w, h);
        this.clearShadowTarget();

        if (typeof window.CustomTipGpuResources !== 'undefined') {
          this.currentResource = await window.CustomTipGpuResources.getOrCreateCurrentTipResource();
        }

        if (this.pendingDabsQueue && this.pendingDabsQueue.length > 0) {
          const queue = this.pendingDabsQueue.slice();
          this.pendingDabsQueue.length = 0;
          for (let i = 0; i < queue.length; i++) {
            this._processDab(queue[i].d, queue[i].options);
          }
        }
        return true;
      })();
    }

    addDab(d, options = {}) {
      if (!this.active) return;
      this.resolvedDabCount++;

      if (this.currentResource) {
        this._processDab(d, options);
      } else {
        if (!this.pendingDabsQueue) this.pendingDabsQueue = [];
        this.pendingDabsQueue.push({ d, options });
      }
    }

    _processDab(d, options = {}) {
      if (!this.active || !this.device || !this.paintPipeline) return;

      // Handle taper replay reset on first replayed dab
      if (options && options.isTaperReplay) {
        if (options.taperIndex === 0 || !this.taperCleared) {
          this.flushBatch();
          this.clearShadowTarget();
          this.gpuInstanceCount = 0;
          this.batchCount = 0;
          this.drawCallCount = 0;
          this.taperCleared = true;
        }
      } else {
        this.taperCleared = false;
      }

      if (!this.currentResource || !this.currentResource.view) {
        this.unsupportedDabCount++;
        return;
      }

      const r = d.r || d.radius || 1;
      const alpha = d.alpha != null ? d.alpha : (d.opacity != null ? d.opacity : 1);
      const rgb = d.rgb || [0, 0, 0];
      const composite = d.composite === 'erase' ? 1.0 : 0.0;

      const reflected = (typeof flipX !== 'undefined' ? !!flipX : false) !== (typeof flipY !== 'undefined' ? !!flipY : false);
      const rotation = reflected ? -(d.rotation || 0) : (d.rotation || 0);
      const roundness = d.roundness != null ? d.roundness : (typeof window !== 'undefined' && window.brushTipRoundness == null ? 1 : window.brushTipRoundness);

      const fX = window.brushTipFlipX ? -1.0 : 1.0;
      const fY = window.brushTipFlipY ? -1.0 : 1.0;

      if (this.instanceCount >= MAX_INSTANCES_PER_BATCH) {
        this.flushBatch();
      }

      const offset = this.instanceCount * INSTANCE_FLOAT_COUNT;
      this.instanceData[offset + 0] = d.x;
      this.instanceData[offset + 1] = d.y;
      this.instanceData[offset + 2] = r;
      this.instanceData[offset + 3] = rotation;
      this.instanceData[offset + 4] = roundness;
      this.instanceData[offset + 5] = alpha;
      this.instanceData[offset + 6] = rgb[0] / 255.0;
      this.instanceData[offset + 7] = rgb[1] / 255.0;
      this.instanceData[offset + 8] = rgb[2] / 255.0;
      this.instanceData[offset + 9] = composite;
      this.instanceData[offset + 10] = fX;
      this.instanceData[offset + 11] = fY;

      this.instanceCount++;
      this.gpuInstanceCount++;
    }

    flushBatch() {
      if (!this.active || !this.device || this.instanceCount === 0 || !this.currentResource) return;

      const res = this.currentResource;
      const tipNativeW = res.width || 1;
      const tipNativeH = res.height || 1;
      const reference = Math.max(tipNativeW, tipNativeH);
      const tipAspectX = tipNativeW / reference;
      const tipAspectY = tipNativeH / reference;

      // 1. Upload Uniforms
      const uniforms = new Float32Array([this.targetWidth, this.targetHeight, tipAspectX, tipAspectY]);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

      // 2. Upload Instance Buffer
      const byteLength = this.instanceCount * INSTANCE_FLOAT_COUNT * 4;
      this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData.buffer, 0, byteLength);

      // 3. Create Bind Group for current resource
      const sampler = res.samplerLinear || res.samplerNearest;
      if (!sampler || !res.view) return;

      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: res.view }
        ]
      });

      // 4. Record and submit GPU instanced draw call
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.shadowTextureView,
          loadOp: 'load',
          storeOp: 'store'
        }]
      });

      pass.setPipeline(this.paintPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, this.instanceBuffer);
      pass.draw(6, this.instanceCount, 0, 0);
      pass.end();

      this.device.queue.submit([encoder.finish()]);

      this.batchCount++;
      this.drawCallCount++;
      this.instanceCount = 0;
    }

    async endStroke() {
      if (!this.active) return;

      if (this.resourcePromise) {
        await this.resourcePromise;
      }

      if (this.pendingDabsQueue && this.pendingDabsQueue.length > 0) {
        const queue = this.pendingDabsQueue.slice();
        this.pendingDabsQueue.length = 0;
        for (let i = 0; i < queue.length; i++) {
          this._processDab(queue[i].d, queue[i].options);
        }
      }

      this.flushBatch();
      this.active = false;
    }
  }

  const renderer = new CustomTipGpuRenderer();

  if (typeof window !== 'undefined') {
    window.CustomTipGpuRenderer = CustomTipGpuRenderer;
    window._customTipGpuRenderer = {
      onResolvedDab(d, options) {
        if (window.CustomBrushDebugGpuTipRenderer) {
          renderer.addDab(d, options);
        }
      },
      beginStroke(settings) {
        if (window.CustomBrushDebugGpuTipRenderer) {
          renderer.beginStroke(settings);
        }
      },
      endStroke() {
        if (window.CustomBrushDebugGpuTipRenderer) {
          renderer.endStroke();
        }
      },
      instance: renderer
    };

    window.CustomBrushAnalyzeGpuTipRenderer = function() {
      const res = renderer.currentResource;
      const deviceLost = renderer.device ? !!renderer.device.lostReason : false;

      return {
        available: !!navigator.gpu && !!renderer.paintPipeline,
        active: renderer.active,
        strokeId: renderer.currentStrokeId,

        tipAssetId: res ? res.assetId : null,
        tipAssetVersion: res ? res.tipVersion : null,
        legacyBrushTipVersion: typeof window !== 'undefined' ? (window.brushTipVersion || 0) : 0,
        tipDimensions: res ? { width: res.width, height: res.height } : null,

        resolvedDabCount: renderer.resolvedDabCount,
        gpuInstanceCount: renderer.gpuInstanceCount,

        batchCount: renderer.batchCount,
        drawCallCount: renderer.drawCallCount,

        targetWidth: renderer.targetWidth,
        targetHeight: renderer.targetHeight,

        pipelineReady: !!renderer.paintPipeline,
        resourceReady: !!res,

        unsupportedDabCount: renderer.unsupportedDabCount,
        fallbackReason: renderer.fallbackReason,

        deviceLost
      };
    };
  }
})();
