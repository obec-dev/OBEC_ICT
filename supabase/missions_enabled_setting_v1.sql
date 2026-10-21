-- Feature flag: missions menu after exam pass (default OFF until launch)
-- Safe to re-run: only inserts missing key

INSERT INTO public.site_settings (key, value)
VALUES ('missions_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
