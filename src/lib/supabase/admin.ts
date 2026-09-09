import { createClient } from "@/lib/supabase/client";
import type { AdminRole, AdminUser, Candidate } from "@/types/ict";

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
    return {
      id: String(p.profile_id),
      school_id: String(p.school_id ?? ""),
      school_name: p.school_name ? String(p.school_name) : undefined,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`.trim(),
      phone: String(p.phone ?? ""),
      remark: p.remark ? String(p.remark) : undefined,
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
      answers: (row.answers as Record<string, string>) || {},
      status: row.status === "submitted" ? ("submitted" as const) : ("draft" as const),
      score: row.score != null ? Number(row.score) : undefined,
      passed: typeof row.passed === "boolean" ? row.passed : undefined,
      graded_at: row.graded_at ? String(row.graded_at) : undefined,
      updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    };
  });
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
  exam_total: number;
};

export async function adminOverviewStats(token: string): Promise<AdminOverviewStats> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_overview_stats", { p_token: token });
  if (error) throw adminRpcFail(error);
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
