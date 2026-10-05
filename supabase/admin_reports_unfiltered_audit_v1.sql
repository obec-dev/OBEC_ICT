-- Unfiltered analytics exports + audit coverage for admin mutations
-- NON-DESTRUCTIVE: CREATE OR REPLACE only — no DROP TABLE / TRUNCATE / data wipes.
-- Run in Supabase SQL Editor after review.

-- ---------------------------------------------------------------------------
-- 1) Raise export page size (still paged for payload safety; UI loads ALL pages)
--    Null district/province = nationwide. Always filter deleted_at IS NULL.
--    Audit each export call (offset=0 marks start of a full dump).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_export_participants_full(
  p_token text,
  p_district_id text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 5000), 10000));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
  v_province text := NULLIF(trim(COALESCE(p_province, '')), '');
  v_rows jsonb;
  v_count integer := 0;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb), count(*)
  INTO v_rows, v_count
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
  ) t;

  PERFORM public._write_audit(
    a.admin_id,
    'export_participants_full',
    'profiles',
    NULL,
    NULL,
    jsonb_build_object(
      'district_id', v_district,
      'province', v_province,
      'limit', v_limit,
      'offset', v_offset,
      'row_count', COALESCE(v_count, 0),
      'scope', CASE WHEN v_district IS NULL AND v_province IS NULL THEN 'ALL' ELSE 'FILTERED' END
    )
  );

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_participants_full(text, text, text, integer, integer)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_export_registration_details(
  p_token text,
  p_district_id text DEFAULT NULL,
  p_province text DEFAULT NULL,
  p_limit integer DEFAULT 5000,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 5000), 10000));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
  v_province text := NULLIF(trim(COALESCE(p_province, '')), '');
  v_rows jsonb;
  v_count integer := 0;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb), count(*)
  INTO v_rows, v_count
  FROM (
    SELECT
      p.profile_id AS member_id,
      p.title_key,
      p.title_th,
      p.title_en,
      p.title_other_th,
      p.title_other_en,
      p.first_name,
      p.last_name,
      p.eng_first_name,
      p.eng_last_name,
      p.gender,
      p.birth_date::text AS birth_date,
      p.phone,
      p.line_id,
      COALESCE(p.contact_email, p.email) AS contact_email,
      COALESCE(p.login_email, p.email) AS login_email,
      p.position,
      p.position_other,
      p.duty,
      p.ict_talent_cohort,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain1_planning', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain1_planning,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain2_teacher_dev', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain2_teacher_dev,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain3_student_skills', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain3_student_skills,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain4_infra', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain4_infra,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain5_coordination', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain5_coordination,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'domain6_monitoring', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_domain6_monitoring,
      COALESCE((
        SELECT string_agg(x, '; ' ORDER BY ord)
        FROM jsonb_array_elements_text(COALESCE(p.ict_survey->'sms_usage', '[]'::jsonb))
          WITH ORDINALITY AS t(x, ord)
      ), '') AS survey_sms_usage,
      COALESCE(p.portal_role, 'user') AS portal_role,
      COALESCE(p.is_school_admin, false) AS is_school_admin,
      p.approver,
      p.approver_position,
      p.school_id,
      s.school_name,
      s.province,
      COALESCE(d.district_id, s.district_id) AS district_id,
      COALESCE(d.district_name, s.district_id) AS district_name,
      COALESCE(NULLIF(trim(s.partner), ''), '') AS partner,
      COALESCE(s.is_registered, false) AS school_is_registered,
      to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS registered_at
    FROM public.profiles p
    JOIN public.schools s ON s.school_id = p.school_id
    LEFT JOIN public.districts d ON d.district_id = s.district_id
    WHERE p.deleted_at IS NULL
      AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      AND (v_district IS NULL OR COALESCE(d.district_id, s.district_id) = v_district)
      AND (v_province IS NULL OR s.province = v_province)
    ORDER BY p.created_at DESC, s.school_name, p.last_name, p.first_name
    LIMIT v_limit OFFSET v_offset
  ) t;

  PERFORM public._write_audit(
    a.admin_id,
    'export_registration_details',
    'profiles',
    NULL,
    NULL,
    jsonb_build_object(
      'district_id', v_district,
      'province', v_province,
      'limit', v_limit,
      'offset', v_offset,
      'row_count', COALESCE(v_count, 0),
      'scope', CASE WHEN v_district IS NULL AND v_province IS NULL THEN 'ALL' ELSE 'FILTERED' END
    )
  );

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_registration_details(text, text, text, integer, integer)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Audit export_exam_responses + export_hierarchy
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_export_exam_responses(
  p_token text,
  p_project_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
  v_rows jsonb;
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_project IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'profile_id', e.profile_id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')),
      'school_id', p.school_id,
      'school_name', s.school_name,
      'phone', p.phone,
      'email', COALESCE(p.login_email, p.contact_email, p.email),
      'login_email', COALESCE(p.login_email, p.contact_email, p.email),
      'project_id', e.project_id,
      'answers', e.answers,
      'status', e.status,
      'score', e.score,
      'passed', e.passed,
      'graded_at', e.graded_at,
      'updated_at', e.updated_at
    ) ORDER BY e.updated_at DESC)
    FROM public.exam_progress e
    JOIN public.profiles p ON p.profile_id = e.profile_id AND p.deleted_at IS NULL
    LEFT JOIN public.schools s ON s.school_id = p.school_id
    WHERE e.project_id = v_project OR e.project_id IS NULL
  ), '[]'::jsonb)
  INTO v_rows;

  v_count := jsonb_array_length(COALESCE(v_rows, '[]'::jsonb));

  PERFORM public._write_audit(
    a.admin_id,
    'export_exam_responses',
    'exam_progress',
    v_project,
    NULL,
    jsonb_build_object('project_id', v_project, 'row_count', v_count)
  );

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_exam_responses(text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_export_hierarchy(
  p_token text,
  p_mode text DEFAULT 'district'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_mode text := lower(trim(COALESCE(p_mode, 'district')));
  v_rows jsonb;
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);

  IF v_mode = 'partner' THEN
    SELECT COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
      FROM (
        SELECT
          COALESCE(NULLIF(trim(s.partner), ''), 'ไม่ระบุ Partner') AS partner,
          COALESCE(d.district_id, s.district_id) AS district_id,
          COALESCE(d.district_name, s.district_id) AS district_name,
          s.school_id,
          s.school_name,
          s.province,
          COALESCE(p.login_email, p.contact_email, p.email) AS login_email,
          trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
          p.phone,
          COALESCE(p.contact_email, p.email) AS email,
          COALESCE(p.portal_role, 'user') AS portal_role,
          p.profile_id
        FROM public.profiles p
        JOIN public.schools s ON s.school_id = p.school_id
        LEFT JOIN public.districts d ON d.district_id = s.district_id
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        ORDER BY partner, d.district_name, s.school_name, p.last_name
      ) t
    ), '[]'::jsonb) INTO v_rows;
  ELSE
    SELECT COALESCE((
      SELECT jsonb_agg(row_to_json(t)::jsonb)
      FROM (
        SELECT
          COALESCE(d.district_id, s.district_id) AS district_id,
          COALESCE(d.district_name, s.district_id) AS district_name,
          s.province,
          s.school_id,
          s.school_name,
          COALESCE(p.login_email, p.contact_email, p.email) AS login_email,
          trim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
          p.phone,
          COALESCE(p.contact_email, p.email) AS email,
          COALESCE(p.portal_role, 'user') AS portal_role,
          p.profile_id
        FROM public.profiles p
        JOIN public.schools s ON s.school_id = p.school_id
        LEFT JOIN public.districts d ON d.district_id = s.district_id
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        ORDER BY d.district_name, s.school_name, p.last_name
      ) t
    ), '[]'::jsonb) INTO v_rows;
  END IF;

  v_count := jsonb_array_length(COALESCE(v_rows, '[]'::jsonb));
  PERFORM public._write_audit(
    a.admin_id,
    'export_hierarchy',
    'profiles',
    v_mode,
    NULL,
    jsonb_build_object('mode', v_mode, 'row_count', v_count, 'scope', 'ALL')
  );

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_hierarchy(text, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Audit video/exam-section mutations (mapping + content admin)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_video(p_token text, p_video jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_video->>'id', ''));
  v_section text := NULLIF(trim(COALESCE(p_video->>'exam_section_id', '')), '');
  v_old jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_video_id');
  END IF;

  SELECT to_jsonb(v) INTO v_old FROM public.project_videos v WHERE v.id = v_id;

  INSERT INTO public.project_videos (
    id, project_id, title, video_url, video_id, is_mandatory, order_index, exam_section_id
  ) VALUES (
    v_id,
    trim(p_video->>'project_id'),
    COALESCE(NULLIF(trim(p_video->>'title'), ''), v_id),
    NULLIF(p_video->>'video_url', ''),
    NULLIF(p_video->>'video_id', ''),
    COALESCE((p_video->>'is_mandatory')::boolean, false),
    COALESCE((p_video->>'order_index')::integer, 0),
    v_section
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    video_url = EXCLUDED.video_url,
    video_id = EXCLUDED.video_id,
    is_mandatory = EXCLUDED.is_mandatory,
    order_index = EXCLUDED.order_index,
    exam_section_id = EXCLUDED.exam_section_id;

  PERFORM public._write_audit(
    a.admin_id,
    CASE WHEN v_old IS NULL THEN 'create_video' ELSE 'update_exam_mapping' END,
    'project_videos',
    v_id,
    v_old,
    p_video
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_video(text, jsonb)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_video(p_token text, p_video_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_video_id, ''));
  v_old jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT to_jsonb(v) INTO v_old FROM public.project_videos v WHERE v.id = v_id;
  DELETE FROM public.project_videos WHERE id = v_id;
  PERFORM public._write_audit(
    a.admin_id, 'delete_video', 'project_videos', v_id, v_old, NULL
  );
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_video(text, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_section(p_token text, p_section jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_section->>'id', ''));
  v_project text := trim(COALESCE(p_section->>'project_id', ''));
  v_title text := NULLIF(trim(COALESCE(p_section->>'title', '')), '');
  v_old jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' OR v_project = '' OR v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อส่วนข้อสอบ');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM public.exam_sections s WHERE s.id = v_id;

  INSERT INTO public.exam_sections (id, project_id, title, description, section_order, updated_at)
  VALUES (
    v_id,
    v_project,
    v_title,
    NULLIF(trim(COALESCE(p_section->>'description', '')), ''),
    COALESCE((p_section->>'section_order')::integer, 0),
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    section_order = EXCLUDED.section_order,
    updated_at = timezone('utc'::text, now());

  PERFORM public._write_audit(
    a.admin_id,
    CASE WHEN v_old IS NULL THEN 'create_exam_section' ELSE 'update_exam_section' END,
    'exam_sections',
    v_id,
    v_old,
    p_section
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_section(text, jsonb)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_section(p_token text, p_section_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_section_id, ''));
  v_old jsonb;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT to_jsonb(s) INTO v_old FROM public.exam_sections s WHERE s.id = v_id;
  DELETE FROM public.exam_sections WHERE id = v_id;
  PERFORM public._write_audit(
    a.admin_id, 'delete_exam_section', 'exam_sections', v_id, v_old, NULL
  );
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_section(text, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
