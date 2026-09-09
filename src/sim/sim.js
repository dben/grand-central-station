// ============================================================================
// Headless, deterministic week simulator.
// Input: board + modifiers + seed. Output: score, money, per-agent tracks,
// per-tile stats, heatmap. No DOM. Runs in Node and the browser.
// ============================================================================
import { CONFIG } from '../config.js';
import { tileDef } from '../data/tiles.js';
import { makeStreams } from './rng.js';
import { buildWalkMap } from './board.js';

const INF = 1e9;

export const DEFAULT_MODS = {
  batchMult: 1, dwellMult: 1, dwellAdd: 0, cadenceDiv: 1, lowTierBias: 0,
  vipCount: 0, vipBudgetBonus: 0, offlineTerrains: [], offlineTags: [], strikeTerrain: null,
  closedBelowLevel: 0, rateBonusTags: {}, destTierShift: 0, stopBudgetBonus: 0,
  extraSpawns: [], fareMult: 1, grandOpeningTileId: null, tierMatch: null,
  transportMultBonus: 0, amenityMultBonus: 0, capacityMult: 1, revenueMult: 1, flatMult: 1,
  ticks: null, spawnTicks: null, walkableLanes: false, pickpocketRate: null,
};

export function mergeMods(...list) {
  const out = { ...DEFAULT_MODS };
  for (const m of list) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (v === undefined || v === null) continue;
      if (k === 'batchMult' || k === 'dwellMult' || k === 'fareMult' || k === 'capacityMult' || k === 'revenueMult' || k === 'flatMult') out[k] *= v;
      else if (k === 'dwellAdd' || k === 'stopBudgetBonus' || k === 'transportMultBonus' || k === 'amenityMultBonus' || k === 'destTierShift' || k === 'vipCount' || k === 'vipBudgetBonus') out[k] += v;
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
export function effTransport(tile, mods = DEFAULT_MODS, cfg = CONFIG) {
  const def = tileDef(tile.key);
  const lvl = (tile.level || 1) - 1;
  const up = cfg.upgrades.transport;
  const arrBase = tile.arrOverride || def.arr;
  const tags = def.tags || [];
  const offline = mods.offlineTerrains.includes(def.terrain) || tags.some(t => mods.offlineTags.includes(t)) || mods.strikeTerrain === def.terrain;
  return {
    def, tier: def.tier,
    batch: Math.max(1, Math.round(def.batch * (1 + up.batch * lvl) * mods.batchMult)),
    mult: def.mult + up.mult * lvl + mods.transportMultBonus,
    flat: def.flat * mods.flatMult,
    arr: Math.max(1, Math.ceil(arrBase / mods.cadenceDiv)),
    dep: Math.max(1, Math.ceil(def.dep / mods.cadenceDiv)),
    dwell: Math.round(def.dwell * mods.dwellMult + mods.dwellAdd),
    offline,
  };
}

export function effAmenity(tile, mods = DEFAULT_MODS, cfg = CONFIG, wifiBonus = 0) {
  const def = tileDef(tile.key);
  const lvl = (tile.level || 1) - 1;
  const up = cfg.upgrades.amenity;
  const tags = def.tags || [];
  let rate = def.rate > 0 ? def.rate + up.rate * lvl + wifiBonus : 0;
  for (const t of tags) if (mods.rateBonusTags[t]) rate += mods.rateBonusTags[t];
  if (mods.grandOpeningTileId === tile.id) rate = 1;
  const isService = def.rate > 0;
  return {
    def, tier: def.tier, special: def.special || null,
    rate: Math.min(1, rate),
    mult: isService ? def.mult + up.mult * lvl + mods.amenityMultBonus : 1,
    flat: def.flat * mods.flatMult,
    cap: Math.max(1, Math.round(def.cap * (1 + up.capacity * lvl) * mods.capacityMult)),
    dur: def.dur,
    revenue: def.revenue * (1 + up.revenue * lvl) * mods.revenueMult * cfg.economy.revenueScale,
    radius: def.radius + (tile.radiusBonus || 0),
    closed: mods.closedBelowLevel > 0 && isService && (tile.level || 1) < mods.closedBelowLevel,
    stackValue: def.stackValue || (def.key === 'flier_club' ? cfg.sim.frequentFlierStackValue : cfg.sim.waitingStackValue),
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

export function simulateWeek(board, opts = {}) {
  const cfg = opts.cfg || CONFIG;
  const mods = mergeMods(opts.mods);
  const week = opts.week || 1;
  const seed = opts.seed ?? 1;
  const rng = makeStreams(seed, ['spawn', 'dest', 'service', 'waypoint', 'walk', 'pick', 'loop']);
  const TICKS = mods.ticks || cfg.sim.ticks;
  const SPAWN_TICKS = mods.spawnTicks || cfg.sim.spawnTicks;
  const W = board.w, H = board.h, N = W * H;
  const tierMatchTable = mods.tierMatch || cfg.sim.tierMatch;

  // ---- walk maps (gate closed / open)
  const walkBase = buildWalkMap(board, { walkableLanes: mods.walkableLanes });
  const passClosed = new Uint8Array(N), passOpen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const v = walkBase[i];
    passOpen[i] = (v === 0 || v === 2 || v === 3) ? 1 : 0;
    passClosed[i] = (v === 0 || v === 2) ? 1 : 0;
  }
  const isWalkway = i => walkBase[i] === 2;
  const isGateCell = i => walkBase[i] === 3;
  const hasGate = board.tiles.some(t => t.key === 'gate');

  // ---- tiles
  const transports = [], amenities = [], waitingAreas = [], wifis = [];
  let kioskCount = 0;
  const tileStats = {};
  for (const t of board.tiles) {
    tileStats[t.id] = { id: t.id, name: t.name, key: t.key, kind: t.kind, serves: 0, balks: 0, revenue: 0, points: 0, spawned: 0, boarded: 0, stranded: 0, occ: new Int16Array(TICKS + 1), fullTicks: 0, cap: 0 };
    if (t.kind === 'bridge') continue;
    const doors = doorCells(board, t, passOpen);
    if (t.kind === 'transport') {
      const e = effTransport(t, mods, cfg);
      transports.push({ tile: t, e, doors, idx: transports.length, spawned: 0 });
    } else {
      const def = tileDef(t.key);
      if (def.special === 'wifi') { wifis.push(t); continue; }
      if (def.special === 'kiosk') kioskCount++;
      if (def.special === 'walkway' || def.special === 'gate') continue;
      const distMap = chebyshevMap(board, t.cells);
      const rec = { tile: t, def, doors, distMap, occ: 0, idx: amenities.length, e: null };
      if (def.special === 'waiting') waitingAreas.push(rec); else amenities.push(rec);
    }
  }
  // wifi bonuses
  for (const a of amenities) {
    let bonus = 0;
    for (const w of wifis) {
      const wd = tileDef(w.key);
      const r = wd.radius + (w.radiusBonus || 0);
      let d = INF;
      for (const [x, y] of w.cells) d = Math.min(d, a.distMap[y * W + x]);
      if (d <= r) bonus += cfg.sim.wifiBonus;
    }
    a.e = effAmenity(a.tile, mods, cfg, Math.min(cfg.sim.wifiCap, bonus));
    tileStats[a.tile.id].cap = a.e.cap;
  }
  for (const wa of waitingAreas) { wa.e = effAmenity(wa.tile, mods, cfg); tileStats[wa.tile.id].cap = wa.e.cap; }
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
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!pass[ni]) continue;
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
  const amenityField = (ai, g) => field('A' + ai, amenities[ai].doors, g);

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
  let best = null;
  const counts = { spawned: 0, boarded: 0, stranded: 0, pickpockets: 0, removed: 0, looped: 0 };
  const dw = cfg.destinationWeights;
  const pickRate = mods.pickpocketRate != null ? mods.pickpocketRate
    : (week >= cfg.run.pickpocketsFromWeek ? cfg.sim.pickpocketRate * Math.max(0, 1 - cfg.sim.kioskPickpocketReduction * kioskCount) : 0);

  function destWeight(travTier, transTier) {
    const gap = travTier - transTier;
    if (gap === 0) return dw.same;
    if (gap === 1) return dw.down1;
    if (gap === -1) return dw.up1;
    if (gap === 2) return dw.down2;
    if (gap === -2) return dw.up2;
    return dw.far;
  }

  function chooseDest(originIdx, tier) {
    const t = Math.min(5, tier + mods.destTierShift);
    const cands = [];
    for (let b = 0; b < transports.length; b++) {
      if (!transports[b].doors.length) continue;
      if (b !== originIdx && !reach[originIdx][b]) continue;
      cands.push(b);
    }
    if (!cands.length) return originIdx;
    return rng.dest.weighted(cands, b => destWeight(t, transports[b].e.tier));
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

  function makeWaypoints(sx, sy, destIdx, gateOpen, same) {
    const f = transportField(destIdx, gateOpen);
    const doors = transports[destIdx].doors;
    const [dx, dy] = doors[Math.floor(doors.length / 2)];
    const wps = [];
    const n = cfg.sim.waypointCount;
    for (let i = 0; i < n; i++) {
      let px, py;
      if (same) {
        const s = cfg.sim.sameTileWanderSigma;
        px = sx + rng.waypoint.gauss() * s; py = sy + rng.waypoint.gauss() * s;
      } else {
        const lo = (i + 0.15) / n, hi = (i + 0.85) / n;
        const t = rng.waypoint.range(lo, hi);
        const s = cfg.sim.waypointSigma;
        px = sx + (dx - sx) * t + rng.waypoint.gauss() * s;
        py = sy + (dy - sy) * t + rng.waypoint.gauss() * s;
      }
      const c = snapCell(px, py, f);
      if (c) wps.push(c);
    }
    return wps;
  }

  function spawnAgent(originIdx, tier, kind, extra = {}) {
    const tr = transports[originIdx];
    const door = rng.spawn.pick(tr.doors);
    const id = agents.length;
    let destIdx = originIdx, gateOpen = false;
    if (kind === 'pickpocket') {
      destIdx = transports.length > 1 ? rng.dest.pick(transports.filter((_, i) => i !== originIdx && reach[originIdx][i]).map(t => t.idx).concat(originIdx)) : originIdx;
      gateOpen = true;
    } else {
      destIdx = chooseDest(originIdx, tier);
      if (destIdx !== originIdx && reach[originIdx][destIdx] === 2) gateOpen = true;
    }
    const tierInfo = cfg.tiers[tier - 1];
    const a = {
      id, tier, kind, origin: originIdx, dest: destIdx, x: door[0], y: door[1],
      value: extra.value ?? tierInfo.base, budget: tierInfo.budget + mods.stopBudgetBonus + (gateOpen ? cfg.sim.gateBudgetBonus : 0) + (extra.budgetBonus || 0),
      served: new Set(), balked: new Set(), chain: [], state: 'walking', spawnTick: currentTick, endTick: null,
      frames: [[door[0], door[1]]], events: [], targets: [], ti: 0, serve: null, serveTicks: 0, arrivedTick: -1,
      waitSlot: null, stacks: 0, gateOpen, robbed: new Set(), outcome: null, stuck: 0, serveDoor: null,
    };
    const same = destIdx === originIdx;
    const wps = makeWaypoints(a.x, a.y, destIdx, gateOpen, same);
    for (const [wx, wy] of wps) a.targets.push({ kind: 'wp', x: wx, y: wy });
    a.targets.push({ kind: 'dest', idx: destIdx });
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
    for (const [dx, dy] of DIRS) {
      const nx = a.x + dx, ny = a.y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!pass[ni]) continue;
      if (dx && dy && !(pass[a.y * W + nx] && pass[ny * W + a.x])) continue;
      const d = f[ni];
      if (d < bestD - 1e-6) { bestD = d; cands = [ni]; }
      else if (Math.abs(d - bestD) < 1e-6 && d < here) cands.push(ni);
    }
    if (!cands.length) return false;
    const ni = cands.length === 1 ? cands[0] : rng.walk.pick(cands);
    a.x = ni % W; a.y = (ni - a.x) / W;
    heat[ni] += 1;
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

  function serviceRolls(a, t) {
    if (a.budget <= 0) return;
    const i = a.y * W + a.x;
    const inRange = [];
    for (const am of amenities) {
      if (am.e.closed || am.e.rate <= 0) continue;
      const d = am.distMap[i];
      if (d < 1 || d > am.e.radius) continue;
      if (a.served.has(am.idx)) continue;
      if (amenityField(am.idx, a.gateOpen)[i] >= INF) continue; // walled off: no path to its door
      inRange.push([d, am]);
    }
    if (!inRange.length) return;
    inRange.sort((p, q) => p[0] - q[0] || p[1].idx - q[1].idx);
    for (const [d, am] of inRange) {
      const e = am.e;
      const gap = e.special === 'anytier' ? 0 : Math.abs(a.tier - e.tier);
      const tm = tierMatchTable[Math.min(gap, tierMatchTable.length - 1)];
      const fall = e.radius <= 1 ? 1 : 1 - ((d - 1) / (e.radius - 1)) * (1 - cfg.sim.radiusFalloffMin);
      const p = e.rate * tm * fall;
      if (!rng.service.chance(p)) continue;
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
    score += v; banked += v;
    const st = tileStats[tr.tile.id];
    st.boarded++; st.points += v; st.revenue += fare;
    counts.boarded++;
    a.outcome = 'boarded'; a.state = 'done'; a.endTick = t;
    a.events.push({ t, type: 'board', tileId: tr.tile.id, value: v });
    if (!best || v > best.value) best = { id: a.id, tier: a.tier, value: v, chain: a.chain.slice(), origin: transports[a.origin].tile.name, dest: tr.tile.name };
    // Loop terminal: re-enter with chain intact
    if (e.def.special === 'loop' && t <= SPAWN_TICKS && rng.loop.chance(e.def.loopChance)) {
      counts.looped++;
      const na = spawnAgent(a.dest, a.tier, 'traveller', { value: v });
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
          let tier = tr.e.tier;
          const r = rng.spawn.next();
          const sp = cfg.sim.tierSpread;
          if (r < sp.down) tier = Math.max(1, tier - 1); else if (r < sp.down + sp.up) tier = Math.min(5, tier + 1);
          if (mods.lowTierBias && tier > 2 && rng.spawn.chance(mods.lowTierBias)) tier = rng.spawn.chance(0.5) ? 1 : 2;
          const kind = pickRate > 0 && rng.pick.chance(pickRate) ? 'pickpocket' : 'traveller';
          spawnAgent(tr.idx, tier, kind);
        }
      }
      for (const ex of extraQueue) if (ex.tick === t) spawnAgent(rng.spawn.pick(activeTransports).idx, ex.tier, 'traveller');
      if (t === 1 && mods.vipCount > 0 && !vipDone.done) {
        vipDone.done = true;
        for (let i = 0; i < mods.vipCount; i++) spawnAgent(rng.spawn.pick(activeTransports).idx, 5, 'traveller', { budgetBonus: mods.vipBudgetBonus });
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
        const onWalkway = isWalkway(a.y * W + a.x);
        const steps = onWalkway ? cfg.sim.walkwaySpeed : 1;
        let moved = false;
        for (let s = 0; s < steps && (a.state === 'walking' || a.state === 'detour'); s++) {
          const tg = a.state === 'detour' ? { kind: 'am', idx: a.serve.idx } : a.targets[a.ti];
          const f = targetField(a, tg);
          const px = a.x, py = a.y;
          const reached = stepToward(a, f);
          if (a.x !== px || a.y !== py) moved = true;
          if (reached) {
            if (a.state === 'detour') { beginService(a, t); break; }
            a.ti++;
            if (a.ti >= a.targets.length) { a.state = 'waiting'; a.arrivedTick = t; a.events.push({ t, type: 'arrive' }); break; }
          } else if (!moved && f[a.y * W + a.x] >= INF) {
            // unreachable target: skip it
            if (a.state === 'detour') { a.served.add(a.serve.idx); a.serve.occ--; a.serve = null; a.state = 'walking'; }
            else { a.ti++; if (a.ti >= a.targets.length) { a.state = 'waiting'; a.arrivedTick = t; } }
            break;
          } else if (!moved) {
            // stuck (no descending neighbour) - drop this target
            if (a.state === 'detour') { a.serve.occ--; a.serve = null; a.state = 'walking'; }
            else { a.ti++; if (a.ti >= a.targets.length) { a.state = 'waiting'; a.arrivedTick = t; } }
            break;
          }
        }
        if (a.state === 'walking' && !onWalkway) serviceRolls(a, t);
      }

      if (a.state === 'waiting') {
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
      a.dest = rng.dest.pick(opts).idx;
      a.targets = [{ kind: 'dest', idx: a.dest }]; a.ti = 0;
    }
    const f = targetField(a, a.targets[a.ti]);
    const reached = stepToward(a, f);
    const i = a.y * W + a.x;
    if (isGateCell(i)) {
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
    const v = a.value * cfg.economy.strandedMultiplier;
    score += v; strandedPts += v;
    counts.stranded++;
    tileStats[transports[a.dest].tile.id].stranded++;
    if (a.waitSlot) { a.waitSlot.occ--; a.waitSlot = null; }
    if (a.serve) { a.serve.occ--; a.serve = null; }
    a.outcome = 'stranded'; a.state = 'done';
    a.events.push({ t: TICKS, type: 'strand', value: v });
  }

  for (const id in tileStats) {
    const s = tileStats[id];
    s.saturation = s.cap > 0 ? s.fullTicks / TICKS : 0;
  }

  return {
    seed, week, ticks: TICKS, spawnTicks: SPAWN_TICKS,
    score: Math.round(score),
    points: { banked: Math.round(banked), stranded: Math.round(strandedPts), stolen: Math.round(stolen) },
    money: { fares: Math.round(fares), revenue: Math.round(revenue), total: Math.round(fares + revenue) },
    counts, best,
    agents: agents.map(a => ({ id: a.id, tier: a.tier, kind: a.kind, spawnTick: a.spawnTick, endTick: a.endTick, frames: a.frames, events: a.events, value: a.value, outcome: a.outcome, origin: transports[a.origin].tile.id, dest: transports[a.dest].tile.id, chain: a.chain })),
    tileStats,
    heat,
    w: W, h: H,
  };
}

// walkable cells 8-adjacent to a tile
function doorCells(board, tile, pass) {
  const W = board.w, H = board.h;
  const set = new Set(), out = [];
  const own = new Set(tile.cells.map(([x, y]) => y * W + x));
  for (const [x, y] of tile.cells) {
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx;
      if (own.has(i) || set.has(i) || !pass[i]) continue;
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
