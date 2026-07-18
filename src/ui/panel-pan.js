// panel-pan.js — Hold Space + drag to scroll any scrollable UI panel
// (layer panel, timeline, tool-settings, brush-presets, etc.) without
// needing a visible scrollbar. Mirrors the existing Space+drag canvas pan
// in core-state.js, but scrolls scrollLeft/scrollTop of the target panel
// instead of moving canvas panX/panY. Works for mouse, pen, and touch via
// Pointer Events.
(function(){
  let panEl=null,panStartX=0,panStartY=0,panStartScrollL=0,panStartScrollT=0,panActive=false;
  let hoverEl=null;

  function findPannable(el){
    // Walk up from el to find the nearest registered scrollable panel.
    return el&&el.closest?el.closest('[data-space-pan]'):null;
  }

  function setCursor(el,cur){ if(el) el.style.cursor=cur; }

  document.addEventListener('pointerover',e=>{
    const p=findPannable(e.target);
    if(p!==hoverEl){
      if(hoverEl&&!panActive) setCursor(hoverEl,'');
      hoverEl=p;
    }
    if(hoverEl&&typeof spaceHeld!=='undefined'&&spaceHeld&&!(typeof ctrlHeld!=='undefined'&&ctrlHeld)&&!panActive) setCursor(hoverEl,'grab');
  });

  // Reflect spaceHeld changes onto whichever panel is currently hovered.
  window.addEventListener('keydown',e=>{
    if(e.code==='Space'&&hoverEl&&!panActive&&!(typeof ctrlHeld!=='undefined'&&ctrlHeld)) setCursor(hoverEl,'grab');
  },{capture:true});
  window.addEventListener('keyup',e=>{
    if(e.code==='Space'&&hoverEl&&!panActive) setCursor(hoverEl,'');
  },{capture:true});

  document.addEventListener('pointerdown',e=>{
    if(typeof spaceHeld==='undefined'||!spaceHeld) return;
    // Ctrl+Space is reserved for zoom gestures (canvas Ctrl+Space+drag, and
    // the Timeline's own Ctrl+Space+drag zoom) — plain Space+drag panning
    // must yield instead of stopPropagation-ing the event before those
    // zoom handlers ever see it.
    if(typeof ctrlHeld!=='undefined'&&ctrlHeld) return;
    if(e.button!==0&&e.pointerType!=='pen') return;
    if(e.pointerType==='pen'&&!(e.buttons&1)) return;
    const p=findPannable(e.target);
    if(!p) return;
    e.preventDefault();e.stopPropagation();
    panEl=p;panActive=true;
    panStartX=e.clientX;panStartY=e.clientY;
    panStartScrollL=p.scrollLeft;panStartScrollT=p.scrollTop;
    setCursor(panEl,'grabbing');
  },{capture:true});

  document.addEventListener('pointermove',e=>{
    if(!panActive||!panEl) return;
    panEl.scrollLeft=panStartScrollL-(e.clientX-panStartX);
    panEl.scrollTop=panStartScrollT-(e.clientY-panStartY);
  });

  function endPan(){
    if(panActive&&panEl) setCursor(panEl,(typeof spaceHeld!=='undefined'&&spaceHeld)?'grab':'');
    panActive=false;panEl=null;
  }
  document.addEventListener('pointerup',endPan);
  document.addEventListener('pointercancel',endPan);
})();