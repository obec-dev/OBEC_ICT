import type { PortalRole, SessionUser } from "@/types/ict";

/** Cookie used by middleware for coarse role-based path redirects (not a secret). */
export const ACCESS_ROLE_COOKIE = "ict_access_role";

export type AccessRole =
  | "user"
  | "school_admin"
  | "business"
  | "audit"
  | "admin"
  | "guest";

/** Paths each authenticated portal role may enter (prefix match). */
const ROLE_PATH_PREFIXES: Record<Exclude<AccessRole, "guest">, string[]> = {
  user: ["/dashboard", "/portal/learn", "/portal/exam", "/portal/profile", "/portal/missions"],
  school_admin: [
    "/dashboard",
    "/portal/learn",
    "/portal/exam",
    "/portal/profile",
    "/portal/school-profile",
    "/portal/missions",
  ],
  business: ["/dashboard", "/portal/business"],
  audit: ["/dashboard", "/portal/audit"],
  admin: ["/dashboard", "/admin"],
};

/** /dashboard is a public district overview — guests do not need to sign in. */
const PROTECTED_PREFIXES = ["/portal", "/admin"];

export function accessRoleFromSession(session: SessionUser | null | undefined): AccessRole {
  if (!session) return "guest";
  if (session.kind === "admin") return "admin";
  if (session.kind === "business") return "business";
  if (session.kind === "audit") return "audit";
  const role = (session.candidate.portal_role ?? "user") as PortalRole;
  if (role === "school_admin" || session.candidate.is_school_admin) return "school_admin";
  return "user";
}

export function homePathForAccessRole(role: AccessRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "business":
      return "/portal/business";
    case "audit":
      return "/portal/audit";
    case "user":
    case "school_admin":
      return "/dashboard";
    default:
      return "/";
  }
}

export function homePathForSession(session: SessionUser | null | undefined): string {
  return homePathForAccessRole(accessRoleFromSession(session));
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function pathAllowed(prefixes: string[], pathname: string): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Whether this access role may open the given pathname. */
export function canAccessPath(role: AccessRole, pathname: string): boolean {
  if (!isProtectedPath(pathname)) return true;
  if (role === "guest") return false;
  // Admin change-password etc. under /admin
  if (role === "admin") return pathAllowed(ROLE_PATH_PREFIXES.admin, pathname);
  return pathAllowed(ROLE_PATH_PREFIXES[role], pathname);
}

export function syncAccessRoleCookie(session: SessionUser | null | undefined) {
  if (typeof document === "undefined") return;
  const role = accessRoleFromSession(session);
  if (role === "guest") {
    document.cookie = `${ACCESS_ROLE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  // 7 days — refreshed on each login / hydrate
  document.cookie = `${ACCESS_ROLE_COOKIE}=${encodeURIComponent(role)}; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax`;
}

export function parseAccessRoleCookie(value: string | undefined | null): AccessRole {
  const v = (value || "").trim().toLowerCase();
  if (
    v === "user" ||
    v === "school_admin" ||
    v === "business" ||
    v === "audit" ||
    v === "admin"
  ) {
    return v;
  }
  return "guest";
}

export function ctaForSession(session: SessionUser | null | undefined): {
  href: string;
  label: string;
} {
  const role = accessRoleFromSession(session);
  switch (role) {
    case "admin":
      return { href: "/admin", label: "เข้าสู่ศูนย์ผู้ดูแล" };
    case "business":
      return { href: "/portal/business", label: "แดชบอร์ด Business" };
    case "audit":
      return { href: "/portal/audit", label: "แดชบอร์ด Audit" };
    case "school_admin":
      return { href: "/portal/profile", label: "จัดการโปรไฟล์" };
    case "user":
      return { href: "/portal/profile", label: "จัดการโปรไฟล์" };
    default:
      return { href: "/register/consent", label: "ลงทะเบียนตัวแทน" };
  }
}
