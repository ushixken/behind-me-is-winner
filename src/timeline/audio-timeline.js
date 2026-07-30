(() => {
  'use strict';

  const STORAGE_HEIGHT = 'behindMe.audioTimeline.height';
  const STORAGE_COLLAPSED = 'behindMe.audioTimeline.collapsed';
  const STORAGE_TRACKS = 'behindMe.audioTimeline.tracks';
  const HEADER_HEIGHT = 25;
  const DEFAULT_HEIGHT = 132;
  const DEFAULT_TRACKS = Object.freeze([
    { id: 'audio-track-1', name: 'Track 1' },
    { id: 'audio-track-2', name: 'Track 2' },
    { id: 'audio-track-3', name: 'Track 3' },
    { id: 'audio-track-4', name: 'Track 4' }
  ]);

  class AudioTimelineHeader {
    constructor(section) {
      this.section = section;
      this.button = document.getElementById('audio-timeline-collapse');
      this.addButton = document.getElementById('audio-track-add');
      this.button.addEventListener('click', () => section.setCollapsed(!section.collapsed));
      this.addButton.addEventListener('click', event => { event.stopPropagation(); section.addTrack(); });
    }

    render() {
      this.button.setAttribute('aria-expanded', String(!this.section.collapsed));
      this.button.querySelector('.audio-timeline-disclosure').textContent = this.section.collapsed ? '▶' : '▼';
    }
  }

  class AudioTimelineTrackRow {
    constructor(section, track, index) { this.section = section; this.track = track; this.index = index; }

    createLabel() {
      const row = document.createElement('div');
      row.className = 'audio-timeline-track-label';
      row.dataset.audioTrackId = this.track.id;
      row.dataset.audioTrackIndex = String(this.index);
      const handle = document.createElement('button');
      handle.type = 'button'; handle.className = 'audio-track-drag-handle'; handle.title = 'Reorder Track';
      handle.setAttribute('aria-label', `Reorder ${this.track.name}`); handle.textContent = '⋮⋮';
      const name = document.createElement('span');
      name.className = 'audio-track-name'; name.textContent = this.track.name;
      name.addEventListener('dblclick', event => { event.stopPropagation(); this.section.renameTrack(this.track.id, name); });
      const future = document.createElement('span'); future.className = 'audio-track-future-controls'; future.setAttribute('aria-hidden', 'true');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'audio-track-delete'; remove.title = 'Delete Track'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${this.track.name}`);
      remove.addEventListener('click', event => { event.stopPropagation(); this.section.deleteTrack(this.track.id); });
      row.append(handle, name, future, remove);
      this.section.bindReorder(handle, this.index);
      return row;
    }

    createGridRow() {
      const row = document.createElement('div');
      row.className = 'audio-timeline-track-grid';
      row.dataset.audioTrackId = this.track.id;
      row.dataset.audioTrackIndex = String(this.index);
      return row;
    }
  }

  class AudioTimelineViewport {
    constructor(section, labels, viewport, grid) {
      this.section = section;
      this.labels = labels;
      this.viewport = viewport;
      this.grid = grid;
      this.syncing = false;

      labels.addEventListener('scroll', () => this.syncVertical(labels, viewport));
      viewport.addEventListener('scroll', () => {
        this.syncVertical(viewport, labels);
        const timelineScroll = document.getElementById('tl-scroll');
        if (!this.syncing && timelineScroll && viewport.scrollLeft !== timelineScroll.scrollLeft) {
          timelineScroll.scrollLeft = viewport.scrollLeft;
        }
      });
      this.scrubPointerId = null;
      viewport.addEventListener('pointerdown', event => this.beginScrub(event));
      viewport.addEventListener('pointermove', event => this.moveScrub(event));
      viewport.addEventListener('pointerup', event => this.endScrub(event));
      viewport.addEventListener('pointercancel', event => this.endScrub(event));
      viewport.addEventListener('lostpointercapture', event => {
        if(this.scrubPointerId != null) window.TimelineScrubController?.end(this.scrubPointerId);
        this.scrubPointerId = null;
        this.viewport.classList.remove('audio-scrubbing');
        window.AudioPlaybackEngine?.endScrub();
      });

      viewport.addEventListener('wheel', event => {
        const timelineScroll = document.getElementById('tl-scroll');
        const delta = event.shiftKey ? event.deltaY : event.deltaX;
        if (!timelineScroll || !delta) return;
        event.preventDefault();
        timelineScroll.scrollLeft += delta;
      }, { passive: false });
    }

    frameFromPointer(event) {
      const rect = this.viewport.getBoundingClientRect();
      return Math.max(0, Math.min(
        TOTAL - 1,
        (event.clientX - rect.left + this.viewport.scrollLeft - CellW / 2) / CellW
      ));
    }

    beginScrub(event) {
      if (event.button !== 0 || event.target.closest('button,input')) return;
      const rect = this.viewport.getBoundingClientRect();
      if (event.clientX >= rect.right - 10) return;
      this.scrubPointerId = event.pointerId;
      this.viewport.setPointerCapture(event.pointerId);
      this.viewport.classList.add('audio-scrubbing');
      const position = this.frameFromPointer(event);
      window.TimelineScrubController?.begin('audio', event.pointerId, position);
      const continuous = window.TimelineScrubController?.updateAudio(position, frame => goToFrame(frame, false, false, true)) ?? position;
      if(!(typeof playing === 'boolean' && playing)) window.AudioPlaybackEngine?.frameChanged(continuous,{playing:false,scrubbing:true});
      event.preventDefault();
    }

    moveScrub(event) {
      if (event.pointerId !== this.scrubPointerId) return;
      const position = this.frameFromPointer(event);
      const continuous = window.TimelineScrubController?.updateAudio(position, frame => goToFrame(frame, false, false, true)) ?? position;
      if(!(typeof playing === 'boolean' && playing)) window.AudioPlaybackEngine?.frameChanged(continuous,{playing:false,scrubbing:true});
      event.preventDefault();
    }

    endScrub(event) {
      if (event.pointerId !== this.scrubPointerId) return;
      if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
      this.scrubPointerId = null;
      this.viewport.classList.remove('audio-scrubbing');
      window.TimelineScrubController?.end(event.pointerId);
      window.AudioPlaybackEngine?.endScrub();
    }

    syncVertical(source, target) {
      if (this.syncing || source.scrollTop === target.scrollTop) return;
      this.syncing = true;
      target.scrollTop = source.scrollTop;
      this.syncing = false;
    }

    syncHorizontal() {
      const timelineScroll = document.getElementById('tl-scroll');
      if (!timelineScroll || this.viewport.scrollLeft === timelineScroll.scrollLeft) return;
      this.syncing = true;
      this.viewport.scrollLeft = timelineScroll.scrollLeft;
      this.syncing = false;
    }

    render(tracks) {
      this.labels.replaceChildren();
      this.grid.replaceChildren();
      if (!tracks.length) {
        const label = document.createElement('div');
        label.className = 'audio-timeline-empty-label';
        const message = document.createElement('span'); message.textContent = 'No audio tracks.';
        const add = document.createElement('button'); add.type = 'button'; add.className = 'audio-empty-add'; add.textContent = 'Add Track';
        add.addEventListener('click', () => this.section.addTrack());
        label.append(message, add);
        this.labels.appendChild(label);
        const gridRow = document.createElement('div'); gridRow.className = 'audio-timeline-empty-grid'; this.grid.appendChild(gridRow);
      } else {
        const labels = document.createDocumentFragment();
        const gridRows = document.createDocumentFragment();
        tracks.forEach((track, index) => {
          const row = new AudioTimelineTrackRow(this.section, track, index);
          labels.appendChild(row.createLabel());
          gridRows.appendChild(row.createGridRow());
        });
        this.labels.appendChild(labels);
        this.grid.appendChild(gridRows);
      }
      this.updateGeometry();
      window.dispatchEvent(new CustomEvent('audio-tracks-rendered'));
    }

    updateGeometry() {
      const cellWidth = typeof CellW === 'number' ? CellW : 28;
      const totalFrames = typeof TOTAL === 'number' ? TOTAL : 1;
      const fps = typeof getFPS === 'function' ? Math.max(1, getFPS()) : 24;
      const frame = Number.isFinite(window.SharedPlayhead?.position) ? window.SharedPlayhead.position : (typeof curFrame === 'number' ? curFrame : 0);
      const timelineBody = document.getElementById('tl-body');
      const timelineScroll = document.getElementById('tl-scroll');
      if (timelineBody && timelineScroll) {
        const labelWidth = Math.max(0, timelineScroll.getBoundingClientRect().left - timelineBody.getBoundingClientRect().left);
        this.viewport.parentElement.style.gridTemplateColumns = `${labelWidth}px minmax(0,1fr)`;
      }
      this.grid.style.width = `${Math.max(this.viewport.clientWidth, totalFrames * cellWidth)}px`;
      this.grid.style.setProperty('--audio-cell-width', `${cellWidth}px`);
      this.grid.style.setProperty('--audio-second-width', `${cellWidth * fps}px`);

      let playhead = this.grid.querySelector('.audio-timeline-playhead');
      if (!playhead) {
        playhead = document.createElement('div');
        playhead.className = 'audio-timeline-playhead';
        this.grid.appendChild(playhead);
      }
      playhead.style.left = `${frame * cellWidth + cellWidth / 2 - 1}px`;
      this.syncHorizontal();
    }
  }

  class AudioTimelineDivider {
    constructor(section, element) {
      this.section = section;
      this.element = element;
      this.pointerId = null;
      element.addEventListener('pointerdown', event => this.start(event));
      element.addEventListener('pointermove', event => this.move(event));
      element.addEventListener('pointerup', event => this.end(event));
      element.addEventListener('pointercancel', event => this.end(event));
      element.addEventListener('lostpointercapture', () => this.cancel());
    }

    start(event) {
      if (event.button !== 0) return;
      this.pointerId = event.pointerId;
      this.startY = event.clientY;
      this.startHeight = this.section.collapsed ? HEADER_HEIGHT : this.section.height;
      if (this.section.collapsed) this.section.setCollapsed(false, false);
      this.element.setPointerCapture(event.pointerId);
      this.element.classList.add('dragging');
      document.body.classList.add('audio-timeline-resizing');
      event.preventDefault();
    }

    move(event) {
      if (event.pointerId !== this.pointerId) return;
      const nextHeight = this.startHeight + this.startY - event.clientY;
      if (nextHeight <= HEADER_HEIGHT) this.section.setCollapsed(true, false);
      else { if (this.section.collapsed) this.section.setCollapsed(false, false); this.section.setHeight(nextHeight, false); }
      event.preventDefault();
    }

    end(event) {
      if (event.pointerId !== this.pointerId) return;
      if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
      this.cancel();
      this.section.persist();
    }

    cancel() {
      this.pointerId = null;
      this.element.classList.remove('dragging');
      document.body.classList.remove('audio-timeline-resizing');
    }
  }

  class AudioTimelineSection {
    constructor() {
      this.root = document.getElementById('audio-timeline');
      this.divider = document.getElementById('audio-timeline-resize');
      this.tracks = this.readTracks();
      this.height = this.readNumber(STORAGE_HEIGHT, DEFAULT_HEIGHT);
      this.collapsed = localStorage.getItem(STORAGE_COLLAPSED) === 'true';
      this.header = new AudioTimelineHeader(this);
      this.viewport = new AudioTimelineViewport(
        this,
        document.getElementById('audio-timeline-labels'),
        document.getElementById('audio-timeline-grid-viewport'),
        document.getElementById('audio-timeline-grid')
      );
      this.resizeController = new AudioTimelineDivider(this, this.divider);

      document.getElementById('tl-scroll').addEventListener('scroll', () => this.viewport.syncHorizontal());
      window.addEventListener('timeline-rendered', () => this.viewport.updateGeometry());
      window.addEventListener('timeline-playhead-updated', () => this.viewport.updateGeometry());
      window.addEventListener('resize', () => this.applyHeight());
      if (window.ResizeObserver) {
        const geometryObserver = new ResizeObserver(() => this.viewport.updateGeometry());
        geometryObserver.observe(this.root);
        geometryObserver.observe(document.getElementById('tl-scroll'));
        new ResizeObserver(() => this.applyHeight()).observe(document.getElementById('tl-body'));
      }

      this.viewport.render(this.tracks);
      this.setCollapsed(this.collapsed, false);
    }

    readNumber(key, fallback) {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    }

    readTracks() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_TRACKS));
        if (Array.isArray(saved)) return saved.map(track => ({ id: String(track.id), name: String(track.name) }));
      } catch (_) {}
      return DEFAULT_TRACKS.map(track => ({ ...track }));
    }

    nextTrackName() {
      const used = new Set(this.tracks.map(track => track.name));
      let number = 1;
      while (used.has(`Track ${number}`)) number++;
      return `Track ${number}`;
    }

    addTrack() {
      this.tracks.push({ id: `audio-track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: this.nextTrackName() });
      this.persistTracks(); this.viewport.render(this.tracks);
    }

    deleteTrack(id) {
      this.tracks = this.tracks.filter(track => track.id !== id);
      this.persistTracks(); this.viewport.render(this.tracks);
    }

    renameTrack(id, label) {
      const track = this.tracks.find(item => item.id === id); if (!track || label.querySelector('input')) return;
      const input = document.createElement('input'); input.className = 'audio-track-name-input'; input.value = track.name;
      label.replaceChildren(input); input.focus(); input.select(); let done = false;
      const finish = save => { if (done) return; done = true; const value = input.value.trim(); if (save && value) track.name = value; this.persistTracks(); label.textContent = track.name; };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
    }

    bindReorder(handle, index) {
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        this.trackDrag = { pointerId: event.pointerId, from: index, to: index };
        handle.setPointerCapture(event.pointerId); handle.closest('.audio-timeline-track-label').classList.add('reordering'); event.preventDefault();
      });
      handle.addEventListener('pointermove', event => {
        if (!this.trackDrag || event.pointerId !== this.trackDrag.pointerId) return;
        const under = document.elementFromPoint(event.clientX, event.clientY); const row = under && under.closest('.audio-timeline-track-label');
        if (!row || !this.viewport.labels.contains(row)) return;
        this.trackDrag.to = Number(row.dataset.audioTrackIndex);
        this.viewport.labels.querySelectorAll('.reorder-target').forEach(item => item.classList.remove('reorder-target')); row.classList.add('reorder-target');
      });
      const finish = event => {
        if (!this.trackDrag || event.pointerId !== this.trackDrag.pointerId) return;
        const { from, to } = this.trackDrag; this.trackDrag = null;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        if (from !== to) { const [track] = this.tracks.splice(from, 1); this.tracks.splice(to, 0, track); this.persistTracks(); }
        this.viewport.render(this.tracks);
      };
      handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
    }

    persistTracks() { localStorage.setItem(STORAGE_TRACKS, JSON.stringify(this.tracks)); }

    maximumHeight() {
      const body = document.getElementById('tl-body');
      return Math.max(HEADER_HEIGHT, Math.floor(body.clientHeight * 0.65));
    }

    setHeight(value, persist = true) {
      this.height = Math.max(HEADER_HEIGHT, Math.min(this.maximumHeight(), value));
      this.applyHeight();
      if (persist) this.persist();
    }

    applyHeight() {
      const height = this.collapsed ? HEADER_HEIGHT : Math.min(this.height, this.maximumHeight());
      this.root.style.height = `${height}px`;
      this.viewport.updateGeometry();
    }

    setCollapsed(collapsed, persist = true) {
      this.collapsed = Boolean(collapsed);
      this.root.classList.toggle('collapsed', this.collapsed);
      this.header.render();
      this.applyHeight();
      if (persist) this.persist();
    }

    setTracks(tracks) {
      this.tracks = Array.isArray(tracks) ? tracks.map(track => ({ ...track })) : [];
      this.persistTracks();
      this.viewport.render(this.tracks);
    }

    persist() {
      localStorage.setItem(STORAGE_HEIGHT, String(Math.round(this.height)));
      localStorage.setItem(STORAGE_COLLAPSED, String(this.collapsed));
    }
  }

  const section = new AudioTimelineSection();
  window.AudioTimelineUI = {
    addTrack: () => section.addTrack(),
    deleteTrack: id => section.deleteTrack(id),
    setTracks: tracks => section.setTracks(tracks),
    setCollapsed: collapsed => section.setCollapsed(collapsed),
    get collapsed() { return section.collapsed; },
    get tracks() { return section.tracks.map(track => ({ ...track })); }
  };
})();
