// src/brush/custom-tip-gpu-resources.js
//
// Phase 3A.1: Future-Proof WebGPU Custom-Tip Asset Resource Cache
// Asset-centric WebGPU resource manager for brush tip masks.
// Shared device strategy, bounded LRU cache, byte tracking, and device loss protection.
//

(() => {
  "use strict";

  const CACHE_LIMIT = 8;

  class CustomTipGpuResources {
    constructor() {
      this.cache = new Map(); // key -> resource
      this.sharedDevice = null;
      this.deviceLost = false;
      this.uploadCount = 0;
      this.reuseCount = 0;
      this.evictionCount = 0;
      this.totalCachedBytes = 0;
      this.sharedLinearSampler = null;
      this.sharedNearestSampler = null;
      this.sharedRepeatSampler = null;
      this.cachedPaperTexture = null;
      this.cachedPaperTextureView = null;
      this.cachedPaperTextureVersion = -1;
      this.cachedPaperTextureCanvas = null;
    }

    resolveCurrentTipAsset() {
      const canvas = window.brushTipCanvas;
      if (!canvas) return null;
      const w = canvas.width || canvas.naturalWidth || 1;
      const h = canvas.height || canvas.naturalHeight || 1;
      if (!canvas._tipAssetId && typeof _ensureTipAssetId === "function") {
        _ensureTipAssetId(canvas, null);
      }
      const assetId =
        canvas._tipAssetId || canvas._assetId || `tip_asset_fallback_${w}x${h}`;
      const version = canvas._tipAssetVersion || 1;
      return {
        assetId,
        version,
        source: canvas,
        width: w,
        height: h,
      };
    }

    async getDevice() {
      if (this.deviceLost) return null;
      if (this.sharedDevice) return this.sharedDevice;

      // 1. Re-use DisplayBackend's WebGPU device if available
      if (
        typeof window.DisplayBackend !== "undefined" &&
        window.DisplayBackend.device
      ) {
        this.sharedDevice = window.DisplayBackend.device;
        this.attachDeviceLossHandler(this.sharedDevice);
        this.initSamplers(this.sharedDevice);
        return this.sharedDevice;
      }

      if (!navigator.gpu) return null;

      try {
        if (
          typeof window.DisplayBackend !== "undefined" &&
          typeof window.DisplayBackend.initialize === "function"
        ) {
          await window.DisplayBackend.initialize();
          if (window.DisplayBackend.device) {
            this.sharedDevice = window.DisplayBackend.device;
            this.attachDeviceLossHandler(this.sharedDevice);
            this.initSamplers(this.sharedDevice);
            return this.sharedDevice;
          }
        }
      } catch (e) {
        // Fallback to standalone request if DisplayBackend initialize rejects
      }

      try {
        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: "high-performance",
        });
        if (!adapter) return null;
        this.sharedDevice = await adapter.requestDevice();
        this.attachDeviceLossHandler(this.sharedDevice);
        this.initSamplers(this.sharedDevice);
        return this.sharedDevice;
      } catch (e) {
        return null;
      }
    }

    attachDeviceLossHandler(device) {
      if (!device || !device.lost) return;
      device.lost
        .then((info) => {
          this.deviceLost = true;
          this.clear();
          this.sharedDevice = null;
          this.sharedLinearSampler = null;
          this.sharedNearestSampler = null;
          this.sharedRepeatSampler = null;
        })
        .catch(() => {});
    }

    initSamplers(device) {
      if (!device || this.sharedLinearSampler) return;
      try {
        this.sharedLinearSampler = device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          mipmapFilter: "linear",
        });
        this.sharedNearestSampler = device.createSampler({
          magFilter: "nearest",
          minFilter: "nearest",
          mipmapFilter: "nearest",
        });
        this.sharedRepeatSampler = device.createSampler({
          addressModeU: "repeat",
          addressModeV: "repeat",
          magFilter: "linear",
          minFilter: "linear",
        });
      } catch (e) {
        // Sampler creation failed
      }
    }

    evictIfNeeded(currentAssetId, currentVersion) {
      if (this.cache.size < CACHE_LIMIT) return;

      let oldestKey = null;
      let oldestTime = Infinity;

      for (const [key, res] of this.cache.entries()) {
        const isPinned =
          (currentAssetId && res.assetId === currentAssetId) ||
          (currentVersion != null && res.tipVersion === currentVersion);
        if (!isPinned && res.lastUsed < oldestTime) {
          oldestTime = res.lastUsed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        const res = this.cache.get(oldestKey);
        if (res) {
          if (res.texture) {
            try {
              res.texture.destroy();
            } catch (e) {}
          }
          this.totalCachedBytes = Math.max(
            0,
            this.totalCachedBytes - (res.resourceBytes || 0),
          );
        }
        this.cache.delete(oldestKey);
        this.evictionCount++;
      }
    }

    async getOrCreateResource(assetDescriptor) {
      if (!assetDescriptor || !assetDescriptor.source) return null;
      const canvas = assetDescriptor.source;
      const w =
        assetDescriptor.width || canvas.width || canvas.naturalWidth || 1;
      const h =
        assetDescriptor.height || canvas.height || canvas.naturalHeight || 1;
      if (w <= 0 || h <= 0) return null;

      const version =
        assetDescriptor.version != null ? assetDescriptor.version : 0;
      const assetId = assetDescriptor.assetId || `tip_v${version}_${w}x${h}`;
      const key = `${assetId}_v${version}_${w}x${h}`;

      const hit = this.cache.get(key);
      if (hit) {
        hit.lastUsed = performance.now();
        this.reuseCount++;
        return hit;
      }

      const device = await this.getDevice();
      if (!device) return null;

      this.evictIfNeeded(assetId, version);

      try {
        const texture = device.createTexture({
          size: [w, h, 1],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.copyExternalImageToTexture(
          { source: canvas },
          { texture: texture },
          [w, h, 1],
        );

        const view = texture.createView();
        const resourceBytes = w * h * 4;

        let legacyAlphaOnlyMask = false;
        try {
          const sourceCtx = canvas.getContext("2d", {
            willReadFrequently: true,
          });
          const sourceData = sourceCtx.getImageData(0, 0, w, h).data;
          let maxLum = 0;
          for (let p = 0; p < sourceData.length; p += 4) {
            if (sourceData[p + 3] === 0) continue;
            const lum =
              (sourceData[p] * 0.2126 +
                sourceData[p + 1] * 0.7152 +
                sourceData[p + 2] * 0.0722) /
              255;
            if (lum > maxLum) maxLum = lum;
          }
          legacyAlphaOnlyMask = maxLum < 0.01;
        } catch (_) {
          legacyAlphaOnlyMask = false;
        }

        const resource = {
          key,
          assetId,
          width: w,
          height: h,
          texture,
          view,
          samplerLinear: this.sharedLinearSampler,
          samplerNearest: this.sharedNearestSampler,
          tipVersion: version,
          resourceBytes,
          legacyAlphaOnlyMask,
          lastUsed: performance.now(),
        };

        this.cache.set(key, resource);
        this.totalCachedBytes += resourceBytes;
        this.uploadCount++;
        return resource;
      } catch (e) {
        return null;
      }
    }

    async getResourceForTip(canvas, version) {
      if (!canvas || version == null) return null;
      const w = canvas.width || canvas.naturalWidth || 1;
      const h = canvas.height || canvas.naturalHeight || 1;
      const assetId = canvas._assetId || `tip_v${version}_${w}x${h}`;
      return this.getOrCreateResource({
        assetId,
        version,
        source: canvas,
        width: w,
        height: h,
      });
    }

    async getOrCreateCurrentTipResource() {
      const asset = this.resolveCurrentTipAsset();
      if (!asset) return null;
      return this.getOrCreateResource(asset);
    }

    async getOrCreatePaperTexture(canvas, version) {
      if (!canvas) return null;
      const w = canvas.width || canvas.naturalWidth || 1;
      const h = canvas.height || canvas.naturalHeight || 1;
      if (w <= 0 || h <= 0) return null;

      const v =
        version != null
          ? version
          : typeof window !== "undefined" && window.brushTextureVersion
            ? window.brushTextureVersion
            : 0;
      if (
        this.cachedPaperTexture &&
        this.cachedPaperTextureVersion === v &&
        this.cachedPaperTextureCanvas === canvas
      ) {
        return {
          texture: this.cachedPaperTexture,
          view: this.cachedPaperTextureView,
          sampler: this.sharedRepeatSampler,
          width: w,
          height: h,
        };
      }

      const device = await this.getDevice();
      if (!device) return null;
      this.initSamplers(device);

      if (this.cachedPaperTexture) {
        try {
          this.cachedPaperTexture.destroy();
        } catch (e) {}
        this.cachedPaperTexture = null;
        this.cachedPaperTextureView = null;
      }

      try {
        const texture = device.createTexture({
          size: [w, h, 1],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.copyExternalImageToTexture(
          { source: canvas },
          { texture: texture },
          [w, h, 1],
        );

        this.cachedPaperTexture = texture;
        this.cachedPaperTextureView = texture.createView();
        this.cachedPaperTextureVersion = v;
        this.cachedPaperTextureCanvas = canvas;

        return {
          texture: this.cachedPaperTexture,
          view: this.cachedPaperTextureView,
          sampler: this.sharedRepeatSampler,
          width: w,
          height: h,
        };
      } catch (e) {
        return null;
      }
    }

    invalidateAsset(assetId, version) {
      for (const [key, res] of this.cache.entries()) {
        const matchAsset = assetId && res.assetId === assetId;
        const matchVersion = version != null && res.tipVersion === version;
        if (matchAsset || matchVersion) {
          if (res.texture) {
            try {
              res.texture.destroy();
            } catch (e) {}
          }
          this.totalCachedBytes = Math.max(
            0,
            this.totalCachedBytes - (res.resourceBytes || 0),
          );
          this.cache.delete(key);
        }
      }
    }

    invalidateTipVersion(version) {
      this.invalidateAsset(null, version);
    }

    clear() {
      for (const res of this.cache.values()) {
        if (res.texture) {
          try {
            res.texture.destroy();
          } catch (e) {}
        }
      }
      this.cache.clear();
      this.totalCachedBytes = 0;
      if (this.cachedPaperTexture) {
        try {
          this.cachedPaperTexture.destroy();
        } catch (e) {}
        this.cachedPaperTexture = null;
        this.cachedPaperTextureView = null;
        this.cachedPaperTextureCanvas = null;
        this.cachedPaperTextureVersion = -1;
      }
    }
  }

  const manager = new CustomTipGpuResources();

  if (typeof window !== "undefined") {
    window.CustomTipGpuResources = {
      resolveCurrentTipAsset: () => manager.resolveCurrentTipAsset(),
      getOrCreateResource: (assetDescriptor) =>
        manager.getOrCreateResource(assetDescriptor),
      getOrCreateCurrentTipResource: () =>
        manager.getOrCreateCurrentTipResource(),
      getResourceForTip: (canvas, version) =>
        manager.getResourceForTip(canvas, version),
      getOrCreatePaperTexture: (canvas, version) =>
        manager.getOrCreatePaperTexture(canvas, version),
      invalidateAsset: (assetId, version) =>
        manager.invalidateAsset(assetId, version),
      invalidateTipVersion: (version) => manager.invalidateTipVersion(version),
      clear: () => manager.clear(),
      instance: manager,
    };

    window.CustomBrushAnalyzeGpuTipResources = function () {
      const asset = manager.resolveCurrentTipAsset();
      const currentCanvas = window.brushTipCanvas;
      const currentVersion = window.brushTipVersion || 0;
      const currentKey = asset
        ? `${asset.assetId}_v${asset.version}_${asset.width}x${asset.height}`
        : null;
      const hasCurrentResource = currentKey
        ? manager.cache.has(currentKey)
        : false;

      return {
        webgpuAvailable: !!navigator.gpu,
        sharedDeviceUsed: !!manager.sharedDevice,
        cacheSize: manager.cache.size,
        cacheLimit: CACHE_LIMIT,
        totalCachedBytes: manager.totalCachedBytes,
        currentAssetId: asset ? asset.assetId : null,
        currentAssetVersion: asset ? asset.version : null,
        legacyBrushTipVersion: currentVersion,
        currentTipDimensions: currentCanvas
          ? { width: currentCanvas.width, height: currentCanvas.height }
          : null,
        currentTipResourceReady: hasCurrentResource,
        uploadCount: manager.uploadCount,
        reuseCount: manager.reuseCount,
        evictionCount: manager.evictionCount,
        deviceLost: manager.deviceLost,
      };
    };
  }
})();
