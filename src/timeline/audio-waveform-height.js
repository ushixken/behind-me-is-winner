(() => {
  'use strict';

  const STORAGE_KEY = 'behindMe.audioTimeline.waveformHeight';
  const MIN_HEIGHT = 24;
  const DEFAULT_HEIGHT = 48;
  const MAX_HEIGHT = 220;

  class AudioWaveformHeightController {
    constructor() {
      this.root = document.getElementById('audio-timeline');
      this.control = document.createElement('button');
      this.control.type = 'button';
      this.control.id = 'audio-waveform-height-control';
      this.control.title = 'Drag vertically to change waveform height';
      this.control.setAttribute('aria-label', 'Waveform Height');
      this.control.innerHTML = '<span class="audio-height-groove"><span class="audio-height-thumb"></span></span>';
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'audio-height-tooltip';
      document.body.appendChild(this.tooltip);
      document.querySelector('.audio-header-actions').prepend(this.control);
      this.value = this.read();
      this.drag = null;
      this.apply(this.value, false);
      this.control.addEventListener('pointerdown', event => this.begin(event));
      this.control.addEventListener('lostpointercapture', event => this.finish(event));
    }

    read() {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(stored)
        ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, stored))
        : DEFAULT_HEIGHT;
    }

    apply(value, persist = true) {
      this.value = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value)));
      this.root.style.setProperty('--audio-waveform-height', `${this.value}px`);
      const progress = (this.value - MIN_HEIGHT) / (MAX_HEIGHT - MIN_HEIGHT);
      this.control.style.setProperty('--audio-height-progress', `${progress * 100}%`);
      this.control.setAttribute('aria-valuenow', String(this.value));
      this.control.setAttribute('aria-valuemin', String(MIN_HEIGHT));
      this.control.setAttribute('aria-valuemax', String(MAX_HEIGHT));
      if (persist) localStorage.setItem(STORAGE_KEY, String(this.value));
      window.dispatchEvent(new CustomEvent('audio-waveform-height-change', {
        detail: { height: this.value }
      }));
    }

    begin(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: this.value
      };
      this.control.setPointerCapture(event.pointerId);
      this.control.classList.add('dragging');
      document.body.classList.add('audio-height-dragging');
      this.control.addEventListener('pointermove', this.move);
      this.control.addEventListener('pointerup', this.finish);
      this.control.addEventListener('pointercancel', this.finish);
      this.showTooltip(event.clientX, event.clientY);
    }

    move = event => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.apply(this.drag.startHeight - (event.clientY - this.drag.startY));
      this.showTooltip(event.clientX, event.clientY);
      event.preventDefault();
    };

    finish = event => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      const pointerId = this.drag.pointerId;
      this.drag = null;
      if (this.control.hasPointerCapture(pointerId)) this.control.releasePointerCapture(pointerId);
      this.control.removeEventListener('pointermove', this.move);
      this.control.removeEventListener('pointerup', this.finish);
      this.control.removeEventListener('pointercancel', this.finish);
      this.control.classList.remove('dragging');
      document.body.classList.remove('audio-height-dragging');
      this.tooltip.classList.remove('visible');
    };

    showTooltip(x, y) {
      this.tooltip.textContent = `Height: ${this.value} px`;
      this.tooltip.style.left = `${x + 12}px`;
      this.tooltip.style.top = `${y - 24}px`;
      this.tooltip.classList.add('visible');
    }
  }

  const controller = new AudioWaveformHeightController();
  window.AudioWaveformHeight = {
    get value() { return controller.value; },
    set value(height) { controller.apply(height); },
    snapshot: () => ({ audioWaveformHeight: controller.value }),
    restore: state => controller.apply(state?.audioWaveformHeight ?? DEFAULT_HEIGHT)
  };
})();
