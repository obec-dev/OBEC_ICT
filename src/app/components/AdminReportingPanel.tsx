"use client";

import { useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminExportExamResponsesRpc,
  adminExportHierarchyRpc,
  adminExportParticipantsFullRpc,
  adminExportRegistrationDetailsRpc,
} from "@/lib/supabase/admin";
import { DEFAULT_PROJECT_ID } from "@/data/mockProjects";
import { mapAnswersByQuestionCode, reportPassLabel, reportQuestionHeader } from "@/lib/examReports";
import {
  flattenIctSurveyForCsv,
  ICT_SURVEY_CSV_COLUMNS,
} from "@/lib/registrationOptions";
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

function sortedQuestions(questions: ProjectQuestion[]) {
  return [...questions].sort((a, b) => {
    const codeA = reportQuestionHeader(a);
    const codeB = reportQuestionHeader(b);
    return codeA.localeCompare(codeB, "en", { numeric: true });
  });
}

type StatusProps = {
  busy: boolean;
  error: string;
  status: string;
};

function StatusLine({ error, status }: Omit<StatusProps, "busy">) {
  return (
    <>
      {error && <p className="text-xs text-[var(--accent-red)] mt-2">{error}</p>}
      {status && <p className="text-xs text-[var(--accent-green)] mt-2">{status}</p>}
    </>
  );
}

/** CSV/JSON exports for candidate exam answers — place inside ติดตามผลการทดสอบ. */
export function ExamResultsExportPanel() {
  const { adminToken, projects, questions } = useIctStore();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const siteProject = getSiteProject(projects);
  const projectId = siteProject?.id || DEFAULT_PROJECT_ID;
  const projectQuestions = sortedQuestions(questions.filter((q) => q.project_id === projectId));

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
        "อีเมลเข้าสู่ระบบ",
        "ชื่อ-นามสกุล",
        "รหัสโรงเรียน",
        "ชื่อโรงเรียน",
        "เบอร์โทร",
        "สถานะสอบ",
        "คะแนน",
        "ผลการสอบ",
        "ตรวจเมื่อ",
        "อัปเดตล่าสุด",
        ...projectQuestions.map((q) => reportQuestionHeader(q)),
      ];
      const rows = rowsData.map((e) => {
        const answers = e.answers || {};
        const questionAnswers = projectQuestions.map((q) => {
          const ans = answers[q.id] || "";
          const mapped = q.type === "mcq" ? answerToChoiceIndex(ans, q.options) : ans;
          return csvEscape(mapped);
        });
        return [
          csvEscape(e.login_email || e.email || ""),
          csvEscape(e.full_name || "N/A"),
          csvEscape(e.school_id || "N/A"),
          csvEscape(e.school_name || "N/A"),
          csvEscape(e.phone || "N/A"),
          csvEscape(e.status),
          e.score ?? "-",
          reportPassLabel(e),
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
      show(`ส่งออกรายละเอียดข้อสอบ CSV สำเร็จ (${rowsData.length} รายการ)`);
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
      const payload = rowsData.map((e) => ({
        login_email: e.login_email || e.email || "",
        candidate_name: e.full_name,
        school_id: e.school_id,
        school_name: e.school_name,
        phone: e.phone,
        status: e.status,
        score: e.score,
        passed: reportPassLabel(e),
        answers: mapAnswersByQuestionCode(e.answers, projectQuestions, answerToChoiceIndex),
      }));
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        JSON.stringify(payload, null, 2),
        `exam_responses_${projectId}_${timestamp}.json`,
        "application/json"
      );
      show(`ส่งออกรายละเอียดข้อสอบ JSON สำเร็จ (${rowsData.length} รายการ)`);
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
      <p className="text-sm font-bold text-emerald-900 mb-1">ส่งออกรายละเอียดการทำข้อสอบ</p>
      <p className="text-xs text-gray-600 mb-3">
        โครงการ: {siteProject?.name || projectId}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportExamCsv()}
          className="px-4 py-2 rounded-lg border border-emerald-300 bg-white text-emerald-900 font-bold text-xs disabled:opacity-40"
        >
          ส่งออกผลสอบ (CSV)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportExamJson()}
          className="px-4 py-2 rounded-lg border border-indigo-200 bg-white text-indigo-900 font-bold text-xs disabled:opacity-40"
        >
          ส่งออกผลสอบ (JSON)
        </button>
      </div>
      <StatusLine error={error} status={status} />
    </div>
  );
}

/** District / Partner summary downloads only. */
export function AnalyticsReportsPanel() {
  const { adminToken } = useIctStore();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const show = (msg: string, isErr = false) => {
    if (isErr) {
      setError(msg);
      setStatus("");
    } else {
      setStatus(msg);
      setError("");
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
              "พันธมิตร",
              "รหัสเขต",
              "ชื่อเขต",
              "รหัสโรงเรียน",
              "ชื่อโรงเรียน",
              "จังหวัด",
              "อีเมลเข้าสู่ระบบ",
              "ชื่อ-นามสกุล",
              "เบอร์โทร",
              "อีเมลติดต่อ",
              "บทบาท",
            ]
          : [
              "รหัสเขต",
              "ชื่อเขต",
              "จังหวัด",
              "รหัสโรงเรียน",
              "ชื่อโรงเรียน",
              "อีเมลเข้าสู่ระบบ",
              "ชื่อ-นามสกุล",
              "เบอร์โทร",
              "อีเมลติดต่อ",
              "บทบาท",
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
            csvEscape(String(r.login_email ?? r.email ?? r.profile_id ?? "")),
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
          csvEscape(String(r.login_email ?? r.email ?? r.profile_id ?? "")),
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
          ? `ส่งออกรายงานเครือข่ายพันธมิตรสำเร็จ (${rows.length} แถว)`
          : `ส่งออกรายงานโครงสร้างเขตพื้นที่สำเร็จ (${rows.length} แถว)`
      );
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  const exportParticipantsFull = async () => {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const rows = await adminExportParticipantsFullRpc(adminToken);
      const headers = [
        "หมายเลขสมาชิก",
        "ชื่อ-นามสกุล",
        "อีเมล",
        "เบอร์โทร",
        "บทบาท",
        "รหัสโรงเรียน",
        "ชื่อโรงเรียน",
        "จังหวัด",
        "รหัสเขต",
        "ชื่อเขต",
        "เครือข่าย/เขตควบคุม",
        "สถานะข้อสอบ",
        "ความคืบหน้าโดยรวม",
        "เรียนจบ",
        "วันส่งข้อสอบ",
        "วันตรวจข้อสอบ",
        "วันลงทะเบียน",
      ];
      const keys = [
        "member_id",
        "full_name",
        "email",
        "phone",
        "role",
        "school_id",
        "school_name",
        "province",
        "district_id",
        "district_name",
        "zone_partner",
        "exam_status",
        "overall_progress",
        "learn_completed",
        "exam_submitted_at",
        "exam_graded_at",
        "registered_at",
      ];
      const body = rows.map((r) => keys.map((h) => csvEscape(String(r[h] ?? ""))).join(","));
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        "\uFEFF" + [headers.join(","), ...body].join("\n"),
        `participants_full_${timestamp}.csv`,
        "text/csv;charset=utf-8;"
      );
      show(`ส่งออกข้อมูลผู้เข้าร่วมโครงการทั้งหมดสำเร็จ (${rows.length} แถว)`);
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  const exportRegistrationDetails = async () => {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const rows = await adminExportRegistrationDetailsRpc(adminToken);
      const surveyKeys = ICT_SURVEY_CSV_COLUMNS.map((c) => c.key);
      const surveyLabels = ICT_SURVEY_CSV_COLUMNS.map((c) => c.label);
      const headers = [
        "หมายเลขสมาชิก",
        "title_key",
        "คำนำหน้า (TH)",
        "คำนำหน้า (EN)",
        "คำนำหน้าอื่นๆ (TH)",
        "คำนำหน้าอื่นๆ (EN)",
        "ชื่อ",
        "นามสกุล",
        "ชื่อ (EN)",
        "นามสกุล (EN)",
        "เพศ",
        "วันเกิด",
        "เบอร์โทร",
        "Line ID",
        "อีเมลติดต่อ",
        "อีเมลเข้าสู่ระบบ",
        "ตำแหน่ง",
        "ตำแหน่งอื่นๆ",
        "หน้าที่",
        "รุ่น ICT Talent",
        ...surveyLabels,
        "บทบาท",
        "ผู้จัดการข้อมูลสถานศึกษา",
        "ชื่อผู้บังคับบัญชา/ผู้อนุมัติ",
        "รหัสโรงเรียน",
        "ชื่อโรงเรียน",
        "จังหวัด",
        "รหัสเขต",
        "ชื่อเขต",
        "พันธมิตร",
        "โรงเรียนลงทะเบียนแล้ว",
        "วันลงทะเบียน",
      ];
      const baseKeys = [
        "member_id",
        "title_key",
        "title_th",
        "title_en",
        "title_other_th",
        "title_other_en",
        "first_name",
        "last_name",
        "eng_first_name",
        "eng_last_name",
        "gender",
        "birth_date",
        "phone",
        "line_id",
        "contact_email",
        "login_email",
        "position",
        "position_other",
        "duty",
        "ict_talent_cohort",
      ];
      const tailKeys = [
        "portal_role",
        "is_school_admin",
        "approver",
        "school_id",
        "school_name",
        "province",
        "district_id",
        "district_name",
        "partner",
        "school_is_registered",
        "registered_at",
      ];
      const body = rows.map((r) => {
        const flat = flattenIctSurveyForCsv(r.ict_survey);
        const surveyValues = surveyKeys.map((k) =>
          csvEscape(String(r[k] ?? flat[k] ?? ""))
        );
        return [
          ...baseKeys.map((h) => csvEscape(String(r[h] ?? ""))),
          ...surveyValues,
          ...tailKeys.map((h) => csvEscape(String(r[h] ?? ""))),
        ].join(",");
      });
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        "\uFEFF" + [headers.join(","), ...body].join("\n"),
        `registration_details_${timestamp}.csv`,
        "text/csv;charset=utf-8;"
      );
      show(`ส่งออกข้อมูลการลงทะเบียนสำเร็จ (${rows.length} แถว)`);
    } catch (err) {
      show(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-black p-5">
      <h2 className="text-xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-1">
        รายงานและวิเคราะห์ข้อมูล
      </h2>
      <p className="text-xs text-gray-500 dark:text-white/70 mb-4">
        ดาวน์โหลดรายงานสรุประดับเขตพื้นที่ เครือข่ายพันธมิตร และข้อมูลผู้เข้าร่วม/การลงทะเบียน
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportHierarchy("district")}
          className="px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 font-bold text-xs disabled:opacity-40"
        >
          รายงานสรุปโครงสร้างเขตพื้นที่การศึกษา (CSV)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportHierarchy("partner")}
          className="px-4 py-2.5 rounded-lg border border-slate-400 bg-slate-100 text-slate-900 font-bold text-xs disabled:opacity-40"
        >
          รายงานสรุปเครือข่ายพันธมิตร (CSV)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportParticipantsFull()}
          className="px-4 py-2.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-900 font-bold text-xs disabled:opacity-40"
        >
          ดาวน์โหลดข้อมูลผู้เข้าร่วมโครงการทั้งหมด (Full Participant Data)
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportRegistrationDetails()}
          className="px-4 py-2.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 font-bold text-xs disabled:opacity-40"
        >
          ดาวน์โหลดข้อมูลการลงทะเบียน (Registration Details)
        </button>
      </div>
      <StatusLine error={error} status={status} />
    </section>
  );
}
