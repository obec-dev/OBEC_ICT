-- Fix registration flag + helpers (run once in Supabase SQL Editor)

-- 1) Trigger: update school when a profile is inserted
CREATE OR REPLACE FUNCTION update_school_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.schools
    SET is_registered = TRUE,
        updated_at = NOW()
    WHERE school_id = NEW.school_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_school_reg ON public.profiles;
CREATE TRIGGER trigger_update_school_reg
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION update_school_registration();

-- 2) Callable from app after insert (backup if trigger missed)
CREATE OR REPLACE FUNCTION public.mark_school_registered(p_school_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.schools
  SET is_registered = TRUE,
      updated_at = NOW()
  WHERE school_id = p_school_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_school_registered(text) TO anon, authenticated, service_role;

-- 3) Backfill schools that already have profiles but is_registered is not true
UPDATE public.schools s
SET is_registered = TRUE,
    updated_at = NOW()
WHERE EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.school_id = s.school_id
)
AND COALESCE(s.is_registered, false) IS NOT TRUE;

-- 4) Profile policies for admin edit/delete
DROP POLICY IF EXISTS "Public update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public delete profiles" ON public.profiles;
CREATE POLICY "Public update profiles" ON public.profiles FOR UPDATE USING (true);
CREATE POLICY "Public delete profiles" ON public.profiles FOR DELETE USING (true);

-- 5) Stats: treat school as registered if flag OR has any profile
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
