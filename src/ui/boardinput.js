// Pointer and gesture handling for the board canvas.
//
// One pointer both pans the camera and picks cells: a press that never travels
// further than TAP_SLOP is reported as a tap, anything further pans. Two
// pointers pinch-zoom and pan around their midpoint. The wheel zooms about the
// cursor. Everything is pointer-events based, so mouse, pen and touch share one
// path, and the canvas keeps `touch-action: none` so the page never scrolls
// under a drag.
const TAP_SLOP = 8;        // px of travel still counted as a tap
const WHEEL_STEP = 1.0015; // zoom factor per pixel of wheel delta

export function attachBoardInput(canvas, renderer, handlers) {
  const pointers = new Map();
  let pinch = null;
  const fire = name => { if (handlers[name]) handlers[name](); };

  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pick = (px, py) => { const cell = renderer.cellAt(px, py); return { cell, edge: cell ? null : renderer.edgeAt(px, py) }; };

  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], zoom: renderer.zoom };
    for (const p of pointers.values()) p.moved = true; // a pinch is never a tap
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return; // right button is rotate/cancel
    const [x, y] = local(e);
    // Capture keeps a drag alive outside the canvas; some synthetic/edge cases
    // reject it, and losing capture is survivable, so never let it abort input.
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x, y, x0: x, y0: y, moved: false, type: e.pointerType });
    if (pointers.size === 2) startPinch();
  });

  canvas.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (!p) { // plain hover (mouse and pen only)
      if (handlers.hover) { const { cell, edge } = pick(x, y); handlers.hover(cell, edge, e); }
      return;
    }
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (!p.moved && Math.hypot(x - p.x0, y - p.y0) > TAP_SLOP) p.moved = true;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      renderer.panBy(mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]);
      const target = pinch.zoom * (dist / pinch.dist);
      renderer.zoomAt(target / renderer.zoom, mid[0], mid[1]);
      pinch.mid = mid;
      fire('camera');
    } else if (pointers.size === 1 && p.moved) {
      renderer.panBy(dx, dy);
      fire('camera');
    }
  });

  function release(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch {}
    if (pointers.size < 2) pinch = null;
    if (e.type === 'pointerup' && !p.moved && pointers.size === 0 && handlers.tap) {
      const [x, y] = local(e);
      const { cell, edge } = pick(x, y);
      handlers.tap(cell, edge, e);
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // Touch pointers "leave" the canvas the moment they lift, which would wipe
  // the aim a two-stage tap placement depends on. Only hovering devices clear.
  canvas.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && pointers.size === 0) fire('leave'); });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (handlers.wheel && handlers.wheel(e)) return; // let the UI claim the wheel (rotate)
    const [x, y] = local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    renderer.zoomAt(Math.pow(WHEEL_STEP, -e.deltaY * unit), x, y);
    fire('camera');
  }, { passive: false });

  return {
    zoomBy(factor) { renderer.zoomAt(factor, renderer.viewW / 2, renderer.viewH / 2); fire('camera'); },
    fit() { renderer.fit(); fire('camera'); },
  };
}
