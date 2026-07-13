(function(){
  const STORE_KEY='animatorPaletteV1';
  let swatches=[];
  let selectedId=null;
  const defaultHexes=['#000000','#ffffff','#f23636','#ff9f1c','#ffd23f','#2ec4b6','#3a86ff','#8338ec'];

  function normalizeHex(hex){
    hex=String(hex||'').trim();
    if(/^#[0-9a-f]{6}$/i.test(hex)) return hex.toLowerCase();
    return '#000000';
  }
  function hexToRgba(hex){
    hex=normalizeHex(hex);
    return {
      r:parseInt(hex.slice(1,3),16),
      g:parseInt(hex.slice(3,5),16),
      b:parseInt(hex.slice(5,7),16),
      a:1
    };
  }
  function makeSwatch(hex,id){
    const safeHex=normalizeHex(hex);
    return {id:id||('pal_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)),hex:safeHex,rgba:hexToRgba(safeHex)};
  }
  function defaultPalette(){return defaultHexes.map(hex=>makeSwatch(hex));}
  function sanitizePalette(input){
    const list=Array.isArray(input)?input:[];
    const clean=list.map(item=>makeSwatch(item&&item.hex,item&&item.id)).filter(Boolean);
    return clean.length?clean:defaultPalette();
  }
  function persist(){
    try{localStorage.setItem(STORE_KEY,JSON.stringify(serialize()));}catch(e){}
  }
  function serialize(){return {version:1,swatches:swatches.map(s=>({id:s.id,hex:s.hex,rgba:s.rgba})),selectedId};}
  function load(data){
    const payload=data&&Array.isArray(data.swatches)?data:null;
    swatches=sanitizePalette(payload?payload.swatches:null);
    selectedId=payload&&swatches.some(s=>s.id===payload.selectedId)?payload.selectedId:null;
    render();
    persist();
  }
  function loadPersisted(){
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
  function setBackground(hex){
    if(typeof bgDrawColor!=='undefined') bgDrawColor=normalizeHex(hex);
    if(typeof syncColorPanelSwatches==='function') syncColorPanelSwatches();
  }
  function selectedSwatch(){return swatches.find(s=>s.id===selectedId)||null;}
  function render(){
    const grid=document.getElementById('palette-grid');
    if(!grid) return;
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
        selectedId=s.id;
        setForeground(s.hex,false);
        render();
        persist();
      });
      btn.addEventListener('dblclick',()=>{
        selectedId=s.id;
        setForeground(s.hex,true);
        render();
        persist();
      });
      btn.addEventListener('contextmenu',event=>{
        event.preventDefault();
        selectedId=s.id;
        render();
        persist();
        showContextMenu(event.clientX,event.clientY,s);
      });
      grid.appendChild(btn);
    });
  }
  function showContextMenu(x,y,swatch){
    hideContextMenu();
    const menu=document.createElement('div');
    menu.id='palette-context-menu';
    menu.className='ctx-menu';
    const items=[['Set as Background',()=>setBackground(swatch.hex)],['Edit Color',()=>{}],['Duplicate Color',()=>{swatches.push(makeSwatch(swatch.hex));render();persist();}],['Delete Color',()=>{deleteSelected();}]];
    items.forEach(([label,fn])=>{
      const item=document.createElement('div');
      item.className='ctx-item'+(label==='Delete Color'?' danger':'');
      item.textContent=label;
      item.addEventListener('click',()=>{hideContextMenu();fn();});
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-8)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-8)+'px';
    setTimeout(()=>document.addEventListener('pointerdown',hideContextMenu,{once:true}),0);
  }
  function hideContextMenu(){const menu=document.getElementById('palette-context-menu');if(menu) menu.remove();}
  function addCurrent(){swatches.push(makeSwatch(color));selectedId=swatches[swatches.length-1].id;render();persist();}
  function deleteSelected(){
    const idx=swatches.findIndex(s=>s.id===selectedId);
    if(idx<0) return;
    swatches.splice(idx,1);
    selectedId=swatches[idx]?swatches[idx].id:(swatches[idx-1]?swatches[idx-1].id:null);
    render();persist();
  }
  function clearAll(){
    if(!swatches.length) return;
    if(!confirm('Clear every color in this palette?')) return;
    swatches=[];selectedId=null;render();persist();
  }
  function bind(){
    const add=document.getElementById('palette-add-color');
    const remove=document.getElementById('palette-remove-color');
    const clear=document.getElementById('palette-clear');
    if(add) add.addEventListener('click',addCurrent);
    if(remove) remove.addEventListener('click',deleteSelected);
    if(clear) clear.addEventListener('click',clearAll);
    document.addEventListener('keydown',e=>{if(e.key==='Escape') hideContextMenu();});
  }
  window.PaletteDocker={serialize,load,reset(){load(null);}};
  document.addEventListener('DOMContentLoaded',()=>{bind();loadPersisted();});
})();