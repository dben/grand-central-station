// Sprite manifest: tile key -> PNG drawn in the shape's BASE orientation
// (see src/sim/shapes.js) at 32px per cell, covering the bounding box.
// The renderer clips the image to the tile's cells and rotates/mirrors it to
// match the placed orientation, so one image per tile type is enough.
// Missing files fall back to the flat coloured rendering.
// The bundler (harness/build.js) inlines these as data URIs in dist/.
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
  gate:          'assets/tiles/gate.png',          // I4  128x32
};

const cache = new Map();
export function loadSprites(onLoad) {
  for (const [key, url] of Object.entries(SPRITES)) {
    if (cache.has(key) || !url) continue;
    const img = new Image();
    cache.set(key, { img, ok: false });
    img.onload = () => { cache.get(key).ok = img.naturalWidth > 0; if (onLoad) onLoad(key); };
    img.onerror = () => { cache.get(key).ok = false; };
    img.src = url;
  }
}
export function sprite(key) {
  const e = cache.get(key);
  return e && e.ok ? e.img : null;
}
