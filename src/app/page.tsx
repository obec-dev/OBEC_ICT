"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProjectCoverFlow } from "@/app/components/ProjectCoverFlow";
import { ProjectScheduleNotice } from "@/app/components/ProjectScheduleNotice";
import { useIctStore, useSchoolStats } from "@/contexts/IctStore";
import {
  fetchPublicSiteSettings,
  getAnyProjectRegistrationStatus,
  type SitePeriodSettings,
} from "@/lib/siteSettings";

type HeroCopy = Pick<
  SitePeriodSettings,
  "hero_badge" | "hero_title_line1" | "hero_title_line2" | "hero_description"
>;

const HERO_DEFAULTS: HeroCopy = {
  hero_badge: "คัดเลือกตัวแทน ICT Talent ประจำโรงเรียน",
  hero_title_line1: "ตัวแทน ICT Talent",
  hero_title_line2: "ประจำโรงเรียน",
  hero_description:
    "แพลตฟอร์มลงทะเบียน เรียนรู้ และสอบคัดเลือกผู้แทนเทคโนโลยีสารสนเทศของโรงเรียน ครอบคลุมเขตพื้นที่การศึกษาทั่วประเทศ",
};

export default function Home() {
  const { session, hydrated, loading, loadError, projects } = useIctStore();
  const stats = useSchoolStats();
  const [hero, setHero] = useState<HeroCopy>(HERO_DEFAULTS);

  const regStatus = useMemo(
    () => (hydrated ? getAnyProjectRegistrationStatus(projects) : null),
    [hydrated, projects]
  );

  useEffect(() => {
    void fetchPublicSiteSettings()
      .then((s) => {
        setHero({
          hero_badge: s.hero_badge,
          hero_title_line1: s.hero_title_line1,
          hero_title_line2: s.hero_title_line2,
          hero_description: s.hero_description,
        });
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  return (
    <div className="min-h-screen overflow-hidden">
      {/* 1. Hero */}
      <section className="relative bg-[var(--primary-blue)] pt-24 pb-40 px-4">
        <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none flex justify-end animate-float">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-[800px] h-[800px] -mr-40 -mt-20 transform rotate-12">
            <path
              fill="#FFFFFF"
              d="M44.7,-76.4C58.8,-69.2,71.8,-59.1,81.3,-46.3C90.8,-33.5,96.8,-18,97.3,-2.3C97.8,13.4,92.8,29.4,83.1,42.8C73.4,56.2,59.1,67,43.5,75.1C27.9,83.2,11,88.5,-4.8,87.6C-20.6,86.6,-35.4,79.5,-49.6,70C-63.8,60.5,-77.4,48.6,-84.9,33.5C-92.4,18.4,-93.8,0,-89,-16.1C-84.2,-32.2,-73.2,-46.1,-59.6,-55.8C-46,-65.5,-29.8,-71,-14.2,-74.6C1.4,-78.2,17.1,-79.9,30.6,-83.6L44.7,-76.4Z"
              transform="translate(100 100)"
            />
          </svg>
        </div>

        <div className="max-w-7xl mx-auto relative z-10 flex flex-col md:flex-row items-center gap-12 animate-fade-in-up">
          <div className="flex-1 space-y-8 text-center md:text-left">
            <span className="inline-block bg-[var(--accent-red)] text-white px-4 py-1.5 rounded-full text-sm font-bold tracking-wide shadow-lg">
              {hero.hero_badge}
            </span>
            <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight flex flex-col">
              <span className="overflow-hidden pb-2">
                <span className="block opacity-0 animate-slide-up-reveal">{hero.hero_title_line1}</span>
              </span>
              <span className="overflow-hidden pb-2 -mt-2">
                <span
                  className="block opacity-0 animate-slide-up-reveal text-blue-300"
                  style={{ animationDelay: "0.2s" }}
                >
                  {hero.hero_title_line2}
                </span>
              </span>
            </h1>
            <p className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto md:mx-0 font-light leading-relaxed">
              {hero.hero_description}
            </p>
            {regStatus && !regStatus.open && (
              <p className="text-sm text-blue-100/90">{regStatus.message}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-4 pt-4 justify-center md:flex-wrap md:justify-start">
              {hydrated && session ? (
                <Link
                  href={session.kind === "admin" ? "/admin" : "/portal/profile"}
                  className="bg-[var(--accent-green)] text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-green-600 transition-all duration-300 shadow-xl hover:shadow-green-900/50 hover:-translate-y-1 active:translate-y-0 flex items-center justify-center gap-2"
                >
                  {session.kind === "admin" ? "เข้าสู่ศูนย์ผู้ดูแล" : "จัดการโปรไฟล์"}
                </Link>
              ) : regStatus && !regStatus.open ? (
                <span className="bg-white/15 text-white/80 px-8 py-4 rounded-full text-lg font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                  ปิดรับลงทะเบียน
                </span>
              ) : (
                <Link
                  href="/register/consent"
                  className="bg-[var(--accent-red)] text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-red-700 transition-all duration-300 shadow-xl hover:shadow-red-900/50 hover:-translate-y-1 active:translate-y-0 flex items-center justify-center gap-2"
                >
                  ลงทะเบียนตัวแทน
                </Link>
              )}

              <Link
                href="/dashboard"
                className="glass-effect text-white border-white/40 px-8 py-4 rounded-full text-lg font-bold hover:bg-white hover:text-[var(--primary-blue)] transition-all duration-300 hover:-translate-y-1 active:translate-y-0 flex items-center justify-center gap-2"
              >
                ดูภาพรวมเขตพื้นที่
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Impact metrics */}
      <section
        className="max-w-6xl mx-auto px-4 relative z-20 -mt-4 mb-12 animate-fade-in-up"
        style={{ animationDelay: "0.2s", animationFillMode: "both" }}
      >
        <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] p-8 md:p-12 border border-gray-100 flex flex-col md:flex-row gap-8 justify-around text-center divide-y md:divide-y-0 md:divide-x divide-gray-100 transition-transform duration-500 hover:-translate-y-2">
          <div className="flex-1 pt-4 md:pt-0">
            <div className="text-5xl font-extrabold text-[var(--accent-red)] mb-2">
              {loading && !stats.total ? "…" : stats.total.toLocaleString()}
            </div>
            <div className="text-gray-500 font-medium">โรงเรียนในระบบ</div>
            {loadError && <div className="text-xs text-red-500 mt-2">โหลดข้อมูลไม่สำเร็จ</div>}
          </div>
          <div className="flex-1 pt-8 md:pt-0">
            <div className="text-5xl font-extrabold text-[var(--primary-blue)] mb-2">
              {loading && !stats.total ? "…" : stats.registered.toLocaleString()}
            </div>
            <div className="text-gray-500 font-medium">ลงทะเบียนแล้ว</div>
          </div>
          <div className="flex-1 pt-8 md:pt-0">
            <div className="text-5xl font-extrabold text-[var(--secondary-blue)] mb-2">
              {loading && !stats.total ? "…" : stats.zones.toLocaleString()}
            </div>
            <div className="text-gray-500 font-medium">เขตพื้นที่การศึกษา</div>
          </div>
        </div>
      </section>

      {/* 3. Project carousel */}
      {hydrated && (
        <ProjectCoverFlow projects={projects} hasSession={Boolean(session && session.kind === "candidate")} />
      )}

      {/* 4. Schedule timeline */}
      {hydrated && <ProjectScheduleNotice projects={projects} />}

      {/* 5. Registration steps */}
      <section
        className="max-w-7xl mx-auto px-4 py-16 text-center animate-fade-in-up"
        style={{ animationDelay: "0.4s", animationFillMode: "both" }}
      >
        <h2 className="text-3xl font-bold text-[var(--primary-blue)] mb-4">ขั้นตอนการคัดเลือก</h2>
        <p className="text-gray-500 dark:text-slate-400 mb-12">
          ลงทะเบียนและตรวจสอบกำหนดการเพื่อเข้าร่วมการทดสอบคัดเลือก
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {[
            { step: "1", title: "ยินยอมเงื่อนไข", desc: "อ่านข้อกำหนดและให้ความยินยอมตาม PDPA ก่อนกรอกข้อมูล" },
            {
              step: "2",
              title: "ลงทะเบียนด้วยรหัสโรงเรียน",
              desc: "ระบบดึงชื่อโรงเรียน เขต และจังหวัดให้อัตโนมัติ แล้วสร้างบัญชีเข้าพอร์ทัล",
            },
            { step: "3", title: "เรียนจากวิดีโอ", desc: "รับชมบทเรียน ICT ให้ครบ เพื่อปลดล็อกสิทธิ์เข้าสอบ" },
            {
              step: "4",
              title: "สอบคัดเลือก",
              desc: "ตอบข้อสอบแบบบันทึกฉบับร่างได้ จนกว่าจะส่งคำตอบสุดท้าย",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="group bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-3"
            >
              <div className="w-16 h-16 bg-blue-50 text-[var(--secondary-blue)] rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-6 group-hover:scale-110 group-hover:bg-[var(--primary-blue)] group-hover:text-white transition-all duration-300">
                {item.step}
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-3 group-hover:text-[var(--primary-blue)] transition-colors">
                {item.title}
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
