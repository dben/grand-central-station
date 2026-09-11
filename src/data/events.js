// Event weeks. `quota` multiplies the base quota. `mods` are read by the game
// layer and turned into simulator modifiers (see game/modifiers.js).
export const EVENTS = {
  convention:    { name: 'Convention',      quota: 1.6,  desc: 'All transports spawn +60% batch, mostly $ and $$ travellers.',
                   mods: { batchMult: 1.6, lowTierBias: 0.8 } },
  delays:        { name: 'Delays',          quota: 0.85, desc: 'All transports spawn at half batch and dwell is doubled.',
                   mods: { batchMult: 0.5, dwellMult: 2 } },
  vip:           { name: 'VIP Delegation',  quota: 1.3,  desc: '6 $$$$$ travellers arrive on tick 1 with a high stop budget.',
                   mods: { vipCount: 6, vipBudgetBonus: 4 } },
  holiday_rush:  { name: 'Holiday Rush',    quota: 1.8,  desc: 'Spawn cadence halved for all transports. Expect capacity strain.',
                   mods: { cadenceDiv: 2 } },
  weather_front: { name: 'Weather Front',   quota: 0.9,  desc: 'Water and air transports are offline this week.',
                   mods: { offlineTerrains: ['water'], offlineTags: ['air'] } },
  strike:        { name: 'Strike',          quota: 0.9,  desc: 'Choose one transport terrain type: it produces nothing this week.',
                   mods: { strike: true } },
  inspection:    { name: 'Inspection',      quota: 0.9,  desc: 'Amenities below level 2 run at 70% pull and chain bonus for the week.',
                   mods: { closedBelowLevel: 2, closedRate: 0.7 } },
  festival:      { name: 'Festival',        quota: 1.5,  desc: 'Green space and food amenities gain +0.20 base rate.',
                   mods: { rateBonusTags: { food: 0.2, green: 0.2 } } },
  charter:       { name: 'Charter Season',  quota: 1.7,  desc: 'All travellers roll one tier higher for destination purposes.',
                   mods: { destTierShift: 1 } },
};

export const EVENT_KEYS = Object.keys(EVENTS);

// Milestones: run-wide rules that switch on at a given week. They are not event
// weeks and change no quota - they exist so the timeline can warn you that the
// game is about to change shape. `week` names the CONFIG.run field that holds
// the week, so the tuning stays in one place.
export const MILESTONES = [
  { key: 'crime_wave', week: 'pickpocketsFromWeek', name: 'Crime Wave',
    desc: 'Pickpockets start working the crowd, skimming value off travellers they follow. They arrive in small numbers and build up over three weeks. A Security Station or Guard clears them out of its radius, and a Security Checkpoint catches any that walk through it.' },
  { key: 'new_stock', week: 'rareTilesFromWeek', name: 'New Stock',
    desc: 'Rare tiles start turning up in the shop.' },
  { key: 'extra_shift', week: 'apUpgradeFromWeek', name: 'Overtime Approved',
    desc: 'Extra Shift appears in the shop: a permanent +1 action point every week.' },
];
