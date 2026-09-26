import { tileDef } from '../data/tiles.js';
import { SPRITES, SPRITES_FLOOR } from './tilesprites.js';

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
export const SPRITE_CELL_PX = 32;

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
    img.onload = () => { cache.get(id).ok = img.naturalWidth > 0; for (const fn of listeners) fn(key); };
    img.onerror = () => { cache.get(id).ok = false; };
    img.src = url;
  }
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
export function sprite(key) { return get(key); }
export function spriteFloor(key) { return get('floor:' + key); }
