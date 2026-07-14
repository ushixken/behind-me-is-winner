(function(){
  const STORE_KEY='animatorPaletteV1';
  const VIEW_KEY='animatorPaletteViewV1';
  const SWATCH_SIZE_MIN=16;
  const SWATCH_SIZE_MAX=64;
  const SWATCH_SIZE_STEP=2;
  const SWATCH_SIZE_DEFAULT=28;
  const ADVANCED_PALETTE_VERSION=2;
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
  let dropdownOpen=false;
  let dropdownFrame=null;
  let toolbarPaletteMode='hidden';
  let advancedPaletteEnabled=false;
  let advancedPaletteVersion=0;
  let advancedStyles=[];
  let activeAdvancedStyleId=null;
  let popupListenersBound=false;
  let paletteDragState=null;
  const defaultHexes=['#000000','#ffffff','#f23636','#ff9f1c','#ffd23f','#2ec4b6','#3a86ff','#8338ec'];
  function makeAdvancedStyle(rgba,id,name){
    const values=Array.isArray(rgba)?rgba:[0,0,0,255];
    const safeRgba=[0,1,2,3].map(i=>Math.max(0,Math.min(255,Math.round(Number(values[i]??(i===3?255:0))||0))));
    return {id:id||makeId('style'),type:'style',name:String(name||'').trim()||nextAdvancedStyleName(),rgba:safeRgba,locked:false,visible:true};
  }
  function makeAdvancedSeparator(id){return {id:id||makeId('advsep'),type:'separator'};}
  function isAdvancedSeparator(item){return !!item&&item.type==='separator';}
  function styleHex(style){const c=style&&Array.isArray(style.rgba)?style.rgba:[0,0,0,255];return rgbaToHex(c[0],c[1],c[2],c[3]);}
  function sanitizeAdvancedStyles(input){
    const list=Array.isArray(input)?input:[];
    return list.map((style,i)=>{
      if(isAdvancedSeparator(style)) return makeAdvancedSeparator(style.id);
      const made=makeAdvancedStyle(style&&style.rgba,style&&style.id,style&&style.name||('color_'+(i+1)));
      made.locked=!!(style&&style.locked);
      made.visible=style&&style.visible===false?false:true;
      return made;
    });
  }
  function nextAdvancedStyleName(){
    let n=1;
    const names=new Set(advancedStyles.filter(s=>!isAdvancedSeparator(s)).map(s=>String(s.name||'').toLowerCase()));
    while(names.has(('color_'+n).toLowerCase())) n++;
    return 'color_'+n;
  }
  function activeAdvancedStyle(){return advancedStyles.find(s=>!isAdvancedSeparator(s)&&s.id===activeAdvancedStyleId)||advancedStyles.find(s=>!isAdvancedSeparator(s))||null;}
  function activeLayerUsesAdvancedPalette(){return !!(layers[curLayer]&&layers[curLayer].type==='smart-raster');}
  function syncAdvancedRefs(){
    advancedStyles=sanitizeAdvancedStyles(advancedStyles);
    if(!advancedStyles.some(s=>!isAdvancedSeparator(s)&&s.id===activeAdvancedStyleId)){
      const first=advancedStyles.find(s=>!isAdvancedSeparator(s));
      activeAdvancedStyleId=first?first.id:null;
    }
  }

  function normalizeHex(hex){
    hex=String(hex||'').trim();
    if(/^#[0-9a-f]{8}$/i.test(hex)) return hex.toLowerCase();
    if(/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
    return '#000000';
  }
  function isTransparentHex(hex){return /^#[0-9a-f]{8}$/i.test(String(hex||'').trim())&&String(hex).slice(7,9).toLowerCase()==='00';}
  function isValidHex(text){return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(text||'').trim());}
  function hexToRgba(hex){
    hex=normalizeHex(hex);
    const alpha=hex.length===9?parseInt(hex.slice(7,9),16)/255:1;
    return {r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16),a:alpha};
  }
  function byteToHex(value){
    const n=Math.max(0,Math.min(255,Math.round(Number(value)||0)));
    return n.toString(16).padStart(2,'0');
  }
  function rgbToHex(r,g,b){return '#'+byteToHex(r)+byteToHex(g)+byteToHex(b);}
  function rgbaArray(hex){
    const rgba=hexToRgba(hex);
    return [rgba.r,rgba.g,rgba.b,Math.round((Number.isFinite(+rgba.a)?rgba.a:1)*255)];
  }
  function rgbaToHex(r,g,b,a){
    const alpha=Number.isFinite(+a)?Math.max(0,Math.min(255,Math.round(+a))):255;
    const base=rgbToHex(r,g,b);
    return alpha<255?base+byteToHex(alpha):base;
  }
  function rgbToHsv(r,g,b){
    r=Math.max(0,Math.min(255,+r||0))/255;
    g=Math.max(0,Math.min(255,+g||0))/255;
    b=Math.max(0,Math.min(255,+b||0))/255;
    const max=Math.max(r,g,b);
    const min=Math.min(r,g,b);
    const delta=max-min;
    let h=0;
    if(delta){
      if(max===r) h=((g-b)/delta)%6;
      else if(max===g) h=(b-r)/delta+2;
      else h=(r-g)/delta+4;
      h*=60;
      if(h<0) h+=360;
    }
    const s=max===0?0:delta/max;
    return {h,s,v:max};
  }
  function hsvToRgb(h,s,v){
    h=((+h||0)%360+360)%360;
    s=Math.max(0,Math.min(1,+s||0));
    v=Math.max(0,Math.min(1,+v||0));
    const c=v*s;
    const x=c*(1-Math.abs((h/60)%2-1));
    const m=v-c;
    let r=0,g=0,b=0;
    if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}
    return {r:Math.round((r+m)*255),g:Math.round((g+m)*255),b:Math.round((b+m)*255)};
  }
  function rgbToHsl(r,g,b){
    r=Math.max(0,Math.min(255,+r||0))/255;
    g=Math.max(0,Math.min(255,+g||0))/255;
    b=Math.max(0,Math.min(255,+b||0))/255;
    const max=Math.max(r,g,b);
    const min=Math.min(r,g,b);
    const l=(max+min)/2;
    let h=0,s=0;
    if(max!==min){
      const d=max-min;
      s=l>.5?d/(2-max-min):d/(max+min);
      if(max===r) h=(g-b)/d+(g<b?6:0);
      else if(max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h*=60;
    }
    return {h,s,l};
  }
  function hslToRgb(h,s,l){
    h=((+h||0)%360+360)%360/360;
    s=Math.max(0,Math.min(1,+s||0));
    l=Math.max(0,Math.min(1,+l||0));
    if(s===0){const v=Math.round(l*255);return {r:v,g:v,b:v};}
    const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
    const q=l<.5?l*(1+s):l+s-l*s;
    const p=2*l-q;
    return {r:Math.round(hue2rgb(p,q,h+1/3)*255),g:Math.round(hue2rgb(p,q,h)*255),b:Math.round(hue2rgb(p,q,h-1/3)*255)};
  }
  function displayHex(hex){return normalizeHex(hex).slice(0,7);}
  function currentForegroundHex(){return normalizeHex(typeof color!=='undefined'?color:'#000000').slice(0,7);}
  function makeId(prefix){return prefix+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
  function makeSwatch(hex,id,name){
    const safeHex=normalizeHex(hex);
    const swatch={id:id||makeId('pal'),type:'swatch',hex:safeHex,rgba:hexToRgba(safeHex)};
    const cleanName=String(name||'').trim();
    if(cleanName) swatch.name=cleanName;
    return swatch;
  }
  function makeSeparator(id){return {id:id||makeId('sep'),type:'separator'};}
  function makeSpacer(id){return {id:id||makeId('space'),type:'spacer'};}
  function isSeparator(item){return !!item&&item.type==='separator';}
  function isSpacer(item){return !!item&&item.type==='spacer';}
  function isSwatch(item){return !!item&&item.type!=='separator'&&item.type!=='spacer';}
  function cloneSwatch(swatch){return isSeparator(swatch)?makeSeparator():isSpacer(swatch)?makeSpacer():makeSwatch(swatch.hex,null,swatch&&swatch.name);}
  function defaultSwatches(){return defaultHexes.map(hex=>makeSwatch(hex));}
  function createDefaultPaletteState(){
    const palette=makePalette('Palette 1',defaultSwatches());
    return {version:2,palettes:[palette],activePaletteId:palette.id,advancedPalette:{version:ADVANCED_PALETTE_VERSION,enabled:false,styles:[],activeStyleId:null},view:{swatchSize,scrollTop:0,toolbarPaletteMode:'hidden',advancedPaletteEnabled:false}};
  }
  function sanitizePaletteItem(item){
    if(!item||typeof item!=='object') return null;
    if(item.type==='separator') return makeSeparator(item.id);
    if(item.type==='spacer') return makeSpacer(item.id);
    if(item.type&&item.type!=='swatch') return null;
    if(!item.hex&&!item.rgba) return null;
    const hex=item.hex||rgbaToHex(item.rgba&&item.rgba[0],item.rgba&&item.rgba[1],item.rgba&&item.rgba[2],item.rgba&&item.rgba[3]);
    return makeSwatch(hex,item.id,item.name);
  }
  function sanitizeSwatches(input,allowEmpty){
    const list=Array.isArray(input)?input:[];
    const clean=list.map(sanitizePaletteItem).filter(Boolean);
    return clean.length||allowEmpty?clean:defaultSwatches();
  }
  function nextPaletteName(){
    let n=1;
    const names=new Set(palettes.map(p=>String(p.name||'').toLowerCase()));
    while(names.has(('Palette '+n).toLowerCase())) n++;
    return 'Palette '+n;
  }
  function uniquePaletteName(name,excludeId){
    const root=String(name||'Palette').trim()||'Palette';
    const names=new Set(palettes.filter(p=>p.id!==excludeId).map(p=>String(p.name||'').toLowerCase()));
    if(!names.has(root.toLowerCase())) return root;
    let n=2;
    let candidate=root+' '+n;
    while(names.has(candidate.toLowerCase())) candidate=root+' '+(++n);
    return candidate;
  }
  function uniqueImportedPaletteName(name){
    const root=String(name||'Palette').trim()||'Palette';
    const names=new Set(palettes.map(p=>String(p.name||'').toLowerCase()));
    if(!names.has(root.toLowerCase())) return root;
    let n=2;
    let candidate=root+' ('+n+')';
    while(names.has(candidate.toLowerCase())) candidate=root+' ('+(++n)+')';
    return candidate;
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
    try{localStorage.setItem(VIEW_KEY,JSON.stringify({swatchSize,scrollTop:savedScrollTop,toolbarPaletteMode,advancedPaletteEnabled}));}catch(e){}
  }
  function loadView(){
    try{
      const view=JSON.parse(localStorage.getItem(VIEW_KEY)||'null');
      if(view&&Number.isFinite(+view.swatchSize)) swatchSize=clampSwatchSize(+view.swatchSize);
      if(view&&Number.isFinite(+view.scrollTop)) savedScrollTop=Math.max(0,+view.scrollTop);
      toolbarPaletteMode=view&&view.toolbarPaletteMode==='active'?'active':'hidden';
      advancedPaletteEnabled=!!(view&&view.advancedPaletteEnabled);
    }catch(e){}
  }
  function serialize(){
    rememberSelection();
    return {version:2,palettes:palettes.map(p=>({id:p.id,name:p.name,swatches:p.swatches.map(exportSwatchData),selectedId:p.selectedId||null})),activePaletteId,advancedPalette:{version:ADVANCED_PALETTE_VERSION,enabled:advancedPaletteEnabled,styles:advancedStyles,activeStyleId:activeAdvancedStyleId},view:{swatchSize,scrollTop:savedScrollTop,toolbarPaletteMode,advancedPaletteEnabled}};
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
    if(payload&&payload.view) toolbarPaletteMode=payload.view.toolbarPaletteMode==='active'?'active':'hidden';
    const advancedPayload=payload&&payload.advancedPalette;
    advancedPaletteEnabled=!!(advancedPayload&&advancedPayload.enabled)||(payload&&payload.view&&!!payload.view.advancedPaletteEnabled);
    advancedPaletteVersion=Number.isFinite(+(advancedPayload&&advancedPayload.version))?+advancedPayload.version:0;
    advancedStyles=sanitizeAdvancedStyles(advancedPayload&&advancedPayload.styles);
    activeAdvancedStyleId=advancedPayload&&advancedPayload.activeStyleId;
    if(advancedPaletteEnabled&&!advancedStyles.length) initializeAdvancedPaletteFromActivePalette();
    migrateAdvancedPaletteIfNeeded();
    syncAdvancedRefs();
    restoreScrollPending=true;
    applyViewSettings(false);
    render();
    persist();
  }
  function loadPersisted(){
    loadView();
    applyViewSettings(false);
    let saved=null;
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(raw) saved=JSON.parse(raw);
    }catch(e){saved=null;}
    if(saved&&(Array.isArray(saved.swatches)||Array.isArray(saved.palettes))){load(saved);return;}
    load(createDefaultPaletteState());
  }
  function setForeground(hex,openPicker){
    const safeHex=normalizeHex(hex);
    if(isTransparentHex(safeHex)) return;
    if(typeof window.setForegroundColorFromPalette==='function') window.setForegroundColorFromPalette(safeHex,!!openPicker);
    else {
      color=displayHex(safeHex);
      const input=document.getElementById('color-input');
      if(input) input.value=displayHex(safeHex);
      const stat=document.getElementById('stat-color');
      if(stat) stat.textContent='Color: '+displayHex(safeHex);
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
  function toolbarPaletteEnabled(){return toolbarPaletteMode==='active';}
  function syncToolbarSelection(){}
  function renderToolbarPalette(){
    const wrap=document.getElementById('toolbar-palette-wrap');
    const strip=document.getElementById('toolbar-palette-strip');
    if(!wrap||!strip) return;
    wrap.classList.toggle('hidden',!toolbarPaletteEnabled());
    strip.innerHTML='';
    if(!toolbarPaletteEnabled()) return;
    const active=activePalette();
    const items=active&&Array.isArray(active.swatches)?active.swatches:[];
    items.forEach(item=>{
      if(isSeparator(item)){
        const gap=document.createElement('span');
        gap.className='toolbar-palette-separator';
        gap.setAttribute('aria-hidden','true');
        strip.appendChild(gap);
        return;
      }
      if(!isSwatch(item)) return;
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='toolbar-palette-swatch';
      btn.dataset.id=item.id;
      btn.title=item.hex;
      btn.setAttribute('aria-label','Set color '+item.hex);
      if(isTransparentHex(item.hex)) btn.classList.add('transparent');
      else {
        btn.style.background=displayHex(item.hex);
        const c=hexToRgba(item.hex);
        if(c.r<=24&&c.g<=24&&c.b<=24) btn.classList.add('dark-color');
      }
      btn.addEventListener('click',event=>{
        event.preventDefault();
        activatePaletteSwatch(item.id,{select:true,setForeground:true});
      });
      strip.appendChild(btn);
    });
  }
  function toggleToolbarPalette(){
    toolbarPaletteMode=toolbarPaletteEnabled()?'hidden':'active';
    renderPaletteSelector();
    renderToolbarPalette();
    persistView();
    persist();
    closeSideMenu();
  }
  function selectedSwatch(){const item=swatches.find(s=>s.id===selectedId)||null;return isSwatch(item)?item:null;}
  function selectedItem(){return swatches.find(s=>s.id===selectedId)||null;}
  function swatchIndex(id){return swatches.findIndex(s=>s.id===id);}
  function updateSwatchColor(swatch,hex){
    if(!isSwatch(swatch)) return;
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
      syncToolbarSelection();
    }
    if(opts.setForeground&&isSwatch(swatch)) setForeground(swatch.hex,false);
    persist();
  }
  function selectSwatch(swatch,applyColor){
    if(!swatch) return;
    activatePaletteSwatch(swatch.id,{select:true,setForeground:!!applyColor});
    render();
  }
  function sideMenu(){return document.getElementById('palette-side-menu');}
  function paletteDropdown(){return document.getElementById('palette-dropdown');}
  function settingsButton(){return document.getElementById('palette-settings');}
  function activeDisplay(){return document.getElementById('palette-active-display');}
  function positionPaletteDropdown(){
    if(!dropdownOpen) return;
    const menu=paletteDropdown();
    const button=activeDisplay();
    const panel=document.getElementById('palette-panel');
    if(!menu||!button||!panel||panel.classList.contains('fp-hidden')){closePaletteDropdown();return;}
    const rect=button.getBoundingClientRect();
    const margin=6;
    const width=Math.max(rect.width,menu.offsetWidth||180);
    const height=menu.offsetHeight||180;
    const left=Math.max(margin,Math.min(window.innerWidth-width-margin,rect.left));
    const top=Math.max(margin,Math.min(window.innerHeight-height-margin,rect.bottom+2));
    menu.style.left=left+'px';
    menu.style.top=top+'px';
    menu.style.width=width+'px';
  }
  function requestPaletteDropdownPosition(){
    if(!dropdownOpen||dropdownFrame) return;
    dropdownFrame=requestAnimationFrame(()=>{dropdownFrame=null;positionPaletteDropdown();});
  }
  function openPaletteDropdown(){
    const menu=paletteDropdown();
    if(!menu) return;
    closeSideMenu();
    dropdownOpen=true;
    menu.classList.remove('hidden');
    renderPaletteList();
    positionPaletteDropdown();
  }
  function closePaletteDropdown(){
    const menu=paletteDropdown();
    dropdownOpen=false;
    if(dropdownFrame){cancelAnimationFrame(dropdownFrame);dropdownFrame=null;}
    if(menu) menu.classList.add('hidden');
  }
  function togglePaletteDropdown(){dropdownOpen?closePaletteDropdown():openPaletteDropdown();}
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
    closePaletteDropdown();
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
    hidePaletteInlinePanels();
    if(button){button.classList.remove('active');button.setAttribute('aria-expanded','false');}
  }
  function toggleSideMenu(){sideMenuOpen?closeSideMenu():openSideMenu();}
  function handlePalettePopupOutside(event){
    const target=event.target;
    const menu=sideMenu();
    const dropdown=paletteDropdown();
    const settings=settingsButton();
    const display=activeDisplay();
    if(sideMenuOpen){
      if((menu&&menu.contains(target))||(settings&&settings.contains(target))) return;
      closeSideMenu();
    }
    if(dropdownOpen){
      if(paletteDragState) return;
      if((dropdown&&dropdown.contains(target))||(display&&display.contains(target))) return;
      closePaletteDropdown();
    }
  }
  function handlePalettePopupKeydown(event){
    if(event.key!=='Escape') return;
    hideContextMenu();
    hideEditConfirmBar();
    closeSideMenu();
    closePaletteDropdown();
  }
  function bindPalettePopupListeners(){
    if(popupListenersBound) return;
    popupListenersBound=true;
    document.addEventListener('pointerdown',handlePalettePopupOutside);
    document.addEventListener('pointermove',()=>{requestSideMenuPosition();requestPaletteDropdownPosition();});
    window.addEventListener('resize',()=>{requestSideMenuPosition();requestPaletteDropdownPosition();});
    document.addEventListener('keydown',handlePalettePopupKeydown);
  }
  function hidePaletteInlinePanels(){
    const rename=document.getElementById('palette-rename-inline');
    const confirm=document.getElementById('palette-delete-confirm');
    if(rename) rename.classList.add('hidden');
    if(confirm) confirm.classList.add('hidden');
  }
  function renderPaletteList(){
    const list=paletteDropdown();
    if(!list) return;
    list.innerHTML='';
    palettes.forEach(p=>{
      const item=document.createElement('div');
      item.className='palette-list-item';
      item.dataset.id=p.id;
      item.title=p.name;
      item.classList.toggle('active',p.id===activePaletteId);
      const grip=document.createElement('span');
      grip.className='palette-list-grip';
      grip.textContent='::';
      const name=document.createElement('span');
      name.className='palette-list-name';
      name.textContent=p.name;
      item.append(grip,name);
      item.addEventListener('pointerdown',event=>beginPaletteListPointer(event,p.id,item));
      list.appendChild(item);
    });
  }
  function beginPaletteListPointer(event,id,el){
    if(event.isPrimary===false) return;
    if(event.button!==undefined&&event.button!==0) return;
    paletteDragState={id,startX:event.clientX,startY:event.clientY,active:false,overId:id,side:'after',pointerId:event.pointerId,sourceEl:el,captured:false};
    document.addEventListener('pointermove',onPaletteListPointerMove);
    document.addEventListener('pointerup',onPaletteListPointerEnd);
    document.addEventListener('pointercancel',onPaletteListPointerEnd);
  }
  function onPaletteListPointerMove(event){
    if(!paletteDragState||event.pointerId!==paletteDragState.pointerId) return;
    const dx=event.clientX-paletteDragState.startX;
    const dy=event.clientY-paletteDragState.startY;
    if(!paletteDragState.active){
      if(Math.hypot(dx,dy)<5) return;
      paletteDragState.active=true;
      if(paletteDragState.sourceEl&&!paletteDragState.captured){
        try{paletteDragState.sourceEl.setPointerCapture(event.pointerId);paletteDragState.captured=true;}catch(e){}
      }
      if(paletteDragState.sourceEl) paletteDragState.sourceEl.classList.add('dragging');
    }
    event.preventDefault();
    clearPaletteListIndicators();
    const target=document.elementFromPoint(event.clientX,event.clientY);
    const item=target&&target.closest?target.closest('.palette-list-item'):null;
    if(!item||item.dataset.id===paletteDragState.id) return;
    const rect=item.getBoundingClientRect();
    paletteDragState.overId=item.dataset.id;
    paletteDragState.side=event.clientY<rect.top+rect.height/2?'before':'after';
    item.classList.add(paletteDragState.side==='before'?'insert-before':'insert-after');
  }
  function onPaletteListPointerEnd(event){
    if(!paletteDragState||event.pointerId!==paletteDragState.pointerId) return;
    const state=paletteDragState;
    paletteDragState=null;
    document.removeEventListener('pointermove',onPaletteListPointerMove);
    document.removeEventListener('pointerup',onPaletteListPointerEnd);
    document.removeEventListener('pointercancel',onPaletteListPointerEnd);
    if(state.sourceEl&&state.captured){try{state.sourceEl.releasePointerCapture(event.pointerId);}catch(e){}}
    clearPaletteListIndicators();
    document.querySelectorAll('.palette-list-item.dragging').forEach(node=>node.classList.remove('dragging'));
    if(state.active&&!cancelled){
      event.preventDefault();
      if(state.overId&&state.overId!==state.id) reorderPalette(state.id,state.overId,state.side);
      return;
    }
    switchPalette(state.id);
    closePaletteDropdown();
  }
  function clearPaletteListIndicators(){
    document.querySelectorAll('.palette-list-item.insert-before,.palette-list-item.insert-after').forEach(node=>node.classList.remove('insert-before','insert-after'));
  }
  function reorderPalette(id,overId,side){
    const from=palettes.findIndex(p=>p.id===id);
    const over=palettes.findIndex(p=>p.id===overId);
    if(from<0||over<0) return;
    rememberSelection();
    const keepActiveId=activePaletteId;
    const [moved]=palettes.splice(from,1);
    let to=palettes.findIndex(p=>p.id===overId);
    if(side==='after') to++;
    palettes.splice(to,0,moved);
    activePaletteId=palettes.some(p=>p.id===keepActiveId)?keepActiveId:id;
    syncActiveRefs();
    render();
    persist();
  }
  function renderPaletteSelector(){
    const active=activePalette();
    const display=activeDisplay();
    const nameEl=document.getElementById('palette-active-name');
    if(display){
      display.title=active?active.name:'';
      display.setAttribute('aria-label',active?('Active palette: '+active.name):'Active palette');
    }
    if(nameEl) nameEl.textContent=active?active.name:'Palette';
    const del=document.getElementById('palette-delete');
    if(del) del.disabled=palettes.length<=1;
    const toolbarToggle=document.getElementById('palette-toolbar-toggle');
    if(toolbarToggle){
      toolbarToggle.classList.toggle('active',toolbarPaletteEnabled());
      toolbarToggle.textContent=(toolbarPaletteEnabled()?'[On] ':'')+'Attach to Toolbar';
    }
    const advancedToggle=document.getElementById('palette-advanced-toggle');
    if(advancedToggle){
      advancedToggle.classList.toggle('active',advancedPaletteEnabled);
      advancedToggle.textContent='Advanced Palette: '+(advancedPaletteEnabled?'On':'Off');
    }
    renderPaletteList();
    requestSideMenuPosition();
  }
  function setAdvancedPaletteEnabled(enabled){
    const nextEnabled=!!enabled;
    if(nextEnabled&&!advancedPaletteEnabled) initializeAdvancedPaletteFromActivePalette();
    advancedPaletteEnabled=nextEnabled;
    if(nextEnabled) migrateAdvancedPaletteIfNeeded();
    syncAdvancedRefs();
    render();
    persistView();
    persist();
    closeSideMenu();
  }
  function toggleAdvancedPalette(){setAdvancedPaletteEnabled(!advancedPaletteEnabled);}
  function normalPaletteColorCount(){
    const active=activePalette();
    return active&&Array.isArray(active.swatches)?active.swatches.filter(isSwatch).length:0;
  }
  function isDefaultBlackWhiteAdvancedStyles(styles){
    const list=Array.isArray(styles)?styles.filter(s=>!isAdvancedSeparator(s)):[];
    if(list.length!==2||styles.length!==2) return false;
    const first=list[0],second=list[1];
    return String(first.name||'').toLowerCase()==='color_1'
      &&String(second.name||'').toLowerCase()==='color_2'
      &&styleHex(first).slice(0,7).toLowerCase()==='#000000'
      &&styleHex(second).slice(0,7).toLowerCase()==='#ffffff';
  }
  function shouldMigrateAdvancedPaletteDefaults(){
    return advancedPaletteVersion<ADVANCED_PALETTE_VERSION
      &&isDefaultBlackWhiteAdvancedStyles(advancedStyles)
      &&normalPaletteColorCount()>2;
  }
  function initializeAdvancedPaletteFromActivePalette(force){
    if(advancedStyles.length&&!force) return;
    const active=activePalette();
    const source=(active&&Array.isArray(active.swatches)?active.swatches:[]);
    let colorIndex=1;
    advancedStyles=source.reduce((items,item)=>{
      if(isSeparator(item)){items.push(makeAdvancedSeparator());return items;}
      if(!isSwatch(item)) return items;
      items.push(makeAdvancedStyle(rgbaArray(item.hex),null,'color_'+colorIndex++));
      return items;
    },[]);
    if(!advancedStyles.some(s=>!isAdvancedSeparator(s))){
      defaultSwatches().forEach(item=>advancedStyles.push(makeAdvancedStyle(rgbaArray(item.hex),null,'color_'+colorIndex++)));
    }
    const first=advancedStyles.find(s=>!isAdvancedSeparator(s));
    activeAdvancedStyleId=first?first.id:null;
    advancedPaletteVersion=ADVANCED_PALETTE_VERSION;
  }
  function migrateAdvancedPaletteIfNeeded(){
    if(!advancedStyles.length){
      advancedPaletteVersion=ADVANCED_PALETTE_VERSION;
      return false;
    }
    if(!shouldMigrateAdvancedPaletteDefaults()){
      advancedPaletteVersion=Math.max(advancedPaletteVersion||0,ADVANCED_PALETTE_VERSION);
      return false;
    }
    initializeAdvancedPaletteFromActivePalette(true);
    return true;
  }
  function selectAdvancedStyle(id,setBrush){
    const style=advancedStyles.find(s=>!isAdvancedSeparator(s)&&s.id===id);
    if(!style) return;
    activeAdvancedStyleId=style.id;
    if(setBrush!==false) setForeground(styleHex(style),false);
    render();
    persist();
  }
  function createAdvancedStyle(){
    syncAdvancedRefs();
    const style=makeAdvancedStyle(rgbaArray(currentForegroundHex()),null,nextAdvancedStyleName());
    advancedStyles.push(style);
    activeAdvancedStyleId=style.id;
    setForeground(styleHex(style),false);
    render();
    persist();
  }
  function findAdvancedStyleById(id){return advancedStyles.find(s=>!isAdvancedSeparator(s)&&s.id===id)||null;}
  function refreshAdvancedStyleChange(style){
    if(style&&style.id===activeAdvancedStyleId) setForeground(styleHex(style),false);
    render();
    renderToolbarPalette();
    persist();
    if(typeof window.rerenderAllSmartRasterFrames==='function') window.rerenderAllSmartRasterFrames();
    else if(typeof recomposite==='function') recomposite(curLayer,curFrame);
  }
  function requestAdvancedStyleRename(style){
    return new Promise(resolve=>{
      const existing=document.getElementById('modal-advanced-style-rename');
      if(existing) existing.remove();
      const overlay=document.createElement('div');
      overlay.id='modal-advanced-style-rename';
      overlay.className='modal-overlay visible';
      overlay.innerHTML='<div class="modal palette-rename-style-modal" role="dialog" aria-modal="true" aria-labelledby="advanced-style-rename-title"><h2 id="advanced-style-rename-title">Rename Style</h2><div class="modal-row"><label for="advanced-style-rename-input">Style name</label><input id="advanced-style-rename-input" type="text" /></div><div class="modal-actions"><button class="modal-btn" id="advanced-style-rename-cancel" type="button">Cancel</button><button class="modal-btn primary" id="advanced-style-rename-ok" type="button">OK</button></div></div>';
      document.body.appendChild(overlay);
      const input=overlay.querySelector('#advanced-style-rename-input');
      const ok=overlay.querySelector('#advanced-style-rename-ok');
      const cancel=overlay.querySelector('#advanced-style-rename-cancel');
      let done=false;
      const close=value=>{
        if(done) return;
        done=true;
        document.removeEventListener('keydown',onKey,true);
        overlay.remove();
        resolve(value);
      };
      const submit=()=>{
        const clean=String(input.value||'').trim();
        if(!clean){input.value=style.name||'';input.select();return;}
        close(clean);
      };
      const onKey=event=>{
        if(event.key==='Escape'){event.preventDefault();close(null);}
        else if(event.key==='Enter'){event.preventDefault();submit();}
      };
      ok.addEventListener('click',submit);
      cancel.addEventListener('click',()=>close(null));
      overlay.addEventListener('pointerdown',event=>{if(event.target===overlay) close(null);});
      document.addEventListener('keydown',onKey,true);
      input.value=style.name||'';
      requestAnimationFrame(()=>{input.focus();input.select();});
    });
  }
  function editAdvancedStyle(style){
    const target=findAdvancedStyleById(style&&style.id);
    if(!target||target.locked) return;
    showEditColorModal({hex:styleHex(target)},hex=>{
      const stored=findAdvancedStyleById(target.id);
      if(!stored||stored.locked) return;
      stored.rgba=rgbaArray(hex);
      refreshAdvancedStyleChange(stored);
    });
  }
  async function renameAdvancedStyle(style){
    const target=findAdvancedStyleById(style&&style.id);
    if(!target) return;
    const clean=await requestAdvancedStyleRename(target);
    if(!clean) return;
    const stored=findAdvancedStyleById(target.id);
    if(!stored) return;
    stored.name=clean;
    refreshAdvancedStyleChange(stored);
  }
  function duplicateAdvancedStyle(style){
    if(!style) return;
    const copy=makeAdvancedStyle(style.rgba,null,nextAdvancedStyleName());
    copy.name=(style.name||'color')+' Copy';
    advancedStyles.push(copy);
    activeAdvancedStyleId=copy.id;
    render();
    persist();
  }
  function deleteAdvancedStyle(style){
    if(!style||isAdvancedSeparator(style)||advancedStyles.filter(s=>!isAdvancedSeparator(s)).length<=1) return;
    const idx=advancedStyles.findIndex(s=>s.id===style.id);
    if(idx<0) return;
    advancedStyles.splice(idx,1);
    if(activeAdvancedStyleId===style.id){const next=advancedStyles.slice(idx).concat(advancedStyles.slice(0,idx)).find(s=>!isAdvancedSeparator(s));activeAdvancedStyleId=next?next.id:null;}
    // Mark pixels owned by this style as orphaned in the style-index buffer.
    // The RGBA artwork is preserved; only the style ownership meta is updated.
    if(typeof window.markStyleDeleted==='function') window.markStyleDeleted(style.id);
    render();
    persist();
  }
  function toggleAdvancedStyleLock(style){
    if(!style) return;
    style.locked=!style.locked;
    render();
    persist();
  }
  function showAdvancedStyleContextMenu(x,y,style){
    hideContextMenu();
    const menu=document.createElement('div');
    menu.id='palette-context-menu';
    menu.className='ctx-menu';
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    [
      menuItem('Edit Style',()=>editAdvancedStyle(style),false,!!style.locked),
      menuItem('Rename Style',()=>renameAdvancedStyle(style)),
      menuItem('Duplicate Style',()=>duplicateAdvancedStyle(style)),
      menuItem('Delete Style',()=>deleteAdvancedStyle(style),true,advancedStyles.filter(s=>!isAdvancedSeparator(s)).length<=1),
      menuItem('-'),
      menuItem(style.locked?'Unlock Style':'Lock Style',()=>toggleAdvancedStyleLock(style))
    ].forEach(item=>menu.appendChild(item));
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
    setTimeout(()=>document.addEventListener('pointerdown',hideContextMenu,{once:true}),0);
  }
  function renderAdvancedPalette(grid){
    syncAdvancedRefs();
    grid.classList.add('advanced-palette-grid');
    grid.innerHTML='';
    advancedStyles.forEach(style=>{
      if(isAdvancedSeparator(style)){
        const separator=document.createElement('div');
        separator.className='palette-style-separator';
        separator.setAttribute('aria-hidden','true');
        grid.appendChild(separator);
        return;
      }
      const card=document.createElement('button');
      card.type='button';
      card.className='palette-style-card';
      card.dataset.id=style.id;
      card.classList.toggle('selected',style.id===activeAdvancedStyleId);
      card.classList.toggle('locked',!!style.locked);
      const preview=document.createElement('span');
      preview.className='palette-style-preview';
      preview.style.background=displayHex(styleHex(style));
      const meta=document.createElement('span');
      meta.className='palette-style-meta';
      const name=document.createElement('span');
      name.className='palette-style-name';
      name.textContent=style.name||style.id;
      const id=document.createElement('span');
      id.className='palette-style-id';
      id.textContent=style.id;
      meta.append(name,id);
      const lock=document.createElement('span');
      lock.className='palette-style-lock';
      lock.textContent=style.locked?'LOCK':'';
      card.append(preview,meta,lock);
      card.addEventListener('click',()=>selectAdvancedStyle(style.id,true));
      card.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();activeAdvancedStyleId=style.id;render();showAdvancedStyleContextMenu(event.clientX,event.clientY,style);});
      grid.appendChild(card);
    });
    const add=document.createElement('button');
    add.type='button';
    add.className='palette-style-add';
    add.textContent='+';
    add.title='Create style';
    add.addEventListener('click',createAdvancedStyle);
    grid.appendChild(add);
  }  function render(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    syncActiveRefs();
    removeEscapedNewlineArtifacts();
    renderPaletteSelector();
    const body=document.getElementById('palette-body');
    const useAdvanced=activeLayerUsesAdvancedPalette();
    if(useAdvanced&&!advancedStyles.length) initializeAdvancedPaletteFromActivePalette();
    if(body) body.classList.toggle('advanced-mode',useAdvanced);
    if(useAdvanced){
      renderAdvancedPalette(grid);
      updateToolbarState();
      renderToolbarPalette();
      requestAnimationFrame(()=>checkGridOverflow());
      return;
    }
    grid.classList.remove('advanced-palette-grid');
    const previousScroll=grid.scrollTop;
    grid.innerHTML='';
    swatches.forEach(s=>{
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='palette-swatch';
      btn.dataset.id=s.id;
      if(isSeparator(s)){
        btn.classList.add('separator');
        btn.title='Separator';
        btn.setAttribute('aria-label','Palette separator');
      }else if(isSpacer(s)){
        btn.classList.add('spacer');
        btn.tabIndex=-1;
        btn.setAttribute('aria-hidden','true');
      }else{
        if(isTransparentHex(s.hex)) btn.classList.add('transparent');
        else {
          btn.style.background=displayHex(s.hex);
          const c=hexToRgba(s.hex);
          if(c.r<=24&&c.g<=24&&c.b<=24) btn.classList.add('dark-color');
        }
        btn.title=s.hex;
        btn.setAttribute('aria-label','Palette color '+s.hex);
      }
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
        if(isSwatch(s)) editSwatch(s);
      });
      grid.appendChild(btn);
    });
    grid.scrollTop=restoreScrollPending?savedScrollTop:previousScroll;
    updateToolbarState();
    renderToolbarPalette();
    restoreScrollIfNeeded();
    requestAnimationFrame(()=>checkGridOverflow());
  }
  function checkGridOverflow(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    grid.classList.toggle('is-overflow',grid.scrollHeight>grid.clientHeight+1);
  }
  function updateToolbarState(){
    const item=selectedItem();
    const apply=document.getElementById('palette-apply-color');
    const remove=document.getElementById('palette-remove-color');
    if(apply) apply.disabled=!isSwatch(item);
    if(remove) remove.disabled=!item;
  }
  function syncSelectionClasses(){
    updateToolbarState();
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
  function showRenameEditor(){
    const active=activePalette();
    const box=document.getElementById('palette-rename-inline');
    const input=document.getElementById('palette-rename-inline-input');
    if(!active||!box||!input) return;
    const confirm=document.getElementById('palette-delete-confirm');
    if(confirm) confirm.classList.add('hidden');
    box.classList.remove('hidden');
    input.value=active.name;
    requestAnimationFrame(()=>{input.focus();input.select();positionSideMenu();});
  }
  function applyInlineRename(){
    const active=activePalette();
    const input=document.getElementById('palette-rename-inline-input');
    if(!active||!input) return;
    const clean=String(input.value||'').trim();
    if(!clean){input.focus();return;}
    active.name=uniquePaletteName(clean,active.id);
    hidePaletteInlinePanels();
    renderPaletteSelector();
    persist();
    closeSideMenu();
  }
  function showDeleteConfirm(){
    if(palettes.length<=1) return;
    const active=activePalette();
    const box=document.getElementById('palette-delete-confirm');
    const text=document.getElementById('palette-delete-confirm-text');
    if(!active||!box) return;
    const rename=document.getElementById('palette-rename-inline');
    if(rename) rename.classList.add('hidden');
    if(text) text.textContent='Delete "'+active.name+'"?';
    box.classList.remove('hidden');
    requestAnimationFrame(()=>positionSideMenu());
  }
  function confirmDeletePalette(){
    if(palettes.length<=1) return;
    const active=activePalette();
    if(!active) return;
    const idx=palettes.findIndex(p=>p.id===active.id);
    palettes.splice(idx,1);
    activePaletteId=palettes[Math.min(idx,palettes.length-1)].id;
    hidePaletteInlinePanels();
    restoreScrollPending=true;
    hideContextMenu();
    hideEditConfirmBar();
    render();
    persist();
    closeSideMenu();
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
  function renamePalette(){showRenameEditor();}
  function duplicatePalette(){
    const active=activePalette();
    if(!active) return;
    rememberSelection();
    const source=active.swatches||[];
    const copiedSwatches=source.map(cloneSwatch);
    const selectedIndex=source.findIndex(s=>s.id===active.selectedId);
    const copiedSelected=selectedIndex>=0&&copiedSwatches[selectedIndex]?copiedSwatches[selectedIndex].id:null;
    const copy=makePalette(uniqueCopyName(active.name),copiedSwatches,null,copiedSelected,true);
    palettes.push(copy);
    activePaletteId=copy.id;
    restoreScrollPending=true;
    render();
    persist();
  }
  function showPaletteWarning(message){
    const box=document.getElementById('palette-import-warning');
    if(!box) return;
    box.textContent=message||'';
    box.classList.toggle('hidden',!message);
    requestSideMenuPosition();
  }
  function hidePaletteWarning(){showPaletteWarning('');}
  function safeFilename(name,ext){
    const base=String(name||'palette').trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').slice(0,64)||'palette';
    return base+'.'+ext;
  }
  function exportSwatchData(swatch){
    if(isSeparator(swatch)) return {id:swatch.id,type:'separator'};
    if(isSpacer(swatch)) return {id:swatch.id,type:'spacer'};
    return {id:swatch.id,type:'swatch',hex:normalizeHex(swatch.hex).toUpperCase(),rgba:rgbaArray(swatch.hex),name:swatch.name||undefined};
  }
  function downloadText(filename,text,type){
    const blob=new Blob([text],{type:type||'text/plain'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  function activePaletteExportData(){
    const active=activePalette();
    if(!active) return null;
    return {version:1,name:active.name,swatches:(active.swatches||[]).map(exportSwatchData)};
  }
  function allPalettesExportData(){
    rememberSelection();
    return {version:1,palettes:palettes.map(p=>({id:p.id,name:p.name,swatches:(p.swatches||[]).map(exportSwatchData),selectedId:p.selectedId||null})),activePaletteId};
  }
  function exportActivePaletteJson(){
    const active=activePalette();
    const data=activePaletteExportData();
    if(!active||!data) return;
    downloadText(safeFilename(active.name,'json'),JSON.stringify(data,null,2),'application/json');
    closeSideMenu();
  }
  function exportAllPalettesJson(){
    downloadText('palettes.json',JSON.stringify(allPalettesExportData(),null,2),'application/json');
    closeSideMenu();
  }
  function exportActivePaletteGpl(){
    const active=activePalette();
    if(!active) return;
    const lines=['GIMP Palette','Name: '+active.name,'Columns: 8','#'];
    (active.swatches||[]).filter(isSwatch).forEach(s=>{
      const c=hexToRgba(s.hex);
      const label=s.name?(' '+s.name):'';
      lines.push(String(c.r).padStart(3,' ')+' '+String(c.g).padStart(3,' ')+' '+String(c.b).padStart(3,' ')+label);
    });
    downloadText(safeFilename(active.name,'gpl'),lines.join('\n')+'\n','text/plain');
    closeSideMenu();
  }
  function swatchFromImport(item){
    if(!item||typeof item!=='object') return null;
    if(item.type==='separator') return makeSeparator();
    if(item.type==='spacer') return makeSpacer();
    let hex=isValidHex(item.hex)?normalizeHex(item.hex):null;
    if(!hex&&Array.isArray(item.rgba)&&item.rgba.length>=3) hex=rgbToHex(item.rgba[0],item.rgba[1],item.rgba[2]);
    if(!hex) return null;
    return makeSwatch(hex,null,item.name);
  }
  function paletteFromImport(name,swatchItems,selectedImportId){
    const source=Array.isArray(swatchItems)?swatchItems:[];
    const swatchList=[];
    let selectedIndex=-1;
    source.forEach((item)=>{
      const swatch=swatchFromImport(item);
      if(!swatch) return;
      if(item&&item.id===selectedImportId) selectedIndex=swatchList.length;
      swatchList.push(swatch);
    });
    if(!swatchList.length) return null;
    const selected=selectedIndex>=0&&swatchList[selectedIndex]?swatchList[selectedIndex].id:null;
    return makePalette(uniqueImportedPaletteName(name),swatchList,null,selected,true);
  }
  function parsePaletteJson(text){
    let data;
    try{data=JSON.parse(text);}catch(e){throw new Error('Invalid JSON palette file.');}
    if(!data||typeof data!=='object') throw new Error('Invalid palette file.');
    if(Array.isArray(data.palettes)){
      const imported=[];
      data.palettes.forEach((p,i)=>{
        const palette=paletteFromImport(p&&p.name||('Palette '+(i+1)),p&&p.swatches,p&&p.selectedId);
        if(!palette) return;
        if(p&&p.id===data.activePaletteId) imported.activeId=palette.id;
        imported.push(palette);
      });
      if(!imported.length) throw new Error('No colors were found in this palette file.');
      if(!imported.activeId) imported.activeId=imported[0].id;
      return imported;
    }
    const one=paletteFromImport(data.name||'Imported Palette',data.swatches,data.selectedId);
    if(!one) throw new Error('No colors were found in this palette file.');
    return [one];
  }
  function parseGpl(text){
    const lines=String(text||'').split(/\r?\n/);
    let name='Imported GPL Palette';
    const swatchList=[];
    lines.forEach(line=>{
      const trimmed=line.trim();
      if(!trimmed||trimmed[0]==='#'||trimmed==='GIMP Palette') return;
      const nameMatch=trimmed.match(/^Name:\s*(.+)$/i);
      if(nameMatch){name=nameMatch[1].trim()||name;return;}
      if(/^[A-Za-z]+:/.test(trimmed)) return;
      const match=trimmed.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.+))?$/);
      if(!match) return;
      const r=+match[1],g=+match[2],b=+match[3];
      if([r,g,b].some(v=>!Number.isFinite(v)||v<0||v>255)) return;
      swatchList.push(makeSwatch(rgbToHex(r,g,b),null,match[4]||''));
    });
    if(!swatchList.length) throw new Error('No GPL colors were found.');
    return [makePalette(uniqueImportedPaletteName(name),swatchList,null,null,true)];
  }
  function importPalettes(imported){
    if(!Array.isArray(imported)||!imported.length) throw new Error('No palettes were imported.');
    rememberSelection();
    palettes=palettes.concat(imported);
    activePaletteId=imported.activeId&&imported.some(p=>p.id===imported.activeId)?imported.activeId:imported[0].id;
    restoreScrollPending=true;
    hidePaletteWarning();
    render();
    persist();
    closeSideMenu();
  }
  function handleImportFile(file){
    if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const text=String(reader.result||'');
        const imported=/\.gpl$/i.test(file.name)?parseGpl(text):parsePaletteJson(text);
        importPalettes(imported);
      }catch(e){showPaletteWarning(e&&e.message?e.message:'Invalid palette file.');}
    };
    reader.onerror=()=>showPaletteWarning('Could not read that palette file.');
    reader.readAsText(file);
  }
  function chooseImportFile(){
    hidePaletteInlinePanels();
    hidePaletteWarning();
    const input=document.getElementById('palette-import-file');
    if(!input) return;
    input.value='';
    input.click();
  }
  function deletePalette(){showDeleteConfirm();}
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
  function menuItem(label,fn,danger,disabled){
    if(label==='-'){
      const sep=document.createElement('div');
      sep.className='ctx-sep';
      return sep;
    }
    const item=document.createElement('div');
    item.className='ctx-item'+(danger?' danger':'')+(disabled?' disabled':'');
    item.textContent=label;
    if(disabled) item.setAttribute('aria-disabled','true');
    else item.addEventListener('click',()=>{hideContextMenu();fn();});
    return item;
  }
  function showContextMenu(x,y,item){
    hideContextMenu();
    const menu=document.createElement('div');
    menu.id='palette-context-menu';
    menu.className='ctx-menu';
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    const items=isSeparator(item)?[
      menuItem('Duplicate Separator',()=>duplicateSwatch(item)),
      menuItem('Delete Separator',()=>deleteSwatch(item),true),
      menuItem('-'),
      menuItem('Move to Beginning',()=>moveItemToEdge(item,'start')),
      menuItem('Move to End',()=>moveItemToEdge(item,'end'))
    ]:[
      menuItem('Edit Color',()=>editSwatch(item),false,!!item.locked),
      menuItem('Duplicate Color',()=>duplicateSwatch(item)),
      menuItem('Delete Color',()=>deleteSwatch(item),true),
      menuItem('-'),
      menuItem('Insert Color Before',()=>insertNear(item,'before')),
      menuItem('Insert Color After',()=>insertNear(item,'after')),
      menuItem('-'),
      menuItem('Copy HEX',()=>copyHex(item)),
      menuItem('Paste Color',()=>pasteColor(item))
    ];
    items.forEach(item=>menu.appendChild(item));
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
    setTimeout(()=>document.addEventListener('pointerdown',hideContextMenu,{once:true}),0);
  }
  function hideContextMenu(){const menu=document.getElementById('palette-context-menu');if(menu) menu.remove();}
  function editSwatch(swatch){
    if(!isSwatch(swatch)||swatch.locked) return;
    selectedId=swatch.id;
    rememberSelection();
    syncSelectionClasses();
    showEditColorModal(swatch);
  }
  function showEditColorModal(swatch,onApply){
    hideEditConfirmBar();
    const existing=document.getElementById('palette-color-modal');
    if(existing) existing.remove();
    const original=normalizeHex(swatch.hex);
    const start=hexToRgba(original);
    let alpha=Math.round((Number.isFinite(+start.a)?start.a:1)*255);
    let hsv=rgbToHsv(start.r,start.g,start.b);
    let mode='RGB';
    const modal=document.createElement('div');
    modal.id='palette-color-modal';
    modal.innerHTML='<div class="palette-color-dialog wheel" role="dialog" aria-modal="true" aria-label="Edit color" tabindex="-1"><div class="palette-color-title"><span>Edit Color</span><button type="button" class="palette-color-close" aria-label="Cancel">&times;</button></div><div class="palette-color-body"><div class="palette-color-picker-column"><div class="palette-color-previews"><div><span>Current</span><div class="palette-color-preview current"></div></div><div><span>New</span><div class="palette-color-preview next"></div></div></div><div class="palette-wheel-wrap"><div class="palette-hue-wheel"><div class="palette-hue-cursor"></div><div class="palette-inner-sv"><div class="palette-sv-cursor"></div></div></div></div></div><div class="palette-color-control-column"><div class="palette-mode-tabs"><button type="button" data-mode="RGB">RGB</button><button type="button" data-mode="HSV">HSV</button><button type="button" data-mode="HSL">HSL</button><button type="button" data-mode="HEX">HEX</button></div><div class="palette-mode-fields"></div></div></div><div class="palette-color-actions"><button type="button" class="palette-color-ok">OK</button><button type="button" class="palette-color-cancel">Cancel</button></div></div>';
    document.body.appendChild(modal);
    const dialog=modal.querySelector('.palette-color-dialog');
    const wheel=modal.querySelector('.palette-hue-wheel');
    const sv=modal.querySelector('.palette-inner-sv');
    const hueCursor=modal.querySelector('.palette-hue-cursor');
    const svCursor=modal.querySelector('.palette-sv-cursor');
    const fields=modal.querySelector('.palette-mode-fields');
    const currentPreview=modal.querySelector('.palette-color-preview.current');
    const nextPreview=modal.querySelector('.palette-color-preview.next');
    let dragging='';
    function currentRgb(){return hsvToRgb(hsv.h,hsv.s,hsv.v);}
    function colorHex(){const rgb=currentRgb();return rgbaToHex(rgb.r,rgb.g,rgb.b,alpha);}
    function paintPreview(el,hex){if(isTransparentHex(hex)) el.classList.add('transparent');else el.classList.remove('transparent');el.style.background=isTransparentHex(hex)?'':displayHex(hex);}
    function setRgb(r,g,b,nextAlpha){
      const rgb={r:Math.max(0,Math.min(255,Math.round(+r||0))),g:Math.max(0,Math.min(255,Math.round(+g||0))),b:Math.max(0,Math.min(255,Math.round(+b||0)))};
      if(nextAlpha!==undefined) alpha=Math.max(0,Math.min(255,Math.round(+nextAlpha||0)));
      hsv=rgbToHsv(rgb.r,rgb.g,rgb.b);
      syncAll();
    }
    function setHsv(h,s,v,nextAlpha){
      hsv={h:Math.max(0,Math.min(359,+h||0)),s:Math.max(0,Math.min(1,(+s||0)/100)),v:Math.max(0,Math.min(1,(+v||0)/100))};
      if(nextAlpha!==undefined) alpha=Math.max(0,Math.min(255,Math.round(+nextAlpha||0)));
      syncAll();
    }
    function setHsl(h,s,l,nextAlpha){
      const rgb=hslToRgb(h,(+s||0)/100,(+l||0)/100);
      setRgb(rgb.r,rgb.g,rgb.b,nextAlpha);
    }
    function setFromHex(value){
      const clean=String(value||'').trim();
      if(!isValidHex(clean)) return;
      const rgba=hexToRgba(clean);
      setRgb(rgba.r,rgba.g,rgba.b,Math.round((Number.isFinite(+rgba.a)?rgba.a:1)*255));
    }
    function field(label,value,min,max,step,cls){
      return '<label>'+label+'<div class="palette-field-row"><input class="'+cls+'-range" type="range" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"><input class="'+cls+'" type="number" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'"></div></label>';
    }
    function renderFields(){
      const rgb=currentRgb();
      const hsl=rgbToHsl(rgb.r,rgb.g,rgb.b);
      modal.querySelectorAll('.palette-mode-tabs button').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));
      if(mode==='RGB') fields.innerHTML=field('R',rgb.r,0,255,1,'edit-r')+field('G',rgb.g,0,255,1,'edit-g')+field('B',rgb.b,0,255,1,'edit-b')+field('A',alpha,0,255,1,'edit-a');
      else if(mode==='HSV') fields.innerHTML=field('H',Math.round(hsv.h),0,359,1,'edit-h')+field('S',Math.round(hsv.s*100),0,100,1,'edit-s')+field('V',Math.round(hsv.v*100),0,100,1,'edit-v')+field('A',alpha,0,255,1,'edit-a');
      else if(mode==='HSL') fields.innerHTML=field('H',Math.round(hsl.h),0,359,1,'edit-hsl-h')+field('S',Math.round(hsl.s*100),0,100,1,'edit-hsl-s')+field('L',Math.round(hsl.l*100),0,100,1,'edit-hsl-l')+field('A',alpha,0,255,1,'edit-a');
      else fields.innerHTML='<label>HEX <input class="edit-hex" type="text" spellcheck="false" value="'+colorHex().toUpperCase()+'"></label>';
      bindFields();
    }
    function bindPair(cls,fn){
      const number=fields.querySelector('.'+cls);
      const range=fields.querySelector('.'+cls+'-range');
      [number,range].forEach(input=>{if(input) input.addEventListener('input',()=>{if(number&&range){number.value=input.value;range.value=input.value;}fn();});});
    }
    function bindFields(){
      if(mode==='RGB'){
        const fn=()=>setRgb(fields.querySelector('.edit-r').value,fields.querySelector('.edit-g').value,fields.querySelector('.edit-b').value,fields.querySelector('.edit-a').value);
        ['edit-r','edit-g','edit-b','edit-a'].forEach(cls=>bindPair(cls,fn));
      }else if(mode==='HSV'){
        const fn=()=>setHsv(fields.querySelector('.edit-h').value,fields.querySelector('.edit-s').value,fields.querySelector('.edit-v').value,fields.querySelector('.edit-a').value);
        ['edit-h','edit-s','edit-v','edit-a'].forEach(cls=>bindPair(cls,fn));
      }else if(mode==='HSL'){
        const fn=()=>setHsl(fields.querySelector('.edit-hsl-h').value,fields.querySelector('.edit-hsl-s').value,fields.querySelector('.edit-hsl-l').value,fields.querySelector('.edit-a').value);
        ['edit-hsl-h','edit-hsl-s','edit-hsl-l','edit-a'].forEach(cls=>bindPair(cls,fn));
      }else{
        const hex=fields.querySelector('.edit-hex');
        if(hex) hex.addEventListener('input',()=>setFromHex(hex.value));
      }
    }
    function syncWheel(){
      const hueColor=rgbToHex(...Object.values(hsvToRgb(hsv.h,1,1)));
      sv.style.setProperty('--palette-edit-hue',hueColor);
      const rect=wheel.getBoundingClientRect();
      const radius=rect.width/2;
      const angle=(hsv.h-180)*Math.PI/180;
      const cursorRadius=radius-10;
      hueCursor.style.left=(radius+Math.cos(angle)*cursorRadius)+'px';
      hueCursor.style.top=(radius+Math.sin(angle)*cursorRadius)+'px';
      svCursor.style.left=(hsv.s*100)+'%';
      svCursor.style.top=((1-hsv.v)*100)+'%';
    }
    function syncAll(){paintPreview(nextPreview,colorHex());syncWheel();renderFields();}
    function setHueFromEvent(event){
      const rect=wheel.getBoundingClientRect();
      const cx=rect.left+rect.width/2;
      const cy=rect.top+rect.height/2;
      hsv.h=(Math.atan2(event.clientY-cy,event.clientX-cx)*180/Math.PI+180+360)%360;
      syncAll();
    }
    function setSvFromEvent(event){
      const rect=sv.getBoundingClientRect();
      hsv.s=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
      hsv.v=1-Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
      syncAll();
    }
    function close(){document.removeEventListener('keydown',onKey);modal.remove();}
    function ok(){if(typeof onApply==='function') onApply(colorHex()); else updateSwatchColor(swatch,colorHex());close();}
    function cancel(){close();}
    function onKey(event){if(event.key==='Escape'){event.preventDefault();cancel();}else if(event.key==='Enter'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();ok();}}
    paintPreview(currentPreview,original);
    paintPreview(nextPreview,original);
    renderFields();
    requestAnimationFrame(syncWheel);
    modal.querySelectorAll('.palette-mode-tabs button').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;renderFields();}));
    wheel.addEventListener('pointerdown',event=>{if(event.target.closest('.palette-inner-sv')) return;dragging='hue';wheel.setPointerCapture(event.pointerId);setHueFromEvent(event);});
    wheel.addEventListener('pointermove',event=>{if(dragging==='hue') setHueFromEvent(event);});
    wheel.addEventListener('pointerup',event=>{if(dragging==='hue'){dragging='';try{wheel.releasePointerCapture(event.pointerId);}catch(e){}}});
    wheel.addEventListener('pointercancel',()=>{dragging='';});
    sv.addEventListener('pointerdown',event=>{event.stopPropagation();dragging='sv';sv.setPointerCapture(event.pointerId);setSvFromEvent(event);});
    sv.addEventListener('pointermove',event=>{if(dragging==='sv') setSvFromEvent(event);});
    sv.addEventListener('pointerup',event=>{if(dragging==='sv'){dragging='';try{sv.releasePointerCapture(event.pointerId);}catch(e){}}});
    sv.addEventListener('pointercancel',()=>{dragging='';});
    modal.querySelector('.palette-color-ok').addEventListener('click',ok);
    modal.querySelector('.palette-color-cancel').addEventListener('click',cancel);
    modal.querySelector('.palette-color-close').addEventListener('click',cancel);
    modal.addEventListener('pointerdown',event=>{if(event.target===modal) cancel();});
    document.addEventListener('keydown',onKey);
    requestAnimationFrame(()=>dialog.focus());
  }  function hideEditConfirmBar(){const modal=document.getElementById('palette-color-modal');if(modal) modal.remove();const bar=document.getElementById('palette-edit-confirm');if(bar) bar.remove();}
  function moveItemToEdge(item,edge){
    const idx=swatchIndex(item&&item.id);
    if(idx<0) return;
    const [moved]=swatches.splice(idx,1);
    if(edge==='start') swatches.unshift(moved);
    else swatches.push(moved);
    selectedId=moved.id;
    rememberSelection();
    render();
    persist();
  }

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
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    swatches.splice(idx,1);
    selectedId=swatches.length?swatches[Math.min(idx,swatches.length-1)].id:null;
    rememberSelection();
    render();
    persist();
  }
  function deleteSelected(){const item=selectedItem();if(item) deleteSwatch(item);}
  function insertNear(swatch,where){
    if(!isSwatch(swatch)) return;
    const idx=swatchIndex(swatch.id);
    if(idx<0) return;
    const inserted=makeSwatch(currentForegroundHex());
    swatches.splice(where==='before'?idx:idx+1,0,inserted);
    selectedId=inserted.id;
    rememberSelection();
    render();
    persist();
  }
  async function copyHex(swatch){
    if(!isSwatch(swatch)) return;
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
    if(!isSwatch(swatch)) return;
    let text='';
    try{ text=await navigator.clipboard.readText(); }catch(e){ text=await requestPasteHex(); }
    text=String(text||'').trim();
    if(!isValidHex(text)) return;
    updateSwatchColor(swatch,text);
  }
  function insertItemAfterSelection(item){
    const idx=selectedId?swatchIndex(selectedId):-1;
    swatches.splice(idx>=0?idx+1:swatches.length,0,item);
    selectedId=item.id;
    rememberSelection();
    render();
    persist();
  }
  function addTransparentSwatch(){insertItemAfterSelection(makeSwatch('#00000000'));}
  function addSeparator(){insertItemAfterSelection(makeSeparator());}
  function applyCurrentColorToSelected(){
    const swatch=selectedSwatch();
    if(!swatch) return;
    updateSwatchColor(swatch,currentForegroundHex());
  }
  function addCurrent(){addTransparentSwatch();}
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
    const rect=el.getBoundingClientRect();
    dragState={id:swatch.id,startX:event.clientX,startY:event.clientY,grabOffsetX:event.clientX-rect.left,grabOffsetY:event.clientY-rect.top,swatchWidth:rect.width,swatchHeight:rect.height,pointerType:event.pointerType||'mouse',active:false,overId:swatch.id,side:'after',targetGroupIndex:null,targetLocalIndex:null,targetGlobalIndex:null,targetSeparatorSide:null,targetSeparatorId:null,rafPending:false,lastMove:null,pointerId:event.pointerId,sourceEl:el,captured:false};
    document.addEventListener('pointermove',onDragMove);
    document.addEventListener('pointerup',onDragEnd);
    document.addEventListener('pointercancel',onDragEnd);
  }
  function separatorDropSide(separatorEl,centerY){
    const rect=separatorEl.getBoundingClientRect();
    const center=rect.top+rect.height/2;
    const previous=dragState&&dragState.overId===separatorEl.dataset.id?dragState.side:null;
    const deadZone=dragState&&dragState.pointerType==='pen'?10:8;
    if(previous&&centerY>=center-deadZone&&centerY<=center+deadZone) return previous;
    return centerY<center?'before':'after';
  }
  function onDragMove(event){
    if(!dragState||event.pointerId!==dragState.pointerId) return;
    dragState.lastMove={clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId};
    event.preventDefault();
    if(dragState.rafPending) return;
    dragState.rafPending=true;
    requestAnimationFrame(processDragMove);
  }
  function processDragMove(){
    if(!dragState||!dragState.lastMove) return;
    dragState.rafPending=false;
    const event=dragState.lastMove;
    if(event.pointerId!==dragState.pointerId) return;
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
    const dragX=event.clientX-dragState.grabOffsetX;
    const dragY=event.clientY-dragState.grabOffsetY;
    const dragCenterX=dragX+(dragState.swatchWidth||swatchSize)/2;
    const dragCenterY=dragY+(dragState.swatchHeight||swatchSize)/2;
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    const gridRect=grid.getBoundingClientRect();
    const insideGrid=event.clientX>=gridRect.left&&event.clientX<=gridRect.right&&event.clientY>=gridRect.top&&event.clientY<=gridRect.bottom;
    const target=paletteDropTargetAt(grid,dragCenterX,dragCenterY,event.clientX,event.clientY);
    if(!target){
      if(!insideGrid) clearInsertIndicators();
      return;
    }
    setPaletteDragTarget(target);
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
    const cancelled=event.type==='pointercancel';
    clearInsertIndicators();
    document.querySelectorAll('.palette-swatch.dragging').forEach(node=>node.classList.remove('dragging'));
    if(state.active&&!cancelled){
      event.preventDefault();
      if(state.lineMode==='slot'&&Number.isInteger(state.targetGroupStart)&&Number.isInteger(state.targetGroupEnd)&&Number.isInteger(state.targetLocalSlot)) reorderSwatchToSlot(state.id,state.targetGroupStart,state.targetGroupEnd,state.targetLocalSlot);
      else if(state.overId&&state.overId!==state.id) reorderSwatch(state.id,state.overId,state.side);
      else activatePaletteSwatch(state.id,{select:true,setForeground:false});
      setTimeout(()=>{suppressClick=false;},0);
      return;
    }
    if(!cancelled) activatePaletteSwatch(state.id,{select:true,setForeground:true});
    if(state.active) setTimeout(()=>{suppressClick=false;},0);
  }
  function paletteDropItems(grid){
    return Array.from(grid.querySelectorAll('.palette-swatch:not(.dragging)')).filter(node=>!node.classList.contains('palette-drop-placeholder'));
  }
  function paletteDropTargetAt(grid,clientX,clientY,pointerX,pointerY){
    const items=paletteDropItems(grid).filter(node=>node.dataset.id!==dragState.id);
    const allSeps=items.filter(n=>n.classList.contains('separator'));
    const swatchNodes=items.filter(n=>!n.classList.contains('spacer')&&!n.classList.contains('separator'));

    // Resolve which group the pointer Y belongs to by checking separator positions.
    // Returns the separator node that is the boundary above the pointer, or null
    // if the pointer is in the first (top) group.
    function groupSeparatorAbove(py){
      let lastSep=null;
      for(const sep of allSeps){
        const r=sep.getBoundingClientRect();
        if(py>r.bottom) lastSep=sep;
        else break;
      }
      return lastSep;
    }

    // Within the group determined by sepAbove, find the best edge anchor.
    // If the group has swatches, snap to nearest swatch in that group.
    // If the group is empty, use the separator itself as the 'after' anchor.
    function edgeInGroup(sepAbove,px,py){
      // Collect swatches that belong to the group below sepAbove.
      // A swatch belongs here if it is below sepAbove (or at the top if no sep)
      // and above the next separator.
      const sepNodes=allSeps;
      const sepAboveIdx=sepAbove?sepNodes.indexOf(sepAbove):-1;
      const nextSep=sepNodes[sepAboveIdx+1]||null;
      const groupSwatches=swatchNodes.filter(n=>{
        const r=n.getBoundingClientRect();
        const cy=r.top+r.height/2;
        const aboveOk=sepAbove?cy>sepAbove.getBoundingClientRect().bottom:true;
        const belowOk=nextSep?cy<nextSep.getBoundingClientRect().top:true;
        return aboveOk&&belowOk;
      });
      if(groupSwatches.length){
        // Nearest swatch in this group by distance.
        let nearest=null,nearestDist=Infinity;
        for(const n of groupSwatches){
          const r=n.getBoundingClientRect();
          const cx=Math.max(r.left,Math.min(px,r.right));
          const cy=Math.max(r.top,Math.min(py,r.bottom));
          const d=Math.hypot(px-cx,py-cy);
          if(d<nearestDist){nearestDist=d;nearest=n;}
        }
        const r=nearest.getBoundingClientRect();
        const side=px<r.left+r.width/2?'before':'after';
        return {el:nearest,side,mode:'edge'};
      }
      // Group is empty — anchor to the separator above it.
      if(sepAbove) return {el:sepAbove,side:'after',mode:'edge'};
      return null;
    }

    // --- Separator being dragged: always vertical line, never box ---
    const draggingItem=swatches.find(s=>s.id===dragState.id);
    if(draggingItem&&isSeparator(draggingItem)){
      if(!swatchNodes.length) return null;
      let nearest=null,nearestDist=Infinity;
      for(const n of swatchNodes){
        const r=n.getBoundingClientRect();
        const cx=Math.max(r.left,Math.min(pointerX,r.right));
        const cy=Math.max(r.top,Math.min(pointerY,r.bottom));
        const d=Math.hypot(pointerX-cx,pointerY-cy);
        if(d<nearestDist){nearestDist=d;nearest=n;}
      }
      if(!nearest) return null;
      const r=nearest.getBoundingClientRect();
      const side=pointerX<r.left+r.width/2?'before':'after';
      return {el:nearest,side,mode:'edge'};
    }

    // --- Swatch being dragged ---
    const el=document.elementFromPoint(pointerX,pointerY);
    let item=el&&el.closest?el.closest('.palette-swatch'):null;
    if(item&&(!grid.contains(item)||item.dataset.id===dragState.id||item.classList.contains('spacer'))) item=null;

    if(item&&item.classList.contains('separator')){
      // Pointer on a separator — use the group on the correct side of it.
      const r=item.getBoundingClientRect();
      const sepAbove=pointerY<r.top+r.height/2
        ?groupSeparatorAbove(r.top-1)   // above this sep ? group above
        :item;                            // below this sep ? group below
      return edgeInGroup(sepAbove,pointerX,pointerY)||{el:item,side:'after',mode:'edge'};
    }

    if(item){
      // Pointer directly on a swatch.
      const rect=item.getBoundingClientRect();
      const previousSame=dragState.overId===item.dataset.id?dragState.side:null;
      const mid=rect.left+rect.width/2;
      const threshold=dragState.pointerType==='pen'?8:5;
      const side=previousSame&&Math.abs(pointerX-mid)<threshold?previousSame:pointerX<mid?'before':'after';
      return {el:item,side,mode:'edge'};
    }

    // Pointer in empty space — resolve to correct group by Y.
    return edgeInGroup(groupSeparatorAbove(pointerY),pointerX,pointerY);
  }
  function paletteGridMetrics(grid){
    const styles=getComputedStyle(grid);
    const gap=parseFloat(styles.gap)||parseFloat(styles.rowGap)||parseFloat(styles.columnGap)||6;
    return {gap};
  }
  function paletteGridColumnCount(grid,gap){
    const styles=getComputedStyle(grid);
    const padLeft=parseFloat(styles.paddingLeft)||0;
    const padRight=parseFloat(styles.paddingRight)||0;
    const width=grid.clientWidth-padLeft-padRight;
    return Math.max(1,Math.floor((width+gap)/(swatchSize+gap)));
  }
  function paletteGroupsFromItems(items){
    const groups=[];
    let current={startIndex:0,items:[],separatorBefore:null,separatorAfter:null};
    items.forEach(node=>{
      const idx=swatchIndex(node.dataset.id);
      if(node.classList.contains('separator')){
        current.separatorAfter=node;
        current.endIndex=idx;
        groups.push(current);
        current={startIndex:idx+1,items:[],separatorBefore:node,separatorAfter:null};
      }else{
        current.items.push(node);
      }
    });
    current.endIndex=swatches.length;
    groups.push(current);
    return groups;
  }
  function paletteSlotTargetAt(grid,clientX,clientY,groupY){
    const allItems=paletteDropItems(grid);
    if(!allItems.length) return null;
    const gap=paletteGridMetrics(grid).gap;
    const styles=getComputedStyle(grid);
    const padLeft=parseFloat(styles.paddingLeft)||0;
    const padTop=parseFloat(styles.paddingTop)||0;
    const gridRect=grid.getBoundingClientRect();
    const columnCount=paletteGridColumnCount(grid,gap);
    const groups=paletteGroupsFromItems(allItems);
    const groupProbeY=Number.isFinite(groupY)?groupY:clientY;
    let group=groups[0];
    for(let i=0;i<groups.length;i++){
      const sep=groups[i].separatorBefore;
      if(!sep) continue;
      const rect=sep.getBoundingClientRect();
      const center=rect.top+rect.height/2;
      const deadZone=dragState&&dragState.pointerType==='pen'?10:8;
      if(groupProbeY>=center-deadZone&&groupProbeY<=center+deadZone){
        const stable=Number.isInteger(dragState&&dragState.targetGroupStart)?groups.find(candidate=>candidate.startIndex===dragState.targetGroupStart):null;
        if(stable){group=stable;break;}
      }
      if(groupProbeY<center){group=groups[Math.max(0,i-1)];break;}
      group=groups[i];
    }
    const first=group.items[0];
    let groupTop=gridRect.top+padTop;
    if(first) groupTop=first.getBoundingClientRect().top;
    else if(group.separatorBefore) groupTop=group.separatorBefore.getBoundingClientRect().bottom+gap;
    const groupLeft=gridRect.left+padLeft;
    const localY=clientY-groupTop;
    if(localY<0) return null;
    const cellHeight=swatchSize+gap;
    const row=Math.max(0,Math.floor(localY/cellHeight));
    const rowStart=row*columnCount;
    const rowEnd=rowStart+columnCount;
    const rowEntries=group.items.map((node,index)=>({node,index})).filter(entry=>entry.index>=rowStart&&entry.index<rowEnd);
    const rowSwatches=rowEntries.filter(entry=>!entry.node.classList.contains('spacer'));
    let localSlot=rowStart;
    if(rowSwatches.length){
      localSlot=rowSwatches[rowSwatches.length-1].index+1;
      for(const entry of rowSwatches){
        const rect=entry.node.getBoundingClientRect();
        const mid=rect.left+rect.width/2;
        if(clientX<mid){localSlot=entry.index;break;}
      }
    }else{
      const localX=clientX-groupLeft;
      const cellWidth=swatchSize+gap;
      const column=Math.max(0,Math.min(columnCount-1,Math.floor(localX/cellWidth)));
      localSlot=rowStart+column;
    }
    const column=Math.max(0,Math.min(columnCount-1,localSlot-rowStart));
    const afterRowSwatch=rowSwatches.length&&localSlot===rowSwatches[rowSwatches.length-1].index+1;
    const anchor=afterRowSwatch?rowSwatches[rowSwatches.length-1].node:null;
    return {mode:'slot',group,startIndex:group.startIndex,endIndex:group.endIndex,row,column,localSlot,columnCount,gap,groupLeft,groupTop,afterRowSwatch,anchor};
  }
  function setPaletteDragTarget(target){
    if(!dragState||!target) return;
    if(target.mode==='slot'){
      const changed=dragState.lineMode!=='slot'||dragState.targetGroupStart!==target.startIndex||dragState.targetGroupEnd!==target.endIndex||dragState.targetLocalSlot!==target.localSlot||dragState.targetRow!==target.row||dragState.targetColumn!==target.column;
      if(!changed) return;
      dragState.lineMode='slot';
      dragState.overId=null;
      dragState.side='after';
      dragState.targetGroupStart=target.startIndex;
      dragState.targetGroupEnd=target.endIndex;
      dragState.targetLocalSlot=target.localSlot;
      dragState.targetRow=target.row;
      dragState.targetColumn=target.column;
      showPaletteSlotBox(target);
      return;
    }
    const item=target.el;
    const side=target.side;
    const nextMode=target.mode||'edge';
    if(!item||!side) return;
    if(dragState.overId===item.dataset.id&&dragState.side===side&&dragState.lineMode===nextMode) return;
    dragState.overId=item.dataset.id;
    dragState.side=side;
    dragState.lineMode=nextMode;
    dragState.targetGroupStart=null;
    dragState.targetGroupEnd=null;
    dragState.targetLocalSlot=null;
    showPaletteDropLine(item,side,nextMode);
  }
  function showPaletteSlotBox(target){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
    clearInsertIndicators();
    let line=grid.querySelector('.palette-drop-line');
    if(!line){
      line=document.createElement('div');
      line.className='palette-drop-line';
      grid.appendChild(line);
    }
    const gridRect=grid.getBoundingClientRect();
    line.classList.add('box');
    line.classList.remove('horizontal','vertical');
    line.style.left=(target.groupLeft+target.column*(swatchSize+target.gap)-gridRect.left+grid.scrollLeft)+'px';
    line.style.top=(target.groupTop+target.row*(swatchSize+target.gap)-gridRect.top+grid.scrollTop)+'px';
    line.style.width=swatchSize+'px';
    line.style.height=swatchSize+'px';
    showPaletteGroupBoundary(target);
  }
  function showPaletteGroupBoundary(target){
    const grid=document.getElementById('palette-grid');
    const separator=target&&target.group&&target.group.separatorBefore;
    if(!grid||!separator) return;
    let boundary=grid.querySelector('.palette-group-drop-line');
    if(!boundary){
      boundary=document.createElement('div');
      boundary.className='palette-group-drop-line';
      grid.appendChild(boundary);
    }
    const gridRect=grid.getBoundingClientRect();
    const rect=separator.getBoundingClientRect();
    const y=rect.top+rect.height/2-gridRect.top+grid.scrollTop;
    boundary.style.left='0px';
    boundary.style.top=(y-1)+'px';
    boundary.style.width=grid.clientWidth+'px';
    boundary.style.height='2px';
  }
  function showPaletteDropLine(item,side,mode){
    const grid=document.getElementById('palette-grid');
    if(!grid||!item) return;
    clearInsertIndicators();
    let line=grid.querySelector('.palette-drop-line');
    if(!line){
      line=document.createElement('div');
      line.className='palette-drop-line';
      grid.appendChild(line);
    }
    const gridRect=grid.getBoundingClientRect();
    const rect=item.getBoundingClientRect();
    const scrollTop=grid.scrollTop;
    const scrollLeft=grid.scrollLeft;
    if(mode==='bottom'){
      const gap=paletteGridMetrics(grid).gap;
      const styles=getComputedStyle(grid);
      const padLeft=parseFloat(styles.paddingLeft)||0;
      const gridLeft=gridRect.left+padLeft;
      const nextX=rect.right+gap+swatchSize<=gridRect.right?rect.right+gap:gridLeft;
      const nextY=nextX===gridLeft?rect.bottom+gap:rect.top;
      line.classList.add('box');
      line.classList.remove('horizontal','vertical');
      line.style.left=(nextX-gridRect.left+scrollLeft)+'px';
      line.style.top=(nextY-gridRect.top+scrollTop)+'px';
      line.style.width=swatchSize+'px';
      line.style.height=swatchSize+'px';
      return;
    }
    if(item.classList.contains('separator')){
      // Anchor is a separator (empty group below it) — show line at left edge below the separator.
      const gap=paletteGridMetrics(grid).gap;
      const styles=getComputedStyle(grid);
      const padLeft=parseFloat(styles.paddingLeft)||0;
      line.classList.add('vertical');
      line.classList.remove('horizontal','box');
      line.style.left=padLeft+'px';
      line.style.top=(rect.bottom-gridRect.top+scrollTop+gap/2)+'px';
      line.style.width='2px';
      line.style.height=swatchSize+'px';
      return;
    }
    const neighbor=side==='before'?previousPaletteItem(item):nextPaletteItem(item);
    let edge;
    if(neighbor&&!neighbor.classList.contains('separator')){
      const nr=neighbor.getBoundingClientRect();
      const sameRow=Math.abs((nr.top+nr.bottom)/2-(rect.top+rect.bottom)/2)<Math.max(rect.height,nr.height)/2;
      edge=sameRow
        ?(side==='before'?(rect.left+nr.right)/2:(rect.right+nr.left)/2)
        :(side==='before'?rect.left:rect.right);
    }else{
      edge=side==='before'?rect.left:rect.right;
    }
    line.classList.add('vertical');
    line.classList.remove('horizontal');
    line.style.left=(edge-gridRect.left+scrollLeft-1)+'px';
    line.style.top=(rect.top-gridRect.top+scrollTop-2)+'px';
    line.style.width='2px';
    line.style.height=(rect.height+4)+'px';
  }
  function previousPaletteItem(item){
    let node=item.previousElementSibling;
    while(node&&(node.classList.contains('dragging')||node.classList.contains('palette-drop-line')||node.classList.contains('palette-group-drop-line')||node.classList.contains('palette-drop-placeholder'))) node=node.previousElementSibling;
    return node;
  }
  function nextPaletteItem(item){
    let node=item.nextElementSibling;
    while(node&&(node.classList.contains('dragging')||node.classList.contains('palette-drop-line')||node.classList.contains('palette-group-drop-line')||node.classList.contains('palette-drop-placeholder'))) node=node.nextElementSibling;
    return node;
  }
  function clearInsertIndicators(){
    document.querySelectorAll('.palette-swatch.insert-before,.palette-swatch.insert-after').forEach(node=>node.classList.remove('insert-before','insert-after'));
    const grid=document.getElementById('palette-grid');
    if(grid){
      grid.classList.remove('empty-drop-target');
      const placeholder=grid.querySelector('.palette-drop-placeholder');
      if(placeholder) placeholder.remove();
      const line=grid.querySelector('.palette-drop-line');
      if(line) line.remove();
      const groupLine=grid.querySelector('.palette-group-drop-line');
      if(groupLine) groupLine.remove();
    }
  }
  function reorderSwatchToSlot(id,groupStart,groupEnd,localSlot){
    const from=swatchIndex(id);
    if(from<0) return;
    const [moved]=swatches.splice(from,1);
    let start=groupStart;
    let end=groupEnd;
    if(from<start) start--;
    if(from<end) end--;
    start=Math.max(0,Math.min(start,swatches.length));
    end=Math.max(start,Math.min(end,swatches.length));
    let insertIndex=start+localSlot;
    while(insertIndex>end){
      swatches.splice(end,0,makeSpacer());
      end++;
    }
    insertIndex=Math.max(start,Math.min(insertIndex,end));
    swatches.splice(insertIndex,0,moved);
    selectedId=id;
    rememberSelection();
    render();
    persist();
  }
  function reorderSwatchToIndex(id,targetIndex){
    const from=swatchIndex(id);
    if(from<0) return;
    let to=Math.max(0,Math.min(targetIndex,swatches.length));
    if(to>from) to--;
    if(to===from){
      selectedId=id;
      rememberSelection();
      render();
      persist();
      return;
    }
    const [moved]=swatches.splice(from,1);
    swatches.splice(to,0,moved);
    selectedId=id;
    rememberSelection();
    render();
    persist();
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
      requestAnimationFrame(()=>{ensureSelectedVisible();requestSideMenuPosition();requestPaletteDropdownPosition();checkGridOverflow();});
    });
    resizeObserver.observe(panel);
  }
  function bind(){
    const add=document.getElementById('palette-add-color');
    const remove=document.getElementById('palette-remove-color');
    const applyColor=document.getElementById('palette-apply-color');
    const addSeparatorBtn=document.getElementById('palette-add-separator');
    const newBtn=document.getElementById('palette-new');
    const renameBtn=document.getElementById('palette-rename');
    const duplicateBtn=document.getElementById('palette-duplicate');
    const importBtn=document.getElementById('palette-import');
    const exportActiveBtn=document.getElementById('palette-export-active');
    const exportActiveGplBtn=document.getElementById('palette-export-active-gpl');
    const exportAllBtn=document.getElementById('palette-export-all');
    const importFile=document.getElementById('palette-import-file');
    const deleteBtn=document.getElementById('palette-delete');
    const toolbarToggle=document.getElementById('palette-toolbar-toggle');
    const advancedToggle=document.getElementById('palette-advanced-toggle');
    const renameInput=document.getElementById('palette-rename-inline-input');
    const renameOk=document.getElementById('palette-rename-inline-ok');
    const renameCancel=document.getElementById('palette-rename-inline-cancel');
    const deleteOk=document.getElementById('palette-delete-confirm-ok');
    const deleteCancel=document.getElementById('palette-delete-confirm-cancel');
    const settings=settingsButton();
    const display=activeDisplay();
    if(display) display.addEventListener('click',event=>{event.stopPropagation();togglePaletteDropdown();});
    if(settings) settings.addEventListener('click',event=>{event.stopPropagation();toggleSideMenu();});
    if(newBtn) newBtn.addEventListener('click',()=>{hidePaletteInlinePanels();newPalette();closeSideMenu();});
    if(renameBtn) renameBtn.addEventListener('click',renamePalette);
    if(duplicateBtn) duplicateBtn.addEventListener('click',()=>{hidePaletteInlinePanels();duplicatePalette();closeSideMenu();});
    if(importBtn) importBtn.addEventListener('click',chooseImportFile);
    if(exportActiveBtn) exportActiveBtn.addEventListener('click',exportActivePaletteJson);
    if(exportActiveGplBtn) exportActiveGplBtn.addEventListener('click',exportActivePaletteGpl);
    if(exportAllBtn) exportAllBtn.addEventListener('click',exportAllPalettesJson);
    if(importFile) importFile.addEventListener('change',()=>handleImportFile(importFile.files&&importFile.files[0]));
    if(deleteBtn) deleteBtn.addEventListener('click',deletePalette);
    if(toolbarToggle) toolbarToggle.addEventListener('click',toggleToolbarPalette);
    if(advancedToggle) advancedToggle.addEventListener('click',toggleAdvancedPalette);
    if(renameOk) renameOk.addEventListener('click',applyInlineRename);
    if(renameCancel) renameCancel.addEventListener('click',()=>{hidePaletteInlinePanels();positionSideMenu();});
    if(renameInput) renameInput.addEventListener('keydown',event=>{if(event.key==='Enter') applyInlineRename(); if(event.key==='Escape'){hidePaletteInlinePanels();positionSideMenu();}});
    if(deleteOk) deleteOk.addEventListener('click',confirmDeletePalette);
    if(deleteCancel) deleteCancel.addEventListener('click',()=>{hidePaletteInlinePanels();positionSideMenu();});
    const panel=document.getElementById('palette-panel');
    const closeBtn=panel?panel.querySelector('.fp-close'):null;
    if(closeBtn) closeBtn.addEventListener('click',()=>setTimeout(closeSideMenu,0));
    if(add) add.addEventListener('click',addTransparentSwatch);
    if(applyColor) applyColor.addEventListener('click',applyCurrentColorToSelected);
    if(addSeparatorBtn) addSeparatorBtn.addEventListener('click',addSeparator);
    if(remove) remove.addEventListener('click',deleteSelected);
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
    bindPalettePopupListeners();
  }
  function isAdvancedPalettePaintingEnabled(){return activeLayerUsesAdvancedPalette();}
  function getActiveAdvancedPaletteStyleId(){const style=activeAdvancedStyle();return activeLayerUsesAdvancedPalette()&&style?style.id:null;}
  window.isAdvancedPalettePaintingEnabled=isAdvancedPalettePaintingEnabled;
  window.getActiveAdvancedPaletteStyleId=getActiveAdvancedPaletteStyleId;
  window.PaletteDocker={serialize,load,reset(){load(null);},renderCurrentColors:render,refresh:render,isAdvancedPalettePaintingEnabled,getActiveAdvancedPaletteStyleId,findAdvancedStyleById};
  document.addEventListener('DOMContentLoaded',()=>{bind();loadPersisted();});
})();