// ============================================================================
// Grand Central Station - browser UI. DOM chrome + canvas board + playback.
// ============================================================================
import { CONFIG, starsOf, starTarget } from '../config.js';
import * as G from '../game/run.js';
import { tileDef, TERRAIN_INFO, LINE_INFO, NAMED_UPGRADES } from '../data/tiles.js';
import { MODES, MODE_KEYS } from '../data/modes.js';
import { DIFFICULTIES, DIFFICULTY_KEYS } from '../data/difficulties.js';
import { ORDINANCES } from '../data/ordinances.js';
import { CARDS } from '../data/cards.js';
import { orientationCount, shapeCells } from '../sim/shapes.js';
import { cutOffTransports } from '../sim/board.js';
import { effTransport, effAmenity } from '../sim/sim.js';
import { BoardRenderer, colorForDef } from './render.js';
import { attachBoardInput } from './boardinput.js';
import { playTrack, isMuted, setMuted } from './audio.js';
import { loadMeta, saveMeta, recordRun, saveRun, loadRun, clearRun } from './meta.js';

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
const EDGE_NAMES = { N: 'north', E: 'east', S: 'south', W: 'west' };
const fmtK = n => Math.abs(n) >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : fmt(n);
const tierTag = t => t > 0 ? h('span', { class: 'tier tier' + t }, CONFIG.tiers[t - 1].symbol) : null;

// ------------------------------------------------------------------ stars
// Quotas and weekly scores are shown as stars, one per 1,000 points. Up to ten
// they are drawn as glyphs; past that a row of stars stops being countable, so
// it becomes a plain "11 ★". Never both at once.
const STAR_GLYPH_MAX = 10;
function starStrip(total, filled = 0, preview = 0, showEarned = true) { return fillStars(h('div', { class: 'stars' }), total, filled, preview, showEarned); }
// Paints a star row into an existing .stars element (so the top bar keeps its
// own sizing box rather than nesting a second flex container inside it).
function fillStars(el, total, filled = 0, preview = 0, showEarned = true) {
  el.innerHTML = '';
  el.classList.toggle('numeric', total > STAR_GLYPH_MAX);
  if (total > STAR_GLYPH_MAX) {
    el.append(h('b', {}, showEarned ? `${fmt(filled)} / ${fmt(total)}` : fmt(total)), h('i', { class: 'glyph' }, '★'));
    el.classList.toggle('met', showEarned && filled >= total);
    return el;
  }
  el.style.setProperty('--star', total > 6 ? '18px' : '22px');
  for (let i = 0; i < total; i++) el.append(h('span', { class: 'star' + (i < filled ? ' lit' : i < preview ? ' preview' : '') }, '★'));
  if (filled > total) el.append(h('span', { class: 'over' }, `+${fmt(filled - total)}`));
  return el;
}
// compact "5★" badge for the timeline, tables and summaries
function starNum(n, cls = '') { return h('span', { class: 'starnum ' + cls }, fmt(n), h('i', {}, '★')); }

// ------------------------------------------------------------------ state
let state = null;
const meta = loadMeta();
const ui = {
  mode: 'idle', card: null, rot: 0, hover: null, edgeHover: null, selectedTileId: null, hoverTileId: null,
  ghost: null, estimate: null, estimateKey: null, estimateTimer: null, projection: null, projectionTimer: null,
  pb: { result: null, T: 0, speed: 2, playing: false, last: 0 }, heat: false, summaryShown: false, started: false, barKey: null,
  starKey: null,
};
const renderer = new BoardRenderer($('board'));
let boardInput = null;
// Panel preferences that survive a reload. First visit on a phone hands the
// whole screen to the board.
const layout = (() => { try { return JSON.parse(localStorage.getItem('gcs.layout') || 'null'); } catch { return null; } })()
  || (window.innerWidth < 700 ? { sideCollapsed: true } : {});
const saveLayout = () => { try { localStorage.setItem('gcs.layout', JSON.stringify(layout)); } catch {} };
const TICKS_PER_SEC = 2;

// --------------------------------------------------------------- helpers
function tileById(id) { return state.board.tiles.find(t => t.id === id) || null; }
function tileAtCell(x, y) { return state.board.tiles.find(t => t.cells.some(c => c[0] === x && c[1] === y)) || null; }
function mods() { return G.computeMods(state); }
function persist() { if (ui.started && state && state.phase !== 'lost') saveRun(G.serialize(state)); }

const ticks = n => `${n} tick${n === 1 ? '' : 's'}`;
function describeTile(tile, def) {
  const m = mods();
  const rows = [];
  if (def.kind === 'transport') {
    const e = effTransport(tile || { key: def.key, level: 1 }, m);
    rows.push(['Brings in', `${e.batch} ${CONFIG.tiers[def.tier - 1].symbol} travellers every ${ticks(e.arr)}`], ['Rides leave', `every ${ticks(e.dep)}${e.dwell ? `, after a ${ticks(e.dwell)} wait` : ''}`]);
    rows.push(['Boost', `×${e.mult.toFixed(2)}${e.flat ? ' +' + Math.round(e.flat) : ''} when they board here`], ['Terrain', TERRAIN_INFO[def.terrain].label]);
    if (def.walkable) rows.push(['Floor', 'Travellers walk straight over it, so it never blocks a path']);
    if (def.terrain === 'underground') {
      const tn = tile && tile.tunnel;
      rows.push(['Tunnel', tn ? (tn.line === 'through' ? `Comes up at the ${EDGE_NAMES[tn.ends[0]]} and ${EDGE_NAMES[tn.ends[1]]} edges` : `${tn.cells.length} square${tn.cells.length === 1 ? '' : 's'} to the ${EDGE_NAMES[tn.ends[0]]} edge`) : LINE_INFO[def.line]]);
      rows.push(['Layer', 'Build anything over it, but no other tunnel can cross']);
    }
    if (e.offline) rows.push(['Status', 'Not running this week']);
    else if (e.skeleton) rows.push(['Status', `On strike: only ${Math.round(CONFIG.sim.strikeSkeletonBatch * 100)}% of the usual crowd`]);
    if (def.special === 'loop') rows.push(['Special', `${Math.round(def.loopChance * 100)}% of the people who leave come back round, still carrying their boost`]);
  } else if (def.kind === 'amenity') {
    const e = effAmenity(tile || { key: def.key, level: 1 }, m);
    const walk = def.walkable && def.special !== 'waiting' ? [['Floor', 'Travellers walk straight over it, so it never blocks a path']] : [];
    if (def.special === 'wifi') {
      const w = CONFIG.sim.wifi;
      rows.push(['Effect', `Helps every tile within ${def.radius + ((tile && tile.radiusBonus) || 0)} squares`], ['Shops', `draw ${Math.round(w.rate * 100)}% more people and boost +${w.mult.toFixed(2)} more`], ['Lounges', `+${w.stack.toFixed(2)} for every tick waited`], ['Transports', `+${w.exit.toFixed(2)} when travellers board`],
        ['Together', `Up to ${w.cap} hotspots help one tile; every level counts for ${Math.round(w.perLevel * 100)}% more`], ...walk);
    }
    else if (def.special === 'walkway') rows.push(['Effect', `Carries travellers ${CONFIG.sim.walkwaySpeed} squares a tick, and they can still stop at shops along the way`]);
    else if (def.special === 'security') rows.push(['Effect', 'Picks up any pickpocket who comes near'], ['Range', def.radius + ((tile && tile.radiusBonus) || 0)], ...walk);
    else if (def.special === 'gate') {
      const ck = CONFIG.sim.checkpoint;
      const mult = ck.mult + ck.multPerLevel * (((tile && tile.level) || 1) - 1);
      rows.push(['Effect', 'A fence runs right across the board through the booth, and the booth is the only way past. Rotate to turn the fence.'],
        ['Who crosses', ck.filter ? 'Only travellers whose platform is on the far side' : 'Anyone heading for the far side'],
        ['Reward', `Worth ×${mult.toFixed(2)} more, and ${ck.budgetBonus} extra stops on the way. Once per traveller.`], ['Security', 'Catches pickpockets who walk through']);
    }
    else if (def.special === 'waiting') rows.push(['Effect', `Travellers are worth more the longer they sit here: +${e.stackValue.toFixed(2)} a tick`], ['Limit', 'Richer travellers will sit for longer'], ['Range', e.radius], ['Holds', e.cap], ...(e.revenue >= 0.05 ? [['Earns', `$${e.revenue.toFixed(1)} per guest`]] : []), ...(e.minTier > 1 ? [['Only for', CONFIG.tiers[e.minTier - 1].symbol + ' travellers and up']] : []));
    else {
      rows.push(['Best for', def.special === 'anytier' ? 'travellers of any tier' : `${CONFIG.tiers[def.tier - 1].symbol} travellers`], ['Draws in', `up to ${(e.rate * 100).toFixed(0)}% of travellers within ${e.radius} squares`]);
      rows.push(['Boost', `×${e.mult.toFixed(2)}${e.flat ? ' +' + Math.round(e.flat) : ''} for everyone who stops`], ['Serves', `${e.cap} at a time, ${ticks(e.dur)} each`]);
      if (e.revenue >= 0.05) rows.push(['Earns', `$${e.revenue.toFixed(1)} per visit`]);
      if (def.special === 'green') rows.push(['Special', 'A free stop: travellers get back the stop they spend here'], ...walk);

      if (e.closed) rows.push(['Status', 'Closed for inspection']);
      else if (e.restricted) rows.push(['Status', 'Inspection: a slow week until level 2']);
    }
  } else if (def.kind === 'bridge') {
    rows.push(['Effect', 'Opens a short stretch of the edge beside it, so any kind of transport can attach there. Travellers can walk over it.']);
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

// Stars in the top bar: empty sockets for the week's quota that light up as the
// week plays. Rebuilt only when the numbers actually move, so it is cheap to
// call from the animation loop.
function renderQuotaStars() {
  const total = G.quotaStars(state);
  let filled = 0;
  if (ui.mode === 'playback' && ui.pb.result) {
    const r = ui.pb.result, t = Math.min(r.ticks, Math.max(0, Math.floor(ui.pb.T)));
    filled = starsOf(r.scoreByTick ? r.scoreByTick[t] : r.score);
  } else if (state.phase === 'summary' && state.lastResult) filled = starsOf(state.lastResult.score);
  const preview = (state.phase === 'shop' && ui.projection) ? starsOf(ui.projection.pts) : 0;
  const showEarned = ui.mode === 'playback' || !!(state.phase === 'summary' && state.lastResult);
  const key = `${total}/${filled}/${preview}/${showEarned}`;
  if (ui.starKey === key) return;
  ui.starKey = key;
  fillStars($('quota-stars'), total, Math.max(0, filled), Math.max(0, preview), showEarned);
}

// Where the top bar's window sits on its red → lime ramp (0..1): half the
// quota or less is dark red, meeting it reads orange-into-green, and about
// 1.6x the quota is green-into-lime. Gold takes over at double.
function quotaHeat(ratio) {
  if (ratio <= 0.5) return 0;
  if (ratio <= 1) return (ratio - 0.5) / 0.5 * 0.6;
  return Math.min(1, 0.6 + (ratio - 1) / 0.6 * 0.4);
}

function renderTop() {
  const quota = G.quotaFor(state);
  $('st-week').textContent = state.week + (G.isEventWeek(state) ? ' ⚡' : '');
  $('st-quota').textContent = fmt(quota);
  ui.starKey = null; renderQuotaStars();
  const bar = $('topbar');
  if (state.phase !== 'shop') { bar.classList.remove('gold', 'tinted'); bar.title = ''; $('st-proj').textContent = ''; }
  else if (ui.projection) {
    const avg = ui.projection.pts;
    const ratio = avg / quota;
    $('st-proj').textContent = `${fmtK(ui.projection.ptsLo)}–${fmtK(ui.projection.ptsHi)}`;
    bar.title = `Projected this week: ${starsOf(ui.projection.ptsLo)}★ to ${starsOf(ui.projection.ptsHi)}★ of ${G.quotaStars(state)}★ (${fmtK(ui.projection.ptsLo)}–${fmtK(ui.projection.ptsHi)} points)`;
    const gold = ratio >= 2;
    bar.classList.toggle('gold', gold);
    bar.classList.toggle('tinted', !gold);
    if (!gold) bar.style.backgroundPosition = `${(quotaHeat(ratio) * 100).toFixed(1)}% 0`;
  }
  // else the projection is still being worked out: keep the current look
  // rather than flashing back to plain for a frame
  const canRun = state.phase === 'shop' && ui.mode !== 'playback';
  $('btn-run').disabled = !canRun;
  const early = state.phase === 'shop' ? G.earlyFinishBonus(state) : 0;
  $('btn-run').innerHTML = `Run Week ▶${early ? `<br><small>+$${fmt(early)} early finish</small>` : ''}`;
  $('btn-run').title = early ? `Every action point you have not spent pays $${fmt(G.earlyFinishPerAP(state))} when the week runs` : '';
  $('btn-run-big').classList.toggle('hidden', !(canRun && state.ap === 0 && (ui.mode === 'idle' || ui.mode === 'over')));
  $('playback').classList.toggle('hidden', ui.mode !== 'playback');
  // wallet
  $('st-money').textContent = '$' + fmt(state.money);
  $('st-ap').textContent = state.ap;
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
    g.strokeStyle = 'rgba(255,210,63,0.75)'; g.setLineDash([2, 2]);
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
  box.append(cardBody(card));
  return box;
}
// Everything a card says apart from its name: the same text the hover popup
// shows, so the card bar can carry it on a screen that cannot hover.
function cardBody(card) {
  const box = h('div');
  if (card.type === 'tile' || card.type === 'bridge') {
    const def = tileDef(card.key);
    box.append(describeTile(null, def));
    if (def.kind === 'transport') box.append(h('div', { class: 'desc' }, TERRAIN_INFO[def.terrain].desc));
  } else box.append(h('div', { class: 'desc' }, card.desc || ''));
  if (card.type === 'upgrade' || card.type === 'named_upgrade') box.append(h('div', { class: 'desc' }, 'Every level draws more people to a shop, serves more of them at once, and pays more. A transport brings bigger crowds and gives a bigger boost when they board.'));
  if (card.type === 'upgrade') {
    const targets = G.upgradeTargets(state, card);
    box.append(h('div', { class: 'desc' }, targets.length === 1
      ? `You own one ${card.tileName} (level ${targets[0].level}).`
      : `You own ${targets.length} ${card.tileName}s — pick the one to raise.`));
  }
  return box;
}

function renderShop() {
  // Nothing in the tray can be spent once the week is running, so it folds
  // itself away for the show and comes back with the next shop.
  $('shop').classList.toggle('collapsed', state.phase !== 'shop' || ui.mode === 'playback' || ui.mode === 'heat');
  const wrap = $('shop-cards'); wrap.innerHTML = '';
  for (const card of state.shop.cards) {
    const cost = G.cardCost(state, card);
    const affordable = state.money >= cost && state.ap >= G.cardAPCost(state, card);
    const isTile = card.type === 'tile' || card.type === 'bridge';
    const def = isTile ? tileDef(card.key) : null;
    const kind = cardKindLabel(card);
    const kclass = { transport: 'k-transport', amenity: 'k-amenity', utility: 'k-utility', lounge: 'k-lounge', upgrade: 'k-upgrade', 'bonus card': 'k-bonus', structure: 'k-structure' }[kind] || '';
    const el = h('div', { class: 'card ' + kclass + (ui.card && ui.card.id === card.id ? ' selected' : '') + (affordable ? '' : ' unaffordable'), onclick: () => selectCard(card) },
      h('span', { class: 'slot' }, cardKindLabel(card)),
      // an upgrade card leads with the tile it upgrades; its own name goes underneath
      h('div', { class: 'name' }, card.type === 'upgrade' ? card.tileName : card.name),
      isTile ? shapeCanvas(def, 84, 76) : h('div', { class: 'icon' }, CARD_ICONS[card.type] || '?'),
      h('div', { class: 'sub' }, def ? [def.tier > 0 ? tierTag(def.tier) : null, def.kind === 'transport' ? ` · ${TERRAIN_INFO[def.terrain].label}` : (def.tier > 0 ? '' : def.shape)] : (card.type === 'upgrade' ? card.name : '')),
      h('div', { class: 'cost' }, `$${fmt(cost)}`));
    // hover detail only for devices that hover; on touch the card popup would
    // sit on top of the board and the placement controls
    el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') showPopup(cardDetails(card), e.clientX, e.clientY, false); });
    el.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') positionPopup(e.clientX, e.clientY); });
    el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') hidePopup(false); });
    wrap.append(el);
  }
  const fee = G.rerollFee(state);
  $('btn-reroll').innerHTML = `Reroll${fee ? `<br><small>$${fmt(fee)}</small>` : ''}`;
  $('btn-reroll').disabled = state.phase !== 'shop' || state.ap < 1 || state.money < fee;
}

// ------------------------------------------------------------ popup
function showPopup(content, x, y, sticky) {
  const p = $('popup'); p.innerHTML = ''; p.append(content);
  // a pinned popup has to be closable without a keyboard or a spare click
  if (sticky) p.append(h('button', { class: 'popup-close', title: 'Close', onclick: () => { ui.selectedTileId = null; hidePopup(true); renderInfo(); } }, '✕'));
  p.classList.remove('hidden'); p.classList.toggle('sticky', !!sticky); p.dataset.sticky = sticky ? '1' : '';
  positionPopup(x, y);
}
function positionPopup(x, y) {
  const p = $('popup'); if (p.classList.contains('hidden')) return;
  const r = p.getBoundingClientRect();
  let px = x + 16, py = y + 16;
  if (px + r.width > window.innerWidth - 8) px = x - r.width - 12;
  if (py + r.height > window.innerHeight - 8) py = y - r.height - 12;
  // a flip can run off the other side of a narrow screen, so pin it inside
  const fit = (v, size, limit) => Math.min(Math.max(8, v), Math.max(8, limit - size - 8));
  p.style.left = fit(px, r.width, window.innerWidth) + 'px';
  p.style.top = fit(py, r.height, window.innerHeight) + 'px';
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
    const line = t.kind === 'transport' ? `Last week: ${st.spawned} arrived, ${st.boarded} caught a ride, ${st.stranded} ran out of time${st.lost ? `, ${st.lost} never got there` : ''}` : `Last week: ${st.serves} served${st.balks ? `, ${st.balks} turned away` : ''}${st.cap ? `, ${(st.saturation * 100).toFixed(0)}% full` : ''}`;
    box.append(h('div', { class: 'desc' }, line));
  }
  if (sticky && state.phase === 'shop') {
    const rules = G.gameRules(state);
    const upCard = state.shop.cards.find(c => c.type === 'upgrade' && c.key === t.key);
    const up = upCard ? G.upgradeCost(t, upCard.levels, upCard.costMult) : null;
    box.append(h('div', { class: 'btnrow', style: 'justify-content:flex-start;margin-top:8px' },
      h('button', { class: 'danger small', onclick: () => { const r = G.deleteTile(state, t.id); if (!r.ok) hint(r.reason); ui.selectedTileId = null; hidePopup(true); renderAll(); } }, rules.deleteFreeAP ? 'Delete (free)' : 'Delete (1 AP)'),
      up != null && t.kind !== 'bridge' ? h('span', { class: 'desc' }, `${upCard.name} is $${fmt(up)} in the shop right now`) : null));
  }
  return box;
}

function renderTimeline() {
  const tl = $('timeline'); tl.innerHTML = '';
  const rows = [];
  const last = state.history[state.history.length - 1];
  if (last) rows.push(h('div', { class: 'tl-row past ' + (last.passed ? 'ok' : 'fail') }, h('span', { class: 'wk' }, `Week ${last.week}`),
    h('span', { class: 'q', title: `${fmt(last.score)} points of ${fmt(last.quota)}` }, 'earned ', starNum(starsOf(last.score), last.passed ? 'good' : 'bad'))));
  const nextEv = G.nextEventWeek(state);
  const rules = G.runRules(state);
  for (let w = state.week; w <= state.week + 4; w++) {
    const current = w === state.week;
    const ev = G.eventForWeek(state, w);
    const known = ev && (w === nextEv || current || (state.surveyed && w === nextEv + rules.eventEvery));
    const ord = rules.ordinanceWeeks.includes(w);
    const ms = G.milestoneForWeek(state, w);
    const cls = ['tl-row', current ? 'current' : '', ev ? 'event' : (ord ? 'ordinance' : (ms ? 'milestone' : '')), w === state.week + 4 ? 'last' : ''].join(' ');
    const showQuota = current || known || !ev;
    const row = h('div', { class: cls }, h('span', { class: 'wk' }, `Week ${w}`),
      h('span', { class: 'q', title: showQuota ? `${fmt(G.quotaFor(state, w))} points${G.quotaFromForm(state, w) ? ' — your best week has raised what is expected of you' : ''}` : '' },
        showQuota ? ['needs ', starNum(G.quotaStars(state, w)), G.quotaFromForm(state, w) ? h('span', { class: 'k', style: 'margin-left:4px' }, '▲') : null] : ''));
    if (ev) {
      const body = h('div', { class: 'sub', id: current ? 'event-body' : null });
      if (known) {
        body.append(h('span', { class: 'tag' }, `Event: ${ev.name} ×${G.fmtMult(G.eventMult(ev))}`), h('div', {}, ev.desc));
        if (current && ev.mods.strike) {
          const terrains = G.transportTerrainsOnBoard(state);
          const sel = h('select', { onchange: e => { G.setStrike(state, e.target.value); persist(); scheduleProjection(); } });
          for (const t of terrains) sel.append(h('option', { value: t, selected: state.strikeChoice === t ? '' : null }, TERRAIN_INFO[t].label));
          if (!terrains.length) sel.append(h('option', {}, 'no transports'));
          if (!state.strikeChoice && terrains.length) G.setStrike(state, terrains[0]);
          body.append(h('div', { class: 'row', style: 'margin-top:4px' }, 'Striking: ', sel));
          if (terrains.length <= 1) body.append(h('div', { class: 'warn' }, `It is your only transport, so it keeps running at ${Math.round(CONFIG.sim.strikeSkeletonBatch * 100)}% instead of stopping.`));
        }
      } else body.append(h('span', { class: 'tag' }, 'Event week'), h('div', {}, 'You will find out what it is once this event is done.'));
      row.append(body);
    }
    if (ord) row.append(h('div', { class: 'sub' }, h('span', { class: 'tag' }, 'Ordinance!'), h('div', {}, 'Pick one of three new rules. It lasts the rest of the run.')));
    if (ms) row.append(h('div', { class: 'sub' }, h('span', { class: 'tag' }, ms.name), h('div', {}, ms.desc)));
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

// A card in hand is one of three things: a tile being aimed, a card looking for
// a target, or a card that fires the moment it is played.
const holdingCard = () => !!ui.card && (ui.mode === 'place' || ui.mode === 'target' || ui.mode === 'confirm');

// The bar over the shop tray is where a picked card lives: its name, its price,
// the text a touch screen cannot hover for, and the button that spends the
// money. Rebuilt only when the card or the mode changes, because aiming calls
// this on every cursor move.
function renderCardBar() {
  const bar = $('card-bar');
  bar.classList.toggle('hidden', !holdingCard());
  // on a narrow screen the bar sits where the cards are, so they stand down
  $('main').classList.toggle('holding', holdingCard());
  if (!holdingCard()) { ui.barKey = null; return; }
  const card = ui.card, place = ui.mode === 'place', confirm = ui.mode === 'confirm';
  const cost = G.cardCost(state, card), ap = G.cardAPCost(state, card);
  const key = `${card.id}|${ui.mode}|${cost}|${ap}`;
  if (ui.barKey !== key) {
    ui.barKey = key;
    const title = $('card-bar-title'); title.innerHTML = '';
    title.append(h('b', {}, card.name), h('span', { class: 'price' }, `$${fmt(cost)}${ap ? ` · ${ap} AP` : ''}`));
    const desc = $('card-bar-desc'); desc.innerHTML = ''; desc.append(cardBody(card));
    desc.scrollTop = 0;
  }
  $('card-bar-prompt').textContent = ui.mode === 'target'
    ? (card.target === 'edge' ? 'Pick one of the highlighted edges.' : card.type === 'upgrade' ? `Pick a ${card.tileName} to raise it.` : 'Pick one of the highlighted tiles.')
    : (place && !ui.ghost) ? 'Pick a square on the board.' : '';
  $('card-bar-desc').classList.toggle('hidden', !!layout.cardInfoCollapsed);
  $('btn-card-info').textContent = layout.cardInfoCollapsed ? '⌃' : '⌄';
  $('btn-rotate').classList.toggle('hidden', !place);
  if (place) $('btn-rotate').disabled = orientationCount(tileDef(card.key).shape) < 2;
  const go = $('btn-place');
  go.classList.toggle('hidden', !place && !confirm);
  go.textContent = place ? 'Build here' : 'Play it';
  go.disabled = place && !(ui.ghost && ui.ghost.ok);
}

function renderInfo() {
  const panel = $('info-panel'), title = $('info-title'), body = $('info-body'); body.innerHTML = '';
  panel.classList.remove('hidden');
  renderCardBar();
  if (ui.mode === 'playback') { title.textContent = 'Running the week'; body.textContent = 'Shops that are full go grey. Skip ahead any time.'; return; }
  // With a card in hand the board says it all — stars over the ghost, the card
  // bar underneath — so the side panel stays out of the way.
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
// Debounced "what is this worth?" for whatever the cursor is aiming at: a
// pending placement, or an owned tile an upgrade card would raise.
function scheduleEstimate() {
  clearTimeout(ui.estimateTimer);
  const up = upgradeLevels(ui.card);
  let key = null, run = null;
  if (ui.mode === 'place' && ui.card && ui.ghost && ui.ghost.ok) {
    const snap = { key: ui.card.key, x: ui.ghost.x, y: ui.ghost.y, rot: ui.rot };
    key = `place:${snap.key},${snap.x},${snap.y},${snap.rot}`;
    run = () => G.estimatePlacement(state, snap.key, snap.x, snap.y, snap.rot);
  } else if (ui.mode === 'target' && up && ui.hoverTileId != null) {
    const t = tileById(ui.hoverTileId);
    if (t && targetFilter(t)) {
      key = `up:${t.id},${up.levels},${up.radiusBonus},${t.level}`;
      run = () => G.estimateUpgrade(state, t.id, up.levels, up.radiusBonus);
    }
  }
  if (!key) { ui.estimate = null; ui.estimateKey = null; return; }
  if (ui.estimateKey === key && ui.estimate) return;
  ui.estimate = null; ui.estimateKey = key;
  ui.estimateTimer = setTimeout(() => {
    if (ui.estimateKey !== key) return;
    ui.estimate = run();
    renderInfo();
  }, 120);
}

// ------------------------------------------------------------ interaction
// Picking a card never spends anything: it puts the card in the bar, where its
// text can be read and its own button does the spending.
function selectCard(card) {
  if (state.phase !== 'shop' || ui.mode === 'playback') return;
  hint(''); // whatever the last card was told to do no longer applies
  if (ui.card && ui.card.id === card.id) { cancelMode(); return; }
  ui.card = card; ui.rot = 0; ui.selectedTileId = null; ui.estimate = null; ui.estimateKey = null; hidePopup(true);
  if (card.type === 'tile' || card.type === 'bridge') ui.mode = 'place';
  else if (card.type === 'upgrade' || card.type === 'named_upgrade') {
    // an "every lounge" upgrade has nothing to aim at, so it confirms instead
    if (card.type === 'named_upgrade' && card.target === 'waiting_all') {
      if (!state.board.tiles.length) { hint('You have nothing to upgrade yet'); cancelMode(); return; }
      ui.mode = 'confirm';
    } else ui.mode = 'target';
  } else if (card.type === 'card' || card.type === 'ap') {
    ui.mode = (card.target === 'none' || card.type === 'ap') ? 'confirm' : 'target';
  }
  renderShop(); renderInfo(); updateGhost();
}
// The second half of playing a card that needs no target: the Play it button.
function playSelected() {
  if (ui.mode !== 'confirm' || !ui.card) return;
  const card = ui.card;
  const r = card.type === 'named_upgrade' ? G.upgradeTile(state, card, state.board.tiles[0]?.id) : G.playCard(state, card);
  if (!r.ok) hint(r.reason);
  cancelMode(); renderAll();
}
function cancelMode() { ui.mode = state.phase === 'shop' ? 'idle' : ui.mode; ui.card = null; ui.ghost = null; ui.estimate = null; hidePopup(true); renderShop(); renderInfo(); }

function targetFilter(t) {
  const c = ui.card; if (!c) return false;
  const d = tileDef(t.key);
  if (c.type === 'upgrade') return t.key === c.key && t.level < CONFIG.economy.maxLevel;
  if (c.type === 'named_upgrade') { const nu = NAMED_UPGRADES[c.key]; if (nu.target === 'transport') return t.kind === 'transport' && t.level < CONFIG.economy.maxLevel; if (nu.target === 'amenity') return t.kind === 'amenity' && d.rate > 0 && t.level < CONFIG.economy.maxLevel; return false; }
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

// Hover (mouse/pen only) keeps the ghost and tooltips following the cursor.
function onBoardHover(cell, edge, e) {
  const changed = (cell?.x !== ui.hover?.x || cell?.y !== ui.hover?.y || edge !== ui.edgeHover);
  ui.hover = cell; ui.edgeHover = edge;
  if (!changed) return;
  const t = cell ? tileAtCell(cell.x, cell.y) : null;
  ui.hoverTileId = t ? t.id : null;
  if (ui.mode === 'place') updateGhost();
  else if (ui.mode === 'target') {
    // the star badge over the tile is the answer here, so keep the detail
    // popup out of its way
    scheduleEstimate(); hidePopup(false); renderInfo();
  } else {
    renderInfo();
    if (t && ui.mode !== 'playback' && !$('popup').dataset.sticky) showPopup(tileDetails(t, false), e.clientX, e.clientY, false);
    else if (!t) hidePopup(false);
  }
}
function onBoardLeave() { ui.hover = null; ui.edgeHover = null; ui.hoverTileId = null; ui.ghost = null; hidePopup(false); renderInfo(); }

// Commit the tile currently under the ghost. Shared by click, the on-screen
// Build button and the second tap of a touch placement.
function commitPlacement() {
  if (ui.mode !== 'place' || !ui.card) return;
  if (!ui.ghost) { hint('Pick a spot on the board first'); return; }
  if (!ui.ghost.ok) { hint(ui.ghost.reason); return; }
  const r = G.buyTile(state, ui.card, ui.ghost.x, ui.ghost.y, ui.rot);
  if (!r.ok) { hint(r.reason); return; }
  ui.selectedTileId = r.tile.id; cancelMode(); renderAll();
}

function onBoardTap(cell, edge, e) {
  if (ui.mode === 'playback') return;
  if (ui.mode === 'confirm') { hint('Play it or cancel first'); return; }
  // Touch has no hover, so the first tap aims the ghost and the second builds.
  const twoStage = e.pointerType === 'touch';
  if (ui.mode === 'place' && ui.card) {
    if (!cell) return;
    const aimed = ui.hover && ui.hover.x === cell.x && ui.hover.y === cell.y && ui.ghost;
    ui.hover = cell; ui.edgeHover = null;
    updateGhost();
    if (twoStage && !aimed) { hint(ui.ghost && ui.ghost.ok ? 'Tap again, or press Build, to put it here' : (ui.ghost ? ui.ghost.reason : '')); return; }
    commitPlacement();
    return;
  }
  if (ui.mode === 'target' && ui.card) {
    if (ui.card.target === 'edge') {
      if (!edge) { hint('Tap one of the strips around the edge of the board'); return; }
      const card = ui.card;
      const play = () => { const r = G.playCard(state, card, { edge }); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); };
      // Rezoning demolishes every transport attached to the edge, so say which first.
      const doomed = card.key === 'rezoning' && state.board.edges[edge] !== 'green' ? G.rezoningVictims(state, edge) : [];
      if (!doomed.length) { play(); return; }
      openModal(
        h('h2', {}, `Rezone the ${EDGE_NAMES[edge]} edge?`),
        h('p', {}, `The ${EDGE_NAMES[edge]} edge goes back to open ground, and ${doomed.length === 1 ? 'the transport attached to it is' : `all ${doomed.length} transports attached to it are`} torn down. You get no money back:`),
        h('ul', {}, ...doomed.map(t => h('li', {}, `${t.name}${t.level > 1 ? ' L' + t.level : ''}`))),
        h('div', { class: 'btnrow', style: 'justify-content:center' },
          h('button', { onclick: closeModal }, 'Keep it'),
          h('button', { id: 'btn-rezone-confirm', class: 'danger', onclick: () => { closeModal(); play(); } }, 'Rezone and tear down')));
      return;
    }
    const t = cell ? tileAtCell(cell.x, cell.y) : null;
    if (!t || !targetFilter(t)) { hint('Pick one of the highlighted tiles'); return; }
    const r = ui.card.type === 'card' ? G.playCard(state, ui.card, { tileId: t.id }) : G.upgradeTile(state, ui.card, t.id);
    if (!r.ok) hint(r.reason);
    ui.selectedTileId = t.id; cancelMode(); renderAll(); return;
  }
  const t = cell ? tileAtCell(cell.x, cell.y) : null;
  ui.hoverTileId = t ? t.id : null;
  ui.selectedTileId = t ? t.id : null;
  if (t) showPopup(tileDetails(t, true), e.clientX, e.clientY, true); else hidePopup(true);
  renderInfo();
}

function onKey(e) {
  if (e.target.closest && e.target.closest('input, select, textarea')) return; // typing a seed is not a shortcut
  if (e.key === 'm' || e.key === 'M') toggleMusic();
  if (e.key === 'Escape') { hidePopup(true); if (holdingCard()) cancelMode(); else { ui.selectedTileId = null; renderInfo(); } }
  if ((e.key === 'r' || e.key === 'R') && ui.mode === 'place') { rotate(1); }
  if (e.key === ' ' && ui.mode === 'playback') { e.preventDefault(); ui.pb.playing = !ui.pb.playing; }
  if (!boardInput) return;
  if (e.key === '+' || e.key === '=') boardInput.zoomBy(1.35);
  if (e.key === '-' || e.key === '_') boardInput.zoomBy(1 / 1.35);
  if (e.key === '0') boardInput.fit();
}
function rotate(dir) { if (!ui.card) return; const n = orientationCount(tileDef(ui.card.key).shape); ui.rot = (ui.rot + dir + n) % n; updateGhost(); }

// ------------------------------------------------------------ playback
// Running the week is the one irreversible click of the turn, so it always asks.
function confirmRunWeek() {
  if (!state || state.phase !== 'shop' || ui.mode === 'playback') return;
  const left = state.ap;
  // Nothing left to spend means nothing left to reconsider, so just go.
  if (left <= 0) { startWeek(); return; }
  openModal(
    h('h2', {}, 'Run the week?'),
    h('p', {}, `You still have ${left} action point${left === 1 ? '' : 's'} left to spend. The travellers arrive the moment you say go.`),
    h('p', { class: 'accent' }, `Starting early pays +$${fmt(G.earlyFinishBonus(state))} — $${fmt(G.earlyFinishPerAP(state))} for each action point you did not use.`),
    h('div', { class: 'row', style: 'justify-content:center;margin:10px 0' }, 'You need ', starNum(G.quotaStars(state)), ' this week'),
    h('div', { class: 'btnrow', style: 'justify-content:center' },
      h('button', { onclick: closeModal }, 'Not yet'),
      h('button', { id: 'btn-run-confirm', class: 'primary', onclick: () => { closeModal(); startWeek(); } }, 'Run Week ▶')));
}

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
  renderQuotaStars();   // Skip jumps straight here, so light the final stars
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
      renderQuotaStars();
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
      starBadge: starBadge(),
      result: (ui.mode === 'playback' || ui.heat) ? (ui.pb.result || state.lastResult) : null,
      T: ui.mode === 'playback' ? ui.pb.T : null, heat: ui.heat, closedTiles: closed,
      targetMode: ui.mode === 'target' && ui.card && ui.card.target !== 'edge' ? targetFilter : null,
      // pointing at an underground tile lifts the tunnel layer into view
      showUnderground: ui.mode !== 'playback' && !!((selected && selected.tunnel) || (hover && hover.tunnel)),
      // aiming a Rezoning Permit at an edge outlines what it would demolish
      dangerTiles: ui.mode === 'target' && ui.card && ui.card.key === 'rezoning' && ui.edgeHover && state.board.edges[ui.edgeHover] !== 'green' ? G.rezoningVictims(state, ui.edgeHover) : null,
    });
  }
  requestAnimationFrame(frame);
}

// What the pending action is worth, floated over the tile it would affect.
// Estimates are a spread across a few seeds; the badge shows their midpoint as
// a single star count so there is one number to read, not a range.
const estStars = e => e ? starsOf(e.pts) : null;
function starBadge() {
  if (state.phase !== 'shop' || !ui.card) return null;
  if (ui.mode === 'place') {
    if (!ui.ghost) return null;
    const cells = ui.ghost.cells.filter(([x, y]) => x >= 0 && y >= 0 && x < state.board.w && y < state.board.h);
    const z = ui.ghost.def ? renderer.heightOf(ui.card.key) : 0;
    if (!ui.ghost.ok) return { cells, z, reason: ui.ghost.reason };
    const warnings = ui.ghost.claims.map(c => c.lock ? `Locks the whole ${EDGE_NAMES[c.edge]} edge to ${c.terrain}, for good` : `Claims the ${EDGE_NAMES[c.edge]} edge as ${c.terrain}`);
    // sealing a platform in loses everyone bound for it, so say so before the stars do
    for (const t of cutOffTransports(state.board, cells, ui.ghost.def)) warnings.push(`Walls in ${t.name}: nobody heading there can reach it`);
    return { cells, z, stars: estStars(ui.estimate), warnings };
  }
  // upgrade cards: the same badge over whichever owned tile is hovered
  if (ui.mode === 'target' && upgradeLevels(ui.card) != null) {
    const t = tileById(ui.hoverTileId);
    if (!t || !targetFilter(t)) return null;
    return { cells: t.cells, z: renderer.heightOf(t.key), stars: estStars(ui.estimate) };
  }
  return null;
}
// How many levels a card would add to its target, or null if it is not an
// upgrade card. Named upgrades may also widen the tile's radius.
function upgradeLevels(card) {
  if (!card) return null;
  if (card.type === 'upgrade') return { levels: card.levels || 1, radiusBonus: card.radiusBonus || 0 };
  if (card.type === 'named_upgrade') {
    const nu = NAMED_UPGRADES[card.key];
    if (!nu || nu.target === 'waiting_all') return null;
    return { levels: nu.levels, radiusBonus: nu.radiusBonus || 0 };
  }
  return null;
}

// ------------------------------------------------------------ modals
// null children are optional parts left out (append would print them as "null")
function openModal(...children) { const box = $('modal-box'); box.className = ''; box.innerHTML = ''; box.append(...children.filter(c => c != null)); $('modal').classList.remove('hidden'); }
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
  for (let k = 3; k < 8; k++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, k); if (v < lo || v > hi) continue; const y = ly(v); g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillStyle = '#b8a8e8'; g.fillText(v >= 1000 ? (v / 1000) + 'k' : v, padL - 6, y); }
  // bars
  history.forEach((x, i) => {
    const cx = padL + slot * (i + 0.5), bw = Math.min(28, slot * 0.6);
    const y = ly(x.score), base = H - padB;
    g.fillStyle = x.passed ? 'rgba(77,255,110,0.85)' : 'rgba(255,79,122,0.85)';
    g.fillRect(cx - bw / 2, y, bw, base - y);
    g.fillStyle = '#b8a8e8'; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(x.week % G.runRules(state).eventEvery === 0 ? x.week + '⚡' : x.week, cx, base + 4);
  });
  // quota line
  g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.beginPath();
  history.forEach((x, i) => { const cx = padL + slot * (i + 0.5); const y = ly(x.quota); if (i === 0) g.moveTo(cx, y); else g.lineTo(cx, y); });
  g.stroke();
  history.forEach((x, i) => { const cx = padL + slot * (i + 0.5); g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(cx, ly(x.quota), 3, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = '#ffd23f'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '600 11px system-ui, sans-serif';
  g.fillText('quota', padL + 4, padT + 2);
}

function showSummary() {
  const r = ui.pb.result; const quota = G.quotaFor(state);
  const passed = r.score >= quota;
  const grace = !passed && state.week <= G.runRules(state).graceWeeks;
  const history = state.history.concat([{ week: state.week, score: r.score, quota, passed, money: r.money.total }]);
  const rows = Object.values(r.tileStats).sort((a, b) => b.points - a.points);
  const table = h('table', { class: 'stats' }, h('tr', {}, ...['Tile', 'Served', 'Turned away', 'Full', 'Earned', 'Points', 'Arrived', 'Boarded', 'Out of time'].map(x => h('th', {}, x))));
  for (const s of rows) {
    const t = tileById(s.id);
    table.append(h('tr', {}, h('td', {}, `${s.name}${t && t.level > 1 ? ' L' + t.level : ''}`), h('td', {}, s.kind === 'amenity' ? s.serves : '–'), h('td', {}, s.kind === 'amenity' ? s.balks : '–'), h('td', {}, s.cap ? (s.saturation * 100).toFixed(0) + '%' : '–'), h('td', {}, '$' + fmt(s.revenue)), h('td', {}, fmt(s.points)), h('td', {}, s.kind === 'transport' ? s.spawned : '–'), h('td', {}, s.kind === 'transport' ? s.boarded : '–'), h('td', {}, s.kind === 'transport' ? s.stranded : '–')));
  }
  const chart = h('canvas', { id: 'chart' });
  const stranded = r.counts.stranded ? ` · ${r.counts.stranded} ran out of time` : '';
  // Lost travellers never found a route to the platform they wanted, so they
  // banked nothing at all - worth calling out separately from stranding.
  const lost = r.counts.lost ? ` · ${r.counts.lost} never reached their platform` : '';
  const stolen = r.points.stolen ? ` · ${fmtK(r.points.stolen)} stolen by ${r.counts.pickpockets} pickpockets` : '';
  const early = state.earlyBonus ? ` · +$${fmt(state.earlyBonus)} for starting early, already paid` : '';
  openModal(
    h('h2', {}, `Week ${state.week}`, G.currentEvent(state) ? h('span', { class: 'event-tag accent', style: 'margin-left:8px' }, G.currentEvent(state).name) : null),
    h('div', { class: 'row summary-stars' }, starStrip(G.quotaStars(state), Math.max(0, starsOf(r.score))),
      h('span', { class: passed ? 'good' : grace ? 'accent' : 'bad' }, passed ? '✓ quota met' : grace ? '✗ quota missed — the first week is a practice run, so you carry on' : '✗ quota missed — the run ends here'), h('span', { class: 'spacer' }), h('span', { class: 'accent' }, `+$${fmt(r.money.total)}`)),
    h('div', { style: 'font-size:12px;color:var(--muted);margin:2px 0 8px' }, `${fmt(r.score)} points of ${fmt(quota)} · ${r.counts.boarded} boarded${stranded}${lost}${stolen}${early}`),
    chart,
    h('details', {}, h('summary', {}, 'Tile by tile'), h('div', { style: 'max-height:240px;overflow:auto' }, table)),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); ui.heat = true; ui.mode = 'heat'; $('board-hint').innerHTML = ''; showHeatBar(); } }, 'Where did people walk?'), h('button', { class: 'primary', onclick: continueFromSummary }, passed || grace ? 'Continue →' : 'See results')));
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
  if (!r.passed) { clearRun(); playTrack(null); showGameOver(); ui.mode = 'over'; renderAll(); return; }
  ui.mode = 'idle';
  if (state.phase === 'won') { showWin(); return; }
  afterWeekStart();
}
// Music plays through the run; the start screen and a lost run are silent.
function syncMusic() { playTrack('main'); }
function syncMusicButton() {
  const b = $('btn-music');
  b.classList.toggle('off', isMuted());
  b.title = isMuted() ? 'Music off (M)' : 'Music on (M)';
  b.setAttribute('aria-pressed', String(!isMuted()));
}
function toggleMusic() { setMuted(!isMuted()); syncMusicButton(); }

function afterWeekStart() {
  renderer.resize(state.board);
  renderAll();
  syncMusic();
  // Week-start popups, one after another: the ordinance choice, then this
  // week's event or milestone.
  const popups = [];
  if (state.pendingOrdinance) popups.push(showOrdinance);
  if (G.isEventWeek(state) && ui.eventShownWeek !== state.week) { ui.eventShownWeek = state.week; popups.push(showEventModal); }
  if (G.milestoneForWeek(state, state.week) && ui.milestoneShownWeek !== state.week) { ui.milestoneShownWeek = state.week; popups.push(showMilestoneModal); }
  const next = () => { const show = popups.shift(); if (show) show(next); };
  next();
}
// Milestones change the shape of the run (pickpockets, rare stock, Extra
// Shift), so they get the same fanfare as an event, in cyan.
function showMilestoneModal(onDone) {
  const ms = G.milestoneForWeek(state, state.week);
  if (!ms) { if (onDone) onDone(); return; }
  openModal(
    h('div', {}, h('span', { class: 'boss-star' }, '✦')),
    h('div', { class: 'lbl' }, `Week ${state.week} · milestone`),
    h('h2', {}, ms.name),
    h('p', {}, ms.desc),
    h('div', { class: 'btnrow', style: 'justify-content:center' }, h('button', { class: 'primary', onclick: () => { closeModal(); if (onDone) onDone(); } }, 'Got it')));
  $('modal-box').classList.add('event', 'milestone');
}
function showEventModal(onDone) {
  const ev = G.currentEvent(state);
  if (!ev) { if (onDone) onDone(); return; }
  const box = $('modal-box');
  const parts = [
    h('div', {}, h('span', { class: 'boss-star' }, '★')),
    h('div', { class: 'lbl' }, `Week ${state.week} · event week`),
    h('h2', {}, ev.name),
    h('div', { class: 'event-mult' }, `Quota ×${G.fmtMult(G.eventMult(ev))} → ${fmt(G.quotaStars(state))}★`),
    h('p', {}, ev.desc),
  ];
  if (ev.mods.strike) {
    const terrains = G.transportTerrainsOnBoard(state);
    const sel = h('select', { onchange: e => { G.setStrike(state, e.target.value); persist(); scheduleProjection(); renderSide(); } });
    for (const t of terrains) sel.append(h('option', { value: t }, TERRAIN_INFO[t].label));
    if (terrains.length && !state.strikeChoice) G.setStrike(state, terrains[0]);
    parts.push(h('div', { class: 'row', style: 'justify-content:center' }, 'Which transport walks out? ', sel));
    if (terrains.length <= 1) parts.push(h('div', { class: 'warn' }, `It is your only transport, so it keeps running at ${Math.round(CONFIG.sim.strikeSkeletonBatch * 100)}% rather than stopping outright.`));
  }
  parts.push(h('div', { class: 'btnrow', style: 'justify-content:center' }, h('button', { class: 'primary', onclick: () => { closeModal(); box.classList.remove('event'); if (onDone) onDone(); } }, 'Bring it on')));
  openModal(...parts);
  box.classList.add('event');
}
function showOrdinance(onDone) {
  openModal(h('h2', {}, `Week ${state.week}: pick an ordinance`), h('p', {}, 'Whichever you pick stays for the rest of the run.'),
    h('div', { class: 'choices' }, ...state.pendingOrdinance.map(k => h('div', { class: 'mode', onclick: () => { G.chooseOrdinance(state, k); closeModal(); renderAll(); if (onDone) onDone(); } }, h('div', { class: 'name' }, ORDINANCES[k].name), h('div', { class: 'desc' }, ORDINANCES[k].desc)))));
}
function showWin() {
  openModal(h('h2', { class: 'good' }, 'Grand Central Station is a success!'), h('p', {}, `You cleared week ${G.runRules(state).winWeek}. The quota keeps climbing from here — how far can you get?`),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); showStart(); } }, 'New run'), h('button', { class: 'primary', onclick: () => { G.continueAfterWin(state); closeModal(); afterWeekStart(); } }, 'Keep going →')));
}
function showGameOver() {
  const last = state.history[state.history.length - 1];
  openModal(h('h2', { class: 'bad' }, 'The run is over'), h('p', {}, `Week ${last.week}: you earned ${fmt(starsOf(last.score))}★ and needed ${fmt(starTarget(last.quota))}★.`),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Best week score'), h('span', {}, fmt(state.records.bestScore)), h('span', { class: 'k' }, 'Best traveller'), h('span', {}, fmt(state.records.bestTraveller)), h('span', { class: 'k' }, 'Seed'), h('span', {}, state.seed)),
    h('div', { class: 'btnrow' }, h('button', { onclick: () => { closeModal(); ui.mode = 'over'; } }, 'Look at the board'), h('button', { class: 'primary', onclick: () => { closeModal(); showStart(); } }, 'New run')));
}

function showStart() {
  playTrack(null);
  let saved = loadRun();
  // saves are not migrated: one from an older build is reported and dropped
  const stale = !!saved && !G.saveIsCurrent(saved);
  if (stale) { clearRun(); saved = null; }
  const seedInput = h('input', { type: 'text', placeholder: 'seed (optional)', style: 'font:inherit;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px;width:160px' });
  // Difficulty is a second axis on top of the mode, so the records shown under
  // each mode are the ones for the difficulty currently selected.
  let diffKey = meta.lastDiff && DIFFICULTIES[meta.lastDiff] ? meta.lastDiff : 'standard';
  const diffs = h('div', { class: 'diffs' });
  const modes = h('div', { class: 'modes' });
  function paintModes() {
    modes.innerHTML = '';
    for (const k of MODE_KEYS) {
      const m = MODES[k];
      const unlocked = meta.bestWeek >= m.unlockWeek;
      const rec = meta.byMode[k + ':' + diffKey];
      modes.append(h('div', { class: 'mode' + (unlocked ? '' : ' locked'), onclick: unlocked ? () => newRun(k, diffKey, seedInput.value.trim()) : null },
        h('div', { class: 'name' }, m.name, unlocked ? '' : ` \u{1F512} reach week ${m.unlockWeek} to unlock`), h('div', { class: 'desc' }, m.desc), rec ? h('div', { class: 'desc', style: 'margin-top:4px' }, `Best on ${DIFFICULTIES[diffKey].name}: week ${rec.bestWeek}, ${fmt(rec.bestScore)} pts`) : null));
    }
  }
  function paintDiffs() {
    diffs.innerHTML = '';
    for (const k of DIFFICULTY_KEYS) {
      const d = DIFFICULTIES[k];
      diffs.append(h('div', { class: 'diff' + (k === diffKey ? ' on' : ''), onclick: () => { diffKey = k; meta.lastDiff = k; saveMeta(meta); paintDiffs(); paintModes(); } },
        h('div', { class: 'name' }, d.name), h('div', { class: 'desc' }, d.desc)));
    }
  }
  paintDiffs(); paintModes();
  openModal(h('h2', {}, h('span', { class: 'logo' }, 'GCS'), ' Grand Central Station'),
    h('p', {}, 'You run a transit hub. Each week you add a few tiles, then watch the crowd wander through. Hit the week\'s quota or the run ends.'),
    stale ? h('p', { class: 'warn' }, 'Your saved run comes from an older version of the game, so it cannot be picked up again. Start a new run below.') : null,
    saved ? h('div', { class: 'btnrow', style: 'justify-content:flex-start' }, h('button', { class: 'primary', onclick: () => { state = G.deserialize(saved); ui.started = true; closeModal(); ui.mode = 'idle'; afterWeekStart(); } }, 'Resume saved run')) : null,
    h('h3', {}, 'Pick a difficulty'), diffs,
    h('h3', {}, 'Pick a mode'), modes,
    h('div', { class: 'row', style: 'margin-top:12px' }, seedInput, h('span', { style: 'font-size:12px;color:var(--muted)' }, `Records: week ${meta.bestWeek} · best week ${fmt(meta.bestScore)} pts · best traveller ${fmt(meta.bestTraveller)}`)));
}
function newRun(modeKey, diffKey, seedText) {
  const seed = seedText ? (isNaN(Number(seedText)) ? seedText : Number(seedText)) : null;
  state = G.createRun({ modeKey, diffKey, seed });
  ui.started = true;
  closeModal(); ui.mode = 'idle'; ui.selectedTileId = null; ui.heat = false; ui.pb.result = null;
  renderer.resize(state.board); renderer.fit(); // a new run always starts framed
  afterWeekStart();
}
function showMenu() {
  openModal(h('h2', {}, 'Menu'),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Mode'), h('span', {}, MODES[state.modeKey].name), h('span', { class: 'k' }, 'Difficulty'), h('span', {}, G.difficultyOf(state).name), h('span', { class: 'k' }, 'Seed'), h('span', {}, state.seed), h('span', { class: 'k' }, 'Week'), h('span', {}, state.week)),
    h('h3', {}, 'History'), h('table', { class: 'stats' }, h('tr', {}, h('th', {}, 'Week'), h('th', {}, 'Stars'), h('th', {}, 'Needed'), h('th', {}, 'Money'), h('th', {}, 'Event')), ...state.history.map(x => h('tr', {}, h('td', {}, x.week), h('td', { class: x.passed ? 'good' : 'bad', title: fmt(x.score) + ' points' }, `${fmt(starsOf(x.score))}★`), h('td', {}, `${fmt(starTarget(x.quota))}★`), h('td', {}, '+$' + fmt(x.money)), h('td', {}, x.event || '')))),
    h('div', { class: 'btnrow' }, h('button', { class: 'danger', onclick: () => { clearRun(); closeModal(); showStart(); } }, 'Abandon run'), h('button', { class: 'primary', onclick: closeModal }, 'Back')));
}

// ------------------------------------------------------------ boot
function boot() {
  const c = renderer.canvas;
  // Drag pans, pinch/wheel zooms, tap picks. Shift+wheel keeps the old
  // scroll-to-rotate shortcut now that the wheel drives the camera.
  boardInput = attachBoardInput(c, renderer, {
    hover: onBoardHover,
    leave: onBoardLeave,
    tap: onBoardTap,
    wheel: e => { if (ui.mode === 'place' && (e.shiftKey || e.altKey)) { rotate(e.deltaY > 0 ? 1 : -1); return true; } return false; },
    camera: () => { hidePopup(false); },
  });
  c.addEventListener('contextmenu', e => { e.preventDefault(); if (ui.mode === 'place') rotate(1); else cancelMode(); });
  window.addEventListener('keydown', onKey);
  let resizeTimer = null;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state) renderer.resize(state.board); }, 60); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  $('btn-zoom-in').addEventListener('click', () => boardInput.zoomBy(1.35));
  $('btn-zoom-out').addEventListener('click', () => boardInput.zoomBy(1 / 1.35));
  $('btn-zoom-fit').addEventListener('click', () => boardInput.fit());
  $('btn-rotate').addEventListener('click', () => rotate(1));
  $('btn-place').addEventListener('click', () => { if (ui.mode === 'confirm') playSelected(); else commitPlacement(); });
  $('btn-place-cancel').addEventListener('click', () => cancelMode());
  $('btn-card-info').addEventListener('click', () => { layout.cardInfoCollapsed = !layout.cardInfoCollapsed; saveLayout(); renderInfo(); });
  $('btn-run').addEventListener('click', confirmRunWeek);
  $('btn-reroll').addEventListener('click', () => { const r = G.reroll(state); if (!r.ok) hint(r.reason); cancelMode(); renderAll(); });
  $('btn-menu').addEventListener('click', () => { if (state) showMenu(); else showStart(); });
  const applyLayout = () => {
    $('main').classList.toggle('side-collapsed', !!layout.sideCollapsed);
    $('side-tab').classList.toggle('hidden', !layout.sideCollapsed);
    saveLayout();
    if (state) renderer.resize(state.board);
  };
  $('btn-run-big').addEventListener('click', confirmRunWeek);
  $('btn-side-toggle').addEventListener('click', () => { layout.sideCollapsed = true; applyLayout(); });
  $('side-tab').addEventListener('click', () => { layout.sideCollapsed = false; applyLayout(); });
  applyLayout();
  // The shop tray floats over the bottom of the board. Tell the camera how
  // much of the view it covers, so Fit frames the board above it and panning
  // can always bring whatever is underneath into view.
  const tray = $('shop');
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--tray-h', tray.offsetHeight + 'px');
    renderer.setInsets({ bottom: tray.offsetHeight });
    if (state) renderer.resize(state.board);
  }).observe(tray);
  $('btn-music').addEventListener('click', toggleMusic);
  syncMusicButton();
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
