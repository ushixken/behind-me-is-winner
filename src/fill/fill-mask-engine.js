(function(){
  'use strict';
  var SETTINGS_KEY='animate.fillTool.v1',TILE_SIZE=256;
  var settings={antialiasing:false,quality:'medium'};
  var coverageCanvas=null,coverageContext=null,effectiveMaskCanvas=null,effectiveMaskContext=null,supersampleCanvas=null,supersampleContext=null;
  try{
    var saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');settings.antialiasing=!!saved.antialiasing;
    settings.quality=['weak','medium','strong'].indexOf(saved.quality)>=0?saved.quality:'medium';
  }catch(_){settings.antialiasing=false;settings.quality='medium';}
  function persist(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(_){}}
  function notify(){window.dispatchEvent(new CustomEvent('fill-tool-settings-changed',{detail:getSettings()}));}
  function clampBounds(bounds,padding){
    padding=padding||0;var x=Math.max(0,Math.floor(bounds.x)-padding),y=Math.max(0,Math.floor(bounds.y)-padding);
    var ex=Math.min(CW,Math.ceil(bounds.x+(bounds.w==null?bounds.width:bounds.w))+padding),ey=Math.min(CH,Math.ceil(bounds.y+(bounds.h==null?bounds.height:bounds.h))+padding);
    return{x:x,y:y,w:Math.max(0,ex-x),h:Math.max(0,ey-y)};
  }
  function ensureDocumentCanvas(kind){
    var canvas=kind==='coverage'?coverageCanvas:effectiveMaskCanvas,context=kind==='coverage'?coverageContext:effectiveMaskContext;
    if(!canvas){canvas=document.createElement('canvas');context=canvas.getContext('2d',{willReadFrequently:true});if(kind==='coverage'){coverageCanvas=canvas;coverageContext=context;}else{effectiveMaskCanvas=canvas;effectiveMaskContext=context;}}
    if(canvas.width!==CW||canvas.height!==CH){canvas.width=CW;canvas.height=CH;context=canvas.getContext('2d',{willReadFrequently:true});if(kind==='coverage')coverageContext=context;else effectiveMaskContext=context;}
    return canvas;
  }
  function ensureSupersample(size){
    var dimension=TILE_SIZE*size;
    if(!supersampleCanvas){supersampleCanvas=document.createElement('canvas');supersampleContext=supersampleCanvas.getContext('2d',{willReadFrequently:true});}
    if(supersampleCanvas.width!==dimension||supersampleCanvas.height!==dimension){supersampleCanvas.width=dimension;supersampleCanvas.height=dimension;supersampleContext=supersampleCanvas.getContext('2d',{willReadFrequently:true});}
  }
  function tracePolygon(context,points){
    context.beginPath();context.moveTo(points[0].x,points[0].y);for(var i=1;i<points.length;i++)context.lineTo(points[i].x,points[i].y);context.closePath();context.fill('nonzero');
  }
  function rasterizePolygon(points,bounds,samples){
    if(!Array.isArray(points)||points.length<3)return null;
    var rect=clampBounds(bounds,1),coverage=ensureDocumentCanvas('coverage');if(!rect.w||!rect.h)return null;
    coverageContext.clearRect(rect.x,rect.y,rect.w,rect.h);ensureSupersample(samples);
    for(var tileY=rect.y;tileY<rect.y+rect.h;tileY+=TILE_SIZE)for(var tileX=rect.x;tileX<rect.x+rect.w;tileX+=TILE_SIZE){
      var tileWidth=Math.min(TILE_SIZE,rect.x+rect.w-tileX),tileHeight=Math.min(TILE_SIZE,rect.y+rect.h-tileY),highWidth=tileWidth*samples,highHeight=tileHeight*samples;
      supersampleContext.setTransform(1,0,0,1,0,0);supersampleContext.clearRect(0,0,highWidth,highHeight);
      supersampleContext.setTransform(samples,0,0,samples,-tileX*samples,-tileY*samples);supersampleContext.fillStyle='#fff';tracePolygon(supersampleContext,points);
      var high=supersampleContext.getImageData(0,0,highWidth,highHeight).data,low=coverageContext.createImageData(tileWidth,tileHeight),lowData=low.data,area=samples*samples;
      for(var y=0;y<tileHeight;y++)for(var x=0;x<tileWidth;x++){
        var sum=0;for(var sy=0;sy<samples;sy++){var highRow=(y*samples+sy)*highWidth;for(var sx=0;sx<samples;sx++)sum+=high[(highRow+x*samples+sx)*4+3];}
        var alpha=Math.round(sum/area);if(samples===1)alpha=alpha>=128?255:0;lowData[(y*tileWidth+x)*4+3]=alpha;
      }
      coverageContext.putImageData(low,tileX,tileY);
    }
    return{canvas:coverage,bounds:rect};
  }
  function selectionCoverage(pixel){
    if(!(window.SelectionScope&&SelectionScope.isRestricted()))return 255;
    var state=window.PixelSelection&&PixelSelection.getState?PixelSelection.getState():null;
    if(state&&state.mask&&pixel>=0&&pixel<state.mask.length)return state.mask[pixel];
    return SelectionScope.allowsPixel(pixel)?255:0;
  }
  function compositePixel(data,offset,r,g,b,coverage){
    if(coverage>=255){data[offset]=r;data[offset+1]=g;data[offset+2]=b;data[offset+3]=255;return;}
    var sa=coverage/255,da=data[offset+3]/255,oa=sa+da*(1-sa);if(oa<=0)return;
    data[offset]=Math.round((r*sa+data[offset]*da*(1-sa))/oa);data[offset+1]=Math.round((g*sa+data[offset+1]*da*(1-sa))/oa);
    data[offset+2]=Math.round((b*sa+data[offset+2]*da*(1-sa))/oa);data[offset+3]=Math.round(oa*255);
  }
  function applyCoverageMask(maskCanvas,bounds,options){
    options=options||{};var rect=clampBounds(bounds,0);if(!maskCanvas||!rect.w||!rect.h)return false;
    var mask=maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(rect.x,rect.y,rect.w,rect.h).data,hasCoverage=false;
    for(var alpha=3;alpha<mask.length;alpha+=4)if(mask[alpha]){hasCoverage=true;break;}if(!hasCoverage)return false;
    pushUndo();ensureKey();
    var image=ctx.getImageData(rect.x,rect.y,rect.w,rect.h),pixels=image.data,layer=layers[curLayer],smart=layer&&layer.type==='smart-raster'&&advancedPalettePaintingEnabled();
    var styleId=smart?activeAdvancedStyleIdForPainting():null,beforeSmart=styleId?{data:pixels.slice()}:null,fillColor=typeof options.color==='string'?options.color:color;
    var fr=parseInt(fillColor.slice(1,3),16),fg=parseInt(fillColor.slice(3,5),16),fb=parseInt(fillColor.slice(5,7),16);if(!Number.isFinite(fr)||!Number.isFinite(fg)||!Number.isFinite(fb))return false;
    var effective=ensureDocumentCanvas('effective');effectiveMaskContext.clearRect(rect.x,rect.y,rect.w,rect.h);var effectiveData=effectiveMaskContext.createImageData(rect.w,rect.h),changed=0;
    for(var pixel=0,offset=0;pixel<rect.w*rect.h;pixel++,offset+=4){
      var coverage=mask[offset+3];if(!coverage)continue;var documentPixel=(rect.y+Math.floor(pixel/rect.w))*CW+rect.x+(pixel%rect.w),clip=selectionCoverage(documentPixel);
      coverage=Math.round(coverage*clip/255);if(!coverage)continue;
      var oldR=pixels[offset],oldG=pixels[offset+1],oldB=pixels[offset+2],oldA=pixels[offset+3];compositePixel(pixels,offset,fr,fg,fb,coverage);
      if(pixels[offset]!==oldR||pixels[offset+1]!==oldG||pixels[offset+2]!==oldB||pixels[offset+3]!==oldA)changed++;effectiveData.data[offset+3]=coverage;
    }
    effectiveMaskContext.putImageData(effectiveData,rect.x,rect.y);ctx.putImageData(image,rect.x,rect.y);
    if(styleId&&typeof commitSmartRasterBrush==='function')commitSmartRasterBrush(effective,styleId,1,rect,beforeSmart,'normal');
    saveActiveToKey();recomposite(curLayer,curFrame);renderTimeline();updateStatus();return changed>0;
  }
  function applyPolygon(points,bounds,options){
    options=options||{};var enabled=options.antialiasing==null?settings.antialiasing:!!options.antialiasing,quality=['weak','medium','strong'].indexOf(options.quality)>=0?options.quality:settings.quality;
    var samples=enabled?(quality==='weak'?2:quality==='strong'?8:4):1,result=rasterizePolygon(points,bounds,samples);return result?applyCoverageMask(result.canvas,result.bounds,options):false;
  }
  function applyMask(maskCanvas,bounds,options){return applyCoverageMask(maskCanvas,bounds,options);}
  function setAntialiasing(enabled){settings.antialiasing=!!enabled;persist();notify();}
  function setQuality(quality){if(['weak','medium','strong'].indexOf(quality)<0)return false;settings.quality=quality;persist();notify();return true;}
  function getSettings(){return{antialiasing:settings.antialiasing,quality:settings.quality};}
  window.FillMaskEngine={applyMask:applyMask,applyPolygon:applyPolygon,getSettings:getSettings,setAntialiasing:setAntialiasing,setQuality:setQuality};
})();
