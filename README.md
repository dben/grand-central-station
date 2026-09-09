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

- Click a shop card, then click the board to place it. **R** or scroll rotates. **Esc** cancels.
- Hover a shop card or a placed tile for its details in a popup; click a tile to pin the popup (it has the Delete button).
- The top bar tints from red to green as the projected score approaches the quota, and turns gold when the projection is at least double the quota. Hover it for the numbers.
- Money is the pinball-style counter above Reroll; the squares next to it are this week's action points.
- The side panel is a timeline: last week's score, the current week, and the next four weeks with event and ordinance weeks marked. The next event is revealed; the one after it is not (Survey Crew shows it).
- Run Week sits at the top of the side panel; once all action points are spent it also appears in the middle of the board.
- Event weeks open with a popup. The chevrons collapse the shop bar and the side panel.
- Upgrade Tokens and bonus cards ask for a target: click a highlighted tile (or an edge for Rezoning Permit).
- **Run Week** simulates the week. Playback speed is 1×, 2×, 4× or Skip; the result never depends on speed.
- The weekly summary charts score against quota for the whole run; the per-tile breakdown is behind a disclosure. Edge locks apply immediately when you place a tile; the placement panel warns before you click. **Where did people walk?** shows the path heatmap.

## Layout

```
index.html                 page shell
src/config.js              every tunable number (quota curve, AP, tiers, economy, service formula...)
src/data/tiles.js          transport + amenity catalogue, bridge, named upgrades
src/data/events.js         event weeks
src/data/cards.js          bonus cards
src/data/ordinances.js     ordinances
src/data/modes.js          game modes
src/sim/rng.js             seeded PRNG with one stream per subsystem
src/sim/shapes.js          tetromino shapes and orientations
src/sim/board.js           grid, terrain claims, placement legality
src/sim/sim.js             headless deterministic week simulator
src/game/run.js            run state, shop generation, actions, settlement
src/ui/                    canvas renderer, DOM chrome, playback, persistence
harness/run.js             CLI: run a layout across N seeds, report p10/p50/p90 + per-tile saturation
harness/autoplay.js        CLI: a greedy bot plays full runs to test the quota curve
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
```

`harness/layouts/*.json` describe a board: `{ "mode": "terminal", "week": 4, "tiles": [{ "key": "train_station", "x": 4, "y": 0, "rot": 0, "level": 1 }] }`.

## Changes from the design document

Numbers were tuned with the harness and the autoplay bot; the original values are noted in `src/config.js`.

- **Quota curve** is `5000 × 1.28^(week−1)` instead of `3000 × 1.25^(week−1)`. With the document's traveller values a single bus stop cleared the original week-1 quota three times over.
- **Money** was far too plentiful: fares and amenity revenue are scaled to 35% and tile prices grow 6% per tile on the board (was 4%). Starting cash is 220 so the first two weeks are comfortable; after that one or two purchases a week is typical.
- **Last-call departure**: every transport fires a final departure on the last tick, so only travellers still walking are stranded. Without it a cadence-8 ferry stranded 70% of its passengers.
- **Transport batch sizes** are ~10–15% smaller than the document's table.
- **Same-tile trips**: a traveller whose destination is the tile they arrived on takes a wander (random waypoints, σ 2.5 cells) instead of standing still, so a lone bus stop still feeds nearby shops.
- **Week-1 shop** never offers an Upgrade Token while the board is empty; the slot becomes a second amenity.
- **Travellers step inside** an amenity for the service duration instead of pausing beside it.
- **Green Space** costs no stop budget and restores one, making it a net +1 chain extender.
- **Frequent Flier Club** only serves `$$$` and up and stacks at 0.16 per tick; Chrono Lounge stacks 0.18 with capacity 6.
- **Bridge** is implemented (an I3 tile along a claimed edge that opens the span beside it) but pulled from the shop for now via `CONFIG.shop.wildcard.bridge = 0`.
- **Corridor lanes** are freed when the corridor tile is deleted (edge claims stay permanent as designed).
- **Corridor lanes** run along the tile's long axis: a vertical ski lift reaches the north or south edge, a horizontal one east or west. Rotate to change which edge it serves.
- **Amenities only pull travellers who can reach their door.** Tiles are solid, so a pocket walled off by amenities is a closed world: travellers inside only choose destinations they can reach, and shops outside cannot pull them.
- **Jetways** must point the tip of the L (the top of the stem) at the apron edge with the foot inland. Both mirror images are legal; the other two orientations are rejected with a hint to rotate.

## Sprites

`src/ui/sprites.js` maps tile keys to PNGs in `assets/tiles/`. Each sprite is drawn in the
shape's base orientation at 32 px per cell covering the bounding box; the renderer clips it to
the tile's cells and rotates or mirrors it to match the placed orientation, so one image per
tile type is enough. Tiles without a sprite fall back to the flat coloured rendering.
`assets/tiles/README.md` lists the planned set and the Pixellab prompts; `harness/build.js`
inlines whatever PNGs exist into the single-file build. Missing sprites show up as 404s in
the console when running from a server; that is harmless.

## Testing

- `node harness/selftest.js` checks shape orientations, placement rules, terrain locks, bridges, determinism and gate filtering.
- `harness/ui-smoke.mjs` drives the real page with Playwright (`npm i playwright && npx playwright install chromium`, then `node harness/ui-smoke.mjs`). It starts a run, places tiles, runs playback, opens the summary and heatmap, picks an ordinance, upgrades and deletes via the UI, plays a Rezoning Permit on an edge, uses the strike selector, reloads and resumes a saved run, and checks the game-over and start screens.
- `window.gcs` exposes the live run state, the game API and a `refresh()` for poking at a run from the console.

## Not in this pass

- Subway layer (Subway Entrance and Submarine Dock are not in the pool).
- Gravity Well Concourse; Rain Check card; Concession Monopoly ordinance.
- Tile unlock progression (all tiles are available; modes unlock by best week reached).
- Web worker for the simulator (a week simulates in a few milliseconds, so it runs inline for now).
- Daily seed and audio.
