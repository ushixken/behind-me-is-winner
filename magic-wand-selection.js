(function(){
  'use strict';

  var STORAGE_KEY='animate.magicWand.v1';
  var settings={tolerance:0,contiguous:true,sample:'current',includeAlpha:true,antiAlias:false};
  var operationToken=0,workVisited=null,workQueue=null;
  try{var saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved){settings.tolerance=Math.max(0,Math.min(255,Number(saved.tolerance)||0));settings.contiguous=saved.contiguous!==false;settings.sample=saved.sample==='all'?'all':'current';settings.includeAlpha=saved.includeAlpha!==false;settings.antiAlias=!!saved.antiAlias;}}catch(_){}

  function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch(_){} }
  function update(values){Object.assign(settings,values||{});settings.tolerance=Math.max(0,Math.min(255,Number(settings.tolerance)||0));settings.sample=settings.sample==='all'?'all':'current';persist();window.dispatchEvent(new CustomEvent('magic-wand-settings-changed'));}
  function sampleImage(){
    if(settings.sample==='all'){
      recomposite(curLayer,curFrame);
      return compCtx.getImageData(0,0,CW,CH);
    }
    return ctx.getImageData(0,0,CW,CH);
  }
  // Similarity uses Chebyshev distance: the greatest absolute channel
  // difference must be <= tolerance. This keeps tolerance in the intuitive
  // 0..255 channel range; tolerance 0 is an exact RGB(A) match. Alpha is
  // included only when the Include Alpha option is enabled.
  function normalizedPixel(data,offset){var alpha=data[offset+3];return alpha===0?[0,0,0,0]:[data[offset],data[offset+1],data[offset+2],alpha];}
  function matches(data,offset,target,tolerance,includeAlpha){
    var candidate=normalizedPixel(data,offset);
    // With alpha excluded, transparent and visible pixels are still kept in
    // separate classes. Otherwise arbitrary hidden RGB in alpha-zero pixels
    // can match a distant visible color even though that color is not visible.
    if(!includeAlpha&&((candidate[3]===0)!==(target[3]===0)))return false;
    var distance=Math.max(Math.abs(candidate[0]-target[0]),Math.abs(candidate[1]-target[1]),Math.abs(candidate[2]-target[2]));
    if(includeAlpha)distance=Math.max(distance,Math.abs(candidate[3]-target[3]));
    return distance<=tolerance;
  }
  function keepSeedComponent(mask,width,height,start){
    var count=width*height;if(start<0||start>=count||mask[start]!==255){mask.fill(0);return;}
    workVisited.fill(0);workQueue.fill(0);var head=0,tail=0;workVisited[start]=1;workQueue[tail++]=start;
    while(head<tail){var pixel=workQueue[head++],x=pixel%width,y=(pixel/width)|0,next;
      if(x>0){next=y*width+(x-1);if(mask[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(x+1<width){next=y*width+(x+1);if(mask[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(y>0){next=(y-1)*width+x;if(mask[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(y+1<height){next=(y+1)*width+x;if(mask[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
    }
    for(var pixel=0;pixel<count;pixel++)if(mask[pixel]===255&&!workVisited[pixel])mask[pixel]=0;
  }
  function buildMask(image,startX,startY){
    var data=image.data,width=image.width,height=image.height,count=width*height,start=startY*width+startX,targetOffset=start*4;
    var target=normalizedPixel(data,targetOffset),mask=new Uint8ClampedArray(count),tolerance=settings.tolerance,includeAlpha=settings.includeAlpha;mask.fill(0);
    if(!settings.contiguous){for(var pixel=0,offset=0;pixel<count;pixel++,offset+=4)if(matches(data,offset,target,tolerance,includeAlpha))mask[pixel]=255;return mask;}
    if(!workVisited||workVisited.length!==count){workVisited=new Uint8Array(count);workQueue=new Int32Array(count);}else{workVisited.fill(0);workQueue.fill(0);}
    var visited=workVisited,queue=workQueue,head=0,tail=0;visited[start]=1;queue[tail++]=start;
    while(head<tail){
      var pixel=queue[head++],offset=pixel*4;if(!matches(data,offset,target,tolerance,includeAlpha))continue;
      mask[pixel]=255;var x=pixel%width,y=(pixel/width)|0,next;
      if(x>0){next=pixel-1;if(!visited[next]){visited[next]=1;queue[tail++]=next;}}
      if(x+1<width){next=pixel+1;if(!visited[next]){visited[next]=1;queue[tail++]=next;}}
      if(y>0){next=pixel-width;if(!visited[next]){visited[next]=1;queue[tail++]=next;}}
      if(y+1<height){next=pixel+width;if(!visited[next]){visited[next]=1;queue[tail++]=next;}}
    }
    keepSeedComponent(mask,width,height,start);
    return mask;
  }
  function pointerDown(event){
    if(tool!=='magic-wand'||activeGroupId||panning||spaceHeld)return;
    if(event.pointerType==='mouse'?event.button!==0:(!(event.buttons&1)&&event.pointerType!=='touch'))return;
    var point=getPos(event),x=Math.floor(point.x),y=Math.floor(point.y);if(x<0||y<0||x>=CW||y>=CH)return;
    event.preventDefault();event.stopImmediatePropagation();
    var mode=window.PixelSelection?PixelSelection.modeFromEvent(event):'replace',image=sampleImage(),token=++operationToken,oldCursor=activeC.style.cursor,layerIndex=curLayer,frameIndex=curFrame;
    function calculate(){
      if(token!==operationToken||tool!=='magic-wand'||curLayer!==layerIndex||curFrame!==frameIndex){activeC.style.cursor=oldCursor;return;}
      var mask=buildMask(image,x,y);
      // The canonical mask is currently binary, so Anti-alias is persisted
      // for forward compatibility but deliberately does not invent partial
      // coverage values that the selection combiner cannot preserve.
      if(token===operationToken&&window.PixelSelection)PixelSelection.applyMask(mask,CW,CH,mode,'magic-wand');
      activeC.style.cursor=oldCursor;
    }
    if(CW*CH>=1000000){activeC.style.cursor='wait';requestAnimationFrame(calculate);}else calculate();
  }
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&tool==='magic-wand'){operationToken++;activeC.style.cursor='crosshair';}},true);
  window.addEventListener('tool-changed',function(event){if(!event.detail||event.detail.tool!=='magic-wand')operationToken++;});
  activeC.addEventListener('pointerdown',pointerDown);
  window.MagicWandSelection={getSettings:function(){return Object.assign({},settings);},updateSettings:update,cancel:function(){operationToken++;}};
})();
