-- Public bootstrap: one RPC for projects + site_settings + school_totals.
-- Cuts API Gateway log volume (many GET/OPTIONS on /rest/v1/site_settings and /projects).
--
-- Optional Postgres log tuning (secondary; run separately if needed):
--   ALTER ROLE postgres SET log_statement TO 'none';
--   ALTER ROLE postgres SET log_min_duration_statement TO '2000';
--   ALTER ROLE postgres SET log_connections TO 'off';
--   ALTER ROLE postgres SET log_disconnections TO 'off';
--
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.public_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projects jsonb;
  v_settings jsonb;
  v_totals jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.created_at ASC), '[]'::jsonb)
  INTO v_projects
  FROM (
    SELECT
      id, name, description, is_active, cover_url,
      reg_start, reg_end, reg_enabled,
      exam_start, exam_end, exam_enabled,
      enable_results_visibility,
      pass_threshold_mode, pass_threshold_value, pass_threshold, max_score,
      created_at, updated_at
    FROM public.projects
    ORDER BY created_at ASC
  ) p;

  SELECT COALESCE(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  INTO v_settings
  FROM public.site_settings s;

  SELECT jsonb_build_object(
    'total_schools', t.total_schools,
    'registered_schools', t.registered_schools,
    'total_districts', t.total_districts
  )
  INTO v_totals
  FROM public.get_school_totals() t;

  RETURN jsonb_build_object(
    'ok', true,
    'projects', v_projects,
    'site_settings', v_settings,
    'school_totals', COALESCE(v_totals, jsonb_build_object(
      'total_schools', 0,
      'registered_schools', 0,
      'total_districts', 0
    ))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_bootstrap() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
