(function(){
  const STORE_KEY='animatorPaletteV1';
  const VIEW_KEY='animatorPaletteViewV1';
  const SWATCH_SIZE_MIN=16;
  const SWATCH_SIZE_MAX=64;
  const SWATCH_SIZE_STEP=2;
  const SWATCH_SIZE_DEFAULT=28;
  let swatches=[];
  let selectedId=null;
  let dragState=null;
  let suppressClick=false;
  let swatchSize=SWATCH_SIZE_DEFAULT;
  let savedScrollTop=0;
  let restoreScrollPending=false;
  let scrollSaveTimer=null;
  let resizeObserver=null;
  const defaultHexes=['#000000','#ffffff','#f23636','#ff9f1c','#ffd23f','#2ec4b6','#3a86ff','#8338ec'];

  function normalizeHex(hex){
    hex=String(hex||'').trim();
    if(/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
    return '#000000';
  }
  function isValidHex(text){return /^#[0-9a-f]{6}$/i.test(String(text||'').trim());}
  function hexToRgba(hex){
    hex=normalizeHex(hex);
    return {r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16),a:1};
  }
  function makeSwatch(hex,id){
    const safeHex=normalizeHex(hex);
    return {id:id||('pal_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)),hex:safeHex,rgba:hexToRgba(safeHex)};
  }
  function cloneSwatch(swatch){return makeSwatch(swatch.hex);}
  function defaultPalette(){return defaultHexes.map(hex=>makeSwatch(hex));}
  function sanitizePalette(input){
    const list=Array.isArray(input)?input:[];
    const clean=list.map(item=>makeSwatch(item&&item.hex,item&&item.id)).filter(Boolean);
    return clean.length?clean:defaultPalette();
  }
  function persist(){try{localStorage.setItem(STORE_KEY,JSON.stringify(serialize()));}catch(e){}}
  function persistView(){
    const grid=document.getElementById('palette-grid');
    if(grid) savedScrollTop=grid.scrollTop;
    try{localStorage.setItem(VIEW_KEY,JSON.stringify({swatchSize,scrollTop:savedScrollTop}));}catch(e){}
  }
  function loadView(){
    try{
      const view=JSON.parse(localStorage.getItem(VIEW_KEY)||'null');
      if(view&&Number.isFinite(+view.swatchSize)) swatchSize=clampSwatchSize(+view.swatchSize);
      if(view&&Number.isFinite(+view.scrollTop)) savedScrollTop=Math.max(0,+view.scrollTop);
    }catch(e){}
  }
  function serialize(){return {version:1,swatches:swatches.map(s=>({id:s.id,hex:s.hex,rgba:s.rgba})),selectedId,view:{swatchSize,scrollTop:savedScrollTop}};}
  function load(data){
    const payload=data&&Array.isArray(data.swatches)?data:null;
    swatches=sanitizePalette(payload?payload.swatches:null);
    if(payload&&payload.view&&Number.isFinite(+payload.view.swatchSize)) swatchSize=clampSwatchSize(+payload.view.swatchSize);
    if(payload&&payload.view&&Number.isFinite(+payload.view.scrollTop)) savedScrollTop=Math.max(0,+payload.view.scrollTop);
    selectedId=payload&&swatches.some(s=>s.id===payload.selectedId)?payload.selectedId:swatches[0].id;
    restoreScrollPending=true;
    applyViewSettings(false);
    render();
    persist();
  }
  function loadPersisted(){
    loadView();
    applyViewSettings(false);
    try{
      const saved=JSON.parse(localStorage.getItem(STORE_KEY)||'null');
      if(saved&&Array.isArray(saved.swatches)){load(saved);return;}
    }catch(e){}
    load(null);
  }
  function setForeground(hex,openPicker){
    const safeHex=normalizeHex(hex);
    if(typeof window.setForegroundColorFromPalette==='function') window.setForegroundColorFromPalette(safeHex,!!openPicker);
    else {
      color=safeHex;
      const input=document.getElementById('color-input');
      if(input) input.value=safeHex;
      const stat=document.getElementById('stat-color');
      if(stat) stat.textContent='Color: '+safeHex;
    }
  }
  function clampSwatchSize(value){
    const numeric=Number.isFinite(+value)?+value:SWATCH_SIZE_DEFAULT;
    const stepped=Math.round(numeric/SWATCH_SIZE_STEP)*SWATCH_SIZE_STEP;
    return Math.max(SWATCH_SIZE_MIN,Math.min(SWATCH_SIZE_MAX,stepped));
  }
  function applyViewSettings(keepSelectedVisible){
    swatchSize=clampSwatchSize(swatchSize);
    const body=document.getElementById('palette-body');
    if(body) body.style.setProperty('--palette-swatch-size',swatchSize+'px');
    const slider=document.getElementById('palette-size-slider');
    const value=document.getElementById('palette-size-value');
    if(slider) slider.value=String(swatchSize);
    if(value) value.textContent=swatchSize+' px';
    if(keepSelectedVisible) requestAnimationFrame(()=>ensureSelectedVisible());
  }
  function setSwatchSize(nextSize,keepSelectedVisible){
    const clamped=clampSwatchSize(nextSize);
    if(clamped===swatchSize) return;
    swatchSize=clamped;
    applyViewSettings(keepSelectedVisible!==false);
    persistView();
    persist();
  }
  function stepSwatchSize(delta){
    setSwatchSize(swatchSize+(delta*SWATCH_SIZE_STEP),true);
  }
  function ensureSelectedVisible(){
    const grid=document.getElementById('palette-grid');
    if(!grid||!selectedId) return;
    const selected=grid.querySelector('.palette-swatch[data-id="'+CSS.escape(selectedId)+'"]');
    if(selected) selected.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function restoreScrollIfNeeded(){
    if(!restoreScrollPending) return;
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    restoreScrollPending=false;
    requestAnimationFrame(()=>{
      grid.scrollTop=savedScrollTop;
      ensureSelectedVisible();
    });
  }
  function selectedSwatch(){return swatches.find(s=>s.id===selectedId)||null;}
  function swatchIndex(id){return swatches.findIndex(s=>s.id===id);}
  function updateSwatchColor(swatch,hex){
    if(!swatch) return;
    swatch.hex=normalizeHex(hex);
    swatch.rgba=hexToRgba(swatch.hex);
    if(swatch.id===selectedId) setForeground(swatch.hex,false);
    render();
    persist();
  }
  function selectSwatch(swatch,applyColor){
    if(!swatch) return;
    selectedId=swatch.id;
    if(applyColor) setForeground(swatch.hex,false);
    render();
    persist();
  }
  function render(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    const previousScroll=grid.scrollTop;
    grid.innerHTML='';
    swatches.forEach(s=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='palette-swatch';
      btn.dataset.id=s.id;
      btn.style.background=s.hex;
      btn.title=s.hex;
      btn.setAttribute('aria-label','Palette color '+s.hex);
      btn.classList.toggle('selected',s.id===selectedId);
      btn.addEventListener('click',()=>{
        if(suppressClick){suppressClick=false;return;}
        selectSwatch(s,true);
      });
      btn.addEventListener('dblclick',event=>{
        event.preventDefault();
        selectedId=s.id;
        render();
        persist();
        editSwatch(s);
      });

      btn.addEventListener('pointerdown',event=>beginDrag(event,s,btn));
      grid.appendChild(btn);
    });
    grid.scrollTop=restoreScrollPending?savedScrollTop:previousScroll;
    restoreScrollIfNeeded();
  }
  function syncSelectionClasses(){
    document.querySelectorAll('#palette-grid .palette-swatch').forEach(node=>{
      node.classList.toggle('selected',node.dataset.id===selectedId);
    });
  }
  function handleGridContextMenu(event){
    const swatchEl=event.target&&event.target.closest?event.target.closest('.palette-swatch'):null;
    const grid=document.getElementById('palette-grid');
    if(!swatchEl||!grid||!grid.contains(swatchEl)) return;
    event.preventDefault();
    event.stopPropagation();
    const swatch=swatches.find(s=>s.id===swatchEl.dataset.id);
    if(!swatch) return;
    selectedId=swatch.id;
    render();
    persist();
    showContextMenu(event.clientX,event.clientY,swatch);
  }
  function menuItem(label,fn,danger){
    if(label==='-'){
      const sep=document.createElement('div');
      sep.className='ctx-sep';
      return sep;
    }
    const item=document.createElement('div');
    item.className='ctx-item'+(danger?' danger':'');
    item.textContent=label;
    item.addEventListener('click',()=>{hideContextMenu();fn();});
    return item;
  }
  function showContextMenu(x,y,swatch){
    hideContextMenu();
    const menu=document.createElement('div');
    menu.id='palette-context-menu';
    menu.className='ctx-menu';
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    const items=[
      menuItem('Edit Color',()=>editSwatch(swatch)),
      menuItem('Duplicate Color',()=>duplicateSwatch(swatch)),
      menuItem('Delete Color',()=>deleteSwatch(swatch),true),
      menuItem('-'),
      menuItem('Insert Color Before',()=>insertNear(swatch,'before')),
      menuItem('Insert Color After',()=>insertNear(swatch,'after')),
      menuItem('-'),
      menuItem('Copy HEX',()=>copyHex(swatch)),
      menuItem('Paste Color',()=>pasteColor(swatch))
    ];
    items.forEach(item=>menu.appendChild(item));
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
    setTimeout(()=>document.addEventListener('pointerdown',hideContextMenu,{once:true}),0);
  }
  function hideContextMenu(){const menu=document.getElementById('palette-context-menu');if(menu) menu.remove();}
  function editSwatch(swatch){
    if(!swatch) return;
    const originalBrush=typeof color!=='undefined'?color:'#000000';
    selectedId=swatch.id;
    setForeground(swatch.hex,true);
    render();
    persist();
    showEditConfirmBar(swatch,originalBrush);
  }
  function showEditConfirmBar(swatch,originalBrush){
    hideEditConfirmBar();
    const panel=document.getElementById('color-panel');
    if(!panel) return;
    const bar=document.createElement('div');
    bar.id='palette-edit-confirm';
    const label=document.createElement('span');
    label.textContent='Edit palette color';
    const cancel=document.createElement('button');
    cancel.type='button';
    cancel.textContent='Cancel';
    const apply=document.createElement('button');
    apply.type='button';
    apply.textContent='Apply';
    apply.className='primary';
    cancel.addEventListener('click',()=>{setForeground(originalBrush,false);hideEditConfirmBar();});
    apply.addEventListener('click',()=>{updateSwatchColor(swatch,typeof color!=='undefined'?color:swatch.hex);hideEditConfirmBar();});
    bar.append(label,cancel,apply);
    panel.appendChild(bar);
  }
  function hideEditConfirmBar(){const bar=document.getElementById('palette-edit-confirm');if(bar) bar.remove();}
  function duplicateSwatch(swatch){
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    const copy=cloneSwatch(swatch);
    swatches.splice(idx+1,0,copy);
    selectedId=copy.id;
    render();
    persist();
  }
  function deleteSwatch(swatch){
    if(swatches.length<=1) return;
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    swatches.splice(idx,1);
    selectedId=swatches[Math.min(idx,swatches.length-1)].id;
    render();
    persist();
  }
  function deleteSelected(){const swatch=selectedSwatch();if(swatch) deleteSwatch(swatch);}
  function insertNear(swatch,where){
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    const inserted=makeSwatch(typeof color!=='undefined'?color:'#000000');
    swatches.splice(where==='before'?idx:idx+1,0,inserted);
    selectedId=inserted.id;
    render();
    persist();
  }
  async function copyHex(swatch){
    const text=swatch.hex.toUpperCase();
    try{await navigator.clipboard.writeText(text);}catch(e){
      const input=document.createElement('input');
      input.value=text;
      document.body.appendChild(input);
      input.select();
      try{document.execCommand('copy');}catch(err){}
      input.remove();
    }
  }
  function requestPasteHex(){
    return new Promise(resolve=>{
      const modal=document.getElementById('modal-palette-paste');
      const input=document.getElementById('palette-paste-hex-input');
      const ok=document.getElementById('palette-paste-ok');
      const cancel=document.getElementById('palette-paste-cancel');
      if(!modal||!input||!ok||!cancel){resolve('');return;}
      let done=false;
      function close(value){
        if(done) return;
        done=true;
        modal.classList.remove('visible');
        ok.removeEventListener('click',onOk);
        cancel.removeEventListener('click',onCancel);
        modal.removeEventListener('click',onBackdrop);
        input.removeEventListener('keydown',onKey);
        resolve(value||'');
      }
      function onOk(){close(input.value);}
      function onCancel(){close('');}
      function onBackdrop(event){if(event.target===modal) close('');}
      function onKey(event){
        if(event.key==='Enter') onOk();
        if(event.key==='Escape') onCancel();
      }
      input.value='#';
      ok.addEventListener('click',onOk);
      cancel.addEventListener('click',onCancel);
      modal.addEventListener('click',onBackdrop);
      input.addEventListener('keydown',onKey);
      modal.classList.add('visible');
      requestAnimationFrame(()=>{input.focus();input.select();});
    });
  }
  async function pasteColor(swatch){
    let text='';
    try{ text=await navigator.clipboard.readText(); }catch(e){ text=await requestPasteHex(); }
    text=String(text||'').trim();
    if(!isValidHex(text)) return;
    updateSwatchColor(swatch,text);
  }
  function addCurrent(){
    const created=makeSwatch(typeof color!=='undefined'?color:'#000000');
    swatches.push(created);
    selectedId=created.id;
    render();
    persist();
  }
  function clearAll(){
    if(!swatches.length) return;
    if(!confirm('Clear every color in this palette?')) return;
    swatches=[];
    selectedId=null;
    render();
    persist();
  }
  function beginDrag(event,swatch,el){
    if(event.button!==0) return;
    hideContextMenu();
    dragState={id:swatch.id,startX:event.clientX,startY:event.clientY,active:false,overId:swatch.id,side:'after',pointerId:event.pointerId};
    el.setPointerCapture(event.pointerId);
    el.addEventListener('pointermove',onDragMove);
    el.addEventListener('pointerup',onDragEnd);
    el.addEventListener('pointercancel',onDragEnd);
  }
  function onDragMove(event){
    if(!dragState||event.pointerId!==dragState.pointerId) return;
    const dx=event.clientX-dragState.startX;
    const dy=event.clientY-dragState.startY;
    if(!dragState.active&&Math.hypot(dx,dy)<5) return;
    dragState.active=true;
    suppressClick=true;
    const dragged=document.querySelector('.palette-swatch[data-id="'+CSS.escape(dragState.id)+'"]');
    if(dragged) dragged.classList.add('dragging');
    const target=document.elementFromPoint(event.clientX,event.clientY);
    const swatchEl=target&&target.closest?target.closest('.palette-swatch'):null;
    clearInsertIndicators();
    if(!swatchEl||swatchEl.dataset.id===dragState.id) return;
    const rect=swatchEl.getBoundingClientRect();
    dragState.overId=swatchEl.dataset.id;
    dragState.side=event.clientX<rect.left+rect.width/2?'before':'after';
    swatchEl.classList.add(dragState.side==='before'?'insert-before':'insert-after');
  }
  function onDragEnd(event){
    if(!dragState||event.pointerId!==dragState.pointerId) return;
    const el=document.querySelector('.palette-swatch[data-id="'+CSS.escape(dragState.id)+'"]');
    if(el){
      try{el.releasePointerCapture(event.pointerId);}catch(e){}
      el.removeEventListener('pointermove',onDragMove);
      el.removeEventListener('pointerup',onDragEnd);
      el.removeEventListener('pointercancel',onDragEnd);
    }
    const state=dragState;
    dragState=null;
    clearInsertIndicators();
    document.querySelectorAll('.palette-swatch.dragging').forEach(node=>node.classList.remove('dragging'));
    if(state.active&&state.overId&&state.overId!==state.id) reorderSwatch(state.id,state.overId,state.side);
    setTimeout(()=>{suppressClick=false;},0);
  }
  function clearInsertIndicators(){
    document.querySelectorAll('.palette-swatch.insert-before,.palette-swatch.insert-after').forEach(node=>node.classList.remove('insert-before','insert-after'));
  }
  function reorderSwatch(id,overId,side){
    const from=swatchIndex(id);
    const over=swatchIndex(overId);
    if(from<0||over<0) return;
    const [moved]=swatches.splice(from,1);
    let to=swatchIndex(overId);
    if(side==='after') to++;
    swatches.splice(to,0,moved);
    selectedId=id;
    render();
    persist();
  }
  function handleGridWheel(event){
    if(!event.ctrlKey) return;
    event.preventDefault();
    stepSwatchSize(event.deltaY<0?1:-1);
  }
  function handleGridScroll(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    savedScrollTop=grid.scrollTop;
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer=setTimeout(()=>persistView(),120);
  }
  function bindResizeObserver(){
    const panel=document.getElementById('palette-panel');
    if(!panel||typeof ResizeObserver==='undefined'||resizeObserver) return;
    resizeObserver=new ResizeObserver(()=>{
      persistView();
      requestAnimationFrame(()=>ensureSelectedVisible());
    });
    resizeObserver.observe(panel);
  }
  function bind(){
    const add=document.getElementById('palette-add-color');
    const remove=document.getElementById('palette-remove-color');
    const clear=document.getElementById('palette-clear');
    if(add) add.addEventListener('click',addCurrent);
    if(remove) remove.addEventListener('click',deleteSelected);
    if(clear) clear.addEventListener('click',clearAll);
    const sizeSlider=document.getElementById('palette-size-slider');
    if(sizeSlider&&!sizeSlider.dataset.bound){
      sizeSlider.addEventListener('input',()=>setSwatchSize(sizeSlider.value,true));
      sizeSlider.dataset.bound='1';
    }
    const grid=document.getElementById('palette-grid');
    if(grid&&!grid.dataset.contextBound){
      grid.addEventListener('contextmenu',handleGridContextMenu);
      grid.addEventListener('wheel',handleGridWheel,{passive:false});
      grid.addEventListener('scroll',handleGridScroll,{passive:true});
      grid.dataset.contextBound='1';
    }
    bindResizeObserver();
    applyViewSettings(false);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideContextMenu();hideEditConfirmBar();}});
  }
  window.PaletteDocker={serialize,load,reset(){load(null);},renderCurrentColors:render,refresh:render};
  document.addEventListener('DOMContentLoaded',()=>{bind();loadPersisted();});
})();