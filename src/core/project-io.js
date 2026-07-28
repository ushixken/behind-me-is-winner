// Versioned, transactional project export/import.
(function(){
  'use strict';
  const FORMAT='AnimateWebsiteProject',VERSION=2,EXT='.awproj',MANIFEST='project.json';
  const OMIT=new Set(['frames','frameMeta','indexFrames','indexMeta','smartStyleFrames','cmFrames','__smartRasterV4Snapshot','extendedFrames']);
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  function fail(message){throw new Error(message);}
  function int(value,name,min,max){const n=Number(value);if(!Number.isInteger(n)||n<min||(max!=null&&n>max))fail(name+' is invalid');return n;}
  function number(value,name,min,max){const n=Number(value);if(!Number.isFinite(n)||n<min||(max!=null&&n>max))fail(name+' is invalid');return n;}
  function safeName(value){return (String(value||'Untitled').trim()||'Untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,160);}
  function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('A frame could not be encoded as PNG')),'image/png'));}
  function blobDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('A Smart Raster frame could not be prepared'));reader.readAsDataURL(blob);});}
  async function dataUrlBlob(url){const response=await fetch(url);if(!response.ok)fail('Embedded Smart Raster artwork is invalid');return response.blob();}
  async function decodePng(blob,width,height,label){
    if(typeof createImageBitmap==='function'){
      let bitmap;try{bitmap=await createImageBitmap(blob);if(width!=null&&(bitmap.width!==width||bitmap.height!==height))fail(label+' dimensions do not match the project canvas');const canvas=document.createElement('canvas');canvas.width=width==null?bitmap.width:width;canvas.height=height==null?bitmap.height:height;canvas.getContext('2d').drawImage(bitmap,0,0);return canvas;}finally{if(bitmap)bitmap.close();}
    }
    return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);if(width!=null&&(image.width!==width||image.height!==height)){reject(new Error(label+' dimensions do not match the project canvas'));return;}const canvas=document.createElement('canvas');canvas.width=width==null?image.width:width;canvas.height=height==null?image.height:height;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas);};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(label+' could not be decoded'));};image.src=url;});
  }
  function bytesBase64(bytes){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(binary);}
  function base64Bytes(text,length,label){let binary;try{binary=atob(String(text||''));}catch(_){fail(label+' is corrupt');}if(binary.length!==length)fail(label+' length is invalid');const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}
  function properties(layer){
    const out={};Object.keys(layer).forEach(key=>{if(OMIT.has(key))return;const value=layer[key];if(typeof value==='function'||value instanceof HTMLCanvasElement||ArrayBuffer.isView(value)||value instanceof Map||value instanceof Set)return;try{out[key]=clone(value);}catch(_){}});
    out.name=String(layer.name||'Layer');out.type=layer.type==='smart-raster'?'smart-raster':'bitmap';out.visible=layer.visible!==false;out.onTimeline=layer.onTimeline!==false;out.opacity=Math.max(0,Math.min(1,Number(layer.opacity==null?1:layer.opacity)));return out;
  }
  function paletteState(){if(!window.PaletteDocker||!window.PaletteDocker.serialize)return null;const state=clone(window.PaletteDocker.serialize());if(state)delete state.view;return state;}
  function currentName(){return safeName(window._projectName||'Untitled');}

  async function exportProject(){
    if(typeof JSZip==='undefined')fail('JSZip is unavailable. Project export cannot continue.');
    if(window.finishActiveDrawingBeforeArtworkChange)window.finishActiveDrawingBeforeArtworkChange(curLayer,curFrame);
    const zip=new JSZip(),savedLayers=[];
    for(let li=0;li<layers.length;li++){
      const layer=layers[li],saved={properties:properties(layer),frameMeta:clone(layer.frameMeta||{}),frames:[]};
      for(const fi of Object.keys(layer.frames||{}).map(Number).filter(Number.isInteger).sort((a,b)=>a-b)){
        if(fi<0||fi>=TOTAL)continue;const canvas=layer.frames[fi];if(!canvas)continue;if(canvas.width!==CW||canvas.height!==CH)fail('Layer '+(li+1)+', frame '+(fi+1)+' has unexpected dimensions');
        const path='assets/layers/'+li+'/frames/'+fi+'.png';zip.file(path,await canvasBlob(canvas));saved.frames.push({frame:fi,path});
      }
      const extendedEntries=Object.entries(layer.extendedFrames||{}).filter(([,record])=>record&&record.canvas);
      if(extendedEntries.length){saved.extendedFrames=[];for(const [fi,record] of extendedEntries){const path='assets/layers/'+li+'/extended/'+fi+'.png';zip.file(path,await canvasBlob(record.canvas));saved.extendedFrames.push({frame:Number(fi),path,x:Number(record.x)||0,y:Number(record.y)||0,width:record.canvas.width,height:record.canvas.height});}}
      if(layer.type==='smart-raster'&&window.SmartRasterLayer&&window.SmartRasterLayer.serializeLayer){
        const smart=clone(window.SmartRasterLayer.serializeLayer(layer));
        for(const [fi,frame] of Object.entries(smart&&smart.frames||{})){if(frame&&frame.rgba){const path='assets/layers/'+li+'/smart/'+fi+'.png';zip.file(path,await dataUrlBlob(frame.rgba));delete frame.rgba;frame.rgbaPath=path;}}
        saved.smartRaster=smart;
      }
      if(layer.cmFrames){saved.cmFrames={};Object.entries(layer.cmFrames).forEach(([fi,frame])=>{if(frame&&frame.pixels instanceof Uint32Array)saved.cmFrames[fi]={width:frame.width,height:frame.height,pixels:bytesBase64(new Uint8Array(frame.pixels.buffer,frame.pixels.byteOffset,frame.pixels.byteLength))};});}
      savedLayers.push(saved);
    }
    const manifest={format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),document:{name:currentName(),width:CW,height:CH,totalFrames:TOTAL,maxFps:MAX_FPS,framesPerSecond:typeof getFPS==='function'?getFPS():Number(fpsTl.value)||PROJECT_DEFAULTS.fps,backgroundColor:bgColor,currentFrame:curFrame,currentLayer:curLayer,rangeStart,rangeEnd,loopRange:!!loopRange},camera:window.CameraSystem?CameraSystem.serialize():null,groups:clone(groups||[]),layers:savedLayers,timeline:{frameLabelOffset:typeof frameLabelOffset==='number'?frameLabelOffset:0},palette:paletteState()};
    zip.file(MANIFEST,JSON.stringify(manifest,null,2));const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=currentName()+EXT;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return{name:anchor.download,size:blob.size,layers:savedLayers.length};
  }

  function validate(manifest){
    if(!manifest||typeof manifest!=='object')fail('project.json is missing or invalid');if(manifest.format!==FORMAT)fail('This is not an Animate Website project file');if(!Number.isInteger(manifest.version))fail('The project version is missing');if(manifest.version>VERSION)fail('This project was created by a newer unsupported version ('+manifest.version+')');if(manifest.version<1)fail('This project version is unsupported');
    const doc=manifest.document;if(!doc||typeof doc!=='object')fail('Document settings are missing');const width=int(doc.width,'Canvas width',1,16384),height=int(doc.height,'Canvas height',1,16384),total=int(doc.totalFrames,'Frame count',1,100000);int(doc.currentFrame,'Current frame',0,total-1);number(doc.framesPerSecond,'Frame rate',1,120);int(doc.maxFps,'Maximum frame rate',1,120);
    if(!Array.isArray(manifest.layers)||!manifest.layers.length)fail('The project contains no layers');int(doc.currentLayer,'Current layer',0,manifest.layers.length-1);
    manifest.layers.forEach((layer,li)=>{if(!layer||typeof layer!=='object'||!layer.properties)fail('Layer '+(li+1)+' is invalid');if(!Array.isArray(layer.frames))fail('Layer '+(li+1)+' frame list is invalid');if(layer.extendedFrames!=null&&!Array.isArray(layer.extendedFrames))fail('Layer '+(li+1)+' extended frame list is invalid');const seen=new Set();layer.frames.forEach(item=>{const fi=int(item&&item.frame,'Frame index',0,total-1);if(seen.has(fi))fail('Layer '+(li+1)+' contains duplicate frame '+(fi+1));seen.add(fi);if(!item.path||typeof item.path!=='string')fail('Layer '+(li+1)+' frame '+(fi+1)+' asset is missing');});(layer.extendedFrames||[]).forEach(item=>{int(item&&item.frame,'Extended frame index',0,total-1);int(item&&item.width,'Extended frame width',1,32768);int(item&&item.height,'Extended frame height',1,32768);number(item&&item.x,'Extended frame X',-1000000,1000000);number(item&&item.y,'Extended frame Y',-1000000,1000000);if(!item.path||typeof item.path!=='string')fail('Layer '+(li+1)+' extended frame asset is missing');});});return{width,height,total};
  }
  async function zipBlob(zip,path,label){const entry=zip.file(path);if(!entry)fail(label+' is missing');return entry.async('blob');}
  async function stageProject(file){
    if(typeof JSZip==='undefined')fail('JSZip is unavailable. Project import cannot continue.');const zip=await JSZip.loadAsync(file,{checkCRC32:true}),manifestEntry=zip.file(MANIFEST);if(!manifestEntry)fail('project.json is missing');let manifest;try{manifest=JSON.parse(await manifestEntry.async('string'));}catch(_){fail('project.json contains invalid JSON');}const dimensions=validate(manifest),stagedLayers=[];
    for(let li=0;li<manifest.layers.length;li++){
      const saved=manifest.layers[li],props=clone(saved.properties),layer=Object.assign(makeBlankLayer(props.type),props,{frames:{},frameMeta:clone(saved.frameMeta||{}),indexFrames:{},indexMeta:{},smartStyleFrames:{}});
      for(const item of saved.frames){const blob=await zipBlob(zip,item.path,'Layer '+(li+1)+', frame '+(item.frame+1));layer.frames[item.frame]=await decodePng(blob,dimensions.width,dimensions.height,'Layer '+(li+1)+', frame '+(item.frame+1));}
      if(saved.extendedFrames&&saved.extendedFrames.length){layer.extendedFrames={};for(const item of saved.extendedFrames){const blob=await zipBlob(zip,item.path,'Extended artwork for layer '+(li+1)+', frame '+(item.frame+1)),canvas=await decodePng(blob,null,null,'Extended artwork for layer '+(li+1)+', frame '+(item.frame+1));if(canvas.width!==item.width||canvas.height!==item.height)fail('Extended artwork dimensions are invalid');layer.extendedFrames[item.frame]={canvas,x:Number(item.x)||0,y:Number(item.y)||0};}}
      if(saved.smartRaster){const smart=clone(saved.smartRaster);for(const [fi,frame] of Object.entries(smart.frames||{})){if(frame&&frame.rgbaPath){const blob=await zipBlob(zip,frame.rgbaPath,'Smart Raster artwork for layer '+(li+1)+', frame '+(Number(fi)+1));await decodePng(blob,dimensions.width,dimensions.height,'Smart Raster artwork for layer '+(li+1)+', frame '+(Number(fi)+1));frame.rgba=await blobDataUrl(blob);delete frame.rgbaPath;}}const oldW=CW,oldH=CH;try{CW=dimensions.width;CH=dimensions.height;await window.SmartRasterLayer.deserializeLayer(layer,smart);}finally{CW=oldW;CH=oldH;}}
      if(saved.cmFrames){layer.cmFrames={};Object.entries(saved.cmFrames).forEach(([fi,frame])=>{const width=int(frame.width,'CM frame width',1,16384),height=int(frame.height,'CM frame height',1,16384);if(width!==dimensions.width||height!==dimensions.height)fail('CM frame dimensions do not match the project canvas');const bytes=base64Bytes(frame.pixels,width*height*4,'CM frame');layer.cmFrames[fi]={width,height,pixels:new Uint32Array(bytes.buffer)};});}
      stagedLayers.push(layer);
    }
    return{manifest,dimensions,layers:stagedLayers};
  }
  function applyUi(fps){fpsTl.max=MAX_FPS;fpsTl.value=Math.min(MAX_FPS,fps);fpsVal.textContent=fpsTl.value;selectedFrames.clear();selectedFrames.add(curFrame);selectedKFs.clear();}
  async function commit(staged){
    const old={CW,CH,TOTAL,MAX_FPS,curFrame,curLayer,rangeStart,rangeEnd,loopRange,bgColor,layers,groups,palette:paletteState(),camera:window.CameraSystem?CameraSystem.snapshot():null,labelOffset:typeof frameLabelOffset==='number'?frameLabelOffset:0},doc=staged.manifest.document;
    try{
      if(window.finishActiveDrawingBeforeArtworkChange)window.finishActiveDrawingBeforeArtworkChange(curLayer,curFrame);CW=staged.dimensions.width;CH=staged.dimensions.height;TOTAL=staged.dimensions.total;MAX_FPS=Number(doc.maxFps);layers=staged.layers;groups=clone(staged.manifest.groups||[]);curLayer=Number(doc.currentLayer);curFrame=Number(doc.currentFrame);rangeStart=Math.max(0,Math.min(TOTAL-1,Number(doc.rangeStart)||0));rangeEnd=Math.max(rangeStart,Math.min(TOTAL-1,Number(doc.rangeEnd==null?TOTAL-1:doc.rangeEnd)));loopRange=!!doc.loopRange;bgColor=typeof doc.backgroundColor==='string'?doc.backgroundColor:'#ffffff';window._projectName=safeName(doc.name||'Untitled');if(typeof frameLabelOffset==='number')frameLabelOffset=Math.max(0,Number(staged.manifest.timeline&&staged.manifest.timeline.frameLabelOffset)||0);
      undoStack=[];redoStack=[];clipboard=null;styleClipboard=null;initCanvas();applyUi(Number(doc.framesPerSecond));if(window.CameraSystem)CameraSystem.load(staged.manifest.camera||null);if(staged.manifest.palette&&window.PaletteDocker)window.PaletteDocker.load(staged.manifest.palette,{persist:false});loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();updateOnion();updateStatus();fitCanvasToView();window.dispatchEvent(new CustomEvent('project-loaded',{detail:{format:FORMAT,version:VERSION,name:window._projectName}}));
    }catch(error){CW=old.CW;CH=old.CH;TOTAL=old.TOTAL;MAX_FPS=old.MAX_FPS;curFrame=old.curFrame;curLayer=old.curLayer;rangeStart=old.rangeStart;rangeEnd=old.rangeEnd;loopRange=old.loopRange;bgColor=old.bgColor;layers=old.layers;groups=old.groups;if(window.CameraSystem)CameraSystem.restore(old.camera);if(typeof frameLabelOffset==='number')frameLabelOffset=old.labelOffset;initCanvas();if(old.palette&&window.PaletteDocker)window.PaletteDocker.load(old.palette,{persist:false});applyUi(Math.min(Number(fpsTl.value)||PROJECT_DEFAULTS.fps,MAX_FPS));loadFrame(curLayer,curFrame);renderLayerPanel();renderTimeline();throw error;}
  }
  async function importProject(file){const staged=await stageProject(file);await commit(staged);return{name:window._projectName,layers:layers.length,frames:TOTAL};}
  function busy(value){document.documentElement.style.cursor=value?'progress':'';['dd-export-project','dd-open-project'].forEach(id=>{const item=document.getElementById(id);if(item)item.classList.toggle('disabled',value);});}
  function report(error,title){console.error('[ProjectIO]',error);showInfo(error&&error.message?error.message:String(error),title);}
  function bind(){
    const save=document.getElementById('dd-export-project'),open=document.getElementById('dd-open-project'),input=document.getElementById('project-file-input');
    save.onclick=async()=>{closeAllDropdowns();busy(true);try{const result=await exportProject();showInfo('Saved '+result.layers+' layer'+(result.layers===1?'':'s')+' to '+result.name+'.','Project Saved');}catch(error){report(error,'Project Save Failed');}finally{busy(false);}};
    open.onclick=()=>{closeAllDropdowns();input.value='';input.click();};input.addEventListener('change',async()=>{const file=input.files&&input.files[0];if(!file)return;busy(true);try{const result=await importProject(file);showInfo('Opened "'+result.name+'" with '+result.layers+' layer'+(result.layers===1?'':'s')+'.','Project Opened');}catch(error){report(error,'Project Open Failed');}finally{busy(false);input.value='';}});
  }
  window.ProjectIO={format:FORMAT,version:VERSION,extension:EXT,exportProject,importProject,stageProject};document.addEventListener('DOMContentLoaded',bind);
})();
