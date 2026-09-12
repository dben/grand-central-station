// Ordinances: one is picked (from 3 offered) at weeks 5, 12 and 20. Permanent.
export const ORDINANCES = {
  tourist_board:   { name: 'Tourist Board',       desc: 'Travellers are far more likely to stop at a shop that was never aimed at them.', mods: { tierMatch: [1.0, 0.6, 0.6, 0.05] } },
  express_charter: { name: 'Express Charter',     desc: 'Travellers are worth much more when they board, and a little less at every shop on the way.', mods: { transportMultBonus: 0.25, amenityMultBonus: -0.10 } },
  zoning_variance: { name: 'Zoning Variance',     desc: 'Tear down a tile and get half your money back.', game: { deleteRefund: 0.5, deleteFreeAP: true } },
  union_contract:  { name: 'Union Contract',      desc: 'Everyone waits longer at the platform before their ride leaves, and shops serve fewer people at once.', mods: { dwellAdd: 2, capacityMult: 0.8 } },
  retail_compact:  { name: 'Retail Compact',      desc: 'Shops take twice the money, but the flat point bonus they add is halved.', mods: { revenueMult: 2, flatMult: 0.5 } },
  night_service:   { name: 'Night Service',       desc: 'The station stays open late: a longer week and more time for arrivals. The quota goes up 15% to match.', mods: { ticks: 30, spawnTicks: 20 }, game: { quotaMult: 1.15 } },
  wayfinding:      { name: 'Wayfinding Signs',    desc: 'Signs draw people to every shop from one square further away, but each shop serves slightly fewer at once.', mods: { amenityRadiusBonus: 1, capacityMult: 0.85 } },
  loyalty_scheme:  { name: 'Loyalty Scheme',      desc: 'Every traveller makes one more stop on the way, but fares pay half.', mods: { stopBudgetBonus: 1, fareMult: 0.5 } },
  staff_expansion: { name: 'Staff Expansion',     desc: 'One more action point every week, but tiles cost 15% more.', game: { apBonus: 1, costMult: 1.15 } },
};
export const ORDINANCE_KEYS = Object.keys(ORDINANCES);
