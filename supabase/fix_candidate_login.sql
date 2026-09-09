-- Fix candidate login after harden_security_v1
-- Cause: SECURITY DEFINER helpers still hit RLS on profiles → login always fails.
-- Run in Supabase SQL Editor, then retry candidate login.

CREATE OR REPLACE FUNCTION public._digits_only(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(COALESCE(t, ''), '\D', '', 'g');
$$;

-- Normalize Thai mobiles: 0812345678 / 66xxxxxxxxx / dashed → last 9 digits
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
  -- Critical: allow this definer function to read profiles despite locked RLS
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
  IF SQLERRM LIKE '%invalid_credentials%' THEN
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

  IF existing.status = 'submitted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้');
  END IF;

  INSERT INTO public.exam_progress (
    profile_id, project_id, answers, status, submitted_at, updated_at
  ) VALUES (
    p.profile_id,
    v_project,
    COALESCE(p_answers, '{}'::jsonb),
    v_status,
    CASE WHEN v_status = 'submitted' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (profile_id, project_id) DO UPDATE SET
    answers = EXCLUDED.answers,
    status = EXCLUDED.status,
    submitted_at = CASE
      WHEN EXCLUDED.status = 'submitted' THEN COALESCE(public.exam_progress.submitted_at, now())
      ELSE public.exam_progress.submitted_at
    END,
    updated_at = now()
  WHERE public.exam_progress.status IS DISTINCT FROM 'submitted';

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%invalid_credentials%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_profile(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_registration_check(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_watch_progress(text, text, text, integer, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._verify_profile_phone(text, text) TO postgres;
GRANT EXECUTE ON FUNCTION public._profile_to_json(public.profiles) TO postgres;
GRANT EXECUTE ON FUNCTION public._digits_only(text) TO anon, authenticated, postgres;
GRANT EXECUTE ON FUNCTION public._normalize_phone(text) TO anon, authenticated, postgres;
GRANT EXECUTE ON FUNCTION public._phones_match(text, text) TO anon, authenticated, postgres;

NOTIFY pgrst, 'reload schema';
