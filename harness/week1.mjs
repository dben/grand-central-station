#!/usr/bin/env node
// Week 1 on every level and difficulty, which is where a money problem shows up
// and a curve problem does not. A full autoplay run costs a minute a level; this
// is the opening turn alone, over as many seeds as you like, in a few seconds.
//
//   node harness/week1.mjs                                   # every level x every difficulty
//   node harness/week1.mjs --mode junction --runs 32         # one level, more seeds
//   node harness/week1.mjs --set run.startMoney=260          # A/B a CONFIG value
//
// What to read: `cleared` is the share of seeds that survive their first week
// and `tiles` is how many the bot could afford to place. A level whose action
// points outrun its wallet shows up as tiles below its AP with cash left over -
// that is what killed Junction on Extreme (design doc §15).
import * as G from '../src/game/run.js';
import { MODE_KEYS } from '../src/data/modes.js';
import { DIFFICULTY_KEYS } from '../src/data/difficulties.js';
import { playRun, applySets } from './bot.mjs';

const args = process.argv.slice(2);
applySets(args);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(opt('runs', 16)), SEED0 = Number(opt('seed0', 1000));
const MODES = opt('mode', null) ? [opt('mode')] : MODE_KEYS;
const DIFFS = opt('difficulty', null) ? [opt('difficulty')] : DIFFICULTY_KEYS;
const VERBOSE = args.includes('--verbose');

console.log(`week 1, ${RUNS} seeds from ${SEED0}\n`);
console.log('level        difficulty  cash  quota   mean  cleared  tiles  left');
for (const mode of MODES) for (const diff of DIFFS) {
  let sum = 0, cleared = 0, tiles = 0, left = 0;
  const start = G.createRun({ seed: SEED0, modeKey: mode, diffKey: diff });
  for (let i = 0; i < RUNS; i++) {
    const seed = SEED0 + i;
    const { s, ratios } = playRun({ seed, weeks: 1, mode, difficulty: diff });
    const r = ratios[1];
    sum += r; if (r >= 1) cleared++;
    tiles += s.board.tiles.length; left += s.money;
    if (VERBOSE) console.log(`  seed ${seed}: ${r.toFixed(2)}  [${s.board.tiles.map(t => t.name).join(', ')}]`);
  }
  const pad = (v, n) => String(v).padStart(n);
  console.log(`${mode.padEnd(12)} ${diff.padEnd(10)} ${pad('$' + start.money, 5)} ${pad(G.quotaFor(start), 6)}  ${pad((sum / RUNS).toFixed(2), 5)}  ${pad(cleared + '/' + RUNS, 7)}  ${pad((tiles / RUNS).toFixed(1), 5)}  ${pad('$' + Math.round(left / RUNS), 5)}`);
}
