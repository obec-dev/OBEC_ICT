"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminCreate,
  adminList,
  adminResetPassword,
  adminSetActive,
  adminSetRole,
  generateTempPassword,
} from "@/lib/supabase/admin";
import { inputClass } from "@/lib/styles";
import type { AdminRole, AdminUser } from "@/types/ict";

function AdminsContent() {
  const { adminToken, adminUser } = useIctStore();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AdminRole>("admin");
  const [createdPassword, setCreatedPassword] = useState("");

  const reload = useCallback(async () => {
    if (!adminToken) return;
    const list = await adminList(adminToken);
    setRows(list);
  }, [adminToken]);

  useEffect(() => {
    void reload().catch((err) => setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ"));
  }, [reload]);

  const createAdmin = async () => {
    if (!adminToken) return;
    setError("");
    setInfo("");
    setCreatedPassword("");
    const temp = generateTempPassword();
    const result = await adminCreate(adminToken, {
      username,
      full_name: fullName,
      role,
      temp_password: temp,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreatedPassword(result.temp_password);
    setInfo("สร้างผู้ดูแลแล้ว — ส่งรหัสชั่วคราวให้ผู้ใช้ และบังคับเปลี่ยนตอน login ครั้งถัดไป");
    setUsername("");
    setFullName("");
    setRole("admin");
    await reload();
  };

  const resetPassword = async (target: AdminUser) => {
    if (!adminToken) return;
    const temp = generateTempPassword();
    const result = await adminResetPassword(adminToken, target.admin_id, temp);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreatedPassword(result.temp_password);
    setInfo(`รีเซ็ตรหัสผ่านของ ${target.username} แล้ว (บังคับเปลี่ยนตอน login ถัดไป)`);
  };

  const toggleActive = async (target: AdminUser) => {
    if (!adminToken) return;
    const result = await adminSetActive(adminToken, target.admin_id, !target.is_active);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
  };

  const changeRole = async (target: AdminUser, next: AdminRole) => {
    if (!adminToken) return;
    const result = await adminSetRole(adminToken, target.admin_id, next);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">จัดการผู้ดูแล</h1>
      <p className="text-gray-500 mb-6">เพิ่ม / ระงับ / รีเซ็ตรหัสผ่าน / เปลี่ยนบทบาท (super_admin เท่านั้น)</p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6 space-y-3">
        <h2 className="font-bold text-[var(--primary-blue)]">เพิ่มผู้ดูแลใหม่</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className={inputClass} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className={inputClass} placeholder="ชื่อ-นามสกุล" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            <option value="admin">admin (จัดการลงทะเบียน)</option>
            <option value="super_admin">super_admin (ทั้งหมด)</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => void createAdmin()}
          disabled={!username || !fullName}
          className="rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold disabled:opacity-40"
        >
          สร้างและ generate รหัสผ่าน
        </button>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {info && <p className="text-sm text-[var(--accent-green)] mb-3">{info}</p>}
      {createdPassword && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          รหัสผ่านชั่วคราว: <code className="font-bold text-lg">{createdPassword}</code>
          <div className="text-xs text-gray-600 mt-1">คัดลอกตอนนี้ — จะไม่แสดงซ้ำหลังรีเฟรช</div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--primary-blue)] text-white">
            <tr>
              <th className="text-left px-4 py-3">Username</th>
              <th className="text-left px-4 py-3">ชื่อ</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">สถานะ</th>
              <th className="text-left px-4 py-3">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.admin_id} className="border-t border-gray-100">
                <td className="px-4 py-3 font-semibold">
                  {row.username}
                  {row.admin_id === adminUser?.admin_id && (
                    <span className="ml-2 text-xs text-gray-400">(คุณ)</span>
                  )}
                </td>
                <td className="px-4 py-3">{row.full_name}</td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-lg border border-gray-200 px-2 py-1"
                    value={row.role}
                    onChange={(e) => void changeRole(row, e.target.value as AdminRole)}
                  >
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {row.is_active === false ? (
                    <span className="text-[var(--accent-red)] font-bold">ระงับ</span>
                  ) : row.must_change_password ? (
                    <span className="text-amber-700 font-bold">ต้องเปลี่ยนรหัส</span>
                  ) : (
                    <span className="text-[var(--accent-green)] font-bold">ใช้งานได้</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap space-x-3">
                  <button type="button" className="text-[var(--primary-blue)] font-bold" onClick={() => void resetPassword(row)}>
                    รีเซ็ตรหัส
                  </button>
                  <button type="button" className="text-[var(--accent-red)] font-bold" onClick={() => void toggleActive(row)}>
                    {row.is_active === false ? "เปิดใช้" : "ระงับ"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminAdminsPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["super_admin"]}>
      <AdminsContent />
    </AuthGuard>
  );
}
