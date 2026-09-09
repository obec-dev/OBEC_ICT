"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** First-time password setup uses the same flow as reset password. */
export default function SetupPasswordRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login/reset-password");
  }, [router]);
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-500">
      กำลังเปิดหน้าตั้งรหัสผ่าน...
    </div>
  );
}
