-- Schools by district with registered people count (no PII)
-- Run in Supabase SQL Editor if get_schools_by_district is missing

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
NOTIFY pgrst, 'reload schema';
