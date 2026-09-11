// Ordinances: one is picked (from 3 offered) at weeks 5, 12 and 20. Permanent.
export const ORDINANCES = {
  tourist_board:   { name: 'Tourist Board',       desc: 'Travellers two tiers off an amenity still roll at 0.6x instead of 0.25x.', mods: { tierMatch: [1.0, 0.6, 0.6, 0.05] } },
  express_charter: { name: 'Express Charter',     desc: 'Transport multipliers +0.25, amenity multipliers -0.10.', mods: { transportMultBonus: 0.25, amenityMultBonus: -0.10 } },
  zoning_variance: { name: 'Zoning Variance',     desc: 'Deleting a tile refunds half its cost and costs no AP.', game: { deleteRefund: 0.5, deleteFreeAP: true } },
  union_contract:  { name: 'Union Contract',      desc: 'Dwell +2 ticks everywhere; amenity capacity -20%.', mods: { dwellAdd: 2, capacityMult: 0.8 } },
  retail_compact:  { name: 'Retail Compact',      desc: 'Amenity revenue doubled; flat point values halved.', mods: { revenueMult: 2, flatMult: 0.5 } },
  night_service:   { name: 'Night Service',       desc: '30 ticks per week instead of 24, and arrivals run 4 ticks longer; quota x1.15.', mods: { ticks: 30, spawnTicks: 20 }, game: { quotaMult: 1.15 } },
  wayfinding:      { name: 'Wayfinding Signs',    desc: 'Every service amenity gains +1 radius; capacity -15%.', mods: { amenityRadiusBonus: 1, capacityMult: 0.85 } },
  loyalty_scheme:  { name: 'Loyalty Scheme',      desc: 'Every traveller starts with +1 stop budget; fares -50%.', mods: { stopBudgetBonus: 1, fareMult: 0.5 } },
  staff_expansion: { name: 'Staff Expansion',     desc: '+1 action point every week; tiles cost 15% more.', game: { apBonus: 1, costMult: 1.15 } },
};
export const ORDINANCE_KEYS = Object.keys(ORDINANCES);
