-- =============================================================================
-- activity_draft_notify_v1.sql
-- Draft → pending → approved | deny→draft + notifications inbox for all roles.
-- Safe CREATE/REPLACE / ADD COLUMN. Run after activity_ux_fixes_v1.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Submission status: draft | pending | approved
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'activity_submissions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.activity_submissions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE public.activity_submissions
SET status = 'draft', updated_at = now()
WHERE status = 'rejected';

ALTER TABLE public.activity_submissions
  ADD CONSTRAINT activity_submissions_status_check
  CHECK (status IN ('draft', 'pending', 'approved'));

ALTER TABLE public.activity_submissions
  ALTER COLUMN status SET DEFAULT 'draft';

-- -----------------------------------------------------------------------------
-- 2) Notifications table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL
    CHECK (audience IN ('user', 'school_admin', 'admin', 'business', 'audit', 'all')),
  recipient_key text NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'system',
  link_path text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS notifications_audience_recipient_idx
  ON public.notifications (audience, recipient_key, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._notify(
  p_audience text,
  p_recipient_key text,
  p_title text,
  p_body text,
  p_kind text DEFAULT 'system',
  p_link_path text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.notifications (
    audience, recipient_key, title, body, kind, link_path, meta
  ) VALUES (
    COALESCE(NULLIF(trim(p_audience), ''), 'all'),
    NULLIF(trim(COALESCE(p_recipient_key, '')), ''),
    COALESCE(NULLIF(trim(p_title), ''), 'แจ้งเตือน'),
    COALESCE(p_body, ''),
    COALESCE(NULLIF(trim(p_kind), ''), 'system'),
    NULLIF(trim(COALESCE(p_link_path, '')), ''),
    COALESCE(p_meta, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Resolve caller identity for inbox RPCs
CREATE OR REPLACE FUNCTION public._notification_identity(
  p_audience text,
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_login_email text DEFAULT NULL,
  p_admin_token text DEFAULT NULL
)
RETURNS TABLE (audience text, recipient_key text, audiences text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  a public.admins;
  v_email text := lower(trim(COALESCE(p_login_email, '')));
  v_aud text := lower(trim(COALESCE(p_audience, '')));
  v_portal text;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_aud IN ('user', 'school_admin', 'candidate') THEN
    p := public._verify_profile_phone(p_profile_id, p_phone);
    v_portal := lower(trim(COALESCE(p.portal_role, 'user')));
    audience := CASE WHEN v_portal = 'school_admin' THEN 'school_admin' ELSE 'user' END;
    recipient_key := p.profile_id;
    IF audience = 'school_admin' THEN
      audiences := ARRAY['user', 'school_admin', 'all'];
    ELSE
      audiences := ARRAY['user', 'all'];
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_aud = 'admin' THEN
    a := public._admin_from_token(p_admin_token);
    audience := 'admin';
    recipient_key := a.admin_id::text;
    audiences := ARRAY['admin', 'all'];
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_aud = 'business' THEN
    IF v_email = '' OR NOT EXISTS (
      SELECT 1 FROM public.business_users
      WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_email
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    audience := 'business';
    recipient_key := v_email;
    audiences := ARRAY['business', 'all'];
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_aud = 'audit' THEN
    IF v_email = '' OR NOT EXISTS (
      SELECT 1 FROM public.audit_users
      WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_email
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    audience := 'audit';
    recipient_key := v_email;
    audiences := ARRAY['audit', 'all'];
    RETURN NEXT;
    RETURN;
  END IF;

  RAISE EXCEPTION 'unauthorized';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_notifications(
  p_audience text,
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_login_email text DEFAULT NULL,
  p_admin_token text DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idn record;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
  v_unread integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    SELECT * INTO idn FROM public._notification_identity(
      p_audience, p_profile_id, p_phone, p_login_email, p_admin_token
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT count(*)::integer INTO v_unread
  FROM public.notifications n
  WHERE n.audience = ANY (idn.audiences)
    AND (n.recipient_key IS NULL OR n.recipient_key = idn.recipient_key)
    AND n.read_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'unread_count', v_unread,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'body', n.body,
        'kind', n.kind,
        'link_path', n.link_path,
        'meta', n.meta,
        'created_at', n.created_at,
        'read_at', n.read_at,
        'is_unread', n.read_at IS NULL
      ) ORDER BY n.created_at DESC)
      FROM (
        SELECT *
        FROM public.notifications n
        WHERE n.audience = ANY (idn.audiences)
          AND (n.recipient_key IS NULL OR n.recipient_key = idn.recipient_key)
        ORDER BY n.created_at DESC
        LIMIT v_limit
      ) n
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id uuid,
  p_audience text,
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_login_email text DEFAULT NULL,
  p_admin_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idn record;
  n public.notifications;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    SELECT * INTO idn FROM public._notification_identity(
      p_audience, p_profile_id, p_phone, p_login_email, p_admin_token
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT * INTO n FROM public.notifications WHERE id = p_notification_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบการแจ้งเตือน');
  END IF;
  IF NOT (n.audience = ANY (idn.audiences)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์');
  END IF;
  IF n.recipient_key IS NOT NULL AND n.recipient_key IS DISTINCT FROM idn.recipient_key THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์');
  END IF;

  UPDATE public.notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = n.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_audience text,
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_login_email text DEFAULT NULL,
  p_admin_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idn record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    SELECT * INTO idn FROM public._notification_identity(
      p_audience, p_profile_id, p_phone, p_login_email, p_admin_token
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  UPDATE public.notifications n
  SET read_at = now()
  WHERE n.audience = ANY (idn.audiences)
    AND (n.recipient_key IS NULL OR n.recipient_key = idn.recipient_key)
    AND n.read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'marked', v_count);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) Save draft
-- -----------------------------------------------------------------------------
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
    updated_at = now(),
    reviewed_at = NULL, reviewed_by = NULL
    -- keep reviewer_note so user can see last deny reason
  WHERE public.activity_submissions.status IS DISTINCT FROM 'approved';

  RETURN jsonb_build_object('ok', true, 'status', 'draft');
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Submit → pending
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

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) Review: approve → score; deny → draft + notify
-- -----------------------------------------------------------------------------
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
  v_note text := NULLIF(trim(COALESCE(p_note, '')), '');
  v_body text;
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
  IF sub.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รายการนี้ยังไม่อยู่ในคิวรออนุมัติ');
  END IF;

  v_user_district := public._profile_district_id(sub.profile_id);
  IF v_user_district IS DISTINCT FROM v_district THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่อยู่ในเขตที่รับผิดชอบ');
  END IF;

  SELECT * INTO t FROM public.activity_tasks WHERE id = sub.task_id;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.activity_submissions SET
      status = 'approved', reviewed_at = now(), reviewed_by = lower(trim(p_login_email)),
      reviewer_note = v_note, updated_at = now()
    WHERE id = sub.id;
    PERFORM public._credit_score(sub.profile_id, COALESCE(t.score_points, 0), 'task', sub.task_id::text, t.report_name);
  ELSE
    UPDATE public.activity_submissions SET
      status = 'draft', reviewed_at = now(), reviewed_by = lower(trim(p_login_email)),
      reviewer_note = v_note, updated_at = now()
    WHERE id = sub.id;
    v_body := format(
      'ภารกิจ "%s" ถูกส่งกลับเป็นแบบร่าง กรุณาแก้ไขแล้วส่งใหม่%s',
      COALESCE(t.report_name, 'รายงาน'),
      CASE WHEN v_note IS NOT NULL THEN E'\nหมายเหตุ: ' || v_note ELSE '' END
    );
    PERFORM public._notify(
      'user',
      sub.profile_id,
      'รายงานไม่อนุมัติ',
      v_body,
      'task_denied',
      '/portal/activity',
      jsonb_build_object(
        'task_id', sub.task_id,
        'submission_id', sub.id,
        'reviewer', lower(trim(p_login_email))
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
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
  v_note text := NULLIF(trim(COALESCE(p_note, '')), '');
  v_body text;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT * INTO sub FROM public.activity_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรายการ'); END IF;
  IF sub.status = 'approved' THEN RETURN jsonb_build_object('ok', false, 'error', 'อนุมัติแล้ว'); END IF;
  IF sub.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รายการนี้ยังไม่อยู่ในคิวรออนุมัติ');
  END IF;
  SELECT * INTO t FROM public.activity_tasks WHERE id = sub.task_id;

  IF COALESCE(p_approve, false) THEN
    UPDATE public.activity_submissions SET
      status = 'approved', reviewed_at = now(), reviewed_by = 'admin:' || a.admin_id::text,
      reviewer_note = v_note, updated_at = now()
    WHERE id = sub.id;
    PERFORM public._credit_score(sub.profile_id, COALESCE(t.score_points, 0), 'task', sub.task_id::text, t.report_name);
  ELSE
    UPDATE public.activity_submissions SET
      status = 'draft', reviewed_at = now(), reviewed_by = 'admin:' || a.admin_id::text,
      reviewer_note = v_note, updated_at = now()
    WHERE id = sub.id;
    v_body := format(
      'ภารกิจ "%s" ถูกส่งกลับเป็นแบบร่าง กรุณาแก้ไขแล้วส่งใหม่%s',
      COALESCE(t.report_name, 'รายงาน'),
      CASE WHEN v_note IS NOT NULL THEN E'\nหมายเหตุ: ' || v_note ELSE '' END
    );
    PERFORM public._notify(
      'user',
      sub.profile_id,
      'รายงานไม่อนุมัติ',
      v_body,
      'task_denied',
      '/portal/activity',
      jsonb_build_object(
        'task_id', sub.task_id,
        'submission_id', sub.id,
        'reviewer', 'admin:' || a.admin_id::text
      )
    );
  END IF;
  PERFORM public._write_audit(a.admin_id, 'review_activity_submission', 'activity_submissions', sub.id::text, null,
    jsonb_build_object('approve', p_approve));
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public._notify(text, text, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_my_notifications(text, text, text, text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_activity_task_draft(text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_activity_task(text, text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_review_submission(text, uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_submission(text, uuid, boolean, text) TO anon, authenticated, service_role;
