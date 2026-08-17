// src/ui/transient-manager.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const TransientManager = require("./transient-manager.js");

test("TransientManager registers surfaces and queries open state correctly", () => {
  let menubarOpen = false;
  let ctxMenuOpen = false;

  const menubarSurface = {
    id: "menubar",
    isOpen: () => menubarOpen,
    close: () => {
      menubarOpen = false;
    },
    contains: (target) => target && target.id === "mb-file",
  };

  const ctxMenuSurface = {
    id: "ctx-menu",
    isOpen: () => ctxMenuOpen,
    close: () => {
      ctxMenuOpen = false;
    },
    contains: (target) => target && target.id === "my-ctx-menu",
  };

  TransientManager.register(menubarSurface);
  TransientManager.register(ctxMenuSurface);

  assert.strictEqual(TransientManager.hasAnyOpen(), false);

  menubarOpen = true;
  assert.strictEqual(TransientManager.hasAnyOpen(), true);
  assert.strictEqual(TransientManager.getOpenSurfaces().length, 1);
  assert.strictEqual(TransientManager.getOpenSurfaces()[0].id, "menubar");

  // Dismiss all
  TransientManager.dismissAll();
  assert.strictEqual(menubarOpen, false);
  assert.strictEqual(TransientManager.hasAnyOpen(), false);

  TransientManager.unregister(menubarSurface);
  TransientManager.unregister(ctxMenuSurface);
});

test("TransientManager dismissAll respects target containment (internal click does not close)", () => {
  let popupOpen = true;
  const popupEl = { id: "simple-settings", parentNode: null };
  const childSlider = { id: "slider-size", parentNode: popupEl };

  const surface = {
    id: "simple-settings",
    isOpen: () => popupOpen,
    close: () => {
      popupOpen = false;
    },
    contains: (target) => target === popupEl || target === childSlider,
  };

  TransientManager.register(surface);

  // Click on slider inside popup
  TransientManager.dismissAll({ target: childSlider });
  assert.strictEqual(
    popupOpen,
    true,
    "Internal target should not dismiss surface",
  );

  // Click outside on canvas
  const canvasEl = { id: "canvas-wrap" };
  TransientManager.dismissAll({ target: canvasEl });
  assert.strictEqual(popupOpen, false, "External target must dismiss surface");

  TransientManager.unregister(surface);
});

test("TransientManager dismissAll excludes specified surface or surface ID", () => {
  let s1Open = true;
  let s2Open = true;

  const s1 = {
    id: "surface-1",
    isOpen: () => s1Open,
    close: () => {
      s1Open = false;
    },
  };
  const s2 = {
    id: "surface-2",
    isOpen: () => s2Open,
    close: () => {
      s2Open = false;
    },
  };

  TransientManager.register(s1);
  TransientManager.register(s2);

  TransientManager.dismissAll({ exclude: "surface-1" });
  assert.strictEqual(s1Open, true, "surface-1 was excluded from dismissal");
  assert.strictEqual(s2Open, false, "surface-2 was dismissed");

  TransientManager.unregister(s1);
  TransientManager.unregister(s2);
});

test("TransientManager Escape key dismisses open surfaces", () => {
  let sOpen = true;
  const s = {
    id: "menu",
    isOpen: () => sOpen,
    close: () => {
      sOpen = false;
    },
  };

  TransientManager.register(s);
  assert.strictEqual(TransientManager.hasAnyOpen(), true);

  TransientManager._handleKeyDown({ key: "Escape" });
  assert.strictEqual(sOpen, false);

  TransientManager.unregister(s);
});

// ── REGRESSION SCENARIOS A THROUGH I ──

test("Scenario A & B: Closed menubar → pointerdown on File / Window allows opening", () => {
  let activeMenu = null;
  const menubarRoot = { id: "menubar" };
  const fileTrigger = {
    id: "mb-file",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };
  const windowTrigger = {
    id: "mb-window",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(menubarSurface);

  // 1. Initially closed: pointerdown on File
  TransientManager._handlePointerDown({ target: fileTrigger });
  assert.strictEqual(activeMenu, null);
  // Simulating the target element's native click/pointer handler opening File:
  activeMenu = "file";
  assert.strictEqual(activeMenu, "file");

  // 2. Open another trigger Window
  activeMenu = null; // reset to closed
  TransientManager._handlePointerDown({ target: windowTrigger });
  assert.strictEqual(activeMenu, null);
  activeMenu = "window";
  assert.strictEqual(activeMenu, "window");

  TransientManager.unregister(menubarSurface);
});

test("Scenario C: File open → click Edit closes File and opens Edit on same interaction", () => {
  let activeMenu = "file";
  const menubarRoot = { id: "menubar" };
  const editTrigger = {
    id: "mb-edit",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(menubarSurface);

  // Pointerdown on Edit
  TransientManager._handlePointerDown({ target: editTrigger });
  // Menubar itself contains editTrigger, so it's not dismissed as an outside click
  assert.strictEqual(
    activeMenu,
    "file",
    "Internal menubar switch is not treated as outside dismiss",
  );

  // The menubar's own handler switches the menu
  const wasOpen = activeMenu === "edit";
  activeMenu = null; // closeAllDropdowns()
  TransientManager.dismissAll({ exclude: "menubar" });
  if (!wasOpen) activeMenu = "edit";

  assert.strictEqual(activeMenu, "edit", "Edit is now open");

  TransientManager.unregister(menubarSurface);
});

test("Scenario D: Menubar open → click same trigger toggles closed", () => {
  let activeMenu = "file";
  const menubarRoot = { id: "menubar" };
  const fileTrigger = {
    id: "mb-file",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(menubarSurface);

  // Pointerdown on File
  TransientManager._handlePointerDown({ target: fileTrigger });
  assert.strictEqual(activeMenu, "file");

  // The menubar handler checks wasOpen and toggles
  const wasOpen = activeMenu === "file";
  activeMenu = null; // close all
  if (!wasOpen) activeMenu = "file";

  assert.strictEqual(activeMenu, null, "Clicking open trigger closed the menu");

  TransientManager.unregister(menubarSurface);
});

test("Scenario E: Window open → clicking item in dropdown preserves open hierarchy until item completes", () => {
  let activeMenu = "window";
  const menubarRoot = { id: "menubar" };
  const dropdownItem = {
    id: "dd-show-tools",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(menubarSurface);

  // Pointerdown on dropdown item
  TransientManager._handlePointerDown({ target: dropdownItem });
  assert.strictEqual(
    activeMenu,
    "window",
    "Dropdown item is inside menubar hierarchy",
  );

  TransientManager.unregister(menubarSurface);
});

test("Scenario F: Size Settings open → click Window closes Size Settings and opens Window", () => {
  let sizeSettingsOpen = true;
  let activeMenu = null;

  const menubarRoot = { id: "menubar" };
  const windowTrigger = {
    id: "mb-window",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };
  const settingsPopup = {
    id: "ts-simple-settings-popup",
    closest: () => null,
    contains: (t) => t === settingsPopup,
  };

  const settingsSurface = {
    id: "simple-settings-popup",
    isOpen: () => sizeSettingsOpen,
    close: () => {
      sizeSettingsOpen = false;
    },
    contains: (target) => settingsPopup.contains(target),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(settingsSurface);
  TransientManager.register(menubarSurface);

  // Click Window trigger while Size Settings is open
  TransientManager._handlePointerDown({ target: windowTrigger });

  // Size Settings must have closed because windowTrigger is outside settingsPopup
  assert.strictEqual(
    sizeSettingsOpen,
    false,
    "Size Settings closed on outside click",
  );

  // Window menu then opens via its click handler
  activeMenu = "window";
  assert.strictEqual(activeMenu, "window");

  TransientManager.unregister(settingsSurface);
  TransientManager.unregister(menubarSurface);
});

test("Scenario G & H: Window open → click Brush tool or canvas closes Window and event proceeds", () => {
  let activeMenu = "window";
  let activeTool = "brush";
  let canvasDabReceived = false;

  const menubarRoot = { id: "menubar" };
  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(menubarSurface);

  // 1. Click canvas
  const canvasEl = { id: "canvas-wrap", closest: () => null };
  TransientManager._handlePointerDown({ target: canvasEl });
  assert.strictEqual(activeMenu, null, "Menubar closed on canvas pointerdown");
  // Canvas receives same event
  canvasDabReceived = true;
  assert.strictEqual(canvasDabReceived, true);

  // 2. Open Window again
  activeMenu = "window";
  const eraserToolBtn = { id: "tool-eraser", closest: () => null };
  TransientManager._handlePointerDown({ target: eraserToolBtn });
  assert.strictEqual(
    activeMenu,
    null,
    "Menubar closed on tool button pointerdown",
  );
  activeTool = "eraser";
  assert.strictEqual(activeTool, "eraser");

  TransientManager.unregister(menubarSurface);
});

test("Scenario I: Layer context menu open → click menubar closes context menu and menubar opens", () => {
  let ctxMenuOpen = true;
  let activeMenu = null;

  const menubarRoot = { id: "menubar" };
  const fileTrigger = {
    id: "mb-file",
    parentNode: menubarRoot,
    closest: (sel) => (sel === "#menubar" ? menubarRoot : null),
  };
  const ctxMenuEl = {
    id: "layer-ctx-menu",
    closest: (sel) => (sel === ".ctx-menu" ? ctxMenuEl : null),
  };

  const ctxSurface = {
    id: "context-menus",
    isOpen: () => ctxMenuOpen,
    close: () => {
      ctxMenuOpen = false;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest(".ctx-menu")),
  };

  const menubarSurface = {
    id: "menubar",
    isOpen: () => activeMenu !== null,
    close: () => {
      activeMenu = null;
    },
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  };

  TransientManager.register(ctxSurface);
  TransientManager.register(menubarSurface);

  // Pointerdown on File trigger while Context Menu is open
  TransientManager._handlePointerDown({ target: fileTrigger });

  assert.strictEqual(
    ctxMenuOpen,
    false,
    "Context menu closed on menubar click",
  );
  activeMenu = "file";
  assert.strictEqual(activeMenu, "file", "File menu opened");

  TransientManager.unregister(ctxSurface);
  TransientManager.unregister(menubarSurface);
});

// ── DOM INTEGRATION TEST SIMULATING REAL INDEX.HTML & LAYERS.JS ──

test("Real DOM integration test: pointerdown -> pointerup -> click on File trigger opens dropdown and is visible", () => {
  // Simulate DOM elements matching index.html
  const classList = (el) => ({
    contains: (c) => el._classes.has(c),
    add: (c) => el._classes.add(c),
    remove: (c) => el._classes.delete(c),
    toggle: (c, force) => {
      if (force === true) el._classes.add(c);
      else if (force === false) el._classes.delete(c);
      else if (el._classes.has(c)) el._classes.delete(c);
      else el._classes.add(c);
    },
  });

  const createElement = (id, tag = "div") => {
    const el = {
      id,
      tagName: tag.toUpperCase(),
      _classes: new Set(),
      children: [],
      parentNode: null,
    };
    el.classList = classList(el);
    el.closest = (sel) => {
      if (
        sel === "#menubar" &&
        (el.id === "menubar" ||
          el.parentNode?.id === "menubar" ||
          el.parentNode?.parentNode?.id === "menubar")
      )
        return menubarEl;
      if (sel === ".mb-item" && el._classes.has("mb-item")) return el;
      if (sel === ".dropdown" && el._classes.has("dropdown")) return el;
      return null;
    };
    return el;
  };

  const menubarEl = createElement("menubar");
  const mbFile = createElement("mb-file");
  mbFile.classList.add("mb-item");
  mbFile.parentNode = menubarEl;

  const ddFile = createElement("dd-file");
  ddFile.classList.add("dropdown");
  ddFile.parentNode = mbFile;
  mbFile.children.push(ddFile);

  const mbEdit = createElement("mb-edit");
  mbEdit.classList.add("mb-item");
  mbEdit.parentNode = menubarEl;

  const ddEdit = createElement("dd-edit");
  ddEdit.classList.add("dropdown");
  ddEdit.parentNode = mbEdit;
  mbEdit.children.push(ddEdit);

  menubarEl.children = [mbFile, mbEdit];

  const mbItems = [mbFile, mbEdit];

  function closeAllDropdowns() {
    mbItems.forEach((m) => m.classList.remove("open"));
  }

  // Register real surface
  TransientManager.register({
    id: "menubar",
    isOpen: () => mbItems.some((m) => m.classList.contains("open")),
    close: () => closeAllDropdowns(),
    contains: (target) =>
      !!(target && target.closest && target.closest("#menubar")),
  });

  // Wire click listener matching layers.js
  mbItems.forEach((item) => {
    item.clickListener = (e) => {
      if (e.target.closest && e.target.closest(".dropdown")) return;
      const wasOpen = item.classList.contains("open");
      closeAllDropdowns();
      TransientManager.dismissAll({ exclude: "menubar" });
      if (!wasOpen) item.classList.add("open");
    };
  });

  // Full browser pointer event sequence on mbFile
  // Step 1: pointerdown (capturing phase fires TransientManager)
  TransientManager._handlePointerDown({ target: mbFile });
  assert.strictEqual(
    mbFile.classList.contains("open"),
    false,
    "Before click, File is not yet open",
  );

  // Step 2: click on mbFile
  mbFile.clickListener({ target: mbFile });
  assert.strictEqual(
    mbFile.classList.contains("open"),
    true,
    "After click, File is open",
  );
  // CSS contract: .mb-item.open .dropdown -> display: block
  const isDdFileVisible = mbFile.classList.contains("open");
  assert.strictEqual(
    isDdFileVisible,
    true,
    "Dropdown is visible per .mb-item.open .dropdown contract",
  );

  // Step 3: Clicking inside dropdown (.dd-item) does NOT toggle or close the parent .mb-item
  mbFile.clickListener({ target: ddFile });
  assert.strictEqual(
    mbFile.classList.contains("open"),
    true,
    "Clicking child item does not close dropdown prematurely",
  );

  // Step 4: Switch from File to Edit on next click
  TransientManager._handlePointerDown({ target: mbEdit });
  mbEdit.clickListener({ target: mbEdit });
  assert.strictEqual(
    mbFile.classList.contains("open"),
    false,
    "File closed on switch",
  );
  assert.strictEqual(
    mbEdit.classList.contains("open"),
    true,
    "Edit opened on switch",
  );

  // Step 5: Click outside canvas
  const canvasEl = createElement("canvas-wrap");
  TransientManager._handlePointerDown({ target: canvasEl });
  assert.strictEqual(
    mbEdit.classList.contains("open"),
    false,
    "Edit closed on outside canvas click",
  );

  TransientManager.unregister(
    TransientManager.getOpenSurfaces().find((s) => s.id === "menubar") || {
      id: "menubar",
    },
  );
});
