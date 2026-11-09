# DARMC hoards — file-driven import (no live service)

Date: 2026-11-09. Supersedes the capture-based workflow in `HOARD_TRAIN_REPORT.md`
where the two disagree.

The importer no longer asks DARMC anything. Your browser capture is the source of
truth, the schema is derived from the values inside it, and every decision is
printed for review before a single row is written.

```
tools/darmc-hoards/dump.mjs        load + validate the capture, fingerprint it
tools/darmc-hoards/derive.mjs      derive id/name/date/position/duplicate rules from the values
tools/darmc-hoards/normalise.mjs   feature → public.archaeological_hoards row (reuses apm-hoards.js)
tools/darmc-hoards/fixtures.mjs    trim the capture into per-layer test fixtures
tools/darmc-hoards/report.mjs      the Markdown review report
tools/darmc-hoards/import.mjs      CLI: dry-run (default) · --report · --fixtures · --emit-sql · --apply
backend/migrations/manual/018_apm_hoards_import.sql   snapshot column + run log (NOT applied)
```

## Run it on your file

```sh
# 1. Inspect. Writes nothing to any database.
node tools/darmc-hoards/import.mjs \
  --dump data/hoards/darmc_hoards_layers.json \
  --report data/hoards/darmc-review.md \
  --mapping data/hoards/darmc-mapping.json \
  --json data/hoards/darmc-counts.json

# 2. Trimmed real fixtures, one file, 12 records per layer.
node tools/darmc-hoards/import.mjs \
  --dump data/hoards/darmc_hoards_layers.json --fixtures test/fixtures/darmc

# 3. The same rows as an idempotent SQL file (data only, no DDL, no deletes).
node tools/darmc-hoards/import.mjs \
  --dump data/hoards/darmc_hoards_layers.json --emit-sql /tmp/hoards.sql

# 4. Only after you have reviewed every layer and set reviewed:true in the mapping,
#    either through psql:
DATABASE_URL=postgres://… node tools/darmc-hoards/import.mjs \
  --dump data/hoards/darmc_hoards_layers.json --mapping-in data/hoards/darmc-mapping.json --position proposed --apply

#    …or through the Supabase REST API (no psql, no connection string):
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=… \
node tools/darmc-hoards/import.mjs \
  --dump data/hoards/darmc_hoards_layers.json \
  --mapping-in data/hoards/darmc-mapping.proposed.json --position proposed --push
```

`--push` posts the same rows to `/rest/v1/archaeological_hoards` in batches of 500
(`Prefer: resolution=merge-duplicates`, so it is an upsert keyed on `id` and safe to
re-run). It never sends the generated `geom` column. A non-2xx batch stops the run
and prints the status and the PostgREST body.

The dry run prints JSON: `fetched / kept / dropped` per layer, drop reasons,
position classes, period groups, date basis, duplicate count and thresholds.
`--report` writes the long version with the proposed mapping and the counts
behind every decision.

`--apply` and `--push` refuse to run unless the mapping file has `reviewed: true`
on every layer, and unless the credentials are set locally. It writes only
`public.archaeological_hoards` (+ `hoard_import_runs` when 018 is applied).
Nothing is ever deleted.

## What is derived, and from what

| Decision | How it is derived | Never |
|---|---|---|
| Identifier | the attribute that is complete **and** unique in the file; service object id preferred | a name- or content-based hash of the record |
| Name | best-coverage text attribute, name/place tokens weighted | an invented "site name" |
| Deposit dates | a validated start/end pair: both year-like, ≥10% of the layer paired, ≥90% ordered | discovery years, coin counts, sizes, weights (all explicitly forbidden) |
| Date basis | `deposit` from the chosen pair. A year-like TPQ column is used **only** as a labelled fallback (`date_basis='tpq'`, end year null) for rows whose deposit dates are empty | silently treating a TPQ as a burial interval, or letting it claim a period group |
| Position class | every observed combination of the position-quality fields, classified once, with its row count | a default of "exact" for a layer with no quality field |
| Duplicate rules | distance percentiles of same-name pairs, exact-coordinate groups, cross-layer coordinate matches | a hard-coded 1 km / 0.7 similarity guess |
| Hoard type | a coin/non-coin column if it exists; otherwise flagged "needs review" | a silent default |

Position classes are reported twice per combination: **proposed** ("no field says
otherwise ⇒ exact") and **strict** ("nothing explicitly says exact ⇒ unknown").
**Strict is the default** for the proposal; `--position proposed` switches the run to
the other reading.

Layer 12 publishes no position field at all. It is classified **approximate** by one
explicit layer-level default (not by evidence), under either policy, and the report
says so on that layer's row. `--position-default 12=exact` is the way to overrule it.

Rows whose position class is `unknown` are still imported (they are real finds),
but `apm_hoards_within` excludes them from training, so they cannot reach the model.

## The derived mapping on the sample capture

The numbers below come from `test/fixtures/darmc/darmc-layers.sample.json`, a
**synthetic** file in your capture's exact shape (31 records, 7 layers). They
prove the derivation runs; they are not your data. Run the command above for the
real counts, which land in `data/hoards/darmc-review.md`.

| Layer | Dates used | Position fields | Rows (sample) |
|---|---|---|---|
| 8 | `DATE_E` → `DATE_L` | `FINDSPOT_Q`, `VERIFIED` | 6 |
| 9 | `DATE_E` → `DATE_L` | `FINDSPOT_Q`, `VERIFIED` | 3 |
| 10 | `DATE_E` → `DATE_L` | `FINDSPOT_Q`, `VERIFIED` | 3 |
| 11 | `DATE_E` → `DATE_L` | `FINDSPOT_Q`, `VERIFIED` | 3 |
| 12 | `start_date` → `end_date` | **none** → approximate (layer default) | 6 |
| 15 | `HOB_PD_ST` → `HOB_PD_EN` | `Q_LAT_LON`, `CENTROID` | 7 |
| 16 | `START_D` → `END_D` | `Q_LAT_LON`, `CENTROID` | 3 |

`D_TPQ` is detected as a TPQ field and used only as the labelled fallback on 15 and
16 (rows with empty deposit dates become `date_basis='tpq'`, start year only, no
period group). `FINDATE`,
`Find_year`, `YEAR_DISC`, `COINS*`, `hoardsize`, `preserved`, `Received_O` and
`ITEM_ON` are never used as deposit dates. Layer 12 publishes no position-quality
field, so every one of its rows is `approximate` by that layer-level default. Rows
elsewhere with blank quality values are `unknown` under the strict default.

Duplicate evidence in the sample: 2 exact-coordinate groups inside a layer
(4 records), 3 cross-layer coordinate matches between 15 and 16 (7 records),
5 marked pairs. The proposed thresholds come from the p99 of the same-name pair
distances, clamped to 250–5000 m — on the real file expect several kilometres.

## The real capture (2026-11-09)

> **Imported into production on 2026-11-09** with the operator's explicit
> authorisation. Counts, verification and cleanup: `DARMC_IMPORT_RUN_2026-11-09.md`.


`data/hoards/darmc_hoards_layers.json`, 5.5 MB, fetched from the FeatureServer at
`2026-11-09T08:45Z`, content fingerprint `04988b33...c4fe82`. Every layer matches its
published count:

| Layer | Name | Published | Read | Kept | Dropped |
|---|---|---|---|---|---|
| 8 | Carolingian coin hoards, 769-814 | 21 | 21 | 21 | 0 |
| 9 | Carolingian coin hoards, 815-840 | 28 | 28 | 28 | 0 |
| 10 | Carolingian coin hoards, 841-900 | 140 | 140 | 139 | 1 |
| 11 | Carolingian coin hoards, after 900 | 90 | 90 | 89 | 1 |
| 12 | Gallic coin hoards, 200-300 | 1 776 | 1 776 | 1 776 | 0 |
| 15 | Late Roman deposits (gold weight) | 2 047 | 2 047 | 2 046 | 1 |
| 16 | Late Roman deposits (deposit date) | 2 047 | 2 047 | 2 046 | 1 |
| | **Total** | **6 149** | **6 149** | **6 145** | **4** |

The four drops are features with no finite point geometry (one each in 10, 11, 15,
16). Nothing else is discarded. Duplicate marking proposes **2 427** rows across the
15/16 overlap and within-layer repeats, leaving 3 718 usable after dedupe. Every row
carries `date_basis='deposit'`.

### The position policy decides whether the app sees any of this

| Policy | exact | approximate | unknown |
|---|---|---|---|
| `strict` (the default proposal) | **0** | 1 862 | 4 283 |
| `proposed` | **4 283** | 1 862 | - |

The DARMC quality columns are mostly blank, so under strict nothing is exact. The
panel asks `apm_hoards_within` for exact rows by default, and the RPC never returns
`unknown` rows - **an import with strict leaves the panel showing 0 hoards even
though 6 145 rows are in the table**. The tool therefore prints that as a warning at
the end of every strict run.

Spots at 150 km, counted from the usable rows:

| Centre | usable in the catalogue | exact (= proposed) | approximate |
|---|---|---|---|
| Paris | 678 | 233 | 445 |
| Vienna | 71 | 70 | 1 |
| Cluj (inside Romania) | 68 | 68 | 0 |

5 889 of the 6 145 rows are outside Romania; 256 are inside.

### What to run

```sh
# 1. Review the proposed mapping (it is reviewed:false on purpose).
node tools/darmc-hoards/import.mjs --dump data/hoards/darmc_hoards_layers.json \
  --position proposed --mapping data/hoards/darmc-mapping.proposed.json \
  --report data/hoards/darmc-review-proposed.md

# 2. Flip reviewed:true on all seven layers once you accept it.
node -e "const f='data/hoards/darmc-mapping.proposed.json',m=require('./'+f);Object.values(m.layers).forEach(l=>l.reviewed=true);require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\\n')"

# 3. Push. 018 is optional: it only adds the audit row.
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
node tools/darmc-hoards/import.mjs --dump data/hoards/darmc_hoards_layers.json \
  --mapping-in data/hoards/darmc-mapping.proposed.json --position proposed --push
```

## Files that changed

- New: the six modules above, `018_apm_hoards_import.sql`, `test-apm-hoards-darmc.mjs`,
  `test/fixtures/darmc/darmc-layers.sample.json`.
- Untouched: `js/apm-next/apm-hoards.js` (the normaliser both the browser and the
  importer call), `js/apm-next/hoards.config.js`, the applied 017 migration,
  `js/hoards-layers.js` and the panel. The map layer keeps querying the live
  FeatureServer for display; only the training table comes from this import.

## Tested / not tested

**Tested on fixtures** (`node test-apm-hoards-darmc.mjs`, 192 checks): loader
validation and warnings, value-driven derivation, forbidden date fields, position
proposals and both policies, deterministic uuids, the table contract, reversed
dates, bad geometry, unreviewed mappings dropping closed, duplicate evidence,
fixture trimming, data-only SQL, the PostgREST push (batching, headers, host and key
refusal), CLI dry-run and refusal to apply.

**Tested on the real capture** (same suite, runs when the file is present): 6 149
read / 6 145 kept / 4 dropped, strict `{unknown 4 283, approximate 1 862}`,
proposed `{exact 4 283, approximate 1 862}`, 2 427 duplicate proposals, the
zero-exact warning, and re-reading a supplied mapping under the other policy.

**Not verified because it needs your credentials**: the `--push` and `--apply`
writes themselves. No production statement was executed by this work.
