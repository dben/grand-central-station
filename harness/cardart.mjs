#!/usr/bin/env node
// Draws the pixel-art headers for transport cards and writes them as PNGs:
//   node harness/cardart.mjs            -> assets/cards/<scene>.png
// One scene per kind of ground a transport claims (see cardScene in
// src/ui/sprites.js), so a card says road, water or air before it is read.
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
  const S = (x, y, rows, pal, flip = false) => rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') P(flip ? x + row.length - 1 - i : x + i, y + j, pal[ch]); }));
  return { px, P, R, bands, S };
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

// ---- scenes -------------------------------------------------------------------
// The vehicles keep to the lower rows, which small cards keep when they crop.
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
