#!/usr/bin/env node
// Autoplay bot: plays full runs through the real game layer with a greedy
// heuristic, to see where runs die and how score tracks quota.
//   node harness/autoplay.js --runs 5 --weeks 16 --mode terminal [--seed0 1000] [--policy greedy|naive] [--verbose]
import * as G from '../src/game/run.js';
import { tileDef } from '../src/data/tiles.js';
import { orientationCount } from '../src/sim/shapes.js';
import { Rng } from '../src/sim/rng.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(opt('runs', 4)), WEEKS = Number(opt('weeks', 16)), MODE = opt('mode', 'terminal'), POLICY = opt('policy', 'greedy');
const VERBOSE = args.includes('--verbose');
const CANDS = Number(opt('cands', 10));
// Base seed for the run population. Vary it to check whether a shift in the
// survival rate is a real balance move or just this set of 16 runs.
const SEED0 = Number(opt('seed0', 1000));

function legalPlacements(s, key, rng, limit) {
  const def = tileDef(key);
  const b = s.board;
  const out = [];
  const nRot = orientationCount(def.shape);
  const tries = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) for (let r = 0; r < nRot; r++) tries.push([x, y, r]);
  for (const [x, y, r] of rng.shuffle(tries)) {
    const c = G.placementCheck(s, key, x, y, r);
    if (c.ok) { out.push({ x, y, r, c }); if (out.length >= limit) break; }
  }
  return out;
}

function greedyAction(s, rng) {
  const quota = G.quotaFor(s);
  let best = null;
  const consider = (score, act, label) => { if (!best || score > best.score) best = { score, act, label }; };
  for (const card of s.shop.cards) {
    if (card.type === 'tile' || card.type === 'bridge') {
      const cost = G.cardCost(s, card);
      if (cost > s.money) continue;
      const def = tileDef(card.key);
      // prefer not to lock edges for lock terrains unless the tile is strong; the bot just tries
      const places = legalPlacements(s, card.key, rng, CANDS);
      for (const p of places) {
        const est = G.estimatePlacement(s, card.key, p.x, p.y, p.r, 2);
        if (!est) continue;
        const pts = (est.ptsLo + est.ptsHi) / 2, cash = (est.cashLo + est.cashHi) / 2;
        // value: points relative to quota, cash relative to cost
        const v = pts / quota * 100 + cash / Math.max(20, cost) * 6 - cost / Math.max(50, s.money) * 2;
        consider(v, () => G.buyTile(s, card, p.x, p.y, p.r), `${def.name}@${p.x},${p.y} (~${Math.round(pts)} pts, ~$${Math.round(cash)}, cost ${cost})`);
      }
    } else if (card.type === 'upgrade' || card.type === 'named_upgrade') {
      for (const t of s.board.tiles) {
        if (t.kind === 'bridge') continue;
        const cost = card.type === 'upgrade' ? G.upgradeCost(t) : card.cost;
        if (cost == null || cost > s.money) continue;
        // estimate by simulating a level bump
        const before = G.estimateCurrent(s, 2);
        t.level++;
        const after = G.estimateCurrent(s, 2);
        t.level--;
        const pts = ((after.ptsLo + after.ptsHi) - (before.ptsLo + before.ptsHi)) / 2;
        const cash = ((after.cashLo + after.cashHi) - (before.cashLo + before.cashHi)) / 2;
        const v = pts / quota * 100 + cash / Math.max(20, cost) * 6 - cost / Math.max(50, s.money) * 2;
        consider(v, () => G.upgradeTile(s, card, t.id), `Upgrade ${t.name} L${t.level}->${t.level + 1} (~${Math.round(pts)} pts, cost ${cost})`);
      }
    } else if (card.type === 'card' && card.target === 'none' && card.cost <= s.money && ['overtime', 'fast_pass', 'charter_bus'].includes(card.key)) {
      consider(3, () => G.playCard(s, card), `Play ${card.name}`);
    }
  }
  if (!best || best.score < 1.5) {
    if (s.money < 60 && s.shop.rerolls === 0 && s.ap >= 2 && best) return best;
    return { score: 0, act: () => ({ ok: true, pass: true }), label: 'Run early' };
  }
  return best;
}

function naiveAction(s, rng) {
  const affordable = s.shop.cards.filter(c => (c.type === 'tile') && G.cardCost(s, c) <= s.money);
  if (!affordable.length) return { act: () => ({ ok: true, pass: true }), label: 'Run early' };
  const card = rng.pick(affordable);
  const places = legalPlacements(s, card.key, rng, 1);
  if (!places.length) return { act: () => ({ ok: true, pass: true }), label: 'Run early' };
  const p = places[0];
  return { act: () => G.buyTile(s, card, p.x, p.y, p.r), label: `${card.name}@${p.x},${p.y}` };
}

const outcomes = [];
const ratioByWeek = {};
for (let run = 0; run < RUNS; run++) {
  const seed = SEED0 + run;
  const s = G.createRun({ modeKey: MODE, seed });
  const rng = new Rng(seed);
  let died = null;
  while (s.week <= WEEKS) {
    if (s.pendingOrdinance) G.chooseOrdinance(s, s.pendingOrdinance[0]);
    if (s.phase === 'won') G.continueAfterWin(s);
    let guard = 0;
    while (s.ap > 0 && guard++ < 12) {
      const a = POLICY === 'naive' ? naiveAction(s, rng) : greedyAction(s, rng);
      const r = a.act();
      if (VERBOSE) console.log(`  run ${run} w${s.week} AP${s.ap} $${s.money}: ${a.label} -> ${r.ok ? 'ok' : r.reason}`);
      if (!r.ok || r.pass) break;   // unspent AP is paid out when the week runs
    }
    const quota = G.quotaFor(s);
    const { result } = G.runWeek(s);
    const ratio = result.score / quota;
    (ratioByWeek[s.week] = ratioByWeek[s.week] || []).push(ratio);
    if (VERBOSE) console.log(`run ${run} week ${s.week}: score ${result.score} / quota ${quota} (${ratio.toFixed(2)}) money +${result.money.total} -> $${s.money + result.money.total}  tiles ${s.board.tiles.length}  spawned ${result.counts.spawned} stranded ${result.counts.stranded}  ev=${G.currentEvent(s)?.name || '-'}`);
    const st = G.settle(s);
    if (!st.passed) { died = s.week; break; }
  }
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
