import { ICT_SURVEY_SECTIONS, POSITION_OPTIONS, type IctSurvey } from "@/lib/registrationOptions";
import { ENG_NAME_RE, THAI_NAME_RE, getTitleByKey } from "@/lib/titles";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NATIONAL_ID_RE = /^\d{13}$/;
/** Characters allowed in a phone field: digits, spaces, hyphens, plus. */
const PHONE_ALLOWED_RE = /^[+\d][\d\s-]*$|^[\d\s-]+$/;
const PHONE_STRIP_RE = /[^\d+\-\s]/g;

export type RegisterPersonInput = {
  key: string;
  is_school_admin: boolean | null;
  profile_id: string;
  title_key: string;
  title_other_en: string;
  title_other_th: string;
  first_name: string;
  last_name: string;
  eng_first_name: string;
  eng_last_name: string;
  gender: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  phone: string;
  line_id: string;
  email: string;
  position: string;
  ict_talent_cohort: string;
  ict_survey: IctSurvey;
};

export const PERSON_FIELD_ORDER = [
  "is_school_admin",
  "profile_id",
  "title_key",
  "title_other_th",
  "title_other_en",
  "first_name",
  "last_name",
  "eng_first_name",
  "eng_last_name",
  "gender",
  "birth_day",
  "birth_month",
  "birth_year",
  "phone",
  "line_id",
  "email",
  "position",
  "ict_talent_cohort",
  ...ICT_SURVEY_SECTIONS.map((section) => `survey:${section.key}`),
  "survey:sms_usage",
] as const;

export type PersonField = (typeof PERSON_FIELD_ORDER)[number];

export function fieldId(personKey: string, field: string): string {
  return `${personKey}:${field}`;
}

export function filterPhoneInput(value: string): string {
  return value.replace(PHONE_STRIP_RE, "");
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCalendarDate(day: string, month: string, year: string): boolean {
  if (!day || !month || !year) return false;
  const iso = `${year}-${month}-${day}`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === Number(year) && d.getMonth() + 1 === Number(month) && d.getDate() === Number(day);
}

function required(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

/** Per-field messages. Empty string means valid. */
export function validatePersonField(
  person: RegisterPersonInput,
  field: string,
  people: RegisterPersonInput[] = [person]
): string | null {
  switch (field) {
    case "is_school_admin": {
      if (person.is_school_admin === null) {
        return "กรุณาเลือกว่าท่านเป็นผู้ได้รับมอบหมายให้จัดการข้อมูลสถานศึกษาหรือไม่";
      }
      const admins = people.filter((p) => p.is_school_admin === true);
      if (person.is_school_admin && admins.length > 1 && admins[0]?.key !== person.key) {
        return "ระบุผู้จัดการข้อมูลสถานศึกษาได้เพียง 1 คนต่อครั้งการลงทะเบียน";
      }
      return null;
    }
    case "profile_id": {
      const id = person.profile_id.trim();
      if (!id) return "กรุณากรอกเลขบัตรประชาชน";
      if (!NATIONAL_ID_RE.test(id)) return "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก";
      const dup = people.filter((p) => p.profile_id.trim() === id);
      if (dup.length > 1 && dup[0]?.key !== person.key) return `เลขบัตรประชาชน ${id} ซ้ำในฟอร์ม`;
      return null;
    }
    case "title_key":
      if (!person.title_key) return "กรุณาเลือกคำนำหน้าชื่อ";
      if (!getTitleByKey(person.title_key as Parameters<typeof getTitleByKey>[0])) {
        return "คำนำหน้าชื่อไม่ถูกต้อง";
      }
      return null;
    case "title_other_th":
      if (person.title_key !== "other") return null;
      return required(person.title_other_th, "กรุณากรอกคำนำหน้าชื่อภาษาไทย");
    case "title_other_en":
      if (person.title_key !== "other") return null;
      return required(person.title_other_en, "กรุณากรอกคำนำหน้าชื่อภาษาอังกฤษ");
    case "first_name":
      if (!person.first_name.trim()) return "กรุณากรอกชื่อภาษาไทย";
      if (!THAI_NAME_RE.test(person.first_name.trim())) return "ชื่อไทยต้องเป็นตัวอักษรภาษาไทยเท่านั้น";
      return null;
    case "last_name":
      if (!person.last_name.trim()) return "กรุณากรอกนามสกุลภาษาไทย";
      if (!THAI_NAME_RE.test(person.last_name.trim())) return "นามสกุลไทยต้องเป็นตัวอักษรภาษาไทยเท่านั้น";
      return null;
    case "eng_first_name":
      if (!person.eng_first_name.trim()) return "กรุณากรอกชื่อภาษาอังกฤษ";
      if (!ENG_NAME_RE.test(person.eng_first_name.trim())) return "ชื่อภาษาอังกฤษต้องเป็นตัวอักษรภาษาอังกฤษเท่านั้น";
      return null;
    case "eng_last_name":
      if (!person.eng_last_name.trim()) return "กรุณากรอกนามสกุลภาษาอังกฤษ";
      if (!ENG_NAME_RE.test(person.eng_last_name.trim())) return "นามสกุลภาษาอังกฤษต้องเป็นตัวอักษรภาษาอังกฤษเท่านั้น";
      return null;
    case "gender":
      return person.gender ? null : "กรุณาเลือกเพศ";
    case "birth_day":
      if (!person.birth_day) return "กรุณาเลือกวันเกิด";
      if (person.birth_month && person.birth_year && !isValidCalendarDate(person.birth_day, person.birth_month, person.birth_year)) {
        return "วันเกิดไม่ถูกต้อง กรุณาตรวจสอบวัน เดือน ปี";
      }
      return null;
    case "birth_month":
      if (!person.birth_month) return "กรุณาเลือกเดือนเกิด";
      if (
        person.birth_day &&
        person.birth_year &&
        !isValidCalendarDate(person.birth_day, person.birth_month, person.birth_year)
      ) {
        return "วันเกิดไม่ถูกต้อง กรุณาตรวจสอบวัน เดือน ปี";
      }
      return null;
    case "birth_year":
      if (!person.birth_year) return "กรุณาเลือกปีเกิด";
      if (
        person.birth_day &&
        person.birth_month &&
        !isValidCalendarDate(person.birth_day, person.birth_month, person.birth_year)
      ) {
        return "วันเกิดไม่ถูกต้อง กรุณาตรวจสอบวัน เดือน ปี";
      }
      return null;
    case "phone":
      return validatePhone(person.phone);
    case "line_id":
      return null;
    case "email": {
      const email = person.email.trim();
      if (!email) return "กรุณากรอกอีเมล";
      if (!EMAIL_RE.test(email)) return "รูปแบบอีเมลไม่ถูกต้อง";
      return null;
    }
    case "position":
      if (!person.position.trim()) return "กรุณาเลือกตำแหน่ง";
      if (!(POSITION_OPTIONS as readonly string[]).includes(person.position.trim())) return "ตำแหน่งไม่ถูกต้อง";
      return null;
    case "ict_talent_cohort":
      return person.ict_talent_cohort ? null : "กรุณาเลือกประวัติ ICT Talent";
    default: {
      if (field.startsWith("survey:")) {
        const key = field.slice("survey:".length) as keyof IctSurvey;
        const selected = person.ict_survey[key];
        if (!Array.isArray(selected) || selected.length === 0) {
          return "กรุณาเลือกอย่างน้อย 1 รายการ";
        }
      }
      return null;
    }
  }
}

export function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (!phone) return "กรุณากรอกเบอร์โทรศัพท์";
  if (!PHONE_ALLOWED_RE.test(phone)) {
    return "เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข เว้นวรรค ขีด (-) และเครื่องหมาย +";
  }
  const plusCount = (phone.match(/\+/g) || []).length;
  if (plusCount > 1 || (plusCount === 1 && !phone.startsWith("+"))) {
    return "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง";
  }
  const digits = phoneDigits(phone);
  if (digits.length < 9 || digits.length > 15) {
    return "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ต้องมีตัวเลข 9–15 หลัก)";
  }
  return null;
}

export function collectPersonErrors(
  people: RegisterPersonInput[]
): { errors: Record<string, string>; firstField: string | null } {
  const errors: Record<string, string> = {};
  let firstField: string | null = null;

  for (const person of people) {
    for (const field of PERSON_FIELD_ORDER) {
      if ((field === "title_other_th" || field === "title_other_en") && person.title_key !== "other") {
        continue;
      }
      const message = validatePersonField(person, field, people);
      if (!message) continue;
      const id = fieldId(person.key, field);
      errors[id] = message;
      if (!firstField) firstField = id;
    }
  }

  return { errors, firstField };
}

export function scrollToInvalidField(fieldIdValue: string) {
  if (typeof document === "undefined") return;
  const el = document.querySelector(`[data-field="${fieldIdValue.replace(/"/g, "")}"]`);
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.matches("input, select, textarea")
    ? el
    : el.querySelector("input, select, textarea");
  if (focusable instanceof HTMLElement) {
    window.setTimeout(() => focusable.focus({ preventScroll: true }), 250);
  }
}
