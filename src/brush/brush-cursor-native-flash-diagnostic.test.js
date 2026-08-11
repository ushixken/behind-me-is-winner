const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const cursor=fs.readFileSync(path.join(__dirname,'brush-size-cursor.js'),'utf8');
const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
const core=fs.readFileSync(path.join(__dirname,'..','core','core-state.js'),'utf8');
const prefs=fs.readFileSync(path.join(__dirname,'..','ui','cursor-prefs.js'),'utf8');

test('native-flash diagnostic is default-off, bounded and event-driven',()=>{
  assert.match(cursor,/BrushCursorDebugNativeFlash==='undefined'\)window\.BrushCursorDebugNativeFlash=false/);
  assert.match(cursor,/if\(!window\.BrushCursorDebugNativeFlash\)return/);
  assert.match(cursor,/if\(log\.length>200\)log\.splice/);
  assert.doesNotMatch(cursor,/MutationObserver/);
  assert.match(cursor,/BrushCursorAnalyzeNativeFlash/);
});

test('diagnostic captures target, computed cursor, visibility and capture state',()=>{
  for(const field of ['elementFromPointId','activeCanvasCursorInline','activeCanvasCursorComputed','bodyCursorComputed','customCursorVisible','pointerCapture','inStroke','hardRoundStrokeActive'])assert.match(cursor,new RegExp(field));
});

test('drawing cursor and navigation cursor write paths emit explicit notes',()=>{
  assert.match(prefs,/BrushCursorNativeFlashNoteWrite/);
  assert.match(core,/function _writeNavigationCursor/);
  assert.match(core,/BrushCursorNativeFlashNoteWrite/);
});

test('rapid presentation lifecycle counts commits without pixel diagnostics',()=>{
  assert.match(engine,/HardRoundDebugRapidPresentation==='undefined'\)window\.HardRoundDebugRapidPresentation=false/);
  assert.match(engine,/HardRoundAnalyzeRapidPresentation/);
  for(const event of ['commitStarted','readbackCompleted','commitCompleted','recompositeCompleted','finalizerCompleted'])assert.match(engine,new RegExp("'"+event+"'"));
  const diagnosticStart=engine.indexOf('if(typeof window.HardRoundDebugRapidPresentation');
  const diagnostic=engine.slice(diagnosticStart,engine.indexOf('// Phase 10.1:',diagnosticStart));
  assert.doesNotMatch(diagnostic,/getImageData|toDataURL|readPixels|mapAsync/);
});
