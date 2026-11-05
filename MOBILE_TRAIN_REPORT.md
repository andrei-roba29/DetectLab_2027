# Settlement TRAIN: mobile memory and period-switch optimisation

## Scope

Changes are local to branch `arena/c004ee50-detectlab-2027`; no production deployment, SQL, data ingestion or hoard activation was performed.

The 50 km settlement training area, default 5,000 background samples, period/source filtering, terrain variables, robust fitting, spatial cross-validation, masks, classes and colours remain in place. Sampling and prediction grid geometry/coarsening budgets are unchanged. This is not a lower-quality model or a cache of fitted models/sites.

## Changes

- Mobile/coarse-pointer or low-memory devices stream 512-pixel sampling cores instead of up to 1,000. Provider limits still apply. This changes block size, not raster resolution. Halo padding includes the positive-site neighbourhood plus derivative/smoothing context; regression checks compare boundary samples against a full raster.
- Terminate the previous TRAIN worker before environmental downloads start. Release the water spatial index before fitting and discard unused retained prediction curvature/circle rasters.
- Transfer owned terrain, water-segment and mask buffers into the worker instead of copying them. Cached buffers retain independent ownership. Prediction transfers also benefit MANUAL.
- Skip full-grid altitude/curvature reference collection when TRAIN already supplies its background references; retain independent reference calculation for MANUAL or partially supplied references.
- Cache only public environmental inputs: DEM tiles and complete water-provider responses. IndexedDB payload budget is 32 MiB / 128 entries, with a 10-minute TTL and a 4 MiB / 16-entry RAM fallback. Eviction reads metadata, not all raster values. Quota/security/blocked/stalled IndexedDB paths are optional and bounded; a stalled transaction disables persistent caching for that cache instance.
- Cache keys include provider identity/version/endpoint, discovered DEM coverage, grid geometry, water options and water-provider configuration. Periods are deliberately absent. Site records, protection masks, random background points, models and scores are not cached. Failed/incomplete water responses are not cached; provider selection and fallback warnings still run.
- Capture each UI run's cancellation token. Late progress/errors/cleanup from a cancelled run cannot clear the next run's token or busy state. Check cancellation after asynchronous downloads before creating/using a worker. Failed/cancelled runs release their own worker without terminating a newer worker.
- Load/precache the new module before the pipeline and re-tag changed assets with `20261105-apm-mobile-train`; service-worker shell version is 407.

## Verification and evidence

- `test-apm-train-mobile.js`: IndexedDB API tests using pinned test-only `fake-indexeddb`; byte/entry limits, TTL, quota/security/blocked/stalled paths, late-open closure, transfer detachment, tile-boundary equivalence, independently supplied references, period-switch reuse, option/provider invalidation, fallback warnings, incomplete-response retry and cancelled-download worker ownership.
- `test-apm-train-network.js`: actual UI/provider/pipeline/worker under mocked network, including Romania RPC-only source isolation, outside-Romania explicit CSV, hoard gates, and cancel/restart UI races.
- Existing spatial-exclusion, heatmap-crash and TRAIN-performance tests retain their assertions; asset-version expectations follow the new tags.
- Full-suite snapshots and exact failure comparison are in `test-results/mobile-train-*.json`. See `mobile-train-comparison.json` for final totals and failure identities.

Reproduce with dependencies installed locally:

```sh
npm ci --prefix tools/apm-test
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" node test-apm-train-mobile.js
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" python tools/run-correction-suite.py mobile-train-release
APM_MOBILE_FULL_BENCH=1 NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" node test-apm-train-mobile.js
```

The normal parallel-suite mobile fixture keeps the real 50 km training area but uses a 1 km prediction window to avoid test-runner contention/timeouts. The separate opt-in benchmark uses both 50 km training and 50 km prediction. The existing native-25 m TRAIN-performance regression continues to exercise the actual bounded 50 km prediction path.

`test-results/mobile-train-benchmark.json` records the opt-in full-output synthetic benchmark. It uses a 100 m synthetic DEM, 20 selected positives per period and 100 background points, not the production 5,000-point default. Both pipeline and worker maths run; only providers/masking/worker transport are synthetic. Worker transport uses real structured cloning and transfer-list detachment.

### Recorded results

| Synthetic full-output run | Cold | Period switch |
| --- | ---: | ---: |
| DEM provider calls, including the unchanged probe | 9 | 1 |
| Water provider calls | 1 | 0 |
| Elapsed time, this sandbox only | 8,297 ms | 7,992 ms |

The maximum sampled mobile block was 268,324 cells versus 1,012,036 for the desktop profile: **73.5% fewer cells in the temporary sampling block**, not 73.5% less total application memory. CPU still dominated this synthetic workload; the timings are not a claimed phone/network speed-up.

Final full suite: **149 passing / 192 scripts, 43 failing**. Baseline: **145 passing / 191, 46 failing**. The remaining 43 failures are all baseline failure identities; there are **no new failing script identities**. Three baseline scripts now run successfully because the already-declared jsdom/PGlite test dependencies were installed, not because unrelated application bugs were repaired. The new mobile script passes its eight grouped checks. The full suite still exits non-zero; it is not green.

Intermediate failed attempts are retained: the first caught transfer-fixture and stale asset-tag assumptions; two full-suite attempts also exposed an overly heavy new fixture exceeding the runner's 90-second cap. The final default test uses the bounded prediction fixture described above; the full 50 km output benchmark was then run separately and passed. No runner timeout was increased.

## Limits / release validation

- No real phone/PWA memory profile, live-provider speed test or physical-device crash reproduction was possible here. This is not evidence that all crashes are resolved or that a production run meets 90 seconds.
- A warm period change reuses environmental inputs, but still computes terrain, samples the new positives/background, fits/validates the model, builds protection masks and scores. CPU-bound runs may show little wall-clock improvement despite fewer downloads.
- Smaller blocks reduce peak temporary allocation but can increase the number of cold WCS requests. First-run speed is not guaranteed to improve. The existing provider probe still runs; unavailable providers can still dominate elapsed time before fallback.
- Cancellation stops stale UI/worker work but does not abort every already-started provider request. Public caches can be evicted by the browser; the bounded RAM fallback may not retain an entire large run. Existing provider-internal caches were not redesigned.
- Before deployment sign-off, compare cold run, period switch, cancellation/restart and background/foreground resume on the affected phone using the same location and period. Verify visible heat, exclusions and exports and collect the existing diagnostics/GeoJSON export (now including TRAIN cache/block counters). Hoard activation remains gated separately.
