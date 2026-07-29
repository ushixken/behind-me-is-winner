(function(){
  'use strict';

  const FORMATS={
    png:{label:'PNG',single:true,animation:true,alpha:true,builtIn:true},
    jpg:{label:'JPG',single:true,animation:true,alpha:false,builtIn:true},
    gif:{label:'GIF',single:false,animation:true,alpha:false,builtIn:false},
    webm:{label:'WebM',single:false,animation:true,alpha:true,builtIn:true},
    mp4:{label:'MP4',single:false,animation:true,alpha:false,builtIn:true}
  };
  let root=null,previewFrame=0,previewPlaying=false,previewTimer=0,cancelRequested=false,renderRequest=0;

  const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const cameraActive=()=>!!(window.CameraSystem&&CameraSystem.value&&CameraSystem.value.enabled);
  const extensionFor=format=>format==='jpg'?'jpg':format;
  const stripExtension=name=>name.replace(/\.(png|jpe?g|gif|webm|mp4)$/i,'');
  const filenameFor=(name,format)=>stripExtension(name||'animation')+'.'+extensionFor(format);
  const mediaMime=format=>{
    if(typeof MediaRecorder==='undefined'||typeof MediaRecorder.isTypeSupported!=='function')return '';
    const candidates=format==='mp4'
      ?['video/mp4;codecs=avc1.42E01E','video/mp4']
      :['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
    return candidates.find(type=>MediaRecorder.isTypeSupported(type))||'';
  };

  function canvasBlob(canvas,type,quality){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The frame encoder returned no data.')),type,quality));
  }
  function download(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function drawingForLayer(layerIndex,frame){
    const held=typeof getHeldKey==='function'?getHeldKey(layerIndex,frame):null;
    if(!held)return null;
    const layer=layers[layerIndex],frameKey=Object.keys(layer.frames||{}).find(key=>layer.frames[key]===held);
    const extended=frameKey==null||typeof getExtendedLayerFrame!=='function'?null:getExtendedLayerFrame(layerIndex,frameKey);
    return extended?{canvas:extended.canvas,x:extended.x,y:extended.y}:{canvas:held,x:0,y:0};
  }
  function renderArtworkFrame(frame,target){
    if(target.width!==CW)target.width=CW;if(target.height!==CH)target.height=CH;
    const context=target.getContext('2d');context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,CW,CH);
    for(let index=0;index<layers.length;index++){
      const layer=layers[index];
      if(!layer||!layer.visible||(typeof _layerGroupChainVisible==='function'&&!_layerGroupChainVisible(layer)))continue;
      const drawing=drawingForLayer(index,frame);if(!drawing)continue;
      context.save();
      context.globalAlpha=(layer.opacity==null?1:layer.opacity)*(typeof _layerGroupChainOpacity==='function'?_layerGroupChainOpacity(layer):1);
      context.drawImage(drawing.canvas,drawing.x,drawing.y);
      context.restore();
    }
    return target;
  }
  function settings(){
    const format=root.querySelector('#export-format').value,source=root.querySelector('#export-source').value;
    const single=root.querySelector('#export-type').value==='single';
    const range=root.querySelector('#export-range').value;
    const start=single?curFrame:range==='work'?rangeStart:(range==='custom'?Math.round(number(root.querySelector('#export-start').value,1))-1:0);
    const end=single?curFrame:range==='work'?rangeEnd:(range==='custom'?Math.round(number(root.querySelector('#export-end').value,TOTAL))-1:TOTAL-1);
    return{
      filename:stripExtension(root.querySelector('#export-filename').value.trim()),format,source,single,
      width:Math.round(number(root.querySelector('#export-width').value,CW)),
      height:Math.round(number(root.querySelector('#export-height').value,CH)),
      start:clamp(start,0,TOTAL-1),end:clamp(end,0,TOTAL-1),
      fps:root.querySelector('#export-fps-mode').value==='custom'?clamp(number(root.querySelector('#export-fps').value,MAX_FPS),1,120):MAX_FPS,
      background:'project',
      solid:bgColor==='transparent'?'#ffffff':bgColor,
      quality:clamp(number(root.querySelector('#export-quality').value,90),1,100)/100,
      numbering:root.querySelector('#export-numbering').value,
      loop:root.querySelector('#export-loop').checked
    };
  }
  function sourceSize(source){
    const camera=cameraActive()?CameraSystem.value:null;
    return source==='camera'&&camera?{width:camera.output.width,height:camera.output.height}:{width:CW,height:CH};
  }
  function backgroundColor(value){
    if(value.background==='transparent')return'transparent';
    if(value.background==='solid')return value.solid;
    return bgColor==='transparent'?'#ffffff':bgColor;
  }
  function renderFrame(frame,value,target){
    const artwork=document.createElement('canvas');renderArtworkFrame(frame,artwork);
    const native=document.createElement('canvas');
    if(value.source==='camera'&&cameraActive()){
      const evaluated=typeof CameraSystem.evaluateSnapshotAt==='function'?CameraSystem.evaluateSnapshotAt(frame):CameraSystem.value;
      CameraSystem.renderCameraOutput({frame,camera:evaluated,source:artwork,target:native,background:backgroundColor(value),includeEditorOverlays:false});
    }else{
      native.width=CW;native.height=CH;const context=native.getContext('2d');
      const background=backgroundColor(value);if(background!=='transparent'){context.fillStyle=background;context.fillRect(0,0,CW,CH);}
      context.drawImage(artwork,0,0);
    }
    if(target.width!==value.width)target.width=value.width;if(target.height!==value.height)target.height=value.height;
    const context=target.getContext('2d');context.clearRect(0,0,target.width,target.height);
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(native,0,0,target.width,target.height);
    return target;
  }
  function encoderAvailability(format,value){
    if(format==='png'||format==='jpg'){
      const sequence=!!value&&!value.single;
      return sequence&&typeof JSZip==='undefined'
        ?{available:false,builtIn:true,reason:'ZIP support is unavailable in this build.'}
        :{available:true,builtIn:true,reason:''};
    }
    if(format==='gif'){
      const encoder=window.ExportEncoders&&window.ExportEncoders.gif;
      return typeof encoder?.encode==='function'
        ?{available:true,builtIn:false,reason:''}
        :{available:false,builtIn:false,reason:'GIF encoder is not installed.'};
    }
    if(format==='webm'){
      const mime=mediaMime('webm');
      return mime?{available:true,builtIn:true,mime,reason:''}:{available:false,builtIn:true,mime:'',reason:'This browser does not provide a WebM encoder.'};
    }
    if(format==='mp4'){
      const mime=mediaMime('mp4');
      return mime?{available:true,builtIn:true,mime,reason:''}:{available:false,builtIn:true,mime:'',reason:'A real MP4 encoder is not available in this browser.'};
    }
    return{available:false,builtIn:false,reason:'No encoder is available for this format.'};
  }
  function encoderStatuses(value){
    return Object.fromEntries(Object.keys(FORMATS).map(format=>[format,encoderAvailability(format,value&&Object.assign({},value,{format}))]));
  }
  function encoderStatus(value){return encoderAvailability(value.format,value).reason;}
  function validate(value){
    return !!value.filename&&value.width>0&&value.height>0&&value.width<=16384&&value.height<=16384&&value.start<=value.end&&!encoderStatus(value);
  }
  function requestPreview(){
    cancelAnimationFrame(renderRequest);renderRequest=requestAnimationFrame(updatePreview);
  }
  function updatePreview(){
    renderRequest=0;if(!root||!root.classList.contains('visible'))return;
    const value=settings(),canvas=root.querySelector('#export-preview-canvas');
    previewFrame=clamp(previewFrame,value.start,value.end);renderFrame(previewFrame,value,canvas);
    root.querySelector('#export-preview-frame').textContent='Frame '+(previewFrame+1);
    root.querySelector('#export-preview-info').textContent=value.width+' × '+value.height+' · '+FORMATS[value.format].label+' · '+(value.single?'Frame '+(value.start+1):'Frames '+(value.start+1)+'–'+(value.end+1));
    const slider=root.querySelector('#export-preview-slider');slider.min=value.start;slider.max=value.end;slider.value=previewFrame;
    const availability=encoderAvailability(value.format,value),statusNode=root.querySelector('#export-encoder-status');
    statusNode.textContent=availability.reason;statusNode.dataset.state=availability.available?'available':'unavailable';
    root.querySelector('#export-submit').disabled=!validate(value);
  }
  function syncResolution(reset){
    const value=settings(),size=sourceSize(value.source),preset=root.querySelector('#export-resolution').value;
    let width=size.width,height=size.height;
    if(preset!=='source'&&preset!=='custom'){[width,height]=preset.split('x').map(Number);}
    if(reset||preset!=='custom'){root.querySelector('#export-width').value=width;root.querySelector('#export-height').value=height;}
    root.querySelector('.export-dimensions').dataset.aspect=String(width/height);
  }
  function syncNumberingLabel(){
    const option=root.querySelector('#export-numbering option[value="filename_0001"]');
    if(option)option.textContent=stripExtension(root.querySelector('#export-filename').value.trim())+'_0001';
  }
  function syncUI(resetResolution){
    const format=root.querySelector('#export-format').value,meta=FORMATS[format],type=root.querySelector('#export-type');
    if((type.value==='single'&&!meta.single)||(type.value==='animation'&&!meta.animation))type.value=meta.single?'single':'animation';
    Array.from(type.options).forEach(option=>option.disabled=(option.value==='single'&&!meta.single)||(option.value==='animation'&&!meta.animation));
    const animation=type.value==='animation',range=root.querySelector('#export-range').value,customResolution=root.querySelector('#export-resolution').value==='custom',customFps=root.querySelector('#export-fps-mode').value==='custom';
    if(range==='entire'){root.querySelector('#export-start').value=1;root.querySelector('#export-end').value=TOTAL;}
    else if(range==='work'){root.querySelector('#export-start').value=rangeStart+1;root.querySelector('#export-end').value=rangeEnd+1;}
    if(!customFps)root.querySelector('#export-fps').value=MAX_FPS;
    root.querySelector('#export-animation-fields').hidden=!animation;root.querySelector('#export-current-frame').hidden=animation;
    root.querySelector('#export-current-frame').textContent='Current Frame: '+(curFrame+1);
    root.querySelector('#export-png-options').hidden=format!=='png';
    root.querySelector('#export-jpg-options').hidden=format!=='jpg';
    root.querySelector('#export-sequence-options').hidden=!animation||(format!=='png'&&format!=='jpg');
    root.querySelector('#export-gif-options').hidden=format!=='gif';
    root.querySelector('#export-video-options').hidden=format!=='webm'&&format!=='mp4';
    root.querySelector('.export-install-encoder').hidden=encoderAvailability('gif').available;
    root.querySelector('#export-source option[value="camera"]').disabled=!cameraActive();
    if(!cameraActive()&&root.querySelector('#export-source').value==='camera')root.querySelector('#export-source').value='canvas';
    root.querySelector('#export-width').disabled=!customResolution;root.querySelector('#export-height').disabled=!customResolution;root.querySelector('#export-lock-aspect').disabled=!customResolution;
    root.querySelector('#export-start').disabled=range!=='custom';root.querySelector('#export-end').disabled=range!=='custom';
    root.querySelector('#export-fps').disabled=!customFps;
    syncResolution(resetResolution);
    root.querySelector('#export-filename').value=filenameFor(root.querySelector('#export-filename').value,format);
    syncNumberingLabel();
    requestPreview();
  }
  function makeField(label,control){
    const row=el('label','export-field'),text=el('span','export-field-label',label);row.append(text,control);return row;
  }
  function select(id,items){
    const control=el('select','export-select');control.id=id;items.forEach(([value,label])=>{const option=el('option','',label);option.value=value;control.appendChild(option);});return control;
  }
  function input(id,type,value){
    const control=el('input','export-input');control.id=id;control.type=type;control.value=value;return control;
  }
  function section(title){
    const node=el('section','export-section');node.appendChild(el('h3','',title));return node;
  }
  function build(){
    root=el('div','modal-overlay export-modal-overlay');root.id='modal-export';
    const modal=el('div','modal export-modal'),header=el('div','export-modal-header');
    header.appendChild(el('h2','', 'Export Animation'));
    const body=el('div','export-modal-body'),left=el('div','export-settings'),right=el('div','export-preview-panel');
    const file=section('File'),name=input('export-filename','text','animation.png');
    file.append(makeField('File Name',name),makeField('Format',select('export-format',Object.entries(FORMATS).map(([key,item])=>[key,item.label]))));
    left.appendChild(file);
    const type=section('Export Type');type.appendChild(makeField('Type',select('export-type',[['single','Single Image'],['animation','Animation']])));left.appendChild(type);
    const source=section('Output Source');source.appendChild(makeField('Source',select('export-source',[['camera','Camera Output'],['canvas','Full Canvas']])));left.appendChild(source);
    const resolution=section('Resolution'),resolutionMode=select('export-resolution',[['source','Project Resolution'],['1280x720','1280 × 720'],['1920x1080','1920 × 1080'],['2560x1440','2560 × 1440'],['3840x2160','3840 × 2160'],['custom','Custom']]);
    const dimensions=el('div','export-dimensions'),width=input('export-width','number',CW),height=input('export-height','number',CH),lock=input('export-lock-aspect','checkbox','');lock.checked=true;
    dimensions.append(makeField('Width',width),makeField('Height',height),makeField('Lock Aspect',lock));resolution.append(makeField('Preset',resolutionMode),dimensions);left.appendChild(resolution);
    const timing=section('Timing'),current=el('div','export-current-frame');current.id='export-current-frame';
    const animationFields=el('div','export-animation-fields');animationFields.id='export-animation-fields';
    animationFields.append(makeField('Range',select('export-range',[['entire','Entire Timeline'],['work','Work Area'],['custom','Custom Range']])));
    const rangeFields=el('div','export-range-fields');rangeFields.append(makeField('Start Frame',input('export-start','number',1)),makeField('End Frame',input('export-end','number',TOTAL)));animationFields.appendChild(rangeFields);
    animationFields.append(makeField('Frame Rate',select('export-fps-mode',[['project','Project FPS'],['custom','Custom FPS']])),makeField('FPS',input('export-fps','number',MAX_FPS)));
    timing.append(current,animationFields);left.appendChild(timing);
    const options=section('Format Options');
    const png=el('div','export-format-options');png.id='export-png-options';png.append(el('p','export-help','Lossless image encoding.'));
    const sequence=el('div','export-format-options');sequence.id='export-sequence-options';sequence.append(makeField('Filename Numbering',select('export-numbering',[['filename_0001','animation_0001'],['0001','0001']])),el('p','export-help','Sequence is downloaded as a ZIP when folder access is unavailable.'));
    const jpg=el('div','export-format-options');jpg.id='export-jpg-options';jpg.append(makeField('Quality',Object.assign(input('export-quality','range',90),{min:1,max:100})));
    const gif=el('div','export-format-options');gif.id='export-gif-options';const installGif=el('button','modal-btn export-install-encoder','Install GIF Encoder');installGif.type='button';installGif.disabled=true;gif.append(makeField('Quality',select('export-gif-quality',[['medium','Medium'],['high','High']])),makeField('Colour Count',select('export-gif-colors',[['64','64'],['128','128'],['256','256']])),makeField('Dithering',input('export-gif-dither','checkbox','')),makeField('Loop Animation',input('export-loop','checkbox','')),installGif);
    const video=el('div','export-format-options');video.id='export-video-options';video.append(makeField('Quality',select('export-video-quality',[['low','Low'],['medium','Medium'],['high','High'],['custom','Custom bitrate']])));
    options.append(png,sequence,jpg,gif,video,el('div','export-encoder-status'));options.lastChild.id='export-encoder-status';left.appendChild(options);
    const previewWrap=el('div','export-preview-wrap'),canvas=el('canvas','');canvas.id='export-preview-canvas';previewWrap.appendChild(canvas);
    const info=el('div','export-preview-info');info.id='export-preview-info';
    const controls=el('div','export-preview-controls'),previous=el('button','export-icon-btn','◀'),play=el('button','export-icon-btn','▶'),next=el('button','export-icon-btn','▶'),slider=input('export-preview-slider','range',0),frameLabel=el('span','export-preview-frame');frameLabel.id='export-preview-frame';
    controls.append(previous,play,next,slider,frameLabel);right.append(previewWrap,info,controls);
    body.append(left,right);
    const actions=el('div','modal-actions export-modal-actions'),cancel=el('button','modal-btn','Cancel'),submit=el('button','modal-btn primary','Export');submit.id='export-submit';actions.append(cancel,submit);
    modal.append(header,body,actions);root.appendChild(modal);document.body.appendChild(root);
    root.querySelector('#export-source').value=cameraActive()?'camera':'canvas';
    root.querySelector('#export-type').value='animation';
    root.querySelector('#export-format').value='mp4';
    root.querySelector('#export-range').value='work';
    previewFrame=curFrame;
root.addEventListener('input',event=>{
      if(event.target.id==='export-filename'){
        syncNumberingLabel();
        const match=event.target.value.match(/\.(png|jpe?g|gif|webm|mp4)$/i);
        if(match){
          const format=match[1].toLowerCase()==='jpeg'?'jpg':match[1].toLowerCase();
          if(FORMATS[format]&&root.querySelector('#export-format').value!==format){root.querySelector('#export-format').value=format;syncUI(false);return;}
        }
      }
      if(event.target.id==='export-width'||event.target.id==='export-height'){
        root.querySelector('#export-resolution').value='custom';
        if(root.querySelector('#export-lock-aspect').checked){
          const ratio=number(root.querySelector('.export-dimensions').dataset.aspect,1);
          if(event.target.id==='export-width')root.querySelector('#export-height').value=Math.max(1,Math.round(number(event.target.value,1)/ratio));
          else root.querySelector('#export-width').value=Math.max(1,Math.round(number(event.target.value,1)*ratio));
        }
      }
      requestPreview();
    });
    root.addEventListener('change',event=>syncUI(['export-source','export-resolution'].includes(event.target.id)));
    previous.onclick=()=>{previewFrame=Math.max(settings().start,previewFrame-1);requestPreview();};
    next.onclick=()=>{previewFrame=Math.min(settings().end,previewFrame+1);requestPreview();};
    slider.oninput=()=>{previewFrame=Number(slider.value);requestPreview();};
    play.onclick=()=>togglePreview(play);cancel.onclick=close;submit.onclick=startExport;
root.addEventListener('click',event=>{if(event.target===root)close();});
    window.addEventListener('camera-changed',requestPreview);
    window.addEventListener('active-artwork-changed',requestPreview);
    window.addEventListener('timeline-frame-changed',requestPreview);
    window.addEventListener('graph-editor-changed',requestPreview);
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('visible')){event.preventDefault();if(root.classList.contains('export-progress-active'))cancelRequested=true;else close();}},{capture:true});
    syncUI(true);
  }
  function togglePreview(button){
    previewPlaying=!previewPlaying;button.textContent=previewPlaying?'❚❚':'▶';clearTimeout(previewTimer);
    const tick=()=>{if(!previewPlaying)return;const value=settings();previewFrame=previewFrame>=value.end?value.start:previewFrame+1;requestPreview();previewTimer=setTimeout(tick,1000/value.fps);};if(previewPlaying)tick();
  }
  function open(){
    if(!root)build();root.classList.add('visible');previewFrame=curFrame;root.querySelector('#export-source').value=cameraActive()?'camera':'canvas';syncUI(true);
  }
  function close(){
    if(!root)return;previewPlaying=false;clearTimeout(previewTimer);root.classList.remove('visible');root.classList.remove('export-progress-active');
  }
  function progress(current,total,start){
    const percent=Math.round(current/total*100),elapsed=(performance.now()-start)/1000,remaining=current?Math.max(0,elapsed/current*(total-current)):0;
    root.querySelector('#export-progress-label').textContent='Exporting frame '+current+' of '+total;
    root.querySelector('#export-progress-percent').textContent=percent+'%';
    root.querySelector('#export-progress-bar').style.width=percent+'%';
    root.querySelector('#export-progress-remaining').textContent=current<total?'About '+Math.ceil(remaining)+'s remaining':'Finishing…';
  }
  function showProgress(){
    let panel=root.querySelector('.export-progress');if(!panel){panel=el('div','export-progress');panel.innerHTML='<h2>Exporting Animation</h2><div id="export-progress-label"></div><div class="export-progress-track"><div id="export-progress-bar"></div></div><div class="export-progress-meta"><span id="export-progress-percent">0%</span><span id="export-progress-remaining"></span></div><button class="modal-btn" id="export-progress-cancel">Cancel</button>';root.querySelector('.export-modal').appendChild(panel);panel.querySelector('#export-progress-cancel').onclick=()=>{cancelRequested=true;};}root.classList.add('export-progress-active');
  }
  async function exportSequence(value){
    if(typeof JSZip==='undefined')throw new Error('ZIP support is unavailable.');
    const zip=new JSZip(),folder=zip.folder(value.filename),canvas=document.createElement('canvas'),total=value.end-value.start+1,startTime=performance.now();
    const jpg=value.format==='jpg',mime=jpg?'image/jpeg':'image/png',extension=jpg?'jpg':'png';
    for(let frame=value.start,index=0;frame<=value.end;frame++,index++){if(cancelRequested)throw new DOMException('Cancelled','AbortError');renderFrame(frame,value,canvas);const blob=await canvasBlob(canvas,mime,value.quality);const serial=(frame+1).toString().padStart(4,'0'),name=value.numbering==='0001'?serial+'.'+extension:value.filename+'_'+serial+'.'+extension;folder.file(name,blob);progress(index+1,total,startTime);await new Promise(resolve=>setTimeout(resolve,0));}
    if(cancelRequested)throw new DOMException('Cancelled','AbortError');download(await zip.generateAsync({type:'blob'}),value.filename+'.zip');
  }
  async function exportGif(value){
    const encoder=window.ExportEncoders&&window.ExportEncoders.gif;
    if(typeof encoder?.encode!=='function')throw new Error('GIF encoder is not installed.');
    const frames=[],canvas=document.createElement('canvas'),total=value.end-value.start+1,startTime=performance.now();
    for(let frame=value.start,index=0;frame<=value.end;frame++,index++){
      if(cancelRequested)throw new DOMException('Cancelled','AbortError');
      renderFrame(frame,value,canvas);
      const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
      frames.push(copy);progress(index+1,total,startTime);await new Promise(resolve=>setTimeout(resolve,0));
    }
    const blob=await encoder.encode({frames,width:value.width,height:value.height,fps:value.fps,loop:value.loop,quality:value.quality});
    if(!(blob instanceof Blob))throw new Error('The GIF encoder returned no data.');
    download(blob,value.filename+'.gif');
  }
  async function exportVideo(value){
    const mime=mediaMime(value.format);if(!mime)throw new Error('The '+value.format.toUpperCase()+' encoder is unavailable.');
    const canvas=document.createElement('canvas');canvas.width=value.width;canvas.height=value.height;
    const stream=canvas.captureStream(0),track=stream.getVideoTracks()[0],chunks=[],recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Math.round(1_000_000+value.quality*11_000_000)});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(recorder.error||new Error('Video encoding failed.'));});
    recorder.start();const total=value.end-value.start+1,startTime=performance.now();
    for(let frame=value.start,index=0;frame<=value.end;frame++,index++){if(cancelRequested)break;renderFrame(frame,value,canvas);if(track.requestFrame)track.requestFrame();progress(index+1,total,startTime);await new Promise(resolve=>setTimeout(resolve,1000/value.fps));}
    recorder.stop();await stopped;track.stop();if(cancelRequested)throw new DOMException('Cancelled','AbortError');download(new Blob(chunks,{type:mime}),value.filename+'.'+value.format);
  }
  async function startExport(){
    const value=settings();if(!validate(value))return;cancelRequested=false;showProgress();
    try{
      if(!value.single&&(value.format==='png'||value.format==='jpg'))await exportSequence(value);
      else if(value.format==='gif')await exportGif(value);
      else if(value.format==='webm'||value.format==='mp4')await exportVideo(value);
      else{const canvas=document.createElement('canvas');renderFrame(value.start,value,canvas);const type=value.format==='jpg'?'image/jpeg':'image/png',blob=await canvasBlob(canvas,type,value.quality);download(blob,value.filename+'.'+value.format);}
      close();if(typeof showInfo==='function')showInfo('Export completed successfully.','Export Complete');
    }catch(error){root.classList.remove('export-progress-active');if(error&&error.name!=='AbortError'&&typeof showInfo==='function')showInfo(error.message||String(error),'Export Failed');}
  }

  window.ExportSystem={open,close,renderFrame,encoderAvailability,encoderStatuses};
})();
