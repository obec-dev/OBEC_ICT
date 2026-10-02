-- Egress reduction: slim exam list, on-demand answers, chunked exports, slim login JSON
-- Run in Supabase SQL Editor.

-- -----------------------------------------------------------------------------
-- 1) Slim admin_list_exam_progress (no answers jsonb dump)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_exam_progress(
  p_token text,
  p_profile_ids text[],
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  rows jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  IF p_profile_ids IS NULL OR array_length(p_profile_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'profile_id', e.profile_id,
    'project_id', e.project_id,
    'status', e.status,
    -- Slim lesson map: status only (enough for unlock / partial-submit badges)
    'lesson_submissions', COALESCE((
      SELECT jsonb_object_agg(k, jsonb_build_object('status', 'submitted'))
      FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS t(k, v)
      WHERE COALESCE(v->>'status', '') = 'submitted'
    ), '{}'::jsonb),
    'lesson_submitted_count', (
      SELECT count(*)::int
      FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS t(k, v)
      WHERE COALESCE(v->>'status', '') = 'submitted'
    ),
    'score', e.score,
    'passed', e.passed,
    'graded_at', e.graded_at,
    'submitted_at', e.submitted_at,
    'updated_at', e.updated_at
  )), '[]'::jsonb)
  INTO rows
  FROM public.exam_progress e
  WHERE e.profile_id = ANY (p_profile_ids)
    AND (
      p_project_id IS NULL
      OR NULLIF(trim(p_project_id), '') IS NULL
      OR e.project_id = trim(p_project_id)
      OR e.project_id IS NULL
    );

  RETURN COALESCE(rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_exam_progress(text, text[], text)
  TO anon, authenticated, service_role;

-- Lazy-load full answers when admin opens a candidate detail drawer
CREATE OR REPLACE FUNCTION public.admin_get_exam_answers(
  p_token text,
  p_profile_id text,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_profile_id, ''));
  row jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_profile_id');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'profile_id', e.profile_id,
    'project_id', e.project_id,
    'status', e.status,
    'answers', COALESCE(e.answers, '{}'::jsonb),
    'lesson_submissions', COALESCE(e.lesson_submissions, '{}'::jsonb),
    'score', e.score,
    'passed', e.passed,
    'graded_at', e.graded_at,
    'submitted_at', e.submitted_at,
    'updated_at', e.updated_at
  )
  INTO row
  FROM public.exam_progress e
  WHERE e.profile_id = v_id
    AND (
      p_project_id IS NULL
      OR NULLIF(trim(p_project_id), '') IS NULL
      OR e.project_id = trim(p_project_id)
      OR e.project_id IS NULL
    )
  ORDER BY
    CASE WHEN p_project_id IS NOT NULL AND e.project_id = trim(p_project_id) THEN 0 ELSE 1 END,
    e.updated_at DESC NULLS LAST
  LIMIT 1;

  IF row IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'profile_id', v_id,
      'answers', '{}'::jsonb,
      'lesson_submissions', '{}'::jsonb,
      'status', NULL
    );
  END IF;

  RETURN row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_exam_answers(text, text, text)
  TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) Chunked / filtered participant + registration exports
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_export_participants_full(text);

CREATE OR REPLACE FUNCTION public.admin_export_participants_full(
  p_token text,
  p_district_id text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 2000), 5000));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
  v_province text := NULLIF(trim(COALESCE(p_province, '')), '');
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id AS member_id,
        trim(COALESCE(p.title_th, '') || ' ' || COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
        COALESCE(p.login_email, p.contact_email, p.email) AS email,
        p.phone,
        COALESCE(p.portal_role, 'user') AS role,
        p.school_id,
        s.school_name,
        s.province,
        COALESCE(d.district_id, s.district_id) AS district_id,
        COALESCE(d.district_name, s.district_id) AS district_name,
        COALESCE(NULLIF(trim(s.partner), ''), '') AS zone_partner,
        COALESCE(e.status::text, 'none') AS exam_status,
        CASE
          WHEN e.status::text = 'submitted' AND e.passed IS TRUE THEN 'สอบผ่าน'
          WHEN e.status::text = 'submitted' AND e.passed IS FALSE THEN 'สอบไม่ผ่าน'
          WHEN e.status::text = 'submitted' THEN 'ส่งข้อสอบแล้ว (รอตรวจ)'
          WHEN e.status::text = 'draft' AND COALESCE(e.lesson_submissions, '{}'::jsonb) <> '{}'::jsonb
            THEN 'ส่งบางบทแล้ว'
          WHEN e.status::text = 'draft' THEN 'ฉบับร่าง / กำลังทำข้อสอบ'
          WHEN COALESCE(w.watch_completed, false) THEN 'เรียนจบ (ยังไม่เริ่มสอบ)'
          WHEN COALESCE(w.watch_rows, 0) > 0 THEN 'กำลังเรียน'
          ELSE 'ยังไม่เริ่ม'
        END AS overall_progress,
        CASE WHEN COALESCE(w.watch_completed, false) THEN 'yes' ELSE 'no' END AS learn_completed,
        to_char(e.submitted_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_submitted_at,
        to_char(e.graded_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_graded_at,
        to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS registered_at
      FROM public.profiles p
      JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      LEFT JOIN LATERAL (
        SELECT ep.*
        FROM public.exam_progress ep
        WHERE ep.profile_id = p.profile_id
        ORDER BY
          CASE WHEN ep.status::text = 'submitted' THEN 0 ELSE 1 END,
          ep.updated_at DESC NULLS LAST
        LIMIT 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS watch_rows,
          bool_or(COALESCE(wp.completed, false)) AS watch_completed
        FROM public.watch_progress wp
        WHERE wp.profile_id = p.profile_id
      ) w ON true
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (v_district IS NULL OR COALESCE(d.district_id, s.district_id) = v_district)
        AND (v_province IS NULL OR s.province = v_province)
      ORDER BY s.province, d.district_name, s.school_name, p.last_name, p.first_name
      LIMIT v_limit OFFSET v_offset
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_participants_full(text, text, text, integer, integer)
  TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_export_registration_details(text);

CREATE OR REPLACE FUNCTION public.admin_export_registration_details(
  p_token text,
  p_district_id text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 2000), 5000));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
  v_province text := NULLIF(trim(COALESCE(p_province, '')), '');
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id AS member_id,
        p.title_key,
        p.title_th,
        p.title_en,
        p.title_other_th,
        p.title_other_en,
        p.first_name,
        p.last_name,
        p.eng_first_name,
        p.eng_last_name,
        p.gender,
        p.birth_date::text AS birth_date,
        p.phone,
        p.line_id,
        COALESCE(p.contact_email, p.email) AS contact_email,
        COALESCE(p.login_email, p.email) AS login_email,
        p.position,
        p.position_other,
        p.duty,
        p.ict_talent_cohort,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain1_planning', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain1_planning,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain2_teacher_dev', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain2_teacher_dev,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain3_student_skills', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain3_student_skills,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain4_infra', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain4_infra,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain5_coordination', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain5_coordination,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain6_monitoring', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_domain6_monitoring,
        COALESCE((
          SELECT string_agg(x, '; ' ORDER BY ord)
          FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'sms_usage', '[]'::jsonb))
            WITH ORDINALITY AS t(x, ord)
        ), '') AS survey_sms_usage,
        COALESCE(p.portal_role, 'user') AS portal_role,
        COALESCE(p.is_school_admin, false) AS is_school_admin,
        p.approver,
        p.approver_position,
        p.school_id,
        s.school_name,
        s.province,
        COALESCE(d.district_id, s.district_id) AS district_id,
        COALESCE(d.district_name, s.district_id) AS district_name,
        COALESCE(NULLIF(trim(s.partner), ''), '') AS partner,
        COALESCE(s.is_registered, false) AS school_is_registered,
        to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS registered_at
      FROM public.profiles p
      JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (v_district IS NULL OR COALESCE(d.district_id, s.district_id) = v_district)
        AND (v_province IS NULL OR s.province = v_province)
      ORDER BY p.created_at DESC, s.school_name, p.last_name, p.first_name
      LIMIT v_limit OFFSET v_offset
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_registration_details(text, text, text, integer, integer)
  TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) Slim login DTO (no ict_survey / heavy metadata)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profile_to_login_json(p public.profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'profile_id', p.profile_id,
    'school_id', p.school_id,
    'school_name', (SELECT s.school_name FROM public.schools s WHERE s.school_id = p.school_id LIMIT 1),
    'first_name', p.first_name,
    'last_name', p.last_name,
    'phone', p.phone,
    'title_key', p.title_key,
    'title_en', p.title_en,
    'title_th', p.title_th,
    'title_other_en', p.title_other_en,
    'title_other_th', p.title_other_th,
    'eng_first_name', p.eng_first_name,
    'eng_last_name', p.eng_last_name,
    'gender', p.gender,
    'position', p.position,
    'position_other', p.position_other,
    'duty', p.duty,
    'line_id', p.line_id,
    'email', COALESCE(p.contact_email, p.email),
    'contact_email', COALESCE(p.contact_email, p.email),
    'login_email', COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))),
    'created_at', p.created_at,
    'is_school_admin', COALESCE(p.is_school_admin, false) OR COALESCE(p.portal_role, 'user') = 'school_admin',
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'ict_talent_cohort', p.ict_talent_cohort,
    'portal_role', COALESCE(p.portal_role, 'user'),
    'is_active', COALESCE(p.is_active, true),
    'approver', p.approver,
    'approver_position', p.approver_position
  );
$$;

REVOKE ALL ON FUNCTION public._profile_to_login_json(public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._profile_to_login_json(public.profiles) TO postgres;

-- Drop ict_survey from general profile JSON used by login/update responses
CREATE OR REPLACE FUNCTION public._profile_to_json(p public.profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT public._profile_to_login_json(p)
    || jsonb_build_object(
      'remark', p.remark,
      'birth_date', p.birth_date,
      'deleted_at', p.deleted_at,
      'assigned_district_id', p.assigned_district_id
    );
$$;

-- Prefer slim login payload on candidate password login
CREATE OR REPLACE FUNCTION public.login_candidate(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  bu public.business_users;
  au public.audit_users;
  v_id text := lower(trim(COALESCE(p_email, '')));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(p.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;

    IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'kind', 'candidate',
        'login_email', COALESCE(p.login_email, lower(trim(p.email))),
        'profile_id', p.profile_id,
        'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
      );
    END IF;

    IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'candidate', 'profile', public._profile_to_login_json(p));
  END IF;

  SELECT * INTO bu
  FROM public.business_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(bu.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF bu.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชียังไม่มีรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF extensions.crypt(p_password, bu.password_hash) IS DISTINCT FROM bu.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    IF COALESCE(bu.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'kind', 'business',
        'login_email', bu.login_email,
        'user_id', bu.id,
        'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'business_users', bu.id::text,
      jsonb_build_object('login_id', bu.login_email, 'kind', 'business'));

    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'business',
      'user', jsonb_build_object(
        'id', bu.id,
        'login_email', bu.login_email,
        'display_name', bu.display_name,
        'position', bu.position,
        'must_set_password', COALESCE(bu.must_set_password, false)
      )
    );
  END IF;

  SELECT * INTO au
  FROM public.audit_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(au.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF au.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชียังไม่มีรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF extensions.crypt(p_password, au.password_hash) IS DISTINCT FROM au.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    IF COALESCE(au.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'kind', 'audit',
        'login_email', au.login_email,
        'user_id', au.id,
        'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'audit_users', au.id::text,
      jsonb_build_object('login_id', au.login_email, 'kind', 'audit'));

    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'audit',
      'user', jsonb_build_object(
        'id', au.id,
        'login_email', au.login_email,
        'display_name', au.display_name,
        'position', au.position,
        'assigned_districts', COALESCE(au.assigned_districts, ARRAY[]::text[]),
        'must_set_password', COALESCE(au.must_set_password, false)
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
