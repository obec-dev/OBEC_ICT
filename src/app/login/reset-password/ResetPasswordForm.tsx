"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { clearPasswordSetup } from "@/lib/passwordSetup";
import {
  setCandidatePassword,
  verifyCandidateForPassword,
  verifyCandidateForgotPassword,
} from "@/lib/supabase/data";
import { writeSession } from "@/lib/storage";
import { inputClass } from "@/lib/styles";

const VERIFY_FAIL_MSG = "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้งหรือติดต่อผู้ดูแลระบบ";

function LoginEmailBanner({ email }: { email: string }) {
  if (!email) return null;
  return (
    <div className="mb-4 rounded-2xl border border-[var(--primary-blue)]/20 bg-blue-50 px-4 py-3 text-sm text-[var(--primary-blue)]">
      <span className="font-semibold">อีเมลที่ใช้เข้าสู่ระบบของคุณคือ:</span>{" "}
      <span className="font-mono font-bold break-all select-all">{email}</span>
    </div>
  );
}

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const prefillEmail = useMemo(
    () => (searchParams.get("email") || "").trim().toLowerCase(),
    [searchParams]
  );
  const isFirstTime = searchParams.get("first") === "1";

  const [step, setStep] = useState<"verify" | "password">(
    isFirstTime && prefillEmail ? "password" : "verify"
  );
  const [email, setEmail] = useState(prefillEmail);
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    clearPasswordSetup();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const verified = isFirstTime
        ? await verifyCandidateForPassword(email.trim(), phone.trim())
        : await verifyCandidateForgotPassword(nationalId.trim(), phone.trim());
      if (!verified.ok) {
        setError(VERIFY_FAIL_MSG);
        return;
      }
      const loginEmail = verified.login_email || email.trim().toLowerCase();
      setEmail(loginEmail);
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

    const useEmail = email.trim().toLowerCase();
    const usePhone = phone.trim();
    if (!useEmail || (!isFirstTime && !usePhone)) {
      setError("กรุณายืนยันตัวตนก่อนตั้งรหัสผ่าน");
      setStep("verify");
      return;
    }

    setSubmitting(true);
    try {
      const result = await setCandidatePassword(
        useEmail,
        usePhone,
        password,
        isFirstTime ? null : nationalId.trim()
      );
      if (!result.ok) {
        setError(result.error || "ตั้งรหัสผ่านไม่สำเร็จ");
        setSubmitting(false);
        return;
      }
      writeSession({ kind: "candidate", candidate: result.candidate });
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-in-up">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-2">
          {step === "verify"
            ? isFirstTime
              ? "ตั้งรหัสผ่านครั้งแรก"
              : "ลืมรหัสผ่าน"
            : "ตั้งรหัสผ่านใหม่"}
        </h1>
        <p className="text-gray-500 mb-6 text-sm">
          {step === "verify"
            ? isFirstTime
              ? "ยืนยันตัวตนด้วยอีเมล (Login ID) และเบอร์โทรที่ลงทะเบียน เพียงครั้งเดียว"
              : "ยืนยันตัวตนด้วยเลขบัตรประชาชน และเบอร์โทรปัจจุบัน"
            : isFirstTime
              ? "กรุณาตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
              : "ยืนยันตัวตนสำเร็จแล้ว - กรุณาตั้งรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"}
        </p>

        {step === "password" && <LoginEmailBanner email={email} />}

        {step === "verify" ? (
          <form onSubmit={handleVerify} className="space-y-4">
            {isFirstTime ? (
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                  Login ID (อีเมล)
                </label>
                <input
                  className={inputClass}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
                  เลขบัตรประชาชน (National ID)
                </label>
                <input
                  className={inputClass}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 13))}
                  required
                  minLength={13}
                  maxLength={13}
                />
              </div>
            )}
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
              disabled={
                submitting ||
                !phone ||
                (isFirstTime ? !email : nationalId.length !== 13)
              }
              className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
            >
              {submitting ? "กำลังตรวจสอบ..." : "ตรวจสอบข้อมูลก่อนตั้งค่ารหัสผ่านใหม่"}
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
                  {showPassword ? "ซ่อน" : "แสดง"}
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
            {!isFirstTime && (
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
            )}
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
