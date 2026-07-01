
// ════════════════════════════════════════════════════════════════
// PANEL RESIZE — Layers panel, invisible edge handles (same as Tools)
// ════════════════════════════════════════════════════════════════
(function(){
  const panel=rightPanel;
  const EDGE=6;
  const EDGE_CSS={
    right:`right:0;top:${EDGE}px;bottom:${EDGE}px;width:${EDGE}px;`,
    left:`left:0;top:${EDGE}px;bottom:${EDGE}px;width:${EDGE}px;`,
    bottom:`bottom:0;left:${EDGE}px;right:${EDGE}px;height:${EDGE}px;`,
    top:`top:0;left:${EDGE}px;right:${EDGE}px;height:${EDGE}px;`,
  };
  const CURSORS={right:'col-resize',left:'col-resize',bottom:'row-resize',top:'row-resize'};
  Object.keys(EDGE_CSS).forEach(side=>{
    const el=document.createElement('div');
    el.style.cssText='position:absolute;'+EDGE_CSS[side]+'background:transparent;transition:background .15s;z-index:10;cursor:'+CURSORS[side]+';touch-action:none;';
    panel.appendChild(el);
    let active=false,sx=0,sy=0,sw=0,sh=0,sl=0,st=0;
    el.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      active=true;el.setPointerCapture(e.pointerId);
      sx=e.clientX;sy=e.clientY;
      sw=panel.offsetWidth;sh=panel.offsetHeight;
      sl=parseFloat(panel.style.left)||0;
      st=parseFloat(panel.style.top)||0;
    });
    el.addEventListener('pointermove',e=>{
      if(!active) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      const docked=panel.classList.contains('docked');
      if(side==='right'){
        const newW=Math.max(120,Math.min(500,sw+dx));
        panel.style.width=newW+'px';
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-left'))window._reflowDockSide('left');if(panel.classList.contains('dock-right'))window._reflowDockSide('right');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='left'){
        const newW=Math.max(120,Math.min(500,sw-dx));
        panel.style.width=newW+'px';
        if(!docked) panel.style.left=(sl+dx)+'px';
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-left'))window._reflowDockSide('left');if(panel.classList.contains('dock-right'))window._reflowDockSide('right');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='bottom'){
        // BUG FIX: while docked to left/right, the panel's height must stay
        // CSS-controlled (top:0;bottom:0;height:auto) so it always reaches the
        // bottom of canvas-area, flush against the timeline. Setting an inline
        // pixel height here — even once — permanently breaks that stretch,
        // leaving the panel detached from the timeline with a gap below it.
        // Only apply a manual height when the panel is actually floating, or
        // docked top/bottom (where height resize is meaningful).
        if(docked&&(panel.classList.contains('dock-left')||panel.classList.contains('dock-right'))) return;
        const newH=Math.max(120,Math.min(700,sh+dy));
        panel.style.height=newH+'px';
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-top'))window._reflowDockSide('top');if(panel.classList.contains('dock-bottom'))window._reflowDockSide('bottom');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='top'){
        if(docked&&(panel.classList.contains('dock-left')||panel.classList.contains('dock-right'))) return;
        const newH=Math.max(120,Math.min(700,sh-dy));
        panel.style.height=newH+'px';
        if(!docked) panel.style.top=(st+dy)+'px';
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-top'))window._reflowDockSide('top');if(panel.classList.contains('dock-bottom'))window._reflowDockSide('bottom');}if(typeof centerCanvas==='function') centerCanvas();}
      }
    });
    el.addEventListener('pointerup',()=>{active=false;});
    el.addEventListener('pointercancel',()=>{active=false;});
  });

  // Safety net: whenever the panel becomes dock-left/dock-right (including on
  // initial load and on layout restore from localStorage), clear any stray
  // inline height so the CSS top:0;bottom:0;height:auto rule takes back over
  // and the panel stays flush against the timeline at the bottom.
  let _wasLR=panel.classList.contains('dock-left')||panel.classList.contains('dock-right');
  new MutationObserver(()=>{
    const nowLR=panel.classList.contains('dock-left')||panel.classList.contains('dock-right');
    if(nowLR) panel.style.height='';
    _wasLR=nowLR;
  }).observe(panel,{attributes:true,attributeFilter:['class']});
  if(_wasLR) panel.style.height='';
})();

// ── Tools panel resize — invisible edge handles on all 4 sides.
// Transparent at rest (clean look); cursor changes on hover; accent highlight when dragging.
// Width changes reflow buttons via flex-wrap and auto-fit height to content.
// Bottom handle has a floor = content height so you can never crush the tools.
(function(){
  const panel=document.getElementById('tools-panel');
  const body=document.getElementById('tools-panel-body');
  const EDGE=6;

  let userSetHeight=false;

  function fitHeightToContent(){
    if(userSetHeight) return;
    if(panel.classList.contains('docked')){panel.style.height='';return;}
    const tbH=panel.querySelector('.fp-titlebar').offsetHeight;
    panel.style.height='0px';
    const bodyH=body.scrollHeight;
    panel.style.height=(tbH+bodyH)+'px';
  }

  // Compute minimum panel height = titlebar + actual body content height at current width
  function minPanelHeight(){
    const tbH=panel.querySelector('.fp-titlebar').offsetHeight;
    const savedH=panel.style.height;
    panel.style.height='0px';
    const bodyH=body.scrollHeight;
    panel.style.height=savedH;
    return tbH+bodyH;
  }

  // When the panel docks to any side, reset userSetHeight and clear inline height
  // so the docked CSS (height:auto / top:0;bottom:0) takes over cleanly.
  // When it un-docks (floats), immediately auto-fit height to content.
  let _toolsWasDocked=panel.classList.contains('docked');
  new MutationObserver(()=>{
    const _nowDocked=panel.classList.contains('docked');
    const _dockChanged=_nowDocked!==_toolsWasDocked;
    _toolsWasDocked=_nowDocked;
    if(panel.classList.contains('docked')){
      userSetHeight=false;
      panel.style.height='';
      // Snap back to narrow when docking to a left/right side
      if(panel.classList.contains('dock-left')||panel.classList.contains('dock-right')){
        if(!panel.style.width||parseFloat(panel.style.width)>40) panel.style.width='40px';
      } else if(panel.classList.contains('dock-top')||panel.classList.contains('dock-bottom')){
        panel.style.width='';
        panel.style.height='';
        requestAnimationFrame(()=>{
          const tbH=panel.querySelector('.fp-titlebar').offsetHeight;
          panel.style.height='0px';
          const bodyH=body.scrollHeight;
          panel.style.height=(tbH+bodyH)+'px';
        });
      }
    } else {
      userSetHeight=false;
      requestAnimationFrame(fitHeightToContent);
    }
    if(_dockChanged&&typeof centerCanvas==='function') centerCanvas();
  }).observe(panel,{attributes:true,attributeFilter:['class']});

  const EDGE_CSS={
    right:`right:0;top:${EDGE}px;bottom:${EDGE}px;width:${EDGE}px;`,
    left:`left:0;top:${EDGE}px;bottom:${EDGE}px;width:${EDGE}px;`,
    bottom:`bottom:0;left:${EDGE}px;right:${EDGE}px;height:${EDGE}px;`,
    top:`top:0;left:${EDGE}px;right:${EDGE}px;height:${EDGE}px;`,
  };
  const CURSORS={right:'col-resize',left:'col-resize',bottom:'row-resize',top:'row-resize'};

  Object.keys(EDGE_CSS).forEach(side=>{
    const el=document.createElement('div');
    el.style.cssText='position:absolute;'+EDGE_CSS[side]+'background:transparent;transition:background .15s;z-index:10;cursor:'+CURSORS[side]+';touch-action:none;';
    panel.appendChild(el);
    let active=false,sx=0,sy=0,sw=0,sh=0,sl=0,st=0;
    el.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      active=true;el.setPointerCapture(e.pointerId);
      sx=e.clientX;sy=e.clientY;
      sw=panel.offsetWidth;sh=panel.offsetHeight;
      sl=parseFloat(panel.style.left)||0;
      st=parseFloat(panel.style.top)||0;
    });
    el.addEventListener('pointermove',e=>{
      if(!active) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      const docked=panel.classList.contains('docked');
      if(side==='right'){
        const newW=Math.max(38,Math.min(400,sw+dx));
        panel.style.width=newW+'px';
        if(!docked){userSetHeight=false;fitHeightToContent();}
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-left'))window._reflowDockSide('left');if(panel.classList.contains('dock-right'))window._reflowDockSide('right');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='left'){
        const newW=Math.max(38,Math.min(400,sw-dx));
        panel.style.width=newW+'px';
        if(!docked){panel.style.left=(sl+dx)+'px';userSetHeight=false;fitHeightToContent();}
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-left'))window._reflowDockSide('left');if(panel.classList.contains('dock-right'))window._reflowDockSide('right');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='bottom'){
        const minH=minPanelHeight();
        const newH=Math.max(minH,Math.min(600,sh+dy));
        panel.style.height=newH+'px';
        userSetHeight=true;
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-top'))window._reflowDockSide('top');if(panel.classList.contains('dock-bottom'))window._reflowDockSide('bottom');}if(typeof centerCanvas==='function') centerCanvas();}
      } else if(side==='top'){
        const minH=minPanelHeight();
        const newH=Math.max(minH,Math.min(600,sh-dy));
        panel.style.height=newH+'px';
        if(!docked) panel.style.top=(st+dy)+'px';
        userSetHeight=true;
        if(docked){if(typeof window._reflowDockSide==='function'){if(panel.classList.contains('dock-top'))window._reflowDockSide('top');if(panel.classList.contains('dock-bottom'))window._reflowDockSide('bottom');}if(typeof centerCanvas==='function') centerCanvas();}
      }
    });
    el.addEventListener('pointerup',()=>{active=false;});
    el.addEventListener('pointercancel',()=>{active=false;});
  });

  // Initial fit — only when floating; docked panels use CSS height:auto (top:0;bottom:0)
  requestAnimationFrame(()=>{if(!panel.classList.contains('docked')) fitHeightToContent();});
})();

// ── Timeline resize (vertical)
// Uses pointer events + setPointerCapture so pen-tablet drag continues when
// the stylus moves outside the handle element (no more "stops at edge" issue).
(function(){
  let dragging=false,startY=0,startH=0;
  rhBottom.addEventListener('pointerdown',e=>{
    if(!showTimeline) return;
    e.preventDefault();
    dragging=true;startY=e.clientY;startH=timelineArea.offsetHeight;
    rhBottom.setPointerCapture(e.pointerId);
    rhBottom.classList.add('dragging');
  });
  rhBottom.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const newH=Math.max(80,Math.min(500,startH-(e.clientY-startY)));
    timelineArea.style.height=newH+'px';
    if(typeof centerCanvas==='function') centerCanvas();
  });
  rhBottom.addEventListener('pointerup',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
  rhBottom.addEventListener('pointercancel',()=>{if(dragging){dragging=false;rhBottom.classList.remove('dragging');}});
})();

// ── Timeline label column resize (horizontal)
// Uses pointer events + setPointerCapture so pen-tablet drag continues when
// the stylus moves outside the handle element.
(function(){
  const handle=document.getElementById('tl-labels-resize');
  const labelsCol=document.getElementById('tl-labels-col');
  let dragging=false,startX=0,startW=0;
  handle.addEventListener('pointerdown',e=>{
    e.preventDefault();
    dragging=true;startX=e.clientX;startW=labelsCol.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const newW=Math.max(60,Math.min(400,startW+(e.clientX-startX)));
    labelsCol.style.width=newW+'px';
  });
  handle.addEventListener('pointerup',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
  handle.addEventListener('pointercancel',()=>{if(dragging){dragging=false;handle.classList.remove('dragging');}});
})();

// ════════════════════════════════════════════════════════════════
// CANVAS SETTINGS MODAL
// ════════════════════════════════════════════════════════════════
// ── Seconds:Frames timing helpers
// normalise: e.g. 0:24 @ fps=24 → 1:00, 0:25 → 1:01, 0:14 @ fps=12 → 1:02
function normalizeSecFr(sec,fr,fps){
  const total=sec*fps+fr;
  return{sec:Math.floor(total/fps),fr:total%fps,total};
}
function totalToSecFr(total,fps){return{sec:Math.floor(total/fps),fr:total%fps};}
function secFrToTotal(sec,fr,fps){return sec*fps+fr;}

// ── Canvas settings modal
function openCanvasModal(){
  document.getElementById('canvas-w-input').value=CW;
  document.getElementById('canvas-h-input').value=CH;
  document.getElementById('canvas-maxfps-input').value=MAX_FPS;
  const {sec,fr}=totalToSecFr(TOTAL,MAX_FPS);
  document.getElementById('canvas-frames-sec-input').value=sec;
  document.getElementById('canvas-frames-fr-input').value=fr;
  document.getElementById('canvas-frames-fps-label').textContent=MAX_FPS;
  document.getElementById('canvas-frames-total-label').textContent=TOTAL;
  document.getElementById('canvas-bg-color-input').value=bgColor==='transparent'?'#ffffff':bgColor;
  document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.toggle('active',s.dataset.color===bgColor));
  document.getElementById('modal-canvas').classList.add('visible');
}
function updateCanvasFramesModalTotal(){
  const fps=Math.max(1,parseInt(document.getElementById('canvas-maxfps-input').value)||MAX_FPS);
  const sec=Math.max(0,parseInt(document.getElementById('canvas-frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('canvas-frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,fps);
  document.getElementById('canvas-frames-sec-input').value=norm.sec;
  document.getElementById('canvas-frames-fr-input').value=norm.fr;
  document.getElementById('canvas-frames-fps-label').textContent=fps;
  document.getElementById('canvas-frames-total-label').textContent=norm.total;
}
document.getElementById('canvas-frames-sec-input').addEventListener('change',updateCanvasFramesModalTotal);
document.getElementById('canvas-frames-fr-input').addEventListener('change',updateCanvasFramesModalTotal);
document.getElementById('canvas-maxfps-input').addEventListener('input',()=>{
  const fps=Math.max(1,Math.min(120,parseInt(document.getElementById('canvas-maxfps-input').value)||24));
  document.getElementById('canvas-frames-fps-label').textContent=fps;
  updateCanvasFramesModalTotal();
});
function closeCanvasModal(){document.getElementById('modal-canvas').classList.remove('visible');}
document.getElementById('modal-canvas-cancel').onclick=closeCanvasModal;
document.getElementById('modal-canvas').addEventListener('click',e=>{if(e.target===document.getElementById('modal-canvas'))closeCanvasModal();});
document.querySelectorAll('.preset-btn').forEach(btn=>{btn.onclick=()=>{document.getElementById('canvas-w-input').value=btn.dataset.w;document.getElementById('canvas-h-input').value=btn.dataset.h;};});
document.querySelectorAll('.bg-swatch').forEach(sw=>{
  sw.onclick=()=>{document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.remove('active'));sw.classList.add('active');if(sw.dataset.color!=='transparent')document.getElementById('canvas-bg-color-input').value=sw.dataset.color;};
});
document.getElementById('canvas-bg-color-input').oninput=()=>document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.remove('active'));
document.getElementById('modal-canvas-ok').onclick=()=>{
  const nw=parseInt(document.getElementById('canvas-w-input').value)||1920;
  const nh=parseInt(document.getElementById('canvas-h-input').value)||1080;
  if(nw<8||nh<8||nw>4096||nh>4096){showInfo('Dimensions must be 8–4096.','Invalid Size');return;}
  MAX_FPS=Math.max(1,Math.min(120,parseInt(document.getElementById('canvas-maxfps-input').value)||24));
  const fSec=Math.max(0,parseInt(document.getElementById('canvas-frames-sec-input').value)||0);
  const fFr=Math.max(0,parseInt(document.getElementById('canvas-frames-fr-input').value)||0);
  const norm=normalizeSecFr(fSec,fFr,MAX_FPS);
  const nf=norm.total;
  if(nf<2||nf>9999){showInfo('Frame count must be 2–9999.','Invalid Frame Count');return;}
  fpsTl.max=MAX_FPS;
  const cf=Math.min(getFPS(),MAX_FPS);fpsTl.value=cf;fpsVal.textContent=cf;
  updateFpsSliderColor();
  const actSw=document.querySelector('.bg-swatch.active');
  bgColor=actSw?actSw.dataset.color:document.getElementById('canvas-bg-color-input').value;
  applyTotalFrames(nf);
  applyCanvasResize(nw,nh);closeCanvasModal();
};
function applyCanvasResize(nw,nh){
  layers.forEach(l=>{const nf={};Object.keys(l.frames).forEach(fi=>{const oc=document.createElement('canvas');oc.width=nw;oc.height=nh;const octx=oc.getContext('2d');const src=l.frames[fi];const dx=Math.round((nw-src.width)/2);const dy=Math.round((nh-src.height)/2);octx.drawImage(src,dx,dy);nf[fi]=oc;});l.frames=nf;});
  CW=nw;CH=nh;initCanvas();loadFrame(curLayer,curFrame);renderTimeline();fitCanvasToView();
}

function applyTotalFrames(n){
  TOTAL=n;rangeStart=Math.min(rangeStart,TOTAL-1);rangeEnd=Math.min(rangeEnd,TOTAL-1);
  if(rangeEnd<rangeStart) rangeEnd=rangeStart;curFrame=Math.min(curFrame,TOTAL-1);
  document.getElementById('frame-info').textContent='Frame '+(curFrame+1)+' / '+TOTAL;
  renderTimeline();
}

// ── Frame count modal (opened by clicking "Frame n / n" label)
document.getElementById('frame-info').addEventListener('click',()=>{
  const {sec,fr}=totalToSecFr(TOTAL,MAX_FPS);
  document.getElementById('frames-sec-input').value=sec;
  document.getElementById('frames-fr-input').value=fr;
  document.getElementById('frames-maxfps-input').value=MAX_FPS;
  document.getElementById('frames-fps-label').textContent=MAX_FPS;
  document.getElementById('frames-total-label').textContent=TOTAL;
  document.getElementById('modal-frames').classList.add('visible');
});
function updateFramesModalTotal(){
  const fps=Math.max(1,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS);
  const sec=Math.max(0,parseInt(document.getElementById('frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,fps);
  document.getElementById('frames-sec-input').value=norm.sec;
  document.getElementById('frames-fr-input').value=norm.fr;
  document.getElementById('frames-fps-label').textContent=fps;
  document.getElementById('frames-total-label').textContent=norm.total;
}
document.getElementById('frames-sec-input').addEventListener('change',updateFramesModalTotal);
document.getElementById('frames-fr-input').addEventListener('change',updateFramesModalTotal);
document.getElementById('frames-maxfps-input').addEventListener('input',()=>{
  document.getElementById('frames-fps-label').textContent=Math.max(1,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS);
  updateFramesModalTotal();
});
document.getElementById('modal-frames-cancel').onclick=()=>document.getElementById('modal-frames').classList.remove('visible');
document.getElementById('modal-frames').addEventListener('click',e=>{if(e.target===document.getElementById('modal-frames'))document.getElementById('modal-frames').classList.remove('visible');});
document.getElementById('modal-frames-ok').onclick=()=>{
  const newMax=Math.max(1,Math.min(120,parseInt(document.getElementById('frames-maxfps-input').value)||MAX_FPS));
  MAX_FPS=newMax;
  fpsTl.max=MAX_FPS;
  const cf=Math.min(getFPS(),MAX_FPS);fpsTl.value=cf;fpsVal.textContent=cf;
  updateFpsSliderColor();
  const sec=Math.max(0,parseInt(document.getElementById('frames-sec-input').value)||0);
  const fr=Math.max(0,parseInt(document.getElementById('frames-fr-input').value)||0);
  const norm=normalizeSecFr(sec,fr,MAX_FPS);
  const n=norm.total;
  if(n<2||n>9999){showInfo('Frame count must be 2–9999.','Invalid Frame Count');return;}
  applyTotalFrames(n);
  document.getElementById('modal-frames').classList.remove('visible');
};

// Zoom settings modal
document.getElementById('modal-zoom-cancel').onclick=()=>document.getElementById('modal-zoom').classList.remove('visible');
document.getElementById('modal-zoom').addEventListener('click',e=>{if(e.target===document.getElementById('modal-zoom'))document.getElementById('modal-zoom').classList.remove('visible');});
document.getElementById('modal-zoom-ok').onclick=()=>{
  zoomSpeed=Math.max(0.001,Math.min(1,parseFloat(document.getElementById('zoom-speed-input').value)||0.15));
  zoomMin=Math.max(0.05,Math.min(1,parseFloat(document.getElementById('zoom-min-input').value)||0.1));
  zoomMax=Math.max(1,Math.min(32,parseFloat(document.getElementById('zoom-max-input').value)||16));
  document.getElementById('modal-zoom').classList.remove('visible');
};

// ════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT') return;
  if(matchBind(e,'undo')){e.preventDefault();undo();return;}
  if(matchBind(e,'redo')){e.preventDefault();redo();return;}
  if(matchBind(e,'copyFrame')){e.preventDefault();copyFrame();return;}
  if(matchBind(e,'cutFrame')){e.preventDefault();cutFrame();return;}
  if(matchBind(e,'pasteImage')){e.preventDefault();if(typeof pasteImageFromClipboard==='function')pasteImageFromClipboard();return;}
  if(matchBind(e,'pasteFrame')){e.preventDefault();pasteFrame();return;}
  if(matchBind(e,'clearFrame')){e.preventDefault();clearCurrentFrame();return;}
  const toolMap={toolBrush:['brush','Brush'],toolEraser:['eraser','Eraser'],toolFill:['fill','Fill'],toolLine:['line','Line'],toolTransform:['transform','Transform']};
  for(const action in toolMap){ if(matchBind(e,action)){ e.preventDefault(); setTool(...toolMap[action]); break; } }
  if(matchBind(e,'newFrame')){createBlankKey();loadFrame(curLayer,curFrame);}
  if(matchBind(e,'delKeyframe')){e.preventDefault();deleteKeyframe();}
  if(matchBind(e,'nextFrame')){e.preventDefault();goToFrame(curFrame+1);}
  if(matchBind(e,'prevFrame')){e.preventDefault();goToFrame(curFrame-1);}
  // Space is reserved for canvas pan — Tab toggles play (handled in timeline.js)
  // Zoom keyboard shortcuts — center of canvas-area
  if(matchBind(e,'zoomIn')){e.preventDefault();const r=canvasArea.getBoundingClientRect();doZoom(1,r.width/2,r.height/2);}
  if(matchBind(e,'zoomOut')){e.preventDefault();const r=canvasArea.getBoundingClientRect();doZoom(-1,r.width/2,r.height/2);}
  if(matchBind(e,'zoomReset')){e.preventDefault();zoom=1;centerCanvas();showZoom();}
  if(matchBind(e,'rotateReset')){e.preventDefault();resetRotation();}
  if(matchBind(e,'flipHorizontal')){e.preventDefault();toggleFlipH();}
  if(matchBind(e,'flipVertical')){e.preventDefault();toggleFlipV();}
});

// ════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════
initCanvas();
renderLayerPanel();
renderTimeline();
loadFrame(curLayer,curFrame);
// Fit & center after layout settles
requestAnimationFrame(()=>requestAnimationFrame(fitCanvasToView));

// ════════════════════════════════════════════════════════════════
// IMAGE IMPORT SYSTEM
// — Drag-and-drop images anywhere on the app
// — File menu "Import Image…" button
// — Modal asks: New Layer / Current Layer / New Layer in Group
// — Fit modes: fit, fill, stretch, center
// ════════════════════════════════════════════════════════════════
