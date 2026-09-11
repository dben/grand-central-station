// Sprite manifest: tile key -> PNG drawn in the shape's BASE orientation
// (see src/sim/shapes.js) at 32px per cell, covering the bounding box.
// The renderer clips the image to the tile's cells and rotates/mirrors it to
// match the placed orientation, so one image per tile type is enough.
// Missing files fall back to the flat coloured rendering.
// The bundler (harness/build.js) inlines these as data URIs in dist/.
//
// Tiles draw in two layers with the crowd between them (see render.js):
// SPRITES_FLOOR is the under layer - the interior a traveller stands on, like
// a lounge's seating or a shop's tiling - and SPRITES is the over layer, the
// walls and roof that hide anyone inside. A tile may have either or both.
export const SPRITE_CELL_PX = 32;
export const SPRITES = {
  bus_stop:      'assets/tiles/bus_stop.png',      // I2  64x32
  parking_lot:   'assets/tiles/parking_lot.png',   // O4  64x64
  train_station: 'assets/tiles/train_station.png', // I4  128x32
  ferry:         'assets/tiles/ferry.png',         // L4  64x96
  helipad:       'assets/tiles/helipad.png',       // O4  64x64
  jetway:        'assets/tiles/jetway.png',        // L3  64x64 (tip top-left, foot bottom-right)
  food_stand:    'assets/tiles/food_stand.png',    // I2  64x32
  burger:        'assets/tiles/burger.png',        // L3  64x64
  coffee:        'assets/tiles/coffee.png',        // I2  64x32
  restroom:      'assets/tiles/restroom.png',      // O4  64x64
  waiting_area:  'assets/tiles/waiting_area.png',  // O4  64x64
  // gate.png (I4) predates the two-cell Security Checkpoint booth; it draws flat until redrawn at I2
};

// Under layer, same geometry and naming as SPRITES. Every entry is optional.
export const SPRITES_FLOOR = {
  waiting_area:  'assets/tiles/waiting_area_floor.png',  // O4  64x64  seating a traveller stands among
};

const cache = new Map();
function load(manifest, prefix, onLoad) {
  for (const [key, url] of Object.entries(manifest)) {
    const id = prefix + key;
    if (cache.has(id) || !url) continue;
    const img = new Image();
    cache.set(id, { img, ok: false });
    img.onload = () => { cache.get(id).ok = img.naturalWidth > 0; if (onLoad) onLoad(key); };
    img.onerror = () => { cache.get(id).ok = false; };
    img.src = url;
  }
}
export function loadSprites(onLoad) {
  load(SPRITES, '', onLoad);
  load(SPRITES_FLOOR, 'floor:', onLoad);
}
function get(id) {
  const e = cache.get(id);
  return e && e.ok ? e.img : null;
}
export function sprite(key) { return get(key); }
export function spriteFloor(key) { return get('floor:' + key); }
