#!/usr/bin/env node
// Tier list: rank every catalogue tile by what it is actually worth to buy.
//
// For each era (a week), the bot plays up to that week to build a realistic
// board, then every tile available that week is swept over its legal spots and
// simulated. The headline number is the MEDIAN spot's value per $100, not the
// best: a tile that only pays off in one corner is not a good buy, and the
// player cannot see the corner in advance. Best and negative share are reported
// beside it, so a high-ceiling, high-risk tile reads differently from a safe one.
//
//   node harness/tierlist.mjs --weeks 5,9,13 --seeds 6 --spots 36
//   node harness/tierlist.mjs --weeks 9 --tiles coffee,subway --verbose
//   --out tiers.json writes the full table for later comparison.
import { writeFileSync } from 'node:fs';
import { cloneBoard, checkPlacement, placeTile } from '../src/sim/board.js';
import { simulateWeek } from '../src/sim/sim.js';
import { TRANSPORTS, AMENITIES, tileDef } from '../src/data/tiles.js';
import { orientationCount, shapeCells } from '../src/sim/shapes.js';
import { MODES, minWeekOf } from '../src/data/modes.js';
import { CONFIG } from '../src/config.js';
import { playRun, applySets } from './bot.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WEEKS = opt('weeks', '5,9,13').split(',').map(Number);
const SEEDS = Number(opt('seeds', 6));
const SPOTS = Number(opt('spots', 36));      // max placements sampled per tile
const BOT = Number(opt('bot', 1000));
// Sim seeds for the probe. Vary it to re-measure the same board independently:
// how far a tile moves between two seed sets is the noise floor of the ranking.
const SEED0 = Number(opt('seed0', 5000));
const ONLY = opt('tiles', null) ? opt('tiles').split(',') : null;
const VERBOSE = args.includes('--verbose');
const STAR = CONFIG.quota.starUnit;

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const median = sorted => sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

// Evenly thin a list down to `n`, so a sample still covers the whole board
// rather than one quadrant, and stays the same from run to run.
function thin(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

const KEYS = [...Object.keys(TRANSPORTS), ...Object.keys(AMENITIES)].filter(k => !ONLY || ONLY.includes(k));

// ---------------------------------------------------------------- one era
function era(week) {
  const { s } = playRun({ seed: BOT, weeks: week, stopBefore: week });
  const board = s.board, mode = MODES[s.modeKey];
  const seeds = Array.from({ length: SEEDS }, (_, i) => SEED0 + i);
  const sims = b => seeds.map(sd => simulateWeek(b, { seed: sd, week, mods: {} }).score);
  const baseScores = sims(board);
  const base = mean(baseScores);
  // What the shop would charge for it on this board.
  const priceOf = def => Math.round(def.cost * (1 + CONFIG.economy.tileCostScalePerTile * board.tiles.length) * (mode.costMult || 1));

  const rows = [];
  for (const key of KEYS) {
    const def = tileDef(key);
    if (minWeekOf(mode, key, def) > week) continue;
    const spots = [];
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) for (let r = 0; r < orientationCount(def.shape); r++) {
      if (checkPlacement(board, key, x, y, r, mode).ok) spots.push([x, y, r]);
    }
    if (!spots.length) { rows.push({ key, name: def.name, kind: def.kind, rare: !!def.rare, none: true }); continue; }
    const deltas = [];
    for (const [x, y, r] of thin(spots, SPOTS)) {
      const after = cloneBoard(board);
      placeTile(after, key, x, y, r, null, mode);
      deltas.push(mean(sims(after).map((v, i) => v - baseScores[i])));
    }
    deltas.sort((a, b) => a - b);
    const cost = priceOf(def), cells = shapeCells(def.shape, 0).length;
    const med = median(deltas), best = deltas[deltas.length - 1];
    rows.push({
      key, name: def.name, kind: def.kind, rare: !!def.rare, cost, cells, spots: spots.length,
      best, med, neg: deltas.filter(d => d < 0).length / deltas.length,
      per100: med / cost * 100, bestPer100: best / cost * 100, perCell: med / cells,
    });
    if (VERBOSE) console.log(`  w${week} ${def.name.padEnd(22)} ${(med / STAR).toFixed(1)} median, ${(best / STAR).toFixed(1)} best, ${(100 * deltas.filter(d => d < 0).length / deltas.length).toFixed(0)}% negative, $${cost}`);
  }
  return { week, base, tiles: board.tiles.length, rows };
}

// ---------------------------------------------------------------- run it
applySets(args);
const eras = [];
for (const w of WEEKS) {
  const t0 = performance.now();
  const e = era(w);
  eras.push(e);
  console.log(`week ${w}: bot board ${e.tiles} tiles scoring ${Math.round(e.base).toLocaleString()} (${(e.base / STAR).toFixed(1)} stars), ${e.rows.length} tiles probed in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}

// Average each tile over the eras where it was buyable at all.
const agg = new Map();
for (const e of eras) for (const r of e.rows) {
  if (r.none) continue;
  const a = agg.get(r.key) || { key: r.key, name: r.name, kind: r.kind, rare: r.rare, weeks: [], per100: [], bestPer100: [], perCell: [], med: [], best: [], neg: [], cost: [] };
  a.weeks.push(e.week);
  for (const k of ['per100', 'bestPer100', 'perCell', 'med', 'best', 'neg', 'cost']) a[k].push(r[k]);
  agg.set(r.key, a);
}
const table = [...agg.values()].map(a => ({
  key: a.key, name: a.name, kind: a.kind, rare: a.rare, weeks: a.weeks,
  per100: mean(a.per100), bestPer100: mean(a.bestPer100), perCell: mean(a.perCell),
  med: mean(a.med), best: mean(a.best), neg: mean(a.neg), cost: Math.round(mean(a.cost)),
})).sort((x, y) => y.per100 - x.per100);

// Buckets by quantile of the median-value-per-$100 ranking, so the list stays
// meaningful after a balance pass instead of drifting with absolute numbers.
const CUTS = [['S', 0.15], ['A', 0.35], ['B', 0.65], ['C', 0.85], ['D', 1]];
const bucketOf = i => CUTS.find(([, q]) => i < Math.ceil(q * table.length))[0];
table.forEach((r, i) => { r.tier = bucketOf(i); });

const f = (v, d = 1) => (v / STAR).toFixed(d);
console.log('\n' + 'tier'.padEnd(5) + 'tile'.padEnd(23) + 'kind'.padEnd(11) + 'cost'.padStart(6) + 'median'.padStart(8) + 'best'.padStart(7) + 'neg%'.padStart(6) + 'per$100'.padStart(9) + 'per cell'.padStart(9) + '  weeks');
for (const r of table) {
  console.log(r.tier.padEnd(5) + (r.name + (r.rare ? ' *' : '')).padEnd(23) + r.kind.padEnd(11) + String(r.cost).padStart(6)
    + f(r.med).padStart(8) + f(r.best).padStart(7) + (r.neg * 100).toFixed(0).padStart(6)
    + (r.per100 / STAR).toFixed(2).padStart(9) + f(r.perCell).padStart(9) + '  ' + r.weeks.join(','));
}
const never = eras.flatMap(e => e.rows.filter(r => r.none).map(r => r.name));
if (never.length) console.log(`\nno legal spot on some board: ${[...new Set(never)].join(', ')}`);
console.log('\n* = rare. median/best are the score delta at the median and best legal spot, in stars.');
if (opt('out')) { writeFileSync(opt('out'), JSON.stringify({ config: { WEEKS, SEEDS, SPOTS, BOT }, eras: eras.map(e => ({ week: e.week, base: e.base, tiles: e.tiles })), table }, null, 2)); console.log(`wrote ${opt('out')}`); }
