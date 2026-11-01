# Romania TRAIN: authoritative site source and deployment gates

> Deployment update (2026-11-01): with explicit user approval, Supabase migration `20261101163027_apm_romania_train_correction` is now applied. SQL role/JWT-claim smoke checks passed (anonymous/free denied, premium allowed). Protected browser write grants are revoked. Auth/db/REST are healthy. Frontend deployment awaits PR merge/static hosting; signed-token browser/payment tests remain outstanding. See `test-results/production-deployment.json`. The inspection and deployment-gate notes below describe the initial pre-approval checkpoint and are superseded where applicable.

## Source contract

- Inside the simplified Romania outline, TRAIN uses the existing `window.supabaseClient` from `js/supabase.js` to invoke **only** `apm_sites_within` over **only** `public.archaeological_sites_a`. No client table read, source merge, alternative site service or implicit fallback.
- Outside Romania, no site request is made; the panel says built-in data covers Romania only and offers CSV upload.
- RPC errors, denial, invalid responses and a 20-second client timeout leave TRAIN blocked, show an error and offer an **explicit** CSV upload. CSV replaces, never merges with, the database pool. Changing the centre invalidates the pool and pending upload/load responses.
- The CSV parser/provider are existing modules; the panel now exposes a file input. CSV rows need latitude, longitude, settlement-compatible type and stated positionAccuracy within 100 m; dates/labels are optional. CSV backgrounds are not constrained to Romania.

## Read-only production metadata inspected on 2026-11-01

The connected project matched the shared client project. Only SELECT metadata/grouping queries were executed in this correction. No migrations, DDL, DML or production authentication probes were run.

| Field/property | Observed |
|---|---|
| attributes | jsonb |
| geom | nullable PostGIS geometry; EWKB is its wire representation |
| profile plan / premium_expires_at | text / timestamptz |
| Layer 0 | 29,154 Points, SRID 4326; DA 21,766, NU 7,388 |
| Layer 5 | 5,765 Points, SRID 4326; null COORD |
| Layer 6 | 16,694 Polygons, SRID 4326, plus one null geometry; null COORD |
| Total | 51,614 rows |
| Indexes | GiST(geom), GiST(geom::geography), layer-0 partial geography GiST, layer_id B-tree, primary key(layer_id, object_id) |
| Site/profile RLS | enabled, not forced |
| Policies observed | own-row profile SELECT/INSERT/UPDATE; no site policies returned |
| Profile write grants | authenticated could INSERT/UPDATE plan and expiry, plus Stripe fields |

The all-row Point assumption conflicts with the real schema. Polygons are never converted to centroids. Default DA-only data is layer 0. Empty COORD opt-in can admit actual layer-5 points; it cannot admit polygons. Excluded-geometry counts explain this distinction.

## Migration: manual review only

[`backend/migrations/manual/016_apm_romania_train_correction.sql`](backend/migrations/manual/016_apm_romania_train_correction.sql) is the complete proposed migration. It is deliberately **outside** the startup migrator's non-recursive SQL discovery. It has **not** been applied to production. The older numbered migration files remain as migration history, not current deployment instructions.

The function:
- verifies the expected JSONB/geometry schema;
- requires auth.uid(), a premium profile and an expiry strictly later than now();
- caps radius at 50 km, takes at most 5,001 eligible rows to detect truncation and returns at most 5,000;
- applies the exact COORD filter in SQL, with an explicit empty-COORD argument defaulting false; NU is never eligible;
- returns an envelope with `rows`, `truncated`, spatial total/exclusion counts. Each row contains **only** object_id, lat, lon, name, siruta, coord_flag;
- uses `ST_DWithin(geom::geography, ...)` and the matching all-layer geography expression GiST index. Ordinary GiST(geom) alone cannot accelerate this cast expression; geography gives distances in metres without latitude-dependent degree buffers. The existing index is reused with IF NOT EXISTS. Real revised query speed is unverified;
- removes the unused period-count function, avoiding a second hard-coded classifier.

**Security prerequisite:** the existing profile grants permit users to upgrade themselves. The proposed migration revokes table and legacy column INSERT/UPDATE grants, then grants ordinary profile fields only, excluding plan, expiry and Stripe entitlement fields (and excluding id from UPDATE). Client-created profiles default free. Trusted service-role/backend payment handlers retain their access. `_dlIsPremium()` no longer grants access through its localStorage fallback and uses the same premium-plus-future-expiry predicate. Browser mutation can still change UI appearance, but cannot authorise the RPC. Legacy demo/browser-only premium purchases cannot authorise TRAIN; production payment, promo and newsletter flows require staging verification before deployment.

## Name inference and deduplication

`romania-periods.config.js` is the sole editable period/type rule source. It contains whole-word patterns, approximate year envelopes, per-rule reference URLs, ambiguous bare locality names, excluded non-settlement prefixes and `includeEmptyCoord: false`.

Names are lowercased, Unicode-decomposed, stripped of diacritics and whitespace-collapsed. Period/type matching uses the descriptive text before ` de la `. If absent, the whole name is used with low confidence; bare ambiguous locality names stay unknown. Unknown periods remain unknown, including places named Roman/Romanesti. A successful period match carries periodSource='name-keyword', a numeric periodConfidence and its reference. These are lexical inferences, never verified site dates. Reference URLs/ranges are review candidates, not claimed live-verified sources. The missing sample prevents identifying additional genuine period terms from it.

Each row remains one site. Deduplication requires **both** equal normalised names and distance at most 5 m. CODSIT/SIRUTA are never grouping keys. Names survive mapping. The downstream national-data pool does not repeat the old spatial-only dedupe. COORD=DA is a categorical exact-position designation; the provider leaves numeric accuracy null rather than inventing a measured metre precision. Empty COORD opt-in is disclosed as unknown accuracy.

## Panel, geography and protection

- All periods is selected by default. The 50 km picker shows usable counts per inferred label; fewer than 10 sites blocks, fewer than 30 warns. Unknown periods remain in All periods.
- The panel reports total spatial records, approximate-position exclusions, excluded empty-position points, non-point geometry exclusions, non-settlement exclusions and usable unknown periods. Truncation warns that returned type/period counts and training are a subset. Counts absent from an older RPC are displayed as unavailable, never fabricated zero.
- Boundary: Natural Earth Admin-0 **1:110m**, public domain, Romania feature copied from [the source GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson). It is generalised, not cadastral/legal. Segment-distance detection warns when the training circle intersects the outline; background points are tested against the polygon. Near-border uncertainty remains.
- Prediction protection for TRAIN receives the chosen database/CSV records, including approved-position non-settlements retained solely for protection, rather than lazily loading legacy heritage layers. It performs **no new land-restriction downloads**; uncached restriction cells are unscored with the existing warning. MANUAL keeps the previous protection behaviour. Polygon protection and records beyond the capped 50 km input are not available through this six-field point-only contract; the model output is not a complete legal-clearance map.

## Verification

See [TRAIN_CORRECTION_REPORT.md](TRAIN_CORRECTION_REPORT.md) for the before/after suite, exact commands, known failures and evidence limits. Tests use a clearly labelled synthetic fixture, **not** the unavailable `archaeological_sites_a_rows.json`. The local PostgreSQL/PostGIS test executes the real migration and permission checks; the network test completes the real UI/provider/pipeline/worker path with mocked services. Neither is a production deployment or live auth/performance test.
