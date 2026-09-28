# Shop pictures

The solid shops' board art, painted by an image model and fitted to their
footprints by `harness/shopgen.mjs`. `harness/isoart.mjs` bakes them into the
sheets in `../iso/`; the game never loads these files itself.

- `<key>_<view>.png` is the shop seen in one turn, in the sheets' 2:1 projection
  at twice their density (a cell is 128 pixels across), on a clear background.
  A shop needs one picture per footprint its turns show: one for an I or O
  shape, two for an S or T, three for an L3, four for the L4. Which turn uses
  which picture, flipped or not, is `shopViews` in `harness/shopart.mjs`; a
  flipped turn keeps the light as painted.
- `log.json` says, for each view, which painting it was cut from, the model
  that painted it, the biggest piece the bake cuts away (`chop`, as a share of
  its paint), the share of its block left bare (`bare`), how much of a notch
  it roofs over (`roof`) and how much paint was left hanging over a carved
  notch (`hang`). Over 1.5% chop, 15% bare, 50% roof or 2% hang, the painting
  is the wrong shape.
- `<key>.<part>_<view>.png` is one part of a shop painted in parts (the sports
  bar's `bar` and `patio`); its `<key>_<view>.png` pictures are composed from
  them. `pinned` in the log marks a shop chosen by eye, which `--reuse` leaves
  as it is, and `edited` a view touched up by hand (a sign pasted back on).
- Walls painted much taller than the block have been brought down (the
  plainest rows of wall taken out), and a notch at the back of a footprint has
  been carved out (the models nearly always roof it over), so what is there is
  the shop as the bake will show it, bar the cut past the footprint's columns.

They are plain pictures: touch them up in any image editor, then rebake the
shop (`node harness/isoart.mjs burger`). Anything painted past the footprint's
columns is cut away in the bake. Design doc §13.3 says how it all works.
