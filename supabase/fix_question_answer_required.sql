-- Add answer_required flag on exam questions + refresh public view
-- Run in Supabase SQL Editor

ALTER TABLE public.project_questions
  ADD COLUMN IF NOT EXISTS answer_required boolean NOT NULL DEFAULT true;

CREATE OR REPLACE VIEW public.public_project_questions
WITH (security_invoker = false)
AS
SELECT
  id,
  project_id,
  prompt,
  type,
  options,
  image_url,
  points,
  order_index,
  answer_required
FROM public.project_questions;

GRANT SELECT ON public.public_project_questions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_question(p_token text, p_question jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_question->>'id', ''));
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_question_id');
  END IF;

  INSERT INTO public.project_questions (
    id, project_id, prompt, type, options, correct_answer, model_answer,
    image_url, points, order_index, answer_required
  ) VALUES (
    v_id,
    trim(p_question->>'project_id'),
    COALESCE(p_question->>'prompt', ''),
    COALESCE(NULLIF(p_question->>'type', ''), 'mcq'),
    COALESCE(p_question->'options', '[]'::jsonb),
    NULLIF(p_question->>'correct_answer', ''),
    NULLIF(p_question->>'model_answer', ''),
    NULLIF(p_question->>'image_url', ''),
    COALESCE((p_question->>'points')::integer, 1),
    COALESCE((p_question->>'order_index')::integer, 0),
    COALESCE((p_question->>'answer_required')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    prompt = EXCLUDED.prompt,
    type = EXCLUDED.type,
    options = EXCLUDED.options,
    correct_answer = EXCLUDED.correct_answer,
    model_answer = EXCLUDED.model_answer,
    image_url = EXCLUDED.image_url,
    points = EXCLUDED.points,
    order_index = EXCLUDED.order_index,
    answer_required = EXCLUDED.answer_required;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_question(text, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
