// Background music. One playlist at a time; switching crossfades.
// A track is a list of files: the list is shuffled when it starts and then
// played in that order, looping back to the top when the last file ends.
// Browsers only start audio after a user gesture. Every track change here
// follows a click (starting a run, pressing Continue), so play() normally
// succeeds; if the browser refuses, the game simply stays silent.
// The bundler (harness/build.js) inlines these as data URIs in dist/, and
// nulls out any file it cannot find - hence the filter in list().
export const TRACKS = {
  main: ['assets/music/GCS1.mp3', 'assets/music/GCS2.mp3'],
};
const VOLUME = 0.5, FADE_MS = 800;

const players = {};   // url -> Audio
const lists = {};     // TRACKS key -> { urls, i }
let current = null;
let muted = (() => { try { return localStorage.getItem('gcs.muted') === '1'; } catch { return false; } })();

function shuffled(urls) {
  const a = urls.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function list(name) {
  if (!TRACKS[name]) return null;
  if (!lists[name]) {
    const urls = [].concat(TRACKS[name]).filter(Boolean);
    if (!urls.length) return null;
    lists[name] = { urls, i: 0 };
  }
  return lists[name];
}
function player(l) {
  const url = l.urls[l.i];
  if (!players[url]) {
    const a = new Audio(url);
    a.preload = 'auto'; a.volume = 0;
    players[url] = a;
  }
  const a = players[url];
  a.loop = l.urls.length === 1;   // a lone file loops itself; a playlist advances on 'ended'
  a.onended = () => advance(l);
  return a;
}
function advance(l) {
  l.i = (l.i + 1) % l.urls.length;
  const a = player(l);
  a.currentTime = 0;
  if (!muted) start(a);
}
function currentPlayer() { const l = current && list(current); return l ? player(l) : null; }

// Ramp a player's volume on wall-clock time, so a throttled background tab
// still finishes the fade instead of freezing halfway.
function fade(a, to, done) {
  clearInterval(a._fade);
  const from = a.volume, t0 = performance.now();
  a._fade = setInterval(() => {
    const f = Math.min(1, (performance.now() - t0) / FADE_MS);
    a.volume = from + (to - from) * f;
    if (f >= 1) { clearInterval(a._fade); if (done) done(); }
  }, 40);
}
function start(a) {
  if (!a) return;
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
  fade(a, VOLUME);
}
function stop(a, rewind) {
  if (!a) return;
  fade(a, 0, () => { a.pause(); if (rewind) a.currentTime = 0; });
}

// A TRACKS key, or null for silence. Asking for the track that is already
// playing leaves it alone, so callers can sync on every week change.
export function playTrack(name) {
  if (name === current) return;
  const old = currentPlayer();
  if (old) { old.onended = null; stop(old, true); }
  current = name;
  const l = list(name);
  if (!l) return;
  l.urls = shuffled(l.urls); l.i = 0;   // a fresh start reshuffles, so runs don't always open the same way
  if (!muted) { const a = player(l); a.currentTime = 0; start(a); }
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('gcs.muted', muted ? '1' : '0'); } catch {}
  const a = currentPlayer();
  if (!a) return;
  if (muted) stop(a, false); else start(a);
}
