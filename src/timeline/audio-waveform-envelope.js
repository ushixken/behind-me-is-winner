(() => {
  'use strict';

  // Finest mip level is built directly from PCM at this many audio frames per bucket.
  // Coarser levels are derived by repeatedly folding adjacent buckets together,
  // exactly like an image mipmap, so building them is cheap and only ever happens once per source.
  const BASE_BLOCK = 256;
  const MAX_LEVELS = 16;

  class EnvelopeCache {
    constructor() {
      // sourceId -> { length, levels: [{ blockSize, min: Float32Array, max: Float32Array }] }
      this.cache = new Map();
    }

    _buildBaseLevel(source) {
      const channels = source.pcm || [];
      const length = Number(source.frameLength) || (channels[0] ? channels[0].length : 0);
      const bucketCount = Math.max(1, Math.ceil(length / BASE_BLOCK));
      const min = new Float32Array(bucketCount);
      const max = new Float32Array(bucketCount);
      const channelCount = Math.max(1, channels.length);
      for (let bucket = 0; bucket < bucketCount; bucket++) {
        const from = bucket * BASE_BLOCK;
        const to = Math.min(length, from + BASE_BLOCK);
        let lo = 0;
        let hi = 0;
        for (let frame = from; frame < to; frame++) {
          let mixed = 0;
          for (let channel = 0; channel < channelCount; channel++) {
            mixed += channels[channel] ? (channels[channel][frame] || 0) : 0;
          }
          mixed /= channelCount;
          if (mixed < lo) lo = mixed;
          if (mixed > hi) hi = mixed;
        }
        min[bucket] = lo;
        max[bucket] = hi;
      }
      return { blockSize: BASE_BLOCK, length, min, max };
    }

    _buildNextLevel(prev) {
      const bucketCount = Math.max(1, Math.ceil(prev.min.length / 2));
      const min = new Float32Array(bucketCount);
      const max = new Float32Array(bucketCount);
      for (let bucket = 0; bucket < bucketCount; bucket++) {
        const a = bucket * 2;
        const b = Math.min(prev.min.length - 1, a + 1);
        min[bucket] = Math.min(prev.min[a], prev.min[b]);
        max[bucket] = Math.max(prev.max[a], prev.max[b]);
      }
      return { blockSize: prev.blockSize * 2, length: prev.length, min, max };
    }

    getEntry(source) {
      if (!source || !source.id) return null;
      const cached = this.cache.get(source.id);
      if (cached) return cached;
      const base = this._buildBaseLevel(source);
      const levels = [base];
      let current = base;
      for (let i = 1; i < MAX_LEVELS && current.min.length > 1; i++) {
        current = this._buildNextLevel(current);
        levels.push(current);
      }
      const entry = { length: base.length, levels, channels: source.pcm || null };
      this.cache.set(source.id, entry);
      return entry;
    }

    // Reads a single interpolated (mixed-down) sample value at a fractional frame index -
    // used once we're zoomed in past one sample per pixel, where several adjacent columns
    // would otherwise land inside the same single sample and repeat its value as a flat step.
    _sampleAt(entry, position) {
      const channels = entry.channels;
      const i0 = Math.max(0, Math.min(entry.length - 1, Math.floor(position)));
      const i1 = Math.min(entry.length - 1, i0 + 1);
      const frac = position - i0;
      const channelCount = channels.length;
      let v0 = 0;
      let v1 = 0;
      for (let channel = 0; channel < channelCount; channel++) {
        v0 += channels[channel] ? (channels[channel][i0] || 0) : 0;
        v1 += channels[channel] ? (channels[channel][i1] || 0) : 0;
      }
      v0 /= channelCount;
      v1 /= channelCount;
      return v0 + (v1 - v0) * frac;
    }

    // Scans raw PCM directly, sample by sample, over [fromIndex, toIndex). Only used when
    // the requested span covers at least one whole sample (i.e. the user is zoomed in far
    // enough that a column covers just a handful of audio samples, but still more than one)
    // - at that point the mip cache's fixed BASE_BLOCK granularity would smear separate
    // oscillation cycles together into a smooth blob. Scanning raw samples instead
    // reproduces the true, crisp per-cycle shape (visible peaks/troughs) the way a real
    // audio editor shows it. Cost is bounded: this path only runs when span is small, so
    // each call touches at most a few hundred samples.
    _scanRaw(entry, fromIndex, toIndex) {
      const channels = entry.channels;
      if (!channels || !channels.length) return { min: 0, max: 0 };
      const from = Math.max(0, Math.min(entry.length, fromIndex));
      const to = Math.max(from + 1, Math.min(entry.length, toIndex));
      const channelCount = channels.length;
      let lo = 0;
      let hi = 0;
      for (let frame = from; frame < to; frame++) {
        let mixed = 0;
        for (let channel = 0; channel < channelCount; channel++) {
          mixed += channels[channel] ? (channels[channel][frame] || 0) : 0;
        }
        mixed /= channelCount;
        if (mixed < lo) lo = mixed;
        if (mixed > hi) hi = mixed;
      }
      return { min: lo, max: hi };
    }

    invalidate(sourceId) {
      this.cache.delete(sourceId);
    }

    // Returns the {min, max} envelope across the audio-frame range [fromFrame, toFrame).
    // Three regimes, from most to least zoomed in:
    //  - span < 1 sample: interpolate a single continuous curve point between the two
    //    neighboring samples, so multiple screen columns per sample form a smooth line
    //    instead of repeating flat steps.
    //  - 1 sample <= span <= finest mip block: read raw PCM directly for true per-sample detail.
    //  - span > finest mip block: use the coarsest mip level that still resolves the
    //    span with only a handful of buckets, so cost stays roughly constant regardless of zoom.
    range(source, fromFrame, toFrame) {
      const entry = this.getEntry(source);
      if (!entry || !entry.levels.length) return { min: 0, max: 0 };
      const safeFrom = Number.isFinite(fromFrame) ? fromFrame : 0;
      const safeTo = Number.isFinite(toFrame) ? toFrame : safeFrom;
      const from = Math.max(0, Math.min(entry.length, safeFrom));
      const to = Math.max(from, Math.min(entry.length, safeTo));
      const rawSpan = to - from;

      if (rawSpan < 1 && entry.channels && entry.channels.length) {
        const value = this._sampleAt(entry, (from + to) / 2);
        return { min: Math.min(0, value), max: Math.max(0, value) };
      }

      const span = Math.max(1, rawSpan);

      if (span <= BASE_BLOCK && entry.channels) {
        return this._scanRaw(entry, Math.floor(from), Math.ceil(to));
      }

      let level = entry.levels[0];
      for (const candidate of entry.levels) {
        if (candidate.blockSize > span) break;
        level = candidate;
      }

      const bucketFrom = Math.max(0, Math.min(level.min.length - 1, Math.floor(from / level.blockSize)));
      const bucketTo = Math.max(bucketFrom, Math.min(level.min.length - 1, Math.floor(Math.max(from, to - 1) / level.blockSize)));

      let lo = 0;
      let hi = 0;
      for (let bucket = bucketFrom; bucket <= bucketTo; bucket++) {
        if (level.min[bucket] < lo) lo = level.min[bucket];
        if (level.max[bucket] > hi) hi = level.max[bucket];
      }
      return { min: lo, max: hi };
    }
  }

  window.AudioWaveformEnvelope = new EnvelopeCache();
})();