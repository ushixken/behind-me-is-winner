// project-recovery.js — IndexedDB Recovery Autosaves & Crash Protection
(function () {
  "use strict";

  const DB_NAME = "AnimatorRecovery";
  const DB_VERSION = 1;
  const STORE_NAME = "recoverySnapshots";
  const MAX_GENERATIONS = 5;
  const PREF_STORAGE_KEY = "animator_recovery_autosave_delay";
  const DEFAULT_DEBOUNCE_MS = 5000; // 5 seconds default
  const ALLOWED_DELAYS = [2000, 5000, 10000, 15000, 30000];
  const MAX_INTERVAL_MS = 60000; // 60 seconds maximum dirty interval
  const RETRY_DEFER_MS = 2500; // 2.5 seconds retry if stylus/drawing active

  let _dbPromise = null;
  let _debounceTimer = null;
  let _maxTimer = null;
  let _firstDirtyTime = null;
  let _isSaving = false;
  let _hasPendingRequest = false;
  let _lastSuccessTime = null;
  let _latestTimestamp = null;
  let _latestBytes = 0;
  let _cachedCount = 0;
  let _lastError = null;

  function getAutosaveDelayMs() {
    try {
      const stored = localStorage.getItem(PREF_STORAGE_KEY);
      if (stored === "off" || stored === "0") return 0;
      if (stored !== null) {
        const num = Number(stored);
        if (ALLOWED_DELAYS.includes(num)) return num;
      }
    } catch (e) {}
    return DEFAULT_DEBOUNCE_MS;
  }

  function setAutosaveDelayMs(val) {
    let toStore = "5000";
    let delayMs = DEFAULT_DEBOUNCE_MS;
    if (val === "off" || val === 0 || val === "0") {
      toStore = "off";
      delayMs = 0;
    } else {
      const num = Number(val);
      if (ALLOWED_DELAYS.includes(num)) {
        toStore = String(num);
        delayMs = num;
      }
    }
    try {
      localStorage.setItem(PREF_STORAGE_KEY, toStore);
    } catch (e) {}

    // Reschedule or cancel pending timers immediately
    if (delayMs <= 0) {
      clearTimers();
    } else {
      if (
        typeof window.isProjectDirty === "function" &&
        window.isProjectDirty()
      ) {
        scheduleAutosave();
      } else {
        clearTimers();
      }
    }
    _syncPreferenceUI();
  }

  function _syncPreferenceUI() {
    if (typeof document === "undefined") return;
    const select = document.getElementById("pref-recovery-delay");
    if (!select) return;
    const delay = getAutosaveDelayMs();
    select.value = delay === 0 ? "off" : String(delay);
  }

  function _initPreferenceUI() {
    if (typeof document === "undefined") return;
    const select = document.getElementById("pref-recovery-delay");
    if (select) {
      _syncPreferenceUI();
      select.onchange = (e) => {
        setAutosaveDelayMs(e.target.value);
      };
    }
    const prefBtn = document.getElementById("dd-preferences");
    if (prefBtn) {
      prefBtn.addEventListener("click", _syncPreferenceUI);
    }
  }

  function isSupported() {
    return (
      typeof window !== "undefined" &&
      "indexedDB" in window &&
      window.indexedDB !== null
    );
  }

  function getDB() {
    if (!isSupported()) {
      return Promise.reject(
        new Error("IndexedDB is unavailable in this environment"),
      );
    }
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
            store.createIndex("timestamp", "timestamp", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          _lastError =
            req.error || new Error("Failed to open IndexedDB " + DB_NAME);
          reject(_lastError);
        };
      } catch (err) {
        _lastError = err;
        reject(err);
      }
    });
    return _dbPromise;
  }

  async function countSnapshots() {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = () => {
          _cachedCount = req.result || 0;
          resolve(_cachedCount);
        };
        req.onerror = () => resolve(_cachedCount);
      });
    } catch (_) {
      return _cachedCount;
    }
  }

  async function pruneOldGenerations() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const index = store.index("timestamp");
        const req = index.getAll();
        req.onsuccess = () => {
          const records = Array.isArray(req.result) ? req.result : [];
          _cachedCount = records.length;
          if (records.length <= MAX_GENERATIONS) {
            resolve();
            return;
          }
          records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const toDelete = records.slice(MAX_GENERATIONS);
          for (const item of toDelete) {
            if (item && item.id) {
              store.delete(item.id);
            }
          }
          _cachedCount = Math.min(records.length, MAX_GENERATIONS);
          resolve();
        };
        req.onerror = () => {
          resolve(); // Non-fatal
        };
      });
    } catch (err) {
      console.warn("[ProjectRecovery] Prune warning:", err);
    }
  }

  function clearTimers() {
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    if (_maxTimer !== null) {
      clearTimeout(_maxTimer);
      _maxTimer = null;
    }
    _firstDirtyTime = null;
  }

  function scheduleAutosave() {
    if (
      typeof window.isProjectDirty === "function" &&
      !window.isProjectDirty()
    ) {
      clearTimers();
      return;
    }
    const delayMs = getAutosaveDelayMs();
    if (delayMs <= 0) {
      clearTimers();
      return;
    }
    if (_firstDirtyTime === null) {
      _firstDirtyTime = Date.now();
    }
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      triggerAutosave("debounce");
    }, delayMs);

    if (_maxTimer === null) {
      _maxTimer = setTimeout(() => {
        _maxTimer = null;
        triggerAutosave("max-interval");
      }, MAX_INTERVAL_MS);
    }
  }

  function triggerAutosave(reason) {
    if (
      typeof window.isProjectDirty === "function" &&
      !window.isProjectDirty()
    ) {
      clearTimers();
      return;
    }
    if (
      typeof window.isDrawingActive === "function" &&
      window.isDrawingActive()
    ) {
      // User is actively stroking: defer without interrupting
      if (_debounceTimer !== null) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        triggerAutosave("retry-after-active-drawing");
      }, RETRY_DEFER_MS);
      return;
    }
    saveNow({ reason: "autosave-" + reason }).catch((err) => {
      console.warn(
        "[ProjectRecovery] Autosave deferred/skipped:",
        err && err.message ? err.message : err,
      );
    });
  }

  async function saveNow(options = {}) {
    const forced = !!options.forced;
    const isDirty =
      typeof window.isProjectDirty === "function"
        ? window.isProjectDirty()
        : false;
    if (!forced && !isDirty) {
      return null;
    }
    if (_isSaving) {
      _hasPendingRequest = true;
      return null;
    }
    _isSaving = true;
    clearTimers();

    try {
      if (typeof window.awaitPendingBrushCommits === "function") {
        await window.awaitPendingBrushCommits();
      }
      if (
        !window.ProjectIO ||
        typeof window.ProjectIO.buildProjectArchive !== "function"
      ) {
        throw new Error("ProjectIO.buildProjectArchive is unavailable");
      }
      const archiveResult = await window.ProjectIO.buildProjectArchive({
        finishDrawing: false,
        awaitCommits: true,
        compressionLevel: 4,
      });

      if (
        !archiveResult ||
        !archiveResult.blob ||
        archiveResult.blob.size <= 0
      ) {
        throw new Error(
          "Project archive serialization produced an empty payload",
        );
      }

      // Validate staged payload before writing
      if (typeof window.ProjectIO.stageProject === "function") {
        await window.ProjectIO.stageProject(archiveResult.blob);
      }

      const now = Date.now();
      const snapshotId =
        "recovery_" + now + "_" + Math.random().toString(36).slice(2, 8);
      const manifestDoc =
        archiveResult.manifest && archiveResult.manifest.document
          ? archiveResult.manifest.document
          : {};
      const record = {
        id: snapshotId,
        timestamp: now,
        isoDate: new Date(now).toISOString(),
        appVersion:
          (typeof window !== "undefined" && window.APP_VERSION) || "1.0.0",
        projectFormatVersion:
          (window.ProjectIO && window.ProjectIO.version) || 2,
        projectName: archiveResult.name || "Untitled",
        blob: archiveResult.blob,
        byteSize: archiveResult.blob.size,
        layerCount: archiveResult.layers || 0,
        frameCount: manifestDoc.totalFrames || 0,
        width: manifestDoc.width || 0,
        height: manifestDoc.height || 0,
        reason: options.reason || "manual",
      };

      const db = await getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () =>
          reject(
            req.error ||
              new Error("Failed to write recovery snapshot to IndexedDB"),
          );
      });

      _lastSuccessTime = now;
      _latestTimestamp = now;
      _latestBytes = record.byteSize;
      _lastError = null;

      // Prune after writing new snapshot successfully
      await pruneOldGenerations();

      return {
        id: record.id,
        timestamp: record.timestamp,
        projectName: record.projectName,
        byteSize: record.byteSize,
        layerCount: record.layerCount,
      };
    } catch (err) {
      _lastError = err;
      console.warn(
        "[ProjectRecovery] Snapshot failed:",
        err && err.message ? err.message : err,
      );
      throw err;
    } finally {
      _isSaving = false;
      if (_hasPendingRequest) {
        _hasPendingRequest = false;
        if (
          typeof window.isProjectDirty === "function" &&
          window.isProjectDirty()
        ) {
          scheduleAutosave();
        }
      }
    }
  }

  async function getLatest() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const index = store.index("timestamp");
        const req = index.openCursor(null, "prev"); // newest first
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor && cursor.value) {
            resolve(cursor.value);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => {
          reject(
            req.error || new Error("Failed to read latest recovery snapshot"),
          );
        };
      });
    } catch (err) {
      _lastError = err;
      return null;
    }
  }

  async function list() {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const index = store.index("timestamp");
        const req = index.getAll();
        req.onsuccess = () => {
          const records = Array.isArray(req.result) ? req.result : [];
          records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const summaries = records.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            isoDate: r.isoDate,
            projectName: r.projectName,
            byteSize: r.byteSize,
            layerCount: r.layerCount,
            frameCount: r.frameCount,
            width: r.width,
            height: r.height,
            reason: r.reason,
          }));
          _cachedCount = summaries.length;
          resolve(summaries);
        };
        req.onerror = () =>
          reject(req.error || new Error("Failed to list recovery snapshots"));
      });
    } catch (err) {
      _lastError = err;
      return [];
    }
  }

  async function clearAll() {
    clearTimers();
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => {
          _cachedCount = 0;
          _latestTimestamp = null;
          _latestBytes = 0;
          resolve();
        };
        req.onerror = () =>
          reject(req.error || new Error("Failed to clear recovery snapshots"));
      });
    } catch (err) {
      _lastError = err;
    }
  }

  async function deleteSnapshot(id) {
    if (!id) return;
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () =>
          reject(req.error || new Error("Failed to delete snapshot " + id));
      });
    } catch (err) {
      _lastError = err;
    }
  }

  async function analyze() {
    let latestSnap = null;
    try {
      latestSnap = await getLatest();
    } catch (_) {}
    const count = await countSnapshots();
    return {
      supported: isSupported(),
      dirty:
        typeof window.isProjectDirty === "function"
          ? window.isProjectDirty()
          : false,
      autosaveDelayMs: getAutosaveDelayMs(),
      saveInProgress: _isSaving,
      pendingAutosave: _debounceTimer !== null || _maxTimer !== null,
      snapshotCount: count,
      latestTimestamp: latestSnap ? latestSnap.timestamp : null,
      latestBytes: latestSnap
        ? latestSnap.byteSize || (latestSnap.blob ? latestSnap.blob.size : 0)
        : 0,
      lastSuccessTime: _lastSuccessTime,
      lastError: _lastError ? _lastError.message || String(_lastError) : null,
    };
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) return "Recently";
    const elapsedSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSec < 30) return "Just now";
    if (elapsedSec < 90) return "1 minute ago";
    const elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return elapsedMin + " minutes ago";
    const elapsedHours = Math.floor(elapsedMin / 60);
    if (elapsedHours === 1) return "1 hour ago";
    if (elapsedHours < 24) return elapsedHours + " hours ago";
    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays === 1) return "Yesterday";
    if (elapsedDays < 30) return elapsedDays + " days ago";
    return new Date(timestamp).toLocaleDateString();
  }

  let _recoveryModalEl = null;
  function _ensureRecoveryModal() {
    if (
      _recoveryModalEl &&
      document.body &&
      document.body.contains(_recoveryModalEl)
    )
      return _recoveryModalEl;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "modal-project-recovery";
    overlay.innerHTML =
      '<div class="modal site-dialog-modal" style="min-width:320px;max-width:400px;">' +
      '<h2 id="recovery-dialog-title">Recover Project?</h2>' +
      '<div class="site-dialog-message" style="margin-bottom:12px;font-size:12px;color:var(--text2);line-height:1.4;">' +
      "An unsaved project was found." +
      "</div>" +
      '<div style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:var(--text);display:flex;flex-direction:column;gap:5px;">' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Project:</span><span style="font-weight:500;word-break:break-all;margin-left:8px;" id="recovery-meta-name">Untitled</span></div>' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Recovered:</span><span id="recovery-meta-time">Recently</span></div>' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Layers:</span><span id="recovery-meta-layers">1</span></div>' +
      '<div style="display:flex;justify-content:space-between;"><span style="color:var(--text2);">Frames:</span><span id="recovery-meta-frames">1</span></div>' +
      "</div>" +
      '<div style="font-size:12px;color:var(--text2);margin-bottom:16px;">' +
      "Would you like to recover it?" +
      "</div>" +
      '<div class="modal-actions" id="recovery-dialog-actions" style="display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="modal-btn" id="recovery-dialog-discard">Discard</button>' +
      '<button class="modal-btn primary" id="recovery-dialog-recover">Recover Project</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    _recoveryModalEl = overlay;
    return overlay;
  }

  function showRecoveryPrompt(snapshot) {
    const overlay = _ensureRecoveryModal();
    const nameEl = overlay.querySelector("#recovery-meta-name");
    const timeEl = overlay.querySelector("#recovery-meta-time");
    const layersEl = overlay.querySelector("#recovery-meta-layers");
    const framesEl = overlay.querySelector("#recovery-meta-frames");
    const recoverBtn = overlay.querySelector("#recovery-dialog-recover");
    const discardBtn = overlay.querySelector("#recovery-dialog-discard");

    nameEl.textContent = snapshot.projectName || "Untitled";
    timeEl.textContent = formatRelativeTime(snapshot.timestamp);
    layersEl.textContent = String(snapshot.layerCount || 1);
    framesEl.textContent = String(snapshot.frameCount || 1);

    overlay.classList.add("visible");

    return new Promise((resolve) => {
      function cleanup(action) {
        overlay.classList.remove("visible");
        recoverBtn.removeEventListener("click", onRecover);
        discardBtn.removeEventListener("click", onDiscard);
        document.removeEventListener("keydown", onKey);
        resolve(action);
      }
      function onRecover() {
        cleanup("recover");
      }
      function onDiscard() {
        cleanup("discard");
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.stopPropagation();
          cleanup("discard");
        } else if (e.key === "Enter") {
          e.stopPropagation();
          cleanup("recover");
        }
      }
      recoverBtn.addEventListener("click", onRecover);
      discardBtn.addEventListener("click", onDiscard);
      document.addEventListener("keydown", onKey);
      setTimeout(() => recoverBtn.focus(), 30);
    });
  }

  async function showRecoveryFailedPrompt() {
    if (typeof window.siteConfirm === "function") {
      const discard = await window.siteConfirm(
        "The recovery snapshot could not be opened.\n\nWould you like to discard this recovery snapshot?",
        {
          title: "Recovery Failed",
          okText: "Discard Recovery",
          cancelText: "Continue",
          danger: true,
        },
      );
      return discard ? "discard" : "continue";
    } else if (typeof window.siteAlert === "function") {
      await window.siteAlert("The recovery snapshot could not be opened.", {
        title: "Recovery Failed",
      });
      return "discard";
    }
    return "discard";
  }

  let _recoveryCheckRan = false;
  async function checkStartupRecovery() {
    if (_recoveryCheckRan) return;
    _recoveryCheckRan = true;

    if (!isSupported()) return;
    let latest = null;
    try {
      latest = await getLatest();
    } catch (err) {
      console.warn("[ProjectRecovery] Startup check error:", err);
      return;
    }

    if (!latest || !latest.blob) return;

    const action = await showRecoveryPrompt(latest);
    if (action === "recover") {
      try {
        if (
          !window.ProjectIO ||
          typeof window.ProjectIO.importProject !== "function"
        ) {
          throw new Error("Project loader is unavailable");
        }
        await window.ProjectIO.importProject(latest.blob, { isRecovery: true });
      } catch (err) {
        console.error("[ProjectRecovery] Recovery import failed:", err);
        const failedAction = await showRecoveryFailedPrompt();
        if (failedAction === "discard") {
          await deleteSnapshot(latest.id);
        }
      }
    } else if (action === "discard") {
      try {
        await clearAll();
      } catch (err) {
        console.warn("[ProjectRecovery] Discard clear error:", err);
      }
    }
  }

  function notifyMutation(reason, isFirstMutation) {
    scheduleAutosave();
  }

  function notifyClean(reason) {
    clearTimers();
    // When the user explicitly saves, opens, or starts a new project, prune/clear the recovery session
    if (reason === "save" || reason === "open" || reason === "new") {
      clearAll().catch((err) =>
        console.warn("[ProjectRecovery] Clean notice warning:", err),
      );
    }
  }

  // Page visibilitychange handler for prompt background autosave opportunity
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (
          typeof window.isProjectDirty === "function" &&
          window.isProjectDirty()
        ) {
          if (
            typeof window.isDrawingActive !== "function" ||
            !window.isDrawingActive()
          ) {
            if (!_isSaving) {
              saveNow({ reason: "visibility-hidden" }).catch(() => {});
            }
          }
        }
      }
    });
  }

  // Initialize count and preference UI on startup
  if (isSupported()) {
    countSnapshots().catch(() => {});
  }

  if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _initPreferenceUI);
    } else {
      _initPreferenceUI();
    }
  }

  // Startup recovery check hook
  if (typeof window !== "undefined") {
    if (document.readyState === "complete") {
      setTimeout(checkStartupRecovery, 50);
    } else {
      window.addEventListener("load", () =>
        setTimeout(checkStartupRecovery, 50),
      );
    }
  }

  window.ProjectRecovery = {
    isSupported,
    getLatest,
    list,
    saveNow,
    clearAll,
    deleteSnapshot,
    analyze,
    notifyMutation,
    notifyClean,
    checkStartupRecovery,
    getAutosaveDelay: getAutosaveDelayMs,
    setAutosaveDelay: setAutosaveDelayMs,
    schedule: scheduleAutosave,
  };
})();
