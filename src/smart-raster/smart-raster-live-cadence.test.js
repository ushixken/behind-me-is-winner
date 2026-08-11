const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const engine=fs.readFileSync(path.join(__dirname,'..','brush','brush-engine.js'),'utf8');
const cursor=fs.readFileSync(path.join(__dirname,'..','brush','brush-size-cursor.js'),'utf8');
const smartSources=['smart-raster-typed.js','smart-raster-v4-shadow.js'].map(name=>fs.readFileSync(path.join(__dirname,name),'utf8')).join('\n');

test('expensive Smart previews have no raster-duration timeout',()=>{
  assert.doesNotMatch(engine,/rasterMs>8\?Math\.min\(50,rasterMs\):0/);
  assert.doesNotMatch(engine,/_hardRoundPreviewTimer/);
  assert.doesNotMatch(engine,/_hardRoundPreviewNotBefore/);
});

test('one pending or in-flight preview coalesces input into one newest-state follow-up',()=>{
  assert.match(engine,/if\(_hardRoundPreviewInFlight\)\{_hardRoundPreviewNeedsFollowup=true;return;\}/);
  assert.match(engine,/if\(_hardRoundPreviewRAF !== null\)\{[\s\S]*?_hardRoundPreviewRAFSession===_activeStrokeSession/);
  assert.match(engine,/Promise\.resolve\(_hardRoundPresentLivePreview\(renderer\)\)\.finally/);
  assert.match(engine,/if\(_hardRoundPreviewInFlightToken!==flightToken\)return/);
  assert.match(engine,/needsFollowup&&requestedRenderer&&_hardRoundPreviewSession===_activeStrokeSession&&_inStroke/);
});

test('pending geometry is drained without dropping and follow-up is session safe',()=>{
  assert.match(engine,/_hardRoundPendingRenderSegments\.splice\(0,_hardRoundPendingRenderSegments\.length\)/);
  assert.match(engine,/_hardRoundPreviewNeedsFollowup\|\|_hardRoundPendingRenderSegments\.length>0/);
  assert.match(engine,/previewGeneration!==_hardRoundPreviewGeneration/);
  assert.match(engine,/scheduledSession!==_activeStrokeSession\|\|!_inStroke/);
});

test('Smart preview code never switches to a native default or system cursor',()=>{
  assert.doesNotMatch(smartSources,/style\.cursor\s*=/);
  assert.match(cursor,/function _baseCursorCSS|cursorCanvas/);
  assert.doesNotMatch(smartSources,/cursorCanvas\.style\.display/);
});

test('existing Smart CPU renderer and cadence-independent semantics remain selected',()=>{
  assert.match(engine,/!\(layers\[curLayer\]&&layers\[curLayer\]\.type==='smart-raster'\)/);
  assert.match(engine,/SmartRasterV4LivePaintPreview/);
});
