(function(){
  'use strict';
  var effectiveMaskCanvas=null,effectiveMaskContext=null;
  function clampBounds(bounds,width,height){
    if(!bounds)return{x:0,y:0,w:width,h:height};
    var x=Math.max(0,Math.floor(bounds.x)),y=Math.max(0,Math.floor(bounds.y));
    var ex=Math.min(width,Math.ceil(bounds.x+(bounds.w==null?bounds.width:bounds.w))),ey=Math.min(height,Math.ceil(bounds.y+(bounds.h==null?bounds.height:bounds.h)));
    return{x:x,y:y,w:Math.max(0,ex-x),h:Math.max(0,ey-y)};
  }
  function ensureEffectiveMask(width,height){
    if(!effectiveMaskCanvas){effectiveMaskCanvas=document.createElement('canvas');effectiveMaskContext=effectiveMaskCanvas.getContext('2d',{willReadFrequently:true});}
    if(effectiveMaskCanvas.width!==width||effectiveMaskCanvas.height!==height){effectiveMaskCanvas.width=width;effectiveMaskCanvas.height=height;effectiveMaskContext=effectiveMaskCanvas.getContext('2d',{willReadFrequently:true});}
    return effectiveMaskCanvas;
  }
  function applyMask(maskCanvas,bounds,options){
    options=options||{};
    if(!maskCanvas||maskCanvas.width!==CW||maskCanvas.height!==CH)return false;
    var rect=clampBounds(bounds,CW,CH);if(!rect.w||!rect.h)return false;
    var sourceMask=maskCanvas.getContext('2d',{willReadFrequently:true}).getImageData(rect.x,rect.y,rect.w,rect.h),hasCoverage=false;
    for(var a=3;a<sourceMask.data.length;a+=4)if(sourceMask.data[a]){hasCoverage=true;break;}
    if(!hasCoverage)return false;
    pushUndo();ensureKey();
    var image=ctx.getImageData(rect.x,rect.y,rect.w,rect.h),pixels=image.data;
    var layer=layers[curLayer],smartFill=layer&&layer.type==='smart-raster'&&advancedPalettePaintingEnabled();
    var styleId=smartFill?activeAdvancedStyleIdForPainting():null,beforeSmart=styleId?{data:pixels.slice()}:null;
    var fillColor=typeof options.color==='string'?options.color:color;
    var fr=parseInt(fillColor.slice(1,3),16),fg=parseInt(fillColor.slice(3,5),16),fb=parseInt(fillColor.slice(5,7),16);
    if(!Number.isFinite(fr)||!Number.isFinite(fg)||!Number.isFinite(fb))return false;
    var selectionRestricted=window.SelectionScope&&SelectionScope.isRestricted();
    var effective=ensureEffectiveMask(CW,CH),effectiveData=sourceMask;effectiveMaskContext.clearRect(0,0,CW,CH);var changed=0;
    for(var row=0;row<rect.h;row++)for(var col=0;col<rect.w;col++){
      var local=row*rect.w+col,offset=local*4;if(!effectiveData.data[offset+3])continue;
      var documentPixel=(rect.y+row)*CW+rect.x+col;
      if(selectionRestricted&&!SelectionScope.allowsPixel(documentPixel)){effectiveData.data[offset+3]=0;continue;}
      if(pixels[offset]!==fr||pixels[offset+1]!==fg||pixels[offset+2]!==fb||pixels[offset+3]!==255)changed++;
      pixels[offset]=fr;pixels[offset+1]=fg;pixels[offset+2]=fb;pixels[offset+3]=255;
    }
    effectiveMaskContext.putImageData(effectiveData,rect.x,rect.y);ctx.putImageData(image,rect.x,rect.y);
    if(styleId&&typeof commitSmartRasterBrush==='function')commitSmartRasterBrush(effective,styleId,1,rect,beforeSmart,'normal');
    saveActiveToKey();recomposite(curLayer,curFrame);renderTimeline();updateStatus();return changed>0;
  }
  window.FillMaskEngine={applyMask:applyMask};
})();
