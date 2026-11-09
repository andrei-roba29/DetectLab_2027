-- 018 — DARMC hoard import: snapshot bookkeeping and an import audit trail.
--
-- Additive only. Nothing here is applied by this work. Apply it with the same
-- explicit authorisation used for 017, and only after the mapping review is signed off.
--
-- Why it is separate from 017: the importer can write rows without this file
-- (it uses the 23 columns 017 already defines). This migration adds the two
-- things an auditable repeated import needs:
--   * a snapshot id per row, so a later run can tell "not in today's capture"
--     from "deleted by someone";
--   * a run log, so the table's contents can be traced to a capture fingerprint.
--
-- No deletes, no updates to archaeological_sites_a, no client grants.

BEGIN;

ALTER TABLE public.archaeological_hoards
    ADD COLUMN IF NOT EXISTS snapshot_id text;
COMMENT ON COLUMN public.archaeological_hoards.snapshot_id IS
    'Capture fingerprint/snapshot label written by tools/darmc-hoards/import.mjs. NULL = unknown provenance.';

CREATE INDEX IF NOT EXISTS archaeological_hoards_snapshot ON public.archaeological_hoards (snapshot_id);

CREATE TABLE IF NOT EXISTS public.hoard_import_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    source text NOT NULL,
    capture_fingerprint text NOT NULL,
    snapshot_id text,
    row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
    mode text NOT NULL CHECK (mode IN ('dry-run','apply')),
    note text
);

COMMENT ON TABLE public.hoard_import_runs IS
    'One row per tools/darmc-hoards/import.mjs run. Counts only; no personal data.';

ALTER TABLE public.hoard_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hoard_import_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hoard_import_runs TO service_role;

-- Read-only helper for the review conversation. NOT a deletion policy:
-- it lists rows whose snapshot label is older than the latest snapshot for their
-- layer, so a human can decide whether upstream retired them.
--
--   SELECT source_layer, count(*)
--   FROM public.archaeological_hoards h
--   WHERE h.snapshot_id IS DISTINCT FROM (
--       SELECT max(r.snapshot_id) FROM public.hoard_import_runs r
--       WHERE r.mode = 'apply' AND r.snapshot_id IS NOT NULL)
--   GROUP BY source_layer ORDER BY 1;

COMMIT;
