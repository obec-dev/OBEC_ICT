-- Admin user search: deleted-only mode + stronger profile_id match
-- NON-DESTRUCTIVE: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_token text,
  p_query text,
  p_limit integer,
  p_include_deleted boolean,
  p_only_deleted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  q text := trim(COALESCE(p_query, ''));
BEGIN
  a := public._admin_from_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(t)::jsonb)
    FROM (
      SELECT
        p.profile_id,
        p.school_id,
        s.school_name,
        s.province,
        s.district_id,
        d.district_name,
        p.first_name,
        p.last_name,
        p.phone,
        COALESCE(p.contact_email, p.email) AS email,
        COALESCE(p.contact_email, p.email) AS contact_email,
        COALESCE(p.login_email, lower(NULLIF(trim(p.email), ''))) AS login_email,
        COALESCE(p.portal_role, 'user') AS portal_role,
        COALESCE(p.is_school_admin, false) AS is_school_admin,
        COALESCE(p.is_active, true) AS is_active,
        p.deleted_at,
        p.assigned_district_id,
        p.position,
        p.title_th,
        p.title_other_th,
        p.created_at
      FROM public.profiles p
      LEFT JOIN public.schools s ON s.school_id = p.school_id
      LEFT JOIN public.districts d ON d.district_id = s.district_id
      WHERE COALESCE(p.portal_role, 'user') IN ('user', 'school_admin')
        AND (
          CASE
            WHEN COALESCE(p_only_deleted, false) THEN p.deleted_at IS NOT NULL
            WHEN COALESCE(p_include_deleted, false) THEN TRUE
            ELSE p.deleted_at IS NULL
          END
        )
        AND (
          q = ''
          OR p.profile_id = q
          OR p.profile_id ILIKE q || '%'
          OR p.profile_id ILIKE '%' || q || '%'
          OR p.school_id ILIKE '%' || q || '%'
          OR COALESCE(p.first_name, '') ILIKE '%' || q || '%'
          OR COALESCE(p.last_name, '') ILIKE '%' || q || '%'
          OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) ILIKE '%' || q || '%'
          OR COALESCE(p.login_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.contact_email, p.email, '') ILIKE '%' || q || '%'
          OR COALESCE(p.phone, '') ILIKE '%' || q || '%'
          OR COALESCE(s.school_name, '') ILIKE '%' || q || '%'
        )
      ORDER BY
        CASE WHEN q <> '' AND p.profile_id = q THEN 0
             WHEN q <> '' AND p.profile_id ILIKE q || '%' THEN 1
             ELSE 2 END,
        p.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
    ) t
  ), '[]'::jsonb);
END;
$$;

-- Keep 4-arg clients working (defaults only_deleted = false)
CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_token text,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_include_deleted boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.admin_search_users(p_token, p_query, p_limit, p_include_deleted, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, integer, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text, integer, boolean, boolean)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
