#!/usr/bin/env node
// Paints the walk-through tiles again with an image model, from their own art:
//   node harness/floorgen.mjs [key ...] [--tries 1] [--model google/gemini-3.1-flash-image] [--reuse | --pick <painting>]
// These are floor the crowd walks on (FLOORS in shopart.mjs), so they can't go
// through shopgen, whose shops are solid. Instead each view's code art (the
// sheet isoart.mjs draws from tileart.mjs, saved the first time as
// assets/floors/<key>_<view>_code_floor.png and _code_over.png, so a painting
// is never the guide for the next) is sent upscaled on magenta, and the model
// asked for the same layout with more detail. The painting is fitted back onto
// that outline (a scale and a shift), resampled at twice the density and split:
// what lay over the crowd in the code art (a park's tree tops) is the over
// layer, the rest the floor, cut to the tile. Tiles without trees keep their
// code over layer (the glass rim of a lounge) as it was. The best of --tries by
// overlap goes to assets/floors/<key>_<view>_floor.png and _over.png, and
// `node harness/isoart.mjs <key>` bakes them.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, quantize } from './png.mjs';
import { FLOORS, DENSITY, COLOURS, shopViews, floorBox, rayHit, paintImage, floodKey } from './shopart.mjs';
import { ISO_FRAMES } from '../src/ui/isosprites.js';
import { tileDef } from '../src/data/tiles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const model = flag('model', 'google/gemini-3.1-flash-image'), tries = +flag('tries', 1);
const reuse = args.includes('--reuse'), pick = flag('pick', null), valued = ['--model', '--tries', '--pick'];
const keys = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
const rawDir = resolve(root, 'harness/.shopraw'), outDir = resolve(root, 'assets/floors');
mkdirSync(rawDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
const tag = model.split('/').pop(), D = DENSITY, GUIDE = 1024, MAGENTA = [255, 0, 255];
const RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:2': 1.5, '16:9': 16 / 9, '21:9': 21 / 9, '3:4': 3 / 4, '2:3': 2 / 3 };
const blank = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
const at = (p, x, y) => x >= 0 && y >= 0 && x < p.w && y < p.h ? p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4) : [0, 0, 0, 0];

// The code art of view v, floor and over layers, in the view's floor box at 1x:
// cut from the sheet the first time (while it is still the code art) and kept.
function codeArt(key, v, m, box) {
  const f = l => resolve(outDir, `${key}_${v}_code_${l}.png`);
  if (!existsSync(f('floor'))) {
    const man = ISO_FRAMES[key];
    if (man.d) throw new Error(`${key}: the sheet is painted already and the code art is gone; rerun isoart.mjs with assets/floors/${key}_* moved away`);
    const sheet = decodePng(readFileSync(resolve(root, `assets/iso/${key}.png`)));
    for (const l of ['floor', 'over']) {
      const out = blank(box[2] - box[0], box[3] - box[1]), r = man.frames[m][l];
      if (r) { const [sx, sy, w, h, fx, fy] = r; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const p = at(sheet, sx + i, sy + j); if (p[3]) out.data.set(p, ((fy + j - box[1]) * out.w + fx + i - box[0]) * 4); } }
      writeFileSync(f(l), encodePng(out));
    }
  }
  return { floor: decodePng(readFileSync(f('floor'))), over: decodePng(readFileSync(f('over'))) };
}

const SHAPE_WORDS = { I1: 'a single square', I2: 'a strip two squares long and one square wide', I4: 'a long strip four squares long and one square wide', O4: 'a square two squares by two', O6: 'a rectangle three squares by two' };
function prompt(key) {
  return [
    `This is a small pixel-art sprite of ${FLOORS[key].text}, from an isometric (2:1) pixel-art game about running a busy transit hub. It is a flat patch of floor, ${SHAPE_WORDS[tileDef(key).shape]}, inside a big station concourse that travellers walk across.`,
    'Redraw it as a finished, detailed sprite. Keep exactly the same camera, the same outline and proportions, and the same size and position on the canvas: do not zoom in. Keep the same layout (every object where it is now, the same size) and the same colours, with much richer detail: textures, shading, highlights, small props.',
    `The tile is paper-thin: no raised base, no thickness, no side faces below its outline. Everything on it stays low, no taller than a bench or a planter${FLOORS[key].trees ? ', except the trees already there' : ''}. No people, no letters or numbers. Keep the plain flat magenta background exactly as it is, with no shadows or floor outside the sprite.`,
  ].join('\n\n');
}

// Where the painting's pixel (x, y) lands in the box, at scale s and shift (dx, dy) in frame pixels.
function fit(img, fg, g, mask, box) {
  const W = box[2] - box[0], H = box[3] - box[1];
  const back = (p, X, Y) => [((X - p.dx - W / 2) / p.s + W / 2) * g.G + g.ox, ((Y - p.dy - H / 2) / p.s + H / 2) * g.G + g.oy];
  const fgAt = (x, y) => { x = Math.floor(x * img.w / g.GW); y = Math.floor(y * img.h / g.GH); return x >= 0 && y >= 0 && x < img.w && y < img.h ? fg[y * img.w + x] : 0; };
  const iou = p => { let both = 0, either = 0; for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) { const a = mask[Y * W + X], b = fgAt(...back(p, X + 0.5, Y + 0.5)); if (a && b) both++; if (a || b) either++; } return both / either; };
  // start where the model left it, and with the painting's outline scaled onto the guide's
  const bb = (test, n1, n2) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let y = 0; y < n2; y++) for (let x = 0; x < n1; x++) if (test(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1 + 1, y1 + 1]; };
  const [mx0, my0, mx1, my1] = bb((x, y) => mask[y * W + x], W, H);
  const [px0, py0, px1, py1] = bb((x, y) => fg[y * img.w + x], img.w, img.h).map((v, i) => ((i % 2 ? v * g.GH / img.h - g.oy : v * g.GW / img.w - g.ox) / g.G));
  const starts = [{ s: 1, dx: 0, dy: 0 }];
  for (const f of [0.9, 1, 1.1]) {
    // scale by width, and set the bottom corners level (the model's base, if any, hangs below)
    const sc = (mx1 - mx0) / (px1 - px0) * f;
    starts.push({ s: sc, dx: (mx0 + mx1) / 2 - ((px0 + px1) / 2 - W / 2) * sc - W / 2, dy: my1 - (py1 - H / 2) * sc - H / 2 });
    starts.push({ s: sc, dx: (mx0 + mx1) / 2 - ((px0 + px1) / 2 - W / 2) * sc - W / 2, dy: (my0 + my1) / 2 - ((py0 + py1) / 2 - H / 2) * sc - H / 2 });
  }
  let best = null;
  for (const st of starts) { st.v = iou(st); if (!best || st.v > best.v) best = st; }
  for (const [ds, dd] of [[0.04, 4], [0.02, 2], [0.01, 1], [0.005, 0.5]]) for (let moved = true, n = 0; moved && n < 30; n++) {
    moved = false;
    for (const [a, b, c] of [[ds, 0, 0], [-ds, 0, 0], [0, dd, 0], [0, -dd, 0], [0, 0, dd], [0, 0, -dd]]) { const q = { s: best.s + a, dx: best.dx + b, dy: best.dy + c }; q.v = iou(q); if (q.v > best.v) { best = q; moved = true; } }
  }
  // resample at DENSITY: each pixel the painting under it, where most of it is painting
  const out = blank(W * D, H * D), per = g.G / best.s / D * img.w / g.GW;
  for (let j = 0; j < H * D; j++) for (let i = 0; i < W * D; i++) {
    const [gx, gy] = back(best, (i + 0.5) / D, (j + 0.5) / D), x0 = gx * img.w / g.GW - per / 2, y0 = gy * img.h / g.GH - per / 2;
    let r = 0, gg = 0, b = 0, a = 0, all = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + per); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + per); x++) {
      all++;
      if (x < 0 || y < 0 || x >= img.w || y >= img.h || !fg[y * img.w + x]) continue;
      const o = (y * img.w + x) * 4; r += img.data[o]; gg += img.data[o + 1]; b += img.data[o + 2]; a++;
    }
    if (a * 2 >= all && a) out.data.set([r / a, gg / a, b / a, 255], (j * out.w + i) * 4);
  }
  return { pic: out, v: best.v };
}

const logPath = resolve(outDir, 'log.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : {};
let spent = 0;
for (const key of keys.length ? keys : Object.keys(FLOORS)) {
  if (!FLOORS[key]) { console.log(`${key}: not a walk-through tile (see FLOORS in harness/shopart.mjs)`); continue; }
  const { views, turns } = shopViews(key), trees = !!FLOORS[key].trees;
  log[key] = log[key] || { views: [] };
  views.forEach((cells, v) => {
    const m = turns.findIndex(t => t.view === v && !t.flip), box = floorBox(cells), W = box[2] - box[0], H = box[3] - box[1];
    const code = codeArt(key, v, m, box);
    // the guide: the code art the painting must follow, upscaled whole on magenta
    const show = blank(W, H);
    for (let i = 0; i < W * H; i++) { if (code.floor.data[i * 4 + 3]) show.data.set(code.floor.data.subarray(i * 4, i * 4 + 4), i * 4); if (trees && code.over.data[i * 4 + 3]) show.data.set(code.over.data.subarray(i * 4, i * 4 + 4), i * 4); }
    const mask = Uint8Array.from({ length: W * H }, (_, i) => show.data[i * 4 + 3] ? 1 : 0);
    // The guide is cropped close round the sprite, at the ratio nearest its shape: left
    // small on a big canvas, the models zoom in and paint past its edges.
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) if (mask[Y * W + X]) { bx0 = Math.min(bx0, X); bx1 = Math.max(bx1, X + 1); by0 = Math.min(by0, Y); by1 = Math.max(by1, Y + 1); }
    const bw = (bx1 - bx0) * 1.2, bh = (by1 - by0) * 1.2;
    const [ratio, rv] = Object.entries(RATIOS).reduce((a, e) => Math.abs(Math.log(e[1] * bh / bw)) < Math.abs(Math.log(a[1] * bh / bw)) ? e : a);
    const GW = rv >= 1 ? GUIDE : Math.round(GUIDE * rv), GH = rv >= 1 ? Math.round(GUIDE / rv) : GUIDE, G = Math.min(GW / bw, GH / bh);
    const g = { G, GW, GH, ratio, ox: GW / 2 - (bx0 + bx1) / 2 * G, oy: GH / 2 - (by0 + by1) / 2 * G };
    const guide = { w: GW, h: GH, data: new Uint8ClampedArray(GW * GH * 4) };
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const X = Math.floor((i - g.ox) / G), Y = Math.floor((j - g.oy) / G), p = at(show, X, Y);
      guide.data.set(p[3] ? [p[0], p[1], p[2], 255] : [...MAGENTA, 255], (j * GW + i) * 4);
    }
    writeFileSync(resolve(rawDir, `floor_${key}_v${v}_guide.png`), encodePng(guide));
    const id = `${key}_v${v}`, mine = f => f.startsWith(`floor_${id}_`) && /^_\d{6,}_/.test(f.slice(`floor_${id}`.length)) && (!args.includes('--model') || f.endsWith(`_${tag}.png`));
    const raws = pick && mine(pick) ? [pick] : reuse || pick ? readdirSync(rawDir).filter(mine) : [];
    for (let t = 0; !reuse && !pick && t < tries; t++) {
      const name = `floor_${id}_${Date.now()}_${tag}.png`;
      try { const { png, cost } = paintImage(model, [encodePng(guide)], prompt(key), g.ratio, '1K'); writeFileSync(resolve(rawDir, name), png); raws.push(name); spent += cost; console.log(`  ${key} view ${v}: painted ${name} ($${cost.toFixed(3)})`); }
      catch (e) { console.log(`  ${key} view ${v}: ${e.message}`); }
    }
    let best = null;
    for (const name of raws) {
      const img = decodePng(readFileSync(resolve(rawDir, name))), fg = floodKey(img, (r, gg, b) => r > 170 && b > 170 && gg < 110 && Math.abs(r - b) < 70);
      // the magenta must go all round it, or the model painted past the canvas and it can't be fitted
      let edge = 0, n = 0;
      for (let x = 0; x < img.w; x += 2) { edge += fg[x] + fg[(img.h - 1) * img.w + x]; n += 2; }
      for (let y = 0; y < img.h; y += 2) { edge += fg[y * img.w] + fg[y * img.w + img.w - 1]; n += 2; }
      if (edge > 0.01 * n) { console.log(`  ${key} view ${v}: ${name} runs off the canvas, skipped`); continue; }
      const r = fit(img, fg, g, mask, box);
      console.log(`  ${key} view ${v}: ${name} overlap ${r.v.toFixed(3)}`);
      if (!best || r.v > best.v) best = { ...r, name };
    }
    if (!best) return;
    // Split: the code art's over layer (dilated a pixel) takes the painting's trees; the
    // rest is floor, cut to what stands on the tile. Without trees, the code over layer stays.
    const overAt = (i, j) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (at(code.over, Math.floor((i + dx) / D), Math.floor((j + dy) / D))[3]) return true; return false; };
    const floor = blank(W * D, H * D), over = blank(W * D, H * D);
    for (let j = 0; j < H * D; j++) for (let i = 0; i < W * D; i++) {
      const o = (j * W * D + i) * 4, p = best.pic.data.subarray(o, o + 4), X = box[0] + (i + 0.5) / D, Y = box[1] + (j + 0.5) / D;
      if (trees && overAt(i, j)) { if (p[3]) over.data.set(p, o); continue; }
      if (!trees) { const q = at(code.over, Math.floor(i / D), Math.floor(j / D)); if (q[3]) over.data.set(q, o); }
      if (p[3] && rayHit(cells, 3, X, Y, 0)) floor.data.set(p, o);
    }
    const [qf, qo] = quantize([floor, over], COLOURS);
    writeFileSync(resolve(outDir, `${key}_${v}_floor.png`), encodePng(qf));
    writeFileSync(resolve(outDir, `${key}_${v}_over.png`), encodePng(qo));
    log[key].views[v] = { raw: best.name, model: best.name.replace(/^.*_\d{6,}_|\.png$/g, ''), overlap: +best.v.toFixed(3) };
    console.log(`${key} view ${v}: kept ${best.name}, overlap ${best.v.toFixed(3)}`);
  });
}
writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
if (spent) console.log(`spent $${spent.toFixed(3)}`);
