// ============================================================================
// Run state and actions. Plain mutable state object + functions; the UI
// re-renders after every action. Everything here is DOM-free.
// ============================================================================
import { CONFIG, quotaForWeek, apForWeek } from '../config.js';
import { TRANSPORTS, AMENITIES, NAMED_UPGRADES, BRIDGE, tileDef } from '../data/tiles.js';
import { EVENTS, EVENT_KEYS } from '../data/events.js';
import { CARDS } from '../data/cards.js';
import { ORDINANCES, ORDINANCE_KEYS } from '../data/ordinances.js';
import { MODES } from '../data/modes.js';
import { Rng, hashString } from '../sim/rng.js';
import { createBoard, cloneBoard, checkPlacement, placeTile, removeTile, LOCK_TERRAINS } from '../sim/board.js';
import { simulateWeek, mergeMods } from '../sim/sim.js';

export function createRun({ modeKey = 'terminal', seed = null } = {}) {
  const mode = MODES[modeKey];
  seed = seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(hashString(seed + ':events'));
  // event plan: shuffled cycles of all events
  const plan = [];
  while (plan.length < 12) plan.push(...rng.shuffle(EVENT_KEYS));
  const state = {
    seed, modeKey, week: 1, phase: 'shop', ap: 0, apPermanentBonus: 0, apThisWeek: 0,
    money: CONFIG.run.startMoney,
    board: createBoard(mode.w, mode.h, mode.preLock || {}),
    shop: { cards: [], rerolls: 0 },
    eventPlan: plan, surveyed: false,
    ordinances: [], pendingOrdinance: null,
    effects: [], strikeChoice: null, grandOpening: null,
    lastResult: null, history: [], won: false, log: [],
    records: { bestWeek: 0, bestTraveller: 0, bestScore: 0 },
  };
  state.ap = apForRun(state);
  state.shop.cards = generateShop(state);
  return state;
}

export const modeOf = s => MODES[s.modeKey];
export function apForRun(s) {
  const m = modeOf(s);
  if (m.fixedAP) return m.fixedAP + s.apPermanentBonus;
  return apForWeek(s.week, m) + s.apPermanentBonus;
}
export function isEventWeek(s, week = s.week) { return week % CONFIG.run.eventEvery === 0; }
export function eventForWeek(s, week) {
  if (!isEventWeek(s, week)) return null;
  const k = s.eventPlan[(week / CONFIG.run.eventEvery - 1) % s.eventPlan.length];
  return { key: k, ...EVENTS[k] };
}
export function currentEvent(s) { return eventForWeek(s, s.week); }
export function nextEventWeek(s) { const e = CONFIG.run.eventEvery; return isEventWeek(s) ? s.week + e : Math.ceil(s.week / e) * e; }
export function gameRules(s) {
  const r = { deleteRefund: CONFIG.economy.deleteRefund, deleteFreeAP: false, quotaMult: 1 };
  for (const k of s.ordinances) Object.assign(r, ORDINANCES[k].game || {});
  return r;
}
export function quotaFor(s, week = s.week) {
  const ev = eventForWeek(s, week);
  return quotaForWeek(week, modeOf(s), (ev ? ev.quota : 1) * gameRules(s).quotaMult);
}
export function tileCount(s) { return s.board.tiles.length; }
export function tileCost(s, def) {
  const m = modeOf(s);
  let c = def.cost * (1 + CONFIG.economy.tileCostScalePerTile * tileCount(s)) * (m.costMult || 1);
  if (def.kind === 'transport' && m.terrainCostMult && m.terrainCostMult[def.terrain]) c *= m.terrainCostMult[def.terrain];
  return Math.round(c);
}
export function cardCost(s, card) {
  if (card.type === 'tile') return tileCost(s, tileDef(card.key));
  if (card.type === 'bridge') return Math.round(BRIDGE.cost * (1 + CONFIG.economy.tileCostScalePerTile * tileCount(s)));
  return card.cost;
}
export function upgradeCost(tile) {
  const lvl = tile.level || 1;
  if (lvl >= CONFIG.economy.maxLevel) return null;
  return CONFIG.economy.upgradeCosts[lvl - 1];
}
export function rerollFee(s) {
  const f = CONFIG.economy.rerollFees;
  return f[Math.min(s.shop.rerolls, f.length - 1)];
}

// ----------------------------------------------------------------------- shop
function tileWeight(def, week) {
  const target = CONFIG.shop.targetCostBase * Math.pow(CONFIG.shop.targetCostGrowth, week - 1);
  const d = Math.log(def.cost / target);
  return Math.exp(-(d * d) / (2 * CONFIG.shop.targetCostSigma * CONFIG.shop.targetCostSigma)) + 0.02;
}
function transportPool(s, rareOnly = false) {
  const m = modeOf(s);
  return Object.entries(TRANSPORTS).filter(([k, d]) => d.minWeek <= s.week && !!d.rare === rareOnly && !(m.banTerrains || []).includes(d.terrain) && !(d.rare && s.week < CONFIG.run.rareTilesFromWeek)).map(([k, d]) => ({ key: k, kind: 'transport', ...d }));
}
function amenityPool(s, rareOnly = false) {
  return Object.entries(AMENITIES).filter(([k, d]) => d.minWeek <= s.week && !!d.rare === rareOnly).map(([k, d]) => ({ key: k, kind: 'amenity', ...d }));
}
let cardSeq = 0;
function tileCard(def, slot) { return { id: 'c' + (++cardSeq), slot, type: 'tile', key: def.key, name: def.name, kind: def.kind, cost: def.cost, desc: '' }; }

export function generateShop(s) {
  const rng = new Rng(hashString(`${s.seed}:shop:${s.week}:${s.shop.rerolls}`));
  const m = modeOf(s);
  const nSlots = m.shopSlots || CONFIG.shop.slots;
  const cards = [];
  const pickTile = (pool, avoid) => {
    const filtered = pool.filter(d => !avoid.has(d.key));
    const use = filtered.length ? filtered : pool;
    return rng.weighted(use, d => tileWeight(d, s.week));
  };
  const used = new Set();
  const addTransport = slot => { const d = pickTile(transportPool(s), used); used.add(d.key); cards.push(tileCard(d, slot)); };
  const addAmenity = slot => { const d = pickTile(amenityPool(s), used); used.add(d.key); cards.push(tileCard(d, slot)); };
  const addUpgrade = slot => cards.push({ id: 'c' + (++cardSeq), slot, type: 'upgrade', name: 'Upgrade Token', cost: 0, desc: 'Raise any owned tile one level. Cost depends on its current level (60 / 140 / 300 / 650).', target: 'tile' });
  const addWildcard = slot => {
    const w = { ...CONFIG.shop.wildcard };
    if (s.week < CONFIG.run.rareTilesFromWeek) w.rare = 0;
    if (s.board.tiles.length === 0) { w.upgrade = 0; w.namedUpgrade = 0; }
    if (s.week < CONFIG.run.apUpgradeFromWeek) w.apUpgrade = 0;
    const named = Object.entries(NAMED_UPGRADES).filter(([k, d]) => d.minWeek <= s.week);
    if (!named.length) w.namedUpgrade = 0;
    const kind = rng.weighted(Object.keys(w), k => w[k]);
    if (kind === 'card') { const k = rng.pick(Object.keys(CARDS)); cards.push({ id: 'c' + (++cardSeq), slot, type: 'card', key: k, name: CARDS[k].name, cost: CARDS[k].cost, desc: CARDS[k].desc, target: CARDS[k].target }); }
    else if (kind === 'rare') { const pool = [...transportPool(s, true), ...amenityPool(s, true)]; if (pool.length) { const d = rng.pick(pool); cards.push(tileCard(d, slot)); } else addUpgrade(slot); }
    else if (kind === 'bridge') cards.push({ id: 'c' + (++cardSeq), slot, type: 'bridge', key: 'bridge', name: BRIDGE.name, kind: 'bridge', cost: BRIDGE.cost, desc: 'Place along a claimed edge: opens that span so any transport type may attach there. Walkable.' });
    else if (kind === 'upgrade') addUpgrade(slot);
    else if (kind === 'apUpgrade') cards.push({ id: 'c' + (++cardSeq), slot, type: 'ap', name: 'Extra Shift', cost: CONFIG.run.apUpgradeCost, desc: 'Permanent +1 AP per week.' });
    else if (kind === 'namedUpgrade') { const [k, d] = rng.pick(named); cards.push({ id: 'c' + (++cardSeq), slot, type: 'named_upgrade', key: k, name: d.name, cost: d.cost, desc: d.desc, target: d.target }); }
  };
  const pattern = ['transport', 'amenity', 'amenity', 'upgrade', 'wildcard', 'transport', 'amenity', 'wildcard'];
  for (let i = 0; i < nSlots; i++) {
    const kind = pattern[i % pattern.length];
    if (kind === 'transport') addTransport(i);
    else if (kind === 'amenity') addAmenity(i);
    else if (kind === 'upgrade') { if (s.board.tiles.length === 0) addAmenity(i); else addUpgrade(i); }
    else addWildcard(i);
  }
  return cards;
}

// -------------------------------------------------------------------- actions
function fail(reason) { return { ok: false, reason }; }
function log(s, msg) { s.log.push(`W${s.week}: ${msg}`); if (s.log.length > 200) s.log.shift(); }
function removeCard(s, card) { s.shop.cards = s.shop.cards.filter(c => c.id !== card.id); }

export function placementCheck(s, key, x, y, rot) { return checkPlacement(s.board, key, x, y, rot, modeOf(s)); }

export function buyTile(s, card, x, y, rot) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  if (s.ap < 1) return fail('No action points left');
  const cost = cardCost(s, card);
  if (s.money < cost) return fail(`Need $${cost}`);
  const c = placementCheck(s, card.key, x, y, rot);
  if (!c.ok) return fail(c.reason);
  const tile = placeTile(s.board, card.key, x, y, rot, c, modeOf(s));
  tile.paid = cost;
  s.money -= cost; s.ap -= 1;
  removeCard(s, card);
  log(s, `Placed ${tile.name} for $${cost}`);
  for (const cl of c.claims) log(s, `${cl.edge} edge claimed as ${cl.terrain}${cl.lock ? ' (locked)' : ''}`);
  return { ok: true, tile };
}

export function upgradeTile(s, card, tileId) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  if (s.ap < 1) return fail('No action points left');
  const tile = s.board.tiles.find(t => t.id === tileId);
  if (!tile || tile.kind === 'bridge') return fail('Pick a tile to upgrade');
  const def = tileDef(tile.key);
  if (card.type === 'upgrade') {
    const cost = upgradeCost(tile);
    if (cost == null) return fail('Already at max level');
    if (s.money < cost) return fail(`Need $${cost}`);
    tile.level++; s.money -= cost; s.ap -= 1; removeCard(s, card);
    log(s, `Upgraded ${tile.name} to L${tile.level} for $${cost}`);
    return { ok: true };
  }
  if (card.type === 'named_upgrade') {
    const nu = NAMED_UPGRADES[card.key];
    if (s.money < nu.cost) return fail(`Need $${nu.cost}`);
    if (nu.target === 'coffee' && tile.key !== 'coffee') return fail('Espresso Bar needs a Coffee Shop');
    if (nu.target === 'transport' && tile.kind !== 'transport') return fail('Needs a transport tile');
    if (nu.target === 'amenity' && (tile.kind !== 'amenity' || def.rate <= 0)) return fail('Needs a service amenity');
    if (nu.target === 'waiting_all') {
      for (const t of s.board.tiles) if (tileDef(t.key).special === 'waiting') t.level = Math.min(CONFIG.economy.maxLevel, t.level + nu.levels);
    } else {
      tile.level = Math.min(CONFIG.economy.maxLevel, tile.level + nu.levels);
      if (nu.radiusBonus) tile.radiusBonus = (tile.radiusBonus || 0) + nu.radiusBonus;
    }
    s.money -= nu.cost; s.ap -= 1; removeCard(s, card);
    log(s, `${nu.name} applied`);
    return { ok: true };
  }
  return fail('Not an upgrade card');
}

export function deleteTile(s, tileId) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  const rules = gameRules(s);
  if (!rules.deleteFreeAP && s.ap < 1) return fail('No action points left');
  const t = removeTile(s.board, tileId);
  if (!t) return fail('No such tile');
  if (!rules.deleteFreeAP) s.ap -= 1;
  const refund = Math.round((t.paid || 0) * rules.deleteRefund);
  s.money += refund;
  log(s, `Deleted ${t.name}${refund ? ` (refund $${refund})` : ''}`);
  return { ok: true };
}

export function reroll(s) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  if (s.ap < 1) return fail('No action points left');
  const fee = rerollFee(s);
  if (s.money < fee) return fail(`Need $${fee}`);
  s.money -= fee; s.ap -= 1; s.shop.rerolls++;
  s.shop.cards = generateShop(s);
  log(s, `Rerolled the shop for $${fee}`);
  return { ok: true };
}

export function wait(s) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  if (s.ap < 1) return fail('No action points left');
  const interest = Math.min(CONFIG.economy.waitInterestCap, Math.round(s.money * CONFIG.economy.waitInterestRate));
  s.money += interest; s.ap = 0;
  log(s, `Waited: +$${interest} interest`);
  return { ok: true, interest };
}

export function buyAP(s, card) {
  if (s.ap < 1) return fail('No action points left');
  if (s.money < card.cost) return fail(`Need $${card.cost}`);
  s.money -= card.cost; s.ap -= 1; s.apPermanentBonus++; removeCard(s, card);
  log(s, 'Bought a permanent +1 AP');
  return { ok: true };
}

export function playCard(s, card, target = null) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  if (card.type === 'ap') return buyAP(s, card);
  if (card.type !== 'card') return fail('Not a bonus card');
  if (s.ap < 1) return fail('No action points left');
  if (s.money < card.cost) return fail(`Need $${card.cost}`);
  const def = CARDS[card.key];
  const tile = target && target.tileId != null ? s.board.tiles.find(t => t.id === target.tileId) : null;
  switch (card.key) {
    case 'overtime': s.ap += 2; break;
    case 'rezoning': {
      const e = target && target.edge;
      if (!e || s.board.edges[e] === 'green') return fail('Pick a claimed edge');
      s.board.edges[e] = 'green'; break;
    }
    case 'grand_opening':
      if (!tile || tile.kind !== 'amenity' || tileDef(tile.key).rate <= 0) return fail('Pick a service amenity');
      s.effects.push({ name: def.name + ': ' + tile.name, weeksLeft: 1, mods: { grandOpeningTileId: tile.id } }); break;
    case 'timetable': {
      if (!tile || tile.kind !== 'transport') return fail('Pick a transport tile');
      const rng = new Rng(hashString(`${s.seed}:tt:${s.week}:${tile.id}`));
      const base = TRANSPORTS[tile.key].arr;
      const options = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16].filter(v => v !== (tile.arrOverride || base) && v >= Math.max(1, base - 3) && v <= base + 3);
      tile.arrOverride = rng.pick(options.length ? options : [base]);
      break;
    }
    case 'survey_crew': s.surveyed = true; break;
    default:
      if (def.effect) s.effects.push({ name: def.name, weeksLeft: def.weeks || 1, mods: def.effect });
  }
  s.money -= card.cost; s.ap -= 1; removeCard(s, card);
  log(s, `Played ${def.name}`);
  return { ok: true };
}

export function setStrike(s, terrain) { s.strikeChoice = terrain; return { ok: true }; }

export function chooseOrdinance(s, key) {
  if (!s.pendingOrdinance || !s.pendingOrdinance.includes(key)) return fail('Not offered');
  s.ordinances.push(key); s.pendingOrdinance = null;
  log(s, `Ordinance: ${ORDINANCES[key].name}`);
  return { ok: true };
}

// --------------------------------------------------------------- modifiers
export function computeMods(s, week = s.week) {
  const list = [];
  const ev = eventForWeek(s, week);
  if (ev) {
    const m = { ...ev.mods };
    if (m.strike) { delete m.strike; if (s.strikeChoice) m.strikeTerrain = s.strikeChoice; }
    list.push(m);
  }
  for (const k of s.ordinances) list.push(ORDINANCES[k].mods || {});
  for (const e of s.effects) list.push(e.mods);
  return mergeMods(...list);
}

export function transportTerrainsOnBoard(s) {
  return [...new Set(s.board.tiles.filter(t => t.kind === 'transport').map(t => t.terrain))];
}

// ------------------------------------------------------------ simulation
export function simulateCurrent(s, seed = null, seeds = 1) {
  const mods = computeMods(s);
  if (seeds === 1) return simulateWeek(s.board, { seed: seed ?? hashString(`${s.seed}:w${s.week}`), week: s.week, mods });
  const out = [];
  for (let i = 0; i < seeds; i++) out.push(simulateWeek(s.board, { seed: hashString(`${s.seed}:est:${i}`), week: s.week, mods }));
  return out;
}

export function runWeek(s) {
  if (s.phase !== 'shop') return fail('Not in shop phase');
  const ev = currentEvent(s);
  if (ev && ev.mods.strike && !s.strikeChoice) {
    const terrains = transportTerrainsOnBoard(s);
    s.strikeChoice = terrains[0] || 'road';
  }
  const result = simulateCurrent(s);
  s.lastResult = result;
  s.phase = 'summary';
  return { ok: true, result };
}

export function settle(s) {
  if (s.phase !== 'summary' || !s.lastResult) return fail('Nothing to settle');
  const r = s.lastResult;
  const quota = quotaFor(s);
  s.money += r.money.total;
  const passed = r.score >= quota;
  s.history.push({ week: s.week, score: r.score, quota, money: r.money.total, passed, event: currentEvent(s)?.name || null });
  s.records.bestWeek = Math.max(s.records.bestWeek, s.week);
  s.records.bestScore = Math.max(s.records.bestScore, r.score);
  if (r.best) s.records.bestTraveller = Math.max(s.records.bestTraveller, Math.round(r.best.value));
  if (!passed) { s.phase = 'lost'; log(s, `Week ${s.week}: ${r.score} < quota ${quota}. Run over.`); return { ok: true, passed: false }; }
  if (s.week === CONFIG.run.winWeek && !s.won) { s.won = true; s.phase = 'won'; }
  else s.phase = 'shop';
  advanceWeek(s);
  return { ok: true, passed: true };
}

export function continueAfterWin(s) { if (s.phase === 'won') s.phase = 'shop'; }

function advanceWeek(s) {
  s.week++;
  s.ap = apForRun(s);
  s.shop.rerolls = 0;
  s.strikeChoice = null; s.surveyed = false;
  for (const e of s.effects) e.weeksLeft--;
  s.effects = s.effects.filter(e => e.weeksLeft > 0);
  s.shop.cards = generateShop(s);
  if (CONFIG.run.ordinanceWeeks.includes(s.week)) {
    const rng = new Rng(hashString(`${s.seed}:ord:${s.week}`));
    const pool = ORDINANCE_KEYS.filter(k => !s.ordinances.includes(k));
    s.pendingOrdinance = rng.shuffle(pool).slice(0, CONFIG.run.ordinanceChoices);
  }
}

// ----------------------------------------------------------- estimates
export function estimatePlacement(s, key, x, y, rot, seeds = CONFIG.placement.previewSeeds) {
  const c = placementCheck(s, key, x, y, rot);
  if (!c.ok) return null;
  const mods = computeMods(s);
  const before = cloneBoard(s.board);
  const after = cloneBoard(s.board);
  placeTile(after, key, x, y, rot, null, modeOf(s));
  const dp = [], dm = [];
  for (let i = 0; i < seeds; i++) {
    const seed = hashString(`${s.seed}:est:${i}`);
    const a = simulateWeek(before, { seed, week: s.week, mods });
    const b = simulateWeek(after, { seed, week: s.week, mods });
    dp.push(b.score - a.score); dm.push(b.money.total - a.money.total);
  }
  dp.sort((a, b) => a - b); dm.sort((a, b) => a - b);
  return { ptsLo: dp[0], ptsHi: dp[dp.length - 1], cashLo: dm[0], cashHi: dm[dm.length - 1] };
}

export function estimateCurrent(s, seeds = CONFIG.placement.previewSeeds) {
  const rs = simulateCurrent(s, null, seeds);
  const sc = rs.map(r => r.score).sort((a, b) => a - b);
  const mo = rs.map(r => r.money.total).sort((a, b) => a - b);
  return { ptsLo: sc[0], ptsHi: sc[sc.length - 1], cashLo: mo[0], cashHi: mo[mo.length - 1] };
}

// ------------------------------------------------------------ persistence
export function serialize(s) {
  const copy = { ...s, lastResult: null };
  return JSON.stringify(copy);
}
export function deserialize(json) {
  const s = JSON.parse(json);
  if (s.phase === 'summary') s.phase = 'shop';
  return s;
}
