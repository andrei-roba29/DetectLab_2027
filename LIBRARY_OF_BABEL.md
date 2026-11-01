# Library of Babel — Multi-source archaeological search agent

Premium layer **Biblioteca din Babel**. The user types a **locality or site**
(ex. *Sarmizegetusa*, *Apulum*, *Grădiștea Muncelului*) and the agent queries
**8 open knowledge sources in parallel, directly from the browser**, aggregates
and de-duplicates the findings, and renders them with per-source provenance.

The previous implementation (SIRUTA register + `biblioteca-digitala.ro` crawl
through `POST /api/evidence/search`) was retired: it had a single point of
failure and a hard dependency on one source. The backend dossier pipeline
still exists as an API (see `HISTORICAL_DOSSIER.md`) but the UI no longer
calls it.

## The 8 sources

| # | Source | Endpoint | Result type | Rate limit |
| --- | --- | --- | --- | --- |
| 1 | Wikipedia (ro **and** en) | `{lang}.wikipedia.org/w/api.php` `list=search` | `article` | 200 req/s |
| 2 | Wikidata | `query.wikidata.org/sparql` (EntitySearch service) | `structured` (+ coordinates) | unlimited |
| 3 | OpenStreetMap Nominatim | `nominatim.openstreetmap.org/search` | `place` (+ ambiguity detection) | **1 req/s — enforced client-side** |
| 4 | Wikimedia Commons | `commons.wikimedia.org/w/api.php` (File: namespace) | `image` / `map` / `document` | generous |
| 5 | DBpedia Lookup | `lookup.dbpedia.org/api/search` | `structured` (semantic resource) | generous |
| 6 | Archive.org | `archive.org/advancedsearch.php` | `document` / `image` / `audio` / `video` / `collection` | 7 req/s |
| 7 | Europeana | `api.europeana.eu/record/v2/search.json` | heritage object | 10 req/s — **needs a free `wskey`** |
| 8 | CIMEC / RAN | `eism.geo-spatial.ro/.../PatrimoniuWM/MapServer/find` (JSONP) | `structured` (fișă de sit, + coordinates) | ArcGIS REST generous |


## Aggregation & de-duplication

1. Every item is normalised (`normKey`: diacritics stripped, `File:` prefix and
   extension removed, lower-cased) — so *“Ulpia Traiana Sarmizegetusa”* from
   Wikipedia, Wikidata and DBpedia becomes **one card with three source
   badges**.
2. The highest-priority type wins (`place` > `article` > `structured` >
   `document` > `map` > `image` > …); the first description, image,
   coordinates and year are kept; every contributing source stays linked.
3. Relevance score = `sources × 100 + rank bonus + image/coords bonuses` →
   multi-source findings rank first.
4. Statistics: total results, **N/8 active sources**, duplicates removed,
   duration — plus a live per-source chip row that doubles as a **source
   filter**.

## Result format (spec §FORMAT OUTPUT)

Every card carries **TITLU** (title, linked to the source page), **DESCRIERE**
(50–150 characters, HTML stripped, clamped), **TIP** (Articol Wikipedia /
Imagine / Hartă / Locație OSM / Dată SPARQL / Resursă semantică / Document
digital / Obiect de patrimoniu …) and **SURSĂ** (one badge per contributing
API, each linking to its own page). Extra metadata: year, coordinates,
licence/artist (Commons), data provider (Europeana), mediatype (Archive.org).

## Optional parameters

* **Filter by type** — article / structured data / place / document / map /
  image / collection / audio / video (only types that actually occur).
* **Filter by period** — Prehistoric, Bronze Age, Iron Age, Dacian, Roman,
  Migration, Medieval, Modern. Periods are **classified automatically** from
  keywords in the title + description (diacritic-insensitive, word-boundary
  regexes). The **Roman** period is decided by a broad lexical field of
  genuinely ancient-Roman terms (`castru`, `legiune`, `opaiț`, `burgus`,
  `villa`, `terme`, `amfiteatru`, `colonia`, `ulpia`, `traian`, `imperiul
  roman`, `dacia romana`, …) — the bare words *roman / romana / romani /
  romane / romanii / romanilor* are **not** triggers, because once diacritics
  are stripped they could also be *român / română / români / române…* (the
  Romanian language / nationality → false positives). “Romania” the country
  never triggers the *Roman* period. The classification is disclosed as
  automatic on every render.
* **Unspecified-period findings are excluded** — results the classifier cannot
  place on any period (perioada „nespecificată”) are removed from the Library
  of Babel output, so every shown finding carries at least one period label.
  Two locality-driven exceptions always stay: **OSM places** (the searched
  locality itself) and **CIMEC/RAN site records** (archaeological by
  definition — dropping them was hiding the sites around the locality).
* **Filter by source** — click a chip.
* **Export** — JSON and CSV (Excel-safe BOM, quoted fields) over the
  currently filtered rows, as `detectlab-babel-<locality>.{json,csv}`.

## Errors & edge cases (spec §ERORI)

| Case | Behaviour |
| --- | --- |
| A source does not answer | the other 7 continue; the chip names the failure class; a note lists the failed sources |
| 0 results | alternative searches suggested (diacritics-free variant, first word, `… arheologic`, `… archaeological`) |
| Ambiguous locality | **LOCAȚIE AMBIGUĂ** banner with every OSM match (name · type · county) as one-click refined searches |
| All 8 sources down | named error + retry + new-search buttons, never a hang |
| Europeana key rejected | `keyInvalid` note prompts the user to fix the stored key |

## Extensions already included

* **Epoch profile in the results header** — the header summarises the
  de-duplicated corpus of the locality as **percentages per epoch**
  (`babel-epochs`), so a place reads at a glance as Roman, medieval or
  prehistoric. The denominator is the total number of epoch attributions (a
  finding may mention several epochs — a Dacian site reoccupied in Roman times
  belongs to both), the shares use largest-remainder rounding so they always
  add up to 100 %, and each share is a button that filters the list by that
  period. Labels: `epochProfile` / `epochProfileNote` in both dictionaries.
* **Timeline strip** — periods in chronological order with counts; clicking a
  period filters the list.
* **Leaflet mini-map** — every geolocated finding (OSM + Wikidata
  coordinates) as a circle marker; skipped gracefully when Leaflet is absent.
* **localStorage caching** — results cached 30 min per `language + query`,
  disclosed with a *Reîmprospătează* (bypass) button.
* **Dark theme** — the modal is dark by design.

## Files

| Path | Role |
| --- | --- |
| `js/library-of-babel.js` | the agent: 9 source adapters, aggregation, rendering, filters, exports |
| `css/library-of-babel.css` | panel row, modal chrome, chips, epoch profile, timeline, cards, toolbar |
| `index.html` | modal shell + panel row (crown names the 8 sources) |
| `tehnologie.html` / `technology.html` | public documentation tab describing the 8 sources, the epoch profile and the other DetectLab modules (RO/EN) |
| `proces.html` / `process.html` | public documentation tab: the workflow step by step, including the Babel epoch profile step (RO/EN) |
| `test-babel-i18n.js` | ro/en dictionary parity + agent-spec contract |
| `test-babel-multisource.js` | full render with realistic fixtures for all 8 APIs: aggregation, dedup, provenance, periods, filters, exports |
| `test-babel-resilience.js` | failing sources, total outage, zero results, ambiguity, cache |
| `test-babel-periods.js` | period-classification contract: unspecified exclusion + lexicon-driven *Roman* (no *român* false positive) |
| `test-babel-osm-locality.js` | shared gazetteer matcher, canonical-name resolution |
| `test-babel-nearby-sites.js` | locality + județ header, relevance guard (Miljan-Miljanić class), nearby RAN sites with distances, exact-phrase queries |

```bash
node test-babel-i18n.js
node test-babel-multisource.js
node test-babel-resilience.js
node test-babel-periods.js
node test-babel-osm-locality.js
node test-babel-nearby-sites.js
```

## Nominatim usage policy

Nominatim allows **1 request/second**. The module enforces a ≥1.1 s spacing
between Nominatim calls (`NOMINATIM_MIN_INTERVAL`); a search makes exactly one
Nominatim request.
