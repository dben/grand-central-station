// Basic invariants: determinism, placement rules, gate filtering.
import { createBoard, startBoard, checkPlacement, placeTile, removeTile, buildWalkMap, checkpointLine, checkpointFences, fenceBlocked, undergroundCells, lineAvailable, cutOffTransports } from '../src/sim/board.js';
import { simulateWeek, effAmenity, effTransport, wifiStrength } from '../src/sim/sim.js';
import { createRun, buyTile, playCard, rezoningVictims, deleteTile, quotaFor, tileCost, computeMods, difficultyOf, runRules, isEventWeek, milestoneForWeek, shopPool, weekTouched, redoWeek } from '../src/game/run.js';
import { MODES, MODE_KEYS, minWeekOf } from '../src/data/modes.js';
import { tileDef, TRANSPORTS, AMENITIES, NAMED_UPGRADES } from '../src/data/tiles.js';
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

// broadside: the ferry is the jetway's mirror image - the long side of the L on
// the water, the short foot inland
b = createBoard(12, 12);
const fer = SHAPES.L4.map((_, r) => checkPlacement(b, 'ferry', 4, 0, r));
ok(fer.filter(c => c.ok).length === 2, 'ferry: exactly 2 of the L4 orientations lie along the north edge');
ok(fer.filter(c => c.ok).every(c => c.cells.filter(([, y]) => y === 0).length === 3), 'ferry: a legal berth puts its long side of three on the edge');
ok(fer.filter(c => !c.ok).every(c => c.reason.includes('side-on')), 'ferry: every other orientation is turned away side-on');
ok(!checkPlacement(b, 'ferry', 0, 0, 1).ok, 'ferry: corner placement touching two edges is rejected');
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
// a cell walled in beside a platform is not a door: nobody steps out into it,
// and it never makes the platform's travellers lost (the old first-door rule did)
b = createBoard(12, 12);
placeTile(b, 'bus_stop', 1, 5, 0);
placeTile(b, 'helipad', 9, 5, 0);
for (const [x, y] of [[2, 4], [3, 4], [4, 4], [4, 5], [4, 6], [3, 6], [2, 6]]) placeTile(b, 'vending', x, y, 0);   // (3,5) is a pocket next to the bus stop
{
  const rp = [1, 2, 3].map(seed => simulateWeek(b, { seed, week: 6 }));
  ok(rp.every(r => r.counts.lost === 0), 'a pocket beside a platform strands nobody');
  ok(rp.every(r => r.agents.every(a => !(a.frames[0][0] === 3 && a.frames[0][1] === 5))), 'nobody spawns in a pocket');
  ok(rp.every(r => r.agents.every(a => a.frames.every(([x, y]) => !(x === 3 && y === 5)))), 'and nobody ever stands in one');
}

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
  ok(!checkPlacement(b, 'water_taxi', 0, 2, 1).ok && checkPlacement(b, 'water_taxi', 0, 2, 1).reason.includes('comes up at'), 'an edge where a subway surfaces cannot become water');
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
  ok(quotaFor(std, 1) === CONFIG.quota.base && JSON.stringify(computeMods(std)) === JSON.stringify(computeMods({ ...std, diffKey: 'standard' })), 'Standard leaves the quota and the simulator alone');
  const q = (s, w) => quotaFor(s, w);
  const weeks = [1, 2, 4, 8, 12, 16];
  // quotas round to whole stars, so week 1 can tie between two difficulties
  ok(weeks.every(w => q(ext, w) >= q(hard, w) && q(hard, w) >= q(std, w)) && q(ext, 4) > q(hard, 4), 'a harder run needs more every week');
  // the growth lever is the point: the gap has to widen, not just sit there
  ok(q(hard, 16) / q(std, 16) > q(hard, 1) / q(std, 1) && q(ext, 16) / q(std, 16) > q(ext, 1) / q(std, 1), 'and the gap widens by week 16');
  const cost = s => tileCost(s, tileDef('coffee'));
  ok(cost(hard) > cost(std) && cost(ext) > cost(hard) && ext.money < hard.money && hard.money < std.money, 'tiles cost more and the opening cash is smaller');
  ok(computeMods(ext).revenueMult < computeMods(hard).revenueMult && computeMods(hard).revenueMult < 1, 'and amenity revenue is squeezed');
  // Redo Week is Standard's one non-numeric lever: it puts the week back
  ok(!!std.weekStart && !hard.weekStart && !ext.weekStart, 'only Standard keeps the week it started');
  ok(!weekTouched(std), 'and nothing to take back before the first move');
  const card = std.shop.cards.find(c => c.type === 'tile');
  let bought = false;
  for (let y = 0; y < 12 && !bought; y++) for (let x = 0; x < 12 && !bought; x++) for (let r = 0; r < 4 && !bought; r++) bought = buyTile(std, card, x, y, r).ok;
  ok(bought && weekTouched(std), 'buying a tile is something to take back');
  const spent = { money: std.money, ap: std.ap, tiles: std.board.tiles.length, cards: std.shop.cards.length };
  ok(redoWeek(std).ok && std.money === 220 && std.ap === 2 && std.board.tiles.length === 0 && std.shop.cards.length === spent.cards + 1, 'redo puts the board, the cash, the points and the shop back');
  ok(!weekTouched(std) && !redoWeek(hard).ok, 'and then has nothing left to take back, while Hard never could');
}

// undoing a placement costs money, not the week
{
  const s = createRun({ seed: 3 });
  const t = placeTile(s.board, 'coffee', 5, 3, 0);
  s.ap = 0;
  ok(deleteTile(s, t.id).ok && s.board.tiles.length === 0, 'deleting a tile costs no AP');
  // A tile bought this week hands its action point back when it is pulled, so a
  // bad spot can be rebuilt with the same move. One from an earlier week does
  // not: that would be a free move rather than an undo.
  const u = createRun({ seed: 3 });
  const card = u.shop.cards.find(c => c.type === 'tile');
  let bought = null;
  for (let y = 0; y < 12 && !bought; y++) for (let x = 0; x < 12 && !bought; x++) for (let r = 0; r < 4 && !bought; r++) { const res = buyTile(u, card, x, y, r); if (res.ok) bought = res.tile; }
  const apAfterBuy = u.ap;
  ok(bought && deleteTile(u, bought.id).apBack && u.ap === apAfterBuy + 1, 'deleting this week\'s own placement hands the action point back');
  const old = placeTile(u.board, 'coffee', 5, 3, 0);
  old.placedWeek = u.week - 1;
  const apBefore = u.ap;
  ok(!deleteTile(u, old.id).apBack && u.ap === apBefore, 'deleting an older tile does not');
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
  // and the same holds for a transport, which brings its own crowd and adds
  // itself to everyone's list of places to go. Only the travellers who choose
  // it may change: a pick keyed by tile (`race`) leaves the rest where they
  // were, where a sweep down the weights re-rolled half the board (design doc 15).
  const stop = placeTile(lay, 'bike_rental', 0, 10, 0);
  const far3 = simulateWeek(lay, { seed: 1, week: 6 });
  const by = new Map(far3.agents.map(a => [a.key, a]));
  const passes = a => a.frames.some(([x, y]) => Math.max(Math.abs(x - 0), Math.abs(y - 10)) <= 3);
  const others = far2.agents.filter(a => by.has(a.key) && !passes(a) && !passes(by.get(a.key)) && by.get(a.key).dest !== stop.id);
  ok(far3.agents.length > far2.agents.length, 'a new platform brings its own travellers');
  ok(others.length > 0 && others.every(a => { const c = by.get(a.key); return a.value === c.value && a.outcome === c.outcome; }),
    `a new platform leaves the travellers who neither pass it nor board it alone (${others.length} of them)`);
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

// levels re-time the run for themselves: tile weeks, event cadence, specials
{
  // what the shop is allowed to draw on a level in a given week
  const onSale = (modeKey, week) => {
    const s = createRun({ modeKey, seed: 11 });
    s.week = week;
    return shopPool(s).map(d => d.key);
  };
  // every level's overrides name real tiles, or a typo would quietly do nothing
  const keys = new Set([...Object.keys(TRANSPORTS), ...Object.keys(AMENITIES), ...Object.keys(NAMED_UPGRADES)]);
  ok(MODE_KEYS.every(k => Object.keys(MODES[k].minWeek || {}).every(t => keys.has(t))), 'every per-level tile week names a tile that exists');
  ok(minWeekOf(MODES.sky_harbour, 'jetway', tileDef('jetway')) === 2 && minWeekOf(MODES.terminal, 'jetway', tileDef('jetway')) === 6, 'a level can move a tile\'s week without touching the catalogue');
  ok(onSale('sky_harbour', 2).includes('jetway') && !onSale('terminal', 2).includes('jetway'), 'and Sky Harbour offers jetways in week 2 where Terminal does not');
  ok(!onSale('metroplex', 11).includes('private_terminal') && onSale('terminal', 11).includes('private_terminal'), 'a level can push the rare stock back too');
  const mx = createRun({ modeKey: 'metroplex', seed: 5 }), tm = createRun({ modeKey: 'terminal', seed: 5 });
  ok(runRules(mx).eventEvery === 5 && runRules(tm).eventEvery === 4 && isEventWeek(mx, 5) && !isEventWeek(tm, 5), 'a level sets its own event cadence');
  ok(runRules(tm).startMoney === CONFIG.run.startMoney, 'and inherits every field it does not override');
  const jn = createRun({ modeKey: 'junction', seed: 5 });
  ok(milestoneForWeek(jn, 5).key === 'crime_wave' && !milestoneForWeek(tm, 5), 'the specials start when the level says');
  // the crime wave reaches the simulator as a modifier, not as a mode
  const sh = createRun({ modeKey: 'sky_harbour', seed: 5 });
  sh.week = 5;
  ok(computeMods(sh).pickpocketsFromWeek === 3 && computeMods(tm).pickpocketsFromWeek === 7, 'and travels to the sim in the mods');
  ok(computeMods(sh).pickpocketRamp === 6 && computeMods(tm).pickpocketRamp === null, 'along with how gently it ramps up, where the level says');
}

// `reach`: a small boat or light aircraft sits inland on a jetty or a taxiway,
// the way a bus stop sits inland on a driveway.
{
  const wb = createBoard(12, 12, { W: 'water', S: 'water', N: 'rail', E: 'rail' });
  let c = checkPlacement(wb, 'water_bus', 3, 6, 0);
  ok(c.ok && c.driveway.length === 3 && c.driveway.every(d => d[2] === 'water'), 'a water bus 3 squares inland runs a jetty out to the water');
  ok(!checkPlacement(wb, 'water_bus', 5, 6, 0).ok, 'but not 4 squares inland, which is past its reach');
  ok(checkPlacement(wb, 'water_bus', 0, 6, 0).ok, 'and it still berths straight on the shore');
  placeTile(wb, 'water_bus', 3, 6, 0, c);
  ok(wb.driveways.length === 3 && !checkPlacement(wb, 'vending', 1, 6, 0).ok, 'the jetty is reserved ground like a driveway');
  placeTile(wb, 'newsstand', 1, 3, 0);
  ok(!checkPlacement(wb, 'water_bus', 3, 3, 0).ok, 'and a building standing in the way blocks the run to the shore');
  // a green edge is claimed and locked, exactly as a berth on the shore would
  const ab = createBoard(12, 12);
  c = checkPlacement(ab, 'prop_stand', 4, 2, 0);
  ok(c.ok && c.claims.length === 1 && c.claims[0].lock && c.claims[0].terrain === 'apron', 'a prop stand inland claims and locks the edge its taxiway reaches');
  removeTile(wb, wb.tiles.find(t => t.key === 'water_bus').id);
  ok(wb.driveways.length === 0, 'and pulling the tile takes its jetty with it');
}

// a tile with a `modes` list is that level's own stock
{
  const wf = createRun({ modeKey: 'waterfront', seed: 3 });
  const tm2 = createRun({ modeKey: 'terminal', seed: 3 });
  const keysOf = r => { r.week = 4; return shopPool(r).map(d => d.key); };
  ok(keysOf(wf).includes('water_bus') && !keysOf(tm2).includes('water_bus'), 'Waterfront sells the water bus and Terminal never does');
  ok(!keysOf(wf).includes('prop_stand') && keysOf(createRun({ modeKey: 'sky_harbour', seed: 3 })).includes('prop_stand'), 'and the prop stand belongs to Sky Harbour alone');
  ok(createRun({ modeKey: 'waterfront', seed: 3 }).shop.cards.some(c => c.key === 'pontoon'), 'the level deals its own opening hand');
  ok(keysOf(tm2).includes('pocket_park') && keysOf(wf).includes('pocket_park'), 'a tile with no level list is sold everywhere');
}

// a level can start with tiles already built
{
  const sh = startBoard(MODES.sky_harbour);
  const gate = sh.tiles.find(t => t.key === 'gate');
  ok(sh.edges.N === 'apron' && sh.edges.S === 'road', 'Sky Harbour starts with an airfield on one side and a road on the other');
  ok(sh.tiles.length === 1 && gate, 'and one tile already built: the checkpoint');
  const line = checkpointLine(gate.cells);
  ok(line.axis === 'h' && line.line === 8 && line.gap === 3, 'whose fence runs across the middle of the board');
  const f = checkpointFences(sh);
  const crossings = [];
  for (let x = 0; x < sh.w; x++) if (!fenceBlocked(f, sh.w, sh.h, x, 7, 0, 1)) crossings.push(x);
  ok(crossings.length === 1 && crossings[0] === 3, 'and the booth is the only way from the airfield to the road');
  ok(sh.w === 8 && sh.h === 16 && line.line === sh.h / 2, 'the fence halves a 8x16 board into an airside and a landside 8x8');
  ok(createRun({ modeKey: 'sky_harbour', seed: 7 }).board.tiles.length === 1, 'a new run is handed that board');
  ok(startBoard(MODES.terminal).tiles.length === 0, 'a level with no starting tiles begins empty');
}

const rperf0 = performance.now();
for (let i = 0; i < 20; i++) simulateWeek(b, { seed: i, week: 8 });
console.log(`perf: ${((performance.now() - rperf0) / 20).toFixed(1)} ms/week for ${rp.counts.spawned} agents`);
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
