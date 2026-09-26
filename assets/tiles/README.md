# Tile sprites

Board art for every tile, drawn in code by `harness/tileart.mjs`; edit a tile
there and rerun it rather than editing these PNGs. It also writes the manifest,
`src/ui/tilesprites.js`.

Top-down pixel art, 32 px per cell, drawn in the shape's base orientation
(`src/sim/shapes.js`) and covering the whole bounding box. The renderer lays it
flat on the isometric grid, clips it to the tile's cells and rotates/mirrors it
as needed, so one image per layer covers every rotation.

- `<key>.png` is the over layer: roofs, vehicles, tree tops. The manifest's
  `SPRITE_BLOCKS` marks the parts of it that stand up off the floor.
- `<key>_floor.png` is the under layer, with the crowd walking over it.

A tile with `pad` in `tileart.mjs` has a wider image: the extra band is drawn
past the board when the tile sits against its edge (the cruise ship, a train).

The bottom of a transport's image is its working side (road, track, berth); the
renderer turns it toward the edge the tile draws from. Design doc §13.3 has the rest.

`harness/isoart.mjs` bakes these into the isometric sheets in `assets/iso/`
(and their manifest, `src/ui/isosprites.js`), which the renderer draws by
default; rerun it after `tileart.mjs`. Each `assets/iso/<key>.png` is a plain
picture of the tile's four turns that can be touched up in an image editor;
`<key>_map.png` beside it holds the lighting and cell data. Rerunning the
baker overwrites both. It also writes the ground textures in `assets/ground/`
(grass, sea, road, rail, apron, runway, concourse), likewise plain pictures.
Design doc §13.3 says how.
