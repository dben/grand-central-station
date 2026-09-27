import { tileDef } from '../data/tiles.js';
import { ISO_SHEETS, ISO_MAPS, ISO_FRAMES, GROUND_TEX, GROUND_BENDS } from './isosprites.js';

// The game's pictures: card headers (harness/cardart.mjs), and the board's
// isometric tile sheets and ground textures (harness/isoart.mjs, which writes
// their manifest, isosprites.js). The bundler (harness/build.js) inlines them
// all as data URIs in dist/.

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
    img.onerror = () => { Object.assign(cache.get(id), { ok: false, err: true }); };
    img.src = url;
  }
}
export function loadSprites(onLoad) {
  if (onLoad) listeners.add(onLoad);
  load(ISO_SHEETS, 'iso:');
  load(ISO_MAPS, 'isomap:');
  load(GROUND_TEX, 'ground:');
}
function get(id) {
  const e = cache.get(id);
  return e && e.ok ? e.img : null;
}
// A ground texture: 128 x 64, tiling the plane from the grid's origin.
export function groundImg(name) { return get('ground:' + name); }
// A rail bend's picture and where it sits: [x, y] squares from its corner, and its height in squares.
export function groundBend(key) { const img = get('ground:' + key), at = GROUND_BENDS[key]; return img && at ? { img, at } : null; }

// ---- isometric sheets -------------------------------------------------------
// Drawn by harness/isoart.mjs (the manifest is isosprites.js): each tile's art
// already projected to screen space, a cell's diamond 64 sheet pixels wide. A
// sheet is a plain picture, safe to touch up in an image editor: four frames,
// one per quarter turn, each the floor layer then the over layer, in the tile's
// own colours and light. Its `_map` image says which cell owns each pixel,
// which face it is on and how much of it is the tile's colour.
//
// The other four orientations are those frames flipped left to right, which is
// the grid's x and y swapped. The light stays on the right, so a flipped frame
// is relit: each pixel's face shade is divided out and the other side's put in.
// A full or closed tile is the same frame in a grey palette, and a tile in
// another colour than the sheet was drawn in shifts by its weight. Each way a
// sheet is shown is worked out once, then cut into a canvas per cell so the
// renderer can keep painting cell by cell.
export const ISO_CELL_PX = 64;
// whether a key has a sheet at all (loaded or not)
export const hasIso = key => !!ISO_FRAMES[key];
const FACE_SHADE = [1, 0.52, 0.70, 0.61];
const DIM = [70, 74, 84];
// The quarter turn m and flip that show a tile turned by `tf` (mirror first,
// then rot quarter turns): tf itself, or the flip (x, y) -> (y, x) of turn m.
const turn = ([x, y], n) => { for (let i = 0; i < n; i++) [x, y] = [-y, x]; return [x, y]; };
export function isoFrame(key, tf) {
  if (!ISO_FRAMES[key]) return null;
  if (!tf.mirror) return { m: tf.rot, flip: false };
  const want = turn([-1, 2], tf.rot);
  for (let m = 0; m < 4; m++) { const [x, y] = turn([1, 2], m); if (y === want[0] && x === want[1]) return { m, flip: true }; }
  return null;
}
const variants = new Map();
// Frame m of the sheet as shown: "u,v" -> { kind, floor, over }, each layer a
// { canvas, x, y } in frame coordinates. Null until both images have loaded, or
// if the browser won't let them be read back.
export function isoArt(key, m, tint, dim, swap) {
  const id = [key, m, tint, dim ? 1 : 0, swap ? 1 : 0].join('|');
  if (variants.has(id)) return variants.get(id);
  const man = ISO_FRAMES[key], img = get('iso:' + key), mapImg = get('isomap:' + key);
  // wait for the map too, unless it is missing: the picture alone still draws, unlit
  if (!man || !img || (!mapImg && !(cache.get('isomap:' + key) || {}).err)) return null;
  const read = (im, x, y, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(im, -x, -y); return g.getImageData(0, 0, w, h).data; };
  const t = hex3(tint), t0 = hex3(man.tint), shift = t.some((v, k) => v !== t0[k]);
  const shades = swap ? [FACE_SHADE[0], FACE_SHADE[2], FACE_SHADE[1], FACE_SHADE[3]] : FACE_SHADE;
  const out = new Map();
  try {
    for (const layer of ['floor', 'over']) {
      const r = man.frames[m][layer];
      if (!r) continue;
      const [sx, sy, w, h, fx, fy] = r, p = read(img, sx, sy, w, h), q = mapImg ? read(mapImg, sx, sy, w, h) : null;
      // sort the pixels into their cells; one painted in with no map goes to the cell under it
      const own = new Int32Array(w * h).fill(-1), boxes = new Map();
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const o = (j * w + i) * 4;
        if (!p[o + 3]) continue;
        let c = q && q[o + 3] ? q[o + 1] - 1 : -1;
        if (c < 0) c = nearestCell(man.frames[m].cells, fx + i + 0.5, fy + j + 0.5);
        own[j * w + i] = c;
        const b = boxes.get(c) || [i, j, i, j];
        boxes.set(c, [Math.min(b[0], i), Math.min(b[1], j), Math.max(b[2], i), Math.max(b[3], j)]);
      }
      for (const [c, [x0, y0, x1, y1]] of boxes) {
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const g = cv.getContext('2d'), data = g.createImageData(cw, ch), d = data.data;
        for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
          if (own[j * w + i] !== c) continue;
          const o = (j * w + i) * 4, e = ((j - y0) * cw + i - x0) * 4;
          const f = q && q[o + 3] ? Math.round(q[o] / 60) : 0, wt = q && q[o + 3] ? q[o + 2] / 100 : 0;
          const relit = shades[f] / FACE_SHADE[f];
          for (let k = 0; k < 3; k++) {
            let v = p[o + k] * relit;
            if (shift) v += wt * (t[k] - t0[k]) * shades[f];
            d[e + k] = dim ? 0.3 * v + 0.7 * DIM[k] : v;
          }
          d[e + 3] = p[o + 3];
        }
        g.putImageData(data, 0, 0);
        const [u, v, kind] = man.frames[m].cells[c], ck = u + ',' + v;
        if (!out.has(ck)) out.set(ck, { u, v, kind, floor: null, over: null });
        out.get(ck)[layer] = { canvas: cv, x: fx + x0, y: fy + y0 };
      }
    }
  } catch (e) { variants.set(id, null); return null; }
  variants.set(id, out);
  return out;
}
const hex3 = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
// The listed cell nearest the ground point under frame pixel (X, Y).
function nearestCell(cells, X, Y) {
  const U = Y + X / 2, V = Y - X / 2;
  let best = 0, bd = Infinity;
  cells.forEach(([u, v], i) => { const d = (U / 32 - u - 0.5) ** 2 + (V / 32 - v - 0.5) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}
