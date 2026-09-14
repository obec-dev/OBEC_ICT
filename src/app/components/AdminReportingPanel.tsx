"use client";

import { useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminExportExamResponsesRpc,
  adminExportHierarchyRpc,
} from "@/lib/supabase/admin";
import { DEFAULT_PROJECT_ID } from "@/data/mockProjects";
import { getSiteProject } from "@/lib/siteSettings";
import type { ProjectQuestion } from "@/types/ict";

function csvEscape(value: string) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function answerToChoiceIndex(answer: string, options: string[] | undefined): string {
  const raw = (answer || "").trim();
  if (!raw) return "";
  if (!options || options.length === 0) return raw;
  const idx = options.findIndex((o) => o.trim() === raw);
  if (idx >= 0) return String(idx + 1);
  if (/^\d+$/.test(raw)) return raw;
  return raw;
}

function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Reporting actions for Admin Overview (moved out of Answer Keys). */
export function AdminReportingPanel() {
  const { adminToken, projects, questions } = useIctStore();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const siteProject = getSiteProject(projects);
  const projectId = siteProject?.id || DEFAULT_PROJECT_ID;
  const projectQuestions = questions.filter((q) => q.project_id === projectId);

  const show = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setStatus("");
    } else {
      setStatus(msg);
      setError("");
    }
  };

  const exportExamCsv = async () => {
    if (!adminToken) return show("กรุณาเข้าสู่ระบบผู้ดูแลใหม่", true);
    setBusy(true);
    try {
      const rowsData = await adminExportExamResponsesRpc(adminToken, projectId);
      if (rowsData.length === 0) {
        show("ไม่พบข้อมูลการทำข้อสอบสำหรับส่งออก", true);
        return;
      }
      const headers = [
        "Candidate ID",
        "Full Name",
        "School ID",
        "School Name",
        "Phone",
        "Exam Status",
        "Score",
        "Passed",
        "Graded At",
        "Updated At",
        ...projectQuestions.map((q: ProjectQuestion, idx: number) => `Q${idx + 1} (${q.id})`),
      ];
      const rows = rowsData.map((e) => {
        const answers = e.answers || {};
        const questionAnswers = projectQuestions.map((q) => {
          const ans = answers[q.id] || "";
          const mapped = q.type === "mcq" ? answerToChoiceIndex(ans, q.options) : ans;
          return csvEscape(mapped);
        });
        return [
          csvEscape(e.profile_id),
          csvEscape(e.full_name || "N/A"),
          csvEscape(e.school_id || "N/A"),
          csvEscape(e.school_name || "N/A"),
          csvEscape(e.phone || "N/A"),
          csvEscape(e.status),
          e.score ?? "-",
          e.passed === undefined ? "-" : e.passed ? "PASSED" : "FAILED",
          csvEscape(e.graded_at || "-"),
          csvEscape(e.updated_at || "-"),
          ...questionAnswers,
        ].join(",");
      });
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        "\uFEFF" + [headers.join(","), ...rows].join("\n"),
        `exam_responses_${projectId}_${timestamp}.csv`,
        "text/csv;charset=utf-8;"
      );
      show(`ส่งออกข้อสอบ CSV สำเร็จ (${rowsData.length} รายการ)`);
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  const exportExamJson = async () => {
    if (!adminToken) return show("กรุณาเข้าสู่ระบบผู้ดูแลใหม่", true);
    setBusy(true);
    try {
      const rowsData = await adminExportExamResponsesRpc(adminToken, projectId);
      if (rowsData.length === 0) {
        show("ไม่พบข้อมูลการทำข้อสอบสำหรับส่งออก", true);
        return;
      }
      const payload = rowsData.map((e) => {
        const mappedAnswers: Record<string, string> = {};
        for (const q of projectQuestions) {
          const ans = e.answers?.[q.id] || "";
          mappedAnswers[q.id] = q.type === "mcq" ? answerToChoiceIndex(ans, q.options) : ans;
        }
        return {
          candidate_id: e.profile_id,
          candidate_name: e.full_name,
          school_id: e.school_id,
          school_name: e.school_name,
          phone: e.phone,
          status: e.status,
          score: e.score,
          passed: e.passed,
          answers: mappedAnswers,
        };
      });
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        JSON.stringify(payload, null, 2),
        `exam_responses_${projectId}_${timestamp}.json`,
        "application/json"
      );
      show(`ส่งออกข้อสอบ JSON สำเร็จ (${rowsData.length} รายการ)`);
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  const exportHierarchy = async (mode: "district" | "partner") => {
    if (!adminToken) return show("กรุณาเข้าสู่ระบบผู้ดูแลใหม่", true);
    setBusy(true);
    try {
      const rows = await adminExportHierarchyRpc(adminToken, mode);
      if (rows.length === 0) {
        show("ไม่พบข้อมูลสำหรับส่งออก", true);
        return;
      }
      const headers =
        mode === "partner"
          ? [
              "Partner",
              "District ID",
              "District Name",
              "School ID",
              "School Name",
              "Province",
              "National ID",
              "Full Name",
              "Phone",
              "Email",
              "Role",
            ]
          : [
              "District ID",
              "District Name",
              "Province",
              "School ID",
              "School Name",
              "National ID",
              "Full Name",
              "Phone",
              "Email",
              "Role",
            ];
      const body = rows.map((r) => {
        if (mode === "partner") {
          return [
            csvEscape(String(r.partner ?? "")),
            csvEscape(String(r.district_id ?? "")),
            csvEscape(String(r.district_name ?? "")),
            csvEscape(String(r.school_id ?? "")),
            csvEscape(String(r.school_name ?? "")),
            csvEscape(String(r.province ?? "")),
            csvEscape(String(r.profile_id ?? "")),
            csvEscape(String(r.full_name ?? "")),
            csvEscape(String(r.phone ?? "")),
            csvEscape(String(r.email ?? "")),
            csvEscape(String(r.portal_role ?? "")),
          ].join(",");
        }
        return [
          csvEscape(String(r.district_id ?? "")),
          csvEscape(String(r.district_name ?? "")),
          csvEscape(String(r.province ?? "")),
          csvEscape(String(r.school_id ?? "")),
          csvEscape(String(r.school_name ?? "")),
          csvEscape(String(r.profile_id ?? "")),
          csvEscape(String(r.full_name ?? "")),
          csvEscape(String(r.phone ?? "")),
          csvEscape(String(r.email ?? "")),
          csvEscape(String(r.portal_role ?? "")),
        ].join(",");
      });
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        "\uFEFF" + [headers.join(","), ...body].join("\n"),
        `${mode}_hierarchy_${timestamp}.csv`,
        "text/csv;charset=utf-8;"
      );
      show(
        mode === "partner"
          ? `ส่งออก Partner Network สำเร็จ (${rows.length} แถว)`
          : `ส่งออก District Hierarchy สำเร็จ (${rows.length} แถว)`
      );
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-black p-5">
      <h3 className="text-sm font-extrabold text-[var(--primary-blue)] dark:text-white mb-1">
        รายงาน / ส่งออกข้อมูล (CSV)
      </h3>
      <p className="text-xs text-gray-500 dark:text-white/70 mb-3">
        โครงการ: {siteProject?.name || projectId}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportExamCsv()}
          className="px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 font-bold text-xs disabled:opacity-40"
        >
          Export Answers (CSV)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportExamJson()}
          className="px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 font-bold text-xs disabled:opacity-40"
        >
          Export Answers (JSON)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportHierarchy("district")}
          className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 font-bold text-xs disabled:opacity-40"
        >
          District Hierarchy CSV
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportHierarchy("partner")}
          className="px-4 py-2 rounded-lg border border-slate-400 bg-slate-100 text-slate-900 font-bold text-xs disabled:opacity-40"
        >
          Partner Network CSV
        </button>
      </div>
      {error && <p className="text-xs text-[var(--accent-red)] mt-2">{error}</p>}
      {status && <p className="text-xs text-[var(--accent-green)] mt-2">{status}</p>}
    </div>
  );
}
