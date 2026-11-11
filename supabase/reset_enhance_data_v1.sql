-- =============================================================================
-- reset_enhance_data_v1.sql
-- One-shot data wipe for enhancement topics only. Run manually in Supabase SQL.
--
-- DELETES (row data only — no DROP TABLE / schema changes):
--   1) notifications
--   2) news (+ news_images via CASCADE)
--   3) activity_submissions, activity_tasks, activity_projects
--   4) self_learn_videos (portal E-learning catalog)
--   5) score_adjustments, score_ledger (all score sources)
--
-- PRESERVES:
--   profiles, schools, districts, admins, admin_sessions
--   business_users, audit_users
--   projects, project_videos, exam_*, watch_progress, exam_progress
--   live_meetings, live_checkins
--   (live check-in rows remain; their score_ledger credits are cleared)
-- =============================================================================

BEGIN;

TRUNCATE TABLE public.notifications RESTART IDENTITY CASCADE;

TRUNCATE TABLE public.news RESTART IDENTITY CASCADE;

TRUNCATE TABLE public.score_adjustments RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.score_ledger RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  public.activity_submissions,
  public.activity_tasks,
  public.activity_projects
RESTART IDENTITY CASCADE;

TRUNCATE TABLE public.self_learn_videos RESTART IDENTITY CASCADE;

COMMIT;

-- Verification: expect zeros for wiped tables
SELECT 'notifications' AS table_name, count(*)::bigint AS rows FROM public.notifications
UNION ALL
SELECT 'news', count(*) FROM public.news
UNION ALL
SELECT 'news_images', count(*) FROM public.news_images
UNION ALL
SELECT 'activity_submissions', count(*) FROM public.activity_submissions
UNION ALL
SELECT 'activity_tasks', count(*) FROM public.activity_tasks
UNION ALL
SELECT 'activity_projects', count(*) FROM public.activity_projects
UNION ALL
SELECT 'self_learn_videos', count(*) FROM public.self_learn_videos
UNION ALL
SELECT 'score_adjustments', count(*) FROM public.score_adjustments
UNION ALL
SELECT 'score_ledger', count(*) FROM public.score_ledger
ORDER BY table_name;
