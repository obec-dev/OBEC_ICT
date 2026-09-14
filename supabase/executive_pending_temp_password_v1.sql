-- =============================================================================
-- executive_pending_temp_password_v1.sql
-- Store plaintext temp password for admin display until first password setup
-- =============================================================================

ALTER TABLE public.business_users
  ADD COLUMN IF NOT EXISTS pending_temp_password text;

ALTER TABLE public.audit_users
  ADD COLUMN IF NOT EXISTS pending_temp_password text;

-- -----------------------------------------------------------------------------
-- Upserts: persist pending_temp_password alongside hash
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_business_user(
  p_token text,
  p_login_email text,
  p_display_name text,
  p_position text DEFAULT NULL,
  p_temp_password text DEFAULT NULL,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_id text := lower(trim(COALESCE(p_login_email, '')));
  v_name text := trim(COALESCE(p_display_name, ''));
  row_id uuid;
  temp_pw text;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' OR v_id !~ '^[a-z0-9._-]{3,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ต้องเป็น a-z 0-9 . _ - ความยาว 3–64 ตัว');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อแสดง');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE deleted_at IS NULL AND lower(trim(COALESCE(login_email, email, ''))) = v_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำกับผู้สมัคร');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_users WHERE deleted_at IS NULL AND lower(login_email) = v_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำกับ audit_user');
  END IF;

  temp_pw := NULLIF(trim(COALESCE(p_temp_password, '')), '');
  IF temp_pw IS NOT NULL AND length(temp_pw) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.business_users WHERE deleted_at IS NULL AND lower(login_email) = v_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำ');
    END IF;
    IF temp_pw IS NULL THEN
      temp_pw := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    END IF;
    INSERT INTO public.business_users (
      login_email, display_name, position, password_hash, must_set_password, pending_temp_password
    )
    VALUES (
      v_id, v_name, NULLIF(trim(COALESCE(p_position, '')), ''),
      extensions.crypt(temp_pw, extensions.gen_salt('bf')),
      true,
      temp_pw
    )
    RETURNING id INTO row_id;
  ELSE
    UPDATE public.business_users SET
      login_email = v_id,
      display_name = v_name,
      position = NULLIF(trim(COALESCE(p_position, '')), ''),
      password_hash = CASE
        WHEN temp_pw IS NOT NULL THEN extensions.crypt(temp_pw, extensions.gen_salt('bf'))
        ELSE password_hash
      END,
      must_set_password = CASE WHEN temp_pw IS NOT NULL THEN true ELSE must_set_password END,
      pending_temp_password = CASE
        WHEN temp_pw IS NOT NULL THEN temp_pw
        ELSE pending_temp_password
      END,
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO row_id;
    IF row_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', row_id, 'temp_password', temp_pw);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_audit_user(
  p_token text,
  p_login_email text,
  p_display_name text,
  p_position text DEFAULT NULL,
  p_assigned_districts jsonb DEFAULT '[]'::jsonb,
  p_temp_password text DEFAULT NULL,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_id text := lower(trim(COALESCE(p_login_email, '')));
  v_name text := trim(COALESCE(p_display_name, ''));
  v_districts jsonb := COALESCE(p_assigned_districts, '[]'::jsonb);
  row_id uuid;
  temp_pw text;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' OR v_id !~ '^[a-z0-9._-]{3,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ต้องเป็น a-z 0-9 . _ - ความยาว 3–64 ตัว');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อแสดง');
  END IF;
  IF jsonb_typeof(v_districts) <> 'array' OR jsonb_array_length(v_districts) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องมอบหมายอย่างน้อย 1 เขตการศึกษา');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE deleted_at IS NULL AND lower(trim(COALESCE(login_email, email, ''))) = v_id
  ) OR EXISTS (
    SELECT 1 FROM public.business_users WHERE deleted_at IS NULL AND lower(login_email) = v_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำกับบัญชีอื่น');
  END IF;

  temp_pw := NULLIF(trim(COALESCE(p_temp_password, '')), '');
  IF temp_pw IS NOT NULL AND length(temp_pw) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.audit_users WHERE deleted_at IS NULL AND lower(login_email) = v_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำ');
    END IF;
    IF temp_pw IS NULL THEN
      temp_pw := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    END IF;
    INSERT INTO public.audit_users (
      login_email, display_name, position, assigned_districts,
      password_hash, must_set_password, pending_temp_password
    )
    VALUES (
      v_id, v_name, NULLIF(trim(COALESCE(p_position, '')), ''), v_districts,
      extensions.crypt(temp_pw, extensions.gen_salt('bf')), true, temp_pw
    )
    RETURNING id INTO row_id;
  ELSE
    UPDATE public.audit_users SET
      login_email = v_id,
      display_name = v_name,
      position = NULLIF(trim(COALESCE(p_position, '')), ''),
      assigned_districts = v_districts,
      password_hash = CASE
        WHEN temp_pw IS NOT NULL THEN extensions.crypt(temp_pw, extensions.gen_salt('bf'))
        ELSE password_hash
      END,
      must_set_password = CASE WHEN temp_pw IS NOT NULL THEN true ELSE must_set_password END,
      pending_temp_password = CASE
        WHEN temp_pw IS NOT NULL THEN temp_pw
        ELSE pending_temp_password
      END,
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL
    RETURNING id INTO row_id;
    IF row_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', row_id, 'temp_password', temp_pw);
END;
$$;

-- Clear pending plaintext when executive finishes password setup
CREATE OR REPLACE FUNCTION public.set_executive_password(
  p_kind text,
  p_login_id text,
  p_current_password text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_kind text := lower(trim(COALESCE(p_kind, '')));
  v_id text := lower(trim(COALESCE(p_login_id, '')));
  bu public.business_users;
  au public.audit_users;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(trim(COALESCE(p_new_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF v_kind = 'business' THEN
    SELECT * INTO bu FROM public.business_users
    WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id LIMIT 1;
    IF NOT FOUND OR bu.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีหรือยังไม่มีรหัสผ่านชั่วคราว');
    END IF;
    IF extensions.crypt(p_current_password, bu.password_hash) IS DISTINCT FROM bu.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวไม่ถูกต้อง');
    END IF;
    UPDATE public.business_users SET
      password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      must_set_password = false,
      pending_temp_password = NULL,
      updated_at = now()
    WHERE id = bu.id
    RETURNING * INTO bu;
    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'business',
      'user', jsonb_build_object(
        'id', bu.id,
        'login_email', bu.login_email,
        'display_name', bu.display_name,
        'position', bu.position,
        'must_set_password', false
      )
    );
  END IF;

  IF v_kind = 'audit' THEN
    SELECT * INTO au FROM public.audit_users
    WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id LIMIT 1;
    IF NOT FOUND OR au.password_hash IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีหรือยังไม่มีรหัสผ่านชั่วคราว');
    END IF;
    IF extensions.crypt(p_current_password, au.password_hash) IS DISTINCT FROM au.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวไม่ถูกต้อง');
    END IF;
    UPDATE public.audit_users SET
      password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      must_set_password = false,
      pending_temp_password = NULL,
      updated_at = now()
    WHERE id = au.id
    RETURNING * INTO au;
    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'audit',
      'user', jsonb_build_object(
        'id', au.id,
        'login_email', au.login_email,
        'display_name', au.display_name,
        'position', au.position,
        'assigned_districts', COALESCE(au.assigned_districts, '[]'::jsonb),
        'must_set_password', false
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'ชนิดบัญชีไม่ถูกต้อง');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_executive_temp_password(
  p_token text,
  p_kind text,
  p_id uuid,
  p_temp_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_kind text := lower(trim(COALESCE(p_kind, '')));
  temp_pw text := NULLIF(trim(COALESCE(p_temp_password, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF temp_pw IS NULL THEN
    temp_pw := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  END IF;
  IF length(temp_pw) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF v_kind = 'business' THEN
    UPDATE public.business_users SET
      password_hash = extensions.crypt(temp_pw, extensions.gen_salt('bf')),
      must_set_password = true,
      pending_temp_password = temp_pw,
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSIF v_kind = 'audit' THEN
    UPDATE public.audit_users SET
      password_hash = extensions.crypt(temp_pw, extensions.gen_salt('bf')),
      must_set_password = true,
      pending_temp_password = temp_pw,
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'ชนิดบัญชีไม่ถูกต้อง');
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, 'reset_executive_temp_password',
    CASE WHEN v_kind = 'business' THEN 'business_users' ELSE 'audit_users' END,
    p_id::text, jsonb_build_object('kind', v_kind, 'must_set_password', true));

  RETURN jsonb_build_object('ok', true, 'temp_password', temp_pw);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_executive_users(
  p_token text,
  p_kind text DEFAULT 'all',
  p_include_deleted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_kind text := lower(trim(COALESCE(p_kind, 'all')));
  biz jsonb := '[]'::jsonb;
  aud jsonb := '[]'::jsonb;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_kind IN ('all', 'business') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', b.id,
      'kind', 'business',
      'login_email', b.login_email,
      'display_name', b.display_name,
      'position', b.position,
      'is_active', b.is_active,
      'must_set_password', b.must_set_password,
      'pending_temp_password', CASE
        WHEN b.must_set_password THEN b.pending_temp_password
        ELSE NULL
      END,
      'deleted_at', b.deleted_at,
      'created_at', b.created_at
    ) ORDER BY b.created_at DESC), '[]'::jsonb)
    INTO biz
    FROM public.business_users b
    WHERE p_include_deleted OR b.deleted_at IS NULL;
  END IF;

  IF v_kind IN ('all', 'audit') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', u.id,
      'kind', 'audit',
      'login_email', u.login_email,
      'display_name', u.display_name,
      'position', u.position,
      'assigned_districts', COALESCE(u.assigned_districts, '[]'::jsonb),
      'is_active', u.is_active,
      'must_set_password', u.must_set_password,
      'pending_temp_password', CASE
        WHEN u.must_set_password THEN u.pending_temp_password
        ELSE NULL
      END,
      'deleted_at', u.deleted_at,
      'created_at', u.created_at
    ) ORDER BY u.created_at DESC), '[]'::jsonb)
    INTO aud
    FROM public.audit_users u
    WHERE p_include_deleted OR u.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'business', biz, 'audit', aud);
END;
$$;
