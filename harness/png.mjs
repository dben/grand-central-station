// PNG in and out with node's own zlib, so the harness needs no dependencies.
// Pictures are { w, h, data }: data is RGBA, 4 bytes a pixel, row by row.
// Reads 8-bit greyscale, RGB, palette and RGBA, with or without alpha; not interlaced.
import { inflateSync, deflateSync } from 'node:zlib';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// A picture of 256 colours or fewer is written with a palette, a quarter the size.
export function encodePng({ w, h, data }) {
  const ix = new Map(), idx = new Uint8Array(w * h);
  for (let i = 0; i < w * h && ix.size <= 256; i++) {
    const k = data[i * 4 + 3] ? (data[i * 4] << 24 | data[i * 4 + 1] << 16 | data[i * 4 + 2] << 8 | data[i * 4 + 3]) >>> 0 : 0;
    if (!ix.has(k)) ix.set(k, ix.size);
    idx[i] = ix.get(k);
  }
  const pal = ix.size <= 256, ihdr = Buffer.alloc(13), bpp = pal ? 1 : 4;
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = pal ? 3 : 6;
  const raw = Buffer.alloc(h * (1 + w * bpp));
  for (let y = 0; y < h; y++) {
    if (pal) Buffer.from(idx.buffer, y * w, w).copy(raw, y * (1 + w) + 1);
    else Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (1 + w * 4) + 1);
  }
  const extra = [];
  if (pal) {
    const cols = [...ix.keys()];
    extra.push(chunk('PLTE', Buffer.from(cols.flatMap(k => [k >>> 24, (k >>> 16) & 255, (k >>> 8) & 255]))));
    extra.push(chunk('tRNS', Buffer.from(cols.map(k => k & 255))));
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Median cut: the picture's opaque colours in at most n, each pixel moved to
// the nearest, with no dither, so painted art reads as pixel art (and packs
// into a palette). Alpha is made all or nothing.
// Several pictures share one palette when given as a list.
export function quantize(pic, n) {
  if (Array.isArray(pic)) {
    const all = new Uint8ClampedArray(pic.reduce((a, p) => a + p.data.length, 0));
    let o = 0; for (const p of pic) { all.set(p.data, o); o += p.data.length; }
    const q = quantize({ w: all.length / 4, h: 1, data: all }, n);
    o = 0; return pic.map(p => { const d = q.data.slice(o, o + p.data.length); o += p.data.length; return { w: p.w, h: p.h, data: d }; });
  }
  const { w, h, data } = pic;
  const px = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] >= 128) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  let boxes = [px];
  while (boxes.length < n) {
    let bi = -1, bc = 0, br = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); } if ((hi - lo) * Math.sqrt(b.length) > br) { br = (hi - lo) * Math.sqrt(b.length); bi = i; bc = c; } } });
    if (bi < 0 || !br) break;
    const b = boxes[bi].sort((p, q) => p[bc] - q[bc]), mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  const pal = boxes.filter(b => b.length).map(b => [0, 1, 2].map(c => Math.round(b.reduce((a, p) => a + p[c], 0) / b.length)));
  const out = new Uint8ClampedArray(w * h * 4), memo = new Map();
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const k = data[i * 4] << 16 | data[i * 4 + 1] << 8 | data[i * 4 + 2];
    if (!memo.has(k)) {
      let best = 0, bd = Infinity;
      pal.forEach((p, j) => { const d = 0.3 * (p[0] - data[i * 4]) ** 2 + 0.59 * (p[1] - data[i * 4 + 1]) ** 2 + 0.11 * (p[2] - data[i * 4 + 2]) ** 2; if (d < bd) { bd = d; best = j; } });
      memo.set(k, pal[best]);
    }
    out.set([...memo.get(k), 255], i * 4);
  }
  return { w, h, data: out };
}
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w, h, depth, type, interlace, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type4 = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type4 === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (type4 === 'PLTE') pal = d;
    else if (type4 === 'tRNS') trns = d;
    else if (type4 === 'IDAT') idat.push(d);
    else if (type4 === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG: depth ${depth}, interlace ${interlace}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], stride = w * ch, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[row + i - ch] : 0, b = y ? px[row - stride + i] : 0, c = i >= ch && y ? px[row - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + i] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch, q = i * 4;
    if (type === 3) { const k = px[o]; data.set([pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], q); }
    else if (type === 0 || type === 4) data.set([px[o], px[o], px[o], type === 4 ? px[o + 1] : 255], q);
    else data.set([px[o], px[o + 1], px[o + 2], type === 6 ? px[o + 3] : 255], q);
  }
  return { w, h, data };
}
