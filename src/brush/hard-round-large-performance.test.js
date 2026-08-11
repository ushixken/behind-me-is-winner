// Phase 10.0 -- pixel identity and redundant-work regressions for large brushes.
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const MathCapsule=require('./hard-round-capsule-math.js');
const {PrototypeRenderer}=require('./prototype-renderer.js');
let passed=0,failed=0;const pending=[];
function test(n,f){pending.push(Promise.resolve().then(f).then(()=>{passed++;console.log(`  ok - ${n}`)},e=>{failed++;console.error(`  FAIL - ${n}\n    ${e.stack||e}`)}));}
function ctx(w,h){const data=new Uint8ClampedArray(w*h*4);return{data,createImageData:(iw,ih)=>({data:new Uint8ClampedArray(iw*ih*4),width:iw,height:ih}),putImageData(img,dx,dy){for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const s=(y*img.width+x)*4,d=((dy+y)*w+dx+x)*4;data.set(img.data.subarray(s,s+4),d)}},clearRect(){data.fill(0)}}}
function reference(w,h,ss,segments){const bw=w*ss,bh=h*ss,cov=new Float32Array(bw*bh);for(const s of segments){const x0=s.x0*ss,y0=s.y0*ss,x1=s.x1*ss,y1=s.y1*ss,r0=s.r0*ss,r1=s.r1*ss,b=MathCapsule.capsuleBounds(x0,y0,x1,y1,r0,r1),sx=Math.max(0,b.sx),sy=Math.max(0,b.sy),ex=Math.min(bw,b.ex),ey=Math.min(bh,b.ey);for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++){const a=MathCapsule.capsuleAxisDistance(x+.5,y+.5,x0,y0,x1,y1);const c=Math.fround(MathCapsule.capsuleCoverage(x+.5,y+.5,x0,y0,r0,x1,y1,r1,s.aaMode)*(s.alpha0+(s.alpha1-s.alpha0)*a.h));const i=y*bw+x;if(c>cov[i])cov[i]=c;}}const out=new Uint8ClampedArray(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let sum=0;for(let by=0;by<ss;by++)for(let bx=0;bx<ss;bx++)sum+=cov[(y*ss+by)*bw+x*ss+bx];out[y*w+x]=Math.round(Math.max(0,Math.min(1,sum/(ss*ss)))*255);}return out;}
async function optimized(w,h,segments){const r=new PrototypeRenderer({width:w,height:h}),c=ctx(w,h);r._outCanvas={width:w,height:h};r._outCtx=c;r.beginStroke();r.drawSegments(segments);await r.endStroke();return{r,alpha:Uint8ClampedArray.from({length:w*h},(_,i)=>c.data[i*4+3])};}
function segments(size,mode='medium'){const c=130,r=size/2;return[{x0:110,y0:c,x1:126,y1:c+3,r0:r,r1:r,alpha0:1,alpha1:1,rgb:[0,0,0],aaMode:mode},{x0:126,y0:c+3,x1:142,y1:c+6,r0:r,r1:r*.96,alpha0:1,alpha1:.92,rgb:[0,0,0],aaMode:mode}];}
for(const size of [10,50,100,200])test(`${size}px optimized raster is pixel-identical to exhaustive reference`,async()=>{const s=segments(size),o=await optimized(280,280,s),ref=reference(280,280,4,s);assert.deepStrictEqual(o.alpha,ref);});
for(const size of [100,300,700,1200])test(`${size}px pressure-varying raster remains pixel-identical`,async()=>{
  const extent=size+180,c=extent/2,r=size/2;
  const pressures=[.5,.504,.501,.506,.502,.507];
  const s=[];
  for(let i=0;i<pressures.length-1;i++)s.push({
    x0:c-10+i*4,y0:c+i*.35,x1:c-6+i*4,y1:c+(i+1)*.35,
    r0:r*Math.pow(pressures[i],1.2),r1:r*Math.pow(pressures[i+1],1.2),
    alpha0:1,alpha1:1,rgb:[0,0,0],aaMode:'medium'
  });
  const o=await optimized(extent,extent,s),ref=reference(extent,extent,4,s);
  assert.deepStrictEqual(o.alpha,ref);
});
test('constant-opacity varying-radius raster does not duplicate capsule-axis work',async()=>{
  const originalAxis=MathCapsule.capsuleAxisDistance;
  let axisCalls=0,coverageCalls=0;
  MathCapsule.capsuleAxisDistance=(...args)=>{axisCalls++;return originalAxis(...args)};
  const originalCoverage=MathCapsule.capsuleCoverage;
  MathCapsule.capsuleCoverage=(...args)=>{coverageCalls++;return originalCoverage(...args)};
  try{
    await optimized(220,220,[{x0:90,y0:108,x1:130,y1:112,r0:55,r1:58,alpha0:1,alpha1:1,rgb:[0,0,0],aaMode:'medium'}]);
  }finally{
    MathCapsule.capsuleAxisDistance=originalAxis;
    MathCapsule.capsuleCoverage=originalCoverage;
  }
  // One axis query per visited sample lives inside capsuleCoverage(). Extra
  // calls are allowed only for the much smaller set of tile-level rejects.
  assert.ok(axisCalls<coverageCalls*1.1,`axis=${axisCalls}, coverage=${coverageCalls}`);
});
test('fully repeated large capsule performs no dirty resolve',async()=>{const s=[segments(200)[0]],o=await optimized(280,280,s);o.r.beginStroke();o.r.drawSegments(s);await o.r.peekStroke();o.r.drawSegments(s);const second=await o.r.peekStroke();assert.strictEqual(second.dirtyRegion,null);});
test('dirty resolve reports an exact changed subregion',async()=>{const r=new PrototypeRenderer({width:300,height:300});r._outCanvas={};r._outCtx=ctx(300,300);r.beginStroke();r.drawSegments([segments(100)[0]]);const p=await r.peekStroke();assert.ok(p.dirtyRegion&&p.dirtyRegion.width<300&&p.dirtyRegion.height<300);});
test('live preview copies only the resolved dirty rectangle',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/drawImage\(result\.canvas,dirty\.x,dirty\.y,dirty\.width,dirty\.height,dirty\.x,dirty\.y,dirty\.width,dirty\.height\)/.test(src));});
test('compatible AA-On topmost Hard Round uses direct GPU overlay while lower layers stay layer-aware',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/new window\.PrototypeRenderer\(\{width:w, height:h, preferGpu:true\}\)/.test(src));assert.ok(/const gpuLiveCompatible=hardRoundAaMode!==['"]off['"]&&hardRoundAaMode!==['"]none['"]/.test(src));assert.ok(/!_hardRoundHasVisibleLayerAbove\(curLayer,curFrame\)/.test(src));assert.ok(/hardRoundRenderer\.preferGpu=gpuLiveCompatible/.test(src));assert.ok(/presentation\.presented!==true[\s\S]*?_hardRoundSetGpuOverlayVisible\(true,'presentLivePreview-accepted-frame'\)/.test(src));});
test('GPU live presentation stays GPU-to-GPU without per-frame readback',()=>{const src=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');assert.ok(/else return this\.gpu\.present\(/.test(src));assert.ok(/if \(readback\) \{[\s\S]*?await this\.gpu\.resolveInto\(/.test(src));assert.ok(/outputContext\.getCurrentTexture\(\)/.test(src));});
test('GPU preview waits for presentation before its canvas is exposed',()=>{const src=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');assert.ok(/await this\.device\.queue\.onSubmittedWorkDone\(\)/.test(src));assert.ok(/return this\.gpu\.present\(this\._rgb, this\._composite, this\.presentationOpacity, meta\)/.test(src));});
test('GPU live frames avoid readback and pointer-up performs one authoritative readback',()=>{const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8'),renderer=fs.readFileSync(path.join(__dirname,'prototype-renderer.js'),'utf8');assert.ok(/renderer\.endStroke\(\{readback:context\.gpuCommit/.test(engine));assert.ok(/if \(readback\) \{[\s\S]*?await this\.gpu\.resolveInto/.test(renderer));assert.ok(/else return this\.gpu\.present/.test(renderer));});
test('document-space GPU overlay is present in the transformed canvas stack',()=>{const html=fs.readFileSync(path.join(__dirname,'..','..','index.html'),'utf8'),css=fs.readFileSync(path.join(__dirname,'..','..','style.css'),'utf8');assert.ok(/id="hard-round-gpu-overlay"/.test(html));assert.ok(/#hard-round-gpu-overlay\{pointer-events:none;z-index:1;\}/.test(css));});
Promise.all(pending).then(()=>{console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1)});
