# Transit Hub — Design Document

**Working title:** Transit Hub
**Platform:** Browser first (desktop and tablet), portrait-friendly layout for later mobile
**Genre:** Turn-based tile-placement roguelite with a simulation scoring phase
**Session length:** 20–40 minutes to week 16; endless after that

---

## 1. Pitch

You run a transit hub. Every week you place a few tiles, then watch a crowd of travellers walk across the board. Each shop, kiosk and lounge they pass multiplies what they are worth. Hit the week's point goal or the run ends. The goal grows exponentially, the board does not, and the edges of the map lock down as you build — so the only way forward is to make each traveller worth more than the last.

The core tension: transport tiles bring people but score badly. Amenities score well but bring nobody. Board space runs out. Wealthy travellers are worth far more but arrive in ones and twos.

---

## 2. Core loop

One week = one turn.

1. **Shop phase.** Five cards are offered. Spend action points and money to buy, place, upgrade, delete or reroll.
2. **Simulation phase.** 20 ticks. Transport tiles spawn travellers, travellers walk to a destination, amenities they pass roll to serve them, each service multiplies their value. Value banks when they board.
3. **Settlement.** Score is compared against the week's quota. Fares and amenity revenue pay out as money. If score is short, the run ends.
4. Quota increases. Next week.

Every fourth week is an **event week** with a modified quota and a rule twist. The player sees the next event but not the one after it.

---

## 3. The board

### 3.1 Grid

| Mode | Grid | Layers |
|---|---|---|
| Terminal (standard) | 12 × 12 | Surface only, subway unlocks week 9 |
| Junction (small/hard) | 9 × 9 | Surface only |
| Metroplex (long) | 16 × 16 | Surface + subway from week 1 |

The grid is fixed for the whole run. There is no board expansion. Growth comes from upgrades, chains and passenger tier, never from more space.

### 3.2 Edges and terrain

The four edges start as greenfield — undeveloped, any transport type may claim them. Placing a transport tile claims terrain, and that claim is permanent even if the tile is later deleted. This is the run's main irreversible decision.

Four claim behaviours:

**FULL LOCK.** The entire edge converts to one terrain type. Rail and water do this. A train station on the east edge turns the whole east edge into track; no ferry, no bus, no road access on that side for the rest of the run. Further rail tiles may be added along that edge freely.

**ROAD.** The edge becomes road, but road is generous. A road tile placed up to 4 tiles inland auto-generates a driveway out to the edge, provided the straight-line path is clear of other tiles. If it is blocked, the tile cannot be placed there. Road tiles stack along an edge without restriction.

**CORRIDOR.** Reserves a straight lane from the tile to the nearest edge. Does not convert the edge. Ski lift, alpine lift and monorail work this way. Cheap in terrain cost, expensive in interior space, since the lane is unbuildable.

**FREE.** No terrain relationship at all. Helipad, hot air balloon, jetpack rental, beam-em-up. These can go anywhere with room for their shape. They are the escape valve for a player who locked all four edges early, and are priced accordingly.

**UNDERGROUND.** Claims an edge on the subway layer only, leaving the surface edge above it untouched. Subway and submarine dock.

### 3.3 Bridges and overpasses

Bridge, tunnel and overpass tiles let one terrain cross another. A bridge placed over water lets road tiles connect past it. These are a whole shop category, not a rare drop — a run where all four edges lock and no bridge ever appears is a design failure, not a difficulty spike.

### 3.4 Walkability

Everything not occupied by a tile, a corridor lane or a terrain edge is walkable. Travellers move one tile per tick, orthogonally and diagonally. There are no walls except the security gate (§7.5).

---

## 4. Turn structure

### 4.1 Action points

The player starts with **2 AP per week**. AP is the universal cost for everything in the shop phase:

| Action | AP | Money |
|---|---|---|
| Buy and place a tile | 1 | tile cost |
| Upgrade a tile in place | 1 | upgrade cost |
| Delete a tile | 1 | 0 (terrain claim stays) |
| Reroll the shop | 1 | escalating fee: 10, 25, 60, 150… resets weekly |
| Play a bonus card | 1 | card cost |
| Wait | all remaining | — gains interest, see §5.3 |

AP grows at set milestones: **3 AP at week 6, 4 AP at week 12, 5 AP at week 20.** After that, AP upgrades appear rarely in the shop as a permanent +1.

### 4.2 The shop

Five slots, rerolled each week. Slots are **typed**, not drawn from one pool, so a player is never starved of a whole category:

| Slot | Contents |
|---|---|
| 1 | Transport tile |
| 2 | Amenity tile |
| 3 | Amenity tile |
| 4 | Upgrade token (generic — applies to any owned tile) or a tile-specific upgrade |
| 5 | Wildcard: bonus card, rare tile, bridge, AP upgrade, or a second upgrade token |

Rarity tiers per slot are weighted by week number, so late-game shops offer bigger tiles.

### 4.3 Simulation ticks

**20 ticks per week: 16 spawn ticks, 4 cleanup ticks.**

- Ticks 1–16: transport tiles spawn travellers on their cadence.
- Ticks 17–20: no new spawns. Travellers already on the board continue, departures still fire.
- End of tick 20: the board clears. Anyone still walking or waiting is **stranded**.

Stranded travellers score their banked chain value with **no exit bonus and a ×0.5 penalty**. They pay no fare. This is a real cost but not a run-killer — a bad week should hurt, not spiral.

Playback speed is player-controlled: 1×, 2×, 4×, or Skip. Skip runs the sim headless and shows the summary. Scoring is deterministic given the seed, so playback speed never changes the result.

---

## 5. Economy

### 5.1 Two currencies

**Points** are the survival currency, compared against the quota. **Money** buys tiles and upgrades. They come from different sources on purpose.

- Points come from the chain — the multipliers a traveller collects.
- Money comes from **fares** (paid on boarding, small) and **amenity revenue** (paid per service, the real income).

A player who builds an efficient transport-only hub scores acceptably and goes broke. A player who builds shops with nothing feeding them earns nothing at all.

### 5.2 Quota curve

```
Quota(week) = 3000 × 1.25^(week − 1)
```

| Week | Quota | Week | Quota |
|---|---|---|---|
| 1 | 3,000 | 12 | 44,400 |
| 4 (event) | 5,900 | 16 | 108,000 |
| 8 (event) | 14,300 | 20 | 264,000 |
| 10 | 28,400 | 24 | 645,000 |

Event weeks apply a multiplier on top of the base quota (see §9). Endless mode past week 16 continues the same curve; the win screen fires at 16 and play continues.

### 5.3 Money details

Fares on boarding, by tier: **$ = 2, $$ = 5, $$$ = 12, $$$$ = 30, $$$$$ = 75.**

Amenity revenue is per service and listed on each tile. Waiting saves the turn's AP and grants **8% interest on held cash, capped at 100**. Interest keeps waiting relevant into the late game without letting a hoarder run away with it.

Tile prices scale with the number of tiles already on the board: **cost × (1 + 0.04 × tilecount)**. A crowded board is an expensive board, which pushes late-game players toward upgrading over adding.

---

## 6. Travellers

### 6.1 Tiers

| Tier | Symbol | Base value | Fare | Stop budget | Waiting-area stack cap |
|---|---|---|---|---|---|
| 1 | $ | 100 | 2 | 3 | 2 |
| 2 | $$ | 180 | 5 | 4 | 3 |
| 3 | $$$ | 320 | 12 | 5 | 4 |
| 4 | $$$$ | 600 | 30 | 6 | 5 |
| 5 | $$$$$ | 1200 | 75 | 8 | 6 |

**Stop budget** is the number of amenity services a traveller will accept before walking straight to their destination. It is the single most important balance dial in the game — it caps chain length and stops the optimal board from being one long hallway lined with twenty shops.

Rendering: a coloured circle. Tier sets colour, a small glyph shows their destination type.

### 6.2 Destination selection

On arrival, a traveller rolls for a destination among all transport tiles currently on the board, including the one they arrived on. Weighting is by tier distance:

| Tier gap | Relative weight |
|---|---|
| Same tier | 1.00 |
| One tier down | 0.70 |
| One tier up | 0.45 |
| Two tiers down | 0.35 |
| Two tiers up | 0.15 |
| Three+ either way | 0.05 |

Weights are normalised across available destinations. Consequence: **adding one high-tier transport tile re-routes traffic across the whole board.** Every transport purchase is a strategic decision, not just a faucet. A $$ traveller with a train, a ferry and a limo available goes roughly 40 / 33 / 27.

### 6.3 Pathing

1. Resolve destination tile.
2. Generate 2 random waypoints, weighted heavily toward the shortest path (sample from a Gaussian around the straight line, σ ≈ 1.5 tiles).
3. If a security gate separates origin from destination, insert the gate as a mandatory waypoint.
4. Walk the waypoint chain, one tile per tick.
5. At each tick, check every amenity whose **pull radius** covers the traveller's position. Roll for service (§6.4). On a hit, detour to the amenity, spend service time, spend one stop budget, then resume.
6. On reaching the destination, wait for the next departure, then bank.

Detours cost ticks and stop budget, which is what makes a dense cluster genuinely risky — a traveller can burn their whole budget on cheap tiles and reach the big multiplier with nothing left.

### 6.4 Service roll

```
P(service) = base_rate × tier_match × radius_falloff × budget_factor
```

- `base_rate` — per amenity, typically 0.20–0.45
- `tier_match` — 1.0 same tier, 0.6 one step, 0.25 two steps, 0.05 three+
- `radius_falloff` — 1.0 adjacent, dropping linearly to 0.4 at the radius edge
- `budget_factor` — 1.0 with budget remaining, 0 at zero

Each amenity may serve a given traveller **once per week**, with one exception: waiting areas (§7.4).

### 6.5 Capacity and balking

Every amenity has a **concurrent capacity** — how many travellers it can serve at one time — and a **service duration** in ticks. Full means the tile is skipped: the traveller **balks** and walks on. No queues in v1.

This creates the position/quality tension: first-come-first-served rewards amenities near spawn points, but multipliers pay best late in a chain. A cheap early tile that soaks the first wave, with the real stack behind it, is a legitimate strategy — and should be made legible rather than left as a happy accident.

Saturation must be visible. Full tiles grey out during playback, and the weekly summary reports **serves and balks per tile**.

---

## 7. Scoring

### 7.1 Order of operations

Each service applies **multiply first, then add**, in the order the traveller encounters them.

```
value = value × tile_multiplier + tile_flat
```

This is deliberate. A tile's flat points get boosted by every multiplier downstream of it and none upstream — so **flat-add tiles want to be early in a route and multipliers want to be late.** The same three tiles score differently depending on walking order. Owning the right tiles is not enough; you have to arrange them.

### 7.2 Exit bonus

Transport tiles the traveller boards apply a multiplier, not a flat add, so exits don't become rounding errors as chains grow. On top of that, a **tier match bonus of ×1.5** applies if the traveller's tier equals the transport's tier.

### 7.3 Worked example

A $$ traveller (base 180) arrives by train, destination ferry.

| Step | Effect | Value |
|---|---|---|
| Spawn | — | 180 |
| Burger Joint ($, ×1.4, +50) | 180 × 1.4 + 50 | 302 |
| Restroom (×1.2, +0) | 302 × 1.2 | 362 |
| Newsstand (×1.15, +30) | 362 × 1.15 + 30 | 446 |
| Ferry exit ($$, ×1.3) | 446 × 1.3 | 580 |
| Tier match ($$ = $$) | × 1.5 | **870** |

Stop budget used: 3 of 4. Fare paid: 5. Amenity revenue: 4 + 1 + 3 = 8.

### 7.4 Waiting areas

Waiting areas are the only tile that may serve the same traveller more than once. They apply a stack per tick while the traveller waits within radius, **capped by tier** (see the table in §6.1). Stacks are **additive while waiting, applied multiplicatively once on boarding**:

```
final_multiplier = 1 + (stack_count × 0.10)
```

Five stacks = ×1.5. The tier cap is what makes the Frequent Flier Club genuinely a high-tier tile rather than the same tile with bigger numbers.

**A waiting slot is held for the whole dwell**, from arrival at the platform to departure. A waiting area next to a slow jetway serves far fewer travellers than one next to a shuttle. That is the placement decision.

### 7.5 Security gate

A gate is a wall segment with a single passable cell. Only travellers whose destination lies on the far side may cross. Effects:

- **Filters.** A $ bus crowd bound for another bus never reaches the shops behind the gate.
- **Raises stop budget by +2** for anyone who crosses, because they arrive early and wait.
- **Removes bad actors.** Pickpockets (§10.3) that cross a gate are removed from the board.

The gate is the late-game structural tile. A high-tier terminal behind a gate, fed by a low-tier landside, is the endgame board shape.

---

## 8. Tile catalogue

All numbers are first-pass tuning baselines, meant to be tuned against the sim harness (§13.1), not treated as final.

### 8.1 Transport tiles

Four timing numbers define every transport tile: **arrival cadence** (ticks between batches), **batch size**, **departure cadence**, and **dwell** (ticks a departing traveller waits). These four numbers are what make a parking lot feel different from a jetway.

| Tile | Shape | Terrain | Tier | Arr. cadence | Batch | Dep. cadence | Dwell | Mult | Flat | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| Bus Stop | I2 | Road | $ | 4 | 20 | 4 | 1 | 1.10 | 40 | 30 |
| Parking Lot | O4 | Road | $ | 1 | 4 | 1 | 0 | 1.05 | 100 | 25 |
| Taxi Stand | I2 | Road | $$ | 2 | 3 | 2 | 0 | 1.20 | 30 | 45 |
| Rideshare Zone | L3 | Road | $$ | 1 | 4 | 1 | 0 | 1.15 | 35 | 40 |
| Car Rental | O4 | Road | $$ | 3 | 8 | 3 | 2 | 1.20 | 60 | 70 |
| Bike Rental | I2 | Road | $ | 2 | 5 | 2 | 0 | 1.10 | 25 | 20 |
| Limo Service | I3 | Road | $$$$ | 5 | 2 | 5 | 1 | 1.60 | 40 | 120 |
| Tram Stop | I3 | Corridor | $$ | 4 | 14 | 4 | 1 | 1.25 | 50 | 65 |
| Train Station | I4 | Rail (lock) | $$ | 6 | 20 | 6 | 2 | 1.30 | 60 | 90 |
| Express Train | I5 | Rail (lock) | $$$ | 8 | 30 | 8 | 3 | 1.45 | 80 | 160 |
| Monorail | I4 | Corridor | $$$ | 5 | 16 | 5 | 2 | 1.40 | 70 | 140 |
| Subway Entrance | O4 | Underground | $$ | 4 | 26 | 4 | 2 | 1.30 | 55 | 110 |
| Ferry Terminal | L4 | Water (lock) | $$ | 8 | 28 | 8 | 3 | 1.30 | 70 | 100 |
| Water Taxi | I2 | Water (lock) | $$$ | 3 | 4 | 3 | 1 | 1.40 | 35 | 75 |
| Marina | S4 | Water (lock) | $$$$ | 8 | 5 | 8 | 4 | 1.65 | 60 | 175 |
| Cruise Ship Dock | I6 | Water (lock) | $$$ | 16 | 90 | 16 | 6 | 1.50 | 150 | 260 |
| Helipad | O4 | Free | $$$$ | 6 | 3 | 6 | 2 | 1.70 | 50 | 190 |
| Hot Air Balloon | T4 | Free | $$$ | 10 | 4 | 10 | 5 | 1.55 | 60 | 130 |
| Jetway | L3 | Rail-adjacent | $$$ | 8 | 34 | 8 | 4 | 1.50 | 90 | 200 |
| Jumbo Jetway | L5 | Rail-adjacent | $$$ | 12 | 70 | 12 | 6 | 1.60 | 140 | 340 |
| Private Terminal | T4 | Rail-adjacent | $$$$$ | 10 | 2 | 10 | 4 | 2.00 | 80 | 380 |
| Ski Lift | I4 | Corridor | $$ | 3 | 8 | 3 | 1 | 1.25 | 40 | 60 |
| Alpine Lift | I5 | Corridor | $$$ | 4 | 10 | 4 | 2 | 1.40 | 55 | 110 |
| Jetpack Rental | I2 | Free | $$$$ | 2 | 2 | 2 | 0 | 1.55 | 30 | 145 |
| Submarine Dock | S4 | Underground | $$$$ | 10 | 6 | 10 | 4 | 1.75 | 70 | 230 |
| Beam-Em-Up Pad | O4 | Free | $$$$$ | 3 | 4 | 3 | 0 | 2.10 | 60 | 420 |

Jetways attach to an apron edge, which behaves as a full lock like rail. Private Terminal and Beam-Em-Up are rare-slot tiles that appear from week 10.

### 8.2 Amenity tiles

| Tile | Shape | Tier | Radius | Base rate | Mult | Flat | Capacity | Duration | Revenue | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| Vending Machine | I1 | $ | 1 | 0.40 | 1.08 | 15 | 4 | 1 | 1 | 15 |
| Newsstand | I2 | $ | 2 | 0.35 | 1.15 | 30 | 8 | 1 | 3 | 30 |
| Restroom | O4 | $ | 2 | 0.45 | 1.20 | 0 | 12 | 2 | 0 | 35 |
| Food Stand | I2 | $ | 2 | 0.35 | 1.20 | 35 | 10 | 2 | 4 | 40 |
| Burger Joint | L3 | $ | 2 | 0.30 | 1.40 | 50 | 20 | 3 | 6 | 60 |
| Pizza Place | S4 | $$ | 2 | 0.30 | 1.45 | 55 | 18 | 3 | 8 | 75 |
| Coffee Shop | I2 | $$ | 3 | 0.40 | 1.35 | 40 | 14 | 2 | 7 | 65 |
| Information Kiosk | I1 | $ | 3 | 0.30 | 1.10 | 20 | 10 | 1 | 1 | 20 |
| Green Space | O4 | $ | 3 | 0.25 | 1.25 | 10 | 30 | 2 | 0 | 45 |
| Sports Bar | T4 | $$ | 2 | 0.28 | 1.55 | 70 | 16 | 4 | 12 | 110 |
| Cafeteria | I6 | $ | 3 | 0.45 | 1.18 | 30 | 45 | 2 | 5 | 130 |
| Currency Exchange | I2 | $$$ | 2 | 0.25 | 1.50 | 40 | 6 | 2 | 15 | 95 |
| Clothing Store | S4 | $$ | 2 | 0.25 | 1.50 | 60 | 12 | 3 | 14 | 105 |
| WiFi Hotspot | I1 | — | 4 | — | — | — | — | — | 0 | 55 |
| Waiting Area | O4 | — | 2 | — | see §7.4 | — | 20 | dwell | 0 | 70 |
| Moving Walkway | I4 | — | 0 | — | — | — | — | — | 0 | 50 |
| Art Gallery | T4 | $$$ | 3 | 0.22 | 1.70 | 80 | 10 | 4 | 18 | 165 |
| Travel Lounge | S5 | $$$ | 2 | 0.30 | 1.65 | 60 | 14 | dwell | 20 | 190 |
| Designer Shop | L4 | $$$$ | 2 | 0.20 | 1.90 | 90 | 8 | 4 | 35 | 240 |
| Security Gate | I4 | — | — | — | see §7.5 | — | — | — | 0 | 150 |
| Frequent Flier Club | O6 | $$$$ | 2 | — | see §7.4 | — | 10 | dwell | 25 | 300 |

**Utility tiles** with no service roll of their own:

- **WiFi Hotspot** — +0.10 to the base rate of every amenity within radius 4. Stacks additively, capped at +0.20 per tile.
- **Moving Walkway** — travellers on it move 2 tiles per tick and take no stop-budget checks while riding. Use it to shuttle a crowd past cheap tiles to reach a multiplier stack with budget intact.
- **Green Space** — no revenue, but restores 1 stop budget on service. The chain-extender tile.

### 8.3 Sci-fi rares (week 12+, wildcard slot only)

| Tile | Effect |
|---|---|
| **Drone Vending Swarm** | Radius 6, ignores line of sight, serves any tier at 0.30. Capacity 6. |
| **Chrono Lounge** | Waiting-area variant. Each stack is 0.18 instead of 0.10, but the tile caps at 6 concurrent. |
| **Gravity Well Concourse** | I6. Bends pathing — every traveller's waypoints are pulled toward this tile, whether or not they use it. |
| **Nanofab Boutique** | Matches the tier of whoever approaches it. Always a tier-match roll. Capacity 5. |
| **Loop Terminal** | Transport, Free terrain. Departing travellers have a 30% chance to immediately re-enter as a new arrival with their chain value intact. |

### 8.4 Upgrades

Generic **upgrade tokens** apply to any owned tile and raise it one level. Levels 1–5.

Per level, an amenity gains: **+0.12 multiplier, +25% capacity, +20% revenue, +0.03 base rate.**
Per level, a transport gains: **+15% batch size, +0.08 multiplier.**

Upgrade level is the exponential axis of the game. Because the board is fixed and capacity flattens raw throughput, a saturated board's only remaining growth is depth. A level-5 pizza place serving 44 at ×2.05 is a completely different tile from the level-1 version, and it occupies the same four cells.

Upgrade cost per level: **60, 140, 300, 650** (money), 1 AP each.

Named upgrades also appear as specific shop cards — "Espresso Bar" upgrades a Coffee Shop two levels at once and adds +1 radius; "Concourse Extension" upgrades every Waiting Area you own by one level.

---

## 9. Events

Every 4th week. The player sees the **next** event as soon as the current one resolves, never the one after.

| Event | Quota | Rule |
|---|---|---|
| Convention | ×1.6 | All transports spawn +60% batch, mostly $ and $$ |
| Delays | ×0.85 | All transports spawn at half batch, dwell doubled |
| VIP Delegation | ×1.3 | 6 $$$$$ travellers spawn on tick 1, high stop budget |
| Holiday Rush | ×1.8 | Spawn cadence halved for all transports; capacity strain |
| Weather Front | ×0.9 | Water and air transports offline this week |
| Strike | ×0.9 | Choose one transport type: it produces nothing this week |
| Inspection | ×1.4 | Amenities below level 2 are closed for the week |
| Festival | ×1.5 | Green space and food amenities gain +0.20 base rate |
| Charter Season | ×1.7 | All travellers roll one tier higher for destination purposes |

Events also serve as tutorial pressure — Weather Front punishes a player who put everything on water, Inspection punishes one who never upgraded.

---

## 10. Run structure

### 10.1 Modes as character select

Mode sets the board and a standing rule. Chosen before the run.

| Mode | Grid | Standing rule |
|---|---|---|
| **Terminal** | 12×12 | Baseline |
| **Junction** | 9×9 | Start with 3 AP; quota curve 1.28 |
| **Metroplex** | 16×16 | Subway from week 1; tile costs +25% |
| **Waterfront** | 12×12 | Two edges pre-locked to water; water transports −40% cost |
| **Sky Harbour** | 12×12 | No rail or water permitted; all Free-terrain tiles −30% cost |
| **Terminus** | 12×12 | One AP per week, but 8 shop slots |

### 10.2 Ordinances

Modes do not create variance between two runs of the same mode. **Ordinances do.** One is drawn at weeks 5, 12 and 20 — the player picks from 3 options.

Examples:

- **Tourist Board** — travellers two tiers below an amenity still roll at 0.6× instead of 0.25×.
- **Express Charter** — transport multipliers +0.25, amenity multipliers −0.10.
- **Zoning Variance** — deletion refunds half the tile cost and no longer costs AP.
- **Union Contract** — dwell +2 ticks everywhere; capacity −20%.
- **Retail Compact** — amenity revenue doubled; flat point values halved.
- **Night Service** — 24 ticks instead of 20; quota ×1.15.
- **Concession Monopoly** — you may own only one of each amenity type; that type gets +2 levels free.

### 10.3 Bad actors

From week 8, a small share of spawns are **pickpockets** — rendered dark, they walk the board and steal 15% of the banked chain value from any traveller they pass adjacent to. They never board and never score. Security gates remove them. Information kiosks reduce their spawn rate.

They give the security gate a second reason to exist and make dense crowded corridors carry a risk.

### 10.4 Bonus cards

Consumables in the wildcard slot. Cost 1 AP to play.

| Card | Effect |
|---|---|
| **Rain Check** | Store one shop card for use in a later week |
| **Coupon Book** | Half fare income, double spawn batch, 2 weeks |
| **Charter Bus** | One-off: 40 extra $ travellers next week |
| **Rezoning Permit** | Unlock one locked edge back to greenfield |
| **Fast Pass** | All travellers +2 stop budget next week |
| **Grand Opening** | One amenity serves at 100% rate for one week |
| **Timetable Shuffle** | Reroll the arrival cadence of one transport tile |
| **Survey Crew** | Preview the event two weeks out |
| **Overtime** | +2 AP this week only |

---

## 11. Meta-progression

Persistent across runs, stored locally.

- **Tile unlocks.** The starting pool is roughly 12 tiles. Reaching milestone weeks and completing mode-specific goals unlocks the rest into the shop pool for future runs.
- **Mode unlocks.** Terminal is available from the start; the others unlock at week 8, 12, 16 clears.
- **Ordinance unlocks.** New ordinance cards enter the draw pool as they're earned.
- **Records.** Best week per mode, best single-traveller value, best single week score.
- **Daily seed.** A shared seed with a leaderboard, once there's an audience for it.

---

## 12. Interface

### 12.1 Screens

**Board view** is the whole game. Grid centre, shop rail along the bottom, run status along the top (week, quota, current score projection, money, AP), event preview pinned to the right.

### 12.2 Placement preview

The single most important UI element. While dragging a tile:

- Ghost the tetromino shape and highlight legal cells.
- Show **pull radius** as a translucent ring.
- Show the **terrain claim** the placement will cause — an animated edge highlight when a placement will lock an edge, with a confirm step. Locking an edge should never happen by accident.
- Show **estimated weekly value as a range**, not a number. Waypoints are random; a single number is a lie. "≈ 4,200–6,800 pts / 90–140 cash" reads honestly and teaches variance.
- For amenities, highlight existing tiles whose radius overlaps, so chains are visible before commitment.

### 12.3 Weekly summary

After playback:

- Score vs quota, money earned, breakdown by source.
- **Per-tile table: serves, balks, revenue, points contributed, saturation percentage.** This is where players learn the game. Without it, capacity and balking are invisible and every amenity feels random.
- **Path heatmap** toggle — where people actually walked. This is the main teaching tool for a system where a gourmet restaurant next to a bus stop is a gamble. A player who loses that bet needs to see the routes to understand why.
- Best single traveller of the week, with their full chain listed step by step.

### 12.4 Readability rules

- Full amenities grey out during playback with a small counter.
- Chain multipliers pop as small floating numbers over the traveller.
- Colour-blind safe tier palette, with glyphs as backup.
- Skip button always available; nothing about the game requires watching the sim.

---

## 13. Technical design

### 13.1 Build the headless simulator first

Before any rendering, build a **deterministic, seeded, headless tick simulator**: board layout in, per-traveller path and score out, as JSON. Balancing four timing numbers across 26 transport tiles is impossible through a game view. You need to run a hundred variations of a layout in a second.

Ship it with a CLI harness that runs a fixed layout across N seeds and reports mean, p10 and p90 score, plus per-tile saturation. That harness is how every number in §8 gets tuned.

### 13.2 Stack

- **TypeScript**, no framework requirement for the sim core — keep it a pure module with zero DOM dependencies so it can run in a worker, in Node for tests, and in the browser.
- **Rendering:** PixiJS. A few thousand circle sprites per week is well within a WebGL sprite batcher, and Canvas 2D will not hold up at week 25.
- **UI chrome:** React around the canvas, or plain DOM. The shop, summary and menus don't need the renderer.
- **State:** a plain reducer over an immutable run-state object. Every action produces a new state; this gives you undo during the shop phase and replay for free.
- **Persistence:** IndexedDB for meta-progression and run saves, with a JSON export.
- **Seeding:** a seeded PRNG (mulberry32 or PCG), one stream per subsystem — spawn, destination, service rolls, waypoints — so that changing one system's call count doesn't reshuffle every other system's rolls. This matters enormously for debugging.

### 13.3 Simulation architecture

Run the sim in a **web worker**, precomputed for the whole week before playback starts. The renderer replays a recorded event log. Benefits: playback speed can't affect the result, Skip is instant, replays and shareable seeds are trivial, and the main thread never stalls at week 30 with 2,000 agents.

Event log format is a flat array of `{tick, type, agentId, ...payload}` records. The renderer is a dumb consumer of it.

### 13.4 Performance targets

- 2,000 concurrent agents at 60fps in playback.
- Full headless week under 50ms.
- Pathfinding: precompute a flow field per destination tile per week rather than A* per agent. Destinations are few, agents are many. Waypoint offsets are applied on top of the flow field.

### 13.5 Data-driven content

Every tile, ordinance, event and card lives in a JSON file with a schema. No tile behaviour hardcoded in the sim except the handful of unique mechanics (gate, walkway, waiting area, loop terminal). This is what makes weekly balance passes cheap.

---

## 14. Open questions

1. **Subway layer interaction.** Do subway travellers surface into the main board's amenity network, or is the underground a second scoring space with its own amenities? The second is more content; the first is more coherent.
2. **Does the board really never expand?** Fixed-board plus exponential quota puts total weight on upgrade depth. If playtesting shows week-20 boards feel cramped rather than dense, a one-time paid expansion at week 12 is the pressure valve.
3. **Should terrain claims ever be reversible?** The Rezoning Permit card exists as an escape hatch. If it turns out to be a must-take every run, terrain locking is too punishing and should soften at the source.
4. **Capacity model.** Concurrent-with-duration is modelled here because congestion is wanted. If saturation proves illegible in playtest, fall back to a flat serves-per-week number on each tile.
5. **Endless scaling ceiling.** At some point upgrade levels cap and the board saturates. Either add levels 6–10 at steep cost, or accept a natural terminal week and score the run on how far past 16 it went.

---

## 15. Build order

**Milestone 1 — Simulator.** Headless tick sim, seeded RNG, flow-field pathing, service rolls, chain scoring, JSON board in / event log out. CLI harness with p10/p50/p90 reporting. No graphics.

**Milestone 2 — Playable core.** Pixi board render, event-log playback, drag-and-drop placement with legality and terrain-claim preview, 6 transports and 8 amenities, AP, money, quota, loss condition. Play weeks 1–10.

**Milestone 3 — Roguelite layer.** Full shop with typed slots and rerolls, upgrade tokens and levels, events on the 4-week cadence, ordinances, win screen at 16.

**Milestone 4 — Content and teaching.** Full tile catalogue, bonus cards, bad actors, security gate, subway layer, weekly summary with per-tile stats and path heatmap, placement value ranges.

**Milestone 5 — Meta and polish.** Unlocks, modes, records, daily seed, audio, save/resume, mobile layout.

Milestone 1 is where the game gets made or missed. Everything after it is presentation of numbers that either work or don't.
