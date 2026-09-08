-- Expand public.profiles for bilingual registration (EN/TH titles + contact fields)
-- Run in Supabase SQL Editor after deploy.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS title_key text,
  ADD COLUMN IF NOT EXISTS title_en text,
  ADD COLUMN IF NOT EXISTS title_th text,
  ADD COLUMN IF NOT EXISTS title_other_en text,
  ADD COLUMN IF NOT EXISTS title_other_th text,
  ADD COLUMN IF NOT EXISTS eng_first_name text,
  ADD COLUMN IF NOT EXISTS eng_last_name text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS duty text,
  ADD COLUMN IF NOT EXISTS line_id text,
  ADD COLUMN IF NOT EXISTS email text;

-- Optional constraints (nullable for legacy rows)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_title_key_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_title_key_check
  CHECK (
    title_key IS NULL OR title_key IN (
      'mr', 'miss', 'mrs', 'ms', 'dr', 'asst_prof', 'assoc_prof', 'prof', 'other'
    )
  );

COMMENT ON COLUMN public.profiles.title_key IS 'Linked EN/TH title key (mr, miss, mrs, ms, dr, asst_prof, assoc_prof, prof, other)';
COMMENT ON COLUMN public.profiles.first_name IS 'Thai given name';
COMMENT ON COLUMN public.profiles.last_name IS 'Thai surname';
COMMENT ON COLUMN public.profiles.eng_first_name IS 'English given name (A-Z only)';
COMMENT ON COLUMN public.profiles.eng_last_name IS 'English surname (A-Z only)';
COMMENT ON COLUMN public.profiles.position IS 'ตำแหน่ง เช่น ครูชำนาญการ';
COMMENT ON COLUMN public.profiles.duty IS 'หน้าที่/การสอน เช่น สอนวิชา ... ระดับชั้น ...';
