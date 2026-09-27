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
