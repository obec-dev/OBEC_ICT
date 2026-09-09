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

-- Schools in one district + people registered count (no profile PII)
CREATE OR REPLACE FUNCTION public.get_schools_by_district(p_district_id text)
RETURNS TABLE (
  school_id text,
  school_name text,
  province text,
  district_id text,
  district_name text,
  is_registered boolean,
  registered_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.school_id,
    s.school_name,
    s.province,
    s.district_id,
    COALESCE(d.district_name, s.district_id) AS district_name,
    (
      COALESCE(s.is_registered, false)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.school_id = s.school_id)
    ) AS is_registered,
    (
      SELECT COUNT(*)::bigint
      FROM public.profiles p
      WHERE p.school_id = s.school_id
    ) AS registered_count
  FROM public.schools s
  LEFT JOIN public.districts d ON d.district_id = s.district_id
  WHERE s.district_id = trim(p_district_id)
  ORDER BY s.school_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_schools_by_district(text) TO anon, authenticated, service_role;
