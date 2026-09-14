"use client";

import { Suspense } from "react";
import ExecutiveSetupPasswordForm from "./ExecutiveSetupPasswordForm";

export default function ExecutiveSetupPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-md mx-auto px-4 py-16 text-center text-gray-500">กำลังโหลด...</div>
      }
    >
      <ExecutiveSetupPasswordForm />
    </Suspense>
  );
}
