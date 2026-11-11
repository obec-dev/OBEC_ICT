-- Public list of live meetings for the landing page (active + not expired).
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.list_public_live_meetings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_ts ASC), '[]'::jsonb)
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
$$;

GRANT EXECUTE ON FUNCTION public.list_public_live_meetings() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
