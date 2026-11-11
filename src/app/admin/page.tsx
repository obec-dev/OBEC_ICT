"use client";

import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";

type HubCard = {
  href: string;
  title: string;
  desc: string;
  show: boolean;
};

function Section({
  title,
  cards,
}: {
  title: string;
  cards: HubCard[];
}) {
  const visible = cards.filter((c) => c.show);
  if (visible.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white mb-3">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-black p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
          >
            <h3 className="text-xl font-bold text-[var(--primary-blue)] dark:text-white mb-2">{c.title}</h3>
            <p className="text-sm text-gray-500 dark:text-white/80">{c.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AdminHome() {
  const { adminUser, isSuperAdmin } = useIctStore();

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up admin-surface">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">ศูนย์ผู้ดูแลระบบ</h1>
      <p className="text-gray-500 dark:text-white/80 mb-8">
        สวัสดี {adminUser?.full_name}
        {adminUser?.role ? (
          <span className="block text-sm text-gray-400 dark:text-white/70 font-medium mt-0.5">{adminUser.role}</span>
        ) : null}
      </p>

      <Section
        title="ภาพรวมผู้ดูแลระบบ"
        cards={[
          {
            href: "/admin/overview",
            title: "ภาพรวมผู้ดูแลระบบ",
            desc: "ติดตามการลงทะเบียน ผลการทดสอบ คะแนน Live และภารกิจ",
            show: true,
          },
        ]}
      />

      <Section
        title="การจัดการ"
        cards={[
          {
            href: "/admin/projects",
            title: "จัดการ - โครงการ",
            desc: "บริหารจัดการโครงการ, กำหนดการ, คลิปวิดีโอ, ข้อสอบ และ คำตอบ",
            show: true,
          },
          {
            href: "/admin/users",
            title: "จัดการ - ผู้ใช้งาน",
            desc: "ค้นหรายชื่อ จัดการบทบาท อีเมล ระงับ และลบบัญชี",
            show: true,
          },
          {
            href: "/admin/candidates",
            title: "จัดการ - การส่งข้อสอบ",
            desc: "ค้นหารายชื่อ เพื่ออนุญาตให้แก้ไขข้อสอบที่ส่งแล้วได้",
            show: true,
          },
        ]}
      />

      <Section
        title="กิจกรรมต่างๆ"
        cards={[
          {
            href: "/admin/activities",
            title: "กิจกรรมและคะแนน",
            desc: "ภารกิจรายงาน, Live check-in, เอกสาร Auditor",
            show: true,
          },
          {
            href: "/admin/e-learning",
            title: "E-learning",
            desc: "วิดีโอเรียนรู้ด้วยตนเอง ชื่อ ลิงก์ และคะแนน",
            show: true,
          },
          {
            href: "/admin/news",
            title: "ข่าว",
            desc: "โพสต์และจัดการข่าวประชาสัมพันธ์ แฮชแท็ก และรูปภาพ",
            show: true,
          },
        ]}
      />

      <Section
        title="Super Admin"
        cards={[
          {
            href: "/admin/config",
            title: "ตั้งค่าเว็บไซต์",
            desc: "ชื่อระบบ ข้อความประกาศ Hero และการตั้งค่า Auditor",
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
        ]}
      />
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
