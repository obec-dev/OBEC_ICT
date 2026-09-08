"use client";

import { useEffect, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";

type EditProfileModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
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
  }, [candidate, isOpen]);

  if (!isOpen || !session) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError("กรุณากรอกข้อมูล ชื่อ, นามสกุล และเบอร์โทรศัพท์ให้ครบถ้วน");
      return;
    }

    if (candidate) {
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
        setTimeout(() => {
          setSuccess("");
          onClose();
        }, 1200);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full p-6 md:p-8 border border-gray-100 relative animate-scale-up">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-[var(--primary-blue)]/10 text-[var(--primary-blue)] flex items-center justify-center font-bold text-xl">
            👤
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-[var(--primary-blue)]">แก้ไขข้อมูลส่วนตัว</h2>
            <p className="text-xs text-gray-500">อัปเดตข้อมูลผู้สมัคร / ตัวแทน ICT Talent</p>
          </div>
        </div>

        {candidate ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Read only info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 text-xs">
              <div>
                <span className="block font-medium text-gray-400 mb-0.5">เลขบัตรประชาชน (ล็อก)</span>
                <span className="font-bold text-gray-700 tracking-wide">{candidate.id}</span>
              </div>
              <div>
                <span className="block font-medium text-gray-400 mb-0.5">โรงเรียน</span>
                <span className="font-bold text-[var(--primary-blue)] truncate block">{candidate.school_name}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-1">
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
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-1">
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
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-1">
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
              <label className="block text-sm font-semibold text-gray-700 mb-1">
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

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 border border-gray-200 rounded-full font-bold text-gray-600 hover:bg-gray-50 transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 bg-[var(--primary-blue)] text-white rounded-full font-bold hover:bg-blue-700 transition-all shadow-md disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
              </button>
            </div>
          </form>
        ) : (
          <div className="py-6 text-center space-y-4">
            <p className="text-gray-600">
              บัญชีผู้ดูแลระบบ ({session.kind === "admin" ? session.admin.full_name : ""})
            </p>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-full font-bold hover:bg-gray-300"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
