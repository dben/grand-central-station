#!/usr/bin/env node
// Lays every tile in the catalogue on one big board, each in two orientations,
// and screenshots it, so tile art can be judged in place without playing a run.
//   node harness/tileshow.mjs [out-dir] [--zoom 2.2] [--close 3.2] [--only key,key] [--nolabels] [--blocks]
// --blocks draws every tile as a plain block in its colour instead of its sheet,
// so the art can be compared with the look before it, shot for shot.
// Placement rules are ignored: the tiles are pushed straight onto the board.
// Needs Playwright (npm i playwright), like ui-smoke.mjs.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'harness/screenshots';
const zoom = +flag('zoom', 1), only = flag('only', '');
mkdirSync(out, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8792'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1000));
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
try {
  await page.goto('http://localhost:8792/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.locator('.mode-track > .mode button.primary', { hasText: 'Start Terminal' }).click();
  await page.waitForTimeout(400);
  const n = await page.evaluate(async (only) => {
    const { TRANSPORTS, AMENITIES } = await import('/src/data/tiles.js');
    const { shapeCells } = await import('/src/sim/shapes.js');
    const s = window.gcs.state;
    const keys = only ? only.split(',') : [...Object.keys(TRANSPORTS), ...Object.keys(AMENITIES)];
    const W = 30, b = s.board;
    b.w = W; b.h = 40; b.tiles = []; b.lanes = []; b.driveways = [];
    let x = 1, y = 1, rowH = 0, id = 1;
    for (const key of keys) {
      const def = TRANSPORTS[key] || AMENITIES[key];
      // base orientation, then the quarter turn, side by side
      const shapes = [0, 1].map(r => ({ r, cells: shapeCells(def.shape, r) }));
      const w = shapes.reduce((a, o) => a + Math.max(...o.cells.map(c => c[0])) + 2, 0);
      const h = Math.max(...shapes.map(o => Math.max(...o.cells.map(c => c[1])) + 1));
      if (x + w > W) { x = 1; y += rowH + 1; rowH = 0; }
      let cx = x;
      for (const o of shapes) {
        b.tiles.push({ id: id++, key, kind: TRANSPORTS[key] ? 'transport' : 'amenity', name: def.name, x: cx, y, rot: o.r, level: 1,
          cells: o.cells.map(([a, c]) => [a + cx, c + y]), terrain: def.terrain || null, radiusBonus: 0, lane: [], driveway: [], edges: [], tunnel: null });
        cx += Math.max(...o.cells.map(c => c[0])) + 2;
      }
      x += w; rowH = Math.max(rowH, h);
    }
    b.h = y + rowH + 1; b.nextId = id;
    window.gcs.refresh();
    return keys.length;
  }, only);
  await page.waitForTimeout(600);
  // hide the chrome so the board fills the shot
  await page.addStyleTag({ content: '#shop, .shop, #topbar, #hud, .floating { visibility: hidden !important; }' });
  if (args.includes('--nolabels')) await page.evaluate(() => { window.gcs.renderer.drawTileLabel = () => {}; });
  if (args.includes('--blocks')) await page.evaluate(() => { window.gcs.renderer.artMode = 'blocks'; });
  await page.evaluate((z) => { const r = window.gcs.renderer; r.setZoom(z); r.userAdjusted = true; window.gcs.refresh(); }, zoom);
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  await canvas.screenshot({ path: `${out}/tiles_all.png` });
  // and a close look along the board, a strip at a time
  const focus = (gx, gy, z) => page.evaluate(([gx, gy, z]) => {
    const r = window.gcs.renderer; r.setZoom(z); r.userAdjusted = true;
    const [px, py] = r.project(gx, gy); r.panX += r.viewW / 2 - px; r.panY += r.viewH / 2 - py;
    window.gcs.refresh();
  }, [gx, gy, z]);
  const spots = await page.evaluate(() => {
    const b = window.gcs.state.board, out = [];
    for (let y = 4; y < b.h + 4; y += 8) for (let x = 5; x < b.w; x += 10) out.push([x, y]);
    return out;
  });
  const close = +flag('close', 3.2);
  for (let i = 0; i < spots.length; i++) {
    await focus(spots[i][0], spots[i][1], close); await page.waitForTimeout(150);
    await canvas.screenshot({ path: `${out}/tiles_z${i}.png` });
  }
  // Then the tiles that draw past the edge, placed for real against edges of the
  // right terrain, so their band (the ship, the airliner, the train) shows.
  const placed = await page.evaluate(async () => {
    const { createBoard, placeTile, checkPlacement } = await import('/src/sim/board.js');
    const s = window.gcs.state, b = createBoard(16, 12);
    Object.assign(b.edges, { N: 'apron', S: 'water', W: 'rail', E: 'road' });
    s.board = b;
    const want = [['jetway', 2, 0], ['jumbo_jetway', 6, 0], ['private_terminal', 10, 0], ['cruise_dock', 1, 11], ['water_taxi', 9, 11], ['ferry', 13, 10],
      ['train_station', 0, 1], ['express_train', 0, 6], ['bus_stop', 15, 1], ['taxi_stand', 15, 4], ['car_rental', 14, 7],
      ['parking_lot', 4, 2], ['green_space', 7, 5], ['helipad', 10, 4], ['monorail', 3, 8], ['coffee_cart', 9, 7],
      ['ski_lift', 6, 3], ['tram_stop', 11, 6], ['alpine_lift', 3, 3]];
    const got = [];
    for (const [key, x, y] of want) {
      let ok = false;
      for (let dy = 0; dy < 4 && !ok; dy++) for (let dx = 0; dx < 4 && !ok; dx++) for (let r = 0; r < 8 && !ok; r++) {
        const tx = x - (x > 8 ? dx : -dx), ty = y - (y > 6 ? dy : -dy), c = checkPlacement(b, key, tx, ty, r);
        if (c.ok) { placeTile(b, key, tx, ty, r, c); ok = true; }
      }
      got.push(key + (ok ? '' : ' (no room)'));
    }
    window.gcs.renderer.userAdjusted = false; window.gcs.refresh();
    return got;
  });
  await page.waitForTimeout(400);
  await canvas.screenshot({ path: `${out}/tiles_edges.png` });
  for (const [i, [gx, gy]] of [[4, 0], [12, 2], [4, 11], [12, 10], [1, 5], [8, 6]].entries()) {
    await focus(gx, gy, close); await page.waitForTimeout(150);
    await canvas.screenshot({ path: `${out}/tiles_edges_z${i}.png` });
  }
  console.log(`edge scene: ${placed.join(', ')}`);
  console.log(`ok: ${n} tiles -> ${out}/tiles_all.png`);
} finally { await browser.close(); server.kill(); }
