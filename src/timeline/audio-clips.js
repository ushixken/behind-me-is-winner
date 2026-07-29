(() => {
  'use strict';

  const STORAGE_KEY = 'behindMe.audioTimeline.clips';
  const TEST_NAMES = ['Voice_01.wav', 'Rain.wav', 'Music.mp3', 'Explosion.wav'];
  const DEFAULT_DURATION = 12;

  const copy = value => JSON.parse(JSON.stringify(value));

  class AudioClipSelection {
    constructor() {
      this.ids = new Set();
      this.anchorId = null;
    }

    clear() {
      this.ids.clear();
      this.anchorId = null;
    }

    select(id, event, clips) {
      if (event.ctrlKey || event.metaKey) {
        if (this.ids.has(id)) this.ids.delete(id);
        else this.ids.add(id);
      } else if (event.shiftKey && this.anchorId) {
        const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame || a.track.localeCompare(b.track));
        const anchor = ordered.findIndex(clip => clip.id === this.anchorId);
        const target = ordered.findIndex(clip => clip.id === id);
        if (anchor >= 0 && target >= 0) {
          this.ids.clear();
          ordered.slice(Math.min(anchor, target), Math.max(anchor, target) + 1).forEach(clip => this.ids.add(clip.id));
        }
      } else {
        this.ids.clear();
        this.ids.add(id);
      }
      this.anchorId = id;
    }
  }

  class AudioClipRenderer {
    constructor(editor) {
      this.editor = editor;
    }

    render() {
      document.querySelectorAll('.audio-timeline-track-grid').forEach(row => {
        row.querySelectorAll('.audio-clip').forEach(clip => clip.remove());
      });
      this.editor.clips.forEach(clip => {
        const row = document.querySelector(`.audio-timeline-track-grid[data-audio-track-id="${CSS.escape(clip.track)}"]`);
        if (!row) return;
        row.appendChild(this.createClip(clip));
      });
    }

    createClip(clip) {
      const element = document.createElement('div');
      element.className = 'audio-clip';
      element.dataset.audioClipId = clip.id;
      element.style.left = `${clip.startFrame * CellW}px`;
      element.style.width = `${Math.max(CellW, clip.duration * CellW)}px`;
      element.classList.toggle('selected', this.editor.selection.ids.has(clip.id));
      const name = document.createElement('span');
      name.className = 'audio-clip-name';
      name.textContent = clip.name;
      element.appendChild(name);
      element.addEventListener('pointerdown', event => this.editor.drag.begin(event, clip.id, element));
      element.addEventListener('dblclick', event => {
        event.stopPropagation();
        this.editor.renameInline(clip.id, element);
      });
      element.addEventListener('contextmenu', event => this.editor.openContextMenu(event, clip.id));
      return element;
    }
  }

  class AudioClipDragController {
    constructor(editor) {
      this.editor = editor;
      this.drag = null;
    }

    begin(event, id, element) {
      if (event.button !== 0 || event.target.closest('input')) return;
      event.stopPropagation();
      this.editor.selection.select(id, event, this.editor.clips);
      document.querySelectorAll('.audio-clip').forEach(item => item.classList.toggle('selected', this.editor.selection.ids.has(item.dataset.audioClipId)));
      if (!this.editor.selection.ids.has(id)) return;
      const activeElement = element;
      const viewport = document.getElementById('audio-timeline-grid-viewport');
      const trackIds = this.editor.trackIds();
      const clip = this.editor.find(id);
      const startTrack = Math.max(0, trackIds.indexOf(clip.track));
      const before = copy(this.editor.clips);
      const starts = new Map();
      this.editor.selectedClips().forEach(item => starts.set(item.id, {
        frame: item.startFrame,
        trackIndex: Math.max(0, trackIds.indexOf(item.track))
      }));
      const rect = viewport.getBoundingClientRect();
      this.drag = {
        pointerId: event.pointerId,
        id,
        element: activeElement,
        viewport,
        before,
        starts,
        trackIds,
        startTrack,
        startTimelineFrame: (event.clientX - rect.left + viewport.scrollLeft) / CellW,
        deltaFrame: 0,
        deltaTrack: 0
      };
      activeElement.setPointerCapture(event.pointerId);
      activeElement.classList.add('dragging');
      activeElement.addEventListener('pointermove', this.onMove);
      activeElement.addEventListener('pointerup', this.onEnd);
      activeElement.addEventListener('pointercancel', this.onEnd);
      event.preventDefault();
    }

    onMove = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const rect = drag.viewport.getBoundingClientRect();
      const timelineFrame = (event.clientX - rect.left + drag.viewport.scrollLeft) / CellW;
      let deltaFrame = Math.round(timelineFrame - drag.startTimelineFrame);
      const minFrame = Math.min(...[...drag.starts.values()].map(start => start.frame));
      deltaFrame = Math.max(-minFrame, deltaFrame);

      const under = document.elementFromPoint(event.clientX, event.clientY);
      const row = under && under.closest('.audio-timeline-track-grid');
      let deltaTrack = drag.deltaTrack;
      if (row) {
        const targetTrack = drag.trackIds.indexOf(row.dataset.audioTrackId);
        if (targetTrack >= 0) deltaTrack = targetTrack - drag.startTrack;
      }
      const indices = [...drag.starts.values()].map(start => start.trackIndex);
      deltaTrack = Math.max(-Math.min(...indices), Math.min(drag.trackIds.length - 1 - Math.max(...indices), deltaTrack));
      drag.deltaFrame = deltaFrame;
      drag.deltaTrack = deltaTrack;

      document.querySelectorAll('.audio-timeline-track-grid.drop-target').forEach(item => item.classList.remove('drop-target'));
      const targetIndex = drag.startTrack + deltaTrack;
      const targetRow = document.querySelector(`.audio-timeline-track-grid[data-audio-track-id="${CSS.escape(drag.trackIds[targetIndex])}"]`);
      if (targetRow) targetRow.classList.add('drop-target');
      this.editor.selection.ids.forEach(selectedId => {
        const selected = document.querySelector(`.audio-clip[data-audio-clip-id="${CSS.escape(selectedId)}"]`);
        if (selected) {
          selected.classList.add('dragging');
          selected.style.transform = `translate(${deltaFrame * CellW}px,${deltaTrack * CellH}px)`;
        }
      });
      event.preventDefault();
    };

    onEnd = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
      drag.element.removeEventListener('pointermove', this.onMove);
      drag.element.removeEventListener('pointerup', this.onEnd);
      drag.element.removeEventListener('pointercancel', this.onEnd);
      this.editor.selectedClips().forEach(clip => {
        const start = drag.starts.get(clip.id);
        clip.startFrame = start.frame + drag.deltaFrame;
        clip.track = drag.trackIds[start.trackIndex + drag.deltaTrack];
      });
      this.drag = null;
      document.querySelectorAll('.audio-timeline-track-grid.drop-target').forEach(item => item.classList.remove('drop-target'));
      this.editor.commit(drag.before);
      this.editor.render();
    };
  }

  class AudioClipEditor {
    constructor() {
      this.clips = this.read();
      this.selection = new AudioClipSelection();
      this.renderer = new AudioClipRenderer(this);
      this.drag = new AudioClipDragController(this);
      this.contextId = null;
      this.testCounter = this.clips.length;
      document.getElementById('audio-test-clip-add').addEventListener('click', () => this.addTestClip());
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
      this.bindContextMenu();
      this.render();
    }

    read() {
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (Array.isArray(stored)) return stored;
      } catch (_) {}
      return [];
    }

    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.clips));
    }

    snapshot() {
      return copy(this.clips);
    }

    restore(snapshot) {
      this.clips = copy(snapshot || []);
      this.selection.clear();
      this.persist();
      this.render();
      return true;
    }

    commit(before) {
      const after = this.snapshot();
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      undoStack.push({ type: 'audio-clips', before, after });
      if (undoStack.length > 40) undoStack.shift();
      redoStack.length = 0;
      this.persist();
    }

    trackIds() {
      return window.AudioTimelineUI ? AudioTimelineUI.tracks.map(track => track.id) : [];
    }

    find(id) {
      return this.clips.find(clip => clip.id === id);
    }

    selectedClips() {
      return this.clips.filter(clip => this.selection.ids.has(clip.id));
    }

    render() {
      this.renderer.render();
    }

    addTestClip() {
      const tracks = this.trackIds();
      if (!tracks.length) return;
      const selectedTrack = document.querySelector('.audio-timeline-track-label.track-selected');
      const track = selectedTrack ? selectedTrack.dataset.audioTrackId : tracks[0];
      const before = this.snapshot();
      const name = TEST_NAMES[this.testCounter++ % TEST_NAMES.length];
      const clip = {
        id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        track,
        startFrame: Math.max(0, typeof curFrame === 'number' ? curFrame : 0),
        duration: DEFAULT_DURATION
      };
      this.clips.push(clip);
      this.selection.clear();
      this.selection.ids.add(clip.id);
      this.selection.anchorId = clip.id;
      this.commit(before);
      this.render();
    }

    duplicateSelected() {
      const selected = this.selectedClips();
      if (!selected.length) return;
      const before = this.snapshot();
      this.selection.clear();
      selected.forEach(source => {
        const duplicate = {
          ...copy(source),
          id: `audio-clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startFrame: source.startFrame + source.duration
        };
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
      if (!clip || element.querySelector('input')) return;
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
        const value = input.value.trim();
        if (save && value) clip.name = value;
        this.commit(before);
        this.render();
      };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
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
      const menu = document.getElementById('audio-clip-ctx-menu');
      menu.style.left = `${Math.min(event.clientX, innerWidth - 180)}px`;
      menu.style.top = `${Math.min(event.clientY, innerHeight - 160)}px`;
      menu.classList.add('visible');
    }

    hideContextMenu() {
      document.getElementById('audio-clip-ctx-menu').classList.remove('visible');
    }

    bindContextMenu() {
      document.getElementById('audio-clip-ctx-rename').addEventListener('click', () => {
        const element = document.querySelector(`.audio-clip[data-audio-clip-id="${CSS.escape(this.contextId || '')}"]`);
        this.hideContextMenu();
        if (element) this.renameInline(this.contextId, element);
      });
      document.getElementById('audio-clip-ctx-duplicate').addEventListener('click', () => {
        this.hideContextMenu();
        this.duplicateSelected();
      });
      document.getElementById('audio-clip-ctx-delete').addEventListener('click', () => {
        this.hideContextMenu();
        this.deleteSelected();
      });
      document.getElementById('audio-clip-ctx-properties').addEventListener('click', () => this.hideContextMenu());
    }

    onKeyDown(event) {
      if (event.target.closest('input,textarea,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && this.selection.ids.size) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.duplicateSelected();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selection.ids.size) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.deleteSelected();
      }
    }
  }

  const editor = new AudioClipEditor();
  window.AudioClipUI = {
    restore: snapshot => editor.restore(snapshot),
    snapshot: () => editor.snapshot(),
    get clips() { return editor.snapshot(); }
  };
})();
