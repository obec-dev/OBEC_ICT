-- Keep custom position/title text in the display columns.
-- Run in the Supabase SQL Editor after identity_exam_sections_v1.sql.
--
-- profiles.position stores the typed title when the user chooses "อื่นๆ".
-- profiles.position_other mirrors that text so the form can reopen the text box.
-- title_th / title_en are copied from title_other_* when title_key = other.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_position_other_check;

CREATE OR REPLACE FUNCTION public.profiles_apply_custom_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_custom text := NULLIF(trim(COALESCE(NEW.position_other, '')), '');
  v_listed text[] := ARRAY[
    'ผู้อำนวยการสถานศึกษา',
    'รองผู้อำนวยการสถานศึกษา',
    'ครูผู้ช่วย',
    'ครู',
    'ครูชำนาญการ',
    'ครูชำนาญการพิเศษ',
    'ครูเชี่ยวชาญ',
    'ครูเชี่ยวชาญพิเศษ',
    'พนักงานราชการ',
    'ครูอัตราจ้าง'
  ];
BEGIN
  IF NEW.position = 'อื่นๆ' AND v_custom IS NOT NULL THEN
    NEW.position := v_custom;
    NEW.position_other := v_custom;
  ELSIF NEW.position = ANY (v_listed) THEN
    NEW.position_other := NULL;
  ELSIF NULLIF(trim(COALESCE(NEW.position, '')), '') IS NOT NULL THEN
    NEW.position := trim(NEW.position);
    NEW.position_other := NEW.position;
  ELSE
    NEW.position_other := NULL;
  END IF;

  IF NEW.title_key = 'other' THEN
    IF NULLIF(trim(COALESCE(NEW.title_other_th, '')), '') IS NOT NULL THEN
      NEW.title_th := trim(NEW.title_other_th);
    END IF;
    IF NULLIF(trim(COALESCE(NEW.title_other_en, '')), '') IS NOT NULL THEN
      NEW.title_en := trim(NEW.title_other_en);
    END IF;
  ELSIF NEW.title_key IS NOT NULL AND NEW.title_key <> 'other' THEN
    NEW.title_other_th := NULL;
    NEW.title_other_en := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_apply_custom_fields_biu ON public.profiles;
CREATE TRIGGER profiles_apply_custom_fields_biu
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_apply_custom_fields();

-- Existing rows that stored the sentinel in position and the text in position_other.
UPDATE public.profiles
SET position = trim(position_other)
WHERE position = 'อื่นๆ'
  AND NULLIF(trim(COALESCE(position_other, '')), '') IS NOT NULL;
