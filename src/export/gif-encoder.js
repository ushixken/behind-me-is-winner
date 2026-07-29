(function(){
  'use strict';

  const workerScript='assets/vendor/gif.js/gif.worker.js';

  async function encode(options){
    if(typeof window.GIF!=='function')throw new Error('GIF encoder is not installed.');
    const frames=Array.isArray(options.frames)?options.frames:[];
    if(!frames.length)throw new Error('There are no frames to encode.');

    const quality=Math.max(1,Math.min(30,Math.round(31-(Number(options.quality)||0.9)*30)));
    const encoder=new GIF({
      workers:Math.max(1,Math.min(4,navigator.hardwareConcurrency||2)),
      quality,
      width:options.width,
      height:options.height,
      workerScript,
      repeat:options.loop===false?-1:0
    });
    const delay=Math.max(10,Math.round(1000/Math.max(1,Number(options.fps)||24)));
    frames.forEach(frame=>encoder.addFrame(frame,{copy:true,delay}));

    return new Promise((resolve,reject)=>{
      encoder.on('finished',resolve);
      encoder.on('abort',()=>reject(new DOMException('Cancelled','AbortError')));
      try{encoder.render();}catch(error){reject(error);}
    });
  }

  window.ExportEncoders=window.ExportEncoders||{};
  window.ExportEncoders.gif={encode};
})();
