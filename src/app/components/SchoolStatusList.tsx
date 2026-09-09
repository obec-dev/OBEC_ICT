"use client";

import type { School } from "@/types/ict";

export function SchoolStatusList({ schools }: { schools: School[] }) {
  return (
    <ul className="mt-3 space-y-2 rounded-2xl bg-white border border-gray-100 p-4 shadow-sm">
      {schools.map((school) => {
        const count = school.registered_count ?? 0;
        return (
          <li
            key={school.school_id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2 rounded-xl hover:bg-gray-50"
          >
            <div>
              <div className="font-semibold text-gray-800">
                {school.school_name}
                {count > 0 ? (
                  <span className="text-gray-500 font-medium"> ({count})</span>
                ) : null}
              </div>
              <div className="text-xs text-gray-500">{school.province}</div>
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
