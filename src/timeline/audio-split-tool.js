(() => {
  'use strict';

  class AudioSplitTool {
    constructor() {
      this.active = false;
      this.hoverClip = null;
      this.button = document.createElement('button');
      this.button.type = 'button';
      this.button.id = 'audio-split-tool';
      this.button.className = 'audio-toolbar-tool';
      this.button.title = 'Split Tool';
      this.button.setAttribute('aria-label', 'Split Tool');
      this.button.textContent = '✂';
      document.querySelector('.audio-toolbar-tools').appendChild(this.button);
      this.grid = document.getElementById('audio-timeline-grid');
      this.viewport = document.getElementById('audio-timeline-grid-viewport');
      this.button.addEventListener('click', () => this.setActive(!this.active));
      this.grid.addEventListener('pointermove', event => this.onPointerMove(event), true);
      this.grid.addEventListener('pointerleave', () => this.clearGuide(), true);
      this.grid.addEventListener('pointerdown', event => this.onPointerDown(event), true);
      window.addEventListener('audio-timeline-tool-change', event => {
        if (event.detail?.tool !== 'split') this.setActive(false, false);
      });
    }

    setActive(active, announce = true) {
      this.active = !!active;
      this.button.classList.toggle('active', this.active);
      this.button.setAttribute('aria-pressed', String(this.active));
      this.grid.classList.toggle('audio-split-active', this.active);
      if (!this.active) this.clearGuide();
      window.AudioTimelineTool = this.active ? 'split' : null;
      if (announce) {
        window.dispatchEvent(new CustomEvent('audio-timeline-tool-change', {
          detail: { tool: this.active ? 'split' : 'selection' }
        }));
      }
    }

    frameAtPointer(event) {
      const bounds = this.viewport.getBoundingClientRect();
      return Math.max(0, Math.round(
        (event.clientX - bounds.left + this.viewport.scrollLeft) / CellW
      ));
    }

    onPointerMove(event) {
      if (!this.active) return;
      const clip = event.target.closest('.audio-clip');
      if (!clip) {
        this.clearGuide();
        return;
      }
      const model = window.AudioClipUI?.clips.find(item => item.id === clip.dataset.audioClipId);
      if (!model) return;
      const frame = this.frameAtPointer(event);
      const localFrame = frame - model.startFrame;
      if (localFrame <= 0 || localFrame >= model.duration) {
        this.clearGuide();
        return;
      }
      if (this.hoverClip !== clip) this.clearGuide();
      this.hoverClip = clip;
      clip.classList.add('audio-split-hover');
      let guide = clip.querySelector('.audio-split-guide');
      if (!guide) {
        guide = document.createElement('span');
        guide.className = 'audio-split-guide';
        clip.appendChild(guide);
      }
      guide.style.left = `${localFrame * CellW}px`;
    }

    onPointerDown(event) {
      if (!this.active || event.button !== 0) return;
      const clip = event.target.closest('.audio-clip');
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!clip) return;
      window.AudioClipUI?.splitAt(clip.dataset.audioClipId, this.frameAtPointer(event));
      this.clearGuide();
    }

    clearGuide() {
      if (this.hoverClip) {
        this.hoverClip.classList.remove('audio-split-hover');
        this.hoverClip.querySelector('.audio-split-guide')?.remove();
      }
      this.hoverClip = null;
    }
  }

  window.AudioSplitTool = new AudioSplitTool();
})();
