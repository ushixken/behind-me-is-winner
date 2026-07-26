(function(){
  'use strict';
  const layers=new Map();
  let resizeObserver=null;

  function worldToScreen(point){
    const pivot=(flipX||flipY)?getNavPivot():{cx:0,cy:0};
    const radians=rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    const x=point.x*zoom,y=point.y*zoom;
    let sx=x*cos-y*sin+panX,sy=x*sin+y*cos+panY;
    if(flipX)sx=pivot.cx-(sx-pivot.cx);
    if(flipY)sy=pivot.cy-(sy-pivot.cy);
    return{x:sx,y:sy};
  }

  function resize(layer){
    const rect=canvasArea.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1);
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(layer.canvas.width!==width)layer.canvas.width=width;
    if(layer.canvas.height!==height)layer.canvas.height=height;
    layer.context.setTransform(dpr,0,0,dpr,0,0);
    return{width:rect.width,height:rect.height,dpr:dpr,worldToScreen:worldToScreen};
  }

  function clear(layer){
    const context=layer.context;
    context.save();context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.globalCompositeOperation='source-over';
    context.clearRect(0,0,layer.canvas.width,layer.canvas.height);context.restore();
  }

  function render(layer){
    layer.raf=0;const geometry=resize(layer);clear(layer);
    if(!layer.visible||typeof layer.draw!=='function')return;
    layer.context.save();layer.context.setTransform(geometry.dpr,0,0,geometry.dpr,0,0);
    layer.context.globalAlpha=1;layer.context.globalCompositeOperation='source-over';
    layer.draw(layer.context,geometry);layer.context.restore();
  }
  function request(layer){if(!layer.raf)layer.raf=requestAnimationFrame(function(){render(layer);});}
  function invalidateAll(){layers.forEach(request);}

  function create(id,options){
    if(layers.has(id))return layers.get(id).api;
    options=options||{};
    const canvas=document.createElement('canvas');
    canvas.id=id;canvas.setAttribute('aria-hidden','true');
    canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:'+(options.pointerEvents||'none')+';z-index:'+(options.zIndex==null?4:options.zIndex)+';';
    canvasArea.appendChild(canvas);
    const layer={canvas:canvas,context:canvas.getContext('2d'),draw:options.draw||null,visible:false,raf:0,api:null};
    layer.api={
      canvas:canvas,context:layer.context,
      setDraw:function(draw){layer.draw=draw;request(layer);},
      setVisible:function(visible){layer.visible=!!visible;canvas.style.display=layer.visible?'block':'none';request(layer);},
      invalidate:function(){request(layer);},
      clear:function(){if(layer.raf){cancelAnimationFrame(layer.raf);layer.raf=0;}clear(layer);},
      destroy:function(){if(layer.raf)cancelAnimationFrame(layer.raf);layers.delete(id);canvas.remove();}
    };
    layers.set(id,layer);resize(layer);
    if(!resizeObserver&&window.ResizeObserver){resizeObserver=new ResizeObserver(invalidateAll);resizeObserver.observe(canvasArea);}
    return layer.api;
  }

  window.addEventListener('resize',invalidateAll);
  window.addEventListener('canvas-view-transform-changed',invalidateAll);
  if(window.visualViewport)visualViewport.addEventListener('resize',invalidateAll);
  window.EditorOverlayRenderer={create:create,invalidateAll:invalidateAll,worldToScreen:worldToScreen};
})();
