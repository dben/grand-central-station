// ============================================================================
// Grand Central Station - browser UI. DOM chrome + canvas board + playback.
// ============================================================================
import { CONFIG } from '../config.js';
import * as G from '../game/run.js';
import { tileDef, TERRAIN_INFO, NAMED_UPGRADES } from '../data/tiles.js';
import { MODES, MODE_KEYS } from '../data/modes.js';
import { ORDINANCES } from '../data/ordinances.js';
import { CARDS } from '../data/cards.js';
import { orientationCount, shapeCells } from '../sim/shapes.js';
import { effTransport, effAmenity } from '../sim/sim.js';
import { BoardRenderer, colorForDef } from './render.js';
import { loadMeta, recordRun, saveRun, loadRun, clearRun } from './meta.js';

const $ = id => document.getElementById(id);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmtK = n => Math.abs(n) >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : fmt(n);
const tierTag = t => t > 0 ? h('span', { class: 'tier tier' + t }, CONFIG.tiers[t - 1].symbol) : null;

// ------------------------------------------------------------------ state
let state = null;
const meta = loadMeta();
const ui = {
  mode: 'idle', card: null, rot: 0, hover: null, edgeHover: null, selectedTileId: null, hoverTileId: null,
  ghost: null, estimate: null, estimateKey: null, estimateTimer: null, projection: null, projectionTimer: null,
  pb: { result: null, T: 0, speed: 1, playing: false, last: 0 }, heat: false, summaryShown: false, started: false,
};
const renderer = new BoardRenderer($('board'));
const TICKS_PER_SEC = 2;

// --------------------------------------------------------------- helpers
function tileById(id) { return state.board.tiles.find(t => t.id === id) || null; }
function tileAtCell(x, y) { return state.board.tiles.find(t => t.cells.some(c => c[0] === x && c[1] === y)) || null; }
function mods() { return G.computeMods(state); }
function persist() { if (ui.started && state && state.phase !== 'lost') saveRun(G.serialize(state)); }

function describeTile(tile, def) {
  const m = mods();
  const rows = [];
  if (def.kind === 'transport') {
    const e = effTransport(tile || { key: def.key, level: 1 }, m);
    rows.push(['Brings', `${CONFIG.tiers[def.tier - 1].symbol} travellers, ${e.batch} every ${e.arr} ticks`], ['Departs', `every ${e.dep} ticks${e.dwell ? `, ${e.dwell} tick wait` : ''}`]);
    rows.push(['Exit bonus', `×${e.mult.toFixed(2)}${e.flat ? ' +' + Math.round(e.flat) : ''}`], ['Terrain', TERRAIN_INFO[def.terrain].label]);
    if (e.offline) rows.push(['Status', 'OFFLINE this week']);
    if (def.special === 'loop') rows.push(['Special', `${Math.round(def.loopChance * 100)}% of departures re-enter with chain intact`]);
  } else if (def.kind === 'amenity') {
    const e = effAmenity(tile || { key: def.key, level: 1 }, m);
    if (def.special === 'wifi') rows.push(['Effect', `+${CONFIG.sim.wifiBonus} base rate to amenities within ${e.radius} (cap +${CONFIG.sim.wifiCap})`]);
    else if (def.special === 'walkway') rows.push(['Effect', 'Travellers ride at 2 cells/tick and take no service rolls while riding']);
    else if (def.special === 'gate') rows.push(['Effect', 'Wall with one gap. Only travellers bound for the far side may cross; +2 stop budget. Removes pickpockets.']);
    else if (def.special === 'waiting') rows.push(['Effect', `+${e.stackValue.toFixed(2)} multiplier per tick waited (capped by tier)`], ['Radius', e.radius], ['Capacity', e.cap], ['Revenue', `$${e.revenue.toFixed(1)} per guest`], ...(e.minTier > 1 ? [['Serves', CONFIG.tiers[e.minTier - 1].symbol + ' and up']] : []));
    else {
      rows.push(['Serves', def.special === 'anytier' ? 'any tier' : `${CONFIG.tiers[def.tier - 1].symbol} best`], ['Pull', `${(e.rate * 100).toFixed(0)}% within ${e.radius}`]);
      rows.push(['Chain', `×${e.mult.toFixed(2)}${e.flat ? ' +' + Math.round(e.flat) : ''}`], ['Capacity', `${e.cap} at a time, ${e.dur} tick${e.dur === 1 ? '' : 's'}`], ['Earns', `$${e.revenue.toFixed(1)} per visit`]);
      if (def.special === 'green') rows.push(['Special', 'Restores 1 stop budget instead of spending it']);
      if (def.special === 'kiosk') rows.push(['Special', `−${CONFIG.sim.kioskPickpocketReduction * 100}% pickpocket spawns`]);
      if (e.closed) rows.push(['Status', 'CLOSED (inspection)']);
    }
  } else if (def.kind === 'bridge') {
    rows.push(['Effect', 'Opens the adjacent edge span to any transport terrain. Walkable.']);
  }
  const kv = h('div', { class: 'kv' });
  for (const [k, v] of rows) kv.append(h('span', { class: 'k' }, k), h('span', {}, v));
  return kv;
}

function lastStatsFor(tileId) {
  const r = state.lastResult || (state.history.length ? null : null);
  if (!r || !r.tileStats[tileId]) return null;
  return r.tileStats[tileId];
}

// ------------------------------------------------------------ rendering
function renderAll() { renderTop(); renderShop(); renderSide(); persist(); scheduleProjection(); }

function renderTop() {
  const quota = G.quotaFor(state);
  $('st-week').textContent = state.week + (G.isEventWeek(state) ? ' ★' : '');
  $('st-quota').textContent = fmt(quota);
  const bar = $('topbar');
  bar.classList.remove('gold');
  if (ui.projection && state.phase === 'shop') {
    const avg = (ui.projection.ptsLo + ui.projection.ptsHi) / 2;
    const ratio = avg / quota;
    $('st-proj').textContent = `${fmtK(ui.projection.ptsLo)}–${fmtK(ui.projection.ptsHi)}`;
    bar.title = `Projected this week: ${fmtK(ui.projection.ptsLo)} to ${fmtK(ui.projection.ptsHi)} points (${Math.round(ratio * 100)}% of quota)`;
    if (ratio >= 2) { bar.classList.add('gold'); bar.style.background = ''; }
    else {
      // red at <=50% of quota, green at >=105%
      const t = Math.max(0, Math.min(1, (ratio - 0.5) / 0.55));
      bar.style.background = `linear-gradient(180deg, hsl(${Math.round(t * 120)}, 45%, ${18 + Math.round(t * 6)}%), var(--panel))`;
    }
  } else { bar.style.background = ''; bar.title = ''; $('st-proj').textContent = ''; }
  const canRun = state.phase === 'shop' && ui.mode !== 'playback';
  $('btn-run').disabled = !canRun;
  $('btn-run').textContent = state.ap > 0 ? `Run Week ▶ (${state.ap} AP left)` : 'Run Week ▶';
  $('btn-run-big').classList.toggle('hidden', !(canRun && state.ap === 0 && (ui.mode === 'idle' || ui.mode === 'over')));
  $('playback').classList.toggle('hidden', ui.mode !== 'playback');
  // wallet
  $('st-money').textContent = '$' + fmt(state.money);
  $('st-ap').textContent = state.ap;
  $('btn-shop-expand').textContent = `▲ Shop · $${fmt(state.money)} · ${state.ap} AP`;
  const pips = $('ap-pips'); pips.innerHTML = '';
  const total = Math.max(state.ap, G.apForRun(state));
  for (let i = 0; i < total; i++) pips.append(h('span', { class: 'pip' + (i < state.ap ? '' : ' empty') }));
}

function shapeCanvas(def, w = 84, h = 84) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const cells = shapeCells(def.shape, 0);
  const bw = Math.max(...cells.map(x => x[0])) + 1, bh = Math.max(...cells.map(x => x[1])) + 1;
  const cs = Math.min(18, Math.floor((w - 4) / Math.max(bw, 1)), Math.floor((h - 4) / Math.max(bh, 1)));
  const ox = (w - bw * cs) / 2, oy = (h - bh * cs) / 2;
  g.fillStyle = colorForDef(def);
  for (const [x, y] of cells) { g.fillRect(ox + x * cs + 1, oy + y * cs + 1, cs - 2, cs - 2); }
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
  for (const [x, y] of cells) g.strokeRect(ox + x * cs + 1.5, oy + y * cs + 1.5, cs - 3, cs - 3);
  if (def.kind === 'amenity' && def.radius > 0) {
    g.strokeStyle = 'rgba(240,178,79,0.5)'; g.setLineDash([2, 2]);
    g.strokeRect(ox - def.radius * cs * 0.35, oy - def.radius * cs * 0.35, bw * cs + def.radius * cs * 0.7, bh * cs + def.radius * cs * 0.7);
    g.setLineDash([]);
  }
  return c;
}
const CARD_ICONS = { upgrade: '⬆', named_upgrade: '✦', card: '♦', ap: '+1', bridge: '═' };
function cardKindLabel(card) {
  if (card.type === 'tile') { const d = tileDef(card.key); if (d.kind === 'transport') return 'transport'; if (d.special === 'waiting') return 'lounge'; if (d.rate === 0) return 'utility'; return 'amenity'; }
  return { upgrade: 'upgrade', named_upgrade: 'upgrade', card: 'bonus card', ap: 'upgrade', bridge: 'structure' }[card.type] || '';
}
function cardDetails(card) {
  const box = h('div');
  box.append(h('h4', {}, card.name));
  if (card.type === 'tile' || card.type === 'bridge') {
    const def = tileDef(card.key);
    box.append(describeTile(null, def));
    if (def.kind === 'transport') box.append(h('div', { class: 'desc' }, TERRAIN_INFO[def.terrain].desc));
  } else box.append(h('div', { class: 'desc' }, card.desc || ''));
  if (card.type === 'upgrade') box.append(h('div', { class: 'desc' }, 'Amenities gain chain multiplier, capacity, revenue and pull per level. Transports gain batch size and exit bonus.'));
  return box;
}

function renderShop() {
  const wrap = $('shop-cards'); wrap.innerHTML = '';
  for (const card of state.shop.cards) {
    const cost = G.cardCost(state, card);
    const affordable = state.money >= cost && state.ap >= 1;
    const isTile = card.type === 'tile' || card.type === 'bridge';
    const def = isTile ? tileDef(card.key) : null;
    const kind = cardKindLabel(card);
    const kclass = { transport: 'k-transport', amenity: 'k-amenity', utility: 'k-utility', lounge: 'k-lounge', upgrade: 'k-upgrade', 'bonus card': 'k-bonus', structure: 'k-structure' }[kind] || '';
    const el = h('div', { class: 'card ' + kclass + (ui.card && ui.card.id === card.id ? ' selected' : '') + (affordable ? '' : ' unaffordable'), onclick: () => selectCard(card) },
      h('span', { class: 'slot' }, cardKindLabel(card)),
      h('div', { class: 'name' }, card.name),
      isTile ? shapeCanvas(def, 84, 76) : h('div', { class: 'icon' }, CARD_ICONS[card.type] || '?'),
      h('div', { class: 'sub' }, def ? [def.tier > 0 ? tierTag(def.tier) : null, def.kind === 'transport' ? ` · ${TERRAIN_INFO[def.terrain].label}` : (def.tier > 0 ? '' : def.shape)] : (card.type === 'upgrade' ? 'any tile' : '')),
      h('div', { class: 'cost' }, card.type === 'upgrade' ? '$60+' : `$${cost}`));
    el.addEventListener('pointerenter', e => showPopup(cardDetails(card), e.clientX, e.clientY, false));
    el.addEventListener('pointermove', e => positionPopup(e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => hidePopup(false));
    wrap.append(el);
  }
  $('btn-reroll').innerHTML = `Reroll<br><small>1 AP · $${G.rerollFee(state)}</small>`;
  $('btn-reroll').disabled = state.phase !== 'shop' || state.ap < 1 || state.money < G.rerollFee(state);
  const interest = Math.min(CONFIG.economy.waitInterestCap, Math.round(state.money * CONFIG.economy.waitInterestRate));
  $('btn-wait').innerHTML = `Wait<br><small>all AP · +$${interest}</small>`;
  $('btn-wait').disabled = state.phase !== 'shop' || state.ap < 1;
}

// ------------------------------------------------------------ popup
function showPopup(content, x, y, sticky) {
  const p = $('popup'); p.innerHTML = ''; p.append(content);
  p.classList.remove('hidden'); p.classList.toggle('sticky', !!sticky); p.dataset.sticky = sticky ? '1' : '';
  positionPopup(x, y);
}
function positionPopup(x, y) {
  const p = $('popup'); if (p.classList.contains('hidden')) return;
  const r = p.getBoundingClientRect();
  let px = x + 16, py = y + 16;
  if (px + r.width > window.innerWidth - 8) px = x - r.width - 12;
  if (py + r.height > window.innerHeight - 8) py = Math.max(8, y - r.height - 12);
  p.style.left = px + 'px'; p.style.top = py + 'px';
}
function hidePopup(force) {
  const p = $('popup');
  if (!force && p.dataset.sticky) return;
  p.classList.add('hidden'); p.dataset.sticky = '';
}
function tileDetails(t, sticky) {
  const def = tileDef(t.key);
  const box = h('div');
  box.append(h('h4', {}, `${t.name}${t.level > 1 ? ' · L' + t.level : ''}`));
  box.append(describeTile(t, def));
  const st = lastStatsFor(t.id);
  if (st) {
    const line = t.kind === 'transport' ? `Last week: ${st.spawned} arrived, ${st.boarded} boarded, ${st.stranded} stranded` : `Last week: ${st.serves} served${st.balks ? `, ${st.balks} turned away` : ''}${st.cap ? `, ${(st.saturation * 100).toFixed(0)}% full` : ''}`;
    box.append(h('div', { class: 'desc' }, line));
  }
  if (sticky && state.phase === 'shop') {
    const rules = G.gameRules(state);
    const up = G.upgradeCost(t);
    box.append(h('div', { class: 'btnrow', style: 'justify-content:flex-start;margin-top:8px' },
      h('button', { class: 'danger small', onclick: () => { const r = G.deleteTile(state, t.id); if (!r.ok) hint(r.reason); ui.selectedTileId = null; hidePopup(true); renderAll(); } }, rules.deleteFreeAP ? 'Delete (free)' : 'Delete (1 AP)'),
      up != null && t.kind !== 'bridge' ? h('span', { class: 'desc' }, `L${t.level + 1}: $${up} with a token`) : null));
  }
  return box;
}

function renderTimeline() {
  const tl = $('timeline'); tl.innerHTML = '';
  const rows = [];
  const last = state.history[state.history.length - 1];
  if (last) rows.push(h('div', { class: 'tl-row past ' + (last.passed ? 'ok' : 'fail') }, h('span', { class: 'wk' }, `Week ${last.week}`), h('span', { class: 'q' }, `${fmt(last.score)} points`)));
  const nextEv = G.nextEventWeek(state);
  for (let w = state.week; w <= state.week + 4; w++) {
    const current = w === state.week;
    const ev = G.eventForWeek(state, w);
    const known = ev && (w === nextEv || current || (state.surveyed && w === nextEv + CONFIG.run.eventEvery));
    const ord = CONFIG.run.ordinanceWeeks.includes(w);
    const cls = ['tl-row', current ? 'current' : '', ev ? 'event' : (ord ? 'ordinance' : ''), w === state.week + 4 ? 'last' : ''].join(' ');
    const row = h('div', { class: cls }, h('span', { class: 'wk' }, `Week ${w}`), h('span', { class: 'q' }, current ? `quota ${fmt(G.quotaFor(state))}` : (known || !ev ? `quota ${fmtK(G.quotaFor(state, w))}` : '')));
    if (ev) {
      const body = h('div', { class: 'sub', id: current ? 'event-body' : null });
      if (known) {
        body.append(h('span', { class: 'tag' }, `Event: ${ev.name} ×${ev.quota}`), h('div', {}, ev.desc));
        if (current && ev.mods.strike) {
          const terrains = G.transportTerrainsOnBoard(state);
          const sel = h('select', { onchange: e => { G.setStrike(state, e.target.value); persist(); scheduleProjection(); } });
          for (const t of terrains) sel.append(h('option', { value: t, selected: state.strikeChoice === t ? '' : null }, TERRAIN_INFO[t].label));
          if (!terrains.length) sel.append(h('option', {}, 'no transports'));
          if (!state.strikeChoice && terrains.length) G.setStrike(state, terrains[0]);
          body.append(h('div', { class: 'row', style: 'margin-top:4px' }, 'Striking: ', sel));
        }
      } else body.append(h('span', { class: 'tag' }, 'Event week'), h('div', {}, 'Revealed once the current event resolves.'));
      row.append(body);
    }
    if (ord) row.append(h('div', { class: 'sub' }, h('span', { class: 'tag' }, 'Ordinance!'), h('div', {}, 'Choose one of three permanent rules.')));
    rows.push(row);
  }
  tl.append(...rows);
}

function renderSide() {
  renderTimeline();
  const rb = $('rules-body'); rb.innerHTML = '';
  for (const k of state.ordinances) rb.append(h('div', {}, h('b', {}, ORDINANCES[k].name), h('div', { style: 'font-size:12px;color:var(--muted)' }, ORDINANCES[k].desc)));
  for (const e of state.effects) rb.append(h('div', {}, h('b', {}, e.name), h('span', { style: 'color:var(--muted)' }, ` · ${e.weeksLeft} week${e.weeksLeft === 1 ? '' : 's'} left`)));
  $('rules-panel').classList.toggle('hidden', !state.ordinances.length && !state.effects.length);
  renderInfo();
}

function renderInfo() {
  const panel = $('info-panel'), title = $('info-title'), body = $('info-body'); body.innerHTML = '';
  panel.classList.remove('hidden');
  if (ui.mode === 'playback') { title.textContent = 'Simulating'; body.textContent = 'Full amenities grey out. Skip any time.'; return; }
  if (ui.mode === 'place' && ui.card) {
    const def = tileDef(ui.card.key);
    title.textContent = 'Placing ' + ui.card.name;
    if (ui.ghost) {
      if (!ui.ghost.ok) body.append(h('div', { class: 'bad' }, ui.ghost.reason));
      else {
        for (const c of ui.ghost.claims) body.append(h('div', { class: 'warn' }, c.lock ? `Locks the ${c.edge} edge to ${c.terrain} for the run` : `Claims the ${c.edge} edge as ${c.terrain}`));
        body.append(h('div', {}, 'This week: ', ui.estimate ? h('b', {}, `${ui.estimate.ptsLo >= 0 ? '+' : ''}${fmtK(ui.estimate.ptsLo)} to ${fmtK(ui.estimate.ptsHi)} pts`) : h('i', {}, 'estimating…')));
      }
    } else body.append(h('div', { style: 'color:var(--muted)' }, 'Hover the board.'));
    body.append(h('div', { style: 'font-size:12px;color:var(--muted);margin-top:6px' }, orientationCount(def.shape) > 1 ? 'R or scroll rotates · Esc cancels' : 'Esc cancels'));
    return;
  }
  if (ui.mode === 'target' && ui.card) {
    title.textContent = ui.card.name;
    body.append(h('div', { class: 'accent' }, ui.card.target === 'edge' ? 'Click a claimed edge.' : 'Click a highlighted tile.'), h('div', { style: 'font-size:12px;color:var(--muted);margin-top:6px' }, 'Esc cancels'));
    return;
  }
  panel.classList.add('hidden');
}

function hint(msg) { const el = $('board-hint'); el.textContent = msg; clearTimeout(hint.t); hint.t = setTimeout(() => { el.textContent = ''; }, 2500); }

// ------------------------------------------------------------ projections
function scheduleProjection() {
  clearTimeout(ui.projectionTimer);
  ui.projection = null; $('st-proj').textContent = '…';
  if (state.phase !== 'shop') return;
  ui.projectionTimer = setTimeout(() => { ui.projection = G.estimateCurrent(state, 3); renderTop(); }, 30);
}
function scheduleEstimate() {
  clearTimeout(ui.estimateTimer);
  if (!ui.ghost || !ui.ghost.ok || !ui.card) { ui.estimate = null; return; }
  const key = `${ui.card.key},${ui.ghost.x},${ui.ghost.y},${ui.rot}`;
  if (ui.estimateKey === key && ui.estimate) return;
  ui.estimate = null; ui.estimateKey = key;
  const snap = { key: ui.card.key, x: ui.ghost.x, y: ui.ghost.y, rot: ui.rot };
  ui.estimateTimer = setTimeout(() => {
    if (ui.estimateKey !== key || !ui.card) return;
    ui.estimate = G.estimatePlacement(state, snap.key, snap.x, snap.y, snap.rot);
    renderInfo();
  }, 120);
}

// ------------------------------------------------------------ interaction
function selectCard(card) {
  if (state.phase !== 'shop' || ui.mode === 'playback') return;
  if (ui.card && ui.card.id === card.id) { cancelMode(); return; }
  ui.card = card; ui.rot = 0; ui.selectedTileId = null; ui.estimate = null; hidePopup(true);
  if (card.type === 'tile' || card.type === 'bridge') ui.mode = 'place';
  else if (card.type === 'upgrade' || card.type === 'named_upgrade') {
    if (card.type === 'named_upgrade' && card.target === 'waiting_all') { const anyT = state.board.tiles[0]; if (!anyT) { hint('No tiles to upgrade'); return; } const r = G.upgradeTile(state, card, anyT.id); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); return; }
    ui.mode = 'target';
  } else if (card.type === 'card' || card.type === 'ap') {
    if (card.target === 'none' || card.type === 'ap') { const r = G.playCard(state, card); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); return; }
    ui.mode = 'target';
  }
  renderShop(); renderInfo(); updateGhost();
}
function cancelMode() { ui.mode = state.phase === 'shop' ? 'idle' : ui.mode; ui.card = null; ui.ghost = null; ui.estimate = null; hidePopup(true); renderShop(); renderInfo(); }

function targetFilter(t) {
  const c = ui.card; if (!c) return false;
  const d = tileDef(t.key);
  if (c.type === 'upgrade') return t.kind !== 'bridge' && t.level < CONFIG.economy.maxLevel;
  if (c.type === 'named_upgrade') { const nu = NAMED_UPGRADES[c.key]; if (nu.target === 'coffee') return t.key === 'coffee'; if (nu.target === 'transport') return t.kind === 'transport'; if (nu.target === 'amenity') return t.kind === 'amenity' && d.rate > 0; return false; }
  if (c.type === 'card') { if (c.target === 'amenity') return t.kind === 'amenity' && d.rate > 0; if (c.target === 'transport') return t.kind === 'transport'; }
  return false;
}

function ghostOrigin(def, cell) {
  const cells = shapeCells(def.shape, ui.rot);
  const bw = Math.max(...cells.map(c => c[0])) + 1, bh = Math.max(...cells.map(c => c[1])) + 1;
  return { x: cell.x - Math.floor((bw - 1) / 2), y: cell.y - Math.floor((bh - 1) / 2) };
}
function updateGhost() {
  if (ui.mode !== 'place' || !ui.card || !ui.hover) { ui.ghost = null; return; }
  const def = tileDef(ui.card.key);
  const o = ghostOrigin(def, ui.hover);
  const c = G.placementCheck(state, ui.card.key, o.x, o.y, ui.rot);
  ui.ghost = { ...c, x: o.x, y: o.y, def };
  scheduleEstimate();
  renderInfo();
}

function onPointerMove(e) {
  const rect = renderer.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const cell = renderer.cellAt(px, py);
  const edge = cell ? null : renderer.edgeAt(px, py);
  const changed = (cell?.x !== ui.hover?.x || cell?.y !== ui.hover?.y || edge !== ui.edgeHover);
  ui.hover = cell; ui.edgeHover = edge;
  if (!changed) return;
  const t = cell ? tileAtCell(cell.x, cell.y) : null;
  ui.hoverTileId = t ? t.id : null;
  if (ui.mode === 'place') updateGhost();
  else {
    renderInfo();
    if (t && ui.mode !== 'playback' && !$('popup').dataset.sticky) showPopup(tileDetails(t, false), e.clientX, e.clientY, false);
    else if (!t) hidePopup(false);
  }
}
function onPointerLeave() { ui.hover = null; ui.edgeHover = null; ui.hoverTileId = null; ui.ghost = null; hidePopup(false); renderInfo(); }

function onClick(e) {
  if (ui.mode === 'playback') return;
  const rect = renderer.canvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const cell = renderer.cellAt(px, py);
  const edge = cell ? null : renderer.edgeAt(px, py);
  if (ui.mode === 'place' && ui.card) {
    if (!cell) return;
    updateGhost();
    if (!ui.ghost.ok) { hint(ui.ghost.reason); return; }
    const placement = { card: ui.card, x: ui.ghost.x, y: ui.ghost.y, rot: ui.rot };
    const doPlace = () => {
      const r = G.buyTile(state, placement.card, placement.x, placement.y, placement.rot);
      if (!r.ok) { hint(r.reason); return; }
      ui.selectedTileId = r.tile.id; cancelMode(); renderAll();
    };
    doPlace();
    return;
  }
  if (ui.mode === 'target' && ui.card) {
    if (ui.card.target === 'edge') {
      if (!edge) { hint('Click an edge strip around the board'); return; }
      const r = G.playCard(state, ui.card, { edge }); if (!r.ok) hint(r.reason);
      cancelMode(); renderAll(); return;
    }
    const t = cell ? tileAtCell(cell.x, cell.y) : null;
    if (!t || !targetFilter(t)) { hint('Pick a highlighted tile'); return; }
    const r = ui.card.type === 'card' ? G.playCard(state, ui.card, { tileId: t.id }) : G.upgradeTile(state, ui.card, t.id);
    if (!r.ok) hint(r.reason);
    ui.selectedTileId = t.id; cancelMode(); renderAll(); return;
  }
  const t = cell ? tileAtCell(cell.x, cell.y) : null;
  ui.selectedTileId = t ? t.id : null;
  if (t) showPopup(tileDetails(t, true), e.clientX, e.clientY, true); else hidePopup(true);
  renderInfo();
}

function onKey(e) {
  if (e.key === 'Escape') { hidePopup(true); if (ui.mode === 'place' || ui.mode === 'target') cancelMode(); else { ui.selectedTileId = null; renderInfo(); } }
  if ((e.key === 'r' || e.key === 'R') && ui.mode === 'place') { rotate(1); }
  if (e.key === ' ' && ui.mode === 'playback') { e.preventDefault(); ui.pb.playing = !ui.pb.playing; }
}
function rotate(dir) { if (!ui.card) return; const n = orientationCount(tileDef(ui.card.key).shape); ui.rot = (ui.rot + dir + n) % n; updateGhost(); }

// ------------------------------------------------------------ playback
function startWeek() {
  if (state.phase !== 'shop') return;
  cancelMode();
  const r = G.runWeek(state);
  if (!r.ok) { hint(r.reason); return; }
  ui.mode = 'playback'; ui.pb.result = r.result; ui.pb.T = 0; ui.pb.playing = true; ui.pb.last = performance.now(); ui.summaryShown = false; ui.heat = false;
  ui.selectedTileId = null; hidePopup(true);
  renderTop(); renderInfo(); renderShop();
  if (ui.pb.speed === 'skip') finishPlayback();
}
function finishPlayback() {
  ui.pb.T = ui.pb.result.ticks; ui.pb.playing = false;
  $('pb-tick').textContent = `tick ${ui.pb.result.ticks}/${ui.pb.result.ticks}`;
  if (!ui.summaryShown) { ui.summaryShown = true; showSummary(); }
}
function setSpeed(s) {
  ui.pb.speed = s;
  document.querySelectorAll('#playback .speed').forEach(b => b.classList.toggle('active', b.dataset.speed === String(s)));
  if (s === 'skip' && ui.mode === 'playback') finishPlayback();
}

function frame(now) {
  if (state) {
    if (ui.mode === 'playback' && ui.pb.playing) {
      const dt = (now - ui.pb.last) / 1000;
      ui.pb.T += dt * TICKS_PER_SEC * (ui.pb.speed === 'skip' ? 1000 : ui.pb.speed);
      if (ui.pb.T >= ui.pb.result.ticks) finishPlayback();
      $('pb-tick').textContent = `tick ${Math.min(ui.pb.result.ticks, Math.floor(ui.pb.T))}/${ui.pb.result.ticks}`;
    }
    ui.pb.last = now;
    const m = mods();
    const closed = new Set(state.board.tiles.filter(t => t.kind === 'amenity' && effAmenity(t, m).closed).map(t => t.id));
    const selected = tileById(ui.selectedTileId), hover = tileById(ui.hoverTileId);
    const radiusTile = (ui.mode !== 'playback') ? ((selected && selected.kind === 'amenity') ? selected : (hover && hover.kind === 'amenity') ? hover : null) : null;
    renderer.draw({
      board: state.board, ghost: ui.mode === 'place' ? ui.ghost : null, selectedTile: selected, hoverTile: hover, radiusTile,
      highlightEdges: ui.ghost && ui.ghost.ok ? ui.ghost.claims.map(c => c.edge) : (ui.mode === 'target' && ui.card && ui.card.target === 'edge' ? Object.keys(state.board.edges).filter(e => state.board.edges[e] !== 'green') : null),
      edgeHover: ui.edgeHover,
      result: (ui.mode === 'playback' || ui.heat) ? (ui.pb.result || state.lastResult) : null,
      T: ui.mode === 'playback' ? ui.pb.T : null, heat: ui.heat, closedTiles: closed,
      targetMode: ui.mode === 'target' && ui.card && ui.card.target !== 'edge' ? targetFilter : null,
    });
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ modals
function openModal(...children) { const box = $('modal-box'); box.className = ''; box.innerHTML = ''; box.append(...children); $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }

function drawHistoryChart(canvas, history) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 800, H = 190;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const padL = 44, padR = 10, padT = 12, padB = 24;
  const vals = history.flatMap(x => [x.score, x.quota]).filter(v => v > 0);
  const lo = Math.max(1, Math.min(...vals) / 1.6), hi = Math.max(...vals) * 1.25;
  const ly = v => padT + (H - padT - padB) * (1 - (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
  const n = history.length, slot = (W - padL - padR) / n;
  g.font = '11px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
  // grid lines at 1, 2, 5 x 10^k
  for (let k = 3; k < 8; k++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, k); if (v < lo || v > hi) continue; const y = ly(v); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillStyle = '#9aa0b0'; g.fillText(v >= 1000 ? (v / 1000) + 'k' : v, padL - 6, y); }
  // bars
  history.forEach((x, i) => {
    const cx = padL + slot * (i + 0.5), bw = Math.min(28, slot * 0.6);
    const y = ly(x.score), base = H - padB;
    g.fillStyle = x.passed ? 'rgba(108,196,108,0.85)' : 'rgba(240,90,126,0.85)';
    g.fillRect(cx - bw / 2, y, bw, base - y);
    g.fillStyle = '#9aa0b0'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(x.week % CONFIG.run.eventEvery === 0 ? x.week + '★' : x.week, cx, base + 4);
  });
  // quota line
  g.strokeStyle = '#f0b24f'; g.lineWidth = 2; g.beginPath();
  history.forEach((x, i) => { const cx = padL + slot * (i + 0.5); const y = ly(x.quota); if (i === 0) g.moveTo(cx, y); else g.lineTo(cx, y); });
  g.stroke();
  history.forEach((x, i) => { const cx = padL + slot * (i + 0.5); g.fillStyle = '#f0b24f'; g.beginPath(); g.arc(cx, ly(x.quota), 3, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#f0b24f'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '600 11px system-ui, sans-serif';
  g.fillText('quota', padL + 4, padT + 2);
}

function showSummary() {
  const r = ui.pb.result; const quota = G.quotaFor(state);
  const passed = r.score >= quota;
  const history = state.history.concat([{ week: state.week, score: r.score, quota, passed, money: r.money.total }]);
  const rows = Object.values(r.tileStats).sort((a, b) => b.points - a.points);
  const table = h('table', { class: 'stats' }, h('tr', {}, ...['Tile', 'Served', 'Turned away', 'Full', 'Earned', 'Points', 'Arrived', 'Boarded', 'Stranded'].map(x => h('th', {}, x))));
  for (const s of rows) {
    const t = tileById(s.id);
    table.append(h('tr', {}, h('td', {}, `${s.name}${t && t.level > 1 ? ' L' + t.level : ''}`), h('td', {}, s.kind === 'amenity' ? s.serves : '–'), h('td', {}, s.kind === 'amenity' ? s.balks : '–'), h('td', {}, s.cap ? (s.saturation * 100).toFixed(0) + '%' : '–'), h('td', {}, '$' + fmt(s.revenue)), h('td', {}, fmt(s.points)), h('td', {}, s.kind === 'transport' ? s.spawned : '–'), h('td', {}, s.kind === 'transport' ? s.boarded : '–'), h('td', {}, s.kind === 'transport' ? s.stranded : '–')));
  }
  const chart = h('canvas', { id: 'chart' });
  const stranded = r.counts.stranded ? ` · ${r.counts.stranded} stranded` : '';
  const stolen = r.points.stolen ? ` · ${fmtK(r.points.stolen)} stolen by ${r.counts.pickpockets} pickpockets` : '';
  openModal(
    h('h2', {}, `Week ${state.week}`, G.currentEvent(state) ? h('span', { class: 'event-tag accent', style: 'margin-left:8px' }, G.currentEvent(state).name) : null),
    h('div', { class: 'row' }, h('span', { class: 'big ' + (passed ? 'good' : 'bad') }, fmt(r.score)), h('span', { class: 'lbl' }, `of ${fmt(quota)} needed`), h('span', { class: passed ? 'good' : 'bad' }, passed ? '✓ quota met' : '✗ quota missed — run over'), h('span', { class: 'spacer' }), h('span', { class: 'accent' }, `+$${fmt(r.money.total)}`)),
    h('div', { style: 'font-size:12px;color:var(--muted);margin:2px 0 8px' }, `${r.counts.boarded} boarded${stranded}${stolen}`),
    chart,
    h('details', {}, h('summary', {}, 'Per-tile breakdown'), h('div', { style: 'max-height:240px;overflow:auto' }, table)),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); ui.heat = true; ui.mode = 'heat'; $('board-hint').innerHTML = ''; showHeatBar(); } }, 'Where did people walk?'), h('button', { class: 'primary', onclick: continueFromSummary }, passed ? 'Continue →' : 'See results')));
  requestAnimationFrame(() => drawHistoryChart(chart, history));
}
function showHeatBar() {
  const el = $('board-hint'); el.innerHTML = '';
  el.style.pointerEvents = 'auto';
  el.append(h('button', { class: 'primary', onclick: () => { ui.heat = false; ui.mode = 'playback'; el.innerHTML = ''; el.style.pointerEvents = 'none'; showSummary(); } }, 'Back to summary'));
}
function continueFromSummary() {
  closeModal();
  ui.heat = false;
  const r = G.settle(state);
  recordRun(meta, state);
  if (!r.passed) { clearRun(); showGameOver(); ui.mode = 'over'; renderAll(); return; }
  ui.mode = 'idle';
  if (state.phase === 'won') { showWin(); return; }
  afterWeekStart();
}
function afterWeekStart() {
  renderer.resize(state.board);
  renderAll();
  const evThen = () => { if (G.isEventWeek(state) && ui.eventShownWeek !== state.week) { ui.eventShownWeek = state.week; showEventModal(); } };
  if (state.pendingOrdinance) showOrdinance(evThen); else evThen();
}
function showEventModal(onDone) {
  const ev = G.currentEvent(state);
  if (!ev) { if (onDone) onDone(); return; }
  const box = $('modal-box');
  const parts = [
    h('div', {}, h('span', { class: 'boss-star' }, '★')),
    h('div', { class: 'lbl' }, `Week ${state.week} · event week`),
    h('h2', {}, ev.name),
    h('div', { class: 'event-mult' }, `Quota ×${ev.quota} → ${fmt(G.quotaFor(state))}`),
    h('p', {}, ev.desc),
  ];
  if (ev.mods.strike) {
    const terrains = G.transportTerrainsOnBoard(state);
    const sel = h('select', { onchange: e => { G.setStrike(state, e.target.value); persist(); scheduleProjection(); renderSide(); } });
    for (const t of terrains) sel.append(h('option', { value: t }, TERRAIN_INFO[t].label));
    if (terrains.length && !state.strikeChoice) G.setStrike(state, terrains[0]);
    parts.push(h('div', { class: 'row', style: 'justify-content:center' }, 'Which transport type strikes? ', sel));
  }
  parts.push(h('div', { class: 'btnrow', style: 'justify-content:center' }, h('button', { class: 'primary', onclick: () => { closeModal(); box.classList.remove('event'); if (onDone) onDone(); } }, 'Bring it on')));
  openModal(...parts);
  box.classList.add('event');
}
function showOrdinance(onDone) {
  openModal(h('h2', {}, `Week ${state.week}: choose an ordinance`), h('p', {}, 'Permanent for the rest of the run.'),
    h('div', { class: 'choices' }, ...state.pendingOrdinance.map(k => h('div', { class: 'mode', onclick: () => { G.chooseOrdinance(state, k); closeModal(); renderAll(); if (onDone) onDone(); } }, h('div', { class: 'name' }, ORDINANCES[k].name), h('div', { class: 'desc' }, ORDINANCES[k].desc)))));
}
function showWin() {
  openModal(h('h2', { class: 'good' }, 'Grand Central Station is a success!'), h('p', {}, `You cleared week ${CONFIG.run.winWeek}. The quota keeps climbing in endless mode — how far can you go?`),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); showStart(); } }, 'New run'), h('button', { class: 'primary', onclick: () => { G.continueAfterWin(state); closeModal(); afterWeekStart(); } }, 'Keep going →')));
}
function showGameOver() {
  const last = state.history[state.history.length - 1];
  openModal(h('h2', { class: 'bad' }, 'The run is over'), h('p', {}, `Week ${last.week}: ${fmt(last.score)} points against a quota of ${fmt(last.quota)}.`),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Best week score'), h('span', {}, fmt(state.records.bestScore)), h('span', { class: 'k' }, 'Best traveller'), h('span', {}, fmt(state.records.bestTraveller)), h('span', { class: 'k' }, 'Seed'), h('span', {}, state.seed)),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); ui.mode = 'over'; } }, 'Inspect board'), h('button', { class: 'primary', onclick: () => { closeModal(); showStart(); } }, 'New run')));
}

function showStart() {
  const saved = loadRun();
  const seedInput = h('input', { type: 'text', placeholder: 'seed (optional)', style: 'font:inherit;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px;width:160px' });
  const modes = h('div', { class: 'modes' });
  for (const k of MODE_KEYS) {
    const m = MODES[k];
    const unlocked = meta.bestWeek >= m.unlockWeek;
    const rec = meta.byMode[k];
    modes.append(h('div', { class: 'mode' + (unlocked ? '' : ' locked'), onclick: unlocked ? () => newRun(k, seedInput.value.trim()) : null },
      h('div', { class: 'name' }, m.name, unlocked ? '' : ` 🔒 reach week ${m.unlockWeek}`), h('div', { class: 'desc' }, m.desc), rec ? h('div', { class: 'desc', style: 'margin-top:4px' }, `Best: week ${rec.bestWeek}, ${fmt(rec.bestScore)} pts`) : null));
  }
  openModal(h('h2', {}, h('span', { class: 'logo' }, 'GCS'), ' Grand Central Station'),
    h('p', {}, 'You run a transit hub. Each week, place a few tiles, then watch travellers cross the board. Every shop they pass multiplies what they are worth. Hit the quota or the run ends.'),
    h('p', { style: 'font-size:12px;color:var(--muted)' }, 'Transport tiles bring people but score badly. Amenities score well but bring nobody. Multiply first, then add: flat-add tiles want to be early on a route, multipliers late. Transports claim edge terrain permanently — rail and water lock an entire edge.'),
    saved ? h('div', { class: 'btnrow', style: 'justify-content:flex-start' }, h('button', { class: 'primary', onclick: () => { state = G.deserialize(saved); ui.started = true; closeModal(); ui.mode = 'idle'; afterWeekStart(); } }, 'Resume saved run')) : null,
    h('h3', {}, 'Choose a mode'), modes,
    h('div', { class: 'row', style: 'margin-top:12px' }, seedInput, h('span', { style: 'font-size:12px;color:var(--muted)' }, `Records: week ${meta.bestWeek} · best week ${fmt(meta.bestScore)} pts · best traveller ${fmt(meta.bestTraveller)}`)));
}
function newRun(modeKey, seedText) {
  const seed = seedText ? (isNaN(Number(seedText)) ? seedText : Number(seedText)) : null;
  state = G.createRun({ modeKey, seed });
  ui.started = true;
  closeModal(); ui.mode = 'idle'; ui.selectedTileId = null; ui.heat = false; ui.pb.result = null;
  afterWeekStart();
}
function showMenu() {
  openModal(h('h2', {}, 'Menu'),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode'), h('span', {}, MODES[state.modeKey].name), h('span', { class: 'k' }, 'Seed'), h('span', {}, state.seed), h('span', { class: 'k' }, 'Week'), h('span', {}, state.week)),
    h('h3', {}, 'History'), h('table', { class: 'stats' }, h('tr', {}, h('th', {}, 'Week'), h('th', {}, 'Score'), h('th', {}, 'Quota'), h('th', {}, 'Money'), h('th', {}, 'Event')), ...state.history.map(x => h('tr', {}, h('td', {}, x.week), h('td', { class: x.passed ? 'good' : 'bad' }, fmt(x.score)), h('td', {}, fmt(x.quota)), h('td', {}, '+$' + fmt(x.money)), h('td', {}, x.event || '')))),
    h('div', { class: 'btnrow' }, h('button', { class: 'danger', onclick: () => { clearRun(); closeModal(); showStart(); } }, 'Abandon run'), h('button', { class: 'primary', onclick: closeModal }, 'Back')));
}

// ------------------------------------------------------------ boot
function boot() {
  const c = renderer.canvas;
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerleave', onPointerLeave);
  c.addEventListener('click', onClick);
  c.addEventListener('wheel', e => { if (ui.mode === 'place') { e.preventDefault(); rotate(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
  c.addEventListener('contextmenu', e => { e.preventDefault(); if (ui.mode === 'place') rotate(1); else cancelMode(); });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { if (state) renderer.resize(state.board); });
  $('btn-run').addEventListener('click', startWeek);
  $('btn-reroll').addEventListener('click', () => { const r = G.reroll(state); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); });
  $('btn-wait').addEventListener('click', () => { const r = G.wait(state); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); });
  $('btn-menu').addEventListener('click', () => { if (state) showMenu(); else showStart(); });
  const layout = (() => { try { return JSON.parse(localStorage.getItem('gcs.layout') || '{}'); } catch { return {}; } })();
  const applyLayout = () => {
    $('shop').classList.toggle('collapsed', !!layout.shopCollapsed);
    $('main').classList.toggle('side-collapsed', !!layout.sideCollapsed);
    $('side-tab').classList.toggle('hidden', !layout.sideCollapsed);
    try { localStorage.setItem('gcs.layout', JSON.stringify(layout)); } catch {}
    if (state) renderer.resize(state.board);
  };
  $('btn-shop-toggle').addEventListener('click', () => { layout.shopCollapsed = true; applyLayout(); });
  $('btn-shop-expand').addEventListener('click', () => { layout.shopCollapsed = false; applyLayout(); });
  $('btn-run-big').addEventListener('click', startWeek);
  $('btn-side-toggle').addEventListener('click', () => { layout.sideCollapsed = true; applyLayout(); });
  $('side-tab').addEventListener('click', () => { layout.sideCollapsed = false; applyLayout(); });
  applyLayout();
  document.querySelectorAll('#playback .speed').forEach(b => b.addEventListener('click', () => setSpeed(b.dataset.speed === 'skip' ? 'skip' : Number(b.dataset.speed))));
  state = G.createRun({ modeKey: 'terminal', seed: 1 }); // placeholder board behind the start modal
  renderer.resize(state.board);
  renderAll();
  requestAnimationFrame(frame);
  showStart();
}
boot();
// Debug/testing handle: window.gcs.state, window.gcs.G (game API), window.gcs.refresh()
window.gcs = { get state() { return state; }, set state(v) { state = v; }, G, renderer, refresh: () => { renderer.resize(state.board); renderAll(); }, ui, showStart, afterWeekStart };
