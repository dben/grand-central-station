// Isometric canvas renderer for the board. Pure drawing: takes a view object
// and paints it. The board lives in grid space (x right, y down); everything
// is projected to screen through a 2:1 isometric camera that the UI can pan
// and zoom. Hit-testing un-projects back to grid space, so cell/edge picking
// stays exact at any zoom level.
import { tileDef } from '../data/tiles.js';
import { CONFIG } from '../config.js';
import { EDGES, fenceSegments, checkpointLine } from '../sim/board.js';
import { shapeTransform, shapeBaseSize } from '../sim/shapes.js';
import { loadSprites, sprite, spriteFloor } from './sprites.js';

// 90s arcade palette: saturated and high-contrast, so tiles pop off the grass.
const TERRAIN_COLORS = { green: '#4aa244', road: '#555a6e', rail: '#6b55b0', water: '#1ea0ea', apron: '#8d96ad' };
const TRANSPORT_COLORS = { road: '#2f6bff', rail: '#9b5cff', water: '#00c2d4', corridor: '#1fcfb0', free: '#e05cff', apron: '#6f8cff', underground: '#f28c28' };
// The underground layer, by what the tunnel is for: a subway line, a garage
// ramp to the road, a submarine pen's channel to the sea.
const TUNNEL_COLORS = { through: '#ffb020', road: '#b9bfd6', water: '#3fd8ff' };
const UTILITY_COLORS = { wifi: '#7fb8d9', walkway: '#8a8aa3', waiting: '#d9d24a', gate: '#d8433a', security: '#ff7ab8' };
const AMENITY_TIER_COLORS = ['#d1a868', '#ffa53a', '#ff7a24', '#ff5fc0', '#ff3f6e', '#e8203f'];
// The land around the board, and the board's own checkerboard.
const WORLD_LAND = '#3f9b3f';
const BOARD_CELLS = ['#8d929c', '#848993'];   // concourse floor, a grey checker against the grass
// Edge terrains that carry on past the board's corners into the distance.
const RUNS = new Set(['road', 'rail']);
// The airfield beyond an apron strip: two squares of runway, so a locked
// airfield edge reads three deep. Dark tarmac, a painted kerb, white markings.
// It stops at the board's corners, the way a real runway ends in a threshold,
// rather than carrying on to the horizon across whatever the next side is.
const RUNWAY = { depth: 2, fill: '#3b404d', border: '#79839a', paint: 'rgba(255,255,255,0.85)' };

// Camera limits. `k` is the screen width of one cell's diamond in CSS pixels.
const ZOOM_MIN = 0.55, ZOOM_MAX = 7, K_MIN = 9, K_MAX = 190;
// Screen pixels per unit of tile height, as a fraction of k.
const H_UNIT = 0.62;
// Edge strips, in grid units, laid outside the board.
const EDGE_MARGIN = 0.85;
// Outer radius of the bend a railway turns through where it meets the shore.
// Two strip widths, so the turn sweeps a 2x2 square instead of pivoting on a
// point: a quarter turn inside one strip width reads as a notch, not as track.
const TURN_R = 2 * EDGE_MARGIN;
// Room left under the board when framing it, in units of tile height.
const FIT_ROOM = 0.30;
// Height of a checkpoint fence panel, in grid units.
const FENCE_H = 0.30;
// Isometric angle of the grid's +x axis on screen (atan(hh/hw) = atan(1/2)).
const AXIS_ANGLE = Math.atan2(1, 2);

export function colorForDef(d) {
  if (d.kind === 'bridge') return '#c8904f';
  if (d.kind === 'transport') return TRANSPORT_COLORS[d.terrain] || '#888';
  if (d.special && UTILITY_COLORS[d.special]) return UTILITY_COLORS[d.special];
  if (d.special === 'anytier') return '#e6e0ff';
  return AMENITY_TIER_COLORS[d.tier] || '#999';
}

// How tall a tile stands, in grid units. Flat infrastructure hugs the ground;
// amenities grow with tier so a built-up board reads as a skyline.
function tileHeight(d) {
  if (d.kind === 'bridge') return 0.16;
  // Parks, waiting areas, hotspots, car parks and moving walkways
  // (`ground: true`) are paving, not buildings: no height at all, so the crowd
  // walks across the top of them rather than round a lip. drawTileFloor paints
  // them under the travellers.
  if (d.ground) return 0;
  // The rest of the walk-through tiles stand barely proud of the ground, so
  // travellers on them stay visible above the lip instead of vanishing inside.
  if (d.walkable) return 0.10;
  if (d.kind === 'transport') return 0.20;
  if (d.rate === 0) return 0.30;
  return 0.26 + 0.10 * Math.max(1, d.tier || 1);
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 12; this.h = 12;
    this.viewW = 600; this.viewH = 600;
    this.baseK = 32; this.zoom = 1; this.k = 32;
    this.panX = 0; this.panY = 0;
    this.userAdjusted = false;
    this.boardKey = '';
    this.time = 0;
    this.inset = { top: 0, bottom: 0 };
    loadSprites();
  }

  // ------------------------------------------------------------- camera
  get hw() { return this.k / 2; }
  get hh() { return this.k / 4; }
  get hz() { return this.k * H_UNIT; }
  // Half the on-screen extent of the board plus its edge strips.
  get spanG() { return this.w + this.h + 2 * EDGE_MARGIN; }

  project(gx, gy) {
    const cx = this.viewW / 2 + this.panX, cy = this.viewH / 2 + this.panY;
    const dx = gx - this.w / 2, dy = gy - this.h / 2;
    return [cx + (dx - dy) * this.hw, cy + (dx + dy) * this.hh];
  }
  unproject(sx, sy) {
    const cx = this.viewW / 2 + this.panX, cy = this.viewH / 2 + this.panY;
    const u = (sx - cx) / this.hw, v = (sy - cy) / this.hh;
    return [this.w / 2 + (u + v) / 2, this.h / 2 + (v - u) / 2];
  }

  setZoom(z) {
    const lo = Math.max(ZOOM_MIN, K_MIN / this.baseK), hi = Math.min(ZOOM_MAX, K_MAX / this.baseK);
    this.zoom = clamp(z, lo, Math.max(lo, hi));
    this.k = this.baseK * this.zoom;
  }
  // Zoom by `factor` keeping the grid point under (sx, sy) pinned to the cursor.
  zoomAt(factor, sx, sy) {
    const [gx, gy] = this.unproject(sx, sy);
    this.setZoom(this.zoom * factor);
    const [nx, ny] = this.project(gx, gy);
    this.panX += sx - nx; this.panY += sy - ny;
    this.userAdjusted = true;
    this.clampPan();
  }
  panBy(dx, dy) { this.panX += dx; this.panY += dy; this.userAdjusted = true; this.clampPan(); }
  clampPan() {
    const halfW = this.spanG * this.hw / 2, halfH = this.spanG * this.hh / 2 + this.hz;
    const maxX = halfW + this.viewW * 0.15, maxY = halfH + this.viewH * 0.15;
    this.panX = clamp(this.panX, -maxX, maxX);
    // an overlay covering the top or bottom of the view buys extra travel that
    // way, so anything it hides can always be dragged out from under it
    this.panY = clamp(this.panY, -maxY - this.inset.bottom, maxY + this.inset.top);
  }
  // Screen pixels the page's overlays cover along the top and bottom (the
  // floating shop). Fit frames the board in the band between them.
  setInsets({ top = 0, bottom = 0 }) { this.inset = { top, bottom }; }
  // Frame the whole board (plus edge strips) in the uncovered part of the viewport.
  fit() {
    const span = this.spanG;
    const openH = Math.max(120, this.viewH - this.inset.top - this.inset.bottom);
    const kw = 1.88 * this.viewW / span;                          // span * k/2 <= 0.94 * viewW
    const kh = 0.94 * openH / (span / 4 + H_UNIT + FIT_ROOM);      // plus room for tile height
    this.baseK = Math.max(6, Math.min(kw, kh));
    this.zoom = 1; this.k = this.baseK;
    // centre in the open band, nudged up-screen to leave room below
    this.panX = 0; this.panY = (this.inset.top - this.inset.bottom) / 2 - this.hz * 0.35;
    this.userAdjusted = false;
  }

  resize(board) {
    const host = this.canvas.parentElement;
    const rect = host.getBoundingClientRect();
    const viewW = Math.max(160, Math.floor(rect.width)), viewH = Math.max(160, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = viewW + 'px'; this.canvas.style.height = viewH + 'px';
    this.canvas.width = Math.round(viewW * dpr); this.canvas.height = Math.round(viewH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
    this.viewW = viewW; this.viewH = viewH;
    this.w = board.w; this.h = board.h;
    const key = board.w + 'x' + board.h;
    if (key !== this.boardKey || !this.userAdjusted) { this.boardKey = key; this.fit(); }
    else { this.setZoom(this.zoom); this.clampPan(); }
  }

  // --------------------------------------------------------- hit testing
  cellAt(px, py) {
    const [gx, gy] = this.unproject(px, py);
    const x = Math.floor(gx), y = Math.floor(gy);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return { x, y };
  }
  edgeAt(px, py) {
    const [gx, gy] = this.unproject(px, py);
    const m = EDGE_MARGIN;
    const inX = gx >= 0 && gx < this.w, inY = gy >= 0 && gy < this.h;
    if (inX && gy < 0 && gy >= -m) return 'N';
    if (inX && gy >= this.h && gy < this.h + m) return 'S';
    if (inY && gx < 0 && gx >= -m) return 'W';
    if (inY && gx >= this.w && gx < this.w + m) return 'E';
    return null;
  }
  // Grid-space rect [x, y, w, h] of an edge strip.
  edgeRegion(e) {
    const m = EDGE_MARGIN;
    if (e === 'N') return [0, -m, this.w, m];
    if (e === 'S') return [0, this.h, this.w, m];
    if (e === 'W') return [-m, 0, m, this.h];
    return [this.w, 0, m, this.h];
  }
  // The part of an edge strip that is drawn straight. A railway that meets the
  // sea gives up the last square at that end to the curve which turns it along
  // the shore, so the two never overlap. Picking still uses the whole strip.
  edgeStripRegion(board, e) {
    const [gx, gy, gw, gh] = this.edgeRegion(e);
    if (board.edges[e] !== 'rail') return [gx, gy, gw, gh];
    const horiz = e === 'N' || e === 'S';
    const lo = board.edges[horiz ? 'W' : 'N'] === 'water' ? TURN_R : 0;
    const hi = board.edges[horiz ? 'E' : 'S'] === 'water' ? TURN_R : 0;
    return horiz ? [gx + lo, gy, gw - lo - hi, gh] : [gx, gy + lo, gw, gh - lo - hi];
  }
  // Screen positions used by tests and by "look at this" camera moves.
  cellCenterPx(x, y) { return this.project(x + 0.5, y + 0.5); }
  // How tall a tile of this key stands, in grid units; multiply by `hz` for px.
  heightOf(key) { return tileHeight(tileDef(key)); }
  edgeCenterPx(e) { const [x, y, w, h] = this.edgeRegion(e); return this.project(x + w / 2, y + h / 2); }
  // Centre the camera on a grid point without changing zoom.
  lookAt(gx, gy) {
    const [sx, sy] = this.project(gx, gy);
    this.panX += this.viewW / 2 - sx; this.panY += this.viewH / 2 - sy;
    this.userAdjusted = true; this.clampPan();
  }

  // ------------------------------------------------------- path helpers
  // Add a grid-space rect, optionally raised by `z` grid units, to the current path.
  rectPath(gx, gy, gw, gh, z = 0) {
    const ctx = this.ctx, dz = z * this.hz;
    const pts = [[gx, gy], [gx + gw, gy], [gx + gw, gy + gh], [gx, gy + gh]];
    pts.forEach(([x, y], i) => { const [sx, sy] = this.project(x, y); if (i) ctx.lineTo(sx, sy - dz); else ctx.moveTo(sx, sy - dz); });
    ctx.closePath();
  }
  // Path around a grid-space rect, optionally raised by `z` grid units.
  regionPath(gx, gy, gw, gh, z = 0) { this.ctx.beginPath(); this.rectPath(gx, gy, gw, gh, z); }
  cellPath(x, y, z = 0) { this.regionPath(x, y, 1, 1, z); }
  fillRegion(gx, gy, gw, gh, color, z = 0) { this.regionPath(gx, gy, gw, gh, z); this.ctx.fillStyle = color; this.ctx.fill(); }
  fillCell(x, y, color, z = 0) { this.fillRegion(x, y, 1, 1, color, z); }
  // Path around the union of a tile's cells (its footprint outline).
  cellsPath(cells, z = 0) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [x, y] of cells) {
      const dz = z * this.hz;
      const p = [this.project(x, y), this.project(x + 1, y), this.project(x + 1, y + 1), this.project(x, y + 1)];
      ctx.moveTo(p[0][0], p[0][1] - dz);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1] - dz);
      ctx.closePath();
    }
  }
  // Arc of a circle in grid space, added to the current path. The grid -> screen
  // map is linear, so a circle of grid points comes out as the ellipse the
  // camera should see; 12 segments a quarter turn is past the eye's resolution.
  arcPath(cx, cy, r, a0, a1, steps = 12, join = false) {
    const ctx = this.ctx;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * i / steps;
      const [sx, sy] = this.project(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      (i || join) ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    }
  }
  // The slice of ring between two radii, filled: a quarter of one is a band of
  // constant width turning a corner.
  fillRing(cx, cy, r0, r1, a0, a1, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    this.arcPath(cx, cy, r1, a0, a1);
    this.arcPath(cx, cy, r0, a1, a0, 12, true);
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  line(g0, g1, z = 0) {
    const dz = z * this.hz;
    const a = this.project(g0[0], g0[1]), b = this.project(g1[0], g1[1]);
    this.ctx.moveTo(a[0], a[1] - dz); this.ctx.lineTo(b[0], b[1] - dz);
  }
  // Screen-space bounding box of a set of cells raised by z.
  cellsBounds(cells, z = 0) {
    const dz = z * this.hz;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of cells) for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const [sx, sy] = this.project(x + dx, y + dy);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy - dz); y1 = Math.max(y1, sy - dz);
    }
    return { x0, y0, x1, y1 };
  }

  // ---------------------------------------------------------------- draw
  draw(view) {
    const { board } = view;
    const ctx = this.ctx;
    this.time = performance.now() / 1000;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    this.drawWorld(board);
    this.drawEdges(view, board);
    this.drawGround(view, board);

    // ground overlays: heat, radius rings, placement hints
    if (view.heat && view.result) this.drawHeat(board, view.result);
    if (view.radiusTile) this.drawRadius(view.radiusTile, 'rgba(255,210,63,0.30)');
    if (view.ghost && view.ghost.def && view.ghost.def.kind === 'amenity' && view.ghost.def.radius > 0) {
      this.drawRadiusCells(view.ghost.cells, view.ghost.def.radius, 'rgba(53,212,255,0.26)');
    }
    const ghost = view.ghost ? this.ghostInfo(view.ghost, board) : null;
    if (ghost) {
      for (const [x, y] of ghost.lane) this.hatchCell(x, y, 'rgba(31,207,176,0.85)');
      for (const [x, y, terr] of ghost.driveway) this.fillRegion(x + 0.12, y + 0.12, 0.76, 0.76, terr === 'water' ? 'rgba(30,160,234,0.5)' : 'rgba(120,120,130,0.5)');
    }
    // Aiming or inspecting an underground tile lifts the whole tunnel layer
    // above the buildings, so a crossing is visible even where a tile covers it.
    const underground = !!(ghost && ghost.tunnel) || !!(view.showUnderground);

    // Buildings are painted cell by cell, back to front along x + y, rather
    // than tile by tile. Footprints interleave: a one-cell tile can sit in
    // front of one end of a long building and behind the other, so no ordering
    // of whole tiles is correct and the draw unit has to be the cell. A tile's
    // label goes down once its last cell has, so its own roof never covers it.
    //
    // Each cell paints in two layers with the crowd sandwiched between them:
    // floor, then the travellers standing on it, then walls and roof. That is
    // what makes a traveller who steps into a shop disappear inside it, and it
    // is the seam per-tile floor art drops into later - see drawTileFloor.
    // Depth is x + y; the fractional offsets below keep each sandwich intact
    // without disturbing the ordering between cells.
    const occAt = view.result && view.T != null ? Math.min(view.result.ticks, Math.max(0, Math.ceil(view.T))) : null;
    const layers = [], groundLabels = [];
    for (const t of board.tiles) {
      const info = this.tileInfo(t, view, occAt);
      for (const [x, y] of t.cells) {
        layers.push({ k: x + y - 0.75, fn: () => this.drawTileFloor(x, y, info) });
        if (!info.flush) layers.push({ k: x + y, fn: () => { this.drawTileRoof(x, y, info); if (--info.left === 0) this.drawTileLabel(info); } });
      }
      if (info.flush) groundLabels.push(info);
    }
    // Checkpoint fences stand on the grid lines between cells. A panel sorts
    // just behind the cell south (or east) of it, so a traveller or building
    // on the near side covers it and anything on the far side sits behind it.
    // A panel inside one tile's footprint is hidden by that tile, so skip it.
    const owner = new Map();
    for (const t of board.tiles) for (const [x, y] of t.cells) owner.set(x + ',' + y, t.id);
    for (const s of fenceSegments(board)) {
      const [ax, ay] = s.axis === 'h' ? [s.x, s.y - 1] : [s.x - 1, s.y];
      const o = owner.get(ax + ',' + ay);
      if (o != null && o === owner.get(s.x + ',' + s.y)) continue;
      layers.push({ k: s.x + s.y - 0.6, fn: () => this.drawFenceSeg(s, false) });
    }
    if (ghost) for (const [x, y] of ghost.cells) layers.push({ k: x + y, fn: () => this.drawGhostCell(x, y, ghost) });
    const dots = view.result && view.T != null ? this.agentDots(view.result, view.T) : [];
    for (const d of dots) layers.push({ k: Math.floor(d.gx) + Math.floor(d.gy) - 0.5, fn: () => this.drawAgentDot(d) });
    layers.sort((a, b) => a.k - b.k);
    for (const l of layers) l.fn();
    // A flush tile has no roof to hang its label on, and the crowd walks over
    // where the label sits, so its label goes up after the travellers.
    for (const info of groundLabels) this.drawTileLabel(info);

    // outlines sit above the buildings they mark
    if (view.ghost && view.ghost.def && view.ghost.def.kind === 'amenity' && view.ghost.def.radius > 0) {
      for (const t of board.tiles) {
        if (t.kind !== 'amenity') continue;
        const d = tileDef(t.key); const r = d.radius + (t.radiusBonus || 0);
        if (r <= 0) continue;
        if (cellsWithin(view.ghost.cells, t.cells, Math.max(r, view.ghost.def.radius))) this.outlineCells(t.cells, 'rgba(53,212,255,0.95)', 2, tileHeight(d));
      }
    }
    if (view.targetMode) for (const t of board.tiles) if (view.targetMode(t)) this.outlineCells(t.cells, 'rgba(53,212,255,0.95)', 2, tileHeight(tileDef(t.key)));
    if (view.dangerTiles) for (const t of view.dangerTiles) this.outlineCells(t.cells, 'rgba(255,79,122,0.95)', 3, tileHeight(tileDef(t.key)));
    if (view.hoverTile && view.hoverTile !== view.selectedTile) this.outlineCells(view.hoverTile.cells, 'rgba(255,255,255,0.7)', 2, tileHeight(tileDef(view.hoverTile.key)));
    if (view.selectedTile) this.outlineCells(view.selectedTile.cells, '#ffd23f', 3, tileHeight(tileDef(view.selectedTile.key)));

    if (underground) this.drawUnderground(board, ghost, view);
    if (ghost) this.drawGhostOutline(ghost);
    // a checkpoint ghost previews the whole fence line it would raise
    if (ghost && view.ghost.def && view.ghost.def.special === 'gate' && ghost.cells.length === 2) {
      const ln = checkpointLine(ghost.cells);
      for (const s of fenceSegments(board, ghost.cells)) if (s.axis === ln.axis && (s.axis === 'h' ? s.y : s.x) === ln.line) this.drawFenceSeg(s, true, ghost.ok);
    }
    if (view.starBadge) this.drawStarBadge(view.starBadge);
    if (dots.length) this.drawAgentPopups(dots, view.T);
  }

  // ---------------------------------------------------------------- world
  // Grid-space bounds of everything the viewport shows, padded a little.
  visibleGrid(pad = 2) {
    const pts = [[0, 0], [this.viewW, 0], [0, this.viewH], [this.viewW, this.viewH]].map(([x, y]) => this.unproject(x, y));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.floor(Math.min(...xs)) - pad, x1: Math.ceil(Math.max(...xs)) + pad, y0: Math.floor(Math.min(...ys)) - pad, y1: Math.ceil(Math.max(...ys)) + pad };
  }

  // The land the station sits in. A side the sea has claimed turns to water
  // all the way to the horizon, and roads and railways carry on past the
  // corners until they leave the screen or reach the shore.
  drawWorld(board) {
    const ctx = this.ctx, vb = this.visibleGrid(), m = EDGE_MARGIN;
    ctx.fillStyle = WORLD_LAND; ctx.fillRect(0, 0, this.viewW, this.viewH);
    const water = EDGES.filter(e => board.edges[e] === 'water');
    const seas = water.map(e => this.seaRegion(e, vb)).filter(Boolean);
    if (seas.length) {
      ctx.beginPath(); for (const r of seas) this.rectPath(...r);
      ctx.fillStyle = TERRAIN_COLORS.water; ctx.fill();
      this.drawWaves(seas);
      // surf along each shoreline
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(1.5, this.k * 0.07); ctx.beginPath();
      for (const e of water) {
        const [a, b] = this.runRange(e, board, vb);
        const c = e === 'S' ? this.h : e === 'E' ? this.w : 0;
        if (e === 'N' || e === 'S') this.line([a, c], [b, c]); else this.line([c, a], [c, b]);
      }
      ctx.stroke();
    }
    // the runway lies outside the apron strip, so it goes down before the runs
    for (const e of EDGES) if (board.edges[e] === 'apron') this.drawRunway(e);
    for (const e of EDGES) if (RUNS.has(board.edges[e])) this.drawRun(e, board, vb);
    // A railway that runs into the sea turns the corner and follows the shore.
    for (const e of EDGES) if (board.edges[e] === 'rail') this.drawShoreTurns(e, board, vb);
    // Where two runs cross just off a corner, lay a clean junction: asphalt
    // if either is a road, with any railway over it as a level crossing.
    for (const [a, b] of [['N', 'E'], ['E', 'S'], ['S', 'W'], ['W', 'N']]) {
      const ta = board.edges[a], tb = board.edges[b];
      if (!RUNS.has(ta) || !RUNS.has(tb)) continue;
      const cx = a === 'E' || b === 'E' ? this.w : -m, cy = a === 'S' || b === 'S' ? this.h : -m;
      this.fillRegion(cx, cy, m, m, TERRAIN_COLORS[ta === 'road' || tb === 'road' ? 'road' : 'rail']);
      for (const [e, t] of [[a, ta], [b, tb]]) if (t === 'rail') this.edgeTexture(e, t, cx, cy, m, m);
    }
  }

  // Grid rect of the open sea beyond a water edge, clipped to the view.
  seaRegion(e, vb) {
    if (e === 'N') return vb.y0 < 0 ? [vb.x0, vb.y0, vb.x1 - vb.x0, -vb.y0] : null;
    if (e === 'S') return vb.y1 > this.h ? [vb.x0, this.h, vb.x1 - vb.x0, vb.y1 - this.h] : null;
    if (e === 'W') return vb.x0 < 0 ? [vb.x0, vb.y0, -vb.x0, vb.y1 - vb.y0] : null;
    return vb.x1 > this.w ? [this.w, vb.y0, vb.x1 - this.w, vb.y1 - vb.y0] : null;
  }

  // How far along its side an edge's run (road, rail or shoreline) reaches:
  // out past the edge of the view, unless the neighbouring side is sea. The
  // far end snaps to a multiple of 3 so road dashes and sleepers stay in step
  // with the strip beside the board.
  runRange(e, board, vb) {
    const horiz = e === 'N' || e === 'S', len = horiz ? this.w : this.h;
    const lo = board.edges[horiz ? 'W' : 'N'] === 'water' ? 0 : Math.floor((horiz ? vb.x0 : vb.y0) / 3) * 3;
    const hi = board.edges[horiz ? 'E' : 'S'] === 'water' ? len : Math.max(len, horiz ? vb.x1 : vb.y1);
    return [Math.min(lo, 0), hi];
  }

  // The stretches of an edge's road or railway beyond the board's corners;
  // drawEdges paints the stretch alongside the board.
  drawRun(e, board, vb) {
    const terrain = board.edges[e], horiz = e === 'N' || e === 'S';
    const [sx, sy, sw, sh] = this.edgeRegion(e), len = horiz ? this.w : this.h;
    const [lo, hi] = this.runRange(e, board, vb);
    for (const [a, b] of [[lo, 0], [len, hi]]) {
      if (b <= a) continue;
      const r = horiz ? [a, sy, b - a, sh] : [sx, a, sw, b - a];
      this.fillRegion(...r, TERRAIN_COLORS[terrain]);
      this.edgeTexture(e, terrain, ...r);
    }
  }

  // Two squares of runway beyond an apron strip, so a locked airfield edge is
  // three deep: the grey apron the aircraft park on, then dark tarmac inside a
  // painted kerb. The markings are the ones that say runway from the air - a
  // stripe down each side, a dashed centre line, and piano keys at both ends.
  drawRunway(e) {
    const ctx = this.ctx, m = EDGE_MARGIN, d = RUNWAY.depth;
    const along = e === 'N' || e === 'S' ? this.w : this.h;
    const r = e === 'N' ? [0, -m - d, along, d] : e === 'S' ? [0, this.h + m, along, d]
      : e === 'W' ? [-m - d, 0, d, along] : [this.w + m, 0, d, along];
    this.fillRegion(...r, RUNWAY.fill);
    this.regionPath(...r); ctx.strokeStyle = RUNWAY.border; ctx.lineWidth = Math.max(1.5, this.k * 0.07); ctx.stroke();
    // u runs the length of the runway, v across it
    const horiz = e === 'N' || e === 'S';
    const at = (u, v) => horiz ? [r[0] + u, r[1] + v * d] : [r[0] + v * d, r[1] + u];
    ctx.strokeStyle = RUNWAY.paint; ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(1, this.k * 0.05); ctx.beginPath();
    this.line(at(0, 0.06), at(along, 0.06)); this.line(at(0, 0.94), at(along, 0.94));
    ctx.stroke();
    ctx.lineWidth = Math.max(1, this.k * 0.07); ctx.beginPath();
    for (let u = 1.6; u < along - 1.6; u += 2) this.line(at(u, 0.5), at(Math.min(along - 1.6, u + 1), 0.5));
    ctx.stroke();
    if (this.k < 12) return;   // the keys turn to mush below that
    ctx.lineWidth = Math.max(1, this.k * 0.055); ctx.beginPath();
    for (const [u0, u1] of [[0.2, 1.0], [along - 1.0, along - 0.2]])
      for (const v of [0.17, 0.29, 0.41, 0.59, 0.71, 0.83]) this.line(at(u0, v), at(u1, v));
    ctx.stroke();
  }

  // A railway can't run into the sea, so where one meets a water edge the track
  // curves 90 degrees and carries on along the shore until it leaves the view.
  // The bend is a quarter of a ring of the same width as the strip, and the
  // strip gives up its last TURN_R to it (see edgeStripRegion), so the rails
  // run off the straight track and round the curve at the same radius rather
  // than mitring into a notch with a stub of track pointing at the water.
  drawShoreTurns(e, board, vb) {
    const ctx = this.ctx, m = EDGE_MARGIN, R = TURN_R, horiz = e === 'N' || e === 'S';
    for (const n of horiz ? ['W', 'E'] : ['N', 'S']) {
      if (board.edges[n] !== 'water') continue;
      // The bend's centre sits R back from the board along the strip and R back
      // from the sea across the band, so the arc at radius R - v runs straight
      // into the rail that edgeTexture lays across a strip at the same v.
      const eOut = e === 'N' ? -R : e === 'S' ? this.h + R : e === 'W' ? -R : this.w + R;
      const nOut = n === 'N' ? R : n === 'S' ? this.h - R : n === 'W' ? R : this.w - R;
      const [cx, cy] = horiz ? [nOut, eOut] : [eOut, nOut];
      // The wedge opens from the strip the track leaves toward the shore it joins.
      const aStrip = horiz ? (e === 'N' ? Math.PI / 2 : -Math.PI / 2) : (e === 'W' ? 0 : Math.PI);
      const aShore = horiz ? (n === 'W' ? Math.PI : 0) : (n === 'N' ? -Math.PI / 2 : Math.PI / 2);
      const a1 = aStrip + Math.atan2(Math.sin(aShore - aStrip), Math.cos(aShore - aStrip));
      // the straight run along the shore, from the end of the bend outwards
      const band = n === 'W' || n === 'N' ? 0 : (n === 'E' ? this.w : this.h) - m;
      const r = e === 'N' ? [band, vb.y0, m, cy - vb.y0] : e === 'S' ? [band, cy, m, vb.y1 - cy]
        : e === 'W' ? [vb.x0, band, cx - vb.x0, m] : [cx, band, vb.x1 - cx, m];
      if (r[2] > 0 && r[3] > 0) {
        this.fillRegion(...r, TERRAIN_COLORS.rail);
        this.edgeTexture(n, 'rail', ...r);   // the run follows n, so its sleepers do too
      }
      this.fillRing(cx, cy, R - m, R, aStrip, a1, TERRAIN_COLORS.rail);
      // the same two rails and sleepers edgeTexture lays, bent round the bend
      ctx.strokeStyle = '#efe8ff'; ctx.lineWidth = Math.max(1, this.k * 0.045);
      ctx.beginPath();
      for (const v of [0.35, 0.65]) this.arcPath(cx, cy, R - v * m, aStrip, a1);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, this.k * 0.03); ctx.beginPath();
      for (const f of [1 / 8, 3 / 8, 5 / 8, 7 / 8]) {
        const a = aStrip + (a1 - aStrip) * f, c = Math.cos(a), sn = Math.sin(a);
        this.line([cx + c * (R - 0.78 * m), cy + sn * (R - 0.78 * m)], [cx + c * (R - 0.22 * m), cy + sn * (R - 0.22 * m)]);
      }
      ctx.stroke();
    }
  }

  // Little wave crests on a screen-space lattice pinned to the world: they pan
  // with the camera but cost the same at every zoom level.
  drawWaves(seas) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath(); for (const r of seas) this.rectPath(...r); ctx.clip();
    const sx = Math.max(56, this.k * 1.5), sy = sx * 0.5, len = sx * 0.3;
    const [ox, oy] = this.project(0, 0);
    const r0 = Math.floor(-oy / sy) - 1, r1 = Math.ceil((this.viewH - oy) / sy) + 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = Math.max(1.5, this.k * 0.05); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let row = r0; row <= r1; row++) {
      const y = oy + row * sy, off = (row & 1) ? sx / 2 : 0;
      const c0 = Math.floor((-ox - off) / sx) - 1, c1 = Math.ceil((this.viewW - ox - off) / sx) + 1;
      for (let col = c0; col <= c1; col++) {
        const x = ox + off + col * sx;
        const bob = Math.sin(this.time * 1.8 + col * 1.3 + row * 0.7) * sy * 0.12;
        ctx.moveTo(x - len / 2, y + bob); ctx.quadraticCurveTo(x, y + bob - len * 0.4, x + len / 2, y + bob);
      }
    }
    ctx.stroke(); ctx.restore();
  }

  drawEdges(view, board) {
    const ctx = this.ctx, vb = this.visibleGrid();
    for (const e of EDGES) {
      const [gx, gy, gw, gh] = this.edgeRegion(e);
      const terrain = board.edges[e];
      // a water strip is just the near shore of the sea drawWorld painted
      if (terrain !== 'water') {
        const strip = this.edgeStripRegion(board, e);
        this.fillRegion(...strip, TERRAIN_COLORS[terrain] || '#333');
        this.edgeTexture(e, terrain, ...strip);
      }
      // Subway portals: where a line leaves the board it dives under the strip
      // and the track carries on out of the view, the way a railway does. A
      // garage ramp or a submarine channel stops at the edge it tunnels to.
      for (const t of board.tiles) if (t.tunnel && t.tunnel.line === 'through' && t.tunnel.ends.includes(e)) {
        const idx = t.tunnel.axis === 'v' ? t.cells[0][0] : t.cells[0][1];
        this.drawTunnelRun(e, idx, TUNNEL_COLORS.through, vb);
        this.drawPortal(e, idx, TUNNEL_COLORS.through);
      }
      for (const idx of board.openSpans[e]) {
        ctx.fillStyle = 'rgba(200,160,100,0.85)';
        if (e === 'N' || e === 'S') this.regionPath(idx + 0.06, gy + 0.06, 0.88, gh - 0.12);
        else this.regionPath(gx + 0.06, idx + 0.06, gw - 0.12, 0.88);
        ctx.fill();
      }
      if (view.highlightEdges && view.highlightEdges.includes(e)) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
        this.regionPath(gx, gy, gw, gh);
        ctx.strokeStyle = `rgba(255,210,63,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 3; ctx.stroke();
      }
      if (view.edgeHover === e) { this.regionPath(gx, gy, gw, gh); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  drawGround(view, board) {
    const ctx = this.ctx;
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) this.fillCell(x, y, BOARD_CELLS[(x + y) % 2]);
    // A driveway carries the terrain it runs out to, so a boat's jetty and a
    // prop plane's taxiway read as water and tarmac rather than as tarmac road.
    for (const [x, y, terr] of board.driveways) {
      this.fillCell(x, y, TERRAIN_COLORS[terr || 'road']);
      this.fillRegion(x + 0.42, y + 0.42, 0.16, 0.16, terr === 'water' ? 'rgba(255,255,255,0.55)' : '#6d7288');
    }
    for (const [x, y] of board.lanes) this.hatchCell(x, y, '#1fcfb0');
    for (const t of board.tiles) if (t.tunnel) this.drawTunnel(t.tunnel.cells, t.tunnel.axis, TUNNEL_COLORS[t.tunnel.line], 0.55);
    // faint grid so the empty plane still reads as a grid at low zoom
    if (this.k >= 14) {
      ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= board.w; x++) this.line([x, 0], [x, board.h]);
      for (let y = 0; y <= board.h; y++) this.line([0, y], [board.w, y]);
      ctx.stroke();
    }
    // a dark rim so the buildable plot reads against the land around it
    this.regionPath(0, 0, board.w, board.h);
    ctx.strokeStyle = 'rgba(10,5,32,0.45)'; ctx.lineWidth = 2; ctx.stroke();
  }

  drawHeat(board, result) {
    const heat = result.heat; let max = 1;
    for (let i = 0; i < heat.length; i++) max = Math.max(max, heat[i]);
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      const v = heat[y * board.w + x] / max; if (v <= 0) continue;
      this.fillCell(x, y, `rgba(255,${Math.round(200 - 160 * v)},40,${0.15 + 0.7 * Math.sqrt(v)})`);
    }
  }

  // The placement preview joins the depth sort so buildings in front of it
  // occlude it properly; its outline is redrawn on top afterwards so the
  // footprint can never be lost behind one.
  ghostInfo(g, board) {
    const cells = g.cells.filter(([x, y]) => x >= 0 && y >= 0 && x < board.w && y < board.h);
    return {
      isGhost: true, ok: g.ok, z: g.def ? tileHeight(g.def) : 0.2,
      color: g.ok ? '#4dff6e' : '#ff4f7a',
      fill: g.ok ? 'rgba(77,255,110,0.40)' : 'rgba(255,79,122,0.40)',
      cells, set: new Set(cells.map(([x, y]) => x + ',' + y)),
      lane: g.lane || [], driveway: g.driveway || [], tunnel: g.tunnel || null,
    };
  }
  drawGhostCell(x, y, info) {
    const ctx = this.ctx;
    this.fillCell(x, y, info.fill);
    // a translucent volume so the footprint reads at the height it will occupy
    ctx.save(); ctx.globalAlpha = 0.35; this.cellWalls(x, y, info); ctx.restore();
  }
  // One checkpoint fence panel: a translucent screen between two posts, with a
  // rail along the top so it reads at any zoom.
  drawFenceSeg(s, ghost = false, ok = true) {
    const ctx = this.ctx, dz = FENCE_H * this.hz;
    const a = this.project(s.a[0], s.a[1]), b = this.project(s.b[0], s.b[1]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - dz); ctx.lineTo(a[0], a[1] - dz); ctx.closePath();
    ctx.fillStyle = ghost ? (ok ? 'rgba(77,255,110,0.28)' : 'rgba(255,79,122,0.28)') : 'rgba(216,67,58,0.42)';
    ctx.fill();
    ctx.strokeStyle = ghost ? (ok ? 'rgba(150,240,150,0.95)' : 'rgba(255,140,170,0.95)') : '#ffb3a8';
    ctx.lineWidth = Math.max(1, this.k * 0.04); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1] - dz); ctx.lineTo(b[0], b[1] - dz);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - dz);
    ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - dz);
    ctx.stroke();
  }
  drawGhostOutline(info) {
    if (!info.cells.length) return;
    const c = info.ok ? '150,240,150' : '255,140,170';
    this.outlineCells(info.cells, `rgba(${c},0.95)`, 2, info.z);
    this.outlineCells(info.cells, `rgba(${c},0.5)`, 1.5, 0);
  }

  // What a pending action is worth, floated over the tile it would affect: the
  // star delta, one star per 1,000 points, always rounded down. Ten or fewer are
  // drawn as glyphs, more as a plain "+12 ★" - never both. Losing placements
  // show red stars blinking to black.
  drawStarBadge(badge) {
    const cells = badge.cells || [];
    if (!cells.length) return;
    const ctx = this.ctx;
    const b = this.cellsBounds(cells, badge.z || 0);
    const cx = (b.x0 + b.x1) / 2;
    const fs = Math.max(16, Math.min(34, this.k * 0.7));
    const small = Math.max(11, fs * 0.42);
    const lines = [];

    if (badge.reason) lines.push({ text: badge.reason, color: '#ff9db4', size: small });
    else if (badge.stars == null) lines.push({ text: '…', color: 'rgba(255,255,255,0.65)', size: fs });
    else {
      const n = badge.stars, mag = Math.abs(n);
      if (mag > STAR_GLYPH_MAX) {
        lines.push({ text: `${n > 0 ? '+' : '−'}${mag} ★`, color: n > 0 ? '#ffd15a' : '#ff4f7a', size: fs * 0.8, weight: 800 });
      } else {
        const stars = [];
        for (let i = 0; i < mag; i++) stars.push({ bad: n < 0 });
        if (!stars.length) stars.push({ zero: true });
        lines.push({ stars, size: fs });
      }
    }
    for (const w of (badge.warnings || [])) lines.push({ text: w, color: '#f0c46a', size: small });

    const gap = 3;
    const measure = ln => {
      if (!ln.stars) { ctx.font = `${ln.weight || 600} ${ln.size}px system-ui, sans-serif`; return ctx.measureText(ln.text).width; }
      return ln.stars.length * ln.size * 0.92;
    };
    const widths = lines.map(measure);
    const heights = lines.map(ln => ln.size * 1.05);
    const boxW = Math.max(...widths) + 14, boxH = heights.reduce((a, v) => a + v + gap, 0) - gap + 10;
    let top = b.y0 - 12 - boxH;
    if (top < 6) top = b.y0 + 8;   // no room above: drop it under the top corner

    ctx.save();
    roundRect(ctx, cx - boxW / 2, top, boxW, boxH, 8);
    ctx.fillStyle = 'rgba(20,10,48,0.85)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; ctx.stroke();

    // blink phase for red stars: red <-> near-black, about once a second
    const blink = 0.5 + 0.5 * Math.sin(this.time * 7);
    ctx.textBaseline = 'top';
    let y = top + 5;
    lines.forEach((ln, i) => {
      if (!ln.stars) {
        ctx.font = `${ln.weight || 600} ${ln.size}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = ln.color;
        ctx.fillText(ln.text, cx, y);
      } else {
        ctx.font = `${ln.size}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        let x = cx - widths[i] / 2;
        for (const st of ln.stars) {
          if (st.zero) ctx.fillStyle = 'rgba(255,255,255,0.28)';
          else if (st.bad) ctx.fillStyle = mixHex('#ff4f7a', '#07070a', blink);
          else ctx.fillStyle = '#ffd15a';
          ctx.fillText(st.zero ? '☆' : '★', x, y);
          x += ln.size * 0.92;
        }
      }
      y += heights[i] + gap;
    });
    ctx.restore();
  }

  edgeTexture(e, terrain, gx, gy, gw, gh) {
    const ctx = this.ctx;
    const horiz = e === 'N' || e === 'S';
    const along = horiz ? gw : gh;
    // parametric helpers: u runs along the strip, v across it
    const at = (u, v) => horiz ? [gx + u, gy + v * gh] : [gx + v * gw, gy + u];
    if (terrain === 'rail') {
      ctx.strokeStyle = '#efe8ff'; ctx.lineWidth = Math.max(1, this.k * 0.045); ctx.beginPath();
      this.line(at(0, 0.35), at(along, 0.35)); this.line(at(0, 0.65), at(along, 0.65));
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, this.k * 0.03); ctx.beginPath();
      for (let u = 0.25; u < along; u += 0.5) this.line(at(u, 0.22), at(u, 0.78));
      ctx.stroke();
    } else if (terrain === 'road') {
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = Math.max(1, this.k * 0.06); ctx.beginPath();
      for (let u = 0.15; u < along; u += 0.6) this.line(at(u, 0.5), at(Math.min(along, u + 0.3), 0.5));
      ctx.stroke();
    } else if (terrain === 'apron') {
      ctx.strokeStyle = '#fff27a'; ctx.lineWidth = Math.max(1, this.k * 0.06); ctx.beginPath();
      for (let u = 0.2; u < along; u += 0.45) this.line(at(u, 0.5), at(Math.min(along, u + 0.1), 0.5));
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(190,255,130,0.35)';
      for (let u = 0.1; u < along; u += 0.28) {
        const a = at(u, 0.34), b = at(u + 0.08, 0.66);
        this.regionPath(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]) || 0.08, Math.abs(b[1] - a[1]) || 0.08);
        ctx.fill();
      }
    }
  }

  hatchCell(x, y, color) {
    const ctx = this.ctx;
    ctx.save(); this.cellPath(x, y); ctx.clip();
    const b = this.cellsBounds([[x, y]]);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    const step = Math.max(4, this.k * 0.18), h = b.y1 - b.y0;
    ctx.beginPath();
    for (let i = -h; i < b.x1 - b.x0 + h; i += step) { ctx.moveTo(b.x0 + i, b.y1); ctx.lineTo(b.x0 + i + h, b.y0); }
    ctx.stroke();
    ctx.restore();
  }

  // One tunnel: a dark cut along its axis with rail ties across it, so the
  // underground layer reads as track rather than as a painted stripe.
  drawTunnel(cells, axis, color, alpha, ties = true) {
    if (!cells.length) return;
    const ctx = this.ctx;
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const [x, y] of cells) axis === 'h' ? this.rectPath(x, y + 0.3, 1, 0.4) : this.rectPath(x + 0.3, y, 0.4, 1);
    ctx.fillStyle = 'rgba(10,5,32,0.9)'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, this.k * 0.035); ctx.beginPath();
    for (const [x, y] of cells) {
      if (axis === 'h') { this.line([x, y + 0.5], [x + 1, y + 0.5]); if (ties && this.k >= 14) for (const u of [0.25, 0.75]) this.line([x + u, y + 0.36], [x + u, y + 0.64]); }
      else { this.line([x + 0.5, y], [x + 0.5, y + 1]); if (ties && this.k >= 14) for (const u of [0.25, 0.75]) this.line([x + 0.36, y + u], [x + 0.64, y + u]); }
    }
    ctx.stroke(); ctx.restore();
  }
  // The mouth of a subway line in an edge strip, at index `idx` along it.
  drawPortal(e, idx, color) {
    const ctx = this.ctx, m = EDGE_MARGIN;
    const r = e === 'N' ? [idx + 0.28, -m * 0.55, 0.44, m * 0.55] : e === 'S' ? [idx + 0.28, this.h, 0.44, m * 0.55]
      : e === 'W' ? [-m * 0.55, idx + 0.28, m * 0.55, 0.44] : [this.w, idx + 0.28, m * 0.55, 0.44];
    this.fillRegion(...r, 'rgba(10,5,32,0.9)');
    this.regionPath(...r); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, this.k * 0.035); ctx.stroke();
  }
  // A subway line past the edge of the board: the same cut and sleepers as the
  // tunnel inside it, running out of the view so the line reads as going
  // somewhere rather than stopping at the fence.
  drawTunnelRun(e, idx, color, vb) {
    const cells = [];
    if (e === 'N') for (let y = Math.floor(vb.y0); y < 0; y++) cells.push([idx, y]);
    else if (e === 'S') for (let y = this.h; y <= Math.ceil(vb.y1); y++) cells.push([idx, y]);
    else if (e === 'W') for (let x = Math.floor(vb.x0); x < 0; x++) cells.push([x, idx]);
    else for (let x = this.w; x <= Math.ceil(vb.x1); x++) cells.push([x, idx]);
    this.drawTunnel(cells, e === 'N' || e === 'S' ? 'v' : 'h', color, 0.95);
  }

  // The underground layer lifted over the buildings: every tunnel at full
  // strength, the pending one in the ghost's colour, and the ground dimmed so
  // the lines are what the eye lands on.
  drawUnderground(board, ghost, view) {
    const ctx = this.ctx;
    ctx.save();
    this.regionPath(0, 0, board.w, board.h); ctx.fillStyle = 'rgba(10,5,32,0.35)'; ctx.fill();
    ctx.restore();
    for (const t of board.tiles) if (t.tunnel) {
      this.drawTunnel(t.cells.concat(t.tunnel.cells), t.tunnel.axis, TUNNEL_COLORS[t.tunnel.line], 0.95);
      if (view.selectedTile === t || view.hoverTile === t) this.drawTunnel(t.cells.concat(t.tunnel.cells), t.tunnel.axis, '#fff', 0.5, false);
    }
    if (ghost && ghost.tunnel) this.drawTunnel(ghost.cells.concat(ghost.tunnel.cells), ghost.tunnel.axis, ghost.color, 0.95);
  }

  // Everything a tile's cells need in order to paint themselves, worked out
  // once per frame instead of once per cell.
  tileInfo(t, view, occAt) {
    const d = tileDef(t.key);
    let occ = 0, cap = 0, full = false;
    if (occAt != null && view.result && view.result.tileStats[t.id]) {
      const st = view.result.tileStats[t.id];
      cap = st.cap; occ = st.occ[occAt] || 0;
      if (cap > 0 && occ >= cap) full = true;
    }
    const dim = full || (view.closedTiles && view.closedTiles.has(t.id));
    const bx0 = Math.min(...t.cells.map(c => c[0])), by0 = Math.min(...t.cells.map(c => c[1]));
    const bw0 = Math.max(...t.cells.map(c => c[0])) - bx0 + 1, bh0 = Math.max(...t.cells.map(c => c[1])) - by0 + 1;
    const img = sprite(t.key), floorImg = spriteFloor(t.key);
    let tf = null, base = null;
    if (img || floorImg) {
      let tipAt = null;
      if (d.attach === 'tip') {
        const edgeCell = t.cells.find(([x, y]) => y === 0 || y === this.h - 1 || x === 0 || x === this.w - 1);
        if (edgeCell) tipAt = [edgeCell[0] - bx0, edgeCell[1] - by0];
      }
      tf = shapeTransform(d.shape, t.rot, tipAt); base = shapeBaseSize(d.shape);
    }
    const z = tileHeight(d);
    return {
      tile: t, def: d, z, flush: z <= 0, dim, img, floorImg, tf, base, bx0, by0, bw0, bh0,
      color: dim ? '#555a66' : colorForDef(d),
      set: new Set(t.cells.map(([x, y]) => x + ',' + y)),
      stats: { occAt, occ, cap, full },
      left: t.cells.length, // cells still to draw; the label follows the last one
    };
  }

  // The south- and east-facing sides of one cell, drawn only where the
  // footprint actually ends. The two faces of a cell meet at a corner and
  // never overlap, so they need no ordering between them.
  cellWalls(x, y, info) {
    const ctx = this.ctx, dz = info.z * this.hz;
    if (dz <= 0.001) return;
    const face = (g0, g1, f) => {
      const a = this.project(g0[0], g0[1]), b = this.project(g1[0], g1[1]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - dz); ctx.lineTo(a[0], a[1] - dz);
      ctx.closePath(); ctx.fillStyle = shade(info.color, f); ctx.fill();
    };
    if (!info.set.has(x + ',' + (y + 1))) face([x, y + 1], [x + 1, y + 1], 0.52);
    if (!info.set.has((x + 1) + ',' + y)) face([x + 1, y], [x + 1, y + 1], 0.70);
  }

  // One cell's column: its contact shadow, the walls it exposes, its slice of
  // the top face, and the outline of whichever footprint edges it owns.
  // Under layer: the shadow the tile casts and the ground it stands on.
  // Travellers paint on top of this and under drawTileRoof, so anyone who
  // steps inside is covered by the building. Give a tile a `<key>_floor.png`
  // and its interior art (seats, tiling) lands here with the crowd on top.
  drawTileFloor(x, y, info) {
    const ctx = this.ctx;
    // Nothing standing up means nothing to cast a shadow, and no dark base
    // course under the top face: a flush tile is only its own surface.
    if (!info.flush && (!info.set.has(x + ',' + (y + 1)) || !info.set.has((x + 1) + ',' + y))) {
      ctx.save(); ctx.globalAlpha = 0.3; ctx.translate(0, this.k * 0.035);
      this.cellPath(x, y); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
    }
    if (info.floorImg) this.drawCellSprite(x, y, info, info.floorImg, 0);
    else if (!info.flush) { this.cellPath(x, y); ctx.fillStyle = shade(info.color, 0.45); ctx.fill(); }
    if (info.flush) this.drawTileRoof(x, y, info);
  }

  // The grid -> screen map is linear, so feeding it to the context as a
  // transform lets a top-down sprite lie flat on the isometric plane.
  // Clipping to this one cell shows just this cell's slice of it.
  drawCellSprite(x, y, info, img, z) {
    const ctx = this.ctx, dz = z * this.hz;
    const origin = this.project(0, 0), tf = info.tf, base = info.base;
    ctx.save();
    this.cellPath(x, y, z); ctx.clip();
    ctx.transform(this.hw, this.hh, -this.hw, this.hh, origin[0], origin[1] - dz);
    ctx.translate(info.bx0 + info.bw0 / 2, info.by0 + info.bh0 / 2);
    ctx.rotate(tf.rot * Math.PI / 2);
    if (tf.mirror) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -base.w / 2, -base.h / 2, base.w, base.h);
    ctx.restore();
  }

  // Over layer: everything from the floor up. Painted after the crowd, except
  // on a flush tile, where there is nothing above the floor and drawTileFloor
  // calls this itself so the crowd walks over the top of it.
  drawTileRoof(x, y, info) {
    const ctx = this.ctx, z = info.z;
    this.cellWalls(x, y, info);
    if (info.img) {
      this.drawCellSprite(x, y, info, info.img, z);
      if (info.dim) { this.cellPath(x, y, z); ctx.fillStyle = 'rgba(70,74,84,0.7)'; ctx.fill(); }
    } else {
      const d = info.def;
      this.cellPath(x, y, z); ctx.fillStyle = info.color; ctx.fill();
      if (d.special === 'walkway') {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const u = 0.15 + i * 0.28;
          this.line([x + u, y + 0.3], [x + u + 0.14, y + 0.5], z);
          this.line([x + u + 0.14, y + 0.5], [x + u, y + 0.7], z);
        }
        ctx.stroke();
      }
      // checkpoint booth: a scanner lane running across the fence
      if (d.special === 'gate') {
        const c = info.tile.cells, along = c.length > 1 && c[0][0] === c[1][0] ? 'y' : 'x';
        if (along === 'y') this.fillRegion(x + 0.3, y, 0.4, 1, 'rgba(0,0,0,0.35)', z);
        else this.fillRegion(x, y + 0.3, 1, 0.4, 'rgba(0,0,0,0.35)', z);
      }
    }
    // crown line: brightens the top face edge so buildings separate visually
    this.outlineCells([[x, y]], 'rgba(0,0,0,0.55)', 1.5, z, info.set);
    if (z > 0.12) { ctx.save(); ctx.globalAlpha = 0.25; this.outlineCells([[x, y]], '#fff', 1, z, info.set); ctx.restore(); }
  }

  // Labels ride along the tile's long axis so they follow the isometric grid.
  // The anchor is the tile's own cell nearest its centroid, and the run of
  // cells through that anchor sets both the direction and the width budget, so
  // an L- or S-shaped footprint never labels empty ground beside itself.
  drawTileLabel(info) {
    const ctx = this.ctx;
    if (this.k < 15) return;
    const t = info.tile, d = info.def, z = info.z, s = info.stats;
    const mx = t.cells.reduce((a, c) => a + c[0], 0) / t.cells.length + 0.5;
    const my = t.cells.reduce((a, c) => a + c[1], 0) / t.cells.length + 0.5;
    const anchor = t.cells.slice().sort((a, b) => Math.hypot(a[0] + 0.5 - mx, a[1] + 0.5 - my) - Math.hypot(b[0] + 0.5 - mx, b[1] + 0.5 - my))[0];
    const row = t.cells.filter(c => c[1] === anchor[1]), col = t.cells.filter(c => c[0] === anchor[0]);
    let l = anchor[0], r = anchor[0], u = anchor[1], dn = anchor[1];
    while (row.some(c => c[0] === l - 1)) l--;
    while (row.some(c => c[0] === r + 1)) r++;
    while (col.some(c => c[1] === u - 1)) u--;
    while (col.some(c => c[1] === dn + 1)) dn++;
    const runW = r - l + 1, runH = dn - u + 1;
    const cellDiag = this.k * Math.sqrt(5) / 4; // screen length of one cell along a grid axis
    let angle, cg, maxW;
    if (runW === runH) { angle = 0; cg = [l + runW / 2, u + runH / 2]; maxW = runW * this.k * 0.72; }
    else if (runW > runH) { angle = AXIS_ANGLE; cg = [l + runW / 2, anchor[1] + 0.5]; maxW = runW * cellDiag * 0.92 - 8; }
    else { angle = -AXIS_ANGLE; cg = [anchor[0] + 0.5, u + runH / 2]; maxW = runH * cellDiag * 0.92 - 8; }

    const fs = Math.max(8, Math.min(13, this.k * 0.28)), sf = Math.max(7, fs * 0.8);
    const rows = [];
    if (this.k >= 20 && (d.tier > 0 || t.level > 1)) {
      const tag = (d.tier > 0 ? CONFIG.tiers[d.tier - 1].symbol : '') + (t.level > 1 ? (d.tier > 0 ? ' ' : '') + 'L' + t.level : '');
      rows.push({ text: tag, size: sf, weight: 700, color: d.tier > 0 ? CONFIG.tiers[d.tier - 1].color : '#ffe28a' });
    }
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    const words = t.name.split(' ');
    // initials only read as a name with two or more words; otherwise clip it
    const short = () => words.length > 1 ? words.map(w => w[0]).join('') : ellipsize(ctx, t.name, maxW);
    let lines;
    if (ctx.measureText(t.name).width <= maxW) lines = [t.name];
    else if (words.length > 1 && words.every(w => ctx.measureText(w).width <= maxW)) {
      lines = []; let cur = '';
      for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width <= maxW) cur = test; else { lines.push(cur); cur = w; } }
      if (cur) lines.push(cur);
      if (lines.length > 2) lines = [short()];
    } else lines = [short()];
    for (const ln of lines) rows.push({ text: ln, size: fs, weight: 600, color: '#fff' });
    if (s.occAt != null && s.cap > 0 && this.k >= 20) rows.push({ text: `${s.occ}/${s.cap}`, size: sf, weight: 600, color: s.full ? '#ffb0b0' : 'rgba(255,255,255,0.9)' });

    let width = 0, height = 0;
    for (const rw of rows) { ctx.font = `${rw.weight} ${rw.size}px system-ui, sans-serif`; width = Math.max(width, ctx.measureText(rw.text).width); height += rw.size + 3; }
    const [cx, cy] = this.project(cg[0], cg[1]);
    ctx.save();
    ctx.translate(cx, cy - z * this.hz);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(20,10,48,0.68)';
    ctx.beginPath(); ctx.roundRect(-width / 2 - 5, -height / 2 - 2, width + 10, height + 4, 4); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let y = -height / 2;
    for (const rw of rows) {
      ctx.font = `${rw.weight} ${rw.size}px system-ui, sans-serif`;
      ctx.fillStyle = rw.color;
      ctx.fillText(rw.text, 0, y + 1);
      y += rw.size + 3;
    }
    ctx.restore();
  }

  // Outline only the boundary of a cell group, at height z. `boundary` names
  // the footprint to outline against, so a single cell can be drawn with just
  // the edges that are actually the edge of its tile.
  outlineCells(cells, color, lw, z = 0, boundary = null) {
    const ctx = this.ctx;
    const set = boundary || new Set(cells.map(([x, y]) => x + ',' + y));
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.beginPath();
    for (const [x, y] of cells) {
      if (!set.has(x + ',' + (y - 1))) this.line([x, y], [x + 1, y], z);
      if (!set.has(x + ',' + (y + 1))) this.line([x, y + 1], [x + 1, y + 1], z);
      if (!set.has((x - 1) + ',' + y)) this.line([x, y], [x, y + 1], z);
      if (!set.has((x + 1) + ',' + y)) this.line([x + 1, y], [x + 1, y + 1], z);
    }
    ctx.stroke();
  }

  drawRadius(t, color) {
    const d = tileDef(t.key);
    const r = d.radius + (t.radiusBonus || 0);
    if (r <= 0) return;
    this.drawRadiusCells(t.cells, r, color);
  }
  drawRadiusCells(cells, r, color) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let d = 99;
      for (const [cx, cy] of cells) d = Math.min(d, Math.max(Math.abs(cx - x), Math.abs(cy - y)));
      if (d >= 1 && d <= r) this.fillCell(x, y, color);
    }
  }

  // A traveller is a small dot, deliberately smaller than a tile: the crowd
  // reads as flow rather than as a set of counters. Positions come out first
  // so draw() can slot them into the building depth order.
  get dotRadius() { return Math.max(1.2, this.k * 0.062); }

  agentDots(result, T) {
    const out = [];
    for (const a of result.agents) {
      const start = a.spawnTick - 1;
      if (T < start || T > a.endTick + 0.001) continue;
      const k = T - start;
      const i = Math.floor(k), f = k - i;
      const last = a.frames.length - 1;
      const p0 = a.frames[Math.min(i, last)], p1 = a.frames[Math.min(i + 1, last)];
      // slight per-agent jitter inside the cell so stacks stay visible
      const jx = ((a.id * 7919) % 11 - 5) * 0.03, jy = ((a.id * 104729) % 11 - 5) * 0.03;
      const gx = p0[0] + (p1[0] - p0[0]) * f + 0.5 + jx, gy = p0[1] + (p1[1] - p0[1]) * f + 0.5 + jy;
      const [x, y] = this.project(gx, gy);
      out.push({ a, gx, gy, x, y });
    }
    return out;
  }

  drawAgentDot(d) {
    const ctx = this.ctx, r = this.dotRadius, a = d.a;
    ctx.save(); ctx.globalAlpha = 0.35; ctx.beginPath();
    ctx.ellipse(d.x, d.y, r * 1.15, r * 0.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(d.x, d.y - r * 0.7, r, 0, Math.PI * 2);
    ctx.fillStyle = a.kind === 'pickpocket' ? '#222' : CONFIG.tiers[a.tier - 1].color;
    ctx.fill();
    // A hairline outline on a 2px dot is all outline, so only ring it once the
    // dot is big enough to have an inside - and always for pickpockets.
    if (a.kind === 'pickpocket') { ctx.strokeStyle = '#ff4f7a'; ctx.lineWidth = 1; ctx.stroke(); }
    else if (r >= 3) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // Floating chain values sit above everything, buildings included.
  drawAgentPopups(dots, T) {
    const ctx = this.ctx, r = this.dotRadius;
    const popups = [];
    for (const { a, x, y } of dots) {
      for (const ev of a.events) {
        const age = T - (ev.t - 1);
        if (age < 0 || age > 1.2) continue;
        let txt = null, col = '#fff';
        if (ev.type === 'serve') { txt = `×${ev.mult.toFixed(2)}${ev.flat ? '+' + Math.round(ev.flat) : ''}`; col = '#ffe28a'; }
        else if (ev.type === 'board') { txt = `+${Math.round(ev.value).toLocaleString()}`; col = '#4dff6e'; }
        else if (ev.type === 'strand') { txt = `stranded ${Math.round(ev.value)}`; col = '#ff4f7a'; }
        else if (ev.type === 'lost') { txt = 'lost - no route'; col = '#ff4f7a'; }
        else if (ev.type === 'robbed') { txt = `−${Math.round(ev.loss)}`; col = '#ff4f7a'; }
        else if (ev.type === 'stack') { txt = `+stack ${ev.stacks}`; col = '#c8c48a'; }
        else if (ev.type === 'removed') { txt = 'caught!'; col = '#ffd23f'; }
        else if (ev.type === 'cleared') { txt = `cleared ×${ev.mult.toFixed(2)}`; col = '#8fd3ff'; }
        if (txt) popups.push({ x, y: y - r * 2.2 - age * this.k * 0.5, txt, col, alpha: 1 - age / 1.2 });
      }
    }
    ctx.font = `600 ${Math.max(9, Math.min(16, this.k * 0.3))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const p of popups) { ctx.globalAlpha = p.alpha; ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(p.txt, p.x + 1, p.y + 1); ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, p.y); }
    ctx.globalAlpha = 1;
  }
}

// Trim a string with an ellipsis until it fits `maxW` at the context's font.
function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '\u2026').width > maxW) out = out.slice(0, -1);
  return out + '\u2026';
}

function cellsWithin(a, b, r) {
  for (const [ax, ay] of a) for (const [bx, by] of b) if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= r) return true;
  return false;
}

// Above this many stars a row stops being countable, so the badge switches to
// a plain number. Mirrors STAR_GLYPH_MAX in the DOM chrome.
const STAR_GLYPH_MAX = 10;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Blend two #rrggbb colours; t = 1 is fully `b`.
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const mix = sh => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}

// A still of a board on its own canvas, framed to whatever box CSS gives the
// element. The start screen draws each level's opening board with it, so the
// thumbnails are the real renderer rather than a set of screenshots to keep in
// step. Returns the repaint, for the caller to call when the box resizes.
export function boardStill(canvas, board) {
  const r = new BoardRenderer(canvas);
  r.w = board.w; r.h = board.h;
  const paint = () => {
    const rect = canvas.getBoundingClientRect();
    const viewW = Math.round(rect.width), viewH = Math.round(rect.height);
    if (viewW < 40 || viewH < 30) return;   // not laid out yet
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    r.viewW = viewW; r.viewH = viewH;
    r.fit();
    r.panY = 0;   // fit leaves room under the board for the shop tray; a still has none
    r.draw({ board });
  };
  loadSprites(paint);   // tile art arrives after the first paint; repaint when it does
  return paint;
}
