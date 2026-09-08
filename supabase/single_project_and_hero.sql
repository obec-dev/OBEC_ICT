-- Single-site refinements: question images, hero copy, % pass threshold, unlock + search RPCs

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project_questions' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE project_questions ADD COLUMN image_url text;
  END IF;
END $$;

INSERT INTO site_settings (key, value) VALUES
  ('hero_badge', '"คัดเลือกตัวแทน ICT Talent ประจำโรงเรียน"'::jsonb),
  ('hero_title_line1', '"ตัวแทน ICT Talent"'::jsonb),
  ('hero_title_line2', '"ประจำโรงเรียน"'::jsonb),
  ('hero_description', '"แพลตฟอร์มลงทะเบียน เรียนรู้ และสอบคัดเลือกผู้แทนเทคโนโลยีสารสนเทศของโรงเรียน ครอบคลุมเขตพื้นที่การศึกษาทั่วประเทศ"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Migrate tiny absolute thresholds (e.g. 3/5) toward percentage default
UPDATE projects
SET pass_threshold = 60
WHERE pass_threshold IS NOT NULL AND pass_threshold > 0 AND pass_threshold <= 10;

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

CREATE OR REPLACE FUNCTION public.admin_search_profiles(
  p_token text,
  p_query text,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  q text := TRIM(COALESCE(p_query, ''));
BEGIN
  a := public._admin_from_token(p_token);

  IF length(q) < 1 THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', t.profile_id,
      'school_id', t.school_id,
      'school_name', t.school_name,
      'first_name', t.first_name,
      'last_name', t.last_name,
      'phone', t.phone,
      'remark', t.remark,
      'created_at', t.created_at
    ))
    FROM (
      SELECT
        p.profile_id,
        p.school_id,
        s.school_name,
        p.first_name,
        p.last_name,
        p.phone,
        p.remark,
        p.created_at
      FROM profiles p
      LEFT JOIN schools s ON s.school_id = p.school_id
      WHERE p.profile_id ILIKE '%' || q || '%'
         OR p.school_id ILIKE '%' || q || '%'
         OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
         OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
         OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
         OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.grade_project_exams(p_project_id text)
RETURNS json AS $$
DECLARE
  v_pass_threshold integer := 60;
  v_max_score integer := 0;
  v_pass_score integer := 0;
  v_count integer := 0;
  v_passed_count integer := 0;
  r_exam RECORD;
  r_q RECORD;
  v_score integer;
  v_user_ans text;
BEGIN
  SELECT COALESCE(pass_threshold, 60), COALESCE(max_score, 0)
  INTO v_pass_threshold, v_max_score
  FROM projects
  WHERE id = p_project_id;

  SELECT COALESCE(SUM(points), v_max_score) INTO v_max_score
  FROM project_questions
  WHERE project_id = p_project_id;

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
      WHERE project_id = p_project_id AND correct_answer IS NOT NULL
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.admin_unlock_exam(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_profiles(text, text, integer) TO anon, authenticated, service_role;
