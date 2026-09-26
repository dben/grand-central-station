# Grand Central Station

A turn-based tile-placement roguelite about running a transit hub, played in the browser.

Each week you get two action points to spend on the shop: build a tile, upgrade one, reroll the
cards or play a bonus card. Then you run the week and watch travellers pour out of your bus stops,
car parks, stations and docks, walk to the platform they want, and stop at the shops along the way.
Each shop they visit multiplies what they are worth and adds a little on top, so the order of the
stops matters, and someone who walks straight from a bus to a train scores almost nothing. Rich
travellers are worth far more but come in ones and twos, and they want shops priced for them.

Points have to beat the week's quota or the run ends. Shops and fares also pay cash, which buys
the next tiles, and once your action points are spent it can buy more. The quota rises every
week, the board never grows, and each transport claims an edge of the board for rail, water, road
or airfield for good, so space and edges run out. Every fourth week brings an event that bends the
rules, and at set weeks you pick a permanent ordinance. Clear week 16 to win, then keep going for
as long as you can; the quota climbs faster from then on.

There are six levels, from the standard 12×12 Terminal to a cramped 9×9 junction, a waterfront and
a long airport split by a security fence, and three difficulties. Standard lets you take a week
back before you run it; Hard and Extreme raise the quota and prices, cut income, and keep every
move you make.

## Controls

- **Drag** to pan, **scroll** or **pinch** to zoom, **Fit** (or **0**) to reframe.
- **Click a card**, then the board, to place it. **R** rotates, **E** switches which side a
  transport attaches by, **Esc** cancels.
- On touch, a tap aims and the bar under the board builds, rotates, switches side or cancels.
- **Hover** a tile for details; **click** it to pin them (Delete lives there).
- While placing, the star badge shows what the tile would add this week. Red means a loss.
- **M** mutes the music.

## Running it locally

Either open **`dist/grand-central-station.html`**, a single file that works from disk, or serve the
folder (the source uses ES modules, which browsers won't load from `file://`):

```bash
python3 -m http.server 8080
```

and open <http://localhost:8080/>. On Windows, `start-windows.bat` does the same. There is no build
step and nothing to install. After changing the source, rebuild the single file with
`node harness/build.js`.

## Development

```bash
node harness/selftest.js                         # rule and simulator checks
node harness/autoplay.js --runs 8 --weeks 16     # a greedy bot plays full runs against the quota
node harness/ui-smoke.mjs                        # Playwright drive of the real page
```

[transit-hub-design.md](transit-hub-design.md) has every rule and number, the tuning history and
the balance notes. `tier-list.md` grades every tile, card and ordinance.
