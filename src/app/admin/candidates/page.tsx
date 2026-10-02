"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { Combobox } from "@/app/components/Combobox";
import { useIctStore } from "@/contexts/IctStore";
import { useExamAttemptFilters } from "@/hooks/useAdminUserFilters";
import { getSiteProject } from "@/lib/siteSettings";
import {
  adminDeleteExamProgressRpc,
  adminGetExamAnswersRpc,
  adminListExamProgressRpc,
  adminSearchProfiles,
  adminSearchUsers,
} from "@/lib/supabase/admin";
import { searchSchoolsByName } from "@/lib/supabase/data";
import { inputClass } from "@/lib/styles";
import { canAdminUnlockExam, countSubmittedLessons, hasPartialLessonSubmit } from "@/lib/lessonExamMap";
import type { Candidate, ExamProgress } from "@/types/ict";

function examStatusLabel(exam: ExamProgress | undefined): { text: string; className: string } {
  if (!exam) return { text: "ยังไม่เริ่มสอบ", className: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300" };
  if (exam.status === "submitted") {
    if (exam.graded_at) {
      if (exam.passed === true)
        return { text: "ส่งแล้ว · ผ่าน", className: "bg-emerald-100 text-emerald-800" };
      if (exam.passed === false)
        return { text: "ส่งแล้ว · ไม่ผ่าน", className: "bg-red-100 text-red-800" };
    }
    return { text: "ส่งข้อสอบแล้ว", className: "bg-blue-100 text-blue-800" };
  }
  if (hasPartialLessonSubmit(exam)) {
    const n = countSubmittedLessons(exam);
    return {
      text: n > 1 ? `ส่งบางบทแล้ว (${n} บท)` : "ส่งบางบทแล้ว",
      className: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
    };
  }
  return { text: "ฉบับร่าง / กำลังทำ", className: "bg-amber-100 text-amber-800" };
}

function CandidatesContent() {
  const { adminToken, refreshData, candidates, getExamFor, unlockExamForCandidate, projects } =
    useIctStore();

  const siteProject = getSiteProject(projects);
  const projectId = siteProject?.id;

  const [results, setResults] = useState<Candidate[]>([]);
  const [examMap, setExamMap] = useState<Record<string, ExamProgress>>({});
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [preloadedSchools, setPreloadedSchools] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answersLoadingId, setAnswersLoadingId] = useState<string | null>(null);
  const [detailAnswers, setDetailAnswers] = useState<Record<string, ExamProgress>>({});
  const [detailError, setDetailError] = useState("");

  const attemptRows = useMemo(
    () =>
      results.map((row) => ({
        ...row,
        login_email: row.login_email || row.email || "",
      })),
    [results]
  );
  const { filters, setFilters, filtered, schoolOptions, reset } = useExamAttemptFilters(attemptRows);

  const schoolComboboxOptions = useMemo(() => {
    const set = new Set<string>();
    for (const name of preloadedSchools) {
      if (name.trim()) set.add(name.trim());
    }
    for (const name of schoolOptions) {
      if (name.trim()) set.add(name.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th"));
  }, [preloadedSchools, schoolOptions]);

  const preloadSchools = useCallback(async () => {
    try {
      const rows = await searchSchoolsByName("", 200);
      const names = rows
        .map((s) => s.school_name?.trim())
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) {
        setPreloadedSchools(names);
        return;
      }
    } catch {
      /* fall through to candidate-derived names */
    }
    const fromCandidates = [
      ...new Set(
        candidates
          .map((c) => c.school_name?.trim())
          .filter((name): name is string => Boolean(name))
      ),
    ].sort((a, b) => a.localeCompare(b, "th"));
    if (fromCandidates.length > 0) setPreloadedSchools(fromCandidates);
  }, [candidates]);

  useEffect(() => {
    void preloadSchools();
  }, [preloadSchools]);

  const searchLocal = (q: string): Candidate[] => {
    const needle = q.toLowerCase();
    return candidates.filter(
      (c) =>
        c.id.toLowerCase().includes(needle) ||
        c.school_id.toLowerCase().includes(needle) ||
        c.first_name.toLowerCase().includes(needle) ||
        c.last_name.toLowerCase().includes(needle) ||
        c.full_name.toLowerCase().includes(needle) ||
        (c.login_email || "").toLowerCase().includes(needle) ||
        (c.email || "").toLowerCase().includes(needle) ||
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
      if (!adminToken) {
        setExamMap(fromStore);
        return;
      }
      const fromDb = await adminListExamProgressRpc(
        adminToken,
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
    setError("");
    setMessage("");
    setLoading(true);
    setSearched(true);
    try {
      let rows: Candidate[] = [];
      const q = [filters.loginId, filters.name, filters.schoolName].filter(Boolean).join(" ").trim();
      try {
        rows = await adminSearchUsers(adminToken, q, 200, false);
        if (rows.length === 0 && q) {
          rows = await adminSearchProfiles(adminToken, q, 50);
        }
      } catch {
        rows = [];
      }
      if (rows.length === 0) rows = searchLocal(q || " ");
      setResults(rows);
      await loadExamStatuses(rows);
      if (rows.length === 0) setError("ไม่พบผู้สมัครจากคำค้นหา");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  const clearExamData = async (profileId: string) => {
    if (!adminToken) return;
    if (
      !confirm(
        "ล้างข้อมูลข้อสอบของผู้สมัครรายนี้?\n(ลบเฉพาะความคืบหน้า/คำตอบข้อสอบ — โปรไฟล์ผู้สมัครยังคงอยู่)"
      )
    ) {
      return;
    }
    const result = await adminDeleteExamProgressRpc(adminToken, profileId, projectId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setExamMap((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    setDetailAnswers((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    if (expandedId === profileId) setExpandedId(null);
    setMessage(
      result.deleted > 0
        ? "ล้างข้อมูลข้อสอบแล้ว — โปรไฟล์ผู้สมัครยังคงอยู่ในระบบ"
        : "ไม่พบข้อมูลข้อสอบให้ลบ (โปรไฟล์ยังคงอยู่)"
    );
    void refreshData({ includeDistricts: true, includeLearning: false });
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
          lesson_submissions: {},
          score: undefined,
          passed: undefined,
          graded_at: undefined,
          updated_at: new Date().toISOString(),
        },
      };
    });
    setDetailAnswers((prev) => {
      const next = { ...prev };
      delete next[profileId];
      return next;
    });
    setMessage(
      result.updated > 0
        ? "ปลดล็อกข้อสอบแล้ว — ผู้สมัครสามารถแก้ไขคำตอบเดิมและส่งใหม่ได้"
        : "ไม่พบแถวข้อสอบที่ส่งแล้ว (อาจยังไม่เคยส่ง)"
    );
  };

  const toggleAnswersDrawer = async (profileId: string) => {
    if (expandedId === profileId) {
      setExpandedId(null);
      setDetailError("");
      return;
    }
    setExpandedId(profileId);
    setDetailError("");
    if (detailAnswers[profileId]) return;
    if (!adminToken) {
      setDetailError("กรุณาเข้าสู่ระบบผู้ดูแลใหม่");
      return;
    }
    setAnswersLoadingId(profileId);
    try {
      const full = await adminGetExamAnswersRpc(adminToken, profileId, projectId);
      if (full) {
        setDetailAnswers((prev) => ({ ...prev, [profileId]: full }));
        setExamMap((prev) => ({
          ...prev,
          [profileId]: {
            ...(prev[profileId] ?? full),
            ...full,
            // Keep slim list lesson map if detail somehow empty
            lesson_submissions:
              Object.keys(full.lesson_submissions || {}).length > 0
                ? full.lesson_submissions
                : prev[profileId]?.lesson_submissions,
          },
        }));
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "โหลดคำตอบไม่สำเร็จ");
    } finally {
      setAnswersLoadingId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">จัดการ - การส่งข้อสอบ</h1>
      <p className="text-gray-500 dark:text-slate-400 mb-6">
        ค้นหาด้วยอีเมลเข้าสู่ระบบ ชื่อผู้สมัคร หรือชื่อโรงเรียน เพื่ออนุญาตให้แก้ไขข้อสอบที่ส่งแล้วได้
        {siteProject ? ` · โครงการ: ${siteProject.name}` : ""}
      </p>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm p-6 mb-6 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className={inputClass}
            placeholder="ค้นหาอีเมลเข้าสู่ระบบ..."
            value={filters.loginId}
            onChange={(e) => setFilters((prev) => ({ ...prev, loginId: e.target.value }))}
          />
          <input
            className={inputClass}
            placeholder="ค้นหาชื่อผู้สมัคร..."
            value={filters.name}
            onChange={(e) => setFilters((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Combobox
            value={filters.schoolName}
            options={schoolComboboxOptions}
            placeholder="เลือกโรงเรียน"
            allLabel="โรงเรียนทั้งหมด"
            onChange={(value) => setFilters((prev) => ({ ...prev, schoolName: value }))}
            onOpen={() => {
              if (schoolComboboxOptions.length === 0) void preloadSchools();
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="rounded-xl bg-[var(--primary-blue)] text-white dark:text-slate-900 px-6 py-3 font-bold disabled:opacity-40"
          >
            {loading ? "กำลังค้นหา..." : "ค้นหา"}
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setError("");
              setMessage("");
            }}
            className="rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-800"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
        <p className="text-xs text-gray-400">
          การปลดล็อกข้อสอบจะเปลี่ยนสถานะไปเป็นฉบับร่าง ยกเลิกการล็อกแบบทดสอบรายบทที่ส่งแล้ว
          โดยคงคำตอบเดิมไว้ — ใช้ได้ทั้งส่งครบทุกบทและส่งบางบท (สถานะ &quot;ส่งบางบทแล้ว&quot;)
        </p>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-4 font-semibold">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-4 font-semibold">{message}</p>}

      {searched && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-x-auto shadow-sm">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-[var(--primary-blue)] text-white dark:text-slate-900">
              <tr>
                <th className="text-left px-4 py-3">อีเมลเข้าสู่ระบบ</th>
                <th className="text-left px-4 py-3">ชื่อ-นามสกุล</th>
                <th className="text-left px-4 py-3">โรงเรียน</th>
                <th className="text-left px-4 py-3">สถานะสอบ</th>
                <th className="text-left px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    ไม่พบรายการ
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const exam = examMap[row.id];
                  const status = examStatusLabel(exam);
                  const detail = detailAnswers[row.id];
                  const answerEntries = Object.entries(detail?.answers || {});
                  const isOpen = expandedId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className="border-t border-gray-100 dark:border-slate-800">
                        <td className="px-4 py-3 font-mono text-xs">{row.login_email || row.email || "-"}</td>
                        <td className="px-4 py-3 font-semibold">{row.full_name}</td>
                        <td className="px-4 py-3 text-xs">
                          {row.school_name || "-"}
                          <div className="text-gray-400">{row.school_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>
                            {status.text}
                          </span>
                          {exam?.score != null && (
                            <div className="mt-1 text-[11px] text-gray-500">คะแนน {exam.score}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleAnswersDrawer(row.id)}
                              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-800"
                            >
                              {isOpen ? "ปิดรายละเอียด" : "ดูคำตอบ"}
                            </button>
                            <button
                              type="button"
                              disabled={unlockingId === row.id || !canAdminUnlockExam(exam)}
                              onClick={() => void unlockExam(row.id)}
                              className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-40"
                            >
                              ปลดล็อก
                            </button>
                            <button
                              type="button"
                              onClick={() => void clearExamData(row.id)}
                              className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700"
                            >
                              ล้างข้อมูลสอบ
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50 dark:bg-slate-950/60">
                          <td colSpan={5} className="px-4 py-4">
                            {answersLoadingId === row.id ? (
                              <p className="text-xs text-gray-500">กำลังโหลดคำตอบ...</p>
                            ) : detailError && !detail ? (
                              <p className="text-xs text-[var(--accent-red)]">{detailError}</p>
                            ) : (
                              <div className="space-y-2 text-xs">
                                <p className="font-bold text-slate-700 dark:text-slate-200">
                                  คำตอบ ({answerEntries.length} ข้อ)
                                  {detail?.status ? ` · สถานะ ${detail.status}` : ""}
                                  {detail?.updated_at
                                    ? ` · อัปเดต ${new Date(detail.updated_at).toLocaleString("th-TH")}`
                                    : ""}
                                </p>
                                {answerEntries.length === 0 ? (
                                  <p className="text-gray-400">ยังไม่มีคำตอบในระบบ</p>
                                ) : (
                                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                                    <table className="w-full text-left">
                                      <thead className="bg-slate-100 dark:bg-slate-800 text-[11px]">
                                        <tr>
                                          <th className="px-3 py-2">รหัสข้อ</th>
                                          <th className="px-3 py-2">คำตอบ</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {answerEntries.map(([qid, ans]) => (
                                          <tr
                                            key={qid}
                                            className="border-t border-slate-100 dark:border-slate-800"
                                          >
                                            <td className="px-3 py-1.5 font-mono">{qid}</td>
                                            <td className="px-3 py-1.5">{ans || "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
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
