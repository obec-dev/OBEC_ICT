"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import { sessionExpireMessage } from "@/lib/auth/sessionLifecycle";
import { clearPasswordSetup } from "@/lib/passwordSetup";
import { setExecutivePassword } from "@/lib/supabase/data";
import { writeSession } from "@/lib/storage";
import { inputClass } from "@/lib/styles";
import type { AuditUser, BusinessUser } from "@/types/ict";

export default function LoginPage() {
  const { login } = useIctStore();
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [execSetup, setExecSetup] = useState<{
    kind: "business" | "audit";
    loginId: string;
    currentPassword: string;
  } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    clearPasswordSetup();
    const reason = new URLSearchParams(window.location.search).get("reason");
    const msg = sessionExpireMessage(reason);
    if (msg) setError(msg);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const id = loginId.trim().toLowerCase();
    if (!id || !password) {
      setError("กรุณากรอก Login ID และรหัสผ่าน");
      return;
    }
    setSubmitting(true);
    const result = await login(id, password);
    setSubmitting(false);
    if (!result.ok) {
      if (result.needPasswordSetup) {
        const setupId = result.loginEmailForSetup || id;
        if (result.setupKind === "business" || result.setupKind === "audit") {
          setExecSetup({
            kind: result.setupKind,
            loginId: setupId,
            currentPassword: password,
          });
          setPassword("");
          setError("");
          return;
        }
        router.push(`/login/reset-password?email=${encodeURIComponent(setupId)}&first=1`);
        return;
      }
      setError(result.error || "เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบ Login ID และรหัสผ่าน");
      return;
    }
    router.push("/");
  };

  const finishExecutivePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execSetup) return;
    setError("");
    if (newPassword.length < 8) {
      setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านยืนยันไม่ตรงกัน");
      return;
    }
    setSubmitting(true);
    try {
      const result = await setExecutivePassword(
        execSetup.kind,
        execSetup.loginId,
        execSetup.currentPassword,
        newPassword
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.kind === "business") {
        writeSession({ kind: "business", user: result.user as BusinessUser });
      } else {
        writeSession({ kind: "audit", user: result.user as AuditUser });
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-in-up">
      <div className="mb-2 flex justify-end">
        <Link
          href="/admin/login"
          className="text-xs text-gray-400 hover:text-[var(--primary-blue)] transition-colors"
        >
          สำหรับผู้ดูแลระบบ
        </Link>
      </div>
      <form
        onSubmit={execSetup ? finishExecutivePassword : handleSubmit}
        className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8"
      >
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] mb-2">
          {execSetup ? "ตั้งรหัสผ่านใหม่" : "เข้าสู่ระบบ"}
        </h1>
        <p className="text-gray-500 mb-6 text-sm">
          {execSetup
            ? "ตั้งรหัสผ่านใหม่เพื่อเข้าใช้งาน อย่างน้อย 8 ตัวอักษร"
            : "กรุณาระบุ Login ID และรหัสผ่าน"}
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">
              Login ID
            </label>
            <input
              className={inputClass}
              type="text"
              autoComplete="username"
              value={loginId}
              onChange={(e) => {
                setLoginId(e.target.value);
                setExecSetup(null);
                setError("");
              }}
              readOnly={Boolean(execSetup)}
              required
            />
          </div>
          {execSetup ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">รหัสผ่านใหม่</label>
                <input
                  className={inputClass}
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ยืนยันรหัสผ่าน</label>
                <input
                  className={inputClass}
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </>
          ) : (
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
                  {showPassword ? "ซ่อน" : "แสดง"}
                </button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
          <button
            type="submit"
            disabled={
              submitting ||
              !loginId ||
              (execSetup ? !newPassword || !confirmPassword : !password)
            }
            className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40 hover:-translate-y-0.5 transition-all"
          >
            {submitting
              ? "กำลังตรวจสอบ..."
              : execSetup
                ? "ตั้งรหัสผ่านและเข้าสู่ระบบ"
                : "เข้าสู่ระบบ"}
          </button>
        </div>
        <p className="text-center text-sm text-gray-500 mt-6 space-y-2">
          <span className="block">
            <Link href="/login/reset-password" className="text-[var(--primary-blue)] font-semibold">
              คลิกที่นี่ หากท่านลืมรหัสผ่าน
            </Link>
          </span>
          <span className="block">
            หากท่านยังไม่มีบัญชี?{" "}
            <Link href="/register/consent" className="text-[var(--accent-red)] font-semibold">
              ลงทะเบียน
            </Link>
          </span>
        </p>
      </form>
    </div>
  );
}
