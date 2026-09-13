import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
// UI smoke test. Requires: npm i playwright && npx playwright install chromium
// (or PW_CHROME=/path/to/chrome to use one that is already installed)
// Usage: node harness/ui-smoke.mjs [screenshot-dir]
import { mkdirSync } from 'node:fs';
const SP = process.argv[2] || 'harness/screenshots';
mkdirSync(SP, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8791'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
// PW_CHROME points the test at a chromium already on the machine, for boxes
// where `npx playwright install` cannot fetch the build Playwright wants.
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const results = [];
const check = (name, cond, extra = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'}: ${name} ${extra}`); };
// Run Week now asks for confirmation first.
const runWeekUI = async (page) => {
  await page.locator('#btn-run').click(); await page.waitForTimeout(150);
  // the confirmation only appears while action points are unspent
  if (await page.locator('#btn-run-confirm').count()) await page.locator('#btn-run-confirm').click();
  await page.waitForTimeout(200);
};
const cellPx = async (x, y) => page.evaluate(([x, y]) => { const r = window.gcs.renderer; const b = r.canvas.getBoundingClientRect(); const [px, py] = r.cellCenterPx(x, y); return [b.left + px, b.top + py]; }, [x, y]);
const edgePx = async (e) => page.evaluate((e) => { const r = window.gcs.renderer; const b = r.canvas.getBoundingClientRect(); const [px, py] = r.edgeCenterPx(e); return [b.left + px, b.top + py]; }, e);
// auto-play weeks through the API (greedy-lite) up to a target week. For each
// action it takes the best (card, spot) pair it can afford, scored with the same
// estimate the player sees on hover over a sample of legal spots. Both halves
// matter: the first legal cell is usually a corner, and buying by kind instead
// of by estimate loses week 1 outright (0.96x quota on the pinned seed, against
// 1.41x for the pair it picks now).
const fastForward = async (toWeek) => page.evaluate((toWeek) => {
  const { G } = window.gcs; let s = window.gcs.state;
  while (s.week < toWeek) {
    if (s.pendingOrdinance) G.chooseOrdinance(s, s.pendingOrdinance[0]);
    if (s.phase === 'won') G.continueAfterWin(s);
    let guard = 0;
    while (s.ap > 0 && guard++ < 10) {
      let best = null;
      for (const card of s.shop.cards.filter(c => c.type === 'tile' && G.cardCost(s, c) <= s.money)) {
        const spots = [];
        for (let y = 0; y < s.board.h; y++) for (let x = 0; x < s.board.w; x++) for (let r = 0; r < 4; r++) if (G.placementCheck(s, card.key, x, y, r).ok) spots.push({ x, y, r });
        if (!spots.length) continue;
        for (let i = 0; i < spots.length; i += Math.max(1, Math.floor(spots.length / 12))) {
          const e = G.estimatePlacement(s, card.key, spots[i].x, spots[i].y, spots[i].r, 2);
          if (e && (!best || e.pts > best.pts)) best = { card, ...spots[i], pts: e.pts };
        }
      }
      if (!best) break;
      if (!G.buyTile(s, best.card, best.x, best.y, best.r).ok) break;
    }
    G.runWeek(s); const st = G.settle(s);
    if (!st.passed) return { died: s.week };
  }
  window.gcs.refresh();
  return { week: s.week, tiles: s.board.tiles.length, money: s.money, pending: s.pendingOrdinance };
}, toWeek);
try {
  await page.goto('http://localhost:8791/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.locator('#modal-box input').fill('7');
  // the difficulty picker sits above the modes; Hard then back to Standard, so
  // the run below is the baseline one every later check assumes
  await page.locator('.diff', { hasText: 'Hard' }).first().click();
  await page.waitForTimeout(100);
  check('picking a difficulty selects it', await page.locator('.diff.on .name').first().innerText() === 'Hard', await page.locator('.diff.on .name').first().innerText());
  await page.locator('.diff', { hasText: 'Standard' }).first().click();
  await page.waitForTimeout(100);
  await page.locator('.mode', { hasText: 'Terminal' }).first().click();
  await page.waitForTimeout(300);
  check('the run records its difficulty', await page.evaluate(() => window.gcs.state.diffKey) === 'standard', await page.evaluate(() => window.gcs.state.diffKey));
  const cards1 = await page.locator('.card .name').allTextContents();
  check('week-1 shop has no upgrade token or bridge', !cards1.includes('Upgrade Token') && !cards1.some(c => c.includes('Bridge')), cards1.join(','));
  // Redo Week: Standard only, offered from the first move of the week, and it
  // puts the board, the cash and the action points back where they started.
  const weekState = () => page.evaluate(() => { const s = window.gcs.state; return { money: s.money, ap: s.ap, tiles: s.board.tiles.length, cards: s.shop.cards.length }; });
  const buyOne = () => page.evaluate(() => {
    const s = window.gcs.state, G = window.gcs.G;
    const card = s.shop.cards.find(c => c.type === 'tile' && G.cardCost(s, c) <= s.money);
    if (!card) return false;
    for (let y = 0; y < s.board.h; y++) for (let x = 0; x < s.board.w; x++) for (let r = 0; r < 4; r++)
      if (G.placementCheck(s, card.key, x, y, r).ok && G.buyTile(s, card, x, y, r).ok) { window.gcs.refresh(); return true; }
    return false;
  });
  const week1 = await weekState();
  check('no redo offered before the first move of the week', await page.locator('#tl-redo').count() === 0);
  await buyOne(); await page.waitForTimeout(120);
  check('redo appears under the timeline on the first move', await page.locator('#tl-redo button').count() === 1);
  check('but not over the board while there are points left', await page.locator('#run-stack:not(.hidden)').count() === 0);
  while ((await weekState()).ap > 0 && await buyOne()) await page.waitForTimeout(60);
  await page.waitForTimeout(150);
  const spent = await weekState();
  check('spending the last point puts Run Week on the board', await page.locator('#run-stack:not(.hidden)').count() === 1, JSON.stringify(spent));
  check('with Redo Week under it', await page.locator('#btn-redo-big:not(.hidden)').count() === 1);
  await page.locator('#btn-redo-big').click(); await page.waitForTimeout(150);
  await page.locator('#btn-redo-confirm').click(); await page.waitForTimeout(250);
  const back = await weekState();
  check('redo puts the week back exactly as it started', JSON.stringify(back) === JSON.stringify(week1), `${JSON.stringify(spent)} -> ${JSON.stringify(back)} (was ${JSON.stringify(week1)})`);
  check('and takes its own buttons away again', await page.locator('#tl-redo').count() === 0 && await page.locator('#btn-redo-big:not(.hidden)').count() === 0);
  check('Hard never offers it', await page.evaluate(() => {
    const G = window.gcs.G, h = G.createRun({ modeKey: 'terminal', diffKey: 'hard', seed: 1 });
    return !h.weekStart && !G.weekTouched(h) && !G.redoWeek(h).ok;
  }));
  // isometric camera: round-trip a few cells, then zoom/pan and round-trip again
  const roundTrip = () => page.evaluate(() => {
    const r = window.gcs.renderer; const bad = [];
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const [px, py] = r.cellCenterPx(x, y);
      const c = r.cellAt(px, py);
      if (!c || c.x !== x || c.y !== y) bad.push(`${x},${y}->${c ? c.x + ',' + c.y : 'null'}`);
    }
    for (const e of ['N', 'E', 'S', 'W']) { const [px, py] = r.edgeCenterPx(e); if (r.edgeAt(px, py) !== e) bad.push('edge ' + e); }
    return bad;
  });
  check('iso hit-testing round-trips at fit zoom', (await roundTrip()).length === 0, (await roundTrip()).slice(0, 4).join(' '));
  const cam = await page.evaluate(() => {
    const r = window.gcs.renderer; const z0 = r.zoom;
    r.zoomAt(2.2, r.viewW * 0.35, r.viewH * 0.6); r.panBy(-40, 25);
    return { z0, z1: r.zoom, pan: [Math.round(r.panX), Math.round(r.panY)] };
  });
  check('zoom + pan change the camera', cam.z1 > cam.z0 * 1.5, JSON.stringify(cam));
  check('iso hit-testing round-trips while zoomed and panned', (await roundTrip()).length === 0, (await roundTrip()).slice(0, 4).join(' '));
  await page.evaluate(() => window.gcs.renderer.fit());
  await page.waitForTimeout(100);
  // fast forward to week 5 (ordinance week)
  let ff = await fastForward(5);
  check('fast-forward to week 5', ff.week === 5, JSON.stringify(ff));
  await page.evaluate(() => window.gcs.afterWeekStart());
  await page.waitForTimeout(300);
  const ordText = await page.locator('#modal-box h2').innerText().catch(() => '');
  check('ordinance modal at week 5', ordText.includes('ordinance'), ordText);
  await page.locator('#modal .mode').first().click();
  await page.waitForTimeout(200);
  check('ordinance chosen', (await page.locator('#rules-body').innerText()).length > 20, await page.locator('#rules-body').innerText());
  await page.screenshot({ path: SP + '/shot6_week5.png' });
  // Upgrade cards are bound to a tile type you own and carry their own name, so
  // find one by type and force it into the shop if this week's roll had none.
  const upCard = await page.evaluate(() => {
    const s = window.gcs.state, G = window.gcs.G;
    let c = s.shop.cards.find(c => c.type === 'upgrade');
    if (!c) {
      const keys = G.upgradableKeys(s);
      if (!keys.length) return null;
      s.shop.cards = G.generateShop(s);
      c = s.shop.cards.find(c => c.type === 'upgrade');
      if (!c) { s.money += 2000; s.shop.rerolls = 0;
        for (let i = 0; i < 40 && !c; i++) { s.shop.rerolls = i; s.shop.cards = G.generateShop(s); c = s.shop.cards.find(c => c.type === 'upgrade'); } }
      window.gcs.refresh();
    }
    if (!c) return null;
    const t = G.upgradeTargets(s, c)[0];
    return { idx: s.shop.cards.indexOf(c), name: c.name, tileName: c.tileName, key: c.key, levels: c.levels,
             tileId: t.id, x: t.cells[0][0], y: t.cells[0][1], level: t.level };
  });
  check('a tile-specific upgrade is offered by week 5', !!upCard, upCard ? `${upCard.name} (${upCard.tileName})` : 'none');
  if (upCard) {
    check('upgrade card is named for its tile, not generic', upCard.name !== 'Upgrade Token' && !!upCard.tileName, upCard.name);
    await page.evaluate(() => { window.gcs.state.money += 2000; window.gcs.refresh(); });
    await page.locator('.card').nth(upCard.idx).click();
    await page.waitForTimeout(150);
    const infoT = await page.locator('#card-bar-title').innerText();
    check('target mode prompt names the card', infoT.toLowerCase().includes(upCard.name.toLowerCase()), infoT);
    check('the card bar carries the card text', (await page.locator('#card-bar-desc').innerText()).length > 40, await page.locator('#card-bar-desc').innerText());
    // an upgrade card must refuse a tile of the wrong type
    const wrong = await page.evaluate((key) => { const s = window.gcs.state; const t = s.board.tiles.find(t => t.key !== key && t.kind !== 'bridge'); return t ? { x: t.cells[0][0], y: t.cells[0][1], id: t.id, level: t.level } : null; }, upCard.key);
    if (wrong) {
      const [wx, wy] = await cellPx(wrong.x, wrong.y);
      await page.mouse.click(wx, wy); await page.waitForTimeout(150);
      const stillL = await page.evaluate((id) => window.gcs.state.board.tiles.find(t => t.id === id).level, wrong.id);
      check('upgrade card refuses the wrong tile type', stillL === wrong.level, `level ${wrong.level} -> ${stillL}`);
    }
    const [px, py] = await cellPx(upCard.x, upCard.y);
    await page.mouse.click(px, py);
    await page.waitForTimeout(200);
    const after = await page.evaluate((id) => window.gcs.state.board.tiles.find(t => t.id === id).level, upCard.tileId);
    check('tile upgraded via click', after === Math.min(5, upCard.level + upCard.levels), `level ${upCard.level} -> ${after} (card grants ${upCard.levels})`);
  }
  // a bonus card that needs no target waits for its Play it button
  await page.evaluate(() => { const s = window.gcs.state; s.money += 500; s.ap = 2;
    s.shop.cards.push({ id: 'test-ot', slot: 4, type: 'card', key: 'overtime', name: 'Overtime', cost: 40, desc: 'Two extra action points, this week only.', target: 'none' });
    window.gcs.refresh(); });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({ money: window.gcs.state.money, ap: window.gcs.state.ap }));
  await page.locator('.card', { hasText: 'Overtime' }).click();
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => ({ money: window.gcs.state.money, ap: window.gcs.state.ap, mode: window.gcs.ui.mode }));
  check('picking a bonus card spends nothing yet', held.money === before.money && held.ap === before.ap && held.mode === 'confirm', JSON.stringify(held));
  check('the bonus card shows its text in the bar', (await page.locator('#card-bar-desc').innerText()).includes('action point'), await page.locator('#card-bar-desc').innerText());
  await page.locator('#btn-place').click(); await page.waitForTimeout(200);
  const played = await page.evaluate(() => ({ money: window.gcs.state.money, ap: window.gcs.state.ap }));
  check('Play it spends the card', played.money === before.money - 40 && played.ap === before.ap + 1, `${JSON.stringify(before)} -> ${JSON.stringify(played)}`);
  // rezoning card on an edge
  await page.evaluate(() => { const s = window.gcs.state; s.money += 500; s.ap = Math.max(s.ap, 2); const locked = Object.keys(s.board.edges).find(e => s.board.edges[e] !== 'green'); if (!locked) { s.board.edges.N = 'rail'; } s.shop.cards.push({ id: 'test-rez', slot: 4, type: 'card', key: 'rezoning', name: 'Rezoning Permit', cost: 120, desc: 'Unlock one locked edge back to greenfield.', target: 'edge' }); window.gcs.refresh(); });
  await page.waitForTimeout(150);
  const lockedEdge = await page.evaluate(() => Object.keys(window.gcs.state.board.edges).find(e => window.gcs.state.board.edges[e] !== 'green'));
  await page.locator('.card', { hasText: 'Rezoning' }).click();
  await page.waitForTimeout(150);
  // rezoning demolishes transports, so snapshot the board and put it back after:
  // the fast-forward below needs the run to still be alive
  await page.evaluate(() => { window.__boardBeforeRezone = JSON.parse(JSON.stringify(window.gcs.state.board)); });
  const doomed = await page.evaluate((e) => window.gcs.G.rezoningVictims(window.gcs.state, e).length, lockedEdge);
  const [ex, ey] = await edgePx(lockedEdge);
  await page.mouse.click(ex, ey);
  await page.waitForTimeout(200);
  // a rezone that would demolish transports asks first
  const asked = await page.locator('#btn-rezone-confirm').count();
  check('rezoning warns before demolishing attached transports', doomed === 0 || asked === 1, `${doomed} attached, dialog ${asked ? 'shown' : 'missing'}`);
  if (asked) { await page.locator('#btn-rezone-confirm').click(); await page.waitForTimeout(200); }
  const edgeNow = await page.evaluate((e) => window.gcs.state.board.edges[e], lockedEdge);
  check('rezoning permit unlocks edge via edge click', edgeNow === 'green', `${lockedEdge}: ${edgeNow}`);
  const leftOn = await page.evaluate((e) => window.gcs.G.rezoningVictims(window.gcs.state, e).length, lockedEdge);
  check('rezoning demolishes the transports attached to the edge', leftOn === 0, `${doomed} before, ${leftOn} after`);
  await page.evaluate(() => { window.gcs.state.board = window.__boardBeforeRezone; window.gcs.refresh(); });
  // delete a tile via panel
  const delTile = await page.evaluate(() => { const s = window.gcs.state; s.ap = 2; const t = s.board.tiles[s.board.tiles.length - 1]; return { id: t.id, x: t.cells[0][0], y: t.cells[0][1], n: s.board.tiles.length }; });
  const [dx, dy] = await cellPx(delTile.x, delTile.y);
  await page.mouse.click(dx, dy); await page.waitForTimeout(150);
  await page.locator('#popup button.danger').click(); await page.waitForTimeout(150);
  const nTiles = await page.evaluate(() => window.gcs.state.board.tiles.length);
  check('delete via info panel', nTiles === delTile.n - 1, `${delTile.n} -> ${nTiles}`);
  // a drag pans the camera instead of selecting; a click still selects
  const beforePan = await page.evaluate(() => [window.gcs.renderer.panX, window.gcs.renderer.panY]);
  const cbox = await page.locator('#board').boundingBox();
  await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cbox.x + cbox.width / 2 - 60, cbox.y + cbox.height / 2 - 30, { steps: 6 });
  await page.mouse.up();
  const afterPan = await page.evaluate(() => [window.gcs.renderer.panX, window.gcs.renderer.panY]);
  check('drag pans the board', Math.abs(afterPan[0] - beforePan[0]) > 30, `${beforePan} -> ${afterPan}`);
  await page.evaluate(() => window.gcs.renderer.fit());
  await page.waitForTimeout(100);
  // save/resume: reload and resume (run is alive at week 5)
  const wk5 = await page.locator('#st-week').innerText();
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(400);
  const resume = page.locator('#modal button', { hasText: 'Resume' });
  check('resume button present after reload', (await resume.count()) === 1);
  if (await resume.count()) { await resume.click(); await page.waitForTimeout(300); check('resumed at same week', (await page.locator('#st-week').innerText()) === wk5, await page.locator('#st-week').innerText()); }
  // force a strike event at week 8 and check the select
  await page.evaluate(() => { window.gcs.state.eventPlan[1] = 'strike'; });
  ff = await fastForward(8);
  check('fast-forward to week 8', ff.week === 8, JSON.stringify(ff));
  await page.evaluate(() => window.gcs.afterWeekStart());
  await page.waitForTimeout(400);
  const evModal = await page.locator('#modal-box.event').count();
  check('event-week popup shown at week 8', evModal === 1);
  if (evModal) { await page.locator('#modal button.primary').click(); await page.waitForTimeout(200); }
  const hasSelect = await page.locator('#event-body select').count();
  check('strike select shown on strike week', hasSelect === 1);
  if (hasSelect) { const opts = await page.locator('#event-body select option').allTextContents(); await page.locator('#event-body select').selectOption({ index: opts.length - 1 }); await page.waitForTimeout(100); check('strike choice recorded', !!(await page.evaluate(() => window.gcs.state.strikeChoice)), opts.join(',')); }
  await page.screenshot({ path: SP + '/shot7_week8.png' });
  // run week 8 through the UI at 4x briefly, then skip
  await runWeekUI(page);
  await page.locator('#playback button[data-speed="4"]').click(); await page.waitForTimeout(1200);
  await page.screenshot({ path: SP + '/shot8_playback8.png' });
  if (!(await page.locator('#modal:not(.hidden)').count())) await page.locator('#playback button[data-speed="skip"]').click(); await page.waitForTimeout(400);
  const sumHead = (await page.locator('#modal-box').innerText()).split('\n').slice(0, 5).join(' / ');
  check('week 8 summary shown', sumHead.startsWith('Week 8'), sumHead);
  await page.screenshot({ path: SP + '/shot9_summary8.png' });
  await page.locator('#modal button.primary').click(); await page.waitForTimeout(300);
  const wk = await page.locator('#st-week').innerText();
  check('advanced to week 9 (or game over)', wk.startsWith('9') || (await page.locator('#modal:not(.hidden)').count()) > 0, wk);
  // fresh run for the win path: cheat to week 16 with a strong board
  await page.evaluate(() => { const s = window.gcs.state; if (s.phase === 'lost') { window.gcs.showStart(); } });
  await page.waitForTimeout(200);
  if (await page.locator('#modal .mode').count()) { await page.locator('#modal .mode', { hasText: 'Terminal' }).first().click(); await page.waitForTimeout(300); }
  await page.evaluate(() => { const s = window.gcs.state; window.gcs.G.chooseOrdinance; s.money = 99999; });
  ff = await fastForward(15);
  results.push(`info: cheat-money auto-play reached week ${ff.week || ff.died}`);
  await page.evaluate(() => { const s = window.gcs.state; s.phase = 'shop'; s.week = 16; s.ap = 3; s.pendingOrdinance = null; s.board.tiles.forEach(t => t.level = 5); window.gcs.refresh(); });
  await page.waitForTimeout(200);
  const proj = await page.locator('#st-proj').innerText();
  results.push(`info: week-16 projection with L5 board: ${proj} vs quota ${await page.locator('#st-quota').textContent()}`);
  // ten or fewer stars render as glyphs, more as a "7 / 13 ★" counter
  const starText = (await page.locator('#quota-stars').textContent()).trim();
  const starNodes = await page.locator('#quota-stars .star').count();
  check('quota shown as stars', starNodes > 0 || /\d+\s*★/.test(starText), `"${starText}" / ${starNodes} glyphs`);
  await runWeekUI(page);
  if (!(await page.locator('#modal:not(.hidden)').count())) await page.locator('#playback button[data-speed="skip"]').click(); await page.waitForTimeout(500);
  await page.screenshot({ path: SP + '/shot10_week16_summary.png' });
  await page.locator('#modal button.primary').click(); await page.waitForTimeout(300);
  const h2 = await page.locator('#modal-box h2').innerText().catch(() => '');
  check('week-16 result modal (win or game over)', h2.includes('success') || h2.includes('over'), h2);
  if (h2.includes('success')) {
    await page.locator('#modal button.primary').click(); await page.waitForTimeout(300);
    check('endless continues to week 17', (await page.locator('#st-week').innerText()).startsWith('17'), await page.locator('#st-week').innerText());
    await page.evaluate(() => { const s = window.gcs.state; if (s.pendingOrdinance) window.gcs.G.chooseOrdinance(s, s.pendingOrdinance[0]); s.week = 60; s.ap = 0; window.gcs.refresh(); });
    if (await page.locator('#modal:not(.hidden)').count()) { await page.locator('#modal .mode').first().click().catch(() => {}); await page.waitForTimeout(200); }
    await runWeekUI(page);
    if (!(await page.locator('#modal:not(.hidden)').count())) await page.locator('#playback button[data-speed="skip"]').click(); await page.waitForTimeout(400);
    await page.locator('#modal button.primary').click(); await page.waitForTimeout(300);
    const over = await page.locator('#modal-box h2').innerText().catch(() => '');
    check('game over modal', over.includes('over'), over);
  }
  await page.locator('#modal button.primary').click(); await page.waitForTimeout(300);
  const start = await page.locator('#modal-box h2').innerText().catch(() => '');
  check('back to start screen', start.includes('Grand Central'), start);
  check('no resume offered after a lost run', (await page.locator('#modal button', { hasText: 'Resume' }).count()) === 0);
  const unlocked = await page.locator('.mode:not(.locked)').count();
  check('modes unlocked by best week', unlocked >= 2, `${unlocked} modes unlocked`);
  await page.locator('.mode:not(.locked)', { hasText: 'Junction' }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const dims = await page.evaluate(() => [window.gcs.state.board.w, window.gcs.state.modeKey]);
  check('junction 9x9 run started', dims[0] === 9, JSON.stringify(dims));
  await page.screenshot({ path: SP + '/shot11_junction.png' });
  // Draw order: a tall one-cell tile in front of a long bar must occlude it.
  // Ordering whole tiles gets this wrong (the bar's far end sorts last and
  // repaints over the tile standing in front of its near end), so the renderer
  // orders by cell. Sample a pixel on the front tile's roof, in the band that
  // the cell behind it would repaint, and check whose colour won.
  await page.evaluate(() => {
    const s = window.gcs.state, r = window.gcs.renderer;
    s.board.tiles.length = 0; s.board.lanes.length = 0; s.board.driveways.length = 0;
    const add = (name, key, cells) => s.board.tiles.push({ id: s.board.nextId++, key, name, kind: 'amenity', cells, rot: 0, level: 1 });
    add('Bar', 'waiting_area', [[4, 4], [4, 5], [4, 6], [4, 7]]); // sorts last as a whole tile
    add('Fr', 'vending', [[5, 5]]);                               // stands in front of the bar's far end
    window.gcs.ui.selectedTileId = null; window.gcs.ui.hoverTileId = null;
    r.fit(); window.gcs.refresh();
  });
  await page.waitForTimeout(400);
  const roof = await page.evaluate(() => {
    const r = window.gcs.renderer, d = r.dpr || 1;
    const [x, y] = r.project(5.5, 5.5);
    const sy = y - r.heightOf('vending') * r.hz - r.hh * 0.75; // roof, above the label chip
    const im = r.canvas.getContext('2d').getImageData(Math.round(x * d), Math.round(sy * d), 1, 1).data;
    return [im[0], im[1], im[2]];
  });
  const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 40;
  check('cells in front paint over the multi-cell tiles behind them', near(roof, [255, 165, 58]),
    `roof pixel ${roof} (front tile #ffa53a=255,165,58; bar behind #d9d24a=217,210,74)`);
  await page.screenshot({ path: SP + '/shot12_draworder.png' });
  // Underground layer: aim a subway through the real UI, then build it and a
  // garage whose tunnel would cross it.
  await page.evaluate(() => {
    const s = window.gcs.state; s.phase = 'shop'; s.ap = 3; s.money = 5000;
    s.board.edges.E = 'road';
    s.shop.cards.push({ id: 'test-sub', slot: 4, type: 'tile', key: 'subway', name: 'Subway Station', kind: 'transport', cost: 150, desc: '' },
      { id: 'test-gar', slot: 5, type: 'tile', key: 'under_parking', name: 'Underground Parking', kind: 'transport', cost: 110, desc: '' });
    window.gcs.ui.mode = 'idle'; window.gcs.ui.card = null; window.gcs.refresh();
  });
  await page.waitForTimeout(150);
  await page.locator('.card', { hasText: 'Subway Station' }).click(); await page.waitForTimeout(150);
  const [sx, sy] = await cellPx(3, 2);
  await page.mouse.move(sx, sy); await page.waitForTimeout(250);
  const ghost = await page.evaluate(() => { const g = window.gcs.ui.ghost; return g ? { ok: g.ok, tunnel: g.tunnel ? g.tunnel.cells.length : -1, ends: g.tunnel ? g.tunnel.ends.join('') : '' } : null; });
  check('subway ghost carries its tunnel', !!ghost && ghost.ok && ghost.tunnel === 7 && ghost.ends === 'WE', JSON.stringify(ghost));
  await page.screenshot({ path: SP + '/shot13_underground_ghost.png' });
  await page.mouse.click(sx, sy); await page.waitForTimeout(200);
  const built = await page.evaluate(() => { const t = window.gcs.state.board.tiles.find(t => t.key === 'subway'); return t ? { y: t.y, tunnel: t.tunnel.cells.length } : null; });
  check('subway built with its tunnel recorded', !!built && built.tunnel === 7, JSON.stringify(built));
  await page.locator('.card', { hasText: 'Underground Parking' }).click(); await page.waitForTimeout(150);
  // a garage below the line tunnels east along its own row; one whose row is the subway's crosses it
  const [gx, gy] = await cellPx(2, 6);
  await page.mouse.move(gx, gy); await page.waitForTimeout(250);
  const gOk = await page.evaluate(() => { const g = window.gcs.ui.ghost; return g && g.ok && g.tunnel && g.tunnel.ends.join('') === 'E'; });
  check('garage ghost tunnels to the road edge', !!gOk);
  const [cx2, cy2] = await cellPx(6, 2);
  await page.mouse.move(cx2, cy2); await page.waitForTimeout(250);
  const gBad = await page.evaluate(() => { const g = window.gcs.ui.ghost; return g ? { ok: g.ok, reason: g.reason } : null; });
  check('a garage on the subway row is refused as a crossing', !!gBad && !gBad.ok && /cross/.test(gBad.reason), JSON.stringify(gBad));
  await page.screenshot({ path: SP + '/shot14_underground_cross.png' });
  await page.keyboard.press('Escape');
  // A level that starts part-built: Sky Harbour opens with its two edges claimed
  // and the checkpoint already across the middle, and the renderer has to draw
  // that board before the player has touched anything.
  await page.evaluate(() => window.gcs.showStart());
  await page.waitForTimeout(300);
  await page.locator('.mode:not(.locked)', { hasText: 'Sky Harbour' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  const sky = await page.evaluate(() => {
    const s = window.gcs.state;
    const gate = s.board.tiles.find(t => t.key === 'gate');
    return { mode: s.modeKey, edges: s.board.edges, tiles: s.board.tiles.length, gate: gate ? gate.cells : null };
  });
  check('Sky Harbour starts airside, roadside and gated', sky.mode === 'sky_harbour' && sky.edges.N === 'apron' && sky.edges.S === 'road' && sky.tiles === 1 && !!sky.gate, JSON.stringify(sky));
  await page.screenshot({ path: SP + '/shot15_sky_harbour.png' });
} catch (e) { results.push('TEST ERROR ' + e.message.split('\n').slice(0, 25).join(' | ')); await page.screenshot({ path: SP + '/shot_err2.png' }); }
console.log(results.join('\n'));
console.log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill();
