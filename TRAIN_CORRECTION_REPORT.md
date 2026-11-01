# TRAIN source correction — verification report

Date: 2026-11-01. Branch: `arena/c22e49b9-detectlab-web-deploy`.

**Updated status: database migration deployed with explicit user approval; frontend changes await PR merge/static-host deployment. The requested attached sample remains unavailable. Browser/signed-token, payment and broad performance checks remain outstanding.**

## Production deployment update

Supabase migration `20261101163027_apm_romania_train_correction` was applied on 2026-11-01 after the user authorised production deployment. Production SQL role/transaction-local JWT-claim smoke checks denied anonymous/free access and allowed an existing active-premium profile: Cluj 50 km returned 749 DA-only sites, six fields per row, in 263.158 ms, not truncated. Browser entitlement INSERT/UPDATE grants are now zero; authenticated newsletter updates and service-role entitlement writes remain permitted. Auth/db/REST report healthy; site table remains 51,614 rows. No profile/site rows were modified by the smoke test. Full evidence: [production-deployment.json](test-results/production-deployment.json).

This is one-centre SQL execution evidence, not a real HTTP/session test or broad performance benchmark. The website is a separate static deployment; no direct hosting access was available, so frontend code is being delivered through a PR and is **not claimed live**.

The sections below preserve the initial pre-deployment report; statements there about an unapplied migration or production privileges describe that earlier checkpoint and are superseded by this update.

## 1. Step 0: before-change findings

The complete pre-change file/line inventory was posted in chat before editing application files. Important original locations:

| Original file:lines | Finding |
|---|---|
| `js/apm-next/apm-ui.js:157,285,394–426,945,1080` | Automatic TRAIN load/reload. Despite the obsolete loader name, line 404 selected the Romania provider. |
| `js/apm-next/apm-romania-sites.js:12` | Active shared-client `apm_sites_within` call; not a direct table read. |
| `js/apm-next/apm-romania-provider.js:3–7` | Unused duplicate provider, rectangular boundary, incompatible return shape. Deleted. |
| `js/apm-next/apm-providers.js:777–790` | CSV provider existed, but there was no TRAIN upload control. |
| `js/apm-next/apm-sites.js:93–141,145–443,455–498` | CSV parser, obsolete catalogue vocabulary/parser and source-specific accuracy/dedupe exceptions. |
| `js/apm-next/apm-ui.js:492–495` | Database provenance and Romania-only background predicate, without CSV-specific handling. |
| `js/supabase.js:6–11` | Existing shared client, reused rather than replaced. |
| `js/subscriptions.js:82–94` | Premium-or-local-cache predicate; browser-local entitlements cannot secure a server RPC. |
| `backend/migrations/014_apm_romania_sites.sql`, `015_apm_romania_rpc_permissions.sql` | Prior RPC/index/grant migration history, including a duplicated hard-coded period-count function. |
| `js/archeo-potential.js:1335` onward | Supplemental audit finding: prediction protection could independently trigger legacy heritage and land-tile downloads. TRAIN now supplies its own records and uses cached land restrictions only. |

The old catalogue also remained in the separate Library of Babel adapter, tests/fixtures, EN/RO strings, HTML attribution, documentation and service-worker asset entry. The pre-change chat inventory records their original line numbers. Dedicated old tests and duplicate Romania modules were deleted, not disabled.

**What TRAIN actually used before this correction:** the UI attempted the Romania RPC, not a selectable catalogue provider. However, its provider factory referenced an out-of-scope `root`, CSV upload was absent, names were lost before deduplication, exclusion totals were wrong, border detection used an envelope, legacy protection could fetch other site data, and the production profile grants made the purported premium gate bypassable. These issues prevent claiming that the old implementation fulfilled the requested Supabase-only contract.

## 2. Implemented source policy and SQL

Inside Romania: only the existing shared-client `apm_sites_within` RPC over `archaeological_sites_a`. Outside Romania: no site-data request, clear Romania-only message and CSV upload. RPC denial/error/timeout: clear error, TRAIN blocked, explicit CSV upload offered; no automatic alternate source. An uploaded CSV replaces the pool, never merges it. Outside-Romania CSV backgrounds are unrestricted by the Romania polygon.

The complete proposed migration is [manual/016_apm_romania_train_correction.sql](backend/migrations/manual/016_apm_romania_train_correction.sql). It is outside automatic backend migration discovery and **was not applied to production**. It returns only the six approved per-row fields, plus counts/truncated metadata, applies DA-only filtering server-side, supports explicit empty-COORD opt-in, caps radius at 50 km and output at 5,000 points. Geography `ST_DWithin` matches the existing geography expression GiST index. Polygon centroids are never invented.

The server repeats the shared premium predicate: authenticated profile, premium plan, future expiry. Read-only production metadata revealed authenticated self-write access to plan/expiry. The proposed migration therefore also restricts profile INSERT/UPDATE columns to prevent self-upgrade. Browser-local cached subscriptions no longer grant `_dlIsPremium()` access. Payment/promo/newsletter compatibility is a mandatory staging gate.

Read-only schema results, geography source, editable chronology/reference URLs, inferred confidence, dedupe rules, counts and deployment caveats are documented in [ROMANIA_APM_TRAIN_IMPLEMENTATION.md](ROMANIA_APM_TRAIN_IMPLEMENTATION.md).

## 3. Step 4 proof

### Removal guard

A case-insensitive recursive search of the working repository returned **no matches**, exit code 1. Git internals and installed dependencies were excluded; no authored code, fixture, test, config, translation, documentation, HTML or service-worker file was excluded. Historical Git objects are not rewritten.

`node test-apm-source-guard.js` independently scans working-tree text contents and filenames, excluding only `.git` and dependency directories. It constructs the prohibited identifier from codepoints so the test itself does not reintroduce it. Output:

```text
PASS whole working-tree source guard (case-insensitive; Git internals and dependencies excluded)
```

The baseline artifact preserves outcomes/output with the removed catalogue identifier redacted, including the two deleted test filenames, to avoid reintroducing it as a generated fixture/document. No baseline pass/fail outcomes were changed.

### Mocked network, real TRAIN execution

`node test-apm-train-network.js` loads the real panel, provider, pipeline, protection mask and worker in a DOM/worker harness. Only networking, TIFF decoding and Leaflet rendering are mocked; this is not a stubbed `runTrain`. It proves:

```text
PASS Romania TRAIN: real UI/provider/pipeline/worker completed; site-data calls = [Supabase apm_sites_within]; other requests = existing DEM/hydro only; no legacy heritage download.
PASS outside Romania: zero site-data requests; explicit CSV upload; real CSV TRAIN completed with DEM/hydro only, no Romania background constraint.
PASS RPC failure: explicit error + CSV upload, no fallback request.
```

The shared-client mock rejects any direct table read. All unexpected network hosts fail the test. Allowed mocks are the Supabase RPC, existing EEA DEM/hydro host and existing Overpass hydro service. A legacy heritage loader is a hard-failure trap. Distinct names at an identical position survive the entire training pipeline, including terrain hard-exclusion filtering. All periods defaults to selected. The test also verifies summary text, outside-country blocking and explicit CSV replacement.

### Local server execution and fixture coverage

`node test-apm-server-rpc.js` executes the **real proposed SQL** against local PGlite PostgreSQL + PostGIS, with real anonymous/authenticated roles, a profile RLS policy and deliberately permissive pre-migration grants. It checks anonymous/free/expired denial, entitlement INSERT/UPDATE denial, permitted ordinary profile writes, six-field projection, exact/empty position filtering, exclusion counts, polygon exclusion, radius cap, invalid input and truncation at 5,000. This is not a regex-only SQL test, but it is not hosted Supabase.

`node test-apm-premium-rule.js` executes the actual shared browser predicate: logged-out/free/expired/invalid expiry fail, active premium passes, a cached premium record cannot upgrade a free profile.

`node test-apm-romania-contract.js` and the existing Romania tests verify normalisation, descriptive-part extraction, Roman/Romanesti locality safety, low-confidence undelimited names, unknown periods, editable type exclusion, exact/empty COORD, same-name/5m dedupe, no CODSIT-prefix merge, preservation through the period pool, outside-country no-request behaviour, RPC errors/timeout/malformed response, border detection, Romanian-only background samples, truncation metadata and 10/30 thresholds.

**Fixture limitation:** `test/fixtures/romania-sites.synthetic.json` is explicitly synthetic, shaped after the supplied schema description. The requested `archaeological_sites_a_rows.json` was not present in the checkout or visible attachments. Tests cannot be represented as using that missing sample. No live site-row database is used by these tests.

### Full-suite comparison

Commands:

```sh
npm ci --prefix tools/apm-test
python tools/run-correction-suite.py after
```

The runner invokes every root `test-*.js` / `test-*.mjs` plus `npm test --prefix backend`, with six workers and a 90-second per-invocation limit. New local-only dependencies are isolated under `tools/apm-test`; legacy tests use the same dependency environment as baseline.

| Result | Before | Final |
|---|---:|---:|
| Test-script/backend-suite invocations | 164 | 167 |
| Exit 0 | 126 | 129 |
| Nonzero exits | 38 | 38 |
| Newly failing previously passing invocations | — | **0** |
| Existing failed invocations resolved | — | 0 |

Two obsolete catalogue tests were deleted; five correction tests were added. Their net increase is three passing invocations. Three existing tests had literal asset/cache-version assertions updated to the new shipped versions; their substantive checks still run. `test-apm-next.js` reports **62 passed, 0 failed**. Backend reports **54 passed, 2 failed**, unchanged: `evidence-engine.test.js` and `evidence-search-route.test.js` fail to load a missing package. Six root failures also explicitly report missing jsdom; other pre-existing failures include snapshot/style assertions.

**Exit 0 is not equivalent to complete coverage:** ten invocations report explicit whole/partial browser or DOM skips in both runs, including the APM Chromium test. No real Chromium/full logged-in-site smoke test is claimed. The new correction DOM/PostGIS tests do run using their isolated dependencies.

Full per-invocation output and all existing failures: [baseline.json](test-results/baseline.json), [after.json](test-results/after.json). The runner exits nonzero while failures remain. `git diff --check` passes.

## 4. Unverified, deviations and deployment blockers

1. Missing requested sample: synthetic fixtures substituted transparently. Additional actual name-derived periods cannot be inferred from an unavailable sample.
2. Production row facts differ: the 51,614 rows include polygons/null geometry. Only real Point geometries are returned; default DA-only data is layer 0. Opted-in empty-COORD points can be from layer 5.
3. Revised query speed on the real 51k-row table, planner behaviour across centres, authenticated endpoint latency, RLS/owner/grant behaviour under real Supabase tokens and premium/free/expired sessions are **not tested live**. Metadata was inspected read-only; the correction migration remains unapplied.
4. The existing production self-upgrade vulnerability is **not fixed in production** until approved privilege hardening is deployed. Legitimate server-side payment/promo handlers and client newsletter/profile writes require staging regression checks.
5. Natural Earth 1:110m is a simplified screening boundary, not a legal border. Near-border classifications may be approximate.
6. Chronology URLs/ranges are cited review candidates, not claimed live-verified scholarly validation. Type/period counts refer to the returned eligible subset; truncation is disclosed.
7. To fulfil the strict network allowlist, TRAIN protection uses selected records and cached land restrictions only. Uncached land cells remain unscored, potentially leaving an entirely blank output. Point-only/capped input cannot reproduce full legacy polygon or beyond-area legal protection; do not treat the result as legal clearance. MANUAL remains unchanged.
8. Full regression suite is **not green**: the same 38 pre-existing invocations still fail, and browser skips remain. No production deployment, migration application, push or commit was performed.

## 5. File manifest

The following working-tree manifest accompanies this report. The two deleted catalogue-specific test filenames are listed verbatim in the chat response, not repeated in repository documentation, to keep the removal guard strict.

### Modified

- `LIBRARY_OF_BABEL.md`
- `LIVE_TEST.md`
- `NEXT_GEN_APM.md`
- `ROMANIA_APM_TRAIN_IMPLEMENTATION.md`
- `index.html`
- `js/apm-next/apm-i18n.js`
- `js/apm-next/apm-pipeline.js`
- `js/apm-next/apm-romania-sites.js`
- `js/apm-next/apm-sites.js`
- `js/apm-next/apm-ui.js`
- `js/apm-next/apm-worker.js`
- `js/apm-next/romania-periods.config.js`
- `js/archeo-potential.js`
- `js/library-of-babel.js`
- `js/subscriptions.js`
- `proces.html`
- `process.html`
- `sw.js`
- `technology.html`
- `tehnologie.html`
- `test-apm-exclusions.js`
- `test-apm-next-browser.js`
- `test-apm-next.js`
- `test-apm-romania.js`
- `test-babel-i18n.js`
- `test-babel-multisource.js`
- `test-babel-resilience.js`
- `test-doc-tabs.js`
- `test-historical-eu-maps.js`
- `test-roman-reference-layer.js`
- `test-walachia-footprint.js`

### Created

- `TRAIN_CORRECTION_REPORT.md`
- `backend/migrations/manual/016_apm_romania_train_correction.sql`
- `test-apm-premium-rule.js`
- `test-apm-romania-contract.js`
- `test-apm-server-rpc.js`
- `test-apm-source-guard.js`
- `test-apm-train-network.js`
- `test-results/after.json`
- `test-results/baseline.json`
- `test-results/production-deployment.json`
- `test/fixtures/romania-sites.synthetic.json`
- `tools/apm-test/package-lock.json`
- `tools/apm-test/package.json`
- `tools/run-correction-suite.py`

### Deleted duplicate Romania modules

- `js/apm-next/apm-romania-config.js`
- `js/apm-next/apm-romania-provider.js`

### Deleted catalogue-specific tests

Two dedicated legacy catalogue test files, including their embedded fixtures, were removed. Exact filenames are in the accompanying chat deletion list.
