"use client";

import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";

function AdminHome() {
  const { adminUser, isSuperAdmin } = useIctStore();

  const cards = [
    {
      href: "/admin/overview",
      title: "ภาพรวมผู้ดูแลระบบ",
      desc: "ติดตามการลงทะเบียนและผลการทดสอบ",
      show: true,
    },
    {
      href: "/admin/projects",
      title: "จัดการ - โครงการ",
      desc: "บริหารจัดการโครงการ, กำหนดการ, คลิปวิดีโอ, ข้อสอบ และ คำตอบ",
      show: true,
    },
    {
      href: "/admin/registrations",
      title: "จัดการ - การลงทะเบียน",
      desc: "ค้นด้วยชื่อโรงเรียนหรือรหัสโรงเรียน",
      show: true,
    },
    {
      href: "/admin/candidates",
      title: "จัดการ - การส่งข้อสอบ",
      desc: "ค้นหาด้วยเลขบัตรประชาชนหรือรหัสโรงเรียน เพื่ออนุญาตให้แก้ไขข้อสอบที่ส่งแล้วได้",
      show: true,
    },
    {
      href: "/admin/config",
      title: "ตั้งค่าเว็บไซต์",
      desc: "ชื่อระบบ สถานะเปิดรับสมัคร และข้อความประกาศ",
      show: isSuperAdmin,
    },
    {
      href: "/admin/admins",
      title: "จัดการผู้ดูแล",
      desc: "เพิ่มแอดมิน สร้างรหัสผ่าน ระงับบัญชี เปลี่ยนบทบาท",
      show: isSuperAdmin,
    },
    {
      href: "/admin/audit",
      title: "Audit logs",
      desc: "ดู log, ส่งออก JSON, ล้างตารางพร้อมเก็บไฟล์อ้างอิงภายนอก",
      show: isSuperAdmin,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">ศูนย์ผู้ดูแลระบบ</h1>
      <p className="text-gray-500 dark:text-slate-400 mb-8">
        สวัสดี {adminUser?.full_name}
        {adminUser?.role ? (
          <span className="block text-sm text-gray-400 dark:text-slate-500 font-medium mt-0.5">{adminUser.role}</span>
        ) : null}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards
          .filter((c) => c.show)
          .map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <h2 className="text-xl font-bold text-[var(--primary-blue)] mb-2">{c.title}</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">{c.desc}</p>
            </Link>
          ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGuard requireAdmin>
      <AdminHome />
    </AuthGuard>
  );
}
