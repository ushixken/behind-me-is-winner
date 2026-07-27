// ════════════════════════════════════════════════════════════════
// LIGHT TABLE — Phase 1
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
// Phase 1 explicitly does NOT implement: transform, tint, opacity,
// locking, drag-and-drop, multi-selection, alignment, flipping, or
// project persistence. References live only in memory for this session.
// ════════════════════════════════════════════════════════════════
(function(){

  // ── Stable identity ──────────────────────────────────────────────
  // Layers and keyframe canvases have no built-in unique id in this
  // codebase (layers are addressed by array index, which is NOT stable
  // across reordering/deletion). Lazily mint a stable id per object the
  // first time we see it, keyed off the object itself so identity is
  // preserved no matter what index it later moves to.
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
  //   frameIndexSnapshot, hidden, selected }
  let references=[];
  let _refCounter=1;

  function isLayerAlive(layer){
    return typeof layers!=='undefined'&&layers.indexOf(layer)!==-1;
  }
  function isDrawingAlive(ref){
    if(!isLayerAlive(ref.layer)) return false;
    // The drawing is alive as long as it's still stored somewhere in the
    // source layer's frame map (its frame index may have shifted).
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
  // Prefers an explicit keyframe cell selection (selectedKFs, "li:fi"
  // strings — see timeline.js) and otherwise falls back to whatever
  // drawing is currently active (curLayer/curFrame). Either way we
  // resolve down to the *owning* keyframe (the actual canvas object),
  // never just a bare frame index, per the "avoid depending only on the
  // current frame index" requirement.
  function resolveSelectedSource(){
    let li=curLayer,fi=curFrame;
    if(typeof selectedKFs!=='undefined'&&selectedKFs.size){
      const first=selectedKFs.values().next().value;
      const parts=first.split(':');
      li=Number(parts[0]);fi=Number(parts[1]);
    }
    const layer=layers[li];
    if(!layer) return null;
    // Find the actual keyframe canvas that is exposed at fi (walking
    // backward to the nearest defined key, exactly like getHeldKey()),
    // plus the frame index that key actually lives at.
    let ownerFrame=-1,drawing=null;
    for(let f=fi;f>=0;f--){
      if(layer.frames[f]){ownerFrame=f;drawing=layer.frames[f];break;}
    }
    if(!drawing) return null;
    return {layer,layerIndex:li,drawing,ownerFrame};
  }

  // ── Insert / Delete ─────────────────────────────────────────────
  function insertSelected(){
    const src=resolveSelectedSource();
    if(!src) return null;
    // Don't create a duplicate reference to the exact same drawing.
    const existing=references.find(r=>r.layer===src.layer&&r.drawing===src.drawing);
    if(existing){
      selectReference(existing.id);
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
    selectReference(ref.id,{skipRender:true});
    renderList();
    requestRepaint();
    return ref;
  }
  function deleteSelected(){
    const ref=references.find(r=>r.id===selectedId);
    if(!ref) return;
    deleteReference(ref.id);
  }
  function deleteReference(id){
    const idx=references.findIndex(r=>r.id===id);
    if(idx===-1) return;
    references.splice(idx,1);
    if(selectedId===id) selectedId=null;
    renderList();
    requestRepaint();
  }
  let selectedId=null;
  function selectReference(id,opts){
    selectedId=id; // single selection, phase 1
    if(!opts||!opts.skipRender) renderList();
  }
  function toggleVisibility(id){
    const ref=references.find(r=>r.id===id);
    if(!ref) return;
    ref.hidden=!ref.hidden;
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
  function render(targetCtx){
    for(let i=0;i<references.length;i++){
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
  function renderList(){
    const listEl=document.getElementById('lt-list');
    const emptyEl=document.getElementById('lt-empty');
    if(!listEl) return;
    listEl.innerHTML='';
    emptyEl.classList.toggle('show',references.length===0);

    references.forEach(ref=>{
      const missing=isMissing(ref);
      const row=document.createElement('div');
      row.className='lt-row'+(ref.id===selectedId?' active':'')+(missing?' lt-missing':'');
      row.dataset.id=ref.id;

      const eyeVis=ref.hidden?'🚫':'👁';
      const eyeCls='lt-row-vis'+(ref.hidden?' vis-hidden':'');
      const layerName=missing?ref.layerNameSnapshot+' (missing)':ref.layerNameSnapshot;
      const drawingLabel=missing?'Source drawing no longer exists':frameLabelOf(ref);

      row.innerHTML=
        `<span class="${eyeCls}" title="Show/hide only this Light Table reference">${eyeVis}</span>`+
        `<span class="lt-row-info">`+
          `<span class="lt-row-name" title="${layerName}">${layerName}</span>`+
          `<span class="lt-row-sub">${drawingLabel}</span>`+
        `</span>`;

      row.querySelector('.lt-row-vis').addEventListener('click',e=>{
        e.stopPropagation();
        toggleVisibility(ref.id);
      });
      row.addEventListener('click',()=>{
        selectReference(ref.id);
      });

      listEl.appendChild(row);
    });

    syncToolbarState();
  }

  function syncToolbarState(){
    const delBtn=document.getElementById('lt-btn-delete');
    if(delBtn) delBtn.disabled=!selectedId||!references.some(r=>r.id===selectedId);
    const insBtn=document.getElementById('lt-btn-insert');
    if(insBtn) insBtn.disabled=!resolveSelectedSource();
  }

  function init(){
    const insBtn=document.getElementById('lt-btn-insert');
    const delBtn=document.getElementById('lt-btn-delete');
    if(insBtn) insBtn.addEventListener('click',insertSelected);
    if(delBtn) delBtn.addEventListener('click',deleteSelected);
    // Keep the Insert button's enabled state (and missing-reference
    // display) fresh as the Timeline selection / artwork changes.
    window.addEventListener('active-artwork-changed',()=>{renderList();});
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
    render,
    renderList,
    get references(){return references.slice();},
  };
})();
