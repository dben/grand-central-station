import { tileDef } from '../data/tiles.js';
import { SPRITES, SPRITES_FLOOR, SPRITE_PAD, SPRITE_BLOCKS, SPRITE_SINKS } from './tilesprites.js';
import { ISO_SHEETS, ISO_FRAMES } from './isosprites.js';

// Board tile art, drawn by harness/tileart.mjs, which also writes the manifest
// (tilesprites.js): tile key -> PNG drawn top-down in the shape's BASE
// orientation (see src/sim/shapes.js) at 32px per cell, covering the bounding
// box. The renderer lays the image flat on the isometric grid, clips it to the
// tile's cells and turns it to match the placed orientation, so one image per
// layer covers every rotation. Missing files fall back to the flat colours.
// The bundler (harness/build.js) inlines these as data URIs in dist/.
//
// Tiles draw in two layers with the crowd between them (see render.js):
// SPRITES_FLOOR is the under layer - the ground a traveller stands on, like
// a lounge's seating or a shop's tiling - and SPRITES is the over layer, the
// roofs, canopies and vehicles that hide anyone under them. A tile may have
// either or both.
//
// SPRITE_PAD widens a tile's images by whole cells ([top, right, bottom, left])
// for art that lies past the board: a berth's ship, a jetway's airliner. The
// renderer shows that band in the cells beyond the edge the tile is placed on.
//
// SPRITE_BLOCKS lists rectangles of the over layer, in image pixels, that stand
// up off the ground: [x, y, w, h, z0, z1, round], heights in units of tile
// height. A round block narrows at the top and bottom: a tree top, a balloon.
// The renderer draws each as a stack of darkened copies from z0 up to z1 with
// the art itself on top, so a car's sides follow its own outline rather than a
// box's. The flat over layer is drawn with those rectangles cut out.
export const SPRITE_CELL_PX = 32;
export const spritePad = key => SPRITE_PAD[key] || null;
export const spriteBlocks = key => SPRITE_BLOCKS[key] || null;
// SPRITE_SINKS lists rectangles of the floor layer that step down into the
// ground: [x, y, w, h, d0, d1, dir, steps], cut into `steps` strips along
// `dir` (the way down, in the image) from depth d0 to d1. A flight of stairs,
// or with one step, a pool.
export const spriteSinks = key => SPRITE_SINKS[key] || null;

// Card headers, drawn by harness/cardart.mjs. A transport gets one per kind of
// ground it claims, so a card reads as road, water or air at a glance ('free'
// splits in two: the air tiles fly, the rest are the far-fetched ones). Every
// other card gets one per kind: food or other shops, parks, lounges, security,
// other utilities, the sci-fi rares, and the upgrade and bonus cards. The bridge
// is out of the shop for now, so it keeps its plain label.
export const CARD_ART = {
  road:        'assets/cards/road.png',
  rail:        'assets/cards/rail.png',
  water:       'assets/cards/water.png',
  apron:       'assets/cards/apron.png',
  sky:         'assets/cards/sky.png',
  corridor:    'assets/cards/corridor.png',
  underground: 'assets/cards/underground.png',
  free:        'assets/cards/free.png',
  food:        'assets/cards/food.png',
  retail:      'assets/cards/retail.png',
  park:        'assets/cards/park.png',
  lounge:      'assets/cards/lounge.png',
  utility:     'assets/cards/utility.png',
  future:      'assets/cards/future.png',
  upgrade:     'assets/cards/upgrade.png',
  bonus:       'assets/cards/bonus.png',
  security:    'assets/cards/security.png',
};
const CARD_SCENES = { upgrade: 'upgrade', named_upgrade: 'upgrade', ap: 'upgrade', card: 'bonus' };
function tileScene(def) {
  const tags = def.tags || [];
  if (def.kind === 'transport') return def.terrain === 'free' && tags.includes('air') ? 'sky' : def.terrain;
  if (def.rare) return 'future';
  if (def.special === 'green') return 'park';
  if (def.special === 'waiting') return 'lounge';
  if (def.special === 'security' || def.special === 'gate') return 'security';
  if (def.rate === 0) return 'utility';
  return tags.includes('food') ? 'food' : 'retail';
}
export const cardArt = card => CARD_ART[card.type === 'tile' ? tileScene(tileDef(card.key)) : CARD_SCENES[card.type]] || null;

const cache = new Map();
// Every image is loaded once, but several views may be waiting on it: the board
// and each of the start screen's mode thumbnails all want a repaint when one
// lands, so listeners are kept per module rather than per load() call.
const listeners = new Set();
function load(manifest, prefix) {
  for (const [key, url] of Object.entries(manifest)) {
    const id = prefix + key;
    if (cache.has(id) || !url) continue;
    const img = new Image();
    cache.set(id, { img, ok: false });
    img.onload = () => { Object.assign(cache.get(id), { ok: img.naturalWidth > 0 }, prefix ? {} : bake(img, key)); for (const fn of listeners) fn(key); };
    img.onerror = () => { cache.get(id).ok = false; };
    img.src = url;
  }
}
// The two copies a tile with blocks needs: the over layer with the blocks cut
// out (drawn flat), and a darkened one for the blocks' sides. A side is what
// shows of each copy's rim, and the rim is the ink outline, so the side copy
// first paints the outline over in the colour just inside it: the side of a red
// car reads dark red rather than black.
const isInk = (p, i) => p[i + 3] && p[i] < 24 && p[i + 1] < 16 && p[i + 2] < 48;
function bake(img, key) {
  const blocks = SPRITE_BLOCKS[key];
  if (!blocks) return {};
  const copy = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return [c, x]; };
  const [flat, fx] = copy();
  for (const [x, y, w, h] of blocks) fx.clearRect(x, y, w, h);
  const [side, sx] = copy(), W = side.width, H = side.height;
  let data;
  // a canvas the browser won't read back: fall back to plain darkening
  try { data = sx.getImageData(0, 0, W, H); } catch (e) { sx.globalCompositeOperation = 'source-atop'; sx.fillStyle = 'rgba(10,5,32,0.4)'; sx.fillRect(0, 0, W, H); return { flat, side }; }
  const p = data.data;
  for (let pass = 0; pass < 2; pass++) {
    const src = p.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!isInk(src, i)) continue;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy, j = (ny * W + nx) * 4;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && src[j + 3] && !isInk(src, j)) { p[i] = src[j]; p[i + 1] = src[j + 1]; p[i + 2] = src[j + 2]; break; }
      }
    }
  }
  for (let i = 0; i < p.length; i += 4) { p[i] *= 0.62; p[i + 1] *= 0.6; p[i + 2] *= 0.68; }
  sx.putImageData(data, 0, 0);
  return { flat, side };
}
export function loadSprites(onLoad) {
  if (onLoad) listeners.add(onLoad);
  load(SPRITES, '');
  load(SPRITES_FLOOR, 'floor:');
  load(ISO_SHEETS, 'iso:');
}
function get(id) {
  const e = cache.get(id);
  return e && e.ok ? e.img : null;
}
export function sprite(key) { const e = cache.get(key); return e && e.ok ? e.flat || e.img : null; }
// the whole over layer and its darkened copy, for drawing blocks
export function spriteBlockArt(key) { const e = cache.get(key); return e && e.ok && e.side ? { top: e.img, side: e.side } : null; }
export function spriteFloor(key) { return get('floor:' + key); }

// ---- isometric sheets -------------------------------------------------------
// Drawn by harness/isoart.mjs (the manifest is isosprites.js): each tile's art
// already projected to screen space, a cell's diamond 64 sheet pixels wide, cut
// into one piece per cell. A sheet stores four frames, one per quarter turn;
// the other four orientations are those frames flipped left to right, which is
// the grid's x and y swapped. Its pixels are neutral: base colour + weight x the
// tile's colour, with a face index (top, left, right) to light them by. So one
// sheet is coloured and lit at load for each way it is shown: its colour, full
// or closed (a grey palette), and flipped or not (the light stays on the right,
// so a flipped frame's faces swap shades).
export const ISO_CELL_PX = 64;
const FACE_SHADE = [1, 0.52, 0.70, 0.61];
const DIM = [70, 74, 84];
// The quarter turn m and flip that show a tile turned by `tf` (mirror first,
// then rot quarter turns): tf itself, or the flip (x, y) -> (y, x) of turn m.
const turn = ([x, y], n) => { for (let i = 0; i < n; i++) [x, y] = [-y, x]; return [x, y]; };
export function isoFrame(key, tf) {
  const f = ISO_FRAMES[key];
  if (!f) return null;
  if (!tf.mirror) return { m: tf.rot, flip: false, frame: frameCells(key, tf.rot) };
  const want = turn([-1, 2], tf.rot);
  for (let m = 0; m < 4; m++) { const [x, y] = turn([1, 2], m); if (y === want[0] && x === want[1]) return { m, flip: true, frame: frameCells(key, m) }; }
  return null;
}
// a frame's pieces by the cell that owns them: "u,v" -> { floor: [], over: [] }
const cellMaps = new Map();
function frameCells(key, m) {
  const id = key + '#' + m;
  if (!cellMaps.has(id)) {
    const map = new Map(), fr = ISO_FRAMES[key].frames[m];
    for (const layer of ['floor', 'over']) for (const p of fr[layer] || []) {
      const k = p[0] + ',' + p[1];
      if (!map.has(k)) map.set(k, { floor: [], over: [] });
      map.get(k)[layer].push(p);
    }
    cellMaps.set(id, map);
  }
  return cellMaps.get(id);
}
const variants = new Map();
// The sheet coloured `tint`, greyed if `dim`, lit for a flipped frame if `swap`;
// null until it has loaded (or if the browser won't let it be read back).
export function isoArt(key, tint, dim, swap) {
  const id = key + '|' + tint + '|' + (dim ? 1 : 0) + (swap ? 1 : 0);
  if (variants.has(id)) return variants.get(id);
  const img = get('iso:' + key), half = ISO_FRAMES[key] && ISO_FRAMES[key].half;
  if (!img || !half) return null;
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = half;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  let data, ctl;
  try { data = x.getImageData(0, 0, c.width, half); x.clearRect(0, 0, c.width, half); x.drawImage(img, 0, -half); ctl = x.getImageData(0, 0, c.width, half).data; }
  catch (e) { variants.set(id, null); return null; }
  const p = data.data, t = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16));
  const shades = swap ? [FACE_SHADE[0], FACE_SHADE[2], FACE_SHADE[1], FACE_SHADE[3]] : FACE_SHADE;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const w = ctl[i] / 100, f = shades[Math.round(ctl[i + 1] / 60)] || 1;
    for (let k = 0; k < 3; k++) {
      const v = Math.min(255, p[i + k] + w * t[k]) * f;
      p[i + k] = dim ? 0.3 * v + 0.7 * DIM[k] : v;
    }
  }
  x.clearRect(0, 0, c.width, half);
  x.putImageData(data, 0, 0);
  variants.set(id, c);
  return c;
}
