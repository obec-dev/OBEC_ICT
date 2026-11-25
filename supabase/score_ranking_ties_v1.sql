-- =============================================================================
-- score_ranking_ties_v1.sql
-- Competition RANK() on score only (same score → same rank; next = 1 + higher count).
-- Within a rank, sort by last_name, first_name ascending for display.
-- Run after activity_ux_fixes_v1.sql
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_score_ranking(
  p_profile_id text,
  p_phone text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_my_score integer := 0;
  v_my_rank integer := NULL;
  v_top jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(sum(points), 0)::integer INTO v_my_score
  FROM public.score_ledger WHERE profile_id = p.profile_id;

  WITH totals AS (
    SELECT
      sl.profile_id,
      sum(sl.points)::integer AS total_score,
      max(pr.first_name) AS first_name,
      max(pr.last_name) AS last_name,
      max(s.school_name) AS school_name
    FROM public.score_ledger sl
    JOIN public.profiles pr ON pr.profile_id = sl.profile_id AND pr.deleted_at IS NULL
    LEFT JOIN public.schools s ON s.school_id = pr.school_id
    GROUP BY sl.profile_id
  ),
  ranked AS (
    SELECT
      t.*,
      RANK() OVER (ORDER BY t.total_score DESC) AS rank_no
    FROM totals t
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'rank', r.rank_no,
      'profile_id', r.profile_id,
      'first_name', r.first_name,
      'last_name', r.last_name,
      'school_name', r.school_name,
      'total_score', r.total_score,
      'is_me', r.profile_id = p.profile_id
    )
    ORDER BY r.rank_no, r.last_name NULLS LAST, r.first_name NULLS LAST, r.profile_id
  )
  INTO v_top
  FROM ranked r
  WHERE r.rank_no <= v_limit;

  SELECT r.rank_no INTO v_my_rank
  FROM (
    SELECT
      sl.profile_id,
      RANK() OVER (ORDER BY sum(sl.points) DESC) AS rank_no
    FROM public.score_ledger sl
    JOIN public.profiles pr ON pr.profile_id = sl.profile_id AND pr.deleted_at IS NULL
    GROUP BY sl.profile_id
  ) r
  WHERE r.profile_id = p.profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'top', COALESCE(v_top, '[]'::jsonb),
    'me', jsonb_build_object(
      'profile_id', p.profile_id,
      'total_score', v_my_score,
      'rank', v_my_rank,
      'in_top', COALESCE(v_my_rank, 999999) <= v_limit
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_score_ranking(text, text, integer) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
