-- 019 — ARIADNE proxy gateway: shared cache, polite spacing, per-user and global limits.
--
-- Additive only. NOT applied by this work. The edge function refuses to serve
-- until this file is applied (fail closed), because without the gate it would be
-- an unthrottled proxy.
--
-- Nothing here is reachable from the browser: every object is service_role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.apm_ariadne_cache (
    query_key text PRIMARY KEY,              -- the canonical upstream URL
    payload jsonb NOT NULL,                  -- the upstream response, verbatim
    cells integer,                           -- geogrid bucket count, for diagnostics
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS apm_ariadne_cache_expiry ON public.apm_ariadne_cache (expires_at);

CREATE TABLE IF NOT EXISTS public.apm_ariadne_throttle (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    last_call_at timestamptz,
    window_start timestamptz,
    calls integer NOT NULL DEFAULT 0         -- global calls in the current window
);
INSERT INTO public.apm_ariadne_throttle (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.apm_ariadne_usage (
    user_id uuid NOT NULL,
    window_start timestamptz NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_start)
);

ALTER TABLE public.apm_ariadne_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apm_ariadne_throttle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apm_ariadne_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apm_ariadne_cache, public.apm_ariadne_throttle, public.apm_ariadne_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.apm_ariadne_cache, public.apm_ariadne_throttle, public.apm_ariadne_usage TO service_role;

-- One atomic decision: may this user make one upstream call right now?
-- Serialised by an advisory lock, so concurrent requests cannot both pass a
-- 1500 ms spacing check and hit the portal together.
CREATE OR REPLACE FUNCTION public.apm_ariadne_gate(
    p_user uuid,
    p_min_spacing_ms integer DEFAULT 1500,
    p_user_limit integer DEFAULT 60,
    p_global_limit integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_last timestamptz;
    v_wait numeric;
    v_window timestamptz;
    v_calls integer;
    v_global integer;
BEGIN
    IF p_user IS NULL THEN RAISE EXCEPTION 'apm_ariadne_gate: user required' USING ERRCODE = '22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('apm_ariadne_gate'));

    SELECT last_call_at INTO v_last FROM public.apm_ariadne_throttle WHERE id;
    IF v_last IS NOT NULL THEN
        v_wait := GREATEST(0, p_min_spacing_ms - EXTRACT(epoch FROM (now() - v_last)) * 1000);
        IF v_wait > 0 THEN
            RETURN jsonb_build_object('allowed', false, 'reason', 'spacing', 'retry_after_ms', CEIL(v_wait));
        END IF;
    END IF;

    v_window := date_trunc('hour', now());
    INSERT INTO public.apm_ariadne_usage (user_id, window_start, calls)
        VALUES (p_user, v_window, 1)
        ON CONFLICT (user_id, window_start)
        DO UPDATE SET calls = public.apm_ariadne_usage.calls + 1
        RETURNING calls INTO v_calls;
    IF v_calls > p_user_limit THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'user_limit',
            'retry_after_ms', CEIL(EXTRACT(epoch FROM (v_window + interval '1 hour' - now())) * 1000));
    END IF;

    UPDATE public.apm_ariadne_throttle
       SET calls = CASE WHEN window_start = v_window THEN calls + 1 ELSE 1 END,
           window_start = v_window,
           last_call_at = now()
     WHERE id
     RETURNING calls INTO v_global;
    IF v_global > p_global_limit THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'global_limit', 'retry_after_ms', 60000);
    END IF;

    DELETE FROM public.apm_ariadne_cache WHERE expires_at < now();
    RETURN jsonb_build_object('allowed', true);
END $$;

REVOKE ALL ON FUNCTION public.apm_ariadne_gate(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apm_ariadne_gate(uuid, integer, integer, integer) TO service_role;

COMMENT ON TABLE public.apm_ariadne_cache IS
    'Shared ARIADNE response cache keyed by the canonical upstream URL. Written and read only by the ariadne edge function (service_role).';

COMMIT;
