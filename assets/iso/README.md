# Tile sheets

Board art for every tile, baked by `harness/isoart.mjs` from the drawings in
`harness/tileart.mjs`; it also writes the manifest, `src/ui/isosprites.js`,
and the ground textures in `../ground/`.

- `<key>.png` is a plain picture of the tile in the 2:1 isometric projection
  (a cell is a 64 x 32 diamond): its four quarter turns, one row each, the
  floor layer then the over layer, in its real colours and light. Touch it up
  in any image editor.
- `<key>_map.png` is the same layout holding what a picture can't: which cell
  owns each pixel (green), the face it is on (red) and how much of it is the
  tile's colour (blue). The game relights mirrored turns from it. A pixel
  painted in with no map under it goes to the cell beneath it.
- `<key>_lane.png` (and `_lane_alt`) is a corridor tile's track, one square.

Rerunning `isoart.mjs` overwrites the sheets and the ground, so after touching
a sheet up, rerun it only for the tiles you mean to redraw
(`node harness/isoart.mjs bus_stop`). Design doc §13.3 says how it all works.
