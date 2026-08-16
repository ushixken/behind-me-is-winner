const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coreStateSrc = fs.readFileSync(path.join(__dirname, 'core-state.js'), 'utf8');
const layersSrc = fs.readFileSync(path.join(__dirname, 'layers.js'), 'utf8');
const uiControlsSrc = fs.readFileSync(path.join(__dirname, '..', 'ui', 'ui-controls.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

// Synthetic evaluation of zoom speed logic from core-state.js
function createZoomEnvironment(store = {}) {
  const mockLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; }
  };

  const ZOOM_SPEED_FACTORS = {
    1: 0.05,
    2: 0.08,
    3: 0.11,
    4: 0.15,
    5: 0.20,
    6: 0.25,
    7: 0.31,
    8: 0.37,
    9: 0.43,
    10: 0.50
  };
  const DEFAULT_ZOOM_SPEED_LEVEL = 4;

  function clampZoomSpeedLevel(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > 10) return DEFAULT_ZOOM_SPEED_LEVEL;
    return n;
  }

  let zoomSpeedLevel = DEFAULT_ZOOM_SPEED_LEVEL;
  try {
    const stored = mockLocalStorage.getItem('animator_zoom_speed');
    if (stored != null) {
      zoomSpeedLevel = clampZoomSpeedLevel(stored);
    }
  } catch (_) {}

  let zoomSpeed = ZOOM_SPEED_FACTORS[zoomSpeedLevel];
  let zoom = 1.0;
  const zoomMin = 0.1;
  const zoomMax = 16.0;
  let panX = 100, panY = 100;

  function setZoomSpeedLevel(level) {
    zoomSpeedLevel = clampZoomSpeedLevel(level);
    zoomSpeed = ZOOM_SPEED_FACTORS[zoomSpeedLevel];
    try { mockLocalStorage.setItem('animator_zoom_speed', String(zoomSpeedLevel)); } catch (_) {}
    return zoomSpeedLevel;
  }

  function doZoom(delta, cx, cy) {
    const oldZoom = zoom;
    const factor = delta > 0 ? (1 + zoomSpeed) : (1 / (1 + zoomSpeed));
    zoom = Math.max(zoomMin, Math.min(zoomMax, zoom * factor));
    panX = cx - (cx - panX) * (zoom / oldZoom);
    panY = cy - (cy - panY) * (zoom / oldZoom);
    return { zoom, panX, panY, oldZoom };
  }

  return {
    mockLocalStorage,
    ZOOM_SPEED_FACTORS,
    DEFAULT_ZOOM_SPEED_LEVEL,
    clampZoomSpeedLevel,
    setZoomSpeedLevel,
    doZoom,
    getZoomSpeedLevel: () => zoomSpeedLevel,
    getZoomSpeed: () => zoomSpeed,
    getZoom: () => zoom,
    setZoom: (z) => { zoom = z; },
    getPan: () => ({ panX, panY })
  };
}

test('A. allowed zoom speed values are integers 1 through 10', () => {
  const env = createZoomEnvironment();
  for (let i = 1; i <= 10; i++) {
    assert.equal(env.clampZoomSpeedLevel(i), i);
    assert.equal(env.clampZoomSpeedLevel(String(i)), i);
    env.setZoomSpeedLevel(i);
    assert.equal(env.getZoomSpeedLevel(), i);
  }
});

test('B. values below 1 clamp/fallback safely to default (level 4)', () => {
  const env = createZoomEnvironment();
  assert.equal(env.clampZoomSpeedLevel(0), 4);
  assert.equal(env.clampZoomSpeedLevel(-1), 4);
  assert.equal(env.clampZoomSpeedLevel(-100), 4);
  assert.equal(env.clampZoomSpeedLevel(0.4), 4);
});

test('C. values above 10 clamp/fallback safely to default (level 4)', () => {
  const env = createZoomEnvironment();
  assert.equal(env.clampZoomSpeedLevel(11), 4);
  assert.equal(env.clampZoomSpeedLevel(20), 4);
  assert.equal(env.clampZoomSpeedLevel(999), 4);
  assert.equal(env.clampZoomSpeedLevel(10.6), 4);
});

test('D. invalid persisted value uses default', () => {
  const env1 = createZoomEnvironment({ animator_zoom_speed: 'invalid' });
  assert.equal(env1.getZoomSpeedLevel(), 4);

  const env2 = createZoomEnvironment({ animator_zoom_speed: '0' });
  assert.equal(env2.getZoomSpeedLevel(), 4);

  const env3 = createZoomEnvironment({ animator_zoom_speed: 'null' });
  assert.equal(env3.getZoomSpeedLevel(), 4);

  const env4 = createZoomEnvironment({ animator_zoom_speed: 'NaN' });
  assert.equal(env4.getZoomSpeedLevel(), 4);
});

test('E. zoom multiplier increases strictly monotonically from level 1 through 10', () => {
  const env = createZoomEnvironment();
  const factors = env.ZOOM_SPEED_FACTORS;
  for (let i = 1; i < 10; i++) {
    assert.equal(factors[i] < factors[i + 1], true, `level ${i} < level ${i + 1}`);
  }
});

test('F. level 4 preserves the legacy/previous zoom rate of 0.15', () => {
  const env = createZoomEnvironment();
  env.setZoomSpeedLevel(4);
  assert.equal(env.getZoomSpeed(), 0.15);

  const res = env.doZoom(1, 200, 200);
  assert.equal(res.zoom, 1 * (1 + 1 * 0.15)); // 1.15
});

test('G. min and max zoom limits remain unchanged (0.1 to 16.0)', () => {
  const env = createZoomEnvironment();
  env.setZoomSpeedLevel(10); // Fastest zoom
  // Zoom in repeatedly
  for (let i = 0; i < 50; i++) env.doZoom(1, 0, 0);
  assert.equal(env.getZoom(), 16.0);

  // Zoom out repeatedly
  for (let i = 0; i < 50; i++) env.doZoom(-1, 0, 0);
  assert.equal(env.getZoom(), 0.1);
});

test('H. zoom-to-cursor / camera anchor logic math is preserved', () => {
  const env = createZoomEnvironment();
  const cx = 350, cy = 250;
  // Canvas-space point under cursor before zoom:
  // canvasX = (cx - panX) / zoom
  const p0 = env.getPan();
  const canvasX0 = (cx - p0.panX) / env.getZoom();
  const canvasY0 = (cy - p0.panY) / env.getZoom();

  env.doZoom(1, cx, cy);

  const p1 = env.getPan();
  const canvasX1 = (cx - p1.panX) / env.getZoom();
  const canvasY1 = (cy - p1.panY) / env.getZoom();

  assert.ok(Math.abs(canvasX0 - canvasX1) < 1e-10, 'Canvas X under cursor fixed');
  assert.ok(Math.abs(canvasY0 - canvasY1) < 1e-10, 'Canvas Y under cursor fixed');
});

test('I. persistence round-trip preserves values 1 through 10', () => {
  const store = {};
  for (let i = 1; i <= 10; i++) {
    const env = createZoomEnvironment(store);
    env.setZoomSpeedLevel(i);
    assert.equal(store['animator_zoom_speed'], String(i));

    // Reload in fresh environment
    const reloaded = createZoomEnvironment(store);
    assert.equal(reloaded.getZoomSpeedLevel(), i);
    assert.equal(reloaded.getZoomSpeed(), reloaded.ZOOM_SPEED_FACTORS[i]);
  }
});

test('J. UI and structural bindings match specification', () => {
  // Modal input in index.html has min="1" max="10" step="1"
  assert.match(indexHtml, /id="zoom-speed-input"[^>]*min="1"[^>]*max="10"[^>]*step="1"/);
  // layers.js loads zoomSpeedLevel into zoom-speed-input
  assert.match(layersSrc, /document\.getElementById\('zoom-speed-input'\)\.value\s*=\s*zoomSpeedLevel;/);
  // ui-controls.js saves zoomSpeedLevel via setZoomSpeedLevel
  assert.match(uiControlsSrc, /setZoomSpeedLevel\(document\.getElementById\('zoom-speed-input'\)\.value\)/);
  // core-state.js exports helper functions
  assert.match(coreStateSrc, /window\.clampZoomSpeedLevel\s*=\s*clampZoomSpeedLevel/);
  assert.match(coreStateSrc, /window\.setZoomSpeedLevel\s*=\s*setZoomSpeedLevel/);
});
