// ════════════════════════════════════════════════════════════════
// HOLD-KEY BRUSH RESIZE — hold the "Resize Brush" keybind (default: S)
// and drag on the canvas to scrub the brush/eraser size, with a live
// circle preview showing exactly how big the tip will be before you
// draw. Bound/rebindable via Settings ▸ Keybinds like everything else.
// ════════════════════════════════════════════════════════════════
(function(){

  // ── live size preview circle ──────────────────────────────────
  const previewEl=document.createElement('div');
  previewEl.id='brush-size-preview';
  Object.assign(previewEl.style,{
    position:'fixed',
    left:'0px', top:'0px',
    width:'0px', height:'0px',
    marginLeft:'0px', marginTop:'0px',
    borderRadius:'50%',
    border:'1.5px solid rgba(255,255,255,0.95)',
    boxShadow:'0 0 0 1.5px rgba(0,0,0,0.85), 0 0 6px rgba(0,0,0,0.5)',
    background:'rgba(255,255,255,0.06)',
    pointerEvents:'none',
    zIndex:'9999',
    display:'none',
    transform:'translate(-50%,-50%)',
    boxSizing:'border-box',
  });
  document.body.appendChild(previewEl);

  // Small readout of the exact size next to the circle, in whatever unit
  // (px/mm) the rest of the size UI is currently showing.
  const labelEl=document.createElement('div');
  labelEl.id='brush-size-preview-label';
  Object.assign(labelEl.style,{
    position:'fixed',
    left:'0px', top:'0px',
    transform:'translate(-50%,0)',
    pointerEvents:'none',
    zIndex:'9999',
    display:'none',
    font:'11px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    color:'#fff',
    background:'rgba(0,0,0,0.7)',
    padding:'1px 5px',
    borderRadius:'3px',
    whiteSpace:'nowrap',
  });
  document.body.appendChild(labelEl);

  function sizeLabelText(px){
    if(typeof window._brushSizeUnit!=='undefined' && window._brushSizeUnit.unit==='mm'){
      return window._brushSizeUnit.pxToMm(px).toFixed(px<10*window._brushSizeUnit.pxToMm(1)?2:1)+' mm';
    }
    return (px<10?px.toFixed(1):Math.round(px))+' px';
  }

  function showPreview(clientX,clientY,px){
    const screenD=Math.max(6, px*zoom); // circle diameter in screen px; floor so a 1px brush is still visible
    previewEl.style.left=clientX+'px';
    previewEl.style.top=clientY+'px';
    previewEl.style.width=screenD+'px';
    previewEl.style.height=screenD+'px';
    previewEl.style.display='block';
    labelEl.style.left=clientX+'px';
    labelEl.style.top=(clientY+screenD/2+8)+'px';
    labelEl.textContent=sizeLabelText(px);
    labelEl.style.display='block';
  }
  function hidePreview(){
    previewEl.style.display='none';
    labelEl.style.display='none';
  }

  // ── held-key tracking ─────────────────────────────────────────
  let _resizeKeyHeld=false;
  let _resizeDragging=false;
  let _dragStartX=0, _dragStartSize=6;
  let _dragStartClientX=0, _dragStartClientY=0;
  let _lastClientX=0, _lastClientY=0;

  function _sizeMin(){ const s=document.getElementById('ts-size'); return s?+s.min:1; }
  function _sizeMax(){ const s=document.getElementById('ts-size'); return s?+s.max:200; }

  function _applySize(px){
    px=Math.max(_sizeMin(),Math.min(_sizeMax(),px));
    px=Math.round(px*10)/10;
    toolSizes[tool]=px;
    const tsSz=document.getElementById('ts-size'); if(tsSz) tsSz.value=px;
    const bpSz=document.getElementById('bp-sz'); if(bpSz) bpSz.value=px;
    if(typeof _aaDabCache!=='undefined') _aaDabCache.clear();
    if(typeof _stampCache!=='undefined') _stampCache.clear();
    if(typeof refreshSizeUI==='function') refreshSizeUI(); else {
      const v=document.getElementById('ts-size-val'); if(v) v.textContent=px;
    }
    return px;
  }

  document.addEventListener('keydown',e=>{
    if(e.repeat) return;
    if(e.target && (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)) return;
    if(!matchBind(e,'brushResize')) return;
    _resizeKeyHeld=true;
    // Show the preview immediately at the last known cursor position (if
    // we have one) so it appears the instant the key goes down, not only
    // once the mouse next moves.
    if(_lastClientX||_lastClientY) showPreview(_lastClientX,_lastClientY,toolSizes[tool]||6);
  });
  document.addEventListener('keyup',e=>{
    if(!matchBind(e,'brushResize')) return;
    _resizeKeyHeld=false;
    if(!_resizeDragging) hidePreview();
  });
  // If the window loses focus (alt-tab, etc.) mid-hold, don't get stuck
  // thinking the key is still down.
  window.addEventListener('blur',()=>{ _resizeKeyHeld=false; if(!_resizeDragging) hidePreview(); });

  // Track cursor position at all times (cheap) so the preview can appear
  // right where the pointer already is as soon as the key is pressed.
  document.addEventListener('pointermove',e=>{
    _lastClientX=e.clientX; _lastClientY=e.clientY;
  },{capture:true,passive:true});

  // ── intercept drawing on the canvas while the key is held ──────
  // Registered on canvasArea (an ANCESTOR of active-canvas) in the CAPTURE
  // phase. Capture-phase listeners only run before same-element listeners
  // when they're on an ancestor in the propagation path — two listeners on
  // the exact same element (activeC) fire in registration order regardless
  // of the capture flag, so attaching here (rather than on activeC itself)
  // is what actually guarantees we run before brush-engine's pointerdown
  // handler and can swallow the event to stop a stroke from starting.
  canvasArea.addEventListener('pointerdown',e=>{
    if(!_resizeKeyHeld) return;
    e.preventDefault();
    e.stopPropagation();
    _resizeDragging=true;
    _dragStartX=e.clientX;
    _dragStartClientX=e.clientX;
    _dragStartClientY=e.clientY;
    _dragStartSize=toolSizes[tool]||6;
    activeC.setPointerCapture(e.pointerId);
    showPreview(e.clientX,e.clientY,_dragStartSize);
  },{capture:true});

  canvasArea.addEventListener('pointermove',e=>{
    if(!_resizeDragging) return;
    e.preventDefault();
    e.stopPropagation();
    // Horizontal drag scrubs size — right grows, left shrinks. Scaled so a
    // full canvas-area width drag roughly spans the slider's full range,
    // and divided by zoom so it feels like a consistent screen-space
    // gesture regardless of how zoomed in the canvas is.
    const dx=(e.clientX-_dragStartX)/Math.max(0.15,zoom);
    const px=_applySize(_dragStartSize+dx);
    // Circle stays anchored where the drag started — only its radius
    // changes as you drag. Following the cursor made the circle chase the
    // drag instead of reading as "this is the size", which is confusing
    // since the drag motion itself isn't where you're about to draw.
    showPreview(_dragStartClientX,_dragStartClientY,px);
  },{capture:true});

  function _endResizeDrag(e){
    if(!_resizeDragging) return;
    _resizeDragging=false;
    try{ activeC.releasePointerCapture(e.pointerId); }catch(err){}
    if(!_resizeKeyHeld) hidePreview();
  }
  canvasArea.addEventListener('pointerup',e=>{
    if(!_resizeDragging) return;
    e.preventDefault();
    e.stopPropagation();
    _endResizeDrag(e);
  },{capture:true});
  canvasArea.addEventListener('pointercancel',_endResizeDrag,{capture:true});

  // Live preview while just hovering (key held, mouse not yet pressed) so
  // you can see the circle before you commit to drawing. Bubble phase is
  // fine here since we're not swallowing anything.
  canvasArea.addEventListener('pointermove',e=>{
    if(!_resizeKeyHeld||_resizeDragging) return;
    showPreview(e.clientX,e.clientY,toolSizes[tool]||6);
  });
  canvasArea.addEventListener('pointerleave',()=>{
    if(_resizeKeyHeld&&!_resizeDragging) hidePreview();
  });

})();
