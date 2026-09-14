-- =============================================================================
-- executive_login_id_actions_v1.sql
-- Alphanumeric Login ID for executives; temp-password first login;
-- suspend / soft-delete / reset temp password RPCs
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1) login_candidate: verify executive password BEFORE must_set_password gate
--    Login ID is case-insensitive text (not email-only)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.login_candidate(text, text);

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

  -- Candidates (email login_email)
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
        'ok', false,
        'need_password_setup', true,
        'kind', 'candidate',
        'login_email', COALESCE(p.login_email, lower(trim(p.email))),
        'profile_id', p.profile_id,
        'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
      );
    END IF;

    IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'candidate', 'profile', public._profile_to_json(p));
  END IF;

  -- Business users (alphanumeric Login ID)
  SELECT * INTO bu
  FROM public.business_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
  LIMIT 1;

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

    -- Temp / forced password change: password verified — skip email/phone; go to create password
    IF COALESCE(bu.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'kind', 'business',
        'login_email', bu.login_email,
        'user_id', bu.id,
        'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'business_users', bu.id::text,
      jsonb_build_object('login_id', bu.login_email, 'kind', 'business'));

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

  -- Audit users
  SELECT * INTO au
  FROM public.audit_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
  LIMIT 1;

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
        'ok', false,
        'need_password_setup', true,
        'kind', 'audit',
        'login_email', au.login_email,
        'user_id', au.id,
        'error', 'กรุณาตั้งรหัสผ่านใหม่'
      );
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'audit_users', au.id::text,
      jsonb_build_object('login_id', au.login_email, 'kind', 'audit'));

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

  RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
END;
$$;

-- -----------------------------------------------------------------------------
-- 2) Executive set password after temp-password login (no phone/email verify)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 3) Upsert: alphanumeric Login ID (not email-restricted)
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
    INSERT INTO public.business_users (login_email, display_name, position, password_hash, must_set_password)
    VALUES (
      v_id, v_name, NULLIF(trim(COALESCE(p_position, '')), ''),
      extensions.crypt(temp_pw, extensions.gen_salt('bf')),
      true
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
    INSERT INTO public.audit_users (login_email, display_name, position, assigned_districts, password_hash, must_set_password)
    VALUES (
      v_id, v_name, NULLIF(trim(COALESCE(p_position, '')), ''), v_districts,
      extensions.crypt(temp_pw, extensions.gen_salt('bf')), true
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

-- -----------------------------------------------------------------------------
-- 4) Executive admin actions: suspend / soft-delete / restore / temp password
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_executive_active(
  p_token text,
  p_kind text,
  p_id uuid,
  p_is_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_kind text := lower(trim(COALESCE(p_kind, '')));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_kind = 'business' THEN
    UPDATE public.business_users
    SET is_active = COALESCE(p_is_active, true), updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSIF v_kind = 'audit' THEN
    UPDATE public.audit_users
    SET is_active = COALESCE(p_is_active, true), updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'ชนิดบัญชีไม่ถูกต้อง');
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;
  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, CASE WHEN p_is_active THEN 'unsuspend_executive' ELSE 'suspend_executive' END,
    CASE WHEN v_kind = 'business' THEN 'business_users' ELSE 'audit_users' END,
    p_id::text, jsonb_build_object('is_active', p_is_active, 'kind', v_kind));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_executive(
  p_token text,
  p_kind text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_kind text := lower(trim(COALESCE(p_kind, '')));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_kind = 'business' THEN
    UPDATE public.business_users
    SET deleted_at = now(), is_active = false, updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSIF v_kind = 'audit' THEN
    UPDATE public.audit_users
    SET deleted_at = now(), is_active = false, updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'ชนิดบัญชีไม่ถูกต้อง');
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีหรือถูกลบแล้ว');
  END IF;
  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, 'soft_delete_executive',
    CASE WHEN v_kind = 'business' THEN 'business_users' ELSE 'audit_users' END,
    p_id::text, jsonb_build_object('kind', v_kind));
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_executive(
  p_token text,
  p_kind text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_kind text := lower(trim(COALESCE(p_kind, '')));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_kind = 'business' THEN
    UPDATE public.business_users
    SET deleted_at = NULL, is_active = true, updated_at = now()
    WHERE id = p_id AND deleted_at IS NOT NULL;
  ELSIF v_kind = 'audit' THEN
    UPDATE public.audit_users
    SET deleted_at = NULL, is_active = true, updated_at = now()
    WHERE id = p_id AND deleted_at IS NOT NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'ชนิดบัญชีไม่ถูกต้อง');
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีในถังกู้คืน');
  END IF;
  RETURN jsonb_build_object('ok', true);
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
      updated_at = now()
    WHERE id = p_id AND deleted_at IS NULL;
  ELSIF v_kind = 'audit' THEN
    UPDATE public.audit_users SET
      password_hash = extensions.crypt(temp_pw, extensions.gen_salt('bf')),
      must_set_password = true,
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

-- List executives including soft-deleted when requested
DROP FUNCTION IF EXISTS public.admin_list_executive_users(text, text);

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

GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_executive_password(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_business_user(text, text, text, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_audit_user(text, text, text, text, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_executive_active(text, text, uuid, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_executive(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_executive(text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reset_executive_temp_password(text, text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_executive_users(text, text, boolean) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
