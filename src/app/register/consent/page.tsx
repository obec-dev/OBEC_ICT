"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { STORAGE_KEYS } from "@/lib/storage";
import {
  fetchPublicSiteSettings,
  getRegistrationStatus,
  type PeriodStatus,
} from "@/lib/siteSettings";

export default function ConsentPage() {
  const router = useRouter();
  const [terms, setTerms] = useState(false);
  const [pdpa, setPdpa] = useState(false);
  const [loading, setLoading] = useState(true);
  const [periodError, setPeriodError] = useState("");
  const [regStatus, setRegStatus] = useState<PeriodStatus | null>(null);
  const canContinue = terms && pdpa;

  useEffect(() => {
    void fetchPublicSiteSettings()
      .then((settings) => setRegStatus(getRegistrationStatus(settings)))
      .catch((err) => setPeriodError(err instanceof Error ? err.message : "โหลดช่วงลงทะเบียนไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  const handleContinue = () => {
    if (!canContinue || !regStatus?.open) return;
    sessionStorage.setItem(STORAGE_KEYS.consent, "accepted");
    router.push("/register/form");
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-gray-500">กำลังตรวจสอบช่วงลงทะเบียน...</p>
      </div>
    );
  }

  if (periodError) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-[var(--accent-red)]">{periodError}</p>
      </div>
    );
  }

  if (regStatus && !regStatus.open) {
    return <PeriodClosedNotice title="ยังไม่เปิดรับลงทะเบียน" status={regStatus} />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="bg-[var(--primary-blue)] px-8 py-6 text-white">
          <h1 className="text-2xl font-bold">ข้อกำหนดและ PDPA</h1>
          <p className="text-blue-100 mt-1">กรุณาอ่านและยินยอมก่อนกรอกแบบลงทะเบียน</p>
        </div>
        <div className="p-8 space-y-6">
          {regStatus?.start || regStatus?.end ? (
            <p className="text-sm text-gray-500">
              ช่วงรับลงทะเบียน: {regStatus.message}
            </p>
          ) : null}
          <section className="rounded-2xl bg-gray-50 p-5 text-sm text-gray-600 leading-relaxed max-h-56 overflow-auto">
            <h2 className="font-bold text-[var(--primary-blue)] mb-2">ข้อกำหนดและเงื่อนไข</h2>
            <p>
              ผู้สมัครรับทราบว่าการลงทะเบียนนี้เป็นการเสนอชื่อตัวแทน ICT Talent ประจำโรงเรียน หนึ่งโรงเรียนต่อหนึ่งรายการ
              ข้อมูลที่ใช้ต้องถูกต้องตามความเป็นจริง และบัญชีที่สร้างจะใช้เข้าสู่ระบบบทเรียนและข้อสอบเท่านั้น
              หากต้องการแก้ไขข้อมูลหลังยืนยันแล้ว ให้ติดต่อผู้ดูแลระบบ
            </p>
          </section>
          <section className="rounded-2xl bg-gray-50 p-5 text-sm text-gray-600 leading-relaxed max-h-56 overflow-auto">
            <h2 className="font-bold text-[var(--primary-blue)] mb-2">ความยินยอมตาม PDPA</h2>
            <p>
              ข้าพเจ้ายินยอมให้เก็บรวบรวม ใช้ และประมวลผลข้อมูลส่วนบุคคล ได้แก่ ชื่อ-นามสกุล อีเมล เบอร์โทรศัพท์
              และรหัสโรงเรียน เพื่อวัตถุประสงค์ในการลงทะเบียน คัดเลือกตัวแทน ICT Talent และการติดต่อประสานงาน
              ข้อมูลจะถูกเก็บในระบบสาธิตนี้บนเครื่องของผู้ใช้เท่านั้นในระยะพัฒนานี้
            </p>
          </section>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span className="text-gray-700">ข้าพเจ้าได้อ่านและยอมรับข้อกำหนดและเงื่อนไข</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={pdpa} onChange={(e) => setPdpa(e.target.checked)} />
            <span className="text-gray-700">ข้าพเจ้ายินยอมให้ประมวลผลข้อมูลส่วนบุคคลตาม PDPA</span>
          </label>

          <button
            type="button"
            disabled={!canContinue}
            onClick={handleContinue}
            className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
          >
            ดำเนินการต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
