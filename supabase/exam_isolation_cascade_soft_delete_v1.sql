-- =============================================================================
-- Compliance: Exam isolation + Hard DELETE CASCADE + Soft-delete retention
-- + District dashboard / export exclusion of soft-deleted profiles
--
-- Run in Supabase SQL Editor. Idempotent.
--
-- Test cases covered:
--  1) Individual exam/watch save & submit isolated by verified profile_id
--     (+ per-lesson lesson_submissions, submitted lessons immutable)
--  2) Hard DELETE FROM profiles cascades to exam_progress / watch_progress /
--     user_missions (ON DELETE CASCADE)
--  3) Soft delete (deleted_at) retains exam/watch rows; restore keeps them
--  4) Dashboard / export RPCs exclude deleted_at IS NOT NULL profiles
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) Ensure lesson_submissions column exists
-- -----------------------------------------------------------------------------
ALTER TABLE public.exam_progress
  ADD COLUMN IF NOT EXISTS lesson_submissions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- 1) Hard-delete CASCADE: FK from activity tables → profiles(profile_id)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['exam_progress', 'watch_progress', 'user_missions']
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    -- Drop any existing FK on profile_id (regardless of delete action)
    FOR r IN
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = tbl
        AND c.contype = 'f'
        AND pg_get_constraintdef(c.oid) ILIKE '%profile_id%profiles%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', tbl, r.conname);
    END LOOP;

    -- Orphan cleanup before adding FK
    EXECUTE format(
      'DELETE FROM public.%I a
       WHERE a.profile_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.profiles p WHERE p.profile_id = a.profile_id
         )',
      tbl
    );

    EXECUTE format(
      'ALTER TABLE public.%I
         ADD CONSTRAINT %I
         FOREIGN KEY (profile_id) REFERENCES public.profiles(profile_id)
         ON DELETE CASCADE',
      tbl,
      tbl || '_profile_id_fkey'
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS exam_progress_profile_idx ON public.exam_progress (profile_id);
CREATE INDEX IF NOT EXISTS watch_progress_profile_idx ON public.watch_progress (profile_id);
CREATE INDEX IF NOT EXISTS user_missions_profile_idx ON public.user_missions (profile_id);

-- -----------------------------------------------------------------------------
-- 2) Soft-delete / restore: UPDATE only — never touch exam/watch rows
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  v_exam int := 0;
  v_watch int := 0;
BEGIN
  a := public._admin_from_token(p_token);

  UPDATE public.profiles
  SET deleted_at = now(), is_active = false, updated_at = now()
  WHERE profile_id = trim(p_profile_id) AND deleted_at IS NULL
  RETURNING * INTO p;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้ใช้งานหรือถูกลบแล้ว');
  END IF;

  -- Retention check (must remain after soft delete)
  SELECT count(*) INTO v_exam FROM public.exam_progress WHERE profile_id = p.profile_id;
  SELECT count(*) INTO v_watch FROM public.watch_progress WHERE profile_id = p.profile_id;

  IF to_regclass('public.sync_school_is_registered') IS NOT NULL THEN
    PERFORM public.sync_school_is_registered(p.school_id);
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    'soft_delete_user',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'deleted_at', p.deleted_at,
      'retained_exam_progress', v_exam,
      'retained_watch_progress', v_watch
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'retained_exam_progress', v_exam,
    'retained_watch_progress', v_watch
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_restore_user(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  clash text;
  v_exam int := 0;
  v_watch int := 0;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชีในถังกู้คืน');
  END IF;

  IF p.email IS NOT NULL AND NULLIF(trim(p.email), '') IS NOT NULL THEN
    SELECT profile_id INTO clash
    FROM public.profiles
    WHERE deleted_at IS NULL
      AND lower(trim(email)) = lower(trim(p.email))
      AND profile_id <> p.profile_id
    LIMIT 1;
    IF clash IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถกู้คืนได้ เนื่องจากอีเมลถูกใช้โดยบัญชีอื่นแล้ว');
    END IF;
  END IF;

  -- Progress must still be present BEFORE restore (soft delete retention)
  SELECT count(*) INTO v_exam FROM public.exam_progress WHERE profile_id = p.profile_id;
  SELECT count(*) INTO v_watch FROM public.watch_progress WHERE profile_id = p.profile_id;

  UPDATE public.profiles
  SET deleted_at = NULL, is_active = true, updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  IF to_regclass('public.sync_school_is_registered') IS NOT NULL THEN
    PERFORM public.sync_school_is_registered(p.school_id);
  END IF;

  INSERT INTO public.audit_logs (admin_id, action, target_table, target_id, new_data)
  VALUES (
    a.admin_id,
    'restore_user',
    'profiles',
    p.profile_id,
    jsonb_build_object(
      'restored', true,
      'exam_progress_intact', v_exam,
      'watch_progress_intact', v_watch
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'profile', public._profile_to_json(p),
    'exam_progress_intact', v_exam,
    'watch_progress_intact', v_watch
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_restore_user(text, text) TO anon, authenticated, service_role;

-- Hard delete relies on CASCADE (manual deletes kept as belt-and-suspenders)
CREATE OR REPLACE FUNCTION public.admin_delete_profile(p_token text, p_profile_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  p public.profiles;
  v_school text;
BEGIN
  a := public._admin_from_token(p_token);
  PERFORM set_config('row_security', 'off', true);

  SELECT * INTO p FROM public.profiles WHERE profile_id = trim(p_profile_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบผู้สมัคร');
  END IF;

  v_school := p.school_id;

  -- CASCADE removes exam_progress / watch_progress / user_missions
  DELETE FROM public.profiles WHERE profile_id = p.profile_id;

  IF to_regclass('public.sync_school_is_registered') IS NOT NULL THEN
    PERFORM public.sync_school_is_registered(v_school);
  ELSE
    UPDATE public.schools s
    SET is_registered = EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.school_id = v_school
        AND pr.deleted_at IS NULL
        AND COALESCE(pr.portal_role, 'user') IN ('user', 'school_admin')
    ),
    updated_at = now()
    WHERE s.school_id = v_school;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'delete_profile', 'profiles', p.profile_id, to_jsonb(p), null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_profile(text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) Individual isolation: upsert / get always bind to verified profile_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text,
  p_answers jsonb,
  p_status text,
  p_lesson_submissions jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_status text := lower(trim(COALESCE(p_status, 'draft')));
  v_project text := NULLIF(trim(COALESCE(p_project_id, '')), '');
  existing public.exam_progress;
  v_lessons jsonb;
  v_key text;
  v_val jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  -- Soft-deleted / wrong phone → invalid_credentials (cannot mutate another user)
  p := public._verify_profile_phone(p_profile_id, p_phone);

  IF v_status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'สถานะไม่ถูกต้อง');
  END IF;

  IF v_project IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
  END IF;

  SELECT * INTO existing
  FROM public.exam_progress
  WHERE profile_id = p.profile_id
    AND (project_id = v_project OR project_id IS NULL)
  ORDER BY CASE WHEN project_id = v_project THEN 0 ELSE 1 END
  LIMIT 1;

  IF existing.status::text = 'submitted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ส่งข้อสอบแล้ว ไม่สามารถแก้ไขได้');
  END IF;

  -- Start from existing per-lesson map (isolation + retention of other lessons)
  v_lessons := COALESCE(existing.lesson_submissions, '{}'::jsonb);

  IF p_lesson_submissions IS NOT NULL AND jsonb_typeof(p_lesson_submissions) = 'object' THEN
    FOR v_key, v_val IN
      SELECT key, value FROM jsonb_each(p_lesson_submissions)
    LOOP
      -- Submitted lessons are immutable (cannot un-submit via draft overwrite)
      IF COALESCE(v_lessons -> v_key ->> 'status', '') = 'submitted' THEN
        CONTINUE;
      END IF;
      IF COALESCE(v_val ->> 'status', '') = 'submitted' THEN
        v_lessons := jsonb_set(
          v_lessons,
          ARRAY[v_key],
          jsonb_build_object(
            'status', 'submitted',
            'submitted_at', COALESCE(v_val ->> 'submitted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
          ),
          true
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.exam_progress (
    profile_id, project_id, answers, status, lesson_submissions, submitted_at, updated_at
  ) VALUES (
    p.profile_id,
    v_project,
    COALESCE(p_answers, '{}'::jsonb),
    v_status::public.exam_status_enum,
    v_lessons,
    CASE WHEN v_status = 'submitted' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (profile_id, project_id) DO UPDATE SET
    answers = EXCLUDED.answers,
    status = EXCLUDED.status,
    lesson_submissions = EXCLUDED.lesson_submissions,
    submitted_at = CASE
      WHEN EXCLUDED.status::text = 'submitted' THEN COALESCE(public.exam_progress.submitted_at, now())
      ELSE public.exam_progress.submitted_at
    END,
    updated_at = now()
  WHERE public.exam_progress.profile_id = p.profile_id
    AND public.exam_progress.status::text IS DISTINCT FROM 'submitted';

  RETURN jsonb_build_object('ok', true, 'profile_id', p.profile_id, 'project_id', v_project);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'invalid_credentials' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  IF SQLERRM = 'account_suspended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text, jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text,
  p_answers jsonb,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.upsert_exam_progress(
    p_profile_id, p_phone, p_project_id, p_answers, p_status, NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_exam_progress(text, text, text, jsonb, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_watch_progress(
  p_profile_id text,
  p_phone text,
  p_video_id text,
  p_watched_seconds integer,
  p_duration_seconds integer,
  p_completed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  INSERT INTO public.watch_progress (
    profile_id, video_id, watched_seconds, duration_seconds, completed, updated_at
  ) VALUES (
    p.profile_id,
    trim(p_video_id),
    GREATEST(0, COALESCE(p_watched_seconds, 0)),
    GREATEST(0, COALESCE(p_duration_seconds, 0)),
    COALESCE(p_completed, false),
    now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    video_id = EXCLUDED.video_id,
    watched_seconds = EXCLUDED.watched_seconds,
    duration_seconds = EXCLUDED.duration_seconds,
    completed = EXCLUDED.completed OR public.watch_progress.completed,
    updated_at = now()
  WHERE public.watch_progress.profile_id = p.profile_id;

  RETURN jsonb_build_object('ok', true, 'profile_id', p.profile_id);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'invalid_credentials' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ');
  END IF;
  IF SQLERRM = 'account_suspended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_watch_progress(text, text, text, integer, integer, boolean)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_exam_progress(
  p_profile_id text,
  p_phone text,
  p_project_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  rows jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'profile_id', e.profile_id,
    'project_id', e.project_id,
    'answers', e.answers,
    'status', e.status,
    'lesson_submissions', COALESCE(e.lesson_submissions, '{}'::jsonb),
    'score', e.score,
    'passed', e.passed,
    'graded_at', e.graded_at,
    'submitted_at', e.submitted_at,
    'updated_at', e.updated_at
  ) ORDER BY e.updated_at DESC NULLS LAST), '[]'::jsonb)
  INTO rows
  FROM public.exam_progress e
  WHERE e.profile_id = p.profile_id
    AND (
      p_project_id IS NULL
      OR NULLIF(trim(p_project_id), '') IS NULL
      OR e.project_id = trim(p_project_id)
      OR e.project_id IS NULL
    );

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ', 'rows', '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_exam_progress(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_watch_progress(
  p_profile_id text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  rows jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  p := public._verify_profile_phone(p_profile_id, p_phone);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'profile_id', w.profile_id,
    'video_id', w.video_id,
    'watched_seconds', w.watched_seconds,
    'duration_seconds', w.duration_seconds,
    'completed', w.completed,
    'updated_at', w.updated_at
  )), '[]'::jsonb)
  INTO rows
  FROM public.watch_progress w
  WHERE w.profile_id = p.profile_id;

  RETURN jsonb_build_object('ok', true, 'rows', COALESCE(rows, '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'ยืนยันตัวตนไม่สำเร็จ', 'rows', '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_watch_progress(text, text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4) District dashboard / exports — exclude soft-deleted users
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_export_participants_full(p_token text)
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
        trim(COALESCE(p.title_th, '') || ' ' || COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS full_name,
        COALESCE(p.login_email, p.contact_email, p.email) AS email,
        p.phone,
        COALESCE(p.portal_role, 'user') AS role,
        p.school_id,
        s.school_name,
        s.province,
        COALESCE(d.district_id, s.district_id) AS district_id,
        COALESCE(d.district_name, s.district_id) AS district_name,
        COALESCE(NULLIF(trim(s.partner), ''), '') AS zone_partner,
        COALESCE(e.status::text, 'none') AS exam_status,
        CASE
          WHEN e.status::text = 'submitted' AND e.passed IS TRUE THEN 'สอบผ่าน'
          WHEN e.status::text = 'submitted' AND e.passed IS FALSE THEN 'สอบไม่ผ่าน'
          WHEN e.status::text = 'submitted' THEN 'ส่งข้อสอบแล้ว (รอตรวจ)'
          WHEN e.status::text = 'draft' AND COALESCE(e.lesson_submissions, '{}'::jsonb) <> '{}'::jsonb
            THEN 'ส่งบางบทแล้ว'
          WHEN e.status::text = 'draft' THEN 'ฉบับร่าง / กำลังทำข้อสอบ'
          WHEN COALESCE(w.watch_completed, false) THEN 'เรียนจบ (ยังไม่เริ่มสอบ)'
          WHEN COALESCE(w.watch_rows, 0) > 0 THEN 'กำลังเรียน'
          ELSE 'ยังไม่เริ่ม'
        END AS overall_progress,
        CASE WHEN COALESCE(w.watch_completed, false) THEN 'yes' ELSE 'no' END AS learn_completed,
        to_char(e.submitted_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_submitted_at,
        to_char(e.graded_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS exam_graded_at,
        to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS') AS registered_at
      FROM public.profiles p
      JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      LEFT JOIN LATERAL (
        SELECT ep.*
        FROM public.exam_progress ep
        WHERE ep.profile_id = p.profile_id
        ORDER BY
          CASE WHEN ep.status::text = 'submitted' THEN 0 ELSE 1 END,
          ep.updated_at DESC NULLS LAST
        LIMIT 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS watch_rows,
          bool_or(COALESCE(wp.completed, false)) AS watch_completed
        FROM public.watch_progress wp
        WHERE wp.profile_id = p.profile_id
      ) w ON true
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      ORDER BY s.province, d.district_name, s.school_name, p.last_name, p.first_name
    ) t
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_export_participants_full(text) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5) Verification report (safe SELECT — does not mutate)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  ok_cascade boolean;
BEGIN
  RAISE NOTICE '=== FK CASCADE check (exam_progress / watch_progress / user_missions) ===';
  FOR r IN
    SELECT
      t.relname AS table_name,
      c.conname,
      pg_get_constraintdef(c.oid) AS defn
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname IN ('exam_progress', 'watch_progress', 'user_missions')
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%profiles%'
  LOOP
    ok_cascade := r.defn ILIKE '%ON DELETE CASCADE%';
    RAISE NOTICE '% % → %',
      r.table_name,
      CASE WHEN ok_cascade THEN 'OK CASCADE' ELSE 'MISSING CASCADE' END,
      r.defn;
    IF NOT ok_cascade THEN
      RAISE EXCEPTION 'FK on %.% is not ON DELETE CASCADE: %', r.table_name, r.conname, r.defn;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
