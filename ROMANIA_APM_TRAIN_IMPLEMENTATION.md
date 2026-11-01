# Romania provider for Next-Gen APM TRAIN

## Repository inspection and deployment gate

- `backend/migrations/001_init.sql` declares `archaeological_sites_a.attributes` as `JSONB NOT NULL` and `geom` as `geometry(Geometry,4326) NOT NULL`; migrations 002/003 add layer fields and allow null geometry. `backend/src/services/postgis/syncState.js` confirms the RAN mirror uses `_a`/`_b` tables. These are repository declarations, **not live-schema introspection**.
- Live Supabase introspection confirmed `object_id bigint`, `attributes jsonb`, `geom geometry` (nullable), `synced_at timestamptz`, `layer_id integer`, `layer_name text`; `profiles.id uuid`, `plan text`, `premium_expires_at timestamptz`. The point layer is `layer_id=0` (`Repertoriul arheologic national (puncte)`, 29,154 records), and its non-null geometries are all POINT/SRID 4326. Two other layers are polygons (national repertory, layer 6) and tumuli (layer 5), so the RPC restricts queries to point layer 0. In layer 0 the live `COORD` grouping returned DA=21,766 and NU=7,388; no empty/null COORD rows appeared in that layer. This differs from the user's provided all-table counts and is why non-point layers are excluded.
- Live indexes included a geography GiST expression index, a geometry GiST, the layer index and primary key `(layer_id, object_id)`. `archaeological_sites_a` has RLS enabled, not forced, and no policies; the SECURITY DEFINER function is therefore the deliberate access path. `profiles` RLS is enabled with own-row SELECT/UPDATE/INSERT policies.
- The existing heritage web app initializes `window.supabaseClient` in `js/supabase.js`; the RAN service itself is mirrored through PostGIS. The APM client uses Supabase RPC (`apm_sites_within`) only; no direct table read is added. The RPC uses `SECURITY DEFINER` and checks `profiles.plan='premium'` plus `premium_expires_at > now()` server-side.
- `_dlIsPremium()` is not a server-authoritative database mechanism: it accepts a localStorage fallback in `js/subscriptions.js`. The RPC intentionally does not trust that bypassable value. Premium users whose entitlement exists only in localStorage will be rejected until that entitlement is persisted to `profiles` (or a trusted server entitlement mechanism is specified).

## Migration and index rationale

Applied to the connected Supabase project on 2026-11-01 as migrations `apm_romania_sites` and `apm_romania_rpc_permissions`. The first replaces the previous three-argument RPC, adds the four-argument RPCs (`p_include_empty_coord` defaults false), and creates a layer-0 partial geography GiST index; the second explicitly revokes direct anon execution and grants authenticated/service-role execution. Live post-migration inspection confirmed both functions are SECURITY DEFINER, owned by postgres, and have authenticated/service_role grants only. It creates `archaeological_sites_a_geom_geog_gist` on `(geom::geography)`. This matches `ST_DWithin(geom::geography, ...)` and gives metre-distance semantics at any latitude. The RPC caps radius at 50 km, hard-limits returned rows to 5,000, returns a `truncated` flag and only returns object id, coordinates, name, SIRUTA and COORD flag. It filters `COORD='DA'` in SQL; NU and empty values cannot enter the result. A second premium RPC returns broad period counts; its keyword CASE expression currently needs to be maintained alongside the editable browser config. The real query plan/performance is not verified.

## Source and classification

`js/apm-next/apm-romania-sites.js` implements `RomaniaRepertoryProvider` behavior (exported as `createProvider`) through Supabase RPC. Outside the simplified boundary (roughly derived from Natural Earth Admin-0 Romania 1:10m), it returns an empty result with an outside-Romania message in metadata. A rough border-crossing flag is emitted; TRAIN's background sampler accepts an `allowed` predicate so generated negative/background samples are constrained to Romania. This approximate outline must not be used for legal boundaries.

`js/apm-next/romania-periods.config.js` is editable and includes approximate ranges, name keywords, excluded non-settlement patterns, a default `includeEmptyCoord: false`, and citations to Radu & Schuster (eds.), *The Archaeology of Romania* (2013) plus RAN terminology. Dates are explicitly approximate and require archaeological review. Names are normalized; the text before ` de la ` is used for keyword matching; no-`de la` matches are marked low confidence. Dedupe requires both same normalized name and coordinates within 5 m; CODSIT is never used to merge. CSV provider parsing remains in `apm-providers.js`; Ariadne provider construction was removed.

Attribution shown in the TRAIN panel: National Archaeological Repertory / `archaeological_sites_a`; licence **OPEN QUESTION**.

## Robust TRAIN site handling (follow-up)

A single shared config (`DetectLabApmCore.robustTrainConfig`) sets the 60 m median neighbourhood, minimum 20 sites, 20% down-weight cap, Tukey floor 0.08, cluster thresholds (8 sites and >15%), 4 maximum reweight iterations and weight-shift warning threshold. The method first fits the plain model, computes robust median/MAD distances in the standardized site-variable space, applies soft Tukey-style weights, then refits. CV does this within each training fold and scores every held-out site in both plain and robust versions. Hard exclusions are recorded by reason; exact duplicate coordinate records are no longer silently removed by the TRAIN pre-filter. Restore actions refit from cached samples through the worker, without re-fetching sites/terrain/water.

The synthetic test gave **5/5 injected random outliers down-weighted**, **0/45 genuine sites down-weighted** (0% false positives), and weight L1 error **0.275 robust vs 0.314 plain** against illustrative known weights. The 30% coherent second-rule test was preserved as a possible second pattern; 19 sites skipped robust handling; a 40% random case respected the 20% cap. **Real data will do worse**: this is a controlled synthetic dataset, not a field-performance estimate.

## Tests

- Baseline before edits: `node test-apm-next.js` → 60 pass, 0 fail.
- Current: `node test-apm-next.js` → 60 pass, 0 fail.
- `node test-apm-romania-sites.js` → provider unit checks (normalization, descriptive section, Roman/Romanesti false positives, keyword specificity, type exclusions, dedupe not by CODSIT, border-filtered sampling, default COORD setting).
- `node test-apm-ariadne.js` is now a regression test asserting Ariadne provider removal and CSV provider availability.
- Fixtures: the requested 100-row JSON was not present, so tests do **not** claim to use it and do not call live Supabase.

## Not verified / incomplete

- One live `EXPLAIN ANALYZE` point-layer query at Cluj (50 km, COORD=DA, limit 5,001) used `archaeological_sites_a_ran_points_geog_gist`, returned 749 rows, and took about 145 ms execution (53 ms planning). This is a single-center SQL measurement, not a full endpoint/51k-row benchmark; other centers, RPC serialization, authenticated premium/free-user behavior and browser integration remain unverified. Table schema/index/RLS metadata was inspected live and migrations were applied successfully.
- This repository's current TRAIN UI did not contain an actual CSV file-upload control (the CSV parser/provider existed); this change keeps the CSV provider/parser but does not invent a new upload UI.
- The separate period-count RPC is installed by the migration but the picker currently groups the returned bounded record set in the client rather than consuming that RPC. Summary counts for all approximate-position records and excluded non-settlements are not yet surfaced as the full requested audit panel. The site result metadata records counts only over the bounded exact records returned.
- The border-crossing and outline are approximate. No live fixture was available to validate the polygon against the 100-row sample.
- The provider invokes the sites RPC but not `apm_site_period_counts`; this should be wired before relying on picker counts when the result limit truncates.
