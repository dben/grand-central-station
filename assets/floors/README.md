# Floor pictures

The walk-through tiles' board art (the waiting area, the lounges, the parks,
WiFi, the walkway, the guard post and the checkpoint's floor), painted again in
more detail by an image model from their own code art, by
`harness/floorgen.mjs`. `harness/isoart.mjs` bakes them into the sheets in
`../iso/`; the game never loads these files itself.

- `<key>_<view>_floor.png` is the floor the crowd walks on, and
  `<key>_<view>_over.png` what stands over it (a park's tree tops, a lounge's
  glass rim), in the sheets' 2:1 projection at twice their density, over the
  box `floorBox` in `harness/shopart.mjs` gives.
- `<key>_<view>_code_*.png` is the code art each painting was guided by, kept
  so a later run is guided by it and not by a painting.
- `log.json` says which painting each came from and how closely it covers the
  code art's outline (`overlap`, 1 is exact).

They are plain pictures: touch them up in any image editor, then rebake the
tile (`node harness/isoart.mjs waiting_area`). Design doc §13.3 says how it
all works.
