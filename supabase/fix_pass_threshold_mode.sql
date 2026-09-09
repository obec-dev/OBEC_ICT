-- Pass threshold mode: percent (%) vs absolute score
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'pass_threshold_mode'
  ) THEN
    ALTER TABLE projects ADD COLUMN pass_threshold_mode text NOT NULL DEFAULT 'percent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'pass_threshold_value'
  ) THEN
    ALTER TABLE projects ADD COLUMN pass_threshold_value integer;
  END IF;
END $$;

-- Backfill from legacy pass_threshold (≤10 treated as absolute score)
UPDATE projects
SET
  pass_threshold_mode = CASE
    WHEN pass_threshold IS NOT NULL AND pass_threshold > 0 AND pass_threshold <= 10 THEN 'score'
    ELSE COALESCE(NULLIF(pass_threshold_mode, ''), 'percent')
  END,
  pass_threshold_value = COALESCE(pass_threshold_value, pass_threshold, 60)
WHERE pass_threshold_value IS NULL
   OR pass_threshold_mode IS NULL
   OR pass_threshold_mode = '';

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_pass_threshold_mode_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_pass_threshold_mode_check
  CHECK (pass_threshold_mode IN ('percent', 'score'));

-- Keep pass_threshold mirrored for older clients
UPDATE projects
SET pass_threshold = pass_threshold_value
WHERE pass_threshold IS DISTINCT FROM pass_threshold_value
  AND pass_threshold_value IS NOT NULL;

CREATE OR REPLACE FUNCTION public.grade_project_exams(p_project_id text)
RETURNS json AS $$
DECLARE
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

  -- Legacy fallback when mode column empty / old rows
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

  RETURN json_build_object(
    'graded_total', v_count,
    'passed_total', v_passed_count,
    'project_id', p_project_id,
    'pass_threshold_mode', v_mode,
    'pass_threshold_value', v_threshold_value,
    'max_score', v_max_score
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
