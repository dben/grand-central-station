// Basic invariants: determinism, placement rules, gate filtering.
import { createBoard, checkPlacement, placeTile, removeTile, buildWalkMap, checkpointLine, checkpointFences, fenceBlocked } from '../src/sim/board.js';
import { simulateWeek, effAmenity, effTransport, wifiStrength } from '../src/sim/sim.js';
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
const rl = simulateWeek(b, { seed: 4, week: 6 });
ok(rl.counts.lost > 0, 'travellers with no route to their platform are lost');
ok(rl.agents.filter(a => a.outcome === 'lost').every(a => !a.events.some(e => e.type === 'board')), 'lost travellers never board');
const rlOpen = simulateWeek(b, { seed: 4, week: 6 });
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

const rperf0 = performance.now();
for (let i = 0; i < 20; i++) simulateWeek(b, { seed: i, week: 8 });
console.log(`perf: ${((performance.now() - rperf0) / 20).toFixed(1)} ms/week for ${rp.counts.spawned} agents`);
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
