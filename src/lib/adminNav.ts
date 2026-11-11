import type { AdminRole } from "@/types/ict";

export type AdminNavLink = { href: string; label: string; roles: AdminRole[] };

export type AdminNavGroup = {
  id: string;
  label: string;
  roles: AdminRole[];
  href?: string;
  items?: AdminNavLink[];
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "overview",
    label: "ภาพรวม",
    roles: ["admin", "super_admin"],
    href: "/admin/overview",
  },
  {
    id: "manage",
    label: "การจัดการ",
    roles: ["admin", "super_admin"],
    items: [
      { href: "/admin/projects", label: "โครงการ", roles: ["admin", "super_admin"] },
      { href: "/admin/users", label: "ผู้ใช้งาน", roles: ["admin", "super_admin"] },
      { href: "/admin/candidates", label: "การส่งข้อสอบ", roles: ["admin", "super_admin"] },
    ],
  },
  {
    id: "activities",
    label: "กิจกรรม",
    roles: ["admin", "super_admin"],
    items: [
      { href: "/admin/activities", label: "กิจกรรมและคะแนน", roles: ["admin", "super_admin"] },
      { href: "/admin/e-learning", label: "E-learning", roles: ["admin", "super_admin"] },
      { href: "/admin/news", label: "ข่าว", roles: ["admin", "super_admin"] },
    ],
  },
  {
    id: "super",
    label: "Super Admin",
    roles: ["super_admin"],
    items: [
      { href: "/admin/config", label: "ตั้งค่าเว็บไซต์", roles: ["super_admin"] },
      { href: "/admin/admins", label: "จัดการผู้ดูแล", roles: ["super_admin"] },
      { href: "/admin/audit", label: "Audit logs", roles: ["super_admin"] },
    ],
  },
];

export function isAdminNavHrefActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function adminNavGroupHasActive(pathname: string, group: AdminNavGroup): boolean {
  if (group.href) return isAdminNavHrefActive(pathname, group.href);
  return (group.items ?? []).some((l) => isAdminNavHrefActive(pathname, l.href));
}

export function visibleAdminNavGroups(role: AdminRole): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS.filter((g) => g.roles.includes(role)).map((g) => ({
    ...g,
    items: g.items?.filter((l) => l.roles.includes(role)),
  }));
}

export function flattenAdminNavLinks(role: AdminRole): AdminNavLink[] {
  const out: AdminNavLink[] = [];
  for (const g of visibleAdminNavGroups(role)) {
    if (g.href) out.push({ href: g.href, label: g.label, roles: g.roles });
    for (const item of g.items ?? []) out.push(item);
  }
  return out;
}
