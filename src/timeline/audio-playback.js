(() => {
  'use strict';

  const dbToGain = db => Number.isFinite(db) ? Math.pow(10, db / 20) : 0;
  const fps = () => Math.max(1, typeof getFPS === 'function' ? getFPS() : 24);

  class AudioNodeRegistry {
    constructor() { this.nodes = new Set(); }
    add(record) {
      this.nodes.add(record);
      record.source.addEventListener('ended', () => this.remove(record), { once: true });
    }
    remove(record) {
      if (!this.nodes.delete(record)) return;
      try { record.source.disconnect(); } catch (_) {}
      try { record.gain.disconnect(); } catch (_) {}
    }
    stopAll() {
      for (const record of [...this.nodes]) {
        try { record.source.stop(); } catch (_) {}
        this.remove(record);
      }
    }
  }

  class AudioClipScheduler {
    constructor(context, master, registry) {
      this.context = context;
      this.master = master;
      this.registry = registry;
    }
    fadeLevel(clip, localFrame) {
      const fadeIn = Math.max(0, Number(clip.fadeInLength) || 0);
      const fadeOut = Math.max(0, Number(clip.fadeOutLength) || 0);
      let level = 1;
      if (fadeIn > 0 && localFrame < fadeIn) {
        const t = Math.max(0, Math.min(1, localFrame / fadeIn));
        level = Math.min(level, t * t * (3 - 2 * t));
      }
      if (fadeOut > 0 && localFrame > clip.duration - fadeOut) {
        const t = Math.max(0, Math.min(1, (clip.duration - localFrame) / fadeOut));
        level = Math.min(level, t * t * (3 - 2 * t));
      }
      return level;
    }
    automateGain(node, clip, timelineStartFrame, when, baseGain) {
      const frameRate = fps();
      const localStart = Math.max(0, timelineStartFrame - clip.startFrame);
      const endLocal = clip.duration;
      node.gain.cancelScheduledValues(when);
      node.gain.setValueAtTime(baseGain * this.fadeLevel(clip, localStart), when);
      const points = [];
      const stepCount = Math.max(8, Math.min(128, Math.ceil((endLocal - localStart) / 2)));
      for (let index = 0; index <= stepCount; index++) {
        const local = localStart + (endLocal - localStart) * index / stepCount;
        points.push(baseGain * this.fadeLevel(clip, local));
      }
      const duration = Math.max(0.001, (endLocal - localStart) / frameRate);
      node.gain.setValueCurveAtTime(new Float32Array(points), when, duration);
    }
    schedule(clip, timelineFrame, contextAnchor) {
      const sourceRecord = window.AudioSources?.get(clip.sourceId);
      const buffer = sourceRecord?.audioBuffer;
      if (!buffer) return null;
      const frameRate = fps();
      const clipEnd = clip.startFrame + clip.duration;
      const audibleStart = Math.max(timelineFrame, clip.startFrame);
      if (audibleStart >= clipEnd) return null;
      const rate = 1 / Math.max(0.01, Number(clip.stretchFactor) || 1);
      const localTimelineFrames = audibleStart - clip.startFrame;
      const sourceFrame = (Number(clip.sourceStart) || 0) +
        (Number(clip.sourceOffset) || 0) + localTimelineFrames * rate;
      const offset = Math.max(0, sourceFrame / frameRate);
      const sourceEnd = ((Number(clip.sourceEnd) || clip.duration) +
        (Number(clip.sourceOffset) || 0)) / frameRate;
      const sourceDuration = Math.min(
        Math.max(0, sourceEnd - offset),
        Math.max(0, buffer.duration - offset)
      );
      if (sourceDuration <= 0) return null;
      const timelineDuration = Math.min(
        (clipEnd - audibleStart) / frameRate,
        sourceDuration / rate
      );
      if (timelineDuration <= 0) return null;
      const when = contextAnchor + (audibleStart - timelineFrame) / frameRate;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(rate, when);
      source.connect(gain);
      gain.connect(this.master);
      this.automateGain(gain, clip, audibleStart, when, dbToGain(Number(clip.gain) || 0));
      const record = { source, gain, clipId: clip.id };
      this.registry.add(record);
      source.start(when, offset, sourceDuration);
      source.stop(when + timelineDuration);
      return record;
    }
  }

  class AudioScrubController {
    constructor(engine) {
      this.engine = engine;
      this.record = null;
      this.lastAt = 0;
    }
    async preview(frame) {
      const now = performance.now();
      if (now - this.lastAt < 45) return;
      this.lastAt = now;
      this.stop();
      const context = await this.engine.ensureContext();
      if (!context) return;
      const clip = this.engine.clips().find(item =>
        frame >= item.startFrame && frame < item.startFrame + item.duration);
      if (!clip) return;
      const sourceRecord = window.AudioSources?.get(clip.sourceId);
      if (!sourceRecord?.audioBuffer) return;
      const frameRate = fps();
      const rate = 1 / Math.max(0.01, Number(clip.stretchFactor) || 1);
      const local = frame - clip.startFrame;
      const offset = Math.max(0, ((clip.sourceStart || 0) + (clip.sourceOffset || 0) + local * rate) / frameRate);
      if (offset >= sourceRecord.audioBuffer.duration) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = sourceRecord.audioBuffer;
      source.playbackRate.value = rate;
      gain.gain.value = dbToGain(Number(clip.gain) || 0) * 0.8;
      source.connect(gain);
      gain.connect(this.engine.master);
      source.start(0, offset, Math.min(0.075, sourceRecord.audioBuffer.duration - offset));
      source.stop(context.currentTime + 0.08);
      this.record = { source, gain };
      source.addEventListener('ended', () => this.stop(source), { once: true });
    }
    stop(expected) {
      if (!this.record || (expected && this.record.source !== expected)) return;
      try { this.record.source.stop(); } catch (_) {}
      try { this.record.source.disconnect(); } catch (_) {}
      try { this.record.gain.disconnect(); } catch (_) {}
      this.record = null;
    }
  }

  class AudioPlaybackEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.registry = new AudioNodeRegistry();
      this.scheduler = null;
      this.playing = false;
      this.generation = 0;
      this.scrub = new AudioScrubController(this);
    }
    clips() { return window.AudioClipUI?.clips || []; }
    async ensureContext() {
      try {
        const manager = window.AudioContextManager;
        this.context = manager?.get ? manager.get() : this.context;
        if (!this.context) {
          const Context = window.AudioContext || window.webkitAudioContext;
          if (!Context) throw new Error('Web Audio playback is not supported by this browser.');
          this.context = new Context();
        }
        if (this.context.state === 'closed') throw new Error('The audio device is unavailable.');
        if (this.context.state === 'suspended') await this.context.resume();
        if (!this.master) {
          this.master = this.context.createGain();
          this.master.connect(this.context.destination);
          this.scheduler = new AudioClipScheduler(this.context, this.master, this.registry);
        }
        return this.context;
      } catch (error) {
        console.error('Audio playback could not start.', error);
        if (typeof showInfo === 'function') showInfo(error.message, 'Audio Playback');
        return null;
      }
    }
    async play(frame) {
      const generation = ++this.generation;
      this.stopNodes();
      this.playing = true;
      const context = await this.ensureContext();
      if (!context || !this.playing || generation !== this.generation) return;
      const anchor = context.currentTime + 0.02;
      for (const clip of this.clips()) this.scheduler.schedule(clip, frame, anchor);
    }
    pause() {
      this.playing = false;
      this.generation++;
      this.stopNodes();
    }
    stop() { this.pause(); }
    stopNodes() {
      this.registry.stopAll();
      this.scrub.stop();
    }
    seek(frame) {
      if (this.playing) this.play(frame);
    }
    frameChanged(frame, options = {}) {
      if (options.scrubbing && !this.playing) this.scrub.preview(frame);
      else if (this.playing && options.seek !== false) this.seek(frame);
    }
    endScrub() { this.scrub.stop(); }
    clipsChanged() {
      if (this.playing && typeof curFrame === 'number') this.play(curFrame);
    }
  }

  const engine = new AudioPlaybackEngine();
  window.AudioPlaybackEngine = engine;
})();
