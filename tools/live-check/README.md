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

## ARIADNE

Not maintained here. The operator runs their own verified probe pages for the
portal; the removed page in this folder had been built on a wrong assumption
about the request (POST with a body) and had no value once the real request was
known. `ARIADNE_PROVIDER.md` lists exactly what still needs measuring.

## Reporting

Both pages write a JSON object. The fields that matter when you paste it back:

| Field | Meaning |
|---|---|
| `layers[n].serviceCount` | what the service says it has in total |
| `layers[n].features` | what actually came back for the envelope |
| `layers[n].bytes` / `queryMs` | real response size and latency |
| `layers[n].truncated` | the source said there is more than it returned |
| `calculated.*` | arithmetic only — never a measurement |

Nothing in these pages proves the live behaviour on its own; they are the
measurement, and the report is only as good as the box you ran it from.
