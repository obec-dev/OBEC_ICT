-- Flatten ict_survey into per-key columns for registration CSV export.
-- Run after profiles_approver_export_v1.sql

CREATE OR REPLACE FUNCTION public.admin_export_registration_details(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
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
      ORDER BY p.created_at DESC, s.school_name, p.last_name, p.first_name
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_registration_details(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
