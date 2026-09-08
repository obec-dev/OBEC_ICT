"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";

function ProfilePageContent() {
  const { session, updateCandidateProfile } = useIctStore();
  const candidate = session?.kind === "candidate" ? session.candidate : null;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (candidate) {
      setFirstName(candidate.first_name || "");
      setLastName(candidate.last_name || "");
      setPhone(candidate.phone || "");
      setRemark(candidate.remark || "");
    }
  }, [candidate]);

  if (!candidate) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">โปรไฟล์นี้ใช้สำหรับผู้สมัครตัวแทน ICT Talent</p>
        <Link href="/" className="px-6 py-2.5 bg-[var(--primary-blue)] text-white rounded-full font-bold">
          กลับหน้าหลัก
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError("กรุณากรอกข้อมูล ชื่อ, นามสกุล และเบอร์โทรศัพท์ให้ครบถ้วน");
      return;
    }

    setSaving(true);
    const res = await updateCandidateProfile(candidate.id, {
      first_name: firstName,
      last_name: lastName,
      phone,
      remark,
    });
    setSaving(false);

    if (!res.ok) {
      setError(res.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } else {
      setSuccess("บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[var(--primary-blue)] text-white flex items-center justify-center font-bold text-2xl shadow-md">
              {candidate.first_name.slice(0, 1)}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">{candidate.full_name}</h1>
              <p className="text-sm text-gray-500">{candidate.school_name}</p>
            </div>
          </div>
          <span className="bg-blue-50 text-[var(--primary-blue)] text-xs px-3 py-1.5 rounded-full font-bold">
            ตัวแทน ICT
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs">
            <div>
              <span className="block font-medium text-gray-400 mb-0.5">เลขบัตรประชาชน (ล็อก)</span>
              <span className="font-bold text-gray-700 tracking-wide">{candidate.id}</span>
            </div>
            <div>
              <span className="block font-medium text-gray-400 mb-0.5">โรงเรียน</span>
              <span className="font-bold text-[var(--primary-blue)]">{candidate.school_name}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                ชื่อ <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className={inputClass}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                นามสกุล <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className={inputClass}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
              เบอร์โทรศัพท์ (ใช้สำหรับเข้าสู่ระบบ) <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              หมายเหตุเพิ่มเติม (ถ้ามี)
            </label>
            <input
              type="text"
              className={inputClass}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="เช่น ตำแหน่ง/ครูผู้ประสานงาน"
            />
          </div>

          {error && <p className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>}
          {success && <p className="text-sm font-medium text-emerald-600 bg-emerald-50 p-3 rounded-xl border border-emerald-100">{success}</p>}

          <div className="pt-4 flex gap-4">
            <Link
              href="/portal/learn"
              className="flex-1 py-3.5 border border-gray-200 rounded-full font-bold text-gray-600 hover:bg-gray-50 text-center transition-all"
            >
              ไปยังบทเรียน
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3.5 bg-[var(--primary-blue)] text-white rounded-full font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfilePageContent />
    </AuthGuard>
  );
}
