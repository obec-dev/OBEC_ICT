"use client";

import { useEffect, useRef, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminDeleteProfileRpc,
  adminDeleteSchoolProfilesRpc,
  adminListProfilesBySchool,
  adminUpdateProfileRpc,
} from "@/lib/supabase/admin";
import { searchSchoolsByName } from "@/lib/supabase/data";
import { disabledInputClass, inputClass } from "@/lib/styles";
import type { Candidate, School } from "@/types/ict";

function RegistrationsContent() {
  const { lookupSchool, adminToken, refreshData } = useIctStore();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<School[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [school, setSchool] = useState<School | null>(null);
  const [profiles, setProfiles] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestLoading(true);
    const timer = window.setTimeout(() => {
      void searchSchoolsByName(q, 12)
        .then((rows) => {
          if (!cancelled) {
            setSuggestions(rows);
            setSuggestOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const loadBySchool = async (found: School) => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    setLoading(true);
    setSuggestOpen(false);
    try {
      setSchool(found);
      setQuery(`${found.school_name} (${found.school_id})`);
      const rows = await adminListProfilesBySchool(adminToken, found.school_id);
      setProfiles(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const searchSchool = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    setLoading(true);
    setSuggestOpen(false);
    try {
      const q = query.trim();
      // Prefer exact school_id if typed
      const byId = await lookupSchool(q);
      if (byId) {
        await loadBySchool(byId);
        return;
      }
      const hits = await searchSchoolsByName(q, 20);
      if (hits.length === 1) {
        await loadBySchool(hits[0]);
        return;
      }
      if (hits.length > 1) {
        setSuggestions(hits);
        setSuggestOpen(true);
        setSchool(null);
        setProfiles([]);
        setError("พบหลายโรงเรียน — เลือกรายการจากรายการแนะนำ");
        return;
      }
      setSchool(null);
      setProfiles([]);
      setError("ไม่พบโรงเรียนจากชื่อหรือรหัสที่ค้นหา");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (p: Candidate) => {
    setEditingId(p.id);
    setEditFirst(p.first_name);
    setEditLast(p.last_name);
    setEditPhone(p.phone);
    setEditRemark(p.remark ?? "");
  };

  const saveEdit = async () => {
    if (!adminToken || !editingId || !school) return;
    const result = await adminUpdateProfileRpc(adminToken, {
      profile_id: editingId,
      first_name: editFirst,
      last_name: editLast,
      phone: editPhone,
      remark: editRemark,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("บันทึกผู้สมัครแล้ว");
    setEditingId(null);
    const rows = await adminListProfilesBySchool(adminToken, school.school_id);
    setProfiles(rows);
    void refreshData();
  };

  const deleteOne = async (profileId: string) => {
    if (!adminToken || !school) return;
    if (!confirm(`ลบผู้สมัคร ${profileId}?`)) return;
    const result = await adminDeleteProfileRpc(adminToken, profileId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("ลบผู้สมัครแล้ว");
    const rows = await adminListProfilesBySchool(adminToken, school.school_id);
    setProfiles(rows);
    void refreshData();
  };

  const deleteAll = async () => {
    if (!adminToken || !school) return;
    if (!confirm(`ลบผู้สมัครทั้งหมดของโรงเรียน ${school.school_name}?`)) return;
    const result = await adminDeleteSchoolProfilesRpc(adminToken, school.school_id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`ลบแล้ว ${result.deleted_count} รายการ`);
    setProfiles([]);
    void refreshData();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">จัดการลงทะเบียน</h1>
      <p className="text-gray-500 mb-6">
        ค้นด้วยชื่อโรงเรียนหรือรหัสโรงเรียน (มี auto-suggest) แล้วแก้ไข/ลบผู้สมัคร
      </p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
        <div ref={wrapRef} className="relative flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              className={inputClass}
              placeholder="พิมพ์ชื่อโรงเรียน หรือรหัส เช่น พญาไท / 1010720001"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void searchSchool();
                }
              }}
            />
            {suggestOpen && (suggestions.length > 0 || suggestLoading) && (
              <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                {suggestLoading && (
                  <li className="px-4 py-3 text-sm text-gray-400">กำลังค้นหา...</li>
                )}
                {suggestions.map((s) => (
                  <li key={s.school_id}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                      onClick={() => void loadBySchool(s)}
                    >
                      <div className="font-semibold text-gray-800">{s.school_name}</div>
                      <div className="text-xs text-gray-500">
                        {s.school_id} · {s.area_zone} · {s.province}
                        {s.is_registered ? " · ลงทะเบียนแล้ว" : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => void searchSchool()}
            disabled={loading || !query.trim()}
            className="rounded-xl bg-[var(--primary-blue)] text-white px-6 py-3 font-bold disabled:opacity-40"
          >
            {loading ? "กำลังโหลด..." : "ค้นหา"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-4">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-4">{message}</p>}

      {school && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500">ชื่อโรงเรียน</label>
              <input className={disabledInputClass} value={school.school_name} disabled />
            </div>
            <div>
              <label className="text-xs text-gray-500">เขต / จังหวัด</label>
              <input className={disabledInputClass} value={`${school.area_zone} · ${school.province}`} disabled />
            </div>
          </div>

          <div className="flex justify-between items-center">
            <h2 className="font-bold text-[var(--primary-blue)]">ผู้สมัคร {profiles.length} คน</h2>
            <button
              type="button"
              onClick={() => void deleteAll()}
              disabled={profiles.length === 0}
              className="text-sm font-bold text-[var(--accent-red)] disabled:opacity-40"
            >
              ลบทั้งโรงเรียน
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--primary-blue)] text-white">
                <tr>
                  <th className="text-left px-4 py-3">เลขบัตร</th>
                  <th className="text-left px-4 py-3">ชื่อ-นามสกุล</th>
                  <th className="text-left px-4 py-3">โทร</th>
                  <th className="text-left px-4 py-3">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-mono text-xs">{p.id}</td>
                    <td className="px-4 py-3">
                      {editingId === p.id ? (
                        <div className="flex gap-2">
                          <input className={inputClass} value={editFirst} onChange={(e) => setEditFirst(e.target.value)} />
                          <input className={inputClass} value={editLast} onChange={(e) => setEditLast(e.target.value)} />
                        </div>
                      ) : (
                        p.full_name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === p.id ? (
                        <div className="space-y-2">
                          <input className={inputClass} value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                          <input
                            className={inputClass}
                            placeholder="หมายเหตุ"
                            value={editRemark}
                            onChange={(e) => setEditRemark(e.target.value)}
                          />
                        </div>
                      ) : (
                        p.phone
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {editingId === p.id ? (
                        <>
                          <button type="button" className="text-[var(--accent-green)] font-bold mr-3" onClick={() => void saveEdit()}>
                            บันทึก
                          </button>
                          <button type="button" className="text-gray-500" onClick={() => setEditingId(null)}>
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="text-[var(--primary-blue)] font-bold mr-3" onClick={() => startEdit(p)}>
                            แก้ไข
                          </button>
                          <button type="button" className="text-[var(--accent-red)] font-bold" onClick={() => void deleteOne(p.id)}>
                            ลบ
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {profiles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                      ยังไม่มีผู้สมัครในโรงเรียนนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminRegistrationsPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["admin", "super_admin"]}>
      <RegistrationsContent />
    </AuthGuard>
  );
}
