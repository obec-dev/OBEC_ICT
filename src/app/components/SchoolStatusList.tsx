"use client";

import type { School } from "@/types/ict";

export function SchoolStatusList({ schools }: { schools: School[] }) {
  return (
    <ul className="mt-3 space-y-2 rounded-2xl bg-white dark:bg-[var(--card-bg)] border border-gray-100 dark:border-[var(--border-soft)] p-4 shadow-sm">
      {schools.map((school) => {
        const count = school.registered_count ?? 0;
        const districtLabel = school.area_zone || school.province;
        return (
          <li
            key={school.school_id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800/60"
          >
            <div>
              <div className="text-base font-semibold text-gray-800 dark:text-white">
                {school.school_name}
                <span className="text-gray-500 dark:text-white/80 font-medium"> ({count})</span>
              </div>
              <div className="text-sm text-gray-500 dark:text-white/90 mt-0.5">{districtLabel}</div>
            </div>
            {school.is_registered ? (
              <span className="inline-flex w-fit items-center rounded-full bg-[var(--accent-green)]/15 text-[var(--accent-green)] px-3 py-1 text-xs font-bold">
                ลงทะเบียนแล้ว
              </span>
            ) : (
              <span className="inline-flex w-fit items-center rounded-full bg-[var(--accent-red)]/15 text-[var(--accent-red)] px-3 py-1 text-xs font-bold">
                ยังไม่ลงทะเบียน
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
