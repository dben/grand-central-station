// Game modes act as character select. `unlockWeek` is the week any run must
// reach (in any mode) before this mode becomes available.
//
// Beyond the board size and its one standing rule, a mode can re-time the run
// for itself:
//   minWeek    per tile key, the week it starts turning up in the shop. Any key
//              in data/tiles.js (transports, amenities, named upgrades) - it
//              replaces that tile's own `minWeek`, earlier or later.
//   quotaMult  scales this level's whole quota curve. A level's target has to
//              match what it can build in a week, and action points are most of
//              that: three a week builds roughly twice the board one does.
//   run        overrides for any field of CONFIG.run: the event cadence
//              (`eventEvery`), the ordinance weeks, and the weeks the specials
//              switch on (`pickpocketsFromWeek`, `rareTilesFromWeek`,
//              `apUpgradeFromWeek`). Whatever is left out keeps the value in
//              src/config.js.
//   startTiles tiles the level is already built with in week 1: { key, x, y,
//              rot, level }. They are placed through the normal rules, so an
//              illegal one throws at run start rather than half-building.
//   week1      the opening hand, overriding CONFIG.shop.week1 field by field,
//              so a level can deal the transport its own terrain needs.
// A tile with a `modes` list is sold on those levels only (see soldOnLevel).
export const MODES = {
  terminal:   { name: 'Terminal',    w: 12, h: 12, desc: 'The standard game, on a 12x12 board.', unlockWeek: 0 },
  junction:   { name: 'Junction',    w: 9,  h: 9,  desc: 'Small and tough. A 9x9 board and 3 action points a week, but the quota climbs faster and the weeks come at you quicker.', unlockWeek: 8, startAP: 3, quotaMult: 1.7,
                // A cramped board that gets its milestones early, and tunnels
                // with them, since a tunnel costs no floor space. It ran an
                // event every third week until the quota band tightened: five
                // event weeks on a 9x9 board killed two runs in three (§15).
                run: { ordinanceWeeks: [4, 9, 15], pickpocketsFromWeek: 5, rareTilesFromWeek: 8, apUpgradeFromWeek: 12 },
                minWeek: { subway: 2, express_subway: 4, under_parking: 2, limo: 3 } },
  metroplex:  { name: 'Metroplex',   w: 16, h: 16, desc: 'The long game. A roomy 16x16 board and the big tiles early, but tiles cost 25% more and the weeks are slower to turn.', unlockWeek: 12, costMult: 1.25,
                // Room for the six-cell tiles, so they come on sale early; in
                // exchange the run's own milestones are pushed back.
                run: { eventEvery: 5, ordinanceWeeks: [6, 13, 20], pickpocketsFromWeek: 9, rareTilesFromWeek: 12, apUpgradeFromWeek: 16 },
                minWeek: { express_train: 3, cruise_dock: 5, jumbo_jetway: 6, cafeteria: 3, flier_club: 7 } },
  waterfront: { name: 'Waterfront',  w: 12, h: 12, desc: 'Two sides of the board start as water, anything that floats costs 40% less, and boats are on sale from week one - starting with the water bus and the pontoon, which nowhere else sells.', unlockWeek: 8, preLock: { W: 'water', S: 'water' }, terrainCostMult: { water: 0.6 },
                // Opened by water: the hand deals the pontoon in place of the
                // car park, which is the same tile on a different terrain, and
                // leaves the other three slots rolling as usual.
                week1: { fixed: ['pontoon', 'burger'] },
                minWeek: { ferry: 1, water_taxi: 1, marina: 4, cruise_dock: 5, sub_dock: 3 } },
  // A long, narrow board rather than a square one: the checkpoint across its
  // waist splits 8x16 into two 8x8 halves, airside and landside, each about the
  // size of a Junction board. That is the level's whole shape - build a station
  // twice, once either side of the fence, and walk every traveller through it.
  sky_harbour:{ name: 'Sky Harbour', w: 8,  h: 16, desc: 'A long board with the airfield at one end and the road at the other, split down the middle by a security checkpoint. No trains and no boats, but light aircraft are on sale from week one and anything that needs no terrain costs 30% less.', unlockWeek: 12, banTerrains: ['rail', 'water'], terrainCostMult: { free: 0.7 },
                preLock: { N: 'apron', S: 'road' },
                // The booth straddles the line y=8 with its fence running the
                // width of the board: everyone landing airside has to clear it
                // to reach the road. Hence security tiles and the crime wave early.
                startTiles: [{ key: 'gate', x: 3, y: 7, rot: 1 }],
                // Pickpockets are the level's signature, so they start almost at
                // once - but over six weeks rather than three, so week 3 is a
                // nuisance to build against and not a wall.
                run: { pickpocketsFromWeek: 3, pickpocketRamp: 6 },
                week1: { fixed: ['prop_stand', 'parking_lot', 'burger'], transport: 1, amenity: 1 },
                minWeek: { jetway: 2, jumbo_jetway: 6, helipad: 3, balloon: 2, jetpack: 4, private_terminal: 8, security: 3, guard: 3, gate: 1 } },
  terminus:   { name: 'Terminus',    w: 12, h: 12, desc: 'Only one action point a week, but the shop shows eight cards and the overtime deal comes early.', unlockWeek: 16, startAP: 1, fixedAP: 1, shopSlots: 8, quotaMult: 0.52, quotaGrowth: 1.17,
                // One move a week, so the week clock is slower and the things
                // that buy you more moves arrive sooner.
                run: { eventEvery: 5, ordinanceWeeks: [4, 10, 18], rareTilesFromWeek: 8, apUpgradeFromWeek: 8, apUpgradeCost: 320 } },
};
export const MODE_KEYS = Object.keys(MODES);
for (const [k, m] of Object.entries(MODES)) m.key = k;

// Is this tile sold here at all? A tile with no `modes` list is sold everywhere;
// one with a list belongs to those levels, and nowhere else.
export function soldOnLevel(mode, def) { return !def.modes || (!!mode && def.modes.includes(mode.key)); }

// The week a tile starts appearing in the shop on this level.
export function minWeekOf(mode, key, def) {
  const over = mode && mode.minWeek && mode.minWeek[key];
  return over != null ? over : def.minWeek;
}
