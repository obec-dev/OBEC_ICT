-- Per-lesson exam submissions (run in Supabase SQL editor)
-- Stores independent submit state per exam section / lesson without breaking answers.

ALTER TABLE public.exam_progress
  ADD COLUMN IF NOT EXISTS lesson_submissions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.exam_progress.lesson_submissions IS
  'Map of section_id -> { status: submitted, submitted_at: timestamptz }. Overall status becomes submitted when all lessons are submitted.';

CREATE OR REPLACE FUNCTION public.upsert_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text,
  p_answers jsonb,
  p_status text,
  p_lesson_submissions jsonb DEFAULT NULL
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
  v_lessons jsonb;
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

  v_lessons := COALESCE(p_lesson_submissions, existing.lesson_submissions, '{}'::jsonb);

  INSERT INTO public.exam_progress (
    profile_id, project_id, answers, status, lesson_submissions, submitted_at, updated_at
  ) VALUES (
    p.profile_id,
    v_project,
    COALESCE(p_answers, '{}'::jsonb),
    v_status::public.exam_status_enum,
    v_lessons,
    CASE WHEN v_status = 'submitted' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (profile_id, project_id) DO UPDATE SET
    answers = EXCLUDED.answers,
    status = EXCLUDED.status,
    lesson_submissions = EXCLUDED.lesson_submissions,
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

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text, jsonb) TO anon, authenticated;

-- Keep 5-arg overload for older clients (lesson_submissions unchanged on draft save without param).
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
BEGIN
  RETURN public.upsert_exam_progress(
    p_profile_id,
    p_phone,
    p_project_id,
    p_answers,
    p_status,
    NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text) TO anon, authenticated;

-- Clear per-lesson locks when admin unlocks an exam
CREATE OR REPLACE FUNCTION public.admin_unlock_exam(
  p_token text,
  p_profile_id text,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_project text;
  updated_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);

  v_project := COALESCE(
    NULLIF(TRIM(COALESCE(p_project_id, '')), ''),
    (SELECT id FROM projects ORDER BY created_at ASC LIMIT 1)
  );

  UPDATE exam_progress
  SET status = 'draft',
      lesson_submissions = '{}'::jsonb,
      score = NULL,
      passed = NULL,
      graded_at = NULL,
      submitted_at = NULL,
      updated_at = now(),
      project_id = COALESCE(project_id, v_project)
  WHERE profile_id = p_profile_id
    AND (project_id = v_project OR project_id IS NULL);

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  PERFORM public._write_audit(
    a.admin_id,
    'unlock_exam',
    'exam_progress',
    p_profile_id,
    NULL,
    jsonb_build_object('project_id', v_project, 'updated', updated_count)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'updated', updated_count,
    'profile_id', p_profile_id,
    'project_id', v_project
  );
END;
$$;

-- Admin list must return per-lesson submit state (overall status may still be draft).
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
    'lesson_submissions', COALESCE(e.lesson_submissions, '{}'::jsonb),
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

GRANT EXECUTE ON FUNCTION public.admin_list_exam_progress(text, text[], text) TO anon, authenticated;
