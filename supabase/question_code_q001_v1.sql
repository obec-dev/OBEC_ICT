-- Permanent question codes as Q001, Q002, ... and optional answer keys.
-- Run in the Supabase SQL Editor after identity_exam_sections_v1.sql.
-- Safe to re-run. Existing Q001-style codes are kept so reordering never
-- renumbers them. Only missing or non-standard codes are backfilled.

ALTER TABLE public.project_questions
  ADD COLUMN IF NOT EXISTS question_code text;

DROP TRIGGER IF EXISTS project_questions_assign_code_trg ON public.project_questions;
DROP INDEX IF EXISTS public.project_questions_code_uidx;

UPDATE public.project_questions
SET question_code = NULL
WHERE question_code IS NULL
   OR btrim(question_code) = ''
   OR question_code !~ '^Q[0-9]{3,4}$';

DO $$
DECLARE
  r record;
  v_project text := '';
  n integer := 0;
BEGIN
  FOR r IN
    SELECT q.id, q.project_id
    FROM public.project_questions q
    LEFT JOIN public.exam_sections s ON s.id = q.section_id
    WHERE q.question_code IS NULL
    ORDER BY q.project_id,
             COALESCE(s.section_order, 9999),
             q.order_index NULLS LAST,
             q.created_at NULLS LAST,
             q.id
  LOOP
    IF r.project_id IS DISTINCT FROM v_project THEN
      v_project := r.project_id;
      SELECT COALESCE(MAX((substring(question_code FROM '^Q([0-9]+)$'))::integer), 0)
      INTO n
      FROM public.project_questions
      WHERE project_id = r.project_id
        AND question_code ~ '^Q[0-9]{3,4}$';
    END IF;
    n := n + 1;
    UPDATE public.project_questions
    SET question_code = 'Q' || lpad(n::text, 3, '0')
    WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS project_questions_code_uidx
  ON public.project_questions (project_id, upper(question_code));

CREATE OR REPLACE FUNCTION public.project_questions_assign_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_next integer;
  v_code text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.question_code IS NOT NULL
     AND OLD.question_code ~ '^Q[0-9]+$' THEN
    NEW.question_code := OLD.question_code;
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX((substring(question_code FROM '^Q([0-9]+)$'))::integer), 0)
  INTO v_next
  FROM public.project_questions
  WHERE project_id = NEW.project_id
    AND id IS DISTINCT FROM NEW.id;

  LOOP
    v_next := v_next + 1;
    v_code := 'Q' || lpad(v_next::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.project_questions
      WHERE project_id = NEW.project_id
        AND upper(question_code) = upper(v_code)
        AND id IS DISTINCT FROM NEW.id
    );
  END LOOP;

  NEW.question_code := v_code;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_questions_assign_code_trg
  BEFORE INSERT OR UPDATE ON public.project_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.project_questions_assign_code();

CREATE OR REPLACE FUNCTION public.admin_upsert_question(p_token text, p_question jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_question->>'id', ''));
  v_section text := NULLIF(trim(COALESCE(p_question->>'section_id', '')), '');
  v_code text;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_question_id');
  END IF;

  IF v_section IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_sections WHERE id = v_section
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบส่วนข้อสอบที่เลือก');
  END IF;

  INSERT INTO public.project_questions (
    id, project_id, prompt, type, options, correct_answer, model_answer,
    image_url, points, order_index, answer_required, section_id
  ) VALUES (
    v_id,
    trim(p_question->>'project_id'),
    COALESCE(p_question->>'prompt', ''),
    COALESCE(NULLIF(p_question->>'type', ''), 'mcq'),
    COALESCE(p_question->'options', '[]'::jsonb),
    NULLIF(btrim(COALESCE(p_question->>'correct_answer', '')), ''),
    NULLIF(p_question->>'model_answer', ''),
    NULLIF(p_question->>'image_url', ''),
    COALESCE((p_question->>'points')::integer, 1),
    COALESCE((p_question->>'order_index')::integer, 0),
    COALESCE((p_question->>'answer_required')::boolean, true),
    v_section
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
    answer_required = EXCLUDED.answer_required,
    section_id = EXCLUDED.section_id;

  SELECT question_code INTO v_code
  FROM public.project_questions
  WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'question_code', v_code);
END;
$$;

-- Blank correct_answer clears the key. Questions may be saved without one.
CREATE OR REPLACE FUNCTION public.admin_set_answer_keys(
  p_token text,
  p_project_id text,
  p_keys jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  item jsonb;
  v_id text;
  v_code text;
  v_answer text;
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  IF p_keys IS NULL OR jsonb_typeof(p_keys) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รูปแบบเฉลยไม่ถูกต้อง');
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_keys)
  LOOP
    v_id := btrim(COALESCE(item->>'question_id', ''));
    v_code := upper(btrim(COALESCE(item->>'question_code', '')));
    v_answer := NULLIF(btrim(COALESCE(item->>'correct_answer', '')), '');

    IF v_id ~* '^Q[0-9]+$' THEN
      v_code := upper(v_id);
      v_id := '';
    END IF;
    IF v_id ~ '^[0-9]{1,4}$' OR v_code ~ '^[0-9]{1,4}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ห้ามบันทึกเฉลยด้วยเลขลำดับข้อ ให้ใช้ question_id หรือรหัส Q001');
    END IF;

    IF v_id = '' AND v_code <> '' THEN
      SELECT id INTO v_id
      FROM public.project_questions
      WHERE project_id = btrim(p_project_id)
        AND upper(question_code) = v_code;
    END IF;

    IF v_id = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'เฉลยต้องระบุ question_id หรือ question_code');
    END IF;

    UPDATE public.project_questions
    SET correct_answer = v_answer
    WHERE id = v_id
      AND project_id = btrim(p_project_id);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', format('ไม่พบข้อสอบ %s ในโครงการนี้', COALESCE(NULLIF(v_code, ''), v_id)));
    END IF;
    v_count := v_count + 1;
  END LOOP;

  PERFORM public._write_audit(
    a.admin_id,
    'set_answer_keys',
    'project_questions',
    btrim(p_project_id),
    null,
    jsonb_build_object('updated', v_count)
  );

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;

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
  v_pending integer := 0;
  r_exam RECORD;
  r_q RECORD;
  v_score integer;
  v_user_ans text;
  v_passed boolean;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT COUNT(*) INTO v_pending
  FROM project_questions
  WHERE project_id = p_project_id
    AND COALESCE(points, 1) > 0
    AND (correct_answer IS NULL OR TRIM(correct_answer) = '');

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
    AND COALESCE(points, 1) > 0
    AND correct_answer IS NOT NULL
    AND TRIM(correct_answer) <> '';

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
      SELECT id, correct_answer, points, type, options
      FROM project_questions
      WHERE project_id = p_project_id
        AND COALESCE(points, 1) > 0
        AND correct_answer IS NOT NULL
        AND TRIM(correct_answer) <> ''
    LOOP
      v_user_ans := r_exam.answers->>r_q.id;
      IF v_user_ans IS NOT NULL
         AND public.exam_answer_matches(r_q.type, r_q.options, r_q.correct_answer, v_user_ans) THEN
        v_score := v_score + COALESCE(r_q.points, 1);
      END IF;
    END LOOP;

    IF v_max_score < 1 THEN
      v_passed := false;
    ELSIF v_mode = 'score' THEN
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
    jsonb_build_object(
      'graded_total', v_count,
      'passed_total', v_passed_count,
      'pending_keys', v_pending
    )
  );

  RETURN json_build_object(
    'graded_total', v_count,
    'passed_total', v_passed_count,
    'pending_keys', v_pending,
    'project_id', p_project_id,
    'pass_threshold_mode', v_mode,
    'pass_threshold_value', v_threshold_value,
    'max_score', v_max_score
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_question(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_answer_keys(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grade_project_exams(text, text) TO anon, authenticated;
