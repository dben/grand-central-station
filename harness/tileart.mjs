#!/usr/bin/env node
// Draws the pixel-art board tiles and writes them as PNGs:
//   node harness/tileart.mjs [key ...]   -> assets/tiles/<key>.png, <key>_floor.png
// Each tile is drawn top-down in its shape's base orientation (src/sim/shapes.js)
// at 32 art pixels per cell, covering the bounding box. The renderer lays the
// image flat on the isometric grid and turns it to match the placed tile, so one
// image per layer covers every rotation.
//
// Two layers, with the crowd between them (see drawTileFloor in render.js):
//   <key>_floor.png  the ground a traveller stands on: paving, carpet, seats
//   <key>.png        what stands over them: roofs, canopies, vehicles, tree tops.
//                    Clear pixels let the floor and the crowd show through.
// A tile may have either or both. The main surfaces take the tile's own colour
// (colorForDef), so the board keeps its colour code with the art on.
//
// Down in the base image is the tile's working side: the kerb a bus pulls up to,
// the track, the berth. The renderer turns that side to face the edge the tile
// draws from, so a bus stop's bus sits on the road side whichever way it lies.
// No dependencies: the PNG is written with node's own zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { tileDef } from '../src/data/tiles.js';
import { SHAPES } from '../src/sim/shapes.js';
import { colorForDef } from '../src/ui/render.js';

const CELL = 32;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- colour -----------------------------------------------------------------
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const shade = (c, f) => toHex(hex(c).map(v => v * f));
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };

const INK = '#0a0520';
const WHITE = '#fff8e7';
const GLASS = '#7fd6ff', GLASS_D = '#3f8cc8';
const ASPHALT = '#4a4d5e', ASPHALT_D = '#3d4050';
const PAINT = '#f2f0e6', YELLOW = '#ffd23f', RED = '#e8384f';
const GRASS = ['#3f8f2f', '#4aa244', '#5cb84a', '#78cf5a'];
const WOOD = '#a86a3a', WOOD_L = '#d08a4a', WOOD_D = '#6b3e24';
const STEEL = '#c9c4d8', STEEL_D = '#8a8a9a';
const WATER = ['#1673c0', '#1ea0ea', '#6cc8ff'];

// ---- canvas -----------------------------------------------------------------
// One sheet per layer, clipped to the tile's footprint so nothing spills into
// the empty corner of an L or a T.
function sheet(shape) {
  const cells = SHAPES[shape][0];
  const cw = Math.max(...cells.map(c => c[0])) + 1, ch = Math.max(...cells.map(c => c[1])) + 1;
  const W = cw * CELL, H = ch * CELL;
  const set = new Set(cells.map(([x, y]) => x + ',' + y));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && set.has(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
  const px = new Array(W * H).fill(null);
  // distance in pixels to the edge of the footprint, along the axes (capped)
  const dist = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    let d = 0;
    while (d < 12 && inside(x - d - 1, y) && inside(x + d + 1, y) && inside(x, y - d - 1) && inside(x, y + d + 1)) d++;
    dist[y * W + x] = d;
  }
  const P = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (c && inside(x, y)) px[y * W + x] = c; };
  const R = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(x + i, y + j, c); };
  const S = (x, y, rows, pal, { flip = false, rot = false } = {}) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    const a = flip ? row.length - 1 - i : i;
    rot ? P(x + j, y + a, pal[ch]) : P(x + a, y + j, pal[ch]);
  }));
  const fill = c => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) P(x, y, c); };
  // every footprint pixel within `w` of the outline
  const rim = (w, c, from = 0) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) { const d = dist[y * W + x]; if (d >= from && d < from + w) P(x, y, c); } };
  const each = fn => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) fn(x, y, dist[y * W + x]); };
  const disc = (cx, cy, r, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.8) P(cx + x, cy + y, c); };
  const ring = (cx, cy, r, w, c) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.sqrt(x * x + y * y); if (d <= r + 0.4 && d > r - w + 0.4) P(cx + x, cy + y, c); } };
  // a shape given by a test over a box, filled (a colour, or a function of the
  // box position), with an ink line round it
  const blot = (x0, y0, w, h, test, col, ink = INK) => {
    const on = (i, j) => i >= 0 && j >= 0 && i < w && j < h && test(i, j);
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) {
      if (on(i, j)) P(x0 + i, y0 + j, typeof col === 'function' ? col(i, j) : col);
      else if (ink && (on(i - 1, j) || on(i + 1, j) || on(i, j - 1) || on(i, j + 1))) P(x0 + i, y0 + j, ink);
    }
  };
  // an inked box
  const box = (x, y, w, h, col, ink = INK) => blot(x, y, w, h, () => true, col, ink);
  const cellOn = (cx, cy) => set.has(cx + ',' + cy);
  return { W, H, cells, px, inside, dist, P, R, S, fill, rim, each, disc, ring, blot, box, cellOn };
}

// ---- ground ---------------------------------------------------------------------
// Everything below draws in art pixels on a sheet `c`, in base orientation.

// Paving: square slabs with a grout line every `n` pixels.
function paving(c, base, grout, n = 8) { c.each((x, y) => c.P(x, y, x % n === 0 || y % n === 0 ? grout : base)); }
function carpet(c, base, fleck) { c.each((x, y) => c.P(x, y, (x * 7 + y * 13) % 17 === 0 ? fleck : base)); }
function grass(c) { c.each((x, y) => { const n = (x * 37 + y * 61 + ((x * y) % 7)) % 23; c.P(x, y, n === 0 ? GRASS[3] : n < 4 ? GRASS[0] : n < 12 ? GRASS[1] : GRASS[2]); }); }
function tarmac(c, t, x0 = 0, y0 = 0, w = c.W, h = c.H) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.P(x, y, (x * 5 + y * 11) % 13 === 0 ? ASPHALT_D : mix(ASPHALT, t, 0.15)); }
function sea(c, x0 = 0, y0 = 0, w = c.W, h = c.H) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.P(x, y, (y % 6 === 0 && (x + 2 * y) % 11 < 3) ? WATER[2] : (y >> 2) % 3 === 0 ? mix(WATER[1], WATER[0], 0.3) : WATER[1]);
}
// The concourse paving a transport's platform is laid in, lightly tinted.
function platform(c, t) { paving(c, mix('#c4c0d4', t, 0.14), mix('#9a94b2', t, 0.22)); }
// An outline in the tile's colour, so the top face keeps the colour code.
function frame(c, t, w = 2) { c.rim(w, shade(t, 1.05), 1); c.rim(1, INK); }
// A kerb in the tile's colour round a flush tile: no walls, so this is the code.
function kerb(c, t, w = 2) { c.rim(w, t); c.rim(1, shade(t, 0.55)); }
// The working strip along the bottom of a transport, from row y0 down.
function roadStrip(c, t, y0) {
  tarmac(c, t, 0, y0, c.W, c.H - y0);
  c.R(0, y0, c.W, 1, PAINT);
  for (let x = 3; x < c.W; x += 12) c.R(x, c.H - 4, 6, 1, YELLOW);
}
function trackStrip(c, y0, y1 = c.H) {
  c.R(0, y0, c.W, y1 - y0, '#8d7a68');
  for (let x = 0; x < c.W; x++) if ((x * 5) % 3 === 0) c.P(x, y0 + 1 + (x % (y1 - y0 - 2)), '#6f5e50');
  for (let x = 1; x < c.W; x += 4) c.R(x, y0 + 2, 2, y1 - y0 - 4, WOOD_D);
  c.R(0, y0 + 4, c.W, 1, STEEL); c.R(0, y1 - 5, c.W, 1, STEEL);
}
function seaStrip(c, y0) { sea(c, 0, y0, c.W, c.H - y0); c.R(0, y0, c.W, 2, WOOD_L); c.R(0, y0 + 2, c.W, 1, WOOD_D); for (let x = 4; x < c.W; x += 16) c.R(x, y0 + 3, 2, 2, WOOD_D); }
function apronStrip(c, t, y0) {
  c.each((x, y) => { if (y >= y0) c.P(x, y, (x * 3 + y * 7) % 11 === 0 ? '#5a5e6c' : mix('#686c7c', t, 0.1)); });
  c.R(0, y0, c.W, 1, YELLOW);
  for (let x = 2; x < c.W; x += 10) c.R(x, y0 + Math.floor((c.H - y0) / 2), 5, 1, YELLOW);
}
// Yellow warning stripes, the hatching round a pad or a lift gate.
function hazard(c, x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) c.P(x, y, ((x + y) >> 1) % 2 ? YELLOW : INK); }

// ---- buildings --------------------------------------------------------------------
// A flat roof in the tile's colour: an inked outline, a lit parapet and panel
// seams across the membrane.
function roof(c, t) {
  c.fill(shade(t, 0.84));
  c.each((x, y, d) => { if (d > 4 && (x % 16 === 0 || y % 16 === 0)) c.P(x, y, shade(t, 0.76)); });
  c.rim(3, shade(t, 1.12), 1);
  c.rim(1, shade(t, 0.62), 4);
  c.rim(1, INK);
}
function hvac(c, x, y) { c.box(x, y, 5, 4, STEEL); c.R(x + 1, y + 1, 3, 1, STEEL_D); c.disc(x + 2, y + 2, 0, STEEL_D); }
function skylight(c, x, y, w, h) { c.box(x, y, w, h, GLASS); for (let i = x + 3; i < x + w; i += 4) c.R(i, y, 1, h, GLASS_D); c.R(x, y, w, 1, '#c8f0ff'); }
// A striped awning over every bottom-facing run of the footprint: the shopfront.
function awnings(c, col, alt = WHITE, depth = 4) {
  for (const [cx, cy] of c.cells) {
    if (c.cellOn(cx, cy + 1)) continue;
    const y = cy * CELL + CELL - depth;
    for (let j = 0; j < depth; j++) for (let i = 0; i < CELL; i++) c.P(cx * CELL + i, y + j, j === depth - 1 ? INK : Math.floor(i / 4) % 2 ? alt : col);
  }
}
// A plain shop: roof, awning, a few plant boxes, an icon painted on top.
function shop(c, t, icon, { awn = RED, alt = WHITE, at = null, plant = true } = {}) {
  roof(c, t);
  if (awn) awnings(c, awn, alt);
  if (plant) c.cells.forEach(([cx, cy], i) => { if (i % 2 === 0) hvac(c, cx * CELL + 23, cy * CELL + 5); });
  const [ix, iy] = at || [c.cells[0][0] * CELL + 16, c.cells[0][1] * CELL + 15];
  if (icon) icon(c, ix, iy);
}
// A trunk shadow on the floor and a canopy over it: the over layer of a park.
function treeShadow(c, x, y, r) { c.disc(x + 2, y + 3, r, '#2f6f25'); c.R(x, y, 2, 2, WOOD_D); }
function tree(c, x, y, r) {
  c.disc(x, y, r + 1, INK); c.disc(x, y, r, GRASS[0]);
  c.disc(x - 1, y - 1, r - 2, GRASS[1]); c.disc(x - 2, y - 2, Math.max(1, r - 5), GRASS[3]);
}
function bench(c, x, y, v = false) { v ? c.box(x, y, 3, 10, WOOD_L) : c.box(x, y, 10, 3, WOOD_L); }
// A parasol seen from above: a disc of alternating gores.
function parasol(c, cx, cy, r, a, b) {
  c.disc(cx, cy, r + 1, INK);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.8) c.P(cx + x, cy + y, Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 4)) % 2 ? a : b);
  c.disc(cx, cy, 1, WHITE);
}

// ---- vehicles (top-down, nose to the right) ---------------------------------------
function car(c, x, y, col, v = false) {
  const L = 15, D = 8;
  const test = (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === D - 1));
  const paint = (i, j) => i === L - 1 && (j === 1 || j === D - 2) ? '#fff1a8' : i === 10 || i === 11 ? GLASS : i === 3 ? GLASS_D : i > 3 && i < 10 ? shade(col, 0.82) : col;
  v ? c.blot(x, y, D, L, (i, j) => test(j, i), (i, j) => paint(j, i)) : c.blot(x, y, L, D, test, paint);
}
function bus(c, x, y, len, col, stripe = WHITE) {
  c.blot(x, y, len, 12, (i, j) => !((i === 0 || i === len - 1) && (j === 0 || j === 11)), (i, j) =>
    i >= len - 3 ? GLASS : (j === 1 || j === 10) ? ((i % 6) ? GLASS : shade(col, 0.7)) : (j === 5 || j === 6) ? stripe : col);
  for (let i = x + 8; i < x + len - 10; i += 14) c.box(i, y + 3, 5, 5, STEEL);
}
// A train car seen from above: roof, a lit stripe, roof boxes, glass at a nose.
function carriage(c, x, y, len, w, body, stripe, { nose = false, tail = false } = {}) {
  const r = Math.floor(w / 2);
  c.blot(x, y, len, w, (i, j) => {
    const dy = Math.abs(j - (w - 1) / 2);
    if (nose && i > len - r) return dy <= Math.sqrt(Math.max(0, r * r - (i - (len - r)) ** 2)) + 0.5;
    if (tail && i < r) return dy <= Math.sqrt(Math.max(0, r * r - (r - i) ** 2)) + 0.5;
    return true;
  }, (i, j) => (nose && i > len - r - 3 && Math.abs(j - (w - 1) / 2) < r - 1) ? GLASS : Math.abs(j - (w - 1) / 2) < 1 ? stripe : body);
  for (let i = x + 6; i < x + len - 8; i += 12) c.R(i, y + 2, 5, 2, shade(body, 0.8));
}
function train(c, x, y, len, cars, w, body, stripe, both = false) {
  const each = Math.floor((len - (cars - 1)) / cars);
  for (let k = 0; k < cars; k++) carriage(c, x + k * (each + 1), y, k === cars - 1 ? len - k * (each + 1) : each, w, body, stripe, { nose: k === cars - 1, tail: both && k === 0 });
}
// A hull pointed at the bow, with a deck inset and a cabin block.
function boat(c, x, y, len, w, hull, deck, cabin = null) {
  const bow = Math.min(Math.floor(len / 3), w + 2), cy = (w - 1) / 2;
  const test = (L, W0) => (i, j) => { const hw = W0 / 2 * (i > L - bow ? Math.max(0, (L - i) / bow) ** 0.7 : 1); return Math.abs(j - (W0 - 1) / 2) <= hw - 0.3; };
  c.blot(x, y, len, w, test(len, w), hull);
  c.blot(x + 2, y + 2, len - 5, w - 4, test(len - 5, w - 4), deck, null);
  if (cabin) { const [cx0, cw, col] = cabin; c.box(x + cx0, y + Math.round(cy) - Math.floor((w - 6) / 2), cw, w - 6, col); c.R(x + cx0 + cw - 2, y + Math.round(cy) - Math.floor((w - 6) / 2), 2, w - 6, GLASS); }
}
// An aircraft from above: fuselage, swept wings, tailplane. Box is len x span.
function plane(c, x, y, len, span, body, trim, down = false) {
  const cy = (span - 1) / 2, fw = Math.max(2, Math.round(span / 12));
  const test = (i, j) => {
    const dy = Math.abs(j - cy);
    const nose = i > len - 6 ? (len - i) / 6 : 1;
    if (dy <= fw * Math.sqrt(nose) + 0.2) return true;
    const le = len * 0.62 - dy * 0.45, te = len * 0.44 - dy * 0.3;
    if (dy <= span / 2 && i <= le && i >= te) return true;
    const tl = len * 0.14 - dy * 0.3, tt = 1;
    return dy <= span * 0.2 && i <= tl && i >= tt;
  };
  const paint = (i, j) => Math.abs(j - cy) < 1 && i < len - 6 ? trim : i > len - 6 && i < len - 3 && Math.abs(j - cy) <= fw - 1 ? GLASS : body;
  if (down) c.blot(x, y, span, len, (i, j) => test(j, i), (i, j) => paint(j, i));
  else c.blot(x, y, len, span, test, paint);
  for (const s of [-1, 1]) { const a = Math.round(len * 0.46), b = Math.round(cy + s * span * 0.24) - 1; down ? c.box(x + b, y + a, 3, 5, STEEL_D) : c.box(x + a, y + b, 5, 3, STEEL_D); }
}
// An airliner's nose pushed up to a jetway from the apron: the fuselage comes in
// from the top of the image and rounds off at row `tip`.
function nose(c, x, tip, w, trim) {
  const r = w / 2, top = -4;
  c.blot(x, top, w, tip - top, (i, j) => { const dy = j - (tip - top - r); return dy < 0 || (i + 0.5 - r) ** 2 + dy * dy <= r * r; },
    (i, j) => { const y = j + top; return y > tip - r && y < tip - r + 4 && Math.abs(i + 0.5 - r) < r - 3 ? '#2e374d' : Math.abs(i + 0.5 - r) < 1.5 && y < tip - r ? trim : WHITE; });
}
function heli(c, cx, cy, col) {
  c.R(cx, cy - 1, 18, 3, INK); c.R(cx + 1, cy, 16, 1, shade(col, 0.8)); c.R(cx + 16, cy - 4, 3, 9, INK);
  c.disc(cx, cy, 7, INK); c.disc(cx, cy, 6, col); c.disc(cx + 3, cy - 1, 3, GLASS);
  for (let i = -17; i <= 17; i++) { c.P(cx + i, cy + Math.round(i * 0.35), '#2e374d'); c.P(cx - Math.round(i * 0.35), cy + i, '#2e374d'); }
  c.disc(cx, cy, 1, STEEL);
}

// ---- icons (centred on cx, cy) ------------------------------------------------------
const ICON = {
  burger(c, x, y) { c.blot(x - 6, y - 5, 13, 4, (i, j) => j > 0 || (i > 1 && i < 11), '#f0a040'); c.R(x - 6, y - 1, 13, 1, '#5fc23a'); c.box(x - 6, y, 13, 2, WOOD_D); c.R(x - 6, y + 2, 13, 1, YELLOW); c.box(x - 6, y + 3, 13, 2, '#f0a040'); for (const i of [-3, 0, 3]) c.P(x + i, y - 4, WHITE); },
  cup(c, x, y) { c.box(x - 5, y - 2, 9, 8, WHITE); c.R(x - 4, y - 1, 7, 2, WOOD_D); c.ring(x + 5, y + 1, 2, 1, INK); for (const i of [-3, 0]) { c.P(x + i, y - 4, STEEL); c.P(x + i + 1, y - 5, STEEL); c.P(x + i, y - 6, STEEL); } },
  pizza(c, x, y) { c.blot(x - 7, y - 6, 15, 13, (i, j) => Math.abs(i - 7) <= 7 - j * 0.55, (i, j) => j < 2 ? '#d08a4a' : '#ffd23f'); for (const [i, j] of [[-3, -2], [2, -1], [0, 3]]) c.disc(x + i, y + j, 1, RED); },
  news(c, x, y) { c.box(x - 6, y - 7, 12, 14, WHITE); c.R(x - 4, y - 5, 8, 2, INK); for (let j = -1; j < 6; j += 2) c.R(x - 4, y + j, j < 2 ? 3 : 8, 1, STEEL_D); c.box(x, y - 1, 4, 3, '#3f8cff', null); },
  wc(c, x, y) { c.box(x - 9, y - 7, 19, 14, WHITE); c.R(x, y - 6, 1, 12, STEEL_D); c.disc(x - 5, y - 3, 1, '#2f6bff'); c.R(x - 6, y - 1, 3, 5, '#2f6bff'); c.disc(x + 5, y - 3, 1, RED); c.blot(x + 3, y - 1, 5, 5, (i, j) => Math.abs(i - 2) <= j * 0.5 + 0.6, RED, null); },
  info(c, x, y) { c.disc(x, y, 7, INK); c.disc(x, y, 6, '#2f6bff'); c.R(x - 1, y - 1, 2, 5, WHITE); c.R(x - 1, y - 4, 2, 2, WHITE); },
  hotdog(c, x, y) { c.blot(x - 8, y - 3, 17, 7, (i, j) => !((i < 2 || i > 14) && (j === 0 || j === 6)), '#f0c070'); c.R(x - 9, y - 1, 19, 3, INK); c.R(x - 8, y, 17, 1, '#c0503a'); for (let i = -6; i < 7; i += 3) c.P(x + i, y - 1, YELLOW); },
  gift(c, x, y) { c.box(x - 6, y - 4, 13, 10, '#ff4fd8'); c.R(x, y - 4, 1, 10, YELLOW); c.R(x - 6, y, 13, 1, YELLOW); c.P(x - 2, y - 6, YELLOW); c.P(x + 2, y - 6, YELLOW); c.P(x - 1, y - 5, YELLOW); c.P(x + 1, y - 5, YELLOW); },
  cash(c, x, y) { c.box(x - 8, y - 5, 17, 11, '#5fc23a'); c.ring(x, y, 3, 1, '#2f7a1f'); c.R(x - 6, y - 3, 2, 2, '#2f7a1f'); c.R(x + 5, y + 2, 2, 2, '#2f7a1f'); },
  ball(c, x, y) { c.disc(x, y, 7, INK); c.disc(x, y, 6, WHITE); c.disc(x, y, 2, INK); for (const [i, j] of [[-5, -2], [4, -4], [4, 4], [-4, 4], [0, -6]]) c.disc(x + i, y + j, 1, INK); },
  tray(c, x, y) { c.box(x - 9, y - 6, 19, 13, STEEL); c.disc(x - 3, y, 4, WHITE); c.disc(x - 3, y, 2, '#f0a040'); c.R(x + 4, y - 4, 1, 9, STEEL_D); c.R(x + 7, y - 4, 1, 9, STEEL_D); c.R(x + 3, y - 4, 3, 2, STEEL_D); },
  coins(c, x, y) { for (const [i, j] of [[-4, 2], [3, 3], [0, -3]]) { c.disc(x + i, y + j, 5, INK); c.disc(x + i, y + j, 4, YELLOW); c.R(x + i, y + j - 2, 1, 5, '#b08a10'); } },
  shirt(c, x, y) { c.blot(x - 8, y - 6, 17, 14, (i, j) => (j < 5 ? true : i > 3 && i < 13) && !(j === 0 && i > 5 && i < 11), '#35d4ff'); c.R(x, y - 5, 1, 12, shade('#35d4ff', 0.7)); },
  frame(c, x, y) { c.box(x - 8, y - 6, 17, 13, YELLOW); c.R(x - 6, y - 4, 13, 9, '#62abff'); c.blot(x - 6, y - 1, 13, 6, (i, j) => j >= Math.abs(i - 4) - 1, '#5fc23a', null); c.disc(x + 3, y - 2, 1, WHITE); },
  cocktail(c, x, y) { c.blot(x - 6, y - 6, 13, 7, (i, j) => Math.abs(i - 6) <= 6 - j, '#ff9cec'); c.R(x, y + 1, 1, 5, WHITE); c.R(x - 3, y + 6, 7, 1, WHITE); c.disc(x + 4, y - 7, 1, '#5fc23a'); },
  diamond(c, x, y) { c.blot(x - 8, y - 7, 17, 14, (i, j) => j < 4 ? Math.abs(i - 8) <= 5 + j : Math.abs(i - 8) <= 8 - (j - 4) * 0.8, (i, j) => j < 4 ? '#c8f0ff' : (i + j) % 3 ? '#7fd6ff' : WHITE); },
  shield(c, x, y) { c.blot(x - 7, y - 7, 15, 15, (i, j) => j < 8 ? true : Math.abs(i - 7) <= 7 - (j - 8), (i, j) => i < 7 ? '#2f6bff' : '#1f4fcf'); c.R(x - 1, y - 4, 3, 9, YELLOW); c.R(x - 4, y - 1, 9, 3, YELLOW); },
  drone(c, x, y) { for (const [i, j] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { c.ring(x + i, y + j, 3, 1, INK); c.P(x + i, y + j, STEEL); } c.box(x - 3, y - 3, 7, 7, '#35d4ff'); c.R(x - 4, y - 4, 1, 1, INK); c.disc(x, y, 1, RED); },
  atom(c, x, y) { for (let a = 0; a < 3; a++) for (let s = 0; s < 64; s++) { const th = s / 64 * Math.PI * 2, ex = 8 * Math.cos(th), ey = 3 * Math.sin(th), r = a * Math.PI / 3; c.P(x + ex * Math.cos(r) - ey * Math.sin(r), y + ex * Math.sin(r) + ey * Math.cos(r), '#35d4ff'); } c.disc(x, y, 2, '#ff4fd8'); },
  bottle(c, x, y) { c.box(x - 7, y - 7, 15, 15, RED); c.R(x - 5, y - 5, 11, 7, INK); for (let i = -4; i < 5; i += 3) { c.R(x + i, y - 4, 2, 5, [YELLOW, '#35d4ff', '#5fc23a', WHITE][(i + 4) / 3]); } c.R(x - 5, y + 4, 11, 2, INK); },
  wifi(c, x, y) { for (const [r, col] of [[9, '#35d4ff'], [6, '#35d4ff'], [3, '#35d4ff']]) for (let i = -r; i <= r; i++) { const j = -Math.round(Math.sqrt(r * r - i * i)); if (Math.abs(i) < r * 0.75) c.P(x + i, y + j + 3, col); } c.disc(x, y + 3, 1, '#35d4ff'); },
  clock(c, x, y) { c.disc(x, y, 9, INK); c.disc(x, y, 8, '#c7a3ff'); c.disc(x, y, 6, '#1a1033'); c.R(x, y - 5, 1, 5, '#35d4ff'); c.R(x, y, 4, 1, '#ff4fd8'); for (let a = 0; a < 12; a++) c.P(x + Math.round(5.5 * Math.cos(a * Math.PI / 6)), y + Math.round(5.5 * Math.sin(a * Math.PI / 6)), WHITE); },
};

// ---- tiles --------------------------------------------------------------------------
// Each entry: floor(c, tint) and/or over(c, tint). Down is the working side.
const TILES = {
  // ---- road
  bus_stop: { over(c, t) {
    platform(c, t); roadStrip(c, t, 18);
    c.box(8, 3, 26, 9, mix(GLASS, t, 0.35)); c.R(9, 4, 25, 2, shade(t, 1.1)); for (let x = 15; x < 34; x += 6) c.R(x, 6, 1, 6, mix(GLASS_D, t, 0.3));
    c.box(44, 4, 4, 4, YELLOW);
    bus(c, 7, 19, 50, t); frame(c, t);
  } },
  bike_rental: { over(c, t) {
    platform(c, t); roadStrip(c, t, 22);
    c.box(3, 2, 58, 6, shade(t, 1.0)); c.R(4, 3, 57, 1, shade(t, 1.3));
    for (let x = 6; x < 58; x += 7) { c.box(x, 10, 4, 9, STEEL_D); c.ring(x + 1, 11, 2, 1, INK); c.ring(x + 1, 17, 2, 1, INK); c.P(x + 2, 14, t); }
    c.box(48, 24, 8, 5, YELLOW); frame(c, t);
  } },
  taxi_stand: { over(c, t) {
    platform(c, t); roadStrip(c, t, 16);
    c.box(4, 3, 10, 8, t); c.R(6, 5, 6, 4, YELLOW); c.R(8, 6, 2, 2, INK);
    car(c, 4, 20, YELLOW); car(c, 24, 20, YELLOW); car(c, 44, 20, YELLOW);
    for (const x of [8, 28, 48]) c.box(x + 4, 22, 4, 3, INK);
    frame(c, t);
  } },
  rideshare: { over(c, t) {
    platform(c, t); tarmac(c, t, 3, 3, 26, 58); tarmac(c, t, 3, 35, 58, 26);
    for (let y = 8; y < 30; y += 12) c.R(3, y, 26, 1, PAINT);
    car(c, 8, 10, '#2e374d'); car(c, 8, 22, WHITE); car(c, 34, 44, t, false); car(c, 12, 44, '#9b5cff');
    c.box(40, 38, 10, 4, '#ff4fd8'); frame(c, t);
  } },
  car_rental: { over(c, t) {
    platform(c, t); tarmac(c, t, 0, 30, 64, 34);
    for (let x = 4; x < 64; x += 15) c.R(x, 32, 1, 28, PAINT);
    car(c, 6, 36, RED, true); car(c, 21, 36, WHITE, true); car(c, 36, 36, '#35d4ff', true); car(c, 51, 36, '#2e374d', true);
    c.box(3, 3, 58, 22, shade(t, 0.85)); c.R(4, 4, 57, 2, shade(t, 1.15)); hvac(c, 50, 9); c.box(8, 10, 22, 8, WHITE); c.R(10, 12, 18, 1, t); c.R(10, 15, 12, 1, t);
    frame(c, t);
  } },
  limo: { over(c, t) {
    platform(c, t); roadStrip(c, t, 16);
    c.box(10, 3, 76, 8, shade(t, 0.95)); c.R(11, 4, 75, 2, shade(t, 1.25));
    for (let x = 14; x < 84; x += 8) c.P(x, 8, YELLOW);
    c.R(0, 12, c.W, 2, RED);
    const L = 58; c.blot(20, 18, L, 10, (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === 9)), (i, j) => i > L - 13 && i < L - 9 ? GLASS_D : i > 6 && i < L - 16 ? (j === 0 || j === 9 ? '#2e374d' : '#1a1a24') : '#22222e');
    c.R(26, 19, 28, 1, '#6c6880'); frame(c, t);
  } },
  parking_lot: { floor(c, t) {
    tarmac(c, t);
    for (let x = 1; x < 64; x += 15) { c.R(x, 3, 1, 22, PAINT); c.R(x, 39, 1, 22, PAINT); }
    for (let x = 6; x < 60; x += 8) c.R(x, 32, 4, 1, YELLOW);
    car(c, 5, 5, RED, true); car(c, 35, 5, '#35d4ff', true); car(c, 50, 5, WHITE, true); car(c, 20, 41, YELLOW, true); car(c, 50, 41, '#9b5cff', true);
    kerb(c, t);
  } },

  // ---- rail and corridor
  train_station: { over(c, t) {
    platform(c, t); trackStrip(c, 16, 32);
    c.box(0, 1, c.W, 9, shade(t, 0.95)); c.R(0, 2, c.W, 2, shade(t, 1.25)); for (let x = 10; x < c.W; x += 20) c.R(x, 5, 10, 3, mix(GLASS, t, 0.25));
    c.R(0, 13, c.W, 1, YELLOW);
    train(c, 2, 18, 124, 3, 11, WHITE, t); frame(c, t);
  } },
  express_train: { over(c, t) {
    platform(c, t); trackStrip(c, 16, 32);
    c.box(0, 1, c.W, 9, shade(t, 0.95)); c.R(0, 2, c.W, 2, shade(t, 1.25)); for (let x = 12; x < c.W; x += 24) c.R(x, 5, 12, 3, mix(GLASS, t, 0.25));
    c.R(0, 13, c.W, 1, YELLOW);
    train(c, 2, 18, 156, 4, 11, '#e6e6f0', RED); frame(c, t);
  } },
  tram_stop: { over(c, t) {
    platform(c, t); c.R(0, 14, c.W, 16, mix('#9a94b2', t, 0.25)); c.R(0, 17, c.W, 1, STEEL_D); c.R(0, 26, c.W, 1, STEEL_D);
    c.box(4, 2, 40, 7, shade(t, 1.0)); c.R(5, 3, 39, 1, shade(t, 1.3)); c.box(52, 2, 40, 7, shade(t, 1.0)); c.R(53, 3, 39, 1, shade(t, 1.3));
    train(c, 6, 16, 84, 3, 12, t, WHITE, true); frame(c, t);
  } },
  monorail: { over(c, t) {
    platform(c, t); c.R(0, 12, c.W, 18, '#8f86b0'); c.R(0, 12, c.W, 1, '#d7cce8');
    for (let x = 8; x < c.W; x += 30) c.box(x, 1, 10, 7, shade(t, 1.0));
    const w = 14; c.blot(8, 14, 112, w, (i, j) => { const d = Math.abs(j - (w - 1) / 2), r = w / 2; return i < r ? d <= Math.sqrt(r * r - (r - i) ** 2) : i > 112 - r ? d <= Math.sqrt(Math.max(0, r * r - (i - 112 + r) ** 2)) : true; },
      (i, j) => j === 1 || j === w - 2 ? ((i % 7) ? GLASS : WHITE) : Math.abs(j - (w - 1) / 2) < 1.5 ? t : WHITE);
    frame(c, t);
  } },
  ski_lift: { over(c, t) {
    c.each((x, y) => c.P(x, y, (x * 7 + y * 3) % 19 === 0 ? '#c8d8f0' : '#eef4ff'));
    c.R(0, 9, c.W, 1, INK); c.R(0, 22, c.W, 1, INK);
    for (const x of [2, c.W - 10]) { c.box(x, 4, 8, 24, STEEL_D); c.R(x + 1, 13, 6, 6, t); }
    for (let x = 14; x < c.W - 14; x += 16) { c.box(x, 6, 8, 6, t); c.box(x + 8, 19, 8, 6, t); }
    frame(c, t);
  } },
  alpine_lift: { over(c, t) {
    c.each((x, y) => c.P(x, y, (x * 7 + y * 3) % 19 === 0 ? '#c8d8f0' : '#eef4ff'));
    for (const [x, y] of [[40, 4], [96, 22], [130, 6]]) { c.P(x, y, '#5fc23a'); c.blot(x - 3, y - 3, 7, 7, (i, j) => Math.abs(i - 3) + Math.abs(j - 3) <= 3, '#2f7a3f'); }
    c.R(0, 10, c.W, 1, INK); c.R(0, 21, c.W, 1, INK);
    for (const x of [2, c.W - 12]) { c.box(x, 3, 10, 26, STEEL_D); c.R(x + 1, 12, 8, 8, t); }
    for (let x = 18; x < c.W - 20; x += 26) { c.box(x, 6, 12, 9, t); c.R(x + 1, 7, 10, 2, GLASS); c.box(x + 13, 17, 12, 9, t); c.R(x + 14, 24, 10, 1, GLASS); }
    frame(c, t);
  } },

  // ---- water
  ferry: { over(c, t) {
    // the long arm is a slip with the ferry in it, the foot the terminal
    sea(c, 0, 0, 32, 96); c.R(0, 0, 3, 96, WOOD_L); c.R(29, 0, 3, 64, WOOD_L); c.R(0, 0, 32, 3, WOOD_L);
    for (let y = 8; y < 96; y += 14) { c.R(0, y, 3, 2, WOOD_D); c.R(29, y, 3, 2, WOOD_D); }
    c.blot(5, 6, 22, 84, (i, j) => { const b = 12; const hw = 11 * (j < b ? Math.max(0, j / b) ** 0.7 : j > 84 - 6 ? (84 - j) / 6 : 1); return Math.abs(i - 10.5) <= hw; }, WHITE);
    c.box(9, 26, 14, 40, '#e6e6f0'); for (let y = 30; y < 64; y += 5) { c.P(9, y, GLASS_D); c.P(22, y, GLASS_D); }
    c.box(11, 22, 10, 5, GLASS); c.R(10, 72, 12, 2, RED); c.box(13, 44, 6, 6, RED);
    c.box(32, 64, 32, 32, shade(t, 0.88)); c.R(33, 65, 30, 3, shade(t, 1.2)); hvac(c, 52, 72); for (let y = 72; y < 92; y += 6) c.R(36, y, 12, 3, GLASS);
    c.R(29, 76, 4, 8, WOOD_L); frame(c, t);
  } },
  water_taxi: { over(c, t) {
    platform(c, t); seaStrip(c, 14);
    c.box(6, 3, 14, 7, shade(t, 1.0)); c.R(8, 5, 10, 3, YELLOW);
    boat(c, 12, 18, 30, 11, YELLOW, WHITE, [8, 9, WHITE]); boat(c, 44, 20, 18, 9, t, WHITE);
    frame(c, t);
  } },
  water_bus: { over(c, t) {
    platform(c, t); seaStrip(c, 12);
    c.box(38, 2, 22, 7, shade(t, 1.0)); c.R(39, 3, 21, 1, shade(t, 1.3));
    boat(c, 6, 15, 52, 15, t, WHITE, [10, 30, '#e6e6f0']); frame(c, t);
  } },
  pontoon: { floor(c, t) {
    sea(c);
    c.R(28, 0, 8, 64, WOOD_L); for (let y = 2; y < 64; y += 4) c.R(28, y, 8, 1, WOOD);
    for (const y of [12, 40]) { c.R(4, y, 56, 5, WOOD_L); for (let x = 6; x < 60; x += 4) c.R(x, y, 1, 5, WOOD); }
    boat(c, 5, 20, 20, 9, WHITE, '#e6e6f0'); boat(c, 38, 21, 22, 9, t, WHITE); boat(c, 5, 49, 18, 9, RED, WHITE); boat(c, 39, 49, 20, 9, WHITE, '#e6e6f0');
    kerb(c, t);
  } },
  marina: { over(c, t) {
    sea(c);
    c.R(0, 29, 96, 6, WOOD_L); for (let x = 2; x < 96; x += 4) c.R(x, 29, 1, 6, WOOD);
    for (const x of [8, 40, 56, 88]) c.R(x - 1, 0, 3, 64, WOOD_L);
    boat(c, 44, 4, 10, 22, WHITE, '#e6e6f0'); boat(c, 60, 6, 26, 9, WHITE, '#e6e6f0', [8, 8, WHITE]); boat(c, 60, 17, 24, 9, t, WHITE);
    boat(c, 11, 40, 26, 10, WHITE, WOOD_L, [6, 9, WHITE]); boat(c, 11, 52, 24, 9, '#2e374d', WHITE); boat(c, 60, 44, 24, 12, WHITE, '#e6e6f0', [5, 10, WHITE]);
    frame(c, t);
  } },
  cruise_dock: { over(c, t) {
    platform(c, t); seaStrip(c, 9);
    c.box(10, 1, 40, 5, shade(t, 1.0)); c.box(120, 1, 40, 5, shade(t, 1.0));
    c.blot(4, 12, 184, 19, (i, j) => { const hw = 9.5 * (i > 150 ? Math.max(0, (184 - i) / 34) ** 0.6 : i < 4 ? 0.85 : 1); return Math.abs(j - 9) <= hw; }, WHITE);
    c.box(20, 15, 120, 13, '#e6e6f0'); c.box(30, 17, 90, 9, WHITE);
    for (let x = 34; x < 118; x += 6) { c.P(x, 17, GLASS_D); c.P(x, 25, GLASS_D); }
    c.box(60, 18, 14, 7, '#35d4ff'); c.box(96, 18, 9, 7, RED); c.R(98, 20, 5, 3, INK);
    c.box(142, 16, 8, 11, GLASS); frame(c, t);
  } },

  // ---- air and far-fetched
  helipad: { over(c, t) {
    c.fill(mix('#5a5e70', t, 0.12));
    c.ring(32, 32, 27, 2, YELLOW);
    c.R(22, 20, 4, 24, WHITE); c.R(38, 20, 4, 24, WHITE); c.R(26, 30, 12, 4, WHITE);
    for (const [x, y] of [[5, 5], [57, 5], [5, 57], [57, 57]]) c.box(x, y, 2, 2, '#ff9cec');
    heli(c, 42, 46, t); frame(c, t);
  } },
  balloon: { over(c, t) {
    grass(c); c.ring(48, 16, 12, 1, '#d8c89a');
    parasol(c, 48, 18, 17, t, YELLOW); c.ring(48, 18, 4, 1, shade(t, 0.6));
    c.box(38, 40, 20, 18, WOOD_L); c.R(40, 42, 16, 14, WOOD); c.R(42, 44, 12, 10, '#e8384f');
    c.box(6, 6, 10, 10, WOOD_L); c.box(80, 8, 8, 8, WOOD_L); frame(c, t);
  } },
  jetway: { over(c, t) {
    // the tip cell is on the apron: an airliner's nose; the bridge runs down
    // the stem and turns into the terminal at the foot
    apronStrip(c, t, 0);
    nose(c, 3, 22, 24, '#3f8cff');
    c.box(12, 22, 8, 32, '#d7cce8'); c.R(13, 23, 6, 30, STEEL); for (let y = 26; y < 52; y += 5) c.R(13, y, 6, 1, STEEL_D);
    c.box(12, 46, 30, 8, '#d7cce8'); c.R(13, 47, 28, 6, STEEL);
    c.box(34, 36, 28, 26, shade(t, 0.9)); c.R(35, 37, 27, 3, shade(t, 1.2)); for (let x = 38; x < 60; x += 6) c.R(x, 42, 3, 16, GLASS);
    frame(c, t);
  } },
  jumbo_jetway: { over(c, t) {
    apronStrip(c, t, 0);
    nose(c, 1, 26, 30, '#9b5cff'); c.R(0, 0, 32, 2, WHITE);
    for (const x of [6, 18]) { c.box(x, 24, 6, 82, '#d7cce8'); c.R(x + 1, 25, 4, 80, STEEL); }
    c.box(8, 106, 34, 8, '#d7cce8'); c.R(9, 107, 32, 6, STEEL);
    c.box(34, 98, 28, 28, shade(t, 0.9)); c.R(35, 99, 27, 3, shade(t, 1.2)); for (let x = 38; x < 60; x += 6) c.R(x, 104, 3, 18, GLASS);
    frame(c, t);
  } },
  prop_stand: { over(c, t) {
    apronStrip(c, t, 0); c.R(0, 0, 64, 6, mix('#c4c0d4', t, 0.14)); c.R(0, 5, 64, 1, YELLOW);
    plane(c, 10, 4, 34, 28, '#e6e6f0', RED);
    c.box(44, 16, 1, 9, '#2e374d'); c.box(52, 22, 8, 6, YELLOW); frame(c, t);
  } },
  hardstand: { floor(c, t) {
    apronStrip(c, t, 0);
    for (const [x, y] of [[8, 8], [54, 8], [8, 54], [54, 54]]) c.box(x, y, 2, 2, YELLOW);
    plane(c, 12, 14, 38, 34, WHITE, '#3f8cff'); kerb(c, t);
  } },
  private_terminal: { over(c, t) {
    // the bar of the T meets the apron with a business jet at the stand; the
    // stem is the lounge
    apronStrip(c, t, 0);
    plane(c, 14, 0, 58, 30, WHITE, YELLOW);
    c.box(34, 32, 28, 30, shade(t, 0.9)); c.R(35, 33, 27, 3, shade(t, 1.25)); skylight(c, 40, 40, 16, 8); c.box(38, 52, 20, 4, YELLOW);
    c.R(0, 30, 96, 2, RED); frame(c, t);
  } },
  jetpack: { over(c, t) {
    c.fill('#34216b'); for (const cx of [16, 48]) { c.disc(cx, 16, 12, INK); c.disc(cx, 16, 11, shade(t, 0.8)); c.ring(cx, 16, 9, 1, YELLOW); c.box(cx - 4, 12, 9, 9, STEEL); c.R(cx - 3, 13, 3, 7, RED); c.R(cx + 1, 13, 3, 7, RED); }
    frame(c, t);
  } },
  beam_pad: { over(c, t) {
    c.fill('#1a1033'); for (let y = 2; y < 64; y += 6) for (let x = (y % 12 ? 3 : 0); x < 64; x += 6) c.P(x, y, '#4b2f8f');
    for (const [r, col] of [[26, t], [21, '#ff9cec'], [16, t], [10, '#35d4ff'], [5, WHITE]]) { c.ring(32, 32, r, 2, col); }
    c.disc(32, 32, 3, '#35d4ff'); frame(c, t);
  } },
  loop_terminal: { over(c, t) {
    c.fill(mix('#3b3452', t, 0.1)); c.ring(32, 32, 22, 6, '#1a1033'); c.ring(32, 32, 20, 1, '#35d4ff'); c.ring(32, 32, 16, 1, '#35d4ff');
    c.box(0, 28, 12, 9, '#1a1033'); c.box(52, 28, 12, 9, '#1a1033');
    for (const [x, y] of [[20, 10], [44, 50], [10, 40]]) { c.box(x - 4, y - 3, 12, 7, WHITE); c.R(x + 4, y - 2, 3, 5, GLASS); }
    c.disc(32, 32, 7, shade(t, 0.9)); c.ring(32, 32, 7, 1, INK); frame(c, t);
  } },

  // ---- underground
  subway: { over(c, t) { platform(c, t); stairs(c, t, 4, 6, 40, 20); c.box(46, 4, 14, 24, shade(t, 0.9)); c.R(48, 8, 10, 10, WHITE); c.disc(53, 13, 4, RED); c.R(51, 12, 5, 2, WHITE); frame(c, t); } },
  express_subway: { over(c, t) { platform(c, t); stairs(c, t, 4, 6, 40, 20); stairs(c, t, 52, 6, 40, 20, true); c.box(40, 4, 12, 24, RED); c.R(43, 10, 6, 12, WHITE); frame(c, t); } },
  under_parking: { over(c, t) {
    platform(c, t); tarmac(c, t, 4, 4, 24, 56); tarmac(c, t, 4, 36, 56, 24);
    for (let y = 8; y < 32; y += 4) c.R(4, y, 24, 1, mix(ASPHALT_D, INK, (y - 8) / 30));
    for (let x = 30; x < 60; x += 4) c.R(x, 36, 2, 24, mix(ASPHALT, INK, (x - 30) / 50));
    for (const y of [14, 22]) c.blot(12, y, 8, 5, (i, j) => Math.abs(i - 3.5) <= j * 0.8, YELLOW, null);
    c.box(8, 40, 14, 14, '#2f6bff'); c.R(12, 43, 2, 8, WHITE); c.R(14, 43, 3, 1, WHITE); c.R(14, 46, 3, 1, WHITE); c.R(17, 44, 1, 2, WHITE);
    frame(c, t);
  } },
  sub_dock: { over(c, t) {
    platform(c, t); c.box(4, 8, 56, 20, WATER[0]); sea(c, 5, 9, 54, 18);
    c.blot(10, 12, 42, 11, (i, j) => { const hw = 5.5 * (i < 6 ? Math.sqrt(i / 6) : i > 34 ? Math.sqrt(Math.max(0, (42 - i) / 8)) : 1); return Math.abs(j - 5) <= hw; }, '#2e374d');
    c.box(24, 14, 8, 7, '#3b4050'); c.R(26, 16, 4, 1, YELLOW); c.R(0, 0, 64, 4, shade(t, 1.0)); hazard(c, 4, 4, 56, 2);
    frame(c, t);
  } },

  // ---- shops and services
  vending: { over(c, t) { roof(c, t); ICON.bottle(c, 16, 16); } },
  kiosk: { over(c, t) { roof(c, t); ICON.info(c, 16, 16); } },
  atm: { over(c, t) { roof(c, t); awnings(c, '#5fc23a', WHITE); ICON.cash(c, 16, 14); } },
  coffee_cart: { over(c, t) { platform(c, t); c.box(6, 18, 20, 10, WOOD_L); parasol(c, 16, 14, 11, t, WHITE); frame(c, t); } },
  souvenir_cart: { over(c, t) { platform(c, t); c.box(5, 17, 22, 11, '#ff9cec'); ICON.gift(c, 22, 24); parasol(c, 14, 13, 10, t, YELLOW); frame(c, t); } },
  newsstand: { over(c, t) { shop(c, t, ICON.news, { awn: '#2f6bff', at: [48, 15] }); for (let x = 6; x < 30; x += 7) c.box(x, 8, 5, 7, [WHITE, YELLOW, '#ff9cec', '#35d4ff'][(x - 6) / 7]); } },
  food_stand: { over(c, t) { shop(c, t, ICON.hotdog, { at: [22, 14] }); } },
  coffee: { over(c, t) { shop(c, t, ICON.cup, { awn: '#6b3e24', alt: '#fff1c8', at: [16, 15] }); ICON.cup(c, 48, 15); } },
  currency: { over(c, t) { shop(c, t, ICON.coins, { awn: '#5fc23a', at: [18, 14] }); } },
  restroom: { over(c, t) { roof(c, t); hvac(c, 6, 6); hvac(c, 52, 52); skylight(c, 40, 6, 16, 10); ICON.wc(c, 22, 44); } },
  burger: { over(c, t) { shop(c, t, ICON.burger, { at: [16, 46] }); hvac(c, 6, 6); } },
  pizza: { over(c, t) { shop(c, t, ICON.pizza, { awn: '#2f9a3f', at: [48, 16] }); } },
  clothing: { over(c, t) { shop(c, t, ICON.shirt, { awn: '#ff4fd8', at: [48, 16] }); skylight(c, 8, 38, 18, 8); } },
  sports_bar: { over(c, t) { shop(c, t, ICON.ball, { awn: '#2f6bff', at: [48, 44] }); c.box(8, 8, 18, 10, INK); c.R(10, 10, 14, 6, '#35d4ff'); c.box(70, 8, 18, 10, INK); c.R(72, 10, 14, 6, '#5fc23a'); } },
  cafeteria: { over(c, t) { shop(c, t, ICON.tray, { awn: '#ffd23f', alt: RED, at: [20, 14] }); for (let x = 72; x < 180; x += 36) skylight(c, x, 6, 20, 10); ICON.tray(c, 160, 14); } },
  art_gallery: { over(c, t) { roof(c, t); for (let x = 8; x < 92; x += 14) skylight(c, x, 6, 10, 20); skylight(c, 38, 36, 20, 20); ICON.frame(c, 48, 46); } },
  lounge: { over(c, t) { shop(c, t, ICON.cocktail, { awn: '#1a1033', alt: YELLOW, at: [48, 46] }); skylight(c, 6, 6, 20, 16); skylight(c, 70, 70, 20, 16); } },
  designer: { over(c, t) { shop(c, t, ICON.diamond, { awn: INK, alt: YELLOW, at: [16, 46] }); skylight(c, 6, 6, 20, 20); } },
  security: { over(c, t) { roof(c, t); hazard(c, 3, 3, 26, 3); ICON.shield(c, 16, 46); hvac(c, 44, 40); c.box(6, 12, 20, 10, '#2e374d'); c.R(8, 14, 16, 6, '#35d4ff'); } },
  nanofab: { over(c, t) { roof(c, t); ICON.atom(c, 16, 46); for (const [x, y] of [[6, 6], [40, 38]]) { c.box(x, y, 18, 18, '#1a1033'); c.ring(x + 9, y + 9, 6, 1, '#ff4fd8'); c.disc(x + 9, y + 9, 2, '#35d4ff'); } } },
  drone_swarm: { over(c, t) { roof(c, t); hazard(c, 3, 3, 58, 2); for (const [x, y] of [[16, 16], [48, 16]]) { c.ring(x, y, 10, 1, YELLOW); ICON.drone(c, x, y); } } },

  // ---- walk-on tiles: art on the floor, the crowd over it
  guard: { floor(c, t) {
    platform(c, t); c.box(10, 12, 12, 8, '#2e374d'); c.R(11, 13, 10, 2, '#35d4ff'); c.disc(16, 24, 3, INK); c.disc(16, 24, 2, '#2f6bff');
    for (const [x, y] of [[3, 3], [27, 3], [3, 27], [27, 27]]) c.box(x, y, 2, 2, YELLOW);
    frame(c, t);
  } },
  gate: { floor(c, t) {
    // the fence runs between the two cells: a scanner arch straddles it, a
    // bag belt beside it
    platform(c, t); c.R(24, 0, 16, 32, mix('#2e374d', t, 0.2)); for (let y = 2; y < 32; y += 4) c.R(26, y, 12, 1, '#3b4050');
    c.box(22, 12, 20, 8, STEEL_D); c.R(24, 14, 16, 4, '#1a1033'); c.R(30, 14, 4, 4, '#5fc23a');
    c.box(2, 6, 18, 20, '#3b4050'); for (let y = 8; y < 26; y += 3) c.R(3, y, 16, 1, '#2e374d'); c.box(6, 10, 8, 5, '#ff9cec');
    c.box(46, 8, 14, 16, '#2e374d'); c.R(48, 10, 10, 5, '#35d4ff'); frame(c, t);
  } },
  flier_club: { floor(c, t) {
    carpet(c, mix('#3b2a5a', t, 0.35), shade(t, 0.8));
    for (const [x, y] of [[8, 8], [8, 40], [40, 40], [70, 8]]) { c.box(x, y, 8, 8, '#8a2a4a'); c.box(x + 12, y, 8, 8, '#8a2a4a'); c.disc(x + 10, y + 12, 3, WOOD_L); }
    c.box(40, 6, 24, 10, WOOD); c.R(42, 8, 20, 2, YELLOW); c.box(70, 40, 18, 18, '#2f7a3f'); c.disc(79, 49, 6, GRASS[2]);
    kerb(c, t);
  } },
  chrono_lounge: { floor(c, t) {
    c.fill('#1a1033'); for (let y = 0; y < 64; y += 8) c.R(0, y, 64, 1, '#34216b'); for (let x = 0; x < 64; x += 8) c.R(x, 0, 1, 64, '#34216b');
    ICON.clock(c, 32, 32);
    for (const [x, y] of [[4, 4], [48, 4], [4, 48], [48, 48]]) { c.box(x, y, 12, 12, '#4b2f8f'); c.ring(x + 6, y + 6, 4, 1, '#35d4ff'); }
    kerb(c, t);
  } },
  waiting_area: { floor(c, t) {
    carpet(c, mix(t, '#6a6440', 0.35), shade(t, 0.9));
    for (const y of [8, 22, 38, 52]) for (let x = 5; x < 60; x += 7) { if (x > 26 && x < 36) continue; c.box(x, y, 5, 4, '#3f6fd6'); c.R(x, y + (y % 16 < 8 ? 0 : 3), 5, 1, '#6f9cff'); }
    c.disc(32, 32, 4, WOOD_D); c.disc(32, 31, 3, '#5fc23a');
    kerb(c, t);
  } },
  green_space: {
    floor(c, t) {
      grass(c); c.R(0, 29, 64, 6, '#d8c89a'); c.R(29, 0, 6, 64, '#d8c89a');
      c.disc(32, 32, 8, '#d8c89a'); c.disc(32, 32, 5, t); c.disc(32, 32, 2, '#ff4fd8');
      for (const [x, y, r] of TREES_O4) treeShadow(c, x, y, r);
      bench(c, 38, 22); bench(c, 16, 40);
      kerb(c, t);
    },
    over(c) { for (const [x, y, r] of TREES_O4) tree(c, x, y, r); },
  },
  pocket_park: {
    floor(c, t) { grass(c); c.R(0, 13, 32, 6, '#d8c89a'); bench(c, 18, 22); c.disc(8, 25, 3, '#ff4fd8'); c.disc(8, 25, 1, YELLOW); treeShadow(c, 10, 8, 7); kerb(c, t); },
    over(c) { tree(c, 10, 8, 7); },
  },
  wifi: { floor(c, t) {
    paving(c, mix('#dde8f0', t, 0.3), mix('#a8c0d0', t, 0.4)); c.box(12, 16, 8, 8, '#2e374d'); c.R(14, 18, 4, 1, '#5fc23a'); ICON.wifi(c, 16, 8); kerb(c, t);
  } },
  walkway: { floor(c, t) {
    c.fill('#5a5e70');
    for (const [y0, dir] of [[3, 1], [17, -1]]) {
      c.box(0, y0, 128, 12, '#3b3f4d');
      for (let x = 0; x < 128; x += 2) c.R(x, y0 + 1, 1, 10, '#454a5a');
      for (let x = 6; x < 128; x += 16) for (let j = 0; j < 4; j++) { const xx = dir > 0 ? x + j : x + 3 - j; c.P(xx, y0 + 2 + j, YELLOW); c.P(xx, y0 + 9 - j, YELLOW); }
    }
    c.R(0, 15, 128, 2, t); kerb(c, t, 1);
  } },
};
const TREES_O4 = [[12, 12, 8], [51, 13, 7], [13, 50, 7], [50, 51, 8]];

// Stairs down into a station: steps darkening as they go, rails either side,
// and a glass canopy over the top of the flight.
function stairs(c, t, x, y, w, h, flip = false) {
  c.box(x, y, w, h, '#2e374d');
  for (let i = 0; i < w - 2; i += 3) { const k = flip ? w - 3 - i : i; c.R(x + 1 + k, y + 1, 2, h - 2, mix(STEEL, INK, i / w * 0.9)); }
  c.R(x, y + 2, w, 1, YELLOW); c.R(x, y + h - 3, w, 1, YELLOW);
  c.R(x, y - 3, w, 2, shade(t, 1.1));
}
// ---- PNG --------------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(c) {
  const { W, H, px } = c;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = px[y * W + x];
    if (v && v.startsWith('#')) raw.set([...hex(v), 255], y * (1 + W * 4) + 1 + x * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --sheet <file>: also write every tile at 3x, floor under over, on one contact
// sheet, so the drawings can be looked over without the game.
function contact(file) {
  const Z = 3, pad = 8, cols = 1200;
  const items = Object.keys(TILES).map(key => {
    const def = tileDef(key), tint = colorForDef(def), c = sheet(def.shape);
    for (const layer of ['floor', 'over']) if (TILES[key][layer]) TILES[key][layer](c, tint, def);
    return c;
  });
  let x = pad, y = pad, rowH = 0; const at = [];
  for (const c of items) { if (x + c.W * Z > cols) { x = pad; y += rowH + pad; rowH = 0; } at.push([x, y]); x += c.W * Z + pad; rowH = Math.max(rowH, c.H * Z); }
  const out = { W: cols, H: y + rowH + pad, px: new Array(cols * (y + rowH + pad)).fill('#3f9b3f') };
  items.forEach((c, k) => { for (let j = 0; j < c.H * Z; j++) for (let i = 0; i < c.W * Z; i++) { const v = c.px[Math.floor(j / Z) * c.W + Math.floor(i / Z)]; if (v) out.px[(at[k][1] + j) * cols + at[k][0] + i] = v; } });
  writeFileSync(file, png(out));
}
const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) { contact(process.argv[sheetAt + 1]); process.argv.splice(sheetAt, 2); }

const dir = resolve(root, 'assets/tiles');
mkdirSync(dir, { recursive: true });
const want = process.argv.slice(2);
let n = 0;
for (const [key, art] of Object.entries(TILES)) {
  if (want.length && !want.includes(key)) continue;
  const def = tileDef(key), tint = colorForDef(def);
  for (const [layer, suffix] of [['floor', '_floor'], ['over', '']]) {
    if (!art[layer]) continue;
    const c = sheet(def.shape); art[layer](c, tint, def);
    writeFileSync(resolve(dir, key + suffix + '.png'), png(c)); n++;
  }
}
// The manifest lists every tile this file draws, whichever were asked for, so a
// partial run never drops the rest from the game. The paths stay literal
// strings: the bundler finds and inlines them by pattern.
const list = layer => Object.keys(TILES).filter(k => TILES[k][layer]).map(k => `  ${k}: 'assets/tiles/${k}${layer === 'floor' ? '_floor' : ''}.png',`).join('\n');
writeFileSync(resolve(root, 'src/ui/tilesprites.js'), `// Written by harness/tileart.mjs from its TILES table; rerun it rather than editing.
// See src/ui/sprites.js for what the two layers are.
export const SPRITES = {
${list('over')}
};
export const SPRITES_FLOOR = {
${list('floor')}
};
`);
console.log(`wrote ${n} tile layers to assets/tiles/ and the manifest to src/ui/tilesprites.js`);
