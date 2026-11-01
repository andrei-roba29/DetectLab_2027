// Regression: the LiDAR photo-effect area must stay glued to the ground.
//
// Reported: applying LiDAR settings made the map twitch around the prepared
// circle; after a 2D -> 3D -> 2D round trip the circle slid around on pan/zoom
// and the area glitched aggressively.
//
// Root causes pinned here:
//   1. the hole punched in the original LiDAR tiles was computed from screen
//      rects (getBoundingClientRect) and painted in tile-local pixels. Leaflet
//      animates zoom levels with CSS scale/rotate on ancestor containers, and a
//      3D hand-off can return a rotated map, so the screen rect is not the tile's
//      local origin/scale. The mask must be projected into each tile's OWN zoom
//      level so it transforms with the tile.
//   2. the SVG selection outline used the renderer's zoom animation, which is
//      not rotation-aware: at bearing != 0 it swung away mid-zoom. The outline
//      pane must be a leaflet-zoom-hide pane so it is hidden while the zoom
//      animates and reappears glued to the (stable) processed area.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync('js/lidar-photo-filter.js', 'utf8');

// [1] No screen-space rect reads in the mask path.
const maskPath = src.slice(src.indexOf('function tileMask'), src.indexOf('function onPhotoTileLoad'));
assert(!/getBoundingClientRect/.test(maskPath), 'mask geometry must not read screen rects');
assert(/map\.project\(session\.center,\s*z\)/.test(maskPath), 'mask centre is projected into the tile zoom');
assert(/coords\.x/.test(maskPath) && /coords\.y/.test(maskPath), 'mask is offset by the tile coordinate');

// [2] Functional: tileMask is a pure geographic projection.
function project(latlng, z) {
  const s = 256 * 2 ** z;
  const x = (latlng.lng + 180) / 360 * s;
  const sin = Math.sin(latlng.lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return { x, y };
}
const centre = { lat: 46.77, lng: 23.6 };
const session = { center: centre, entry: { layer: { getTileSize: () => ({ x: 256, y: 256 }) } } };
const map = { project };
const fnSrc = src.slice(src.indexOf('function tileMask'), src.indexOf('function applyClip'));
const ctx = { session, map, Number, Math };
vm.createContext(ctx);
vm.runInContext(fnSrc + '\nthis.tileMask=tileMask;', ctx);
const tileMask = ctx.tileMask;

for (const z of [10, 15, 18]) {
  const p = project(centre, z);
  const coords = { z, x: Math.floor(p.x / 256), y: Math.floor(p.y / 256) };
  const m = tileMask(coords);
  // The centre lands inside the tile that contains it.
  assert(m.x >= 0 && m.x < 256 && m.y >= 0 && m.y < 256, `centre inside tile at z${z}`);
  // Inverting the mask offset returns the exact projected centre.
  assert(Math.abs((coords.x * 256 + m.x) - p.x) < 1e-6, 'mask x recovers centre');
  assert(Math.abs((coords.y * 256 + m.y) - p.y) < 1e-6, 'mask y recovers centre');
  // Radius doubles with each zoom level (metres are fixed on the ground).
  const m2 = tileMask({ z: z + 1, x: coords.x * 2, y: coords.y * 2 });
  assert(Math.abs(m2.radius / m.radius - 2) < 1e-6, 'radius scales with zoom');
}
// A neighbouring tile gets a different local offset, same radius.
const z = 15, p = project(centre, z);
const a = tileMask({ z, x: Math.floor(p.x / 256), y: Math.floor(p.y / 256) });
const b = tileMask({ z, x: Math.floor(p.x / 256) + 1, y: Math.floor(p.y / 256) });
assert(Math.abs(a.radius - b.radius) < 1e-9, 'radius is per-zoom, not per-tile');
assert(Math.abs((a.x - b.x) - 256) < 1e-6, 'adjacent tiles differ by one tile width');

// [3] Settled passes only flip visibility; they do not repaint masks every move.
assert(/if \(visible !== maskVisible\)/.test(src), 'masks are not recomputed on every pan/zoom');
assert(/map\.on\('zoomend moveend resize', settleMasks\)/.test(src), 'visibility still settles after gestures');

// [4] The outline pane is hidden during zoom animation (rotation-safe).
assert(/map\.createPane\('rvt-photo-marker-pane'\)/.test(src), 'outline has its own pane');
assert(/markerPane\.classList\.add\('leaflet-zoom-hide'\)/.test(src), 'outline pane is zoom-hidden');
assert(/pane:'rvt-photo-marker-pane'/.test(src), 'selection circle uses the zoom-hidden pane');

// [5] stop() resets the visibility latch so a new session re-masks.
assert(/clearMask\(\); maskVisible=null;/.test(src), 'stop resets mask visibility state');

console.log('OK — LiDAR photo mask is geographic (pan/zoom/rotation invariant) and the outline is zoom-hidden.');
