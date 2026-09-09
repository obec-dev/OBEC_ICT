-- ==========================================
-- Admin auth, sessions, settings, audit RPCs
-- Run in Supabase SQL Editor
-- ==========================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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
  CONSTRAINT audit_logs_pkey PRIMARY KEY (log_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_admin_id_fkey'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_admin_id_fkey
      FOREIGN KEY (admin_id) REFERENCES public.admins (admin_id) ON DELETE SET NULL;
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES public.admins(admin_id) ON DELETE SET NULL
);

INSERT INTO public.site_settings (key, value)
VALUES
  ('site_name', '"ICT Representative"'::jsonb),
  ('registration_open', 'true'::jsonb),
  ('login_announce_message', '"วันเปิดเข้าสู่ระบบเรียน/สอบ จะประกาศให้ทราบภายหลัง"'::jsonb),
  ('registration_start', 'null'::jsonb),
  ('registration_end', 'null'::jsonb),
  ('exam_start', 'null'::jsonb),
  ('exam_end', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- No direct public access; use SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "deny all admins" ON public.admins;
DROP POLICY IF EXISTS "deny all admin_sessions" ON public.admin_sessions;
DROP POLICY IF EXISTS "deny all audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "public read site_settings" ON public.site_settings;

CREATE POLICY "public read site_settings" ON public.site_settings FOR SELECT USING (true);

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

CREATE OR REPLACE FUNCTION public.admin_login(p_username text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_token text;
  v_ok boolean := false;
  v_must boolean := false;
BEGIN
  SELECT * INTO a
  FROM public.admins
  WHERE username = trim(p_username)
    AND COALESCE(is_active, true) = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  END IF;

  IF a.password_hash IS NOT NULL AND length(a.password_hash) > 20
     AND extensions.crypt(p_password, a.password_hash) = a.password_hash THEN
    v_ok := true;
    v_must := COALESCE(a.must_change_password, false);
  ELSIF a.password_hash = p_password THEN
    -- bootstrap plain-text password
    v_ok := true;
    v_must := true;
  END IF;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.admin_sessions (token, admin_id, expires_at)
  VALUES (v_token, a.admin_id, now() + interval '12 hours');

  PERFORM public._write_audit(a.admin_id, 'login', 'admins', a.admin_id::text, null, null);

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'admin', jsonb_build_object(
      'admin_id', a.admin_id,
      'username', a.username,
      'full_name', a.full_name,
      'role', COALESCE(a.role, 'admin'),
      'must_change_password', v_must
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_logout(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  BEGIN
    a := public._admin_from_token(p_token);
    PERFORM public._write_audit(a.admin_id, 'logout', 'admins', a.admin_id::text, null, null);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  DELETE FROM public.admin_sessions WHERE token = p_token;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_change_password(
  p_token text,
  p_old_password text,
  p_new_password text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_ok boolean := false;
BEGIN
  a := public._admin_from_token(p_token);

  IF length(trim(p_new_password)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF a.password_hash IS NOT NULL AND length(a.password_hash) > 20
     AND extensions.crypt(p_old_password, a.password_hash) = a.password_hash THEN
    v_ok := true;
  ELSIF a.password_hash = p_old_password THEN
    v_ok := true;
  END IF;

  IF NOT v_ok THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านเดิมไม่ถูกต้อง');
  END IF;

  UPDATE public.admins
  SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      must_change_password = false,
      updated_at = now()
  WHERE admin_id = a.admin_id;

  PERFORM public._write_audit(a.admin_id, 'change_password', 'admins', a.admin_id::text, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list(p_token text)
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
      'admin_id', x.admin_id,
      'username', x.username,
      'full_name', x.full_name,
      'role', coalesce(x.role, 'admin'),
      'is_active', coalesce(x.is_active, true),
      'must_change_password', coalesce(x.must_change_password, false),
      'created_at', x.created_at
    ) ORDER BY x.created_at)
    FROM public.admins x
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create(
  p_token text,
  p_username text,
  p_full_name text,
  p_role text,
  p_temp_password text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  new_id uuid;
BEGIN
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'role ไม่ถูกต้อง');
  END IF;

  INSERT INTO public.admins (username, password_hash, full_name, role, is_active, must_change_password)
  VALUES (
    trim(p_username),
    extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
    trim(p_full_name),
    p_role,
    true,
    true
  )
  RETURNING admin_id INTO new_id;

  PERFORM public._write_audit(
    a.admin_id, 'create_admin', 'admins', new_id::text, null,
    jsonb_build_object('username', trim(p_username), 'role', p_role)
  );

  RETURN jsonb_build_object('ok', true, 'admin_id', new_id, 'temp_password', p_temp_password);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'username นี้มีอยู่แล้ว');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_token text,
  p_target_admin_id uuid,
  p_temp_password text
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

  UPDATE public.admins
  SET password_hash = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
      must_change_password = true,
      updated_at = now()
  WHERE admin_id = p_target_admin_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ดูแล');
  END IF;

  DELETE FROM public.admin_sessions WHERE admin_id = p_target_admin_id;

  PERFORM public._write_audit(
    a.admin_id, 'reset_password', 'admins', p_target_admin_id::text, null,
    jsonb_build_object('must_change_password', true)
  );

  RETURN jsonb_build_object('ok', true, 'temp_password', p_temp_password);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_active(
  p_token text,
  p_target_admin_id uuid,
  p_is_active boolean
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

  IF a.admin_id = p_target_admin_id AND p_is_active = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถระงับบัญชีของตนเองได้');
  END IF;

  UPDATE public.admins
  SET is_active = p_is_active, updated_at = now()
  WHERE admin_id = p_target_admin_id;

  IF p_is_active = false THEN
    DELETE FROM public.admin_sessions WHERE admin_id = p_target_admin_id;
  END IF;

  PERFORM public._write_audit(
    a.admin_id, CASE WHEN p_is_active THEN 'activate_admin' ELSE 'suspend_admin' END,
    'admins', p_target_admin_id::text, null, jsonb_build_object('is_active', p_is_active)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_role(
  p_token text,
  p_target_admin_id uuid,
  p_role text
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

  IF p_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'role ไม่ถูกต้อง');
  END IF;

  IF a.admin_id = p_target_admin_id AND p_role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถลดสิทธิ์บัญชีของตนเองได้');
  END IF;

  UPDATE public.admins
  SET role = p_role, updated_at = now()
  WHERE admin_id = p_target_admin_id;

  PERFORM public._write_audit(
    a.admin_id, 'set_role', 'admins', p_target_admin_id::text, null,
    jsonb_build_object('role', p_role)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_settings(p_token text)
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
    SELECT jsonb_object_agg(s.key, s.value) FROM public.site_settings s
  ), '{}'::jsonb);
END;
$$;

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
BEGIN
  a := public._admin_from_token(p_token);
  IF COALESCE(a.role, 'admin') <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR k, v IN SELECT * FROM jsonb_each(p_settings)
  LOOP
    INSERT INTO public.site_settings (key, value, updated_at, updated_by)
    VALUES (k, v, now(), a.admin_id)
    ON CONFLICT (key) DO UPDATE
      SET value = excluded.value,
          updated_at = now(),
          updated_by = a.admin_id;
  END LOOP;

  PERFORM public._write_audit(a.admin_id, 'update_settings', 'site_settings', null, null, p_settings);
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_profiles_by_school(p_token text, p_school_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', p.profile_id,
      'school_id', p.school_id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'phone', p.phone,
      'remark', p.remark,
      'created_at', p.created_at
    ) ORDER BY p.created_at)
    FROM public.profiles p
    WHERE p.school_id = p_school_id
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_token text,
  p_profile_id text,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_remark text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  old_row public.profiles;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO old_row FROM public.profiles WHERE profile_id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้สมัคร');
  END IF;

  UPDATE public.profiles
  SET first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      phone = trim(p_phone),
      remark = nullif(trim(p_remark), ''),
      updated_at = now()
  WHERE profile_id = p_profile_id;

  PERFORM public._write_audit(
    a.admin_id, 'update_profile', 'profiles', p_profile_id,
    to_jsonb(old_row),
    jsonb_build_object(
      'first_name', trim(p_first_name),
      'last_name', trim(p_last_name),
      'phone', trim(p_phone),
      'remark', nullif(trim(p_remark), '')
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_profile(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  old_row public.profiles;
  remain int;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO old_row FROM public.profiles WHERE profile_id = p_profile_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้สมัคร');
  END IF;

  DELETE FROM public.profiles WHERE profile_id = p_profile_id;

  SELECT count(*) INTO remain FROM public.profiles WHERE school_id = old_row.school_id;
  IF remain = 0 THEN
    UPDATE public.schools SET is_registered = false, updated_at = now()
    WHERE school_id = old_row.school_id;
  END IF;

  PERFORM public._write_audit(
    a.admin_id, 'delete_profile', 'profiles', p_profile_id, to_jsonb(old_row), null
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_school_profiles(p_token text, p_school_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  deleted_count int;
BEGIN
  a := public._admin_from_token(p_token);

  WITH deleted AS (
    DELETE FROM public.profiles WHERE school_id = p_school_id RETURNING *
  )
  SELECT count(*) INTO deleted_count FROM deleted;

  UPDATE public.schools
  SET is_registered = false, updated_at = now()
  WHERE school_id = p_school_id;

  PERFORM public._write_audit(
    a.admin_id, 'delete_school_profiles', 'profiles', p_school_id,
    null, jsonb_build_object('deleted_count', deleted_count)
  );

  RETURN jsonb_build_object('ok', true, 'deleted_count', deleted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_login(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_logout(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_password(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create(text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_active(text, uuid, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_role(text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_settings(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_settings(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles_by_school(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_profile(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_school_profiles(text, text) TO anon, authenticated, service_role;
