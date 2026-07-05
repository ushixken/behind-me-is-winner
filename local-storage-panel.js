// ════════════════════════════════════════════════════════════════
// LOCAL STORAGE PANEL (Edit ▸ Local Storage)
// Lists everything this app has saved in localStorage (settings,
// keybinds, brush presets, panel layout, etc.), with a running total
// size, per-item delete, "Delete All", and "Get All as ZIP" (mirrors
// Photopea's own Local Storage panel).
// ════════════════════════════════════════════════════════════════
(function(){

  // Friendly display names for keys this app is known to write. Anything
  // not listed here still shows up (using the raw key), so nothing saved
  // is ever hidden from the user — this just makes the common ones read
  // nicely, the same way Photopea shows "Josh H. Black Brushes.abr"
  // instead of a raw storage key.
  const FRIENDLY_NAMES={
    'animator_renderer':'Renderer preference',
    'animator_cursor_style':'Cursor style preference',
    'brushSizeUnit':'Brush size unit (px/mm)',
    'keybinds_v1':'Keybinds',
  };
  // brush-presets.js and panels.js define their own store keys as consts
  // (TS_MODE_KEY / STORE_KEY / LAYOUT_KEY) rather than string literals, so
  // pick them up dynamically if present instead of hardcoding duplicates
  // that could drift out of sync.
  function _friendlyName(key){
    if(FRIENDLY_NAMES[key]) return FRIENDLY_NAMES[key];
    if(typeof STORE_KEY!=='undefined' && key===STORE_KEY) return 'Brush Presets';
    if(typeof TS_MODE_KEY!=='undefined' && key===TS_MODE_KEY) return 'Tool Settings panel mode';
    if(typeof LAYOUT_KEY!=='undefined' && key===LAYOUT_KEY) return 'Panel layout';
    return key;
  }

  function _formatBytes(n){
    if(n<1024) return n+' B';
    if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/(1024*1024)).toFixed(1)+' MB';
  }

  // Rough on-disk size: localStorage stores UTF-16, but byte-length of the
  // UTF-8 encoding (via Blob) is what people actually recognize as "size",
  // and matches how browsers/other tools usually report it.
  function _byteSize(str){
    return new Blob([str]).size;
  }

  function _collectEntries(){
    const entries=[];
    let total=0;
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key==null) continue;
      const val=localStorage.getItem(key)||'';
      const size=_byteSize(val);
      total+=size;
      entries.push({key,size,val});
    }
    entries.sort((a,b)=>b.size-a.size);
    return {entries,total};
  }

  const listEl=document.getElementById('ls-list');
  const totalEl=document.getElementById('ls-total-size');
  const deleteAllBtn=document.getElementById('ls-delete-all');

  function render(){
    const {entries,total}=_collectEntries();
    totalEl.textContent=_formatBytes(total);
    listEl.innerHTML='';
    if(entries.length===0){
      const empty=document.createElement('div');
      empty.id='ls-empty';
      empty.textContent='Nothing saved yet.';
      listEl.appendChild(empty);
      deleteAllBtn.disabled=true;
      return;
    }
    deleteAllBtn.disabled=false;
    entries.forEach(({key,size})=>{
      const row=document.createElement('div');
      row.className='ls-row';
      row.innerHTML=
        '<span class="ls-swatch"></span>'+
        '<span class="ls-size"></span>'+
        '<span class="ls-name"></span>'+
        '<button class="ls-del" title="Delete">✕</button>';
      row.querySelector('.ls-size').textContent=_formatBytes(size);
      row.querySelector('.ls-name').textContent=_friendlyName(key);
      row.querySelector('.ls-name').title=key;
      row.querySelector('.ls-del').onclick=()=>{
        if(!confirm('Delete "'+_friendlyName(key)+'"? This can\'t be undone.')) return;
        localStorage.removeItem(key);
        render();
      };
      listEl.appendChild(row);
    });
  }

  deleteAllBtn.onclick=()=>{
    const {entries}=_collectEntries();
    if(entries.length===0) return;
    if(!confirm('Delete ALL locally saved data ('+entries.length+' item'+(entries.length===1?'':'s')+')? This resets every preference, keybind, and saved brush preset. This can\'t be undone.')) return;
    localStorage.clear();
    render();
  };

  const getZipBtn=document.getElementById('ls-get-zip');
  if(getZipBtn){
    getZipBtn.onclick=async ()=>{
      const {entries}=_collectEntries();
      if(entries.length===0) return;
      if(typeof JSZip==='undefined'){
        alert('ZIP export isn\'t available right now.');
        return;
      }
      const zip=new JSZip();
      entries.forEach(({key,val})=>{
        // .txt keeps every entry openable/readable regardless of whether
        // the underlying value is JSON, a plain string, or something else.
        zip.file(_friendlyName(key).replace(/[\\/:*?"<>|]/g,'_')+'.txt', val);
      });
      const blob=await zip.generateAsync({type:'blob'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download='local-storage.zip';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // Exposed so Preferences (keybinds.js) can refresh this list whenever
  // the Local Storage tab is opened or becomes visible — this module no
  // longer has its own menu entry or modal.
  window._renderLocalStorage=render;

})();