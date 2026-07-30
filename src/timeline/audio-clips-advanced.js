(() => {
  'use strict';

  const STORAGE_KEY = 'behindMe.audioTimeline.clips';
  const TEST_NAMES = ['Voice_01.wav', 'Rain.wav', 'Music.mp3', 'Explosion.wav'];
  const DEFAULT_DURATION = 24;
  const MIN_GAIN = -60;
  const MAX_GAIN = 12;
  const clone = value => JSON.parse(JSON.stringify(value));
  const audioWaveformHeight = () => {
    const configured = window.AudioWaveformHeight?.value;
    if (Number.isFinite(configured)) return configured;
    const root = document.getElementById('audio-timeline');
    const cssValue = root ? parseFloat(getComputedStyle(root).getPropertyValue('--audio-waveform-height')) : NaN;
    return Number.isFinite(cssValue) ? cssValue : 48;
  };

  const makeWaveform = seedText => {
    let seed = 2166136261;
    for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
    const samples = [];
    for (let index = 0; index < 320; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff) * 0.42;
      const pulse = Math.pow(Math.max(0, Math.sin(index * 0.087)), 8);
      const envelope = 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * index / 319), 0.35);
      samples.push(Math.min(1, (noise + pulse * 0.7) * envelope));
    }
    return samples;
  };

  const normalizeClip = clip => {
    const duration = Math.max(1, Number(clip.duration) || DEFAULT_DURATION);
    const sourceStart = Math.max(0, Number(clip.sourceStart) || 0);
    const storedSourceEnd = Number(clip.sourceEnd);
    const sourceEnd = Number.isFinite(storedSourceEnd) ? Math.max(sourceStart, storedSourceEnd) : sourceStart + duration;
    const sourceDuration = Math.max(sourceEnd, Number(clip.sourceDuration) || sourceEnd);
    const sourceOffset = Math.max(-sourceStart, Math.min(sourceDuration - sourceEnd, Number(clip.sourceOffset) || 0));
    return {
      id: clip.id,
      name: clip.name || 'Audio Clip',
      track: clip.track || clip.trackId,
      startFrame: Math.max(0, Number(clip.startFrame) || 0),
      duration,
      sourceStart,
      sourceEnd,
      sourceDuration,
      sourceOffset,
      sourceId: clip.sourceId || null,
      fadeInLength: Math.max(0, Number(clip.fadeInLength) || 0),
      fadeOutLength: Math.max(0, Number(clip.fadeOutLength) || 0),
      fadeCurve: clip.fadeCurve || { type: 'smooth' },
      gain: Number.isFinite(clip.gain) ? Math.max(MIN_GAIN, Math.min(MAX_GAIN, clip.gain)) : 0,
      showWaveform: clip.showWaveform !== false,
      stretchFactor: Number.isFinite(clip.stretchFactor) && clip.stretchFactor > 0 ? clip.stretchFactor : 1,
      waveform: Array.isArray(clip.waveform) ? clip.waveform : makeWaveform(clip.name || clip.id || 'audio')
    };
  };

  class AudioClipSelection {
    constructor() {
      this.ids = new Set();
      this.anchorId = null;
    }
    clear() { this.ids.clear(); this.anchorId = null; }
    select(id, event, clips) {
      if (event.ctrlKey || event.metaKey) {
        if (this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
      } else if (event.shiftKey && this.anchorId) {
        const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame || a.track.localeCompare(b.track));
        const from = ordered.findIndex(clip => clip.id === this.anchorId);
        const to = ordered.findIndex(clip => clip.id === id);
        if (from >= 0 && to >= 0) {
          this.ids.clear();
          ordered.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(clip => this.ids.add(clip.id));
        }
      } else {
        this.ids.clear();
        this.ids.add(id);
      }
      this.anchorId = id;
    }
  }

  class WaveformRenderer {
    envelopeAt(clip, frame) {
      let level = 1;
      if (clip.fadeInLength > 0 && frame < clip.fadeInLength) {
        const t = Math.max(0, Math.min(1, frame / clip.fadeInLength));
        level = t * t * (3 - 2 * t);
      }
      const fadeOutStart = clip.duration - clip.fadeOutLength;
      if (clip.fadeOutLength > 0 && frame > fadeOutStart) {
        const t = Math.max(0, Math.min(1, (clip.duration - frame) / clip.fadeOutLength));
        level = Math.min(level, t * t * (3 - 2 * t));
      }
      return level;
    }

    draw(canvas, clip) {
      const width = Math.max(1, Math.round(clip.duration * CellW));
      const height = Math.max(1, Math.round(audioWaveformHeight() - 4));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext('2d');
      context.scale(dpr, dpr);
      context.clearRect(0, 0, width, height);
      const samples = clip.waveform || [];
      const center = height / 2;
      const timeMapping = window.AudioClipTimeMapping;

      if (clip.showWaveform) {
        const gainScale = clip.gain <= MIN_GAIN ? 0 : Math.pow(10, clip.gain / 20);
        context.fillStyle = 'rgba(226, 224, 255, .82)';
        for (let x = 0; x < width; x++) {
          const timelineFrame = timeMapping.waveformPixelToTimelineFrame(clip, x, CellW);
          const sourceFrame = timeMapping.timelineFrameToSourceFrame(clip, timelineFrame, true);
          const sampleIndex = timeMapping.waveformBucketForSourceFrame(clip, sourceFrame, samples.length);
          const localFrame = Math.max(0, Math.min(clip.duration, timelineFrame - clip.startFrame));
          const fadeLevel = this.envelopeAt(clip, localFrame);
          const amplitude = Math.min(height * 0.47, (samples[sampleIndex] || 0) * fadeLevel * gainScale * (height * 0.42));
          context.fillRect(x, Math.round(center - amplitude), 1, Math.max(1, Math.round(amplitude * 2)));
        }
        context.fillStyle = 'rgba(255,255,255,.26)';
        context.fillRect(0, Math.round(center), width, 1);
      }

      context.beginPath();
      for (let x = 0; x < width; x++) {
        const progress = x / Math.max(1, width - 1);
        const level = this.envelopeAt(clip, progress * clip.duration);
        const y = height - 1 - level * (height - 3);
        if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.strokeStyle = 'rgba(247,246,255,.9)';
      context.lineWidth = 1.25;
      context.stroke();
    }
  }

  class AudioClipRenderer {
    constructor(editor) {
      this.editor = editor;
      this.waveforms = new WaveformRenderer();
    }
    render() {
      document.querySelectorAll('.audio-timeline-track-grid').forEach(row => {
        row.querySelectorAll('.audio-clip').forEach(clip => clip.remove());
      });
      this.editor.clips.forEach(clip => {
        const row = document.querySelector(`.audio-timeline-track-grid[data-audio-track-id="${CSS.escape(clip.track)}"]`);
        if (row) row.appendChild(this.createClip(clip));
      });
    }
    createClip(clip) {
      const element = document.createElement('div');
      element.className = 'audio-clip advanced';
      element.dataset.audioClipId = clip.id;
      element.style.left = `${clip.startFrame * CellW}px`;
      element.style.width = `${Math.max(CellW, clip.duration * CellW)}px`;
      element.classList.toggle('selected', this.editor.selection.ids.has(clip.id));

      const canvas = document.createElement('canvas');
      canvas.className = 'audio-clip-waveform';
      element.appendChild(canvas);
      this.waveforms.draw(canvas, clip);

      const name = document.createElement('span');
      name.className = 'audio-clip-name';
      name.textContent = clip.name;
      element.appendChild(name);

      const gainHandle = document.createElement('div');
      gainHandle.className = 'audio-clip-gain-handle';
      gainHandle.dataset.audioEdit = 'gain';
      gainHandle.title = (clip.gain > 0 ? '+' : '') + clip.gain.toFixed(1) + ' dB';
      element.appendChild(gainHandle);

      [
        ['trim-left', 'audio-clip-trim-handle left'],
        ['trim-right', 'audio-clip-trim-handle right'],
        ['fade-in', 'audio-clip-fade-handle left'],
        ['fade-out', 'audio-clip-fade-handle right']
      ].forEach(([type, className]) => {
        const handle = document.createElement('div');
        handle.className = className;
        handle.dataset.audioEdit = type;
        if (type === 'fade-in') handle.style.left = `${Math.min(100, clip.fadeInLength / clip.duration * 100)}%`;
        if (type === 'fade-out') handle.style.right = `${Math.min(100, clip.fadeOutLength / clip.duration * 100)}%`;
        element.appendChild(handle);
      });

      element.addEventListener('pointerdown', event => {
        const edit = event.target.closest('[data-audio-edit]');
        if (edit) this.editor.edit.begin(event, clip.id, edit.dataset.audioEdit, element);
        else this.editor.drag.begin(event, clip.id, element);
      });
      element.addEventListener('dblclick', event => {
        if (event.target.closest('[data-audio-edit]')) return;
        event.stopPropagation();
        this.editor.renameInline(clip.id, element);
      });
      element.addEventListener('contextmenu', event => this.editor.openContextMenu(event, clip.id));
      return element;
    }
  }

  class AudioClipEditController {
    constructor(editor) { this.editor = editor; this.state = null; }
    begin(event, id, type, element) {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const clip = this.editor.find(id);
      this.editor.selection.ids.clear();
      this.editor.selection.ids.add(id);
      this.editor.selection.anchorId = id;
      this.state = {
        pointerId: event.pointerId, type, clip, element,
        startX: event.clientX, startY: event.clientY,
        initial: clone(clip), before: this.editor.snapshot()
      };
      element.setPointerCapture(event.pointerId);
      element.classList.add('editing');
      if (type === 'gain') document.body.classList.add('audio-gain-dragging');
      element.addEventListener('pointermove', this.move);
      element.addEventListener('pointerup', this.end);
      element.addEventListener('pointercancel', this.end);
      this.editor.renderSelectionOnly();
    }
    move = event => {
      const state = this.state;
      if (!state || event.pointerId !== state.pointerId) return;
      const frameDelta = Math.round((event.clientX - state.startX) / CellW);
      const clip = state.clip;
      const initial = state.initial;
      if (state.type === 'trim-left') {
        const delta = Math.max(-initial.sourceStart, Math.min(initial.duration - 1, frameDelta));
        clip.startFrame = initial.startFrame + delta;
        clip.duration = initial.duration - delta;
        clip.sourceStart = initial.sourceStart + delta;
      } else if (state.type === 'trim-right') {
        const maxDuration = Math.max(1, (initial.sourceDuration || initial.sourceEnd) - initial.sourceStart);
        const duration = Math.max(1, Math.min(maxDuration, initial.duration + frameDelta));
        clip.duration = duration;
        clip.sourceEnd = initial.sourceStart + duration;
        clip.sourceDuration = Math.max(initial.sourceDuration || initial.sourceEnd, clip.sourceEnd);
      } else if (state.type === 'fade-in') {
        const desired = Math.max(0, Math.min(clip.duration, initial.fadeInLength + (event.clientX - state.startX) / CellW));
        clip.fadeInLength = desired;
        clip.fadeOutLength = Math.min(initial.fadeOutLength, Math.max(0, clip.duration - desired));
      } else if (state.type === 'fade-out') {
        const desired = Math.max(0, Math.min(clip.duration, initial.fadeOutLength - (event.clientX - state.startX) / CellW));
        clip.fadeOutLength = desired;
        clip.fadeInLength = Math.min(initial.fadeInLength, Math.max(0, clip.duration - desired));
      } else if (state.type === 'gain') {
        const deltaDb = (state.startY - event.clientY) * 0.25;
        let gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, initial.gain + deltaDb));
        if (Math.abs(gain) < 0.6) gain = 0;
        clip.gain = Math.round(gain * 10) / 10;
        this.editor.showGainTooltip(event.clientX, event.clientY, clip.gain);
      }
      clip.fadeInLength = Math.min(clip.fadeInLength, clip.duration);
      clip.fadeOutLength = Math.min(clip.fadeOutLength, clip.duration);
      if (clip.fadeInLength + clip.fadeOutLength > clip.duration) {
        clip.fadeOutLength = Math.max(0, clip.duration - clip.fadeInLength);
      }
      this.editor.updateClipElement(state.element, clip);
      event.preventDefault();
    };
    end = event => {
      const state = this.state;
      if (!state || event.pointerId !== state.pointerId) return;
      if (state.element.hasPointerCapture(event.pointerId)) state.element.releasePointerCapture(event.pointerId);
      state.element.removeEventListener('pointermove', this.move);
      state.element.removeEventListener('pointerup', this.end);
      state.element.removeEventListener('pointercancel', this.end);
      this.editor.hideGainTooltip();
      document.body.classList.remove('audio-gain-dragging');
      this.state = null;
      this.editor.commit(state.before);
      this.editor.render();
    };
  }

  class AudioClipDragController {
    constructor(editor) { this.editor = editor; this.state = null; }
    begin(event, id, element) {
      if (event.button !== 0 || event.target.closest('input')) return;
      event.stopPropagation();
      this.editor.selection.select(id, event, this.editor.clips);
      this.editor.renderSelectionOnly();
      if (!this.editor.selection.ids.has(id)) return;
      const viewport = document.getElementById('audio-timeline-grid-viewport');
      const tracks = this.editor.trackIds();
      const clip = this.editor.find(id);
      const starts = new Map(this.editor.selectedClips().map(item => [item.id, {
        frame: item.startFrame, trackIndex: Math.max(0, tracks.indexOf(item.track))
      }]));
      const rect = viewport.getBoundingClientRect();
      this.state = {
        pointerId: event.pointerId, element, viewport, tracks, starts,
        before: this.editor.snapshot(), startTrack: tracks.indexOf(clip.track),
        startTimelineFrame: (event.clientX - rect.left + viewport.scrollLeft) / CellW,
        deltaFrame: 0, deltaTrack: 0
      };
      element.setPointerCapture(event.pointerId);
      element.addEventListener('pointermove', this.move);
      element.addEventListener('pointerup', this.end);
      element.addEventListener('pointercancel', this.end);
      event.preventDefault();
    }
    move = event => {
      const state = this.state;
      if (!state || event.pointerId !== state.pointerId) return;
      const rect = state.viewport.getBoundingClientRect();
      const frame = (event.clientX - rect.left + state.viewport.scrollLeft) / CellW;
      const minFrame = Math.min(...[...state.starts.values()].map(item => item.frame));
      state.deltaFrame = Math.max(-minFrame, Math.round(frame - state.startTimelineFrame));
      const rows = [...document.querySelectorAll('.audio-timeline-track-grid')];
      if (rows.length) {
        let targetIndex = 0;
        let nearestDistance = Infinity;
        rows.forEach((row, index) => {
          const bounds = row.getBoundingClientRect();
          const distance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
          if (distance < nearestDistance) { nearestDistance = distance; targetIndex = index; }
        });
        state.deltaTrack = targetIndex - state.startTrack;
      }
      const indices = [...state.starts.values()].map(item => item.trackIndex);
      state.deltaTrack = Math.max(-Math.min(...indices), Math.min(state.tracks.length - 1 - Math.max(...indices), state.deltaTrack));
      this.editor.selection.ids.forEach(id => {
        const selected = document.querySelector(`.audio-clip[data-audio-clip-id="${CSS.escape(id)}"]`);
        if (selected) selected.style.transform = `translate(${state.deltaFrame * CellW}px,${state.deltaTrack * audioWaveformHeight()}px)`;
      });
      event.preventDefault();
    };
    end = event => {
      const state = this.state;
      if (!state || event.pointerId !== state.pointerId) return;
      if (state.element.hasPointerCapture(event.pointerId)) state.element.releasePointerCapture(event.pointerId);
      state.element.removeEventListener('pointermove', this.move);
      state.element.removeEventListener('pointerup', this.end);
      state.element.removeEventListener('pointercancel', this.end);
      this.editor.selectedClips().forEach(clip => {
        const start = state.starts.get(clip.id);
        clip.startFrame = start.frame + state.deltaFrame;
        clip.track = state.tracks[start.trackIndex + state.deltaTrack];
      });
      this.state = null;
      this.editor.commit(state.before);
      this.editor.render();
    };
  }

  class AudioClipEditor {
    constructor() {
      this.clips = this.read();
      this.selection = new AudioClipSelection();
      this.renderer = new AudioClipRenderer(this);
      this.drag = new AudioClipDragController(this);
      this.edit = new AudioClipEditController(this);
      this.contextId = null;
      this.testClipDrag = null;
      this.testCounter = this.clips.length;
      this.gainTooltip = document.createElement('div');
      this.gainTooltip.className = 'audio-gain-tooltip';
      document.body.appendChild(this.gainTooltip);
      document.getElementById('audio-test-clip-add')?.addEventListener('pointerdown', event => this.beginTestClipDrag(event));
      document.getElementById('audio-timeline-labels').addEventListener('pointerdown', event => {
        const label = event.target.closest('.audio-timeline-track-label');
        if (!label || event.target.closest('button,input')) return;
        document.querySelectorAll('.audio-timeline-track-label.track-selected').forEach(item => item.classList.remove('track-selected'));
        label.classList.add('track-selected');
      });
      document.getElementById('audio-timeline-grid').addEventListener('pointerdown', event => {
        if (event.button === 0 && !event.target.closest('.audio-clip')) {
          this.selection.clear();
          this.render();
        }
      });
      document.addEventListener('keydown', event => this.onKeyDown(event));
      document.addEventListener('pointerdown', event => {
        if (!event.target.closest('#audio-clip-ctx-menu')) this.hideContextMenu();
      });
      window.addEventListener('audio-tracks-rendered', () => this.render());
      window.addEventListener('timeline-rendered', () => this.render());
      window.addEventListener('audio-waveform-height-change', () => this.render());
      this.bindContextMenu();
      this.render();
    }
    read() {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    snapshot() { return clone(this.clips); }
    persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.clips)); }
    restore(snapshot) {
      this.clips = clone(snapshot || []).map(normalizeClip);
      this.selection.clear();
      this.persist();
      this.render();
      window.AudioPlaybackEngine?.clipsChanged();
      return true;
    }
    commit(before) {
      const after = this.snapshot();
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      undoStack.push({ type: 'audio-clips', before, after });
      if (undoStack.length > 40) undoStack.shift();
      redoStack.length = 0;
      this.persist();
      window.AudioPlaybackEngine?.clipsChanged();
    }
    trackIds() { return window.AudioTimelineUI ? AudioTimelineUI.tracks.map(track => track.id) : []; }
    find(id) { return this.clips.find(clip => clip.id === id); }
    selectedClips() { return this.clips.filter(clip => this.selection.ids.has(clip.id)); }
    render() { this.renderer.render(); }
    renderSelectionOnly() {
      document.querySelectorAll('.audio-clip').forEach(element => {
        element.classList.toggle('selected', this.selection.ids.has(element.dataset.audioClipId));
      });
    }
    updateClipElement(element, clip) {
      element.style.left = `${clip.startFrame * CellW}px`;
      element.style.width = `${Math.max(CellW, clip.duration * CellW)}px`;
      const canvas = element.querySelector('.audio-clip-waveform');
      if (canvas) this.renderer.waveforms.draw(canvas, clip);
      const gain = element.querySelector('.audio-clip-gain-handle');
      if (gain) gain.title = (clip.gain > 0 ? '+' : '') + clip.gain.toFixed(1) + ' dB';
      const fadeIn = element.querySelector('.audio-clip-fade-curve.fade-in');
      if (fadeIn) fadeIn.style.width = `${Math.min(100, clip.fadeInLength / clip.duration * 100)}%`;
      const fadeOut = element.querySelector('.audio-clip-fade-curve.fade-out');
      if (fadeOut) fadeOut.style.width = `${Math.min(100, clip.fadeOutLength / clip.duration * 100)}%`;
      const fadeInHandle = element.querySelector('.audio-clip-fade-handle.left');
      if (fadeInHandle) fadeInHandle.style.left = `${Math.min(100, clip.fadeInLength / clip.duration * 100)}%`;
      const fadeOutHandle = element.querySelector('.audio-clip-fade-handle.right');
      if (fadeOutHandle) fadeOutHandle.style.right = `${Math.min(100, clip.fadeOutLength / clip.duration * 100)}%`;
    }
    showGainTooltip(x, y, gain) {
      this.gainTooltip.textContent = gain <= MIN_GAIN ? '-∞ dB' : `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
      this.gainTooltip.style.left = `${x + 10}px`;
      this.gainTooltip.style.top = `${y - 28}px`;
      this.gainTooltip.classList.add('visible');
    }
    hideGainTooltip() { this.gainTooltip.classList.remove('visible'); }
    beginTestClipDrag(event) {
      if (event.button !== 0) return;
      const button = event.currentTarget;
      const ghost = document.createElement('div');
      ghost.className = 'audio-test-clip-ghost';
      ghost.textContent = 'Audio Test';
      document.body.appendChild(ghost);
      this.testClipDrag = { pointerId: event.pointerId, button, ghost, startX: event.clientX, startY: event.clientY, moved: false, targetTrack: null, targetFrame: 0 };
      button.setPointerCapture(event.pointerId);
      button.classList.add('dragging');
      button.addEventListener('pointermove', this.moveTestClipDrag);
      button.addEventListener('pointerup', this.endTestClipDrag);
      button.addEventListener('pointercancel', this.endTestClipDrag);
      event.preventDefault();
    }
    moveTestClipDrag = event => {
      const state = this.testClipDrag;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) >= 3) {
        state.moved = true;
        state.ghost.classList.add('visible');
      }
      if (!state.moved) return;
      state.ghost.style.left = `${event.clientX + 12}px`;
      state.ghost.style.top = `${event.clientY + 10}px`;
      document.querySelectorAll('.audio-timeline-track-grid.drop-target').forEach(row => row.classList.remove('drop-target'));
      const viewport = document.getElementById('audio-timeline-grid-viewport');
      const viewportBounds = viewport.getBoundingClientRect();
      const row = [...document.querySelectorAll('.audio-timeline-track-grid')].find(candidate => {
        const bounds = candidate.getBoundingClientRect();
        return event.clientY >= bounds.top && event.clientY <= bounds.bottom && event.clientX >= viewportBounds.left && event.clientX <= viewportBounds.right;
      });
      state.targetTrack = row ? row.dataset.audioTrackId : null;
      state.targetFrame = Math.max(0, Math.round((event.clientX - viewportBounds.left + viewport.scrollLeft) / CellW));
      state.ghost.classList.toggle('can-drop', !!row);
      if (row) row.classList.add('drop-target');
      event.preventDefault();
    };
    endTestClipDrag = event => {
      const state = this.testClipDrag;
      if (!state || event.pointerId !== state.pointerId) return;
      this.testClipDrag = null;
      if (state.button.hasPointerCapture(event.pointerId)) state.button.releasePointerCapture(event.pointerId);
      state.button.removeEventListener('pointermove', this.moveTestClipDrag);
      state.button.removeEventListener('pointerup', this.endTestClipDrag);
      state.button.removeEventListener('pointercancel', this.endTestClipDrag);
      state.button.classList.remove('dragging');
      state.ghost.remove();
      document.querySelectorAll('.audio-timeline-track-grid.drop-target').forEach(row => row.classList.remove('drop-target'));
      if (state.moved && state.targetTrack) this.addTestClip(state.targetTrack, state.targetFrame);
    };
    addTestClip(track, startFrame) {
      const tracks = this.trackIds();
      if (!tracks.length) return;
      const before = this.snapshot();
      const name = TEST_NAMES[this.testCounter++ % TEST_NAMES.length];
      const clip = normalizeClip({
        id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name, track: track || tracks[0], startFrame: Math.max(0, Number(startFrame) || 0), duration: DEFAULT_DURATION,
        sourceStart: DEFAULT_DURATION, sourceEnd: DEFAULT_DURATION * 2, sourceDuration: DEFAULT_DURATION * 3
      });
      this.clips.push(clip);
      this.selection.clear();
      this.selection.ids.add(clip.id);
      this.selection.anchorId = clip.id;
      this.commit(before);
      this.render();
    }
    previewSlip(id, offset) {
      const clip = this.find(id);
      if (!clip) return false;
      const minimum = -clip.sourceStart;
      const maximum = Math.max(minimum, clip.sourceDuration - clip.sourceEnd);
      const previewOffset = Math.max(minimum, Math.min(maximum, Math.round(offset)));
      const canvas = document.querySelector(`.audio-clip[data-audio-clip-id="${CSS.escape(id)}"] .audio-clip-waveform`);
      if (canvas) this.renderer.waveforms.draw(canvas, { ...clip, sourceOffset: previewOffset });
      return true;
    }
    slipClip(id, offset) {
      const clip = this.find(id);
      if (!clip || !this.selection.ids.has(id)) return false;
      const minimum = -clip.sourceStart;
      const maximum = Math.max(minimum, clip.sourceDuration - clip.sourceEnd);
      const nextOffset = Math.max(minimum, Math.min(maximum, Math.round(offset)));
      if (nextOffset === clip.sourceOffset) return false;
      const before = this.snapshot();
      clip.sourceOffset = nextOffset;
      this.commit(before);
      this.render();
      return true;
    }
    importClips(items) {
      if (!Array.isArray(items) || !items.length) return [];
      const before = this.snapshot();
      this.selection.clear();
      const imported = items.map(item => normalizeClip({
        ...item,
        id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      }));
      imported.forEach(clip => {
        this.clips.push(clip);
        this.selection.ids.add(clip.id);
      });
      this.selection.anchorId = imported[imported.length - 1].id;
      this.commit(before);
      this.render();
      return imported.map(clip => clip.id);
    }
    stretchClip(id, change) {
      const clip = this.find(id);
      if (!clip || !this.selection.ids.has(id)) return false;
      const nextDuration = Math.max(1, Math.round(Number(change.duration) || clip.duration));
      const nextStart = Math.max(0, Math.round(Number(change.startFrame) || 0));
      const nextFactor = Number(change.stretchFactor);
      if (clip.duration === nextDuration && clip.startFrame === nextStart && clip.stretchFactor === nextFactor) return false;
      const before = this.snapshot();
      clip.startFrame = nextStart;
      clip.duration = nextDuration;
      clip.stretchFactor = Number.isFinite(nextFactor) && nextFactor > 0 ? nextFactor : 1;
      clip.fadeInLength = Math.min(clip.fadeInLength, clip.duration);
      clip.fadeOutLength = Math.min(clip.fadeOutLength, Math.max(0, clip.duration - clip.fadeInLength));
      this.commit(before);
      this.render();
      return true;
    }
    splitClip(id, absoluteFrame) {
      const clip = this.find(id);
      if (!clip) return false;
      const splitFrame = Math.round(absoluteFrame);
      const localFrame = splitFrame - clip.startFrame;
      if (localFrame <= 0 || localFrame >= clip.duration) return false;
      const before = this.snapshot();
      const original = clone(clip);
      const sourceSplit = original.sourceStart + localFrame;
      clip.duration = localFrame;
      clip.sourceEnd = sourceSplit;
      clip.fadeInLength = Math.min(original.fadeInLength, clip.duration);
      clip.fadeOutLength = Math.min(original.fadeOutLength, Math.max(0, clip.duration - clip.fadeInLength));
      const right = normalizeClip({
        ...original,
        id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        startFrame: splitFrame,
        duration: original.duration - localFrame,
        sourceStart: sourceSplit,
        sourceEnd: original.sourceEnd
      });
      right.fadeInLength = Math.min(original.fadeInLength, right.duration);
      right.fadeOutLength = Math.min(original.fadeOutLength, Math.max(0, right.duration - right.fadeInLength));
      const index = this.clips.indexOf(clip);
      this.clips.splice(index + 1, 0, right);
      this.selection.clear();
      this.selection.ids.add(clip.id);
      this.selection.ids.add(right.id);
      this.selection.anchorId = right.id;
      this.commit(before);
      this.render();
      return true;
    }
    duplicateSelected() {
      const selected = this.selectedClips();
      if (!selected.length) return;
      const before = this.snapshot();
      this.selection.clear();
      selected.forEach(source => {
        const duplicate = normalizeClip({
          ...clone(source),
          id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startFrame: source.startFrame + source.duration
        });
        this.clips.push(duplicate);
        this.selection.ids.add(duplicate.id);
      });
      this.commit(before);
      this.render();
    }
    deleteSelected() {
      if (!this.selection.ids.size) return;
      const before = this.snapshot();
      this.clips = this.clips.filter(clip => !this.selection.ids.has(clip.id));
      this.selection.clear();
      this.commit(before);
      this.render();
    }
    renameInline(id, element) {
      const clip = this.find(id);
      if (!clip) return;
      const before = this.snapshot();
      const input = document.createElement('input');
      input.className = 'audio-clip-name-input';
      input.value = clip.name;
      element.replaceChildren(input);
      input.focus();
      input.select();
      let done = false;
      const finish = save => {
        if (done) return;
        done = true;
        if (save && input.value.trim()) clip.name = input.value.trim();
        this.commit(before);
        this.render();
      };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
    }
    openContextMenu(event, id) {
      event.preventDefault();
      event.stopPropagation();
      this.contextId = id;
      if (!this.selection.ids.has(id)) {
        this.selection.clear();
        this.selection.ids.add(id);
        this.selection.anchorId = id;
        this.render();
      }
      const clip = this.find(id);
      const waveform = document.getElementById('audio-clip-ctx-waveform');
      waveform.textContent = clip.showWaveform ? 'Hide Waveform' : 'Show Waveform';
      const menu = document.getElementById('audio-clip-ctx-menu');
      menu.style.left = `${Math.min(event.clientX, innerWidth - 190)}px`;
      menu.style.top = `${Math.min(event.clientY, innerHeight - 190)}px`;
      menu.classList.add('visible');
    }
    hideContextMenu() { document.getElementById('audio-clip-ctx-menu').classList.remove('visible'); }
    bindContextMenu() {
      document.getElementById('audio-clip-ctx-waveform').addEventListener('click', () => {
        const clip = this.find(this.contextId);
        if (!clip) return;
        const before = this.snapshot();
        clip.showWaveform = !clip.showWaveform;
        this.hideContextMenu();
        this.commit(before);
        this.render();
      });
      document.getElementById('audio-clip-ctx-rename').addEventListener('click', () => {
        const element = document.querySelector(`.audio-clip[data-audio-clip-id="${CSS.escape(this.contextId || '')}"]`);
        this.hideContextMenu();
        if (element) this.renameInline(this.contextId, element);
      });
      document.getElementById('audio-clip-ctx-duplicate').addEventListener('click', () => {
        this.hideContextMenu(); this.duplicateSelected();
      });
      document.getElementById('audio-clip-ctx-delete').addEventListener('click', () => {
        this.hideContextMenu(); this.deleteSelected();
      });
      document.getElementById('audio-clip-ctx-properties').addEventListener('click', () => this.hideContextMenu());
    }
    onKeyDown(event) {
      if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.selection.ids.size) {
        event.preventDefault(); event.stopImmediatePropagation(); this.duplicateSelected();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection.ids.size) {
        event.preventDefault(); event.stopImmediatePropagation(); this.deleteSelected();
      }
    }
  }

  const editor = new AudioClipEditor();
  window.AudioClipUI = {
    restore: snapshot => editor.restore(snapshot),
    snapshot: () => editor.snapshot(),
    splitAt: (id, frame) => editor.splitClip(id, frame),
    importClips: items => editor.importClips(items),
    stretchClip: (id, change) => editor.stretchClip(id, change),
    previewSlip: (id, offset) => editor.previewSlip(id, offset),
    slipClip: (id, offset) => editor.slipClip(id, offset),
    get clips() { return editor.snapshot(); }
  };
})();
