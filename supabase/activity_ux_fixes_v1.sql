-- =============================================================================
-- activity_ux_fixes_v1.sql
-- Fix jsonb/text[] bugs, competition RANK, activity_projects + task include flags,
-- auditor_can_approve_reports setting. Safe CREATE/REPLACE / ADD COLUMN.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Fix _audit_primary_district (assigned_districts is jsonb, not text[])
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._audit_primary_district(p_login_email text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_raw jsonb;
  v_ids text[];
BEGIN
  SELECT au.assigned_districts INTO v_raw
  FROM public.audit_users au
  WHERE lower(trim(au.login_email)) = lower(trim(p_login_email))
    AND COALESCE(au.is_active, true) = true
    AND au.deleted_at IS NULL
  LIMIT 1;

  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;

  v_ids := public._district_ids_from_jsonb(v_raw);
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_ids[1];
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) Fix login_candidate COALESCE jsonb vs text[]
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_candidate(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  bu public.business_users;
  au public.audit_users;
  v_id text := lower(trim(COALESCE(p_email, '')));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(p.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false, 'need_password_setup', true, 'kind', 'candidate',
        'login_email', COALESCE(p.login_email, lower(trim(p.email))),
        'profile_id', p.profile_id, 'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
      );
    END IF;
    IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'candidate', 'profile', public._profile_to_login_json(p));
  END IF;

  SELECT * INTO bu FROM public.business_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id LIMIT 1;

  IF FOUND THEN
    IF COALESCE(bu.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF bu.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชียังไม่มีรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF extensions.crypt(p_password, bu.password_hash) IS DISTINCT FROM bu.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
    IF COALESCE(bu.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false, 'need_password_setup', true, 'kind', 'business',
        'login_email', bu.login_email, 'user_id', bu.id, 'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;
    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'business_users', bu.id::text,
      jsonb_build_object('login_id', bu.login_email, 'kind', 'business'));
    RETURN jsonb_build_object(
      'ok', true, 'kind', 'business',
      'user', jsonb_build_object(
        'id', bu.id, 'login_email', bu.login_email,
        'display_name', bu.display_name, 'position', bu.position,
        'must_set_password', COALESCE(bu.must_set_password, false)
      )
    );
  END IF;

  SELECT * INTO au FROM public.audit_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id LIMIT 1;

  IF FOUND THEN
    IF COALESCE(au.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF au.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชียังไม่มีรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF extensions.crypt(p_password, au.password_hash) IS DISTINCT FROM au.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
    IF COALESCE(au.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false, 'need_password_setup', true, 'kind', 'audit',
        'login_email', au.login_email, 'user_id', au.id, 'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;
    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'audit_users', au.id::text,
      jsonb_build_object('login_id', au.login_email, 'kind', 'audit'));
    RETURN jsonb_build_object(
      'ok', true, 'kind', 'audit',
      'user', jsonb_build_object(
        'id', au.id, 'login_email', au.login_email,
        'display_name', au.display_name, 'position', au.position,
        'assigned_districts', COALESCE(au.assigned_districts, '[]'::jsonb),
        'must_set_password', COALESCE(au.must_set_password, false)
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) Site setting: auditor can approve
-- -----------------------------------------------------------------------------
INSERT INTO public.site_settings (key, value)
VALUES ('auditor_can_approve_reports', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) activity_projects + task schema evolution
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.activity_projects ENABLE ROW LEVEL SECURITY;

-- Soften old FK to learning projects if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_tasks' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE public.activity_tasks ALTER COLUMN project_id DROP NOT NULL;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_tasks' AND column_name = 'activity_project_id'
  ) THEN
    ALTER TABLE public.activity_tasks
      ADD COLUMN activity_project_id uuid REFERENCES public.activity_projects(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.activity_tasks ADD COLUMN IF NOT EXISTS include_report_name boolean NOT NULL DEFAULT true;
  ALTER TABLE public.activity_tasks ADD COLUMN IF NOT EXISTS include_detail boolean NOT NULL DEFAULT false;
  ALTER TABLE public.activity_tasks ADD COLUMN IF NOT EXISTS include_deadline boolean NOT NULL DEFAULT false;
  ALTER TABLE public.activity_tasks ADD COLUMN IF NOT EXISTS include_video_url boolean NOT NULL DEFAULT true;
  ALTER TABLE public.activity_tasks ADD COLUMN IF NOT EXISTS include_doc_url boolean NOT NULL DEFAULT true;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.activity_submissions ADD COLUMN IF NOT EXISTS report_name text;
  ALTER TABLE public.activity_submissions ADD COLUMN IF NOT EXISTS report_detail text;
  ALTER TABLE public.activity_submissions ADD COLUMN IF NOT EXISTS video_url text;
  ALTER TABLE public.activity_submissions ADD COLUMN IF NOT EXISTS doc_url text;
EXCEPTION WHEN others THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 5) Admin: activity projects
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_activity_projects(p_token text)
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
    SELECT jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'created_at', p.created_at
    ) ORDER BY p.created_at DESC)
    FROM public.activity_projects p
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_activity_project(p_token text, p_name text, p_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อโครงการ');
  END IF;
  IF p_id IS NOT NULL THEN
    UPDATE public.activity_projects SET name = v_name, updated_at = now() WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
    END IF;
  ELSE
    INSERT INTO public.activity_projects (name, created_by) VALUES (v_name, a.admin_id)
    RETURNING id INTO v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Admin upsert/list activity tasks (new flags)
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
        ap.name AS activity_project_name,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id) AS submission_count,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id AND s.status = 'approved') AS approved_count,
        (SELECT count(*) FROM public.activity_submissions s WHERE s.task_id = at.id AND s.status = 'pending') AS pending_count
      FROM public.activity_tasks at
      LEFT JOIN public.activity_projects ap ON ap.id = at.activity_project_id
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_activity_task(p_token text, p_task jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_proj uuid;
  v_proj_name text;
BEGIN
  a := public._admin_from_token(p_token);

  v_proj_name := NULLIF(trim(COALESCE(p_task->>'activity_project_name', '')), '');
  IF NULLIF(trim(COALESCE(p_task->>'activity_project_id', '')), '') IS NOT NULL THEN
    v_proj := (p_task->>'activity_project_id')::uuid;
  ELSIF v_proj_name IS NOT NULL THEN
    INSERT INTO public.activity_projects (name, created_by)
    VALUES (v_proj_name, a.admin_id)
    RETURNING id INTO v_proj;
  END IF;

  IF v_proj IS NULL AND NULLIF(trim(COALESCE(p_task->>'id', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อโครงการกิจกรรม');
  END IF;

  IF NULLIF(trim(COALESCE(p_task->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_task->>'id')::uuid;
    UPDATE public.activity_tasks SET
      activity_project_id = COALESCE(v_proj, activity_project_id),
      report_name = COALESCE(NULLIF(trim(p_task->>'report_name'), ''), report_name),
      report_detail = p_task->>'report_detail',
      report_deadline = CASE
        WHEN COALESCE((p_task->>'include_deadline')::boolean, include_deadline)
          THEN NULLIF(p_task->>'report_deadline', '')::timestamptz
        ELSE NULL
      END,
      include_report_name = COALESCE((p_task->>'include_report_name')::boolean, include_report_name),
      include_detail = COALESCE((p_task->>'include_detail')::boolean, include_detail),
      include_deadline = COALESCE((p_task->>'include_deadline')::boolean, include_deadline),
      include_video_url = COALESCE((p_task->>'include_video_url')::boolean, include_video_url),
      include_doc_url = COALESCE((p_task->>'include_doc_url')::boolean, include_doc_url),
      link_required = COALESCE((p_task->>'include_video_url')::boolean, link_required),
      file_required = COALESCE((p_task->>'include_doc_url')::boolean, file_required),
      score_points = COALESCE((p_task->>'score_points')::integer, score_points),
      is_open = COALESCE((p_task->>'is_open')::boolean, is_open),
      activity_year = COALESCE((p_task->>'activity_year')::integer, activity_year),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ');
    END IF;
  ELSE
    INSERT INTO public.activity_tasks (
      activity_project_id, report_name, report_detail, report_deadline,
      include_report_name, include_detail, include_deadline, include_video_url, include_doc_url,
      link_required, file_required, score_points, is_open, activity_year, created_by, project_id
    ) VALUES (
      v_proj,
      COALESCE(NULLIF(trim(p_task->>'report_name'), ''), 'ภารกิจ'),
      p_task->>'report_detail',
      CASE WHEN COALESCE((p_task->>'include_deadline')::boolean, false)
        THEN NULLIF(p_task->>'report_deadline', '')::timestamptz ELSE NULL END,
      COALESCE((p_task->>'include_report_name')::boolean, true),
      COALESCE((p_task->>'include_detail')::boolean, false),
      COALESCE((p_task->>'include_deadline')::boolean, false),
      COALESCE((p_task->>'include_video_url')::boolean, true),
      COALESCE((p_task->>'include_doc_url')::boolean, true),
      COALESCE((p_task->>'include_video_url')::boolean, true),
      COALESCE((p_task->>'include_doc_url')::boolean, true),
      GREATEST(0, COALESCE((p_task->>'score_points')::integer, 0)),
      false, -- default closed
      COALESCE((p_task->>'activity_year')::integer, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer),
      a.admin_id,
      NULL
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_activity_task', 'activity_tasks', v_id::text, null, p_task);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Candidate hub + submit (new fields)
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

  SELECT count(*) INTO v_tasks_total FROM public.activity_tasks t WHERE t.activity_year = v_year;

  SELECT count(*) INTO v_tasks_approved
  FROM public.activity_submissions s
  JOIN public.activity_tasks t ON t.id = s.task_id
  WHERE s.profile_id = p.profile_id AND s.status = 'approved' AND t.activity_year = v_year;

  SELECT s.school_name, s.district_id, d.district_name
  INTO v_school_name, v_district, v_district_name
  FROM public.schools s
  LEFT JOIN public.districts d ON d.district_id = s.district_id
  WHERE s.school_id = p.school_id LIMIT 1;

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
      THEN round((v_tasks_approved::numeric / v_tasks_total::numeric) * 100.0, 1) ELSE 0 END,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'activity_project_id', t.activity_project_id,
        'activity_project_name', ap.name,
        'report_name', t.report_name,
        'report_detail', t.report_detail,
        'report_deadline', t.report_deadline,
        'include_report_name', COALESCE(t.include_report_name, true),
        'include_detail', COALESCE(t.include_detail, false),
        'include_deadline', COALESCE(t.include_deadline, false),
        'include_video_url', COALESCE(t.include_video_url, true),
        'include_doc_url', COALESCE(t.include_doc_url, true),
        'score_points', t.score_points,
        'is_open', t.is_open,
        'activity_year', t.activity_year,
        'submission_status', COALESCE(s.status, 'not_submitted'),
        'submitted_report_name', s.report_name,
        'submitted_report_detail', s.report_detail,
        'video_url', s.video_url,
        'doc_url', s.doc_url,
        'report_url', s.report_url,
        'file_path', s.file_path,
        'submitted_at', s.submitted_at,
        'reviewer_note', s.reviewer_note
      ) ORDER BY t.report_deadline NULLS LAST, t.created_at DESC)
      FROM public.activity_tasks t
      LEFT JOIN public.activity_projects ap ON ap.id = t.activity_project_id
      LEFT JOIN public.activity_submissions s ON s.task_id = t.id AND s.profile_id = p.profile_id
      WHERE t.is_open = true OR s.id IS NOT NULL
    ), '[]'::jsonb),
    'live_meetings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'youtube_url', m.youtube_url,
        'window_start', m.window_start, 'window_end', m.window_end,
        'score_points', m.score_points, 'is_active', m.is_active,
        'in_window', (now() >= m.window_start AND now() <= m.window_end AND m.is_active),
        'checked_in', EXISTS (SELECT 1 FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id),
        'checked_in_at', (SELECT c.checked_in_at FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id LIMIT 1)
      ) ORDER BY m.window_start DESC)
      FROM public.live_meetings m
      WHERE m.is_active = true OR EXISTS (
        SELECT 1 FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id
      )
    ), '[]'::jsonb)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.submit_activity_task(text, text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_activity_task(
  p_profile_id text,
  p_phone text,
  p_task_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  t public.activity_tasks;
  v_name text := NULLIF(trim(COALESCE(p_payload->>'report_name', '')), '');
  v_detail text := NULLIF(trim(COALESCE(p_payload->>'report_detail', '')), '');
  v_video text := NULLIF(trim(COALESCE(p_payload->>'video_url', '')), '');
  v_doc text := NULLIF(trim(COALESCE(p_payload->>'doc_url', '')), '');
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT * INTO t FROM public.activity_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ'); END IF;
  IF NOT t.is_open THEN RETURN jsonb_build_object('ok', false, 'error', 'ภารกิจนี้ปิดรับแล้ว'); END IF;
  IF COALESCE(t.include_deadline, false) AND t.report_deadline IS NOT NULL AND now() > t.report_deadline THEN
    RETURN jsonb_build_object('ok', false, 'error', 'เลยกำหนดส่งแล้ว');
  END IF;
  IF COALESCE(t.include_report_name, true) AND v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อรายงาน');
  END IF;
  IF COALESCE(t.include_detail, false) AND v_detail IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกรายละเอียด');
  END IF;
  IF COALESCE(t.include_video_url, true) AND (v_video IS NULL OR v_video !~* '^https?://') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกลิงก์วิดีโอ (http/https)');
  END IF;
  IF COALESCE(t.include_doc_url, true) AND (v_doc IS NULL OR v_doc !~* '^https?://') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกลิงก์เอกสาร (http/https)');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.activity_submissions
    WHERE task_id = t.id AND profile_id = p.profile_id AND status = 'approved'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รายงานนี้ได้รับการอนุมัติแล้ว');
  END IF;

  INSERT INTO public.activity_submissions (
    task_id, profile_id, status, report_name, report_detail, video_url, doc_url,
    report_url, file_path, submitted_at, updated_at
  ) VALUES (
    t.id, p.profile_id, 'pending', v_name, v_detail, v_video, v_doc,
    v_video, v_doc, now(), now()
  )
  ON CONFLICT (task_id, profile_id) DO UPDATE SET
    status = 'pending',
    report_name = EXCLUDED.report_name,
    report_detail = EXCLUDED.report_detail,
    video_url = EXCLUDED.video_url,
    doc_url = EXCLUDED.doc_url,
    report_url = EXCLUDED.report_url,
    file_path = EXCLUDED.file_path,
    submitted_at = now(),
    updated_at = now(),
    reviewed_at = NULL, reviewed_by = NULL, reviewer_note = NULL
  WHERE public.activity_submissions.status IS DISTINCT FROM 'approved';

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) Ranking: competition RANK()
-- -----------------------------------------------------------------------------
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
    SELECT t.*, RANK() OVER (ORDER BY t.total_score DESC, t.profile_id) AS rank_no
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
  ) ORDER BY r.rank_no, r.profile_id)
  INTO v_top
  FROM ranked r
  WHERE r.rank_no <= v_limit
     OR r.profile_id = p.profile_id;

  -- Top N by rank value (competition): include all sharing last displayed rank
  SELECT jsonb_agg(x ORDER BY (x->>'rank')::int, x->>'profile_id')
  INTO v_top
  FROM (
    SELECT jsonb_build_object(
      'rank', r.rank_no,
      'profile_id', r.profile_id,
      'first_name', r.first_name,
      'last_name', r.last_name,
      'school_name', r.school_name,
      'total_score', r.total_score,
      'is_me', r.profile_id = p.profile_id
    ) AS x
    FROM (
      SELECT t.*, RANK() OVER (ORDER BY t.total_score DESC, t.profile_id) AS rank_no
      FROM (
        SELECT sl.profile_id, sum(sl.points)::integer AS total_score,
          max(pr.first_name) AS first_name, max(pr.last_name) AS last_name, max(s.school_name) AS school_name
        FROM public.score_ledger sl
        JOIN public.profiles pr ON pr.profile_id = sl.profile_id AND pr.deleted_at IS NULL
        LEFT JOIN public.schools s ON s.school_id = pr.school_id
        GROUP BY sl.profile_id
      ) t
    ) r
    WHERE r.rank_no <= v_limit
  ) q;

  SELECT r.rank_no INTO v_my_rank
  FROM (
    SELECT sl.profile_id, RANK() OVER (ORDER BY sum(sl.points) DESC, sl.profile_id) AS rank_no
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
-- 9) Auditor review gated by setting; admin review RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._auditor_can_approve()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::boolean FROM public.site_settings WHERE key = 'auditor_can_approve_reports' LIMIT 1),
    CASE
      WHEN (SELECT value FROM public.site_settings WHERE key = 'auditor_can_approve_reports' LIMIT 1) = 'true'::jsonb THEN true
      WHEN (SELECT value FROM public.site_settings WHERE key = 'auditor_can_approve_reports' LIMIT 1) = 'false'::jsonb THEN false
      ELSE true
    END
  );
$$;

CREATE OR REPLACE FUNCTION public._auditor_can_approve()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT value INTO v FROM public.site_settings WHERE key = 'auditor_can_approve_reports' LIMIT 1;
  IF v IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(v) = 'boolean' THEN RETURN (v::text)::boolean; END IF;
  IF v = 'true'::jsonb OR (v #>> '{}') = 'true' THEN RETURN true; END IF;
  IF v = 'false'::jsonb OR (v #>> '{}') = 'false' THEN RETURN false; END IF;
  RETURN true;
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

  IF NOT public._auditor_can_approve() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ระบบปิดสิทธิ์ Auditor อนุมัติรายงาน — ติดต่อผู้ดูแล');
  END IF;

  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  SELECT * INTO sub FROM public.activity_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ'); END IF;
  IF sub.status = 'approved' THEN RETURN jsonb_build_object('ok', false, 'error', 'อนุมัติแล้ว'); END IF;

  v_user_district := public._profile_district_id(sub.profile_id);
  IF v_user_district IS DISTINCT FROM v_district THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่อยู่ในเขตที่รับผิดชอบ');
  END IF;

  SELECT * INTO t FROM public.activity_tasks WHERE id = sub.task_id;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.activity_submissions SET
      status = 'approved', reviewed_at = now(), reviewed_by = lower(trim(p_login_email)),
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''), updated_at = now()
    WHERE id = sub.id;
    PERFORM public._credit_score(sub.profile_id, COALESCE(t.score_points, 0), 'task', sub.task_id::text, t.report_name);
  ELSE
    UPDATE public.activity_submissions SET
      status = 'rejected', reviewed_at = now(), reviewed_by = lower(trim(p_login_email)),
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''), updated_at = now()
    WHERE id = sub.id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_pending_submissions(
  p_token text,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_total integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT count(*) INTO v_total FROM public.activity_submissions WHERE status = 'pending';
  RETURN jsonb_build_object(
    'ok', true,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sub.id, 'task_id', sub.task_id, 'report_name', t.report_name,
        'activity_project_name', ap.name, 'score_points', t.score_points,
        'profile_id', sub.profile_id, 'first_name', p.first_name, 'last_name', p.last_name,
        'school_name', s.school_name, 'district_id', s.district_id,
        'video_url', sub.video_url, 'doc_url', sub.doc_url,
        'report_url', sub.report_url, 'file_path', sub.file_path,
        'submitted_report_name', sub.report_name, 'submitted_report_detail', sub.report_detail,
        'submitted_at', sub.submitted_at, 'status', sub.status
      ) ORDER BY sub.submitted_at ASC)
      FROM (
        SELECT * FROM public.activity_submissions
        WHERE status = 'pending'
        ORDER BY submitted_at ASC
        LIMIT v_limit OFFSET v_offset
      ) sub
      JOIN public.activity_tasks t ON t.id = sub.task_id
      LEFT JOIN public.activity_projects ap ON ap.id = t.activity_project_id
      JOIN public.profiles p ON p.profile_id = sub.profile_id AND p.deleted_at IS NULL
      JOIN public.schools s ON s.school_id = p.school_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_review_submission(
  p_token text,
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
  a public.admins;
  sub public.activity_submissions;
  t public.activity_tasks;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT * INTO sub FROM public.activity_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ'); END IF;
  IF sub.status = 'approved' THEN RETURN jsonb_build_object('ok', false, 'error', 'อนุมัติแล้ว'); END IF;
  SELECT * INTO t FROM public.activity_tasks WHERE id = sub.task_id;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.activity_submissions SET
      status = 'approved', reviewed_at = now(), reviewed_by = 'admin:' || a.admin_id::text,
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''), updated_at = now()
    WHERE id = sub.id;
    PERFORM public._credit_score(sub.profile_id, COALESCE(t.score_points, 0), 'task', sub.task_id::text, t.report_name);
  ELSE
    UPDATE public.activity_submissions SET
      status = 'rejected', reviewed_at = now(), reviewed_by = 'admin:' || a.admin_id::text,
      reviewer_note = NULLIF(trim(COALESCE(p_note, '')), ''), updated_at = now()
    WHERE id = sub.id;
  END IF;
  PERFORM public._write_audit(a.admin_id, 'review_activity_submission', 'activity_submissions', sub.id::text, null,
    jsonb_build_object('approve', p_approve));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Paginated auditor pending
CREATE OR REPLACE FUNCTION public.auditor_list_pending_submissions(
  p_login_email text,
  p_limit integer DEFAULT 10,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_total integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  SELECT count(*) INTO v_total
  FROM public.activity_submissions sub
  JOIN public.profiles p ON p.profile_id = sub.profile_id AND p.deleted_at IS NULL
  JOIN public.schools s ON s.school_id = p.school_id
  WHERE s.district_id = v_district AND sub.status = 'pending';

  RETURN jsonb_build_object(
    'ok', true,
    'auditor_can_approve', public._auditor_can_approve(),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sub.id, 'task_id', sub.task_id, 'report_name', t.report_name,
        'project_id', t.activity_project_id, 'score_points', t.score_points,
        'profile_id', sub.profile_id, 'first_name', p.first_name, 'last_name', p.last_name,
        'school_name', s.school_name,
        'video_url', sub.video_url, 'doc_url', sub.doc_url,
        'report_url', sub.report_url, 'file_path', sub.file_path,
        'file_name', sub.file_name, 'submitted_at', sub.submitted_at, 'status', sub.status
      ) ORDER BY sub.submitted_at ASC)
      FROM (
        SELECT sub.*
        FROM public.activity_submissions sub
        JOIN public.profiles p ON p.profile_id = sub.profile_id AND p.deleted_at IS NULL
        JOIN public.schools s ON s.school_id = p.school_id
        WHERE s.district_id = v_district AND sub.status = 'pending'
        ORDER BY sub.submitted_at ASC
        LIMIT v_limit OFFSET v_offset
      ) sub
      JOIN public.activity_tasks t ON t.id = sub.task_id
      JOIN public.profiles p ON p.profile_id = sub.profile_id
      JOIN public.schools s ON s.school_id = p.school_id
    ), '[]'::jsonb)
  );
END;
$$;

-- Schools under district for รายเขต expand
CREATE OR REPLACE FUNCTION public.auditor_district_schools(p_login_email text, p_district_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := COALESCE(NULLIF(trim(p_district_id), ''), public._audit_primary_district(p_login_email));
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'district_id', v_district,
    'schools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'school_id', s.school_id,
        'school_name', s.school_name,
        'province', s.province,
        'user_count', (SELECT count(*) FROM public.profiles p WHERE p.school_id = s.school_id AND p.deleted_at IS NULL),
        'is_registered', COALESCE(s.is_registered, false)
      ) ORDER BY s.school_name)
      FROM public.schools s
      WHERE s.district_id = v_district
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_activity_projects(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_activity_project(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_activity_task(text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_pending_submissions(text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_submission(text, uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_list_pending_submissions(text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_district_schools(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
