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
const SHADE = '#0a052060';   // a shadow cast on nothing drawn: see-through

// ---- canvas -----------------------------------------------------------------
// One sheet per layer, clipped to the tile's footprint so nothing spills into
// the empty corner of an L or a T. `pad` ([top, right, bottom, left], in cells)
// adds a band round the bounding box for art that lies past the board's edge:
// coordinates stay those of the bounding box, so the band is at negative x or y,
// or past W or H. `block` marks a rectangle of the over layer that stands up off
// the ground (see SPRITE_BLOCKS in sprites.js).
function sheet(shape, pad = [0, 0, 0, 0]) {
  const cells = SHAPES[shape][0];
  const cw = Math.max(...cells.map(c => c[0])) + 1, ch = Math.max(...cells.map(c => c[1])) + 1;
  const W = cw * CELL, H = ch * CELL;
  const ox = pad[3] * CELL, oy = pad[0] * CELL, IW = W + (pad[1] + pad[3]) * CELL, IH = H + (pad[0] + pad[2]) * CELL;
  const set = new Set(cells.map(([x, y]) => x + ',' + y));
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && set.has(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
  const inBand = (x, y) => x >= -ox && y >= -oy && x < IW - ox && y < IH - oy && !(x >= 0 && y >= 0 && x < W && y < H);
  const px = new Array(IW * IH).fill(null), blocks = [];
  // distance in pixels to the edge of the footprint, along the axes (capped)
  const dist = new Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y)) continue;
    let d = 0;
    while (d < 12 && inside(x - d - 1, y) && inside(x + d + 1, y) && inside(x, y - d - 1) && inside(x, y + d + 1)) d++;
    dist[y * W + x] = d;
  }
  const P = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (c && (inside(x, y) || inBand(x, y))) px[(y + oy) * IW + x + ox] = c; };
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
  // darken what is already drawn: shadows on the floor. Where nothing is drawn
  // (the band past the edge) the shadow is a see-through wash over the strip.
  const darkAt = (i, j, f) => { const k = (j + oy) * IW + i + ox; if (inside(i, j) || inBand(i, j)) px[k] = px[k] ? shade(px[k], f) : SHADE; };
  const dark = (x, y, w, h, f) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) darkAt(i, j, f); };
  // every pixel of the band past the bounding box
  const band = fn => { for (let y = -oy; y < IH - oy; y++) for (let x = -ox; x < IW - ox; x++) if (inBand(x, y)) fn(x, y); };
  // a raised part: it stands from z0 to z1, in units of tile height; a round one
  // bulges and narrows as it rises (a tree top, a balloon) instead of a drum
  const block = (x, y, w, h, z1, z0 = 0, round = false) => blocks.push([x + ox, y + oy, w, h, z0, z1, ...(round ? [1] : [])]);
  // a part of the floor that steps down into the ground (see SPRITE_SINKS)
  const sinks = [], sink = (x, y, w, h, d0, d1, dir, n) => sinks.push([x + ox, y + oy, w, h, d0, d1, dir, n]);
  return { W, H, IW, IH, ox, oy, cells, px, inside, dist, P, R, S, fill, rim, each, disc, ring, blot, box, cellOn, band, block, blocks, dark, darkAt, sink, sinks };
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
// A trunk and its shadow on the floor, and a canopy over it: a park's trees.
function treeShadow(c, x, y) { c.R(x, y, 2, 2, WOOD_D); }
function tree(c, x, y, r) {
  c.disc(x, y, r + 1, INK); c.disc(x, y, r, GRASS[0]);
  c.disc(x - 1, y - 1, r - 2, GRASS[1]); c.disc(x - 2, y - 2, Math.max(1, r - 5), GRASS[3]);
  c.block(x - r - 1, y - r - 1, 2 * r + 3, 2 * r + 3, 0.4, 0.16, true);
}
function bench(c, x, y, v = false) { v ? c.box(x, y, 3, 10, WOOD_L) : c.box(x, y, 10, 3, WOOD_L); }
// A parasol seen from above: a disc of alternating gores.
function parasol(c, cx, cy, r, a, b) {
  c.disc(cx, cy, r + 1, INK);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.8) c.P(cx + x, cy + y, Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 4)) % 2 ? a : b);
  c.disc(cx, cy, 1, WHITE);
}
// The shadow a vehicle or a building casts on the floor under it.
function shadow(c, x, y, w, h) { c.dark(x + 1, y + 2, w, h, 0.62); }

// ---- vehicles (top-down, nose to the right) ---------------------------------------
// Each registers its own block, so it stands up off the floor; `z` is its height.
function car(c, x, y, col, v = false, z = 0.14) {
  const L = 15, D = 8;
  const test = (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === D - 1));
  const paint = (i, j) => i === L - 1 && (j === 1 || j === D - 2) ? '#fff1a8' : i === 10 || i === 11 ? GLASS : i === 3 ? GLASS_D : i > 3 && i < 10 ? shade(col, 0.82) : col;
  v ? c.blot(x, y, D, L, (i, j) => test(j, i), (i, j) => paint(j, i)) : c.blot(x, y, L, D, test, paint);
  v ? c.block(x - 1, y - 1, D + 2, L + 2, z) : c.block(x - 1, y - 1, L + 2, D + 2, z);
}
function bus(c, x, y, len, col, stripe = WHITE) {
  c.blot(x, y, len, 12, (i, j) => !((i === 0 || i === len - 1) && (j === 0 || j === 11)), (i, j) =>
    i >= len - 3 ? GLASS : (j === 1 || j === 10) ? ((i % 6) ? GLASS : shade(col, 0.7)) : (j === 5 || j === 6) ? stripe : col);
  for (let i = x + 8; i < x + len - 10; i += 14) c.box(i, y + 3, 5, 5, STEEL);
  c.block(x - 1, y - 1, len + 2, 14, 0.28);
}
// A train car seen from above: roof, a lit stripe, roof boxes, glass at a nose.
function carriage(c, x, y, len, w, body, stripe, { nose = false, tail = false, z = 0.26, z0 = 0 } = {}) {
  const r = Math.floor(w / 2);
  c.blot(x, y, len, w, (i, j) => {
    const dy = Math.abs(j - (w - 1) / 2);
    if (nose && i > len - r) return dy <= Math.sqrt(Math.max(0, r * r - (i - (len - r)) ** 2)) + 0.5;
    if (tail && i < r) return dy <= Math.sqrt(Math.max(0, r * r - (r - i) ** 2)) + 0.5;
    return true;
  }, (i, j) => (nose && i > len - r - 3 && Math.abs(j - (w - 1) / 2) < r - 1) ? GLASS : Math.abs(j - (w - 1) / 2) < 1 ? stripe : body);
  for (let i = x + 6; i < x + len - 8; i += 12) c.R(i, y + 2, 5, 2, shade(body, 0.8));
  c.block(x - 1, y - 1, len + 2, w + 2, z, z0);
}
function train(c, x, y, len, cars, w, body, stripe, { both = false, z, z0 } = {}) {
  const each = Math.floor((len - (cars - 1)) / cars);
  for (let k = 0; k < cars; k++) carriage(c, x + k * (each + 1), y, k === cars - 1 ? len - k * (each + 1) : each, w, body, stripe, { nose: k === cars - 1, tail: both && k === 0, z, z0 });
}
// A hull pointed at the bow, with a deck inset and a cabin that stands above it.
function boat(c, x, y, len, w, hull, deck, cabin = null, z = 0.1) {
  const bow = Math.min(Math.floor(len / 3), w + 2), cy = (w - 1) / 2;
  const test = (L, W0) => (i, j) => { const hw = W0 / 2 * (i > L - bow ? Math.max(0, (L - i) / bow) ** 0.7 : 1); return Math.abs(j - (W0 - 1) / 2) <= hw - 0.3; };
  c.blot(x, y, len, w, test(len, w), hull);
  c.blot(x + 2, y + 2, len - 5, w - 4, test(len - 5, w - 4), deck, null);
  c.block(x - 1, y - 1, len + 2, w + 2, z);
  if (cabin) {
    const [cx0, cw, col] = cabin, top = y + Math.round(cy) - Math.floor((w - 6) / 2);
    c.box(x + cx0, top, cw, w - 6, col); c.R(x + cx0 + cw - 2, top, 2, w - 6, GLASS);
    c.block(x + cx0 - 1, top - 1, cw + 2, w - 4, z + 0.08, z);
  }
}
// An aircraft from above: fuselage, swept wings, tailplane. Box is len x span.
// It flies, or sits high on its gear: the block floats a thin slab off the floor.
function plane(c, x, y, len, span, body, trim, down = false, z = 0.16) {
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
  down ? c.block(x - 1, y - 1, span + 2, len + 2, z, z - 0.06) : c.block(x - 1, y - 1, len + 2, span + 2, z, z - 0.06);
}
// An oval cabin with its glass at the nose (-x), a tail boom and a fin.
function heli(c, cx, cy, col) {
  c.R(cx + 4, cy - 1, 16, 3, INK); c.R(cx + 5, cy, 14, 1, shade(col, 0.8)); c.R(cx + 18, cy - 4, 3, 9, INK);
  c.blot(cx - 12, cy - 6, 20, 13, (i, j) => ((i - 9.5) / 10) ** 2 + ((j - 6) / 6.5) ** 2 <= 1, (i, j) => i < 7 && ((i - 6) / 6) ** 2 + ((j - 6) / 4.5) ** 2 <= 1 ? GLASS : col);
  c.block(cx - 13, cy - 7, 35, 15, 0.18, 0.07);
  // the rotor turns over the body, flat at the top of the pad's box
  for (let i = -17; i <= 17; i++) { c.P(cx + i, cy + Math.round(i * 0.35), '#2e374d'); c.P(cx - Math.round(i * 0.35), cy + i, '#2e374d'); }
  c.disc(cx, cy, 1, STEEL);
}
// A small building standing on part of a transport: its roof, raised as a block.
function hut(c, t, x, y, w, h, z = 0.36) {
  c.box(x, y, w, h, shade(t, 0.88)); c.R(x + 1, y + 1, w - 1, 2, shade(t, 1.2));
  c.block(x - 1, y - 1, w + 2, h + 2, z);
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
  // Transports are glass boxes: the ground they work on is the floor, with the
  // crowd on it, and the top holds only what stands over it - shelters, signs -
  // plus the vehicles, raised as blocks.
  // ---- road
  bus_stop: {
    floor(c, t) { platform(c, t); roadStrip(c, t, 18); shadow(c, 7, 19, 50, 12); frame(c, t); },
    over(c, t) {
      c.box(8, 3, 26, 9, mix(GLASS, t, 0.35)); c.R(9, 4, 25, 2, shade(t, 1.1)); for (let x = 15; x < 34; x += 6) c.R(x, 6, 1, 6, mix(GLASS_D, t, 0.3));
      c.box(44, 4, 4, 4, YELLOW); bus(c, 7, 19, 50, t);
    },
  },
  bike_rental: {
    floor(c, t) {
      platform(c, t); roadStrip(c, t, 22);
      for (let x = 6; x < 58; x += 7) { c.box(x, 10, 4, 9, STEEL_D); c.ring(x + 1, 11, 2, 1, INK); c.ring(x + 1, 17, 2, 1, INK); c.P(x + 2, 14, t); }
      c.box(48, 24, 8, 5, YELLOW); frame(c, t);
    },
    over(c, t) { c.box(3, 2, 58, 6, shade(t, 1.0)); c.R(4, 3, 57, 1, shade(t, 1.3)); },
  },
  taxi_stand: {
    floor(c, t) { platform(c, t); roadStrip(c, t, 16); for (const x of [4, 24, 44]) shadow(c, x, 20, 15, 8); frame(c, t); },
    over(c, t) {
      c.box(4, 3, 10, 8, t); c.R(6, 5, 6, 4, YELLOW); c.R(8, 6, 2, 2, INK);
      for (const x of [4, 24, 44]) { car(c, x, 20, YELLOW); c.box(x + 5, 22, 4, 3, INK); }
    },
  },
  rideshare: {
    floor(c, t) {
      platform(c, t); tarmac(c, t, 3, 3, 26, 58); tarmac(c, t, 3, 35, 58, 26);
      for (let y = 8; y < 30; y += 12) c.R(3, y, 26, 1, PAINT);
      for (const [x, y] of [[8, 10], [8, 22], [34, 44], [12, 44]]) shadow(c, x, y, 15, 8);
      frame(c, t);
    },
    over(c, t) { car(c, 8, 10, '#2e374d'); car(c, 8, 22, WHITE); car(c, 34, 44, t); car(c, 12, 44, '#9b5cff'); c.box(40, 38, 10, 4, '#ff4fd8'); },
  },
  car_rental: {
    floor(c, t) {
      platform(c, t); tarmac(c, t, 0, 30, 64, 34);
      for (let x = 4; x < 64; x += 15) c.R(x, 32, 1, 28, PAINT);
      for (const x of [6, 21, 36, 51]) shadow(c, x, 36, 8, 15);
      shadow(c, 3, 3, 58, 22); frame(c, t);
    },
    over(c, t) {
      hut(c, t, 3, 3, 58, 22); hvac(c, 50, 9); c.box(8, 10, 22, 8, WHITE); c.R(10, 12, 18, 1, t); c.R(10, 15, 12, 1, t);
      car(c, 6, 36, RED, true); car(c, 21, 36, WHITE, true); car(c, 36, 36, '#35d4ff', true); car(c, 51, 36, '#2e374d', true);
    },
  },
  limo: {
    floor(c, t) { platform(c, t); roadStrip(c, t, 16); c.R(0, 12, c.W, 2, RED); shadow(c, 20, 18, 58, 10); frame(c, t); },
    over(c, t) {
      c.box(10, 3, 76, 8, shade(t, 0.95)); c.R(11, 4, 75, 2, shade(t, 1.25)); for (let x = 14; x < 84; x += 8) c.P(x, 8, YELLOW);
      const L = 58; c.blot(20, 18, L, 10, (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === 9)), (i, j) => i > L - 13 && i < L - 9 ? GLASS_D : i > 6 && i < L - 16 ? (j === 0 || j === 9 ? '#2e374d' : '#1a1a24') : '#22222e');
      c.R(26, 19, 28, 1, '#6c6880'); c.block(19, 17, L + 2, 12, 0.15);
    },
  },
  parking_lot: {
    floor(c, t) {
      tarmac(c, t);
      for (let x = 1; x < 64; x += 15) { c.R(x, 3, 1, 22, PAINT); c.R(x, 39, 1, 22, PAINT); }
      for (let x = 6; x < 60; x += 8) c.R(x, 32, 4, 1, YELLOW);
      for (const [x, y] of PARKED) shadow(c, x, y, 8, 15);
      kerb(c, t);
    },
    over(c) { PARKED.forEach(([x, y], i) => car(c, x, y, [RED, '#35d4ff', WHITE, YELLOW, '#9b5cff'][i], true)); },
  },

  // ---- rail and corridor: an edge station's train waits on the line past the edge
  train_station: {
    pad: [0, 0, 1, 0],
    floor(c, t) { platform(c, t); c.R(0, 29, c.W, 1, YELLOW); frame(c, t); },
    over(c, t) { canopy(c, t, 20); train(c, 2, 40, 124, 3, 11, WHITE, t); },
  },
  express_train: {
    pad: [0, 0, 1, 0],
    floor(c, t) { platform(c, t); c.R(0, 29, c.W, 1, YELLOW); frame(c, t); },
    over(c, t) { canopy(c, t, 24); train(c, 2, 40, 156, 4, 11, '#e6e6f0', RED); },
  },
  tram_stop: {
    lane: { floor(c) { rails(c, 17, 26); } },
    floor(c, t) { platform(c, t); c.R(0, 14, c.W, 16, mix('#9a94b2', t, 0.25)); c.R(0, 17, c.W, 1, STEEL_D); c.R(0, 26, c.W, 1, STEEL_D); shadow(c, 6, 16, 84, 12); frame(c, t); },
    over(c, t) {
      c.box(4, 2, 40, 7, shade(t, 1.0)); c.R(5, 3, 39, 1, shade(t, 1.3)); c.box(52, 2, 40, 7, shade(t, 1.0)); c.R(53, 3, 39, 1, shade(t, 1.3));
      train(c, 6, 16, 84, 3, 12, t, WHITE, { both: true, z: 0.24 });
    },
  },
  monorail: {
    // the beam runs on out along the lane on a post a square
    lane: { floor: laneFloor, over(c) { c.block(13, 19, 6, 6, 0.1); beam(c, 0, 32); } },
    floor(c, t) { platform(c, t); frame(c, t); },
    over(c, t) {
      for (let x = 8; x < c.W; x += 30) c.box(x, 1, 10, 7, shade(t, 1.0));
      // the guideway beam, and the pod riding on top of it
      for (let x = 13; x < c.W; x += 32) c.block(x, 19, 6, 6, 0.1);
      beam(c, 0, c.W);
      const w = 14; c.blot(8, 15, 112, w, (i, j) => { const d = Math.abs(j - (w - 1) / 2), r = w / 2; return i < r ? d <= Math.sqrt(r * r - (r - i) ** 2) : i > 112 - r ? d <= Math.sqrt(Math.max(0, r * r - (i - 112 + r) ** 2)) : true; },
        (i, j) => j === 1 || j === w - 2 ? ((i % 7) ? GLASS : WHITE) : Math.abs(j - (w - 1) / 2) < 1.5 ? t : WHITE);
      c.block(7, 14, 114, w + 2, 0.36, 0.16);
    },
  },
  ski_lift: {
    lane: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 4, 9, 8, 6, 0.1); gondola(c, t, 20, 22, 8, 6, 0.1); } },
    floor(c, t) { snow(c); frame(c, t); },
    over(c, t) { lift(c, t, 16, 8, 6, 0.1); },
  },
  alpine_lift: {
    lane: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 2, 10, 12, 9, 0.14); gondola(c, t, 18, 21, 12, 9, 0.14); } },
    floor(c, t) { snow(c); for (const [x, y] of [[40, 4], [96, 22], [130, 6]]) c.blot(x - 3, y - 3, 7, 7, (i, j) => Math.abs(i - 3) + Math.abs(j - 3) <= 3, '#2f7a3f'); frame(c, t); },
    over(c, t) { lift(c, t, 26, 12, 9, 0.14); },
  },

  // ---- water
  ferry: {
    // the long arm is a slip with the ferry in it, the foot the terminal
    floor(c, t) {
      sea(c, 0, 0, 32, 96); c.R(0, 0, 3, 96, WOOD_L); c.R(29, 0, 3, 64, WOOD_L); c.R(0, 0, 32, 3, WOOD_L);
      for (let y = 8; y < 96; y += 14) { c.R(0, y, 3, 2, WOOD_D); c.R(29, y, 3, 2, WOOD_D); }
      platform({ ...c, each: fn => c.each((x, y, d) => x >= 32 && fn(x, y, d)) }, t); c.R(29, 76, 4, 8, WOOD_L);
      frame(c, t);
    },
    over(c, t) {
      c.blot(5, 6, 22, 84, (i, j) => { const b = 12; const hw = 11 * (j < b ? Math.max(0, j / b) ** 0.7 : j > 84 - 6 ? (84 - j) / 6 : 1); return Math.abs(i - 10.5) <= hw; }, WHITE);
      c.block(4, 5, 24, 86, 0.14);
      c.box(9, 26, 14, 40, '#e6e6f0'); for (let y = 30; y < 64; y += 5) { c.P(9, y, GLASS_D); c.P(22, y, GLASS_D); }
      c.box(11, 22, 10, 5, GLASS); c.box(13, 44, 6, 6, RED); c.block(8, 21, 16, 46, 0.3, 0.14);
      c.R(10, 72, 12, 2, RED);
      hut(c, t, 33, 65, 30, 30); hvac(c, 52, 72); for (let y = 72; y < 92; y += 6) c.R(36, y, 12, 3, GLASS);
    },
  },
  water_taxi: {
    pad: [0, 0, 1, 0],
    floor(c, t) { platform(c, t); c.R(0, 27, c.W, 3, WOOD_L); c.R(0, 30, c.W, 2, WOOD_D); frame(c, t); },
    over(c, t) { c.box(6, 3, 14, 7, shade(t, 1.0)); c.R(8, 5, 10, 3, YELLOW); boat(c, 10, 38, 30, 11, YELLOW, WHITE, [8, 9, WHITE]); boat(c, 44, 40, 18, 9, t, WHITE); },
  },
  water_bus: {
    floor(c, t) { platform(c, t); seaStrip(c, 12); frame(c, t); },
    over(c, t) { c.box(38, 2, 22, 7, shade(t, 1.0)); c.R(39, 3, 21, 1, shade(t, 1.3)); boat(c, 6, 15, 52, 15, t, WHITE, [10, 30, '#e6e6f0']); },
  },
  pontoon: {
    floor(c, t) {
      sea(c);
      c.R(28, 0, 8, 64, WOOD_L); for (let y = 2; y < 64; y += 4) c.R(28, y, 8, 1, WOOD);
      for (const y of [12, 40]) { c.R(4, y, 56, 5, WOOD_L); for (let x = 6; x < 60; x += 4) c.R(x, y, 1, 5, WOOD); }
      kerb(c, t);
    },
    over(c, t) { boat(c, 5, 20, 20, 9, WHITE, '#e6e6f0', null, 0.07); boat(c, 38, 21, 22, 9, t, WHITE, null, 0.07); boat(c, 5, 49, 18, 9, RED, WHITE, null, 0.07); boat(c, 39, 49, 20, 9, WHITE, '#e6e6f0', null, 0.07); },
  },
  marina: {
    floor(c, t) {
      sea(c);
      c.R(0, 29, 96, 6, WOOD_L); for (let x = 2; x < 96; x += 4) c.R(x, 29, 1, 6, WOOD);
      for (const x of [8, 40, 56, 88]) c.R(x - 1, 0, 3, 64, WOOD_L);
      frame(c, t);
    },
    over(c, t) {
      boat(c, 44, 4, 10, 22, WHITE, '#e6e6f0'); boat(c, 60, 6, 26, 9, WHITE, '#e6e6f0', [8, 8, WHITE]); boat(c, 60, 17, 24, 9, t, WHITE);
      boat(c, 11, 40, 26, 10, WHITE, WOOD_L, [6, 9, WHITE]); boat(c, 11, 52, 24, 9, '#2e374d', WHITE); boat(c, 60, 44, 24, 12, WHITE, '#e6e6f0', [5, 10, WHITE]);
    },
  },
  cruise_dock: {
    // the quay is the tile; the ship lies alongside it, past the edge
    pad: [0, 0, 1, 0],
    floor(c, t) {
      platform(c, t); c.R(0, 28, c.W, 2, YELLOW); c.R(0, 30, c.W, 2, '#6c6880');
      for (let x = 8; x < c.W; x += 24) c.box(x, 24, 3, 3, '#2e374d');
      frame(c, t);
    },
    over(c, t) {
      c.box(10, 3, 40, 8, shade(t, 1.0)); c.R(11, 4, 39, 2, shade(t, 1.3)); c.box(120, 3, 40, 8, shade(t, 1.0)); c.R(121, 4, 39, 2, shade(t, 1.3));
      for (const x of [40, 130]) c.box(x, 14, 6, 20, STEEL);
      c.blot(4, 34, 184, 22, (i, j) => { const hw = 11 * (i > 150 ? Math.max(0, (184 - i) / 34) ** 0.6 : i < 4 ? 0.85 : 1); return Math.abs(j - 10.5) <= hw; }, WHITE);
      c.R(8, 44, 150, 2, '#35d4ff');
      c.block(3, 33, 186, 24, 0.3);
      c.box(20, 37, 120, 16, '#e6e6f0'); c.box(30, 39, 90, 12, WHITE);
      for (let x = 34; x < 118; x += 6) { c.P(x, 39, GLASS_D); c.P(x, 50, GLASS_D); }
      c.box(60, 41, 14, 8, '#35d4ff');
      c.block(19, 36, 122, 18, 0.5, 0.3);
      c.box(96, 40, 9, 10, RED); c.R(98, 42, 5, 6, INK); c.block(95, 39, 11, 12, 0.66, 0.5);
      c.box(142, 38, 8, 14, GLASS); c.block(141, 37, 10, 16, 0.4, 0.3);
    },
  },

  // ---- air and far-fetched
  helipad: {
    floor(c, t) {
      c.fill(mix('#5a5e70', t, 0.12)); c.ring(32, 32, 27, 2, YELLOW);
      c.R(22, 20, 4, 24, WHITE); c.R(38, 20, 4, 24, WHITE); c.R(26, 30, 12, 4, WHITE);
      for (const [x, y] of [[5, 5], [57, 5], [5, 57], [57, 57]]) c.box(x, y, 2, 2, '#ff9cec');
      frame(c, t);
    },
    over(c, t) { heli(c, 42, 46, t); },
  },
  balloon: {
    floor(c, t) {
      grass(c); c.ring(48, 18, 12, 1, '#d8c89a'); c.box(45, 16, 6, 6, WOOD);
      c.box(6, 6, 10, 10, WOOD_L); c.box(80, 8, 8, 8, WOOD_L); frame(c, t);
    },
    over(c, t) {
      // the envelope hangs high over its basket; the booth in the stem stands on the grass
      parasol(c, 48, 18, 17, t, YELLOW); c.ring(48, 18, 4, 1, shade(t, 0.6)); c.block(30, 0, 37, 37, 1.0, 0.45, true);
      hut(c, t, 38, 40, 20, 18, 0.3); c.R(42, 44, 12, 10, RED);
    },
  },
  jetway: {
    // The tip cell meets the apron and the airliner is parked nose-in past the
    // edge; the bridge runs down the stem into the terminal at the foot.
    pad: [1, 0, 0, 0],
    floor(c, t) { apronStrip(c, t, 0); c.R(15, 0, 2, 32, YELLOW); frame(c, t); },
    over(c, t) {
      plane(c, 1, -32, 50, 30, WHITE, '#3f8cff', true, 0.18);
      c.box(12, 20, 8, 30, '#d7cce8'); c.R(13, 21, 6, 28, STEEL); for (let y = 24; y < 48; y += 5) c.R(13, y, 6, 1, STEEL_D);
      c.box(12, 46, 22, 8, '#d7cce8'); c.R(13, 47, 20, 6, STEEL); c.block(11, 19, 24, 36, 0.22, 0.1);
      hut(c, t, 36, 36, 26, 26); for (let x = 40; x < 60; x += 6) c.R(x, 42, 3, 16, GLASS);
    },
  },
  jumbo_jetway: {
    pad: [1, 0, 0, 0],
    floor(c, t) { apronStrip(c, t, 0); c.R(15, 0, 2, 64, YELLOW); frame(c, t); },
    over(c, t) {
      plane(c, 0, -32, 70, 32, WHITE, '#9b5cff', true, 0.24);
      for (const x of [4, 20]) { c.box(x, 40, 7, 66, '#d7cce8'); c.R(x + 1, 41, 5, 64, STEEL); }
      c.box(4, 104, 32, 8, '#d7cce8'); c.R(5, 105, 30, 6, STEEL); c.block(3, 39, 34, 74, 0.26, 0.12);
      hut(c, t, 36, 98, 26, 28); for (let x = 40; x < 60; x += 6) c.R(x, 104, 3, 18, GLASS);
    },
  },
  prop_stand: {
    floor(c, t) { apronStrip(c, t, 0); c.R(0, 0, 64, 6, mix('#c4c0d4', t, 0.14)); c.R(0, 5, 64, 1, YELLOW); c.box(52, 22, 8, 6, YELLOW); frame(c, t); },
    over(c, t) { plane(c, 10, 4, 34, 28, '#e6e6f0', RED); },
  },
  hardstand: {
    floor(c, t) { apronStrip(c, t, 0); for (const [x, y] of [[8, 8], [54, 8], [8, 54], [54, 54]]) c.box(x, y, 2, 2, YELLOW); kerb(c, t); },
    over(c, t) { plane(c, 12, 14, 38, 34, WHITE, '#3f8cff'); },
  },
  private_terminal: {
    // the bar of the T meets the apron with a business jet at the stand; the
    // stem is the lounge
    floor(c, t) { apronStrip(c, t, 0); c.R(0, 30, 96, 2, RED); frame(c, t); },
    over(c, t) { plane(c, 14, 0, 58, 30, WHITE, YELLOW, false, 0.16); hut(c, t, 34, 32, 28, 30); skylight(c, 40, 40, 16, 8); c.box(38, 52, 20, 4, YELLOW); },
  },
  jetpack: {
    floor(c, t) { c.fill('#34216b'); for (const cx of [16, 48]) { c.disc(cx, 16, 12, INK); c.disc(cx, 16, 11, shade(t, 0.8)); c.ring(cx, 16, 9, 1, YELLOW); } frame(c, t); },
    over(c) { for (const cx of [16, 48]) { c.box(cx - 4, 12, 9, 9, STEEL); c.R(cx - 3, 13, 3, 7, RED); c.R(cx + 1, 13, 3, 7, RED); c.block(cx - 5, 11, 11, 11, 0.2); } },
  },
  beam_pad: {
    floor(c, t) {
      c.fill('#1a1033'); for (let y = 2; y < 64; y += 6) for (let x = (y % 12 ? 3 : 0); x < 64; x += 6) c.P(x, y, '#4b2f8f');
      for (const [r, col] of [[26, t], [21, '#ff9cec'], [16, t], [10, '#35d4ff'], [5, WHITE]]) c.ring(32, 32, r, 2, col);
      c.disc(32, 32, 3, '#35d4ff'); frame(c, t);
    },
  },
  loop_terminal: {
    floor(c, t) {
      c.fill(mix('#3b3452', t, 0.1)); c.ring(32, 32, 22, 6, '#1a1033'); c.ring(32, 32, 20, 1, '#35d4ff'); c.ring(32, 32, 16, 1, '#35d4ff');
      c.box(0, 28, 12, 9, '#1a1033'); c.box(52, 28, 12, 9, '#1a1033'); frame(c, t);
    },
    over(c, t) {
      for (const [x, y] of [[20, 10], [44, 50], [10, 40]]) { c.box(x - 4, y - 3, 12, 7, WHITE); c.R(x + 4, y - 2, 3, 5, GLASS); c.block(x - 5, y - 4, 14, 9, 0.12); }
      c.disc(32, 32, 7, shade(t, 0.9)); c.ring(32, 32, 7, 1, INK); c.block(24, 24, 17, 17, 0.3);
    },
  },

  // ---- underground: stairs down. The concourse stays at ground level and the
  // flight is cut into it, a step at a time (drawSinks in render.js).
  subway: {
    floor(c, t) { platform(c, t); flight(c, t, 4, 7, 36, 18, 'E', 6); frame(c, t); },
    over(c, t) { totem(c, t, 50, 12); },
  },
  express_subway: {
    floor(c, t) { platform(c, t); flight(c, t, 4, 7, 36, 18, 'E', 6); flight(c, t, 56, 7, 36, 18, 'W', 6); frame(c, t); },
    over(c, t) { totem(c, t, 45, 12, RED); },
  },
  under_parking: {
    // the ramp runs down the long arm into the garage; the foot is a set-down bay
    floor(c, t) {
      platform(c, t); tarmac(c, t, 34, 36, 26, 24); for (const x of [34, 47, 60]) c.R(x, 38, 1, 20, PAINT);
      ramp(c, t, 5, 3, 22, 48, 'S', 10); frame(c, t);
    },
    over(c, t) { car(c, 37, 41, WHITE, true); car(c, 50, 41, RED, true); totem(c, t, 18, 54, '#2f6bff'); },
  },
  sub_dock: {
    // the pool is one step down, the submarine riding in it
    floor(c, t) { platform(c, t); sea(c, 4, 9, 56, 19); c.sink(4, 9, 56, 19, 0.3, 0.3, 'S', 1); hazard(c, 4, 6, 56, 2); frame(c, t); },
    over(c) {
      c.blot(10, 13, 42, 11, (i, j) => { const hw = 5.5 * (i < 6 ? Math.sqrt(i / 6) : i > 34 ? Math.sqrt(Math.max(0, (42 - i) / 8)) : 1); return Math.abs(j - 5) <= hw; }, '#2e374d');
      c.block(9, 12, 44, 13, -0.2, -0.3);
      c.box(24, 15, 8, 7, '#3b4050'); c.R(26, 17, 4, 1, YELLOW); c.block(23, 14, 10, 9, 0.02, -0.2);
    },
  },

  // ---- shops and services
  vending: { over(c, t) { roof(c, t); ICON.bottle(c, 16, 16); } },
  kiosk: { over(c, t) { roof(c, t); ICON.info(c, 16, 16); } },
  atm: { over(c, t) { roof(c, t); awnings(c, '#5fc23a', WHITE); ICON.cash(c, 16, 14); } },
  // the carts are glass boxes too: the crowd round the cart shows under the parasol
  coffee_cart: { floor(c, t) { platform(c, t); c.box(6, 18, 20, 10, WOOD_L); c.R(8, 20, 5, 3, '#2e374d'); frame(c, t); }, over(c, t) { parasol(c, 16, 14, 11, t, WHITE); } },
  souvenir_cart: { floor(c, t) { platform(c, t); c.box(5, 17, 22, 11, '#ff9cec'); ICON.gift(c, 22, 24); frame(c, t); }, over(c, t) { parasol(c, 14, 13, 10, t, YELLOW); } },
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
  gate: {
    // The fence runs across the booth between its two cells, so the lane runs
    // the length of it: in one end, through the arch on the fence line, out the
    // other. The bag belt runs alongside, through its scanner.
    floor(c, t) {
      platform(c, t);
      c.R(0, 12, 64, 12, mix('#2e374d', t, 0.25)); c.R(0, 12, 64, 1, YELLOW); c.R(0, 23, 64, 1, YELLOW);
      for (const x of [8, 48]) for (let j = 0; j < 4; j++) { c.P(x + j, 15 + j, WHITE); c.P(x + j, 20 - j, WHITE); }
      c.box(2, 2, 60, 6, '#3b4050'); for (let x = 4; x < 62; x += 3) c.R(x, 3, 1, 4, '#2e374d');
      c.box(8, 3, 6, 4, '#ff9cec'); c.box(46, 3, 5, 4, '#35d4ff');
      c.box(40, 26, 12, 4, '#2e374d'); c.R(41, 27, 10, 2, '#35d4ff');
      frame(c, t);
    },
    over(c) {
      // the arch: a hollow frame, raised, so it stands as two posts and a bar
      c.box(28, 10, 8, 16, null); c.R(28, 10, 8, 2, STEEL_D); c.R(28, 24, 8, 2, STEEL_D); c.R(30, 12, 1, 12, '#5fc23a'); c.R(33, 12, 1, 12, '#5fc23a');
      c.block(27, 9, 10, 18, 0.42);
      // the bag scanner over the belt
      c.box(24, 1, 16, 8, STEEL_D); c.R(26, 3, 12, 4, '#1a1033'); c.block(23, 0, 18, 10, 0.3);
    },
  },
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
const PARKED = [[5, 5], [35, 5], [50, 5], [20, 41], [50, 41]];

// A shelter the length of a platform, glass panes let into it.
function canopy(c, t, step) {
  c.box(0, 2, c.W, 9, shade(t, 0.95)); c.R(0, 3, c.W, 2, shade(t, 1.25));
  for (let x = step / 2; x < c.W; x += step) c.R(x, 6, step / 2, 3, mix(GLASS, t, 0.25));
}
function snow(c) { c.each((x, y) => c.P(x, y, (x * 7 + y * 3) % 19 === 0 ? '#c8d8f0' : '#eef4ff')); }
// A lift: pylons at each end standing up, the two cables flat across the top of
// the box, and cars hanging under them, going out on one and back on the other.
function lift(c, t, step, w, h, z) {
  for (const x of [2, c.W - 12]) { c.box(x, 3, 10, 26, STEEL_D); c.R(x + 1, 12, 8, 8, t); c.block(x - 1, 2, 12, 28, 0.34); }
  cables(c, 12, c.W - 24);
  for (let x = 16; x < c.W - 16 - w; x += step) {
    for (const [cx, cy] of [[x, 9], [x + (step >> 1), 22]]) if (cx + w <= c.W - 14) gondola(c, t, cx, cy, w, h, z);
  }
}
// The two haul cables, strung at the height of the tile's top: thin floating
// blocks, so they carry on over the lane at the same height.
function cables(c, x = 0, w = c.W) { for (const y of [9, 22]) { c.R(x, y, w, 1, INK); c.block(x, y - 1, w, 3, 0.2, 0.185); } }
// A car hanging from the cable at row `cy`, going out on one and back on the other.
function gondola(c, t, cx, cy, w, h, z) { const y = cy - (h >> 1); c.box(cx, y, w, h, t); c.R(cx + 1, y + 1, w - 2, 1, GLASS); c.block(cx - 1, y - 1, w + 2, h + 2, 0.2, 0.2 - z); }
// The monorail guideway: a beam up on posts, floating clear of the crowd.
function beam(c, x, w) { c.R(x, 18, w, 8, '#8f86b0'); c.R(x, 18, w, 1, '#d7cce8'); c.R(x, 25, w, 1, '#6c6880'); c.block(x, 17, w, 10, 0.16, 0.1); }
// Tram rails let into the floor, sleepers between them.
function rails(c, a, b, x = 0, w = c.W) { for (let i = x + 2; i < x + w; i += 6) c.R(i, a + 1, 2, b - a - 1, '#7c7690'); c.R(x, a, w, 1, STEEL_D); c.R(x, b, w, 1, STEEL_D); }
// Under a floating track, nothing: the lane is concourse, walked across.
function laneFloor() {}

// A flight of stairs down into the ground: `n` steps along `dir`, each a
// little darker than the one above it, with a lit nosing at its top edge and
// the handrails either side. The last step is the dark mouth of the tunnel.
function flight(c, t, x, y, w, h, dir, n) {
  const along = dir === 'E' || dir === 'W', len = along ? w : h;
  for (let i = 0; i < n; i++) {
    const a = Math.round(len * i / n), b = Math.round(len * (i + 1) / n);
    const col = i === n - 1 ? '#1a1033' : mix('#d7d2e4', '#6c6880', i / (n - 1));
    const at = (p, q) => dir === 'E' ? [x + p, y + q] : dir === 'W' ? [x + w - 1 - p, y + q] : dir === 'S' ? [x + q, y + p] : [x + q, y + h - 1 - p];
    for (let p = a; p < b; p++) for (let q = 0; q < (along ? h : w); q++) c.P(...at(p, q), p === a && i < n - 1 ? YELLOW : col);
  }
  if (along) { c.R(x, y, w, 1, shade(t, 0.8)); c.R(x, y + h - 1, w, 1, shade(t, 0.8)); } else { c.R(x, y, 1, h, shade(t, 0.8)); c.R(x + w - 1, y, 1, h, shade(t, 0.8)); }
  c.sink(x, y, w, h, 0.07, 0.5, dir, n);
}
// A driveway ramp: the same cut, in more and shallower steps, painted as road.
function ramp(c, t, x, y, w, h, dir, n) {
  for (let p = 0; p < h; p++) for (let q = 0; q < w; q++) c.P(x + q, y + p, p > h - 4 ? '#1a1033' : mix(mix(ASPHALT, t, 0.15), INK, p / h * 0.5));
  for (const p of [h * 0.25, h * 0.55]) c.blot(x + w / 2 - 4, y + p, 8, 5, (i, j) => Math.abs(i - 3.5) <= j * 0.8, YELLOW, null);
  c.sink(x, y, w, h, 0.04, 0.45, dir, n);
}
// A station sign on a post, standing up out of the pit past ground level.
function totem(c, t, x, y, col = t) { c.box(x, y, 6, 6, col); c.R(x + 1, y + 1, 4, 4, WHITE); c.R(x + 2, y + 2, 2, 2, col); c.block(x - 1, y - 1, 8, 8, 0.3); }
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
  const { IW: W, IH: H, px } = c;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = px[y * W + x];
    if (v && v.startsWith('#')) raw.set([...hex(v), v.length > 7 ? parseInt(v.slice(7, 9), 16) : 255], y * (1 + W * 4) + 1 + x * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Draw every tile's layers; the manifest needs all their blocks, whichever are written.
// A corridor tile's `lane` art is a one-square image of its track, drawn as
// `<key>_lane` along the lane it reserves (laneInfos in render.js).
const drawn = Object.fromEntries(Object.entries(TILES).flatMap(([key, art]) => {
  const def = tileDef(key), tint = colorForDef(def);
  const draw = (a, shape) => {
    const out = {};
    for (const layer of ['floor', 'over']) if (a[layer]) { out[layer] = sheet(shape, a.pad); a[layer](out[layer], tint, def); }
    if (out.floor && out.over) castShadows(out.over, out.floor);
    return out;
  };
  return [[key, draw(art, def.shape)], ...(art.lane ? [[key + '_lane', draw(art.lane, 'I1')]] : [])];
}));
// Anything floating (a plane, a tree top, a gondola) casts its own outline on
// the floor, a little down and to the right, so it reads as off the ground.
function castShadows(over, floor) {
  for (const [bx, by, w, h, z0] of over.blocks) {
    if (z0 <= 0) continue;
    const d = Math.round(2 + z0 * 8);
    for (let j = by; j < by + h; j++) for (let i = bx; i < bx + w; i++) if (over.px[j * over.IW + i]) floor.darkAt(i - over.ox + d, j - over.oy + d, 0.62);
  }
}

// --sheet <file>: also write every tile at 3x, floor under over, on one contact
// sheet, so the drawings can be looked over without the game.
function contact(file) {
  const Z = 3, gap = 8, cols = 1200;
  const items = Object.values(drawn).map(({ floor, over }) => {
    const c = floor || over, px = c.px.slice();
    if (floor && over) over.px.forEach((v, i) => { if (v) px[i] = v; });
    return { W: c.IW, H: c.IH, px };
  });
  let x = gap, y = gap, rowH = 0; const at = [];
  for (const c of items) { if (x + c.W * Z > cols) { x = gap; y += rowH + gap; rowH = 0; } at.push([x, y]); x += c.W * Z + gap; rowH = Math.max(rowH, c.H * Z); }
  const out = { IW: cols, IH: y + rowH + gap, px: new Array(cols * (y + rowH + gap)).fill('#3f9b3f') };
  items.forEach((c, k) => { for (let j = 0; j < c.H * Z; j++) for (let i = 0; i < c.W * Z; i++) { const v = c.px[Math.floor(j / Z) * c.W + Math.floor(i / Z)]; if (v) out.px[(at[k][1] + j) * cols + at[k][0] + i] = v; } });
  writeFileSync(file, png(out));
}
const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) { contact(process.argv[sheetAt + 1]); process.argv.splice(sheetAt, 2); }

const dir = resolve(root, 'assets/tiles');
mkdirSync(dir, { recursive: true });
const want = process.argv.slice(2);
let n = 0;
for (const [key, layers] of Object.entries(drawn)) {
  if (want.length && !want.includes(key)) continue;
  for (const [layer, c] of Object.entries(layers)) { writeFileSync(resolve(dir, key + (layer === 'floor' ? '_floor' : '') + '.png'), png(c)); n++; }
}
// The manifest lists every tile this file draws, whichever were asked for, so a
// partial run never drops the rest from the game. The paths stay literal
// strings: the bundler finds and inlines them by pattern.
const keys = Object.keys(drawn);
const list = layer => keys.filter(k => drawn[k][layer]).map(k => `  ${k}: 'assets/tiles/${k}${layer === 'floor' ? '_floor' : ''}.png',`).join('\n');
const table = rows => rows.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n');
writeFileSync(resolve(root, 'src/ui/tilesprites.js'), `// Written by harness/tileart.mjs from its TILES table; rerun it rather than editing.
// See src/ui/sprites.js for what the layers, the pad and the blocks are.
export const SPRITES = {
${list('over')}
};
export const SPRITES_FLOOR = {
${list('floor')}
};
export const SPRITE_PAD = {
${table(keys.filter(k => TILES[k] && TILES[k].pad).map(k => [k, TILES[k].pad]))}
};
export const SPRITE_SINKS = {
${table(keys.filter(k => drawn[k].floor && drawn[k].floor.sinks.length).map(k => [k, drawn[k].floor.sinks]))}
};
export const SPRITE_BLOCKS = {
${table(keys.filter(k => drawn[k].over && drawn[k].over.blocks.length).map(k => [k, drawn[k].over.blocks.map(b => b.map(v => Math.round(v * 100) / 100))]))}
};
`);
console.log(`wrote ${n} tile layers to assets/tiles/ and the manifest to src/ui/tilesprites.js`);
