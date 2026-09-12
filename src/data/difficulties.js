// Difficulty sits on top of the mode: the mode picks the board and its one
// standing rule, the difficulty scales the pressure. It is chosen before the
// run and never changes. Standard is the game as tuned, so every number below
// is 1 (or absent) for it and the levers only bite on Hard and Extreme.
//
// Levers, all multipliers on what Standard does:
//   quotaMult       flat multiplier on every week's quota
//   quotaGrowthAdd  added to the per-week quota growth rate, so the gap widens
//   costMult        tile prices (upgrades, cards and bridges are unaffected)
//   startMoneyMult  cash at week 1
//   mods            simulator modifiers, merged like an ordinance's
export const DIFFICULTIES = {
  standard: {
    name: 'Standard', desc: 'The game as intended. Normal quota, normal prices, normal income.',
  },
  hard: {
    name: 'Hard', desc: 'The quota is 15% higher and climbs faster. Tiles cost more, you start with less cash, and everything pays 10% less.',
    quotaMult: 1.15, quotaGrowthAdd: 0.012, costMult: 1.15, startMoneyMult: 0.85,
    mods: { revenueMult: 0.9, fareMult: 0.9 },
  },
  extreme: {
    name: 'Extreme', desc: 'The quota is 20% higher and climbs much faster. Tiles cost a third more, you start with less cash, and everything pays 20% less.',
    quotaMult: 1.2, quotaGrowthAdd: 0.045, costMult: 1.35, startMoneyMult: 0.8,
    mods: { revenueMult: 0.8, fareMult: 0.8 },
  },
};
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);
