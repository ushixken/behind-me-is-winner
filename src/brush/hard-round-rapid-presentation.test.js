const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=fs.readFileSync(path.join(__dirname,'brush-engine.js'),'utf8');
const cursorPrefs=fs.readFileSync(path.join(__dirname,'..','ui','cursor-prefs.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'..','..','style.css'),'utf8');

test('new GPU strokes retain the preceding overlay until its commit is visible',()=>{
  assert.match(engine,/presentationBarrier:_hardRoundCommitTail/);
  assert.match(engine,/preservePriorUntilCommit=.*_hardRoundPendingCommitCount>0/);
  assert.match(engine,/preserve-prior-until-commit/);
  assert.match(engine,/Promise\.resolve\(presentationBarrier\)[\s\S]*?renderer\.peekStroke/);
});

test('committed replacement retires only the overlay pixels belonging to that stroke',()=>{
  assert.match(engine,/window\.HardRoundOverlayPresentedStrokeId=session/);
  assert.match(engine,/window\.HardRoundOverlayPresentedStrokeId===ready\.strokeId/);
  assert.match(engine,/owned-finalization-retire-committed-overlay/);
  assert.match(engine,/if\(!visible\)window\.HardRoundOverlayPresentedStrokeId=null/);
});

test('RAF callbacks and async completions own immutable session tokens',()=>{
  assert.match(engine,/const scheduledSession=_activeStrokeSession/);
  assert.match(engine,/if\(scheduledSession!==_activeStrokeSession\|\|!_inStroke\)return/);
  assert.match(engine,/const flightToken=\{sessionId:scheduledSession,renderer\}/);
  assert.match(engine,/if\(_hardRoundPreviewInFlightToken!==flightToken\)return/);
  assert.match(engine,/if\(_hardRoundPreviewRAFSession===_activeStrokeSession\)return/);
});

test('a stale queued RAF is replaced rather than consuming the next stroke request',()=>{
  assert.match(engine,/cancelAnimationFrame\(_hardRoundPreviewRAF\);\s*_hardRoundPreviewRAF=null;\s*_hardRoundPreviewRAFSession=null/);
});

test('normal brush native cursor remains hidden and GPU overlay cannot become hit target',()=>{
  assert.match(cursorPrefs,/if\(paintTool&&\(cursorStyle==='crosshair'[\s\S]*?return 'none'/);
  assert.match(css,/#hard-round-gpu-overlay\{pointer-events:none;z-index:1;\}/);
  assert.doesNotMatch(engine,/hard-round-gpu-overlay[^\n]*pointerEvents\s*=\s*['"]auto/);
});

test('adversarial old completion cannot clear a newer flight token',async()=>{
  let currentToken=null,inFlight=false;
  let releaseOld;
  const old=new Promise(resolve=>{releaseOld=resolve;});
  const finish=(token,promise)=>promise.finally(()=>{if(currentToken!==token)return;inFlight=false;currentToken=null;});
  const oldToken={sessionId:1};currentToken=oldToken;inFlight=true;const oldDone=finish(oldToken,old);
  const newToken={sessionId:2};currentToken=newToken;inFlight=true;
  releaseOld();await oldDone;
  assert.equal(currentToken,newToken);
  assert.equal(inFlight,true);
});
