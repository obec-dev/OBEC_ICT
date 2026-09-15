-- Custom position ("อื่นๆ") for registration and profile edit.
-- Run in the Supabase SQL Editor after deploy.
-- Keep the sentinel in sync with POSITION_OTHER in src/lib/registrationOptions.ts.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position_other text;

COMMENT ON COLUMN public.profiles.position IS 'ตำแหน่งจากรายการ หรือ อื่นๆ';
COMMENT ON COLUMN public.profiles.position_other IS 'ตำแหน่งที่ระบุเอง เมื่อ position = อื่นๆ';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_position_other_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_position_other_check
  CHECK (position_other IS NULL OR position = 'อื่นๆ');

-- Replace every historical overload so PostgREST has one register_profile.
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
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

CREATE FUNCTION public.register_profile(
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
  p_ict_survey jsonb DEFAULT '{}'::jsonb,
  p_position_other text DEFAULT NULL
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
  v_position text := NULLIF(trim(COALESCE(p_position, '')), '');
  v_position_other text := NULLIF(trim(COALESCE(p_position_other, '')), '');
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(v_id) < 5 OR v_school = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
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

  SELECT * INTO existing
  FROM public.profiles
  WHERE profile_id = v_id
  LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, jsonb, text
) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_profile_id text,
  p_phone text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  patch jsonb := COALESCE(p_patch, '{}'::jsonb);
  v_position text;
  v_position_other text;
  v_touch_position boolean := patch ? 'position' OR patch ? 'position_other';
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  v_position := CASE
    WHEN patch ? 'position' THEN NULLIF(trim(patch->>'position'), '')
    ELSE p.position
  END;
  v_position_other := CASE
    WHEN v_position IS DISTINCT FROM 'อื่นๆ' THEN NULL
    WHEN patch ? 'position_other' THEN NULLIF(trim(patch->>'position_other'), '')
    ELSE p.position_other
  END;

  IF v_touch_position AND v_position = 'อื่นๆ' AND v_position_other IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุตำแหน่ง');
  END IF;
  IF v_position_other IS NOT NULL AND char_length(v_position_other) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ตำแหน่งยาวเกินไป');
  END IF;

  UPDATE public.profiles SET
    first_name = CASE WHEN patch ? 'first_name' THEN NULLIF(trim(patch->>'first_name'), '') ELSE first_name END,
    last_name = CASE WHEN patch ? 'last_name' THEN NULLIF(trim(patch->>'last_name'), '') ELSE last_name END,
    phone = CASE WHEN patch ? 'phone' THEN NULLIF(trim(patch->>'phone'), '') ELSE phone END,
    remark = CASE WHEN patch ? 'remark' THEN NULLIF(trim(patch->>'remark'), '') ELSE remark END,
    title_key = CASE WHEN patch ? 'title_key' THEN NULLIF(trim(patch->>'title_key'), '') ELSE title_key END,
    title_en = CASE WHEN patch ? 'title_en' THEN NULLIF(trim(patch->>'title_en'), '') ELSE title_en END,
    title_th = CASE WHEN patch ? 'title_th' THEN NULLIF(trim(patch->>'title_th'), '') ELSE title_th END,
    title_other_en = CASE WHEN patch ? 'title_other_en' THEN NULLIF(trim(patch->>'title_other_en'), '') ELSE title_other_en END,
    title_other_th = CASE WHEN patch ? 'title_other_th' THEN NULLIF(trim(patch->>'title_other_th'), '') ELSE title_other_th END,
    eng_first_name = CASE WHEN patch ? 'eng_first_name' THEN NULLIF(trim(patch->>'eng_first_name'), '') ELSE eng_first_name END,
    eng_last_name = CASE WHEN patch ? 'eng_last_name' THEN NULLIF(trim(patch->>'eng_last_name'), '') ELSE eng_last_name END,
    position = CASE WHEN v_touch_position THEN v_position ELSE position END,
    position_other = CASE WHEN v_touch_position THEN v_position_other ELSE position_other END,
    duty = CASE WHEN patch ? 'duty' THEN NULLIF(trim(patch->>'duty'), '') ELSE duty END,
    line_id = CASE WHEN patch ? 'line_id' THEN NULLIF(trim(patch->>'line_id'), '') ELSE line_id END,
    contact_email = CASE
      WHEN patch ? 'contact_email' THEN lower(NULLIF(trim(patch->>'contact_email'), ''))
      WHEN patch ? 'email' THEN lower(NULLIF(trim(patch->>'email'), ''))
      ELSE contact_email
    END,
    email = CASE
      WHEN patch ? 'contact_email' THEN lower(NULLIF(trim(patch->>'contact_email'), ''))
      WHEN patch ? 'email' THEN lower(NULLIF(trim(patch->>'email'), ''))
      ELSE email
    END,
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

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
        )
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    ) t
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public._profile_to_json(public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._profile_to_json(public.profiles) TO postgres;

NOTIFY pgrst, 'reload schema';
