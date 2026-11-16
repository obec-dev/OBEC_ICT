-- =============================================================================
-- auditor_document_districts_v1.sql
-- Many-to-many district tags for auditor_documents (select-all / exclude in UI).
-- Run in the Supabase SQL Editor after prior activity_* migrations.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auditor_document_districts (
  document_id uuid NOT NULL REFERENCES public.auditor_documents(id) ON DELETE CASCADE,
  district_id text NOT NULL,
  PRIMARY KEY (document_id, district_id)
);

CREATE INDEX IF NOT EXISTS auditor_document_districts_district_idx
  ON public.auditor_document_districts (district_id);

-- Backfill from legacy single district_id
INSERT INTO public.auditor_document_districts (document_id, district_id)
SELECT d.id, trim(d.district_id)
FROM public.auditor_documents d
WHERE NULLIF(trim(COALESCE(d.district_id, '')), '') IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.auditor_documents ALTER COLUMN district_id DROP NOT NULL;

ALTER TABLE public.auditor_document_districts ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- admin_list_auditor_documents — include district_ids array; filter via junction
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_auditor_documents(p_token text, p_district_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_district text := NULLIF(trim(COALESCE(p_district_id, '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'created_at') DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', d.id,
        'district_id', COALESCE(
          (
            SELECT dd.district_id
            FROM public.auditor_document_districts dd
            WHERE dd.document_id = d.id
            ORDER BY dd.district_id
            LIMIT 1
          ),
          d.district_id
        ),
        'district_ids', COALESCE((
          SELECT jsonb_agg(dd.district_id ORDER BY dd.district_id)
          FROM public.auditor_document_districts dd
          WHERE dd.document_id = d.id
        ), '[]'::jsonb),
        'title', d.title,
        'file_path', d.file_path,
        'file_url', COALESCE(d.file_url, d.file_path),
        'created_by', d.created_by,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      ) AS row_obj
      FROM public.auditor_documents d
      WHERE v_district IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.auditor_document_districts dd
          WHERE dd.document_id = d.id
            AND dd.district_id = v_district
        )
        OR (NOT EXISTS (
              SELECT 1 FROM public.auditor_document_districts dd WHERE dd.document_id = d.id
            )
            AND d.district_id = v_district)
    ) t
  ), '[]'::jsonb);
END;
$$;

-- -----------------------------------------------------------------------------
-- admin_upsert_auditor_document — accept district_ids jsonb array
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_auditor_document(p_token text, p_doc jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_title text;
  v_url text;
  v_ids text[] := ARRAY[]::text[];
  v_from_array text[];
  v_single text;
  v_first text;
  r record;
BEGIN
  a := public._admin_from_token(p_token);
  v_title := NULLIF(trim(COALESCE(p_doc->>'title', '')), '');
  v_url := public._normalize_external_url(COALESCE(p_doc->>'file_url', p_doc->>'file_path'));

  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุชื่อเอกสาร');
  END IF;

  v_from_array := public._district_ids_from_jsonb(COALESCE(p_doc->'district_ids', '[]'::jsonb));
  IF v_from_array IS NOT NULL AND array_length(v_from_array, 1) IS NOT NULL THEN
    v_ids := v_from_array;
  END IF;

  v_single := NULLIF(trim(COALESCE(p_doc->>'district_id', '')), '');
  IF v_single IS NOT NULL AND NOT (v_single = ANY (v_ids)) THEN
    v_ids := array_append(v_ids, v_single);
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุอย่างน้อย 1 เขต');
  END IF;

  v_first := v_ids[1];

  IF NULLIF(trim(COALESCE(p_doc->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_doc->>'id')::uuid;
    UPDATE public.auditor_documents SET
      district_id = v_first,
      title = v_title,
      file_path = NULLIF(p_doc->>'file_path', ''),
      file_url = COALESCE(v_url, NULLIF(p_doc->>'file_url', '')),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบเอกสาร');
    END IF;
  ELSE
    INSERT INTO public.auditor_documents (district_id, title, file_path, file_url, created_by)
    VALUES (
      v_first,
      v_title,
      NULLIF(p_doc->>'file_path', ''),
      v_url,
      a.admin_id
    )
    RETURNING id INTO v_id;
  END IF;

  DELETE FROM public.auditor_document_districts WHERE document_id = v_id;
  INSERT INTO public.auditor_document_districts (document_id, district_id)
  SELECT v_id, x.district_id
  FROM unnest(v_ids) AS x(district_id)
  ON CONFLICT DO NOTHING;

  -- Notify auditors whose assigned districts intersect any tagged id
  FOR r IN
    SELECT DISTINCT lower(trim(au.login_email)) AS login_email
    FROM public.audit_users au
    WHERE au.deleted_at IS NULL
      AND COALESCE(au.is_active, true) = true
      AND public._district_ids_from_jsonb(au.assigned_districts) && v_ids
  LOOP
    PERFORM public._notify(
      'audit',
      r.login_email,
      'เอกสารใหม่ในเขต',
      format('มีเอกสาร "%s" สำหรับเขตของคุณ', v_title),
      'auditor_document',
      '/portal/audit/documents',
      jsonb_build_object('document_id', v_id, 'district_ids', to_jsonb(v_ids))
    );
  END LOOP;

  PERFORM public._write_audit(a.admin_id, 'upsert_auditor_document', 'auditor_documents', v_id::text, null, p_doc);
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- auditor_list_documents — any assigned district intersects tags
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auditor_list_documents(p_login_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
  v_raw jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  SELECT au.assigned_districts INTO v_raw
  FROM public.audit_users au
  WHERE lower(trim(au.login_email)) = lower(trim(p_login_email))
    AND COALESCE(au.is_active, true) = true
    AND au.deleted_at IS NULL
  LIMIT 1;

  v_ids := public._district_ids_from_jsonb(COALESCE(v_raw, '[]'::jsonb));
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ยังไม่ได้กำหนดเขต');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'district_ids', to_jsonb(v_ids),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'file_url', COALESCE(d.file_url, d.file_path),
        'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM public.auditor_documents d
      WHERE EXISTS (
        SELECT 1
        FROM public.auditor_document_districts dd
        WHERE dd.document_id = d.id
          AND dd.district_id = ANY (v_ids)
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.auditor_document_districts dd WHERE dd.document_id = d.id
        )
        AND d.district_id = ANY (v_ids)
      )
    ), '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_auditor_documents(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_auditor_document(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auditor_list_documents(text) TO anon, authenticated, service_role;
