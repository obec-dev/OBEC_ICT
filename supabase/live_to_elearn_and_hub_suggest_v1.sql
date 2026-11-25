-- =============================================================================
-- live_to_elearn_and_hub_suggest_v1.sql
-- 1) Live → E-learning after window_end (opt-in per meeting)
-- 2) list_self_learn_videos returns created_at (hub suggests latest 3 uncredited)
-- Run after activity_hub_open_tasks_count_v1.sql + self_learn_v1.sql
-- =============================================================================

ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS convert_to_elearn boolean NOT NULL DEFAULT false;
ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS elearn_title text;
ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS elearn_score_points integer;
ALTER TABLE public.live_meetings
  ADD COLUMN IF NOT EXISTS converted_self_learn_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'self_learn_videos'
      AND column_name = 'source_live_meeting_id'
  ) THEN
    ALTER TABLE public.self_learn_videos
      ADD COLUMN source_live_meeting_id uuid;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS self_learn_videos_source_live_uidx
  ON public.self_learn_videos (source_live_meeting_id)
  WHERE source_live_meeting_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Promote expired lives that opted into E-learning (idempotent)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_expired_lives_to_elearn()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_id uuid;
  v_title text;
  v_points integer;
  v_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  FOR r IN
    SELECT m.*
    FROM public.live_meetings m
    WHERE m.convert_to_elearn = true
      AND m.window_end < now()
      AND m.converted_self_learn_id IS NULL
  LOOP
    -- Already linked from a prior partial run?
    SELECT v.id INTO v_id
    FROM public.self_learn_videos v
    WHERE v.source_live_meeting_id = r.id
    LIMIT 1;

    IF v_id IS NULL THEN
      v_title := NULLIF(trim(COALESCE(r.elearn_title, '')), '');
      IF v_title IS NULL THEN
        v_title := COALESCE(NULLIF(trim(r.title), ''), 'บันทึก Live');
      END IF;
      v_points := COALESCE(r.elearn_score_points, r.score_points, 0);
      IF v_points < 0 THEN v_points := 0; END IF;

      INSERT INTO public.self_learn_videos (
        title, video_url, score_points, sort_order, is_published, source_live_meeting_id
      )
      VALUES (
        v_title,
        r.youtube_url,
        v_points,
        0,
        true,
        r.id
      )
      RETURNING id INTO v_id;
    END IF;

    UPDATE public.live_meetings
    SET converted_self_learn_id = v_id, updated_at = now()
    WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- admin live list / upsert — include convert fields
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_live_meetings(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM public.promote_expired_lives_to_elearn();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'youtube_url', m.youtube_url,
      'window_start', m.window_start,
      'window_end', m.window_end,
      'score_points', m.score_points,
      'is_active', m.is_active,
      'convert_to_elearn', COALESCE(m.convert_to_elearn, false),
      'elearn_title', m.elearn_title,
      'elearn_score_points', m.elearn_score_points,
      'converted_self_learn_id', m.converted_self_learn_id,
      'created_at', m.created_at,
      'updated_at', m.updated_at
    ) ORDER BY m.window_start DESC)
    FROM public.live_meetings m
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_live_meeting(p_token text, p_meeting jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_url text;
  v_start timestamptz;
  v_end timestamptz;
  v_convert boolean;
  v_elearn_title text;
  v_elearn_points integer;
BEGIN
  a := public._admin_from_token(p_token);
  v_url := NULLIF(trim(COALESCE(p_meeting->>'youtube_url', '')), '');
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุ YouTube URL');
  END IF;
  BEGIN
    v_start := (p_meeting->>'window_start')::timestamptz;
    v_end := (p_meeting->>'window_end')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ช่วงเวลาไม่ถูกต้อง');
  END;
  IF v_start IS NULL OR v_end IS NULL OR v_end <= v_start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ช่วงเวลา check-in ไม่ถูกต้อง');
  END IF;

  v_convert := COALESCE((p_meeting->>'convert_to_elearn')::boolean, false);
  v_elearn_title := NULLIF(trim(COALESCE(p_meeting->>'elearn_title', '')), '');
  BEGIN
    v_elearn_points := NULLIF(trim(COALESCE(p_meeting->>'elearn_score_points', '')), '')::integer;
  EXCEPTION WHEN others THEN
    v_elearn_points := NULL;
  END;

  IF NULLIF(trim(COALESCE(p_meeting->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_meeting->>'id')::uuid;
    UPDATE public.live_meetings SET
      title = COALESCE(NULLIF(trim(p_meeting->>'title'), ''), title),
      youtube_url = v_url,
      window_start = v_start,
      window_end = v_end,
      score_points = GREATEST(0, COALESCE((p_meeting->>'score_points')::integer, score_points)),
      is_active = COALESCE((p_meeting->>'is_active')::boolean, is_active),
      convert_to_elearn = v_convert,
      elearn_title = v_elearn_title,
      elearn_score_points = v_elearn_points,
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบ Live meeting');
    END IF;
  ELSE
    INSERT INTO public.live_meetings (
      title, youtube_url, window_start, window_end, score_points, is_active,
      convert_to_elearn, elearn_title, elearn_score_points
    )
    VALUES (
      COALESCE(NULLIF(trim(p_meeting->>'title'), ''), 'Live meeting'),
      v_url,
      v_start,
      v_end,
      GREATEST(0, COALESCE((p_meeting->>'score_points')::integer, 0)),
      COALESCE((p_meeting->>'is_active')::boolean, true),
      v_convert,
      v_elearn_title,
      v_elearn_points
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public.promote_expired_lives_to_elearn();
  PERFORM public._write_audit(a.admin_id, 'upsert_live_meeting', 'live_meetings', v_id::text, null, p_meeting);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- list_self_learn_videos — include created_at; promote first
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_self_learn_videos(
  p_profile_id text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_has_profile boolean := false;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  PERFORM public.promote_expired_lives_to_elearn();

  IF NULLIF(trim(COALESCE(p_profile_id, '')), '') IS NOT NULL
     AND NULLIF(trim(COALESCE(p_phone, '')), '') IS NOT NULL THEN
    BEGIN
      p := public._verify_profile_phone(p_profile_id, p_phone);
      v_has_profile := true;
    EXCEPTION WHEN OTHERS THEN
      v_has_profile := false;
    END;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id,
      'title', v.title,
      'video_url', v.video_url,
      'score_points', v.score_points,
      'sort_order', v.sort_order,
      'created_at', v.created_at,
      'credited', CASE
        WHEN v_has_profile THEN EXISTS (
          SELECT 1 FROM public.score_ledger sl
          WHERE sl.profile_id = p.profile_id
            AND sl.source = 'self_learn'
            AND sl.source_id = v.id::text
        )
        ELSE false
      END
    ) ORDER BY v.sort_order ASC, v.created_at DESC)
    FROM public.self_learn_videos v
    WHERE v.is_published = true
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- get_my_activity_hub — promote expired lives before returning
-- -----------------------------------------------------------------------------
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
  PERFORM public.promote_expired_lives_to_elearn();

  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT COALESCE(sum(points), 0)::integer INTO v_total
  FROM public.score_ledger WHERE profile_id = p.profile_id;

  SELECT count(*) INTO v_tasks_total
  FROM public.activity_tasks t
  WHERE t.activity_year = v_year
    AND t.is_open = true;

  SELECT count(*) INTO v_tasks_approved
  FROM public.activity_submissions s
  JOIN public.activity_tasks t ON t.id = s.task_id
  WHERE s.profile_id = p.profile_id
    AND s.status = 'approved'
    AND t.activity_year = v_year
    AND t.is_open = true;

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

-- -----------------------------------------------------------------------------
-- list_public_live_meetings — promote then list (plpgsql so we can call helper)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_public_live_meetings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM public.promote_expired_lives_to_elearn();
  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_ts ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'youtube_url', m.youtube_url,
        'window_start', m.window_start,
        'window_end', m.window_end,
        'score_points', m.score_points,
        'is_active', m.is_active,
        'in_window', (now() >= m.window_start AND now() <= m.window_end)
      ) AS row_data,
      m.window_start AS sort_ts
    FROM public.live_meetings m
    WHERE m.is_active = true
      AND now() <= m.window_end
  ) t;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_expired_lives_to_elearn() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_live_meetings(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_live_meeting(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_self_learn_videos(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_activity_hub(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_live_meetings() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
