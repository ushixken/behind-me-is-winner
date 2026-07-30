(() => {
  'use strict';

  const ACCEPTED_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'oga', 'flac']);
  const WAVEFORM_SAMPLES = 720;

  const audioContextManager = window.AudioContextManager || {
    context: null,
    get() {
      if (this.context?.state === 'closed') this.context = null;
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('Web Audio is not supported by this browser.');
        this.context = new Context();
      }
      return this.context;
    }
  };
  window.AudioContextManager = audioContextManager;

  class AudioSourceStore {
    constructor() {
      this.sources = new Map();
      this.keys = new Map();
      this.pending = new Map();
    }
    keyFor(file) {
      return `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
    }
    getByKey(key) {
      const id = this.keys.get(key);
      return id ? this.sources.get(id) : null;
    }
    add(key, source) {
      this.sources.set(source.id, source);
      this.keys.set(key, source.id);
      return source;
    }
  }

  class AudioDecoder {
    getContext() { return audioContextManager.get(); }
    async decode(file) {
      const bytes = await file.arrayBuffer();
      return this.getContext().decodeAudioData(bytes.slice(0));
    }
  }

  class WaveformGenerator {
    generate(buffer, count = WAVEFORM_SAMPLES) {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
      const samples = new Array(count).fill(0);
      const framesPerBucket = Math.max(1, Math.floor(buffer.length / count));
      for (let bucket = 0; bucket < count; bucket++) {
        const from = bucket * framesPerBucket;
        const to = bucket === count - 1 ? buffer.length : Math.min(buffer.length, from + framesPerBucket);
        let peak = 0;
        for (let frame = from; frame < to; frame++) {
          let mixed = 0;
          for (const channel of channels) mixed += Math.abs(channel[frame] || 0);
          peak = Math.max(peak, mixed / channels.length);
        }
        samples[bucket] = Math.min(1, peak);
      }
      return samples;
    }
  }

  class AudioImporter {
    constructor(store, decoder, waveformGenerator) {
      this.store = store;
      this.decoder = decoder;
      this.waveformGenerator = waveformGenerator;
    }
    validates(file) {
      const extension = file.name.split('.').pop().toLowerCase();
      return ACCEPTED_EXTENSIONS.has(extension) || file.type.startsWith('audio/');
    }
    async import(file, onStage) {
      if (!this.validates(file)) throw new Error(`"${file.name}" is not a supported audio file.`);
      const key = this.store.keyFor(file);
      const cached = this.store.getByKey(key);
      if (cached) return cached;
      if (this.store.pending.has(key)) return this.store.pending.get(key);
      const pending = (async () => {
        onStage?.('Decoding…');
        let buffer;
        try {
          buffer = await this.decoder.decode(file);
        } catch (_) {
          throw new Error(`"${file.name}" could not be decoded.`);
        }
        onStage?.('Generating waveform…');
        const waveform = this.waveformGenerator.generate(buffer);
        const id = `audio-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const source = {
          id,
          key,
          name: file.name,
          type: file.type,
          size: file.size,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          channelCount: buffer.numberOfChannels,
          frameLength: buffer.length,
          pcm: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
          audioBuffer: buffer,
          waveform
        };
        return this.store.add(key, source);
      })();
      this.store.pending.set(key, pending);
      try {
        return await pending;
      } finally {
        this.store.pending.delete(key);
      }
    }
  }

  class AudioImportDialog {
    constructor(importer) {
      this.importer = importer;
      this.input = document.createElement('input');
      this.input.type = 'file';
      this.input.multiple = true;
      this.input.accept = '.wav,.mp3,.ogg,.oga,.flac,audio/wav,audio/mpeg,audio/ogg,audio/flac';
      this.input.hidden = true;
      this.input.id = 'audio-import-input';
      document.body.appendChild(this.input);
      this.status = document.createElement('div');
      this.status.className = 'audio-import-status';
      document.getElementById('audio-timeline').appendChild(this.status);
      this.dropTarget = document.getElementById('audio-timeline-body');
      this.viewport = document.getElementById('audio-timeline-grid-viewport');
      this.input.addEventListener('change', () => this.importPickedFiles());
      document.getElementById('dd-import-audio').addEventListener('click', () => {
        if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
        this.input.value = '';
        this.input.click();
      });
      this.dropTarget.addEventListener('dragenter', event => this.onDragEnter(event));
      this.dropTarget.addEventListener('dragover', event => this.onDragOver(event));
      this.dropTarget.addEventListener('dragleave', event => this.onDragLeave(event));
      this.dropTarget.addEventListener('drop', event => this.onDrop(event));
    }

    audioFiles(dataTransfer) {
      return [...(dataTransfer?.files || [])].filter(file => this.importer.validates(file));
    }
    onDragEnter(event) {
      if (!this.audioFiles(event.dataTransfer).length && ![...(event.dataTransfer?.items || [])].some(item => item.kind === 'file')) return;
      event.preventDefault();
      this.dropTarget.classList.add('audio-import-dragover');
    }
    onDragOver(event) {
      if (![...(event.dataTransfer?.items || [])].some(item => item.kind === 'file')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.dropTarget.classList.add('audio-import-dragover');
      this.updateDropTrack(event.clientY);
    }
    onDragLeave(event) {
      if (this.dropTarget.contains(event.relatedTarget)) return;
      this.clearDropState();
    }
    async onDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      const files = this.audioFiles(event.dataTransfer);
      const placement = this.dropPlacement(event.clientX, event.clientY);
      this.clearDropState();
      if (!files.length) {
        this.showError('No supported audio files were dropped.');
        return;
      }
      await this.importFiles(files, placement.track, placement.frame);
    }
    updateDropTrack(clientY) {
      document.querySelectorAll('.audio-timeline-track-grid.audio-import-target').forEach(row => row.classList.remove('audio-import-target'));
      const row = this.trackAt(clientY);
      row?.classList.add('audio-import-target');
    }
    clearDropState() {
      this.dropTarget.classList.remove('audio-import-dragover');
      document.getElementById('img-drop-overlay')?.classList.remove('active', 'over-canvas');
      document.querySelectorAll('.audio-timeline-track-grid.audio-import-target').forEach(row => row.classList.remove('audio-import-target'));
    }
    trackAt(clientY) {
      return [...document.querySelectorAll('.audio-timeline-track-grid')].find(row => {
        const bounds = row.getBoundingClientRect();
        return clientY >= bounds.top && clientY <= bounds.bottom;
      }) || null;
    }
    dropPlacement(clientX, clientY) {
      const tracks = window.AudioTimelineUI?.tracks || [];
      const row = this.trackAt(clientY);
      const bounds = this.viewport.getBoundingClientRect();
      return {
        track: row?.dataset.audioTrackId || tracks[0]?.id,
        frame: Math.max(0, Math.round((clientX - bounds.left + this.viewport.scrollLeft) / CellW))
      };
    }
    async importPickedFiles() {
      const files = [...(this.input.files || [])];
      if (!files.length) return;
      const tracks = window.AudioTimelineUI?.tracks || [];
      const selectedTrack = document.querySelector('.audio-timeline-track-label.track-selected');
      await this.importFiles(
        files,
        selectedTrack?.dataset.audioTrackId || tracks[0]?.id,
        Math.max(0, typeof curFrame === 'number' ? curFrame : 0)
      );
    }
    framesFor(source) {
      const fps = typeof getFPS === 'function' ? getFPS() : Number(window.fpsTl?.value) || 24;
      return Math.max(1, Math.ceil(source.duration * fps));
    }
    async importFiles(files, track, startFrame) {
      if (!track) {
        this.showError('Create an Audio Track before importing audio.');
        return;
      }
      const clips = [];
      let lastError = null;
      let cursor = startFrame;
      this.setStatus('Importing…');
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
          const source = await this.importer.import(file, stage => {
            this.setStatus(`${stage} ${index + 1}/${files.length}`);
          });
          const duration = this.framesFor(source);
          clips.push({
            name: source.name,
            track,
            startFrame: cursor,
            duration,
            sourceStart: 0,
            sourceEnd: duration,
            sourceDuration: duration,
            sourceOffset: 0,
            fadeInLength: 0,
            fadeOutLength: 0,
            gain: 0,
            stretchFactor: 1,
            showWaveform: true,
            sourceId: source.id,
            waveform: source.waveform
          });
          cursor += duration;
        } catch (error) {
          lastError = error;
          this.showError(error.message);
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      if (clips.length) {
        window.AudioClipUI?.importClips(clips);
        this.hideStatus();
      } else if (!lastError) {
        this.hideStatus();
      }
    }
    setStatus(text) {
      this.status.textContent = text;
      this.status.classList.add('visible');
      this.status.classList.remove('error');
    }
    hideStatus() { this.status.classList.remove('visible', 'error'); }
    showError(message) {
      this.status.textContent = message;
      this.status.classList.add('visible', 'error');
      clearTimeout(this.errorTimer);
      this.errorTimer = setTimeout(() => this.hideStatus(), 4000);
    }
  }

  const sources = new AudioSourceStore();
  const importer = new AudioImporter(sources, new AudioDecoder(), new WaveformGenerator());
  new AudioImportDialog(importer);
  window.AudioSources = {
    get: id => sources.sources.get(id) || null,
    get all() { return [...sources.sources.values()]; }
  };
})();
