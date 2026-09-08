-- Supabase Schema Update: Project Management, Answer Key Security, Video/Question Persistence & Manual Exam Grading

-- 1. Table: Projects (Subjects/Courses with Schedule & Grading Config)
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, -- Project ID e.g. 'ict-talent-2026'
  name text NOT NULL,
  description text,
  reg_start timestamp with time zone,
  reg_end timestamp with time zone,
  reg_enabled boolean DEFAULT true,
  exam_start timestamp with time zone,
  exam_end timestamp with time zone,
  exam_enabled boolean DEFAULT true,
  pass_threshold integer DEFAULT 3, -- Passing score threshold
  max_score integer DEFAULT 5, -- Max score for the project
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 2. Table: Project Videos
CREATE TABLE IF NOT EXISTS project_videos (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  video_url text NOT NULL,
  video_id text NOT NULL,
  is_mandatory boolean DEFAULT false,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- 3. Table: Project Questions (Exam Builder & Answer Keys)
CREATE TABLE IF NOT EXISTS project_questions (
  id text PRIMARY KEY,
  project_id text REFERENCES projects(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  type text NOT NULL CHECK (type IN ('mcq', 'open_ended')),
  options jsonb DEFAULT '[]'::jsonb, -- Array of string options for MCQ
  correct_answer text, -- Secure answer key (stored DB-side only)
  model_answer text, -- Model answer guidance for open-ended
  points integer DEFAULT 1, -- Score points for the question
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Migrations & Type Adjustments
DO $$
BEGIN
  -- Alter id column to text if pre-existing as uuid
  BEGIN
    ALTER TABLE project_videos ALTER COLUMN id TYPE text USING id::text;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE project_questions ALTER COLUMN id TYPE text USING id::text;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  -- Check and add new columns to projects if pre-existing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'reg_start') THEN
    ALTER TABLE projects ADD COLUMN reg_start timestamp with time zone;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'reg_end') THEN
    ALTER TABLE projects ADD COLUMN reg_end timestamp with time zone;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'reg_enabled') THEN
    ALTER TABLE projects ADD COLUMN reg_enabled boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'exam_start') THEN
    ALTER TABLE projects ADD COLUMN exam_start timestamp with time zone;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'exam_end') THEN
    ALTER TABLE projects ADD COLUMN exam_end timestamp with time zone;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'exam_enabled') THEN
    ALTER TABLE projects ADD COLUMN exam_enabled boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'pass_threshold') THEN
    ALTER TABLE projects ADD COLUMN pass_threshold integer DEFAULT 3;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'max_score') THEN
    ALTER TABLE projects ADD COLUMN max_score integer DEFAULT 5;
  END IF;

  -- Check and add new columns to watch_progress and exam_progress
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'watch_progress' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE watch_progress ADD COLUMN project_id text REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'exam_progress' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE exam_progress ADD COLUMN project_id text REFERENCES projects(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'exam_progress' AND column_name = 'score'
  ) THEN
    ALTER TABLE exam_progress ADD COLUMN score integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'exam_progress' AND column_name = 'passed'
  ) THEN
    ALTER TABLE exam_progress ADD COLUMN passed boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'exam_progress' AND column_name = 'graded_at'
  ) THEN
    ALTER TABLE exam_progress ADD COLUMN graded_at timestamp with time zone;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_questions ENABLE ROW LEVEL SECURITY;

-- Full CRUD policies for projects, project_videos, and project_questions
DROP POLICY IF EXISTS "projects_select_all" ON projects;
DROP POLICY IF EXISTS "projects_all" ON projects;
CREATE POLICY "projects_all" ON projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "project_videos_select_all" ON project_videos;
DROP POLICY IF EXISTS "project_videos_all" ON project_videos;
CREATE POLICY "project_videos_all" ON project_videos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "project_questions_select_all" ON project_questions;
DROP POLICY IF EXISTS "project_questions_all" ON project_questions;
CREATE POLICY "project_questions_all" ON project_questions FOR ALL USING (true) WITH CHECK (true);

-- Backend RPC function to grade candidate exams against stored answer keys securely
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
  -- Get project pass threshold
  SELECT COALESCE(pass_threshold, 3) INTO v_pass_threshold
  FROM projects
  WHERE id = p_project_id;

  -- Loop through all submitted exam_progress rows for the target project
  FOR r_exam IN 
    SELECT profile_id, answers 
    FROM exam_progress 
    WHERE (project_id = p_project_id OR p_project_id = 'ict-talent-2026') 
      AND status = 'submitted'
  LOOP
    v_score := 0;
    
    -- Evaluate score for each question in this project
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

    -- Update candidate exam record with score and passed status
    UPDATE exam_progress
    SET score = v_score,
        passed = (v_score >= v_pass_threshold),
        graded_at = now()
    WHERE profile_id = r_exam.profile_id 
      AND (project_id = p_project_id OR p_project_id = 'ict-talent-2026');

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

-- Initial Seed Data
INSERT INTO projects (id, name, description, pass_threshold, max_score)
VALUES (
  'ict-talent-2026',
  'โครงการพัฒนาศักยภาพตัวแทน ICT Talent 2026',
  'บทเรียนออนไลน์และแบบทดสอบสำหรับครูและบุคลากรตัวแทน ICT Talent',
  3,
  5
)
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO project_videos (id, project_id, title, video_url, video_id, is_mandatory, order_index)
VALUES 
(
  'vid-1',
  'ict-talent-2026',
  'บทเรียนหลัก: การเป็นตัวแทน ICT Talent และแนวทางการพัฒนาสื่อดิจิทัล',
  'https://www.youtube.com/watch?v=YaG5SAw1n0c',
  'YaG5SAw1n0c',
  true,
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_questions (id, project_id, prompt, type, options, correct_answer, points, order_index)
VALUES 
(
  'q1',
  'ict-talent-2026',
  'บทบาทหลักของตัวแทน ICT Talent ประจำโรงเรียนคือข้อใด',
  'mcq',
  '["ดูแลเฉพาะเครื่องพิมพ์ในห้องพักครู", "ประสานงานระบบดิจิทัลและการใช้ ICT เพื่อการเรียนรู้ในโรงเรียน", "จัดซื้อครุภัณฑ์ทุกประเภทโดยไม่ต้องผ่านผู้บริหาร", "สอนวิชาคอมพิวเตอร์แทนครูผู้สอนทุกชั้น"]'::jsonb,
  'ประสานงานระบบดิจิทัลและการใช้ ICT เพื่อการเรียนรู้ในโรงเรียน',
  1,
  1
),
(
  'q2',
  'ict-talent-2026',
  'ข้อใดสอดคล้องกับหลัก PDPA เมื่อเก็บข้อมูลผู้เรียน',
  'mcq',
  '["เก็บข้อมูลเกินความจำเป็นเพื่อใช้ในอนาคต", "เผยแพร่รายชื่อนักเรียนพร้อมเลขบัตรประชาชนในกลุ่มไลน์", "เก็บเท่าที่จำเป็น แจ้งวัตถุประสงค์ และขอความยินยอมตามกฎหมาย", "ส่งไฟล์ข้อมูลไปยังบุคคลภายนอกได้ทันทีหากสะดวก"]'::jsonb,
  'เก็บเท่าที่จำเป็น แจ้งวัตถุประสงค์ และขอความยินยอมตามกฎหมาย',
  1,
  2
),
(
  'q3',
  'ict-talent-2026',
  'เมื่อพบอีเมลฟิชชิงส่งถึงครูในโรงเรียน ควรทำอย่างไรเป็นอันดับแรก',
  'mcq',
  '["คลิกลิงก์เพื่อตรวจสอบว่าเป็นของจริงหรือไม่", "ส่งต่ออีเมลนั้นให้เพื่อนร่วมงานทุกคน", "ไม่คลิกลิงก์ แจ้งผู้เกี่ยวข้อง และลบหรือรายงานตามแนวทางของโรงเรียน", "ตอบกลับผู้ส่งเพื่อขอข้อมูลเพิ่มเติม"]'::jsonb,
  'ไม่คลิกลิงก์ แจ้งผู้เกี่ยวข้อง และลบหรือรายงานตามแนวทางของโรงเรียน',
  1,
  3
),
(
  'q4',
  'ict-talent-2026',
  'สรุปสั้น ๆ ว่าจะวางแผนสนับสนุนครูในการใช้ ICT เพื่อการสอนในภาคเรียนนี้ได้อย่างไร',
  'open_ended',
  '[]'::jsonb,
  NULL,
  2,
  4
)
ON CONFLICT (id) DO NOTHING;
