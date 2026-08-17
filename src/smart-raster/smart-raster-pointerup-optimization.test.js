const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const renderer = fs.readFileSync(
  path.join(__dirname, "..", "brush", "prototype-renderer.js"),
  "utf8",
);
const smart = fs.readFileSync(
  path.join(__dirname, "smart-raster-typed.js"),
  "utf8",
);
const engine = fs.readFileSync(
  path.join(__dirname, "..", "brush", "brush-engine.js"),
  "utf8",
);
const panels = fs.readFileSync(
  path.join(__dirname, "..", "ui", "panels.js"),
  "utf8",
);
const core = fs.readFileSync(
  path.join(__dirname, "..", "core", "core-state.js"),
  "utf8",
);
const shadow = fs.readFileSync(
  path.join(__dirname, "smart-raster-v4-shadow.js"),
  "utf8",
);

test("CPU endStroke consumes only remaining dirty coverage", () => {
  assert.match(
    renderer,
    /!this\._usingGpu && !readback\) dirtyRegion = this\.cpu\.resolveDirtyInto/,
  );
  assert.match(renderer, /else await this\._resolveToOutput\(readback\)/);
});

test("Smart ownership updates are dirty-scoped without a full-frame styleIds clone", () => {
  const commit = smart.slice(
    smart.indexOf("function commitBrushMask"),
    smart.indexOf("function clearWhereTransparent"),
  );
  assert.match(commit, /var nextIds=frame\.styleIds/);
  assert.doesNotMatch(commit, /frame\.styleIds\.slice\(\)/);
  assert.match(
    commit,
    /for\(var row=0;row<height;row\+\+\)for\(var col=0;col<width;col\+\+\)/,
  );
});

test("diagnostics break down CPU resolve and Smart commit without new reads", () => {
  assert.match(renderer, /imageDataMs,resolveLoopMs:loopMs,putImageDataMs/);
  assert.match(
    smart,
    /maskReadMs:0,artworkReadMs:0,styleIdsCloneMs:0,ownershipLoopMs:0,metadataMs:0/,
  );
  assert.match(engine, /cpuResolveBreakdown/);
  assert.match(engine, /smartCommitBreakdown/);
});

test("Smart finishing context captures the renderer stroke-lifetime union before finalization", () => {
  assert.match(engine, /renderer\.getStrokeDirtyRegion\(\)/);
  assert.match(
    engine,
    /ownedContext\.dirtyRect=\{x:rendererDirty\.x,y:rendererDirty\.y,w:rendererDirty\.width,h:rendererDirty\.height\}/,
  );
  assert.ok(
    engine.indexOf("renderer.getStrokeDirtyRegion()") <
      engine.indexOf("_hardRoundFinalizeOwnedContext(ownedContext,e)"),
  );
});

test("all ownership and V4 metadata work remains scoped to supplied rect", () => {
  const commit = smart.slice(
    smart.indexOf("function commitBrushMask"),
    smart.indexOf("function clearWhereTransparent"),
  );
  assert.match(commit, /getImageData\(x,y,width,height\)/g);
  assert.match(commit, /offset=\(y\+row\)\*frame\.width\+x\+col/);
  assert.match(commit, /rect:\{x:x,y:y,width:width,height:height\}/);
  assert.doesNotMatch(commit, /getImageData\(0,0,CW,CH\)/);
});

test("session-owned contexts retain independent dirty rectangles and ordered commits", () => {
  assert.match(
    engine,
    /_hardRoundFinishingContexts\.set\(context\.strokeId,context\)/,
  );
  assert.match(
    engine,
    /const commit=_hardRoundCommitTail\.then\(\(\)=>resolution\)/,
  );
  assert.match(engine, /context\.dirtyRect/);
});

test("undo bundle APIs remain unchanged for exact ownership restoration", () => {
  assert.match(smart, /function getFrameBundle\(li,fi\)/);
  assert.match(smart, /styleIds:frame\?frame\.styleIds\.slice\(\):null/);
  assert.match(smart, /function restoreFrameBundle\(li,fi,bundle\)/);
});

test("Smart commit reuses session-owned CPU mask data and preserves fallback", () => {
  const commit = smart.slice(
    smart.indexOf("function commitBrushMask"),
    smart.indexOf("function clearWhereTransparent"),
  );
  assert.match(
    engine,
    /includeCpuMaskData:context\.smartRaster,dirtyRect:context\.dirtyRect/,
  );
  assert.match(
    engine,
    /context\.resolvedMaskData=result&&result\.maskData\|\|null/,
  );
  assert.match(panels, /brushBlendMode,maskData\)/);
  assert.match(
    commit,
    /var mask=ownedMaskData&&\(ownedMaskData\.data\|\|ownedMaskData\)/,
  );
  assert.match(
    commit,
    /if\(!mask\|\|mask\.length!==width\*height\*4\)mask=maskCanvas.*getImageData/,
  );
});

test("active artwork context declares frequent-read intent at first creation", () => {
  assert.match(
    core,
    /const ctx=activeC\.getContext\('2d',\{willReadFrequently:true\}\)/,
  );
});

test("metadata timing separates mask recording, history, and tile composition", () => {
  assert.match(shadow, /setupMs:0,recordMaskMs:0,historyMs:0,composeMs:0/);
  assert.match(
    smart,
    /timing\.metadataBreakdown=window\.HardRoundSmartMetadataTimingLast\|\|null/,
  );
});

test("Smart destination draw is restricted to the authoritative dirty rectangle", () => {
  assert.match(
    engine,
    /target\.drawImage\(mask,rect\.x,rect\.y,rect\.w,rect\.h,rect\.x,rect\.y,rect\.w,rect\.h\)/,
  );
});
