import { createClient } from "@/lib/supabase/client";
import type { AppNotification, SessionUser } from "@/types/ict";

function asObj(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asArr(data: unknown): unknown[] {
  return Array.isArray(data) ? data : [];
}

export type NotificationAudience = "user" | "admin" | "business" | "audit";

export function notificationIdentityFromSession(session: SessionUser | null): {
  audience: NotificationAudience;
  profile_id?: string;
  phone?: string;
  login_email?: string;
  admin_token?: string;
} | null {
  if (!session) return null;
  if (session.kind === "candidate") {
    return {
      audience: "user",
      profile_id: session.candidate.id,
      phone: session.candidate.phone,
    };
  }
  if (session.kind === "admin") {
    return { audience: "admin", admin_token: session.token };
  }
  if (session.kind === "business") {
    return { audience: "business", login_email: session.user.login_email };
  }
  if (session.kind === "audit") {
    return { audience: "audit", login_email: session.user.login_email };
  }
  return null;
}

function mapNotification(raw: unknown): AppNotification {
  const m = asObj(raw);
  return {
    id: String(m.id),
    title: String(m.title ?? ""),
    body: String(m.body ?? ""),
    kind: String(m.kind ?? "system"),
    link_path: m.link_path ? String(m.link_path) : null,
    meta: m.meta && typeof m.meta === "object" ? (m.meta as Record<string, unknown>) : {},
    created_at: String(m.created_at ?? ""),
    read_at: m.read_at ? String(m.read_at) : null,
    is_unread: m.is_unread !== false && !m.read_at,
  };
}

export async function listMyNotifications(
  session: SessionUser,
  limit = 30
): Promise<{ unread_count: number; rows: AppNotification[] }> {
  const id = notificationIdentityFromSession(session);
  if (!id) throw new Error("ไม่พบเซสชัน");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_my_notifications", {
    p_audience: id.audience,
    p_profile_id: id.profile_id ?? null,
    p_phone: id.phone ?? null,
    p_login_email: id.login_email ?? null,
    p_admin_token: id.admin_token ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const row = asObj(data);
  if (!row.ok) throw new Error(String(row.error ?? "โหลดการแจ้งเตือนไม่สำเร็จ"));
  return {
    unread_count: Number(row.unread_count) || 0,
    rows: asArr(row.rows).map(mapNotification),
  };
}

export async function markNotificationRead(session: SessionUser, notificationId: string) {
  const id = notificationIdentityFromSession(session);
  if (!id) return { ok: false as const, error: "ไม่พบเซสชัน" };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
    p_audience: id.audience,
    p_profile_id: id.profile_id ?? null,
    p_phone: id.phone ?? null,
    p_login_email: id.login_email ?? null,
    p_admin_token: id.admin_token ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตไม่สำเร็จ") };
  return { ok: true as const };
}

export async function markAllNotificationsRead(session: SessionUser) {
  const id = notificationIdentityFromSession(session);
  if (!id) return { ok: false as const, error: "ไม่พบเซสชัน" };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read", {
    p_audience: id.audience,
    p_profile_id: id.profile_id ?? null,
    p_phone: id.phone ?? null,
    p_login_email: id.login_email ?? null,
    p_admin_token: id.admin_token ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "อัปเดตไม่สำเร็จ") };
  return { ok: true as const, marked: Number(row.marked) || 0 };
}

export async function clearReadNotifications(session: SessionUser) {
  const id = notificationIdentityFromSession(session);
  if (!id) return { ok: false as const, error: "ไม่พบเซสชัน" };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clear_read_notifications", {
    p_audience: id.audience,
    p_profile_id: id.profile_id ?? null,
    p_phone: id.phone ?? null,
    p_login_email: id.login_email ?? null,
    p_admin_token: id.admin_token ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  const row = asObj(data);
  if (!row.ok) return { ok: false as const, error: String(row.error ?? "ลบไม่สำเร็จ") };
  return { ok: true as const, deleted: Number(row.deleted) || 0 };
}
