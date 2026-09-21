-- =============================================================================
-- Wipe USER / CANDIDATE data — keep admins + learning content (videos / exams)
-- =============================================================================
-- Run in Supabase SQL Editor on the TARGET database only.
--
-- CLEARS
--   • exam_progress          (all answers / scores / lesson_submissions)
--   • watch_progress         (user video watch state — NOT the video catalog)
--   • user_missions          (per-user mission submissions)
--   • profiles               (all candidates / school_admin portal users)
--   • schools flags          (is_registered + school-profile fields filled by users)
--
-- OPTIONAL (default ON below)
--   • business_users / audit_users   (executive accounts — not admins)
--
-- KEEPS (untouched)
--   • admins, admin_sessions
--   • projects, project_videos (or videos), project_questions (or questions), answer keys
--   • missions               (mission definitions / catalog)
--   • districts, schools     (master school list rows)
--   • site_settings
--   • audit_logs             (history kept; uncomment section 6 to purge user-related rows)
--
-- SAFETY
--   1) Read the preflight counts.
--   2) Set v_confirm := 'WIPE_ALL_USER_DATA' (exact string) to execute deletes.
--   3) Leave v_confirm empty to run DRY-RUN (counts only).
-- =============================================================================

DO $$
DECLARE
  -- >>> CHANGE THIS to execute. Leave '' for dry-run. <<<
  v_confirm text := '';

  -- Set false to KEEP business_users + audit_users accounts
  v_wipe_executives boolean := true;

  n_exam bigint;
  n_watch bigint;
  n_um bigint;
  n_profiles bigint;
  n_biz bigint := 0;
  n_aud bigint := 0;
  n_admins bigint;
  n_projects bigint := 0;
  n_videos bigint := 0;
  n_questions bigint := 0;
BEGIN
  SELECT count(*) INTO n_exam FROM public.exam_progress;
  SELECT count(*) INTO n_watch FROM public.watch_progress;
  SELECT count(*) INTO n_profiles FROM public.profiles;
  SELECT count(*) INTO n_admins FROM public.admins;

  IF to_regclass('public.user_missions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.user_missions' INTO n_um;
  ELSE
    n_um := 0;
  END IF;

  IF to_regclass('public.business_users') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.business_users' INTO n_biz;
  END IF;
  IF to_regclass('public.audit_users') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.audit_users' INTO n_aud;
  END IF;

  IF to_regclass('public.projects') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.projects' INTO n_projects;
  END IF;
  -- video / question table names vary by migration history
  IF to_regclass('public.project_videos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.project_videos' INTO n_videos;
  ELSIF to_regclass('public.videos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.videos' INTO n_videos;
  END IF;
  IF to_regclass('public.project_questions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.project_questions' INTO n_questions;
  ELSIF to_regclass('public.questions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.questions' INTO n_questions;
  END IF;

  RAISE NOTICE '========== PREFLIGHT ==========';
  RAISE NOTICE 'WILL DELETE — exam_progress: %', n_exam;
  RAISE NOTICE 'WILL DELETE — watch_progress: %', n_watch;
  RAISE NOTICE 'WILL DELETE — user_missions: %', n_um;
  RAISE NOTICE 'WILL DELETE — profiles: %', n_profiles;
  IF v_wipe_executives THEN
    RAISE NOTICE 'WILL DELETE — business_users: %', n_biz;
    RAISE NOTICE 'WILL DELETE — audit_users: %', n_aud;
  ELSE
    RAISE NOTICE 'KEEP — business_users: % / audit_users: %', n_biz, n_aud;
  END IF;
  RAISE NOTICE 'KEEP — admins: %', n_admins;
  RAISE NOTICE 'KEEP — projects: % / videos: % / questions: %', n_projects, n_videos, n_questions;
  RAISE NOTICE '================================';

  IF v_confirm IS DISTINCT FROM 'WIPE_ALL_USER_DATA' THEN
    RAISE NOTICE 'DRY-RUN only. Set v_confirm := ''WIPE_ALL_USER_DATA'' to execute.';
    RETURN;
  END IF;

  -- --------------------------------------------------------------------------
  -- 1) Progress / submissions (children first)
  -- --------------------------------------------------------------------------
  DELETE FROM public.exam_progress;
  DELETE FROM public.watch_progress;

  IF to_regclass('public.user_missions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.user_missions';
  END IF;

  -- --------------------------------------------------------------------------
  -- 2) Candidate profiles (admins live in public.admins — not touched)
  -- --------------------------------------------------------------------------
  DELETE FROM public.profiles;

  -- --------------------------------------------------------------------------
  -- 3) Optional executive portal users
  -- --------------------------------------------------------------------------
  IF v_wipe_executives THEN
    IF to_regclass('public.business_users') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.business_users';
    END IF;
    IF to_regclass('public.audit_users') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.audit_users';
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 4) Reset school participation / school-profile fields (keep school rows)
  -- --------------------------------------------------------------------------
  UPDATE public.schools
  SET is_registered = false,
      updated_at = now()
  WHERE COALESCE(is_registered, false) IS TRUE;

  -- Nullable school-profile columns (added in later migrations; skip if missing)
  BEGIN
    EXECUTE $u$
      UPDATE public.schools SET
        school_director_name = NULL,
        school_director_position = NULL,
        updated_by_national_id = NULL,
        updated_by_name = NULL,
        school_profile_updated_at = NULL,
        updated_at = now()
    $u$;
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'Some school profile columns missing — skipped extended school field reset.';
  END;

  -- Legacy table from older schema (safe no-op if missing)
  IF to_regclass('public.school_profiles') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.school_profiles';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5) Optional: purge audit rows that point at wiped user objects
  --    (admins + admin_sessions stay; leave commented unless you want this)
  -- --------------------------------------------------------------------------
  -- DELETE FROM public.audit_logs
  -- WHERE target_table IN (
  --   'profiles', 'exam_progress', 'watch_progress', 'user_missions',
  --   'business_users', 'audit_users'
  -- )
  -- OR profile_id IS NOT NULL;

  RAISE NOTICE 'WIPE COMPLETE. Admins and learning content (projects/videos/questions) kept.';
END $$;

-- Quick verify (run after wipe)
-- SELECT
--   (SELECT count(*) FROM public.profiles) AS profiles,
--   (SELECT count(*) FROM public.exam_progress) AS exam_progress,
--   (SELECT count(*) FROM public.watch_progress) AS watch_progress,
--   (SELECT count(*) FROM public.admins) AS admins,
--   (SELECT count(*) FROM public.projects) AS projects;
