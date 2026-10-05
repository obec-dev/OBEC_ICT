-- Admin progress tracking: improve overview aggregation (NON-DESTRUCTIVE)
-- CREATE OR REPLACE only — no DROP TABLE / TRUNCATE / data mutations.
-- Run in Supabase SQL Editor after reviewing.

-- ---------------------------------------------------------------------------
-- 1) admin_overview_stats — distinct active candidates + pass/fail + partial
--    Optional p_project_id filters to site project (NULL project_id rows included).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_overview_stats(
  p_token text,
  p_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  a public.admins;
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
BEGIN
  a := public._admin_from_token(p_token);

  RETURN jsonb_build_object(
    'schools_total', (SELECT count(*) FROM public.schools),
    'schools_registered', (
      SELECT count(*) FROM public.schools s
      WHERE public.school_has_active_registrant(s.school_id)
    ),
    'districts_total', (SELECT count(*) FROM public.districts),
    'profiles_total', (
      SELECT count(*) FROM public.profiles
      WHERE deleted_at IS NULL
        AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')
    ),
    'profiles_today', (
      SELECT count(*) FROM public.profiles
      WHERE deleted_at IS NULL
        AND COALESCE(portal_role, 'user') IN ('user', 'school_admin')
        AND created_at::date = (timezone('Asia/Bangkok', now()))::date
    ),
    'watch_completed', (
      SELECT count(*) FROM public.watch_progress w
      WHERE COALESCE(w.completed, false)
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = w.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'watch_total', (
      SELECT count(*) FROM public.watch_progress w
      WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.profile_id = w.profile_id
          AND p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      )
    ),
    'exam_submitted', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE e.status::text = 'submitted'
        AND (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_draft', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE e.status::text = 'draft'
        AND (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_partial', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE e.status::text = 'draft'
        AND EXISTS (
          SELECT 1
          FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS t(k, v)
          WHERE COALESCE(v->>'status', '') = 'submitted'
        )
        AND (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_passed', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE e.status::text = 'submitted'
        AND e.passed IS TRUE
        AND (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_failed', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE e.status::text = 'submitted'
        AND e.passed IS FALSE
        AND (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'exam_total', (
      SELECT count(DISTINCT e.profile_id)
      FROM public.exam_progress e
      WHERE (
          v_project IS NULL
          OR e.project_id = v_project
          OR e.project_id IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.profile_id = e.profile_id
            AND p.deleted_at IS NULL
            AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        )
    ),
    'project_id', to_jsonb(v_project)
  );
END;
$$;

-- 1-arg wrapper so existing clients keep working
CREATE OR REPLACE FUNCTION public.admin_overview_stats(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN public.admin_overview_stats(p_token, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_overview_stats(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_overview_stats(text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) admin_export_participants_full — same 5-arg signature; better exam join
--    (partial lesson label + prefer submitted / newest row; no table changes)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_export_participants_full(
  p_token text,
  p_district_id text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 2000), 5000));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
  v_province text := NULLIF(trim(COALESCE(p_province, '')), '');
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id AS member_id,
        trim(COALESCE(p.title_th, '') || ' ' || COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
        COALESCE(p.login_email, p.contact_email, p.email) AS email,
        p.phone,
        COALESCE(p.portal_role, 'user') AS role,
        p.school_id,
        s.school_name,
        s.province,
        COALESCE(d.district_id, s.district_id) AS district_id,
        COALESCE(d.district_name, s.district_id) AS district_name,
        COALESCE(NULLIF(trim(s.partner), ''), '') AS zone_partner,
        COALESCE(e.status::text, 'none') AS exam_status,
        CASE
          WHEN e.status::text = 'submitted' AND e.passed IS TRUE THEN 'สอบผ่าน'
          WHEN e.status::text = 'submitted' AND e.passed IS FALSE THEN 'สอบไม่ผ่าน'
          WHEN e.status::text = 'submitted' THEN 'ส่งข้อสอบแล้ว (รอตรวจ)'
          WHEN e.status::text = 'draft'
            AND EXISTS (
              SELECT 1
              FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS ls(k, v)
              WHERE COALESCE(v->>'status', '') = 'submitted'
            )
            THEN 'ส่งบางบทแล้ว'
          WHEN e.status::text = 'draft' THEN 'ฉบับร่าง / กำลังทำข้อสอบ'
          WHEN COALESCE(w.watch_completed, false) THEN 'เรียนจบ (ยังไม่เริ่มสอบ)'
          WHEN COALESCE(w.watch_rows, 0) > 0 THEN 'กำลังเรียน'
          ELSE 'ยังไม่เริ่ม'
        END AS overall_progress,
        CASE WHEN COALESCE(w.watch_completed, false) THEN 'yes' ELSE 'no' END AS learn_completed,
        to_char(e.submitted_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_submitted_at,
        to_char(e.graded_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_graded_at,
        to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS registered_at
      FROM public.profiles p
      JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      LEFT JOIN LATERAL (
        SELECT ep.*
        FROM public.exam_progress ep
        WHERE ep.profile_id = p.profile_id
        ORDER BY
          CASE WHEN ep.status::text = 'submitted' THEN 0 ELSE 1 END,
          ep.updated_at DESC NULLS LAST
        LIMIT 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS watch_rows,
          bool_or(COALESCE(wp.completed, false)) AS watch_completed
        FROM public.watch_progress wp
        WHERE wp.profile_id = p.profile_id
      ) w ON true
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (v_district IS NULL OR COALESCE(d.district_id, s.district_id) = v_district)
        AND (v_province IS NULL OR s.province = v_province)
      ORDER BY s.province, d.district_name, s.school_name, p.last_name, p.first_name
      LIMIT v_limit OFFSET v_offset
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_participants_full(text, text, text, integer, integer)
  TO anon, authenticated, service_role;
