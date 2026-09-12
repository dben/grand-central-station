// Game modes act as character select. `unlockWeek` is the week any run must
// reach (in any mode) before this mode becomes available.
export const MODES = {
  terminal:   { name: 'Terminal',    w: 12, h: 12, desc: 'The standard game, on a 12x12 board.', unlockWeek: 0 },
  junction:   { name: 'Junction',    w: 9,  h: 9,  desc: 'Small and tough. A 9x9 board and 3 action points a week, but the quota climbs faster.', unlockWeek: 8, startAP: 3, quotaGrowth: 1.16 },
  metroplex:  { name: 'Metroplex',   w: 16, h: 16, desc: 'The long game. A roomy 16x16 board, but tiles cost 25% more.', unlockWeek: 12, costMult: 1.25 },
  waterfront: { name: 'Waterfront',  w: 12, h: 12, desc: 'Two sides of the board start as water, and anything that floats costs 40% less.', unlockWeek: 8, preLock: { W: 'water', S: 'water' }, terrainCostMult: { water: 0.6 } },
  sky_harbour:{ name: 'Sky Harbour', w: 12, h: 12, desc: 'No trains and no boats. Anything that needs no terrain at all costs 30% less.', unlockWeek: 12, banTerrains: ['rail', 'water'], terrainCostMult: { free: 0.7 } },
  terminus:   { name: 'Terminus',    w: 12, h: 12, desc: 'Only one action point a week, but the shop shows eight cards.', unlockWeek: 16, startAP: 1, fixedAP: 1, shopSlots: 8 },
};
export const MODE_KEYS = Object.keys(MODES);
