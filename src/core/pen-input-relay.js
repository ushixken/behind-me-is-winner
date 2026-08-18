// Pen tablet / pointer-to-mouse compatibility relay
// Extracted from index.html inline <script> block.
//
      //
      // PEN TABLET COMPATIBILITY — pointer-to-mouse relay
      //
      // Many drag handlers in the app use document.addEventListener('mousemove')
      // which works fine for a mouse but breaks for pen tablets: when the stylus
      // moves outside the source element the browser may stop firing mousemove.
      // Pointer events (pointermove / pointerup) always fire globally on document
      // regardless of where the cursor is, so we relay them as synthetic MouseEvents
      // on document. This lets every existing mousedown→mousemove→mouseup drag
      // (timeline scrub, keyframe drag, layer reorder, rubber-band, range markers,
      // eye-drag, layer-B drag, etc.) work correctly with a pen tablet without
      // rewriting each one.
      //
      // The relay is ONLY active while a drag is in progress (primaryDown=true) so
      // it doesn't interfere with normal hover/click behaviour.
      // The canvas brush-engine uses its own pointer events and is unaffected.
      (function () {
        let primaryDown = false;

        // Track primary button state across all pointer types.
        document.addEventListener(
          "pointerdown",
          (e) => {
            if (e.button === 0 || e.buttons & 1) primaryDown = true;
            if (
              window.PlatformInput &&
              typeof window.PlatformInput.recordPointerDown === "function"
            ) {
              window.PlatformInput.recordPointerDown(e);
            }
          },
          true,
        );

        document.addEventListener(
          "pointermove",
          (e) => {
            // Only relay non-mouse pointer types (pen, touch) and only during a drag.
            // Mouse fires its own mousemove natively; relaying it would double-fire.
            if (e.pointerType === "mouse" || !primaryDown) return;
            const me = new MouseEvent("mousemove", {
              bubbles: true,
              cancelable: true,
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
              buttons: e.buttons,
              button: 0,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
            });
            document.dispatchEvent(me);
          },
          true,
        );

        document.addEventListener(
          "pointerup",
          (e) => {
            if (e.button === 0 || !(e.buttons & 1)) primaryDown = false;
            if (e.pointerType === "mouse") return;
            const me = new MouseEvent("mouseup", {
              bubbles: true,
              cancelable: true,
              clientX: e.clientX,
              clientY: e.clientY,
              screenX: e.screenX,
              screenY: e.screenY,
              buttons: e.buttons,
              button: 0,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
            });
            document.dispatchEvent(me);
          },
          true,
        );

        document.addEventListener(
          "pointercancel",
          (e) => {
            primaryDown = false;
            if (e.pointerType === "mouse") return;
            document.dispatchEvent(
              new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
            );
          },
          true,
        );
      })();
