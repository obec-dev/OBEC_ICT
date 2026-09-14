"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { setExecutivePassword } from "@/lib/supabase/data";
import { writeSession } from "@/lib/storage";
import { inputClass } from "@/lib/styles";
import type { AuditUser, BusinessUser } from "@/types/ict";

const SETUP_TTL_MS = 30 * 60 * 1000;

export type ExecutiveSetupPayload = {
  kind: "business" | "audit";
  loginId: string;
  currentPassword: string;
  at: number;
};

/** In-memory only. A refresh or new tab must sign in again — do not persist the temp password. */
let pendingSetup: ExecutiveSetupPayload | null = null;

export function writeExecutiveSetup(payload: Omit<ExecutiveSetupPayload, "at">) {
  pendingSetup = { ...payload, at: Date.now() };
}

export function readExecutiveSetup(): ExecutiveSetupPayload | null {
  if (!pendingSetup?.loginId || !pendingSetup.kind || !pendingSetup.currentPassword) return null;
  if (Date.now() - pendingSetup.at > SETUP_TTL_MS) {
    pendingSetup = null;
    return null;
  }
  return pendingSetup;
}

export function clearExecutiveSetup() {
  pendingSetup = null;
}

export default function ExecutiveSetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromQuery = useMemo(
    () => ({
      kind: (searchParams.get("kind") === "audit" ? "audit" : "business") as "business" | "audit",
      loginId: (searchParams.get("id") || "").trim().toLowerCase(),
    }),
    [searchParams]
  );

  const setup = useMemo(() => {
    if (typeof window === "undefined") return null;
    return readExecutiveSetup();
  }, []);

  const loginId = setup?.loginId || fromQuery.loginId;
  const kind = setup?.kind || fromQuery.kind;
  const currentPassword = setup?.currentPassword || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!loginId || !currentPassword) {
      setError("เซสชันตั้งรหัสผ่านหมดอายุ กรุณาเข้าสู่ระบบด้วยรหัสผ่านชั่วคราวอีกครั้ง");
      return;
    }
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
      const result = await setExecutivePassword(kind, loginId, currentPassword, password);
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      clearExecutiveSetup();
      if (result.kind === "business") {
        writeSession({ kind: "business", user: result.user as BusinessUser });
      } else {
        writeSession({ kind: "audit", user: result.user as AuditUser });
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตั้งรหัสผ่านไม่สำเร็จ");
      setSubmitting(false);
    }
  };

  if (!loginId) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white rounded-3xl border p-8 text-center">
          <p className="text-sm text-gray-600 mb-4">ไม่พบข้อมูลการตั้งรหัสผ่าน</p>
          <Link href="/login" className="text-[var(--primary-blue)] font-semibold">
            กลับไปเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 animate-fade-in-up">
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-4">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">ตั้งรหัสผ่านใหม่</h1>
        <div className="rounded-2xl border border-[var(--primary-blue)]/20 bg-blue-50 px-4 py-3 text-sm text-[var(--primary-blue)]">
          <span className="font-semibold">Login ID ที่ใช้เข้าสู่ระบบของคุณคือ:</span>{" "}
          <span className="font-mono font-bold break-all select-all">{loginId}</span>
        </div>
        <p className="text-sm text-gray-500">กรุณาตั้งรหัสผ่านใหม่เพื่อเข้าใช้งาน</p>
        {!currentPassword && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">
            ไม่พบรหัสผ่านชั่วคราวในเซสชัน — กรุณา{" "}
            <button type="button" className="underline font-semibold" onClick={() => router.push("/login")}>
              เข้าสู่ระบบอีกครั้ง
            </button>
          </p>
        )}
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">รหัสผ่านใหม่</label>
          <div className="relative">
            <input
              className={`${inputClass} pr-12`}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 p-1"
            >
              {showPassword ? "ซ่อน" : "แสดง"}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ยืนยันรหัสผ่าน</label>
          <input
            className={inputClass}
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        <button
          type="submit"
          disabled={!currentPassword || !password || !confirm || submitting}
          className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40"
        >
          {submitting ? "กำลังบันทึก..." : "ตั้งรหัสผ่านและเข้าสู่ระบบ"}
        </button>
      </form>
    </div>
  );
}
