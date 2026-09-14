-- =============================================================================
-- fix_auth_reset_and_login_probe_v1.sql
-- 1) set_candidate_password: first-time accounts can set a password with email only.
--    Accounts that already have a password require phone + national ID, and
--    inactive accounts cannot reset.
-- 2) login_setup_status no longer reveals whether an email exists.
-- Run in the Supabase SQL Editor after the other auth scripts.
-- =============================================================================

DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text);
DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text, text);

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

  -- First-time: email is enough (login already detected must_set_password).
  -- Existing password: phone + national ID are required. Email alone must not reset.
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

-- Same response for every email so this RPC is not an account oracle.
CREATE OR REPLACE FUNCTION public.login_setup_status(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object('ok', true, 'kind', 'unknown', 'needs_password_setup', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_candidate_password(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_setup_status(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
