-- SAFE READ-ONLY: verify audit_logs is capturing admin actions
-- Does NOT mutate any data. Run in Supabase SQL Editor.

-- 1) Recent audit activity (who / what / when)
SELECT
  l.created_at AT TIME ZONE 'Asia/Bangkok' AS created_at_bkk,
  COALESCE(a.username, '(unknown)') AS admin_username,
  COALESCE(a.full_name, '') AS admin_name,
  l.action,
  l.target_table,
  l.target_id,
  left(COALESCE(l.new_data::text, ''), 180) AS new_data_preview
FROM public.audit_logs l
LEFT JOIN public.admins a ON a.admin_id = l.admin_id
ORDER BY l.created_at DESC
LIMIT 50;

-- 2) Action coverage counts (last 30 days)
SELECT
  l.action,
  count(*) AS events,
  count(DISTINCT l.admin_id) AS distinct_admins,
  min(l.created_at) AT TIME ZONE 'Asia/Bangkok' AS first_seen_bkk,
  max(l.created_at) AT TIME ZONE 'Asia/Bangkok' AS last_seen_bkk
FROM public.audit_logs l
WHERE l.created_at >= now() - interval '30 days'
GROUP BY l.action
ORDER BY events DESC, l.action;

-- 3) Expected sensitive actions — show which are present vs missing recently
WITH expected(action) AS (
  VALUES
    ('login'),
    ('logout'),
    ('upsert_project'),
    ('delete_project'),
    ('create_video'),
    ('update_exam_mapping'),
    ('delete_video'),
    ('create_exam_section'),
    ('update_exam_section'),
    ('delete_exam_section'),
    ('unlock_exam'),
    ('soft_delete_user'),
    ('restore_user'),
    ('export_participants_full'),
    ('export_registration_details'),
    ('export_exam_responses'),
    ('export_hierarchy'),
    ('update_settings'),
    ('set_portal_role'),
    ('change_password')
)
SELECT
  e.action,
  COALESCE(c.events, 0) AS events_30d,
  CASE WHEN COALESCE(c.events, 0) > 0 THEN 'seen' ELSE 'not_seen_recently' END AS status
FROM expected e
LEFT JOIN (
  SELECT action, count(*) AS events
  FROM public.audit_logs
  WHERE created_at >= now() - interval '30 days'
  GROUP BY action
) c ON c.action = e.action
ORDER BY e.action;

-- 4) Totals
SELECT
  count(*) AS total_audit_rows,
  count(DISTINCT admin_id) AS distinct_admins,
  min(created_at) AT TIME ZONE 'Asia/Bangkok' AS oldest_bkk,
  max(created_at) AT TIME ZONE 'Asia/Bangkok' AS newest_bkk
FROM public.audit_logs;
