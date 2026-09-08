"use client";

import Link from "next/link";
import type { PeriodStatus } from "@/lib/siteSettings";
import { formatDateTimeTh } from "@/lib/siteSettings";

export function PeriodClosedNotice({
  title,
  status,
  homeHref = "/",
}: {
  title: string;
  status: PeriodStatus;
  homeHref?: string;
}) {
  return (
    <div className="max-w-xl mx-auto px-4 py-16 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 text-center">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-3">{title}</h1>
        <p className="text-gray-600 mb-4">{status.message}</p>
        <div className="text-sm text-gray-500 mb-8 space-y-1">
          <div>เริ่ม: {formatDateTimeTh(status.start)}</div>
          <div>สิ้นสุด: {formatDateTimeTh(status.end)}</div>
        </div>
        <Link
          href={homeHref}
          className="inline-block rounded-full bg-[var(--primary-blue)] text-white px-8 py-3 font-bold"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
