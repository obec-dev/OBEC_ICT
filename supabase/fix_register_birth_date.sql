-- Fix register_profile: birth_date is date, not text
-- Run in Supabase SQL Editor

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
  p_email text DEFAULT NULL
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

  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birth_date, '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'วันเกิดไม่ถูกต้อง');
  END;

  INSERT INTO public.profiles (
    profile_id, school_id, first_name, last_name, phone, remark, pdpa_accepted,
    title_key, title_en, title_th, title_other_en, title_other_th,
    eng_first_name, eng_last_name, birth_date, gender, position, duty, line_id, email
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
    lower(NULLIF(trim(COALESCE(p_email, '')), ''))
  )
  RETURNING * INTO p;

  PERFORM public.mark_school_registered(v_school);

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนนี้ลงทะเบียนแล้ว');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
