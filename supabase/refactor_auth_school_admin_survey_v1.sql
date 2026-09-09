-- =============================================================================
-- refactor_auth_school_admin_survey_v1.sql
-- Schools metadata, candidate passwords, school_admin, ICT survey JSONB
-- Run in Supabase SQL Editor after harden_security_v1 + fix scripts.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1) Schools leadership metadata
-- -----------------------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS school_director_name text,
  ADD COLUMN IF NOT EXISTS school_director_position text,
  ADD COLUMN IF NOT EXISTS updated_by_national_id text,
  ADD COLUMN IF NOT EXISTS updated_by_name text,
  ADD COLUMN IF NOT EXISTS school_profile_updated_at timestamptz;

-- -----------------------------------------------------------------------------
-- 2) Profiles: password + school_admin + survey
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS must_set_password boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_school_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ict_talent_cohort text,
  ADD COLUMN IF NOT EXISTS ict_survey jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Existing users without password must set one
UPDATE public.profiles
SET must_set_password = true
WHERE password_hash IS NULL;

-- One active school_admin per school
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_school_admin_idx
  ON public.profiles (school_id)
  WHERE is_school_admin = true;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_ict_talent_cohort_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_ict_talent_cohort_check
  CHECK (
    ict_talent_cohort IS NULL
    OR ict_talent_cohort IN ('never', 'gen1', 'gen2', 'gen3', 'gen4', 'gen5')
  );

-- -----------------------------------------------------------------------------
-- 3) Profile JSON helper (include new fields; never expose password_hash)
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
    'duty', p.duty,
    'line_id', p.line_id,
    'email', p.email,
    'created_at', p.created_at,
    'is_school_admin', COALESCE(p.is_school_admin, false),
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'ict_talent_cohort', p.ict_talent_cohort,
    'ict_survey', COALESCE(p.ict_survey, '{}'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- 4) Password auth RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_candidate(p_profile_id text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_digits text := public._digits_only(v_id);
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE profile_id = v_id
     OR (length(v_digits) = 13 AND public._digits_only(profile_id) = v_digits)
  ORDER BY CASE WHEN profile_id = v_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'need_password_setup', true,
      'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
    );
  END IF;

  IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- Verify national ID + phone for first-time setup or reset
CREATE OR REPLACE FUNCTION public.verify_candidate_for_password(
  p_profile_id text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ'
    );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'has_password', p.password_hash IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_candidate_password(
  p_profile_id text,
  p_phone text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(trim(COALESCE(p_new_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ'
    );
  END;

  UPDATE public.profiles
  SET
    password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    must_set_password = false,
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- Keep phone-based login_profile for verify/setup; mark need_password_setup when applicable
CREATE OR REPLACE FUNCTION public.login_profile(p_profile_id text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ'
      );
  END;

  IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'need_password_setup', true,
      'profile', public._profile_to_json(p)
    );
  END IF;

  -- Phone login allowed only before password is set; after that require password login
  RETURN jsonb_build_object(
    'ok', false,
    'error', 'บัญชีนี้ตั้งรหัสผ่านแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่าน'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) register_profile — school_admin + survey + cohort
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.register_profile(
  text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text
);

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
  existing public.profiles;
  v_birth date;
  v_want_admin boolean := COALESCE(p_is_school_admin, false);
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(v_id) < 5 OR v_school = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลลงทะเบียนไม่ครบ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE school_id = v_school) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
  END IF;

  SELECT * INTO existing FROM public.profiles WHERE profile_id = v_id LIMIT 1;
  IF FOUND THEN
    IF existing.school_id = v_school THEN
      RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ลงทะเบียนกับโรงเรียนนี้แล้ว');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ถูกใช้ลงทะเบียนกับโรงเรียนอื่นแล้ว');
  END IF;

  IF v_want_admin AND EXISTS (
    SELECT 1 FROM public.profiles WHERE school_id = v_school AND is_school_admin = true
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

  INSERT INTO public.profiles (
    profile_id, school_id, first_name, last_name, phone, remark, pdpa_accepted,
    title_key, title_en, title_th, title_other_en, title_other_th,
    eng_first_name, eng_last_name, birth_date, gender, position, duty, line_id, email,
    is_school_admin, ict_talent_cohort, ict_survey,
    must_set_password, password_hash
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
    lower(NULLIF(trim(COALESCE(p_email, '')), '')),
    v_want_admin,
    NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
    COALESCE(p_ict_survey, '{}'::jsonb),
    true,
    NULL
  )
  RETURNING * INTO p;

  PERFORM public.mark_school_registered(v_school);

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%profiles_one_school_admin%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้มีผู้จัดการข้อมูลสถานศึกษาอยู่แล้ว');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ลงทะเบียนแล้ว');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) School profile update (school_admin only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_school_profile(
  p_profile_id text,
  p_phone text,
  p_director_name text,
  p_director_position text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  IF NOT COALESCE(p.is_school_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'เฉพาะผู้จัดการข้อมูลสถานศึกษาเท่านั้น');
  END IF;

  UPDATE public.schools
  SET
    school_director_name = NULLIF(trim(COALESCE(p_director_name, '')), ''),
    school_director_position = NULLIF(trim(COALESCE(p_director_position, '')), ''),
    updated_by_national_id = p.profile_id,
    updated_by_name = trim(BOTH FROM concat_ws(' ', COALESCE(p.title_th, ''), p.first_name, p.last_name)),
    school_profile_updated_at = now()
  WHERE school_id = p.school_id;

  RETURN jsonb_build_object(
    'ok', true,
    'school', (
      SELECT jsonb_build_object(
        'school_id', s.school_id,
        'school_name', s.school_name,
        'school_director_name', s.school_director_name,
        'school_director_position', s.school_director_position,
        'updated_by_national_id', s.updated_by_national_id,
        'updated_by_name', s.updated_by_name,
        'school_profile_updated_at', s.school_profile_updated_at
      )
      FROM public.schools s WHERE s.school_id = p.school_id LIMIT 1
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_school_profile_for_admin(
  p_profile_id text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  IF NOT COALESCE(p.is_school_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'school', (
      SELECT jsonb_build_object(
        'school_id', s.school_id,
        'school_name', s.school_name,
        'province', s.province,
        'school_director_name', s.school_director_name,
        'school_director_position', s.school_director_position,
        'updated_by_national_id', s.updated_by_national_id,
        'updated_by_name', s.updated_by_name,
        'school_profile_updated_at', s.school_profile_updated_at
      )
      FROM public.schools s WHERE s.school_id = p.school_id LIMIT 1
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Admin: set school_admin (1 per school), delete exam only, cascade delete
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_school_admin(
  p_token text,
  p_profile_id text,
  p_is_school_admin boolean
)
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
  PERFORM set_config('row_security', 'off', true);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้สมัคร');
  END IF;

  IF COALESCE(p_is_school_admin, false) THEN
    UPDATE public.profiles
    SET is_school_admin = false, updated_at = now()
    WHERE school_id = p.school_id
      AND profile_id <> p.profile_id
      AND is_school_admin = true;

    UPDATE public.profiles
    SET is_school_admin = true, updated_at = now()
    WHERE profile_id = p.profile_id;
  ELSE
    UPDATE public.profiles
    SET is_school_admin = false, updated_at = now()
    WHERE profile_id = p.profile_id;
  END IF;

  PERFORM public._write_audit(
    a.admin_id, 'set_school_admin', 'profiles', p.profile_id,
    jsonb_build_object('is_school_admin', p.is_school_admin),
    jsonb_build_object('is_school_admin', p_is_school_admin)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_exam_progress(
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
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM set_config('row_security', 'off', true);

  IF NULLIF(trim(COALESCE(p_project_id, '')), '') IS NULL THEN
    DELETE FROM public.exam_progress WHERE profile_id = trim(p_profile_id);
  ELSE
    DELETE FROM public.exam_progress
    WHERE profile_id = trim(p_profile_id)
      AND (project_id = trim(p_project_id) OR project_id IS NULL);
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public._write_audit(
    a.admin_id, 'delete_exam_progress', 'exam_progress', trim(p_profile_id),
    null,
    jsonb_build_object('project_id', p_project_id, 'deleted', v_count)
  );

  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$$;

-- Ensure full profile delete also clears progress orphans
CREATE OR REPLACE FUNCTION public.admin_delete_profile(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  v_school text;
  v_left integer;
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM set_config('row_security', 'off', true);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้สมัคร');
  END IF;

  v_school := p.school_id;

  DELETE FROM public.exam_progress WHERE profile_id = p.profile_id;
  DELETE FROM public.watch_progress WHERE profile_id = p.profile_id;
  DELETE FROM public.profiles WHERE profile_id = p.profile_id;

  SELECT count(*) INTO v_left FROM public.profiles WHERE school_id = v_school;
  IF v_left = 0 THEN
    UPDATE public.schools SET is_registered = false WHERE school_id = v_school;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'delete_profile', 'profiles', p.profile_id, to_jsonb(p), null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) GRANTs
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_candidate_for_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_candidate_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_profile(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text, jsonb
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_profile(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_profile_for_admin(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_school_admin(text, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_exam_progress(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_profile(text, text) TO anon, authenticated;

-- Return is_school_admin in admin search/list
CREATE OR REPLACE FUNCTION public.admin_search_profiles(
  p_token text,
  p_query text,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  q text := TRIM(COALESCE(p_query, ''));
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM set_config('row_security', 'off', true);

  IF length(q) < 1 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', t.profile_id,
      'school_id', t.school_id,
      'school_name', t.school_name,
      'first_name', t.first_name,
      'last_name', t.last_name,
      'phone', t.phone,
      'remark', t.remark,
      'is_school_admin', t.is_school_admin,
      'created_at', t.created_at
    ))
    FROM (
      SELECT
        p.profile_id,
        p.school_id,
        s.school_name,
        p.first_name,
        p.last_name,
        p.phone,
        p.remark,
        COALESCE(p.is_school_admin, false) AS is_school_admin,
        p.created_at
      FROM profiles p
      LEFT JOIN schools s ON s.school_id = p.school_id
      WHERE p.profile_id ILIKE '%' || q || '%'
         OR p.school_id ILIKE '%' || q || '%'
         OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
         OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
         OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
         OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_profiles_by_school(p_token text, p_school_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM set_config('row_security', 'off', true);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', p.profile_id,
      'school_id', p.school_id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'phone', p.phone,
      'remark', p.remark,
      'is_school_admin', COALESCE(p.is_school_admin, false),
      'created_at', p.created_at
    ) ORDER BY p.created_at DESC)
    FROM public.profiles p
    WHERE p.school_id = trim(p_school_id)
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_profiles(text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_by_school(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
