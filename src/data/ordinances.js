// Ordinances: one is picked (from 3 offered) at weeks 5, 12 and 20. Permanent.
export const ORDINANCES = {
  tourist_board:   { name: 'Tourist Board',       desc: 'Travellers two tiers off an amenity still roll at 0.6x instead of 0.25x.', mods: { tierMatch: [1.0, 0.6, 0.6, 0.05] } },
  express_charter: { name: 'Express Charter',     desc: 'Transport multipliers +0.25, amenity multipliers -0.10.', mods: { transportMultBonus: 0.25, amenityMultBonus: -0.10 } },
  zoning_variance: { name: 'Zoning Variance',     desc: 'Deleting a tile refunds half its cost and costs no AP.', game: { deleteRefund: 0.5, deleteFreeAP: true } },
  union_contract:  { name: 'Union Contract',      desc: 'Dwell +2 ticks everywhere; amenity capacity -20%.', mods: { dwellAdd: 2, capacityMult: 0.8 } },
  retail_compact:  { name: 'Retail Compact',      desc: 'Amenity revenue doubled; flat point values halved.', mods: { revenueMult: 2, flatMult: 0.5 } },
  night_service:   { name: 'Night Service',       desc: '24 ticks per week instead of 20; quota x1.15.', mods: { ticks: 24, spawnTicks: 20 }, game: { quotaMult: 1.15 } },
  open_borders:    { name: 'Open Borders',        desc: 'Corridor lanes are walkable.', mods: { walkableLanes: true } },
  loyalty_scheme:  { name: 'Loyalty Scheme',      desc: 'Every traveller starts with +1 stop budget; fares -50%.', mods: { stopBudgetBonus: 1, fareMult: 0.5 } },
};
export const ORDINANCE_KEYS = Object.keys(ORDINANCES);
