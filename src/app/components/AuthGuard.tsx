"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  accessRoleFromSession,
  canAccessPath,
  homePathForSession,
  syncAccessRoleCookie,
} from "@/lib/auth/access";
import { useIctStore } from "@/contexts/IctStore";
import type { AdminRole, PortalRole } from "@/types/ict";

type AuthGuardProps = {
  children: React.ReactNode;
  /** Require any authenticated session */
  requireAuth?: boolean;
  requireAdmin?: boolean;
  requireRoles?: AdminRole[];
  /** Portal candidate roles allowed (user / school_admin) */
  requirePortalRoles?: PortalRole[];
  /** Require business executive session */
  requireBusiness?: boolean;
  /** Require audit executive session */
  requireAudit?: boolean;
  /** Require school_admin (portal_role or is_school_admin) */
  requireSchoolAdmin?: boolean;
  allowPasswordChange?: boolean;
  allowPasswordSetup?: boolean;
  /** Override deny redirect (default: role home) */
  denyRedirect?: string;
};

function Spinner() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--primary-blue)]" />
    </div>
  );
}

export function AuthGuard({
  children,
  requireAuth = false,
  requireAdmin = false,
  requireRoles,
  requirePortalRoles,
  requireBusiness = false,
  requireAudit = false,
  requireSchoolAdmin = false,
  allowPasswordChange = false,
  allowPasswordSetup = false,
  denyRedirect,
}: AuthGuardProps) {
  const { hydrated, session, isAdmin } = useIctStore();
  const router = useRouter();

  const needsLogin =
    requireAuth ||
    requireAdmin ||
    Boolean(requireRoles?.length) ||
    Boolean(requirePortalRoles?.length) ||
    requireBusiness ||
    requireAudit ||
    requireSchoolAdmin;

  useEffect(() => {
    if (!hydrated) return;

    if (!session) {
      if (needsLogin) {
        // After tab close, sessionStorage is empty — clear stale role cookie and prompt re-login
        const hadRoleCookie =
          typeof document !== "undefined" &&
          document.cookie.split(";").some((c) => c.trim().startsWith("ict_access_role="));
        if (hadRoleCookie) syncAccessRoleCookie(null);
        const loginPath = requireAdmin ? "/admin/login" : "/login";
        router.replace(hadRoleCookie ? `${loginPath}?reason=closed` : loginPath);
      }
      return;
    }

    if (
      requireAdmin &&
      session.kind === "admin" &&
      session.admin.must_change_password &&
      !allowPasswordChange
    ) {
      router.replace("/admin/change-password");
      return;
    }

    if (
      session.kind === "candidate" &&
      session.candidate.must_set_password &&
      !allowPasswordSetup
    ) {
      const email = session.candidate.login_email || session.candidate.email || "";
      router.replace(`/login/reset-password?email=${encodeURIComponent(email)}&first=1`);
      return;
    }

    if (
      (session.kind === "business" || session.kind === "audit") &&
      session.user.must_set_password &&
      !allowPasswordSetup
    ) {
      router.replace(
        `/login/executive-setup?kind=${session.kind}&id=${encodeURIComponent(session.user.login_email)}`
      );
      return;
    }

    const deny = denyRedirect || homePathForSession(session);

    if (requireAdmin && !isAdmin) {
      router.replace("/admin/login");
      return;
    }
    if (requireRoles && session.kind === "admin" && !requireRoles.includes(session.admin.role)) {
      router.replace("/admin");
      return;
    }
    if (requireBusiness && session.kind !== "business") {
      router.replace(deny);
      return;
    }
    if (requireAudit && session.kind !== "audit") {
      router.replace(deny);
      return;
    }
    if (requireSchoolAdmin) {
      if (session.kind !== "candidate") {
        router.replace(deny);
        return;
      }
      const role = session.candidate.portal_role ?? "user";
      const ok = role === "school_admin" || Boolean(session.candidate.is_school_admin);
      if (!ok) {
        router.replace("/portal/profile");
        return;
      }
    }
    if (requirePortalRoles) {
      if (session.kind !== "candidate") {
        router.replace(deny);
        return;
      }
      const role = session.candidate.portal_role ?? "user";
      if (!requirePortalRoles.includes(role)) {
        router.replace(deny);
        return;
      }
    }

    // Soft matrix check when only requireAuth (role home pages)
    if (requireAuth && !requireAdmin && !requireBusiness && !requireAudit && !requirePortalRoles && !requireSchoolAdmin) {
      const path = typeof window !== "undefined" ? window.location.pathname : "";
      if (path && !canAccessPath(accessRoleFromSession(session), path)) {
        router.replace(deny);
      }
    }
  }, [
    allowPasswordChange,
    allowPasswordSetup,
    denyRedirect,
    hydrated,
    isAdmin,
    needsLogin,
    requireAdmin,
    requireAudit,
    requireAuth,
    requireBusiness,
    requirePortalRoles,
    requireRoles,
    requireSchoolAdmin,
    router,
    session,
  ]);

  if (!hydrated) return <Spinner />;

  if (!session) {
    if (needsLogin) return null;
    return <>{children}</>;
  }

  if (
    requireAdmin &&
    session.kind === "admin" &&
    session.admin.must_change_password &&
    !allowPasswordChange
  ) {
    return null;
  }
  if (session.kind === "candidate" && session.candidate.must_set_password && !allowPasswordSetup) {
    return null;
  }
  if (
    (session.kind === "business" || session.kind === "audit") &&
    session.user.must_set_password &&
    !allowPasswordSetup
  ) {
    return null;
  }
  if (requireAdmin && !isAdmin) return null;
  if (requireRoles && session.kind === "admin" && !requireRoles.includes(session.admin.role)) {
    return null;
  }
  if (requireBusiness && session.kind !== "business") return null;
  if (requireAudit && session.kind !== "audit") return null;
  if (requireSchoolAdmin) {
    if (session.kind !== "candidate") return null;
    const role = session.candidate.portal_role ?? "user";
    if (role !== "school_admin" && !session.candidate.is_school_admin) return null;
  }
  if (requirePortalRoles) {
    if (session.kind !== "candidate") return null;
    const role = session.candidate.portal_role ?? "user";
    if (!requirePortalRoles.includes(role)) return null;
  }

  return <>{children}</>;
}
