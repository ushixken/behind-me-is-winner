(function(){
  const STORE_KEY='animatorPaletteV1';
  const VIEW_KEY='animatorPaletteViewV1';
  const SWATCH_SIZE_MIN=16;
  const SWATCH_SIZE_MAX=64;
  const SWATCH_SIZE_STEP=2;
  const SWATCH_SIZE_DEFAULT=28;
  let palettes=[];
  let activePaletteId=null;
  let swatches=[];
  let selectedId=null;
  let dragState=null;
  let suppressClick=false;
  let swatchSize=SWATCH_SIZE_DEFAULT;
  let savedScrollTop=0;
  let restoreScrollPending=false;
  let scrollSaveTimer=null;
  let resizeObserver=null;
  let sideMenuOpen=false;
  let sideMenuFrame=null;
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
  function makeId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
  function makeSwatch(hex,id){
    const safeHex=normalizeHex(hex);
    return {id:id||makeId('pal'),hex:safeHex,rgba:hexToRgba(safeHex)};
  }
  function cloneSwatch(swatch){return makeSwatch(swatch.hex);}
  function defaultSwatches(){return defaultHexes.map(hex=>makeSwatch(hex));}
  function sanitizeSwatches(input,allowEmpty){
    const list=Array.isArray(input)?input:[];
    const clean=list.map(item=>makeSwatch(item&&item.hex,item&&item.id)).filter(Boolean);
    return clean.length||allowEmpty?clean:defaultSwatches();
  }
  function nextPaletteName(){
    let n=1;
    const names=new Set(palettes.map(p=>String(p.name||'').toLowerCase()));
    while(names.has(('Palette '+n).toLowerCase())) n++;
    return 'Palette '+n;
  }
  function uniqueCopyName(name){
    const root=String(name||'Palette').trim()||'Palette';
    let candidate=root+' Copy';
    let n=2;
    const names=new Set(palettes.map(p=>String(p.name||'').toLowerCase()));
    while(names.has(candidate.toLowerCase())) candidate=root+' Copy '+n++;
    return candidate;
  }
  function makePalette(name,swatchList,id,selection,allowEmpty){
    const cleanSwatches=sanitizeSwatches(swatchList,!!allowEmpty);
    const selected=selection&&cleanSwatches.some(s=>s.id===selection)?selection:(cleanSwatches[0]?cleanSwatches[0].id:null);
    return {id:id||makeId('palette'),name:String(name||'').trim()||nextPaletteName(),swatches:cleanSwatches,selectedId:selected};
  }
  function activePalette(){return palettes.find(p=>p.id===activePaletteId)||palettes[0]||null;}
  function rememberSelection(){const active=activePalette();if(active) active.selectedId=selectedId;}
  function syncActiveRefs(){
    let active=activePalette();
    if(!active){
      active=makePalette('Palette 1',defaultSwatches());
      palettes=[active];
      activePaletteId=active.id;
    }
    activePaletteId=active.id;
    swatches=active.swatches;
    selectedId=active.selectedId&&swatches.some(s=>s.id===active.selectedId)?active.selectedId:(swatches[0]?swatches[0].id:null);
    active.selectedId=selectedId;
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
  function serialize(){
    rememberSelection();
    return {version:2,palettes:palettes.map(p=>({id:p.id,name:p.name,swatches:p.swatches.map(s=>({id:s.id,hex:s.hex,rgba:s.rgba})),selectedId:p.selectedId||null})),activePaletteId,view:{swatchSize,scrollTop:savedScrollTop}};
  }
  function load(data){
    const payload=data&&typeof data==='object'?data:null;
    if(payload&&Array.isArray(payload.palettes)){
      palettes=payload.palettes.map((p,i)=>makePalette(p&&p.name||('Palette '+(i+1)),p&&p.swatches,p&&p.id,p&&p.selectedId,true)).filter(Boolean);
      if(!palettes.length) palettes=[makePalette('Palette 1',defaultSwatches())];
      activePaletteId=palettes.some(p=>p.id===payload.activePaletteId)?payload.activePaletteId:palettes[0].id;
    }else{
      palettes=[makePalette('Palette 1',payload&&Array.isArray(payload.swatches)?payload.swatches:null,null,payload&&payload.selectedId,false)];
      activePaletteId=palettes[0].id;
    }
    syncActiveRefs();
    if(payload&&payload.view&&Number.isFinite(+payload.view.swatchSize)) swatchSize=clampSwatchSize(+payload.view.swatchSize);
    if(payload&&payload.view&&Number.isFinite(+payload.view.scrollTop)) savedScrollTop=Math.max(0,+payload.view.scrollTop);
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
      if(saved&&(Array.isArray(saved.swatches)||Array.isArray(saved.palettes))){load(saved);return;}
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
  function stepSwatchSize(delta){setSwatchSize(swatchSize+(delta*SWATCH_SIZE_STEP),true);}
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
    requestAnimationFrame(()=>{grid.scrollTop=savedScrollTop;ensureSelectedVisible();});
  }
  function selectedSwatch(){return swatches.find(s=>s.id===selectedId)||null;}
  function swatchIndex(id){return swatches.findIndex(s=>s.id===id);}
  function updateSwatchColor(swatch,hex){
    if(!swatch) return;
    swatch.hex=normalizeHex(hex);
    swatch.rgba=hexToRgba(swatch.hex);
    if(swatch.id===selectedId) setForeground(swatch.hex,false);
    rememberSelection();
    render();
    persist();
  }
  function activatePaletteSwatch(swatchId,options){
    const swatch=swatches.find(s=>s.id===swatchId);
    if(!swatch) return;
    const opts=options||{};
    if(opts.select!==false){
      selectedId=swatch.id;
      rememberSelection();
      syncSelectionClasses();
    }
    if(opts.setForeground) setForeground(swatch.hex,false);
    persist();
  }
  function selectSwatch(swatch,applyColor){
    if(!swatch) return;
    activatePaletteSwatch(swatch.id,{select:true,setForeground:!!applyColor});
    render();
  }
  function sideMenu(){return document.getElementById('palette-side-menu');}
  function settingsButton(){return document.getElementById('palette-settings');}
  function positionSideMenu(){
    if(!sideMenuOpen) return;
    const menu=sideMenu();
    const panel=document.getElementById('palette-panel');
    const button=settingsButton();
    if(!menu||!panel||panel.classList.contains('fp-hidden')){closeSideMenu();return;}
    const panelRect=panel.getBoundingClientRect();
    const buttonRect=button?button.getBoundingClientRect():panelRect;
    const menuWidth=menu.offsetWidth||132;
    const menuHeight=menu.offsetHeight||120;
    const gap=0;
    const margin=6;
    const useLeft=panelRect.right+menuWidth+gap>window.innerWidth-margin&&panelRect.left-menuWidth-gap>=margin;
    const left=useLeft?Math.max(margin,panelRect.left-menuWidth-gap):Math.min(window.innerWidth-menuWidth-margin,panelRect.right+gap);
    const idealTop=buttonRect.top;
    const top=Math.max(margin,Math.min(window.innerHeight-menuHeight-margin,idealTop));
    menu.style.left=left+'px';
    menu.style.top=top+'px';
    menu.classList.toggle('left',useLeft);
  }
  function requestSideMenuPosition(){
    if(!sideMenuOpen||sideMenuFrame) return;
    sideMenuFrame=requestAnimationFrame(()=>{sideMenuFrame=null;positionSideMenu();});
  }
  function openSideMenu(){
    const menu=sideMenu();
    const button=settingsButton();
    if(!menu) return;
    sideMenuOpen=true;
    menu.classList.remove('hidden');
    if(button){button.classList.add('active');button.setAttribute('aria-expanded','true');}
    renderPaletteSelector();
    positionSideMenu();
  }
  function closeSideMenu(){
    const menu=sideMenu();
    const button=settingsButton();
    sideMenuOpen=false;
    if(sideMenuFrame){cancelAnimationFrame(sideMenuFrame);sideMenuFrame=null;}
    if(menu) menu.classList.add('hidden');
    if(button){button.classList.remove('active');button.setAttribute('aria-expanded','false');}
  }
  function toggleSideMenu(){sideMenuOpen?closeSideMenu():openSideMenu();}
  function handleSideMenuOutside(event){
    if(!sideMenuOpen) return;
    const menu=sideMenu();
    const panel=document.getElementById('palette-panel');
    const target=event.target;
    if((menu&&menu.contains(target))||(panel&&panel.contains(target))) return;
    closeSideMenu();
  }
  function renderPaletteSelector(){
    const selector=document.getElementById('palette-selector');
    if(selector){
      selector.innerHTML='';
      palettes.forEach(p=>{
        const option=document.createElement('option');
        option.value=p.id;
        option.textContent=p.name;
        selector.appendChild(option);
      });
      selector.value=activePaletteId;
    }
    const del=document.getElementById('palette-delete');
    if(del) del.disabled=palettes.length<=1;
    requestSideMenuPosition();
  }
  function render(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    syncActiveRefs();
    removeEscapedNewlineArtifacts();
    renderPaletteSelector();
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
      btn.addEventListener('pointerdown',event=>{
        if(event.isPrimary===false) return;
        if(event.button!==undefined&&event.button!==0) return;
        beginDrag(event,s,btn);
      });
      btn.addEventListener('dblclick',event=>{
        event.preventDefault();
        selectedId=s.id;
        rememberSelection();
        render();
        persist();
        editSwatch(s);
      });
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
  function removeEscapedNewlineArtifacts(){
    const body=document.getElementById('palette-body');
    if(!body) return;
    const tick=String.fromCharCode(96);
    const slash=String.fromCharCode(92);
    const artifacts=[tick+'r'+tick+'n',slash+'r'+slash+'n','r'+tick+'n','&'+'#13;'];
    Array.from(body.childNodes||[]).forEach(node=>{
      const text=node.nodeValue||'';
      if(node.nodeType===3&&artifacts.some(mark=>text.indexOf(mark)!==-1)) node.remove();
    });
  }
  function requestPaletteName(currentName){
    return new Promise(resolve=>{
      const modal=document.getElementById('modal-palette-rename');
      const input=document.getElementById('palette-rename-input');
      const ok=document.getElementById('palette-rename-ok');
      const cancel=document.getElementById('palette-rename-cancel');
      if(!modal||!input||!ok||!cancel){resolve(null);return;}
      let done=false;
      function close(value){
        if(done) return;
        done=true;
        modal.classList.remove('visible');
        ok.removeEventListener('click',onOk);
        cancel.removeEventListener('click',onCancel);
        modal.removeEventListener('click',onBackdrop);
        input.removeEventListener('keydown',onKey);
        resolve(value);
      }
      function onOk(){close(input.value);}
      function onCancel(){close(null);}
      function onBackdrop(event){if(event.target===modal) close(null);}
      function onKey(event){
        if(event.key==='Enter') onOk();
        if(event.key==='Escape') onCancel();
      }
      input.value=currentName||'';
      ok.addEventListener('click',onOk);
      cancel.addEventListener('click',onCancel);
      modal.addEventListener('click',onBackdrop);
      input.addEventListener('keydown',onKey);
      modal.classList.add('visible');
      requestAnimationFrame(()=>{input.focus();input.select();});
    });
  }
  function requestPaletteConfirm(title,message,okLabel){
    return new Promise(resolve=>{
      const modal=document.getElementById('modal-palette-confirm');
      const titleEl=document.getElementById('palette-confirm-title');
      const msgEl=document.getElementById('palette-confirm-message');
      const ok=document.getElementById('palette-confirm-ok');
      const cancel=document.getElementById('palette-confirm-cancel');
      if(!modal||!ok||!cancel){resolve(false);return;}
      let done=false;
      function close(value){
        if(done) return;
        done=true;
        modal.classList.remove('visible');
        ok.removeEventListener('click',onOk);
        cancel.removeEventListener('click',onCancel);
        modal.removeEventListener('click',onBackdrop);
        document.removeEventListener('keydown',onKey);
        resolve(!!value);
      }
      function onOk(){close(true);}
      function onCancel(){close(false);}
      function onBackdrop(event){if(event.target===modal) close(false);}
      function onKey(event){
        if(event.key==='Enter') onOk();
        if(event.key==='Escape') onCancel();
      }
      if(titleEl) titleEl.textContent=title||'Confirm';
      if(msgEl) msgEl.textContent=message||'';
      ok.textContent=okLabel||'OK';
      ok.addEventListener('click',onOk);
      cancel.addEventListener('click',onCancel);
      modal.addEventListener('click',onBackdrop);
      document.addEventListener('keydown',onKey);
      modal.classList.add('visible');
      requestAnimationFrame(()=>{if(ok.focus) ok.focus();});
    });
  }
  function switchPalette(id){
    if(!palettes.some(p=>p.id===id)||id===activePaletteId) return;
    rememberSelection();
    activePaletteId=id;
    restoreScrollPending=true;
    hideContextMenu();
    hideEditConfirmBar();
    render();
    persist();
  }
  function newPalette(){
    rememberSelection();
    const palette=makePalette(nextPaletteName(),[],null,null,true);
    palettes.push(palette);
    activePaletteId=palette.id;
    restoreScrollPending=true;
    render();
    persist();
  }
  async function renamePalette(){
    const active=activePalette();
    if(!active) return;
    const next=await requestPaletteName(active.name);
    if(next===null) return;
    const clean=String(next).trim();
    if(!clean) return;
    active.name=clean;
    renderPaletteSelector();
    persist();
  }
  function duplicatePalette(){
    const active=activePalette();
    if(!active) return;
    rememberSelection();
    const copy=makePalette(uniqueCopyName(active.name),active.swatches.map(cloneSwatch),null,active.selectedId,true);
    palettes.push(copy);
    activePaletteId=copy.id;
    restoreScrollPending=true;
    render();
    persist();
  }
  async function deletePalette(){
    if(palettes.length<=1) return;
    const active=activePalette();
    if(!active) return;
    const ok=await requestPaletteConfirm('Delete Palette','Delete palette "'+active.name+'"?','Delete');
    if(!ok) return;
    const idx=palettes.findIndex(p=>p.id===active.id);
    palettes.splice(idx,1);
    activePaletteId=palettes[Math.min(idx,palettes.length-1)].id;
    restoreScrollPending=true;
    hideContextMenu();
    hideEditConfirmBar();
    render();
    persist();
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
    rememberSelection();
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
    rememberSelection();
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
    rememberSelection();
    render();
    persist();
  }
  function deleteSwatch(swatch){
    if(swatches.length<=1) return;
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    swatches.splice(idx,1);
    selectedId=swatches[Math.min(idx,swatches.length-1)].id;
    rememberSelection();
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
    rememberSelection();
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
    rememberSelection();
    render();
    persist();
  }
  async function clearAll(){
    if(!swatches.length) return;
    const ok=await requestPaletteConfirm('Clear Palette','Clear every color in this palette?','Clear');
    if(!ok) return;
    swatches=[];
    selectedId=null;
    const active=activePalette();
    if(active){active.swatches=swatches;active.selectedId=null;}
    render();
    persist();
  }
  function beginDrag(event,swatch,el){
    if(event.isPrimary===false) return;
    if(event.button!==undefined&&event.button!==0) return;
    hideContextMenu();
    dragState={id:swatch.id,startX:event.clientX,startY:event.clientY,active:false,overId:swatch.id,side:'after',pointerId:event.pointerId,sourceEl:el,captured:false};
    document.addEventListener('pointermove',onDragMove);
    document.addEventListener('pointerup',onDragEnd);
    document.addEventListener('pointercancel',onDragEnd);
  }
  function onDragMove(event){
    if(!dragState||event.pointerId!==dragState.pointerId) return;
    const dx=event.clientX-dragState.startX;
    const dy=event.clientY-dragState.startY;
    if(!dragState.active){
      if(Math.hypot(dx,dy)<5) return;
      dragState.active=true;
      suppressClick=true;
      if(dragState.sourceEl&&!dragState.captured){
        try{dragState.sourceEl.setPointerCapture(event.pointerId);dragState.captured=true;}catch(e){}
      }
      const dragged=document.querySelector('.palette-swatch[data-id="'+CSS.escape(dragState.id)+'"]');
      if(dragged) dragged.classList.add('dragging');
    }
    event.preventDefault();
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
    const state=dragState;
    dragState=null;
    document.removeEventListener('pointermove',onDragMove);
    document.removeEventListener('pointerup',onDragEnd);
    document.removeEventListener('pointercancel',onDragEnd);
    if(state.sourceEl&&state.captured){
      try{state.sourceEl.releasePointerCapture(event.pointerId);}catch(e){}
    }
    clearInsertIndicators();
    document.querySelectorAll('.palette-swatch.dragging').forEach(node=>node.classList.remove('dragging'));
    if(state.active){
      event.preventDefault();
      if(state.overId&&state.overId!==state.id) reorderSwatch(state.id,state.overId,state.side);
      else activatePaletteSwatch(state.id,{select:true,setForeground:false});
      setTimeout(()=>{suppressClick=false;},0);
      return;
    }
    activatePaletteSwatch(state.id,{select:true,setForeground:true});
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
    rememberSelection();
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
      requestAnimationFrame(()=>{ensureSelectedVisible();requestSideMenuPosition();});
    });
    resizeObserver.observe(panel);
  }
  function bind(){
    const add=document.getElementById('palette-add-color');
    const remove=document.getElementById('palette-remove-color');
    const clear=document.getElementById('palette-clear');
    const selector=document.getElementById('palette-selector');
    const newBtn=document.getElementById('palette-new');
    const renameBtn=document.getElementById('palette-rename');
    const duplicateBtn=document.getElementById('palette-duplicate');
    const deleteBtn=document.getElementById('palette-delete');
    const settings=settingsButton();
    if(selector) selector.addEventListener('change',()=>switchPalette(selector.value));
    if(settings) settings.addEventListener('click',event=>{event.stopPropagation();toggleSideMenu();});
    if(newBtn) newBtn.addEventListener('click',()=>{newPalette();closeSideMenu();});
    if(renameBtn) renameBtn.addEventListener('click',()=>{renamePalette();closeSideMenu();});
    if(duplicateBtn) duplicateBtn.addEventListener('click',()=>{duplicatePalette();closeSideMenu();});
    if(deleteBtn) deleteBtn.addEventListener('click',()=>{deletePalette();closeSideMenu();});
    const panel=document.getElementById('palette-panel');
    const closeBtn=panel?panel.querySelector('.fp-close'):null;
    if(closeBtn) closeBtn.addEventListener('click',()=>setTimeout(closeSideMenu,0));
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
    document.addEventListener('pointerdown',handleSideMenuOutside);
    document.addEventListener('pointermove',requestSideMenuPosition);
    window.addEventListener('resize',requestSideMenuPosition);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideContextMenu();hideEditConfirmBar();closeSideMenu();}});
  }
  window.PaletteDocker={serialize,load,reset(){load(null);},renderCurrentColors:render,refresh:render};
  document.addEventListener('DOMContentLoaded',()=>{bind();loadPersisted();});
})();