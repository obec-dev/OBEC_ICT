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
  hero_badge: string;
  hero_title_line1: string;
  hero_title_line2: string;
  hero_description: string;
};

export type PeriodStatus = {
  open: boolean;
  reason: "ok" | "disabled" | "not_started" | "ended" | "inactive";
  start: string | null;
  end: string | null;
  message: string;
};

export type ProjectActivityBadge =
  | "เปิดรับสมัคร"
  | "กำลังดำเนินการสอบ"
  | "เปิดเรียนรู้"
  | "ปิดใช้งาน"
  | "ยังไม่เปิดรับสมัคร"
  | "ปิดรับสมัคร"
  | "ยังไม่เปิดสอบ"
  | "ปิดสอบ";

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
    hero_badge: asString(raw.hero_badge) || "คัดเลือกตัวแทน ICT Talent ประจำโรงเรียน",
    hero_title_line1: asString(raw.hero_title_line1) || "ตัวแทน ICT Talent",
    hero_title_line2: asString(raw.hero_title_line2) || "ประจำโรงเรียน",
    hero_description:
      asString(raw.hero_description) ||
      "แพลตฟอร์มลงทะเบียน เรียนรู้ และสอบคัดเลือกผู้แทนเทคโนโลยีสารสนเทศของโรงเรียน ครอบคลุมเขตพื้นที่การศึกษาทั่วประเทศ",
  };
}

/** Format ISO date for Thai locale. Returns empty string when unset (no dash placeholders). */
export function formatDateTimeTh(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

/** Display label for schedule UI — TBA when no date is set. */
export function formatScheduleDate(iso: string | null | undefined): string {
  const formatted = formatDateTimeTh(iso);
  return formatted || "ยังไม่กำหนดวัน";
}

export function hasScheduleDate(iso: string | null | undefined): boolean {
  return Boolean(formatDateTimeTh(iso));
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

/** Master status: inactive projects are hidden/locked across the platform. Defaults to active. */
export function isProjectActive(project: LearningProject): boolean {
  return project.is_active !== false;
}

export function getActiveProjects(projects: LearningProject[]): LearningProject[] {
  return projects.filter(isProjectActive);
}

/** Single-site architecture: one canonical project for the whole platform. */
export function getSiteProject(projects: LearningProject[]): LearningProject | undefined {
  const active = getActiveProjects(projects);
  if (active.length > 0) return active[0];
  return projects[0];
}

/**
 * Resolve absolute pass score from percentage threshold.
 * Legacy absolute thresholds (≤10) are treated as raw points.
 */
export function getPassScoreAbsolute(passThreshold: number | undefined, maxScore: number): number {
  const thr = passThreshold ?? 60;
  const max = Math.max(1, maxScore || 1);
  if (thr <= 10) return thr;
  return Math.ceil((max * Math.min(100, Math.max(0, thr))) / 100);
}

/**
 * Period rules (register + exam, per subject):
 * 1. Checkbox closed → always closed (dates ignored)
 * 2. Checkbox open + dates set → open only inside [start, end]
 * 3. Checkbox open + dates empty → always open until manually closed
 */
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
      const startLabel = formatDateTimeTh(start);
      return {
        open: false,
        reason: "not_started",
        start,
        end,
        message: startLabel ? `${labels.notStarted} (เปิด ${startLabel})` : labels.notStarted,
      };
    }
  }
  if (end) {
    const e = new Date(end);
    if (now > e) {
      const endLabel = formatDateTimeTh(end);
      return {
        open: false,
        reason: "ended",
        start,
        end,
        message: endLabel ? `${labels.ended} (ปิด ${endLabel})` : labels.ended,
      };
    }
  }
  return { open: true, reason: "ok", start, end, message: labels.ok };
}

function inactiveStatus(): PeriodStatus {
  return {
    open: false,
    reason: "inactive",
    start: null,
    end: null,
    message: "โครงการนี้ปิดใช้งานชั่วคราว",
  };
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
  if (!isProjectActive(project)) return inactiveStatus();
  return evaluatePeriod(
    project.reg_enabled ?? true,
    asIsoOrNull(project.reg_start),
    asIsoOrNull(project.reg_end),
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
  if (!isProjectActive(project)) return inactiveStatus();
  return evaluatePeriod(
    project.exam_enabled ?? true,
    asIsoOrNull(project.exam_start),
    asIsoOrNull(project.exam_end),
    {
      disabled: "โครงการนี้ปิดช่วงสอบ",
      notStarted: "ยังไม่ถึงกำหนดเปิดสอบของโครงการนี้",
      ended: "หมดเขตส่งข้อสอบของโครงการนี้แล้ว",
      ok: "เปิดช่วงสอบ",
    },
    now
  );
}

/** Learning portal access — requires master active status. */
export function getProjectLearningOpen(project: LearningProject): boolean {
  return isProjectActive(project);
}

/** Status badges for homepage carousel / notices. */
export function getProjectActivityBadges(project: LearningProject, now = new Date()): ProjectActivityBadge[] {
  if (!isProjectActive(project)) return ["ปิดใช้งาน"];

  const badges: ProjectActivityBadge[] = [];
  const reg = getProjectRegistrationStatus(project, now);
  const exam = getProjectExamStatus(project, now);

  if (reg.open) badges.push("เปิดรับสมัคร");
  else if (reg.reason === "not_started") badges.push("ยังไม่เปิดรับสมัคร");
  else if (reg.reason === "ended" || reg.reason === "disabled") badges.push("ปิดรับสมัคร");

  if (exam.open) badges.push("กำลังดำเนินการสอบ");
  else if (exam.reason === "not_started") badges.push("ยังไม่เปิดสอบ");
  else if (exam.reason === "ended" || exam.reason === "disabled") badges.push("ปิดสอบ");

  badges.push("เปิดเรียนรู้");
  return badges;
}

/** True if at least one active subject currently allows registration (for home / consent gates). */
export function getAnyProjectRegistrationStatus(
  projects: LearningProject[],
  now = new Date()
): PeriodStatus {
  const active = getActiveProjects(projects);
  if (!active.length) {
    return {
      open: false,
      reason: "disabled",
      start: null,
      end: null,
      message: "ขณะนี้ไม่มีโครงการ/วิชาที่เปิดรับลงทะเบียน",
    };
  }

  const statuses = active.map((p) => getProjectRegistrationStatus(p, now));
  const openStatus = statuses.find((s) => s.open);
  if (openStatus) return openStatus;

  const notStarted = statuses.find((s) => s.reason === "not_started");
  if (notStarted) {
    return { ...notStarted, message: "ยังไม่ถึงกำหนดเปิดรับลงทะเบียน" };
  }
  const ended = statuses.find((s) => s.reason === "ended");
  if (ended) {
    return { ...ended, message: "หมดเขตรับลงทะเบียนแล้ว" };
  }
  return {
    open: false,
    reason: "disabled",
    start: null,
    end: null,
    message: "ขณะนี้ปิดรับลงทะเบียน",
  };
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
