(function(){
  'use strict';
  var BLANK_CM=0x000000FF;
  function packCM(ink,paint,tone){return ((((ink&0xFFF)<<20)|((paint&0xFFF)<<8)|(tone&0xFF))>>>0);}
  function getInk(pixel){return (pixel>>>20)&0xFFF;}
  function getPaint(pixel){return (pixel>>>8)&0xFFF;}
  function getTone(pixel){return pixel&0xFF;}
  function makeMeta(){return {indexToStyleId:{},styleIdToIndex:{},nextIndex:1};}
  function ensureFrame(li,fi){
    if(li==null)li=curLayer;if(fi==null)fi=curFrame;
    var layer=layers[li];if(!layer||layer.type!=='smart-raster')return null;
    if(!layer.cmFrames)layer.cmFrames={};
    if(!layer.indexMeta)layer.indexMeta={};
    if(!layer.indexMeta[fi])layer.indexMeta[fi]=makeMeta();
    var frame=layer.cmFrames[fi];
    if(!frame||frame.width!==CW||frame.height!==CH||!(frame.pixels instanceof Uint32Array)){
      var pixels=new Uint32Array(CW*CH);pixels.fill(BLANK_CM);
      frame=layer.cmFrames[fi]={width:CW,height:CH,pixels:pixels};
    }
    return frame;
  }
  function styleRGBA(meta,index){
    if(index===0)return [0,0,0,0];
    var id=meta&&meta.indexToStyleId&&meta.indexToStyleId[index];
    var style=id&&window.PaletteDocker&&typeof window.PaletteDocker.findAdvancedStyleById==='function'?window.PaletteDocker.findAdvancedStyleById(id):null;
    return style&&Array.isArray(style.rgba)?style.rgba:[0,0,0,0];
  }
  function blend(ink,paint,tone,out,o){
    var iw=255-tone,ia=ink[3]==null?255:ink[3],pa=paint[3]==null?255:paint[3];
    var alpha=(ia*iw+pa*tone)/255;
    if(alpha<=0){out[o]=out[o+1]=out[o+2]=out[o+3]=0;return;}
    out[o]=Math.round((ink[0]*ia*iw+paint[0]*pa*tone)/(255*alpha));
    out[o+1]=Math.round((ink[1]*ia*iw+paint[1]*pa*tone)/(255*alpha));
    out[o+2]=Math.round((ink[2]*ia*iw+paint[2]*pa*tone)/(255*alpha));
    out[o+3]=Math.round(alpha);
  }
  function renderFrame(li,fi,target){
    if(li==null)li=curLayer;if(fi==null)fi=curFrame;
    var layer=layers[li],frame=layer&&layer.cmFrames&&layer.cmFrames[fi],meta=layer&&layer.indexMeta&&layer.indexMeta[fi];
    if(!frame||!meta||!target||frame.width!==target.width||frame.height!==target.height)return false;
    var context=target.getContext('2d',{willReadFrequently:true}),image=context.createImageData(frame.width,frame.height),out=image.data,cache={0:[0,0,0,0]};
    for(var i=0;i<frame.pixels.length;i++){
      var pixel=frame.pixels[i],inkIndex=getInk(pixel),paintIndex=getPaint(pixel);
      var ink=cache[inkIndex]||(cache[inkIndex]=styleRGBA(meta,inkIndex));
      var paint=cache[paintIndex]||(cache[paintIndex]=styleRGBA(meta,paintIndex));
      blend(ink,paint,getTone(pixel),out,i*4);
    }
    context.putImageData(image,0,0);return true;
  }
  function check(pixel,ink,paint,tone){if(getInk(pixel)!==ink||getPaint(pixel)!==paint||getTone(pixel)!==tone)throw new Error('Smart Raster CM packing check failed');}
  check(packCM(0,0,255),0,0,255);check(packCM(1,0,0),1,0,0);check(packCM(4095,4095,255),4095,4095,255);
  window.SmartRasterCM={packCM:packCM,getInk:getInk,getPaint:getPaint,getTone:getTone,ensureFrame:ensureFrame,renderFrame:renderFrame,blankPixel:BLANK_CM};

})();
