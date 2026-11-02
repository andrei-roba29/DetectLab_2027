# Romanian Heritage sublayers

The free **Patrimoniu / Heritage** row is now a switch-only group:

| Sublayer (RO / EN) | Switch | Opacity | Source |
|---|---|---|---|
| Patrimoniu arheologic / Archeological heritage | `patrimoniuToggle` | `patrimoniuOpacitySlider`, initially 35% | Existing CIMEC/RAN layers 0, 5 and 6, via the DetectLab API; the existing WMS fallback, pins, site polygons, protection radii, popups and clustering are retained. |
| Arii naturale protejate / Natural protected sites | `naturalProtectedToggle` | `naturalProtectedOpacitySlider`, initially 55% | The supplied public Supabase GeoPackage: `https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/ariinaturaleprotejate.gpkg` |

All switches initially remain off. The parent switch (`heritageToggle`) turns
its selected children off/on, remembering the selected subset and each opacity.
On its first activation both children are selected. A child switch or a positive
opacity enables only that child; 0% disables only that child. The parent is on
when at least one child is on. Sublayers are expanded initially and can be
collapsed without changing visibility.

`js/romania-heritage.js` owns the grouping and protected-sites overlay. The
legacy `togglePatrimoniuLayer` and `setPatrimoniuOpacity` functions and DOM ids
continue to mean **archaeology**, not the group. Detect mode therefore still
borrows/restores only archaeological data and does not change the nature layer.
The archaeological opacity now affects the site pins, polygon strokes, images
and WMS fallback as well as the existing radius canvas (in 2D and 3D). The first
archaeological data request also returns its shared promise correctly when a
switch is used before the idle preload.

The two child ranges each have their own map-side opacity mirror. There is no
parent opacity range or parent mirror. Labels are in `js/translations.js` and
its canonical `tools/en.json` / `tools/ro.json` dictionaries. The shared glass
sublayer cards are reused with scoped styles in `css/romania-heritage.css`.

## Reading the protected sites without downloading the whole country

Storage metadata reports **75,522,048 bytes** for the supplied GeoPackage.
Do not add this file or a full GeoJSON conversion to Git or the PWA precache.

* Nothing is requested for this source at startup or while its switch is off.
* Geometry is shown from **zoom 8**, with an explicit zoom-in message below it.
* `js/geopackage-reader.js` opens SQLite through the vendored
  **sql.js-httpvfs** Web Worker. A 100-byte HTTP Range probe checks that the
  host supports partial reads and discovers the SQLite page size. Missing
  range support fails explicitly instead of downloading 75 MB as a fallback.
* Only the small GeoPackage catalogue, CRS records, spatial index and selected
  feature rows are read. Table/geometry/primary-key names are discovered from
  the file, not assumed. Identifiers are quoted and values are bound.
* The vendored SQLite build lacks `ENABLE_RTREE`. The reader traverses its
  standard 2D RTree shadow nodes to obtain matching feature ids. For files
  without an RTree, it can instead read the small geometry-header envelopes
  using `substr(blob, 1, 72)`, without loading geometry overflow pages for every
  row. A non-point geometry with neither an envelope nor an index is reported
  as unsupported, not placed at made-up coordinates.
* GeoPackageBinary / WKB geometries preserve polygon holes, multipolygons,
  collections and source attributes. ISO Z/M and EWKB ordinates are consumed;
  rendering uses X/Y. Projected CRSs are reprojected to WGS84 with Proj4 and the
  file's CRS definition (with support for EPSG:4326, 4258, 3857 and Romania's
  EPSG:3844 / Stereo 70). Source attributes are HTML-escaped in popups.
* A viewport is capped at **250 features** and **12 MiB of geometry blobs**;
  overly complex geometries are skipped with a **partial-view** message, never
  silently advertised as complete. The reader has a **48 MiB lifetime read
  budget**, a 4 MiB index budget and request/query timeouts. Switching off
  terminates its worker and frees its byte cache. If the read budget is
  exhausted, the error status asks the user to switch off/on and retry.
* Pan/zoom requests are debounced and coalesced. A late request cannot repaint
  an old viewport or resurrect a switched-off layer.
* Green boundaries and translucent fills are drawn on a Leaflet canvas pane
  below the archaeological pins/radii and event/location markers. The group
  supplies its painted GeoJSON once to the existing 3D mirror; its 2D children
  are marked `_dl3dSkip` so they are not duplicated in 3D. Opacity and popups
  travel with those features.

The source is read-only, public and needs **no API key, migration, edge function
or new backend route**. It needs HTTP Range/CORS from storage and browser
WebAssembly + Web Workers, but **not** SharedArrayBuffer or COOP/COEP headers.
Changing the stored GeoPackage should be accompanied by a new `TAG` in the
module and updated asset URLs in `index.html` / `sw.js` to avoid stale partial
pages. The original object is never modified. The user supplied the dataset;
no additional provider licence or legal restriction metadata was supplied.
Do not infer permission to detect or enter land from the overlay.

## Tests

```sh
node test-romania-heritage.js
node test-romania-heritage-browser.js  # optional Playwright + Chromium; Python 3
node test-patrimoniu-canvas-transform.js
node test-patrimoniu-clustering.js
node test-detect-toggle-symmetry.js
node test-map3d-vectors-heritage-wms.js
node test-vertical-opacity-control.js
node test-two-layer-opacity-mirrors.js
node test-layer-panel-rows.js
node test-layer-visibility.js
node test-slider-deliberate-tap.js
```

If browser dependencies are installed elsewhere, set
`PLAYWRIGHT_MODULE_DIR=/path/to/node_modules` and optionally
`CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. An installed
`@sparticuz/chromium` is also supported. No dependencies or downloaded browser
binaries need to be committed.

The browser test generates a temporary standards-based SQLite/GeoPackage
fixture with a real multi-level RTree, polygons with holes, a projected table,
an unindexed table and large out-of-view geometry. It exercises **the actual
WASM worker and Leaflet/3D mirror**, as well as the full `index.html` integration
with external APIs mocked. A small viewport reads **69,621 of 4,128,768 bytes**
in 11 range requests, not the entire fixture. Tests include independent
controls, RO/EN, narrow mobile layout, opacity, limit/error/retry states,
HTML escaping and cancellation/stale-response guards. A failed runtime-asset
load is also retried correctly when switching the source off/on; a partially
loaded reader global is not mistaken for a ready SQLite/Proj4 runtime.

The live object metadata was read through the connected Supabase project, but
the live binary is outside this coding environment's outbound host allowlist;
its actual contents and storage Range/CORS responses were not downloaded or
live-verified here. No Supabase schema or storage objects were changed.

One unrelated pre-existing regression remains in
`test-vertical-slider-layer-auto-toggle.js`: after updating its stale slider
counts, it flags the existing unmapped `apmNextOpacity` control. No APM activation
behaviour is changed by this feature.
