// src/brush/custom-tip-gpu-renderer.js
//
// Phase 3B/3C: Generic WebGPU Custom-Tip Stamper & Diagnostic Preview
// Consumes resolved dabs from _emitResolvedCustomTipDab seam.
// Pure WebGPU instanced sprite rasterization into an offscreen render target.
// Diagnostic preview via window.CustomBrushDebugGpuTipPreview = true.
//

(() => {
  'use strict';

  const INSTANCE_FLOAT_COUNT = 14; // pos(2), radius(1), rotation(1), roundness(1), opacity(1), color(3), composite(1), flipX(1), flipY(1), inner(1), pad0(1)
  const MAX_INSTANCES_PER_BATCH = 2048;

  const SHADER_WGSL = `
    struct Uniforms {
      canvasSize: vec2f,
      tipAspect: vec2f,
      legacyAlphaOnlyMask: f32,
      pad0: f32,
      pad1: f32,
      pad2: f32,
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
      @location(9) inner: f32,
    };

    struct VertexOutput {
      @builtin(position) clipPos: vec4f,
      @location(0) uv: vec2f,
      @location(1) opacity: f32,
      @location(2) color: vec3f,
      @location(3) composite: f32,
      @location(4) inner: f32,
    };

    @group(0) @binding(0) var<uniform> u: Uniforms;
    @group(0) @binding(1) var tipSampler: sampler;
    @group(0) @binding(2) var tipTexture: texture_2d<f32>;

    @vertex
    fn vs(
      @builtin(vertex_index) vertexIndex: u32,
      instance: InstanceInput
    ) -> VertexOutput {
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

      // Custom tip aspect ratio scaling (reproducing legacy _buildTipStamp semantics)
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
      out.inner = instance.inner;
      return out;
    }

    fn roundBrushFalloff(t: f32, inner: f32) -> f32 {
      if (inner < 0.0) { return 1.0; }
      if (t >= 1.0) { return 0.0; }
      if (t <= inner) { return 1.0; }
      let u = (t - inner) / max(0.0001, 1.0 - inner);
      return 1.0 - u * u * (3.0 - 2.0 * u);
    }

    @fragment
    fn fs(in: VertexOutput) -> @location(0) vec4f {
      let sampled = textureSample(tipTexture, tipSampler, in.uv);
      let sourceAlpha = sampled.a;
      let luminance = dot(sampled.rgb, vec3f(0.2126, 0.7152, 0.0722));
      let tipAlpha = select(sourceAlpha * luminance, sourceAlpha, u.legacyAlphaOnlyMask > 0.5);

      let normOffset = (in.uv - vec2f(0.5, 0.5)) * 2.0;
      let t = length(normOffset);
      let falloff = roundBrushFalloff(t, in.inner);
      let finalAlpha = tipAlpha * in.opacity * falloff;

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

  const RESOLVE_SHADER_WGSL = `
    struct VertexOutput {
      @builtin(position) clipPos: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
      );
      var uvs = array<vec2f, 6>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
        vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
      );
      var out: VertexOutput;
      out.clipPos = vec4f(pos[vertexIndex], 0.0, 1.0);
      out.uv = uvs[vertexIndex];
      return out;
    }

    @group(0) @binding(0) var ssTexture: texture_2d<f32>;

    fn resolveBox1x1(tex: texture_2d<f32>, outPos: vec2i) -> vec4f {
      return textureLoad(tex, outPos, 0);
    }

    fn resolveBox2x2(tex: texture_2d<f32>, outPos: vec2i) -> vec4f {
      let origin = outPos * 2;
      let s00 = textureLoad(tex, origin + vec2i(0, 0), 0);
      let s10 = textureLoad(tex, origin + vec2i(1, 0), 0);
      let s01 = textureLoad(tex, origin + vec2i(0, 1), 0);
      let s11 = textureLoad(tex, origin + vec2i(1, 1), 0);
      return (s00 + s10 + s01 + s11) * 0.25;
    }

    fn resolveBox3x3(tex: texture_2d<f32>, outPos: vec2i) -> vec4f {
      let origin = outPos * 3;
      var sum = vec4f(0.0, 0.0, 0.0, 0.0);
      for (var y = 0; y < 3; y++) {
        for (var x = 0; x < 3; x++) {
          sum += textureLoad(tex, origin + vec2i(x, y), 0);
        }
      }
      return sum * (1.0 / 9.0);
    }

    fn resolveBox4x4(tex: texture_2d<f32>, outPos: vec2i) -> vec4f {
      let origin = outPos * 4;
      var sum = vec4f(0.0, 0.0, 0.0, 0.0);
      for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
          sum += textureLoad(tex, origin + vec2i(x, y), 0);
        }
      }
      return sum * 0.0625;
    }

    @fragment
    fn fs1x(in: VertexOutput) -> @location(0) vec4f {
      return resolveBox1x1(ssTexture, vec2i(in.clipPos.xy));
    }

    @fragment
    fn fs2x(in: VertexOutput) -> @location(0) vec4f {
      return resolveBox2x2(ssTexture, vec2i(in.clipPos.xy));
    }

    @fragment
    fn fs3x(in: VertexOutput) -> @location(0) vec4f {
      return resolveBox3x3(ssTexture, vec2i(in.clipPos.xy));
    }

    @fragment
    fn fs4x(in: VertexOutput) -> @location(0) vec4f {
      return resolveBox4x4(ssTexture, vec2i(in.clipPos.xy));
    }
  `;

  const PRESENT_SHADER_WGSL = `
    struct VertexOutput {
      @builtin(position) clipPos: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
      );
      var uvs = array<vec2f, 6>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
        vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
      );
      var out: VertexOutput;
      out.clipPos = vec4f(pos[vertexIndex], 0.0, 1.0);
      out.uv = uvs[vertexIndex];
      return out;
    }

    @group(0) @binding(0) var texSampler: sampler;
    @group(0) @binding(1) var texTarget: texture_2d<f32>;

    @fragment
    fn fs(in: VertexOutput) -> @location(0) vec4f {
      return textureSample(texTarget, texSampler, in.uv);
    }
  `;

  const TEXTURE_STENCIL_SHADER_WGSL = `
    struct TextureUniforms {
      canvasSize: vec2f,
      texScaledSize: vec2f,
      texInvert: f32,
      texBrightness: f32,
      texContrast: f32,
      texStrength: f32,
    };

    struct VertexOutput {
      @builtin(position) clipPos: vec4f,
      @location(0) uv: vec2f,
    };

    @vertex
    fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var pos = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
        vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
      );
      var uvs = array<vec2f, 6>(
        vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
        vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
      );
      var out: VertexOutput;
      out.clipPos = vec4f(pos[vertexIndex], 0.0, 1.0);
      out.uv = uvs[vertexIndex];
      return out;
    }

    @group(0) @binding(0) var<uniform> u: TextureUniforms;
    @group(0) @binding(1) var strokeSampler: sampler;
    @group(0) @binding(2) var strokeTexture: texture_2d<f32>;
    @group(0) @binding(3) var paperSampler: sampler;
    @group(0) @binding(4) var paperTexture: texture_2d<f32>;

    @fragment
    fn fs(in: VertexOutput) -> @location(0) vec4f {
      let strokeSample = textureSample(strokeTexture, strokeSampler, in.uv);
      if (strokeSample.a <= 0.0001) {
        return vec4f(0.0, 0.0, 0.0, 0.0);
      }

      // Document / canvas coordinate sampling: in.clipPos.xy is anchored to canvas (0,0)
      let texCoord = in.clipPos.xy / u.texScaledSize;
      let paperSample = textureSampleLevel(paperTexture, paperSampler, texCoord, 0.0);

      // Paper grain luminance (0.2126*R + 0.7152*G + 0.0722*B)
      let lum = dot(paperSample.rgb, vec3f(0.2126, 0.7152, 0.0722));
      var t = select(lum, 1.0 - lum, u.texInvert > 0.5);

      // Brightness shift (-100..100 -> ±0.5)
      t = t + (u.texBrightness / 100.0) * 0.5;

      // Contrast slope (slope = pow(3, contrast / 100))
      let contrastSlope = pow(3.0, u.texContrast / 100.0);
      t = 0.5 + (t - 0.5) * contrastSlope;
      t = clamp(t, 0.0, 1.0);

      // Effective alpha lerp by strength: strokeAlpha * (1 - strength + strength * t)
      let effectiveAlphaFactor = (1.0 - u.texStrength + u.texStrength * t);
      let outAlpha = strokeSample.a * effectiveAlphaFactor;
      let outColor = strokeSample.rgb * effectiveAlphaFactor;
      return vec4f(outColor, outAlpha);
    }
  `;

  function shouldRunCustomTipGpuDiagnostic() {
    return typeof window !== 'undefined' && (
      !!window.CustomBrushDebugGpuTipRenderer ||
      !!window.CustomBrushDebugGpuTipPreview ||
      !!window.CustomBrushDebugGpuPresenter
    );
  }

  // The GPU paint pipeline (SHADER_WGSL's fs) writes premultiplied alpha --
  // vec4(color * finalAlpha, finalAlpha) -- into the rgba8unorm accumulation
  // texture, matching the premultiplied blend equations and the live
  // WebGPU canvas's `alphaMode: 'premultiplied'` configure() call. Canvas2D
  // ImageData/putImageData, however, always expects straight (non-
  // premultiplied) RGBA: the byte in each channel is taken as the true
  // color, not color*alpha. Copying the premultiplied texture bytes
  // directly into ImageData (as the readback previously did) therefore
  // under-represents RGB in proportion to alpha, which is most visible for
  // light colors at low alpha where the premultiplied byte range collapses
  // into a handful of discrete levels and reads as grain/speckle once
  // composited. This converts a single premultiplied byte back to its
  // straight equivalent given the pixel's alpha byte.
  function unpremultiplyByte(premulByte, alphaByte) {
    if (alphaByte === 0) return 0;
    const straight = Math.round((premulByte * 255) / alphaByte);
    if (straight < 0) return 0;
    if (straight > 255) return 255;
    return straight;
  }

  class CustomTipGpuRenderer {
    constructor() {
      this.device = null;
      this.paintPipeline = null;
      this.erasePipeline = null;
      this.uniformBuffer = null;
      this.instanceBuffer = null;
      this.instanceData = new Float32Array(MAX_INSTANCES_PER_BATCH * INSTANCE_FLOAT_COUNT);
      this.instanceCount = 0;

      this.ss = 1;
      this.ssWidth = 1000;
      this.ssHeight = 1000;

      this.shadowTexture = null;
      this.shadowTextureView = null;
      this.resolvedShadowTexture = null;
      this.resolvedShadowTextureView = null;
      this.texturedShadowTexture = null;
      this.texturedShadowTextureView = null;
      this.targetWidth = 1000;
      this.targetHeight = 1000;

      this.resolvePipeline = null;
      this.resolve1xPipeline = null;
      this.resolve2xPipeline = null;
      this.resolve3xPipeline = null;
      this.resolve4xPipeline = null;
      this.resolveBindGroupLayout = null;
      this.resolveDevice = null;

      this.textureStencilPipeline = null;
      this.textureStencilBindGroupLayout = null;
      this.textureStencilUniformBuffer = null;
      this.textureStencilSampler = null;

      this.active = false;
      this.currentStrokeId = null;
      this.resolvedDabCount = 0;
      this.liveDabCount = 0;
      this.taperReplayDabCount = 0;
      this.gpuInstanceCount = 0;

      this.batchCount = 0;
      this.drawCallCount = 0;
      this.targetClearCount = 0;
      this.unsupportedDabCount = 0;

      this.fallbackReason = null;
      this.currentResource = null;
      this.taperCleared = false;
      this.pendingDabsQueue = [];

      this.previewCanvas = null;
      this.previewPresented = false;
      this.nonTransparentPixelCount = 0;

      this.presentContext = null;
      this.presentPipeline = null;
      this.presentBindGroupLayout = null;
      this.presentSampler = null;
      this.overlayPresented = false;

      this.dirtyBounds = null;
      this.resolveCount = 0;
      this.lastResolveRect = null;
      this.lastResolveSucceeded = false;
      this.lastReadbackBytes = 0;
      this.lastFullCanvasReadbackUsed = false;
      this.sessionSafe = true;
    }

    async initPipeline() {
      if (this.paintPipeline) return true;
      const brushPerfInitStart=(typeof window!=='undefined'&&window.BrushDebugPerf)?performance.now():0;

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
          size: 32,
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
            { shaderLocation: 9, offset: 48, format: 'float32' },   // inner
          ]
        };

        const bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
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
        if(brushPerfInitStart&&window.BrushPerfNote)window.BrushPerfNote('gpu-init',{ms:performance.now()-brushPerfInitStart,first:true});
        return true;
      } catch (e) {
        this.fallbackReason = 'Failed to create WebGPU pipelines: ' + (e.message || String(e));
        if(brushPerfInitStart&&window.BrushPerfNote)window.BrushPerfNote('gpu-init',{ms:performance.now()-brushPerfInitStart,first:true});
        return false;
      }
    }

    initResolvePipeline() {
      if (this.resolvePipeline && this.resolveDevice === this.device) return true;
      if (!this.device) return false;
      try {
        const shaderModule = this.device.createShaderModule({ code: RESOLVE_SHADER_WGSL });
        this.resolveBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ]
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [this.resolveBindGroupLayout]
        });

        this.resolve1xPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs1x',
            targets: [{ format: 'rgba8unorm' }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.resolve2xPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs2x',
            targets: [{ format: 'rgba8unorm' }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.resolve3xPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs3x',
            targets: [{ format: 'rgba8unorm' }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.resolve4xPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs4x',
            targets: [{ format: 'rgba8unorm' }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.resolvePipeline = this.resolve2xPipeline;
        this.resolveDevice = this.device;
        return true;
      } catch (e) {
        console.warn('[CustomTipGpuRenderer] Failed to init resolve pipeline:', e);
        return false;
      }
    }

    initPresenter() {
      if (this.presentPipeline && this.presentDevice === this.device) return true;
      if (!this.device) return false;
      try {
        const overlayCanvas = document.getElementById('custom-tip-gpu-overlay');
        if (!overlayCanvas) return false;

        this.presentContext = overlayCanvas.getContext('webgpu');
        if (!this.presentContext) return false;

        this.presentFormat = navigator.gpu.getPreferredCanvasFormat();
        this.presentContext.configure({
          device: this.device,
          format: this.presentFormat,
          alphaMode: 'premultiplied'
        });

        const shaderModule = this.device.createShaderModule({ code: PRESENT_SHADER_WGSL });
        this.presentBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ]
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [this.presentBindGroupLayout]
        });

        this.presentPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs',
            targets: [{ format: this.presentFormat }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.presentSampler = this.device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear'
        });
        this.presentDevice = this.device;

        return true;
      } catch (e) {
        console.warn('[CustomTipGpuRenderer] Failed to init presenter:', e);
        return false;
      }
    }

    presentLiveOverlay() {
      if (!this.active || !this.device || !this.shadowTextureView) return { presented: false, reason: 'uninitialized' };
      if (!this.initPresenter()) return { presented: false, reason: 'presenter-init-failed' };

      const overlayCanvas = document.getElementById('custom-tip-gpu-overlay');
      if (!overlayCanvas) return { presented: false, reason: 'no-overlay-canvas' };

      if (window.CustomTipOverlayOwnerStrokeId != null && window.CustomTipOverlayOwnerStrokeId !== this.currentStrokeId) {
        return { presented: false, reason: 'not-overlay-owner' };
      }

      window.CustomTipOverlayOwnerStrokeId = this.currentStrokeId;
      window.CustomTipOverlayVisibilityOwnerStrokeId = this.currentStrokeId;

      if (overlayCanvas.width !== this.targetWidth || overlayCanvas.height !== this.targetHeight) {
        overlayCanvas.width = this.targetWidth;
        overlayCanvas.height = this.targetHeight;
      }
      overlayCanvas.style.display = 'block';
      overlayCanvas.hidden = false;

      // 1. Resolve SS shadow texture to 1x resolved texture
      this.renderResolvePass();

      // 2. Optional 1x paper texture stencil
      let sourceView = this.resolvedShadowTextureView;
      if (this.shouldApplyTextureStencil() && typeof window.CustomTipGpuResources !== 'undefined') {
        const mgr = window.CustomTipGpuResources.instance;
        if (mgr && mgr.cachedPaperTexture && mgr.cachedPaperTextureCanvas === window.brushTextureCanvas) {
          const paperResource = {
            texture: mgr.cachedPaperTexture,
            view: mgr.cachedPaperTextureView,
            sampler: mgr.sharedRepeatSampler,
            width: window.brushTextureCanvas.width,
            height: window.brushTextureCanvas.height
          };
          if (this.renderTextureStencilPass(paperResource) && this.texturedShadowTextureView) {
            sourceView = this.texturedShadowTextureView;
          }
        }
      }

      try {
        const currentView = this.presentContext.getCurrentTexture().createView();
        const bindGroup = this.device.createBindGroup({
          layout: this.presentBindGroupLayout,
          entries: [
            { binding: 0, resource: this.presentSampler },
            { binding: 1, resource: sourceView }
          ]
        });

        const encoder = this.device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: currentView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
          }]
        });

        pass.setPipeline(this.presentPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(6);
        pass.end();

        this.device.queue.submit([encoder.finish()]);
        this.overlayPresented = true;
        window.CustomTipOverlayPresentedStrokeId = this.currentStrokeId;
        return { presented: true, reason: null };
      } catch (e) {
        this.overlayPresented = false;
        return { presented: false, reason: e.message || String(e) };
      }
    }

    presentLiveImmediately() {
      if (!this.active) return { presented: false, reason: 'inactive' };
      if (this.presentRaf) {
        cancelAnimationFrame(this.presentRaf);
        this.presentRaf = 0;
      }
      this.flushBatch();
      return this.presentLiveOverlay();
    }

    hideLiveOverlay(strokeId) {
      const targetId = strokeId != null ? strokeId : this.currentStrokeId;
      const currentOwner = window.CustomTipOverlayOwnerStrokeId;
      if (currentOwner != null && currentOwner !== targetId) {
        return;
      }
      const overlayCanvas = document.getElementById('custom-tip-gpu-overlay');
      if (overlayCanvas) {
        overlayCanvas.style.display = 'none';
        overlayCanvas.hidden = true;
        if (window.CustomTipOverlayOwnerStrokeId === targetId) {
          window.CustomTipOverlayOwnerStrokeId = null;
        }
        if (window.CustomTipOverlayVisibilityOwnerStrokeId === targetId) {
          window.CustomTipOverlayVisibilityOwnerStrokeId = null;
        }
      }
      this.overlayPresented = false;
    }

    ensureTextures(w, h, ss = 2) {
      const needRealloc = !this.shadowTexture || this.targetWidth !== w || this.targetHeight !== h || this.ss !== ss;
      if (!needRealloc) return;

      if (this.shadowTexture) {
        try { this.shadowTexture.destroy(); } catch (e) {}
        this.shadowTexture = null;
        this.shadowTextureView = null;
      }
      if (this.resolvedShadowTexture) {
        try { this.resolvedShadowTexture.destroy(); } catch (e) {}
        this.resolvedShadowTexture = null;
        this.resolvedShadowTextureView = null;
      }
      if (this.texturedShadowTexture) {
        try { this.texturedShadowTexture.destroy(); } catch (e) {}
        this.texturedShadowTexture = null;
        this.texturedShadowTextureView = null;
      }

      this.targetWidth = w;
      this.targetHeight = h;
      this.ss = ss;
      this.ssWidth = w * ss;
      this.ssHeight = h * ss;

      if (!this.device) return;

      // 1. Supersampled shadow texture
      this.shadowTexture = this.device.createTexture({
        size: [this.ssWidth, this.ssHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.shadowTextureView = this.shadowTexture.createView();

      // 2. 1x Resolved shadow texture
      this.resolvedShadowTexture = this.device.createTexture({
        size: [this.targetWidth, this.targetHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.resolvedShadowTextureView = this.resolvedShadowTexture.createView();

      // 3. 1x Textured shadow texture (for paper texture stencil)
      this.texturedShadowTexture = this.device.createTexture({
        size: [this.targetWidth, this.targetHeight, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      });
      this.texturedShadowTextureView = this.texturedShadowTexture.createView();
    }

    ensureShadowTexture(w, h) {
      this.ensureTextures(w, h, this.ss || 3);
    }

    ensureTexturedShadowTexture(w, h) {
      this.ensureTextures(w, h, this.ss || 3);
    }

    renderResolvePass() {
      if (!this.device || !this.shadowTextureView || !this.resolvedShadowTextureView) return false;
      if (!this.initResolvePipeline()) return false;

      const bindGroup = this.device.createBindGroup({
        layout: this.resolveBindGroupLayout,
        entries: [
          { binding: 0, resource: this.shadowTextureView }
        ]
      });

      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.resolvedShadowTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      let pipeline = this.resolve1xPipeline;
      if (this.ss === 2) {
        pipeline = this.resolve2xPipeline;
      } else if (this.ss === 3) {
        pipeline = this.resolve3xPipeline;
      } else if (this.ss === 4) {
        pipeline = this.resolve4xPipeline;
      }

      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      this.device.queue.submit([encoder.finish()]);
      return true;
    }

    initTextureStencilPipeline() {
      if (this.textureStencilPipeline || !this.device) return !!this.textureStencilPipeline;
      try {
        const shaderModule = this.device.createShaderModule({ code: TEXTURE_STENCIL_SHADER_WGSL });
        this.textureStencilUniformBuffer = this.device.createBuffer({
          size: 32,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.textureStencilBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },
          ]
        });

        const pipelineLayout = this.device.createPipelineLayout({
          bindGroupLayouts: [this.textureStencilBindGroupLayout]
        });

        this.textureStencilPipeline = this.device.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module: shaderModule, entryPoint: 'vs' },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs',
            targets: [{ format: 'rgba8unorm' }]
          },
          primitive: { topology: 'triangle-list' }
        });

        this.textureStencilSampler = this.device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear'
        });

        return true;
      } catch (e) {
        return false;
      }
    }

    shouldApplyTextureStencil() {
      if (typeof window === 'undefined') return false;
      if (!window.brushTextureEnabled || !window.brushTextureCanvas) return false;
      const strength = typeof window.brushTextureStrength !== 'undefined' ? window.brushTextureStrength : (typeof window.brushTextureDepth !== 'undefined' ? window.brushTextureDepth : 1.0);
      if (strength <= 0) return false;
      if (this.currentBatchErase) return false; // Erase strokes completely bypass texture, matching Canvas2D
      return true;
    }

    renderTextureStencilPass(paperResource) {
      if (!this.device || !this.resolvedShadowTextureView || !paperResource || !paperResource.view) return false;
      if (!this.initTextureStencilPipeline()) return false;
      if (!this.texturedShadowTextureView) return false;

      const scale = typeof window.brushTextureScale === 'number' ? window.brushTextureScale : 1.0;
      const sw = Math.max(1, Math.round(paperResource.width * scale));
      const sh = Math.max(1, Math.round(paperResource.height * scale));
      const inv = window.brushTextureInvert ? 1.0 : 0.0;
      const brightness = typeof window.brushTextureBrightness === 'number' ? window.brushTextureBrightness : 0.0;
      const contrast = typeof window.brushTextureContrast === 'number' ? window.brushTextureContrast : 0.0;
      const strength = typeof window.brushTextureStrength !== 'undefined' ? window.brushTextureStrength : (typeof window.brushTextureDepth !== 'undefined' ? window.brushTextureDepth : 1.0);

      const uniforms = new Float32Array([this.targetWidth, this.targetHeight, sw, sh, inv, brightness, contrast, strength]);
      this.device.queue.writeBuffer(this.textureStencilUniformBuffer, 0, uniforms);

      const bindGroup = this.device.createBindGroup({
        layout: this.textureStencilBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.textureStencilUniformBuffer } },
          { binding: 1, resource: this.textureStencilSampler },
          { binding: 2, resource: this.resolvedShadowTextureView },
          { binding: 3, resource: paperResource.sampler },
          { binding: 4, resource: paperResource.view },
        ]
      });

      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.texturedShadowTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });
      pass.setPipeline(this.textureStencilPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(6);
      pass.end();

      this.device.queue.submit([encoder.finish()]);
      return true;
    }

    clearShadowTarget() {
      if (!this.device || !this.shadowTextureView) return;
      this.targetClearCount++;
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

    _growDirtyBounds(x, y, r) {
      const pad = Math.ceil(r + 4);
      const minX = Math.max(0, Math.floor(x - pad));
      const minY = Math.max(0, Math.floor(y - pad));
      const maxX = Math.min(this.targetWidth - 1, Math.ceil(x + pad));
      const maxY = Math.min(this.targetHeight - 1, Math.ceil(y + pad));

      if (!this.dirtyBounds) {
        this.dirtyBounds = { minX, minY, maxX, maxY };
      } else {
        this.dirtyBounds.minX = Math.min(this.dirtyBounds.minX, minX);
        this.dirtyBounds.minY = Math.min(this.dirtyBounds.minY, minY);
        this.dirtyBounds.maxX = Math.max(this.dirtyBounds.maxX, maxX);
        this.dirtyBounds.maxY = Math.max(this.dirtyBounds.maxY, maxY);
      }
    }

    async beginStroke(settings = {}) {
      const targetCanvas = (typeof _strokeCanvas !== 'undefined' && _strokeCanvas) ? _strokeCanvas : (typeof activeC !== 'undefined' && activeC ? activeC : null);
      const w = settings.width || (targetCanvas ? targetCanvas.width : 1000);
      const h = settings.height || (targetCanvas ? targetCanvas.height : 1000);

      const aaMode = typeof _currentAAMode === 'function' ? _currentAAMode() : 'medium';
      let ss = 3;
      if (aaMode === 'none' || aaMode === 'off') {
        ss = 1;
      } else if (aaMode === 'weak') {
        ss = 2;
      } else if (aaMode === 'medium') {
        ss = 3;
      } else if (aaMode === 'strong') {
        ss = 4;
      }

      this.active = true;
      this.currentStrokeId = settings.strokeId || (typeof _activeStrokeSession !== 'undefined' ? _activeStrokeSession : 1);
      window.CustomTipOverlayOwnerStrokeId = this.currentStrokeId;
      window.CustomTipOverlayVisibilityOwnerStrokeId = this.currentStrokeId;
      if (typeof window !== 'undefined') {
        window.CustomTipGpuActiveSS = ss;
      }
      this.resolvedDabCount = 0;
      this.liveDabCount = 0;
      this.taperReplayDabCount = 0;
      this.gpuInstanceCount = 0;
      this.batchCount = 0;
      this.drawCallCount = 0;
      this.targetClearCount = 0;
      this.unsupportedDabCount = 0;
      this.instanceCount = 0;
      this.taperCleared = false;
      this.currentResource = null;
      this.pendingDabsQueue = [];
      this.nonTransparentPixelCount = 0;
      this.dirtyBounds = null;
      this.sessionSafe = true;

      this.resourcePromise = (async () => {
        const ok = await this.initPipeline();
        if (!ok) return false;

        this.ensureTextures(w, h, ss);
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
        this.taperReplayDabCount++;
        if (options.taperIndex === 0 || !this.taperCleared) {
          this.flushBatch();
          this.clearShadowTarget();
          this.gpuInstanceCount = 0;
          this.batchCount = 0;
          this.drawCallCount = 0;
          this.taperCleared = true;
          this.dirtyBounds = null;
        }
      } else {
        this.liveDabCount++;
        this.taperCleared = false;
      }

      if (!this.currentResource || !this.currentResource.view) {
        this.unsupportedDabCount++;
        return;
      }

      const r = d.r || d.radius || 1;
      let effectiveR = r;
      let effectiveAlpha = d.alpha != null ? d.alpha : (d.opacity != null ? d.opacity : 1);
      // Tiny-dab parity: Canvas2D uses 4x4 subpixel supersampling for r <= 1.
      // GPU hardware rasterization drops sub-pixel quads entirely. Clamp the
      // quad to a minimum 1px radius and scale alpha by (r/1)^2 to match the
      // area-proportional coverage that Canvas2D's supersampling computes.
      if (r < 1.0) {
        effectiveAlpha *= (r * r);
        effectiveR = 1.0;
      }
      const rgb = d.rgb || [0, 0, 0];
      const isErase = d.composite === 'erase';
      const composite = isErase ? 1.0 : 0.0;

      const reflected = (typeof flipX !== 'undefined' ? !!flipX : false) !== (typeof flipY !== 'undefined' ? !!flipY : false);
      const rotation = reflected ? -(d.rotation || 0) : (d.rotation || 0);
      const roundness = d.roundness != null ? d.roundness : (typeof window !== 'undefined' && window.brushTipRoundness == null ? 1 : window.brushTipRoundness);

      const fX = window.brushTipFlipX ? -1.0 : 1.0;
      const fY = window.brushTipFlipY ? -1.0 : 1.0;

      const softAlpha = typeof window !== 'undefined' && !!window.brushTipSoftAlpha;
      const tipMode = typeof window !== 'undefined' && window.brushTipMode ? window.brushTipMode : 'multiply';
      const applyFalloff = softAlpha && tipMode !== 'replace';
      let inner = -1.0;
      if (applyFalloff) {
        const hardness = Math.max(0, Math.min(1, typeof brushHardness !== 'undefined' ? brushHardness : 1));
        inner = Math.max(0, Math.min(0.999, hardness));
      }

      // Dirty bounds in 1x document pixels
      this._growDirtyBounds(d.x, d.y, effectiveR);

      // If composite mode changes within a stroke, we must flush the batch.
      if (this.instanceCount > 0 && this.currentBatchErase !== isErase) {
        this.flushBatch();
      }
      this.currentBatchErase = isErase;

      if (this.instanceCount >= MAX_INSTANCES_PER_BATCH) {
        this.flushBatch();
      }

      // Scale positions and radii by this.ss into SS instance buffer
      const ss = this.ss || 1;
      const offset = this.instanceCount * INSTANCE_FLOAT_COUNT;
      this.instanceData[offset + 0] = d.x * ss;
      this.instanceData[offset + 1] = d.y * ss;
      this.instanceData[offset + 2] = effectiveR * ss;
      this.instanceData[offset + 3] = rotation;
      this.instanceData[offset + 4] = roundness;
      this.instanceData[offset + 5] = effectiveAlpha;
      this.instanceData[offset + 6] = rgb[0] / 255.0;
      this.instanceData[offset + 7] = rgb[1] / 255.0;
      this.instanceData[offset + 8] = rgb[2] / 255.0;
      this.instanceData[offset + 9] = composite;
      this.instanceData[offset + 10] = fX;
      this.instanceData[offset + 11] = fY;
      this.instanceData[offset + 12] = inner;
      this.instanceData[offset + 13] = 0.0;

      this.instanceCount++;
      this.gpuInstanceCount++;

      this.scheduleLivePresentation();
    }

    scheduleLivePresentation() {
      if (this.presentRaf || !this.active) return;
      this.presentRaf = requestAnimationFrame(() => {
        this.presentRaf = 0;
        if (!this.active) return;
        this.flushBatch();
        this.presentLiveOverlay();
        this.presentFrameCount = (this.presentFrameCount || 0) + 1;
      });
    }

    flushBatch() {
      if (!this.active || !this.device || this.instanceCount === 0 || !this.currentResource) return;

      const res = this.currentResource;
      const tipNativeW = res.width || 1;
      const tipNativeH = res.height || 1;
      const reference = Math.max(tipNativeW, tipNativeH);
      const tipAspectX = tipNativeW / reference;
      const tipAspectY = tipNativeH / reference;

      // 1. Upload Uniforms for SS target dimensions
      const legacyMask = (res && res.legacyAlphaOnlyMask) ? 1.0 : 0.0;
      const uniforms = new Float32Array([this.ssWidth, this.ssHeight, tipAspectX, tipAspectY, legacyMask, 0, 0, 0]);
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

      // 2. Upload Instance Buffer
      const byteLength = this.instanceCount * INSTANCE_FLOAT_COUNT * 4;
      this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData.buffer, 0, byteLength);

      // 3. Create Bind Group for current resource
      const isNearest = (typeof _currentAAMode === 'function' && _currentAAMode() === 'none');
      const sampler = (isNearest && res.samplerNearest) ? res.samplerNearest : (res.samplerLinear || res.samplerNearest);
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

      const pipeline = this.currentBatchErase ? this.erasePipeline : this.paintPipeline;
      if (pipeline) {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, this.instanceBuffer);
        pass.draw(6, this.instanceCount, 0, 0);
      }
      pass.end();

      this.device.queue.submit([encoder.finish()]);

      this.batchCount++;
      this.drawCallCount++;
      if(typeof window!=='undefined'&&window.BrushDebugPerf&&window.BrushPerfNote)window.BrushPerfNote('gpu-work',{instances:this.instanceCount,batches:1,drawCalls:1});
      this.instanceCount = 0;
    }

    async resolveInto(outCtx, options = {}) {
      if (!this.device || !this.shadowTexture) {
        return { success: false, reason: 'no-device-or-texture' };
      }

      this.flushBatch();
      this.renderResolvePass();

      let minX = 0, minY = 0, maxX = this.targetWidth - 1, maxY = this.targetHeight - 1;
      let fullCanvas = true;

      if (options.bounds) {
        minX = Math.max(0, Math.floor(options.bounds.minX));
        minY = Math.max(0, Math.floor(options.bounds.minY));
        maxX = Math.min(this.targetWidth - 1, Math.ceil(options.bounds.maxX));
        maxY = Math.min(this.targetHeight - 1, Math.ceil(options.bounds.maxY));
        fullCanvas = false;
      } else if (this.dirtyBounds) {
        minX = this.dirtyBounds.minX;
        minY = this.dirtyBounds.minY;
        maxX = this.dirtyBounds.maxX;
        maxY = this.dirtyBounds.maxY;
        fullCanvas = (minX === 0 && minY === 0 && maxX === this.targetWidth - 1 && maxY === this.targetHeight - 1);
      }

      const rectW = Math.max(1, maxX - minX + 1);
      const rectH = Math.max(1, maxY - minY + 1);

      const bytesPerRow = Math.ceil((rectW * 4) / 256) * 256;
      const bufferSize = bytesPerRow * rectH;

      let sourceTexture = this.resolvedShadowTexture;
      if (this.shouldApplyTextureStencil() && typeof window.CustomTipGpuResources !== 'undefined') {
        const paperResource = await window.CustomTipGpuResources.getOrCreatePaperTexture(window.brushTextureCanvas, window.brushTextureVersion);
        if (paperResource && this.renderTextureStencilPass(paperResource)) {
          sourceTexture = this.texturedShadowTexture;
        }
      }

      try {
        const readBuffer = this.device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: sourceTexture, origin: [minX, minY, 0] },
          { buffer: readBuffer, bytesPerRow, rowsPerImage: rectH },
          [rectW, rectH, 1]
        );

        this.device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(readBuffer.getMappedRange());

        const targetCanvas = outCtx.canvas || outCtx;
        if (targetCanvas.width !== this.targetWidth || targetCanvas.height !== this.targetHeight) {
          targetCanvas.width = this.targetWidth;
          targetCanvas.height = this.targetHeight;
        }

        const imgData = outCtx.createImageData(rectW, rectH);
        const data = imgData.data;

        for (let y = 0; y < rectH; y++) {
          const srcRow = y * bytesPerRow;
          const dstRow = y * rectW * 4;
          for (let x = 0; x < rectW; x++) {
            const sIdx = srcRow + x * 4;
            const dIdx = dstRow + x * 4;
            data[dIdx + 0] = mapped[sIdx + 0];
            data[dIdx + 1] = mapped[sIdx + 1];
            data[dIdx + 2] = mapped[sIdx + 2];
            data[dIdx + 3] = mapped[sIdx + 3];
          }
        }

        outCtx.putImageData(imgData, minX, minY);

        readBuffer.unmap();
        readBuffer.destroy();

        this.resolveCount = (this.resolveCount || 0) + 1;
        this.lastResolveRect = { x: minX, y: minY, w: rectW, h: rectH };
        this.lastResolveSucceeded = true;
        this.lastReadbackBytes = bufferSize;
        this.lastFullCanvasReadbackUsed = fullCanvas;

        return {
          success: true,
          rect: this.lastResolveRect,
          fullCanvasReadbackUsed: fullCanvas,
          readbackBytes: bufferSize
        };
      } catch (e) {
        this.lastResolveSucceeded = false;
        return { success: false, reason: e.message || String(e) };
      }
    }

    captureFinishingTask(options = {}) {
      if (!this.device || !this.shadowTexture) {
        return null;
      }

      this.flushBatch();
      this.renderResolvePass();

      let minX = 0, minY = 0, maxX = this.targetWidth - 1, maxY = this.targetHeight - 1;
      if (options.bounds) {
        minX = Math.max(0, Math.floor(options.bounds.minX));
        minY = Math.max(0, Math.floor(options.bounds.minY));
        maxX = Math.min(this.targetWidth - 1, Math.ceil(options.bounds.maxX));
        maxY = Math.min(this.targetHeight - 1, Math.ceil(options.bounds.maxY));
      } else if (this.dirtyBounds) {
        minX = this.dirtyBounds.minX;
        minY = this.dirtyBounds.minY;
        maxX = this.dirtyBounds.maxX;
        maxY = this.dirtyBounds.maxY;
      }

      const rectW = Math.max(1, maxX - minX + 1);
      const rectH = Math.max(1, maxY - minY + 1);
      const bytesPerRow = Math.ceil((rectW * 4) / 256) * 256;
      const bufferSize = bytesPerRow * rectH;

      let sourceTexture = this.resolvedShadowTexture;
      if (this.shouldApplyTextureStencil()) {
        const paperResource = options.paperResource || null;
        if (paperResource && this.renderTextureStencilPass(paperResource)) {
          sourceTexture = this.texturedShadowTexture;
        }
      }

      let readBuffer = null;
      try {
        readBuffer = this.device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: sourceTexture, origin: [minX, minY, 0] },
          { buffer: readBuffer, bytesPerRow, rowsPerImage: rectH },
          [rectW, rectH, 1]
        );

        this.device.queue.submit([encoder.finish()]);
      } catch (e) {
        if (readBuffer) {
          try { readBuffer.destroy(); } catch (err) {}
        }
        return null;
      }

      this.active = false;
      this.instanceCount = 0;

      const task = {
        readBuffer,
        rect: { x: minX, y: minY, w: rectW, h: rectH },
        bytesPerRow,
        rectW,
        rectH,
        destroyed: false,
        async mapAndExtractImageData() {
          if (this.destroyed || !this.readBuffer) return null;
          await this.readBuffer.mapAsync(GPUMapMode.READ);
          const mapped = new Uint8Array(this.readBuffer.getMappedRange());
          const imgData = new ImageData(this.rectW, this.rectH);
          const data = imgData.data;
          for (let y = 0; y < this.rectH; y++) {
            const srcRow = y * this.bytesPerRow;
            const dstRow = y * this.rectW * 4;
            for (let x = 0; x < this.rectW; x++) {
              const sIdx = srcRow + x * 4;
              const dIdx = dstRow + x * 4;
              // Source texel is premultiplied (see unpremultiplyByte above);
              // ImageData requires straight alpha, so undo the premultiply
              // per-channel here. Alpha itself is copied through unchanged.
              const a = mapped[sIdx + 3];
              data[dIdx + 0] = unpremultiplyByte(mapped[sIdx + 0], a);
              data[dIdx + 1] = unpremultiplyByte(mapped[sIdx + 1], a);
              data[dIdx + 2] = unpremultiplyByte(mapped[sIdx + 2], a);
              data[dIdx + 3] = a;
            }
          }
          this.readBuffer.unmap();
          this.readBuffer.destroy();
          this.destroyed = true;
          this.readBuffer = null;
          return imgData;
        },
        destroy() {
          if (!this.destroyed && this.readBuffer) {
            try { this.readBuffer.destroy(); } catch (e) {}
            this.destroyed = true;
            this.readBuffer = null;
          }
        }
      };

      return task;
    }

    async presentDiagnosticPreview() {
      if (!window.CustomBrushDebugGpuTipPreview || !this.device || !this.shadowTexture) {
        this.hidePreviewCanvas();
        this.previewPresented = false;
        return;
      }

      const w = this.targetWidth;
      const h = this.targetHeight;

      const PREVIEW_BOX_W = 280;
      const PREVIEW_BOX_H = 280;

      if (!this.previewCanvas) {
        this.previewCanvas = document.createElement('canvas');
        this.previewCanvas.id = 'custom-tip-gpu-preview-canvas';
        this.previewCanvas.style.cssText = 'position:fixed;top:10px;right:10px;width:' + PREVIEW_BOX_W + 'px;height:' + PREVIEW_BOX_H + 'px;border:2px solid #3b82f6;background:rgba(15,23,42,0.9);z-index:999999;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.6);border-radius:8px;';
        document.body.appendChild(this.previewCanvas);
      }
      this.previewCanvas.style.display = 'block';
      this.previewCanvas.width = PREVIEW_BOX_W;
      this.previewCanvas.height = PREVIEW_BOX_H;

      const bytesPerRow = Math.ceil((w * 4) / 256) * 256;
      const bufferSize = bytesPerRow * h;

      this.renderResolvePass();
      let sourceTexture = this.resolvedShadowTexture;
      if (this.shouldApplyTextureStencil() && typeof window.CustomTipGpuResources !== 'undefined') {
        const paperResource = await window.CustomTipGpuResources.getOrCreatePaperTexture(window.brushTextureCanvas, window.brushTextureVersion);
        if (paperResource && this.renderTextureStencilPass(paperResource)) {
          sourceTexture = this.texturedShadowTexture;
        }
      }

      try {
        const readBuffer = this.device.createBuffer({
          size: bufferSize,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        const encoder = this.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: sourceTexture },
          { buffer: readBuffer, bytesPerRow },
          [w, h, 1]
        );
        this.device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(readBuffer.getMappedRange());

        let nonZeroCount = 0;
        let maxAlpha = 0;
        let minX = w, minY = h, maxX = -1, maxY = -1;

        for (let y = 0; y < h; y++) {
          const rowOffset = y * bytesPerRow;
          for (let x = 0; x < w; x++) {
            const a = mapped[rowOffset + x * 4 + 3];
            if (a > 0) {
              nonZeroCount++;
              if (a > maxAlpha) maxAlpha = a;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        this.nonTransparentPixelCount = nonZeroCount;
        this.maxAlpha = maxAlpha;

        const ctx = this.previewCanvas.getContext('2d');
        if (!ctx) {
          readBuffer.unmap();
          readBuffer.destroy();
          return;
        }

        ctx.clearRect(0, 0, PREVIEW_BOX_W, PREVIEW_BOX_H);

        if (nonZeroCount === 0 || maxX < minX || maxY < minY) {
          this.nonTransparentBounds = null;
          this.previewSourceBounds = { x: 0, y: 0, width: w, height: h };
          this.previewScale = 1.0;
          readBuffer.unmap();
          readBuffer.destroy();
          this.previewPresented = true;
          return;
        }

        const boundsW = maxX - minX + 1;
        const boundsH = maxY - minY + 1;
        this.nonTransparentBounds = { x: minX, y: minY, width: boundsW, height: boundsH };

        const PAD = 20;
        const cropX = Math.max(0, minX - PAD);
        const cropY = Math.max(0, minY - PAD);
        const cropMaxX = Math.min(w, maxX + 1 + PAD);
        const cropMaxY = Math.min(h, maxY + 1 + PAD);
        const cropW = cropMaxX - cropX;
        const cropH = cropMaxY - cropY;

        this.previewSourceBounds = { x: cropX, y: cropY, width: cropW, height: cropH };

        const scale = Math.min(PREVIEW_BOX_W / cropW, PREVIEW_BOX_H / cropH);
        this.previewScale = scale;

        const drawW = Math.max(1, Math.round(cropW * scale));
        const drawH = Math.max(1, Math.round(cropH * scale));
        const dstX = Math.round((PREVIEW_BOX_W - drawW) / 2);
        const dstY = Math.round((PREVIEW_BOX_H - drawH) / 2);

        const cropImgData = new ImageData(cropW, cropH);
        const cropData = cropImgData.data;

        for (let cy = 0; cy < cropH; cy++) {
          const sy = cropY + cy;
          const srcRow = sy * bytesPerRow;
          const dstRow = cy * cropW * 4;
          for (let cx = 0; cx < cropW; cx++) {
            const sx = cropX + cx;
            const sIdx = srcRow + sx * 4;
            const dIdx = dstRow + cx * 4;
            cropData[dIdx + 0] = mapped[sIdx + 0];
            cropData[dIdx + 1] = mapped[sIdx + 1];
            cropData[dIdx + 2] = mapped[sIdx + 2];
            cropData[dIdx + 3] = mapped[sIdx + 3];
          }
        }

        readBuffer.unmap();
        readBuffer.destroy();

        if (!this.cropScratchCanvas) {
          this.cropScratchCanvas = document.createElement('canvas');
        }
        this.cropScratchCanvas.width = cropW;
        this.cropScratchCanvas.height = cropH;
        const scratchCtx = this.cropScratchCanvas.getContext('2d');
        scratchCtx.putImageData(cropImgData, 0, 0);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.cropScratchCanvas, 0, 0, cropW, cropH, dstX, dstY, drawW, drawH);

        this.previewPresented = true;
      } catch (e) {
        this.previewPresented = false;
      }
    }

    hidePreviewCanvas() {
      if (this.previewCanvas) {
        this.previewCanvas.style.display = 'none';
      }
    }

    async endStroke() {
      if (!this.active) return;

      if (this.presentRaf) {
        cancelAnimationFrame(this.presentRaf);
        this.presentRaf = 0;
      }

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
      this.presentLiveOverlay();

      this.active = false;

      if (window.CustomBrushDebugGpuTipPreview) {
        await this.presentDiagnosticPreview();
      } else {
        this.hidePreviewCanvas();
      }
    }
  }

  const renderer = new CustomTipGpuRenderer();

  if (typeof window !== 'undefined') {
    window.CustomTipGpuRenderer = CustomTipGpuRenderer;
    window._customTipGpuRenderer = {
      onResolvedDab(d, options) {
        renderer.addDab(d, options);
      },
      beginStroke(settings) {
        renderer.beginStroke(settings);
      },
      endStroke() {
        renderer.endStroke();
      },
      captureFinishingTask(options) {
        return renderer.captureFinishingTask(options);
      },
      presentLiveImmediately() {
        return renderer.presentLiveImmediately();
      },
      presentLiveOverlay() {
        return renderer.presentLiveOverlay();
      },
      scheduleLivePresentation() {
        renderer.scheduleLivePresentation();
      },
      hideLiveOverlay(strokeId) {
        renderer.hideLiveOverlay(strokeId);
      },
      isEligible(context = {}) {
        if (!navigator.gpu) return { eligible: false, reason: 'no-webgpu' };
        if (renderer.device && renderer.device.lostReason) return { eligible: false, reason: 'device-lost' };
        if (renderer.fallbackReason && renderer.fallbackReason.includes('failed')) {
          return { eligible: false, reason: renderer.fallbackReason };
        }
        
        // Supported composite modes
        if (context.composite && context.composite !== 'source-over' && context.composite !== 'erase') {
          return { eligible: false, reason: 'unsupported-composite' };
        }

        return { eligible: true, reason: null };
      },
      instance: renderer
    };

    window.CustomTipGpuRunTestResolver = async function(targetCtx, options) {
      const ctx = targetCtx || (typeof _strokeCtx !== 'undefined' ? _strokeCtx : null);
      if (!ctx) return { success: false, reason: 'no-target-ctx' };
      return await renderer.resolveInto(ctx, options);
    };

    window.CustomBrushAnalyzeGpuTipRenderer = function() {
      const res = renderer.currentResource;
      const deviceLost = renderer.device ? !!renderer.device.lostReason : false;
      const eligibility = window._customTipGpuRenderer.isEligible();

      return {
        available: !!navigator.gpu,
        active: renderer.active,
        strokeId: renderer.currentStrokeId,

        tipAssetId: res ? res.assetId : null,
        tipAssetVersion: res ? res.tipVersion : null,
        legacyBrushTipVersion: typeof window !== 'undefined' ? (window.brushTipVersion || 0) : 0,
        tipDimensions: res ? { width: res.width, height: res.height } : null,

        resolvedDabCount: renderer.resolvedDabCount,
        liveDabCount: renderer.liveDabCount,
        taperReplayDabCount: renderer.taperReplayDabCount,

        gpuInstanceCount: renderer.gpuInstanceCount,
        batchCount: renderer.batchCount,
        drawCallCount: renderer.drawCallCount,
        targetClearCount: renderer.targetClearCount,

        supportedPaint: true,
        supportedErase: false,
        supportedAaMode: 'all',
        gpuEligible: eligibility.eligible,
        gpuIneligibleReason: eligibility.reason,

        targetWidth: renderer.targetWidth,
        targetHeight: renderer.targetHeight,

        previewEnabled: !!window.CustomBrushDebugGpuTipPreview,
        previewPresented: renderer.previewPresented,
        nonTransparentPixelCount: renderer.nonTransparentPixelCount,
        maxAlpha: renderer.maxAlpha || 0,
        nonTransparentBounds: renderer.nonTransparentBounds,
        previewSourceBounds: renderer.previewSourceBounds,
        previewScale: renderer.previewScale || 1.0,

        presenterReady: !!renderer.presentPipeline,
        overlayOwner: typeof window !== 'undefined' ? (window.CustomTipOverlayOwner || 'none') : 'none',
        overlayPresented: !!renderer.overlayPresented,

        resolverReady: true,
        resolveCount: renderer.resolveCount || 0,
        lastResolveRect: renderer.lastResolveRect || null,
        lastResolveSucceeded: renderer.lastResolveSucceeded || false,

        readbackBytes: renderer.lastReadbackBytes || 0,
        fullCanvasReadbackUsed: renderer.lastFullCanvasReadbackUsed || false,

        sessionSafe: renderer.sessionSafe !== false,

        pipelineReady: !!renderer.paintPipeline,
        resourceReady: !!res,

        unsupportedDabCount: renderer.unsupportedDabCount,
        fallbackReason: renderer.fallbackReason,

        deviceLost
      };
    };
  }
})();