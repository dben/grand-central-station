// Canvas 2D renderer for the board. Pure drawing: takes a view object and
// paints it. Hit-testing helpers convert pixels to cells/edges.
import { tileDef } from '../data/tiles.js';
import { CONFIG } from '../config.js';
import { EDGES } from '../sim/board.js';
import { shapeTransform, shapeBaseSize } from '../sim/shapes.js';
import { loadSprites, sprite } from './sprites.js';

const TERRAIN_COLORS = { green: '#3b5a35', road: '#4a4a52', rail: '#5a4a7a', water: '#2a6f9a', apron: '#6b7280' };
const TRANSPORT_COLORS = { road: '#4c6fc2', rail: '#7a63c9', water: '#2e8fb8', corridor: '#3fa08f', free: '#b57bc4', apron: '#7f8fb5' };
const UTILITY_COLORS = { wifi: '#6c8ea8', walkway: '#5c5c66', waiting: '#a9a463', gate: '#b74a4a' };
const AMENITY_TIER_COLORS = ['#8c7a55', '#c48f4a', '#b8783c', '#a86fa0', '#c05f7a', '#c14f6a'];

export function colorForDef(d) {
  if (d.kind === 'bridge') return '#a07850';
  if (d.kind === 'transport') return TRANSPORT_COLORS[d.terrain] || '#888';
  if (d.special && UTILITY_COLORS[d.special]) return UTILITY_COLORS[d.special];
  if (d.special === 'anytier') return '#5aa0a8';
  return AMENITY_TIER_COLORS[d.tier] || '#999';
}

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cs = 32; this.ox = 0; this.oy = 0; this.margin = 18;
    this.w = 12; this.h = 12;
    this.time = 0;
    loadSprites();
  }

  resize(board) {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.max(200, Math.floor(Math.min(rect.width, rect.height) - 16));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = size + 'px'; this.canvas.style.height = size + 'px';
    this.canvas.width = Math.round(size * dpr); this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
    this.w = board.w; this.h = board.h;
    const m = Math.max(14, Math.floor(size * 0.045));
    this.margin = m;
    this.cs = Math.floor((size - 2 * m) / Math.max(board.w, board.h));
    this.ox = Math.floor((size - this.cs * board.w) / 2);
    this.oy = Math.floor((size - this.cs * board.h) / 2);
  }

  cellAt(px, py) {
    const x = Math.floor((px - this.ox) / this.cs), y = Math.floor((py - this.oy) / this.cs);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return { x, y };
  }
  edgeAt(px, py) {
    const inX = px >= this.ox && px < this.ox + this.cs * this.w;
    const inY = py >= this.oy && py < this.oy + this.cs * this.h;
    if (py < this.oy && py >= this.oy - this.margin && inX) return 'N';
    if (py >= this.oy + this.cs * this.h && py < this.oy + this.cs * this.h + this.margin && inX) return 'S';
    if (px < this.ox && px >= this.ox - this.margin && inY) return 'W';
    if (px >= this.ox + this.cs * this.w && px < this.ox + this.cs * this.w + this.margin && inY) return 'E';
    return null;
  }

  px(x) { return this.ox + x * this.cs; }
  py(y) { return this.oy + y * this.cs; }

  edgeRect(e) {
    const m = this.margin, W = this.cs * this.w, H = this.cs * this.h;
    if (e === 'N') return [this.ox, this.oy - m, W, m];
    if (e === 'S') return [this.ox, this.oy + H, W, m];
    if (e === 'W') return [this.ox - m, this.oy, m, H];
    return [this.ox + W, this.oy, m, H];
  }

  draw(view) {
    const { board } = view;
    const ctx = this.ctx, cs = this.cs;
    this.time = performance.now() / 1000;
    ctx.clearRect(0, 0, this.size, this.size);

    // edges
    for (const e of EDGES) {
      const [x, y, w, h] = this.edgeRect(e);
      const terrain = board.edges[e];
      ctx.fillStyle = TERRAIN_COLORS[terrain] || '#333';
      ctx.fillRect(x, y, w, h);
      this.edgeTexture(e, terrain, x, y, w, h);
      // open spans (bridges)
      for (const idx of board.openSpans[e]) {
        ctx.fillStyle = 'rgba(200,160,100,0.85)';
        if (e === 'N' || e === 'S') ctx.fillRect(this.px(idx) + 2, y + 2, cs - 4, h - 4); else ctx.fillRect(x + 2, this.py(idx) + 2, w - 4, cs - 4);
      }
      if (view.highlightEdges && view.highlightEdges.includes(e)) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        ctx.strokeStyle = `rgba(240,178,79,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      }
      if (view.edgeHover === e) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); }
    }

    // grid floor
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#35523a' : '#3a5a3e';
      ctx.fillRect(this.px(x), this.py(y), cs, cs);
    }
    // driveways and lanes
    for (const [x, y] of board.driveways) { ctx.fillStyle = '#4a4a52'; ctx.fillRect(this.px(x), this.py(y), cs, cs); ctx.fillStyle = '#5c5c66'; ctx.fillRect(this.px(x) + cs * 0.45, this.py(y) + cs * 0.45, cs * 0.1, cs * 0.1); }
    for (const [x, y] of board.lanes) { this.hatch(this.px(x), this.py(y), cs, cs, '#3fa08f'); }

    // heatmap
    if (view.heat && view.result) {
      const heat = view.result.heat; let max = 1;
      for (let i = 0; i < heat.length; i++) max = Math.max(max, heat[i]);
      for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
        const v = heat[y * board.w + x] / max; if (v <= 0) continue;
        ctx.fillStyle = `rgba(255,${Math.round(200 - 160 * v)},40,${0.15 + 0.7 * Math.sqrt(v)})`;
        ctx.fillRect(this.px(x), this.py(y), cs, cs);
      }
    }

    // tiles
    const occAt = view.result && view.T != null ? Math.min(view.result.ticks, Math.max(0, Math.ceil(view.T))) : null;
    for (const t of board.tiles) this.drawTile(t, view, occAt);

    // radius rings for hovered/selected amenity
    const ringTile = view.radiusTile;
    if (ringTile) this.drawRadius(ringTile, board, 'rgba(240,178,79,0.18)');
    if (view.ghost && view.ghost.def && view.ghost.def.kind === 'amenity' && view.ghost.def.radius > 0) {
      this.drawRadiusCells(view.ghost.cells, view.ghost.def.radius, 'rgba(79,163,224,0.16)');
      // highlight overlapping amenities
      for (const t of board.tiles) {
        if (t.kind !== 'amenity') continue;
        const d = tileDef(t.key); const r = d.radius + (t.radiusBonus || 0);
        if (r <= 0) continue;
        if (cellsWithin(view.ghost.cells, t.cells, Math.max(r, view.ghost.def.radius))) this.outlineCells(t.cells, 'rgba(79,163,224,0.9)', 2);
      }
    }

    // ghost placement
    if (view.ghost) {
      const g = view.ghost;
      for (const [x, y] of g.cells) {
        if (x < 0 || y < 0 || x >= board.w || y >= board.h) continue;
        ctx.fillStyle = g.ok ? 'rgba(108,196,108,0.45)' : 'rgba(240,90,126,0.45)';
        ctx.fillRect(this.px(x) + 1, this.py(y) + 1, cs - 2, cs - 2);
      }
      for (const [x, y] of g.lane || []) this.hatch(this.px(x), this.py(y), cs, cs, 'rgba(63,160,143,0.8)');
      for (const [x, y] of g.driveway || []) { ctx.fillStyle = 'rgba(120,120,130,0.5)'; ctx.fillRect(this.px(x) + 3, this.py(y) + 3, cs - 6, cs - 6); }
    }

    // selection outline
    if (view.selectedTile) this.outlineCells(view.selectedTile.cells, '#f0b24f', 3);
    if (view.hoverTile && view.hoverTile !== view.selectedTile) this.outlineCells(view.hoverTile.cells, 'rgba(255,255,255,0.7)', 2);
    if (view.targetMode) {
      for (const t of board.tiles) if (view.targetMode(t)) this.outlineCells(t.cells, 'rgba(79,163,224,0.9)', 2);
    }

    // agents
    if (view.result && view.T != null) this.drawAgents(view.result, view.T);
  }

  edgeTexture(e, terrain, x, y, w, h) {
    const ctx = this.ctx;
    const horiz = e === 'N' || e === 'S';
    if (terrain === 'rail') {
      ctx.strokeStyle = '#c8c0d8'; ctx.lineWidth = 1.5;
      if (horiz) { ctx.beginPath(); ctx.moveTo(x, y + h * 0.35); ctx.lineTo(x + w, y + h * 0.35); ctx.moveTo(x, y + h * 0.65); ctx.lineTo(x + w, y + h * 0.65); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(x + w * 0.35, y); ctx.lineTo(x + w * 0.35, y + h); ctx.moveTo(x + w * 0.65, y); ctx.lineTo(x + w * 0.65, y + h); ctx.stroke(); }
    } else if (terrain === 'road') {
      ctx.strokeStyle = '#d8c860'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.beginPath();
      if (horiz) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); } else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); }
      ctx.stroke(); ctx.setLineDash([]);
    } else if (terrain === 'water') {
      ctx.strokeStyle = 'rgba(180,220,255,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath();
      const n = horiz ? w / 12 : h / 12;
      for (let i = 0; i < n; i++) {
        if (horiz) { ctx.moveTo(x + i * 12, y + h * 0.5); ctx.quadraticCurveTo(x + i * 12 + 6, y + h * 0.2, x + i * 12 + 12, y + h * 0.5); }
        else { ctx.moveTo(x + w * 0.5, y + i * 12); ctx.quadraticCurveTo(x + w * 0.2, y + i * 12 + 6, x + w * 0.5, y + i * 12 + 12); }
      }
      ctx.stroke();
    } else if (terrain === 'apron') {
      ctx.strokeStyle = '#e8e0a0'; ctx.lineWidth = 2; ctx.setLineDash([3, 10]); ctx.beginPath();
      if (horiz) { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); } else { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); }
      ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(120,180,90,0.25)';
      for (let i = 0; i < (horiz ? w : h); i += 9) { if (horiz) ctx.fillRect(x + i, y + h * 0.3, 3, h * 0.4); else ctx.fillRect(x + w * 0.3, y + i, w * 0.4, 3); }
    }
  }

  hatch(x, y, w, h, color) {
    const ctx = this.ctx;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    for (let i = -h; i < w; i += 6) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
    ctx.restore();
  }

  tileColor(t) { return colorForDef(tileDef(t.key)); }

  drawTile(t, view, occAt) {
    const ctx = this.ctx, cs = this.cs;
    const d = tileDef(t.key);
    let color = this.tileColor(t);
    let full = false, occ = 0, cap = 0;
    if (occAt != null && view.result && view.result.tileStats[t.id]) {
      const st = view.result.tileStats[t.id];
      cap = st.cap; occ = st.occ[occAt] || 0;
      if (cap > 0 && occ >= cap) full = true;
    }
    const closed = view.closedTiles && view.closedTiles.has(t.id);
    const img = sprite(t.key);
    const bx0 = Math.min(...t.cells.map(c => c[0])), by0 = Math.min(...t.cells.map(c => c[1]));
    const bw0 = Math.max(...t.cells.map(c => c[0])) - bx0 + 1, bh0 = Math.max(...t.cells.map(c => c[1])) - by0 + 1;
    if (img) {
      // sprite: clip to the tile's cells, then rotate/mirror the base-orientation image
      let tipAt = null;
      if (d.attach === 'tip') {
        // the single cell touching the edge, relative to the bounding box
        const edgeCell = t.cells.find(([x, y]) => y === 0 || y === this.h - 1 || x === 0 || x === this.w - 1);
        if (edgeCell) tipAt = [edgeCell[0] - bx0, edgeCell[1] - by0];
      }
      const tf = shapeTransform(d.shape, t.rot, tipAt), base = shapeBaseSize(d.shape);
      ctx.save();
      ctx.beginPath(); for (const [x, y] of t.cells) ctx.rect(this.px(x), this.py(y), cs, cs); ctx.clip();
      ctx.translate(this.px(bx0) + bw0 * cs / 2, this.py(by0) + bh0 * cs / 2);
      ctx.rotate(tf.rot * Math.PI / 2);
      if (tf.mirror) ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -base.w * cs / 2, -base.h * cs / 2, base.w * cs, base.h * cs);
      ctx.restore();
      if (full || closed) { ctx.fillStyle = 'rgba(70,74,84,0.7)'; for (const [x, y] of t.cells) ctx.fillRect(this.px(x), this.py(y), cs, cs); }
    }
    for (const [x, y] of t.cells) {
      if (!img) { ctx.fillStyle = full || closed ? '#555a66' : color; ctx.fillRect(this.px(x), this.py(y), cs, cs); }
      if (d.special === 'walkway' && !img) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(this.px(x) + 4 + i * (cs - 8) / 3, this.py(y) + cs * 0.3); ctx.lineTo(this.px(x) + 4 + (i + 0.5) * (cs - 8) / 3, this.py(y) + cs * 0.5); ctx.lineTo(this.px(x) + 4 + i * (cs - 8) / 3, this.py(y) + cs * 0.7); ctx.stroke(); } }
      if (d.special === 'gate' && !img) {
        const isPass = t.cells.indexOf(t.cells.find(c => c[0] === x && c[1] === y)) === 1;
        if (isPass) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(this.px(x) + cs * 0.3, this.py(y) + cs * 0.15, cs * 0.4, cs * 0.7); }
      }
    }
    this.outlineCells(t.cells, 'rgba(0,0,0,0.55)', 1.5);
    // label: anchored on the cell nearest the centroid so L/S shapes label their own cells
    const bx = Math.min(...t.cells.map(c => c[0])), by = Math.min(...t.cells.map(c => c[1]));
    const bw = Math.max(...t.cells.map(c => c[0])) - bx + 1, bh = Math.max(...t.cells.map(c => c[1])) - by + 1;
    const mx = t.cells.reduce((a, c) => a + c[0], 0) / t.cells.length, my = t.cells.reduce((a, c) => a + c[1], 0) / t.cells.length;
    const anchor = t.cells.slice().sort((a, b) => (Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my)))[0];
    // horizontal run of own cells through the anchor row
    const rowCells = t.cells.filter(c => c[1] === anchor[1]);
    let runL = anchor[0], runR = anchor[0];
    while (rowCells.some(c => c[0] === runL - 1)) runL--;
    while (rowCells.some(c => c[0] === runR + 1)) runR++;
    const colCells = t.cells.filter(c => c[0] === anchor[0]);
    let runT = anchor[1], runB = anchor[1];
    while (colCells.some(c => c[1] === runT - 1)) runT--;
    while (colCells.some(c => c[1] === runB + 1)) runB++;
    const runW = runR - runL + 1, runH = runB - runT + 1;
    const vertical = runH > runW && runH >= 3;
    const cx = vertical ? this.px(anchor[0]) + cs / 2 : this.px(runL) + runW * cs / 2;
    const cy = vertical ? this.py(runT) + runH * cs / 2 : this.py(anchor[1]) + cs / 2;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.max(8, Math.min(13, cs * 0.34));
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const maxW = (vertical ? runH : runW) * cs - 6;
    const maxLines = vertical ? 1 : Math.max(1, Math.min(2, runH));
    const words = t.name.split(' ');
    let lines = [];
    if (ctx.measureText(t.name).width <= maxW) lines = [t.name];
    else if (maxLines >= 2 && words.every(w => ctx.measureText(w).width <= maxW)) {
      let cur = '';
      for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width <= maxW) cur = test; else { lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      if (lines.length > maxLines) lines = [words.map(w => w[0]).join('')];
    } else lines = [words.map(w => w[0]).join('')];
    const lh = fs + 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (vertical) ctx.rotate(-Math.PI / 2);
    if (img) {
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 8, th = lines.length * lh + 2;
      ctx.fillStyle = 'rgba(10,12,18,0.72)';
      ctx.beginPath(); ctx.roundRect(-tw / 2, -th / 2, tw, th, 4); ctx.fill();
      ctx.fillStyle = '#fff';
    }
    lines.forEach((ln, i) => ctx.fillText(ln, 0, -(lines.length - 1) * lh / 2 + i * lh));
    ctx.restore();
    // tier + level pips
    ctx.font = `700 ${Math.max(7, cs * 0.26)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    if (d.tier > 0) { ctx.fillStyle = CONFIG.tiers[d.tier - 1].color; ctx.fillText(CONFIG.tiers[d.tier - 1].symbol, this.px(bx) + 3, this.py(by) + 2); }
    if (t.level > 1) { ctx.fillStyle = '#ffe28a'; ctx.textAlign = 'right'; ctx.fillText('L' + t.level, this.px(bx) + bw * cs - 3, this.py(by) + 2); }
    if (occAt != null && cap > 0) {
      ctx.fillStyle = full ? '#ffb0b0' : 'rgba(255,255,255,0.85)'; ctx.font = `${Math.max(7, cs * 0.24)}px system-ui, sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${occ}/${cap}`, this.px(bx) + bw * cs - 3, this.py(by) + bh * cs - 2);
    }
  }

  outlineCells(cells, color, lw) {
    const ctx = this.ctx, cs = this.cs;
    const set = new Set(cells.map(([x, y]) => x + ',' + y));
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    for (const [x, y] of cells) {
      const X = this.px(x), Y = this.py(y);
      if (!set.has(x + ',' + (y - 1))) { ctx.moveTo(X, Y); ctx.lineTo(X + cs, Y); }
      if (!set.has(x + ',' + (y + 1))) { ctx.moveTo(X, Y + cs); ctx.lineTo(X + cs, Y + cs); }
      if (!set.has((x - 1) + ',' + y)) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cs); }
      if (!set.has((x + 1) + ',' + y)) { ctx.moveTo(X + cs, Y); ctx.lineTo(X + cs, Y + cs); }
    }
    ctx.stroke();
  }

  drawRadius(t, board, color) {
    const d = tileDef(t.key);
    const r = d.radius + (t.radiusBonus || 0);
    if (r <= 0) return;
    this.drawRadiusCells(t.cells, r, color);
  }
  drawRadiusCells(cells, r, color) {
    const ctx = this.ctx, cs = this.cs;
    ctx.fillStyle = color;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let d = 99;
      for (const [cx, cy] of cells) d = Math.min(d, Math.max(Math.abs(cx - x), Math.abs(cy - y)));
      if (d >= 1 && d <= r) ctx.fillRect(this.px(x), this.py(y), cs, cs);
    }
  }

  drawAgents(result, T) {
    const ctx = this.ctx, cs = this.cs;
    const r = Math.max(3, cs * 0.18);
    const popups = [];
    for (const a of result.agents) {
      const start = a.spawnTick - 1;
      if (T < start || T > a.endTick + 0.001) continue;
      const k = T - start;
      const i = Math.floor(k), f = k - i;
      const last = a.frames.length - 1;
      const p0 = a.frames[Math.min(i, last)], p1 = a.frames[Math.min(i + 1, last)];
      const x = this.px(p0[0] + (p1[0] - p0[0]) * f) + cs / 2, y = this.py(p0[1] + (p1[1] - p0[1]) * f) + cs / 2;
      // slight jitter per agent so stacks are visible
      const jx = ((a.id * 7919) % 11 - 5) * cs * 0.03, jy = ((a.id * 104729) % 11 - 5) * cs * 0.03;
      ctx.beginPath(); ctx.arc(x + jx, y + jy, r, 0, Math.PI * 2);
      ctx.fillStyle = a.kind === 'pickpocket' ? '#222' : CONFIG.tiers[a.tier - 1].color;
      ctx.fill(); ctx.strokeStyle = a.kind === 'pickpocket' ? '#f05a7e' : 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      for (const ev of a.events) {
        const age = T - (ev.t - 1);
        if (age < 0 || age > 1.2) continue;
        let txt = null, col = '#fff';
        if (ev.type === 'serve') { txt = `×${ev.mult.toFixed(2)}${ev.flat ? '+' + Math.round(ev.flat) : ''}`; col = '#ffe28a'; }
        else if (ev.type === 'board') { txt = `+${Math.round(ev.value).toLocaleString()}`; col = '#6cc46c'; }
        else if (ev.type === 'strand') { txt = `stranded ${Math.round(ev.value)}`; col = '#f05a7e'; }
        else if (ev.type === 'robbed') { txt = `−${Math.round(ev.loss)}`; col = '#f05a7e'; }
        else if (ev.type === 'stack') { txt = `+stack ${ev.stacks}`; col = '#c8c48a'; }
        else if (ev.type === 'removed') { txt = 'caught!'; col = '#f0b24f'; }
        if (txt) popups.push({ x: x + jx, y: y + jy - r - 4 - age * cs * 0.5, txt, col, alpha: 1 - age / 1.2 });
      }
    }
    ctx.font = `600 ${Math.max(9, cs * 0.3)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const p of popups) { ctx.globalAlpha = p.alpha; ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(p.txt, p.x + 1, p.y + 1); ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, p.y); }
    ctx.globalAlpha = 1;
  }
}

function cellsWithin(a, b, r) {
  for (const [ax, ay] of a) for (const [bx, by] of b) if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= r) return true;
  return false;
}
