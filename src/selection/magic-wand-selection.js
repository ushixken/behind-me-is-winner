(function(){
  'use strict';

  var STORAGE_KEY='animate.magicWand.v1';
  var settings={tolerance:0,contiguous:true,combine:'add',edgeExpansion:0,gapBridging:false,gapWidth:1,sample:'current',includeAlpha:true,antiAlias:false};
  var operationToken=0,workVisited=null,workQueue=null,workA=null,workB=null;
  try{
    var saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved){
      settings.tolerance=clampNumber(saved.tolerance,0,255,0);
      settings.contiguous=saved.contiguous!==false;
      settings.combine=['add','replace','subtract','intersect'].indexOf(saved.combine)>=0?saved.combine:'add';
      settings.edgeExpansion=clampNumber(saved.edgeExpansion,-20,20,0);
      settings.gapBridging=!!saved.gapBridging;
      settings.gapWidth=clampNumber(saved.gapWidth,1,10,1);
      settings.sample=saved.sample==='all'?'all':'current';
      settings.includeAlpha=saved.includeAlpha!==false;
      settings.antiAlias=!!saved.antiAlias;
    }
  }catch(_){}

  function clampNumber(value,min,max,fallback){value=Number(value);if(!isFinite(value))value=fallback;return Math.max(min,Math.min(max,Math.round(value)));}
  function normalizeSettings(){settings.tolerance=clampNumber(settings.tolerance,0,255,0);settings.edgeExpansion=clampNumber(settings.edgeExpansion,-20,20,0);settings.gapWidth=clampNumber(settings.gapWidth,1,10,1);settings.sample=settings.sample==='all'?'all':'current';if(['add','replace','subtract','intersect'].indexOf(settings.combine)<0)settings.combine='add';}
  function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));}catch(_){}}
  function update(values){Object.assign(settings,values||{});normalizeSettings();persist();window.dispatchEvent(new CustomEvent('magic-wand-settings-changed'));}
  function sampleImage(){
    if(settings.sample==='all'){recomposite(curLayer,curFrame);return compCtx.getImageData(0,0,CW,CH);}
    return ctx.getImageData(0,0,CW,CH);
  }
  // Similarity uses Chebyshev distance: the greatest absolute channel
  // difference must be <= Color Range. The 0..255 value is therefore an
  // intuitive per-channel range, with zero meaning an exact RGB(A) match.
  function normalizedPixel(data,offset){var alpha=data[offset+3];return alpha===0?[0,0,0,0]:[data[offset],data[offset+1],data[offset+2],alpha];}
  function matches(data,offset,target,tolerance,includeAlpha){
    var candidate=normalizedPixel(data,offset);
    if(!includeAlpha&&((candidate[3]===0)!==(target[3]===0)))return false;
    var distance=Math.max(Math.abs(candidate[0]-target[0]),Math.abs(candidate[1]-target[1]),Math.abs(candidate[2]-target[2]));
    if(includeAlpha)distance=Math.max(distance,Math.abs(candidate[3]-target[3]));
    return distance<=tolerance;
  }
  function ensureWork(count){
    if(!workVisited||workVisited.length!==count){workVisited=new Uint8Array(count);workQueue=new Int32Array(count);workA=new Uint8Array(count);workB=new Uint8Array(count);}
    else{workVisited.fill(0);workA.fill(0);workB.fill(0);}
  }
  function morphology(source,target,width,height,dilate){
    var wanted=dilate?255:0;
    for(var y=0;y<height;y++)for(var x=0;x<width;x++){
      var found=false;
      for(var yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1)&&!found;yy++)for(var xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++)if(source[yy*width+xx]===wanted){found=true;break;}
      target[y*width+x]=(dilate?found:!found)?255:0;
    }
  }
  function repeatMorphology(source,width,height,steps,dilate){
    if(!steps)return new Uint8ClampedArray(source);
    workA.set(source);var from=workA,to=workB;
    for(var step=0;step<steps;step++){morphology(from,to,width,height,dilate);var swap=from;from=to;to=swap;to.fill(0);}
    return new Uint8ClampedArray(from);
  }
  function bridgeSmallGaps(source,width,height,gapWidth){
    // Opening the match mask breaks only narrow traversal passages. In line
    // art this is equivalent to bridging a small break in the surrounding
    // boundary, so flood traversal cannot leak through it. Artwork is never
    // blurred or modified.
    var radius=Math.max(1,Math.ceil(gapWidth/2));
    var contracted=repeatMorphology(source,width,height,radius,false);
    return repeatMorphology(contracted,width,height,radius,true);
  }
  function keepSeedComponent(source,width,height,start){
    var count=width*height,result=new Uint8ClampedArray(count);workVisited.fill(0);var head=0,tail=0;
    if(start<0||start>=count||source[start]!==255)return result;
    workVisited[start]=1;workQueue[tail++]=start;
    while(head<tail){var pixel=workQueue[head++],x=pixel%width,y=(pixel/width)|0,next;result[pixel]=255;
      if(x>0){next=pixel-1;if(source[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(x+1<width){next=pixel+1;if(source[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(y>0){next=pixel-width;if(source[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
      if(y+1<height){next=pixel+width;if(source[next]===255&&!workVisited[next]){workVisited[next]=1;workQueue[tail++]=next;}}
    }
    return result;
  }
  function buildMask(image,startX,startY){
    var data=image.data,width=image.width,height=image.height,count=width*height,start=startY*width+startX,target=normalizedPixel(data,start*4);
    ensureWork(count);
    // Build one immutable raw match mask. The canonical selection is composed
    // only once, after all deterministic post-processing stages finish.
    var raw=new Uint8ClampedArray(count);
    for(var pixel=0,offset=0;pixel<count;pixel++,offset+=4)if(matches(data,offset,target,settings.tolerance,settings.includeAlpha))raw[pixel]=255;
    var connectivity=settings.contiguous&&settings.gapBridging?bridgeSmallGaps(raw,width,height,settings.gapWidth):raw;
    var result=settings.contiguous?keepSeedComponent(connectivity,width,height,start):new Uint8ClampedArray(raw);
    if(settings.edgeExpansion)result=repeatMorphology(result,width,height,Math.abs(settings.edgeExpansion),settings.edgeExpansion>0);
    // The canonical mask is binary. Smooth Boundary is persisted, but partial
    // edge pixels are not invented until canonical masks support coverage;
    // this deliberately prevents isolated selection-dot artifacts.
    return result;
  }
  function pointerDown(event){
    if(tool!=='magic-wand'||activeGroupId||panning||spaceHeld)return;
    if(event.pointerType==='mouse'?event.button!==0:(!(event.buttons&1)&&event.pointerType!=='touch'))return;
    var point=getPos(event),x=Math.floor(point.x),y=Math.floor(point.y);if(x<0||y<0||x>=CW||y>=CH)return;
    event.preventDefault();event.stopImmediatePropagation();
    var modified=event.shiftKey||event.altKey,mode=modified&&window.PixelSelection?PixelSelection.modeFromEvent(event):settings.combine;
    var image=sampleImage(),token=++operationToken,layerIndex=curLayer,frameIndex=curFrame;
    function calculate(){
      if(token!==operationToken||tool!=='magic-wand'||curLayer!==layerIndex||curFrame!==frameIndex){if(typeof _refreshActiveCursor==='function')_refreshActiveCursor();return;}
      var mask=buildMask(image,x,y);
      if(token===operationToken&&window.PixelSelection)PixelSelection.applyMask(mask,CW,CH,mode,'magic-wand');
      if(typeof _refreshActiveCursor==='function')_refreshActiveCursor();
    }
    if(CW*CH>=1000000){activeC.style.cursor='wait';requestAnimationFrame(calculate);}else calculate();
  }
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&tool==='magic-wand'){operationToken++;if(typeof _refreshActiveCursor==='function')_refreshActiveCursor();}},true);
  window.addEventListener('tool-changed',function(event){if(!event.detail||event.detail.tool!=='magic-wand')operationToken++;});
  activeC.addEventListener('pointerdown',pointerDown);
  window.MagicWandSelection={getSettings:function(){return Object.assign({},settings);},updateSettings:update,cancel:function(){operationToken++;}};
})();
