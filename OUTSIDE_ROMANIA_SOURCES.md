# Settlements outside Romania — DARE + ARIADNE, merged

Date: 2026-11-09. Requested: *"vreau si DARE si ARIADNE doar sa nu se suprapuna acelasi loc"* —
both catalogues, one point per place.

Each answer also carries the portal's own period vocabulary for the area
(`_meta.sources.ariadne.periods`, largest first) taken from the temporal facet
of the same response. It is a label list, not a filter: filtering by period
needs an operator-captured `{P}` template — see `ARIADNE_PROVIDER.md`.

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

The **density grid is refused**: a 152 m cell is not a site, and
`ariadneRecord()` drops every record with `positionKind: 'cell'`.

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
