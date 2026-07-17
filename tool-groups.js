(function(){
  'use strict';
  const STORAGE_KEY='animate.toolGroups.v1';
  const groups=new Map();
  let activeGroupId=null,activating=false;
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch(_){saved={};}

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
  function ensureGenericBody(){
    const shell=document.getElementById('brush-presets-panel'),wrap=shell&&shell.querySelector('.fp-body-wrap');if(!wrap)return null;
    let body=wrap.querySelector('.fp-body[data-body="tool-group"]');if(body)return body;
    body=document.createElement('div');body.className='fp-body tool-group-body';body.dataset.body='tool-group';body.dataset.spacePan='';
    body.innerHTML='<div class="tool-group-actions"><span class="tool-group-caption"></span><button type="button" class="bp-icon-btn tool-group-settings-button" title="Tool Settings">&#9881;</button></div><div class="tool-group-list"></div>';
    body.querySelector('.tool-group-settings-button').onclick=openSettings;wrap.appendChild(body);return body;
  }
  function setBody(name){
    const shell=document.getElementById('brush-presets-panel');if(!shell)return;
    shell.querySelectorAll('.fp-body').forEach(body=>body.classList.toggle('active',body.dataset.body===name));
  }
  function renderGeneric(group){
    const body=ensureGenericBody();if(!body)return;const list=body.querySelector('.tool-group-list');list.replaceChildren();
    body.querySelector('.tool-group-caption').textContent=group.panelCaption||group.name+' Sub Tools';
    body.querySelectorAll('.tool-group-inline-options').forEach(element=>element.remove());
    group.subTools.forEach(subTool=>{
      const button=document.createElement('button');button.type='button';button.className='tool-group-subtool';button.dataset.subToolId=subTool.id;
      button.classList.toggle('active',subTool.id===group.activeSubToolId);button.disabled=subTool.status!=='implemented';
      const icon=document.createElement('span');icon.className='tool-group-subtool-icon';icon.textContent=subTool.icon||group.icon||'';
      const label=document.createElement('span');label.className='tool-group-subtool-label';label.textContent=subTool.name;
      button.append(icon,label);if(button.disabled){const soon=document.createElement('span');soon.className='tool-group-coming-soon';soon.textContent='Coming Soon';button.appendChild(soon);}
      button.onclick=()=>activateSubTool(group.id,subTool.id);list.appendChild(button);
    });
    if(typeof group.panelRenderer==='function')group.panelRenderer(body,group);
  }
  function syncPanel(group){
    const shell=document.getElementById('brush-presets-panel');if(!shell)return;
    const name=shell.querySelector('.fp-name');if(name)name.textContent=group.panelTitle||(group.id==='brush'||group.id==='eraser'?group.name+' Presets':group.name+' Sub Tools');
    if(group.id==='brush'||group.id==='eraser'){
      setBody('brush-presets');if(window._brushPresets)_brushPresets.switchTab(group.id);
    }else if(group.id==='transform')setBody('transform');
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
  function openSettings(){renderSettings();const modal=document.getElementById('tool-settings-modal-overlay');if(modal)modal.classList.add('visible');}
  function activateSubTool(groupId,subToolId,options){
    const group=getGroup(groupId),subTool=getSubTool(group,subToolId);if(!group||!subTool||subTool.status!=='implemented')return false;
    activeGroupId=groupId;group.activeSubToolId=subTool.id;persist();
    activating=true;try{if(typeof subTool.activate==='function')subTool.activate(options||{});}finally{activating=false;}
    // setTool() still contains the legacy Brush/Transform body switch. Run
    // the registry's authoritative switch afterwards so exactly one dock
    // body remains active for Fill and Selection as well.
    syncPanel(group);renderSettings();syncActiveButtons();return true;
  }
  function activateGroup(groupId){const group=getGroup(groupId);return !!group&&activateSubTool(groupId,group.activeSubToolId,{fromGroup:true});}
  function syncActiveButtons(){document.querySelectorAll('[data-tool-group-id]').forEach(button=>button.classList.toggle('active',button.dataset.toolGroupId===activeGroupId));}
  function bindMainButton(id,groupId){const button=document.getElementById(id);if(!button)return;button.dataset.toolGroupId=groupId;button.onclick=()=>activateGroup(groupId);}
  function toolActivation(toolId,label,after){return()=>{setTool(toolId,label);if(after)after();};}
  function placeholder(id,name,icon){return{id,name,icon,status:'coming-soon'};}

  function renderLineOptions(body){
    const section=document.createElement('div');section.className='tool-group-inline-options';
    const title=document.createElement('div');title.className='tf-panel-label';title.textContent='Line Options';section.appendChild(title);
    function rangeRow(label,min,max,step,value,onInput){const row=document.createElement('label');row.className='tool-group-option-row';const text=document.createElement('span');text.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;const output=document.createElement('span');output.className='tool-group-option-value';output.textContent=value;input.oninput=()=>{output.textContent=input.value;onInput(+input.value);};row.append(text,input,output);section.appendChild(row);}
    rangeRow('Width / Size',1,2000,.1,toolSizes.line||6,value=>{toolSizes.line=value;if(tool==='line'){szSlider.value=value;if(typeof refreshSizeUI==='function')refreshSizeUI();}});
    rangeRow('Opacity',1,100,1,Math.round(brushOpacity*100),value=>{brushOpacity=value/100;const existing=document.getElementById('ts-opacity');if(existing){existing.value=value;existing.dispatchEvent(new Event('input',{bubbles:true}));}});
    const aaRow=document.createElement('label');aaRow.className='tool-group-option-row compact';const aa=document.createElement('input');aa.type='checkbox';aa.checked=!!brushAA;const aaText=document.createElement('span');aaText.textContent='Anti-aliasing';aa.onchange=()=>{const button=document.getElementById('btn-aa');if(button&&aa.checked!==!!brushAA)button.click();};aaRow.append(aa,aaText);section.appendChild(aaRow);
    const colorRow=document.createElement('div');colorRow.className='tool-group-option-row compact';const colorPreview=document.createElement('span');colorPreview.className='tool-group-line-color';colorPreview.style.background=typeof color==='string'?color:'#000';const colorText=document.createElement('span');colorText.textContent='Current Color  '+(typeof color==='string'?color:'');colorRow.append(colorPreview,colorText);section.appendChild(colorRow);
    body.appendChild(section);
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

  registerGroup({id:'brush',name:'Brush',icon:'B',defaultSubToolId:'brush:hard-round',subTools:presetSubTools('brush')});
  registerGroup({id:'eraser',name:'Eraser',icon:'E',defaultSubToolId:'eraser:hard-round',subTools:presetSubTools('eraser')});
  registerGroup({id:'selection',name:'Selection',icon:'S',defaultSubToolId:'select-linked',subTools:[
    {id:'select-linked',name:'Select by Style',icon:'S',activate:toolActivation('selection','Select by Style'),settingsDescription:'Use the configured Select Linked Pixels modifier on a Smart Raster swatch or canvas pixel.'},
    placeholder('rectangle-select','Rectangle Select','R'),{id:'lasso-select',name:'Lasso Select',icon:'L',activate:toolActivation('lasso','Lasso Select'),settingsDescription:'Drag a freehand closed selection. Shift adds, Alt subtracts, and Shift+Alt intersects.'},
    placeholder('ellipse-select','Ellipse Select','O'),placeholder('polyline-select','Polyline Select','P'),placeholder('magic-wand','Magic Wand','W'),placeholder('selection-pen','Selection Pen','P'),placeholder('erase-selection','Erase Selection','E')
  ]});
  registerGroup({id:'fill',name:'Fill',icon:'F',defaultSubToolId:'bucket-fill',subTools:[
    {id:'bucket-fill',name:'Bucket Fill',icon:'F',activate:toolActivation('fill','Fill')},placeholder('lasso-fill','Lasso Fill','L'),placeholder('rectangle-fill','Rectangle Fill','R'),placeholder('ellipse-fill','Ellipse Fill','O'),placeholder('polyline-fill','Polyline Fill','P'),placeholder('enclose-fill','Enclose and Fill','E'),placeholder('refer-other-layers','Refer Other Layers','A')
  ]});
  registerGroup({id:'line',name:'Line',icon:'L',panelTitle:'Line',panelCaption:'Line Modes',panelRenderer:renderLineOptions,defaultSubToolId:'straight-line',subTools:[
    {id:'straight-line',name:'Straight Line',icon:'L',activate:toolActivation('line','Line'),settingsDescription:'Uses the existing line engine and shared brush settings.'},placeholder('polyline','Polyline','P'),placeholder('curve','Curve','C'),placeholder('rectangle-line','Rectangle','R'),placeholder('ellipse-line','Ellipse','O')
  ]});
  registerGroup({id:'transform',name:'Transform',icon:'T',defaultSubToolId:'free-transform',subTools:[
    {id:'free-transform',name:'Free Transform',icon:'F',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(false);})},
    {id:'perspective-transform',name:'Perspective Transform',icon:'P',activate:toolActivation('transform','Transform',()=>{if(typeof _tfSetPerspective==='function')_tfSetPerspective(true);})}
  ]});

  bindMainButton('tp-btn-brush','brush');bindMainButton('tp-btn-eraser','eraser');bindMainButton('tp-btn-selection','selection');bindMainButton('tp-btn-fill','fill');bindMainButton('tp-btn-line','line');bindMainButton('tp-btn-transform','transform');
  const free=document.getElementById('transform-mode-free'),perspective=document.getElementById('transform-mode-perspective');
  if(free)free.onclick=()=>activateSubTool('transform','free-transform');if(perspective)perspective.onclick=()=>activateSubTool('transform','perspective-transform');
  const grid=document.getElementById('brush-preset-grid');if(grid)grid.addEventListener('click',event=>{const item=event.target.closest('.bp-item');if(!item)return;const group=getGroup(tool==='eraser'?'eraser':'brush');if(group){const subTool=ensurePresetSubTool(group,item.dataset.presetId);group.activeSubToolId=subTool.id;persist();renderSettings();}});
  window.addEventListener('tool-changed',event=>{if(activating)return;const map={brush:'brush',eraser:'eraser',fill:'fill',line:'line',lasso:'selection',selection:'selection',transform:'transform'},id=map[event.detail&&event.detail.tool];if(id){activeGroupId=id;syncPanel(getGroup(id));syncActiveButtons();renderSettings();}});
  const initial=({brush:'brush',eraser:'eraser',fill:'fill',line:'line',lasso:'selection',selection:'selection',transform:'transform'})[typeof tool!=='undefined'?tool:'brush']||'brush';activeGroupId=initial;syncPanel(getGroup(initial));syncActiveButtons();
  window.ToolGroups={registerGroup,getGroup,activateGroup,activateSubTool,get activeGroupId(){return activeGroupId;}};
})();
