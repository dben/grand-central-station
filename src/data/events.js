// Event weeks. `quota` multiplies the base quota. `mods` are read by the game
// layer and turned into simulator modifiers (see game/modifiers.js). Three
// fields are read by the run layer rather than the simulator:
//   `cash`  - money taken, wiped or reset (see applyWeekCash in game/run.js)
//   `ap`    - extra action points for that week alone
//   `after` - names a CONFIG.run field; the event is skipped until that week
//   `exact` - the quota multiplier is arithmetic, not a demand, so
//             quota.eventStrength leaves it alone (see eventMult)
export const EVENTS = {
  convention:    { name: 'Convention',      quota: 1.6,  desc: 'Every transport brings far more people, most of them on a budget.',
                   mods: { batchMult: 1.6, lowTierBias: 0.8 } },
  delays:        { name: 'Delays',          quota: 0.85, desc: 'Half as many people show up, and everyone waits twice as long for their ride.',
                   mods: { batchMult: 0.5, dwellMult: 2 } },
  vip:           { name: 'VIP Delegation',  quota: 1.3,  desc: 'Six $$$$$ travellers arrive at the start and stop almost anywhere.',
                   mods: { vipCount: 6, vipBudgetBonus: 4 } },
  holiday_rush:  { name: 'Holiday Rush',    quota: 1.8,  desc: 'Every transport runs twice as often. Shops will struggle to keep up.',
                   mods: { cadenceDiv: 2 } },
  weather_front: { name: 'Weather Front',   quota: 0.9,  desc: 'Boats and aircraft are grounded this week.',
                   mods: { offlineTerrains: ['water'], offlineTags: ['air'] } },
  strike:        { name: 'Strike',          quota: 0.9,  desc: 'One kind of transport brings nobody in this week. The union picks which.',
                   mods: { strike: true } },
  inspection:    { name: 'Inspection',      quota: 0.9,  desc: 'Level 1 shops have a slow week: fewer visitors, smaller boost.',
                   mods: { closedBelowLevel: 2, closedRate: 0.7 } },
  festival:      { name: 'Festival',        quota: 1.5,  desc: 'Food and green space draw far more visitors.',
                   mods: { rateBonusTags: { food: 0.2, green: 0.2 } } },
  charter:       { name: 'Charter Season',  quota: 1.7,  desc: 'Travellers head for platforms a tier above their own.',
                   mods: { destTierShift: 1 } },

  // ---- money weeks. These take nothing off the board, so the week scores
  // exactly what a quiet week would and their quota is a flat x1: the bill is
  // in the other currency, and lands on the weeks that come after. Discounting
  // the quota as well was measured as a free pass - a handful of blow-out weeks
  // and two extra runs surviving, for a week that is not actually harder (§15).
  back_taxes:    { name: 'Back Taxes',      quota: 1,    desc: 'The tax office takes a share of your cash before you can spend it.',
                   mods: {}, cash: { payShare: 0.45, payMin: 80 } },
  budget_audit:  { name: 'Use It or Lose It', quota: 1,   desc: 'Cash you have not spent when the week runs is lost, early-start pay included. This week\'s takings are safe.',
                   mods: {}, cash: { wipeOnRun: true } },
  emergency_budget: { name: 'Emergency Budget', quota: 1,    desc: 'Your cash is set to a fixed allowance: cut down if you have more, topped up if you have less.',
                   mods: {}, cash: { resetGrowth: 1.22 } },

  // ---- a crime spree. Held back until the crime wave has started, since the
  // tiles that answer it go on sale in the same week (Security Station, Guard).
  crime_spree:   { name: 'Crime Spree',     quota: 0.9,  desc: 'Far more pickpockets than usual, each one following a traveller.',
                   mods: { pickpocketRate: 0.10 }, after: 'pickpocketsFromWeek' },

  // ---- twice the week. `repeat: 2` runs the week twice over and adds the two
  // up (simulateWeeks), rather than running one week for twice as long: the
  // clock is what caps most travellers' chains, so a 48-tick week scores three
  // to four times a 24-tick one, by a margin that depends on the board. `exact`
  // matters too - x2 is the arithmetic of two weeks, not a demand for a
  // harder one, and pulling it toward 1 would hand out a free week (eventMult).
  double_week:   { name: 'Double Week',     quota: 2,    exact: true, ap: 1, repeat: 2,
                   desc: 'Two weeks run back to back on the same board, against a doubled target.',
                   mods: {} },
};

export const EVENT_KEYS = Object.keys(EVENTS);

// Milestones: run-wide rules that switch on at a given week. They are not event
// weeks and change no quota - they exist so the timeline can warn you that the
// game is about to change shape. `week` names the CONFIG.run field that holds
// the week, so the tuning stays in one place.
export const MILESTONES = [
  { key: 'crime_wave', week: 'pickpocketsFromWeek', name: 'Crime Wave',
    desc: 'Pickpockets follow travellers and steal part of what they are worth, more of them each week. Security Stations and Guards catch them nearby; a Checkpoint catches any that walk through.' },
  { key: 'new_stock', week: 'rareTilesFromWeek', name: 'New Stock',
    desc: 'Unusual tiles start turning up in the shop.' },
  { key: 'extra_shift', week: 'apUpgradeFromWeek', name: 'Overtime Approved',
    desc: 'Extra Shift goes on sale: one more action point every week, for good.' },
];
