-- Fix: slide admin session expiry on each successful RPC auth check.
-- Run this in Supabase SQL Editor if dashboard shows "unauthorized"
-- while you still appear logged in (stale 12h token in the browser).

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

  UPDATE public.admin_sessions
  SET expires_at = now() + interval '12 hours'
  WHERE token = p_token;

  RETURN a;
END;
$$;

-- Optional: wipe expired sessions so browsers must re-login cleanly
DELETE FROM public.admin_sessions WHERE expires_at <= now();
