#!/usr/bin/env node
// How hard is each event week? The bot builds its boards up to weeks 8, 12 and
// 16; each board is scored with the event and with no event at all, and the
// quota multiplier divided by that score ratio is the week's hardness (§14.2).
//   node harness/eventprice.mjs [--events fog,snowstorm] [--weeks 8,12,16] [--boards 4,2,2] [--seeds 16]
import * as G from '../src/game/run.js';
import { EVENTS, EVENT_KEYS } from '../src/data/events.js';
import { simulateWeek, simulateWeeks } from '../src/sim/sim.js';
import { hashString } from '../src/sim/rng.js';
import { playRun, applySets } from './bot.mjs';

const args = process.argv.slice(2);
applySets(args);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const KEYS = opt('events', EVENT_KEYS.join(',')).split(',');
const WEEKS = opt('weeks', '8,12,16').split(',').map(Number);
const BOARDS = opt('boards', '4,2,2').split(',').map(Number);
const SEEDS = Number(opt('seeds', 16));
const SEED0 = Number(opt('seed0', 1000));

// The event's mods, frozen the way computeMods sees them on an event week. A
// one-entry plan puts the event on every event week; Back Taxes changes nothing
// in the sim, so it is the quiet week to compare against.
const modsFor = (s, key) => G.computeMods({ ...s, eventPlan: [key], strikeChoice: null });
const score = (s, key) => {
  const mods = modsFor(s, key), n = EVENTS[key].repeat || 1;
  let t = 0;
  for (let i = 0; i < SEEDS; i++) {
    const seed = hashString(`price:${i}`);
    t += (n > 1 ? simulateWeeks(s.board, { seed, week: s.week, mods }, n) : simulateWeek(s.board, { seed, week: s.week, mods })).score;
  }
  return t / SEEDS;
};

const rows = Object.fromEntries(KEYS.map(k => [k, []]));
WEEKS.forEach((week, wi) => {
  const boards = [];
  for (let seed = SEED0; boards.length < (BOARDS[wi] ?? BOARDS[BOARDS.length - 1]) && seed < SEED0 + 60; seed++) {
    const { s, died } = playRun({ seed, weeks: week, stopBefore: week });
    if (!died && s.week === week) boards.push(s);
  }
  const quiet = boards.map(s => score(s, 'back_taxes'));
  for (const k of KEYS) {
    const ratio = boards.reduce((a, s, i) => a + score(s, k) / quiet[i], 0) / boards.length;
    rows[k].push(`${ratio.toFixed(2)} -> ${(G.eventMult({ key: k, ...EVENTS[k] }) / ratio).toFixed(2)}`);
  }
  console.error(`week ${week}: ${boards.length} boards, ${boards.map(s => s.board.tiles.length).join('/')} tiles`);
});
console.log(`event`.padEnd(20) + WEEKS.map(w => `w${w}`.padEnd(15)).join(''));
for (const k of KEYS) console.log(EVENTS[k].name.padEnd(20) + rows[k].map(r => r.padEnd(15)).join(''));
