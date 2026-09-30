-- Exclude soft-deleted profiles from District Overview / dashboard metrics.
-- Run in Supabase SQL Editor (production + staging).
--
-- Rules for "registered":
--   profiles.deleted_at IS NULL
--   AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')

-- -----------------------------------------------------------------------------
-- Helper: does this school still have an active registrant?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_has_active_registrant(p_school_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.school_id = trim(p_school_id)
      AND p.deleted_at IS NULL
      AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.school_has_active_registrant(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_school_is_registered(p_school_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(trim(COALESCE(p_school_id, '')), '') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.schools
  SET
    is_registered = public.school_has_active_registrant(p_school_id),
    updated_at = now()
  WHERE school_id = trim(p_school_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_school_is_registered(text) TO anon, authenticated, service_role;

-- Keep schools.is_registered in sync on profile insert / soft-delete / restore / school move
CREATE OR REPLACE FUNCTION public.update_school_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_school_is_registered(NEW.school_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      PERFORM public.sync_school_is_registered(OLD.school_id);
    END IF;
    PERFORM public.sync_school_is_registered(NEW.school_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_school_is_registered(OLD.school_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_school_reg ON public.profiles;
CREATE TRIGGER trigger_update_school_reg
AFTER INSERT OR DELETE OR UPDATE OF school_id, deleted_at, portal_role
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_school_registration();

-- Backfill flag from active profiles only
UPDATE public.schools s
SET
  is_registered = public.school_has_active_registrant(s.school_id),
  updated_at = now()
WHERE COALESCE(s.is_registered, false) IS DISTINCT FROM public.school_has_active_registrant(s.school_id);

-- -----------------------------------------------------------------------------
-- Public dashboard RPCs (/dashboard)
-- -----------------------------------------------------------------------------
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
      WHERE public.school_has_active_registrant(s.school_id)
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
      WHERE public.school_has_active_registrant(s.school_id)
    )::bigint,
    (SELECT COUNT(*) FROM public.districts)::bigint;
$$;

GRANT EXECUTE ON FUNCTION public.get_school_totals() TO anon, authenticated, service_role;

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
    public.school_has_active_registrant(s.school_id) AS is_registered,
    (
      SELECT COUNT(*)::bigint
      FROM public.profiles p
      WHERE p.school_id = s.school_id
        AND p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
    ) AS registered_count
  FROM public.schools s
  LEFT JOIN public.districts d ON d.district_id = s.district_id
  WHERE s.district_id = trim(p_district_id)
  ORDER BY s.school_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_schools_by_district(text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admin overview (/admin/overview)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_overview_stats(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);

  RETURN jsonb_build_object(
    'schools_total', (SELECT count(*) FROM public.schools),
    'schools_registered', (
      SELECT count(*) FROM public.schools s
      WHERE public.school_has_active_registrant(s.school_id)
    ),
    'districts_total', (SELECT count(*) FROM public.districts),
    'profiles_total', (
      SELECT count(*) FROM public.profiles
      WHERE deleted_at IS NULL
        AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')
    ),
    'profiles_today', (
      SELECT count(*) FROM public.profiles
      WHERE deleted_at IS NULL
        AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')
        AND created_at::date = (timezone('Asia/Bangkok', now()))::date
    ),
    'watch_completed', (
      SELECT count(*) FROM public.watch_progress w
      WHERE COALESCE(w.completed, false)
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = w.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'watch_total', (
      SELECT count(*) FROM public.watch_progress w
      WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.profile_id = w.profile_id
          AND p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      )
    ),
    'exam_submitted', (
      SELECT count(*) FROM public.exam_progress e
      WHERE e.status = 'submitted'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_draft', (
      SELECT count(*) FROM public.exam_progress e
      WHERE e.status = 'draft'
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_total', (
      SELECT count(*) FROM public.exam_progress e
      WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.profile_id = e.profile_id
          AND p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_overview_stats(text) TO anon, authenticated, service_role;

-- Soft-delete / restore: sync school flag immediately (trigger also covers this)
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
BEGIN
  a := public._admin_from_token(p_token);

  UPDATE public.profiles
  SET deleted_at = now(), is_active = false, updated_at = now()
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL
  RETURNING * INTO p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งานหรือถูกลบแล้ว');
  END IF;

  PERFORM public.sync_school_is_registered(p.school_id);

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    'soft_delete_user',
    'profiles',
    p.profile_id,
    jsonb_build_object('deleted_at', p.deleted_at)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_restore_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  clash text;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีในถังกู้คืน');
  END IF;

  IF p.email IS NOT NULL AND NULLIF(trim(p.email), '') IS NOT NULL THEN
    SELECT profile_id INTO clash
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND lower(trim(email)) = lower(trim(p.email))
      AND profile_id <> p.profile_id
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถกู้คืนได้ เนื่องจากอีเมลถูกใช้โดยบัญชีอื่นแล้ว');
    END IF;
  END IF;

  UPDATE public.profiles
  SET deleted_at = NULL, is_active = true, updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  PERFORM public.sync_school_is_registered(p.school_id);

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, 'restore_user', 'profiles', p.profile_id, jsonb_build_object('restored', true));

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_user(text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Executive / partner summary (same active-only rule)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.executive_summary_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_schools integer;
  registered_schools integer;
  total_users integer;
  total_districts integer;
  total_missions integer;
  completed_pairs integer;
BEGIN
  SELECT count(*) INTO total_schools FROM public.schools;
  SELECT count(*) INTO registered_schools
  FROM public.schools s
  WHERE public.school_has_active_registrant(s.school_id);
  SELECT count(DISTINCT district_id) INTO total_districts FROM public.schools WHERE district_id IS NOT NULL;
  SELECT count(*) INTO total_users
  FROM public.profiles
  WHERE deleted_at IS NULL AND COALESCE(portal_role, 'user') IN ('user', 'school_admin');
  SELECT count(*) INTO total_missions FROM public.missions WHERE is_active = true;
  SELECT count(*) INTO completed_pairs
  FROM public.user_missions um
  JOIN public.missions m ON m.id = um.mission_id AND m.is_active = true
  JOIN public.profiles p ON p.profile_id = um.profile_id AND p.deleted_at IS NULL
  WHERE um.status = 'completed';

  RETURN jsonb_build_object(
    'total_schools', total_schools,
    'registered_schools', registered_schools,
    'total_users', total_users,
    'total_districts', total_districts,
    'total_missions', total_missions,
    'mission_completions', completed_pairs,
    'by_province', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'province', x.province,
        'schools', x.schools,
        'registered', x.registered,
        'users', x.users
      ) ORDER BY x.province)
      FROM (
        SELECT
          s.province,
          count(DISTINCT s.school_id) AS schools,
          count(DISTINCT s.school_id) FILTER (
            WHERE public.school_has_active_registrant(s.school_id)
          ) AS registered,
          count(p.profile_id) AS users
        FROM public.schools s
        LEFT JOIN public.profiles p
          ON p.school_id = s.school_id
         AND p.deleted_at IS NULL
         AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        GROUP BY s.province
      ) x
    ), '[]'::jsonb),
    'by_district', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'district_id', x.district_id,
        'district_name', x.district_name,
        'province', x.province,
        'schools', x.schools,
        'registered', x.registered,
        'users', x.users
      ) ORDER BY x.district_name)
      FROM (
        SELECT
          COALESCE(d.district_id, s.district_id) AS district_id,
          COALESCE(d.district_name, s.district_id) AS district_name,
          max(s.province) AS province,
          count(DISTINCT s.school_id) AS schools,
          count(DISTINCT s.school_id) FILTER (
            WHERE public.school_has_active_registrant(s.school_id)
          ) AS registered,
          count(p.profile_id) AS users
        FROM public.schools s
        LEFT JOIN public.districts d ON d.district_id = s.district_id
        LEFT JOIN public.profiles p
          ON p.school_id = s.school_id
         AND p.deleted_at IS NULL
         AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        GROUP BY 1, 2
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.executive_summary_stats() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
