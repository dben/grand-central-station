// ============================================================================
// Tile catalogue. Pure data - the simulator interprets it.
// Transport fields: shape, terrain, tier, arr (arrival cadence), batch,
//   dep (departure cadence), dwell, mult, flat, cost, minWeek, rare.
// Amenity fields: shape, tier, radius, rate, mult, flat, cap, dur, revenue,
//   cost, minWeek, tags, special, walkable (floor travellers cross, not a wall),
//   ground (paving: drawn flat, with the crowd walking over the top of it).
// Terrain: road | rail | water | apron | corridor | free | underground
// Underground tiles sit on the ground like any other but run a tunnel on a
// second layer that nothing else shares (see checkPlacement): `line` says where
// it goes. 'through' follows the tile's long axis to both ends of the board,
// 'road' and 'water' tunnel straight to the nearest edge of that terrain.
// attach: 'tip' = only the tip of the L (top of the stem) may touch the edge; the foot points inland.
//         'edgewise' = the whole tile must lie flat along one edge (a berth, not a nose-in stall).
// ============================================================================

export const TRANSPORTS = {
  bus_stop:        { name: 'Bus Stop',         shape: 'I2', terrain: 'road',     tier: 1, arr: 4,  batch: 5 , dep: 4,  dwell: 1, mult: 1.04, flat: 12,  cost: 60,  minWeek: 1 },
  parking_lot:     { name: 'Parking Lot',      shape: 'O4', terrain: 'road',     tier: 1, arr: 1,  batch: 2,  dep: 1,  dwell: 0, mult: 1.02, flat: 30 , cost: 50,  minWeek: 1, walkable: true, ground: true },
  bike_rental:     { name: 'Bike Rental',      shape: 'I2', terrain: 'road',     tier: 1, arr: 2,  batch: 2,  dep: 2,  dwell: 0, mult: 1.04, flat: 8 ,  cost: 40,  minWeek: 1 },
  taxi_stand:      { name: 'Taxi Stand',       shape: 'I2', terrain: 'road',     tier: 2, arr: 2,  batch: 2,  dep: 2,  dwell: 0, mult: 1.07, flat: 9 ,  cost: 90,  minWeek: 1 },
  rideshare:       { name: 'Rideshare Zone',   shape: 'L3', terrain: 'road',     tier: 2, arr: 1,  batch: 2,  dep: 1,  dwell: 0, mult: 1.05, flat: 11,  cost: 80,  minWeek: 1 },
  car_rental:      { name: 'Car Rental',       shape: 'O4', terrain: 'road',     tier: 2, arr: 3,  batch: 2,  dep: 3,  dwell: 2, mult: 1.07, flat: 18,  cost: 140,  minWeek: 2 },
  limo:            { name: 'Limo Service',     shape: 'I3', terrain: 'road',     tier: 4, arr: 5,  batch: 2,  dep: 5,  dwell: 1, mult: 1.21, flat: 12,  cost: 240, minWeek: 4 },
  tram_stop:       { name: 'Tram Stop',        shape: 'I3', terrain: 'corridor', tier: 2, arr: 4,  batch: 4 , dep: 4,  dwell: 1, mult: 1.09, flat: 15,  cost: 130,  minWeek: 2 },
  train_station:   { name: 'Train Station',    shape: 'I4', terrain: 'rail',     attach: 'edgewise', tier: 2, arr: 6,  batch: 6 , dep: 6,  dwell: 2, mult: 1.1 , flat: 18,  cost: 180,  minWeek: 2 },
  express_train:   { name: 'Express Train',    shape: 'I5', terrain: 'rail',     attach: 'edgewise', tier: 3, arr: 8,  batch: 9 , dep: 8,  dwell: 3, mult: 1.16, flat: 24,  cost: 320, minWeek: 5 },
  monorail:        { name: 'Monorail',         shape: 'I4', terrain: 'corridor', tier: 3, arr: 5,  batch: 5 , dep: 5,  dwell: 2, mult: 1.14, flat: 21,  cost: 280, minWeek: 5 },
  ferry:           { name: 'Ferry Terminal',   shape: 'L4', terrain: 'water',    tier: 2, arr: 8,  batch: 8 , dep: 8,  dwell: 3, mult: 1.1 , flat: 21,  cost: 200, minWeek: 2 },
  water_taxi:      { name: 'Water Taxi',       shape: 'I2', terrain: 'water',     attach: 'edgewise', tier: 3, arr: 3,  batch: 2,  dep: 3,  dwell: 1, mult: 1.14, flat: 11,  cost: 150,  minWeek: 3 },
  marina:          { name: 'Marina',           shape: 'S4', terrain: 'water',    tier: 4, arr: 8,  batch: 2,  dep: 8,  dwell: 4, mult: 1.23, flat: 18,  cost: 350, minWeek: 6 },
  cruise_dock:     { name: 'Cruise Ship Dock', shape: 'I6', terrain: 'water',    attach: 'edgewise', tier: 3, arr: 16, batch: 28, dep: 16, dwell: 6, mult: 1.18, flat: 45 , cost: 520, minWeek: 7 },
  helipad:         { name: 'Helipad',          shape: 'O4', terrain: 'free',     tier: 4, arr: 6,  batch: 2,  dep: 6,  dwell: 2, mult: 1.24, flat: 15,  cost: 380, minWeek: 5, tags: ['air'] },
  balloon:         { name: 'Hot Air Balloon',  shape: 'T4', terrain: 'free',     tier: 3, arr: 10, batch: 2,  dep: 10, dwell: 5, mult: 1.19, flat: 18,  cost: 260, minWeek: 4, tags: ['air'] },
  jetway:          { name: 'Jetway',           shape: 'L3', terrain: 'apron',    attach: 'tip',    tier: 3, arr: 8,  batch: 11, dep: 8,  dwell: 4, mult: 1.18, flat: 27,  cost: 400, minWeek: 6, tags: ['air'] },
  jumbo_jetway:    { name: 'Jumbo Jetway',     shape: 'L5', terrain: 'apron',    attach: 'tip',    tier: 3, arr: 12, batch: 21, dep: 12, dwell: 6, mult: 1.21, flat: 42 , cost: 680, minWeek: 9, tags: ['air'] },
  private_terminal:{ name: 'Private Terminal', shape: 'T4', terrain: 'apron',    tier: 5, arr: 10, batch: 2,  dep: 10, dwell: 4, mult: 1.35, flat: 24,  cost: 760, minWeek: 10, rare: true, tags: ['air'] },
  ski_lift:        { name: 'Ski Lift',         shape: 'I4', terrain: 'corridor', tier: 2, arr: 3,  batch: 2,  dep: 3,  dwell: 1, mult: 1.09, flat: 12,  cost: 120,  minWeek: 2 },
  alpine_lift:     { name: 'Alpine Lift',      shape: 'I5', terrain: 'corridor', tier: 3, arr: 4,  batch: 3,  dep: 4,  dwell: 2, mult: 1.14, flat: 17,  cost: 220, minWeek: 5 },
  jetpack:         { name: 'Jetpack Rental',   shape: 'I2', terrain: 'free',     tier: 4, arr: 2,  batch: 2,  dep: 2,  dwell: 0, mult: 1.19, flat: 9 ,  cost: 290, minWeek: 6, tags: ['air'] },
  beam_pad:        { name: 'Beam-Em-Up Pad',   shape: 'O4', terrain: 'free',     tier: 5, arr: 3,  batch: 2,  dep: 3,  dwell: 0, mult: 1.39, flat: 18,  cost: 840, minWeek: 10, rare: true },
  subway:          { name: 'Subway Station',   shape: 'I2', terrain: 'underground', line: 'through', tier: 2, arr: 3,  batch: 4,  dep: 3,  dwell: 1, mult: 1.08, flat: 14,  cost: 150, minWeek: 3 },
  express_subway:  { name: 'Express Subway',   shape: 'I3', terrain: 'underground', line: 'through', tier: 3, arr: 5,  batch: 6,  dep: 5,  dwell: 2, mult: 1.15, flat: 22,  cost: 330, minWeek: 6 },
  under_parking:   { name: 'Underground Parking', shape: 'L3', terrain: 'underground', line: 'road', tier: 1, arr: 1, batch: 2, dep: 1, dwell: 0, mult: 1.02, flat: 30, cost: 110, minWeek: 3 },
  sub_dock:        { name: 'Submarine Dock',   shape: 'I2', terrain: 'underground', line: 'water', tier: 4, arr: 6,  batch: 2,  dep: 6,  dwell: 2, mult: 1.22, flat: 16,  cost: 320, minWeek: 5 },
  loop_terminal:   { name: 'Loop Terminal',    shape: 'O4', terrain: 'free',     tier: 3, arr: 4,  batch: 3,  dep: 4,  dwell: 1, mult: 1.16, flat: 18,  cost: 600, minWeek: 12, rare: true, special: 'loop', loopChance: 0.30 },
};

export const AMENITIES = {
  vending:        { name: 'Vending Machine',   shape: 'I1', tier: 1, radius: 2, rate: 0.72, mult: 1.28, flat: 30, cap: 4,  dur: 1, revenue: 1,  cost: 11,  minWeek: 1, tags: ['food'] },
  newsstand:      { name: 'Newsstand',         shape: 'I2', tier: 1, radius: 3, rate: 0.63, mult: 1.52, flat: 60, cap: 8,  dur: 1, revenue: 3,  cost: 21,  minWeek: 1 },
  restroom:       { name: 'Restroom',          shape: 'O4', tier: 1, radius: 3, rate: 0.81, mult: 1.7 , flat: 35,  cap: 12, dur: 2, revenue: 0,  cost: 25,  minWeek: 1 },
  food_stand:     { name: 'Food Stand',        shape: 'I2', tier: 1, radius: 3, rate: 0.63, mult: 1.7 , flat: 70, cap: 10, dur: 2, revenue: 4,  cost: 28,  minWeek: 1, tags: ['food'] },
  burger:         { name: 'Burger Joint',      shape: 'L3', tier: 1, radius: 3, rate: 0.54, mult: 2.4 , flat: 100, cap: 20, dur: 3, revenue: 6,  cost: 42,  minWeek: 1, tags: ['food'] },
  pizza:          { name: 'Pizza Place',       shape: 'S4', tier: 2, radius: 3, rate: 0.54, mult: 2.57, flat: 110, cap: 18, dur: 3, revenue: 8,  cost: 53,  minWeek: 2, tags: ['food'] },
  coffee:         { name: 'Coffee Shop',       shape: 'I2', tier: 2, radius: 4, rate: 0.72, mult: 2.23, flat: 80, cap: 14, dur: 2, revenue: 7,  cost: 46,  minWeek: 2, tags: ['food'] },
  kiosk:          { name: 'Information Kiosk', shape: 'I1', tier: 1, radius: 4, rate: 0.54, mult: 1.35, flat: 40, cap: 10, dur: 1, revenue: 1,  cost: 14,  minWeek: 1 },
  green_space:    { name: 'Green Space',       shape: 'O4', tier: 1, radius: 4, rate: 0.45, mult: 1.88, flat: 44, cap: 30, dur: 2, revenue: 0,  cost: 31,  minWeek: 2, tags: ['green'], special: 'green', walkable: true, ground: true },
  sports_bar:     { name: 'Sports Bar',        shape: 'T4', tier: 2, radius: 3, rate: 0.5 , mult: 2.93, flat: 140, cap: 16, dur: 4, revenue: 12, cost: 77 , minWeek: 4, tags: ['food'] },
  cafeteria:      { name: 'Cafeteria',         shape: 'I6', tier: 1, radius: 4, rate: 0.81, mult: 1.63, flat: 60, cap: 45, dur: 2, revenue: 5,  cost: 91 , minWeek: 5, tags: ['food'] },
  currency:       { name: 'Currency Exchange', shape: 'I2', tier: 3, radius: 3, rate: 0.45, mult: 2.75, flat: 88, cap: 6,  dur: 2, revenue: 15, cost: 67,  minWeek: 4 },
  clothing:       { name: 'Clothing Store',    shape: 'S4', tier: 2, radius: 3, rate: 0.45, mult: 2.75, flat: 120, cap: 12, dur: 3, revenue: 14, cost: 74 , minWeek: 4 },
  wifi:           { name: 'WiFi Hotspot',      shape: 'I1', tier: 0, radius: 4, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 39,  minWeek: 3, special: 'wifi', walkable: true, ground: true },
  waiting_area:   { name: 'Waiting Area',      shape: 'O4', tier: 0, radius: 3, rate: 0,    mult: 1,    flat: 0,  cap: 20, dur: 0, revenue: 0,  cost: 49,  minWeek: 2, special: 'waiting', walkable: true, ground: true },
  walkway:        { name: 'Moving Walkway',    shape: 'I4', tier: 0, radius: 0, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 35,  minWeek: 3, special: 'walkway' },
  art_gallery:    { name: 'Art Gallery',       shape: 'T4', tier: 3, radius: 4, rate: 0.4 , mult: 3.45, flat: 160, cap: 10, dur: 4, revenue: 18, cost: 115, minWeek: 6 },
  lounge:         { name: 'Travel Lounge',     shape: 'S5', tier: 3, radius: 3, rate: 0.54, mult: 3.27, flat: 120, cap: 14, dur: 3, revenue: 20, cost: 133, minWeek: 7 },
  designer:       { name: 'Designer Shop',     shape: 'L4', tier: 4, radius: 3, rate: 0.36, mult: 4.15, flat: 180, cap: 8,  dur: 4, revenue: 35, cost: 168, minWeek: 8 },
  security:       { name: 'Security Station', shape: 'L3', tier: 0, radius: 3, rate: 0, mult: 1, flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 70,  minWeek: 7, special: 'security' },
  guard:          { name: 'Security Guard',    shape: 'I1', tier: 0, radius: 2, rate: 0,    mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 32,  minWeek: 7, special: 'security', walkable: true },
  // A two-cell booth. Its fence runs edge to edge along the grid line between
  // its two cells (see checkpointLine in sim/board.js); the booth is the only way through.
  gate:           { name: 'Security Checkpoint', shape: 'I2', tier: 0, radius: 0, rate: 0,  mult: 1,    flat: 0,  cap: 0,  dur: 0, revenue: 0,  cost: 90,  minWeek: 6, special: 'gate', walkable: true },
  flier_club:     { name: 'Frequent Flier Club', shape: 'O6', tier: 4, radius: 3, rate: 0,  mult: 1,    flat: 0,  cap: 10, dur: 0, revenue: 25, cost: 210, minWeek: 9, special: 'waiting', walkable: true },
  // Sci-fi rares (week 12+, wildcard slot only)
  drone_swarm:    { name: 'Drone Vending Swarm', shape: 'I2', tier: 0, radius: 7, rate: 0.54, mult: 2.05, flat: 80, cap: 6, dur: 1, revenue: 6, cost: 182, minWeek: 12, rare: true, special: 'anytier' },
  chrono_lounge:  { name: 'Chrono Lounge',     shape: 'O4', tier: 0, radius: 3, rate: 0,    mult: 1,    flat: 0,  cap: 6,  dur: 0, revenue: 10, cost: 196, minWeek: 12, rare: true, special: 'waiting', stackValue: 0.43, walkable: true },
  nanofab:        { name: 'Nanofab Boutique',  shape: 'L3', tier: 0, radius: 3, rate: 0.5 , mult: 3.63, flat: 140, cap: 5,  dur: 3, revenue: 22, cost: 224, minWeek: 12, rare: true, special: 'anytier' },
};

// Bridge: a special placement that opens a span of a locked edge.
export const BRIDGE = { name: 'Bridge / Overpass', shape: 'I3', special: 'bridge', cost: 80 };

// ---------------------------------------------------------------- upgrades
// Upgrade cards are bound to a tile type you already own, so the shop only ever
// offers one you can actually play. Every entry gets its own name; a tile with
// no entry here falls back to a generated one, so the table can be filled in
// over time without touching the shop code.
// levels: how many levels the card grants. radiusBonus: extra radius on top.
// costMult: scales the summed level costs (1 = exactly what those levels cost).
export const TILE_UPGRADES = {
  coffee:        { name: 'Espresso Bar',       levels: 2, radiusBonus: 1 },
  bus_stop:      { name: 'Shelter & Timetable' },
  train_station: { name: 'Platform Extension' },
  ferry:         { name: 'Deeper Dock' },
  newsstand:     { name: 'Corner Franchise' },
  restroom:      { name: 'Attendant Service' },
  food_stand:    { name: 'Second Cart' },
  burger:        { name: 'Drive-Thru Window' },
  pizza:         { name: 'Stone Oven' },
  vending:       { name: 'Restock Contract' },
  kiosk:         { name: 'Concierge Desk' },
  green_space:   { name: 'Landscaping Budget' },
  sports_bar:    { name: 'Big Screen' },
  cafeteria:     { name: 'Extra Serving Line' },
  currency:      { name: 'Better Rates' },
  clothing:      { name: 'Flagship Remodel' },
  art_gallery:   { name: 'Touring Exhibition' },
  lounge:        { name: 'Members Wing' },
  designer:      { name: 'Private Fitting Rooms' },
  waiting_area:  { name: 'More Seating' },
  flier_club:    { name: 'Club Expansion' },
  wifi:          { name: 'Signal Booster' },
  walkway:       { name: 'Belt Overhaul' },
  gate:          { name: 'Fast Track Lane' },
  security:      { name: 'Extra Patrol', radiusBonus: 1 },
  guard:         { name: 'Radio Kit', radiusBonus: 1 },
  tram_stop:     { name: 'Second Car' },
  monorail:      { name: 'Third Car' },
  express_train: { name: 'Double-Decker Carriages' },
  jetway:        { name: 'Wide-Body Bridge' },
  subway:        { name: 'Longer Platforms' },
  express_subway:{ name: 'Extra Carriages' },
  under_parking: { name: 'Second Level' },
  sub_dock:      { name: 'Pressure Lock' },
};

// The upgrade a tile type offers, filled in from TILE_UPGRADES or generated.
export function tileUpgrade(key) {
  const def = tileDef(key);
  const u = TILE_UPGRADES[key] || {};
  const levels = u.levels || 1;
  return {
    key, levels, radiusBonus: u.radiusBonus || 0, costMult: u.costMult || 1,
    name: u.name || `${def.name} Refit`,
    tileName: def.name,
    desc: `Raise one ${def.name} by ${levels > 1 ? levels + ' levels' : 'one level'}${u.radiusBonus ? `, and let it reach ${u.radiusBonus} square${u.radiusBonus === 1 ? '' : 's'} further` : ''}.`,
  };
}

// Named upgrades that hit a whole category rather than one tile type. These stay
// separate because they are premium wildcard cards, not the routine upgrade path.
export const NAMED_UPGRADES = {
  concourse_ext:  { name: 'Concourse Extension', target: 'waiting_all', levels: 1, cost: 150, minWeek: 6, desc: 'Every Waiting Area and Club you own goes up a level.' },
  double_shift:   { name: 'Double Shift',        target: 'transport', levels: 2, cost: 220, minWeek: 6, desc: 'Raise any one transport tile by two levels.' },
  renovation:     { name: 'Renovation',          target: 'amenity',   levels: 2, cost: 240, minWeek: 8, desc: 'Raise any one shop by two levels.' },
};

export function tileDef(key) {
  if (TRANSPORTS[key]) return { key, kind: 'transport', ...TRANSPORTS[key] };
  if (AMENITIES[key]) return { key, kind: 'amenity', ...AMENITIES[key] };
  if (key === 'bridge') return { key, kind: 'bridge', ...BRIDGE };
  throw new Error('Unknown tile ' + key);
}

export const TERRAIN_INFO = {
  road:     { label: 'Road',     claim: 'road',     desc: 'Turns that side of the board into a road. Road tiles can sit a few squares back, with a driveway out to it.' },
  rail:     { label: 'Rail',     claim: 'lock',     desc: 'Locks that whole side of the board as railway. Nothing else can use it.' },
  water:    { label: 'Water',    claim: 'lock',     desc: 'Locks that whole side of the board as water. Nothing else can use it.' },
  apron:    { label: 'Apron',    claim: 'lock',     desc: 'Locks that whole side of the board as airfield. Nothing else can use it.' },
  corridor: { label: 'Corridor', claim: 'corridor', desc: 'Keeps a straight lane clear to the nearest side of the board. You cannot build in the lane.' },
  free:     { label: 'Free',     claim: 'none',     desc: 'Needs no terrain at all. Goes anywhere there is room.' },
  underground: { label: 'Underground', claim: 'none', desc: 'Runs a tunnel under the board. Build anything you like on top and travellers walk right over it, but two tunnels can never cross.' },
};
// What an underground tile's tunnel does, for the catalogue and the tile popup.
export const LINE_INFO = {
  through: 'Tunnels the long way to both ends of the board. Neither end can come up in water.',
  road:    'Tunnels straight to the nearest road. Only sold while one side of the board is a road.',
  water:   'Tunnels straight to the nearest water. Only sold while one side of the board is water.',
};
