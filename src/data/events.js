// Event weeks. `quota` multiplies the base quota. `mods` are read by the game
// layer and turned into simulator modifiers (see game/modifiers.js).
export const EVENTS = {
  convention:    { name: 'Convention',      quota: 1.6,  desc: 'Crowds pour in. Every transport brings far more people, most of them on a budget.',
                   mods: { batchMult: 1.6, lowTierBias: 0.8 } },
  delays:        { name: 'Delays',          quota: 0.85, desc: 'Half as many people show up, and everyone waits twice as long at the platform before their ride leaves.',
                   mods: { batchMult: 0.5, dwellMult: 2 } },
  vip:           { name: 'VIP Delegation',  quota: 1.3,  desc: 'Six $$$$$ travellers turn up right at the start, and they will stop almost anywhere.',
                   mods: { vipCount: 6, vipBudgetBonus: 4 } },
  holiday_rush:  { name: 'Holiday Rush',    quota: 1.8,  desc: 'Every transport runs twice as often. Your shops will struggle to keep up.',
                   mods: { cadenceDiv: 2 } },
  weather_front: { name: 'Weather Front',   quota: 0.9,  desc: 'Boats and aircraft are grounded. Nothing arrives by water or air this week.',
                   mods: { offlineTerrains: ['water'], offlineTags: ['air'] } },
  strike:        { name: 'Strike',          quota: 0.9,  desc: 'Pick one kind of transport. It brings nobody in this week.',
                   mods: { strike: true } },
  inspection:    { name: 'Inspection',      quota: 0.9,  desc: 'Any shop still at level 1 has a slow week: fewer people stop, and they gain less from it.',
                   mods: { closedBelowLevel: 2, closedRate: 0.7 } },
  festival:      { name: 'Festival',        quota: 1.5,  desc: 'Food and green space are much more likely to tempt a traveller in.',
                   mods: { rateBonusTags: { food: 0.2, green: 0.2 } } },
  charter:       { name: 'Charter Season',  quota: 1.7,  desc: 'Everyone is headed somewhere grander. Travellers pick platforms a tier above their own.',
                   mods: { destTierShift: 1 } },
};

export const EVENT_KEYS = Object.keys(EVENTS);

// Milestones: run-wide rules that switch on at a given week. They are not event
// weeks and change no quota - they exist so the timeline can warn you that the
// game is about to change shape. `week` names the CONFIG.run field that holds
// the week, so the tuning stays in one place.
export const MILESTONES = [
  { key: 'crime_wave', week: 'pickpocketsFromWeek', name: 'Crime Wave',
    desc: 'Pickpockets start working the crowd. They follow travellers and steal part of what they are worth. A few at first, more over the next three weeks. A Security Station or Guard clears them out of the area around it, and a Security Checkpoint catches any that walk through.' },
  { key: 'new_stock', week: 'rareTilesFromWeek', name: 'New Stock',
    desc: 'Unusual tiles start turning up in the shop.' },
  { key: 'extra_shift', week: 'apUpgradeFromWeek', name: 'Overtime Approved',
    desc: 'Extra Shift goes on sale. Buy it once and you get an extra action point every week for the rest of the run.' },
];
