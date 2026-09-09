"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { setCandidatePassword, verifyCandidateForPassword } from "@/lib/supabase/data";
import { writeSession } from "@/lib/storage";
import { inputClass } from "@/lib/styles";

const VERIFY_FAIL_MSG = "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const prefillId = useMemo(
    () => (searchParams.get("id") || "").replace(/\D/g, "").slice(0, 13),
    [searchParams]
  );

  const [step, setStep] = useState<"verify" | "password">("verify");
  const [profileId, setProfileId] = useState(prefillId);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const verified = await verifyCandidateForPassword(profileId.trim(), phone.trim());
      if (!verified.ok) {
        setError(VERIFY_FAIL_MSG);
        return;
      }
      setProfileId(verified.profile_id || profileId.trim());
      setStep("password");
    } catch {
      setError(VERIFY_FAIL_MSG);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (password !== confirm) {
      setError("รหัสผ่านยืนยันไม่ตรงกัน");
      return;
    }

    setSubmitting(true);
    try {
      const result = await setCandidatePassword(profileId.trim(), phone.trim(), password);
      if (!result.ok) {
        setError(result.error || "ตั้งรหัสผ่านไม่สำเร็จ");
        return;
      }
      writeSession({ kind: "candidate", candidate: result.candidate });
      // Full navigation so IctStore re-reads session and auto-login is applied
      window.location.href = "/portal/learn";
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-2">
          {step === "verify" ? "ยืนยันตัวตน" : "ตั้งรหัสผ่านใหม่"}
        </h1>
        <p className="text-gray-500 mb-6 text-sm">
          {step === "verify"
            ? "กรอกเลขบัตรประชาชนและเบอร์โทรที่ลงทะเบียน เพื่อยืนยันตัวตนก่อนตั้งรหัสผ่าน"
            : "ยืนยันตัวตนสำเร็จแล้ว — กรุณาตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"}
        </p>

        {step === "verify" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                เลขบัตรประชาชน
              </label>
              <input
                className={inputClass}
                inputMode="numeric"
                maxLength={13}
                value={profileId}
                onChange={(e) => setProfileId(e.target.value.replace(/\D/g, "").slice(0, 13))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                เบอร์โทรศัพท์
              </label>
              <input
                className={inputClass}
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
            <button
              type="submit"
              disabled={!profileId || !phone || submitting}
              className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
            >
              {submitting ? "กำลังตรวจสอบ..." : "ตรวจสอบข้อมูล"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                รหัสผ่านใหม่
              </label>
              <div className="relative">
                <input
                  className={`${inputClass} pr-12`}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[var(--primary-blue)] focus:outline-none p-1 transition-colors"
                  title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a8.959 8.959 0 013.682-.793c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                ยืนยันรหัสผ่าน
              </label>
              <input
                className={inputClass}
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
            <button
              type="submit"
              disabled={!password || !confirm || submitting}
              className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
            >
              {submitting ? "กำลังบันทึก..." : "ตั้งรหัสผ่านและเข้าสู่ระบบ"}
            </button>
            <button
              type="button"
              className="w-full text-sm text-gray-500 hover:text-[var(--primary-blue)]"
              onClick={() => {
                setStep("verify");
                setPassword("");
                setConfirm("");
                setError("");
              }}
            >
              ← กลับไปยืนยันตัวตนใหม่
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          <Link href="/login" className="text-[var(--primary-blue)] font-semibold">
            กลับไปเข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}
