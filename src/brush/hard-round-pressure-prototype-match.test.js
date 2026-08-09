// Phase 9F.1 -- prototype-exact pressure-only radius mapping.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pressureInfluence, normalizeRawPressure, PrototypeStrokeCore } = require('./prototype-stroke-core.js');
const { resolveEffectiveRadius, resolveSegmentRenderParams } = require('./hard-round-adapter.js');

const PRESSURES=[0,.01,.02,.03,.05,.10,.15,.20,.30,.50,.75,1];
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log(`  ok - ${name}`);}catch(e){failed++;console.error(`  FAIL - ${name}\n    ${e.stack||e}`);}}
function prototypeRadius(size,p){const full=size/2*(size<=1?.5:1);return Math.max(.05,full*Math.pow(Math.max(0,Math.min(1,p)),1.2));}
function mainRadius(size,p){return resolveEffectiveRadius({baseSize:size,minSizeFrac:.05,curveKey:'linear',pressure:p,influence:pressureInfluence(p),matchPrototypePressure:true});}

test('requested numeric pressure samples match the prototype exactly',()=>{for(const size of [1,2,10,28])for(const p of PRESSURES)assert.ok(Math.abs(mainRadius(size,p)-prototypeRadius(size,p))<1e-12,`size=${size}, pressure=${p}`);});
test('raw pen normalization and influence match at every numeric sample',()=>{for(const p of PRESSURES){const normalized=normalizeRawPressure('pen',p);assert.strictEqual(normalized,p);assert.strictEqual(pressureInfluence(normalized),Math.pow(p,1.2));}});
test('prototype mode ignores the main 5% minimum-size floor',()=>{assert.strictEqual(mainRadius(10,0),.05);assert.strictEqual(mainRadius(10,.01),.05);});
test('nominal 1px brush uses prototype half-scale full radius',()=>{assert.strictEqual(mainRadius(1,1),.25);});
test('medium and large brushes retain exact full-pressure widths',()=>{assert.strictEqual(mainRadius(10,1),5);assert.strictEqual(mainRadius(28,1),14);});
test('radius-only change leaves endpoint alpha untouched',()=>{const seg={x0:0,y0:0,x1:1,y1:0,pressure0:.01,influence0:pressureInfluence(.01),pressure1:1,influence1:1};const out=resolveSegmentRenderParams(seg,{baseSize:10,minSizeFrac:.05,curveKey:'linear',matchPrototypePressure:true,getEffectiveAlpha:()=>.73});assert.strictEqual(out.alpha0,.73);assert.strictEqual(out.alpha1,.73);assert.strictEqual(out.r0,.05);assert.strictEqual(out.r1,5);});
test('constant pressure remains constant through stroke smoothing and mapping',()=>{const core=new PrototypeStrokeCore({brushSize:10,stabilization:.5,zoom:1});core.beginStroke({x:0,y:0,pressure:.03,pointerType:'pen',timeStamp:0});const radii=[];for(let i=1;i<=40;i++)for(const s of core.pushSamples([{x:i*2,y:0,pressure:.03,pointerType:'pen',timeStamp:i*8}]))radii.push(mainRadius(10,s.pressure1));assert.ok(radii.length);for(const r of radii)assert.ok(Math.abs(r-prototypeRadius(10,.03))<1e-12);});
function ramp(stepMs){const core=new PrototypeStrokeCore({brushSize:10,stabilization:.4,zoom:1});core.beginStroke({x:0,y:0,pressure:0,pointerType:'pen',timeStamp:0});const pairs=[];for(let i=1;i<=50;i++){const p=i/50;for(const s of core.pushSamples([{x:i*2,y:0,pressure:p,pointerType:'pen',timeStamp:i*stepMs}]))pairs.push([s.pressure1,mainRadius(10,s.pressure1)]);}return pairs;}
for(const [name,ms] of [['slow',16],['fast',2]])test(`${name} pressure ramp uses prototype radius for every smoothed sample`,()=>{const pairs=ramp(ms);assert.ok(pairs.length);for(const [p,r] of pairs)assert.ok(Math.abs(r-prototypeRadius(10,p))<1e-12);for(let i=1;i<pairs.length;i++)assert.ok(pairs[i][1]>=pairs[i-1][1]-1e-12);});
test('migrated Hard Round call site enables prototype pressure mapping',()=>{const src=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');assert.ok(/matchPrototypePressure:\s*true/.test(src));});

console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exit(1);
