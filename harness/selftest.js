// Basic invariants: determinism, placement rules, gate filtering.
import { createBoard, checkPlacement, placeTile, removeTile, buildWalkMap, checkpointLine, checkpointFences, fenceBlocked, undergroundCells, lineAvailable, cutOffTransports } from '../src/sim/board.js';
import { simulateWeek, effAmenity, effTransport, wifiStrength } from '../src/sim/sim.js';
import { createRun, playCard, rezoningVictims, deleteTile, quotaFor, tileCost, computeMods, difficultyOf } from '../src/game/run.js';
import { tileDef } from '../src/data/tiles.js';
import { CONFIG } from '../src/config.js';
import { SHAPES, shapeTransform } from '../src/sim/shapes.js';
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };

// shapes
ok(SHAPES.I4.length === 2 && SHAPES.O4.length === 1 && SHAPES.L3.length === 4 && SHAPES.T4.length === 4 && SHAPES.S4.length === 4, 'shape orientation counts');

// placement rules
let b = createBoard(12, 12);
ok(!checkPlacement(b, 'train_station', 4, 5, 0).ok, 'rail must touch an edge');
let c = checkPlacement(b, 'train_station', 4, 0, 0);
ok(c.ok && c.claims.length === 1 && c.claims[0].edge === 'N' && c.claims[0].lock, 'rail on north edge locks it');
placeTile(b, 'train_station', 4, 0, 0, c);
ok(b.edges.N === 'rail', 'edge locked to rail');
ok(!checkPlacement(b, 'ferry', 0, 0, 0).ok, 'ferry cannot attach to rail edge');
// edgewise: a train berths alongside the edge, never nose-in
ok(!checkPlacement(createBoard(12, 12), 'train_station', 4, 0, 1).ok, 'train station cannot point inland from the edge');
ok(checkPlacement(createBoard(12, 12), 'train_station', 4, 0, 0).ok, 'train station lying flat on the north edge is fine');
ok(!checkPlacement(createBoard(12, 12), 'cruise_dock', 0, 0, 1).ok, 'cruise dock cannot point inland either');
c = checkPlacement(b, 'bus_stop', 2, 3, 0);
ok(c.ok && c.roadEdge === 'W' && c.driveway.length === 2, 'bus stop reaches west edge with 2-cell driveway');
placeTile(b, 'bus_stop', 2, 3, 0, c);
ok(b.edges.W === 'road' && b.driveways.length === 2, 'west edge claimed as road with driveway');
ok(!checkPlacement(b, 'bus_stop', 5, 5, 0).ok, 'bus stop 5 cells inland has no road access');
c = checkPlacement(b, 'tram_stop', 6, 9, 0);
ok(c.ok && (c.laneEdge === 'E' || c.laneEdge === 'W') && c.lane.length === 3, 'horizontal tram near the south edge runs its lane east or west instead');
c = checkPlacement(b, 'tram_stop', 6, 8, 1);
ok(c.ok && c.lane.length === 1 && c.laneEdge === 'S', 'vertical tram reserves a lane straight to the south edge');
placeTile(b, 'tram_stop', 6, 9, 0, c);
ok(!checkPlacement(b, 'vending', 6, 11, 0).ok, 'lane cell is unbuildable');
ok(buildWalkMap(b)[11 * 12 + 6] === 0, 'lane cell is still walkable');
placeTile(b, 'waiting_area', 8, 8, 0);
ok(buildWalkMap(b)[8 * 12 + 8] === 5, 'a lounge is walk-through floor, not a wall');
ok(!checkPlacement(b, 'vending', 8, 8, 0).ok, 'but you still cannot build on it');
removeTile(b, b.tiles.find(t => t.key === 'waiting_area').id);
ok(checkPlacement(b, 'helipad', 8, 5, 0).ok, 'free terrain anywhere');
c = checkPlacement(b, 'bridge', 0, 0, 0);
ok(c.ok && c.opens.length === 4, 'bridge on rail+road corner opens 3 north spans + 1 west span');
placeTile(b, 'bridge', 0, 0, 0, c);
ok(checkPlacement(b, 'ferry', 0, 1, 0).ok === false, 'ferry needs all touched indices open');
const t = b.tiles.find(x => x.key === 'tram_stop');
removeTile(b, t.id);
ok(b.lanes.length === 0, 'removing corridor tile frees its lane');

// jetway: tip of the L must touch the apron edge
b = createBoard(12, 12);
const jet = [0, 1, 2, 3].map(r => checkPlacement(b, 'jetway', 4, 0, r));
ok(jet.filter(c => c.ok).length === 2 && jet.filter(c => !c.ok).every(c => c.reason.includes('tip')), 'jetway: exactly 2 of 4 orientations attach to the north edge by the tip');
ok(jet.filter(c => c.ok).every(c => c.cells.filter(([, y]) => y === 0).length === 1), 'jetway: legal orientations touch the edge with one cell');
ok(!checkPlacement(b, 'jetway', 0, 0, 0).ok, 'jetway: corner placement touching two edges is rejected');
ok(shapeTransform('L3', 0).rot === 0 && shapeTransform('L3', 0).mirror === 0 && shapeTransform('L4', 4).mirror === 1 && SHAPES.L4.length === 8, 'shape transforms recorded');
ok(shapeTransform('L3', 3).rot === 3 && shapeTransform('L3', 3, [1, 0]).mirror === 1 && shapeTransform('L3', 3, [1, 0]).rot === 0, 'L3 orientation 3: mirror variant chosen when the tip must sit top-right');
ok(shapeTransform('I2', 1, [0, 1]).tip[1] === 1 && shapeTransform('I2', 1, [0, 0]).tip[1] === 0, 'I2 vertical: either end can be the tip');

// determinism
b = createBoard(12, 12);
placeTile(b, 'train_station', 4, 0, 0);
placeTile(b, 'bus_stop', 3, 10, 0);
placeTile(b, 'burger', 5, 4, 0);
placeTile(b, 'coffee', 7, 7, 0);
placeTile(b, 'waiting_area', 1, 8, 0);
const r1 = simulateWeek(b, { seed: 7, week: 3 });
const r2 = simulateWeek(b, { seed: 7, week: 3 });
ok(r1.score === r2.score && r1.money.total === r2.money.total && r1.agents.length === r2.agents.length, 'deterministic for same seed');
const r3 = simulateWeek(b, { seed: 8, week: 3 });
ok(r3.score !== r1.score, 'different seed gives different score');
ok(r1.counts.spawned > 0 && r1.score > 0, 'travellers spawn and score');
ok(Object.values(r1.tileStats).some(s => s.serves > 0), 'amenities serve');
for (const a of r1.agents) { if (a.frames.length !== a.endTick - a.spawnTick + 2) { ok(false, `frame count for agent ${a.id}: ${a.frames.length} vs ${a.endTick - a.spawnTick + 2}`); break; } }

// security checkpoint: a two-cell booth whose fence runs edge to edge between cells
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);     // west
placeTile(b, 'helipad', 9, 5, 0);      // east
placeTile(b, 'gate', 6, 5, 0);         // booth (6,5)-(7,5): fence on the line x = 7, gap at row 5
const ln = checkpointLine(b.tiles.find(t => t.key === 'gate').cells);
ok(ln.axis === 'v' && ln.line === 7 && ln.gap === 5, 'a horizontal booth raises a vertical fence between its cells');
const fz = checkpointFences(b);
ok(fenceBlocked(fz, 12, 12, 6, 4, 1, 0) && fenceBlocked(fz, 12, 12, 6, 0, 1, 0) && fenceBlocked(fz, 12, 12, 6, 11, 1, 0), 'the fence runs from one edge to the other');
ok(!fenceBlocked(fz, 12, 12, 6, 5, 1, 0), 'the booth is the gap');
ok(fenceBlocked(fz, 12, 12, 6, 5, 1, 1) && fenceBlocked(fz, 12, 12, 6, 4, 1, 1), 'nobody squeezes diagonally past the booth');
ok(!checkPlacement(b, 'vending', 6, 5, 0).ok && checkPlacement(b, 'vending', 7, 4, 0).ok, 'the fence costs no floor: cells beside it stay buildable');
// Cross-fence traffic is a minority of a small board's spawns, so sample a few seeds.
const rgs = [3, 4, 5, 6, 7, 8].map(seed => simulateWeek(b, { seed, week: 8, mods: { pickpocketRate: 0 } }));
const walkers = rgs.flatMap(r => r.agents).filter(a => a.kind === 'traveller');
const crossings = walkers.flatMap(a => a.frames.slice(1).map((f, i) => [a.frames[i], f]).filter(([p, q]) => (p[0] < 7) !== (q[0] < 7)));
ok(crossings.length > 0 && crossings.every(([p, q]) => p[1] === 5 && q[1] === 5), 'travellers cross the fence only through the booth');
ok(rgs.every(r => r.counts.lost === 0) && rgs.some(r => r.counts.boarded > 0), 'nobody is lost: the booth lets everyone through');
ok(walkers.some(a => a.events.some(e => e.type === 'cleared')), 'travellers who clear the booth are credited');
const rp = simulateWeek(b, { seed: 5, week: 12, mods: { pickpocketRate: 1 } });
ok(rp.counts.removed > 0, 'the booth catches pickpockets');

// walk-through tiles: parks, hotspots, guards and booths are floor, not wall
b = createBoard(12, 12);
for (const [k, x, y] of [['green_space', 2, 2], ['wifi', 6, 6], ['guard', 8, 8], ['gate', 4, 9]]) placeTile(b, k, x, y, 0);
const wm = buildWalkMap(b);
ok(wm[2 * 12 + 2] === 5 && wm[6 * 12 + 6] === 5 && wm[8 * 12 + 8] === 5 && wm[9 * 12 + 4] === 3, 'parks, hotspots and guards are walkable; a booth is a pass cell');
// a park straddling the only route still serves the travellers crossing it
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);
placeTile(b, 'helipad', 9, 5, 0);
placeTile(b, 'green_space', 5, 5, 0);
const rgreen = simulateWeek(b, { seed: 3, week: 6 });
ok(rgreen.tileStats[b.tiles.find(t => t.key === 'green_space').id].serves > 0, 'a park serves travellers');
// WiFi is a boost, never a cost, to what it covers
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);
placeTile(b, 'burger', 4, 3, 0);
const e0 = effAmenity(b.tiles[1], undefined, undefined, 0), e1 = effAmenity(b.tiles[1], undefined, undefined, wifiStrength({ tiles: [{ key: 'wifi', cells: [[5, 6]], level: 1 }] }, b.tiles[1].cells));
ok(e1.rate > e0.rate && e1.mult > e0.mult, 'wifi in range raises an amenity\'s pull and chain multiplier');
ok(effTransport(b.tiles[0], undefined, undefined, 1).mult > effTransport(b.tiles[0]).mult, 'wifi in range raises a transport\'s exit bonus');
// lost travellers: wall a transport off entirely and nobody bound for it arrives
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);
placeTile(b, 'helipad', 9, 5, 0);
placeTile(b, 'coffee', 1, 7, 0);
for (let y = 0; y < 12; y += 2) placeTile(b, 'restroom', 5, y, 0);   // solid wall, x = 5-6
// Cross-board trips are a 5% pick between a $ stop and a $$$$ pad, so sum a few seeds.
const rls = [1, 2, 3, 4, 5, 6].map(seed => simulateWeek(b, { seed, week: 6 }));
const rl = rls.reduce((m, r) => (r.counts.lost > m.counts.lost ? r : m), rls[0]);
ok(rls.reduce((n, r) => n + r.counts.lost, 0) > 0, 'travellers with no route to their platform are lost');
{
  const open = createBoard(12, 12);
  placeTile(open, 'bus_stop', 1, 5, 0); placeTile(open, 'helipad', 9, 5, 0);
  for (let y = 0; y < 10; y += 2) placeTile(open, 'restroom', 5, y, 0);   // wall with a gap at rows 10-11
  const gapDef = { kind: 'amenity', walkable: false };
  ok(cutOffTransports(open, [[5, 10], [6, 10], [5, 11], [6, 11]], gapDef).length === 2, 'the preview names the platforms a placement would seal off');
  ok(cutOffTransports(open, [[5, 10], [6, 10]], gapDef).length === 0 && cutOffTransports(open, [[5, 10], [6, 10], [5, 11], [6, 11]], { kind: 'amenity', walkable: true }).length === 0, 'a placement that leaves a way through, or is walk-through, seals nothing');
}
ok(rl.agents.filter(a => a.outcome === 'lost').every(a => !a.events.some(e => e.type === 'board')), 'lost travellers never board');
const rlOpen = simulateWeek(b, { seed: rl.seed, week: 6 });
ok(rlOpen.score === rl.score, 'lost run is deterministic');

// security station clears pickpockets out of its radius
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);
placeTile(b, 'helipad', 9, 5, 0);
const noCop = simulateWeek(b, { seed: 5, week: 12, mods: { pickpocketRate: 1 } });
placeTile(b, 'security', 5, 4, 0);
const cop = simulateWeek(b, { seed: 5, week: 12, mods: { pickpocketRate: 1 } });
ok(noCop.counts.removed === 0 && cop.counts.removed > 0, 'a security station removes pickpockets');
removeTile(b, b.tiles.find(t => t.key === 'security').id);
placeTile(b, 'guard', 5, 5, 0);
const guard = simulateWeek(b, { seed: 5, week: 12, mods: { pickpocketRate: 1 } });
ok(guard.counts.removed > 0, 'a one-cell security guard removes pickpockets too');

// the underground layer: tunnels run under everything and never cross each other
{
  b = createBoard(12, 12);
  const sub = checkPlacement(b, 'subway', 4, 5, 0);           // horizontal: cells (4,5),(5,5)
  ok(sub.ok && sub.tunnel.axis === 'h' && sub.tunnel.cells.length === 10 && sub.tunnel.ends.join() === 'W,E' && sub.claims.length === 0, 'a subway tunnels along its row to both ends of the board and claims no edge');
  placeTile(b, 'subway', 4, 5, 0, sub);
  ok(checkPlacement(b, 'restroom', 8, 4, 0).ok && checkPlacement(b, 'bus_stop', 0, 5, 0).ok, 'ground tiles can be built over the tunnel');
  placeTile(b, 'restroom', 8, 4, 0);
  ok(buildWalkMap(b)[5 * 12 + 1] === 0, 'a tunnel cell is ordinary floor to walk across');
  const cross = checkPlacement(b, 'subway', 9, 8, 1);          // vertical: its column meets row 5
  ok(!cross.ok && cross.reason.includes('cross') && cross.tunnel && cross.tunnel.axis === 'v', 'a vertical subway cannot cross a horizontal one, and the preview still carries its line');
  ok(checkPlacement(b, 'subway', 2, 8, 0).ok, 'a parallel subway is fine');
  ok(!checkPlacement(b, 'express_subway', 4, 5, 1).ok, 'a tunnel cannot pass under another station');
  ok(!checkPlacement(b, 'water_taxi', 0, 2, 1).ok && checkPlacement(b, 'water_taxi', 0, 2, 1).reason.includes('surfaces'), 'an edge where a subway surfaces cannot become water');
  ok(checkPlacement(b, 'water_taxi', 2, 0, 0).ok, 'the other edges can');
  placeTile(b, 'water_taxi', 2, 0, 0);
  const wet = checkPlacement(b, 'subway', 7, 8, 1);
  ok(!wet.ok && wet.reason.includes('water') && checkPlacement(b, 'express_subway', 6, 9, 0).ok, 'a subway line cannot end in the water, but the other axis still works');
  // garages and docks tunnel to the nearest edge of their terrain, however far
  ok(!checkPlacement(b, 'under_parking', 6, 8, 0).ok && !lineAvailable(b, { terrain: 'underground', line: 'road' }), 'underground parking needs a road edge, and the shop knows it');
  placeTile(b, 'bus_stop', 10, 10, 0);                          // road, east edge? (10,10)-(11,10): E at dist 0
  ok(b.edges.E === 'road' && lineAvailable(b, { terrain: 'underground', line: 'road' }), 'a road edge makes it available');
  const gar = checkPlacement(b, 'under_parking', 2, 8, 0);
  ok(gar.ok && gar.tunnel.ends.join() === 'E' && gar.tunnel.axis === 'h' && gar.tunnel.cells.length === 8 && gar.driveway.length === 0 && gar.claims.length === 0, 'the garage tunnels straight to the road edge: no driveway, no reach limit, no claim');
  placeTile(b, 'under_parking', 2, 8, 0, gar);
  ok(b.tiles.find(t => t.key === 'under_parking').edges.join() === 'E', 'it depends on that road edge');
  const dock = checkPlacement(b, 'sub_dock', 5, 2, 0);
  ok(dock.ok && dock.tunnel.ends.join() === 'N' && dock.tunnel.axis === 'v' && dock.tunnel.cells.length === 2, 'a submarine dock tunnels to the nearest water edge');
  ok(!checkPlacement(b, 'sub_dock', 7, 6, 1).ok, 'but not across the subway line');
  removeTile(b, b.tiles.find(t => t.key === 'subway').id);
  ok(checkPlacement(b, 'sub_dock', 7, 6, 1).ok && !undergroundCells(b).has('0,5'), 'deleting the subway frees its tunnel');
  ok(lineAvailable(createBoard(12, 12, { W: 'water', S: 'water' }), { terrain: 'underground', line: 'through' }) === false && lineAvailable(createBoard(12, 12, { W: 'water' }), { terrain: 'underground', line: 'through' }), 'a subway is only offered while one axis is clear of water');
  // the station is a transport like any other
  b = createBoard(12, 12);
  placeTile(b, 'subway', 4, 5, 0);
  placeTile(b, 'coffee', 4, 8, 0);
  const rs = simulateWeek(b, { seed: 3, week: 4 });
  ok(rs.counts.spawned > 0 && rs.counts.boarded > 0 && rs.tileStats[b.tiles[1].id].serves > 0, 'subway travellers arrive, shop and board');
}

// rezoning demolishes whatever depends on the edge, and nothing else
{
  const s = createRun({ seed: 3 });
  placeTile(s.board, 'train_station', 4, 0, 0);   // rail, north
  placeTile(s.board, 'bus_stop', 2, 3, 0);        // road, west (driveway)
  placeTile(s.board, 'helipad', 6, 6, 0);         // free
  placeTile(s.board, 'coffee', 5, 3, 0);
  ok(rezoningVictims(s, 'N').map(t => t.key).join() === 'train_station' && rezoningVictims(s, 'W').map(t => t.key).join() === 'bus_stop', 'rezoning victims are the tiles attached to that edge');
  const card = { id: 'rz', type: 'card', key: 'rezoning', cost: 0 };
  s.ap = 0; s.shop.cards.push(card);
  ok(playCard(s, card, { edge: 'W' }).ok && s.board.edges.W === 'green', 'rezoning a road edge opens it, and costs no AP');
  ok(!s.board.tiles.some(t => t.key === 'bus_stop') && s.board.driveways.length === 0, 'the road tile and its driveway are demolished');
  ok(['train_station', 'helipad', 'coffee'].every(k => s.board.tiles.some(t => t.key === k)), 'tiles on other edges and inland are untouched');
}

// difficulty: standard is the game as tuned, the others only scale it
{
  const std = createRun({ seed: 3 }), hard = createRun({ seed: 3, diffKey: 'hard' }), ext = createRun({ seed: 3, diffKey: 'extreme' });
  ok(difficultyOf(std).name === 'Standard' && difficultyOf(createRun({ seed: 3, diffKey: 'nonsense' })).name === 'Standard', 'an unknown difficulty falls back to Standard');
  ok(quotaFor(std, 1) === 5000 && JSON.stringify(computeMods(std)) === JSON.stringify(computeMods({ ...std, diffKey: 'standard' })), 'Standard leaves the quota and the simulator alone');
  const q = (s, w) => quotaFor(s, w);
  const weeks = [1, 2, 4, 8, 12, 16];
  // quotas round to whole stars, so week 1 can tie between two difficulties
  ok(weeks.every(w => q(ext, w) >= q(hard, w) && q(hard, w) >= q(std, w)) && q(ext, 4) > q(hard, 4), 'a harder run needs more every week');
  // the growth lever is the point: the gap has to widen, not just sit there
  ok(q(hard, 16) / q(std, 16) > q(hard, 1) / q(std, 1) && q(ext, 16) / q(std, 16) > q(ext, 1) / q(std, 1), 'and the gap widens by week 16');
  const cost = s => tileCost(s, tileDef('coffee'));
  ok(cost(hard) > cost(std) && cost(ext) > cost(hard) && ext.money < hard.money && hard.money < std.money, 'tiles cost more and the opening cash is smaller');
  ok(computeMods(ext).revenueMult < computeMods(hard).revenueMult && computeMods(hard).revenueMult < 1, 'and amenity revenue is squeezed');
}

// undoing a placement costs money, not the week
{
  const s = createRun({ seed: 3 });
  const t = placeTile(s.board, 'coffee', 5, 3, 0);
  s.ap = 0;
  ok(deleteTile(s, t.id).ok && s.board.tiles.length === 0, 'deleting a tile costs no AP');
}

// time-aware travellers: no detour they cannot make the platform from
{
  const lay = createBoard(12, 12);
  for (const [k, x, y] of [['bus_stop', 4, 0], ['newsstand', 4, 3], ['food_stand', 6, 3], ['coffee', 3, 5], ['burger', 6, 5], ['restroom', 8, 6], ['train_station', 6, 11]]) placeTile(lay, k, x, y, 0);
  const seeds = [1, 2, 3, 4, 5, 6];
  const on = seeds.map(seed => simulateWeek(lay, { seed, week: 6 }));
  CONFIG.sim.hurry.enabled = false;
  const off = seeds.map(seed => simulateWeek(lay, { seed, week: 6 }));
  CONFIG.sim.hurry.enabled = true;
  const strands = rs => rs.reduce((n, r) => n + r.counts.stranded, 0);
  ok(strands(on) < strands(off) / 2, `time-aware travellers strand less than half as often (${strands(on)} vs ${strands(off)})`);
  const hurried = on.flatMap(r => r.agents).filter(a => a.events.some(e => e.type === 'hurry'));
  const boarded = hurried.filter(a => a.outcome === 'boarded');
  ok(boarded.length > hurried.length / 2 && boarded.every(a => a.events.findIndex(e => e.type === 'hurry') < a.events.findIndex(e => e.type === 'arrive')), 'a traveller who hurries goes on to the platform');
  // keyed rolls: a tile changes only the travellers who come within its reach
  const far = simulateWeek(lay, { seed: 1, week: 6 });
  placeTile(lay, 'vending', 0, 11, 0);
  const far2 = simulateWeek(lay, { seed: 1, week: 6 });
  const near = a => a.frames.some(([x, y]) => Math.max(Math.abs(x - 0), Math.abs(y - 11)) <= 2);
  const untouched = far.agents.filter(a => !near(a));
  ok(untouched.length > far.agents.length / 2 && far.agents.length === far2.agents.length && untouched.every(a => { const c = far2.agents[a.id]; return a.key === c.key && a.value === c.value && a.outcome === c.outcome; }), 'a new tile changes nobody\'s week but those who pass it');
}

// the fence stops at a building: it spans the open floor the booth stands in
{
  const fb = createBoard(12, 12);
  placeTile(fb, 'gate', 6, 5, 0);          // fence on x = 7, gap at row 5
  placeTile(fb, 'restroom', 7, 1, 0);      // solid at (7..8, 1..2): the panel at row 2 is moot
  const f = checkpointFences(fb);
  ok(fenceBlocked(f, 12, 12, 6, 4, 1, 0) && fenceBlocked(f, 12, 12, 6, 3, 1, 0) && fenceBlocked(f, 12, 12, 6, 11, 1, 0), 'the fence runs along open floor from the booth');
  ok(!fenceBlocked(f, 12, 12, 6, 1, 1, 0) && !fenceBlocked(f, 12, 12, 6, 0, 1, 0), 'and stops where a building already blocks the way');
  // the booth's bonus is applied when they board, after the whole chain
  placeTile(fb, 'bus_stop', 1, 5, 0); placeTile(fb, 'helipad', 9, 5, 0); placeTile(fb, 'coffee', 3, 3, 0);
  const rr = [3, 4, 5, 6].map(seed => simulateWeek(fb, { seed, week: 8, mods: { pickpocketRate: 0 } }));
  const cleared = rr.flatMap(r => r.agents).filter(a => a.outcome === 'boarded' && a.events.some(e => e.type === 'cleared') && a.chain.some(c => !c.exit && !c.name.includes('Checkpoint')));
  ok(cleared.length > 0 && cleared.every(a => a.chain.findIndex(c => c.name.includes('Checkpoint')) > a.chain.findLastIndex(c => !c.exit && !c.name.includes('Checkpoint'))), 'clearing the booth multiplies the finished chain');
}

const rperf0 = performance.now();
for (let i = 0; i < 20; i++) simulateWeek(b, { seed: i, week: 8 });
console.log(`perf: ${((performance.now() - rperf0) / 20).toFixed(1)} ms/week for ${rp.counts.spawned} agents`);
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
