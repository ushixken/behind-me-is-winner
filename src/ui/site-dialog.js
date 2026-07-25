// ════════════════════════════════════════════════════════════════
// SITE DIALOG — themed replacement for window.confirm()/window.alert()
// Any code that needs a confirm/alert popup should use these instead
// of the native browser dialogs, so it matches the site's modal look
// (see .modal-overlay / .modal / .modal-btn in style.css) instead of
// popping up an unstyled OS dialog like "127.0.0.1:5500 says...".
//
// Usage:
//   const ok = await siteConfirm('Reset all keybinds to their defaults?');
//   if(!ok) return;
//
//   await siteAlert('That file isn\'t valid JSON.');
//
// Both support an options object for finer control:
//   siteConfirm(message, {title, okText, cancelText, danger})
//   siteAlert(message, {title, okText})
// ════════════════════════════════════════════════════════════════

let _siteDialogEl = null;

function _ensureSiteDialog(){
  if(_siteDialogEl) return _siteDialogEl;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-site-dialog';
  overlay.innerHTML =
    '<div class="modal site-dialog-modal">' +
      '<h2 id="site-dialog-title">Confirm</h2>' +
      '<div class="site-dialog-message" id="site-dialog-message"></div>' +
      '<div class="modal-actions" id="site-dialog-actions">' +
        '<button class="modal-btn" id="site-dialog-cancel">Cancel</button>' +
        '<button class="modal-btn primary" id="site-dialog-ok">OK</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  _siteDialogEl = overlay;
  return overlay;
}

// Core implementation shared by siteConfirm/siteAlert.
// mode: 'confirm' (Cancel + OK, resolves true/false) or 'alert' (OK only, resolves true)
function _showSiteDialog(message, opts, mode){
  opts = opts || {};
  const overlay = _ensureSiteDialog();
  const titleEl = overlay.querySelector('#site-dialog-title');
  const msgEl = overlay.querySelector('#site-dialog-message');
  const okBtn = overlay.querySelector('#site-dialog-ok');
  const cancelBtn = overlay.querySelector('#site-dialog-cancel');

  titleEl.textContent = opts.title || (mode === 'alert' ? 'Notice' : 'Confirm');
  // Preserve newlines from messages that were originally written for
  // window.confirm/alert (which used \n for line breaks).
  msgEl.innerHTML = '';
  String(message).split('\n').forEach((line, i) => {
    if(i > 0) msgEl.appendChild(document.createElement('br'));
    msgEl.appendChild(document.createTextNode(line));
  });

  okBtn.textContent = opts.okText || 'OK';
  okBtn.className = 'modal-btn primary' + (opts.danger ? ' danger' : '');
  cancelBtn.textContent = opts.cancelText || 'Cancel';
  cancelBtn.style.display = mode === 'alert' ? 'none' : '';

  overlay.classList.add('visible');

  return new Promise(resolve => {
    function cleanup(result){
      overlay.classList.remove('visible');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk(){ cleanup(true); }
    function onCancel(){ cleanup(false); }
    function onOverlay(e){ if(e.target === overlay) cleanup(false); }
    function onKey(e){
      if(e.key === 'Escape'){ e.stopPropagation(); cleanup(false); }
      else if(e.key === 'Enter'){ e.stopPropagation(); cleanup(true); }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
    setTimeout(() => okBtn.focus(), 20);
  });
}

// Themed drop-in replacement for window.confirm(). Returns a Promise<boolean>.
function siteConfirm(message, opts){
  return _showSiteDialog(message, opts, 'confirm');
}

// Themed drop-in replacement for window.alert(). Returns a Promise<void>.
function siteAlert(message, opts){
  return _showSiteDialog(message, opts, 'alert').then(() => {});
}
