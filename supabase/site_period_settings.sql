-- Seed period settings for registration / exam windows
-- Safe to re-run: only inserts missing keys

INSERT INTO public.site_settings (key, value)
VALUES
  ('registration_start', 'null'::jsonb),
  ('registration_end', 'null'::jsonb),
  ('exam_start', 'null'::jsonb),
  ('exam_end', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;
