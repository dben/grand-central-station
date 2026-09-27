#!/usr/bin/env node
// Paints the shops' board art with an image model, through OpenRouter:
//   node harness/shopgen.mjs [key ...] [--tries 2] [--model google/gemini-3.1-flash-image] [--reuse | --pick <painting>]
// A shop needs one picture per footprint its turns show (shopViews in
// shopart.mjs: one for an I or O, up to four for an L4). This draws a block-out
// of each footprint in the tile's colour, all side by side in one image, and
// asks the model to paint the shop over every one of them at once, so all its
// sides match. It keys out the white background and fits each painting back
// onto its footprint: a search over scale and offset for the placement that
// covers the block best while the bake cuts least. A painting of the wrong shape
// is then either cut (a chopped wall) or shrunk (bare floor on its tile), so the
// one kept of --tries is the one whose worst view does least of either; it goes
// to assets/shops/<key>_<view>.png, and the script names any view still over a
// limit. `node harness/isoart.mjs <key>` then bakes the sheet from them.
//
// The model's own pictures are kept in harness/.shopraw/ (not committed);
// --reuse fits those again instead of paying for new ones (with --model, only
// that model's), and --pick fits the one named. The key comes from
// OPENROUTER_API_KEY, or from a proxy that adds it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decodePng, encodePng, quantize } from './png.mjs';
import { SHOPS, DENSITY, COLOURS, KEEP_ROOM, shopViews, wallHeight, viewBox, rayHit, cutStats } from './shopart.mjs';
import { tileDef } from '../src/data/tiles.js';
import { colorForDef } from '../src/ui/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const model = flag('model', 'google/gemini-3.1-flash-image'), byModel = args.includes('--model'), tries = +flag('tries', 1);
const reuse = args.includes('--reuse'), pick = flag('pick', null), valued = ['--model', '--tries', '--pick'];
const keys = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
const rawDir = resolve(root, 'harness/.shopraw'), outDir = resolve(root, 'assets/shops');
mkdirSync(rawDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
const GUIDE = 1536;                        // the block-out image's long side, in pixels
const GAP = 0.45;                          // white space between block-outs, as a share of the widest
const FIT_PAD = 40;                        // frame pixels round a view's box that the fit still looks at
const CHOP = 0.015;                        // a cut piece bigger than this share of a view's paint shows as a chopped wall
const BARE = 0.15;                         // bare floor over more than this share of the block: a shop too small for its tile
const SHADE = [1, 0.52, 0.70];             // top, left and right faces, as the sheets light them
const RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:2': 1.5, '16:9': 16 / 9, '21:9': 21 / 9 };
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const pct = v => (100 * v).toFixed(1) + '%';
const SHAPE_WORDS = { I1: 'a single square', I2: 'a 1 x 2 rectangle', I5: 'a long 1 x 5 rectangle', O4: 'a 2 x 2 square',
  L3: 'an L of three squares', L4: 'an L of four squares', S4: 'a zig-zag of four squares', S5: 'a zig-zag of five squares', T4: 'a T of four squares' };
const NUM = ['', 'one', 'two', 'three', 'four'];

// Where each view's block-out sits in the image: its frame box, at one scale
// for all of them, in a row, and the image padded out to a ratio the model draws.
function layout(views, wall) {
  const boxes = views.map(c => viewBox(c, wall)), ws = boxes.map(b => b[2] - b[0]), hs = boxes.map(b => b[3] - b[1]);
  const gap = GAP * Math.max(...ws), fw = ws.reduce((a, b) => a + b, 0) + gap * (views.length + 1), fh = Math.max(...hs) + gap;
  const [ratio, r] = Object.entries(RATIOS).reduce((a, e) => Math.abs(Math.log(e[1] * fh / fw)) < Math.abs(Math.log(a[1] * fh / fw)) ? e : a);
  const W = Math.max(fw, fh * r), H = W / r, G = GUIDE / Math.max(W, H);
  let x = (W - fw) / 2 + gap;
  const slots = boxes.map((b, i) => { const s = { box: b, gx: x * G, gy: ((H - hs[i]) / 2) * G }; x += ws[i] + gap; return s; });
  return { slots, G, gw: Math.round(W * G), gh: Math.round(H * G), ratio };
}
// A view's frame point -> the painting's pixel. A model that paints at another
// ratio than the block-out's is taken to have fitted it in, centred.
function toImg(L, s, img, X, Y) {
  const k = Math.min(img.w / L.gw, img.h / L.gh), ox = (img.w - L.gw * k) / 2, oy = (img.h - L.gh * k) / 2;
  return [ox + (s.gx + (X - s.box[0]) * L.G) * k, oy + (s.gy + (Y - s.box[1]) * L.G) * k];
}
// The block-outs: each footprint stood up as a prism, flat-lit in the tile's colour, on white.
function drawGuide(L, views, wall, tint) {
  const T = hex(tint), data = new Uint8ClampedArray(L.gw * L.gh * 4).fill(255);
  L.slots.forEach((s, v) => {
    const [X0, Y0, X1, Y1] = s.box;
    for (let j = Math.floor(s.gy); j < s.gy + (Y1 - Y0) * L.G; j++) for (let i = Math.floor(s.gx); i < s.gx + (X1 - X0) * L.G; i++) {
      const r = rayHit(views[v], wall, X0 + (i + 0.5 - s.gx) / L.G, Y0 + (j + 0.5 - s.gy) / L.G, 0);
      if (r && i >= 0 && j >= 0 && i < L.gw && j < L.gh) data.set(T.map(c => c * SHADE[r.face]), (j * L.gw + i) * 4);
    }
  });
  return { w: L.gw, h: L.gh, data };
}

function prompt(key, n) {
  const d = tileDef(key), shape = SHAPE_WORDS[d.shape] || 'its own shape';
  const what = n === 1 ? 'a flat-shaded 3D block-out of one building' : `${NUM[n]} flat-shaded 3D block-outs of buildings, side by side`;
  return [
    `This image is ${what}, for an isometric pixel-art game about running a busy transit hub. Paint over ${n === 1 ? 'it' : 'every one of them'} to make the finished sprite${n === 1 ? '' : 's'} of ${SHOPS[key]}. ${n === 1 ? 'It stands' : 'They are branches of the same shop, standing'} inside a big indoor station concourse.`,
    n === 1 ? '' : `\nPaint all ${NUM[n]} in one matching design: the same colours, awning, signs, windows, doors and roof kit, each arranged to suit its own walls. Each block-out has its own footprint (${shape}, turned a different way); paint each one exactly on its own shape. Keep them apart, in the same places, with white space between them.`,
    '',
    `Keep ${n === 1 ? 'the block-out\'s' : 'each block-out\'s'} geometry exactly. The game engine cuts the sprite${n === 1 ? '' : 's'} up along ${n === 1 ? 'this shape' : 'these shapes'}, so:`,
    '- the same 2:1 isometric camera, the same position and the same size on the canvas;',
    '- each building is exactly its block\'s mass: the same outline where it meets the ground, the same wall corners and inside corners, the walls the same height;',
    '- only signs, rooftop kit and small roof features may rise above the flat roof, into the empty space above it; nothing may stick out past the walls at ground level.',
    '',
    `Style: crisp hard-edged pixel art with dark outlines, like a cosy 16-bit management sim, rich in small details. Keep the block-out colour (${colorForDef(d)}) as the main colour of the walls and roof, so the building still reads as that colour. Light from the upper right: walls facing right lighter than walls facing left. Put the shopfront on the walls facing the viewer. No letters, words or numbers anywhere: signs show pictures only, since the sprite is also shown mirrored. Plain flat pure white background; no ground, no floor tiles, no shadows on the ground, no people.`,
  ].join('\n');
}

// OpenRouter's image API: the block-out goes in as a reference image.
function callModel(guide, text, ratio, big) {
  const body = { model, prompt: text, aspect_ratio: ratio, resolution: big ? '2K' : '1K', output_format: 'png',
    input_references: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + guide.toString('base64') } }] };
  const auth = process.env.OPENROUTER_API_KEY ? ['-H', 'Authorization: Bearer ' + process.env.OPENROUTER_API_KEY] : [];
  const out = execFileSync('curl', ['-sS', 'https://openrouter.ai/api/v1/images', '-H', 'Content-Type: application/json', ...auth, '--data-binary', '@-'],
    { input: JSON.stringify(body), maxBuffer: 1 << 28 });
  const d = JSON.parse(out), im = d.data?.[0];
  if (d.error) throw new Error(JSON.stringify(d.error).slice(0, 400));
  if (!im || (im.media_type && im.media_type !== 'image/png')) throw new Error('no PNG in the reply: ' + (im ? im.media_type : JSON.stringify(d).slice(0, 200)));
  return { png: Buffer.from(im.b64_json, 'base64'), cost: d.usage?.cost || 0 };
}

// The model's white background, flooded in from the border so white inside the
// building (an awning's stripes) stays.
function keyOut(img) {
  const { w, h, data } = img, fg = new Uint8Array(w * h).fill(1), stack = [];
  const bgLike = i => { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; return Math.min(r, g, b) >= 222 && Math.max(r, g, b) - Math.min(r, g, b) <= 26; };
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (!fg[i] || !bgLike(i)) continue;
    fg[i] = 0;
    const x = i % w;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1); if (i >= w) stack.push(i - w); if (i < w * (h - 1)) stack.push(i + w);
  }
  return fg;
}

// Split the painting's foreground into its buildings (connected pieces) and
// give each to the block-out nearest it across the image, so one view's fit
// never sees its neighbour's paint. Returns one mask per slot.
function splitViews(img, fg, L) {
  const { w, h } = img, label = new Int32Array(w * h).fill(-1), sizes = [], sumX = [];
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!fg[i0] || label[i0] >= 0) continue;
    const id = sizes.length, stack = [i0];
    let n = 0, sx = 0;
    label[i0] = id;
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      n++; sx += x;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && fg[j] && label[j] < 0) { label[j] = id; stack.push(j); }
    }
    sizes.push(n); sumX.push(sx);
  }
  const mids = L.slots.map(s => toImg(L, s, img, (s.box[0] + s.box[2]) / 2, s.box[1])[0]);
  const owner = sizes.map((n, id) => { const cx = sumX[id] / n; return mids.reduce((b, m, v) => Math.abs(m - cx) < Math.abs(mids[b] - cx) ? v : b, 0); });
  return L.slots.map((_, v) => { const m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) if (label[i] >= 0 && owner[label[i]] === v) m[i] = 1; return m; });
}

// Fit one view's painting back onto its footprint. A placement is a scale s
// about the block's centre and a shift, applied to where the painting would sit
// if the model kept the block-out's framing. Its score is the share of the block
// it covers, less CUT times what the bake will cut away (paint over no column
// of the footprint, or past the picture's box), and OVER times what it paints
// above the block. A cut shows as a wall chopped off with floor behind it, far
// worse than a strip of bare floor round the shop, so it costs four times what
// covering earns; paint above the roof is signs, fine in moderation, but
// blowing the whole picture up to fill the room over the roof is not.
const CUT = 4, OVER = 0.12;
const flawOf = f => Math.max(f.big / CHOP, f.bare / BARE);
function register(img, fg, L, slot, cells, wall) {
  const [X0, Y0, X1, Y1] = slot.box, pts = [];
  let cx = 0, cy = 0, n = 0;
  for (let Y = Math.floor(Y0 - FIT_PAD); Y < Y1 + FIT_PAD; Y++) for (let X = Math.floor(X0 - FIT_PAD); X < X1 + FIT_PAD; X++) {
    // 1 the block, 0 room over it the bake keeps, -1 cut away (past the columns, or past the picture's box)
    const inBox = X >= X0 && X < X1 && Y >= Y0 && Y < Y1;
    const kind = !inBox ? -1 : rayHit(cells, wall, X + 0.5, Y + 0.5, 0) ? 1 : rayHit(cells, wall, X + 0.5, Y + 0.5, KEEP_ROOM) ? 0 : -1;
    pts.push([X + 0.5, Y + 0.5, kind]);
    if (kind === 1) { cx += X + 0.5; cy += Y + 0.5; n++; }
  }
  cx /= n; cy /= n;
  const fgAt = (X, Y) => { const [x, y] = toImg(L, slot, img, X, Y).map(Math.floor); return x >= 0 && y >= 0 && x < img.w && y < img.h ? fg[y * img.w + x] : 0; };
  // the frame point whose paint lands on (X, Y) under placement p
  const back = (p, X, Y) => [cx + (X - p.dx - cx) / p.s, cy + (Y - p.dy - cy) / p.s];
  const score = (p, step = 1) => {
    let cover = 0, spill = 0, over = 0;
    for (let k = 0; k < pts.length; k += step) {
      const [X, Y, kind] = pts[k];
      if (!fgAt(...back(p, X, Y))) continue;
      if (kind === 1) cover++; else if (kind === 0) over++; else spill++;
    }
    return (cover - CUT * spill - OVER * over) / (n / step);
  };
  // Start from where the model left it, and from placements that stand the
  // whole building's outline on the block: its bottom on the block's front
  // corner, its middle over the block's, at a spread of scales round the one
  // that matches their widths (awnings and signs make the width a rough guide).
  let bx0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < fg.length; i++) if (fg[i]) { const x = i % img.w, y = (i / img.w) | 0; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const [ax, ay] = toImg(L, slot, img, slot.box[0], slot.box[1]), [bx, by] = toImg(L, slot, img, slot.box[0] + 1, slot.box[1] + 1);
  const toFrame = (x, y) => [slot.box[0] + (x - ax) / (bx - ax), slot.box[1] + (y - ay) / (by - ay)];
  const [fx0, fy1] = toFrame(bx0, by1 + 1), [fx1] = toFrame(bx1 + 1, by1);
  const kx = pts.filter(q => q[2] === 1).map(q => q[0]), ky = pts.filter(q => q[2] === 1).map(q => q[1]);
  const midX = (Math.max(...kx) + Math.min(...kx)) / 2, botY = Math.max(...ky);
  const starts = [{ s: 1, dx: 0, dy: 0 }];
  if (bx1 > bx0) {
    const s0 = (Math.max(...kx) - Math.min(...kx)) / (fx1 - fx0);
    for (let f = 0.8; f <= 1.21; f += 0.05) {
      const sc = s0 * f;
      starts.push({ s: sc, dx: midX - (cx + ((fx0 + fx1) / 2 - cx) * sc), dy: botY - (cy + (fy1 - cy) * sc) });
    }
  }
  let best = null;
  for (const st of starts.map(q => ({ ...q, v: score(q, 3) })).sort((a, b) => b.v - a.v).slice(0, 3)) {
    let p = st;
    // coarse to fine: nudge the scale and the shift until nothing nearby is better
    for (const [ds, dd] of [[0.04, 4], [0.02, 2], [0.01, 1], [0.005, 0.5]]) {
      for (let moved = true, guard = 0; moved && guard < 40; guard++) {
        moved = false;
        for (const [a, b, c] of [[ds, 0, 0], [-ds, 0, 0], [0, dd, 0], [0, -dd, 0], [0, 0, dd], [0, 0, -dd]]) {
          const q = { s: p.s + a, dx: p.dx + b, dy: p.dy + c };
          q.v = score(q, dd >= 2 ? 3 : 1);
          if (q.v > p.v) { p = q; moved = true; }
        }
      }
    }
    p.v = score(p);
    if (!best || p.v > best.v) best = p;
  }
  // resample into the source picture: each of its pixels averages the painting under it
  const D = DENSITY, W = Math.round((X1 - X0) * D), H = Math.round((Y1 - Y0) * D), out = new Uint8ClampedArray(W * H * 4);
  const per = Math.min(img.w / L.gw, img.h / L.gh) * L.G / best.s / D;   // painting pixels across one picture pixel
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [x, y] = toImg(L, slot, img, ...back(best, X0 + (i + 0.5) / D, Y0 + (j + 0.5) / D)), x0 = x - per / 2, y0 = y - per / 2;
    let r = 0, g = 0, b = 0, a = 0, all = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y0 + per); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x0 + per); xx++) {
      all++;
      if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h || !fg[yy * img.w + xx]) continue;
      const o = (yy * img.w + xx) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a++;
    }
    if (a * 2 < all) continue;
    out.set([r / a, g / a, b / a, 255], (j * W + i) * 4);
  }
  const pic = { w: W, h: H, data: out };
  return { pic, fit: best, ...cutStats(pic, cells, wall) };
}

const logPath = resolve(outDir, 'log.json');
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, 'utf8')) : {};
let spent = 0;
for (const key of keys.length ? keys : Object.keys(SHOPS)) {
  if (!SHOPS[key]) { console.log(`${key}: not a shop (see SHOPS in harness/shopart.mjs)`); continue; }
  const def = tileDef(key), wall = wallHeight(key), { views } = shopViews(key), L = layout(views, wall);
  const guide = encodePng(drawGuide(L, views, wall, colorForDef(def)));
  writeFileSync(resolve(rawDir, `${key}_guide.png`), guide);
  const tag = model.split('/').pop(), mine = f => new RegExp(`^${key}_\\d{6,}_`).test(f) && (!byModel || f.endsWith(`_${tag}.png`));
  const raws = pick ? [pick] : reuse ? readdirSync(rawDir).filter(mine) : [];
  for (let t = 0; !reuse && !pick && t < tries; t++) {
    const name = `${key}_${Date.now()}_${tag}.png`;
    try {
      const { png, cost } = callModel(guide, prompt(key, views.length), L.ratio, views.length > 1);
      writeFileSync(resolve(rawDir, name), png); raws.push(name); spent += cost;
      console.log(`  ${key}: painted ${name} (${model}, $${cost.toFixed(3)})`);
    } catch (e) { console.log(`  ${key}: ${e.message}`); }
  }
  // The painting whose worst view is chopped least, then whose worst view fits
  // best; its views are kept together, so all sides match.
  let best = null;
  for (const name of raws) {
    const img = decodePng(readFileSync(resolve(rawDir, name))), fg = keyOut(img);
    // a painting with a scene behind it instead of white can't be cut out
    let edge = 0, n = 0;
    for (let x = 0; x < img.w; x += 4) { edge += fg[x] + fg[(img.h - 1) * img.w + x]; n += 2; }
    for (let y = 0; y < img.h; y += 4) { edge += fg[y * img.w] + fg[y * img.w + img.w - 1]; n += 2; }
    if (edge > 0.2 * n) { console.log(`  ${key}: ${name} has no white background, skipped`); continue; }
    const masks = splitViews(img, fg, L);
    const fits = L.slots.map((s, v) => register(img, masks[v], L, s, views[v], wall));
    // A view's flaw is its chop or its bare floor against their limits, whichever is
    // worse: a painting of the wrong shape shows as one or the other, since the fit
    // either cuts it or shrinks it until it stops cutting. Flaws under 1 all count
    // as sound, and among sound paintings the fit decides.
    const worst = Math.min(...fits.map(f => f.fit.v)), flaw = Math.max(...fits.map(flawOf));
    console.log(`  ${key}: ${name} chops ${fits.map(f => pct(f.big)).join(', ')}; bare ${fits.map(f => pct(f.bare)).join(', ')}`);
    const rank = [Math.max(flaw, 1), -worst];
    if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { fits, rank, name };
  }
  if (!best) continue;
  // one palette for all of a shop's pictures, so its sheet still packs into one
  quantize(best.fits.map(f => f.pic), COLOURS).forEach((pic, v) => writeFileSync(resolve(outDir, `${key}_${v}.png`), encodePng(pic)));
  const r3 = v => +v.toFixed(3);
  log[key] = { raw: best.name, model: best.name.replace(/^.*_\d{6,}_|\.png$/g, ''), chop: best.fits.map(f => r3(f.big)), bare: best.fits.map(f => r3(f.bare)) };
  const bad = best.fits.map((f, v) => flawOf(f) > 1 ? v : -1).filter(v => v >= 0);
  console.log(`${key}: kept ${best.name}, chops ${best.fits.map(f => pct(f.big)).join(', ')}; bare ${best.fits.map(f => pct(f.bare)).join(', ')}${bad.length ? `  <- view ${bad.join(', ')} the wrong shape: paint again` : ''}`);
}
writeFileSync(logPath, JSON.stringify(log, null, 1) + '\n');
if (spent) console.log(`spent $${spent.toFixed(3)}`);
