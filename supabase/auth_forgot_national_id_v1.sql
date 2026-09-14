-- =============================================================================
-- auth_forgot_national_id_v1.sql
-- Forgot password: National ID (profile_id) + phone → login_email for reset UI
-- First-time still uses verify_candidate_for_password(email, phone)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.verify_candidate_forgot_password(
  p_national_id text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_nid text := trim(COALESCE(p_national_id, ''));
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_nid = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND profile_id = v_nid
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

GRANT EXECUTE ON FUNCTION public.verify_candidate_forgot_password(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
