// Difficulty sits on top of the mode: the mode picks the board and its one
// standing rule, the difficulty scales the pressure. It is chosen before the
// run and never changes. Standard is the game as tuned, so every number below
// is 1 (or absent) for it and the levers only bite on Hard and Extreme.
//
// Levers, all multipliers on what Standard does:
//   quotaMult       flat multiplier on every week's quota
//   quotaGrowthAdd  added to the per-week quota growth rate, so the gap widens
//   costMult        tile prices (upgrades, cards and bridges are unaffected)
//   startMoneyMult  cash at week 1. Read it against costMult, not on its own:
//                   the two multiply into the opening hand's buying power, and
//                   at 0.8 cash against 1.35 prices Extreme could afford barely
//                   half of what Standard could. A level with three action
//                   points then had money for two of them and died in week 1
//                   (§15), so both levels now cut cash far less than prices.
//   mods            simulator modifiers, merged like an ordinance's
//   redo            the week can be taken back and replayed from the start. Only
//                   Standard gets it: on Hard and Extreme a bad move is the game.
export const DIFFICULTIES = {
  standard: {
    name: 'Standard', desc: 'The game as intended. Normal quota, normal prices, normal income, and you can take a week back before you run it.',
    redo: true,
  },
  hard: {
    name: 'Hard', desc: 'The quota is 15% higher and climbs faster. Tiles cost more, you start with less cash, and everything pays 10% less.',
    quotaMult: 1.15, quotaGrowthAdd: 0.008, costMult: 1.15, startMoneyMult: 0.94,
    mods: { revenueMult: 0.9, fareMult: 0.9 },
  },
  extreme: {
    name: 'Extreme', desc: 'The quota starts 15% higher and then pulls away week after week. Tiles cost a third more, you start with less cash, and everything pays 20% less.',
    quotaMult: 1.15, quotaGrowthAdd: 0.030, costMult: 1.35, startMoneyMult: 0.9,
    mods: { revenueMult: 0.8, fareMult: 0.8 },
  },
};
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES);
