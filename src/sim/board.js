// Board model: grid, tiles, edge terrain, corridor lanes, road driveways and
// the underground layer of tunnels. Placement legality and terrain claims live
// here so the UI, the game layer and the harness all share one rule set.
import { shapeCells } from './shapes.js';
import { tileDef } from '../data/tiles.js';
import { CONFIG } from '../config.js';

export const EDGES = ['N', 'E', 'S', 'W'];
const EDGE_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' };
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

// A level's opening board: the mode's pre-locked edges, plus any tiles it
// starts already built (`startTiles` in data/modes.js). Used by the game layer
// and the harness alike, so a bot board looks like a player's week 1.
export function startBoard(mode) {
  const b = createBoard(mode.w, mode.h, mode.preLock || {});
  for (const t of mode.startTiles || []) {
    const tile = placeTile(b, t.key, t.x, t.y, t.rot || 0, null, mode);
    if (t.level) tile.level = t.level;
  }
  return b;
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

// The underground layer: every cell an existing tunnel runs through, including
// the footprint of the station it belongs to. Ground tiles ignore it entirely -
// anything can be built over a tunnel - but no two tunnels may share a cell.
export function undergroundCells(b) {
  const set = new Set();
  for (const t of b.tiles) if (t.tunnel) for (const [x, y] of t.cells.concat(t.tunnel.cells)) set.add(x + ',' + y);
  return set;
}
// Edges where a subway line surfaces. Such an edge can never become water.
export function tunnelEnds(b) {
  const out = new Set();
  for (const t of b.tiles) if (t.tunnel && t.tunnel.line === 'through') for (const e of t.tunnel.ends) out.add(e);
  return out;
}
// Can this tile's tunnel go anywhere on this board? A subway needs an axis that
// does not end in water; a parking garage or dock needs an edge of its terrain.
// The shop uses this so it never offers an underground tile with nowhere to dig.
export function lineAvailable(b, def) {
  if (def.terrain !== 'underground') return true;
  const e = b.edges;
  if (def.line === 'through') return (e.N !== 'water' && e.S !== 'water') || (e.W !== 'water' && e.E !== 'water');
  return EDGES.some(k => e[k] === def.line);
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

// Cells in the longest straight run of a footprint, in either axis: the L4's
// stem of three, an I5's whole length. A broadside berth has to lay that run
// along the edge.
function longestRun(cells) {
  let best = 0;
  for (const axis of [0, 1]) {
    const rows = new Map();
    for (const c of cells) rows.set(c[1 - axis], (rows.get(c[1 - axis]) || 0) + 1);
    for (const n of rows.values()) best = Math.max(best, n);
  }
  return best;
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

// A lock-terrain tile sitting back from its shore: the same straight, clear run
// a road tile uses, but aimed only at edges that are already its terrain (or
// still open, which it then claims and locks). The run becomes a driveway,
// tagged with the terrain so the renderer paints a jetty rather than tarmac.
function reachInland(b, occ, res, def, cells, terrain) {
  const options = [];
  for (const e of EDGES) {
    const line = lineToEdge(b, cells, e);
    if (line.dist > def.reach) continue;
    const cur = b.edges[e];
    const open = spanOpen(b, e, line.edgeIndex);   // a bridge has opened this span to any terrain
    if (!(cur === terrain || open || (cur === 'green' && !(terrain === 'water' && tunnelEnds(b).has(e))))) continue;
    if (!lineClear(occ, b, line.cells, true)) continue;
    options.push({ e, line, cur });
  }
  if (!options.length) { res.reason = `No way out to the ${terrain}: a ${def.name} needs a clear straight run of ${def.reach} squares or less to it`; return res; }
  options.sort((a, c) => a.line.dist - c.line.dist);
  const pick = options[0];
  res.driveway = pick.line.cells.filter(([lx, ly]) => !occ[ly * b.w + lx]).map(([lx, ly]) => [lx, ly, terrain]);
  if (pick.cur === 'green') res.claims.push({ edge: pick.e, terrain, lock: true });
  res.attachEdges = [pick.e];
  res.ok = true;
  return res;
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
    if (!inBounds(b, cx, cy)) { res.reason = 'That hangs off the board'; return res; }
    const o = occ[cy * b.w + cx];
    if (o) { res.reason = o.type === 'tile' ? 'Sits on top of ' + o.tile.name : o.type === 'lane' ? 'A reserved lane runs through here' : 'A driveway runs through here'; return res; }
  }
  if (def.kind === 'amenity') { res.ok = true; return res; }

  if (def.kind === 'bridge') {
    const touched = edgesTouched(b, cells);
    const lockedTouched = touched.filter(e => b.edges[e] !== 'green');
    if (lockedTouched.length === 0) { res.reason = 'A bridge has to touch an edge that is already road, rail, water or airfield'; return res; }
    for (const e of lockedTouched) for (const i of edgeIndices(b, cells, e)) res.opens.push({ edge: e, idx: i });
    res.ok = true; return res;
  }

  const terrain = def.terrain;
  if (mode && mode.banTerrains && mode.banTerrains.includes(terrain)) { res.reason = `No ${terrain} transport in this mode`; return res; }

  if (terrain === 'free') { res.ok = true; return res; }

  if (LOCK_TERRAINS.has(terrain)) {
    const touched = edgesTouched(b, cells);
    // A small boat or a prop plane does not need a berth on the shore itself:
    // `reach` lets it sit that many squares inland, with a jetty or a taxiway
    // run out to the water or the apron, exactly the way a road tile does.
    if (touched.length === 0 && def.reach) return reachInland(b, occ, res, def, cells, terrain);
    if (touched.length === 0) { res.reason = `A ${def.name} has to touch the edge of the board`; return res; }
    if (def.attach === 'tip') {
      if (touched.length !== 1 || edgeIndices(b, cells, touched[0]).length !== 1) { res.reason = `A ${def.name} has to touch the edge with the tip of its L and the foot pointing inland — rotate it`; return res; }
    }
    // Long vehicles berth alongside, not nose-in: every cell has to sit on the
    // same edge, which pins a straight tile to the two orientations that lie flat.
    if (def.attach === 'edgewise') {
      if (touched.length !== 1 || edgeIndices(b, cells, touched[0]).length !== cells.length) { res.reason = `A ${def.name} has to lie flat along one edge — rotate it`; return res; }
    }
    // Broadside is the mirror of tip: a hull ties up along its long side, so the
    // whole long arm sits on the water and only the short foot points inland.
    if (def.attach === 'broadside') {
      if (touched.length !== 1 || edgeIndices(b, cells, touched[0]).length !== longestRun(cells)) { res.reason = `A ${def.name} ties up side-on: its long side has to lie along the edge, with the short foot inland — rotate it`; return res; }
    }
    const surfacing = terrain === 'water' ? tunnelEnds(b) : null;
    for (const e of touched) {
      const cur = b.edges[e];
      const idx = edgeIndices(b, cells, e);
      const allOpen = idx.every(i => spanOpen(b, e, i));
      // a subway line surfaces at this edge, and a tunnel can't end in the sea
      if (cur === 'green' && surfacing && surfacing.has(e)) { res.reason = `A subway comes up at the ${EDGE_NAME[e]} edge, so that edge can't become water`; return res; }
      if (cur === 'green') res.claims.push({ edge: e, terrain, lock: true });
      else if (cur === terrain || allOpen) { /* fine */ }
      else { res.reason = `The ${EDGE_NAME[e]} edge is already ${cur}, so nothing on ${terrain} can attach there without a bridge`; return res; }
    }
    res.attachEdges = touched;
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
    if (options.length === 0) { res.reason = `No way in by road: needs a clear straight run of ${reach} squares or less to a road or an open edge`; return res; }
    options.sort((a, c) => a.line.dist - c.line.dist);
    const pick = options[0];
    res.driveway = pick.line.cells.filter(([lx, ly]) => !occ[ly * b.w + lx]);
    if (pick.cur === 'green') res.claims.push({ edge: pick.e, terrain: 'road', lock: false });
    res.roadEdge = pick.e;
    res.attachEdges = [pick.e];
    res.ok = true; return res;
  }

  if (terrain === 'underground') {
    // The tunnel is worked out before it is judged, so a failed preview can
    // still show the line that would have crossed or surfaced badly.
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    if (def.line === 'through') {
      // along the long axis, all the way to both ends of the board
      const vertical = (Math.max(...ys) - Math.min(...ys)) > (Math.max(...xs) - Math.min(...xs));
      const own = new Set(cells.map(c => c.join(',')));
      const line = [];
      if (vertical) { for (let yy = 0; yy < b.h; yy++) if (!own.has(xs[0] + ',' + yy)) line.push([xs[0], yy]); }
      else { for (let xx = 0; xx < b.w; xx++) if (!own.has(xx + ',' + ys[0])) line.push([xx, ys[0]]); }
      const ends = vertical ? ['N', 'S'] : ['W', 'E'];
      res.tunnel = { line: 'through', axis: vertical ? 'v' : 'h', ends, cells: line };
      const wet = ends.find(e => b.edges[e] === 'water');
      if (wet) { res.reason = `A ${def.name} can't come up in the water at the ${EDGE_NAME[wet]} edge — rotate it`; return res; }
    } else {
      // straight to the nearest edge of the wanted terrain, however far
      let best = null;
      for (const e of EDGES) {
        if (b.edges[e] !== def.line) continue;
        const line = lineToEdge(b, cells, e);
        if (best === null || line.dist < best.line.dist) best = { e, line };
      }
      if (!best) { res.reason = `A ${def.name} needs a ${def.line} edge to tunnel to`; return res; }
      res.tunnel = { line: def.line, axis: best.e === 'N' || best.e === 'S' ? 'v' : 'h', ends: [best.e], cells: best.line.cells };
      res.attachEdges = [best.e];
    }
    const under = undergroundCells(b);
    const hit = cells.concat(res.tunnel.cells).find(([cx, cy]) => under.has(cx + ',' + cy));
    if (hit) { res.reason = `Two tunnels can't cross — one already runs through ${hit[0]},${hit[1]}`; return res; }
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
    if (!best) { res.reason = `A ${def.name} needs a clear straight lane to the ${vertical ? 'north or south' : 'east or west'} edge — rotate it to aim at a different one`; return res; }
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
    lane: c.lane, driveway: c.driveway, edges: c.attachEdges || [], tunnel: c.tunnel || null,
  };
  b.tiles.push(tile);
  for (const cl of c.claims) b.edges[cl.edge] = cl.terrain;
  for (const o of c.opens) if (!b.openSpans[o.edge].includes(o.idx)) b.openSpans[o.edge].push(o.idx);
  for (const cell of c.lane) b.lanes.push(cell);
  for (const cell of c.driveway) b.driveways.push(cell);
  return tile;
}

// Tiles that would lose their footing if `edge` went back to open ground.
// Each transport records the edges it depends on when placed (`tile.edges`):
// every edge a lock-terrain tile touches, or the edge a road tile's driveway
// runs to, or the edge an underground garage or dock tunnels to. Corridor, Free
// and subway tiles depend on none.
export function edgeDependents(b, edge) {
  return b.tiles.filter(t => (t.edges || []).includes(edge));
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

// Walk map for the simulator. 0 walkable, 1 blocked, 2 walkway, 3 checkpoint
// booth, 5 concourse floor (walk-through at normal speed).
// Corridor lanes are reserved ground, not a wall: nothing may be built on them
// but travellers cross them freely, so a lift lane cannot be used to fence the
// board in two.
export function buildWalkMap(b) {
  const m = new Uint8Array(b.w * b.h);
  for (const t of b.tiles) {
    const def = tileDef(t.key);
    for (const [x, y] of t.cells) {
      const k = y * b.w + x;
      if (def.special === 'walkway') m[k] = 2;
      else if (def.special === 'gate') m[k] = 3;
      // Lounges, parks, hotspots and guard posts are floor space, not walls.
      // Travellers cross them freely; a lounge only stacks once they are
      // waiting there, a park serves anyone who walks through (see sim.js).
      else if (def.walkable) m[k] = 5;
      else if (def.kind === 'bridge') m[k] = 0;
      else m[k] = 1;
    }
  }
  return m;
}

// Transports a placement would wall off: after `cells` become solid, which
// transports can no longer be walked to from some other transport? Travellers
// bound for a sealed platform are lost (see sim.js), so the preview names it.
export function cutOffTransports(b, cells, def) {
  if (def && (def.walkable || def.kind === 'bridge' || def.special === 'walkway' || def.special === 'gate')) return [];
  const before = sealedTransports(b, buildWalkMap(b));
  const m = buildWalkMap(b);
  for (const [x, y] of cells) m[y * b.w + x] = 1;
  return sealedTransports(b, m).filter(t => !before.includes(t));
}
// Transports on walk map `m` that some other transport cannot walk to.
function sealedTransports(b, m) {
  const pass = i => m[i] !== 1;
  const fences = checkpointFences(b);
  const reach = (sx, sy) => {
    const seen = new Uint8Array(b.w * b.h), stack = [sy * b.w + sx];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % b.w, y = (i - x) / b.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue;
        const ni = ny * b.w + nx;
        if (seen[ni] || !pass(ni) || fenceBlocked(fences, b.w, b.h, x, y, dx, dy)) continue;
        if (dx && dy && !(pass(y * b.w + nx) && pass(ny * b.w + x))) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    return seen;
  };
  // a transport's doors: walkable cells 8-adjacent to it
  const doors = t => {
    const own = new Set(t.cells.map(([x, y]) => y * b.w + x)), out = [];
    for (const [x, y] of t.cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(b, nx, ny) || own.has(ny * b.w + nx) || !pass(ny * b.w + nx)) continue;
      out.push(ny * b.w + nx);
    }
    return [...new Set(out)];
  };
  const ts = b.tiles.filter(t => t.kind === 'transport').map(t => ({ t, doors: doors(t) }));
  if (ts.length < 2) return [];
  const seenFrom = ts.map(({ doors }) => (doors.length ? reach(doors[0] % b.w, (doors[0] - doors[0] % b.w) / b.w) : null));
  return ts.filter((a, i) => !a.doors.length || ts.some((c, j) => j !== i && seenFrom[j] && !a.doors.some(d => seenFrom[j][d]))).map(a => a.t);
}

// ------------------------------------------------------------ checkpoints
// A Security Checkpoint is a two-cell booth. Its fence runs along the grid
// line between those two cells, from one board edge to the other, and sits
// between cells rather than on them, so it costs no floor space. The booth is
// the gap: the only place the line can be crossed.
//   axis 'h': the line y = `line` (between rows line-1 and line), gap at column `gap`
//   axis 'v': the line x = `line` (between columns line-1 and line), gap at row `gap`
export function checkpointLine(cells) {
  const [a, c] = cells;
  if (a[0] === c[0]) return { axis: 'h', line: Math.max(a[1], c[1]), gap: a[0] };
  return { axis: 'v', line: Math.max(a[0], c[0]), gap: a[1] };
}

// Every fence line on the board: per line, the set of indices where a fence
// panel stands. How far the panels reach from the booth is `sim.checkpoint.fence`:
// 'edge' runs them to both board edges; 'walls' runs them until a solid tile
// stands on either side of the line (the fence spans the open floor the booth
// sits in); a number runs them that many cells each way. Booths that share a
// line share one fence, and each booth's own cell is always a gap.
export function checkpointFences(b, extraCells = null) {
  const reach = CONFIG.sim.checkpoint.fence;
  const walk = reach === 'walls' ? buildWalkMap(b) : null;
  const solid = (x, y) => x < 0 || y < 0 || x >= b.w || y >= b.h || walk[y * b.w + x] === 1;
  const out = { h: new Map(), v: new Map() };
  const booths = [];
  const add = cells => booths.push(checkpointLine(cells));
  for (const t of b.tiles) if (t.key === 'gate') add(t.cells);
  if (extraCells) add(extraCells);
  for (const { axis, line, gap } of booths) {
    if (!out[axis].has(line)) out[axis].set(line, new Set());
    const walls = out[axis].get(line);
    const len = axis === 'h' ? b.w : b.h;
    // a panel at index i on a horizontal line y sits between (i, y-1) and (i, y)
    const moot = i => axis === 'h' ? (solid(i, line - 1) || solid(i, line)) : (solid(line - 1, i) || solid(line, i));
    for (const dir of [-1, 1]) {
      for (let i = gap + dir, n = 0; i >= 0 && i < len; i += dir, n++) {
        if (typeof reach === 'number' && n >= reach) break;
        if (reach === 'walls' && moot(i)) break;
        walls.add(i);
      }
    }
  }
  for (const { axis, line, gap } of booths) out[axis].get(line).delete(gap);
  return out;
}

// Is a one-cell step from (x, y) by (dx, dy) stopped by a fence? A straight
// step is stopped by the panel it crosses; a diagonal one passes through a
// corner and is stopped if either panel meeting there stands, so nobody
// squeezes past the end of a booth.
export function fenceBlocked(f, w, h, x, y, dx, dy) {
  const walled = (walls, i) => walls.has(i);
  if (dy) {
    const walls = f.h.get(dy > 0 ? y + 1 : y);
    if (walls) {
      if (!dx) { if (walled(walls, x)) return true; }
      else { const cx = dx > 0 ? x + 1 : x; if (walled(walls, cx - 1) || walled(walls, cx)) return true; }
    }
  }
  if (dx) {
    const walls = f.v.get(dx > 0 ? x + 1 : x);
    if (walls) {
      if (!dy) { if (walled(walls, y)) return true; }
      else { const cy = dy > 0 ? y + 1 : y; if (walled(walls, cy - 1) || walled(walls, cy)) return true; }
    }
  }
  return false;
}

// Fence segments to draw, as grid-space lines [[x0, y0], [x1, y1]].
export function fenceSegments(b, extraCells = null) {
  const f = checkpointFences(b, extraCells), segs = [];
  for (const [y, walls] of f.h) for (const x of walls) segs.push({ axis: 'h', x, y, a: [x, y], b: [x + 1, y] });
  for (const [x, walls] of f.v) for (const y of walls) segs.push({ axis: 'v', x, y, a: [x, y], b: [x, y + 1] });
  return segs;
}

export function boardSummary(b) {
  return b.tiles.map(t => `${t.name}@${t.x},${t.y} L${t.level}`).join('; ');
}
