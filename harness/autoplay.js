#!/usr/bin/env node
// Autoplay bot: plays full runs through the real game layer with a greedy
// heuristic, to see where runs die and how score tracks quota.
//   node harness/autoplay.js --runs 5 --weeks 16 --mode terminal [--seed0 1000] [--policy greedy|naive] [--verbose] [--no-prune] [--set path=value]
// The bot itself lives in bot.mjs so other tools can borrow its boards.
import { playRun, applySets } from './bot.mjs';

const args = process.argv.slice(2);
applySets(args);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(opt('runs', 4)), WEEKS = Number(opt('weeks', 16)), MODE = opt('mode', 'terminal'), POLICY = opt('policy', 'greedy');
const VERBOSE = args.includes('--verbose');
const CANDS = Number(opt('cands', 10));
// Base seed for the run population. Vary it to check whether a shift in the
// survival rate is a real balance move or just this set of 16 runs.
const SEED0 = Number(opt('seed0', 1000));
// --no-prune: the bot never deletes a tile, even one that scores better gone.
const PRUNE = !args.includes('--no-prune');

const outcomes = [];
const ratioByWeek = {};
for (let run = 0; run < RUNS; run++) {
  const seed = SEED0 + run;
  const { s, died, ratios } = playRun({ seed, weeks: WEEKS, mode: MODE, policy: POLICY, cands: CANDS, verbose: VERBOSE, prune: PRUNE });
  for (const [w, r] of Object.entries(ratios)) (ratioByWeek[w] = ratioByWeek[w] || []).push(r);
  outcomes.push({ seed, died, tiles: s.board.tiles.length, money: s.money, board: s.board.tiles.map(t => `${t.name}L${t.level}`).join(', ') });
  console.log(`run ${run} (seed ${seed}): ${died ? 'DIED week ' + died : 'survived to week ' + WEEKS}  | ${outcomes[outcomes.length - 1].board}`);
}
console.log('\nscore/quota ratio by week (mean, min, max):');
for (const [w, arr] of Object.entries(ratioByWeek)) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  console.log(`  w${String(w).padStart(2)}: ${mean.toFixed(2)}  min ${Math.min(...arr).toFixed(2)}  max ${Math.max(...arr).toFixed(2)}  n=${arr.length}`);
}
const deaths = outcomes.filter(o => o.died).map(o => o.died);
console.log(`\n${outcomes.length - deaths.length}/${outcomes.length} survived; death weeks: ${deaths.join(', ') || 'none'}`);
