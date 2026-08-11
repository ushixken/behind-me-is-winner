const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'palette.js'),'utf8');

function isPrimaryPalettePointer(event){
  if(!event||event.isPrimary===false)return false;
  const pointerType=event.pointerType||'mouse';
  if(pointerType==='pen')return !!(event.buttons&1);
  if(pointerType==='mouse')return event.button===0;
  return event.button===undefined||event.button===0;
}

test('mouse and pen primary contact can start palette reorder',()=>{
  assert.equal(isPrimaryPalettePointer({pointerType:'mouse',button:0,isPrimary:true}),true);
  assert.equal(isPrimaryPalettePointer({pointerType:'pen',button:-1,buttons:1,isPrimary:true}),true);
  assert.equal(isPrimaryPalettePointer({pointerType:'pen',button:0,buttons:1,isPrimary:true}),true);
  assert.equal(isPrimaryPalettePointer({pointerType:'pen',button:-1,buttons:0,isPrimary:true}),false);
  assert.equal(isPrimaryPalettePointer({pointerType:'mouse',button:2,isPrimary:true}),false);
});

test('pen tap selects without reordering until hold activation',()=>{
  assert.match(source,/activatePaletteSwatch\(swatch\.id,\{select:true,setForeground:true\}\)/);
  assert.match(source,/holdTimer=setTimeout\(\(\)=>activatePaletteDrag\(pendingDrag\),PALETTE_REORDER_HOLD_MS\)/);
  assert.match(source,/if\(state\.active&&!cancelled\)/);
});

test('pointerup and cancel share cleanup without duplicate mouse drag handlers',()=>{
  assert.match(source,/document\.addEventListener\('pointerup',onDragEnd\)/);
  assert.match(source,/document\.addEventListener\('pointercancel',onDragEnd\)/);
  assert.match(source,/finishPaletteDrag\(event,event\.type==='pointercancel'\)/);
  assert.doesNotMatch(source,/\.addEventListener\(['"]mousedown['"]/);
  assert.doesNotMatch(source,/\.addEventListener\(['"]dragend['"]/);
});

test('normal and advanced palettes use the shared device-aware gate',()=>{
  const calls=source.match(/isPrimaryPalettePointer\(event\)/g)||[];
  assert.ok(calls.length>=3);
  assert.match(source,/if\(pointerType==='pen'\)return !!\(event\.buttons&1\)/);
});
