-- =============================================================================
-- decouple_login_email_executives_v1.sql
-- login_email vs contact_email; business_users / audit_users tables;
-- email+phone password flows
-- Run AFTER app deploy. Safe to re-run with IF NOT EXISTS / OR REPLACE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1) Profiles: login_email (immutable for candidates) + contact_email
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_email text,
  ADD COLUMN IF NOT EXISTS contact_email text;

-- Backfill from legacy email
UPDATE public.profiles
SET
  login_email = lower(trim(email)),
  contact_email = NULLIF(trim(email), '')
WHERE email IS NOT NULL
  AND NULLIF(trim(email), '') IS NOT NULL
  AND (login_email IS NULL OR contact_email IS NULL);

DROP INDEX IF EXISTS profiles_email_unique_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_login_email_unique_active_idx
  ON public.profiles (lower(login_email))
  WHERE login_email IS NOT NULL
    AND NULLIF(trim(login_email), '') IS NOT NULL
    AND deleted_at IS NULL;

-- Candidates on profiles should only be user / school_admin
UPDATE public.profiles
SET portal_role = 'user'
WHERE portal_role IN ('business_user', 'audit_user');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_portal_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_portal_role_check
  CHECK (portal_role IN ('user', 'school_admin'));

-- -----------------------------------------------------------------------------
-- 2) Dedicated executive tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_email text NOT NULL,
  display_name text NOT NULL,
  password_hash text,
  position text,
  must_set_password boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS business_users_login_email_uidx
  ON public.business_users (lower(login_email))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.audit_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_email text NOT NULL,
  display_name text NOT NULL,
  password_hash text,
  position text,
  assigned_districts jsonb NOT NULL DEFAULT '[]'::jsonb,
  must_set_password boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_users_login_email_uidx
  ON public.audit_users (lower(login_email))
  WHERE deleted_at IS NULL;

ALTER TABLE public.business_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_users ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3) Profile JSON (expose login_email + contact_email; never password_hash)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._profile_to_json(p public.profiles)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'profile_id', p.profile_id,
    'school_id', p.school_id,
    'school_name', (SELECT s.school_name FROM public.schools s WHERE s.school_id = p.school_id LIMIT 1),
    'first_name', p.first_name,
    'last_name', p.last_name,
    'phone', p.phone,
    'remark', p.remark,
    'title_key', p.title_key,
    'title_en', p.title_en,
    'title_th', p.title_th,
    'title_other_en', p.title_other_en,
    'title_other_th', p.title_other_th,
    'eng_first_name', p.eng_first_name,
    'eng_last_name', p.eng_last_name,
    'birth_date', p.birth_date,
    'gender', p.gender,
    'position', p.position,
    'duty', p.duty,
    'line_id', p.line_id,
    'email', COALESCE(p.contact_email, p.email),
    'contact_email', COALESCE(p.contact_email, p.email),
    'login_email', COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))),
    'created_at', p.created_at,
    'is_school_admin', COALESCE(p.is_school_admin, false) OR COALESCE(p.portal_role, 'user') = 'school_admin',
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'ict_talent_cohort', p.ict_talent_cohort,
    'ict_survey', COALESCE(p.ict_survey, '{}'::jsonb),
    'portal_role', COALESCE(p.portal_role, 'user'),
    'is_active', COALESCE(p.is_active, true),
    'deleted_at', p.deleted_at,
    'assigned_district_id', p.assigned_district_id
  );
$$;

-- -----------------------------------------------------------------------------
-- 4) Candidate login by login_email
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
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_email = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  -- 4a) Candidate profiles
  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
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

  -- 4b) Business users
  SELECT * INTO bu
  FROM public.business_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_email
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(bu.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF bu.password_hash IS NULL OR COALESCE(bu.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'login_email', bu.login_email,
        'kind', 'business',
        'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
      );
    END IF;
    IF extensions.crypt(p_password, bu.password_hash) IS DISTINCT FROM bu.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'business_users', bu.id::text,
      jsonb_build_object('login_email', bu.login_email, 'kind', 'business'));

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

  -- 4c) Audit users
  SELECT * INTO au
  FROM public.audit_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_email
  LIMIT 1;

  IF FOUND THEN
    IF COALESCE(au.is_active, true) = false THEN
      RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    END IF;
    IF au.password_hash IS NULL OR COALESCE(au.must_set_password, true) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'need_password_setup', true,
        'login_email', au.login_email,
        'kind', 'audit',
        'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
      );
    END IF;
    IF extensions.crypt(p_password, au.password_hash) IS DISTINCT FROM au.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;

    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (NULL, NULL, 'portal_login', 'audit_users', au.id::text,
      jsonb_build_object('login_email', au.login_email, 'kind', 'audit'));

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
-- 5) Verify + set password via Email + Phone (candidates)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_candidate_for_password(text, text);
DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text);

CREATE OR REPLACE FUNCTION public.verify_candidate_for_password(
  p_email text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_email = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
  LIMIT 1;

  IF NOT FOUND OR NOT public._phones_match(p.phone, p_phone) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'login_email', COALESCE(p.login_email, lower(trim(p.email))),
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'has_password', p.password_hash IS NOT NULL
  );
END;
$$;

-- Signature includes national ID. See fix_auth_reset_and_login_probe_v1.sql
-- for the live policy (first-time = email+phone; existing password also needs national ID).
DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text);

CREATE OR REPLACE FUNCTION public.set_candidate_password(
  p_email text,
  p_phone text,
  p_new_password text,
  p_national_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_nid text := regexp_replace(COALESCE(p_national_id, ''), '\D', '', 'g');
  v_profile_nid text;
  v_first_time boolean;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(trim(COALESCE(p_new_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  v_first_time := p.password_hash IS NULL OR COALESCE(p.must_set_password, true);
  v_profile_nid := regexp_replace(COALESCE(p.profile_id, ''), '\D', '', 'g');

  IF NOT v_first_time THEN
    IF NOT public._phones_match(p.phone, p_phone)
      OR v_nid = ''
      OR v_nid IS DISTINCT FROM v_profile_nid THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    must_set_password = false,
    login_email = COALESCE(NULLIF(trim(login_email), ''), v_email),
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- Own profile: candidates may update contact_email only (not login_email)
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_profile_id text,
  p_phone text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  patch jsonb := COALESCE(p_patch, '{}'::jsonb);
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  UPDATE public.profiles SET
    first_name = CASE WHEN patch ? 'first_name' THEN NULLIF(trim(patch->>'first_name'), '') ELSE first_name END,
    last_name = CASE WHEN patch ? 'last_name' THEN NULLIF(trim(patch->>'last_name'), '') ELSE last_name END,
    phone = CASE WHEN patch ? 'phone' THEN NULLIF(trim(patch->>'phone'), '') ELSE phone END,
    remark = CASE WHEN patch ? 'remark' THEN NULLIF(trim(patch->>'remark'), '') ELSE remark END,
    title_key = CASE WHEN patch ? 'title_key' THEN NULLIF(trim(patch->>'title_key'), '') ELSE title_key END,
    title_en = CASE WHEN patch ? 'title_en' THEN NULLIF(trim(patch->>'title_en'), '') ELSE title_en END,
    title_th = CASE WHEN patch ? 'title_th' THEN NULLIF(trim(patch->>'title_th'), '') ELSE title_th END,
    title_other_en = CASE WHEN patch ? 'title_other_en' THEN NULLIF(trim(patch->>'title_other_en'), '') ELSE title_other_en END,
    title_other_th = CASE WHEN patch ? 'title_other_th' THEN NULLIF(trim(patch->>'title_other_th'), '') ELSE title_other_th END,
    eng_first_name = CASE WHEN patch ? 'eng_first_name' THEN NULLIF(trim(patch->>'eng_first_name'), '') ELSE eng_first_name END,
    eng_last_name = CASE WHEN patch ? 'eng_last_name' THEN NULLIF(trim(patch->>'eng_last_name'), '') ELSE eng_last_name END,
    position = CASE WHEN patch ? 'position' THEN NULLIF(trim(patch->>'position'), '') ELSE position END,
    duty = CASE WHEN patch ? 'duty' THEN NULLIF(trim(patch->>'duty'), '') ELSE duty END,
    line_id = CASE WHEN patch ? 'line_id' THEN NULLIF(trim(patch->>'line_id'), '') ELSE line_id END,
    -- contact only — never touch login_email from candidate self-service
    contact_email = CASE
      WHEN patch ? 'contact_email' THEN lower(NULLIF(trim(patch->>'contact_email'), ''))
      WHEN patch ? 'email' THEN lower(NULLIF(trim(patch->>'email'), ''))
      ELSE contact_email
    END,
    email = CASE
      WHEN patch ? 'contact_email' THEN lower(NULLIF(trim(patch->>'contact_email'), ''))
      WHEN patch ? 'email' THEN lower(NULLIF(trim(patch->>'email'), ''))
      ELSE email
    END,
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- -----------------------------------------------------------------------------
-- 6) Admin: update login_email only (never contact_email)
-- -----------------------------------------------------------------------------
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

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, old_data, new_data)
  VALUES (
    a.admin_id,
    'update_login_email',
    'profiles',
    p.profile_id,
    jsonb_build_object('login_email', old_login, 'profile_id', p.profile_id),
    jsonb_build_object('login_email', v_email, 'profile_id', p.profile_id, 'contact_email_unchanged', true)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Admin CRUD for business_users / audit_users
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_executive_users(
  p_token text,
  p_kind text DEFAULT 'all'
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
      'created_at', b.created_at
    ) ORDER BY b.created_at DESC), '[]'::jsonb)
    INTO biz
    FROM public.business_users b
    WHERE b.deleted_at IS NULL;
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
      'created_at', u.created_at
    ) ORDER BY u.created_at DESC), '[]'::jsonb)
    INTO aud
    FROM public.audit_users u
    WHERE u.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'business', biz, 'audit', aud);
END;
$$;

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
  v_email text := lower(trim(COALESCE(p_login_email, '')));
  v_name text := trim(COALESCE(p_display_name, ''));
  row_id uuid;
  temp_pw text;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ไม่ถูกต้อง');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อแสดง');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE deleted_at IS NULL AND lower(trim(COALESCE(login_email, email, ''))) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำกับผู้สมัคร');
  END IF;

  temp_pw := NULLIF(trim(COALESCE(p_temp_password, '')), '');
  IF temp_pw IS NOT NULL AND length(temp_pw) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.business_users WHERE deleted_at IS NULL AND lower(login_email) = v_email) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำ');
    END IF;
    INSERT INTO public.business_users (login_email, display_name, position, password_hash, must_set_password)
    VALUES (
      v_email,
      v_name,
      NULLIF(trim(COALESCE(p_position, '')), ''),
      CASE WHEN temp_pw IS NOT NULL THEN extensions.crypt(temp_pw, extensions.gen_salt('bf')) ELSE NULL END,
      true
    )
    RETURNING id INTO row_id;
  ELSE
    UPDATE public.business_users SET
      login_email = v_email,
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
  v_email text := lower(trim(COALESCE(p_login_email, '')));
  v_name text := trim(COALESCE(p_display_name, ''));
  v_districts jsonb := COALESCE(p_assigned_districts, '[]'::jsonb);
  row_id uuid;
  temp_pw text;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Login ID ไม่ถูกต้อง');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อแสดง');
  END IF;
  IF jsonb_typeof(v_districts) <> 'array' OR jsonb_array_length(v_districts) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องมอบหมายอย่างน้อย 1 เขตการศึกษา');
  END IF;

  temp_pw := NULLIF(trim(COALESCE(p_temp_password, '')), '');
  IF temp_pw IS NOT NULL AND length(temp_pw) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF p_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.audit_users WHERE deleted_at IS NULL AND lower(login_email) = v_email) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Login ID ซ้ำ');
    END IF;
    INSERT INTO public.audit_users (login_email, display_name, position, assigned_districts, password_hash, must_set_password)
    VALUES (
      v_email, v_name,
      NULLIF(trim(COALESCE(p_position, '')), ''),
      v_districts,
      CASE WHEN temp_pw IS NOT NULL THEN extensions.crypt(temp_pw, extensions.gen_salt('bf')) ELSE NULL END,
      true
    )
    RETURNING id INTO row_id;
  ELSE
    UPDATE public.audit_users SET
      login_email = v_email,
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

CREATE OR REPLACE FUNCTION public.admin_set_audit_districts(
  p_token text,
  p_id uuid,
  p_assigned_districts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_districts jsonb := COALESCE(p_assigned_districts, '[]'::jsonb);
BEGIN
  a := public._admin_from_token(p_token);
  IF jsonb_typeof(v_districts) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รูปแบบเขตไม่ถูกต้อง');
  END IF;

  UPDATE public.audit_users
  SET assigned_districts = v_districts, updated_at = now()
  WHERE id = p_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Update admin_search_users to return login_email + contact_email
CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_token text,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_include_deleted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  q text := trim(COALESCE(p_query, ''));
BEGIN
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id,
        p.school_id,
        s.school_name,
        p.first_name,
        p.last_name,
        p.phone,
        COALESCE(p.contact_email, p.email) AS email,
        COALESCE(p.contact_email, p.email) AS contact_email,
        COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))) AS login_email,
        COALESCE(p.portal_role, 'user') AS portal_role,
        COALESCE(p.is_school_admin, false) AS is_school_admin,
        COALESCE(p.is_active, true) AS is_active,
        p.deleted_at,
        p.assigned_district_id,
        p.position,
        p.title_th,
        p.title_other_th,
        p.created_at
      FROM public.profiles p
      LEFT JOIN public.schools s ON s.school_id = p.school_id
      WHERE (p_include_deleted OR p.deleted_at IS NULL)
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (
          q = ''
          OR p.profile_id ILIKE '%' || q || '%'
          OR p.school_id ILIKE '%' || q || '%'
          OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
          OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
          OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) ILIKE '%' || q || '%'
          OR COALESCE(p.login_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.contact_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
          OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
        )
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    ) t
  ), '[]'::jsonb);
END;
$$;

-- On register: set login_email from registration email
-- Patch register_profile email handling via trigger
CREATE OR REPLACE FUNCTION public._profiles_sync_login_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.login_email IS NULL OR NULLIF(trim(NEW.login_email), '') IS NULL THEN
    NEW.login_email := lower(NULLIF(trim(COALESCE(NEW.email, NEW.contact_email, '')), ''));
  ELSE
    NEW.login_email := lower(trim(NEW.login_email));
  END IF;
  IF NEW.contact_email IS NULL OR NULLIF(trim(NEW.contact_email), '') IS NULL THEN
    NEW.contact_email := NULLIF(trim(COALESCE(NEW.email, '')), '');
  END IF;
  -- Never allow portal_role executive on profiles
  IF NEW.portal_role IS NULL OR NEW.portal_role NOT IN ('user', 'school_admin') THEN
    NEW.portal_role := CASE WHEN COALESCE(NEW.is_school_admin, false) THEN 'school_admin' ELSE 'user' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_sync_login_email ON public.profiles;
CREATE TRIGGER trg_profiles_sync_login_email
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public._profiles_sync_login_email();

-- -----------------------------------------------------------------------------
-- 8) Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_candidate_for_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_candidate_password(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_login_email(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_executive_users(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_business_user(text, text, text, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_audit_user(text, text, text, text, jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_audit_districts(text, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, integer, boolean) TO anon, authenticated, service_role;

-- Update admin_set_portal_role: candidates only user/school_admin
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

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, old_data, new_data)
  VALUES (
    a.admin_id,
    'set_portal_role',
    'profiles',
    p.profile_id,
    jsonb_build_object('portal_role', old_role),
    jsonb_build_object('portal_role', v_role)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_portal_role(text, text, text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
