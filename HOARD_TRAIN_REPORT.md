# Hoards TRAIN — foundation deployment and outstanding release gates

Date: 2026-11-05. This is **not a completed, activated hoard prediction feature**.

## Deployment status

- Production Supabase migration **20261105114223_apm_hoards_foundation** applied with the user's subsequent explicit deployment authorisation. This supersedes the original migration-file-only restriction for this additive schema deployment.
- SQL source: `backend/migrations/manual/017_apm_hoards.sql`, outside the automatic startup migrator. Do not reapply the already deployed file.
- `archaeological_hoards` exists with **zero rows**, geography GiST, period-group GIN, uniqueness constraints, RLS, and no direct browser SELECT/INSERT privileges.
- New positive/count and comparison-set RPCs enforce the existing signed-in, premium, future-expiry predicate on every request. The shared guard itself has no browser EXECUTE grant. Anonymous RPC EXECUTE is revoked. No keys or service-role credentials were added to the frontend.
- A production transaction-local role/JWT-claim smoke test denied missing identity on both RPCs and allowed an existing active-premium profile. Session changes were rolled back. **This is not signed-token/browser verification.**
- Production auth, database and REST health are good. Source table row count stayed **51,674**; the existing settlement RPC definition hash stayed `0d203d569221a181edfd20c6fb28884e`. No source-table ALTER/INSERT/UPDATE/DELETE was performed by this work.
- Frontend changes: [PR #7](https://github.com/andrei-roba29/DetectLab_2027/pull/7), an explicitly blocked hoard mode. Hosting/deployment status is recorded in the final handoff; neither a successful Git operation nor a local test proves that the public website has refreshed.

Evidence: `test-results/hoards-production.json`.

## Step 0 findings (reported before editing)

- `js/apm-next/apm-ui.js`, `loadBuiltinSites()`, selects the built-in source; explicit CSV replaces the pool.
- `apm-romania-sites.js` uses the existing shared Supabase client and only `apm_sites_within` for Romanian settlement positives. The existing function reads only `archaeological_sites_a`, checks premium server-side, caps at 50 km/5,000 returned records, and supplies truncation/exclusion metadata. It defaults to exact COORD points and never invents polygon centroids.
- Settlement chronology remains in `romania-periods.config.js`. Active robust fitting, curves, weights, thresholds and spatial-block CV remain in `apm-core.js`. The separate `apm-robust.js` is not the robust fitter invoked by this pipeline.
- `apm-pipeline.js` orchestrates occupied DEM tiles; `apm-worker.js` and `apm-raster.js` compute terrain. Tile cores were normally 1,000 cells, streamed sequentially. Positive points use neighbourhood medians (60 m default, at least a cell); background points use cell values. Backgrounds default to 5,000 random points, excluding a 500 m neighbourhood of positives.
- Existing training/prediction independently bound their grids to 4,194,304 and 1,048,576 cells. At Cluj (46.77,23.59), actual grid-function calculations gave 49.80 m sampling for 50 km, 103.52 m prediction for the existing 50 km TRAIN output, and 147.46 m sampling if only the training constant were raised to 150 km. These are calculations, **not live service measurements**.
- Training water distances used vector nearest segments; prediction used raster EDT. Existing EU-Hydro overflow uses quadtree subdivision, not verified pagination; EU-Hydro query bodies and EU-DEM coverage responses were not cached.
- The checkout has **CSV-only built-in settlement behaviour outside Romania**, with a source-guard test preventing return of the removed catalogue. Existing TRAIN output is **50 km**, not the manual mode's 1–10 km. This implementation preserves both settlement behaviours and applies 1–10 km output only to hoards. These are documented deviations from the task's assumed baseline, not silent provider/radius changes.

## Implemented source changes, and evidence limits

- Editable `hoards.config.js`: independent release gates, 150 km training radius, proposed 150 m resolution, approximate-neighbourhood assumptions, duplicate thresholds, chronology candidates and Romanian keywords. **All activation gates are false; DARMC field/quality mappings are empty.**
- `apm-hoards.js`: descriptive/place splitting (including La Tène protection), bucket classifier, ordered/multiple/unknown period handling, year conversion, reviewed-schema-only normalisation, and likely-duplicate marking. Discovery years and coin-count fields are forbidden deposit date inputs.
- `apm-hoard-provider.js`: only the hoard RPC for built-in positives; an explicit CSV replacement; period/count metadata; zero returned training records plus CSV offer below 10. No alternate catalogue fallback. Server filters support hoard type, position opt-in and deposit-year overlap.
- TRAIN category selector defaults to Settlements. Hoard controls include exact-only default, approximate-position opt-in, period counts/All periods, 10/30 thresholds, random/known-site comparison choices, attribution, bias notice and object-date caveat, in English and Romanian. A visible pending-review notice and run gate prevent hoard terrain requests.
- Hoard-only experimental sampling path: aligned common lattice, tile cores of 128 cells, cache of sampled DEM tile responses, per-point sampling neighbourhoods and raster water EDT sampling. Prediction uses the same lattice and metric spacing, with a runtime mismatch assertion. No full 150 km DEM array is allocated. **This path is gated, not live-performance validated.**
- `apm_hoard_known_sites` offers exact Romanian repertory point comparisons only; it is a separate premium RPC, not a positive-source fallback. A truncated/unavailable set is refused, not silently replaced. It is **not worldwide/all-provider comparison coverage**.
- Settlement exclusion is controlled by `excludeRomanianHoardSettlements`, default ON. Only hoard-only/mixed buckets are removed; uncertain records retain the preceding behaviour. The source table/RPC are unchanged. Tests exercise ON/OFF and no hoard-RPC calls during settlement training.
- Asset versions/PWA cache were bumped. Existing tests were updated only for new asset versions, a specific period-picker selector (a category select now precedes it), and the added helper dependencies of an extracted UI-function test; settlement/model assertions were not relaxed.

## Schema adjustments

Additional columns are `geom` (generated point, derived from lat/lon), `position_accuracy_m` (explicit working neighbourhood), `period_groups`, `periods`, `multiple_periods`, and `bucket`. A list avoids collapsing several object periods into a fictitious continuous burial interval. Multiple Romanian periods leave scalar dates null and preserve the full list. `position_quality_raw` is JSONB because the source can carry several quality fields. Stable source/layer/id UUIDs preserve individual records. `duplicate_of` is a deferred self-reference; candidates are retained rather than deleted. Discovery-year date basis cannot carry a purported deposit interval.

## Source sync / inspection

`tools/sync-hoards.mjs` is an operator CLI, DRY-RUN by default. It discovers point-layer metadata, verifies counts and object IDs, fetches ID batches using the layer record cap and `outSR=4326`, and rejects missing/duplicate/incomplete batches. ID batching does not assume pagination support; the reported capability is preserved. It does not infer undocumented date fields or quality meanings.

```sh
# Run on a machine that can reach the public ArcGIS host. No database writes.
node tools/sync-hoards.mjs --capture /tmp/hoard-evidence.json > /tmp/hoard-inspection.json
# Repeat normalisation offline after reviewing/editing mappings:
node tools/sync-hoards.mjs --from-evidence /tmp/hoard-evidence.json
# Optional read-only Romanian derivation (DATABASE_URL already configured locally):
node tools/sync-hoards.mjs --from-evidence /tmp/hoard-evidence.json --ran
```

`--apply` is explicit and blocked until all release gates and all layer mappings are reviewed. It writes **only** the hoard table in a transaction. RAN ingestion uses a read-only source SELECT. No database credentials should be pasted into chat. The current upsert job does not prune disappeared upstream records; snapshot retirement needs an approved policy before ingestion is enabled.

### Actual sandbox dry-run

`node tools/sync-hoards.mjs --dry-run` exited 1 with `fetch failed`; an earlier direct curl failed TLS establishment. Required ArcGIS/EEA hosts are outside the sandbox's outbound allowlist. **This means the operator sync did not run successfully; it is not zero records.** A later page-fetch-tool inspection did reach the service: the verified subset below supersedes the initial access limitation, but does not establish full snapshot/overlap or live performance results.

Full-sync fetched/kept/dropped/duplicate counts remain **unavailable**, not fabricated. Separately verified live service count queries:

| Layer | Service count (not a completed sync count) |
|---|---:|
| 8 | 21 |
| 9 | 28 |
| 10 | 140 |
| 11 | 90 |
| 12 | 1,776 |
| 15 | 2,047 |
| 16 | 2,047 |

The 6,149 sum is source rows, **not unique finds**. Metadata pages verified point geometry, 1,000-record cap, schemas, source attribution and empty copyright text for 9–11 and 16. Layer 9 explicitly declares pagination support. Templates on 9–11 say **tpq**; the layer-16 renderer uses D_TPQ. Full pagination metadata for other layers remains for the operator capture.

Grouped quality counts were read live:

- Layer 8 `(FINDSPOT_Q, VERIFIED)`: `(null,null)=5`, `(null,F)=1`, `(null,X)=14`, `(C,X)=1`.
- Layer 9: `(null,null)=10`, `(null,X)=17`, `(?,X)=1`.
- Layer 10: `(null,null)=40`, `(null,F)=2`, `(null,X)=86`, `(?,X)=3`, `(C,X)=7`, `(Ca.,X)=2`.
- Layer 11: `(null,null)=19`, `(null,F)=4`, `(null,X)=55`, `(?,X)=3`, `(C,X)=8`, `(Ca.,X)=1`.
- Each of 15 and 16 `(Q_LAT_LON,CENTROID)`: `(single space,single space)=2016`, `(single space,T)=1`, `(C,T)=9`, `(C,single space)=21`.

These code **meanings remain unverified**; sampled field domains are null and aliases repeat the codes. They are not mapped to exact positions. Identical 15/16 counts/quality distributions are not proof of identical records.

One real feature from each of 8/12/15 is preserved as a minimal test projection. Layer 12 aliases explicitly distinguish deposit start/end from discovery year and coin counts. Layer 8's example has DATE_COUP=755–769, DATE_E/L=755/769, discovery 1972 and coin counts 25. Layer 15's example has START_D=337 but D_TPQ=500 and HOB_PD_ST/EN=500/600: **blind START_D-as-burial mapping is not justified**. Its HOBBS_NO is blank, so a maintained source ID is necessary. Sample geometries agree with decimal coordinate fields within 1 m, but the first layer-15 legacy formatted LATITUDE/LONGITUDE strings disagree with both its decimal coordinates and geometry. No layer-wide agreement is claimed.

Evidence and reproducible query descriptions: `test-results/hoards-source-inspection.json`; fixture source URLs use `/{layer}/query?where=1%3D1&outFields=*&outSR=4326&resultRecordCount=1&f=json` at the documented base service.

The CLI supplies full per-layer counts/reasons and a sample in a directly reachable environment. Raw-attribute identity comparisons are explicitly not claims of archaeological identity. Spatial/date/name duplicate candidates require reviewed mappings.

## Actual Romanian read-only aggregate audit

A SQL mirror of the name rules was run read-only against production. These are **point-record candidates**, before national-boundary/area filtering and name/5m deduplication; not synced hoard-table rows or observed TRAIN output.

| Measure | Count |
|---|---:|
| Point records examined | 34,951 |
| Derived candidates | 253 |
| Hoard-only | 246 |
| Mixed | 5 |
| Uncertain | 2 |
| Not-a-find | 34,698 |
| Exact / approximate / unknown position | 65 / 188 / 0 |
| Unknown period | 166 |
| Multiple periods | 1 |
| Exact candidates newly excluded from settlement pool | 65 |

None of those 65 matched the prior non-settlement exclusion words in this audit. A particular 50 km run removes only its matching local records; the provider reports its actual exclusion count.

Period-key counts: Eneolitic 1; Neolitic 3; Bronze Age 3; Hallstatt 8; La Tène 2; Carpic 1; Dacic 15; Roman Republican 3; Roman 34; Byzantine 1; Medieval 16; Ottoman 1. Counts overlap for the one multiple-period record. Unknown names remain unknown, including names mentioning bronze objects without the configured chronological phrase.

## Proposals requiring review (not activated)

### Deposit-period groups outside Romania

| Group | Approximate overlap interval | Attribution / basis |
|---|---|---|
| Gallic | AD 200–300 | Haupt 2001; user-supplied layer 12 interval |
| Late Roman | AD 200–700 | Hobbs 2006; user-supplied layers 15–16 interval |
| Carolingian | AD 751–987 | Coupland 2011, *A Checklist of Carolingian Coin Hoards 751–987*, Numismatic Chronicle 171 |

Overlapping groups are intentional; they are not a claim that records or layers are disjoint. Individual source deposit dates, once verified, drive overlap matching.

### Romanian keyword ranges (astronomical numbering)

| Keyword group | Proposed interval | Review reference |
|---|---|---|
| Eneolitic / Cucuteni / Coțofeni | -4999…-2499 | [Regional prehistory](https://en.wikipedia.org/wiki/Prehistory_of_Transylvania) |
| Neolitic | -6499…-4499 | Same regional prehistory reference |
| Epoca bronzului | -3499…-1199 | Same regional prehistory reference |
| Hallstatt | -1199…-449 | [Britannica: Hallstatt](https://www.britannica.com/topic/Hallstatt-culture) |
| La Tène | -449…106 | [Britannica: La Tène](https://www.britannica.com/topic/La-Tene); AD 106 regional extension proposed |
| Carpic | 100…400 | [Carpi overview](https://en.wikipedia.org/wiki/Carpi_(people)); proposed broad envelope |
| Dacic | -499…106 | [Britannica: Dacia](https://www.britannica.com/place/Dacia) |
| Roman republican | -508…-26 | [Britannica: Roman Republic](https://www.britannica.com/place/Roman-Republic) |
| Roman | -26…476 | [Britannica: Roman Empire](https://www.britannica.com/place/Roman-Empire) |
| Bizantin | 330…1453 | [Britannica: Byzantine Empire](https://www.britannica.com/place/Byzantine-Empire) |
| Medieval | 500…1600 | [Britannica: Middle Ages](https://www.britannica.com/event/Middle-Ages); regional working envelope |
| Otoman | 1299…1922 | [Britannica: Ottoman Empire](https://www.britannica.com/place/Ottoman-Empire) |

References/ranges are editorial review candidates, not live-verified source statements or burial dates. Specific phrases are consumed before general phrases; distinct remaining periods are retained.

### Position mapping

| Source value | Class | Observed candidate count | Proposed minimum neighbourhood |
|---|---|---:|---:|
| RAN COORD=DA | exact | 65 | 60 m, at least one analysis cell |
| RAN COORD=NU | approximate | 188 | 1,000 m |
| RAN empty/unrecognised | unknown | 0 in candidates | excluded |
| DARMC documented raw codes, undocumented meanings | unknown until reviewed | frequencies above | excluded |
| Confirmed region-centroid designation | approximate | unavailable | needs region-specific accuracy review |

These metre values are **working assumptions, not measured source precision**. A 1 km neighbourhood cannot be asserted adequate for arbitrary region centroids. Reviewed mapping must supply defensible accuracy before approximate centroid training is enabled. Exact-only is the default. Matching raw quality combinations is explicit, not a guessed interpretation of VERIFIED or other flags.

## Tests versus baseline

All tests use mocks/fixtures/local databases; no live service calls belong in the suite. Node networking was prohibited in both baseline and after runs. Existing production-probe scripts consequently remain failed rather than being treated as passing.

```sh
npm ci --prefix tools/apm-test --ignore-scripts --no-audit --no-fund
NODE_OPTIONS="--require=$PWD/tools/apm-test/offline-guard.cjs" python tools/run-correction-suite.py hoards-after
```

Baseline was captured before application edits with an equivalent preload guard at a scratch path. The runner invokes all root test scripts plus the backend suite, six workers, 90-second per-invocation timeout. Full outputs: `test-results/hoards-baseline.json`, `test-results/hoards-after.json`.

| Script/suite invocations | Baseline | After |
|---|---:|---:|
| Total | 188 | 191 |
| Exit 0 | 145 | 148 |
| Nonzero | 43 | 43 |
| Newly failing previously passing scripts | — | 0 |

Added tests cover classifier traps/order/multiple periods, date conversion and forbidden discovery/count fields, reviewed-only mapping, duplicate candidates, class mapping, provider minimum/CSV offer, source isolation, exclusion switch, resolution mismatch, release gate, bilingual keys, synthetic ArcGIS ID batching, and real local SQL premium/RLS/filter/count/radius/row-cap behaviour. The existing real UI/provider/pipeline/worker network harness still completes settlement TRAIN and now verifies the blocked hoard UI uses only its own positive RPC.

**Fixture scope:** `hoards.schema-examples.synthetic.json` remains explicitly synthetic. `hoards.real-projections.json` contains actual source-feature projections from 8,12,15 retrieved through the page-fetch tool. Tests use the verified layer-12 deposit aliases, preserve unknown quality, reject unreviewed layer-15 mapping/blank IDs, separate counts/discovery/date fields, and check sampled decimal coordinates. These three projections are not full layer snapshots or proof of global field meanings. A real-worker test also verifies that a 1,000 m position radius changes positive-site neighbourhood sampling and that sampled water uses raster EDT.

## Performance and validation — not passed

- No live 150 km request count or timing is available. Existing mocked 50 km performance tests are not evidence for the live target.
- `tools/benchmark-hoard-water.js` provides a read-only browser diagnostic using existing discovered providers, count preflight, an explicitly labelled request lower bound, visible progress/request cap, cancel/AbortController, 90-second budget and repeated-run cache measurements. It is **water-only**, not full TRAIN validation. Load it in an idle DetectLab page and run `inspectHoardWater({lat:46.77,lon:23.59})`; `run:true` asks for confirmation after the count estimate.
- Production TRAIN still lacks a demonstrated affordable hydro preflight/complete request budget for the 150 km path. The diagnostic's budgeting is not claimed as implemented end-to-end model budgeting.
- Random versus known-site spatial-CV comparisons on a real test area have **not** been run. Random remains the specified default, not an evidence-based recommendation from new measurements. Known-site coverage is currently Romanian exact-point repertory only.
- Existing fallback provider chains/warnings remain; the gated hoard path has not been live-tested outside their coverage.
- If a browser benchmark cannot meet the target: consider preprocessed/server-side water distances, a reviewed larger-rivers-only mode (changes the water variable's meaning), or a coarser shared analysis resolution. Do not enable an unbounded slow path.
- Distance to known settlements is a plausible future candidate, but it may encode survey/detection coverage as well as historical mechanisms. It needs independent spatial validation; no variable was added.

## Remaining release gates / deviations

1. Complete the partial source inspection: obtain full snapshots, quality-code meanings, whole-layer coordinate-field agreement, remaining pagination metadata, and archaeological overlap analysis (15/16, 8–11, 12/15). Verified counts, schemas/quality frequencies and three real projections are recorded above; do not mistake them for a completed sync.
2. **OPEN QUESTION: licence/terms of use**, including redistribution and model-training use. No permission was inferred from an empty layer copyright field.
3. Review the proposed chronology, class/accuracy mapping and centroid treatment. Complete sync retirement policy and reviewed mappings, then inspect dry-run output before population.
4. Validate affordable complete request planning, cold/warm full-runtime measurements, cancellation, and both background modes on a real test area. All four release flags remain false until then; since 2026-11-09 the operator switch (see below) lets training run anyway, always labelled provisional.
5. Verify the hosted frontend and signed-token browser entitlement flows. The completed backend migration and role/claim smoke checks do not substitute for those checks.

The work deploys a safe backend foundation and, since 2026-11-09, a hoard mode that trains **under an explicit operator override** — every panel and every result says the reviews are open. It does **not** claim the original full feature, ingestion, live validation or performance acceptance is complete.

## Operator override (added 2026-11-09, at the operator's request)

The hoard mode shipped with a fail-closed switch: `release` in
`js/apm-next/hoards.config.js` holds four reviews (`sourceReviewed`,
`licenceApproved`, `chronologyReviewed`, `performancePassed`), and TRAIN refused
to start until all four were true. Two problems came out of that in practice:

* the period note and the run button still spoke the settlement language
  ("așezările cu perioada de locuire selectată") although hoards are deposits;
* "Rulează modelul TRAIN" was disabled with no visible reason anywhere near it —
  the explanation lived far below, inside the hoard options block.

What changed:

1. **Wording.** In TEZAURE the period note, the picker placeholder, the reload
   button and the refusals inside `run()` use hoard strings
   (`hoard.periodApplied`, `hoard.periodHelp`, `hoard.choosePeriod`,
   `hoard.reload`). No settlement wording reaches the hoard flow.
2. **The button explains itself.** The release gate no longer sits in the
   `disabled` condition. The data gates still do (no area, no records, no period,
   fewer than 10 usable hoards); the release gate answers the click and states
   which reviews are open, before any terrain request.
3. **`release.operatorOverride`** — **currently `true`**, at the operator's
   explicit request on 2026-11-09 (hoard TRAIN must actually run). With it on,
   hoard TRAIN runs while the four reviews stay open. This is a statement by the
   operator, **not evidence**:
   * `ready()` keeps its meaning — it reads the four reviews only, so
     `tools/sync-hoards.mjs` still refuses data writes, and `openReviews()`
     still lists exactly what is missing;
   * the APM panel shows a permanent amber note (`hoard.override`) for as long
     as the switch is on, and the run button carries the same text;
   * every result carries `warn.hoardOverride` with the number of open reviews,
     so an export can never be mistaken for a reviewed model.

To turn it off again, flip that one field — nothing else changes:

```js
// js/apm-next/hoards.config.js
release: { sourceReviewed: false, licenceApproved: false, chronologyReviewed: false, performancePassed: false,
           operatorOverride: false }
```

The switch is read at call time. With it off, TRAIN refuses before any terrain
request and the panel says which reviews are still open. Completing the four
reviews and setting them to `true` makes the override unnecessary; the warning
disappears on its own because `overridden()` is false once `ready()` is true.

Tests: `test-apm-hoards.js` covers the switch (`ready()`, `trainingAllowed()`,
`overridden()`, `openReviews()`), and `test-apm-train-network.js` runs a real
hoard TRAIN with the switch on, asserting the panel note, the clickable button,
`params.category === 'hoards'` and `warn.hoardOverride` in the result.
