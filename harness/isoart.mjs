#!/usr/bin/env node
// Bakes the board tiles into isometric sprite sheets, drawn in screen space:
//   node harness/isoart.mjs [key ...]   -> assets/iso/<key>.png and <key>_map.png, assets/ground/*.png
//                                          and the manifest, src/ui/isosprites.js
// Naming keys rewrites only those sheets; the ground and the manifest are always rewritten.
// The drawings are tileart.mjs's own top-down art. This ray-casts them once, here,
// into the classic 2:1 pixel projection (a cell is a 64x32 diamond, and a tile
// height unit is 64 * H_UNIT pixels), with the walls, the vehicles and the tree
// tops stood up as solid shapes. The renderer then only copies pixels.
//
// The sheets it writes are plain pictures, safe to touch up in an image editor
// (see the baking section below for the layout and the map that goes with them).
// Mirroring halves the drawing: of a tile's eight orientations only the four
// turns are baked, and the game flips them for the rest and relights the flip
// from the map. Vehicles are sprite stacks (c.stack in tileart.mjs): drawn slice
// by slice from the wheels up, so their sides carry their own detail, and free
// to reach past the tile (an airliner's wings over the next squares).
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { drawAll, CELL, hex } from './tileart.mjs';
import { tileDef } from '../src/data/tiles.js';
import { tileHeight, H_UNIT, colorForDef, EDGE_MARGIN, TURN_R } from '../src/ui/render.js';
import { SHOPS, FLOORS, DENSITY, KEEP_ROOM, shopViews, turnCells, wallHeight, viewBox, floorBox, rayHit } from './shopart.mjs';
import { decodePng, encodePng, quantize } from './png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HZ = 2 * CELL * H_UNIT;          // screen pixels per unit of tile height
const TA = 48, TB = 176;               // the two greys each sheet is drawn in
const GLASS_A = 0.2;                   // a glass box's panes: a faint wash of the tile's colour
// A flush tile's over layer (the tree tops in a park) hangs this high above the
// crowd, in units of tile height, with no walls under it.
const CANOPY_Z = 0.32;

// Hex strings to [r, g, b, a] once, so the ray loop does no parsing.
const rgba = v => v ? [...hex(v), v.length > 7 ? parseInt(v.slice(7, 9), 16) / 255 : 1] : null;
const isInk = p => p && p[0] < 24 && p[1] < 16 && p[2] < 48;

// One drawn tile (floor and over sheets from tileart) in one grey, ready to cast.
// `only`: undefined for the tile itself, which leaves its vehicles out, or a
// vehicle's group, for that vehicle alone (and its shadow) with no tile under it.
function scene(key, layers, grey, only) {
  const any = layers.floor || layers.over;
  const { W, H, IW, IH, ox, oy, inside } = any;
  const def = tileDef(key.replace(/_lane(_alt)?$/, '')), lane = /_lane(_alt)?$/.test(key);
  const z = lane ? 0 : tileHeight(def);
  const px = s => s ? s.px.map(rgba) : null;
  const floor = px(layers.floor), over = px(layers.over);
  const blocks = (layers.over ? layers.over.blocks : []).map(b => {
    const [x, y, w, h, z0, z1, round] = b;
    return { x, y, w, h, lo: z0 * HZ, hi: z1 * HZ, round: !!round, cx: x + w / 2, cy: y + h / 2, stack: b.stack };
  });
  const vehicle = only !== undefined, cast = blocks.filter(b => vehicle ? b.stack && b.stack.group === only : !b.stack);
  // the flat part of the over layer: what no block stands up. A stack's cut
  // takes in the ink outline its top-down drawing has round it.
  const cut = blocks.map(b => b.stack ? { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 } : b);
  const flat = over && over.map((p, i) => { const x = i % IW, y = (i / IW) | 0; return cut.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ? null : p; });
  // a block's sides: its art with the ink outline painted over in the colour
  // just inside it, so a red car's side reads red rather than black
  let side = over && over.slice();
  for (let pass = 0; side && pass < 2; pass++) {
    const src = side.slice();
    for (let i = 0; i < src.length; i++) if (isInk(src[i])) {
      const x = i % IW, y = (i / IW) | 0;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) { const j = (y + dy) * IW + x + dx; if (x + dx >= 0 && y + dy >= 0 && x + dx < IW && y + dy < IH && src[j] && !isInk(src[j])) { side[i] = src[j]; break; } }
    }
  }
  const sinks = [];
  for (const [x, y, w, h, d0, d1, dir, n] of (layers.floor ? layers.floor.sinks : [])) for (let i = 0; i < n; i++) {
    const r = dir === 'E' ? [x + w * i / n, y, w / n, h] : dir === 'W' ? [x + w * (n - 1 - i) / n, y, w / n, h]
      : dir === 'S' ? [x, y + h * i / n, w, h / n] : [x, y + h * (n - 1 - i) / n, w, h / n];
    sinks.push({ x: r[0], y: r[1], w: r[2], h: r[3], d: (n > 1 ? d0 + (d1 - d0) * i / (n - 1) : d1) * HZ });
  }
  // what the frame must cover: the drawing and its band, and any vehicle that
  // reaches past them (an airliner's wings over the next squares)
  const ext = [-ox, -oy, IW - ox, IH - oy];
  for (const b of cast) if (b.stack) {
    ext[0] = Math.min(ext[0], b.x - ox); ext[1] = Math.min(ext[1], b.y - oy); ext[2] = Math.max(ext[2], b.x + b.w - ox); ext[3] = Math.max(ext[3], b.y + b.h - oy);
  }
  const s = vehicle
    ? { key, def, lane, z: 0, hz: 0, W, H, IW, IH, ox, oy, inside, ext, floor: [], over, flat: null, side, blocks: cast, sinks, tint: [grey, grey, grey], vehicle, glass: false, flush: true, canopy: false }
    : { key, def, lane, z, hz: z * HZ, W, H, IW, IH, ox, oy, inside, ext, floor, over, flat, side, blocks: cast, sinks, tint: [grey, grey, grey],
      glass: z > 0 && !!floor, flush: z <= 0, canopy: z <= 0 && !lane && !!over && !sinks.length,
      // A transport is open: no panes or rim round it, only its floor and what stands on
      // it. The glass box stays on the walk-in rooms (the lounges, the checkpoint).
      open: def.kind === 'transport' };
  // The shadows on the floor: every point of a block above the ground, carried
  // down along the light (SUN art pixels across per pixel of height, toward +x
  // and +y) to where it meets the floor. A car's shadow is its own shape, and a
  // tree top's or an airliner's falls clear of it by its height.
  s.shadow = new Set();
  for (const b of cast) for (let h = Math.max(1, Math.ceil(b.lo)); h <= b.hi; h++) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const u = x - ox, v = y - oy;
      if (blockAt(s, b, u, v, h)) s.shadow.add(Math.floor(u + SUN * h) + ',' + Math.floor(v + SUN * h));
    }
  }
  if (s.open && flat) for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    if (!flat[y * IW + x]) continue;
    for (let h = 1; h <= s.hz; h++) s.shadow.add(Math.floor(x - ox + SUN * h) + ',' + Math.floor(y - oy + SUN * h));
  }
  return s;
}
// the light's slope: a pixel of height throws its shadow this far across
const SUN = 0.45;
const SHADOW = [10, 5, 32, 0.38];   // a shadow on nothing drawn (the band past the edge): see-through

// ---- PNG: written with node's own zlib, so the harness needs no dependencies ----
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

const rgbaOf = (w, h, px) => { const data = new Uint8ClampedArray(w * h * 4); px.forEach((v, i) => { if (v) data.set([...hex(v), v.length > 7 ? parseInt(v.slice(7, 9), 16) : 255], i * 4); }); return { w, h, data }; };

// ---- casting ---------------------------------------------------------------
// Frame m is the base image turned m quarter turns (shapeTransform's convention:
// (x, y) -> (-y, x) about the bounding box's centre). A frame pixel (U, V) is an
// art pixel of the turned bounding box; toBase takes it back to the drawing.
function frameOf(s, m) {
  const [W2, H2] = m % 2 ? [s.H, s.W] : [s.W, s.H];
  const toBase = (U, V) => {
    let x = U - W2 / 2, y = V - H2 / 2;
    for (let i = 0; i < m; i++) [x, y] = [y, -x];
    return [Math.floor(x + s.W / 2), Math.floor(y + s.H / 2)];
  };
  // the padded image's corners, turned, bound the frame
  const [e0, e1, e2, e3] = s.ext;
  const pts = [[e0, e1], [e2, e1], [e0, e3], [e2, e3]].map(([u, v]) => {
    let x = u - s.W / 2, y = v - s.H / 2;
    for (let i = 0; i < m; i++) [x, y] = [-y, x];
    return [x + W2 / 2, y + H2 / 2];
  });
  const U0 = Math.min(...pts.map(p => p[0])), U1 = Math.max(...pts.map(p => p[0]));
  const V0 = Math.min(...pts.map(p => p[1])), V1 = Math.max(...pts.map(p => p[1]));
  return { m, W2, H2, toBase, U0, U1, V0, V1 };
}

const at = (s, arr, u, v) => { const i = u + s.ox, j = v + s.oy; return arr && i >= 0 && j >= 0 && i < s.IW && j < s.IH ? arr[j * s.IW + i] : null; };
const inPad = (s, u, v) => u >= -s.ox && v >= -s.oy && u < s.IW - s.ox && v < s.IH - s.oy;
const sinkAt = (s, u, v) => { const x = u + s.ox, y = v + s.oy; return s.sinks.find(k => x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h); };
// What block b shows at art pixel (u, v) and height h: its top-down art on top
// and its ink-free copy down the sides, or for a sprite stack, the slice at
// that height. Null where the block isn't.
const stackPx = new Map();
function blockAt(s, b, u, v, h, top = false) {
  // a slab thinner than a pixel (a haul cable) still gets its one row
  if (h < Math.floor(b.lo) || h > b.hi) return null;
  let x = u + s.ox + 0.5, y = v + s.oy + 0.5;
  if (b.round) { const f = 0.55 + 0.45 * Math.sin(Math.PI * (0.15 + 0.8 * (h - b.lo) / (b.hi - b.lo))); x = b.cx + (x - b.cx) / f; y = b.cy + (y - b.cy) / f; }
  x = Math.floor(x); y = Math.floor(y);
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return null;
  // a stack's plan may reach past the drawing (an airliner's wings)
  const i = y * s.IW + x, k = b.stack, drawn = x >= 0 && y >= 0 && x < s.IW && y < s.IH;
  if (k) {
    // t runs over the block's pixel rows, so the top row is t = 1: the roof
    const lo = Math.floor(b.lo), p = k.fn(k.vertical ? y - b.y : x - b.x, k.vertical ? x - b.x : y - b.y, Math.max(0, Math.min(1, (h - lo) / Math.max(1, Math.floor(b.hi) - lo))));
    if (p === 'top') return drawn ? s.over[i] : null;
    if (p && !stackPx.has(p)) stackPx.set(p, rgba(p));
    return p ? stackPx.get(p) : null;
  }
  return drawn && s.over[i] ? (top ? s.over[i] : s.side[i]) : null;
}
const scale = (p, f) => [p[0] * f, p[1] * f, p[2] * f, p[3]];
const LEFT = 1, RIGHT = 2, MID = 3;

// What a ray through frame pixel (X, Y) sees in one layer, front to back.
// Returns { c: [r, g, b], a, face, cell } or null. Contributions under alpha 1
// (glass panes, washes) are composited and the ray carries on behind them.
function cast(s, f, X, Y, layer) {
  let C = [0, 0, 0], A = 0, face = 0, best = 0, cell = null, near = 0;
  const hit = () => ({ c: C.map(v => v / A), a: A, face, cell, near });
  const add = (p, fc, U, V) => {
    if (!p || p[3] <= 0) return false;
    const w = (1 - A) * p[3];
    for (let k = 0; k < 3; k++) C[k] += w * p[k];
    A += w;
    if (w > best) { best = w; face = fc; }
    // how near the camera the first thing the ray meets is: U + V grows toward the viewer
    if (!cell) { cell = [Math.floor(U / CELL), Math.floor(V / CELL)]; near = U + V; }
    return A > 0.99;
  };
  const t = s.tint, hTop = layer === 'over' ? Math.ceil(Math.max(s.hz, s.canopy ? CANOPY_Z * HZ : 0, ...s.blocks.map(b => b.hi))) : 0;
  const hBot = -Math.ceil(Math.max(0, ...s.sinks.map(k => k.d)));
  let wasIn = false;
  for (let h = hTop; h >= hBot; h--) {
    const U = Y + 0.5 + h + (X + 0.5) / 2, V = Y + 0.5 + h - (X + 0.5) / 2;
    const [u, v] = f.toBase(U, V);
    // which side of a shape the ray came in through: left (a south face) where the
    // shape ends in front of it along V, right (an east face) where it ends along
    // U, and the middle shade where a curve runs between the two. Looking a few
    // pixels out keeps a round bow from striping light and dark pixel by pixel.
    const faceOf = test => {
      let l = 0, r = 0;
      for (let k = 1; k <= 3; k++) { if (!test(...f.toBase(U, V + k))) l += 4 - k; if (!test(...f.toBase(U + k, V))) r += 4 - k; }
      return l > r ? LEFT : r > l ? RIGHT : MID;
    };
    // past the drawing: open air above the ground, the ground itself at it,
    // and whatever part of a vehicle reaches out there
    if (!inPad(s, u, v)) {
      if (h < 0) break;
      wasIn = false;
      if (layer === 'over') for (const b of s.blocks) {
        const p = b.stack && blockAt(s, b, u, v, h);
        if (!p) continue;
        const top = h + 1 > b.hi || !blockAt(s, b, u, v, h + 1);
        if (add(p, top ? 0 : faceOf((a, c) => blockAt(s, b, a, c, h) != null), U, V)) return hit();
      }
      if (h === 0) break;
      continue;
    }
    const foot = s.inside(u, v);
    if (layer === 'over') {
      for (const b of s.blocks) {
        let p = blockAt(s, b, u, v, h);
        if (!p) continue;
        // a top face: the top of the block, or in a stack, any slice with
        // nothing over it (a car's bonnet in front of its cabin)
        const top = h + 1 > b.hi || (b.stack && !blockAt(s, b, u, v, h + 1));
        if (top && !b.stack) p = blockAt(s, b, u, v, h, true);
        if (add(p, top ? 0 : faceOf((a, c) => blockAt(s, b, a, c, h) != null), U, V)) return hit();
      }
      if (!s.flush && foot && h >= 0 && h <= s.hz) {
        const top = h + 1 > s.hz;
        if (s.open) {
          // an open transport: what stood on its box's top (a shelter, a sign, a canopy)
          // stands up from the floor as a solid piece instead of floating
          const p = at(s, s.flat, u, v);
          if (p) {
            const flatAt = (a, c) => !!at(s, s.flat, a, c);
            if (top ? add(p, 0, U, V) : add(at(s, s.side, u, v) || p, faceOf(flatAt), U, V)) return hit();
          }
        } else if (s.glass) {
          if (top) {
            // the rim round the open top, then anything standing on it (a shelter, a sign)
            const rim = !s.open && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dv]) => !s.inside(u + du, v + dv));
            if (add(at(s, s.flat, u, v) || (rim ? [...scale(t, 1.35).slice(0, 3), 0.9] : null), 0, U, V)) return hit();
          }
          else if (!wasIn && !s.open) {
            // a pane: its frame round the top edge and down the corners
            const fc = faceOf((a, c) => s.inside(a, c)), [p, q] = f.toBase(U + (fc === LEFT ? 1 : 0), V + (fc === LEFT ? 0 : 1)), [p2, q2] = f.toBase(U - (fc === LEFT ? 1 : 0), V - (fc === LEFT ? 0 : 1));
            const edge = h + 2.5 > s.hz || h < 1 || !s.inside(p, q) || !s.inside(p2, q2);
            if (add(edge ? [...scale(t, 1.35).slice(0, 3), 0.9] : [...t, GLASS_A], fc, U, V)) return hit();
          }
        } else {
          let p;
          if (top) p = at(s, s.over, u, v) || [...t, 1];
          else {
            // a building's wall: a lit top course, a dark footing, a seam per cell
            const fc = faceOf((a, c) => s.inside(a, c)), along = fc === LEFT ? U : V;
            const k = h > s.hz - 2 ? 1.14 : h < 2 ? 0.78 : Math.floor(along) % CELL === 0 ? 0.88 : 1;
            p = [...scale(t, k).slice(0, 3), 1];
            if (add(p, fc, U, V)) return hit();
            continue;
          }
          if (add(p, 0, U, V)) return hit();
        }
      }
      if (s.canopy && foot && h <= CANOPY_Z * HZ && h + 1 > CANOPY_Z * HZ) { if (add(at(s, s.flat, u, v), 0, U, V)) return hit(); }
      wasIn = foot;
      // the ground: the floor layer has it. A sink's opening lets the ray on down.
      if (h <= 0) { const k = sinkAt(s, u, v); if (!k || h <= -k.d) break; }
    } else {
      // the ground, or a step's tread: the floor art, lowered to its depth
      const depth = (p, q) => { const k = sinkAt(s, p, q); return k ? k.d : 0; }, d = depth(u, v);
      if (h > -d) continue;
      // a vehicle's own sheet has no floor: only its shadow, washed over the tile's
      if (s.vehicle) { if (h === 0 && s.shadow.has(u + ',' + v)) add(SHADOW, 0, U, V); break; }
      if (h > -d - 1) {
        // on the ground, a shadow darkens the floor, or where there is none, is a wash
        const p = at(s, s.floor, u, v), dark = h === 0 && s.shadow.has(u + ',' + v), band = u < 0 || v < 0 || u >= s.W || v >= s.H;
        add(dark ? p ? [p[0] * 0.62, p[1] * 0.62, p[2] * 0.62, p[3]] : band ? SHADOW : null : p, 0, U, V);
        break;
      }
      // under it: the side of the pit, or the riser of the step above the one
      // the ray came down into, facing the camera across the opening
      add([...scale(t, 0.95).slice(0, 3), 1], faceOf((p, q) => depth(p, q) <= -h), U, V);
      break;
    }
  }
  return A > 0 ? hit() : null;
}

// Cast one frame of one layer: a map of screen pixel -> hit, and its bounds.
function castFrame(s, f, layer) {
  const X0 = Math.floor(f.U0 - f.V1) - 1, X1 = Math.ceil(f.U1 - f.V0) + 1;
  const top = layer === 'over' ? Math.ceil(Math.max(s.hz, CANOPY_Z * HZ, ...s.blocks.map(b => b.hi))) : 0;
  const Y0 = Math.floor((f.U0 + f.V0) / 2) - top - 1, Y1 = Math.ceil((f.U1 + f.V1) / 2) + 1;
  const out = new Map();
  for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
    const r = cast(s, f, X, Y, layer);
    if (r && r.a > 0.004) out.set(X + ',' + Y, r);
  }
  return out;
}

// ---- baking ----------------------------------------------------------------
// Each tile's sheet is an ordinary picture: its four turns, one row each, the
// floor layer then the over layer, whole and in their real colours and light,
// so it can be opened and touched up in any image editor. `<key>_map.png`, the
// same layout, carries what the picture can't: which cell owns each pixel
// (green: index + 1 into the manifest's cell list), the face it is on (red:
// face x 60) and how much of it is the tile's colour (blue: weight x 100). A
// pixel painted in later with no map under it goes to the cell beneath it.
const want = process.argv.slice(2);
const grey = v => '#' + v.toString(16).padStart(2, '0').repeat(3);
const A = drawAll(() => grey(TA)), B = drawAll(() => grey(TB));
const dir = resolve(root, 'assets/iso');
mkdirSync(dir, { recursive: true });
const manifest = {};
const toHex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
let written = 0;
// A shop painted by shopgen.mjs is baked from its pictures instead: each turn
// is its view's picture, flipped where the turn is that footprint swapped, cut
// to the footprint's columns, each pixel given the cell shopart.mjs's ray says.
// The paintings carry their own light, so every pixel's face is 0 and nothing
// is relit, here or when the game mirrors a turn.
function shopFrames(key) {
  const { views, turns } = shopViews(key), wall = wallHeight(key);
  const pics = views.map((_, v) => resolve(root, `assets/shops/${key}_${v}.png`));
  if (!pics.every(p => existsSync(p))) return null;
  const imgs = pics.map(p => decodePng(readFileSync(p)));
  return turns.map(({ view, flip }, m) => {
    const cells = turnCells(key, m), img = imgs[view], [X0, Y0] = viewBox(views[view], wall), list = [];
    for (let j = 0; j < img.h; j++) for (let i = 0; i < img.w; i++) {
      const o = (j * img.w + i) * 4;
      if (!img.data[o + 3]) continue;
      // a flipped turn is the picture mirrored about the frame's X = 0
      const X = flip ? -(X0 * DENSITY + i) - 1 : X0 * DENSITY + i, r = rayHit(cells, wall, (X + 0.5) / DENSITY, Y0 + (j + 0.5) / DENSITY, KEEP_ROOM);
      if (!r) continue;
      list.push({ X, Y: Y0 * DENSITY + j, c: [0, 1, 2].map(k => img.data[o + k]), a: img.data[o + 3] / 255, w: 0, face: 0, cell: cells.findIndex(c => c[0] === r.cell[0] && c[1] === r.cell[1]) });
    }
    const x0 = Math.min(...list.map(p => p.X)), y0 = Math.min(...list.map(p => p.Y));
    return { cells: cells.map(([u, v]) => [u, v, 0]), over: { x0, y0, w: Math.max(...list.map(p => p.X)) - x0 + 1, h: Math.max(...list.map(p => p.Y)) - y0 + 1, list } };
  });
}

// A walk-through tile painted by floorgen.mjs: each turn's floor and over layers
// from its view's two pictures, mirrored for a flipped turn. A floor pixel goes
// to the cell under it; an over pixel (a tree top, a glass rim) to the cell
// whose column it meets at the canopy's height, so a tree draws with its trunk.
function floorFrames(key) {
  const { views, turns } = shopViews(key), f = (v, l) => resolve(root, `assets/floors/${key}_${v}_${l}.png`);
  if (!views.every((_, v) => existsSync(f(v, 'floor')))) return null;
  const imgs = views.map((_, v) => ({ floor: decodePng(readFileSync(f(v, 'floor'))), over: decodePng(readFileSync(f(v, 'over'))) }));
  return turns.map(({ view, flip }, m) => {
    const cells = turnCells(key, m), [X0, Y0] = floorBox(views[view]), fr = { cells: cells.map(([u, v]) => [u, v, 0]) };
    for (const l of ['floor', 'over']) {
      const img = imgs[view][l], list = [];
      for (let j = 0; j < img.h; j++) for (let i = 0; i < img.w; i++) {
        const o = (j * img.w + i) * 4;
        if (!img.data[o + 3]) continue;
        const X = flip ? -(X0 * DENSITY + i) - 1 : X0 * DENSITY + i, Y = Y0 * DENSITY + j;
        const r = rayHit(cells, l === 'floor' ? 0.01 : CANOPY_Z * HZ, (X + 0.5) / DENSITY, (Y + 0.5) / DENSITY, l === 'floor' ? 4 : 60);
        const cell = r ? cells.findIndex(c => c[0] === r.cell[0] && c[1] === r.cell[1]) : 0;
        list.push({ X, Y, c: [0, 1, 2].map(k => img.data[o + k]), a: img.data[o + 3] / 255, w: 0, face: 0, cell });
      }
      if (!list.length) continue;
      const x0 = Math.min(...list.map(p => p.X)), y0 = Math.min(...list.map(p => p.Y));
      fr[l] = { x0, y0, w: Math.max(...list.map(p => p.X)) - x0 + 1, h: Math.max(...list.map(p => p.Y)) - y0 + 1, list };
    }
    return fr;
  });
}

// A tile upscaled by upscale.mjs: each code pixel becomes DENSITY x DENSITY, with
// its layer, cell, face and weight, coloured from the painting where the painting
// covers it. A pixel under a translucent pane, or a pane itself, keeps the code
// colour for the pane (the painting shows the two mixed), and so does floor under
// something opaque, which the painting can't show.
function upscaled(key, frames) {
  const logf = resolve(root, 'assets/paint/log.json'), log = existsSync(logf) ? JSON.parse(readFileSync(logf, 'utf8'))[key] : null;
  const pic = m => resolve(root, `assets/paint/${key}_${m}.png`);
  // a turn with no painting (the painting fitted too badly to use) keeps its code colours, at the same density
  if (!log || !log.code || ![0, 1, 2, 3].every(m => log.code[m]) || ![0, 1, 2, 3].some(m => existsSync(pic(m)))) return false;
  frames.forEach((fr, m) => {
    const img = existsSync(pic(m)) ? decodePng(readFileSync(pic(m))) : { w: 0, h: 0, data: [] }, [cx, cy] = log.code[m];
    const over = new Map((fr.over ? fr.over.list : []).map(q => [q.X + ',' + q.Y, q]));
    for (const l of ['floor', 'over']) {
      if (!fr[l]) continue;
      const list = [];
      for (const q of fr[l].list) {
        const o = over.get(q.X + ',' + q.Y), keep = l === 'over' ? q.a < 0.9 : !!o && o.a >= 0.9;
        for (let dy = 0; dy < DENSITY; dy++) for (let dx = 0; dx < DENSITY; dx++) {
          const X = q.X * DENSITY + dx, Y = q.Y * DENSITY + dy, i = X - cx * DENSITY, j = Y - cy * DENSITY;
          const k = (j * img.w + i) * 4, has = !keep && i >= 0 && j >= 0 && i < img.w && j < img.h && img.data[k + 3];
          list.push({ ...q, X, Y, c: has ? [img.data[k], img.data[k + 1], img.data[k + 2]] : q.c });
        }
      }
      fr[l] = { x0: fr[l].x0 * DENSITY, y0: fr[l].y0 * DENSITY, w: fr[l].w * DENSITY, h: fr[l].h * DENSITY, list };
    }
  });
  return true;
}

// The bake: each tile without its vehicles, then each vehicle as a sheet of its
// own, `<key>_veh<n>`, with the same turns and cells, so the game can draw it
// over the tile, or somewhere else.
const jobs = [], vehicles = {}, tileOver = {};
for (const key of Object.keys(A)) {
  jobs.push({ key, base: key, only: undefined });
  const groups = [...new Set((A[key].over ? A[key].over.blocks : []).filter(b => b.stack).map(b => b.stack.group))];
  groups.forEach((g, n) => { jobs.push({ key: `${key}_veh${n}`, base: key, only: g }); (vehicles[key] = vehicles[key] || []).push(`${key}_veh${n}`); });
}
for (const { key, base, only } of jobs) {
  const sa = scene(base, A[base], TA, only), sb = scene(base, B[base], TB, only);
  const tint = colorForDef(sa.def), T = hex(tint);
  const shop = SHOPS[key] ? shopFrames(key) : FLOORS[key] ? floorFrames(key) : null;
  const frames = shop || [];
  // the band's sides: where the drawing is padded past the bounding box
  const padded = [sa.oy > 0, sa.IW - sa.ox > sa.W, sa.IH - sa.oy > sa.H, sa.ox > 0];
  for (let m = 0; !shop && m < 4; m++) {
    const f = frameOf(sa, m), fr = { cells: [] }, cellIx = new Map();
    // a cell of this turn: 0 under the tile, 1 past a padded side (the band,
    // shown only past the edge it works from), 2 anywhere else it reaches (a wing)
    const cellOf = (cu, cv) => {
      const k = cu + ',' + cv;
      if (!cellIx.has(k)) {
        const [u, v] = f.toBase((cu + 0.5) * CELL, (cv + 0.5) * CELL);
        const band = (v < 0 && padded[0]) || (u >= sa.W && padded[1]) || (v >= sa.H && padded[2]) || (u < 0 && padded[3]);
        cellIx.set(k, fr.cells.length); fr.cells.push([cu, cv, sa.inside(u, v) ? 0 : band ? 1 : 2]);
      }
      return cellIx.get(k);
    };
    for (const layer of ['floor', 'over']) {
      if (layer === 'floor' ? !sa.floor : !(sa.over || (!sa.flush && !sa.lane))) continue;
      const ha = castFrame(sa, f, layer), hb = castFrame(sb, f, layer), list = [];
      if (only === undefined && layer === 'over') (tileOver[key] = tileOver[key] || [])[m] = ha;
      // A vehicle drawn apart from its tile must still sit in front of or behind the tile's
      // own solids (a shelter, a kiosk) as it would in one picture: where the tile is nearer,
      // the vehicle leaves a hole (the tile's piece shows there); where the vehicle is nearer,
      // its pixel goes to whichever cell the renderer draws later, so no later piece of the
      // tile covers it. Worked out for where the vehicle stands now, so a vehicle that moves
      // will need it again.
      const under = only !== undefined && layer === 'over' && tileOver[base] ? tileOver[base][m] : null;
      for (const [xy, r0] of ha) {
        let r = r0;
        const t = under && under.get(xy);
        if (t && t.a > 0.5) {
          if (t.near > r.near + 0.5) continue;
          if (t.cell[0] + t.cell[1] > r.cell[0] + r.cell[1]) r = { ...r, cell: t.cell };
        }
        // base + weight x colour; the weight is the same in every channel
        const rb = hb.get(xy), w = rb ? (r.c.reduce((a, v, i) => a + v - rb.c[i], 0) / 3) / (TA - TB) : 0;
        const [X, Y] = xy.split(',').map(Number);
        const lit = [1, 0.52, 0.70, 0.61][r.face];
        list.push({ X, Y, c: r.c.map((v, i) => Math.min(255, v + w * (T[i] - TA)) * lit), a: r.a, w, face: r.face, cell: cellOf(...r.cell) });
      }
      if (!list.length) continue;
      const x0 = Math.min(...list.map(p => p.X)), y0 = Math.min(...list.map(p => p.Y));
      fr[layer] = { x0, y0, w: Math.max(...list.map(p => p.X)) - x0 + 1, h: Math.max(...list.map(p => p.Y)) - y0 + 1, list };
    }
    frames.push(fr);
  }
  // Upscaled by upscale.mjs: the same pixels at twice the density, each coloured
  // from its turn's painting, where the painting has it.
  const painted = !shop && upscaled(key, frames);
  // lay the frames out: a row per turn, floor then over
  const colW = ['floor', 'over'].map(l => Math.max(0, ...frames.map(fr => fr[l] ? fr[l].w : 0)));
  for (const fr of frames) if (fr.cells.length > 254) throw new Error(key + ': too many cells for the map');
  let y = 0;
  for (const fr of frames) {
    let x = 0;
    ['floor', 'over'].forEach((l, i) => { if (fr[l]) { fr[l].sx = x; fr[l].sy = y; } x += colW[i] + (colW[i] ? 2 : 0); });
    y += Math.max(0, ...['floor', 'over'].map(l => fr[l] ? fr[l].h : 0)) + 2;
  }
  const SW = colW[0] + colW[1] + 4, SH = y;
  const pic = new Array(SW * SH).fill(null), map = new Array(SW * SH).fill(null);
  for (const fr of frames) for (const l of ['floor', 'over']) if (fr[l]) for (const q of fr[l].list) {
    const i = (fr[l].sy + q.Y - fr[l].y0) * SW + fr[l].sx + q.X - fr[l].x0;
    pic[i] = '#' + q.c.map(toHex2).join('') + toHex2(q.a * 255);
    map[i] = '#' + toHex2(q.face * 60) + toHex2(q.cell + 1) + toHex2(q.w * 100);
  }
  manifest[key] = { tint, ...(shop || painted ? { d: DENSITY } : {}), frames: frames.map(fr => Object.fromEntries(Object.entries(fr).map(([l, g]) => [l, l === 'cells' ? g : [g.sx, g.sy, g.w, g.h, g.x0, g.y0]]))) };
  if (!want.length || want.includes(key) || want.includes(base)) {
    // a painted shop's sheet goes through png.mjs, which writes a palette where it can
    const write = (name, px, q) => writeFileSync(resolve(dir, name), shop || painted ? encodePng(q ? quantize(rgbaOf(SW, SH, px), 255) : rgbaOf(SW, SH, px)) : png({ IW: SW, IH: SH, px }));
    write(key + '.png', pic, true); write(key + '_map.png', map);
    written++;
  }
}
// ---- ground ------------------------------------------------------------------
// The land and the edge strips round the board, as repeating textures in the
// same pixel grid as the sheets. Each is drawn top-down over 2 x 2 squares
// (64 art pixels a side, wrapping), then projected: that makes a 128 x 64
// picture that tiles the isometric plane, anchored at the grid's origin, so its
// pixels line up with the tiles'. A strip's texture runs along x with its middle
// across at y = 32 (one square in); `_y` is the same strip turned to run along
// y. The runway fills its whole 2 squares across; the sea is drawn straight on
// the screen's pixels instead, since its crests lie level on the screen. Like the sheets, these are
// plain pictures to touch up in an editor, and rerunning this overwrites them.
const hash = (x, y, k = 0) => { let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const wrap = v => ((v % 64) + 64) % 64;
// speckle: a base colour with a few darker and lighter grains
const grain = (x, y, base, dark, light, k = 0, dn = 0.12, ln = 0.06) => { const r = hash(x, y, k); return r < dn ? dark : r > 1 - ln ? light : base; };
const GROUND = {
  grass: (x, y) => { const r = hash(x >> 1, y, 1); return r < 0.18 ? '#378a37' : r > 0.985 ? '#5cb84a' : r > 0.93 ? '#4aa244' : '#3f9b3f'; },
  lawn: (x, y) => { const r = hash(x >> 1, y, 2); return r < 0.18 ? '#3f9238' : r > 0.92 ? '#5cb84a' : '#4aa244'; },
  // open water, drawn on the screen rather than on the ground (see SCREEN):
  // level crests, each a white cap over a paler trough, and short dark ripples
  sea: (X, Y) => {
    for (const [cx, cy] of [[20, 10], [84, 26], [52, 42], [116, 58], [4, 58], [100, 10]]) {
      const dx = ((X - cx + 192) % 128) - 64, dy = Y - cy;
      if (dy === 0 && Math.abs(dx) <= 2) return '#e8f6ff';
      if (dy === 1 && Math.abs(dx) >= 2 && Math.abs(dx) <= 4) return '#6cc8ff';
    }
    return hash(X >> 3, Y, 8) < 0.08 ? '#1b90d6' : '#1ea0ea';
  },
  // the concourse: squares in two greys, cut into four slabs, with a darker joint round each square
  concourse: (x, y) => {
    const base = ((x >> 5) + (y >> 5)) % 2 ? '#848993' : '#8d929c';
    if (x % 32 === 0 || y % 32 === 0) return '#72767f';
    if (x % 16 === 0 || y % 16 === 0) return shadeHex(base, 0.93);
    return grain(x, y, base, shadeHex(base, 0.96), shadeHex(base, 1.04), 3, 0.08, 0.05);
  },
  asphalt: (x, y) => grain(x, y, '#555a6e', '#4a4e60', '#62677b', 4),
  ballast: (x, y) => grain(x, y, '#6b55b0', '#5a4696', '#8470c4', 5, 0.2, 0.12),
  // a road: tarmac, a white line at each kerb, a dashed yellow centre line
  road: (x, y) => {
    if (y === 20 || y === 44) return '#c9ccd6';
    if ((y === 31 || y === 32) && x % 16 < 9) return '#ffe14d';
    return GROUND.asphalt(x, y);
  },
  // a railway: ballast, a dark sleeper every half square, two steel rails on them
  rail: (x, y) => {
    if (y === 28 || y === 36) return '#efe8ff';
    if (y === 29 || y === 37) return '#8f86b0';
    if (y >= 24 && y <= 40 && x % 16 < 4) return y === 24 || y === 40 ? '#3f2f70' : '#4a3a80';
    return GROUND.ballast(x, y);
  },
  // a level crossing: the rails alone, laid over the road where a railway crosses it
  crossing: (x, y) => y === 28 || y === 36 ? '#efe8ff' : y === 29 || y === 37 ? '#8f86b0' : null,
  // an apron: concrete slabs with a yellow taxi line down the middle
  apron: (x, y) => {
    if ((y === 31 || y === 32) && x % 16 < 5) return '#fff27a';
    if (x % 16 === 0 || (y - 18) % 14 === 0) return '#7f889e';
    return grain(x, y, '#8d96ad', '#838ca3', '#98a1b8', 6, 0.1, 0.05);
  },
  // the runway, two squares across: a kerb, a white stripe down each side, a
  // centre line a square on and a square off
  runway: (x, y) => {
    if (y === 0 || y === 63) return '#79839a';
    if (y === 3 || y === 4 || y === 59 || y === 60) return '#e6e8ee';
    if ((y === 31 || y === 32) && x < 26) return '#e6e8ee';
    return grain(x, y, '#3b404d', '#343844', '#454a58', 7, 0.1, 0.05);
  },
};
// textures drawn on the screen's own pixels (X, Y in the 128 x 64 picture), not
// projected from the ground: things that lie level on the screen, like crests
const SCREEN = new Set(['sea']);
function shadeHex(c, f) { const [r, g, b] = hex(c); return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join(''); }
const strips = new Set(['road', 'rail', 'crossing', 'apron', 'runway']);
const groundDir = resolve(root, 'assets/ground');
mkdirSync(groundDir, { recursive: true });
const groundKeys = [];
for (const [name, fn] of Object.entries(GROUND)) for (const turn of strips.has(name) ? ['_x', '_y'] : ['']) {
  const px = new Array(128 * 64);
  for (let Y = 0; Y < 64; Y++) for (let X = 0; X < 128; X++) {
    const U = Math.floor(wrap(Y + 0.5 + (X + 0.5) / 2)), V = Math.floor(wrap(Y + 0.5 - (X + 0.5) / 2));
    px[Y * 128 + X] = SCREEN.has(name) ? fn(X, Y) : turn === '_y' ? fn(V, U) : fn(U, V);
  }
  writeFileSync(resolve(groundDir, name + turn + '.png'), png({ IW: 128, IH: 64, px }));
  groundKeys.push(name + turn);
}
// Where a railway meets the sea it bends a quarter turn to run along the shore
// (drawShoreTurns in render.js). The bend is the rail texture itself, bent round
// the ring: across the ring is across the strip, and along it the arc length.
// One picture per corner and way round, `bend_<rail side><sea side>`, anchored
// at a whole grid point `lo` squares from the corner so its pixels stay in the grid.
const bends = {};
for (const e of ['N', 'S', 'W', 'E']) for (const n of e === 'N' || e === 'S' ? ['W', 'E'] : ['N', 'S']) {
  const m = EDGE_MARGIN, R = TURN_R, horiz = e === 'N' || e === 'S';
  const eRel = e === 'N' || e === 'W' ? -R : R, nRel = n === 'N' || n === 'W' ? R : -R;
  const [cx, cy] = horiz ? [nRel, eRel] : [eRel, nRel];
  const aStrip = horiz ? (e === 'N' ? Math.PI / 2 : -Math.PI / 2) : (e === 'W' ? 0 : Math.PI);
  const aShore = horiz ? (n === 'W' ? Math.PI : 0) : (n === 'N' ? -Math.PI / 2 : Math.PI / 2);
  const turn = Math.atan2(Math.sin(aShore - aStrip), Math.cos(aShore - aStrip));
  const lo = [Math.floor(cx - R), Math.floor(cy - R)], Wg = Math.ceil(cx + R) - lo[0], Hg = Math.ceil(cy + R) - lo[1];
  const IW = (Wg + Hg) * 32, IH = (Wg + Hg) * 16, px = new Array(IW * IH).fill(null);
  for (let Y = 0; Y < IH; Y++) for (let X = 0; X < IW; X++) {
    const a = (X + 0.5 - Hg * 32) / 32, b = (Y + 0.5) / 16;
    const dx = lo[0] + (a + b) / 2 - cx, dy = lo[1] + (b - a) / 2 - cy, d = Math.hypot(dx, dy) - (R - m / 2);
    const t = Math.atan2(Math.sin(Math.atan2(dy, dx) - aStrip), Math.cos(Math.atan2(dy, dx) - aStrip)) * Math.sign(turn);
    if (Math.abs(d) > m / 2 || t < 0 || t > Math.abs(turn)) continue;
    px[Y * IW + X] = GROUND.rail(wrap(Math.floor(t * (R - m / 2) * 32)), Math.floor(32 + d * 32));
  }
  const key = 'bend_' + (e + n).toLowerCase();
  writeFileSync(resolve(groundDir, key + '.png'), png({ IW, IH, px }));
  groundKeys.push(key); bends[key] = [lo[0], lo[1], Hg];
}

// Every key is listed whichever were written, and the
// paths stay literal strings for the bundler to inline.
const keys = Object.keys(manifest);
writeFileSync(resolve(root, 'src/ui/isosprites.js'), `// Written by harness/isoart.mjs from tileart.mjs's drawings; rerun it rather than editing.
// See src/ui/sprites.js for how a sheet is lit, recoloured and cut into cells.
export const ISO_SHEETS = {
${keys.map(k => `  ${k}: 'assets/iso/${k}.png',`).join('\n')}
};
export const ISO_MAPS = {
${keys.map(k => `  ${k}: 'assets/iso/${k}_map.png',`).join('\n')}
};
// key -> { tint: the colour it was drawn in, frames: [turn 0..3] -> { cells: [[u, v, kind]],
// floor, over: [sheet x, sheet y, w, h, frame x, frame y] } }. Frame coordinates are
// screen pixels from the ground point of the turned bounding box's top corner.
// The ground textures: 128 x 64, tiling the plane from the grid's origin (see the ground section).
export const GROUND_TEX = {
${groundKeys.map(k => `  ${k}: 'assets/ground/${k}.png',`).join('\n')}
};
// a rail bend's anchor: [x, y] squares from the corner it turns at, and its
// height in squares (the picture's left edge is that many half-cells left of the anchor)
export const GROUND_BENDS = ${JSON.stringify(bends)};
// a tile's vehicles, each a sheet of its own drawn over the tile (so it can move)
export const ISO_VEHICLES = ${JSON.stringify(vehicles)};
export const ISO_FRAMES = {
${keys.map(k => `  ${k}: ${JSON.stringify(manifest[k])},`).join('\n')}
};
`);
console.log(`wrote ${written} iso sheets to assets/iso/, ${groundKeys.length} ground textures to assets/ground/ and the manifest to src/ui/isosprites.js`);
