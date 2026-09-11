// Game modes act as character select. `unlockWeek` is the week any run must
// reach (in any mode) before this mode becomes available.
export const MODES = {
  terminal:   { name: 'Terminal',    w: 12, h: 12, desc: 'Baseline. 12x12 board.', unlockWeek: 0 },
  junction:   { name: 'Junction',    w: 9,  h: 9,  desc: 'Small and hard. 9x9 board, start with 3 AP, quota grows faster.', unlockWeek: 8, startAP: 3, quotaGrowth: 1.16 },
  metroplex:  { name: 'Metroplex',   w: 16, h: 16, desc: 'The long game. 16x16 board, tile costs +25%.', unlockWeek: 12, costMult: 1.25 },
  waterfront: { name: 'Waterfront',  w: 12, h: 12, desc: 'Two edges pre-locked to water; water transports -40% cost.', unlockWeek: 8, preLock: { W: 'water', S: 'water' }, terrainCostMult: { water: 0.6 } },
  sky_harbour:{ name: 'Sky Harbour', w: 12, h: 12, desc: 'No rail or water permitted; all Free-terrain tiles -30% cost.', unlockWeek: 12, banTerrains: ['rail', 'water'], terrainCostMult: { free: 0.7 } },
  terminus:   { name: 'Terminus',    w: 12, h: 12, desc: 'One AP per week, but 8 shop slots.', unlockWeek: 16, startAP: 1, fixedAP: 1, shopSlots: 8 },
};
export const MODE_KEYS = Object.keys(MODES);
