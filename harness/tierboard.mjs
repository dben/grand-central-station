#!/usr/bin/env node
// Tier list on a controlled bench, rather than on whatever the bot happened to
// build (that is tierlist.mjs, and the two are worth reading together).
//
// The bench is the same every time, so two tiles measured a month apart are
// still measured against the same crowd:
//
//   amenity bench   a car park at each end of the board and a restroom either
//                   side of the middle. Travellers walk the length of the board
//                   past a shop they already have; the tile under test goes in
//                   the free band between them.
//   premium bench   the same, with the far car park swapped for an express train,
//                   so half the crowd is $$$. A shop is tried on both and keeps
//                   the better reading: a Designer Shop among budget travellers
//                   is not a bad tile, it is a tile in the wrong station.
//   transport bench one car park and a four-shop chain down the middle, so a new
//                   transport is judged on the traffic it brings to shops that
//                   are already standing.
//
// A tile is swept over every legal spot in its bench's window and the headline
// is the MEDIAN spot's value per $100, not the best: the player cannot see the
// best cell in advance. Best and negative share sit beside it, so a
// high-ceiling, high-variance tile reads differently from a safe one.
//
//   node harness/tierboard.mjs --weeks 4,9 --seeds 8
//   node harness/tierboard.mjs --weeks 9 --tiles coffee,pocket_park --verbose
//   node harness/tierboard.mjs --out tiers.json --md tier-list.md
import { writeFileSync } from 'node:fs';
import { startBoard, cloneBoard, checkPlacement, placeTile } from '../src/sim/board.js';
import { simulateWeek, mergeMods } from '../src/sim/sim.js';
import { TRANSPORTS, AMENITIES, NAMED_UPGRADES, tileDef } from '../src/data/tiles.js';
import { CARDS } from '../src/data/cards.js';
import { ORDINANCES } from '../src/data/ordinances.js';
import { orientationCount, shapeCells } from '../src/sim/shapes.js';
import { MODES, minWeekOf, soldOnLevel } from '../src/data/modes.js';
import { CONFIG, quotaForWeek } from '../src/config.js';
import { applySets } from './sets.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WEEKS = opt('weeks', '4,9').split(',').map(Number);
const SEEDS = Number(opt('seeds', 8));
const SPOTS = Number(opt('spots', 40));
const SEED0 = Number(opt('seed0', 5000));
const ONLY = opt('tiles', null) ? opt('tiles').split(',') : null;
const VERBOSE = args.includes('--verbose');
const STAR = CONFIG.quota.starUnit;

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const median = sorted => sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
// Evenly thin a list to `n`, so a sample covers the whole window rather than
// one corner of it, and stays the same from run to run.
const thin = (list, n) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor(i * list.length / n)]);

// --------------------------------------------------------------- the benches
// Each bench names its level, the tiles already standing, and the window a tile
// under test may occupy ([x0, y0, x1, y1] inclusive, or null for the whole board).
// Waterfront and Sky Harbour get their own copies, because their own stock is
// the only place it can be measured: a water bus is not sold anywhere else.
const BENCHES = {
  amenity: { mode: 'terminal', window: [0, 3, 11, 8],
    tiles: [['parking_lot', 5, 0, 0], ['parking_lot', 5, 10, 0], ['restroom', 1, 5, 0], ['restroom', 9, 5, 0]] },
  premium: { mode: 'terminal', window: [0, 3, 11, 8],
    tiles: [['parking_lot', 5, 0, 0], ['express_train', 4, 11, 0], ['restroom', 1, 5, 0], ['restroom', 9, 5, 0]] },
  transport: { mode: 'terminal', window: null,
    tiles: [['parking_lot', 5, 0, 0], ['newsstand', 4, 4, 0], ['food_stand', 4, 6, 0], ['coffee', 7, 4, 0], ['burger', 7, 6, 0]] },
  water: { mode: 'waterfront', window: null,
    tiles: [['parking_lot', 5, 0, 0], ['newsstand', 4, 4, 0], ['food_stand', 4, 6, 0], ['coffee', 7, 4, 0], ['burger', 7, 6, 0]] },
  // Sky Harbour is 8x16 with the checkpoint across the waist, so its bench is a
  // car park landside and a shop chain either side of the fence.
  air: { mode: 'sky_harbour', window: null,
    tiles: [['parking_lot', 3, 14, 0], ['newsstand', 2, 11, 0], ['food_stand', 2, 4, 0], ['coffee', 5, 11, 0], ['burger', 5, 4, 0]] },
};

function buildBench(name) {
  const spec = BENCHES[name], mode = MODES[spec.mode];
  const board = startBoard(mode);
  for (const [key, x, y, rot] of spec.tiles) {
    const c = checkPlacement(board, key, x, y, rot, mode);
    if (!c.ok) throw new Error(`${name} bench: ${key} @${x},${y} rot ${rot}: ${c.reason}`);
    placeTile(board, key, x, y, rot, c, mode);
  }
  return { name, board, mode, window: spec.window };
}

// The benches a tile is tried on: its own level's, if it has one, and both
// crowds for a shop, since which crowd suits it is half of what it is worth.
function benchesFor(def) {
  if (def.modes) return [def.modes.includes('waterfront') ? 'water' : 'air'];
  return def.kind === 'amenity' ? ['amenity', 'premium'] : ['transport'];
}

const inWindow = (win, cells) => !win || cells.every(([x, y]) => x >= win[0] && y >= win[1] && x <= win[2] && y <= win[3]);

// ------------------------------------------------------------------ probing
// One bench, one week: a scorer against a fixed seed set and the price the shop
// would charge on this board.
function stand(bench, week) {
  const seeds = Array.from({ length: SEEDS }, (_, i) => SEED0 + i);
  // Points and cash both: a shop bought for its till (a Cash Machine, a Currency
  // Exchange) reads as a trap on points alone, and it is not one.
  const run = (b, mods) => seeds.map(sd => simulateWeek(b, { seed: sd, week, mods: mods || {} }));
  const sim = (b, mods) => run(b, mods).map(r => r.score);
  const cash = (b, mods) => run(b, mods).map(r => r.money.total);
  const baseScores = sim(bench.board);
  const baseCash = cash(bench.board);
  const priceOf = def => {
    const m = bench.mode;
    let c = def.cost * (1 + CONFIG.economy.tileCostScalePerTile * bench.board.tiles.length) * (m.costMult || 1);
    if (def.kind === 'transport' && m.terrainCostMult && m.terrainCostMult[def.terrain]) c *= m.terrainCostMult[def.terrain];
    return Math.round(c);
  };
  return { seeds, sim, cash, baseScores, baseCash, base: mean(baseScores), priceOf };
}

function probeTile(bench, st, key, week) {
  const def = tileDef(key);
  const b = bench.board;
  const spots = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (let r = 0; r < orientationCount(def.shape); r++) {
    const cells = shapeCells(def.shape, r).map(([cx, cy]) => [cx + x, cy + y]);
    if (!inWindow(bench.window, cells)) continue;
    if (checkPlacement(b, key, x, y, r, bench.mode).ok) spots.push([x, y, r]);
  }
  if (!spots.length) return null;
  const deltas = [], cashes = [];
  for (const [x, y, r] of thin(spots, SPOTS)) {
    const after = cloneBoard(b);
    placeTile(after, key, x, y, r, null, bench.mode);
    deltas.push(mean(st.sim(after).map((v, i) => v - st.baseScores[i])));
    cashes.push(mean(st.cash(after).map((v, i) => v - st.baseCash[i])));
  }
  deltas.sort((a, c) => a - c); cashes.sort((a, c) => a - c);
  const cost = st.priceOf(def), cells = shapeCells(def.shape, 0).length;
  const med = median(deltas), best = deltas[deltas.length - 1];
  return {
    key, name: def.name, kind: def.kind, rare: !!def.rare, only: def.modes ? def.modes[0] : null,
    bench: bench.name, cost, cells, spots: spots.length, week,
    med, best, neg: deltas.filter(d => d < 0).length / deltas.length, cash: median(cashes),
    per100: med / cost * 100, bestPer100: best / cost * 100, perCell: med / cells,
  };
}

// A card or an ordinance is a rule, not a footprint: run the same bench with its
// modifiers on and compare. `weeks` counts the weeks it runs for.
function probeMods(bench, st, { key, name, mods, weeks = 1, cost, kind }) {
  const after = mean(st.sim(bench.board, mergeMods(mods)));
  const med = (after - st.base) * weeks;
  return { key, name, kind, bench: bench.name, cost, med, best: med, neg: med < 0 ? 1 : 0, per100: med / cost * 100, bestPer100: med / cost * 100, cells: 0, perCell: 0, spots: 1 };
}

// ------------------------------------------------------------------ run it
applySets(args);
const KEYS = [...Object.keys(TRANSPORTS), ...Object.keys(AMENITIES)].filter(k => !ONLY || ONLY.includes(k));
const rowsByWeek = [];

for (const week of WEEKS) {
  const t0 = performance.now();
  const benches = {}, stands = {};
  for (const n of Object.keys(BENCHES)) { benches[n] = buildBench(n); stands[n] = stand(benches[n], week); }
  const rows = [];
  for (const key of KEYS) {
    const def = tileDef(key);
    let r = null;
    for (const bn of benchesFor(def)) {
      const bench = benches[bn];
      if (!soldOnLevel(bench.mode, def)) continue;
      if (minWeekOf(bench.mode, key, def) > week) continue;
      const got = probeTile(bench, stands[bn], key, week);
      if (got && (!r || got.per100 > r.per100)) r = got;
    }
    if (!r) continue;
    rows.push(r);
    if (VERBOSE) console.log(`  w${week} ${def.name.padEnd(22)} ${(r.med / STAR).toFixed(1)} median, ${(r.best / STAR).toFixed(1)} best, ${(r.neg * 100).toFixed(0)}% negative, $${r.cost}`);
  }

  // Cards and ordinances, on the amenity bench with the test slot filled, so
  // there is a real chain for a rule to act on.
  if (!ONLY) {
    // The rule benches are the two shop benches with the test slot filled, so
    // there is a real chain for a rule to act on, and a rule keeps its better
    // reading the way a tile does.
    const beds = ['amenity', 'premium'].map(n => {
      const cb = buildBench(n);
      placeTile(cb.board, 'burger', 5, 5, 0, null, cb.mode);
      return { cb, cs: stand(cb, week), shop: cb.board.tiles.find(t => t.key === 'burger') };
    });
    const bestOf = fn => beds.map(fn).reduce((a, c) => (c.med > a.med ? c : a));
    const { cb, cs, shop } = beds[0];
    // An action point is worth a tile you would otherwise not have bought: the
    // median buy on this bench this week. That is the only honest exchange rate
    // between a card that buys time and one that changes a rule.
    const apValue = median(rows.filter(r => r.kind === 'amenity').map(r => r.med).sort((a, b) => a - b));
    for (const [key, c] of Object.entries(CARDS)) {
      if (c.effect) { rows.push({ ...bestOf(b => probeMods(b.cb, b.cs, { key, name: c.name, mods: c.effect, weeks: c.weeks || 1, cost: c.cost, kind: 'card' })), week }); continue; }
      if (key === 'grand_opening') { rows.push({ ...bestOf(b => probeMods(b.cb, b.cs, { key, name: c.name, mods: { grandOpeningTileId: b.shop.id }, cost: c.cost, kind: 'card' })), week }); continue; }
      // Cards that buy action points, priced at the median tile they let you buy.
      const ap = key === 'overtime' ? 2 : key === 'temp_staff' ? 3 : 0;
      if (ap) rows.push({ key, name: c.name, kind: 'card', bench: 'amenity', cost: c.cost, med: ap * apValue, best: ap * apValue, neg: 0, cells: 0, spots: 1, perCell: 0, per100: ap * apValue / c.cost * 100, bestPer100: ap * apValue / c.cost * 100, week, note: `${ap} AP x median shop` });
      else rows.push({ key, name: c.name, kind: 'card', bench: 'amenity', cost: c.cost, med: null, week, note: 'no score effect to measure' });
    }
    for (const [key, o] of Object.entries(ORDINANCES)) {
      if (!o.mods) { rows.push({ key, name: o.name, kind: 'ordinance', cost: 0, med: null, week, note: 'changes the game rules, not the week' }); continue; }
      // An ordinance is free and permanent, so it is priced per week it runs,
      // against the week's quota rather than against a price tag.
      const r = bestOf(b => probeMods(b.cb, b.cs, { key, name: o.name, mods: o.mods, cost: 100, kind: 'ordinance' }));
      rows.push({ ...r, cost: 0, per100: null, quotaShare: r.med / quotaForWeek(week, cb.mode), week });
    }
    // A named upgrade is a level on a tile that is already standing: raise the
    // bench's own burger and read the difference.
    for (const [key, u] of Object.entries(NAMED_UPGRADES)) {
      if (u.target === 'waiting_all') continue;   // nothing on this bench to raise
      const r = bestOf(b => {
        const up = cloneBoard(b.cb.board);
        up.tiles.find(t => (u.target === 'transport' ? t.kind === 'transport' : t.key === 'burger')).level = 1 + u.levels;
        const med = mean(b.cs.sim(up).map((v, i) => v - b.cs.baseScores[i]));
        return { key, name: u.name, kind: 'upgrade', bench: b.cb.name, cost: u.cost, med, best: med, neg: med < 0 ? 1 : 0, cells: 0, spots: 1, perCell: 0, per100: med / u.cost * 100, bestPer100: med / u.cost * 100 };
      });
      rows.push({ ...r, week });
    }
  }
  rowsByWeek.push({ week, base: stands.amenity.base, rows });
  console.log(`week ${week}: ${rows.length} entries probed in ${((performance.now() - t0) / 1000).toFixed(0)}s (amenity bench scores ${Math.round(stands.amenity.base).toLocaleString()}, ${(stands.amenity.base / STAR).toFixed(1)} stars)`);
}

// Average each entry over the weeks it was buyable in.
const agg = new Map();
for (const e of rowsByWeek) for (const r of e.rows) {
  const a = agg.get(r.key) || { ...r, weeks: [], vals: {} };
  a.weeks.push(e.week);
  for (const k of ['per100', 'bestPer100', 'perCell', 'med', 'best', 'neg', 'cost', 'quotaShare', 'cash']) (a.vals[k] = a.vals[k] || []).push(r[k]);
  agg.set(r.key, a);
}
const table = [...agg.values()].map(a => {
  const avg = k => { const v = (a.vals[k] || []).filter(x => x != null); return v.length ? mean(v) : null; };
  return { ...a, weeks: a.weeks, per100: avg('per100'), bestPer100: avg('bestPer100'), perCell: avg('perCell'), med: avg('med'), best: avg('best'), neg: avg('neg'), quotaShare: avg('quotaShare'), cash: avg('cash'), cost: Math.round(avg('cost') || 0) };
});

// Buckets by quantile of the value-per-$100 ranking, so the letters keep their
// meaning after a balance pass instead of drifting with the absolute numbers.
// Anything with nothing to measure is graded by hand in the document, not here.
const CUTS = [['S', 0.12], ['A', 0.34], ['B', 0.66], ['C', 0.88], ['D', 1]];
function grade(list) {
  list.sort((x, y) => y.per100 - x.per100);
  list.forEach((r, i) => { r.tier = CUTS.find(([, q]) => i < Math.ceil(q * list.length))[0]; });
  return list;
}
const buyable = grade(table.filter(r => r.per100 != null && r.kind !== 'ordinance'));
const ordinances = table.filter(r => r.kind === 'ordinance' && r.quotaShare != null).sort((x, y) => y.quotaShare - x.quotaShare);
const unmeasured = table.filter(r => r.med == null);

const f = (v, d = 1) => v == null ? '-' : (v / STAR).toFixed(d);
console.log('\n' + 'tier'.padEnd(5) + 'entry'.padEnd(24) + 'kind'.padEnd(11) + 'bench'.padEnd(11) + 'cost'.padStart(6) + 'median'.padStart(8) + 'best'.padStart(7) + 'neg%'.padStart(6) + 'per$100'.padStart(9) + 'cash/wk'.padStart(9) + '  weeks');
for (const r of buyable) {
  console.log(r.tier.padEnd(5) + (r.name + (r.rare ? ' *' : '') + (r.only ? ' @' : '')).padEnd(24) + r.kind.padEnd(11) + (r.bench || '').padEnd(11) + String(r.cost).padStart(6)
    + f(r.med).padStart(8) + f(r.best).padStart(7) + (r.neg * 100).toFixed(0).padStart(6) + (r.per100 / STAR).toFixed(2).padStart(9) + (r.cash == null ? '-' : Math.round(r.cash)).toString().padStart(9) + '  ' + r.weeks.join(','));
}
console.log('\nordinances, as a share of the week\'s quota (free and permanent, so no price):');
for (const r of ordinances) console.log('  ' + r.name.padEnd(24) + (r.quotaShare * 100).toFixed(1).padStart(7) + '%' + f(r.med).padStart(9) + ' stars');
if (unmeasured.length) console.log('\nnothing to measure on a bench (graded by hand): ' + unmeasured.map(r => r.name).join(', '));
console.log('\n* = rare, @ = sold on one level only. median/best are the score delta at the median and best legal spot, in stars.');

if (opt('out')) {
  writeFileSync(opt('out'), JSON.stringify({ config: { WEEKS, SEEDS, SPOTS, SEED0 }, benches: Object.keys(BENCHES), table: buyable, ordinances, unmeasured }, null, 2));
  console.log(`wrote ${opt('out')}`);
}
