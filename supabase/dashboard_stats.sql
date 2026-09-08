-- Lightweight dashboard aggregates (run once in Supabase SQL Editor)
-- Avoids downloading all ~7k school rows on every page load.

CREATE OR REPLACE FUNCTION public.get_district_stats()
RETURNS TABLE (
  district_id text,
  district_name text,
  province text,
  total_schools bigint,
  registered_schools bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.district_id,
    d.district_name,
    COALESCE(
      (
        SELECT s.province
        FROM public.schools s
        WHERE s.district_id = d.district_id
        LIMIT 1
      ),
      ''
    ) AS province,
    COUNT(s.school_id)::bigint AS total_schools,
    COUNT(s.school_id) FILTER (
      WHERE COALESCE(s.is_registered, false) IS TRUE
         OR EXISTS (
           SELECT 1 FROM public.profiles p WHERE p.school_id = s.school_id
         )
    )::bigint AS registered_schools
  FROM public.districts d
  LEFT JOIN public.schools s ON s.district_id = d.district_id
  GROUP BY d.district_id, d.district_name
  ORDER BY d.district_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_district_stats() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_school_totals()
RETURNS TABLE (
  total_schools bigint,
  registered_schools bigint,
  total_districts bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.schools)::bigint,
    (
      SELECT COUNT(*)
      FROM public.schools s
      WHERE COALESCE(s.is_registered, false) IS TRUE
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.school_id = s.school_id)
    )::bigint,
    (SELECT COUNT(*) FROM public.districts)::bigint;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_totals() TO anon, authenticated, service_role;
