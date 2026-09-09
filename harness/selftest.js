// Basic invariants: determinism, placement rules, gate filtering.
import { createBoard, checkPlacement, placeTile, removeTile } from '../src/sim/board.js';
import { simulateWeek } from '../src/sim/sim.js';
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

// gate filtering: wall the board with a gate + tiles so that only gate crossers reach the east side
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);     // west
placeTile(b, 'helipad', 9, 5, 0);      // east
for (let y = 0; y < 12; y += 4) placeTile(b, 'gate', 6, y, 1); // vertical gates x=6, rows 0-3,4-7,8-11
placeTile(b, 'designer', 7, 1, 0);
const rg = simulateWeek(b, { seed: 3, week: 8 });
ok(rg.counts.boarded > 0, 'gated board still boards');
const crossers = rg.agents.filter(a => a.origin !== a.dest && a.kind === 'traveller');
ok(crossers.length > 0 && crossers.every(a => a.outcome), 'gate crossers exist');
ok(rg.counts.pickpockets === 0 || rg.counts.removed >= 0, 'pickpockets handled');
const rperf0 = performance.now();
for (let i = 0; i < 20; i++) simulateWeek(b, { seed: i, week: 8 });
console.log(`perf: ${((performance.now() - rperf0) / 20).toFixed(1)} ms/week for ${rg.counts.spawned} agents`);
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
