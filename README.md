# Grand Central Station

A turn-based tile-placement roguelite about running a transit hub, played in the browser.

Every week you place a couple of tiles, then watch a crowd of travellers cross the board. Every shop,
kiosk and lounge they pass on the way makes them worth more. Hit the week's quota or the run ends.
The quota keeps climbing, the board never grows, and the edges lock down as you build — so the only
way forward is to make every traveller worth more than the last.

## How a week works

1. **Build.** You have **2 action points** a week. Buying a tile, upgrading one, deleting one,
   rerolling the shop or playing a bonus card each costs 1 AP (plus money).
2. **Run the week.** Travellers arrive at your transports, pick a platform to leave from, and walk
   there, stopping at shops along the way. Action points you don't spend aren't wasted: starting the
   week early pays a cash bonus for each one left.
3. **Settle up.** Your score is compared against the quota, shown as stars (one per 1,000 points).
   Fares and shop revenue pay out as money for next week.

Every fourth week is an **event** that bends the rules. At weeks 5, 12 and 20 you pick a permanent
**ordinance**. Pickpockets turn up from week 7 and rare tiles from week 10. Clear week 16 to win,
then keep going as long as you can.

## Ideas that matter

- **Transports bring people; amenities make them valuable.** A traveller who walks straight from a
  bus to a train is worth almost nothing.
- **Multiply first, then add.** Each shop multiplies what a traveller is worth, then adds a flat
  bonus on top, in the order they meet them. So put the flat bonuses early on a route and the big
  multipliers late.
- **Edges are permanent.** Rail, water and airfields lock a whole side of the board to one kind of
  ground; roads are more forgiving. The placement preview warns you before you commit.
- **Go underground.** Subways, an underground car park and a submarine dock run their lines on a
  layer beneath the board. Build anything over a tunnel, but tunnels can never cross each other, and
  a subway can't surface into the sea.
- **Tiers.** Rich travellers ($$$–$$$$$) are worth far more but turn up in ones and twos, and they
  prefer shops and platforms priced for them.
- **Watch the clock.** Anyone still walking when the week ends is worth only half, and a traveller
  who can't reach their platform at all is worth nothing.

## Difficulty

Picked with the mode, and open from the first run. It scales the pressure, never the rules.

| | Quota | Tile prices | Starting cash | Fares and revenue |
|---|---|---|---|---|
| Standard | — | — | $220 | — |
| Hard | +15%, climbing faster | +15% | $187 | −10% |
| Extreme | +20%, climbing much faster | +35% | $176 | −20% |

By week 16 that gap has widened: Hard asks 1.3× Standard's quota and Extreme 1.9×.

## Modes

| Mode | Board | Twist | Unlocks |
|---|---|---|---|
| Terminal | 12×12 | The baseline | — |
| Junction | 9×9 | 3 AP a week, but the quota climbs faster | Reach week 8 |
| Waterfront | 12×12 | Two edges start as water; water transports are cheap | Reach week 8 |
| Metroplex | 16×16 | Room to spread out; tiles cost 25% more | Reach week 12 |
| Sky Harbour | 12×12 | No rail or water; free-standing transports are cheap | Reach week 12 |
| Terminus | 12×12 | 1 AP a week, but an 8-card shop | Reach week 16 |

## Controls

- **Drag** to pan, **scroll** or **pinch** to zoom; **Fit** (or **0**) reframes the board.
- **Click a card**, then click the board to place it. **R** rotates, **Esc** cancels. On touch, tap
  once to aim and again to build.
- **Hover** anything for details; **click** a tile to pin its popup (that's where Delete lives).
- While placing, the **star badge** over the tile shows what it would be worth this week. Red stars
  mean it would lose you points.
- After a week, **Where did people walk?** shows a heatmap of the crowd.
- **M** mutes the music.

## Running it locally

The live version is on GitHub Pages. To run it yourself, either:

- **Open `dist/grand-central-station.html`** — a single self-contained file that works from disk; or
- **Serve the folder** (the source uses ES modules, which browsers won't load from `file://`):

  ```bash
  python3 -m http.server 8080
  ```

  then open <http://localhost:8080/>. On Windows, `start-windows.bat` does the same.

There's no build step and no dependencies. After changing the source, refresh the single-file build
with `node harness/build.js`.

## Development

```bash
node harness/selftest.js                         # rule and simulator invariants
node harness/autoplay.js --runs 8 --weeks 16     # a greedy bot plays full runs against the quota
node harness/marginal.mjs --week 6               # what one more of each tile is worth
node harness/ui-smoke.mjs                        # Playwright drive of the real page
```

```
src/config.js        every tunable number
src/data/            tiles, events, cards, ordinances, modes, difficulties
src/sim/             board rules and the headless, deterministic week simulator
src/game/run.js      run state, shop, actions, settlement
src/ui/              isometric renderer, input, DOM chrome, audio
harness/             balance tools, tests and the single-file bundler
```

**[transit-hub-design.md](transit-hub-design.md)** is the full design document. It has every rule
and number as built, the tuning history behind them, the balance and testing notes, and how the
renderer works.
