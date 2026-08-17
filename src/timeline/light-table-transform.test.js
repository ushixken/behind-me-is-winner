'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Extract pure transform helpers from transform-tool.js without running DOM setup
function loadTransformHelpers() {
  const transformSrc = fs.readFileSync(path.join(__dirname, '..', 'transform', 'transform-tool.js'), 'utf8');

  const helperSource = `
    const TF_HANDLE_R = 9;
    let zoom = 1;
    let tfState = null;
    let tfPivot = null;
    let tfBox = null;

    ${transformSrc.match(/function _tfDist[\s\S]*?function _tfHitTestGeneric\([\s\S]*?\n\}/)[0]}
    ${transformSrc.match(/function _tfLocalToWorld[\s\S]*?function _tfSetStateForPivot\([\s\S]*?\n\}/)[0]}

    return { _tfHitTestGeneric, _tfSetStateForPivot, _tfLocalToWorld, _tfWorldToLocal };
  `;

  const fn = new Function(helperSource);
  return fn();
}

const { _tfHitTestGeneric, _tfSetStateForPivot, _tfLocalToWorld, _tfWorldToLocal } = loadTransformHelpers();

function computeCorners(w, h, transform) {
  const t = transform || { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const cx = w / 2 + t.positionX;
  const cy = h / 2 + t.positionY;
  const hw = (w / 2) * t.scaleX;
  const hh = (h / 2) * t.scaleY;
  const rad = t.rotation * Math.PI / 180;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return pts.map(([lx, ly]) => ({ x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR }));
}

function hitTestSingleRef(p, w, h, transform) {
  const corners = computeCorners(w, h, transform);
  const boxCenter = { x: w / 2 + transform.positionX, y: h / 2 + transform.positionY };
  const box = { x: 0, y: 0, w, h };
  const pivotLocal = transform.pivot || { x: w / 2, y: h / 2 };
  const pivotWorld = _tfLocalToWorld(pivotLocal, transform, box);
  return _tfHitTestGeneric(p, corners, transform.rotation, transform.scaleX, boxCenter, w, h, pivotWorld);
}

test('1. Hit-test at 0 degrees: interior click returns move and pivot click returns pivot', () => {
  const w = 400, h = 300;
  const t = { positionX: 50, positionY: 50, rotation: 0, scaleX: 1, scaleY: 1 };
  // Pivot is at center (250, 200)
  const hitPivot = hitTestSingleRef({ x: 250, y: 200 }, w, h, t);
  assert.ok(hitPivot);
  assert.strictEqual(hitPivot.mode, 'pivot', 'Click directly on center pivot handle returns pivot');

  // Interior point offset from pivot (e.g. 50px right of center: 300, 200)
  const hitMove = hitTestSingleRef({ x: 300, y: 200 }, w, h, t);
  assert.ok(hitMove);
  assert.strictEqual(hitMove.mode, 'move', 'Interior click away from handles must be move');
});

test('2. Hit-test at 45 degrees: interior click returns move and outside click returns rotate', () => {
  const w = 400, h = 300;
  const t = { positionX: 0, positionY: 0, rotation: 45, scaleX: 1, scaleY: 1 };
  // Center is at (200, 150). Point 60px away along local X axis: (200 + 60*cos(45), 150 + 60*sin(45))
  const interiorX = 200 + 60 * Math.cos(Math.PI / 4);
  const interiorY = 150 + 60 * Math.sin(Math.PI / 4);
  const hitInterior = hitTestSingleRef({ x: interiorX, y: interiorY }, w, h, t);
  assert.ok(hitInterior);
  assert.strictEqual(hitInterior.mode, 'move', 'Interior click at 45 deg must be move');

  // Point well outside the 400x300 rotated box (e.g. at 700, 600)
  const hitOutside = hitTestSingleRef({ x: 700, y: 600 }, w, h, t);
  assert.ok(hitOutside);
  assert.strictEqual(hitOutside.mode, 'rotate', 'Outside click at 45 deg must be rotate');
});

test('3. Hit-test at 90 degrees: rotated interior point returns move', () => {
  const w = 400, h = 300;
  const t = { positionX: 0, positionY: 0, rotation: 90, scaleX: 1, scaleY: 1 };
  // Center is at (200, 150). A point 100px along the rotated local X axis (which points down at 90 deg): (200, 250)
  const hitInside = hitTestSingleRef({ x: 200, y: 250 }, w, h, t);
  assert.ok(hitInside);
  assert.strictEqual(hitInside.mode, 'move', 'Local interior point at 90 deg must be move');
});

test('4. Hit-test corner handle at 45 degrees returns scale', () => {
  const w = 400, h = 300;
  const t = { positionX: 0, positionY: 0, rotation: 45, scaleX: 1, scaleY: 1 };
  const corners = computeCorners(w, h, t);
  const corner0 = corners[0];
  const hit = hitTestSingleRef({ x: corner0.x, y: corner0.y }, w, h, t);
  assert.ok(hit);
  assert.strictEqual(hit.mode, 'scale', 'Corner handle at 45 deg must be scale');
});

test('5. Custom off-center pivot rotation maintains exact world pivot location without drift', () => {
  const w = 400, h = 300;
  const box = { x: 0, y: 0, w, h };
  const localPivot = { x: 100, y: 80 }; // 25% X, ~27% Y (off-center)
  const t = { positionX: 20, positionY: 30, rotation: 0, scaleX: 1, scaleY: 1, pivot: localPivot };

  // Calculate starting world pivot
  const startPivotWorld = _tfLocalToWorld(localPivot, t, box);

  // Rotate to 45 deg using _tfSetStateForPivot
  _tfSetStateForPivot(startPivotWorld, 45, t.scaleX, t, localPivot, box, t.scaleY);
  const pivotAfter45 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfter45.x - startPivotWorld.x) < 1e-6, `Pivot X drifted after 45 deg: ${pivotAfter45.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfter45.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted after 45 deg: ${pivotAfter45.y} vs ${startPivotWorld.y}`);

  // Rotate to 90 deg using _tfSetStateForPivot
  _tfSetStateForPivot(startPivotWorld, 90, t.scaleX, t, localPivot, box, t.scaleY);
  const pivotAfter90 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfter90.x - startPivotWorld.x) < 1e-6, `Pivot X drifted after 90 deg: ${pivotAfter90.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfter90.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted after 90 deg: ${pivotAfter90.y} vs ${startPivotWorld.y}`);

  // End gesture and start a second rotation gesture from current state
  const secondStartPivotWorld = _tfLocalToWorld(localPivot, t, box);
  _tfSetStateForPivot(secondStartPivotWorld, 135, t.scaleX, t, localPivot, box, t.scaleY);
  const pivotAfter135 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfter135.x - startPivotWorld.x) < 1e-6, `Pivot X drifted across repeated gestures: ${pivotAfter135.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfter135.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted across repeated gestures: ${pivotAfter135.y} vs ${startPivotWorld.y}`);
});

test('6. Custom off-center pivot scale maintains exact world pivot location without drift', () => {
  const w = 400, h = 300;
  const box = { x: 0, y: 0, w, h };
  const localPivot = { x: 100, y: 80 };
  const t = { positionX: 20, positionY: 30, rotation: 30, scaleX: 1, scaleY: 1, pivot: localPivot };

  const startPivotWorld = _tfLocalToWorld(localPivot, t, box);

  // Scale to 1.5x
  _tfSetStateForPivot(startPivotWorld, t.rotation, 1.5, t, localPivot, box, 1.5);
  const pivotAfterScale15 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfterScale15.x - startPivotWorld.x) < 1e-6, `Pivot X drifted after 1.5x scale: ${pivotAfterScale15.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfterScale15.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted after 1.5x scale: ${pivotAfterScale15.y} vs ${startPivotWorld.y}`);

  // Scale to 2.0x
  _tfSetStateForPivot(startPivotWorld, t.rotation, 2.0, t, localPivot, box, 2.0);
  const pivotAfterScale20 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfterScale20.x - startPivotWorld.x) < 1e-6, `Pivot X drifted after 2.0x scale: ${pivotAfterScale20.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfterScale20.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted after 2.0x scale: ${pivotAfterScale20.y} vs ${startPivotWorld.y}`);

  // Second scale gesture
  const secondStartPivotWorld = _tfLocalToWorld(localPivot, t, box);
  _tfSetStateForPivot(secondStartPivotWorld, t.rotation, 2.5, t, localPivot, box, 2.5);
  const pivotAfterScale25 = _tfLocalToWorld(localPivot, t, box);

  assert.ok(Math.abs(pivotAfterScale25.x - startPivotWorld.x) < 1e-6, `Pivot X drifted across repeated scales: ${pivotAfterScale25.x} vs ${startPivotWorld.x}`);
  assert.ok(Math.abs(pivotAfterScale25.y - startPivotWorld.y) < 1e-6, `Pivot Y drifted across repeated scales: ${pivotAfterScale25.y} vs ${startPivotWorld.y}`);
});

test('7. Default center pivot remains stable under rotation and scale', () => {
  const w = 400, h = 300;
  const box = { x: 0, y: 0, w, h };
  const centerPivot = { x: w / 2, y: h / 2 };
  const t = { positionX: 50, positionY: 50, rotation: 0, scaleX: 1, scaleY: 1, pivot: centerPivot };

  const startPivotWorld = _tfLocalToWorld(centerPivot, t, box);

  _tfSetStateForPivot(startPivotWorld, 45, 1.5, t, centerPivot, box, 1.5);
  const pivotAfter = _tfLocalToWorld(centerPivot, t, box);

  assert.ok(Math.abs(pivotAfter.x - startPivotWorld.x) < 1e-6);
  assert.ok(Math.abs(pivotAfter.y - startPivotWorld.y) < 1e-6);
});

test('8. Verification of light-table.js integration', () => {
  const ltSrc = fs.readFileSync(path.join(__dirname, 'light-table.js'), 'utf8');

  // Verify single reference passes drawing.width and drawing.height
  assert.match(ltSrc, /w\s*=\s*targets\[0\]\.drawing\.width/);
  assert.match(ltSrc, /h\s*=\s*targets\[0\]\.drawing\.height/);

  // Verify _tfSetStateForPivot is used in scale and rotate
  assert.match(ltSrc, /_tfSetStateForPivot\(pivot,\s*st\.rotation,\s*newScale,\s*t,\s*pivotLocal,\s*box,\s*newScale\)/);
  assert.match(ltSrc, /_tfSetStateForPivot\(pivot,\s*refNewRot,\s*st\.scaleX,\s*t,\s*pivotLocal,\s*box,\s*st\.scaleY\)/);
});

test('9. Dedicated Light Table Transform tool mode lifecycle and tool restoration', () => {
  const ltSrc = fs.readFileSync(path.join(__dirname, 'light-table.js'), 'utf8');
  const tfSrc = fs.readFileSync(path.join(__dirname, '../transform/transform-tool.js'), 'utf8');
  const brushSrc = fs.readFileSync(path.join(__dirname, '../brush/brush-engine.js'), 'utf8');

  // Verify light-table toggles tool to 'transform' upon entering and stores previous tool
  assert.match(ltSrc, /_ltPreviousTool=\{tool:prevT,\s*label:prevLbl\}/);
  assert.match(ltSrc, /setTool\('transform',\s*'Transform'\)/);

  // Verify light-table restores previous tool upon exiting
  assert.match(ltSrc, /setTool\(pt\.tool,\s*pt\.label\)/);

  // Verify enterTransformTool does not overwrite Light Table transform mode
  assert.match(tfSrc, /if\(window\.LightTable&&window\.LightTable\.transformMode\)\s*return;/);

  // Verify brush engine excludes tool === 'transform' so brush strokes never draw
  assert.match(brushSrc, /tool==='transform'/);
});

test('10. Light Table Transform sub-tool button visibility syncing', () => {
  const tfSrc = fs.readFileSync(path.join(__dirname, '../transform/transform-tool.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

  // Verify DOM contains #transform-mode-light-table
  assert.match(indexHtml, /id="transform-mode-light-table"/);

  // Verify _tfSyncToggleUI sets display to block only when LightTable.transformMode is active
  assert.match(tfSrc, /const isLt=!!\(window\.LightTable&&window\.LightTable\.transformMode\);/);
  assert.match(tfSrc, /_tfBtnLtTable\.style\.display=isLt\?'block':'none'/);
  assert.match(tfSrc, /_tfBtnLtTable\.classList\.toggle\('active',isLt\)/);
});

// ── Align Centers Test Suite (Tests A - I) ──────────────────────────

function _ltCornersForRefHelper(ref) {
  const w = ref.drawing.width, h = ref.drawing.height;
  const t = ref.transform || { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  const cx = w / 2 + t.positionX, cy = h / 2 + t.positionY;
  const hw = (w / 2) * t.scaleX, hh = (h / 2) * t.scaleY;
  const rad = t.rotation * Math.PI / 180;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  return pts.map(([lx, ly]) => ({ x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR }));
}

function runAlignCentersHelper(refs, docW, docH) {
  const activeRefs = refs.filter(r => !r.hidden && !r.missing);
  if (!activeRefs.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  activeRefs.forEach(r => {
    const corners = _ltCornersForRefHelper(r);
    corners.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
  });

  const groupCenterX = (minX + maxX) / 2;
  const groupCenterY = (minY + maxY) / 2;

  const docCenterX = docW / 2;
  const docCenterY = docH / 2;

  const dx = docCenterX - groupCenterX;
  const dy = docCenterY - groupCenterY;

  activeRefs.forEach(r => {
    r.transform.positionX += dx;
    r.transform.positionY += dy;
  });

  return { dx, dy, minX, minY, maxX, maxY, groupCenterX, groupCenterY };
}

test('TEST A — Scale: Single reference scaled (200%), Assert transformed bounds center == canvas center & scale unchanged', () => {
  const docW = 1000, docH = 800;
  const ref = {
    drawing: { width: 200, height: 100 },
    transform: { positionX: 50, positionY: 30, rotation: 0, scaleX: 2, scaleY: 2 }
  };
  runAlignCentersHelper([ref], docW, docH);

  const corners = _ltCornersForRefHelper(ref);
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));

  assert.ok(Math.abs((minX + maxX) / 2 - docW / 2) < 1e-6);
  assert.ok(Math.abs((minY + maxY) / 2 - docH / 2) < 1e-6);
  assert.strictEqual(ref.transform.scaleX, 2);
  assert.strictEqual(ref.transform.scaleY, 2);
  assert.strictEqual(ref.transform.rotation, 0);
});

test('TEST B — Rotation: One non-square reference rotated 45°, Assert transformed bounds center == canvas center & rotation unchanged', () => {
  const docW = 1200, docH = 900;
  const ref = {
    drawing: { width: 400, height: 200 },
    transform: { positionX: 100, positionY: -50, rotation: 45, scaleX: 1, scaleY: 1 }
  };
  runAlignCentersHelper([ref], docW, docH);

  const corners = _ltCornersForRefHelper(ref);
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));

  assert.ok(Math.abs((minX + maxX) / 2 - docW / 2) < 1e-6);
  assert.ok(Math.abs((minY + maxY) / 2 - docH / 2) < 1e-6);
  assert.strictEqual(ref.transform.rotation, 45);
  assert.strictEqual(ref.transform.scaleX, 1);
});

test('TEST C — Scale + Rotation: scale = 1.75, rotation = 37°, Assert transformed bounds center == canvas center', () => {
  const docW = 1920, docH = 1080;
  const ref = {
    drawing: { width: 300, height: 150 },
    transform: { positionX: -200, positionY: 400, rotation: 37, scaleX: 1.75, scaleY: 1.75 }
  };
  runAlignCentersHelper([ref], docW, docH);

  const corners = _ltCornersForRefHelper(ref);
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));

  assert.ok(Math.abs((minX + maxX) / 2 - docW / 2) < 1e-6);
  assert.ok(Math.abs((minY + maxY) / 2 - docH / 2) < 1e-6);
  assert.strictEqual(ref.transform.scaleX, 1.75);
  assert.strictEqual(ref.transform.rotation, 37);
});

test('TEST D — Multiple References: Three references with different positions, scales, rotations, dimensions', () => {
  const docW = 2000, docH = 1500;
  const refA = {
    drawing: { width: 200, height: 200 },
    transform: { positionX: -100, positionY: -50, rotation: 30, scaleX: 1.5, scaleY: 1.5 }
  };
  const refB = {
    drawing: { width: 400, height: 100 },
    transform: { positionX: 300, positionY: 200, rotation: -45, scaleX: 0.75, scaleY: 0.75 }
  };
  const refC = {
    drawing: { width: 150, height: 300 },
    transform: { positionX: 500, positionY: -150, rotation: 90, scaleX: 2.0, scaleY: 2.0 }
  };
  const refs = [refA, refB, refC];
  runAlignCentersHelper(refs, docW, docH);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  refs.forEach(r => {
    _ltCornersForRefHelper(r).forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
  });

  assert.ok(Math.abs((minX + maxX) / 2 - docW / 2) < 1e-6);
  assert.ok(Math.abs((minY + maxY) / 2 - docH / 2) < 1e-6);
});

test('TEST E — Rigid Group: Relative position differences between references remain exactly unchanged', () => {
  const docW = 1000, docH = 1000;
  const refA = {
    drawing: { width: 100, height: 100 },
    transform: { positionX: 10, positionY: 20, rotation: 15, scaleX: 1.2, scaleY: 1.2 }
  };
  const refB = {
    drawing: { width: 150, height: 150 },
    transform: { positionX: 110, positionY: 220, rotation: -35, scaleX: 0.8, scaleY: 0.8 }
  };
  const diffXBefore = refB.transform.positionX - refA.transform.positionX;
  const diffYBefore = refB.transform.positionY - refA.transform.positionY;

  runAlignCentersHelper([refA, refB], docW, docH);

  const diffXAfter = refB.transform.positionX - refA.transform.positionX;
  const diffYAfter = refB.transform.positionY - refA.transform.positionY;

  assert.ok(Math.abs(diffXAfter - diffXBefore) < 1e-6);
  assert.ok(Math.abs(diffYAfter - diffYBefore) < 1e-6);
});

test('TEST F — Hidden Reference: Placed far away, does not influence bounds and does not move', () => {
  const docW = 1000, docH = 1000;
  const refVisible = {
    drawing: { width: 100, height: 100 },
    transform: { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 }
  };
  const refHidden = {
    hidden: true,
    drawing: { width: 100, height: 100 },
    transform: { positionX: 50000, positionY: 50000, rotation: 0, scaleX: 1, scaleY: 1 }
  };

  runAlignCentersHelper([refVisible, refHidden], docW, docH);

  // refVisible centered: [0, 100] -> center 50 -> translated to 500 => positionX = 450
  assert.strictEqual(refVisible.transform.positionX, 450);
  assert.strictEqual(refVisible.transform.positionY, 450);
  // refHidden untouched
  assert.strictEqual(refHidden.transform.positionX, 50000);
  assert.strictEqual(refHidden.transform.positionY, 50000);
});

test('TEST G — Missing Reference: Does not influence bounds and does not move', () => {
  const docW = 1000, docH = 1000;
  const refVisible = {
    drawing: { width: 100, height: 100 },
    transform: { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 }
  };
  const refMissing = {
    missing: true,
    drawing: { width: 100, height: 100 },
    transform: { positionX: 99999, positionY: 99999, rotation: 0, scaleX: 1, scaleY: 1 }
  };

  runAlignCentersHelper([refVisible, refMissing], docW, docH);

  assert.strictEqual(refVisible.transform.positionX, 450);
  assert.strictEqual(refMissing.transform.positionX, 99999);
});

test('TEST H — Locked Reference: Participates in bounds calculation and receives identical dx/dy translation', () => {
  const docW = 1000, docH = 1000;
  const refUnlocked = {
    locked: false,
    drawing: { width: 100, height: 100 },
    transform: { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1 }
  };
  const refLocked = {
    locked: true,
    drawing: { width: 100, height: 100 },
    transform: { positionX: 200, positionY: 200, rotation: 0, scaleX: 1, scaleY: 1 }
  };

  const res = runAlignCentersHelper([refUnlocked, refLocked], docW, docH);

  assert.strictEqual(refUnlocked.transform.positionX, 0 + res.dx);
  assert.strictEqual(refUnlocked.transform.positionY, 0 + res.dy);
  assert.strictEqual(refLocked.transform.positionX, 200 + res.dx);
  assert.strictEqual(refLocked.transform.positionY, 200 + res.dy);
  assert.strictEqual(refLocked.locked, true);
});

test('TEST I — Custom Pivot: Reference with custom off-center pivot preserves pivot while centering bounds', () => {
  const docW = 1000, docH = 1000;
  const ref = {
    drawing: { width: 200, height: 100 },
    transform: { positionX: 100, positionY: 100, rotation: 45, scaleX: 1.5, scaleY: 1.5, pivot: { x: 50, y: 25 } }
  };

  runAlignCentersHelper([ref], docW, docH);

  const corners = _ltCornersForRefHelper(ref);
  const minX = Math.min(...corners.map(p => p.x));
  const maxX = Math.max(...corners.map(p => p.x));
  const minY = Math.min(...corners.map(p => p.y));
  const maxY = Math.max(...corners.map(p => p.y));

  assert.ok(Math.abs((minX + maxX) / 2 - docW / 2) < 1e-6);
  assert.ok(Math.abs((minY + maxY) / 2 - docH / 2) < 1e-6);
  assert.deepStrictEqual(ref.transform.pivot, { x: 50, y: 25 });
});


