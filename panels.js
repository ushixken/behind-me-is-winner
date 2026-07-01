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
function recomposite(li,fi){
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
      srcCanvas=activeC;
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

  // Push the finished frame to the VISIBLE canvas (displayC), pre-blurring by
  // _displayBlurPx when zoomed out — see core-state.js _updateDisplayBlur for
  // why. compC itself stays untouched/pixel-exact for eyedropper, export, etc.
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
// Powers the Tools, Color, and Layers panels: free float anywhere
// over the canvas, snap-dock to any of the 4 canvas edges, and
// drag-to-merge into tabbed groups (Photoshop/Clip Studio style).
// Each .float-panel has a .fp-titlebar (drag handle) and one
// .fp-body. When panels merge, the dragged panel's .fp-body is
// physically moved into the target's .fp-body-wrap and a tab is
// added to the target's .fp-tabbar; the source shell is hidden
// (not removed) so it can be popped back out later.
// ════════════════════════════════════════════════════════════════
const FloatPanels=(function(){
  const DOCK_TRIGGER=52;       // px from canvas edge that previews an edge-dock
  const dz={left:document.getElementById('fp-dz-left'),right:document.getElementById('fp-dz-right'),
            top:document.getElementById('fp-dz-top'),bottom:document.getElementById('fp-dz-bottom')};
  const mergeZoneEl=document.getElementById('fp-mergezone');
  const allPanels=[]; // every top-level .float-panel element (one per registered panel)
  // home[panelKey] = {title} used to rebuild a shell's tab button when popping back out
  const titles={};

  function registerTitle(panelEl){titles[panelEl.dataset.panel]=panelEl.querySelector('.fp-name').textContent;}

  function hideZones(){Object.values(dz).forEach(z=>z.classList.remove('show'));mergeZoneEl.classList.remove('show');}
  // edgeOffset: px from that canvas edge where the snap line should appear
  // (0 = canvas wall; e.g. 40 = right edge of a 40px left-docked Tools panel)
  function showEdgeZone(side,edgeOffset){
    hideZones();
    if(!side) return;
    const z=dz[side];
    const off=(edgeOffset||0)+'px';
    // 3px glowing line at the actual snap position
    if(side==='left'){z.style.cssText=`left:${off};top:0;bottom:0;width:3px;`;}
    if(side==='right'){z.style.cssText=`right:${off};top:0;bottom:0;width:3px;`;}
    if(side==='top'){z.style.cssText=`top:${off};left:0;right:0;height:3px;`;}
    if(side==='bottom'){z.style.cssText=`bottom:${off};left:0;right:0;height:3px;`;}
    z.classList.add('show');
  }
  function showMergeZone(targetPanel){
    hideZones();
    const car=canvasArea.getBoundingClientRect();
    const r=targetPanel.getBoundingClientRect();
    mergeZoneEl.style.cssText=`left:${r.left-car.left}px;top:${r.top-car.top}px;width:${r.width}px;height:${r.height}px;`;
    mergeZoneEl.classList.add('show');
  }

  function clearDockClasses(panel){
    panel.classList.remove('dock-left','dock-right','dock-top','dock-bottom','docked');
    panel.style.left='';panel.style.right='';panel.style.top='';panel.style.bottom='';
  }
  // Reflow all panels docked to `side` so they sit flush side-by-side
  // in the order they currently appear in allPanels, no overlaps or gaps.
  function reflowDockSide(side){
    const docked=allPanels.filter(p=>
      !p.classList.contains('fp-hidden')&&
      p.classList.contains('docked')&&
      p.classList.contains('dock-'+side)
    );
    let offset=0;
    docked.forEach(p=>{
      if(side==='left')   p.style.left=offset+'px';
      if(side==='right')  p.style.right=offset+'px';
      if(side==='top')    p.style.top=offset+'px';
      if(side==='bottom') p.style.bottom=offset+'px';
      // Advance by this panel's size along that axis
      if(side==='left'||side==='right') offset+=p.offsetWidth;
      if(side==='top'||side==='bottom') offset+=p.offsetHeight;
    });
    if(typeof centerCanvas==='function') centerCanvas();
  }
  // Expose so resize handlers outside this closure can trigger a reflow
  window._reflowDockSide=reflowDockSide;

  function applyDock(panel,side){
    clearDockClasses(panel);
    if(side){
      panel.classList.add('dock-'+side,'docked');
      panel.style.top='';panel.style.left='';panel.style.right='';panel.style.bottom='';
      panel.style.height='';

      // Width/height
      if(panel.dataset.panel==='tools'&&(side==='left'||side==='right')){
        panel.style.width='40px';
      } else if(panel.dataset.panel==='tools'&&(side==='top'||side==='bottom')){
        panel.style.width='';
        panel.style.height='';
        requestAnimationFrame(()=>{
          const tb=panel.querySelector('.fp-titlebar');
          const bd=document.getElementById('tools-panel-body');
          const tbH=tb?tb.offsetHeight:0;
          panel.style.height='0px';
          const bodyH=bd?bd.scrollHeight:0;
          panel.style.height=(tbH+bodyH)+'px';
          reflowDockSide(side);
        });
        _syncDockResizeHandle(panel);
        return;
      } else {
        if(panel._savedWidth) panel.style.width=panel._savedWidth;
      }
      reflowDockSide(side);
    }
    _syncDockResizeHandle(panel);
    _saveLayout();
    if(typeof centerCanvas==='function') centerCanvas();
  }
  function floatAt(panel,x,y){
    clearDockClasses(panel);
    panel.style.right='';panel.style.bottom='';
    panel.style.left=x+'px';panel.style.top=y+'px';
    _syncDockResizeHandle(panel);
    _saveLayout();
  }

  // ── Tab management ────────────────────────────────────────────
  // group(panel) -> array of panel keys currently tabbed inside `panel`'s shell, active one first is NOT assumed;
  // we track active via .fp-body.active and tab .active class.
  function tabbarOf(panel){return panel.querySelector('.fp-tabbar');}
  function bodyWrapOf(panel){return panel.querySelector('.fp-body-wrap');}
  function nameOf(panel){return panel.querySelector('.fp-name');}

  function refreshTabbarVisibility(panel){
    const tb=tabbarOf(panel);
    const count=tb.children.length;
    tb.style.display=count>1?'flex':'none';
    // Titlebar name shows active tab's title when tabbed, else the panel's own title
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
  // into targetPanel: move all of its fp-body nodes + tabs across, hide its shell.
  function mergeInto(sourcePanel,targetPanel){
    if(sourcePanel===targetPanel) return;
    const srcWrap=bodyWrapOf(sourcePanel);
    const srcTabs=tabbarOf(sourcePanel);
    const bodies=[...srcWrap.querySelectorAll('.fp-body')];
    const keys=bodies.map(b=>b.dataset.body);
    // Ensure target already has tabs for its own existing body/bodies before merging in
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
    sourcePanel.classList.add('fp-hidden');
    setWindowCheck(sourcePanel.dataset.panel,false,true); // hidden via merge, not via close
    // targetPanel may now host keys that were already merged into it PLUS the
    // ones that just moved from sourcePanel — recompute _mergedInto for every
    // key actually present in targetPanel right now, so multi-level merges
    // (merging a panel that is itself a host) stay consistent.
    [...bodyWrapOf(targetPanel).querySelectorAll('.fp-body')].forEach(b=>{
      const ownShell=document.querySelector(`.float-panel[data-panel="${b.dataset.body}"]`);
      if(ownShell) ownShell._mergedInto=targetPanel;
    });
    _saveLayout();
  }

  // Pop a tab (by key) out of its current host into its own floating shell at (x,y)
  function popOutTab(hostPanel,key,x,y){
    const ownShell=document.querySelector(`.float-panel[data-panel="${key}"]`);
    const body=bodyWrapOf(hostPanel).querySelector(`.fp-body[data-body="${key}"]`);
    if(!ownShell||!body) return;
    // Remove its tab + body from the host
    const tabEl=tabbarOf(hostPanel).querySelector(`.fp-tab[data-key="${key}"]`);
    if(tabEl) tabEl.remove();
    bodyWrapOf(ownShell).appendChild(body);
    body.classList.add('active');
    refreshTabbarVisibility(hostPanel);
    // If host now has only 1 tab left, collapse its tabbar
    const remaining=[...bodyWrapOf(hostPanel).querySelectorAll('.fp-body')];
    if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(hostPanel,remaining[0].dataset.body);
    ownShell.classList.remove('fp-hidden');
    ownShell._mergedInto=null;
    // Restore the shell's own saved width when floating it back out, so panels
    // don't end up collapsed to min-width after being popped from a tab group.
    if(ownShell._savedWidth) ownShell.style.width=ownShell._savedWidth;
    floatAt(ownShell,x,y);
    bringToFront(ownShell);
    setWindowCheck(key,true);
    _syncDockResizeHandle(ownShell);
    _saveLayout();
  }

  let zTop=200;
  function bringToFront(panel){zTop++;panel.style.zIndex=zTop;}

  // ── Window-menu checkbox sync (declared here, wired to actual
  // checkboxes by the Window-menu code further down via FloatPanels.setWindowCheckHook) ──
  let windowCheckHook=null;
  function setWindowCheck(key,visible,viaMerge){windowCheckHook&&windowCheckHook(key,visible,viaMerge);}

  // ── Visibility (Window menu / close button) ────────────────────
  function isVisible(key){
    const shell=document.querySelector(`.float-panel[data-panel="${key}"]`);
    if(!shell) return false;
    if(!shell.classList.contains('fp-hidden')) return true;
    // merged elsewhere & that host is visible?
    return !!(shell._mergedInto && !shell._mergedInto.classList.contains('fp-hidden'));
  }
  function setVisible(key,visible){
    const shell=document.querySelector(`.float-panel[data-panel="${key}"]`);
    if(!shell) return;
    if(visible){
      if(shell._mergedInto){ // currently a tab elsewhere — just switch to it
        activateTab(shell._mergedInto,key);
        shell._mergedInto.classList.remove('fp-hidden');
      } else {
        shell.classList.remove('fp-hidden');
        bringToFront(shell);
      }
    } else {
      if(shell._mergedInto){
        // Cleanly remove this tab from its host, return body to own shell, but keep shell hidden
        const host=shell._mergedInto;
        const body=bodyWrapOf(host).querySelector(`.fp-body[data-body="${key}"]`);
        const tabEl=tabbarOf(host).querySelector(`.fp-tab[data-key="${key}"]`);
        if(tabEl) tabEl.remove();
        if(body){bodyWrapOf(shell).appendChild(body);body.classList.add('active');}
        refreshTabbarVisibility(host);
        const remaining=[...bodyWrapOf(host).querySelectorAll('.fp-body')];
        if(remaining.length&&!remaining.some(b=>b.classList.contains('active'))) activateTab(host,remaining[0].dataset.body);
        shell._mergedInto=null;
        shell.classList.add('fp-hidden');
        setWindowCheck(key,false);
      } else {
        shell.classList.add('fp-hidden');
      }
    }
    _syncDockResizeHandle(shell);
    // reflow the dock side so remaining panels fill the gap
    ['left','right','top','bottom'].forEach(side=>{
      if(shell.classList.contains('dock-'+side)) reflowDockSide(side);
    });
    if(typeof centerCanvas==='function') centerCanvas();
    _saveLayout();
  }

  const DEFAULT_LAYOUT={
    tools:{dock:'left',width:'40px'},
    'brush-presets':{dock:'left',width:'220px'},
    'tool-settings':{top:'60px',right:'220px',width:'220px',height:'500px'},
    layers:{dock:'right',width:'200px'},
    color:{top:'16px',left:'130px',right:'',bottom:'',width:'auto',height:'auto'}
  };
  function resetLayout(){
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      // Pop out anything merged into this panel, and pop this panel out of wherever it was merged
      [...tabbarOf(panel).querySelectorAll('.fp-tab')].forEach(t=>{if(t.dataset.key!==key) popOutTab(panel,t.dataset.key,0,0);});
      if(panel._mergedInto){popOutTab(panel._mergedInto,key,0,0);}
      clearDockClasses(panel);
      const d=DEFAULT_LAYOUT[key]||{};
      if(d.dock){
        panel.style.top='';panel.style.left='';panel.style.right='';panel.style.bottom='';
        panel.style.width=d.width||'';panel.style.height=d.height||'';
        panel._savedWidth=d.width||'';
        panel.classList.add('dock-'+d.dock,'docked');
        // Set the inline edge position (no other panels docked yet during reset)
        if(d.dock==='left')   panel.style.left='0';
        if(d.dock==='right')  panel.style.right='0';
        if(d.dock==='top')    panel.style.top='0';
        if(d.dock==='bottom') panel.style.bottom='0';
      } else {
        panel.style.top=d.top||'';panel.style.left=d.left||'';
        panel.style.right=d.right||'';panel.style.bottom=d.bottom||'';
        panel.style.width=d.width||'';panel.style.height=d.height||'';
        panel._savedWidth=d.width||'';
      }
    });
    setVisible('tools',true);
    setVisible('brush-presets',true);
    setVisible('tool-settings',false);
    setVisible('layers',true);
    setVisible('color',false);
    // Sync resize handles for all panels after reset
    allPanels.forEach(_syncDockResizeHandle);
    _saveLayout();
    // Re-center the canvas after resetting panel layout
    if(typeof fitCanvasToView==='function') requestAnimationFrame(()=>requestAnimationFrame(fitCanvasToView));
    else if(typeof centerCanvas==='function') requestAnimationFrame(centerCanvas);
  }

  // ── Drag handling for a panel's titlebar (move/dock/merge) ─────
  function bindTitlebarDrag(panel){
    const bar=panel.querySelector('.fp-titlebar');
    const isColorPanel=panel.dataset.panel==='color';
    const COLOR_SNAP=40; // px from Tools/Layers/Timeline edge to trigger snap
    const DRAG_THRESHOLD=4; // px of movement before a docked panel actually undocks
    let dragging=false,moved=false,dx=0,dy=0,curDock=null,curMergeTarget=null;
    let startX=0,startY=0,wasDocked=false,origDockSide=null;
    bar.addEventListener('pointerdown',e=>{
      if(e.target.classList.contains('fp-close')) return;
      e.preventDefault();
      dragging=true;moved=false;bar.setPointerCapture(e.pointerId);
      startX=e.clientX;startY=e.clientY;
      wasDocked=panel.classList.contains('docked');
      // Remember which side the panel was docked to so we can snap it back if
      // the user releases without dragging far enough to hit a new dock zone.
      origDockSide=null;
      if(wasDocked){
        if(panel.classList.contains('dock-left')) origDockSide='left';
        else if(panel.classList.contains('dock-right')) origDockSide='right';
        else if(panel.classList.contains('dock-top')) origDockSide='top';
        else if(panel.classList.contains('dock-bottom')) origDockSide='bottom';
        // Save the current rendered width so applyDock can restore it later
        panel._savedWidth=panel.offsetWidth+'px';
      }
      bringToFront(panel);
      const r=panel.getBoundingClientRect();
      dx=e.clientX-r.left;dy=e.clientY-r.top;
    });
    bar.addEventListener('pointermove',e=>{
      if(!dragging) return;
      if(!moved){
        if(Math.abs(e.clientX-startX)<DRAG_THRESHOLD&&Math.abs(e.clientY-startY)<DRAG_THRESHOLD) return;
        moved=true;
        if(wasDocked){
          const car0=canvasArea.getBoundingClientRect();
          const r=panel.getBoundingClientRect();
          panel._savedWidth=r.width+'px';
          // Remember the side before clearing so we can reflow remaining panels
          const prevSide=origDockSide;
          clearDockClasses(panel);
          panel.style.left=(r.left-car0.left)+'px';panel.style.top=(r.top-car0.top)+'px';
          if(prevSide&&typeof window._reflowDockSide==='function') window._reflowDockSide(prevSide);
          if(typeof centerCanvas==='function') centerCanvas();
        }
        panel.classList.add('dragging-panel');
      }
      const car=canvasArea.getBoundingClientRect();
      let nx=e.clientX-car.left-dx, ny=e.clientY-car.top-dy;
      const pw=panel.offsetWidth,ph=panel.offsetHeight;

      if(isColorPanel){
        // Color panel: float freely — clamp loosely so it stays grabbable
        nx=Math.max(-pw+30,Math.min(car.width-30,nx));
        ny=Math.max(-10,Math.min(car.height-30,ny));
        panel.style.left=nx+'px';panel.style.top=ny+'px';

        // Snap preview: check proximity to all major UI panel edges
        const toolsEl=document.getElementById('tools-panel');
        const layersEl=document.getElementById('right-panel');
        const timelineEl=document.getElementById('timeline-area');
        const toolbarEl=document.getElementById('toolbar');
        const menubarEl=document.getElementById('menubar');
        let snapSide=null;

        // Near right edge of Tools panel → snap left
        if(!snapSide&&toolsEl&&!toolsEl.classList.contains('fp-hidden')){
          const tr=toolsEl.getBoundingClientRect();
          if(Math.abs(e.clientX-tr.right)<COLOR_SNAP && e.clientY>=car.top && e.clientY<=car.bottom)
            snapSide='left';
        }
        // Near canvas left wall (no tools panel) → snap left
        if(!snapSide&&Math.abs(e.clientX-car.left)<COLOR_SNAP && e.clientY>=car.top && e.clientY<=car.bottom)
          snapSide='left';

        // Near left edge of Layers panel → snap right
        if(!snapSide&&layersEl&&!layersEl.classList.contains('fp-hidden')){
          const lr=layersEl.getBoundingClientRect();
          if(Math.abs(e.clientX-lr.left)<COLOR_SNAP && e.clientY>=car.top && e.clientY<=car.bottom)
            snapSide='right';
        }
        // Near canvas right wall → snap right
        if(!snapSide&&Math.abs(e.clientX-car.right)<COLOR_SNAP && e.clientY>=car.top && e.clientY<=car.bottom)
          snapSide='right';

        // Near top of timeline → snap bottom
        if(!snapSide&&timelineEl){
          const ba=timelineEl.closest('#bottom-area');
          if(!ba||!ba.classList.contains('hidden')){
            const tr2=timelineEl.getBoundingClientRect();
            if(Math.abs(e.clientY-tr2.top)<COLOR_SNAP && e.clientX>=car.left && e.clientX<=car.right)
              snapSide='bottom';
          }
        }
        // Near canvas bottom wall → snap bottom
        if(!snapSide&&Math.abs(e.clientY-car.bottom)<COLOR_SNAP && e.clientX>=car.left && e.clientX<=car.right)
          snapSide='bottom';

        // Near bottom of toolbar → snap top
        if(!snapSide&&toolbarEl){
          const tbr=toolbarEl.getBoundingClientRect();
          if(Math.abs(e.clientY-tbr.bottom)<COLOR_SNAP && e.clientX>=car.left && e.clientX<=car.right)
            snapSide='top';
        }
        // Near bottom of menubar → snap top
        if(!snapSide&&menubarEl){
          const mbr=menubarEl.getBoundingClientRect();
          if(Math.abs(e.clientY-mbr.bottom)<COLOR_SNAP && e.clientX>=car.left && e.clientX<=car.right)
            snapSide='top';
        }
        // Near canvas top wall → snap top
        if(!snapSide&&Math.abs(e.clientY-car.top)<COLOR_SNAP && e.clientX>=car.left && e.clientX<=car.right)
          snapSide='top';
        curDock=snapSide;
        if(snapSide) showEdgeZone(snapSide,0); else hideZones();
        curMergeTarget=null;
      } else {
        // Non-color panels: float freely anywhere (no clamping), merge, edge-dock
        panel.style.left=nx+'px';panel.style.top=ny+'px';
        let mergeTarget=null;
        for(const other of allPanels){
          if(other===panel||other.classList.contains('fp-hidden')) continue;
          const orc=other.getBoundingClientRect();
          if(e.clientX>=orc.left&&e.clientX<=orc.right&&e.clientY>=orc.top&&e.clientY<=orc.bottom){mergeTarget=other;break;}
        }
        if(mergeTarget){
          curMergeTarget=mergeTarget;curDock=null;
          showMergeZone(mergeTarget);
        } else {
          curMergeTarget=null;
          // Base distances from canvas-area edges
          let distL=e.clientX-car.left, distR=car.right-e.clientX;
          let distT=e.clientY-car.top, distB=car.bottom-e.clientY;
          // Measure distance to the INNER (exposed) edge of any already-docked panel
          // so dragging near e.g. the right edge of a left-docked Tools panel triggers
          // a left-dock snap (placing the new panel beside the existing one).
          for(const other of allPanels){
            if(other===panel||other.classList.contains('fp-hidden')||!other.classList.contains('docked')) continue;
            const or=other.getBoundingClientRect();
            if(other.classList.contains('dock-left'))  distL=Math.min(distL, Math.abs(e.clientX-or.right));
            if(other.classList.contains('dock-right')) distR=Math.min(distR, Math.abs(e.clientX-or.left));
            if(other.classList.contains('dock-top'))   distT=Math.min(distT, Math.abs(e.clientY-or.bottom));
            if(other.classList.contains('dock-bottom'))distB=Math.min(distB, Math.abs(e.clientY-or.top));
          }
          const min=Math.min(distL,distR,distT,distB);
          let side=null;
          if(min<DOCK_TRIGGER){
            if(min===distL) side='left';else if(min===distR) side='right';
            else if(min===distT) side='top';else side='bottom';
          }
          curDock=side;
          if(side){
            // Compute where the snap line should appear: at the inner edge of
            // any already-docked panel on that side, or 0 if the canvas wall is free.
            let lineOffset=0;
            const car2=canvasArea.getBoundingClientRect();
            for(const other of allPanels){
              if(other===panel||other.classList.contains('fp-hidden')||!other.classList.contains('docked')) continue;
              const or=other.getBoundingClientRect();
              if(side==='left'&&other.classList.contains('dock-left')) lineOffset=Math.max(lineOffset,or.right-car2.left);
              if(side==='right'&&other.classList.contains('dock-right')) lineOffset=Math.max(lineOffset,car2.right-or.left);
              if(side==='top'&&other.classList.contains('dock-top')) lineOffset=Math.max(lineOffset,or.bottom-car2.top);
              if(side==='bottom'&&other.classList.contains('dock-bottom')) lineOffset=Math.max(lineOffset,car2.bottom-or.top);
            }
            showEdgeZone(side,lineOffset);
          } else hideZones();
        }
      }
    });
    function endDrag(){
      if(!dragging) return;
      dragging=false;moved=false;panel.classList.remove('dragging-panel');
      hideZones();
      if(!isColorPanel&&curMergeTarget){
        mergeInto(panel,curMergeTarget);
      } else if(curDock){
        applyDock(panel,curDock);
      } else {
        _syncDockResizeHandle(panel);
        _saveLayout();
      }
      curDock=null;curMergeTarget=null;origDockSide=null;
    }
    bar.addEventListener('pointerup',endDrag);
    bar.addEventListener('pointercancel',endDrag);
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
      // Only treat as a real drag (vs. a click) once the pointer leaves the tab bar
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

  function init(){
    document.querySelectorAll('.float-panel').forEach(panel=>{
      allPanels.push(panel);
      registerTitle(panel);
      bindTitlebarDrag(panel);
      // Snapshot each panel's initial inline width so undocking restores it correctly
      panel._savedWidth=panel.style.width||null;
      // Wire close button
      const closeBtn=panel.querySelector('.fp-close');
      if(closeBtn){
        closeBtn.addEventListener('click',e=>{
          e.stopPropagation();
          setVisible(panel.dataset.panel,false);
        });
      }
      // Add dock resize handle element (hidden until panel is docked)
      const rh=document.createElement('div');
      rh.className='fp-dock-resize';
      rh.style.display='none';
      panel.appendChild(rh);
      panel._dockResizeEl=rh;
      bindDockResize(panel,rh);
    });
    // Restore layout from localStorage if saved
    _restoreLayout();
  }

  // ── Dock resize handle: drag the inner edge of a docked panel to resize it ─
  function bindDockResize(panel,rh){
    let resizing=false,startPx=0,startSize=0,side=null;
    rh.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      resizing=true;rh.setPointerCapture(e.pointerId);rh.classList.add('dragging');
      side=panel.classList.contains('dock-left')?'left':
           panel.classList.contains('dock-right')?'right':
           panel.classList.contains('dock-top')?'top':'bottom';
      startPx=(side==='left'||side==='right')?e.clientX:e.clientY;
      startSize=(side==='left'||side==='right')?panel.offsetWidth:panel.offsetHeight;
    });
    rh.addEventListener('pointermove',e=>{
      if(!resizing) return;
      const cur=(side==='left'||side==='right')?e.clientX:e.clientY;
      let delta=cur-startPx;
      // For right/bottom panels the inner edge is on the opposite side: invert delta
      if(side==='right'||side==='bottom') delta=-delta;
      const MIN=40,MAX=(side==='left'||side==='right')?600:400;
      const newSize=Math.max(MIN,Math.min(MAX,startSize+delta));
      if(side==='left'||side==='right') panel.style.width=newSize+'px';
      else panel.style.height=newSize+'px';
      panel._savedWidth=(side==='left'||side==='right')?newSize+'px':panel._savedWidth;
      reflowDockSide(side);
      if(typeof centerCanvas==='function') centerCanvas();
    });
    function endResize(){
      if(!resizing) return;
      resizing=false;rh.classList.remove('dragging');
      _saveLayout();
    }
    rh.addEventListener('pointerup',endResize);
    rh.addEventListener('pointercancel',endResize);
  }

  // ── Show/hide dock resize handle based on dock state ─────────────
  function _syncDockResizeHandle(panel){
    const rh=panel._dockResizeEl;
    if(!rh) return;
    const isDocked=panel.classList.contains('docked')&&!panel.classList.contains('fp-hidden');
    rh.style.display=isDocked?'block':'none';
  }

  // ── Layout persistence via localStorage ───────────────────────
  const LAYOUT_KEY='animator_panel_layout_v2';
  function _saveLayout(){
    const state={};
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const hidden=panel.classList.contains('fp-hidden');
      const docked=panel.classList.contains('docked');
      let side=null;
      if(docked){
        if(panel.classList.contains('dock-left')) side='left';
        else if(panel.classList.contains('dock-right')) side='right';
        else if(panel.classList.contains('dock-top')) side='top';
        else if(panel.classList.contains('dock-bottom')) side='bottom';
      }
      state[key]={
        hidden,docked,side,
        width:panel.style.width||'',
        height:panel.style.height||'',
        left:panel.style.left||'',
        top:panel.style.top||'',
        right:panel.style.right||'',
        bottom:panel.style.bottom||''
      };
    });
    try{localStorage.setItem(LAYOUT_KEY,JSON.stringify(state));}catch(e){}
  }
  function _restoreLayout(){
    let state;
    try{state=JSON.parse(localStorage.getItem(LAYOUT_KEY)||'null');}catch(e){return;}
    if(!state) return;
    allPanels.forEach(panel=>{
      const key=panel.dataset.panel;
      const s=state[key];
      if(!s) return;
      clearDockClasses(panel);
      if(s.docked&&s.side){
        panel.classList.add('dock-'+s.side,'docked');
        // For left/right docked panels, height is controlled by CSS (top:0;bottom:0;height:auto)
        // so don't restore a saved pixel height or it will prevent the panel from stretching
        // to fill the full main-area height. Similarly, width is CSS-controlled for top/bottom.
        if(s.width&&s.side!=='top'&&s.side!=='bottom') panel.style.width=s.width;
        if(s.height&&s.side!=='left'&&s.side!=='right') panel.style.height=s.height;
        panel._savedWidth=s.width||panel._savedWidth;
      } else {
        panel.style.left=s.left||'';
        panel.style.top=s.top||'';
        panel.style.right=s.right||'';
        panel.style.bottom=s.bottom||'';
        if(s.width) panel.style.width=s.width;
        if(s.height) panel.style.height=s.height;
      }
      if(s.hidden) panel.classList.add('fp-hidden');
      else panel.classList.remove('fp-hidden');
      _syncDockResizeHandle(panel);
    });
    // Reflow all dock sides
    ['left','right','top','bottom'].forEach(reflowDockSide);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(typeof fitCanvasToView==='function') fitCanvasToView();
      else if(typeof centerCanvas==='function') centerCanvas();
      updateWindowChecks();
    }));
  }

  init();

  return {setVisible,isVisible,bringToFront,resetLayout,
    saveLayout:_saveLayout,
    syncDockResizeHandle:_syncDockResizeHandle,
    setWindowCheckHook(fn){windowCheckHook=fn;}};
})();
