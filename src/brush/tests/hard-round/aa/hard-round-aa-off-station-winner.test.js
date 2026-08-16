// Phase 9E.11 -- station-level AA-Off floor-regime winner regressions.
'use strict';
const assert = require('assert');
const { PrototypeRenderer } = require('../../../prototype-renderer.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) { pending.push(Promise.resolve().then(fn).then(() => { passed++; console.log(`  ok - ${name}`); }, e => { failed++; console.error(`  FAIL - ${name}\n    ${e.stack || e}`); })); }
function ctx(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  return { data, createImageData(cw, ch) { return { data: new Uint8ClampedArray(cw * ch * 4), width: cw, height: ch }; },
    putImageData(img, dx, dy) { for (let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){const s=(y*img.width+x)*4,d=((dy+y)*w+dx+x)*4;data.set(img.data.subarray(s,s+4),d);} },
    clearRect(){data.fill(0);} };
}
function renderer(w=160,h=160){const r=new PrototypeRenderer({width:w,height:h});r._outCanvas={width:w,height:h};r._outCtx=ctx(w,h);return r;}
function segments(points, radius=0.25, aaMode='off') { return points.slice(1).map((p,i)=>({x0:points[i][0],y0:points[i][1],x1:p[0],y1:p[1],r0:radius,r1:radius,alpha0:1,alpha1:1,rgb:[0,0,0],composite:'paint',hardness:1,aaMode})); }
function line(a,b,n=180){return Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n]);}
function curve(fn,n=260){return Array.from({length:n+1},(_,i)=>fn(i/n));}
async function draw(points,radius=0.25,aaMode='off',w=160,h=160){const r=renderer(w,h),s=segments(points,radius,aaMode);s[0].isStrokeStart=true;s[s.length-1].isStrokeEnd=true;r.beginStroke();r.drawSegments(s);await r.endStroke();return r;}
function assertStationInvariant(r,label){assert.ok(r.cpu._stationWinners.size>0,`${label}: expected floor stations`);const keys=new Set();for(const [key,w] of r.cpu._stationWinners){assert.ok(!keys.has(key),`${label}: duplicate station ${key}`);keys.add(key);assert.ok(Number.isFinite(w.distance));}for(const owners of r.cpu._winnerPixels.values())for(const key of owners.keys())assert.ok(r.cpu._stationWinners.has(key),`${label}: stale pixel owner`);}
function assertBinary(r,label){for(let i=3;i<r._outCtx.data.length;i+=4)assert.ok(r._outCtx.data[i]===0||r._outCtx.data[i]===255,`${label}: non-binary alpha ${r._outCtx.data[i]}`);}
function assertConnected(r,label){const w=r.width,h=r.height,ink=new Set();for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(r._outCtx.data[(y*w+x)*4+3])ink.add(y*w+x);assert.ok(ink.size,`${label}: no ink`);const seen=new Set(),todo=[ink.values().next().value];while(todo.length){const p=todo.pop();if(seen.has(p))continue;seen.add(p);const x=p%w,y=Math.floor(p/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=(y+dy)*w+x+dx;if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&ink.has(q)&&!seen.has(q))todo.push(q);}}assert.strictEqual(seen.size,ink.size,`${label}: output has a gap`);}

const CASES = [
  ['straight shallow diagonal', line([8,20],[145,62])],
  ['straight steep diagonal', line([20,8],[62,145])],
  ['exact 45 degrees', line([8,8],[145,145])],
  ['gentle C curve', curve(t=>[12+136*t,42+34*Math.sin(Math.PI*t)])],
  ['S curve', curve(t=>[12+136*t,78+28*Math.sin(2*Math.PI*t)])],
  ['tight curve', curve(t=>[80+48*Math.cos(0.25+1.5*Math.PI*t),80+48*Math.sin(0.25+1.5*Math.PI*t)])],
  ['curve crossing 45-degree boundary', curve(t=>[12+136*t,18+118*t*t])],
];
for(const [name,points] of CASES) test(`${name}: exactly one stored winner per local major-axis station`,async()=>{const r=await draw(points);assertStationInvariant(r,name);assertBinary(r,name);assertConnected(r,name);});

test('45-degree crossing reproduction has overlapping contenders but only one winner per station',async()=>{const r=await draw(CASES[6][1]);assert.ok([...r.cpu._stationWinners.values()].some(w=>w.contenders>1),'expected overlapping segments to compete at a station');assertStationInvariant(r,'45 crossing reproduction');});

for(const radius of [0.15,0.35,0.49]) test(`constant light pressure radius ${radius}: binary station winners`,async()=>{const r=await draw(CASES[4][1],radius);assertStationInvariant(r,`r=${radius}`);assertBinary(r,`r=${radius}`);});

test('streamed live preview replaces a losing station pixel and matches final resolve',async()=>{const r=renderer(),s=segments(CASES[6][1]);s[0].isStrokeStart=true;s[s.length-1].isStrokeEnd=true;r.beginStroke();for(let i=0;i<s.length;i+=17){r.drawSegments(s.slice(i,i+17));await r.peekStroke();assertBinary(r,'preview');}await r.endStroke();assertStationInvariant(r,'streamed crossing');assertBinary(r,'final');});

test('slightly larger/above-floor pressure bypasses the station pass',async()=>{const r=await draw(CASES[0][1],0.75);assert.strictEqual(r.cpu._stationWinners.size,0);});

for(const mode of ['weak','medium','strong']) test(`${mode} AA remains outside station pass`,async()=>{const r=await draw(CASES[3][1],0.25,mode);assert.strictEqual(r.cpu._stationWinners.size,0);assert.ok([...r._outCtx.data].filter((_,i)=>i%4===3).some(a=>a>0&&a<255),`${mode}: expected antialiased alpha`);});

test('fast flick taper, 1px tips, and connectivity remain intact',async()=>{const pts=line([8,20],[145,70],35),s=segments(pts,0.25);for(let i=0;i<s.length;i++){s[i].r0=Math.max(.03,.25*(1-i/s.length));s[i].r1=Math.max(.03,.25*(1-(i+1)/s.length));}s[0].isStrokeStart=true;s[s.length-1].isStrokeEnd=true;const r=renderer();r.beginStroke();r.drawSegments(s);await r.endStroke();assertBinary(r,'flick');const occupied=[];for(let x=0;x<160;x++){let n=0;for(let y=0;y<160;y++)if(r._outCtx.data[(y*160+x)*4+3])n++;if(n)occupied.push(n);}assert.ok(occupied.length>100,'flick: expected connected major-axis span');assert.strictEqual(occupied[0],1,'start tip');assert.strictEqual(occupied[occupied.length-1],1,'end tip');});

Promise.all(pending).then(()=>{console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1);});
