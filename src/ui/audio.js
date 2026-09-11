// Background music. One looping track at a time; switching crossfades.
// Browsers only start audio after a user gesture. Every track change here
// follows a click (starting a run, pressing Continue), so play() normally
// succeeds; if the browser refuses, the game simply stays silent.
// The bundler (harness/build.js) inlines these as data URIs in dist/.
export const TRACKS = {
  main: 'assets/music/GCS.mp3',
};
const VOLUME = 0.5, FADE_MS = 800;

const players = {};
let current = null;
let muted = (() => { try { return localStorage.getItem('gcs.muted') === '1'; } catch { return false; } })();

function player(name) {
  if (!TRACKS[name]) return null;
  if (!players[name]) {
    const a = new Audio(TRACKS[name]);
    a.loop = true; a.preload = 'auto'; a.volume = 0;
    players[name] = a;
  }
  return players[name];
}

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
  if (current) stop(players[current], true);
  current = name;
  if (name && !muted) { const a = player(name); if (a) { a.currentTime = 0; start(a); } }
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('gcs.muted', muted ? '1' : '0'); } catch {}
  if (!current) return;
  if (muted) stop(players[current], false); else start(player(current));
}
