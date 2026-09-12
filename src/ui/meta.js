// Local persistence: meta-progression (unlocks, records) and run save.
const META_KEY = 'gcs.meta.v1', SAVE_KEY = 'gcs.save.v1';

export function loadMeta() {
  try { return Object.assign({ bestWeek: 0, bestScore: 0, bestTraveller: 0, byMode: {} }, JSON.parse(localStorage.getItem(META_KEY) || '{}')); }
  catch { return { bestWeek: 0, bestScore: 0, bestTraveller: 0, byMode: {} }; }
}
export function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {} }
export function recordRun(meta, state) {
  meta.bestWeek = Math.max(meta.bestWeek, state.records.bestWeek);
  meta.bestScore = Math.max(meta.bestScore, state.records.bestScore);
  meta.bestTraveller = Math.max(meta.bestTraveller, state.records.bestTraveller);
  // Records are per mode *and* difficulty: a week 16 on Extreme is not the
  // same achievement as a week 16 on Standard.
  const key = state.modeKey + ':' + (state.diffKey || 'standard');
  const m = meta.byMode[key] || (meta.byMode[key] = { bestWeek: 0, bestScore: 0 });
  m.bestWeek = Math.max(m.bestWeek, state.records.bestWeek);
  m.bestScore = Math.max(m.bestScore, state.records.bestScore);
  saveMeta(meta);
}
export function saveRun(json) { try { localStorage.setItem(SAVE_KEY, json); } catch {} }
export function loadRun() { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } }
export function clearRun() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
