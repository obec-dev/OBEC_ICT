"use client";

import Link from "next/link";
import { useMemo } from "react";
import { accessRoleFromSession } from "@/lib/auth/access";
import { useIctStore } from "@/contexts/IctStore";
import { SessionMenu } from "./SessionMenu";
import { ThemeToggle } from "./ThemeToggle";
import { getSiteProject } from "@/lib/siteSettings";

export function Nav() {
  const { session, isAdmin, examProgress, projects } = useIctStore();
  const isLoggedIn = Boolean(session);
  const accessRole = accessRoleFromSession(session);

  const showMissions = useMemo(() => {
    if (session?.kind !== "candidate") return false;
    if (accessRole !== "user" && accessRole !== "school_admin") return false;
    const project = getSiteProject(projects);
    if (!project?.enable_results_visibility) return false;
    const exam = examProgress.find(
      (e) =>
        e.candidate_id === session.candidate.id &&
        (!project.id || e.project_id === project.id || !e.project_id)
    );
    return Boolean(exam?.passed === true && exam?.graded_at);
  }, [accessRole, session, examProgress, projects]);

  const isCandidate = accessRole === "user" || accessRole === "school_admin";

  return (
    <nav className="sticky top-0 z-50 w-full bg-white dark:bg-slate-950 opacity-100 shadow-md transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center group">
              <span className="text-xl md:text-2xl font-extrabold text-[var(--primary-blue)] tracking-tight">
                ICT <span className="text-[var(--accent-red)]">Representative</span>
              </span>
            </Link>

            <div className="hidden md:flex space-x-7 border-l-2 border-gray-100 dark:border-slate-700 pl-8 items-center">
              <Link
                href="/dashboard"
                className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
              >
                ภาพรวมการลงทะเบียน
              </Link>
              {!isLoggedIn && (
                <Link
                  href="/register/consent"
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ลงทะเบียน
                </Link>
              )}
              {isCandidate && (
                <>
                  <Link
                    href="/portal/learn"
                    className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                  >
                    บทเรียน
                  </Link>
                  <Link
                    href="/portal/exam"
                    className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                  >
                    ข้อสอบ
                  </Link>
                </>
              )}
              {session?.kind === "business" && (
                <Link
                  href="/portal/business"
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ภาพรวมโครงการ
                </Link>
              )}
              {session?.kind === "audit" && (
                <Link
                  href="/portal/audit"
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  เขตที่ดูแล
                </Link>
              )}
              {isAdmin && (
                <Link
                  href="/admin"
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ผู้ดูแลระบบ
                </Link>
              )}
              {showMissions && (
                <Link
                  href="/portal/missions"
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  ภารกิจ
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
