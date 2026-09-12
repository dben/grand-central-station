// ============================================================================
// Grand Central Station - central tuning file.
// Every number that a designer might want to nudge lives here. The simulator,
// shop and UI read from this object; nothing else hardcodes balance values.
// Values marked "(doc: X)" differ from the original design document after
// harness testing; the original value is listed for reference.
// ============================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- run flow
  run: {
    startMoney: 220,            // (was 150) a comfortable first two weeks, then income is tight            // cash at week 1
    // AP stays at startAP all run. Only cards (Overtime, Temp Staff, Extra
    // Shift) and ordinances (Staff Expansion) add to it.
    startAP: 2,
    winWeek: 16,                // win screen fires here; play continues (endless)
    eventEvery: 4,              // every Nth week is an event week
    ordinanceWeeks: [5, 12, 20],
    ordinanceChoices: 3,
    // Milestone weeks. These are announced in the timeline (see data/events.js),
    // so they sit on otherwise-blank weeks rather than colliding with an event
    // or an ordinance choice.
    pickpocketsFromWeek: 7,
    rareTilesFromWeek: 10,
    apUpgradeFromWeek: 19,
    apUpgradeCost: 400,
  },

  // ------------------------------------------------------------------- quota
  quota: {
    base: 5400,                 // (was 5000) travellers who mind the clock board about 8% more value
    // A station's output grows fast while it is small and slowly once it is
    // built out, so a single per-week multiplier makes the first half free and
    // the last few weeks a cliff. Growth starts at `earlyGrowth` and decays
    // geometrically (by `growthDecay` per week) toward `growth`, which tracks
    // that curve and keeps every week about as hard as the last.
    growth: 1.125,              // the late, settled per-week multiplier
    earlyGrowth: 1.80,          // week 1 -> 2
    growthDecay: 0.675,         // how fast the rate falls from early to late
    starUnit: 1000,             // one star per this many points; quotas round to a whole star
    // Catch-up ("the city expects more of you"): the quota never sits further
    // below your own recent form than this. quota = max(curve, share * recent),
    // where `recent` is your best week so far ('best') or the last one ('last').
    // It only ever raises the quota, so a run that is behind the curve is never
    // punished for it; what it does is stop a run that is 3x the curve from
    // coasting. `share` 0 turns it off.
    catchUp: { share: 0, from: 'best' },
    // Quota(week) = round(base * growth^(week-1) * eventMult * ordinanceMult, starUnit)
  },

  // ----------------------------------------------------------------- economy
  economy: {
    rerollCost: 0,                        // rerolls are free; they still cost 1 action point
    // Running the week with action points left pays this much per unused point:
    // base + perWeek * (week - 1), so $10 in week 1, $25 in week 4, $85 in week 16.
    earlyFinishBase: 10,
    earlyFinishPerWeek: 5,
    tileCostScalePerTile: 0.06,           // (doc: 0.04) cost * (1 + this * tilesOnBoard)
    revenueScale: 0.35,                   // global multiplier on amenity revenue (doc values were far too generous)
    fareScale: 0.35,                      // global multiplier on fares (doc: 1.0)
    upgradeCosts: [60, 140, 300, 650],    // level 1->2, 2->3, 3->4, 4->5
    maxLevel: 5,
    deleteRefund: 0,                      // fraction of base cost refunded on delete
    // Undoing a placement costs the money already spent, not the week. A
    // delete and a Rezoning Permit are free of action points, so a bad spot
    // can be fixed and rebuilt in the same week.
    deleteCostsAP: false,
    rezoningCostsAP: false,
    strandedMultiplier: 0.5,              // stranded travellers bank value * this
    lostMultiplier: 0,                    // travellers with no route to their platform bank nothing
  },

  // --------------------------------------------------------------- simulation
  sim: {
    ticks: 24,                  // 16 ticks of arrivals, then 8 to clear the board
    spawnTicks: 16,
    lastCallDeparture: true,   // every transport fires a final departure on the last tick; only walkers are stranded
    walkwaySpeed: 2,            // cells per tick while on a moving walkway
    waypointCount: 2,
    waypointSigma: 1.5,         // gaussian spread (cells) around the straight line
    sameTileWanderSigma: 2.5,   // spread when destination == origin (a wander)
    tierMatchExitBonus: 1.5,    // transport exit bonus when traveller tier == transport tier
    // Security Checkpoint: a booth whose fence runs edge to edge along the grid
    // line through its middle. The fence sits between cells, so it costs no floor.
    // Clearing the booth is a chain link of its own (once per traveller): the
    // fence's detours cost walking time, so crossing has to pay for itself.
    checkpoint: {
      mult: 1.3,                // value multiplier for clearing the booth
      multPerLevel: 0.1,        // extra multiplier per checkpoint level above 1
      // true: the multiplier is applied when the traveller boards, on top of
      // the whole chain, so the booth is worth the same wherever on the route
      // it stands. false: it applies at the crossing, like a shop's.
      atExit: true,
      budgetBonus: 2,           // stop budget for clearing the booth; rarely binding on its own
      // How far the fence reaches from the booth: 'edge' (to both board edges),
      // 'walls' (until a solid tile stands beside the line) or a cell count each way.
      fence: 'walls',
      // false: anyone may walk through to reach whatever is on the far side.
      // true: only travellers whose platform is on the far side may cross, so
      // each side keeps its own shops (the old Security Gate rule).
      filter: false,
    },
    // Tier of a spawned traveller relative to the transport's tier
    tierSpread: { same: 0.78, down: 0.12, up: 0.10 },
    // Service roll: P = base * tierMatch * radiusFalloff * budgetFactor * (wifi bonus)
    tierMatch: [1.0, 0.6, 0.25, 0.05],     // by |tier gap|; last value repeats
    radiusFalloffMin: 0.4,                 // falloff at radius edge (1.0 when adjacent)
    // Waiting areas. The stack is the whole point of the tile, so it has to be
    // worth roughly what an amenity's chain bonus is worth; at 0.10 a lounge was
    // a dead 4-cell block that only ever caught a handful of travellers.
    waitingStackValue: 0.24,               // final_multiplier = 1 + stacks * this
    frequentFlierStackValue: 0.38,
    frequentFlierMinTier: 3,
    strikeSkeletonBatch: 0.25,   // batch left running when the struck terrain is the only one on the board
    // Bad actors
    pickpocketRate: 0.05,                  // share of spawns that are pickpockets, once the wave is at full strength
    pickpocketRamp: 3,                     // weeks from the crime wave starting to that full rate
    pickpocketSteal: 0.15,                 // share of banked chain value stolen
    // WiFi hotspot: boosts every tile within its radius. Each hotspot in range
    // adds one unit of `strength` (+`perLevel` per level above 1), capped at
    // `cap` units. Per unit: shops pull harder and multiply more, lounges add
    // more per stack, transports pay a bigger exit bonus. It is floor, not
    // wall, so it never blocks a path.
    wifi: { rate: 0.05, mult: 0.12, stack: 0.04, exit: 0.04, perLevel: 0.5, cap: 2 },
    // Green space
    greenSpaceBudgetRestore: 1,
    // Travellers know when their platform closes. One only accepts a detour if
    // the walk there, the service and the walk on to the platform all fit
    // before the last tick (with `slack` ticks to spare), and one whose
    // remaining wander no longer fits drops the wander and walks straight
    // there. `enabled: false` restores the oblivious crowd.
    hurry: { enabled: true, slack: 0 },
    // Stratified rolls: the travellers a transport sends are spread evenly
    // over the dice (a golden-ratio sequence per spawn slot) instead of each
    // rolling alone, so a week's tiers, destinations and stops land close to
    // their expected mix. Each traveller still looks random; the total is steadier.
    stratify: true,
  },

  // --------------------------------------------------------------- travellers
  tiers: [
    // index = tier-1
    // colours mirror --t1..--t5 in style.css; tier 1 is cream so its
    // travellers still show up against the green board
    { symbol: '$',     base: 100,  fare: 2,  budget: 3, waitCap: 2, color: '#fffbe0' },
    { symbol: '$$',    base: 180,  fare: 5,  budget: 4, waitCap: 3, color: '#35d4ff' },
    { symbol: '$$$',   base: 320,  fare: 12, budget: 5, waitCap: 4, color: '#c77dff' },
    { symbol: '$$$$',  base: 600,  fare: 30, budget: 6, waitCap: 5, color: '#ffd23f' },
    { symbol: '$$$$$', base: 1200, fare: 75, budget: 8, waitCap: 6, color: '#ff4f7a' },
  ],

  // Destination weight by tier gap (traveller tier - transport tier)
  destinationWeights: {
    same: 1.0, down1: 0.70, up1: 0.45, down2: 0.35, up2: 0.15, far: 0.05,
  },

  // ---------------------------------------------------------------- upgrades
  // Per level. These are absolute bumps to `mult`, so they were rescaled with
  // the catalogue: an amenity level has to stay worth the same *share* of the
  // tile's chain bonus now that amenity multipliers are ~3.5x larger and
  // transport exit bonuses ~0.35x.
  upgrades: {
    amenity:   { mult: 0.26, capacity: 0.25, revenue: 0.20, rate: 0.05 },
    transport: { batch: 0.15, mult: 0.03 },
  },

  // ------------------------------------------------------------------- shop
  shop: {
    slots: 5,
    // Every slot rolls independently against these weights, so a week can be
    // three upgrades and two amenities, or five transports. Week 1 is the one
    // exception: a fixed opening hand (see generateShop).
    slotWeights: { transport: 30, amenity: 34, upgrade: 16, card: 10, namedUpgrade: 4, rare: 4, apUpgrade: 2, bridge: 0 },  // bridge: 0 = pulled from the shop for now (confusing to use)
    // The opening hand. `fixed` names cards dealt to every run in order (see
    // generateShop); `transport` and `amenity` are rolled to fill what is left
    // of the shop. Bring people, then serve them.
    week1: { fixed: [], transport: 3, amenity: 2 },
    // Rarity: prefer tiles whose cost is close to targetCost(week)
    targetCostBase: 32,
    targetCostGrowth: 1.14,
    targetCostSigma: 0.75,     // in log-space
    bridgeCost: 80,
    roadReach: 4,              // road tiles may sit this many cells inland
  },

  // -------------------------------------------------------------- placement
  placement: {
    // Sims per estimate. The "without" runs are cached for the phase, so a
    // preview costs one sim per seed; the badge shows the mean over them.
    previewSeeds: 8,
  },
};

// `diff` is the run's difficulty (src/data/difficulties.js): it scales the
// whole curve by `quotaMult` and steepens it by `quotaGrowthAdd`, so a harder
// run is not just uniformly higher but pulls away week by week.
export function quotaForWeek(week, mode, extraMult = 1, diff = null) {
  const q = CONFIG.quota;
  const late = ((mode && mode.quotaGrowth) || q.growth) + ((diff && diff.quotaGrowthAdd) || 0);
  const early = Math.max(late, q.earlyGrowth);
  let raw = q.base;
  for (let i = 1; i < week; i++) raw *= late + (early - late) * Math.pow(q.growthDecay, i - 1);
  raw *= extraMult * ((diff && diff.quotaMult) || 1);
  const u = q.starUnit;
  return Math.max(u, Math.round(raw / u) * u);
}

// Quotas and scores are shown as stars, one per `starUnit` points. Earned stars
// always round *down* (2,400 points is two stars; -100 points is one red star),
// while a quota is already a whole number of stars by construction.
export function starsOf(points) { return Math.floor(points / CONFIG.quota.starUnit); }
export function starTarget(quota) { return Math.round(quota / CONFIG.quota.starUnit); }

// Base AP for a week. Flat for the whole run; cards and ordinances add on top
// (see apForRun in game/run.js).
export function apForWeek(week, mode) {
  return (mode && mode.startAP) || CONFIG.run.startAP;
}
