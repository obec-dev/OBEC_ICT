"use client";

import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-500">
          กำลังโหลด...
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
