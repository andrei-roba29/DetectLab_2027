# Planuri de tragere — vector tiles („Dezactivează fundal”)

The 1:20 000 firing-plans layer exists twice on the site. Both describe the
same sheets; the visitor chooses which one is on the map with one checkbox.

| | source | what it is |
|---|---|---|
| **raster** (default) | `services.geo-spatial.org` WMS, `eharta:mozaic_planuri_tragere_20k` | the aged map image itself — the historical sheet |
| **vector** (opt-in) | `dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/planuri_tragere_vector/tiles/{z}/{x}/{y}.pbf` | the same sheets traced as MVT/PBF tiles |

## The control

`#firingPlansDisableBg` — **„Dezactivează fundal” / „Disable background”** —
sits inside the firing-plans row, under its opacity slider
(`index.html`, right after `#firingPlansOpacitySlider`). The label is translated
in all 25 menu languages (`layer_disable_background`).

Two more controls come with it, but only while the box is ticked:

- `#firingPlansVectorOpacity` — the vector's own opacity (the pane carries it;
  `Leaflet.VectorGrid` has no `setOpacity`);
- `#firingPlansVectorStatus` — one `role="status"` line for loading/failure.

## Behaviour

- Box **off** → unchanged: the WMS mosaic, exactly as before.
- Box **on** → the raster is taken off the map and the vector tiles are drawn
  in its place. The row's own switch (`#firingPlansToggle`) stays the master:
  with the row off, neither layer is on the map.
- The vector is drawn as **an orange outline (#ff7a00), 3 px, with NO fill**, so
  the basemap stays fully readable underneath while the traced boundaries are
  very visible. Stray points become 4 px rings, still unfilled.
- The choice is remembered (`localStorage` key
  `detectlab.firingPlansVectorOn`) and restored on the next visit.

## Implementation

`js/firing-plans-vector.js` owns the layer and the pane
(`pane_firingplans_vector`, z-index 642, `pointer-events: none`). It never
rebuilds or mutates the WMS layer that `js/map-app.js` owns — it only adds or
removes it from the map.

Everything is lazy:

1. `js/map-app.js` owns the two globals the markup calls
   (`setFiringPlansVectorBackground`, `setFiringPlansVectorOpacity`); they
   persist the choice and fetch the module on first use, so the checkbox works
   before the module exists.
2. `js/firing-plans-vector.js` fetches `js/Leaflet.VectorGrid.js` only when the
   box is actually ticked — a visitor who never opens this row downloads
   neither.

The MVT layer name is decided by the converter, not by us, so the style table
resolves **any** layer name: a `Proxy` where available, and a
`getDataLayerNames()`-fed table with a `redraw()` on engines without one.

## Failure modes (all reported in the row, never silent)

| symptom | what the row says |
|---|---|
| storage/CORS error on ≥3 tiles before any success | „Tile-urile vectoriale nu au putut fi încărcate.” |
| the renderer script cannot load | „Motorul de randare vectorială nu a putut fi încărcat.” |
| 6 tiles decoded but no feature at all | „Niciun obiect vectorial în această zonă” |

The last case matters: the published conversion may cover only part of the
country, and an empty viewport must not look like a broken checkbox.

## Cache

`index.html` + `sw.js` precache `js/firing-plans-vector.js` and
`js/Leaflet.VectorGrid.js`; the shell is `detectlab-v424-firing-vector`.
Tests: `node test-firing-plans-vector.js`.
