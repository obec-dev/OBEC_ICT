-- =============================================================================
-- EDU_ICT harden_security_v1.sql
-- Run in Supabase SQL Editor AFTER deploying the matching app changes.
-- Closes open RLS, answer-key leakage, PII dumps, and ungated grading.
--
-- If an admin is locked out after removing plaintext passwords:
--   UPDATE public.admins
--   SET password_hash = extensions.crypt('TempPass123!', extensions.gen_salt('bf')),
--       must_change_password = true
--   WHERE username = 'your_admin';
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._digits_only(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(t, ''), '\D', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public._normalize_phone(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN length(d) = 11 AND left(d, 2) = '66' THEN right(d, 9)
    WHEN length(d) = 10 AND left(d, 1) = '0' THEN right(d, 9)
    WHEN length(d) >= 9 THEN right(d, 9)
    ELSE d
  END
  FROM (SELECT public._digits_only(t) AS d) s;
$$;

CREATE OR REPLACE FUNCTION public._phones_match(a text, b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    NULLIF(public._normalize_phone(a), '') IS NOT NULL
    AND NULLIF(public._normalize_phone(b), '') IS NOT NULL
    AND public._normalize_phone(a) = public._normalize_phone(b);
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
    'duty', p.duty,
    'line_id', p.line_id,
    'email', p.email,
    'created_at', p.created_at
  );
$$;

CREATE OR REPLACE FUNCTION public._verify_profile_phone(p_profile_id text, p_phone text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_digits text := public._digits_only(v_id);
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE profile_id = v_id
     OR (length(v_digits) = 13 AND public._digits_only(profile_id) = v_digits)
  ORDER BY CASE WHEN profile_id = v_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND OR NOT public._phones_match(p.phone, p_phone) THEN
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  RETURN p;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1) RLS: lock tables (deny by default except explicit policies)
-- -----------------------------------------------------------------------------

-- Profiles: no direct SELECT / UPDATE / DELETE for anon
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public select profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "anon insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "anon select profiles" ON public.profiles;
-- Registration goes through register_profile RPC (SECURITY DEFINER)

-- Schools / districts: public read only
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon select schools" ON public.schools;
DROP POLICY IF EXISTS "anon select districts" ON public.districts;
DROP POLICY IF EXISTS "Public select schools" ON public.schools;
DROP POLICY IF EXISTS "Public select districts" ON public.districts;
CREATE POLICY "anon select schools" ON public.schools FOR SELECT USING (true);
CREATE POLICY "anon select districts" ON public.districts FOR SELECT USING (true);

-- Projects / videos: public read; writes via admin RPC
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "projects_all" ON public.projects;
DROP POLICY IF EXISTS "project_videos_all" ON public.project_videos;
DROP POLICY IF EXISTS "anon select projects" ON public.projects;
DROP POLICY IF EXISTS "anon select project_videos" ON public.project_videos;
CREATE POLICY "anon select projects" ON public.projects FOR SELECT USING (true);
CREATE POLICY "anon select project_videos" ON public.project_videos FOR SELECT USING (true);

-- Questions: no direct table access for anon (use view + admin RPC)
ALTER TABLE public.project_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "project_questions_all" ON public.project_questions;
-- Intentionally no anon policies on project_questions

-- Progress tables: RPC only
ALTER TABLE public.watch_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "watch_progress_all" ON public.watch_progress;
DROP POLICY IF EXISTS "exam_progress_all" ON public.exam_progress;
DROP POLICY IF EXISTS "Public all watch_progress" ON public.watch_progress;
DROP POLICY IF EXISTS "Public all exam_progress" ON public.exam_progress;

-- site_settings: keep public read
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read site_settings" ON public.site_settings;
CREATE POLICY "public read site_settings" ON public.site_settings FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- 2) Public question view (no answer keys)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_project_questions
WITH (security_invoker = false)
AS
SELECT
  id,
  project_id,
  prompt,
  type,
  options,
  image_url,
  points,
  order_index,
  answer_required
FROM public.project_questions;

GRANT SELECT ON public.public_project_questions TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Candidate RPCs (phone proof)
-- -----------------------------------------------------------------------------
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
      IF SQLERRM = 'invalid_credentials' OR SQLERRM LIKE '%invalid_credentials%' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'เลขบัตรประชาชนหรือเบอร์โทรศัพท์ไม่ถูกต้อง');
      END IF;
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

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

  SELECT * INTO p FROM public.profiles WHERE profile_id = v_id LIMIT 1;
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
BEGIN
  PERFORM set_config('row_security', 'off', true);

  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

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
    position = CASE WHEN patch ? 'position' THEN NULLIF(trim(patch->>'position'), '') ELSE position END,
    duty = CASE WHEN patch ? 'duty' THEN NULLIF(trim(patch->>'duty'), '') ELSE duty END,
    line_id = CASE WHEN patch ? 'line_id' THEN NULLIF(trim(patch->>'line_id'), '') ELSE line_id END,
    email = CASE WHEN patch ? 'email' THEN lower(NULLIF(trim(patch->>'email'), '')) ELSE email END,
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_watch_progress(
  p_profile_id text,
  p_phone text,
  p_video_id text,
  p_watched_seconds integer,
  p_duration_seconds integer,
  p_completed boolean
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
  p := public._verify_profile_phone(p_profile_id, p_phone);

  INSERT INTO public.watch_progress (
    profile_id, video_id, watched_seconds, duration_seconds, completed, updated_at
  ) VALUES (
    p.profile_id,
    trim(p_video_id),
    GREATEST(0, COALESCE(p_watched_seconds, 0)),
    GREATEST(0, COALESCE(p_duration_seconds, 0)),
    COALESCE(p_completed, false),
    now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    watched_seconds = EXCLUDED.watched_seconds,
    duration_seconds = EXCLUDED.duration_seconds,
    completed = EXCLUDED.completed OR public.watch_progress.completed,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'invalid_credentials' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text,
  p_answers jsonb,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_status text := lower(trim(COALESCE(p_status, 'draft')));
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
  existing public.exam_progress;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  IF v_status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง');
  END IF;

  IF v_project IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
  END IF;

  SELECT * INTO existing
  FROM public.exam_progress
  WHERE profile_id = p.profile_id
    AND (project_id = v_project OR project_id IS NULL)
  ORDER BY CASE WHEN project_id = v_project THEN 0 ELSE 1 END
  LIMIT 1;

  IF existing.status::text = 'submitted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้');
  END IF;

  INSERT INTO public.exam_progress (
    profile_id, project_id, answers, status, submitted_at, updated_at
  ) VALUES (
    p.profile_id,
    v_project,
    COALESCE(p_answers, '{}'::jsonb),
    v_status::public.exam_status_enum,
    CASE WHEN v_status = 'submitted' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (profile_id, project_id) DO UPDATE SET
    answers = EXCLUDED.answers,
    status = EXCLUDED.status,
    submitted_at = CASE
      WHEN EXCLUDED.status::text = 'submitted' THEN COALESCE(public.exam_progress.submitted_at, now())
      ELSE public.exam_progress.submitted_at
    END,
    updated_at = now()
  WHERE public.exam_progress.status::text IS DISTINCT FROM 'submitted';

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'invalid_credentials' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  rows jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  SELECT COALESCE(jsonb_agg(to_jsonb(e) - 'id'), '[]'::jsonb)
  INTO rows
  FROM public.exam_progress e
  WHERE e.profile_id = p.profile_id
    AND (
      p_project_id IS NULL
      OR NULLIF(trim(p_project_id), '') IS NULL
      OR e.project_id = trim(p_project_id)
      OR e.project_id IS NULL
    );

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ', 'rows', '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_watch_progress(
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
  rows jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  SELECT COALESCE(jsonb_agg(to_jsonb(w) - 'id'), '[]'::jsonb)
  INTO rows
  FROM public.watch_progress w
  WHERE w.profile_id = p.profile_id;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ', 'rows', '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Admin: bcrypt-only login / change-password
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_login(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_token text;
BEGIN
  SELECT * INTO a
  FROM public.admins
  WHERE username = trim(p_username)
    AND COALESCE(is_active, true) = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  END IF;

  IF a.password_hash IS NULL
     OR length(a.password_hash) <= 20
     OR extensions.crypt(p_password, a.password_hash) IS DISTINCT FROM a.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.admin_sessions (token, admin_id, expires_at)
  VALUES (v_token, a.admin_id, now() + interval '12 hours');

  PERFORM public._write_audit(a.admin_id, 'login', 'admins', a.admin_id::text, null, null);

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'admin', jsonb_build_object(
      'admin_id', a.admin_id,
      'username', a.username,
      'full_name', a.full_name,
      'role', COALESCE(a.role, 'admin'),
      'must_change_password', COALESCE(a.must_change_password, false)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_change_password(
  p_token text,
  p_old_password text,
  p_new_password text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);

  IF length(trim(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF a.password_hash IS NULL
     OR length(a.password_hash) <= 20
     OR extensions.crypt(p_old_password, a.password_hash) IS DISTINCT FROM a.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านเดิมไม่ถูกต้อง');
  END IF;

  UPDATE public.admins
  SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      must_change_password = false,
      updated_at = now()
  WHERE admin_id = a.admin_id;

  PERFORM public._write_audit(a.admin_id, 'change_password', 'admins', a.admin_id::text, null, null);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- One-time: hash any remaining plaintext admin passwords (length heuristic)
UPDATE public.admins
SET
  password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf')),
  must_change_password = true
WHERE password_hash IS NOT NULL
  AND length(password_hash) <= 20;

-- -----------------------------------------------------------------------------
-- 5) Token-gated grading (replace ungated overload)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.grade_project_exams(text);

CREATE OR REPLACE FUNCTION public.grade_project_exams(p_token text, p_project_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_mode text := 'percent';
  v_threshold_value integer := 60;
  v_max_score integer := 0;
  v_count integer := 0;
  v_passed_count integer := 0;
  v_missing integer := 0;
  r_exam RECORD;
  r_q RECORD;
  v_score integer;
  v_user_ans text;
  v_passed boolean;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT COUNT(*) INTO v_missing
  FROM project_questions
  WHERE project_id = p_project_id
    AND COALESCE(points, 1) > 0
    AND (correct_answer IS NULL OR TRIM(correct_answer) = '');

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'missing_answer_keys';
  END IF;

  SELECT
    COALESCE(NULLIF(pass_threshold_mode, ''), 'percent'),
    COALESCE(pass_threshold_value, pass_threshold, 60),
    COALESCE(max_score, 0)
  INTO v_mode, v_threshold_value, v_max_score
  FROM projects
  WHERE id = p_project_id;

  IF v_mode NOT IN ('percent', 'score') THEN
    IF v_threshold_value > 0 AND v_threshold_value <= 10 THEN
      v_mode := 'score';
    ELSE
      v_mode := 'percent';
    END IF;
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO v_max_score
  FROM project_questions
  WHERE project_id = p_project_id
    AND COALESCE(points, 1) > 0;

  IF v_max_score IS NULL OR v_max_score < 1 THEN
    v_max_score := 1;
  END IF;

  FOR r_exam IN
    SELECT profile_id, answers, project_id
    FROM exam_progress
    WHERE status = 'submitted'
      AND (
        project_id = p_project_id
        OR (project_id IS NULL AND p_project_id = 'ict-talent-2026')
      )
  LOOP
    v_score := 0;

    FOR r_q IN
      SELECT id, correct_answer, points
      FROM project_questions
      WHERE project_id = p_project_id
        AND COALESCE(points, 1) > 0
        AND correct_answer IS NOT NULL
        AND TRIM(correct_answer) <> ''
    LOOP
      v_user_ans := r_exam.answers->>r_q.id;
      IF v_user_ans IS NOT NULL AND TRIM(v_user_ans) = TRIM(r_q.correct_answer) THEN
        v_score := v_score + COALESCE(r_q.points, 1);
      END IF;
    END LOOP;

    IF v_mode = 'score' THEN
      v_passed := (v_score >= v_threshold_value);
    ELSE
      v_passed := ((v_score::numeric / v_max_score::numeric) * 100.0 >= v_threshold_value);
    END IF;

    UPDATE exam_progress
    SET score = v_score,
        passed = v_passed,
        graded_at = now(),
        project_id = COALESCE(project_id, p_project_id)
    WHERE profile_id = r_exam.profile_id
      AND (
        project_id = p_project_id
        OR (project_id IS NULL AND p_project_id = 'ict-talent-2026')
      );

    v_count := v_count + 1;
    IF v_passed THEN
      v_passed_count := v_passed_count + 1;
    END IF;
  END LOOP;

  PERFORM public._write_audit(
    a.admin_id,
    'grade_exams',
    'exam_progress',
    p_project_id,
    null,
    jsonb_build_object('graded_total', v_count, 'passed_total', v_passed_count)
  );

  RETURN json_build_object(
    'graded_total', v_count,
    'passed_total', v_passed_count,
    'project_id', p_project_id,
    'pass_threshold_mode', v_mode,
    'pass_threshold_value', v_threshold_value,
    'max_score', v_max_score
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Admin project / question / video / exam-list RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_questions(p_token text, p_project_id text DEFAULT NULL)
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

  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.order_index, q.id), '[]'::jsonb)
  INTO rows
  FROM public.project_questions q
  WHERE p_project_id IS NULL
     OR NULLIF(trim(p_project_id), '') IS NULL
     OR q.project_id = trim(p_project_id);

  RETURN COALESCE(rows, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_project(p_token text, p_project jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_project->>'id', ''));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_project_id');
  END IF;

  INSERT INTO public.projects AS pr (
    id, name, description, is_active, cover_url,
    reg_start, reg_end, reg_enabled,
    exam_start, exam_end, exam_enabled,
    enable_results_visibility,
    pass_threshold_mode, pass_threshold_value, pass_threshold, max_score,
    updated_at
  ) VALUES (
    v_id,
    COALESCE(NULLIF(trim(p_project->>'name'), ''), v_id),
    NULLIF(p_project->>'description', ''),
    COALESCE((p_project->>'is_active')::boolean, true),
    NULLIF(p_project->>'cover_url', ''),
    NULLIF(p_project->>'reg_start', '')::timestamptz,
    NULLIF(p_project->>'reg_end', '')::timestamptz,
    COALESCE((p_project->>'reg_enabled')::boolean, true),
    NULLIF(p_project->>'exam_start', '')::timestamptz,
    NULLIF(p_project->>'exam_end', '')::timestamptz,
    COALESCE((p_project->>'exam_enabled')::boolean, true),
    COALESCE((p_project->>'enable_results_visibility')::boolean, false),
    CASE WHEN p_project->>'pass_threshold_mode' = 'score' THEN 'score' ELSE 'percent' END,
    COALESCE((p_project->>'pass_threshold_value')::integer, (p_project->>'pass_threshold')::integer, 60),
    COALESCE((p_project->>'pass_threshold_value')::integer, (p_project->>'pass_threshold')::integer, 60),
    COALESCE((p_project->>'max_score')::integer, 5),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    cover_url = EXCLUDED.cover_url,
    reg_start = EXCLUDED.reg_start,
    reg_end = EXCLUDED.reg_end,
    reg_enabled = EXCLUDED.reg_enabled,
    exam_start = EXCLUDED.exam_start,
    exam_end = EXCLUDED.exam_end,
    exam_enabled = EXCLUDED.exam_enabled,
    enable_results_visibility = EXCLUDED.enable_results_visibility,
    pass_threshold_mode = EXCLUDED.pass_threshold_mode,
    pass_threshold_value = EXCLUDED.pass_threshold_value,
    pass_threshold = EXCLUDED.pass_threshold,
    max_score = EXCLUDED.max_score,
    updated_at = now();

  PERFORM public._write_audit(a.admin_id, 'upsert_project', 'projects', v_id, null, p_project);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_project(p_token text, p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.project_questions WHERE project_id = trim(p_project_id);
  DELETE FROM public.project_videos WHERE project_id = trim(p_project_id);
  DELETE FROM public.projects WHERE id = trim(p_project_id);
  PERFORM public._write_audit(a.admin_id, 'delete_project', 'projects', p_project_id, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_video(p_token text, p_video jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_video->>'id', ''));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_video_id');
  END IF;

  INSERT INTO public.project_videos (
    id, project_id, title, video_url, video_id, is_mandatory, order_index
  ) VALUES (
    v_id,
    trim(p_video->>'project_id'),
    COALESCE(NULLIF(trim(p_video->>'title'), ''), v_id),
    NULLIF(p_video->>'video_url', ''),
    NULLIF(p_video->>'video_id', ''),
    COALESCE((p_video->>'is_mandatory')::boolean, false),
    COALESCE((p_video->>'order_index')::integer, 0)
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    video_url = EXCLUDED.video_url,
    video_id = EXCLUDED.video_id,
    is_mandatory = EXCLUDED.is_mandatory,
    order_index = EXCLUDED.order_index;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_video(p_token text, p_video_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.project_videos WHERE id = trim(p_video_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_question(p_token text, p_question jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_question->>'id', ''));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_question_id');
  END IF;

  INSERT INTO public.project_questions (
    id, project_id, prompt, type, options, correct_answer, model_answer,
    image_url, points, order_index, answer_required
  ) VALUES (
    v_id,
    trim(p_question->>'project_id'),
    COALESCE(p_question->>'prompt', ''),
    COALESCE(NULLIF(p_question->>'type', ''), 'mcq'),
    COALESCE(p_question->'options', '[]'::jsonb),
    NULLIF(p_question->>'correct_answer', ''),
    NULLIF(p_question->>'model_answer', ''),
    NULLIF(p_question->>'image_url', ''),
    COALESCE((p_question->>'points')::integer, 1),
    COALESCE((p_question->>'order_index')::integer, 0),
    COALESCE((p_question->>'answer_required')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    prompt = EXCLUDED.prompt,
    type = EXCLUDED.type,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    model_answer = EXCLUDED.model_answer,
    image_url = EXCLUDED.image_url,
    points = EXCLUDED.points,
    order_index = EXCLUDED.order_index,
    answer_required = EXCLUDED.answer_required;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_question(p_token text, p_question_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.project_questions WHERE id = trim(p_question_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

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
    'answers', e.answers,
    'status', e.status,
    'score', e.score,
    'passed', e.passed,
    'graded_at', e.graded_at,
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

-- -----------------------------------------------------------------------------
-- 7) GRANTs
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.login_profile(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_registration_check(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_watch_progress(text, text, text, integer, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_exam_progress(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_watch_progress(text, text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.grade_project_exams(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_questions(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_project(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_project(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_video(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_video(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_question(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_question(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_exam_progress(text, text[], text) TO anon, authenticated;

-- Harden: helpers stay internal; GRANT EXECUTE to postgres for definer chain
REVOKE ALL ON FUNCTION public._verify_profile_phone(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._profile_to_json(public.profiles) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._verify_profile_phone(text, text) TO postgres;
GRANT EXECUTE ON FUNCTION public._profile_to_json(public.profiles) TO postgres;
GRANT EXECUTE ON FUNCTION public._digits_only(text) TO anon, authenticated, postgres;
GRANT EXECUTE ON FUNCTION public._normalize_phone(text) TO anon, authenticated, postgres;
GRANT EXECUTE ON FUNCTION public._phones_match(text, text) TO anon, authenticated, postgres;

NOTIFY pgrst, 'reload schema';
