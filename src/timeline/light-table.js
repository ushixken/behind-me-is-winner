// ════════════════════════════════════════════════════════════════
// LIGHT TABLE — Phase 1 + Phase 2 + Phase 3
//
// A manual animation-reference system, deliberately kept separate from
// Onion Skin, normal layers, normal Transform, and Timeline editing.
//
// A "reference" never stores a destructive copy of a drawing. Instead it
// stores stable pointers back to the source: the actual layer object and
// the actual keyframe canvas object. Object-identity references are used
// (via WeakMaps below) so a reference stays correct even if the source
// drawing's frame index changes — it does NOT depend on the current
// frame index the way a raw (layerIndex, frameIndex) pair would.
//
// Phase 1 implemented insertion, single selection, visibility toggling
// and rendering. Phase 1 explicitly did NOT implement: transform, tint,
// opacity, locking, drag-and-drop, multi-selection, alignment, flipping,
// or project persistence.
//
// Phase 2 added, on top of the list (never touching source drawings,
// Timeline frames, keyframes, layers or exposure lengths):
//   - multi-selection (Click / Ctrl+Click)
//   - range selection (Shift+Click)
//   - batch deletion (Delete button / Delete key)
//   - keyboard selection controls (Ctrl+A, Escape)
//   - list reordering by dragging a row directly, matching the Layers panel
//
// Phase 3 adds independent per-reference DISPLAY properties, still only
// ever affecting the Light Table preview — never the source drawing:
//   - locked (blocks opacity/tint edits for that reference; selection,
//     visibility, delete and reorder remain unaffected)
//   - opacity (0–100%, default 50%)
//   - tint colour, preserving the reference's own alpha shape. Tint is
//     always active — there is no enable/disable toggle for it.
// Changing opacity/tint applies to every currently selected UNLOCKED
// reference at once. Transform, flip, align, persistence and undo/redo
// remain out of scope. References still live only in memory for this
// session, and Insert remains the only way to add references (no
// Timeline drag-and-drop).
//
// Phase 3A refines the property UI on top of the above: newly inserted
// references now default to 50% opacity / black tint, the old Tint
// enable checkbox is gone (tint is unconditionally on), the tint swatch
// reuses the app's themed colour swatch + mini colour picker (never a
// browser-native <input type="color">), and the Opacity control reuses
// the exact same slider + click-to-edit numeric field used by Brush
// Size/Flow/Hardness (.ts-range/.ts-value-edit), laid out in one row as
// [Tint Swatch] Opacity [Slider] [Editable Number].
// ════════════════════════════════════════════════════════════════
(function(){

  // ── Stable identity ──────────────────────────────────────────────
  let _idCounter=1;
  const _layerIds=new WeakMap();
  const _drawingIds=new WeakMap();
  function layerIdOf(layer){
    if(!_layerIds.has(layer)) _layerIds.set(layer,'lt-layer-'+(_idCounter++));
    return _layerIds.get(layer);
  }
  function drawingIdOf(canvas){
    if(!_drawingIds.has(canvas)) _drawingIds.set(canvas,'lt-drawing-'+(_idCounter++));
    return _drawingIds.get(canvas);
  }

  // references: ordered array of
  // { id, layer, layerId, drawing, drawingId, layerNameSnapshot,
  //   frameIndexSnapshot, hidden,
  //   locked, opacity, tintColor }
  // List order == render stacking order (top of list renders above).
  // locked/opacity/tintColor are Light-Table-only DISPLAY properties
  // (Phase 3) — they never touch the source drawing/layer. Tint is
  // always applied (no enable flag); opacity defaults to 50% and tint
  // defaults to black on insertion (Phase 3A).
  const DEFAULT_OPACITY=50;
  const DEFAULT_TINT_COLOR='#000000';
  let references=[];
  let _refCounter=1;

  function isLayerAlive(layer){
    return typeof layers!=='undefined'&&layers.indexOf(layer)!==-1;
  }
  function isDrawingAlive(ref){
    if(!isLayerAlive(ref.layer)) return false;
    const frames=ref.layer.frames;
    for(const k in frames){ if(frames[k]===ref.drawing) return true; }
    return false;
  }
  function isMissing(ref){ return !isDrawingAlive(ref); }
  function currentFrameIndexOf(ref){
    if(!isLayerAlive(ref.layer)) return null;
    const frames=ref.layer.frames;
    for(const k in frames){ if(frames[k]===ref.drawing) return Number(k); }
    return null;
  }

  // ── Resolve "the currently selected Timeline drawing/keyframe" ─────
  function resolveSelectedSource(){
    let li=curLayer,fi=curFrame;
    if(typeof selectedKFs!=='undefined'&&selectedKFs.size){
      const first=selectedKFs.values().next().value;
      const parts=first.split(':');
      li=Number(parts[0]);fi=Number(parts[1]);
    }
    const layer=layers[li];
    if(!layer) return null;
    let ownerFrame=-1,drawing=null;
    for(let f=fi;f>=0;f--){
      if(layer.frames[f]){ownerFrame=f;drawing=layer.frames[f];break;}
    }
    if(!drawing) return null;
    return {layer,layerIndex:li,drawing,ownerFrame};
  }

  // ── Selection state ──────────────────────────────────────────────
  // Light Table selection is entirely local to this docker. It must
  // never touch the Timeline's curLayer/curFrame/selectedKFs, the
  // active layer, or Onion Skin.
  const selectedIds=new Set();
  let anchorId=null; // the "pivot" reference id used by Shift+Click ranges

  function clearSelection(){
    if(selectedIds.size===0) return;
    selectedIds.clear();
    renderList();
  }
  function selectOnly(id){
    selectedIds.clear();
    selectedIds.add(id);
    anchorId=id;
    renderList();
  }
  function toggleInSelection(id){
    if(selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    // Per spec, only a plain Click updates the anchor — Ctrl+Click does not.
    renderList();
  }
  function selectRange(toId){
    if(!anchorId||!references.some(r=>r.id===anchorId)){
      selectOnly(toId);
      return;
    }
    const fromIdx=references.findIndex(r=>r.id===anchorId);
    const toIdx=references.findIndex(r=>r.id===toId);
    if(fromIdx===-1||toIdx===-1) return;
    const lo=Math.min(fromIdx,toIdx),hi=Math.max(fromIdx,toIdx);
    selectedIds.clear();
    for(let i=lo;i<=hi;i++) selectedIds.add(references[i].id);
    renderList();
  }
  function selectAll(){
    if(references.length===0) return;
    references.forEach(r=>selectedIds.add(r.id));
    if(anchorId==null&&references.length) anchorId=references[references.length-1].id;
    renderList();
  }
  function pruneInvalidSelection(){
    let changed=false;
    selectedIds.forEach(id=>{
      if(!references.some(r=>r.id===id)){ selectedIds.delete(id); changed=true; }
    });
    if(anchorId!=null&&!references.some(r=>r.id===anchorId)){ anchorId=null; }
    return changed;
  }

  // ── Insert / Delete ─────────────────────────────────────────────
  function insertSelected(){
    const src=resolveSelectedSource();
    if(!src) return null;
    const existing=references.find(r=>r.layer===src.layer&&r.drawing===src.drawing);
    if(existing){
      selectOnly(existing.id);
      return existing;
    }
    const ref={
      id:'lt-ref-'+(_refCounter++),
      layer:src.layer,
      layerId:layerIdOf(src.layer),
      drawing:src.drawing,
      drawingId:drawingIdOf(src.drawing),
      layerNameSnapshot:src.layer.name,
      frameIndexSnapshot:src.ownerFrame,
      hidden:false,
      locked:false,
      opacity:DEFAULT_OPACITY,
      tintColor:DEFAULT_TINT_COLOR,
    };
    references.push(ref);
    selectedIds.clear();
    selectedIds.add(ref.id);
    anchorId=ref.id;
    renderList();
    requestRepaint();
    return ref;
  }
  // Removes every currently-selected Light Table reference. Used by both
  // the Delete button and the Delete key. Only Light Table entries are
  // touched — source drawings, Timeline frames, keyframes, layers and
  // exposure lengths are never modified.
  function deleteSelected(){
    if(selectedIds.size===0) return;
    const toDelete=selectedIds;
    references=references.filter(r=>!toDelete.has(r.id));
    selectedIds.clear();
    anchorId=null;
    renderList();
    requestRepaint();
  }
  function deleteReference(id){
    const idx=references.findIndex(r=>r.id===id);
    if(idx===-1) return;
    references.splice(idx,1);
    selectedIds.delete(id);
    if(anchorId===id) anchorId=null;
    renderList();
    requestRepaint();
  }
  // Back-compat single-selection entry point (Phase 1 API shape) — now
  // implemented in terms of the multi-selection model above.
  function selectReference(id,opts){
    selectOnly(id);
  }
  function toggleVisibility(id){
    const ref=references.find(r=>r.id===id);
    if(!ref) return;
    ref.hidden=!ref.hidden;
    renderList();
    requestRepaint();
  }

  // ── Phase 3: Lock ────────────────────────────────────────────────
  // Locking only blocks display-property edits (opacity/tint) for now.
  // Selection, visibility, delete and reorder are explicitly still
  // allowed on a locked reference — locking is per spec NOT a general
  // "freeze this row" toggle yet. Transform restrictions come later.
  function toggleLock(id){
    const ref=references.find(r=>r.id===id);
    if(!ref) return;
    ref.locked=!ref.locked;
    renderList();
  }

  // ── Phase 3: Opacity / Tint ─────────────────────────────────────
  // Both apply to every currently selected UNLOCKED reference at once
  // (a single selection is just the n=1 case of that). Locked references
  // in the selection are left completely untouched. Neither ever writes
  // to ref.drawing/ref.layer — these are Light-Table-only preview
  // properties consumed by render() below.
  function _selectedUnlockedRefs(){
    return references.filter(r=>selectedIds.has(r.id)&&!r.locked);
  }
  function setSelectedOpacity(percent){
    const targets=_selectedUnlockedRefs();
    if(!targets.length) return;
    const clamped=Math.max(0,Math.min(100,Math.round(percent)));
    targets.forEach(r=>{ r.opacity=clamped; });
    syncPropsPanel();
    requestRepaint();
  }
  function setSelectedTintColor(color){
    const targets=_selectedUnlockedRefs();
    if(!targets.length) return;
    targets.forEach(r=>{ r.tintColor=color; });
    syncPropsPanel();
    requestRepaint();
  }

  // ── Reordering ───────────────────────────────────────────────────
  // Moves a reference within the Light Table list only. Never touches
  // Timeline keyframe positions, source frame numbers, layer order, or
  // drawing data — this purely reorders entries in `references`, which
  // in turn determines Light Table render stacking order.
  function moveReference(dragId,targetId,before){
    if(dragId===targetId) return;
    const fromIdx=references.findIndex(r=>r.id===dragId);
    if(fromIdx===-1) return;
    const moved=references.splice(fromIdx,1)[0];
    let toIdx=references.findIndex(r=>r.id===targetId);
    if(toIdx===-1){ references.push(moved); }
    else{
      if(!before) toIdx+=1;
      references.splice(toIdx,0,moved);
    }
    renderList();
    requestRepaint();
  }

  function requestRepaint(){
    if(typeof recomposite==='function') recomposite(curLayer,curFrame);
  }

  // ── Rendering ────────────────────────────────────────────────────
  // Called from panels.js recomposite(), right after the document
  // background is painted and before the real artwork composite is
  // drawn on top — so Light Table references sit strictly between the
  // background and the current artwork/onion skin, exactly as required.
  // Each visible reference is drawn at its original canvas position, with
  // its own Phase 3 opacity/tint preview properties applied and no
  // transform. The source drawing itself is never touched.
  //
  // References are painted back-to-front (last list item first), so the
  // TOP of the visible list ends up painted LAST and renders ABOVE lower
  // Light Table references, per spec. All Light Table references still
  // render behind Onion Skin, current artwork and normal tool overlays,
  // since this function only ever draws into the background stage of
  // the composite — that part of the Phase 1 render pipeline is
  // unchanged.
  //
  // Phase 3: opacity and tint are applied here, purely as preview
  // compositing — ref.drawing itself is only ever read (drawImage),
  // never written to.
  let _tintScratch=null;
  function _tintedCanvasOf(ref){
    const w=ref.drawing.width,h=ref.drawing.height;
    if(!_tintScratch) _tintScratch=document.createElement('canvas');
    if(_tintScratch.width!==w||_tintScratch.height!==h){_tintScratch.width=w;_tintScratch.height=h;}
    const sctx=_tintScratch.getContext('2d');
    sctx.clearRect(0,0,w,h);
    sctx.globalAlpha=1;
    sctx.globalCompositeOperation='source-over';
    sctx.drawImage(ref.drawing,0,0);
    // 'source-atop' only paints where the destination already has alpha,
    // and keeps that alpha exactly as-is — so antialiased line edges keep
    // their original per-pixel alpha (line detail preserved), only the
    // colour underneath changes to the tint.
    sctx.globalCompositeOperation='source-atop';
    sctx.fillStyle=ref.tintColor||DEFAULT_TINT_COLOR;
    sctx.fillRect(0,0,w,h);
    sctx.globalCompositeOperation='source-over';
    return _tintScratch;
  }
  function render(targetCtx){
    for(let i=references.length-1;i>=0;i--){
      const ref=references[i];
      if(ref.hidden) continue;
      if(isMissing(ref)) continue;
      const opacity=(ref.opacity==null?100:ref.opacity)/100;
      if(opacity<=0) continue;
      targetCtx.globalAlpha=opacity;
      // Tint is always applied (Phase 3A removed the enable/disable toggle).
      targetCtx.drawImage(_tintedCanvasOf(ref),0,0);
    }
    targetCtx.globalAlpha=1;
  }

  // ── List UI ──────────────────────────────────────────────────────
  function frameLabelOf(ref){
    const fi=currentFrameIndexOf(ref);
    if(fi==null) return '—';
    return 'Frame '+(fi+1);
  }

  // ── Reorder drag: shares the exact interaction model (pointerdown +
  // threshold, red drop-line, auto-scroll, cleanup) with the Layers panel
  // via the generic helpers in timeline.js. No dedicated handle — the row
  // itself is the drag surface, same as the Layers panel's drag-zone.
  let _ltDropLine=null,_ltAutoScroll=null;
  function _ltControllers(listEl){
    if(!_ltDropLine) _ltDropLine=_createDropLineController(listEl);
    if(!_ltAutoScroll) _ltAutoScroll=_createAutoScrollController(listEl);
    return {dropLine:_ltDropLine,autoScroll:_ltAutoScroll};
  }

  function renderList(){
    const listEl=document.getElementById('lt-list');
    const emptyEl=document.getElementById('lt-empty');
    if(!listEl) return;

    // Selection can go stale if the underlying layer/drawing disappeared
    // out from under a reference elsewhere in the app; keep it honest.
    pruneInvalidSelection();

    listEl.innerHTML='';
    emptyEl.classList.toggle('show',references.length===0);

    references.forEach(ref=>{
      const missing=isMissing(ref);
      const isSelected=selectedIds.has(ref.id);
      const row=document.createElement('div');
      row.className='lt-row'+(isSelected?' active':'')+(missing?' lt-missing':'')+(ref.locked?' lt-locked':'');
      row.dataset.id=ref.id;

      const eyeVis=ref.hidden?'🚫':'👁';
      const eyeCls='lt-row-vis'+(ref.hidden?' vis-hidden':'');
      const lockCls='lt-row-lock'+(ref.locked?' active':'');
      const layerName=missing?ref.layerNameSnapshot+' (missing)':ref.layerNameSnapshot;
      const drawingLabel=missing?'Source drawing no longer exists':frameLabelOf(ref);

      // Frame number is the primary identifier while animating, so it takes
      // the primary (lt-row-name) typography slot; the layer name becomes
      // secondary (lt-row-sub). Same classes/hierarchy as before — only the
      // content assignment is swapped.
      row.innerHTML=
        '<span class="'+eyeCls+'" title="Show/hide only this Light Table reference">'+eyeVis+'</span>'+
        '<button type="button" class="'+lockCls+'" title="'+(ref.locked?'Unlock (allow opacity/tint edits)':'Lock (prevent opacity/tint edits)')+'" aria-pressed="'+String(!!ref.locked)+'"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"></rect><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"></path></svg></button>'+
        '<span class="lt-row-info">'+
          '<span class="lt-row-name">'+drawingLabel+'</span>'+
          '<span class="lt-row-sub" title="'+layerName+'">'+layerName+'</span>'+
        '</span>';

      row.querySelector('.lt-row-vis').addEventListener('click',e=>{
        e.stopPropagation();
        toggleVisibility(ref.id);
      });

      row.querySelector('.lt-row-lock').addEventListener('click',e=>{
        e.stopPropagation();
        toggleLock(ref.id);
      });

      row.addEventListener('click',e=>{
        _ltFocused=true;
        if(e.shiftKey){
          selectRange(ref.id);
        } else if(e.ctrlKey||e.metaKey){
          toggleInSelection(ref.id);
        } else {
          selectOnly(ref.id);
        }
      });

      // ── Drag-to-reorder: the whole row is the drag surface (no dedicated
      // handle), same as the Layers panel's drag-zone. A plain click (no
      // movement past the threshold) falls through to the click handler
      // above and just selects, per spec. The Eye toggle is excluded so it
      // never accidentally starts a drag.
      row.addEventListener('pointerdown',e=>{
        if(e.target.closest('.lt-row-vis')||e.target.closest('.lt-row-lock')) return;
        const {dropLine,autoScroll}=_ltControllers(listEl);
        startRowDrag({
          downEv:e,
          listEl,
          rowSelector:'.lt-row[data-id]',
          getRowId:r=>r.dataset.id,
          dragId:ref.id,
          dropLine,
          autoScroll,
          onDragStart:()=>{
            document.body.classList.add('lt-dragging');
            row.classList.add('dragging');
          },
          onDragEnd:()=>{
            document.body.classList.remove('lt-dragging');
            row.classList.remove('dragging');
          },
          onDrop:(targetId,before)=>{
            moveReference(ref.id,targetId,before);
          }
        });
      });

      listEl.appendChild(row);
    });

    syncToolbarState();
    syncPropsPanel();
  }

  function syncToolbarState(){
    const delBtn=document.getElementById('lt-btn-delete');
    if(delBtn) delBtn.disabled=selectedIds.size===0;
    const insBtn=document.getElementById('lt-btn-insert');
    if(insBtn) insBtn.disabled=!resolveSelectedSource();
  }

  // ── Phase 3: Property panel ─────────────────────────────────────
  // No selection → controls disabled/at rest.
  // One selection → shows that reference's own values.
  // Multiple selections → shows shared controls; if the unlocked members
  // of the selection disagree on a value, that control shows the first
  // unlocked reference's value but is marked "mixed" so it's clear editing
  // it will overwrite everyone rather than reflect a single source of truth.
  // Locked references are excluded from the "editable basis"; a selection
  // that is entirely locked still shows its (read-only) values but every
  // control stays disabled, since nothing in it can actually be changed.
  function syncPropsPanel(){
    const opacitySlider=document.getElementById('lt-opacity-slider');
    const opacityVal=document.getElementById('lt-opacity-val');
    const tintSwatch=document.getElementById('lt-tint-swatch');
    if(!opacitySlider||!opacityVal||!tintSwatch) return;

    const selected=references.filter(r=>selectedIds.has(r.id));
    const unlocked=selected.filter(r=>!r.locked);
    const editable=unlocked.length>0;

    if(selected.length===0){
      opacitySlider.disabled=true;
      opacitySlider.value=DEFAULT_OPACITY;
      opacityVal.textContent=DEFAULT_OPACITY+'%';
      tintSwatch.disabled=true;
      tintSwatch.style.background=DEFAULT_TINT_COLOR;
      tintSwatch.title='Tint colour';
      return;
    }

    // Prefer the unlocked members as the basis for displayed values (that's
    // what an edit would actually apply to); if every selected reference
    // happens to be locked, fall back to the full (read-only) selection so
    // the panel still shows something meaningful instead of blanking out.
    const basis=editable?unlocked:selected;

    const firstOpacity=basis[0].opacity;
    const mixedOpacity=basis.some(r=>r.opacity!==firstOpacity);
    opacitySlider.disabled=!editable;
    opacitySlider.value=firstOpacity;
    opacityVal.textContent=firstOpacity+'%'+(mixedOpacity?' *':'');
    opacitySlider.title=mixedOpacity?'Selection has mixed opacity values':'';

    const firstColor=basis[0].tintColor||DEFAULT_TINT_COLOR;
    const mixedColor=basis.some(r=>(r.tintColor||DEFAULT_TINT_COLOR)!==firstColor);
    tintSwatch.disabled=!editable;
    tintSwatch.style.background=firstColor;
    tintSwatch.title=mixedColor?'Selection has mixed tint colours':'Tint colour';
  }

  // ── Focus tracking ───────────────────────────────────────────────
  // Keyboard shortcuts (Delete / Escape / Ctrl+A) should apply only when
  // the Light Table docker is focused or was the most recently
  // interacted-with control — never while typing in another field,
  // slider, modal, or editor.
  let _ltFocused=false;
  function _isTypingTarget(t){
    if(!t) return false;
    if(t.tagName==='TEXTAREA') return true;
    if(t.tagName==='INPUT') return true;
    if(t.isContentEditable) return true;
    return false;
  }

  function initFocusTracking(){
    const panel=document.getElementById('light-table-panel');
    if(!panel) return;
    document.addEventListener('mousedown',e=>{
      _ltFocused=panel.contains(e.target);
    },true);
    panel.addEventListener('focusin',()=>{ _ltFocused=true; });
    document.addEventListener('focusin',e=>{
      if(!panel.contains(e.target)) _ltFocused=false;
    });
  }

  function initKeyboard(){
    document.addEventListener('keydown',e=>{
      if(_isTypingTarget(e.target)) return;
      if(!_ltFocused) return;

      if(e.key==='Escape'){
        if(selectedIds.size){ clearSelection(); }
        return;
      }
      if(e.key==='Delete'){
        if(selectedIds.size){ e.preventDefault(); deleteSelected(); }
        return;
      }
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key==='a'||e.key==='A')){
        e.preventDefault();
        selectAll();
      }
    });
  }

  function init(){
    const insBtn=document.getElementById('lt-btn-insert');
    const delBtn=document.getElementById('lt-btn-delete');
    const listEl=document.getElementById('lt-list');
    if(insBtn) insBtn.addEventListener('click',insertSelected);
    if(delBtn) delBtn.addEventListener('click',deleteSelected);
    if(listEl){
      // Clicking empty space inside the list (not a row) clears selection.
      listEl.addEventListener('click',e=>{
        _ltFocused=true;
        if(e.target===listEl) clearSelection();
      });
    }

    // ── Phase 3 property panel wiring ──────────────────────────────
    const opacitySlider=document.getElementById('lt-opacity-slider');
    if(opacitySlider){
      opacitySlider.addEventListener('input',e=>{
        _ltFocused=true;
        setSelectedOpacity(Number(e.target.value));
      });
    }
    // Tint swatch: reuses the app's existing themed mini colour picker
    // (window.openMiniPicker) rather than a browser-native color input.
    // The picker is handed a target so it reads/writes the Light Table
    // selection's tint colour instead of the foreground draw colour.
    const tintSwatch=document.getElementById('lt-tint-swatch');
    if(tintSwatch){
      tintSwatch.addEventListener('pointerdown',e=>{
        _ltFocused=true;
        if(tintSwatch.disabled) return;
        if(typeof window.openMiniPicker!=='function') return;
        e.stopPropagation();
        window.openMiniPicker(tintSwatch.getBoundingClientRect(),e,{
          anchorEl:tintSwatch,
          swatchEl:tintSwatch,
          getColor:()=>{
            const selected=references.filter(r=>selectedIds.has(r.id)&&!r.locked);
            return (selected[0]&&selected[0].tintColor)||DEFAULT_TINT_COLOR;
          },
          setColor:hex=>{ setSelectedTintColor(hex); },
        });
      });
    }

    // Keep the Insert button's enabled state (and missing-reference
    // display) fresh as the Timeline selection / artwork changes.
    window.addEventListener('active-artwork-changed',()=>{renderList();});
    initFocusTracking();
    initKeyboard();
    renderList();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init);
  } else {
    init();
  }

  window.LightTable={
    insertSelected,
    deleteSelected,
    deleteReference,
    toggleVisibility,
    toggleLock,
    setSelectedOpacity,
    setSelectedTintColor,
    selectReference,
    selectAll,
    clearSelection,
    moveReference,
    render,
    renderList,
    get references(){return references.slice();},
    get selectedIds(){return new Set(selectedIds);},
  };
})();