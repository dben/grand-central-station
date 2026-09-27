#!/usr/bin/env node
// Upscales the rest of the board art (the transports and their lanes) with an
// image model, keeping everything but the colours:
//   node harness/upscale.mjs [key ...] [--tries 1] [--model meta/muse-image] [--reuse] [--weak]
// --weak paints again only the families with a turn still in its code colours.
// Each turn of a tile's code art (the sheet isoart.mjs draws from tileart.mjs,
// floor and over layers composited; kept the first time as
// assets/paint/<key>_<turn>_code.png so a painting is never the guide for the
// next) is sent upscaled on a key colour, a few turns side by side, and the
// model asked to redraw it with more detail and nothing moved. Each turn's
// painting is fitted back onto its code art (a scale and a shift, by overlap)
// and resampled at twice the density into assets/paint/<key>_<turn>.png.
// isoart.mjs then bakes the tile from its code art as always, but at twice the
// density, each pixel's colour from the painting: the shapes, the layers, the
// cells and the faces all stay the code art's, so nothing can move or be cut,
// and where the painting has nothing (or strays) the code colour stays.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, quantize } from './png.mjs';
import { SHOPS, FLOORS, DENSITY, paintImage, floodKey } from './shopart.mjs';
import { ISO_FRAMES } from '../src/ui/isosprites.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const model = flag('model', 'meta/muse-image'), tries = +flag('tries', 1), reuse = args.includes('--reuse');
const keys = args.filter((a, i) => !a.startsWith('--') && !['--model', '--tries'].includes(args[i - 1]));
const rawDir = resolve(root, 'harness/.shopraw'), outDir = resolve(root, 'assets/paint');
mkdirSync(rawDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
const D = DENSITY, tag = model.split('/').pop();
const GROUP_W = 520;                      // frame pixels of code art per call: the model paints each at ~3.5x
const GAP = 24;                           // frame pixels of key colour between turns
const MIN_FIT = 0.6;                      // overlap below which a turn keeps its code colours
// Background colours to key out; each tile gets the one furthest from its own colours.
const KEYS = { magenta: [255, 0, 255], green: [0, 255, 0], cyan: [0, 255, 255], yellow: [255, 255, 0] };
const RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:2': 1.5, '16:9': 16 / 9, '21:9': 21 / 9, '3:4': 3 / 4, '2:3': 2 / 3 };
const blank = (w, h) => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
const px = (p, x, y) => x >= 0 && y >= 0 && x < p.w && y < p.h ? p.data.subarray((y * p.w + x) * 4, (y * p.w + x) * 4 + 4) : [0, 0, 0, 0];

// Turn m's code art, floor under over, as one picture, and its top-left in frame pixels.
function codeArt(key, m) {
  if (!existsSync(resolve(outDir, 'log.json'))) writeFileSync(resolve(outDir, 'log.json'), '{}\n');
  const f = resolve(outDir, `${key}_${m}_code.png`), logf = resolve(outDir, 'log.json');
  const log = existsSync(logf) ? JSON.parse(readFileSync(logf, 'utf8')) : {};
  if (!existsSync(f) || !log[key]?.code?.[m]) {
    const man = ISO_FRAMES[key];
    if (man.d) throw new Error(`${key}: the sheet is painted already and its code art is gone; rerun isoart.mjs with assets/paint/${key}_* moved away`);
    const sheet = decodePng(readFileSync(resolve(root, `assets/iso/${key}.png`))), fr = man.frames[m];
    const Ls = ['floor', 'over'].filter(l => fr[l]).map(l => fr[l]);
    const x0 = Math.min(...Ls.map(r => r[4])), y0 = Math.min(...Ls.map(r => r[5])), x1 = Math.max(...Ls.map(r => r[4] + r[2])), y1 = Math.max(...Ls.map(r => r[5] + r[3]));
    const out = blank(x1 - x0, y1 - y0);
    for (const [sx, sy, w, h, fx, fy] of Ls) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p = px(sheet, sx + i, sy + j); if (!p[3]) continue;
      const o = ((fy + j - y0) * out.w + fx + i - x0) * 4, a = p[3] / 255, b = out.data[o + 3] / 255, A = a + b * (1 - a);
      for (let k = 0; k < 3; k++) out.data[o + k] = (p[k] * a + out.data[o + k] * b * (1 - a)) / A;
      out.data[o + 3] = A * 255;
    }
    writeFileSync(f, encodePng(out));
    log[key] = log[key] || {}; log[key].code = log[key].code || []; log[key].code[m] = [x0, y0];
    writeFileSync(logf, JSON.stringify(log, null, 1) + '\n');
  }
  return { pic: decodePng(readFileSync(f)), at: JSON.parse(readFileSync(logf, 'utf8'))[key].code[m] };
}

const prompt = (n, bg, veh) => [
  `This image shows ${n} small pixel-art sprites, side by side, from an isometric (2:1) pixel-art game about running a busy transit hub: ${veh ? 'vehicles (cars, buses, trains, boats, aircraft, cable cars), each seen from its own angle' : 'a transport stop, platform or dock, turned different ways'}.`,
  `Redraw each one at this larger size as crisp, finished pixel art with much more detail: texture, shading, highlights, panel lines, windows, small props. Change nothing else: every shape exactly where it is, the same outline, the same size, the same colours. Do not add, remove or move anything.`,
  `Keep the plain flat ${bg} background exactly as it is, with no shadows, ground or frame outside the sprites. No people, no letters or numbers.`,
].join('\n\n');

// Fit one turn's painting onto its code art: overlap of the painting (inside the
// turn's slot) with the code art's outline, over a scale and a shift.
function fitTurn(img, fg, slot, code, map) {
  const W = code.w, H = code.h, mask = Uint8Array.from({ length: W * H }, (_, i) => code.data[i * 4 + 3] > 20 ? 1 : 0);
  const back = (p, X, Y) => map((X - p.dx - W / 2) / p.s + W / 2 + slot.x, (Y - p.dy - H / 2) / p.s + H / 2 + slot.y);
  const fgAt = ([x, y]) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < img.w && y < img.h ? fg[y * img.w + x] : 0; };
  const iou = (p, st = 1) => { let both = 0, either = 0; for (let Y = -6; Y < H + 6; Y += st) for (let X = -6; X < W + 6; X += st) { const a = X >= 0 && Y >= 0 && X < W && Y < H && mask[Y * W + X], b = fgAt(back(p, X + 0.5, Y + 0.5)); if (a && b) both++; if (a || b) either++; } return either ? both / either : 0; };
  let best = { s: 1, dx: 0, dy: 0 }; best.v = iou(best, 2);
  for (const [ds, dd] of [[0.03, 3], [0.015, 1.5], [0.008, 0.75], [0.004, 0.35]]) for (let moved = true, n = 0; moved && n < 30; n++) {
    moved = false;
    for (const [a, b, c] of [[ds, 0, 0], [-ds, 0, 0], [0, dd, 0], [0, -dd, 0], [0, 0, dd], [0, 0, -dd]]) { const q = { s: best.s + a, dx: best.dx + b, dy: best.dy + c }; q.v = iou(q, dd > 1 ? 2 : 1); if (q.v > best.v) { best = q; moved = true; } }
  }
  best.v = iou(best);
  // resample: each sub-pixel of the code art at D, the painting under it, where most of it is painting
  const out = blank(W * D, H * D), [ax] = map(0, 0), [bx] = map(1, 0), per = (bx - ax) / best.s / D;
  let diff = 0, cnt = 0;
  for (let j = 0; j < H * D; j++) for (let i = 0; i < W * D; i++) {
    if (!mask[Math.floor(j / D) * W + Math.floor(i / D)]) continue;
    const [gx, gy] = back(best, (i + 0.5) / D, (j + 0.5) / D), x0 = gx - per / 2, y0 = gy - per / 2;
    let r = 0, g = 0, b = 0, a = 0, all = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y0 + per); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + per); x++) {
      all++;
      if (x < 0 || y < 0 || x >= img.w || y >= img.h || !fg[y * img.w + x]) continue;
      const o = (y * img.w + x) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a++;
    }
    if (!a || a * 2 < all) continue;
    out.data.set([r / a, g / a, b / a, 255], (j * out.w + i) * 4);
    const c = px(code, Math.floor(i / D), Math.floor(j / D));
    diff += (Math.abs(r / a - c[0]) + Math.abs(g / a - c[1]) + Math.abs(b / a - c[2])) / 3; cnt++;
  }
  // how far the painting's colours stray from the code art's, and how much of it they cover
  return { pic: out, v: best.v, drift: cnt ? diff / cnt : 999, cover: cnt / Math.max(1, mask.reduce((s, x) => s + x, 0) * D * D) };
}

const logPath = resolve(outDir, 'log.json');
let spent = 0;
// Families painted together: a tile's own turns, its lanes' turns, and all its
// vehicles' turns (a car park's cars in one call rather than one each).
const all = Object.keys(ISO_FRAMES).filter(k => !SHOPS[k] && !FLOORS[k]);
const familyOf = k => k.replace(/_veh\d+$/, ' veh').replace(/_lane(_alt)?( veh)?$/, ' lane$2');
const wanted = keys.length ? all.filter(k => keys.some(w => k === w || k.startsWith(w + '_'))) : all;
const families = new Map();
for (const k of wanted) { const f = familyOf(k); if (!families.has(f)) families.set(f, []); families.get(f).push(k); }
const weakOnly = args.includes('--weak'), logNow = () => JSON.parse(readFileSync(logPath, 'utf8'));
for (const [fam, members] of families) {
  // --weak: only the families with a turn still in its code colours
  if (weakOnly && members.every(k => [0, 1, 2, 3].every(m => logNow()[k]?.turns?.[m]?.raw))) continue;
  const veh = / veh$/.test(fam), items = members.flatMap(key => [0, 1, 2, 3].map(m => ({ key, m, code: codeArt(key, m) }))).filter(it => it.code.pic.w > 0);
  // the key colour furthest from every colour in the family
  const cols = items.flatMap(({ code: c }) => { const o = []; for (let i = 0; i < c.pic.w * c.pic.h; i += 3) if (c.pic.data[i * 4 + 3] > 20) o.push(c.pic.data.subarray(i * 4, i * 4 + 3)); return o; });
  const [bgName, bg] = Object.entries(KEYS).map(([n, k]) => [n, k, Math.min(...cols.map(c => Math.abs(c[0] - k[0]) + Math.abs(c[1] - k[1]) + Math.abs(c[2] - k[2])))]).sort((a, b) => b[2] - a[2])[0];
  const isBg = (r, g, b) => Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 150;
  // pack into rows of up to GROUP_W, and rows into calls of up to GROUP_W tall
  const groups = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g) groups.push(g = { rows: [] });
    let row = g.rows[g.rows.length - 1];
    if (!row || row.w + GAP + it.code.pic.w > GROUP_W) {
      const h = g.rows.reduce((a, r) => a + r.h + GAP, 0);
      if (row && h + it.code.pic.h > GROUP_W * 0.66) { groups.push(g = { rows: [] }); }
      g.rows.push(row = { items: [], w: -GAP, h: 0 });
    }
    row.items.push(it); row.w += GAP + it.code.pic.w; row.h = Math.max(row.h, it.code.pic.h);
  }
  const log = JSON.parse(readFileSync(logPath, 'utf8'));
  for (const [gi, grp] of groups.entries()) {
    // the guide: the rows at scale G, centred on a canvas of the nearest ratio
    const fw = Math.max(...grp.rows.map(r => r.w)) + 2 * GAP, fh = grp.rows.reduce((a, r) => a + r.h + GAP, 0) + GAP;
    const [ratio, rv] = Object.entries(RATIOS).reduce((a, e) => Math.abs(Math.log(e[1] * fh / fw)) < Math.abs(Math.log(a[1] * fh / fw)) ? e : a);
    const GW = rv >= 1 ? 1536 : Math.round(1536 * rv), GH = rv >= 1 ? Math.round(1536 / rv) : 1536, G = Math.min(GW / fw, GH / fh);
    const ox = (GW - fw * G) / 2 + GAP * G, oy = (GH - fh * G) / 2 + GAP * G, slots = [];
    let y = 0;
    for (const row of grp.rows) { let x = 0; for (const it of row.items) { slots.push({ ...it, x, y: y + (row.h - it.code.pic.h) / 2 }); x += it.code.pic.w + GAP; } y += row.h + GAP; }
    const guide = { w: GW, h: GH, data: new Uint8ClampedArray(GW * GH * 4) };
    for (let i = 0; i < GW * GH; i++) guide.data.set([...bg, 255], i * 4);
    for (const s of slots) { const c = s.code.pic; for (let j = 0; j < c.h * G; j++) for (let i = 0; i < c.w * G; i++) { const p = px(c, Math.floor(i / G), Math.floor(j / G)); if (p[3] > 20) { const a = p[3] / 255, o = (Math.floor(oy + s.y * G + j) * GW + Math.floor(ox + s.x * G + i)) * 4; for (let k = 0; k < 3; k++) guide.data[o + k] = p[k] * a + bg[k] * (1 - a); } } }
    const id = `up_${fam.replace(' ', '_')}_g${gi}`, mine = f => f.startsWith(id + '_') && /^_\d{6,}_/.test(f.slice(id.length)) && (!args.includes('--model') || f.endsWith(`_${tag}.png`));
    writeFileSync(resolve(rawDir, `${id}_guide.png`), encodePng(guide));
    const raws = reuse ? readdirSync(rawDir).filter(mine) : [];
    for (let t = 0; !reuse && t < tries; t++) {
      const name = `${id}_${Date.now()}_${tag}.png`;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { const { png, cost } = paintImage(model, [encodePng(guide)], prompt(slots.length, bgName, veh), ratio, '2K'); writeFileSync(resolve(rawDir, name), png); raws.push(name); spent += cost; break; }
        catch (e) { console.log(`  ${fam}: ${e.message.slice(0, 120)}`); }
      }
    }
    // each turn's best painting: the most overlap, less the colour drift
    for (const s of slots) {
      let best = null;
      for (const name of raws) {
        const img = decodePng(readFileSync(resolve(rawDir, name))), fg = floodKey(img, isBg);
        // the key colour bleeds into the painting's soft edge: peel two pixels off the
        // outline, and drop anything still near the key colour
        for (let pass = 0; pass < 2; pass++) { const f0 = fg.slice(); for (let i = 0; i < f0.length; i++) if (f0[i]) { const x = i % img.w; if (!f0[i - 1] || !f0[i + 1] || !f0[i - img.w] || !f0[i + img.w] || x === 0 || x === img.w - 1) fg[i] = 0; } }
        for (let i = 0; i < fg.length; i++) if (fg[i] && Math.abs(img.data[i * 4] - bg[0]) + Math.abs(img.data[i * 4 + 1] - bg[1]) + Math.abs(img.data[i * 4 + 2] - bg[2]) < 260) fg[i] = 0;
        // a model that paints at another ratio is taken to have fitted the guide in, centred
        const k = Math.min(img.w / GW, img.h / GH), mx = (img.w - GW * k) / 2, my = (img.h - GH * k) / 2;
        const map = (X, Y) => [mx + (ox + X * G) * k, my + (oy + Y * G) * k];
        const r = fitTurn(img, fg, s, s.code.pic, map), score = r.v - r.drift / 200;
        if (!best || score > best.score) best = { ...r, score, name };
      }
      if (!best) continue;
      log[s.key].turns = log[s.key].turns || [];
      // a painting that barely fits would put its colours in the wrong places: better the code art's
      const old = log[s.key].turns[s.m], file = resolve(outDir, `${s.key}_${s.m}.png`);
      if (best.v < MIN_FIT) {
        if (!old || old.overlap < MIN_FIT) { if (existsSync(file)) unlinkSync(file); log[s.key].turns[s.m] = { raw: null, overlap: +best.v.toFixed(3), kept: 'code' }; }
        continue;
      }
      // a retry replaces a turn only where it fits better
      if (old && old.raw && old.overlap >= best.v && old.raw !== best.name && existsSync(file)) continue;
      // 255 colours, as the sheet it bakes into has, so it packs into a palette
      writeFileSync(file, encodePng(quantize(best.pic, 255)));
      log[s.key].turns[s.m] = { raw: best.name, overlap: +best.v.toFixed(3), drift: +best.drift.toFixed(1), cover: +best.cover.toFixed(3) };
    }
  }
  writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
  const ts = members.flatMap(k => (log[k].turns || []).filter(t => t && t.raw));
  console.log(`${fam}: ${members.length} sheet(s), ${groups.length} call(s), overlap ${Math.min(...ts.map(t => t.overlap)).toFixed(2)}-${Math.max(...ts.map(t => t.overlap)).toFixed(2)}, drift ${Math.min(...ts.map(t => t.drift))}-${Math.max(...ts.map(t => t.drift))}`);
}
if (spent) console.log(`spent $${spent.toFixed(3)}`);
