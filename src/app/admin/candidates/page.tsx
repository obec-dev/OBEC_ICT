"use client";

import { useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import { getSiteProject } from "@/lib/siteSettings";
import { adminDeleteProfileRpc, adminSearchProfiles } from "@/lib/supabase/admin";
import { fetchExamProgressByProfiles } from "@/lib/supabase/data";
import { inputClass } from "@/lib/styles";
import type { Candidate, ExamProgress } from "@/types/ict";

function examStatusLabel(exam: ExamProgress | undefined): { text: string; className: string } {
  if (!exam) return { text: "ยังไม่เริ่มสอบ", className: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300" };
  if (exam.status === "submitted") {
    // Show pass/fail only after grading has been run
    if (exam.graded_at) {
      if (exam.passed === true) return { text: "ส่งแล้ว · ผ่าน", className: "bg-emerald-100 text-emerald-800" };
      if (exam.passed === false) return { text: "ส่งแล้ว · ไม่ผ่าน", className: "bg-red-100 text-red-800" };
    }
    return { text: "ส่งข้อสอบแล้ว", className: "bg-blue-100 text-blue-800" };
  }
  return { text: "ฉบับร่าง / กำลังทำ", className: "bg-amber-100 text-amber-800" };
}

function CandidatesContent() {
  const { adminToken, refreshData, candidates, getExamFor, unlockExamForCandidate, projects } =
    useIctStore();

  const siteProject = getSiteProject(projects);
  const projectId = siteProject?.id;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [examMap, setExamMap] = useState<Record<string, ExamProgress>>({});
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  const searchLocal = (q: string): Candidate[] => {
    const needle = q.toLowerCase();
    return candidates.filter(
      (c) =>
        c.id.toLowerCase().includes(needle) ||
        c.school_id.toLowerCase().includes(needle) ||
        c.first_name.toLowerCase().includes(needle) ||
        c.last_name.toLowerCase().includes(needle) ||
        c.full_name.toLowerCase().includes(needle) ||
        (c.phone || "").toLowerCase().includes(needle) ||
        (c.school_name || "").toLowerCase().includes(needle)
    );
  };

  const loadExamStatuses = async (rows: Candidate[]) => {
    const fromStore: Record<string, ExamProgress> = {};
    for (const row of rows) {
      const local = getExamFor(row.id, projectId);
      if (local) fromStore[row.id] = local;
    }
    try {
      const fromDb = await fetchExamProgressByProfiles(
        rows.map((r) => r.id),
        projectId
      );
      const merged = { ...fromStore };
      for (const exam of fromDb) {
        merged[exam.candidate_id] = exam;
      }
      setExamMap(merged);
    } catch {
      setExamMap(fromStore);
    }
  };

  const runSearch = async () => {
    if (!adminToken) return;
    const q = query.trim();
    if (!q) {
      setError("กรุณากรอกเลขบัตรประชาชนหรือรหัสโรงเรียน");
      return;
    }
    setError("");
    setMessage("");
    setLoading(true);
    setSearched(true);
    try {
      let rows: Candidate[] = [];
      try {
        rows = await adminSearchProfiles(adminToken, q, 50);
      } catch {
        rows = [];
      }
      if (rows.length === 0) rows = searchLocal(q);
      setResults(rows);
      await loadExamStatuses(rows);
      if (rows.length === 0) setError("ไม่พบผู้สมัครจากคำค้นหา");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const deleteOne = async (profileId: string) => {
    if (!adminToken) return;
    if (!confirm("ลบผู้สมัครรายนี้?")) return;
    const result = await adminDeleteProfileRpc(adminToken, profileId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setResults((prev) => prev.filter((p) => p.id !== profileId));
    setMessage("ลบผู้สมัครแล้ว");
    void refreshData();
  };

  const unlockExam = async (profileId: string) => {
    setUnlockingId(profileId);
    setError("");
    setMessage("");
    const result = await unlockExamForCandidate(profileId, projectId);
    setUnlockingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setExamMap((prev) => {
      const current = prev[profileId];
      if (!current) return prev;
      return {
        ...prev,
        [profileId]: {
          ...current,
          status: "draft",
          score: undefined,
          passed: undefined,
          graded_at: undefined,
          updated_at: new Date().toISOString(),
        },
      };
    });
    setMessage(
      result.updated > 0
        ? "ปลดล็อกข้อสอบแล้ว — ผู้สมัครสามารถแก้ไขคำตอบเดิมและส่งใหม่ได้"
        : "ไม่พบแถวข้อสอบที่ส่งแล้ว (อาจยังไม่เคยส่ง)"
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">จัดการ - การส่งข้อสอบ</h1>
      <p className="text-gray-500 dark:text-slate-400 mb-6">
        ค้นหาด้วยเลขบัตรประชาชนหรือรหัสโรงเรียน เพื่ออนุญาตให้แก้ไขข้อสอบที่ส่งแล้วได้
        {siteProject ? ` · โครงการ: ${siteProject.name}` : ""}
      </p>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className={inputClass}
            placeholder="เลขบัตรประชาชน หรือรหัสโรงเรียน"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runSearch();
              }
            }}
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading || !query.trim()}
            className="rounded-xl bg-[var(--primary-blue)] text-white dark:text-slate-900 px-6 py-3 font-bold disabled:opacity-40 shrink-0"
          >
            {loading ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          ปลดล็อกข้อสอบจะเปลี่ยนสถานะไปเป็นฉบับร่าง โดยคงคำตอบเดิมไว้ทั้งหมด
        </p>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-4 font-semibold">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-4 font-semibold">{message}</p>}

      {searched && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-x-auto shadow-sm">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[var(--primary-blue)] text-white dark:text-slate-900">
              <tr>
                <th className="text-left px-4 py-3">เลขบัตร</th>
                <th className="text-left px-4 py-3">ชื่อ-นามสกุล</th>
                <th className="text-left px-4 py-3">โรงเรียน</th>
                <th className="text-left px-4 py-3">สถานะสอบ</th>
                <th className="text-left px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p) => {
                const exam = examMap[p.id] || getExamFor(p.id, projectId);
                const status = examStatusLabel(exam);
                const canUnlock = exam?.status === "submitted";
                const showScore = Boolean(exam?.graded_at && exam.score != null);

                return (
                  <tr
                    key={p.id}
                    className="border-t border-gray-100 dark:border-slate-800 align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{p.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 dark:text-gray-100">{p.full_name}</div>
                      <div className="text-xs text-gray-500">{p.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-800 dark:text-gray-100">{p.school_name || "—"}</div>
                      <div className="text-xs font-mono text-gray-400">{p.school_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-full ${status.className}`}>
                        {status.text}
                      </span>
                      {showScore && <div className="text-xs text-gray-500 mt-1">คะแนน {exam?.score}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-row flex-wrap items-center gap-3">
                        {canUnlock && (
                          <button
                            type="button"
                            disabled={unlockingId === p.id}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-800 font-bold text-xs disabled:opacity-40"
                            onClick={() => void unlockExam(p.id)}
                          >
                            {unlockingId === p.id ? "กำลังปลดล็อก..." : "อนุญาตให้สอบใหม่ (Retake)"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[var(--accent-red)] font-bold text-xs"
                          onClick={() => void deleteOne(p.id)}
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    ไม่พบรายการ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminCandidatesPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["admin", "super_admin"]}>
      <CandidatesContent />
    </AuthGuard>
  );
}
