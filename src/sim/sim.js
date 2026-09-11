// ============================================================================
// Headless, deterministic week simulator.
// Input: board + modifiers + seed. Output: score, money, per-agent tracks,
// per-tile stats, heatmap. No DOM. Runs in Node and the browser.
// ============================================================================
import { CONFIG } from '../config.js';
import { tileDef } from '../data/tiles.js';
import { hashString, mix, gaussOf, weightedOf } from './rng.js';
import { buildWalkMap, checkpointFences, fenceBlocked } from './board.js';

const INF = 1e9;

export const DEFAULT_MODS = {
  batchMult: 1, dwellMult: 1, dwellAdd: 0, cadenceDiv: 1, lowTierBias: 0,
  vipCount: 0, vipBudgetBonus: 0, offlineTerrains: [], offlineTags: [], strikeTerrain: null, strikeSkeleton: null, closedRate: 0,
  closedBelowLevel: 0, rateBonusTags: {}, destTierShift: 0, stopBudgetBonus: 0,
  extraSpawns: [], fareMult: 1, grandOpeningTileId: null, tierMatch: null,
  transportMultBonus: 0, amenityMultBonus: 0, capacityMult: 1, revenueMult: 1, flatMult: 1,
  ticks: null, spawnTicks: null, pickpocketRate: null, amenityRadiusBonus: 0,
};

export function mergeMods(...list) {
  const out = { ...DEFAULT_MODS };
  for (const m of list) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (v === undefined || v === null) continue;
      if (k === 'batchMult' || k === 'dwellMult' || k === 'fareMult' || k === 'capacityMult' || k === 'revenueMult' || k === 'flatMult') out[k] *= v;
      else if (k === 'dwellAdd' || k === 'stopBudgetBonus' || k === 'transportMultBonus' || k === 'amenityMultBonus' || k === 'destTierShift' || k === 'vipCount' || k === 'vipBudgetBonus' || k === 'amenityRadiusBonus') out[k] += v;
      else if (k === 'cadenceDiv') out[k] *= v;
      else if (k === 'offlineTerrains' || k === 'offlineTags' || k === 'extraSpawns') out[k] = out[k].concat(v);
      else if (k === 'rateBonusTags') { out[k] = { ...out[k] }; for (const [t, b] of Object.entries(v)) out[k][t] = (out[k][t] || 0) + b; }
      else out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Effective tile stats (after level, modifiers). Exported so the UI can show them.
// `wifi` is the WiFi strength reaching the tile (see wifiStrength).
export function effTransport(tile, mods = DEFAULT_MODS, cfg = CONFIG, wifi = 0) {
  const def = tileDef(tile.key);
  const lvl = (tile.level || 1) - 1;
  const up = cfg.upgrades.transport;
  const arrBase = tile.arrOverride || def.arr;
  const tags = def.tags || [];
  const offline = mods.offlineTerrains.includes(def.terrain) || tags.some(t => mods.offlineTags.includes(t)) || mods.strikeTerrain === def.terrain;
  // struck, but it is the only terrain running: skeleton service, not a shutdown
  const skeleton = mods.strikeSkeleton === def.terrain;
  return {
    def, tier: def.tier, skeleton,
    batch: Math.max(1, Math.round(def.batch * (1 + up.batch * lvl) * mods.batchMult * (skeleton ? cfg.sim.strikeSkeletonBatch : 1))),
    mult: def.mult + up.mult * lvl + mods.transportMultBonus + wifi * cfg.sim.wifi.exit,
    flat: def.flat * mods.flatMult,
    arr: Math.max(1, Math.ceil(arrBase / mods.cadenceDiv)),
    dep: Math.max(1, Math.ceil(def.dep / mods.cadenceDiv)),
    dwell: Math.round(def.dwell * mods.dwellMult + mods.dwellAdd),
    offline,
  };
}

export function effAmenity(tile, mods = DEFAULT_MODS, cfg = CONFIG, wifi = 0) {
  const def = tileDef(tile.key);
  const lvl = (tile.level || 1) - 1;
  const up = cfg.upgrades.amenity;
  const tags = def.tags || [];
  let rate = def.rate > 0 ? def.rate + up.rate * lvl + wifi * cfg.sim.wifi.rate : 0;
  for (const t of tags) if (mods.rateBonusTags[t]) rate += mods.rateBonusTags[t];
  if (mods.grandOpeningTileId === tile.id) rate = 1;
  const isService = def.rate > 0;
  // An inspection restricts un-upgraded amenities rather than shutting them
  // off: closedRate is the fraction of their pull and chain bonus that still
  // works. closedRate 0 is a full closure.
  const under = mods.closedBelowLevel > 0 && isService && (tile.level || 1) < mods.closedBelowLevel;
  const restrict = under ? mods.closedRate : 1;
  let mult = isService ? def.mult + up.mult * lvl + mods.amenityMultBonus + wifi * cfg.sim.wifi.mult : 1;
  if (under) mult = 1 + (mult - 1) * restrict;
  return {
    def, tier: def.tier, special: def.special || null,
    rate: Math.min(1, rate) * restrict,
    mult,
    flat: def.flat * mods.flatMult * restrict,
    cap: Math.max(1, Math.round(def.cap * (1 + up.capacity * lvl) * mods.capacityMult)),
    dur: def.dur,
    revenue: def.revenue * (1 + up.revenue * lvl) * mods.revenueMult * cfg.economy.revenueScale,
    radius: def.radius + (tile.radiusBonus || 0) + (def.rate > 0 ? mods.amenityRadiusBonus : 0),
    closed: under && restrict === 0,
    restricted: under && restrict > 0,
    walkable: !!def.walkable,
    stackValue: (def.stackValue || (def.key === 'flier_club' ? cfg.sim.frequentFlierStackValue : cfg.sim.waitingStackValue)) + wifi * cfg.sim.wifi.stack,
    minTier: def.key === 'flier_club' ? cfg.sim.frequentFlierMinTier : 1,
  };
}

// ---------------------------------------------------------------------------
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

// WiFi strength reaching a footprint: one unit per hotspot within its radius
// (more for upgraded hotspots), capped. Exported so the UI can quote it.
export function wifiStrength(board, cells, cfg = CONFIG) {
  const wc = cfg.sim.wifi;
  let s = 0;
  for (const w of board.tiles) {
    if (w.key !== 'wifi') continue;
    const r = tileDef(w.key).radius + (w.radiusBonus || 0);
    const near = cells.some(([x, y]) => w.cells.some(([hx, hy]) => Math.max(Math.abs(hx - x), Math.abs(hy - y)) <= r));
    if (near) s += 1 + wc.perLevel * ((w.level || 1) - 1);
  }
  return Math.min(wc.cap, s);
}

export function simulateWeek(board, opts = {}) {
  const cfg = opts.cfg || CONFIG;
  const mods = mergeMods(opts.mods);
  const week = opts.week || 1;
  const seed = opts.seed ?? 1;
  // Every roll is keyed by the traveller making it (their spawn slot, not
  // their number in the week) and what it decides, so a board change only
  // re-rolls the travellers it actually touches (see mix in rng.js).
  const seedHash = hashString(String(seed));
  const R = { tier: 1, bias: 2, kind: 3, door: 4, dest: 5, wp: 6, walk: 7, svc: 8, loop: 9, pdest: 10, tr: 11 };
  // A roll is a hash of the traveller and the question. Stratified, the
  // traveller's slot walks the unit interval in golden-ratio steps and the
  // question only offsets it, so slot after slot covers the dice evenly.
  const PHI = 0.6180339887498949;
  const strat = !!cfg.sim.stratify;
  const roll = (a, tag, x = 0, y = 0) => strat ? (a.ord * PHI + mix(seedHash, a.grp, tag, x, y)) % 1 : mix(seedHash, a.h, tag, x, y);
  const TICKS = mods.ticks || cfg.sim.ticks;
  const SPAWN_TICKS = mods.spawnTicks || cfg.sim.spawnTicks;
  const W = board.w, H = board.h, N = W * H;
  const tierMatchTable = mods.tierMatch || cfg.sim.tierMatch;

  // ---- walk maps (checkpoint booths closed / open)
  const walkBase = buildWalkMap(board);
  const passClosed = new Uint8Array(N), passOpen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const v = walkBase[i];
    passOpen[i] = (v === 0 || v === 2 || v === 3 || v === 5) ? 1 : 0;
    passClosed[i] = (v === 0 || v === 2 || v === 5) ? 1 : 0;
  }
  const isWalkway = i => walkBase[i] === 2;
  const isGateCell = i => walkBase[i] === 3;
  const hasGate = board.tiles.some(t => t.key === 'gate');
  const ckCfg = cfg.sim.checkpoint;
  // Checkpoint fences run between cells, so they are a per-step rule rather
  // than a blocked cell: blocked[i] has bit d set when step DIRS[d] out of
  // cell i crosses a fence.
  const blocked = new Uint8Array(N);
  if (hasGate) {
    const fences = checkpointFences(board);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      for (let d = 0; d < 8; d++) if (fenceBlocked(fences, W, H, x, y, DIRS[d][0], DIRS[d][1])) blocked[y * W + x] |= 1 << d;
    }
  }
  // Clearing a booth multiplies a traveller's value and adds stop budget; an
  // upgraded booth multiplies more.
  const booths = new Map();
  for (const t of board.tiles) if (t.key === 'gate') {
    const mult = ckCfg.mult + ckCfg.multPerLevel * ((t.level || 1) - 1);
    for (const [x, y] of t.cells) booths.set(y * W + x, { tile: t, mult, bonus: ckCfg.budgetBonus });
  }

  // ---- tiles
  const transports = [], amenities = [], waitingAreas = [], security = [];
  const tileStats = {};
  for (const t of board.tiles) {
    tileStats[t.id] = { id: t.id, name: t.name, key: t.key, kind: t.kind, serves: 0, balks: 0, revenue: 0, points: 0, spawned: 0, boarded: 0, stranded: 0, lost: 0, occ: new Int16Array(TICKS + 1), fullTicks: 0, cap: 0 };
    if (t.kind === 'bridge') continue;
    const doors = doorCells(board, t, passOpen, blocked);
    if (t.kind === 'transport') {
      transports.push({ tile: t, e: effTransport(t, mods, cfg, wifiStrength(board, t.cells, cfg)), doors, idx: transports.length, spawned: 0 });
    } else {
      const def = tileDef(t.key);
      // Its radius grows only through the Extra Patrol upgrade's radiusBonus,
      // so `def.radius + radiusBonus` is the one formula the UI shares.
      if (def.special === 'security') { security.push({ tile: t, distMap: chebyshevMap(board, t.cells), radius: def.radius + (t.radiusBonus || 0) }); continue; }
      if (def.special === 'walkway' || def.special === 'gate' || def.special === 'wifi') continue;
      const distMap = chebyshevMap(board, t.cells);
      // A walk-through amenity (a park) is reached by stepping onto it, not
      // just by standing at its door.
      const targets = def.walkable ? t.cells.concat(doors) : doors;
      const rec = { tile: t, def, doors, targets, distMap, occ: 0, idx: amenities.length, e: effAmenity(t, mods, cfg, wifiStrength(board, t.cells, cfg)) };
      tileStats[t.id].cap = rec.e.cap;
      if (def.special === 'waiting') waitingAreas.push(rec); else amenities.push(rec);
    }
  }
  const activeTransports = transports.filter(t => !t.e.offline && t.doors.length > 0);

  // ---- distance fields (memoized)
  const fields = new Map();
  function field(key, targets, gateOpen) {
    const k = key + (gateOpen ? ':o' : ':c');
    let f = fields.get(k);
    if (f) return f;
    const pass = gateOpen ? passOpen : passClosed;
    f = new Float32Array(N).fill(INF);
    const heap = new Heap();
    for (const c of targets) { const i = c[1] * W + c[0]; if (pass[i]) { f[i] = 0; heap.push(0, i); } }
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > f[i]) continue;
      const x = i % W, y = (i - x) / W;
      for (let di = 0; di < 8; di++) {
        const [dx, dy] = DIRS[di];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!pass[ni] || (blocked[i] & (1 << di))) continue;
        if (dx && dy && !(pass[y * W + nx] && pass[ny * W + x])) continue; // no corner cutting
        const cost = isWalkway(i) ? 0.5 : 1; // cheap to leave a walkway cell => walkways attract paths
        const nd = d + cost;
        if (nd < f[ni]) { f[ni] = nd; heap.push(nd, ni); }
      }
    }
    fields.set(k, f);
    return f;
  }
  const transportField = (ti, g) => field('T' + ti, transports[ti].doors, g);
  const cellField = (x, y, g) => field('C' + x + ',' + y, [[x, y]], g);
  const amenityField = (ai, g) => field('A' + ai, amenities[ai].targets, g);
  // Shortest walk from an amenity's door on to a platform, for the time check.
  const returns = new Map();
  function returnDist(ai, ti, g) {
    const k = ai + ':' + ti + (g ? ':o' : ':c');
    let d = returns.get(k);
    if (d === undefined) {
      const f = transportField(ti, g);
      d = INF;
      for (const [x, y] of amenities[ai].targets) d = Math.min(d, f[y * W + x]);
      returns.set(k, d);
    }
    return d;
  }
  const hurry = cfg.sim.hurry || { enabled: false, slack: 0 };

  // reachability between transports: 0 none, 1 direct, 2 via gate
  const reach = transports.map(() => new Int8Array(transports.length));
  for (let a = 0; a < transports.length; a++) {
    if (!transports[a].doors.length) continue;
    const [sx, sy] = transports[a].doors[0];
    for (let b = 0; b < transports.length; b++) {
      if (!transports[b].doors.length) continue;
      if (transportField(b, false)[sy * W + sx] < INF) reach[a][b] = 1;
      else if (hasGate && transportField(b, true)[sy * W + sx] < INF) reach[a][b] = 2;
    }
  }

  // ---- state
  const agents = [];
  const live = [];
  const heat = new Float32Array(N);
  let score = 0, fares = 0, revenue = 0, banked = 0, strandedPts = 0, stolen = 0;
  // score credited on each tick, so the UI can fill the week's stars during playback
  const scoreByTick = new Array(TICKS + 1).fill(0);
  let best = null;
  const counts = { spawned: 0, boarded: 0, stranded: 0, lost: 0, pickpockets: 0, removed: 0, looped: 0 };
  const dw = cfg.destinationWeights;
  // The crime wave phases in over `pickpocketRamp` weeks rather than landing
  // at full strength the week it is announced.
  const crimeAge = week - cfg.run.pickpocketsFromWeek + 1;
  const pickRate = mods.pickpocketRate != null ? mods.pickpocketRate
    : (crimeAge > 0 ? cfg.sim.pickpocketRate * Math.min(1, crimeAge / cfg.sim.pickpocketRamp) : 0);

  function destWeight(travTier, transTier) {
    const gap = travTier - transTier;
    if (gap === 0) return dw.same;
    if (gap === 1) return dw.down1;
    if (gap === -1) return dw.up1;
    if (gap === 2) return dw.down2;
    if (gap === -2) return dw.up2;
    return dw.far;
  }

  // A traveller picks where they want to go, whether or not you have left them
  // a way to get there. Walling a platform off does not redirect the crowd - it
  // strands them (see `lost`), which is what makes boxing people in a mistake.
  function chooseDest(a, originIdx, tier) {
    const t = Math.min(5, tier + mods.destTierShift);
    const cands = [];
    for (let b = 0; b < transports.length; b++) if (transports[b].doors.length) cands.push(b);
    if (!cands.length) return originIdx;
    return weightedOf(roll(a, R.dest), cands, b => destWeight(t, transports[b].e.tier));
  }

  function snapCell(fx, fy, f) {
    // nearest cell (Chebyshev spiral) that is reachable in field f
    const cx = Math.max(0, Math.min(W - 1, Math.round(fx)));
    const cy = Math.max(0, Math.min(H - 1, Math.round(fy)));
    for (let r = 0; r < Math.max(W, H); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (f[y * W + x] < INF) return [x, y];
      }
    }
    return null;
  }

  // `leg` numbers the wander so a lost traveller's top-ups roll fresh points.
  function makeWaypoints(a, sx, sy, destIdx, gateOpen, same, leg = 0) {
    const f = transportField(destIdx, gateOpen);
    const doors = transports[destIdx].doors;
    const [dx, dy] = doors[Math.floor(doors.length / 2)];
    const wps = [];
    const n = cfg.sim.waypointCount;
    for (let i = 0; i < n; i++) {
      let px, py;
      const k = leg * n + i;
      const g1 = gaussOf(roll(a, R.wp, k, 0), roll(a, R.wp, k, 1)), g2 = gaussOf(roll(a, R.wp, k, 2), roll(a, R.wp, k, 3));
      if (same) {
        const s = cfg.sim.sameTileWanderSigma;
        px = sx + g1 * s; py = sy + g2 * s;
      } else {
        const lo = (i + 0.15) / n, hi = (i + 0.85) / n;
        const t = lo + roll(a, R.wp, k, 4) * (hi - lo);
        const s = cfg.sim.waypointSigma;
        px = sx + (dx - sx) * t + g1 * s;
        py = sy + (dy - sy) * t + g2 * s;
      }
      const c = snapCell(px, py, f);
      if (c) wps.push(c);
    }
    return wps;
  }

  // Top up a lost traveller's wander so they keep circulating instead of
  // freezing on the spot. Returns false for anyone with a route to follow.
  function wanderOn(a, t) {
    if (!a.lost || t > TICKS) return false;
    const wps = makeWaypoints(a, a.x, a.y, a.origin, a.gateOpen, true, ++a.legs);
    for (const [wx, wy] of wps) a.targets.push({ kind: 'wp', x: wx, y: wy });
    return a.ti < a.targets.length;
  }

  // A traveller's dice are their spawn slot: `grp` is the group they were
  // spawned in (a transport, the charter, the VIPs) and `ord` their number in
  // it, so the same slot rolls the same whatever else is on the board.
  // `tier` may be a function of the slot.
  function spawnAgent(grp, ord, originIdx, tier, kind, extra = {}) {
    const key = grp + ':' + ord;
    const slot = { key, grp: hashString(grp), ord, h: hashString(key) };
    if (typeof tier === 'function') tier = tier(slot);
    if (kind === 'roll') kind = pickRate > 0 && roll(slot, R.kind) < pickRate ? 'pickpocket' : 'traveller';
    const tr = transports[originIdx];
    const door = tr.doors[Math.floor(roll(slot, R.door) * tr.doors.length)];
    const id = agents.length;
    let destIdx = originIdx, gateOpen = false;
    if (kind === 'pickpocket') {
      const opts = transports.filter((_, i) => i !== originIdx && reach[originIdx][i]).map(t => t.idx).concat(originIdx);
      destIdx = transports.length > 1 ? opts[Math.floor(roll(slot, R.pdest) * opts.length)] : originIdx;
      gateOpen = true;
    } else {
      destIdx = chooseDest(slot, originIdx, tier);
      // An open checkpoint lets anyone through to whatever is on the far side;
      // a filtering one only admits travellers whose platform is over there.
      gateOpen = hasGate && (!ckCfg.filter || reach[originIdx][destIdx] === 2);
    }
    const lost = kind !== 'pickpocket' && !reach[originIdx][destIdx];
    const tierInfo = cfg.tiers[tier - 1];
    const a = {
      id, ...slot, tier, kind, origin: originIdx, dest: destIdx, x: door[0], y: door[1], legs: 0,
      value: extra.value ?? tierInfo.base, budget: tierInfo.budget + mods.stopBudgetBonus + (extra.budgetBonus || 0), cleared: false,
      served: new Set(), balked: new Set(), chain: [], state: 'walking', spawnTick: currentTick, endTick: null,
      frames: [[door[0], door[1]]], events: [], targets: [], ti: 0, serve: null, serveTicks: 0, arrivedTick: -1,
      waitSlot: null, stacks: 0, gateOpen, robbed: new Set(), outcome: null, stuck: 0, serveDoor: null, lost, booth: null,
      miss: new Float32Array(amenities.length).fill(1),
    };
    // A lost traveller has no route to follow, so they wander the concourse
    // looking for a way through and never reach a platform.
    const same = destIdx === originIdx;
    for (const [wx, wy] of makeWaypoints(a, a.x, a.y, lost ? originIdx : destIdx, gateOpen, same || lost)) a.targets.push({ kind: 'wp', x: wx, y: wy });
    if (!lost) a.targets.push({ kind: 'dest', idx: destIdx });
    agents.push(a); live.push(a);
    counts.spawned++;
    if (kind === 'pickpocket') counts.pickpockets++;
    tileStats[tr.tile.id].spawned++;
    return a;
  }

  function targetField(a, tg) {
    if (tg.kind === 'wp') return cellField(tg.x, tg.y, a.gateOpen);
    if (tg.kind === 'dest') return transportField(tg.idx, a.gateOpen);
    return amenityField(tg.idx, a.gateOpen);
  }

  // Move one step toward the current target. Returns true if target reached.
  function stepToward(a, f) {
    const i = a.y * W + a.x;
    const here = f[i];
    if (here === 0) return true;
    if (here >= INF) return false;
    const pass = a.gateOpen ? passOpen : passClosed;
    let bestD = here, cands = [];
    for (let di = 0; di < 8; di++) {
      const [dx, dy] = DIRS[di];
      const nx = a.x + dx, ny = a.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!pass[ni] || (blocked[i] & (1 << di))) continue;
      if (dx && dy && !(pass[a.y * W + nx] && pass[ny * W + a.x])) continue;
      const d = f[ni];
      if (d < bestD - 1e-6) { bestD = d; cands = [ni]; }
      else if (Math.abs(d - bestD) < 1e-6 && d < here) cands.push(ni);
    }
    if (!cands.length) return false;
    const ni = cands.length === 1 ? cands[0] : cands[Math.floor(roll(a, R.walk, i) * cands.length)];
    a.x = ni % W; a.y = (ni - a.x) / W;
    heat[ni] += 1;
    // clearing a checkpoint booth: a chain link and extra stop budget, once per traveller
    const bo = a.kind === 'traveller' && !a.cleared ? booths.get(ni) : null;
    if (bo) {
      const before = a.value;
      a.cleared = true; a.budget += bo.bonus;
      const st = tileStats[bo.tile.id];
      st.serves++;
      if (ckCfg.atExit) a.booth = bo;   // credited when they board (see board_)
      else {
        a.value *= bo.mult; st.points += a.value - before;
        a.chain.push({ name: bo.tile.name, tileId: bo.tile.id, before, after: a.value, mult: bo.mult, flat: 0 });
      }
      a.events.push({ t: currentTick, type: 'cleared', tileId: bo.tile.id, mult: bo.mult, value: a.value });
    }
    return f[ni] === 0;
  }

  function applyService(a, am, t) {
    const e = am.e;
    const before = a.value;
    a.value = a.value * e.mult + e.flat;
    if (e.def.special === 'green') a.budget += cfg.sim.greenSpaceBudgetRestore; else a.budget -= 1;
    a.served.add(am.idx);
    const st = tileStats[am.tile.id];
    st.serves++; st.revenue += e.revenue; st.points += a.value - before;
    revenue += e.revenue;
    a.chain.push({ name: am.tile.name, tileId: am.tile.id, before, after: a.value, mult: e.mult, flat: e.flat });
    a.events.push({ t, type: 'serve', tileId: am.tile.id, value: a.value, mult: e.mult, flat: e.flat });
  }

  // Ticks the rest of a traveller's route takes: each waypoint in turn, then
  // the platform. INF when a leg is unreachable.
  function routeLeft(a) {
    let x = a.x, y = a.y, d = 0;
    for (let k = a.ti; k < a.targets.length; k++) {
      const tg = a.targets[k];
      d += targetField(a, tg)[y * W + x];
      if (tg.kind !== 'wp') break;
      x = tg.x; y = tg.y;
    }
    return d;
  }

  function serviceRolls(a, t) {
    if (a.budget <= 0) return;
    const i = a.y * W + a.x;
    const left = TICKS - t - hurry.slack;
    const inRange = [];
    for (const am of amenities) {
      if (am.e.closed || am.e.rate <= 0) continue;
      const d = am.distMap[i];
      // standing on a walk-through amenity (a park) counts as being beside it
      if ((d < 1 && !am.e.walkable) || d > am.e.radius) continue;
      if (a.served.has(am.idx)) continue;
      const walk = amenityField(am.idx, a.gateOpen)[i];
      if (walk >= INF) continue; // walled off: no path to its door
      // no time to shop and still make the platform: walk on
      if (hurry.enabled && !a.lost && walk + am.e.dur + returnDist(am.idx, a.dest, a.gateOpen) > left) continue;
      inRange.push([d, am]);
    }
    if (!inRange.length) return;
    inRange.sort((p, q) => p[0] - q[0] || p[1].idx - q[1].idx);
    for (const [d, am] of inRange) {
      const e = am.e;
      const gap = e.special === 'anytier' ? 0 : Math.abs(a.tier - e.tier);
      const tm = tierMatchTable[Math.min(gap, tierMatchTable.length - 1)];
      const fall = e.radius <= 1 || d <= 1 ? 1 : 1 - ((d - 1) / (e.radius - 1)) * (1 - cfg.sim.radiusFalloffMin);
      const p = e.rate * tm * fall;
      // One die per traveller and shop, thrown once: the pull accumulates cell
      // by cell (1 - the chance of having missed at every cell so far) and the
      // traveller stops at the first cell where it passes their throw. Cell by
      // cell that is the same odds as a fresh roll at each, but a whole
      // transport's travellers now share one evenly spread set of throws.
      const miss = a.miss[am.idx] * (1 - p);
      a.miss[am.idx] = miss;
      if (1 - miss < roll(a, R.svc, am.tile.id)) continue;
      if (am.occ >= e.cap) {
        if (!a.balked.has(am.idx)) { a.balked.add(am.idx); tileStats[am.tile.id].balks++; }
        continue;
      }
      // hit: reserve and detour
      am.occ++;
      a.state = 'detour';
      a.serve = am;
      a.events.push({ t, type: 'detour', tileId: am.tile.id });
      return;
    }
  }

  function beginService(a, t) {
    const am = a.serve;
    applyService(a, am, t);
    a.serveTicks = am.e.dur;
    a.state = 'serving';
    if (a.serveTicks <= 0) { endService(a); return; }
    // step inside: stand on the amenity cell nearest the door for the duration
    a.serveDoor = [a.x, a.y];
    let best = null, bd = 99;
    for (const [cx, cy] of am.tile.cells) { const d = Math.max(Math.abs(cx - a.x), Math.abs(cy - a.y)); if (d < bd) { bd = d; best = [cx, cy]; } }
    if (best) { a.x = best[0]; a.y = best[1]; }
  }
  function endService(a) {
    a.serve.occ--;
    a.serve = null;
    a.state = 'walking';
    if (a.serveDoor) { a.x = a.serveDoor[0]; a.y = a.serveDoor[1]; a.serveDoor = null; }
  }

  function board_(a, t) {
    const tr = transports[a.dest];
    const e = tr.e;
    const before = a.value;
    let v = a.value * e.mult + e.flat;
    let tierBonus = 1;
    if (a.tier === e.tier) { tierBonus = cfg.sim.tierMatchExitBonus; v *= tierBonus; }
    if (a.booth) {
      const bv = v * a.booth.mult;
      a.chain.push({ name: a.booth.tile.name, tileId: a.booth.tile.id, before: v, after: bv, mult: a.booth.mult, flat: 0 });
      tileStats[a.booth.tile.id].points += bv - v;
      v = bv; a.booth = null;
    }
    let waitMult = 1;
    if (a.waitSlot) {
      waitMult = 1 + a.stacks * a.waitSlot.e.stackValue;
      v *= waitMult;
      a.waitSlot.occ--;
      a.chain.push({ name: a.waitSlot.tile.name, tileId: a.waitSlot.tile.id, before: a.value, after: v, mult: waitMult, flat: 0, stacks: a.stacks });
      tileStats[a.waitSlot.tile.id].points += (v - a.value);
      a.waitSlot = null;
    }
    a.value = v;
    a.chain.push({ name: tr.tile.name + ' (exit)', tileId: tr.tile.id, before, after: v, mult: e.mult * tierBonus, flat: e.flat, exit: true });
    const fare = cfg.tiers[a.tier - 1].fare * mods.fareMult * cfg.economy.fareScale;
    fares += fare;
    score += v; banked += v; scoreByTick[t] += v;
    const st = tileStats[tr.tile.id];
    st.boarded++; st.points += v; st.revenue += fare;
    counts.boarded++;
    a.outcome = 'boarded'; a.state = 'done'; a.endTick = t;
    a.events.push({ t, type: 'board', tileId: tr.tile.id, value: v });
    if (!best || v > best.value) best = { id: a.id, tier: a.tier, value: v, chain: a.chain.slice(), origin: transports[a.origin].tile.name, dest: tr.tile.name };
    // Loop terminal: re-enter with chain intact
    if (e.def.special === 'loop' && t <= SPAWN_TICKS && roll(a, R.loop) < e.def.loopChance) {
      counts.looped++;
      const na = spawnAgent(a.key + ':loop', 0, a.dest, a.tier, 'traveller', { value: v });
      na.events.push({ t, type: 'loop' });
    }
  }

  let currentTick = 0;
  const vipDone = { done: false };

  // extra spawns (Charter Bus etc.) spread across the first spawn ticks
  const extraQueue = [];
  for (const ex of mods.extraSpawns) for (let i = 0; i < ex.count; i++) extraQueue.push({ tier: ex.tier, tick: 1 + (i % Math.min(8, SPAWN_TICKS)) });

  for (let t = 1; t <= TICKS; t++) {
    currentTick = t;
    // ---- spawns
    if (t <= SPAWN_TICKS && activeTransports.length) {
      for (const tr of activeTransports) {
        if ((t - 1) % tr.e.arr !== 0) continue;
        for (let n = 0; n < tr.e.batch; n++) {
          const tierOf = slot => {
            let tier = tr.e.tier;
            const r = roll(slot, R.tier);
            const sp = cfg.sim.tierSpread;
            if (r < sp.down) tier = Math.max(1, tier - 1); else if (r < sp.down + sp.up) tier = Math.min(5, tier + 1);
            if (mods.lowTierBias && tier > 2 && roll(slot, R.bias, 0) < mods.lowTierBias) tier = roll(slot, R.bias, 1) < 0.5 ? 1 : 2;
            return tier;
          };
          spawnAgent('T' + tr.tile.id, tr.spawned++, tr.idx, tierOf, 'roll');
        }
      }
      const pickTr = slot => activeTransports[Math.floor(roll(slot, R.tr) * activeTransports.length)].idx;
      const slotOf = (grp, ord) => ({ grp: hashString(grp), ord, h: hashString(grp + ':' + ord) });
      let xi = 0;
      for (const ex of extraQueue) { if (ex.tick === t) spawnAgent('X', xi, pickTr(slotOf('X', xi)), ex.tier, 'traveller'); xi++; }
      if (t === 1 && mods.vipCount > 0 && !vipDone.done) {
        vipDone.done = true;
        for (let i = 0; i < mods.vipCount; i++) spawnAgent('V', i, pickTr(slotOf('V', i)), 5, 'traveller', { budgetBonus: mods.vipBudgetBonus });
      }
    }

    // ---- agent updates
    for (let li = 0; li < live.length; li++) {
      const a = live[li];
      if (a.state === 'done') continue;
      if (a.spawnTick === t && a.frames.length === 1) { /* spawned this tick; still acts */ }

      if (a.kind === 'pickpocket') {
        updatePickpocket(a, t);
        continue;
      }

      if (a.state === 'serving') {
        a.serveTicks--;
        if (a.serveTicks <= 0) endService(a);
      } else if (a.state === 'walking' || a.state === 'detour') {
        // Late in the week the wander no longer fits: head straight for the platform.
        if (hurry.enabled && a.state === 'walking' && !a.lost && a.targets[a.ti] && a.targets[a.ti].kind === 'wp' && t + routeLeft(a) + hurry.slack > TICKS) {
          a.ti = a.targets.length - 1; a.events.push({ t, type: 'hurry' });
        }
        const onWalkway = isWalkway(a.y * W + a.x);
        const steps = onWalkway ? cfg.sim.walkwaySpeed : 1;
        let moved = false;
        for (let s = 0; s < steps && (a.state === 'walking' || a.state === 'detour'); s++) {
          // One service roll per cell travelled, so riding a walkway passes the
          // same shops as walking it - twice as fast.
          if (s > 0 && a.state === 'walking') serviceRolls(a, t);
          const tg = a.state === 'detour' ? { kind: 'am', idx: a.serve.idx } : a.targets[a.ti];
          const f = targetField(a, tg);
          const px = a.x, py = a.y;
          const reached = stepToward(a, f);
          if (a.x !== px || a.y !== py) moved = true;
          if (reached) {
            if (a.state === 'detour') { beginService(a, t); break; }
            a.ti++;
            if (a.ti >= a.targets.length) { if (!wanderOn(a, t)) { a.state = 'waiting'; a.arrivedTick = t; a.events.push({ t, type: 'arrive' }); } break; }
          } else if (!moved && f[a.y * W + a.x] >= INF) {
            // unreachable target: skip it
            if (a.state === 'detour') { a.served.add(a.serve.idx); a.serve.occ--; a.serve = null; a.state = 'walking'; }
            else { a.ti++; if (a.ti >= a.targets.length && !wanderOn(a, t)) { a.state = 'waiting'; a.arrivedTick = t; } }
            break;
          } else if (!moved) {
            // stuck (no descending neighbour) - drop this target
            if (a.state === 'detour') { a.serve.occ--; a.serve = null; a.state = 'walking'; }
            else { a.ti++; if (a.ti >= a.targets.length && !wanderOn(a, t)) { a.state = 'waiting'; a.arrivedTick = t; } }
            break;
          }
        }
        if (a.state === 'walking') serviceRolls(a, t);
      }

      if (a.state === 'waiting' && !a.lost) {
        // A lost traveller can never reach a platform, so they never board.
        // waiting areas
        const i = a.y * W + a.x;
        for (const wa of waitingAreas) {
          const d = wa.distMap[i];
          if (d > wa.e.radius) continue;
          if (a.waitSlot === null) {
            if (a.tier < wa.e.minTier || wa.e.closed) continue;
            if (wa.occ >= wa.e.cap) { if (!a.balked.has('w' + wa.idx)) { a.balked.add('w' + wa.idx); tileStats[wa.tile.id].balks++; } continue; }
            wa.occ++; a.waitSlot = wa; a.stacks = 0;
            tileStats[wa.tile.id].serves++; tileStats[wa.tile.id].revenue += wa.e.revenue; revenue += wa.e.revenue;
            a.events.push({ t, type: 'lounge', tileId: wa.tile.id });
          }
          if (a.waitSlot === wa) {
            const cap = cfg.tiers[a.tier - 1].waitCap;
            if (a.stacks < cap) { a.stacks++; a.events.push({ t, type: 'stack', tileId: wa.tile.id, stacks: a.stacks }); }
          }
        }
        const tr = transports[a.dest];
        const lastCall = cfg.sim.lastCallDeparture && t === TICKS;
        if ((t >= a.arrivedTick + tr.e.dwell && t % tr.e.dep === 0) || lastCall) board_(a, t);
      }
    }

    // ---- frames + occupancy
    for (const a of live) {
      if (a.state === 'done' && a.endTick < t) continue;
      a.frames.push([a.x, a.y]);
    }
    for (const am of amenities) { const s = tileStats[am.tile.id]; s.occ[t] = am.occ; if (am.occ >= am.e.cap) s.fullTicks++; }
    for (const wa of waitingAreas) { const s = tileStats[wa.tile.id]; s.occ[t] = wa.occ; if (wa.occ >= wa.e.cap) s.fullTicks++; }
    // prune done agents from live list
    for (let li = live.length - 1; li >= 0; li--) if (live[li].state === 'done' && live[li].endTick < t) live.splice(li, 1);
  }

  function updatePickpocket(a, t) {
    const i0 = a.y * W + a.x;
    const tg = a.targets[a.ti];
    if (!tg) {
      // choose a new destination
      const opts = transports.filter((_, i) => reach[a.origin][i] || i === a.origin);
      a.dest = opts[Math.floor(roll(a, R.pdest, ++a.legs) * opts.length)].idx;
      a.targets = [{ kind: 'dest', idx: a.dest }]; a.ti = 0;
    }
    const f = targetField(a, a.targets[a.ti]);
    const reached = stepToward(a, f);
    const i = a.y * W + a.x;
    if (isGateCell(i) || security.some(p => p.distMap[i] <= p.radius)) {
      a.state = 'done'; a.outcome = 'removed'; a.endTick = t; counts.removed++;
      a.events.push({ t, type: 'removed' });
      return;
    }
    if (reached || i === i0) { a.ti++; if (a.ti >= a.targets.length) { a.targets = []; a.ti = 0; } }
    // rob adjacent travellers
    for (const v of live) {
      if (v.kind !== 'traveller' || v.state === 'done' || a.robbed.has(v.id)) continue;
      if (Math.abs(v.x - a.x) <= 1 && Math.abs(v.y - a.y) <= 1) {
        a.robbed.add(v.id);
        const loss = v.value * cfg.sim.pickpocketSteal;
        v.value -= loss; stolen += loss;
        v.events.push({ t, type: 'robbed', value: v.value, loss });
        a.events.push({ t, type: 'steal' });
      }
    }
  }

  // ---- end of week: strand everyone still on the board
  for (const a of agents) {
    if (a.state === 'done') continue;
    a.endTick = TICKS;
    if (a.kind === 'pickpocket') { a.outcome = 'left'; a.state = 'done'; continue; }
    const v = a.value * (a.lost ? cfg.economy.lostMultiplier : cfg.economy.strandedMultiplier);
    score += v; strandedPts += v; scoreByTick[TICKS] += v;
    if (a.lost) { counts.lost++; tileStats[transports[a.origin].tile.id].lost++; }
    else { counts.stranded++; tileStats[transports[a.dest].tile.id].stranded++; }
    if (a.waitSlot) { a.waitSlot.occ--; a.waitSlot = null; }
    if (a.serve) { a.serve.occ--; a.serve = null; }
    a.outcome = a.lost ? 'lost' : 'stranded'; a.state = 'done';
    a.events.push({ t: TICKS, type: a.lost ? 'lost' : 'strand', value: v });
  }

  for (const id in tileStats) {
    const s = tileStats[id];
    s.saturation = s.cap > 0 ? s.fullTicks / TICKS : 0;
  }

  // running total, so scoreByTick[t] is the score on the board at tick t
  for (let t = 1; t <= TICKS; t++) scoreByTick[t] += scoreByTick[t - 1];
  for (let t = 0; t <= TICKS; t++) scoreByTick[t] = Math.round(scoreByTick[t]);

  return {
    seed, week, ticks: TICKS, spawnTicks: SPAWN_TICKS,
    score: Math.round(score),
    points: { banked: Math.round(banked), stranded: Math.round(strandedPts), stolen: Math.round(stolen) },
    scoreByTick,
    money: { fares: Math.round(fares), revenue: Math.round(revenue), total: Math.round(fares + revenue) },
    counts, best,
    agents: agents.map(a => ({ id: a.id, key: a.key, tier: a.tier, kind: a.kind, spawnTick: a.spawnTick, endTick: a.endTick, frames: a.frames, events: a.events, value: a.value, outcome: a.outcome, origin: transports[a.origin].tile.id, dest: transports[a.dest].tile.id, chain: a.chain })),
    tileStats,
    heat,
    w: W, h: H,
  };
}

// walkable cells 8-adjacent to a tile, not across a checkpoint fence
function doorCells(board, tile, pass, blocked) {
  const W = board.w, H = board.h;
  const set = new Set(), out = [];
  const own = new Set(tile.cells.map(([x, y]) => y * W + x));
  for (const [x, y] of tile.cells) {
    for (let di = 0; di < 8; di++) {
      const [dx, dy] = DIRS[di];
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (own.has(i) || set.has(i) || !pass[i] || (blocked[y * W + x] & (1 << di))) continue;
      set.add(i); out.push([nx, ny]);
    }
  }
  return out;
}

function chebyshevMap(board, cells) {
  const W = board.w, H = board.h;
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d = 255;
    for (const [cx, cy] of cells) d = Math.min(d, Math.max(Math.abs(cx - x), Math.abs(cy - y)));
    m[y * W + x] = d;
  }
  return m;
}
