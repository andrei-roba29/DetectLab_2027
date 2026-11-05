-- Applied to production by explicit user authorisation on 2026-11-05.
-- Supabase migration 20261105114223_apm_hoards_foundation. No source rows ingested.
-- Additive hoard schema/RPC only. Does not ALTER or write archaeological_sites_a.
-- Data ingestion and client activation have independent review/performance gates.
BEGIN;
CREATE TABLE public.archaeological_hoards (
 id uuid PRIMARY KEY,
 source text NOT NULL CHECK (source IN ('darmc','ran')),
 source_layer integer NOT NULL,
 source_id text NOT NULL,
 name text NOT NULL DEFAULT '',
 lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
 lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
 geom geometry(Point,4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon,lat),4326)) STORED,
 position_class text NOT NULL CHECK (position_class IN ('exact','approximate','unknown')),
 position_quality_raw jsonb NOT NULL DEFAULT '{}'::jsonb,
 position_accuracy_m double precision CHECK (position_accuracy_m > 0 AND position_accuracy_m < 'Infinity'::float8),
 period_group text NOT NULL DEFAULT 'unknown',
 period_groups text[] NOT NULL DEFAULT '{}',
 periods jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(periods)='array'),
 multiple_periods boolean NOT NULL DEFAULT false,
 deposit_start_year integer,
 deposit_end_year integer,
 date_basis text NOT NULL CHECK (date_basis IN ('deposit','tpq','find-year','name-keyword')),
 hoard_type text NOT NULL DEFAULT 'unknown' CHECK (hoard_type IN ('coin','non-coin','mixed','unknown')),
 metal text,
 country text,
 bucket text NOT NULL DEFAULT 'hoard-only' CHECK (bucket IN ('hoard-only','mixed','uncertain')),
 duplicate_of uuid REFERENCES public.archaeological_hoards(id) DEFERRABLE INITIALLY DEFERRED,
 raw jsonb NOT NULL DEFAULT '{}'::jsonb,
 synced_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,source_layer,source_id),
 CHECK (deposit_start_year IS NULL OR deposit_end_year IS NULL OR deposit_start_year <= deposit_end_year),
 CHECK (duplicate_of IS NULL OR duplicate_of <> id),
 -- Never persist a discovery-year range as a deposit date.
 CHECK (date_basis <> 'find-year' OR (deposit_start_year IS NULL AND deposit_end_year IS NULL))
);
CREATE INDEX archaeological_hoards_geog_gist ON public.archaeological_hoards USING gist ((geom::geography));
CREATE INDEX archaeological_hoards_period_groups ON public.archaeological_hoards USING gin(period_groups);
ALTER TABLE public.archaeological_hoards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.archaeological_hoards FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.archaeological_hoards TO service_role;

-- Shared entitlement guard; SECURITY DEFINER functions still call this on every request.
CREATE FUNCTION public.apm_hoards_require_premium() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT FROM public.profiles p WHERE p.id=auth.uid() AND p.plan='premium' AND p.premium_expires_at>now()
 ) THEN RAISE EXCEPTION 'premium_required' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.apm_hoards_require_premium() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.apm_hoards_within(
 p_lat double precision,p_lon double precision,p_radius_km double precision DEFAULT 150,
 p_filters jsonb DEFAULT '{}'::jsonb,p_mode text DEFAULT 'sites'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions,pg_temp SET statement_timeout='15s' AS $$
DECLARE center geography; radius_m double precision; result jsonb;
 lim constant integer:=5000; approx boolean; year_start integer; year_end integer; types text[]; grp text;
BEGIN
 PERFORM public.apm_hoards_require_premium();
 IF p_lat IS NULL OR p_lon IS NULL OR NOT(p_lat BETWEEN -90 AND 90) OR NOT(p_lon BETWEEN -180 AND 180)
 OR p_lat::text IN ('NaN','Infinity','-Infinity') OR p_lon::text IN ('NaN','Infinity','-Infinity')
 OR p_radius_km IS NULL OR NOT(p_radius_km>0) OR p_radius_km::text IN ('NaN','Infinity','-Infinity')
 OR p_mode IS NULL OR p_mode NOT IN ('sites','counts') OR p_filters IS NULL OR jsonb_typeof(p_filters)<>'object'
 THEN RAISE EXCEPTION 'invalid_hoard_request' USING ERRCODE='22023'; END IF;
 approx:=COALESCE((p_filters->>'include_approximate')::boolean,false);
 year_start:=(p_filters->>'deposit_start_year')::integer; year_end:=(p_filters->>'deposit_end_year')::integer;
 IF year_start IS NOT NULL AND year_end IS NOT NULL AND year_start>year_end THEN RAISE EXCEPTION 'invalid_date_range' USING ERRCODE='22023'; END IF;
 IF p_filters ? 'hoard_types' THEN
  SELECT array_agg(t) INTO types FROM jsonb_array_elements_text(p_filters->'hoard_types') t;
  IF types IS NULL OR NOT(types <@ ARRAY['coin','non-coin','mixed','unknown']) THEN RAISE EXCEPTION 'invalid_hoard_types' USING ERRCODE='22023'; END IF;
 END IF;
 grp:=NULLIF(p_filters->>'period_group','');
 center:=ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography;
 radius_m:=LEAST(150,p_radius_km)*1000;
 WITH area AS MATERIALIZED (
  SELECT * FROM public.archaeological_hoards WHERE ST_DWithin(geom::geography,center,radius_m)
 ), selected AS MATERIALIZED (
  SELECT * FROM area WHERE duplicate_of IS NULL AND bucket<>'uncertain'
  AND (position_class='exact' OR (approx AND position_class='approximate'))
  AND (types IS NULL OR hoard_type=ANY(types))
  AND (grp IS NULL OR grp=ANY(period_groups))
  AND (year_start IS NULL OR deposit_end_year>=year_start OR
       (date_basis='name-keyword' AND EXISTS(SELECT FROM jsonb_array_elements(periods) p WHERE (p->>'end')::integer>=year_start AND (year_end IS NULL OR (p->>'start')::integer<=year_end))))
  AND (year_end IS NULL OR deposit_start_year<=year_end OR
       (date_basis='name-keyword' AND EXISTS(SELECT FROM jsonb_array_elements(periods) p WHERE (p->>'start')::integer<=year_end AND (year_start IS NULL OR (p->>'end')::integer>=year_start))))
 ), limited AS (
  SELECT id,name,lat,lon,source,source_layer,position_class,position_accuracy_m,period_group,period_groups,periods,
         deposit_start_year,deposit_end_year,date_basis,hoard_type
  FROM selected ORDER BY id LIMIT lim
 ), counts AS (
  SELECT g, count(*) n FROM selected s CROSS JOIN LATERAL unnest(s.period_groups) g GROUP BY g
 )
 SELECT jsonb_build_object(
  'rows',CASE WHEN p_mode='counts' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM limited r),'[]'::jsonb) END,
  'truncated',p_mode='sites' AND (SELECT count(*)>lim FROM selected),
  'usable',(SELECT count(*) FROM selected),'total_in_area',(SELECT count(*) FROM area),
  'excluded_approximate',(SELECT count(*) FROM area WHERE position_class='approximate' AND NOT approx),
  'approximate_available',(SELECT count(*) FROM area WHERE position_class='approximate' AND duplicate_of IS NULL AND bucket<>'uncertain'),
  'excluded_unknown_position',(SELECT count(*) FROM area WHERE position_class='unknown'),
  'excluded_duplicates',(SELECT count(*) FROM area WHERE duplicate_of IS NOT NULL),
  'excluded_uncertain',(SELECT count(*) FROM area WHERE bucket='uncertain'),
  'unknown_period',(SELECT count(*) FROM selected WHERE cardinality(period_groups)=0),
  'period_counts',COALESCE((SELECT jsonb_object_agg(g,n) FROM counts),'{}'::jsonb)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apm_hoards_within(double precision,double precision,double precision,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apm_hoards_within(double precision,double precision,double precision,jsonb,text) TO authenticated;

-- Optional comparison set, not positive training data. Exact point records only;
-- no geometry conversion, no mutations, no client table access. Separate premium RPC.
CREATE FUNCTION public.apm_hoard_known_sites(p_lat double precision,p_lon double precision,p_radius_km double precision DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions,pg_temp SET statement_timeout='15s' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.apm_hoards_require_premium();
 IF p_lat IS NULL OR p_lon IS NULL OR NOT(p_lat BETWEEN -90 AND 90) OR NOT(p_lon BETWEEN -180 AND 180)
 OR p_radius_km IS NULL OR NOT(p_radius_km>0) OR p_radius_km::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'invalid_hoard_request' USING ERRCODE='22023'; END IF;
 WITH eligible AS MATERIALIZED (
  SELECT object_id, ST_Y(geom) lat, ST_X(geom) lon FROM public.archaeological_sites_a
  WHERE geom IS NOT NULL AND ST_SRID(geom)=4326 AND ST_GeometryType(geom)='ST_Point'
  AND upper(btrim(COALESCE(attributes->>'COORD','')))='DA'
  AND ST_DWithin(geom::geography,ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography,LEAST(150,p_radius_km)*1000)
  ORDER BY layer_id,object_id LIMIT 20001
 ), limited AS (SELECT * FROM eligible LIMIT 20000)
 SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM limited r),'[]'::jsonb),
 'truncated',(SELECT count(*)>20000 FROM eligible),'coverage','Romanian repertory exact points only') INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apm_hoard_known_sites(double precision,double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apm_hoard_known_sites(double precision,double precision,double precision) TO authenticated;
COMMIT;
