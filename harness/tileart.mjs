// The board tiles' pixel art, drawn in code: a module for isoart.mjs, which
// stands these drawings up into the isometric sheets the game draws.
//
// Each tile is drawn top-down in its shape's base orientation (src/sim/shapes.js)
// at 32 art pixels per cell, covering the bounding box, in two layers with the
// crowd between them:
//   floor  the ground a traveller stands on: paving, carpet, seats, water, track
//   over   what stands over them: roofs, canopies, signs, tree tops. Clear pixels
//          let the floor and the crowd show through.
// A tile may have either or both. `block` marks parts of the over layer that
// stand up off the floor, `stack` draws a vehicle in slices, and `sink` cuts
// steps down into the floor. The main surfaces take the tile's own colour
// (colorForDef), so the board keeps its colour code with the art on.
//
// Down in the base image is the tile's working side: the kerb a bus pulls up to,
// the track, the berth. The game turns that side to face the edge the tile
// draws from, so a bus stop's bus sits on the road side whichever way it lies.
import { tileDef } from '../src/data/tiles.js';
import { SHAPES } from '../src/sim/shapes.js';
import { colorForDef, H_UNIT } from '../src/ui/render.js';

// One screen pixel of height in the isometric sheets, in units of tile height:
// sprite stacks give heights in pixels, the way they are drawn.
const PX = 1 / (2 * 32 * H_UNIT);

const CELL = 32;

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
// the empty corner of an L or a T. `pad` ([top, right, bottom, left], in cells)
// adds a band round the bounding box for art that lies past the board's edge:
// coordinates stay those of the bounding box, so the band is at negative x or y,
// or past W or H. `block` marks a rectangle of the over layer that stands up off
// the ground, and `stack` a vehicle drawn in slices (both stood up by isoart.mjs).
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
  // a raised part: it stands from z0 to z1, in units of tile height; a round one
  // bulges and narrows as it rises (a tree top, a balloon) instead of a drum
  const block = (x, y, w, h, z1, z0 = 0, round = false) => blocks.push([x + ox, y + oy, w, h, z0, z1, ...(round ? [1] : [])]);
  // A sprite stack: a vehicle drawn as slices from its wheels to its roof, so
  // its sides carry their own detail. `fn(along, across, t)` gives the colour
  // at a point of the vehicle's plan (`L` long, `D` wide, nose at along = L - 1,
  // lying along y if `vertical`) and height t (0 at z0, 1 at z1): a colour,
  // 'top' for the top-down art under it, or nothing. Its plan may reach past
  // the drawing (an airliner's wings over the next squares).
  const stack = (x, y, L, D, vertical, fn, z0, z1) => {
    const b = [x + ox, y + oy, vertical ? D : L, vertical ? L : D, z0, z1];
    b.stack = { L, D, vertical, fn };
    blocks.push(b);
  };
  // a part of the floor that steps down into the ground: `n` steps along `dir`
  // (the way down) from depth d0 to d1
  const sinks = [], sink = (x, y, w, h, d0, d1, dir, n) => sinks.push([x + ox, y + oy, w, h, d0, d1, dir, n]);
  return { W, H, IW, IH, ox, oy, cells, px, inside, P, R, fill, rim, each, disc, ring, blot, box, cellOn, block, blocks, stack, sink, sinks };
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
// A trunk on the floor, and a canopy over it: a park's trees.
function trunk(c, x, y) { c.R(x, y, 2, 2, WOOD_D); }
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

// ---- vehicles (top-down, nose to the right) ---------------------------------------
// Each registers its own block, so it stands up off the floor; `z` is its height.
function car(c, x, y, col, v = false, z = 0.2, z0 = 0) {
  const L = 15, D = 8;
  const test = (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === D - 1));
  const paint = (i, j) => i === L - 1 && (j === 1 || j === D - 2) ? '#fff1a8' : i === 10 || i === 11 ? GLASS : i === 3 ? GLASS_D : i > 3 && i < 10 ? shade(col, 0.82) : col;
  v ? c.blot(x, y, D, L, (i, j) => test(j, i), (i, j) => paint(j, i)) : c.blot(x, y, L, D, test, paint);
  c.stack(x, y, L, D, v, (a, w, t) => carSlice(a, w, t, col, L, D), z0, z0 + z);
}
// A car in slices, nose at a = 14: tyres under a sill set in from the sides,
// the body with its lamps, door seams and a lit waistline, then a narrower
// cabin whose windscreen leans back, and the top-down roof on top of it.
// A limousine is the same car stretched: more pillars, darker glass.
function carSlice(a, w, t, col, L = 15, D = 8, tinted = '#2e5a8a') {
  const side = w === 0 || w === D - 1, rw = Math.round(0.2 * L), fw = L - 1 - rw;
  if ((a === 0 || a === L - 1) && side) return null;
  if (t < 0.28) {
    if (side) return Math.abs(a - rw) <= 1 || Math.abs(a - fw) <= 1 ? (a === rw || a === fw) && t > 0.08 ? '#8a8a9a' : '#1a1a24' : null;
    return a === 0 || a === L - 1 ? null : '#2e374d';
  }
  const c0 = Math.round(0.2 * L), c1 = Math.round(0.73 * L);
  if (t < 0.58) {
    if (a === L - 1) return w === 1 || w === D - 2 ? '#fff1a8' : t < 0.44 ? '#2e374d' : col;
    if (a === 0) return w === 1 || w === D - 2 ? RED : col;
    if (side && (a - c0) % 8 === 3 && a < c1 && t < 0.5) return shade(col, 0.72);
    return t >= 0.5 ? shade(col, 1.15) : col;
  }
  const a0 = c0 + (t > 0.8 ? 1 : 0), a1 = c1 - Math.floor((t - 0.58) / 0.42 * 3);
  if (a < a0 || a > a1 || w < 1 || w > D - 2) return null;
  if (t >= 0.9) return 'top';
  if (a === a1) return GLASS;
  if (a === a0) return GLASS_D;
  if ((a - c0) % 8 === 4) return shade(col, 0.7);
  return t > 0.8 ? mix(GLASS, tinted, 0.4) : tinted;
}
function bus(c, x, y, len, col, stripe = WHITE) {
  c.blot(x, y, len, 12, (i, j) => !((i === 0 || i === len - 1) && (j === 0 || j === 11)), (i, j) =>
    i >= len - 3 ? GLASS : (j === 1 || j === 10) ? ((i % 6) ? GLASS : shade(col, 0.7)) : (j === 5 || j === 6) ? stripe : col);
  for (let i = x + 8; i < x + len - 10; i += 14) c.box(i, y + 3, 5, 5, STEEL);
  c.stack(x, y, len, 12, false, (a, w, t) => busSlice(a, w, t, len, col, stripe), 0, 0.36);
}
// A bus in slices, nose at a = len - 1 and its doors on the kerb side (w = 0):
// two axles, the livery stripe, a long band of windows, a wide windscreen
// under a lit destination board, the top-down roof with its air units.
function busSlice(a, w, t, len, col, stripe) {
  const D = 12, side = w === 0 || w === D - 1, end = a === 0 || a === len - 1;
  if (end && side) return null;
  const door = w === 0 && (Math.abs(a - (len - 7)) <= 2 || Math.abs(a - Math.floor(len / 2)) <= 2);
  if (t < 0.18) {
    if (side) return Math.abs(a - 7) <= 2 || Math.abs(a - (len - 9)) <= 2 ? (a === 7 || a === len - 9) && t > 0.05 ? '#8a8a9a' : '#1a1a24' : null;
    return end ? null : '#2e374d';
  }
  if (t >= 0.94) return 'top';
  if (a === len - 1) {
    if (t < 0.26) return w > 0 && w < D - 1 ? '#2e374d' : col;
    if (t < 0.36) return w === 1 || w === 2 || w === D - 3 || w === D - 2 ? '#fff1a8' : col;
    if (t < 0.78) return w > 0 && w < D - 1 ? (t > 0.7 ? GLASS : mix(GLASS, GLASS_D, 0.5)) : col;
    return t < 0.88 && w > 1 && w < D - 2 ? (w % 2 ? YELLOW : '#1a1a24') : col;
  }
  if (a === 0) return t > 0.3 && t < 0.38 && (w === 1 || w === D - 2) ? RED : t > 0.5 && t < 0.8 && w > 1 && w < D - 2 ? GLASS_D : col;
  if (door && side) return t > 0.3 && t < 0.86 ? (a % 2 ? GLASS_D : '#2e5a8a') : '#2e374d';
  if (t < 0.5) return t >= 0.36 && t < 0.46 ? stripe : col;
  if (t < 0.86) return a % 7 === 0 || a < 2 ? col : t > 0.78 ? GLASS : '#2e5a8a';
  return shade(col, 0.92);
}
// A train car seen from above: roof, a lit stripe, roof boxes, glass at a nose.
function carriage(c, x, y, len, w, body, stripe, { nose = false, tail = false, z = 0.32, z0 = 0 } = {}) {
  const r = Math.floor(w / 2);
  c.blot(x, y, len, w, (i, j) => {
    const dy = Math.abs(j - (w - 1) / 2);
    if (nose && i > len - r) return dy <= Math.sqrt(Math.max(0, r * r - (i - (len - r)) ** 2)) + 0.5;
    if (tail && i < r) return dy <= Math.sqrt(Math.max(0, r * r - (r - i) ** 2)) + 0.5;
    return true;
  }, (i, j) => (nose && i > len - r - 3 && Math.abs(j - (w - 1) / 2) < r - 1) ? GLASS : Math.abs(j - (w - 1) / 2) < 1 ? stripe : body);
  for (let i = x + 6; i < x + len - 8; i += 12) c.R(i, y + 2, 5, 2, shade(body, 0.8));
  c.stack(x, y, len, w, false, (a, k, t) => carriageSlice(a, k, t, len, w, body, stripe, nose, tail), z0, z);
}
// A carriage in slices: bogies and wheels under a sill, the body with the
// line's stripe, a band of windows and doors, a rounded roof. The leading car
// is the engine: its nose leans back above the waist into a wide cab window,
// with a yellow warning panel and lamps below it. A tram that runs both ways
// has a cab at its tail as well: the same nose, seen from the other end.
function carriageSlice(a, k, t, len, w, body, stripe, nose, tail) {
  if (tail && (!nose || a < len / 2)) { a = len - 1 - a; nose = true; }
  const r = Math.floor(w / 2), dy = Math.abs(k - (w - 1) / 2);
  const back = nose ? Math.floor(Math.max(0, t - 0.5) * 2 * (r - 1)) : 0, n = a + back;
  if (n > len - 1) return null;
  if (nose && n > len - r && dy > Math.sqrt(Math.max(0, r * r - (n - (len - r)) ** 2)) + 0.5) return null;
  const cab = nose && n > len - r - 4, edge = dy > r - 1;
  if (t < 0.22) {
    if (!edge) return a < 2 || a > len - 3 ? null : '#2e374d';
    const m = a % 16;
    return a > 3 && a < len - 4 && (m === 4 || m === 5 || m === 6 || m === 10 || m === 11 || m === 12) ? (m === 5 || m === 11) && t > 0.06 ? '#8a8a9a' : '#1a1a24' : null;
  }
  if (t < 0.48) {
    if (nose && n >= len - 2 && (dy > r - 2.5) && t > 0.26 && t < 0.34) return '#fff1a8';
    if (cab && n > len - r - 1) return YELLOW;
    return t >= 0.3 && t < 0.4 ? stripe : body;
  }
  if (t < 0.8) {
    if (cab) return t > 0.72 ? GLASS : '#2e5a8a';
    const door = !nose && !tail && (Math.abs(a - Math.floor(len * 0.25)) < 2 || Math.abs(a - Math.floor(len * 0.75)) < 2);
    if (door) return t > 0.56 && t < 0.72 ? GLASS_D : shade(body, 0.86);
    return a % 6 === 0 || a < 3 || a > len - 4 ? body : t > 0.72 ? GLASS : '#2e5a8a';
  }
  return t >= 0.92 ? 'top' : shade(body, 0.94);
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
  // one stack for the hull and the cabin on it, the deck and the cabin roof from the drawing
  const hullPx = Math.max(4, Math.round(z / PX)), cabPx = cabin ? Math.max(4, Math.round(w / 2)) : 0;
  c.stack(x, y, len, w, false, (a, k, t) => boatSlice(a, k, t * (hullPx + cabPx), len, w, bow, hullPx, cabPx, hull, cabin), 0, (hullPx + cabPx) * PX);
  if (cabin) {
    const [cx0, cw, col] = cabin, top = y + Math.round(cy) - Math.floor((w - 6) / 2);
    c.box(x + cx0, top, cw, w - 6, col); c.R(x + cx0 + cw - 2, top, 2, w - 6, GLASS);
  }
}
// A boat in slices, h in pixels: a vee hull that widens to the gunwale, dark
// below the waterline and a lit rubbing strake along the top, the deck (the
// top-down art) inside it, and a cabin with a band of windows and a windscreen.
function boatSlice(a, k, h, len, w, bow, hullPx, cabPx, hull, cabin) {
  const f = Math.min(1, h / hullPx), taper = a > len - bow ? Math.max(0, (len - a) / bow) ** 0.7 : 1;
  const hw = w / 2 * taper * (0.62 + 0.38 * f), dy = Math.abs(k - (w - 1) / 2);
  if (h < hullPx) {
    if (dy > hw - 0.3) return null;
    if (h < 1.5) return shade(hull, 0.5);
    if (dy > hw - 1.3 && h >= hullPx - 1.2) return shade(hull, 1.2);
    return dy < hw - 1.3 && h >= hullPx - 1.2 ? 'top' : hull;
  }
  if (!cabin) return null;
  const [cx0, cw, col] = cabin, hh = (w - 6) / 2, ch = h - hullPx;
  if (a < cx0 || a >= cx0 + cw || dy > hh) return null;
  if (ch >= cabPx - 1) return 'top';
  if (a === cx0 + cw - 1) return ch > 0.8 ? GLASS : col;
  return ch > 1 && ch < cabPx - 1.5 && a % 3 ? '#2e5a8a' : col;
}
// An airliner parked on its gear, nose at +x (or +y if `down`), in a box len x
// span on the tile. Its wings are drawn at 0.9 of its length in span, centred
// on the box, and may reach over the squares either side.
function plane(c, x, y, len, span, body, trim, down = false) {
  const S = Math.round(len * 0.9), off = Math.round((span - S) / 2), m = planeModel(len, S, body, trim);
  down ? c.stack(x + off, y, len, S, true, m.fn, 0, m.H * PX) : c.stack(x, y + off, len, S, false, m.fn, 0, m.H * PX);
}
// An airliner in slices, nose at a = len - 1, h in pixels: a round fuselage
// with a cheatline, a row of cabin windows and the flight deck glass at the
// nose, low wings with a little dihedral and an engine slung under each, a
// tailplane, a fin in the livery colour, and the gear it stands on.
function planeModel(len, S, body, trim) {
  const fw = Math.max(2, Math.round(len / 14)), g = Math.max(2, Math.round(len / 16)), zc = g + fw;
  const H = zc + fw + Math.round(len / 6) + 1, cy = (S - 1) / 2;
  const fn = (a, c, t) => {
    const h = t * H, dy = Math.abs(c - cy);
    const r = fw * (a > len - 6 ? Math.sqrt(Math.max(0, (len - a) / 6)) : a < len * 0.22 ? 0.35 + 0.65 * a / (len * 0.22) : 1);
    // fuselage: a circle in section; toward the tail it narrows and rises to meet the fin
    const zcA = a < len * 0.22 ? zc + (fw - r) * 0.8 : zc;
    if (dy * dy + (h - zcA) ** 2 <= r * r + 0.3) {
      if (a > len - 6 && h > zcA && h < zcA + r * 0.8 && dy > r * 0.3) return '#2e5a8a';
      if (Math.abs(h - zcA - r * 0.35) < 0.6 && a % 3 === 0 && a > len * 0.2 && a < len - 7) return '#2e374d';
      if (Math.abs(h - zcA) < 0.7) return trim;
      return h < zcA - r * 0.4 ? shade(body, 0.9) : body;
    }
    // wings, with dihedral, and an engine under each
    const wz = g + fw * 0.45 + dy * 0.06, le = len * 0.62 - dy * 0.45, te = len * 0.44 - dy * 0.3;
    if (dy <= S / 2 && a <= le && a >= te && Math.abs(h - wz) <= 0.8) return dy > S / 2 - 2 ? trim : body;
    const de = S * 0.24, re = Math.max(1.2, fw * 0.6), he = g + fw * 0.45 + de * 0.06 - re - 0.3;
    if (a >= len * 0.4 && a <= len * 0.56 && (dy - de) ** 2 + (h - he) ** 2 <= re * re) return a >= len * 0.55 ? '#2e374d' : STEEL_D;
    // tailplane and fin
    if (dy <= S * 0.2 && a >= 1 && a <= len * 0.14 - dy * 0.3 && Math.abs(h - (zc + fw * 0.6)) <= 0.7) return body;
    if (dy < 0.8 && a >= 1 && h > zc && h <= H && a <= len * 0.2 - (h - zc) * 0.55) return h > zc + fw ? trim : body;
    // gear: a nose leg and two main legs, with their wheels
    if (h < g + 0.5 && ((a >= len - 8 && a <= len - 7 && dy < 0.8) || (Math.abs(a - len * 0.47) <= 1 && Math.abs(dy - fw * 0.8) < 0.8))) return h < 1.5 ? '#1a1a24' : '#6c6880';
    return null;
  };
  return { fn, H };
}
// A helicopter standing on the pad, its rotor hub at (cx, cy).
function heli(c, cx, cy, col) { c.stack(cx - 18, cy - 18, 37, 37, false, (a, k, t) => heliSlice(a - 18, k - 18, t * 15, col), 0, 15 * PX); }
// A helicopter in slices about its rotor hub, h in pixels: skids and struts,
// an egg of a cabin with its glass at the nose (-x), the tail boom, fin and
// tail rotor, the mast, and two blades crossing over the top.
function heliSlice(dx, dy, h, col) {
  const e = ((dx + 2.5) / 10) ** 2 + (dy / 6.5) ** 2 + ((h - 7) / 4.6) ** 2;
  if (e <= 1) return dx < -5 && h > 6 ? (h > 9.5 ? GLASS : '#2e5a8a') : Math.abs(h - 7) < 0.6 && dx > -5 ? shade(col, 0.75) : col;
  if (dx >= 5 && dx <= 20 && Math.abs(dy) <= 1 && h >= 6.5 && h <= 8.5 - dx * 0.05) return shade(col, 0.85);
  if (dx >= 18 && dx <= 21 && Math.abs(dy) <= 0.5 && h >= 6 && h <= 12.5) return col;
  if (dx >= 18 && dx <= 20 && Math.abs(dy) >= 1 && Math.abs(dy) <= 2 && h >= 7 && h <= 11) return STEEL_D;
  if (Math.abs(Math.abs(dy) - 5) <= 0.5 && ((h < 1.2 && dx >= -12 && dx <= 6) || (h < 3.5 && (dx === -7 || dx === 2)))) return '#2e374d';
  if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5 && h >= 11 && h < 13.5) return STEEL;
  if (h >= 13.4 && Math.hypot(dx, dy) <= 17.5 && (Math.abs(dy - dx * 0.35) <= 0.7 || Math.abs(dx + dy * 0.35) <= 0.7)) return '#2e374d';
  return null;
}
// The ferry in slices, bow up the image (along = 0), h in pixels: a white hull
// with a dark boot-top, a blue sheer line and the car deck's stern door, then
// two decks of windows with the bridge wrapping the front and the red funnel.
function ferrySlice(a, k, t) {
  const h = t * 17, hw = 11 * (a < 12 ? Math.max(0, a / 12) ** 0.7 : a > 78 ? (84 - a) / 6 : 1), dy = Math.abs(k - 10.5);
  if (h < 6) {
    if (dy > hw * (0.8 + 0.2 * h / 6)) return null;
    if (h < 1.5) return '#8a2a4a';
    if (a > 74 && h > 2 && h < 5 && dy < 5) return '#2e374d';
    return h >= 4 && h < 5 ? '#2f6bff' : h >= 5 ? 'top' : WHITE;
  }
  if (dy > 6.5 || a < 20 || a > 60) return a >= 38 && a <= 44 && dy <= 3 && h < 17 ? (h > 15 ? '#1a1a24' : RED) : null;
  if (h > 12.5) return a >= 38 && a <= 44 && dy <= 3 ? RED : null;
  if (h > 11.5) return 'top';
  if (a < 24) return h > 8 ? GLASS : '#e6e6f0';
  return (h > 7 && h < 9) || (h > 9.5 && h < 11) ? (a % 3 ? '#2e5a8a' : '#e6e6f0') : '#e6e6f0';
}
// The cruise ship in slices, bow at +x, h in pixels: hull with portholes and a
// blue line, three decks of balconies stepping in toward the top, the bridge
// wrapping the front of them and the red and black funnel.
function cruiseSlice(a, k, t) {
  const h = t * 31, hw = 11 * (a > 150 ? Math.max(0, (184 - a) / 34) ** 0.6 : a < 4 ? 0.85 : 1), dy = Math.abs(k - 10.5);
  if (h < 12) {
    if (dy > hw * (0.85 + 0.15 * h / 12)) return null;
    if (h < 2.5) return '#8a2a4a';
    if (h >= 11) return dy > hw - 1.5 ? WHITE : 'top';
    if (h >= 7 && h < 8) return '#35d4ff';
    return (h >= 4.5 && h < 5.5 || h >= 9 && h < 10) && a % 4 === 0 && a > 8 && a < 170 ? '#2e374d' : WHITE;
  }
  const deck = Math.floor((h - 12) / 2.7), inset = 3 + deck;
  if (a >= 138 && a <= 146 && dy <= 7 && h < 16) return h > 15 ? 'top' : h > 12.5 ? GLASS : WHITE;
  if (a >= 92 && a <= 101 && dy <= 4.5 && h >= 19) return h > 29 ? '#1a1a24' : RED;
  // lifeboats slung along the first deck, outboard of it
  if (h < 14.5 && dy > 7.5 && dy <= 9.5 && a > 24 && a < 128 && a % 10 < 6) return h > 13.5 ? WHITE : '#f28c28';
  if (deck > 2 || a < 16 + 4 * deck || a > 136 - 6 * deck || dy > 10.5 - inset) return null;
  if (h - 12 - deck * 2.7 > 2) return 'top';
  return (h - 12) % 2.7 < 1.2 ? WHITE : a % 3 ? GLASS_D : '#e6e6f0';
}
// The submarine in slices, h in pixels from 12 below ground: a round dark hull
// in its pool, the conning tower rising out of the water with a yellow band.
function subSlice(a, k, t) {
  const h = t * 12.7, hw = 5.5 * (a < 6 ? Math.sqrt(a / 6) : a > 34 ? Math.sqrt(Math.max(0, (42 - a) / 8)) : 1), dy = Math.abs(k - 5);
  if (dy * dy / (hw * hw || 1) + ((h - 2) / 2.3) ** 2 <= 1) return h > 3 ? '#3b4050' : '#2e374d';
  if (a >= 14 && a <= 21 && k >= 2 && k <= 8) { if (h > 12) return 'top'; return h > 9 && h < 10 ? YELLOW : '#3b4050'; }
  return null;
}
// A loop pod in slices: a white capsule on a dark skid, glass at its nose
// (+x) and a window band down its side.
function podSlice(a, k, t) {
  const dy = Math.abs(k - 3), r = 3.5 * Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.55) ** 2));
  if (dy > r || (a === 0 || a === 11) && dy > r - 1) return null;
  if (t < 0.15) return a > 1 && a < 10 ? '#2e374d' : null;
  if (t > 0.9) return 'top';
  if (a >= 8) return t > 0.4 ? GLASS : WHITE;
  return t > 0.45 && t < 0.75 && a % 3 ? '#2e5a8a' : WHITE;
}
// A hot-air balloon in slices about its centre, h in pixels from its basket:
// a wicker basket, the burner and ropes, and the envelope, a teardrop of gores
// in the tile's colour and yellow with a crown on top.
function balloonSlice(dx, dy, h, t) {
  const r = Math.hypot(dx, dy);
  if (h < 5) return r <= 3 ? (h > 4 ? '#6b3e24' : r > 2.2 || (dx + dy) % 2 ? WOOD : WOOD_L) : null;
  if (h < 11) return (Math.abs(Math.abs(dx) - 3) < 0.6 && Math.abs(Math.abs(dy) - 3) < 0.6) || (r < 1 && h < 7) ? '#6c6880' : null;
  const s = (h - 11) / 29, R = 17 * (s < 0.35 ? 0.3 + 0.7 * Math.sin(s / 0.35 * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((s - 0.35) / 0.66) ** 2)));
  if (r > R) return null;
  if (s > 0.97) return shade(t, 0.6);
  return Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 2 ? t : YELLOW;
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
    floor(c, t) { platform(c, t); roadStrip(c, t, 18); frame(c, t); },
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
    floor(c, t) { platform(c, t); roadStrip(c, t, 16); frame(c, t); },
    over(c, t) {
      c.box(4, 3, 10, 8, t); c.R(6, 5, 6, 4, YELLOW); c.R(8, 6, 2, 2, INK);
      for (const x of [4, 24, 44]) { car(c, x, 20, YELLOW); c.box(x + 5, 22, 4, 3, '#fff1a8'); }
    },
  },
  rideshare: {
    floor(c, t) {
      platform(c, t); tarmac(c, t, 3, 3, 26, 58); tarmac(c, t, 3, 35, 58, 26);
      for (let y = 8; y < 30; y += 12) c.R(3, y, 26, 1, PAINT);
      frame(c, t);
    },
    over(c, t) { car(c, 8, 10, '#2e374d'); car(c, 8, 22, WHITE); car(c, 34, 44, t); car(c, 12, 44, '#9b5cff'); c.box(40, 38, 10, 4, '#ff4fd8'); },
  },
  car_rental: {
    floor(c, t) {
      platform(c, t); tarmac(c, t, 0, 30, 64, 34);
      for (let x = 4; x < 64; x += 15) c.R(x, 32, 1, 28, PAINT);
      frame(c, t);
    },
    over(c, t) {
      hut(c, t, 3, 3, 58, 22); hvac(c, 50, 9); c.box(8, 10, 22, 8, WHITE); c.R(10, 12, 18, 1, t); c.R(10, 15, 12, 1, t);
      car(c, 6, 36, RED, true); car(c, 21, 36, WHITE, true); car(c, 36, 36, '#35d4ff', true); car(c, 51, 36, '#2e374d', true);
    },
  },
  limo: {
    floor(c, t) { platform(c, t); roadStrip(c, t, 16); c.R(0, 12, c.W, 2, RED); frame(c, t); },
    over(c, t) {
      c.box(10, 3, 76, 8, shade(t, 0.95)); c.R(11, 4, 75, 2, shade(t, 1.25)); for (let x = 14; x < 84; x += 8) c.P(x, 8, YELLOW);
      const L = 58; c.blot(20, 18, L, 10, (i, j) => !((i === 0 || i === L - 1) && (j === 0 || j === 9)), (i, j) => i > L - 13 && i < L - 9 ? GLASS_D : i > 6 && i < L - 16 ? (j === 0 || j === 9 ? '#2e374d' : '#1a1a24') : '#22222e');
      c.R(26, 19, 28, 1, '#6c6880');
      c.stack(20, 18, L, 10, false, (a, w, t) => carSlice(a, w, t, '#22222e', L, 10, '#14141c'), 0, 0.2);
    },
  },
  parking_lot: {
    floor(c, t) {
      tarmac(c, t);
      for (let x = 1; x < 64; x += 15) { c.R(x, 3, 1, 22, PAINT); c.R(x, 39, 1, 22, PAINT); }
      for (let x = 6; x < 60; x += 8) c.R(x, 32, 4, 1, YELLOW);
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
    floor(c, t) { platform(c, t); c.R(0, 14, c.W, 16, mix('#9a94b2', t, 0.25)); c.R(0, 17, c.W, 1, STEEL_D); c.R(0, 26, c.W, 1, STEEL_D); frame(c, t); },
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
      c.stack(8, 15, 112, w, false, (a, k, s) => carriageSlice(a, k, s, 112, w, WHITE, t, true, true), 0.16, 0.36);
    },
  },
  ski_lift: {
    // one car a square along the lane, out on one cable and back on the other in turn
    lane: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 12, 9, 8, 6, 0.1); } },
    laneAlt: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 12, 22, 8, 6, 0.1); } },
    floor(c, t) { snow(c); frame(c, t); },
    over(c, t) { lift(c, t, 50, 8, 6, 0.1); },
  },
  alpine_lift: {
    lane: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 10, 10, 12, 9, 0.14); } },
    laneAlt: { floor: laneFloor, over(c, t) { cables(c); gondola(c, t, 10, 21, 12, 9, 0.14); } },
    floor(c, t) { snow(c); for (const [x, y] of [[40, 4], [96, 22], [130, 6]]) c.blot(x - 3, y - 3, 7, 7, (i, j) => Math.abs(i - 3) + Math.abs(j - 3) <= 3, '#2f7a3f'); frame(c, t); },
    over(c, t) { lift(c, t, 64, 12, 9, 0.14); },
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

      c.box(9, 26, 14, 40, '#e6e6f0'); for (let y = 30; y < 64; y += 5) { c.P(9, y, GLASS_D); c.P(22, y, GLASS_D); }
      c.box(11, 22, 10, 5, GLASS); c.box(13, 44, 6, 6, RED);
      c.stack(5, 6, 84, 22, true, ferrySlice, 0, 17 * PX);
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
      c.box(20, 37, 120, 16, '#e6e6f0'); c.box(30, 39, 90, 12, WHITE);
      for (let x = 34; x < 118; x += 6) { c.P(x, 39, GLASS_D); c.P(x, 50, GLASS_D); }
      c.box(60, 41, 14, 8, '#35d4ff');
      c.box(96, 40, 9, 10, RED); c.R(98, 42, 5, 6, INK);
      c.box(142, 38, 8, 14, GLASS);
      c.stack(4, 34, 184, 22, false, cruiseSlice, 0, 31 * PX);
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
      c.stack(30, 0, 37, 37, false, (a, k, s) => balloonSlice(a - 18, k - 18, s * 40, t), 0, 40 * PX);
      hut(c, t, 38, 40, 20, 18, 0.3); c.R(42, 44, 12, 10, RED);
    },
  },
  jetway: {
    // The tip cell meets the apron and the airliner is parked nose-in past the
    // edge; the bridge runs down the stem into the terminal at the foot.
    pad: [1, 0, 0, 0],
    floor(c, t) { apronStrip(c, t, 0); c.R(15, 0, 2, 32, YELLOW); frame(c, t); },
    over(c, t) {
      plane(c, 3, -30, 46, 26, WHITE, '#3f8cff', true);
      c.box(12, 20, 8, 30, '#d7cce8'); c.R(13, 21, 6, 28, STEEL); for (let y = 24; y < 48; y += 5) c.R(13, y, 6, 1, STEEL_D);
      c.box(12, 46, 22, 8, '#d7cce8'); c.R(13, 47, 20, 6, STEEL); c.block(11, 19, 24, 36, 0.22, 0.1);
      hut(c, t, 36, 36, 26, 26); for (let x = 40; x < 60; x += 6) c.R(x, 42, 3, 16, GLASS);
    },
  },
  jumbo_jetway: {
    pad: [1, 0, 0, 0],
    floor(c, t) { apronStrip(c, t, 0); c.R(15, 0, 2, 64, YELLOW); frame(c, t); },
    over(c, t) {
      plane(c, 1, -30, 62, 30, WHITE, '#9b5cff', true);
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
    over(c, t) { plane(c, 18, 1, 52, 28, WHITE, YELLOW); hut(c, t, 34, 32, 28, 30); skylight(c, 40, 40, 16, 8); c.box(38, 52, 20, 4, YELLOW); },
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
      for (const [x, y] of [[20, 10], [44, 50], [10, 40]]) {
        c.box(x - 4, y - 3, 12, 7, WHITE); c.R(x + 4, y - 2, 3, 5, GLASS);
        c.stack(x - 4, y - 3, 12, 7, false, podSlice, 0, 0.16);
      }
      c.disc(32, 32, 7, shade(t, 0.9)); c.ring(32, 32, 7, 1, INK); c.block(24, 24, 17, 17, 0.3);
    },
  },

  // ---- underground: stairs down. The concourse stays at ground level and the
  // flight is cut into it, a step at a time (`sink`).
  subway: {
    floor(c, t) { platform(c, t); flight(c, t, 4, 7, 36, 18, 'E', 6); frame(c, t); },
    over(c, t) { totem(c, t, 50, 12); },
  },
  express_subway: {
    floor(c, t) { platform(c, t); flight(c, t, 4, 7, 36, 18, 'E', 6); flight(c, t, 56, 7, 36, 18, 'W', 6); frame(c, t); },
    over(c, t) { totem(c, t, 45, 12, RED); },
  },
  under_parking: {
    // the ramp runs down the long arm; the foot is the garage it leads to, a
    // level below the concourse at the ramp's own depth, with the cars in it
    floor(c, t) {
      platform(c, t); tarmac(c, t, 34, 36, 26, 24); for (const x of [34, 47, 60]) c.R(x, 38, 1, 20, PAINT);
      c.sink(34, 36, 26, 24, GARAGE, GARAGE, 'S', 1);
      ramp(c, t, 5, 3, 22, 48, 'S', 10); frame(c, t);
    },
    over(c, t) { car(c, 37, 41, WHITE, true, 0.17, -GARAGE); car(c, 50, 41, RED, true, 0.17, -GARAGE); totem(c, t, 18, 54, '#2f6bff'); },
  },
  sub_dock: {
    // the pool is one step down, the submarine riding in it
    floor(c, t) { platform(c, t); sea(c, 4, 9, 56, 19); c.sink(4, 9, 56, 19, 0.3, 0.3, 'S', 1); hazard(c, 4, 6, 56, 2); frame(c, t); },
    over(c) {
      c.blot(10, 13, 42, 11, (i, j) => { const hw = 5.5 * (i < 6 ? Math.sqrt(i / 6) : i > 34 ? Math.sqrt(Math.max(0, (42 - i) / 8)) : 1); return Math.abs(j - 5) <= hw; }, '#2e374d');
      c.box(24, 15, 8, 7, '#3b4050'); c.R(26, 17, 4, 1, YELLOW);
      c.stack(10, 13, 42, 11, false, subSlice, -0.3, 0.02);
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
      for (const [x, y] of TREES_O4) trunk(c, x, y);
      bench(c, 38, 22); bench(c, 16, 40);
      kerb(c, t);
    },
    over(c) { for (const [x, y, r] of TREES_O4) tree(c, x, y, r); },
  },
  pocket_park: {
    floor(c, t) { grass(c); c.R(0, 13, 32, 6, '#d8c89a'); bench(c, 18, 22); c.disc(8, 25, 3, '#ff4fd8'); c.disc(8, 25, 1, YELLOW); trunk(c, 10, 8); kerb(c, t); },
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
// The underground car park's depth, the bottom of its ramp: shallow, since a pit
// hides a band along its near sides as deep as it is, and the cars must show.
const GARAGE = 0.2;
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
function gondola(c, t, cx, cy, w, h, z) {
  const y = cy - (h >> 1); c.box(cx, y, w, h, t); c.R(cx + 1, y + 1, w - 2, 1, GLASS);
  // in the round: a floor, glass all round between corner posts, a roof
  c.stack(cx, y, w, h, false, (a, k, s) => {
    if (s > 0.85) return 'top';
    const corner = (a === 0 || a === w - 1) && (k === 0 || k === h - 1);
    return s < 0.18 || corner ? shade(t, s < 0.18 ? 0.7 : 1) : s > 0.72 ? t : s > 0.6 ? GLASS : '#2e5a8a';
  }, 0.2 - z, 0.2);
}
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
  c.sink(x, y, w, h, 0.04 * GARAGE / 0.2, GARAGE, dir, n);
}
// A station sign on a post, standing up out of the pit past ground level.
function totem(c, t, x, y, col = t) { c.box(x, y, 6, 6, col); c.R(x + 1, y + 1, 4, 4, WHITE); c.R(x + 2, y + 2, 2, 2, col); c.block(x - 1, y - 1, 8, 8, 0.3); }
// Draw every tile's layers. A corridor tile's `lane` art is a one-square image of its track, drawn as
// `<key>_lane` along the lane it reserves (laneInfos in render.js), and one with
// `laneAlt` art has it on every other square instead (`<key>_lane_alt`). `tintFor`
// picks the colour each tile is drawn in: isoart.mjs draws the set twice in
// greys, to learn which pixels follow the tile's colour.
export function drawAll(tintFor = def => colorForDef(def)) {
  return Object.fromEntries(Object.entries(TILES).flatMap(([key, art]) => {
    const def = tileDef(key), tint = tintFor(def);
    const draw = (a, shape) => {
      const out = {};
      for (const layer of ['floor', 'over']) if (a[layer]) { out[layer] = sheet(shape, a.pad); a[layer](out[layer], tint, def); }
      return out;
    };
    return [[key, draw(art, def.shape)], ...(art.lane ? [[key + '_lane', draw(art.lane, 'I1')]] : []), ...(art.laneAlt ? [[key + '_lane_alt', draw(art.laneAlt, 'I1')]] : [])];
  }));
}
export { CELL, hex };
