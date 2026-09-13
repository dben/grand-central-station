# Grand Central Station

A browser roguelite about running a transit hub: place tiles each week, a deterministic
simulator walks a crowd across the board, and the score has to beat a rising quota. It is a
proof of concept: plain JavaScript ES modules with no framework, no build step and no
dependencies. It is deployed as-is on GitHub Pages from the repo root.

- `README.md` is the player-facing intro. Keep it short.
- `transit-hub-design.md` is the full design document: every rule and number as built, plus the
  tuning history and balance notes. **When you change a rule or a number, update the design doc
  in the same change.** Tuning decisions go in its §15 *Tuning history*, with the measurement
  that justified them.

## Commands

```bash
python3 -m http.server 8080                        # play at http://localhost:8080 (ES modules need HTTP)
node harness/selftest.js                           # invariants: rules, sim, checkpoints, rezoning (run after any change)
node harness/build.js                              # rebuild dist/grand-central-station.html (commit it)
node harness/ui-smoke.mjs                          # Playwright drive of the real page (needs `npm i playwright`)
node harness/autoplay.js --runs 8 --weeks 16       # greedy bot vs the quota curve (--difficulty hard, --no-prune: never deletes)
node harness/marginal.mjs --week 6 --seeds 12      # value of one more of each tile, in stars/$100
node harness/run.js harness/layouts/amenity_chain.json --seeds 50 --week 4
node harness/sensitivity.mjs --bot 1000 --week 9 --seeds 24   # placement landscape of a tile: best/median/negative share, jump per cell or rotation
node harness/tierboard.mjs --weeks 4,9,13 --seeds 10          # rank tiles, cards and ordinances on fixed benches -> tier-list.md
node harness/tierlist.mjs --weeks 5,9,13 --seeds 6            # the same ranking, on the bot's own boards
```

`autoplay.js`, `run.js` and `sensitivity.mjs` take `--set sim.hurry.enabled=false` (any `CONFIG`
path) to A/B a rule without editing the file. `sensitivity.mjs --dump board.json` saves the bot's
board as a layout so another build can probe the same one with `--layout`.

`harness/ui-smoke.mjs` serves the repo itself on port 8791 and prints `ok`/`FAIL` lines. The
404s it logs are missing sprite PNGs, which is expected.

## Layout

```
src/config.js        every tunable number: quota curve, AP, economy, tiers, sim constants
src/data/            tiles (catalogue + upgrades), events + milestones, cards, ordinances, modes, difficulties
src/sim/board.js     grid, terrain claims, placement legality, walk map, checkpoint fences
src/sim/sim.js       headless deterministic week simulator (no DOM)
src/game/run.js      run state, shop generation, actions, settlement, save format
src/ui/main.js       DOM chrome, modals, playback, input wiring
src/ui/render.js     isometric Canvas 2D renderer (cell-by-cell depth sort)
harness/             selftest, balance tools, bundler, Playwright smoke test
harness/bot.mjs      the greedy bot as a module (playRun); autoplay and sensitivity build boards with it
```

## Rules of the codebase

- **Numbers live in data, not code.** Balance values go in `src/config.js` or `src/data/*.js`;
  the simulator and UI read them. Special tile behaviour is keyed by `special` (`wifi`,
  `walkway`, `waiting`, `gate`, `security`, `green`, `loop`, `anytier`) and walk-through floor
  by `walkable: true`. A tile with `modes: ['waterfront']` is sold on those levels only
  (`soldOnLevel`), and a lock-terrain tile with `reach: N` may sit N squares inland with a
  jetty or taxiway run out, the way a road tile runs a driveway.
- **transit-hub-design.md is a living document** - use it for current state goals, but update it 
  as the user adjusts. 
- **The simulator must stay deterministic and DOM-free.** It runs in Node for the harness and in
  the browser for play. Randomness is stateless: every roll is `roll(traveller, question, ...)`
  in `sim.js`, a hash of the traveller's spawn slot and what is being decided (`mix` in
  `rng.js`), never a shared stream. That is what keeps a one-tile change from re-rolling the whole
  week, so a new roll needs its own tag in `R` and a key that names *who* and *what*, not a counter.
- **A change to the sim is only correct if a tile out of everyone's way still changes nothing.**
  `selftest.js` checks that (a corner vending machine leaves every untouched traveller's key,
  value and outcome identical), and that hurried travellers still board and the fence stops at
  buildings. Keep those passing rather than loosening them.
- **The preview caches the "without" sims** (`estimateRun` in `src/game/run.js`, keyed on seed,
  week, mods and the serialised board). Any new run-state input to the sim has to be part of
  `computeMods` or that key, or the badge will quote a stale week.
- **Saves are not migrated.** When you change the shape of saved state (run-state fields, board
  or tile records), bump `SAVE_VERSION` in `src/game/run.js`. Older saves are reported to the
  player and discarded — don't write compatibility shims.
- **Rebuild `dist/`** with `node harness/build.js` after source changes, so the single-file
  build stays current.
- **Match the surrounding style:** compact, one-line helpers, and comments that explain *why*
  rather than what.

## Balance workflow

A change that touches scoring, the economy or the catalogue isn't done until it's measured:

1. `node harness/autoplay.js --runs 8 --weeks 16`, compared against the baseline in design doc
   §14.2. Vary `--seed0` (e.g. 1000 and 2000) before trusting a shift; 8 runs is noisy.
2. For a single tile, sweep its placements with `harness/sensitivity.mjs --tiles <key>`: best
   spot, median, and share of negative placements are the numbers the tuning history uses. Use
   `harness/marginal.mjs` for the value per dollar.
3. **Placement sensitivity.** Anything that touches paths, service rolls, stranding or the
   checkpoint must also keep the landscape smooth: run `sensitivity.mjs` on the bot boards
   (`--bot 1000 --week 9`, `--bot 1001 --week 9`, `--bot 1002 --week 12`, 24 seeds) and compare
   the `REL` line with design doc §14.2. Board 1000 is a two-tile board — seed 1000 dies in
   week 1 — so read 1001 and 1002 for the landscape, and 1000 as the small-board end of the
   range. Watch three things: the *shift* and *rotate* jumps (1.7–4.1% and 2.0–4.7% of the
   week's score now), the *noise* floor (about 1%; if it climbs, a roll has stopped being keyed
   by traveller and question), and *stranded* (10–40%; the clock rule in `sim.hurry` is what
   holds it there). A/B a rule on the same board with `--set` rather than by editing config, and
   `--dump` a board if you need to probe it under another build.
4. If survival or the score/quota band moves, adjust the `quota` block in `src/config.js`, not
   individual tiles.
5. Record what you measured in the design doc.

`tier-list.md` is the graded output of `tierboard.mjs`. Regenerate and re-grade it whenever the
catalogue, the cards or the ordinances change; the letters are quantiles of the ranking, so they
only mean anything against a current run.
