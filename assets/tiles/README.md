# Tile sprites

Board art for every tile, drawn in code by `harness/tileart.mjs`; edit a tile
there and rerun it rather than editing these PNGs. It also writes the manifest,
`src/ui/tilesprites.js`.

Top-down pixel art, 32 px per cell, drawn in the shape's base orientation
(`src/sim/shapes.js`) and covering the whole bounding box. The renderer lays it
flat on the isometric grid, clips it to the tile's cells and rotates/mirrors it
as needed, so one image per layer covers every rotation.

- `<key>.png` is the over layer: roofs, vehicles, tree tops.
- `<key>_floor.png` is the under layer, with the crowd walking over it.

The bottom of a transport's image is its working side (road, track, berth); the
renderer turns it toward the edge the tile draws from. Design doc §13.3 has the rest.
