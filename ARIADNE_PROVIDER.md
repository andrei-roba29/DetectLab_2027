# ARIADNE provider — fixtures, one switch, no live claims

Date: 2026-11-09. Nothing in this work has been run against the live ARIADNE
host. The provider is built from the real response excerpt you supplied, and
every statement below about the network is explicitly unverified.

## The response we design against

`test/fixtures/ariadne/search-response.sample.json` is your excerpt, unmodified:

```
total:  { value: 23, relation: "eq" }        ← 23 matches, 2 returned
hits:   [{ id, data: {
            ariadneSubject: [{ prefLabel }], publisher: [{ name }],
            title: { language, text },
            spatial: [{ centroid:{lon,lat}, geopoint:{lon,lat}, placeName,
                        boundingbox }],
            resourceType } }]
aggregations: { geogridCentroid.grids.buckets[], ariadneSubject.buckets[],
                temporal.temporal.buckets[] }
```

Three consequences, and they drive the design:

1. **A page is not the result.** `total.value = 23` with two hits means paging
   (`from`/`size`) is mandatory, and a 150 km search needs several tiles on top.
2. **A bounding box is not a site.** The second hit has only a `boundingbox`
   plus a published centroid, and `resourceType: "collection"`. The provider
   never derives a point from a box; it uses the published centroid and marks it
   approximate, or rejects the hit.
3. **`geogridCentroid` is a cell aggregation, not a filter we can assume.**
   Cell keys look like geohash (`u0q7058`) but the precision is not documented,
   so cells are offered as an option and the default is a bounding-box query.

## One switch, and where it lives

```
js/apm-next/ariadne/ariadne.config.js    transport: 'server' | 'browser'   ← the switch
js/apm-next/ariadne/ariadne-upstream.js  THE upstream call (both modes, ~30 lines each)
js/apm-next/ariadne/ariadne-tiles.js     box → tiles, optional geohash cover   (transport-blind)
js/apm-next/ariadne/ariadne-query.js     the request body                       (transport-blind)
js/apm-next/ariadne/ariadne-parse.js     response → records                     (transport-blind)
js/apm-next/ariadne/ariadne-provider.js  paging, dedupe, disc filter, cache, roles
supabase/functions/ariadne/index.ts      the server-side hop (holds URL + key)
```

`ariadne-upstream.js` exposes exactly one interface:

```js
call({ path, method, body }, { signal }) → { status, ok, json, bytes, ms, via }
```

- `transport: 'server'` → `POST {functionsUrl}/ariadne` with `{ path, method, body }`
  and the user's access token. No CORS requirement on the ARIADNE host.
- `transport: 'browser'` → the same body straight to `config.baseUrl`.

The switch changes the destination and nothing else. `test-apm-ariadne.mjs`
asserts that both modes send an identical body, get an identical result shape,
and that no other module references the transport at all (tiling, parsing,
query building and the panel stay untouched — a test fails if they don't).

`config.baseUrl` is **empty on purpose**. Inventing an endpoint would produce a
provider that looks finished and cannot work. Set it to a URL you have confirmed,
or leave it empty and let the server function hold it.

## Two roles, both selectable

`getSites(centre, radiusKm, { mode })`:

- `mode: 'positive'` — only hits whose `ariadneSubject` matches
  `config.positiveSubjects` (`Site/monument`) and that carry a point. These are
  the only records allowed to train the model.
- `mode: 'comparison'` — every hit with a point, for a known-site comparison set
  (the `apm_hoard_known_sites` role, not a positive source).

`getSites` returns records in the same shape as the other providers and hangs
`_meta` off the array: `requests`, `bytes`, `upstreamMs`, `tiles`, `totalInBox`,
`returned`, `truncated`, `rejected`, `subjects`, `cells`, `transport`, `cached`,
and `live: false`.

A tile that fails fails the whole search. A partial page set that looks like a
small result set would bias the model silently, so it is not allowed.

## Server function

```sh
supabase functions deploy ariadne
supabase secrets set ARIADNE_BASE_URL=https://<confirmed-host>/<search-path>
# only if the host needs a key:
supabase secrets set ARIADNE_API_KEY=…
```

- Signed-in users only (the caller's JWT is verified before anything is fetched).
- `path` must be a relative path on the configured host; absolute URLs and `..`
  are refused, so it cannot be used as an open proxy.
- 64 KB request cap, 8 MB response cap, 15 s upstream timeout.
- The upstream body is passed through verbatim; the provider parses it.
- A 502/504 from this function **is** the reachability answer: it means the
  function could not reach the host.

## What is unverified, and how to verify it

| Unverified | How to settle it |
|---|---|
| The search endpoint URL | set it in `config.baseUrl` / `ARIADNE_BASE_URL` |
| The query DSL (`geo_bounding_box`, `terms` on `geogridCentroid`, `spatial.geopoint`) | `tools/live-check/ariadne-probe.html` — edit the body until you get hits; then paste it back and only `ariadne-query.js` changes |
| Whether the browser can reach the host (CORS) | the probe's "Browser → host" row |
| Whether the edge function can reach the host | the probe's "Browser → function → host" row |
| Real paging behaviour, real response sizes, real latency at 150 km | the probe's `total.value`, bytes and ms columns |

## Wiring into the panel (deliberately not done)

`test-apm-ariadne.mjs` asserts that `js/apm-next/apm-ui.js` does not mention
ARIADNE. That is intentional for this step: with the transport and the DSL still
unverified, a panel row would offer users a switch that cannot be shown to work.
The provider already matches the `SiteProvider` interface
(`{ id, label, source, getSites }`), so registering it is a one-line change in the
provider list once the probe comes back green.

## Tested on fixtures

`node test-apm-ariadne.mjs` (78 checks): your response parsed (title, point vs
centroid, publisher, subjects, all three aggregation shapes); no coordinate
invented from a bounding box; positive vs comparison selection; 150 km box split
into an exact partition; geohash cover refused when it would need too many cells;
the query body; both transport modes proven to differ only in destination, with
typed `ariadne.http` / `ariadne.network` / `ariadne.notConfigured` failures;
paging with contiguous windows; dedupe; the disc filter; cache; a failed tile
failing the search; the edge function's static contract; the panel untouched.
