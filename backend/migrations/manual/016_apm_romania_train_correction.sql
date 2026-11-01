-- Applied to production with user approval on 2026-11-01.
-- Supabase migration: 20261101163027_apm_romania_train_correction.
-- Kept outside automatic startup discovery to avoid duplicate deployment.
-- Read-only inspection 2026-11-01: attributes=jsonb, geom=public.geometry (mixed
-- Point/Polygon, SRID 4326). EWKB is the wire representation, not the SQL type.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='archaeological_sites_a' AND column_name='attributes' AND udt_name='jsonb')
 OR NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='archaeological_sites_a' AND column_name='geom' AND udt_name='geometry') THEN
  RAISE EXCEPTION 'Unexpected site schema; inspect before deploying';
 END IF;
END $$;

-- SECURITY: live metadata showed self-update policies AND broad profile INSERT/UPDATE
-- grants. A profile-based premium gate is bypassable without restricting those grants.
-- Preserve ordinary profile fields while reserving entitlement/payment fields to the
-- trusted backend/service_role. Revoke both table-level and legacy column-level grants.
DO $$ DECLARE c record; safe_insert text; safe_update text; BEGIN
 REVOKE INSERT, UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
 FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' LOOP
  EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON public.profiles FROM PUBLIC, anon, authenticated',c.column_name,c.column_name);
 END LOOP;
 SELECT string_agg(quote_ident(column_name),',') FILTER (WHERE column_name NOT IN ('plan','premium_expires_at','stripe_customer_id','stripe_subscription_id','stripe_subscription_status')),
        string_agg(quote_ident(column_name),',') FILTER (WHERE column_name NOT IN ('id','plan','premium_expires_at','stripe_customer_id','stripe_subscription_id','stripe_subscription_status'))
 INTO safe_insert,safe_update FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles';
 IF safe_insert IS NOT NULL THEN EXECUTE 'GRANT INSERT ('||safe_insert||') ON public.profiles TO authenticated'; END IF;
 IF safe_update IS NOT NULL THEN EXECUTE 'GRANT UPDATE ('||safe_update||') ON public.profiles TO authenticated'; END IF;
END $$;
-- Profiles created by clients must start free; trusted payment handlers set entitlements.
ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE public.profiles ALTER COLUMN premium_expires_at SET DEFAULT NULL;

-- The ordinary GiST(geom) index does not accelerate geography distances. Match the
-- ST_DWithin expression exactly; geography supplies metres across Romania. Reuse the
-- existing all-layer index (includes opt-in unknown-COORD points); no derived centroid.
CREATE INDEX IF NOT EXISTS archaeological_sites_a_geom_geog_gist
 ON public.archaeological_sites_a USING gist ((geom::geography));

DROP FUNCTION IF EXISTS public.apm_sites_within(double precision,double precision,double precision);
-- Remove unused duplicated, hard-coded period inference; browser config is authoritative.
DROP FUNCTION IF EXISTS public.apm_site_period_counts(double precision,double precision,double precision,boolean);
CREATE OR REPLACE FUNCTION public.apm_sites_within(
 p_lat double precision,p_lon double precision,p_radius_km double precision DEFAULT 50,
 p_include_empty_coord boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions,pg_temp SET statement_timeout='15s' AS $$
DECLARE result jsonb; center geography; radius_m double precision; lim constant integer:=5000;
BEGIN
 -- Same authoritative rule as _dlIsPremium(): signed-in profile, plan=premium,
 -- unexpired premium_expires_at. No JWT user_metadata or browser-local entitlement.
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT FROM public.profiles p WHERE p.id=auth.uid() AND p.plan='premium' AND p.premium_expires_at>now()
 ) THEN RAISE EXCEPTION 'premium_required' USING ERRCODE='42501'; END IF;
 IF p_lat IS NULL OR p_lon IS NULL OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lon BETWEEN -180 AND 180)
 OR p_lat::text IN ('NaN','Infinity','-Infinity') OR p_lon::text IN ('NaN','Infinity','-Infinity')
 OR COALESCE(p_radius_km,50)::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'invalid_coordinates_or_radius' USING ERRCODE='22023';
 END IF;
 center:=ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography;
 radius_m:=LEAST(50,GREATEST(0,COALESCE(p_radius_km,50)))*1000;
 WITH area AS MATERIALIZED (
  SELECT object_id,geom,attributes,
   upper(btrim(COALESCE(attributes->>'COORD',''))) flag
  FROM public.archaeological_sites_a
  WHERE geom IS NOT NULL AND ST_SRID(geom)=4326 AND ST_DWithin(geom::geography,center,radius_m)
 ), eligible AS MATERIALIZED (
  SELECT object_id, ST_Y(geom) lat, ST_X(geom) lon,
   attributes->>'NUMESIT' name, attributes->>'SIRUTA' siruta, NULLIF(flag,'') coord_flag
  FROM area WHERE ST_GeometryType(geom)='ST_Point'
   AND (flag='DA' OR (COALESCE(p_include_empty_coord,false) AND flag=''))
  ORDER BY object_id, attributes->>'NUMESIT', ST_X(geom), ST_Y(geom) LIMIT lim+1
 ), limited AS (SELECT * FROM eligible LIMIT lim)
 SELECT jsonb_build_object(
  'rows',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM limited r),'[]'::jsonb),
  'truncated',(SELECT count(*)>lim FROM eligible),
  'total_in_area',(SELECT count(*) FROM area),
  'excluded_approximate',(SELECT count(*) FROM area WHERE ST_GeometryType(geom)='ST_Point' AND flag='NU'),
  'excluded_unknown_coord',(SELECT count(*) FROM area WHERE ST_GeometryType(geom)='ST_Point' AND flag='' AND NOT COALESCE(p_include_empty_coord,false)),
  'excluded_geometry',(SELECT count(*) FROM area WHERE ST_GeometryType(geom)<>'ST_Point')
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) TO authenticated;
COMMENT ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean)
 IS 'Premium Romania TRAIN: six approved row fields, exact COORD default, max 50km/5000 points plus counts/truncation. Never returns polygon centroids.';
COMMIT;
