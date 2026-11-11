-- Admin overview KPIs for points / live check-in / activity tasks.
-- Run in Supabase SQL Editor after activity + score migrations.

CREATE OR REPLACE FUNCTION public.admin_activity_overview_stats(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_points_total bigint := 0;
  v_users_with_score bigint := 0;
  v_by_source jsonb := '{}'::jsonb;
  v_live_active bigint := 0;
  v_live_in_window bigint := 0;
  v_checkins_total bigint := 0;
  v_checkins_today bigint := 0;
  v_tasks_open bigint := 0;
  v_sub_pending bigint := 0;
  v_sub_approved bigint := 0;
  v_sub_draft bigint := 0;
  v_sub_rejected bigint := 0;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT COALESCE(SUM(points), 0)::bigint INTO v_points_total FROM public.score_ledger;
  SELECT COUNT(*)::bigint INTO v_users_with_score
  FROM (
    SELECT profile_id FROM public.score_ledger GROUP BY profile_id HAVING SUM(points) > 0
  ) u;

  SELECT COALESCE(jsonb_object_agg(src, pts), '{}'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source AS src, COALESCE(SUM(points), 0)::bigint AS pts
    FROM public.score_ledger
    GROUP BY source
  ) s;

  SELECT COUNT(*) INTO v_live_active FROM public.live_meetings WHERE is_active = true;
  SELECT COUNT(*) INTO v_live_in_window
  FROM public.live_meetings
  WHERE is_active = true AND now() >= window_start AND now() <= window_end;

  SELECT COUNT(*) INTO v_checkins_total FROM public.live_checkins;
  SELECT COUNT(*) INTO v_checkins_today
  FROM public.live_checkins
  WHERE checked_in_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok';

  SELECT COUNT(*) INTO v_tasks_open FROM public.activity_tasks WHERE is_open = true;
  SELECT COUNT(*) INTO v_sub_pending FROM public.activity_submissions WHERE status = 'pending';
  SELECT COUNT(*) INTO v_sub_approved FROM public.activity_submissions WHERE status = 'approved';
  SELECT COUNT(*) INTO v_sub_draft FROM public.activity_submissions WHERE status = 'draft';
  SELECT COUNT(*) INTO v_sub_rejected FROM public.activity_submissions WHERE status = 'rejected';

  RETURN jsonb_build_object(
    'ok', true,
    'points_total', v_points_total,
    'users_with_score', v_users_with_score,
    'points_by_source', v_by_source,
    'live_active', v_live_active,
    'live_in_window', v_live_in_window,
    'live_checkins_total', v_checkins_total,
    'live_checkins_today', v_checkins_today,
    'tasks_open', v_tasks_open,
    'submissions_pending', v_sub_pending,
    'submissions_approved', v_sub_approved,
    'submissions_draft', v_sub_draft,
    'submissions_rejected', v_sub_rejected
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activity_overview_stats(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
