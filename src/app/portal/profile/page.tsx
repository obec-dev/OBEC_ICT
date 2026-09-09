"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";
import {
  TITLE_OPTIONS,
  type TitleKey,
  filterEnglishOnly,
  filterThaiOnly,
  getTitleByKey,
} from "@/lib/titles";
import type { Candidate } from "@/types/ict";

function buildDisplayName(c: Pick<Candidate, "first_name" | "last_name" | "title_th" | "title_other_th">) {
  const titleTh = c.title_other_th || c.title_th || "";
  return `${titleTh} ${c.first_name} ${c.last_name}`.trim();
}

function ProfileForm({ candidate }: { candidate: Candidate }) {
  const { updateCandidateProfile } = useIctStore();

  const initialTitleKey = (candidate.title_key as TitleKey | undefined) || "";
  const [titleKey, setTitleKey] = useState<TitleKey | "">(initialTitleKey);
  const [titleOtherTh, setTitleOtherTh] = useState(candidate.title_other_th || "");
  const [titleOtherEn, setTitleOtherEn] = useState(candidate.title_other_en || "");
  const [firstName, setFirstName] = useState(candidate.first_name || "");
  const [lastName, setLastName] = useState(candidate.last_name || "");
  const [engFirstName, setEngFirstName] = useState(candidate.eng_first_name || "");
  const [engLastName, setEngLastName] = useState(candidate.eng_last_name || "");
  const [phone, setPhone] = useState(candidate.phone || "");
  const [position, setPosition] = useState(candidate.position || "");
  const [duty, setDuty] = useState(candidate.duty || "");
  const [lineId, setLineId] = useState(candidate.line_id || "");
  const [email, setEmail] = useState(candidate.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const titleOpt = useMemo(() => getTitleByKey(titleKey), [titleKey]);

  const handleTitleChange = (key: TitleKey | "") => {
    setTitleKey(key);
    if (key !== "other") {
      setTitleOtherTh("");
      setTitleOtherEn("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!titleKey) {
      setError("กรุณาเลือกคำนำหน้า");
      return;
    }
    if (titleKey === "other" && (!titleOtherTh.trim() || !titleOtherEn.trim())) {
      setError("กรุณากรอกคำนำหน้าอื่นๆ ทั้งภาษาไทยและอังกฤษ");
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError("กรุณากรอกชื่อ นามสกุล และเบอร์โทรศัพท์ให้ครบถ้วน");
      return;
    }

    const title_en = titleKey === "other" ? titleOtherEn.trim() : titleOpt?.en || "";
    const title_th = titleKey === "other" ? titleOtherTh.trim() : titleOpt?.th || "";

    setSaving(true);
    const res = await updateCandidateProfile(candidate.id, {
      title_key: titleKey,
      title_en,
      title_th,
      title_other_en: titleKey === "other" ? titleOtherEn.trim() : "",
      title_other_th: titleKey === "other" ? titleOtherTh.trim() : "",
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      eng_first_name: engFirstName.trim(),
      eng_last_name: engLastName.trim(),
      phone: phone.trim(),
      position: position.trim(),
      duty: duty.trim(),
      line_id: lineId.trim(),
      email: email.trim(),
    });
    setSaving(false);

    if (!res.ok) {
      setError(res.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
    } else {
      setSuccess("บันทึกข้อมูลโปรไฟล์เรียบร้อยแล้ว");
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
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

          <div>
            <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
              คำนำหน้า <span className="text-red-500">*</span>
            </label>
            <select
              className={inputClass}
              value={titleKey}
              onChange={(e) => handleTitleChange(e.target.value as TitleKey | "")}
              required
            >
              <option value="">-- เลือก --</option>
              {TITLE_OPTIONS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.th} / {t.en}
                </option>
              ))}
            </select>
          </div>

          {titleKey === "other" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                  คำนำหน้าอื่นๆ (ไทย)
                </label>
                <input
                  className={inputClass}
                  value={titleOtherTh}
                  onChange={(e) => setTitleOtherTh(filterThaiOnly(e.target.value))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                  Title (Other, EN)
                </label>
                <input
                  className={inputClass}
                  value={titleOtherEn}
                  onChange={(e) => setTitleOtherEn(filterEnglishOnly(e.target.value))}
                  required
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                ชื่อ (ไทย) <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                value={firstName}
                onChange={(e) => setFirstName(filterThaiOnly(e.target.value))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                นามสกุล (ไทย) <span className="text-red-500">*</span>
              </label>
              <input
                className={inputClass}
                value={lastName}
                onChange={(e) => setLastName(filterThaiOnly(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">First name (EN)</label>
              <input
                className={inputClass}
                value={engFirstName}
                onChange={(e) => setEngFirstName(filterEnglishOnly(e.target.value))}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Last name (EN)</label>
              <input
                className={inputClass}
                value={engLastName}
                onChange={(e) => setEngLastName(filterEnglishOnly(e.target.value))}
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ตำแหน่ง</label>
              <input className={inputClass} value={position} onChange={(e) => setPosition(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">หน้าที่รับผิดชอบ</label>
              <input className={inputClass} value={duty} onChange={(e) => setDuty(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Line ID</label>
              <input className={inputClass} value={lineId} onChange={(e) => setLineId(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">Email</label>
              <input
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm font-medium text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>
          )}
          {success && (
            <p className="text-sm font-medium text-emerald-600 bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              {success}
            </p>
          )}

          <div className="pt-4 flex gap-4">
            <Link
              href="/"
              className="flex-1 py-3.5 border border-gray-200 dark:border-slate-600 rounded-full font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 text-center transition-all"
            >
              ย้อนกลับไปหน้าหลัก
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3.5 bg-[var(--primary-blue)] text-white dark:text-slate-900 rounded-full font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
            >
              {saving ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProfilePageContent() {
  const { session } = useIctStore();
  const candidate = session?.kind === "candidate" ? session.candidate : null;

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

  return (
    <ProfileForm
      key={`${candidate.id}:${buildDisplayName(candidate)}:${candidate.phone}:${candidate.email ?? ""}`}
      candidate={candidate}
    />
  );
}

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfilePageContent />
    </AuthGuard>
  );
}
