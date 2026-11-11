"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivityTask, Candidate } from "@/types/ict";
import {
  fetchMyActivityHub,
  saveActivityTaskDraft,
  submitActivityTask,
} from "@/lib/supabase/activity";
import { formatDateTimeTh } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";

function statusColor(status?: string) {
  if (status === "approved") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (status === "pending") return "bg-amber-100 text-amber-900 border-amber-200";
  if (status === "draft" || status === "rejected") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function statusLabel(status?: string) {
  if (status === "approved") return "ผ่าน";
  if (status === "pending") return "รออนุมัติ";
  if (status === "draft" || status === "rejected") return "แบบร่าง";
  return "ยังไม่ส่ง";
}

type Draft = {
  report_name?: string;
  report_detail?: string;
  video_url?: string;
  doc_url?: string;
};

export function ActivityTaskReportForm({
  candidate,
  taskId,
}: {
  candidate: Candidate;
  taskId: string;
}) {
  const [task, setTask] = useState<ActivityTask | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const hub = await fetchMyActivityHub(candidate.id, candidate.phone);
      const t = hub.tasks.find((x) => x.id === taskId) ?? null;
      setTask(t);
      if (t) {
        setDraft({
          report_name: t.submitted_report_name ?? "",
          report_detail: t.submitted_report_detail ?? "",
          video_url: t.video_url ?? t.report_url ?? "",
          doc_url: t.doc_url ?? t.file_path ?? "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดภารกิจไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [candidate.id, candidate.phone, taskId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSaveDraft = async () => {
    if (!task) return;
    setBusy("draft");
    setError("");
    setMessage("");
    const res = await saveActivityTaskDraft(candidate.id, candidate.phone, task.id, draft);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage("บันทึกแบบร่างแล้ว");
    await reload();
  };

  const onSubmit = async () => {
    if (!task) return;
    setBusy("submit");
    setError("");
    setMessage("");
    const res = await submitActivityTask(candidate.id, candidate.phone, task.id, draft);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage("ส่งรายงานแล้ว รออนุมัติ");
    await reload();
  };

  if (loading) {
    return <p className="text-sm text-gray-500 px-4 py-10">กำลังโหลด...</p>;
  }

  if (!task) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 space-y-4">
        <Link href="/portal/activity" className="text-sm font-semibold text-[var(--primary-blue)]">
          ← กลับกิจกรรม
        </Link>
        <p className="text-sm text-[var(--accent-red)]">ไม่พบภารกิจนี้ หรือยังไม่เปิดใช้งาน</p>
      </div>
    );
  }

  const canEdit = task.is_open && task.submission_status !== "approved";

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
      <Link href="/portal/activity" className="text-sm font-semibold text-[var(--primary-blue)]">
        ← กลับรายการภารกิจ
      </Link>

      <div className="bg-white dark:bg-slate-950 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm p-6 md:p-8 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--primary-blue)] dark:text-white">
              {task.activity_project_name || task.report_name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {task.score_points} คะแนน
              {task.include_deadline && task.report_deadline
                ? ` · กำหนดส่ง ${formatDateTimeTh(task.report_deadline)}`
                : ""}
            </p>
          </div>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor(task.submission_status)}`}
          >
            {statusLabel(task.submission_status)}
          </span>
        </div>

        {task.report_detail && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
            {task.report_detail}
          </div>
        )}

        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        {task.submission_status === "approved" && (
          <p className="text-sm text-emerald-700 font-semibold">ผ่านแล้ว — ได้คะแนนเข้ากระเป๋าแล้ว</p>
        )}
        {task.submission_status === "pending" && (
          <p className="text-sm text-amber-800">ส่งแล้ว รอผู้ตรวจอนุมัติ — สามารถแก้และส่งใหม่ได้</p>
        )}

        {canEdit && (
          <div className="space-y-3 pt-2">
            {task.include_report_name !== false && (
              <div>
                <label className="block text-sm font-semibold mb-1">ชื่อรายงาน</label>
                <input
                  className={inputClass}
                  value={draft.report_name ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, report_name: e.target.value }))}
                />
              </div>
            )}
            {task.include_detail && (
              <div>
                <label className="block text-sm font-semibold mb-1">รายละเอียด</label>
                <textarea
                  className={`${inputClass} min-h-[120px]`}
                  value={draft.report_detail ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, report_detail: e.target.value }))}
                />
              </div>
            )}
            {task.include_video_url !== false && (
              <div>
                <label className="block text-sm font-semibold mb-1">ลิงก์วิดีโอ</label>
                <input
                  className={inputClass}
                  placeholder="www… หรือ https://…"
                  value={draft.video_url ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, video_url: e.target.value }))}
                />
              </div>
            )}
            {task.include_doc_url !== false && (
              <div>
                <label className="block text-sm font-semibold mb-1">ลิงก์เอกสาร</label>
                <input
                  className={inputClass}
                  placeholder="www… หรือ https://…"
                  value={draft.doc_url ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, doc_url: e.target.value }))}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void onSaveDraft()}
                className="rounded-full border border-gray-300 bg-white text-[var(--primary-blue)] px-5 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                {busy === "draft" ? "กำลังบันทึก..." : "บันทึกแบบร่าง"}
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void onSubmit()}
                className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                {busy === "submit" ? "กำลังส่ง..." : "ส่งรายงาน"}
              </button>
            </div>
          </div>
        )}

        {task.reviewer_note && task.submission_status !== "approved" && (
          <p className="text-xs text-amber-800">หมายเหตุจากผู้ตรวจ: {task.reviewer_note}</p>
        )}
      </div>
    </div>
  );
}
