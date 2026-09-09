// ============================================================================
// Tile catalogue. Pure data - the simulator interprets it.
// Transport fields: shape, terrain, tier, arr (arrival cadence), batch,
//   dep (departure cadence), dwell, mult, flat, cost, minWeek, rare.
// Amenity fields: shape, tier, radius, rate, mult, flat, cap, dur, revenue,
//   cost, minWeek, tags, special.
// Terrain: road | rail | water | apron | corridor | free
// attach: 'tip' = only the tip of the L (top of the stem) may touch the edge; the foot points inland.
// ============================================================================

export const TRANSPORTS = {
  bus_stop:        { name: 'Bus Stop',         shape: 'I2', terrain: 'road',     tier: 1, arr: 4,  batch: 14, dep: 4,  dwell: 1, mult: 1.10, flat: 40,  cost: 30,  minWeek: 1 },
  parking_lot:     { name: 'Parking Lot',      shape: 'O4', terrain: 'road',     tier: 1, arr: 1,  batch: 3,  dep: 1,  dwell: 0, mult: 1.05, flat: 100, cost: 25,  minWeek: 1 },
  bike_rental:     { name: 'Bike Rental',      shape: 'I2', terrain: 'road',     tier: 1, arr: 2,  batch: 4,  dep: 2,  dwell: 0, mult: 1.10, flat: 25,  cost: 20,  minWeek: 1 },
  taxi_stand:      { name: 'Taxi Stand',       shape: 'I2', terrain: 'road',     tier: 2, arr: 2,  batch: 3,  dep: 2,  dwell: 0, mult: 1.20, flat: 30,  cost: 45,  minWeek: 1 },
  rideshare:       { name: 'Rideshare Zone',   shape: 'L3', terrain: 'road',     tier: 2, arr: 1,  batch: 3,  dep: 1,  dwell: 0, mult: 1.15, flat: 35,  cost: 40,  minWeek: 1 },
  car_rental:      { name: 'Car Rental',       shape: 'O4', terrain: 'road',     tier: 2, arr: 3,  batch: 7,  dep: 3,  dwell: 2, mult: 1.20, flat: 60,  cost: 70,  minWeek: 2 },
  limo:            { name: 'Limo Service',     shape: 'I3', terrain: 'road',     tier: 4, arr: 5,  batch: 2,  dep: 5,  dwell: 1, mult: 1.60, flat: 40,  cost: 120, minWeek: 4 },
  tram_stop:       { name: 'Tram Stop',        shape: 'I3', terrain: 'corridor', tier: 2, arr: 4,  batch: 12, dep: 4,  dwell: 1, mult: 1.25, flat: 50,  cost: 65,  minWeek: 2 },
  train_station:   { name: 'Train Station',    shape: 'I4', terrain: 'rail',     tier: 2, arr: 6,  batch: 18, dep: 6,  dwell: 2, mult: 1.30, flat: 60,  cost: 90,  minWeek: 2 },
  express_train:   { name: 'Express Train',    shape: 'I5', terrain: 'rail',     tier: 3, arr: 8,  batch: 26, dep: 8,  dwell: 3, mult: 1.45, flat: 80,  cost: 160, minWeek: 5 },
  monorail:        { name: 'Monorail',         shape: 'I4', terrain: 'corridor', tier: 3, arr: 5,  batch: 14, dep: 5,  dwell: 2, mult: 1.40, flat: 70,  cost: 140, minWeek: 5 },
  ferry:           { name: 'Ferry Terminal',   shape: 'L4', terrain: 'water',    tier: 2, arr: 8,  batch: 24, dep: 8,  dwell: 3, mult: 1.30, flat: 70,  cost: 100, minWeek: 2 },
  water_taxi:      { name: 'Water Taxi',       shape: 'I2', terrain: 'water',    tier: 3, arr: 3,  batch: 4,  dep: 3,  dwell: 1, mult: 1.40, flat: 35,  cost: 75,  minWeek: 3 },
  marina:          { name: 'Marina',           shape: 'S4', terrain: 'water',    tier: 4, arr: 8,  batch: 5,  dep: 8,  dwell: 4, mult: 1.65, flat: 60,  cost: 175, minWeek: 6 },
  cruise_dock:     { name: 'Cruise Ship Dock', shape: 'I6', terrain: 'water',    tier: 3, arr: 16, batch: 80, dep: 16, dwell: 6, mult: 1.50, flat: 150, cost: 260, minWeek: 7 },
  helipad:         { name: 'Helipad',          shape: 'O4', terrain: 'free',     tier: 4, arr: 6,  batch: 3,  dep: 6,  dwell: 2, mult: 1.70, flat: 50,  cost: 190, minWeek: 5, tags: ['air'] },
  balloon:         { name: 'Hot Air Balloon',  shape: 'T4', terrain: 'free',     tier: 3, arr: 10, batch: 4,  dep: 10, dwell: 5, mult: 1.55, flat: 60,  cost: 130, minWeek: 4, tags: ['air'] },
  jetway:          { name: 'Jetway',           shape: 'L3', terrain: 'apron',    attach: 'tip',    tier: 3, arr: 8,  batch: 30, dep: 8,  dwell: 4, mult: 1.50, flat: 90,  cost: 200, minWeek: 6, tags: ['air'] },
  jumbo_jetway:    { name: 'Jumbo Jetway',     shape: 'L5', terrain: 'apron',    attach: 'tip',    tier: 3, arr: 12, batch: 60, dep: 12, dwell: 6, mult: 1.60, flat: 140, cost: 340, minWeek: 9, tags: ['air'] },
  private_terminal:{ name: 'Private Terminal', shape: 'T4', terrain: 'apron',    tier: 5, arr: 10, batch: 2,  dep: 10, dwell: 4, mult: 2.00, flat: 80,  cost: 380, minWeek: 10, rare: true, tags: ['air'] },
  ski_lift:        { name: 'Ski Lift',         shape: 'I4', terrain: 'corridor', tier: 2, arr: 3,  batch: 7,  dep: 3,  dwell: 1, mult: 1.25, flat: 40,  cost: 60,  minWeek: 2 },
  alpine_lift:     { name: 'Alpine Lift',      shape: 'I5', terrain: 'corridor', tier: 3, arr: 4,  batch: 9,  dep: 4,  dwell: 2, mult: 1.40, flat: 55,  cost: 110, minWeek: 5 },
  jetpack:         { name: 'Jetpack Rental',   shape: 'I2', terrain: 'free',     tier: 4, arr: 2,  batch: 2,  dep: 2,  dwell: 0, mult: 1.55, flat: 30,  cost: 145, minWeek: 6, tags: ['air'] },
  beam_pad:        { name: 'Beam-Em-Up Pad',   shape: 'O4', terrain: 'free',     tier: 5, arr: 3,  batch: 4,  dep: 3,  dwell: 0, mult: 2.10, flat: 60,  cost: 420, minWeek: 10, rare: true },
  loop_terminal:   { name: 'Loop Terminal',    shape: 'O4', terrain: 'free',     tier: 3, arr: 4,  batch: 8,  dep: 4,  dwell: 1, mult: 1.45, flat: 60,  cost: 300, minWeek: 12, rare: true, special: 'loop', loopChance: 0.30 },
};

export const AMENITIES = {
  vending:        { name: 'Vending Machine',   shape: 'I1', tier: 1, radius: 1, rate: 0.40, mult: 1.08, flat: 15, cap: 4,  dur: 1, revenue: 1,  cost: 15,  minWeek: 1, tags: ['food'] },
  newsstand:      { name: 'Newsstand',         shape: 'I2', tier: 1, radius: 2, rate: 0.35, mult: 1.15, flat: 30, cap: 8,  dur: 1, revenue: 3,  cost: 30,  minWeek: 1 },
  restroom:       { name: 'Restroom',          shape: 'O4', tier: 1, radius: 2, rate: 0.45, mult: 1.20, flat: 0,  cap: 12, dur: 2, revenue: 0,  cost: 35,  minWeek: 1 },
  food_stand:     { name: 'Food Stand',        shape: 'I2', tier: 1, radius: 2, rate: 0.35, mult: 1.20, flat: 35, cap: 10, dur: 2, revenue: 4,  cost: 40,  minWeek: 1, tags: ['food'] },
  burger:         { name: 'Burger Joint',      shape: 'L3', tier: 1, radius: 2, rate: 0.30, mult: 1.40, flat: 50, cap: 20, dur: 3, revenue: 6,  cost: 60,  minWeek: 1, tags: ['food'] },
  pizza:          { name: 'Pizza Place',       shape: 'S4', tier: 2, radius: 2, rate: 0.30, mult: 1.45, flat: 55, cap: 18, dur: 3, revenue: 8,  cost: 75,  minWeek: 2, tags: ['food'] },
  coffee:         { name: 'Coffee Shop',       shape: 'I2', tier: 2, radius: 3, rate: 0.40, mult: 1.35, flat: 40, cap: 14, dur: 2, revenue: 7,  cost: 65,  minWeek: 2, tags: ['food'] },
  kiosk:          { name: 'Information Kiosk', shape: 'I1', tier: 1, radius: 3, rate: 0.30, mult: 1.10, flat: 20, cap: 10, dur: 1, revenue: 1,  cost: 20,  minWeek: 1, special: 'kiosk' },
  green_space:    { name: 'Green Space',       shape: 'O4', tier: 1, radius: 3, rate: 0.25, mult: 1.25, flat: 10, cap: 30, dur: 2, revenue: 0,  cost: 45,  minWeek: 2, tags: ['green'], special: 'green' },
  sports_bar:     { name: 'Sports Bar',        shape: 'T4', tier: 2, radius: 2, rate: 0.28, mult: 1.55, flat: 70, cap: 16, dur: 4, revenue: 12, cost: 110, minWeek: 4, tags: ['food'] },
  cafeteria:      { name: 'Cafeteria',         shape: 'I6', tier: 1, radius: 3, rate: 0.45, mult: 1.18, flat: 30, cap: 45, dur: 2, revenue: 5,  cost: 130, minWeek: 5, tags: ['food'] },
  currency:       { name: 'Currency Exchange', shape: 'I2', tier: 3, radius: 2, rate: 0.25, mult: 1.50, flat: 40, cap: 6,  dur: 2, revenue: 15, cost: 95,  minWeek: 4 },
  clothing:       { name: 'Clothing Store',    shape: 'S4', tier: 2, radius: 2, rate: 0.25, mult: 1.50, flat: 60, cap: 12, dur: 3, revenue: 14, cost: 105, minWeek: 4 },
  wifi:           { name: 'WiFi Hotspot',      shape: 'I1', tier: 0, radius: 4, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 55,  minWeek: 3, special: 'wifi' },
  waiting_area:   { name: 'Waiting Area',      shape: 'O4', tier: 0, radius: 2, rate: 0,    mult: 1,    flat: 0,  cap: 20, dur: 0, revenue: 0,  cost: 70,  minWeek: 2, special: 'waiting' },
  walkway:        { name: 'Moving Walkway',    shape: 'I4', tier: 0, radius: 0, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 50,  minWeek: 3, special: 'walkway' },
  art_gallery:    { name: 'Art Gallery',       shape: 'T4', tier: 3, radius: 3, rate: 0.22, mult: 1.70, flat: 80, cap: 10, dur: 4, revenue: 18, cost: 165, minWeek: 6 },
  lounge:         { name: 'Travel Lounge',     shape: 'S5', tier: 3, radius: 2, rate: 0.30, mult: 1.65, flat: 60, cap: 14, dur: 3, revenue: 20, cost: 190, minWeek: 7 },
  designer:       { name: 'Designer Shop',     shape: 'L4', tier: 4, radius: 2, rate: 0.20, mult: 1.90, flat: 90, cap: 8,  dur: 4, revenue: 35, cost: 240, minWeek: 8 },
  gate:           { name: 'Security Gate',     shape: 'I4', tier: 0, radius: 0, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 150, minWeek: 6, special: 'gate' },
  flier_club:     { name: 'Frequent Flier Club', shape: 'O6', tier: 4, radius: 2, rate: 0,  mult: 1,    flat: 0,  cap: 10, dur: 0, revenue: 25, cost: 300, minWeek: 9, special: 'waiting' },
  // Sci-fi rares (week 12+, wildcard slot only)
  drone_swarm:    { name: 'Drone Vending Swarm', shape: 'I2', tier: 0, radius: 6, rate: 0.30, mult: 1.30, flat: 40, cap: 6, dur: 1, revenue: 6, cost: 260, minWeek: 12, rare: true, special: 'anytier' },
  chrono_lounge:  { name: 'Chrono Lounge',     shape: 'O4', tier: 0, radius: 2, rate: 0,    mult: 1,    flat: 0,  cap: 6,  dur: 0, revenue: 10, cost: 280, minWeek: 12, rare: true, special: 'waiting', stackValue: 0.18 },
  nanofab:        { name: 'Nanofab Boutique',  shape: 'L3', tier: 0, radius: 2, rate: 0.28, mult: 1.75, flat: 70, cap: 5,  dur: 3, revenue: 22, cost: 320, minWeek: 12, rare: true, special: 'anytier' },
};

// Bridge: a special placement that opens a span of a locked edge.
export const BRIDGE = { name: 'Bridge / Overpass', shape: 'I3', special: 'bridge', cost: 80 };

// Named upgrades that appear as shop cards
export const NAMED_UPGRADES = {
  espresso_bar:   { name: 'Espresso Bar',        target: 'coffee',    levels: 2, radiusBonus: 1, cost: 200, minWeek: 5, desc: 'Upgrade a Coffee Shop two levels and add +1 radius.' },
  concourse_ext:  { name: 'Concourse Extension', target: 'waiting_all', levels: 1, cost: 150, minWeek: 6, desc: 'Every Waiting Area and Club you own gains one level.' },
  double_shift:   { name: 'Double Shift',        target: 'transport', levels: 2, cost: 220, minWeek: 6, desc: 'Upgrade any transport tile two levels.' },
  renovation:     { name: 'Renovation',          target: 'amenity',   levels: 2, cost: 240, minWeek: 8, desc: 'Upgrade any amenity two levels.' },
};

export function tileDef(key) {
  if (TRANSPORTS[key]) return { key, kind: 'transport', ...TRANSPORTS[key] };
  if (AMENITIES[key]) return { key, kind: 'amenity', ...AMENITIES[key] };
  if (key === 'bridge') return { key, kind: 'bridge', ...BRIDGE };
  throw new Error('Unknown tile ' + key);
}

export const TERRAIN_INFO = {
  road:     { label: 'Road',     claim: 'road',     desc: 'Claims the edge as road. Generous: tiles sit up to 4 cells inland with a driveway.' },
  rail:     { label: 'Rail',     claim: 'lock',     desc: 'FULL LOCK: the whole edge becomes track.' },
  water:    { label: 'Water',    claim: 'lock',     desc: 'FULL LOCK: the whole edge becomes water.' },
  apron:    { label: 'Apron',    claim: 'lock',     desc: 'FULL LOCK: the whole edge becomes an aircraft apron.' },
  corridor: { label: 'Corridor', claim: 'corridor', desc: 'Reserves a straight lane to the nearest edge. The lane is unbuildable and unwalkable.' },
  free:     { label: 'Free',     claim: 'none',     desc: 'No terrain relationship. Goes anywhere with room.' },
};
