-- Fix PostgREST ambiguity on upsert_exam_progress when saving drafts.
-- NON-DESTRUCTIVE to data: only drops the legacy 5-arg overload.
-- Keep the 6-arg function (with optional p_lesson_submissions).

-- Drop the 5-arg wrapper that collides when clients omit p_lesson_submissions
DROP FUNCTION IF EXISTS public.upsert_exam_progress(text, text, text, jsonb, text);

-- Ensure single canonical implementation (6-arg, default NULL for lessons)
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
  v_key text;
  v_val jsonb;
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

  v_lessons := COALESCE(existing.lesson_submissions, '{}'::jsonb);

  IF p_lesson_submissions IS NOT NULL AND jsonb_typeof(p_lesson_submissions) = 'object' THEN
    FOR v_key, v_val IN
      SELECT key, value FROM jsonb_each(p_lesson_submissions)
    LOOP
      IF COALESCE(v_lessons -> v_key ->> 'status', '') = 'submitted' THEN
        CONTINUE;
      END IF;
      IF COALESCE(v_val ->> 'status', '') = 'submitted' THEN
        v_lessons := jsonb_set(
          v_lessons,
          ARRAY[v_key],
          jsonb_build_object(
            'status', 'submitted',
            'submitted_at', COALESCE(
              v_val ->> 'submitted_at',
              to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
          ),
          true
        );
      END IF;
    END LOOP;
  END IF;

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
  WHERE public.exam_progress.profile_id = p.profile_id
    AND public.exam_progress.status::text IS DISTINCT FROM 'submitted';

  RETURN jsonb_build_object('ok', true, 'profile_id', p.profile_id, 'project_id', v_project);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'invalid_credentials' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  IF SQLERRM = 'account_suspended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text, jsonb)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
