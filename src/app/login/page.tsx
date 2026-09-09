"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import { inputClass } from "@/lib/styles";

export default function LoginPage() {
  const { login } = useIctStore();
  const router = useRouter();
  const [profileId, setProfileId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await login(profileId.trim(), password);
    setSubmitting(false);
    if (!result.ok) {
      if (result.needPasswordSetup) {
        router.push(`/login/reset-password?id=${encodeURIComponent(profileId.trim())}`);
        return;
      }
      setError(result.error || "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบเลขบัตรประชาชนและรหัสผ่าน");
      return;
    }
    router.push("/");
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-in-up">
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-2">เข้าสู่ระบบ</h1>
        <p className="text-gray-500 mb-6 text-sm">
          ใช้เลขบัตรประชาชนและรหัสผ่านที่ตั้งไว้
          (บัญชีผู้ดูแลระบบยังเข้าใช้ได้ตามปกติที่เมนูผู้ดูแลระบบ)
        </p>
        <div className="space-y-4">
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
              รหัสผ่าน
            </label>
            <div className="relative">
              <input
                className={`${inputClass} pr-12`}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
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
          {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
          <button
            type="submit"
            disabled={!profileId || !password || submitting}
            className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
          >
            {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6 space-y-2">
          <span className="block">
            <Link href="/login/reset-password" className="text-[var(--primary-blue)] font-semibold">
              ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่
            </Link>
          </span>
          <span className="block">
            ยังไม่มีบัญชี?{" "}
            <Link href="/register/consent" className="text-[var(--accent-red)] font-semibold">
              ลงทะเบียน
            </Link>
            <span className="mx-2">·</span>
            <Link href="/admin/login" className="text-[var(--primary-blue)] font-semibold">
              ผู้ดูแลระบบ
            </Link>
          </span>
        </p>
      </form>
    </div>
  );
}
