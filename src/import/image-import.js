(function ImageImport(){

  const overlay      = document.getElementById('img-drop-overlay');
  const fileInput    = document.getElementById('img-file-input');
  const modal        = document.getElementById('modal-img-import');
  const subText      = document.getElementById('img-import-sub');
  const optCurWrap   = document.getElementById('opt-cur-layer-wrap');
  const optCurName   = document.getElementById('opt-cur-layer-name');
  const optCurDesc   = document.getElementById('opt-cur-layer-desc');
  const optGroupWrap = document.getElementById('opt-group-layer-wrap');
  const optGroupName = document.getElementById('opt-group-name');
  const fitSelect    = document.getElementById('img-fit-mode');
  const btnOk        = document.getElementById('img-import-ok');
  const btnCancel    = document.getElementById('img-import-cancel');

  // Highlight the selected radio's wrapper
  modal.querySelectorAll('.img-import-opt').forEach(wrap => {
    const radio = wrap.querySelector('input[type=radio]');
    radio.addEventListener('change', () => {
      modal.querySelectorAll('.img-import-opt').forEach(w => w.classList.remove('selected'));
      if (radio.checked) wrap.classList.add('selected');
    });
    // Clicking the whole card selects the radio
    wrap.addEventListener('click', () => {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    });
  });

  // ── Pending image (set before showing modal) ──────────────────
  let _pendingImg = null;   // HTMLImageElement ready to draw
  let _pendingName = '';    // original file name, used for new-layer name

  // ── Utility: draw image onto a layer canvas with chosen fit ───
  function drawImageFitted(destCanvas, img, fitMode) {
    const dc = destCanvas.getContext('2d');
    const cw = destCanvas.width, ch = destCanvas.height;
    const iw = img.naturalWidth  || img.width;
    const ih = img.naturalHeight || img.height;

    dc.clearRect(0, 0, cw, ch);

    let sx = 0, sy = 0, sw = iw, sh = ih;  // source rect
    let dx = 0, dy = 0, dw = cw, dh = ch;  // dest rect

    if (fitMode === 'fit') {
      const scale = Math.min(cw / iw, ch / ih);
      dw = iw * scale; dh = ih * scale;
      dx = (cw - dw) / 2; dy = (ch - dh) / 2;
    } else if (fitMode === 'fill') {
      const scale = Math.max(cw / iw, ch / ih);
      const scaledW = iw * scale, scaledH = ih * scale;
      // source crop to fill canvas
      sw = cw / scale; sh = ch / scale;
      sx = (iw - sw) / 2; sy = (ih - sh) / 2;
      dx = 0; dy = 0; dw = cw; dh = ch;
      dc.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      return;
    } else if (fitMode === 'center') {
      dw = iw; dh = ih;
      dx = (cw - dw) / 2; dy = (ch - dh) / 2;
    }
    // stretch & fit fall through to simple drawImage
    dc.drawImage(img, dx, dy, dw, dh);
  }

  // ── Show the import modal, pre-filling context from app state ─
  function openImportModal(img, fileName) {
    _pendingImg  = img;
    _pendingName = fileName || 'Image';

    // Update sub-text with image size
    subText.textContent =
      `Image: ${img.naturalWidth}×${img.naturalHeight}px — where to place it?`;

    // Current layer label
    const cl = layers[curLayer];
    if (cl) {
      optCurName.textContent = cl.name;
      optCurDesc.textContent =
        'Draw the image onto frame ' + (curFrame + 1) + ' of "' + cl.name + '"';
    }
    optCurWrap.style.display = '';

    // Group option — show if activeGroupId is set OR current layer is inside a group
    const gid = activeGroupId || (cl && cl.groupId) || null;
    const grp = gid ? groups.find(g => g.id === gid) : null;
    if (grp) {
      optGroupName.textContent = grp.name;
      optGroupWrap.style.display = '';
    } else {
      optGroupWrap.style.display = 'none';
      // If "group-layer" was selected but group no longer exists, fall back
      const sel = modal.querySelector('input[name="img-import-dest"]:checked');
      if (sel && sel.value === 'group-layer') {
        modal.querySelector('input[value="new-layer"]').checked = true;
        modal.querySelectorAll('.img-import-opt').forEach(w => w.classList.remove('selected'));
        document.getElementById('opt-new-layer-wrap').classList.add('selected');
      }
    }

    modal.classList.add('visible');
  }

  // ── Perform the actual import after the user clicks OK ────────
  function doImport() {
    const dest    = (modal.querySelector('input[name="img-import-dest"]:checked') || {}).value || 'new-layer';
    const fitMode = fitSelect.value;
    const img     = _pendingImg;
    if (!img) return;

    saveActiveToKey();   // flush active canvas to key first

    if (dest === 'new-layer' || dest === 'group-layer') {
      // ── Create a fresh layer, draw image onto it ────────────
      const baseName = _pendingName.replace(/\.[^.]+$/, '') || 'Image';
      const newLayer = {
        name: baseName,
        visible: true,
        onTimeline: true,
        color: LCOLORS[layers.length % LCOLORS.length],
        frames: {},
        frameMeta: {},
        opacity: 1,
        stencil: 'none',
        clipTo: null,
        groupId: null
      };

      // Determine groupId and insertion point
      let insertAt = curLayer + 1;
      if (dest === 'group-layer') {
        const gid = activeGroupId || (layers[curLayer] && layers[curLayer].groupId) || null;
        if (gid) {
          newLayer.groupId = gid;
          // Insert above topmost layer in that group
          let topIdx = -1;
          layers.forEach((l, i) => { if (l.groupId === gid && i > topIdx) topIdx = i; });
          insertAt = topIdx >= 0 ? topIdx + 1 : layers.length;
        }
      } else if (layers[curLayer] && layers[curLayer].groupId && !activeGroupId) {
        // Current layer is inside a group — new layer joins that group too
        newLayer.groupId = layers[curLayer].groupId;
      }

      // Draw onto this frame
      const kc = mkLayerCanvas();
      drawImageFitted(kc, img, fitMode);
      newLayer.frames[curFrame] = kc;

      layers.splice(insertAt, 0, newLayer);
      _reanchorAllStencils();
      curLayer = insertAt;
      selectedLayerIndices.clear();

      // Switch to the new layer
      loadFrame(curLayer, curFrame);
      renderLayerPanel();
      renderTimeline();

    } else {
      // ── Import onto current layer's current frame ────────────
      ensureKey();
      // Revised GPU integration: compose the merged frame entirely on a
      // private scratch canvas (existing key content + the imported
      // image), never touching activeC/ctx directly. loadFrame() below
      // is the single choke point that pushes the result onto whichever
      // renderer is actually authoritative (BrushRenderer.loadActiveSurface(),
      // see panels.js), so there is no need — and no correctness benefit —
      // to pre-paint it onto activeC here first.
      const existingKey = getHeldKey(curLayer, curFrame);
      const merged = mkLayerCanvas();
      const mc = merged.getContext('2d');
      if (existingKey) mc.drawImage(existingKey, 0, 0);
      drawImageFitted(merged, img, fitMode);
      layers[curLayer].frames[curFrame] = merged;
      // Reload so the active renderer's surface and composite are fresh
      loadFrame(curLayer, curFrame);
      renderTimeline();
    }

    _pendingImg = null;
    _pendingName = '';
  }

  // ── Modal actions ─────────────────────────────────────────────
  btnOk.onclick = () => {
    modal.classList.remove('visible');
    doImport();
  };
  btnCancel.onclick = () => {
    modal.classList.remove('visible');
    _pendingImg = null;
    _pendingName = '';
  };
  modal.addEventListener('click', e => {
    if (e.target === modal) btnCancel.onclick();
  });

  // ── Load image from a Blob (e.g. clipboard) → HTMLImageElement ─
  function loadImageBlob(blob, name) {
    return new Promise((resolve, reject) => {
      if (!blob || !blob.type || !blob.type.startsWith('image/')) {
        reject(new Error('Not an image'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  // ── Paste image from the system clipboard (Ctrl+Shift+V / Edit menu) ─
  // Reuses the exact same modal as drag-drop/file import, so the user gets
  // the familiar "current layer vs. new layer" choice either way.
  async function pasteImageFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      showInfo('Clipboard image paste isn\'t supported in this browser.', 'Paste Image');
      return;
    }
    let items;
    try {
      items = await navigator.clipboard.read();
    } catch (err) {
      // Most commonly: permission denied, or nothing on the clipboard.
      showInfo('Couldn\'t read the clipboard. Your browser may need permission, or there\'s no image copied.', 'Paste Image');
      return;
    }
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (!imgType) continue;
      try {
        const blob = await item.getType(imgType);
        const img = await loadImageBlob(blob);
        openImportModal(img, 'Pasted Image');
        // Pasted images default to original size / no stretch — center
        // is the only fit mode that doesn't resample/scale the pixels.
        fitSelect.value = 'center';
        return;
      } catch (err) {
        showInfo('Could not load the pasted image: ' + err.message, 'Paste Image');
        return;
      }
    }
    showInfo('No image found on the clipboard.', 'Paste Image');
  }
  window.pasteImageFromClipboard = pasteImageFromClipboard;

  document.getElementById('dd-paste-image').onclick = () => {
    closeAllDropdowns();
    pasteImageFromClipboard();
  };

  // ── Load image from File object → HTMLImageElement ────────────
  function loadImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Not an image file'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  // ── Drag-and-drop — whole document ───────────────────────────
  let _dragCounter = 0;   // track nested dragenter/dragleave pairs

  // ── Block the browser from opening the file in a new tab ─────
  // We must call preventDefault() on EVERY dragover and dragenter,
  // regardless of file type — the browser decides to navigate on drop
  // if any prior dragover was not prevented.
  function isImageDrop(dt) {
    if (!dt) return false;
    const fileItems = Array.from(dt.items || []).filter(item => item.kind === 'file');
    if (fileItems.length) {
      const typedItems = fileItems.filter(item => item.type);
      if (typedItems.length) return typedItems.some(item => item.type.startsWith('image/'));
    }
    // During dragover, browsers expose types but not the actual files.
    // 'Files' covers all file drags. We filter to images on actual drop.
    for (const t of (dt.types || [])) {
      if (t === 'Files' || t === 'application/x-moz-file') return true;
    }
    return false;
  }

  document.addEventListener('dragenter', e => {
    e.preventDefault();   // always prevent — stops new-tab navigation
    if (!isImageDrop(e.dataTransfer)) return;
    _dragCounter++;
    overlay.classList.add('active');
    if (canvasArea.contains(e.target) || e.target === canvasArea) {
      overlay.classList.add('over-canvas');
    }
  }, false);

  document.addEventListener('dragover', e => {
    e.preventDefault();   // always prevent — critical, must be on every event
    if (!isImageDrop(e.dataTransfer)) return;
    e.dataTransfer.dropEffect = 'copy';
    if (canvasArea.contains(e.target) || e.target === canvasArea) {
      overlay.classList.add('over-canvas');
    } else {
      overlay.classList.remove('over-canvas');
    }
  }, false);

  document.addEventListener('dragleave', e => {
    if (!isImageDrop(e.dataTransfer)) return;
    _dragCounter--;
    if (_dragCounter <= 0) {
      _dragCounter = 0;
      overlay.classList.remove('active', 'over-canvas');
    }
  }, false);

  document.addEventListener('drop', e => {
    e.preventDefault();   // always prevent — stops new-tab navigation on drop
    _dragCounter = 0;
    overlay.classList.remove('active', 'over-canvas');

    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Find first image file in the drop
    let imgFile = null;
    for (const f of files) {
      if (f.type.startsWith('image/')) { imgFile = f; break; }
    }
    if (!imgFile) return;

    loadImageFile(imgFile)
      .then(img => openImportModal(img, imgFile.name))
      .catch(err => showInfo('Could not load image: ' + err.message, 'Import Error'));
  }, false);

  // ── File menu "Import Image…" ─────────────────────────────────
  document.getElementById('dd-import-image').onclick = () => {
    closeAllDropdowns();
    fileInput.value = '';   // reset so same file can be re-selected
    fileInput.click();
  };

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    loadImageFile(f)
      .then(img => openImportModal(img, f.name))
      .catch(err => showInfo('Could not load image: ' + err.message, 'Import Error'));
  });

})(); // end ImageImport