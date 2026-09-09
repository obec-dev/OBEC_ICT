-- Fix exam_progress status enum cast in upsert_exam_progress
-- Run in Supabase SQL Editor

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
  v_status_enum public.exam_status_enum;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  IF v_status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง');
  END IF;

  BEGIN
    v_status_enum := v_status::public.exam_status_enum;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง');
  END;

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
    v_status_enum,
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
  IF SQLERRM LIKE '%invalid_credentials%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
