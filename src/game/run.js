// ============================================================================
// Run state and actions. Plain mutable state object + functions; the UI
// re-renders after every action. Everything here is DOM-free.
// ============================================================================
import { CONFIG, quotaForWeek, apForWeek, starTarget } from '../config.js';
import { TRANSPORTS, AMENITIES, NAMED_UPGRADES, BRIDGE, tileDef, tileUpgrade } from '../data/tiles.js';
import { EVENTS, EVENT_KEYS, MILESTONES } from '../data/events.js';
import { CARDS } from '../data/cards.js';
import { ORDINANCES, ORDINANCE_KEYS } from '../data/ordinances.js';
import { MODES, minWeekOf, soldOnLevel } from '../data/modes.js';
import { DIFFICULTIES } from '../data/difficulties.js';
import { Rng, hashString } from '../sim/rng.js';
import { startBoard, cloneBoard, checkPlacement, placeTile, removeTile, edgeDependents, lineAvailable, LOCK_TERRAINS } from '../sim/board.js';
import { simulateWeek, simulateWeeks, mergeMods } from '../sim/sim.js';

// Bump whenever the shape of the saved run changes (state fields, board or tile
// records). Saves are not migrated: an older one is reported and discarded.
// 9: the balance pass that compressed every multiplier and rebuilt the quota
// curve under it (design doc §15). Nothing about the shape of a save changed,
// but a run saved under the old numbers would reload into a game where its
// board scores roughly 40% less against a quota roughly a quarter lower, which
// is not the run the player left. Discarding is the honest outcome here.
// 10: money weeks and the Double Week (`weekCash`, `cashSwept`), and five new
// events in the plan, so an old plan names weeks that no longer line up.
// 11: extra hours (`hoursBought`) and the endless quota ramp, which moves
// every target past week 16.
export const SAVE_VERSION = 11;

export function createRun({ modeKey = 'terminal', diffKey = 'standard', seed = null } = {}) {
  const mode = MODES[modeKey];
  const diff = DIFFICULTIES[diffKey] || DIFFICULTIES.standard;
  const rules = { ...CONFIG.run, ...(mode.run || {}) };
  seed = seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(hashString(seed + ':events'));
  // event plan: shuffled cycles of all events
  const plan = [];
  while (plan.length < 12) plan.push(...rng.shuffle(EVENT_KEYS));
  const state = {
    version: SAVE_VERSION, seed, modeKey, diffKey, week: 1, phase: 'shop', ap: 0, apPermanentBonus: 0, apThisWeek: 0, hoursBought: 0,
    money: Math.round(rules.startMoney * (diff.startMoneyMult || 1)),
    board: startBoard(mode),
    shop: { cards: [], rerolls: 0 },
    eventPlan: plan, surveyed: false,
    ordinances: [], pendingOrdinance: null,
    effects: [], strikeChoice: null, grandOpening: null,
    weekCash: null, cashSwept: 0,
    lastResult: null, history: [], won: false, log: [],
    records: { bestWeek: 0, bestTraveller: 0, bestScore: 0 },
  };
  state.ap = apForRun(state);
  state.shop.cards = generateShop(state);
  snapshotWeek(state);
  return state;
}

export const modeOf = s => MODES[s.modeKey];
// Run-flow numbers for this level: CONFIG.run with the mode's `run` block on
// top, so a level can move its event cadence, ordinance weeks and the weeks the
// specials switch on without a second copy of the defaults.
export function runRules(s) { return { ...CONFIG.run, ...(modeOf(s).run || {}) }; }
// The week a tile goes on sale here, which the level may have moved.
export function tileMinWeek(s, key, def) { return minWeekOf(modeOf(s), key, def); }
// A run made before difficulties existed, or one hand-built by the harness, is Standard.
export const difficultyOf = s => DIFFICULTIES[s.diffKey] || DIFFICULTIES.standard;
// AP for the week: the mode's flat base, plus Extra Shift purchases, an
// ordinance like Staff Expansion, and any timed effect (Temp Staff) still running.
export function apForRun(s) {
  const m = modeOf(s);
  const extra = s.apPermanentBonus + (gameRules(s).apBonus || 0) + s.effects.reduce((a, e) => a + (e.ap || 0), 0)
    + ((currentEvent(s) || {}).ap || 0);
  if (m.fixedAP) return m.fixedAP + extra;
  return apForWeek(s.week, m) + extra;
}
export function isEventWeek(s, week = s.week) { return week % runRules(s).eventEvery === 0; }
// An event with an `after` field leans on a rule that has not switched on yet
// (a Crime Spree before the crime wave has nothing on sale that answers it), so
// it is skipped and the next event in the plan takes the week. The pick stays a
// function of the week alone, which is what the timeline and the preview cache
// both rely on.
export function eventForWeek(s, week) {
  if (!isEventWeek(s, week)) return null;
  const rules = runRules(s), plan = s.eventPlan, n = plan.length;
  const start = (week / rules.eventEvery - 1) % n;
  for (let i = 0; i < n; i++) {
    const k = plan[(start + i) % n];
    if (!EVENTS[k].after || week >= rules[EVENTS[k].after]) return { key: k, ...EVENTS[k] };
  }
  const k = plan[start];
  return { key: k, ...EVENTS[k] };
}
export function currentEvent(s) { return eventForWeek(s, s.week); }
// The milestone that switches on at this exact week, if any.
export function milestoneForWeek(s, week) {
  const rules = runRules(s);
  return MILESTONES.find(m => rules[m.week] === week) || null;
}
export function nextEventWeek(s) { const e = runRules(s).eventEvery; return isEventWeek(s) ? s.week + e : Math.ceil(s.week / e) * e; }
export function gameRules(s) {
  const r = { deleteRefund: CONFIG.economy.deleteRefund, deleteFreeAP: !CONFIG.economy.deleteCostsAP, deleteRefundsAP: CONFIG.economy.deleteRefundsAP, quotaMult: 1, apBonus: 0, costMult: 1 };
  for (const k of s.ordinances) Object.assign(r, ORDINANCES[k].game || {});
  return r;
}
// What an event actually multiplies the quota by. The UI quotes this, not the
// raw value in data/events.js, so the card and the target always agree.
// `quota.eventStrength` softens the number toward 1 - but only where the event
// asks for MORE. A Convention's x1.6 has to be read against the headroom a
// normal week leaves, and at a tight band it is a wall; a Strike's x0.9 is the
// opposite, an apology for a week that takes half the board's traffic away, and
// softening that is taking the apology back. One strength for both directions
// killed the runs it was meant to protect (§15).
// `exact` opts an event out of the softening entirely: a Double Week's x2 is
// the arithmetic of two weeks, not a demand for a harder one, and pulling it
// toward 1 would hand out a free week.
export function eventMult(ev) {
  if (!ev) return 1;
  if (ev.exact) return ev.quota;
  return ev.quota >= 1 ? 1 + (ev.quota - 1) * CONFIG.quota.eventStrength : ev.quota;
}
export const fmtMult = m => (Math.round(m * 100) / 100).toString();
// Is this week's target set by the published curve, or by the player's own
// form (the catch-up floor)? The timeline says which, so a quota that jumps
// after a big week reads as a consequence rather than a glitch.
export function quotaFromForm(s, week = s.week) {
  const c = CONFIG.quota.catchUp;
  if (!c || !c.share) return false;
  const ev = eventForWeek(s, week);
  return quotaFor(s, week) > quotaForWeek(week, modeOf(s), eventMult(ev) * gameRules(s).quotaMult, difficultyOf(s));
}
export function quotaFor(s, week = s.week) {
  const ev = eventForWeek(s, week);
  const mult = eventMult(ev) * gameRules(s).quotaMult;
  const curve = quotaForWeek(week, modeOf(s), mult, difficultyOf(s));
  const c = CONFIG.quota.catchUp;
  if (!c || !c.share) return curve;
  // Catch-up: a run well ahead of the curve is measured against its own form
  // instead. The floor rides the curve's growth, so weeks further out still
  // climb rather than flattening at what you scored last week.
  const recent = c.from === 'last' ? (s.history.length ? s.history[s.history.length - 1].score : 0) : (s.records.bestScore || 0);
  if (recent <= 0) return curve;
  const grow = quotaForWeek(week, modeOf(s), 1, difficultyOf(s)) / quotaForWeek(Math.max(1, s.week), modeOf(s), 1, difficultyOf(s));
  const u = CONFIG.quota.starUnit;
  // The floor takes no event multiplier: the curve already carries it, and
  // stacking the two makes a convention week on a strong run unsurvivable
  // (measured: every run died, most of them on the first big event, §15).
  // An `exact` multiplier is the one exception, because it is not a demand but
  // arithmetic: a Double Week really is two weeks, so a run's own form counts
  // double that week too. Leaving it out doubled the curve while the floor
  // stayed put, so on a strong run - the only kind the floor binds on - the
  // floor stopped binding and the week paid 1.7x what its neighbours did (§15).
  const exact = ev && ev.exact ? ev.quota : 1;
  const floor = Math.min(c.share * recent * grow * exact, (c.cap || Infinity) * curve);
  return Math.max(curve, Math.round(floor / u) * u);
}
export function tileCount(s) { return s.board.tiles.length; }
export function tileCost(s, def) {
  const m = modeOf(s);
  let c = def.cost * (1 + CONFIG.economy.tileCostScalePerTile * tileCount(s)) * (m.costMult || 1) * (difficultyOf(s).costMult || 1) * gameRules(s).costMult;
  if (def.kind === 'transport' && m.terrainCostMult && m.terrainCostMult[def.terrain]) c *= m.terrainCostMult[def.terrain];
  return Math.round(c);
}
export function cardCost(s, card) {
  if (card.type === 'tile') return tileCost(s, tileDef(card.key));
  if (card.type === 'bridge') return Math.round(BRIDGE.cost * (1 + CONFIG.economy.tileCostScalePerTile * tileCount(s)));
  if (card.type === 'upgrade') return upgradeCardCost(s, card) ?? 0;
  return card.cost;
}
export function upgradeCost(tile, levels = 1, costMult = 1) {
  const lvl = tile.level || 1;
  if (lvl >= CONFIG.economy.maxLevel) return null;
  // a multi-level card costs what those levels would have cost one at a time
  let total = 0;
  for (let i = 0; i < levels && lvl - 1 + i < CONFIG.economy.upgradeCosts.length; i++) total += CONFIG.economy.upgradeCosts[lvl - 1 + i];
  return Math.round(total * costMult);
}

// ------------------------------------------------------------- upgrade cards
// An upgrade card names one tile type you already own. Types with nothing left
// to raise are not offered at all, so an upgrade card is always playable.
export function upgradableKeys(s) {
  const keys = new Set();
  for (const t of s.board.tiles) if (t.kind !== 'bridge' && (t.level || 1) < CONFIG.economy.maxLevel) keys.add(t.key);
  return [...keys];
}
export function upgradeTargets(s, card) {
  return s.board.tiles.filter(t => t.key === card.key && (t.level || 1) < CONFIG.economy.maxLevel);
}
// Cheapest tile of the card's type, which is what its price tag quotes.
export function upgradeCardCost(s, card) {
  const ts = upgradeTargets(s, card);
  if (!ts.length) return null;
  return Math.min(...ts.map(t => upgradeCost(t, card.levels, card.costMult)));
}
// Which category upgrades have something to hit this week.
export function namedUpgradeKeys(s) {
  const below = t => (t.level || 1) < CONFIG.economy.maxLevel;
  return Object.entries(NAMED_UPGRADES).filter(([k, d]) => {
    if (tileMinWeek(s, k, d) > s.week) return false;
    if (d.target === 'waiting_all') return s.board.tiles.some(t => tileDef(t.key).special === 'waiting' && below(t));
    if (d.target === 'transport') return s.board.tiles.some(t => t.kind === 'transport' && below(t));
    if (d.target === 'amenity') return s.board.tiles.some(t => t.kind === 'amenity' && tileDef(t.key).rate > 0 && below(t));
    return false;
  }).map(([k]) => k);
}
export function rerollFee(s) { return CONFIG.economy.rerollCost; }
// Action points a card takes to play: one, except a Rezoning Permit (see economy.rezoningCostsAP).
export function cardAPCost(s, card) { return card.type === 'card' && card.key === 'rezoning' && !CONFIG.economy.rezoningCostsAP ? 0 : 1; }
export function quotaStars(s, week = s.week) { return starTarget(quotaFor(s, week)); }

// Running the week with action points left pays a fixed amount per point,
// growing with the week, so finishing early is a choice rather than a waste.
export function earlyFinishPerAP(s, week = s.week) {
  const e = CONFIG.economy;
  return e.earlyFinishBase + e.earlyFinishPerWeek * (week - 1);
}
export function earlyFinishBonus(s, ap = s.ap) { return earlyFinishPerAP(s) * Math.max(0, ap); }

// Extra hours: cash for an action point, once the week's own are spent. The
// price climbs with the week and doubles with each one bought that week.
export function extraHoursCost(s) {
  const x = CONFIG.economy.extraHours;
  return Math.round(x.base * Math.pow(x.growth, s.week - 1) * Math.pow(x.step, s.hoursBought || 0));
}
export function extraHoursOnSale(s) { return s.phase === 'shop' && s.ap < 1 && s.week >= runRules(s).extraHoursFromWeek; }
export function buyExtraHours(s) {
  if (!extraHoursOnSale(s)) return fail(s.ap >= 1 ? 'Spend the action points you have first' : 'No extra hours here');
  const cost = extraHoursCost(s);
  if (s.money < cost) return fail(`Need $${cost}`);
  s.money -= cost; s.ap += 1; s.hoursBought = (s.hoursBought || 0) + 1;
  log(s, `Paid $${cost} for extra hours`);
  return { ok: true, cost };
}

// ------------------------------------------------------------- money weeks
// An event may reach into the till instead of onto the board. Two of them land
// as the week opens, before the shop has been touched: a fine takes a share of
// what is there, and an emergency budget sets the till to a starting allowance
// that grows with the week - which cuts a hoard down and tops a broke run back
// up. The third waits until the week is run and sweeps up whatever is left. The
// numbers live with the event in data/events.js.
export function cashBaseline(s, week = s.week) {
  const ev = eventForWeek(s, week), g = (ev && ev.cash && ev.cash.resetGrowth) || 1;
  return Math.round(runRules(s).startMoney * (difficultyOf(s).startMoneyMult || 1) * Math.pow(g, week - 1));
}
// What a fine takes out of the till as it stands. Never more than is in it.
function cashFine(s, week = s.week) {
  const ev = eventForWeek(s, week), c = ev && ev.cash;
  if (!c || c.payShare == null) return 0;
  return Math.min(s.money, Math.max(c.payMin || 0, Math.round(s.money * c.payShare)));
}
function applyWeekCash(s) {
  s.weekCash = null;
  const ev = currentEvent(s), c = ev && ev.cash;
  if (!c) return;
  if (c.payShare != null) {
    const paid = cashFine(s);
    if (paid <= 0) return;
    s.money -= paid; s.weekCash = { kind: 'fine', amount: -paid };
    log(s, `${ev.name}: paid $${paid} to the city`);
  } else if (c.resetGrowth != null) {
    const base = cashBaseline(s), delta = base - s.money;
    if (delta === 0) return;
    s.money = base; s.weekCash = { kind: 'reset', amount: delta };
    log(s, `${ev.name}: the till is set to $${base} (${delta > 0 ? '+' : '-'}$${Math.abs(delta)})`);
  }
}

// ----------------------------------------------------------------------- shop
function tileWeight(def, week) {
  const target = CONFIG.shop.targetCostBase * Math.pow(CONFIG.shop.targetCostGrowth, week - 1);
  const d = Math.log(def.cost / target);
  return Math.exp(-(d * d) / (2 * CONFIG.shop.targetCostSigma * CONFIG.shop.targetCostSigma)) + 0.02;
}
// Underground tiles only turn up while their tunnel has somewhere to go: a
// garage needs a road edge, a dock a water edge, a subway an axis clear of water.
function transportPool(s, rareOnly = false) {
  const m = modeOf(s), rareWeek = runRules(s).rareTilesFromWeek;
  return Object.entries(TRANSPORTS).filter(([k, d]) => soldOnLevel(m, d) && minWeekOf(m, k, d) <= s.week && !!d.rare === rareOnly && !(m.banTerrains || []).includes(d.terrain) && !(d.rare && s.week < rareWeek) && lineAvailable(s.board, d)).map(([k, d]) => ({ key: k, kind: 'transport', ...d }));
}
function amenityPool(s, rareOnly = false) {
  const m = modeOf(s);
  return Object.entries(AMENITIES).filter(([k, d]) => soldOnLevel(m, d) && minWeekOf(m, k, d) <= s.week && !!d.rare === rareOnly).map(([k, d]) => ({ key: k, kind: 'amenity', ...d }));
}
// Every tile the shop can draw from this week on this level, rares included
// once they are unlocked. The roll below picks from these pools; the harness and
// the tests read them to see what a level has put on sale.
export function shopPool(s) {
  const rare = s.week >= runRules(s).rareTilesFromWeek;
  return [...transportPool(s), ...amenityPool(s), ...(rare ? [...transportPool(s, true), ...amenityPool(s, true)] : [])];
}

let cardSeq = 0;
const nextId = () => 'c' + (++cardSeq);
function tileCard(def, slot) { return { id: nextId(), slot, type: 'tile', key: def.key, name: def.name, kind: def.kind, cost: def.cost, desc: '' }; }

export function generateShop(s) {
  const rng = new Rng(hashString(`${s.seed}:shop:${s.week}:${s.shop.rerolls}`));
  const m = modeOf(s), rules = runRules(s);
  const nSlots = m.shopSlots || CONFIG.shop.slots;
  const cards = [];
  const used = new Set();          // avoid two of the same tile in one shop
  const pickTile = (pool) => {
    const filtered = pool.filter(d => !used.has(d.key));
    const use = filtered.length ? filtered : pool;
    return rng.weighted(use, d => tileWeight(d, s.week));
  };
  const addTile = (pool, slot) => { if (!pool.length) return false; const d = pickTile(pool); used.add(d.key); cards.push(tileCard(d, slot)); return true; };
  const addTransport = slot => addTile(transportPool(s), slot);
  const addAmenity = slot => addTile(amenityPool(s), slot);
  const addRare = slot => addTile([...transportPool(s, true), ...amenityPool(s, true)], slot);
  const addUpgrade = slot => {
    const keys = upgradableKeys(s).filter(k => !used.has('up:' + k));
    if (!keys.length) return false;
    const key = rng.pick(keys); used.add('up:' + key);
    const u = tileUpgrade(key);
    cards.push({ id: nextId(), slot, type: 'upgrade', key, name: u.name, tileName: u.tileName, levels: u.levels, radiusBonus: u.radiusBonus, costMult: u.costMult, cost: 0, desc: u.desc, target: 'tile' });
    return true;
  };
  const addNamedUpgrade = slot => {
    const keys = namedUpgradeKeys(s).filter(k => !used.has('nu:' + k));
    if (!keys.length) return false;
    const k = rng.pick(keys); used.add('nu:' + k);
    const d = NAMED_UPGRADES[k];
    cards.push({ id: nextId(), slot, type: 'named_upgrade', key: k, name: d.name, cost: d.cost, desc: d.desc, target: d.target });
    return true;
  };
  const addBonusCard = slot => {
    const keys = Object.keys(CARDS).filter(k => !used.has('card:' + k));
    if (!keys.length) return false;
    const k = rng.pick(keys); used.add('card:' + k);
    cards.push({ id: nextId(), slot, type: 'card', key: k, name: CARDS[k].name, cost: CARDS[k].cost, desc: CARDS[k].desc, target: CARDS[k].target });
    return true;
  };
  const addAP = slot => { if (used.has('ap')) return false; used.add('ap'); cards.push({ id: nextId(), slot, type: 'ap', name: 'Extra Shift', cost: rules.apUpgradeCost, desc: 'Permanent +1 AP per week.' }); return true; };
  const addBridge = slot => { cards.push({ id: nextId(), slot, type: 'bridge', key: 'bridge', name: BRIDGE.name, kind: 'bridge', cost: BRIDGE.cost, desc: 'Place along a claimed edge: opens that span so any transport type may attach there. Walkable.' }); return true; };
  const ADD = { transport: addTransport, amenity: addAmenity, upgrade: addUpgrade, namedUpgrade: addNamedUpgrade, card: addBonusCard, rare: addRare, apUpgrade: addAP, bridge: addBridge };

  // Week 1 is a fixed opening hand so the first turn always makes sense:
  // something to bring people in, and something to serve them with.
  if (s.week === 1) {
    const { transport, amenity, fixed } = { ...CONFIG.shop.week1, ...(m.week1 || {}) };
    let slot = 0;
    // The named cards come first and are the same in every run: a fixed opening
    // is what holds week 1 inside its band (§15), since one roll of the shop is
    // most of the spread when the board is empty. Anything a level has banned
    // (no rail or water in Sky Harbour) is skipped and rolled instead.
    for (const key of fixed || []) {
      if (slot >= nSlots) break;
      const d = tileDef(key);
      if (!soldOnLevel(m, d)) continue;
      if (d.kind === 'transport' && (m.banTerrains || []).includes(d.terrain)) continue;
      used.add(key); cards.push(tileCard(d, slot)); slot++;
    }
    for (let i = 0; i < transport && slot < nSlots; i++, slot++) addTransport(slot);
    for (let i = 0; i < amenity && slot < nSlots; i++, slot++) addAmenity(slot);
    while (slot < nSlots) { addAmenity(slot); slot++; }
    return cards;
  }

  // Every other week: each slot rolls independently, so the mix varies. Kinds
  // with nothing playable behind them are weighted out rather than substituted.
  for (let i = 0; i < nSlots; i++) {
    const w = { ...CONFIG.shop.slotWeights };
    if (s.week < rules.rareTilesFromWeek) w.rare = 0;
    if (s.week < rules.apUpgradeFromWeek) w.apUpgrade = 0;
    if (!upgradableKeys(s).length) w.upgrade = 0;
    if (!namedUpgradeKeys(s).length) w.namedUpgrade = 0;
    // guarantee at least one thing you can actually build
    const haveTile = cards.some(c => c.type === 'tile');
    if (!haveTile && i === nSlots - 1) { w.upgrade = 0; w.namedUpgrade = 0; w.card = 0; w.apUpgrade = 0; w.bridge = 0; }
    const kinds = Object.keys(w).filter(k => w[k] > 0);
    if (!kinds.length) { addAmenity(i); continue; }
    const kind = rng.weighted(kinds, k => w[k]);
    if (!ADD[kind](i)) addAmenity(i);   // fall back to a tile if that kind ran dry
  }
  return cards;
}

// -------------------------------------------------------------------- actions
function fail(reason) { return { ok: false, reason }; }
function log(s, msg) { s.log.push(`W${s.week}: ${msg}`); if (s.log.length > 200) s.log.shift(); }
function removeCard(s, card) { s.shop.cards = s.shop.cards.filter(c => c.id !== card.id); }

export function placementCheck(s, key, x, y, rot, side = null) { return checkPlacement(s.board, key, x, y, rot, modeOf(s), side); }

export function buyTile(s, card, x, y, rot, side = null) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  if (s.ap < 1) return fail('No action points left this week');
  const cost = cardCost(s, card);
  if (s.money < cost) return fail(`Need $${cost}`);
  const c = placementCheck(s, card.key, x, y, rot, side);
  if (!c.ok) return fail(c.reason);
  const tile = placeTile(s.board, card.key, x, y, rot, c, modeOf(s));
  tile.paid = cost;
  tile.placedWeek = s.week;   // deleting it this same week hands the action point back
  s.money -= cost; s.ap -= 1;
  removeCard(s, card);
  log(s, `Placed ${tile.name} for $${cost}`);
  for (const cl of c.claims) log(s, `${cl.edge} edge claimed as ${cl.terrain}${cl.lock ? ' (locked)' : ''}`);
  return { ok: true, tile };
}

export function upgradeTile(s, card, tileId) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  if (s.ap < 1) return fail('No action points left this week');
  const tile = s.board.tiles.find(t => t.id === tileId);
  if (!tile || tile.kind === 'bridge') return fail('Pick a tile to raise a level');
  const def = tileDef(tile.key);
  const maxL = CONFIG.economy.maxLevel;
  if (card.type === 'upgrade') {
    // tile-specific: the card names the type it upgrades
    if (tile.key !== card.key) return fail(`${card.name} needs ${card.tileName || tileDef(card.key).name}`);
    if ((tile.level || 1) >= maxL) return fail('That tile is already at its top level');
    const cost = upgradeCost(tile, card.levels, card.costMult);
    if (s.money < cost) return fail(`Need $${cost}`);
    tile.level = Math.min(maxL, (tile.level || 1) + card.levels);
    if (card.radiusBonus) tile.radiusBonus = (tile.radiusBonus || 0) + card.radiusBonus;
    s.money -= cost; s.ap -= 1; removeCard(s, card);
    log(s, `${card.name}: ${tile.name} to L${tile.level} for $${cost}`);
    return { ok: true };
  }
  if (card.type === 'named_upgrade') {
    const nu = NAMED_UPGRADES[card.key];
    if (s.money < nu.cost) return fail(`Need $${nu.cost}`);
    if (nu.target === 'transport' && tile.kind !== 'transport') return fail('That card needs a transport tile');
    if (nu.target === 'amenity' && (tile.kind !== 'amenity' || def.rate <= 0)) return fail('That card needs a shop');
    if (nu.target === 'waiting_all') {
      for (const t of s.board.tiles) if (tileDef(t.key).special === 'waiting') t.level = Math.min(maxL, t.level + nu.levels);
    } else {
      if ((tile.level || 1) >= maxL) return fail('That tile is already at its top level');
      tile.level = Math.min(maxL, tile.level + nu.levels);
      if (nu.radiusBonus) tile.radiusBonus = (tile.radiusBonus || 0) + nu.radiusBonus;
    }
    s.money -= nu.cost; s.ap -= 1; removeCard(s, card);
    log(s, `${nu.name} applied`);
    return { ok: true };
  }
  return fail('That is not an upgrade card');
}

// Does pulling this tile hand its action point back? Only for one bought this
// week: an older tile would be a free move rather than an undo.
export function deleteGivesAPBack(s, t) { return !!t && !!gameRules(s).deleteRefundsAP && t.placedWeek === s.week; }

export function deleteTile(s, tileId) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  const rules = gameRules(s);
  if (!rules.deleteFreeAP && s.ap < 1) return fail('No action points left this week');
  const apBack = deleteGivesAPBack(s, s.board.tiles.find(t => t.id === tileId));
  const t = removeTile(s.board, tileId);
  if (!t) return fail('No tile there');
  if (!rules.deleteFreeAP) s.ap -= 1;
  if (apBack) s.ap += 1;
  const refund = Math.round((t.paid || 0) * rules.deleteRefund);
  s.money += refund;
  log(s, `Deleted ${t.name}${refund ? ` (refund $${refund})` : ''}${apBack ? ' (action point back)' : ''}`);
  return { ok: true, apBack };
}

export function reroll(s) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  if (s.ap < 1) return fail('No action points left this week');
  const fee = rerollFee(s);
  if (s.money < fee) return fail(`Need $${fee}`);
  s.money -= fee; s.ap -= 1; s.shop.rerolls++;
  s.shop.cards = generateShop(s);
  log(s, fee ? `Rerolled the shop for $${fee}` : 'Rerolled the shop');
  return { ok: true };
}

export function buyAP(s, card) {
  if (s.ap < 1) return fail('No action points left this week');
  if (s.money < card.cost) return fail(`Need $${card.cost}`);
  s.money -= card.cost; s.ap -= 1; s.apPermanentBonus++; removeCard(s, card);
  log(s, 'Bought a permanent +1 AP');
  return { ok: true };
}

export function playCard(s, card, target = null) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  if (card.type === 'ap') return buyAP(s, card);
  if (card.type !== 'card') return fail('That is not a bonus card');
  const apCost = cardAPCost(s, card);
  if (s.ap < apCost) return fail('No action points left this week');
  if (s.money < card.cost) return fail(`Need $${card.cost}`);
  const def = CARDS[card.key];
  const tile = target && target.tileId != null ? s.board.tiles.find(t => t.id === target.tileId) : null;
  switch (card.key) {
    case 'overtime': s.ap += 2; break;
    // +1 now (covering the AP the card cost) and +1 in each of the next weeks
    case 'temp_staff': s.ap += def.ap; s.effects.push({ name: def.name, weeksLeft: def.weeks, mods: {}, ap: def.ap }); break;
    case 'rezoning': {
      const e = target && target.edge;
      if (!e || s.board.edges[e] === 'green') return fail('Pick an edge that is already claimed');
      // Everything attached to the edge goes with it: a train station on open
      // ground, or a bus stop whose road is gone, is a state the rules can't hold.
      for (const t of rezoningVictims(s, e)) { removeTile(s.board, t.id); log(s, `Rezoning demolished ${t.name}`); }
      s.board.edges[e] = 'green';
      s.board.openSpans[e] = [];
      break;
    }
    case 'grand_opening':
      if (!tile || tile.kind !== 'amenity' || tileDef(tile.key).rate <= 0) return fail('Pick a shop');
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
  s.money -= card.cost; s.ap -= apCost; removeCard(s, card);
  log(s, `Played ${def.name}`);
  return { ok: true };
}

// Transports a Rezoning Permit on `edge` would demolish.
export function rezoningVictims(s, edge) { return edgeDependents(s.board, edge); }

// Which transport walks out. The union picks, not the player: a keyed roll over
// the terrains standing on the board. `advanceWeek` freezes the answer into the
// run state as the week opens, so building a second terrain mid-week cannot
// move the walkout onto it, and the roll is keyed by seed and week so taking
// the week back lands on the same one.
export function pickStrikeTerrain(s, week = s.week) {
  const terrains = transportTerrainsOnBoard(s).slice().sort();
  if (!terrains.length) return null;
  return new Rng(hashString(`${s.seed}:strike:${week}`)).pick(terrains);
}

export function chooseOrdinance(s, key) {
  if (!s.pendingOrdinance || !s.pendingOrdinance.includes(key)) return fail('That was not one of the three on offer');
  s.ordinances.push(key); s.pendingOrdinance = null;
  log(s, `Ordinance: ${ORDINANCES[key].name}`);
  return { ok: true };
}

// --------------------------------------------------------------- modifiers
export function computeMods(s, week = s.week) {
  // The level's own crime-wave week travels to the sim as a modifier, so the
  // simulator stays free of modes and the preview cache keys on it.
  const list = [{ pickpocketsFromWeek: runRules(s).pickpocketsFromWeek, pickpocketRamp: runRules(s).pickpocketRamp }];
  const ev = eventForWeek(s, week);
  if (ev) {
    const m = { ...ev.mods };
    if (m.strike) {
      delete m.strike;
      // The pick is normally frozen at the top of the week; a state built by
      // the harness has not been through advanceWeek, so roll it here instead.
      const terrain = s.strikeChoice || pickStrikeTerrain(s, week);
      if (terrain) {
        // A walkout that would take the board's only transport terrain offline
        // is an unavoidable loss, so it drops to a skeleton service instead.
        if (transportTerrainsOnBoard(s).length <= 1) m.strikeSkeleton = terrain;
        else m.strikeTerrain = terrain;
      }
    }
    list.push(m);
  }
  list.push(difficultyOf(s).mods || {});
  for (const k of s.ordinances) list.push(ORDINANCES[k].mods || {});
  for (const e of s.effects) list.push(e.mods);
  return mergeMods(...list);
}

export function transportTerrainsOnBoard(s) {
  return [...new Set(s.board.tiles.filter(t => t.kind === 'transport').map(t => t.terrain))];
}

// ------------------------------------------------------------ simulation
// Estimate runs on the board as it stands are cached for the phase: every
// preview needs the same "before" sims, and only the "after" sim is new.
const estCache = { key: null, runs: new Map() };
// How many weeks run back to back this week: one, or two on a Double Week.
export function weekRepeat(s, week = s.week) { return (eventForWeek(s, week) || {}).repeat || 1; }
// Every sim the run layer asks for goes through here, so the preview, the
// placement badges and the week itself all agree on how long the week is.
function simRun(s, board, seed, mods) {
  const n = weekRepeat(s);
  return n > 1 ? simulateWeeks(board, { seed, week: s.week, mods }, n) : simulateWeek(board, { seed, week: s.week, mods });
}
function estimateRun(s, board, i, mods) {
  const seed = hashString(`${s.seed}:est:${i}`);
  if (board !== s.board) return simRun(s, board, seed, mods);
  const key = `${s.seed}:${s.week}:${JSON.stringify(mods)}:${JSON.stringify(board)}`;
  if (estCache.key !== key) { estCache.key = key; estCache.runs.clear(); }
  let r = estCache.runs.get(i);
  if (!r) { r = simRun(s, board, seed, mods); estCache.runs.set(i, r); }
  return r;
}
export function simulateCurrent(s, seed = null, seeds = 1) {
  const mods = computeMods(s);
  if (seeds === 1) return simRun(s, s.board, seed ?? hashString(`${s.seed}:w${s.week}`), mods);
  const out = [];
  for (let i = 0; i < seeds; i++) out.push(estimateRun(s, s.board, i, mods));
  return out;
}
// Spread and mean of a set of per-seed point and cash deltas (or totals).
// `ptsFrom`/`ptsTo` are the badge's range: the extremes once `rangeTrim`
// seeds are dropped from each end.
function spread(dp, dm) {
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const pts = mean(dp), cash = mean(dm);
  dp = dp.slice().sort((a, b) => a - b); dm = dm.slice().sort((a, b) => a - b);
  const trim = Math.min(CONFIG.placement.rangeTrim, Math.floor((dp.length - 1) / 2));
  return { pts, cash, ptsLo: dp[0], ptsHi: dp[dp.length - 1], ptsFrom: dp[trim], ptsTo: dp[dp.length - 1 - trim], cashLo: dm[0], cashHi: dm[dm.length - 1] };
}

export function runWeek(s) {
  if (s.phase !== 'shop') return fail('You can only do that while building');
  const ev = currentEvent(s);
  if (ev && ev.mods.strike && !s.strikeChoice) s.strikeChoice = pickStrikeTerrain(s);
  const result = simulateCurrent(s);
  // unspent action points are paid out as the early-finish bonus
  const bonus = earlyFinishBonus(s);
  s.money += bonus; s.ap = 0; s.earlyBonus = bonus;
  if (bonus) log(s, `Ran the week early: +$${bonus}`);
  // ...and then the audit, if this is that week: the bonus is in the till by
  // now, so an audited week pays nothing for finishing early. The week's own
  // takings land at settlement and are untouched.
  s.cashSwept = 0;
  if (ev && ev.cash && ev.cash.wipeOnRun && s.money > 0) {
    s.cashSwept = s.money; s.money = 0;
    log(s, `${ev.name}: $${s.cashSwept} swept out of the till`);
  }
  s.lastResult = result;
  s.phase = 'summary';
  return { ok: true, result, bonus };
}

export function settle(s) {
  if (s.phase !== 'summary' || !s.lastResult) return fail('There is nothing to settle yet');
  const r = s.lastResult;
  const quota = quotaFor(s);
  s.money += r.money.total;
  const passed = r.score >= quota;
  s.history.push({ week: s.week, score: r.score, quota, money: r.money.total + (s.earlyBonus || 0), passed, event: currentEvent(s)?.name || null });
  s.records.bestWeek = Math.max(s.records.bestWeek, s.week);
  s.records.bestScore = Math.max(s.records.bestScore, r.score);
  if (r.best) s.records.bestTraveller = Math.max(s.records.bestTraveller, Math.round(r.best.value));
  if (!passed) { s.phase = 'lost'; log(s, `Week ${s.week}: ${r.score} < quota ${quota}. Run over.`); return { ok: true, passed: false }; }
  if (s.week === runRules(s).winWeek && !s.won) { s.won = true; s.phase = 'won'; }
  else s.phase = 'shop';
  advanceWeek(s);
  return { ok: true, passed: true };
}

export function continueAfterWin(s) { if (s.phase === 'won') s.phase = 'shop'; }

function advanceWeek(s) {
  s.week++;
  // effects tick down first, so one with weeks left still counts toward AP
  for (const e of s.effects) e.weeksLeft--;
  s.effects = s.effects.filter(e => e.weeksLeft > 0);
  s.ap = apForRun(s); s.hoursBought = 0;
  s.shop.rerolls = 0;
  s.strikeChoice = null; s.surveyed = false; s.cashSwept = 0;
  s.shop.cards = generateShop(s);
  const ev = currentEvent(s);
  if (ev && ev.mods.strike) s.strikeChoice = pickStrikeTerrain(s);
  applyWeekCash(s);   // before the snapshot: taking the week back does not undo the bill
  const rules = runRules(s);
  if (rules.ordinanceWeeks.includes(s.week)) {
    const rng = new Rng(hashString(`${s.seed}:ord:${s.week}`));
    const pool = ORDINANCE_KEYS.filter(k => !s.ordinances.includes(k));
    s.pendingOrdinance = rng.shuffle(pool).slice(0, rules.ordinanceChoices);
  }
  snapshotWeek(s);
}

// ------------------------------------------------------------ taking a week back
// Standard lets a player unpick a week they have not run yet, so a misplaced
// tile is a mistake rather than a dead run. The week is kept as the same JSON
// the save uses: restoring it is one parse, and nothing in it can hold a live
// reference back into the run.
function stateJson(s) { const { weekStart, lastResult, ...rest } = s; return JSON.stringify(rest); }
function snapshotWeek(s) { s.weekStart = difficultyOf(s).redo ? stateJson(s) : null; }
// Has anything actually been done this week? That is what puts the button on
// screen, so it appears on the first move and not before.
export function weekTouched(s) { return !!s.weekStart && s.phase === 'shop' && stateJson(s) !== s.weekStart; }
export function redoWeek(s) {
  if (!s.weekStart) return fail('This difficulty does not let you take a week back');
  if (s.phase !== 'shop') return fail('You can only do that while building');
  const snap = JSON.parse(s.weekStart);
  // The state object is shared with the UI, so put the week back in place
  // rather than handing out a new one. The snapshot itself stays: a second
  // redo has to land on the same board as the first.
  const weekStart = s.weekStart;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, snap, { weekStart, lastResult: null });
  log(s, 'Took the week back to the start');
  snapshotWeek(s);   // that log line aside, this is the start of the week again
  return { ok: true };
}

// ----------------------------------------------------------- estimates
export function estimatePlacement(s, key, x, y, rot, seeds = CONFIG.placement.previewSeeds, side = null) {
  const c = placementCheck(s, key, x, y, rot, side);
  if (!c.ok) return null;
  const mods = computeMods(s);
  const after = cloneBoard(s.board);
  placeTile(after, key, x, y, rot, null, modeOf(s), side);
  const dp = [], dm = [];
  for (let i = 0; i < seeds; i++) {
    const a = estimateRun(s, s.board, i, mods);
    const b = estimateRun(s, after, i, mods);
    dp.push(b.score - a.score); dm.push(b.money.total - a.money.total);
  }
  return spread(dp, dm);
}

// Same idea as estimatePlacement, but for raising a tile's level: what would
// this week look like if that tile were `levels` better?
export function estimateUpgrade(s, tileId, levels = 1, radiusBonus = 0, seeds = CONFIG.placement.previewSeeds) {
  const tile = s.board.tiles.find(t => t.id === tileId);
  if (!tile || tile.kind === 'bridge') return null;
  const lvl = Math.min(CONFIG.economy.maxLevel, (tile.level || 1) + levels);
  if (lvl === (tile.level || 1) && !radiusBonus) return null;
  const mods = computeMods(s);
  const after = cloneBoard(s.board);
  const at = after.tiles.find(t => t.id === tileId);
  at.level = lvl;
  if (radiusBonus) at.radiusBonus = (at.radiusBonus || 0) + radiusBonus;
  const dp = [], dm = [];
  for (let i = 0; i < seeds; i++) {
    const a = estimateRun(s, s.board, i, mods);
    const b = estimateRun(s, after, i, mods);
    dp.push(b.score - a.score); dm.push(b.money.total - a.money.total);
  }
  return spread(dp, dm);
}

export function estimateCurrent(s, seeds = CONFIG.placement.previewSeeds) {
  const rs = simulateCurrent(s, null, seeds);
  return spread(rs.map(r => r.score), rs.map(r => r.money.total));
}

// ------------------------------------------------------------ persistence
export function serialize(s) {
  const copy = { ...s, lastResult: null };
  return JSON.stringify(copy);
}
export function saveIsCurrent(json) {
  try { return JSON.parse(json).version === SAVE_VERSION; } catch { return false; }
}
export function deserialize(json) {
  const s = JSON.parse(json);
  if (s.phase === 'summary') s.phase = 'shop';
  return s;
}
