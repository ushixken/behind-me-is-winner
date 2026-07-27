// ════════════════════════════════════════════════════════════════
// LIGHT TABLE — Phase 1 + Phase 2
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
// Phase 2 adds, on top of the list (never touching source drawings,
// Timeline frames, keyframes, layers or exposure lengths):
//   - multi-selection (Click / Ctrl+Click)
//   - range selection (Shift+Click)
//   - batch deletion (Delete button / Delete key)
//   - keyboard selection controls (Ctrl+A, Escape)
//   - list reordering by dragging a row directly, matching the Layers panel
// Transform, tint, opacity, locking, flip, align, persistence and
// undo/redo remain out of scope. References still live only in memory
// for this session, and Insert remains the only way to add references
// (no Timeline drag-and-drop).
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
  //   frameIndexSnapshot, hidden }
  // List order == render stacking order (top of list renders above).
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
  // Each visible reference is drawn at its original canvas position,
  // with its original colours, at full opacity, with no transform and
  // no tint. The source drawing itself is never touched.
  //
  // References are painted back-to-front (last list item first), so the
  // TOP of the visible list ends up painted LAST and renders ABOVE lower
  // Light Table references, per spec. All Light Table references still
  // render behind Onion Skin, current artwork and normal tool overlays,
  // since this function only ever draws into the background stage of
  // the composite — that part of the Phase 1 render pipeline is
  // unchanged.
  function render(targetCtx){
    for(let i=references.length-1;i>=0;i--){
      const ref=references[i];
      if(ref.hidden) continue;
      if(isMissing(ref)) continue;
      targetCtx.globalAlpha=1;
      targetCtx.drawImage(ref.drawing,0,0);
    }
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
      row.className='lt-row'+(isSelected?' active':'')+(missing?' lt-missing':'');
      row.dataset.id=ref.id;

      const eyeVis=ref.hidden?'🚫':'👁';
      const eyeCls='lt-row-vis'+(ref.hidden?' vis-hidden':'');
      const layerName=missing?ref.layerNameSnapshot+' (missing)':ref.layerNameSnapshot;
      const drawingLabel=missing?'Source drawing no longer exists':frameLabelOf(ref);

      // Frame number is the primary identifier while animating, so it takes
      // the primary (lt-row-name) typography slot; the layer name becomes
      // secondary (lt-row-sub). Same classes/hierarchy as before — only the
      // content assignment is swapped.
      row.innerHTML=
        '<span class="'+eyeCls+'" title="Show/hide only this Light Table reference">'+eyeVis+'</span>'+
        '<span class="lt-row-info">'+
          '<span class="lt-row-name">'+drawingLabel+'</span>'+
          '<span class="lt-row-sub" title="'+layerName+'">'+layerName+'</span>'+
        '</span>';

      row.querySelector('.lt-row-vis').addEventListener('click',e=>{
        e.stopPropagation();
        toggleVisibility(ref.id);
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
        if(e.target.closest('.lt-row-vis')) return;
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
  }

  function syncToolbarState(){
    const delBtn=document.getElementById('lt-btn-delete');
    if(delBtn) delBtn.disabled=selectedIds.size===0;
    const insBtn=document.getElementById('lt-btn-insert');
    if(insBtn) insBtn.disabled=!resolveSelectedSource();
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