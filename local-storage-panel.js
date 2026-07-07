// ================================================================
// LOCAL STORAGE PANEL (Edit > Local Storage)
// Lists everything this app has saved in localStorage (settings,
// keybinds, brush presets, panel layout, etc.), with a running total
// size, per-item delete, "Delete All", and "Get All as ZIP" (mirrors
// Photopea's own Local Storage panel).
// ================================================================
(function(){

  // Friendly display names for keys this app is known to write. Anything
  // not listed here still shows up (using the raw key), so nothing saved
  // is ever hidden from the user - this just makes common entries readable.
  // nicely, the same way Photopea shows "Josh H. Black Brushes.abr"
  // instead of a raw storage key.
  const STORAGE_META={
    'animatorBrushPresetsV2':{name:'Brush Presets',description:'Deletes saved brushes, per-brush settings, folders, and brush/eraser preset sizes.',important:true,reset:'brush presets and brush settings'},
    'keybinds_v1':{name:'Keyboard Shortcuts',description:'Deletes customized keyboard shortcuts and restores their defaults.',important:true,reset:'keyboard shortcuts'},
    'animator_panel_layout_v4':{name:'Workspace / Panel Layout',description:'Resets panel positions, sizes, docking, and visibility.',important:true,reset:'workspace and panel layout'},
    'toolSettingsMode':{name:'Tool Settings',description:'Resets the saved Simple/Advanced Tool Settings mode.',important:true,reset:'Tool Settings preferences'},
    'tsSimpleFieldVisibility':{name:'Tool Settings Fields',description:'Resets which brush controls appear in Simple mode.',important:true,reset:'Tool Settings field visibility'},
    'tsSimpleSectionVisibility':{name:'Tool Settings Sections',description:'Resets visible Tool Settings sections.',important:true,reset:'Tool Settings sections'},
    'tsSimpleSectionOrder':{name:'Tool Settings Section Order',description:'Resets the customized Tool Settings section order.',important:true,reset:'Tool Settings section order'},
    'animator_cursor_style':{name:'Cursor Preferences',description:'Resets the selected drawing cursor style.'},
    'animator_renderer':{name:'Renderer Preference',description:'Resets the selected brush renderer.'},
    'brushSizeUnit':{name:'Brush Size Unit',description:'Resets the displayed brush size unit to pixels.'},
    'animator_kfexp_amount':{name:'Keyframe Exposure Amount'},
    'animator_kfexp_bypass':{name:'Keyframe Exposure Bypass'},
    'animator_kfsw_step':{name:'Keyframe Switcher Step'},
    'animator_kfsw_bypass':{name:'Keyframe Switcher Bypass'}
  };
  function _meta(key){
    return STORAGE_META[key]||{name:key,description:''};
  }
  function _friendlyName(key){
    return _meta(key).name;
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
      const meta=_meta(key);
      row.className='ls-row'+(meta.important?' ls-row-important':'');
      row.innerHTML=
        '<span class="ls-swatch"></span>'+
        '<span class="ls-size"></span>'+
        '<span class="ls-info"><span class="ls-name"></span><span class="ls-description"></span></span>'+
        '<button class="ls-del" title="Delete">Delete</button>';
      row.querySelector('.ls-size').textContent=_formatBytes(size);
      row.querySelector('.ls-name').textContent=meta.name;
      row.querySelector('.ls-name').title=key;
      row.querySelector('.ls-description').textContent=meta.description||'Stored application preference.';
      row.querySelector('.ls-del').onclick=()=>{
        const message=meta.important
          ? 'Deleting this will reset your '+meta.reset+'. Continue?'
          : "Delete \""+meta.name+"\"? This can't be undone.";
        if(!confirm(message)) return;
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
  // the Local Storage tab is opened or becomes visible - this module no
  // longer has its own menu entry or modal.
  window._renderLocalStorage=render;

})();
