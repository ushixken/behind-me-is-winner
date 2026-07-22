(function(){
  const STORE_KEY='animatorPaletteV1';
  const VIEW_KEY='animatorPaletteViewV1';
  const NORMAL_SWATCH_SIZE_KEY='palette.normalSwatchSize';
  const ADVANCED_SWATCH_SIZE_KEY='palette.advancedSwatchSize';
  const ADVANCED_COLOR_HISTORY_KEY='animatorAdvancedPaletteColorHistoryV1';
  const ADVANCED_COLOR_HISTORY_LIMIT=24;
  const SWATCH_SIZE_MIN=16;
  const SWATCH_SIZE_MAX=64;
  const SWATCH_SIZE_STEP=2;
  const SWATCH_SIZE_DEFAULT=28;
  const ADVANCED_PALETTE_VERSION=2;
  const PALETTE_REORDER_HOLD_MS=260;
  let palettes=[];
  let activePaletteId=null;
  let swatches=[];
  let selectedId=null;
  let dragState=null;
  let suppressClick=false;
  let advancedStyleDrag=null;
  let advancedStyleSuppressClick=false;
  let swatchSize=SWATCH_SIZE_DEFAULT;
  let advancedPaletteSwatchSize=SWATCH_SIZE_DEFAULT;
  let savedScrollTop=0;
  let restoreScrollPending=false;
  let scrollSaveTimer=null;
  let resizeObserver=null;
  let sideMenuOpen=false;
  let sideMenuFrame=null;
  let dropdownOpen=false;
  let dropdownFrame=null;
  let toolbarPaletteAttachment=null;
  let toolbarPaletteVisible=false;
  let advancedPaletteEnabled=false;
  let advancedPaletteVersion=0;
  let advancedStyles=[];
  let activeAdvancedStyleId=null;
  let advancedColorPanelStyleId=null;
  let advancedColorPanelPaletteId=null;
  const advancedColorHistorySubscribers=new Set();
  let popupListenersBound=false;
  let paletteDragState=null;
  let toolbarSubmenuOpen=false;
  let isSyncingColorPanel=false;
  let advancedColorFrame=null;
  let advancedColorTimer=null;
  let advancedColorSettleTimer=null;
  let advancedColorLastDispatch=0;
  let advancedSelectionPersistTimer=null;
  const pendingAdvancedColorStyleIds=new Set();
  const activeAdvancedColorStyleIds=new Set();
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
    return {version:2,palettes:[palette],activePaletteId:palette.id,advancedPalette:{version:ADVANCED_PALETTE_VERSION,enabled:false,styles:[],activeStyleId:null},view:{normalPaletteSwatchSize:swatchSize,advancedPaletteSwatchSize,scrollTop:0,toolbarPaletteAttachment:null,toolbarPaletteVisible:false,advancedPaletteEnabled:false}};
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
  function defaultAdvancedPaletteName(name){
    const normalName=String(name||'').trim();
    const generated=/^Palette\s+(\d+)$/i.exec(normalName);
    return generated?'Advanced Palette '+generated[1]:(normalName||'Advanced Palette 1');
  }
  function paletteNameForMode(palette,mode){
    if(!palette) return mode==='advanced'?'Advanced Palette':'Palette';
    return mode==='advanced'?palette.advancedName:palette.name;
  }
  function activePaletteMode(){return activeLayerUsesAdvancedPalette()?'advanced':'normal';}
  function uniquePaletteName(name,excludeId,mode){
    const advanced=mode==='advanced';
    const fallback=advanced?'Advanced Palette':'Palette';
    const root=String(name||fallback).trim()||fallback;
    const names=new Set(palettes.filter(p=>p.id!==excludeId).map(p=>String(paletteNameForMode(p,advanced?'advanced':'normal')||'').toLowerCase()));
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
  function makePalette(name,swatchList,id,selection,allowEmpty,advancedName){
    const cleanSwatches=sanitizeSwatches(swatchList,!!allowEmpty);
    const selected=selection&&cleanSwatches.some(s=>s.id===selection)?selection:(cleanSwatches[0]?cleanSwatches[0].id:null);
    const normalName=String(name||'').trim()||nextPaletteName();
    const storedAdvancedName=String(advancedName||'').trim()||defaultAdvancedPaletteName(normalName);
    return {id:id||makeId('palette'),name:normalName,advancedName:storedAdvancedName,swatches:cleanSwatches,selectedId:selected};
  }
  function activePalette(){return palettes.find(p=>p.id===activePaletteId)||palettes[0]||null;}
  function loadAdvancedColorHistories(){
    try{const saved=JSON.parse(localStorage.getItem(ADVANCED_COLOR_HISTORY_KEY)||'{}');return saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch(e){return {};}
  }
  function advancedColorHistory(paletteId){
    const histories=loadAdvancedColorHistories();
    return Array.isArray(histories[paletteId])?histories[paletteId].filter(isValidHex).map(normalizeHex).slice(0,ADVANCED_COLOR_HISTORY_LIMIT):[];
  }
  function pushAdvancedColorHistory(paletteId,hex){
    const clean=normalizeHex(hex);if(!paletteId||!isValidHex(clean))return false;
    const histories=loadAdvancedColorHistories();
    const history=Array.isArray(histories[paletteId])?histories[paletteId].filter(isValidHex).map(normalizeHex):[];
    if(history[0]===clean)return false;
    const duplicate=history.indexOf(clean);if(duplicate>=0)history.splice(duplicate,1);
    history.unshift(clean);histories[paletteId]=history.slice(0,ADVANCED_COLOR_HISTORY_LIMIT);
    try{localStorage.setItem(ADVANCED_COLOR_HISTORY_KEY,JSON.stringify(histories));}catch(e){}
    advancedColorHistorySubscribers.forEach(callback=>{try{callback(histories[paletteId].slice());}catch(e){}});
    return true;
  }
  const AdvancedColorHistory={
    record(rgba){
      const hex=Array.isArray(rgba)?rgbaToHex(rgba[0],rgba[1],rgba[2],rgba[3]):normalizeHex(rgba);
      return pushAdvancedColorHistory(advancedColorPanelPaletteId||activePaletteId,hex);
    },
    getAll(){return advancedColorHistory(advancedColorPanelPaletteId||activePaletteId).slice();},
    subscribe(callback){if(typeof callback!=='function')return()=>{};advancedColorHistorySubscribers.add(callback);return()=>advancedColorHistorySubscribers.delete(callback);}
  };
  window.AdvancedColorHistory=AdvancedColorHistory;
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
    try{
      localStorage.setItem(NORMAL_SWATCH_SIZE_KEY,String(swatchSize));
      localStorage.setItem(ADVANCED_SWATCH_SIZE_KEY,String(advancedPaletteSwatchSize));
      localStorage.setItem(VIEW_KEY,JSON.stringify({normalPaletteSwatchSize:swatchSize,advancedPaletteSwatchSize,scrollTop:savedScrollTop,toolbarPaletteAttachment:toolbarPaletteAttachment?Object.assign({},toolbarPaletteAttachment):null,toolbarPaletteVisible,advancedPaletteEnabled}));
    }catch(e){}
  }
  function loadView(){
    try{
      const view=JSON.parse(localStorage.getItem(VIEW_KEY)||'null');
      const storedNormal=localStorage.getItem(NORMAL_SWATCH_SIZE_KEY);
      const storedAdvanced=localStorage.getItem(ADVANCED_SWATCH_SIZE_KEY);
      const hasStoredNormal=Number.isFinite(+storedNormal);
      const hasViewNormal=view&&Number.isFinite(+view.normalPaletteSwatchSize);
      if(hasStoredNormal) swatchSize=clampSwatchSize(+storedNormal);
      else if(hasViewNormal) swatchSize=clampSwatchSize(+view.normalPaletteSwatchSize);
      else if(view&&Number.isFinite(+view.swatchSize)) swatchSize=clampSwatchSize(+view.swatchSize);
      if(Number.isFinite(+storedAdvanced)) advancedPaletteSwatchSize=clampSwatchSize(+storedAdvanced);
      else if(view&&Number.isFinite(+view.advancedPaletteSwatchSize)) advancedPaletteSwatchSize=clampSwatchSize(+view.advancedPaletteSwatchSize);
      if(view&&Number.isFinite(+view.scrollTop)) savedScrollTop=Math.max(0,+view.scrollTop);
      toolbarPaletteAttachment=view&&view.toolbarPaletteAttachment?Object.assign({},view.toolbarPaletteAttachment):null;
      toolbarPaletteVisible=!!(toolbarPaletteAttachment&&(view&&Object.prototype.hasOwnProperty.call(view,'toolbarPaletteVisible')?view.toolbarPaletteVisible:true));
      advancedPaletteEnabled=!!(view&&view.advancedPaletteEnabled);
      try{
        localStorage.setItem(NORMAL_SWATCH_SIZE_KEY,String(swatchSize));
        localStorage.setItem(ADVANCED_SWATCH_SIZE_KEY,String(advancedPaletteSwatchSize));
      }catch(e){}
    }catch(e){}
  }
  function serialize(){
    rememberSelection();
    return {version:2,palettes:palettes.map(p=>({id:p.id,name:p.name,advancedName:p.advancedName,swatches:p.swatches.map(exportSwatchData),selectedId:p.selectedId||null})),activePaletteId,advancedPalette:{version:ADVANCED_PALETTE_VERSION,enabled:advancedPaletteEnabled,styles:advancedStyles,activeStyleId:activeAdvancedStyleId},view:{normalPaletteSwatchSize:swatchSize,advancedPaletteSwatchSize,scrollTop:savedScrollTop,toolbarPaletteAttachment:toolbarPaletteAttachment?Object.assign({},toolbarPaletteAttachment):null,toolbarPaletteVisible,advancedPaletteEnabled}};
  }
  function load(data,options){
    const payload=data&&typeof data==='object'?data:null;
    if(payload&&Array.isArray(payload.palettes)){
      palettes=payload.palettes.map((p,i)=>makePalette(p&&p.name||('Palette '+(i+1)),p&&p.swatches,p&&p.id,p&&p.selectedId,true,p&&p.advancedName)).filter(Boolean);
      if(!palettes.length) palettes=[makePalette('Palette 1',defaultSwatches())];
      activePaletteId=palettes.some(p=>p.id===payload.activePaletteId)?payload.activePaletteId:palettes[0].id;
    }else{
      palettes=[makePalette('Palette 1',payload&&Array.isArray(payload.swatches)?payload.swatches:null,null,payload&&payload.selectedId,false)];
      activePaletteId=palettes[0].id;
    }
    syncActiveRefs();
    if(payload&&payload.view){
      if(Number.isFinite(+payload.view.normalPaletteSwatchSize)) swatchSize=clampSwatchSize(+payload.view.normalPaletteSwatchSize);
      else if(Number.isFinite(+payload.view.swatchSize)) swatchSize=clampSwatchSize(+payload.view.swatchSize);
      if(Number.isFinite(+payload.view.advancedPaletteSwatchSize)) advancedPaletteSwatchSize=clampSwatchSize(+payload.view.advancedPaletteSwatchSize);
    }
    if(payload&&payload.view&&Number.isFinite(+payload.view.scrollTop)) savedScrollTop=Math.max(0,+payload.view.scrollTop);
    if(payload&&payload.view&&Object.prototype.hasOwnProperty.call(payload.view,'toolbarPaletteAttachment')) toolbarPaletteAttachment=payload.view.toolbarPaletteAttachment?Object.assign({},payload.view.toolbarPaletteAttachment):null;
    if(payload&&payload.view&&Object.prototype.hasOwnProperty.call(payload.view,'toolbarPaletteVisible')) toolbarPaletteVisible=!!(payload.view.toolbarPaletteVisible&&toolbarPaletteAttachment);
    else if(payload&&payload.view&&Object.prototype.hasOwnProperty.call(payload.view,'toolbarPaletteAttachment')) toolbarPaletteVisible=!!toolbarPaletteAttachment;
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
    synchronizeActiveContext(false);
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
  function setForeground(hex,openPicker,skipPaletteRender){
    const safeHex=normalizeHex(hex);
    if(isTransparentHex(safeHex)) return;
    if(typeof window.setForegroundColorFromPalette==='function'){
      const wasSyncing=isSyncingColorPanel;
      isSyncingColorPanel=true;
      try{window.setForegroundColorFromPalette(safeHex,!!openPicker,!!skipPaletteRender);}finally{isSyncingColorPanel=wasSyncing;}
    }
    else {
      color=displayHex(safeHex);
      const input=document.getElementById('color-input');
      if(input) input.value=displayHex(safeHex);
      const stat=document.getElementById('stat-color');
      if(stat) stat.textContent='Color: '+displayHex(safeHex);
    }
  }
  function setForegroundFromSample(hex){setForeground(hex,false,true);}
  function clampSwatchSize(value){
    const numeric=Number.isFinite(+value)?+value:SWATCH_SIZE_DEFAULT;
    const stepped=Math.round(numeric/SWATCH_SIZE_STEP)*SWATCH_SIZE_STEP;
    return Math.max(SWATCH_SIZE_MIN,Math.min(SWATCH_SIZE_MAX,stepped));
  }
  function activePaletteSwatchSize(){return activePaletteMode()==='advanced'?advancedPaletteSwatchSize:swatchSize;}
  function applyViewSettings(keepSelectedVisible){
    swatchSize=clampSwatchSize(swatchSize);
    advancedPaletteSwatchSize=clampSwatchSize(advancedPaletteSwatchSize);
    const activeSize=activePaletteSwatchSize();
    const body=document.getElementById('palette-body');
    if(body){
      body.style.setProperty('--normal-palette-swatch-size',swatchSize+'px');
      body.style.setProperty('--advanced-palette-swatch-size',advancedPaletteSwatchSize+'px');
    }
    const slider=document.getElementById('palette-size-slider');
    const value=document.getElementById('palette-size-value');
    if(slider) slider.value=String(activeSize);
    if(value) value.textContent=activeSize+' px';
    if(keepSelectedVisible) requestAnimationFrame(()=>ensureSelectedVisible());
  }
  function setSwatchSize(nextSize,keepSelectedVisible){
    const clamped=clampSwatchSize(nextSize);
    const advanced=activePaletteMode()==='advanced';
    if(advanced){
      if(clamped===advancedPaletteSwatchSize) return;
      advancedPaletteSwatchSize=clamped;
    }else{
      if(clamped===swatchSize) return;
      swatchSize=clamped;
    }
    applyViewSettings(keepSelectedVisible!==false);
    render();
    persistView();
    persist();
  }
  function stepSwatchSize(delta){setSwatchSize(activePaletteSwatchSize()+(delta*SWATCH_SIZE_STEP),true);}
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
  function toolbarPaletteEnabled(){return !!(toolbarPaletteVisible&&toolbarPaletteAttachment&&palettes.some(p=>p.id===toolbarPaletteAttachment.paletteId)&&(toolbarPaletteAttachment.mode==='normal'||toolbarPaletteAttachment.mode==='advanced'));}
  function currentPaletteDockerMode(){const body=document.getElementById('palette-body');return body&&body.classList.contains('advanced-mode')?'advanced':'normal';}
  function currentToolbarPaletteAttachment(){return {paletteId:activePaletteId,mode:currentPaletteDockerMode()};}
  function currentPaletteIsAttached(){const current=currentToolbarPaletteAttachment();return toolbarPaletteEnabled()&&toolbarPaletteAttachment.paletteId===current.paletteId&&toolbarPaletteAttachment.mode===current.mode;}
  function syncToolbarSelection(){}
  function renderToolbarPalette(){
    const wrap=document.getElementById('toolbar-palette-wrap');
    const strip=document.getElementById('toolbar-palette-strip');
    if(!wrap||!strip) return;
    wrap.classList.toggle('hidden',!toolbarPaletteEnabled());
    strip.innerHTML='';
    if(!toolbarPaletteEnabled()) return;
    if(toolbarPaletteAttachment.mode==='advanced'){
      syncAdvancedRefs();
      advancedStyles.forEach(style=>{
        if(isAdvancedSeparator(style)){
          const gap=document.createElement('span');
          gap.className='toolbar-palette-separator';
          gap.setAttribute('aria-hidden','true');
          strip.appendChild(gap);
          return;
        }
        if(style.visible===false) return;
        const hex=styleHex(style);
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='toolbar-palette-swatch';
        btn.dataset.styleId=style.id;
        btn.title=style.name||style.id;
        btn.setAttribute('aria-label','Set style '+(style.name||style.id));
        if(isTransparentHex(hex)) btn.classList.add('transparent');
        else {
          btn.style.background=displayHex(hex);
          const c=hexToRgba(hex);
          if(c.r<=24&&c.g<=24&&c.b<=24) btn.classList.add('dark-color');
        }
        btn.addEventListener('pointerdown',event=>{
          if(window.LinkedPixelSelection&&window.LinkedPixelSelection.handleStylePointer(event,style.id))btn._linkedSelectionClick=true;
        });
        btn.addEventListener('click',event=>{
          event.preventDefault();
          if(btn._linkedSelectionClick){btn._linkedSelectionClick=false;return;}
          selectStyle(style.id,true,toolbarPaletteAttachment.paletteId);
        });
        strip.appendChild(btn);
      });
      return;
    }
    const attached=palettes.find(p=>p.id===toolbarPaletteAttachment.paletteId)||null;
    const items=attached&&Array.isArray(attached.swatches)?attached.swatches:[];
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
        attached.selectedId=item.id;
        advancedColorPanelStyleId=null;
        advancedColorPanelPaletteId=null;
        if(attached.id===activePaletteId){selectedId=item.id;syncSelectionClasses();}
        setForeground(item.hex,false);
        persist();
      });
      strip.appendChild(btn);
    });
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
    if(opts.setForeground&&isSwatch(swatch)) setForeground(swatch.hex,false,!!opts.skipPaletteRender);
    persist();
  }
  function selectSwatch(swatch,applyColor){
    advancedColorPanelStyleId=null;
    advancedColorPanelPaletteId=null;
    if(!swatch) return;
    activatePaletteSwatch(swatch.id,{select:true,setForeground:!!applyColor});
    render();
  }
  function sideMenu(){return document.getElementById('palette-side-menu');}
  function toolbarPaletteSubmenu(){return document.getElementById('palette-toolbar-submenu');}
  function toolbarPaletteTrigger(){return document.getElementById('palette-toolbar-toggle');}
  function setToolbarPaletteAttachment(paletteId,mode){
    if(!palettes.some(p=>p.id===paletteId)||(mode!=='normal'&&mode!=='advanced')) return;
    toolbarPaletteAttachment={paletteId:paletteId,mode:mode};
    toolbarPaletteVisible=true;
    renderToolbarPalette();
    renderPaletteSelector();
    persistView();
    persist();
    closeSideMenu();
  }
  function hideToolbarPalette(){
    toolbarPaletteVisible=false;
    renderToolbarPalette();
    renderPaletteSelector();
    persistView();
    persist();
    closeSideMenu();
  }
  function renderToolbarPaletteSubmenu(){
    const submenu=toolbarPaletteSubmenu();
    if(!submenu) return;
    submenu.innerHTML='';
    const addButton=(label,onClick,on)=>{
      const button=document.createElement('button');
      button.type='button';
      button.textContent=(on?'[On] ':'')+label;
      button.classList.toggle('active',!!on);
      button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onClick();});
      submenu.appendChild(button);
    };
    const addSeparator=()=>{
      const separator=document.createElement('div');
      separator.className='palette-menu-sep';
      separator.setAttribute('role','separator');
      submenu.appendChild(separator);
    };
    const addHeading=label=>{
      const heading=document.createElement('div');
      heading.className='palette-toolbar-heading';
      heading.textContent=label;
      submenu.appendChild(heading);
    };
    addButton('Off / Hide Toolbar Palette',hideToolbarPalette,!toolbarPaletteEnabled());
    addSeparator();
    addHeading('Normal Palettes');
    palettes.forEach(palette=>{
      const on=toolbarPaletteEnabled()&&toolbarPaletteAttachment.paletteId===palette.id&&toolbarPaletteAttachment.mode==='normal';
      addButton(palette.name,()=>setToolbarPaletteAttachment(palette.id,'normal'),on);
    });
    addSeparator();
    addHeading('Advanced Palettes');
    palettes.forEach(palette=>{
      const on=toolbarPaletteEnabled()&&toolbarPaletteAttachment.paletteId===palette.id&&toolbarPaletteAttachment.mode==='advanced';
      addButton(palette.advancedName,()=>setToolbarPaletteAttachment(palette.id,'advanced'),on);
    });
  }
  function positionToolbarPaletteSubmenu(){
    if(!toolbarSubmenuOpen) return;
    const submenu=toolbarPaletteSubmenu();
    const button=toolbarPaletteTrigger();
    const menu=sideMenu();
    if(!submenu||!button||!menu) return;
    const menuRect=menu.getBoundingClientRect();
    const buttonRect=button.getBoundingClientRect();
    const desired=buttonRect.top-menuRect.top;
    const maxTop=Math.max(0,window.innerHeight-menuRect.top-submenu.offsetHeight-6);
    submenu.style.top=Math.max(0,Math.min(desired,maxTop))+'px';
  }
  function openToolbarPaletteSubmenu(){
    const submenu=toolbarPaletteSubmenu();
    const button=toolbarPaletteTrigger();
    if(!submenu) return;
    toolbarSubmenuOpen=true;
    renderToolbarPaletteSubmenu();
    submenu.classList.remove('hidden');
    if(button){button.classList.add('active');button.setAttribute('aria-expanded','true');}
    positionToolbarPaletteSubmenu();
  }
  function closeToolbarPaletteSubmenu(){
    const submenu=toolbarPaletteSubmenu();
    const button=toolbarPaletteTrigger();
    toolbarSubmenuOpen=false;
    if(submenu) submenu.classList.add('hidden');
    if(button){button.classList.remove('active');button.setAttribute('aria-expanded','false');}
  }
  function toggleToolbarPaletteSubmenu(){toolbarSubmenuOpen?closeToolbarPaletteSubmenu():openToolbarPaletteSubmenu();}
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
    positionToolbarPaletteSubmenu();
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
    syncStyleLayeringControl();
    positionSideMenu();
  }
  function syncStyleLayeringControl(){
    const input=document.getElementById('palette-style-layering');
    if(!input) return;
    const state=window.SmartRasterStyleLayering?window.SmartRasterStyleLayering.getActiveState():{enabled:false,available:false,reason:'Style Layering is unavailable.'};
    input.checked=!!state.enabled;
    input.disabled=!state.enabled&&!state.available;
    const control=input.closest('.palette-style-layering-control');
    if(control) control.title=state.enabled?'Render this Smart Raster layer in Advanced Palette order.':(state.available?'Render this Smart Raster layer in Advanced Palette order.':('Unavailable: '+String(state.reason||'the active layer is not compatible.')));
  }  function closeSideMenu(){
    const menu=sideMenu();
    const button=settingsButton();
    sideMenuOpen=false;
    if(sideMenuFrame){cancelAnimationFrame(sideMenuFrame);sideMenuFrame=null;}
    if(menu) menu.classList.add('hidden');
    closeToolbarPaletteSubmenu();
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
    const mode=activePaletteMode();
    palettes.forEach(p=>{
      const paletteName=paletteNameForMode(p,mode);
      const item=document.createElement('div');
      item.className='palette-list-item';
      item.dataset.id=p.id;
      item.title=paletteName;
      item.classList.toggle('active',p.id===activePaletteId);
      const grip=document.createElement('span');
      grip.className='palette-list-grip';
      grip.textContent='::';
      const name=document.createElement('span');
      name.className='palette-list-name';
      name.textContent=paletteName;
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
    const mode=activePaletteMode();
    const activeName=paletteNameForMode(active,mode);
    if(display){
      display.title=active?activeName:'';
      display.setAttribute('aria-label',active?('Active palette: '+activeName):'Active palette');
    }
    if(nameEl) nameEl.textContent=activeName;
    const del=document.getElementById('palette-delete');
    if(del) del.disabled=palettes.length<=1;
    const toolbarToggle=document.getElementById('palette-toolbar-toggle');
    if(toolbarToggle){
      toolbarToggle.classList.toggle('active',toolbarSubmenuOpen);
      toolbarToggle.textContent='Attach to Toolbar >';
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
  function syncAdvancedStyleToColorPanel(style){
    if(!style) return;
    isSyncingColorPanel=true;
    try{setForeground(styleHex(style),false,true);}finally{isSyncingColorPanel=false;}
  }
  function scheduleAdvancedSelectionPersist(){
    if(advancedSelectionPersistTimer!==null) clearTimeout(advancedSelectionPersistTimer);
    advancedSelectionPersistTimer=setTimeout(()=>{
      advancedSelectionPersistTimer=null;
      persist();
    },120);
  }
  function selectStyle(id,setBrush,paletteId){
    const style=advancedStyles.find(s=>!isAdvancedSeparator(s)&&s.id===id);
    if(!style) return;
    const selectionChanged=activeAdvancedStyleId!==style.id;
    const grid=document.getElementById('palette-grid');
    const previous=grid&&grid.querySelector('.palette-style-card.selected');
    const next=grid&&grid.querySelector('.palette-style-card[data-id="'+CSS.escape(style.id)+'"]');
    activeAdvancedStyleId=style.id;
    advancedColorPanelStyleId=style.id;
    advancedColorPanelPaletteId=paletteId||activePaletteId;
    if(previous&&previous!==next) previous.classList.remove('selected');
    if(next) next.classList.add('selected');
    if(setBrush!==false) syncAdvancedStyleToColorPanel(style);
    if(selectionChanged) scheduleAdvancedSelectionPersist();
  }
  let activeContextSyncing=false;
  function synchronizeActiveContext(renderAfter){
    if(activeContextSyncing||!palettes.length) return;
    activeContextSyncing=true;
    try{
      syncActiveRefs();
      syncAdvancedRefs();
      if(activeLayerUsesAdvancedPalette()){
        const style=activeAdvancedStyle();
        if(style) selectStyle(style.id,true,activePaletteId);
      }else{
        const swatch=selectedSwatch();
        if(swatch) activatePaletteSwatch(swatch.id,{select:true,setForeground:true,skipPaletteRender:true});
      }
      if(renderAfter!==false) render();
    }finally{
      activeContextSyncing=false;
    }
  }
  function selectMatchingRgba(red,green,blue,alpha){
    if(![red,green,blue,alpha].every(Number.isInteger))return false;
    const equal=rgba=>rgba[0]===red&&rgba[1]===green&&rgba[2]===blue&&rgba[3]===alpha;
    syncActiveRefs();
    if(currentPaletteDockerMode()==='advanced'){
      syncAdvancedRefs();
      const match=advancedStyles.find(style=>!isAdvancedSeparator(style)&&equal(style.rgba));
      if(!match)return false;
      selectStyle(match.id,true,activePaletteId);render();return true;
    }
    const palette=activePalette();
    const match=palette&&palette.swatches.find(item=>isSwatch(item)&&equal(rgbaArray(item.hex)));
    if(!match)return false;
    activatePaletteSwatch(match.id,{select:true,setForeground:true});
    render();
    return true;
  }
  function selectAdvancedStyleById(styleId){
    if(!styleId)return false;
    syncActiveRefs();
    syncAdvancedRefs();
    const style=advancedStyles.find(item=>!isAdvancedSeparator(item)&&item.id===styleId);
    if(!style)return false;
    selectStyle(style.id,true,activePaletteId);
    render();
    return true;
  }

  function createAdvancedStyle(){
    syncAdvancedRefs();
    const style=makeAdvancedStyle(rgbaArray(currentForegroundHex()),null,nextAdvancedStyleName());
    advancedStyles.push(style);
    activeAdvancedStyleId=style.id;
    advancedColorPanelStyleId=style.id;
    advancedColorPanelPaletteId=activePaletteId;
    setForeground(styleHex(style),false);
    render();
    persist();
  }
  function findAdvancedStyleById(id){return advancedStyles.find(s=>!isAdvancedSeparator(s)&&s.id===id)||null;}
  function refreshAdvancedStyleChange(style,colorChanged){
    if(style&&style.id===activeAdvancedStyleId) syncAdvancedStyleToColorPanel(style);
    render();
    renderToolbarPalette();
    persist();
    if(colorChanged){
      window.dispatchEvent(new CustomEvent('advanced-palette-style-color-changed',{detail:{styleId:style.id}}));
    }
  }
  function dispatchPendingAdvancedStyleColors(){
    advancedColorFrame=null;advancedColorLastDispatch=performance.now();
    const styleIds=Array.from(pendingAdvancedColorStyleIds);pendingAdvancedColorStyleIds.clear();
    styleIds.forEach(id=>window.dispatchEvent(new CustomEvent('advanced-palette-style-color-changed',{detail:{styleId:id,interactive:true}})));
    clearTimeout(advancedColorSettleTimer);advancedColorSettleTimer=setTimeout(()=>{advancedColorSettleTimer=null;render();persist();},120);
  }
  function queueAdvancedStyleColorChange(styleId){
    pendingAdvancedColorStyleIds.add(styleId);activeAdvancedColorStyleIds.add(styleId);
    if(advancedColorFrame!==null||advancedColorTimer!==null)return;
    const delay=Math.max(0,33-(performance.now()-advancedColorLastDispatch));
    if(delay>1)advancedColorTimer=setTimeout(()=>{advancedColorTimer=null;advancedColorFrame=requestAnimationFrame(dispatchPendingAdvancedStyleColors);},delay);
    else advancedColorFrame=requestAnimationFrame(dispatchPendingAdvancedStyleColors);
  }
  function flushAdvancedStyleColorChange(){
    if(advancedColorFrame!==null){cancelAnimationFrame(advancedColorFrame);advancedColorFrame=null;}
    if(advancedColorTimer!==null){clearTimeout(advancedColorTimer);advancedColorTimer=null;}
    advancedColorLastDispatch=performance.now();
    const styleIds=Array.from(activeAdvancedColorStyleIds);pendingAdvancedColorStyleIds.clear();activeAdvancedColorStyleIds.clear();
    styleIds.forEach(id=>window.dispatchEvent(new CustomEvent('advanced-palette-style-color-changed',{detail:{styleId:id,interactive:false}})));
    if(advancedColorSettleTimer!==null){clearTimeout(advancedColorSettleTimer);advancedColorSettleTimer=null;}
    render();persist();
  }
  function updateActiveAdvancedStyleFromColorPanel(hex){
    if(isSyncingColorPanel||!activeLayerUsesAdvancedPalette()||!activeAdvancedStyleId) return false;
    const style=findAdvancedStyleById(activeAdvancedStyleId);
    if(!style||style.locked) return false;
    const rgba=hexToRgba(hex);
    const alpha=Array.isArray(style.rgba)?style.rgba[3]:255;
    if(style.rgba[0]===rgba.r&&style.rgba[1]===rgba.g&&style.rgba[2]===rgba.b) return true;
    style.rgba=[rgba.r,rgba.g,rgba.b,alpha];
    queueAdvancedStyleColorChange(style.id);
    return true;
  }
  function startInlineAdvancedStyleRename(style){
    const target=findAdvancedStyleById(style&&style.id);if(!target)return;
    const grid=document.getElementById('palette-grid');
    const card=grid&&grid.querySelector('.palette-style-card[data-id="'+CSS.escape(target.id)+'"]');
    const label=card&&card.querySelector('.palette-style-name');if(!card||!label)return;
    const previous=target.name||'';
    const input=document.createElement('input');input.type='text';input.className='palette-style-name-input';input.value=previous;
    label.replaceWith(input);card.classList.add('renaming');
    let done=false;
    const finish=commit=>{
      if(done)return;done=true;document.removeEventListener('pointerdown',onOutside,true);
      const clean=String(input.value||'').trim();
      if(commit&&clean)target.name=clean;
      render();
      if(commit&&clean&&clean!==previous)persist();
    };
    const onOutside=event=>{if(!input.contains(event.target))finish(true);};
    input.addEventListener('pointerdown',event=>event.stopPropagation());
    input.addEventListener('click',event=>event.stopPropagation());
    input.addEventListener('dblclick',event=>event.stopPropagation());
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();finish(true);}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);}
    });
    input.addEventListener('blur',()=>finish(true),{once:true});
    requestAnimationFrame(()=>{if(done)return;document.addEventListener('pointerdown',onOutside,true);input.focus();input.select();});
  }
  function editAdvancedStyle(style){
    const target=findAdvancedStyleById(style&&style.id);
    if(!target||target.locked) return;
    showEditColorModal({hex:styleHex(target)},hex=>{
      const stored=findAdvancedStyleById(target.id);
      if(!stored||stored.locked) return;
      stored.rgba=rgbaArray(hex);
      refreshAdvancedStyleChange(stored,true);
    });
  }
  function renameAdvancedStyle(style){startInlineAdvancedStyleRename(style);}
  function duplicateAdvancedStyle(style){
    if(!style) return;
    const copy=makeAdvancedStyle(style.rgba,null,nextAdvancedStyleName());
    copy.name=(style.name||'color')+' Copy';
    advancedStyles.push(copy);
    activeAdvancedStyleId=copy.id;
    render();
    persist();
  }
  function deleteAdvancedSeparator(separator){
    if(!isAdvancedSeparator(separator)) return;
    const idx=advancedStyles.findIndex(item=>isAdvancedSeparator(item)&&item.id===separator.id);
    if(idx<0) return;
    advancedStyles.splice(idx,1);
    render();
    persist();
  }
  function moveAdvancedItemToEdge(item,toEnd){
    if(!item) return;
    const idx=advancedStyles.findIndex(entry=>entry&&entry.id===item.id&&entry.type===item.type);
    if(idx<0) return;
    const moved=advancedStyles.splice(idx,1)[0];
    advancedStyles.splice(toEnd?advancedStyles.length:0,0,moved);
    notifyAdvancedStyleOrderChanged();
    render();
    persist();
  }
  async function deleteAdvancedStyle(style){
    if(!style||isAdvancedSeparator(style)||advancedStyles.filter(s=>!isAdvancedSeparator(s)).length<=1)return false;
    const idx=advancedStyles.findIndex(s=>s.id===style.id);
    if(idx<0)return false;
    const used=!!(window.SmartRasterLayer&&typeof window.SmartRasterLayer.isStyleUsed==='function'&&window.SmartRasterLayer.isStyleUsed(style.id));
    if(used){
      const confirmed=await requestPaletteConfirm('Delete Style','This style is used by existing Smart Raster pixels. Deleting it will orphan their style ownership while preserving their current painted appearance. Continue?','Delete Style');
      if(!confirmed)return false;
    }
    const previous=advancedStyles.slice(0,idx).reverse().find(item=>!isAdvancedSeparator(item));
    const next=advancedStyles.slice(idx+1).find(item=>!isAdvancedSeparator(item));
    advancedStyles.splice(idx,1);
    if(typeof window.markStyleDeleted==='function')window.markStyleDeleted(style.id);
    if(activeAdvancedStyleId===style.id){
      const neighbor=previous||next||null;
      activeAdvancedStyleId=neighbor?neighbor.id:null;
      advancedColorPanelStyleId=activeAdvancedStyleId;
      advancedColorPanelPaletteId=activeAdvancedStyleId?activePaletteId:null;
      if(neighbor)syncAdvancedStyleToColorPanel(neighbor);
    }
    render();
    if(!options||options.persist!==false)persist();
    return true;
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
    const pixelSelection=window.PixelSelection&&PixelSelection.getState?PixelSelection.getState():null;
    const canReplaceSelected=!!(style&&!isAdvancedSeparator(style)&&layers[curLayer]&&layers[curLayer].type==='smart-raster'&&pixelSelection&&pixelSelection.active&&pixelSelection.count>0&&pixelSelection.layerIndex===curLayer&&window.LinkedPixelSelection&&LinkedPixelSelection.replaceSelectedWithStyle);
    [
      menuItem('Edit Style',()=>editAdvancedStyle(style),false,!!style.locked),
      menuItem('Replace Selected With This Style',()=>LinkedPixelSelection.replaceSelectedWithStyle(style.id,style.rgba),false,!canReplaceSelected),
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
  function showAdvancedSeparatorContextMenu(x,y,separator){
    hideContextMenu();
    const menu=document.createElement('div');
    menu.id='palette-context-menu';
    menu.className='ctx-menu';
    menu.addEventListener('pointerdown',event=>event.stopPropagation());
    [
      menuItem('Delete Separator',()=>deleteAdvancedSeparator(separator),true),
      menuItem('-'),
      menuItem('Move to Top',()=>moveAdvancedItemToEdge(separator,false)),
      menuItem('Move to Bottom',()=>moveAdvancedItemToEdge(separator,true))
    ].forEach(item=>menu.appendChild(item));
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
    setTimeout(()=>document.addEventListener('pointerdown',hideContextMenu,{once:true}),0);
  }
  function clearAdvancedStyleInsert(){
    document.querySelectorAll('.palette-style-card.advanced-insert-before,.palette-style-card.advanced-insert-after,.palette-style-separator.advanced-insert-before,.palette-style-separator.advanced-insert-after').forEach(card=>card.classList.remove('advanced-insert-before','advanced-insert-after'));
  }
  function advancedStyleDropTarget(clientX,clientY){
    const grid=document.getElementById('palette-grid'),state=advancedStyleDrag;if(!grid||!state)return null;
    const gridRect=grid.getBoundingClientRect();
    const rowGap=parseFloat(getComputedStyle(grid).rowGap||getComputedStyle(grid).gap)||0;
    const separators=Array.from(grid.querySelectorAll('.palette-style-separator')).filter(separator=>separator.dataset.id!==state.id&&separator.getClientRects().length);
    for(const separator of separators){
      const rect=separator.getBoundingClientRect();
      if(clientX>=gridRect.left&&clientX<=gridRect.right&&clientY>=rect.top-rowGap&&clientY<=rect.bottom+rowGap){
        const sourceIndex=advancedStyles.findIndex(item=>item&&item.id===state.id);
        const targetIndex=advancedStyles.findIndex(item=>item&&item.id===separator.dataset.id);
        return {id:separator.dataset.id,side:sourceIndex>=0&&targetIndex>=0&&sourceIndex<targetIndex?'after':'before'};
      }
    }
    const cards=Array.from(grid.querySelectorAll('.palette-style-card,.palette-style-separator')).filter(card=>card.dataset.id!==state.id&&card.getClientRects().length);
    if(!cards.length)return null;
    let nearest=null,nearestDistance=Infinity;
    cards.forEach(card=>{
      const rect=card.getBoundingClientRect();
      const dx=clientX<rect.left?rect.left-clientX:clientX>rect.right?clientX-rect.right:0;
      const dy=clientY<rect.top?rect.top-clientY:clientY>rect.bottom?clientY-rect.bottom:0;
      const distance=Math.hypot(dx,dy);
      if(distance<nearestDistance){nearestDistance=distance;nearest=card;}
    });
    if(!nearest)return null;
    const rect=nearest.getBoundingClientRect();
    return {id:nearest.dataset.id,side:clientY<rect.top+rect.height/2?'before':'after'};
  }
  function updateAdvancedStyleDrag(event){
    const state=advancedStyleDrag;if(!state||event.pointerId!==state.pointerId)return;
    // Always preventDefault() immediately on every pointermove, BEFORE the
    // activation-distance check (mirrors Normal Palette's onDragMove). Pen
    // input needs this on the earliest movement or the browser's native
    // gesture handling can claim the pointer sequence and fire a
    // pointercancel before the drag ever activates.
    event.preventDefault();
    state.lastMove={clientX:event.clientX,clientY:event.clientY};
    if(state.rafPending)return;
    state.rafPending=true;
    requestAnimationFrame(processAdvancedStyleDragMove);
  }
  function activateAdvancedStyleDrag(state){
    if(!state||advancedStyleDrag!==state||state.active)return;
    state.active=true;advancedStyleSuppressClick=true;state.source.classList.add('dragging');
    state.oldUserSelect=document.documentElement.style.userSelect||'';state.oldCursor=document.documentElement.style.cursor||'';
    document.documentElement.style.userSelect='none';document.documentElement.style.cursor='grabbing';
    try{state.source.setPointerCapture(state.pointerId);state.captured=true;}catch(e){}
    if(state.lastMove&&!state.rafPending){state.rafPending=true;requestAnimationFrame(processAdvancedStyleDragMove);}
  }
  function processAdvancedStyleDragMove(){
    const state=advancedStyleDrag;if(!state||!state.lastMove)return;
    state.rafPending=false;
    const event=state.lastMove;
    if(!state.active)return;
    const grid=document.getElementById('palette-grid');
    const gridRect=grid&&grid.getBoundingClientRect();
    if(!gridRect||event.clientX<gridRect.left||event.clientX>gridRect.right||event.clientY<gridRect.top||event.clientY>gridRect.bottom){
      clearAdvancedStyleInsert();
      return;
    }
    const target=advancedStyleDropTarget(event.clientX,event.clientY);if(!target){clearAdvancedStyleInsert();return;}
    if(state.target&&state.target.id===target.id&&state.target.side!==target.side){
      const targetCard=grid.querySelector('.palette-style-card[data-id="'+CSS.escape(target.id)+'"]');
      const rect=targetCard&&targetCard.getBoundingClientRect();
      if(rect&&Math.abs(event.clientY-(rect.top+rect.height/2))<2) target.side=state.target.side;
    }
    state.target=target;clearAdvancedStyleInsert();
    const card=grid.querySelector('[data-id="'+CSS.escape(target.id)+'"]');if(card)card.classList.add('advanced-insert-'+target.side);
  }
  function finishAdvancedStyleDrag(event,cancelled){
    const state=advancedStyleDrag;if(!state||(event&&event.pointerId!==state.pointerId))return;
    advancedStyleDrag=null;
    document.removeEventListener('pointermove',updateAdvancedStyleDrag);
    document.removeEventListener('pointerup',onAdvancedStylePointerUp);
    document.removeEventListener('pointercancel',onAdvancedStylePointerCancel);
    clearTimeout(state.holdTimer);
    state.source.classList.remove('dragging');clearAdvancedStyleInsert();
    if(state.captured&&state.source.hasPointerCapture&&state.source.hasPointerCapture(state.pointerId)){try{state.source.releasePointerCapture(state.pointerId);}catch(e){}}
    if(state.active){document.documentElement.style.userSelect=state.oldUserSelect;document.documentElement.style.cursor=state.oldCursor;}
    if(state.active&&!cancelled&&state.target){
      const from=advancedStyles.findIndex(item=>item&&item.id===state.id);
      const over=advancedStyles.findIndex(item=>item&&item.id===state.target.id);
      if(from>=0&&over>=0){
        const beforeOrder=advancedStyles.map(item=>item.id);
        const moved=advancedStyles.splice(from,1)[0];
        let to=advancedStyles.findIndex(item=>item&&item.id===state.target.id);
        if(state.target.side==='after')to++;
        advancedStyles.splice(Math.max(0,to),0,moved);
        notifyAdvancedStyleOrderChanged();
        render();persist();
        if(layers.some(layer=>layer&&layer.renderMode==='style-layering')&&typeof undoStack!=='undefined'){undoStack.push({type:'smart-raster-style-order',before:beforeOrder,after:advancedStyles.map(item=>item.id)});if(typeof redoStack!=='undefined')redoStack.length=0;}
      }
    }
    if(state.active||advancedStyleSuppressClick)setTimeout(()=>{advancedStyleSuppressClick=false;},0);
  }
  function onAdvancedStylePointerUp(event){finishAdvancedStyleDrag(event,false);}
  function onAdvancedStylePointerCancel(event){finishAdvancedStyleDrag(event,true);}
  function beginAdvancedStyleDrag(event,style,card){
    if(event.isPrimary===false||event.target.closest('input'))return;
    if((event.pointerType||'mouse')==='mouse'&&event.button!==0)return;
    if(advancedStyleDrag)finishAdvancedStyleDrag(null,true);
    const pointerType=event.pointerType||'mouse';
    if(!isAdvancedSeparator(style)){selectStyle(style.id,true);advancedStyleSuppressClick=true;}
    event.preventDefault();
    advancedStyleDrag={id:style.id,pointerId:event.pointerId,pointerType:pointerType,startX:event.clientX,startY:event.clientY,source:card,selectable:!isAdvancedSeparator(style),active:false,captured:false,target:null,rafPending:false,lastMove:null,holdTimer:null};
    try{card.setPointerCapture(event.pointerId);advancedStyleDrag.captured=true;}catch(e){}
    const pendingDrag=advancedStyleDrag;
    advancedStyleDrag.holdTimer=setTimeout(()=>activateAdvancedStyleDrag(pendingDrag),PALETTE_REORDER_HOLD_MS);
    document.addEventListener('pointermove',updateAdvancedStyleDrag,{passive:false});
    document.addEventListener('pointerup',onAdvancedStylePointerUp);
    document.addEventListener('pointercancel',onAdvancedStylePointerCancel);
  }
  // Safety net only (not a normal end-of-drag path): if the window loses
  // focus entirely mid-drag (alt-tab, OS gesture, etc.) with no pointerup/
  // pointercancel ever arriving, force-cancel so state can't get stuck.
  window.addEventListener('blur',()=>{ if(advancedStyleDrag) finishAdvancedStyleDrag(null,true); });
  function renderAdvancedPalette(grid){
    syncAdvancedRefs();
    grid.classList.add('advanced-palette-grid');
    grid.innerHTML='';
    advancedStyles.forEach(style=>{
      if(isAdvancedSeparator(style)){
        const separator=document.createElement('div');
        separator.className='palette-style-separator advanced-palette-separator';
        separator.dataset.id=style.id;
        separator.setAttribute('role','separator');
        separator.title='Separator';
        separator.addEventListener('pointerdown',event=>beginAdvancedStyleDrag(event,style,separator));
        separator.addEventListener('dragstart',event=>event.preventDefault());
        separator.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();if(advancedStyleDrag)finishAdvancedStyleDrag(null,true);showAdvancedSeparatorContextMenu(event.clientX,event.clientY,style);});
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
      meta.append(name);
      const lock=document.createElement('span');
      lock.className='palette-style-lock';
      lock.textContent=style.locked?'LOCK':'';
      card.append(preview,meta,lock);
      card.addEventListener('pointerdown',event=>{
        if(window.LinkedPixelSelection&&window.LinkedPixelSelection.handleStylePointer(event,style.id)){advancedStyleSuppressClick=true;return;}
        beginAdvancedStyleDrag(event,style,card);
      });
      card.addEventListener('dragstart',event=>event.preventDefault());
      // NOTE: deliberately no 'lostpointercapture' abort handler here. Pen/
      // stylus drivers can transiently drop and re-acquire pointer capture
      // mid-stroke (pressure-curve dips, digitizer sample batching, Windows
      // Ink contact reporting, etc.) even while the pen is still actively
      // dragging. Treating that as a hard-cancel — which this handler used
      // to do — silently killed every pen-driven reorder before pointerup
      // ever fired. Normal Palette's swatch drag has no such listener and
      // relies solely on document-level pointerup/pointercancel to end a
      // drag, which is reliable for both mouse and pen; Advanced Palette now
      // matches that.
      card.addEventListener('click',event=>{
        if(advancedStyleSuppressClick){event.preventDefault();advancedStyleSuppressClick=false;return;}
        if(event.target.closest('.palette-style-name-input'))return;
        selectStyle(style.id,true);
      });
      name.addEventListener('dblclick',event=>{
        event.preventDefault();event.stopPropagation();
        startInlineAdvancedStyleRename(style);
      });
      card.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();if(advancedStyleDrag)finishAdvancedStyleDrag(null,true);activeAdvancedStyleId=style.id;advancedColorPanelStyleId=style.id;advancedColorPanelPaletteId=activePaletteId;render();showAdvancedStyleContextMenu(event.clientX,event.clientY,style);});
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
    applyViewSettings(false);
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
    const advanced=currentPaletteDockerMode()==='advanced';
    if(apply)apply.disabled=advanced||!isSwatch(item);
    if(remove){
      const label=advanced?'Delete Style':'Delete Swatch';
      remove.title=label;
      remove.setAttribute('aria-label',label);
      remove.disabled=advanced?!activeAdvancedStyle()||advancedStyles.filter(style=>!isAdvancedSeparator(style)).length<=1:!item;
    }
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
    input.value=paletteNameForMode(active,activePaletteMode());
    requestAnimationFrame(()=>{input.focus();input.select();positionSideMenu();});
  }
  function applyInlineRename(){
    const active=activePalette();
    const input=document.getElementById('palette-rename-inline-input');
    if(!active||!input) return;
    const clean=String(input.value||'').trim();
    if(!clean){input.focus();return;}
    const mode=activePaletteMode();
    if(mode==='advanced') active.advancedName=uniquePaletteName(clean,active.id,mode);
    else active.name=uniquePaletteName(clean,active.id,mode);
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
    if(text) text.textContent='Delete "'+paletteNameForMode(active,activePaletteMode())+'"?';
    box.classList.remove('hidden');
    requestAnimationFrame(()=>positionSideMenu());
  }
  function confirmDeletePalette(){
    if(palettes.length<=1) return;
    const active=activePalette();
    if(!active) return;
    const idx=palettes.findIndex(p=>p.id===active.id);
    if(toolbarPaletteAttachment&&toolbarPaletteAttachment.paletteId===active.id){toolbarPaletteAttachment=null;toolbarPaletteVisible=false;}
    palettes.splice(idx,1);
    activePaletteId=palettes[Math.min(idx,palettes.length-1)].id;
    hidePaletteInlinePanels();
    restoreScrollPending=true;
    hideContextMenu();
    hideEditConfirmBar();
    render();
    persistView();
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
    const copy=makePalette(uniqueCopyName(active.name),copiedSwatches,null,copiedSelected,true,uniquePaletteName(active.advancedName+' Copy',null,'advanced'));
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
    return {version:1,name:active.name,advancedName:active.advancedName,swatches:(active.swatches||[]).map(exportSwatchData)};
  }
  function allPalettesExportData(){
    rememberSelection();
    return {version:1,palettes:palettes.map(p=>({id:p.id,name:p.name,advancedName:p.advancedName,swatches:(p.swatches||[]).map(exportSwatchData),selectedId:p.selectedId||null})),activePaletteId};
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
  function paletteFromImport(name,swatchItems,selectedImportId,advancedName){
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
    return makePalette(uniqueImportedPaletteName(name),swatchList,null,selected,true,advancedName);
  }
  function parsePaletteJson(text){
    let data;
    try{data=JSON.parse(text);}catch(e){throw new Error('Invalid JSON palette file.');}
    if(!data||typeof data!=='object') throw new Error('Invalid palette file.');
    if(Array.isArray(data.palettes)){
      const imported=[];
      data.palettes.forEach((p,i)=>{
        const palette=paletteFromImport(p&&p.name||('Palette '+(i+1)),p&&p.swatches,p&&p.selectedId,p&&p.advancedName);
        if(!palette) return;
        if(p&&p.id===data.activePaletteId) imported.activeId=palette.id;
        imported.push(palette);
      });
      if(!imported.length) throw new Error('No colors were found in this palette file.');
      if(!imported.activeId) imported.activeId=imported[0].id;
      return imported;
    }
    const one=paletteFromImport(data.name||'Imported Palette',data.swatches,data.selectedId,data.advancedName);
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
    const isAdvancedEdit=typeof onApply==='function';
    const start=hexToRgba(original);
    let alpha=Math.round((Number.isFinite(+start.a)?start.a:1)*255);
    let hsv=rgbToHsv(start.r,start.g,start.b);
    let mode='RGB';
    const modal=document.createElement('div');
    modal.id='palette-color-modal';
    modal.innerHTML='<div class="palette-color-dialog wheel" role="dialog" aria-modal="true" aria-label="Edit color" tabindex="-1"><div class="palette-color-title"><span>Edit Color</span><button type="button" class="palette-color-close" aria-label="Cancel">&times;</button></div><div class="palette-color-body"><div class="palette-color-picker-column"><div class="palette-color-previews"><div><span>Current</span><div class="palette-color-preview current"></div></div><div><span>New</span><div class="palette-color-preview next"></div></div></div><div class="palette-wheel-wrap"><div class="palette-hue-wheel"><div class="palette-hue-cursor"></div><div class="palette-inner-sv"><div class="palette-sv-cursor"></div></div></div></div></div><div class="palette-color-control-column"><div class="palette-mode-tabs"><button type="button" data-mode="RGB">RGB</button><button type="button" data-mode="HSV">HSV</button><button type="button" data-mode="HSL">HSL</button><button type="button" data-mode="HEX">HEX</button></div><div class="palette-mode-fields"></div></div></div><div class="palette-color-history" hidden><div class="palette-color-history-title">Color History</div><div class="palette-color-history-swatches"></div></div><div class="palette-color-actions"><button type="button" class="palette-color-ok">OK</button><button type="button" class="palette-color-cancel">Cancel</button></div></div>';
    document.body.appendChild(modal);
    const dialog=modal.querySelector('.palette-color-dialog');
    const wheel=modal.querySelector('.palette-hue-wheel');
    const sv=modal.querySelector('.palette-inner-sv');
    const hueCursor=modal.querySelector('.palette-hue-cursor');
    const svCursor=modal.querySelector('.palette-sv-cursor');
    const fields=modal.querySelector('.palette-mode-fields');
    const currentPreview=modal.querySelector('.palette-color-preview.current');
    const nextPreview=modal.querySelector('.palette-color-preview.next');
    const historySection=modal.querySelector('.palette-color-history');
    const historySwatches=modal.querySelector('.palette-color-history-swatches');
    let dragging='',dragStartHex='';
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
    function renderColorHistory(){
      if(!isAdvancedEdit){historySection.hidden=true;return;}
      historySection.hidden=false;historySwatches.innerHTML='';
      AdvancedColorHistory.getAll().forEach(hex=>{
        const button=document.createElement('button');button.type='button';button.className='palette-color-history-swatch';button.title=hex.toUpperCase();
        if(isTransparentHex(hex))button.classList.add('transparent');else button.style.background=displayHex(hex);
        button.addEventListener('click',()=>{setFromHex(hex);onApply(colorHex());});
        historySwatches.appendChild(button);
      });
    }
    function finalizeHistory(startHex){
      if(!isAdvancedEdit)return;
      const finalHex=normalizeHex(colorHex());
      if(startHex&&normalizeHex(startHex)===finalHex)return;
      AdvancedColorHistory.record(rgbaArray(finalHex));
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
    const unsubscribeHistory=isAdvancedEdit?AdvancedColorHistory.subscribe(renderColorHistory):()=>{};
    function close(){unsubscribeHistory();document.removeEventListener('keydown',onKey);modal.remove();}
    function ok(){finalizeHistory('');if(typeof onApply==='function') onApply(colorHex()); else updateSwatchColor(swatch,colorHex());close();}
    function cancel(){close();}
    function onKey(event){if(event.key==='Escape'){event.preventDefault();cancel();}else if(event.key==='Enter'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();ok();}}
    paintPreview(currentPreview,original);
    paintPreview(nextPreview,original);
    renderFields();
    renderColorHistory();
    requestAnimationFrame(syncWheel);
    modal.querySelectorAll('.palette-mode-tabs button').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;renderFields();}));
    wheel.addEventListener('pointerdown',event=>{if(event.target.closest('.palette-inner-sv')) return;dragStartHex=colorHex();dragging='hue';wheel.setPointerCapture(event.pointerId);setHueFromEvent(event);});
    wheel.addEventListener('pointermove',event=>{if(dragging==='hue') setHueFromEvent(event);});
    wheel.addEventListener('pointerup',event=>{if(dragging==='hue'){dragging='';finalizeHistory(dragStartHex);dragStartHex='';try{wheel.releasePointerCapture(event.pointerId);}catch(e){}}});
    wheel.addEventListener('pointercancel',()=>{dragging='';});
    sv.addEventListener('pointerdown',event=>{event.stopPropagation();dragStartHex=colorHex();dragging='sv';sv.setPointerCapture(event.pointerId);setSvFromEvent(event);});
    sv.addEventListener('pointermove',event=>{if(dragging==='sv') setSvFromEvent(event);});
    sv.addEventListener('pointerup',event=>{if(dragging==='sv'){dragging='';finalizeHistory(dragStartHex);dragStartHex='';try{sv.releasePointerCapture(event.pointerId);}catch(e){}}});
    sv.addEventListener('pointercancel',()=>{dragging='';});
    fields.addEventListener('change',()=>finalizeHistory(''));
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
  function addAdvancedSeparator(){
    const idx=activeAdvancedStyleId?advancedStyles.findIndex(item=>!isAdvancedSeparator(item)&&item.id===activeAdvancedStyleId):-1;
    advancedStyles.splice(idx>=0?idx+1:advancedStyles.length,0,makeAdvancedSeparator());
    render();
    persist();
  }
  function addSeparator(){
    if(activePaletteMode()==='advanced') addAdvancedSeparator();
    else insertItemAfterSelection(makeSeparator());
  }
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
    event.preventDefault();
    hideContextMenu();
    activatePaletteSwatch(swatch.id,{select:true,setForeground:true});
    const rect=el.getBoundingClientRect();
    dragState={id:swatch.id,startX:event.clientX,startY:event.clientY,grabOffsetX:event.clientX-rect.left,grabOffsetY:event.clientY-rect.top,swatchWidth:rect.width,swatchHeight:rect.height,pointerType:event.pointerType||'mouse',active:false,overId:swatch.id,side:'after',targetGroupIndex:null,targetLocalIndex:null,targetGlobalIndex:null,targetSeparatorSide:null,targetSeparatorId:null,rafPending:false,lastMove:null,pointerId:event.pointerId,sourceEl:el,captured:false,holdTimer:null};
    try{el.setPointerCapture(event.pointerId);dragState.captured=true;}catch(e){}
    const pendingDrag=dragState;
    dragState.holdTimer=setTimeout(()=>activatePaletteDrag(pendingDrag),PALETTE_REORDER_HOLD_MS);
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
  function activatePaletteDrag(state){
    if(!state||dragState!==state||state.active)return;
    state.active=true;
    suppressClick=true;
    if(state.sourceEl&&!state.captured){
      try{state.sourceEl.setPointerCapture(state.pointerId);state.captured=true;}catch(e){}
    }
    const dragged=document.querySelector('.palette-swatch[data-id="'+CSS.escape(state.id)+'"]');
    if(dragged)dragged.classList.add('dragging');
    if(state.lastMove&&!state.rafPending){state.rafPending=true;requestAnimationFrame(processDragMove);}
  }
  function processDragMove(){
    if(!dragState||!dragState.lastMove)return;
    dragState.rafPending=false;
    const event=dragState.lastMove;
    if(event.pointerId!==dragState.pointerId)return;
    if(!dragState.active)return;

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
    clearTimeout(state.holdTimer);
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
      setTimeout(()=>{suppressClick=false;},0);
      return;
    }
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
    const styleLayeringToggle=document.getElementById('palette-style-layering');
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
    if(toolbarToggle) toolbarToggle.addEventListener('click',event=>{event.stopPropagation();toggleToolbarPaletteSubmenu();});
    if(advancedToggle) advancedToggle.addEventListener('click',toggleAdvancedPalette);
    if(styleLayeringToggle) styleLayeringToggle.addEventListener('change',()=>{
      const layer=layers[curLayer],requested=styleLayeringToggle.checked,before=!!(layer&&layer.renderMode==='style-layering'),beforeLayer=typeof _deepCopyLayer==='function'?_deepCopyLayer(layer):null;
      const result=window.SmartRasterStyleLayering&&window.SmartRasterStyleLayering.setEnabled(layer,requested);
      if(!result||!result.success) styleLayeringToggle.checked=before;
      else if(result.changed&&typeof undoStack!=='undefined'){undoStack.push({type:'smart-raster-style-layering-toggle',layerIndex:curLayer,beforeLayer,afterLayer:typeof _deepCopyLayer==='function'?_deepCopyLayer(layer):null});if(typeof redoStack!=='undefined')redoStack.length=0;}
      syncStyleLayeringControl();
    });
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
    if(remove)remove.addEventListener('click',()=>{
      if(currentPaletteDockerMode()==='advanced')deleteAdvancedStyle(activeAdvancedStyle());
      else deleteSelected();
    });
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
  function getAdvancedStyleOrder(){return advancedStyles.filter(item=>item&&!isAdvancedSeparator(item)&&item.type==='style').map(item=>item.id);}
  function restoreAdvancedStyleOrder(snapshot){const byId=new Map(advancedStyles.map(item=>[item.id,item])),ordered=(Array.isArray(snapshot)?snapshot:[]).map(id=>byId.get(id)).filter(Boolean),seen=new Set(ordered.map(item=>item.id));advancedStyles=ordered.concat(advancedStyles.filter(item=>!seen.has(item.id)));syncAdvancedRefs();notifyAdvancedStyleOrderChanged();render();persist();}
  function notifyAdvancedStyleOrderChanged(){window.dispatchEvent(new CustomEvent('advanced-palette-order-changed',{detail:{styleIds:getAdvancedStyleOrder()}}));}
  function isAdvancedPalettePaintingEnabled(){return activeLayerUsesAdvancedPalette();}
  function getActiveAdvancedPaletteStyleId(){const style=activeAdvancedStyle();return activeLayerUsesAdvancedPalette()&&style?style.id:null;}
  window.isAdvancedPalettePaintingEnabled=isAdvancedPalettePaintingEnabled;
  window.getActiveAdvancedPaletteStyleId=getActiveAdvancedPaletteStyleId;
  function getActiveAdvancedStyleColorForHistory(){
    const style=advancedColorPanelStyleId&&advancedColorPanelStyleId===activeAdvancedStyleId?findAdvancedStyleById(activeAdvancedStyleId):null;
    return style&&!style.locked&&Array.isArray(style.rgba)?style.rgba.slice():null;
  }
  window.PaletteDocker={serialize,load,reset(){load(null);},renderCurrentColors:render,refresh:render,synchronizeActiveContext,isAdvancedPalettePaintingEnabled,getActiveAdvancedPaletteStyleId,getActiveAdvancedStyleColorForHistory,findAdvancedStyleById,getAdvancedStyleOrder,restoreAdvancedStyleOrder,updateActiveAdvancedStyleFromColorPanel,flushAdvancedStyleColorChange,selectAdvancedStyleById,selectMatchingRgba,setForegroundFromSample};
  window.addEventListener('active-artwork-changed',()=>{synchronizeActiveContext(true);syncStyleLayeringControl();});
  window.addEventListener('active-layer-changed',syncStyleLayeringControl);
  window.addEventListener('smart-raster-style-layering-changed',syncStyleLayeringControl);
  document.addEventListener('DOMContentLoaded',()=>{bind();loadPersisted();});
})();
