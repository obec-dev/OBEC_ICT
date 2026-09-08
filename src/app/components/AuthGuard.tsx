"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import type { AdminRole } from "@/types/ict";

type AuthGuardProps = {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireRoles?: AdminRole[];
  /** Allow access even when must_change_password is true */
  allowPasswordChange?: boolean;
};

export function AuthGuard({
  children,
  requireAdmin = false,
  requireRoles,
  allowPasswordChange = false,
}: AuthGuardProps) {
  const { hydrated, session, isAdmin } = useIctStore();
  const router = useRouter();

  useEffect(() => {
    if (!hydrated) return;
    if (!session) {
      router.replace(requireAdmin ? "/admin/login" : "/login");
      return;
    }
    if (requireAdmin && !isAdmin) {
      router.replace("/admin/login");
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
    if (requireRoles && session.kind === "admin" && !requireRoles.includes(session.admin.role)) {
      router.replace("/admin");
    }
  }, [allowPasswordChange, hydrated, isAdmin, requireAdmin, requireRoles, router, session]);

  if (!hydrated) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--primary-blue)]" />
      </div>
    );
  }

  if (!session) return null;
  if (requireAdmin && !isAdmin) return null;
  if (
    requireAdmin &&
    session.kind === "admin" &&
    session.admin.must_change_password &&
    !allowPasswordChange
  ) {
    return null;
  }
  if (requireRoles && session.kind === "admin" && !requireRoles.includes(session.admin.role)) {
    return null;
  }

  return <>{children}</>;
}
