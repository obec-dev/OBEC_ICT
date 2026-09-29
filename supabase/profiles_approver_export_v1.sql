-- Approver on profiles + register_profile param + admin CSV export RPCs
-- Run in Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approver text;

COMMENT ON COLUMN public.profiles.approver IS
  'ชื่อ-นามสกุล ผู้บังคับบัญชา/ผู้อนุมัติ จากแบบฟอร์มลงทะเบียน (batch-level)';

-- -----------------------------------------------------------------------------
-- Profile JSON helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profile_to_json(p public.profiles)
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
    'remark', p.remark,
    'title_key', p.title_key,
    'title_en', p.title_en,
    'title_th', p.title_th,
    'title_other_en', p.title_other_en,
    'title_other_th', p.title_other_th,
    'eng_first_name', p.eng_first_name,
    'eng_last_name', p.eng_last_name,
    'birth_date', p.birth_date,
    'gender', p.gender,
    'position', p.position,
    'position_other', p.position_other,
    'duty', p.duty,
    'line_id', p.line_id,
    'email', COALESCE(p.contact_email, p.email),
    'contact_email', COALESCE(p.contact_email, p.email),
    'login_email', COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))),
    'approver', p.approver,
    'created_at', p.created_at,
    'is_school_admin', COALESCE(p.is_school_admin, false) OR COALESCE(p.portal_role, 'user') = 'school_admin',
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'ict_talent_cohort', p.ict_talent_cohort,
    'ict_survey', COALESCE(p.ict_survey, '{}'::jsonb),
    'portal_role', COALESCE(p.portal_role, 'user'),
    'is_active', COALESCE(p.is_active, true),
    'deleted_at', p.deleted_at,
    'assigned_district_id', p.assigned_district_id
  );
$$;

-- -----------------------------------------------------------------------------
-- Recreate register_profile with p_approver (drop all overloads first)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'register_profile'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
  END LOOP;
END $$;

CREATE FUNCTION public.register_profile(
  p_profile_id text DEFAULT NULL,
  p_school_id text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_remark text DEFAULT NULL,
  p_pdpa_accepted boolean DEFAULT true,
  p_title_key text DEFAULT NULL,
  p_title_en text DEFAULT NULL,
  p_title_th text DEFAULT NULL,
  p_title_other_en text DEFAULT NULL,
  p_title_other_th text DEFAULT NULL,
  p_eng_first_name text DEFAULT NULL,
  p_eng_last_name text DEFAULT NULL,
  p_birth_date text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_duty text DEFAULT NULL,
  p_line_id text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_is_school_admin boolean DEFAULT false,
  p_ict_talent_cohort text DEFAULT NULL,
  p_ict_survey jsonb DEFAULT '{}'::jsonb,
  p_position_other text DEFAULT NULL,
  p_approver text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := NULLIF(trim(COALESCE(p_profile_id, '')), '');
  v_school text := trim(COALESCE(p_school_id, ''));
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  existing public.profiles;
  v_birth date;
  v_want_admin boolean := COALESCE(p_is_school_admin, false);
  v_old_school text;
  v_email_taken boolean := false;
  v_position text := NULLIF(trim(COALESCE(p_position, '')), '');
  v_position_other text := NULLIF(trim(COALESCE(p_position_other, '')), '');
  v_approver text := NULLIF(trim(COALESCE(p_approver, '')), '');
  v_generated boolean := false;
  v_has_existing boolean := false;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_school = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_first_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_last_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลลงทะเบียนไม่ครบ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE school_id = v_school) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
  END IF;

  IF v_position IS DISTINCT FROM 'อื่นๆ' THEN
    v_position_other := NULL;
  ELSIF v_position_other IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุตำแหน่ง');
  ELSIF char_length(v_position_other) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ตำแหน่งยาวเกินไป');
  END IF;

  IF v_approver IS NOT NULL AND char_length(v_approver) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ชื่อผู้อนุมัติยาวเกินไป');
  END IF;

  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.profiles
    WHERE deleted_at IS NOT NULL
      AND lower(trim(COALESCE(login_email, email, ''))) = v_email
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_id := existing.profile_id;
      v_has_existing := true;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    v_id := public.generate_profile_id();
    v_generated := true;
    v_has_existing := false;
  ELSIF NOT v_has_existing THEN
    SELECT * INTO existing
    FROM public.profiles
    WHERE profile_id = v_id
    LIMIT 1;
    v_has_existing := FOUND;
  END IF;

  IF v_has_existing AND existing.deleted_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผู้สมัครนี้ลงทะเบียนแล้ว');
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.deleted_at IS NULL
      AND pr.profile_id <> v_id
      AND lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
  END IF;

  IF v_email IS NOT NULL AND to_regclass('public.business_users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.business_users
        WHERE deleted_at IS NULL AND lower(trim(login_email)) = $1
      )
    $q$ INTO v_email_taken USING v_email;
    IF v_email_taken THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
  END IF;

  IF v_email IS NOT NULL AND to_regclass('public.audit_users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.audit_users
        WHERE deleted_at IS NULL AND lower(trim(login_email)) = $1
      )
    $q$ INTO v_email_taken USING v_email;
    IF v_email_taken THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
  END IF;

  IF v_want_admin AND EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.school_id = v_school
      AND pr.deleted_at IS NULL
      AND pr.profile_id <> v_id
      AND (COALESCE(pr.is_school_admin, false) OR COALESCE(pr.portal_role, 'user') = 'school_admin')
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'โรงเรียนนี้มีผู้จัดการข้อมูลสถานศึกษาอยู่แล้ว กรุณาติดต่อผู้ดูแลระบบหากต้องการเปลี่ยน'
    );
  END IF;

  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birth_date, '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'วันเกิดไม่ถูกต้อง');
  END;

  IF v_has_existing AND existing.deleted_at IS NOT NULL THEN
    v_old_school := existing.school_id;

    IF to_regclass('public.exam_progress') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.exam_progress WHERE profile_id = $1' USING existing.profile_id;
    END IF;
    IF to_regclass('public.watch_progress') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.watch_progress WHERE profile_id = $1' USING existing.profile_id;
    END IF;
    IF to_regclass('public.user_missions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.user_missions WHERE profile_id = $1' USING existing.profile_id;
    END IF;

    UPDATE public.profiles
    SET
      school_id = v_school,
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      phone = trim(p_phone),
      remark = NULLIF(trim(COALESCE(p_remark, '')), ''),
      pdpa_accepted = COALESCE(p_pdpa_accepted, true),
      title_key = NULLIF(trim(COALESCE(p_title_key, '')), ''),
      title_en = NULLIF(trim(COALESCE(p_title_en, '')), ''),
      title_th = NULLIF(trim(COALESCE(p_title_th, '')), ''),
      title_other_en = NULLIF(trim(COALESCE(p_title_other_en, '')), ''),
      title_other_th = NULLIF(trim(COALESCE(p_title_other_th, '')), ''),
      eng_first_name = NULLIF(trim(COALESCE(p_eng_first_name, '')), ''),
      eng_last_name = NULLIF(trim(COALESCE(p_eng_last_name, '')), ''),
      birth_date = v_birth,
      gender = NULLIF(trim(COALESCE(p_gender, '')), ''),
      position = v_position,
      position_other = v_position_other,
      duty = NULLIF(trim(COALESCE(p_duty, '')), ''),
      line_id = NULLIF(trim(COALESCE(p_line_id, '')), ''),
      email = v_email,
      contact_email = v_email,
      login_email = v_email,
      is_school_admin = v_want_admin,
      portal_role = CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      ict_talent_cohort = NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      ict_survey = COALESCE(p_ict_survey, '{}'::jsonb),
      approver = v_approver,
      is_active = true,
      deleted_at = NULL,
      must_set_password = true,
      password_hash = NULL,
      updated_at = now()
    WHERE profile_id = existing.profile_id
    RETURNING * INTO p;

    IF v_old_school IS DISTINCT FROM v_school AND NOT EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.school_id = v_old_school
        AND pr.deleted_at IS NULL
    ) THEN
      UPDATE public.schools
      SET is_registered = false, updated_at = now()
      WHERE school_id = v_old_school;
    END IF;
  ELSE
    INSERT INTO public.profiles (
      profile_id, school_id, first_name, last_name, phone, remark, pdpa_accepted,
      title_key, title_en, title_th, title_other_en, title_other_th,
      eng_first_name, eng_last_name, birth_date, gender, position, position_other, duty, line_id, email,
      contact_email, login_email,
      is_school_admin, portal_role, ict_talent_cohort, ict_survey, approver,
      is_active, deleted_at, must_set_password, password_hash
    ) VALUES (
      v_id, v_school,
      trim(p_first_name), trim(p_last_name), trim(p_phone),
      NULLIF(trim(COALESCE(p_remark, '')), ''),
      COALESCE(p_pdpa_accepted, true),
      NULLIF(trim(COALESCE(p_title_key, '')), ''),
      NULLIF(trim(COALESCE(p_title_en, '')), ''),
      NULLIF(trim(COALESCE(p_title_th, '')), ''),
      NULLIF(trim(COALESCE(p_title_other_en, '')), ''),
      NULLIF(trim(COALESCE(p_title_other_th, '')), ''),
      NULLIF(trim(COALESCE(p_eng_first_name, '')), ''),
      NULLIF(trim(COALESCE(p_eng_last_name, '')), ''),
      v_birth,
      NULLIF(trim(COALESCE(p_gender, '')), ''),
      v_position,
      v_position_other,
      NULLIF(trim(COALESCE(p_duty, '')), ''),
      NULLIF(trim(COALESCE(p_line_id, '')), ''),
      v_email,
      v_email,
      v_email,
      v_want_admin,
      CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      COALESCE(p_ict_survey, '{}'::jsonb),
      v_approver,
      true,
      NULL,
      true,
      NULL
    )
    RETURNING * INTO p;
  END IF;

  PERFORM public.mark_school_registered(v_school);

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%profiles_one_school_admin%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้มีผู้จัดการข้อมูลสถานศึกษาอยู่แล้ว');
    END IF;
    IF SQLERRM LIKE '%login_email%' OR SQLERRM LIKE '%email%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
    IF SQLERRM LIKE '%profile_id%' OR SQLERRM LIKE '%profiles_pkey%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถสร้างรหัสผู้สมัครได้ กรุณาลองอีกครั้ง');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถลงทะเบียนได้ เนื่องจากข้อมูลซ้ำในระบบ');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, jsonb, text, text
) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Admin CSV: full participant data (person-level + exam/progress)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_export_participants_full(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
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
      ORDER BY s.province, d.district_name, s.school_name, p.last_name, p.first_name
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- Admin CSV: registration details (form fields + approver)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_export_registration_details(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
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
      ORDER BY p.created_at DESC, s.school_name, p.last_name, p.first_name
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_participants_full(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_registration_details(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
