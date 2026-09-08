"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import { adminGetSettings, adminSaveSettings } from "@/lib/supabase/admin";
import { parseSiteSettings } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";

function ConfigContent() {
  const { adminToken } = useIctStore();
  const [siteName, setSiteName] = useState("");
  const [announce, setAnnounce] = useState("");
  const [heroBadge, setHeroBadge] = useState("");
  const [heroLine1, setHeroLine1] = useState("");
  const [heroLine2, setHeroLine2] = useState("");
  const [heroDescription, setHeroDescription] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [rawSettings, setRawSettings] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!adminToken) return;
    void adminGetSettings(adminToken)
      .then((raw) => {
        setRawSettings(raw);
        const settings = parseSiteSettings(raw);
        setSiteName(settings.site_name);
        setAnnounce(settings.login_announce_message);
        setHeroBadge(settings.hero_badge);
        setHeroLine1(settings.hero_title_line1);
        setHeroLine2(settings.hero_title_line2);
        setHeroDescription(settings.hero_description);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดตั้งค่าไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [adminToken]);

  const save = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");

    const result = await adminSaveSettings(adminToken, {
      ...rawSettings,
      site_name: siteName,
      login_announce_message: announce,
      hero_badge: heroBadge,
      hero_title_line1: heroLine1,
      hero_title_line2: heroLine2,
      hero_description: heroDescription,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("บันทึกการตั้งค่าเว็บไซต์แล้ว");
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">ตั้งค่าเว็บไซต์</h1>
      <p className="text-gray-500 mb-6">
        กำหนดชื่อระบบ ข้อความประกาศ และข้อความ Hero หน้าแรก · กำหนดการลงทะเบียน/สอบจัดการที่เมนูโครงการ
      </p>

      {loading ? (
        <p className="text-gray-500">กำลังโหลด...</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-sm text-blue-900">
            <p className="text-xs text-blue-800 leading-relaxed">
              ช่วงเปิด-ปิดลงทะเบียนและสอบ ตั้งค่าได้ที่{" "}
              <a href="/admin/projects" className="underline font-bold text-[var(--primary-blue)]">
                จัดการโครงการ & ข้อสอบ
              </a>
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="font-bold text-[var(--primary-blue)]">ทั่วไป</h2>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ชื่อเว็บไซต์</label>
              <input className={inputClass} value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                ข้อความประกาศช่วงก่อนเปิด login
              </label>
              <textarea
                className={`${inputClass} min-h-[90px]`}
                value={announce}
                onChange={(e) => setAnnounce(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="font-bold text-[var(--primary-blue)]">Hero หน้าแรก (Landing)</h2>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                Hero Badge / Title Line 1 (แถบแดง)
              </label>
              <input
                className={inputClass}
                value={heroBadge}
                onChange={(e) => setHeroBadge(e.target.value)}
                placeholder="คัดเลือกตัวแทน ICT Talent ประจำโรงเรียน"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Hero Title Line 1</label>
              <input
                className={inputClass}
                value={heroLine1}
                onChange={(e) => setHeroLine1(e.target.value)}
                placeholder="ตัวแทน ICT Talent"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Hero Title Line 2</label>
              <input
                className={inputClass}
                value={heroLine2}
                onChange={(e) => setHeroLine2(e.target.value)}
                placeholder="ประจำโรงเรียน"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Hero Description</label>
              <textarea
                className={`${inputClass} min-h-[100px]`}
                value={heroDescription}
                onChange={(e) => setHeroDescription(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
          {message && <p className="text-sm text-[var(--accent-green)]">{message}</p>}
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold"
          >
            บันทึกการตั้งค่า
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminConfigPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["super_admin"]}>
      <ConfigContent />
    </AuthGuard>
  );
}
