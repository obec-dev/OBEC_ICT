"use client";

import Link from "next/link";
import type { PeriodStatus } from "@/lib/siteSettings";
import { formatDateTimeTh, hasScheduleDate } from "@/lib/siteSettings";

export function PeriodClosedNotice({
  title,
  status,
  homeHref = "/",
}: {
  title: string;
  status: PeriodStatus;
  homeHref?: string;
}) {
  const showStart = hasScheduleDate(status.start);
  const showEnd = hasScheduleDate(status.end);

  return (
    <div className="max-w-xl mx-auto px-4 py-16 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 text-center">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-3">{title}</h1>
        <p className="text-gray-600 mb-4">{status.message}</p>

        {(showStart || showEnd) ? (
          <div className="text-sm text-gray-500 mb-8 space-y-1">
            {showStart && <div>เริ่ม: {formatDateTimeTh(status.start)}</div>}
            {showEnd && <div>สิ้นสุด: {formatDateTimeTh(status.end)}</div>}
          </div>
        ) : (
          <div className="mb-8">
            <span className="inline-block text-xs font-bold tracking-wide text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-3 py-1">
              ยังไม่กำหนดวัน
            </span>
          </div>
        )}

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
