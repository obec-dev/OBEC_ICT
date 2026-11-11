-- activity_radar_label_v1
-- Include activity_project_name on auditor_school_radar task options
-- so Radar labels show the real project/task name instead of only report_name
-- (which may still be the old default "ภารกิจ").

CREATE OR REPLACE FUNCTION public.auditor_school_radar(
  p_login_email text,
  p_task_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
  v_task_filter uuid := p_task_id;
  v_task_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := public._audit_primary_district(p_login_email);
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  IF v_task_filter IS NULL THEN
    SELECT count(*) INTO v_task_count FROM public.activity_tasks;
  ELSE
    v_task_count := 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'district_id', v_district,
    'task_id', v_task_filter,
    'tasks_total', v_task_count,
    'tasks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'report_name', t.report_name,
          'activity_project_name', ap.name,
          'project_id', t.activity_project_id
        )
        ORDER BY t.created_at DESC
      )
      FROM public.activity_tasks t
      LEFT JOIN public.activity_projects ap ON ap.id = t.activity_project_id
    ), '[]'::jsonb),
    'schools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'school_id', s.school_id,
        'school_name', s.school_name,
        'users', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'profile_id', p.profile_id,
            'first_name', p.first_name,
            'last_name', p.last_name,
            'status', CASE
              WHEN v_task_filter IS NOT NULL THEN COALESCE((
                SELECT sub.status FROM public.activity_submissions sub
                WHERE sub.task_id = v_task_filter AND sub.profile_id = p.profile_id
              ), 'not_submitted')
              ELSE NULL
            END,
            'done', CASE
              WHEN v_task_filter IS NOT NULL THEN NULL
              ELSE (
                SELECT count(*) FROM public.activity_submissions sub
                JOIN public.activity_tasks t2 ON t2.id = sub.task_id
                WHERE sub.profile_id = p.profile_id AND sub.status = 'approved'
              )
            END,
            'total', CASE
              WHEN v_task_filter IS NOT NULL THEN NULL
              ELSE v_task_count
            END
          ) ORDER BY p.last_name, p.first_name), '[]'::jsonb)
          FROM public.profiles p
          WHERE p.school_id = s.school_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
      ) ORDER BY s.school_name)
      FROM public.schools s
      WHERE s.district_id = v_district
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auditor_school_radar(text, uuid) TO anon, authenticated, service_role;
