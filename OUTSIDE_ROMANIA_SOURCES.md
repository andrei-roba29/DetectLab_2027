# Settlements outside Romania — DARE + ARIADNE, merged

Date: 2026-11-09. Requested: *"vreau si DARE si ARIADNE doar sa nu se suprapuna acelasi loc"* —
both catalogues, one point per place.

Each answer also carries the portal's own period vocabulary for the area
(`_meta.sources.ariadne.periods`, largest first) taken from the temporal facet
of the same response. It is a label list, not a filter: filtering by period
needs an operator-captured `{P}` template — see `ARIADNE_PROVIDER.md`.

## Background points outside Romania — the "needs both site and background samples" bug

The run used to fail outside Romania with

> Modelul nu a putut fi rulat: Logistic fit needs both site and background samples.

That message was the model's, not the data's. The UI handed the pipeline a
`backgroundAllowed` predicate that asks *"is this point inside Romanian
territory?"* — correct while the Romanian repertory is the site source, because
backgrounds must not be drawn from ground where sites are missing from the
dataset. Outside Romania that predicate rejects **every** candidate in the 50 km
box, so the sample set had sites and no background, and the fit threw.

The rule now:

| site source | backgrounds |
|---|---|
| Romanian repertory (`romania-repertory`) | terrain samples restricted to Romanian territory |
| DARE + ARIADNE outside Romania (`dare+ariadne`) | terrain samples from the same 50 km box, no territory predicate |
| CSV (`csv`) | terrain samples from the same 50 km box |
| hoards | per the hoard background choice |

Two things make the failure impossible to repeat silently:

- the pipeline drops the predicate itself when `_meta.region ===
  'outside-romania'`, so a caller cannot reintroduce it;
- an empty background set, or an empty class after terrain sampling, now raises
  `err.noBackground` / `err.noBackgroundSamples` — a readable, typed reason —
  instead of the internal fit message.

The report states the provenance rather than implying a national repertory:
`warn.outsideBackground` (backgrounds are terrain samples from the same box) and
`siteSource.id = 'dare+ariadne'` with the two catalogue URLs. Outside Romania the
Romanian UAT exclusion mask is unavailable, and that too is named
(`warn.exclusionUnknown` with the number of unscored cells).

## What the two sources are

| | DARE | ARIADNE |
|---|---|---|
| Endpoint | `https://imperium.ahlfeldt.se/api/geojson.php?bbox=W,S,E,N&zoom=z` | `https://portal.ariadne-infrastructure.eu/api/search?...` (GET, URL parameters) |
| Evidence for the contract | the map layer already shipped in `js/europe-roman-atlas.js` | the responses the operator verified on 2026-11-09 |
| What it returns | GeoJSON Point features with `name`, `ancient`, `numType` (category) | `hits[]` with `data.spatial[].geopoint`, `data.ariadneSubject[]` |
| Box limit | one request per training area | **hits only below ~50 km**; above that the portal answers with a density grid |
| Dates | none per feature | none per hit in the current request |
| Filtering | 20 categories; only 11/12/13/14 are settlements | `Site/monument` subject, applied by the parser |

## How they are merged

`js/apm-next/apm-site-merge.js`. Two records are the same place when:

1. they share a Pleiades id (`pleiadesId` on either side), **or**
2. they are within **400 m** and their names (including ancient names and aliases)
   reach a token similarity of **0.5**.

DARE wins the surviving record (configurable via `prefer`). The survivor keeps
`sources: ['dare','ariadne']`, every alias, and the sharper stated accuracy. A place
that only one catalogue knows is carried through unchanged.

Two guards against the obvious errors:

- **Same name, far apart is not a merge.** *Vindobona* 40 km from *Vindobona* stays two places.
- **Different names, metres apart is not a merge either** (a town and its suburb).

And within a source, repeats are removed before anything is merged, so `merged`
always means *"attested by more than one catalogue"* rather than *"the same request
came back twice"*. Overlapping ARIADNE tiles are the usual cause of that.

## ARIADNE's box limit is why the area is cut into tiles

The portal returns `hits: []` for boxes of ~50 km and up, and the training area is
100 km across. `apm-outside-sites.js` therefore cuts it into **nine tiles of ~33 km**
(each with a 6 % overlap so nothing falls between them). That is nine requests at
300 ms spacing, about three seconds, on the user's own connection.

The **density grid is used, but never disguised as a site** (changed 2026-11-09).
The portal answers a small box two ways, and which one you get is not under our
control: hits, or `hits: []` plus `aggregations.geogridCentroid.grids.buckets`.
Refusing the second answer meant ARIADNE contributed nothing at all in a large
part of Europe — and the panel said nothing about it.

What happens now, per bucket:

- one point per cell, at the cell centre, named **`ARIADNE grid cell <key>`** and
  carrying `cellKey` / `cellCount`; never one point per underlying record, which
  we cannot see;
- `positionAccuracy: 110 m` — half the diagonal of a 152 m geohash-7 cell — so the
  position quality says how approximate the point is. The record is not marked
  `approximatePosition` (that flag means "only a locality is known");
- a cell that sits within 400 m of a DARE point is dropped (`droppedNearDare`),
  because DARE already places that place precisely; DARE points are never dropped;
- the list is budgeted at **1500** points (`maxAriadnePoints`) before the O(n²)
  dedupe; anything left out is counted (`droppedOverBudget`) and said in the panel;
- a cell answers only identifier-based merging (`apm-site-merge.js`): neighbouring
  cells with the same stem must not swallow each other.

Because 110 m is above the shared 100 m ceiling, the two TRAIN filters are told
the ceiling these records were published for: `apm-ui.js` (site count) and
`apm-pipeline.js` (the positives that train the model) pass
`maxAccuracyM: outside.CONFIG.acceptAccuracyM` (**150 m**) for
`region: 'outside-romania'` records only. Inside Romania nothing changes.

**ARIADNE is always named.** The status line now reads like
`24 site(s) outside Romania (DARE 3 + ARIADNE 21 (21 grid-cell point(s)))…`, and
when the portal contributes nothing it says why instead of dropping out of the
line: `ARIADNE 0 (answered, nothing usable: 0 hit(s), 0 grid cell(s), 9
request(s) without a usable answer)`. Notes follow for capped tiles, budget cuts
and cells already covered by DARE. `attestedByBoth` counts only real
cross-catalogue overlaps, so cell-cell dedupe is not reported as "a place in both
catalogues".

## ARIADNE without the captured filter fragments

The portal's URL filters (site type, period) are still not configured — the operator
never supplied them and this work does not invent them. What is available is the
portal's own subject vocabulary, so the settlement role runs in **subject-only**
mode: `subjectOnlyPositive: true`, set by the panel, and the parser keeps only
`Site/monument`.

This is a deliberate, visible compromise, not a silent one:

- it is **off by default** in `ariadne.config.js`;
- the settlement role is still refused inside Romania, for every mode;
- the panel states that these catalogues publish no per-site dates, so the period
  picker offers only "All periods" for them.

When the fragments arrive, set `filters.siteType` / `filters.period` in the config
and the subject-only path stops being used: `filtersConfigured()` takes over and the
requests carry the real filters.

## What the panel shows

Outside Romania, TRAIN now loads a merged list and reports each source separately:

> 47 site(s) outside Romania (DARE 34 + ARIADNE 15); 2 place(s) are attested by both
> catalogues and are shown once. These catalogues publish no per-site dates.

If a source fails, its name and error are shown and the other source's record stand:

> … Unavailable: ARIADNE: ARIADNE request failed: Failed to fetch.

Below ten sites the CSV upload is offered, exactly as for hoards. Inside Romania
nothing changed: the national repertory answers, and neither catalogue is queried.

## Files

```
js/apm-next/apm-site-merge.js       the merge and its two rules
js/apm-next/apm-dare-sites.js       DARE request, categories, record shape
js/apm-next/apm-outside-sites.js    tiling, per-source reporting, composition
js/apm-next/apm-ui.js               outside Romania → merged provider; status line
js/apm-next/apm-i18n.js             train.outsideLoaded / train.outsideFailed (RO + EN)
index.html                          the new scripts
test-apm-outside-sites.js           48 checks
test-apm-train-network.js           the outside-Romania block now exercises both sources
```

## Tested on fixtures

`node test-apm-outside-sites.js` — 48 checks: the merge by identifier and by
proximity+name, the two non-merge cases, aliases, the DARE bbox/zoom/URL and
category selection, no invented dates, `filterSites` accepting the records
unchanged, the nine-tile split staying below the portal's hits threshold, cells
refused, per-source reporting, a dead source named rather than hidden, and Romania
still excluded.

`node test-apm-train-network.js` drives the real UI against a mocked network:
DARE and ARIADNE are both queried, a place present in both appears once, no
Supabase call happens outside Romania, and the existing CSV path still completes.

## Not verified — needs the live hosts

- That `imperium.ahlfeldt.se` and the portal both answer **this origin** (CORS).
  The map already calls DARE from the browser, so that one has precedent; the
  portal does not.
- Real category codes, real hit counts and real coordinate agreement between the
  two catalogues — the 400 m threshold is a considered default, not a measurement.
- Whether the portal's hits response for a 33 km box is small enough to be quick.
- What ARIADNE publishes per hit beyond title/subject/geopoint; if a period is
  present in the response it is not being read yet.
