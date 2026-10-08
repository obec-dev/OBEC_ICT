"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import type { AdminRole } from "@/types/ict";

const links: { href: string; label: string; roles: AdminRole[] }[] = [
  { href: "/admin", label: "เมนูหลัก", roles: ["admin", "super_admin"] },
  { href: "/admin/overview", label: "ภาพรวมผู้ดูแลระบบ", roles: ["admin", "super_admin"] },
  { href: "/admin/projects", label: "จัดการ - โครงการ", roles: ["admin", "super_admin"] },
  { href: "/admin/users", label: "จัดการ - ผู้ใช้งาน", roles: ["admin", "super_admin"] },
  { href: "/admin/candidates", label: "จัดการ - การส่งข้อสอบ", roles: ["admin", "super_admin"] },
  { href: "/admin/config", label: "ตั้งค่าเว็บไซต์", roles: ["super_admin"] },
  { href: "/admin/admins", label: "จัดการผู้ดูแล", roles: ["super_admin"] },
  { href: "/admin/audit", label: "Audit logs", roles: ["super_admin"] },
];

function isActiveHref(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  const { adminUser, isSuperAdmin } = useIctStore();
  const role: AdminRole = adminUser?.role ?? "admin";
  const [open, setOpen] = useState(false);

  const visibleLinks = useMemo(
    () => links.filter((l) => l.roles.includes(role)),
    [role]
  );
  const activeLabel =
    visibleLinks.find((l) => isActiveHref(pathname, l.href))?.label ?? "เมนูผู้ดูแล";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass = (active: boolean) =>
    active
      ? "rounded-full border border-[var(--primary-solid)] bg-[var(--primary-solid)] px-4 py-2 text-sm font-semibold text-white shadow-sm"
      : "rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-black px-4 py-2 text-sm font-semibold text-[var(--primary-blue)] dark:text-white hover:border-[var(--primary-blue)] transition-colors";

  return (
    <div className="mb-8 admin-nav-bar rounded-2xl p-2 dark:bg-slate-950">
      {/* Mobile: hamburger + current page */}
      <div className="flex md:hidden items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-black p-2.5 text-[var(--primary-blue)] dark:text-white shrink-0"
          aria-label={open ? "ปิดเมนูผู้ดูแล" : "เปิดเมนูผู้ดูแล"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <span className="text-sm font-bold text-[var(--primary-blue)] dark:text-white truncate flex-1">
          {activeLabel}
        </span>
        {isSuperAdmin && (
          <span className="shrink-0 text-[10px] font-bold text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-black border border-amber-200 dark:border-amber-800 rounded-full px-2 py-1">
            super_admin
          </span>
        )}
      </div>

      {open && (
        <div className="md:hidden mt-2 space-y-1.5 border-t border-gray-100 dark:border-slate-800 pt-2">
          {visibleLinks.map((l) => {
            const active = isActiveHref(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`block w-full text-left ${linkClass(active)} !rounded-xl`}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Desktop: full pill row */}
      <div className="hidden md:flex flex-wrap gap-2">
        {visibleLinks.map((l) => {
          const active = isActiveHref(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={linkClass(active)}
            >
              {l.label}
            </Link>
          );
        })}
        {isSuperAdmin && (
          <span className="ml-auto self-center text-xs font-bold text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-black border border-amber-200 dark:border-amber-800 rounded-full px-3 py-1">
            super_admin
          </span>
        )}
      </div>
    </div>
  );
}
