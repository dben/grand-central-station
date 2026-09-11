// Bonus cards - consumables from the wildcard slot. Cost 1 AP + money to play.
// target: none | tile | transport | amenity | edge
export const CARDS = {
  overtime:       { name: 'Overtime',           cost: 40,  target: 'none',      desc: '+2 AP this week only.' },
  temp_staff:     { name: 'Temp Staff',         cost: 70,  target: 'none',      desc: '+1 AP this week and each of the next two.', ap: 1, weeks: 3 },
  fast_pass:      { name: 'Fast Pass',          cost: 60,  target: 'none',      desc: 'All travellers +2 stop budget next week.', effect: { stopBudgetBonus: 2 }, weeks: 1 },
  charter_bus:    { name: 'Charter Bus',        cost: 50,  target: 'none',      desc: '40 extra $ travellers arrive next week.', effect: { extraSpawns: [{ tier: 1, count: 40 }] }, weeks: 1 },
  rezoning:       { name: 'Rezoning Permit',    cost: 120, target: 'edge',      desc: 'Unlock one locked edge back to greenfield.' },
  coupon_book:    { name: 'Coupon Book',        cost: 30,  target: 'none',      desc: 'Half fare income, double spawn batch, for 2 weeks.', effect: { batchMult: 2, fareMult: 0.5 }, weeks: 2 },
  grand_opening:  { name: 'Grand Opening',      cost: 70,  target: 'amenity',   desc: 'One amenity serves at 100% rate for one week.', weeks: 1 },
  timetable:      { name: 'Timetable Shuffle',  cost: 40,  target: 'transport', desc: 'Reroll the arrival cadence of one transport tile.' },
  survey_crew:    { name: 'Survey Crew',        cost: 30,  target: 'none',      desc: 'Preview the event two weeks out.' },
};
