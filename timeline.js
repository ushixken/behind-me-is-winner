// ════════════════════════════════════════════════════════════════
// PLAYBACK
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// FRAME LABELING
// Internally, frames are always stored at non-negative indices (0..TOTAL-1).
// frameLabelOffset lets the *displayed* frame number go negative without
// touching that storage: label(f) = f - frameLabelOffset + 1. It starts at
// 0 (so index 0 displays as "1", same as before) and is bumped whenever
// _insertFramesAtStart() inserts blank frames at the front, so whatever was
// frame 1 stays labeled "1" and the newly inserted space in front of it
// counts down through 0, -1, -2, … — matching how other animation software
// numbers frames dragged before the start, instead of relabeling everything
// with large positive numbers.
let frameLabelOffset=0;
function frameLabel(f){return f-frameLabelOffset+1;}

function clampRange(){rangeStart=Math.max(0,Math.min(rangeStart,TOTAL-1));rangeEnd=Math.max(rangeStart,Math.min(rangeEnd,TOTAL-1));}
function getFPS(){return Math.min(+fpsTl.value,MAX_FPS);}

function toggleLoop(){
  loopRange=!loopRange;const btn=document.getElementById('btn-loop');
  if(loopRange){btn.classList.add('loop-on');btn.textContent='⟳ Loop ON';}
  else{btn.classList.remove('loop-on');btn.textContent='↺ Loop';}
}
document.getElementById('btn-loop').onclick=toggleLoop;

function togglePlay(){
  playing=!playing;const btn=document.getElementById('btn-play');
  if(playing){
    btn.textContent='⏸ Pause';btn.classList.add('playing');
    // If at or past the out-point (and not looping), restart from in-point
    if(curFrame<rangeStart||curFrame>=rangeEnd) goToFrame(rangeStart);
    const fps=getFPS();
    playTimer=setInterval(()=>{
      let next=curFrame+1;
      if(next>rangeEnd){
        if(loopRange){next=rangeStart;}
        else{clearInterval(playTimer);playing=false;btn.textContent='▶ Play';btn.classList.remove('playing');loadFrame(curLayer,curFrame);renderTimeline();return;}
      }
      curFrame=next;drawBg();
      for(let i=0;i<layers.length;i++){
        if(!layers[i].visible)continue;
        if(!_layerGroupChainVisible(layers[i]))continue;
        const k=getHeldKey(i,curFrame);
        if(k){const a=(layers[i].opacity??1)*_layerGroupChainOpacity(layers[i]);compCtx.globalAlpha=a;compCtx.drawImage(k,0,0);}
      }
      compCtx.globalAlpha=1;ctx.clearRect(0,0,CW,CH);
      displayCtx.clearRect(0,0,CW,CH);
      displayCtx.filter = _displayBlurPx>0.05 ? `blur(${_displayBlurPx}px)` : 'none';
      displayCtx.drawImage(compC,0,0);
      displayCtx.filter='none';
      updatePlayhead();
      document.getElementById('frame-info').textContent=frameLabel(curFrame)+' / '+frameLabel(TOTAL-1);
      renderRulerHighlight();
    },1000/fps);
  } else {
    btn.textContent='▶ Play';btn.classList.remove('playing');clearInterval(playTimer);loadFrame(curLayer,curFrame);renderTimeline();
  }
}
document.getElementById('btn-play').onclick=togglePlay;

// Tab key = Play / Pause (like TVPaint / Clip Studio)
document.addEventListener('keydown',e=>{
  if(e.code==='Tab'&&e.target.tagName!=='INPUT'&&e.target.tagName!=='TEXTAREA'){
    e.preventDefault();
    togglePlay();
  }
});
document.getElementById('btn-prev').onclick=()=>goToFrame(0);
document.getElementById('btn-last').onclick=()=>goToFrame(TOTAL-1);
document.getElementById('btn-stepb').onclick=()=>{
  if(typeof kfswNavigate==='function') kfswNavigate(-1);
  else if(curFrame<=rangeStart) goToFrame(rangeEnd);
  else goToFrame(curFrame-1);
};
document.getElementById('btn-stepf').onclick=()=>{
  if(typeof kfswNavigate==='function') kfswNavigate(+1);
  else if(curFrame>=rangeEnd) goToFrame(rangeStart);
  else goToFrame(curFrame+1);
};
fpsTl.oninput=e=>{const v=Math.min(+e.target.value,MAX_FPS);fpsTl.value=v;fpsVal.textContent=v;updateFpsSliderColor();if(playing){clearInterval(playTimer);playing=false;togglePlay();}};

// Update slider color: red if below MAX_FPS
function updateFpsSliderColor(){
  const v=+fpsTl.value;
  fpsTl.classList.toggle('below-max', v<MAX_FPS);
}


document.getElementById('btn-new-key').onclick=()=>{createBlankKey();loadFrame(curLayer,curFrame);};
function deleteKeyframe(){
  delete layers[curLayer].frames[curFrame];
  if(typeof deleteStyleFrame==='function') deleteStyleFrame(curLayer,curFrame);
  ctx.clearRect(0,0,CW,CH);const h=getHeldKey(curLayer,curFrame);if(h)ctx.drawImage(h,0,0);
  saveActiveToKey();
  // After deleting, trim any leading blank frames that are no longer needed
  // (e.g. the deleted keyframe was the only thing in the negative zone).
  // This also snaps the playhead and scroll back to frame 1 if the offset resets.
  if(frameLabelOffset>0){
    _trimLeadingBlanks();
    // If we trimmed everything and playhead is now before visible frame 1,
    // jump it to frame 0 (label 1) and scroll there.
    if(frameLabelOffset===0&&curFrame<0){curFrame=0;}
    curFrame=Math.max(0,Math.min(TOTAL-1,curFrame));
  }
  loadFrame(curLayer,curFrame);renderTimeline();
}
document.getElementById('btn-del-key').onclick=deleteKeyframe;

fpsVal.addEventListener('click',()=>{
  document.getElementById('fps-direct-input').value=getFPS();
  document.getElementById('fps-max-label').textContent=MAX_FPS;
  document.getElementById('fps-direct-input').max=MAX_FPS;
  document.getElementById('modal-fps').classList.add('visible');
});
document.getElementById('modal-fps-cancel').onclick=()=>document.getElementById('modal-fps').classList.remove('visible');
document.getElementById('modal-fps-ok').onclick=()=>{
  let v=Math.max(1,Math.min(parseInt(document.getElementById('fps-direct-input').value)||12,MAX_FPS));
  fpsTl.value=v;fpsVal.textContent=v;document.getElementById('modal-fps').classList.remove('visible');
  if(playing){clearInterval(playTimer);playing=false;togglePlay();}
};
document.getElementById('modal-fps').addEventListener('click',e=>{if(e.target===document.getElementById('modal-fps'))document.getElementById('modal-fps').classList.remove('visible');});

// ════════════════════════════════════════════════════════════════
// TIMELINE SYNC
// ════════════════════════════════════════════════════════════════
tlScroll.addEventListener('scroll',()=>{document.getElementById('tl-labels-rows').style.marginTop=(-tlScroll.scrollTop)+'px';},{passive:true});

function frameFromX(clientX){
  const r=tlScroll.getBoundingClientRect();
  return Math.max(0,Math.min(TOTAL-1,Math.floor((clientX-r.left+tlScroll.scrollLeft)/CellW)));
}
// Same as frameFromX but NOT clamped to [0,TOTAL-1] — used while dragging a
// keyframe so we can tell the drag actually wants to go negative (past frame 1)
// instead of just reporting frame 0 for anything past the left edge.
function rawFrameFromX(clientX){
  const r=tlScroll.getBoundingClientRect();
  return Math.floor((clientX-r.left+tlScroll.scrollLeft)/CellW);
}

// Inserts `amount` blank frames at the very start of the timeline, shifting
// every layer's existing keyframes (and TOTAL/range/playhead) to the right
// by that amount. This is what lets you keep dragging a keyframe backward
// past frame 1 — instead of the drag hitting a wall at 0, the timeline
// grows to make room, same as most animation software does.
function _insertFramesAtStart(amount){
  if(amount<=0) return;
  layers.forEach(l=>{
    const entries=Object.keys(l.frames).map(Number).sort((a,b)=>b-a); // highest first, avoid clobbering
    const shifted={};
    entries.forEach(f=>{shifted[f+amount]=l.frames[f];});
    l.frames=shifted;
    // Shift frameMeta in tandem so marks track their drawings
    if(l.frameMeta&&Object.keys(l.frameMeta).length){
      const shiftedMeta={};
      Object.keys(l.frameMeta).forEach(f=>{shiftedMeta[+f+amount]=l.frameMeta[f];});
      l.frameMeta=shiftedMeta;
    }
    if(l.indexFrames&&Object.keys(l.indexFrames).length){
      const shiftedIndexFrames={};
      Object.keys(l.indexFrames).forEach(f=>{shiftedIndexFrames[+f+amount]=l.indexFrames[f];});
      l.indexFrames=shiftedIndexFrames;
    }
    if(l.indexMeta&&Object.keys(l.indexMeta).length){
      const shiftedIndexMeta={};
      Object.keys(l.indexMeta).forEach(f=>{shiftedIndexMeta[+f+amount]=l.indexMeta[f];});
      l.indexMeta=shiftedIndexMeta;
    }
    if(l.smartStyleFrames&&Object.keys(l.smartStyleFrames).length){
      const shiftedSmart={};
      Object.keys(l.smartStyleFrames).forEach(f=>{shiftedSmart[+f+amount]=l.smartStyleFrames[f];});
      l.smartStyleFrames=shiftedSmart;
    }
  });
  TOTAL+=amount;
  rangeStart+=amount;rangeEnd+=amount;
  curFrame+=amount;
  frameLabelOffset+=amount;
}

// ════════════════════════════════════════════════════════════════
// TIMELINE SCRUB & RANGE DRAG
// ════════════════════════════════════════════════════════════════
let scrubbing=false,draggingStart=false,draggingEnd=false;

rulerEl.addEventListener('pointerdown',e=>{
  if(e.button!==0) return;
  const r=tlScroll.getBoundingClientRect();
  const x=e.clientX-r.left+tlScroll.scrollLeft;
  if(Math.abs(x-(rangeStart*CellW+CellW/2))<10){draggingStart=true;return;}
  if(Math.abs(x-(rangeEnd*CellW+CellW/2))<10){draggingEnd=true;return;}
  scrubbing=true;const f=frameFromX(e.clientX);goToFrame(f,false,false);
});
rulerEl.addEventListener('contextmenu',e=>{
  e.preventDefault();e.stopPropagation();
  hideAllMenus();
  rulerCtxFrame=frameFromX(e.clientX);
  const m=document.getElementById('ruler-ctx-menu');
  m.style.left=Math.min(e.clientX,window.innerWidth-190)+'px';m.style.top=Math.min(e.clientY,window.innerHeight-100)+'px';
  m.classList.add('visible');
});
document.addEventListener('pointermove',e=>{
  if(scrubbing){const f=frameFromX(e.clientX);goToFrame(f,false,false);}
  if(draggingStart){rangeStart=Math.min(frameFromX(e.clientX),rangeEnd);clampRange();renderTimeline();updateStatus();}
  if(draggingEnd){rangeEnd=Math.max(frameFromX(e.clientX),rangeStart);clampRange();renderTimeline();updateStatus();}
});
document.addEventListener('pointerup',()=>{
  scrubbing=false;draggingStart=false;draggingEnd=false;
  if(tlSelDrag){tlSelDrag=null;updateStatus();}
});

// ════════════════════════════════════════════════════════════════
// RULER CONTEXT MENU
// ════════════════════════════════════════════════════════════════
document.getElementById('ruler-ctx-in').onclick=()=>{rangeStart=Math.min(rulerCtxFrame,rangeEnd);clampRange();renderTimeline();updateStatus();document.getElementById('ruler-ctx-menu').classList.remove('visible');};
document.getElementById('ruler-ctx-out').onclick=()=>{rangeEnd=Math.max(rulerCtxFrame,rangeStart);clampRange();renderTimeline();updateStatus();document.getElementById('ruler-ctx-menu').classList.remove('visible');};
document.getElementById('ruler-ctx-reset').onclick=()=>{rangeStart=0;rangeEnd=TOTAL-1;clampRange();renderTimeline();updateStatus();document.getElementById('ruler-ctx-menu').classList.remove('visible');};

// ════════════════════════════════════════════════════════════════
// KEYFRAME DRAG
// ════════════════════════════════════════════════════════════════
let dragKF=null;
let kfSelectionAnchor=null;
let selectedRowLayers=new Set([curLayer]); // which layer indices should show the "selected" cell background band

// Returns the actual layer indices (not display-order indices) spanning between
// anchorLayerIndex and targetLayerIndex in the timeline's current display order.
function _rowSpanLayers(anchorLayerIndex,targetLayerIndex){
  const layerOrder=timelineLayerIndices();
  const a=layerOrder.indexOf(anchorLayerIndex),t=layerOrder.indexOf(targetLayerIndex);
  if(a<0||t<0)return[targetLayerIndex];
  const lo=Math.min(a,t),hi=Math.max(a,t);
  return layerOrder.slice(lo,hi+1);
}

function clearKeyframeSelection(){
  if(!selectedKFs.size&&!kfSelectionAnchor)return;
  selectedKFs.clear();
  kfSelectionAnchor=null;
  selectedRowLayers.clear();
  document.querySelectorAll('.kf-block.selected').forEach(block=>block.classList.remove('selected'));
}

document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('.kf-block'))clearKeyframeSelection();
});

function selectKeyframeRange(anchor,target){
  const layerOrder=timelineLayerIndices();
  const anchorRow=layerOrder.indexOf(anchor.layerIndex);
  const targetRow=layerOrder.indexOf(target.layerIndex);
  if(anchorRow<0||targetRow<0)return;
  const firstRow=Math.min(anchorRow,targetRow),lastRow=Math.max(anchorRow,targetRow);
  const firstFrame=Math.min(anchor.frameIndex,target.frameIndex),lastFrame=Math.max(anchor.frameIndex,target.frameIndex);
  selectedKFs.clear();
  layerOrder.slice(firstRow,lastRow+1).forEach(layerIndex=>{
    Object.keys(layers[layerIndex].frames).map(Number)
      .filter(frameIndex=>frameIndex>=firstFrame&&frameIndex<=lastFrame)
      .forEach(frameIndex=>selectedKFs.add(`${layerIndex}:${frameIndex}`));
  });
}
function _snapshotFrameMaps(layerIndices){
  const snapshot={};
  layerIndices.forEach(layerIndex=>{
    const l=layers[layerIndex];
    // Deep-clone every Smart Raster index canvas so the snapshot is a fully
    // independent copy. Object.assign() alone would only shallow-copy the
    // canvas references — the live canvases would mutate in place, making
    // the snapshot useless for undo. cloneStyleCanvas() uses putImageData
    // (pixel-level copy, no colour-space transform) which is the same safe
    // clone that SmartRasterLayer uses internally.
    const indexFramesSnap={};
    Object.keys(l.indexFrames||{}).forEach(fi=>{
      const src=l.indexFrames[fi];
      indexFramesSnap[fi]=src?cloneStyleCanvas(src):null;
    });
    snapshot[layerIndex]={
      frames: Object.assign({},l.frames),
      frameMeta: _deepCopyFrameMeta(l.frameMeta),
      // New field names (post-migration). Old styleFrames/styleFrameMeta are
      // no longer written by smart-raster-layer.js; snapshot only the live fields.
      indexFrames: indexFramesSnap,
      indexMeta: _deepCopyStyleFrameMeta(l.indexMeta),
      smartStyleFrames: _deepCopySmartStyleFrames(l.smartStyleFrames)
    };
  });
  return snapshot;
}
function _restoreFrameMaps(snapshot){
  Object.keys(snapshot).forEach(layerIndex=>{
    const l=layers[+layerIndex];
    const s=snapshot[layerIndex];
    l.frames=Object.assign({},s.frames);
    l.frameMeta=_deepCopyFrameMeta(s.frameMeta);
    // Restore Smart Raster data under the new field names.
    // Clone again on restore so the same snapshot entry can be
    // applied for both undo and redo without cross-contamination.
    const indexFramesRestore={};
    Object.keys(s.indexFrames||{}).forEach(fi=>{
      const src=s.indexFrames[fi];
      indexFramesRestore[fi]=src?cloneStyleCanvas(src):null;
    });
    l.indexFrames=indexFramesRestore;
    l.indexMeta=_deepCopyStyleFrameMeta(s.indexMeta);
    l.smartStyleFrames=_deepCopySmartStyleFrames(s.smartStyleFrames);
  });
}
// Shallow-copy the per-frame meta objects so snapshot entries are independent
function _deepCopyFrameMeta(meta){
  if(!meta) return {};
  const out={};
  Object.keys(meta).forEach(f=>{out[f]=Object.assign({},meta[f]);});
  return out;
}
function _deepCopyStyleFrameMeta(meta){
  if(!meta) return {};
  const out={};
  Object.keys(meta).forEach(f=>{out[f]=cloneStyleMeta(meta[f]);});
  return out;
}
function _deepCopySmartStyleFrames(frames){
  if(!frames) return {};
  const out={};
  Object.keys(frames).forEach(f=>{
    const frame=frames[f];
    out[f]={width:frame.width,height:frame.height,styleIds:frame.styleIds.slice(),meta:SmartRasterLayer.cloneMeta(frame.meta)};
  });
  return out;
}
function startKFDrag(li,fi,e){
  e.preventDefault();e.stopPropagation();
  const draggedKey=`${li}:${fi}`;
  const keys=selectedKFs.has(draggedKey)?Array.from(selectedKFs):[draggedKey];
  const items=keys.map(key=>{
    const [layerIndex,frameIndex]=key.split(':').map(Number);
    const l=layers[layerIndex];
    return {
      layerIndex,frameIndex,
      data:l&&l.frames[frameIndex],
      meta:(l&&l.frameMeta&&l.frameMeta[frameIndex])?Object.assign({},l.frameMeta[frameIndex]):null,
      styleBundle:(typeof getStyleFrameBundle==='function')?getStyleFrameBundle(layerIndex,frameIndex):null
    };
  }).filter(item=>item.data);
  const layerIndices=Array.from(new Set(items.map(item=>item.layerIndex)));
  const selectedOrigins=new Set(items.map(item=>`${item.layerIndex}:${item.frameIndex}`));
  const occupied=new Set();
  layerIndices.forEach(layerIndex=>Object.keys(layers[layerIndex].frames).forEach(frame=>{
    const key=`${layerIndex}:${+frame}`;
    if(!selectedOrigins.has(key)) occupied.add(key);
  }));
  const allLayerIndices=layers.map((_,idx)=>idx);
  // Store dragStartClientX so onKFDragMove computes delta from pointer
  // movement in pixels — not from rawFrameFromX which reads scrollLeft and
  // breaks whenever _insertFramesAtStart widens the timeline mid-drag.
  dragKF={li,originFi:fi,lockedScroll:tlScroll.scrollLeft,items,layerIndices,allLayerIndices,occupied,appliedDelta:0,anyShift:false,before:_snapshotFrameMaps(allLayerIndices)};
  document.addEventListener('pointermove',onKFDragMove);
  document.addEventListener('pointerup',onKFDragUp);
}
function onKFDragMove(e){
  if(!dragKF||!dragKF.items.length) return;

  // Lock scroll for the duration of this drag so rawFrameFromX is stable.
  tlScroll.scrollLeft=dragKF.lockedScroll;

  // Where does the pointer map to on the (locked) timeline?
  const rawTarget=rawFrameFromX(e.clientX);

  // Work out how many frames the dragged item(s) need to move.
  // minimumFrame / maximumFrame are the current internal positions of the
  // dragged items (already shifted by any previous insert/trim this drag).
  const minimumFrame=Math.min(...dragKF.items.map(item=>item.frameIndex));
  const maximumFrame=Math.max(...dragKF.items.map(item=>item.frameIndex));

  // Unclamped delta: how many frames right of their current positions
  // should the items end up?  Negative = dragging left.
  const rawDelta=rawTarget-dragKF.originFi;

  // If dragging left past frame 0, insert exactly enough blank frames at
  // the start to make room — computed once, no recursion.
  const wouldBeMin=minimumFrame+rawDelta;
  if(wouldBeMin<0){
    const overflow=-wouldBeMin; // frames needed before index 0
    _insertFramesAtStart(overflow);
    dragKF.anyShift=true;
    dragKF.originFi+=overflow;
    dragKF.items.forEach(item=>item.frameIndex+=overflow);
    dragKF.occupied=new Set(Array.from(dragKF.occupied,key=>{
      const[li2,fr]=key.split(':').map(Number);
      return`${li2}:${fr+overflow}`;
    }));
    // Canvas grew left by overflow*CellW — shift locked scroll right to
    // keep the same visual anchor, then re-lock immediately.
    dragKF.lockedScroll+=overflow*CellW;
    tlScroll.scrollLeft=dragKF.lockedScroll;
    // minimumFrame and originFi have both shifted by overflow, so
    // rawTarget-dragKF.originFi is now rawDelta-overflow.  Fall through
    // with the updated state; overflow is 0 now so no risk of re-entry.
  }

  // Re-read with updated state (items may have shifted above).
  const minF=Math.min(...dragKF.items.map(item=>item.frameIndex));
  const maxF=Math.max(...dragKF.items.map(item=>item.frameIndex));
  // Clamp: can't push past last frame, can't go before frame 0.
  const delta=Math.max(-minF, Math.min((TOTAL-1)-maxF, rawTarget-dragKF.originFi));

  if(delta===dragKF.appliedDelta) return;
  const destinations=dragKF.items.map(item=>({item,target:item.frameIndex+delta}));
  if(destinations.some(move=>dragKF.occupied.has(`${move.item.layerIndex}:${move.target}`))) return;
  dragKF.items.forEach(item=>{
    const li=item.layerIndex,src=item.frameIndex+dragKF.appliedDelta;
    delete layers[li].frames[src];
    if(layers[li].frameMeta) delete layers[li].frameMeta[src];
    if(typeof deleteStyleFrame==='function') deleteStyleFrame(li,src);
  });
  destinations.forEach(move=>{
    const li=move.item.layerIndex;
    layers[li].frames[move.target]=move.item.data;
    if(!layers[li].frameMeta) layers[li].frameMeta={};
    if(move.item.meta) layers[li].frameMeta[move.target]=Object.assign({},move.item.meta);
    else delete layers[li].frameMeta[move.target];
    if(typeof restoreStyleFrameBundle==='function') restoreStyleFrameBundle(li,move.target,move.item.styleBundle);
  });
  dragKF.appliedDelta=delta;
  selectedKFs.clear();
  destinations.forEach(move=>selectedKFs.add(`${move.item.layerIndex}:${move.target}`));
  if(dragKF.li===curLayer){curFrame=dragKF.originFi+delta;loadFrame(curLayer,curFrame);}
  // Trim any now-empty leading blank frames (user dragged back rightward).
  // Scroll stays locked; trim only adjusts lockedScroll to match canvas shrink.
  if(frameLabelOffset>0) _trimLeadingBlanks();
  renderTimeline();
}
// After a drag that prepended blank frames (anyShift=true), check whether
// all keyframes have ended up at or after frameLabelOffset (label ≥ 1).
// If so, trim the unused leading blank frames so the timeline doesn't grow
// indefinitely and doesn't show a negative-number zone when nothing lives
// there. This is the "snap back" behaviour described in the bug report:
// dragging to -4 temporarily expands the timeline, but if the user then
// drags back to frame 1+, the negative columns silently disappear.
function _trimLeadingBlanks(){
  if(frameLabelOffset===0) return; // nothing to trim
  // Find the earliest internal frame index that has a keyframe on any layer.
  let earliest=Infinity;
  layers.forEach(l=>Object.keys(l.frames).forEach(f=>{
    const n=+f;if(n<earliest) earliest=n;
  }));
  if(!isFinite(earliest)) return; // no keyframes at all — leave as-is
  // How many blank frames sit before the earliest keyframe?
  // We can only trim up to frameLabelOffset (otherwise we'd push the
  // display label below 1 for the first real keyframe).
  const trimmable=Math.min(earliest, frameLabelOffset);
  if(trimmable<=0) return;
  // Shift every keyframe left by `trimmable` and update all tracking vars.
  layers.forEach(l=>{
    const shifted={};
    Object.keys(l.frames).forEach(f=>{shifted[+f-trimmable]=l.frames[f];});
    l.frames=shifted;
    // Shift frameMeta in tandem so marks track their drawings
    if(l.frameMeta&&Object.keys(l.frameMeta).length){
      const shiftedMeta={};
      Object.keys(l.frameMeta).forEach(f=>{const nf=+f-trimmable;if(nf>=0) shiftedMeta[nf]=l.frameMeta[f];});
      l.frameMeta=shiftedMeta;
    }
    if(l.indexFrames&&Object.keys(l.indexFrames).length){
      const shiftedIndexFrames={};
      Object.keys(l.indexFrames).forEach(f=>{const nf=+f-trimmable;if(nf>=0) shiftedIndexFrames[nf]=l.indexFrames[f];});
      l.indexFrames=shiftedIndexFrames;
    }
    if(l.indexMeta&&Object.keys(l.indexMeta).length){
      const shiftedIndexMeta={};
      Object.keys(l.indexMeta).forEach(f=>{const nf=+f-trimmable;if(nf>=0) shiftedIndexMeta[nf]=l.indexMeta[f];});
      l.indexMeta=shiftedIndexMeta;
    }
    if(l.smartStyleFrames&&Object.keys(l.smartStyleFrames).length){
      const shiftedSmart={};
      Object.keys(l.smartStyleFrames).forEach(f=>{const nf=+f-trimmable;if(nf>=0) shiftedSmart[nf]=l.smartStyleFrames[f];});
      l.smartStyleFrames=shiftedSmart;
    }
  });
  TOTAL-=trimmable;
  rangeStart-=trimmable; rangeEnd-=trimmable;
  curFrame-=trimmable;
  frameLabelOffset-=trimmable;
  clampRange();
  // If an active drag exists, keep its tracking state in sync so the next
  // onKFDragMove call computes the right delta after the shift.
  if(dragKF){
    dragKF.originFi-=trimmable;
    dragKF.items.forEach(item=>item.frameIndex-=trimmable);
    dragKF.occupied=new Set(Array.from(dragKF.occupied,key=>{
      const[layerIndex,frame]=key.split(':').map(Number);
      return`${layerIndex}:${frame-trimmable}`;
    }));
    // Canvas shrank by trimmable*CellW from the left — shift lockedScroll
    // left by the same amount so rawFrameFromX stays correct.
    dragKF.lockedScroll=Math.max(0,dragKF.lockedScroll-trimmable*CellW);
  }
  // Clamp curFrame in case the trim moved it below 0 (the playhead was
  // sitting in the now-removed blank zone).
  curFrame=Math.max(0,curFrame);
  // Only scroll to re-anchor the playhead when NOT in an active keyframe drag.
  // During a drag the viewport must stay still — a scroll shift would change
  // the apparent position of dragStartClientX and make the pixel-delta
  // calculation wrong, causing the "frame 1 becomes frame 9" jump.
  if(!dragKF){
    tlScroll.scrollLeft=Math.max(0,curFrame*CellW-tlScroll.clientWidth/2);
  }
}

function onKFDragUp(){
  document.removeEventListener('pointermove',onKFDragMove);
  document.removeEventListener('pointerup',onKFDragUp);
  if(dragKF&&(dragKF.appliedDelta!==0||dragKF.anyShift)){
    // If frames were prepended during this drag, try to reclaim any
    // leading blank space now that the final position is known.
    if(frameLabelOffset>0) _trimLeadingBlanks();
    undoStack.push({type:'timeline-frames',before:dragKF.before,after:_snapshotFrameMaps(dragKF.allLayerIndices)});
    if(undoStack.length>40) undoStack.shift();
    redoStack=[];
  }
  dragKF=null;
  renderTimeline();
}
function renderTimeline(){renderRuler();renderRows();renderLabelCol();updatePlayhead();updateStatus();updateRangeOverlay();updateTlHScroll();}

// ── Shared Timeline zoom state helpers ──────────────────────────────────────
// Single source of truth for the safe zoom range and for "zoom to a given
// visible frame-span while keeping one frame anchored under a fixed screen
// X". Used by scrollbar edge-dragging, mouse-wheel zoom, and the
// Ctrl+Space+drag zoom gesture — all three drive the same CellW/scrollLeft
// state, never a second independent zoom variable.
const TL_MIN_HANDLE_PX   = 24;   // matches the CSS min-width on #tl-hscroll-thumb
const TL_MIN_SPAN_FRAMES = 4;    // never zoom in past this many visible frames

function tlMinSpan(){
  const track  = document.getElementById('tl-hscroll-track');
  const trackW = track ? track.clientWidth : 200;
  return Math.max(TL_MIN_SPAN_FRAMES, (TL_MIN_HANDLE_PX / trackW) * TOTAL);
}

// Re-derive CellW and scrollLeft so that `anchorFrame` (a frame position,
// can be fractional) stays under `anchorScreenX` (px, relative to tlScroll's
// left edge) after the visible span changes to `newSpan` frames. Clamps to
// the shared min/max span and re-syncs the ruler/cells/exposure
// lines/playhead/scrollbar via renderTimeline().
function tlZoomToSpan(newSpan, anchorFrame, anchorScreenX){
  const viewW = tlScroll.clientWidth;
  const minSpan = tlMinSpan();
  newSpan = Math.max(minSpan, Math.min(TOTAL, newSpan));
  if(newSpan <= 0) return;
  CellW = viewW / newSpan;
  const maxScroll = Math.max(0, TOTAL * CellW - viewW);
  tlScroll.scrollLeft = Math.max(0, Math.min(maxScroll, anchorFrame * CellW - anchorScreenX));
  renderTimeline();
}

// ── FL-style horizontal scrollbar ────────────────────────────────────────────
(function(){
  const row   = document.getElementById('tl-hscroll-row');
  const gutter= document.getElementById('tl-hscroll-gutter');
  const track = document.getElementById('tl-hscroll-track');
  const thumb = document.getElementById('tl-hscroll-thumb');

  // Sync the gutter width to the actual label-column + resizer width so the
  // track starts exactly where the scrollable frame area starts.
  function syncGutter(){
    const col = document.getElementById('tl-labels-col');
    const rsz = document.getElementById('tl-labels-resize');
    const w   = (col ? col.offsetWidth : 150) + (rsz ? rsz.offsetWidth : 1);
    gutter.style.width = w + 'px';
  }

  window.updateTlHScroll = function updateTlHScroll(){
    syncGutter();

    const totalW = TOTAL * CellW;
    const viewW  = tlScroll.clientWidth;
    const trackW = track.clientWidth;   // track is flex:1 with 4px margins each side

    // Diagnostics — remove once confirmed working
    console.log('[tl-hscroll] totalW='+totalW+' viewW='+viewW+' trackW='+trackW+' scrollLeft='+tlScroll.scrollLeft);

    const fits = totalW <= viewW;
    row.classList.toggle('tl-hscroll-full', fits);

    if(fits){
      // Full-width thumb; no scroll position to represent
      thumb.style.left  = '0px';
      thumb.style.width = trackW + 'px';
      return;
    }

    const ratio    = viewW / totalW;
    const thumbW   = Math.max(24, Math.round(trackW * ratio));
    const maxScroll= totalW - viewW;
    const maxLeft  = trackW - thumbW;
    const leftPx   = maxLeft > 0
      ? Math.round((tlScroll.scrollLeft / maxScroll) * maxLeft)
      : 0;

    thumb.style.width = thumbW + 'px';
    thumb.style.left  = leftPx + 'px';

    console.log('[tl-hscroll] thumbW='+thumbW+' leftPx='+leftPx);
  };

  // Keep thumb in sync whenever tlScroll is scrolled by any other means
  tlScroll.addEventListener('scroll', updateTlHScroll, {passive: true});

  // Pointer drag on thumb — center = pan, edges = FL Studio-style zoom.
  //
  // The handle IS the visible Timeline range: handle-left == visibleStart
  // (in frames), handle-right == visibleEnd, handle-width == visibleSpan /
  // TOTAL. Edge drags move ONE boundary in track-pixel space 1:1 with the
  // pointer and hold the other boundary's frame fixed; CellW (the existing
  // Timeline frame-width/zoom state used by the ruler, cells, exposure
  // lines, and playhead) is then derived from the resulting span — there is
  // no second, independent zoom variable.
  const EDGE_ZONE     = 6;    // px from each end of the thumb that grabs the edge instead of the center
  const MIN_HANDLE_PX = TL_MIN_HANDLE_PX;   // matches the CSS min-width on #tl-hscroll-thumb

  let dragging = false, dragMode = null; // 'center' | 'left' | 'right'
  let activePointerId = null;
  let startX = 0, startScrollLeft = 0;
  // Snapshot taken once at pointerdown; all movement is computed relative
  // to this so there is zero jump/snap when the drag begins.
  let trackW0 = 0, leftPx0 = 0, rightPx0 = 0, visibleStart0 = 0, visibleEnd0 = 0;

  function edgeModeFor(e){
    const rect = thumb.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    if(offsetX <= EDGE_ZONE) return 'left';
    if(offsetX >= rect.width - EDGE_ZONE) return 'right';
    return 'center';
  }

  function startDrag(e, mode){
    dragging        = true;
    dragMode        = mode;
    activePointerId = e.pointerId;
    startX          = e.clientX;
    startScrollLeft = tlScroll.scrollLeft;

    const viewW = tlScroll.clientWidth;
    trackW0 = track.clientWidth;
    leftPx0 = thumb.offsetLeft;
    rightPx0= leftPx0 + thumb.offsetWidth;
    // Current visible frame range, clamped to the Timeline's own bounds
    // (the "fits" case can otherwise report a visibleEnd past TOTAL).
    visibleStart0 = Math.max(0, tlScroll.scrollLeft / CellW);
    visibleEnd0   = Math.min(TOTAL, visibleStart0 + viewW / CellW);

    thumb.classList.add('tl-thumb-drag');
    thumb.style.cursor = mode === 'center' ? 'grabbing' : 'ew-resize';
    document.body.style.userSelect = 'none';
    window._tlEdgeZooming = (mode !== 'center');

    // Pointer Events: once captured, the element keeps receiving move/up
    // for this pointerId no matter where it travels — including a pen
    // moving off the handle, off the track, or off the panel entirely.
    // Capture can occasionally fail to establish (rare, but not zero) so
    // a document-level fallback below also watches for up/cancel.
    try{ thumb.setPointerCapture(e.pointerId); }catch(err){}
  }

  thumb.addEventListener('pointerdown', e => {
    if(e.button !== 0 && e.pointerType !== 'pen') return;
    if(dragging) return;   // a drag is already active under another pointer
    const mode   = edgeModeFor(e);
    const totalW = TOTAL * CellW;
    const viewW  = tlScroll.clientWidth;
    if(mode === 'center' && totalW <= viewW) return;   // fully fits — nothing to pan
    e.preventDefault();
    startDrag(e, mode);
  });

  // Hover cursor: grab over the center, ew-resize near either edge.
  thumb.addEventListener('pointermove', e => {
    if(dragging) return;
    thumb.style.cursor = edgeModeFor(e) === 'center' ? 'grab' : 'ew-resize';
  });
  thumb.addEventListener('pointerleave', () => {
    if(!dragging) thumb.style.cursor = '';
  });

  function applyDrag(e){
    if(!dragging || e.pointerId !== activePointerId) return;
    const viewW = tlScroll.clientWidth;
    const dx    = e.clientX - startX;   // screen px == track px (1:1, no scaling)

    if(dragMode === 'center'){
      const totalW  = TOTAL * CellW;
      const trackW  = track.clientWidth;
      const thumbW  = thumb.offsetWidth;
      const maxLeft = trackW - thumbW;
      const maxScroll = totalW - viewW;
      if(maxLeft <= 0) return;
      tlScroll.scrollLeft = Math.max(0, Math.min(maxScroll,
        startScrollLeft + (dx / maxLeft) * maxScroll));
      return;
    }

    // Minimum span in frames, driven by whichever is larger: an absolute
    // frame-count floor, or the span implied by the minimum handle width
    // in pixels (so the handle never shrinks below its usable size).
    const minSpan = tlMinSpan();

    let visibleStart, visibleEnd;
    if(dragMode === 'left'){
      // Left edge follows the pointer 1:1; right boundary stays anchored.
      const newLeftPx = Math.max(0, Math.min(rightPx0 - MIN_HANDLE_PX, leftPx0 + dx));
      visibleEnd   = visibleEnd0;
      visibleStart = (newLeftPx / trackW0) * TOTAL;
      let span = visibleEnd - visibleStart;
      span = Math.max(minSpan, Math.min(TOTAL, span));
      visibleStart = visibleEnd - span;   // re-derive from the clamped span, anchor stays exact
      if(visibleStart < 0){ visibleStart = 0; }
    } else {
      // Right edge follows the pointer 1:1; left boundary stays anchored.
      const newRightPx = Math.min(trackW0, Math.max(leftPx0 + MIN_HANDLE_PX, rightPx0 + dx));
      visibleStart = visibleStart0;
      visibleEnd   = (newRightPx / trackW0) * TOTAL;
      let span = visibleEnd - visibleStart;
      span = Math.max(minSpan, Math.min(TOTAL, span));
      visibleEnd = visibleStart + span;   // re-derive from the clamped span, anchor stays exact
      if(visibleEnd > TOTAL){ visibleEnd = TOTAL; }
    }

    const span = Math.max(minSpan, visibleEnd - visibleStart);
    CellW = viewW / span;                 // derive zoom/frame-width from the new visible range
    tlScroll.scrollLeft = Math.max(0, visibleStart * CellW);   // derive scroll from the same range

    renderTimeline();   // CellW/scrollLeft changed — ruler/cells/exposure lines/playhead/thumb all resync from it
  }
  // Bound to the captured element (thumb); with setPointerCapture active
  // this fires regardless of where the pointer physically is.
  thumb.addEventListener('pointermove', applyDrag);
  // Document-level fallback: catches movement when capture was lost or
  // never established (pen tablets can cancel capture via pointercancel
  // when touch-action isn't none; also guards against browsers that don't
  // reliably maintain capture across element boundaries).
  // applyDrag is idempotent for the same event — calling it twice (once
  // from the captured thumb listener, once here via bubbling) is harmless.
  document.addEventListener('pointermove', e => {
    if(!dragging || e.pointerId !== activePointerId) return;
    applyDrag(e);
  });

  function endDrag(e){
    if(!dragging) return;
    if(e && e.pointerId !== activePointerId) return;
    dragging = false;
    dragMode = null;
    window._tlEdgeZooming = false;
    try{ if(activePointerId!=null) thumb.releasePointerCapture(activePointerId); }catch(err){}
    activePointerId = null;
    thumb.classList.remove('tl-thumb-drag');
    thumb.style.cursor = '';
    document.body.style.userSelect = '';
  }
  thumb.addEventListener('pointerup',       endDrag);
  thumb.addEventListener('pointercancel',   endDrag);
  // lostpointercapture fires whenever capture ends for any reason (up,
  // cancel, or the browser revoking it) — final safety net so drag state
  // can never get stuck active with no way to clear it.
  thumb.addEventListener('lostpointercapture', endDrag);
  // Document-level fallback for pointerup/cancel, in case the pointer
  // capture never took (so events wouldn't otherwise reach thumb once the
  // pointer left it) and the pointer is released elsewhere entirely.
  document.addEventListener('pointerup',     endDrag);
  document.addEventListener('pointercancel', endDrag);

  // Re-sync on resize (panel height drag, window resize, zoom change)
  const ro = new ResizeObserver(() => { syncGutter(); updateTlHScroll(); });
  ro.observe(tlScroll);
})();

// ── Mouse-wheel zoom ─────────────────────────────────────────────────────────
// Ctrl+Wheel over any Timeline viewport area (ruler, frame cells, exposure
// area, empty background) zooms horizontally, anchored to the frame under the
// cursor — never the playhead. Plain wheel scrolls the timeline normally
// (vertical with many layers; Shift+wheel = horizontal pan). Canvas zoom is
// untouched (listener is scoped to tlScroll, not canvas-area).
(function(){
  const WHEEL_ZOOM_SPEED = 0.0015;   // deltaY per "notch" (~100) -> ~16% span change

  tlScroll.addEventListener('wheel', e => {
    // Exclude layer-list column, toolbar, and scrollbar.
    if(e.target && typeof e.target.closest === 'function'){
      if(e.target.closest('#tl-labels-col') || e.target.closest('#tl-controls') || e.target.closest('#tl-hscroll-row')) return;
    }
    // Plain wheel (no Ctrl) = normal scroll; Shift+wheel = horizontal pan (both handled natively).
    // Only Ctrl+wheel zooms the timeline.
    if(!e.ctrlKey) return;
    e.preventDefault();
    const r = tlScroll.getBoundingClientRect();
    const cursorX = e.clientX - r.left;              // px, relative to viewport's left edge
    const viewW   = tlScroll.clientWidth;
    const curSpan = viewW / CellW;
    const frameAtCursor = (tlScroll.scrollLeft + cursorX) / CellW;   // the frame currently under the cursor
    // deltaY<0 (scroll up / pinch out) => zoom in (smaller span); deltaY>0 => zoom out.
    const factor  = Math.exp(e.deltaY * WHEEL_ZOOM_SPEED);
    // Suppress playhead auto-scroll during zoom so pointer-anchored scrollLeft isn't overridden
    window._tlZooming = true;
    tlZoomToSpan(curSpan * factor, frameAtCursor, cursorX);
    window._tlZooming = false;
  }, {passive:false});
})();

// ── Ctrl+Space+drag zoom (pen-friendly) ─────────────────────────────────────
// Mirrors the canvas's own Ctrl+Space+drag zoom gesture (core-state.js), but
// scoped to the Timeline and driving CellW/scrollLeft instead of canvas
// zoom/pan. spaceHeld/ctrlHeld are the same globals core-state.js already
// tracks from keydown/keyup, so the two gestures never fight over key state.
// The Timeline sits inside #bottom-area, which core-state.js's
// _isNavBlocked() already excludes from canvas nav — so starting this
// gesture inside the Timeline can never also trigger canvas zoom.
//
// NOTE: #tl-scroll carries [data-space-pan], which panel-pan.js normally
// turns into a plain Space+drag scrollLeft pan. panel-pan.js has been
// updated to yield whenever ctrlHeld is true, precisely so it can't
// stopPropagation this gesture away before frame width is ever touched.
(function(){
  const timelineArea = document.getElementById('timeline-area');
  if(!timelineArea) return;

  const ZOOM_SENSITIVITY = 0.01;   // dx (px) -> exponent; matches the requested exp(dx*0.01) mapping

  // Dedicated gesture state (distinct from scrollbar dragging/scrubbing/
  // selection state) so other handlers can check it if they ever need to.
  window.timelineZoomDragActive = false;

  let dragging = false, pointerId = null;
  let startX = 0, initialFrameWidth = 28, initialScrollLeft = 0, anchoredFrame = 0, pointerLocalX = 0;

  // Returns true for any UI chrome that must NOT trigger the Ctrl+Space zoom gesture:
  // scrollbar, layer-label column, toolbar row, and the resize handle between them.
  function isOverScrollbar(t){
    return !!(t && typeof t.closest === 'function' && (
      t.closest('#tl-hscroll-row') ||
      t.closest('#tl-labels-col') ||
      t.closest('#tl-labels-resize') ||
      t.closest('#tl-controls')
    ));
  }

  // Safe zoom range expressed as frame width (px/frame), derived from the
  // same tlMinSpan()/TOTAL bounds the scrollbar edges and wheel-zoom use —
  // one shared min/max, just expressed in a different unit here.
  function frameWidthBounds(){
    const viewW = tlScroll.clientWidth;
    const minSpan = tlMinSpan();
    return {
      minFrameWidth: viewW / TOTAL,     // whole Timeline visible = smallest frame width
      maxFrameWidth: viewW / minSpan,   // most zoomed in = largest frame width
    };
  }

  timelineArea.addEventListener('pointerdown', e => {
    if(!spaceHeld || !ctrlHeld) return;
    if(e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;   // no synthetic/touch events for this gesture
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    if(isOverScrollbar(e.target)) return;   // never steal the scrollbar's own center/edge drags
    e.preventDefault();
    e.stopPropagation();   // block frame scrubbing/selection drag from also starting

    const r = tlScroll.getBoundingClientRect();
    pointerLocalX     = e.clientX - r.left;         // pointer position relative to the Timeline viewport
    initialScrollLeft = tlScroll.scrollLeft;
    initialFrameWidth = CellW;                      // snapshot of the existing Timeline zoom/frame-width state
    anchoredFrame      = (initialScrollLeft + pointerLocalX) / initialFrameWidth;   // frame under the pointer — stays put, NOT the playhead
    startX = e.clientX;

    dragging  = true;
    pointerId = e.pointerId;
    window.timelineZoomDragActive = true;
    document.body.style.userSelect = 'none';
    timelineArea.style.cursor = 'zoom-in';
    try{ timelineArea.setPointerCapture(e.pointerId); }catch(err){}   // so pen movement continues even outside the Timeline
  }, {capture:true});

  timelineArea.addEventListener('pointermove', e => {
    if(!dragging || e.pointerId !== pointerId) return;
    e.preventDefault();

    const dx = e.clientX - startX;                        // real pointer delta, not movementX
    const zoomFactor = Math.exp(dx * ZOOM_SENSITIVITY);    // drag right -> >1 (zoom in), drag left -> <1 (zoom out)
    const {minFrameWidth, maxFrameWidth} = frameWidthBounds();
    const newFrameWidth = Math.max(minFrameWidth, Math.min(maxFrameWidth, initialFrameWidth * zoomFactor));

    CellW = newFrameWidth;   // this IS the Timeline zoom/frame-width state — actually changes cell width, not just scroll

    // Re-anchor: the frame captured at pointerdown must stay under the
    // pointer's ORIGINAL local X, independent of where curFrame/playhead is.
    const anchorContentX = anchoredFrame * CellW;
    const viewW = tlScroll.clientWidth;
    const maxScroll = Math.max(0, TOTAL * CellW - viewW);
    tlScroll.scrollLeft = Math.max(0, Math.min(maxScroll, anchorContentX - pointerLocalX));

    // Suppress playhead auto-scroll during zoom so the pointer-anchored scrollLeft isn't overridden
    window._tlZooming = true;
    renderTimeline();   // ruler/cells/exposure lines/playhead/scrollbar all resync from the new CellW/scrollLeft
    window._tlZooming = false;
  });

  function endDrag(e){
    if(!dragging) return;
    if(e && e.pointerId !== pointerId) return;
    dragging = false;
    window.timelineZoomDragActive = false;
    try{ if(pointerId!=null) timelineArea.releasePointerCapture(pointerId); }catch(err){}
    pointerId = null;
    document.body.style.userSelect = '';
    timelineArea.style.cursor = '';
  }
  timelineArea.addEventListener('pointerup',        endDrag);
  timelineArea.addEventListener('pointercancel',    endDrag);
  timelineArea.addEventListener('lostpointercapture', endDrag);
  // Document-level fallback in case capture didn't establish and the
  // pointer is released off the Timeline entirely.
  document.addEventListener('pointerup',     endDrag);
  document.addEventListener('pointercancel', endDrag);
})();

function renderRuler(){
  rulerEl.innerHTML='';
  const totalW=TOTAL*CellW;rulerEl.style.width=totalW+'px';
  for(let f=0;f<TOTAL;f++){
    const c=document.createElement('div');
    let cls='ruler-tick';
    if(f===curFrame) cls+=' cur';
    if(f===rangeStart) cls+=' range-start';
    else if(f===rangeEnd) cls+=' range-end';
    else if(f>rangeStart&&f<rangeEnd) cls+=' in-range';
    c.className=cls;c.style.width=CellW+'px';
    // Show tick label when the *displayed* frame number is a multiple of 5
    // (or is the very first frame in the clip). Using the internal index
    // (f) here would put labels on wrong columns whenever frameLabelOffset
    // is non-zero (i.e. after blank frames have been prepended for a
    // negative-frame drag). frameLabel() returns the user-visible number.
    const lbl=frameLabel(f);
    c.textContent=(lbl%5===0||f===0)?lbl:'';
    c.addEventListener('click',e=>{
      e.stopPropagation();
      goToFrame(f,false,true);
    });
    rulerEl.appendChild(c);
  }
  // Start/End marker lines
  ['start','end'].forEach(which=>{
    const line=document.createElement('div');
    line.id='ruler-'+which+'-line';line.className='range-marker-line';
    const f=which==='start'?rangeStart:rangeEnd;
    line.style.left=(f*CellW+CellW/2)+'px';
    const lbl=document.createElement('div');lbl.className='range-marker-label';lbl.id='ruler-'+which+'-label';lbl.textContent=which==='start'?'I':'O';
    line.appendChild(lbl);rulerEl.appendChild(line);
  });
}

function renderRulerHighlight(){
  document.querySelectorAll('.ruler-tick').forEach((c,i)=>c.classList.toggle('cur',i===curFrame));
}

// Returns indices (top-to-bottom render order) of layers currently shown on the timeline
function timelineLayerIndices(){
  const idx=[];
  for(let i=layers.length-1;i>=0;i--) if(layers[i].onTimeline!==false) idx.push(i);
  return idx;
}

let dragTlLabelIdx=null;
let tlLabelLastClicked=null; // for shift-range
// Rubber-band for timeline label column
let tlLbSelecting=false,tlLbStartX=0,tlLbStartY=0,tlLbBoxEl=null;

function renderLabelCol(){
  const el=document.getElementById('tl-labels-rows');el.innerHTML='';
  const visibleIndices=timelineLayerIndices();
  visibleIndices.forEach(i=>{
    const l=layers[i];const lbl=document.createElement('div');
    const isMultiSel=selectedTlLabelIndices.has(i);
    lbl.className='tl-layer-lbl'+(!activeGroupId&&i===curLayer?' active':isMultiSel?' multi-sel':'');
    lbl.style.height=CellH+'px';
    lbl.dataset.idx=i;
    lbl.title='Click to select. Shift+click range, Ctrl+click individual. Drag name to Hide zone to remove from timeline. Drag empty space to rubber-band select.';
    lbl.innerHTML='<span class="tl-lbl-draghandle" draggable="true"><div class="tl-lbl-dot" style="background:'+l.color+'"></div><span class="tl-lbl-name">'+l.name+'</span></span><span class="tl-lbl-rbzone"></span>';
    const handle=lbl.querySelector('.tl-lbl-draghandle');

    lbl.addEventListener('click',ev=>{
      const vi=visibleIndices.indexOf(i); // visual index for shift-range
      if(ev.shiftKey&&tlLabelLastClicked!=null){
        // REPLACE selection with range from anchor to here
        selectedTlLabelIndices.clear();
        const lastVi=visibleIndices.indexOf(tlLabelLastClicked);
        const lo=Math.min(vi,lastVi),hi=Math.max(vi,lastVi);
        for(let x=lo;x<=hi;x++) selectedTlLabelIndices.add(visibleIndices[x]);
        renderLabelCol();
      } else if(ev.ctrlKey||ev.metaKey){
        if(selectedTlLabelIndices.has(i)) selectedTlLabelIndices.delete(i);
        else selectedTlLabelIndices.add(i);
        tlLabelLastClicked=i;
        renderLabelCol();
      } else {
        selectedTlLabelIndices.clear();
        switchLayer(i);
        tlLabelLastClicked=i;
      }
    });

    handle.setAttribute('draggable','false');
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0) return;
      e.preventDefault();e.stopPropagation();
      // Multi-drag: if this layer is in selection, drag all selected; else drag just this one
      if(!selectedTlLabelIndices.has(i)) selectedTlLabelIndices.clear();
      selectedTlLabelIndices.add(i);
      dragTlLabelIdx=i;
      lbl.classList.add('tl-lbl-dragging');
      document.addEventListener('pointermove',onTlLabelDragMove);
      document.addEventListener('pointerup',onTlLabelDragUp);
    });

    // Mousedown on the empty rubber-band zone of a row: start rubber-band instead of a drag
    lbl.querySelector('.tl-lbl-rbzone').addEventListener('pointerdown',ev=>{
      if(ev.button!==0) return;
      ev.stopPropagation();
      startTlLabelRubberBand(ev);
    });

    el.appendChild(lbl);
  });

  // Click/mousedown on blank area of label column: clear selection or start rubber-band
  el.addEventListener('pointerdown',ev=>{
    const onRow=ev.target.closest('.tl-layer-lbl[data-idx]');
    if(onRow) return;
    if(ev.button!==0) return;
    selectedTlLabelIndices.clear();tlLabelLastClicked=null;
    renderLabelCol();
    startTlLabelRubberBand(ev);
  });
}

function onTlLabelDragMove(ev){
  if(dragTlLabelIdx===null) return;
  const r=tlHideZone.getBoundingClientRect();
  const over=ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
  tlHideZone.classList.toggle('drag-over',over);
}
function onTlLabelDragUp(ev){
  document.removeEventListener('pointermove',onTlLabelDragMove);
  document.removeEventListener('pointerup',onTlLabelDragUp);
  if(dragTlLabelIdx===null) return;
  document.querySelectorAll('.tl-lbl-dragging').forEach(el=>el.classList.remove('tl-lbl-dragging'));
  const r=tlHideZone.getBoundingClientRect();
  const over=ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
  tlHideZone.classList.remove('drag-over');
  if(over){
    const toHide=selectedTlLabelIndices.size>0?[...selectedTlLabelIndices]:[dragTlLabelIdx];
    toHide.forEach(i=>{if(layers[i]) layers[i].onTimeline=false;});
    selectedTlLabelIndices.clear();
    renderLayerPanel();renderTimeline();
  }
  dragTlLabelIdx=null;
}

function startTlLabelRubberBand(ev){
  if(ev.button!==0) return;
  tlLbSelecting=true;tlLbStartX=ev.clientX;tlLbStartY=ev.clientY;
  if(!tlLbBoxEl){
    tlLbBoxEl=document.createElement('div');
    tlLbBoxEl.style.cssText='position:fixed;border:1px solid var(--accent);background:rgba(127,119,221,0.08);z-index:9998;pointer-events:none;display:none;border-radius:2px;';
    document.body.appendChild(tlLbBoxEl);
  }
  tlLbBoxEl.style.left=tlLbStartX+'px';tlLbBoxEl.style.top=tlLbStartY+'px';
  tlLbBoxEl.style.width='0';tlLbBoxEl.style.height='0';tlLbBoxEl.style.display='block';
  document.addEventListener('pointermove',onTlLbMove);
  document.addEventListener('pointerup',onTlLbUp);
}
function _updateTlLabelAutoScroll(clientY){const el=document.getElementById('tl-labels-rows');if(!el){_stopAutoScroll();return;}const r=el.getBoundingClientRect();const zone=40;if(clientY<r.top+zone){_autoScrollSpeed=-Math.max(2,Math.round((zone-(clientY-r.top))/4));_startAutoScroll(el);}else if(clientY>r.bottom-zone){_autoScrollSpeed=Math.max(2,Math.round((zone-(r.bottom-clientY))/4));_startAutoScroll(el);}else{_stopAutoScroll();}}
function onTlLbMove(ev){
  if(!tlLbSelecting) return;
  _updateTlLabelAutoScroll(ev.clientY);
  const x=Math.min(ev.clientX,tlLbStartX),y=Math.min(ev.clientY,tlLbStartY);
  const w=Math.abs(ev.clientX-tlLbStartX),h=Math.abs(ev.clientY-tlLbStartY);
  tlLbBoxEl.style.left=x+'px';tlLbBoxEl.style.top=y+'px';
  tlLbBoxEl.style.width=w+'px';tlLbBoxEl.style.height=h+'px';
  const bx1=x,by1=y,bx2=x+w,by2=y+h;
  selectedTlLabelIndices.clear();
  document.querySelectorAll('.tl-layer-lbl[data-idx]').forEach(r=>{
    const rr=r.getBoundingClientRect();
    const overlap=!(rr.right<bx1||rr.left>bx2||rr.bottom<by1||rr.top>by2);
    const idx=parseInt(r.dataset.idx);
    if(overlap) selectedTlLabelIndices.add(idx);
    // Mirror layer panel behavior: drop .active highlight from curLayer if it's outside the selection box
    if(idx===curLayer) r.classList.toggle('active',overlap);
    else r.classList.toggle('multi-sel',overlap);
  });
}
function onTlLbUp(){
  tlLbSelecting=false;
  _stopAutoScroll();
  if(tlLbBoxEl) tlLbBoxEl.style.display='none';
  document.removeEventListener('pointermove',onTlLbMove);
  document.removeEventListener('pointerup',onTlLbUp);
  // If curLayer is not in the rubber-band selection, switch to the first selected layer
  if(selectedTlLabelIndices.size>0&&!selectedTlLabelIndices.has(curLayer)){
    // Pick the topmost visible selected layer (first in timelineLayerIndices order)
    const visOrder=timelineLayerIndices();
    const firstSel=visOrder.find(i=>selectedTlLabelIndices.has(i));
    if(firstSel!=null) switchLayer(firstSel);
  }
  renderLabelCol();
}

function renderRows(){
  const rowWrap=document.getElementById('tl-rows-wrap');rowWrap.innerHTML='';
  const ph=document.createElement('div');ph.id='playhead';rowWrap.appendChild(ph);
  const ro=document.createElement('div');ro.id='range-overlay';rowWrap.appendChild(ro);
  const totalW=TOTAL*CellW;rowWrap.style.width=totalW+'px';

  timelineLayerIndices().forEach(i=>{
    const l=layers[i];const row=document.createElement('div');
    row.className='tl-row';row.style.width=totalW+'px';row.style.position='relative';
    if(l.color&&l.color!=='transparent'){const hex=l.color;const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);row.style.background=`rgba(${r},${g},${b},0.22)`;}

    for(let f=0;f<TOTAL;f++){
      const cell=document.createElement('div');
      let cls='tl-cell';
      if(f===curFrame&&i===curLayer) cls+=' cur-col';
      if(selectedFrames.has(f)&&selectedRowLayers.has(i)) cls+=' selected';
      cell.className=cls;cell.style.cssText='left:'+(f*CellW)+'px;position:absolute;width:'+CellW+'px;height:'+CellH+'px;';
      cell.dataset.layerIdx=i;
      cell.addEventListener('pointerdown',ev=>{
        ev.stopPropagation();
        if(!ev.shiftKey)clearKeyframeSelection();
        if(ev.shiftKey){const anchor=kfSelectionAnchor||{layerIndex:curLayer,frameIndex:curFrame};selectKeyframeRange(anchor,{layerIndex:i,frameIndex:f});selectedRowLayers=new Set(_rowSpanLayers(anchor.layerIndex,i));const lo=Math.min(anchor.frameIndex,f),hi=Math.max(anchor.frameIndex,f);selectedFrames.clear();for(let ff=lo;ff<=hi;ff++)selectedFrames.add(ff);if(i!==curLayer)switchLayer(i);curFrame=f;loadFrame(curLayer,curFrame);renderTimeline();}
        else if(ev.ctrlKey||ev.metaKey){if(selectedFrames.has(f))selectedFrames.delete(f);else selectedFrames.add(f);selectedRowLayers.add(i);if(i!==curLayer)switchLayer(i);curFrame=f;loadFrame(curLayer,curFrame);renderTimeline();}
        else{selectedFrames.clear();selectedFrames.add(f);selectedKFs.clear();selectedRowLayers=new Set([i]);kfSelectionAnchor={layerIndex:i,frameIndex:f};document.querySelectorAll('.kf-block.selected').forEach(b=>b.classList.remove('selected'));tlSelDrag={startF:f,anchorLayer:i};if(i!==curLayer)switchLayer(i);goToFrame(f);}
      });
      row.appendChild(cell);
    }

    // Extend bars
    const kfs=Object.keys(l.frames).map(Number).sort((a,b)=>a-b);
    for(let ki=0;ki<kfs.length-1;ki++){
      const f1=kfs[ki],f2=kfs[ki+1];if(f1>=TOTAL) continue;
      const bar=document.createElement('div');bar.className='kf-extend';
      bar.style.left=(f1*CellW+CellW/2)+'px';bar.style.width=((Math.min(f2,TOTAL-1)-f1)*CellW)+'px';bar.style.top=(CellH/2-1)+'px';
      row.appendChild(bar);
    }

    // Keyframe blocks
    kfs.filter(f=>f<TOTAL).forEach(f=>{
      const block=document.createElement('div');const kk=`${i}:${f}`;
      let cls='kf-block';if(selectedKFs.has(kk)) cls+=' selected';
      block.className=cls;
      block.style.cssText='position:absolute;left:'+(f*CellW+3)+'px;top:4px;bottom:4px;width:'+(CellW-6)+'px;';
      block.style.setProperty('--kf-mark-color',getMarkDef(getDrawingMark(i,f)).color);
      block.title=l.name+' F'+frameLabel(f);
      block.dataset.layerIdx=i;block.dataset.kk=kk;
      block.addEventListener('pointerdown',ev=>{
        ev.stopPropagation();
        if(ev.shiftKey&&kfSelectionAnchor){
          selectKeyframeRange(kfSelectionAnchor,{layerIndex:i,frameIndex:f});
          selectedRowLayers=new Set(_rowSpanLayers(kfSelectionAnchor.layerIndex,i));
          const lo=Math.min(kfSelectionAnchor.frameIndex,f),hi=Math.max(kfSelectionAnchor.frameIndex,f);
          selectedFrames.clear();for(let ff=lo;ff<=hi;ff++)selectedFrames.add(ff);
        }else if(ev.ctrlKey||ev.metaKey){
          if(selectedKFs.has(kk))selectedKFs.delete(kk);else selectedKFs.add(kk);
          selectedRowLayers.add(i);
          kfSelectionAnchor={layerIndex:i,frameIndex:f};
        }else{
          if(!selectedKFs.has(kk)){selectedKFs.clear();selectedKFs.add(kk);}
          selectedRowLayers=new Set([i]);
          kfSelectionAnchor={layerIndex:i,frameIndex:f};
        }
        startKFDrag(i,f,ev);
        if(i!==curLayer)switchLayer(i);curFrame=f;if(!ev.shiftKey){selectedFrames.clear();selectedFrames.add(f);}loadFrame(curLayer,curFrame);renderTimeline();
      });
      block.addEventListener('click',ev=>{ev.stopPropagation();if(i!==curLayer)switchLayer(i);selectedFrames.clear();selectedFrames.add(f);goToFrame(f);});
      row.appendChild(block);
    });
    rowWrap.appendChild(row);
  });
  updateRangeOverlay();

  // Rubber-band selection in timeline (visual rectangle for selecting frames)
  let tlRbSelecting=false,tlRbStartX=0,tlRbStartY=0,tlRbBoxEl=null;
  rowWrap.addEventListener('pointerdown',ev=>{
    if(ev.button!==0) return;
    // Only start rubber-band when clicking on empty row area (not on kf-block)
    if(ev.target.classList.contains('kf-block')) return;
    if(ev.target.classList.contains('tl-cell')||ev.target===rowWrap){
      // If no modifier, clear and start selection via existing tlSelDrag
      // Also show a visual rubber-band box
      if(!ev.shiftKey&&!ev.ctrlKey&&!ev.metaKey){
        tlRbSelecting=true;
        tlRbStartX=ev.clientX;tlRbStartY=ev.clientY;
        if(!tlRbBoxEl){
          tlRbBoxEl=document.createElement('div');
          tlRbBoxEl.style.cssText='position:fixed;border:1px solid var(--accent);background:rgba(127,119,221,0.08);z-index:9998;pointer-events:none;border-radius:2px;display:none;';
          document.body.appendChild(tlRbBoxEl);
        }
        tlRbBoxEl.style.left=tlRbStartX+'px';tlRbBoxEl.style.top=tlRbStartY+'px';
        tlRbBoxEl.style.width='0';tlRbBoxEl.style.height='0';tlRbBoxEl.style.display='block';
        const onRbMove=mev=>{
          if(!tlRbSelecting) return;
          const x=Math.min(mev.clientX,tlRbStartX),y=Math.min(mev.clientY,tlRbStartY);
          const w=Math.abs(mev.clientX-tlRbStartX),h=Math.abs(mev.clientY-tlRbStartY);
          tlRbBoxEl.style.left=x+'px';tlRbBoxEl.style.top=y+'px';
          tlRbBoxEl.style.width=w+'px';tlRbBoxEl.style.height=h+'px';
        };
        const onRbUp=()=>{
          tlRbSelecting=false;
          if(tlRbBoxEl) tlRbBoxEl.style.display='none';
          document.removeEventListener('pointermove',onRbMove);
          document.removeEventListener('pointerup',onRbUp);
        };
        document.addEventListener('pointermove',onRbMove);
        document.addEventListener('pointerup',onRbUp);
      }
    }
  });

  rowWrap.addEventListener('pointermove',e=>{
    if(!tlSelDrag) return;
    const r=tlScroll.getBoundingClientRect();
    const f2=Math.max(0,Math.min(TOTAL-1,Math.floor((e.clientX-r.left+tlScroll.scrollLeft)/CellW)));

    // Figure out which row (layer) the pointer is currently over so the drag
    // can span multiple rows, not just the layer it started on.
    let li=tlSelDrag.anchorLayer;
    const elUnder=document.elementFromPoint(e.clientX,e.clientY);
    const rowEl=elUnder&&elUnder.closest('[data-layer-idx]');
    if(rowEl&&rowEl.dataset.layerIdx!==undefined) li=parseInt(rowEl.dataset.layerIdx);

    const lo=Math.min(tlSelDrag.startF,f2),hi=Math.max(tlSelDrag.startF,f2);
    selectedFrames.clear();for(let ff=lo;ff<=hi;ff++)selectedFrames.add(ff);
    selectedRowLayers=new Set(_rowSpanLayers(tlSelDrag.anchorLayer,li));

    // Rebuild the keyframe selection across every row between the anchor row
    // and the row currently under the pointer (same logic as shift-click range select).
    if(kfSelectionAnchor){
      selectKeyframeRange(kfSelectionAnchor,{layerIndex:li,frameIndex:f2});
    }

    curFrame=f2;loadFrame(curLayer,curFrame);
    document.querySelectorAll('.tl-cell').forEach(c=>{const cf=parseInt(c.style.left)/CellW;const isSel=selectedRowLayers.has(parseInt(c.dataset.layerIdx));c.classList.toggle('selected',isSel&&selectedFrames.has(cf));c.classList.toggle('cur-col',parseInt(c.dataset.layerIdx)===curLayer&&cf===curFrame);});
    document.querySelectorAll('.kf-block').forEach(b=>{b.classList.toggle('selected',selectedKFs.has(b.dataset.kk));});
    updatePlayhead();document.getElementById('frame-info').textContent=frameLabel(curFrame)+' / '+frameLabel(TOTAL-1);
  });
}

function updateRangeOverlay(){
  const ro=document.getElementById('range-overlay');if(!ro) return;
  const left=rangeStart*CellW,width=(rangeEnd-rangeStart+1)*CellW,totalH=timelineLayerIndices().length*CellH;
  ro.style.cssText='position:absolute;top:0;left:'+left+'px;width:'+width+'px;height:'+totalH+'px;background:rgba(127,119,221,0.07);border-left:2px solid rgba(29,158,117,0.6);border-right:2px solid rgba(226,75,74,0.6);pointer-events:none;z-index:6;';
}

function updatePlayhead(){
  const ph=document.getElementById('playhead');if(!ph) return;
  const left=curFrame*CellW+CellW/2-1;
  ph.style.left=left+'px';ph.style.height=(timelineLayerIndices().length*CellH)+'px';ph.style.top='0';
  // Frame-number label above the handle (like TVPaint's scrubber tooltip).
  // Create it once as a child element and update its text each call.
  let lbl=ph.querySelector('.ph-frame-label');
  if(!lbl){
    lbl=document.createElement('span');
    lbl.className='ph-frame-label';
    Object.assign(lbl.style,{
      position:'absolute',
      bottom:'100%',       // sits above the ruler triangle
      left:'50%',
      transform:'translateX(-50%)',
      fontSize:'9px',
      lineHeight:'1',
      padding:'1px 3px',
      background:'var(--red)',
      color:'#fff',
      borderRadius:'2px',
      whiteSpace:'nowrap',
      pointerEvents:'none',
      userSelect:'none',
      // small gap between label and the triangle
      marginBottom:'2px',
    });
    ph.appendChild(lbl);
  }
  lbl.textContent=frameLabel(curFrame);
  // Auto-scroll to keep the playhead in view — but NOT while the scrollbar
  // edge handles are actively driving zoom (window._tlEdgeZooming). During
  // an edge drag, scrollLeft is derived purely from the dragged boundary's
  // visibleStart/visibleEnd; re-centering on curFrame here would silently
  // override that and make zoom appear to anchor on the playhead instead
  // of the edge being dragged.
  // Skip playhead-centering scroll during ANY zoom gesture (edge-drag, wheel, or Ctrl+Space drag)
  // so the pointer-anchored scrollLeft computed by the zoom isn't clobbered.
  if(!window._tlEdgeZooming && !window._tlZooming){
    const visible=tlScroll.scrollLeft+tlScroll.clientWidth;
    if(left>visible-40||left<tlScroll.scrollLeft+20) tlScroll.scrollLeft=left-tlScroll.clientWidth/2;
  }
}

function updateStatus(){
  document.getElementById('stat-kf').textContent='KF: '+Object.keys(layers[curLayer]?.frames||{}).length;
  document.getElementById('stat-range').textContent='Range: '+frameLabel(rangeStart)+'–'+frameLabel(rangeEnd);
  const sel=[...selectedFrames].sort((a,b)=>a-b);
  document.getElementById('stat-sel').textContent='Sel: '+(sel.length?sel.map(f=>frameLabel(f)).join(','):'—');
}

// ════════════════════════════════════════════════════════════════
// LAYER PANEL — opacity, eye icon, groups, stencil/clip, multi-select, drag-line
// ════════════════════════════════════════════════════════════════
let selectedTlLabelIndices=new Set(); // multi-select in timeline label column
let layerShiftAnchor=null; // anchor LAYER index for shift-range select in layer panel
let groupShiftAnchor=null; // anchor GROUP id for shift-range select in layer panel (whichever of the two was set most recently wins as the range start)
let layerColorPickerEl=null;
let selectedLayerIndices=new Set(); // multi-select
let selectedGroupIds=new Set(); // multi-select for groups
let activeGroupId=null; // currently active/focused group (like curLayer for layers)

// ── Opacity/stencil controls at top of panel
const layerOpSlider=document.getElementById('layer-opacity-slider');
const layerOpVal=document.getElementById('layer-opacity-val');
const layerStencilSel=document.getElementById('layer-stencil-select');

function syncOpacityControls(){
  const stencilRow=document.getElementById('layer-stencil-row');
  if(activeGroupId){
    const grp=groups.find(g=>g.id===activeGroupId);
    if(!grp) return;
    const pct=Math.round((grp.opacity??1)*100);
    layerOpSlider.value=pct;
    layerOpVal.textContent=pct+'%';
    // If this group itself is clipped to another group or layer, edit ITS stencil.
    if(grp.clipToGroup!=null||grp.clipTo!=null){
      layerStencilSel.value=grp.stencil==='outside'?'outside':'inside';
      layerStencilSel.disabled=false;
      stencilRow.style.display='';
      return;
    }
    // Otherwise, still show stencil for curLayer even when a group is focused
    const cl=layers[curLayer];
    if(cl&&cl.stencil&&cl.stencil!=='none'){
      const displayStencil=(cl.stencil==='inside'||cl.stencil==='group-inside')?'inside':(cl.stencil==='outside'||cl.stencil==='group-outside')?'outside':'none';
      layerStencilSel.value=displayStencil;
      layerStencilSel.disabled=false;
      stencilRow.style.display='';
    } else {
      layerStencilSel.value='none';
      layerStencilSel.disabled=true;
      stencilRow.style.display='none';
    }
    return;
  }
  layerStencilSel.disabled=false;
  const l=layers[curLayer];if(!l) return;
  const pct=Math.round((l.opacity??1)*100);
  layerOpSlider.value=pct;
  layerOpVal.textContent=pct+'%';
  const displayStencil=(l.stencil==='inside'||l.stencil==='group-inside')?'inside':(l.stencil==='outside'||l.stencil==='group-outside')?'outside':'none';
  layerStencilSel.value=displayStencil;
  stencilRow.style.display=(l.stencil&&l.stencil!=='none')?'':'none';
}
layerOpSlider.oninput=()=>{
  if(activeGroupId){
    const grp=groups.find(g=>g.id===activeGroupId);
    if(!grp) return;
    grp.opacity=layerOpSlider.value/100;
    layerOpVal.textContent=layerOpSlider.value+'%';
    recomposite(curLayer,curFrame);renderLayerPanel();
    return;
  }
  const l=layers[curLayer];if(!l)return;
  l.opacity=layerOpSlider.value/100;
  layerOpVal.textContent=layerOpSlider.value+'%';
  recomposite(curLayer,curFrame);renderLayerPanel();
};
layerStencilSel.onchange=()=>{
  if(activeGroupId){
    const grp=groups.find(g=>g.id===activeGroupId);
    if(grp&&(grp.clipToGroup!=null||grp.clipTo!=null)){
      const v=layerStencilSel.value;
      if(v==='none'){grp.stencil='none';grp.clipToGroup=null;grp.clipTo=null;}
      else{grp.stencil=v;}
      recomposite(curLayer,curFrame);renderLayerPanel();syncOpacityControls();
      return;
    }
  }
  const l=layers[curLayer];if(!l)return;
  const v=layerStencilSel.value;
  if(v==='none'){l.stencil='none';l.clipTo=null;l.clipToGroup=null;}
  else if(l.clipToGroup){l.stencil=v==='outside'?'group-outside':'group-inside';}
  else{l.stencil=v;}
  recomposite(curLayer,curFrame);renderLayerPanel();syncOpacityControls();
};

// ── Header delete button — deletes selected layer or group
function updateDelBtnLabel(){
  // label text removed from button; nothing to update
}
document.getElementById('layer-del-btn').addEventListener('click',()=>{
  if(selectedLayerIndices.size>0||selectedGroupIds.size>0){deleteBulk();}
  else if(activeGroupId){deleteGroup(activeGroupId);}
  else{deleteLayer(curLayer);}
});


// ── Color picker popup
function showLayerColorPicker(layerIdx,dotEl){
  if(layerColorPickerEl) layerColorPickerEl.remove();
  const popup=document.createElement('div');
  popup.style.cssText='position:fixed;z-index:9999;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:6px;min-width:130px;';
  const r=dotEl.getBoundingClientRect();
  popup.style.left=Math.min(r.right+6,window.innerWidth-150)+'px';
  popup.style.top=Math.min(r.top,window.innerHeight-160)+'px';
  const title=document.createElement('div');title.style.cssText='font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px;';title.textContent='Layer Color';
  popup.appendChild(title);
  const grid=document.createElement('div');grid.style.cssText='display:flex;flex-wrap:wrap;gap:5px;';
  const clearBtn=document.createElement('div');clearBtn.title='Clear (transparent)';
  clearBtn.style.cssText='width:20px;height:20px;border-radius:50%;border:1.5px solid var(--border2);cursor:pointer;background:repeating-conic-gradient(#999 0% 25%,#ddd 0% 50%) 0 0/10px 10px;flex-shrink:0;';
  clearBtn.onclick=()=>{layers[layerIdx].color='transparent';popup.remove();layerColorPickerEl=null;renderLayerPanel();renderTimeline();};
  grid.appendChild(clearBtn);
  LCOLORS.forEach(c=>{
    const sw=document.createElement('div');sw.style.cssText='width:20px;height:20px;border-radius:50%;border:1.5px solid var(--border2);cursor:pointer;background:'+c+';flex-shrink:0;';
    if(layers[layerIdx].color===c) sw.style.outline='2px solid #fff';
    sw.onclick=()=>{layers[layerIdx].color=c;popup.remove();layerColorPickerEl=null;renderLayerPanel();renderTimeline();};
    grid.appendChild(sw);
  });
  popup.appendChild(grid);
  const customRow=document.createElement('div');customRow.style.cssText='display:flex;align-items:center;gap:6px;margin-top:2px;';
  const customLabel=document.createElement('span');customLabel.style.cssText='font-size:10px;color:var(--text2);';customLabel.textContent='Custom';
  const customIn=document.createElement('input');customIn.type='color';customIn.value=layers[layerIdx].color&&layers[layerIdx].color!=='transparent'?layers[layerIdx].color:'#7F77DD';
  customIn.style.cssText='width:32px;height:22px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;padding:1px;background:var(--bg3);';
  customIn.oninput=e=>{layers[layerIdx].color=e.target.value;renderLayerPanel();renderTimeline();};
  customRow.appendChild(customLabel);customRow.appendChild(customIn);
  popup.appendChild(customRow);
  document.body.appendChild(popup);layerColorPickerEl=popup;
  setTimeout(()=>{
    function clickOutside(ev){if(!popup.contains(ev.target)){popup.remove();layerColorPickerEl=null;document.removeEventListener('click',clickOutside,true);}}
    document.addEventListener('click',clickOutside,true);
  },0);
}

function showGroupColorPicker(grp,dotEl){
  if(layerColorPickerEl) layerColorPickerEl.remove();
  const popup=document.createElement('div');
  popup.style.cssText='position:fixed;z-index:9999;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:6px;min-width:130px;';
  const r=dotEl.getBoundingClientRect();
  popup.style.left=Math.min(r.right+6,window.innerWidth-150)+'px';
  popup.style.top=Math.min(r.top,window.innerHeight-160)+'px';
  const title=document.createElement('div');title.style.cssText='font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px;';title.textContent='Group Color';
  popup.appendChild(title);
  const grid=document.createElement('div');grid.style.cssText='display:flex;flex-wrap:wrap;gap:5px;';
  const clearBtn=document.createElement('div');clearBtn.title='Clear (transparent)';
  clearBtn.style.cssText='width:20px;height:20px;border-radius:50%;border:1.5px solid var(--border2);cursor:pointer;background:repeating-conic-gradient(#999 0% 25%,#ddd 0% 50%) 0 0/10px 10px;flex-shrink:0;';
  clearBtn.onclick=()=>{grp.color='transparent';popup.remove();layerColorPickerEl=null;renderLayerPanel();};
  grid.appendChild(clearBtn);
  LCOLORS.forEach(c=>{
    const sw=document.createElement('div');sw.style.cssText='width:20px;height:20px;border-radius:50%;border:1.5px solid var(--border2);cursor:pointer;background:'+c+';flex-shrink:0;';
    if(grp.color===c) sw.style.outline='2px solid #fff';
    sw.onclick=()=>{grp.color=c;popup.remove();layerColorPickerEl=null;renderLayerPanel();};
    grid.appendChild(sw);
  });
  popup.appendChild(grid);
  const customRow=document.createElement('div');customRow.style.cssText='display:flex;align-items:center;gap:6px;margin-top:2px;';
  const customLabel=document.createElement('span');customLabel.style.cssText='font-size:10px;color:var(--text2);';customLabel.textContent='Custom';
  const customIn=document.createElement('input');customIn.type='color';customIn.value=grp.color&&grp.color!=='transparent'?grp.color:'#7F77DD';
  customIn.style.cssText='width:32px;height:22px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;padding:1px;background:var(--bg3);';
  customIn.oninput=e=>{grp.color=e.target.value;renderLayerPanel();};
  customRow.appendChild(customLabel);customRow.appendChild(customIn);
  popup.appendChild(customRow);
  document.body.appendChild(popup);layerColorPickerEl=popup;
  setTimeout(()=>{
    function clickOutside(ev){if(!popup.contains(ev.target)){popup.remove();layerColorPickerEl=null;document.removeEventListener('click',clickOutside,true);}}
    document.addEventListener('click',clickOutside,true);
  },0);
}

// ── Eye-drag for clip/stencil assignment
const eyeGhost=document.getElementById('eye-drag-ghost');
let eyeDragLayerIdx=null;
let eyeDragTargetIdx=null;
let eyeDragTargetGid=null;

function startEyeDrag(layerIdx,ev){
  eyeDragLayerIdx=layerIdx;
  eyeGhost.style.display='block';
  eyeGhost.style.left=ev.clientX+'px';eyeGhost.style.top=ev.clientY+'px';
  document.addEventListener('pointermove',onEyeDragMove);
  document.addEventListener('pointerup',onEyeDragUp);
}
function onEyeDragMove(ev){
  eyeGhost.style.left=ev.clientX+'px';eyeGhost.style.top=ev.clientY+'px';
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>r.classList.remove('eye-drop-target'));
  document.querySelectorAll('.layer-group-row[data-gid]').forEach(r=>r.classList.remove('eye-drop-target'));
  eyeGhost.style.display='none';
  const el=document.elementFromPoint(ev.clientX,ev.clientY);
  eyeGhost.style.display='block';
  const layerRow=el&&el.closest('.layer-row[data-idx]');
  const groupRow=el&&el.closest('.layer-group-row[data-gid]');
  const draggedLayer=layers[eyeDragLayerIdx];
  const draggedInGroup=!!(draggedLayer&&draggedLayer.groupId);
  if(layerRow){
    const idx=parseInt(layerRow.dataset.idx);
    // Find what's directly below the dragged layer in visual (panel) order
    const flat=_buildFlatDisplayItems();
    const dragFlatPos=flat.findIndex(it=>it.type==='layer'&&it.idx===eyeDragLayerIdx);
    const nextItem=dragFlatPos>=0?flat[dragFlatPos+1]:null;
    let isDirectlyBelow=nextItem&&nextItem.type==='layer'&&nextItem.idx===idx;
    // A layer inside a group can only target a sibling inside that SAME group (inside-to-inside only).
    // If it's the last layer in the group, whatever is directly below is outside -> blocked.
    if(isDirectlyBelow&&draggedInGroup&&nextItem._layerRef.groupId!==draggedLayer.groupId) isDirectlyBelow=false;
    // A layer outside any group can never target a layer that's inside a group (outside-to-inside blocked too).
    if(isDirectlyBelow&&!draggedInGroup&&nextItem._layerRef.groupId) isDirectlyBelow=false;
    if(!isNaN(idx)&&isDirectlyBelow){eyeDragTargetIdx=idx;eyeDragTargetGid=null;layerRow.classList.add('eye-drop-target');}
    else{eyeDragTargetIdx=null;eyeDragTargetGid=null;}
  } else if(groupRow){
    const gid=groupRow.dataset.gid;
    const grp=groups.find(g=>g.id===gid);
    // Only allow if this group is directly below the dragged layer in visual order
    const flat=_buildFlatDisplayItems();
    const dragFlatPos=flat.findIndex(it=>it.type==='layer'&&it.idx===eyeDragLayerIdx);
    const nextItem=dragFlatPos>=0?flat[dragFlatPos+1]:null;
    const isDirectlyBelow=nextItem&&nextItem.type==='group'&&nextItem.id===gid;
    // A layer inside a group can never target a group header (that's always outside its own group).
    if(grp&&isDirectlyBelow&&!draggedInGroup){eyeDragTargetGid=gid;eyeDragTargetIdx=null;groupRow.classList.add('eye-drop-target');}
    else{eyeDragTargetGid=null;}
  } else {eyeDragTargetIdx=null;eyeDragTargetGid=null;}
}
function onEyeDragUp(){
  eyeGhost.style.display='none';
  document.removeEventListener('pointermove',onEyeDragMove);
  document.removeEventListener('pointerup',onEyeDragUp);
  const targetLayerRow=document.querySelector('.layer-row.eye-drop-target[data-idx]');
  const targetGroupRow=document.querySelector('.layer-group-row.eye-drop-target[data-gid]');
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>r.classList.remove('eye-drop-target'));
  document.querySelectorAll('.layer-group-row[data-gid]').forEach(r=>r.classList.remove('eye-drop-target'));
  if(targetGroupRow){
    const gid=targetGroupRow.dataset.gid;
    const l=layers[eyeDragLayerIdx];
    if(l.clipToGroup===gid&&(l.stencil==='group-inside'||l.stencil==='group-outside')){
      l.clipToGroup=null;l.stencil='none';
    } else {
      l.clipToGroup=gid;l.clipTo=null;
      if(l.stencil!=='group-inside'&&l.stencil!=='group-outside') l.stencil='group-inside';
    }
    if(eyeDragLayerIdx===curLayer) syncOpacityControls();
    recomposite(curLayer,curFrame);renderLayerPanel();
  } else if(targetLayerRow){
    const idx=parseInt(targetLayerRow.dataset.idx);
    if(!isNaN(idx)&&idx!==eyeDragLayerIdx){
      const l=layers[eyeDragLayerIdx];
      if(l.clipTo===idx){l.clipTo=null;l.stencil='none';}
      else{l.clipTo=idx;l.clipToGroup=null;if(l.stencil==='none'||l.stencil==='group-inside'||l.stencil==='group-outside')l.stencil='inside';}
      if(eyeDragLayerIdx===curLayer) syncOpacityControls();
      recomposite(curLayer,curFrame);renderLayerPanel();
    }
  }
  eyeDragLayerIdx=null;eyeDragTargetIdx=null;eyeDragTargetGid=null;
}

// ── Eye-drag starting from a GROUP eye — drop onto a layer to clip that layer to the group
let eyeDragGroupId=null;
function startEyeDragGroup(gid,ev){
  eyeDragGroupId=gid;
  eyeGhost.style.display='block';
  eyeGhost.style.left=ev.clientX+'px';eyeGhost.style.top=ev.clientY+'px';
  // Mark every descendant of this group — its own layers AND any nested subgroups
  // (at any depth), plus their layers — as red/blocked for the duration of the drag,
  // since none of them can ever be a valid drop target. Rows only get marked if
  // they're actually in the DOM (i.e. not hidden behind a collapsed ancestor).
  const descendantIds=_allDescendantGroupIds(gid); // includes gid itself
  descendantIds.forEach(did=>{
    if(did!==gid){
      const grpRow=document.querySelector('.layer-group-row[data-gid="'+did+'"]');
      if(grpRow) grpRow.classList.add('eye-blocked');
    }
  });
  layers.forEach((l,i)=>{
    if(l.groupId&&descendantIds.has(l.groupId)){
      const row=document.querySelector('.layer-row[data-idx="'+i+'"]');
      if(row) row.classList.add('eye-blocked');
    }
  });
  document.addEventListener('pointermove',onEyeDragGroupMove);
  document.addEventListener('pointerup',onEyeDragGroupUp);
}
// Finds the item that sits directly below the group's ENTIRE block (header + all its
// children), i.e. the first thing truly outside the group — works the same whether the
// group's dropdown is expanded or collapsed, since _buildFlatDisplayItems() already
// omits children when collapsed.
function _findGroupEyeDropTarget(gid){
  const flat=_buildFlatDisplayItems();
  const headerPos=flat.findIndex(it=>it.type==='group'&&it.id===gid);
  if(headerPos<0) return null;
  const i=_groupBlockEnd(flat,headerPos);
  return i<flat.length?flat[i]:null;
}
function onEyeDragGroupMove(ev){
  eyeGhost.style.left=ev.clientX+'px';eyeGhost.style.top=ev.clientY+'px';
  eyeGhost._lastX=ev.clientX;eyeGhost._lastY=ev.clientY;
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>r.classList.remove('eye-drop-target'));
  document.querySelectorAll('.layer-group-row[data-gid]').forEach(r=>r.classList.remove('eye-drop-target'));
  eyeGhost.style.display='none';
  const el=document.elementFromPoint(ev.clientX,ev.clientY);
  eyeGhost.style.display='block';
  const layerRow=el&&el.closest('.layer-row[data-idx]');
  const groupRow=el&&el.closest('.layer-group-row[data-gid]');
  const target=_findGroupEyeDropTarget(eyeDragGroupId);
  if(layerRow){
    const idx=parseInt(layerRow.dataset.idx);
    const isValid=target&&target.type==='layer'&&target.idx===idx;
    if(isValid) layerRow.classList.add('eye-drop-target');
  } else if(groupRow){
    const gid=groupRow.dataset.gid;
    const isValid=target&&target.type==='group'&&target.id===gid&&gid!==eyeDragGroupId;
    if(isValid) groupRow.classList.add('eye-drop-target');
  }
}
function onEyeDragGroupUp(){
  eyeGhost.style.display='none';
  document.removeEventListener('pointermove',onEyeDragGroupMove);
  document.removeEventListener('pointerup',onEyeDragGroupUp);
  const targetRow=document.querySelector('.layer-row.eye-drop-target[data-idx]');
  const targetGroupRow=document.querySelector('.layer-group-row.eye-drop-target[data-gid]');
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>r.classList.remove('eye-drop-target','eye-blocked'));
  document.querySelectorAll('.layer-group-row[data-gid]').forEach(r=>r.classList.remove('eye-drop-target','eye-blocked'));
  if(targetGroupRow){
    // group→group: the dragged group gets clipped to the target group (mask = target)
    const gid=targetGroupRow.dataset.gid;
    const g=groups.find(gr=>gr.id===eyeDragGroupId);
    if(g){
      if(g.clipToGroup===gid&&g.stencil&&g.stencil!=='none'){
        g.clipToGroup=null;g.stencil='none';
      } else {
        g.clipToGroup=gid;
        if(g.stencil!=='inside'&&g.stencil!=='outside') g.stencil='inside';
      }
      recomposite(curLayer,curFrame);renderLayerPanel();
    }
  } else if(targetRow){
    // group→layer: the dragged group gets clipped to the target layer (mask = target layer)
    const idx=parseInt(targetRow.dataset.idx);
    if(!isNaN(idx)){
      const g=groups.find(gr=>gr.id===eyeDragGroupId);
      if(g){
        if(g.clipTo===idx&&(g.stencil==='inside'||g.stencil==='outside')){
          g.clipTo=null;g.stencil='none';
        } else {
          g.clipTo=idx;g.clipToGroup=null;
          if(g.stencil!=='inside'&&g.stencil!=='outside') g.stencil='inside';
        }
        recomposite(curLayer,curFrame);renderLayerPanel();
      }
    }
  }
  eyeDragGroupId=null;
}


function makeGroupId(){return 'g'+(Date.now())+Math.random().toString(36).slice(2,6);}

// ════════════════════════════════════════════════════════════════
// NESTED GROUPS (groups-of-groups) — helper utilities
// A group can now live inside another group via group.parentId (null = top level).
// These helpers walk that chain so the rest of the app can treat nesting depth
// generically instead of assuming a single flat level.
// ════════════════════════════════════════════════════════════════
function _groupById(gid){return groups.find(g=>g.id===gid)||null;}
// Chain of ancestor ids from root → gid (inclusive of gid itself)
function _groupChain(gid){
  const chain=[];let cur=_groupById(gid);const seen=new Set();
  while(cur&&!seen.has(cur.id)){seen.add(cur.id);chain.unshift(cur.id);cur=cur.parentId?_groupById(cur.parentId):null;}
  return chain;
}
function _groupDepth(gid){return Math.max(0,_groupChain(gid).length-1);}
// Is `gid` nested anywhere inside `ancestorId` (directly or transitively)?
function _isDescendantGroup(gid,ancestorId){
  let cur=_groupById(gid);const seen=new Set();
  while(cur&&cur.parentId&&!seen.has(cur.id)){seen.add(cur.id);if(cur.parentId===ancestorId) return true;cur=_groupById(cur.parentId);}
  return false;
}
// gid + every subgroup nested inside it, at any depth
function _allDescendantGroupIds(gid){
  const out=new Set([gid]);let changed=true;
  while(changed){changed=false;groups.forEach(g=>{if(g.parentId&&out.has(g.parentId)&&!out.has(g.id)){out.add(g.id);changed=true;}});}
  return out;
}
// Does this group (or any of its nested subgroups) directly contain at least one layer?
function _groupHasLayersInSubtree(gid){
  const ids=_allDescendantGroupIds(gid);
  return layers.some(l=>l.groupId&&ids.has(l.groupId));
}
// Combined visible/opacity of a layer through its FULL ancestor chain (not just direct parent)
function _layerGroupChainVisible(l){
  if(!l.groupId) return true;
  for(const gid of _groupChain(l.groupId)){const g=_groupById(gid);if(g&&!g.visible) return false;}
  return true;
}
function _layerGroupChainOpacity(l){
  if(!l.groupId) return 1;
  let op=1;for(const gid of _groupChain(l.groupId)){const g=_groupById(gid);if(g) op*=(g.opacity??1);}
  return op;
}
// Is any ancestor of this group (NOT the group itself) collapsed — i.e. is `gid`'s own
// header hidden because it lives inside a collapsed folder?
function _groupAncestorCollapsed(gid){
  const g=_groupById(gid);if(!g||!g.parentId) return false;
  let cur=_groupById(g.parentId);const seen=new Set();
  while(cur&&!seen.has(cur.id)){seen.add(cur.id);if(cur.collapsed) return true;cur=cur.parentId?_groupById(cur.parentId):null;}
  return false;
}
// Is this layer hidden from the panel because ANY ancestor group (at any depth) is collapsed?
function _layerHiddenByCollapse(l){
  if(!l.groupId) return false;
  let cur=_groupById(l.groupId);const seen=new Set();
  while(cur&&!seen.has(cur.id)){seen.add(cur.id);if(cur.collapsed) return true;cur=cur.parentId?_groupById(cur.parentId):null;}
  return false;
}
// Given a flat list (as produced by the builders below) and the flatPos of a group's
// header row, return the flatPos of the first item that is NOT part of that group's
// block (header + all its layers + all nested subgroups + their layers, recursively).
function _groupBlockEnd(flat,headerPos){
  const gid=flat[headerPos].id;
  const idSet=_allDescendantGroupIds(gid);
  let i=headerPos+1;
  while(i<flat.length){
    const it=flat[i];
    if(it.type==='layer'&&it._layerRef&&it._layerRef.groupId&&idSet.has(it._layerRef.groupId)){i++;continue;}
    if(it.type==='group'&&idSet.has(it.id)){i++;continue;}
    break;
  }
  return i;
}
// ── Unified flat-order builder, recursive-nesting aware. Walks layers[] top→bottom
// (highest array index first) and, for each layer, makes sure all of its ancestor
// group headers (outermost first) have been emitted before it — exactly generalizing
// the old single-level "insert group header before its first child" rule.
// opts.includeCollapsed: if true, children of collapsed groups are still included
// (used for structural operations like reorder/anchoring that must never lose items).
function _buildFlatGeneric(opts){
  opts=opts||{};
  const flat=[];
  const renderedGroups=new Set();
  function emitAncestors(gid){
    const g=_groupById(gid);if(!g) return;
    if(g.parentId) emitAncestors(g.parentId);
    if(renderedGroups.has(gid)) return;
    renderedGroups.add(gid);
    if(!opts.includeCollapsed&&_groupAncestorCollapsed(gid)) return; // hidden inside a collapsed folder
    flat.push({type:'group',id:gid,depth:_groupDepth(gid)});
  }
  for(let i=layers.length-1;i>=0;i--){
    const l=layers[i];
    if(l.groupId) emitAncestors(l.groupId);
    if(!opts.includeCollapsed&&_layerHiddenByCollapse(l)) continue;
    flat.push({type:'layer',idx:i,_layerRef:l,depth:l.groupId?_groupDepth(l.groupId)+1:0});
  }
  if(opts.includeOrphanGroups){
    // Groups with no layers anywhere in their subtree (e.g. a folder that only
    // contains other now-empty folders) still need a slot so they aren't lost.
    groups.forEach(g=>{if(!renderedGroups.has(g.id)&&!_groupHasLayersInSubtree(g.id)) emitAncestors(g.id);});
  }
  flat.forEach((it,fi)=>it.flatPos=fi);
  return flat;
}

// ── Drop-line indicator for layer reorder
let layerDropLineEl=null;
let layerDropTarget={idx:null,position:'after'}; // position: 'before'|'after'

function showDropLine(rowEl,position){
  // Always re-create if not currently in the DOM (e.g. after renderLayerPanel cleared innerHTML)
  const listEl=document.getElementById('layers-list');
  if(!layerDropLineEl||!layerDropLineEl.parentNode){
    layerDropLineEl=document.createElement('div');
    layerDropLineEl.style.cssText='position:absolute;left:0;right:0;height:2px;background:var(--red);z-index:100;pointer-events:none;border-radius:2px;box-shadow:0 0 4px rgba(226,75,74,0.6);';
    listEl.style.position='relative';
    listEl.appendChild(layerDropLineEl);
  }
  const listRect=listEl.getBoundingClientRect();
  const rowRect=rowEl.getBoundingClientRect();
  // Account for the scroll offset of the list container
  const scrollTop=listEl.scrollTop;
  // Anchor the line to the MIDPOINT of the gap between this row and its
  // neighbor on the relevant side, rather than to this row's own edge.
  // Rows are flat siblings of #layers-list, so the row on the other side
  // of the gap is simply the previous/next element sibling. Using only
  // rowEl's own edge meant the line's exact pixel position depended on
  // which of the two neighboring rows elementFromPoint happened to pick
  // (which flips based on the cursor's exact y within the gap), making
  // the indicator jitter up/down instead of staying fixed in the gap's center.
  const neighbor=position==='before'?rowEl.previousElementSibling:rowEl.nextElementSibling;
  let edge;
  if(neighbor){
    const nRect=neighbor.getBoundingClientRect();
    edge=position==='before'
      ?(rowRect.top+nRect.bottom)/2
      :(rowRect.bottom+nRect.top)/2;
  } else {
    edge=position==='before'?rowRect.top:rowRect.bottom;
  }
  const top=edge-listRect.top+scrollTop;
  layerDropLineEl.style.top=top+'px';
  layerDropLineEl.style.display='block';
}
function hideDropLine(){
  if(layerDropLineEl) layerDropLineEl.style.display='none';
}

// ── Rubber-band multi-select in layers panel
let lbSelecting=false,lbStartX=0,lbStartY=0;
let lbBoxEl=null;

function startLayerRubberBand(ev){
  if(ev.button!==0) return;
  lbSelecting=true;lbStartX=ev.clientX;lbStartY=ev.clientY;
  if(!lbBoxEl){
    lbBoxEl=document.createElement('div');
    lbBoxEl.style.cssText='position:fixed;border:1px solid var(--accent);background:rgba(127,119,221,0.08);z-index:9998;pointer-events:none;display:none;border-radius:2px;';
    document.body.appendChild(lbBoxEl);
  }
  lbBoxEl.style.left=lbStartX+'px';lbBoxEl.style.top=lbStartY+'px';
  lbBoxEl.style.width='0';lbBoxEl.style.height='0';lbBoxEl.style.display='block';
  document.addEventListener('pointermove',onLBMove);
  document.addEventListener('pointerup',onLBUp);
}
function onLBMove(ev){
  if(!lbSelecting) return;
  const x=Math.min(ev.clientX,lbStartX),y=Math.min(ev.clientY,lbStartY);
  const w=Math.abs(ev.clientX-lbStartX),h=Math.abs(ev.clientY-lbStartY);
  lbBoxEl.style.left=x+'px';lbBoxEl.style.top=y+'px';
  lbBoxEl.style.width=w+'px';lbBoxEl.style.height=h+'px';
  // Only update selection sets + visual classes; DO NOT call renderLayerPanel() (too expensive)
  const bx1=x,by1=y,bx2=x+w,by2=y+h;
  selectedLayerIndices.clear();selectedGroupIds.clear();
  const hitMap=new Map();
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>{
    const rr=r.getBoundingClientRect();
    const hit=!(rr.right<bx1||rr.left>bx2||rr.bottom<by1||rr.top>by2);
    const idx=parseInt(r.dataset.idx);
    if(hit) selectedLayerIndices.add(idx);
    hitMap.set(idx,hit);
  });
  document.querySelectorAll('.layer-row[data-idx]').forEach(r=>{
    const idx=parseInt(r.dataset.idx);
    const hit=hitMap.get(idx);
    // Bold the name if selected, unbold otherwise
    const nm=r.querySelector('.layer-name');
    if(nm) nm.style.fontWeight=hit?'700':'';
    // Live blue highlight while dragging (skip the currently-active row, which already has its own highlight)
    const isCurActive=idx===curLayer&&!activeGroupId;
    r.classList.toggle('layer-multi-sel',hit&&!isCurActive);
    // If curLayer's own row falls outside the selection box, drop its singular 'active' highlight
    // (it will be properly restored on the final renderLayerPanel() if it ends up still selected)
    if(isCurActive) r.classList.toggle('active',hit);
  });
  document.querySelectorAll('.layer-group-row[data-gid]').forEach(r=>{
    const rr=r.getBoundingClientRect();
    const hit=!(rr.right<bx1||rr.left>bx2||rr.bottom<by1||rr.top>by2);
    if(hit) selectedGroupIds.add(r.dataset.gid);
    const nm=r.querySelector('.layer-group-name');
    if(nm) nm.style.fontWeight=hit?'700':'';
    r.classList.toggle('multi-sel',hit);
  });
}
function onLBUp(){
  lbSelecting=false;
  if(lbBoxEl) lbBoxEl.style.display='none';
  document.removeEventListener('pointermove',onLBMove);
  document.removeEventListener('pointerup',onLBUp);
  // Rebuild once at the end to sync everything cleanly
  renderLayerPanel();
}

// ── Build the layer panel's visual row order: a flat top-to-bottom list of
// {type:'group',id} and {type:'layer',idx} entries, mirroring renderLayerPanel's
// own ordering exactly (group header inserted before its topmost member; members
// of a collapsed group are omitted). Used so shift range-select can tell which
// group rows fall between two layer rows and highlight them too.
function _buildPanelVisualOrder(){
  return _buildFlatGeneric({includeCollapsed:false});
}

// ── Main render function for layer panel
function renderLayerPanel(){
  const listEl=document.getElementById('layers-list');listEl.innerHTML='';
  syncOpacityControls();
  updateDelBtnLabel();
  // Show not-allowed cursor on canvas when a group folder is selected (can't draw into a group)
  activeC.style.cursor=activeGroupId?'not-allowed':'crosshair';

  // Remove empty groups (no layers anywhere in their subtree, including nested subgroups)
  groups=groups.filter(g=>_groupHasLayersInSubtree(g.id));
  // Any group that pointed at a now-removed parent becomes top-level instead of vanishing
  groups.forEach(g=>{if(g.parentId&&!groups.find(g2=>g2.id===g.parentId)) g.parentId=null;});
  if(activeGroupId&&!groups.find(g=>g.id===activeGroupId)) activeGroupId=null;

  const flat=_buildFlatDisplayItems();

  for(const entry of flat){
    if(entry.type==='group'){
      const grp=groups.find(g=>g.id===entry.id);
      if(grp) listEl.appendChild(makeGroupRow(grp,entry.depth));
      continue;
    }
    const i=entry.idx;
    const l=layers[i];
    const hiddenFromTl=l.onTimeline===false;
    const showUnhideBtn=hiddenFromTl&&l.visible;
    const grp=l.groupId?groups.find(g=>g.id===l.groupId):null;

    const hasMultiSel=selectedLayerIndices.size>0;
    const isMultiSel=selectedLayerIndices.has(i)&&i!==curLayer;
    const isCurActive=i===curLayer&&!activeGroupId&&(!hasMultiSel||selectedLayerIndices.has(curLayer));
    const row=document.createElement('div');
    row.className='layer-row'
      +(isCurActive?' active':'')
      +(isMultiSel?' layer-multi-sel':'')
      +(hiddenFromTl?' tl-hidden':'')
      +(l.groupId?' in-group':'')
      +(!_layerGroupChainVisible(l)?' group-hidden':'');
    row.dataset.idx=i;
    // Nested-group indentation: each ancestor level adds another step beyond the base .in-group padding
    if(entry.depth>1) row.style.paddingLeft=(18+(entry.depth-1)*16)+'px';
    if(l.color&&l.color!=='transparent'){const hex=l.color;const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);row.style.background=`rgba(${r},${g},${b},0.22)`;row.addEventListener('mouseenter',()=>{row.style.background=`rgba(${r},${g},${b},0.32)`;});row.addEventListener('mouseleave',()=>{row.style.background=`rgba(${r},${g},${b},0.22)`;});}

    const dotStyle=l.color&&l.color!=='transparent'?'background:'+l.color:'background:repeating-conic-gradient(#999 0% 25%,#ddd 0% 50%) 0 0/8px 8px;border:1px solid var(--border2);';
    const clipArrow=(l.clipTo!=null||l.clipToGroup!=null)?`<span class="layer-clip-arrow" title="Clipped ${(l.stencil==='outside'||l.stencil==='group-outside')?'outside':'inside'} ${l.clipToGroup!=null?'group':'layer'} below">${(l.stencil==='outside'||l.stencil==='group-outside')?'⬇out':'⬇in'}</span>`:'';
    const eyeVis=l.visible?'👁':'🚫';
    const eyeCls='layer-vis'+(l.visible?'':' vis-hidden');
    const layerOwnOp=l.opacity??1;
    const grpOp=_layerGroupChainOpacity(l);
    const effectiveOp=Math.round(layerOwnOp*grpOp*100);
    const opTag=layerOwnOp<1?`<span style="font-size:9px;color:var(--text2);flex-shrink:0;">${effectiveOp}%</span>`:'';

    // Row structure: [drag-zone: dot · name · badges (whole zone draggable)] [rb-zone: info · del · eye]
    const nameBold=isCurActive||selectedLayerIndices.has(i);
    row.innerHTML=
      `<span class="layer-drag-zone">${clipArrow}<div class="layer-dot" style="${dotStyle};cursor:pointer;" title="Click to change layer color"></div><span class="layer-name" title="${l.name}" style="${nameBold?'font-weight:700;color:var(--text);':''}">${l.name}</span>${showUnhideBtn?'<span class="layer-unhide" title="Restore to timeline">⤴</span>':''}</span>`+
      `<span class="layer-rb-zone">${opTag}`+
        `<span class="${eyeCls}" title="Toggle visibility / drag onto another layer to clip">${eyeVis}</span></span>`;

    // BUG FIX (pen/tablet: dragging a layer to reorder did nothing): this used
    // to listen only for 'mousedown'. Many pen-tablet drivers deliver input as
    // PointerEvents without ever firing the synthetic compatibility 'mousedown'
    // that a mouse would generate, so the whole drag never started for pen.
    // 'pointerdown' fires reliably for mouse, pen, AND touch, so it replaces
    // 'mousedown' as the single trigger (no need to listen for both — that
    // would just double-fire for real mice).
    row.querySelector('.layer-drag-zone').addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('layer-dot')) return;
      if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
      e.preventDefault();
      e.stopPropagation();
      startLayerDrag(i,e);
    });

    // Pointerdown on rb-zone (excluding eye, del, unhide) → start rubber-band
    row.querySelector('.layer-rb-zone').addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('layer-vis')||e.target.classList.contains('layer-unhide')) return;
      if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
      e.preventDefault();
      e.stopPropagation();
      startLayerRubberBand(e);
    });

    row.addEventListener('click',e=>{
      if(e.target.classList.contains('layer-dot')){e.stopPropagation();showLayerColorPicker(i,e.target);return;}
      if(e.target.classList.contains('layer-unhide')){e.stopPropagation();l.onTimeline=true;renderLayerPanel();renderTimeline();return;}
      if(e.target.classList.contains('layer-vis')) return;
      // Multi-select with ctrl/meta/shift
      if(e.ctrlKey||e.metaKey){
        // Toggle this layer; clear group selection
        selectedGroupIds.clear();activeGroupId=null;
        if(selectedLayerIndices.has(i)) selectedLayerIndices.delete(i);
        else selectedLayerIndices.add(i);
        layerShiftAnchor=i;groupShiftAnchor=null;
        renderLayerPanel();
      } else if(e.shiftKey){
        // Range select FROM anchor TO here — replace selection.
        // Walk the panel's actual visual row order (not raw index order) so any
        // group header rows sitting between the anchor and this row get selected too.
        // The anchor can be a layer OR a group, whichever was clicked most recently.
        selectedGroupIds.clear();activeGroupId=null;
        selectedLayerIndices.clear();
        const order=_buildPanelVisualOrder();
        const posOf=idx=>order.findIndex(o=>o.type==='layer'&&o.idx===idx);
        const posOfGroup=gid=>order.findIndex(o=>o.type==='group'&&o.id===gid);
        const posA=groupShiftAnchor!=null?posOfGroup(groupShiftAnchor):posOf(layerShiftAnchor??curLayer);
        const posB=posOf(i);
        if(posA===-1||posB===-1){
          // Fallback: anchor or current row no longer in panel (shouldn't normally happen)
          const anchor=layerShiftAnchor??curLayer;
          const a=Math.min(anchor,i),b=Math.max(anchor,i);
          for(let x=a;x<=b;x++) selectedLayerIndices.add(x);
        } else {
          const lo=Math.min(posA,posB),hi=Math.max(posA,posB);
          for(let x=lo;x<=hi;x++){
            const entry=order[x];
            if(entry.type==='layer') selectedLayerIndices.add(entry.idx);
            else selectedGroupIds.add(entry.id);
          }
        }
        renderLayerPanel();
      } else {
        // Plain click: select only this layer, clear groups
        selectedLayerIndices.clear();selectedGroupIds.clear();activeGroupId=null;
        layerShiftAnchor=i;groupShiftAnchor=null;
        switchLayer(i);
      }
    });

    // Eye: short click = toggle, drag = clip
    const eyeEl=row.querySelector('.layer-vis');
    if(eyeEl){
      eyeEl.addEventListener('pointerdown',e=>{
        if(e.button!==0) return;
        const startX=e.clientX,startY=e.clientY;
        let dragged=false;
        const onMove=mv=>{if(Math.abs(mv.clientX-startX)>5||Math.abs(mv.clientY-startY)>5){dragged=true;document.removeEventListener('pointermove',onMove);startEyeDrag(i,mv);}};
        const onUp=()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);if(!dragged){l.visible=!l.visible;l.onTimeline=l.visible;recomposite(curLayer,curFrame);renderLayerPanel();renderTimeline();}};
        document.addEventListener('pointermove',onMove);
        document.addEventListener('pointerup',onUp);
        e.stopPropagation();e.preventDefault();
      });
    }

    // Dot: color picker
    const dotEl=row.querySelector('.layer-dot');
    if(dotEl) dotEl.addEventListener('click',e=>{e.stopPropagation();showLayerColorPicker(i,e.currentTarget);});

    // Right-click: layer panel context menu
    row.addEventListener('contextmenu',e=>{
      e.preventDefault();e.stopPropagation();
      _layerCtxTargetIdx=i;_layerCtxTargetGid=null;
      if(i!==curLayer) switchLayer(i);
      layerCtxMenu.classList.remove('mode-group');layerCtxMenu.classList.add('mode-layer');
      layerCtxMenu.style.left=Math.min(e.clientX,window.innerWidth-160)+'px';layerCtxMenu.style.top=Math.min(e.clientY,window.innerHeight-120)+'px';
      layerCtxMenu.classList.add('visible');
    });

    // Double-click name: rename layer
    row.addEventListener('dblclick',e=>{
      const nameSpan=e.target.closest('.layer-name');
      if(!nameSpan) return;
      e.stopPropagation();
      _startLayerRename(i,null);
    });

    listEl.appendChild(row);
  }

  // Click/pointerdown on bare list area: clear selection or start rubber-band
  listEl.addEventListener('pointerdown',e=>{
    const onRow=e.target.closest('.layer-row[data-idx],.layer-group-row[data-gid]');
    if(onRow) return; // rows handle their own events
    if(e.button!==0) return;
    // Clear selection on pointerdown on blank space; rubber-band will re-select if dragged
    selectedLayerIndices.clear();selectedGroupIds.clear();activeGroupId=null;
    renderLayerPanel();
    startLayerRubberBand(e);
  },{once:true,capture:false});
}

// ── Re-anchor all layer and group stencils to their direct visual neighbor below.
// Call after any structural change (add, delete, reorder).
function _reanchorAllStencils(){
  const flat=_buildFlatDisplayItemsAll();
  // Layers
  layers.forEach((l,newIdx)=>{
    if(l.stencil==='none') return;
    const flatPos=flat.findIndex(it=>it.type==='layer'&&it.idx===newIdx);
    const below=flatPos>=0?flat[flatPos+1]:null;
    if(!below){l.clipTo=null;l.clipToGroup=null;l.stencil='none';}
    else if(below.type==='layer'){
      l.clipTo=below.idx;l.clipToGroup=null;
      if(l.stencil==='group-inside'||l.stencil==='group-outside') l.stencil='inside';
    } else if(below.type==='group'){
      l.clipToGroup=below.id;l.clipTo=null;
      if(l.stencil==='inside'||l.stencil==='outside') l.stencil='group-inside';
      else if(l.stencil==='group-outside') l.stencil='group-outside';
    }
  });
  // Groups
  groups.forEach(g=>{
    if(!g.stencil||g.stencil==='none') return;
    const headerPos=flat.findIndex(it=>it.type==='group'&&it.id===g.id);
    if(headerPos<0){g.clipTo=null;g.clipToGroup=null;g.stencil='none';return;}
    // Find first item below the group's entire block (header + all children + nested subgroups)
    const i=_groupBlockEnd(flat,headerPos);
    const below=i<flat.length?flat[i]:null;
    if(!below){g.clipTo=null;g.clipToGroup=null;g.stencil='none';}
    else if(below.type==='layer'){
      g.clipTo=below.idx;g.clipToGroup=null;
      if(g.stencil==='inside'||g.stencil==='outside') {} // keep as-is
      else g.stencil='inside';
    } else if(below.type==='group'){
      g.clipToGroup=below.id;g.clipTo=null;
      if(g.stencil==='inside'||g.stencil==='outside') {} // keep as-is
      else g.stencil='inside';
    }
  });
}

// ── Build a flat list of items in visual panel order (top to bottom)
// Each item: {type:'layer',idx,_layerRef} or {type:'group',id,flatPos}
function _buildFlatDisplayItems(){
  return _buildFlatGeneric({includeCollapsed:false});
}

// Same as above but NEVER skips collapsed group children — used for group drag reorder
function _buildFlatDisplayItemsAll(){
  return _buildFlatGeneric({includeCollapsed:true,includeOrphanGroups:true});
}

// ── Autoscroll for layer drag
let _autoScrollRAF=null,_autoScrollEl=null,_autoScrollSpeed=0;
function _startAutoScroll(el){_autoScrollEl=el;if(_autoScrollRAF) return;const step=()=>{if(!_autoScrollEl||_autoScrollSpeed===0){_autoScrollRAF=null;return;}; _autoScrollEl.scrollTop+=_autoScrollSpeed;_autoScrollRAF=requestAnimationFrame(step);};_autoScrollRAF=requestAnimationFrame(step);}
function _stopAutoScroll(){_autoScrollEl=null;_autoScrollSpeed=0;if(_autoScrollRAF){cancelAnimationFrame(_autoScrollRAF);_autoScrollRAF=null;}}
function _updateAutoScroll(clientY){const list=document.getElementById('layers-list');if(!list){_stopAutoScroll();return;}const r=list.getBoundingClientRect();const zone=40;if(clientY<r.top+zone){_autoScrollSpeed=-Math.max(2,Math.round((zone-(clientY-r.top))/4));_startAutoScroll(list);}else if(clientY>r.bottom-zone){_autoScrollSpeed=Math.max(2,Math.round((zone-(r.bottom-clientY))/4));_startAutoScroll(list);}else{_stopAutoScroll();}}

// ── Manual drag-to-reorder for layer rows (with red drop line)
let manualDragIdx=null;
let manualDragActive=false;

function startLayerDrag(idx,downEv){
  if(downEv.pointerType==='pen'?(!(downEv.buttons&1)):(downEv.button!==0)) return;
  document.body.classList.remove('layer-dragging');
  manualDragIdx=idx;manualDragActive=false;
  const startX=downEv.clientX,startY=downEv.clientY;

  const onMove=ev=>{
    if(!manualDragActive&&(Math.abs(ev.clientX-startX)>4||Math.abs(ev.clientY-startY)>4)){
      manualDragActive=true;
      document.body.classList.add('layer-dragging');
    }
    if(!manualDragActive) return;
    _updateAutoScroll(ev.clientY);
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    let row=el&&(el.closest('.layer-row[data-idx]')||el.closest('.layer-group-row[data-gid]'));
    // A layer can't be a meaningful drop target against itself — most
    // relevant when dragging the bottommost row further down (e.g. out of
    // a group sitting at the very bottom of the list): without this, the
    // dragged row's own row got picked up as the "nearest"/hovered target,
    // making the drop a no-op that looked like the layer snapping back
    // into the group instead of moving outside it.
    if(row&&!row.hasAttribute('data-gid')&&parseInt(row.dataset.idx)===idx) row=null;
    if(row){
      const rr=row.getBoundingClientRect();
      const isGrpRow=row.hasAttribute('data-gid');
      let pos,dropMode;
      if(isGrpRow){
        const grpObj=groups.find(g=>g.id===row.dataset.gid);
        // Group row: top 30% = before (reorder), bottom 30% = after (reorder), middle 40% = into (join)
        const relY=(ev.clientY-rr.top)/rr.height;
        if(relY<0.30){pos='before';dropMode='reorder';}
        else if(relY>0.70){pos='after';dropMode='reorder';}
        else{pos='into';dropMode='into';}
      } else {
        pos=ev.clientY<rr.top+rr.height/2?'before':'after';
        dropMode='reorder';
      }
      layerDropTarget={idx:isGrpRow?row.dataset.gid:parseInt(row.dataset.idx),isGroup:isGrpRow,position:pos,dropMode};
      if(dropMode==='into'){
        // Highlight the group row instead of showing drop line
        hideDropLine();
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      } else {
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        showDropLine(row,pos);
      }
    } else {
      // Cursor isn't directly over any row (e.g. in the small gap between two rows,
      // or above/below the whole list) — snap to whichever row is actually closest
      // to the cursor, not just "first vs last". Exclude the dragged row itself so
      // it can never "snap to itself" and silently cancel the move.
      const allRows=[...document.querySelectorAll('#layers-list .layer-row[data-idx], #layers-list .layer-group-row[data-gid]')]
        .filter(r=>!(!r.hasAttribute('data-gid')&&parseInt(r.dataset.idx)===idx));
      if(allRows.length){
        let nearest=allRows[0],nearestDist=Infinity;
        for(const r of allRows){
          const rr=r.getBoundingClientRect();
          const mid=(rr.top+rr.bottom)/2;
          const dist=Math.abs(ev.clientY-mid);
          if(dist<nearestDist){nearestDist=dist;nearest=r;}
        }
        const nr=nearest.getBoundingClientRect();
        const clampRow=nearest;
        const clampPos=ev.clientY<(nr.top+nr.bottom)/2?'before':'after';
        const isGrp=clampRow.hasAttribute('data-gid');
        layerDropTarget={idx:isGrp?clampRow.dataset.gid:parseInt(clampRow.dataset.idx),isGroup:isGrp,position:clampPos,dropMode:'reorder'};
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        showDropLine(clampRow,clampPos);
      } else {
        layerDropTarget={idx:null,position:'after'};
        hideDropLine();
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
      }
    }
  };
  const onUp=ev=>{
    document.body.classList.remove('layer-dragging');
    _stopAutoScroll();
    hideDropLine();
    document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
    if(!manualDragActive){manualDragIdx=null;return;}
    if(layerDropTarget.idx!=null){
      const dragIdx=manualDragIdx;
      const pos=layerDropTarget.position;
      const draggedLayer=layers[dragIdx];
      const selfDrop=!layerDropTarget.isGroup&&layerDropTarget.idx===dragIdx;
      if(!selfDrop){
        // Always use the full flat list (includes collapsed children) so nothing gets lost
        const flatFull=_buildFlatDisplayItemsAll();
        const dragFlatIdx=flatFull.findIndex(it=>it.type==='layer'&&it.idx===dragIdx);
        if(dragFlatIdx>=0){
          let insertSlot,joinGroupId=null;
          if(layerDropTarget.isGroup&&layerDropTarget.dropMode==='into'){
            // Drop INTO group: insert right after the group header in the flat list
            const grpFlatIdx=flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx);
            if(grpFlatIdx<0){manualDragIdx=null;manualDragActive=false;layerDropTarget={idx:null,position:'after'};renderLayerPanel();renderTimeline();return;}
            insertSlot=grpFlatIdx+1;
            joinGroupId=layerDropTarget.idx;
          } else {
            const targetFlatIdx=layerDropTarget.isGroup
              ?flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx)
              :flatFull.findIndex(it=>it.type==='layer'&&it.idx===layerDropTarget.idx);
            if(targetFlatIdx<0){manualDragIdx=null;manualDragActive=false;layerDropTarget={idx:null,position:'after'};renderLayerPanel();renderTimeline();return;}
            // When dropping 'after' a group row, skip past all its children so the layer lands outside
            let effectiveSlot=pos==='before'?targetFlatIdx:targetFlatIdx+1;
            if(layerDropTarget.isGroup&&pos==='after'){
              const grpHeaderIdx=flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx);
              if(grpHeaderIdx>=0) effectiveSlot=_groupBlockEnd(flatFull,grpHeaderIdx);
            }
            insertSlot=effectiveSlot;
          }

          // NOTE: previously this whole block (including the groupId
          // inference) only ran when the flat position actually changed.
          // But dragging a group's last/only child straight down and out
          // (e.g. a bottommost group) can resolve to the exact same slot
          // it already occupies — the intent is purely "ungroup me", with
          // no reorder needed. Skipping the block in that case silently
          // dropped the groupId change too, making it look like the layer
          // snapped back into the group. So this now always runs; splicing
          // an item back into the same slot is a harmless no-op.
          {
            // Build the new flat order
            const newFlat=flatFull.filter((_,fi)=>fi!==dragFlatIdx);
            const removedBefore=dragFlatIdx<insertSlot?1:0;
            const adjSlot=Math.max(0,Math.min(newFlat.length,insertSlot-removedBefore));
            newFlat.splice(adjSlot,0,flatFull[dragFlatIdx]);

            // Infer groupId: walk backwards from the inserted item's position;
            // track whether we are inside a group's section.
            // A layer is inside group G if, scanning upward, we hit G's header
            // before hitting any ungrouped layer or the list start.
            if(joinGroupId!==null){
              // Explicit join
              draggedLayer.groupId=joinGroupId;
            } else {
              // Infer from context: scan upward in newFlat from inserted position
              const newPos=newFlat.findIndex(it=>it.type==='layer'&&it._layerRef===draggedLayer);
              let inferredGroup=null;
              let foundGroup=false;
              for(let fi=newPos-1;fi>=0;fi--){
                const nb=newFlat[fi];
                if(nb.type==='group'){inferredGroup=nb.id;foundGroup=true;break;}
                if(nb.type==='layer'){
                  inferredGroup=nb._layerRef.groupId??null;
                  foundGroup=true;
                  break;
                }
              }
              // Boundary fix: if item below has a DIFFERENT group (or none) than what we
              // inferred from above, we are sitting at a group boundary seam.
              // Use the drop target's context to resolve which side we land on.
              if(foundGroup&&inferredGroup!==null){
                const itemBelow=newFlat[newPos+1];
                if(itemBelow&&itemBelow.type==='layer'){
                  const belowGroup=itemBelow._layerRef.groupId??null;
                  if(belowGroup!==inferredGroup){
                    // At a seam: if we dropped 'after' a target layer use below-context
                    if(!layerDropTarget.isGroup){
                      inferredGroup=pos==='after'?belowGroup:inferredGroup;
                    } else {
                      inferredGroup=belowGroup;
                    }
                  }
                } else if(itemBelow&&itemBelow.type==='group'){
                  // Dropped right above a group header — we land as a sibling of
                  // that group, i.e. inside whatever group *it* belongs to (its
                  // parentId), not unconditionally outside every group. Using
                  // null here was wrong for nested groups: dropping just above a
                  // child group (e.g. above Group 1 inside Group 2) incorrectly
                  // popped the layer all the way out to the top level instead of
                  // keeping it inside the parent group.
                  const belowGrpObj=groups.find(g=>g.id===itemBelow.id);
                  inferredGroup=belowGrpObj?belowGrpObj.parentId:null;
                } else if(!itemBelow){
                  // Dropped at the very bottom of the list — outside any group
                  inferredGroup=null;
                }
              }
              draggedLayer.groupId=foundGroup?inferredGroup:null;
            }

            // Rebuild layers[] from newFlat layer order (newFlat is top→bottom; layers[] is bottom→top)
            const newLayersOrdered=newFlat.filter(it=>it.type==='layer').map(it=>it._layerRef);
            newLayersOrdered.reverse();
            // Save active canvas to current layer before rebuilding so no drawing is lost
            saveActiveToKey();
            layers.length=0;
            newLayersOrdered.forEach(l=>layers.push(l));
            // Stencil/clip always targets the item immediately below in visual order.
            // After reordering, re-point any active clip at the new neighbor below (layer or group).
            _reanchorAllStencils();
            curLayer=layers.indexOf(draggedLayer);
            if(curLayer<0) curLayer=0;
            // Load the dragged layer's own content into activeC so it matches the new curLayer
            loadFrame(curLayer,curFrame);
          }
        }
        selectedLayerIndices.clear();
      }
    }
    manualDragIdx=null;manualDragActive=false;
    layerDropTarget={idx:null,position:'after'};
    recomposite(curLayer,curFrame);renderLayerPanel();renderTimeline();
  };
  function _cleanupLayerDrag(ev){ onUp(ev); document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',_cleanupLayerDrag); document.removeEventListener('pointercancel',_cleanupLayerDrag); }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',_cleanupLayerDrag);
  document.addEventListener('pointercancel',_cleanupLayerDrag);
}

// ── Manual drag-to-PLACE for the "+ Layer" button. Same tracking/visuals as
// startLayerDrag (red drop-line, group "into" highlight, auto-scroll, clamp to
// first/last row) but on release it creates a brand-new layer at the dropped
// position instead of moving an existing one. A plain click (no real drag)
// falls through to the normal add-layer-btn click behavior.
let addLayerDragActive=false;
function startAddLayerDrag(downEv){
  if(downEv.button!==0) return;
  addLayerDragActive=false;
  const startX=downEv.clientX,startY=downEv.clientY;
  // BUG FIX (pen/tablet: "+ Layer" tap with a group selected never showed the
  // placement modal): pen input reports several pixels of jitter even on a
  // dead-stationary tap — far more than a mouse click does. The old flat 4px
  // threshold treated that jitter as a real drag, which skipped the plain-click
  // path (_addLayerBtnClick, below) that shows the modal, and fell into the
  // drag-insert logic instead. Give pen a much more forgiving threshold so a
  // genuine tap is still recognized as a click.
  const MOVE_THRESHOLD=downEv.pointerType==='pen'?14:4;

  const onMove=ev=>{
    if(!addLayerDragActive&&(Math.abs(ev.clientX-startX)>MOVE_THRESHOLD||Math.abs(ev.clientY-startY)>MOVE_THRESHOLD)){
      addLayerDragActive=true;
    }
    if(!addLayerDragActive) return;
    _updateAutoScroll(ev.clientY);
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const row=el&&(el.closest('.layer-row[data-idx]')||el.closest('.layer-group-row[data-gid]'));
    if(row){
      const rr=row.getBoundingClientRect();
      const isGrpRow=row.hasAttribute('data-gid');
      let pos,dropMode;
      if(isGrpRow){
        // Group row: top 30% = before (reorder), bottom 30% = after (reorder), middle 40% = into (join)
        const relY=(ev.clientY-rr.top)/rr.height;
        if(relY<0.30){pos='before';dropMode='reorder';}
        else if(relY>0.70){pos='after';dropMode='reorder';}
        else{pos='into';dropMode='into';}
      } else {
        pos=ev.clientY<rr.top+rr.height/2?'before':'after';
        dropMode='reorder';
      }
      layerDropTarget={idx:isGrpRow?row.dataset.gid:parseInt(row.dataset.idx),isGroup:isGrpRow,position:pos,dropMode};
      if(dropMode==='into'){
        hideDropLine();
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      } else {
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        showDropLine(row,pos);
      }
    } else {
      // Cursor isn't directly over any row (e.g. in the small gap between two rows,
      // or above/below the whole list) — snap to whichever row is actually closest
      // to the cursor, not just "first vs last".
      const allRows=[...document.querySelectorAll('#layers-list .layer-row[data-idx], #layers-list .layer-group-row[data-gid]')];
      if(allRows.length){
        let nearest=allRows[0],nearestDist=Infinity;
        for(const r of allRows){
          const rr=r.getBoundingClientRect();
          const mid=(rr.top+rr.bottom)/2;
          const dist=Math.abs(ev.clientY-mid);
          if(dist<nearestDist){nearestDist=dist;nearest=r;}
        }
        const nr=nearest.getBoundingClientRect();
        const clampRow=nearest;
        const clampPos=ev.clientY<(nr.top+nr.bottom)/2?'before':'after';
        const isGrp=clampRow.hasAttribute('data-gid');
        layerDropTarget={idx:isGrp?clampRow.dataset.gid:parseInt(clampRow.dataset.idx),isGroup:isGrp,position:clampPos,dropMode:'reorder'};
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
        showDropLine(clampRow,clampPos);
      } else {
        layerDropTarget={idx:null,position:'after'};
        hideDropLine();
        document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
      }
    }
  };
  const onUp=ev=>{
    _stopAutoScroll();
    hideDropLine();
    document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
    if(!addLayerDragActive){
      // No real drag — behave exactly like a normal click on the Add Layer button
      addLayerDragActive=false;
      layerDropTarget={idx:null,position:'after'};
      _addLayerBtnClick('bitmap');
      return;
    }
    if(layerDropTarget.idx!=null){
      saveActiveToKey();
      const newLayer={name:'Layer '+(layers.length+1),visible:true,onTimeline:true,color:'transparent',frames:{},frameMeta:{},indexFrames:{},indexMeta:{},type:'bitmap',opacity:1,stencil:'none',clipTo:null,groupId:null};
      const flatFull=_buildFlatDisplayItemsAll();
      let insertSlot,joinGroupId=null;
      if(layerDropTarget.isGroup&&layerDropTarget.dropMode==='into'){
        // Drop INTO group: insert right after the group header in the flat list
        const grpFlatIdx=flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx);
        if(grpFlatIdx>=0){insertSlot=grpFlatIdx+1;joinGroupId=layerDropTarget.idx;}
      } else {
        const targetFlatIdx=layerDropTarget.isGroup
          ?flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx)
          :flatFull.findIndex(it=>it.type==='layer'&&it.idx===layerDropTarget.idx);
        if(targetFlatIdx>=0){
          const pos=layerDropTarget.position;
          let effectiveSlot=pos==='before'?targetFlatIdx:targetFlatIdx+1;
          // When dropping 'after' a group row, skip past all its children so the new layer lands outside
          if(layerDropTarget.isGroup&&pos==='after'){
            const grpHeaderIdx=flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx);
            if(grpHeaderIdx>=0) effectiveSlot=_groupBlockEnd(flatFull,grpHeaderIdx);
          }
          insertSlot=effectiveSlot;
        }
      }
      if(insertSlot!=null){
        if(joinGroupId!==null){
          newLayer.groupId=joinGroupId;
        } else {
          // Infer target group from context: scan upward from the insert slot
          // the same way startLayerDrag infers it for a moved layer.
          let inferredGroup=null;
          for(let fi=insertSlot-1;fi>=0;fi--){
            const nb=flatFull[fi];
            if(nb.type==='group'){inferredGroup=nb.id;break;}
            if(nb.type==='layer'){inferredGroup=nb._layerRef.groupId??null;break;}
          }
          // Boundary fix: if the item right below the insert point has a different
          // group (or none), prefer its context when we dropped 'before' it.
          const itemBelow=flatFull[insertSlot];
          if(itemBelow&&itemBelow.type==='layer'){
            const belowGroup=itemBelow._layerRef.groupId??null;
            if(belowGroup!==inferredGroup&&!layerDropTarget.isGroup&&layerDropTarget.position==='before'){
              inferredGroup=belowGroup;
            }
          } else if(!itemBelow||itemBelow.type==='group'){
            inferredGroup=null;
          }
          newLayer.groupId=inferredGroup;
        }
        // Convert the flat insert slot (top→bottom, includes group headers which
        // don't occupy array slots) into a layers[] array index (bottom→top) by
        // counting how many actual layer entries sit above the insert point.
        let layersAbove=0;
        for(let fi=0;fi<insertSlot;fi++) if(flatFull[fi].type==='layer') layersAbove++;
        const arrIdx=layers.length-layersAbove;
        layers.splice(arrIdx,0,newLayer);
        _reanchorAllStencils();
        curLayer=layers.indexOf(newLayer);
        selectedLayerIndices.clear();
        loadFrame(curLayer,curFrame);
      }
    }
    addLayerDragActive=false;
    layerDropTarget={idx:null,position:'after'};
    recomposite(curLayer,curFrame);renderLayerPanel();renderTimeline();
  };
  function _cleanupPtrDrag(ev){ onUp(ev); document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',_cleanupPtrDrag); document.removeEventListener('pointercancel',_cleanupPtrDrag); try{downEv.target.releasePointerCapture(ev.pointerId);}catch(err){} }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',_cleanupPtrDrag);
  document.addEventListener('pointercancel',_cleanupPtrDrag);
}

function makeGroupRow(grp,depth){
  depth=depth||0;
  const row=document.createElement('div');
  const isActive=activeGroupId===grp.id;
  const isMultiSel=selectedGroupIds.has(grp.id);
  const isChildActive=!isActive&&!activeGroupId&&layers[curLayer]&&layers[curLayer].groupId===grp.id;
  // No background highlight in layer panel for groups — bold name only
  row.className='layer-group-row'+(isActive?' active':'')+(isChildActive?' child-active':'')+(isMultiSel?' multi-sel':'');
  row.dataset.gid=grp.id;
  if(depth>0) row.style.marginLeft=(depth*16)+'px';
  if(grp.color&&grp.color!=='transparent'){
    const hex=grp.color;const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    if(isChildActive){
      row.style.background=`rgba(${r},${g},${b},0.18)`;
      row.style.borderColor=`rgba(${r},${g},${b},0.7)`;
    } else {
      row.style.background=`rgba(${r},${g},${b},0.22)`;
    }
    row.addEventListener('mouseenter',()=>{row.style.background=`rgba(${r},${g},${b},0.32)`;});
    row.addEventListener('mouseleave',()=>{row.style.background=isChildActive?`rgba(${r},${g},${b},0.18)`:`rgba(${r},${g},${b},0.22)`;});
  }
  const eyeVis=grp.visible?'👁':'🚫';
  const eyeCls='layer-group-vis'+(grp.visible?'':' vis-hidden');
  const hasChildren=layers.some(l=>l.groupId===grp.id)||groups.some(g=>g.parentId===grp.id);
  const chevron=grp.collapsed?'▶':'▼';
  const toggleStyle=hasChildren?'':'visibility:hidden;pointer-events:none;';
  const opPct=Math.round((grp.opacity??1)*100);
  const opTag=opPct<100?`<span style="font-size:9px;color:var(--text2);flex-shrink:0;">${opPct}%</span>`:'';
  const nameBold=isActive||isMultiSel;
  const grpDotStyle=grp.color&&grp.color!=='transparent'?'background:'+grp.color:'background:repeating-conic-gradient(#999 0% 25%,#ddd 0% 50%) 0 0/8px 8px;border:1px solid var(--border2);';
  const grpClipArrow=((grp.clipToGroup!=null||grp.clipTo!=null)&&grp.stencil&&grp.stencil!=='none')?`<span class="layer-clip-arrow" title="Clipped ${grp.stencil==='outside'?'outside':'inside'} ${grp.clipToGroup!=null?'group':'layer'} below">${grp.stencil==='outside'?'⬇out':'⬇in'}</span>`:'';
  row.innerHTML=
    `<span class="layer-drag-zone">${grpClipArrow}<span class="layer-group-toggle" style="${toggleStyle}">${chevron}</span><div class="layer-dot" style="${grpDotStyle};cursor:pointer;" title="Click to change group color"></div><span class="layer-group-icon">📁</span><span class="layer-group-name" style="${nameBold?'font-weight:700;color:var(--text);':''}">${grp.name}</span></span>`+
    `<span class="layer-rb-zone">${opTag}<span class="${eyeCls}">${eyeVis}</span></span>`;
  row.querySelector('.layer-group-toggle').onclick=e=>{e.stopPropagation();grp.collapsed=!grp.collapsed;renderLayerPanel();renderTimeline();};
  const grpEyeEl=row.querySelector('.layer-group-vis');
  if(grpEyeEl){
    grpEyeEl.addEventListener('pointerdown',e=>{
      if(e.button!==0) return;
      const startX=e.clientX,startY=e.clientY;
      let dragged=false;
      const onMove=mv=>{if(Math.abs(mv.clientX-startX)>5||Math.abs(mv.clientY-startY)>5){dragged=true;document.removeEventListener('pointermove',onMove);startEyeDragGroup(grp.id,mv);}};
      const onUp=()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);if(!dragged){grp.visible=!grp.visible;recomposite(curLayer,curFrame);renderLayerPanel();}};
      document.addEventListener('pointermove',onMove);
      document.addEventListener('pointerup',onUp);
      e.stopPropagation();e.preventDefault();
    });
  }
  const grpDotEl=row.querySelector('.layer-dot');
  if(grpDotEl) grpDotEl.addEventListener('click',e=>{e.stopPropagation();showGroupColorPicker(grp,e.currentTarget);});
  // Drag-zone: whole zone starts reorder (excluding toggle)
  row.querySelector('.layer-drag-zone').addEventListener('pointerdown',e=>{
    if(e.target.classList.contains('layer-group-toggle')||e.target.classList.contains('layer-dot')) return;
    if(e.target.closest('.layer-group-name')?.contentEditable==='true') return;
    if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
    e.preventDefault();
    e.stopPropagation();
    startGroupDrag(grp.id,e);
  });
  // rb-zone: start rubber-band (excluding eye)
  row.querySelector('.layer-rb-zone').addEventListener('pointerdown',e=>{
    if(e.target.classList.contains('layer-group-vis')) return;
    if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
    e.preventDefault();
    e.stopPropagation();
    startLayerRubberBand(e);
  });
  // Click to select (blue highlight) — clear ALL layer selections when clicking a group
  row.addEventListener('click',e=>{
    if(e.target.classList.contains('layer-group-vis')||e.target.classList.contains('layer-group-toggle')||e.target.classList.contains('drag-handle')||e.target.classList.contains('layer-dot')) return;
    if(row.querySelector('.layer-group-name').contentEditable==='true') return;
    if(e.ctrlKey||e.metaKey){
      // Toggle this group; don't touch layer selection
      if(selectedGroupIds.has(grp.id)) selectedGroupIds.delete(grp.id);
      else {selectedGroupIds.add(grp.id);selectedLayerIndices.clear();}
      groupShiftAnchor=grp.id;layerShiftAnchor=null;
      renderLayerPanel();
    } else if(e.shiftKey){
      // Range select FROM anchor TO here — replace selection.
      // Mirrors the layer row's shift-click: walk the panel's visual row order
      // so any layers AND group rows between the anchor and this group get selected.
      selectedGroupIds.clear();activeGroupId=null;
      selectedLayerIndices.clear();
      const order=_buildPanelVisualOrder();
      const posOf=idx=>order.findIndex(o=>o.type==='layer'&&o.idx===idx);
      const posOfGroup=gid=>order.findIndex(o=>o.type==='group'&&o.id===gid);
      const posA=groupShiftAnchor!=null?posOfGroup(groupShiftAnchor):posOf(layerShiftAnchor??curLayer);
      const posB=posOfGroup(grp.id);
      if(posA===-1||posB===-1){
        // Fallback: anchor no longer in panel (shouldn't normally happen)
        selectedGroupIds.add(grp.id);
      } else {
        const lo=Math.min(posA,posB),hi=Math.max(posA,posB);
        for(let x=lo;x<=hi;x++){
          const entry=order[x];
          if(entry.type==='layer') selectedLayerIndices.add(entry.idx);
          else selectedGroupIds.add(entry.id);
        }
      }
      renderLayerPanel();
    } else {
      // Plain click: only this group active, clear everything else
      selectedGroupIds.clear();selectedLayerIndices.clear();layerShiftAnchor=null;
      groupShiftAnchor=grp.id;
      activeGroupId=grp.id;
      renderLayerPanel();
    }
  });
  row.addEventListener('dblclick',e=>{
    const nameSpan=e.target.closest('.layer-group-name');
    if(!nameSpan) return;
    e.stopPropagation();
    _startLayerRename(null,grp.id);
  });
  row.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();_layerCtxTargetIdx=null;_layerCtxTargetGid=grp.id;layerCtxMenu.classList.remove('mode-layer');layerCtxMenu.classList.add('mode-group');layerCtxMenu.style.left=Math.min(e.clientX,window.innerWidth-160)+'px';layerCtxMenu.style.top=Math.min(e.clientY,window.innerHeight-120)+'px';layerCtxMenu.classList.add('visible');});
  // Drop layers onto group to add them
  row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over');});
  row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
  row.addEventListener('drop',e=>{
    e.preventDefault();row.classList.remove('drag-over');
    if(manualDragIdx===null&&dragLayerIdx===null) return;
    const idx=manualDragIdx??dragLayerIdx;
    if(idx!=null) layers[idx].groupId=grp.id;
    renderLayerPanel();renderTimeline();
  });
  return row;
}

// ── Group drag reorder (unified with layer rows — groups can move between layers)
let groupDragId=null,groupDragActive=false;
function startGroupDrag(gid,downEv){
  if(downEv.pointerType==='pen'?(!(downEv.buttons&1)):(downEv.button!==0)) return;
  document.body.classList.remove('layer-dragging');
  groupDragId=gid;groupDragActive=false;
  const startX=downEv.clientX,startY=downEv.clientY;
  const descendantIds=_allDescendantGroupIds(gid); // includes gid itself — used to block circular nesting
  const onMove=ev=>{
    if(!groupDragActive&&(Math.abs(ev.clientX-startX)>4||Math.abs(ev.clientY-startY)>4)){
      groupDragActive=true;
      document.body.classList.add('layer-dragging');
    }
    if(!groupDragActive) return;
    _updateAutoScroll(ev.clientY);
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    let row=el&&(el.closest('.layer-group-row[data-gid]')||el.closest('.layer-row[data-idx]'));
    // Nothing inside the group being dragged (its own header, nested
    // subgroups, or their layers) can be a meaningful drop target — most
    // relevant when the group sits at the very bottom of the list and you
    // drag it/its contents further down: without this, its own subtree got
    // picked up as the "nearest"/hovered target, which silently canceled
    // the move (looked like it snapping back into place).
    const isOwnSubtree=r=>{
      if(!r) return false;
      if(r.hasAttribute('data-gid')) return descendantIds.has(r.dataset.gid);
      const li=parseInt(r.dataset.idx);
      return layers[li]&&descendantIds.has(layers[li].groupId);
    };
    if(isOwnSubtree(row)) row=null;
    document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
    if(row){
      const rr=row.getBoundingClientRect();
      const isGrpRow=row.hasAttribute('data-gid');
      // A group can't be dropped into itself or any of its own (nested) subgroups
      const targetIsSelfOrDescendant=isGrpRow&&descendantIds.has(row.dataset.gid);
      let pos,dropMode;
      if(isGrpRow&&!targetIsSelfOrDescendant){
        // Top 30% = before, bottom 30% = after, middle 40% = nest INTO the target group
        const relY=(ev.clientY-rr.top)/rr.height;
        if(relY<0.30){pos='before';dropMode='reorder';}
        else if(relY>0.70){pos='after';dropMode='reorder';}
        else{pos='into';dropMode='into';}
      } else {
        pos=ev.clientY<rr.top+rr.height/2?'before':'after';
        dropMode='reorder';
      }
      if(targetIsSelfOrDescendant){
        layerDropTarget={idx:null,position:'after'};
        hideDropLine();
      } else if(dropMode==='into'){
        hideDropLine();
        row.classList.add('drag-over');
        layerDropTarget={idx:row.dataset.gid,isGroup:true,position:pos,dropMode};
      } else {
        layerDropTarget={idx:isGrpRow?row.dataset.gid:parseInt(row.dataset.idx),isGroup:isGrpRow,position:pos,dropMode};
        showDropLine(row,pos);
      }
    } else {
      // Cursor isn't directly over any row (e.g. in the small gap between two rows,
      // or above/below the whole list) — snap to whichever row is actually closest
      // to the cursor, not just "first vs last". Exclude the dragged group's own
      // subtree so it can never "snap to itself" and silently cancel the move.
      const allRows=[...document.querySelectorAll('#layers-list .layer-row[data-idx], #layers-list .layer-group-row[data-gid]')]
        .filter(r=>!isOwnSubtree(r));
      if(allRows.length){
        let nearest=allRows[0],nearestDist=Infinity;
        for(const r of allRows){
          const rr=r.getBoundingClientRect();
          const mid=(rr.top+rr.bottom)/2;
          const dist=Math.abs(ev.clientY-mid);
          if(dist<nearestDist){nearestDist=dist;nearest=r;}
        }
        const nr=nearest.getBoundingClientRect();
        const clampRow=nearest;
        const clampPos=ev.clientY<(nr.top+nr.bottom)/2?'before':'after';
        const isGrp=clampRow.hasAttribute('data-gid');
        if(isGrp&&descendantIds.has(clampRow.dataset.gid)){
          layerDropTarget={idx:null,position:'after'};hideDropLine();
        } else {
          layerDropTarget={idx:isGrp?clampRow.dataset.gid:parseInt(clampRow.dataset.idx),isGroup:isGrp,position:clampPos,dropMode:'reorder'};
          showDropLine(clampRow,clampPos);
        }
      } else {layerDropTarget={idx:null};hideDropLine();}
    }
  };
  const onUp=()=>{
    document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.removeEventListener('pointercancel',onUp);
    document.body.classList.remove('layer-dragging');
    _stopAutoScroll();
    hideDropLine();
    document.querySelectorAll('.layer-group-row').forEach(r=>r.classList.remove('drag-over'));
    if(!groupDragActive){groupDragId=null;return;}
    if(layerDropTarget.idx!=null&&!(layerDropTarget.isGroup&&descendantIds.has(layerDropTarget.idx))){
      const pos=layerDropTarget.position;
      const dropMode=layerDropTarget.dropMode||'reorder';
      const grpObj=groups.find(g=>g.id===gid);
      if(!grpObj){groupDragId=null;groupDragActive=false;return;}

      // Build flat list that ALWAYS includes children (ignore collapsed for this purpose)
      // We need a version that includes all children even if group is collapsed
      const flatFull=_buildFlatDisplayItemsAll();

      const targetFlatIdx=layerDropTarget.isGroup
        ?flatFull.findIndex(it=>it.type==='group'&&it.id===layerDropTarget.idx)
        :flatFull.findIndex(it=>it.type==='layer'&&it.idx===layerDropTarget.idx);

      if(targetFlatIdx>=0){
        // Check not dropping inside this group's own subtree (header, nested subgroups, or their layers)
        const ownFlatIdxs=new Set(flatFull
          .filter(it=>(it.type==='group'&&descendantIds.has(it.id))||(it.type==='layer'&&layers[it.idx]&&descendantIds.has(layers[it.idx].groupId)))
          .map(it=>it.flatPos));
        if(!ownFlatIdxs.has(targetFlatIdx)){
          let insertSlot;
          if(dropMode==='into'){
            // Nest right inside the target group, as its new topmost child
            insertSlot=targetFlatIdx+1;
          } else {
            // When dropping 'after' a target group, skip past its ENTIRE block (including
            // any nested subgroups of its own) first, so the dragged group lands fully outside it.
            insertSlot=pos==='before'?targetFlatIdx:targetFlatIdx+1;
            if(pos==='after'&&layerDropTarget.isGroup){
              insertSlot=_groupBlockEnd(flatFull,targetFlatIdx);
            }
          }

          // Items to move: this group's header + its ENTIRE subtree (nested subgroups + all their layers)
          const movingFlatIdxs=new Set();
          flatFull.forEach((it,fi)=>{
            if(it.type==='group'&&descendantIds.has(it.id)) movingFlatIdxs.add(fi);
            if(it.type==='layer'&&layers[it.idx]&&descendantIds.has(layers[it.idx].groupId)) movingFlatIdxs.add(fi);
          });

          const remaining=flatFull.filter((_,fi)=>!movingFlatIdxs.has(fi));
          const moving=flatFull.filter((_,fi)=>movingFlatIdxs.has(fi));
          const removedBefore=[...movingFlatIdxs].filter(fi=>fi<insertSlot).length;
          const adjSlot=Math.max(0,Math.min(remaining.length,insertSlot-removedBefore));
          const newFlat=[...remaining.slice(0,adjSlot),...moving,...remaining.slice(adjSlot)];

          // Determine the dragged group's new parentId directly from the
          // target we dropped on/near, rather than re-scanning the rebuilt
          // array. Scanning "what's directly above me now" broke when the
          // moved group WAS the target group's only remaining content:
          // dropping "after" a group's entire block (to land beside it,
          // not inside it) would re-place the moved group right where it
          // used to sit, and the array-scan then misread "a group header
          // sits right above me" as "I'm nested inside it" — snapping the
          // group right back where it started instead of moving it out.
          if(dropMode==='into'){
            grpObj.parentId=layerDropTarget.idx;
          } else if(layerDropTarget.isGroup){
            // Before/after a group target → same nesting level as that group.
            const targetGrp=groups.find(g=>g.id===layerDropTarget.idx);
            grpObj.parentId=targetGrp?(targetGrp.parentId||null):null;
          } else {
            // Before/after a layer target → same group as that layer, UNLESS
            // we're at a seam: if we dropped 'after' a layer that happens to
            // be the last item inside its group, landing there is actually
            // "just past the end of that group's block", i.e. outside it —
            // not nested inside it. Without this check, dragging a group out
            // from the bottom of its parent (e.g. below the parent's last
            // sibling layer) kept re-inferring the parent group and the
            // dragged group looked permanently "stuck" inside it.
            const targetLayer=layers[layerDropTarget.idx];
            let newParent=targetLayer?(targetLayer.groupId||null):null;
            if(targetLayer&&pos==='after'&&newParent!==null){
              // "Next real item" = the next item in the ORIGINAL flat list that
              // isn't part of the group we're moving (its own subtree is being
              // relocated, so it doesn't count toward the seam check).
              const targetFlatPos=flatFull.findIndex(it=>it.type==='layer'&&it.idx===layerDropTarget.idx);
              let ni=targetFlatPos+1;
              while(ni<flatFull.length&&((flatFull[ni].type==='group'&&descendantIds.has(flatFull[ni].id))||(flatFull[ni].type==='layer'&&layers[flatFull[ni].idx]&&descendantIds.has(layers[flatFull[ni].idx].groupId)))) ni++;
              const nextReal=ni<flatFull.length?flatFull[ni]:undefined;
              if(!nextReal){
                newParent=null; // dropped after the very last real item — top level
              } else if(nextReal.type==='layer'){
                newParent=layers[nextReal.idx]?(layers[nextReal.idx].groupId||null):null;
              } else if(nextReal.type==='group'){
                // Next real item is a group header — we're sitting right at the
                // end of our old group's block, so we land alongside whatever
                // group *that* header belongs to (its parentId).
                const nextGrpObj=groups.find(g=>g.id===nextReal.id);
                newParent=nextGrpObj?(nextGrpObj.parentId||null):null;
              }
            }
            grpObj.parentId=newParent;
          }

          // Rebuild layers[] and groups[] from newFlat
          const newLayers=[];
          const newGroups=[];
          const seenGroups=new Set();
          newFlat.forEach(it=>{
            if(it.type==='group'&&!seenGroups.has(it.id)){
              seenGroups.add(it.id);
              const g=groups.find(g=>g.id===it.id);
              if(g) newGroups.push(g);
            } else if(it.type==='layer'){
              newLayers.push(layers[it.idx]);
            }
          });
          groups.forEach(g=>{if(!seenGroups.has(g.id)) newGroups.push(g);});

          // newFlat is top-to-bottom; layers[] is bottom-to-top
          newLayers.reverse();
          // Save active canvas before rebuilding so no drawing is lost
          saveActiveToKey();
          const prevCurLayerRef=layers[curLayer];
          layers.length=0;newLayers.forEach(l=>layers.push(l));
          groups.length=0;newGroups.forEach(g=>groups.push(g));
          // Stencil/clip always targets the item immediately below in visual order.
          // After reordering, re-point any active clip (layers and groups) at the new neighbor below.
          _reanchorAllStencils();
          // Find curLayer's new index by object reference so activeC loads the right content
          const newCurIdx=layers.indexOf(prevCurLayerRef);
          curLayer=newCurIdx>=0?newCurIdx:Math.max(0,Math.min(layers.length-1,curLayer));
          loadFrame(curLayer,curFrame);
        }
      }
    }
    groupDragId=null;groupDragActive=false;
    layerDropTarget={idx:null,position:'after'};
    recomposite(curLayer,curFrame);renderLayerPanel();renderTimeline();
  };
  document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp);document.addEventListener('pointercancel',onUp);
}


function showGroupOpacityPopup(grp,cx,cy){
  const popup=document.createElement('div');
  popup.innerHTML=`<div style="font-size:10px;color:var(--text2);font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Group: ${grp.name}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <label style="font-size:10px;color:var(--text2);">Opacity</label>
      <input type="range" min="0" max="100" value="${Math.round((grp.opacity??1)*100)}" style="flex:1;accent-color:var(--accent);"/>
      <span style="font-size:10px;color:var(--text2);min-width:28px;text-align:right;">${Math.round((grp.opacity??1)*100)}%</span>
    </div>`;
  const sl=popup.querySelector('input[type=range]');const vl=popup.querySelector('span:last-child');
  sl.oninput=()=>{grp.opacity=sl.value/100;vl.textContent=sl.value+'%';recomposite(curLayer,curFrame);renderLayerPanel();};
  document.body.appendChild(popup);
  setTimeout(()=>{
    function co(ev){if(!popup.contains(ev.target)){popup.remove();document.removeEventListener('click',co,true);}}
    document.addEventListener('click',co,true);
  },0);
}

function _doAddLayer(placement,layerType){
  const type=layerType==='smart-raster'?'smart-raster':'bitmap';
  saveActiveToKey();
  const newLayer={name:'Layer '+(layers.length+1),visible:true,onTimeline:true,color:'transparent',frames:{},frameMeta:{},indexFrames:{},indexMeta:{},type,opacity:1,stencil:'none',clipTo:null,groupId:null};
  let insertAt=layers.length;
  let targetGroupId=null;

  if(placement==='inside'&&activeGroupId){
    targetGroupId=activeGroupId;
  } else if(placement==='inside'&&curLayer!=null&&layers[curLayer]&&layers[curLayer].groupId){
    targetGroupId=layers[curLayer].groupId;
  }

  if(targetGroupId){
    let topIdx=-1;
    layers.forEach((l,i)=>{if(l.groupId===targetGroupId&&i>topIdx) topIdx=i;});
    insertAt=topIdx>=0?topIdx+1:layers.length;
    newLayer.groupId=targetGroupId;
  } else if(placement==='outside'&&activeGroupId){
    // Insert right after the group's ENTIRE subtree (including any nested
    // subgroups and their layers), as a sibling of the group itself — i.e.
    // outside the selected group, but still inside whatever group (if any)
    // the selected group itself lives in.
    const fullIds=_allDescendantGroupIds(activeGroupId);
    let topIdx=-1;
    layers.forEach((l,i)=>{if(l.groupId&&fullIds.has(l.groupId)&&i>topIdx) topIdx=i;});
    insertAt=topIdx>=0?topIdx+1:layers.length;
    const grpObj=groups.find(g=>g.id===activeGroupId);
    newLayer.groupId=grpObj?(grpObj.parentId||null):null;
  } else if(curLayer!=null&&layers[curLayer]&&layers[curLayer].groupId){
    // Selected layer is inside a group — insert directly above the selected layer (same group)
    newLayer.groupId=layers[curLayer].groupId;
    insertAt=curLayer+1;
  } else if(curLayer!=null&&layers[curLayer]){
    insertAt=curLayer+1;
  }

  layers.splice(insertAt,0,newLayer);
  // Re-anchor all stencils to their visual neighbor below after the insertion.
  _reanchorAllStencils();
  curLayer=insertAt;selectedLayerIndices.clear();activeGroupId=null;
  loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();
  if(window.PaletteDocker&&typeof window.PaletteDocker.refresh==='function') window.PaletteDocker.refresh();
}

let _pendingAddLayerType='bitmap';
function _addLayerBtnClick(layerType){
  _pendingAddLayerType=layerType==='smart-raster'?'smart-raster':'bitmap';
  if(activeGroupId){
    const grp=groups.find(g=>g.id===activeGroupId);
    document.getElementById('modal-add-layer-placement-msg').textContent='Where do you want to add the new layer relative to "'+( grp?grp.name:'the group')+'"?';
    document.querySelector('input[name="add-layer-placement"][value="inside"]').checked=true;
    document.getElementById('modal-add-layer-placement').classList.add('visible');
  } else {
    _doAddLayer('outside',_pendingAddLayerType);
  }
}
// TEMP: drag-to-place disabled for "+ Layer" to isolate whether the drag
// logic itself was fighting with tap detection on pen. Now a plain click/tap
// that always goes straight to _addLayerBtnClick (modal when a group is
// selected, direct add otherwise). Re-enable by restoring the pointerdown
// listener that calls startAddLayerDrag(e) if drag-to-place is wanted back.
document.getElementById('add-layer-btn').addEventListener('click',e=>{
  _addLayerBtnClick('bitmap');
});
document.getElementById('add-smart-raster-btn').addEventListener('click',()=>{
  _addLayerBtnClick('smart-raster');
});
document.getElementById('modal-add-layer-placement-cancel').onclick=()=>document.getElementById('modal-add-layer-placement').classList.remove('visible');
document.getElementById('modal-add-layer-placement-ok').onclick=()=>{
  const placement=document.querySelector('input[name="add-layer-placement"]:checked')?.value||'inside';
  document.getElementById('modal-add-layer-placement').classList.remove('visible');
  _doAddLayer(placement,_pendingAddLayerType);
};
document.getElementById('modal-add-layer-placement').addEventListener('click',e=>{if(e.target===document.getElementById('modal-add-layer-placement'))document.getElementById('modal-add-layer-placement').classList.remove('visible');});

// Figures out which parent group (if any) the new group should be nested inside,
// based on what's currently selected. Returns null for top-level, or a single
// groupId if every selected layer/group shares the same parent — this is what
// keeps "group a layer that's inside Group 1" from kicking the new group out
// to the top level.
function _computeNewGroupParentId(){
  const parentCandidates=new Set();
  if(selectedLayerIndices.size>0){
    selectedLayerIndices.forEach(i=>{if(layers[i]) parentCandidates.add(layers[i].groupId||null);});
  }
  if(selectedGroupIds.size>0){
    selectedGroupIds.forEach(gid=>{
      const g=groups.find(g2=>g2.id===gid);
      if(!g) return;
      const hasSelectedAncestor=_groupChain(gid).slice(0,-1).some(aid=>selectedGroupIds.has(aid));
      if(!hasSelectedAncestor) parentCandidates.add(g.parentId||null);
    });
  }
  if(selectedLayerIndices.size===0&&selectedGroupIds.size===0){
    parentCandidates.add(layers[curLayer]?(layers[curLayer].groupId||null):null);
  }
  return parentCandidates.size===1?[...parentCandidates][0]:null;
}

// Wraps the current selection (layers and/or groups) in a brand-new group,
// nesting that new group inside whatever parent the selection shared (see
// _computeNewGroupParentId) instead of always dropping it at the top level.
function _createGroupFromSelection(parentId){
  const id=makeGroupId();
  const name='Group '+(groups.length+1);
  groups.push({id,name,visible:true,collapsed:false,opacity:1,color:'transparent',stencil:'none',clipToGroup:null,parentId:parentId||null});
  // Collect layers to group: selected layers (directly) + selected groups become NESTED subfolders
  const toGroupLayers=new Set();
  if(selectedLayerIndices.size>0){
    selectedLayerIndices.forEach(i=>toGroupLayers.add(i));
  }
  // Selected groups become subgroups (folders inside the new folder) rather than being
  // absorbed/flattened — only re-parent the topmost selected ones, so a group whose
  // ancestor is also selected doesn't get its parentId overwritten twice.
  if(selectedGroupIds.size>0){
    selectedGroupIds.forEach(gid=>{
      const g=groups.find(g2=>g2.id===gid);
      if(!g) return;
      const hasSelectedAncestor=_groupChain(gid).slice(0,-1).some(aid=>selectedGroupIds.has(aid));
      if(!hasSelectedAncestor) g.parentId=id;
    });
  }
  // If nothing selected at all, just group curLayer
  if(toGroupLayers.size===0&&selectedGroupIds.size===0) toGroupLayers.add(curLayer);
  toGroupLayers.forEach(i=>{if(layers[i]) layers[i].groupId=id;});
  selectedLayerIndices.clear();selectedGroupIds.clear();activeGroupId=id;
  _reanchorAllStencils();
  renderLayerPanel();renderTimeline();
  return id;
}

// Creates a brand-new (empty, aside from one starter layer) group nested
// directly inside targetGroupId — used by the "Insert group inside this
// group" option in the group-action modal.
function _insertGroupInsideGroup(targetGroupId){
  saveActiveToKey();
  const id=makeGroupId();
  const name='Group '+(groups.length+1);
  groups.push({id,name,visible:true,collapsed:false,opacity:1,color:'transparent',stencil:'none',clipToGroup:null,parentId:targetGroupId});
  const newLayer={name:'Layer '+(layers.length+1),visible:true,onTimeline:true,color:'transparent',frames:{},frameMeta:{},indexFrames:{},indexMeta:{},type:'bitmap',opacity:1,stencil:'none',clipTo:null,groupId:id};
  let topIdx=-1;
  layers.forEach((l,i)=>{if(l.groupId===targetGroupId&&i>topIdx) topIdx=i;});
  const insertAt=topIdx>=0?topIdx+1:layers.length;
  layers.splice(insertAt,0,newLayer);
  curLayer=insertAt;selectedLayerIndices.clear();selectedGroupIds.clear();activeGroupId=id;
  _reanchorAllStencils();
  loadFrame(curLayer,curFrame);
  renderLayerPanel();renderTimeline();
}

// Wraps one specific existing group (gid) in a brand-new parent group, placing
// the new parent where gid used to sit (so it doesn't get bumped to the top level).
function _wrapSingleGroup(gid){
  const g=groups.find(g2=>g2.id===gid);
  if(!g) return;
  const id=makeGroupId();
  const name='Group '+(groups.length+1);
  groups.push({id,name,visible:true,collapsed:false,opacity:1,color:'transparent',stencil:'none',clipToGroup:null,parentId:g.parentId||null});
  g.parentId=id;
  selectedLayerIndices.clear();selectedGroupIds.clear();activeGroupId=id;
  _reanchorAllStencils();
  renderLayerPanel();renderTimeline();
}

document.getElementById('add-group-btn').onclick=()=>{
  // Figure out if exactly one group is "selected" — either via ctrl/shift multi-select
  // (selectedGroupIds) or via a plain click, which only sets activeGroupId and leaves
  // selectedGroupIds empty. Either way, with no layers selected, ask the user whether
  // they want to wrap that group or insert a new one inside it.
  let singleGroupId=null;
  if(selectedLayerIndices.size===0){
    if(selectedGroupIds.size===1) singleGroupId=[...selectedGroupIds][0];
    else if(selectedGroupIds.size===0&&activeGroupId) singleGroupId=activeGroupId;
  }
  if(singleGroupId){
    const grp=groups.find(g=>g.id===singleGroupId);
    const modal=document.getElementById('modal-group-action');
    document.getElementById('modal-group-action-msg').textContent='What do you want to do with "'+(grp?grp.name:'this group')+'"?';
    document.querySelector('input[name="group-action"][value="wrap"]').checked=true;
    modal.dataset.targetGroupId=singleGroupId;
    modal.classList.add('visible');
    return;
  }
  _createGroupFromSelection(_computeNewGroupParentId());
};

document.getElementById('modal-group-action-cancel').onclick=()=>document.getElementById('modal-group-action').classList.remove('visible');
document.getElementById('modal-group-action').addEventListener('click',e=>{if(e.target===document.getElementById('modal-group-action'))document.getElementById('modal-group-action').classList.remove('visible');});
document.getElementById('modal-group-action-ok').onclick=()=>{
  const modal=document.getElementById('modal-group-action');
  const targetGroupId=modal.dataset.targetGroupId;
  const action=document.querySelector('input[name="group-action"]:checked')?.value||'wrap';
  modal.classList.remove('visible');
  if(!targetGroupId) return;
  if(action==='insert') _insertGroupInsideGroup(targetGroupId);
  else _wrapSingleGroup(targetGroupId);
};