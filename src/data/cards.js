// Bonus cards - consumables from the wildcard slot. Cost 1 AP + money to play
// (a Rezoning Permit costs no AP unless economy.rezoningCostsAP is set).
// target: none | tile | transport | amenity | edge
export const CARDS = {
  overtime:       { name: 'Overtime',           cost: 40,  target: 'none',      desc: 'Two extra action points, this week only.' },
  temp_staff:     { name: 'Temp Staff',         cost: 70,  target: 'none',      desc: 'One extra action point this week and for the next two weeks.', ap: 1, weeks: 3 },
  fast_pass:      { name: 'Fast Pass',          cost: 60,  target: 'none',      desc: 'Next week, every traveller will stop at two more places on the way.', effect: { stopBudgetBonus: 2 }, weeks: 1 },
  charter_bus:    { name: 'Charter Bus',        cost: 50,  target: 'none',      desc: 'A busload of 40 budget travellers turns up next week.', effect: { extraSpawns: [{ tier: 1, count: 40 }] }, weeks: 1 },
  rezoning:       { name: 'Rezoning Permit',    cost: 120, target: 'edge',      desc: 'Clear one edge of the board back to open ground. Anything attached to that edge is torn down, and you get no money back.' },
  coupon_book:    { name: 'Coupon Book',        cost: 60,  target: 'none',      desc: 'Twice as many travellers next week, but fares and shop takings are halved.', effect: { batchMult: 2, fareMult: 0.5, revenueMult: 0.5 }, weeks: 1 },
  grand_opening:  { name: 'Grand Opening',      cost: 70,  target: 'amenity',   desc: 'For one week, every traveller who walks past one shop stops at it.', weeks: 1 },
  timetable:      { name: 'Timetable Shuffle',  cost: 40,  target: 'transport', desc: 'Reroll how often one transport brings people in.' },
  survey_crew:    { name: 'Survey Crew',        cost: 30,  target: 'none',      desc: 'Look ahead at the event two weeks from now.' },
};
