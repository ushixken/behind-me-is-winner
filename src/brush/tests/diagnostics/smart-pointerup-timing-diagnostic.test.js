const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const brush=fs.readFileSync(path.join(__dirname, '..', '..', 'brush-engine.js'),'utf8');
const cursor=fs.readFileSync(path.join(__dirname, '..', '..', 'brush-size-cursor.js'),'utf8');

test('Smart pointerup timing is default-off, bounded, and adds no readback',()=>{
  assert.match(brush,/typeof window\.HardRoundDebugSmartPointerupTiming==='undefined'/);
  assert.match(brush,/if\(!window\.HardRoundDebugSmartPointerupTiming\)return null/);
  assert.match(brush,/length>20\)_hardRoundSmartPointerupTimingRecords\.shift/);
  const diagnostic=brush.slice(brush.indexOf("if(typeof window.HardRoundDebugSmartPointerupTiming"),brush.indexOf('function _commitFinishedHardRoundStroke'));
  assert.doesNotMatch(diagnostic,/getImageData|console\./);
});

test('existing Smart operations receive individual timing boundaries',()=>{
  for(const field of ['ownershipBeforeMs','endStrokeSyncSetupMs','maskCopyMs','smartCommitMs','saveMs','recompositeMs'])assert.match(brush,new RegExp("'"+field+"'"));
  assert.match(brush,/HardRoundAnalyzeSmartPointerupTiming/);
  assert.match(brush,/smartVsNormalDifference/);
});

test('first post-up pen event and cursor apply are correlated',()=>{
  assert.match(cursor,/HardRoundSmartPointerupTimingNote\('pen-event',event\)/);
  assert.match(cursor,/HardRoundSmartPointerupTimingNote\('cursor-apply'/);
  assert.match(brush,/firstPostUpPenEvent/);
  assert.match(brush,/firstCursorApply/);
});
