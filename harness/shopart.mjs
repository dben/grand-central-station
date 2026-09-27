// The shops' board art, painted by an image model over a block-out of each
// footprint (harness/shopgen.mjs), then baked into sheets by isoart.mjs.
// This module holds what both sides need: which shops, what each one is, the
// views a footprint needs, and the geometry that ties a picture to its cells.
//
// A source picture, `assets/shops/<key>_<view>.png`, is the shop seen in one
// turn, in frame coordinates (the same as a sheet frame: screen pixels from the
// ground point of the footprint's top corner, a cell 64 wide) at DENSITY picture
// pixels to a frame pixel. It covers viewBox(): the footprint, WALL_ROOM above
// the walls for signs, and a margin. It is a plain picture: touch it up freely.
import { tileDef } from '../src/data/tiles.js';
import { SHAPES } from '../src/sim/shapes.js';
import { tileHeight, H_UNIT } from '../src/ui/render.js';

export const CELL = 32;                   // art pixels a cell, as in tileart.mjs
export const DENSITY = 2;                 // picture pixels to a frame pixel: a cell is 128 across
const HZ = 2 * CELL * H_UNIT;             // frame pixels per unit of tile height
// The art stands taller than the block the game's other views use, so a shop
// has room for a shopfront; signs and roof kit may rise a further WALL_ROOM.
export const ART_TALL = 1.7, WALL_MAX = 44, WALL_ROOM = 64, MARGIN = 10;
// How far up a pixel may be and still be kept, when the column it stands over
// is in front (a sign over an L's back notch): anything that high is in the air.
export const KEEP_ROOM = 400;
// Colours a shop's pictures share: few enough that its sheet packs into a palette.
export const COLOURS = 80;

// The solid shops: what each one is, for the prompt. The walk-through tiles
// (carts, lounges, the checkpoint) stay drawn in code, since the crowd shows
// inside them.
export const SHOPS = {
  vending: 'a bank of two or three bright drinks and snack VENDING MACHINES standing back to back under a small canopy',
  kiosk: 'an INFORMATION KIOSK: a little booth with a big round "i" sign on a pole, a counter window, and a departures screen',
  atm: 'a CASH MACHINE booth: a compact kiosk with two ATMs set into its front walls, a green-and-white canopy and a money sign on top',
  newsstand: 'a NEWSSTAND: a news kiosk with magazine racks and newspaper bundles on its front walls, a blue awning, and a NEWS sign on the roof',
  food_stand: 'a FOOD STAND: a hot-dog and snack stall with a serving hatch, a striped awning, and a giant hot dog on the roof',
  coffee: 'a COFFEE SHOP: a cosy café with big windows, a brown-and-cream striped awning, and a giant steaming coffee cup sign on the roof',
  currency: 'a CURRENCY EXCHANGE: a smart bureau de change with a glass counter window, a green awning, a scrolling rates board, and a coin sign on the roof',
  restroom: 'the station RESTROOMS: a tidy tiled block with two doors marked by the man and woman pictograms, frosted high windows, and rooftop vents and a skylight',
  burger: 'a BURGER JOINT: a little fast-food restaurant with big windows, a glass door, a red-and-white striped awning, and a giant burger sign on the roof',
  pizza: 'a PIZZA PLACE: a pizzeria with a green-white-red awning, a brick pizza oven glowing through the window, and a giant pizza slice sign on the roof',
  clothing: 'a CLOTHING STORE: a fashion boutique with mannequins in its display windows, a pink awning, and a shirt sign and skylight on the roof',
  sports_bar: 'a SPORTS BAR: a pub with neon beer signs in its windows, a blue awning, big TV screens on the roof, and a football sign',
  cafeteria: 'a CAFETERIA: a long self-service canteen with a row of windows showing trays and tables, a yellow-and-red awning, and skylights along the roof',
  art_gallery: 'an ART GALLERY: an elegant modern gallery with tall framed paintings visible through its windows, a sawtooth skylight roof, and a picture-frame sign',
  lounge: 'a TRAVEL LOUNGE: a plush airport-style lounge with tinted glass, a dark awning with gold trim, armchairs glimpsed inside, and a cocktail-glass sign',
  designer: 'a DESIGNER SHOP: a luxury boutique with a black-and-gold facade, spotlit display windows of handbags, and a diamond sign on the roof',
  security: 'a SECURITY STATION: a police-style post with blue-tinted windows, a shield badge over the door, a hazard-striped roof edge, CCTV cameras and an antenna',
  drone_swarm: 'a DRONE VENDING SWARM: a futuristic launch hub with glowing landing pads on the roof and small quadcopter delivery drones hovering over it',
  nanofab: 'a NANOFAB BOUTIQUE: a sleek sci-fi fabrication shop with glowing magenta and cyan panels, a holographic atom sign, and humming machinery on the roof',
};

// The turn m frame's footprint: the base cells turned m quarter turns
// ((x, y) -> (-y, x), as isoart's frames are) and moved to start at 0.
const norm = cells => { const x0 = Math.min(...cells.map(c => c[0])), y0 = Math.min(...cells.map(c => c[1])); return cells.map(([x, y]) => [x - x0, y - y0]).sort((a, b) => a[1] - b[1] || a[0] - b[0]); };
const cellKey = cells => cells.map(c => c.join(',')).join(';');
export function turnCells(key, m) {
  let c = SHAPES[tileDef(key).shape][0];
  for (let i = 0; i < m; i++) c = c.map(([x, y]) => [-y, x]);
  return norm(c);
}
// The pictures a shop needs. Flipping a frame left to right swaps the grid's x
// and y, so a turn whose footprint is another's swapped reuses that picture
// flipped: an I or O shape needs one picture, an S or T two, an L3 three and
// the L4 four. (Painting each turn separately would keep the light on the right
// in all of them, but a model given four block-outs at once follows their shapes
// far worse than one given one or two.) A flipped turn keeps its painted light,
// now from the left; relighting it by the block's faces left a band wherever
// the painted corner missed the block's, and the paintings' light is soft.
// Returns { views: [cells], turns: [{ view, flip }] x 4 }.
export function shopViews(key) {
  const views = [], turns = [];
  for (let m = 0; m < 4; m++) {
    const c = turnCells(key, m), k = cellKey(c), kf = cellKey(norm(c.map(([x, y]) => [y, x])));
    let v = views.findIndex(w => cellKey(w) === k);
    if (v >= 0) { turns.push({ view: v, flip: false }); continue; }
    v = views.findIndex(w => cellKey(w) === kf);
    if (v >= 0) { turns.push({ view: v, flip: true }); continue; }
    turns.push({ view: views.length, flip: false }); views.push(c);
  }
  return { views, turns };
}

// How tall a shop's walls are painted, in frame pixels.
export const wallHeight = key => Math.min(WALL_MAX, Math.round(tileHeight(tileDef(key)) * HZ * ART_TALL));

// The frame box a view's picture covers: [X0, Y0, X1, Y1] in frame pixels.
export function viewBox(cells, wall) {
  const pts = cells.flatMap(([u, v]) => [[u, v], [u + 1, v], [u, v + 1], [u + 1, v + 1]]).map(([u, v]) => [(u - v) * CELL, (u + v) * CELL / 2]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs) - MARGIN, Math.min(...ys) - wall - WALL_ROOM - MARGIN, Math.max(...xs) + MARGIN, Math.max(...ys) + MARGIN];
}

// What the ray through frame point (X, Y) meets first, coming down from the
// top of the room over the roof: { cell: [u, v], face } or null where it meets
// no column of the footprint (the picture is cut away there). face is 0 on the
// roof or above it, 1 on a left (south) wall, 2 on a right (east) wall, as in
// the sheets' maps. The walls are the block the model painted over (the block-out
// is shaded by these faces; the bake keeps only the cell).
// Anything over the roof belongs to the cell whose roof is under it, so the
// back of an L's roof never paints over a traveller standing in its notch;
// only what stands up past the roof's front edge goes to the column in front.
// room = 0 gives the block itself.
export function rayHit(cells, wall, X, Y, room = WALL_ROOM) {
  const S = new Set(cells.map(c => c.join(','))), inS = (u, v) => S.has(u + ',' + v);
  const a = Y + X / 2, b = Y - X / 2, top = wall + room;          // U = a + h, V = b + h
  const at = h => [Math.floor((a + h) / CELL), Math.floor((b + h) / CELL)];
  // the heights where the ray crosses into another cell: U or V on a cell line
  const cuts = [];
  for (const [c, kind] of [[a, 2], [b, 1]]) for (let k = Math.ceil(c / CELL); k * CELL - c < top; k++) if (k * CELL - c > 0) cuts.push([k * CELL - c, kind]);
  cuts.sort((p, q) => q[0] - p[0]);
  // a corner crosses both lines at once: one cut, of kind 3
  for (let i = cuts.length - 1; i > 0; i--) if (cuts[i][0] === cuts[i - 1][0]) { cuts[i - 1][1] = 3; cuts.splice(i, 1); }
  // walk down: the stretch above each cut, then the last one to the ground
  let hi = top, came = 0;
  for (let i = 0; i <= cuts.length; i++) {
    const lo = i < cuts.length ? cuts[i][0] : 0, [u, v] = at((hi + lo) / 2);
    if (inS(u, v)) {
      if (hi > wall - 1 || hi === top) { const r = at(wall - 0.5); return { cell: inS(...r) ? r : [u, v], face: 0 }; }
      // the wall it came in through: V's cell line is a left (south) wall, U's a right (east) one;
      // at a corner, the one with open floor beyond it
      return { cell: [u, v], face: came === 3 ? (!inS(u, v + 1) ? 1 : 2) : came };
    }
    if (i < cuts.length) { hi = lo; came = cuts[i][1]; }
  }
  return null;
}

// What the bake will do to a view's picture: the share of its paint cut away
// (over no column of the footprint), the biggest single cut piece as a share of
// the paint, and the share of the block left bare. A cut piece is the model
// having painted a wall where the footprint has none (a box on an L, a stem the
// wrong length), and it shows as a wall chopped off with floor behind it, so
// the biggest piece is what a painting is judged by; a bare strip of the block
// only shows as floor round the shop, which reads fine.
//
// The bake can't cut a box painted over an L's back notch: from the front, a
// wall there sits where a sign on the roof would. Its roof gives it away, since
// a roof has a rim round its edge that follows the footprint. So `roof` is, for
// each cell missing from the footprint's bounding box, the painted share of the
// back half of that cell's diamond raised to the painted roof (leaving out the
// footprint's own walls up to that height, which cover some of it beside a
// front notch): open
// floor on a true L, solid roof on a box. Signs are too thin to fill it.
export function cutStats(pic, cells, wall) {
  const [X0, Y0] = viewBox(cells, wall), { w, h, data } = pic, cut = new Uint8Array(w * h);
  const S = new Set(cells.map(c => c.join(','))), uw = Math.max(...cells.map(c => c[0])) + 1, vh = Math.max(...cells.map(c => c[1])) + 1;
  const holes = new Map();
  for (let u = 0; u < uw; u++) for (let v = 0; v < vh; v++) if (!S.has(u + ',' + v)) holes.set(u + ',' + v, [0, 0]);
  let paint = 0, ncut = 0, block = 0, bare = 0;
  const roofAt = holes.size ? paintedRoof(pic, cells, wall) : wall;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = X0 + (i + 0.5) / DENSITY, Y = Y0 + (j + 0.5) / DENSITY, on = data[(j * w + i) * 4 + 3] > 0;
    const inBlock = rayHit(cells, wall, X, Y, 0);
    if (inBlock) { block++; if (!on) bare++; }
    if (on) { paint++; if (!rayHit(cells, wall, X, Y, KEEP_ROOM)) { cut[j * w + i] = 1; ncut++; } }
    // the point on the roof plane under this pixel, and whether it is the back half of a hole
    const U = Y + roofAt + X / 2, V = Y + roofAt - X / 2, hole = holes.get(Math.floor(U / CELL) + ',' + Math.floor(V / CELL));
    if (hole && (U % CELL) + (V % CELL) < CELL && !rayHit(cells, roofAt, X, Y, 0)) { hole[0]++; if (on) hole[1]++; }
  }
  const roof = Math.max(0, ...[...holes.values()].filter(([n]) => n > 60).map(([n, p]) => p / n));
  let big = 0;
  for (let s = 0; s < w * h; s++) if (cut[s] === 1) {
    let n = 0; const st = [s]; cut[s] = 2;
    while (st.length) { const p = st.pop(), x = p % w; n++; for (const q of [x ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < w * h && cut[q] === 1) { cut[q] = 2; st.push(q); } }
    big = Math.max(big, n);
  }
  return { cut: ncut / Math.max(1, paint), big: big / Math.max(1, paint), bare: bare / Math.max(1, block), roof };
}

// A box painted over a notch at the back of the footprint is the only wrong
// shape neither the fit nor the bake can fix, and the models paint one nearly
// every time. But from the camera's side a back notch hides the two walls round
// it (they face away), so a true L looks just like that box with its roof over
// the missing cell taken off, showing floor. carveBackNotches does that: at the
// height the model painted the roof (paintedRoof), it clears every pixel whose
// ray meets a back notch's column before any of the footprint's, and inks the
// new edge. A notch is at the back when no cell of the footprint lies behind it
// (a notch with a cell behind it shows walls, and the bake cuts it anyway).
export function carveBackNotches(pic, cells, wall) {
  const [X0, Y0] = viewBox(cells, wall), { w, h, data } = pic, D = DENSITY;
  const S = new Set(cells.map(c => c.join(','))), uw = Math.max(...cells.map(c => c[0])) + 1, vh = Math.max(...cells.map(c => c[1])) + 1;
  const back = [];
  for (let u = 0; u < uw; u++) for (let v = 0; v < vh; v++) if (!S.has(u + ',' + v) && !cells.some(([a, b]) => a <= u && b <= v)) back.push([u, v]);
  if (!back.length) return { pic, roofAt: null, hang: 0 };
  const roofAt = paintedRoof(pic, cells, wall);
  // clear what the ray meets in a back notch's column (up to the painted roof) before the footprint's
  const out = new Uint8ClampedArray(data), cleared = new Uint8Array(w * h), both = [...cells, ...back];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4;
    if (!data[o + 3]) continue;
    const r = rayHit(both, roofAt, X0 + (i + 0.5) / D, Y0 + (j + 0.5) / D, 0);
    if (r && back.some(([u, v]) => u === r.cell[0] && v === r.cell[1])) { out[o + 3] = 0; cleared[j * w + i] = 1; }
  }
  // what stood over the notch (a sign on a pole) is left hanging once its foot is
  // cleared: drop any small piece the cut split off from the building
  const lab = new Int32Array(w * h).fill(-1), sizes = [], touch = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (!out[s0 * 4 + 3] || lab[s0] >= 0) continue;
    const id = sizes.length, st = [s0]; let n = 0, t = false; lab[s0] = id;
    while (st.length) {
      const q = st.pop(), x = q % w; n++;
      for (const r of [x ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r < 0 || r >= w * h) continue;
        if (cleared[r]) t = true;
        if (out[r * 4 + 3] && lab[r] < 0) { lab[r] = id; st.push(r); }
      }
    }
    sizes.push(n); touch.push(t);
  }
  const main = sizes.indexOf(Math.max(...sizes)), total = sizes.reduce((a, b) => a + b, 0);
  for (let q = 0; q < w * h; q++) if (lab[q] >= 0 && lab[q] !== main && touch[lab[q]] && sizes[lab[q]] < 0.2 * total) { out[q * 4 + 3] = 0; cleared[q] = 1; }
  // What still hangs over the cut once the loose pieces are gone: kept paint with
  // cleared paint below it in its column. A sign's stub is a few pixels; a storey
  // the model stood over the notch is a slab, and no carving makes that right.
  // Over a back notch there is only what stood on its roof (the footprint's own
  // cells are beside it or below it on screen), so the rest of it goes too.
  let hang = 0, kept = 0;
  for (let i = 0; i < w; i++) { let below = false; for (let j = h - 1; j >= 0; j--) { const q = j * w + i; if (cleared[q]) below = true; else if (out[q * 4 + 3]) { kept++; if (below) { hang++; out[q * 4 + 3] = 0; cleared[q] = 1; } } } }
  // ink the cut: kept pixels next to a cleared one
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4;
    if (!out[o + 3]) continue;
    if ((i > 0 && cleared[j * w + i - 1]) || (i < w - 1 && cleared[j * w + i + 1]) || (j > 0 && cleared[(j - 1) * w + i]) || (j < h - 1 && cleared[(j + 1) * w + i])) out.set([30, 20, 40], o);
  }
  return { pic: { w, h, data: out }, roofAt, hang: hang / Math.max(1, kept) };
}

// The height the model painted the roof at, in frame pixels: models paint walls
// up to two and a half times the block's. Found by matching the painting's top
// outline to the footprint's at each height, over the columns where no notch
// changes the outline (a box painted over a notch would pull it off), taking the
// median miss so signs and roof kit in some columns don't count.
export function paintedRoof(pic, cells, wall) {
  const [X0, Y0] = viewBox(cells, wall), { w, h, data } = pic, D = DENSITY;
  const uw = Math.max(...cells.map(c => c[0])) + 1, vh = Math.max(...cells.map(c => c[1])) + 1;
  const box = []; for (let u = 0; u < uw; u++) for (let v = 0; v < vh; v++) box.push([u, v]);
  const topPaint = i => { for (let j = 0; j < h; j++) if (data[(j * w + i) * 4 + 3]) return Y0 + (j + 0.5) / D; return null; };
  // a prism's top outline is its cells' raised diamonds' top edges: cell (u, v)'s
  // top corner is at X = 32(u - v), Y = 16(u + v), and the edge falls half a pixel a pixel
  const topBlock = (cs, hh, X) => { let t = null; for (const [u, v] of cs) { const dx = Math.abs(X - (u - v) * CELL); if (dx <= CELL) { const y = (u + v) * CELL / 2 + dx / 2 - hh; if (t == null || y < t) t = y; } } return t; };
  const cols = [];
  for (let i = 0; i < w; i += 2) {
    const X = X0 + (i + 0.5) / D, t = topPaint(i), b = topBlock(cells, wall, X);
    if (t != null && b != null && b === topBlock(box, wall, X)) cols.push([X, t]);
  }
  let roofAt = wall, bestErr = Infinity;
  for (let hh = Math.round(wall * 0.6); hh <= wall * 4; hh++) {
    const errs = cols.map(([X, t]) => { const b = topBlock(cells, hh, X); return b == null ? 99 : Math.abs(t - b); }).sort((a, b) => a - b);
    const err = errs.length ? errs[errs.length >> 1] : Infinity;
    if (err < bestErr) { bestErr = err; roofAt = hh; }
  }
  return roofAt;
}
