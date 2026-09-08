"use client";

import { useState } from "react";
import Link from "next/link";
import { useIctStore } from "@/contexts/IctStore";
import { EditProfileModal } from "./EditProfileModal";

export function SessionMenu() {
  const { session, logout } = useIctStore();
  const [open, setOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  if (!session) return null;

  const label = session.kind === "admin" ? session.admin.full_name : session.candidate.full_name;
  const initials = label.slice(0, 1);

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 rounded-full bg-white/80 px-3 py-1.5 border border-gray-100 hover:shadow-md transition-all"
        >
          <span className="w-9 h-9 rounded-full bg-[var(--primary-blue)] text-white flex items-center justify-center font-bold">
            {initials}
          </span>
          <span className="hidden sm:block text-sm font-semibold text-[var(--primary-blue)] max-w-[140px] truncate">
            {label}
          </span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg py-1 border border-gray-100 z-50 animate-scale-up">
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
              onClick={() => {
                setOpen(false);
                setShowEditModal(true);
              }}
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              แก้ไขโปรไฟล์
            </button>
            {session.kind === "admin" && (
              <Link
                href="/admin"
                className="px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 font-medium"
                onClick={() => setOpen(false)}
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                หน้าผู้ดูแล
              </Link>
            )}
            <div className="my-1 border-t border-gray-100" />
            <button
              type="button"
              className="w-full text-left px-4 py-2.5 text-sm text-[var(--accent-red)] hover:bg-red-50 flex items-center gap-2 font-medium"
              onClick={() => {
                setOpen(false);
                logout();
              }}
            >
              <svg className="w-4 h-4 text-[var(--accent-red)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              ออกจากระบบ
            </button>
          </div>
        )}
      </div>

      <EditProfileModal isOpen={showEditModal} onClose={() => setShowEditModal(false)} />
    </>
  );
}
