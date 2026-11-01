-- Romania TRAIN source. PRE-DEPLOYMENT CHECK REQUIRED: migration 001 in this repo declares
-- attributes JSONB and geom PostGIS geometry, as confirmed against the deployed project before application.
-- This migration still fails rather than coercing an unexpected schema.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='archaeological_sites_a' AND column_name='geom' AND udt_name='geometry') THEN
    RAISE EXCEPTION 'archaeological_sites_a.geom is not PostGIS geometry; inspect deployed schema before applying APM migration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='archaeological_sites_a' AND column_name='attributes' AND udt_name='jsonb') THEN
    RAISE EXCEPTION 'archaeological_sites_a.attributes is not JSONB; inspect deployed schema before applying APM migration';
  END IF;
END $$;

-- ST_DWithin(geom::geography, ...) can use this matching expression GiST index and gives
-- metric distances over WGS84 without latitude-dependent degree thresholds.
CREATE INDEX IF NOT EXISTS archaeological_sites_a_geom_geog_gist
  ON public.archaeological_sites_a USING GIST ((geom::geography));
-- Restrict the hot APM path to the live point layer (confirmed layer_id=0).
CREATE INDEX IF NOT EXISTS archaeological_sites_a_ran_points_geog_gist
  ON public.archaeological_sites_a USING GIST ((geom::geography)) WHERE layer_id=0;

-- Replace the earlier 3-argument function (which used a session GUC for empty COORD).
DROP FUNCTION IF EXISTS public.apm_sites_within(double precision,double precision,double precision);

CREATE OR REPLACE FUNCTION public.apm_sites_within(p_lat double precision,p_lon double precision,p_radius_km double precision DEFAULT 50,p_include_empty_coord boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE lim constant integer:=5000; n integer; payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.plan='premium' AND p.premium_expires_at>now()) THEN
   RAISE EXCEPTION 'premium_required' USING ERRCODE='42501';
 END IF;
 IF p_lat IS NULL OR p_lon IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lon NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid_coordinates'; END IF;
 WITH q AS MATERIALIZED (
  SELECT object_id, ST_Y(geom::geometry) lat, ST_X(geom::geometry) lon,
   attributes->>'NUMESIT' name, attributes->>'SIRUTA' siruta, attributes->>'COORD' coord_flag
  FROM public.archaeological_sites_a
  WHERE layer_id=0 AND (attributes->>'COORD'='DA' OR (p_include_empty_coord AND NULLIF(btrim(attributes->>'COORD'),'') IS NULL))
   AND ST_DWithin(geom::geography,ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography,LEAST(GREATEST(COALESCE(p_radius_km,50),0),50)*1000)
  ORDER BY object_id LIMIT lim+1
 ) SELECT count(*) INTO n FROM q;
 WITH q AS MATERIALIZED (
  SELECT object_id, ST_Y(geom::geometry) lat, ST_X(geom::geometry) lon, attributes->>'NUMESIT' name, attributes->>'SIRUTA' siruta, attributes->>'COORD' coord_flag
  FROM public.archaeological_sites_a WHERE layer_id=0 AND (attributes->>'COORD'='DA' OR (p_include_empty_coord AND NULLIF(btrim(attributes->>'COORD'),'') IS NULL))
   AND ST_DWithin(geom::geography,ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography,LEAST(GREATEST(COALESCE(p_radius_km,50),0),50)*1000) ORDER BY object_id LIMIT lim
 ) SELECT jsonb_build_object('rows',COALESCE(jsonb_agg(jsonb_build_object('object_id',object_id,'lat',lat,'lon',lon,'name',name,'siruta',siruta,'coord_flag',coord_flag)),'[]'::jsonb),'truncated',n>lim) INTO payload FROM q;
 RETURN payload;
END $$;
REVOKE ALL ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) TO authenticated;
COMMENT ON FUNCTION public.apm_sites_within IS 'Premium-only, exact COORD=DA Romania sites. Hard cap 5000; returns only approved fields.';

-- Counts for period picker use the same exact-position/radius scope. Classifications intentionally
-- mirror the editable browser config and must be kept in sync when that config is reviewed/changed.
CREATE OR REPLACE FUNCTION public.apm_site_period_counts(p_lat double precision,p_lon double precision,p_radius_km double precision DEFAULT 50,p_include_empty_coord boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE out jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.plan='premium' AND p.premium_expires_at>now()) THEN RAISE EXCEPTION 'premium_required' USING ERRCODE='42501'; END IF;
 WITH data AS (SELECT lower(attributes->>'NUMESIT') n FROM public.archaeological_sites_a WHERE layer_id=0 AND (attributes->>'COORD'='DA' OR (p_include_empty_coord AND NULLIF(btrim(attributes->>'COORD'),'') IS NULL)) AND ST_DWithin(geom::geography,ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography,LEAST(GREATEST(COALESCE(p_radius_km,50),0),50)*1000)), classified AS (
 SELECT CASE WHEN n ~ 'necropol|biserica|manastir|cimitir|schit|capela' THEN 'excluded-type' WHEN n ~ ' de la ' THEN
 CASE WHEN split_part(n,' de la ',1) ~ 'eneolit|cotofeni|cucuteni|gumelnita|hamangia' THEN 'Eneolitic / Chalcolithic' WHEN split_part(n,' de la ',1) ~ 'neolit|starcevo|cris|precucuteni' THEN 'Neolithic' WHEN split_part(n,' de la ',1) ~ 'bronz|wietenberg|monteoru|noua' THEN 'Bronze Age' WHEN split_part(n,' de la ',1) ~ 'hallstatt' THEN 'Hallstatt' WHEN split_part(n,' de la ',1) ~ 'latene|epoca fierului|geto-dac|getic' THEN 'Iron Age / La Tene' WHEN split_part(n,' de la ',1) ~ 'dacic|dava' THEN 'Dacian' WHEN split_part(n,' de la ',1) ~ 'epoca romana|roman|castru' THEN 'Roman' WHEN split_part(n,' de la ',1) ~ 'medieval|feudal|voievodal' THEN 'Medieval' ELSE 'unknown' END ELSE 'unknown' END period FROM data)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM classified),'counts',COALESCE((SELECT jsonb_object_agg(period,cnt) FROM (SELECT period,count(*) cnt FROM classified GROUP BY period) g WHERE period NOT IN ('unknown','excluded-type')),'{}'::jsonb),'unknown',(SELECT count(*) FROM classified WHERE period='unknown'),'excluded_type',(SELECT count(*) FROM classified WHERE period='excluded-type')) INTO out;
 RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.apm_site_period_counts(double precision,double precision,double precision,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apm_site_period_counts(double precision,double precision,double precision,boolean) TO authenticated;
