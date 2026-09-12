// The greedy autoplay bot as a module, so other harness tools can build a
// realistic mid-run board: play `weeks` weeks and hand back the run state.
import * as G from '../src/game/run.js';
import { tileDef } from '../src/data/tiles.js';
import { orientationCount } from '../src/sim/shapes.js';
import { Rng } from '../src/sim/rng.js';
export { applySets } from './sets.mjs';
import { cloneBoard, removeTile } from '../src/sim/board.js';
import { simulateWeek } from '../src/sim/sim.js';
import { hashString } from '../src/sim/rng.js';

export function legalPlacements(s, key, rng, limit) {
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

// What the week would score without one tile, on the estimate seeds.
function scoreWithout(s, tileId, seeds = 2) {
  const mods = G.computeMods(s);
  const b = cloneBoard(s.board);
  removeTile(b, tileId);
  let pts = 0, cash = 0;
  for (let i = 0; i < seeds; i++) { const r = simulateWeek(b, { seed: hashString(`${s.seed}:est:${i}`), week: s.week, mods }); pts += r.score; cash += r.money.total; }
  return { pts: pts / seeds, cash: cash / seeds };
}

export function greedyAction(s, rng, cands = 10, { prune = true } = {}) {
  const quota = G.quotaFor(s);
  let best = null;
  const consider = (score, act, label) => { if (!best || score > best.score) best = { score, act, label }; };
  // Pruning: a tile whose removal scores better is a mistake worth undoing,
  // and cheap to undo when deletion costs no AP.
  if (prune && s.board.tiles.length > 1) {
    const now = G.estimateCurrent(s, 2);
    const nowPts = now.pts, nowCash = now.cash;
    const rules = G.gameRules(s);
    for (const t of s.board.tiles) {
      if (t.kind === 'bridge') continue;
      const w = scoreWithout(s, t.id);
      const pts = w.pts - nowPts, cash = w.cash - nowCash;
      if (pts <= 0) continue;
      const v = pts / quota * 100 + cash / 50 * 6 - (rules.deleteFreeAP ? 0 : 2);
      consider(v, () => G.deleteTile(s, t.id), `Delete ${t.name} (~+${Math.round(pts)} pts)`);
    }
  }
  for (const card of s.shop.cards) {
    if (card.type === 'tile' || card.type === 'bridge') {
      const cost = G.cardCost(s, card);
      if (cost > s.money) continue;
      const def = tileDef(card.key);
      // prefer not to lock edges for lock terrains unless the tile is strong; the bot just tries
      const places = legalPlacements(s, card.key, rng, cands);
      for (const p of places) {
        const est = G.estimatePlacement(s, card.key, p.x, p.y, p.r, 2);
        if (!est) continue;
        const pts = est.pts, cash = est.cash;
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
        const pts = after.pts - before.pts;
        const cash = after.cash - before.cash;
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

export function naiveAction(s, rng) {
  const affordable = s.shop.cards.filter(c => (c.type === 'tile') && G.cardCost(s, c) <= s.money);
  if (!affordable.length) return { act: () => ({ ok: true, pass: true }), label: 'Run early' };
  const card = rng.pick(affordable);
  const places = legalPlacements(s, card.key, rng, 1);
  if (!places.length) return { act: () => ({ ok: true, pass: true }), label: 'Run early' };
  const p = places[0];
  return { act: () => G.buyTile(s, card, p.x, p.y, p.r), label: `${card.name}@${p.x},${p.y}` };
}

// Play one run. `onWeek(s, result, quota)` is called after each week runs, before
// settlement. Returns { s, died, ratios } where ratios[week] = score / quota.
// `stopBefore` ends the run in the shop phase of that week (a board to probe).
export function playRun({ seed, weeks = 16, mode = 'terminal', difficulty = 'standard', policy = 'greedy', cands = 10, verbose = false, stopBefore = null, onWeek = null, prune = true }) {
  const s = G.createRun({ modeKey: mode, diffKey: difficulty, seed });
  const rng = new Rng(seed);
  let died = null;
  const ratios = {};
  while (s.week <= weeks) {
    if (s.pendingOrdinance) G.chooseOrdinance(s, s.pendingOrdinance[0]);
    if (s.phase === 'won') G.continueAfterWin(s);
    if (stopBefore != null && s.week >= stopBefore) break;
    let guard = 0;
    while (s.ap > 0 && guard++ < 12) {
      const a = policy === 'naive' ? naiveAction(s, rng) : greedyAction(s, rng, cands, { prune });
      const r = a.act();
      if (verbose) console.log(`  seed ${seed} w${s.week} AP${s.ap} $${s.money}: ${a.label} -> ${r.ok ? 'ok' : r.reason}`);
      if (!r.ok || r.pass) break;   // unspent AP is paid out when the week runs
    }
    const quota = G.quotaFor(s);
    const { result } = G.runWeek(s);
    ratios[s.week] = result.score / quota;
    if (verbose) console.log(`seed ${seed} week ${s.week}: score ${result.score} / quota ${quota} (${ratios[s.week].toFixed(2)}) money +${result.money.total} -> $${s.money + result.money.total}  tiles ${s.board.tiles.length}  spawned ${result.counts.spawned} stranded ${result.counts.stranded}  ev=${G.currentEvent(s)?.name || '-'}`);
    if (onWeek) onWeek(s, result, quota);
    const st = G.settle(s);
    if (!st.passed) { died = s.week; break; }
  }
  return { s, died, ratios };
}

export const boardSpec = s => ({ mode: s.modeKey, difficulty: s.diffKey, week: s.week, tiles: s.board.tiles.map(t => ({ key: t.key, x: t.x, y: t.y, rot: t.rot, level: t.level })) });
