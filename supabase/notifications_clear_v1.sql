-- notifications_clear_v1.sql
-- Delete read notifications for the current audience/recipient.

CREATE OR REPLACE FUNCTION public.clear_read_notifications(
  p_audience text,
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_login_email text DEFAULT NULL,
  p_admin_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  idn record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    SELECT * INTO idn FROM public._notification_identity(
      p_audience, p_profile_id, p_phone, p_login_email, p_admin_token
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  DELETE FROM public.notifications n
  WHERE n.audience = ANY (idn.audiences)
    AND (n.recipient_key IS NULL OR n.recipient_key = idn.recipient_key)
    AND n.read_at IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'deleted', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_read_notifications(text, text, text, text, text)
  TO anon, authenticated, service_role;
