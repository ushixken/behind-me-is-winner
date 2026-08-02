(function(){
  'use strict';

  const canvasArea=document.getElementById('canvas-area');
  const sourceCanvas=document.getElementById('display-canvas');
  const gpuCanvas=document.getElementById('webgpu-presentation-canvas');
  if(!canvasArea||!sourceCanvas||!gpuCanvas)return;

  let requested='canvas2d';
  let active='canvas2d';
  let initPromise=null;
  let adapter=null,device=null,context=null,format=null;
  let sourceTexture=null,sourceTextureView=null,sourceWidth=0,sourceHeight=0,mipCount=0;
  let mipPipeline=null,presentPipeline=null,sampler=null,uniformBuffer=null,presentBindGroup=null,presentBundle=null;
  const uniformValues=new Float32Array(12);
  let mipResources=[];
  let resizeObserver=null,uploadPending=false,renderPending=false,pendingRenderReason='camera',canvasConfigured=false;
  let uploadGeneration=0,lastRenderedUploadGeneration=-1;
  const measurements={uploads:0,uploadBytes:0,mipmapRegenerations:0,textureRecreations:0,pipelineRecreations:0,bindGroupRecreations:0,textureViewRecreations:0,renderBundleRecreations:0,renders:0,cameraOnlyRenders:0,totalUploadMs:0,totalRenderMs:0,totalCameraOnlyRenderMs:0,lastUploadMs:0,lastRenderMs:0,lastCameraOnlyRenderMs:0,lastError:''};

  const mipShader=`
    @group(0) @binding(0) var sourceSampler: sampler;
    @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
    struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) index:u32)->Out {
      var positions=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
      var out:Out; out.position=vec4f(positions[index],0.0,1.0);
      out.uv=positions[index]*vec2f(0.5,-0.5)+vec2f(0.5,0.5); return out;
    }
    @fragment fn fs(in:Out)->@location(0) vec4f { return textureSample(sourceTexture,sourceSampler,in.uv); }
  `;
  const presentShader=`
    struct ViewData { affine:vec4f, translateViewport:vec4f, document:vec4f };
    @group(0) @binding(0) var sourceSampler:sampler;
    @group(0) @binding(1) var sourceTexture:texture_2d<f32>;
    @group(0) @binding(2) var<uniform> view:ViewData;
    struct Out { @builtin(position) position:vec4f };
    @vertex fn vs(@builtin(vertex_index) index:u32)->Out {
      var positions=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
      var out:Out; out.position=vec4f(positions[index],0.0,1.0); return out;
    }
    @fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
      let css=position.xy/view.document.z;
      let documentPoint=vec2f(
        view.affine.x*css.x+view.affine.z*css.y+view.translateViewport.x,
        view.affine.y*css.x+view.affine.w*css.y+view.translateViewport.y
      );
      if(documentPoint.x<0.0||documentPoint.y<0.0||documentPoint.x>=view.document.x||documentPoint.y>=view.document.y){discard;}
      return textureSample(sourceTexture,sourceSampler,documentPoint/view.document.xy);
    }
  `;

  function scheduleRender(reason='camera'){
    if(active!=='webgpu')return;
    if(renderPending){if(reason==='artwork'||(reason==='resize'&&pendingRenderReason==='camera'))pendingRenderReason=reason;return;}
    pendingRenderReason=reason;renderPending=true;
    requestAnimationFrame(()=>{const nextReason=pendingRenderReason;renderPending=false;pendingRenderReason='camera';render(nextReason);});
  }
  function scheduleUpload(){
    if(active!=='webgpu'||uploadPending)return;
    uploadPending=true;
    requestAnimationFrame(()=>{uploadPending=false;uploadComposite(sourceCanvas);});
  }
  function configureCanvas(){
    if(!device||!context)return;
    const rect=canvasArea.getBoundingClientRect();
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const width=Math.max(1,Math.round(rect.width*dpr));
    const height=Math.max(1,Math.round(rect.height*dpr));
    gpuCanvas.style.width=rect.width+'px';gpuCanvas.style.height=rect.height+'px';
    if(gpuCanvas.width!==width||gpuCanvas.height!==height){
      gpuCanvas.width=width;gpuCanvas.height=height;
      context.configure({device,format,alphaMode:'premultiplied'});canvasConfigured=true;
      scheduleRender('resize');
    }else if(!canvasConfigured){
      context.configure({device,format,alphaMode:'premultiplied'});canvasConfigured=true;
      scheduleRender('resize');
    }
  }
  function createPipelines(){
    sampler=device.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
    const mipModule=device.createShaderModule({code:mipShader});
    mipPipeline=device.createRenderPipeline({layout:'auto',vertex:{module:mipModule,entryPoint:'vs'},fragment:{module:mipModule,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});measurements.pipelineRecreations++;
    const presentModule=device.createShaderModule({code:presentShader});
    presentPipeline=device.createRenderPipeline({layout:'auto',vertex:{module:presentModule,entryPoint:'vs'},fragment:{module:presentModule,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});measurements.pipelineRecreations++;
    uniformBuffer=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  }
  async function initialize(){
    if(device)return true;
    if(initPromise)return initPromise;
    initPromise=(async()=>{
      if(!navigator.gpu)throw new Error('WebGPU is not supported by this browser.');
      adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if(!adapter)throw new Error('No WebGPU adapter is available.');
      device=await adapter.requestDevice();
      device.lost.then(info=>{measurements.lastError='WebGPU device lost: '+info.message;fallback(measurements.lastError);});
      context=gpuCanvas.getContext('webgpu');
      if(!context)throw new Error('WebGPU canvas context is unavailable.');
      format=navigator.gpu.getPreferredCanvasFormat();
      createPipelines();configureCanvas();
      resizeObserver=new ResizeObserver(configureCanvas);resizeObserver.observe(canvasArea);
      return true;
    })().catch(error=>{measurements.lastError=String(error&&error.message||error);initPromise=null;throw error;});
    return initPromise;
  }
  function rebuildTextureResources(){
    sourceTextureView=sourceTexture.createView();measurements.textureViewRecreations++;
    presentBindGroup=device.createBindGroup({layout:presentPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:sourceTextureView},{binding:2,resource:{buffer:uniformBuffer}}]});measurements.bindGroupRecreations++;
    const bundleEncoder=device.createRenderBundleEncoder({colorFormats:[format]});bundleEncoder.setPipeline(presentPipeline);bundleEncoder.setBindGroup(0,presentBindGroup);bundleEncoder.draw(3);presentBundle=bundleEncoder.finish();measurements.renderBundleRecreations++;
    mipResources=[];
    for(let level=1;level<mipCount;level++){
      const sourceView=sourceTexture.createView({baseMipLevel:level-1,mipLevelCount:1});
      const targetView=sourceTexture.createView({baseMipLevel:level,mipLevelCount:1});
      measurements.textureViewRecreations+=2;
      const bindGroup=device.createBindGroup({layout:mipPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:sampler},{binding:1,resource:sourceView}]});measurements.bindGroupRecreations++;
      mipResources.push({targetView,bindGroup});
    }
  }
  function ensureSourceTexture(width,height){
    const levels=Math.floor(Math.log2(Math.max(width,height)))+1;
    if(sourceTexture&&sourceWidth===width&&sourceHeight===height&&mipCount===levels)return false;
    if(sourceTexture)sourceTexture.destroy();
    sourceWidth=width;sourceHeight=height;mipCount=levels;
    sourceTexture=device.createTexture({size:[width,height],mipLevelCount:levels,format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    measurements.textureRecreations++;rebuildTextureResources();return true;
  }
  function generateMipmaps(){
    if(!sourceTexture||!mipResources.length)return;
    const encoder=device.createCommandEncoder({label:'display mipmap encoder'});
    for(const resource of mipResources){
      const pass=encoder.beginRenderPass({colorAttachments:[{view:resource.targetView,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
      pass.setPipeline(mipPipeline);pass.setBindGroup(0,resource.bindGroup);pass.draw(3);pass.end();
    }
    device.queue.submit([encoder.finish()]);measurements.mipmapRegenerations++;
  }
  function uploadComposite(canvas){
    if(active!=='webgpu'||!device||!canvas||!canvas.width||!canvas.height)return;
    const start=performance.now();
    ensureSourceTexture(canvas.width,canvas.height);
    device.queue.copyExternalImageToTexture({source:canvas},{texture:sourceTexture,mipLevel:0,premultipliedAlpha:true},[canvas.width,canvas.height]);
    generateMipmaps();uploadGeneration++;measurements.uploads++;measurements.uploadBytes+=canvas.width*canvas.height*4;measurements.lastUploadMs=performance.now()-start;measurements.totalUploadMs+=measurements.lastUploadMs;scheduleRender('artwork');
  }
  function inverseViewMatrix(){
    const pivot=typeof getNavPivot==='function'?getNavPivot():{cx:0,cy:0};
    const matrix=new DOMMatrix();
    matrix.translateSelf(pivot.cx,pivot.cy);matrix.scaleSelf(flipX?-1:1,flipY?-1:1);matrix.translateSelf(-pivot.cx,-pivot.cy);
    matrix.translateSelf(panX,panY);matrix.rotateSelf(rotation);matrix.scaleSelf(zoom,zoom);
    return matrix.inverse();
  }
  function render(reason='camera'){
    if(active!=='webgpu'||!device||!sourceTexture||!presentBindGroup)return;
    const start=performance.now(),cameraOnly=reason==='camera'&&uploadGeneration===lastRenderedUploadGeneration,inverse=inverseViewMatrix(),dpr=Math.max(1,window.devicePixelRatio||1);
    uniformValues[0]=inverse.a;uniformValues[1]=inverse.b;uniformValues[2]=inverse.c;uniformValues[3]=inverse.d;uniformValues[4]=inverse.e;uniformValues[5]=inverse.f;uniformValues[6]=gpuCanvas.width;uniformValues[7]=gpuCanvas.height;uniformValues[8]=sourceWidth;uniformValues[9]=sourceHeight;uniformValues[10]=dpr;uniformValues[11]=0;
    device.queue.writeBuffer(uniformBuffer,0,uniformValues);
    const encoder=device.createCommandEncoder({label:'display presentation encoder'});
    // The swap-chain texture changes every frame, so only this presentation
    // view is transient. Document and mip texture views remain resident.
    const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
    pass.executeBundles([presentBundle]);pass.end();device.queue.submit([encoder.finish()]);
    measurements.renders++;measurements.lastRenderMs=performance.now()-start;measurements.totalRenderMs+=measurements.lastRenderMs;
    if(cameraOnly){measurements.cameraOnlyRenders++;measurements.lastCameraOnlyRenderMs=measurements.lastRenderMs;measurements.totalCameraOnlyRenderMs+=measurements.lastRenderMs;}
    lastRenderedUploadGeneration=uploadGeneration;
  }
  function fallback(reason){
    requested='canvas2d';active='canvas2d';document.body.classList.remove('webgpu-presentation-active');gpuCanvas.hidden=true;
    if(window.ExperimentalDisplayBlur)window.ExperimentalDisplayBlur.set(true);
    if(reason)console.warn('[DisplayBackend] '+reason);
  }
  async function setBackend(name){
    name=String(name||'canvas2d').toLowerCase();
    if(name!=='webgpu'){
      requested='canvas2d';active='canvas2d';document.body.classList.remove('webgpu-presentation-active');gpuCanvas.hidden=true;
      if(window.ExperimentalDisplayBlur)window.ExperimentalDisplayBlur.set(true);
      return active;
    }
    requested='webgpu';
    try{
      await initialize();
      if(requested!=='webgpu')return active;
      active='webgpu';gpuCanvas.hidden=false;document.body.classList.add('webgpu-presentation-active');
      if(window.ExperimentalDisplayBlur)window.ExperimentalDisplayBlur.set(false);
      configureCanvas();uploadComposite(sourceCanvas);return active;
    }catch(error){fallback(error&&error.message||String(error));return active;}
  }
  function destroy(){
    fallback();if(resizeObserver)resizeObserver.disconnect();resizeObserver=null;
    if(sourceTexture)sourceTexture.destroy();sourceTexture=null;sourceTextureView=null;presentBindGroup=null;presentBundle=null;mipResources=[];
    if(device)device.destroy();device=null;context=null;initPromise=null;canvasConfigured=false;
  }

  function stats(){
    return Object.assign({
      mode:active,supported:!!navigator.gpu,sourceWidth,sourceHeight,mipCount,dpr:window.devicePixelRatio||1,
      averageUploadTime:measurements.uploads?measurements.totalUploadMs/measurements.uploads:0,
      averageRenderTime:measurements.renders?measurements.totalRenderMs/measurements.renders:0,
      averageCameraOnlyRenderTime:measurements.cameraOnlyRenders?measurements.totalCameraOnlyRenderMs/measurements.cameraOnlyRenders:0
    },measurements);
  }
  function resetStats(){
    Object.assign(measurements,{uploads:0,uploadBytes:0,mipmapRegenerations:0,textureRecreations:0,pipelineRecreations:0,bindGroupRecreations:0,textureViewRecreations:0,renderBundleRecreations:0,renders:0,cameraOnlyRenders:0,totalUploadMs:0,totalRenderMs:0,totalCameraOnlyRenderMs:0,lastUploadMs:0,lastRenderMs:0,lastCameraOnlyRenderMs:0,lastError:''});
    return stats();
  }
  window.DisplayBackend={set:setBackend,get mode(){return active;},get requested(){return requested;},get supported(){return !!navigator.gpu;},initialize,resize:configureCanvas,uploadComposite,scheduleUpload,renderView(){scheduleRender('camera');},destroy,stats,resetStats};
})();