-- =============================================================================
-- activity_profile_auditor_v1.sql
-- Global activity tasks (replace missions), score ledger, live check-in,
-- auditor documents. Safe: CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE only.
-- Run in Supabase SQL Editor after prior migrations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.activity_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_name text NOT NULL,
  report_detail text,
  report_date date,
  report_deadline timestamptz,
  link_required boolean NOT NULL DEFAULT true,
  file_required boolean NOT NULL DEFAULT false,
  score_points integer NOT NULL DEFAULT 0 CHECK (score_points >= 0),
  is_open boolean NOT NULL DEFAULT false,
  activity_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS activity_tasks_project_idx ON public.activity_tasks (project_id);
CREATE INDEX IF NOT EXISTS activity_tasks_open_year_idx ON public.activity_tasks (is_open, activity_year);

CREATE TABLE IF NOT EXISTS public.activity_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.activity_tasks(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  report_url text,
  file_path text,
  file_name text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reviewer_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_submissions_task_profile_unique UNIQUE (task_id, profile_id)
);

CREATE INDEX IF NOT EXISTS activity_submissions_profile_idx ON public.activity_submissions (profile_id);
CREATE INDEX IF NOT EXISTS activity_submissions_status_idx ON public.activity_submissions (status);

CREATE TABLE IF NOT EXISTS public.score_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points >= 0),
  source text NOT NULL CHECK (source IN ('task', 'elearning', 'live')),
  source_id text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_ledger_profile_source_unique UNIQUE (profile_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS score_ledger_profile_idx ON public.score_ledger (profile_id);

CREATE TABLE IF NOT EXISTS public.live_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Live meeting',
  youtube_url text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  score_points integer NOT NULL DEFAULT 0 CHECK (score_points >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_meetings_window_check CHECK (window_end > window_start)
);

CREATE TABLE IF NOT EXISTS public.live_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.live_meetings(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_checkins_meeting_profile_unique UNIQUE (meeting_id, profile_id)
);

CREATE INDEX IF NOT EXISTS live_checkins_profile_idx ON public.live_checkins (profile_id);

CREATE TABLE IF NOT EXISTS public.auditor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id text NOT NULL,
  title text NOT NULL,
  file_path text,
  file_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auditor_documents_district_idx ON public.auditor_documents (district_id);

-- E-learning points on videos (optional column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_videos' AND column_name = 'score_points'
  ) THEN
    ALTER TABLE public.project_videos ADD COLUMN score_points integer NOT NULL DEFAULT 0;
  END IF;
END $$;

ALTER TABLE public.activity_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditor_documents ENABLE ROW LEVEL SECURITY;

-- Public read of open tasks / active live meetings via RPC only (no broad policies)

-- -----------------------------------------------------------------------------
-- 2) Helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._credit_score(
  p_profile_id text,
  p_points integer,
  p_source text,
  p_source_id text,
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_points, 0) <= 0 THEN
    RETURN false;
  END IF;
  INSERT INTO public.score_ledger (profile_id, points, source, source_id, note)
  VALUES (p_profile_id, p_points, p_source, p_source_id, p_note)
  ON CONFLICT (profile_id, source, source_id) DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public._profile_district_id(p_profile_id text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.district_id
  FROM public.profiles p
  JOIN public.schools s ON s.school_id = p.school_id
  WHERE p.profile_id = p_profile_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._audit_primary_district(p_login_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ids text[];
BEGIN
  SELECT au.assigned_districts INTO v_ids
  FROM public.audit_users au
  WHERE lower(trim(au.login_email)) = lower(trim(p_login_email))
    AND COALESCE(au.is_active, true) = true
  LIMIT 1;
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_ids[1];
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Admin: activity tasks
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_activity_tasks(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.activity_year DESC, t.created_at DESC)
    FROM (
      SELECT
        at.*,
        pr.name AS project_name,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id) AS submission_count,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id AND s.status = 'approved') AS approved_count,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id AND s.status = 'pending') AS pending_count
      FROM public.activity_tasks at
      LEFT JOIN public.projects pr ON pr.id = at.project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_activity_task(
  p_token text,
  p_task jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_project text;
BEGIN
  a := public._admin_from_token(p_token);
  v_project := NULLIF(trim(COALESCE(p_task->>'project_id', '')), '');
  IF v_project IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุโครงการ (project_id)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
  END IF;

  IF NULLIF(trim(COALESCE(p_task->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_task->>'id')::uuid;
    UPDATE public.activity_tasks SET
      project_id = v_project,
      report_name = COALESCE(NULLIF(trim(p_task->>'report_name'), ''), report_name),
      report_detail = p_task->>'report_detail',
      report_date = NULLIF(p_task->>'report_date', '')::date,
      report_deadline = NULLIF(p_task->>'report_deadline', '')::timestamptz,
      link_required = COALESCE((p_task->>'link_required')::boolean, link_required),
      file_required = COALESCE((p_task->>'file_required')::boolean, file_required),
      score_points = COALESCE((p_task->>'score_points')::integer, score_points),
      is_open = COALESCE((p_task->>'is_open')::boolean, is_open),
      activity_year = COALESCE((p_task->>'activity_year')::integer, activity_year),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ');
    END IF;
  ELSE
    IF NULLIF(trim(COALESCE(p_task->>'report_name', '')), '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อรายงาน');
    END IF;
    INSERT INTO public.activity_tasks (
      project_id, report_name, report_detail, report_date, report_deadline,
      link_required, file_required, score_points, is_open, activity_year, created_by
    ) VALUES (
      v_project,
      trim(p_task->>'report_name'),
      p_task->>'report_detail',
      NULLIF(p_task->>'report_date', '')::date,
      NULLIF(p_task->>'report_deadline', '')::timestamptz,
      COALESCE((p_task->>'link_required')::boolean, true),
      COALESCE((p_task->>'file_required')::boolean, false),
      GREATEST(0, COALESCE((p_task->>'score_points')::integer, 0)),
      COALESCE((p_task->>'is_open')::boolean, false),
      COALESCE((p_task->>'activity_year')::integer, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer),
      a.admin_id
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_activity_task', 'activity_tasks', v_id::text, null, p_task);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_activity_task(p_token text, p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.activity_tasks WHERE id = p_task_id;
  PERFORM public._write_audit(a.admin_id, 'delete_activity_task', 'activity_tasks', p_task_id::text, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Admin: live meetings
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_live_meetings(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(m)::jsonb ORDER BY m.window_start DESC)
    FROM public.live_meetings m
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_live_meeting(p_token text, p_meeting jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_url text;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  a := public._admin_from_token(p_token);
  v_url := NULLIF(trim(COALESCE(p_meeting->>'youtube_url', '')), '');
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุ YouTube URL');
  END IF;
  BEGIN
    v_start := (p_meeting->>'window_start')::timestamptz;
    v_end := (p_meeting->>'window_end')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ช่วงเวลาไม่ถูกต้อง');
  END;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ช่วงเวลา check-in ไม่ถูกต้อง');
  END IF;

  IF NULLIF(trim(COALESCE(p_meeting->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_meeting->>'id')::uuid;
    UPDATE public.live_meetings SET
      title = COALESCE(NULLIF(trim(p_meeting->>'title'), ''), title),
      youtube_url = v_url,
      window_start = v_start,
      window_end = v_end,
      score_points = GREATEST(0, COALESCE((p_meeting->>'score_points')::integer, score_points)),
      is_active = COALESCE((p_meeting->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบ Live meeting');
    END IF;
  ELSE
    INSERT INTO public.live_meetings (title, youtube_url, window_start, window_end, score_points, is_active)
    VALUES (
      COALESCE(NULLIF(trim(p_meeting->>'title'), ''), 'Live meeting'),
      v_url,
      v_start,
      v_end,
      GREATEST(0, COALESCE((p_meeting->>'score_points')::integer, 0)),
      COALESCE((p_meeting->>'is_active')::boolean, true)
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_live_meeting', 'live_meetings', v_id::text, null, p_meeting);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_live_meeting(p_token text, p_meeting_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.live_meetings WHERE id = p_meeting_id;
  PERFORM public._write_audit(a.admin_id, 'delete_live_meeting', 'live_meetings', p_meeting_id::text, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) Admin: auditor documents + video score
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_auditor_documents(p_token text, p_district_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(d)::jsonb ORDER BY d.created_at DESC)
    FROM public.auditor_documents d
    WHERE v_district IS NULL OR d.district_id = v_district
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_auditor_document(p_token text, p_doc jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_district text;
BEGIN
  a := public._admin_from_token(p_token);
  v_district := NULLIF(trim(COALESCE(p_doc->>'district_id', '')), '');
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุเขต');
  END IF;
  IF NULLIF(trim(COALESCE(p_doc->>'title', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อเอกสาร');
  END IF;

  IF NULLIF(trim(COALESCE(p_doc->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_doc->>'id')::uuid;
    UPDATE public.auditor_documents SET
      district_id = v_district,
      title = trim(p_doc->>'title'),
      file_path = NULLIF(p_doc->>'file_path', ''),
      file_url = NULLIF(p_doc->>'file_url', ''),
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.auditor_documents (district_id, title, file_path, file_url, created_by)
    VALUES (
      v_district,
      trim(p_doc->>'title'),
      NULLIF(p_doc->>'file_path', ''),
      NULLIF(p_doc->>'file_url', ''),
      a.admin_id
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_auditor_document', 'auditor_documents', v_id::text, null, p_doc);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_auditor_document(p_token text, p_doc_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.auditor_documents WHERE id = p_doc_id;
  PERFORM public._write_audit(a.admin_id, 'delete_auditor_document', 'auditor_documents', p_doc_id::text, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_video_score_points(
  p_token text,
  p_video_id text,
  p_score_points integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  UPDATE public.project_videos
  SET score_points = GREATEST(0, COALESCE(p_score_points, 0))
  WHERE id = trim(p_video_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
  END IF;
  PERFORM public._write_audit(
    a.admin_id, 'set_video_score', 'project_videos', trim(p_video_id), null,
    jsonb_build_object('score_points', GREATEST(0, COALESCE(p_score_points, 0)))
  );
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Candidate: profile hub RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_activity_hub(
  p_profile_id text,
  p_phone text,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer);
  v_total integer := 0;
  v_tasks_total integer := 0;
  v_tasks_approved integer := 0;
  v_district text;
  v_school_name text;
  v_district_name text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(sum(points), 0)::integer INTO v_total
  FROM public.score_ledger WHERE profile_id = p.profile_id;

  SELECT count(*) INTO v_tasks_total
  FROM public.activity_tasks t
  WHERE t.activity_year = v_year;

  SELECT count(*) INTO v_tasks_approved
  FROM public.activity_submissions s
  JOIN public.activity_tasks t ON t.id = s.task_id
  WHERE s.profile_id = p.profile_id
    AND s.status = 'approved'
    AND t.activity_year = v_year;

  SELECT s.school_name, s.district_id, d.district_name
  INTO v_school_name, v_district, v_district_name
  FROM public.schools s
  LEFT JOIN public.districts d ON d.district_id = s.district_id
  WHERE s.school_id = p.school_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'school_id', p.school_id,
    'school_name', v_school_name,
    'district_id', v_district,
    'district_name', v_district_name,
    'total_score', v_total,
    'activity_year', v_year,
    'tasks_total', v_tasks_total,
    'tasks_approved', v_tasks_approved,
    'performance_pct', CASE WHEN v_tasks_total > 0
      THEN round((v_tasks_approved::numeric / v_tasks_total::numeric) * 100.0, 1)
      ELSE 0 END,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'project_id', t.project_id,
        'project_name', pr.name,
        'report_name', t.report_name,
        'report_detail', t.report_detail,
        'report_date', t.report_date,
        'report_deadline', t.report_deadline,
        'link_required', t.link_required,
        'file_required', t.file_required,
        'score_points', t.score_points,
        'is_open', t.is_open,
        'activity_year', t.activity_year,
        'submission_status', COALESCE(s.status, 'not_submitted'),
        'report_url', s.report_url,
        'file_path', s.file_path,
        'file_name', s.file_name,
        'submitted_at', s.submitted_at,
        'reviewer_note', s.reviewer_note
      ) ORDER BY t.report_deadline NULLS LAST, t.created_at DESC)
      FROM public.activity_tasks t
      LEFT JOIN public.projects pr ON pr.id = t.project_id
      LEFT JOIN public.activity_submissions s
        ON s.task_id = t.id AND s.profile_id = p.profile_id
      WHERE t.is_open = true OR s.id IS NOT NULL
    ), '[]'::jsonb),
    'live_meetings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'youtube_url', m.youtube_url,
        'window_start', m.window_start,
        'window_end', m.window_end,
        'score_points', m.score_points,
        'is_active', m.is_active,
        'in_window', (now() >= m.window_start AND now() <= m.window_end AND m.is_active),
        'checked_in', EXISTS (
          SELECT 1 FROM public.live_checkins c
          WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id
        ),
        'checked_in_at', (
          SELECT c.checked_in_at FROM public.live_checkins c
          WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id
          LIMIT 1
        )
      ) ORDER BY m.window_start DESC)
      FROM public.live_meetings m
      WHERE m.is_active = true
         OR EXISTS (
           SELECT 1 FROM public.live_checkins c
           WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id
         )
    ), '[]'::jsonb),
    'elearning', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'video_id', v.video_id,
        'id', v.id,
        'title', v.title,
        'project_id', v.project_id,
        'score_points', COALESCE(v.score_points, 0),
        'completed', COALESCE(w.completed, false),
        'credited', EXISTS (
          SELECT 1 FROM public.score_ledger sl
          WHERE sl.profile_id = p.profile_id
            AND sl.source = 'elearning'
            AND sl.source_id = v.id
        )
      ) ORDER BY v.order_index NULLS LAST)
      FROM public.project_videos v
      LEFT JOIN public.watch_progress w
        ON w.profile_id = p.profile_id AND w.video_id = v.video_id
      WHERE COALESCE(v.score_points, 0) > 0 OR COALESCE(w.completed, false)
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_activity_task(
  p_profile_id text,
  p_phone text,
  p_task_id uuid,
  p_report_url text DEFAULT NULL,
  p_file_path text DEFAULT NULL,
  p_file_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  t public.activity_tasks;
  v_url text := NULLIF(trim(COALESCE(p_report_url, '')), '');
  v_file text := NULLIF(trim(COALESCE(p_file_path, '')), '');
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT * INTO t FROM public.activity_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ');
  END IF;
  IF NOT t.is_open THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ภารกิจนี้ปิดรับแล้ว');
  END IF;
  IF t.report_deadline IS NOT NULL AND now() > t.report_deadline THEN
    RETURN jsonb_build_object('ok', false, 'error', 'เลยกำหนดส่งแล้ว');
  END IF;
  IF t.link_required AND (v_url IS NULL OR v_url !~* '^https?://') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกลิงก์รายงาน (http/https)');
  END IF;
  IF t.file_required AND v_file IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาแนบไฟล์รายงาน');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.activity_submissions
    WHERE task_id = t.id AND profile_id = p.profile_id AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รายงานนี้ได้รับการอนุมัติแล้ว');
  END IF;

  INSERT INTO public.activity_submissions (
    task_id, profile_id, status, report_url, file_path, file_name, submitted_at, updated_at
  ) VALUES (
    t.id, p.profile_id, 'pending', v_url, v_file, NULLIF(trim(COALESCE(p_file_name, '')), ''), now(), now()
  )
  ON CONFLICT (task_id, profile_id) DO UPDATE SET
    status = 'pending',
    report_url = EXCLUDED.report_url,
    file_path = EXCLUDED.file_path,
    file_name = EXCLUDED.file_name,
    submitted_at = now(),
    updated_at = now(),
    reviewed_at = NULL,
    reviewed_by = NULL,
    reviewer_note = NULL
  WHERE public.activity_submissions.status IS DISTINCT FROM 'approved';

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.checkin_live_meeting(
  p_profile_id text,
  p_phone text,
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  m public.live_meetings;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT * INTO m FROM public.live_meetings WHERE id = p_meeting_id;
  IF NOT FOUND OR NOT m.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบ Live meeting');
  END IF;
  IF now() < m.window_start OR now() > m.window_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อยู่นอกช่วงเวลา check-in');
  END IF;

  INSERT INTO public.live_checkins (meeting_id, profile_id, checked_in_at)
  VALUES (m.id, p.profile_id, now())
  ON CONFLICT (meeting_id, profile_id) DO NOTHING;

  -- Score credit is idempotent via score_ledger unique key
  PERFORM public._credit_score(p.profile_id, m.score_points, 'live', m.id::text, m.title);
  RETURN jsonb_build_object('ok', true, 'passed_meeting', true, 'points', m.score_points);
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_elearning_video(
  p_profile_id text,
  p_phone text,
  p_video_row_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_points integer := 0;
  v_title text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(score_points, 0), title INTO v_points, v_title
  FROM public.project_videos WHERE id = trim(p_video_row_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
  END IF;

  -- Require completed watch if a watch row exists for this youtube id
  IF EXISTS (
    SELECT 1 FROM public.project_videos pv
    WHERE pv.id = trim(p_video_row_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.watch_progress w
        WHERE w.profile_id = p.profile_id
          AND w.video_id = pv.video_id
          AND w.completed = true
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องรับชมวิดีโอให้ครบก่อน');
  END IF;

  IF v_points <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'credited', false, 'points', 0);
  END IF;

  PERFORM public._credit_score(p.profile_id, v_points, 'elearning', trim(p_video_row_id), v_title);
  RETURN jsonb_build_object('ok', true, 'credited', true, 'points', v_points);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_score_ranking(
  p_profile_id text,
  p_phone text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_my_score integer := 0;
  v_my_rank integer := NULL;
  v_top jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(sum(points), 0)::integer INTO v_my_score
  FROM public.score_ledger WHERE profile_id = p.profile_id;

  WITH totals AS (
    SELECT
      sl.profile_id,
      sum(sl.points)::integer AS total_score,
      max(pr.first_name) AS first_name,
      max(pr.last_name) AS last_name,
      max(s.school_name) AS school_name
    FROM public.score_ledger sl
    JOIN public.profiles pr ON pr.profile_id = sl.profile_id AND pr.deleted_at IS NULL
    LEFT JOIN public.schools s ON s.school_id = pr.school_id
    GROUP BY sl.profile_id
  ),
  ranked AS (
    SELECT
      t.*,
      rank() OVER (ORDER BY t.total_score DESC, t.profile_id) AS rank_no
    FROM totals t
  )
  SELECT jsonb_agg(jsonb_build_object(
    'rank', r.rank_no,
    'profile_id', r.profile_id,
    'first_name', r.first_name,
    'last_name', r.last_name,
    'school_name', r.school_name,
    'total_score', r.total_score,
    'is_me', r.profile_id = p.profile_id
  ) ORDER BY r.rank_no)
  INTO v_top
  FROM ranked r
  WHERE r.rank_no <= v_limit;

  SELECT r.rank_no INTO v_my_rank
  FROM (
    SELECT
      sl.profile_id,
      rank() OVER (ORDER BY sum(sl.points) DESC, sl.profile_id) AS rank_no
    FROM public.score_ledger sl
    JOIN public.profiles pr ON pr.profile_id = sl.profile_id AND pr.deleted_at IS NULL
    GROUP BY sl.profile_id
  ) r
  WHERE r.profile_id = p.profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'top', COALESCE(v_top, '[]'::jsonb),
    'me', jsonb_build_object(
      'profile_id', p.profile_id,
      'total_score', v_my_score,
      'rank', v_my_rank,
      'in_top', COALESCE(v_my_rank, 999999) <= v_limit
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Auditor: dashboard / approve / docs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auditor_activity_dashboard(p_login_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
  v_schools integer := 0;
  v_users integer := 0;
  v_tasks integer := 0;
  v_pending integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'needs_district', true, 'district_id', null);
  END IF;

  SELECT count(*) INTO v_schools
  FROM public.schools s WHERE s.district_id = v_district;

  SELECT count(*) INTO v_users
  FROM public.profiles p
  JOIN public.schools s ON s.school_id = p.school_id
  WHERE s.district_id = v_district AND p.deleted_at IS NULL
    AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin');

  SELECT count(*) INTO v_tasks FROM public.activity_tasks;

  SELECT count(*) INTO v_pending
  FROM public.activity_submissions sub
  JOIN public.profiles p ON p.profile_id = sub.profile_id AND p.deleted_at IS NULL
  JOIN public.schools s ON s.school_id = p.school_id
  WHERE s.district_id = v_district AND sub.status = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'needs_district', false,
    'district_id', v_district,
    'district_name', (SELECT district_name FROM public.districts WHERE district_id = v_district LIMIT 1),
    'stats', jsonb_build_object(
      'schools', v_schools,
      'users', v_users,
      'tasks', v_tasks,
      'pending_submissions', v_pending
    ),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'project_id', x.project_id,
        'project_name', x.project_name,
        'passed', x.passed,
        'not_passed', x.not_passed
      ) ORDER BY x.project_name)
      FROM (
        SELECT
          t.project_id,
          max(pr.name) AS project_name,
          count(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.profile_id END) AS passed,
          GREATEST(
            0,
            (
              SELECT count(*) FROM public.profiles p2
              JOIN public.schools s2 ON s2.school_id = p2.school_id
              WHERE s2.district_id = v_district AND p2.deleted_at IS NULL
                AND COALESCE(p2.portal_role, 'user') IN ('user', 'school_admin')
            )
            - count(DISTINCT CASE WHEN sub.status = 'approved' THEN sub.profile_id END)
          ) AS not_passed
        FROM public.activity_tasks t
        LEFT JOIN public.projects pr ON pr.id = t.project_id
        LEFT JOIN public.activity_submissions sub ON sub.task_id = t.id
          AND EXISTS (
            SELECT 1 FROM public.profiles px
            JOIN public.schools sx ON sx.school_id = px.school_id
            WHERE px.profile_id = sub.profile_id AND sx.district_id = v_district AND px.deleted_at IS NULL
          )
        GROUP BY t.project_id
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auditor_school_radar(
  p_login_email text,
  p_task_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
  v_task_filter uuid := p_task_id;
  v_task_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  IF v_task_filter IS NULL THEN
    SELECT count(*) INTO v_task_count FROM public.activity_tasks;
  ELSE
    v_task_count := 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'district_id', v_district,
    'task_id', v_task_filter,
    'tasks_total', v_task_count,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'report_name', t.report_name, 'project_id', t.project_id)
        ORDER BY t.created_at DESC)
      FROM public.activity_tasks t
    ), '[]'::jsonb),
    'schools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'school_id', s.school_id,
        'school_name', s.school_name,
        'users', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'profile_id', p.profile_id,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'status', CASE
              WHEN v_task_filter IS NOT NULL THEN COALESCE((
                SELECT sub.status FROM public.activity_submissions sub
                WHERE sub.task_id = v_task_filter AND sub.profile_id = p.profile_id
              ), 'not_submitted')
              ELSE NULL
            END,
            'done', CASE
              WHEN v_task_filter IS NOT NULL THEN NULL
              ELSE (
                SELECT count(*) FROM public.activity_submissions sub
                JOIN public.activity_tasks t2 ON t2.id = sub.task_id
                WHERE sub.profile_id = p.profile_id AND sub.status = 'approved'
              )
            END,
            'total', CASE
              WHEN v_task_filter IS NOT NULL THEN NULL
              ELSE v_task_count
            END
          ) ORDER BY p.last_name, p.first_name), '[]'::jsonb)
          FROM public.profiles p
          WHERE p.school_id = s.school_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
      ) ORDER BY s.school_name)
      FROM public.schools s
      WHERE s.district_id = v_district
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auditor_list_pending_submissions(p_login_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sub.id,
        'task_id', sub.task_id,
        'report_name', t.report_name,
        'project_id', t.project_id,
        'score_points', t.score_points,
        'profile_id', sub.profile_id,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'school_name', s.school_name,
        'report_url', sub.report_url,
        'file_path', sub.file_path,
        'file_name', sub.file_name,
        'submitted_at', sub.submitted_at,
        'status', sub.status
      ) ORDER BY sub.submitted_at ASC)
      FROM public.activity_submissions sub
      JOIN public.activity_tasks t ON t.id = sub.task_id
      JOIN public.profiles p ON p.profile_id = sub.profile_id AND p.deleted_at IS NULL
      JOIN public.schools s ON s.school_id = p.school_id
      WHERE s.district_id = v_district AND sub.status = 'pending'
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auditor_review_submission(
  p_login_email text,
  p_submission_id uuid,
  p_approve boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
  sub public.activity_submissions;
  t public.activity_tasks;
  v_user_district text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  SELECT * INTO sub FROM public.activity_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ');
  END IF;
  IF sub.status = 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อนุมัติแล้ว');
  END IF;

  v_user_district := public._profile_district_id(sub.profile_id);
  IF v_user_district IS DISTINCT FROM v_district THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่อยู่ในเขตที่รับผิดชอบ');
  END IF;

  SELECT * INTO t FROM public.activity_tasks WHERE id = sub.task_id;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.activity_submissions SET
      status = 'approved',
      reviewed_at = now(),
      reviewed_by = lower(trim(p_login_email)),
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''),
      updated_at = now()
    WHERE id = sub.id;
    PERFORM public._credit_score(
      sub.profile_id,
      COALESCE(t.score_points, 0),
      'task',
      sub.task_id::text,
      t.report_name
    );
  ELSE
    UPDATE public.activity_submissions SET
      status = 'rejected',
      reviewed_at = now(),
      reviewed_by = lower(trim(p_login_email)),
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''),
      updated_at = now()
    WHERE id = sub.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.auditor_list_documents(p_login_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'district_id', v_district,
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'file_url', COALESCE(d.file_url, d.file_path),
        'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM public.auditor_documents d
      WHERE d.district_id = v_district
    ), '[]'::jsonb)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) Grants
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.admin_list_activity_tasks(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_activity_task(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_activity_task(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_live_meetings(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_live_meeting(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_live_meeting(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_auditor_documents(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_auditor_document(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_auditor_document(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_video_score_points(text, text, integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_my_activity_hub(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_activity_task(text, text, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checkin_live_meeting(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_elearning_video(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_score_ranking(text, text, integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.auditor_activity_dashboard(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_school_radar(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_list_pending_submissions(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_review_submission(text, uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_list_documents(text) TO anon, authenticated, service_role;

-- Storage buckets (create if storage schema exists; ignore errors if not)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('task-files', 'task-files', false)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('auditor-docs', 'auditor-docs', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Storage buckets skipped: %', SQLERRM;
END $$;
