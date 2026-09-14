"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { AuditDashboard } from "@/app/components/executive/AuditDashboard";

export default function AuditPortalPage() {
  return (
    <AuthGuard requireAudit>
      <AuditDashboard />
    </AuthGuard>
  );
}
