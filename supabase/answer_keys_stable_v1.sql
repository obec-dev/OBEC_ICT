-- Stable answer keys: bind to question id / permanent question_code.
-- Display order can change without moving a stored key.
-- Run in the Supabase SQL Editor after identity_exam_sections_v1.sql.
-- Question codes in this file are superseded by question_code_q001_v1.sql.
-- Do not re-run this file after that script, or it will replace Q001 codes.

ALTER TABLE public.project_questions
  ADD COLUMN IF NOT EXISTS question_code text;

CREATE OR REPLACE FUNCTION public.project_questions_assign_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_base text;
  v_code text;
  n int := 8;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.question_code IS NOT NULL AND btrim(OLD.question_code) <> '' THEN
    NEW.question_code := OLD.question_code;
    RETURN NEW;
  END IF;

  IF NEW.question_code IS NOT NULL AND btrim(NEW.question_code) <> '' THEN
    NEW.question_code := btrim(NEW.question_code);
    RETURN NEW;
  END IF;

  v_base := upper(replace(COALESCE(NEW.id, gen_random_uuid()::text), '-', ''));
  LOOP
    v_code := 'Q' || substr(v_base, 1, n);
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.project_questions
      WHERE project_id = NEW.project_id
        AND lower(question_code) = lower(v_code)
        AND id <> NEW.id
    );
    n := n + 2;
    IF n > length(v_base) THEN
      v_code := 'Q' || v_base;
      EXIT;
    END IF;
  END LOOP;

  NEW.question_code := v_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_questions_assign_code_trg ON public.project_questions;
CREATE TRIGGER project_questions_assign_code_trg
  BEFORE INSERT OR UPDATE ON public.project_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.project_questions_assign_code();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.project_questions
    WHERE question_code IS NULL OR btrim(question_code) = ''
    ORDER BY id
  LOOP
    UPDATE public.project_questions
    SET prompt = prompt
    WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS project_questions_code_uidx
  ON public.project_questions (project_id, lower(question_code));

-- Writes correct_answer by question id only. Does not touch order or section.
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
    v_answer := btrim(COALESCE(item->>'correct_answer', ''));
    IF v_id = '' OR v_answer = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'เฉลยต้องระบุ question_id และคำตอบ');
    END IF;
    IF v_id ~ '^[0-9]{1,4}$' OR v_id ~* '^q(uestion)?[0-9]{1,4}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ห้ามบันทึกเฉลยด้วยเลขลำดับข้อ');
    END IF;

    UPDATE public.project_questions
    SET correct_answer = v_answer
    WHERE id = v_id
      AND project_id = btrim(p_project_id);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', format('ไม่พบ question_id %s ในโครงการนี้', v_id));
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

CREATE OR REPLACE FUNCTION public.exam_answer_matches(
  p_type text,
  p_options jsonb,
  p_key text,
  p_user text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key text := btrim(COALESCE(p_key, ''));
  v_user text := btrim(COALESCE(p_user, ''));
  v_opt text;
  v_idx integer;
  v_len integer;
  v_letter integer;
BEGIN
  IF v_key = '' OR v_user = '' THEN
    RETURN false;
  END IF;
  IF v_key = v_user THEN
    RETURN true;
  END IF;
  IF COALESCE(p_type, '') <> 'mcq'
     OR p_options IS NULL
     OR jsonb_typeof(p_options) <> 'array' THEN
    RETURN false;
  END IF;

  v_len := jsonb_array_length(p_options);
  IF v_len < 1 THEN
    RETURN false;
  END IF;

  IF v_key ~ '^[0-9]+$' THEN
    v_idx := v_key::integer;
    IF v_idx BETWEEN 1 AND v_len THEN
      v_opt := btrim(COALESCE(p_options->>(v_idx - 1), ''));
      IF v_opt <> '' AND v_opt = v_user THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  IF v_user ~ '^[0-9]+$' THEN
    v_idx := v_user::integer;
    IF v_idx BETWEEN 1 AND v_len THEN
      v_opt := btrim(COALESCE(p_options->>(v_idx - 1), ''));
      IF v_opt <> '' AND v_opt = v_key THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  IF v_key ~ '^[A-Za-z]$' THEN
    v_letter := ascii(upper(v_key)) - 64;
    IF v_letter BETWEEN 1 AND v_len THEN
      v_opt := btrim(COALESCE(p_options->>(v_letter - 1), ''));
      IF v_opt <> '' AND (v_opt = v_user OR (v_user ~ '^[0-9]+$' AND v_user::integer = v_letter)) THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  IF v_user ~ '^[A-Za-z]$' THEN
    v_letter := ascii(upper(v_user)) - 64;
    IF v_letter BETWEEN 1 AND v_len THEN
      v_opt := btrim(COALESCE(p_options->>(v_letter - 1), ''));
      IF v_opt <> '' AND v_opt = v_key THEN
        RETURN true;
      END IF;
    END IF;
  END IF;

  RETURN false;
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

GRANT EXECUTE ON FUNCTION public.admin_set_answer_keys(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grade_project_exams(text, text) TO anon, authenticated;
