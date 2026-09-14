"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { ExecutiveProfileForm } from "@/app/components/executive/ExecutiveProfileForm";

export default function BusinessProfilePage() {
  return (
    <AuthGuard requireBusiness>
      <ExecutiveProfileForm kind="business" />
    </AuthGuard>
  );
}
