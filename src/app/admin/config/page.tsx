"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import { adminGetSettings, adminSaveSettings } from "@/lib/supabase/admin";
import {
  datetimeLocalToIso,
  formatDateTimeTh,
  getExamStatus,
  getRegistrationStatus,
  isoToDatetimeLocal,
  parseSiteSettings,
} from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";

function ConfigContent() {
  const { adminToken } = useIctStore();
  const [siteName, setSiteName] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [announce, setAnnounce] = useState("");
  const [registrationStart, setRegistrationStart] = useState("");
  const [registrationEnd, setRegistrationEnd] = useState("");
  const [examStart, setExamStart] = useState("");
  const [examEnd, setExamEnd] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!adminToken) return;
    void adminGetSettings(adminToken)
      .then((raw) => {
        const settings = parseSiteSettings(raw);
        setSiteName(settings.site_name);
        setRegistrationOpen(settings.registration_open);
        setAnnounce(settings.login_announce_message);
        setRegistrationStart(isoToDatetimeLocal(settings.registration_start));
        setRegistrationEnd(isoToDatetimeLocal(settings.registration_end));
        setExamStart(isoToDatetimeLocal(settings.exam_start));
        setExamEnd(isoToDatetimeLocal(settings.exam_end));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดตั้งค่าไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [adminToken]);

  const previewSettings = parseSiteSettings({
    site_name: siteName,
    registration_open: registrationOpen,
    login_announce_message: announce,
    registration_start: datetimeLocalToIso(registrationStart),
    registration_end: datetimeLocalToIso(registrationEnd),
    exam_start: datetimeLocalToIso(examStart),
    exam_end: datetimeLocalToIso(examEnd),
  });
  const regStatus = getRegistrationStatus(previewSettings);
  const examStatus = getExamStatus(previewSettings);

  const save = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");

    const regStartIso = datetimeLocalToIso(registrationStart);
    const regEndIso = datetimeLocalToIso(registrationEnd);
    const examStartIso = datetimeLocalToIso(examStart);
    const examEndIso = datetimeLocalToIso(examEnd);

    if (regStartIso && regEndIso && new Date(regStartIso) > new Date(regEndIso)) {
      setError("ช่วงลงทะเบียน: วันเริ่มต้องไม่หลังวันสิ้นสุด");
      return;
    }
    if (examStartIso && examEndIso && new Date(examStartIso) > new Date(examEndIso)) {
      setError("ช่วงสอบ: วันเริ่มต้องไม่หลังวันสิ้นสุด");
      return;
    }

    const result = await adminSaveSettings(adminToken, {
      site_name: siteName,
      registration_open: registrationOpen,
      login_announce_message: announce,
      registration_start: regStartIso,
      registration_end: regEndIso,
      exam_start: examStartIso,
      exam_end: examEndIso,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("บันทึกการตั้งค่าช่วงเวลาแล้ว");
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">ตั้งค่าเว็บไซต์</h1>
      <p className="text-gray-500 mb-6">
        กำหนดชื่อระบบ ข้อความประกาศ และช่วงเปิด-ปิดของการลงทะเบียน / สอบ (เว้นว่าง = ไม่จำกัดด้านนั้น)
      </p>

      {loading ? (
        <p className="text-gray-500">กำลังโหลด...</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-6 text-sm text-blue-900">
            <h3 className="font-bold flex items-center gap-2 mb-1">
              <span>📌 หมายเหตุการตั้งค่ากำหนดการ:</span>
            </h3>
            <p className="text-xs text-blue-800 leading-relaxed">
              วันเปิด-ปิดลงทะเบียนและวันสอบได้รับการจัดสรรแยกเป็นรายวิชา/โครงการแล้วในระบบใหม่
              ท่านสามารถจัดการกำหนดการเปิด-ปิดแยกรายวิชาได้ที่เมนู{" "}
              <a href="/admin/projects" className="underline font-bold text-[var(--primary-blue)]">
                “จัดการรายวิชา/โครงการ”
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

          {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
          {message && <p className="text-sm text-[var(--accent-green)]">{message}</p>}
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold"
          >
            บันทึกการตั้งค่าทั่วไป
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
