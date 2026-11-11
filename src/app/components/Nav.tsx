"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { accessRoleFromSession } from "@/lib/auth/access";
import {
  adminNavGroupHasActive,
  isAdminNavHrefActive,
  visibleAdminNavGroups,
  type AdminNavGroup,
} from "@/lib/adminNav";
import { useIctStore } from "@/contexts/IctStore";
import { getProjectExamStatus, getSiteProject } from "@/lib/siteSettings";
import type { AdminRole } from "@/types/ict";
import { NotificationBell } from "./NotificationBell";
import { SessionMenu } from "./SessionMenu";
import { ThemeToggle } from "./ThemeToggle";

const BRAND_LOGO = "/OBEC_ICT_Logo.jpg";

type NavItem = { href: string; label: string };

function AdminDesktopMenus({
  groups,
  pathname,
}: {
  groups: AdminNavGroup[];
  pathname: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpenId(null);
  }, [pathname]);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpenId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openId]);

  const itemClass = (active: boolean) =>
    `shrink-0 whitespace-nowrap text-sm font-semibold transition-colors px-2.5 py-1.5 rounded-lg ${
      active
        ? "text-[var(--accent-red)] bg-red-50 dark:bg-red-950/40"
        : "text-[var(--primary-blue)] dark:text-white hover:text-[var(--accent-red)] hover:bg-slate-50 dark:hover:bg-slate-900"
    }`;

  return (
    <div ref={rootRef} className="flex flex-nowrap items-center gap-0.5 lg:gap-1">
      {groups.map((g) => {
        if (g.href) {
          const active = isAdminNavHrefActive(pathname, g.href);
          return (
            <Link key={g.id} href={g.href} className={itemClass(active)}>
              {g.label}
            </Link>
          );
        }
        const open = openId === g.id;
        const active = adminNavGroupHasActive(pathname, g);
        return (
          <div key={g.id} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="menu"
              className={`${itemClass(active || open)} inline-flex items-center gap-0.5`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenId((prev) => (prev === g.id ? null : g.id));
              }}
            >
              {g.label}
              <span className="text-[10px] opacity-70" aria-hidden>
                ▾
              </span>
            </button>
            {open && (
              <div
                role="menu"
                className="absolute left-0 top-full z-[80] mt-1 min-w-[180px] rounded-xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-lg p-1.5"
              >
                {(g.items ?? []).map((l) => {
                  const itemActive = isAdminNavHrefActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      role="menuitem"
                      className={`block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${
                        itemActive
                          ? "bg-[var(--primary-solid)] text-white"
                          : "text-[var(--primary-blue)] dark:text-white hover:bg-gray-50 dark:hover:bg-slate-900"
                      }`}
                      onClick={() => setOpenId(null)}
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminMobileMenus({
  groups,
  pathname,
  onNavigate,
}: {
  groups: AdminNavGroup[];
  pathname: string;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      {groups.map((g) => {
        if (g.href) {
          return (
            <Link
              key={g.id}
              href={g.href}
              onClick={onNavigate}
              className="block px-5 py-3.5 text-base font-semibold text-[var(--primary-blue)] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-gray-50 dark:border-slate-900"
            >
              {g.label}
            </Link>
          );
        }
        const open = expanded === g.id || adminNavGroupHasActive(pathname, g);
        return (
          <div key={g.id} className="border-b border-gray-50 dark:border-slate-900">
            <button
              type="button"
              className="w-full text-left px-5 py-3.5 text-base font-extrabold text-[var(--primary-blue)] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-900"
              onClick={() => setExpanded((prev) => (prev === g.id ? null : g.id))}
            >
              {g.label}
            </button>
            {open &&
              (g.items ?? []).map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={onNavigate}
                  className="block pl-8 pr-5 py-3 text-sm font-semibold text-[var(--primary-blue)] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  {l.label}
                </Link>
              ))}
          </div>
        );
      })}
    </>
  );
}

export function Nav() {
  const pathname = usePathname();
  const { session, isAdmin, adminUser, projects } = useIctStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const isLoggedIn = Boolean(session);
  const accessRole = accessRoleFromSession(session);
  const isCandidate = accessRole === "user" || accessRole === "school_admin";
  const examOpen = useMemo(() => {
    const site = getSiteProject(projects);
    if (!site) return false;
    return getProjectExamStatus(site).open;
  }, [projects]);

  const adminRole: AdminRole = adminUser?.role ?? "admin";
  const adminGroups = useMemo(
    () => (isAdmin ? visibleAdminNavGroups(adminRole) : []),
    [isAdmin, adminRole]
  );

  const navItems = useMemo(() => {
    // Admin session: site bar shows admin menu only (not dashboard / news / single admin link).
    if (isAdmin) return [] as NavItem[];

    const items: NavItem[] = [
      { href: "/dashboard", label: "ภาพรวมการลงทะเบียน" },
      { href: "/news", label: "ข่าว" },
    ];
    if (!isLoggedIn) items.push({ href: "/register/consent", label: "ลงทะเบียน" });
    if (isCandidate) {
      if (examOpen) items.push({ href: "/portal/learn", label: "บทเรียนและแบบทดสอบ" });
      items.push({ href: "/portal/e-learning", label: "E-learning" });
      items.push({ href: "/portal/activity", label: "กิจกรรม" });
    }
    if (session?.kind === "business") items.push({ href: "/portal/business", label: "ภาพรวมโครงการ" });
    if (session?.kind === "audit") items.push({ href: "/portal/audit", label: "เขตที่ดูแล" });
    return items;
  }, [isAdmin, isLoggedIn, isCandidate, session?.kind, examOpen]);

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
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div
          className={`flex justify-between items-center gap-2 ${
            isAdmin ? "h-14 md:h-16" : "h-20"
          }`}
        >
          <div className={`flex items-center min-w-0 ${isAdmin ? "gap-2 md:gap-3 flex-1" : "gap-3 md:gap-8"}`}>
            <button
              type="button"
              className="md:hidden inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-[var(--primary-blue)] dark:text-white shrink-0"
              aria-label={menuOpen ? "ปิดเมนู" : "เปิดเมนู"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              )}
            </button>

            <Link
              href={isAdmin ? "/admin" : "/"}
              className="flex items-center group shrink-0"
              aria-label="ICT Representative"
              onClick={closeMenu}
            >
              <Image
                src={BRAND_LOGO}
                alt="ICT Representative"
                width={220}
                height={48}
                className={`w-auto object-contain ${
                  isAdmin
                    ? "h-8 md:h-9 max-w-[120px] md:max-w-[140px]"
                    : "h-10 md:h-12 max-w-[160px] sm:max-w-none"
                }`}
                priority
              />
            </Link>

            <div
              className={`hidden md:flex items-center ${
                isAdmin
                  ? "flex-1 overflow-visible border-l border-gray-100 dark:border-slate-700 pl-3 ml-1"
                  : "space-x-7 border-l-2 border-gray-100 dark:border-slate-700 pl-8"
              }`}
            >
              {isAdmin ? (
                <AdminDesktopMenus groups={adminGroups} pathname={pathname} />
              ) : (
                navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-lg font-semibold text-[var(--primary-blue)] hover:text-[var(--accent-red)] transition-colors py-2 whitespace-nowrap"
                  >
                    {item.label}
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <ThemeToggle />
            {session ? <NotificationBell /> : null}
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
            <span className="text-sm font-extrabold text-[var(--primary-blue)] dark:text-white">
              {isAdmin ? "เมนูผู้ดูแล" : "เมนู"}
            </span>
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
            {isAdmin ? (
              <AdminMobileMenus groups={adminGroups} pathname={pathname} onNavigate={closeMenu} />
            ) : (
              navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMenu}
                  className="block px-5 py-3.5 text-base font-semibold text-[var(--primary-blue)] dark:text-white hover:bg-slate-50 dark:hover:bg-slate-900 border-b border-gray-50 dark:border-slate-900"
                >
                  {item.label}
                </Link>
              ))
            )}
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
