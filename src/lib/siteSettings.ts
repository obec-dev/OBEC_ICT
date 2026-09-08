import { createClient } from "@/lib/supabase/client";
import type { LearningProject } from "@/types/ict";

export type SitePeriodSettings = {
  site_name: string;
  registration_open: boolean;
  login_announce_message: string;
  registration_start: string | null; // ISO
  registration_end: string | null;
  exam_start: string | null;
  exam_end: string | null;
};

export type PeriodStatus = {
  open: boolean;
  reason: "ok" | "disabled" | "not_started" | "ended";
  start: string | null;
  end: string | null;
  message: string;
};

function asString(value: unknown): string {
  if (typeof value === "string") return value.replace(/^"|"$/g, "");
  if (value == null) return "";
  return String(value);
}

function asBool(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return fallback;
}

function asIsoOrNull(value: unknown): string | null {
  const s = asString(value).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function parseSiteSettings(raw: Record<string, unknown>): SitePeriodSettings {
  return {
    site_name: asString(raw.site_name) || "ICT Representative",
    registration_open: asBool(raw.registration_open, true),
    login_announce_message:
      asString(raw.login_announce_message) ||
      "วันเปิดเข้าสู่ระบบเรียน/สอบ จะประกาศให้ทราบภายหลัง",
    registration_start: asIsoOrNull(raw.registration_start),
    registration_end: asIsoOrNull(raw.registration_end),
    exam_start: asIsoOrNull(raw.exam_start),
    exam_end: asIsoOrNull(raw.exam_end),
  };
}

export function formatDateTimeTh(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

/** Convert ISO → value for <input type="datetime-local"> (local browser time) */
export function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value → ISO UTC */
export function datetimeLocalToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function evaluatePeriod(
  enabled: boolean,
  start: string | null,
  end: string | null,
  labels: { disabled: string; notStarted: string; ended: string; ok: string },
  now = new Date()
): PeriodStatus {
  if (!enabled) {
    return { open: false, reason: "disabled", start, end, message: labels.disabled };
  }
  if (start) {
    const s = new Date(start);
    if (now < s) {
      return {
        open: false,
        reason: "not_started",
        start,
        end,
        message: `${labels.notStarted} (เปิด ${formatDateTimeTh(start)})`,
      };
    }
  }
  if (end) {
    const e = new Date(end);
    if (now > e) {
      return {
        open: false,
        reason: "ended",
        start,
        end,
        message: `${labels.ended} (ปิด ${formatDateTimeTh(end)})`,
      };
    }
  }
  return { open: true, reason: "ok", start, end, message: labels.ok };
}

export function getRegistrationStatus(settings: SitePeriodSettings, now = new Date()): PeriodStatus {
  return evaluatePeriod(
    settings.registration_open,
    settings.registration_start,
    settings.registration_end,
    {
      disabled: "ขณะนี้ปิดรับลงทะเบียน",
      notStarted: "ยังไม่ถึงกำหนดเปิดรับลงทะเบียน",
      ended: "หมดเขตรับลงทะเบียนแล้ว",
      ok: "เปิดรับลงทะเบียน",
    },
    now
  );
}

export function getExamStatus(settings: SitePeriodSettings, now = new Date()): PeriodStatus {
  // Exam uses its own window; not gated by registration_open
  return evaluatePeriod(
    true,
    settings.exam_start,
    settings.exam_end,
    {
      disabled: "ปิดช่วงสอบ",
      notStarted: "ยังไม่ถึงกำหนดเปิดสอบ",
      ended: "หมดเขตส่งข้อสอบแล้ว",
      ok: "เปิดช่วงสอบ",
    },
    now
  );
}

export function getProjectRegistrationStatus(project: LearningProject, now = new Date()): PeriodStatus {
  return evaluatePeriod(
    project.reg_enabled ?? true,
    project.reg_start ?? null,
    project.reg_end ?? null,
    {
      disabled: "โครงการนี้ปิดรับลงทะเบียน",
      notStarted: "ยังไม่ถึงกำหนดเปิดรับลงทะเบียนของโครงการนี้",
      ended: "หมดเขตรับลงทะเบียนของโครงการนี้แล้ว",
      ok: "เปิดรับลงทะเบียน",
    },
    now
  );
}

export function getProjectExamStatus(project: LearningProject, now = new Date()): PeriodStatus {
  return evaluatePeriod(
    project.exam_enabled ?? true,
    project.exam_start ?? null,
    project.exam_end ?? null,
    {
      disabled: "โครงการนี้ปิดช่วงสอบ",
      notStarted: "ยังไม่ถึงกำหนดเปิดสอบของโครงการนี้",
      ended: "หมดเขตส่งข้อสอบของโครงการนี้แล้ว",
      ok: "เปิดช่วงสอบ",
    },
    now
  );
}

export async function fetchPublicSiteSettings(): Promise<SitePeriodSettings> {
  const supabase = createClient();
  const { data, error } = await supabase.from("site_settings").select("key, value");
  if (error) throw new Error(error.message);

  const raw: Record<string, unknown> = {};
  for (const row of data ?? []) {
    raw[row.key] = row.value;
  }
  return parseSiteSettings(raw);
}

