(function(){
  'use strict';
  const STORAGE_KEY='animate.toolGroups.v1';
  const DRAWER_STORAGE_KEY='animate.toolGroupDrawers.v1';
  const SELECTION_SETTINGS_STORAGE_KEY='animate.selectionToolSettings.v1';
  const TOOL_OPTIONS_DRAWER_STATE_ID='tool-options';
  const groups=new Map();
  let activeGroupId=null,activating=false;
  let saved={},drawerSaved={};
  let selectionSettingsSaved={};
  let magicWandAdvancedOpen=false;
  try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch(_){saved={};}
  try{drawerSaved=JSON.parse(localStorage.getItem(DRAWER_STORAGE_KEY)||'{}')||{};}catch(_){drawerSaved={};}
  try{selectionSettingsSaved=JSON.parse(localStorage.getItem(SELECTION_SETTINGS_STORAGE_KEY)||'{}')||{};}catch(_){selectionSettingsSaved={};}
  try{magicWandAdvancedOpen=localStorage.getItem('animate.magicWandAdvancedExpanded.v1')==='true';}catch(_){magicWandAdvancedOpen=false;}
  if(!saved['smart-selection']&&(saved.selection==='magic-wand'||saved.selection==='style-select'))saved['smart-selection']=saved.selection;

  function registerGroup(definition){
    if(!definition||!definition.id||!Array.isArray(definition.subTools))throw new Error('Invalid tool group');
    const group=Object.assign({},definition,{subTools:definition.subTools.map(item=>Object.assign({groupId:definition.id,status:'implemented',cursor:'crosshair'},item))});
    const requested=saved[group.id];let valid=group.subTools.some(item=>item.id===requested&&item.status==='implemented');
    if(!valid&&typeof requested==='string'&&(definition.id==='brush'||definition.id==='eraser')&&requested.indexOf(definition.id+':')===0){
      const presetId=requested.slice(definition.id.length+1);group.subTools.push({id:requested,presetId,name:presetId,icon:definition.icon,groupId:definition.id,status:'implemented',cursor:'crosshair',activate:()=>{setTool(definition.id,definition.name);if(window._brushPresets)_brushPresets.selectPreset(presetId);}});valid=true;
    }
    group.activeSubToolId=valid?requested:(group.defaultSubToolId||((group.subTools.find(item=>item.status==='implemented')||group.subTools[0]||{}).id));
    groups.set(group.id,group);return group;
  }
  function persist(){const state={};groups.forEach(group=>state[group.id]=group.activeSubToolId);localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
  function getGroup(id){return groups.get(id)||null;}
  function getSubTool(group,id){return group&&group.subTools.find(item=>item.id===id)||null;}
  function activeLayerSupportsStyleSelect(){const layer=layers[curLayer];return !!(layer&&layer.type==='smart-raster');}
  function subToolIsAvailable(subTool){return !!(subTool&&subTool.status==='implemented'&&(!subTool.isAvailable||subTool.isAvailable()));}
  function selectionFallback(group){
    const remembered=getSubTool(group,group.lastValidSubToolId);if(subToolIsAvailable(remembered))return remembered;
    const rectangle=getSubTool(group,'rectangle-select');if(subToolIsAvailable(rectangle))return rectangle;
    return group.subTools.find(item=>item.id!=='style-select'&&subToolIsAvailable(item))||null;
  }
  function smartSelectionFallback(group){return getSubTool(group,'magic-wand');}
  function drawerState(stateId){
    const raw=drawerSaved[stateId]||{};
    return {expanded:raw.expanded===true,height:Number.isFinite(+raw.height)?Math.max(80,Math.min(500,+raw.height)):150};
  }
  function saveDrawerState(stateId,state){drawerSaved[stateId]={expanded:!!state.expanded,height:Math.round(state.height)};localStorage.setItem(DRAWER_STORAGE_KEY,JSON.stringify(drawerSaved));}
  function drawerStateId(){return TOOL_OPTIONS_DRAWER_STATE_ID;}
  function setDrawerGeometry(drawer,state){
    if(!state.expanded){drawer.style.height='';drawer.style.flexBasis='';drawer.style.minHeight='';drawer.style.maxHeight='';return;}
    const size=Math.round(state.height)+'px';
    drawer.style.height=size;drawer.style.flexBasis=size;drawer.style.minHeight=size;drawer.style.maxHeight=size;
  }
  function optionsBodyForGroup(groupId){
    const shell=document.getElementById('brush-presets-panel');if(!shell)return null;
    if(groupId==='brush'||groupId==='eraser')return shell.querySelector('.fp-body[data-body="brush-presets"]');
    if(groupId==='transform')return shell.querySelector('.fp-body[data-body="transform"]');
    return shell.querySelector('.fp-body[data-body="tool-group"]');
  }
  function captureOptionsPanelLayout(){
    const shell=document.getElementById('brush-presets-panel'),body=shell&&shell.querySelector('.fp-body.active');
    const drawer=body&&body.querySelector('.tool-options-drawer');if(!drawer||!drawer.isConnected)return null;
    const savedState=drawerState(TOOL_OPTIONS_DRAWER_STATE_ID),expanded=drawer.classList.contains('expanded'),rect=drawer.getBoundingClientRect();
    const height=expanded&&rect.height>0?rect.height:savedState.height;
    const content=drawer.querySelector('.tool-options-drawer-content');
    const snapshot={expanded,height,scrollTop:content?content.scrollTop:0};
    saveDrawerState(TOOL_OPTIONS_DRAWER_STATE_ID,{expanded,height});
    return snapshot;
  }
  function restoreOptionsPanelLayout(snapshot,group){
    if(!snapshot||!group||activeGroupId!==group.id)return;
    const body=optionsBodyForGroup(group.id),drawer=body&&body.querySelector('.tool-options-drawer');
    if(!drawer||!drawer.isConnected)return;
    saveDrawerState(TOOL_OPTIONS_DRAWER_STATE_ID,{expanded:snapshot.expanded,height:snapshot.height});
    applyDrawerState(body,group);
    const content=drawer.querySelector('.tool-options-drawer-content');
    if(content)content.scrollTop=Math.min(snapshot.scrollTop,Math.max(0,content.scrollHeight-content.clientHeight));
  }
  function applyDrawerState(body,group){
    const drawer=body.querySelector('.tool-options-drawer');if(!drawer)return;
    const stateId=drawerStateId(drawer,group);
    // Migrate one prior drawer size once, then ignore tool-specific geometry.
    // Every tool group renders into the same persisted lower-options slot size.
    if(!drawerSaved[stateId]){
      const previous=drawerSaved['tool-settings']||drawerSaved['selection-options']||drawerSaved['transform-options']||drawerSaved[group.id];
      drawerSaved[stateId]=previous?{expanded:previous.expanded===true,height:Math.max(80,Math.min(500,+previous.height||150))}:{expanded:false,height:150};
      localStorage.setItem(DRAWER_STORAGE_KEY,JSON.stringify(drawerSaved));
    }
    const state=drawerState(stateId),header=drawer.querySelector('.tool-options-drawer-header'),chevron=drawer.querySelector('.tool-options-drawer-chevron');
    drawer.dataset.groupId=group.id;drawer.dataset.drawerStateId=stateId;drawer.classList.toggle('expanded',state.expanded);setDrawerGeometry(drawer,state);
    header.setAttribute('aria-expanded',String(state.expanded));if(chevron)chevron.textContent=state.expanded?'\u25be':'\u25b4';
    const content=drawer.querySelector('.tool-options-drawer-content');
    if(content)requestAnimationFrame(()=>{content.scrollTop=Math.min(content.scrollTop,Math.max(0,content.scrollHeight-content.clientHeight));});
  }
  function configureOptionsDrawer(body,group){
    const drawer=body.querySelector('.tool-options-drawer'),header=drawer&&drawer.querySelector('.tool-options-drawer-header');if(!drawer||!header)return;
    const label=drawer.querySelector('.tool-options-drawer-label'),activeSubTool=getSubTool(group,group.activeSubToolId),usesToolSettings=drawer.classList.contains('tool-settings-drawer')||group.id==='fill'||group.id==='line',usesSelectionOptions=group.id==='selection'||group.id==='smart-selection',baseTitle=usesToolSettings?'TOOL SETTINGS':(group.name+' Options').toUpperCase(),fullTitle=(usesToolSettings||usesSelectionOptions)&&activeSubTool?baseTitle+' — '+(usesToolSettings?group.name:activeSubTool.name):baseTitle,visibleTitle=usesToolSettings?baseTitle+' · '+group.name.toUpperCase():(usesSelectionOptions&&activeSubTool?baseTitle+' · '+activeSubTool.name.toUpperCase():baseTitle);if(label){label.textContent=visibleTitle;label.title=fullTitle;}header.setAttribute('aria-label',fullTitle);
    applyDrawerState(body,group);
    if(header.dataset.drawerBound)return;header.dataset.drawerBound='true';
    let drag=null;
    const finish=(event,cancelled)=>{if(!drag||event.pointerId!==drag.pointerId)return;const wasDragging=drag.dragging,groupId=drawer.dataset.groupId,stateId=drawer.dataset.drawerStateId||groupId,current=drawerState(stateId);drag=null;if(header.hasPointerCapture&&header.hasPointerCapture(event.pointerId))header.releasePointerCapture(event.pointerId);document.body.classList.remove('tool-options-resizing');if(cancelled){const active=getGroup(groupId);if(active)applyDrawerState(body,active);return;}if(wasDragging){const height=parseFloat(drawer.style.height)||current.height;if(height<64){saveDrawerState(stateId,{expanded:false,height:current.height});}else saveDrawerState(stateId,{expanded:true,height});}else saveDrawerState(stateId,{expanded:!drawer.classList.contains('expanded'),height:current.height});const active=getGroup(groupId);if(active)applyDrawerState(body,active);};
    header.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;const state=drawerState(drawer.dataset.drawerStateId||drawer.dataset.groupId);drag={pointerId:event.pointerId,startY:event.clientY,startHeight:drawer.classList.contains('expanded')?drawer.getBoundingClientRect().height:header.getBoundingClientRect().height,dragging:false,state};header.setPointerCapture(event.pointerId);});
    header.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const delta=drag.startY-event.clientY;if(!drag.dragging&&Math.abs(delta)<4)return;drag.dragging=true;event.preventDefault();document.body.classList.add('tool-options-resizing');const max=Math.max(80,body.clientHeight-96),height=Math.max(28,Math.min(max,drag.startHeight+delta));drawer.classList.add('expanded');setDrawerGeometry(drawer,{expanded:true,height});header.setAttribute('aria-expanded','true');const chevron=drawer.querySelector('.tool-options-drawer-chevron');if(chevron)chevron.textContent='\u25be';});
    header.addEventListener('pointerup',event=>finish(event,false));header.addEventListener('pointercancel',event=>finish(event,true));header.addEventListener('lostpointercapture',event=>{if(drag&&event.pointerId===drag.pointerId)finish(event,true);});
    header.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();const groupId=drawer.dataset.groupId,stateId=drawer.dataset.drawerStateId||groupId,state=drawerState(stateId);saveDrawerState(stateId,{expanded:!drawer.classList.contains('expanded'),height:state.height});const active=getGroup(groupId);if(active)applyDrawerState(body,active);});
  }
  function ensureGenericBody(){
    const shell=document.getElementById('brush-presets-panel'),wrap=shell&&shell.querySelector('.fp-body-wrap');if(!wrap)return null;
    let body=wrap.querySelector('.fp-body[data-body="tool-group"]');if(body)return body;
    body=document.createElement('div');body.className='fp-body tool-group-body';body.dataset.body='tool-group';body.dataset.spacePan='';
    body.innerHTML='<div class="tool-group-list"></div><section class="tool-options-drawer"><button type="button" class="tool-options-drawer-header" aria-expanded="false"><span class="tool-options-drawer-label"></span><span class="tool-options-drawer-chevron" aria-hidden="true">&#9652;</span></button><div class="tool-options-drawer-content"></div></section>';wrap.appendChild(body);return body;
  }
  function setBody(name){
    const shell=document.getElementById('brush-presets-panel');if(!shell)return;
    shell.querySelectorAll('.fp-body').forEach(body=>body.classList.toggle('active',body.dataset.body===name));
  }
  function renderGeneric(group){
    const body=ensureGenericBody();if(!body)return;const list=body.querySelector('.tool-group-list');list.replaceChildren();
    const duplicateHeader=body.querySelector('.tool-group-actions');if(duplicateHeader)duplicateHeader.remove();
    const optionsContent=body.querySelector('.tool-options-drawer-content');if(optionsContent&&group.id!=='selection')optionsContent.replaceChildren();
    let currentSection=null;
    group.subTools.forEach(subTool=>{
      if(subTool.section&&subTool.section!==currentSection){currentSection=subTool.section;const header=document.createElement('div');header.className='tool-group-section-header';header.textContent=currentSection;list.appendChild(header);}
      const button=document.createElement('button');button.type='button';button.className='tool-group-subtool';button.dataset.subToolId=subTool.id;
      const available=subToolIsAvailable(subTool);button.classList.toggle('active',subTool.id===group.activeSubToolId&&available);button.disabled=!available;
      const icon=document.createElement('span');icon.className='tool-group-subtool-icon';icon.textContent=subTool.icon||group.icon||'';
      const label=document.createElement('span');label.className='tool-group-subtool-label';label.textContent=subTool.name;
      button.append(icon,label);if(button.disabled){const soon=document.createElement('span');soon.className='tool-group-coming-soon';soon.textContent=subTool.status==='implemented'?(subTool.unavailableLabel||'Unavailable'):'Coming Soon';button.appendChild(soon);}
      button.onclick=()=>activateSubTool(group.id,subTool.id);list.appendChild(button);
    });
    const activeSubTool=getSubTool(group,group.activeSubToolId);
    if(optionsContent){
      if(typeof group.panelRenderer==='function')group.panelRenderer(optionsContent,group,activeSubTool);
      else if(activeSubTool&&typeof activeSubTool.settingsRenderer==='function')activeSubTool.settingsRenderer(optionsContent,activeSubTool,group);
      else if(typeof group.settingsRenderer==='function')group.settingsRenderer(optionsContent,activeSubTool,group);
      else{const message=document.createElement('div');message.className='tool-options-message';message.textContent=(activeSubTool&&activeSubTool.settingsDescription)||'No additional options';optionsContent.appendChild(message);}
    }
    configureOptionsDrawer(body,group);
  }
  function syncPanel(group){
    const shell=document.getElementById('brush-presets-panel');if(!shell)return;
    const name=shell.querySelector('.fp-name');if(name)name.textContent=group.panelTitle||(group.id==='brush'||group.id==='eraser'?group.name+' Presets':group.name+' Sub Tools');
    const redundantSettings=shell.querySelector('.tool-group-dock-settings');if(redundantSettings)redundantSettings.remove();
    if(group.id==='brush'||group.id==='eraser'){
      const brushBody=shell.querySelector('.fp-body[data-body="brush-presets"]');if(brushBody)configureOptionsDrawer(brushBody,group);setBody('brush-presets');if(window._brushPresets)_brushPresets.switchTab(group.id);
    }else if(group.id==='transform'){const transformBody=shell.querySelector('.fp-body[data-body="transform"]');if(transformBody)configureOptionsDrawer(transformBody,group);setBody('transform');}
    else{renderGeneric(group);setBody('tool-group');}
  }
  function renderSettings(){
    const body=document.getElementById('tool-settings-body'),host=document.getElementById('tool-settings-modal-body');if(!body||!host)return;
    let alternate=document.getElementById('tool-group-settings');if(!alternate){alternate=document.createElement('div');alternate.id='tool-group-settings';alternate.className='tool-group-settings';host.appendChild(alternate);}
    const group=getGroup(activeGroupId),subTool=getSubTool(group,group&&group.activeSubToolId),usesBrush=group&&(group.id==='brush'||group.id==='eraser');
    body.style.display=usesBrush?'':'none';alternate.style.display=usesBrush?'none':'';if(usesBrush)return;
    alternate.replaceChildren();const title=document.createElement('h3');title.textContent=subTool?subTool.name:(group?group.name:'Tool Settings');alternate.appendChild(title);
    if(subTool&&typeof subTool.settingsRenderer==='function')subTool.settingsRenderer(alternate,subTool,group);
    else if(group&&typeof group.settingsRenderer==='function')group.settingsRenderer(alternate,subTool,group);
    else{const message=document.createElement('p');message.textContent=subTool&&subTool.status!=='implemented'?'Coming Soon':(subTool&&subTool.settingsDescription)||'This sub tool uses its current canvas controls.';alternate.appendChild(message);}
  }
  function activateSubTool(groupId,subToolId,options){
    const group=getGroup(groupId),subTool=getSubTool(group,subToolId);if(!group||!subToolIsAvailable(subTool))return false;
    const optionsLayout=captureOptionsPanelLayout();
    if(groupId==='selection')group.lastValidSubToolId=subTool.id;
    activeGroupId=groupId;group.activeSubToolId=subTool.id;persist();
    if(groupId==='selection')restoreSelectionToolContext(subTool);
    activating=true;try{if(typeof subTool.activate==='function')subTool.activate(options||{});}finally{activating=false;}
    // setTool() still contains the legacy Brush/Transform body switch. Run
    // the registry's authoritative switch afterwards so exactly one dock
    // body remains active for Fill and Selection as well.
    syncPanel(group);renderSettings();syncActiveButtons();restoreOptionsPanelLayout(optionsLayout,group);
    // Some tool renderers finish their control refresh after activation. Pin
    // the same existing drawer node once more after layout without rebuilding
    // its wrapper, header, splitter, or stack item.
    if(optionsLayout)requestAnimationFrame(()=>restoreOptionsPanelLayout(optionsLayout,group));
    return true;
  }
  function activateGroup(groupId){const group=getGroup(groupId);if(!group)return false;let subTool=getSubTool(group,group.activeSubToolId);if(!subToolIsAvailable(subTool)){if(groupId==='selection')subTool=selectionFallback(group);else if(groupId==='smart-selection')subTool=smartSelectionFallback(group);}return !!subTool&&activateSubTool(groupId,subTool.id,{fromGroup:true});}
  function refreshSelectionAvailability(){
    const selection=getGroup('selection'),smart=getGroup('smart-selection');
    if(selection&&activeGroupId==='selection'){renderGeneric(selection);setBody('tool-group');renderSettings();}
    if(!smart)return;
    const current=getSubTool(smart,smart.activeSubToolId);
    if(activeGroupId==='smart-selection'&&!subToolIsAvailable(current)){
      const fallback=smartSelectionFallback(smart);if(fallback){activateSubTool('smart-selection',fallback.id,{contextFallback:true});return;}
    }
    if(activeGroupId==='smart-selection'){renderGeneric(smart);setBody('tool-group');renderSettings();}
  }
  function syncActiveButtons(){document.querySelectorAll('[data-tool-group-id]').forEach(button=>button.classList.toggle('active',button.dataset.toolGroupId===activeGroupId));}
  function bindMainButton(id,groupId){const button=document.getElementById(id);if(!button)return;button.dataset.toolGroupId=groupId;button.onclick=()=>activateGroup(groupId);}
  function toolActivation(toolId,label,after){return()=>{setTool(toolId,label);if(after)after();};}
  function placeholder(id,name,icon){return{id,name,icon,status:'coming-soon'};}

  function renderLineOptions(body){
    const section=document.createElement('div');section.className='tool-group-inline-options';
    function rangeRow(label,min,max,step,value,onInput,kind){const row=document.createElement('label');row.className='tool-group-option-row';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;if(kind)input.dataset.optionKind=kind;const output=document.createElement('span');output.className='tool-group-option-value';output.textContent=value;if(kind)output.dataset.optionValueKind=kind;input.oninput=()=>{output.textContent=input.value;onInput(+input.value);};row.append(text,input,output);section.appendChild(row);}
    rangeRow('Width / Size',1,2000,.1,toolSizes.brush||6,value=>{window._lineSizeUpdateSource='line-slider';toolSizes.line=value;window._lineSizeUpdateSource=null;if(tool==='line'){szSlider.value=value;if(typeof refreshSizeUI==='function')refreshSizeUI();}},'line-size');
    rangeRow('Opacity',1,100,1,Math.round(brushOpacity*100),value=>{brushOpacity=value/100;const existing=document.getElementById('ts-opacity');if(existing){existing.value=value;existing.dispatchEvent(new Event('input',{bubbles:true}));}});
    const pressureGroup=document.createElement('div');pressureGroup.className='tool-group-option-row compact tool-line-pressure-group';
    const pressureLabel=document.createElement('span');pressureLabel.textContent='Pressure';pressureGroup.appendChild(pressureLabel);
    const pressureOptions=document.createElement('div');pressureOptions.className='tool-line-pressure-options';pressureOptions.setAttribute('role','radiogroup');pressureOptions.setAttribute('aria-label','Line Pressure Mode');
    const currentMode=(typeof window.getLinePressureMode==='function')?window.getLinePressureMode():'pen';
    [['fixed','Fixed'],['pen','Pen Pressure']].forEach(([mode,text])=>{
      const optionLabel=document.createElement('label');optionLabel.className='tool-line-pressure-option';
      const radio=document.createElement('input');radio.type='radio';radio.name='line-pressure-mode';radio.value=mode;radio.checked=(currentMode===mode);
      radio.onchange=()=>{if(radio.checked&&typeof window.setLinePressureMode==='function')window.setLinePressureMode(mode);};
      const radioText=document.createElement('span');radioText.textContent=text;
      optionLabel.append(radio,radioText);pressureOptions.appendChild(optionLabel);
    });
    pressureGroup.appendChild(pressureOptions);section.appendChild(pressureGroup);
    const aaRow=document.createElement('label');aaRow.className='tool-group-option-row compact';const aa=document.createElement('input');aa.type='checkbox';aa.checked=!!brushAA;const aaText=document.createElement('span');aaText.textContent='Anti-aliasing';aa.onchange=()=>{if(aa.checked!==!!brushAA&&typeof window._setBrushAA==='function')window._setBrushAA(aa.checked);};aaRow.append(aa,aaText);section.appendChild(aaRow);
    const colorRow=document.createElement('div');colorRow.className='tool-group-option-row compact';const colorPreview=document.createElement('span');colorPreview.className='tool-group-line-color';colorPreview.style.background=typeof color==='string'?color:'#000';const colorText=document.createElement('span');colorText.textContent='Current Color  '+(typeof color==='string'?color:'');colorRow.append(colorPreview,colorText);section.appendChild(colorRow);
    body.appendChild(section);
  }

  window.addEventListener('brush-size-changed',event=>{
    const input=document.querySelector('[data-option-kind=\"line-size\"]');
    const output=document.querySelector('[data-option-value-kind=\"line-size\"]');
    if(!input||!output)return;
    const size=Number(event.detail&&event.detail.size);
    if(!Number.isFinite(size))return;
    input.value=size;
    output.textContent=typeof window.formatBrushSize==='function'?window.formatBrushSize(size):String(size);
  });

  function renderFillOptions(body,group,activeSubTool){
    const state=window.FillMaskEngine?FillMaskEngine.getSettings():{antialiasing:true,quality:'medium'};
    const section=document.createElement('div');section.className='tool-group-inline-options tool-aa-controls';
    const row=document.createElement('label');row.className='tool-group-option-row compact tool-aa-toggle';
    const input=document.createElement('input');input.type='checkbox';input.className='ts-check';input.checked=!!state.antialiasing;
    const text=document.createElement('span');text.textContent='Anti-alias (AA)';row.title='Smooths only the painted edge; shape and selection masks remain binary.';row.append(input,text);
    const select=document.createElement('select');select.className='ts-select tool-aa-quality';select.setAttribute('aria-label','Fill antialiasing quality');
    [['weak','Weak'],['medium','Medium'],['strong','Strong']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);});
    select.value=state.quality||'medium';select.disabled=!input.checked;
    input.onchange=()=>{select.disabled=!input.checked;if(window.FillMaskEngine)FillMaskEngine.setAntialiasing(input.checked);};select.onchange=()=>{if(window.FillMaskEngine)FillMaskEngine.setQuality(select.value);};
    section.append(row,select);body.appendChild(section);
  }
  function selectionSettingsFor(subTool){

    const definition=subTool&&subTool.selectionSettings,defaults=definition&&definition.defaults||{},savedState=selectionSettingsSaved[subTool&&subTool.id]||{};
    return Object.assign({},defaults,savedState);
  }
  function updateSelectionSetting(subTool,key,value){
    if(!subTool||!subTool.selectionSettings)return;
    const next=Object.assign({},selectionSettingsSaved[subTool.id]||{}, {[key]:value});selectionSettingsSaved[subTool.id]=next;
    try{localStorage.setItem(SELECTION_SETTINGS_STORAGE_KEY,JSON.stringify(selectionSettingsSaved));}catch(_){}
  }
  function restoreSelectionToolContext(subTool){
    if(!subTool||!subTool.selectionSettings||!subTool.selectionSettings.defaults||!Object.prototype.hasOwnProperty.call(subTool.selectionSettings.defaults,'scope'))return;
    const state=selectionSettingsFor(subTool);if(window.SelectionScope)SelectionScope.set(state.scope||'all');
  }
  function selectionModeForEvent(toolId,event){
    const group=getGroup('selection'),subTool=getSubTool(group,toolId);
    if((event.shiftKey||event.altKey)&&window.PixelSelection)return PixelSelection.modeFromEvent(event);
    const state=selectionSettingsFor(subTool);return ['replace','add','subtract','intersect'].includes(state.combine)?state.combine:'replace';
  }
  function ensureSelectionOptionsHost(body){
    let layout=body.querySelector('.selection-options-layout');
    if(!layout){layout=document.createElement('div');layout.className='tool-group-inline-options selection-options-layout';body.replaceChildren(layout);}
    let host=layout.querySelector('.selection-tool-settings-host');
    if(!host){host=document.createElement('div');host.className='selection-tool-settings-host';layout.appendChild(host);}
    host.replaceChildren();return host;
  }
  function makeSelectionSelect(parent,labelText,value,items,onChange,tooltip){
    const field=document.createElement('label');field.className='selection-option-field';field.title=tooltip||'';const label=document.createElement('span');label.className='selection-option-label';label.textContent=labelText;const select=document.createElement('select');select.className='ts-select magic-wand-select';select.title=tooltip||'';items.forEach(([itemValue,text])=>{const option=document.createElement('option');option.value=itemValue;option.textContent=text;select.appendChild(option);});select.value=value;select.onchange=()=>onChange(select.value);if(labelText)field.appendChild(label);field.appendChild(select);parent.appendChild(field);return select;
  }
  function renderAreaSelectionSettings(host,subTool){
    const state=selectionSettingsFor(subTool),section=document.createElement('section');section.className='selection-option-section selection-tool-option-section';
    const scopeGroup=document.createElement('div');scopeGroup.className='magic-wand-control-group selection-tool-scope-group';section.appendChild(scopeGroup);
    const scopeLabel=document.createElement('div');scopeLabel.className='selection-option-label';scopeLabel.textContent='Selection Scope';scopeGroup.appendChild(scopeLabel);
    const segments=document.createElement('div');segments.className='ts-pill-row selection-scope-segments';segments.setAttribute('role','group');segments.setAttribute('aria-label',subTool.name+' Selection Scope');
    [['all','All'],['inside','Inside'],['outside','Outside']].forEach(([mode,text])=>{const button=document.createElement('button');button.type='button';button.className='ts-pill';button.textContent=text;const active=state.scope===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.onclick=()=>{updateSelectionSetting(subTool,'scope',mode);if(window.SelectionScope)SelectionScope.set(mode);segments.querySelectorAll('.ts-pill').forEach(item=>{const selected=item===button;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});};segments.appendChild(button);});
    scopeGroup.appendChild(segments);
    const combineGroup=document.createElement('div');combineGroup.className='magic-wand-control-group selection-tool-combine-group';section.appendChild(combineGroup);
    const combineSelect=makeSelectionSelect(combineGroup,'',state.combine,[['add','Add'],['replace','Replace'],['subtract','Subtract'],['intersect','Intersect']],value=>updateSelectionSetting(subTool,'combine',value),'How this selection is merged with the current selection.');combineSelect.parentElement.classList.add('magic-wand-combine-field');
    host.appendChild(section);
  }
  function renderMagicWandSettings(host){
    if(!window.MagicWandSelection)return;
    const settings=MagicWandSelection.getSettings(),wandSection=document.createElement('section');wandSection.className='selection-option-section magic-wand-option-section';
    function controlGroup(parent,className){const control=document.createElement('div');control.className='magic-wand-control-group'+(className?' '+className:'');parent.appendChild(control);return control;}
    function selectField(parent,labelText,key,items,tooltip){const select=makeSelectionSelect(parent,labelText,settings[key],items,value=>MagicWandSelection.updateSettings({[key]:value}),tooltip);if(!labelText)select.parentElement.classList.add('magic-wand-combine-field');}
    function rangeField(parent,labelText,key,min,max,id,tooltip){const field=document.createElement('div');field.className='selection-option-field';field.title=tooltip;const label=document.createElement('label');label.className='selection-option-label';label.textContent=labelText;label.htmlFor=id;label.title=tooltip;const controls=document.createElement('div');controls.className='magic-wand-range-controls';const range=document.createElement('input');range.type='range';range.className='ts-range';range.min=min;range.max=max;range.step=1;range.value=settings[key];range.id=id;range.title=tooltip;const value=document.createElement('output');value.className='ts-num magic-wand-range-value';value.setAttribute('for',id);value.textContent=settings[key];range.oninput=()=>{value.textContent=range.value;MagicWandSelection.updateSettings({[key]:+range.value});};controls.append(range,value);field.append(label,controls);parent.appendChild(field);return field;}
    function checkbox(parent,labelText,key,tooltip,disabled,status,displayChecked){const row=document.createElement('label');row.className='magic-wand-checkbox-row'+(disabled?' disabled':'');row.title=tooltip||'';const input=document.createElement('input');input.type='checkbox';input.className='ts-check';input.checked=displayChecked===undefined?!!settings[key]:!!displayChecked;input.disabled=!!disabled;input.onchange=()=>MagicWandSelection.updateSettings({[key]:input.checked});const text=document.createElement('span');text.textContent=labelText;row.append(input,text);if(status){const badge=document.createElement('span');badge.className='magic-wand-option-status';badge.textContent=status;row.appendChild(badge);}parent.appendChild(row);return {row,input};}
    const combineGroup=controlGroup(wandSection,'magic-wand-basic magic-wand-combine-group');
    selectField(combineGroup,'','combine',[['add','Add'],['replace','Replace'],['subtract','Subtract'],['intersect','Intersect']],'How this selection is merged with the current selection.');
    const toleranceGroup=controlGroup(wandSection,'magic-wand-tolerance-group');
    rangeField(toleranceGroup,'Tolerance','tolerance',0,255,'magic-wand-tolerance','Higher values include more similar colors.');
    checkbox(toleranceGroup,'Connected Region Only','contiguous','Only selects pixels connected to the clicked area.');
    const expansionGroup=controlGroup(wandSection,'magic-wand-expansion-group');
    rangeField(expansionGroup,'Expand Selection','edgeExpansion',-20,20,'magic-wand-expand-selection','Expands or contracts the resulting selection after it is created.');
    const samplingGroup=controlGroup(wandSection,'magic-wand-sampling-group');
    selectField(samplingGroup,'Sample From','sample',[['current','Current Layer'],['all','All Visible Layers']],'Choose which layers are sampled when creating the selection.');
    const advancedKey='animate.magicWandAdvancedExpanded.v1';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='magic-wand-advanced-toggle';toggle.setAttribute('aria-expanded',String(magicWandAdvancedOpen));const chevron=document.createElement('span');chevron.className='magic-wand-advanced-chevron';chevron.textContent='▶';const toggleText=document.createElement('span');toggleText.textContent='Advanced';toggle.append(chevron,toggleText);wandSection.appendChild(toggle);
    const advancedInner=document.createElement('div');advancedInner.className='magic-wand-advanced';advancedInner.hidden=!magicWandAdvancedOpen;wandSection.appendChild(advancedInner);
    const gapGroup=controlGroup(advancedInner,'magic-wand-gap-group');
    const gapToggle=checkbox(gapGroup,'Close Small Gaps','gapBridging','Treats small openings in line art as closed while searching.');
    const gapSizeField=rangeField(gapGroup,'Maximum Gap Size','gapWidth',1,10,'magic-wand-maximum-gap','Maximum opening size that Gap Bridging will ignore.');gapSizeField.classList.add('magic-wand-dependent-control');gapSizeField.classList.toggle('collapsed',!settings.gapBridging);gapSizeField.setAttribute('aria-hidden',String(!settings.gapBridging));gapSizeField.inert=!settings.gapBridging;gapToggle.input.onchange=()=>{MagicWandSelection.updateSettings({gapBridging:gapToggle.input.checked});gapSizeField.classList.toggle('collapsed',!gapToggle.input.checked);gapSizeField.setAttribute('aria-hidden',String(!gapToggle.input.checked));gapSizeField.inert=!gapToggle.input.checked;};
    const comparisonGroup=controlGroup(advancedInner,'magic-wand-comparison-group');
    checkbox(comparisonGroup,'Compare Transparency','includeAlpha','Includes transparency when comparing colors.');
    checkbox(comparisonGroup,'Anti-aliased Edge','antiAlias','Creates smoother selection edges.');
    const referencedGroup=controlGroup(advancedInner,'magic-wand-referenced-group');
    checkbox(referencedGroup,'Sample Referenced Layers','referencedLayers','Reference layers are not available yet.',true,'Coming Soon',true);
    toggle.onclick=()=>{magicWandAdvancedOpen=!magicWandAdvancedOpen;advancedInner.hidden=!magicWandAdvancedOpen;toggle.setAttribute('aria-expanded',String(magicWandAdvancedOpen));try{localStorage.setItem(advancedKey,String(magicWandAdvancedOpen));}catch(_){}if(magicWandAdvancedOpen)requestAnimationFrame(()=>{const scroller=toggle.closest('.tool-options-drawer-content');if(!scroller)return;const contentBottom=advancedInner.getBoundingClientRect().bottom,visibleBottom=scroller.getBoundingClientRect().bottom;if(contentBottom>visibleBottom)toggle.scrollIntoView({block:'nearest'});});};host.appendChild(wandSection);
  }
  function renderSelectionInfo(host,subTool){
    const message=document.createElement('div');message.className='tool-options-message selection-tool-options-message';message.textContent=subTool.settingsDescription||'No additional options';host.appendChild(message);
  }
  function renderSelectionOptions(body,group,activeSubTool){
    const host=ensureSelectionOptionsHost(body),definition=activeSubTool&&activeSubTool.selectionSettings;
    if(definition&&typeof definition.renderer==='function')definition.renderer(host,activeSubTool,group);
    else renderSelectionInfo(host,activeSubTool||{});
  }
  function presetSubTools(groupId){
    const source=window._brushPresets?[].concat(_brushPresets.BRUSH_PRESETS||[],_brushPresets.customPresets||[]):[];
    const seen=new Set();return source.filter(preset=>preset&&preset.id&&!seen.has(preset.id)&&seen.add(preset.id)).map(preset=>({
      id:groupId+':'+preset.id,presetId:preset.id,name:preset.name||preset.id,icon:preset.icon||groupId.charAt(0).toUpperCase(),
      activate:()=>{setTool(groupId,groupId==='brush'?'Brush':'Eraser');if(window._brushPresets)_brushPresets.selectPreset(preset.id);},
      settingsDescription:'Uses the existing '+groupId+' preset settings.'
    }));
  }
  function ensurePresetSubTool(group,presetId){
    let subTool=getSubTool(group,group.id+':'+presetId);if(subTool)return subTool;
    subTool={id:group.id+':'+presetId,presetId:presetId,name:presetId,icon:group.icon,groupId:group.id,status:'implemented',activate:()=>{setTool(group.id,group.name);if(window._brushPresets)_brushPresets.selectPreset(presetId);}};
    group.subTools.push(subTool);return subTool;
  }

  registerGroup({id:'brush',name:'Brush',shortcutActionId:'toolBrush',icon:'B',defaultSubToolId:'brush:hard-round',subTools:presetSubTools('brush')});
  registerGroup({id:'eraser',name:'Eraser',shortcutActionId:'toolEraser',icon:'E',defaultSubToolId:'eraser:hard-round',subTools:presetSubTools('eraser')});
  const selectionGroup=registerGroup({id:'selection',name:'Selection',panelTitle:'Selection Sub Tools',shortcutActionId:'toolSelection',icon:'S',panelRenderer:renderSelectionOptions,defaultSubToolId:'rectangle-select',subTools:[
    {id:'rectangle-select',name:'Rectangle Select',icon:'R',selectionSettings:{defaults:{combine:'add',scope:'all'},renderer:renderAreaSelectionSettings},activate:toolActivation('rectangle-select','Rectangle Select'),settingsDescription:'Drag a rectangular selection. Shift adds, Alt subtracts, and Shift+Alt intersects.'},
    {id:'lasso-select',name:'Lasso Select',icon:'L',selectionSettings:{defaults:{combine:'add',scope:'all'},renderer:renderAreaSelectionSettings},activate:toolActivation('lasso','Lasso Select'),settingsDescription:'Drag a freehand closed selection. Shift adds, Alt subtracts, and Shift+Alt intersects.'},
    {id:'ellipse-select',name:'Ellipse Select',icon:'O',selectionSettings:{defaults:{combine:'add',scope:'all'},renderer:renderAreaSelectionSettings},activate:toolActivation('ellipse-select','Ellipse Select'),settingsDescription:'Drag an elliptical selection. Shift constrains a circle; selection modifiers still control add, subtract, and intersect.'},
    Object.assign(placeholder('polyline-select','Polyline Select','P'),{selectionSettings:{defaults:{combine:'add',scope:'all'},renderer:renderAreaSelectionSettings}}),
    Object.assign(placeholder('selection-pen','Selection Pen','P'),{selectionSettings:{defaults:{combine:'add',scope:'all'},renderer:renderAreaSelectionSettings}}),
    Object.assign(placeholder('erase-selection','Erase Selection','E'),{})
  ]});selectionGroup.lastValidSubToolId='lasso-select';
  const smartSelectionGroup=registerGroup({id:'smart-selection',name:'Smart Selection',panelTitle:'Smart Selection',shortcutActionId:'toolSmartSelection',icon:'W',panelRenderer:renderSelectionOptions,defaultSubToolId:'magic-wand',subTools:[
    {id:'magic-wand',name:'Magic Wand',icon:'W',shortcutActionId:'toolSubTool.selection.magic-wand',cursor:'crosshair',selectionSettings:{renderer:renderMagicWandSettings},activate:toolActivation('magic-wand','Magic Wand')},
    {id:'style-select',name:'Style Select',icon:'S',shortcutActionId:'toolSubTool.selection.style-select',selectionSettings:{renderer:renderSelectionInfo},isAvailable:activeLayerSupportsStyleSelect,unavailableLabel:'Smart Raster Only',activate:toolActivation('selection','Style Select'),settingsDescription:'Click a Smart Raster pixel to select its visible style. Click the same point repeatedly to cycle through underlying styles.'}
  ]});
  registerGroup({id:'fill',name:'Fill',shortcutActionId:'toolFill',icon:'F',panelRenderer:renderFillOptions,defaultSubToolId:'bucket-fill',subTools:[
    {id:'bucket-fill',name:'Bucket Fill',icon:'F',activate:toolActivation('fill','Fill')},{id:'lasso-fill',name:'Lasso Fill',icon:'L',activate:toolActivation('lasso-fill','Lasso Fill'),settingsDescription:'Draw a freehand boundary and release to fill it with the current color.'},placeholder('rectangle-fill','Rectangle Fill','R'),placeholder('ellipse-fill','Ellipse Fill','O'),placeholder('polyline-fill','Polyline Fill','P'),placeholder('enclose-fill','Enclose and Fill','E'),placeholder('refer-other-layers','Refer Other Layers','A')
  ]});
  registerGroup({id:'line',name:'Line',shortcutActionId:'toolLine',icon:'L',panelTitle:'Line',panelRenderer:renderLineOptions,defaultSubToolId:'straight-line',subTools:[
    {id:'straight-line',name:'Straight Line',icon:'L',activate:toolActivation('line','Line'),settingsDescription:'Uses the existing line engine and shared brush settings.'},placeholder('polyline','Polyline','P'),placeholder('curve','Curve','C'),placeholder('rectangle-line','Rectangle','R'),placeholder('ellipse-line','Ellipse','O')
  ]});
  registerGroup({id:'eyedropper',name:'Eyedropper',shortcutActionId:'toolEyedropper',icon:'I',defaultSubToolId:'sample-visible-color',subTools:[
    {id:'sample-visible-color',name:'Sample Visible Color',icon:'I',activate:toolActivation('eyedropper','Eyedropper'),settingsDescription:'Samples the visible composited canvas color.'}
  ]});
  registerGroup({id:'transform',name:'Transform',shortcutActionId:'toolTransform',icon:'T',defaultSubToolId:'free-transform',subTools:[
    {id:'free-transform',name:'Free Transform',icon:'F',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(false);})},
    {id:'perspective-transform',name:'Perspective Transform',icon:'P',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(true);})}
  ]});

  bindMainButton('tp-btn-brush','brush');bindMainButton('tp-btn-eraser','eraser');bindMainButton('tp-btn-selection','selection');bindMainButton('tp-btn-smart-selection','smart-selection');bindMainButton('tp-btn-fill','fill');bindMainButton('tp-btn-line','line');bindMainButton('tp-btn-eyedropper','eyedropper');bindMainButton('tp-btn-transform','transform');
  const free=document.getElementById('transform-mode-free'),perspective=document.getElementById('transform-mode-perspective');
  if(free)free.onclick=()=>activateSubTool('transform','free-transform');if(perspective)perspective.onclick=()=>activateSubTool('transform','perspective-transform');
  const grid=document.getElementById('brush-preset-grid');if(grid)grid.addEventListener('click',event=>{const item=event.target.closest('.bp-item');if(!item)return;const group=getGroup(tool==='eraser'?'eraser':'brush');if(group){const subTool=ensurePresetSubTool(group,item.dataset.presetId);group.activeSubToolId=subTool.id;persist();renderSettings();}});
  window.addEventListener('tool-changed',event=>{if(activating)return;const map={brush:'brush',eraser:'eraser',fill:'fill','lasso-fill':'fill',line:'line',eyedropper:'eyedropper',lasso:'selection','rectangle-select':'selection','ellipse-select':'selection','magic-wand':'smart-selection',selection:'smart-selection',transform:'transform'},id=map[event.detail&&event.detail.tool];if(id){activeGroupId=id;syncPanel(getGroup(id));syncActiveButtons();renderSettings();}});
  window.addEventListener('active-artwork-changed',refreshSelectionAvailability);
  window.addEventListener('project-loaded',refreshSelectionAvailability);
  window.addEventListener('layer-type-changed',refreshSelectionAvailability);
  const initial=({brush:'brush',eraser:'eraser',fill:'fill','lasso-fill':'fill',line:'line',eyedropper:'eyedropper',lasso:'selection','rectangle-select':'selection','ellipse-select':'selection','magic-wand':'smart-selection',selection:'smart-selection',transform:'transform'})[typeof tool!=='undefined'?tool:'brush']||'brush';activeGroupId=initial;if(initial==='selection')restoreSelectionToolContext(getSubTool(selectionGroup,selectionGroup.activeSubToolId));syncPanel(getGroup(initial));syncActiveButtons();refreshSelectionAvailability();
  window.SelectionToolSettings={
    get(toolId){return selectionSettingsFor(getSubTool(selectionGroup,toolId)||getSubTool(smartSelectionGroup,toolId));},
    set(toolId,key,value){const subTool=getSubTool(selectionGroup,toolId)||getSubTool(smartSelectionGroup,toolId);if(subTool)updateSelectionSetting(subTool,key,value);},
    modeFromEvent:selectionModeForEvent
  };
  window.ToolGroups={registerGroup,getGroup,getGroups:()=>Array.from(groups.values()),activateGroup,activateSubTool,get activeGroupId(){return activeGroupId;}};
  const responsiveAaControls=new WeakSet();
  const aaLayoutObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(entries=>{
    entries.forEach(entry=>{
      const control=entry.target,children=Array.from(control.children);
      const toggle=children.find(child=>child.classList&&child.classList.contains('tool-aa-toggle'));
      const qualityHost=children.find(child=>child.classList&&(child.classList.contains('tool-aa-quality-row')||child.classList.contains('tool-aa-quality')));
      const select=qualityHost&&(qualityHost.matches('select')?qualityHost:qualityHost.querySelector('select'));
      if(!toggle||!select)return;
      const gap=parseFloat(getComputedStyle(control).columnGap)||0;
      const requiredWidth=Math.ceil(toggle.scrollWidth+select.offsetWidth+gap);
      control.classList.toggle('aa-stacked',control.clientWidth<requiredWidth);
    });
  });
  function observeResponsiveAaControls(root){
    if(!aaLayoutObserver)return;
    const controls=[];if(root.nodeType===1&&root.matches('.tool-aa-controls'))controls.push(root);
    if(root.querySelectorAll)controls.push(...root.querySelectorAll('.tool-aa-controls'));
    controls.forEach(control=>{if(!responsiveAaControls.has(control)){responsiveAaControls.add(control);aaLayoutObserver.observe(control);}});
  }
  observeResponsiveAaControls(document);
  new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(observeResponsiveAaControls))).observe(document.body,{childList:true,subtree:true});  window.dispatchEvent(new CustomEvent('tool-groups-ready'));
})();