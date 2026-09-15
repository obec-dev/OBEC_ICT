-- Identity, forgot-password, and exam sections.
-- Run in the Supabase SQL Editor after position_other_v1.sql.
--
-- Safe if position_other_v1.sql has not been applied yet.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position_other text;

-- 1) New registrations get an immutable 13-digit profile_id (not a national ID).
-- 2) Forgot password verifies birth_date + phone, then returns login_email.
-- 3) Exam questions can belong to ordered sections/parts.

-- -----------------------------------------------------------------------------
-- 1) Auto 13-digit profile_id
-- Prefix 9 avoids colliding with existing Thai national IDs stored as profile_id.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.profile_id_seq AS bigint START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_profile_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_id text;
  v_try integer := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_id := '9' || lpad(nextval('public.profile_id_seq')::text, 12, '0');
    IF length(v_id) > 13 THEN
      v_id := lpad((floor(random() * 9000000000000) + 1000000000000)::bigint::text, 13, '0');
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE profile_id = v_id);
    IF v_try > 30 THEN
      RAISE EXCEPTION 'cannot generate unique profile id';
    END IF;
  END LOOP;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_profile_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_profile_id() TO postgres;

-- Drop the pre-position_other overload so PostgREST has one register_profile.
DROP FUNCTION IF EXISTS public.register_profile(
  text, text, text, text, text, text, boolean,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, jsonb
);

CREATE OR REPLACE FUNCTION public.register_profile(
  p_profile_id text DEFAULT NULL,
  p_school_id text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_remark text DEFAULT NULL,
  p_pdpa_accepted boolean DEFAULT true,
  p_title_key text DEFAULT NULL,
  p_title_en text DEFAULT NULL,
  p_title_th text DEFAULT NULL,
  p_title_other_en text DEFAULT NULL,
  p_title_other_th text DEFAULT NULL,
  p_eng_first_name text DEFAULT NULL,
  p_eng_last_name text DEFAULT NULL,
  p_birth_date text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_duty text DEFAULT NULL,
  p_line_id text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_is_school_admin boolean DEFAULT false,
  p_ict_talent_cohort text DEFAULT NULL,
  p_ict_survey jsonb DEFAULT '{}'::jsonb,
  p_position_other text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_id text := NULLIF(trim(COALESCE(p_profile_id, '')), '');
  v_school text := trim(COALESCE(p_school_id, ''));
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  existing public.profiles;
  v_birth date;
  v_want_admin boolean := COALESCE(p_is_school_admin, false);
  v_old_school text;
  v_email_taken boolean := false;
  v_position text := NULLIF(trim(COALESCE(p_position, '')), '');
  v_position_other text := NULLIF(trim(COALESCE(p_position_other, '')), '');
  v_generated boolean := false;
  v_has_existing boolean := false;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF v_school = '' OR NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_first_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_last_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลลงทะเบียนไม่ครบ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE school_id = v_school) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
  END IF;

  IF v_position IS DISTINCT FROM 'อื่นๆ' THEN
    v_position_other := NULL;
  ELSIF v_position_other IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณาระบุตำแหน่ง');
  ELSIF char_length(v_position_other) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ตำแหน่งยาวเกินไป');
  END IF;

  -- Empty profile_id: reuse a soft-deleted row with the same email (immutable id),
  -- otherwise mint a new 13-digit id. Callers must not send a national ID.
  IF v_id IS NULL AND v_email IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.profiles
    WHERE deleted_at IS NOT NULL
      AND lower(trim(COALESCE(login_email, email, ''))) = v_email
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_id := existing.profile_id;
      v_has_existing := true;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    v_id := public.generate_profile_id();
    v_generated := true;
    v_has_existing := false;
  ELSIF NOT v_has_existing THEN
    SELECT * INTO existing
    FROM public.profiles
    WHERE profile_id = v_id
    LIMIT 1;
    v_has_existing := FOUND;
  END IF;

  IF v_has_existing AND existing.deleted_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผู้สมัครนี้ลงทะเบียนแล้ว');
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.deleted_at IS NULL
      AND pr.profile_id <> v_id
      AND lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
  END IF;

  IF v_email IS NOT NULL AND to_regclass('public.business_users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.business_users
        WHERE deleted_at IS NULL AND lower(trim(login_email)) = $1
      )
    $q$ INTO v_email_taken USING v_email;
    IF v_email_taken THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
  END IF;

  IF v_email IS NOT NULL AND to_regclass('public.audit_users') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM public.audit_users
        WHERE deleted_at IS NULL AND lower(trim(login_email)) = $1
      )
    $q$ INTO v_email_taken USING v_email;
    IF v_email_taken THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
  END IF;

  IF v_want_admin AND EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.school_id = v_school
      AND pr.deleted_at IS NULL
      AND pr.is_school_admin = true
      AND pr.profile_id <> v_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'โรงเรียนนี้มีผู้จัดการข้อมูลสถานศึกษาอยู่แล้ว กรุณาติดต่อผู้ดูแลระบบหากต้องการเปลี่ยน'
    );
  END IF;

  BEGIN
    v_birth := NULLIF(trim(COALESCE(p_birth_date, '')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'วันเกิดไม่ถูกต้อง');
  END;

  IF v_has_existing AND existing.deleted_at IS NOT NULL THEN
    v_old_school := existing.school_id;

    IF to_regclass('public.exam_progress') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.exam_progress WHERE profile_id = $1' USING existing.profile_id;
    END IF;
    IF to_regclass('public.watch_progress') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.watch_progress WHERE profile_id = $1' USING existing.profile_id;
    END IF;
    IF to_regclass('public.user_missions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.user_missions WHERE profile_id = $1' USING existing.profile_id;
    END IF;

    UPDATE public.profiles
    SET
      school_id = v_school,
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      phone = trim(p_phone),
      remark = NULLIF(trim(COALESCE(p_remark, '')), ''),
      pdpa_accepted = COALESCE(p_pdpa_accepted, true),
      title_key = NULLIF(trim(COALESCE(p_title_key, '')), ''),
      title_en = NULLIF(trim(COALESCE(p_title_en, '')), ''),
      title_th = NULLIF(trim(COALESCE(p_title_th, '')), ''),
      title_other_en = NULLIF(trim(COALESCE(p_title_other_en, '')), ''),
      title_other_th = NULLIF(trim(COALESCE(p_title_other_th, '')), ''),
      eng_first_name = NULLIF(trim(COALESCE(p_eng_first_name, '')), ''),
      eng_last_name = NULLIF(trim(COALESCE(p_eng_last_name, '')), ''),
      birth_date = v_birth,
      gender = NULLIF(trim(COALESCE(p_gender, '')), ''),
      position = v_position,
      position_other = v_position_other,
      duty = NULLIF(trim(COALESCE(p_duty, '')), ''),
      line_id = NULLIF(trim(COALESCE(p_line_id, '')), ''),
      email = v_email,
      contact_email = v_email,
      login_email = v_email,
      is_school_admin = v_want_admin,
      portal_role = CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      ict_talent_cohort = NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      ict_survey = COALESCE(p_ict_survey, '{}'::jsonb),
      is_active = true,
      deleted_at = NULL,
      must_set_password = true,
      password_hash = NULL,
      updated_at = now()
    WHERE profile_id = existing.profile_id
    RETURNING * INTO p;

    IF v_old_school IS DISTINCT FROM v_school AND NOT EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.school_id = v_old_school
        AND pr.deleted_at IS NULL
    ) THEN
      UPDATE public.schools
      SET is_registered = false, updated_at = now()
      WHERE school_id = v_old_school;
    END IF;
  ELSE
    INSERT INTO public.profiles (
      profile_id, school_id, first_name, last_name, phone, remark, pdpa_accepted,
      title_key, title_en, title_th, title_other_en, title_other_th,
      eng_first_name, eng_last_name, birth_date, gender, position, position_other, duty, line_id, email,
      contact_email, login_email,
      is_school_admin, portal_role, ict_talent_cohort, ict_survey,
      is_active, deleted_at, must_set_password, password_hash
    ) VALUES (
      v_id, v_school,
      trim(p_first_name), trim(p_last_name), trim(p_phone),
      NULLIF(trim(COALESCE(p_remark, '')), ''),
      COALESCE(p_pdpa_accepted, true),
      NULLIF(trim(COALESCE(p_title_key, '')), ''),
      NULLIF(trim(COALESCE(p_title_en, '')), ''),
      NULLIF(trim(COALESCE(p_title_th, '')), ''),
      NULLIF(trim(COALESCE(p_title_other_en, '')), ''),
      NULLIF(trim(COALESCE(p_title_other_th, '')), ''),
      NULLIF(trim(COALESCE(p_eng_first_name, '')), ''),
      NULLIF(trim(COALESCE(p_eng_last_name, '')), ''),
      v_birth,
      NULLIF(trim(COALESCE(p_gender, '')), ''),
      v_position,
      v_position_other,
      NULLIF(trim(COALESCE(p_duty, '')), ''),
      NULLIF(trim(COALESCE(p_line_id, '')), ''),
      v_email,
      v_email,
      v_email,
      v_want_admin,
      CASE WHEN v_want_admin THEN 'school_admin' ELSE 'user' END,
      NULLIF(trim(COALESCE(p_ict_talent_cohort, '')), ''),
      COALESCE(p_ict_survey, '{}'::jsonb),
      true,
      NULL,
      true,
      NULL
    )
    RETURNING * INTO p;
  END IF;

  PERFORM public.mark_school_registered(v_school);

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM LIKE '%profiles_one_school_admin%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'โรงเรียนนี้มีผู้จัดการข้อมูลสถานศึกษาอยู่แล้ว');
    END IF;
    IF SQLERRM LIKE '%login_email%' OR SQLERRM LIKE '%email%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'อีเมลนี้ถูกใช้งานแล้ว กรุณาใช้อีเมลอื่น');
    END IF;
    IF SQLERRM LIKE '%profile_id%' OR SQLERRM LIKE '%profiles_pkey%' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถสร้างรหัสผู้สมัครได้ กรุณาลองอีกครั้ง');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่สามารถลงทะเบียนได้ เนื่องจากข้อมูลซ้ำในระบบ');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบรหัสโรงเรียนนี้ในระบบ');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_profile(
  text, text, text, text, text, text, boolean,
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, jsonb, text
) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) Forgot password: birth_date + phone (optional login_email)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_candidate_forgot_password(text, text);
DROP FUNCTION IF EXISTS public.verify_candidate_forgot_password(text, text, text);

CREATE FUNCTION public.verify_candidate_forgot_password(
  p_birth_date text,
  p_phone text,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.profiles;
  v_birth date;
  v_email text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  v_count integer := 0;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF NULLIF(trim(COALESCE(p_phone, '')), '') IS NULL OR NULLIF(trim(COALESCE(p_birth_date, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  BEGIN
    v_birth := trim(p_birth_date)::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END;

  SELECT count(*) INTO v_count
  FROM public.profiles pr
  WHERE pr.deleted_at IS NULL
    AND pr.birth_date = v_birth
    AND public._phones_match(pr.phone, p_phone)
    AND (
      v_email IS NULL
      OR lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
    );

  IF v_count <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  SELECT * INTO p
  FROM public.profiles pr
  WHERE pr.deleted_at IS NULL
    AND pr.birth_date = v_birth
    AND public._phones_match(pr.phone, p_phone)
    AND (
      v_email IS NULL
      OR lower(trim(COALESCE(pr.login_email, pr.email, ''))) = v_email
    )
  LIMIT 1;

  IF COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'บัญชีถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'profile_id', p.profile_id,
    'login_email', COALESCE(p.login_email, lower(trim(p.email))),
    'must_set_password', COALESCE(p.must_set_password, true) OR p.password_hash IS NULL,
    'has_password', p.password_hash IS NOT NULL
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_candidate_forgot_password(text, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text);
DROP FUNCTION IF EXISTS public.set_candidate_password(text, text, text, text);

CREATE FUNCTION public.set_candidate_password(
  p_email text,
  p_phone text,
  p_new_password text,
  p_birth_date text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  p public.profiles;
  v_email text := lower(trim(COALESCE(p_email, '')));
  v_birth date;
  v_first_time boolean;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF length(trim(COALESCE(p_new_password, ''))) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  END IF;

  SELECT * INTO p
  FROM public.profiles
  WHERE deleted_at IS NULL
    AND lower(trim(COALESCE(login_email, email, ''))) = v_email
  LIMIT 1;

  IF NOT FOUND OR COALESCE(p.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
  END IF;

  v_first_time := p.password_hash IS NULL OR COALESCE(p.must_set_password, true);

  IF NOT v_first_time THEN
    BEGIN
      v_birth := NULLIF(trim(COALESCE(p_birth_date, '')), '')::date;
    EXCEPTION WHEN OTHERS THEN
      v_birth := NULL;
    END;

    IF NOT public._phones_match(p.phone, p_phone)
      OR v_birth IS NULL
      OR p.birth_date IS DISTINCT FROM v_birth THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ');
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    must_set_password = false,
    login_email = COALESCE(NULLIF(trim(login_email), ''), v_email),
    updated_at = now()
  WHERE profile_id = p.profile_id
  RETURNING * INTO p;

  RETURN jsonb_build_object('ok', true, 'profile', public._profile_to_json(p));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_candidate_password(text, text, text, text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) Exam sections / parts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exam_sections (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  section_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS exam_sections_project_order_idx
  ON public.exam_sections (project_id, section_order, id);

ALTER TABLE public.project_questions
  ADD COLUMN IF NOT EXISTS section_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_questions_section_id_fkey'
  ) THEN
    ALTER TABLE public.project_questions
      ADD CONSTRAINT project_questions_section_id_fkey
      FOREIGN KEY (section_id) REFERENCES public.exam_sections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_questions_section_idx
  ON public.project_questions (section_id, order_index);

ALTER TABLE public.exam_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct exam_sections" ON public.exam_sections;
CREATE POLICY "no direct exam_sections" ON public.exam_sections FOR SELECT USING (false);

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
  q.answer_required,
  q.section_id,
  s.title AS section_title,
  s.description AS section_description,
  s.section_order
FROM public.project_questions q
LEFT JOIN public.exam_sections s ON s.id = q.section_id;

GRANT SELECT ON public.public_project_questions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_questions(p_token text, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  rows jsonb;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT COALESCE(jsonb_agg(item ORDER BY section_order, order_index, id), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      to_jsonb(q) || jsonb_build_object(
        'section_title', s.title,
        'section_description', s.description,
        'section_order', s.section_order
      ) AS item,
      COALESCE(s.section_order, 9999) AS section_order,
      q.order_index,
      q.id
    FROM public.project_questions q
    LEFT JOIN public.exam_sections s ON s.id = q.section_id
    WHERE p_project_id IS NULL
       OR NULLIF(trim(p_project_id), '') IS NULL
       OR q.project_id = trim(p_project_id)
  ) listed;

  RETURN COALESCE(rows, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_question(p_token text, p_question jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_question->>'id', ''));
  v_section text := NULLIF(trim(COALESCE(p_question->>'section_id', '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_question_id');
  END IF;

  IF v_section IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_sections WHERE id = v_section
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบส่วนข้อสอบที่เลือก');
  END IF;

  INSERT INTO public.project_questions (
    id, project_id, prompt, type, options, correct_answer, model_answer,
    image_url, points, order_index, answer_required, section_id
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
    COALESCE((p_question->>'answer_required')::boolean, true),
    v_section
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
    answer_required = EXCLUDED.answer_required,
    section_id = EXCLUDED.section_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_sections(p_token text, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  rows jsonb;
BEGIN
  a := public._admin_from_token(p_token);

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.section_order, s.id), '[]'::jsonb)
  INTO rows
  FROM public.exam_sections s
  WHERE p_project_id IS NULL
     OR NULLIF(trim(p_project_id), '') IS NULL
     OR s.project_id = trim(p_project_id);

  RETURN COALESCE(rows, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_section(p_token text, p_section jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
  v_id text := trim(COALESCE(p_section->>'id', ''));
  v_project text := trim(COALESCE(p_section->>'project_id', ''));
  v_title text := NULLIF(trim(COALESCE(p_section->>'title', '')), '');
BEGIN
  a := public._admin_from_token(p_token);
  IF v_id = '' OR v_project = '' OR v_title IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อส่วนข้อสอบ');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ไม่พบโครงการ');
  END IF;

  INSERT INTO public.exam_sections (id, project_id, title, description, section_order, updated_at)
  VALUES (
    v_id,
    v_project,
    v_title,
    NULLIF(trim(COALESCE(p_section->>'description', '')), ''),
    COALESCE((p_section->>'section_order')::integer, 0),
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    section_order = EXCLUDED.section_order,
    updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_section(p_token text, p_section_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.admins;
BEGIN
  a := public._admin_from_token(p_token);
  DELETE FROM public.exam_sections WHERE id = trim(p_section_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_sections(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_section(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_section(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
