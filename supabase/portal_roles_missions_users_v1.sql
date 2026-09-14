-- =============================================================================
-- portal_roles_missions_users_v1.sql
-- Email login, portal roles, soft-delete, missions, partner, audit, exports
-- Run in Supabase SQL Editor after prior migrations.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1) Schools: Partner network field
-- -----------------------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS partner text;

-- -----------------------------------------------------------------------------
-- 2) Profiles: portal role, suspend, soft-delete, assigned district
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS portal_role text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_district_id text;

-- Backfill school_admin flag into portal_role
UPDATE public.profiles
SET portal_role = 'school_admin'
WHERE COALESCE(is_school_admin, false) = true
  AND COALESCE(portal_role, 'user') = 'user';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_portal_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_portal_role_check
  CHECK (portal_role IN ('user', 'school_admin', 'business_user', 'audit_user'));

-- Unique login email among active (non-deleted) accounts
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_active_idx
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL AND NULLIF(trim(email), '') IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_portal_role_idx ON public.profiles (portal_role);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'districts'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_assigned_district_fk;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_assigned_district_fk
      FOREIGN KEY (assigned_district_id) REFERENCES public.districts(district_id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3) Audit logs: allow portal actor (profile_id) without admin
-- -----------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS profile_id text;

ALTER TABLE public.audit_logs ALTER COLUMN admin_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_profile_id_idx ON public.audit_logs (profile_id);

-- -----------------------------------------------------------------------------
-- 4) Missions schema
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  sequence_order integer NOT NULL DEFAULT 1,
  validation_type text NOT NULL DEFAULT 'url_submission',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missions_validation_type_check
    CHECK (validation_type IN ('url_submission', 'exam_completion', 'manual'))
);

CREATE TABLE IF NOT EXISTS public.user_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE CASCADE,
  mission_id uuid NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  submitted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_missions_status_check CHECK (status IN ('pending', 'completed')),
  CONSTRAINT user_missions_profile_mission_unique UNIQUE (profile_id, mission_id)
);

CREATE INDEX IF NOT EXISTS user_missions_profile_idx ON public.user_missions (profile_id);
CREATE INDEX IF NOT EXISTS user_missions_status_idx ON public.user_missions (status);

ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS missions_public_select ON public.missions;
CREATE POLICY missions_public_select ON public.missions
  FOR SELECT USING (is_active = true);

-- Seed Mission 1 (school video URL) if empty
INSERT INTO public.missions (title, description, sequence_order, validation_type, is_active)
SELECT
  'ส่งลิงก์วิดีโอโรงเรียน',
  'กรอกลิงก์วิดีโอนำเสนอโรงเรียน (URL ที่ถูกต้อง) เพื่อทำภารกิจที่ 1 ให้สำเร็จ',
  1,
  'url_submission',
  true
WHERE NOT EXISTS (SELECT 1 FROM public.missions LIMIT 1);

-- -----------------------------------------------------------------------------
-- 5) Profile JSON helper (never expose password_hash)
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
    'email', p.email,
    'created_at', p.created_at,
    'is_school_admin', COALESCE(p.is_school_admin, false) OR p.portal_role = 'school_admin',
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
-- 6) Email-based candidate login
-- Parameter rename p_profile_id → p_email requires DROP (CREATE OR REPLACE cannot rename args)
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
  v_email text := lower(trim(COALESCE(p_email, '')));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_email = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE lower(trim(COALESCE(email, ''))) = v_email
    AND deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'need_password_setup', true,
      'profile_id', p.profile_id,
      'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
    );
  END IF;

  IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  -- Audit login for business_user / audit_user
  IF p.portal_role IN ('business_user', 'audit_user') THEN
    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (
      NULL,
      p.profile_id,
      'portal_login',
      'profiles',
      p.profile_id,
      jsonb_build_object('portal_role', p.portal_role, 'email', p.email)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

-- Backward-compatible overload: national ID login still works for migration period
CREATE OR REPLACE FUNCTION public.login_candidate_by_id(p_profile_id text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_digits text := public._digits_only(v_id);
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_password, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND (
      profile_id = v_id
      OR (length(v_digits) = 13 AND public._digits_only(profile_id) = v_digits)
    )
  ORDER BY CASE WHEN profile_id = v_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  IF p.password_hash IS NULL OR COALESCE(p.must_set_password, true) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'need_password_setup', true,
      'profile_id', p.profile_id,
      'error', 'กรุณาตั้งรหัสผ่านครั้งแรกก่อนเข้าใช้งาน'
    );
  END IF;

  IF extensions.crypt(p_password, p.password_hash) IS DISTINCT FROM p.password_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.log_portal_logout(p_profile_id text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false);
  END;

  IF p.deleted_at IS NOT NULL OR COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  IF p.portal_role IN ('business_user', 'audit_user') THEN
    INSERT INTO public.audit_logs (admin_id, profile_id, action, target_table, target_id, new_data)
    VALUES (
      NULL,
      p.profile_id,
      'portal_logout',
      'profiles',
      p.profile_id,
      jsonb_build_object('portal_role', p.portal_role, 'email', p.email)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Block soft-deleted / suspended in phone verify path used by password reset
CREATE OR REPLACE FUNCTION public._verify_profile_phone(p_profile_id text, p_phone text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_digits text := public._digits_only(v_id);
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_id = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND (
      profile_id = v_id
      OR (length(v_digits) = 13 AND public._digits_only(profile_id) = v_digits)
    )
  ORDER BY CASE WHEN profile_id = v_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND OR NOT public._phones_match(p.phone, p_phone) THEN
    RAISE EXCEPTION 'invalid_credentials';
  END IF;

  IF COALESCE(p.is_active, true) = false THEN
    RAISE EXCEPTION 'account_suspended';
  END IF;

  RETURN p;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7) Admin user management RPCs
-- -----------------------------------------------------------------------------
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
        p.email,
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
        AND (
          q = ''
          OR p.profile_id ILIKE '%' || q || '%'
          OR p.school_id ILIKE '%' || q || '%'
          OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
          OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
          OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) ILIKE '%' || q || '%'
          OR COALESCE(p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
          OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
        )
      ORDER BY p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    ) t
  ), '[]'::jsonb);
END;
$$;

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
  v_district text := NULLIF(trim(COALESCE(p_assigned_district_id, '')), '');
  old_role text;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_role NOT IN ('user', 'school_admin', 'business_user', 'audit_user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บทบาทไม่ถูกต้อง');
  END IF;

  IF v_role = 'audit_user' AND v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'audit_user ต้องระบุเขตการศึกษาที่รับผิดชอบ');
  END IF;

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  old_role := COALESCE(p.portal_role, 'user');

  -- Enforce one school_admin per school
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
    assigned_district_id = CASE WHEN v_role = 'audit_user' THEN v_district ELSE NULL END,
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
    jsonb_build_object('portal_role', v_role, 'assigned_district_id', p.assigned_district_id)
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
  old_email text;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รูปแบบอีเมลไม่ถูกต้อง');
  END IF;

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  -- Never alter profile_id (National ID)
  old_email := p.email;

  SELECT profile_id INTO existing_id
  FROM public.profiles
  WHERE lower(trim(COALESCE(email, ''))) = v_email
    AND deleted_at IS NULL
    AND profile_id <> p.profile_id
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว');
  END IF;

  UPDATE public.profiles
  SET email = v_email, updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, old_data, new_data)
  VALUES (
    a.admin_id,
    'update_login_email',
    'profiles',
    p.profile_id,
    jsonb_build_object('email', old_email, 'profile_id', p.profile_id),
    jsonb_build_object('email', v_email, 'profile_id', p.profile_id)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

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
  p public.profiles;
BEGIN
  a := public._admin_from_token(p_token);

  UPDATE public.profiles
  SET is_active = COALESCE(p_is_active, true), updated_at = now()
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL
  RETURNING * INTO p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งาน');
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    CASE WHEN p.is_active THEN 'unsuspend_user' ELSE 'suspend_user' END,
    'profiles',
    p.profile_id,
    jsonb_build_object('is_active', p.is_active)
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
  p public.profiles;
BEGIN
  a := public._admin_from_token(p_token);

  UPDATE public.profiles
  SET deleted_at = now(), is_active = false, updated_at = now()
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL
  RETURNING * INTO p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งานหรือถูกลบแล้ว');
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    'soft_delete_user',
    'profiles',
    p.profile_id,
    jsonb_build_object('deleted_at', p.deleted_at)
  );

  RETURN jsonb_build_object('ok', true);
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
  p public.profiles;
  clash text;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีในถังกู้คืน');
  END IF;

  IF p.email IS NOT NULL AND NULLIF(trim(p.email), '') IS NOT NULL THEN
    SELECT profile_id INTO clash
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND lower(trim(email)) = lower(trim(p.email))
      AND profile_id <> p.profile_id
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถกู้คืนได้ เนื่องจากอีเมลถูกใช้โดยบัญชีอื่นแล้ว');
    END IF;
  END IF;

  UPDATE public.profiles
  SET deleted_at = NULL, is_active = true, updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, 'restore_user', 'profiles', p.profile_id, jsonb_build_object('restored', true));

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_purge_soft_deleted_users(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  IF a.role <> 'super_admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH doomed AS (
    SELECT profile_id
    FROM public.profiles
    WHERE deleted_at IS NOT NULL
      AND deleted_at < now() - interval '30 days'
  ),
  deleted AS (
    DELETE FROM public.profiles p
    USING doomed d
    WHERE p.profile_id = d.profile_id
    RETURNING p.profile_id
  )
  SELECT count(*) INTO v_count FROM deleted;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (a.admin_id, 'purge_soft_deleted_users', 'profiles', NULL, jsonb_build_object('purged_count', v_count));

  RETURN jsonb_build_object('ok', true, 'purged_count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_special_user(
  p_token text,
  p_profile_id text,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_role text,
  p_temp_password text,
  p_title_th text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_assigned_district_id text DEFAULT NULL,
  p_school_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_role text := lower(trim(COALESCE(p_role, '')));
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_id text := trim(COALESCE(p_profile_id, ''));
  v_district text := NULLIF(trim(COALESCE(p_assigned_district_id, '')), '');
  v_school text := NULLIF(trim(COALESCE(p_school_id, '')), '');
  clash text;
  p public.profiles;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_role NOT IN ('business_user', 'audit_user') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'สร้างได้เฉพาะ business_user หรือ audit_user');
  END IF;

  IF length(v_id) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุรหัสประจำตัว (National ID)');
  END IF;

  IF v_email = '' OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รูปแบบอีเมลไม่ถูกต้อง');
  END IF;

  IF length(trim(COALESCE(p_temp_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  IF v_role = 'audit_user' THEN
    IF NULLIF(trim(COALESCE(p_title_th, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_first_name, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_last_name, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_position, '')), '') IS NULL
       OR v_district IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'audit_user ต้องมีคำนำหน้า ชื่อ-นามสกุล ตำแหน่ง และเขตการศึกษา'
      );
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE profile_id = v_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสประจำตัวนี้มีอยู่แล้ว');
  END IF;

  SELECT profile_id INTO clash
  FROM public.profiles
  WHERE deleted_at IS NULL AND lower(trim(email)) = v_email
  LIMIT 1;
  IF clash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว');
  END IF;

  -- business_user may omit school; use placeholder school if needed
  IF v_school IS NULL THEN
    SELECT school_id INTO v_school FROM public.schools ORDER BY school_id LIMIT 1;
  END IF;

  INSERT INTO public.profiles (
    profile_id, school_id, first_name, last_name, phone, email,
    title_th, position, portal_role, assigned_district_id,
    password_hash, must_set_password, is_school_admin, is_active, pdpa_accepted
  ) VALUES (
    v_id,
    v_school,
    trim(COALESCE(p_first_name, CASE WHEN v_role = 'business_user' THEN 'Business' ELSE '' END)),
    trim(COALESCE(p_last_name, CASE WHEN v_role = 'business_user' THEN 'User' ELSE '' END)),
    COALESCE(NULLIF(trim(p_phone), ''), '-'),
    v_email,
    NULLIF(trim(COALESCE(p_title_th, '')), ''),
    NULLIF(trim(COALESCE(p_position, '')), ''),
    v_role,
    CASE WHEN v_role = 'audit_user' THEN v_district ELSE NULL END,
    extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
    true,
    false,
    true,
    true
  )
  RETURNING * INTO p;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    'create_special_user',
    'profiles',
    p.profile_id,
    jsonb_build_object('portal_role', v_role, 'email', v_email)
  );

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p), 'temp_password', p_temp_password);
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) Exam export with joined profile fields + hierarchy exports
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_export_exam_responses(
  p_token text,
  p_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_project IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', e.profile_id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')),
      'school_id', p.school_id,
      'school_name', s.school_name,
      'phone', p.phone,
      'email', p.email,
      'project_id', e.project_id,
      'answers', e.answers,
      'status', e.status,
      'score', e.score,
      'passed', e.passed,
      'graded_at', e.graded_at,
      'updated_at', e.updated_at
    ) ORDER BY e.updated_at DESC)
    FROM public.exam_progress e
    JOIN public.profiles p ON p.profile_id = e.profile_id AND p.deleted_at IS NULL
    LEFT JOIN public.schools s ON s.school_id = p.school_id
    WHERE e.project_id = v_project OR e.project_id IS NULL
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_export_hierarchy(
  p_token text,
  p_mode text DEFAULT 'district'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_mode text := lower(trim(COALESCE(p_mode, 'district')));
BEGIN
  a := public._admin_from_token(p_token);

  IF v_mode = 'partner' THEN
    RETURN COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
      FROM (
        SELECT
          COALESCE(NULLIF(trim(s.partner), ''), 'ไม่ระบุ Partner') AS partner,
          COALESCE(d.district_id, s.district_id) AS district_id,
          COALESCE(d.district_name, s.district_id) AS district_name,
          s.school_id,
          s.school_name,
          s.province,
          p.profile_id,
          trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
          p.phone,
          p.email,
          COALESCE(p.portal_role, 'user') AS portal_role
        FROM public.profiles p
        JOIN public.schools s ON s.school_id = p.school_id
        LEFT JOIN public.districts d ON d.district_id = s.district_id
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        ORDER BY 1, 3, s.school_name, p.last_name, p.first_name
      ) t
    ), '[]'::jsonb);
  END IF;

  -- default: district > school > user
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        COALESCE(d.district_id, s.district_id) AS district_id,
        COALESCE(d.district_name, s.district_id) AS district_name,
        s.province,
        s.school_id,
        s.school_name,
        p.profile_id,
        trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
        p.phone,
        p.email,
        COALESCE(p.portal_role, 'user') AS portal_role
      FROM public.profiles p
      JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      ORDER BY 2, s.school_name, p.last_name, p.first_name
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9) Missions RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_active_missions()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'title', m.title,
    'description', m.description,
    'sequence_order', m.sequence_order,
    'validation_type', m.validation_type,
    'is_active', m.is_active
  ) ORDER BY m.sequence_order, m.created_at), '[]'::jsonb)
  FROM public.missions m
  WHERE m.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_missions(p_profile_id text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'missions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'description', m.description,
        'sequence_order', m.sequence_order,
        'validation_type', m.validation_type,
        'status', COALESCE(um.status, 'pending'),
        'submitted_data', COALESCE(um.submitted_data, '{}'::jsonb),
        'completed_at', um.completed_at
      ) ORDER BY m.sequence_order)
      FROM public.missions m
      LEFT JOIN public.user_missions um
        ON um.mission_id = m.id AND um.profile_id = p.profile_id
      WHERE m.is_active = true
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_mission_url(
  p_profile_id text,
  p_phone text,
  p_mission_id uuid,
  p_video_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  m public.missions;
  v_url text := trim(COALESCE(p_video_url, ''));
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT * INTO m FROM public.missions WHERE id = p_mission_id AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบภารกิจ');
  END IF;

  IF m.validation_type <> 'url_submission' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ภารกิจนี้ไม่รองรับการส่ง URL');
  END IF;

  IF v_url !~* '^https?://[^\s/$.?#].[^\s]*$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอก URL ที่ถูกต้อง (http/https)');
  END IF;

  INSERT INTO public.user_missions (profile_id, mission_id, status, submitted_data, completed_at, updated_at)
  VALUES (
    p.profile_id,
    m.id,
    'completed',
    jsonb_build_object('video_url', v_url),
    now(),
    now()
  )
  ON CONFLICT (profile_id, mission_id) DO UPDATE SET
    status = 'completed',
    submitted_data = jsonb_build_object('video_url', v_url),
    completed_at = COALESCE(public.user_missions.completed_at, now()),
    updated_at = now();

  RETURN jsonb_build_object('ok', true, 'status', 'completed');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mission_progress_stats(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  total_missions integer;
  total_users integer;
  completed_pairs integer;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT count(*) INTO total_missions FROM public.missions WHERE is_active = true;
  SELECT count(*) INTO total_users
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')
    AND COALESCE(is_active, true) = true;

  SELECT count(*) INTO completed_pairs
  FROM public.user_missions um
  JOIN public.profiles p ON p.profile_id = um.profile_id AND p.deleted_at IS NULL
  JOIN public.missions m ON m.id = um.mission_id AND m.is_active = true
  WHERE um.status = 'completed';

  RETURN jsonb_build_object(
    'ok', true,
    'total_missions', total_missions,
    'total_users', total_users,
    'completed_pairs', completed_pairs,
    'avg_completed_per_user',
      CASE WHEN total_users > 0
        THEN round((completed_pairs::numeric / total_users), 2)
        ELSE 0
      END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.executive_summary_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_schools integer;
  registered_schools integer;
  total_users integer;
  total_districts integer;
  total_missions integer;
  completed_pairs integer;
BEGIN
  SELECT count(*) INTO total_schools FROM public.schools;
  SELECT count(*) INTO registered_schools FROM public.schools WHERE is_registered = true;
  SELECT count(DISTINCT district_id) INTO total_districts FROM public.schools WHERE district_id IS NOT NULL;
  SELECT count(*) INTO total_users
  FROM public.profiles
  WHERE deleted_at IS NULL AND COALESCE(portal_role, 'user') IN ('user', 'school_admin');
  SELECT count(*) INTO total_missions FROM public.missions WHERE is_active = true;
  SELECT count(*) INTO completed_pairs
  FROM public.user_missions um
  JOIN public.missions m ON m.id = um.mission_id AND m.is_active = true
  WHERE um.status = 'completed';

  RETURN jsonb_build_object(
    'total_schools', total_schools,
    'registered_schools', registered_schools,
    'total_users', total_users,
    'total_districts', total_districts,
    'total_missions', total_missions,
    'mission_completions', completed_pairs,
    'by_province', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'province', x.province,
        'schools', x.schools,
        'registered', x.registered,
        'users', x.users
      ) ORDER BY x.province)
      FROM (
        SELECT
          s.province,
          count(DISTINCT s.school_id) AS schools,
          count(DISTINCT s.school_id) FILTER (WHERE s.is_registered) AS registered,
          count(p.profile_id) AS users
        FROM public.schools s
        LEFT JOIN public.profiles p
          ON p.school_id = s.school_id
         AND p.deleted_at IS NULL
         AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        GROUP BY s.province
      ) x
    ), '[]'::jsonb),
    'by_district', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'district_id', x.district_id,
        'district_name', x.district_name,
        'province', x.province,
        'schools', x.schools,
        'registered', x.registered,
        'users', x.users
      ) ORDER BY x.district_name)
      FROM (
        SELECT
          COALESCE(d.district_id, s.district_id) AS district_id,
          COALESCE(d.district_name, s.district_id) AS district_name,
          max(s.province) AS province,
          count(DISTINCT s.school_id) AS schools,
          count(DISTINCT s.school_id) FILTER (WHERE s.is_registered) AS registered,
          count(p.profile_id) AS users
        FROM public.schools s
        LEFT JOIN public.districts d ON d.district_id = s.district_id
        LEFT JOIN public.profiles p
          ON p.school_id = s.school_id
         AND p.deleted_at IS NULL
         AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        GROUP BY 1, 2
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- Keep admin_search_profiles aligned (hide soft-deleted, include email/role)
CREATE OR REPLACE FUNCTION public.admin_search_profiles(
  p_token text,
  p_query text,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.admin_search_users(p_token, p_query, p_limit, false);
END;
$$;

-- -----------------------------------------------------------------------------
-- 10) Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.login_candidate(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_candidate_by_id(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_portal_logout(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_portal_role(text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_login_email(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(text, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_restore_user(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_purge_soft_deleted_users(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_special_user(text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_exam_responses(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_export_hierarchy(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_missions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_missions(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_mission_url(text, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mission_progress_stats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.executive_summary_stats() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_profiles(text, text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
