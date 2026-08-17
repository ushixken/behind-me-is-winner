'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isTabletOrMobileDevice,
  shouldAllowContextMenu,
  recordPointerDown,
  resetPointerDown,
} = require('./platform-input');

test('A. Windows desktop + pen hold on canvas -> no context menu', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(winDesktopEnv), false);

  // Pen primary hold: pointerdown with primary button (buttons=1, button=0), then contextmenu fires
  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 0, target: { id: 'canvas' } };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, false, 'Desktop pen hold on canvas must NOT allow context menu');
  resetPointerDown();
});

test('B. Windows desktop + pen hold on other UI element (layers/brush/palette) -> blocked', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 0, target: { className: 'layer-row' } };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, false, 'Desktop pen hold on layer row must NOT allow context menu');
  resetPointerDown();
});

test('C. Windows desktop + mouse right-click on canvas -> context menu allowed', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  recordPointerDown({ pointerType: 'mouse', button: 2, buttons: 2 });
  const ctxEvent = { pointerType: 'mouse', button: 2, buttons: 2, target: { id: 'canvas' } };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, true, 'Desktop mouse right-click on canvas must be allowed');
  resetPointerDown();
});

test('D. Windows desktop + mouse right-click on other UI element -> context menu allowed', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  recordPointerDown({ pointerType: 'mouse', button: 2, buttons: 2 });
  const ctxEvent = { pointerType: 'mouse', button: 2, buttons: 2, target: { className: 'bp-item' } };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, true, 'Desktop mouse right-click on UI element must be allowed');
  resetPointerDown();
});

test('E. Windows desktop + F2 (penContextMenu keybind) -> context menu allowed', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  const keybindEvent = { button: 2, buttons: 2, isSynthesizedKeybind: true };
  const allowed = shouldAllowContextMenu(keybindEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, true, 'F2 synthetic contextmenu must be allowed');
});

test('F. macOS desktop + pen hold -> no context menu', () => {
  const macDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(macDesktopEnv), false);

  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 0 };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: macDesktopEnv });
  assert.strictEqual(allowed, false, 'macOS desktop pen hold must NOT allow context menu');
  resetPointerDown();
});

test('G. Linux desktop + pen hold -> no context menu', () => {
  const linuxDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(linuxDesktopEnv), false);

  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 0 };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: linuxDesktopEnv });
  assert.strictEqual(allowed, false, 'Linux desktop pen hold must NOT allow context menu');
  resetPointerDown();
});

test('H. Android tablet + pen hold -> allowed', () => {
  const androidEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(androidEnv), true);

  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 0 };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: androidEnv });
  assert.strictEqual(allowed, true, 'Android tablet stylus hold must be allowed');
  resetPointerDown();
});

test('I. Android tablet + touch long-press -> preserved', () => {
  const androidEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    }
  };

  recordPointerDown({ pointerType: 'touch', button: 0, buttons: 1 });
  const ctxEvent = { pointerType: 'touch', button: 0, buttons: 0 };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: androidEnv });
  assert.strictEqual(allowed, true, 'Android tablet touch long-press must be allowed');
  resetPointerDown();
});

test('J. desktop pen barrel button click -> preserved', () => {
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  // Barrel button press sends buttons & 2
  recordPointerDown({ pointerType: 'pen', button: 2, buttons: 2 });
  const ctxEvent = { pointerType: 'pen', button: 2, buttons: 2 };
  const allowed = shouldAllowContextMenu(ctxEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, true, 'Desktop pen barrel button click must be allowed');
  resetPointerDown();
});

test('K. iPadOS tablet (MacIntel + maxTouchPoints > 1) -> tablet classification', () => {
  const ipadEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(ipadEnv), true, 'iPadOS must classify as tablet');
});

test('L. Windows touchscreen laptop (Win32 + maxTouchPoints > 0) -> desktop classification', () => {
  const winTouchLaptop = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 10,
    }
  };
  assert.strictEqual(isTabletOrMobileDevice(winTouchLaptop), false, 'Windows touchscreen laptop must classify as desktop');
});

test('M. global capturing interceptor stops propagation for desktop pen hold', () => {
  let defaultPrevented = false;
  let propagationStopped = false;
  let immediatePropagationStopped = false;

  const mockEvent = {
    pointerType: 'pen',
    button: 2,
    buttons: 0,
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
    stopImmediatePropagation() { immediatePropagationStopped = true; },
  };

  // Record a desktop pen hold
  recordPointerDown({ pointerType: 'pen', button: 0, buttons: 1 });
  const winDesktopEnv = {
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
    }
  };

  const allowed = shouldAllowContextMenu(mockEvent, { env: winDesktopEnv });
  assert.strictEqual(allowed, false);

  if (!allowed) {
    mockEvent.preventDefault();
    mockEvent.stopPropagation();
    mockEvent.stopImmediatePropagation();
  }

  assert.strictEqual(defaultPrevented, true, 'Event default must be prevented');
  assert.strictEqual(propagationStopped, true, 'Event propagation must be stopped');
  assert.strictEqual(immediatePropagationStopped, true, 'Immediate propagation must be stopped');
  resetPointerDown();
});

test('N. integration & structural check in platform-input.js, layers.js and index.html', () => {
  const platformSrc = fs.readFileSync(path.join(__dirname, 'platform-input.js'), 'utf8');
  const layersSrc = fs.readFileSync(path.join(__dirname, 'layers.js'), 'utf8');
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

  // Verify capturing listener is installed in platform-input.js
  assert.match(platformSrc, /document\.addEventListener\('contextmenu',\s*function\s*\(e\)\s*\{/);
  assert.match(platformSrc, /true\);\s*\/\/\s*Use capturing phase/);

  // Verify shouldAllowContextMenu is checked in layers.js
  assert.match(layersSrc, /window\.PlatformInput\.shouldAllowContextMenu/);
  assert.match(layersSrc, /synthEv\.isSynthesizedKeybind\s*=\s*true/);

  // Verify platform-input.js script is included in index.html
  assert.match(indexSrc, /<script\s+src="src\/core\/platform-input\.js"><\/script>/);
});
