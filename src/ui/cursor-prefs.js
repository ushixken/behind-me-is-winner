// ════════════════════════════════════════════════════════════════
// CANVAS CURSOR STYLE (Edit ▸ Preferences ▸ Cursor)
// Lets people choose what the pointer looks like while it's over the
// drawing canvas: the default crosshair, a fine point cursor, or a live
// circle matching the current brush/eraser radius (see
// brush-size-cursor.js for the circle itself). Persisted like the
// renderer preference so it survives reloads.
// ════════════════════════════════════════════════════════════════
let cursorStyle='crosshair';
try{ cursorStyle=localStorage.getItem('animator_cursor_style')||'crosshair'; }catch(e){}

// A small precise dot, used for 'point' mode. Falls back to the native
// crosshair cursor in browsers that can't render the custom image.
const _POINT_CURSOR_CSS="url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='15' height='15'><circle cx='7.5' cy='7.5' r='2.5' fill='white' stroke='black' stroke-width='1.3'/></svg>\") 7 7, crosshair";
const _EYEDROPPER_CURSOR_CSS="url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M19.7 4.3a2.4 2.4 0 0 0-3.4 0l-2.1 2.1-.9-.9-1.4 1.4.9.9-7.6 7.6-.7 3.1 3.1-.7 7.6-7.6.9.9 1.4-1.4-.9-.9 2.1-2.1a2.4 2.4 0 0 0 0-3.4Z' fill='white' stroke='black' stroke-width='2' stroke-linejoin='round'/></svg>\") 4 20, crosshair";

// The CSS cursor to use for the canvas in its normal idle state (i.e. not
// mid pan/zoom/rotate, which use their own transient cursors). 'brush'
// hides the native cursor entirely — brush-size-cursor.js draws a live
// circle overlay in its place.
function _baseCursorCSS(){
  if(typeof tool!=='undefined'&&tool==='eyedropper') return _EYEDROPPER_CURSOR_CSS;
  if(cursorStyle==='point') return _POINT_CURSOR_CSS;
  if(cursorStyle==='brush') return 'none';
  return 'crosshair';
}

function _setCursorStyle(v){
  cursorStyle=v;
  try{ localStorage.setItem('animator_cursor_style',v); }catch(e){}
  _refreshActiveCursor();
}

// Re-applies the correct idle cursor to the canvas right now, e.g. right
// after the preference changes, without waiting for the next pan/zoom/
// rotate/space transition to pick it up.
function _refreshActiveCursor(){
  if(typeof activeC==='undefined'||!activeC) return;
  if(panning||_zoomDrag||_rotateDrag||spaceHeld) return;
  const toolGroupId=window.ToolGroups?.activeGroupId||null;
  activeC.style.cursor=toolGroupId?'not-allowed':_baseCursorCSS();
}

// Apply on load, since the CSS default (crosshair) is only a fallback for
// before this runs — someone whose saved preference is 'point' or 'brush'
// should see that immediately, not the crosshair until their first
// space/zoom/rotate interaction happens to refresh it.
_refreshActiveCursor();
