// ════════════════════════════════════════════════════════════════
// FLOOD FILL
// ════════════════════════════════════════════════════════════════
function floodFill(x,y,fc){
  const img=ctx.getImageData(0,0,CW,CH),d=img.data;
  const px=Math.max(0,Math.min(CW-1,Math.round(x)));
  const py=Math.max(0,Math.min(CH-1,Math.round(y)));
  const i=(py*CW+px)*4;
  const tr=d[i],tg=d[i+1],tb=d[i+2],ta=d[i+3];
  const fr=parseInt(fc.slice(1,3),16),fg=parseInt(fc.slice(3,5),16),fb=parseInt(fc.slice(5,7),16);
  if(tr===fr&&tg===fg&&tb===fb&&ta===255) return;
  const stack=[[px,py]];
  while(stack.length){
    const[cx,cy]=stack.pop();
    if(cx<0||cx>=CW||cy<0||cy>=CH) continue;
    const j=(cy*CW+cx)*4;
    if(d[j]!==tr||d[j+1]!==tg||d[j+2]!==tb||d[j+3]!==ta) continue;
    d[j]=fr;d[j+1]=fg;d[j+2]=fb;d[j+3]=255;
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  ctx.putImageData(img,0,0);
}

// ════════════════════════════════════════════════════════════════
// LAYER CANVAS
// ════════════════════════════════════════════════════════════════
function mkLayerCanvas(){const o=document.createElement('canvas');o.width=CW;o.height=CH;return o;}
// PERF FIX: recomposite() runs on every animation frame while a stroke is in
// progress (RAF-scheduled from pointermove). Previously, every group-clipped
// or layer-clipped (stencil) layer caused 1-2 brand-new full-resolution
// (e.g. 1920×1080) <canvas> elements to be allocated EVERY frame just to
// build a temporary mask/result buffer, then thrown away — serious GC
// churn and allocation cost piling up 60×/sec while drawing, on top of the
// actual compositing work. Reuse two persistent scratch canvases instead;
// they're only resized (re-allocated) when the document's canvas size
// actually changes, and cleared (not reallocated) before each reuse.
let _scratchMask=null,_scratchTmp=null;
function _ensureScratchCanvases(){
  if(!_scratchMask||_scratchMask.width!==CW||_scratchMask.height!==CH) _scratchMask=mkLayerCanvas();
  if(!_scratchTmp||_scratchTmp.width!==CW||_scratchTmp.height!==CH) _scratchTmp=mkLayerCanvas();
}
function getExactKey(li,fi){return layers[li].frames[fi]||null;}
function getHeldKey(li,fi){for(let f=fi;f>=0;f--)if(layers[li].frames[f])return layers[li].frames[f];return null;}

// ── Group-to-group clip helpers ───────────────────────────────
// If a layer has no clip of its own but belongs to a group that is itself
// clipped to another group, the layer inherits that group's clip for masking
// purposes (so every member of the clipped group gets masked individually,
// the same way a layer-to-group clip already works).
function _effectiveLayerClip(l){
  if(l.stencil!=='none') return {stencil:l.stencil,clipTo:l.clipTo,clipToGroup:l.clipToGroup};
  if(l.groupId){
    // Walk up the full ancestor chain (innermost first) — the nearest ancestor
    // folder with an active clip/stencil wins, same way a direct parent group did before.
    for(const gid of [..._groupChain(l.groupId)].reverse()){
      const g=groups.find(gr=>gr.id===gid);
      if(g&&g.stencil&&g.stencil!=='none'){
        if(g.clipToGroup){
          return {stencil:g.stencil==='outside'?'group-outside':'group-inside',clipTo:null,clipToGroup:g.clipToGroup};
        }
        if(g.clipTo!=null&&layers[g.clipTo]){
          return {stencil:g.stencil==='outside'?'outside':'inside',clipTo:g.clipTo,clipToGroup:null};
        }
      }
    }
  }
  return {stencil:'none',clipTo:null,clipToGroup:null};
}
// True if group `gid` is being used as the mask source for some OTHER group's clip.
function _groupUsedAsGroupMaskSource(gid){
  return groups.some(g2=>g2.id!==gid&&g2.clipToGroup===gid&&g2.stencil&&g2.stencil!=='none');
}

function createBlankKey(){
  if(!layers[curLayer].frames[curFrame]){layers[curLayer].frames[curFrame]=mkLayerCanvas();ctx.clearRect(0,0,CW,CH);renderTimeline();updateStatus();}
}
function ensureKey(){
  if(!layers[curLayer].frames[curFrame]){layers[curLayer].frames[curFrame]=mkLayerCanvas();ctx.clearRect(0,0,CW,CH);renderTimeline();updateStatus();}
}
function saveActiveToKey(){
  const kf=layers[curLayer].frames[curFrame];if(!kf) return;
  const kctx=kf.getContext('2d');kctx.clearRect(0,0,CW,CH);kctx.drawImage(activeC,0,0);
}

function loadFrame(li,fi){
  ctx.clearRect(0,0,CW,CH);
  const k=getHeldKey(li,fi);if(k) ctx.drawImage(k,0,0);
  recomposite(li,fi);updateOnion();updatePlayhead();
  document.getElementById('frame-info').textContent='Frame '+(fi+1)+' / '+TOTAL;
  updateStatus();
}
// PERF: recomposite() now accepts an optional `dirtyRect` ({x,y,w,h} in
// canvas pixel space). When provided, the expensive per-layer compositing
// loop below (which is what actually costs time — multiple canvas
// allocations/clears for masked layers, N drawImage calls, etc.) is
// clipped to that region via compCtx.clip(), so a single dab's worth of
// change only re-touches the pixels around it instead of the entire
// document, every single animation frame while a stroke is in progress.
// When dirtyRect is omitted/null (every existing call site: loadFrame,
// switchLayer, tool actions, undo, etc.), behavior is 100% unchanged —
// full-canvas recomposite exactly as before. drawBg() and every layer draw
// call is untouched code-wise; clip() just restricts which pixels those
// same calls are allowed to touch, so compositing, masks, clipping,
// opacity and blend order are all identical to the full-canvas path.
function recomposite(li,fi,dirtyRect){
  const clip = (dirtyRect && dirtyRect.w>0 && dirtyRect.h>0) ? dirtyRect : null;
  if(clip){
    compCtx.save();
    compCtx.beginPath();
    compCtx.rect(clip.x,clip.y,clip.w,clip.h);
    compCtx.clip();
  }
  drawBg();
  _ensureScratchCanvases();
  const curLForMask=layers[li];
  const curIsMaskForCheck=curLForMask&&(layers.some(ol=>ol!==curLForMask&&ol.stencil!=='none'&&ol.clipTo===li)||groups.some(g=>g.clipTo===li&&g.stencil&&g.stencil!=='none'));
  // Draw layers bottom-to-top (index 0 = bottom, length-1 = top visually)
  // But the panel shows them top=highest index, so we draw 0..length-1
  for(let idx=0;idx<layers.length;idx++){
    const l=layers[idx];
    if(typeof _tfHiddenLayers!=='undefined'&&_tfHiddenLayers.has(idx)) continue;
    const grp=l.groupId?groups.find(g=>g.id===l.groupId):null;
    const layerVisible=l.visible&&_layerGroupChainVisible(l);
    const layerAlpha=(l.opacity??1)*_layerGroupChainOpacity(l);
    const eff=_effectiveLayerClip(l);

    // Determine what to draw: active layer uses activeC, others use stored key
    let srcCanvas;
    if(idx===li){
      if(!layerVisible){activeC.style.opacity='0';continue;}
      const isGrpStencil=(eff.stencil==='group-inside'||eff.stencil==='group-outside')&&eff.clipToGroup;
      const isCurGrpMask=l.groupId&&(layers.some(ol=>ol.clipToGroup===l.groupId&&(ol.stencil==='group-inside'||ol.stencil==='group-outside'))||_groupUsedAsGroupMaskSource(l.groupId));
      activeC.style.opacity='0';
      // Mid-stroke, dabs live on the offscreen stroke-scratch canvas (not
      // activeC) until pointerup commits them — see brush-engine.js. Use
      // the live preview (activeC + in-progress stroke, pre-blended at
      // brushOpacity) so the stroke is visible as it's drawn instead of
      // only appearing once the stroke ends.
      srcCanvas=(typeof _inStroke!=='undefined'&&_inStroke&&typeof _getLiveStrokePreview==='function')
        ? _getLiveStrokePreview()
        : activeC;
    } else {
      if(!layerVisible) continue;
      srcCanvas=getHeldKey(idx,fi);
      if(!srcCanvas) continue;
    }

    // Apply stencil clipping if set
    if((eff.stencil==='group-inside'||eff.stencil==='group-outside')&&eff.clipToGroup){
      // Merge all visible layers of the target group into a single mask canvas
      const maskCanvas=_scratchMask;const mc=maskCanvas.getContext('2d');mc.clearRect(0,0,CW,CH);
      layers.forEach((ml,mi)=>{
        if(ml.groupId!==eff.clipToGroup) return;
        const mgrp=groups.find(g=>g.id===ml.groupId);
        if(!ml.visible||!mgrp||!mgrp.visible) return;
        const ms=mi===li?activeC:getHeldKey(mi,fi);
        if(ms){mc.globalAlpha=ml.opacity??1;mc.drawImage(ms,0,0);mc.globalAlpha=1;}
      });
      const tmp=_scratchTmp;const tc=tmp.getContext('2d');tc.clearRect(0,0,CW,CH);
      tc.drawImage(srcCanvas,0,0);
      tc.globalCompositeOperation=eff.stencil==='group-inside'?'destination-in':'destination-out';
      tc.drawImage(maskCanvas,0,0);
      tc.globalCompositeOperation='source-over';
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(tmp,0,0);
      compCtx.globalAlpha=1;
      continue;
    }
    if(eff.stencil!=='none'&&eff.stencil!=='group-inside'&&eff.stencil!=='group-outside'&&eff.clipTo!=null&&layers[eff.clipTo]){
      const maskCanvas=eff.clipTo===li?activeC:getHeldKey(eff.clipTo,fi);
      if(maskCanvas){
        const tmp=_scratchTmp;const tc=tmp.getContext('2d');tc.clearRect(0,0,CW,CH);
        tc.drawImage(srcCanvas,0,0);
        // inside = destination-in keeps only pixels where mask is opaque (alpha>0)
        // outside = destination-out keeps only pixels where mask is transparent
        tc.globalCompositeOperation=eff.stencil==='inside'?'destination-in':'destination-out';
        tc.drawImage(maskCanvas,0,0);
        tc.globalCompositeOperation='source-over';
        compCtx.globalAlpha=layerAlpha;
        compCtx.drawImage(tmp,0,0);
        compCtx.globalAlpha=1;
        continue;
      }
    }

    const curIsGrpMask=idx===li&&l.groupId&&(layers.some(ol=>ol.clipToGroup===l.groupId&&(ol.stencil==='group-inside'||ol.stencil==='group-outside'))||_groupUsedAsGroupMaskSource(l.groupId));
    // Always draw into composite at the correct stack position (including active layer).
    // activeC itself stays hidden (opacity 0) the whole time now — its pixels are only
    // ever shown via this draw into compC, never as a separate DOM-topmost overlay.
    if(idx!==li||curIsMaskForCheck||curIsGrpMask){
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(srcCanvas,0,0);
      compCtx.globalAlpha=1;
    } else {
      // Active layer, not a mask — draw into composite at its proper z-position
      compCtx.globalAlpha=layerAlpha;
      compCtx.drawImage(srcCanvas,0,0);
      compCtx.globalAlpha=1;
    }
  }
  compCtx.globalAlpha=1;
  // activeC's content is already baked into compC at the correct stack position
  // by the loop above, so keep it hidden — showing it again here (it's always the
  // topmost DOM canvas) made mask-source layers render in front of whatever was
  // clipped to them whenever that layer was selected.
  activeC.style.opacity=0;

  if(clip) compCtx.restore();

  // Final blit to the visible canvas is always full-canvas, unchanged from
  // before: it's a single cheap drawImage (plus optional blur filter), and
  // keeping it whole avoids any blur-edge seam at the dirty-rect boundary.
  // compC itself already only had its dirty region touched above, so
  // everything outside that region is simply the unchanged prior frame.
  displayCtx.clearRect(0,0,CW,CH);
  displayCtx.filter = _displayBlurPx>0.05 ? `blur(${_displayBlurPx}px)` : 'none';
  displayCtx.drawImage(compC,0,0);
  displayCtx.filter='none';
}
function goToFrame(f,addSel,noSel){
  saveActiveToKey();curFrame=Math.max(0,Math.min(TOTAL-1,f));
  if(!noSel){if(!addSel) selectedFrames.clear();selectedFrames.add(curFrame);}
  loadFrame(curLayer,curFrame);renderTimeline();
}
function switchLayer(li){
  saveActiveToKey();curLayer=li;activeGroupId=null;selectedGroupIds.clear();layerShiftAnchor=li;groupShiftAnchor=null;
  loadFrame(curLayer,curFrame);syncOpacityControls();renderLayerPanel();renderTimeline();
}

// ════════════════════════════════════════════════════════════════
// GENERIC FLOATING / DOCKABLE PANEL MANAGER
// Powers the Tools, Color, Brush Presets, and Layers panels: free
// float anywhere over the canvas, snap-dock to any of the 4 canvas
// edges, and drag-to-merge into tabbed groups (Photoshop/Clip Studio
// style).
//
// ── ARCHITECTURE ────────────────────────────────────────────────
// Previously, "docked or floating", "which side", "stacking order",
// and "size" were all inferred on demand from a mix of CSS classes,
// inline styles, DOM order, and a `_mergedInto` pointer stashed on
// each element. Several independent call sites (this file, and two
// more resize implementations in ui-controls.js) each read *and*
// wrote that scattered state, which is what caused drop layouts to
// come out wrong, panels to overlap/collapse, resizing to fight
// itself, and floating/docked state to desync.
//
// This version keeps ONE authoritative model — a small layout tree —
// and everything else (CSS classes, inline styles, resize handles)
// is a deterministic *projection* of it, recomputed by render().
// Nothing outside this module is allowed to mutate panel dock state
// directly any more; ui-controls.js's per-panel resize handles now
// call FloatPanels.resizePanel()/resizeFloating() instead of poking
// styles and calling a reflow function by hand.
//
//   dockOrder[side] : string[]        — ordered keys docked to that edge
//   dockSize[key]   : number          — px size along that edge's cross-axis
//   floatRect[key]  : {x,y,w,h}       — px rect while floating
//   panelMode[key]  : 'docked' | 'floating' | 'merged'
//   mergedHost[key] : key of the shell hosting this panel's tab (if merged)
//   hiddenState[key]: bool            — explicitly closed (Window menu / ✕)
//
// A panel's *rendered* classes/styles are always fully rebuilt from
// this state in render(); nothing reads live layout back out of the
// DOM to decide what to do next (the old code's `panel.offsetWidth`,
// `classList.contains(...)`, and getBoundingClientRect() reads during
// drag *math* still happen — that's just measuring the mouse against
// other panels' current geometry — but the panel's OWN state is never
// derived from its own rendered DOM after the fact).
// ════════════════════════════════════════════════════════════════
const FloatPanels=(function(){
  const DOCK_TRIGGER=52;       // px from canvas edge that previews an edge-dock
  const dz={left:document.getElementById('fp-dz-left'),right:document.getElementById('fp-dz-right'),
            top:document.getElementById('fp-dz-top'),bottom:document.getElementById('fp-dz-bottom')};
  const mergeZoneEl=document.getElementById('fp-mergezone');
  const allPanels=[]; // every top-level .float-panel element (one per registered panel)
  const titles={};    // panelKey -> display title, for rebuilding tabs

  // ── Authoritative state (single source of truth) ────────────────
  const dockOrder={left:[],right:[],top:[],bottom:[]};
  const dockSize={};
  const floatRect={};
  const panelMode={};
  const mergedHost={};
  const hiddenState={};

  // ── Vertical sub-split state ─────────────────────────────────────
  // splitChildren[hostKey] = [childKey, ...] — panels stacked vertically
  //   INSIDE the host's rendered column (left/right dock only for now).
  //   The host takes the top portion, children fill remaining height top→down.
  // splitSize[childKey] = px — height of this child in the split stack.
  //   When null/missing the child gets 50% of remaining space after the host.
  // splitHost[childKey] = hostKey — reverse lookup.
  const splitChildren={};  // hostKey → [childKey,…]
  const splitSize={};      // childKey → px height
  const splitHost={};      // childKey → hostKey

  // Per-panel behavior config. `fixedSize`: docked size never changes
  // (Tools panel is a fixed 40px rail on left/right). `minSize`/`maxSize`:
  // clamp for docked cross-axis resize. `floatResizable`: whether the 4
  // floating edge-handles are attached at all (only Tools + Layers had
  // free-floating resize before; preserved as-is, not expanded).
  const PANEL_CFG={
    tools:        {minSize:38,  maxSize:400, floatResizable:true,  contentFitHeight:true},
    'brush-presets':{minSize:150,maxSize:500, floatResizable:true},
    layers:       {minSize:120, maxSize:500, floatResizable:true},
    color:        {minSize:120, maxSize:500, floatResizable:false},
    'keyframe-switcher':{minSize:120,maxSize:500,floatResizable:true},
  };
  function cfgOf(key){ return PANEL_CFG[key]||{minSize:120,maxSize:500}; }

  function panelByKey(key){ return allPanels.find(p=>p.dataset.panel===key)||null; }
  function registerTitle(panelEl){titles[panelEl.dataset.panel]=panelEl.querySelector('.fp-name').textContent;}

  // ── Split state helpers ──────────────────────────────────────────
  function _removeSplitChild(childKey){
    const host=splitHost[childKey];
    if(host&&splitChildren[host]){
      const idx=splitChildren[host].indexOf(childKey);
      if(idx!==-1) splitChildren[host].splice(idx,1);
      if(splitChildren[host].length===0) delete splitChildren[host];
    }
    delete splitHost[childKey];
    delete splitSize[childKey];
  }
  function _addSplitChild(hostKey,childKey,afterChildKey){
    _removeSplitChild(childKey);
    if(!splitChildren[hostKey]) splitChildren[hostKey]=[];
    const arr=splitChildren[hostKey];
    if(afterChildKey){
      const i=arr.indexOf(afterChildKey);
      arr.splice(i>=0?i+1:arr.length,0,childKey);
    } else {
      arr.push(childKey);
    }
    splitHost[childKey]=hostKey;
    if(splitSize[childKey]==null) splitSize[childKey]=180;
  }
  function _isSplitChild(key){ return !!splitHost[key]; }
  function _splitHostOf(key){ return splitHost[key]||null; }
  // Return all visible split children for a host in order
  function _splitChildrenOf(hostKey){
    return (splitChildren[hostKey]||[]).filter(k=>!hiddenState[k]);
  }

  // Stack zone: blue outline on the bottom half of a specific docked panel,
  // previewing a vertical sub-split drop.
  const stackZoneEl=(function(){
    const el=document.createElement('div');
    el.className='fp-stackzone';
    el.style.display='none';
    document.body.appendChild(el);
    return el;
  })();
  function showStackZone(targetPanel,pos){
    const r=targetPanel.getBoundingClientRect();
    // Box outline on the top or bottom edge of the panel (like CSP/Krita dock preview)
    const y=pos==='before'?r.top-2:r.bottom-2;
    stackZoneEl.style.cssText=`position:fixed;left:${r.left}px;top:${y}px;width:${r.width}px;height:4px;display:block;pointer-events:none;z-index:10000;background:var(--accent);border-radius:3px;`;
  }
  function hideStackZone(){ stackZoneEl.style.display='none'; }

  function hideZones(){Object.values(dz).forEach(z=>z.classList.remove('show'));mergeZoneEl.classList.remove('show');hideStackZone();}
  function showEdgeZone(side,edgeOffset){
    hideZones();
    if(!side) return;
    const z=dz[side];
    const car=canvasArea.getBoundingClientRect();
    const off=edgeOffset||0;
    // Use fixed positioning so the line renders at the real screen seam
    // between panels, not relative to canvasArea's interior.
    // Center the 4px bar on the seam by subtracting 2px.
    if(side==='left'){
      const x=car.left+off-2;
      z.style.cssText=`position:fixed;left:${x}px;top:${car.top}px;height:${car.height}px;width:4px;`;
    } else if(side==='right'){
      const x=car.right-off-2;
      z.style.cssText=`position:fixed;left:${x}px;top:${car.top}px;height:${car.height}px;width:4px;`;
    } else if(side==='top'){
      const y=car.top+off-2;
      z.style.cssText=`position:fixed;top:${y}px;left:${car.left}px;width:${car.width}px;height:4px;`;
    } else if(side==='bottom'){
      const y=car.bottom-off-2;
      z.style.cssText=`position:fixed;top:${y}px;left:${car.left}px;width:${car.width}px;height:4px;`;
    }
    z.classList.add('show');
  }
  function showMergeZone(targetPanel){
    hideZones();
    const car=canvasArea.getBoundingClientRect();
    const r=targetPanel.getBoundingClientRect();
    mergeZoneEl.style.cssText=`left:${r.left-car.left}px;top:${r.top-car.top}px;width:${r.width}px;height:${r.height}px;`;
    mergeZoneEl.classList.add('show');
  }

  // ── State-mutation primitives (the ONLY functions allowed to change
  // dockOrder / floatRect / panelMode) ────────────────────────────
  function _removeFromAllDockOrders(key){
    // Capture where key was docked BEFORE we remove it, so if it was a
    // stack host we can hand its slot to the next-in-line child instead of
    // just orphaning everyone to floating.
    let hostSide=null,hostIndex=-1;
    ['left','right','top','bottom'].forEach(s=>{
      const i=dockOrder[s].indexOf(key);
      if(i!==-1){hostSide=s;hostIndex=i;dockOrder[s].splice(i,1);}
    });
    // Also remove from vertical split state
    _removeSplitChild(key);
    // If key was a split host, promote its first remaining child to take
    // over its dock slot (same side/index/dockSize) so the stack keeps
    // occupying the docker instead of collapsing to floating — the
    // remaining children re-parent under the promoted one.
    if(splitChildren[key]){
      const orphans=[...splitChildren[key]];
      delete splitChildren[key];
      const promoted=orphans.shift();
      if(promoted&&hostSide){
        delete splitHost[promoted];
        panelMode[promoted]='docked';
        dockOrder[hostSide].splice(hostIndex,0,promoted);
        dockSize[promoted]=dockSize[key];
        orphans.forEach(ck=>_addSplitChild(promoted,ck));
      } else {
        // No dock slot to hand off (key wasn't actually docked anywhere,
        // e.g. it was already floating) — fall back to floating them.
        orphans.forEach(ck=>{
          delete splitHost[ck];
          if(panelMode[ck]==='docked'){
            panelMode[ck]='floating';
            _removeFromAllDockOrders(ck);
          }
        });
      }
    }
  }
  function dockPanel(key,side,atIndex){
    _removeFromAllDockOrders(key);
    delete mergedHost[key];
    panelMode[key]='docked';
    if(atIndex==null||atIndex<0||atIndex>dockOrder[side].length) dockOrder[side].push(key);
    else dockOrder[side].splice(atIndex,0,key);
    if(dockSize[key]==null){
      const cfg=cfgOf(key);
      dockSize[key]=(key==='tools')?40:Math.min(cfg.maxSize,Math.max(cfg.minSize,220));
    }
  }
  function undockToFloat(key,x,y,w,h){
    _removeFromAllDockOrders(key);
    delete mergedHost[key];
    panelMode[key]='floating';
    floatRect[key]=Object.assign(floatRect[key]||{},{x,y});
    if(w!=null) floatRect[key].w=w;
    // Tools panel auto-fits height to its own content when it becomes a
    // free-floating window (matches its old fitHeightToContent behavior),
    // unless the caller explicitly passed a height (a user-driven floating
    // resize should stick, not get silently overridden back to fit-content).
    if(h!=null) floatRect[key].h=h;
    else if(key==='tools') floatRect[key].h=_toolsMinHeight();
  }
  function markMerged(key,hostKey){
    _removeFromAllDockOrders(key);
    panelMode[key]='merged';
    mergedHost[key]=hostKey;
  }
  function clearMerged(key){
    delete mergedHost[key];
    // Caller is responsible for immediately calling undockToFloat/dockPanel
    // afterward — merged panels always resolve into exactly one of those.
  }

  // ── Render: rebuild every panel's classes/styles from state ─────
  function render(){
    ['left','right','top','bottom'].forEach(renderSide);
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const mode=panelMode[key];
      if(mode==='floating'){
        panel.classList.remove('dock-left','dock-right','dock-top','dock-bottom','docked');
        const r=floatRect[key]||{x:16,y:16};
        panel.style.left=r.x+'px'; panel.style.top=r.y+'px';
        panel.style.right=''; panel.style.bottom='';
        panel.style.width=r.w!=null?r.w+'px':(panel._savedWidth||panel.style.width||'');
        panel.style.height=r.h!=null?r.h+'px':(panel.style.height||'');
      }
      // Split children are positioned by renderSide; hide their split handle if not split
      if((!_isSplitChild(key)||hiddenState[key])&&panel._splitResizeEl){
        panel._splitResizeEl.style.display='none';
      }
      const visuallyHidden=!!hiddenState[key]||mode==='merged';
      panel.classList.toggle('fp-hidden',visuallyHidden);
      _syncDockResizeHandle(panel);
    });
    if(typeof centerCanvas==='function') centerCanvas();
  }

  function renderSide(side){
    let offset=0;
    dockOrder[side].forEach(key=>{
      const panel=panelByKey(key);
      if(!panel||hiddenState[key]) return;
      panel.classList.remove('dock-left','dock-right','dock-top','dock-bottom');
      panel.classList.add('dock-'+side,'docked');
      panel.style.left='';panel.style.right='';panel.style.top='';panel.style.bottom='';
      const size=dockSize[key];
      if(side==='left')  panel.style.left=offset+'px';
      if(side==='right') panel.style.right=offset+'px';
      if(side==='top')   panel.style.top=offset+'px';
      if(side==='bottom')panel.style.bottom=offset+'px';

      // ── Vertical sub-split (left/right columns only) ──────────────
      // If this panel has split children, divide the full column height
      // between host and children with a resize handle between each pair.
      if((side==='left'||side==='right')&&_splitChildrenOf(key).length>0){
        const children=_splitChildrenOf(key);
        // Sum of all child heights
        const totalChildPx=children.reduce((s,ck)=>s+(splitSize[ck]||180),0);
        // Host gets remaining height; children get their splitSize each.
        // We use top/height inline style to set positions within the column.
        panel.style.width=size+'px';
        panel.style.position='absolute';
        // Host height = 100% - totalChildPx (expressed via calc, but calc
        // won't update when the window resizes unless we set it in px. We'll
        // let it be '': full height minus a data-bottom offset handled by CSS.)
        // Simplest: use top:0, height:'calc(100% - Xpx)' for the host.
        panel.style.height=`calc(100% - ${totalChildPx}px)`;
        panel.style.top='0';
        panel.style.bottom='';

        // Position each child below the host
        let childTop=`calc(100% - ${totalChildPx}px)`;
        let cumulativePx=0;
        children.forEach((ck,ci)=>{
          const cp=panelByKey(ck);
          if(!cp||hiddenState[ck]) return;
          cp.classList.remove('dock-left','dock-right','dock-top','dock-bottom');
          cp.classList.add('dock-'+side,'docked');
          cp.style.left='';cp.style.right='';cp.style.top='';cp.style.bottom='';
          cp.style.width=size+'px';
          cp.style.position='absolute';
          const prevChildrenPx=children.slice(0,ci).reduce((s,k)=>s+(splitSize[k]||180),0);
          cp.style.top=`calc(100% - ${totalChildPx - prevChildrenPx}px)`;
          cp.style.height=(splitSize[ck]||180)+'px';
          if(side==='left') cp.style.left=offset+'px';
          if(side==='right') cp.style.right=offset+'px';
          cp.style.bottom='';
          // Attach (or move) the split resize handle between host and this child
          _syncSplitResizeHandle(key,ck,side,offset,size);
          _syncDockResizeHandle(cp);
        });
        offset+=size;
        return; // skip the normal width/height assignment below
      }

      if(side==='left'||side==='right'){
        panel.style.width=size+'px';
        panel.style.height='';
        panel.style.position='';
        panel.style.top='';
      } else {
        panel.style.width='';
        panel.style.height=size+'px';
      }
      offset+=size;
    });
    // Tools panel docked top/bottom sizes itself to its content rather than
    // a user-set px value; recompute that size AFTER the geometric pass
    // above so its neighbors already have correct left/right offsets, then
    // do one corrective re-pass so nothing after it inherits a stale offset.
    if((side==='top'||side==='bottom')&&dockOrder[side].includes('tools')){
      const tp=panelByKey('tools');
      if(tp){
        const tb=tp.querySelector('.fp-titlebar');
        const bd=document.getElementById('tools-panel-body');
        const tbH=tb?tb.offsetHeight:0, bodyH=bd?bd.scrollHeight:0;
        const fitH=tbH+bodyH;
        if(dockSize.tools!==fitH){ dockSize.tools=fitH; renderSide(side); return; }
      }
    }
  }

  function applyDock(panel,side,atIndex){
    const key=panel.dataset.panel;
    if(panelMode[key]==='docked'){
      const cur=['left','right','top','bottom'].find(s=>dockOrder[s].includes(key));
      const curIdx=cur?dockOrder[cur].indexOf(key):-1;
      if(cur===side&&(atIndex==null||atIndex===curIdx||atIndex===curIdx+1)) return; // no real change
    }
    dockPanel(key,side,atIndex);
    render();
    _saveLayout();
  }
  // Stack panel with a specific docked panel (vertical sub-split).
  // pos:'after' (default) stacks `panel` below targetPanel, as targetPanel's
  // (or its existing host's) child — same as before.
  // pos:'before' stacks `panel` above targetPanel: `panel` takes over
  // targetPanel's dock slot and becomes the new host, with targetPanel
  // (and anything already stacked under it) becoming its children.
  function applyStackDock(panel,targetPanel,pos){
    const key=panel.dataset.panel;
    const targetKey=targetPanel.dataset.panel;
    // Determine which side the target is docked on
    const side=['left','right','top','bottom'].find(s=>dockOrder[s].includes(targetKey));
    if(!side||(side!=='left'&&side!=='right')) return; // only support left/right for now

    if(pos==='before'){
      const idx=dockOrder[side].indexOf(targetKey);
      const oldChildren=splitChildren[targetKey]?[...splitChildren[targetKey]]:[];
      const targetWidth=dockSize[targetKey];
      // Pull the dragged panel out of wherever it currently lives (if it
      // was itself a stack host, this correctly hands its old slot off to
      // one of its own children rather than orphaning them — see
      // _removeFromAllDockOrders).
      _removeFromAllDockOrders(key);
      // Pull target out of its slot too, WITHOUT touching its children's
      // records yet — we're about to explicitly re-parent them under `key`.
      const ti=dockOrder[side].indexOf(targetKey);
      if(ti!==-1) dockOrder[side].splice(ti,1);
      delete splitChildren[targetKey];
      panelMode[key]='docked';
      dockOrder[side].splice(idx,0,key);
      dockSize[key]=targetWidth;
      _addSplitChild(key,targetKey);
      oldChildren.forEach(ck=>_addSplitChild(key,ck));
      render();
      _saveLayout();
      return;
    }

    // Ensure the dragged panel is removed from all dock orders and splits
    _removeFromAllDockOrders(key);
    // Now dock it on the same side so dockSize is maintained, but mark as split child
    panelMode[key]='docked';
    dockOrder[side]; // don't add to dockOrder — it's positioned by the split system
    if(dockSize[key]==null) dockSize[key]=cfgOf(key).minSize||180;
    _addSplitChild(targetKey,key);
    // Make sure splitSize is seeded
    if(!splitSize[key]) splitSize[key]=180;
    render();
    _saveLayout();
  }

  function floatAt(panel,x,y){
    const key=panel.dataset.panel;
    undockToFloat(key,x,y);
    render();
    _saveLayout();
  }

  // Let a panel with its own bespoke resize logic (e.g. the Color panel's
  // wheel-fit resize handles) report its current floating size back into
  // floatRect — the single source of truth render() reads from. Without
  // this, any unrelated render() pass (docking/undocking another panel,
  // switching tabs, etc.) would blank the panel's size back to its last
  // known floatRect value (or auto), fighting with whatever the panel's
  // own resize code had just set. Deliberately does NOT call render() or
  // _saveLayout() itself — callers drive their own live-resize/pointerup
  // cadence exactly like bindFloatingResize does.
  function setFloatSize(key,w,h){
    if(panelMode[key]!=='floating') return;
    floatRect[key]=Object.assign(floatRect[key]||{},
      {w:w!=null?w:(floatRect[key]&&floatRect[key].w),h:h!=null?h:(floatRect[key]&&floatRect[key].h)});
  }
  function getFloatSize(key){
    const r=floatRect[key];
    return r?{w:r.w,h:r.h}:null;
  }

  // ── Tab management ────────────────────────────────────────────
  function tabbarOf(panel){return panel.querySelector('.fp-tabbar');}
  function bodyWrapOf(panel){return panel.querySelector('.fp-body-wrap');}
  function nameOf(panel){return panel.querySelector('.fp-name');}

  function refreshTabbarVisibility(panel){
    const tb=tabbarOf(panel);
    const count=tb.children.length;
    tb.style.display=count>1?'flex':'none';
    if(count>1){
      const activeTab=tb.querySelector('.fp-tab.active');
      if(activeTab) nameOf(panel).textContent=titles[activeTab.dataset.key]||activeTab.textContent;
    } else {
      nameOf(panel).textContent=titles[panel.dataset.panel];
    }
  }

  function activateTab(panel,key){
    bodyWrapOf(panel).querySelectorAll('.fp-body').forEach(b=>b.classList.toggle('active',b.dataset.body===key));
    tabbarOf(panel).querySelectorAll('.fp-tab').forEach(t=>t.classList.toggle('active',t.dataset.key===key));
    refreshTabbarVisibility(panel);
  }

  function addTab(hostPanel,key){
    const tb=tabbarOf(hostPanel);
    if(tb.querySelector(`.fp-tab[data-key="${key}"]`)) return;
    const tab=document.createElement('div');
    tab.className='fp-tab';tab.dataset.key=key;tab.textContent=titles[key]||key;
    tab.title='Drag out to undock this tab';
    bindTabDrag(tab,hostPanel);
    tab.addEventListener('click',()=>{if(!tab._justDragged) activateTab(hostPanel,key);});
    tb.appendChild(tab);
  }

  // Merge sourcePanel (an entire shell, possibly itself holding several tabs)
  // into targetPanel: move all of its fp-body nodes + tabs across, hide its
  // shell, and record the merge in state (not just a DOM pointer).
  function mergeInto(sourcePanel,targetPanel){
    if(sourcePanel===targetPanel) return;
    const srcKey=sourcePanel.dataset.panel, targetKey=targetPanel.dataset.panel;
    const srcWrap=bodyWrapOf(sourcePanel);
    const srcTabs=tabbarOf(sourcePanel);
    const bodies=[...srcWrap.querySelectorAll('.fp-body')];
    const keys=bodies.map(b=>b.dataset.body);
    const existingTargetBodies=[...bodyWrapOf(targetPanel).querySelectorAll('.fp-body')];
    if(tabbarOf(targetPanel).children.length===0){
      existingTargetBodies.forEach(b=>addTab(targetPanel,b.dataset.body));
      const activeExisting=existingTargetBodies.find(b=>b.classList.contains('active'))||existingTargetBodies[0];
      if(activeExisting) activateTab(targetPanel,activeExisting.dataset.body);
    }
    bodies.forEach(b=>{b.classList.remove('active');bodyWrapOf(targetPanel).appendChild(b);});
    keys.forEach(k=>addTab(targetPanel,k));
    srcTabs.innerHTML='';
    activateTab(targetPanel,keys[keys.length-1]);
    // Every key that physically moved (including keys that were already
    // tabbed inside sourcePanel before this merge) now reports targetKey
    // as its host — recomputed from what's actually in targetPanel right
    // now, so multi-level merges stay consistent with the DOM.
    [...bodyWrapOf(targetPanel).querySelectorAll('.fp-body')].forEach(b=>{
      if(b.dataset.body===targetKey) return; // the host's own body isn't "merged into" anything
      markMerged(b.dataset.body,targetKey);
    });
    setWindowCheck(srcKey,false,true); // hidden via merge, not via close
    render();
    _saveLayout();
  }

  // Pop a tab (by key) out of its current host into its own floating shell at (x,y)
  function popOutTab(hostPanel,key,x,y){
    const ownShell=panelByKey(key);
    const body=bodyWrapOf(hostPanel).querySelector(`.fp-body[data-body="${key}"]`);
    if(!ownShell||!body) return;
    const tabEl=tabbarOf(hostPanel).querySelector(`.fp-tab[data-key="${key}"]`);
    if(tabEl) tabEl.remove();
    bodyWrapOf(ownShell).appendChild(body);
    body.classList.add('active');
    refreshTabbarVisibility(hostPanel);
    const remaining=[...bodyWrapOf(hostPanel).querySelectorAll('.fp-body')];
    if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(hostPanel,remaining[0].dataset.body);
    clearMerged(key);
    const w=ownShell._savedWidth?parseFloat(ownShell._savedWidth):null;
    undockToFloat(key,x,y,w,null);
    hiddenState[key]=false;
    render();
    bringToFront(ownShell);
    setWindowCheck(key,true);
    _saveLayout();
  }

  let zTop=700;
  function bringToFront(panel){zTop++;panel.style.zIndex=zTop;}

  let windowCheckHook=null;
  function setWindowCheck(key,visible,viaMerge){windowCheckHook&&windowCheckHook(key,visible,viaMerge);}

  // ── Visibility (Window menu / close button) ────────────────────
  function isVisible(key){
    if(hiddenState[key]) return false;
    if(panelMode[key]==='merged') return !hiddenState[mergedHost[key]];
    return true;
  }
  function setVisible(key,visible){
    const shell=panelByKey(key);
    if(!shell) return;
    if(visible){
      hiddenState[key]=false;
      if(panelMode[key]==='merged'){
        activateTab(panelByKey(mergedHost[key]),key);
        hiddenState[mergedHost[key]]=false;
      } else {
        bringToFront(shell);
      }
    } else {
      if(panelMode[key]==='merged'){
        const hostKey=mergedHost[key];
        const host=panelByKey(hostKey);
        const body=bodyWrapOf(host).querySelector(`.fp-body[data-body="${key}"]`);
        const tabEl=tabbarOf(host).querySelector(`.fp-tab[data-key="${key}"]`);
        if(tabEl) tabEl.remove();
        if(body){bodyWrapOf(shell).appendChild(body);body.classList.add('active');}
        refreshTabbarVisibility(host);
        const remaining=[...bodyWrapOf(host).querySelectorAll('.fp-body')];
        if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(host,remaining[0].dataset.body);
        clearMerged(key);
      }
      hiddenState[key]=true;
    }
    setWindowCheck(key,visible);
    render();
    _saveLayout();
  }

  const DEFAULT_LAYOUT={
    tools:{dock:'left',size:40},
    'brush-presets':{dock:'left',size:220},
    layers:{dock:'right',size:200},
    color:{x:130,y:16,w:200,h:240},
  };
  function resetLayout(){
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      [...tabbarOf(panel).querySelectorAll('.fp-tab')].forEach(t=>{if(t.dataset.key!==key) popOutTab(panel,t.dataset.key,0,0);});
      if(panelMode[key]==='merged') popOutTab(panelByKey(mergedHost[key]),key,0,0);
    });
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const d=DEFAULT_LAYOUT[key]||{};
      panel._savedWidth=d.size?d.size+'px':(d.w?d.w+'px':null);
      if(d.dock){
        dockSize[key]=d.size;
        dockPanel(key,d.dock);
      } else {
        undockToFloat(key,d.x||16,d.y||16,d.w||null,d.h||null);
      }
      hiddenState[key]=false;
    });
    render();
    setVisible('tools',true);
    setVisible('brush-presets',true);
    setVisible('layers',true);
    setVisible('color',false);
    _saveLayout();
    if(typeof fitCanvasToView==='function') requestAnimationFrame(()=>requestAnimationFrame(fitCanvasToView));
    else if(typeof centerCanvas==='function') requestAnimationFrame(centerCanvas);
  }

  // ── Docked-state resize (single inner-edge handle, one per panel) ─
  // Writes ONLY to dockSize[key] — never reads offsetWidth/Height back
  // to decide the next frame's size, so repeated drags can't drift.
  function bindDockResize(panel,rh){
    let resizing=false,startPx=0,startSize=0,side=null,key=null;
    rh.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      key=panel.dataset.panel;
      side=['left','right','top','bottom'].find(s=>dockOrder[s].includes(key));
      if(!side) return;
      resizing=true;rh.setPointerCapture(e.pointerId);rh.classList.add('dragging');
      startPx=(side==='left'||side==='right')?e.clientX:e.clientY;
      startSize=dockSize[key];
    });
    rh.addEventListener('pointermove',e=>{
      if(!resizing) return;
      const cur=(side==='left'||side==='right')?e.clientX:e.clientY;
      let delta=cur-startPx;
      if(side==='right'||side==='bottom') delta=-delta;
      const cfg=cfgOf(key);
      dockSize[key]=Math.max(cfg.minSize,Math.min(cfg.maxSize,startSize+delta));
      renderSide(side);
      if(typeof centerCanvas==='function') centerCanvas();
    });
    function endResize(){
      if(!resizing) return;
      resizing=false;rh.classList.remove('dragging');
      _saveLayout();
    }
    rh.addEventListener('pointerup',endResize);
    rh.addEventListener('pointercancel',endResize);
    // Safety net: if pointer capture gets stolen or released elsewhere
    // (e.g. by another drag's global pointer relay, such as the timeline
    // scrubber) the handle's own pointerup may never fire, leaving
    // `resizing` stuck true forever — the docker separator then stays
    // glued to the mouse. Force-clear on any global pointerup/blur too.
    window.addEventListener('pointerup',()=>{ if(resizing) endResize(); });
    window.addEventListener('blur',()=>{ if(resizing) endResize(); });
  }

  // ── Floating-state resize (4 edge handles, only for panels whose
  // config opts in). Writes ONLY to floatRect[key]. ─────────────────
  function bindFloatingResize(panel){
    const key=panel.dataset.panel;
    const cfg=cfgOf(key);
    if(!cfg.floatResizable) return;
    const EDGE=8;
    const EDGE_CSS={
      right:`right:0;top:0;bottom:0;width:${EDGE}px;`,
      left:`left:0;top:0;bottom:0;width:${EDGE}px;`,
      bottom:`bottom:0;left:0;right:0;height:${EDGE}px;`,
      top:`top:0;left:0;right:0;height:${EDGE}px;`,
    };
    Object.keys(EDGE_CSS).forEach(side=>{
      const el=document.createElement('div');
      el.className='fp-float-resize fp-float-resize-'+side;
      el.style.cssText='position:absolute;'+EDGE_CSS[side]+'z-index:10;touch-action:none;';
      panel.appendChild(el);
      let active=false,sx=0,sy=0,startRect=null;
      el.addEventListener('pointerdown',e=>{
        if(panelMode[key]!=='floating') return;
        e.preventDefault();e.stopPropagation();
        active=true;el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        sx=e.clientX;sy=e.clientY;
        const r=floatRect[key]||{x:panel.offsetLeft,y:panel.offsetTop};
        startRect={x:r.x,y:r.y,w:panel.offsetWidth,h:panel.offsetHeight};
      });
      el.addEventListener('pointermove',e=>{
        if(!active) return;
        const dx=e.clientX-sx, dy=e.clientY-sy;
        const r=Object.assign({},floatRect[key]||{},startRect);
        const minH=cfg.contentFitHeight?_toolsMinHeight():120;
        if(side==='right'){ r.w=Math.max(cfg.minSize,Math.min(cfg.maxSize,startRect.w+dx)); }
        else if(side==='left'){ r.w=Math.max(cfg.minSize,Math.min(cfg.maxSize,startRect.w-dx)); r.x=startRect.x+(startRect.w-r.w); }
        else if(side==='bottom'){ r.h=Math.max(minH,Math.min(700,startRect.h+dy)); }
        else if(side==='top'){ r.h=Math.max(minH,Math.min(700,startRect.h-dy)); r.y=startRect.y+(startRect.h-r.h); }
        floatRect[key]=r;
        // Live-apply without a full render() pass (cheap, avoids layout
        // thrash of every panel on every pointermove of a drag).
        panel.style.left=r.x+'px'; panel.style.top=r.y+'px';
        if(r.w!=null) panel.style.width=r.w+'px';
        if(r.h!=null) panel.style.height=r.h+'px';
        if(typeof centerCanvas==='function') centerCanvas();
      });
      function end(){ if(!active) return; active=false; el.classList.remove('dragging'); _saveLayout(); }
      el.addEventListener('pointerup',end);
      el.addEventListener('pointercancel',end);
    });
  }
  // Content-driven minimum height for the Tools panel (titlebar + buttons),
  // used as the floating-resize floor so it can never be crushed smaller
  // than its own contents.
  function _toolsMinHeight(){
    const tp=panelByKey('tools');
    if(!tp) return 120;
    const tb=tp.querySelector('.fp-titlebar');
    const bd=document.getElementById('tools-panel-body');
    return (tb?tb.offsetHeight:0)+(bd?bd.scrollHeight:0);
  }

  function _syncDockResizeHandle(panel){
    const rh=panel._dockResizeEl;
    if(!rh) return;
    const key=panel.dataset.panel;
    // Hide dock resize handle for split children (they use the split handle instead)
    const isDocked=panelMode[key]==='docked'&&!hiddenState[key]&&!_isSplitChild(key);
    rh.style.display=isDocked?'block':'none';
  }

  // ── Split resize handles (between a host and each child in a vertical stack) ──
  // Each handle is a fixed-positioned element that sits at the seam between
  // the host panel and a child. It's stored on the child: child._splitResizeEl
  function _syncSplitResizeHandle(hostKey,childKey,side,colOffset,colWidth){
    const childPanel=panelByKey(childKey);
    if(!childPanel) return;
    let rh=childPanel._splitResizeEl;
    if(!rh){
      rh=document.createElement('div');
      rh.className='fp-split-resize';
      document.body.appendChild(rh);
      childPanel._splitResizeEl=rh;
      _bindSplitResizeDrag(rh,hostKey,childKey);
    }
    // Position: horizontal bar at the top edge of the child panel
    const car=canvasArea.getBoundingClientRect();
    const children=_splitChildrenOf(hostKey);
    const childIdx=children.indexOf(childKey);
    const prevChildrenPx=children.slice(0,childIdx).reduce((s,k)=>s+(splitSize[k]||180),0);
    const totalChildPx=children.reduce((s,k)=>s+(splitSize[k]||180),0);
    // top of this child in viewport coords
    const seamY=car.top+(car.height - totalChildPx + prevChildrenPx);
    if(side==='left'){
      rh.style.cssText=`position:fixed;left:${car.left+colOffset}px;top:${seamY-4}px;width:${colWidth}px;height:8px;cursor:row-resize;z-index:9999;background:transparent;touch-action:none;`;
    } else {
      rh.style.cssText=`position:fixed;right:${window.innerWidth-(car.right-colOffset)}px;top:${seamY-4}px;width:${colWidth}px;height:8px;cursor:row-resize;z-index:9999;background:transparent;touch-action:none;`;
    }
    rh.style.display='block';
  }

  function _hideSplitResizeHandle(childKey){
    const cp=panelByKey(childKey);
    if(cp&&cp._splitResizeEl) cp._splitResizeEl.style.display='none';
  }

  function _bindSplitResizeDrag(rh,hostKey,childKey){
    let active=false,startY=0,startSize=0;
    rh.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      active=true;rh.setPointerCapture(e.pointerId);
      startY=e.clientY;startSize=splitSize[childKey]||180;
    });
    rh.addEventListener('pointermove',e=>{
      if(!active) return;
      const dy=startY-e.clientY; // drag up = more space for child
      splitSize[childKey]=Math.max(60,Math.min(window.innerHeight-100,startSize+dy));
      renderSide(['left','right','top','bottom'].find(s=>dockOrder[s].includes(hostKey))||'left');
      // Reposition this handle live (renderSide already calls _syncSplitResizeHandle)
    });
    function end(){ if(!active) return; active=false; _saveLayout(); }
    rh.addEventListener('pointerup',end);
    rh.addEventListener('pointercancel',end);
    // Same safety net as bindDockResize: don't let a stolen pointer
    // capture (e.g. from dragging the timeline) leave this split seam
    // permanently glued to the mouse.
    window.addEventListener('pointerup',()=>{ if(active) end(); });
    window.addEventListener('blur',()=>{ if(active) end(); });
  }

  function bindTabDrag(tabEl,hostPanel){
    let dragging=false,moved=false;
    tabEl.addEventListener('pointerdown',e=>{
      e.preventDefault();dragging=true;moved=false;tabEl._justDragged=false;tabEl.setPointerCapture(e.pointerId);
    });
    tabEl.addEventListener('pointermove',e=>{
      if(!dragging) return;
      const tb=tabbarOf(hostPanel);
      const r=tb.getBoundingClientRect();
      if(!moved && (e.clientY<r.top-6||e.clientY>r.bottom+6||e.clientX<r.left-30||e.clientX>r.right+30)) moved=true;
    });
    function endDrag(e){
      if(!dragging) return;
      dragging=false;
      if(moved){
        tabEl._justDragged=true;
        const car=canvasArea.getBoundingClientRect();
        popOutTab(hostPanel,tabEl.dataset.key,e.clientX-car.left-20,e.clientY-car.top-10);
      }
      moved=false;
    }
    tabEl.addEventListener('pointerup',endDrag);
    tabEl.addEventListener('pointercancel',endDrag);
  }

  // ── Drag handling for a panel's titlebar (move/dock/merge) ─────
  function bindTitlebarDrag(panel){
    const bar=panel.querySelector('.fp-titlebar');
    const key=panel.dataset.panel;
    const DRAG_THRESHOLD=4;
    let dragging=false,moved=false,dx=0,dy=0,curDock=null,curMergeTarget=null,curAtIndex=null;
    let curStackTarget=null; // panel to stack under (vertical sub-split)
    let curStackPos='after'; // 'after' = stack below target, 'before' = stack above target
    let startX=0,startY=0,wasDocked=false,origDockSide=null;
    bar.addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('fp-close')) return;
      e.preventDefault();
      dragging=true;moved=false;bar.setPointerCapture(e.pointerId);
      startX=e.clientX;startY=e.clientY;
      wasDocked=panelMode[key]==='docked';
      origDockSide=wasDocked?['left','right','top','bottom'].find(s=>dockOrder[s].includes(key)):null;
      if(wasDocked) panel._savedWidth=panel.offsetWidth+'px';
      bringToFront(panel);
      const r=panel.getBoundingClientRect();
      dx=e.clientX-r.left;dy=e.clientY-r.top;
    });
    document.addEventListener('pointermove',e=>{
      if(!dragging) return;
      if(!moved){
        if(Math.abs(e.clientX-startX)<DRAG_THRESHOLD&&Math.abs(e.clientY-startY)<DRAG_THRESHOLD) return;
        moved=true;
        if(wasDocked){
          const car0=canvasArea.getBoundingClientRect();
          const r=panel.getBoundingClientRect();
          panel._savedWidth=r.width+'px';
          undockToFloat(key,r.left-car0.left,r.top-car0.top,r.width,null);
          render();
        }
        panel.classList.add('dragging-panel');
      }
      const car=canvasArea.getBoundingClientRect();
      let nx=e.clientX-car.left-dx, ny=e.clientY-car.top-dy;
      panel.style.left=nx+'px';panel.style.top=ny+'px';
      floatRect[key]=Object.assign(floatRect[key]||{},{x:nx,y:ny});

      // ── Stack-target check (top or bottom half of a left/right docked
      // panel) ── Do this FIRST so it can suppress the top/bottom edge-dock
      // line that would otherwise fire when the cursor is near car.top/bottom.
      let _earlyStackTarget=null,_earlyStackPos='after';
      for(const other of allPanels){
        if(other===panel||other.classList.contains('fp-hidden')) continue;
        const ok=other.dataset.panel;
        const otherSide=['left','right'].find(s=>dockOrder[s].includes(ok));
        if(!otherSide||_isSplitChild(ok)) continue;
        const orc=other.getBoundingClientRect();
        if(e.clientX>=orc.left&&e.clientX<=orc.right&&e.clientY>=orc.top&&e.clientY<=orc.bottom){
          _earlyStackTarget=other;
          _earlyStackPos=(e.clientY>=orc.top+orc.height*0.5)?'after':'before';
          break;
        }
      }

      // Check dock boundaries FIRST. Reaching the true outer edge of an
      // already-occupied side means hovering over the panel sitting
      // there (there's no empty space further out to hover in) — if we
      // checked "am I over some other panel" first, that would always
      // win and a dock line could never appear at an occupied edge. So:
      // a hover close enough to a real dock boundary always means "dock
      // here," and only hovers that AREN'T near any boundary fall
      // through to "am I dropping onto a panel to merge/tab with it."
      let best=null; // {side, atIndex, dist, lineOffset}
      // Skip top/bottom edge-dock scan when we're hovering a panel's top/bottom half
      const _skipSides=_earlyStackTarget?[_earlyStackPos==='before'?'top':'bottom']:[];
      ['left','right','top','bottom'].filter(s=>!_skipSides.includes(s)).forEach(side=>{
        const stack=dockOrder[side].filter(k=>k!==key);
        const axisPos=(side==='left'||side==='right')?e.clientX:e.clientY;
        const within=(side==='left'||side==='right')
          ?(e.clientY>=car.top&&e.clientY<=car.bottom)
          :(e.clientX>=car.left&&e.clientX<=car.right);
        if(!within) return;
        let cum=0;
        for(let i=0;i<=stack.length;i++){
          const lineOffset=cum; // px from this side's canvas wall
          const linePos=(side==='left')?car.left+lineOffset
                      :(side==='right')?car.right-lineOffset
                      :(side==='top')?car.top+lineOffset
                      :car.bottom-lineOffset;
          const dist=Math.abs(axisPos-linePos);
          if(dist<DOCK_TRIGGER&&(!best||dist<best.dist)) best={side,atIndex:i,dist,lineOffset};
          if(i<stack.length) cum+=dockSize[stack[i]]||0;
        }
      });

      if(_earlyStackTarget){
        curStackTarget=_earlyStackTarget;curStackPos=_earlyStackPos;curDock=null;curMergeTarget=null;
        hideZones();
        showStackZone(_earlyStackTarget,_earlyStackPos);
      } else if(best){
        curDock=best.side;curAtIndex=best.atIndex;curMergeTarget=null;curStackTarget=null;
        hideStackZone();
        showEdgeZone(best.side,best.lineOffset);
      } else {
        curStackTarget=null;
        {
          // Fall through to merge check (only if not hovering a docked panel at all)
          let mergeTarget=null;
          for(const other of allPanels){
            if(other===panel||other.classList.contains('fp-hidden')) continue;
            const ok=other.dataset.panel;
            if(['left','right','top','bottom'].some(s=>dockOrder[s].includes(ok))) continue; // docked → not merge
            const orc=other.getBoundingClientRect();
            if(e.clientX>=orc.left&&e.clientX<=orc.right&&e.clientY>=orc.top&&e.clientY<=orc.bottom){mergeTarget=other;break;}
          }
          if(mergeTarget){
            curMergeTarget=mergeTarget;curDock=null;curStackTarget=null;
            hideStackZone();
            showMergeZone(mergeTarget);
          } else {
            curMergeTarget=null;curDock=null;curStackTarget=null;
            hideZones();
          }
        }
      }
    });
    function endDrag(){
      if(!dragging) return;
      dragging=false;moved=false;panel.classList.remove('dragging-panel');
      hideZones();
      if(curStackTarget){
        applyStackDock(panel,curStackTarget,curStackPos);
      } else if(curMergeTarget){
        mergeInto(panel,curMergeTarget);
      } else if(curDock){
        applyDock(panel,curDock,curAtIndex);
      } else {
        // Plain floating move (no dock/merge/stack change): the panel's
        // position was already applied live during pointermove, so just
        // persist it. Calling the full render() here would also trigger
        // its unconditional centerCanvas() call, snapping the canvas back
        // to center just because a floating panel was nudged.
        _saveLayout();
      }
      curDock=null;curMergeTarget=null;curStackTarget=null;curStackPos='after';origDockSide=null;
    }
    document.addEventListener('pointerup',endDrag);
    document.addEventListener('pointercancel',endDrag);
    // Safety net: if the drag ends any way other than a normal pointerup on
    // the titlebar (pointer capture lost, released outside the window while
    // alt-tabbing, etc.), `dragging` would otherwise stay true forever and
    // the blue dock-zone highlight would stay lit with no way to dismiss it
    // or actually dock into it — exactly the "blue outline won't accept a
    // drop" symptom. Force-clear on any global pointerup/window blur too.
    window.addEventListener('pointerup',()=>{ if(dragging) endDrag(); });
    window.addEventListener('blur',()=>{
      if(!dragging) return;
      dragging=false;moved=false;panel.classList.remove('dragging-panel');
      hideZones();
      curDock=null;curMergeTarget=null;curStackTarget=null;curStackPos='after';origDockSide=null;
    });
  }

  function init(){
    document.querySelectorAll('.float-panel').forEach(panel=>{
      allPanels.push(panel);
      registerTitle(panel);
      bindTitlebarDrag(panel);
      panel._savedWidth=panel.style.width||null;
      const closeBtn=panel.querySelector('.fp-close');
      if(closeBtn){
        closeBtn.addEventListener('click',e=>{
          e.stopPropagation();
          setVisible(panel.dataset.panel,false);
        });
      }
      const rh=document.createElement('div');
      rh.className='fp-dock-resize';
      rh.style.display='none';
      panel.appendChild(rh);
      panel._dockResizeEl=rh;
      bindDockResize(panel,rh);
      bindFloatingResize(panel);

      // Seed initial state from whatever markup the page shipped with, so a
      // fresh load (no saved layout yet) behaves exactly like today.
      const key=panel.dataset.panel;
      if(panel.classList.contains('docked')){
        const side=['left','right','top','bottom'].find(s=>panel.classList.contains('dock-'+s));
        const cssSize=(side==='left'||side==='right')?panel.offsetWidth:panel.offsetHeight;
        dockSize[key]=cssSize||(key==='tools'?40:220);
        dockPanel(key,side);
      } else {
        const r=panel.getBoundingClientRect();
        const car=canvasArea.getBoundingClientRect();
        undockToFloat(key,parseFloat(panel.style.left)||(r.left-car.left),parseFloat(panel.style.top)||(r.top-car.top));
      }
      hiddenState[key]=panel.classList.contains('fp-hidden');
    });
    render();
    _restoreLayout();
  }

  // ── Layout persistence ───────────────────────────────────────────
  // Persists the state tree directly (not scraped DOM styles), so a
  // save can never capture a transitional/mid-drag value, and restore
  // is just "set state, then render()" — the same code path used for
  // every other layout change.
  const LAYOUT_KEY='animator_panel_layout_v4';
  function _saveLayout(){
    const state={
      dockOrder,dockSize,floatRect,panelMode,mergedHost,hiddenState,
      splitChildren,splitSize,splitHost,
      savedWidths:Object.fromEntries(allPanels.map(p=>[p.dataset.panel,p._savedWidth||null])),
    };
    try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(state));}catch(e){}
  }
  function _restoreLayout(){
    let state;
    try{state=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');}catch(e){return;}
    if(!state||!state.panelMode) return;
    ['left','right','top','bottom'].forEach(s=>{dockOrder[s]=(state.dockOrder&&state.dockOrder[s])||[]; });
    Object.assign(dockSize,state.dockSize||{});
    Object.assign(floatRect,state.floatRect||{});
    Object.assign(panelMode,state.panelMode||{});
    Object.assign(mergedHost,state.mergedHost||{});
    Object.assign(hiddenState,state.hiddenState||{});
    // Restore split state
    Object.assign(splitChildren,state.splitChildren||{});
    Object.assign(splitSize,state.splitSize||{});
    Object.assign(splitHost,state.splitHost||{});
    allPanels.forEach(p=>{
      const sw=state.savedWidths&&state.savedWidths[p.dataset.panel];
      if(sw) p._savedWidth=sw;
    });
    // Re-home merged panels' DOM bodies into their host shells (state was
    // restored, but the actual .fp-body elements are still sitting wherever
    // the page markup put them).
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      if(panelMode[key]==='merged'&&mergedHost[key]){
        const host=panelByKey(mergedHost[key]);
        if(!host) { panelMode[key]='floating'; return; }
        const body=bodyWrapOf(panel).querySelector(`.fp-body[data-body="${key}"]`)||bodyWrapOf(panel).firstElementChild;
        if(body){ body.classList.remove('active'); bodyWrapOf(host).appendChild(body); addTab(host,key); }
      }
    });
    // Every panel shell needs exactly one active tab/body. Re-homing above
    // may have left hosts with tabs but no active selection — fix that up
    // deterministically (last tab wins) rather than guessing from the DOM.
    allPanels.forEach(panel=>{
      const wrap=bodyWrapOf(panel);
      const bodies=[...wrap.querySelectorAll('.fp-body')];
      if(bodies.length&&!bodies.some(b=>b.classList.contains('active'))){
        activateTab(panel,bodies[bodies.length-1].dataset.body);
      }
      refreshTabbarVisibility(panel);
    });
    render();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(typeof fitCanvasToView==='function') fitCanvasToView();
      else if(typeof centerCanvas==='function') centerCanvas();
      updateWindowChecks();
    }));
  }

  init();

  return {
    setVisible,isVisible,bringToFront,resetLayout,
    saveLayout:_saveLayout,
    syncDockResizeHandle:_syncDockResizeHandle,
    setFloatSize,getFloatSize,
    setWindowCheckHook(fn){windowCheckHook=fn;},
    // New, explicit API for the (now-deduplicated) resize handles that used
    // to live in ui-controls.js. They no longer touch panel state directly.
    isDocked(key){ return panelMode[key]==='docked'; },
    getDockSide(key){ return ['left','right','top','bottom'].find(s=>dockOrder[s].includes(key))||null; },
    // Whole-stack width resize. When panels are stacked (split) in the same
    // dock column they all share one width — the host's dockSize — so any
    // of their edges can drive it. `key` may be the host OR any of its
    // split children; we resolve to the shared host automatically.
    isSplitChild:_isSplitChild,
    getStackHost(key){ return _splitHostOf(key)||key; },
    getDockWidth(key){ return dockSize[_splitHostOf(key)||key]; },
    setDockWidth(key,widthPx){
      const hostKey=_splitHostOf(key)||key;
      const side=['left','right'].find(s=>dockOrder[s].includes(hostKey));
      if(!side) return;
      const cfg=cfgOf(hostKey);
      dockSize[hostKey]=Math.max(cfg.minSize,Math.min(cfg.maxSize,widthPx));
      renderSide(side);
      if(typeof centerCanvas==='function') centerCanvas();
    },
    // Full layout reflow. Needed by anything that changes canvasArea's
    // rect from outside panels.js (e.g. resizing the timeline) — render()
    // is what repositions docked/split panels and their seam handles off
    // canvasArea.getBoundingClientRect(), and nothing else re-runs it.
    // Without calling this, those elements freeze at stale coordinates
    // until a panels.js-owned drag happens to trigger render() again.
    render,
  };
})();