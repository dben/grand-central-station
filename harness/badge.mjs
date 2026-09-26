#!/usr/bin/env node
// Does the star badge tell the truth about the week the player will actually
// run? The badge is the mean over the estimate seeds; the week runs on a seed
// of its own. For random legal placements on the bot's boards this compares the
// two: how far the real week lands from the badge, how often a badge worth a
// star or more turns into a loss, and the same for two placements in a row.
//   node harness/badge.mjs --bots 1002,1003,1004,1005,1006 --weeks 9,12 --spots 28 [--difficulty extreme] [--set path=value]
import * as G from '../src/game/run.js';
import { cloneBoard, placeTile } from '../src/sim/board.js';
import { Rng } from '../src/sim/rng.js';
import { CONFIG } from '../src/config.js';
import { playRun, applySets, legalPlacements } from './bot.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const BOTS = opt('bots', '1002,1003,1004,1005,1006').split(',').map(Number), WEEKS = opt('weeks', '9,12').split(',').map(Number);
const SPOTS = Number(opt('spots', 28)), DIFF = opt('difficulty', 'standard');
const TILES = opt('tiles', 'coffee,burger,clothing,sports_bar,bike_rental,tram_stop,waiting_area').split(',');
const STAR = CONFIG.quota.starUnit;
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

// The week as the player will run it: the run's own seed for that week.
const realScore = (s, board) => { const keep = s.board; s.board = board; const r = G.simulateCurrent(s).score; s.board = keep; return r; };
const place = (b, s, p) => { const out = cloneBoard(b); placeTile(out, p.key, p.x, p.y, p.r, null, G.modeOf(s)); return out; };

// Built on Standard so the boards reach the late weeks; `--difficulty` only
// changes the money, which the score does not read, and the quota it is read against.
// Rule overrides apply once the boards are built, so every variant probes the same ones.
const boards = [];
for (const bot of BOTS) for (const week of WEEKS) {
  const { s, died } = playRun({ seed: bot, weeks: week, difficulty: DIFF, stopBefore: week });
  if (died) console.log(`bot ${bot} died in week ${died}`); else boards.push({ bot, week, s });
}
applySets(args);
const one = [], two = [], seedSd = [];
for (const { bot, week, s } of boards) {
  const rng = new Rng(bot * 31 + week);
  const base = G.estimateCurrent(s).pts, baseReal = realScore(s, s.board);
  const week16 = G.simulateCurrent(s, null, 16).map(r => r.score);
  seedSd.push(sd(week16) / mean(week16));
  const spots = [];
  for (const key of TILES) for (const p of legalPlacements(s, key, rng, Math.ceil(SPOTS / TILES.length))) spots.push({ key, ...p });
  const rows = spots.map(p => ({ p, badge: G.estimatePlacement(s, p.key, p.x, p.y, p.r).pts, real: realScore(s, place(s.board, s, p)) - baseReal }));
  for (const r of rows) one.push({ ...r, base });
  // Two placements the badge likes, one after the other, the way a week is built.
  const liked = rows.filter(r => r.badge >= STAR);
  for (let i = 0; i + 1 < liked.length; i += 2) {
    const a = liked[i].p, b = liked[i + 1].p;
    const mid = place(s.board, s, a);
    if (!G.placementCheck({ ...s, board: mid }, b.key, b.x, b.y, b.r).ok) continue;
    const both = place(mid, s, b);
    const keep = s.board; s.board = mid;
    const badgeB = G.estimatePlacement(s, b.key, b.x, b.y, b.r).pts;
    s.board = keep;
    two.push({ badge: liked[i].badge + badgeB, real: realScore(s, both) - baseReal, base });
  }
  console.log(`bot ${bot} week ${week}: ${s.board.tiles.length} tiles, ${(base / STAR).toFixed(0)}★ (real seed ${(baseReal / STAR).toFixed(0)}★), ${rows.length} spots`);
}
const report = (name, rows) => {
  const err = rows.map(r => (r.real - r.badge) / r.base);
  const liked = rows.filter(r => r.badge >= STAR);
  const flips = liked.filter(r => r.real < 0).length;
  console.log(`${name.padEnd(6)} n ${String(rows.length).padStart(4)}  error sd ${(sd(err) * 100).toFixed(1)}% of the week  mean |error| ${(mean(rows.map(r => Math.abs(r.real - r.badge))) / STAR).toFixed(2)}★  badge ≥ 1★ but the week fell: ${flips}/${liked.length} (${(flips / Math.max(1, liked.length) * 100).toFixed(0)}%)`);
};
console.log(`\nweek seed sd ${(mean(seedSd) * 100).toFixed(1)}% of the score`);
report('one', one);
report('two', two);
