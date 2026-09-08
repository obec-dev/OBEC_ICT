"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
import { adminChangePassword } from "@/lib/supabase/admin";
import { inputClass } from "@/lib/styles";

function ChangePasswordContent() {
  const { adminToken, adminUser, refreshAdminSession, logout } = useIctStore();
  const router = useRouter();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!adminToken || !adminUser) return;
    if (newPassword.length < 8) {
      setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (newPassword !== confirm) {
      setError("รหัสผ่านยืนยันไม่ตรงกัน");
      return;
    }
    setSubmitting(true);
    const result = await adminChangePassword(adminToken, oldPassword, newPassword);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refreshAdminSession({ ...adminUser, must_change_password: false });
    router.replace("/admin");
  };

  const renderEyeIcon = (visible: boolean) =>
    visible ? (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a8.959 8.959 0 013.682-.793c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21M3 3l18 18" />
      </svg>
    ) : (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    );

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-4">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">เปลี่ยนรหัสผ่าน</h1>
        <p className="text-sm text-gray-500">บัญชีของคุณต้องตั้งรหัสผ่านใหม่ก่อนใช้งานต่อ</p>

        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">รหัสผ่านเดิม / ชั่วคราว</label>
          <div className="relative">
            <input
              className={`${inputClass} pr-12`}
              type={showOld ? "text" : "password"}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowOld((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[var(--primary-blue)] p-1"
            >
              {renderEyeIcon(showOld)}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">รหัสผ่านใหม่</label>
          <div className="relative">
            <input
              className={`${inputClass} pr-12`}
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[var(--primary-blue)] p-1"
            >
              {renderEyeIcon(showNew)}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ยืนยันรหัสผ่านใหม่</label>
          <div className="relative">
            <input
              className={`${inputClass} pr-12`}
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[var(--primary-blue)] p-1"
            >
              {renderEyeIcon(showConfirm)}
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        <button type="submit" disabled={submitting} className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3 font-bold disabled:opacity-40">
          {submitting ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
        </button>
        <button type="button" onClick={logout} className="w-full text-sm text-gray-500 underline">
          ออกจากระบบ
        </button>
      </form>
    </div>
  );
}

export default function AdminChangePasswordPage() {
  return (
    <AuthGuard requireAdmin allowPasswordChange>
      <ChangePasswordContent />
    </AuthGuard>
  );
}
