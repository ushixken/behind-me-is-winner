(function(){
  'use strict';
  const STORAGE_KEY='animate.toolGroups.v1';
  const DRAWER_STORAGE_KEY='animate.toolGroupDrawers.v1';
  const groups=new Map();
  let activeGroupId=null,activating=false;
  let saved={},drawerSaved={};
  try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch(_){saved={};}
  try{drawerSaved=JSON.parse(localStorage.getItem(DRAWER_STORAGE_KEY)||'{}')||{};}catch(_){drawerSaved={};}

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
  function drawerState(groupId){
    const raw=drawerSaved[groupId]||{};
    return {expanded:raw.expanded===true,height:Number.isFinite(+raw.height)?Math.max(80,Math.min(500,+raw.height)):150};
  }
  function saveDrawerState(groupId,state){drawerSaved[groupId]={expanded:!!state.expanded,height:Math.round(state.height)};localStorage.setItem(DRAWER_STORAGE_KEY,JSON.stringify(drawerSaved));}
  function applyDrawerState(body,group){
    const drawer=body.querySelector('.tool-options-drawer');if(!drawer)return;
    const state=drawerState(group.id),header=drawer.querySelector('.tool-options-drawer-header'),chevron=drawer.querySelector('.tool-options-drawer-chevron');
    drawer.dataset.groupId=group.id;drawer.classList.toggle('expanded',state.expanded);drawer.style.height=state.expanded?state.height+'px':'';
    header.setAttribute('aria-expanded',String(state.expanded));if(chevron)chevron.textContent=state.expanded?'\u25be':'\u25b4';
  }
  function configureOptionsDrawer(body,group){
    const drawer=body.querySelector('.tool-options-drawer'),header=drawer&&drawer.querySelector('.tool-options-drawer-header');if(!drawer||!header)return;
    const label=drawer.querySelector('.tool-options-drawer-label');if(label)label.textContent=(group.name+' Options').toUpperCase();
    applyDrawerState(body,group);
    if(header.dataset.drawerBound)return;header.dataset.drawerBound='true';
    let drag=null;
    const finish=(event,cancelled)=>{if(!drag||event.pointerId!==drag.pointerId)return;const wasDragging=drag.dragging,groupId=drawer.dataset.groupId,current=drawerState(groupId);drag=null;if(header.hasPointerCapture&&header.hasPointerCapture(event.pointerId))header.releasePointerCapture(event.pointerId);document.body.classList.remove('tool-options-resizing');if(cancelled){const active=getGroup(groupId);if(active)applyDrawerState(body,active);return;}if(wasDragging){const height=parseFloat(drawer.style.height)||current.height;if(height<64){saveDrawerState(groupId,{expanded:false,height:current.height});}else saveDrawerState(groupId,{expanded:true,height});}else saveDrawerState(groupId,{expanded:!drawer.classList.contains('expanded'),height:current.height});const active=getGroup(groupId);if(active)applyDrawerState(body,active);};
    header.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;const state=drawerState(drawer.dataset.groupId);drag={pointerId:event.pointerId,startY:event.clientY,startHeight:drawer.classList.contains('expanded')?drawer.getBoundingClientRect().height:header.getBoundingClientRect().height,dragging:false,state};header.setPointerCapture(event.pointerId);});
    header.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const delta=drag.startY-event.clientY;if(!drag.dragging&&Math.abs(delta)<4)return;drag.dragging=true;event.preventDefault();document.body.classList.add('tool-options-resizing');const max=Math.max(80,body.clientHeight-96),height=Math.max(28,Math.min(max,drag.startHeight+delta));drawer.classList.add('expanded');drawer.style.height=height+'px';header.setAttribute('aria-expanded','true');const chevron=drawer.querySelector('.tool-options-drawer-chevron');if(chevron)chevron.textContent='\u25be';});
    header.addEventListener('pointerup',event=>finish(event,false));header.addEventListener('pointercancel',event=>finish(event,true));header.addEventListener('lostpointercapture',event=>{if(drag&&event.pointerId===drag.pointerId)finish(event,true);});
    header.addEventListener('keydown',event=>{if(event.key!=='Enter'&&event.key!==' ')return;event.preventDefault();const groupId=drawer.dataset.groupId,state=drawerState(groupId);saveDrawerState(groupId,{expanded:!drawer.classList.contains('expanded'),height:state.height});const active=getGroup(groupId);if(active)applyDrawerState(body,active);});
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
    const optionsContent=body.querySelector('.tool-options-drawer-content');if(optionsContent)optionsContent.replaceChildren();
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
      setBody('brush-presets');if(window._brushPresets)_brushPresets.switchTab(group.id);
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
    if(groupId==='selection'&&subTool.id!=='style-select')group.lastValidSubToolId=subTool.id;
    activeGroupId=groupId;group.activeSubToolId=subTool.id;persist();
    activating=true;try{if(typeof subTool.activate==='function')subTool.activate(options||{});}finally{activating=false;}
    // setTool() still contains the legacy Brush/Transform body switch. Run
    // the registry's authoritative switch afterwards so exactly one dock
    // body remains active for Fill and Selection as well.
    syncPanel(group);renderSettings();syncActiveButtons();return true;
  }
  function activateGroup(groupId){const group=getGroup(groupId);if(!group)return false;let subTool=getSubTool(group,group.activeSubToolId);if(!subToolIsAvailable(subTool)&&groupId==='selection')subTool=selectionFallback(group);return !!subTool&&activateSubTool(groupId,subTool.id,{fromGroup:true});}
  function refreshSelectionAvailability(){
    const group=getGroup('selection');if(!group)return;
    const current=getSubTool(group,group.activeSubToolId);
    if(activeGroupId==='selection'&&!subToolIsAvailable(current)){
      const fallback=selectionFallback(group);if(fallback){activateSubTool('selection',fallback.id,{contextFallback:true});return;}
    }
    if(activeGroupId==='selection'){renderGeneric(group);setBody('tool-group');renderSettings();}
  }
  function syncActiveButtons(){document.querySelectorAll('[data-tool-group-id]').forEach(button=>button.classList.toggle('active',button.dataset.toolGroupId===activeGroupId));}
  function bindMainButton(id,groupId){const button=document.getElementById(id);if(!button)return;button.dataset.toolGroupId=groupId;button.onclick=()=>activateGroup(groupId);}
  function toolActivation(toolId,label,after){return()=>{setTool(toolId,label);if(after)after();};}
  function placeholder(id,name,icon){return{id,name,icon,status:'coming-soon'};}

  function renderLineOptions(body){
    const section=document.createElement('div');section.className='tool-group-inline-options';
    function rangeRow(label,min,max,step,value,onInput){const row=document.createElement('label');row.className='tool-group-option-row';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const output=document.createElement('span');output.className='tool-group-option-value';output.textContent=value;input.oninput=()=>{output.textContent=input.value;onInput(+input.value);};row.append(text,input,output);section.appendChild(row);}
    rangeRow('Width / Size',1,2000,.1,toolSizes.line||6,value=>{toolSizes.line=value;if(tool==='line'){szSlider.value=value;if(typeof refreshSizeUI==='function')refreshSizeUI();}});
    rangeRow('Opacity',1,100,1,Math.round(brushOpacity*100),value=>{brushOpacity=value/100;const existing=document.getElementById('ts-opacity');if(existing){existing.value=value;existing.dispatchEvent(new Event('input',{bubbles:true}));}});
    const aaRow=document.createElement('label');aaRow.className='tool-group-option-row compact';const aa=document.createElement('input');aa.type='checkbox';aa.checked=!!brushAA;const aaText=document.createElement('span');aaText.textContent='Anti-aliasing';aa.onchange=()=>{const button=document.getElementById('btn-aa');if(button&&aa.checked!==!!brushAA)button.click();};aaRow.append(aa,aaText);section.appendChild(aaRow);
    const colorRow=document.createElement('div');colorRow.className='tool-group-option-row compact';const colorPreview=document.createElement('span');colorPreview.className='tool-group-line-color';colorPreview.style.background=typeof color==='string'?color:'#000';const colorText=document.createElement('span');colorText.textContent='Current Color  '+(typeof color==='string'?color:'');colorRow.append(colorPreview,colorText);section.appendChild(colorRow);
    body.appendChild(section);
  }

  function renderSelectionOptions(body,group,activeSubTool){
    const layout=document.createElement('div');layout.className='tool-group-inline-options selection-options-layout';
    const scopeSection=document.createElement('section');scopeSection.className='selection-option-section';
    const scopeLabel=document.createElement('div');scopeLabel.className='selection-option-label';scopeLabel.textContent='Selection Scope';scopeSection.appendChild(scopeLabel);
    const segments=document.createElement('div');segments.className='ts-pill-row selection-scope-segments';segments.setAttribute('role','group');segments.setAttribute('aria-label','Selection Scope');
    [['all','All'],['inside','Inside'],['outside','Outside']].forEach(([mode,text])=>{const button=document.createElement('button');button.type='button';button.className='ts-pill';button.textContent=text;const active=(window.SelectionScope?SelectionScope.get():'all')===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.onclick=()=>{if(window.SelectionScope)SelectionScope.set(mode);segments.querySelectorAll('.ts-pill').forEach(item=>{const selected=item===button;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});};segments.appendChild(button);});
    scopeSection.appendChild(segments);layout.appendChild(scopeSection);
    if(activeSubTool&&activeSubTool.id==='magic-wand'&&window.MagicWandSelection){
      const settings=MagicWandSelection.getSettings(),wandSection=document.createElement('section');wandSection.className='selection-option-section magic-wand-option-section';
      const heading=document.createElement('div');heading.className='selection-options-subheading';heading.textContent='Magic Wand Options';wandSection.appendChild(heading);
      function segmented(labelText,items,key,className){const field=document.createElement('div');field.className='selection-option-field';const label=document.createElement('div');label.className='selection-option-label';label.textContent=labelText;const row=document.createElement('div');row.className='ts-pill-row '+(className||'');row.setAttribute('role','group');row.setAttribute('aria-label',labelText);items.forEach(([value,text])=>{const button=document.createElement('button');button.type='button';button.className='ts-pill';button.textContent=text;const active=settings[key]===value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.onclick=()=>{MagicWandSelection.updateSettings({[key]:value});row.querySelectorAll('.ts-pill').forEach(item=>{const selected=item===button;item.classList.toggle('active',selected);item.setAttribute('aria-pressed',String(selected));});};row.appendChild(button);});field.append(label,row);wandSection.appendChild(field);return row;}
      function rangeField(labelText,key,min,max,id){const field=document.createElement('div');field.className='selection-option-field';const label=document.createElement('label');label.className='selection-option-label';label.textContent=labelText;label.htmlFor=id;const controls=document.createElement('div');controls.className='magic-wand-range-controls';const range=document.createElement('input');range.type='range';range.className='ts-range';range.min=min;range.max=max;range.step=1;range.value=settings[key];range.id=id;const value=document.createElement('output');value.className='ts-num magic-wand-range-value';value.setAttribute('for',id);value.textContent=settings[key];range.oninput=()=>{value.textContent=range.value;MagicWandSelection.updateSettings({[key]:+range.value});};controls.append(range,value);field.append(label,controls);wandSection.appendChild(field);}
      function checkbox(labelText,key,disabled,status){const row=document.createElement('label');row.className='magic-wand-checkbox-row'+(disabled?' disabled':'');const input=document.createElement('input');input.type='checkbox';input.className='ts-check';input.checked=!!settings[key];input.disabled=!!disabled;input.onchange=()=>MagicWandSelection.updateSettings({[key]:input.checked});const text=document.createElement('span');text.textContent=labelText;row.append(input,text);if(status){const badge=document.createElement('span');badge.className='magic-wand-option-status';badge.textContent=status;row.appendChild(badge);}wandSection.appendChild(row);return input;}
      segmented('Selection Combine',[['replace','Replace'],['add','Add'],['subtract','Subtract'],['intersect','Intersect']],'combine','magic-wand-combine');
      rangeField('Color Range','tolerance',0,255,'magic-wand-color-range');
      checkbox('Connected Region Only','contiguous');
      rangeField('Edge Expansion','edgeExpansion',-20,20,'magic-wand-edge-expansion');
      checkbox('Gap Bridging','gapBridging');
      segmented('Gap Width',[[1,'1'],[2,'2'],[3,'3'],[4,'4'],[5,'5+']],'gapWidth','magic-wand-gap-width');
      const sampleField=document.createElement('label');sampleField.className='selection-option-field';const sampleLabel=document.createElement('span');sampleLabel.className='selection-option-label';sampleLabel.textContent='Sampling Source';const sample=document.createElement('select');sample.className='ts-select magic-wand-sample-select';[['current','Current Layer'],['all','All Visible Layers']].forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;sample.appendChild(option);});sample.value=settings.sample;sample.onchange=()=>MagicWandSelection.updateSettings({sample:sample.value});sampleField.append(sampleLabel,sample);wandSection.appendChild(sampleField);
      checkbox('Include Transparency','includeAlpha');checkbox('Smooth Boundary','antiAlias');checkbox('Sample Referenced Layers','referencedLayers',true,'Coming Soon');layout.appendChild(wandSection);
    }
    body.appendChild(layout);
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
  const selectionGroup=registerGroup({id:'selection',name:'Selection',shortcutActionId:'toolSelection',icon:'S',panelRenderer:renderSelectionOptions,defaultSubToolId:'style-select',subTools:[
    {id:'rectangle-select',name:'Rectangle Select',icon:'R',section:'Selection Area',activate:toolActivation('rectangle-select','Rectangle Select'),settingsDescription:'Drag a rectangular selection. Shift adds, Alt subtracts, and Shift+Alt intersects.'},
    {id:'lasso-select',name:'Lasso Select',icon:'L',section:'Selection Area',activate:toolActivation('lasso','Lasso Select'),settingsDescription:'Drag a freehand closed selection. Shift adds, Alt subtracts, and Shift+Alt intersects.'},
    {id:'ellipse-select',name:'Ellipse Select',icon:'O',section:'Selection Area',activate:toolActivation('ellipse-select','Ellipse Select'),settingsDescription:'Drag an elliptical selection. Shift constrains a circle; selection modifiers still control add, subtract, and intersect.'},Object.assign(placeholder('polyline-select','Polyline Select','P'),{section:'Selection Area'}),
    {id:'magic-wand',name:'Magic Wand',icon:'W',section:'Smart Selection',cursor:'crosshair',activate:toolActivation('magic-wand','Magic Wand')},
    {id:'style-select',name:'Style Select',icon:'S',section:'Smart Selection',isAvailable:activeLayerSupportsStyleSelect,unavailableLabel:'Smart Raster Only',activate:toolActivation('selection','Style Select'),settingsDescription:'Use the configured Select Linked Pixels modifier on a Smart Raster swatch or canvas pixel.'},
    Object.assign(placeholder('selection-pen','Selection Pen','P'),{section:'Selection Painting'}),Object.assign(placeholder('erase-selection','Erase Selection','E'),{section:'Selection Painting'})
  ]});selectionGroup.lastValidSubToolId='lasso-select';
  registerGroup({id:'fill',name:'Fill',shortcutActionId:'toolFill',icon:'F',defaultSubToolId:'bucket-fill',subTools:[
    {id:'bucket-fill',name:'Bucket Fill',icon:'F',activate:toolActivation('fill','Fill')},placeholder('lasso-fill','Lasso Fill','L'),placeholder('rectangle-fill','Rectangle Fill','R'),placeholder('ellipse-fill','Ellipse Fill','O'),placeholder('polyline-fill','Polyline Fill','P'),placeholder('enclose-fill','Enclose and Fill','E'),placeholder('refer-other-layers','Refer Other Layers','A')
  ]});
  registerGroup({id:'line',name:'Line',shortcutActionId:'toolLine',icon:'L',panelTitle:'Line',panelRenderer:renderLineOptions,defaultSubToolId:'straight-line',subTools:[
    {id:'straight-line',name:'Straight Line',icon:'L',activate:toolActivation('line','Line'),settingsDescription:'Uses the existing line engine and shared brush settings.'},placeholder('polyline','Polyline','P'),placeholder('curve','Curve','C'),placeholder('rectangle-line','Rectangle','R'),placeholder('ellipse-line','Ellipse','O')
  ]});
  registerGroup({id:'transform',name:'Transform',shortcutActionId:'toolTransform',icon:'T',defaultSubToolId:'free-transform',subTools:[
    {id:'free-transform',name:'Free Transform',icon:'F',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(false);})},
    {id:'perspective-transform',name:'Perspective Transform',icon:'P',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(true);})}
  ]});

  bindMainButton('tp-btn-brush','brush');bindMainButton('tp-btn-eraser','eraser');bindMainButton('tp-btn-selection','selection');bindMainButton('tp-btn-fill','fill');bindMainButton('tp-btn-line','line');bindMainButton('tp-btn-transform','transform');
  const free=document.getElementById('transform-mode-free'),perspective=document.getElementById('transform-mode-perspective');
  if(free)free.onclick=()=>activateSubTool('transform','free-transform');if(perspective)perspective.onclick=()=>activateSubTool('transform','perspective-transform');
  const grid=document.getElementById('brush-preset-grid');if(grid)grid.addEventListener('click',event=>{const item=event.target.closest('.bp-item');if(!item)return;const group=getGroup(tool==='eraser'?'eraser':'brush');if(group){const subTool=ensurePresetSubTool(group,item.dataset.presetId);group.activeSubToolId=subTool.id;persist();renderSettings();}});
  window.addEventListener('tool-changed',event=>{if(activating)return;const map={brush:'brush',eraser:'eraser',fill:'fill',line:'line',lasso:'selection','rectangle-select':'selection','ellipse-select':'selection',selection:'selection',transform:'transform'},id=map[event.detail&&event.detail.tool];if(id){activeGroupId=id;syncPanel(getGroup(id));syncActiveButtons();renderSettings();}});
  window.addEventListener('active-artwork-changed',refreshSelectionAvailability);
  window.addEventListener('project-loaded',refreshSelectionAvailability);
  window.addEventListener('layer-type-changed',refreshSelectionAvailability);
  const initial=({brush:'brush',eraser:'eraser',fill:'fill',line:'line',lasso:'selection','rectangle-select':'selection','ellipse-select':'selection',selection:'selection',transform:'transform'})[typeof tool!=='undefined'?tool:'brush']||'brush';activeGroupId=initial;syncPanel(getGroup(initial));syncActiveButtons();refreshSelectionAvailability();
  window.ToolGroups={registerGroup,getGroup,getGroups:()=>Array.from(groups.values()),activateGroup,activateSubTool,get activeGroupId(){return activeGroupId;}};
  window.dispatchEvent(new CustomEvent('tool-groups-ready'));
})();
