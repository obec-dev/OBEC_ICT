-- Clearer admin activity audit logs: summary + before/after for key actions.
-- Run in Supabase SQL Editor after prior admin/audit migrations.

-- -----------------------------------------------------------------------------
-- 1) Schema + _write_audit
-- -----------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS summary text NULL;

CREATE OR REPLACE FUNCTION public._audit_profile_label(
  p_title text,
  p_first text,
  p_last text,
  p_profile_id text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format(
    '%s (%s)',
    COALESCE(
      NULLIF(
        trim(concat_ws(
          ' ',
          NULLIF(trim(COALESCE(p_title, '')), ''),
          NULLIF(trim(COALESCE(p_first, '')), ''),
          NULLIF(trim(COALESCE(p_last, '')), '')
        )),
        ''
      ),
      COALESCE(NULLIF(trim(p_profile_id), ''), '?')
    ),
    COALESCE(NULLIF(trim(p_profile_id), ''), '?')
  );
$$;

DROP FUNCTION IF EXISTS public._write_audit(uuid, text, text, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public._write_audit(
  p_admin_id uuid,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_old_data jsonb,
  p_new_data jsonb,
  p_summary text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    admin_id, action, target_table, target_id, old_data, new_data, summary
  ) VALUES (
    p_admin_id, p_action, p_target_table, p_target_id, p_old_data, p_new_data,
    NULLIF(trim(COALESCE(p_summary, '')), '')
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) List / export include summary (Bangkok timestamps preserved)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit_logs(
  p_token text,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row_data ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'log_id', l.log_id,
        'admin_id', l.admin_id,
        'admin_username', ad.username,
        'admin_full_name', ad.full_name,
        'action', l.action,
        'target_table', l.target_table,
        'target_id', l.target_id,
        'old_data', l.old_data,
        'new_data', l.new_data,
        'summary', l.summary,
        'ip_address', l.ip_address,
        'created_at', public._audit_ts_bkk(l.created_at)
      ) AS row_data,
      l.created_at
      FROM public.audit_logs l
      LEFT JOIN public.admins ad ON ad.admin_id = l.admin_id
      ORDER BY l.created_at DESC
      LIMIT GREATEST(p_limit, 1)
      OFFSET GREATEST(p_offset, 0)
    ) t
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_export_audit_logs(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'log_id', l.log_id,
      'admin_id', l.admin_id,
      'admin_username', ad.username,
      'action', l.action,
      'target_table', l.target_table,
      'target_id', l.target_id,
      'old_data', l.old_data,
      'new_data', l.new_data,
      'summary', l.summary,
      'ip_address', l.ip_address,
      'created_at', public._audit_ts_bkk(l.created_at),
      'timezone', 'Asia/Bangkok (GMT+7)'
    ) ORDER BY l.created_at)
    FROM public.audit_logs l
    LEFT JOIN public.admins ad ON ad.admin_id = l.admin_id
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3) User suspend / soft-delete / restore
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_active(
  p_token text,
  p_profile_id text,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  old_p public.profiles;
  p public.profiles;
  v_label text;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO old_p
  FROM public.profiles
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  UPDATE public.profiles
  SET is_active = COALESCE(p_is_active, true), updated_at = now()
  WHERE profile_id = old_p.profile_id
  RETURNING * INTO p;

  v_label := public._audit_profile_label(p.title_th, p.first_name, p.last_name, p.profile_id);

  PERFORM public._write_audit(
    a.admin_id,
    CASE WHEN p.is_active THEN 'unsuspend_user' ELSE 'suspend_user' END,
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'is_active', old_p.is_active,
      'full_name', trim(concat_ws(' ', old_p.title_th, old_p.first_name, old_p.last_name)),
      'login_email', COALESCE(old_p.login_email, old_p.email)
    ),
    jsonb_build_object(
      'is_active', p.is_active,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'login_email', COALESCE(p.login_email, p.email)
    ),
    CASE
      WHEN p.is_active THEN 'ยกเลิกการระงับผู้ใช้: ' || v_label
      ELSE 'ระงับผู้ใช้: ' || v_label
    END
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  old_p public.profiles;
  p public.profiles;
  v_exam int := 0;
  v_watch int := 0;
  v_label text;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO old_p
  FROM public.profiles
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งานหรือถูกลบแล้ว');
  END IF;

  UPDATE public.profiles
  SET deleted_at = now(), is_active = false, updated_at = now()
  WHERE profile_id = old_p.profile_id
  RETURNING * INTO p;

  SELECT count(*) INTO v_exam FROM public.exam_progress WHERE profile_id = p.profile_id;
  SELECT count(*) INTO v_watch FROM public.watch_progress WHERE profile_id = p.profile_id;

  IF to_regclass('public.sync_school_is_registered') IS NOT NULL THEN
    PERFORM public.sync_school_is_registered(p.school_id);
  END IF;

  v_label := public._audit_profile_label(
    old_p.title_th, old_p.first_name, old_p.last_name, old_p.profile_id
  );

  PERFORM public._write_audit(
    a.admin_id,
    'soft_delete_user',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'is_active', old_p.is_active,
      'deleted_at', old_p.deleted_at,
      'full_name', trim(concat_ws(' ', old_p.title_th, old_p.first_name, old_p.last_name)),
      'login_email', COALESCE(old_p.login_email, old_p.email)
    ),
    jsonb_build_object(
      'is_active', p.is_active,
      'deleted_at', p.deleted_at,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'login_email', COALESCE(p.login_email, p.email),
      'retained_exam_progress', v_exam,
      'retained_watch_progress', v_watch
    ),
    'ลบผู้ใช้ (soft): ' || v_label
  );

  RETURN jsonb_build_object(
    'ok', true,
    'retained_exam_progress', v_exam,
    'retained_watch_progress', v_watch
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  old_p public.profiles;
  p public.profiles;
  clash text;
  v_exam int := 0;
  v_watch int := 0;
  v_label text;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO old_p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีในถังกู้คืน');
  END IF;

  IF old_p.email IS NOT NULL AND NULLIF(trim(old_p.email), '') IS NOT NULL THEN
    SELECT profile_id INTO clash
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND lower(trim(email)) = lower(trim(old_p.email))
      AND profile_id <> old_p.profile_id
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถกู้คืนได้ เนื่องจากอีเมลถูกใช้โดยบัญชีอื่นแล้ว');
    END IF;
  END IF;

  SELECT count(*) INTO v_exam FROM public.exam_progress WHERE profile_id = old_p.profile_id;
  SELECT count(*) INTO v_watch FROM public.watch_progress WHERE profile_id = old_p.profile_id;

  UPDATE public.profiles
  SET deleted_at = NULL, is_active = true, updated_at = now()
  WHERE profile_id = old_p.profile_id
  RETURNING * INTO p;

  IF to_regclass('public.sync_school_is_registered') IS NOT NULL THEN
    PERFORM public.sync_school_is_registered(p.school_id);
  END IF;

  v_label := public._audit_profile_label(p.title_th, p.first_name, p.last_name, p.profile_id);

  PERFORM public._write_audit(
    a.admin_id,
    'restore_user',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'is_active', old_p.is_active,
      'deleted_at', old_p.deleted_at,
      'full_name', trim(concat_ws(' ', old_p.title_th, old_p.first_name, old_p.last_name)),
      'login_email', COALESCE(old_p.login_email, old_p.email)
    ),
    jsonb_build_object(
      'is_active', p.is_active,
      'deleted_at', p.deleted_at,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'login_email', COALESCE(p.login_email, p.email),
      'exam_progress_intact', v_exam,
      'watch_progress_intact', v_watch
    ),
    'กู้คืนผู้ใช้: ' || v_label
  );

  RETURN jsonb_build_object(
    'ok', true,
    'profile', public._profile_to_json(p),
    'exam_progress_intact', v_exam,
    'watch_progress_intact', v_watch
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4) Portal role / login email
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_portal_role(
  p_token text,
  p_profile_id text,
  p_role text,
  p_assigned_district_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  v_role text := lower(trim(COALESCE(p_role, '')));
  old_role text;
  v_label text;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_role NOT IN ('user', 'school_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บทบาทผู้สมัครต้องเป็น user หรือ school_admin (executive แยกตาราง)');
  END IF;

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  old_role := COALESCE(p.portal_role, 'user');
  v_label := public._audit_profile_label(p.title_th, p.first_name, p.last_name, p.profile_id);

  IF v_role = 'school_admin' THEN
    UPDATE public.profiles
    SET is_school_admin = false,
        portal_role = CASE WHEN portal_role = 'school_admin' THEN 'user' ELSE portal_role END,
        updated_at = now()
    WHERE school_id = p.school_id
      AND profile_id <> p.profile_id
      AND deleted_at IS NULL
      AND (is_school_admin = true OR portal_role = 'school_admin');
  END IF;

  UPDATE public.profiles SET
    portal_role = v_role,
    is_school_admin = (v_role = 'school_admin'),
    assigned_district_id = NULL,
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  PERFORM public._write_audit(
    a.admin_id,
    'set_portal_role',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'portal_role', old_role,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'login_email', COALESCE(p.login_email, p.email)
    ),
    jsonb_build_object(
      'portal_role', v_role,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'login_email', COALESCE(p.login_email, p.email)
    ),
    format('เปลี่ยนบทบาท: %s (%s → %s)', v_label, old_role, v_role)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_login_email(
  p_token text,
  p_profile_id text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  v_email text := lower(trim(COALESCE(p_email, '')));
  existing_id text;
  old_login text;
  v_label text;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รูปแบบ Login ID (อีเมล) ไม่ถูกต้อง');
  END IF;

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  old_login := COALESCE(p.login_email, p.email);
  v_label := public._audit_profile_label(p.title_th, p.first_name, p.last_name, p.profile_id);

  SELECT profile_id INTO existing_id
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
    AND profile_id <> p.profile_id
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID นี้ถูกใช้งานโดยบัญชีอื่นแล้ว');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_users WHERE deleted_at IS NULL AND lower(login_email) = v_email
  ) OR EXISTS (
    SELECT 1 FROM public.audit_users WHERE deleted_at IS NULL AND lower(login_email) = v_email
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID นี้ถูกใช้งานโดยบัญชีอื่นแล้ว');
  END IF;

  UPDATE public.profiles
  SET login_email = v_email, updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  PERFORM public._write_audit(
    a.admin_id,
    'update_login_email',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'login_email', old_login,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'profile_id', p.profile_id
    ),
    jsonb_build_object(
      'login_email', v_email,
      'full_name', trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
      'profile_id', p.profile_id,
      'contact_email_unchanged', true
    ),
    format('เปลี่ยน Login ID: %s (%s → %s)', v_label, COALESCE(old_login, '-'), v_email)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- -----------------------------------------------------------------------------
-- 5) Settings — per-key before/after
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_settings(p_token text, p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  k text;
  v jsonb;
  v_prev jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_summary text;
BEGIN
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(COALESCE(p_settings, '{}'::jsonb))
  LOOP
    SELECT s.value INTO v_prev FROM public.site_settings s WHERE s.key = k;
    IF v_prev IS DISTINCT FROM v THEN
      v_changes := v_changes || jsonb_build_array(
        jsonb_build_object('key', k, 'before', v_prev, 'after', v)
      );
      v_keys := array_append(v_keys, k);
    END IF;

    INSERT INTO public.site_settings (key, value, updated_at, updated_by)
    VALUES (k, v, now(), a.admin_id)
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value,
          updated_at = now(),
          updated_by = a.admin_id;
  END LOOP;

  IF cardinality(v_keys) > 0 THEN
    v_summary := 'เปลี่ยนการตั้งค่า: ' || array_to_string(v_keys, ', ');
  ELSE
    v_summary := 'บันทึกการตั้งค่า (ไม่มีการเปลี่ยนแปลงค่า)';
  END IF;

  PERFORM public._write_audit(
    a.admin_id,
    'update_settings',
    'site_settings',
    NULL,
    jsonb_build_object('changes', v_changes),
    jsonb_build_object('changes', v_changes),
    v_summary
  );

  RETURN jsonb_build_object('ok', true, 'changed_keys', to_jsonb(v_keys));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Score adjust — new audit rows
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_score(
  p_token text,
  p_profile_id text,
  p_points integer,
  p_remark text,
  p_notify boolean DEFAULT false,
  p_user_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_profile text := trim(COALESCE(p_profile_id, ''));
  v_remark text := trim(COALESCE(p_remark, ''));
  v_user_comment text := NULLIF(trim(COALESCE(p_user_comment, '')), '');
  v_points integer := COALESCE(p_points, 0);
  v_source_id text := gen_random_uuid()::text;
  v_ledger_id uuid;
  v_adj_id uuid;
  v_title text;
  v_body text;
  v_total integer := 0;
  v_name text;
  v_label text;
  v_sign text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  IF v_profile = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้');
  END IF;

  SELECT
    trim(concat_ws(' ', p.title_th, p.first_name, p.last_name)),
    public._audit_profile_label(p.title_th, p.first_name, p.last_name, p.profile_id)
  INTO v_name, v_label
  FROM public.profiles p
  WHERE p.profile_id = v_profile;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้');
  END IF;
  IF v_points = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'คะแนนต้องไม่เป็น 0');
  END IF;
  IF v_remark = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุความคิดเห็นแอดมิน');
  END IF;

  INSERT INTO public.score_ledger (profile_id, points, source, source_id, note)
  VALUES (v_profile, v_points, 'manual', v_source_id, v_remark)
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.score_adjustments (
    profile_id, points, remark, notify_user, admin_id, ledger_id
  ) VALUES (
    v_profile, v_points, v_remark, COALESCE(p_notify, false), a.admin_id, v_ledger_id
  )
  RETURNING id INTO v_adj_id;

  IF COALESCE(p_notify, false) THEN
    IF v_points > 0 THEN
      v_title := 'ได้รับคะแนนเพิ่ม';
      v_body := format('ระบบได้ปรับคะแนนของคุณ +%s คะแนน', v_points);
    ELSE
      v_title := 'มีการหักคะแนน';
      v_body := format('ระบบได้ปรับคะแนนของคุณ %s คะแนน', v_points);
    END IF;
    IF v_user_comment IS NOT NULL THEN
      v_body := v_body || E'\n' || v_user_comment;
    END IF;
    PERFORM public._notify(
      'user',
      v_profile,
      v_title,
      v_body,
      'score_adjust',
      '/portal/activity',
      jsonb_build_object(
        'points', v_points,
        'adjustment_id', v_adj_id,
        'has_admin_comment', v_user_comment IS NOT NULL
      )
    );
  END IF;

  SELECT COALESCE(SUM(sl.points), 0)::integer INTO v_total
  FROM public.score_ledger sl
  WHERE sl.profile_id = v_profile;

  v_sign := CASE WHEN v_points > 0 THEN '+' ELSE '' END;

  PERFORM public._write_audit(
    a.admin_id,
    'adjust_score',
    'score_adjustments',
    v_adj_id::text,
    NULL,
    jsonb_build_object(
      'profile_id', v_profile,
      'full_name', v_name,
      'points', v_points,
      'remark', v_remark,
      'notify_user', COALESCE(p_notify, false),
      'user_comment', v_user_comment,
      'ledger_id', v_ledger_id,
      'total_score', v_total
    ),
    format('ปรับคะแนน %s: %s%s', v_label, v_sign, v_points)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_adj_id,
    'ledger_id', v_ledger_id,
    'points', v_points,
    'total_score', v_total
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Self-learn video upsert / delete
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_self_learn_video(p_token text, p_video jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_title text;
  v_url text;
  v_score integer;
  v_sort integer;
  v_pub boolean;
  old_row public.self_learn_videos;
  v_is_update boolean := false;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  v_title := NULLIF(trim(COALESCE(p_video->>'title', '')), '');
  v_url := NULLIF(trim(COALESCE(p_video->>'video_url', '')), '');
  v_score := COALESCE((p_video->>'score_points')::integer, 0);
  v_sort := COALESCE((p_video->>'sort_order')::integer, 0);
  v_pub := COALESCE((p_video->>'is_published')::boolean, false);

  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อวิดีโอ');
  END IF;
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุลิงก์วิดีโอ');
  END IF;

  IF NULLIF(trim(COALESCE(p_video->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_video->>'id')::uuid;
    SELECT * INTO old_row FROM public.self_learn_videos WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
    END IF;
    v_is_update := true;

    UPDATE public.self_learn_videos SET
      title = v_title,
      video_url = v_url,
      score_points = v_score,
      sort_order = v_sort,
      is_published = v_pub,
      updated_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.self_learn_videos (title, video_url, score_points, sort_order, is_published)
    VALUES (v_title, v_url, v_score, v_sort, v_pub)
    RETURNING id INTO v_id;
  END IF;

  IF v_is_update THEN
    PERFORM public._write_audit(
      a.admin_id,
      'update_self_learn_video',
      'self_learn_videos',
      v_id::text,
      jsonb_build_object(
        'title', old_row.title,
        'video_url', old_row.video_url,
        'score_points', old_row.score_points,
        'sort_order', old_row.sort_order,
        'is_published', old_row.is_published
      ),
      jsonb_build_object(
        'title', v_title,
        'video_url', v_url,
        'score_points', v_score,
        'sort_order', v_sort,
        'is_published', v_pub
      ),
      'แก้ไขวิดีโอ E-learning: ' || v_title
    );
  ELSE
    PERFORM public._write_audit(
      a.admin_id,
      'create_self_learn_video',
      'self_learn_videos',
      v_id::text,
      NULL,
      jsonb_build_object(
        'title', v_title,
        'video_url', v_url,
        'score_points', v_score,
        'sort_order', v_sort,
        'is_published', v_pub
      ),
      'สร้างวิดีโอ E-learning: ' || v_title
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_self_learn_video(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  old_row public.self_learn_videos;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  SELECT * INTO old_row FROM public.self_learn_videos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
  END IF;

  DELETE FROM public.self_learn_videos WHERE id = p_id;

  PERFORM public._write_audit(
    a.admin_id,
    'delete_self_learn_video',
    'self_learn_videos',
    p_id::text,
    jsonb_build_object(
      'title', old_row.title,
      'video_url', old_row.video_url,
      'score_points', old_row.score_points,
      'sort_order', old_row.sort_order,
      'is_published', old_row.is_published
    ),
    NULL,
    'ลบวิดีโอ E-learning: ' || COALESCE(old_row.title, p_id::text)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public._audit_profile_label(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._write_audit(uuid, text, text, text, jsonb, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_logs(text, int, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_audit_logs(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_user(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_portal_role(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_login_email(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_settings(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_score(text, text, integer, text, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_self_learn_video(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_self_learn_video(text, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
