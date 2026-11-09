# ARIADNE portal provider — GET, cell grid, fixed roles

Date: 2026-11-09, reworked after the operator's correction. The previous version
was built on a trimmed 2-hit sample: it assumed a POST with a JSON body and
invented hit paging. Both are wrong and are gone.

## Verified facts this code now encodes

From the operator's own browser, on their own domain:

| Fact | Where |
|---|---|
| GET `https://portal.ariadne-infrastructure.eu/api/search` with URL parameters | `ariadne.config.js` → `baseUrl`, `searchPath` |
| `forceReload=true&mapq=true&q=&bbox=<N>,<W>,<S>,<E>&loadingStatus=2&sort=distance&order=asc` | `ariadne-query.js` → `ORDER`, `buildParams` |
| bbox = top-left lat, top-left lon, bottom-right lat, bottom-right lon | `ariadne-tiles.js` → `bboxString` / `parseBbox` |
| filter fragments are appended at the end | `ariadne-query.js` (filters last) |
| a small box returns **all** hits on one page — no paging | provider: one request, no `from`/`size` |
| boxes ≥ ~50 km return `hits: []`; the data is `aggregations.geogridCentroid.grids.buckets` | `ariadne-parse.js` → `cells` |
| geohash-7 cells (~152 m), capped at exactly **5000** | `config.cellCap`, `parse.isCapped` |
| a 5000-cell answer is incomplete → split into 4 quadrants, recursively, dedupe by key | provider `search()` |
| a hit is a point only with `data.spatial[].geopoint`; a boundingbox-only record is a collection | `ariadne-parse.js` → `toRecord` |

**Filter fragments are still empty.** They are the operator's captured query
strings; the code will not guess them. While they are empty the settlement
(positive) role is blocked, exactly as decided.

## Roles are fixed, not switches

`provider.roleFor(appMode, centre)`:

| mode | centre | role |
|---|---|---|
| `settlement` | outside Romania | `positive` — and only if both filter fragments are configured |
| `hoard` | outside Romania | `comparison` — known sites only, never positive training data |
| any | inside Romania | `disabled` (`romania-excluded`, no request made) |

The Romanian outline is the same Natural Earth polygon the APM module uses; a
grid-parity test fails if the two copies ever differ.

## The two data paths

**Small box (hits).** One GET, one page. A record needs a `geopoint`; a record
with only a `boundingbox` is rejected (`collection-boundingbox-only`) and no
coordinate is derived from the box or its centroid. In the settlement role only
`ariadneSubject[].prefLabel === 'Site/monument'` survives.

**Large box (grid).** `hits` is empty, so the cells are the data. A request whose
answer contains 5000 buckets is incomplete: the box is split into four quadrants
and each is requested, up to `maxDepth` (default 3), with `maxRequests` as a hard
budget. Buckets are deduplicated by geohash key, cells whose centre falls outside
the requested disc are dropped (`scopeBoxes` additionally clips to the tile), and
each surviving cell becomes **one approximate point** (`positionKind: 'cell'`,
`cellCount` preserved) — never one point per underlying record, which we cannot
see. When the cap is still hit at `maxDepth`, `meta.incomplete` is true and
`meta.cellsCapped` says how many tiles were capped. Nothing is presented as a
complete count.

At 152 m cells, a 150 km disc is millions of cells, so a full-radius grid search
is many requests. That cost is reported (`meta.tiles`, `meta.requests`,
`meta.elapsedMs`), not hidden — and it is the reason the request has a budget.

`provider.estimate(centre, radiusKm)` states the cost before anything is sent.
It is arithmetic, and labelled as such:

| Radius | Base tiles (≤120 km) | Depth needed | Requests | Fits the default budget |
|---|---|---|---|---|
| 10 km | 1 | 1 | 4 | yes |
| 150 km | 16 | 3 | 1024 | **no** (budget 64) |

At 1500 ms per call, 1024 requests is about 26 minutes. A full 150 km grid search
is therefore not something to run per user interaction; narrowing the radius on
the client is the only honest option until the portal offers a coarser grid. The
provider reports `incomplete: true` rather than pretending a capped answer is
complete.

## Transport switch (unchanged in spirit)

```
ariadne-upstream.js   call(params, {signal}) → { status, ok, json, bytes, ms, via }
                      'browser' → GET <baseUrl><searchPath>?<params>
                      'server'  → POST {functionsUrl}/ariadne {params}
```

Calls are serialised and spaced by `minSpacingMs` (default 1500). The server
enforces its own spacing as well. Only the provider knows which mode is active,
and only to report it.

## The edge function is a closed gateway

`supabase/functions/ariadne/index.ts` + `supabase/functions/_shared/ariadne-params.js`:

1. `POST` only; the caller's JWT is verified.
2. **Premium only**, checked server-side against `profiles` (`plan = 'premium'`
   and `premium_expires_at > now()`). The browser cannot grant itself this.
3. Parameters are whitelisted (`forceReload, mapq, q, loadingStatus, sort, order,
   bbox`); anything else is rejected, not dropped.
4. The bbox must parse and its longer side must be ≤ 120 km.
5. The upstream URL is built **from the function's own environment**:
   `ARIADNE_BASE_URL` + `/api/search` + the verified parameter order + the
   function's own `ARIADNE_SITE_FILTER` / `ARIADNE_PERIOD_FILTER`. The client
   cannot supply a host, a path or a filter.
6. Shared cache (`apm_ariadne_cache`, keyed by the canonical URL, 24 h TTL).
7. Rate gate (`apm_ariadne_gate`): advisory-locked, one upstream call at a time,
   ≥1500 ms apart, 60 calls/user/hour and 300/hour deployment-wide.
8. If the gateway SQL is not applied, the function **fails closed** (503).

`backend/migrations/manual/019_apm_ariadne_gateway.sql` creates the tables and the
gate function. It is **not applied**.

## Files

```
js/apm-next/ariadne/ariadne.config.js     verified endpoint, params, roles, limits
js/apm-next/ariadne/ariadne-tiles.js      bbox string, 120 km splitting, quadrants, geohash, Romania test
js/apm-next/ariadne/ariadne-parse.js      hits (geopoint only) and cells
js/apm-next/ariadne/ariadne-query.js      the GET parameter set, filters last
js/apm-next/ariadne/ariadne-upstream.js   the one call, two modes, spacing
js/apm-next/ariadne/ariadne-provider.js   roles, grid recursion, dedupe, disc, cache
supabase/functions/_shared/ariadne-params.js  server rules (self-contained)
supabase/functions/ariadne/index.ts        the gateway
backend/migrations/manual/019_apm_ariadne_gateway.sql  cache + gate (NOT applied)
test/fixtures/ariadne/search-response.sample.json      the real, trimmed hit excerpt
test/fixtures/ariadne/search-response.grid.json        synthetic large-box grid
test-apm-ariadne.mjs                                   98 checks
```

The panel (`js/apm-next/apm-ui.js`) is untouched and a test enforces it: with the
filter fragments still uncaptured, a panel row would offer a role that cannot run.

## Tested on fixtures

`node test-apm-ariadne.mjs` — 98 checks: parameter names and order; N,W,S,E bbox;
filters appended last and never invented; request splitting under 120 km; the
arithmetic cost estimate; geohash-7
round-trip and cell centres; hits parsed only with a geopoint and the collection
envelope rejected; the 5000-cell cap producing exactly four quadrants with dedupe
and an honest `incomplete` flag; the grid as the large-box record source; the fixed
roles including Romania exclusion and the missing-filters block; the transport
switch changing only the destination; serialised spacing; and the shared server
rules (whitelist, bbox limits, filter injection, URL construction) asserted against
the same parameters the client builds.

## Not verified — needs your environment

- That the portal answers these requests from the app's origin (CORS), and from
  the edge runtime.
- The real cell counts, response sizes and latency for 50–150 km boxes, and how
  often the 5000 cap actually fires per tile.
- The filter fragment syntax: they are still unset.
- `019_apm_ariadne_gateway.sql` — never applied or executed.
- The edge function's behaviour on the real runtime (Deno): only its source
  contract is tested.
