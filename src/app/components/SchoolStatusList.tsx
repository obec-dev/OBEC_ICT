"use client";

import type { School } from "@/types/ict";

export function SchoolStatusList({ schools }: { schools: School[] }) {
  return (
    <ul className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 rounded-xl bg-white dark:bg-[var(--card-bg)] border border-gray-100 dark:border-[var(--border-soft)] p-3 shadow-sm">
      {schools.map((school) => {
        const count = school.registered_count ?? 0;
        return (
          <li
            key={school.school_id}
            className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/60"
          >
            <div className="min-w-0 text-sm font-semibold text-gray-800 dark:text-white leading-snug">
              {school.school_name}
              <span className="text-gray-500 dark:text-white/80 font-medium"> ({count})</span>
            </div>
            {school.is_registered ? (
              <span className="inline-flex shrink-0 w-fit items-center rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] px-2.5 py-0.5 text-[11px] font-bold">
                ลงทะเบียนแล้ว
              </span>
            ) : (
              <span className="inline-flex shrink-0 w-fit items-center rounded-full bg-[var(--accent-red)]/15 text-[var(--accent-red)] px-2.5 py-0.5 text-[11px] font-bold">
                ยังไม่ลงทะเบียน
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
