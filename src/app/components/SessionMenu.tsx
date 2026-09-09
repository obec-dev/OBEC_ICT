"use client";

import { useState } from "react";
import Link from "next/link";
import { useIctStore } from "@/contexts/IctStore";

export function SessionMenu() {
  const { session, logout } = useIctStore();
  const [open, setOpen] = useState(false);

  if (!session) return null;

  const label = session.kind === "admin" ? session.admin.full_name : session.candidate.full_name;
  const initials = label.slice(0, 1);
  const profileHref = session.kind === "admin" ? "/admin/change-password" : "/portal/profile";
  const profileLabel = session.kind === "admin" ? "เปลี่ยนรหัสผ่าน" : "จัดการโปรไฟล์";
  const roleLabel = session.kind === "admin" ? session.admin.role : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 rounded-full bg-white/80 dark:bg-slate-800/90 px-3 py-1.5 border border-gray-100 dark:border-slate-600 hover:shadow-md transition-all"
      >
        <span className="w-9 h-9 rounded-full bg-[var(--primary-solid)] text-white flex items-center justify-center font-bold">
          {initials}
        </span>
        <span className="hidden sm:flex flex-col items-start text-left leading-tight max-w-[140px]">
          <span className="text-sm font-semibold text-[var(--primary-blue)] truncate w-full">{label}</span>
          {roleLabel && <span className="text-[10px] font-medium text-gray-500 dark:text-slate-400">{roleLabel}</span>}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-lg py-1 border border-gray-100 dark:border-slate-700 z-50 animate-scale-up">
          <Link
            href={profileHref}
            className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
            onClick={() => setOpen(false)}
          >
            {profileLabel}
          </Link>
          {session.kind === "admin" && (
            <Link
              href="/admin"
              className="px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2 font-medium"
              onClick={() => setOpen(false)}
            >
              หน้าผู้ดูแล
            </Link>
          )}
          <div className="my-1 border-t border-gray-100 dark:border-slate-700" />
          <button
            type="button"
            className="w-full text-left px-4 py-2.5 text-sm text-[var(--accent-red)] hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 font-medium"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      )}
    </div>
  );
}
