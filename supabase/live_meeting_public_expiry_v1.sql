-- Hide expired live meetings from public activity hub (keep rows + admin history).
-- Run after activity_ux_fixes_v1.sql

CREATE OR REPLACE FUNCTION public.get_my_activity_hub(
  p_profile_id text,
  p_phone text,
  p_year integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE 'Asia/Bangkok'))::integer);
  v_total integer := 0;
  v_tasks_total integer := 0;
  v_tasks_approved integer := 0;
  v_district text;
  v_school_name text;
  v_district_name text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(sum(points), 0)::integer INTO v_total
  FROM public.score_ledger WHERE profile_id = p.profile_id;

  SELECT count(*) INTO v_tasks_total FROM public.activity_tasks t WHERE t.activity_year = v_year;

  SELECT count(*) INTO v_tasks_approved
  FROM public.activity_submissions s
  JOIN public.activity_tasks t ON t.id = s.task_id
  WHERE s.profile_id = p.profile_id AND s.status = 'approved' AND t.activity_year = v_year;

  SELECT s.school_name, s.district_id, d.district_name
  INTO v_school_name, v_district, v_district_name
  FROM public.schools s
  LEFT JOIN public.districts d ON d.district_id = s.district_id
  WHERE s.school_id = p.school_id LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'school_id', p.school_id,
    'school_name', v_school_name,
    'district_id', v_district,
    'district_name', v_district_name,
    'total_score', v_total,
    'activity_year', v_year,
    'tasks_total', v_tasks_total,
    'tasks_approved', v_tasks_approved,
    'performance_pct', CASE WHEN v_tasks_total > 0
      THEN round((v_tasks_approved::numeric / v_tasks_total::numeric) * 100.0, 1) ELSE 0 END,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'activity_project_id', t.activity_project_id,
        'activity_project_name', ap.name,
        'report_name', t.report_name,
        'report_detail', t.report_detail,
        'report_deadline', t.report_deadline,
        'include_report_name', COALESCE(t.include_report_name, true),
        'include_detail', COALESCE(t.include_detail, false),
        'include_deadline', COALESCE(t.include_deadline, false),
        'include_video_url', COALESCE(t.include_video_url, true),
        'include_doc_url', COALESCE(t.include_doc_url, true),
        'score_points', t.score_points,
        'is_open', t.is_open,
        'activity_year', t.activity_year,
        'submission_status', COALESCE(s.status, 'not_submitted'),
        'submitted_report_name', s.report_name,
        'submitted_report_detail', s.report_detail,
        'video_url', s.video_url,
        'doc_url', s.doc_url,
        'report_url', s.report_url,
        'file_path', s.file_path,
        'submitted_at', s.submitted_at,
        'reviewer_note', s.reviewer_note
      ) ORDER BY t.report_deadline NULLS LAST, t.created_at DESC)
      FROM public.activity_tasks t
      LEFT JOIN public.activity_projects ap ON ap.id = t.activity_project_id
      LEFT JOIN public.activity_submissions s ON s.task_id = t.id AND s.profile_id = p.profile_id
      WHERE t.is_open = true OR s.id IS NOT NULL
    ), '[]'::jsonb),
    'live_meetings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'title', m.title, 'youtube_url', m.youtube_url,
        'window_start', m.window_start, 'window_end', m.window_end,
        'score_points', m.score_points, 'is_active', m.is_active,
        'in_window', (now() >= m.window_start AND now() <= m.window_end AND m.is_active),
        'checked_in', EXISTS (SELECT 1 FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id),
        'checked_in_at', (SELECT c.checked_in_at FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id LIMIT 1)
      ) ORDER BY m.window_start DESC)
      FROM public.live_meetings m
      WHERE (
        (m.is_active = true AND now() <= m.window_end)
        OR EXISTS (
          SELECT 1 FROM public.live_checkins c WHERE c.meeting_id = m.id AND c.profile_id = p.profile_id
        )
      )
    ), '[]'::jsonb)
  );
END;
$$;


GRANT EXECUTE ON FUNCTION public.get_my_activity_hub(text, text, integer) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
