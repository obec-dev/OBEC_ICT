-- score_adjust_v1.sql
-- Admin manual score top-up / deduct with admin-only remark and optional user notify.

ALTER TABLE public.score_ledger DROP CONSTRAINT IF EXISTS score_ledger_source_check;
ALTER TABLE public.score_ledger
  ADD CONSTRAINT score_ledger_source_check
  CHECK (source IN ('task', 'elearning', 'live', 'self_learn', 'manual'));

-- Allow signed points for manual deducts (other sources still insert >= 0 via _credit_score).
ALTER TABLE public.score_ledger DROP CONSTRAINT IF EXISTS score_ledger_points_check;


CREATE TABLE IF NOT EXISTS public.score_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text NOT NULL REFERENCES public.profiles(profile_id) ON DELETE CASCADE,
  points integer NOT NULL,
  remark text NOT NULL,
  notify_user boolean NOT NULL DEFAULT false,
  admin_id uuid NULL,
  ledger_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_adjustments_points_nonzero CHECK (points <> 0),
  CONSTRAINT score_adjustments_remark_nonempty CHECK (length(trim(remark)) > 0)
);

CREATE INDEX IF NOT EXISTS score_adjustments_profile_idx
  ON public.score_adjustments (profile_id, created_at DESC);

ALTER TABLE public.score_adjustments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_adjust_score(
  p_token text,
  p_profile_id text,
  p_points integer,
  p_remark text,
  p_notify boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_profile text := trim(COALESCE(p_profile_id, ''));
  v_remark text := trim(COALESCE(p_remark, ''));
  v_points integer := COALESCE(p_points, 0);
  v_source_id text := gen_random_uuid()::text;
  v_ledger_id uuid;
  v_adj_id uuid;
  v_title text;
  v_body text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  IF v_profile = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.profile_id = v_profile) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้');
  END IF;
  IF v_points = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'คะแนนต้องไม่เป็น 0');
  END IF;
  IF v_remark = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุหมายเหตุ');
  END IF;

  INSERT INTO public.score_ledger (profile_id, points, source, source_id, note)
  VALUES (v_profile, v_points, 'manual', v_source_id, NULL)
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.score_adjustments (
    profile_id, points, remark, notify_user, admin_id, ledger_id
  ) VALUES (
    v_profile, v_points, v_remark, COALESCE(p_notify, false), a.admin_id, v_ledger_id
  )
  RETURNING id INTO v_adj_id;

  IF COALESCE(p_notify, false) THEN
    IF v_points > 0 THEN
      v_title := 'ได้รับคะแนนเพิ่ม';
      v_body := format('ระบบได้ปรับคะแนนของคุณ +%s คะแนน', v_points);
    ELSE
      v_title := 'มีการหักคะแนน';
      v_body := format('ระบบได้ปรับคะแนนของคุณ %s คะแนน', v_points);
    END IF;
    PERFORM public._notify(
      'user',
      v_profile,
      v_title,
      v_body,
      'score_adjust',
      '/portal/activity',
      jsonb_build_object('points', v_points, 'adjustment_id', v_adj_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_adj_id,
    'ledger_id', v_ledger_id,
    'points', v_points
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_score_adjustments(
  p_token text,
  p_profile_id text,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id,
      'profile_id', s.profile_id,
      'points', s.points,
      'remark', s.remark,
      'notify_user', s.notify_user,
      'admin_id', s.admin_id,
      'created_at', s.created_at
    ) ORDER BY s.created_at DESC)
    FROM (
      SELECT *
      FROM public.score_adjustments s
      WHERE s.profile_id = trim(p_profile_id)
      ORDER BY s.created_at DESC
      LIMIT v_limit
    ) s
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_score(text, text, integer, text, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_score_adjustments(text, text, integer)
  TO anon, authenticated, service_role;
