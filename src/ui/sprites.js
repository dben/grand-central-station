import { tileDef } from '../data/tiles.js';
import { SPRITES, SPRITES_FLOOR, SPRITE_PAD, SPRITE_BLOCKS } from './tilesprites.js';

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
}
function get(id) {
  const e = cache.get(id);
  return e && e.ok ? e.img : null;
}
export function sprite(key) { const e = cache.get(key); return e && e.ok ? e.flat || e.img : null; }
// the whole over layer and its darkened copy, for drawing blocks
export function spriteBlockArt(key) { const e = cache.get(key); return e && e.ok && e.side ? { top: e.img, side: e.side } : null; }
export function spriteFloor(key) { return get('floor:' + key); }
