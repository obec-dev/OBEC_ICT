"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIctStore } from "@/contexts/IctStore";
import { fetchDistrictStats, parseDistrictIdList, setExecutivePassword, updateExecutiveProfile } from "@/lib/supabase/data";
import { inputClass } from "@/lib/styles";
import type { DistrictStat } from "@/types/ict";

export function ExecutiveProfileForm({ kind }: { kind: "business" | "audit" }) {
  const { session, syncExecutiveUser } = useIctStore();
  const user = session?.kind === kind ? session.user : null;
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [position, setPosition] = useState(user?.position ?? "");
  const [districts, setDistricts] = useState<string[]>(
    session?.kind === "audit" ? parseDistrictIdList(session.user.assigned_districts) : []
  );
  const [catalog, setCatalog] = useState<DistrictStat[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwMessage, setPwMessage] = useState("");
  const [pwOpen, setPwOpen] = useState(kind !== "audit");

  const assignedKey =
    session?.kind === "audit" ? parseDistrictIdList(session.user.assigned_districts).join("\u001f") : "";
  const formSource = user
    ? `${user.id}\u001f${user.display_name}\u001f${user.position ?? ""}\u001f${assignedKey}`
    : "";
  const [formSourceKey, setFormSourceKey] = useState(formSource);
  if (formSource !== formSourceKey) {
    setFormSourceKey(formSource);
    setDisplayName(user?.display_name ?? "");
    setPosition(user?.position ?? "");
    setDistricts(assignedKey ? assignedKey.split("\u001f") : []);
  }

  useEffect(() => {
    if (kind !== "audit") return;
    void fetchDistrictStats()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [kind]);

  const names = useMemo(() => {
    const map = new Map(catalog.map((d) => [d.district_id, d.district_name]));
    return map;
  }, [catalog]);

  const back = kind === "audit" ? "/portal/audit" : "/portal/business";
  const readOnlyAudit = kind === "audit";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // Auditor profile is read-only; only business executives can save here.
    if (!user || kind === "audit") return;
    setError("");
    setMessage("");
    setSaving(true);
    const result = await updateExecutiveProfile({
      kind: "business",
      loginId: user.login_email,
      displayName,
      position,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    syncExecutiveUser(result.user);
    setMessage("บันทึกโปรไฟล์แล้ว");
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setPwError("");
    setPwMessage("");
    if (newPassword.length < 8) {
      setPwError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("รหัสผ่านใหม่ไม่ตรงกัน");
      return;
    }
    setPwBusy(true);
    const result = await setExecutivePassword(kind, user.login_email, currentPassword, newPassword);
    setPwBusy(false);
    if (!result.ok) {
      setPwError(result.error);
      return;
    }
    setPwMessage("เปลี่ยนรหัสผ่านสำเร็จ");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 animate-fade-in-up space-y-6">
      <Link href={back} className="text-sm font-semibold text-[var(--primary-blue)]">
        ← กลับแดชบอร์ด
      </Link>

      <form
        onSubmit={(e) => void save(e)}
        className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-4"
      >
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">ตั้งค่าโปรไฟล์</h1>
        <p className="text-sm text-gray-500">
          {readOnlyAudit
            ? "โปรไฟล์ Auditor แก้ไขไม่ได้ — ติดต่อผู้ดูแลหากต้องการเปลี่ยนข้อมูล · เปลี่ยนรหัสผ่านได้ด้านล่าง"
            : "แก้ไขชื่อที่แสดงและตำแหน่ง"}
        </p>
        <div>
          <div className="text-sm font-semibold text-[var(--primary-blue)]">Login ID</div>
          <p className="mt-1 font-mono text-base text-gray-800">{user?.login_email || "—"}</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ชื่อที่แสดง</label>
          <input
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            disabled={readOnlyAudit}
            readOnly={readOnlyAudit}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ตำแหน่ง</label>
          <input
            className={inputClass}
            value={position ?? ""}
            onChange={(e) => setPosition(e.target.value)}
            disabled={readOnlyAudit}
            readOnly={readOnlyAudit}
          />
        </div>
        {kind === "audit" && (
          <div>
            <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">เขตที่รับผิดชอบ</label>
            <div className="flex flex-wrap gap-2">
              {districts.length === 0 && <p className="text-xs text-gray-400">ยังไม่ได้มอบหมายเขต</p>}
              {districts.map((id) => (
                <span
                  key={id}
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold bg-gray-50"
                >
                  {names.get(id) || id}
                </span>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {!readOnlyAudit && (
          <button
            type="submit"
            disabled={saving || !displayName.trim()}
            className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40"
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        )}
      </form>

      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-4">
        <button
          type="button"
          className="w-full flex items-center justify-between text-left"
          onClick={() => setPwOpen((v) => !v)}
          aria-expanded={pwOpen}
        >
          <h2 className="text-xl font-extrabold text-[var(--primary-blue)]">เปลี่ยนรหัสผ่าน</h2>
          <span className="text-xs text-gray-500 font-semibold">{pwOpen ? "ย่อ ▾" : "ขยาย ▸"}</span>
        </button>
        {pwOpen && (
          <form onSubmit={(e) => void resetPassword(e)} className="space-y-4">
            <p className="text-xs text-gray-500">กรอกรหัสผ่านปัจจุบัน (หรือรหัสชั่วคราว) แล้วตั้งรหัสใหม่</p>
            <div>
              <label className="block text-sm font-semibold mb-2">รหัสผ่านปัจจุบัน</label>
              <input
                type="password"
                className={inputClass}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">รหัสผ่านใหม่</label>
              <input
                type="password"
                className={inputClass}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">ยืนยันรหัสผ่านใหม่</label>
              <input
                type="password"
                className={inputClass}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {pwError && <p className="text-sm text-[var(--accent-red)]">{pwError}</p>}
            {pwMessage && <p className="text-sm text-emerald-700">{pwMessage}</p>}
            <button
              type="submit"
              disabled={pwBusy}
              className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40"
            >
              {pwBusy ? "กำลังบันทึก..." : "รีเซ็ตรหัสผ่าน"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
