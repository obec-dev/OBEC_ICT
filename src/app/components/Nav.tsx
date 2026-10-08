"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { accessRoleFromSession } from "@/lib/auth/access";
import { candidateCanAccessMissions } from "@/lib/examAccess";
import { useIctStore } from "@/contexts/IctStore";
import { SessionMenu } from "./SessionMenu";
import { ThemeToggle } from "./ThemeToggle";

const BRAND_LOGO = "/OBEC_ICT_Logo.jpg";

type NavItem = { href: string; label: string };

export function Nav() {
  const { session, isAdmin, examProgress, projects } = useIctStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const isLoggedIn = Boolean(session);
  const accessRole = accessRoleFromSession(session);
  const isCandidate = accessRole === "user" || accessRole === "school_admin";
  const showMissions = useMemo(
    () => candidateCanAccessMissions(session, examProgress, projects),
    [session, examProgress, projects]
  );
  const showLearnExam = isCandidate && !showMissions;

  const navItems = useMemo(() => {
    const items: NavItem[] = [{ href: "/dashboard", label: "ภาพรวมการลงทะเบียน" }];
    if (!isLoggedIn) items.push({ href: "/register/consent", label: "ลงทะเบียน" });
    if (showLearnExam) items.push({ href: "/portal/learn", label: "บทเรียนและแบบทดสอบ" });
    if (session?.kind === "business") items.push({ href: "/portal/business", label: "ภาพรวมโครงการ" });
    if (session?.kind === "audit") items.push({ href: "/portal/audit", label: "เขตที่ดูแล" });
    if (isAdmin) items.push({ href: "/admin", label: "ผู้ดูแลระบบ" });
    if (showMissions) items.push({ href: "/portal/missions", label: "ภารกิจ" });
    return items;
  }, [isAdmin, isLoggedIn, session?.kind, showLearnExam, showMissions]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="sticky top-0 z-50 w-full bg-white dark:bg-slate-950 opacity-100 shadow-md transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex items-center gap-3 md:gap-8 min-w-0">
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-[var(--primary-blue)] dark:text-white shrink-0"
              aria-label={menuOpen ? "ปิดเมนู" : "เปิดเมนู"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              )}
            </button>

            <Link href="/" className="flex items-center group shrink-0 min-w-0" aria-label="ICT Representative" onClick={closeMenu}>
              <Image
                src={BRAND_LOGO}
                alt="ICT Representative"
                width={220}
                height={48}
                className="h-10 md:h-12 w-auto max-w-[160px] sm:max-w-none object-contain"
                priority
              />
            </Link>

            <div className="hidden md:flex space-x-7 border-l-2 border-gray-100 dark:border-slate-700 pl-8 items-center">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            {session ? (
              <SessionMenu />
            ) : (
              <Link
                href="/login"
                className="bg-[var(--primary-solid)] text-white px-4 sm:px-6 py-2.5 rounded-full font-bold text-sm transition-all duration-300 hover:bg-[var(--accent-red)] hover:shadow-md hover:-translate-y-1 active:translate-y-0"
              >
                เข้าสู่ระบบ
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer — left side */}
      <div
        className={`md:hidden fixed inset-0 z-[60] transition-[visibility] duration-200 ${
          menuOpen ? "visible" : "invisible pointer-events-none"
        }`}
      >
        <button
          type="button"
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            menuOpen ? "opacity-100" : "opacity-0"
          }`}
          aria-label="ปิดเมนู"
          onClick={closeMenu}
        />
        <aside
          id="mobile-nav-drawer"
          className={`absolute top-0 left-0 h-full w-[min(86vw,20rem)] bg-white dark:bg-slate-950 shadow-2xl border-r border-gray-100 dark:border-slate-800 flex flex-col transition-transform duration-250 ease-out ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          role="dialog"
          aria-modal="true"
          aria-label="เมนูนำทาง"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-100 dark:border-slate-800">
            <span className="text-sm font-extrabold text-[var(--primary-blue)] dark:text-white">เมนู</span>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="ปิดเมนู"
              onClick={closeMenu}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMenu}
                className="block px-5 py-3.5 text-base font-semibold text-[var(--primary-blue)] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-gray-50 dark:border-slate-900"
              >
                {item.label}
              </Link>
            ))}
            {!isLoggedIn && (
              <Link
                href="/login"
                onClick={closeMenu}
                className="block mx-4 mt-4 text-center rounded-xl bg-[var(--primary-solid)] text-white px-4 py-3 font-bold text-sm"
              >
                เข้าสู่ระบบ
              </Link>
            )}
          </div>
        </aside>
      </div>
    </nav>
  );
}
