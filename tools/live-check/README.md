# Live checks you run, reports you paste back

These tools exist because the build environment cannot reach DARMC, ARIADNE or
Supabase storage. They are static pages: no build step, no dependencies, no
write access to anything. Each one produces a JSON report.

## `hoards-150km.html`

Measures, for a 150 km box around a centre:

- the service count per DARMC layer (`returnCountOnly`),
- the features actually returned for the envelope, the response size in bytes
  and the request time,
- whether `exceededTransferLimit` fired,
- and (clearly labelled *calculated*) the DEM tile arithmetic at 25 m / 1000 px
  and the proposed 150 m grid size.

Open it from the deployed site's origin (recommended, so CORS reflects the same
origin the app uses) or directly from disk. Press **Run live check**, then
**Copy report**.

What it cannot tell you: tile counts that depend on the provider's pyramid and
cache state, or timings on a real phone.

## `ariadne-probe.html`

Answers the two questions the code cannot:

1. **Browser → ARIADNE host.** A `no answer` result is a CORS or reachability
   failure; a browser cannot tell them apart, and the report says so instead of
   guessing.
2. **Browser → Supabase function → ARIADNE host.** A 502/504 here means the
   function itself could not reach the host.

It also reports `total.value`, the number of hits on the page, bytes and latency
for each path, plus the tile plan for the requested disc and the exact query body
that was sent.

The query body is prefilled from `js/apm-next/ariadne/ariadne-query.js`, which is
**unverified**. If you get a 4xx, edit the body in the textarea until it returns
hits, then paste the working body back — only that one file needs to change.

Fill in the search URL, the functions base, the public anon key, and optionally a
signed-in user's access token. The token is used only for that request and is
never stored.

## Reporting

Both pages write a JSON object. The fields that matter when you paste it back:

| Field | Meaning |
|---|---|
| `direct.outcome` | `answered` / `no answer (CORS or unreachable)` / `HTTP nnn` |
| `viaFunction.outcome` | the same, for the server-side hop |
| `total` / `hits` | what the host says it has, versus what one page returned |
| `bytes` / `ms` | real response size and latency |
| `truncated` | the source said there is more than it returned |
| `calculated.*` | arithmetic only — never a measurement |

Nothing in these pages proves the live behaviour on its own; they are the
measurement, and the report is only as good as the box you ran it from.
