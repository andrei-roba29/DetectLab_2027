# Romanian view: historical sheets must really cover Romania

## What changed

The Romanian country view no longer offers the Central-European series that
*publish* a rectangle over northern Romania but carry **no Romanian sheet**.
The layer window (`#transpPanel`, the premium “Hărți istorice / Historical
maps” group) keeps only the sheet that really has Romanian data — and even
that one only while the view actually shows the far north of the country.

Removed for `RO` (country view):

| Row / sheet | CENAGIS id | Why |
| --- | --- | --- |
| Übersichtskarte von Mitteleuropa (1893–1945) | `ukvme` | box spans RO, zero Romanian sheets (curated `pct` was a bbox-graze artefact) |
| Harta Wojciech Chrzanowski (1859) | `chrzanowski` | same |
| Harta Central-Europa – Reymann (1806–1908) | `reymann` | same |
| Karte des Deutschen Reiches (1878–1945) | `kdr` | same |
| Karte des Deutschen Reiches – Großblatt (1914–1944) | `kdr_gb` | same |

Kept, but **viewport-gated**:

| Row / sheet | CENAGIS id | Rule |
| --- | --- | --- |
| Harta tactică a Poloniei – WIG 1:100k (1919–1939) | `wig100k` | shows for `RO` **only while the far north of Romania fills the view** |

### Why a region gate instead of just dropping the row

The WIG 1:100k tactical series is the only shared sheet with real (if
marginal) Romanian data: a sliver in Maramureș and northern Bucovina. Its
published extent is `[[47.5, 14.0], [56.0, 33.0]]`, i.e. half of Central
Europe — at the locked Romania fit (`43.62 … 48.27 N`) the rectangle rule
always intersects the viewport, so the row used to sit in the panel while the
user looked at Bucharest. Coverage rectangles are capability boxes, not data.

The row therefore keeps its country attribution (it *is* aferentă țării) and
the **viewport pass** decides from the region the sheet really covers:

- `SHARED_PREMIUM_VIEWPORT_REGIONS.wig100k.RO = [[47.55, 22.25], [48.30, 27.25]]`
  (`js/map-app.js`) — far north of Romania: Maramureș + northern Bucovina +
  the northern tip of Botoșani.
- `viewportShowsRegion(mapBounds, region)` requires the region to be the
  **subject of the view**: the two rectangles must intersect **and** either at
  least **30 % of the visible latitude span** lies inside the region **or** the
  view centre is inside it. That is what separates “looking at the far north”
  from “the far north happens to be near the top of the screen”:
  - locked country fit (whole Romania, ~4.65° of latitude, centre over
    Transylvania) → the 0.75° strip is ~15 % of the view, centre outside → row
    hidden;
  - zoomed/panned into Suceava / Maramureș → the strip is most of the view
    (and/or holds the centre) → row shown;
  - back south of the Carpathians → hidden again (the pass runs on every
    `moveend` / `zoomend` / `resize`).
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
  (Alps, outside the curated analysis); Poland/Ukraine keep the WIG sheets.
- Layer on/off state is never touched — the filter only hides rows. Leaving the
  locked view (`Exit view` / `unfilterLayersForCountry`) restores every row with
  its previous switch.
- The unlocked map (no country selected) still follows the published extents:
  there is no country context to attribute a sheet to, and the same boxes do
  carry data for Romania's neighbours.

## Files

- `js/historical-eu-maps.js` — `COUNTRIES_DATA` for `RO` is now
  `[{ id: 'wig100k', pct: 1.2, viewportRegion: 'RO_FAR_NORTH' }]`; the five
  Central-European sheets are dropped from the Romanian list with a comment
  explaining why.
- `js/map-app.js`
  - `SHARED_PREMIUM_COUNTRIES` — `RO` removed from `ukvme`, `chrzanowski`,
    `reymann`, `kdr`, `kdr_gb` (kept for `wig100k`).
  - `SHARED_PREMIUM_VIEWPORT_REGIONS` — new table: `wig100k → { RO: [box] }`,
    attached to the premium `layerDefs` entry as `viewportRegions`.
  - `selectedCountryIso()` / `viewportRegionFor()` / `viewportShowsRegion()` —
    the region gate; `checkLayerVisibility()` applies it per row before the
    normal `bounds` intersection.
  - `filterLayersForCountry()` — re-runs the viewport pass after applying the
    country classes, so region-gated rows are correct immediately.
- `test-country-layer-filter.js` — new `RO` block: the five rows hidden, WIG
  1:100k attributed but viewport-hidden at the country fit, shown over the far
  north, hidden again south of the Carpathians, all restored on exit.
- `test-historical-eu-maps.js` — Romania's curated list is asserted to be the
  WIG 1:100k entry only, with its `viewportRegion` marker.
- `index.html` / `sw.js` — version bumps
  (`js/map-app.js?v=20261101-ro-hist-sheets`,
  `js/historical-eu-maps.js?v=20261101-ro-hist-sheets`, shell `v355`).

## Manual QA

1. `python3 -m http.server` at the repo root → open the app, pick **România**
   on the globe.
2. Open the layers window → Historical maps: Mitteleuropa, Chrzanowski,
   Reymann, KDR 1:100k and KDR Großblatt are **not** listed; WIG 1:100k is not
   listed at the country fit either.
3. Zoom/pan into Maramureș or northern Bucovina → “Harta tactică a Poloniei –
   WIG 1:100k (1919–1939)” appears. Turn it on, then zoom back to Bucharest →
   the row disappears again (the overlay stays on the map, the switch state is
   kept).
4. Switch the dock to **Danemarca** → Mitteleuropa / Chrzanowski / Reymann /
   KDR 1:100k are listed again (curated coverage), WIG sheets are not.
5. **Exit view** → every row comes back.
6. `node test-country-layer-filter.js` and `node test-historical-eu-maps.js`.
