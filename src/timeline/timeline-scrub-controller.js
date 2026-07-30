(() => {
  'use strict';

  const SharedPlayhead = window.SharedPlayhead || {
    position: 0,
    animationPosition: 0,
    scrubMode: null
  };
  window.SharedPlayhead = SharedPlayhead;

  function configuredStep() {
    const external = window.ScrubStepController;
    if (external && typeof external.getStep === 'function') {
      const value = Number(external.getStep());
      if (value > 0) return value;
    }
    const input = document.getElementById('scrub-step');
    const raw = String(input?.value || '').trim().toLowerCase();
    const named = {
      none: 1,
      '1/6': 1 / 6,
      '1/4': 1 / 4,
      '1/3': 1 / 3,
      '1/2': 1 / 2
    };
    if (named[raw]) return named[raw];
    const numeric = Number(raw);
    return numeric > 0 ? numeric : 1;
  }

  function placePlayheads(position) {
    const cellWidth = typeof CellW === 'number' ? CellW : 28;
    const left = position * cellWidth + cellWidth / 2 - 1;
    const animation = document.getElementById('playhead');
    const audio = document.querySelector('.audio-timeline-playhead');
    if (animation) animation.style.left = `${left}px`;
    if (audio) audio.style.left = `${left}px`;
  }

  class AnimationScrubEvaluator {
    constructor() { this.lastFrame = null; }
    reset() { this.lastFrame = null; }
    evaluate(continuousPosition, callback) {
      const step = configuredStep();
      const stepped = Math.round(continuousPosition / step) * step;
      const frame = Math.max(0, Math.min(
        typeof TOTAL === 'number' ? TOTAL - 1 : 0,
        Math.floor(stepped + 1e-7)
      ));
      SharedPlayhead.animationPosition = stepped;
      if (frame === this.lastFrame) return frame;
      this.lastFrame = frame;
      callback(frame);
      return frame;
    }
  }

  class TimelineScrubController {
    constructor() {
      this.mode = null;
      this.pointerId = null;
      this.animation = new AnimationScrubEvaluator();
    }
    begin(mode, pointerId, position) {
      if (this.mode) return false;
      this.mode = mode;
      this.pointerId = pointerId;
      this.animation.reset();
      SharedPlayhead.scrubMode = mode;
      this.updatePosition(position);
      return true;
    }
    updatePosition(position) {
      const maximum = Math.max(0, (typeof TOTAL === 'number' ? TOTAL : 1) - 1);
      SharedPlayhead.position = Math.max(0, Math.min(maximum, Number(position) || 0));
      placePlayheads(SharedPlayhead.position);
      return SharedPlayhead.position;
    }
    updateAudio(position, evaluateAnimation) {
      if (this.mode !== 'audio') return null;
      const continuous = this.updatePosition(position);
      this.animation.evaluate(continuous, evaluateAnimation);
      placePlayheads(continuous);
      return continuous;
    }
    end(pointerId) {
      if (!this.mode || (pointerId != null && this.pointerId !== pointerId)) return false;
      this.mode = null;
      this.pointerId = null;
      SharedPlayhead.scrubMode = null;
      this.animation.reset();
      placePlayheads(SharedPlayhead.position);
      return true;
    }
    reset(frame) {
      if (this.mode === 'audio') return;
      SharedPlayhead.position = Number(frame) || 0;
      SharedPlayhead.animationPosition = SharedPlayhead.position;
    }
  }

  window.TimelineScrubController = new TimelineScrubController();
})();
