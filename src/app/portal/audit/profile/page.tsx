"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { ExecutiveProfileForm } from "@/app/components/executive/ExecutiveProfileForm";

export default function AuditProfilePage() {
  return (
    <AuthGuard requireAudit>
      <ExecutiveProfileForm kind="audit" />
    </AuthGuard>
  );
}
