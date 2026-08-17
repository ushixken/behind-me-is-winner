// src/ui/transient-manager.js
//
// Centralized Transient UI Manager
//
// Manages the lifecycle and dismissal of transient/temporary UI surfaces:
// - Menubar dropdowns (#menubar .mb-item.open)
// - Context menus (.ctx-menu.visible, #palette-context-menu)
// - Simple Settings popovers (#ts-simple-settings-popup.open)
// - Pressure curve editor popups (#ts-pressure-editor-popup.open)
// - Palette side menu & palette dropdowns (#palette-side-menu, #palette-dropdown)
// - Brush blend mode & eraser mode menus (#ts-brush-blend-mode-menu, #ts-eraser-mode-menu)
// - Mini color picker (#mini-picker)
//
// Core Rules:
// 1. Outside pointerdown in CAPTURING phase dismisses unrelated transient surfaces BEFORE target interaction.
// 2. Pointerdown is NEVER swallowed, prevented, or stopped by the dismissal manager — same event proceeds to canvas, tool button, slider, etc.
// 3. Inside interactions with an active transient hierarchy are protected.
// 4. Escape dismisses active transient UI surfaces.
// 5. Opening one transient dismisses incompatible transients.

"use strict";

(function (root) {
  const surfaces = new Set();
  let _isDismissing = false;

  /**
   * Surface definition descriptor:
   * {
   *   id: string,
   *   isOpen: () => boolean,
   *   close: (options?: object) => void,
   *   contains: (target: Node, event?: Event) => boolean
   * }
   */

  function registerTransientSurface(surface) {
    if (
      !surface ||
      typeof surface.isOpen !== "function" ||
      typeof surface.close !== "function"
    ) {
      return;
    }
    surfaces.add(surface);
  }

  function unregisterTransientSurface(surface) {
    surfaces.delete(surface);
  }

  function getOpenSurfaces() {
    const list = [];
    for (const s of surfaces) {
      try {
        if (s.isOpen()) list.push(s);
      } catch (err) {
        console.error("[TransientManager] isOpen error:", err);
      }
    }
    return list;
  }

  function hasAnyOpen() {
    for (const s of surfaces) {
      try {
        if (s.isOpen()) return true;
      } catch (_) {}
    }
    return false;
  }

  function isInsideAnyOpenTransient(target, event) {
    if (!target) return false;
    for (const s of surfaces) {
      try {
        if (
          s.isOpen() &&
          typeof s.contains === "function" &&
          s.contains(target, event)
        ) {
          return true;
        }
      } catch (err) {
        console.error("[TransientManager] contains error:", err);
      }
    }
    return false;
  }

  /**
   * Dismiss all open transient UI surfaces, optionally excluding a surface being interacted with.
   * @param {object} [options]
   * @param {Node} [options.target] - Event target triggering dismissal
   * @param {Event} [options.event] - Pointer or keyboard event
   * @param {object} [options.exclude] - Specific surface or surface ID to skip closing
   * @param {boolean} [options.focus] - Focus restoration option passed to close
   */
  function dismissAll(options) {
    if (_isDismissing) return;
    _isDismissing = true;
    const opts = options || {};
    try {
      for (const s of surfaces) {
        try {
          if (opts.exclude && (s === opts.exclude || s.id === opts.exclude)) {
            continue;
          }
          if (s.isOpen()) {
            if (
              opts.target &&
              typeof s.contains === "function" &&
              s.contains(opts.target, opts.event)
            ) {
              continue;
            }
            s.close(opts);
          }
        } catch (err) {
          console.error(
            "[TransientManager] close error on surface " +
              (s.id || "unknown") +
              ":",
            err,
          );
        }
      }
    } finally {
      _isDismissing = false;
    }
  }

  // Global capturing-phase pointerdown listener
  function handleGlobalPointerDown(e) {
    if (!hasAnyOpen()) return;

    const target = e.target;
    // Dismiss any open surface that does NOT contain this pointerdown target
    dismissAll({ target, event: e });
  }

  // Global capturing-phase keydown listener for Escape
  function handleGlobalKeyDown(e) {
    if (e.key !== "Escape") return;
    if (!hasAnyOpen()) return;

    dismissAll({ keyEvent: e });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", handleGlobalPointerDown, true);
    document.addEventListener("keydown", handleGlobalKeyDown, true);
  }

  const TransientManager = {
    register: registerTransientSurface,
    unregister: unregisterTransientSurface,
    dismissAll: dismissAll,
    hasAnyOpen: hasAnyOpen,
    getOpenSurfaces: getOpenSurfaces,
    isInsideAnyOpen: isInsideAnyOpenTransient,
    _handlePointerDown: handleGlobalPointerDown,
    _handleKeyDown: handleGlobalKeyDown,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TransientManager;
  }
  if (typeof root !== "undefined") {
    root.TransientManager = TransientManager;
  }
})(typeof window !== "undefined" ? window : globalThis);
