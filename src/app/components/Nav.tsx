"use client";

import Link from "next/link";
import { useIctStore } from "@/contexts/IctStore";
import { SessionMenu } from "./SessionMenu";
import { ThemeToggle } from "./ThemeToggle";

export function Nav() {
  const { session, isAdmin } = useIctStore();
  const isLoggedIn = Boolean(session);

  return (
    <nav className="sticky top-0 z-50 w-full glass-effect transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center group">
              <span className="text-lg md:text-xl font-extrabold text-[var(--primary-blue)] tracking-tight">
                ICT <span className="text-[var(--accent-red)]">Representative</span>
              </span>
            </Link>

            <div className="hidden md:flex space-x-6 border-l-2 border-gray-100 dark:border-slate-700 pl-8 items-center">
              <Link
                href="/dashboard"
                className="text-[var(--primary-blue)] font-medium hover:text-[var(--accent-red)] transition-colors py-2"
              >
                ภาพรวม
              </Link>
              {!isLoggedIn && (
                <Link
                  href="/register/consent"
                  className="text-[var(--primary-blue)] font-medium hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ลงทะเบียน
                </Link>
              )}
              {session?.kind === "candidate" && (
                <>
                  <Link
                    href="/portal/learn"
                    className="text-[var(--primary-blue)] font-medium hover:text-[var(--accent-red)] transition-colors py-2"
                  >
                    บทเรียน
                  </Link>
                  <Link
                    href="/portal/exam"
                    className="text-[var(--primary-blue)] font-medium hover:text-[var(--accent-red)] transition-colors py-2"
                  >
                    ข้อสอบ
                  </Link>
                </>
              )}
              {isAdmin && (
                <Link
                  href="/admin"
                  className="text-[var(--primary-blue)] font-medium hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ผู้ดูแลระบบ
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            {session ? (
              <SessionMenu />
            ) : (
              <Link
                href="/login"
                className="bg-[var(--primary-solid)] text-white px-6 py-2.5 rounded-full font-bold text-sm transition-all duration-300 hover:bg-[var(--accent-red)] hover:shadow-md hover:-translate-y-1 active:translate-y-0"
              >
                เข้าสู่ระบบ
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
