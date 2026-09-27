# Grand Central Station — Design Document

**Title:** Grand Central Station (working title was *Transit Hub*)
**Platform:** Browser — desktop, tablet and touch
**Genre:** Turn-based tile-placement roguelite with a simulation scoring phase
**Session length:** 20–40 minutes to week 16; endless after that

This document describes the game **as built**. Every number here is taken from the code:
`src/config.js` and `src/data/*.js`. When the two disagree, the code is right and this file is out
of date. Where a number was changed during tuning, the original value and the reason are recorded
in §15, *Tuning history*.

---

## 1. Pitch

You run a transit hub. Every week you place a few tiles, then watch a crowd of travellers walk across the board. Each shop, kiosk and lounge they pass multiplies what they are worth. Hit the week's quota or the run ends. The quota keeps climbing, the board never grows, and the edges of the map lock down as you build — so the only way forward is to make each traveller worth more than the last.

The core tension: transport tiles bring people but score badly. Amenities score well but bring nobody. Board space runs out. Wealthy travellers are worth far more but arrive in ones and twos.

---

## 2. Core loop

One week = one turn.

1. **Shop phase.** Five cards are offered. Spend action points and money to buy, place, upgrade, delete or reroll.
2. **Simulation phase.** 24 ticks. Transport tiles spawn travellers, travellers walk to a destination, amenities they pass roll to serve them, each service multiplies their value. Value banks when they board.
3. **Settlement.** Score is compared against the week's quota. Fares and amenity revenue pay out as money. If the score is short, the run ends.
4. The quota rises. Next week.

The shape of a run:

- **Every 4th week is an event week**, with a quota multiplier and a rule twist (§9). The next event is shown; the one after it is hidden.
- **Difficulty** (Standard, Hard, Extreme) is picked with the mode and scales the quota, prices and income for the whole run (§10.1.1).
- **Ordinances** are offered at weeks 5, 12 and 20 (§10.2).
- **Milestones** change the run at set weeks (§10.5): pickpockets arrive at week 7, rare tiles at week 10, and Extra Shift appears in the shop at week 19.
- **Week 16** shows the win screen, and play can continue in endless mode, where the quota climbs faster every week (§5.2).

---

## 3. The board

### 3.1 Grid

| Mode | Grid |
|---|---|
| Terminal, Waterfront, Terminus | 12 × 12 |
| Junction | 9 × 9 |
| Sky Harbour | 8 × 16 |
| Metroplex | 16 × 16 |

The grid is fixed for the whole run; there is no board expansion. Growth comes from upgrades, chains and traveller tier, never from more space.

### 3.2 Edges and terrain

The four edges start as open ground: any transport type may claim them. Placing a transport claims terrain, and **the claim is permanent even if the tile is later deleted**. This is the run's main irreversible decision, and the placement preview warns before you commit (§12.2).

| Claim | Terrains | Behaviour |
|---|---|---|
| **Full lock** | Rail, water, apron | The whole edge becomes that terrain. More tiles of that terrain may be added along it; nothing else can attach there. |
| **Road** | Road | The edge becomes road, but road is generous. A road tile up to **4 cells inland** gets a driveway to the edge, as long as the straight path is clear. If it isn't, the tile can't go there. Road tiles stack along an edge without restriction. |
| **Corridor** | Tram, monorail, ski and alpine lifts | Reserves a straight lane from the tile to an edge, **along the tile's long axis**: a vertical lift reaches the north or south edge, a horizontal one east or west. The lane can't be built on, but travellers walk across it freely. Deleting the tile frees the lane. |
| **Free** | Helipad, balloon, jetpack, beam-em-up, loop terminal | No terrain relationship; goes anywhere with room. The escape valve for a player who locked all four edges early, and priced accordingly. |
| **Underground** | Subway, express subway, underground parking, submarine dock | The station sits on the ground like any tile, but its line runs on the **underground layer** (§3.5). It claims no edge. |

Some tiles also have attachment rules:

- **Reach** (Water Bus Stop, Pontoon Moorings, Prop Plane Stand, Hardstand): the road rule, for small craft. The tile may sit up to `reach` cells inland from an edge of its terrain, with a **jetty** or **taxiway** run out to it, exactly as a road tile runs a driveway. The run has to be a clear straight line, it becomes reserved ground, and it is torn up with the tile. If the edge is still open ground the run claims and locks it, the same as a berth on the shore would. A reach tile may also berth straight on the edge, with no run at all.
- **Edgewise** (Train Station, Express Train, Water Taxi, Cruise Ship Dock): the whole tile must lie flat along one edge. A long vehicle berths alongside the edge, never nose-in.
- **Tip** (Jetway, Jumbo Jetway): only the tip of the L (the top of its stem) may touch the apron edge, with the foot pointing inland. Both mirror images are legal.
- **Broadside** (Ferry Terminal): the mirror of tip. The L's long arm — its three-cell side — has to lie along the water edge, with the short foot pointing inland, so a hull ties up side-on. Two of the L4's eight orientations reach any one edge, both mirror images.

**Choosing the side.** A transport often has more than one way to attach: a road tile in reach of two edges, any berth in a corner, a garage with two road edges to tunnel to, a lift with a clear lane both ways along its axis. The check lists them (`res.sides`, best first) and takes the one the player asks for (`side`), or the first. The default is the nearest edge for a driveway, lane or tunnel, and for a berth an edge that is already its terrain before one it would have to claim. **⇄** in the card bar, or **E**, cycles through them the way **R** cycles rotations, and the choice carries over as the cursor moves, falling back to the default wherever it isn't open. A berth in a corner touches two edges but attaches by one: it claims and depends on that side only, and the other stays as it was, so a corner is no longer a way to lock two edges at once. Its attachment rule (edgewise, tip, broadside) is checked against the side it attaches by.

A Rezoning Permit card (§10.4) turns a claimed edge back into open ground, and **demolishes every transport attached to that edge**: lock-terrain tiles touching it, and road tiles whose driveway runs to it. Leaving a train station standing on open ground, or a bus stop with no road, is a state the rules can't hold. Each transport records the edges it depends on when placed (`tile.edges`).

### 3.3 Bridges

The Bridge/Overpass is an I3 tile laid along a claimed edge. It opens the edge spans beside it, so any transport terrain may attach there, and travellers can walk on it. It is implemented but **currently pulled from the shop** (`shop.slotWeights.bridge = 0`) because players found it confusing. If a run ever locks all four edges with no way out, the Rezoning Permit and Free-terrain transports are the relief valves.

### 3.4 Walkability

Travellers move one cell per tick in 8 directions, and may not cut diagonally past a corner.

- **Solid:** tiles are walls by default, and amenities only serve travellers who can actually reach their door.
- **Walk-through floor** (`walkable: true`): Parking Lot, Pontoon Moorings, Hardstand, Green Space, Pocket Park, Waiting Area, Frequent Flier Club, Chrono Lounge, WiFi Hotspot, Security Guard and the Security Checkpoint booth. Bridges, corridor lanes and driveways are walkable too. The first six of those, and the Moving Walkway, are *ground* tiles: paving with nothing standing on it, drawn flush with the floor (§13.2).
- **Moving Walkway:** travellers on it move 2 cells per tick.
- **Checkpoint fences** are the only walls that sit *between* cells rather than on them (§7.5).

A traveller picks a destination whether or not you left them a way to reach it. If the platform they chose can't be reached, they are **lost** (§4.3).

**Doors.** A tile's doors are the walkable cells touching it. A platform's travellers step out of the doors that *lead somewhere*: the ones that reach the most other platforms (and a shop), then the most floor. On an open board that is every door; a single cell walled in beside a platform is not one, so nobody spawns in it, and it never decides whether the platform's travellers are lost. Each traveller leaves by a door that reaches their own platform, so a platform whose doors open on to two halves of the board sends each traveller out the right side. A platform sealed in on every side keeps all its doors: its travellers still arrive, and are lost. A shop's door in such a pocket is not a way in either.

### 3.5 The underground layer

Underground transports dig a straight **tunnel** on a second layer beneath the board. The layer has one rule: **no two tunnels may share a cell.** A tunnel's cells include the footprint of its own station, so a line can't run under another station either. Ground tiles ignore the layer completely: anything can be built over a tunnel, travellers walk across it, and lanes and driveways cross it freely.

| Tile | Line |
|---|---|
| Subway Station (I2), Express Subway (I3) | Along the tile's long axis to **both ends of the board**. Neither end may surface into a water edge, and an edge where a subway surfaces can never afterwards be claimed as water. Two subways at right angles can never coexist; parallel ones can. |
| Underground Parking (L3) | Straight to the **nearest road edge** (or another the player picks, §3.2), however far. No driveway and no reach limit. It depends on that edge, so a Rezoning Permit there demolishes it. Only offered while some edge is road. |
| Submarine Dock (I2) | Straight to the **nearest water edge**; otherwise as the garage. Only offered while some edge is water. |

The shop only offers an underground tile while its tunnel has somewhere to go (`lineAvailable` in `src/sim/board.js`): a subway needs an axis clear of water, so it never appears in Waterfront, where both axes end in the sea.

The tunnel layer is drawn faintly under the ground. Aiming an underground tile, or hovering or selecting one, lifts the whole layer above the buildings with the pending line in the ghost's colour, so a crossing is visible even where a building covers it. Subway lines end in a portal on the edge strip.

---

## 4. Turn structure

### 4.1 Action points

**2 AP per week, for the whole run.** AP is the universal cost for everything in the shop phase:

| Action | AP | Money |
|---|---|---|
| Buy and place a tile | 1 | tile cost (§5.3) |
| Upgrade a tile | 1 | upgrade cost (§8.4) |
| Delete a tile | **0**, and a tile placed this week hands its point back | 0 — the terrain claim stays |
| Reroll the shop | 1 | free |
| Play a bonus card | 1 (a Rezoning Permit: 0) | card cost |
| **Run Week** with AP left | — | pays an **early-finish bonus** for each unspent AP |
| **Extra hours**, with no AP left, from week 4 | +1 | `$40 × 1.25^(week − 1)`, tripling with each one bought that week |

Undoing a placement costs the money already spent, never the week: deleting a tile and playing a Rezoning Permit take no action points (`economy.deleteCostsAP`, `rezoningCostsAP`), and pulling a tile bought *this* week gives its action point back (`economy.deleteRefundsAP`), so a tile that turned out to sit in everyone's way can be pulled and rebuilt on the same move. The refund is the week's own placement only — the tile records the week it was bought — because handing a point back for last week's tiles would be a free move rather than an undo. The money is the brake: nothing is refunded, so churning a spot costs its full price every time. A Rezoning Permit's demolitions give nothing back — the permit is its own play rather than an undo.

The early-finish bonus is `$10 + $5 × (week − 1)` per unspent point: $10 in week 1, $25 in week 4, $55 in week 10 and $85 in week 16 (`economy.earlyFinishBase`, `earlyFinishPerWeek`). It is paid the moment the week runs. It replaced the old *Wait* action, which paid interest on held cash and so rewarded hoarding.

**Extra hours** are the reverse of the early-finish bonus: once the week's points are spent, cash buys another (`economy.extraHours`). They go on sale in week 4 (`run.extraHoursFromWeek`), where the first costs $78, then $98 in week 5, $298 in week 10 and $1,137 in week 16; each more that week costs three times the last, and the count starts again next week. Week 1 is left out because the opening hand's change would buy a third tile, and the opening is tuned for two. The button takes Reroll's place in the tray, since Reroll has nothing to pay with once the points are gone. Terminus never sells them: one move a week is that level. They exist because cash had nothing to buy after the opening weeks (§15).

The other ways to get more AP:

| Source | Effect |
|---|---|
| **Overtime** card ($40) | +2 AP this week |
| **Temp Staff** card ($70) | +1 AP this week and each of the next two |
| **Extra Shift** card ($400, from week 19) | +1 AP permanently |
| **Staff Expansion** ordinance | +1 AP every week, but tiles cost 15% more |
| **Mode rules** | Junction gives 3 AP a week; Terminus gives 1 (§10.1) |

### 4.2 The shop

There are five slots (eight in Terminus), and **each slot rolls independently** against these weights, so a hand might be five tiles, or two tiles, two upgrades and a bonus card:

| Kind | Weight | Notes |
|---|---|---|
| Transport tile | 30 | |
| Amenity tile | 34 | |
| Tile upgrade | 16 | Bound to a tile type you already own (§8.4) |
| Bonus card | 10 | §10.4 |
| Category upgrade | 4 | Double Shift, Renovation, Concourse Extension |
| Rare tile | 4 | From week 10 |
| Extra Shift | 2 | From week 19 |
| Bridge | 0 | Pulled from the shop |

These rules shape every hand:

- **Week 1 deals named cards first.** `shop.week1.fixed` is dealt in order — a Parking Lot and a Burger Joint on most levels — and `transport` then `amenity` counts fill what is left, so a five-slot hand is those two plus three rolled transports and an eight-slot Terminus hand reaches the amenities as well. A level overrides the block field by field (§10.1): Waterfront swaps the Pontoon in for the Parking Lot, Sky Harbour deals three named cards and rolls one of each.
- **Nothing unplayable is offered.** Upgrade cards only appear for tile types on the board that still have a level to gain, and category upgrades only when something matches. Every shop contains at least one buildable tile, and no tile appears twice in one hand.
- **Costs track the week.** Tiles are weighted toward a target cost of `32 × 1.14^(week−1)` (a log-normal with σ 0.75), so late-game shops offer bigger tiles.
- **Rerolls** are free but cost 1 AP.

### 4.3 Simulation ticks

**24 ticks per week: 16 spawn ticks, then 8 to clear the board** (`sim.ticks`, `sim.spawnTicks`).

- **Ticks 1–16:** transports spawn travellers on their cadence.
- **Ticks 17–24:** no new spawns; travellers already on the board carry on.
- **Last call:** every transport fires one final departure on tick 24, so only travellers still walking are stranded.
- **Late platforms (weather, §9):** a transport whose timetable has slipped `late` ticks fires every departure that much later, its last call included, and its travellers' clock runs to tick 24 + `late`: the hurry rule, the strand check and the last call all read their own platform's deadline. The week runs to the latest deadline on the board; travellers bound for an on-time platform are settled at tick 24 as usual. With no weather every deadline is 24 and the week is exactly what it was.
- **Stranded** travellers bank their chain value **×0.5**, with no exit bonus and no fare.
- **Lost** travellers — those with no route to their chosen platform — wander for the rest of the week and bank **nothing**.
- **Travellers mind the clock** (§6.3): nobody takes a detour they can't get back from before the last call, so stranding is mostly late arrivals with a long walk, not shoppers who lost track of time.

Playback speed is ½×, 1×, 2× or Skip. The simulation is deterministic for a given seed, so playback speed never changes the result. Progress through the week is read off the top bar's line (§12.3), not a counter.

---

## 5. Economy

### 5.1 Two currencies

**Points** are the survival currency, compared against the quota. **Money** buys tiles and upgrades. They come from different sources on purpose.

- Points come from the chain — the multipliers a traveller collects.
- Money comes from **fares** (paid on boarding, small) and **amenity revenue** (paid per service, the real income), plus the early-finish bonus.

A player who builds an efficient transport-only hub scores acceptably and goes broke. A player who builds shops with nothing feeding them earns nothing at all.

### 5.2 Quota curve

A station's output grows fast while it is small and slowly once it is built out. A single per-week multiplier can't track that: it makes the first half free and the last few weeks a cliff. So the per-week growth rate itself *decays*:

```
growth(i) = late + (early − late) × decay^(i − 1)  [+ 0.015 × (i − 15) once i ≥ 16]
curve(week) = round(8000 × Π growth(i) for i = 1 … week−1  × eventMult × ordinanceMult × difficultyMult × modeMult, to 1000)
Quota(week)  = max(curve(week), catchUp)          // see below
early = 1.32, late = 1.10 (Junction: 1.06, Terminus: 1.145) + difficultyGrowthAdd, decay = 0.65
```

| Week | Quota | Week | Quota |
|---|---|---|---|
| 1 | 8,000 | 10 | 32,000 |
| 2 | 11,000 | 12 | 39,000 |
| 3 | 13,000 | 14 | 47,000 |
| 4 | 16,000 | 16 | 57,000 |
| 5 | 18,000 | 20 | 96,000 |
| 6 | 21,000 | 24 | 197,000 |
| 8 | 26,000 | | |

**After the win the curve bends upward** (`quota.endless`). Each week past 16 adds 0.015 more to the growth rate than the week before: week 17 grows 1.115×, week 20 1.16×, week 24 1.22×. Without it the settled 1.10 ran on forever, and a board that was full by week 16 kept pace for another ten weeks with nothing left to decide. Week 20 now asks 96k where it asked 84k, week 24 197k against 123k and week 28 493k against 180k, so every endless run meets a wall somewhere in its twenties, and how far it gets is the score. Weeks up to 16 are untouched.

The curve rises harder over the first four weeks and much more gently after that, because the score does: with the multipliers compressed (`sim.multScale`, §7.1) a board gains most while tiles are still going down and far less once it is full.

These are base quotas on Standard. Event weeks multiply them (§9, at 30% of the strength written in the data — `quota.eventStrength`), Night Service multiplies every week by 1.15, the difficulty scales the whole curve and steepens it (§10.1.1), and each mode scales it by its own `quotaMult` (§10.1).

Quotas are shown as **stars**, one per 1,000 points, and always round to a whole star. Earned stars round down, so 2,400 points is two stars.

**Week 1 counts like any other week.** Miss it and the run ends. It is a real target at the 8,000 base — the greedy bot clears it by about 1.5×, and a naive one (first legal cell, alternating transport and shop) misses it two weeks in three — so the opening hand is fixed (§4.2) to keep the first placement from turning on a shop roll.

**Catch-up.** A run far ahead of the curve is measured against its own form instead: the quota is at least `catchUp.share` (0.85) of the player's best week so far, capped at `catchUp.cap` (2.2) times that week's own curve, and never taking an event multiplier on top (the curve already carries one). It only ever raises a target, so a run behind the curve is never punished for being behind. The timeline marks a week whose target came from form rather than schedule. It is the one lever aimed squarely at the runaway board, and it is the cheapest: it costs a struggling run nothing.

The one event multiplier the floor *does* take is an `exact` one (§9), because that is arithmetic rather than a demand: a Double Week is two weeks, so a player's own form counts double that week too. Left out, the curve doubled while the floor stood still, which on a strong run — the only kind the floor binds on — meant nothing bound at all, and the week paid 1.7× what its neighbours did (§15).

Where the curve sits, measured (greedy bot, Terminal, 16 runs to week 16): week 1 lands at 1.48–1.55× quota, and 48–54% of all weeks inside 1–2× with a median of 1.8–2.0× and 3–6% of weeks above 3×. Event weeks are meant to spike out of the band; when refitting the curve, fit the quiet weeks and let `eventStrength` hold the event weeks passable.

### 5.3 Money details

| | |
|---|---|
| Starting cash | $220 (Junction $290, Metroplex $275 — see §10.1) |
| Fares on boarding | tier fare × 0.35: $0.70, $1.75, $4.20, $10.50, $26.25 |
| Amenity revenue | listed revenue × 0.35 per service (`economy.revenueScale`) |
| Tile price | `cost × (1 + 0.06 × tiles on board)`, then mode and ordinance multipliers |
| Upgrade price | 60, 140, 300, 650 for levels 2–5 |
| Delete refund | none (half with the Zoning Variance ordinance); deleting costs no AP |
| Early-finish bonus | $10 + $5 × (week − 1) per unspent AP |
| Extra hours | once AP is spent, one more AP for `$40 × 1.25^(week − 1)`, each more that week at 3× the last (§4.1) |
| Money events | Back Taxes, Use It or Lose It, Emergency Budget (§9) — the only rules that move cash without a tile changing hands |

A crowded board is an expensive board, which pushes late-game players toward upgrading over adding. Money limits a turn only in the opening weeks, and on Extreme for longer. After that, income outruns two actions a week — the greedy bot on Standard held about $18,000 unspent by week 15 — so extra hours (§4.1) are what the surplus is for, and every cash boost in the game buys moves through them.

---

## 6. Travellers

### 6.1 Tiers

| Tier | Symbol | Base value | Fare | Stop budget | Lounge stack cap | Colour |
|---|---|---|---|---|---|---|
| 1 | $ | 100 | 2 | 3 | 2 | cream |
| 2 | $$ | 180 | 5 | 4 | 3 | cyan |
| 3 | $$$ | 320 | 12 | 5 | 4 | violet |
| 4 | $$$$ | 600 | 30 | 6 | 5 | gold |
| 5 | $$$$$ | 1200 | 75 | 8 | 6 | rose |

A transport spawns its own tier 78% of the time, one tier down 12%, and one tier up 10%.

**Stop budget** is the number of amenity services a traveller will accept before walking straight to their destination. It caps chain length and stops the optimal board from being one long hallway lined with twenty shops. For $ travellers the 3-stop budget is a real limit: about half of them use all three stops. Higher tiers usually run out of *week* before they run out of stops (§14.2).

### 6.2 Destination selection

On arrival, a traveller picks a destination among all transports on the board, including the one they arrived on. Weighting is by tier distance:

| Tier gap (traveller − transport) | Weight |
|---|---|
| Same tier | 1.00 |
| One tier down (+1) | 0.70 |
| One tier up (−1) | 0.45 |
| Two tiers down (+2) | 0.35 |
| Two tiers up (−2) | 0.15 |
| Three or more either way | 0.05 |

The pick itself is a race, not a sweep down the list: each candidate rolls its own die, keyed by the traveller and by *that platform's tile*, and the smallest `-ln(u)/weight` wins. That draws from the weights above exactly, and it keeps the choice independent of how many other platforms are on the board — see §15 for what a cumulative sweep did instead.

**Adding one high-tier transport re-routes traffic across the whole board.** Every transport purchase is a strategic decision, not just a faucet. It pulls the travellers whose tier suits it; the ones it does not win keep the destination they had.

### 6.3 Pathing

1. Pick a destination (§6.2). If it can't be reached, the traveller is lost (§4.3).
2. Generate 2 waypoints scattered around the straight line toward it (Gaussian, σ 1.5 cells). A traveller whose destination is the tile they arrived on takes a wander instead (σ 2.5), so a lone bus stop still feeds nearby shops.
3. Walk the waypoint chain, one cell per tick, following a precomputed distance field for each target. Walkway cells are cheap to leave, so paths bend toward walkways.
4. Every cell travelled — including each cell ridden on a walkway — roll for service at every amenity whose radius covers the traveller (§6.4). On a hit, detour to the amenity, **step inside** for its service duration, spend one stop budget, then resume.
5. **Mind the clock.** A traveller only accepts a detour if the walk to the shop, the service and the walk from its door to their platform all fit before the last tick (`sim.hurry`); and once the rest of their wander no longer fits, they drop the remaining waypoints and head straight for the platform. Lost travellers, who have no platform to make, keep wandering.
6. At the platform, wait out the dwell time and the next departure, then board and bank.

Detours cost ticks and stop budget, which is what makes a dense cluster costly: every stop is time the traveller can't spend on a better one further along. Before travellers minded the clock they could also burn the week on cheap tiles and strand before boarding, which turned every extra shop into a coin flip on the whole chain (§15).

### 6.4 Service roll

```
P(service) = base_rate × tier_match × radius_falloff
```

- **`base_rate`:** per amenity, 0.36–0.81, plus +0.05 per level and any WiFi or event bonus.
- **`tier_match`:** 1.0 for the same tier, 0.6 one step apart, 0.25 two steps, 0.05 three or more. *Any-tier* rares always count as 1.0.
- **`radius_falloff`:** 1.0 when adjacent, dropping linearly to 0.4 at the radius edge.
- **Budget:** a traveller with no stop budget left doesn't roll at all.

The roll has these limits:

- **Once per week:** each amenity may serve a given traveller at most once. Lounges are the exception (§7.4).
- **One die per traveller and shop.** The roll is made once, and the pull *accumulates* cell by cell: at each cell in range the chance of having missed at every cell so far shrinks by `1 − P`, and the traveller stops at the first cell where it drops below their throw. Cell by cell that is the same odds as a fresh roll at each, but a traveller who is nudged one cell sideways keeps the decision they were going to make, and the throws of a transport's travellers are spread evenly (§13.1), so a shop's serves land near their expected count.
- **Reachability:** an amenity only rolls for travellers who can reach its door.
- **Walk-through amenities:** a Green Space rolls for travellers standing on it, as if they were beside it.

### 6.5 Capacity and balking

Every amenity has a **concurrent capacity** and a **service duration** in ticks. If it is full, the traveller **balks** and walks on; there are no queues.

This creates a tension between position and quality. First-come-first-served rewards amenities near spawn points, but multipliers pay best late in a chain. A cheap early tile that soaks up the first wave, with the real stack behind it, is a legitimate strategy.

Saturation is always visible: full tiles grey out during playback with an `occupied/capacity` counter, and the weekly summary reports serves and balks per tile.

---

## 7. Scoring

### 7.1 Order of operations

Each service applies **multiply first, then add**, in the order the traveller encounters them:

```
value = value × tile_multiplier + tile_flat
```

A tile's flat points get boosted by every multiplier downstream of it and none upstream — so **flat-add tiles want to be early in a route and multipliers want to be late.** The same three tiles score differently depending on walking order.

**Every multiplier is compressed by `sim.multScale` (0.60).** A chain multiplies, so a week's score is exponential in the number of stops a traveller makes: two boards a few tiles apart could finish a week 5× apart, and a run that chained well left the quota behind for good. `scaleMult` in `sim/sim.js` pulls each multiplier toward 1 by that fraction — `1 + (m − 1) × 0.60` — and every value multiplier in the game goes through it: amenity and transport `mult`, the upgrade bumps and WiFi's boost that are summed into them, the checkpoint, the lounge stack and the tier-match exit bonus. **The catalogue tables in §8 print the uncompressed numbers**, the ones in `src/data/tiles.js`; a Burger Joint's ×2.40 acts as ×1.84.

Flat values are not touched, which is the point. A one-stop chain keeps about 80% of what it was worth and a five-stop chain about half, so the difference between a good board and a lucky one shrinks while the difference between a good tile and a bad one does not: over the whole catalogue the tier list barely moved (§15). The knob is a single number precisely so that a rebalance is one measurement rather than 40.

### 7.2 Exit bonus

The transport a traveller boards applies its own `× mult + flat`. If the traveller's tier equals the transport's tier, a further **×1.5 tier-match bonus** applies (×1.30 after `multScale`).

### 7.3 Worked example

A $$ traveller (base 180) arrives by train, destined for the ferry. Multipliers are shown as the simulator applies them, after `multScale` 0.60; the catalogue number is in brackets.

| Step | Effect | Value |
|---|---|---|
| Spawn | — | 180 |
| Burger Joint ($, ×1.84 [2.40] +100) | 180 × 1.84 + 100 | 431 |
| Restroom ($, ×1.42 [1.70] +35) | 431 × 1.42 + 35 | 647 |
| Newsstand ($, ×1.31 [1.52] +60) | 647 × 1.31 + 60 | 908 |
| Ferry exit ($$, ×1.06 [1.10] +21) | 908 × 1.06 + 21 | 984 |
| Tier match ($$ = $$) | × 1.30 [1.5] | **1,279** |

Stop budget used: 3 of 4. Fare: $1.75. Amenity revenue: (6 + 0 + 3) × 0.35 = $3.15. The same walk scored 2,486 before the compression; a walk with one stop instead of three loses far less.

### 7.4 Waiting areas (lounges)

Lounges are the only tiles that may serve the same traveller more than once. A traveller waiting at a platform within a lounge's radius (3) gains **one stack per tick**, up to their tier's cap (§6.1). Stacks apply once, on boarding:

```
final_multiplier = 1 + stacks × stack_value
```

| Lounge | Stack value | Capacity | Who it serves |
|---|---|---|---|
| Waiting Area | 0.24 | 20 | everyone |
| Frequent Flier Club | 0.38 | 10 | $$$ and up |
| Chrono Lounge (rare) | 0.43 | 6 | everyone |

Stack value is scaled by `multScale` like every other multiplier, so a Waiting Area adds 0.144 a stack as built.

**A lounge slot is held for the whole dwell**, from arrival at the platform to departure. A lounge beside a slow jetway serves far fewer travellers than one beside a shuttle — that is the placement decision. Lounges are walk-through floor, and WiFi adds +0.04 per stack.

### 7.5 Security Checkpoint

The checkpoint is a two-cell booth. **Its fence runs from one board edge to the other** along the grid line between the booth's two cells. The fence sits *between* cells, so it costs no floor space, and cells on either side stay buildable. Rotating the booth turns the fence.

- **The fence stops only where a building stands across it.** From the booth it runs along the line until one tile fills the cells on both sides of it — the line would cut through the middle of that tile, the way it cuts a 2×2 in half (`sim.checkpoint.fence: 'split'`). A building the line only runs alongside does not stop it, and nor do two that meet along it; the fence carries on past them, with no panel where both sides are already built, since nothing can step across there anyway. So a fence shortens when you build *across* the line, not when you build beside it. `'walls'` stops at the first solid tile beside the line, `'edge'` runs it wall to wall regardless, and a number runs it that many cells each way.
- **The booth is the only way across.** Anyone may walk through it to reach whatever is on the far side; diagonal steps past the ends of the booth are blocked.
- **Clearing the booth is a chain link, applied when they board:** ×1.5 (+0.1 per level) on top of the finished chain, ×1.30 after `multScale`, plus +2 stop budget on the spot, once per traveller (`atExit`). A multiplier at the crossing was worth almost nothing, because a traveller crosses early with a chain of 100–200 points and shops downstream multiply that instead.
- **It catches pickpockets** who walk through it.
- **Booths on the same line share one fence**, and each adds a lane.

The fence is a commitment, and more of one since it stopped shortening against a building's flank: on the bot boards it loses points in 11–46% of spots, against 1–12% under the old rule, and a rotation swings the value by 2–11★ against 2–3★ (§15). That is the price of a fence that means something; the booth's ×1.5 is what pays for it. The placement preview draws the whole fence line and shows the star value before you commit. See §15 for the options that were tried.

The old rule — only travellers whose platform is on the far side may cross, splitting the board into two shopping zones — is still available as `sim.checkpoint.filter: true`.

---

## 8. Tile catalogue

These are the current values. They are tuned with the harness (§14) and change often, so treat `src/data/tiles.js` as the source of truth. **Multipliers are printed as the catalogue writes them**; the simulator compresses each one toward 1 by `sim.multScale` before using it (§7.1), so a ×2.40 shop acts as ×1.84.

### 8.1 Transport tiles

Four timing numbers define every transport: **arrival cadence** (ticks between batches), **batch size**, **departure cadence** and **dwell** (ticks a departing traveller waits). These are what make a parking lot feel different from a jetway.

| Tile | Shape | Terrain | Tier | Arr. | Batch | Dep. | Dwell | Mult | Flat | Cost | From week |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bus Stop | I2 | road | $ | 4 | 5 | 4 | 1 | 1.04 | 12 | 60 | 1 |
| Parking Lotᵂ | O4 | road | $ | 1 | 2 | 1 | 0 | 1.02 | 30 | 50 | 1 |
| Bike Rental | I2 | road | $ | 2 | 2 | 2 | 0 | 1.04 | 8 | 40 | 1 |
| Taxi Stand | I2 | road | $$ | 2 | 2 | 2 | 0 | 1.07 | 9 | 90 | 1 |
| Rideshare Zone | L3 | road | $$ | 1 | 2 | 1 | 0 | 1.05 | 11 | 80 | 1 |
| Car Rental | O4 | road | $$ | 3 | 2 | 3 | 2 | 1.07 | 18 | 140 | 2 |
| Limo Service | I3 | road | $$$$ | 5 | 2 | 5 | 1 | 1.21 | 12 | 240 | 4 |
| Tram Stop | I3 | corridor | $$ | 4 | 4 | 4 | 1 | 1.09 | 15 | 130 | 2 |
| Train Station | I4 | rail, edgewise | $$ | 6 | 6 | 6 | 2 | 1.10 | 18 | 180 | 2 |
| Express Train | I5 | rail, edgewise | $$$ | 8 | 9 | 8 | 3 | 1.16 | 24 | 320 | 5 |
| Monorail | I4 | corridor | $$$ | 5 | 5 | 5 | 2 | 1.14 | 21 | 280 | 5 |
| Ferry Terminal | L4 | water, broadside | $$ | 8 | 8 | 8 | 3 | 1.10 | 21 | 200 | 2 |
| Water Taxi | I2 | water, edgewise | $$$ | 3 | 2 | 3 | 1 | 1.14 | 11 | 150 | 3 |
| Water Bus Stop ᴬ | I2 | water, reach 3 | $ | 4 | 5 | 4 | 1 | 1.04 | 12 | 60 | 1 |
| Pontoon Moorings ᵂᴬ | O4 | water, reach 2 | $ | 1 | 2 | 1 | 0 | 1.02 | 30 | 50 | 1 |
| Marina | S4 | water | $$$$ | 8 | 2 | 8 | 4 | 1.23 | 18 | 350 | 6 |
| Cruise Ship Dock | I6 | water, edgewise | $$$ | 16 | 28 | 16 | 6 | 1.18 | 45 | 520 | 7 |
| Helipad | O4 | free | $$$$ | 6 | 2 | 6 | 2 | 1.24 | 15 | 380 | 5 |
| Hot Air Balloon | T4 | free | $$$ | 10 | 2 | 10 | 5 | 1.19 | 18 | 260 | 4 |
| Jetway | L3 | apron, tip | $$$ | 8 | 11 | 8 | 4 | 1.18 | 27 | 400 | 6 |
| Jumbo Jetway | L5 | apron, tip | $$$ | 12 | 21 | 12 | 6 | 1.21 | 42 | 680 | 9 |
| Prop Plane Stand ᴬ | I2 | apron, reach 3 | $ | 4 | 5 | 4 | 1 | 1.04 | 12 | 60 | 1 |
| Hardstand ᵂᴬ | O4 | apron, reach 2 | $ | 1 | 2 | 1 | 0 | 1.02 | 30 | 50 | 1 |
| Ski Lift | I4 | corridor | $$ | 3 | 2 | 3 | 1 | 1.09 | 12 | 120 | 2 |
| Alpine Lift | I5 | corridor | $$$ | 4 | 3 | 4 | 2 | 1.14 | 17 | 220 | 5 |
| Jetpack Rental | I2 | free | $$$$ | 2 | 2 | 2 | 0 | 1.19 | 9 | 290 | 6 |
| Private Terminal *(rare)* | T4 | apron | $$$$$ | 10 | 2 | 10 | 4 | 1.35 | 24 | 760 | 10 |
| Beam-Em-Up Pad *(rare)* | O4 | free | $$$$$ | 3 | 2 | 3 | 0 | 1.39 | 18 | 840 | 10 |
| Loop Terminal *(rare)* | O4 | free | $$$ | 4 | 3 | 4 | 1 | 1.16 | 18 | 600 | 12 |
| Subway Station | I2 | underground, through | $$ | 3 | 4 | 3 | 1 | 1.08 | 14 | 150 | 3 |
| Express Subway | I3 | underground, through | $$$ | 5 | 6 | 5 | 2 | 1.15 | 22 | 330 | 6 |
| Underground Parking | L3 | underground, to road | $ | 1 | 2 | 1 | 0 | 1.02 | 30 | 110 | 3 |
| Submarine Dock | I2 | underground, to water | $$$$ | 6 | 2 | 6 | 2 | 1.22 | 16 | 320 | 5 |

ᵂ = walk-through floor: the Parking Lot is a car park, so travellers cross it rather than walk round it. ᴬ = sold on one level only (§10.1).

**The four low-tier water and air tiles are the Bus Stop and the Parking Lot in other clothes**, and they carry those tiles' numbers to the digit. They exist because Waterfront and Sky Harbour had nothing cheap of their own: the water catalogue started at a $200 Ferry Terminal and the airfield at a $400 Jetway, so both levels opened by building the road they were not about. Each is sold on its own level and nowhere else, from week 1, and each reaches inland on a jetty or taxiway rather than needing the shore itself (§3.2). Hardstand and Pontoon Moorings are walk-through, like the car park they copy.

Air tiles (helipad, balloon, jetways, private terminal, jetpack) are tagged `air`: they go offline in a Weather Front and run late in Fog. Underground tiles run their line on the tunnel layer (§3.5); Underground Parking has the Parking Lot's timing and pays for its freedom of placement. **Loop Terminal:** 30% of its departures during the spawn ticks re-enter as a new arrival with their chain value intact.

### 8.2 Amenity tiles

ᵂ = walk-through floor.

| Tile | Shape | Tier | Radius | Rate | Mult | Flat | Cap | Dur | Revenue | Cost | From week |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Vending Machine | I1 | $ | 2 | 0.72 | 1.28 | 30 | 4 | 1 | 1 | 11 | 1 |
| Newsstand | I2 | $ | 3 | 0.63 | 1.52 | 60 | 8 | 1 | 3 | 21 | 1 |
| Restroom | O4 | $ | 3 | 0.81 | 1.70 | 35 | 12 | 2 | 0 | 25 | 1 |
| Food Stand | I2 | $ | 3 | 0.63 | 1.70 | 70 | 10 | 2 | 4 | 28 | 1 |
| Burger Joint | L3 | $ | 3 | 0.54 | 2.40 | 100 | 20 | 3 | 6 | 42 | 1 |
| Information Kiosk | I1 | $ | 4 | 0.54 | 1.35 | 40 | 10 | 1 | 1 | 14 | 1 |
| Pocket Park ᵂ | I1 | $ | 3 | 0.45 | 1.62 | 32 | 14 | 1 | 0 | 15 | 2 |
| Coffee Cart | I1 | $$ | 4 | 0.63 | 1.72 | 44 | 7 | 1 | 4 | 24 | 2 |
| Souvenir Cart | I1 | $$ | 3 | 0.50 | 2.30 | 75 | 6 | 2 | 8 | 32 | 3 |
| Cash Machine | I1 | $$$ | 3 | 0.45 | 2.20 | 55 | 4 | 1 | 13 | 34 | 4 |
| Pizza Place | S4 | $$ | 3 | 0.54 | 2.57 | 110 | 18 | 3 | 8 | 53 | 2 |
| Coffee Shop | I2 | $$ | 4 | 0.72 | 2.23 | 80 | 14 | 2 | 7 | 46 | 2 |
| Green Space ᵂ | O4 | $ | 4 | 0.45 | 1.88 | 44 | 30 | 2 | 0 | 31 | 2 |
| Sports Bar | T4 | $$ | 3 | 0.50 | 2.93 | 140 | 16 | 4 | 12 | 77 | 4 |
| Currency Exchange | I2 | $$$ | 3 | 0.45 | 2.75 | 88 | 6 | 2 | 15 | 67 | 4 |
| Clothing Store | S4 | $$ | 3 | 0.45 | 2.75 | 120 | 12 | 3 | 14 | 74 | 4 |
| Cafeteria | I6 | $ | 4 | 0.81 | 1.63 | 60 | 45 | 2 | 5 | 91 | 5 |
| Art Gallery | T4 | $$$ | 4 | 0.40 | 3.45 | 160 | 10 | 4 | 18 | 115 | 6 |
| Travel Lounge | S5 | $$$ | 3 | 0.54 | 3.27 | 120 | 14 | 3 | 20 | 133 | 7 |
| Designer Shop | L4 | $$$$ | 3 | 0.36 | 4.15 | 180 | 8 | 4 | 35 | 168 | 8 |
| Drone Vending Swarm *(rare)* | I2 | any | 7 | 0.54 | 2.05 | 80 | 6 | 1 | 6 | 182 | 12 |
| Nanofab Boutique *(rare)* | L3 | any | 3 | 0.50 | 3.63 | 140 | 5 | 3 | 22 | 224 | 12 |

Tags: `food` (vending, food stand, burger, pizza, coffee cart, coffee, sports bar, cafeteria) and `green` (green space, pocket park) matter for the Festival event.

**Green Space** costs no stop budget and **restores** one, making it a net +1 chain extender. It is walk-through, so it never blocks a route. **Pocket Park** is the same rule on one square: less pull, less bonus, and it fits where the O4 cannot.

**The one-square shops** — Pocket Park, Coffee Cart, Souvenir Cart, Cash Machine — are the answer to a cramped board. Each pays clearly less per tile than its full-size counterpart and slightly less per dollar, so on a roomy board the big version is still the better buy and on a 9x9 or an 8x8 half the cart wins on the only currency that is short there, which is floor (§15). The Cash Machine is the exception that proves the rule: it grades near the bottom on points and near the top on revenue per dollar, and is bought for the till.

### 8.3 Utility tiles

These have no service roll of their own.

| Tile | Shape | Radius | Cost | From week | Effect |
|---|---|---|---|---|---|
| WiFi Hotspot ᵂ | I1 | 4 | 39 | 3 | Boosts every tile in range: shops +5% pull and +0.12 chain multiplier, lounges +0.04 per stack, transports +0.04 exit multiplier. Up to two hotspots stack on one tile; each level adds 50% strength. |
| Waiting Area ᵂ | O4 | 3 | 49 | 2 | Lounge — §7.4 |
| Moving Walkway | I4 | — | 35 | 3 | Riders move 2 cells/tick and still roll for every shop they pass, so it routes a crowd past a retail strip at double speed. |
| Security Station | L3 | 3 | 70 | 7 | Removes any pickpocket entering its radius. |
| Security Guard ᵂ | I1 | 2 | 32 | 7 | A one-cell Station with a smaller radius. |
| Security Checkpoint ᵂ | I2 | — | 90 | 6 | Edge-to-edge fence with a booth — §7.5 |
| Frequent Flier Club ᵂ | O6 | 3 | 210 | 9 | Lounge for $$$ and up; revenue 25 per guest — §7.4 |
| Chrono Lounge ᵂ *(rare)* | O4 | 3 | 196 | 12 | Lounge with stack 0.43 and capacity 6; revenue 10 per guest |

### 8.4 Upgrades

Tiles have levels 1–5. Per level:

- **Amenity:** +0.26 multiplier, +25% capacity, +20% revenue, +0.05 base rate.
- **Transport:** +15% batch size, +0.03 exit multiplier.
- **Checkpoint:** +0.1 to its clearing multiplier.
- **WiFi:** +50% strength.

Upgrade cost per level is **60, 140, 300, 650**, and 1 AP.

Upgrade level is the exponential axis of the game. Because the board is fixed and capacity flattens raw throughput, a saturated board's only remaining growth is depth.

**Tile upgrades are bound to a tile type** you already own, and each has its own name. Shop cards lead with the tile name and put the upgrade name underneath. A multi-level card costs what those levels would cost one at a time.

| Tile | Upgrade | | Tile | Upgrade |
|---|---|---|---|---|
| Coffee Shop | Espresso Bar (+2 levels, +1 radius) | | Security Station | Extra Patrol (+1 radius) |
| Security Guard | Radio Kit (+1 radius) | | Security Checkpoint | Fast Track Lane |
| Bus Stop | Shelter & Timetable | | Train Station | Platform Extension |
| Ferry Terminal | Deeper Dock | | Tram Stop | Second Car |
| Monorail | Third Car | | Express Train | Double-Decker Carriages |
| Jetway | Wide-Body Bridge | | Newsstand | Corner Franchise |
| Restroom | Attendant Service | | Food Stand | Second Cart |
| Burger Joint | Drive-Thru Window | | Pizza Place | Stone Oven |
| Vending Machine | Restock Contract | | Information Kiosk | Concierge Desk |
| Green Space | Landscaping Budget | | Sports Bar | Big Screen |
| Cafeteria | Extra Serving Line | | Currency Exchange | Better Rates |
| Clothing Store | Flagship Remodel | | Art Gallery | Touring Exhibition |
| Travel Lounge | Members Wing | | Designer Shop | Private Fitting Rooms |
| Waiting Area | More Seating | | Frequent Flier Club | Club Expansion |
| WiFi Hotspot | Signal Booster | | Moving Walkway | Belt Overhaul |

Any tile without an entry gets a generated `<Tile> Refit`.

**Category upgrades** are premium wildcard cards:

| Card | Cost | From week | Effect |
|---|---|---|---|
| Concourse Extension | 150 | 6 | Every lounge you own gains one level |
| Double Shift | 220 | 6 | Any transport +2 levels |
| Renovation | 240 | 8 | Any service amenity +2 levels |

---

## 9. Events

Every 4th week. The player sees the **next** event as soon as the current one resolves, but never the one after it (Survey Crew reveals it). Events are drawn from shuffled cycles of the full list.

| Event | Quota | Rule |
|---|---|---|
| Convention | ×1.6 | All transports spawn +60% batch; 80% of high-tier spawns become $ or $$ |
| Delays | ×0.85 | Half batch; dwell doubled |
| VIP Delegation | ×1.3 | Six $$$$$ travellers arrive on tick 1 with +4 stop budget |
| Holiday Rush | ×1.8 | Spawn and departure cadence halved |
| Weather Front | ×0.9 | Water and air transports offline |
| Strike | ×0.9 | One transport terrain produces nothing. **The union picks it, not the player** — a roll keyed by seed and week over the terrains on the board, frozen as the week opens. If it is the board's only terrain, it runs a skeleton service at 25% batch instead. |
| Inspection | ×0.9 | Amenities below level 2 run at 70% pull and chain bonus |
| Festival | ×1.5 | Food and green amenities +0.20 base rate |
| Charter Season | ×1.7 | Travellers pick destinations as if one tier higher |
| Crime Spree | ×0.9 | Pickpockets at 10% of spawns, double the crime wave's settled rate. Week 7 on only (see the gate below). |
| Back Taxes | ×0.9 | 45% of the cash in hand (at least $80) is taken as the week opens, before the shop can be touched |
| Use It or Lose It | ×0.9 | Whatever cash is left when you run the week is swept up, the early-finish payment with it. The week's own takings are safe. |
| Emergency Budget | ×1.0 | The till is set to a starting allowance for the week: $220 × 1.22^(week−1). A hoard is cut to it; a broke run is topped up to it. |
| Double Week | ×2 | The same board runs two full weeks back to back and the two scores add. +1 AP to prepare. |
| Fog | ×1.0 | Air and water transports run 4 ticks late; their batch ×0.6 |
| Snowstorm | ×0.9 | Everything above ground runs 3 ticks late; batch ×0.6. The underground runs to time. |
| Heavy Rain | ×0.9 | Road transports run 3 ticks late; batch ×0.6 |
| Thunderstorm | ×1.3 (×1.09 softened) | Everything above ground runs 6 ticks late; batch ×0.6 |

**Weather** (`weather` in the sim mods: `{ on, late, batch }`, where `on` lists terrains, tags or `surface` for everything not underground). A front keeps the service running but slips its whole timetable `late` ticks: every departure, and the last call, and so the clock its travellers read (§4.3). Those travellers linger in the concourse, shop longer and stack longer on a lounge, and can still be stranded if they wander too far. The linger is worth more than it costs: with no crowd cut, a Snowstorm scores 1.19–1.30× a quiet week on the bot's boards. So each front thins the crowd as well, and the batch cut is what makes it a hard week. `batch` rounds, so ×0.6 halves the cheap two-at-a-time transports and trims the big ones; ×0.8 rounds back to two and was measured as no cut at all.

An event's real difficulty is its quota multiplier divided by how much it cuts the board's score; all of them should land between about 0.9× and 1.6× as hard as a normal week. Events double as tutorial pressure: Weather Front punishes a player who put everything on water, Inspection punishes one who never upgraded, and a Crime Spree punishes one who skipped the security tiles.

**Three fields outside `mods`.** Most events are a bag of simulator modifiers, but four of the ones above reach past it, and each field is read by the run layer rather than the simulator:

- **`cash`** — the money weeks. They take nothing off the board, so a plain week's score is what they earn; the bill is what the *following* weeks have to be built around, which is why their quota sits at or below a normal week's. A fine and an allowance land as the week opens, before the snapshot, so taking the week back does not undo them; the sweep waits until the week runs.
- **`ap`** — extra action points for that week alone, folded into `apForRun`.
- **`after`** — names a `CONFIG.run` field; the event is skipped until that week and the next event in the plan takes its place, so the pick stays a function of the week alone. Crime Spree waits on `pickpocketsFromWeek` because the Security Station and Guard go on sale in the same week: before that there is no answer to it on any shop roll.
- **`repeat`** — how many weeks run back to back (`simulateWeeks`). Two separate simulations of the same board, stitched end to end: the concourse empties between them and nobody carries over. **Not** one week of twice the length — the clock, not the stop budget, is what caps most chains, so a 48-tick week scores three to four times a normal one on a busy board and barely twice on a bare one (§15).
- **`exact`** — opts the event out of `quota.eventStrength`. A Double Week's ×2 is the arithmetic of two weeks, not a demand for a harder one; softened toward 1 it would read ×1.30 against a score that doubles, which is a free week. An `exact` multiplier is also the one the catch-up floor takes (§5.2).

**`quota.eventStrength` (0.30) only softens the events that ask for more.** A Convention's ×1.6 has to be read against the headroom a normal week leaves, so it is pulled toward 1 and lands at ×1.18; the discounts below 1 are applied exactly as written, because a Strike's ×0.9 is not a demand, it is an apology for a week that takes half the board's traffic away. Softening both directions with one number quietly withdrew that apology, and the disruptive events became the two weeks that ended most runs (§15).

---

## 10. Run structure

### 10.1 Modes

A mode sets the board, one standing rule, and its own run clock. It is chosen before the run and unlocked by your **best week reached in any mode**. Difficulty (§10.1.1) is a separate choice made at the same time; any mode can be played at any difficulty.

| Mode | Grid | Unlock | Levers (`src/data/modes.js`) |
|---|---|---|---|
| **Terminal** | 12×12 | — | Baseline |
| **Junction** | 9×9 | week 8 | `startAP: 3` — 3 AP every week instead of 2, so `quotaMult: 1.30` and `quotaGrowth: 1.06` on the whole curve: it builds twice the board of a one-action level, then runs out of squares to build it on, so its target starts higher and climbs slower than anywhere else. `startMoney: 290`, because three action points in week 1 need three tiles' worth of cash. Early milestones: ordinances at 4/9/15, crime wave week 5, rares week 8, Extra Shift week 12. Tunnels early (Subway 2, Garage 2, Express Subway 4, Limo 3), since they cost no floor. |
| **Metroplex** | 16×16 | week 12 | `costMult: 1.25` — tile prices +25% (upgrades, cards and bridges are unaffected), with `startMoney: 275` to match, so the opening hand buys the same two tiles it buys everywhere else. A slow clock: an event every 5th week, ordinances at 6/13/20, crime wave week 9, rares week 12, Extra Shift week 16. The six-cell tiles early, since the board has room (Express Train 3, Cafeteria 3, Cruise Dock 5, Jumbo Jetway 6, Flier Club 7). |
| **Waterfront** | 12×12 | week 8 | `preLock: W, S water` — two edges start locked to water. `terrainCostMult: water 0.6` — water transports −40%. Boats early: Water Bus, Pontoon, Ferry and Water Taxi from week 1, Sub Dock 3, Marina 4, Cruise Dock 5. The Water Bus Stop and the Pontoon Moorings are sold here and nowhere else, and the opening hand deals a Pontoon in place of the Parking Lot. |
| **Sky Harbour** | 8×16 | week 12 | `banTerrains: rail, water` — removed from the shop and rejected on placement. `terrainCostMult: free 0.7` — Free-terrain transports −30%. `preLock: N apron, S road` and a Security Checkpoint already built at (3,7)–(3,8): a long board with the airfield at one end, the road at the other and a fence across the waist, cutting it into an 8×8 airside and an 8×8 landside. Light aircraft from week 1 (Prop Plane Stand and Hardstand, sold here and nowhere else), the rest early (Jetway 2, Balloon 2, Helipad 3, Jetpack 4, Jumbo Jetway 6, Private Terminal 8), security early (Station and Guard 3), crime wave week 3 over a 6-week ramp, `quotaMult: 1.05`. The opening hand deals a Prop Plane Stand and a Parking Lot, one for each side of the fence. |
| **Terminus** | 12×12 | week 16 | `fixedAP: 1` — one AP a week (cards and ordinances still add), so `quotaMult: 0.46` with `quotaGrowth: 1.145`, since a one-action board catches up as it fills. `shopSlots: 8`. One move a week, so the clock is slow (event every 5th week, ordinances at 4/10/18) and the things that buy more moves come early and cheap: rares week 8, Extra Shift week 8 at $320 instead of week 19 at $400. It never sells extra hours (§4.1). |

**A level re-times the run for itself.** Five data fields in `src/data/modes.js`, all optional, all read through the game layer so the simulator never learns that modes exist:

| Field | What it does |
|---|---|
| `quotaMult` | Scales this level's whole quota curve. A level's target has to match what it can build in a week, and action points are most of that: measured over 40 seeds at a flat target, week 1 landed at 4.2× quota on three-action Junction and 1.3× on one-action Terminus. Junction carries 1.30, Terminus 0.46 and Sky Harbour 1.05 (its booth got better, §15); the rest are 1. It scales the whole curve, so a level whose score pulls away at a different rate needs `quotaGrowth` with it — Junction does, at 1.06, because a 9×9 board fills by about week 6 and stops growing (§15). |
| `minWeek: { key: week }` | The week a tile goes on sale here, replacing the catalogue's own `minWeek` (`minWeekOf` in `data/modes.js`). Any key in `data/tiles.js`, earlier or later. |
| `run: { ... }` | Overrides any field of `CONFIG.run`: `startMoney`, `eventEvery`, `ordinanceWeeks`, `winWeek`, and the weeks the specials switch on — `pickpocketsFromWeek`, `pickpocketRamp`, `rareTilesFromWeek`, `apUpgradeFromWeek` (and `apUpgradeCost`). Whatever is left out keeps the value in `src/config.js`. `runRules(s)` in `game/run.js` is the merged view; every caller reads that rather than `CONFIG.run`. **Opening cash goes with action points and with prices**: a level that plays three tiles in week 1 has to be able to buy three, and one whose tiles cost 25% more needs 25% more to buy the same hand. Junction carries $290 and Metroplex $275 against the $220 baseline. |
| `startTiles: [{ key, x, y, rot, level }]` | Tiles the level is already built with in week 1. `startBoard(mode)` in `sim/board.js` places them through the normal rules, so an illegal one throws at run start; the game layer and the harness both build their opening board with it. |
| `week1: { fixed, transport, amenity }` | The opening hand, overriding `CONFIG.shop.week1` field by field, so a level can deal the transport its own terrain needs rather than the road one. Waterfront swaps the Parking Lot for a Pontoon; Sky Harbour deals both, one either side of its fence. |

**A tile can belong to one level.** `modes: ['waterfront']` in `data/tiles.js` takes the tile out of every other level's shop (`soldOnLevel` in `data/modes.js`, read by both tile pools). It is how Waterfront and Sky Harbour get cheap starter transport without handing a Terminal run a $36 water bus it has no water for.

The crime-wave week is the one of these the simulator has to know, so `computeMods` sends it as a modifier (`pickpocketsFromWeek`) exactly like an event's — which also keeps it in the preview's cache key.

Some quirks in how the levers interact:

- **Junction and Terminus shifted with flat AP.** Now that AP is 2 all run, Junction's 3 AP is a permanent 50% advantage; under the old ramp it lasted only until week 6. Likewise, Terminus is 1 AP against 2 rather than against the old 2–5.
- **Waterfront's edges can be rezoned.** Its pre-locked edges count as claimed, so a Rezoning Permit can turn them back into open ground. So can Sky Harbour's, and its starting Checkpoint can be deleted like any other tile — the fence is a level, not a law.
- **Sky Harbour's fence spans the board** at week 1: with nothing built, the panels run to both edges, so the booth at (3,7)–(3,8) is the only way from the apron side to the road side. It stays that way as the board fills, because only a tile built *across* the line at y=8 shortens it (§7.5) — building along either side of the waist no longer opens a way round. The split is the level's shape all run unless the player deliberately breaks it.
- **Sky Harbour's crime wave lands in week 3** instead of week 5, over six weeks instead of three. The level is about the checkpoint, so the thieves it catches should be there while you are still deciding where to put your security; a three-week ramp that early put full-strength pickpockets on a five-tile board.
- **Waterfront never offers a subway:** with the west and south edges under water, neither axis has two dry ends. Submarine Docks are on offer from week 3.
- **Sky Harbour's weather.** Weather Front grounds everything that arrives by air or water, which on this level is most of the board. It is the one event that can take a Sky Harbour run apart, and its ×0.9 quota is the only discount for it.

Greedy-bot results, 16 runs to week 16 (`--runs 8` over `--seed0 1000` and `2000`), before and after the levels got their own clocks. **These were measured against the old 5,400 curve**, before the quota rebalance in §15; they say what each level's own levers did, not where the levels sit now:

| Mode | Survived before | Survived after | Week-16 score/quota after | Pattern |
|---|---|---|---|---|
| Terminal | 14 / 16 | 14 / 16 | 1.9–2.8× | The baseline; it overrides nothing, so it did not move |
| Junction | 12 / 16 | 14 / 16 | 3.4×, 4.8× | Was front-loaded and then brutal (four deaths in weeks 12–16); the earlier tunnels, rares and Extra Shift outweigh the extra event weeks |
| Metroplex | 11 / 16 | 10 / 16 | 3.3×, 2.0× | Unmoved inside the noise; the six-cell tiles early pay for the slower milestones |
| Waterfront | 12 / 16 | 14 / 16 | 4.2×, 2.6× | Boats from week 1 are worth about two runs |
| Sky Harbour | 14 / 16 | 15 / 16 | 2.7×, 3.2× | The checkpoint is free and most travellers cross it, which offsets the airfield eating a whole edge |
| Terminus | 10 / 16 | 12 / 16 | 2.9×, 3.9× | Cheap early overtime helps the mid-game; the week-1 cliff is untouched, because that is the opening hand, not the clock |

The bot is greedy and one-step, so treat these as shape, not as final difficulty. The levels ended up a little easier on average (59 of 80 runs before, 65 after), which was the intended trade: each one now hands you the tiles it is named after instead of making you wait out the Terminal schedule for them.

Every level, 12 runs to week 16 on Standard, `--seed0 1000` (`harness/autoplay.js` prints all of this; the figures before the arrows are the same measurement on the build before the multipliers were compressed, §15):

| Mode | Weeks inside 1–2× | Weeks above 3× | Median week | Survived |
|---|---|---|---|---|
| Terminal | 37% → **55%** | 31% → **2%** | 2.36× → **1.80×** | 8 → **6** / 12 |
| Junction | 38% → **41%** | — → **16%** | 2.09× → **2.17×** | 5 → **6** / 12 |
| Metroplex | — → **62%** | — → **7%** | — → **1.71×** | — → **4** / 12 |
| Waterfront | — → **51%** | — → **0%** | — → **1.89×** | — → **6** / 12 |
| Sky Harbour | — → **61%** | — → **4%** | — → **1.78×** | — → **8** / 12 |
| Terminus | 28% → **51%** | — → **3%** | 2.43× → **1.97×** | 12 → **11** / 12 |

Terminus is the safe one and Metroplex the tough one, which is roughly the shape they are meant to have; Junction is the outlier on blow-outs, and §14.2 says why. Twelve runs is a noisy reading, so treat a one-run difference in survival as nothing.

Waterfront and Sky Harbour were measured past week 1 for the first time when they got their own starter tiles, 16 runs each over `--seed0 1000` and `2000`. That reading is kept because it is what justified the starter tiles, not because it is current:

| Mode | Survived before | Survived after | Weeks 5–16 (mean score/quota) | Note |
|---|---|---|---|---|
| Terminal | 12 / 16 | 11 / 16 | 2.2–2.9× | Unmoved inside the noise; the only change it sees is four more one-square shops in the pool |
| Waterfront | 11 / 16 | 13 / 16 | 1.6–3.6× | The Pontoon opener is worth about two runs, the same trade Ferry-from-week-1 was |
| Sky Harbour | 13 / 16 | 11 / 16 | 2.3–3.2× | The 8×16 split and the week-3 crime wave cost roughly what the cheap aircraft pay for |
| Junction | 10 / 16 | 9 / 16 | — | Measured because the one-square shops were aimed at it; unmoved inside the noise |

All four sat within four runs of each other at the time, and Terminal and Sky Harbour on the same number, which was close enough that no level needed a `quotaMult` of its own — and still is, on the table above. Eight runs is a noisy reading — the same eight seeds move by one or two survivors between measurements of the same build — so treat a one-run difference in this table as nothing.

### 10.1.1 Difficulty

Difficulty is the second axis on the start screen. Where a mode changes the *shape* of a run, a difficulty only changes the *pressure*, so the same board reads the same way at every level. Unlike modes it is not gated: a player who wants a harder first run shouldn't have to grind a week-12 unlock for it.

| Lever (`src/data/difficulties.js`) | Standard | Hard | Extreme |
|---|---|---|---|
| `quotaMult` — flat on every week's quota | 1 | 1.15 | 1.15 |
| `quotaGrowthAdd` — added to the per-week growth | 0 | +0.008 | +0.030 |
| `costMult` — tile prices | 1 | 1.15 | 1.35 |
| `startMoneyMult` — cash at week 1 | 1 ($220) | 0.94 ($207) | 0.9 ($198) |
| `mods.revenueMult`, `mods.fareMult` | 1 | 0.9 | 0.8 |
| `redo` — the week can be taken back | yes | — | — |

**Read `startMoneyMult` against `costMult`, never on its own.** The two multiply into what the opening hand can buy, and at 0.8 cash against 1.35 prices Extreme could afford 59% of what Standard could — while also owing 20% more score. On Junction, which has to play three tiles a week from week 1, that bought two of them and the run ended in week 1 eleven times in twelve (§15). Both hard levels now cut cash far less than they raise prices: Extreme buys 67% of a Standard opening, Hard 82%.

The growth lever is what separates the two hard levels. A flat multiplier alone is felt in week 1 and then forgotten, since the board outgrows it; adding to the growth rate makes the gap widen every week instead. Standard's week-16 base quota is 57k, Hard's 72k (1.26×) and Extreme's 91k (1.60×), while their week-1 quotas are 8★, 9★ and 9★ — the star rounding ties the top two in week 1 on purpose, and at the 8,000 base it is what a flat 1.20 could not do without quietly becoming a 1.25. That shape was chosen after measurement: at `quotaMult` 1.35 Extreme killed five of sixteen bot runs in week 1 or 2, which is a coin flip on the opening hand rather than a difficulty (§15).

**Redo Week** is the one lever that is not a number. On Standard the run keeps the week's opening state, and a button puts the board, the cash, the action points and the shop back to how the week started, so a misplaced tile there is a mistake rather than the end of a run. Hard and Extreme keep no snapshot at all: a move made is a move kept, which is most of what makes them harder to *play* rather than merely more expensive. It is offered from the first move of the week (under the timeline) and, once every action point is spent, under the big Run Week button on the board. Running the week ends the offer — the week is settled and the next one snapshots itself.

`costMult` stacks with the mode's (Metroplex on Extreme is 1.25 × 1.35) and with the Staff Expansion ordinance, and like them it leaves upgrades, cards and bridges alone. The `mods` block is merged exactly like an ordinance's, so nothing in the simulator knows difficulty exists.

Greedy bot, 8 runs to week 16 on Terminal, over `--seed0 1000` and `2000`:

| Difficulty | Survived | Median week | Weeks inside 1–2× | Deaths |
|---|---|---|---|---|
| Standard | 14 / 16 | 2.2× | 39–41% | weeks 8 ×2 |
| Hard | 7 / 16 | 1.6–1.9× | 54–66% | weeks 1, 4, 8 ×5, 10, 16 |
| Extreme | 4 / 16 | 1.5× | 78–79% | weeks 1, 4 ×2, 8 ×3, 9 ×2, 10, 12, 13, 16 |

Extra hours (§4.1) are most of the gap between the rows' medians: Standard's surplus cash buys moves, while Extreme's rarely stretches to them (§15).

The band widens as the difficulty rises for the obvious reason: a run with no headroom spends every week near its target, which is what makes Extreme feel the way it does — and what makes one bad event week the end of it.

Records are kept per mode **and** difficulty: a week 16 on Extreme is not the same achievement as one on Standard.

### 10.2 Ordinances

Modes don't create variance between two runs of the same mode; **ordinances do**. At weeks 5, 12 and 20 the player picks one of three, drawn from those not yet taken. They are permanent.

| Ordinance | Effect |
|---|---|
| Tourist Board | Travellers two tiers off an amenity roll at 0.6× instead of 0.25× |
| Express Charter | Transport multipliers +0.25, amenity multipliers −0.10 |
| Zoning Variance | Deleting refunds half the tile cost |
| Union Contract | Dwell +2 ticks everywhere; amenity capacity −20% |
| Retail Compact | Amenity revenue ×2; flat points ×0.5 |
| Night Service | 30 ticks per week (20 of arrivals) instead of 24; quota ×1.15 |
| Wayfinding Signs | Every service amenity +1 radius; capacity −15% |
| Loyalty Scheme | Every traveller +1 stop budget; fares −50% |
| Staff Expansion | +1 AP every week; tiles cost 15% more |

### 10.3 Bad actors

**Pickpockets** arrive from week 7 (the *Crime Wave* milestone). They phase in over three weeks, reaching 5% of spawns at full strength: roughly a 7% score cut in week 7, 16% in week 8 and 21% from week 9 on an unprotected board. The **Crime Spree** event (§9) puts 10% of spawns on the same rate for one week, and is gated to week 7 and after for the same reason the wave starts there.

- **What they do:** pickpockets are drawn dark with a red ring. They walk between platforms and steal 15% of the chain value of any traveller they pass adjacent to. They never board and never score.
- **Counters:** the Security Station and Security Guard remove any pickpocket entering their radius, and the Security Checkpoint catches those who walk through its booth.
- **No forced counter:** none of these is guaranteed a shop slot; they turn up in the normal rolls.

### 10.4 Bonus cards

Consumables from the shop. Each costs 1 AP to play, plus its price — except the Rezoning Permit, which costs no AP (§4.1). Playing one takes two steps like every other card: picking it only puts it in the card bar, and its **Play it** button is what spends (§12.6).

| Card | Cost | Effect |
|---|---|---|
| Overtime | 40 | +2 AP this week |
| Temp Staff | 70 | +1 AP this week and each of the next two |
| Fast Pass | 60 | All travellers +2 stop budget this week |
| Charter Bus | 50 | 40 extra $ travellers this week |
| Rezoning Permit | 120 | Turn one claimed edge back into open ground. Every transport attached to it is demolished with no refund; aiming the card outlines them in red, and a confirmation lists them first. |
| Coupon Book | 60 | Double spawn batch for one week, at half fares and half shop takings |
| Grand Opening | 70 | One amenity serves at 100% rate for a week |
| Timetable Shuffle | 40 | Reroll one transport's arrival cadence (within ±3 of its base) |
| Survey Crew | 30 | Reveal the event after next |
| Extra Shift | 400 | Permanent +1 AP (a separate shop kind, from week 19) |

### 10.5 Milestones

Run-wide rules that switch on at a set week. They sit on otherwise quiet weeks, so they never collide with an event or an ordinance, and they are announced in the timeline and with a popup.

| Week | Milestone | Effect |
|---|---|---|
| 7 | Crime Wave | Pickpockets begin (§10.3) |
| 10 | New Stock | Rare tiles enter the shop |
| 19 | Overtime Approved | Extra Shift enters the shop |

---

## 11. Meta-progression

Stored in `localStorage`.

**Built:**

- **Mode unlocks** by best week reached in any mode (8, 12, 16).
- **Records:** best week, best week score and best single-traveller value, overall and per mode-and-difficulty.
- **Save and resume:** the run saves after every action, and a lost run clears the save. Saves carry a `SAVE_VERSION` (in `src/game/run.js`) and are not migrated: a save from an older build is reported on the start screen and discarded. Bump the version whenever the saved state's shape changes.

**Planned:**

- **Tile unlocks:** a smaller starting pool, expanded by milestones and mode goals.
- **Ordinance unlocks** earned into the draw pool.
- **A daily seed** with a leaderboard.

---

## 12. Interface

### 12.1 Screens

**The board view is the whole game.** It shows an isometric board you can pan and zoom, with a run status bar along the top (week, quota stars, projection) and a timeline side panel on the right. The shop tray floats over the bottom of the board: the wallet, AP pips, **Reroll** and **Run Week** sit to the left of the cards. Nothing in the tray can be spent once the week is running, so it takes itself away for the run and comes back with the next shop.

Events, milestones, ordinance choices, the weekly summary and the start screen are modals.

**The start screen** picks a difficulty, then a level. Difficulties are a row of three, always all available. Levels are a **carousel**: one at a time, with a still of the board that level opens on drawn over its name, description and your best run on the difficulty currently picked. Arrows either side, a dot per level under it, the arrow keys, and a drag across the still all turn it; the level last played opens first (`meta.lastMode`). Every level is in the ring, including the ones not yet earned — those keep their board still, drained of colour, and carry the week to reach instead of a Start button, so what is coming is visible from the first run. The stills are the real renderer (`boardStill` in `src/ui/render.js`) drawing `startBoard(mode)`, not screenshots, so a change to a level or to the isometric view shows up on the start screen without anything to keep in step.

**Run Week and Redo Week.** Spending the last action point puts a big **Run Week** on the middle of the board, so the turn's end is where the eye already is. On Standard a smaller **Redo Week** sits under it, and the same offer appears under the timeline from the first move of the week (§10.1.1). Both ask before they fire: running the week is the turn's one irreversible click, and redoing it throws the week's work away.

### 12.2 Placement preview

The single most important UI element. While aiming a tile:

- **The shape as a ghost** at its real height, green if legal and red with the reason if not.
- **Pull radius** shaded on the ground, with the existing amenities whose radius overlaps outlined.
- **Terrain effects:** driveways and corridor lanes drawn, and a pulsing highlight on any edge the placement would claim, with a warning line ("Locks the whole north edge to rail, for good").
- **The tunnel** for an underground tile, with the rest of the underground layer lifted into view so a crossing is obvious (§3.5). An illegal line is still drawn, in red, so you can see what it hit.
- **The whole fence line** for a checkpoint.
- **A cut-off warning** naming any platform the placement would seal in ("Walls in Taxi Stand: nobody heading there can reach it"). Sealing a platform is the one placement that still costs a quarter of the week, so it is called out in words, not just red stars.
- **A star badge** with what the placement is worth this week, as a range: the placement is tried on 8 preview weeks (`placement.previewSeeds`), the best and worst are dropped (`placement.rangeTrim`), and the badge runs from the lowest to the highest of the rest, each rounded down. The week the player runs is one more draw from the same spread, so a range is the honest figure where a single mean was not (§15). The "without" runs are cached for the phase, so a preview costs one sim per seed. Upgrade cards show the same badge over whichever owned tile is hovered.
  - **Solid stars** are the ones every week in the range agrees on; **hollow stars** are the rest, and they flicker — a slow fade that runs outward from the solid ones, the furthest faintest, broken now and then by a stutter like a failing bulb. +2 to +4 reads ★★☆☆.
  - **Losses** are red behind a minus, the sure ones nearest zero on the right, blinking to black: −3 to −1 reads −☆☆★.
  - **A range that crosses zero** agrees on nothing, so every star is hollow: −2 to +4 reads −☆☆ +☆☆☆☆.
  - Past ten stars the row becomes text, "+7★ to +12☆", with the unsure end fading the same way.

### 12.3 Stars and the top bar

Quotas are shown as stars, one per 1,000 points. **Stars are the only score the player is shown**: the start screen's records, the timeline, the summary headline and the game-over figures are all in stars, and raw points survive only in hover tooltips. The summary's per-tile table and its chart axis are in stars too. A record uses `starsFig`, which gives whole stars from ten up and one decimal below, so one traveller's chain reads as "0.6★" rather than "0★".

- **Up to ten stars** are drawn as glyphs that light up as the week plays, with the current projection dimly pre-filling the ones it would reach.
- **Past ten,** the row becomes a `7 / 13 ★` counter. The two styles are never shown together.
- **The top bar is a gradient** from dark red through orange and green to lime as the projection passes the quota, and it turns gold at double. Hover it for the numbers.
- **While the week runs** the bar drops the gradient and shows a progress line along its bottom edge instead of a tick counter: a bright playhead walks left to right with the ticks, the stretch behind it takes the same heat colour from what the week is worth so far against the quota (dark red under half, orange short of it, green exactly at it, lime past it, gold at double), and the stretch ahead stays the bar's purple. The tick the **banked** score first meets the quota, the whole bar flashes white once.
- **What the week is worth so far** is the banked score plus the value standing on the board: `pendingByTick[t]` from the sim, the sum over travellers still walking of what each would bank boarding now — their value through the exit transport's multiplier and flat, the tier-match bonus, and any checkpoint booth or lounge stacks they are carrying. A traveller who cannot walk to their platform in the ticks that are left counts at the stranded fraction instead, and a lost one at the lost multiplier (zero). Boarding only moves a traveller from one side of that sum to the other, so the colour climbs through the week and lands on the true final ratio, instead of sitting dark red until the departures start in the last third. The stars stay on the banked score: they are what has been *earned*.

### 12.4 Weekly summary

- **The headline:** stars against the quota with a ✓ or ✗, money earned (with any early-start bonus), and travellers boarded, stranded, lost and robbed.
- **A score-vs-quota chart** for the whole run.
- **A per-tile table:** stars and cash first, then served, turned away, saturation, arrivals, boarded and stranded. This is where players learn the game.
- **The path heatmap** (*Where did people walk?*), the main teaching tool for why a shop was or wasn't visited.

### 12.5 Readability rules

- Full amenities grey out during playback, with an occupancy counter.
- Chain multipliers, boarding values, `cleared ×1.30`, `caught!` and robberies pop as floating text over the traveller.
- Travellers are small dots coloured by tier; pickpockets are dark with a red ring.
- Skip is always available, and nothing requires watching the sim.

**Wording.** Everything a player reads is written for someone who has never seen the design
document. The internal names — dwell, batch, cadence, pull, rate, chain, stop budget, tier match,
balk, spawn, radius — stay in the code and never reach the screen. On screen they are said plainly:
a *wait at the platform*, *how many arrive and how often*, *how many stop*, a *boost*, *stops on the
way*, *turned away*, *range in squares*. One phrase per idea, used everywhere: a traveller still
walking at the last tick *ran out of time*, one who never reached a platform *never got there*. An
amenity is a *shop* in running text. Numbers are kept where a player would act on them (a multiplier,
a price, a percentage) and dropped where they only decorate ("far more people", "much more likely
to"). A refusal says what to do next — "rotate it", "needs a bridge" — not which rule it broke.

**Pictures before words.** Where the screen already has a mark for an idea, the text uses the mark
and drops the phrase:

- **Action points** are the wallet's own pips, shrunk into the line (`apPips` in `main.js`): the
  card bar's price, the Delete button, the Run Week confirmation ("Unspent: ▪ → +$20"), an event's
  extra AP, and each level's weekly AP on the start screen. "AP" and "action point" survive only in
  card and ordinance text and in tooltips.
- **Event weeks** carry ⚡ everywhere: the top bar, the timeline tag (`⚡ Festival`), the event
  popup's header, and `⚡ ?` for an event not yet revealed ("Revealed after week 8"). The quota
  multiplier is already in the week's stars, so it moves into the tag's tooltip.
- **Tiers** are their `$` signs. A shop's popup says `For: $$`; a tier-free shop says `any $`.
- **Tile popups** are short label/value rows: *Arrive* (a crowd per week, `batch × ⌈spawnTicks /
  arr⌉`, since "2 every tick" has to be multiplied out), *Leave*, *Boarding* and *Visit* (the
  boost as `×1.84 +100`), *Draws*, *Serves*, *Earns*. What the board or the card already shows is
  left out: no terrain row (the card says it), no shape code, walk-through floor is one word.
- **Terrain labels** on cards: Road, Rail, Water, Airfield, Lane, Anywhere, Underground (the code
  keeps `apron`, `corridor`, `free`). A strike names the tiles that walk out, not their terrain.
- **Level cards** show the board size and weekly AP as `12×12 ▪▪`, so their text only says what
  sets the level apart. A record line appears only once there is a record.
- Shop cards carry a pixel-art header in place of a kind label (§13.3). The card's colour still
  says *shop*, *transport*, *lounge*, *utility*, *upgrade*, *bonus* or *bridge*, and the header
  narrows it: a transport's shows its kind of ground. A transport card shows no terrain word;
  the popup and card bar still spell the terrain out.
- A card's bottom line holds its tier in the left corner and its price in the right, so the price
  stays inside the short phone cards.
- A tile card's shape preview is drawn in the first orientation that is at least as wide as it is
  tall, since the preview box is landscape; an upright L5 would otherwise draw at half size.

### 12.6 Controls

- **Camera:** drag to pan, scroll or pinch to zoom; **+ / − / Fit** buttons or the **+**, **−** and **0** keys.
- **Picking a card spends nothing.** It goes into the card bar over the shop tray, which shows its
  name, its price in money and AP, and its full text — on a touch screen that bar is the only way
  to read a card at all. The bar's own button is what spends: **Build here** for a tile, **Play it**
  for a card that needs no target. **✕** or **Esc** puts the card back. **⌄** folds the text away
  when it covers too much board, and the choice is remembered. On a narrow screen the bar takes the
  cards' own place instead of stacking above them — the tray keeps its height, so the board does not
  move — and **✕** hands the space back to the cards.
- **Placing:** click a card, then the board. **R** (or shift+scroll, or right-click) rotates, and
  **E** or the bar's **⇄** switches the side a transport attaches by (§3.2). The button names the
  side, and is greyed where there is only one.
- **Touch** has no hover, and a finger misses, so a tap only aims — a tile, an upgrade, a bonus
  card on a tile or an edge alike. The card bar then becomes the confirmation: its title names the
  target (`Burger Joint L1 → L2`, `Rezoning Permit: north edge`), the line under it gives the
  reason a spot is refused or what a Rezoning Permit would tear down, and its buttons are **⟳**,
  **⇄**, **✓ Build** (**Upgrade**, **Play**, **Rezone**) and **✕**. While aimed, the card's text
  folds away so the bar covers as little board as it can; **⌃** opens it again. **✕** steps back
  one thing at a time, like Esc: the aim first, then the card. Tapping elsewhere re-aims. The star
  badge stays over the target, kept on screen at the board's edges. A mouse click still commits at
  once.
  - This replaced a popup that opened by the target with the price and its own Build and Cancel.
    On a phone it sat over the board a hand's width above the card bar, both boxes carrying the
    same name and price, and between them they covered most of the view.
- **Tile details:** hover a card or tile to see them; click a tile to pin the popup, which carries
  the Delete button and a close button, and stays inside the screen on a phone. On touch, Delete
  asks once (**Keep** / **Delete**) before it acts.
- **Targeted cards:** upgrades and bonus cards that need a target highlight the valid tiles (or
  edges, for Rezoning Permit), and the bar says what to pick.
- **Run Week** asks for confirmation only while AP is unspent, and shows the unspent pips and what they pay. Once all AP is spent, a large Run Week button also appears on the board.
- **Music:** **♪** or **M** mutes it, and the choice is remembered. The start screen and a lost run are silent.
- **Panels:** the side panel's chevron collapses it; the shop tray has no hand control at all,
  because it already knows when to go (the week's run, the summary, a lost run). The side panel is
  a column on the right of a wide screen and a strip along the bottom of a narrow one, so its
  handle turns with it: a full-width **⌄** bar across the top of the strip, and **▲** on the tab
  that brings it back. On a narrow screen that tab sits at the bottom of the right edge, just above
  the cards, where a thumb already is, and it stands down while a card is in hand. The handle sits
  outside the scrolling area, so it cannot be scrolled away.
- **On a phone:** the side panel starts collapsed, the top bar and cards shrink, the page is sized
  to the visible viewport (`dvh`) so the tray is not hidden behind the address bar, a card in hand
  covers the cards rather than the board, and controls take a tap without the double-tap zoom
  delay. A long press neither selects text nor raises the copy menu, and on the board it is not a
  right click, so it cannot rotate or drop the card in hand. The canvas swallows the click a tap
  leaves behind, so it cannot land on whatever sits under the finger.
- **A phone on its side** (landscape, under 500px tall) keeps the side panel as a column on the
  right, since width is what it has, starts with it collapsed, and shrinks the cards to 88×118 and
  the wallet to one row. The card bar sits bottom-left at half the width rather than across the
  board, and the summary chart drops to 110px so its buttons stay on screen.

---

## 13. Technical design

### 13.1 Stack as built

- **Code:** plain JavaScript ES modules with no framework, no build step and no dependencies. The page loads `src/ui/main.js` directly, so it must be served over HTTP. `harness/build.js` bundles everything — sprites and music included — into `dist/grand-central-station.html`, which works from disk.
- **Simulator:** `src/sim/sim.js` is headless and deterministic, with no DOM dependency; the same modules run in Node for the harness and in the browser for play. A week takes ~2 ms for a small board, so it runs inline — no worker — and is precomputed before playback. The renderer replays each traveller's recorded frames and events.
- **Seeding:** every roll is stateless — a hash of the week seed, the traveller's *spawn slot* (which transport, and their number in its stream) and the question being decided (tier, destination, a waypoint, a shop's die, a tie-break at a cell). No stream is shared, so a board change re-rolls only the travellers whose route it touches; a tile out of everyone's way leaves the week identical, and the preview's before/after runs stay on the same random path. That holds for transports as well as amenities, which needs care: a choice made by walking a list re-rolls everyone when the list grows, so every such pick — the destination, the door a traveller leaves by, the tie-break between two equally short steps, the platform an extra spawn arrives on, a pickpocket's next mark — is a `race` in `sim.js`, keyed by the tile or cell each option stands for (§15). `sim.stratify` turns a slot's rolls into golden-ratio steps along the unit interval, so a transport's travellers cover the dice evenly (the tier mix and each shop's serves land near their expectation). It applies only where one die is read against a threshold — tier, pickpocket, a shop's pull, the loop — because every question shares the step, so a slot's dice sit a fixed distance apart: a `race` and a waypoint's Gaussians roll the traveller's own die instead (§15). The old per-subsystem streams (`makeStreams`) remain for the shop and cards.
- **Pathing:** a Dijkstra distance field per target, memoised per week. Destinations are few and travellers many. Checkpoint fences are a per-step bitmask, since they lie between cells.
- **Data-driven content:** every tile, event, card, ordinance, mode and difficulty is a plain object in `src/data/`, and every tunable number lives in `src/config.js`. A mode can also re-time the run for itself — per-tile shop weeks, the event and milestone weeks, and tiles the board starts with — all as data (§10.1). Unique mechanics are keyed by `special`: `wifi`, `walkway`, `waiting`, `gate`, `security`, `green`, `loop` and `anytier`. Underground tiles are keyed by `terrain: 'underground'` plus `line` (`through`, `road` or `water`); the placed tile records its tunnel as `tile.tunnel = { line, axis, ends, cells }`, and the layer's occupancy is derived from the tiles rather than stored, so nothing can drift out of sync.
- **State:** a plain mutable run-state object with action functions (`src/game/run.js`); the UI re-renders after each action. `window.gcs` exposes the state, the game API and `refresh()` for debugging from the console.

### 13.2 The isometric view

`src/ui/render.js` draws the board through a 2:1 isometric camera on a Canvas 2D context.

- **Grid space stays plain.** The board model is x right, y down. The renderer projects grid points to screen and un-projects screen points back, so `cellAt`/`edgeAt` picking is exact at any zoom, and nothing else in the codebase knows the view is isometric.
- **Zoom:** `k` is the on-screen width of one cell's diamond. `fit()` picks the `k` that frames the board and its edge strips above the shop tray, and zoom scales from there.
- **The world beyond the board:** a side claimed by water turns everything beyond it to sea, and road and rail edges carry on past the corners into the distance. A railway that meets the sea at a corner turns 90° and follows the shore out of the view, because track cannot run into water: the strip gives up its last two widths (`TURN_R`) to a quarter-ring bend of the same width, so the rails and sleepers carry round the curve at the radius the straight track sits at instead of mitring into a notch. A subway line does the same where it leaves the board: the portal sits in the edge strip and the cut carries on to the horizon, while a garage ramp or a submarine channel stops at the edge it tunnels to.
- **An airfield edge is three deep.** Beyond the apron strip an `apron` edge lays two more squares of runway — dark tarmac inside a painted kerb, with a stripe down each side, a dashed centre line and piano keys at both ends. It runs the length of the board's own side and stops at the corners, the way a real runway ends in a threshold, rather than crossing whatever the next side claimed.
- **The underground layer** is painted in `drawGround`, under every building, as a dark cut with rail ties along each tunnel's axis. `drawUnderground` repaints the whole layer above the buildings, over a dimmed board, whenever the view asks for it (an underground ghost, or an underground tile hovered or selected).

The **draw unit is the cell, not the tile.** Every occupied cell is sorted by `x + y` and painted back to front. Ordering whole tiles isn't enough, because footprints interleave: a one-cell tile can stand in front of one end of a long building and behind the other. A tile's label is drawn after its last cell, so its own roof never covers it.

**Travellers sit between two layers:** floor, then the crowd, then walls and roof, all merged into one depth-sorted pass.

| Element | Sort depth |
|---|---|
| A cell's floor | `x + y − 0.75` |
| A traveller | `⌊x⌋ + ⌊y⌋ − 0.5` |
| A checkpoint fence panel | `x + y − 0.6`, just behind the cell south or east of it |
| A cell's walls and roof | `x + y` |

The result is that someone who steps into a shop is covered by it. Most walk-through tiles stand 0.10 high, so the travellers on them stay visible above the lip.

**Ground tiles** (`ground: true` in `src/data/tiles.js`: Parking Lot, Pontoon Moorings, Hardstand, Green Space, Pocket Park, Waiting Area, WiFi Hotspot, Moving Walkway) have no height at all. They are paving, so they cast no shadow, have no walls, and their whole face is painted in the floor layer with the crowd walking over the top of it. Their labels can't ride on a roof that isn't there, and the crowd walks over where they sit, so they are drawn last of all, after every cell and every traveller.

Travellers are small dots (radius `k × 0.062`, minimum 1.2 px), so the crowd reads as flow rather than as counters. Chain-value popups are drawn last and are never hidden.

`src/ui/boardinput.js` owns the gestures. One pointer both pans and picks: a press that barely moves is a tap, anything further pans. Two pointers pinch and pan around their midpoint, and the wheel zooms about the cursor.

### 13.3 Sprites and audio

The board is pixel art in the classic 2:1 isometric projection: a cell is a 64 x 32 diamond and a
unit of tile height is 64 x `H_UNIT` pixels. Every tile is drawn in code and baked once into a
picture, and the renderer only copies pixels. `renderer.artMode = 'blocks'` draws every tile
instead as a plain prism in its colour, the look before the art (`tileshow.mjs --blocks` shoots a
scene that way); a tile whose sheet has not loaded yet draws as a block meanwhile.

- **Drawing (`harness/tileart.mjs`):** each tile is drawn top-down in its shape's base orientation
  at 32 art pixels per cell, in two layers with the crowd between them: the floor a traveller
  stands on (paving, carpet, water, track), and what stands over it (roofs, canopies, signs, tree
  tops). The main surfaces take the tile's own colour (`colorForDef`), so the board keeps its
  colour code with the art on; vehicles, water and grass keep their own colours.
  - `block` marks a rectangle of the over layer that stands up off the floor, from a base to a top
    height: a rental office, a tree top (`round`, so it bulges instead of reading as a drum), a
    monorail beam, a lift's cables. A block with a base above zero floats.
  - `stack` draws a vehicle as a sprite stack: a pile of slices from its wheels to its roof, a
    function of the point on its plan and its height, so its sides carry their own detail. Cars
    have tyres under a sill, lamps, door seams and a narrower cabin with a raked windscreen; the
    limousine is the same car stretched. The bus has two axles, its livery stripe, a band of
    windows, doors on the kerb side and a lit destination board. Carriages have bogies, the line's
    stripe, windows and doors; the leading one is an engine with a cab window over a yellow
    warning panel, a tram has a cab at each end, and the monorail pod is a carriage with cabs at
    both ends. Boats have a vee hull, dark below the waterline, with the deck inside and a cabin
    of windows on it; the ferry has its stern door, two decks and a red funnel; the cruise ship
    portholes, three decks of balconies stepping in, lifeboats and a funnel. Airliners stand on
    their gear with a round fuselage, cheatline, cabin windows, flight deck glass, engines under
    the wings and a fin in the livery colour. The helicopter sits on skids under its rotor, the
    gondolas are glass boxes on their cables, the loop pods white capsules, the submarine a hull
    in its pool under its tower, and the balloon a teardrop of gores over its basket. A slice of
    `'top'` shows the top-down drawing under it, so a car's roof and a taxi's sign come from the
    drawing. Cars stand 0.2 of a tile high, buses 0.36 and carriages 0.32.
  - `sink` cuts steps down into the floor. An underground tile (subway, express subway,
    underground parking, submarine dock) stands no higher than the concourse (`tileHeight` 0)
    with its stairs cut into it: the subways have flights of six steps ending in a dark tunnel
    mouth, the car park a ten-step ramp down to its garage, a sunken bay at the foot of the L 0.2
    deep with the cars parked in it (deeper, and a pit's near walls hide most of what is in it),
    and the submarine dock a one-step pool with the submarine in it.
  - `pad` widens a tile's drawing by whole cells for art past the board's edge: the cruise ship
    off its quay, the stations' trains on the line, the water taxi's boats, the jetways'
    airliners on the apron. A stack may also reach past the drawing: airliners are drawn at 0.9
    of their length in span, their wings over the squares either side.
  - The bottom of a transport's drawing is the side it works from: the kerb a bus pulls up to, the
    track, the berth. `shapeTransform` turns that side toward the edge the tile depends on
    (`tile.edges`) when the orientation allows it, so an I-shaped stop always has its vehicle on
    the road side. Shapes with one transform per orientation (L, S) can't be turned that way, so
    their art does not depend on it: the ferry's slip is symmetric, and a jetway's nose sits in
    its tip cell, which `attach: 'tip'` already places at the apron.
  - A corridor tile's lane (§4) is drawn as its track: `lane` art is a one-square drawing laid
    along every square of the lane and one past the edge, turned to run with it (the monorail's
    beam on a post a square, the lifts' cables, the tram's rails in the floor), and `laneAlt` art
    goes on every other square instead (the lifts carry one car a square, out on one cable and
    back on the other in turn, and four on the tile itself). Beam, cables and gondolas float at
    the height they have on the tile, so the crowd walks across the lane under them.
- **Baking (`harness/isoart.mjs`):** it ray-casts each tile's drawing once, for each of the four
  quarter turns, into the isometric projection. What a ray meets front to back makes the pixel:
  - a shop is a solid prism, walls lit and shaded with a lit top course, a dark footing and a
    seam per cell, and its over layer for a roof, so a traveller who steps inside vanishes into it;
  - a transport, a cart or a low walk-through tile with floor art is a glass box: its floor with
    the crowd on it, panes that are a faint wash of the tile's colour in a frame, an open top with
    only what stands over the floor on it, so the crowd shows through;
  - a flush tile (`ground: true`: parks, car parks, the waiting area, the walkway, WiFi) is its
    floor under the crowd, with a kerb in the tile's colour, and anything in its over layer that
    is not a block hanging at a canopy height (the tree tops);
  - blocks and stacks stand up as solid shapes whose sides are faces, the ink outline of a
    block's drawing painted over in the colour inside it so a red car's side reads red;
  - the stairs are cut down step by step, each riser the wall of the step above;
  - everything standing up throws its shadow onto the floor along the light (0.45 art pixels
    across per pixel of height), so a car's shadow is its own shape and a tree top's or an
    airliner's falls clear of it; past the edge, where there is no floor, the shadow is a
    see-through wash.
  Each pixel is stored with the face it is on (top, left, right, or a middle shade where a curve
  such as a bow runs between them) and the cell under what it shows.
- **Sheets:** `assets/iso/<key>.png` is a plain picture, the four turns one row each, floor layer
  then over layer, in the tile's real colours and light, so it can be touched up in any image
  editor. `<key>_map.png`, in the same layout, carries what a picture can't: which cell owns each
  pixel (green, index + 1 into the turn's cell list in `isosprites.js`), the face it is on (red,
  face x 60) and how much of it is the tile's colour (blue, weight x 100: each tile is drawn
  twice in greys to learn it). A pixel painted in later with no map under it goes to the cell
  beneath it and is not relit; a missing map still draws. Rerunning `isoart.mjs` overwrites
  both, so after touching a sheet up, rerun it only for the tiles to redraw
  (`node harness/isoart.mjs bus_stop`).
- **Drawing the board:** `src/ui/sprites.js` loads the sheets and cuts each turn into one canvas
  per cell; the renderer paints them cell by cell, back to front along x + y, floor pieces under
  the crowd and the rest over it, so a long building still interleaves with its neighbours.
  - *Mirroring:* flipping a view left to right is the same as swapping the grid's x and y, so a
    sheet holds only the four turns and the mirrored four are those frames flipped (`isoFrame`
    finds which turn to flip). The light stays on the right, so a flipped frame is relit from the
    map: each face's shade divided out and the other side's put in.
  - *Palette swaps:* a full or closed tile is the same frame in a grey palette, and a tile shown
    in another colour than it was drawn in shifts each pixel by its weight.
  - *Reach:* each turn's cells are tagged 0 (under the tile), 1 (past a padded side: the band,
    shown only where it lies past the board's edge, so only when the tile sits on that edge) or 2
    (anything else a vehicle reaches, such as a wing over the next square, always shown and
    painted at that square's depth).
  - *Swaying trees:* a park's tree tops (`.sway` on their block in `tileart.mjs`: the green space
    and the pocket park) bend in the breeze. The bake adds eight more columns to the sheet, the
    over layer at each frame of one loop: upright, a lean to the right, upright, a lean to the
    left. Each screen row of a canopy slides across by up to 3 px at its top and none at its
    foot, in whole pixels, so every row is the still one moved over and the edge steps cleanly
    (a shear by height instead leaves teeth down the canopy's side). The shadows and the floor
    stay still. The renderer steps a frame every half beat of the music, so a loop takes a bar
    and the tree tops lean out on beats 2 and 4. Each music file in `TRACKS` carries its tempo
    and first beat, measured by `harness/tempo.mjs` (GCS1 98.39 BPM, GCS2 116.99), and
    `musicBeat()` reads the beat off the playing file's clock; with the music muted or not yet
    started the trees keep 100 BPM on the wall clock. Every park sways in step. A mirrored
    frame would run half a loop behind, since mirroring turns a lean to the right into one to
    the left, but square tiles never mirror. The start screen's thumbnails hold them upright.
  Sheet pixels are crisp once one covers a screen pixel, and blend below that. The cost is the
  look at in-between zooms: nearest-neighbour at a scale that is not a whole number doubles some
  pixel columns and not others, so fine detail (a 1 px stripe in an icon) can zigzag. The 69
  sheets and their maps come to about 0.8 MB; drawing the full catalogue board takes 4-7 ms a
  frame in headless Chromium.
- **Ground:** the land round the board, the sea, the edge strips and the concourse are filled with
  pixel textures from the same bake, `assets/ground/<name>.png`: 128 x 64 pictures that tile the
  plane from the grid's origin, so their pixels line up with the tiles'. Each is drawn top-down
  over 2 x 2 squares and projected, except the sea, drawn straight on the screen's pixels so its
  crests lie level, drifting a pixel at a time. Road, rail and apron come in two turns (`_x`
  along N and S, `_y` along E and W), laid centred across their strip so the runs past the
  corners carry on in step: tarmac with white kerb lines and a dashed yellow centre, purple
  ballast with sleepers and two rails, concrete slabs with a taxi line. The runway texture
  carries its kerb, side stripes and centre line (the piano keys at its ends are painted over
  it), the concourse its grey checker with a joint round each square, and the corner junctions
  plain asphalt or ballast, with a level crossing's rails (`crossing`) over the road. Where a
  railway meets the sea the 2 x 2 bend is a picture too, `bend_<rail side><sea side>`, one per
  corner and way round: the rail texture bent round the ring, anchored at a whole grid point so
  its pixels stay in the grid (`GROUND_BENDS` in `isosprites.js`); the straight run along the
  shore after it is centred on its own band, just inland of the waterline. Until the textures
  load the ground is their plain colours. Everything drawn over it (driveways, lanes, tunnels,
  portals, highlights) is vector.
- **Labels:** the label sits over the middle of every tile; a tile whose art reaches past it labels
  after that art, so a ship never covers its quay's name.
- **Card headers:** `CARD_ART` holds a 56×21 scene per kind of card, in `assets/cards/`. A transport
  gets its terrain's: road, rail, water, airfield, lane (mountains and a monorail beam, for the trams,
  monorails and lifts), underground, and `free` split in two — `sky` for the tiles tagged `air`, and a
  saucer over a beam pad for the rest. An amenity is `future` if rare, then `park` (green), `lounge`
  (waiting), `security` (the station, guard and checkpoint), `utility` (WiFi and the walkway: the
  rest with no draw rate), `food` (tagged food) or `retail`. Upgrade, Extra Shift and named upgrade
  cards share `upgrade`, and one-off cards `bonus`. The bridge card is out of the shop, so it has
  no header and keeps its label.
  `harness/cardart.mjs` draws them in code and writes the PNGs; edit a scene there and rerun it. They
  show at 2x, cropped from the top on phone cards and scaled to fit on the smallest.
- **Music:** `src/ui/audio.js` plays the run soundtrack, fading in and out. The `main` track is a list of files (`assets/music/GCS1.mp3`, `GCS2.mp3`): it is shuffled when the run's music starts and then played in that order, looping back to the top after the last one. The mute choice is remembered in `localStorage`. Each file's entry carries its tempo and first beat for the swaying trees (§13.3, *Swaying trees*); a new file needs them measured with `node harness/tempo.mjs`.

---

## 14. Balance and testing

### 14.1 Harness

```bash
node harness/selftest.js                                              # invariants
node harness/run.js harness/layouts/doc_example.json --seeds 50 --week 4   # one layout, p10/p50/p90 + saturation
node harness/autoplay.js --runs 8 --weeks 16 [--mode junction] [--difficulty hard] [--verbose]  # greedy bot plays full runs: survival, per-week ratios, and the band
node harness/week1.mjs --runs 16                                      # week 1 on every level x difficulty
node harness/marginal.mjs --week 6 --seeds 12                         # value of one more of each tile
node harness/tierlist.mjs --weeks 5,9,13 --seeds 6                    # rank the catalogue on the bot's own boards
node harness/tierboard.mjs --weeks 4,9,13 --seeds 10 --out tiers.json  # rank tiles, cards, ordinances on fixed benches
node harness/sensitivity.mjs --bot 1000 --week 9 --seeds 24           # placement landscape of each probe tile on a bot board
node harness/badge.mjs --bots 1002,1003,1004,1005,1006 --weeks 9,12   # the star badge against the week the player actually runs
node harness/eventprice.mjs --events fog,snowstorm --seeds 16        # each event's score ratio and hardness on the bot's week 8/12/16 boards (§14.2)
node harness/ui-smoke.mjs                                             # Playwright drive of the real page
```

`autoplay.js`, `run.js` and `sensitivity.mjs` accept `--set <config path>=<value>` to A/B a rule (`--set sim.hurry.enabled=false`), and `autoplay.js --no-prune` stops the bot deleting tiles. `--set` reaches `CONFIG` only, so a mode's or a difficulty's own levers have to be edited in `src/data/` to be tried.

- **Week 1** (`harness/week1.mjs`) plays the opening turn of every level at every difficulty and prints the cash, the quota, the share of seeds that clear it and **how many tiles the bot could afford to place**. That last column is the one worth watching: a level whose action points outrun its wallet reads as tiles below its AP with cash left over, and no amount of quota tuning will fix it. Current reading, 16 seeds: every level and difficulty clears 15 or 16 of 16 and places as many tiles as it has action points.
- **Sensitivity** (`harness/sensitivity.mjs`) sweeps every legal placement of a few probe tiles on a board (a layout, or the bot's board at a given week via `harness/bot.mjs`) and reports each tile's landscape — best, median and worst spot, share of losing spots — and its *roughness*: the mean jump in value between a spot and the same tile one cell over or rotated, next to the seed-noise floor of the estimate, so a real cliff can be told from a noisy one. `--dump` saves the bot's board as a layout for another build to probe.
- **Badge** (`harness/badge.mjs`) checks the preview against the week itself. The badge is a mean over the estimate seeds and the week runs on a seed of its own, so for random legal placements on the bot's boards it reports how far the real week lands from the badge (as a share of the week) and how often a badge of a star or more turns into a week that scores less, for one placement and for two in a row. Like `sensitivity.mjs`, `--set` applies after the boards are built, so an A/B probes the same boards.
- **Tier list, two ways.** `tierlist.mjs` ranks the catalogue on whatever the bot built, which is realistic and different every time. `tierboard.mjs` ranks it on fixed benches instead, so a tile measured today and a tile measured next month are measured against the same crowd: an **amenity bench** (a car park at each end of the board, a restroom either side of the middle, the tile under test swept over the free band between them), a **premium bench** (the same with the far car park swapped for an Express Train, so half the crowd is $$$), and a **transport bench** (one car park and a four-shop chain, so a new platform is judged on the traffic it brings to shops already standing). Waterfront and Sky Harbour get copies of the transport bench, because their own stock is sold nowhere else. Every shop is tried on both crowds and keeps the better reading — a Designer Shop among budget travellers is not a bad tile, it is a tile in the wrong station. The headline is the **median** legal spot's value per $100, not the best, since the player cannot see the best cell in advance; best, negative share and cash per week sit beside it. Cards and ordinances have no footprint, so they are run as modifiers on the same benches, and cards that buy action points are priced at the median shop those points would buy. Grades are quantiles of the ranking, so the letters keep their meaning after a balance pass. The graded output, with its findings and the limits of the method, is `tier-list.md`; regenerate and re-grade it whenever the catalogue, the cards or the ordinances change.
- **Layouts:** `harness/layouts/*.json` describe a board: `{ "mode": "terminal", "week": 4, "tiles": [{ "key": "train_station", "x": 4, "y": 0, "rot": 0, "level": 1 }] }`. The board opens as that mode's own (pre-locked edges and starting tiles, §10.1) and the listed tiles go on top; a tile the level has already built where the layout says is adopted rather than placed twice, so a board dumped from a run reloads as itself. `amenity_chain.json` and `transport_spam.json` are the two ends of the strategy space, and the quickest way to see whether a change moved the right thing.
- **Selftest** covers shape orientations, placement and attachment rules, terrain locks, bridges, determinism, lost travellers, checkpoint fences (edge to edge, crossed only at the booth), walk-through tiles, WiFi boosts, pickpocket removal, and the underground layer (tunnels to both ends or to the nearest road or water edge, no crossings, no surfacing into water, building over a tunnel, and shop availability).
- **UI smoke test** (`npm i playwright && npx playwright install chromium`) starts a run, places tiles, runs playback, opens the summary and heatmap, picks an ordinance, upgrades and deletes via the UI, plays a Rezoning Permit, uses the strike selector, reloads and resumes, checks game-over and the start screen, and verifies draw order. It pages the level carousel by its dots (`pickMode`) and checks that every level is in the ring, that one card fills the window at a time, and that a level not yet earned stays in it.

### 14.2 What holds the balance up

Transports bring travellers; amenities multiply what each traveller is worth. Both have to be worth building.

- **Transports alone are worth little.** Batches are small and exit bonuses modest, so a traveller who walks straight from arrival to departure is worth very little.
- **Amenities make the chain.** Their mult and flat values are large, pull rates run 0.36–0.81 and radii 2–4, so most travellers make two or three stops on the way across.
- **Two limits on a chain.** A $ traveller stops after 3 services; for everyone else, the week usually binds before the budget, since each detour risks stranding at the end of the week. On a transport-heavy board stranding runs about 13%; on an amenity-dense one about 63%. Raising `sim.ticks` moves both far more than the stop budget does.
- **Transports cost roughly twice** what a comparable amenity costs.

**Current readings:**

- **`marginal.mjs --week 6 --seeds 12`** (six-tile base board scoring 19★): the cheap tier-1 transports lead at 18–30★ per $100 — Parking Lot 29.5, the Pontoon and the Hardstand 26.8 on their own levels, Rideshare 22.3, Bike Rental 22.0, the three bus-stop tiles 17.7–18.0. The one-square shops head the amenities at 7–9.4 (Coffee Cart 9.4, Souvenir Cart 8.9, Pocket Park 8.0, Cash Machine 7.1), the rest of the good ones sit at 5–8, and the mid-game transports at 5–13. The absolute numbers are all about two thirds of what they were before the multipliers were compressed (§15); it is the ordering that has to hold, and it did.
- **`autoplay.js --runs 8`, run with `--seed0 1000` and `--seed0 2000`:** against the 8,000-base quota the greedy bot (which deletes a tile whose removal scores better) survives 11 of 16 runs to week 16 (5 of 8 and 6 of 8), clears week 1 at a mean of 1.48× and 1.55× (worst 1.09, best 1.75) and runs about 1.4–2.6× as weekly means from week 5 on. The five deaths land on weeks 4 ×2, 8 ×2 and 12 — every one of them an event week, which is where the game is supposed to be decided.
- **The band** — what share of weeks land inside 1–2× of quota — is the other half of that reading, and the two trade against each other one for one (§15). `autoplay.js` prints it: the share inside the band, the share above 3×, and the median, p10 and p90 week. On Terminal, 16 runs to week 16: **48–55% of weeks inside the band, 3–7% above 3×, a median week of 1.8–2.0×**. Watch the over-3× share as closely as the band itself — it is the runaway board, and it was 31% before the multipliers were compressed. Every level, 12 runs each, as band / over 3× / median / survived: Terminal 55% / 2% / 1.80× / 6, Junction 41% / 16% / 2.17× / 6, Metroplex 62% / 7% / 1.71× / 4, Waterfront 51% / 0% / 1.89× / 6, Sky Harbour 50% / 4% / 1.94× / 9, Terminus 51% / 3% / 1.97× / 11. Against the old reading (Terminal 37% / 2.36× / 8, Junction 38% / 2.09× / 5, Terminus 28% / 2.43× / 12) every level's band improved and survival held within a run or two.

Junction is the loose one at 16% over 3×, and most of that is survivorship: half its runs end in weeks 5–8, so weeks 9–16 are measured on the half that were strong enough to get there, on a 9×9 board with nothing left to build and nothing to spend on but upgrades. Two fixes were tried and both cost more than they bought — a steeper `quotaGrowth` (1.08) halved survival to 3/12, and leaving it on the global 1.10 with a higher `quotaMult` left the level dying in weeks 6–7. It is a shape the two levers cannot express: a curve that rises, flattens through the middle of the run, then rises again.
- **`autoplay.js --difficulty`:** on Terminal the same 16 runs survive 14 on Standard, 7 on Hard and 4 on Extreme, with median weeks of 2.2×, 1.6–1.9× and 1.5× (§10.1.1). The bot buys extra hours (§4.1) when the best move they open clears its usual bar, and `autoplay.js` prints how many per week. Run it to week 30 to read the endless ramp (§5.2): on Standard nearly every run that wins now ends between weeks 20 and 29. Re-run all three after any change to the quota block or the economy — a change that only reads as "slightly tighter" on Standard can wipe Extreme out in week 2, and one that only reads as "a little more cash" can hide a level dying in week 1 for want of a third tile (§15). Week 1 is worth its own pass: `createRun` plus one bot week over 16 seeds, per level and per difficulty, is a few seconds and catches exactly that.
- **`tierboard.mjs`, weeks 4/9/13, 10 seeds:** the full ranking lives in `tier-list.md`. The shape to hold: cheap tier-1 transport leads the field at 31–60★ per $100 (the top of that range is Waterfront's own stock, which the level discounts by 40%), good shops sit at 8–21, the big late transports at 3–5, and utility tiles (WiFi, Walkway, Checkpoint, Waiting Area) at 1–3, because they are bought for what they do to other tiles and a five-tile bench gives them almost nothing to do. The cards that buy a crowd or an action point sit at 24–58, Charter Bus at the top; the Coupon Book pass (§15) took the one outlier out of that band.
- **`sensitivity.mjs`, 24 seeds on the bot's week-9 and week-12 boards** (`--bot 1000 --week 9`, `--bot 1001 --week 9`, `--bot 1002 --week 12`): shift 1.6–2.6%, rotate 1.9–3.1%, noise 0.7–0.9%, stranding 14–22%. Board 1002 is the thin end of that range now: the bot reaches week 12 there with a 48★ board, where it used to build an 82★ one. The checkpoint is what holds the top of those two jump ranges up — the tile rotates its fence, so it swings 9–11★ where an ordinary shop swings 2–3 (§15); over the other five probe tiles it reads shift 1.6–3.9% and rotate 1.3–2.7%, where the whole set read 1.7–3.7% and 1.7–2.7% before. Seed to seed the week swings 10–14%, a little steadier than the 13–18% it read before the multipliers were compressed — fewer stops in a chain means less to compound. Moving an ordinary amenity one cell changes its value by 2–4% of the week's score, rotating it by 2–3%; the estimate's own noise floor is about 1%. All three boards are now full ones: seed 1000 used to die in week 1 and arrive at week 9 with two tiles and a 10★ week, and now reaches it with a 37★ board, so it is the small-board end of the range rather than a degenerate one. The one placement that still costs a quarter of the week is sealing a platform in, which the preview names.
- **`badge.mjs`, boards 1002–1006 and 1007–1011 at weeks 9 and 12, 28 spots each:** the real week lands a mean 3.5–4.6★ from the badge, an error of 4–5% of the week's score, and a badge of a star or more comes out as a losing week for 11% of placements (5% and 15% on the two sets) and 8% of pairs (§15). What is left is the chain itself: a tile's footprint bends a few other travellers past more or fewer shops, and a tick either way puts someone on the wrong side of the last departure. By week 9 one tile is worth only 2–5% of the week, which is why the misses cluster there and not in the opening weeks.

**Event-week hazards:** re-check event weeks after any catalogue change, and re-check them after any change to the *band*, which is the thing they are priced against. Every death in the current Standard reading lands on one, and the tighter the quiet weeks run the less an event has to take away to end a run (§15). Inspection is the cautionary tale — once amenities carried half the score, closing every un-upgraded one made that week 5× harder than a normal week, so it now restricts them to 70% instead. Strike had the same hazard: on a one-terrain board it would score exactly zero, hence the skeleton service.

**How an event is priced.** Take the bot's boards at weeks 8, 12 and 16, score each one with the event and again with no event at all, and divide the quota multiplier by the ratio. That number is how much harder the week is, and every event should land between about 0.9× and 1.6×. Current reading (4 boards at week 8, 2 at weeks 12 and 16, 16 seeds each), as score ratio → hardness:

| Event | w8 | w12 | w16 |
|---|---|---|---|
| Convention | 1.15 → 1.02 | 1.13 → 1.05 | 1.10 → 1.07 |
| Delays | 0.60 → 1.41 | 0.59 → 1.44 | 0.58 → 1.47 |
| VIP Delegation | 1.14 → 0.96 | 1.09 → 1.00 | 1.08 → 1.01 |
| Holiday Rush | 1.15 → 1.08 | 1.14 → 1.09 | 1.15 → 1.08 |
| Weather Front | 0.98 → 0.92 | 0.98 → 0.92 | 0.97 → 0.93 |
| Fog | 1.00 → 1.00 | 0.98 → 1.02 | 0.99 → 1.01 |
| Snowstorm | 0.83 → 1.08 | 0.85 → 1.06 | 0.88 → 1.02 |
| Heavy Rain | 0.87 → 1.03 | 0.93 → 0.97 | 0.97 → 0.93 |
| Thunderstorm | 0.96 → 1.14 | 1.07 → 1.02 | 1.14 → 0.96 |
| Strike | 0.80 → 1.12 | 0.71 → 1.27 | 0.87 → 1.03 |
| Inspection | 0.72 → 1.25 | 0.67 → 1.34 | 0.73 → 1.23 |
| Festival | 1.06 → 1.08 | 1.07 → 1.08 | 1.05 → 1.09 |
| Charter Season | 1.00 → 1.21 | 0.99 → 1.23 | 0.99 → 1.22 |
| Crime Spree | 0.63 → 1.42 | 0.89 → 1.01 | 0.89 → 1.02 |
| Back Taxes / Use It or Lose It / Emergency Budget | 1.00 → 1.00 | 1.00 → 1.00 | 1.00 → 1.00 |
| Double Week | 2.01 → 1.00 | 2.01 → 1.00 | 2.01 → 1.00 |

Two of those rows are worth reading twice. **Crime Spree** is the one event whose difficulty falls as the run goes on, because by week 12 the bot's boards have security on them and week 8's do not — which is the point of the event, and why it is gated to week 7 and after. **Double Week** comes out at 2.01 on every board and every week, which is what makes a flat ×2 target fair; that number is the whole argument for running two weeks rather than one long one (§15). The money weeks score a plain week by construction, so their ×1 quota is the honest one and the bill lands on the weeks after.

---

## 15. Tuning history

Changes from the original design, with the reason for each. Original values are noted in `src/config.js` as `(doc: X)`.

**Economy and quota**

- **Quota curve** starts at 5,000 (was 3,000 × 1.25^week) with a decaying growth rate (§5.2). With the document's traveller values, a single bus stop cleared the original week-1 quota three times over.
- **Money** was far too plentiful. Fares and amenity revenue are scaled to 35%, tile prices grow 6% per tile (was 4%), and starting cash is $220.
- **Transport batch sizes** are well below the original table, and exit multipliers were cut to ~0.35× while amenity multipliers rose ~3.5×. The chain, not the platform, is where points come from.
- **Action points stay at 2 all run.** The original ramp (3 AP at week 6, 4 at 12, 5 at 20) was removed; extra AP comes only from cards and ordinances (§4.1). The greedy bot survived *more* often with flat AP (5/8 vs 3/8), because money was already the binding limit, so the quota curve was left alone.
- **Wait replaced by the early-finish bonus.** Wait paid 8% interest on held cash per unused AP (capped at $100/AP), which rewarded hoarding. Running early now pays a flat, week-scaled amount per unspent AP, and the Wait button is gone. Bot survival was unchanged.
- **Rerolls are free** (they still cost 1 AP), replacing the original escalating fee (10, 25, 60, 150…).

- **Multipliers compressed, and the quota curve rebuilt under them** (`sim.multScale` 0.60, §7.1). The complaint was that a run which chained well left the quota behind and never came back: over 12 runs to week 16 on Terminal, 31% of weeks scored more than 3× the target, the median week ran 2.34× and the best hit 4.99×. That is what a chain does — value multiplies at every stop, so the week is exponential in the number of stops and two boards a few tiles apart finish it 5× apart. `scaleMult` pulls every value multiplier toward 1 by the same fraction (amenity and transport `mult`, the upgrade bumps and WiFi's boost summed into them, the checkpoint, the lounge stack, the tier-match exit bonus); flat values are untouched, so a one-stop chain keeps about 80% of its worth and a five-stop chain half. Measured at 1.0, 0.85, 0.75, 0.65 and 0.55 on the three fixed layouts and then end to end with the bot, 0.60 was where the blow-outs stopped without the catalogue changing shape. **The ranking barely moved**: on the tierboard benches at 0.60 no tile shifted more than six places out of 64 and the top ten were identical, so this is a change to the exponent, not to which tile is worth buying.

  The quota curve was refitted under it, since the score curve is now a different shape: base 8,000 (was 11,000), late growth 1.10 (1.125), early growth 1.32 (1.25), decay 0.65 (0.70) — a board gains most while tiles are still going down and little once it is full, so the curve now rises hard for four weeks and gently after. `catchUp.share` went to 0.85 (0.72), which is the one lever aimed squarely at a runaway board and costs a struggling run nothing; measured against `from: 'last'`, which came out identical (8/16 either way), so it stayed on `'best'`.

  Terminal, Standard, 16 runs to week 16, against the reading above: **49–54% of weeks inside 1–2× (was 36%), 3–6% above 3× (was 31%), a median week of 1.8–2.0× (was 2.34×), the best week 3.71× (was 4.99×)**, and week to week the same board now swings 12% seed to seed instead of 13–18%. Survival went 12/16 to 10/16 — the band and survival trade against each other one for one, and two runs in sixteen is the price of taking two thirds of the blow-outs out.

- **An event's discount is not a demand** (`eventMult` in `game/run.js`). `quota.eventStrength` pulled every event's quota multiplier toward 1, in both directions. That is right for a Convention (×1.6 has to be read against the headroom a normal week leaves) and backwards for a Strike, whose ×0.9 is an apology for a week that takes half the board's traffic away: softening it withdrew the apology. It went unnoticed while the band was loose. Once it tightened, weeks 4 and 8 were where six of eight runs ended. Events at or above 1 are still softened (`eventStrength` 0.30, was 0.50); those below it now apply as written. Survival 8/16 → 10/16 with the band unchanged. Lowering `eventStrength` further had been tried first and did nothing (0.35 and 0.20 both read 6/10), which is what pointed at the sign rather than the size.

- **Levels and difficulties refitted to the flatter curve.** Every `quotaMult` had been fitted against an exponential score curve and overshot once the exponent came down. Junction went to 1.30 (was 1.7) with a `quotaGrowth` of its own at 1.06, because a 9×9 board with three action points is full by about week 6 and stops growing — a uniform multiplier could not fix a curve whose *shape* was wrong, and at 1.42 on the standard growth the level still died in weeks 6–7 (2/12). Terminus went to 0.46 / 1.145 (was 0.52 / 1.17), keeping the same offset from the global rate it had before. Extreme's `quotaGrowthAdd` went to 0.030 (0.045) and Hard's to 0.008 (0.012), since the same addition pulls away twice as fast from a flatter score curve; Extreme's `quotaMult` went to 1.15 (1.20), because at the smaller base the star rounding turned 1.20 into an effective 1.25 in week 1.

- **Opening cash, and the double-count that hid in it.** Extreme on Junction ended in week 1 in eleven runs of twelve. Neither lever was wrong on its own: Extreme cut cash 20% and raised prices 35%, but *together* they left 59% of a Standard opening, and Junction plays three tiles a week from week 1 — so the wallet bought two of them and the third action point went unspent with $48 in hand. Two fixes, one for each half. `startMoneyMult` now cuts cash far less than `costMult` raises prices (Extreme 0.9, was 0.8; Hard 0.94, was 0.85), so the two multiply to 0.67 and 0.82 of a Standard opening rather than 0.59 and 0.74. And opening cash became a level's own number, which it should always have been: it goes with action points and with prices, so Junction carries $290 for its three tiles and Metroplex $275 against its 25% price rise. Week 1 on Junction/Extreme went from **1/16 cleared at 0.77× to 16/16 at 1.36×**, the same place Terminal sits, and the level's deaths moved out to weeks 4–9 where the rest of the game's are. Sweeping the wallet either way, $260 cleared 12/16 and $320 changed nothing over $290, so $290 is the knee and not a guess.

- **Difficulty levels** (§10.1.1). Standard is the game as tuned and every lever is 1, so nothing about the existing balance moved: autoplay over `--seed0 1000` and `2000` survives 14 of 16, the same reading as before the change. Hard (9/16) and Extreme (2/16) scale the quota, prices and income on top of it. Extreme was measured twice: at `quotaMult` 1.35 / `quotaGrowthAdd` 0.03 it survived 2 of 16 but killed five runs in week 1 or 2, which tests the opening hand rather than the player. Moving the pressure off the flat multiplier and onto the growth rate (1.20 / 0.045) kept survival at 2 of 16 and the week-16 quota slightly higher (289k against 281k) while the week-1 quota dropped a star (6★ from 7★) and the worst week-1 score went from 0.62× of quota to 1.08×, so the deaths now land on the event weeks where they belong.

**Simulation**

- **A destination pick that survives a new platform.** The complaint: a bike rental dropped on an open plaza previewed at −32★, blocking nothing and bringing its own travellers. Most of that was not the tile. `chooseDest` walked the cumulative destination weights with one roll per traveller, so a new candidate changed the total and every traveller's roll landed somewhere else in the list. Measured on the bot's week-9 and week-12 boards (6 seeds, every legal spot of each probe tile, against the crowd the same board drew without it):

  | Existing crowd disturbed by one more tile | Before | After |
  |---|---|---|
  | Coffee Shop: destination changed | 0% | 0% |
  | Bike Rental: destination changed | 51% / 51% | 17% / 13% |
  | Tram Stop: destination changed | 46% / 35% | 16% / 11% |
  | Bike Rental: crowd identical in value and outcome | 13% / 17% | 26% / 35% |
  | Coffee Shop: crowd identical in value and outcome | 68% / 60% | 69% / 60% |

  Every option now rolls its own die, keyed by the tile or cell it stands for, and the smallest `-ln(u)/w` wins (`race` in `sim.js`). The exponential race draws from the same weights, but the list's length and order no longer enter into it. The residual 11–17% is the share who genuinely prefer the new platform. The same keying went on the four other picks made by indexing into a list: the door a traveller leaves by, the tie-break between two equally short steps, the platform an extra spawn arrives on, and a pickpocket's next mark. Selftest now holds a transport to the rule amenities already met — a platform in the far corner leaves every traveller who neither passes it nor boards it identical in value and outcome.

  What it did *not* fix, and should not have: on a dense board the tile's own footprint still bends paths off the chain, which is the rest of that −32★. On board 1002 the Bike Rental is negative in 86% of its 100 legal spots (24 seeds), median −3.2★, worst −42★, because a two-cell wall in the plaza cuts shop stops per traveller from 1.81 to 1.35 and the chain multiplies. Not one of those spots leaves the week alone. On the sparser board 1001 the same tile flattens out — at 6 seeds its median goes from −3.4★ to +2.3★ and its negative spots from 81% to 15%, and at 24 seeds it reads 47% negative against the Tram Stop's 2%. A tile that pays for itself nowhere on a board is a tile the board has outgrown, and the badge is right to say so.

  Balance: the landscape held (shift 1.6–3.2%, rotate 2.1–4.9%, noise 1.2–1.8%, stranding unchanged at 21–28%), and the estimate's own noise floor fell — 1.5% to 1.3% on board 1002 — because the before and after runs now stay on the same random path, which is the preview badge getting steadier. The cost is week-to-week variance: seed sd rose from 11.5–15.0% to 13.3–17.6%, since a race cannot be stratified the way one sweep per traveller was. Autoplay over `--seed0 1000` and `2000` survives 12 of 16 (was 11), week 1 clears at 1.36×/1.48× (was 1.35×/1.49×), weekly means 1.5–3.8× from week 5 (was 1.6–4.2×). The `quota` block was left alone.

- **Stratified dice kept to the questions they fit.** The complaint: on Extreme around weeks 9–12, two placements that each showed several stars on the badge came out as a week that scored less. `harness/badge.mjs` put a number on it: on the bot's week-9 and week-12 boards, a badge of a star or more turned into a losing week for 18% of placements (47 of 258) and 14% of pairs, and the week as a whole landed as much as a quarter below the badge's projection (one board: 70★ projected, 52★ run).

  Most of that is the chain, and some of it was a bug. `sim.stratify` gives every die a traveller throws the same golden-ratio step and only offsets it by the question, so any two of a slot's dice sit a fixed distance apart. That is fine where one die meets a threshold (a tier, a shop's pull). It is wrong wherever dice meet each other. In a `race` the offsets decided the winner instead of the weights: three equal platforms split a crowd anywhere from 5% to 68% by seed, where a third each is right. A waypoint's two Gaussians were built from dice on one line, so a transport's whole crowd wandered along one seed-chosen curve. Both now roll the traveller's own hashed die (`own` in `sim.js`); tier, pickpocket, a shop's pull and the loop stay stratified. The "cost in week-to-week variance" put down to the race in the entry above was this.

  Two other ways were tried and dropped. Turning stratification off altogether doubled the week's seed spread (8% to 15%) and made the badge worse. Decoupling every question, either with its own random step or with a random order within blocks of eight travellers, pushed the spread to 12–13%: the golden step across a transport's whole stream is what keeps the tier mix and each shop's serves even, and it is worth keeping where it is valid.

  Measured with `badge.mjs` on the same boards before and after (bots 1002–1006 and 1007–1011, weeks 9 and 12, 28 spots each): losing weeks behind a badge of a star or more fell from 18% to 11% (22%→15% and 14%→5% on the two sets), pairs from 14% to 8%, the mean miss from 5.4★/3.8★ to 4.6★/3.5★, and the week's own seed spread held at about 8%. What remains is the chain: a tile's footprint bends a few other travellers past more or fewer shops (±2★ a seed on board 1004), and a tick either way moves someone across the last departure (±1.5★). A tile is worth 2–5% of a week by week 9, against a seed-to-seed miss of 4–5%, so a small badge can still come out behind; the badge shows the average week, and the week is one of them.

  Balance: sensitivity on the old build's own boards (dumped, 24 seeds) held — shift 1.7/2.4/2.8% (was 1.7/2.5/2.7), rotate 2.6/2.6/3.4% (2.6/2.9/3.6), noise 0.7/0.8/1.1% (unchanged), stranding 12/29/26% (14/28/27). Autoplay on Standard over `--seed0 1000` and `2000` survives 14 of 16 (was 11), band 53%/50% (48%/55%), over 3× 4%/13% (5%/10%), median 1.95×/2.02× (1.95×/1.89×). Hard over 32 runs survives 12 (was 15; the two seed sets went 4 against 8 and 8 against 7), Extreme 2 of 16 (was 0), medians within 0.05× on every difficulty. Week 1 moved by at most 0.05× on any level. Across all 64 runs that is 28 survivals against 26, so the `quota` block was left alone. The selftest's Double Week check compared single draws, which swing by half its tolerance on their own; it now compares means over four seeds.

- **The badge quotes a range** (§12.2). After the dice fix, a badge of a star or more still came out as a losing week about one time in nine, because the week the player runs is one more draw from a spread 4–5% of the week wide, and by week 9 a tile is worth about that much. The mean hid the spread; the eight preview weeks had it all along. Over 385 random placements on the bot's week-9 and week-12 boards (bots 1002–1009), sorted by how many of the eight lost stars, the real week lost 4% of the time when none or one did, and 25–36% when two to four did — so the preview weeks predict the risk and only needed showing. The badge now runs from the second-worst to the second-best of them (`placement.rangeTrim` 1, so one freak week cannot stretch it): solid stars are the ones the whole range agrees on, hollow ones flicker. On the same placements: **with at least one solid gold star, the real week fell 4 times in 108 (4%)**; a range crossing zero, all hollow, fell 28% of the time; an all-red range fell 88%. The old single-figure badge of a star or more fell 23 times in 195 (12%). The real week lands inside the range 62% of the time (71% in whole stars), below it 14% and above it 24%. Trimming nothing would cover about 78% of weeks in theory (7 in 9, when the real week is one more draw), but the range would come out about 60% wider, and late in a run nearly every tile would read as a coin flip.

- **Placement sensitivity pass.** The complaint: one cell or one rotation could swing a tile's value by a lot, and the checkpoint was nearly always a loss by the time it appeared. Measured with `sensitivity.mjs` on three bot boards (weeks 9, 9 and 12; 24 seeds; the same boards probed by the old and new builds):

  | | Before | After |
  |---|---|---|
  | Stranded travellers | 65% / 78% / 66% | 11% / 38% / 28% |
  | Value jump, one cell over (share of week score) | 3.9% / 3.3% / 3.2% | 3.5% / 1.9% / 2.2% |
  | Value jump, rotated | 7.7% / 5.2% / 4.2% | 5.0% / 2.1% / 2.0% |
  | Estimate noise floor (24 seeds) | 2.3% / 2.3% / 2.0% | 1.0% / 1.3% / 1.2% |
  | Checkpoint: losing spots | 66% / 40% | 43% / 23% |
  | Checkpoint: rotation swing | 29★ / 22★ | 16★ / 4★ |

  Four changes, each measured on its own:

  1. **Keyed rolls instead of streams (§13.1).** The biggest source of "sensitivity" turned out not to be the board at all: any tile that changed one traveller's route shifted every later draw from the shared streams, so the whole week re-rolled and the 4-seed preview differed by ±8★ between neighbouring spots. A booth with no fence, which changes no path, had a noise floor of 1★ against 5★ for anything that did. With every roll keyed by traveller and question, a tile out of everyone's way leaves the week identical and a coffee shop in a corner touches 6–17% of travellers instead of "all of them".
  2. **Travellers mind the clock (§6.3).** Stranding was 60–80% on any shop-dense board, and each extra shop was a coin flip on whether a traveller's whole chain halved. Now no one takes a detour they can't make the platform from, and a wander that no longer fits is dropped. Amenity-chain layout: stranding 59% → 19%, score +11%; transport-heavy layout: 11% → 1%, +5%. A slack of 1–2 ticks strands less still but scores less (fewer stops), so it is 0. The bot's boards score about 8% more, which is the quota base going from 5,000 to 5,400.
  3. **One die per traveller and shop (§6.4)** — the same odds as a roll per cell, but a nudge sideways doesn't re-decide, and `sim.stratify` spreads a transport's throws evenly. Seed spread on one board fell from 21% to 16%; on another it did not move, so this is a small gain kept because it is three lines.
  4. **The preview uses the mean of 8 seeds** (was the midpoint of 4), with the "without" runs cached, so it costs the same as before per hover.

  What did *not* help: a per-traveller shopping threshold (one die for every shop) makes chains all-or-nothing and raises variance, and stratifying alone did nothing to the p10–p90 band on the test layouts. Remaining week-to-week spread (10–16% of the score) is the chain itself: a $$$$ traveller with four ×2–3 stops is worth a tenth of the week, and the top 5% of travellers carry about 22% of the points.

- **Deleting and rezoning cost no AP** (§4.1). Undoing a mistake used to cost the whole week's second action; now it costs the money already spent. The bot given a free delete prunes a tile whose removal scores better about once a run.
- **Week length** is 24 ticks (16 + 8 cleanup), not 20.
- **$ stop budget is 3** (as originally designed). At some point it had been raised to 7 with no recorded reason, which gave $ travellers more stops than $$–$$$$ and meant their budget never ran out. At 3, about half of $ travellers use every stop. On shop-dense test boards scores drop 4–6%; transport-heavy boards are unaffected. Bot survival went from 13/16 to 10/16 over two seed sets. The score/quota band held, and deaths still land on event weeks, so the quota was left alone.
- **Last-call departure:** every transport fires a final departure on the last tick. Without it, a cadence-8 ferry stranded 70% of its passengers.
- **Same-tile trips** take a wander instead of standing still.
- **Travellers step inside** an amenity for the service duration instead of pausing beside it.
- **Lost travellers.** Sealing a transport into an amenity pocket used to be the strongest play on the board (+33% score on a test layout), because it turned every walk into a guaranteed round trip. Travellers with no route to their platform now bank nothing, and the same play costs about 14%.
- **Amenities only pull travellers who can reach their door.**

**Modes**

- **Levels re-time the run** (§10.1). Three data fields — `minWeek` per tile, a `run` block over `CONFIG.run`, and `startTiles` — let a mode move the weeks tiles go on sale, the event and milestone weeks, and what the board starts with. Terminal overrides nothing, so the baseline game is untouched: the same 16 autoplay runs survive 14 of 16, and `sensitivity.mjs --bot 1000 --week 9 --seeds 24` reads shift 1.9%, rotate 2.0%, noise 0.9% and stranded 13%, all as recorded in §14.2. The only piece the simulator needed was the crime-wave week, which travels as a modifier (`pickpocketsFromWeek`) rather than as a mode, so the sim still knows nothing about levels and the preview cache keys on it.
- **Sky Harbour starts as an airport.** The level was "Terminal with two terrains banned"; it now opens with the north edge as apron, the south as road and a Security Checkpoint already built at (6,5)–(6,6), whose fence spans the board while the board is empty. Aircraft and security tiles go on sale in weeks 2–6 rather than 5–10, and the crime wave starts at week 5. The fence is what the level is for: with the apron on one side and the road on the other, most travellers cross the booth, so its ×1.3 is closer to a standing rule than to a placement gamble.
- **Sky Harbour is 8x16 now, not 12x12.** The checkpoint was a line across a square board, which made it a wall you built round. Cut the board to 8 wide and 16 tall with the airfield at one end and the road at the other, and the fence at y=8 splits it into an 8x8 airside and an 8x8 landside — two Junction-sized stations that have to be built one after the other, with every traveller walking through the booth between them. The crime wave moved with it, from week 5 to week 3, over a six-week ramp instead of three: pickpockets are the level's signature, so they should be there while you are still deciding where the security goes, but full strength on a five-tile board is not a decision, it is a tax. Measured over 16 runs (`--seed0 1000` and `2000`): 13 of 16 surviving before, 11 after, with mean score/quota 2.3–3.2× from week 5 — inside Terminal's band, so the quota block was left alone. The 8-wide board also makes the fence harder to shorten by accident: eight panels instead of twelve, and the split stays the level's shape all run.
- **Waterfront and Sky Harbour sell their own starter transport.** Both levels opened by building the road they are not about, because the water catalogue started at a $200 Ferry Terminal and the airfield at a $400 Jetway while a $50 Parking Lot sat in the same shop. Each level now has a cheap tier-1 pair of its own — Water Bus Stop and Pontoon Moorings, Prop Plane Stand and Hardstand — carrying the Bus Stop's and the Parking Lot's numbers to the digit, sold on that level and nowhere else (`modes` in `data/tiles.js`), from week 1, and dealt in the opening hand (`mode.week1`). They also introduced the **reach** rule (§3.2): a small boat or a light aircraft sits up to 2–3 squares inland on a jetty or a taxiway, the way a bus stop sits inland on a driveway, so the shore is not the only place to build. On `tierboard.mjs` the four read 19–60★ per $100 against the Parking Lot's 34 and the Bus Stop's 19 — the water pair leads the field because Waterfront also discounts water by 40%, which is the level's own lever and was left alone. Waterfront went from 11 of 16 runs surviving to 13; Terminal, which sells none of them, stayed at 11.
- **The other levels got a clock of their own.** Junction runs an event every third week with ordinances at 4/9/15, the crime wave at 5, rares at 8 and Extra Shift at 12, plus tunnels early; Metroplex slows all of that down and puts the six-cell tiles on sale from week 3; Waterfront sells boats from week 1; Terminus gets rares at 8 and Extra Shift at week 8 for $320. Junction was the one §16 called out as "trivial early, brutal late": autoplay over `--seed0 1000` and `2000` goes from 12 of 16 surviving (deaths in weeks 12, 16, 16 and 16) to 14 of 16 (deaths in week 12 twice), and the week-16 score/quota band from 2.3× to 3.4–4.8×, so the earlier tools do more for it than the extra event weeks take away, and it now sits where Terminal does instead of dying to the same late cliff every run. Every level was measured the same way, before and after, in §10.1: Waterfront 12 → 14 of 16, Terminus 10 → 12, Sky Harbour 14 → 15, Metroplex 11 → 10. Terminal is unchanged at 14 of 16, so the quota block was left alone.

**The opening and the band**

- **Week 1 was the loosest week in the game.** Measured over 30–40 seeds a level, the greedy bot cleared it by 1.7–3.9× on the four two-action levels, 3.3–5.5× on Junction and 0.95–1.8× on Terminus — the only level near a sane target, and it got there by accident. Two causes. One roll of an empty board decided most of it: the same hand is most of week 1's variance when there is nothing else on the board. And one flat 5★ target was asked of a level with one action point and one with three. So:
  - `shop.week1.fixed` deals a Parking Lot (a Bus Stop until the swap below) and a Burger Joint to every run before the three rolled cards. Week 1's spread (p90/p10) falls from 1.84 to 1.43; pinning all five cards would take it to 1.34, which was measured and not taken — it makes week 1 the same puzzle every run.
  - `mode.quotaMult` scales a level's whole curve: Junction 2.0, Terminus 0.52.
  - The base target is 11,000 (was 5,400).

  Past week 1 a level drifts at its own rate, so the multiplier alone does not hold it: Junction's 2.0 was right for week 1 and far too much by week 7 (a 9×9 board cannot hold a three-action lead as it fills), so it settles at 1.7 with the standard late growth, and Terminus takes 1.17 growth on top of its 0.52 to stop its late weeks drifting to 4.3× quota. Junction also gave up the three-week event clock it had been given: five event weeks against a tight band killed six of twelve runs on week 6 alone.

  Week 1 then reads, 40 seeds a level: Terminal p10 1.15 / p50 1.34 / p90 1.74 (98% inside 1–2×), Junction 1.04 / 1.31 / 1.54 (95%), Metroplex 1.08 / 1.37 / 1.60 (93%), Waterfront 1.11 / 1.34 / 1.74 (98%), Sky Harbour 1.18 / 1.46 / 1.80 (98%), Terminus 1.06 / 1.50 / 1.53 (100%).

- **The early growth had to come down to pay for it** (1.25, was 1.80; decay 0.70, was 0.675). Doubling the whole curve instead killed three runs in four between weeks 8 and 13: the board cannot grow that fast on what a week pays, and neither a 43% income rise (3/12 → 4/12 survived) nor softer events (3/12) bought the runs back. Event weeks now lean half as hard (`quota.eventStrength` 0.5) for the same reason — with the slack gone, a ×1.8 week is a wipe rather than a test.

- **A run that runs away is measured against itself.** `quota.catchUp`: the target is at least 0.72 of the player's best week so far, capped at 2.2× that week's own curve, and it takes no event multiplier on top (the curve already carries one). Two failures on the way there, both measured: with the event multiplier stacked on the floor, every one of 12 runs died, eight on the same event week; uncapped, a single spike week set a target the next week could not match (11 of 12 dead by week 8). On Terminal, 12 runs to week 16: weeks inside 1–2× go from 19% to 37%, the median week from 2.90× to 2.36×, survival 9/12 → 8/12.

  The rest of the trade was measured and left on the table, because it costs survival almost exactly as fast as it buys band: catch-up 0.9 gives 47% inside the band at 6/12 survived, and a steep curve with catch-up 0.7 gives 61% at 1/12. The quota is a pass/fail line, so parking it just under typical play means any bad week ends the run. Getting a 1.2–1.5 modal band *and* keeping runs alive needs something that absorbs one bad week — a banked surplus, or strikes — which is not built (§16).

- **The UI smoke test needed a better bot before week 1 could bite.** Its throwaway autoplayer bought by kind (alternate transport and shop, first affordable card of each) and only chose *where* by estimate. On the pinned seed that scores 0.96× in week 1 — it had been living on the grace week. Picking the best (card, spot) pair instead, over the same sample of spots, puts it at 1.41× and it never drops below that to week 16.

- **Week 1 was briefly a practice run** — a `run.graceWeeks` lever that let a missed week 1 carry on — and it is gone again. It answered a worry rather than a measurement: with the fixed opening hand, the greedy bot loses week 1 in 6 of 240 runs (40 seeds a level: Metroplex 3, Terminal, Junction and Waterfront 1 each, Sky Harbour and Terminus none). A rule that fires that rarely for a competent player is one more thing to explain on the summary screen, and it softened the one week the fixed hand was added to make fair. A careless opening does now lose the run; that is the same deal every other week offers.

**Tiles**

- **Lounges** stack at 0.24 (Club 0.38, $$$+ only; Chrono 0.43) with radius 3. At the document's 0.10 and radius 2, a Waiting Area was a dead block: median marginal value 164 points, negative in 43% of placements. Making lounges walk-through removed the last of the downside (median 2,933, never negative).
- **Green Space** is walk-through and serves travellers crossing it. Its median marginal value at week 6 rose from 1,545 to 2,307, and the share of negative placements fell from 15% to 1%.
- **WiFi Hotspot** boosts everything in range and is walk-through. It used to be a solid one-cell wall that only raised shop pull, pulling travellers into detours they had no time for: negative in 47% of placements, median +52 points. Walkability alone makes it exactly neutral; the boosts make it never negative, with a median of +2,720.
- **Moving Walkway** riders still roll for service. Suppressing rolls made the tile that *attracts* paths also cancel them, and it was negative in 36% of placements.
- **The Parking Lot is walk-through**, and the four flattest tiles are drawn flat. A car park you have to walk round is a wall in the shape of a car park, which reads wrong next to the Green Space beside it. It now shares the walk-through flag, and it, the Green Space, the Waiting Area and the WiFi Hotspot are `ground` tiles with no height, painted under the crowd instead of standing 0.10 proud of it (§13.2). Measured: `marginal.mjs --week 6 --seeds 12` puts the Parking Lot at 45.4★/$100 against 45.7 before, and every other tile is identical, so walkability is worth nothing by itself — it buys freedom of placement. Autoplay over `--seed0 1000` and `2000` survives 14 of 16 both ways (deaths in weeks 8 and 16, and 12, before; in 12 and 12 after), and the score/quota band did not move, so the quota was left alone. On the one board probed under both builds (the bot's week-12 board 1002, dumped, 24 seeds) the landscape got slightly smoother: one-cell shift 3.4% → 2.9% of the week, rotation 3.1% → 2.9%, noise floor 2.0% → 1.8%, stranded 26% → 22%. The new build's own bot boards read shift 1.9%/1.8%/3.3%, rotate 2.0%/1.8%/3.3%, noise 0.9%/1.1%/1.7% and stranded 13%/23%/22% on boards 1000 and 1001 at week 9 and 1002 at week 12, all inside the bands in §14.2.

- **Corridor lanes** are walkable (a lift could otherwise fence the board in two — this retired the *Open Borders* ordinance in favour of *Wayfinding Signs*). They follow the tile's long axis and are freed on delete.
- **Long vehicles berth edgewise; jetways attach by the tip; the ferry ties up broadside.** The Ferry Terminal was the last transport that could nose into the water with one cell of its L, which read as a jetty rather than a berth. It now takes the mirror of the jetway rule (`attach: 'broadside'`, §3.2): the L's three-cell side lies along the edge and the foot points inland, so two of the eight orientations reach any one edge. It costs the ferry six of its eight orientations and nothing else — autoplay over `--seed0 1000` and `2000` reads 5/8 and 7/8 survived, the same runs and the same death weeks (1, 16, 1 and 8) as the build before it.
- **The underground layer** (§3.5) was added with four tiles. Priced from `marginal.mjs` on the standard boards: at week 6 Underground Parking is 14.2★/$100 (between the Bus Stop at 19.0 and the Coffee Shop at 13.5, and well under the Parking Lot's 32.9, which is the price of going anywhere with no driveway), the Subway Station 11.8 and the Express Subway 6.8 (the mid-game transport band); at week 10 they read 9.4, 9.3 and 4.7. The Submarine Dock, probed on a week-8 board with a ferry edge, is 2.65★/$100 at its best spot (median +8.6k, never negative), between the Helipad's 2.54 and the Marina's 1.99. Autoplay over `--seed0 1000` and `2000` survived 13 of 16 runs (10 of 16 before); the quota curve was left alone, since the bot's mean score/quota band (1.5–3.8×) did not move.
- **One-square shops** (§8.2). Junction's 9x9 and Sky Harbour's 8x8 halves have room for the numbers but not for the footprints, so the catalogue got four I1 shops: Pocket Park (Green Space on one square), Coffee Cart, Souvenir Cart and Cash Machine. They were dealt at their first-draft values and measured on `tierboard.mjs`, where they came in at 6–11★ per $100 against a field of 13–21 — weak enough that four more of them in the shop pool cost Terminal three runs in sixteen, which is what a diluted shop looks like. Raised to 14–19 (radius +1 each, flat and mult up, prices down $2–4) and Terminal came back to 11 of 16, inside the noise of the 12 it started at; Junction, the level they were aimed at, read 10 of 16 before and 9 after. The target they are tuned to: clearly less per tile than the full-size version, and slightly less per dollar, so the big one is still the better buy wherever there is room. The Cash Machine is deliberately outside that rule — 10.9★ per $100 but $39 a week on one square, the best revenue per cell in the catalogue — which is why `tierboard.mjs` now reports cash beside points.
- **Bridge** is implemented but pulled from the shop.
- **Information Kiosks** no longer reduce pickpocket spawns.

**Cards**

- **Coupon Book** was two weeks of double crowd for $30, and graded 160★ per $100 on `tierboard.mjs` — five times the best tile and nearly three times the next card. Its stated cost, half fares, is not a cost: fares are scaled to 35% and the extra crowd shops as well, so the bench week ended $89 *up*. On the bot's own boards the card is worth whatever serving headroom is left, which is most of why the bench understates it: at week 5 it added 50%, 524% and 214% of the quota on boards 1000, 1001 and 1002, at week 13 12%, 118% and 57%, and on the crowded week-9 board 1001 it *cost* 40% of the quota, because twice the crowd strands. It now runs one week at $60 and halves shop takings alongside fares (`revenueMult: 0.5`): 24.1★ at 40.1 per $100, third in S under Charter Bus at 57.8 — the other card that buys a crowd — and the bench week ends $2 down in cash instead of $89 up. The batch multiplier stays at ×2 rather than a fraction because batches are small integers and rounded, so ×1.25 and ×1.5 are both +50% on a Parking Lot's batch of 2. The greedy bot never plays the card (`bot.mjs` plays only Overtime, Fast Pass and Charter Bus), so autoplay is unmoved: `--seed0 1000` survives 4 of 8 with deaths in weeks 1, 16, 1 and 8, the same runs before and after. Every other row of the tier list is identical and no grade moved.

**Interface**

- **Redo Week, on Standard only** (§10.1.1, §12.1). A week's opening state is kept as the same JSON the save uses (`weekStart`), and a button restores it: board, cash, action points, shop and effects. It is offered under the timeline from the first move of the week — worked out by comparing the state against that snapshot, so it appears on the first move and not before — and under the big Run Week button once every point is spent. Hard and Extreme keep no snapshot, so there is nothing to restore and nothing to show. Nothing in the simulator changed: the button only ever puts back a state the run had already produced. `SAVE_VERSION` went to 6 for the new field.
- **The world around the board got its geography straight** (§13.2): a railway that meets the sea turns the corner on a proper quarter-ring bend and follows the shore — the first cut mitred the two straight strips together, which left a notch and a stub of track pointing into the water — a subway carries on past the edge instead of stopping at a portal, an airfield edge is three squares deep with a marked runway, and the Moving Walkway joined the `ground` tiles so a belt no longer stands 0.08 proud of the floor it is part of. All four are drawing only — no tile data the simulator reads changed, and the same autoplay runs survive on the same weeks.

**Security**

- **Security Checkpoint (was Security Gate).** The gate was an I4 wall with one gap that only mattered if the player walled off the rest of the board themselves. It became a 2-cell booth whose fence runs edge to edge between cells. Options were compared on the week-10 test board (189 legal placements):

  | Clearing the booth gives | Best spot | Median | Negative |
  |---|---|---|---|
  | +2 stop budget only (old rule) | +3.0k | −4.4k | 82% |
  | ×1.15 value | +6.2k | −2.7k | 71% |
  | **×1.3 value (chosen)** | **+9.3k** | **−1.2k** | **58%** |
  | ×1.5 value | +13.5k | +0.3k | 48% |
  | ×1.3, destination-filtered crossing | +5.6k | −2.9k | 76% |

  The size of the budget bonus made no difference at all, because budgets rarely run out. A full row of wall cells was ruled out without testing: it costs a whole row of floor and is nearly impossible to fit on a built-up board.

- **The fence stops at buildings, and the bonus applies at boarding.** On the bot's week-9 boards the edge-to-edge fence lost points in 64–86% of spots and a rotation swung the value by 25–35★, because on a built-up board the line always cut some crowd off from its shops. Compared, 12 seeds, board 1000 (base 149★): edge-to-edge 64% losing, median −1.8★; fence to the first building on either side (`'walls'`) 35–41%, median +0.3 to +0.7★; a fixed 3 cells each way 43%; a booth that *attracts* passers-by within 3 cells instead of fencing (a detour like a shop's) 44–86% losing, since a ×1.3 detour is worth less than the shop it displaces. Board 1001: walls 14% losing, median +9★. `'walls'` was chosen. Applying the ×1.3 at boarding rather than at the crossing (`atExit`) changed the medians by under 1★ but is kept: a traveller crosses early with a chain of 100–200 points, so a multiplier there is worth a tenth of the same multiplier on the finished chain, and the booth's value now depends on how many cross rather than on where along the route it stands.

- **The fence runs past a building it only skirts** (`sim.checkpoint.fence: 'split'`, was `'walls'`), **and the booth pays ×1.5** (was ×1.3). Stopping at the first solid cell beside the line made the best booth the one with no fence at all: on the bot's week-9 board 1001, 23 of 94 legal spots raised no panel and were worth a median +9★, a free ×1.3 for tucking the booth against two buildings, while every spot whose fence actually spanned something was worth less. The fence now ends only where one tile fills both sides of the line — where it would cut that tile in half, as through the middle of a 2×2 — so a wall it runs alongside, or two walls meeting along it, no longer end it, and a fence shortens when you build *across* the line rather than beside it. Measured with `sensitivity.mjs`, 24 seeds, boards 1000/1001/1002, old → new on the checkpoint row: best spot 15.8/41.7/20.7★ → 18.9/46.9/23.7★, median 1.2/3.0/6.6★ → 1.2/0.3/1.1★, losing spots 7/12/1% → 11/46/44%, one-cell jump 1.2/2.2/2.5★ → 1.9/5.8/7.5★ and rotation 1.5/2.4/2.6★ → 2.4/9.3/10.7★. The noise floor (0.9–1.1%) and stranding (11/30/25%) did not move, so the roughness is the fence and not a broken roll. That is a tile that has to be placed now, which is what it is for; ×1.5 is what pays for the risk. It is the value the original pass measured at +13.5k best, +0.3k median, 48% losing and passed over for ×1.3 (above) — with the long fence it restores the upper half of the landscape rather than lifting the ceiling: on board 1001 the p90 spot reads 19.3★ before and 19.0★ at ×1.45, on board 1002 14.8★ before and 14.6★ at ×1.6, so 1.5 splits them; the median spot stays near zero, because a booth nobody crosses is worth nothing whatever the multiplier. Autoplay `--runs 8 --weeks 16` over `--seed0 1000` and `2000`: 11 of 16 survive (was 10), band 48–55% (was 48–54%), over 3× 3–7% (was 3–6%), median week 1.8–2.0× and week 1 at 1.48×/1.55× unchanged. The `quota` block was left alone.

- **Sky Harbour carries `quotaMult: 1.05`** (was 1) because of the above. It is the one level built around a checkpoint — every run starts with one, and its fence now holds the waist all run instead of opening up as the board fills — so the whole level scored more. Over 12 runs to week 16, as band / over 3× / median / survived: 61% / 4% / 1.78× / 8 before, 47% / 5% / 2.04× / 9 after the fence change, 50% / 4% / 1.94× / 9 with `quotaMult: 1.05` and 56% / 5% / 1.84× / 6 with 1.10. The 5% bump takes the edge off the weeks without costing a run; 10% buys the old band back and pays two runs for it, which is the trade the band and survival always make (§14.2). A second seed set (`--seed0 3000`) reads 44% / 5% / 2.02× / 6 at 1.05, so 12 runs is about ±3 survivors' worth of noise and the level is left a little hotter than it was. Week 1 is unmoved on Standard (1.55×, 16 of 16 seeds clear) and 1.24× on Hard and Extreme, still clearing 16 of 16.

- **A walled-in cell is not a door.** The complaint: a Helipad one cell to the left of another spot showed +33★ against +3★, though it blocked the same routes. The cause was in the door rule, not the routes. A platform's doors were every walkable cell touching it, and whether its travellers could reach their platform was judged from the *first* of them. A placement that walls in a single cell beside a platform (a tile on two sides of a corner, say) left that cell a door; when it happened to be the first, every traveller from that platform was lost, and either way a share of them spawned in the pocket and never walked. On the week-9 bot board 1000 a Helipad at (5,3) cost 1.5★ and at (5,4) cost 52★ with 13 travellers lost per week, and the preview could not name it, since the cut-off warning already judged reachability from any door. Now a platform's travellers step out of the doors that lead somewhere (§3.4), each by a door that reaches their own platform, lost is judged from that door, and a shop's door in a pocket is not a way in (it used to count as a zero-length walk back to a platform on the far side). Measured with `sensitivity.mjs` (24 seeds, the same three boards as the placement pass): the untouched boards score identically; the worst spot for an ordinary shop went from −51/−58/−59★ to −25/−38/−38★ on board 1000 and −40/−43/−41★ to −19/−19/−17★ on board 1001; the Helipad's from −50★ to −34★ and the Tram Stop's from −20★ to −8★; the one-cell shift jump 3.5% → 3.0% and 1.9% → 1.7% of the week, the rotation jump 4.3% → 3.7% and 1.8% → 1.7%, the noise floor unchanged at 1.1–1.4%. The week-12 board (1002) hardly moved (worst −12★ → −9★). Helipad (5,4) on board 1000 still costs 36★ against 1.5★ at (5,3), and that one is real: the cell it fills is the only passage between the two west platforms and the shop cluster, and stops per traveller fall from 2.0 to 1.5. Autoplay over `--seed0 1000` and `2000` survives 14 of 16 before and after (deaths in weeks 8 and 12 before, 8 and 16 after), so the quota curve was left alone.
- **The crime wave** starts at week 7 (was 8) and ramps over three weeks. The Security Guard was added as a cheap one-cell counter, and the Security Station is no longer forced into the week-7 shop.
- **Events:** Inspection restricts to 70% (was a full closure at ×1.4 quota); Strike falls back to a skeleton service on one-terrain boards.

- **The week-1 fixed transport is the Parking Lot** (was the Bus Stop). It is $50 against $60, brings far fewer people (arr 1, batch 2 against 4 and 5) and carries a much larger flat (30 against 12), and it is walkable ground, so the opening tile shapes paths instead of blocking them. Measured on Terminal, week 1 only, 80 runs (`--seed0 1000` and `5000`, 40 each, A/B with `--set shop.week1.fixed.0=`): mean score/quota 1.43 and 1.52 with the Parking Lot against 1.41 and 1.53 with the Bus Stop, and 76 of 80 runs cleared week 1 against 79 of 80. Full runs, `--runs 8 --weeks 16`: `--seed0 1000` 5 of 8 (deaths in weeks 1, 1, 16) against 6 of 8 (weeks 10, 12), `--seed0 2000` 7 of 8 (week 8) against 8 of 8. So the mean opening is unchanged and the floor is a little lower: the Parking Lot's small batch leaves a bad roll of the other three cards with less to work with. The quota block was left alone; if week-1 deaths climb past a few percent, `quota.base` is the dial, not this tile.

- **A delete hands its action point back, if the tile was bought this week** (§10.1). Deleting already cost nothing, but the point spent *placing* the tile stayed spent, so pulling a bad spot and rebuilding it took both of a Terminal week's two moves — which made the delete button nearly worthless in practice, and contradicted what this section already claimed the rule was. `buyTile` now records the week on the tile and `deleteTile` returns the point when it is the current one (`economy.deleteRefundsAP`). An older tile gives nothing back, since that would be a free move rather than an undo, and no money is ever refunded, so churning a spot is paid for every time. It does not move the balance: `autoplay.js --runs 8 --weeks 16` reads 4 of 8 surviving on `--seed0 1000` (deaths in weeks 1, 1, 8, 16, week-1 mean 1.35×) and 7 of 8 on `--seed0 2000` (week 8, mean 1.49×) — the §14.2 numbers to the digit, because the greedy bot deletes roughly once in 60 weeks and hardly ever a tile from the same week. `SAVE_VERSION` went to 8 for the new tile field.

- **The week line colours by what is on the board, not only by what has boarded** (§12.3). Points are banked at the turnstile, and travellers only start boarding once they have crossed the concourse, so the running score sits near zero for the first two thirds of the week: on bot board 1001 at week 9 (final 2.06× the quota) the old ratio read 0.02× at tick 6, 0.07× at tick 12 and 0.21× at tick 17 of 24, which is dark red for seventeen ticks and then a jump to gold. The line now reads `scoreByTick[t] + pendingByTick[t]`, the new array being the value standing on the board that tick (§12.3): the same board reads 0.21× at tick 6, 0.67× at 12, 1.09× at 16, and still lands on 2.06×. Because boarding shifts a traveller from the pending side of the sum to the banked side at the same value, the line climbs and does not over-promise: over 144 runs (6 bot boards × weeks 3, 6, 9, 13 × 6 seeds) it peaks at most 0.10× the quota above where the week finishes (mean 0.01×), and the worst single-tick backslide — travellers running out of clock, or robbed — is 0.07× the quota. A board that fails still reads dark red all week (board 1000 at week 12 tops out at 0.17×). The white flash is unchanged: it fires on the banked score alone, when the quota is really met, and the stars still fill on banked points. The clock-out test uses the walk straight to the platform out of the memoised distance field (one array lookup, not the traveller's remaining route), which costs about 5% of a week's sim on a busy board; the sim is otherwise untouched, and a hash of every other result field over 24 board/seed pairs is identical before and after.

- **Five new events, and the Strike stops asking** (§9). The catalogue went from nine events to fourteen: three money weeks (Back Taxes, Use It or Lose It, Emergency Budget), a Crime Spree and a Double Week. Four notes on the build, each of which cost a measurement to get right:

  - **The Double Week is two weeks, not one long one.** The first build set `ticks: 48, spawnTicks: 32`, which is the obvious reading of "twice the week" and the wrong one. Measured on the bot's boards, it scored ×2.62 at week 8, ×3.82 at week 12 and ×3.74 at week 16 — superlinear, and by a margin that depends on the board, because the clock and not the stop budget is what caps most travellers' chains (§14.2), so doubling the clock lets everyone shop far more rather than simply arriving twice. A flat quota multiplier cannot price that. Running the week twice over and adding the two (`simulateWeeks`, two separate sims stitched end to end) reads ×2.01 on every board at every week, so the target is a flat ×2. The stitching keeps ids, per-tick arrays and tile occupancy straight through, which is what lets the playback run both weeks without the UI knowing.
  - **An `exact` quota multiplier bypasses `eventStrength` — and the catch-up floor.** Softened, a Double Week's ×2 reads ×1.30 against a score that doubles, which is a free week. Left out of the floor (§5.2) it was still a free-ish one: the curve doubled while the floor stood still, so on a strong run — the only kind the floor binds on — nothing bound, and two of eight runs turned in 3.31× and 4.15× weeks against neighbours of 2.3–2.9×. With the floor scaled by the exact multiplier the same two weeks read 2.73× and 2.85×, sitting with their neighbours and a little above, which is the extra action point earning its keep.
  - **The Crime Spree is gated to week 7.** Pickpockets at 28% of spawns made week 8 3.4× as hard as a normal week — the rate was swept and landed at 10%, twice the crime wave's settled 5%: 1.42× as hard at week 8 and 1.01× at weeks 12 and 16, the fall being the security tiles the later boards have bought. The event is held back until `pickpocketsFromWeek` because the Security Station and Guard go on sale in that same week; before it there is no counter on any shop roll, and a gated event hands the week to the next one in the plan (`after`).
  - **The money weeks take a ×1 quota, not a discount.** They were first written at ×0.9 on the reasoning that every other disruptive event gets an apology. But the apology is for traffic taken off the board, and these take none: they score exactly a quiet week. At ×0.9 they were a free pass — the Standard survival reading went 10/16 → 12/16 with the over-3× share 3–6% → 7–8%, for weeks that are not harder at all. At ×1 the bill is simply in the other currency, and lands on the weeks that come after.

  **Measured, Terminal, `--runs 8 --weeks 16` on `--seed0 1000` and `2000`:** survival 5/8 and 7/8 (was 5/8 and 5/8), band 48% and 57% (was 48% and 54%), over 3× 5% and 8% (was 3% and 6%), median 1.98× and 1.85× (was 2.00× and 1.82×). Hard 4/8 (was 3/8), Extreme 0/8 (was 0/8, deaths in weeks 1–9 either way). `week1.mjs` is unchanged to the digit on all six levels and three difficulties, since week 1 is never an event week. `sensitivity.mjs` on the bot's boards 1000/1001 at week 9 and 1002 at week 12, 24 seeds: shift 1.2–2.1%, rotate 1.3–2.3%, noise 0.7–1.0%, stranded 12–27% — the noise floor is the number that matters and it held, which is what says no roll stopped being keyed by traveller and question. The quota block was left alone: the drift is inside the spread of two eight-run samples, and it is the event mix that moved, not the curve. `SAVE_VERSION` went to 10 for `weekCash` and `cashSwept`, and because an old event plan names weeks that no longer line up.

- **The Strike is rolled, not chosen.** The player used to pick which transport terrain walked out, which meant picking the one that cost least: a walkout you choose is a formality. The union picks now — a roll keyed by seed and week over the terrains standing on the board, frozen into the run state as the week opens so that building a second terrain mid-week cannot move the walkout onto it, and so that taking the week back lands on the same one. It makes the event bite: 1.12× as hard at week 8, 1.27× at week 12 and 1.03× at week 16, against a 0.9–1.6× band, where before a careful player could hold it near 0.9×. The skeleton-service rule for a one-terrain board is untouched, and is what keeps the roll from ever being a zero-score week.

- **Redo Week leaves the screen the moment the week runs.** Starting a week redrew the top bar, the shop and the board but not the side panel, so the offer under the timeline stayed up through the playback, the summary and a lost run: a take-back that clicked to nothing, since `weekTouched` is false outside the shop phase. `startWeek` rebuilds the side panel now, which is what §10.1.1 always said happened.


- **Extra hours: cash buys an action point once the week's are spent** (§4.1). A playtest on Extreme found cash boosts not worth taking: points win the run and money only buys tiles, which two action points a week can only place so fast. The bot agreed: on Standard it held $3,300 unspent by week 7, $12,400 by week 13 and $18,000 by week 15, where a tile costs $100–900. Even Extreme carried $500–800 through the middle weeks. Cash had nothing left to buy, so Retail Compact, the Cash Machine and every other till tile were selling score for nothing (Retail Compact grades D in `tier-list.md` for exactly that). The fix gives cash a use rather than reworking each boost: once the points are spent, pay `$40 × 1.25^(week − 1)` for one more, and each more that week at 3× the last. The price climbs with the week so it stays a real cost, and the step bounds a full till to a move or two. It is the reverse of the early-finish bonus, and always dearer than that pays, so the two cannot be looped.

  Measured, Terminal, `--runs 8 --weeks 16` on `--seed0 1000` and `2000`, before → after, as survived / band / over 3× / median:

  | | Before | ×2 step, from week 1 | ×3 step, from week 4 (built) |
  |---|---|---|---|
  | Standard | 14/16 · 50–53% · 4–13% · 1.95–2.02× | 16/16 · 27–43% · 10–16% · 2.10–2.35× | 14/16 · 39–41% · 10–13% · 2.19–2.23× |
  | Hard | 6/16 · 66–68% · 0–2% · 1.69–1.74× | 10/16 · 65–68% · 0–3% · 1.70–1.79× | 7/16 · 54–66% · 1–11% · 1.64–1.93× |
  | Extreme | 5/16 · 80–81% · 0–1% · 1.47× | 4/16 · 77–79% · 0–1% · 1.47–1.54× | 4/16 · 78–79% · 0–1% · 1.47–1.54× |

  The first build, from week 1 at ×2, let Standard's opening change buy a third tile: `week1.mjs` read Terminal Standard at 2.06× quota against 1.50×, with 2.8 tiles placed, and Junction and Sky Harbour moved the same way. Extreme did not move, since it has no change left after the opening hand. Opening at week 4 leaves week 1 as it was. At ×3 the bot buys 0.3–0.8 hours a week from week 4 to 13 on every difficulty and almost none past 16, where the price outruns income. Standard's band still slipped by about ten points and its median rose by 0.2×. That is the rich difficulty getting a use for its money. The `quota` block was left alone, because it is shared, and raising it to take Standard back would also have raised Extreme, which the playtest called right. If Standard needs pulling back, a `quotaMult` on Standard in `data/difficulties.js` is the lever. Terminus does not sell hours (one move a week is the level), and `SAVE_VERSION` went to 11 for `hoursBought`.

- **The quota climbs faster after the win** (`quota.endless`, §5.2). The same playtest found the game eased off once week 16 was cleared. The settled 1.10 growth ran on unchanged, and a full board keeps pace with that for a long time: the bot's winning runs on Standard held 1.7–2.0× quota through week 21 and 1.4× at week 24, and 5 of 14 lasted to week 30. The two options were a steeper curve all run (easier middle, harder end) or a ramp that starts only after the win. The ramp was chosen, because it leaves weeks 1–16, which the playtest was happy with, exactly as they were. Each week past 16 now adds 0.015 more to the growth rate than the one before. To week 30, `--seed0 1000` and `2000`, runs that reached week 16, before → after: Standard ended in weeks 20–28 with 5 of 14 lasting to 30, and now ends in weeks 20–29 with 1 of 14 lasting; the mean week-24 ratio (seed set 1000) went 1.45× → 1.26×. Hard ended between weeks 16 and 30, and now between 16 and 27. 0.02 and 0.025 were priced but not run: they move week 28 from 493k to 675k and 914k, which would put the wall at week 24 or so for everyone. 0.015 keeps a strong run going into its late twenties.

- **The side a transport attaches by is the player's** (§3.2). A corner berth used to claim both edges it touched, and a road tile, garage or lift always took the nearest edge, so there was no way to tuck a Parking Lot into a corner without claiming the side you wanted to keep. Each check now lists the edges it could use, and **⇄** or **E** cycles them. A corner berth attaches by one side and locks only that one. By default it prefers an edge that is already its terrain, so a corner no longer locks a second side unasked. The selftests that required a corner berth to fail were rewritten to require it to claim one edge.

- **Weather: four fronts that slip the timetable** (§9, §4.3). The ask was weather weeks that make travellers sit around longer, with fewer of them if the numbers called for it. The first build added dwell per terrain (and a ground stop that held every departure until tick 12), and `eventprice.mjs` priced all four at 0.97–1.01 of a quiet week. On a real board almost nobody reaches a platform before tick 19: the hurry rule sends them there, and the last call boards whoever is waiting, so extra dwell only postpones a departure that was coming at tick 24 anyway. Even a 12-tick ground stop left the selftest board's score unchanged to the point. What bites is moving the end of the week, so a front now slips a platform's whole timetable, last call included, and its travellers' hurry and strand checks read that later deadline. The week runs until the latest deadline; everyone else settles at 24 as before, and with no weather the sim is identical (four fixed layouts at weeks 4, 9 and 14, 30 seeds, same output).

  That linger turned out to be worth more than it cost. With the crowd at ×0.8, which the rounding leaves at two on the cheap transports, Snowstorm and Heavy Rain scored 1.17–1.28× a quiet week. At ×0.6 they score 0.83–0.97×, and with ×0.9 quotas that prices them at 0.93–1.08× as hard as a normal week. Thunderstorm's six-tick slip still comes out ahead late in the run (1.07× at week 12, 1.14× at week 16), so it carries a ×1.3 quota, softened to ×1.09. Fog barely moves the bot's boards (0.98–1.01×, and 1.01–1.05× on Sky Harbour and Waterfront, where the bot builds road too), so its quota is a flat ×1: it matters to a player who built on air or water, and rewards one who put a lounge beside the jetway. `harness/eventprice.mjs` is new and reproduces the table in §14.2 (Delays 0.61/0.57/0.58 against the recorded 0.60/0.59/0.58).

  Autoplay, Terminal, `--runs 8 --weeks 16`, before → after as survived / band / over 3× / median: `--seed0 1000` 6/8 · 39% · 10% · 2.19× → 4/8 · 46% · 13% · 1.97×; `--seed0 2000` 8/8 · 41% · 13% · 2.23× → 8/8 · 46% · 17% · 2.11×. None of the four new deaths is a weather week: four more events reshuffle every run's plan, and the deaths landed on a Strike, a Crime Spree and quiet weeks after a Double Week and a budget week. All ten weather weeks the sixteen runs met passed, at 1.31× to 3.43× of quota.

- **The touch confirmation moved into the card bar** (§12.6). On a phone the popup by the target and the card bar under the board both showed the card's name and price, and between them covered most of the board. The bar now carries the aim itself (the target, the refusal or warning, ⟳, ⇄, ✓ and ✕), and folds the card's text away while aimed.

---

## 16. Not built yet, and open questions

**Designed but not built:** Gravity Well Concourse, the Rain Check card, the Concession Monopoly ordinance, tile unlock progression, a daily seed, and running the simulator in a web worker (not needed at current speeds).

**Open questions:**

1. **Does the board really never expand?** A fixed board plus a rising quota puts total weight on upgrade depth. If week-20 boards feel cramped rather than dense, a one-time paid expansion at week 12 is the pressure valve.
2. **Should terrain claims ever be reversible?** The Rezoning Permit exists as an escape hatch. If it becomes a must-take every run, terrain locking is too punishing.
3. **Capacity model.** Concurrent capacity with a service duration is used because congestion is wanted. If saturation proves illegible, fall back to a flat serves-per-week number.
4. **Endless ceiling.** Upgrade levels cap at 5 and the board saturates. Either add levels 6–10 at steep cost, or score endless runs on how far past 16 they went.
5. **A buffer for the band.** The quota is pass/fail, so the band and the survival rate trade against each other one for one (§15). A reserve — surplus above the quota banks, and a later shortfall draws on it — or a strike system would break that trade and let the modal week sit at 1.2–1.5× without a bad week ending the run. Neither is built; `quota.catchUp.share` is the dial in the meantime.
6. **Mode balance after flat AP** (§10.1). Junction's late cliff is gone now that the level sets its own clock (12 → 14 of 16), and Terminus no longer loses runs in week 1 now that its curve is scaled to its one action point. What is left is the shape *after* week 1: each level's `quotaMult` is one flat number, while a level's score pulls away from its target at its own rate, so a level can sit in band in week 1 and drift by week 12. `quotaGrowth` is the lever, and it has only been fitted for Junction.
