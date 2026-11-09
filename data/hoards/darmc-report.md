# DARMC hoards — proposed mapping and import counts

Generated 2026-11-09T12:15:33.914Z by `tools/darmc-hoards/import.mjs`.

- Capture source: `https://services1.arcgis.com/qN3V93cYGMKQCOxL/arcgis/rest/services/DARMC_Archaeological_Studies/FeatureServer`
- Captured at: 2026-11-09T08:45:08.313Z
- Output SR: 4326
- Content fingerprint: `04988b33edd9cea266754d2d824158ae884e88f0d22f316e1112b55286c4fe82`
- Mapping status: **PROPOSED (derived, unreviewed)**
- Position policy used for these counts: **strict**

These are counts of what *would* be written. Nothing was written. Every class below is a proposal for review.

## Totals

| Metric | Value |
|---|---|
| Layers in capture | 7 |
| Records read | 6149 |
| Rows kept | 6145 |
| Rows dropped | 4 |
| Duplicate candidates | 2427 |
| Rows usable after duplicate marking | 3718 |

## Per layer

| Layer | Name | Read | Kept | Dropped | exact | approximate | unknown | with dates | no dates | Period groups |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | `Carolingian Coin Hoards, 769-814 CE` | 21 | 21 | 0 | 0 | 1 | 20 | 21 | 0 | carolingian:21 |
| 9 | `Carolingian Coin Hoards, 815-840 CE` | 28 | 28 | 0 | 0 | 1 | 27 | 28 | 0 | carolingian:28 |
| 10 | `Carolingian Coin Hoards, 841-900 CE` | 140 | 139 | 1 | 0 | 11 | 128 | 139 | 0 | carolingian:139 |
| 11 | `Carolingian Coin Hoards, after 900 CE` | 90 | 89 | 1 | 0 | 11 | 78 | 89 | 0 | carolingian:88 |
| 12 | `Gallic Coin Hoards, 200-300 CE` | 1776 | 1776 | 0 | 0 | 1776 | 0 | 1776 | 0 | gallic:1674, late-roman:1674 |
| 15 | `Late Roman Precious Metal Deposits (Equivalent Gold Weight), 200-700 CE` | 2047 | 2046 | 1 | 0 | 31 | 2015 | 2046 | 0 | late-roman:2041, gallic:1357, carolingian:4 |
| 16 | `Late Roman Precious Metal Deposits (Deposit Date), 200-700 CE` | 2047 | 2046 | 1 | 0 | 31 | 2015 | 2046 | 0 | late-roman:2041, gallic:1357, carolingian:4 |

### Drop reasons

| Layer | Reason | Count |
|---|---|---|
| 10 | invalid-point-geometry | 1 |
| 11 | invalid-point-geometry | 1 |
| 15 | invalid-point-geometry | 1 |
| 16 | invalid-point-geometry | 1 |

## Mapping per layer

### Layer 8 — Carolingian Coin Hoards, 769-814 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `FINDSPOT` | FINDSPOT 100.0%, NAME_COUP 100.0%, BIBLIO 100.0%, DATE_COUP 100.0%, NAT 100.0% |
| Deposit start | `DATE_E` | 21 of 21 paired rows have start ≤ end |
| Deposit end | `DATE_L` |  |
| Date basis | `deposit` | ordered numeric pair, no TPQ field in the layer |
| Hoard type | `coin` | COINS carries coin counts |
| Metal | — | no metal field |
| Country | — | no country field (layer is worldwide) |
| Position fields | `CAROL_Q`, `COINS_Q`, `FINDSPOT_Q`, `VERIFIED` | 9 distinct combinations |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `FINDDATE` | 95.2% | 100.0% | discovery year — forbidden as a deposit date |
| `COINS` | 100.0% | 71.4% | count — forbidden as a deposit date |
| `CAROLEXT` | 100.0% | 76.2% | no validated start/end partner |
| `COINS_MN` | 100.0% | 95.2% | count — forbidden as a deposit date |
| `COINS_MX` | 100.0% | 95.2% | count — forbidden as a deposit date |
| `CAROL_MN` | 100.0% | 95.2% | no validated start/end partner |
| `CAROL_MX` | 100.0% | 95.2% | no validated start/end partner |
| `CAROLEX_MN` | 100.0% | 100.0% | no validated start/end partner |
| `CAROLEX_MX` | 100.0% | 100.0% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=∅ | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`>?`, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`?`, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`F` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`<`, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |

### Layer 9 — Carolingian Coin Hoards, 815-840 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `FINDSPOT` | FINDSPOT 100.0%, NAME_COUP 100.0%, BIBLIO 100.0%, DATE_COUP 100.0%, NAT 100.0% |
| Deposit start | `DATE_E` | 28 of 28 paired rows have start ≤ end |
| Deposit end | `DATE_L` |  |
| Date basis | `deposit` | ordered numeric pair, no TPQ field in the layer |
| Hoard type | `coin` | COINS carries coin counts |
| Metal | — | no metal field |
| Country | — | no country field (layer is worldwide) |
| Position fields | `CAROL_Q`, `COINS_Q`, `FINDSPOT_Q`, `VERIFIED` | 7 distinct combinations |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `FINDDATE` | 92.9% | 100.0% | discovery year — forbidden as a deposit date |
| `COINS` | 100.0% | 71.4% | count — forbidden as a deposit date |
| `CAROLEXT` | 100.0% | 60.7% | no validated start/end partner |
| `COINS_MN` | 96.4% | 100.0% | count — forbidden as a deposit date |
| `COINS_MX` | 96.4% | 100.0% | count — forbidden as a deposit date |
| `CAROL_MN` | 100.0% | 100.0% | no validated start/end partner |
| `CAROL_MX` | 96.4% | 100.0% | no validated start/end partner |
| `CAROLEX_MN` | 100.0% | 100.0% | no validated start/end partner |
| `CAROLEX_MX` | 100.0% | 100.0% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 14 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=∅ | 9 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`?`, COINS_Q=`X`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, COINS_Q=`c`, FINDSPOT_Q=`?`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`?`, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |

### Layer 10 — Carolingian Coin Hoards, 841-900 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `FINDSPOT` | FINDSPOT 100.0%, NAME_COUP 100.0%, BIBLIO 100.0%, CAROLEXT 100.0%, DATE_COUP 100.0% |
| Deposit start | `DATE_E` | 140 of 140 paired rows have start ≤ end |
| Deposit end | `DATE_L` |  |
| Date basis | `deposit` | ordered numeric pair, no TPQ field in the layer |
| Hoard type | `coin` | COINS carries coin counts |
| Metal | — | no metal field |
| Country | — | no country field (layer is worldwide) |
| Position fields | `CAROL_Q`, `CAROLEX_Q`, `COINS_Q`, `FINDSPOT_Q`, `VERIFIED` | 31 distinct combinations |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `FINDDATE` | 99.3% | 100.0% | discovery year — forbidden as a deposit date |
| `COINS` | 100.0% | 57.1% | count — forbidden as a deposit date |
| `COINS_MN` | 94.3% | 97.7% | count — forbidden as a deposit date |
| `COINS_MX` | 88.6% | 97.6% | count — forbidden as a deposit date |
| `CAROL_MN` | 97.1% | 97.8% | no validated start/end partner |
| `CAROL_MX` | 96.4% | 97.8% | no validated start/end partner |
| `CAROLEX_MN` | 97.1% | 97.8% | no validated start/end partner |
| `CAROLEX_MX` | 97.1% | 97.8% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 50 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=∅ | 28 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`X` | 11 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=`X` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=`C`, VERIFIED=`X` | 4 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=`?`, VERIFIED=`X` | 3 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`c`, CAROLEX_Q=`c`, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`F` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=∅ | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`"many"`, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`n`, CAROLEX_Q=`n`, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>`, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=`c`, COINS_Q=∅, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=`Ca.`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`x`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`n`, CAROLEX_Q=`n`, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`X`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`n`, CAROLEX_Q=`n`, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=`c`, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>`, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>`, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`"many"`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=`Ca.`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |

### Layer 11 — Carolingian Coin Hoards, after 900 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `FINDSPOT` | FINDSPOT 100.0%, NAME_COUP 100.0%, BIBLIO 100.0%, DATE_COUP 100.0%, NAT 100.0% |
| Deposit start | `DATE_E` | 90 of 90 paired rows have start ≤ end |
| Deposit end | `DATE_L` |  |
| Date basis | `deposit` | ordered numeric pair, no TPQ field in the layer |
| Hoard type | `coin` | COINS carries coin counts |
| Metal | — | no metal field |
| Country | — | no country field (layer is worldwide) |
| Position fields | `CAROL_Q`, `CAROLEX_Q`, `COINS_Q`, `FINDSPOT_Q`, `VERIFIED` | 31 distinct combinations |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `FINDDATE` | 98.9% | 100.0% | discovery year — forbidden as a deposit date |
| `COINS` | 100.0% | 63.3% | count — forbidden as a deposit date |
| `CAROLEXT` | 100.0% | 60.0% | no validated start/end partner |
| `COINS_MN` | 94.4% | 96.5% | count — forbidden as a deposit date |
| `COINS_MX` | 93.3% | 96.4% | count — forbidden as a deposit date |
| `CAROL_MN` | 95.6% | 98.8% | no validated start/end partner |
| `CAROL_MX` | 94.4% | 98.8% | no validated start/end partner |
| `CAROLEX_MN` | 93.3% | 98.8% | no validated start/end partner |
| `CAROLEX_MX` | 93.3% | 98.8% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 40 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=∅ | 11 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=`C`, VERIFIED=`X` | 4 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=`X` | 3 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=`c`, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`?`, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=`?`, VERIFIED=`X` | 2 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`"several hundred"`, CAROLEX_Q=`"several hundred"`, COINS_Q=`"several hundred"`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`n`, CAROLEX_Q=`n`, COINS_Q=`"many"`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=`c`, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`c`, CAROLEX_Q=`?`, COINS_Q=`c`, FINDSPOT_Q=`?`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`>`, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=`F` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`?`, CAROLEX_Q=`?`, COINS_Q=`?`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`"several hundred"`, CAROLEX_Q=`"several hundred"`, COINS_Q=`"several hundred"`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`F` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=`Ca.`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`F` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=`?`, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>?`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=∅, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=`>?`, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`c`, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=`X` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`?`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=`c`, CAROLEX_Q=`c`, COINS_Q=`?`, FINDSPOT_Q=`C`, VERIFIED=`X` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`>`, FINDSPOT_Q=∅, VERIFIED=`F` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| CAROL_Q=∅, CAROLEX_Q=∅, COINS_Q=`c`, FINDSPOT_Q=∅, VERIFIED=∅ | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |

### Layer 12 — Gallic Coin Hoards, 200-300 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `Name` | Name 99.7%, weight_kg 100.0%, Find_year 99.8%, non_coin 99.8%, metal 99.8% |
| Deposit start | `start_date` | 1776 of 1776 paired rows have start ≤ end |
| Deposit end | `end_date` |  |
| Date basis | `deposit` | ordered numeric pair, no TPQ field in the layer |
| Hoard type | `coin` | non_coin: 1636 "none" vs 140 other |
| Metal | `metal` | field present in the capture |
| Country | — | no country field (layer is worldwide) |
| Position fields | **none** | no position-quality field; every row is unknown under the strict policy |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `hoardsize` | 100.0% | 87.3% | count — forbidden as a deposit date |
| `preserved` | 100.0% | 96.6% | count — forbidden as a deposit date |

> no position-quality field: every row is classified approximate by an explicit layer-level default, not by evidence

### Layer 15 — Late Roman Precious Metal Deposits (Equivalent Gold Weight), 200-700 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `KNOWN` | KNOWN 100.0%, PLACE 99.6%, AR_C_WT_MN 100.0%, AR_C_WT_MX 100.0%, DATE_LP 100.0% |
| Deposit start | `HOB_PD_ST` | 2047 of 2047 paired rows have start ≤ end |
| Deposit end | `HOB_PD_EN` |  |
| Date basis | `deposit` | ordered numeric pair; the layer's TPQ field `D_TPQ` was not chosen — decision required |
| Hoard type | `mixed` | layer name "Late Roman Precious Metal Deposits (Equivalent Gold Weight), 200-700 CE" describes precious-metal deposits; not coin-only — **needs review** |
| Metal | — | no metal field |
| Country | `COUNTRY` | field present in the capture |
| Position fields | `AR_CN_Q`, `AR_COINS_Q`, `AV_CN_WT_Q`, `AV_COINS_Q`, `EGW_Q`, `NON_CN_Q`, `Q_LAT_LON`, `CENTROID` | 42 distinct combinations |

Other validated date pairs (not chosen):

| Start | End | Paired rows | Ordered |
|---|---|---|---|
| `START_D` | `END_D` | 2047 | 2047/2047 |
| `AV_C_MIN` | `AV_C_MAX` | 1590 | 1590/1590 |
| `HOB_PD_ST` | `END_D` | 2047 | 2047/2047 |
| `START_D` | `HOB_PD_EN` | 2047 | 2047/2047 |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `YEAR_DISC` | 67.2% | 79.9% | discovery year — forbidden as a deposit date |
| `HOBBS_NO` | 0.8% | 100.0% | identifier, not a year |
| `AV_COINS` | 24.8% | 63.2% | no validated start/end partner |
| `AV_C_MIN` | 100.0% | 77.5% | no validated start/end partner |
| `AV_C_MAX` | 100.0% | 77.2% | no validated start/end partner |
| `AE_COINS` | 10.7% | 67.3% | no validated start/end partner |
| `NON_CN_MN` | 100.0% | 93.1% | no validated start/end partner |
| `NON_CN_MX` | 100.0% | 93.1% | no validated start/end partner |
| `START_D` | 100.0% | 100.0% | no validated start/end partner |
| `D_TPQ` | 100.0% | 100.0% | no validated start/end partner |
| `END_D` | 100.0% | 100.0% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 892 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 623 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 186 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 78 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 65 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 41 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 39 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 16 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 9 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 7 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 7 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 6 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 6 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 5 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 5 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`   +`, Q_LAT_LON=` `, CENTROID=` ` | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 3 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 3 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 3 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 2 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` +`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=`c`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=`c`, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=`?`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`<`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=`?`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`+`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |

> hoard_type mixed proposed from field semantics
> rows with empty deposit dates fall back to D_TPQ and are labelled tpq (lower bound, not an interval)

### Layer 16 — Late Roman Precious Metal Deposits (Deposit Date), 200-700 CE

| Item | Derived | Evidence |
|---|---|---|
| Identifier | `OBJECTID` | service object id, unique and complete |
| Name | `KNOWN` | KNOWN 100.0%, PLACE 99.6%, AR_C_WT_MN 100.0%, AR_C_WT_MX 100.0%, DATE_LP 100.0% |
| Deposit start | `HOB_PD_ST` | 2047 of 2047 paired rows have start ≤ end |
| Deposit end | `HOB_PD_EN` |  |
| Date basis | `deposit` | ordered numeric pair; the layer's TPQ field `D_TPQ` was not chosen — decision required |
| Hoard type | `mixed` | layer name "Late Roman Precious Metal Deposits (Deposit Date), 200-700 CE" describes precious-metal deposits; not coin-only — **needs review** |
| Metal | — | no metal field |
| Country | `COUNTRY` | field present in the capture |
| Position fields | `AR_CN_Q`, `AR_COINS_Q`, `AV_CN_WT_Q`, `AV_COINS_Q`, `EGW_Q`, `NON_CN_Q`, `Q_LAT_LON`, `CENTROID` | 42 distinct combinations |

Other validated date pairs (not chosen):

| Start | End | Paired rows | Ordered |
|---|---|---|---|
| `START_D` | `END_D` | 2047 | 2047/2047 |
| `AV_C_MIN` | `AV_C_MAX` | 1590 | 1590/1590 |
| `HOB_PD_ST` | `END_D` | 2047 | 2047/2047 |
| `START_D` | `HOB_PD_EN` | 2047 | 2047/2047 |

Year-like fields deliberately not used as deposit dates:

| Field | Coverage | Year-like | Why |
|---|---|---|---|
| `YEAR_DISC` | 67.2% | 79.9% | discovery year — forbidden as a deposit date |
| `HOBBS_NO` | 0.8% | 100.0% | identifier, not a year |
| `AV_COINS` | 24.8% | 63.2% | no validated start/end partner |
| `AV_C_MIN` | 100.0% | 77.5% | no validated start/end partner |
| `AV_C_MAX` | 100.0% | 77.2% | no validated start/end partner |
| `AE_COINS` | 10.7% | 67.3% | no validated start/end partner |
| `NON_CN_MN` | 100.0% | 93.1% | no validated start/end partner |
| `NON_CN_MX` | 100.0% | 93.1% | no validated start/end partner |
| `START_D` | 100.0% | 100.0% | no validated start/end partner |
| `D_TPQ` | 100.0% | 100.0% | no validated start/end partner |
| `END_D` | 100.0% | 100.0% | no validated start/end partner |

Position classes:

| Observed values | Rows | Proposed | Strict | Rationale |
|---|---|---|---|---|
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 892 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 623 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 186 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 78 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 65 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 41 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 39 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 16 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 10 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 9 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 7 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 7 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 6 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 6 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 5 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 5 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`   +`, Q_LAT_LON=` `, CENTROID=` ` | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 4 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 3 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 3 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 3 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 2 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` +`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=`c`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 2 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=`c`, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`  +`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=`?`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=` `, Q_LAT_LON=`C`, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`<`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=`?`, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`  +`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=` `, Q_LAT_LON=` `, CENTROID=`T` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=`c`, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`c`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=` `, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=` `, NON_CN_Q=`+`, Q_LAT_LON=` `, CENTROID=` ` | 1 | `exact` | `unknown` | no published field characterises the position; proposed class assumes published coordinates, strict class refuses |
| AR_CN_Q=`c`, AR_COINS_Q=` `, AV_CN_WT_Q=` `, AV_COINS_Q=` `, EGW_Q=`c`, NON_CN_Q=`'+`, Q_LAT_LON=`C`, CENTROID=` ` | 1 | `approximate` | `approximate` | at least one published quality field marks the position as approximate |

> hoard_type mixed proposed from field semantics
> rows with empty deposit dates fall back to D_TPQ and are labelled tpq (lower bound, not an interval)

## Duplicate rules

| Metric | Value |
|---|---|
| Same-name pairs total | 3797 |
| Different layers | 2857 |
| Identical coordinates within a layer | 469 group(s), 1232 record(s) |
| Identical coordinates across layers | 1872 group(s), 4116 record(s) |
| Pairs at 0 m | 2998 |
| Pairs ≤ 100 m | 3205 |
| Pairs ≤ 1 km | 3709 |
| Pairs ≤ 5 km | 3736 |
| Distance percentiles p50 / p90 / p95 / p99 | 0 / 218 / 437 / 140805 m |
| Proposed distance | 5000 m |
| Proposed name similarity | 0.95 |
| Basis | p99 of same-name pair distances ×1.2, rounded to 50 m, clamped to 250–5000 m |

Cross-layer coordinate matches (first 10):

| Point | Layers | Records |
|---|---|---|
| 51.97286,5.34525 | 8 + 9 | 4 |
| 46.77451,9.20463 | 11 + 8 | 2 |
| 52.19670,4.42441 | 11 + 8 | 2 |
| 47.47070,-0.55324 | 10 + 9 | 2 |
| 46.22172,-0.14335 | 10 + 11 + 9 | 3 |
| 46.85083,4.77305 | 10 + 9 | 2 |
| 48.21131,4.12459 | 11 + 9 | 2 |
| 47.26141,0.69313 | 10 + 11 | 2 |
| 49.41762,2.82513 | 10 + 11 | 2 |
| 47.85816,5.33113 | 10 + 11 | 2 |

| Layer pair | Same-name pairs ≤ 5 km |
|---|---|
| 8<->9 | 3 |
| 15<->16 | 2048 |
| 8<->11 | 2 |
| 9<->10 | 2 |
| 9<->11 | 2 |
| 10<->11 | 3 |
| 12<->15 | 344 |
| 12<->16 | 344 |
| 10<->12 | 37 |
| 10<->15 | 10 |
| 10<->16 | 10 |
| 11<->15 | 6 |
| 11<->16 | 6 |
| 11<->12 | 26 |
| 8<->12 | 2 |
| 8<->15 | 2 |
| 8<->16 | 2 |
| 9<->15 | 2 |
| 9<->16 | 2 |
| 9<->12 | 4 |

Same-name pairs closest first (up to 15 of 3736 within 5 km):

| A | B | Distance (m) | Name similarity | Name |
|---|---|---|---|---|
| 8/1 | 9/24 | 0 | 1 | `wijk bij duurstede` |
| 8/1 | 9/33 | 0 | 1 | `wijk bij duurstede` |
| 8/1 | 9/42 | 0 | 1 | `wijk bij duurstede` |
| 9/24 | 9/33 | 0 | 1 | `wijk bij duurstede` |
| 9/24 | 9/42 | 0 | 1 | `wijk bij duurstede` |
| 9/33 | 9/42 | 0 | 1 | `wijk bij duurstede` |
| 15/1119 | 16/1119 | 0 | 1 | `chezy sur marne` |
| 15/578 | 16/578 | 0 | 1 | `bondeno` |
| 8/17 | 11/215 | 0 | 1 | `ilanz` |
| 8/21 | 11/226 | 0 | 1 | `katwijk` |
| 9/23 | 10/91 | 0 | 1 | `angers` |
| 12/153 | 12/154 | 0 | 1 | `angers` |
| 9/34 | 10/69 | 0 | 1 | `melle` |
| 9/34 | 11/126 | 0 | 1 | `melle` |
| 10/69 | 11/126 | 0 | 1 | `melle` |

## Decisions required before `--apply`

- Layer 15: `hoard_type` = `mixed` is proposed from the layer description, not from a field.
- Layer 16: `hoard_type` = `mixed` is proposed from the layer description, not from a field.
- Duplicate threshold 5000 m / 0.95 similarity — accept or change.
- Position policy: `proposed` treats "no field says otherwise" as exact; `strict` treats it as unknown. Only one of them can be active.
- Nothing is deleted on import: records that disappear upstream stay in the table (snapshot retirement policy still pending).

## Not verified

- This report was produced offline from your capture; it makes no network calls and touches no database.
- Row counts are capture counts. They are not a live service count unless the capture is complete for every layer.
- Quality-code meanings are inferred from the values and marked per combination; DARMC publishes no codebook in the capture.
- Licence/attribution for reusing DARMC data is still an open question and is not asserted anywhere in these files.
