#!/usr/bin/env node
// Measures a music file's tempo and the time of its first beat, for its entry
// in TRACKS (src/ui/audio.js), which the animated tiles step in time with.
//   node harness/tempo.mjs [file.mp3 ...]   (default: every file in assets/music/)
// The browser decodes the audio (Playwright, like ui-smoke.mjs). From it: an
// onset curve (rises in loudness, the low end counted double for the kick),
// the tempo whose beat period best lines those onsets up with themselves at
// 1, 2, 4 and 8 beats, refined to the one that folds them into the sharpest
// pulse, and the phase of that pulse in the low end. Check the second line of
// candidates: a peak at 4/3 or 2/3 of the tempo is the rhythm, not the beat.
import { chromium } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const files = args.length ? args.map(f => resolve(f)) : readdirSync(resolve(root, 'assets/music')).filter(f => f.endsWith('.mp3')).map(f => resolve(root, 'assets/music', f));
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const page = await browser.newPage();
try {
  for (const file of files) {
    const r = await page.evaluate(async b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const buf = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(bin.buffer);
      const d = buf.getChannelData(0), FPS = 200, hop = buf.sampleRate / FPS, n = Math.floor(d.length / hop);
      // log loudness per 5 ms, broadband and low-passed
      const all = new Float32Array(n), low = new Float32Array(n);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        let e = 0, l = 0;
        for (let k = Math.floor(i * hop); k < Math.floor((i + 1) * hop); k++) { lp += 0.03 * (d[k] - lp); e += d[k] * d[k]; l += lp * lp; }
        all[i] = Math.log(1e-7 + e); low[i] = Math.log(1e-7 + l);
      }
      const kick = new Float32Array(n), env = new Float32Array(n);
      for (let i = 2; i < n; i++) { kick[i] = Math.max(0, low[i] - low[i - 2]); env[i] = Math.max(0, all[i] - all[i - 2]) + 2 * kick[i]; }
      const mean = env.reduce((a, v) => a + v, 0) / n;
      const flat = env.map(v => v - mean);
      const comb = bpm => {
        let s = 0, c = 0;
        for (const m of [1, 2, 4, 8]) {
          const L = m * FPS * 60 / bpm;
          for (let i = 0; i + L < n - 1; i++) { const j = i + L, j0 = j | 0, f = j - j0; s += flat[i] * (flat[j0] * (1 - f) + flat[j0 + 1] * f); c++; }
        }
        return s / c;
      };
      const res = [];
      for (let bpm = 70; bpm <= 190; bpm += 0.1) res.push([bpm, comb(bpm)]);
      const peaks = res.filter((p, i) => i > 0 && i < res.length - 1 && p[1] >= res[i - 1][1] && p[1] >= res[i + 1][1]).sort((a, b) => b[1] - a[1]);
      const fold = (bpm, arr, bins) => { const per = FPS * 60 / bpm, out = new Float64Array(bins); for (let i = 0; i < n; i++) out[Math.floor((i / per % 1) * bins)] += arr[i]; return out; };
      const sharp = f => { const m = f.reduce((a, v) => a + v, 0) / f.length; return f.reduce((a, v) => a + (v - m) ** 2, 0); };
      let bpm = peaks[0][0], best = -1;
      for (let b = peaks[0][0] - 0.3; b <= peaks[0][0] + 0.3; b += 0.005) { const s = sharp(fold(b, env, 64)); if (s > best) { best = s; bpm = b; } }
      const f = fold(bpm, kick, 64);
      let at = 0;
      for (let k = 1; k < 64; k++) if (f[k] > f[at]) at = k;
      return { dur: buf.duration, bpm, beat0: at / 64 * 60 / bpm, others: peaks.slice(1, 5).map(p => p[0]) };
    }, readFileSync(file).toString('base64'));
    console.log(`${relative(root, file)}: ${r.dur.toFixed(1)} s, bpm: ${r.bpm.toFixed(2)}, beat0: ${r.beat0.toFixed(3)}`);
    console.log(`  other candidates: ${r.others.map(b => b.toFixed(1)).join(', ')}`);
  }
} finally { await browser.close(); }
