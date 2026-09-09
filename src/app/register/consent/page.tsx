"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { useIctStore } from "@/contexts/IctStore";
import { STORAGE_KEYS } from "@/lib/storage";
import { getAnyProjectRegistrationStatus } from "@/lib/siteSettings";

export default function ConsentPage() {
  const router = useRouter();
  const { projects, hydrated } = useIctStore();
  const [terms, setTerms] = useState(false);
  const [pdpa, setPdpa] = useState(false);
  const canContinue = terms && pdpa;

  const regStatus = useMemo(
    () => (hydrated ? getAnyProjectRegistrationStatus(projects) : null),
    [hydrated, projects]
  );

  const handleContinue = () => {
    if (!canContinue || !regStatus?.open) return;
    sessionStorage.setItem(STORAGE_KEYS.consent, "accepted");
    router.push("/register/form");
  };

  if (!hydrated || !regStatus) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-gray-500">กำลังตรวจสอบช่วงลงทะเบียน...</p>
      </div>
    );
  }

  if (!regStatus.open) {
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
          {regStatus.start || regStatus.end ? (
            <p className="text-sm text-gray-500">ช่วงรับลงทะเบียน: {regStatus.message}</p>
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
            ข้าพเจ้ายินยอมให้ สำนักงานคณะกรรมการการศึกษาขั้นพื้นฐาน สำนักพัฒนานวัตกรรมการจัดการศึกษา เก็บรวบรวม ใช้ และประมวลผลข้อมูลส่วนบุคคล ได้แก่ ชื่อ-นามสกุล, หมายเลขบัตรประชาชน, อีเมล, เบอร์โทรศัพท์, รหัสโรงเรียน และผลการทดสอบ 
            เพื่อวัตถุประสงค์ในการลงทะเบียน ดำเนินการคัดเลือกตัวแทน ICT Talent และการติดต่อประสานงานที่เกี่ยวข้อง ข้อมูลของท่านจะถูกจัดเก็บอย่างปลอดภัยเป็นระยะเวลา 1 ปีนับจากสิ้นสุดโครงการ 
            ทั้งนี้ ท่านมีสิทธิ์ในการถอนความยินยอม ขอเข้าถึง แก้ไข หรือขอให้ลบข้อมูลส่วนบุคคลตามสิทธิ์ของเจ้าของข้อมูลได้ตลอดเวลา
            </p>
          </section>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span className="text-gray-700">ข้าพเจ้าได้อ่านและยอมรับข้อกำหนดและเงื่อนไขการใช้งาน (จำเป็น)</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={pdpa} onChange={(e) => setPdpa(e.target.checked)} />
            <span className="text-gray-700">ข้าพเจ้ายินยอมให้ประมวลผลข้อมูลส่วนบุคคลตาม PDPA (จำเป็น)</span>
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
