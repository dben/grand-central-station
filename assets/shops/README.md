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
- `log.json` says which painting each shop's pictures were cut from, the model
  that painted it and how well each view fitted its footprint (1 is a perfect
  cover of the block with nothing spilling past it).

They are plain pictures: touch them up in any image editor, then rebake the
shop (`node harness/isoart.mjs burger`). Anything painted past the footprint's
columns is cut away in the bake. Design doc §13.3 says how it all works.
