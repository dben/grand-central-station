// Seeded PRNG (mulberry32). One stream per subsystem so that changing the
// number of calls in one system does not reshuffle another's rolls.
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.s = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  }
  next() {
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(a, b) { return a + this.next() * (b - a); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  gauss() {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  weighted(items, weightOf) {
    let total = 0;
    for (const it of items) total += weightOf(it);
    if (total <= 0) return items[this.int(items.length)];
    let r = this.next() * total;
    for (const it of items) {
      r -= weightOf(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// Stateless draws. `mix` hashes a handful of integers into a uniform in [0, 1),
// so a roll can be keyed by *who* is rolling and *what for* (a traveller, a
// shop, a cell) rather than by how many rolls came before it. That keeps two
// nearly identical boards on the same random path: a tile that changes one
// traveller's route re-rolls that traveller, not the whole week.
export function mix(...xs) {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 2654435761);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
  }
  return (Math.imul(h ^ (h >>> 16), 3266489909) >>> 0) / 4294967296;
}
export function gaussOf(u, v) {
  return Math.sqrt(-2.0 * Math.log(u || 1e-12)) * Math.cos(2.0 * Math.PI * v);
}
export function weightedOf(u, items, weightOf) {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (total <= 0) return items[Math.floor(u * items.length)];
  let r = u * total;
  for (const it of items) {
    r -= weightOf(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export function makeStreams(seed, names) {
  const out = {};
  for (const n of names) out[n] = new Rng(hashString(String(seed) + ':' + n));
  return out;
}
