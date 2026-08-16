// Phase 9F.2 -- AA-Off light-pressure forward/reverse scrub stability.
'use strict';
const assert=require('assert');
const {PrototypeRenderer}=require('../../../prototype-renderer.js');
const {PrototypeStrokeCore,pressureInfluence}=require('../../../prototype-stroke-core.js');
const {resolveEffectiveRadius}=require('../../../hard-round-adapter.js');
let passed=0,failed=0;const pending=[];
function test(n,f){pending.push(Promise.resolve().then(f).then(()=>{passed++;console.log(`  ok - ${n}`)},e=>{failed++;console.error(`  FAIL - ${n}\n    ${e.stack||e}`)}));}
function fakeCtx(w,h){const data=new Uint8ClampedArray(w*h*4);return{data,createImageData:(iw,ih)=>({data:new Uint8ClampedArray(iw*ih*4),width:iw,height:ih}),putImageData(img,dx,dy){for(let y=0;y<img.height;y++)for(let x=0;x<img.width;x++){const s=(y*img.width+x)*4,d=((dy+y)*w+dx+x)*4;data.set(img.data.subarray(s,s+4),d)}},clearRect(){data.fill(0)}}}
function segs(points,r=.05,mode='off'){return points.slice(1).map((p,i)=>({x0:points[i][0],y0:points[i][1],x1:p[0],y1:p[1],r0:r,r1:r,alpha0:1,alpha1:1,rgb:[0,0,0],composite:'paint',hardness:1,aaMode:mode}));}
async function render(points,r=.05,mode='off'){const w=180,h=180,x=new PrototypeRenderer({width:w,height:h});x._outCanvas={width:w,height:h};x._outCtx=fakeCtx(w,h);const s=segs(points,r,mode);s[0].isStrokeStart=true;s[s.length-1].isStrokeEnd=true;x.beginStroke();x.drawSegments(s);await x.endStroke();return x;}
const line=(a,b,n=180)=>Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);
const curve=(fn,n=260)=>Array.from({length:n+1},(_,i)=>fn(i/n));
const paths={shallow:line([12,30],[165,78]),vertical:line([55,10],[82,168]),diagonal45:line([12,12],[165,165]),C:curve(t=>[15+150*t,45+35*Math.sin(Math.PI*t)]),S:curve(t=>[15+150*t,88+30*Math.sin(2*Math.PI*t)])};
const pixels=r=>{const s=new Set();for(let i=3;i<r._outCtx.data.length;i+=4)if(r._outCtx.data[i])s.add((i-3)/4);return s};
function equalPixels(a,b,label){assert.deepStrictEqual([...pixels(a)].sort((x,y)=>x-y),[...pixels(b)].sort((x,y)=>x-y),label)}
function scrub(p,n=4){const out=p.slice();for(let i=1;i<n;i++)out.push(...(i%2?p.slice().reverse():p).slice(1));return out}
function binary(r){for(let i=3;i<r._outCtx.data.length;i+=4)assert.ok(r._outCtx.data[i]===0||r._outCtx.data[i]===255)}
function connected(r){const ink=pixels(r),todo=[ink.values().next().value],seen=new Set(),w=r.width;while(todo.length){const p=todo.pop();if(seen.has(p))continue;seen.add(p);const x=p%w,y=Math.floor(p/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=(y+dy)*w+x+dx;if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<r.height&&ink.has(q)&&!seen.has(q))todo.push(q)}}assert.strictEqual(seen.size,ink.size)}

for(const [name,p] of Object.entries(paths))test(`${name}: forward and reverse produce identical pixels`,async()=>equalPixels(await render(p),await render(p.slice().reverse()),name));
for(const name of ['shallow','vertical','diagonal45','C','S'])test(`${name}: repeated scrub does not widen one-pass footprint`,async()=>{const one=await render(paths[name]),many=await render(scrub(paths[name]));equalPixels(one,many,name);binary(many);connected(many);});
test('reversal reuses station lanes instead of creating doubled ownership',async()=>{const r=await render(scrub(paths.shallow,6));for(const lanes of r.cpu._stationBuckets.values())assert.strictEqual(lanes.length,1);for(const [key,w] of r.cpu._stationWinners){const owners=r.cpu._winnerPixels.get(w.oy*r.width+w.ox);assert.ok(owners&&owners.has(key));}});
test('constant pressure resolves to a constant prototype radius during rapid scribble',()=>{const p=.01,expected=.05,core=new PrototypeStrokeCore({brushSize:10,stabilization:.3,zoom:1});core.beginStroke({x:12,y:30,pressure:p,pointerType:'pen',timeStamp:0});let t=0,count=0;for(const pt of scrub(paths.shallow,4).slice(1)){t+=2;for(const s of core.pushSamples([{x:pt[0],y:pt[1],pressure:p,pointerType:'pen',timeStamp:t}])){for(const pressure of [s.pressure0,s.pressure1]){const r=resolveEffectiveRadius({baseSize:10,curveKey:'linear',pressure,influence:pressureInfluence(pressure),matchPrototypePressure:true});assert.strictEqual(r,expected);count++;}}}assert.ok(count>100);});
test('higher-pressure repeated traversal remains idempotent',async()=>equalPixels(await render(paths.C,1.2),await render(scrub(paths.C),1.2)));
for(const mode of ['weak','medium','strong'])test(`${mode} AA repeated traversal remains unchanged/idempotent`,async()=>equalPixels(await render(paths.S,.05,mode),await render(scrub(paths.S),.05,mode),mode));

Promise.all(pending).then(()=>{console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1)});
