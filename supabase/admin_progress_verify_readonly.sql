-- SAFE READ-ONLY verification for Admin Progress Tracking
-- Run in Supabase SQL Editor. Does NOT mutate any data.
-- Compare these numbers to /admin/overview after deploying the UI + RPC fix.

-- Replace with your site project id if needed (or leave NULL to count all).
-- Example: 'ict-talent-2026'
WITH params AS (
  SELECT NULLIF(trim(''), '')::text AS project_id  -- set e.g. 'ict-talent-2026'
),
active_profiles AS (
  SELECT p.profile_id
  FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
),
exam_scoped AS (
  SELECT e.*
  FROM public.exam_progress e
  CROSS JOIN params x
  WHERE e.profile_id IN (SELECT profile_id FROM active_profiles)
    AND (
      x.project_id IS NULL
      OR e.project_id = x.project_id
      OR e.project_id IS NULL
    )
)
SELECT
  (SELECT count(*) FROM active_profiles) AS active_candidates,
  (SELECT count(DISTINCT profile_id) FROM exam_scoped WHERE status::text = 'draft') AS exam_draft,
  (
    SELECT count(DISTINCT profile_id)
    FROM exam_scoped e
    WHERE e.status::text = 'draft'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS t(k, v)
        WHERE COALESCE(v->>'status', '') = 'submitted'
      )
  ) AS exam_partial_lessons,
  (SELECT count(DISTINCT profile_id) FROM exam_scoped WHERE status::text = 'submitted') AS exam_submitted,
  (
    SELECT count(DISTINCT profile_id)
    FROM exam_scoped
    WHERE status::text = 'submitted' AND passed IS TRUE
  ) AS exam_passed,
  (
    SELECT count(DISTINCT profile_id)
    FROM exam_scoped
    WHERE status::text = 'submitted' AND passed IS FALSE
  ) AS exam_failed,
  (SELECT count(DISTINCT profile_id) FROM exam_scoped) AS exam_any_progress,
  (
    SELECT count(*) FROM active_profiles ap
    WHERE NOT EXISTS (
      SELECT 1 FROM exam_scoped e WHERE e.profile_id = ap.profile_id
    )
  ) AS not_started;

-- Optional: sample recent activity (still read-only)
SELECT
  e.profile_id,
  e.project_id,
  e.status::text AS status,
  e.passed,
  e.updated_at,
  (
    SELECT count(*)::int
    FROM jsonb_each(COALESCE(e.lesson_submissions, '{}'::jsonb)) AS t(k, v)
    WHERE COALESCE(v->>'status', '') = 'submitted'
  ) AS lessons_submitted
FROM public.exam_progress e
JOIN public.profiles p ON p.profile_id = e.profile_id
WHERE p.deleted_at IS NULL
ORDER BY e.updated_at DESC NULLS LAST
LIMIT 25;
