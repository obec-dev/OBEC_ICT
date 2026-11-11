-- self_learn_v1.sql
-- Portal self-learning video catalog (separate from project_videos / lesson+test).

ALTER TABLE public.score_ledger DROP CONSTRAINT IF EXISTS score_ledger_source_check;
ALTER TABLE public.score_ledger
  ADD CONSTRAINT score_ledger_source_check
  CHECK (source IN ('task', 'elearning', 'live', 'self_learn', 'manual'));

CREATE TABLE IF NOT EXISTS public.self_learn_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  video_url text NOT NULL,
  score_points integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_learn_videos ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.admin_list_self_learn_videos(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', v.id,
      'title', v.title,
      'video_url', v.video_url,
      'score_points', v.score_points,
      'sort_order', v.sort_order,
      'is_published', v.is_published,
      'updated_at', v.updated_at
    ) ORDER BY v.sort_order ASC, v.created_at DESC)
    FROM public.self_learn_videos v
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_self_learn_video(p_token text, p_video jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_title text;
  v_url text;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  v_title := NULLIF(trim(COALESCE(p_video->>'title', '')), '');
  v_url := NULLIF(trim(COALESCE(p_video->>'video_url', '')), '');
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุชื่อวิดีโอ');
  END IF;
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุลิงก์วิดีโอ');
  END IF;

  IF NULLIF(trim(COALESCE(p_video->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_video->>'id')::uuid;
    UPDATE public.self_learn_videos SET
      title = v_title,
      video_url = v_url,
      score_points = COALESCE((p_video->>'score_points')::integer, 0),
      sort_order = COALESCE((p_video->>'sort_order')::integer, 0),
      is_published = COALESCE((p_video->>'is_published')::boolean, false),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
    END IF;
  ELSE
    INSERT INTO public.self_learn_videos (title, video_url, score_points, sort_order, is_published)
    VALUES (
      v_title,
      v_url,
      COALESCE((p_video->>'score_points')::integer, 0),
      COALESCE((p_video->>'sort_order')::integer, 0),
      COALESCE((p_video->>'is_published')::boolean, false)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_self_learn_video(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);
  DELETE FROM public.self_learn_videos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

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

CREATE OR REPLACE FUNCTION public.credit_self_learn_video(
  p_profile_id text,
  p_phone text,
  p_video_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_points integer;
  v_title text;
  v_credited boolean;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  BEGIN
    p := public._verify_profile_phone(p_profile_id, p_phone);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END;

  SELECT score_points, title INTO v_points, v_title
  FROM public.self_learn_videos
  WHERE id = p_video_id AND is_published = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบวิดีโอ');
  END IF;

  IF COALESCE(v_points, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'credited', false, 'points', 0);
  END IF;

  v_credited := public._credit_score(p.profile_id, v_points, 'self_learn', p_video_id::text, v_title);
  RETURN jsonb_build_object('ok', true, 'credited', v_credited, 'points', v_points);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_self_learn_videos(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_self_learn_video(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_self_learn_video(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_self_learn_videos(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_self_learn_video(text, text, uuid) TO anon, authenticated, service_role;
