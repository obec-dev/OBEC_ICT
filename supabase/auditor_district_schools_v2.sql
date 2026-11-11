-- auditor_district_schools_v2.sql
-- Enrich district school list: recent activity per user, max user score, users by score.

CREATE OR REPLACE FUNCTION public.auditor_district_schools(
  p_login_email text,
  p_district_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_district text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_district := COALESCE(NULLIF(trim(p_district_id), ''), public._audit_primary_district(p_login_email));
  IF v_district IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  -- Ensure caller is assigned to this district
  IF NOT EXISTS (
    SELECT 1
    FROM public.audit_users au
    WHERE lower(trim(au.login_email)) = lower(trim(p_login_email))
      AND au.deleted_at IS NULL
      AND au.is_active IS DISTINCT FROM false
      AND v_district = ANY (public._district_ids_from_jsonb(au.assigned_districts))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่มีสิทธิ์ดูเขตนี้');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'district_id', v_district,
    'schools', COALESCE((
      SELECT jsonb_agg(school_row ORDER BY school_row->>'school_name')
      FROM (
        SELECT jsonb_build_object(
          'school_id', s.school_id,
          'school_name', s.school_name,
          'province', s.province,
          'user_count', (
            SELECT count(*)
            FROM public.profiles p
            WHERE p.school_id = s.school_id
              AND p.deleted_at IS NULL
              AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
          ),
          'is_registered', COALESCE(s.is_registered, false),
          'max_user_score', COALESCE((
            SELECT MAX(user_total)
            FROM (
              SELECT COALESCE(SUM(sl.points), 0)::integer AS user_total
              FROM public.profiles p
              LEFT JOIN public.score_ledger sl ON sl.profile_id = p.profile_id
              WHERE p.school_id = s.school_id
                AND p.deleted_at IS NULL
                AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
              GROUP BY p.profile_id
            ) totals
          ), 0),
          'users', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'profile_id', u.profile_id,
                'first_name', u.first_name,
                'last_name', u.last_name,
                'score', u.score,
                'recent_activity_at', u.recent_activity_at
              )
              ORDER BY u.score DESC, u.last_name, u.first_name
            )
            FROM (
              SELECT
                p.profile_id,
                p.first_name,
                p.last_name,
                COALESCE((
                  SELECT SUM(sl.points)::integer
                  FROM public.score_ledger sl
                  WHERE sl.profile_id = p.profile_id
                ), 0) AS score,
                (
                  SELECT MAX(ts)
                  FROM (
                    SELECT p.updated_at AS ts
                    UNION ALL
                    SELECT w.updated_at
                    FROM public.watch_progress w
                    WHERE w.profile_id = p.profile_id
                    UNION ALL
                    SELECT e.updated_at
                    FROM public.exam_progress e
                    WHERE e.profile_id = p.profile_id
                    UNION ALL
                    SELECT sl.created_at
                    FROM public.score_ledger sl
                    WHERE sl.profile_id = p.profile_id
                  ) activity
                ) AS recent_activity_at
              FROM public.profiles p
              WHERE p.school_id = s.school_id
                AND p.deleted_at IS NULL
                AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
            ) u
          ), '[]'::jsonb)
        ) AS school_row
        FROM public.schools s
        WHERE s.district_id = v_district
      ) q
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auditor_district_schools(text, text) TO anon, authenticated, service_role;
