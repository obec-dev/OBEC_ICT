-- Ensure projects columns exist for admin project save (reg dates / pass mode / results)
-- Run in Supabase SQL Editor, then retry saving the project.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'pass_threshold_mode'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN pass_threshold_mode text NOT NULL DEFAULT 'percent';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'pass_threshold_value'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN pass_threshold_value integer;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'enable_results_visibility'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN enable_results_visibility boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'cover_url'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN cover_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'pass_threshold'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN pass_threshold integer DEFAULT 60;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'max_score'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN max_score integer DEFAULT 5;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.projects ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

UPDATE public.projects
SET
  pass_threshold_mode = CASE
    WHEN pass_threshold IS NOT NULL AND pass_threshold > 0 AND pass_threshold <= 10 THEN 'score'
    ELSE COALESCE(NULLIF(pass_threshold_mode, ''), 'percent')
  END,
  pass_threshold_value = COALESCE(pass_threshold_value, pass_threshold, 60)
WHERE pass_threshold_value IS NULL
   OR pass_threshold_mode IS NULL
   OR pass_threshold_mode = '';

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_pass_threshold_mode_check;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_pass_threshold_mode_check
  CHECK (pass_threshold_mode IN ('percent', 'score'));

UPDATE public.projects
SET pass_threshold = pass_threshold_value
WHERE pass_threshold IS DISTINCT FROM pass_threshold_value
  AND pass_threshold_value IS NOT NULL;

UPDATE public.projects
SET enable_results_visibility = false
WHERE enable_results_visibility IS NULL;

-- Refresh upsert so it matches current columns
CREATE OR REPLACE FUNCTION public.admin_upsert_project(p_token text, p_project jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_project->>'id', ''));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_project_id');
  END IF;

  INSERT INTO public.projects AS pr (
    id, name, description, is_active, cover_url,
    reg_start, reg_end, reg_enabled,
    exam_start, exam_end, exam_enabled,
    enable_results_visibility,
    pass_threshold_mode, pass_threshold_value, pass_threshold, max_score,
    updated_at
  ) VALUES (
    v_id,
    COALESCE(NULLIF(trim(p_project->>'name'), ''), v_id),
    NULLIF(p_project->>'description', ''),
    COALESCE((p_project->>'is_active')::boolean, true),
    NULLIF(p_project->>'cover_url', ''),
    NULLIF(p_project->>'reg_start', '')::timestamptz,
    NULLIF(p_project->>'reg_end', '')::timestamptz,
    COALESCE((p_project->>'reg_enabled')::boolean, true),
    NULLIF(p_project->>'exam_start', '')::timestamptz,
    NULLIF(p_project->>'exam_end', '')::timestamptz,
    COALESCE((p_project->>'exam_enabled')::boolean, true),
    COALESCE((p_project->>'enable_results_visibility')::boolean, false),
    CASE WHEN p_project->>'pass_threshold_mode' = 'score' THEN 'score' ELSE 'percent' END,
    COALESCE((p_project->>'pass_threshold_value')::integer, (p_project->>'pass_threshold')::integer, 60),
    COALESCE((p_project->>'pass_threshold_value')::integer, (p_project->>'pass_threshold')::integer, 60),
    COALESCE((p_project->>'max_score')::integer, 5),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    cover_url = EXCLUDED.cover_url,
    reg_start = EXCLUDED.reg_start,
    reg_end = EXCLUDED.reg_end,
    reg_enabled = EXCLUDED.reg_enabled,
    exam_start = EXCLUDED.exam_start,
    exam_end = EXCLUDED.exam_end,
    exam_enabled = EXCLUDED.exam_enabled,
    enable_results_visibility = EXCLUDED.enable_results_visibility,
    pass_threshold_mode = EXCLUDED.pass_threshold_mode,
    pass_threshold_value = EXCLUDED.pass_threshold_value,
    pass_threshold = EXCLUDED.pass_threshold,
    max_score = EXCLUDED.max_score,
    updated_at = now();

  PERFORM public._write_audit(a.admin_id, 'upsert_project', 'projects', v_id, null, p_project);
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_project(text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
