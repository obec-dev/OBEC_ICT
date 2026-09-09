-- Publish Test Results master toggle for candidates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'enable_results_visibility'
  ) THEN
    ALTER TABLE projects ADD COLUMN enable_results_visibility boolean DEFAULT false NOT NULL;
  END IF;
END $$;

UPDATE projects SET enable_results_visibility = false WHERE enable_results_visibility IS NULL;

-- Grade only questions with points > 0; ignore survey/0-point items in max score
CREATE OR REPLACE FUNCTION public.grade_project_exams(p_project_id text)
RETURNS json AS $$
DECLARE
  v_pass_threshold integer := 60;
  v_max_score integer := 0;
  v_pass_score integer := 0;
  v_count integer := 0;
  v_passed_count integer := 0;
  v_missing integer := 0;
  r_exam RECORD;
  r_q RECORD;
  v_score integer;
  v_user_ans text;
BEGIN
  -- Abort if any scored question is missing an answer key
  SELECT COUNT(*) INTO v_missing
  FROM project_questions
  WHERE project_id = p_project_id
    AND COALESCE(points, 1) > 0
    AND (correct_answer IS NULL OR TRIM(correct_answer) = '');

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'missing_answer_keys';
  END IF;

  SELECT COALESCE(pass_threshold, 60), COALESCE(max_score, 0)
  INTO v_pass_threshold, v_max_score
  FROM projects
  WHERE id = p_project_id;

  SELECT COALESCE(SUM(points), 0) INTO v_max_score
  FROM project_questions
  WHERE project_id = p_project_id
    AND COALESCE(points, 1) > 0;

  IF v_max_score IS NULL OR v_max_score < 1 THEN
    v_max_score := 1;
  END IF;

  IF v_pass_threshold <= 10 THEN
    v_pass_score := v_pass_threshold;
  ELSE
    v_pass_score := CEIL(v_max_score * GREATEST(0, LEAST(v_pass_threshold, 100)) / 100.0);
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

    UPDATE exam_progress
    SET score = v_score,
        passed = (v_score >= v_pass_score),
        graded_at = now(),
        project_id = COALESCE(project_id, p_project_id)
    WHERE profile_id = r_exam.profile_id
      AND (
        project_id = p_project_id
        OR (project_id IS NULL AND p_project_id = 'ict-talent-2026')
      );

    v_count := v_count + 1;
    IF v_score >= v_pass_score THEN
      v_passed_count := v_passed_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'graded_total', v_count,
    'passed_total', v_passed_count,
    'project_id', p_project_id,
    'pass_score', v_pass_score
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
