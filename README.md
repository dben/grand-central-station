# Grand Central Station

A turn-based tile-placement roguelite about running a transit hub, played in the browser.

Every week you place a couple of tiles, then watch a crowd of travellers cross the board. Each shop,
kiosk and lounge they pass multiplies what they're worth. Hit the week's quota or the run ends. The
quota keeps climbing, the board never grows, and the edges lock down as you build — so the only
way forward is to make every traveller worth more than the last.

## How a week works

1. **Build.** You have **2 action points** a week. Buying a tile, upgrading one, deleting one,
   rerolling the shop or playing a bonus card each costs 1 AP (plus money).
2. **Run the week.** Travellers arrive at your transports, pick a platform to leave from, and walk
   there — stopping at amenities along the way. Unspent AP isn't wasted: running early pays a cash
   bonus for each point left.
3. **Settle up.** Your score is compared against the quota, shown as stars (one per 1,000 points).
   Fares and shop revenue pay out as money for next week.

Every fourth week is an **event** that bends the rules. At weeks 5, 12 and 20 you pick a permanent
**ordinance**. Pickpockets turn up from week 7 and rare tiles from week 10. Clear week 16 to win,
then keep going as long as you can.

## Ideas that matter

- **Transports bring people; amenities make them valuable.** A traveller who walks straight from a
  bus to a train is worth almost nothing.
- **Multiply first, then add.** Each shop does `value × mult + flat`, in the order a traveller meets
  them — so flat-bonus tiles belong early on a route and big multipliers late.
- **Edges are permanent.** Rail, water and airfields lock a whole edge to one terrain; roads are more
  forgiving. The placement preview warns you before you commit.
- **Go underground.** Subways, an underground car park and a submarine dock run their lines on a
  layer beneath the board. Build anything over a tunnel, but tunnels can never cross each other, and
  a subway can't surface into the sea.
- **Tiers.** Wealthy travellers ($$$–$$$$$) are worth far more but arrive in ones and twos, and they
  prefer shops and platforms of their own tier.
- **Watch the clock.** Anyone still walking when the week ends is stranded at half value, and a
  traveller with no route to their platform banks nothing at all.

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
- While placing, the **star badge** over the tile shows what it's worth this week. Red stars mean it
  would cost you points.
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
src/data/            tiles, events, cards, ordinances, modes
src/sim/             board rules and the headless, deterministic week simulator
src/game/run.js      run state, shop, actions, settlement
src/ui/              isometric renderer, input, DOM chrome, audio
harness/             balance tools, tests and the single-file bundler
```

**[transit-hub-design.md](transit-hub-design.md)** is the full design document. It has every rule
and number as built, the tuning history behind them, the balance and testing notes, and how the
renderer works.
