(() => {
  'use strict';

  const MIN_DURATION = 1;
  const EDGE_SIZE = 8;

  class AudioStretchTool {
    constructor() {
      this.active = false;
      this.hoverClip = null;
      this.drag = null;
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.id = 'audio-stretch-tool';
      this.button.className = 'audio-toolbar-tool';
      this.button.title = 'Time Stretch Tool';
      this.button.setAttribute('aria-label', 'Time Stretch Tool');
      this.button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h13M1.5 8l3-3M1.5 8l3 3M14.5 8l-3-3M14.5 8l-3 3"/></svg>';
      document.querySelector('.audio-header-actions').prepend(this.button);
      this.grid = document.getElementById('audio-timeline-grid');
      this.viewport = document.getElementById('audio-timeline-grid-viewport');
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'audio-stretch-tooltip';
      document.body.appendChild(this.tooltip);
      this.button.addEventListener('click', () => this.setActive(!this.active));
      this.grid.addEventListener('pointermove', event => this.onHover(event), true);
      this.grid.addEventListener('pointerleave', () => {
        if (!this.drag) this.clearHover();
      }, true);
      this.grid.addEventListener('pointerdown', event => this.onPointerDown(event), true);
      window.addEventListener('audio-timeline-tool-change', event => {
        if (event.detail?.tool !== 'stretch') this.setActive(false, false);
      });
    }

    setActive(active, announce = true) {
      this.active = !!active;
      this.button.classList.toggle('active', this.active);
      this.button.setAttribute('aria-pressed', String(this.active));
      this.grid.classList.toggle('audio-stretch-active', this.active);
      if (!this.active) this.clearHover();
      window.AudioTimelineTool = this.active ? 'stretch' : null;
      if (announce) {
        window.dispatchEvent(new CustomEvent('audio-timeline-tool-change', {
          detail: { tool: this.active ? 'stretch' : 'selection' }
        }));
      }
    }

    modelFor(element) {
      return window.AudioClipUI?.clips.find(clip => clip.id === element?.dataset.audioClipId);
    }

    edgeAt(event, clipElement) {
      if (!clipElement?.classList.contains('selected')) return null;
      const bounds = clipElement.getBoundingClientRect();
      if (Math.abs(event.clientX - bounds.left) <= EDGE_SIZE) return 'left';
      if (Math.abs(event.clientX - bounds.right) <= EDGE_SIZE) return 'right';
      return null;
    }

    onHover(event) {
      if (!this.active || this.drag) return;
      const clip = event.target.closest('.audio-clip');
      const edge = this.edgeAt(event, clip);
      this.clearHover();
      if (!edge) return;
      this.hoverClip = clip;
      clip.classList.add('audio-stretch-hover', `audio-stretch-${edge}`);
    }

    clearHover() {
      if (this.hoverClip) {
        this.hoverClip.classList.remove('audio-stretch-hover', 'audio-stretch-left', 'audio-stretch-right');
      }
      this.hoverClip = null;
    }

    pointerFrame(event) {
      const bounds = this.viewport.getBoundingClientRect();
      return Math.round((event.clientX - bounds.left + this.viewport.scrollLeft) / CellW);
    }

    onPointerDown(event) {
      if (!this.active || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const element = event.target.closest('.audio-clip');
      const edge = this.edgeAt(event, element);
      const clip = this.modelFor(element);
      if (!edge || !clip) return;
      this.clearHover();
      this.drag = {
        pointerId: event.pointerId,
        element,
        edge,
        id: clip.id,
        originalStart: clip.startFrame,
        originalDuration: clip.duration,
        originalStretch: Number(clip.stretchFactor) || 1,
        oppositeFrame: edge === 'left' ? clip.startFrame + clip.duration : clip.startFrame,
        startFrame: clip.startFrame,
        duration: clip.duration,
        stretchFactor: Number(clip.stretchFactor) || 1
      };
      element.setPointerCapture(event.pointerId);
      element.classList.add('audio-stretch-dragging');
      element.addEventListener('pointermove', this.onDrag);
      element.addEventListener('pointerup', this.onDrop);
      element.addEventListener('pointercancel', this.onCancel);
      document.body.classList.add('audio-stretch-drag-active');
      this.showTooltip(event.clientX, event.clientY, this.drag.stretchFactor);
    }

    onDrag = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const frame = this.pointerFrame(event);
      if (drag.edge === 'right') {
        drag.startFrame = drag.originalStart;
        drag.duration = Math.max(MIN_DURATION, frame - drag.originalStart);
      } else {
        drag.startFrame = Math.max(0, Math.min(drag.oppositeFrame - MIN_DURATION, frame));
        drag.duration = drag.oppositeFrame - drag.startFrame;
      }
      drag.stretchFactor = drag.originalStretch * drag.duration / drag.originalDuration;
      drag.element.style.left = `${drag.startFrame * CellW}px`;
      drag.element.style.width = `${drag.duration * CellW}px`;
      const waveform = drag.element.querySelector('.audio-clip-waveform');
      if (waveform) waveform.style.width = `${drag.duration * CellW}px`;
      this.showTooltip(event.clientX, event.clientY, drag.stretchFactor);
      event.preventDefault();
    };

    onDrop = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      this.finishPointer(event.pointerId);
      window.AudioClipUI?.stretchClip(drag.id, {
        startFrame: drag.startFrame,
        duration: drag.duration,
        stretchFactor: drag.stretchFactor
      });
    };

    onCancel = event => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      const element = this.drag.element;
      const originalStart = this.drag.originalStart;
      const originalDuration = this.drag.originalDuration;
      this.finishPointer(event.pointerId);
      element.style.left = `${originalStart * CellW}px`;
      element.style.width = `${originalDuration * CellW}px`;
      const waveform = element.querySelector('.audio-clip-waveform');
      if (waveform) waveform.style.width = `${originalDuration * CellW}px`;
    };

    finishPointer(pointerId) {
      const drag = this.drag;
      this.drag = null;
      if (drag.element.hasPointerCapture(pointerId)) drag.element.releasePointerCapture(pointerId);
      drag.element.removeEventListener('pointermove', this.onDrag);
      drag.element.removeEventListener('pointerup', this.onDrop);
      drag.element.removeEventListener('pointercancel', this.onCancel);
      drag.element.classList.remove('audio-stretch-dragging');
      document.body.classList.remove('audio-stretch-drag-active');
      this.tooltip.classList.remove('visible');
    }

    showTooltip(x, y, factor) {
      this.tooltip.textContent = `${Math.round(factor * 100)}%`;
      this.tooltip.style.left = `${x + 12}px`;
      this.tooltip.style.top = `${y - 26}px`;
      this.tooltip.classList.add('visible');
    }
  }

  window.AudioStretchTool = new AudioStretchTool();
})();
