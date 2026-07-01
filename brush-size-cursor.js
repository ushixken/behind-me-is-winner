// ════════════════════════════════════════════════════════════════
// BRUSH-SIZE CANVAS CURSOR (Preferences ▸ Cursor ▸ Brush Size)
// When selected, a live circle matching the current tool's exact draw
// radius follows the pointer over the canvas, so you can see precisely
// what you're about to affect before you click. Same idea as the
// momentary resize preview in brush-size-drag.js, but always-on while
// hovering rather than only while actively holding the resize key.
// ════════════════════════════════════════════════════════════════
(function(){

  const circleEl=document.createElement('div');
  circleEl.id='brush-cursor-circle';
  Object.assign(circleEl.style,{
    position:'fixed', left:'0px', top:'0px', width:'0px', height:'0px',
    borderRadius:'50%',
    border:'1.5px solid rgba(255,255,255,0.95)',
    boxShadow:'0 0 0 1.5px rgba(0,0,0,0.85)',
    background:'rgba(255,255,255,0.05)',
    pointerEvents:'none',
    zIndex:'9998',
    display:'none',
    transform:'translate(-50%,-50%)',
    boxSizing:'border-box',
  });
  document.body.appendChild(circleEl);

  let _hovering=false, _lastX=0, _lastY=0;

  function _shouldShow(){
    return cursorStyle==='brush'
      && _hovering
      && !activeGroupId
      && !panning && !_zoomDrag && !_rotateDrag && !spaceHeld
      && tool!=='transform';
  }

  function _update(){
    if(!_shouldShow()){ circleEl.style.display='none'; return; }
    const px=toolSizes[tool]||6;
    const d=Math.max(4, px*zoom); // floor so tiny brushes are still visible
    circleEl.style.left=_lastX+'px';
    circleEl.style.top=_lastY+'px';
    circleEl.style.width=d+'px';
    circleEl.style.height=d+'px';
    circleEl.style.display='block';
  }

  canvasArea.addEventListener('pointermove',e=>{ _hovering=true; _lastX=e.clientX; _lastY=e.clientY; _update(); });
  canvasArea.addEventListener('pointerenter',e=>{ _hovering=true; _lastX=e.clientX; _lastY=e.clientY; _update(); });
  canvasArea.addEventListener('pointerleave',()=>{ _hovering=false; circleEl.style.display='none'; });
  window.addEventListener('blur',()=>{ _hovering=false; circleEl.style.display='none'; });

  // A lightweight per-frame refresh (rather than hooking every place that
  // can change size/tool/zoom/pref/group-selection) keeps this circle
  // correct no matter what changed it, at negligible cost since it's just
  // a few style writes and only runs while actually hovering the canvas.
  (function loop(){ _update(); requestAnimationFrame(loop); })();

})();
