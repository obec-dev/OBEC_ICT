"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/app/components/AuthGuard";

/**
 * Dedicated school-profile route for school_admin.
 * Dual-tab UX lives under Profile Settings — this path opens the school tab.
 */
function SchoolProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/profile?tab=school");
  }, [router]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-gray-500 dark:text-slate-400">
      กำลังเปิดตั้งค่าโปรไฟล์สถานศึกษา...
    </div>
  );
}

export default function SchoolProfilePage() {
  return (
    <AuthGuard requireSchoolAdmin>
      <Suspense
        fallback={
          <div className="max-w-3xl mx-auto px-4 py-12 text-gray-500 dark:text-slate-400">
            กำลังโหลด...
          </div>
        }
      >
        <SchoolProfileRedirect />
      </Suspense>
    </AuthGuard>
  );
}
