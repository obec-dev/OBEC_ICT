-- Audit log list / export metadata / purge (super_admin)
-- Run in Supabase SQL Editor
-- Safe to re-run: creates missing prerequisite tables first

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ==========================================
-- Prerequisites (in case admins / audit_logs not created yet)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.admins (
  admin_id uuid NOT NULL DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role text NULL DEFAULT 'admin'::text,
  is_active boolean NULL DEFAULT true,
  must_change_password boolean NULL DEFAULT false,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT admins_pkey PRIMARY KEY (admin_id),
  CONSTRAINT admins_username_key UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_admins_username ON public.admins USING btree (username);

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  log_id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_id uuid NULL,
  action text NOT NULL,
  target_table text NOT NULL,
  target_id text NULL,
  old_data jsonb NULL,
  new_data jsonb NULL,
  ip_address text NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (log_id),
  CONSTRAINT audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins (admin_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.audit_logs USING btree (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs USING btree (target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.admins(admin_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON public.admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON public.admin_sessions(expires_at);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._admin_from_token(p_token text)
RETURNS public.admins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  SELECT ad.* INTO a
  FROM public.admin_sessions s
  JOIN public.admins ad ON ad.admin_id = s.admin_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND COALESCE(ad.is_active, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Slide expiry on successful use (keeps active admins signed in)
  UPDATE public.admin_sessions
  SET expires_at = now() + interval '12 hours'
  WHERE token = p_token;

  RETURN a;
END;
$$;

CREATE OR REPLACE FUNCTION public._write_audit(
  p_admin_id uuid,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_old_data jsonb,
  p_new_data jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, old_data, new_data)
  VALUES (p_admin_id, p_action, p_target_table, p_target_id, p_old_data, p_new_data);
END;
$$;

-- ==========================================
-- Purge history + RPCs
-- ==========================================
CREATE TABLE IF NOT EXISTS public.audit_purge_history (
  purge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.admins(admin_id) ON DELETE SET NULL,
  purged_count int NOT NULL DEFAULT 0,
  export_filename text,
  oldest_log_at timestamptz,
  newest_log_at timestamptz,
  note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_purge_history ENABLE ROW LEVEL SECURITY;

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
        'created_at', l.created_at
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
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN jsonb_build_object(
    'total_logs', (SELECT count(*) FROM public.audit_logs),
    'oldest_at', (SELECT min(created_at) FROM public.audit_logs),
    'newest_at', (SELECT max(created_at) FROM public.audit_logs),
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
      'created_at', l.created_at
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
    'oldest_at', v_oldest,
    'newest_at', v_newest
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
      'oldest_log_at', h.oldest_log_at,
      'newest_log_at', h.newest_log_at,
      'note', h.note,
      'created_at', h.created_at
    ) ORDER BY h.created_at DESC)
    FROM public.audit_purge_history h
    LEFT JOIN public.admins ad ON ad.admin_id = h.admin_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_overview_stats(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);

  RETURN jsonb_build_object(
    'schools_total', (SELECT count(*) FROM public.schools),
    'schools_registered', (
      SELECT count(*) FROM public.schools s
      WHERE COALESCE(s.is_registered, false)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.school_id = s.school_id)
    ),
    'districts_total', (SELECT count(*) FROM public.districts),
    'profiles_total', (SELECT count(*) FROM public.profiles),
    'profiles_today', (
      SELECT count(*) FROM public.profiles
      WHERE created_at::date = (timezone('Asia/Bangkok', now()))::date
    ),
    'watch_completed', (
      SELECT count(*) FROM public.watch_progress WHERE COALESCE(completed, false)
    ),
    'watch_total', (SELECT count(*) FROM public.watch_progress),
    'exam_submitted', (
      SELECT count(*) FROM public.exam_progress WHERE status = 'submitted'
    ),
    'exam_draft', (
      SELECT count(*) FROM public.exam_progress WHERE status = 'draft'
    ),
    'exam_total', (SELECT count(*) FROM public.exam_progress)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_audit_logs(text, int, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_audit_stats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_audit_logs(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_audit_logs(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_purge_history(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_overview_stats(text) TO anon, authenticated, service_role;
