// ════════════════════════════════════════════════════════════════
// DRAWING — getPos uses activeC's own getBoundingClientRect()
// which accounts for the CSS transform, giving pixel-perfect coords
// ════════════════════════════════════════════════════════════════
function getPos(e){
  // getBoundingClientRect() on activeC only gives the axis-aligned bounding
  // box of the rotated element, NOT its true rotated geometry — using it
  // directly (as before) works fine at rotation=0 but drifts the stroke
  // away from the pen tip at any other rotation. Instead, map the client
  // point through canvas-area's rect and invert the same
  // outer-mirror + translate/rotate/scale transform applied to canvas-wrap
  // (mirrors the math in rotateCanvasTo()/applyTransform()) to get exact
  // canvas-pixel coordinates.
  const r=canvasArea.getBoundingClientRect();
  const clientX=e.touches?e.touches[0].clientX:e.clientX;
  const clientY=e.touches?e.touches[0].clientY:e.clientY;
  const ax=clientX-r.left,ay=clientY-r.top;
  // Undo the outer screen-space flip mirror around the (live) nav pivot first.
  const pivot=getNavPivot();
  const fx=flipX?-1:1,fy=flipY?-1:1;
  const qx=pivot.cx+(ax-pivot.cx)*fx;
  const qy=pivot.cy+(ay-pivot.cy)*fy;
  // Then undo the inner translate/rotate/scale chain (flip-agnostic).
  const rad=rotation*Math.PI/180;
  const cosR=Math.cos(rad),sinR=Math.sin(rad);
  const dx=qx-panX,dy=qy-panY;
  const x=(dx*cosR+dy*sinR)/zoom;
  const y=(-dx*sinR+dy*cosR)/zoom;
  return{x,y};
}

function getBrushSize(){return toolSizes[tool]||6;}
// ════════════════════════════════════════════════════════════════
// TVPAINT / CLIP STUDIO STYLE BRUSH ENGINE
//
// Two antialiasing modes, matching how professional animation apps work:
//
//  AA ON  (brushAA=true) — sub-pixel radial gradient dabs.
//    Each dab is a radial gradient: fully opaque core → transparent edge.
//    The feather zone is controlled by brushHardness.
//    This is TVPaint's PenBrush / Clip Studio Paint's normal pen/brush:
//    smooth diagonal edges, anti-aliased curves, soft feel.
//
//  AA OFF (brushAA=false) — pixel-snapped hard stamps.
//    Each dab is filled with ctx.arc() at full opacity, then the result
//    is quantised to whole pixels via getImageData/putImageData.
//    This is TVPaint's Pencil (type 6) / Clip Studio's "pixel pen":
//    every edge pixel is fully ON or fully OFF — no partial alpha.
//    Ideal for cel-animation clean line work.
//
// The eraser always uses the same mode as the current brush.
// ════════════════════════════════════════════════════════════════

function _hexToRGB(hex){
  const h=hex.replace('#','');
  return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
}

// ── Cache key quantization ──────────────────────────────────────────────
// Pressure/velocity/fade/taper dynamics nudge r and alpha by tiny fractions
// on basically every dab, so keying the stamp cache on their EXACT values
// (old code: r.toFixed(2), raw alpha) made the cache miss almost every
// single dab — defeating the whole point of caching and forcing a fresh
// gradient/canvas (AA) or getImageData/putImageData readback (aliased) per
// dab, which is what actually caused the lag in BOTH modes. Quantizing to a
// coarse step means a stroke with continuously-varying pressure still hits
// the same handful of cache entries almost every time — the size/alpha
// difference between two quantization buckets is sub-pixel/imperceptible,
// but the perf difference (cache hit vs. full rebuild) is enormous.
const _Q_R = 0.25;      // px
const _Q_ALPHA = 0.02;  // ~2% alpha steps
function _quant(v,step){return Math.round(v/step)*step;}

// _aaDabCache (defined below, near _buildAAStamp) is a real Map cache of
// CPU-rendered stamps, keyed by quantized size/color/alpha/composite/hardness.
// Other files call _aaDabCache.clear() whenever a brush setting that
// affects the stamp's appearance changes (size, hardness, roundness, AA
// toggle) — this invalidates every cached stamp so the next dab rebuilds.

// ── AA dab: soft, sub-pixel accurate — GPU or CPU rasterized, selectable
// via Edit ▸ Preferences ▸ Renderer (brushRenderer in core-state.js).
//
// GPU mode (_dabAAGpu, default): ctx.createRadialGradient()+fill() — hands
// rasterization to the browser's hardware-accelerated canvas backend.
// Cheap and smooth; this is the recommended default and matches how most
// browser drawing apps behave.
//
// CPU mode (_dabAACpu): computes each dab's alpha falloff by hand,
// pixel-by-pixel, in plain JS (see _buildAAStamp below) into an ImageData
// buffer — closer to how TVPaint's own software brush engine works. This
// is heavier on the CPU by nature (that's the whole point of the option),
// so it's opt-in rather than forced on everyone.
//
// History/why the CPU path is a cached stamp instead of a fresh per-dab draw:
//  v1: cached one bitmap per EXACT radius -> cache thrashed on virtually
//      every dab (pressure/taper nudge r by tiny fractions constantly) ->
//      laggy, since it fell back to a full rebuild almost every time.
//  v2: quantized radius into buckets to fix the cache thrash -> fixed lag
//      but the brush WIDTH visibly stepped between buckets along a stroke
//      (banded / "no subpixel" look).
//  v3: cached one fixed-size reference bitmap and scaled it down to any
//      target radius -> fixed banding, but a typical dab is a >10x
//      downscale; drawImage has no mipmapping, so the bilinear sampler
//      only reads 1-2 source texels per destination pixel and exactly
//      which texels shifts with each dab's subpixel position -> a
//      flickering/scalloped WAVE along the stroke edge.
//  v4: capped the downscale ratio at 2x via size tiers -> reduced the wave
//      but `imageSmoothingQuality='high'` forced a noticeably slower
//      resampling algorithm on every single dab, making it laggy again,
//      while a milder version of the same sampling artifact persisted.
//  v5: build the stamp bitmap ONCE per quantized
//      (size,hardness,color,alpha,composite) combo via a hand-written
//      per-pixel falloff loop — no gradient/scaling involved at all, so
//      none of the v3/v4 resampling artifacts apply — then blit it at the
//      dab's true fractional x/y with normal bilinear smoothing. Only the
//      STAMP's own size is quantized (0.25px steps — imperceptible,
//      already proven fine by the aliased path below); the on-screen
//      *position* stays fully sub-pixel accurate every single dab. This is
//      the current CPU-mode implementation.
const _aaDabCache=new Map(); // key -> {canvas,w,h}
const _AA_DAB_CACHE_MAX=64;
function _buildAAStamp(rRaw,rgb,alphaRaw,composite,hardnessRaw){
  const r=_quant(rRaw,_Q_R), alpha=_quant(alphaRaw,_Q_ALPHA);
  const hardness=Math.round(Math.max(0,Math.min(0.99,hardnessRaw))*100)/100;
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite+'|'+hardness.toFixed(2);
  const hit=_aaDabCache.get(key);
  if(hit) return hit;
  const rr=Math.max(0.05,r);
  const pad=2,ir=Math.ceil(rr);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  const cx=w/2,cy=h/2;
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  const id=tc.createImageData(w,h);
  const d=id.data;
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const inner=hardness;
  const outerSpan=Math.max(0.0001,1-inner);
  let p=0;
  for(let py=0;py<h;py++){
    for(let px=0;px<w;px++,p+=4){
      const dx=(px+0.5)-cx, dy=(py+0.5)-cy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const t=dist/rr;
      let a;
      if(t>=1) a=0;
      else if(t<=inner) a=alpha;
      else a=alpha*(1-(t-inner)/outerSpan);
      if(a<=0) continue; // leave fully transparent (already zeroed by createImageData)
      d[p]=cr;d[p+1]=cg;d[p+2]=cb;d[p+3]=Math.round(Math.min(1,a)*255);
    }
  }
  tc.putImageData(id,0,0);
  const stamp={canvas:tmp,w,h};
  if(_aaDabCache.size>=_AA_DAB_CACHE_MAX) _aaDabCache.delete(_aaDabCache.keys().next().value); // evict oldest
  _aaDabCache.set(key,stamp);
  return stamp;
}
function _dabAAGpu(x,y,r,rgb,alpha,composite){
  const inner=Math.max(0,Math.min(0.99,brushHardness));
  const rr=Math.max(0.05,r);
  ctx.save();
  ctx.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
  const grad=ctx.createRadialGradient(x,y,0,x,y,rr);
  if(composite==='erase'){
    grad.addColorStop(0,`rgba(0,0,0,${alpha})`);
    grad.addColorStop(inner,`rgba(0,0,0,${alpha})`);
    grad.addColorStop(1,'rgba(0,0,0,0)');
  } else {
    grad.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
    grad.addColorStop(inner,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
    grad.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  }
  ctx.fillStyle=grad;
  ctx.beginPath();ctx.arc(x,y,rr,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
// FIX: the previous CPU path baked each dab into a size-QUANTIZED cached
// bitmap (see _buildAAStamp/_aaDabCache above) and then blitted it at the
// dab's fractional position via ctx.drawImage() with bilinear smoothing.
// That gave a visibly different result from the GPU path:
//   1. The rendered radius snapped to the nearest 0.25px cache bucket
//      instead of the exact, continuously-varying pressure-driven radius
//      the GPU path uses — pressure response looked subtly "stepped".
//   2. Sub-pixel positioning came from the browser's bilinear resample of
//      the cached bitmap — an EXTRA blur pass on top of the already-soft
//      falloff. The GPU path never resamples anything; it draws the exact
//      gradient at the exact (x,y) every time. Net result: CPU strokes
//      looked softer/blurrier than GPU strokes at the same hardness.
// Fix: compute the exact same analytic falloff the GPU radial gradient
// uses (flat core out to `inner`, linear ramp to 0 at the true,
// unquantized radius `r`), sampled at the dab's true fractional center —
// then composite it by hand (standard source-over / destination-out alpha
// math) directly into the canvas's pixel buffer instead of drawing a
// pre-baked bitmap. This is intentionally heavier than the old cached
// version (that's the whole point of choosing the CPU renderer — see the
// brushRenderer comment in core-state.js) but it now matches the GPU
// renderer's stroke quality, pressure response and edge softness exactly;
// only the rasterization backend differs (hand-written per-pixel math vs.
// the browser's hardware gradient/fill).
function _dabAACpu(x,y,r,rgb,alpha,composite){
  const inner=Math.max(0,Math.min(0.99,brushHardness));
  const rr=Math.max(0.05,r);
  const cw=ctx.canvas.width, ch=ctx.canvas.height;
  const pad=1, ir=Math.ceil(rr)+pad;
  const sx=Math.max(0,Math.floor(x-ir)), sy=Math.max(0,Math.floor(y-ir));
  const ex=Math.min(cw,Math.ceil(x+ir)), ey=Math.min(ch,Math.ceil(y+ir));
  const rw=ex-sx, rh=ey-sy;
  if(rw<=0||rh<=0) return;
  const outerSpan=Math.max(0.0001,1-inner);
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  const imgData=ctx.getImageData(sx,sy,rw,rh);
  const d=imgData.data;
  let p=0;
  for(let py=0;py<rh;py++){
    const wy=sy+py+0.5;
    for(let px=0;px<rw;px++,p+=4){
      const wx=sx+px+0.5;
      const dx=wx-x, dy=wy-y;
      const t=Math.sqrt(dx*dx+dy*dy)/rr;
      if(t>=1) continue;
      let a = t<=inner ? alpha : alpha*(1-(t-inner)/outerSpan);
      a=Math.min(1,Math.max(0,a));
      if(a<=0) continue;
      if(composite==='erase'){
        // Matches ctx.globalCompositeOperation='destination-out': scale
        // destination alpha down by (1-a), leave its RGB untouched.
        d[p+3]=d[p+3]*(1-a);
      } else {
        // Matches the default 'source-over' compositing the GPU path uses.
        const da=d[p+3]/255;
        const outA=a+da*(1-a);
        if(outA<=0){ d[p]=0;d[p+1]=0;d[p+2]=0;d[p+3]=0; }
        else{
          d[p]  =(cr*a+d[p]  *da*(1-a))/outA;
          d[p+1]=(cg*a+d[p+1]*da*(1-a))/outA;
          d[p+2]=(cb*a+d[p+2]*da*(1-a))/outA;
          d[p+3]=outA*255;
        }
      }
    }
  }
  ctx.putImageData(imgData,sx,sy);
}
// Renderer preference dispatch — see brushRenderer in core-state.js and the
// Preferences modal (Edit ▸ Preferences).
function _dabAA(x,y,r,rgb,alpha,composite){
  if(brushRenderer==='cpu') _dabAACpu(x,y,r,rgb,alpha,composite);
  else _dabAAGpu(x,y,r,rgb,alpha,composite);
}

// ── Aliased dab: solid circle, quantised edge pixels to full on/off.
// Mirrors TVPaint Pencil and Clip Studio pixel pen behaviour exactly.
//
// PERF FIX: the old version allocated a brand-new <canvas> and called
// getImageData/putImageData on EVERY single dab (every ~12% of brush
// diameter moved, i.e. many times per pointermove). getImageData forces
// a GPU→CPU pixel readback; doing that dozens of times per second is
// what caused the severe lag/latency when antialiasing was OFF.
// Fix: build the quantised stamp ONCE per (size,color,alpha,composite)
// combo and cache it. Every dab after that is just ctx.drawImage of the
// cached bitmap — no readback, no allocation, same pixel-perfect result.
let _stampCache=new Map(); // key -> {canvas,w,h}
const _STAMP_CACHE_MAX=64;
function _getAliasedStamp(rRaw,rgb,alphaRaw,composite){
  const r=_quant(rRaw,_Q_R), alpha=_quant(alphaRaw,_Q_ALPHA);
  const key=r.toFixed(2)+'|'+rgb.join(',')+'|'+alpha.toFixed(2)+'|'+composite;
  const hit=_stampCache.get(key);
  if(hit) return hit;
  const pad=2,ir=Math.ceil(r);
  const w=(ir+pad)*2+1,h=(ir+pad)*2+1;
  const tmp=document.createElement('canvas');tmp.width=w;tmp.height=h;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  tc.fillStyle=composite==='erase'?'black':`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  tc.beginPath();tc.arc(w/2,h/2,r,0,Math.PI*2);tc.fill();
  const id=tc.getImageData(0,0,w,h);
  const d=id.data;
  const fa=Math.round(alpha*255);
  // Snap EVERY channel to full on/off — not just alpha. The arc() fill
  // that produced this bitmap is itself antialiased, so edge pixels come
  // out with partial alpha AND blended RGB (the canvas blends the fill
  // color against the transparent black backing, so a half-covered edge
  // pixel's RGB is pulled toward black/other colors, not the pure brush
  // color). Snapping only alpha left that blended RGB in place, which is
  // why edge pixels showed a stray saturated/black fringe at full
  // opacity once alpha was forced on. Forcing R/G/B too guarantees every
  // "on" pixel is the exact, solid brush color with no fringe.
  const cr=composite==='erase'?0:rgb[0], cg=composite==='erase'?0:rgb[1], cb=composite==='erase'?0:rgb[2];
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]>0){ // covered at all -> fully on, exact solid color
      d[i]=cr;d[i+1]=cg;d[i+2]=cb;d[i+3]=fa;
    } else {
      d[i]=0;d[i+1]=0;d[i+2]=0;d[i+3]=0;
    }
  }
  tc.putImageData(id,0,0);
  const stamp={canvas:tmp,w,h};
  if(_stampCache.size>=_STAMP_CACHE_MAX) _stampCache.delete(_stampCache.keys().next().value); // evict oldest
  _stampCache.set(key,stamp);
  return stamp;
}
function _dabAliased(x,y,r,rgb,alpha,composite){
  const stamp=_getAliasedStamp(r,rgb,alpha,composite);
  // ctx.drawImage() defaults to imageSmoothingEnabled=true, so even a
  // perfectly hard-edged, fully-on/off-alpha stamp gets bilinearly resampled
  // (blurred) on the way into the destination canvas. Turning smoothing OFF
  // (nearest-neighbour sampling) keeps every "on" pixel fully opaque and
  // every "off" pixel fully transparent — no blended fringe — while still
  // letting the stamp be placed at the pointer's true sub-pixel (x,y), so
  // strokes track the pointer smoothly instead of snapping to whole pixels.
  const x0=x-(stamp.w/2),y0=y-(stamp.h/2);
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.globalCompositeOperation=composite==='erase'?'destination-out':'source-over';
  ctx.drawImage(stamp.canvas,x0,y0);
  ctx.restore();
}

// ── Tail taper (the other half of the "flick" feel) ─────────────────────────
// The head taper above can be applied the instant a dab is computed, because
// we already know how far into the stroke we are. The TAIL can't work that
// way — we don't know a stroke is ending until pointerup actually fires, by
// which point the final dabs would already be drawn at full width.
// Fix: hold back the last few dabs in a small queue instead of drawing them
// immediately (draw the OLDEST one once the queue is full, so steady-state
// drawing is only a few dabs behind the pointer — imperceptible). When the
// stroke ends, whatever's still sitting in the queue gets a tail-taper
// factor applied (shrinking toward the very last dab) before being drawn.
// Buffering by DAB COUNT rather than fixed pixels is what makes the tail
// length scale with brush size automatically: dab spacing is ~12% of the
// current diameter, so a bigger brush naturally gets a longer-looking flick
// tail and a smaller brush a shorter one — exactly like the head taper.
const _TAIL_BUFFER = 8;
const _TAIL_MIN = 0.12; // how thin the very last point of a flick gets
let _pendingDabs = [];
function _drawDabNow(d){
  if(brushAA) _dabAA(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
  else _dabAliased(d.x,d.y,d.r,d.rgb,d.alpha,d.composite);
}
function _queueDab(d){
  _pendingDabs.push(d);
  if(_pendingDabs.length>_TAIL_BUFFER) _drawDabNow(_pendingDabs.shift());
}
function _flushStrokeTail(){
  const n=_pendingDabs.length;
  for(let i=0;i<n;i++){
    const d=_pendingDabs[i];
    const t = n>1 ? i/(n-1) : 1;
    const eased = t*t*(3-2*t); // smoothstep, 0 at oldest -> 1 at newest/last
    const tailFactor = 1 - eased*(1-_TAIL_MIN);
    d.r *= tailFactor;
    if(brushAA) d.alpha *= (0.35 + 0.65*tailFactor);
    _drawDabNow(d);
  }
  _pendingDabs.length=0;
}

// ── Input smoothing (TVPaint calls this "Line Smoothing") ──────────────────
// Raw pointer input — especially high-frequency pointerrawupdate samples on
// pen tablets, but mouse jitter too — is never perfectly straight; stamping
// dabs directly along the RAW points (as before) draws every tiny wobble in
// the input, which is what made strokes look wavy/rippled compared to
// TVPaint.
//
// v1 of this used a pure time-constant exponential moving average (EMA):
// smoothX += (rawX - smoothX) * (1 - exp(-dt/tau)). That's the "averages
// distance" feel — the smoothed point is a running average pulled toward
// wherever the pen HAS been, so on a fast flick it trails the real pen tip
// by a gap that grows with speed (a fixed TIME lag becomes a big SPATIAL
// lag once velocity goes up), and only crawls back once the pen slows down.
// It also stuttered on real pen data: pointerrawupdate delivers very
// uneven dt between coalesced samples (sub-millisecond bursts mixed with
// occasional bigger gaps), so `a` swings between "almost 0" and "almost 1"
// event to event — the smoothed point advances in uneven little jump/creep
// steps instead of a steady glide, which reads as stutter even though the
// math is technically working.
//
// v2: same gentle EMA for de-jittering slow, deliberate strokes (that part
// felt fine), but on top of it we clamp how far the smoothed point is
// allowed to trail the raw pen position — a "leash". As soon as the gap
// would exceed the leash, we pull the smoothed point back to leash-distance
// from the pen instead of continuing to let it lag proportionally to speed.
// That's the "brush catches up to the tip" feel: on a flick the tip snaps
// to just-behind-the-pen and stays there (constant small offset) rather
// than trailing further and further back, and it removes the stutter too,
// since the leash turns the uneven jump/creep steps into one consistent
// "keep pace at leash distance" motion during fast movement.
const _SMOOTH_TAU_MS = 26; // higher = smoother but laggier; matches a light-moderate TVPaint smoothing setting
const _SMOOTH_LEASH_PX = 7; // max distance the smoothed point may trail the raw pen position before catching up
let _smoothX=0,_smoothY=0,_smoothInit=false,_lastSmoothT=0;
function _resetSmoothing(x,y,t){_smoothX=x;_smoothY=y;_smoothInit=true;_lastSmoothT=t;}
function _smoothPoint(x,y,t){
  if(!_smoothInit) return _resetSmoothing(x,y,t),{x,y};
  const dt=Math.max(0,t-_lastSmoothT);
  _lastSmoothT=t;
  const a=1-Math.exp(-dt/_SMOOTH_TAU_MS);
  let nx=_smoothX+(x-_smoothX)*a;
  let ny=_smoothY+(y-_smoothY)*a;
  // Catch-up clamp: never let the smoothed point trail the raw pen point by
  // more than the leash distance. On slow/steady input the EMA above never
  // gets anywhere near this far behind, so this is a no-op and you still
  // get the full de-jitter smoothing. On a flick the EMA alone would fall
  // further and further behind (average-of-distance feel); this clamp caps
  // that gap so the brush chases the tip at a fixed offset instead.
  const gx=x-nx, gy=y-ny;
  const gap=Math.hypot(gx,gy);
  if(gap>_SMOOTH_LEASH_PX){
    const pull=(gap-_SMOOTH_LEASH_PX)/gap;
    nx+=gx*pull;
    ny+=gy*pull;
  }
  _smoothX=nx;_smoothY=ny;
  return{x:_smoothX,y:_smoothY};
}

function _stampDab(x,y,e){
  const {r,alpha}=_getEffectiveBrushParams(e);
  const isErase=tool==='eraser';
  const rgb=isErase?[0,0,0]:_hexToRGB(color);
  const composite=isErase?'erase':'paint';
  _queueDab({x,y,r,alpha,rgb,composite});
}

// ── Airbrush continuous spray (Photoshop "Airbrush" toggle / Clip Studio
// Airbrush sub tool feel) ──────────────────────────────────────────────
// Every other brush here only stamps in response to pointer movement
// (_strokeSegment walks dabs along the path you actually drew). A real
// airbrush also keeps depositing paint for as long as the pen is held
// down, even dead still — that's what lets you build density in one spot
// just by holding the pen there, on top of a soft low-flow tip. This timer
// is the one thing that adds that behavior: while drawing && airbrush mode
// is on, it fires extra stamps at the last known position on its own
// clock, independent of whether pointermove ever fires again.
let _airbrushTimer=null;
let _lastPointerEvent=null;
function _airbrushIntervalMs(){
  const rate=(typeof window!=='undefined' && window._tsAirbrushRate!=null) ? window._tsAirbrushRate : 0.55;
  // rate 0..1 -> interval 90ms (gentle, slow build-up) down to 16ms (dense, fast spray)
  return 90 - Math.max(0,Math.min(1,rate))*74;
}
function _startAirbrushSpray(){
  _stopAirbrushSpray();
  _airbrushTimer=setInterval(()=>{
    if(!drawing || !window._brushAirbrush){ _stopAirbrushSpray(); return; }
    _stampDab(lx,ly,_lastPointerEvent);
    _scheduleRecomposite();
  }, _airbrushIntervalMs());
}
function _stopAirbrushSpray(){
  if(_airbrushTimer){ clearInterval(_airbrushTimer); _airbrushTimer=null; }
}
window._stopAirbrushSpray=_stopAirbrushSpray;

// Stamp dabs along a line segment from (ax,ay)→(bx,by). Step = ~12% of the
// CURRENT effective diameter (matches TVPaint's default stepval=12.5%) —
// not the brush's fixed max size. Walking adaptively like this is essential
// for smooth pressure tapers: if spacing were based on max size, a thin
// (low-pressure) stretch of the stroke would have its dabs spaced as if it
// were full-size, leaving each round dab visible as a separate bump/notch
// instead of blending into a continuous taper.
// Pressure is interpolated linearly from startPressure to endPressure along
// the segment — this prevents sudden size jumps at event boundaries when
// the tablet reports large pressure changes between coalesced events.
// ── Stroke-start taper (TVPaint-style natural pen tip) ─────────────────────
// TVPaint's pen eases in from a point at the start of every stroke — this
// happens even with a mouse (constant pressure=1.0 the whole time), so it
// can't be pressure-driven; it has to be driven by distance traveled since
// the stroke began. Without this, a stroke starts at full width/opacity
// immediately, which also makes very thin base sizes (e.g. 1.2px) feel like
// "nothing happened" unless pressed hard, since there's no built-in ramp to
// carry a faint first touch into a visible line.
let _strokeDistSoFar = 0;
function _strokeTaperFactor(baseSize){
  // Scale the ease-in distance with brush size — a fixed pixel distance
  // looked fine at one size but became unnoticeable on a big brush and
  // disproportionately long on a tiny one, which is why the taper seemed to
  // "go away" whenever the size was changed.
  const taperDist = Math.max(10, baseSize*2.2);
  if(_strokeDistSoFar >= taperDist) return 1;
  const t = _strokeDistSoFar / taperDist;
  const eased = t*t*(3-2*t); // smoothstep
  // Starts at 50%, not 0%: a 0% start would make a plain click/dot (zero
  // drag distance) nearly invisible — exactly the problem we're fixing.
  // 50%→100% still reads as a clear taper on a dragged stroke (see TVPaint
  // reference) without ever making the very first touch vanish.
  return 0.5 + 0.5*eased;
}

function _strokeSegment(ax,ay,bx,by,e,startPressure,endPressure){
  const sp = (startPressure !== undefined) ? startPressure : currentPressure;
  const ep = (endPressure   !== undefined) ? endPressure   : currentPressure;
  const dx=bx-ax,dy=by-ay,dist=Math.sqrt(dx*dx+dy*dy);
  if(dist<0.1){currentPressure=ep;_stampDab(bx,by,e);return;}
  let traveled=0;
  while(traveled<dist){
    // Peek at the radius at the current position (no side effects) to size
    // the next step to it — step is always >=0.5px, so this always
    // progresses and terminates.
    const t0=traveled/dist;
    currentPressure = sp + (ep - sp) * t0;
    const {r}=_computeEffectiveParams(e);
    const spacing=(typeof window!=='undefined' && window._tsSpacing!=null) ? window._tsSpacing : 0.12;
    const step=Math.max(0.5, r*2*spacing);
    const prevTraveled=traveled;
    traveled=Math.min(dist, traveled+step);
    _strokeDistSoFar += (traveled-prevTraveled); // feeds the start-of-stroke taper
    const t=traveled/dist;
    currentPressure = sp + (ep - sp) * t;
    _stampDab(ax+dx*t, ay+dy*t, e);
  }
  currentPressure = ep; // restore to segment end pressure
}

// PERF FIX: recompositing flattens every layer/group (full-canvas
// drawImage per layer, plus mask canvases) — that's fine to do once per
// frame, but the old code called it synchronously on EVERY pointermove,
// and pointermove can fire 100+ times/sec on a fast mouse or tablet.
// That full-stack re-flatten on every single input event is the main
// reason this felt laggy compared to TVPaint even WITH antialiasing on.
// Fix: coalesce to at most one recomposite per animation frame.
let _recompRAF=false;
function _scheduleRecomposite(){
  if(_recompRAF) return;
  _recompRAF=true;
  requestAnimationFrame(()=>{_recompRAF=false;recomposite(curLayer,curFrame);});
}

// BUG FIX ("brush turns into an eraser / smears the canvas after
// switching tabs and back"): the old code only cleared the `drawing`
// flag on a 'mouseup'/'mouseleave' fired ON THE CANVAS ITSELF. If you
// switch browser tabs (or alt-tab) while the mouse button is still down,
// that mouseup never reaches the canvas, so `drawing` stays stuck `true`.
// The next time the pointer simply MOVES over the canvas — with no
// button pressed at all — the old mousemove handler still saw
// drawing===true and kept calling _strokeSegment from wherever the
// stroke last left off, painting/erasing a trail that followed the
// cursor with no click. Fixes:
//  1. Use Pointer Events + setPointerCapture so the element reliably
//     gets pointerup/pointercancel no matter where the button is
//     released (this alone fixes most "stuck stroke" cases).
//  2. Belt-and-suspenders: force-end any in-progress stroke the instant
//     the tab is hidden or the window loses focus, so a stray stroke
//     can never survive a tab switch.
//  3. Always verify the primary button is actually still down
//     (e.buttons & 1) on every pointermove before drawing — if it isn't
//     (e.g. the up-event was lost), stop the stroke instead of trusting
//     the old `drawing` flag blindly.
function _endStroke(){
  _stopAirbrushSpray();
  if(drawing){drawing=false;_flushStrokeTail();saveActiveToKey();_scheduleRecomposite();}
  lineStart=null;
  _pendingDabs.length=0;
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){_endStroke();}
  else{
    // Some browsers silently discard a canvas's backing-store pixels
    // while its tab is backgrounded (memory pressure, GPU context loss).
    // If that happened, activeC would come back blank even though the
    // saved key still has the real content — drawing on it now would
    // then overwrite the key with "blank + new stroke" on the next save,
    // destroying everything drawn before the tab switch. Reloading from
    // the saved key on return guarantees activeC always matches the
    // source of truth before any new stroke can touch it.
    loadFrame(curLayer,curFrame);
  }
});
window.addEventListener('blur',_endStroke);

// ── Pressure tracking ──────────────────────────────────────────────────────
// Pressure state: updated per pointer event
let currentPressure = 1.0; // 0–1 from pen digitizer; always 1.0 for mouse
let _lastKnownPressure = 1.0; // last non-zero pressure reading (preserves pressure through coalesced gaps)
let _isDrawingWithPen = false; // true when the active stroke is from a pen/stylus

// Exponential smoothing for pressure — reduces jitter without adding lag.
// Alpha=0.25 is a good balance: smooth enough to avoid spiky dab-size
// changes from noisy digitizers, still snappy enough to feel responsive.
// 0=max smooth, 1=no smooth.
const _PRESSURE_SMOOTH = 0.25;
let _smoothedPressure = 1.0;

// De-jitter: some digitizers occasionally report a single noisy outlier
// sample (a brief spike or dip in pressure) in the middle of an otherwise
// steady stroke. Left unfiltered, that one sample produces a visible
// thick/thin blob right at that point (a real pressure CHANGE happens over
// several samples and isn't affected by this; it's only single-sample
// spikes that get capped). _prevRawPressure tracks the last accepted raw
// reading so each new sample's jump can be limited.
let _prevRawPressure = 1.0;
const _MAX_PRESSURE_JUMP = 0.15; // max change allowed per raw sample
let _strokeFirstSample = true; // true for the very first sample of a stroke (no clamping — should snap immediately)

function _getPressure(e){
  // e.pressure: 0 = pen hovering or just lifted (NOT zero pressure contact)
  //             0.5 = mouse or device with no pressure support
  //             0–1 = real pen with pressure
  let p;
  if(e.pointerType === 'pen'){
    // Only trust a pressure reading > 0 while drawing (0 means hovering/lifted).
    // When pen is down but reports 0 (rare driver quirk), keep the last known value
    // so we don't get a sudden thin spot mid-stroke.
    if(e.pressure > 0){
      _lastKnownPressure = e.pressure;
      p = e.pressure;
    } else {
      // If we're mid-stroke and get a 0, hold the last pressure rather than
      // snapping to 0.5 (which caused random thin spots in strokes).
      p = drawing ? _lastKnownPressure : 0.0;
    }
    if(_strokeFirstSample){
      _prevRawPressure = p; _strokeFirstSample = false;
    } else {
      const delta = p - _prevRawPressure;
      if(delta > _MAX_PRESSURE_JUMP) p = _prevRawPressure + _MAX_PRESSURE_JUMP;
      else if(delta < -_MAX_PRESSURE_JUMP) p = _prevRawPressure - _MAX_PRESSURE_JUMP;
      _prevRawPressure = p;
    }
    return p;
  }
  if(e.pointerType === 'touch'){
    // Touch force is 0..1 on devices that support it (force touch);
    // fall back to full pressure if not supported (force===0 means unsupported).
    return (e.pressure > 0) ? e.pressure : 1.0;
  }
  // mouse / trackpad: always full pressure
  return 1.0;
}

function _getTilt(e){
  // tiltX/tiltY: –90..90 degrees; 0 = perpendicular to surface.
  // Normalise to 0..1 (0 = perfectly vertical, 1 = fully tilted).
  const tx = e.tiltX || 0;
  const ty = e.tiltY || 0;
  return Math.min(1, Math.sqrt(tx*tx + ty*ty) / 90);
}

function _getVelocity(){
  // Velocity is tracked as a running average of dab spacing (pixels/ms).
  // Normalise: 0 at rest → 1 at fast strokes. Capped to avoid runaway.
  return Math.min(1, _strokeVelocity / 20.0); // 20 px/ms = "fast"
}

// Stroke velocity tracking (pixels per ms) for velocity-mapped controls.
let _strokeVelocity = 0;
let _lastMoveTime = 0;
let _lastMoveX = 0, _lastMoveY = 0;
function _updateVelocity(x, y, t){
  if(_lastMoveTime > 0){
    const dt = Math.max(1, t - _lastMoveTime);
    const dx = x - _lastMoveX, dy = y - _lastMoveY;
    const spd = Math.sqrt(dx*dx+dy*dy) / dt;
    _strokeVelocity = _strokeVelocity * 0.7 + spd * 0.3; // EMA smoothing
  }
  _lastMoveTime = t; _lastMoveX = x; _lastMoveY = y;
}

// Fade: stroke age in dabs (incremented each dab, reset per stroke)
let _strokeDabCount = 0;
// Read the size/opacity dynamics controls set in the Tool Settings panel.
// Default size control is 'pressure' (not 'off') so pen pressure works immediately.
function _getSizeControl(){ const el=document.getElementById('ts-size-control'); return el?el.value:'pressure'; }
function _getOpacityControl(){ const el=document.getElementById('ts-opacity-control'); return el?el.value:'pressure'; }
function _getMinSize(){ const el=document.getElementById('ts-min-size'); return el?(+el.value/100):0.05; }
function _getMinFlow(){ const el=document.getElementById('ts-min-flow'); return el?(+el.value/100):0; }

// Pressure curve — the Tool Settings panel draws a Linear/Soft/Hard/S-curve preview
// (see brush-presets.js) using these exact control points, in "plot space" where
// x = input pressure (0..1) and y is canvas-style position: y=0 is the TOP of the
// preview (= max size output) and y=1 is the BOTTOM (= min size output). Both files
// share this same table so the curve you see is exactly the curve that's applied.
//   linear — input maps straight through, no remapping.
//   soft   — reaches near-full size quickly, then flattens (more size early).
//   hard   — stays thin through most of the pressure range, only ramping up to
//            full size near max pressure. THIS is what makes thin/light-pressure
//            strokes reachable on devices whose lightest reported touch is still
//            a fairly high raw pressure value.
//   s      — gentle at both ends, steeper through the middle.
const PRESSURE_CURVES = {
  linear:[[0,1],[1,0]],
  soft:[[0,1],[0.3,0.55],[0.7,0.2],[1,0]],
  hard:[[0,1],[0.3,0.85],[0.7,0.4],[1,0]],
  s:[[0,1],[0.2,0.8],[0.8,0.25],[1,0]]
};
if(typeof window!=='undefined') window.PRESSURE_CURVES = PRESSURE_CURVES;

function _bezierPointAt(pts,t){
  if(pts.length===2){
    return [pts[0][0]+(pts[1][0]-pts[0][0])*t, pts[0][1]+(pts[1][1]-pts[0][1])*t];
  }
  const [p0,p1,p2,p3]=pts, mt=1-t;
  const x = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0];
  const y = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1];
  return [x,y];
}
// Given input pressure x (0..1), find the curve's plot-space y at that x.
// Control-point x-coordinates are monotonic increasing, so a short binary
// search on the bezier parameter t reliably converges (curves are static —
// cheap enough to solve per-call, no need to cache).
function _evalPressureCurveY(curveKey, x){
  const pts = PRESSURE_CURVES[curveKey] || PRESSURE_CURVES.linear;
  if(pts.length===2){
    const t = Math.max(0,Math.min(1, (x-pts[0][0])/((pts[1][0]-pts[0][0])||1)));
    return pts[0][1] + (pts[1][1]-pts[0][1])*t;
  }
  let lo=0, hi=1;
  for(let i=0;i<24;i++){
    const mid=(lo+hi)/2;
    if(_bezierPointAt(pts,mid)[0] < x) lo=mid; else hi=mid;
  }
  return _bezierPointAt(pts,(lo+hi)/2)[1];
}
// Apply the user-selected pressure curve (Tool Settings → Pressure Curve).
// Falls back to true linear (identity) when none is selected, so default
// behaviour for users who never touch this control is unchanged.
function _applyPressureCurve(p){
  const curveKey=(typeof window!=='undefined' && window._tsPressureCurve) || 'linear';
  if(curveKey==='linear') return p;
  const y=_evalPressureCurveY(curveKey, Math.max(0,Math.min(1,p)));
  return Math.max(0, Math.min(1, 1-y));
}

// Resolve the 0-1 influence value for a given dynamics control type.
function _resolveControl(ctrl, e){
  switch(ctrl){
    case 'pressure': {
      // Apply exponential smoothing to reduce digitizer jitter.
      _smoothedPressure = _smoothedPressure*(1-_PRESSURE_SMOOTH) + currentPressure*_PRESSURE_SMOOTH;
      // No artificial floor here — let true light pressure reach true low
      // influence; the final dab radius is still floored to a 1px-diameter
      // minimum further downstream, so the mark never fully disappears.
      return Math.max(0, Math.min(1, _applyPressureCurve(_smoothedPressure)));
    }
    case 'tilt': {
      const t = e ? _getTilt(e) : 0;
      // Tilt: 0 = pen vertical (full size), 1 = pen flat (min size). Invert = more tilt -> smaller.
      return Math.max(0.01, 1 - t);
    }
    case 'velocity': {
      const v = _getVelocity();
      // Fast stroke = smaller/more transparent (matches PS velocity behaviour).
      return Math.max(0.01, 1 - v);
    }
    case 'fade': {
      // Fade: full size at dab 0, reaches minSize by dab ~200.
      const fadeLen = 200;
      return Math.max(0, 1 - Math.min(1, _strokeDabCount / fadeLen));
    }
    default: return 1.0; // 'off' or unknown
  }
}

// Return effective brush radius and alpha for the current dab, factoring in
// pressure / tilt / velocity / fade depending on Tool Settings panel selection.
// Mouse/trackpad always have currentPressure===1.0 and tilt===0, so they are
// unaffected by pressure/tilt. Velocity and fade affect all input types.
// Pure (no side effects) so callers can "peek" at the current radius — e.g.
// to compute dab spacing — without disturbing fade-stroke state. The fade
// counter itself is incremented separately, exactly once per dab actually
// stamped (see _stampDab).
function _computeEffectiveParams(e){
  const baseSize=getBrushSize();
  const baseAlpha=brushOpacity;
  const isPenStroke = _isDrawingWithPen;
  let r=baseSize/2;
  let alpha=baseAlpha;

  const sizeCtrl   = _getSizeControl();
  const opacityCtrl= _getOpacityControl();

  // Size dynamics
  if(sizeCtrl !== 'off'){
    // Pressure/tilt: only auto-apply when drawing with a pen (mouse has no real pressure/tilt).
    // Velocity and fade apply to all devices.
    const applySize = (sizeCtrl === 'pressure' || sizeCtrl === 'tilt') ? isPenStroke : true;
    if(applySize){
      const influence = _resolveControl(sizeCtrl, e);
      const minR = (baseSize/2) * _getMinSize();
      r = minR + (baseSize/2 - minR) * influence;
    }
  }

  // Opacity/flow dynamics
  if(opacityCtrl !== 'off'){
    const applyOpacity = (opacityCtrl === 'pressure' || opacityCtrl === 'tilt') ? isPenStroke : true;
    if(applyOpacity){
      const influence = _resolveControl(opacityCtrl, e);
      const minA = baseAlpha * _getMinFlow();
      alpha = Math.max(0.02, minA + (baseAlpha - minA) * influence);
    }
  }

  // Absolute visibility floor: percentage-based min-size dynamics (above)
  // can shrink r to near-zero for an already-thin base brush (e.g. a 1.2px
  // brush with the default 5% min-size + light pressure could compute
  // r≈0.03px) — at that scale a dab is essentially invisible no matter the
  // rendering mode, forcing users to mash full pressure just to see
  // anything. Floor the PRESSURE-DRIVEN radius at 0.5px (1px diameter) so a
  // thin brush stays visibly paintable across its whole pressure range.
  // The deliberate stroke-start taper below is applied AFTER this floor and
  // is allowed to go thinner than it — that's the intentional tapered point
  // at the very tip of a stroke, not an accidental disappearance.
  r = Math.max(0.5, r);

  // Stroke-start taper: ease r in from the taper factor so every new stroke
  // begins as a tapered point and grows into full size over
  // _STROKE_TAPER_DIST px, exactly like TVPaint's pen — regardless of
  // device or physical pressure.
  const taper = _strokeTaperFactor(baseSize);
  r *= taper;
  // Only ease ALPHA with the taper in AA mode. AA-off (pencil/pixelated)
  // mode is meant to be a flat, solid, hard-edged stamp with no partial
  // alpha anywhere — fading opacity in at the tip would put in-between
  // (non-solid) colors back in, exactly the gradient the pixelated mode is
  // supposed to avoid. In AA-off mode the taper is carried entirely by
  // width (r), same as a real pencil point narrowing rather than fading.
  if(brushAA) alpha *= (0.35 + 0.65*taper); // width carries most of the taper; opacity eases more gently so the tip stays visible rather than vanishing

  return{r:Math.max(0.05,r), alpha:Math.max(0.01,Math.min(1,alpha))};
}
function _getEffectiveBrushParams(e){
  const params=_computeEffectiveParams(e);
  _strokeDabCount++;
  return params;
}
// ─────────────────────────────────────────────────────────────────────────────


activeC.addEventListener('pointerdown',e=>{
  // e.button can be -1 on some tablet drivers for pen primary contact; use e.buttons&1 instead
  if(activeGroupId||panning||(typeof _zoomDrag!=='undefined'&&_zoomDrag)||spaceHeld||tool==='transform') return;
  if(e.pointerType==='pen'?(!(e.buttons&1)):(e.button!==0)) return;
  // Prevent browser from hijacking tablet/stylus events (scroll, pan, zoom)
  e.preventDefault();
  _isDrawingWithPen = (e.pointerType === 'pen');
  _strokeFirstSample = true; // this stroke's first _getPressure() call snaps immediately, no de-jitter clamping
  currentPressure=_getPressure(e);
  _smoothedPressure = currentPressure; // snap smoothing to actual pressure at stroke start (no ramp-in lag)
  _lastKnownPressure = currentPressure;
  _strokeDabCount = 0; // reset fade counter
  _strokeDistSoFar = 0; // reset start-of-stroke taper
  _pendingDabs.length = 0; // discard any unflushed tail from a previous stroke
  _strokeVelocity = 0; // reset velocity
  _lastMoveTime = 0;
  const p=getPos(e);
  _resetSmoothing(p.x,p.y,e.timeStamp||performance.now());
  _updateVelocity(p.x, p.y, e.timeStamp);
  if(tool==='fill'){pushUndo();ensureKey();floodFill(p.x,p.y,color);saveActiveToKey();recomposite(curLayer,curFrame);return;}
  if(tool==='line'){lineStart=p;return;}
  activeC.setPointerCapture(e.pointerId);
  pushUndo();ensureKey();drawing=true;lx=p.x;ly=p.y;
  _lastPointerEvent=e;
  _stampDab(p.x,p.y,e);
  _scheduleRecomposite();
  if(window._brushAirbrush) _startAirbrushSpray();
});
// _handleMoveEvent: shared by pointermove + pointerrawupdate.
// pointerrawupdate fires at the full OS/Windows Ink sampling rate (up to 1000Hz)
// before the browser throttles events to display refresh rate — giving every
// real pressure value the tablet digitizer reports, not just the surviving ones.
function _handleMoveEvent(e){
  if(!drawing||activeGroupId) return;
  if(!(e.buttons&1)){_endStroke();return;}
  e.preventDefault();
  const events=(typeof e.getCoalescedEvents==='function'&&e.getCoalescedEvents().length)?e.getCoalescedEvents():[e];
  for(const ev of events){
    const prevPressure = currentPressure;
    const newPressure = _getPressure(ev);
    const raw=getPos(ev);
    const t=ev.timeStamp || performance.now();
    const p=_smoothPoint(raw.x,raw.y,t);
    _updateVelocity(p.x, p.y, t);
    // Interpolate pressure along the segment so large inter-event pressure
    // deltas don't produce a sudden size jump at the first dab of each segment.
    _strokeSegment(lx,ly,p.x,p.y,ev,prevPressure,newPressure);
    currentPressure = newPressure;
    lx=p.x;ly=p.y;
    _lastPointerEvent=ev;
  }
  _scheduleRecomposite();
}
// pointerrawupdate (Chromium 77+ / Windows Ink API) fires IN ADDITION TO
// pointermove for the same physical pen movement — it does not replace it.
// Wiring both to draw the same stroke caused every segment to be stamped
// twice from two independent coordinate streams sampled at different times,
// producing a visible forked/doubled line. Fix: when pointerrawupdate is
// available, it becomes the SOLE source of truth for pen movement, and the
// regular pointermove listener ignores pen events (mouse/touch still use it
// normally).
const _hasRawUpdate = (typeof window !== 'undefined' && 'onpointerrawupdate' in window);
activeC.addEventListener('pointermove', e=>{
  if(_hasRawUpdate && e.pointerType === 'pen') return; // handled exclusively by pointerrawupdate below
  _handleMoveEvent(e);
});
if(_hasRawUpdate){
  activeC.addEventListener('pointerrawupdate', e=>{
    if(e.pointerType !== 'pen') return;
    _handleMoveEvent(e);
  });
}
function _pointerEndStroke(e){
  _stopAirbrushSpray();
  if(activeGroupId){drawing=false;lineStart=null;_pendingDabs.length=0;return;}
  if(tool==='line'&&lineStart){
    pushUndo();ensureKey();const p=getPos(e);
    // Line tool: stamp dabs along the line (respects hardness/opacity)
    _strokeSegment(lineStart.x,lineStart.y,p.x,p.y,e,currentPressure,currentPressure);
    _flushStrokeTail();
    lineStart=null;saveActiveToKey();recomposite(curLayer,curFrame);return;
  }
  if(drawing){drawing=false;_flushStrokeTail();saveActiveToKey();_scheduleRecomposite();}
}
activeC.addEventListener('pointerup',e=>{
  if(activeC.hasPointerCapture(e.pointerId))activeC.releasePointerCapture(e.pointerId);
  _pointerEndStroke(e);
});
activeC.addEventListener('pointercancel',()=>{_endStroke();});

