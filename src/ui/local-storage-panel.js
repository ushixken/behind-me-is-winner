// ================================================================
// LOCAL STORAGE PANEL (Edit > Local Storage)
// Lists everything this app has saved in localStorage (settings,
// keybinds, brush presets, panel layout, etc.), with a running total
// size, per-item delete, bulk delete, "Delete All", and ZIP export.
// ================================================================
(function(){
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
  function _meta(key){return STORAGE_META[key]||{name:key,description:''};}
  function _friendlyName(key){return _meta(key).name;}
  function _formatBytes(n){
    if(n<1024) return n+' B';
    if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/(1024*1024)).toFixed(1)+' MB';
  }
  function _byteSize(str){return new Blob([str]).size;}
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
    entries.sort((a,b)=>{
      const aMeta=_meta(a.key),bMeta=_meta(b.key),importance=Number(!!bMeta.important)-Number(!!aMeta.important);
      return importance||aMeta.name.localeCompare(bMeta.name,undefined,{sensitivity:'base'});
    });
    return {entries,total};
  }

  const listEl=document.getElementById('ls-list');
  const totalEl=document.getElementById('ls-total-size');
  const selectAll=document.getElementById('ls-select-all');
  const selectedCount=document.getElementById('ls-selected-count');
  const clearSelection=document.getElementById('ls-clear-selection');
  const deleteSelected=document.getElementById('ls-delete-selected');
  const selectedKeys=new Set();

  function _checkboxId(key){
    let hash=2166136261;
    for(let i=0;i<key.length;i++) hash=Math.imul(hash^key.charCodeAt(i),16777619);
    return 'ls-item-'+(hash>>>0).toString(36);
  }
  function _syncSelection(entries){
    const visibleKeys=new Set(entries.map(entry=>entry.key));
    selectedKeys.forEach(key=>{if(!visibleKeys.has(key)) selectedKeys.delete(key);});
    const count=selectedKeys.size,allSelected=entries.length>0&&count===entries.length;
    selectAll.checked=allSelected;
    selectAll.indeterminate=count>0&&!allSelected;
    selectAll.disabled=entries.length===0;
    clearSelection.disabled=count===0;
    deleteSelected.disabled=count===0;
    selectedCount.textContent=count+' item'+(count===1?'':'s')+' selected';
  }
  function _refreshRenderedSelection(entries){
    listEl.querySelectorAll('.ls-select').forEach(checkbox=>{
      const checked=selectedKeys.has(checkbox.dataset.storageKey);
      checkbox.checked=checked;
      checkbox.closest('.ls-row').classList.toggle('is-selected',checked);
    });
    _syncSelection(entries);
  }
  function _setAll(entries,checked){
    entries.forEach(({key})=>checked?selectedKeys.add(key):selectedKeys.delete(key));
    _refreshRenderedSelection(entries);
  }

  function render(){
    const {entries,total}=_collectEntries();
    totalEl.textContent=_formatBytes(total);
    const previousScrollTop=listEl.scrollTop;
    listEl.innerHTML='';
    if(entries.length===0){
      const empty=document.createElement('div');
      empty.id='ls-empty';
      empty.textContent='Nothing saved yet.';
      listEl.appendChild(empty);
      _syncSelection(entries);
      return;
    }
    let currentSection=null;
    entries.forEach(({key,size})=>{
      const meta=_meta(key),section=meta.important?'important':'preferences';
      if(section!==currentSection){
        currentSection=section;
        const heading=document.createElement('div');
        heading.className='ls-section-header '+section;
        heading.textContent=meta.important?'IMPORTANT SAVED DATA':'STORED APPLICATION PREFERENCES';
        listEl.appendChild(heading);
      }
      const row=document.createElement('div');
      const checkboxId=_checkboxId(key);
      row.className='ls-row'+(meta.important?' ls-row-important':'');
      row.classList.toggle('is-selected',selectedKeys.has(key));
      row.innerHTML=
        '<input class="ls-select" type="checkbox"/>'+
        '<span class="ls-size"></span>'+
        '<label class="ls-info"><span class="ls-name"></span><span class="ls-description"></span></label>';
      const checkbox=row.querySelector('.ls-select');
      const info=row.querySelector('.ls-info');
      checkbox.id=checkboxId;
      checkbox.name=checkboxId;
      checkbox.dataset.storageKey=key;
      checkbox.checked=selectedKeys.has(key);
      checkbox.setAttribute('aria-label','Select '+meta.name);
      info.htmlFor=checkboxId;
      row.querySelector('.ls-size').textContent=_formatBytes(size);
      row.querySelector('.ls-name').textContent=meta.name;
      row.querySelector('.ls-name').title=key;
      row.querySelector('.ls-description').textContent=meta.description||(meta.important?'Deleting this resets '+(meta.reset||meta.name.toLowerCase())+'.':'Stored application preference.');
      checkbox.onchange=()=>{
        checkbox.checked?selectedKeys.add(key):selectedKeys.delete(key);
        row.classList.toggle('is-selected',checkbox.checked);
        _syncSelection(entries);
      };
      row.onclick=event=>{
        if(event.target.closest('button,input,label')) return;
        checkbox.click();
      };
      listEl.appendChild(row);
    });
    _syncSelection(entries);
    listEl.scrollTop=Math.min(previousScrollTop,Math.max(0,listEl.scrollHeight-listEl.clientHeight));
  }

  selectAll.onchange=()=>_setAll(_collectEntries().entries,selectAll.checked);
  clearSelection.onclick=()=>{selectedKeys.clear();_refreshRenderedSelection(_collectEntries().entries);};
  deleteSelected.onclick=()=>{
    const entries=_collectEntries().entries.filter(({key})=>selectedKeys.has(key));
    if(entries.length===0) return;
    const important=entries.filter(({key})=>_meta(key).important);
    const names=entries.map(({key})=>'- '+_meta(key).name).join('\n');
    const warning=important.length
      ? '\n\nWARNING: '+important.length+' important saved data item'+(important.length===1?' is':'s are')+' included. This may reset brushes, shortcuts, workspace layout, or Tool Settings.'
      : '';
    if(!confirm('Delete '+entries.length+' selected item'+(entries.length===1?'':'s')+'?\n\n'+names+warning+'\n\nThis cannot be undone.')) return;
    const failed=[];
    entries.forEach(({key})=>{
      try{
        localStorage.removeItem(key);
        if(localStorage.getItem(key)!==null) failed.push(_meta(key).name);
        else selectedKeys.delete(key);
      }catch(error){failed.push(_meta(key).name);}
    });
    render();
    if(failed.length) alert('Could not delete:\n- '+failed.join('\n- '));
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
        zip.file(_friendlyName(key).replace(/[\\/:*?"<>|]/g,'_')+'.txt',val);
      });
      const blob=await zip.generateAsync({type:'blob'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;
      a.download='local-storage.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  }

  window._renderLocalStorage=render;
})();