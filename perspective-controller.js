// ════════════════════════════════════════════════════════════════
// PERSPECTIVE CONTROLLER — pure-geometry vanishing-point / horizon-line
// detection and editing for a 4-corner quad (or, in the future, any set
// of "opposite edge pair" axes).
//
// This module is intentionally self-contained: every function takes and
// returns plain {x,y} points and arrays of them, and never touches
// canvas/DOM/tool state except through the small draw()/hitTest() entry
// points — which accept an already-open 2D context plus already-computed
// geometry. That's deliberate: the goal is for this file to be liftable,
// largely as-is, into a standalone "Perspective Ruler" feature later (a
// persistent on-canvas ruler independent of the Transform tool) without
// having to untangle it from transform-tool.js.
//
// GEOMETRY MODEL
// A perspective "axis" is a pair of nominally-parallel edges (in object
// space) that may converge in screen space. A plain 4-corner quad has two
// such axes — the top/bottom edge pair and the left/right edge pair — so
// at most 2 vanishing points (2-point perspective) can be *derived from a
// quad's own edges*. The axis list is produced by a small data-driven
// helper (_pcAxesFromCorners), not hardcoded into the detection/draw/drag
// math, so a future control cage with more independent edge pairs (e.g. a
// Mesh/Cage transform with additional structure) can report 3 or 4 axes
// and this exact same analyze()/draw()/drag() code will surface 3-point /
// 4-point perspective without changes. "Mathematically valid" 3- or
// 4-point perspective isn't reachable from a single flat quadrilateral's 4
// edges, which only ever define 2 independent directions — so a plain
// quad will only ever report 0, 1, or 2 vanishing points, which is
// correct, not a limitation of this module.
// ════════════════════════════════════════════════════════════════
const PerspectiveController=(()=>{

  const EPS_PARALLEL=1e-3; // cross-product threshold below which two edges are "parallel enough"
  const VP_MAX_DIST=1e6;   // beyond this, treat as parallel (VP effectively at infinity)

  // Intersection of infinite lines (a0,a1) and (b0,b1), or null if parallel
  // (or so close to parallel that the VP would be unusably far away).
  function _lineIntersect(a0,a1,b0,b1){
    const d1x=a1.x-a0.x, d1y=a1.y-a0.y;
    const d2x=b1.x-b0.x, d2y=b1.y-b0.y;
    const denom=d1x*d2y-d1y*d2x;
    if(Math.abs(denom)<EPS_PARALLEL) return null;
    const t=((b0.x-a0.x)*d2y-(b0.y-a0.y)*d2x)/denom;
    const x=a0.x+t*d1x, y=a0.y+t*d1y;
    if(!isFinite(x)||!isFinite(y)) return null;
    if(Math.hypot(x-a0.x,y-a0.y)>VP_MAX_DIST) return null;
    return {x,y};
  }

  // The 2 structural axes of a 4-corner quad (corners = [TL,TR,BR,BL]).
  // Data-driven on purpose: a future caller with more edges (a cage,
  // a mesh) supplies a longer axis list to the same analyze/draw/drag
  // functions below and gets 3-/4-point detection for free.
  function _pcAxesFromCorners(corners){
    const [TL,TR,BR,BL]=corners;
    return [
      {id:'horizontal', nearA:TL,farA:TR, nearB:BL,farB:BR},
      {id:'vertical',   nearA:TL,farA:BL, nearB:TR,farB:BR},
    ];
  }

  // Placeholder-handle distance (world px) for an axis that hasn't
  // converged yet (its two edges are still parallel, or too close to
  // parallel to trust). A brand-new Perspective-mode quad starts as an
  // exact rectangle — both axes parallel — so if analyze() reported no
  // vanishing points at all until the artist had *already* dragged a
  // corner freehand, there'd be nothing on screen to grab: no VP handle
  // ever renders, so no VP handle can ever receive a pointer event. TVPaint
  // (and every other perspective-guide tool) instead always shows a
  // pullable handle per axis, positioned out along that axis's current
  // direction, which the artist drags inward to *create* the convergence.
  const VP_PLACEHOLDER_DIST=900;

  // Analyze a quad: which axes converge, their vanishing points, and a
  // horizon line synchronized to those VPs. type is the number of axes
  // that actually converge (0 = plain rectangle, 1 or 2 for a quad; 3/4
  // become reachable once an axis list with 3-4 entries is passed in).
  function analyze(corners){
    const axes=_pcAxesFromCorners(corners).map(axis=>{
      const vp=_lineIntersect(axis.nearA,axis.farA,axis.nearB,axis.farB);
      return Object.assign({},axis,{vp});
    });
    // Every axis gets a handle: its real VP where the edges already
    // converge, or — while they're still parallel/near-parallel — a
    // placeholder positioned out along the axis's current direction, so
    // there's always something rendered and hit-testable to drag.
    const vanishingPoints=axes.map(a=>{
      if(a.vp) return {axisId:a.id,x:a.vp.x,y:a.vp.y,converged:true};
      const mx=(a.nearA.x+a.nearB.x)/2, my=(a.nearA.y+a.nearB.y)/2;
      let dx=(a.farA.x-a.nearA.x)+(a.farB.x-a.nearB.x);
      let dy=(a.farA.y-a.nearA.y)+(a.farB.y-a.nearB.y);
      const dlen=Math.hypot(dx,dy)||1;
      dx/=dlen;dy/=dlen;
      return {axisId:a.id,x:mx+dx*VP_PLACEHOLDER_DIST,y:my+dy*VP_PLACEHOLDER_DIST,converged:false};
    });
    let horizon=null;
    const converged=vanishingPoints.filter(v=>v.converged);
    if(converged.length===2){
      horizon={p0:{x:converged[0].x,y:converged[0].y},
               p1:{x:converged[1].x,y:converged[1].y}};
    } else if(converged.length===1){
      // Single VP: horizon is the horizontal line running through it.
      const vp=converged[0];
      horizon={p0:{x:vp.x-4000,y:vp.y},p1:{x:vp.x+4000,y:vp.y}};
    }
    return {type:converged.length, axes, vanishingPoints, horizon};
  }

  // Clip the infinite line through p0,p1 (any two distinct points on it —
  // they need not be, and usually aren't, the segment we want to draw) to
  // the [0,w]x[0,h] viewport rectangle. Returns {p0,p1} spanning the full
  // visible extent of the line, or null if the line misses the rect
  // entirely or the two points are coincident. Standard Liang-Barsky,
  // just initialized with an unbounded t range instead of [0,1] so it
  // clips a *line*, not the original p0-p1 *segment*.
  function _clipLineToRect(p0,p1,w,h){
    const dx=p1.x-p0.x, dy=p1.y-p0.y;
    if(Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9) return null;
    let t0=-Infinity,t1=Infinity;
    const clip=(p,q)=>{
      if(Math.abs(p)<1e-12) return q>=0;
      const r=q/p;
      if(p<0){ if(r>t1) return false; if(r>t0) t0=r; }
      else { if(r<t0) return false; if(r<t1) t1=r; }
      return true;
    };
    if(!clip(-dx,p0.x)) return null;
    if(!clip(dx,w-p0.x)) return null;
    if(!clip(-dy,p0.y)) return null;
    if(!clip(dy,h-p0.y)) return null;
    if(t0>t1) return null;
    return {p0:{x:p0.x+t0*dx,y:p0.y+t0*dy}, p1:{x:p0.x+t1*dx,y:p0.y+t1*dy}};
  }

  // ── Quad validity ────────────────────────────────────────────────
  // The projective (Heckbert) mapping used to actually render the warp
  // divides by w=g*u+h*v+1 across the unit square; if the quad is
  // self-intersecting (bowtie) or reflex/concave, that plane can cross
  // zero *inside* the square, sending sampled points toward infinity —
  // which is exactly the "tangled / self-intersecting" instability. A
  // simple, convex quad keeps w single-signed over the whole square, so
  // callers should reject any drag update that produces one of these.
  function _orient(a,b,c){ return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
  function _segsIntersect(p1,p2,p3,p4){
    const d1=_orient(p3,p4,p1), d2=_orient(p3,p4,p2);
    const d3=_orient(p1,p2,p3), d4=_orient(p1,p2,p4);
    return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
  }
  const MIN_QUAD_AREA=4; // px² — below this, corners are effectively coincident/collinear
  function isValidQuad(corners){
    if(!corners||corners.length!==4) return false;
    const [p0,p1,p2,p3]=corners;
    if(corners.some(p=>!isFinite(p.x)||!isFinite(p.y))) return false;
    // Bowtie check: only the two *opposite* edge pairs can legally cross
    // each other in a self-intersecting quad (adjacent edges share a
    // vertex, so a same-endpoint touch isn't a crossing).
    if(_segsIntersect(p0,p1,p2,p3)) return false;
    if(_segsIntersect(p1,p2,p3,p0)) return false;
    // Convexity: every consecutive turn (cross product of successive
    // edges) must have the same sign. A reflex/concave corner is where
    // the homography starts to fold — same failure mode as a bowtie,
    // just less obvious visually until it's dragged further.
    const pts=[p0,p1,p2,p3];
    let sign=0;
    for(let i=0;i<4;i++){
      const a=pts[i], b=pts[(i+1)%4], c=pts[(i+2)%4];
      const cr=_orient(a,b,c);
      if(Math.abs(cr)<1e-6) continue; // near-collinear corner: ambiguous, not itself disqualifying
      const s=cr>0?1:-1;
      if(sign===0) sign=s; else if(s!==sign) return false;
    }
    // Degenerate-area check (corners collapsed onto each other/a line).
    const area=Math.abs((p0.x*(p1.y-p3.y)+p1.x*(p2.y-p0.y)+p2.x*(p3.y-p1.y)+p3.x*(p0.y-p2.y))/2);
    if(area<MIN_QUAD_AREA) return false;
    return true;
  }

  // Draw vanishing points + convergence rays + horizon line on `ctx` (a 2D
  // context in the same coordinate space as the corners analyze() was
  // called with). Purely additive/overlay drawing — draws nothing when
  // there's no detected perspective (type 0), satisfying "hide all guides
  // for a plain rectangle" with no extra caller-side branching needed.
  function draw(ctx,analysis,opts){
    opts=opts||{};
    if(!analysis||!analysis.vanishingPoints||!analysis.vanishingPoints.length) return;
    const scale=opts.scale||1; // keeps line/dot sizes constant on screen under zoom
    ctx.save();
    if(analysis.horizon){
      // The horizon is a property of the whole perspective, not just the
      // segment between two VPs — draw it edge-to-edge across the given
      // viewport (opts.width/opts.height) whenever supplied; fall back to
      // the raw VP-to-VP segment only if no viewport was given to clip
      // against.
      let seg=analysis.horizon;
      if(opts.width&&opts.height){
        seg=_clipLineToRect(analysis.horizon.p0,analysis.horizon.p1,opts.width,opts.height)||seg;
      }
      ctx.strokeStyle=opts.horizonColor||'rgba(77,211,255,0.85)';
      ctx.lineWidth=Math.max(1,1.25/scale);
      ctx.setLineDash([8/scale,5/scale]);
      ctx.beginPath();
      ctx.moveTo(seg.p0.x,seg.p0.y);
      ctx.lineTo(seg.p1.x,seg.p1.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle=opts.rayColor||'rgba(255,255,255,0.35)';
    ctx.lineWidth=Math.max(1,1/scale);
    analysis.axes.forEach(axis=>{
      if(!axis.vp) return;
      ctx.beginPath();
      ctx.moveTo(axis.farA.x,axis.farA.y);ctx.lineTo(axis.vp.x,axis.vp.y);
      ctx.moveTo(axis.farB.x,axis.farB.y);ctx.lineTo(axis.vp.x,axis.vp.y);
      ctx.stroke();
    });
    const r=(opts.vpRadius||6)/scale;
    ctx.strokeStyle='#fff';
    ctx.lineWidth=Math.max(1,1.25/scale);
    // Stable VP1/VP2 numbering: order by axisId (not by array/insertion
    // order, which could vary) so a given axis always shows the same
    // label — horizontal is always VP1, vertical is always VP2 — instead
    // of the labels swapping between the two handles as they move.
    const axisOrder={horizontal:0,vertical:1};
    const sortedForLabel=analysis.vanishingPoints.slice().sort((a,b)=>(axisOrder[a.axisId]??99)-(axisOrder[b.axisId]??99));
    const labelOf=axisId=>{
      const idx=sortedForLabel.findIndex(v=>v.axisId===axisId);
      return 'VP'+(idx>=0?idx+1:'?');
    };
    analysis.vanishingPoints.forEach(vp=>{
      ctx.beginPath();ctx.arc(vp.x,vp.y,r,0,Math.PI*2);
      if(vp.converged){
        ctx.fillStyle=opts.vpColor||'#ff5d5d';
        ctx.fill();
      } else {
        // Not converged yet — a hollow "pull me" handle rather than a
        // solid dot, so it reads as available-but-inactive instead of
        // looking identical to a real vanishing point.
        ctx.fillStyle='rgba(255,93,93,0.15)';
        ctx.fill();
      }
      ctx.stroke();
    });
    if(opts.showVpLabels!==false){
      ctx.font=`${Math.max(10,11/scale)}px sans-serif`;
      ctx.textBaseline='middle';
      analysis.vanishingPoints.forEach(vp=>{
        const label=labelOf(vp.axisId);
        const lx=vp.x+r+4/scale, ly=vp.y;
        // Small dark outline behind the text so the label stays legible
        // over both light and dark parts of the canvas.
        ctx.lineWidth=Math.max(2,3/scale);
        ctx.strokeStyle='rgba(0,0,0,0.65)';
        ctx.strokeText(label,lx,ly);
        ctx.fillStyle=vp.converged?(opts.vpColor||'#ff5d5d'):'#fff';
        ctx.fillText(label,lx,ly);
      });
    }
    ctx.restore();
  }

  // Hit-test helpers — `tol` is caller-supplied (already zoom-adjusted).
  //
  // Picks whichever VP is closest to the pointer, not just the first one
  // within tolerance. `analysis.vanishingPoints` is always in fixed
  // [horizontal, vertical] order, so a first-match loop would silently
  // prefer VP1 over VP2 any time the two handles are within `tol` of each
  // other on screen (e.g. both still at their unconverged placeholder
  // distance) — making VP2 unreachable in exactly that situation even
  // though its own hit circle was legitimately under the pointer. Both
  // VPs need identical treatment here: nearest-wins, independent of
  // array/axis order.
  function hitTestVP(p,analysis,tol){
    if(!analysis) return null;
    let best=null,bestDist=Infinity;
    for(const vp of analysis.vanishingPoints){
      const d=Math.hypot(p.x-vp.x,p.y-vp.y);
      if(d<=tol&&d<bestDist){ bestDist=d; best=vp.axisId; }
    }
    return best;
  }
  function hitTestHorizon(p,analysis,tol){
    if(!analysis||!analysis.horizon) return false;
    const {p0,p1}=analysis.horizon;
    const dx=p1.x-p0.x, dy=p1.y-p0.y;
    const len2=dx*dx+dy*dy;
    if(len2<1e-6) return Math.hypot(p.x-p0.x,p.y-p0.y)<=tol;
    const t=((p.x-p0.x)*dx+(p.y-p0.y)*dy)/len2;
    const cx=p0.x+dx*t, cy=p0.y+dy*t;
    return Math.hypot(p.x-cx,p.y-cy)<=tol;
  }

  // Rotate `pt` around `anchor` so it points exactly at `target`, while
  // preserving its original distance from `anchor`. This is the crux of
  // the anchoring fix: instead of letting a corner slide along a ray
  // toward wherever the vanishing point currently is (which reads as the
  // corner — and the artwork — being "pulled toward" the VP, since its
  // position becomes a function of how close the VP is), the corner is
  // treated as a rigid rod pivoting on the anchor. Only its *angle*
  // responds to the VP; its *length* is whatever it already was. The
  // object's silhouette size stays put; only its perspective skew changes.
  function _pcRotateTo(anchor,target,length){
    const dx=target.x-anchor.x, dy=target.y-anchor.y;
    const len=Math.hypot(dx,dy)||1;
    return {x:anchor.x+dx/len*length, y:anchor.y+dy/len*length};
  }
  function _pcCloneCorners(corners){
    return corners.map(c=>({x:c.x,y:c.y}));
  }
  function _pcPointOnSegment(a,b,t){
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  }
  function _pcDist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
  function _pcLineAtAngle(origin,theta){
    return {p0:origin,p1:{x:origin.x+Math.cos(theta),y:origin.y+Math.sin(theta)}};
  }
  function _pcAngle(a,b){ return Math.atan2(b.y-a.y,b.x-a.x); }
  function _pcAngleDelta(a,b){
    let d=a-b;
    while(d>Math.PI) d-=Math.PI*2;
    while(d<-Math.PI) d+=Math.PI*2;
    return d;
  }

  // Exact, closed-form solve for the swinging side of an axis whose VP is
  // being dragged — replaces a prior weighted-score search (matching side
  // length AND midpoint drift AND angular drift all at once, none of them
  // exactly) that let the object's visual footprint bleed away as a VP
  // moved, especially toward large distances, since "length" was only one
  // of three blended objectives and never actually enforced.
  //
  // Geometry: corner `a` must lie on lineA (the edge from its own anchor
  // corner, lineA.p0, toward the dragged VP) and corner `b` must lie on
  // lineB likewise, with a-b colinear with fixedVP (the OTHER axis's own
  // vanishing point, since edge a-b belongs to that axis too). That's a
  // genuine 1-parameter family of valid (a,b) pairs. Rather than search
  // that family for a compromise, pin it down exactly the same way
  // _pcSolveFromVPs already does for the horizon drag: treat `a` as a
  // rigid rod pivoting on its own anchor (lineA.p0), preserving its exact
  // original length — so the footprint of THAT edge never changes, only
  // its angle — then derive `b` as the one remaining unknown: the
  // intersection of lineB with the line from the now-fixed `a` through
  // fixedVP. Fully determined, no iteration, no blended/competing scores.
  function _pcSolveMovableSide(lineA,lineB,fixedVP,oldA,oldB){
    const anchorA=lineA.p0;
    const rodLen=_pcDist(anchorA,oldA);
    const a=_pcRotateTo(anchorA,lineA.p1,rodLen);
    const b=_lineIntersect(lineB.p0,lineB.p1,a,fixedVP);
    if(!b) return null;
    // Guard against the derived edge folding backward through the anchor
    // side entirely (same "don't self-intersect" guard the old search
    // applied) — bail so the caller's own clone-corners fallback kicks in
    // instead of handing back a degenerate quad.
    const oldSide={x:oldB.x-oldA.x,y:oldB.y-oldA.y};
    const side={x:b.x-a.x,y:b.y-a.y};
    if(side.x*oldSide.x+side.y*oldSide.y<=0) return null;
    return {a,b};
  }

  function dragAxisVP(corners,axisId,targetVP,otherVP){
    if(!corners||corners.length!==4||!targetVP) return corners;
    const [TL,TR,BR,BL]=corners;

    // Which of this axis's two edges stays fixed (the "anchor") and which
    // one swings to follow the dragged VP is decided dynamically from the
    // edges' CURRENT on-screen positions, not a hardcoded TL/TR/BR/BL
    // corner slot. Previously the anchor was always e.g. "whichever
    // corners started out as bottom-left/bottom-right" — which looks
    // right in the default, unrotated layout (ground stays put, ceiling
    // swings toward VP2) purely by coincidence, since that's also the
    // edge farther from VP2 there. But a corner's *slot* (its role from
    // when Perspective mode was entered) doesn't rotate with the artwork,
    // so after the quad is rotated ~180°-ish that same slot can end up on
    // the opposite side of the screen — anchoring the wrong (now-visible)
    // edge and making it look like only "the old side" ever moves.
    // Fix: pin whichever edge is currently farther from this axis's own
    // vanishing point (the "background" edge), and let the nearer edge
    // (the one visibly closer to/pointing at the VP) swing to follow it —
    // reproduces the exact same result as before in the default layout,
    // but re-derives it fresh from live geometry every drag, so it keeps
    // being correct after any rotation.
    // Decided once from the STARTING `corners` (fixed for the whole drag,
    // per the caller's own convention — see call site) rather than the
    // live, moving `targetVP`, so the choice can't flip mid-drag if the
    // pointer happens to cross over the quad.
    const _selfVP=analyze(corners).vanishingPoints.find(v=>v.axisId===axisId);
    const refVP=_selfVP?{x:_selfVP.x,y:_selfVP.y}:targetVP;

    if(axisId==='horizontal'){
      if(!otherVP) return _pcCloneCorners(corners);
      const leftMid=_pcPointOnSegment(TL,BL,0.5), rightMid=_pcPointOnSegment(TR,BR,0.5);
      const pivotLeft=_pcDist(leftMid,refVP)>=_pcDist(rightMid,refVP);
      if(pivotLeft){
        const topLine={p0:TL,p1:targetVP};
        const bottomLine={p0:BL,p1:targetVP};
        const solved=_pcSolveMovableSide(topLine,bottomLine,otherVP,TR,BR);
        if(!solved) return _pcCloneCorners(corners);
        return [{x:TL.x,y:TL.y},solved.a,solved.b,{x:BL.x,y:BL.y}];
      } else {
        const topLine={p0:TR,p1:targetVP};
        const bottomLine={p0:BR,p1:targetVP};
        const solved=_pcSolveMovableSide(topLine,bottomLine,otherVP,TL,BL);
        if(!solved) return _pcCloneCorners(corners);
        return [solved.a,{x:TR.x,y:TR.y},{x:BR.x,y:BR.y},solved.b];
      }
    }

    if(axisId==='vertical'){
      if(!otherVP) return _pcCloneCorners(corners);
      const topMid=_pcPointOnSegment(TL,TR,0.5), bottomMid=_pcPointOnSegment(BL,BR,0.5);
      const pivotBottom=_pcDist(bottomMid,refVP)>=_pcDist(topMid,refVP);
      if(pivotBottom){
        const leftLine={p0:BL,p1:targetVP};
        const rightLine={p0:BR,p1:targetVP};
        const solved=_pcSolveMovableSide(leftLine,rightLine,otherVP,TL,TR);
        if(!solved) return _pcCloneCorners(corners);
        return [solved.a,solved.b,{x:BR.x,y:BR.y},{x:BL.x,y:BL.y}];
      } else {
        const leftLine={p0:TL,p1:targetVP};
        const rightLine={p0:TR,p1:targetVP};
        const solved=_pcSolveMovableSide(leftLine,rightLine,otherVP,BL,BR);
        if(!solved) return _pcCloneCorners(corners);
        return [{x:TL.x,y:TL.y},{x:TR.x,y:TR.y},solved.b,solved.a];
      }
    }

    return _pcCloneCorners(corners);
  }
  // Solve the quad from BOTH axes' VPs as explicit, independent, fixed
  // constraints — used for the horizon-line drag, where both move by the
  // same dy at once. Never reads a VP back off `corners`; both vpH/vpV
  // are supplied by the caller (already shifted). Corners governed by
  // exactly one axis (ah.farA, av.farA) rotate rigidly about the shared
  // anchor, preserving their own edge length; the doubly-governed shared
  // corner (ah.farB === av.farB) is solved as the intersection of the
  // two now-aimed-at-their-VP edges.
  function _pcSolveFromVPs(corners,vpH,vpV){
    const axes=_pcAxesFromCorners(corners);
    const ah=axes.find(a=>a.id==='horizontal'), av=axes.find(a=>a.id==='vertical');
    const anchor=ah.nearA; // shared corner (same object for both axes)
    const newFarAH=_pcRotateTo(anchor,vpH,Math.hypot(ah.farA.x-anchor.x,ah.farA.y-anchor.y));
    const newFarAV=_pcRotateTo(anchor,vpV,Math.hypot(av.farA.x-anchor.x,av.farA.y-anchor.y));
    const newFarB=_lineIntersect(newFarAV,vpH,newFarAH,vpV)||ah.farB;
    return corners.map(c=>{
      if(c===ah.farA) return {x:newFarAH.x,y:newFarAH.y};
      if(c===av.farA) return {x:newFarAV.x,y:newFarAV.y};
      if(c===ah.farB) return {x:newFarB.x,y:newFarB.y};
      return {x:c.x,y:c.y};
    });
  }

  // Shift the whole horizon vertically by `dy` from a caller-held fixed
  // pair of starting VPs (vp1/vp2 — same shape as analyze()'s
  // vanishingPoints entries, {axisId,x,y}), rather than re-reading the
  // starting VPs from `corners` on every call. The caller is expected to
  // capture vp1/vp2 once at drag-start and keep passing that same fixed
  // pair (with dy measured from that same start), for the identical
  // caching-not-re-deriving reason as dragAxisVP above.
  function dragHorizon(corners,vp1,vp2,dy){
    const targetH=(vp1.axisId==='horizontal'?vp1:vp2);
    const targetV=(vp1.axisId==='vertical'?vp1:vp2);
    return _pcSolveFromVPs(corners,{x:targetH.x,y:targetH.y+dy},{x:targetV.x,y:targetV.y+dy});
  }

  return {analyze,draw,hitTestVP,hitTestHorizon,dragAxisVP,dragHorizon,isValidQuad};
})();