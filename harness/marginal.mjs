#!/usr/bin/env node
// Marginal-value probe: for a board state, try every catalogue tile at its best
// legal spot and report the score delta (in stars) and stars per $100 spent.
//   node harness/marginal.mjs --week 3 --seeds 12
import { createBoard, cloneBoard, checkPlacement, placeTile } from '../src/sim/board.js';
import { simulateWeek } from '../src/sim/sim.js';
import { TRANSPORTS, AMENITIES, tileDef } from '../src/data/tiles.js';
import { MODES } from '../src/data/modes.js';
import { CONFIG, starsOf } from '../src/config.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WEEK = Number(opt('week', 3)), SEEDS = Number(opt('seeds', 12));
const mode = MODES.terminal;

// A plausible board for the week: a couple of transports, then amenities.
const SEED_TILES = {
  1: [['bus_stop', 4, 0, 0]],
  3: [['bus_stop', 4, 0, 0], ['newsstand', 4, 3, 0], ['food_stand', 6, 3, 0]],
  6: [['bus_stop', 4, 0, 0], ['train_station', 6, 11, 0], ['newsstand', 4, 3, 0], ['food_stand', 6, 3, 0], ['coffee', 3, 5, 0], ['burger', 6, 5, 0]],
  10: [['bus_stop', 4, 0, 0], ['train_station', 6, 11, 0], ['tram_stop', 10, 4, 1], ['newsstand', 4, 3, 0], ['food_stand', 6, 3, 0], ['coffee', 3, 5, 0], ['burger', 6, 5, 0], ['sports_bar', 8, 6, 0]],
};
const pickSeed = w => SEED_TILES[Object.keys(SEED_TILES).map(Number).filter(k => k <= w).pop()] || SEED_TILES[1];

const base = createBoard(mode.w, mode.h, mode.preLock || {});
for (const [key, x, y, rot] of pickSeed(WEEK)) {
  const c = checkPlacement(base, key, x, y, rot, mode);
  if (!c.ok) { console.error(`seed tile ${key} @${x},${y}: ${c.reason}`); continue; }
  placeTile(base, key, x, y, rot, c, mode);
}

const seeds = Array.from({ length: SEEDS }, (_, i) => 1000 + i);
const scoreOf = board => seeds.reduce((a, s) => a + simulateWeek(board, { seed: s, week: WEEK, mods: {} }).score, 0) / SEEDS;
const baseScore = scoreOf(base);

const tileCost = def => Math.round(def.cost * (1 + CONFIG.economy.tileCostScalePerTile * base.tiles.length));

// best legal placement for a key, by score delta
function probe(key) {
  const def = tileDef(key);
  let best = null;
  for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) for (let r = 0; r < 4; r++) {
    const c = checkPlacement(base, key, x, y, r, mode);
    if (!c.ok) continue;
    const after = cloneBoard(base);
    placeTile(after, key, x, y, r, null, mode);
    const d = scoreOf(after) - baseScore;
    if (!best || d > best.d) best = { d, x, y, r };
    x += 1;   // coarse sweep: every other cell, this is a balance probe not a solver
  }
  if (!best) return null;
  const cost = tileCost(def);
  return { key, name: def.name, kind: def.kind, cost, d: best.d, stars: best.d / CONFIG.quota.starUnit, per100: (best.d / CONFIG.quota.starUnit) / (cost / 100) };
}

const rows = [];
for (const key of [...Object.keys(TRANSPORTS), ...Object.keys(AMENITIES)]) {
  const def = tileDef(key);
  if (def.minWeek > WEEK || def.rare) continue;
  const r = probe(key);
  if (r) rows.push(r);
}
rows.sort((a, b) => b.per100 - a.per100);
console.log(`week ${WEEK}, ${SEEDS} seeds, base board ${base.tiles.length} tiles scoring ${Math.round(baseScore).toLocaleString()} (${starsOf(baseScore)}★)\n`);
console.log('  ' + 'tile'.padEnd(22) + 'kind'.padEnd(11) + 'cost'.padStart(6) + 'Δscore'.padStart(9) + 'Δstars'.padStart(8) + 'stars/$100'.padStart(12));
for (const r of rows) console.log('  ' + r.name.padEnd(22) + r.kind.padEnd(11) + String(r.cost).padStart(6) + Math.round(r.d).toLocaleString().padStart(9) + r.stars.toFixed(2).padStart(8) + r.per100.toFixed(3).padStart(12));
