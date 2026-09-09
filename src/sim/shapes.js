// Tetromino-style tile shapes. Each shape is a list of [x,y] cells with the
// origin at the top-left of the bounding box. Orientations include rotations
// and mirrors, de-duplicated.
const BASE = {
  I1: [[0,0]],
  I2: [[0,0],[1,0]],
  I3: [[0,0],[1,0],[2,0]],
  I4: [[0,0],[1,0],[2,0],[3,0]],
  I5: [[0,0],[1,0],[2,0],[3,0],[4,0]],
  I6: [[0,0],[1,0],[2,0],[3,0],[4,0],[5,0]],
  O4: [[0,0],[1,0],[0,1],[1,1]],
  O6: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]],
  L3: [[0,0],[0,1],[1,1]],
  L4: [[0,0],[0,1],[0,2],[1,2]],
  L5: [[0,0],[0,1],[0,2],[0,3],[1,3]],
  S4: [[1,0],[2,0],[0,1],[1,1]],
  S5: [[0,0],[1,0],[1,1],[1,2],[2,2]],
  T4: [[0,0],[1,0],[2,0],[1,1]],
};

function normalize(cells) {
  const minX = Math.min(...cells.map(c => c[0]));
  const minY = Math.min(...cells.map(c => c[1]));
  const out = cells.map(c => [c[0] - minX, c[1] - minY]);
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return out;
}
function rotate(cells) { return normalize(cells.map(([x, y]) => [-y, x])); }
function mirror(cells) { return normalize(cells.map(([x, y]) => [-x, y])); }
function key(cells) { return cells.map(c => c.join(',')).join(';'); }

export const SHAPES = {};
// Per orientation: every { mirror: 0|1, rot: 0..3 } that produces it from the base
// orientation (mirror first, then rot x 90deg clockwise). Symmetric shapes (I, O, L3, T)
// have several; each entry also records where the base cell [0,0] lands (`tip`).
export const SHAPE_TRANSFORMS = {};
for (const [name, cells] of Object.entries(BASE)) {
  const seen = new Map();
  const orients = [], transforms = [];
  const base = normalize(cells);
  for (let m = 0; m < 2; m++) {
    for (let r = 0; r < 4; r++) {
      // transform the base explicitly so we can track where cell [0,0] ends up
      let raw = base.map(([x, y]) => (m ? [-x, y] : [x, y]));
      for (let i = 0; i < r; i++) raw = raw.map(([x, y]) => [-y, x]);
      const minX = Math.min(...raw.map(c => c[0])), minY = Math.min(...raw.map(c => c[1]));
      const moved = raw.map(([x, y]) => [x - minX, y - minY]);
      const cur = normalize(moved);
      const k = key(cur);
      const entry = { mirror: m, rot: r, tip: moved[0] };
      if (!seen.has(k)) { seen.set(k, orients.length); orients.push(cur); transforms.push([entry]); }
      else transforms[seen.get(k)].push(entry);
    }
  }
  SHAPES[name] = orients;
  SHAPE_TRANSFORMS[name] = transforms;
}
// Transform for drawing a base-orientation sprite at orientation `rot`. If `tipAt` is
// given ([x,y] relative to the tile's bounding box), prefer the variant that maps the
// sprite's base cell [0,0] onto that cell (used for tip-attached tiles like jetways).
export function shapeTransform(shape, rot, tipAt = null) {
  const o = SHAPE_TRANSFORMS[shape];
  const list = o[((rot % o.length) + o.length) % o.length];
  if (tipAt) { const hit = list.find(e => e.tip[0] === tipAt[0] && e.tip[1] === tipAt[1]); if (hit) return hit; }
  return list[0];
}
export function shapeBaseSize(shape) {
  const c = SHAPES[shape][0];
  return { w: Math.max(...c.map(x => x[0])) + 1, h: Math.max(...c.map(x => x[1])) + 1 };
}

export function shapeCells(shape, rot) {
  const o = SHAPES[shape];
  return o[((rot % o.length) + o.length) % o.length];
}
export function orientationCount(shape) { return SHAPES[shape].length; }
