-- =============================================================================
-- news_v1.sql
-- Phase 2: news + gallery images, public list/detail, admin CRUD RPCs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  summary text NULL,
  body text NOT NULL DEFAULT '',
  hero_image_url text NULL,
  hashtags text[] NOT NULL DEFAULT '{}'::text[],
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_slug_unique UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS public.news_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id uuid NOT NULL REFERENCES public.news(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_published_idx
  ON public.news (is_published, sort_order, published_at DESC);
CREATE INDEX IF NOT EXISTS news_images_news_idx
  ON public.news_images (news_id, sort_order);

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_images ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._news_slugify(p_title text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(trim(COALESCE(p_title, '')));
BEGIN
  v := regexp_replace(v, '[^a-z0-9ก-๙\-]+', '-', 'g');
  v := regexp_replace(v, '-+', '-', 'g');
  v := trim(both '-' from v);
  IF v = '' THEN
    RETURN 'news';
  END IF;
  RETURN left(v, 80);
END;
$$;

CREATE OR REPLACE FUNCTION public._normalize_external_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := trim(COALESCE(p_url, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v ~* '^https?://' THEN RETURN v; END IF;
  v := regexp_replace(v, '^/+', '');
  IF v = '' THEN RETURN NULL; END IF;
  RETURN 'https://' || v;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_published_news(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));
BEGIN
  PERFORM set_config('row_security', 'off', true);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id,
      'slug', n.slug,
      'title', n.title,
      'summary', n.summary,
      'hero_image_url', n.hero_image_url,
      'hashtags', n.hashtags,
      'published_at', n.published_at,
      'sort_order', n.sort_order
    ) ORDER BY n.sort_order ASC, n.published_at DESC NULLS LAST, n.created_at DESC)
    FROM (
      SELECT * FROM public.news
      WHERE is_published = true
      ORDER BY sort_order ASC, published_at DESC NULLS LAST, created_at DESC
      LIMIT v_limit
    ) n
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_published_news(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.news;
  v_slug text := trim(COALESCE(p_slug, ''));
BEGIN
  PERFORM set_config('row_security', 'off', true);
  IF v_slug = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบข่าว');
  END IF;
  SELECT * INTO n FROM public.news WHERE slug = v_slug AND is_published = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบข่าว');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'news', jsonb_build_object(
      'id', n.id,
      'slug', n.slug,
      'title', n.title,
      'summary', n.summary,
      'body', n.body,
      'hero_image_url', n.hero_image_url,
      'hashtags', n.hashtags,
      'published_at', n.published_at,
      'sort_order', n.sort_order,
      'images', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'image_url', i.image_url,
          'caption', i.caption,
          'sort_order', i.sort_order
        ) ORDER BY i.sort_order, i.created_at)
        FROM public.news_images i WHERE i.news_id = n.id
      ), '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_news(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', n.id,
      'slug', n.slug,
      'title', n.title,
      'summary', n.summary,
      'hero_image_url', n.hero_image_url,
      'hashtags', n.hashtags,
      'is_published', n.is_published,
      'published_at', n.published_at,
      'sort_order', n.sort_order,
      'updated_at', n.updated_at,
      'image_count', (SELECT count(*)::int FROM public.news_images i WHERE i.news_id = n.id)
    ) ORDER BY n.sort_order ASC, n.updated_at DESC)
    FROM public.news n
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_news(p_token text, p_news jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id uuid;
  v_title text;
  v_slug text;
  v_tags text[];
  v_pub boolean;
  v_images jsonb;
  elem jsonb;
  i int := 0;
BEGIN
  a := public._admin_from_token(p_token);
  v_title := NULLIF(trim(COALESCE(p_news->>'title', '')), '');
  IF v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ต้องระบุหัวข้อข่าว');
  END IF;

  v_slug := NULLIF(trim(COALESCE(p_news->>'slug', '')), '');
  IF v_slug IS NULL THEN
    v_slug := public._news_slugify(v_title);
  ELSE
    v_slug := public._news_slugify(v_slug);
  END IF;

  v_tags := ARRAY(
    SELECT DISTINCT trim(x)
    FROM unnest(COALESCE(
      CASE
        WHEN jsonb_typeof(p_news->'hashtags') = 'array' THEN
          ARRAY(SELECT jsonb_array_elements_text(p_news->'hashtags'))
        ELSE string_to_array(COALESCE(p_news->>'hashtags', ''), ',')
      END,
      ARRAY[]::text[]
    )) AS x
    WHERE trim(x) <> ''
  );

  v_pub := COALESCE((p_news->>'is_published')::boolean, false);

  IF NULLIF(trim(COALESCE(p_news->>'id', '')), '') IS NOT NULL THEN
    v_id := (p_news->>'id')::uuid;
    UPDATE public.news SET
      slug = v_slug,
      title = v_title,
      summary = NULLIF(trim(COALESCE(p_news->>'summary', '')), ''),
      body = COALESCE(p_news->>'body', ''),
      hero_image_url = public._normalize_external_url(p_news->>'hero_image_url'),
      hashtags = v_tags,
      is_published = v_pub,
      published_at = CASE
        WHEN v_pub AND published_at IS NULL THEN now()
        WHEN NOT v_pub THEN NULL
        ELSE published_at
      END,
      sort_order = COALESCE((p_news->>'sort_order')::integer, sort_order),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบข่าว');
    END IF;
  ELSE
    -- Ensure unique slug
    WHILE EXISTS (SELECT 1 FROM public.news WHERE slug = v_slug) LOOP
      v_slug := left(v_slug, 70) || '-' || substr(md5(random()::text), 1, 6);
    END LOOP;
    INSERT INTO public.news (
      slug, title, summary, body, hero_image_url, hashtags,
      is_published, published_at, sort_order, created_by
    ) VALUES (
      v_slug,
      v_title,
      NULLIF(trim(COALESCE(p_news->>'summary', '')), ''),
      COALESCE(p_news->>'body', ''),
      public._normalize_external_url(p_news->>'hero_image_url'),
      v_tags,
      v_pub,
      CASE WHEN v_pub THEN now() ELSE NULL END,
      COALESCE((p_news->>'sort_order')::integer, 0),
      a.admin_id
    )
    RETURNING id INTO v_id;
  END IF;

  -- Optional gallery replace when images array provided
  IF p_news ? 'images' AND jsonb_typeof(p_news->'images') = 'array' THEN
    DELETE FROM public.news_images WHERE news_id = v_id;
    FOR elem IN SELECT * FROM jsonb_array_elements(p_news->'images')
    LOOP
      IF public._normalize_external_url(elem->>'image_url') IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.news_images (news_id, image_url, caption, sort_order)
      VALUES (
        v_id,
        public._normalize_external_url(elem->>'image_url'),
        NULLIF(trim(COALESCE(elem->>'caption', '')), ''),
        COALESCE((elem->>'sort_order')::integer, i)
      );
      i := i + 1;
    END LOOP;
  END IF;

  PERFORM public._write_audit(a.admin_id, 'upsert_news', 'news', v_id::text, null, p_news);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'slug', v_slug);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'slug ซ้ำ กรุณาเปลี่ยน slug');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_news(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  n public.news;
BEGIN
  a := public._admin_from_token(p_token);
  SELECT * INTO n FROM public.news WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบข่าว');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'news', jsonb_build_object(
      'id', n.id,
      'slug', n.slug,
      'title', n.title,
      'summary', n.summary,
      'body', n.body,
      'hero_image_url', n.hero_image_url,
      'hashtags', n.hashtags,
      'is_published', n.is_published,
      'published_at', n.published_at,
      'sort_order', n.sort_order,
      'images', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'image_url', i.image_url,
          'caption', i.caption,
          'sort_order', i.sort_order
        ) ORDER BY i.sort_order, i.created_at)
        FROM public.news_images i WHERE i.news_id = n.id
      ), '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_news(p_token text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_count integer := 0;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.news WHERE id = p_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบข่าว');
  END IF;
  PERFORM public._write_audit(a.admin_id, 'delete_news', 'news', p_id::text, null, null);
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_published_news(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_published_news(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_news(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_news(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_news(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_news(text, uuid) TO anon, authenticated, service_role;
