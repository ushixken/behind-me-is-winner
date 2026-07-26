'use strict';

// Shared DOM scrollbar layer for application panels. Native scrollbar pseudo-
// elements cannot own Pointer Capture, so each overflowing vertical scroller
// gets a real thumb that mouse and pen can drag outside its bounds.
(function(){
  const records=new Map();
  let syncQueued=false;
  const excluded='html,body,textarea,select,#tl-scroll,#tl-hscroll-track,#tl-hscroll-thumb';

  function scrollbarAxis(element){
    if(element?.id==='toolbar-palette-strip')return 'x';
    if(!(element instanceof HTMLElement)||element.matches(excluded))return null;
    const style=getComputedStyle(element);
    return style.overflowY==='auto'||style.overflowY==='scroll'?'y':null;
  }
  function panelZ(element){
    const owner=element.closest('.modal-overlay,.float-panel,.panel-stack,.floating-window');
    const value=owner?Number.parseInt(getComputedStyle(owner).zIndex,10):0;
    return (Number.isFinite(value)?value:0)+2;
  }
  function ensure(element){
    const axis=scrollbarAxis(element);
    if(records.has(element)||!axis)return;
    const track=document.createElement('div'),thumb=document.createElement('div'),local=element.id==='palette-grid';
    track.className='app-scrollbar-track app-scrollbar-track-'+axis+(local?' app-scrollbar-track-local':'');thumb.className='app-scrollbar-thumb';track.appendChild(thumb);(local?element.parentElement:document.body).appendChild(track);
    const record={element,track,thumb,local,axis,pointerId:null,startPointer:0,startScroll:0,maxScroll:0,travel:0,resizeObserver:null};records.set(element,record);
    const update=()=>updateRecord(record);element.addEventListener('scroll',update,{passive:true});
    thumb.addEventListener('pointerdown',event=>beginDrag(record,event));
    record.resizeObserver=new ResizeObserver(update);record.resizeObserver.observe(element);
    element.classList.add('app-scrollbar-source');update();
  }
  function updateRecord(record){
    const {element,track,thumb}=record;
    if(!element.isConnected){remove(record);return;}
    const rect=element.getBoundingClientRect(),horizontal=record.axis==='x';
    const maxScroll=horizontal?element.scrollWidth-element.clientWidth:element.scrollHeight-element.clientHeight;
    const visible=maxScroll>1&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.top<innerHeight&&rect.left<innerWidth&&getComputedStyle(element).visibility!=='hidden';
    track.hidden=!visible;if(!visible)return;
    if(horizontal){
      const height=5,trackWidth=Math.max(0,rect.width);
      track.style.left=Math.round(rect.left)+'px';track.style.right='auto';track.style.top=Math.round(rect.bottom+1)+'px';track.style.width=Math.round(trackWidth)+'px';track.style.height=height+'px';track.style.zIndex=String(panelZ(element));
      const thumbWidth=Math.max(24,trackWidth*(element.clientWidth/element.scrollWidth)),travel=Math.max(0,trackWidth-thumbWidth);
      thumb.style.width=Math.round(thumbWidth)+'px';thumb.style.height='100%';thumb.style.transform='translateX('+Math.round(travel?element.scrollLeft/maxScroll*travel:0)+'px)';
      return;
    }
    const width=6,inset=1,edgeInset=1.5,trackHeight=Math.max(0,rect.height-inset*2);
    const horizontalAnchor=element.matches('.tool-options-drawer-content')
      ?element.closest('.tool-options-drawer')?.getBoundingClientRect()||rect
      :rect;
    if(record.local){track.style.left='auto';track.style.right='2px';track.style.top=Math.round(element.offsetTop+inset)+'px';track.style.zIndex='6';}
    else{track.style.left=Math.round(horizontalAnchor.right-width-edgeInset)+'px';track.style.right='auto';track.style.top=Math.round(rect.top+inset)+'px';track.style.zIndex=String(panelZ(element));}
    track.style.width=width+'px';track.style.height=Math.round(trackHeight)+'px';
    const thumbHeight=Math.max(24,trackHeight*(element.clientHeight/element.scrollHeight)),travel=Math.max(0,trackHeight-thumbHeight);
    thumb.style.height=Math.round(thumbHeight)+'px';thumb.style.transform='translateY('+Math.round(travel?element.scrollTop/maxScroll*travel:0)+'px)';
  }
  function beginDrag(record,event){
    if(record.pointerId!==null||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();event.stopPropagation();
    const horizontal=record.axis==='x';
    record.pointerId=event.pointerId;record.startPointer=horizontal?event.clientX:event.clientY;record.startScroll=horizontal?record.element.scrollLeft:record.element.scrollTop;record.maxScroll=Math.max(0,horizontal?record.element.scrollWidth-record.element.clientWidth:record.element.scrollHeight-record.element.clientHeight);record.travel=Math.max(1,horizontal?record.track.clientWidth-record.thumb.offsetWidth:record.track.clientHeight-record.thumb.offsetHeight);record.previousScrollBehavior=record.element.style.scrollBehavior;record.element.style.scrollBehavior='auto';
    record.thumb.classList.add('is-dragging');document.body.classList.add('app-scrollbar-dragging');
    try{record.thumb.setPointerCapture(event.pointerId);}catch(_){}
    record.thumb.addEventListener('pointermove',moveDrag);
    record.thumb.addEventListener('pointerup',endDrag);record.thumb.addEventListener('pointercancel',endDrag);record.thumb.addEventListener('lostpointercapture',lostCapture);
    window.addEventListener('pointermove',moveDrag,{capture:true,passive:false});window.addEventListener('pointerup',endDrag,true);window.addEventListener('pointercancel',endDrag,true);
  }
  function activeRecord(pointerId){for(const record of records.values())if(record.pointerId===pointerId)return record;return null;}
  function moveDrag(event){const record=activeRecord(event.pointerId);if(!record)return;event.preventDefault();const horizontal=record.axis==='x',pointer=horizontal?event.clientX:event.clientY,next=record.startScroll+(pointer-record.startPointer)/record.travel*record.maxScroll;if(horizontal)record.element.scrollLeft=Math.max(0,Math.min(record.maxScroll,next));else record.element.scrollTop=Math.max(0,Math.min(record.maxScroll,next));}
  function lostCapture(event){const record=activeRecord(event.pointerId);if(!record)return;try{record.thumb.setPointerCapture(event.pointerId);}catch(_){}}
  function endDrag(event){const record=activeRecord(event.pointerId);if(!record)return;const id=record.pointerId;record.pointerId=null;try{if(record.thumb.hasPointerCapture(id))record.thumb.releasePointerCapture(id);}catch(_){}record.thumb.classList.remove('is-dragging');record.element.style.scrollBehavior=record.previousScrollBehavior||'';record.previousScrollBehavior=null;document.body.classList.remove('app-scrollbar-dragging');record.thumb.removeEventListener('pointermove',moveDrag);record.thumb.removeEventListener('pointerup',endDrag);record.thumb.removeEventListener('pointercancel',endDrag);record.thumb.removeEventListener('lostpointercapture',lostCapture);window.removeEventListener('pointermove',moveDrag,true);window.removeEventListener('pointerup',endDrag,true);window.removeEventListener('pointercancel',endDrag,true);updateRecord(record);}
  function remove(record){record.resizeObserver?.disconnect();record.track.remove();record.element.classList.remove('app-scrollbar-source');records.delete(record.element);}
  function scan(root=document){if(root instanceof HTMLElement&&scrollbarAxis(root))ensure(root);if(root.querySelectorAll)root.querySelectorAll('*').forEach(element=>{if(scrollbarAxis(element))ensure(element);});scheduleSync();}
  function scheduleSync(){if(syncQueued)return;syncQueued=true;requestAnimationFrame(()=>{syncQueued=false;records.forEach(updateRecord);});}
  new MutationObserver(mutations=>{let relevant=false;for(const mutation of mutations){if(mutation.type==='attributes'&&mutation.target.closest?.('.app-scrollbar-track'))continue;if(mutation.target instanceof HTMLElement)scan(mutation.target);mutation.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);});relevant=true;}if(relevant)scheduleSync();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  window.addEventListener('resize',scheduleSync);document.addEventListener('pointermove',event=>{if(event.buttons)scheduleSync();},{passive:true});window.addEventListener('panel-layout-changed',()=>scan(document));window.addEventListener('tool-changed',()=>scan(document));
  scan();
})();