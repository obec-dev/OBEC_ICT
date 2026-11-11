-- score_adjust_v2.sql
-- Profile score totals for admin user management + optional user-facing comment on notify.

CREATE OR REPLACE FUNCTION public.admin_profile_scores(
  p_token text,
  p_profile_ids text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_object_agg(x.profile_id, x.total_score)
    FROM (
      SELECT
        p.profile_id,
        COALESCE((
          SELECT SUM(sl.points)::integer
          FROM public.score_ledger sl
          WHERE sl.profile_id = p.profile_id
        ), 0) AS total_score
      FROM public.profiles p
      WHERE p.profile_id = ANY (COALESCE(p_profile_ids, ARRAY[]::text[]))
    ) x
  ), '{}'::jsonb);
END;
$$;

-- Replace 5-arg overload so PostgREST resolves the new signature cleanly.
DROP FUNCTION IF EXISTS public.admin_adjust_score(text, text, integer, text, boolean);

CREATE OR REPLACE FUNCTION public.admin_adjust_score(
  p_token text,
  p_profile_id text,
  p_points integer,
  p_remark text,
  p_notify boolean DEFAULT false,
  p_user_comment text DEFAULT NULL
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
  v_user_comment text := NULLIF(trim(COALESCE(p_user_comment, '')), '');
  v_points integer := COALESCE(p_points, 0);
  v_source_id text := gen_random_uuid()::text;
  v_ledger_id uuid;
  v_adj_id uuid;
  v_title text;
  v_body text;
  v_total integer := 0;
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
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุความคิดเห็นแอดมิน');
  END IF;

  INSERT INTO public.score_ledger (profile_id, points, source, source_id, note)
  VALUES (v_profile, v_points, 'manual', v_source_id, v_remark)
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
    IF v_user_comment IS NOT NULL THEN
      v_body := v_body || E'\n' || v_user_comment;
    END IF;
    PERFORM public._notify(
      'user',
      v_profile,
      v_title,
      v_body,
      'score_adjust',
      '/portal/activity',
      jsonb_build_object(
        'points', v_points,
        'adjustment_id', v_adj_id,
        'has_admin_comment', v_user_comment IS NOT NULL
      )
    );
  END IF;

  SELECT COALESCE(SUM(sl.points), 0)::integer INTO v_total
  FROM public.score_ledger sl
  WHERE sl.profile_id = v_profile;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_adj_id,
    'ledger_id', v_ledger_id,
    'points', v_points,
    'total_score', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_score_adjustments(
  p_token text,
  p_profile_id text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 10));
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

GRANT EXECUTE ON FUNCTION public.admin_profile_scores(text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_score(text, text, integer, text, boolean, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_score_adjustments(text, text, integer)
  TO anon, authenticated, service_role;
