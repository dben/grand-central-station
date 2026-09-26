#!/usr/bin/env node
// Draws the pixel-art card headers and writes them as PNGs:
//   node harness/cardart.mjs            -> assets/cards/<scene>.png
// One scene per kind of ground a transport claims, and one per kind of every
// other card (see cardArt in src/ui/sprites.js), so a card says road, water,
// food or upgrade before it is read.
// Each is 56x21 art pixels, shown at 2x as a band across the top of the card;
// smaller cards crop it from the top, so the sky goes first and the vehicles
// stay. No dependencies: the PNG is written with node's own zlib.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const W = 56, H = 21;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---- canvas -----------------------------------------------------------------
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
function canvas() {
  const px = new Array(W * H).fill('#000000');
  const P = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H && c) px[y * W + x] = c; };
  const R = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(x + i, y + j, c); };
  // bands of colour from the top down, with a one-row checker between each pair
  const bands = (y0, list) => { let y = y0; list.forEach(([c, n], k) => { R(0, y, W, n, c); y += n; const next = list[k + 1]; if (next) { for (let x = 0; x < W; x++) P(x, y, (x + y) % 2 ? c : next[0]); y++; } }); return y; };
  // a sprite: rows of characters, '.' clear, others looked up in the palette
  const S = (x, y, rows, pal, flip = false) => { rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') P(flip ? x + row.length - 1 - i : x + i, y + j, pal[ch]); })); };
  // a round blob with an ink rim, lit from the top left: tree tops, bushes
  const blob = (cx, cy, r, col, dark, light) => { for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) { const d = x * x + y * y; if (d <= r * r) P(cx + x, cy + y, y > r / 3 ? dark : (x + y < -r / 2 ? light : col)); else if (d <= (r + 1) * (r + 1)) P(cx + x, cy + y, INK); } };
  return { px, P, R, bands, S, blob };
}

// ---- palette ------------------------------------------------------------------
const INK = '#0a0520';
const SKY = ['#3f8cff', '#62abff', '#8cc8ff', '#b6e0ff'];
const CLOUD = { w: '#ffffff', s: '#cfe6ff' };

// ---- sprites ------------------------------------------------------------------
const CLOUD_S = ['..www...', '.wwwww..', 'wwwwwwww', '.ssssss.'];
const CLOUD_L = ['....www.....', '..wwwwwww...', '.wwwwwwwwww.', 'wwwwwwwwwwww', '.ssssssssss.'];

const BUS = [
  '.kkkkkkkkkkkkkkkkk.',
  'kyyyyyyyyyyyyyyyyyk',
  'kbbybbybbybbybddyyk',
  'kbbybbybbybbybddyyk',
  'kyyyyyyyyyyyyyddyhk',
  'koooooooooooooddook',
  'kyyykkkyyyyyyykkkyk',
  '.kkkgwgkkkkkkkgwgk.',
  '....kgk.......kgk..',
];
const CAR = [
  '...kkkkkk...',
  '..kbbkbbrk..',
  '.krrrrrrrrk.',
  'hrrrrrrrrrrk',
  'kkgwgkkkgwgk',
  '..kgk...kgk.',
];
const TRAIN = [
  '....kkkkkkkkkkkkkkkkkkkkkkkkkk',
  '..kkrrrrrrrrrrrrrrrrrrrrrrrrrr',
  '.kbbrrbbrbbrbbrddrbbrbbrbbrddr',
  'kbbbrrbbrbbrbbrddrbbrbbrbbrddr',
  'khrrrrrrrrrrrrrddrrrrrrrrrrddr',
  'kwwwwwwwwwwwwwwwwwwwwwwwwwwwww',
  'krrrrrrrrrrrrrrrrrrrrrrrrrrrrr',
  '.kkgwgkkkkkkkkkkkkkkgwgkkkkkkk',
  '...kgk..............kgk.......',
];
const FERRY = [
  '............kk.........',
  '...........krrk........',
  '...........kkkk........',
  '.....kkkkkkkwwkkkkk....',
  '....kwbwbwbwwwbwbwbk...',
  '..kkkkkkkkkkkkkkkkkkkk.',
  'kwwbwbwbwbwbwbwbwbwwwwk',
  '.kwwwwwwwwwwwwwwwwwwwk.',
  '..kllllllllllllllllllk..',
  '...kkkkkkkkkkkkkkkkkk...',
];
const GULL = ['k.k', '.k.'];
const PLANE = [
  '..........................kk',
  '.........................kwk',
  '..kkkkkkkkkkkkkkkkkkkkkkkwwk',
  '.kwbwbwbwbwbwbwbwbwbwbwwwwwk',
  'kbbwwwwwwwwwwwwwwwwwwwwwwwk.',
  '.kssssssssskkkkkkkssssssk...',
  '..kkkkkkkkksssssssk.kkkk....',
  '.....kgk....kkkkk...kgk.....',
];
const TOWER = [
  '.kkkkkk.',
  'kbbbbbbk',
  'kbcbbcbk',
  '.kkkkkk.',
  '..kssk..',
  '..kssk..',
  '..kssk..',
  '..kssk..',
  '..kssk..',
  '..kssk..',
  '..kssk..',
  '.kssssk.',
];
const BALLOON = [
  '...kkkkk...',
  '.kkryryrkk.',
  'kryryryryrk',
  'kryryryryrk',
  'kryryryryrk',
  '.kryryryrk.',
  '..kryryrk..',
  '...kyryk...',
  '....k.k....',
  '....k.k....',
  '...kbbbk...',
  '...kbbbk...',
];
const HELI = [
  'kkkkkkkkk....',
  '....k........',
  '..kkkkk......',
  '.kbwrrrkkkkkk',
  '.kwrrrrk...k.',
  '..kkkkk......',
  '.k.....k.....',
  'kkkkkkkk.....',
];
const POD = [
  '..kkkkkkkkkkkkk..',
  '.kwwwwwwwwwwwwwk.',
  'kbbwbbwbbwbbwwwbk',
  'kwwwwwwwwwwwwwwwk',
  'kgggggggggggggggk',
  '.kkkkkkkkkkkkkkk.',
];
const SUBWAY = [
  '.kkkkkkkkkkkkkkkkkkkkk.',
  'kssssssssssssssssssssbk',
  'ksyysyysyysyysyysddsyyk',
  'ksyysyysyysyysyysddsyyk',
  'kbbbbbbbbbbbbbbbbddbbbk',
  'kssssssssssssssssddssbk',
  '.kkkkkkkkkkkkkkkkkkkkk.',
];
const UFO = [
  '.....kkkk.....',
  '....kccwck....',
  '.kkkkkkkkkkkk.',
  'kmmymmymmymmmk',
  '.kkkkkkkkkkkk.',
];

const BURGER = ['..kkkkk..', '.kowowok.', 'koooooook', 'kgggggggk', 'kpppppppk', 'koooooook', '.kkkkkkk.'];
const CUP = ['.s..s..', '..s..s.', 'kkkkkk.', 'kwwwwkk', 'kwrrwkk', 'kwwwwk.', '.kkkk..'];
const FRIES = ['y.y.y.', 'yyyyy.', 'krrrk.', 'krwrk.', 'krrrk.', '.kkk..'];
const BAG = ['..kk..', '.k..k.', 'kkkkkk', 'krrrrk', 'krrrrk', 'krrrrk', 'kkkkkk'];
const DRESS = ['...k...', '..kkk..', '..kmk..', '..kmk..', '.kmmmk.', '.kmmmk.', 'kmmmmmk', 'kkkkkkk'];
const BENCH = ['kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kkkkkkkkkkkk', '.k........k.'];
const DRONE = ['kk...kk', '.kkkkk.', '..kck..', '..kyk..'];
const SEAT = ['kkk..', 'kbk..', 'kbkkk', 'kbbbk', 'k.k.k'];
const JET = ['........kk', '.kkkkkkkwk', 'kwwwwwwwwk', '.kkkkkkkk.'];
const WIFI = ['..ccccc..', '.c.....c.', 'c..ccc..c', '..c...c..', '....c....'];
const PERSON = ['.f.', 'bbb', 'bbb', 'bbb', 'k.k', 'k.k'];
const PLANT = ['.g.g.', 'ggggg', '.ggg.', 'kkkkk', '.kpk.', '.kkk.'];

// ---- scenes -------------------------------------------------------------------
// The vehicles keep to the lower rows, which small cards keep when they crop.
// the tiled grey wall behind the concourse utilities
function concourse(c) {
  c.R(0, 0, W, 21, '#8f9ab0');
  for (let y = 3; y < 14; y += 4) c.R(0, y, W, 1, '#7a849c');
  for (let y = 0; y < 14; y += 4) for (let x = (y % 8 ? 4 : 0); x < W; x += 8) c.P(x, y + 1, '#7a849c');
}

const SCENES = {
  road(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 2], [SKY[3], 4]]);
    c.S(1, 0, CLOUD_S, CLOUD);
    // a far skyline, pale so it sits behind the bus
    const city = '#8f86d8', win = '#fff1a8';
    [[0, 5, 5], [5, 7, 4], [9, 3, 6], [15, 6, 5], [20, 5, 4], [24, 7, 6], [30, 4, 5], [35, 6, 4], [39, 2, 6], [45, 5, 5], [50, 3, 6]].forEach(([x, top, w]) => {
      c.R(x, top, w, 10 - top, city);
      for (let y = top + 1; y < 9; y += 2) for (let i = x + 1; i < x + w - 1; i += 2) if ((i * 7 + y * 3) % 5 < 2) c.P(i, y, win);
    });
    c.R(0, 10, W, 2, '#d7cce8'); for (let x = 1; x < W; x += 5) c.P(x, 11, '#a898c8');
    c.R(0, 12, W, 1, '#ffffff');
    c.R(0, 13, W, 8, '#3d3b58');
    for (let x = 0; x < W; x += 6) c.R(x, 17, 3, 1, '#ffd23f');
    c.S(34, 6, BUS, { k: INK, y: '#ffb13b', b: '#7fd6ff', d: '#2c5aa8', o: '#f0652a', h: '#fff8e7', g: '#8a8a9a', w: '#d0d0dc' });
    c.S(3, 15, CAR, { k: INK, r: '#ff4f5a', b: '#7fd6ff', h: '#fff1a8', g: '#8a8a9a', w: '#d0d0dc' });
  },
  rail(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 3], [SKY[3], 3]]);
    c.S(10, 3, CLOUD_S, CLOUD);
    c.R(0, 10, W, 6, '#6fb04a'); c.R(0, 10, W, 1, '#8fd05a');
    // catenary: a wire across the top, held by poles
    c.R(0, 1, W, 1, '#3b3452');
    for (const x of [4, 22, 52]) { c.R(x, 0, 1, 11, '#5a5470'); c.R(x - 2, 1, 5, 1, '#5a5470'); }
    // ballast, sleepers and rails
    c.R(0, 16, W, 5, '#8d7a68');
    for (let x = 0; x < W; x++) if ((x * 5) % 3 === 0) c.P(x, 18 + (x % 3), '#6f5e50');
    for (let x = 1; x < W; x += 3) c.R(x, 17, 2, 2, '#6b3e24');
    c.R(0, 16, W, 1, '#c9c4d8'); c.R(0, 17, W, 1, '#6c6880');
    c.S(26, 8, TRAIN, { k: INK, r: '#e8384f', b: '#9fe2ff', d: '#8a1a30', w: '#fff8e7', h: '#fff1a8', g: '#8a8a9a' });
    // pantograph up to the wire
    c.R(36, 7, 5, 1, INK); c.P(38, 6, INK); c.P(39, 5, INK); c.P(38, 4, INK); c.P(39, 3, INK); c.R(37, 2, 4, 1, INK);
  },
  water(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 2], [SKY[3], 3]]);
    c.S(0, 1, CLOUD_S, CLOUD);
    c.S(46, 2, GULL, { k: INK }); c.S(51, 4, GULL, { k: INK });
    c.bands(9, [['#1f8fd6', 3], ['#1673c0', 3], ['#0f58a0', 5]]);
    c.R(0, 9, W, 1, '#8fe0ff');
    for (let y = 11; y < H; y += 3) for (let x = (y * 5) % 7; x < W; x += 9) c.R(x, y, 3, 1, '#6cc8ff');
    // pier on the left: planks on posts
    c.R(0, 7, 12, 2, '#a86a3a'); c.R(0, 7, 12, 1, '#d08a4a');
    for (const x of [1, 6, 11]) c.R(x, 9, 1, 6, '#6b3e24');
    c.S(28, 3, FERRY, { k: INK, r: '#e8384f', w: '#fff8e7', b: '#2c5aa8', l: '#e8384f' });
  },
  apron(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 2], [SKY[3], 3]]);
    c.S(46, 0, CLOUD_S, CLOUD);
    c.R(0, 9, W, 1, '#6fb04a');
    c.R(0, 10, W, 11, '#6e6a80');
    for (let y = 11; y < H; y += 2) for (let x = (y * 3) % 5; x < W; x += 7) c.P(x, y, '#7c7890');
    c.R(0, 19, W, 1, '#ffd23f');
    for (let x = 2; x < W; x += 8) c.R(x, 16, 4, 1, '#fff8e7');
    c.S(2, 0, TOWER, { k: INK, b: '#7fd6ff', c: '#2c5aa8', s: '#d7cce8' });
    c.S(24, 8, PLANE, { k: INK, w: '#fff8e7', b: '#3f8cff', s: '#c9c4d8', g: '#8a8a9a' });
  },
  sky(c) {
    c.bands(0, [[SKY[0], 4], [SKY[1], 5], [SKY[2], 4], [SKY[3], 5]]);
    c.S(16, 14, CLOUD_L, CLOUD); c.S(37, 16, CLOUD_S, CLOUD); c.S(47, 0, CLOUD_S, CLOUD);
    c.S(2, 3, BALLOON, { k: INK, r: '#e8384f', y: '#ffd23f', b: '#a86a3a' });
    c.S(40, 6, HELI, { k: INK, b: '#9fe2ff', w: '#fff8e7', r: '#f0652a' });
  },
  corridor(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 3], [SKY[3], 20]]);
    // mountains with snow caps, for the lifts; the beam in front is the tram and monorail
    const peak = (x0, top, half, col) => { for (let d = 0; d <= half; d++) c.R(x0 - d, top + d, 2 * d + 1, H, col); };
    peak(6, 2, 14, '#7a6fc8'); peak(48, 3, 14, '#6a60b8'); peak(27, 7, 12, '#8a80d4');
    for (const [x, y] of [[6, 2], [48, 3]]) { c.P(x, y, '#ffffff'); c.R(x - 1, y + 1, 3, 1, '#ffffff'); c.P(x - 2, y + 2, '#ffffff'); c.P(x + 2, y + 2, '#ffffff'); }
    c.R(0, 16, W, 5, '#5f9a1f'); c.R(0, 16, W, 1, '#7fc23a');
    // the guideway on its T pillars
    c.R(0, 12, W, 2, '#d7cce8'); c.R(0, 14, W, 1, '#8f86b0');
    for (const x of [4, 22, 40]) { c.R(x, 15, 3, 6, '#b8b0d0'); c.R(x - 1, 14, 5, 1, '#8f86b0'); }
    c.S(31, 6, POD, { k: INK, w: '#fff8e7', b: '#35d4ff', g: '#35d4ff' });
  },
  underground(c) {
    c.R(0, 0, W, 1, SKY[2]);
    c.R(0, 1, W, 2, '#5f9a1f'); c.R(0, 1, W, 1, '#7fc23a');
    c.bands(3, [['#8a5a34', 3], ['#74492a', 4], ['#5c3a20', 12]]);
    for (const [x, y] of [[16, 4], [29, 5], [45, 4], [52, 8], [9, 13], [38, 7]]) { c.R(x, y, 2, 1, '#a8a0b0'); c.P(x, y + 1, '#6c6880'); }
    // the tunnel: a lined box with a train in it
    const x0 = 20, x1 = 55;
    c.R(x0, 9, x1 - x0 + 1, 12, '#1d1240');
    c.R(x0, 8, 1, 13, '#9d8fb8'); c.R(x0 + 1, 8, x1 - x0, 1, '#9d8fb8');
    for (let x = x0 + 4; x < x1; x += 8) c.P(x, 9, '#ffd23f');
    c.R(x0 + 1, 19, x1 - x0, 2, '#3b3452');
    c.S(x0 + 5, 12, SUBWAY, { k: INK, s: '#d0d0dc', y: '#fff1a8', b: '#2f6bff', d: '#6c6880' });
    // stairs down from the street, on the left
    for (let i = 0; i < 6; i++) c.R(2 + i * 2, 3 + i * 2, 3, 2, '#c9c4d8');
  },
  free(c) {
    c.bands(0, [['#1a1033', 5], ['#25174d', 5], ['#34216b', 5], ['#4b2f8f', 3]]);
    for (const [x, y] of [[3, 2], [11, 7], [7, 12], [15, 16], [27, 14], [52, 3], [53, 12], [20, 10], [31, 9]]) c.P(x, y, '#fff8e7');
    for (const [x, y] of [[6, 5], [50, 8]]) { c.P(x, y, '#ffd23f'); c.P(x - 1, y, '#ffd23f'); c.P(x + 1, y, '#ffd23f'); c.P(x, y - 1, '#ffd23f'); c.P(x, y + 1, '#ffd23f'); }
    // a saucer beaming down to a glowing pad
    const bx = 38;
    for (let y = 11; y < 19; y++) { const d = Math.floor((y - 11) / 2); c.R(bx - d, y, 2 * d + 2, 1, y % 2 ? '#35d4ff' : '#7fe8ff'); }
    c.S(bx - 6, 6, UFO, { k: INK, c: '#35d4ff', w: '#fff8e7', m: '#c7a3ff', y: '#ffd23f' });
    c.R(0, 19, W, 2, '#2a1a58');
    c.R(bx - 6, 18, 14, 2, '#ff4fd8'); c.R(bx - 5, 18, 12, 1, '#ff9cec');
  },

  // ---- the other card kinds
  food(c) {
    c.R(0, 0, W, 21, '#ffe0b0');
    for (let x = 0; x < W; x++) { const red = Math.floor(x / 4) % 2 === 0; c.R(x, 0, 1, 4, red ? '#e8384f' : '#fff8e7'); if (x % 4 < 3) c.P(x, 4, red ? '#e8384f' : '#fff8e7'); }
    c.R(0, 5, W, 1, '#e0b888');
    // a menu board between the dishes
    c.R(18, 6, 20, 7, INK); c.R(19, 7, 18, 5, '#2e374d');
    for (const y of [8, 10]) for (let x = 20; x < 36; x += 6) { c.R(x, y, 3, 1, '#fff8e7'); c.P(x + 4, y, '#ffd23f'); }
    c.R(0, 14, W, 4, '#a86a3a'); c.R(0, 14, W, 1, '#d08a4a'); c.R(0, 17, W, 1, '#6b3e24');
    for (let y = 18; y < H; y++) for (let x = 0; x < W; x++) c.P(x, y, (Math.floor(x / 2) + Math.floor((y - 18) / 2)) % 2 ? '#fff8e7' : '#3b3452');
    c.S(3, 7, BURGER, { k: INK, o: '#f0a040', w: '#fff8e7', g: '#5fc23a', p: '#6b3e24' });
    c.S(13, 8, FRIES, { k: INK, y: '#ffd23f', r: '#e8384f', w: '#fff8e7' });
    c.S(42, 7, CUP, { k: INK, w: '#fff8e7', r: '#a86a3a', s: '#c9c4d8' });
    c.S(49, 7, BURGER, { k: INK, o: '#f0a040', w: '#fff8e7', g: '#5fc23a', p: '#6b3e24' });
  },
  retail(c) {
    c.R(0, 0, W, 21, '#d7cce8');
    const shop = (x, w, sign, inside) => {
      c.R(x, 1, w, 4, sign); c.R(x, 4, w, 1, INK);
      for (let i = x + 3; i < x + w - 3; i += 4) c.R(i, 2, 2, 1, '#fff8e7');
      c.R(x, 5, w, 12, INK); c.R(x + 1, 6, w - 2, 10, '#9fe2ff');
      for (let i = 0; i < 5; i++) c.P(x + 3 + i, 12 - i, '#d8f4ff');
      inside(x);
    };
    shop(1, 24, '#ff4fd8', x => { c.S(x + 4, 7, DRESS, { k: INK, m: '#7a3cff' }); c.S(x + 13, 7, DRESS, { k: INK, m: '#ffb13b' }); });
    shop(31, 24, '#35d4ff', x => {
      for (const y of [10, 15]) c.R(x + 1, y, 22, 1, '#8f86b0');
      [['#e8384f', 3], ['#ffd23f', 8], ['#5fc23a', 13], ['#ff4fd8', 18]].forEach(([col, i]) => { c.R(x + i, 7, 3, 3, col); c.R(x + i + 1, 12, 3, 3, col); });
    });
    c.R(0, 17, W, 4, '#b8b0d0'); c.R(0, 17, W, 1, '#ffffff');
    for (let x = 3; x < W; x += 9) c.R(x, 19, 4, 1, '#d7cce8');
    c.S(23, 11, BAG, { k: INK, r: '#e8384f' }); c.S(28, 12, BAG, { k: INK, r: '#ffd23f' });
  },
  park(c) {
    c.bands(0, [[SKY[1], 2], [SKY[2], 2], [SKY[3], 4]]);
    c.S(22, 1, CLOUD_S, CLOUD);
    c.R(0, 10, W, 11, '#5f9a1f'); c.R(0, 10, W, 1, '#7fc23a');
    for (let y = 12; y < H; y += 2) for (let x = (y * 3) % 7; x < W; x += 6) c.P(x, y, '#7fc23a');
    // a path winding through
    for (let x = 0; x < W; x++) { const y = 15 + Math.round(Math.sin(x / 7) * 1.5); c.R(x, y, 1, 3, '#e8d4a0'); c.P(x, y + 3, '#c8b080'); }
    for (const [x, y, col] of [[20, 12, '#ff4fd8'], [37, 11, '#ffd23f'], [9, 19, '#fff8e7'], [46, 20, '#ff4fd8'], [30, 20, '#ffd23f']]) { c.P(x, y, col); c.P(x + 1, y + 1, col); }
    for (const [x, r] of [[7, 6], [48, 5]]) { c.R(x - 1, 7, 3, 7, '#6b3e24'); c.P(x - 2, 13, INK); c.P(x + 2, 13, INK); c.blob(x, 6 - (r - 5), r, '#4fb03a', '#2f7a20', '#8fd05a'); }
    c.S(22, 8, BENCH, { k: INK, w: '#d08a4a' });
  },
  lounge(c) {
    // a wall of glass onto the apron, seats in front
    c.bands(0, [[SKY[1], 3], [SKY[2], 3], [SKY[3], 4]]);
    c.S(30, 1, CLOUD_S, CLOUD);
    c.S(9, 4, JET, { k: INK, w: '#fff8e7' });
    c.R(0, 11, W, 1, '#6e6a80');
    for (let x = 0; x < W; x += 14) c.R(x, 0, 2, 12, '#3b3452');
    c.R(0, 0, W, 1, '#3b3452');
    c.R(0, 12, W, 9, '#2c5aa8');
    for (let y = 14; y < H; y += 2) for (let x = (y * 3) % 5; x < W; x += 5) c.P(x, y, '#2f6bff');
    for (let x = 3; x < 42; x += 6) c.S(x, 12, SEAT, { k: INK, b: '#35d4ff' });
    c.S(47, 12, PLANT, { k: INK, g: '#5fc23a', p: '#a86a3a' });
    c.R(0, 17, W, 1, '#1a3aa8');
  },
  utility(c) {
    concourse(c);
    // a WiFi sign over a moving walkway, riders on their phones
    c.R(20, 1, 15, 10, INK); c.R(21, 2, 13, 8, '#2e374d');
    c.S(23, 4, WIFI, { c: '#35d4ff' });
    c.R(0, 13, W, 1, '#c9c4d8'); c.R(0, 14, W, 5, INK); c.R(0, 15, W, 3, '#3b3452');
    for (let x = 2; x < W; x += 6) for (const d of [0, 1]) { c.P(x + d, 15, '#ffd23f'); c.P(x + d + 1, 16, '#ffd23f'); c.P(x + d, 17, '#ffd23f'); }
    for (const [x, col] of [[8, '#e8384f'], [44, '#5fc23a']]) { c.S(x, 8, PERSON, { f: '#f0c090', b: col, k: INK }); c.P(x + 3, 8, '#7fe8ff'); c.P(x + 3, 9, INK); }
    c.R(0, 19, W, 2, '#5a6a86');
  },
  security(c) {
    concourse(c);
    // queue ropes, the bag scanner, a guard, and the arch someone is walking through
    c.R(0, 14, W, 7, '#5a6a86'); c.R(0, 14, W, 1, '#6e7a96');
    for (const x of [1, 8]) { c.R(x, 9, 1, 6, '#d0d0dc'); c.P(x, 8, '#ffd23f'); }
    for (let x = 2; x < 8; x++) c.P(x, x === 2 || x === 7 ? 9 : 10, '#e8384f');
    c.R(12, 12, 26, 2, INK); c.R(12, 12, 26, 1, '#3b3452');
    c.R(17, 5, 15, 9, INK); c.R(18, 6, 13, 7, '#c9c4d8'); c.R(21, 9, 7, 4, '#1d1240'); c.R(19, 7, 3, 1, '#35d4ff'); c.P(29, 7, '#5fc23a');
    c.S(12, 5, BAG, { k: INK, r: '#ffb13b' });
    c.S(34, 7, ['kkk', 'kbk', '.f.', 'bbb', 'bbb', 'bbb', 'k.k', 'k.k'], { k: INK, b: '#2c3a70', f: '#f0c090' });
    const ax = 42;
    c.R(ax, 2, 12, 13, INK); c.R(ax + 1, 3, 10, 12, '#c9c4d8'); c.R(ax + 3, 5, 6, 10, '#8f9ab0');
    for (let y = 5; y < 15; y += 2) c.P(ax + 1, y, '#8f86b0');
    c.R(ax + 5, 3, 2, 1, '#5fc23a');
    c.S(ax + 5, 8, PERSON, { f: '#f0c090', b: '#e8384f', k: INK });
  },

  future(c) {
    c.bands(0, [['#1a1033', 6], ['#25174d', 6], ['#34216b', 8]]);
    for (const [x, y] of [[4, 2], [18, 1], [51, 3], [45, 11], [9, 12]]) c.P(x, y, '#fff8e7');
    // a neon shopfront with delivery drones
    c.R(14, 3, 28, 15, '#ff4fd8'); c.R(15, 4, 26, 13, '#1d1240');
    c.R(17, 6, 22, 1, '#35d4ff'); c.R(17, 6, 1, 9, '#35d4ff'); c.R(38, 6, 1, 9, '#35d4ff');
    for (let x = 20; x < 36; x += 5) { c.R(x, 9, 3, 5, '#7fe8ff'); c.R(x, 9, 3, 1, '#fff8e7'); }
    c.R(0, 18, W, 3, '#2a1a58'); c.R(14, 18, 28, 1, '#ff9cec');
    c.S(3, 6, DRONE, { k: INK, c: '#35d4ff', y: '#ffd23f' }); c.S(46, 4, DRONE, { k: INK, c: '#ff4fd8', y: '#ffd23f' }); c.S(47, 12, DRONE, { k: INK, c: '#7fe8ff', y: '#ffd23f' });
  },
  upgrade(c) {
    c.bands(0, [[SKY[1], 3], [SKY[2], 3], [SKY[3], 8]]);
    const Y = '#ffb13b';
    // a crane lifting a girder, beside a building in scaffolding
    c.R(40, 3, 3, 16, Y); for (let y = 3; y < 19; y += 2) c.P(41, y, INK);
    c.R(12, 2, 44, 2, Y); for (let x = 12; x < W; x += 2) c.P(x, 3, INK);
    c.R(50, 4, 5, 3, '#6c6880');
    c.R(38, 4, 5, 4, INK); c.R(39, 5, 3, 2, '#7fd6ff');
    c.R(20, 4, 1, 6, INK); c.R(19, 10, 3, 1, INK);
    c.R(12, 11, 18, 2, '#e8384f'); c.R(12, 11, 18, 1, '#ff6f7a'); for (let x = 13; x < 30; x += 3) c.P(x, 12, INK);
    c.R(1, 7, 10, 12, '#c9c4d8'); for (let y = 8; y < 19; y += 3) for (let x = 2; x < 10; x += 3) c.R(x, y, 2, 2, '#6c6880');
    for (const x of [0, 5, 10]) c.R(x, 6, 1, 13, '#8a8a9a');
    for (const y of [9, 13, 17]) c.R(0, y, 11, 1, '#a86a3a');
    c.R(0, 18, W, 3, '#8d7a68'); c.R(0, 18, W, 1, '#a89480');
    for (let x = 0; x < 26; x++) c.R(24 + x, 15, 1, 2, Math.floor((x + 0) / 2) % 2 ? '#ffd23f' : INK);
    c.R(24, 17, 1, 2, INK); c.R(49, 17, 1, 2, INK);
    for (const x of [14, 32]) { c.P(x + 1, 15, '#f0652a'); c.R(x, 16, 3, 1, '#fff8e7'); c.R(x, 17, 3, 1, '#f0652a'); c.R(x - 1, 18, 5, 1, INK); }
  },
  bonus(c) {
    // a golden ticket on a burst
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = Math.atan2(y - 10, (x - 28) / 1.6); c.P(x, y, Math.floor((a + Math.PI) / (Math.PI / 8)) % 2 ? '#7a3cff' : '#8f55ff'); }
    const x0 = 16, y0 = 5, w = 24, h = 11, G = '#ffd23f';
    c.R(x0, y0, w, h, INK); c.R(x0 + 1, y0 + 1, w - 2, h - 2, G); c.R(x0 + 1, y0 + 1, w - 2, 1, '#fff1a8');
    for (const x of [x0, x0 + w - 1]) { c.R(x, y0 + 4, 1, 3, '#8f55ff'); c.R(x === x0 ? x + 1 : x - 1, y0 + 4, 1, 3, INK); }
    for (let y = y0 + 1; y < y0 + h - 1; y += 2) c.P(x0 + 15, y, '#b07a10');
    const sx = x0 + 7, sy = y0 + 5; c.R(sx - 2, sy, 5, 1, '#e8384f'); c.R(sx - 1, sy - 1, 3, 3, '#e8384f'); c.P(sx, sy - 2, '#e8384f'); c.P(sx - 1, sy + 2, '#e8384f'); c.P(sx + 1, sy + 2, '#e8384f');
    for (const y of [y0 + 3, y0 + 5, y0 + 7]) c.R(x0 + 17, y, 5, 1, '#b07a10');
    for (const [x, y, col] of [[4, 3, '#ffd23f'], [9, 15, '#35d4ff'], [48, 4, '#ff4fd8'], [51, 16, '#ffd23f'], [44, 18, '#35d4ff'], [7, 9, '#ff4fd8'], [12, 1, '#fff8e7'], [50, 10, '#fff8e7']]) { c.R(x, y, 2, 2, col); }
    for (const [x, y] of [[3, 17], [52, 1]]) { c.P(x, y, '#fff8e7'); c.P(x - 1, y, '#fff8e7'); c.P(x + 1, y, '#fff8e7'); c.P(x, y - 1, '#fff8e7'); c.P(x, y + 1, '#fff8e7'); }
  },

};

// ---- PNG --------------------------------------------------------------------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(hex(px[y * W + x]), y * (1 + W * 3) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const dir = resolve(root, 'assets/cards');
mkdirSync(dir, { recursive: true });
for (const [name, draw] of Object.entries(SCENES)) {
  const c = canvas(); draw(c);
  writeFileSync(resolve(dir, name + '.png'), png(c.px));
}
console.log(`wrote ${Object.keys(SCENES).length} card headers to assets/cards/`);
