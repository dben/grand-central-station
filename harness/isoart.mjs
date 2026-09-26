#!/usr/bin/env node
// Bakes the board tiles into isometric sprite sheets, drawn in screen space:
//   node harness/isoart.mjs [key ...]   -> assets/iso/<key>.png and src/ui/isosprites.js
// The drawings are tileart.mjs's own top-down art. This ray-casts them once, here,
// into the classic 2:1 pixel projection (a cell is a 64x32 diamond, and a tile
// height unit is 64 * H_UNIT pixels), with the walls, the vehicles and the tree
// tops stood up as solid shapes. The renderer then only copies pixels.
//
// Three old tricks keep the drawing count down:
//  - Mirroring. Flipping a view left to right is the same as swapping the grid's
//    x and y, so of a tile's eight orientations only the four turns are baked;
//    the mirrored four are those frames flipped (see isoFrame in sprites.js).
//  - Shading after the fact. A flip moves a south wall onto the right-hand side,
//    where the light is, so walls are stored unlit with a face index (top, left,
//    right) and the light is applied when the sheet is loaded, per side.
//  - Palette swaps. Every sheet is drawn twice, in two greys, and each pixel is
//    stored as base + weight x tile colour. The game colours a sheet by the tile's
//    colour at load, and a full or closed tile is the same sheet in a grey palette.
//
// A sheet is a PNG twice the height of its pieces: the top half is the base
// colour and alpha, the bottom half the control data (red: tint weight x 100,
// green: face x 60). Each frame is cut into one piece per cell, owned by the cell
// under the surface that shows there, so the renderer keeps painting cell by cell
// back to front and a long building still interleaves with its neighbours.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawAll, CELL, hex, png } from './tileart.mjs';
import { tileDef } from '../src/data/tiles.js';
import { tileHeight, H_UNIT, CANOPY_Z } from '../src/ui/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HZ = 2 * CELL * H_UNIT;          // screen pixels per unit of tile height
const TA = 48, TB = 176;               // the two greys each sheet is drawn in
const GLASS_A = 0.2;                   // a glass box's panes, as the flat renderer washes them

// Hex strings to [r, g, b, a] once, so the ray loop does no parsing.
const rgba = v => v ? [...hex(v), v.length > 7 ? parseInt(v.slice(7, 9), 16) / 255 : 1] : null;
const isInk = p => p && p[0] < 24 && p[1] < 16 && p[2] < 48;

// One drawn tile (floor and over sheets from tileart) in one grey, ready to cast.
function scene(key, layers, grey) {
  const any = layers.floor || layers.over;
  const { W, H, IW, IH, ox, oy, inside } = any;
  const def = tileDef(key.replace(/_lane$/, '')), lane = key.endsWith('_lane');
  const z = lane ? 0 : tileHeight(def);
  const px = s => s ? s.px.map(rgba) : null;
  const floor = px(layers.floor), over = px(layers.over);
  const blocks = (layers.over ? layers.over.blocks : []).map(([x, y, w, h, z0, z1, round]) => ({ x, y, w, h, lo: z0 * HZ, hi: z1 * HZ, round: !!round, cx: x + w / 2, cy: y + h / 2 }));
  // the flat part of the over layer: the blocks' rectangles are cut out of it
  const flat = over && over.map((p, i) => { const x = i % IW, y = (i / IW) | 0; return blocks.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ? null : p; });
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
  return { key, def, lane, z, hz: z * HZ, W, H, IW, IH, ox, oy, inside, floor, over, flat, side, blocks, sinks, tint: [grey, grey, grey],
    glass: z > 0 && !!floor, flush: z <= 0, canopy: z <= 0 && !lane && !!over && !sinks.length };
}

// ---- casting ---------------------------------------------------------------
// Frame m is the base image turned m quarter turns (the renderer's convention:
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
  const pts = [[-s.ox, -s.oy], [s.IW - s.ox, -s.oy], [-s.ox, s.IH - s.oy], [s.IW - s.ox, s.IH - s.oy]].map(([u, v]) => {
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
// The block surface at art pixel (u, v) and height h, as the art pixel it shows.
function blockAt(s, b, u, v, h) {
  // a slab thinner than a pixel (a haul cable) still gets its one row
  if (h < Math.floor(b.lo) || h > b.hi) return null;
  let x = u + s.ox + 0.5, y = v + s.oy + 0.5;
  if (b.round) { const f = 0.55 + 0.45 * Math.sin(Math.PI * (0.15 + 0.8 * (h - b.lo) / (b.hi - b.lo))); x = b.cx + (x - b.cx) / f; y = b.cy + (y - b.cy) / f; }
  x = Math.floor(x); y = Math.floor(y);
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return null;
  const i = y * s.IW + x;
  return s.over[i] ? i : null;
}
const scale = (p, f) => [p[0] * f, p[1] * f, p[2] * f, p[3]];
const LEFT = 1, RIGHT = 2, MID = 3;

// What a ray through frame pixel (X, Y) sees in one layer, front to back.
// Returns { c: [r, g, b], a, face, cell } or null. Contributions under alpha 1
// (glass panes, washes) are composited and the ray carries on behind them.
function cast(s, f, X, Y, layer) {
  let C = [0, 0, 0], A = 0, face = 0, best = 0, cell = null;
  const add = (p, fc, U, V) => {
    if (!p || p[3] <= 0) return false;
    const w = (1 - A) * p[3];
    for (let k = 0; k < 3; k++) C[k] += w * p[k];
    A += w;
    if (w > best) { best = w; face = fc; }
    if (!cell) cell = [Math.floor(U / CELL), Math.floor(V / CELL)];
    return A > 0.99;
  };
  const t = s.tint, hTop = layer === 'over' ? Math.ceil(Math.max(s.hz, s.canopy ? CANOPY_Z * HZ : 0, ...s.blocks.map(b => b.hi))) : 0;
  const hBot = -Math.ceil(Math.max(0, ...s.sinks.map(k => k.d)));
  let wasIn = false;
  for (let h = hTop; h >= hBot; h--) {
    const U = Y + 0.5 + h + (X + 0.5) / 2, V = Y + 0.5 + h - (X + 0.5) / 2;
    const [u, v] = f.toBase(U, V);
    // past the drawing: open air above the ground, the ground itself at it
    if (!inPad(s, u, v)) { if (h <= 0) break; wasIn = false; continue; }
    const foot = s.inside(u, v);
    // which side of a shape the ray came in through: left (a south face) where the
    // shape ends in front of it along V, right (an east face) where it ends along
    // U, and the middle shade where a curve runs between the two. Looking a few
    // pixels out keeps a round bow from striping light and dark pixel by pixel.
    const faceOf = test => {
      let l = 0, r = 0;
      for (let k = 1; k <= 3; k++) { if (!test(...f.toBase(U, V + k))) l += 4 - k; if (!test(...f.toBase(U + k, V))) r += 4 - k; }
      return l > r ? LEFT : r > l ? RIGHT : MID;
    };
    if (layer === 'over') {
      for (const b of s.blocks) {
        const i = blockAt(s, b, u, v, h);
        if (i == null) continue;
        const top = h + 1 > b.hi;
        if (add(top ? s.over[i] : s.side[i], top ? 0 : faceOf((a, c) => blockAt(s, b, a, c, h) != null), U, V)) return { c: C.map(v => v / A), a: A, face, cell };
      }
      if (!s.flush && foot && h >= 0 && h <= s.hz) {
        const top = h + 1 > s.hz;
        if (s.glass) {
          if (top) {
            // the rim round the open top, then anything standing on it (a shelter, a sign)
            const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dv]) => !s.inside(u + du, v + dv));
            if (add(at(s, s.flat, u, v) || (rim ? [...scale(t, 1.35).slice(0, 3), 0.9] : null), 0, U, V)) return { c: C.map(v => v / A), a: A, face, cell };
          }
          else if (!wasIn) {
            // a pane: its frame round the top edge and down the corners
            const fc = faceOf((a, c) => s.inside(a, c)), [p, q] = f.toBase(U + (fc === LEFT ? 1 : 0), V + (fc === LEFT ? 0 : 1)), [p2, q2] = f.toBase(U - (fc === LEFT ? 1 : 0), V - (fc === LEFT ? 0 : 1));
            const edge = h + 2.5 > s.hz || h < 1 || !s.inside(p, q) || !s.inside(p2, q2);
            if (add(edge ? [...scale(t, 1.35).slice(0, 3), 0.9] : [...t, GLASS_A], fc, U, V)) return { c: C.map(v => v / A), a: A, face, cell };
          }
        } else {
          let p;
          if (top) p = at(s, s.over, u, v) || [...t, 1];
          else {
            // a building's wall: a lit top course, a dark footing, a seam per cell
            const fc = faceOf((a, c) => s.inside(a, c)), along = fc === LEFT ? U : V;
            const k = h > s.hz - 2 ? 1.14 : h < 2 ? 0.78 : Math.floor(along) % CELL === 0 ? 0.88 : 1;
            p = [...scale(t, k).slice(0, 3), 1];
            if (add(p, fc, U, V)) return { c: C.map(v => v / A), a: A, face, cell };
            continue;
          }
          if (add(p, 0, U, V)) return { c: C.map(v => v / A), a: A, face, cell };
        }
      }
      if (s.canopy && foot && h <= CANOPY_Z * HZ && h + 1 > CANOPY_Z * HZ) { if (add(at(s, s.flat, u, v), 0, U, V)) return { c: C.map(v => v / A), a: A, face, cell }; }
      wasIn = foot;
      // the ground: the floor layer has it. A sink's opening lets the ray on down.
      if (h <= 0) { const k = sinkAt(s, u, v); if (!k || h <= -k.d) break; }
    } else {
      // the ground, or a step's tread: the floor art, lowered to its depth
      const depth = (p, q) => { const k = sinkAt(s, p, q); return k ? k.d : 0; }, d = depth(u, v);
      if (h > -d) continue;
      if (h > -d - 1) { add(at(s, s.floor, u, v), 0, U, V); break; }
      // under it: the side of the pit, or the riser of the step above the one
      // the ray came down into, facing the camera across the opening
      add([...scale(t, 0.95).slice(0, 3), 1], faceOf((p, q) => depth(p, q) <= -h), U, V);
      break;
    }
  }
  return A > 0 ? { c: C.map(v => v / A), a: A, face, cell } : null;
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
const want = process.argv.slice(2);
const A = drawAll(() => '#' + TA.toString(16).padStart(2, '0').repeat(3)), B = drawAll(() => '#' + TB.toString(16).repeat(3));
const dir = resolve(root, 'assets/iso');
mkdirSync(dir, { recursive: true });
const manifest = {};
let written = 0;
for (const key of Object.keys(A)) {
  const sa = scene(key, A[key], TA), sb = scene(key, B[key], TB);
  const frames = [], pieces = [];
  for (let m = 0; m < 4; m++) {
    const f = frameOf(sa, m), fr = {};
    for (const layer of ['floor', 'over']) {
      if (layer === 'floor' ? !sa.floor : !(sa.over || (!sa.flush && !sa.lane))) continue;
      const ha = castFrame(sa, f, layer), hb = castFrame(sb, f, layer);
      // group by the cell that owns each pixel, then cut a piece per cell
      const byCell = new Map();
      for (const [xy, r] of ha) {
        const rb = hb.get(xy), ck = r.cell.join(',');
        // base + weight x tint, per pixel; the weight is the same in every channel
        const w = rb ? (r.c.reduce((a, v, i) => a + v - rb.c[i], 0) / 3) / (TA - TB) : 0;
        const base = r.c.map(v => v - w * TA);
        const [X, Y] = xy.split(',').map(Number);
        if (!byCell.has(ck)) byCell.set(ck, []);
        byCell.get(ck).push({ X, Y, base, w, a: r.a, face: r.face });
      }
      fr[layer] = [];
      for (const [ck, list] of byCell) {
        const [cu, cv] = ck.split(',').map(Number);
        const x0 = Math.min(...list.map(p => p.X)), y0 = Math.min(...list.map(p => p.Y));
        const w = Math.max(...list.map(p => p.X)) - x0 + 1, h = Math.max(...list.map(p => p.Y)) - y0 + 1;
        const piece = { cu, cv, x0, y0, w, h, list };
        pieces.push(piece); fr[layer].push(piece);
      }
    }
    frames.push(fr);
  }
  // shelf-pack every piece of every frame onto one sheet
  const SW = Math.max(256, ...pieces.map(p => p.w + 1));
  let x = 0, y = 0, rowH = 0;
  for (const p of [...pieces].sort((a, b) => b.h - a.h)) {
    if (x + p.w > SW) { x = 0; y += rowH + 1; rowH = 0; }
    p.sx = x; p.sy = y; x += p.w + 1; rowH = Math.max(rowH, p.h);
  }
  const half = y + rowH;
  const px = new Array(SW * half * 2).fill(null);
  const toHex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  for (const p of pieces) for (const q of p.list) {
    const i = (p.sy + q.Y - p.y0) * SW + p.sx + q.X - p.x0;
    px[i] = '#' + q.base.map(toHex2).join('') + toHex2(q.a * 255);
    px[i + SW * half] = '#' + toHex2(q.w * 100) + toHex2(q.face * 60) + '00';
  }
  manifest[key] = { half, frames: frames.map(fr => Object.fromEntries(Object.entries(fr).map(([l, ps]) => [l, ps.map(p => [p.cu, p.cv, p.sx, p.sy, p.w, p.h, p.x0, p.y0])]))) };
  if (!want.length || want.includes(key)) { writeFileSync(resolve(dir, key + '.png'), png({ IW: SW, IH: half * 2, px })); written++; }
}
// As with tilesprites.js: every key is listed whichever were written, and the
// paths stay literal strings for the bundler to inline.
const keys = Object.keys(manifest);
writeFileSync(resolve(root, 'src/ui/isosprites.js'), `// Written by harness/isoart.mjs from tileart.mjs's drawings; rerun it rather than editing.
// See src/ui/sprites.js for how a sheet is coloured, lit and cut into cells.
export const ISO_SHEETS = {
${keys.map(k => `  ${k}: 'assets/iso/${k}.png',`).join('\n')}
};
// key -> { half, frames: [turn 0..3] -> { floor, over: [[cell u, cell v, sheet x, sheet y, w, h, frame x, frame y]] } }
export const ISO_FRAMES = {
${keys.map(k => `  ${k}: ${JSON.stringify(manifest[k])},`).join('\n')}
};
`);
console.log(`wrote ${written} iso sheets to assets/iso/ and the manifest to src/ui/isosprites.js`);
