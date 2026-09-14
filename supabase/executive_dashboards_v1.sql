-- =============================================================================
-- executive_dashboards_v1.sql
-- Business: national progress, partner coverage, trends, top-10 active/idle schools.
-- Audit: the same stats limited to assigned districts, plus school-update trend.
-- Profile: executives edit display name / position; audit can change districts
-- without a password. Admin district assignment accepts text[] (PostgREST).
-- Run in the Supabase SQL Editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._district_ids_from_jsonb(p_value jsonb)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_json jsonb := COALESCE(p_value, '[]'::jsonb);
  v_ids text[] := ARRAY[]::text[];
  elem jsonb;
  tok text;
BEGIN
  IF jsonb_typeof(v_json) = 'string' THEN
    BEGIN
      v_json := (v_json #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      tok := trim(v_json #>> '{}');
      IF tok <> '' THEN
        RETURN ARRAY[tok];
      END IF;
      RETURN ARRAY[]::text[];
    END;
  END IF;

  IF jsonb_typeof(v_json) <> 'array' THEN
    RETURN ARRAY[]::text[];
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(v_json) AS t(value)
  LOOP
    tok := '';
    IF jsonb_typeof(elem) = 'string' THEN
      tok := trim(elem #>> '{}');
    ELSIF jsonb_typeof(elem) = 'object' THEN
      tok := trim(COALESCE(elem->>'district_id', elem->>'id', ''));
    ELSIF jsonb_typeof(elem) = 'number' THEN
      tok := trim(elem #>> '{}');
    END IF;
    IF tok <> '' AND NOT (tok = ANY(v_ids)) THEN
      v_ids := array_append(v_ids, tok);
    END IF;
  END LOOP;
  RETURN v_ids;
END;
$$;

-- Resolve picker values (id or name) to districts.district_id.
-- Also accepts ids that exist only on schools.district_id.
CREATE OR REPLACE FUNCTION public._resolve_district_ids(p_raw text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ids text[] := ARRAY[]::text[];
  tok text;
  resolved text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'ids', '[]'::jsonb);
  END IF;

  FOREACH tok IN ARRAY p_raw LOOP
    tok := trim(COALESCE(tok, ''));
    IF tok = '' THEN
      CONTINUE;
    END IF;

    SELECT d.district_id INTO resolved
    FROM public.districts d
    WHERE d.district_id = tok OR d.district_name = tok
    LIMIT 1;

    IF resolved IS NULL THEN
      SELECT s.district_id INTO resolved
      FROM public.schools s
      WHERE s.district_id = tok
      LIMIT 1;
    END IF;

    IF resolved IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'มีเขตที่ไม่รู้จักในระบบ: ' || tok);
    END IF;

    IF NOT (resolved = ANY(v_ids)) THEN
      v_ids := array_append(v_ids, resolved);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.executive_ops_dashboard(p_kind text, p_login_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(COALESCE(p_kind, '')));
  v_id text := lower(trim(COALESCE(p_login_id, '')));
  v_districts text[] := ARRAY[]::text[];
  v_found boolean := false;
  v_missions integer := 0;
  v_totals jsonb;
  v_trend jsonb;
  v_districts_json jsonb;
  v_active_schools jsonb := '[]'::jsonb;
  v_inactive_schools jsonb := '[]'::jsonb;
  v_partners jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  PERFORM set_config('TimeZone', 'Asia/Bangkok', true);

  IF v_kind NOT IN ('business', 'audit') OR v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง');
  END IF;

  IF v_kind = 'business' THEN
    SELECT true INTO v_found
    FROM public.business_users
    WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
    LIMIT 1;
  ELSE
    SELECT public._district_ids_from_jsonb(au.assigned_districts)
    INTO v_districts
    FROM public.audit_users au
    WHERE au.deleted_at IS NULL
      AND lower(trim(au.login_email)) = v_id
    LIMIT 1;

    SELECT true INTO v_found
    FROM public.audit_users
    WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
    LIMIT 1;
    IF v_districts IS NULL THEN
      v_districts := ARRAY[]::text[];
    END IF;
  END IF;

  IF NOT COALESCE(v_found, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;

  IF to_regclass('public.user_missions') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*)::int
      FROM public.user_missions um
      JOIN public.profiles p ON p.profile_id = um.profile_id AND p.deleted_at IS NULL
      JOIN public.schools s ON s.school_id = p.school_id
      WHERE um.status = 'completed'
        AND ($1 <> 'audit' OR s.district_id = ANY($2))
    $q$ INTO v_missions USING v_kind, v_districts;
  END IF;

  SELECT jsonb_build_object(
    'schools', count(DISTINCT s.school_id),
    'registered_schools', count(DISTINCT s.school_id) FILTER (WHERE COALESCE(s.is_registered, false)),
    'districts', count(DISTINCT s.district_id),
    'partners', count(DISTINCT NULLIF(trim(s.partner), '')),
    'users', count(p.profile_id) FILTER (
      WHERE p.profile_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
    ),
    'active_users', count(p.profile_id) FILTER (
      WHERE p.profile_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_active, true)
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
    ),
    'active_30d', count(DISTINCT p.profile_id) FILTER (
      WHERE p.profile_id IS NOT NULL
        AND p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (
          p.created_at >= now() - interval '30 days'
          OR EXISTS (
            SELECT 1 FROM public.watch_progress w
            WHERE w.profile_id = p.profile_id AND w.updated_at >= now() - interval '30 days'
          )
          OR EXISTS (
            SELECT 1 FROM public.exam_progress e
            WHERE e.profile_id = p.profile_id
              AND COALESCE(e.submitted_at, e.updated_at) >= now() - interval '30 days'
          )
        )
    ),
    'learn_started', count(DISTINCT p.profile_id) FILTER (
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND EXISTS (SELECT 1 FROM public.watch_progress w WHERE w.profile_id = p.profile_id)
    ),
    'learn_completed', count(DISTINCT p.profile_id) FILTER (
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND EXISTS (
          SELECT 1 FROM public.watch_progress w
          WHERE w.profile_id = p.profile_id AND COALESCE(w.completed, false)
        )
    ),
    'exam_submitted', count(DISTINCT p.profile_id) FILTER (
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND EXISTS (
          SELECT 1 FROM public.exam_progress e
          WHERE e.profile_id = p.profile_id AND e.status = 'submitted'
        )
    ),
    'exam_passed', count(DISTINCT p.profile_id) FILTER (
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND EXISTS (
          SELECT 1 FROM public.exam_progress e
          WHERE e.profile_id = p.profile_id AND COALESCE(e.passed, false)
        )
    ),
    'school_updates', count(DISTINCT s.school_id) FILTER (WHERE s.school_profile_updated_at IS NOT NULL),
    'school_updates_30d', count(DISTINCT s.school_id) FILTER (
      WHERE s.school_profile_updated_at >= now() - interval '30 days'
    ),
    'registrations_30d', count(p.profile_id) FILTER (
      WHERE p.deleted_at IS NULL
        AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND p.created_at >= now() - interval '30 days'
    ),
    'missions_completed', v_missions
  )
  INTO v_totals
  FROM public.schools s
  LEFT JOIN public.profiles p ON p.school_id = s.school_id
  WHERE v_kind <> 'audit' OR s.district_id = ANY(v_districts);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.week_start), '[]'::jsonb)
  INTO v_trend
  FROM (
    SELECT
      to_char(w.week_start, 'YYYY-MM-DD') AS week_start,
      (
        SELECT count(*)::int
        FROM public.profiles p
        JOIN public.schools s ON s.school_id = p.school_id
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
          AND date_trunc('week', p.created_at) = w.week_start
          AND (v_kind <> 'audit' OR s.district_id = ANY(v_districts))
      ) AS registrations,
      (
        SELECT count(*)::int
        FROM public.watch_progress wp
        JOIN public.profiles p ON p.profile_id = wp.profile_id AND p.deleted_at IS NULL
        JOIN public.schools s ON s.school_id = p.school_id
        WHERE COALESCE(wp.completed, false)
          AND date_trunc('week', wp.updated_at) = w.week_start
          AND (v_kind <> 'audit' OR s.district_id = ANY(v_districts))
      ) AS learn_completed,
      (
        SELECT count(*)::int
        FROM public.exam_progress e
        JOIN public.profiles p ON p.profile_id = e.profile_id AND p.deleted_at IS NULL
        JOIN public.schools s ON s.school_id = p.school_id
        WHERE e.status = 'submitted'
          AND date_trunc('week', COALESCE(e.submitted_at, e.updated_at)) = w.week_start
          AND (v_kind <> 'audit' OR s.district_id = ANY(v_districts))
      ) AS exam_submitted,
      (
        SELECT count(*)::int
        FROM public.schools s
        WHERE s.school_profile_updated_at IS NOT NULL
          AND date_trunc('week', s.school_profile_updated_at) = w.week_start
          AND (v_kind <> 'audit' OR s.district_id = ANY(v_districts))
      ) AS school_updates
    FROM generate_series(
      date_trunc('week', now()) - interval '7 weeks',
      date_trunc('week', now()),
      interval '1 week'
    ) AS w(week_start)
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.district_name), '[]'::jsonb)
  INTO v_districts_json
  FROM (
    SELECT
      COALESCE(s.district_id, '') AS district_id,
      COALESCE(max(dist.district_name), s.district_id, '-') AS district_name,
      COALESCE(max(s.province), '') AS province,
      count(DISTINCT s.school_id)::int AS schools,
      count(DISTINCT s.school_id) FILTER (WHERE COALESCE(s.is_registered, false))::int AS registered,
      count(p.profile_id) FILTER (
        WHERE p.deleted_at IS NULL AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      )::int AS users,
      count(p.profile_id) FILTER (
        WHERE p.deleted_at IS NULL
          AND COALESCE(p.is_active, true)
          AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
      )::int AS active_users,
      count(DISTINCT p.profile_id) FILTER (
        WHERE p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.watch_progress w
            WHERE w.profile_id = p.profile_id AND COALESCE(w.completed, false)
          )
      )::int AS learn_completed,
      count(DISTINCT p.profile_id) FILTER (
        WHERE p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.exam_progress e
            WHERE e.profile_id = p.profile_id AND e.status = 'submitted'
          )
      )::int AS exam_submitted,
      count(DISTINCT p.profile_id) FILTER (
        WHERE p.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.exam_progress e
            WHERE e.profile_id = p.profile_id AND COALESCE(e.passed, false)
          )
      )::int AS exam_passed,
      count(DISTINCT s.school_id) FILTER (WHERE s.school_profile_updated_at IS NOT NULL)::int AS school_updates,
      count(DISTINCT s.school_id) FILTER (
        WHERE s.school_profile_updated_at >= now() - interval '30 days'
      )::int AS school_updates_30d
    FROM public.schools s
    LEFT JOIN public.districts dist ON dist.district_id = s.district_id
    LEFT JOIN public.profiles p ON p.school_id = s.school_id
    WHERE v_kind <> 'audit' OR s.district_id = ANY(v_districts)
    GROUP BY s.district_id
  ) d;

  IF v_kind = 'business' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.activity DESC, s.school_name), '[]'::jsonb)
    INTO v_active_schools
    FROM (
      SELECT
        ranked.school_id,
        ranked.school_name,
        ranked.district_name,
        ranked.province,
        ranked.activity,
        ranked.users
      FROM (
        SELECT
          s.school_id,
          COALESCE(s.school_name, s.school_id) AS school_name,
          COALESCE(max(dist.district_name), s.district_id, '') AS district_name,
          COALESCE(max(s.province), '') AS province,
          (
            count(DISTINCT p.profile_id) FILTER (
              WHERE p.deleted_at IS NULL
                AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
                AND (
                  p.created_at >= now() - interval '30 days'
                  OR EXISTS (
                    SELECT 1 FROM public.watch_progress w
                    WHERE w.profile_id = p.profile_id
                      AND w.updated_at >= now() - interval '30 days'
                  )
                  OR EXISTS (
                    SELECT 1 FROM public.exam_progress e
                    WHERE e.profile_id = p.profile_id
                      AND COALESCE(e.submitted_at, e.updated_at) >= now() - interval '30 days'
                  )
                )
            )
            + CASE
                WHEN max(s.school_profile_updated_at) >= now() - interval '30 days' THEN 1
                ELSE 0
              END
          )::int AS activity,
          count(DISTINCT p.profile_id) FILTER (
            WHERE p.deleted_at IS NULL
              AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
          )::int AS users
        FROM public.schools s
        LEFT JOIN public.districts dist ON dist.district_id = s.district_id
        LEFT JOIN public.profiles p ON p.school_id = s.school_id
        GROUP BY s.school_id, s.school_name, s.district_id
      ) ranked
      WHERE ranked.activity > 0
      ORDER BY ranked.activity DESC, ranked.school_name
      LIMIT 10
    ) s;

    SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.users DESC, s.school_name), '[]'::jsonb)
    INTO v_inactive_schools
    FROM (
      SELECT
        ranked.school_id,
        ranked.school_name,
        ranked.district_name,
        ranked.province,
        ranked.activity,
        ranked.users
      FROM (
        SELECT
          s.school_id,
          COALESCE(s.school_name, s.school_id) AS school_name,
          COALESCE(max(dist.district_name), s.district_id, '') AS district_name,
          COALESCE(max(s.province), '') AS province,
          (
            count(DISTINCT p.profile_id) FILTER (
              WHERE p.deleted_at IS NULL
                AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
                AND (
                  p.created_at >= now() - interval '30 days'
                  OR EXISTS (
                    SELECT 1 FROM public.watch_progress w
                    WHERE w.profile_id = p.profile_id
                      AND w.updated_at >= now() - interval '30 days'
                  )
                  OR EXISTS (
                    SELECT 1 FROM public.exam_progress e
                    WHERE e.profile_id = p.profile_id
                      AND COALESCE(e.submitted_at, e.updated_at) >= now() - interval '30 days'
                  )
                )
            )
            + CASE
                WHEN max(s.school_profile_updated_at) >= now() - interval '30 days' THEN 1
                ELSE 0
              END
          )::int AS activity,
          count(DISTINCT p.profile_id) FILTER (
            WHERE p.deleted_at IS NULL
              AND COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
          )::int AS users
        FROM public.schools s
        LEFT JOIN public.districts dist ON dist.district_id = s.district_id
        LEFT JOIN public.profiles p ON p.school_id = s.school_id
        GROUP BY s.school_id, s.school_name, s.district_id
      ) ranked
      WHERE ranked.activity = 0
      ORDER BY ranked.users DESC, ranked.school_name
      LIMIT 10
    ) s;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'partner', g.partner,
          'schools', g.schools,
          'participating', g.participating,
          'not_participating', g.not_participating
        )
        ORDER BY g.unspecified, g.participating DESC, g.partner
      ),
      '[]'::jsonb
    )
    INTO v_partners
    FROM (
      SELECT
        COALESCE(NULLIF(trim(s.partner), ''), 'ไม่ระบุ Partner') AS partner,
        (NULLIF(trim(s.partner), '') IS NULL) AS unspecified,
        count(*)::int AS schools,
        count(*) FILTER (WHERE COALESCE(s.is_registered, false))::int AS participating,
        count(*) FILTER (WHERE NOT COALESCE(s.is_registered, false))::int AS not_participating
      FROM public.schools s
      GROUP BY 1, 2
    ) g;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'needs_domains', v_kind = 'audit' AND cardinality(v_districts) = 0,
    'districts_assigned', cardinality(v_districts),
    'totals', v_totals,
    'trend', v_trend,
    'districts', v_districts_json,
    'active_schools', v_active_schools,
    'inactive_schools', v_inactive_schools,
    'partners', v_partners
  );
END;
$$;

DROP FUNCTION IF EXISTS public.update_executive_profile(text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.update_executive_profile(text, text, text, text, text[]);

CREATE OR REPLACE FUNCTION public.update_executive_profile(
  p_kind text,
  p_login_id text,
  p_display_name text,
  p_position text,
  p_districts text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(trim(COALESCE(p_kind, '')));
  v_id text := lower(trim(COALESCE(p_login_id, '')));
  v_name text := NULLIF(trim(COALESCE(p_display_name, '')), '');
  v_position text := NULLIF(trim(COALESCE(p_position, '')), '');
  bu public.business_users;
  au public.audit_users;
  resolved jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_kind NOT IN ('business', 'audit') OR v_id = '' OR v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อที่แสดง');
  END IF;

  IF v_kind = 'business' THEN
    SELECT * INTO bu FROM public.business_users
    WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
    END IF;

    UPDATE public.business_users
    SET display_name = v_name, position = v_position, updated_at = now()
    WHERE id = bu.id
    RETURNING * INTO bu;

    RETURN jsonb_build_object(
      'ok', true,
      'kind', 'business',
      'user', jsonb_build_object(
        'id', bu.id,
        'login_email', bu.login_email,
        'display_name', bu.display_name,
        'position', bu.position,
        'must_set_password', COALESCE(bu.must_set_password, false)
      )
    );
  END IF;

  SELECT * INTO au FROM public.audit_users
  WHERE deleted_at IS NULL AND lower(trim(login_email)) = v_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;

  IF p_districts IS NOT NULL THEN
    resolved := public._resolve_district_ids(p_districts);
    IF NOT COALESCE((resolved->>'ok')::boolean, false) THEN
      RETURN resolved;
    END IF;

    UPDATE public.audit_users
    SET
      display_name = v_name,
      position = v_position,
      assigned_districts = COALESCE(resolved->'ids', '[]'::jsonb),
      updated_at = now()
    WHERE id = au.id
    RETURNING * INTO au;
  ELSE
    UPDATE public.audit_users
    SET display_name = v_name, position = v_position, updated_at = now()
    WHERE id = au.id
    RETURNING * INTO au;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'audit',
    'user', jsonb_build_object(
      'id', au.id,
      'login_email', au.login_email,
      'display_name', au.display_name,
      'position', au.position,
      'assigned_districts', public._district_ids_from_jsonb(au.assigned_districts),
      'must_set_password', COALESCE(au.must_set_password, false)
    )
  );
END;
$$;

-- text[] matches the JS string array PostgREST receives. The old jsonb
-- signature is dropped so the call is not ambiguous.
DROP FUNCTION IF EXISTS public.admin_set_audit_districts(text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_set_audit_districts(text, uuid, text[]);

CREATE OR REPLACE FUNCTION public.admin_set_audit_districts(
  p_token text,
  p_id uuid,
  p_assigned_districts text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  resolved jsonb;
  saved jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  a := public._admin_from_token(p_token);

  resolved := public._resolve_district_ids(COALESCE(p_assigned_districts, ARRAY[]::text[]));
  IF NOT COALESCE((resolved->>'ok')::boolean, false) THEN
    RETURN resolved;
  END IF;
  saved := COALESCE(resolved->'ids', '[]'::jsonb);

  UPDATE public.audit_users
  SET assigned_districts = saved, updated_at = now()
  WHERE id = p_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบบัญชี');
  END IF;

  RETURN jsonb_build_object('ok', true, 'assigned_districts', public._district_ids_from_jsonb(saved));
END;
$$;

GRANT EXECUTE ON FUNCTION public.executive_ops_dashboard(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_executive_profile(text, text, text, text, text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_audit_districts(text, uuid, text[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
