/**
 * Client session lifecycle helpers.
 * Auth session lives in sessionStorage (cleared when the tab/window closes).
 * Role cookie is a browser session cookie (no Max-Age).
 */

import type { SessionUser } from "@/types/ict";
import { syncAccessRoleCookie } from "@/lib/auth/access";

export const AUTH_SESSION_KEY = "ict_platform_session";
/** Legacy persistent key — cleared whenever found. */
export const AUTH_SESSION_LEGACY_KEY = "ict_platform_session";
export const AUTH_ACTIVITY_KEY = "ict_session_activity";

/** Align with SessionTimeoutGuard inactivity window. */
export const SESSION_IDLE_LIMIT_MS = 5 * 60 * 1000;

export type SessionExpireReason = "expired" | "inactive" | "closed";

export function loginPathForSession(
  session: SessionUser | null | undefined,
  preferAdmin = false
): string {
  if (preferAdmin || session?.kind === "admin") return "/admin/login";
  return "/login";
}

export function loginUrlWithReason(
  path: string,
  reason?: SessionExpireReason | null
): string {
  if (!reason) return path;
  const url = new URL(path, typeof window !== "undefined" ? window.location.origin : "http://local");
  url.searchParams.set("reason", reason);
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function touchSessionActivity() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(AUTH_ACTIVITY_KEY, String(Date.now()));
  } catch {
    /* private mode / quota */
  }
}

export function readSessionActivityAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_ACTIVITY_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** True when last activity is older than the idle limit (tab left open too long). */
export function isSessionIdleExpired(now = Date.now()): boolean {
  const at = readSessionActivityAt();
  if (at == null) return false;
  return now - at > SESSION_IDLE_LIMIT_MS;
}

/** Drop any leftover persistent auth from older builds. */
export function clearLegacyPersistentAuth() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_SESSION_LEGACY_KEY);
    localStorage.removeItem("ict_platform_session");
    localStorage.removeItem("last_active_time");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_profile");
    localStorage.removeItem("auth_roles");
    localStorage.removeItem("currentRole");
  } catch {
    /* ignore */
  }
}

/** Clear client auth markers (sessionStorage + role cookie + legacy localStorage). */
export function clearClientAuthState() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    sessionStorage.removeItem(AUTH_ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
  clearLegacyPersistentAuth();
  syncAccessRoleCookie(null);
}

export function sessionExpireMessage(reason?: string | null): string | null {
  if (reason === "expired" || reason === "inactive" || reason === "closed") {
    return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง";
  }
  return null;
}
