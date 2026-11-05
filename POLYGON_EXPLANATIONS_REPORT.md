# Highest-potential polygon explanations

## Behaviour

Every displayed highest-class polygon in APM Next-Gen now has an almost transparent filled hit surface as well as its existing outline. Clicking/tapping its interior opens a small, scrollable Leaflet popup. Holes are excluded from the hit surface. Starting search-point selection closes the popup and temporarily disables hotspot hit surfaces so the user can still pick inside an existing result.

Popup content is created on opening, in the current Romanian or English language, and includes:

- Polygon area, mean suitability index, cell-score range and highest-class cutoff.
- TRAIN's learned settings versus MANUAL's editable settings; the training period when retained in result provenance.
- The largest additive score contributions.
- For all five variables: effective weight, mean curve suitability and weighted score contribution; zero-weight variables are explicitly marked unused.
- Mean slope, relative altitude/soil percentiles, circular mean aspect with flat-cell neutralisation, and finite mean water distances by modelled class.
- Clear qualifications: suitability is not a calibrated probability, contributions are not causal effects, and the concavity/soil proxy is not a measured soil type.

Existing results without summaries and tiny interpolated outlines containing no eligible cell centres show an explicit unavailable-summary message rather than invented explanations. Re-run analysis to generate summaries for old results.

## Attribution contract

`js/apm-next/apm-explain.js` is imported only by the worker. After the existing polygonisation step, it adds `properties.explanation` (version 1) to each highest-class Polygon. Geometry, class membership, thresholds and areas are not modified.

The aggregation population is **highest-class scored cell centres inside the emitted polygon**, excluding holes, invalid/unscored cells and every nonzero exclusion-mask value, including display-only protection cells. It is not the polygon centroid or a whole-window average. Interpolated edges may contain no eligible centre; that case is explicitly represented as `status: no_cells`.

Weights and curve fits reproduce the actual scorer's additive formula:

- TRAIN uses the fitted model weights without extra normalisation, including max-over-modelled water curves and neutral aspect on near-flat terrain.
- MANUAL splits the relief weight into altitude 0.4, slope 0.4 and aspect 0.2, then normalises all terms by the same relief/water/soil denominator as the scorer.
- Reported contributions sum to mean cell score up to float/rounding precision. Mean curve fit is the mean of individual cell fits, not the curve evaluated at a mean input.
- Aspect observations use a circular mean, not an arithmetic mean of bearings. Means with opposing/mixed bearings have no single reported direction. Water distances are averaged only where finite and carry their sample counts; water suitability still follows the scorer's best-class rule, not a nearest-feature assumption.

No model, point/background sampling, settlement source/period filtering, provider, raster-resolution, fitting/CV or mask-generation logic was changed. No SQL or new server RPC exists. Hoard gates remain unchanged.

## Mobile implementation

An active-edge scan-line traversal visits polygon spans and holes without allocating per-variable rasters or testing every polygon edge against every cell in the prediction window. A single small decomposition buffer is reused. TRAIN circular-curve points are prepared once per aggregation call with the same interpolation formula as the scorer. Only compact numeric summaries are shipped to the main thread and remain in GeoJSON exports; no additional downloads, raw cell arrays or retained models are required.

Popups are lazy, have a 320 px maximum configured width/height and a narrow-viewport CSS width bound. The almost-transparent fill retains the heatmap appearance and uses even/odd fill for holes. Browser/PWA assets are re-tagged `20261105-apm-hotspot-explain`; service-worker shell is v408 and pre-caches the worker module. Previous asset URLs remain pre-cached.

## Verification

- `test-apm-hotspot-explanations.js`: seven groups covering 1,500 synthetic cells in each mode against the unchanged scorers, max-water and neutral-aspect rules, scan-line versus brute-force membership, independent per-polygon aggregates, exclusions/holes/NaN handling, circular means, no-cell fallback, real worker MANUAL/TRAIN/rescoring, unchanged contour geometry, million-cell aggregation, bilingual DOM, escaped untrusted text and PWA wiring.
- `test-apm-hotspot-popups-dom.js`: real Leaflet SVG paths, hit-test calculations, dispatched DOM clicks opening each polygon's popup, hole rejection, lazy current-language content, and new-point picking through existing fills. This is jsdom with mocked layout sizes, not physical browser/touch rendering.
- Synthetic aggregation fixture: 1,044,607 eligible centres in a 1024×1024 window with 441 holes. Standalone aggregation measured about 0.5 seconds in this sandbox, not a phone performance guarantee. No additional variable rasters are allocated.
- Full offline baseline: 149/192 scripts passed, 43 failed. Final: **151/194 passed, the exact same 43 failure identities**, two new passing scripts and no newly failing scripts. The full suite is still non-green. One intermediate run exposed a stale stylesheet-tag expectation in the dock test; its behaviour assertions were retained and its expected asset version updated.
- Snapshots: `test-results/polygon-explanations-{before,after,final,comparison}.json`.

Reproduce:

```sh
npm ci --prefix tools/apm-test
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" node test-apm-hotspot-explanations.js
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" node test-apm-hotspot-popups-dom.js
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" python tools/run-correction-suite.py polygon-explanations-final
```

Changes are saved on branch `arena/5ea665b3-detectlab-2027`. No hosting deployment or production-device validation was performed for this feature. Physical-device acceptance should check taps near borders/holes, popup scrolling/close, changing periods and rescoring, language switching, and point picking inside a previous result.
