-- Master project status (active/inactive) + per-project exam progress uniqueness

-- 1. projects.is_active master switch
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE projects ADD COLUMN is_active boolean DEFAULT true NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'cover_url'
  ) THEN
    ALTER TABLE projects ADD COLUMN cover_url text;
  END IF;
END $$;

UPDATE projects SET is_active = true WHERE is_active IS NULL;

-- 2. Allow one exam_progress row per (profile, project)
DO $$
DECLARE
  con_name text;
BEGIN
  -- Drop legacy UNIQUE(profile_id) if present
  FOR con_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'exam_progress'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%profile_id%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%project_id%'
  LOOP
    EXECUTE format('ALTER TABLE exam_progress DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

-- Ensure project_id exists (idempotent with projects_schema.sql)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exam_progress' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE exam_progress ADD COLUMN project_id text REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill null project_id to default project when possible
UPDATE exam_progress
SET project_id = 'ict-talent-2026'
WHERE project_id IS NULL
  AND EXISTS (SELECT 1 FROM projects WHERE id = 'ict-talent-2026');

-- Unique pair for upsert onConflict: profile_id,project_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_progress_profile_project_unique'
  ) THEN
    -- Collapse duplicates before adding constraint
    DELETE FROM exam_progress a
    USING exam_progress b
    WHERE a.ctid < b.ctid
      AND a.profile_id = b.profile_id
      AND a.project_id IS NOT DISTINCT FROM b.project_id;

    ALTER TABLE exam_progress
      ADD CONSTRAINT exam_progress_profile_project_unique UNIQUE (profile_id, project_id);
  END IF;
END $$;

-- Keep grade RPC aligned with per-project rows
CREATE OR REPLACE FUNCTION public.grade_project_exams(p_project_id text)
RETURNS json AS $$
DECLARE
  v_pass_threshold integer := 3;
  v_count integer := 0;
  v_passed_count integer := 0;
  r_exam RECORD;
  r_q RECORD;
  v_score integer;
  v_user_ans text;
BEGIN
  SELECT COALESCE(pass_threshold, 3) INTO v_pass_threshold
  FROM projects
  WHERE id = p_project_id;

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
      WHERE project_id = p_project_id AND correct_answer IS NOT NULL
    LOOP
      v_user_ans := r_exam.answers->>r_q.id;
      IF v_user_ans IS NOT NULL AND TRIM(v_user_ans) = TRIM(r_q.correct_answer) THEN
        v_score := v_score + COALESCE(r_q.points, 1);
      END IF;
    END LOOP;

    UPDATE exam_progress
    SET score = v_score,
        passed = (v_score >= v_pass_threshold),
        graded_at = now(),
        project_id = COALESCE(project_id, p_project_id)
    WHERE profile_id = r_exam.profile_id
      AND (
        project_id = p_project_id
        OR (project_id IS NULL AND p_project_id = 'ict-talent-2026')
      );

    v_count := v_count + 1;
    IF v_score >= v_pass_threshold THEN
      v_passed_count := v_passed_count + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'graded_total', v_count,
    'passed_total', v_passed_count,
    'project_id', p_project_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
