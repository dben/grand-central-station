# Tile sprites

Top-down pixel art, 32 px per cell, drawn in the shape's base orientation
(`src/sim/shapes.js`) and covering the whole bounding box. The renderer clips
to the tile's cells and rotates/mirrors as needed. File names match tile keys
in `src/data/tiles.js`; the manifest is `src/ui/sprites.js`.

Planned set (generated with Pixellab, `create_image_pixflux`, view "high top-down",
"medium detail", "basic shading", background on):

| file | shape | size | prompt |
|---|---|---|---|
| bus_stop.png | I2 | 64x32 | city bus stop: yellow bus beside a small glass shelter on asphalt |
| parking_lot.png | O4 | 64x64 | parking lot: asphalt, white bays, a few parked cars |
| train_station.png | I4 | 128x32 | long platform with a red passenger train alongside |
| ferry.png | L4 | 64x96 | white ferry docked at a wooden pier on blue water |
| helipad.png | O4 | 64x64 | round pad with a white H and a small helicopter |
| jetway.png | L3 | 64x64 | airliner nose at top-left, glass bridge down then right into a terminal |
| food_stand.png | I2 | 64x32 | kiosk with striped awning and grill |
| burger.png | L3 | 64x64 | small diner, red roof, burger sign, tables |
| coffee.png | I2 | 64x32 | cafe counter, espresso machine, two round tables |
| restroom.png | O4 | 64x64 | tiled floor, sinks, stalls |
| waiting_area.png | O4 | 64x64 | rows of blue seats on carpet, potted plant |
| gate.png | I4 | 128x32 | long barrier wall with one turnstile gap and a metal detector |
