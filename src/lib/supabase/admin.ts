import { createClient } from "@/lib/supabase/client";
import { parseDistrictIdList } from "@/lib/supabase/data";
import { normalizeExternalUrl } from "@/lib/url";
import type { AdminRole, AdminUser, Candidate, ExamProgress, PortalRole } from "@/types/ict";

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/** Map RPC errors like `unauthorized` / `forbidden` to Thai UX copy. */
export function normalizeAdminError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("unauthorized")) {
    return "เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบผู้ดูแลใหม่";
  }
  if (m.includes("forbidden")) {
    return "ไม่มีสิทธิ์ดำเนินการนี้";
  }
  return message;
}

export function isAdminUnauthorized(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized/i.test(msg);
}

function adminRpcFail(error: { message: string }): Error {
  return new Error(normalizeAdminError(error.message));
}

export function generateTempPassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function adminLogin(
  username: string,
  password: string
): Promise<{ ok: true; token: string; admin: AdminUser } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_login", {
    p_username: username.trim(),
    p_password: password,
  });
  if (error) return { ok: false, error: normalizeAdminError(error.message) };

  const row = asObj(data);
  if (!row.ok) return { ok: false, error: String(row.error ?? "เข้าสู่ระบบไม่สำเร็จ") };

  const admin = asObj(row.admin);
  return {
    ok: true,
    token: String(row.token),
    admin: {
      admin_id: String(admin.admin_id),
      username: String(admin.username),
      full_name: String(admin.full_name),
      role: (admin.role === "super_admin" ? "super_admin" : "admin") as AdminRole,
      must_change_password: Boolean(admin.must_change_password),
    },
  };
}

export async function adminLogout(token: string) {
  const supabase = createClient();
  await supabase.rpc("admin_logout", { p_token: token });
}

export async function adminChangePassword(token: string, oldPassword: string, newPassword: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_change_password", {
    p_token: token,
    p_old_password: oldPassword,
    p_new_password: newPassword,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "เปลี่ยนรหัสผ่านไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminList(token: string): Promise<AdminUser[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list", { p_token: token });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const a = asObj(item);
    return {
      admin_id: String(a.admin_id),
      username: String(a.username),
      full_name: String(a.full_name),
      role: (a.role === "super_admin" ? "super_admin" : "admin") as AdminRole,
      must_change_password: Boolean(a.must_change_password),
      is_active: a.is_active !== false,
      created_at: a.created_at ? String(a.created_at) : undefined,
    };
  });
}

export async function adminCreate(
  token: string,
  input: { username: string; full_name: string; role: AdminRole; temp_password: string }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_create", {
    p_token: token,
    p_username: input.username,
    p_full_name: input.full_name,
    p_role: input.role,
    p_temp_password: input.temp_password,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "สร้างผู้ดูแลไม่สำเร็จ") };
  return {
    ok: true as const,
    admin_id: String(row.admin_id),
    temp_password: String(row.temp_password),
  };
}

export async function adminResetPassword(token: string, targetAdminId: string, tempPassword: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_reset_password", {
    p_token: token,
    p_target_admin_id: targetAdminId,
    p_temp_password: tempPassword,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ") };
  return { ok: true as const, temp_password: String(row.temp_password) };
}

export async function adminSetActive(token: string, targetAdminId: string, isActive: boolean) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_active", {
    p_token: token,
    p_target_admin_id: targetAdminId,
    p_is_active: isActive,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตสถานะไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSetRole(token: string, targetAdminId: string, role: AdminRole) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_role", {
    p_token: token,
    p_target_admin_id: targetAdminId,
    p_role: role,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "เปลี่ยนบทบาทไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminGetSettings(token: string): Promise<Record<string, unknown>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_get_settings", { p_token: token });
  if (error) throw adminRpcFail(error);
  return asObj(data);
}

export async function adminSaveSettings(token: string, settings: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_save_settings", {
    p_token: token,
    p_settings: settings,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกตั้งค่าไม่สำเร็จ") };
  try {
    const { invalidatePublicBootstrapCache } = await import("@/lib/supabase/bootstrap");
    invalidatePublicBootstrapCache();
  } catch {
    /* ignore */
  }
  return { ok: true as const };
}

export async function adminListProfilesBySchool(token: string, schoolId: string): Promise<Candidate[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_profiles_by_school", {
    p_token: token,
    p_school_id: schoolId,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const p = asObj(item);
    const first = String(p.first_name ?? "");
    const last = String(p.last_name ?? "");
    return {
      id: String(p.profile_id),
      school_id: String(p.school_id),
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`.trim(),
      phone: String(p.phone ?? ""),
      remark: p.remark ? String(p.remark) : undefined,
      is_school_admin: Boolean(p.is_school_admin),
      created_at: p.created_at ? String(p.created_at) : new Date().toISOString(),
    };
  });
}

export async function adminUpdateProfileRpc(
  token: string,
  input: {
    profile_id: string;
    first_name: string;
    last_name: string;
    phone: string;
    remark?: string;
  }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_update_profile", {
    p_token: token,
    p_profile_id: input.profile_id,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_phone: input.phone,
    p_remark: input.remark ?? "",
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminDeleteProfileRpc(token: string, profileId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_profile", {
    p_token: token,
    p_profile_id: profileId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminDeleteSchoolProfilesRpc(token: string, schoolId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_school_profiles", {
    p_token: token,
    p_school_id: schoolId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const, deleted_count: Number(row.deleted_count) || 0 };
}

export async function adminDeleteExamProgressRpc(
  token: string,
  profileId: string,
  projectId?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_exam_progress", {
    p_token: token,
    p_profile_id: profileId,
    p_project_id: projectId ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบข้อมูลข้อสอบไม่สำเร็จ") };
  return { ok: true as const, deleted: Number(row.deleted) || 0 };
}

export async function adminSetSchoolAdminRpc(
  token: string,
  profileId: string,
  isSchoolAdmin: boolean
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_school_admin", {
    p_token: token,
    p_profile_id: profileId,
    p_is_school_admin: isSchoolAdmin,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "เปลี่ยนบทบาทไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSearchProfiles(token: string, query: string, limit = 50): Promise<Candidate[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_search_profiles", {
    p_token: token,
    p_query: query.trim(),
    p_limit: limit,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const p = asObj(item);
    const first = String(p.first_name ?? "");
    const last = String(p.last_name ?? "");
    const role = (p.portal_role === "school_admin" ? "school_admin" : "user") as PortalRole;
    return {
      id: String(p.profile_id),
      school_id: String(p.school_id ?? ""),
      school_name: p.school_name ? String(p.school_name) : undefined,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`.trim(),
      phone: String(p.phone ?? ""),
      email: p.contact_email
        ? String(p.contact_email)
        : p.email
          ? String(p.email)
          : undefined,
      contact_email: p.contact_email
        ? String(p.contact_email)
        : p.email
          ? String(p.email)
          : undefined,
      login_email: p.login_email ? String(p.login_email) : undefined,
      remark: p.remark ? String(p.remark) : undefined,
      is_school_admin: Boolean(p.is_school_admin) || role === "school_admin",
      portal_role: role,
      is_active: p.is_active !== false,
      deleted_at: p.deleted_at ? String(p.deleted_at) : null,
      created_at: p.created_at ? String(p.created_at) : new Date().toISOString(),
    };
  });
}

export async function adminListExamProgressRpc(
  token: string,
  profileIds: string[],
  projectId?: string
): Promise<
  {
    candidate_id: string;
    project_id?: string;
    answers: Record<string, string>;
    status: "draft" | "submitted";
    lesson_submissions?: ExamProgress["lesson_submissions"];
    score?: number;
    passed?: boolean;
    graded_at?: string;
    updated_at: string;
  }[]
> {
  if (profileIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_exam_progress", {
    p_token: token,
    p_profile_ids: profileIds,
    p_project_id: projectId ?? null,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const row = asObj(item);
    return {
      candidate_id: String(row.profile_id ?? ""),
      project_id: row.project_id ? String(row.project_id) : undefined,
      // List RPC is slim — answers intentionally empty until admin_get_exam_answers
      answers: {},
      status: row.status === "submitted" ? ("submitted" as const) : ("draft" as const),
      lesson_submissions:
        row.lesson_submissions && typeof row.lesson_submissions === "object"
          ? (row.lesson_submissions as ExamProgress["lesson_submissions"])
          : {},
      score: row.score != null ? Number(row.score) : undefined,
      passed: typeof row.passed === "boolean" ? row.passed : undefined,
      graded_at: row.graded_at ? String(row.graded_at) : undefined,
      updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    };
  });
}

/** Lazy-load full answers JSONB for one candidate (detail drawer). */
export async function adminGetExamAnswersRpc(
  token: string,
  profileId: string,
  projectId?: string
): Promise<ExamProgress | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_get_exam_answers", {
    p_token: token,
    p_profile_id: profileId,
    p_project_id: projectId ?? null,
  });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  if (row.ok === false) throw new Error(String(row.error ?? "โหลดคำตอบไม่สำเร็จ"));
  if (!row.profile_id && !row.status) return null;
  return {
    candidate_id: String(row.profile_id ?? profileId),
    project_id: row.project_id ? String(row.project_id) : undefined,
    answers: (row.answers as Record<string, string>) || {},
    status: row.status === "submitted" ? ("submitted" as const) : ("draft" as const),
    lesson_submissions:
      row.lesson_submissions && typeof row.lesson_submissions === "object"
        ? (row.lesson_submissions as ExamProgress["lesson_submissions"])
        : {},
    score: row.score != null ? Number(row.score) : undefined,
    passed: typeof row.passed === "boolean" ? row.passed : undefined,
    graded_at: row.graded_at ? String(row.graded_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

export async function adminListQuestionsRpc(token: string, projectId?: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_questions", {
    p_token: token,
    p_project_id: projectId ?? null,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data;
}

export async function adminUnlockExamRpc(
  token: string,
  profileId: string,
  projectId?: string
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_unlock_exam", {
    p_token: token,
    p_profile_id: profileId,
    p_project_id: projectId ?? null,
  });
  if (error) return { ok: false, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false, error: String(row.error ?? "ปลดล็อกข้อสอบไม่สำเร็จ") };
  return { ok: true, updated: Number(row.updated) || 0 };
}

export type AuditLogRow = {
  log_id: string;
  admin_id: string | null;
  admin_username?: string;
  admin_full_name?: string;
  action: string;
  target_table: string;
  target_id: string | null;
  old_data: unknown;
  new_data: unknown;
  summary?: string | null;
  ip_address: string | null;
  created_at: string;
};

export type AuditPurgeHistoryRow = {
  purge_id: string;
  admin_username?: string;
  purged_count: number;
  export_filename: string | null;
  oldest_log_at: string | null;
  newest_log_at: string | null;
  note: string | null;
  created_at: string;
};

export type AdminOverviewStats = {
  schools_total: number;
  schools_registered: number;
  districts_total: number;
  profiles_total: number;
  profiles_today: number;
  watch_completed: number;
  watch_total: number;
  exam_submitted: number;
  exam_draft: number;
  exam_partial: number;
  exam_passed: number;
  exam_failed: number;
  exam_total: number;
};

export async function adminOverviewStats(
  token: string,
  projectId?: string
): Promise<AdminOverviewStats> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_overview_stats", {
    p_token: token,
    p_project_id: projectId?.trim() || null,
  });
  if (error) {
    // Fallback if 2-arg RPC not deployed yet
    const legacy = await supabase.rpc("admin_overview_stats", { p_token: token });
    if (legacy.error) throw adminRpcFail(error);
    const row = asObj(legacy.data);
    return {
      schools_total: Number(row.schools_total) || 0,
      schools_registered: Number(row.schools_registered) || 0,
      districts_total: Number(row.districts_total) || 0,
      profiles_total: Number(row.profiles_total) || 0,
      profiles_today: Number(row.profiles_today) || 0,
      watch_completed: Number(row.watch_completed) || 0,
      watch_total: Number(row.watch_total) || 0,
      exam_submitted: Number(row.exam_submitted) || 0,
      exam_draft: Number(row.exam_draft) || 0,
      exam_partial: Number(row.exam_partial) || 0,
      exam_passed: Number(row.exam_passed) || 0,
      exam_failed: Number(row.exam_failed) || 0,
      exam_total: Number(row.exam_total) || 0,
    };
  }
  const row = asObj(data);
  return {
    schools_total: Number(row.schools_total) || 0,
    schools_registered: Number(row.schools_registered) || 0,
    districts_total: Number(row.districts_total) || 0,
    profiles_total: Number(row.profiles_total) || 0,
    profiles_today: Number(row.profiles_today) || 0,
    watch_completed: Number(row.watch_completed) || 0,
    watch_total: Number(row.watch_total) || 0,
    exam_submitted: Number(row.exam_submitted) || 0,
    exam_draft: Number(row.exam_draft) || 0,
    exam_partial: Number(row.exam_partial) || 0,
    exam_passed: Number(row.exam_passed) || 0,
    exam_failed: Number(row.exam_failed) || 0,
    exam_total: Number(row.exam_total) || 0,
  };
}

export async function adminListAuditLogs(token: string, limit = 100, offset = 0): Promise<AuditLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_audit_logs", {
    p_token: token,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const r = asObj(item);
    return {
      log_id: String(r.log_id),
      admin_id: r.admin_id ? String(r.admin_id) : null,
      admin_username: r.admin_username ? String(r.admin_username) : undefined,
      admin_full_name: r.admin_full_name ? String(r.admin_full_name) : undefined,
      action: String(r.action),
      target_table: String(r.target_table),
      target_id: r.target_id ? String(r.target_id) : null,
      old_data: r.old_data ?? null,
      new_data: r.new_data ?? null,
      summary: r.summary != null && String(r.summary).trim() !== "" ? String(r.summary) : null,
      ip_address: r.ip_address ? String(r.ip_address) : null,
      created_at: String(r.created_at),
    };
  });
}

export async function adminAuditStats(token: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_audit_stats", { p_token: token });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  return {
    total_logs: Number(row.total_logs) || 0,
    oldest_at: row.oldest_at ? String(row.oldest_at) : null,
    newest_at: row.newest_at ? String(row.newest_at) : null,
    purge_count: Number(row.purge_count) || 0,
  };
}

export async function adminExportAuditLogs(token: string): Promise<AuditLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_export_audit_logs", { p_token: token });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const r = asObj(item);
    return {
      log_id: String(r.log_id),
      admin_id: r.admin_id ? String(r.admin_id) : null,
      admin_username: r.admin_username ? String(r.admin_username) : undefined,
      action: String(r.action),
      target_table: String(r.target_table),
      target_id: r.target_id ? String(r.target_id) : null,
      old_data: r.old_data ?? null,
      new_data: r.new_data ?? null,
      summary: r.summary != null && String(r.summary).trim() !== "" ? String(r.summary) : null,
      ip_address: r.ip_address ? String(r.ip_address) : null,
      created_at: String(r.created_at),
    };
  });
}

export async function adminPurgeAuditLogs(token: string, exportFilename: string, confirm: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_purge_audit_logs", {
    p_token: token,
    p_export_filename: exportFilename,
    p_confirm: confirm,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ล้าง log ไม่สำเร็จ") };
  return {
    ok: true as const,
    purged_count: Number(row.purged_count) || 0,
    oldest_at: row.oldest_at ? String(row.oldest_at) : null,
    newest_at: row.newest_at ? String(row.newest_at) : null,
  };
}

export async function adminListPurgeHistory(token: string): Promise<AuditPurgeHistoryRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_purge_history", { p_token: token });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const r = asObj(item);
    return {
      purge_id: String(r.purge_id),
      admin_username: r.admin_username ? String(r.admin_username) : undefined,
      purged_count: Number(r.purged_count) || 0,
      export_filename: r.export_filename ? String(r.export_filename) : null,
      oldest_log_at: r.oldest_log_at ? String(r.oldest_log_at) : null,
      newest_log_at: r.newest_log_at ? String(r.newest_log_at) : null,
      note: r.note ? String(r.note) : null,
      created_at: String(r.created_at),
    };
  });
}

function mapAdminUserRow(item: unknown): Candidate {
  const p = asObj(item);
  const first = String(p.first_name ?? "");
  const last = String(p.last_name ?? "");
  const role = (p.portal_role === "school_admin" ? "school_admin" : "user") as PortalRole;
  return {
    id: String(p.profile_id),
    school_id: String(p.school_id ?? ""),
    school_name: p.school_name ? String(p.school_name) : undefined,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim(),
    phone: String(p.phone ?? ""),
    email: p.contact_email
      ? String(p.contact_email)
      : p.email
        ? String(p.email)
        : undefined,
    contact_email: p.contact_email
      ? String(p.contact_email)
      : p.email
        ? String(p.email)
        : undefined,
    login_email: p.login_email ? String(p.login_email) : undefined,
    province: p.province ? String(p.province) : undefined,
    district_id: p.district_id ? String(p.district_id) : undefined,
    district_name: p.district_name ? String(p.district_name) : undefined,
    remark: p.remark ? String(p.remark) : undefined,
    is_school_admin: Boolean(p.is_school_admin) || role === "school_admin",
    portal_role: role,
    is_active: p.is_active !== false,
    deleted_at: p.deleted_at ? String(p.deleted_at) : null,
    position: p.position ? String(p.position) : undefined,
    position_other: p.position_other ? String(p.position_other) : undefined,
    title_th: p.title_th ? String(p.title_th) : undefined,
    title_other_th: p.title_other_th ? String(p.title_other_th) : undefined,
    created_at: p.created_at ? String(p.created_at) : new Date().toISOString(),
  };
}

export async function adminSearchUsers(
  token: string,
  query: string,
  limit = 50,
  opts: boolean | { includeDeleted?: boolean; onlyDeleted?: boolean } = false
): Promise<Candidate[]> {
  const includeDeleted =
    typeof opts === "boolean" ? opts : Boolean(opts.includeDeleted || opts.onlyDeleted);
  const onlyDeleted = typeof opts === "boolean" ? false : Boolean(opts.onlyDeleted);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_search_users", {
    p_token: token,
    p_query: query.trim(),
    p_limit: limit,
    p_include_deleted: includeDeleted,
    p_only_deleted: onlyDeleted,
  });
  if (error) {
    // Fallback if 5-arg RPC not deployed yet
    const legacy = await supabase.rpc("admin_search_users", {
      p_token: token,
      p_query: query.trim(),
      p_limit: limit,
      p_include_deleted: includeDeleted,
    });
    if (legacy.error) throw adminRpcFail(error);
    const rows = Array.isArray(legacy.data) ? legacy.data : [];
    const mapped = rows.map(mapAdminUserRow);
    if (onlyDeleted) return mapped.filter((r) => Boolean(r.deleted_at));
    if (!includeDeleted) return mapped.filter((r) => !r.deleted_at);
    return mapped;
  }
  if (!Array.isArray(data)) return [];
  return data.map(mapAdminUserRow);
}

export async function adminSetPortalRoleRpc(
  token: string,
  profileId: string,
  role: PortalRole,
  assignedDistrictId?: string | null
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_portal_role", {
    p_token: token,
    p_profile_id: profileId,
    p_role: role,
    p_assigned_district_id: assignedDistrictId ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "เปลี่ยนบทบาทไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminUpdateLoginEmailRpc(token: string, profileId: string, email: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_update_login_email", {
    p_token: token,
    p_profile_id: profileId,
    p_email: email.trim().toLowerCase(),
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตอีเมลไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSetUserActiveRpc(token: string, profileId: string, isActive: boolean) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_user_active", {
    p_token: token,
    p_profile_id: profileId,
    p_is_active: isActive,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตสถานะไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSoftDeleteUserRpc(token: string, profileId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_soft_delete_user", {
    p_token: token,
    p_profile_id: profileId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminRestoreUserRpc(token: string, profileId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_restore_user", {
    p_token: token,
    p_profile_id: profileId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "กู้คืนไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminCreateSpecialUserRpc(
  token: string,
  input: {
    profile_id: string;
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
    role: "business_user" | "audit_user";
    temp_password: string;
    title_th?: string;
    position?: string;
    assigned_district_id?: string;
    school_id?: string;
  }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_create_special_user", {
    p_token: token,
    p_profile_id: input.profile_id,
    p_email: input.email,
    p_first_name: input.first_name,
    p_last_name: input.last_name,
    p_phone: input.phone,
    p_role: input.role,
    p_temp_password: input.temp_password,
    p_title_th: input.title_th ?? null,
    p_position: input.position ?? null,
    p_assigned_district_id: input.assigned_district_id ?? null,
    p_school_id: input.school_id ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "สร้างผู้ใช้ไม่สำเร็จ") };
  return {
    ok: true as const,
    temp_password: String(row.temp_password ?? input.temp_password),
  };
}

export async function adminExportExamResponsesRpc(token: string, projectId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_export_exam_responses", {
    p_token: token,
    p_project_id: projectId,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    const r = asObj(item);
    return {
      profile_id: String(r.profile_id ?? ""),
      login_email: String(r.login_email ?? r.email ?? "") || "",
      first_name: String(r.first_name ?? ""),
      last_name: String(r.last_name ?? ""),
      full_name: String(r.full_name ?? "").trim() || "N/A",
      school_id: String(r.school_id ?? "") || "N/A",
      school_name: String(r.school_name ?? "") || "N/A",
      phone: String(r.phone ?? "") || "N/A",
      email: r.email ? String(r.email) : "",
      project_id: r.project_id ? String(r.project_id) : undefined,
      answers: (r.answers as Record<string, string>) || {},
      status: r.status === "submitted" ? ("submitted" as const) : ("draft" as const),
      score: r.score != null ? Number(r.score) : undefined,
      passed: typeof r.passed === "boolean" ? r.passed : undefined,
      graded_at: r.graded_at ? String(r.graded_at) : undefined,
      updated_at: r.updated_at ? String(r.updated_at) : new Date().toISOString(),
    };
  });
}

export async function adminExportHierarchyRpc(token: string, mode: "district" | "partner") {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_export_hierarchy", {
    p_token: token,
    p_mode: mode,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => asObj(item));
}

export type AdminExportSlice = {
  districtId?: string;
  province?: string;
  /** Max rows per request (server caps at 10000; default 5000). */
  limit?: number;
  offset?: number;
};

export async function adminExportParticipantsFullRpc(
  token: string,
  opts: AdminExportSlice = {}
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_export_participants_full", {
    p_token: token,
    p_district_id: opts.districtId?.trim() || null,
    p_province: opts.province?.trim() || null,
    p_limit: opts.limit ?? 5000,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => asObj(item));
}

export async function adminExportRegistrationDetailsRpc(
  token: string,
  opts: AdminExportSlice = {}
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_export_registration_details", {
    p_token: token,
    p_district_id: opts.districtId?.trim() || null,
    p_province: opts.province?.trim() || null,
    p_limit: opts.limit ?? 5000,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw adminRpcFail(error);
  if (!Array.isArray(data)) return [];
  return data.map((item) => asObj(item));
}

/** Page through export RPC until a short page is returned (complete nationwide dump). */
export async function adminExportAllChunks(
  fetchPage: (offset: number, limit: number) => Promise<Record<string, unknown>[]>,
  chunkSize = 5000,
  maxRows = 500_000
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const limit = Math.max(1, Math.min(chunkSize, 10000));
  while (all.length < maxRows) {
    const page = await fetchPage(offset, limit);
    all.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function adminMissionProgressStats(token: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_mission_progress_stats", { p_token: token });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  return {
    total_missions: Number(row.total_missions) || 0,
    total_users: Number(row.total_users) || 0,
    completed_pairs: Number(row.completed_pairs) || 0,
    avg_completed_per_user: Number(row.avg_completed_per_user) || 0,
  };
}

export type AdminActivityOverviewStats = {
  points_total: number;
  users_with_score: number;
  points_by_source: Record<string, number>;
  live_active: number;
  live_in_window: number;
  live_checkins_total: number;
  live_checkins_today: number;
  tasks_open: number;
  submissions_pending: number;
  submissions_approved: number;
  submissions_draft: number;
  submissions_rejected: number;
};

export async function adminActivityOverviewStats(
  token: string
): Promise<AdminActivityOverviewStats> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_activity_overview_stats", { p_token: token });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  const bySourceRaw = asObj(row.points_by_source);
  const points_by_source: Record<string, number> = {};
  for (const [k, v] of Object.entries(bySourceRaw)) {
    points_by_source[k] = Number(v) || 0;
  }
  return {
    points_total: Number(row.points_total) || 0,
    users_with_score: Number(row.users_with_score) || 0,
    points_by_source,
    live_active: Number(row.live_active) || 0,
    live_in_window: Number(row.live_in_window) || 0,
    live_checkins_total: Number(row.live_checkins_total) || 0,
    live_checkins_today: Number(row.live_checkins_today) || 0,
    tasks_open: Number(row.tasks_open) || 0,
    submissions_pending: Number(row.submissions_pending) || 0,
    submissions_approved: Number(row.submissions_approved) || 0,
    submissions_draft: Number(row.submissions_draft) || 0,
    submissions_rejected: Number(row.submissions_rejected) || 0,
  };
}

export type ExecutiveUserRow = {
  id: string;
  kind: "business" | "audit";
  login_email: string;
  display_name: string;
  position?: string | null;
  assigned_districts?: string[];
  is_active?: boolean;
  must_set_password?: boolean;
  /** Plaintext temp password while must_set_password — admin display only */
  pending_temp_password?: string | null;
  deleted_at?: string | null;
  created_at?: string;
};

export async function adminListExecutiveUsers(
  token: string,
  includeDeleted = false
): Promise<{
  business: ExecutiveUserRow[];
  audit: ExecutiveUserRow[];
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_executive_users", {
    p_token: token,
    p_kind: "all",
    p_include_deleted: includeDeleted,
  });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  const mapRow = (item: unknown, kind: "business" | "audit"): ExecutiveUserRow => {
    const r = asObj(item);
    const districts = parseDistrictIdList(r.assigned_districts);
    return {
      id: String(r.id),
      kind,
      login_email: String(r.login_email ?? ""),
      display_name: String(r.display_name ?? ""),
      position: r.position == null ? null : String(r.position),
      assigned_districts: districts,
      is_active: r.is_active !== false,
      must_set_password: Boolean(r.must_set_password),
      pending_temp_password:
        r.pending_temp_password && r.must_set_password
          ? String(r.pending_temp_password)
          : null,
      deleted_at: r.deleted_at ? String(r.deleted_at) : null,
      created_at: r.created_at ? String(r.created_at) : undefined,
    };
  };
  return {
    business: Array.isArray(row.business)
      ? row.business.map((i) => mapRow(i, "business"))
      : [],
    audit: Array.isArray(row.audit) ? row.audit.map((i) => mapRow(i, "audit")) : [],
  };
}

export async function adminUpsertBusinessUserRpc(
  token: string,
  input: {
    login_email: string;
    display_name: string;
    position?: string;
    temp_password?: string;
    id?: string;
  }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_business_user", {
    p_token: token,
    p_login_email: input.login_email,
    p_display_name: input.display_name,
    p_position: input.position ?? null,
    p_temp_password: input.temp_password ?? null,
    p_id: input.id ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return {
    ok: true as const,
    id: String(row.id),
    temp_password: row.temp_password ? String(row.temp_password) : undefined,
  };
}

export async function adminUpsertAuditUserRpc(
  token: string,
  input: {
    login_email: string;
    display_name: string;
    position?: string;
    assigned_districts: string[];
    temp_password?: string;
    id?: string;
  }
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_audit_user", {
    p_token: token,
    p_login_email: input.login_email,
    p_display_name: input.display_name,
    p_position: input.position ?? null,
    p_assigned_districts: input.assigned_districts,
    p_temp_password: input.temp_password ?? null,
    p_id: input.id ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return {
    ok: true as const,
    id: String(row.id),
    temp_password: row.temp_password ? String(row.temp_password) : undefined,
  };
}

export async function adminSetAuditDistrictsRpc(
  token: string,
  id: string,
  districts: string[]
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_audit_districts", {
    p_token: token,
    p_id: id,
    p_assigned_districts: districts,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  const saved = parseDistrictIdList(row.assigned_districts);
  return { ok: true as const, assigned_districts: saved.length ? saved : districts };
}

export async function adminSetExecutiveActiveRpc(
  token: string,
  kind: "business" | "audit",
  id: string,
  isActive: boolean
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_executive_active", {
    p_token: token,
    p_kind: kind,
    p_id: id,
    p_is_active: isActive,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตสถานะไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSoftDeleteExecutiveRpc(
  token: string,
  kind: "business" | "audit",
  id: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_soft_delete_executive", {
    p_token: token,
    p_kind: kind,
    p_id: id,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminRestoreExecutiveRpc(
  token: string,
  kind: "business" | "audit",
  id: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_restore_executive", {
    p_token: token,
    p_kind: kind,
    p_id: id,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "กู้คืนไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminResetExecutiveTempPasswordRpc(
  token: string,
  kind: "business" | "audit",
  id: string,
  tempPassword?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_reset_executive_temp_password", {
    p_token: token,
    p_kind: kind,
    p_id: id,
    p_temp_password: tempPassword ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "รีเซ็ตรหัสผ่านไม่สำเร็จ") };
  return { ok: true as const, temp_password: String(row.temp_password ?? "") };
}

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

export async function adminListActivityProjects(token: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_activity_projects", { p_token: token });
  if (error) throw adminRpcFail(error);
  return asArr(data).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      name: String(m.name ?? ""),
      created_at: m.created_at ? String(m.created_at) : "",
    };
  });
}

export async function adminListActivityTasks(token: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_activity_tasks", { p_token: token });
  if (error) throw adminRpcFail(error);
  return asArr(data).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      activity_project_id: m.activity_project_id ? String(m.activity_project_id) : "",
      activity_project_name: m.activity_project_name ? String(m.activity_project_name) : null,
      project_id: m.project_id ? String(m.project_id) : "",
      project_name: m.project_name ? String(m.project_name) : null,
      report_name: String(m.report_name ?? ""),
      report_detail: m.report_detail != null ? String(m.report_detail) : "",
      report_deadline: m.report_deadline ? String(m.report_deadline) : "",
      include_report_name: m.include_report_name !== false,
      include_detail: Boolean(m.include_detail),
      include_deadline: Boolean(m.include_deadline),
      include_video_url: m.include_video_url !== false,
      include_doc_url: m.include_doc_url !== false,
      score_points: Number(m.score_points) || 0,
      is_open: Boolean(m.is_open),
      activity_year: Number(m.activity_year) || new Date().getFullYear(),
      submission_count: Number(m.submission_count) || 0,
      approved_count: Number(m.approved_count) || 0,
      pending_count: Number(m.pending_count) || 0,
    };
  });
}

export async function adminListPendingSubmissions(token: string, page = 1, pageSize = 10) {
  const offset = Math.max(0, (page - 1) * pageSize);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_pending_submissions", {
    p_token: token,
    p_limit: pageSize,
    p_offset: offset,
  });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  return {
    total: Number(row.total) || 0,
    rows: asArr(row.rows).map((item) => {
      const m = asObj(item);
      return {
        id: String(m.id),
        task_id: String(m.task_id ?? ""),
        report_name: String(m.report_name ?? ""),
        activity_project_name: m.activity_project_name ? String(m.activity_project_name) : "",
        score_points: Number(m.score_points) || 0,
        profile_id: String(m.profile_id ?? ""),
        first_name: String(m.first_name ?? ""),
        last_name: String(m.last_name ?? ""),
        school_name: String(m.school_name ?? ""),
        video_url: m.video_url ? String(m.video_url) : null,
        doc_url: m.doc_url ? String(m.doc_url) : null,
        report_url: m.report_url ? String(m.report_url) : null,
        submitted_at: m.submitted_at ? String(m.submitted_at) : null,
        status: String(m.status ?? "pending"),
      };
    }),
  };
}

export async function adminReviewSubmission(
  token: string,
  submissionId: string,
  approve: boolean,
  note?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_review_submission", {
    p_token: token,
    p_submission_id: submissionId,
    p_approve: approve,
    p_note: note ?? null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminUpsertActivityTask(token: string, task: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_activity_task", {
    p_token: token,
    p_task: task,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกภารกิจไม่สำเร็จ") };
  return { ok: true as const, id: String(row.id ?? "") };
}

export async function adminDeleteActivityTask(token: string, taskId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_activity_task", {
    p_token: token,
    p_task_id: taskId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminListLiveMeetings(token: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_live_meetings", { p_token: token });
  if (error) throw adminRpcFail(error);
  return asArr(data).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      title: String(m.title ?? ""),
      youtube_url: String(m.youtube_url ?? ""),
      window_start: m.window_start ? String(m.window_start) : "",
      window_end: m.window_end ? String(m.window_end) : "",
      score_points: Number(m.score_points) || 0,
      is_active: m.is_active !== false,
    };
  });
}

export async function adminUpsertLiveMeeting(token: string, meeting: Record<string, unknown>) {
  const youtube = meeting.youtube_url != null ? String(meeting.youtube_url) : "";
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_live_meeting", {
    p_token: token,
    p_meeting: {
      ...meeting,
      youtube_url: normalizeExternalUrl(youtube) || youtube,
    },
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึก Live ไม่สำเร็จ") };
  return { ok: true as const, id: String(row.id ?? "") };
}

export async function adminDeleteLiveMeeting(token: string, meetingId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_live_meeting", {
    p_token: token,
    p_meeting_id: meetingId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminListAuditorDocuments(token: string, districtId?: string | null) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_auditor_documents", {
    p_token: token,
    p_district_id: districtId ?? null,
  });
  if (error) throw adminRpcFail(error);
  return asArr(data).map((item) => {
    const m = asObj(item);
    return {
      id: String(m.id),
      district_id: String(m.district_id ?? ""),
      title: String(m.title ?? ""),
      file_url: m.file_url ? String(m.file_url) : m.file_path ? String(m.file_path) : "",
      created_at: m.created_at ? String(m.created_at) : "",
    };
  });
}

export async function adminUpsertAuditorDocument(token: string, doc: Record<string, unknown>) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_auditor_document", {
    p_token: token,
    p_doc: doc,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกเอกสารไม่สำเร็จ") };
  return { ok: true as const, id: String(row.id ?? "") };
}

export async function adminDeleteAuditorDocument(token: string, docId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_auditor_document", {
    p_token: token,
    p_doc_id: docId,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const };
}

export async function adminSetVideoScorePoints(token: string, videoId: string, scorePoints: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_video_score_points", {
    p_token: token,
    p_video_id: videoId,
    p_score_points: scorePoints,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "บันทึกคะแนนวิดีโอไม่สำเร็จ") };
  return { ok: true as const };
}

export type ScoreAdjustmentRow = {
  id: string;
  profile_id: string;
  points: number;
  remark: string;
  notify_user: boolean;
  admin_id: string | null;
  created_at: string;
};

export async function adminProfileScores(
  token: string,
  profileIds: string[]
): Promise<Record<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_profile_scores", {
    p_token: token,
    p_profile_ids: profileIds,
  });
  if (error) throw adminRpcFail(error);
  const row = asObj(data);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = Number(v) || 0;
  }
  return out;
}

export async function adminAdjustScore(
  token: string,
  profileId: string,
  points: number,
  remark: string,
  notify: boolean,
  userComment?: string
) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_adjust_score", {
    p_token: token,
    p_profile_id: profileId,
    p_points: points,
    p_remark: remark,
    p_notify: notify,
    p_user_comment: userComment?.trim() || null,
  });
  if (error) return { ok: false as const, error: normalizeAdminError(error.message) };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ปรับคะแนนไม่สำเร็จ") };
  return {
    ok: true as const,
    id: String(row.id ?? ""),
    points: Number(row.points) || 0,
    total_score: Number(row.total_score) || 0,
  };
}

export async function adminListScoreAdjustments(
  token: string,
  profileId: string,
  limit = 10
): Promise<ScoreAdjustmentRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_list_score_adjustments", {
    p_token: token,
    p_profile_id: profileId,
    p_limit: Math.min(limit, 10),
  });
  if (error) throw adminRpcFail(error);
  return asArr(data)
    .map((item) => {
      const m = asObj(item);
      return {
        id: String(m.id),
        profile_id: String(m.profile_id ?? ""),
        points: Number(m.points) || 0,
        remark: String(m.remark ?? ""),
        notify_user: m.notify_user === true,
        admin_id: m.admin_id ? String(m.admin_id) : null,
        created_at: String(m.created_at ?? ""),
      };
    })
    .slice(0, 10);
}

