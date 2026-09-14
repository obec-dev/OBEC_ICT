"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { BusinessDashboard } from "@/app/components/executive/BusinessDashboard";

export default function BusinessPortalPage() {
  return (
    <AuthGuard requireBusiness>
      <BusinessDashboard />
    </AuthGuard>
  );
}
