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
- **Week 16** shows the win screen, and play can continue in endless mode.

---

## 3. The board

### 3.1 Grid

| Mode | Grid |
|---|---|
| Terminal, Waterfront, Sky Harbour, Terminus | 12 × 12 |
| Junction | 9 × 9 |
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

- **Edgewise** (Train Station, Express Train, Water Taxi, Cruise Ship Dock): the whole tile must lie flat along one edge. A long vehicle berths alongside the edge, never nose-in.
- **Tip** (Jetway, Jumbo Jetway): only the tip of the L (the top of its stem) may touch the apron edge, with the foot pointing inland. Both mirror images are legal.

A Rezoning Permit card (§10.4) turns a claimed edge back into open ground, and **demolishes every transport attached to that edge**: lock-terrain tiles touching it, and road tiles whose driveway runs to it. Leaving a train station standing on open ground, or a bus stop with no road, is a state the rules can't hold. Each transport records the edges it depends on when placed (`tile.edges`).

### 3.3 Bridges

The Bridge/Overpass is an I3 tile laid along a claimed edge. It opens the edge spans beside it, so any transport terrain may attach there, and travellers can walk on it. It is implemented but **currently pulled from the shop** (`shop.slotWeights.bridge = 0`) because players found it confusing. If a run ever locks all four edges with no way out, the Rezoning Permit and Free-terrain transports are the relief valves.

### 3.4 Walkability

Travellers move one cell per tick in 8 directions, and may not cut diagonally past a corner.

- **Solid:** tiles are walls by default, and amenities only serve travellers who can actually reach their door.
- **Walk-through floor:** Waiting Area, Frequent Flier Club, Chrono Lounge, Green Space, WiFi Hotspot, Security Guard and the Security Checkpoint booth. Bridges, corridor lanes and driveways are walkable too.
- **Moving Walkway:** travellers on it move 2 cells per tick.
- **Checkpoint fences** are the only walls that sit *between* cells rather than on them (§7.5).

A traveller picks a destination whether or not you left them a way to reach it. If the platform they chose can't be reached, they are **lost** (§4.3).

### 3.5 The underground layer

Underground transports dig a straight **tunnel** on a second layer beneath the board. The layer has one rule: **no two tunnels may share a cell.** A tunnel's cells include the footprint of its own station, so a line can't run under another station either. Ground tiles ignore the layer completely: anything can be built over a tunnel, travellers walk across it, and lanes and driveways cross it freely.

| Tile | Line |
|---|---|
| Subway Station (I2), Express Subway (I3) | Along the tile's long axis to **both ends of the board**. Neither end may surface into a water edge, and an edge where a subway surfaces can never afterwards be claimed as water. Two subways at right angles can never coexist; parallel ones can. |
| Underground Parking (L3) | Straight to the **nearest road edge**, however far. No driveway and no reach limit. It depends on that edge, so a Rezoning Permit there demolishes it. Only offered while some edge is road. |
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
| Delete a tile | **0** | 0 — the terrain claim stays |
| Reroll the shop | 1 | free |
| Play a bonus card | 1 (a Rezoning Permit: 0) | card cost |
| **Run Week** with AP left | — | pays an **early-finish bonus** for each unspent AP |

Undoing a placement costs the money already spent, never the week: deleting a tile and playing a Rezoning Permit take no action points (`economy.deleteCostsAP`, `rezoningCostsAP`), so a tile that turned out to sit in everyone's way can be pulled and rebuilt in the same turn.

The early-finish bonus is `$10 + $5 × (week − 1)` per unspent point: $10 in week 1, $25 in week 4, $55 in week 10 and $85 in week 16 (`economy.earlyFinishBase`, `earlyFinishPerWeek`). It is paid the moment the week runs. It replaced the old *Wait* action, which paid interest on held cash and so rewarded hoarding.

The only ways to get more AP:

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

- **Week 1 is a fixed opening hand:** three transports and two amenities, so the first turn always makes sense.
- **Nothing unplayable is offered.** Upgrade cards only appear for tile types on the board that still have a level to gain, and category upgrades only when something matches. Every shop contains at least one buildable tile, and no tile appears twice in one hand.
- **Costs track the week.** Tiles are weighted toward a target cost of `32 × 1.14^(week−1)` (a log-normal with σ 0.75), so late-game shops offer bigger tiles.
- **Rerolls** are free but cost 1 AP.

### 4.3 Simulation ticks

**24 ticks per week: 16 spawn ticks, then 8 to clear the board** (`sim.ticks`, `sim.spawnTicks`).

- **Ticks 1–16:** transports spawn travellers on their cadence.
- **Ticks 17–24:** no new spawns; travellers already on the board carry on.
- **Last call:** every transport fires one final departure on tick 24, so only travellers still walking are stranded.
- **Stranded** travellers bank their chain value **×0.5**, with no exit bonus and no fare.
- **Lost** travellers — those with no route to their chosen platform — wander for the rest of the week and bank **nothing**.
- **Travellers mind the clock** (§6.3): nobody takes a detour they can't get back from before the last call, so stranding is mostly late arrivals with a long walk, not shoppers who lost track of time.

Playback speed is ½×, 1×, 2× or Skip. The simulation is deterministic for a given seed, so playback speed never changes the result.

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
growth(i) = late + (early − late) × decay^(i − 1)
Quota(week) = round(5400 × Π growth(i) for i = 1 … week−1  × eventMult × ordinanceMult × difficultyMult, to 1000)
early = 1.80, late = 1.125 (Junction: 1.16) + difficultyGrowthAdd, decay = 0.675
```

| Week | Quota | Week | Quota |
|---|---|---|---|
| 1 | 5,000 | 10 | 73,000 |
| 2 | 10,000 | 12 | 94,000 |
| 3 | 15,000 | 14 | 121,000 |
| 4 | 22,000 | 16 | 154,000 |
| 5 | 29,000 | 20 | 248,000 |
| 6 | 37,000 | 24 | 398,000 |
| 8 | 54,000 | | |

These are base quotas on Standard. Event weeks multiply them (§9), Night Service multiplies every week by 1.15, and the difficulty scales the whole curve and steepens it (§10.1.1).

Quotas are shown as **stars**, one per 1,000 points, and always round to a whole star. Earned stars round down, so 2,400 points is two stars.

The curve keeps the greedy bot's score/quota ratio at roughly 1.5–3.6× for the whole run, rather than swinging from 10× at week 5 to 1.3× at week 16. Event weeks are meant to spike out of that band. When refitting the curve, fit the quiet weeks and give event weeks a separate, lower target so they stay passable.

### 5.3 Money details

| | |
|---|---|
| Starting cash | $220 |
| Fares on boarding | tier fare × 0.35: $0.70, $1.75, $4.20, $10.50, $26.25 |
| Amenity revenue | listed revenue × 0.35 per service (`economy.revenueScale`) |
| Tile price | `cost × (1 + 0.06 × tiles on board)`, then mode and ordinance multipliers |
| Upgrade price | 60, 140, 300, 650 for levels 2–5 |
| Delete refund | none (half with the Zoning Variance ordinance); deleting costs no AP |
| Early-finish bonus | $10 + $5 × (week − 1) per unspent AP |

A crowded board is an expensive board, which pushes late-game players toward upgrading over adding. After the first two weeks, one or two purchases a week is typical: money, not AP, is usually what limits a turn.

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

**Adding one high-tier transport re-routes traffic across the whole board.** Every transport purchase is a strategic decision, not just a faucet.

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

### 7.2 Exit bonus

The transport a traveller boards applies its own `× mult + flat`. If the traveller's tier equals the transport's tier, a further **×1.5 tier-match bonus** applies.

### 7.3 Worked example

A $$ traveller (base 180) arrives by train, destined for the ferry.

| Step | Effect | Value |
|---|---|---|
| Spawn | — | 180 |
| Burger Joint ($, ×2.40 +100) | 180 × 2.40 + 100 | 532 |
| Restroom ($, ×1.70 +35) | 532 × 1.70 + 35 | 939 |
| Newsstand ($, ×1.52 +60) | 939 × 1.52 + 60 | 1,488 |
| Ferry exit ($$, ×1.10 +21) | 1,488 × 1.10 + 21 | 1,658 |
| Tier match ($$ = $$) | × 1.5 | **2,486** |

Stop budget used: 3 of 4. Fare: $1.75. Amenity revenue: (6 + 0 + 3) × 0.35 = $3.15.

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

**A lounge slot is held for the whole dwell**, from arrival at the platform to departure. A lounge beside a slow jetway serves far fewer travellers than one beside a shuttle — that is the placement decision. Lounges are walk-through floor, and WiFi adds +0.04 per stack.

### 7.5 Security Checkpoint

The checkpoint is a two-cell booth. **Its fence runs from one board edge to the other** along the grid line between the booth's two cells. The fence sits *between* cells, so it costs no floor space, and cells on either side stay buildable. Rotating the booth turns the fence.

- **The fence spans the open floor the booth stands in.** From the booth it runs along the line until a solid tile stands on either side of it (`sim.checkpoint.fence: 'walls'`), so a booth in a corridor fences that corridor and a booth on an open concourse fences the concourse; it never cuts across the far side of a building. `'edge'` runs it wall to wall regardless, and a number runs it that many cells each way.
- **The booth is the only way across.** Anyone may walk through it to reach whatever is on the far side; diagonal steps past the ends of the booth are blocked.
- **Clearing the booth is a chain link, applied when they board:** ×1.3 (+0.1 per level) on top of the finished chain, plus +2 stop budget on the spot, once per traveller (`atExit`). A multiplier at the crossing was worth almost nothing, because a traveller crosses early with a chain of 100–200 points and shops downstream multiply that instead.
- **It catches pickpockets** who walk through it.
- **Booths on the same line share one fence**, and each adds a lane.

The fence is still a commitment: on the week-9 bot boards it loses points in 14–41% of spots (an edge-to-edge fence lost in 64–86%, with rotations swinging 25–35★). The placement preview draws the whole fence line and shows the star value before you commit. See §15 for the options that were tried.

The old rule — only travellers whose platform is on the far side may cross, splitting the board into two shopping zones — is still available as `sim.checkpoint.filter: true`.

---

## 8. Tile catalogue

These are the current values. They are tuned with the harness (§14) and change often, so treat `src/data/tiles.js` as the source of truth.

### 8.1 Transport tiles

Four timing numbers define every transport: **arrival cadence** (ticks between batches), **batch size**, **departure cadence** and **dwell** (ticks a departing traveller waits). These are what make a parking lot feel different from a jetway.

| Tile | Shape | Terrain | Tier | Arr. | Batch | Dep. | Dwell | Mult | Flat | Cost | From week |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bus Stop | I2 | road | $ | 4 | 5 | 4 | 1 | 1.04 | 12 | 60 | 1 |
| Parking Lot | O4 | road | $ | 1 | 2 | 1 | 0 | 1.02 | 30 | 50 | 1 |
| Bike Rental | I2 | road | $ | 2 | 2 | 2 | 0 | 1.04 | 8 | 40 | 1 |
| Taxi Stand | I2 | road | $$ | 2 | 2 | 2 | 0 | 1.07 | 9 | 90 | 1 |
| Rideshare Zone | L3 | road | $$ | 1 | 2 | 1 | 0 | 1.05 | 11 | 80 | 1 |
| Car Rental | O4 | road | $$ | 3 | 2 | 3 | 2 | 1.07 | 18 | 140 | 2 |
| Limo Service | I3 | road | $$$$ | 5 | 2 | 5 | 1 | 1.21 | 12 | 240 | 4 |
| Tram Stop | I3 | corridor | $$ | 4 | 4 | 4 | 1 | 1.09 | 15 | 130 | 2 |
| Train Station | I4 | rail, edgewise | $$ | 6 | 6 | 6 | 2 | 1.10 | 18 | 180 | 2 |
| Express Train | I5 | rail, edgewise | $$$ | 8 | 9 | 8 | 3 | 1.16 | 24 | 320 | 5 |
| Monorail | I4 | corridor | $$$ | 5 | 5 | 5 | 2 | 1.14 | 21 | 280 | 5 |
| Ferry Terminal | L4 | water | $$ | 8 | 8 | 8 | 3 | 1.10 | 21 | 200 | 2 |
| Water Taxi | I2 | water, edgewise | $$$ | 3 | 2 | 3 | 1 | 1.14 | 11 | 150 | 3 |
| Marina | S4 | water | $$$$ | 8 | 2 | 8 | 4 | 1.23 | 18 | 350 | 6 |
| Cruise Ship Dock | I6 | water, edgewise | $$$ | 16 | 28 | 16 | 6 | 1.18 | 45 | 520 | 7 |
| Helipad | O4 | free | $$$$ | 6 | 2 | 6 | 2 | 1.24 | 15 | 380 | 5 |
| Hot Air Balloon | T4 | free | $$$ | 10 | 2 | 10 | 5 | 1.19 | 18 | 260 | 4 |
| Jetway | L3 | apron, tip | $$$ | 8 | 11 | 8 | 4 | 1.18 | 27 | 400 | 6 |
| Jumbo Jetway | L5 | apron, tip | $$$ | 12 | 21 | 12 | 6 | 1.21 | 42 | 680 | 9 |
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

Air tiles (helipad, balloon, jetways, private terminal, jetpack) are tagged `air` and go offline in a Weather Front. Underground tiles run their line on the tunnel layer (§3.5); Underground Parking has the Parking Lot's timing and pays for its freedom of placement. **Loop Terminal:** 30% of its departures during the spawn ticks re-enter as a new arrival with their chain value intact.

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

Tags: `food` (vending, food stand, burger, pizza, coffee, sports bar, cafeteria) and `green` (green space) matter for the Festival event.

**Green Space** costs no stop budget and **restores** one, making it a net +1 chain extender. It is walk-through, so it never blocks a route.

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
| Strike | ×0.9 | Choose one transport terrain: it produces nothing. If it is the board's only terrain, it runs a skeleton service at 25% batch instead. |
| Inspection | ×0.9 | Amenities below level 2 run at 70% pull and chain bonus |
| Festival | ×1.5 | Food and green amenities +0.20 base rate |
| Charter Season | ×1.7 | Travellers pick destinations as if one tier higher |

An event's real difficulty is its quota multiplier divided by how much it cuts the board's score; all of them should land between about 0.9× and 1.6× as hard as a normal week. Events double as tutorial pressure: Weather Front punishes a player who put everything on water, and Inspection punishes one who never upgraded.

---

## 10. Run structure

### 10.1 Modes

A mode sets the board and one standing rule. It is chosen before the run and unlocked by your **best week reached in any mode**. Difficulty (§10.1.1) is a separate choice made at the same time; any mode can be played at any difficulty.

| Mode | Grid | Unlock | Levers (`src/data/modes.js`) |
|---|---|---|---|
| **Terminal** | 12×12 | — | Baseline |
| **Junction** | 9×9 | week 8 | `startAP: 3` — 3 AP every week instead of 2. `quotaGrowth: 1.16` — the late quota growth is steeper; weeks 1–3 match Terminal, then week 16 needs 202k instead of 143k. |
| **Metroplex** | 16×16 | week 12 | `costMult: 1.25` — tile prices +25% (upgrades, cards and bridges are unaffected) |
| **Waterfront** | 12×12 | week 8 | `preLock: W, S water` — two edges start locked to water. `terrainCostMult: water 0.6` — water transports −40% |
| **Sky Harbour** | 12×12 | week 12 | `banTerrains: rail, water` — removed from the shop and rejected on placement. `terrainCostMult: free 0.7` — Free-terrain transports −30%. |
| **Terminus** | 12×12 | week 16 | `fixedAP: 1` — one AP a week (cards and ordinances still add). `shopSlots: 8` |

Some quirks in how the levers interact:

- **Junction and Terminus shifted with flat AP.** Now that AP is 2 all run, Junction's 3 AP is a permanent 50% advantage; under the old ramp it lasted only until week 6. Likewise, Terminus is 1 AP against 2 rather than against the old 2–5.
- **Waterfront's edges can be rezoned.** Its pre-locked edges count as claimed, so a Rezoning Permit can turn them back into open ground.
- **Sky Harbour keeps road and apron,** so jetways are still available.
- **Waterfront never offers a subway:** with the west and south edges under water, neither axis has two dry ends. Submarine Docks are on offer from week 5.

Greedy-bot results, 8 runs to week 16:

| Mode | Survived | Pattern |
|---|---|---|
| Terminal | 5 / 8 | 1.6–4× over quota all run; deaths at weeks 9, 12, 16 |
| Junction | 2 / 8 | Very easy early (3.7–5× through week 7), then the steeper quota and small board catch up; the week-16 average is 0.76× |
| Terminus | 2 / 8 | Two runs died in **week 1**; one AP with a mostly-transport opening hand can miss the 5★ quota. The survivors cruise at 1.3–3×. |

These were measured with the $ stop budget at 7; since it moved to 3, Terminal dropped to 10/16 over two seed sets (§14.2), and the other modes haven't been re-run. So Junction is front-loaded rather than hard, and Terminus has a week-1 cliff. The bot is greedy and one-step, so treat these as shape, not as final difficulty.

### 10.1.1 Difficulty

Difficulty is the second axis on the start screen. Where a mode changes the *shape* of a run, a difficulty only changes the *pressure*, so the same board reads the same way at every level. Unlike modes it is not gated: a player who wants a harder first run shouldn't have to grind a week-12 unlock for it.

| Lever (`src/data/difficulties.js`) | Standard | Hard | Extreme |
|---|---|---|---|
| `quotaMult` — flat on every week's quota | 1 | 1.15 | 1.20 |
| `quotaGrowthAdd` — added to the per-week growth | 0 | +0.012 | +0.045 |
| `costMult` — tile prices | 1 | 1.15 | 1.35 |
| `startMoneyMult` — cash at week 1 | 1 ($220) | 0.85 ($187) | 0.8 ($176) |
| `mods.revenueMult`, `mods.fareMult` | 1 | 0.9 | 0.8 |

The growth lever is what separates the two hard levels. A flat multiplier alone is felt in week 1 and then forgotten, since the board outgrows it; adding to the growth rate makes the gap widen every week instead. Standard's week-16 base quota is 154k, Hard's 200k (1.30×) and Extreme's 289k (1.88×), while their week-1 quotas are 5★, 6★ and 6★ — the star rounding ties the top two in week 1 on purpose. That shape was chosen after measurement: at `quotaMult` 1.35 Extreme killed five of sixteen bot runs in week 1 or 2, which is a coin flip on the opening hand rather than a difficulty (§15).

`costMult` stacks with the mode's (Metroplex on Extreme is 1.25 × 1.35) and with the Staff Expansion ordinance, and like them it leaves upgrades, cards and bridges alone. The `mods` block is merged exactly like an ordinance's, so nothing in the simulator knows difficulty exists.

Greedy bot, 8 runs to week 16 on Terminal, over `--seed0 1000` and `2000`:

| Difficulty | Survived | Score/quota band from week 8 | Deaths |
|---|---|---|---|
| Standard | 14 / 16 | 1.9–2.8× | weeks 8, 12 |
| Hard | 9 / 16 | 1.6–2.2× | weeks 3, 4, 7, 8, 12, 12, 16 |
| Extreme | 2 / 16 | 1.2–1.5× | weeks 2, 2, 4 ×4, 8 ×3, 10, 16 ×2 |

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

**Pickpockets** arrive from week 7 (the *Crime Wave* milestone). They phase in over three weeks, reaching 5% of spawns at full strength: roughly a 7% score cut in week 7, 16% in week 8 and 21% from week 9 on an unprotected board.

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
| Coupon Book | 30 | Half fares, double spawn batch, for 2 weeks |
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

**The board view is the whole game.** It shows an isometric board you can pan and zoom, with a run status bar along the top (week, quota stars, projection) and a timeline side panel on the right. The shop tray floats over the bottom of the board: the wallet, AP pips, **Reroll** and **Run Week** sit to the left of the cards.

Events, milestones, ordinance choices, the weekly summary and the start screen are modals.

### 12.2 Placement preview

The single most important UI element. While aiming a tile:

- **The shape as a ghost** at its real height, green if legal and red with the reason if not.
- **Pull radius** shaded on the ground, with the existing amenities whose radius overlaps outlined.
- **Terrain effects:** driveways and corridor lanes drawn, and a pulsing highlight on any edge the placement would claim, with a warning line ("Locks the whole north edge to rail, for good").
- **The tunnel** for an underground tile, with the rest of the underground layer lifted into view so a crossing is obvious (§3.5). An illegal line is still drawn, in red, so you can see what it hit.
- **The whole fence line** for a checkpoint.
- **A cut-off warning** naming any platform the placement would seal in ("Walls in Taxi Stand: nobody heading there can reach it"). Sealing a platform is the one placement that still costs a quarter of the week, so it is called out in words, not just red stars.
- **A star badge** with what the placement is worth this week: the mean over 8 estimate seeds, rounded down (`placement.previewSeeds`). The "without" runs are cached for the phase, so a preview costs one sim per seed. Losing placements show red stars blinking to black. Upgrade cards show the same badge over whichever owned tile is hovered.

### 12.3 Stars and the top bar

Quotas are shown as stars, one per 1,000 points.

- **Up to ten stars** are drawn as glyphs that light up as the week plays, with the current projection dimly pre-filling the ones it would reach.
- **Past ten,** the row becomes a `7 / 13 ★` counter. The two styles are never shown together.
- **The top bar is a gradient** from dark red through orange and green to lime as the projection passes the quota, and it turns gold at double. Hover it for the numbers.

### 12.4 Weekly summary

- **The headline:** stars against the quota, money earned (with any early-finish bonus), and travellers boarded, stranded, lost and robbed.
- **A score-vs-quota chart** for the whole run.
- **A per-tile table:** served, turned away, saturation, revenue, points, arrivals, boarded and stranded. This is where players learn the game.
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

### 12.6 Controls

- **Camera:** drag to pan, scroll or pinch to zoom; **+ / − / Fit** buttons or the **+**, **−** and **0** keys.
- **Picking a card spends nothing.** It goes into the card bar over the shop tray, which shows its
  name, its price in money and AP, and its full text — on a touch screen that bar is the only way
  to read a card at all. The bar's own button is what spends: **Build here** for a tile, **Play it**
  for a card that needs no target. **✕** or **Esc** puts the card back. **⌄** folds the text away
  when it covers too much board, and the choice is remembered.
- **Placing:** click a card, then the board. **R** (or shift+scroll, or right-click) rotates.
- **Touch** has no hover, so the first tap aims and a second tap builds.
- **Tile details:** hover a card or tile to see them; click a tile to pin the popup, which carries
  the Delete button and a close button, and stays inside the screen on a phone.
- **Targeted cards:** upgrades and bonus cards that need a target highlight the valid tiles (or
  edges, for Rezoning Permit), and the bar says what to pick.
- **Run Week** asks for confirmation only while AP is unspent, and says what running early pays. Once all AP is spent, a large Run Week button also appears on the board.
- **Music:** **♪** or **M** mutes it, and the choice is remembered. The start screen and a lost run are silent.
- **Panels:** the chevrons collapse the shop tray and the side panel. The side panel is a column
  on the right of a wide screen and a strip along the bottom of a narrow one, so its handle turns
  with it: a full-width **⌄** bar across the top of the strip, and **▲** on the tab that brings it
  back. The handle sits outside the scrolling area, so it cannot be scrolled away.
- **On a phone:** the side panel starts collapsed, the top bar and cards shrink, the page is sized
  to the visible viewport (`dvh`) so the tray is not hidden behind the address bar, and controls
  take a tap without the double-tap zoom delay.

---

## 13. Technical design

### 13.1 Stack as built

- **Code:** plain JavaScript ES modules with no framework, no build step and no dependencies. The page loads `src/ui/main.js` directly, so it must be served over HTTP. `harness/build.js` bundles everything — sprites and music included — into `dist/grand-central-station.html`, which works from disk.
- **Simulator:** `src/sim/sim.js` is headless and deterministic, with no DOM dependency; the same modules run in Node for the harness and in the browser for play. A week takes ~1.5 ms for a small board, so it runs inline — no worker — and is precomputed before playback. The renderer replays each traveller's recorded frames and events.
- **Seeding:** every roll is stateless — a hash of the week seed, the traveller's *spawn slot* (which transport, and their number in its stream) and the question being decided (tier, destination, a waypoint, a shop's die, a tie-break at a cell). No stream is shared, so a board change re-rolls only the travellers whose route it touches; a tile out of everyone's way leaves the week identical, and the preview's before/after runs stay on the same random path. `sim.stratify` turns a slot's rolls into golden-ratio steps along the unit interval, so a transport's travellers cover the dice evenly (the tier mix and each shop's serves land near their expectation). The old per-subsystem streams (`makeStreams`) remain for the shop and cards.
- **Pathing:** a Dijkstra distance field per target, memoised per week. Destinations are few and travellers many. Checkpoint fences are a per-step bitmask, since they lie between cells.
- **Data-driven content:** every tile, event, card, ordinance, mode and difficulty is a plain object in `src/data/`, and every tunable number lives in `src/config.js`. Unique mechanics are keyed by `special`: `wifi`, `walkway`, `waiting`, `gate`, `security`, `green`, `loop` and `anytier`. Underground tiles are keyed by `terrain: 'underground'` plus `line` (`through`, `road` or `water`); the placed tile records its tunnel as `tile.tunnel = { line, axis, ends, cells }`, and the layer's occupancy is derived from the tiles rather than stored, so nothing can drift out of sync.
- **State:** a plain mutable run-state object with action functions (`src/game/run.js`); the UI re-renders after each action. `window.gcs` exposes the state, the game API and `refresh()` for debugging from the console.

### 13.2 The isometric view

`src/ui/render.js` draws the board through a 2:1 isometric camera on a Canvas 2D context.

- **Grid space stays plain.** The board model is x right, y down. The renderer projects grid points to screen and un-projects screen points back, so `cellAt`/`edgeAt` picking is exact at any zoom, and nothing else in the codebase knows the view is isometric.
- **Zoom:** `k` is the on-screen width of one cell's diamond. `fit()` picks the `k` that frames the board and its edge strips above the shop tray, and zoom scales from there.
- **The world beyond the board:** a side claimed by water turns everything beyond it to sea, and road and rail edges carry on past the corners into the distance.
- **The underground layer** is painted in `drawGround`, under every building, as a dark cut with rail ties along each tunnel's axis. `drawUnderground` repaints the whole layer above the buildings, over a dimmed board, whenever the view asks for it (an underground ghost, or an underground tile hovered or selected).

The **draw unit is the cell, not the tile.** Every occupied cell is sorted by `x + y` and painted back to front. Ordering whole tiles isn't enough, because footprints interleave: a one-cell tile can stand in front of one end of a long building and behind the other. A tile's label is drawn after its last cell, so its own roof never covers it.

**Travellers sit between two layers:** floor, then the crowd, then walls and roof, all merged into one depth-sorted pass.

| Element | Sort depth |
|---|---|
| A cell's floor | `x + y − 0.75` |
| A traveller | `⌊x⌋ + ⌊y⌋ − 0.5` |
| A checkpoint fence panel | `x + y − 0.6`, just behind the cell south or east of it |
| A cell's walls and roof | `x + y` |

The result is that someone who steps into a shop is covered by it. Walk-through tiles stand only 0.10 high, so the travellers on them stay visible.

Travellers are small dots (radius `k × 0.062`, minimum 1.2 px), so the crowd reads as flow rather than as counters. Chain-value popups are drawn last and are never hidden.

`src/ui/boardinput.js` owns the gestures. One pointer both pans and picks: a press that barely moves is a tap, anything further pans. Two pointers pinch and pan around their midpoint, and the wheel zooms about the cursor.

### 13.3 Sprites and audio

`src/ui/sprites.js` maps tile keys to PNGs in `assets/tiles/`.

- **Geometry:** each sprite is drawn in the shape's base orientation at 32 px per cell. The renderer clips it to each cell and rotates or mirrors it to match the placed orientation, so one image per tile type is enough. Because the isometric map is linear, the canvas transform lays top-down art flat on the ground plane.
- **Two layers:** `SPRITES` is the over layer (walls, roof) and `SPRITES_FLOOR` the under layer (`<key>_floor.png`).
- **Fallback:** tiles without art draw as flat coloured blocks. Missing sprites show up as harmless 404s when served; none are committed yet. The old 4-cell `gate.png` no longer fits the 2-cell checkpoint booth.
- **Music:** `src/ui/audio.js` plays the run soundtrack, fading in and out. The `main` track is a list of files (`assets/music/GCS1.mp3`, `GCS2.mp3`): it is shuffled when the run's music starts and then played in that order, looping back to the top after the last one. The mute choice is remembered in `localStorage`.

---

## 14. Balance and testing

### 14.1 Harness

```bash
node harness/selftest.js                                              # invariants
node harness/run.js harness/layouts/doc_example.json --seeds 50 --week 4   # one layout, p10/p50/p90 + saturation
node harness/autoplay.js --runs 8 --weeks 16 [--mode junction] [--difficulty hard] [--verbose]  # greedy bot plays full runs
node harness/marginal.mjs --week 6 --seeds 12                         # value of one more of each tile
node harness/sensitivity.mjs --bot 1000 --week 9 --seeds 24           # placement landscape of each probe tile on a bot board
node harness/ui-smoke.mjs                                             # Playwright drive of the real page
```

`autoplay.js`, `run.js` and `sensitivity.mjs` accept `--set <config path>=<value>` to A/B a rule (`--set sim.hurry.enabled=false`), and `autoplay.js --no-prune` stops the bot deleting tiles.

- **Sensitivity** (`harness/sensitivity.mjs`) sweeps every legal placement of a few probe tiles on a board (a layout, or the bot's board at a given week via `harness/bot.mjs`) and reports each tile's landscape — best, median and worst spot, share of losing spots — and its *roughness*: the mean jump in value between a spot and the same tile one cell over or rotated, next to the seed-noise floor of the estimate, so a real cliff can be told from a noisy one. `--dump` saves the bot's board as a layout for another build to probe.
- **Layouts:** `harness/layouts/*.json` describe a board: `{ "mode": "terminal", "week": 4, "tiles": [{ "key": "train_station", "x": 4, "y": 0, "rot": 0, "level": 1 }] }`. `amenity_chain.json` and `transport_spam.json` are the two ends of the strategy space, and the quickest way to see whether a change moved the right thing.
- **Selftest** covers shape orientations, placement and attachment rules, terrain locks, bridges, determinism, lost travellers, checkpoint fences (edge to edge, crossed only at the booth), walk-through tiles, WiFi boosts, pickpocket removal, and the underground layer (tunnels to both ends or to the nearest road or water edge, no crossings, no surfacing into water, building over a tunnel, and shop availability).
- **UI smoke test** (`npm i playwright && npx playwright install chromium`) starts a run, places tiles, runs playback, opens the summary and heatmap, picks an ordinance, upgrades and deletes via the UI, plays a Rezoning Permit, uses the strike selector, reloads and resumes, checks game-over and the start screen, and verifies draw order.

### 14.2 What holds the balance up

Transports bring travellers; amenities multiply what each traveller is worth. Both have to be worth building.

- **Transports alone are worth little.** Batches are small and exit bonuses modest, so a traveller who walks straight from arrival to departure is worth very little.
- **Amenities make the chain.** Their mult and flat values are large, pull rates run 0.36–0.81 and radii 2–4, so most travellers make two or three stops on the way across.
- **Two limits on a chain.** A $ traveller stops after 3 services; for everyone else, the week usually binds before the budget, since each detour risks stranding at the end of the week. On a transport-heavy board stranding runs about 13%; on an amenity-dense one about 63%. Raising `sim.ticks` moves both far more than the stop budget does.
- **Transports cost roughly twice** what a comparable amenity costs.

**Current readings:**

- **`marginal.mjs`, week 6:** the cheap road transports lead at 24–38★ per $100. Good amenities sit at 13–20 and mid-game transports at 6–15. No ordinary tile is a trap: WiFi is 13.8 and the Checkpoint 6.1 (it is placement-sensitive by design).
- **`autoplay.js --runs 8`, run with `--seed0 1000` and `--seed0 2000`:** the greedy bot (which now deletes a tile whose removal scores better) survives 14 of 16 runs to week 16 against the 5,400-base quota. Mean score/quota runs about 1.9–2.8× from week 8 on, and the two deaths fall on event weeks (8, 12). If a change moves that, the `quota` block holds the dials.
- **`autoplay.js --difficulty`:** the same 16 runs survive 14 on Standard, 9 on Hard and 2 on Extreme (§10.1.1). Re-run all three after any change to the quota block or the economy — a change that only reads as "slightly tighter" on Standard can wipe Extreme out in week 2.
- **`sensitivity.mjs`, 24 seeds on the bot's week-9 and week-12 boards:** moving an ordinary amenity one cell changes its value by 2–3.5% of the week's score, rotating it by 2–5%; the estimate's own noise floor is about 1%. Stranding runs 10–40% on those boards (it was 65–80% before travellers minded the clock). The one placement that still costs a quarter of the week is sealing a platform in, which the preview now names.

**Event-week hazards:** re-check event weeks after any catalogue change. Inspection is the cautionary tale — once amenities carried half the score, closing every un-upgraded one made that week 5× harder than a normal week, so it now restricts them to 70% instead. Strike had the same hazard: on a one-terrain board it would score exactly zero, hence the skeleton service.

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

- **Difficulty levels** (§10.1.1). Standard is the game as tuned and every lever is 1, so nothing about the existing balance moved: autoplay over `--seed0 1000` and `2000` survives 14 of 16, the same reading as before the change. Hard (9/16) and Extreme (2/16) scale the quota, prices and income on top of it. Extreme was measured twice: at `quotaMult` 1.35 / `quotaGrowthAdd` 0.03 it survived 2 of 16 but killed five runs in week 1 or 2, which tests the opening hand rather than the player. Moving the pressure off the flat multiplier and onto the growth rate (1.20 / 0.045) kept survival at 2 of 16 and the week-16 quota slightly higher (289k against 281k) while the week-1 quota dropped a star (6★ from 7★) and the worst week-1 score went from 0.62× of quota to 1.08×, so the deaths now land on the event weeks where they belong.

**Simulation**

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

**Tiles**

- **Lounges** stack at 0.24 (Club 0.38, $$$+ only; Chrono 0.43) with radius 3. At the document's 0.10 and radius 2, a Waiting Area was a dead block: median marginal value 164 points, negative in 43% of placements. Making lounges walk-through removed the last of the downside (median 2,933, never negative).
- **Green Space** is walk-through and serves travellers crossing it. Its median marginal value at week 6 rose from 1,545 to 2,307, and the share of negative placements fell from 15% to 1%.
- **WiFi Hotspot** boosts everything in range and is walk-through. It used to be a solid one-cell wall that only raised shop pull, pulling travellers into detours they had no time for: negative in 47% of placements, median +52 points. Walkability alone makes it exactly neutral; the boosts make it never negative, with a median of +2,720.
- **Moving Walkway** riders still roll for service. Suppressing rolls made the tile that *attracts* paths also cancel them, and it was negative in 36% of placements.
- **Corridor lanes** are walkable (a lift could otherwise fence the board in two — this retired the *Open Borders* ordinance in favour of *Wayfinding Signs*). They follow the tile's long axis and are freed on delete.
- **Long vehicles berth edgewise; jetways attach by the tip.**
- **The underground layer** (§3.5) was added with four tiles. Priced from `marginal.mjs` on the standard boards: at week 6 Underground Parking is 14.2★/$100 (between the Bus Stop at 19.0 and the Coffee Shop at 13.5, and well under the Parking Lot's 32.9, which is the price of going anywhere with no driveway), the Subway Station 11.8 and the Express Subway 6.8 (the mid-game transport band); at week 10 they read 9.4, 9.3 and 4.7. The Submarine Dock, probed on a week-8 board with a ferry edge, is 2.65★/$100 at its best spot (median +8.6k, never negative), between the Helipad's 2.54 and the Marina's 1.99. Autoplay over `--seed0 1000` and `2000` survived 13 of 16 runs (10 of 16 before); the quota curve was left alone, since the bot's mean score/quota band (1.5–3.8×) did not move.
- **Bridge** is implemented but pulled from the shop.
- **Information Kiosks** no longer reduce pickpocket spawns.

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

- **The crime wave** starts at week 7 (was 8) and ramps over three weeks. The Security Guard was added as a cheap one-cell counter, and the Security Station is no longer forced into the week-7 shop.
- **Events:** Inspection restricts to 70% (was a full closure at ×1.4 quota); Strike falls back to a skeleton service on one-terrain boards.

---

## 16. Not built yet, and open questions

**Designed but not built:** Gravity Well Concourse, the Rain Check card, the Concession Monopoly ordinance, tile unlock progression, a daily seed, running the simulator in a web worker (not needed at current speeds), and per-tile sprites.

**Open questions:**

1. **Does the board really never expand?** A fixed board plus a rising quota puts total weight on upgrade depth. If week-20 boards feel cramped rather than dense, a one-time paid expansion at week 12 is the pressure valve.
2. **Should terrain claims ever be reversible?** The Rezoning Permit exists as an escape hatch. If it becomes a must-take every run, terrain locking is too punishing.
3. **Capacity model.** Concurrent capacity with a service duration is used because congestion is wanted. If saturation proves illegible, fall back to a flat serves-per-week number.
4. **Endless ceiling.** Upgrade levels cap at 5 and the board saturates. Either add levels 6–10 at steep cost, or score endless runs on how far past 16 they went.
5. **Mode balance after flat AP** (§10.1). Junction is trivial early and brutal late; a gentler `quotaGrowth` (or a 2-AP start with +1 later) would even it out. Terminus can lose in week 1; a lower week-1 quota or a guaranteed transport-plus-amenity pair in its first hand would fix that.
