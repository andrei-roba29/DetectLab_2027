# Romanian view: historical sheets must really cover Romania

## What changed

The Romanian country view no longer offers the Central-European series that
*publish* a rectangle over northern Romania but carry **no Romanian sheet**,
and the two sheets that only reach a **region** of the country (WIG 1:100k →
far north, Valahia 1855-1859 → southern half) are listed only while the view
actually shows that region. The layer window is `#transpPanel`, the premium
“Hărți istorice / Historical maps” group.

Removed for `RO` (country view):

| Row / sheet | CENAGIS id | Why |
| --- | --- | --- |
| Übersichtskarte von Mitteleuropa (1893–1945) | `ukvme` | box spans RO, zero Romanian sheets (curated `pct` was a bbox-graze artefact) |
| Harta Wojciech Chrzanowski (1859) | `chrzanowski` | same |
| Harta Central-Europa – Reymann (1806–1908) | `reymann` | same |
| Karte des Deutschen Reiches (1878–1945) | `kdr` | same |
| Karte des Deutschen Reiches – Großblatt (1914–1944) | `kdr_gb` | same |

Kept, but **viewport-gated** by the region the sheet really covers:

| Row / sheet | CENAGIS id | Region | Rule |
| --- | --- | --- | --- |
| Harta tactică a Poloniei – WIG 1:100k (1919–1939) | `wig100k` | far north (`47.55 … 48.30 N, 22.25 … 27.25 E`) | listed only while the far north is the subject of the view |
| Valahia 1855-1859 | `walachia` | southern half (`43.50 … 45.65 N, 21.90 … 28.65 E`) | listed only while the bottom half of Romania is the subject of the view |

### Why a region gate instead of just dropping the rows

Coverage rectangles are capability boxes, not data:

- **WIG 1:100k** (Polish tactical series, 1919–1939) is the only shared sheet
  with real (if marginal) Romanian data: a sliver in Maramureș and northern
  Bucovina. Its published extent is `[[47.5, 14.0], [56.0, 33.0]]` — half of
  Central Europe — so at the locked Romania fit (`43.62 … 48.27 N`) the
  rectangle rule always intersects the viewport and the row sat in the panel
  while the user looked at Bucharest.
- **Valahia 1855-1859** (Szathmári sheet, XYZ tiles) has no published extent of
  its own: it fell back to the whole-country box `[[43.5, 19.5], [48.5, 30.5]]`,
  so its row was offered over Maramureș and Bucovina although the map only
  covers historical Wallachia — the bottom half of today's Romania.

Both rows keep their country attribution (they *are* aferente țării,
`premium_walachia: ['RO']` / the curated `wig100k` entry) and the **viewport
pass** decides from their region:

- `PREMIUM_VIEWPORT_REGIONS` (`js/map-app.js`) — per-country `{ bounds,
  minShare }`, attached to the premium `layerDefs` entry as `viewportRegions`:
  - `wig100k.RO = { bounds: [[47.55, 22.25], [48.30, 27.25]], minShare: 0.30 }`
    — Maramureș + northern Bucovina + the northern tip of Botoșani.
  - `walachia.RO = { bounds: [[43.50, 21.90], [45.65, 28.65]], minShare: 0.55 }`
    — Oltenia + Muntenia, Danube to the Carpathians.
- `viewportShowsRegion(mapBounds, region)` requires the region to be the
  **subject of the view**: the two rectangles must intersect **and** either at
  least `minShare` of the visible latitude span lies inside the region **or**
  the view centre is inside it. That separates “looking at that part of the
  country” from “it happens to be somewhere near the edge of the screen”:
  - locked country fit (whole Romania, ~4.65° of latitude, centre over
    Transylvania) → the WIG strip is ~15 % of the view (needs 30 %) and the
    south is ~44 % (needs 55 %), centres outside → **both rows hidden**;
  - zoomed/panned into Suceava / Maramureș → WIG shown, Valahia stays out;
  - zoomed/panned into Muntenia or Oltenia (Bucharest, Craiova, Pitești) →
    Valahia shown, WIG hidden;
  - back to the opposite end of the country → hidden again (the pass runs on
    every `moveend` / `zoomend` / `resize`).
- `premiumMapCoverageBounds.walachia.bounds` now carries the same Wallachia
  footprint, so the *unlocked* viewport filter also stops offering the row over
  Bucovina/Banat (it used to inherit the whole-country fallback box).
  `noCoverageRect: true` keeps the red “coverage” rectangle off the map — the
  Valahia tiles are XYZ from z0, there is no empty zoom range to mark.
- The country filter re-runs the viewport pass right after a selection
  (`filterLayersForCountry` → `window.checkLayerVisibility()`), so the panel is
  already correct on the first frame of the Romanian view instead of waiting
  for the next map move.

### Semantics kept

- The lists are the *curated* coverage of the CENAGIS catalog
  (`COUNTRIES_DATA` in `js/historical-eu-maps.js`) and the mirror used by the
  premium rows (`SHARED_PREMIUM_COUNTRIES` in `js/map-app.js`); the drift guard
  in `test-historical-eu-maps.js` still asserts both agree.
- Nothing changes for the other countries: Denmark keeps Mitteleuropa /
  Chrzanowski / Reymann / KDR 1:100k (they really cover Danish territory) and
  still does not see the WIG sheets; Italy keeps the Central-European sheets
  (Alps, outside the curated analysis); Poland/Ukraine keep the WIG sheets;
  Banat/Bucovina/Transylvania sheets keep their own footprints.
- Layer on/off state is never touched — the filter only hides rows. Leaving the
  locked view (`Exit view` / `unfilterLayersForCountry`) restores every row with
  its previous switch. A layer that is already on stays on the map.
- The unlocked map (no country selected) has no country attribution, so it
  follows the published extents — now the real ones for Valahia, and the
  sheet's own box for the shared CENAGIS series.

## Files

- `js/historical-eu-maps.js` — `COUNTRIES_DATA` for `RO` is now
  `[{ id: 'wig100k', pct: 1.2, viewportRegion: 'RO_FAR_NORTH' }]`; the five
  Central-European sheets are dropped from the Romanian list with a comment
  explaining why.
- `js/map-app.js`
  - `SHARED_PREMIUM_COUNTRIES` — `RO` removed from `ukvme`, `chrzanowski`,
    `reymann`, `kdr`, `kdr_gb` (kept for `wig100k`).
  - `PREMIUM_VIEWPORT_REGIONS` — the per-country region table
    (`wig100k` → far north, `walachia` → southern half), attached to the
    premium `layerDefs` entries as `viewportRegions`.
  - `premiumMapCoverageBounds.walachia` — real Wallachia footprint
    (`[[43.50, 21.90], [45.65, 28.65]]`, `noCoverageRect: true`).
  - `selectedCountryIso()` / `viewportRegionFor()` / `viewportShowsRegion()` —
    the region gate; `checkLayerVisibility()` applies it per row before the
    normal `bounds` intersection.
  - `filterLayersForCountry()` — re-runs the viewport pass after applying the
    country classes, so region-gated rows are correct immediately.
- `test-country-layer-filter.js` — new `RO` block: the five rows hidden; WIG
  1:100k and Valahia attributed but viewport-hidden at the country fit; WIG
  shown over the far north and hidden over Muntenia; Valahia shown over
  Muntenia/Bucharest and hidden over Maramureș and Cluj; all restored on exit.
- `test-historical-eu-maps.js` — Romania's curated list is asserted to be the
  WIG 1:100k entry only, with its `viewportRegion` marker.
- `test-layer-visibility.js` — the Banat and Bucovina viewports no longer list
  Valahia (its real footprint is the southern half of the country).
- `index.html` / `sw.js` — version bumps
  (`js/map-app.js?v=20261101-ro-region-sheets`,
  `js/historical-eu-maps.js?v=20261101-ro-hist-sheets`, shell `v356`).

## Manual QA

1. `python3 -m http.server` at the repo root → open the app, pick **România**
   on the globe.
2. Open the layers window → Historical maps: Mitteleuropa, Chrzanowski,
   Reymann, KDR 1:100k and KDR Großblatt are **not** listed; neither WIG 1:100k
   nor Valahia 1855-1859 is listed at the country fit.
3. Zoom/pan into Maramureș or northern Bucovina → “Harta tactică a Poloniei –
   WIG 1:100k (1919–1939)” appears, Valahia does not. Turn it on, then zoom
   back to Bucharest → the WIG row disappears again (the overlay stays on the
   map, the switch state is kept).
4. Zoom/pan into Muntenia or Oltenia (Bucharest, Craiova, Pitești) → “Valahia
   1855-1859” appears, WIG 1:100k disappears. Go up to Cluj or Iași → Valahia
   disappears again.
5. Switch the dock to **Danemarca** → Mitteleuropa / Chrzanowski / Reymann /
   KDR 1:100k are listed again (curated coverage), WIG sheets and Valahia are
   not.
6. **Exit view** → every row comes back; no red coverage rectangle appears for
   Valahia at any zoom.
7. `node test-country-layer-filter.js`, `node test-historical-eu-maps.js`,
   `node test-layer-visibility.js`.

## Valahia tile footprint — the random “Harta nu poate fi încărcată”

**Symptom:** Valahia 1855-1859 switched on, sometimes drawn, sometimes replaced
by the notice *“Serviciul de hărți (DetectLab hosted map data (Supabase)) nu a
livrat o imagine validă…”*. The provider label now reads “map data” instead of
“Finnish layer data”, which was misleading for a Romanian sheet.

**Cause (checked against `storage.objects` in the `Harti` bucket):**

- `Harti/charta/{z}/{x}/{y}.png` is a complete pyramid, z0–14, over **one**
  rectangle: `43.405–45.844 N × 22.258–28.389 E`. Every z has a full rectangle of
  tiles (z14: 279 × 156 = 43 524 files); nothing exists outside it.
- The layer had no `bounds`, so Leaflet asked for every tile in the viewport.
  At a country view most of those tiles lie off the sheet → **HTTP 404**.
- The guard treats a failed tile as a failed service. The layer is watch-only
  (no up-front probe), so it tripped after 3 failed tiles with no success yet.
  Which tiles answered first decided the outcome: sometimes a sheet tile came
  first (works), sometimes three empty tiles did (notice, 60 s cooldown).
- Separately, one transient Supabase error on any tile counted the same way.

**Fix (`js/map-app.js`, `index.html` and `sw.js` tags bumped to
`20261101-walachia-footprint` / `detectlab-v362-walachia-footprint`):**

- `L.tileLayer` gets `bounds: [[43.405048, 22.258301], [45.844107, 28.388671]]`
  (the sheet edges, rounded inward to 1e-6). Leaflet's `_isValidTile` then never
  requests an off-sheet tile, so an empty 404 cannot be read as an outage.
- A failed tile is retried twice (700 ms, then 1.8 s) with a fresh `_dl_retry=`
  URL before it reaches Leaflet's `tileerror`, so a transient blip does not trip
  the guard. A tile that recovers is reported as loaded.

**Coverage:** `test-walachia-footprint.js` checks the bounds against the storage
index (every sheet tile overlaps, the ring just outside does not, at every zoom),
the retry sequence, and the shipped tags. `test-country-layer-filter.js` and
`test-roman-reference-layer.js` now pin the new `map-app.js` tag.

**Manual QA:** turn Valahia on at the Romania country view, at zoom 7–9 over
Cluj and at zoom 10+ over Bucharest, and zoom out and in repeatedly. It should
never show the notice for a healthy service. Off-sheet areas show no sheet
(expected) instead of a notice.
