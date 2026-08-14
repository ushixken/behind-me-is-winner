// project-recovery.js — IndexedDB Recovery Autosaves & Crash Protection
(function(){
  'use strict';

  const DB_NAME = 'AnimatorRecovery';
  const DB_VERSION = 1;
  const STORE_NAME = 'recoverySnapshots';
  const MAX_GENERATIONS = 5;
  const DEBOUNCE_MS = 15000;    // 15 seconds after latest mutation
  const MAX_INTERVAL_MS = 60000; // 60 seconds maximum dirty interval
  const RETRY_DEFER_MS = 2500;   // 2.5 seconds retry if stylus/drawing active

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

  function isSupported(){
    return typeof window !== 'undefined' && 'indexedDB' in window && window.indexedDB !== null;
  }

  function getDB(){
    if(!isSupported()){
      return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
    }
    if(_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
          const db = req.result;
          if(!db.objectStoreNames.contains(STORE_NAME)){
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          _lastError = req.error || new Error('Failed to open IndexedDB ' + DB_NAME);
          reject(_lastError);
        };
      } catch(err) {
        _lastError = err;
        reject(err);
      }
    });
    return _dbPromise;
  }

  async function countSnapshots(){
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.count();
        req.onsuccess = () => {
          _cachedCount = req.result || 0;
          resolve(_cachedCount);
        };
        req.onerror = () => resolve(_cachedCount);
      });
    } catch(_) {
      return _cachedCount;
    }
  }

  async function pruneOldGenerations(){
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const req = index.getAll();
        req.onsuccess = () => {
          const records = Array.isArray(req.result) ? req.result : [];
          _cachedCount = records.length;
          if(records.length <= MAX_GENERATIONS){
            resolve();
            return;
          }
          records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const toDelete = records.slice(MAX_GENERATIONS);
          for(const item of toDelete){
            if(item && item.id){
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
    } catch(err) {
      console.warn('[ProjectRecovery] Prune warning:', err);
    }
  }

  function clearTimers(){
    if(_debounceTimer !== null){
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    if(_maxTimer !== null){
      clearTimeout(_maxTimer);
      _maxTimer = null;
    }
    _firstDirtyTime = null;
  }

  function scheduleAutosave(){
    if(typeof window.isProjectDirty === 'function' && !window.isProjectDirty()){
      clearTimers();
      return;
    }
    if(_firstDirtyTime === null){
      _firstDirtyTime = Date.now();
    }
    if(_debounceTimer !== null){
      clearTimeout(_debounceTimer);
    }
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      triggerAutosave('debounce');
    }, DEBOUNCE_MS);

    if(_maxTimer === null){
      _maxTimer = setTimeout(() => {
        _maxTimer = null;
        triggerAutosave('max-interval');
      }, MAX_INTERVAL_MS);
    }
  }

  function triggerAutosave(reason){
    if(typeof window.isProjectDirty === 'function' && !window.isProjectDirty()){
      clearTimers();
      return;
    }
    if(typeof window.isDrawingActive === 'function' && window.isDrawingActive()){
      // User is actively stroking: defer without interrupting
      if(_debounceTimer !== null) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        triggerAutosave('retry-after-active-drawing');
      }, RETRY_DEFER_MS);
      return;
    }
    saveNow({ reason: 'autosave-' + reason }).catch(err => {
      console.warn('[ProjectRecovery] Autosave deferred/skipped:', err && err.message ? err.message : err);
    });
  }

  async function saveNow(options = {}){
    const forced = !!options.forced;
    const isDirty = typeof window.isProjectDirty === 'function' ? window.isProjectDirty() : false;
    if(!forced && !isDirty){
      return null;
    }
    if(_isSaving){
      _hasPendingRequest = true;
      return null;
    }
    _isSaving = true;
    clearTimers();

    try {
      if(typeof window.awaitPendingBrushCommits === 'function'){
        await window.awaitPendingBrushCommits();
      }
      if(!window.ProjectIO || typeof window.ProjectIO.buildProjectArchive !== 'function'){
        throw new Error('ProjectIO.buildProjectArchive is unavailable');
      }
      const archiveResult = await window.ProjectIO.buildProjectArchive({
        finishDrawing: false,
        awaitCommits: true,
        compressionLevel: 4
      });

      if(!archiveResult || !archiveResult.blob || archiveResult.blob.size <= 0){
        throw new Error('Project archive serialization produced an empty payload');
      }

      // Validate staged payload before writing
      if(typeof window.ProjectIO.stageProject === 'function'){
        await window.ProjectIO.stageProject(archiveResult.blob);
      }

      const now = Date.now();
      const snapshotId = 'recovery_' + now + '_' + Math.random().toString(36).slice(2, 8);
      const manifestDoc = archiveResult.manifest && archiveResult.manifest.document ? archiveResult.manifest.document : {};
      const record = {
        id: snapshotId,
        timestamp: now,
        isoDate: new Date(now).toISOString(),
        appVersion: (typeof window !== 'undefined' && window.APP_VERSION) || '1.0.0',
        projectFormatVersion: (window.ProjectIO && window.ProjectIO.version) || 2,
        projectName: archiveResult.name || 'Untitled',
        blob: archiveResult.blob,
        byteSize: archiveResult.blob.size,
        layerCount: archiveResult.layers || 0,
        frameCount: manifestDoc.totalFrames || 0,
        width: manifestDoc.width || 0,
        height: manifestDoc.height || 0,
        reason: options.reason || 'manual'
      };

      const db = await getDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Failed to write recovery snapshot to IndexedDB'));
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
        layerCount: record.layerCount
      };
    } catch(err) {
      _lastError = err;
      console.warn('[ProjectRecovery] Snapshot failed:', err && err.message ? err.message : err);
      throw err;
    } finally {
      _isSaving = false;
      if(_hasPendingRequest){
        _hasPendingRequest = false;
        if(typeof window.isProjectDirty === 'function' && window.isProjectDirty()){
          scheduleAutosave();
        }
      }
    }
  }

  async function getLatest(){
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const req = index.openCursor(null, 'prev'); // newest first
        req.onsuccess = () => {
          const cursor = req.result;
          if(cursor && cursor.value){
            resolve(cursor.value);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => {
          reject(req.error || new Error('Failed to read latest recovery snapshot'));
        };
      });
    } catch(err) {
      _lastError = err;
      return null;
    }
  }

  async function list(){
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const req = index.getAll();
        req.onsuccess = () => {
          const records = Array.isArray(req.result) ? req.result : [];
          records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          const summaries = records.map(r => ({
            id: r.id,
            timestamp: r.timestamp,
            isoDate: r.isoDate,
            projectName: r.projectName,
            byteSize: r.byteSize,
            layerCount: r.layerCount,
            frameCount: r.frameCount,
            width: r.width,
            height: r.height,
            reason: r.reason
          }));
          _cachedCount = summaries.length;
          resolve(summaries);
        };
        req.onerror = () => reject(req.error || new Error('Failed to list recovery snapshots'));
      });
    } catch(err) {
      _lastError = err;
      return [];
    }
  }

  async function clearAll(){
    clearTimers();
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => {
          _cachedCount = 0;
          _latestTimestamp = null;
          _latestBytes = 0;
          resolve();
        };
        req.onerror = () => reject(req.error || new Error('Failed to clear recovery snapshots'));
      });
    } catch(err) {
      _lastError = err;
    }
  }

  async function deleteSnapshot(id){
    if(!id) return;
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('Failed to delete snapshot ' + id));
      });
    } catch(err) {
      _lastError = err;
    }
  }

  async function analyze(){
    let latestSnap = null;
    try {
      latestSnap = await getLatest();
    } catch(_) {}
    const count = await countSnapshots();
    return {
      supported: isSupported(),
      dirty: typeof window.isProjectDirty === 'function' ? window.isProjectDirty() : false,
      saveInProgress: _isSaving,
      pendingAutosave: _debounceTimer !== null || _maxTimer !== null,
      snapshotCount: count,
      latestTimestamp: latestSnap ? latestSnap.timestamp : null,
      latestBytes: latestSnap ? (latestSnap.byteSize || (latestSnap.blob ? latestSnap.blob.size : 0)) : 0,
      lastSuccessTime: _lastSuccessTime,
      lastError: _lastError ? (_lastError.message || String(_lastError)) : null
    };
  }

  function notifyMutation(reason, isFirstMutation){
    scheduleAutosave();
  }

  function notifyClean(reason){
    clearTimers();
    // When the user explicitly saves, opens, or starts a new project, prune/clear the recovery session
    if(reason === 'save' || reason === 'open' || reason === 'new'){
      clearAll().catch(err => console.warn('[ProjectRecovery] Clean notice warning:', err));
    }
  }

  // Page visibilitychange handler for prompt background autosave opportunity
  if(typeof document !== 'undefined'){
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'hidden'){
        if(typeof window.isProjectDirty === 'function' && window.isProjectDirty()){
          if(typeof window.isDrawingActive !== 'function' || !window.isDrawingActive()){
            if(!_isSaving){
              saveNow({ reason: 'visibility-hidden' }).catch(() => {});
            }
          }
        }
      }
    });
  }

  // Initialize count on startup
  if(isSupported()){
    countSnapshots().catch(() => {});
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
    notifyClean
  };

})();
