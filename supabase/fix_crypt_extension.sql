-- Fix: crypt() not found on Supabase (pgcrypto lives in schema "extensions")
-- Run this in Supabase SQL Editor, then try admin login again.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

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

GRANT EXECUTE ON FUNCTION public.admin_login(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_password(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create(text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(text, uuid, text) TO anon, authenticated, service_role;
