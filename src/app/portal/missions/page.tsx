"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/app/components/AuthGuard";

/** Missions retired — redirect to activity hub. */
function MissionsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/portal/activity");
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-400">
      กำลังไปหน้ากิจกรรม...
    </div>
  );
}

export default function PortalMissionsPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <MissionsRedirect />
    </AuthGuard>
  );
}
