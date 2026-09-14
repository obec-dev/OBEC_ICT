-- =============================================================================
-- fix_register_false_duplicate_v1.sql
-- Registration said "เลขบัตรประชาชนนี้ลงทะเบียนแล้ว" even when that ID was not
-- an active registration:
--   1) Soft-deleted profiles still occupied profile_id, but admin search hides them.
--   2) A duplicate email/login_email unique index was reported as a national-ID clash.
-- Run in the Supabase SQL Editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.profile_registration_check(p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE profile_id = v_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  RETURN jsonb_build_object(
    'exists', true,
    'profile_id', p.profile_id,
    'school_id', p.school_id,
    'school_name', (SELECT s.school_name FROM public.schools s WHERE s.school_id = p.school_id LIMIT 1)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_profile(
  p_profile_id text,
  p_school_id text,
  p_first_name text,
  p_last_name text,
  p_phone text,
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
  p_ict_survey jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_school text := trim(COALESCE(p_school_id, ''));
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  existing public.profiles;
  v_birth date;
  v_want_admin boolean := COALESCE(p_is_school_admin, false);
  v_old_school text;
  v_email_taken boolean := false;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(v_id) < 5 OR v_school = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลลงทะเบียนไม่ครบ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE school_id = v_school) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
  END IF;

  SELECT * INTO existing
  FROM public.profiles
  WHERE profile_id = v_id
  LIMIT 1;

  -- Only an active account blocks the national ID. Soft-deleted rows are hidden
  -- from admin search and must not be reported as "already registered".
  IF FOUND AND existing.deleted_at IS NULL THEN
    IF existing.school_id = v_school THEN
      RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ลงทะเบียนกับโรงเรียนนี้แล้ว');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ถูกใช้ลงทะเบียนกับโรงเรียนอื่นแล้ว');
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
      AND pr.is_school_admin = true
      AND pr.profile_id <> v_id
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

  IF FOUND AND existing.deleted_at IS NOT NULL THEN
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
      position = NULLIF(trim(COALESCE(p_position, '')), ''),
      duty = NULLIF(trim(COALESCE(p_duty, '')), ''),
      line_id = NULLIF(trim(COALESCE(p_line_id, '')), ''),
      email = v_email,
      contact_email = v_email,
      login_email = v_email,
      is_school_admin = v_want_admin,
      portal_role = CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      ict_talent_cohort = NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      ict_survey = COALESCE(p_ict_survey, '{}'::jsonb),
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
      eng_first_name, eng_last_name, birth_date, gender, position, duty, line_id, email,
      contact_email, login_email,
      is_school_admin, portal_role, ict_talent_cohort, ict_survey,
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
      NULLIF(trim(COALESCE(p_position, '')), ''),
      NULLIF(trim(COALESCE(p_duty, '')), ''),
      NULLIF(trim(COALESCE(p_line_id, '')), ''),
      v_email,
      v_email,
      v_email,
      v_want_admin,
      CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      COALESCE(p_ict_survey, '{}'::jsonb),
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
      RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ลงทะเบียนแล้ว');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถลงทะเบียนได้ เนื่องจากข้อมูลซ้ำในระบบ');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.profile_registration_check(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb
) TO anon, authenticated, service_role;
