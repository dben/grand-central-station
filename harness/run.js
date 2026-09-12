#!/usr/bin/env node
// CLI balance harness: run a layout across N seeds and report score
// distribution plus per-tile saturation.
//   node harness/run.js harness/layouts/week1_bus.json --seeds 50 --week 3
import { readFileSync } from 'node:fs';
import { createBoard, placeTile, checkPlacement } from '../src/sim/board.js';
import { simulateWeek, mergeMods } from '../src/sim/sim.js';
import { MODES } from '../src/data/modes.js';
import { DIFFICULTIES } from '../src/data/difficulties.js';
import { quotaForWeek, starsOf, starTarget } from '../src/config.js';
import { applySets } from './sets.mjs';

export function loadLayout(spec) {
  const mode = MODES[spec.mode || 'terminal'];
  const diff = DIFFICULTIES[spec.difficulty] || DIFFICULTIES.standard;
  const board = createBoard(mode.w, mode.h, mode.preLock || {});
  for (const t of spec.tiles) {
    const c = checkPlacement(board, t.key, t.x, t.y, t.rot || 0, mode);
    if (!c.ok) throw new Error(`Cannot place ${t.key} at ${t.x},${t.y}: ${c.reason}`);
    const tile = placeTile(board, t.key, t.x, t.y, t.rot || 0, c, mode);
    if (t.level) tile.level = t.level;
  }
  return { board, mode, diff };
}

export function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export function runLayout(spec, { seeds = 30, week = spec.week || 1, mods = spec.mods || {} } = {}) {
  const { board, mode, diff } = loadLayout(spec);
  // a layout dumped from a harder run carries its difficulty, so the quota it
  // is measured against and the income it earns are that run's
  mods = mergeMods(diff.mods, mods);
  const results = [];
  const t0 = performance.now();
  for (let s = 0; s < seeds; s++) results.push(simulateWeek(board, { seed: s + 1, week, mods }));
  const ms = (performance.now() - t0) / seeds;
  const scores = results.map(r => r.score).sort((a, b) => a - b);
  const money = results.map(r => r.money.total).sort((a, b) => a - b);
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const tiles = {};
  for (const r of results) for (const [id, st] of Object.entries(r.tileStats)) {
    const t = tiles[id] || (tiles[id] = { name: st.name, serves: 0, balks: 0, revenue: 0, points: 0, sat: 0, spawned: 0, boarded: 0, stranded: 0 });
    t.serves += st.serves; t.balks += st.balks; t.revenue += st.revenue; t.points += st.points; t.sat += st.saturation; t.spawned += st.spawned; t.boarded += st.boarded; t.stranded += st.stranded;
  }
  for (const t of Object.values(tiles)) for (const k of Object.keys(t)) if (k !== 'name') t[k] /= seeds;
  const counts = { spawned: mean(results.map(r => r.counts.spawned)), boarded: mean(results.map(r => r.counts.boarded)), stranded: mean(results.map(r => r.counts.stranded)), lost: mean(results.map(r => r.counts.lost)) };
  return { board, mode, diff, week, quota: quotaForWeek(week, mode, 1, diff), score: { mean: mean(scores), p10: pct(scores, 0.1), p50: pct(scores, 0.5), p90: pct(scores, 0.9) }, money: { mean: mean(money), p10: pct(money, 0.1), p90: pct(money, 0.9) }, tiles, counts, msPerWeek: ms, results };
}

export function report(r) {
  const f = n => Math.round(n).toLocaleString('en-US');
  console.log(`Week ${r.week}  quota ${f(r.quota)} (${starTarget(r.quota)}\u2605)  |  score mean ${f(r.score.mean)} (${starsOf(r.score.mean)}\u2605)  p10 ${f(r.score.p10)} (${starsOf(r.score.p10)}\u2605)  p50 ${f(r.score.p50)}  p90 ${f(r.score.p90)} (${starsOf(r.score.p90)}\u2605)  |  money mean ${f(r.money.mean)} (${f(r.money.p10)}-${f(r.money.p90)})  |  ${r.msPerWeek.toFixed(1)} ms/week`);
  const strandPct = r.counts.spawned ? (r.counts.stranded / r.counts.spawned * 100).toFixed(0) : '0';
  console.log(`  travellers: spawned ${r.counts.spawned.toFixed(1)}  boarded ${r.counts.boarded.toFixed(1)}  stranded ${r.counts.stranded.toFixed(1)} (${strandPct}%)  lost ${r.counts.lost.toFixed(1)}  |  stars vs quota ${(r.score.mean / r.quota).toFixed(2)}x`);
  const rows = Object.values(r.tiles);
  console.log('  ' + 'tile'.padEnd(20) + 'serves'.padStart(8) + 'balks'.padStart(7) + 'sat%'.padStart(6) + 'revenue'.padStart(9) + 'points'.padStart(9) + 'spawn'.padStart(7) + 'board'.padStart(7) + 'strand'.padStart(7));
  for (const t of rows) console.log('  ' + t.name.padEnd(20) + t.serves.toFixed(1).padStart(8) + t.balks.toFixed(1).padStart(7) + (t.sat * 100).toFixed(0).padStart(6) + t.revenue.toFixed(0).padStart(9) + f(t.points).padStart(9) + t.spawned.toFixed(1).padStart(7) + t.boarded.toFixed(1).padStart(7) + t.stranded.toFixed(1).padStart(7));
}

if (process.argv[1] && process.argv[1].endsWith('run.js')) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
  if (!file) { console.error('usage: node harness/run.js <layout.json> [--seeds N] [--week W] [--json] [--set path=value]'); process.exit(1); }
  applySets(args);
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const r = runLayout(spec, { seeds: Number(opt('seeds', 30)), week: Number(opt('week', spec.week || 1)) });
  if (args.includes('--json')) console.log(JSON.stringify({ week: r.week, quota: r.quota, score: r.score, money: r.money, tiles: r.tiles, counts: r.counts }, null, 1));
  else report(r);
}
