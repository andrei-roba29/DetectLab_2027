# Cloudflare Pages migration — DetectLab

**Status: implemented, locally verified, NOT deployed. The Netlify deployment is untouched and stays live.**

This document describes the parallel Cloudflare Pages deployment that now lives
next to the existing Netlify one. Everything here is **additive**: no Netlify
file was modified, no Netlify behaviour was changed, no DNS was touched, and
nothing was deployed. Both hosts can run side by side until the Cloudflare one
has been validated on a `*.pages.dev` preview URL.

Companion document: **[`CLOUDFLARE_DASHBOARD_CHECKLIST.md`](CLOUDFLARE_DASHBOARD_CHECKLIST.md)** —
the manual actions that cannot be done from the repository.

```
                       ┌──────────────────────────────────────────────┐
   LIVE, unchanged     │  Netlify                                     │
   detectlab.ro  ─────▶│  publish "." · netlify.toml · netlify/functions│
   detectlab.eu        │  node tools/build-corona-europe-catalog.mjs   │
                       └──────────────────────────────────────────────┘
                       ┌──────────────────────────────────────────────┐
   NEW, not deployed   │  Cloudflare Pages                            │
   <hash>.pages.dev ──▶│  build  node tools/cloudflare-build.mjs      │
   (later: the same    │  output cloudflare-dist/  (assembled, not ".")│
    two domains)       │  routes functions/  (9 filesystem routes)     │
                       └──────────────────────────────────────────────┘
```

Both deployments are built from the same repository, the same commit, and — for
the CORONA catalogue — the same script. The server logic is the same code: seven
of the nine Cloudflare Functions import the Netlify/Express handler directly,
and the other two run build-time-generated copies that
`tools/cloudflare-parity-check.mjs` proves behave identically (§4).

---

## 1. Architecture

| | Netlify (live) | Cloudflare Pages (new) |
|---|---|---|
| Frontend publish directory | `.` (`netlify.toml`) | `cloudflare-dist/`, assembled by `tools/build-cloudflare-dist.mjs` |
| Functions | `netlify/functions/*.mjs` + `netlify.toml` rewrites | `functions/**` filesystem routing + `cloudflare/_routes.json` |
| Runtime | Node.js 20/22 container | workerd isolate (V8, Web APIs) |
| Shared logic | `netlify/lib/`, `backend/src/lib/`, `js/layer-registry.js` | **the same files**, imported directly |
| Corona catalogue | `node tools/build-corona-europe-catalog.mjs \|\| true` | the identical command, run by `tools/cloudflare-build.mjs` |
| Config files | `netlify.toml` (`[[redirects]]`, `[[headers]]`) | `cloudflare/_routes.json`, `_headers`, `_redirects`, `404.html` |
| Secrets | Netlify env vars | Pages secrets, read from `context.env` (§5) |

**Why the Cloudflare deployment does not publish the repository root.**
Netlify publishes `.` and reads any `_headers` / `_redirects` / `404.html` it
finds there. Cloudflare needs all of those files. Putting them at the repository
root would have silently changed the live Netlify site — the one thing this
migration must not do — so `tools/build-cloudflare-dist.mjs` assembles a
dedicated output directory: the same repository content Netlify publishes, plus
the Cloudflare-only configuration files from `cloudflare/`.

**Workers + Static Assets was not needed.** Pages Functions with filesystem
routing covers all nine endpoints, so the deployment stays a Pages project
(`pages_build_output_dir` in `wrangler.jsonc`). No `_worker.js`, no separate
Worker, no KV/D1/R2/Durable Objects/Queues. The one thing Pages cannot do —
match a hostname in `_redirects` — is handled by `functions/_middleware.js` plus
a Dashboard Redirect Rule (§6.4).

### 1.1 Files added

```
functions/                        Cloudflare Pages Functions (filesystem routing)
  package.json                    {"type":"module"} — the Functions tree is ESM
  _middleware.js                  www → apex 301 for API paths; never cross-market
  _lib/runtime-shims.js           process.env + Buffer on Web APIs (no nodejs_compat)
  _lib/pages-adapter.js           Netlify handler ⇄ Cloudflare event/context/response
  _lib/corona-cache.mjs           caches.default snapshot tier for the CORONA catalogue
  _generated/map3d-country-modules.mjs   generated — do not edit (§4.3)
  _generated/map3d-tile.mjs              generated — do not edit
  _generated/finland-geo.mjs             generated — do not edit
  api/corona/rasters.js
  api/map3d/tile.js
  api/geo/se-hojdmodell.js
  api/geo/dk-dhm.js
  api/geo/dk-dtk25.js
  api/geo/dk-orto.js
  api/geo/dk-heritage.js
  api/geo/finland.js
  api/geo/asig-heritage.js

cloudflare/                       copied into cloudflare-dist/ by the build
  _routes.json                    Functions only on the nine API paths
  _headers                        OAuth callback headers + PWA revalidation + nosniff
  _redirects                      comments only (Pages cannot match a hostname)
  404.html                        real 404s instead of an index.html fallback (§6.3)

tools/
  sync-cloudflare-generated.mjs   generates functions/_generated/* from the canonical sources
  cloudflare-parity-check.mjs     proves the generated copies behave identically
  build-cloudflare-dist.mjs       assembles cloudflare-dist/
  cloudflare-build.mjs            the Pages build command (3 steps)
  cloudflare-smoke.mjs            live end-to-end test against a running deployment
  cloudflare-map3d-audit.mjs      Netlify ⇄ Cloudflare sweep of all 189 Map3D layers
  corona-snapshot.mjs             "is this CORONA catalogue file worth publishing?"

test-cloudflare-functions.mjs     516 checks — the nine Functions, per route
test-cloudflare-config.mjs        362 checks — additive-ness, routing, headers, build,
                                             OAuth callback, CORONA snapshot, slug
test-cloudflare-generated.mjs     135 checks — generator determinism and fidelity
wrangler.jsonc                    Pages project configuration
```

### 1.2 Files modified

Exactly one, and only by appending:

* `.gitignore` — added `cloudflare-dist/`, `.wrangler/`, `.dev.vars`. No existing
  rule was removed (`test-cloudflare-config.mjs` asserts the diff is additions only).

### 1.3 Files deliberately preserved and untouched

`netlify.toml` · `netlify/functions/*` (all nine) · `netlify/lib/*` ·
`backend/**` (the Express service) · `js/**`, `css/**`, `src/**`, `index.html`,
`sw.js`, `manifest.json`, `google-auth-callback.html`, `checkout.html` (the whole
frontend and PWA) · `data/**` · `supabase/**` · `rvt_service/**` ·
`detectlab-feedback/**` (a separate Cloudflare Worker project) ·
`tools/build-corona-europe-catalog.mjs` · every existing `test-*.mjs` / `test-*.js`.

`git status` on the migration branch shows no modification to any of them, and
`test-cloudflare-config.mjs` fails the build if that ever changes.

---

## 2. The CORONA Europe catalogue

The catalogue implementation is **not duplicated**. There is one builder
(`tools/build-corona-europe-catalog.mjs`, which imports
`netlify/lib/corona-catalog.mjs`) and one runtime handler
(`netlify/lib/corona-catalog.mjs`), used by both hosts.

### 2.1 Build time — the same command on both hosts

| | command | failure behaviour |
|---|---|---|
| Netlify | `node tools/build-corona-europe-catalog.mjs \|\| true` (`netlify.toml`, unchanged) | deploy continues |
| Cloudflare | `node tools/cloudflare-build.mjs` → step 2 runs the **same script from the repository root** with `tolerateFailure: true` | deploy continues |

`data/corona-europe-catalog.json` is **git-ignored** (it is ~30 MB of generated
JSON), so on both hosts it exists only if the build reached CAST
(`cast.cse.ro` / the CORONA science-server endpoints listed in
`netlify/lib/corona-catalog.mjs`).

### 2.2 Fallback chain when CAST is unreachable

The frontend already had a three-tier chain; the migration preserves it and adds
a fourth tier on the server:

1. `window.CORONA_CATALOG_URL` if the page sets one;
2. the static file `data/corona-europe-catalog.json` **if the build produced it**;
3. the runtime proxy `GET /api/corona/rasters?bbox=…`;
4. the built-in fallback catalogue compiled into the frontend.

Two additions make tier 2 and tier 3 survivable:

* **A committable snapshot.** `node tools/cloudflare-build.mjs --update-corona-snapshot`
  writes `data/corona-europe-catalog.snapshot.json` after a *successful* live
  build. That file is **not** git-ignored, so it can be committed once and then
  published by every later build in which CAST is down (`tools/cloudflare-build.mjs`
  copies it to `data/corona-europe-catalog.json`). It is not committed yet —
  creating it needs a machine that can reach CAST, and this migration was
  verified in a sandbox with no egress to it. Until it is committed, a CAST
  outage falls through to tiers 3 and 4 exactly as on Netlify today.

  **Neither direction can corrupt a snapshot.** Every copy goes through
  `tools/corona-snapshot.mjs`, which refuses a file that is absent, unreadable,
  not JSON, not an object, has no `blocks[]` array, or parses with `blocks: []`
  — the shape a reshaped or empty upstream answer would produce, and which would
  otherwise blank the CORONA layer for every visitor while the build reported
  success. A refused copy leaves the existing file byte-for-byte alone. The
  generator itself cannot truncate one either: `tools/build-corona-europe-catalog.mjs`
  `await`s `fetchCoronaCatalog()` and only reaches its single `fs.writeFileSync`
  after `buildCatalogPayload()` succeeded, so a failed refresh throws before
  touching the output. Measured: pointing the real generator at a file with known
  contents while CAST is unreachable → exit 1, file byte-identical
  (group 10 of `test-cloudflare-config.mjs` re-runs that experiment every time).
* **A datacentre cache tier.** `functions/_lib/corona-cache.mjs` wraps the shared
  handler with `caches.default` (30 days) on top of the handler's own 12-hour
  isolate-memory cache, and reports which tier answered in
  `X-DetectLab-Corona-Cache: live | miss | stale`. So a Cloudflare deployment
  that once reached CAST keeps answering from cache when CAST goes down, instead
  of returning 502. Netlify's container memory cache already did the equivalent
  for the life of a container; this is the isolate-safe version of the same idea,
  and it is additive — the response body is produced by the shared, unmodified
  handler.
* **A deployed-asset tier (`env.ASSETS.fetch`).** Behind both of those,
  `assetCatalogueSnapshot()` in the same file asks Pages for the deployment's own
  `/data/corona-europe-catalog.json` through the `env.ASSETS` binding — no public
  round trip, no extra egress. It runs only when CAST is unreachable **and** the
  isolate has no memory copy **and** `caches.default` has none, i.e. a cold
  datacentre during an outage, and it answers with
  `X-DetectLab-Corona-Cache: snapshot` plus `"snapshot": true` in the body so the
  client can tell it is not a live CAST answer. Because that file is the
  Europe-clipped payload rather than the raw worldwide catalogue, it is re-clipped
  to the caller's `bbox` with the **same** `bboxIntersects()` from
  `netlify/lib/corona-catalog.mjs` that the upstream clipping uses — a bbox over
  Asia gets a 502, not "here is all of Europe". Nothing is fabricated: no
  binding, a non-200, unparseable JSON, a missing `blocks[]` or `blocks: []` all
  fall through to the honest 502 (group C3 of `test-cloudflare-functions.mjs`,
  19 checks). Today no snapshot is deployed, so this tier is inert and the route
  answers 502 — verified live.

---

## 3. Function → route map

Every frontend call is a **same-origin relative `/api/...` path**, so no frontend
URL changed. `_routes.json` lists exactly these nine paths, and nothing else.

| Route | Cloudflare Function | Netlify Function | Where the logic lives |
|---|---|---|---|
| `GET /api/corona/rasters` | `functions/api/corona/rasters.js` | `corona-rasters.mjs` | `netlify/lib/corona-catalog.mjs` (imported verbatim) + `functions/_lib/corona-cache.mjs` |
| `GET /api/map3d/tile` | `functions/api/map3d/tile.js` | `map3d-tile.mjs` | `functions/_generated/map3d-tile.mjs` (generated from `netlify/lib/map3d-tile.mjs`) + `js/layer-registry.js` + `functions/_generated/map3d-country-modules.mjs` |
| `GET /api/geo/se-hojdmodell` | `functions/api/geo/se-hojdmodell.js` | `se-hojdmodell.mjs` | the Netlify handler, imported verbatim |
| `GET /api/geo/dk-dhm` | `functions/api/geo/dk-dhm.js` | `dk-dhm.mjs` | the Netlify handler, imported verbatim |
| `GET /api/geo/dk-dtk25` | `functions/api/geo/dk-dtk25.js` | `dk-dtk25.mjs` | `backend/src/lib/danish-layers.mjs` (imported verbatim) |
| `GET /api/geo/dk-orto` | `functions/api/geo/dk-orto.js` | `dk-orto.mjs` | `backend/src/lib/danish-layers.mjs` (imported verbatim) |
| `GET /api/geo/dk-heritage` | `functions/api/geo/dk-heritage.js` | `dk-heritage.mjs` | `backend/src/lib/danish-layers.mjs` (imported verbatim) |
| `GET /api/geo/finland` | `functions/api/geo/finland.js` | `finland-geo.mjs` | `functions/_generated/finland-geo.mjs` (generated from `backend/src/lib/finland-geo.mjs`) |
| `GET /api/geo/asig-heritage` | `functions/api/geo/asig-heritage.js` | `asig-heritage.mjs` | `backend/src/lib/asig-heritage.mjs` (imported verbatim) |

Seven of nine import the existing handler directly. Only `map3d/tile` and
`finland` needed a generated copy, and only because their canonical sources read
files from disk at request time (§4.3).

**Not migrated, on purpose:**

* `/api/rvt/*` — the Python RVT service in `rvt_service/`, deployed on its own
  host. `test-cloudflare-functions.mjs` and `tools/cloudflare-smoke.mjs` assert
  that no such route exists here. Its browser-facing data file
  `rvt_service/methods.json` *is* published, because `js/rvt-panel.js` fetches it
  as its offline fallback and `sw.js` precaches it
  (`BROWSER_FACING_IN_EXCLUDED_DIRS` in `tools/build-cloudflare-dist.mjs`).
* `backend/` — the Express service (Railway). The migration brief excludes it and
  nothing in the frontend calls it same-origin.
* `DETECTLAB_API_BASE`-prefixed endpoints — absolute Railway URLs, unaffected by
  which host serves the frontend.
* `detectlab-feedback/` — already a separate Cloudflare Worker project with its
  own `wrangler.toml`; untouched.

### 3.1 Per-function status

| Function | Status | Notes |
|---|---|---|
| `corona/rasters` | ✅ migrated, tested | shared handler + `caches.default` tier; 502 `no-store` on a cold CAST outage, stale served once warm |
| `map3d/tile` | ✅ migrated, tested | generated copy; registry statically imported (189 layers); eight country modules compiled in; relay still allow-listed (54 hosts); 7-day CDN pin preserved |
| `geo/se-hojdmodell` | ✅ migrated, tested | Netlify handler verbatim; Basic/Bearer credential handling; 7-day pins |
| `geo/dk-dhm` | ✅ migrated, tested | Netlify handler verbatim; token as an HTTP header, never in a URL |
| `geo/dk-dtk25` | ✅ migrated, tested | shared Danish library verbatim; KVP allow-list, `layers=` replaced |
| `geo/dk-orto` | ✅ migrated, tested | shared Danish library verbatim; Basic auth from `DATAFORDELER_*` |
| `geo/dk-heritage` | ✅ migrated, tested | shared Danish library verbatim; Snyder EPSG:25832 ⇄ 4326, `maxFeatures` clamped to 400 |
| `geo/finland` | ✅ migrated, tested | generated copy; 133–156 WFS ids, TM35FIN matrix, 15 MB cap, 20 s timeout |
| `geo/asig-heritage` | ✅ migrated, tested | shared library verbatim; GET-only, `redirect: 'error'`, 2 MB cap, bbox clamped to Greece |

All nine were additionally exercised end-to-end in a real workerd runtime
(`wrangler pages dev`) by `tools/cloudflare-smoke.mjs`: 350 live checks.

---

## 4. Runtime compatibility audit

### 4.1 What the isolate provides, and what it does not

Measured in the actual runtime (`wrangler pages dev`, workerd 2026-11-10), not
assumed:

| Capability | workerd | Consequence |
|---|---|---|
| `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams` | ✅ native | all upstream calls unchanged |
| `Buffer` | ❌ absent without `nodejs_compat` | shimmed (§4.2) |
| `process.env` | ❌ absent | shimmed from `context.env` (§4.2) |
| `caches.default` | ✅ native | CORONA snapshot tier (§2.2) |
| Static ESM `import` of repository files | ✅ works (bundled by wrangler) | the registry and the `.cjs` configs are imported, not read |
| `node:fs`, `node:path`, `node:url`, `node:module` | ❌ absent | removed in generated copies only (§4.3) |
| `node:vm` | ❌ absent | removed in generated copies only (§4.3) |
| `new Function(…)`, `eval(…)` | ❌ `EvalError: Code generation from strings disallowed` | the country modules are compiled in, not evaluated (§4.3) |
| Streaming / binary bodies | ✅ `Response` with an `ArrayBuffer`/`Uint8Array` | tiles are byte-identical (`test-cloudflare-functions.mjs` compares PNG/JPEG bytes) |
| `HEAD` | ✅ answered with headers and an empty body | parity with Netlify |
| `AbortSignal.timeout`, `setTimeout` | ✅ | the Finnish 20 s and Albanian 10 s timeouts kept |

### 4.2 `nodejs_compat` is **not** enabled — and why

`wrangler.jsonc` declares `"compatibility_flags": []`. The only two Node APIs the
migrated server code actually needs are `process.env` and `Buffer`, and
`functions/_lib/runtime-shims.js` provides both on top of Web APIs:

* `bindEnv(context.env)` exposes a live **view** of `context.env` as `process.env`.
  Cloudflare's `env` object is a proxy whose keys are not always enumerable, so
  the bindings are read through a trap rather than copied — a secret is never
  materialised into a plain object earlier than the shared library reads it. Only
  the eleven names in `KNOWN_ENV_VARS` (§5) are ever looked up.
* `Buffer` is implemented over `Uint8Array`/`TextEncoder`/base64, covering exactly
  the operations the handlers use: `Buffer.from(string, 'utf8'|'base64')`,
  `Buffer.from(arrayBuffer)`, `.toString('utf8'|'base64'|'latin1')`, `.slice`,
  `.concat`, `.length`, `.subarray`. `test-cloudflare-functions.mjs` §L asserts
  the Basic-auth encoding the Swedish proxy needs and the OGC-sniffing slice
  against Node's real `Buffer`.

The alternative — `nodejs_compat` + `createRequire` — was tried and abandoned:
`createRequire` still cannot read a file inside an isolate, there is no
filesystem to read from, and enabling the flag would widen the runtime surface
for every Function to solve a problem two shims solve. Dead end, documented so it
is not retried.

Netlify-only response headers are translated, never dropped:
`Netlify-CDN-Cache-Control` → **both** `CDN-Cache-Control` and
`Cloudflare-CDN-Cache-Control` with the identical value, so the 7-day tile pins
survive; `Cache-Control` (the browser directive) is left byte-for-byte alone;
`X-DetectLab-Runtime: cloudflare-pages-function` is added so a response can be
attributed to a host during the coexistence period. `functions/_lib/pages-adapter.js`
does this in one place, and it is what turns a Netlify-shaped handler result
(`{statusCode, headers, body, isBase64Encoded}` **or** a `Response`) into a
Cloudflare `Response`, including `jsonProblem()` for errors and a generic 500
that never leaks an exception message.

### 4.3 The one real blocker, and how it was solved

`netlify/lib/map3d-country-modules.mjs` reads eight browser layer scripts
(`js/ahn-layer.js`, `js/hoydedata-layer.js`, `js/geoportal-nmt-layer.js`,
`js/ign-mdt-layer.js`, `js/swisstopo-relief-layer.js`,
`js/ea-lidar-wmts-layer.js`, `js/dataforsyningen-dhm-layer.js`,
`js/lantmateriet-hojdmodell-layer.js`) from disk with `node:fs` and evaluates
each one in a `node:vm` sandbox at request time, because those scripts build
country-specific tile URLs (WMS GetMap, ArcGIS `exportImage`) instead of a
`{z}/{x}/{y}` template.

In workerd **both halves are impossible**: there is no filesystem, and code
generation from strings is refused (`EvalError`). Two dead ends were measured
before choosing the solution:

* `new Function(body)` / `eval(body)` → `EvalError: Code generation from strings disallowed`;
* `nodejs_compat` + `createRequire` → no file to require.

**Solution: compile the modules in at build time.**
`tools/sync-cloudflare-generated.mjs` emits
`functions/_generated/map3d-country-modules.mjs`, where each of the eight scripts
appears **verbatim** as the body of a real function
(`runCountryModule0…7`) invoked through a `MODULE_RUNNERS` table, with the
sandbox globals (`window`, `document`, `navigator`, `L`, `fetch`, …) supplied as
shadowing parameters by `countryModuleScope()`. A module that does not start with
`'use strict'` is refused by the generator rather than silently inlined into a
strict ES module; all eight qualify. Nothing is paraphrased:
`test-cloudflare-generated.mjs` compares every code line of all eight source
scripts against the generated file (1 574 code lines today) and fails on a single
missing one.

The same generator produces two smaller transformations:

* `functions/_generated/map3d-tile.mjs` — from `netlify/lib/map3d-tile.mjs`:
  `createRequire(REGISTRY_PATH)` → `import registryModule from '../../js/layer-registry.js'`
  (189 layers, verified at runtime), plus the CDN header translation (§4.2);
* `functions/_generated/finland-geo.mjs` — from `backend/src/lib/finland-geo.mjs`:
  `require(path.resolve(HERE, 'finland-layers.config.cjs'))` →
  `import finlandLayersConfig from '../../backend/src/lib/finland-layers.config.cjs'`.

**Drift protection.** The generated files carry a do-not-edit banner and are
regenerated by every build (`tools/cloudflare-build.mjs` step 1).
`node tools/sync-cloudflare-generated.mjs --check` fails if a committed copy
differs from what its sources produce; `test-cloudflare-generated.mjs` proves the
guard is armed (it deliberately corrupts a generated file, expects a non-zero
exit, then regenerates it byte-identically) and that generation is deterministic.
`tools/cloudflare-parity-check.mjs` then imports **both** copies — the
Netlify/Express original and the generated one — and compares behaviour rather
than text:

```
✓ 7 parity groups verified
  · 189 registry layers resolve identically (18 pinned layer cases)
  · 36 tiles × 10 CRS produce identical bounding boxes
  · 54 relay hosts / 24 relay URLs validated identically
  · 68 tile requests validated identically
  · 2963 upstream URLs built identically for 189 layers (8 module-backed)
  · 18 handleTileRequest cases produce the same upstream request and response
  · Finland proxy identical: config, tile matrix, allow-lists and 57 requests
```

The single intentional text difference — the relay-refusal hint also names the
regeneration command — is allow-listed explicitly in `KNOWN_TEXT_DIFFERENCES`
rather than by weakening the comparison.

### 4.4 Known non-issues (parity, not bugs)

* Registry layers whose `url` is a **relative** same-origin path
  (`danish.dtk25`, `danish.orto`, `danish.fortidsminder`) cannot be fetched by
  the tile proxy on *either* runtime — undici rejects a relative URL just as
  workerd does — so both answer the labelled transparent 1×1 PNG. The frontend
  uses the dedicated `/api/geo/dk-*` routes for those layers. Pinned by the
  parity check; do not "fix" it.
* `OPTIONS` on `se-hojdmodell` and `dk-dhm` is treated as a WMS/WMTS request
  (400 without a `REQUEST` parameter), and `asig-heritage` answers 405 to
  anything but GET. That is the Netlify behaviour, reproduced deliberately and
  pinned by tests. The browser never sends a preflight to these routes: they are
  same-origin `<img>`/`fetch` calls.

### 4.5 Map3D / LiDAR: `per-tile-builder-unavailable`, investigated exhaustively

`per-tile-builder-unavailable` is emitted at one place,
`netlify/lib/map3d-tile.mjs:206` (mirrored at `functions/_generated/map3d-tile.mjs:230`),
when a layer declares a per-tile `builder.module` that the runtime cannot resolve.
Because the Workers isolate cannot `eval` a module from a string (§4.3), the
question was whether any of the browser-side LiDAR builders had been left behind.
It was answered by measurement, not by reading: **`tools/cloudflare-map3d-audit.mjs`**
sweeps the whole registry through both implementations and exits 1 on any
divergence.

| Sweep | Scale |
|---|---|
| Layers | **189 of 189** registered |
| Tiles per layer | **97** (world z=2, Europe z=5 and z=8, three deep-zoom fixtures) |
| Modes / times / products | 8 modes, 3 times, 3 products where declared |
| `buildUpstreamUrl` comparisons | **26 190** |
| End-to-end `handleTileRequest` requests | **189** |
| **Divergences** | **0** |

**Result: no layer returns `per-tile-builder-unavailable` on either host.** Only
8 layers declare a `builder.module`, and all 8 point at files already compiled
into `COUNTRY_MODULES` — each traced to its browser-side source, each built 776
URLs across the sweep:

| Layer | Browser-side builder | Server-side entry point |
|---|---|---|
| `lidar.nl-ahn` | `js/ahn-layer.js` | `AhnLidar.exportImageUrl(bbox)` |
| `lidar.no-hoydedata` | `js/hoydedata-layer.js` | `Hoydedata.exportImageUrl(bbox)` |
| `lidar.pl-nmt` | `js/geoportal-nmt-layer.js` | `GeoportalNMT.tileUrl(bbox)` |
| `lidar.es-mdt` | `js/ign-mdt-layer.js` | `IgnMdt.tileUrl(bbox)` |
| `lidar.ch-swisstopo` | `js/swisstopo-relief-layer.js` | `SwisstopoRelief.tileUrl(tile)` |
| `lidar.uk-ea` | `js/ea-lidar-wmts-layer.js` | `EaLidarWmts.tileUrl(tile)` |
| `lidar.dk-dhm` | `js/dataforsyningen-dhm-layer.js` | `DataforsyningenDHM.tileUrl(tile)` |
| `lidar.se-lantmateriet` | `js/lantmateriet-hojdmodell-layer.js` | `LantmaterietHojdmodell.tileUrl(bbox)` |

The four `js/*-layer.js` files that are *not* embedded (`battles`,
`corona-coverage`, `corona-wms`, `multi-style`) are referenced by **no**
`builder.module` at all, so no layer can ever ask the runtime for them. No output
was changed to achieve this, and no real data was replaced by a transparent tile:
the only builder error the sweep produces anywhere is `missing-product` on the 7
`kind:'dynamic'` layers that require a `p=` product — **identically on Netlify** —
and they build URLs normally once a product is supplied.

#### Which layers actually reach `/api/map3d/tile`

Classified with the registry's own `map3dTiles()` (section E of the audit tool):

| Transport | fresh session | `proxyHostsAll` (test-only ceiling) |
|---|---|---|
| proxied through `/api/map3d/tile` | **11** | 173 |
| `dl3d://` — per-tile module call in the browser | **5** | 1 |
| direct `http(s)` upstream URL | **145** | 13 |
| same-origin `/api/geo/*` credential proxy | **27** | 1 |
| no tile template at all | **1** | 1 |
| **total** | **189** | **189** |

The 11 are exactly the layers declared `proxy: 'always'`: `sat.corona-60s`,
`sat.vhr-2012`, `sat.vhr-2018`, `sat.vhr-2021`, `cenagis.kdr`, `cenagis.ukvme`,
`cenagis.city_warszawa_1822`, `cenagis.city_praga_1796`, `albania.ortho_2015_20cm`,
`albania.ortho_1999`, `albania.heritage`. At runtime a cross-origin `auto` layer
is added when its provider fails the CORS probe, so the Function's real workload
sits between 11 and 173 — and the sweep covers all 189 either way.

The 173 ceiling is **not** reachable in production: `proxyHostsAll` is a
test/debug override that `js/map3d-terrain.js` never sets (it passes
`proxyHosts: Object.keys(state.proxyHosts)`), and the 27 same-origin layers can
never be healed onto the proxy at all, because `hostOf()` returns `''` for a
relative URL and the heal path bails out on an empty host
(`if (!host || state.proxyHosts[host]) return;`). The audit tool asserts both
facts against the source and fails if they stop being true.

Of the 5 `dl3d://` layers, 4 move onto the proxy when their host is healed — and
the Function's embedded module then builds a byte-identical URL — while
`lidar.se-lantmateriet` (`proxy: 'never'`) stays in the browser permanently.
`overlay.image-overlays` yields no template: `map3dTiles()` returns `[]` for a
dynamic definition with no resolvable module, which is the registry's documented
honest answer (`unsupported: no tile template`), not a blank tile.

**Unsupported Map3D layers on Cloudflare: none.** And nothing here required a
Netlify-side change, so the Netlify behaviour is not merely "available for
rollback" — it is byte-identical and untouched: `netlify/lib/map3d-tile.mjs`,
`netlify/lib/map3d-country-modules.mjs` and all 12 `js/*-layer.js` builders are
unchanged from HEAD, and the Cloudflare copies are generated from them by
`tools/sync-cloudflare-generated.mjs` under a `--check` drift gate.

---

## 5. Environment variables and secrets

Every value is read from **`context.env`** (exposed to the shared libraries as
`process.env` by `functions/_lib/runtime-shims.js`). No credential is hardcoded
anywhere in the migration, none is committed, and none is exposed to the
frontend: `test-cloudflare-functions.mjs` §B scans every Cloudflare file for
credential-shaped literals, and every test asserts that a response body and its
headers never contain a bound value.

**No values are invented here.** Set the same values Netlify already uses
(Netlify → Site settings → Environment variables); this migration does not know
them and must not.

| Variable | Used by | Required | Type | Notes |
|---|---|---|---|---|
| `DATAFORSYNINGEN_TOKEN` | `/api/geo/dk-dhm`, `/api/geo/dk-dtk25` | **Mandatory** for those two layers | Secret | Sent as an HTTP header, never in a URL. Without it: 503 `service_unavailable`, and the variable name is not disclosed. |
| `DATAFORDELER_USERNAME` | `/api/geo/dk-orto` | **Mandatory** for that layer | Secret | Basic auth with `DATAFORDELER_PASSWORD`. |
| `DATAFORDELER_USER` | `/api/geo/dk-orto` | Optional (legacy alias) | Secret | Accepted when `DATAFORDELER_USERNAME` is absent; documented in `DATA_SOURCES.md` and `README.md`. |
| `DATAFORDELER_PASSWORD` | `/api/geo/dk-orto` | **Mandatory** for that layer | Secret | |
| `LANTMATERIET_WMS_USER` | `/api/geo/se-hojdmodell` | One of the two schemes | Secret | Basic auth with `LANTMATERIET_WMS_PASSWORD`. |
| `LANTMATERIET_WMS_PASSWORD` | `/api/geo/se-hojdmodell` | One of the two schemes | Secret | |
| `LANTMATERIET_WMS_TOKEN` | `/api/geo/se-hojdmodell` | One of the two schemes | Secret | OAuth2 Bearer; takes precedence over user/password. |
| `LANTMATERIET_WMS_URL` | `/api/geo/se-hojdmodell` | Optional | Plain | Overrides the licensed access point; defaults to `https://maps.lantmateriet.se/hojdmodell/wms/v1.1`. |
| `MML_API_KEY` | `/api/geo/finland` (only `src=mml-hillshade-open`) | Optional | Secret | Without it: 401 `mml_api_key_missing` — the **one** documented case where a variable *name* is disclosed, exactly as on Netlify. All other Finnish sources need no key. |
| `DANISH_PROXY_ALLOWED_ORIGINS` | `/api/geo/dk-dtk25`, `dk-orto`, `dk-heritage` | Optional | Plain | Exact comma-separated origin list (e.g. `https://detectlab.ro,https://detectlab.eu`). No wildcards. Unset = same-origin only. |
| `FINLAND_PROXY_ALLOWED_ORIGINS` | `/api/geo/finland` | Optional | Plain | Same format, same rule. |

Not used by any migrated Function, and therefore **not** to be created on
Cloudflare: Stripe keys (the Express backend's concern), Supabase URL/anon key
(they are public frontend config in `src/lib/supabase.js` and `index.html`),
`DETECTLAB_API_BASE`, and anything the Railway service needs.

Set them with either:

```bash
# per secret (production + preview)
npx wrangler@latest pages secret put DATAFORSYNINGEN_TOKEN --project-name=<pages-project>
```

or Dashboard → Workers & Pages → *project* → Settings → Variables and Secrets
(**Encrypt** for every value marked Secret above, plain text for the two
`*_ALLOWED_ORIGINS` lists and `LANTMATERIET_WMS_URL`). For local development use
`.dev.vars` (git-ignored) or `-b NAME=value` on the command line.

---

## 6. Routing, headers, redirects and the two domains

### 6.1 `cloudflare/_routes.json` — static assets never invoke a Function

```json
{ "version": 1,
  "include": ["/api/corona/rasters", "/api/geo/asig-heritage", "/api/geo/dk-dhm",
              "/api/geo/dk-dtk25", "/api/geo/dk-heritage", "/api/geo/dk-orto",
              "/api/geo/finland", "/api/geo/se-hojdmodell", "/api/map3d/tile"],
  "exclude": [] }
```

Nine exact paths, no wildcards, nothing else. Consequences, all asserted by
`test-cloudflare-config.mjs` and `tools/cloudflare-smoke.mjs`:

* `/`, `/index.html`, `/sw.js`, `/manifest.json`, `/css/**`, `/js/**`, `/data/**`,
  `/images/**`, `/webfonts/**`, `/rvt_service/methods.json` and every other
  published asset are served by the asset router with **zero** Function
  invocations (verified: no `X-DetectLab-Runtime` header on any of them);
* `/api/rvt/*`, `/api/search`, `/api/payments/*` and any other unmapped `/api`
  path are 404s, not Function calls;
* no catch-all can shadow an application path or a map tile.

### 6.2 `cloudflare/_headers`

`_headers` applies to **static asset responses only** — never to a response a
Pages Function produces. Function headers are set in code
(`functions/_lib/pages-adapter.js`), which is why the CDN pins are translated
there rather than here.

| Path | Headers | Why |
|---|---|---|
| `/*` | `X-Content-Type-Options: nosniff` | additive hardening; Netlify sends no equivalent |
| `/google-auth-callback.html` | `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` | byte-for-byte the `[[headers]]` block of `netlify.toml` |
| `/google-auth-callback` | the same three | both spellings are served directly as a 200 (§6.2) |
| `/sw.js` | `Cache-Control: no-cache` | an installed PWA must pick up a new service worker |
| `/manifest.json` | `Cache-Control: no-cache` | same |

**Deliberately absent:** `Content-Security-Policy` (index.html and the layer
modules carry inline scripts and styles and load tiles from dozens of
allow-listed government hosts — a CSP would break the existing frontend),
`Permissions-Policy` (the app uses geolocation), and
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` (they break the
Google sign-in popup handoff and the cross-origin tile iframes;
`PWA_GOOGLE_SIGN_IN.md` §5 says so explicitly).

**Why `/google-auth-callback.html` used to redirect — and how it is fixed.**
Cloudflare Pages' default asset setting, `html_handling: "auto-trailing-slash"`,
serves every `foo.html` at `/foo` *and* answers a request for `/foo.html` with
`308 Permanent Redirect → /foo`. That default is what redirected the OAuth
callback, and it broke two things:

1. **The callback.** `js/pwa-google-auth.js` registers
   `https://detectlab.ro/google-auth-callback.html` as the redirect URI (pinned by
   `test-pwa-google-auth.js`), so Google sends the browser to the `.html` URL with
   a one-time PKCE `code` in the query — straight into a 308. And because a
   `_headers` rule matches the URL that *produced* the response, the
   `no-store` / `no-referrer` / `noindex, nofollow` trio landed on the redirect,
   not on the document that was finally rendered.
2. **The PWA precache.** `sw.js` precaches 13 documents by their `.html` URL and
   stores a response only when `response.status === 200` (`sw.js:2414`), so every
   one of them came back as a 308 and the offline shell was never built.

`wrangler.jsonc` therefore sets **`assets.html_handling: "none"`** — serve each
HTML file at its own path and stop there. Measured with `wrangler pages dev`:

| Request | Before (`auto-trailing-slash`) | After (`none`) |
|---|---|---|
| `GET /google-auth-callback.html` | 307/308 → `/google-auth-callback` | **200**, 3651 B, all three headers |
| `GET /google-auth-callback` | 200, all three headers | **200**, 3651 B, all three headers |
| `GET /google-auth-callback.html?code=…&state=…` | 307/308, query preserved | **200**, `no-store`, code not echoed |
| `GET /index.html`, `/checkout.html`, `/tehnologie.html`, `/technology.html`, `/proces.html`, `/process.html`, `/europe-roman-atlas.html`, `…?embed=1` | 307/308 | **200**, `redirect_url` empty |
| `GET /` , `GET /checkout` (clean URL) | 200 | **200** (unchanged) |
| `GET /totally-missing-xyz` | 404 | **404** (unchanged, §6.3) |

**Both spellings stay live.** The `.html` URL is the one Google uses and the one
`history.replaceState(null, '', location.pathname)` leaves in the address bar; the
extensionless URL is what Pages was already serving, so any bookmark or in-flight
attempt that lands there keeps working. Because each now produces its own
response, the `_headers` block is repeated for both — byte-for-byte, and live
probes confirm each header is set exactly once (Cloudflare joins a header set
twice with a comma).

`sw.js` never caches the callback: `sw.js:2347` returns early for
`pathname === '/google-auth-callback.html'`, which is exactly the URL the browser
now lands on, and the callback is not in the precache list. `sw.js` and
`google-auth-callback.html` are both byte-identical to HEAD — no frontend file was
changed to achieve this, and no OAuth credential or production redirect URI was
touched.

*Regression coverage:* group 9 of `test-cloudflare-config.mjs` (static: the
registered redirect URI, the `sw.js` bypass, both `_headers` blocks,
`html_handling`) and group 2 of `tools/cloudflare-smoke.mjs` (live: both URLs,
bare and with `?code=`, plus `HEAD`, plus every precached `.html` document). A
real Google sign-in on the preview host is still a required checklist item before
any DNS move.

### 6.3 Not-found handling — `cloudflare/404.html`

Cloudflare's asset router answers an unmatched path with a real HTTP 404 **only
when a 404 asset is deployed**. Without one it serves `index.html` with status
200. Measured locally:

```
no 404.html :  GET /netlify.toml        → 200 text/html  (the 636 KB app shell)
               GET /api/does-not-exist  → 200 text/html
with 404.html: GET /netlify.toml        → 404
               GET /api/does-not-exist  → 404
```

That would have been a silent behaviour change (Netlify answers a real 404) and a
genuine hazard: the frontend distinguishes a JSON API error from an HTML
document, and `sw.js` caches same-origin 200s. So the deployment ships
`cloudflare/404.html` — 4 KB, no script, no external asset, `noindex`, a relative
link home, and **no link to the other country domain** (`DOMAIN_SETUP.md` keeps
`detectlab.ro` and `detectlab.eu` apart) — and `wrangler.jsonc` sets
`assets.not_found_handling = "404-page"`.

The file lives in `cloudflare/`, never at the repository root, because Netlify
publishes `.` and would adopt a root `404.html` as the live site's error page.
Netlify keeps its own generic 404; this is a Cloudflare-only page.

### 6.4 `www` → apex, and the two country domains

`DOMAIN_SETUP.md` requires `www.detectlab.ro → detectlab.ro` and
`www.detectlab.eu → detectlab.eu`, and the two markets must never be crossed.
Cloudflare Pages `_redirects` **cannot match a hostname** (no domain-level rules,
no query/cookie/country conditions), so `cloudflare/_redirects` contains comments
only — a rule there would silently apply to both domains, which is exactly the
cross-market redirect that is forbidden.

Instead:

1. **`functions/_middleware.js`** canonicalises the two `www` hosts with a 301 for
   every request that reaches a Function (the nine API paths), preserving path,
   query and fragment. The table has exactly two entries
   (`www.detectlab.ro → detectlab.ro`, `www.detectlab.eu → detectlab.eu`);
   `test-cloudflare-config.mjs` asserts that `from.replace(/^www\./,'') === to` for
   both, that no other target exists, that `detectlab.ro`, `detectlab.eu`,
   `*.pages.dev` and any other host fall through untouched, and that the match is
   case-insensitive. Verified live: `Host: www.detectlab.eu` on
   `/api/geo/finland?…` → `301 https://detectlab.eu/api/geo/finland?…`.
2. **A Dashboard Redirect Rule per zone** covers the static site, because
   `_routes.json` (correctly) keeps Functions off asset paths. Two rules, one in
   each zone — exact expressions in
   [`CLOUDFLARE_DASHBOARD_CHECKLIST.md`](CLOUDFLARE_DASHBOARD_CHECKLIST.md) §3:

   * zone `detectlab.ro`: `(http.host eq "www.detectlab.ro")` →
     `concat("https://detectlab.ro", http.request.uri.path)` — 301, preserve query
   * zone `detectlab.eu`: `(http.host eq "www.detectlab.eu")` →
     `concat("https://detectlab.eu", http.request.uri.path)` — 301, preserve query

   Each rule lives in its own zone and hardcodes its own apex, so no expression
   can ever send `.ro` traffic to `.eu` or vice versa. **No rule may use a
   wildcard, a `ends_with`, or a shared expression across zones.**

Until those two rules exist, a `www` request for a *static* path is served
without canonicalisation (the site still works; only the URL is not normalised).
`tools/cloudflare-smoke.mjs` reports this as an environment note rather than a
failure, and flips to a hard assertion as soon as the rules are in place.

---

## 7. Build settings and deployment

### 7.0 The Pages project slug — inferred, **not** Dashboard-confirmed

`wrangler.jsonc` sets `"name": "detectlab-4i1"`.

This sandbox had no Cloudflare credentials (`wrangler whoami` → *"You are not
authenticated"*) and no network route to `api.cloudflare.com`, so the Dashboard
could not be inspected and the slug could not be **confirmed**. It was therefore
taken from the only evidence available — the repository itself:

| Evidence | Value |
|---|---|
| `netlify/lib/map3d-country-modules.mjs:141` | `win.location = { href: 'https://detectlab-4i1.pages.dev/', … }` |
| Present at HEAD `27dd935`? | **Yes** — pre-existing, not added by this migration |
| `git grep -ho "[a-z0-9-]*\.pages\.dev" HEAD` | `detectlab-4i1.pages.dev` ×2 — the **only** `*.pages.dev` hostname in the repository |

That line is the `location` handed to the server-side sandbox in which the eight
embedded LiDAR country modules run, so they can emit absolute URLs; it names the
deployment the code already assumes. A Pages project's apex preview domain is
`<project-name>.pages.dev`, and Cloudflare suffixes the project name itself when
the plain name is taken — which is what `-4i1` is.

It replaces the placeholder `detectlab` that this file carried during the audit
phase. That placeholder had **no** evidence behind it, and a `wrangler pages
deploy` with a `name` that matches no existing project **creates a new one** — so
leaving it in place risked a second, stray project next to the real one.

**Before deploying**, open Dashboard → Workers & Pages and read the real name:

* if the project already exists, set `name` in `wrangler.jsonc` to that slug and
  update `CLOUDFLARE_DASHBOARD_CHECKLIST.md` §1.2 — do **not** create a second one;
* if none exists, `detectlab-4i1` is free to use.

Group 11 of `test-cloudflare-config.mjs` fails if `wrangler.jsonc`,
`CLOUDFLARE_MIGRATION.md` §7.0, `CLOUDFLARE_DASHBOARD_CHECKLIST.md` §1.2 and the
hostname in `netlify/lib/map3d-country-modules.mjs` disagree, so the slug cannot
drift between the four places. Nothing else depends on it:
`functions/_middleware.js` canonicalises only `www.detectlab.ro` and
`www.detectlab.eu` and passes every `*.pages.dev` preview host straight through,
and the static site root stays `cloudflare-dist` either way.

### 7.1 Cloudflare Dashboard → Workers & Pages → *project* → Settings → Build

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | `node tools/cloudflare-build.mjs` |
| Build output directory | `cloudflare-dist` |
| Root directory | `.` (the repository root) |
| Node version | `NODE_VERSION = 22` (build variable). Verified locally on Node v22.22.3; the tooling needs ≥ 18 for ESM + top-level await. |
| **HTML handling** (Settings → Builds & deployments → Assets) | **`none`** — must match `assets.html_handling` in `wrangler.jsonc`, or `/google-auth-callback.html` goes back to being a 308 (§6.2) |
| **404 handling** (same page) | **`404-page`** — must match `assets.not_found_handling`, with `cloudflare/404.html` published (§6.3) |

`wrangler.jsonc` already declares `pages_build_output_dir: "cloudflare-dist"`, so
a `wrangler pages deploy` from a checkout needs no arguments. The two asset
switches above are the Dashboard's copy of the same settings: a project driven
from the Dashboard must be checked against them, because the Dashboard UI and
`wrangler.jsonc` are two ways of configuring one project.

### 7.2 What the build command does

```
node tools/cloudflare-build.mjs
  step 1/3  node tools/sync-cloudflare-generated.mjs --check
            regenerate functions/_generated/* and fail on drift, then
            node tools/cloudflare-parity-check.mjs      (7 groups)
  step 2/3  node tools/build-corona-europe-catalog.mjs  (tolerated failure,
            exactly like netlify.toml's "|| true"); if CAST is unreachable and
            data/corona-europe-catalog.snapshot.json is committed, publish that —
            but only after tools/corona-snapshot.mjs has confirmed it parses AND
            carries blocks[]. A file that parses with 0 blocks (what a reshaped or
            empty upstream answer would produce) is refused, and the existing
            data/corona-europe-catalog.json is left byte-for-byte alone
  step 3/3  node tools/build-cloudflare-dist.mjs        → cloudflare-dist/
            (565 files, 36.50 MB: the site + _headers/_redirects/_routes.json/404.html —
            the count grows with the repository, so treat it as approximate)
```

Flags: `--skip-corona` (no CAST access needed — used for the verification run in
this sandbox), `--update-corona-snapshot` (refresh the committable fallback after
a successful live build), `--no-verify` (skip the parity gate; not recommended).

The output directory excludes `netlify/`, `backend/`, `functions/`, `cloudflare/`,
`tools/`, `supabase/`, `rvt_service/` (except `methods.json`), `scripts_conflicts/`,
`detectlab-feedback/`, `samples/`, `test*/`, `.git`, `node_modules`,
`netlify.toml`, `wrangler.jsonc`, `.gitignore`, `.dev.vars`, and any `.env`,
`.pem`, `.key`, `credentials.json`, `service-account*.json` or `.log`
(`SECRET_PATTERNS`). `tools/build-cloudflare-dist.mjs --check` fails if the
committed tree no longer produces the output directory.

### 7.3 Local test and preview commands

```bash
# 1. generate + parity + build (no network needed with --skip-corona)
node tools/cloudflare-build.mjs --skip-corona

# 2. the three offline suites
node test-cloudflare-functions.mjs     # 516 checks — the nine Functions
node test-cloudflare-config.mjs        # 362 checks — additive-ness, routing, headers, build,
                                       #              OAuth callback, CORONA snapshot, slug
node test-cloudflare-generated.mjs     # 135 checks — generator fidelity and drift guard
node tools/cloudflare-parity-check.mjs # 7 groups  — Netlify ⇄ Cloudflare behaviour

# 2b. the exhaustive Map3D sweep (189 layers × 97 tiles × modes × times × products;
#     ~26 190 URL comparisons + 189 end-to-end requests; exits 1 on any divergence.
#     --quiet prints only the four sections' conclusions.)
node tools/cloudflare-map3d-audit.mjs --quiet

# 3. the live runtime (a real workerd isolate; dummy values, no real secret)
npx wrangler@latest pages dev cloudflare-dist --port=8799 --ip=127.0.0.1 \
  -b DATAFORSYNINGEN_TOKEN=local-test-ds-token \
  -b DATAFORDELER_USERNAME=local-test-dfd-user \
  -b DATAFORDELER_PASSWORD=local-test-dfd-pass \
  -b LANTMATERIET_WMS_USER=local-test-lm-user \
  -b LANTMATERIET_WMS_PASSWORD=local-test-lm-pass \
  -b MML_API_KEY=local-test-mml-key \
  -b DANISH_PROXY_ALLOWED_ORIGINS=https://detectlab.ro,https://detectlab.eu

# 4. end-to-end against that runtime (350 checks) — or against a real preview:
node tools/cloudflare-smoke.mjs
node tools/cloudflare-smoke.mjs --url=https://<hash>.<project>.pages.dev
```

`tools/cloudflare-smoke.mjs` detects whether the runtime can reach the upstream
providers and reports unreachable-upstream outcomes as environment notes instead
of failures; validation errors, refusals and secret leaks fail everywhere. The
sandbox this migration was verified in has no egress beyond github/npm/pypi, so
all live upstream calls there returned the documented degraded responses
(labelled blank tiles, 502s) — the upstream URLs themselves are verified
byte-for-byte by the offline suites and the parity check, which record the exact
request each handler builds.

### 7.4 Deploying (not done — no production change was made)

```bash
git push                                   # Cloudflare builds from the branch, or:
npx wrangler@latest pages deploy cloudflare-dist --branch=<branch>
```

Deployment order is in the checklist: create the project, set the secrets, deploy
to a `*.pages.dev` preview, validate (§8 + checklist §6), and only then consider
attaching a custom domain. **DNS for `detectlab.ro` / `detectlab.eu` must not be
moved until the Netlify deployment has been proven replaceable**, and both hosts
should coexist while that is being decided.

---

## 8. Verification summary

| Suite | Scope | Result |
|---|---|---|
| `test-cloudflare-functions.mjs` | route resolution; GET/HEAD/OPTIONS/POST; missing and invalid parameters; the exact upstream request each handler builds (recorded `fetch`); CORS; cache headers; error handling; secret handling; binary tiles; GeoJSON; the map3d allow-list incl. 14 relay refusals; adapter and shim behaviour; **the CORONA `env.ASSETS` snapshot tier** (served, re-clipped per bbox, and refused when absent/empty/unparseable) | **516 / 516** |
| `test-cloudflare-config.mjs` | Netlify intact (git-level + `netlify.toml` content); `_routes.json`; `_headers` incl. both callback spellings; `_redirects`; the `www` middleware; `wrangler.jsonc` incl. `html_handling`/`not_found_handling`; the build pipeline and the assembled output; every local path the frontend references is published; **the OAuth callback regression group (both URLs, the `sw.js` bypass, the registered redirect URI)**; **the CORONA snapshot-safety group**; **the project-slug consistency group** | **362 / 362** |
| `test-cloudflare-generated.mjs` | generator `--check`, armed drift guard, determinism, sources untouched, no Node runtime API surviving, eight modules embedded verbatim, static registry/config imports, modules load and expose their entry points, parity | **135 / 135** |
| `tools/cloudflare-parity-check.mjs` | Netlify/Express originals vs generated copies: 189 layers, 36 tiles × 10 CRS, 54 relay hosts / 24 URLs, 68 validated requests, 2963 upstream URLs, 18 `handleTileRequest` cases, 57 Finland requests | **7 / 7 groups** |
| `tools/cloudflare-smoke.mjs` | live workerd: static serving, 404 handling, **both OAuth callback URLs as a direct 200 with all three headers (bare, `?code=&state=`, and `HEAD`) plus every precached `.html` document**, `www` canonicalisation, all nine routes, method matrix, relay refusals, module-backed layers, validation errors, secret leakage | **350 / 350** (3 environment notes: no egress, `www` static rule pending) |
| `tools/cloudflare-map3d-audit.mjs` | exhaustive Netlify ⇄ Cloudflare Map3D sweep: **189 registry layers × 97 tiles × up to 8 modes × 3 times × 3 products = 26 190 `buildUpstreamUrl` comparisons**, plus 189 end-to-end `handleTileRequest` requests, every `builder.module` traced to its `js/*-layer.js` source, every builder error and every `proxyMode` accounted for | **26 190 comparisons + 189 requests, 0 divergences** |

Nothing was deployed, so no production behaviour has been verified — that is what
the checklist is for.

---

## 9. Known limitations and differences from Netlify

1. **`www` → apex for static paths needs a Dashboard Redirect Rule** (§6.4).
   Functions only run on the nine API paths, and Pages `_redirects` cannot match
   a hostname. Until the two rules exist, a `www` request for an asset is served
   without canonicalisation.
2. **`foo.html` is no longer redirected to `/foo`** (§6.2). `assets.html_handling:
   "none"` serves each document at its own URL, which is what the OAuth callback
   and the `sw.js` precache both need. Netlify's pretty URLs keep serving the
   clean URL as well, and so does Cloudflare — the difference is only that
   Cloudflare no longer *redirects* the `.html` spelling. The callback headers are
   declared for both spellings, so the Cloudflare side is a superset of the
   Netlify guarantee (`netlify.toml` declares them for the `.html` URL only). No
   frontend file was changed.
3. **A Cloudflare-only `404.html`** (§6.3). Without it, unmatched paths would
   return the app shell with status 200. Netlify keeps its own generic 404 page,
   so the two hosts show different error pages — the only intentional cosmetic
   difference.
4. **`data/corona-europe-catalog.snapshot.json` is not committed yet** (§2.2).
   It needs one successful build on a machine that can reach CAST. Until then a
   CAST outage falls back to the runtime proxy and the frontend's built-in
   catalogue, as on Netlify today.
5. **`caches.default` is per-datacentre**, not global. The CORONA snapshot tier
   warms independently in each colo; Netlify's equivalent was per-container, so
   this is a wider cache, not a narrower one.
6. **No filesystem, no `node:vm`, no code generation from strings** (§4.3). Any
   *future* Netlify Function that reads a file at request time must be added to
   `tools/sync-cloudflare-generated.mjs` rather than copied; the generator fails
   loudly (`assertNoNodeRuntime`) if a `node:` import, a `REGISTRY_PATH`-style
   constant or an `import.meta.url` file path survives into a generated copy.
7. **`rvt_service/methods.json` is published from an otherwise-excluded
   directory** (§3). It is the RVT panel's offline fallback and a precached PWA
   URL; the Python service itself is not published. `test-cloudflare-config.mjs`
   scans every local path the frontend references and fails if any of them is
   missing from the output directory — that scan is what caught this.
8. **Root-level `test-*.js` Node scripts are published**, exactly as Netlify
   publishes them today (`publish = "."`). They are harmless — no secret, no
   browser reference — and excluding them would have been a difference for no
   gain. Everything under `test*/`, `tools/`, `netlify/`, `backend/`,
   `supabase/` and `functions/` is excluded.
9. **Free-plan fail-open/fail-closed.** Dashboard → Settings → Runtime decides
   whether an asset request that cannot be routed to a Function is served or
   failed. The nine routes are explicit, so either setting is safe; leave it at
   the account default and do not change it as part of this migration.

---

## 10. Rollback to Netlify

There is nothing to roll back **until DNS moves**: Netlify keeps building and
serving `detectlab.ro` and `detectlab.eu` from `netlify.toml` and `netlify/functions/`,
and this migration changed neither.

* **Before any DNS change** — abandon the Cloudflare project. Deleting it (or
  simply never attaching the custom domains) restores the status quo completely.
  The repository can keep the Cloudflare files; they are inert on Netlify
  (`functions/`, `cloudflare/`, `wrangler.jsonc`, `cloudflare-dist/` are all
  ignored by the Netlify build, and `netlify.toml` publishes `.`).
* **After a DNS change** — point the two apex records back at Netlify
  (`CNAME`/`A` as documented in `DOMAIN_SETUP.md`), or in Cloudflare DNS switch
  the records from the Pages target back to Netlify's. Netlify's domain
  configuration was never removed, so it resumes serving immediately. TTLs
  govern how long the switch takes; nothing in the repository needs to change.
* **Partial rollback** — the two hosts are independent per domain. `detectlab.eu`
  can go back to Netlify while `detectlab.ro` stays on Cloudflare, or either can
  stay on the `*.pages.dev` preview indefinitely.

To remove the Cloudflare deployment from the repository later, delete
`functions/`, `cloudflare/`, `wrangler.jsonc`, the five `tools/*cloudflare*.mjs`
scripts, the three `test-cloudflare-*.mjs` suites, the appended `.gitignore`
block and these two documents. No other file references them.
