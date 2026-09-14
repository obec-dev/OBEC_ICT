"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIctStore } from "@/contexts/IctStore";
import { fetchDistrictStats, parseDistrictIdList, updateExecutiveProfile } from "@/lib/supabase/data";
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
  const [pick, setPick] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError("");
    setMessage("");
    setSaving(true);
    const result = await updateExecutiveProfile({
      kind,
      loginId: user.login_email,
      displayName,
      position,
      districts: kind === "audit" ? districts : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    syncExecutiveUser(
      kind === "audit"
        ? { ...result.user, assigned_districts: result.user.assigned_districts ?? [] }
        : result.user
    );
    setMessage("บันทึกโปรไฟล์แล้ว");
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-12 animate-fade-in-up">
      <Link href={back} className="text-sm font-semibold text-[var(--primary-blue)]">
        ← กลับแดชบอร์ด
      </Link>
      <form onSubmit={(e) => void save(e)} className="mt-4 bg-white rounded-3xl shadow-xl border border-gray-100 p-8 space-y-4">
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">ตั้งค่าโปรไฟล์</h1>
        <p className="text-sm text-gray-500">
          {kind === "audit"
            ? "แก้ไขชื่อที่แสดง ตำแหน่ง และเขตที่รับผิดชอบ"
            : "แก้ไขชื่อที่แสดงและตำแหน่ง"}
        </p>
        <div>
          <div className="text-sm font-semibold text-[var(--primary-blue)]">Login ID</div>
          <p className="mt-1 font-mono text-base text-gray-800">{user?.login_email || "—"}</p>
          <p className="text-xs text-gray-400 mt-1">ใช้สำหรับเข้าสู่ระบบ ไม่สามารถแก้ไขได้</p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ชื่อที่แสดง</label>
          <input className={inputClass} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">ตำแหน่ง</label>
          <input className={inputClass} value={position ?? ""} onChange={(e) => setPosition(e.target.value)} />
        </div>
        {kind === "audit" && (
          <div>
            <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">เขตที่รับผิดชอบ</label>
            <div className="flex gap-2">
              <select className={inputClass} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">เลือกเขต...</option>
                {catalog.map((d) => (
                  <option key={d.district_id} value={d.district_id}>
                    {d.district_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="shrink-0 rounded-xl bg-[var(--primary-blue)] text-white px-4 font-bold"
                onClick={() => {
                  if (!pick) return;
                  setDistricts((prev) => (prev.includes(pick) ? prev : [...prev, pick]));
                  setPick("");
                }}
              >
                เพิ่ม
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {districts.length === 0 && <p className="text-xs text-gray-400">ยังไม่ได้เลือกเขต</p>}
              {districts.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold"
                  onClick={() => setDistricts((prev) => prev.filter((x) => x !== id))}
                >
                  {names.get(id) || id} ×
                </button>
              ))}
            </div>
          </div>
        )}
        {error && (
          <p className="text-sm text-[var(--accent-red)]">
            {error}
            {/update_executive_profile|schema cache|function/i.test(error)
              ? " — รัน supabase/executive_dashboards_v1.sql"
              : ""}
          </p>
        )}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        <button
          type="submit"
          disabled={saving || !displayName.trim()}
          className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3.5 font-bold disabled:opacity-40"
        >
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </form>
    </div>
  );
}
