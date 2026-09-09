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
    startAP: 2,
    apMilestones: { 6: 3, 12: 4, 20: 5 },   // week -> AP per week from then on
    winWeek: 16,                // win screen fires here; play continues (endless)
    eventEvery: 4,              // every Nth week is an event week
    ordinanceWeeks: [5, 12, 20],
    ordinanceChoices: 3,
    pickpocketsFromWeek: 8,
    rareTilesFromWeek: 10,
    apUpgradeFromWeek: 20,
    apUpgradeCost: 400,
  },

  // ------------------------------------------------------------------- quota
  quota: {
    base: 5000,                 // (doc: 3000) raised after harness testing
    growth: 1.28,               // (doc: 1.25) per-week multiplier
    // Quota(week) = base * growth^(week-1) * eventMultiplier * ordinanceMultiplier
  },

  // ----------------------------------------------------------------- economy
  economy: {
    rerollFees: [10, 25, 60, 150, 350],   // escalating, resets weekly; last value repeats
    waitInterestRate: 0.08,
    waitInterestCap: 100,
    tileCostScalePerTile: 0.06,           // (doc: 0.04) cost * (1 + this * tilesOnBoard)
    revenueScale: 0.35,                   // global multiplier on amenity revenue (doc values were far too generous)
    fareScale: 0.35,                      // global multiplier on fares (doc: 1.0)
    upgradeCosts: [60, 140, 300, 650],    // level 1->2, 2->3, 3->4, 4->5
    maxLevel: 5,
    deleteRefund: 0,                      // fraction of base cost refunded on delete
    strandedMultiplier: 0.5,              // stranded travellers bank value * this
  },

  // --------------------------------------------------------------- simulation
  sim: {
    ticks: 20,
    spawnTicks: 16,
    lastCallDeparture: true,   // every transport fires a final departure on the last tick; only walkers are stranded
    walkwaySpeed: 2,            // cells per tick while on a moving walkway
    waypointCount: 2,
    waypointSigma: 1.5,         // gaussian spread (cells) around the straight line
    sameTileWanderSigma: 2.5,   // spread when destination == origin (a wander)
    tierMatchExitBonus: 1.5,    // transport exit bonus when traveller tier == transport tier
    gateBudgetBonus: 2,         // extra stop budget for travellers who pass a security gate
    // Tier of a spawned traveller relative to the transport's tier
    tierSpread: { same: 0.78, down: 0.12, up: 0.10 },
    // Service roll: P = base * tierMatch * radiusFalloff * budgetFactor * (wifi bonus)
    tierMatch: [1.0, 0.6, 0.25, 0.05],     // by |tier gap|; last value repeats
    radiusFalloffMin: 0.4,                 // falloff at radius edge (1.0 when adjacent)
    // Waiting areas
    waitingStackValue: 0.10,               // final_multiplier = 1 + stacks * this
    frequentFlierStackValue: 0.16,
    frequentFlierMinTier: 3,
    // Bad actors
    pickpocketRate: 0.05,                  // share of spawns that are pickpockets (from week 8)
    pickpocketSteal: 0.15,                 // share of banked chain value stolen
    kioskPickpocketReduction: 0.25,        // each information kiosk reduces pickpocket rate by this (multiplicative floor 0)
    // WiFi hotspot
    wifiBonus: 0.10,
    wifiCap: 0.20,
    // Green space
    greenSpaceBudgetRestore: 1,
  },

  // --------------------------------------------------------------- travellers
  tiers: [
    // index = tier-1
    { symbol: '$',     base: 100,  fare: 2,  budget: 3, waitCap: 2, color: '#6cc46c' },
    { symbol: '$$',    base: 180,  fare: 5,  budget: 4, waitCap: 3, color: '#4fa3e0' },
    { symbol: '$$$',   base: 320,  fare: 12, budget: 5, waitCap: 4, color: '#b98cf0' },
    { symbol: '$$$$',  base: 600,  fare: 30, budget: 6, waitCap: 5, color: '#f0b24f' },
    { symbol: '$$$$$', base: 1200, fare: 75, budget: 8, waitCap: 6, color: '#f05a7e' },
  ],

  // Destination weight by tier gap (traveller tier - transport tier)
  destinationWeights: {
    same: 1.0, down1: 0.70, up1: 0.45, down2: 0.35, up2: 0.15, far: 0.05,
  },

  // ---------------------------------------------------------------- upgrades
  upgrades: {
    amenity:   { mult: 0.12, capacity: 0.25, revenue: 0.20, rate: 0.03 },  // per level
    transport: { batch: 0.15, mult: 0.08 },
  },

  // ------------------------------------------------------------------- shop
  shop: {
    slots: 5,
    // wildcard slot contents weights
    wildcard: { card: 3, rare: 2, bridge: 0, upgrade: 2, apUpgrade: 1, namedUpgrade: 2 },   // bridge: 0 = pulled from the shop for now (confusing to use)
    // Rarity: prefer tiles whose cost is close to targetCost(week)
    targetCostBase: 32,
    targetCostGrowth: 1.14,
    targetCostSigma: 0.75,     // in log-space
    bridgeCost: 80,
    roadReach: 4,              // road tiles may sit this many cells inland
  },

  // -------------------------------------------------------------- placement
  placement: {
    previewSeeds: 4,           // sims per estimate (with and without)
  },
};

export function quotaForWeek(week, mode, extraMult = 1) {
  const growth = (mode && mode.quotaGrowth) || CONFIG.quota.growth;
  return Math.round(CONFIG.quota.base * Math.pow(growth, week - 1) * extraMult);
}

export function apForWeek(week, mode) {
  let ap = (mode && mode.startAP) || CONFIG.run.startAP;
  for (const [w, v] of Object.entries(CONFIG.run.apMilestones)) {
    if (week >= Number(w)) ap = Math.max(ap, v);
  }
  return ap;
}
