"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { ActivityProfileHub } from "@/app/components/ActivityProfileHub";
import { useIctStore } from "@/contexts/IctStore";
import Link from "next/link";

function ActivityContent() {
  const { session } = useIctStore();
  const candidate = session?.kind === "candidate" ? session.candidate : null;

  if (!candidate) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">หน้ากิจกรรมสำหรับผู้สมัครตัวแทน ICT Talent</p>
        <Link href="/" className="px-6 py-2.5 bg-[var(--primary-blue)] text-white rounded-full font-bold">
          กลับหน้าหลัก
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white">กิจกรรม</h1>
          <p className="text-sm text-gray-500 mt-1">ภารกิจ · คะแนน · E-learning · Live · อันดับ</p>
        </div>
        <Link
          href="/portal/profile"
          className="text-sm font-bold underline text-[var(--primary-blue)]"
        >
          ตั้งค่าโปรไฟล์ส่วนตัว
        </Link>
      </div>
      <ActivityProfileHub candidate={candidate} />
    </div>
  );
}

export default function PortalActivityPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <ActivityContent />
    </AuthGuard>
  );
}
