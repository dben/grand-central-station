#!/usr/bin/env node
// Placement sensitivity probe: how much does one tile's value swing between
// neighbouring spots and rotations? Sweeps every legal placement of each probe
// tile on a board and reports the landscape (best / median / negative share)
// and its roughness: the mean jump in value between a spot and the same tile
// one cell over or rotated, next to the seed-noise floor of the estimate.
//   node harness/sensitivity.mjs --bot 1000 --week 9 --seeds 8 --tiles coffee,burger,gate
//   node harness/sensitivity.mjs --layout harness/layouts/amenity_chain.json --week 6
//   --dump board.json writes the bot's board as a layout, so another build can probe the same one.
import { readFileSync, writeFileSync } from 'node:fs';
import { cloneBoard, checkPlacement, placeTile } from '../src/sim/board.js';
import { simulateWeek } from '../src/sim/sim.js';
import { tileDef } from '../src/data/tiles.js';
import { orientationCount } from '../src/sim/shapes.js';
import { MODES } from '../src/data/modes.js';
import { CONFIG } from '../src/config.js';
import { playRun, applySets, boardSpec } from './bot.mjs';
import { loadLayout } from './run.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WEEK = Number(opt('week', 9)), SEEDS = Number(opt('seeds', 8));
const TILES = opt('tiles', 'coffee,burger,sports_bar,gate,walkway,tram_stop').split(',');
const QUIET = args.includes('--quiet');

let board, mode;
if (opt('layout')) ({ board, mode } = loadLayout(JSON.parse(readFileSync(opt('layout'), 'utf8'))));
else {
  const { s } = playRun({ seed: Number(opt('bot', 1000)), weeks: WEEK, stopBefore: WEEK });
  board = s.board; mode = MODES[s.modeKey];
  if (opt('dump')) writeFileSync(opt('dump'), JSON.stringify(boardSpec(s)));
}
// Rule overrides apply after the bot has built the board, so every variant
// probes the same layout.
applySets(args);
const seeds = Array.from({ length: SEEDS }, (_, i) => 5000 + i);
const sims = b => seeds.map(sd => simulateWeek(b, { seed: sd, week: WEEK, mods: {} }));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const baseRuns = sims(board);
const baseScores = baseRuns.map(r => r.score);
const strand = rs => mean(rs.map(r => r.counts.stranded / Math.max(1, r.counts.spawned)));
const STAR = CONFIG.quota.starUnit;
console.log(`board: ${board.tiles.length} tiles [${board.tiles.map(t => t.key).join(', ')}]`);
console.log(`week ${WEEK}, ${SEEDS} seeds: base ${Math.round(mean(baseScores)).toLocaleString()} (${(mean(baseScores) / STAR).toFixed(1)}★), stranded ${(strand(baseRuns) * 100).toFixed(0)}%, seed sd ${(sd(baseScores) / STAR).toFixed(2)}★`);

const summary = [];
for (const key of TILES) {
  const def = tileDef(key);
  const nRot = orientationCount(def.shape);
  const at = new Map();   // "x,y,r" -> { d, noise }
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) for (let r = 0; r < nRot; r++) {
    const c = checkPlacement(board, key, x, y, r, mode);
    if (!c.ok) continue;
    const after = cloneBoard(board);
    placeTile(after, key, x, y, r, null, mode);
    const runs = sims(after);
    const deltas = runs.map((rr, i) => rr.score - baseScores[i]);
    at.set(`${x},${y},${r}`, { x, y, r, d: mean(deltas), noise: sd(deltas) / Math.sqrt(SEEDS), strand: strand(runs) });
  }
  if (!at.size) { console.log(`\n${def.name}: no legal placement`); continue; }
  const ps = [...at.values()];
  const ds = ps.map(p => p.d).sort((a, b) => a - b);
  // roughness: |Δ(p) - Δ(q)| for q one cell over (same rotation) or a different rotation at the same origin
  const jumps = [], rotJumps = [];
  for (const p of ps) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) { const q = at.get(`${p.x + dx},${p.y + dy},${p.r}`); if (q) jumps.push(Math.abs(p.d - q.d)); }
    for (let r = p.r + 1; r < nRot; r++) { const q = at.get(`${p.x},${p.y},${r}`); if (q) rotJumps.push(Math.abs(p.d - q.d)); }
  }
  const row = {
    name: def.name, n: ps.length, best: ds[ds.length - 1], median: ds[Math.floor(ds.length / 2)], worst: ds[0],
    neg: ds.filter(d => d < 0).length / ds.length, spread: sd(ds),
    shift: jumps.length ? mean(jumps) : 0, rot: rotJumps.length ? mean(rotJumps) : 0, noise: mean(ps.map(p => p.noise)),
    strand: mean(ps.map(p => p.strand)),
  };
  summary.push(row);
  if (!QUIET) console.log(`\n${def.name}: ${row.n} spots  best ${(row.best / STAR).toFixed(1)}★  median ${(row.median / STAR).toFixed(1)}★  worst ${(row.worst / STAR).toFixed(1)}★  negative ${(row.neg * 100).toFixed(0)}%  |  jump: shift ${(row.shift / STAR).toFixed(2)}★ rotate ${(row.rot / STAR).toFixed(2)}★  noise ${(row.noise / STAR).toFixed(2)}★  |  stranded ${(row.strand * 100).toFixed(0)}%`);
}
console.log('\n' + 'tile'.padEnd(20) + 'spots'.padStart(6) + 'best'.padStart(7) + 'median'.padStart(8) + 'worst'.padStart(7) + 'neg%'.padStart(6) + 'spread'.padStart(8) + 'shift'.padStart(7) + 'rotate'.padStart(8) + 'noise'.padStart(7) + 'strand%'.padStart(9));
for (const r of summary) console.log(r.name.padEnd(20) + String(r.n).padStart(6) + (r.best / STAR).toFixed(1).padStart(7) + (r.median / STAR).toFixed(1).padStart(8) + (r.worst / STAR).toFixed(1).padStart(7) + (r.neg * 100).toFixed(0).padStart(6) + (r.spread / STAR).toFixed(2).padStart(8) + (r.shift / STAR).toFixed(2).padStart(7) + (r.rot / STAR).toFixed(2).padStart(8) + (r.noise / STAR).toFixed(2).padStart(7) + (r.strand * 100).toFixed(0).padStart(9));
// One line for diffing across sim variants: mean over probe tiles.
const agg = k => mean(summary.map(r => r[k]));
const base = mean(baseScores), pc = k => (agg(k) / base * 100).toFixed(1) + '%';
console.log(`\nAGG neg ${(agg('neg') * 100).toFixed(0)}%  shift ${(agg('shift') / STAR).toFixed(2)}★  rotate ${(agg('rot') / STAR).toFixed(2)}★  noise ${(agg('noise') / STAR).toFixed(2)}★  spread ${(agg('spread') / STAR).toFixed(2)}★  median ${(agg('median') / STAR).toFixed(2)}★  stranded ${(agg('strand') * 100).toFixed(0)}%`);
console.log(`REL base ${(base / STAR).toFixed(0)}★ (seed sd ${(sd(baseScores) / base * 100).toFixed(1)}%)  shift ${pc('shift')}  rotate ${pc('rot')}  noise ${pc('noise')}  spread ${pc('spread')}  median ${pc('median')}`);
