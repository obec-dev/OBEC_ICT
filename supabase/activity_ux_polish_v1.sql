-- =============================================================================
-- activity_ux_polish_v1.sql
-- Draft submitted_at nullable; URL normalize; notify on open task + auditor docs.
-- Run after activity_draft_notify_v1.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Allow NULL submitted_at for drafts
-- -----------------------------------------------------------------------------
ALTER TABLE public.activity_submissions
  ALTER COLUMN submitted_at DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) Normalize external URLs (www.example.com → https://www.example.com)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._normalize_external_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := trim(COALESCE(p_url, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v ~* '^https?://' THEN RETURN v; END IF;
  -- Strip leading slashes so "/www.x.com" does not become a site-relative path
  v := regexp_replace(v, '^/+', '');
  IF v = '' THEN RETURN NULL; END IF;
  RETURN 'https://' || v;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Submit with normalized URLs (www OK)
-- -----------------------------------------------------------------------------
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
  v_video text := public._normalize_external_url(p_payload->>'video_url');
  v_doc text := public._normalize_external_url(p_payload->>'doc_url');
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
  IF COALESCE(t.include_video_url, true) AND v_video IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกลิงก์วิดีโอ');
  END IF;
  IF COALESCE(t.include_doc_url, true) AND v_doc IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกลิงก์เอกสาร');
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

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;

-- Draft: also normalize URLs when provided; submitted_at stays NULL
CREATE OR REPLACE FUNCTION public.save_activity_task_draft(
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
  v_video text := public._normalize_external_url(p_payload->>'video_url');
  v_doc text := public._normalize_external_url(p_payload->>'doc_url');
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
    t.id, p.profile_id, 'draft', v_name, v_detail, v_video, v_doc,
    v_video, v_doc, NULL, now()
  )
  ON CONFLICT (task_id, profile_id) DO UPDATE SET
    status = 'draft',
    report_name = EXCLUDED.report_name,
    report_detail = EXCLUDED.report_detail,
    video_url = EXCLUDED.video_url,
    doc_url = EXCLUDED.doc_url,
    report_url = EXCLUDED.report_url,
    file_path = EXCLUDED.file_path,
    submitted_at = NULL,
    updated_at = now(),
    reviewed_at = NULL, reviewed_by = NULL
  WHERE public.activity_submissions.status IS DISTINCT FROM 'approved';

  RETURN jsonb_build_object('ok', true, 'status', 'draft');
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Notify users when a task becomes open
-- -----------------------------------------------------------------------------
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
  v_was_open boolean := false;
  v_now_open boolean := false;
  v_name text;
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
    SELECT is_open, report_name INTO v_was_open, v_name
    FROM public.activity_tasks WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ');
    END IF;

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
    WHERE id = v_id
    RETURNING is_open, report_name INTO v_now_open, v_name;
  ELSE
    v_was_open := false;
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
      COALESCE((p_task->>'is_open')::boolean, false),
      COALESCE((p_task->>'activity_year')::integer, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer),
      a.admin_id,
      NULL
    )
    RETURNING id, is_open, report_name INTO v_id, v_now_open, v_name;
  END IF;

  IF COALESCE(v_now_open, false) AND NOT COALESCE(v_was_open, false) THEN
    PERFORM public._notify(
      'user',
      NULL,
      'มีภารกิจใหม่',
      format('ภารกิจ "%s" เปิดให้ส่งรายงานแล้ว', COALESCE(v_name, 'กิจกรรม')),
      'activity_assigned',
      '/portal/activity',
      jsonb_build_object('task_id', v_id)
    );
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_activity_task', 'activity_tasks', v_id::text, null, p_task);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) Auditor document upsert + notify assigned auditors
-- -----------------------------------------------------------------------------
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
  v_title text;
  v_url text;
  r record;
BEGIN
  a := public._admin_from_token(p_token);
  v_district := NULLIF(trim(COALESCE(p_doc->>'district_id', '')), '');
  v_title := NULLIF(trim(COALESCE(p_doc->>'title', '')), '');
  v_url := public._normalize_external_url(COALESCE(p_doc->>'file_url', p_doc->>'file_path'));

  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุเขต');
  END IF;
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อเอกสาร');
  END IF;

  IF NULLIF(trim(COALESCE(p_doc->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_doc->>'id')::uuid;
    UPDATE public.auditor_documents SET
      district_id = v_district,
      title = v_title,
      file_path = NULLIF(p_doc->>'file_path', ''),
      file_url = COALESCE(v_url, NULLIF(p_doc->>'file_url', '')),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบเอกสาร');
    END IF;
  ELSE
    INSERT INTO public.auditor_documents (district_id, title, file_path, file_url, created_by)
    VALUES (
      v_district,
      v_title,
      NULLIF(p_doc->>'file_path', ''),
      v_url,
      a.admin_id
    )
    RETURNING id INTO v_id;
  END IF;

  -- Notify auditors assigned to this district
  FOR r IN
    SELECT lower(trim(au.login_email)) AS login_email
    FROM public.audit_users au
    WHERE au.deleted_at IS NULL
      AND v_district = ANY (public._district_ids_from_jsonb(au.assigned_districts))
  LOOP
    PERFORM public._notify(
      'audit',
      r.login_email,
      'เอกสารใหม่ในเขต',
      format('มีเอกสาร "%s" สำหรับเขตของคุณ', v_title),
      'auditor_document',
      '/portal/audit/documents',
      jsonb_build_object('document_id', v_id, 'district_id', v_district)
    );
  END LOOP;

  PERFORM public._write_audit(a.admin_id, 'upsert_auditor_document', 'auditor_documents', v_id::text, null, p_doc);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public._normalize_external_url(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_activity_task(text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_activity_task_draft(text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_activity_task(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_auditor_document(text, jsonb) TO anon, authenticated, service_role;
