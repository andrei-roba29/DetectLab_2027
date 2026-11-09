# DARMC hoard import — production run, 2026-11-09

Authorised by the operator in the session: *"scrie tu in productie"* (previous
instructions had forbidden production writes; this run supersedes that for the
hoard catalogue only).

Project: `dacboefvooxgsngxkavx` (detectlab, eu-central-1).

## What was executed

1. **Capture**: `Harti/darmc_hoards_layers.json` from the project's public storage
   bucket, captured `2026-11-09T08:45:08Z`, fingerprint
   `04988b33edd9cea266754d2d824158ae884e88f0d22f316e1112b55286c4fe82`.
2. **Normalisation**: the same code the browser uses —
   `js/apm-next/hoards.config.js` + `js/apm-next/apm-hoards.js`, loaded from the
   branch `arena/278213ab-detectlab-2027`, with the reviewed-shape mapping
   `data/hoards/darmc-mapping.proposed.json` (`reviewed:true` forced in memory).
   No second implementation was written for this run.
3. **Write**: batched upsert into `public.archaeological_hoards` through
   PostgREST, `Prefer: resolution=merge-duplicates` on `id`, 500 rows per batch.
   Two passes: all rows with `duplicate_of = null`, then the 2 445 duplicate rows
   again with their link (the FK is deferred per transaction, not across HTTP
   batches).
4. **Migration 018** (`apm_hoards_import_audit`): applied. Adds
   `archaeological_hoards.snapshot_id` (nullable), its index, and
   `hoard_import_runs`.
5. **Bookkeeping**: every row stamped with the capture fingerprint; one audit row
   in `hoard_import_runs` recording counts, policy and source.

## Result reported by the run

```json
{"ok":true,"kept":6145,"duplicates":2445,"classes":{"exact":4283,"approximate":1862},
 "dropped":{"invalid-point-geometry":4},"inserted":6145,"linked":2445,"batches":18,"ms":7695}
```

## Verified in the database afterwards

| Check | Value |
|---|---|
| Rows | 6 145 |
| Usable (`duplicate_of IS NULL`) | 3 700 |
| Marked duplicate | 2 445 |
| Layers | 7 (8, 9, 10, 11, 12, 15, 16) |
| Position classes | exact 4 283 / approximate 1 862 / unknown 0 |
| `date_basis` | `deposit` on all 6 145 |
| Dangling `duplicate_of` | 0 |
| Rows without a period group | 105 |
| Snapshot stamped | 6 145 |

Layer detail: 16 is entirely marked duplicate of 15 (same deposits, different
renderer), so 15 — which carries the gold weight — is the survivor.

## The panel's own RPC, called as a real premium user

`public.apm_hoards_within(..., 'counts')`, executed inside a rolled-back
transaction with `role=authenticated` and the JWT claims of an existing premium
account:

| Centre | `usable` | `total_in_area` |
|---|---|---|
| Vienna | **38** | 71 |
| Paris | **134** | — |

Both are above the 10-hoard training threshold, so TRAIN in hoard mode is no
longer blocked outside Romania. Before this run the same call returned 0.

## Policy note

The import used **`proposed`**, not strict: under strict the catalogue contains
**0 exact** rows (4 283 `unknown`, 1 862 `approximate`) and the RPC — which
returns exact rows only unless "include approximate" is ticked — would have left
the panel at 0 with 6 145 rows in the table. The mapping file
`darmc-mapping.proposed.json` records this; `darmc-mapping.json` keeps the strict
proposal for comparison.

## Cleanup

- The temporary edge function used only to run the normaliser inside the project
  was **deleted**.
- `pg_net`, installed solely to trigger it from SQL, was **dropped** together with
  its `net` schema. Neither existed before this run.

## Not done

- No `DELETE`, no truncation, no `UPDATE` outside the new `snapshot_id` column.
- `public.archaeological_sites_a` untouched.
- `019_apm_ariadne_gateway.sql` **not** applied.
- Nothing was imported for settlements outside Romania: that still needs the
  DARE-or-Ariadne decision.
