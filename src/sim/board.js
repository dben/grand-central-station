// Board model: grid, tiles, edge terrain, corridor lanes and road driveways.
// Placement legality and terrain claims live here so the UI, the game layer
// and the harness all share one rule set.
import { shapeCells } from './shapes.js';
import { tileDef } from '../data/tiles.js';
import { CONFIG } from '../config.js';

export const EDGES = ['N', 'E', 'S', 'W'];
export const LOCK_TERRAINS = new Set(['rail', 'water', 'apron']);

export function createBoard(w, h, preLock = {}) {
  return {
    w, h,
    tiles: [],
    nextId: 1,
    edges: { N: 'green', E: 'green', S: 'green', W: 'green', ...preLock },
    openSpans: { N: [], E: [], S: [], W: [] },
    lanes: [],
    driveways: [],
  };
}

export function cloneBoard(b) {
  return JSON.parse(JSON.stringify(b));
}

export function inBounds(b, x, y) { return x >= 0 && y >= 0 && x < b.w && y < b.h; }

// Occupancy map: null | {type:'tile', tile} | {type:'lane'} | {type:'driveway'}
export function occupancyMap(b) {
  const m = new Array(b.w * b.h).fill(null);
  for (const t of b.tiles) for (const [x, y] of t.cells) m[y * b.w + x] = { type: 'tile', tile: t };
  for (const [x, y] of b.lanes) m[y * b.w + x] = { type: 'lane' };
  for (const [x, y] of b.driveways) if (!m[y * b.w + x]) m[y * b.w + x] = { type: 'driveway' };
  return m;
}

export function tileAt(b, x, y) {
  for (const t of b.tiles) for (const [cx, cy] of t.cells) if (cx === x && cy === y) return t;
  return null;
}

export function edgesTouched(b, cells) {
  const out = new Set();
  for (const [x, y] of cells) {
    if (y === 0) out.add('N');
    if (y === b.h - 1) out.add('S');
    if (x === 0) out.add('W');
    if (x === b.w - 1) out.add('E');
  }
  return [...out];
}

// Indices along an edge that a set of cells touches (x for N/S, y for E/W)
function edgeIndices(b, cells, edge) {
  const out = [];
  for (const [x, y] of cells) {
    if (edge === 'N' && y === 0) out.push(x);
    if (edge === 'S' && y === b.h - 1) out.push(x);
    if (edge === 'W' && x === 0) out.push(y);
    if (edge === 'E' && x === b.w - 1) out.push(y);
  }
  return out;
}

function spanOpen(b, edge, idx) { return b.openSpans[edge].includes(idx); }

// Straight-line cells from a tile's cells to an edge, plus the distance.
// Returns {dist, cells} where cells are the in-between cells (not including the tile).
function lineToEdge(b, cells, edge) {
  let best = null;
  for (const [x, y] of cells) {
    let dist, line = [];
    if (edge === 'N') { dist = y; for (let yy = 0; yy < y; yy++) line.push([x, yy]); }
    if (edge === 'S') { dist = b.h - 1 - y; for (let yy = y + 1; yy < b.h; yy++) line.push([x, yy]); }
    if (edge === 'W') { dist = x; for (let xx = 0; xx < x; xx++) line.push([xx, y]); }
    if (edge === 'E') { dist = b.w - 1 - x; for (let xx = x + 1; xx < b.w; xx++) line.push([xx, y]); }
    if (best === null || dist < best.dist) best = { dist, cells: line, edgeIndex: (edge === 'N' || edge === 'S') ? x : y };
  }
  // prefer the middle cell among equal-distance candidates for a tidier look
  const cands = [];
  for (const [x, y] of cells) {
    const d = edge === 'N' ? y : edge === 'S' ? b.h - 1 - y : edge === 'W' ? x : b.w - 1 - x;
    if (d === best.dist) cands.push([x, y]);
  }
  const mid = cands[Math.floor((cands.length - 1) / 2)];
  const [x, y] = mid;
  const line = [];
  if (edge === 'N') for (let yy = 0; yy < y; yy++) line.push([x, yy]);
  if (edge === 'S') for (let yy = y + 1; yy < b.h; yy++) line.push([x, yy]);
  if (edge === 'W') for (let xx = 0; xx < x; xx++) line.push([xx, y]);
  if (edge === 'E') for (let xx = x + 1; xx < b.w; xx++) line.push([xx, y]);
  return { dist: best.dist, cells: line, edgeIndex: (edge === 'N' || edge === 'S') ? x : y };
}

function lineClear(occ, b, line, allowDriveway) {
  for (const [x, y] of line) {
    const o = occ[y * b.w + x];
    if (!o) continue;
    if (o.type === 'driveway' && allowDriveway) continue;
    if (o.type === 'tile' && o.tile.kind === 'bridge' && allowDriveway) continue;
    return false;
  }
  return true;
}

/**
 * Check whether a tile can be placed. Returns a result object:
 * { ok, reason, cells, claims:[{edge, terrain, lock}], lane:[], driveway:[], opens:[{edge, idx}] }
 */
export function checkPlacement(b, key, x, y, rot, mode = null) {
  const def = tileDef(key);
  const cells = shapeCells(def.shape, rot).map(([cx, cy]) => [cx + x, cy + y]);
  const res = { ok: false, reason: '', cells, claims: [], lane: [], driveway: [], opens: [], def };
  const occ = occupancyMap(b);
  for (const [cx, cy] of cells) {
    if (!inBounds(b, cx, cy)) { res.reason = 'Out of bounds'; return res; }
    const o = occ[cy * b.w + cx];
    if (o) { res.reason = o.type === 'tile' ? 'Overlaps ' + o.tile.name : o.type === 'lane' ? 'Blocked by a corridor lane' : 'Blocked by a driveway'; return res; }
  }
  if (def.kind === 'amenity') { res.ok = true; return res; }

  if (def.kind === 'bridge') {
    const touched = edgesTouched(b, cells);
    const lockedTouched = touched.filter(e => b.edges[e] !== 'green');
    if (lockedTouched.length === 0) { res.reason = 'A bridge must touch a claimed edge (road, rail, water or apron)'; return res; }
    for (const e of lockedTouched) for (const i of edgeIndices(b, cells, e)) res.opens.push({ edge: e, idx: i });
    res.ok = true; return res;
  }

  const terrain = def.terrain;
  if (mode && mode.banTerrains && mode.banTerrains.includes(terrain)) { res.reason = `${terrain} transport not permitted in this mode`; return res; }

  if (terrain === 'free') { res.ok = true; return res; }

  if (LOCK_TERRAINS.has(terrain)) {
    const touched = edgesTouched(b, cells);
    if (touched.length === 0) { res.reason = `${def.name} must touch an edge`; return res; }
    if (def.attach === 'tip') {
      if (touched.length !== 1 || edgeIndices(b, cells, touched[0]).length !== 1) { res.reason = `${def.name} must point the tip of its L at the edge with the foot inland (rotate or mirror it)`; return res; }
    }
    for (const e of touched) {
      const cur = b.edges[e];
      const idx = edgeIndices(b, cells, e);
      const allOpen = idx.every(i => spanOpen(b, e, i));
      if (cur === 'green') res.claims.push({ edge: e, terrain, lock: true });
      else if (cur === terrain || allOpen) { /* fine */ }
      else { res.reason = `${e} edge is ${cur}; ${terrain} cannot attach there (needs a bridge)`; return res; }
    }
    res.ok = true; return res;
  }

  if (terrain === 'road') {
    const reach = CONFIG.shop.roadReach;
    const options = [];
    for (const e of EDGES) {
      const line = lineToEdge(b, cells, e);
      if (line.dist > reach) continue;
      const cur = b.edges[e];
      const open = spanOpen(b, e, line.edgeIndex);
      if (!(cur === 'green' || cur === 'road' || open)) continue;
      if (!lineClear(occ, b, line.cells, true)) continue;
      options.push({ e, line, cur });
    }
    if (options.length === 0) { res.reason = 'No road access: needs a clear straight path (max 4 cells) to a greenfield or road edge'; return res; }
    options.sort((a, c) => a.line.dist - c.line.dist);
    const pick = options[0];
    res.driveway = pick.line.cells.filter(([lx, ly]) => !occ[ly * b.w + lx]);
    if (pick.cur === 'green') res.claims.push({ edge: pick.e, terrain: 'road', lock: false });
    res.roadEdge = pick.e;
    res.ok = true; return res;
  }

  if (terrain === 'corridor') {
    // the lane continues the tile's long axis: a vertical lift reaches N or S, a horizontal one E or W
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const vertical = (Math.max(...ys) - Math.min(...ys)) > (Math.max(...xs) - Math.min(...xs));
    const allowed = vertical ? ['N', 'S'] : ['E', 'W'];
    let best = null;
    for (const e of allowed) {
      const line = lineToEdge(b, cells, e);
      if (!lineClear(occ, b, line.cells, false)) continue;
      if (best === null || line.dist < best.line.dist) best = { e, line };
    }
    if (!best) { res.reason = `${def.name} needs a clear straight lane to the ${vertical ? 'north or south' : 'east or west'} edge (rotate it to reach another edge)`; return res; }
    res.lane = best.line.cells;
    res.laneEdge = best.e;
    res.ok = true; return res;
  }

  res.reason = 'Unknown terrain ' + terrain;
  return res;
}

export function placeTile(b, key, x, y, rot, check = null, mode = null) {
  const c = check || checkPlacement(b, key, x, y, rot, mode);
  if (!c.ok) throw new Error('Illegal placement: ' + c.reason);
  const def = c.def;
  const tile = {
    id: b.nextId++, key, kind: def.kind, name: def.name, x, y, rot, level: 1,
    cells: c.cells, terrain: def.terrain || null, radiusBonus: 0, arrOverride: null,
    lane: c.lane, driveway: c.driveway,
  };
  b.tiles.push(tile);
  for (const cl of c.claims) b.edges[cl.edge] = cl.terrain;
  for (const o of c.opens) if (!b.openSpans[o.edge].includes(o.idx)) b.openSpans[o.edge].push(o.idx);
  for (const cell of c.lane) b.lanes.push(cell);
  for (const cell of c.driveway) b.driveways.push(cell);
  return tile;
}

export function removeTile(b, id) {
  const i = b.tiles.findIndex(t => t.id === id);
  if (i < 0) return null;
  const t = b.tiles[i];
  b.tiles.splice(i, 1);
  const same = (a, c) => a[0] === c[0] && a[1] === c[1];
  b.lanes = b.lanes.filter(l => !t.lane.some(c => same(c, l)));
  // keep driveway cells still used by another road tile
  b.driveways = b.driveways.filter(d => !t.driveway.some(c => same(c, d)) || b.tiles.some(o => o.driveway.some(c => same(c, d))));
  return t;
}

// Walk map for the simulator. 0 walkable, 1 blocked, 2 walkway, 3 gate pass cell, 4 gate wall
export function buildWalkMap(b, opts = {}) {
  const m = new Uint8Array(b.w * b.h);
  for (const [x, y] of b.lanes) m[y * b.w + x] = opts.walkableLanes ? 0 : 1;
  for (const t of b.tiles) {
    const def = tileDef(t.key);
    for (let i = 0; i < t.cells.length; i++) {
      const [x, y] = t.cells[i];
      const k = y * b.w + x;
      if (def.special === 'walkway') m[k] = 2;
      else if (def.kind === 'bridge') m[k] = 0;
      else if (def.special === 'gate') m[k] = i === 1 ? 3 : 4;
      else m[k] = 1;
    }
  }
  return m;
}

export function boardSummary(b) {
  return b.tiles.map(t => `${t.name}@${t.x},${t.y} L${t.level}`).join('; ');
}
