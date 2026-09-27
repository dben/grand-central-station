# Upscale paintings

The transports' and their vehicles' colours at twice the density, from
`harness/upscale.mjs`. Unlike the shops and floors, these add no shapes:
`harness/isoart.mjs` bakes each tile from its code art as always
(`harness/tileart.mjs`), every code pixel becoming 2 x 2 with its layer, cell
and face, and takes only the colours from here, where the painting covers
them. So nothing can move or be cut, and a vehicle stays its own sheet.

- `<key>_<turn>.png` is turn `<turn>` of sheet `<key>` (a tile, a lane piece,
  or a vehicle, `<key>_veh<n>`) painted, over its code art's box at twice the
  density.
- `<key>_<turn>_code.png` is the code art it was guided by (floor under over),
  kept so a later run is guided by it and not by a painting; `log.json` has
  where each sits (`code`) and how each painting fitted (`overlap` with the
  code art's outline, `drift`: the mean change of colour, 0-255).

Touch a painting up in any image editor, then rebake (`node harness/isoart.mjs
bus_stop`). If a tile's drawing changes in `tileart.mjs`, delete its files here
(the paintings no longer match) and upscale it again. Design doc §13.3.
