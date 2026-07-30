(() => {
  'use strict';
  const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function playbackRate(clip) {
    return 1 / Math.max(0.01, numberOr(clip?.stretchFactor, 1));
  }

  function sourceBounds(clip) {
    const sourceStart = numberOr(clip?.sourceStart);
    const sourceOffset = numberOr(clip?.sourceOffset);
    const sourceEnd = Number.isFinite(Number(clip?.sourceEnd))
      ? Number(clip.sourceEnd)
      : sourceStart + Math.max(1, numberOr(clip?.duration, 1)) * playbackRate(clip);
    return { start: sourceStart + sourceOffset, end: Math.max(sourceStart, sourceEnd) + sourceOffset };
  }

  function timelineFrameToSourceFrame(clip, timelineFrame, clampToTrim = false) {
    const localFrame = numberOr(timelineFrame) - numberOr(clip?.startFrame);
    const bounds = sourceBounds(clip);
    const sourceFrame = bounds.start + localFrame * playbackRate(clip);
    return clampToTrim ? Math.max(bounds.start, Math.min(bounds.end, sourceFrame)) : sourceFrame;
  }

  function timelineFrameToSourceTime(clip, timelineFrame, frameRate, clampToTrim = false) {
    return timelineFrameToSourceFrame(clip, timelineFrame, clampToTrim) /
      Math.max(1, numberOr(frameRate, 24));
  }

  function waveformPixelToTimelineFrame(clip, pixelX, cellWidth) {
    return numberOr(clip?.startFrame) + numberOr(pixelX) / Math.max(1, numberOr(cellWidth, 1)) - 0.5;
  }

  function waveformPixelToSourceFrame(clip, pixelX, cellWidth) {
    return timelineFrameToSourceFrame(clip, waveformPixelToTimelineFrame(clip, pixelX, cellWidth), true);
  }

  function waveformBucketForSourceFrame(clip, sourceFrame, bucketCount) {
    const count = Math.max(1, Math.floor(numberOr(bucketCount, 1)));
    const sourceTotal = Math.max(1, numberOr(clip?.sourceDuration),
      numberOr(clip?.sourceEnd) - numberOr(clip?.sourceStart));
    return Math.min(count - 1, Math.max(0, Math.floor(sourceFrame / sourceTotal * count)));
  }

  function diagnoseAlignment(clip, timelineFrame, cellWidth, frameRate, sampleRate) {
    const width = Math.max(1, numberOr(cellWidth, 1));
    const pixelX = (numberOr(timelineFrame) - numberOr(clip?.startFrame)) * width + width / 2;
    const scrubSourceFrame = timelineFrameToSourceFrame(clip, timelineFrame, true);
    const waveformSourceFrame = waveformPixelToSourceFrame(clip, pixelX, cellWidth);
    const frameDelta = waveformSourceFrame - scrubSourceFrame;
    return {
      timelineFrame, pixelX, scrubSourceFrame, waveformSourceFrame, frameDelta,
      secondsDelta: frameDelta / Math.max(1, numberOr(frameRate, 24)),
      sampleDelta: frameDelta / Math.max(1, numberOr(frameRate, 24)) *
        Math.max(1, numberOr(sampleRate, 48000))
    };
  }

  window.AudioClipTimeMapping = Object.freeze({
    playbackRate, sourceBounds, timelineFrameToSourceFrame, timelineFrameToSourceTime,
    waveformPixelToTimelineFrame, waveformPixelToSourceFrame,
    waveformBucketForSourceFrame, diagnoseAlignment
  });
})();
