-- Fix student exam mapping: restore section columns on public_project_questions
-- and FORCE 1:1 video ↔ exam_section by order (overwrite existing).
-- Run in Supabase SQL Editor.

-- 1) Public view MUST expose section_id (students use this; admin RPC has sections already)
CREATE OR REPLACE VIEW public.public_project_questions
WITH (security_invoker = false)
AS
SELECT
  q.id,
  q.project_id,
  q.prompt,
  q.type,
  q.options,
  q.image_url,
  q.points,
  q.order_index,
  COALESCE(q.answer_required, true) AS answer_required,
  q.section_id,
  s.title AS section_title,
  s.description AS section_description,
  s.section_order
FROM public.project_questions q
LEFT JOIN public.exam_sections s ON s.id = q.section_id;

GRANT SELECT ON public.public_project_questions TO anon, authenticated;

-- 2) Ensure exam_section_id column exists on videos
ALTER TABLE public.project_videos
  ADD COLUMN IF NOT EXISTS exam_section_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_videos_exam_section_id_fkey'
  ) AND to_regclass('public.exam_sections') IS NOT NULL THEN
    ALTER TABLE public.project_videos
      ADD CONSTRAINT project_videos_exam_section_id_fkey
      FOREIGN KEY (exam_section_id) REFERENCES public.exam_sections(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) FORCE map every video → section by order (5:5 etc.), overwrite prior values
UPDATE public.project_videos v
SET exam_section_id = map.section_id
FROM (
  SELECT
    vid.id AS video_id,
    sec.id AS section_id
  FROM (
    SELECT
      id,
      project_id,
      ROW_NUMBER() OVER (
        PARTITION BY project_id
        ORDER BY COALESCE(order_index, 0), title, id
      ) AS rn
    FROM public.project_videos
  ) vid
  JOIN (
    SELECT
      id,
      project_id,
      ROW_NUMBER() OVER (
        PARTITION BY project_id
        ORDER BY COALESCE(section_order, 0), title, id
      ) AS rn
    FROM public.exam_sections
  ) sec
    ON sec.project_id = vid.project_id
   AND sec.rn = vid.rn
) AS map
WHERE v.id = map.video_id;

-- 4) If questions have NULL section_id, assign them into sections by order
--    (equal chunks per project so each of 5 sections gets questions).
WITH ranked_q AS (
  SELECT
    id,
    project_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY COALESCE(order_index, 0), id
    ) AS rn,
    COUNT(*) OVER (PARTITION BY project_id) AS q_total
  FROM public.project_questions
  WHERE section_id IS NULL
),
ranked_s AS (
  SELECT
    id AS section_id,
    project_id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id
      ORDER BY COALESCE(section_order, 0), title, id
    ) AS rn,
    COUNT(*) OVER (PARTITION BY project_id) AS s_total
  FROM public.exam_sections
),
assigned AS (
  SELECT
    rq.id AS question_id,
    rs.section_id
  FROM ranked_q rq
  JOIN ranked_s rs
    ON rs.project_id = rq.project_id
   AND rs.rn = LEAST(
     rs.s_total,
     GREATEST(1, CEIL(rq.rn::numeric * rs.s_total / NULLIF(rq.q_total, 0)::numeric)::int)
   )
)
UPDATE public.project_questions q
SET section_id = a.section_id
FROM assigned a
WHERE q.id = a.question_id;

-- 5) Ensure admin save persists exam_section_id (older harden SQL omitted it)
CREATE OR REPLACE FUNCTION public.admin_upsert_video(p_token text, p_video jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_video->>'id', ''));
  v_section text := NULLIF(trim(COALESCE(p_video->>'exam_section_id', '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_video_id');
  END IF;

  INSERT INTO public.project_videos (
    id, project_id, title, video_url, video_id, is_mandatory, order_index, exam_section_id
  ) VALUES (
    v_id,
    trim(p_video->>'project_id'),
    COALESCE(NULLIF(trim(p_video->>'title'), ''), v_id),
    NULLIF(p_video->>'video_url', ''),
    NULLIF(p_video->>'video_id', ''),
    COALESCE((p_video->>'is_mandatory')::boolean, false),
    COALESCE((p_video->>'order_index')::integer, 0),
    v_section
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    video_url = EXCLUDED.video_url,
    video_id = EXCLUDED.video_id,
    is_mandatory = EXCLUDED.is_mandatory,
    order_index = EXCLUDED.order_index,
    exam_section_id = EXCLUDED.exam_section_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_video(text, jsonb) TO anon, authenticated, service_role;

-- 6) Verify (optional):
-- SELECT v.order_index, v.title, v.exam_section_id, s.title AS section_title
-- FROM project_videos v
-- LEFT JOIN exam_sections s ON s.id = v.exam_section_id
-- ORDER BY v.project_id, v.order_index;
--
-- SELECT section_id, count(*) FROM project_questions GROUP BY 1;

NOTIFY pgrst, 'reload schema';
