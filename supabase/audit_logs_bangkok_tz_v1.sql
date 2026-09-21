-- Audit log timestamps as Asia/Bangkok (GMT+7) in list / export / stats RPCs.
-- DB still stores timestamptz (absolute time); responses are formatted for Thailand.
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public._audit_ts_bkk(p_ts timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_ts IS NULL THEN NULL
    ELSE to_char(p_ts AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') || ' GMT+7'
  END;
$$;

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

CREATE OR REPLACE FUNCTION public.admin_audit_stats(p_token text)
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

  RETURN jsonb_build_object(
    'total_logs', (SELECT count(*) FROM public.audit_logs),
    'oldest_at', public._audit_ts_bkk((SELECT min(created_at) FROM public.audit_logs)),
    'newest_at', public._audit_ts_bkk((SELECT max(created_at) FROM public.audit_logs)),
    'purge_count', (SELECT count(*) FROM public.audit_purge_history)
  );
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
      'ip_address', l.ip_address,
      'created_at', public._audit_ts_bkk(l.created_at),
      'timezone', 'Asia/Bangkok (GMT+7)'
    ) ORDER BY l.created_at)
    FROM public.audit_logs l
    LEFT JOIN public.admins ad ON ad.admin_id = l.admin_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_audit_logs(
  p_token text,
  p_export_filename text,
  p_confirm text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_count int;
  v_oldest timestamptz;
  v_newest timestamptz;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF trim(p_confirm) <> 'PURGE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'พิมพ์ PURGE เพื่อยืนยัน');
  END IF;

  SELECT count(*), min(created_at), max(created_at)
  INTO v_count, v_oldest, v_newest
  FROM public.audit_logs;

  INSERT INTO public.audit_purge_history (
    admin_id, purged_count, export_filename, oldest_log_at, newest_log_at, note
  ) VALUES (
    a.admin_id, v_count, nullif(trim(p_export_filename), ''), v_oldest, v_newest,
    'Purged after external export. Keep the downloaded file for reference.'
  );

  DELETE FROM public.audit_logs;

  PERFORM public._write_audit(
    a.admin_id, 'purge_audit_logs', 'audit_logs', null, null,
    jsonb_build_object(
      'purged_count', v_count,
      'export_filename', p_export_filename
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purged_count', v_count,
    'oldest_at', public._audit_ts_bkk(v_oldest),
    'newest_at', public._audit_ts_bkk(v_newest)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_purge_history(p_token text)
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
      'purge_id', h.purge_id,
      'admin_id', h.admin_id,
      'admin_username', ad.username,
      'purged_count', h.purged_count,
      'export_filename', h.export_filename,
      'oldest_log_at', public._audit_ts_bkk(h.oldest_log_at),
      'newest_log_at', public._audit_ts_bkk(h.newest_log_at),
      'note', h.note,
      'created_at', public._audit_ts_bkk(h.created_at)
    ) ORDER BY h.created_at DESC)
    FROM public.audit_purge_history h
    LEFT JOIN public.admins ad ON ad.admin_id = h.admin_id
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public._audit_ts_bkk(timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_audit_logs(text, int, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_audit_stats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_audit_logs(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_audit_logs(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_purge_history(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
