import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
// UI smoke test. Requires: npm i playwright && npx playwright install chromium
// Usage: node harness/ui-smoke.mjs [screenshot-dir]
import { mkdirSync } from 'node:fs';
const SP = process.argv[2] || 'harness/screenshots';
mkdirSync(SP, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8791'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const results = [];
const check = (name, cond, extra = '') => { results.push(`${cond ? 'ok  ' : 'FAIL'}: ${name} ${extra}`); };
const cellPx = async (x, y) => page.evaluate(([x, y]) => { const r = window.gcs.renderer; const b = r.canvas.getBoundingClientRect(); return [b.left + r.px(x) + r.cs / 2, b.top + r.py(y) + r.cs / 2]; }, [x, y]);
const edgePx = async (e) => page.evaluate((e) => { const r = window.gcs.renderer; const b = r.canvas.getBoundingClientRect(); const [x, y, w, h] = r.edgeRect(e); return [b.left + x + w / 2, b.top + y + h / 2]; }, e);
// auto-play weeks through the API (greedy-lite) up to a target week
const fastForward = async (toWeek) => page.evaluate((toWeek) => {
  const { G } = window.gcs; let s = window.gcs.state;
  const legal = (key) => { for (let y = 0; y < s.board.h; y++) for (let x = 0; x < s.board.w; x++) for (let r = 0; r < 4; r++) { const c = G.placementCheck(s, key, x, y, r); if (c.ok) return { x, y, r }; } return null; };
  while (s.week < toWeek) {
    if (s.pendingOrdinance) G.chooseOrdinance(s, s.pendingOrdinance[0]);
    if (s.phase === 'won') G.continueAfterWin(s);
    let guard = 0;
    while (s.ap > 0 && guard++ < 10) {
      const cards = s.shop.cards.filter(c => c.type === 'tile' && G.cardCost(s, c) <= s.money);
      const tr = cards.find(c => c.kind === 'transport'), am = cards.find(c => c.kind === 'amenity');
      const nTr = s.board.tiles.filter(t => t.kind === 'transport').length, nAm = s.board.tiles.length - nTr;
      const pick = (nTr <= nAm && tr) ? tr : (am || tr);
      if (!pick) { G.wait(s); break; }
      const p = legal(pick.key); if (!p) { G.wait(s); break; }
      const r = G.buyTile(s, pick, p.x, p.y, p.r); if (!r.ok) { G.wait(s); break; }
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
  await page.locator('.mode', { hasText: 'Terminal' }).first().click();
  await page.waitForTimeout(300);
  const cards1 = await page.locator('.card .name').allTextContents();
  check('week-1 shop has no upgrade token or bridge', !cards1.includes('Upgrade Token') && !cards1.some(c => c.includes('Bridge')), cards1.join(','));
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
  // upgrade token via UI: click token card then a tile
  const tokenIdx = (await page.locator('.card .name').allTextContents()).indexOf('Upgrade Token');
  check('upgrade token offered at week 5', tokenIdx >= 0);
  if (tokenIdx >= 0) {
    await page.locator('.card').nth(tokenIdx).click();
    await page.waitForTimeout(150);
    const infoT = await page.locator('#info-title').innerText();
    check('target mode prompt', infoT.toLowerCase().includes('upgrade'), infoT);
    const tile = await page.evaluate(() => { const s = window.gcs.state; const t = s.board.tiles.find(t => t.kind === 'amenity') || s.board.tiles[0]; return { id: t.id, x: t.cells[0][0], y: t.cells[0][1], level: t.level, money: s.money }; });
    const [px, py] = await cellPx(tile.x, tile.y);
    await page.mouse.click(px, py);
    await page.waitForTimeout(200);
    const after = await page.evaluate((id) => window.gcs.state.board.tiles.find(t => t.id === id).level, tile.id);
    check('tile upgraded via click', after === tile.level + 1, `level ${tile.level} -> ${after}, money was ${tile.money}`);
  }
  // rezoning card on an edge
  await page.evaluate(() => { const s = window.gcs.state; s.money += 500; s.ap = Math.max(s.ap, 2); const locked = Object.keys(s.board.edges).find(e => s.board.edges[e] !== 'green'); if (!locked) { s.board.edges.N = 'rail'; } s.shop.cards.push({ id: 'test-rez', slot: 4, type: 'card', key: 'rezoning', name: 'Rezoning Permit', cost: 120, desc: 'Unlock one locked edge back to greenfield.', target: 'edge' }); window.gcs.refresh(); });
  await page.waitForTimeout(150);
  const lockedEdge = await page.evaluate(() => Object.keys(window.gcs.state.board.edges).find(e => window.gcs.state.board.edges[e] !== 'green'));
  await page.locator('.card', { hasText: 'Rezoning' }).click();
  await page.waitForTimeout(150);
  const [ex, ey] = await edgePx(lockedEdge);
  await page.mouse.click(ex, ey);
  await page.waitForTimeout(200);
  const edgeNow = await page.evaluate((e) => window.gcs.state.board.edges[e], lockedEdge);
  check('rezoning permit unlocks edge via edge click', edgeNow === 'green', `${lockedEdge}: ${edgeNow}`);
  // delete a tile via panel
  const delTile = await page.evaluate(() => { const s = window.gcs.state; s.ap = 2; const t = s.board.tiles[s.board.tiles.length - 1]; return { id: t.id, x: t.cells[0][0], y: t.cells[0][1], n: s.board.tiles.length }; });
  const [dx, dy] = await cellPx(delTile.x, delTile.y);
  await page.mouse.click(dx, dy); await page.waitForTimeout(150);
  await page.locator('#popup button.danger').click(); await page.waitForTimeout(150);
  const nTiles = await page.evaluate(() => window.gcs.state.board.tiles.length);
  check('delete via info panel', nTiles === delTile.n - 1, `${delTile.n} -> ${nTiles}`);
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
  await page.locator('#btn-run').click(); await page.waitForTimeout(200);
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
  results.push(`info: week-16 projection with L5 board: ${proj} vs quota ${await page.locator('#st-quota').innerText()}`);
  await page.locator('#btn-run').click(); await page.waitForTimeout(200);
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
    await page.locator('#btn-run').click(); await page.waitForTimeout(200);
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
} catch (e) { results.push('TEST ERROR ' + e.message.split('\n').slice(0, 25).join(' | ')); await page.screenshot({ path: SP + '/shot_err2.png' }); }
console.log(results.join('\n'));
console.log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); server.kill();
