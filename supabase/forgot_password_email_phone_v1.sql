-- Forgot password: verify by login_email + phone (no birth_date).
-- Run in the Supabase SQL Editor after identity_exam_sections_v1.sql.

DROP FUNCTION IF EXISTS public.verify_candidate_forgot_password(text, text);
DROP FUNCTION IF EXISTS public.verify_candidate_forgot_password(text, text, text);

CREATE FUNCTION public.verify_candidate_forgot_password(
  p_email text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  v_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_email IS NULL OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.profiles pr
  WHERE pr.deleted_at IS NULL
    AND lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
    AND public._phones_match(pr.phone, p_phone);

  IF v_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles pr
  WHERE pr.deleted_at IS NULL
    AND lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
    AND public._phones_match(pr.phone, p_phone)
  LIMIT 1;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'login_email', COALESCE(p.login_email, lower(trim(p.email))),
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'has_password', p.password_hash IS NOT NULL
  );
END;
$$;

DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text);
DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text, text);

CREATE FUNCTION public.set_candidate_password(
  p_email text,
  p_phone text,
  p_new_password text,
  p_birth_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_first_time boolean;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(trim(COALESCE(p_new_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
  LIMIT 1;

  IF NOT FOUND OR COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  v_first_time := p.password_hash IS NULL OR COALESCE(p.must_set_password, true);

  -- Forgot-password path: require matching phone. First-time setup may skip phone.
  IF NOT v_first_time THEN
    IF NOT public._phones_match(p.phone, p_phone) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    must_set_password = false,
    login_email = COALESCE(NULLIF(trim(login_email), ''), v_email),
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- Enrich user search + exam export with login_email / school geography for admin filters & reports.
CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_token text,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_include_deleted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  q text := trim(COALESCE(p_query, ''));
BEGIN
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id,
        p.school_id,
        s.school_name,
        s.province,
        s.district_id,
        d.district_name,
        p.first_name,
        p.last_name,
        p.phone,
        COALESCE(p.contact_email, p.email) AS email,
        COALESCE(p.contact_email, p.email) AS contact_email,
        COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))) AS login_email,
        COALESCE(p.portal_role, 'user') AS portal_role,
        COALESCE(p.is_school_admin, false) AS is_school_admin,
        COALESCE(p.is_active, true) AS is_active,
        p.deleted_at,
        p.assigned_district_id,
        p.position,
        p.position_other,
        p.title_th,
        p.title_other_th,
        p.created_at
      FROM public.profiles p
      LEFT JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      WHERE (p_include_deleted OR p.deleted_at IS NULL)
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (
          q = ''
          OR p.profile_id ILIKE '%' || q || '%'
          OR p.school_id ILIKE '%' || q || '%'
          OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
          OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
          OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) ILIKE '%' || q || '%'
          OR COALESCE(p.login_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.contact_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
          OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
          OR COALESCE(s.province, '') ILIKE '%' || q || '%'
          OR COALESCE(d.district_name, '') ILIKE '%' || q || '%'
        )
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_export_exam_responses(
  p_token text,
  p_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_project IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', e.profile_id,
      'login_email', COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))),
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')),
      'school_id', p.school_id,
      'school_name', s.school_name,
      'phone', p.phone,
      'email', COALESCE(p.contact_email, p.email),
      'project_id', e.project_id,
      'answers', e.answers,
      'status', e.status,
      'score', e.score,
      'passed', e.passed,
      'graded_at', e.graded_at,
      'updated_at', e.updated_at
    ) ORDER BY e.updated_at DESC)
    FROM public.exam_progress e
    JOIN public.profiles p ON p.profile_id = e.profile_id AND p.deleted_at IS NULL
    LEFT JOIN public.schools s ON s.school_id = p.school_id
    WHERE e.project_id = v_project OR e.project_id IS NULL
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_candidate_forgot_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_candidate_password(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_exam_responses(text, text) TO anon, authenticated, service_role;
