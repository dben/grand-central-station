# Grand Central Station

A browser-based, turn-based tile-placement roguelite about running a transit hub.
Place a few tiles each week, watch a crowd of travellers cross the board, and make
every traveller worth more than the last. Hit the week's quota or the run ends.

Built from `transit-hub-design.md`. No build step, no dependencies.

## Run it

**Easiest:** open `dist/grand-central-station.html` directly. It is a single self-contained
file (bundled script, inlined CSS and sprites) and works from disk.

**Development:** the source uses ES modules, which browsers refuse to load from `file://`
(you get a CORS error). Serve the folder over HTTP instead:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080/>. On Windows, `start-windows.bat` does the same and opens
the browser. Any static server works. Rebuild the single-file version after changes with:

```bash
node harness/build.js
```

## Controls

- The board is an isometric view you can move: **drag** to pan, **scroll** or **pinch** to zoom, and the **+ / − / Fit** buttons in the top-right corner do the same. **+**, **−** and **0** are the keyboard equivalents.
- The board sits in open land. A side claimed by water turns the whole world beyond it to sea, and road and rail edges carry on past the corners into the distance (stopping at the shore).
- The shop floats over the bottom edge of the board: cards centred, with money, action points, **Reroll** and **Run Week** beside them. Fit frames the board above the tray, and you can always pan far enough to drag anything out from under it. Each card type has its own colour and border.
- Click a shop card, then click the board to place it. **R** (or shift+scroll, since plain scroll zooms) rotates. **Esc** cancels.
- On touch the first tap aims the ghost and a second tap on the same spot builds it; a bar above the shop also has **Rotate**, **Build here** and cancel.
- Music plays throughout a run; the start screen and a lost run are silent. **♪** in the top-right corner (or **M**) mutes it, and the choice is remembered.
- Hover a shop card or a placed tile for its details in a popup; click a tile to pin the popup (it has the Delete button).
- While placing, a badge floats over the ghost outline with what the tile is worth this week in stars (rounded down, so 2,400 points is two). Selecting an Upgrade Token or a named upgrade shows the same badge over whichever owned tile you hover, so you can compare targets before spending. A change that loses points shows red stars blinking to black.
- Quotas round to a whole thousand and are shown as **stars**, one per 1,000 points. Up to ten they are drawn as glyphs — the top bar holds an empty star for each one the week needs and they light up as the week plays, with the current projection dimly pre-filling the ones it would reach. Past ten a row stops being countable, so it becomes a plain `7 / 13 ★` counter instead. Never both at once.
- The top bar is a left-to-right gradient that slides from dark red → orange, through orange → green as the projection reaches the quota, to green → lime above it, and turns gold when the projection is at least double the quota. Hover it for the numbers.
- Money is the pinball-style counter above Reroll; the squares under it are this week's action points. **Reroll** is free and costs 1 AP. There is no Wait button any more: running the week with action points left pays an **early-finish bonus** per unspent point, $10 in week 1 rising $5 a week ($25 in week 4, $85 in week 16; `economy.earlyFinishBase`/`earlyFinishPerWeek`). Run Week shows the bonus as `+$X` while points remain.
- The side panel is a timeline: last week's stars earned, the current week, and the next four weeks with event (yellow), ordinance (pink) and milestone (cyan) weeks marked; each row shows the stars that week needs. Milestones are the weeks the run changes shape — Crime Wave brings pickpockets, New Stock opens rare tiles, Overtime Approved puts Extra Shift in the shop — and they sit on otherwise-quiet weeks so they never land on top of an event. The next event is revealed; the one after it is not (Survey Crew shows it).
- Run Week sits in the shop tray under Reroll; once all action points are spent it also appears in the middle of the board. While points are unspent it asks for confirmation, and the dialog says how many are left and what running early pays.
- Upgrade cards lead with the tile they upgrade (Coffee Shop) and put the upgrade's own name (Espresso Bar) underneath.
- Event weeks and milestone weeks (Crime Wave, New Stock, Overtime Approved…) open with a popup, after any ordinance choice. The chevrons collapse the shop tray and the side panel.
- Upgrade cards and bonus cards ask for a target: click a highlighted tile (or an edge for Rezoning Permit). An upgrade card names one tile type you already own (Espresso Bar upgrades a Coffee Shop), so it only ever highlights tiles of that type.
- **Run Week** simulates the week. It asks for confirmation only while you still have action points to spend; with none left it just runs. Playback speed is ½×, 1× (the default), 2× or Skip; the result never depends on speed.
- The weekly summary charts score against quota for the whole run; the per-tile breakdown is behind a disclosure. Edge locks apply immediately when you place a tile; the badge over the ghost warns before you click. **Where did people walk?** shows the path heatmap.

## Layout

```
index.html                 page shell
src/config.js              every tunable number (quota curve, AP, tiers, economy, service formula...)
src/data/tiles.js          transport + amenity catalogue, bridge, per-tile and named upgrades
src/data/events.js         event weeks
src/data/cards.js          bonus cards
src/data/ordinances.js     ordinances
src/data/modes.js          game modes
src/sim/rng.js             seeded PRNG with one stream per subsystem
src/sim/shapes.js          tetromino shapes and orientations
src/sim/board.js           grid, terrain claims, placement legality
src/sim/sim.js             headless deterministic week simulator
src/game/run.js            run state, shop generation, actions, settlement
src/ui/render.js           isometric canvas renderer + pan/zoom camera
src/ui/boardinput.js       pointer gestures: drag-pan, pinch/wheel zoom, tap vs drag
src/ui/                    DOM chrome, playback, persistence
harness/run.js             CLI: run a layout across N seeds, report p10/p50/p90 + per-tile saturation
harness/autoplay.js        CLI: a greedy bot plays full runs to test the quota curve
harness/marginal.mjs       CLI: what one more tile of each type is worth, in stars and stars/$100
harness/selftest.js        invariants: determinism, placement rules, gates, jetway attachment
harness/build.js           bundles everything into dist/grand-central-station.html
harness/ui-smoke.mjs       Playwright smoke test of the real page
```

The simulator has no DOM dependency; the same modules run in Node for the harness
and in the browser for play.

## Balance harness

```bash
node harness/selftest.js
node harness/run.js harness/layouts/doc_example.json --seeds 50 --week 4
node harness/autoplay.js --runs 4 --weeks 16 --verbose
node harness/marginal.mjs --week 6 --seeds 12
```

`harness/layouts/*.json` describe a board: `{ "mode": "terminal", "week": 4, "tiles": [{ "key": "train_station", "x": 4, "y": 0, "rot": 0, "level": 1 }] }`.
`amenity_chain.json` and `transport_spam.json` are the two ends of the strategy space and are
the quickest way to see whether a balance change moved the right thing.

## Changes from the design document

Numbers were tuned with the harness and the autoplay bot; the original values are noted in `src/config.js`.

- **Quota curve** starts at 5,000 (not 3,000) and its growth rate decays from 1.80 to 1.125 rather than staying fixed — see *The quota curve*. With the document's traveller values a single bus stop cleared the original week-1 quota three times over.
- **Money** was far too plentiful: fares and amenity revenue are scaled to 35% and tile prices grow 6% per tile on the board (was 4%). Starting cash is 220 so the first two weeks are comfortable; after that one or two purchases a week is typical.
- **Last-call departure**: every transport fires a final departure on the last tick, so only travellers still walking are stranded. Without it a cadence-8 ferry stranded 70% of its passengers.
- **Transport batch sizes** are ~10–15% smaller than the document's table.
- **Same-tile trips**: a traveller whose destination is the tile they arrived on takes a wander (random waypoints, σ 2.5 cells) instead of standing still, so a lone bus stop still feeds nearby shops.
- **Week-1 shop** never offers an Upgrade Token while the board is empty; the slot becomes a second amenity.
- **Travellers step inside** an amenity for the service duration instead of pausing beside it.
- **Action points stay at 2 all run.** The old ramp (3 AP at week 6, 4 at 12, 5 at 20) is gone; `run.startAP` is the whole budget. Extra AP comes only from cards and ordinances: **Overtime** (+2 this week), **Temp Staff** (+1 this week and the next two), **Extra Shift** (permanent +1, week 19+) and the **Staff Expansion** ordinance (+1 every week, tiles cost 15% more). The greedy bot survives more often with flat AP than it did with the ramp (5/8 vs 3/8 runs to week 16), because money, not AP, is what limits a turn after week 2, so the quota curve was left alone.
- **Green Space** costs no stop budget and restores one, making it a net +1 chain extender. It is walk-through floor: travellers cross it, and anyone standing on it rolls for service as if beside it. Median marginal value at week 6 went from 1,545 to 2,307 points, and it is negative in 1% of placements (was 15%).
- **WiFi Hotspot boosts everything in its radius** and is walk-through floor. Per hotspot in range (capped at two, +50% per level): shops +5% pull and +0.12 chain multiplier, lounges +0.04 per stack, transports +0.04 exit bonus (`sim.wifi`). It used to be a solid one-cell wall that only raised shop pull, which pulled travellers into detours they had no time for; it was negative in 47% of placements with a median of +52 points. Now it is never negative, with a median of +2,720 (13.8★/$100 on the week-6 probe, mid-pack among amenities). Walkability alone makes it exactly neutral; the gain is all from the boosts.
- **Security Checkpoint** (was Security Gate) is a two-cell booth. Its fence runs from one board edge to the other along the grid line between the booth's cells, so it costs no floor space. Rotate the booth to turn the fence. The fence sits between cells, not on them (`checkpointFences`/`fenceBlocked` in `sim/board.js`, a per-step rule in the pathfinder). Travellers cross only through the booth, and clearing it is a ×1.3 chain link (+0.1 per level) plus 2 stop budget, once per traveller. Pickpockets who walk through are caught. Booths on the same line share one fence, and each adds a lane.
  - Options tried on the week-10 probe board (best spot / median / share negative): budget bonus only: +3.0k / −4.4k / 82%, with the bonus size making no difference because budgets rarely run out; ×1.15: +6.2k / −2.7k / 71%; **×1.3: +9.3k / −1.2k / 58%** (chosen); ×1.5: +13.5k / +0.3k / 48%. With `sim.checkpoint.filter: true`, only travellers whose platform is across may cross (the old gate rule, which splits the board into two shopping zones). It scored worse (median −2.9k at ×1.3), so the default lets anyone through. A full row of wall cells was the other option. It was ruled out without being probed because it costs a whole row of floor and is nearly impossible to fit on a built-up board.
- **Frequent Flier Club** only serves `$$$` and up. Lounge stacks are worth 0.24 per tick waited (0.38 for the Club, 0.43 for the Chrono Lounge) and reach 3 cells. At the document's 0.10 and radius 2 a Waiting Area was a dead 4-cell block: median marginal value 164 points, negative in 43% of legal placements.
- **Lounges are floor, not wall.** Waiting Areas, Clubs and the Chrono Lounge are walkable (walk map value 5, normal speed) — travellers cross them freely and only earn a stack once they are actually *waiting* there. That removed the last of the tile's downside: median marginal value 2,933 and never negative, though its ceiling is still modest because it only touches the travellers who reach a platform.
- **Bridge** is implemented (an I3 tile along a claimed edge that opens the span beside it) but pulled from the shop for now via `CONFIG.shop.slotWeights.bridge = 0`.
- **Corridor lanes** are freed when the corridor tile is deleted (edge claims stay permanent as designed).
- **Corridor lanes** run along the tile's long axis: a vertical ski lift reaches the north or south edge, a horizontal one east or west. Rotate to change which edge it serves.
- **Amenities only pull travellers who can reach their door.** Tiles are solid, so a shop behind a wall of other tiles is invisible to the crowd on the far side.
- **Travellers pick a destination whether or not you left them a way to get there.** If the platform they chose is unreachable they are *lost*: they wander the concourse for the rest of the week and bank **nothing** (`economy.lostMultiplier`), which is worse than being stranded. Sealing a transport into an amenity pocket used to be the strongest play on the board — it turned every walk into a guaranteed same-tile round trip, worth +33% score on a test layout. It now costs about 14% instead. The week summary reports lost travellers separately.
- **Corridor lanes are walkable.** The reserved strip beside a ski lift or tram is unbuildable ground, not a wall — travellers cross it freely, so a lift cannot be used to fence the board in two. (This retired the *Open Borders* ordinance, replaced by *Wayfinding Signs*: +1 amenity radius, −15% capacity.)
- **Moving Walkway** riders still roll for every shop they pass. Suppressing service rolls while riding made the tile that *attracts* paths also cancel them, so it was negative in 36% of legal placements; now it is a way to route the crowd past your retail strip at double speed.
- **Long vehicles berth lengthwise.** Train Station, Express Train and Cruise Ship Dock must lie flat along one edge (`attach: 'edgewise'`), so a 6-cell liner cannot moor nose-in.
- **The crime wave phases in** over three weeks (`sim.pickpocketRamp`) rather than arriving at full strength: a 7% score cut in week 7, 16% in week 8, 21% from week 9. The counters are the **Security Station** (L3, radius 3) and the **Security Guard** (one walk-through cell, radius 2, $32), which remove any pickpocket entering their radius, and the Security Checkpoint, which catches pickpockets who walk through it. None of them is forced into the shop the week the wave is announced any more; they turn up in the normal rolls from week 7 (checkpoint from week 6). Information Kiosks no longer reduce pickpocket spawns.
- **Jetways** must point the tip of the L (the top of the stem) at the apron edge with the foot inland. Both mirror images are legal; the other two orientations are rejected with a hint to rotate.

## Drawing the crowd

Each cell paints in **two layers with the travellers between them** — floor, then the crowd
standing on it, then walls and roof — all merged into one depth-sorted pass in `draw()`. A cell
at depth `x + y` emits its floor at `x + y − 0.75` and its roof at `x + y`, and a traveller emits
at `⌊x⌋ + ⌊y⌋ − 0.5`, so each cell's sandwich stays intact without disturbing the ordering
between cells. The visible result is that someone who steps into a shop is covered by it.

The seam is where per-tile art goes: `SPRITES` in `src/ui/sprites.js` is the over layer (walls,
roof) and `SPRITES_FLOOR` is the under layer (`<key>_floor.png` — seating, tiling, anything a
traveller stands *on*). Both are optional per tile and both use the same base-orientation
geometry, so adding a floor image needs no renderer change. Lounges stand only 0.10 units proud
of the ground so travellers inside stay visible above the lip.

Travellers are small dots (radius `k × 0.062`, floor 1.2px), deliberately smaller than a tile:
the crowd should read as flow rather than as a row of counters. Chain-value popups are drawn
after everything, so they are never occluded.

## The isometric view

`src/ui/render.js` draws the board through a 2:1 isometric camera. The board model stays in
plain grid space (x right, y down); the renderer projects grid points to screen and
un-projects screen points back, so `cellAt`/`edgeAt` picking is exact at any zoom or pan and
nothing else in the codebase knows the view is isometric. `k` is the on-screen width of one
cell's diamond: `fit()` picks the `k` that frames the board plus its edge strips, and zoom
scales it from there.

Tiles are extruded by a small per-kind height, and the **draw unit is the cell, not the tile**:
every occupied cell is sorted by `x + y` and painted back to front. Ordering whole tiles is not
enough, because footprints interleave - a one-cell tile can stand in front of one end of a long
building and behind the other, so no single position in the order is right for the whole tile.
A tile's label is drawn once its last cell has been, so its own roof never covers it.

`src/ui/boardinput.js` owns the gestures. One pointer both pans and picks: a press that never
travels more than a few pixels is reported as a tap, anything further pans. Two pointers pinch
and pan around their midpoint, and the wheel zooms about the cursor. Because touch has no
hover, placing a tile there is two-stage - the first tap aims, the second builds.

## Sprites

`src/ui/sprites.js` maps tile keys to PNGs in `assets/tiles/`. Each sprite is drawn in the
shape's base orientation at 32 px per cell covering the bounding box; the renderer clips it to
the tile's cells and rotates or mirrors it to match the placed orientation, so one image per
tile type is enough. The isometric grid is a linear map, so the renderer hands it to the canvas
as a transform and the top-down art lies flat on the ground plane with no re-drawing.
Tiles without a sprite fall back to the flat coloured rendering.
`assets/tiles/README.md` lists the planned set and the Pixellab prompts; `harness/build.js`
inlines whatever PNGs exist into the single-file build. Missing sprites show up as 404s in
the console when running from a server; that is harmless.

## Testing

- `node harness/selftest.js` checks shape orientations, placement rules, terrain locks, bridges, determinism, checkpoint fences (edge to edge, crossed only at the booth), walk-through tiles, WiFi boosts and pickpocket removal.
- `harness/ui-smoke.mjs` drives the real page with Playwright (`npm i playwright && npx playwright install chromium`, then `node harness/ui-smoke.mjs`). It starts a run, places tiles, runs playback, opens the summary and heatmap, picks an ordinance, upgrades and deletes via the UI, plays a Rezoning Permit on an edge, uses the strike selector, reloads and resumes a saved run, and checks the game-over and start screens.
- `harness/marginal.mjs` places one of every catalogue tile at its best spot on a representative board and reports the score delta in stars and stars per $100. It is the tool to reach for when a tile feels dead or overpowered.
- `window.gcs` exposes the live run state, the game API and a `refresh()` for poking at a run from the console.

## The shop

Each slot rolls independently against `CONFIG.shop.slotWeights`, so a week's hand
varies: five tiles, or two tiles and two upgrades and a bonus card, or three upgrades.
Two rules constrain it:

- **Week 1 is a fixed opening hand** — three transports and two amenities
  (`CONFIG.shop.week1`), so the first turn always makes sense.
- **Nothing unplayable is offered.** Upgrade cards are only generated for tile
  types already on the board with a level left to gain; category upgrades
  (Double Shift, Renovation, Concourse Extension) only appear when something
  matches; and every shop is guaranteed at least one buildable tile.

Upgrades are bound to a tile type rather than being a generic token, and each has
its own name from `TILE_UPGRADES` in `src/data/tiles.js` (`Espresso Bar` for a
Coffee Shop, `Platform Extension` for a Train Station). A type with no entry gets
a generated `<Tile> Refit`, so the table can be filled in over time without
touching shop code. An entry can grant several levels and extra radius; its price
is what those levels would have cost one at a time, times `costMult`.

## The quota curve

A station's output grows fast while it is small and slowly once it is built out. A single
per-week multiplier cannot track that, so it makes the first half free and the last few weeks
a cliff. Instead the per-week growth *decays*: it starts at `quota.earlyGrowth` and falls
geometrically (`quota.growthDecay`) toward the settled `quota.growth`. That gives 5★, 9★, 14★,
20★, 27★ … 143★ at week 16, and keeps the greedy bot's score/quota ratio inside roughly
1.5–3.6× for the whole run instead of swinging from 10× at week 5 to 1.3× at week 16.

Event weeks are meant to spike out of that band; when refitting the curve, fit the quiet weeks
and give the event weeks a separate, lower target so they stay passable.

## Balance

Transports bring travellers; amenities multiply what each traveller is worth. The catalogue is
tuned so both are worth building. The numbers that hold that balance up:

- Transport `batch` sizes are small and their exit `mult` / `flat` bonuses are modest, so a
  traveller who walks straight from arrival to departure is worth very little.
- Amenity `mult` / `flat` are large, pull `rate` runs 0.36–0.85 and radii are 2–4, so most
  travellers make two or three stops on the way across.
- Traveller stop `budget` (7–12 by tier) has to cover those stops, and every detour risks
  stranding at the end of the week — that tension is the game. In practice `sim.ticks`
  binds before the budget does: travellers run out of *week*, not out of stops.
- Transports cost roughly twice what a comparable amenity costs.

A week is 24 ticks: 16 of arrivals (`sim.spawnTicks`) then 8 to clear the board. Those
cleanup ticks decide how many travellers strand — on a transport-heavy board stranding runs
~13%, on an amenity-dense one ~63%, and raising `sim.ticks` moves both far more than the stop
budget does.

`node harness/marginal.mjs` reports the per-tile spread. At week 6 the cheap road transports
lead at 22–36 stars per $100, and the good amenities interleave with the mid-game transports
at 11–18; no ordinary tile is a trap. `node harness/autoplay.js --runs 8` should show the
greedy bot holding a fairly even 1.5–3.6× over quota all run, with deaths spread across weeks
8, 12 and 16 rather than piling up at the end; if a change moves that, the `quota` block in
`src/config.js` holds the dials.

Event weeks are the spikes, and they need re-checking after any catalogue change: an event's
difficulty is its quota multiplier divided by how much it cuts the board's score, and they
should all land between about 0.9× and 1.6×. Inspection is the cautionary tale — once
amenities carried half the score, closing every un-upgraded one made that week 5× harder than
a normal one, so it now restricts them to 70% instead of shutting them. Strike has the same
shape of hazard: on a board with only one transport terrain it would score exactly zero, so
there it drops to a skeleton service (`sim.strikeSkeletonBatch`) instead.

## Not in this pass

- Subway layer (Subway Entrance and Submarine Dock are not in the pool).
- Gravity Well Concourse; Rain Check card; Concession Monopoly ordinance.
- Tile unlock progression (all tiles are available; modes unlock by best week reached).
- Web worker for the simulator (a week simulates in a few milliseconds, so it runs inline for now).
- Daily seed and audio.
