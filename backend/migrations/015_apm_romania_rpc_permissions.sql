-- Remove Supabase's default direct anon grants; authenticated calls remain protected by each function's premium check.
REVOKE ALL ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apm_sites_within(double precision,double precision,double precision,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.apm_site_period_counts(double precision,double precision,double precision,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apm_site_period_counts(double precision,double precision,double precision,boolean) TO authenticated, service_role;
