(() => {
  'use strict';

  class AudioSlipTool {
    constructor() {
      this.active = false;
      this.drag = null;
      this.hoverClip = null;
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.id = 'audio-slip-tool';
      this.button.className = 'audio-toolbar-tool';
      this.button.title = 'Slip Tool';
      this.button.setAttribute('aria-label', 'Slip Tool');
      this.button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10M13 3v10M1.5 8h13M1.5 8l2.5-2.5M1.5 8 4 10.5M14.5 8 12 5.5M14.5 8 12 10.5"/></svg>';
      document.querySelector('.audio-toolbar-tools').appendChild(this.button);
      this.grid = document.getElementById('audio-timeline-grid');
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'audio-slip-tooltip';
      document.body.appendChild(this.tooltip);
      this.button.addEventListener('click', () => this.setActive(!this.active));
      this.grid.addEventListener('pointermove', event => this.onHover(event), true);
      this.grid.addEventListener('pointerleave', () => {
        if (!this.drag) this.clearHover();
      }, true);
      this.grid.addEventListener('pointerdown', event => this.onPointerDown(event), true);
      window.addEventListener('audio-timeline-tool-change', event => {
        if (event.detail?.tool !== 'slip') this.setActive(false, false);
      });
    }

    setActive(active, announce = true) {
      this.active = !!active;
      this.button.classList.toggle('active', this.active);
      this.button.setAttribute('aria-pressed', String(this.active));
      this.grid.classList.toggle('audio-slip-active', this.active);
      if (!this.active) this.clearHover();
      window.AudioTimelineTool = this.active ? 'slip' : null;
      if (announce) {
        window.dispatchEvent(new CustomEvent('audio-timeline-tool-change', {
          detail: { tool: this.active ? 'slip' : 'selection' }
        }));
      }
    }

    modelFor(element) {
      return window.AudioClipUI?.clips.find(clip => clip.id === element?.dataset.audioClipId);
    }

    onHover(event) {
      if (!this.active || this.drag) return;
      const clip = event.target.closest('.audio-clip');
      this.clearHover();
      if (!clip?.classList.contains('selected')) return;
      this.hoverClip = clip;
      clip.classList.add('audio-slip-hover');
    }

    clearHover() {
      this.hoverClip?.classList.remove('audio-slip-hover');
      this.hoverClip = null;
    }

    onPointerDown(event) {
      if (!this.active || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const element = event.target.closest('.audio-clip');
      if (!element?.classList.contains('selected')) return;
      const clip = this.modelFor(element);
      if (!clip) return;
      this.clearHover();
      const initialOffset = Number(clip.sourceOffset) || 0;
      this.drag = {
        pointerId: event.pointerId,
        element,
        id: clip.id,
        startX: event.clientX,
        initialOffset,
        offset: initialOffset,
        minOffset: -clip.sourceStart,
        maxOffset: Math.max(-clip.sourceStart, clip.sourceDuration - clip.sourceEnd)
      };
      element.setPointerCapture(event.pointerId);
      element.classList.add('audio-slip-dragging');
      element.addEventListener('pointermove', this.onDrag);
      element.addEventListener('pointerup', this.onDrop);
      element.addEventListener('pointercancel', this.onCancel);
      document.body.classList.add('audio-slip-drag-active');
      this.showTooltip(event.clientX, event.clientY, initialOffset);
    }

    onDrag = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const frameDelta = Math.round((event.clientX - drag.startX) / CellW);
      drag.offset = Math.max(drag.minOffset, Math.min(drag.maxOffset, drag.initialOffset - frameDelta));
      window.AudioClipUI?.previewSlip(drag.id, drag.offset);
      this.showTooltip(event.clientX, event.clientY, drag.offset);
      event.preventDefault();
    };

    onDrop = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      this.finish(event.pointerId);
      window.AudioClipUI?.slipClip(drag.id, drag.offset);
    };

    onCancel = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      window.AudioClipUI?.previewSlip(drag.id, drag.initialOffset);
      this.finish(event.pointerId);
    };

    finish(pointerId) {
      const drag = this.drag;
      this.drag = null;
      if (drag.element.hasPointerCapture(pointerId)) drag.element.releasePointerCapture(pointerId);
      drag.element.removeEventListener('pointermove', this.onDrag);
      drag.element.removeEventListener('pointerup', this.onDrop);
      drag.element.removeEventListener('pointercancel', this.onCancel);
      drag.element.classList.remove('audio-slip-dragging');
      document.body.classList.remove('audio-slip-drag-active');
      this.tooltip.classList.remove('visible');
    }

    showTooltip(x, y, offset) {
      const prefix = offset > 0 ? '+' : '';
      this.tooltip.textContent = `Offset ${prefix}${offset} Frames`;
      this.tooltip.style.left = `${x + 12}px`;
      this.tooltip.style.top = `${y - 26}px`;
      this.tooltip.classList.add('visible');
    }
  }

  window.AudioSlipTool = new AudioSlipTool();
})();
