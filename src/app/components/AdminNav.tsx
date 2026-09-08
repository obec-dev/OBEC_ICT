"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import type { AdminRole } from "@/types/ict";

const links: { href: string; label: string; roles: AdminRole[] }[] = [
  { href: "/admin", label: "เมนูหลัก", roles: ["admin", "super_admin"] },
  { href: "/admin/overview", label: "แดชบอร์ด", roles: ["admin", "super_admin"] },
  { href: "/admin/registrations", label: "จัดการลงทะเบียน", roles: ["admin", "super_admin"] },
  { href: "/admin/candidates", label: "ผู้สมัคร & ปลดล็อกสอบ", roles: ["admin", "super_admin"] },
  { href: "/admin/projects", label: "จัดการวิชา & ข้อสอบ", roles: ["admin", "super_admin"] },
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

  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {links
        .filter((l) => l.roles.includes(role))
        .map((l) => {
          const active = isActiveHref(pathname, l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full border border-[var(--primary-blue)] bg-[var(--primary-blue)] px-4 py-2 text-sm font-semibold text-white shadow-md"
                  : "rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-[var(--primary-blue)] hover:border-[var(--primary-blue)] transition-colors"
              }
            >
              {l.label}
            </Link>
          );
        })}
      {isSuperAdmin && (
        <span className="ml-auto self-center text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
          super_admin
        </span>
      )}
    </div>
  );
}
