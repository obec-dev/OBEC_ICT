-- =============================================================================
-- login_setup_status_v1.sql
-- Kept for older clients. Always returns the same payload so it cannot be
-- used to check whether an email is registered. First-time setup is detected
-- only after a password login attempt (login_candidate).
-- Run in the Supabase SQL Editor.
-- =============================================================================

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

GRANT EXECUTE ON FUNCTION public.login_setup_status(text) TO anon, authenticated;
