"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { Combobox } from "@/app/components/Combobox";
import { useIctStore } from "@/contexts/IctStore";
import { normalizeExternalUrl } from "@/lib/url";
import {
  adminDeleteActivityTask,
  adminDeleteAuditorDocument,
  adminDeleteLiveMeeting,
  adminListActivityTasks,
  adminListAuditorDocuments,
  adminListLiveMeetings,
  adminListPendingSubmissions,
  adminReviewSubmission,
  adminUpsertActivityTask,
  adminUpsertAuditorDocument,
  adminUpsertLiveMeeting,
} from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/client";
import { datetimeLocalToIso, isoToDatetimeLocal } from "@/lib/siteSettings";
import { inputClass } from "@/lib/styles";

type Tab = "tasks" | "approve" | "live" | "docs";
type TaskRow = Awaited<ReturnType<typeof adminListActivityTasks>>[number];
type LiveRow = Awaited<ReturnType<typeof adminListLiveMeetings>>[number];
type DocRow = Awaited<ReturnType<typeof adminListAuditorDocuments>>[number];
type PendingRow = Awaited<ReturnType<typeof adminListPendingSubmissions>>["rows"][number];

type TaskDraft = {
  id?: string;
  activity_project_name: string;
  activity_project_id?: string;
  include_report_name: boolean;
  include_detail: boolean;
  include_deadline: boolean;
  include_video_url: boolean;
  include_doc_url: boolean;
  report_deadline: string;
  score_points: number;
  is_open: boolean;
  activity_year: number;
  report_name: string;
};

function emptyDraft(): TaskDraft {
  return {
    activity_project_name: "",
    include_report_name: true,
    include_detail: false,
    include_deadline: false,
    include_video_url: true,
    include_doc_url: true,
    report_deadline: "",
    score_points: 10,
    is_open: false,
    activity_year: new Date().getFullYear(),
    report_name: "",
  };
}

function ActivitiesContent() {
  const { adminToken } = useIctStore();
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [lives, setLives] = useState<LiveRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [districts, setDistricts] = useState<{ district_id: string; district_name: string }[]>([]);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft());
  const [liveDraft, setLiveDraft] = useState<Partial<LiveRow>>({
    title: "Live meeting",
    youtube_url: "",
    window_start: "",
    window_end: "",
    score_points: 10,
    is_active: true,
  });
  const [docDraft, setDocDraft] = useState({
    id: "",
    district_id: "",
    title: "",
    file_url: "",
  });
  const [docFilterDistrict, setDocFilterDistrict] = useState("");
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [note, setNote] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pageSize = 10;

  const districtOptions = useMemo(
    () => districts.map((d) => ({ value: d.district_id, label: d.district_name })),
    [districts]
  );
  const districtNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of districts) map.set(d.district_id, d.district_name);
    return map;
  }, [districts]);
  const filteredDocs = useMemo(
    () => (docFilterDistrict ? docs.filter((d) => d.district_id === docFilterDistrict) : docs),
    [docs, docFilterDistrict]
  );

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError("");
    try {
      const [t, l, d] = await Promise.all([
        adminListActivityTasks(adminToken),
        adminListLiveMeetings(adminToken),
        adminListAuditorDocuments(adminToken),
      ]);
      setTasks(t);
      setLives(l);
      setDocs(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  const reloadPending = useCallback(async () => {
    if (!adminToken) return;
    try {
      const res = await adminListPendingSubmissions(adminToken, pendingPage, pageSize);
      setPending(res.rows);
      setPendingTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคิวอนุมัติไม่สำเร็จ");
    }
  }, [adminToken, pendingPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab === "approve") void reloadPending();
  }, [tab, reloadPending]);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("districts")
      .select("district_id, district_name")
      .order("district_name")
      .then(({ data }) => {
        setDistricts(
          (data ?? []).map((r) => ({
            district_id: String(r.district_id),
            district_name: String(r.district_name ?? r.district_id),
          }))
        );
      });
  }, []);

  const saveTask = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    if (!draft.id && !draft.activity_project_name.trim()) {
      setError("กรุณาระบุชื่อภารกิจ");
      return;
    }
    const deadlineIso =
      draft.include_deadline && draft.report_deadline
        ? datetimeLocalToIso(draft.report_deadline) || draft.report_deadline
        : null;
    const result = await adminUpsertActivityTask(adminToken, {
      id: draft.id,
      activity_project_id: draft.activity_project_id || null,
      activity_project_name: draft.activity_project_name || null,
      report_name: draft.activity_project_name.trim(),
      include_report_name: draft.include_report_name,
      include_detail: draft.include_detail,
      include_deadline: draft.include_deadline,
      include_video_url: draft.include_video_url,
      include_doc_url: draft.include_doc_url,
      report_deadline: deadlineIso,
      score_points: draft.score_points,
      is_open: draft.is_open,
      activity_year: draft.activity_year,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(draft.id ? "บันทึกภารกิจแล้ว" : "สร้างภารกิจแล้ว (ค่าเริ่มต้น: ปิดใช้งาน)");
    setDraft(emptyDraft());
    await reload();
  };

  const editTask = (t: TaskRow) => {
    setDraft({
      id: t.id,
      activity_project_name: t.activity_project_name || "",
      activity_project_id: t.activity_project_id,
      include_report_name: t.include_report_name,
      include_detail: t.include_detail,
      include_deadline: t.include_deadline,
      include_video_url: t.include_video_url,
      include_doc_url: t.include_doc_url,
      report_deadline: t.report_deadline ? isoToDatetimeLocal(t.report_deadline) : "",
      score_points: t.score_points,
      is_open: t.is_open,
      activity_year: t.activity_year,
      report_name: t.report_name,
    });
    setTab("tasks");
  };

  const saveLive = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    const start = datetimeLocalToIso(liveDraft.window_start || "");
    const end = datetimeLocalToIso(liveDraft.window_end || "");
    const result = await adminUpsertLiveMeeting(adminToken, {
      id: liveDraft.id,
      title: liveDraft.title,
      youtube_url: normalizeExternalUrl(liveDraft.youtube_url || "") || liveDraft.youtube_url,
      window_start: start,
      window_end: end,
      score_points: Number(liveDraft.score_points) || 0,
      is_active: liveDraft.is_active !== false,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("บันทึก Live meeting แล้ว");
    setLiveDraft({
      title: "Live meeting",
      youtube_url: "",
      window_start: "",
      window_end: "",
      score_points: 10,
      is_active: true,
    });
    await reload();
  };

  const saveDoc = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    const result = await adminUpsertAuditorDocument(adminToken, {
      id: docDraft.id || undefined,
      district_id: docDraft.district_id,
      title: docDraft.title,
      file_url: normalizeExternalUrl(docDraft.file_url) || docDraft.file_url,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(docDraft.id ? "แก้ไขเอกสารแล้ว" : "บันทึกเอกสารแล้ว");
    setDocDraft({ id: "", district_id: "", title: "", file_url: "" });
    await reload();
  };

  const pendingPages = Math.max(1, Math.ceil(pendingTotal / pageSize));

  const tabs: { id: Tab; label: string }[] = [
    { id: "tasks", label: "ภารกิจ / รายงาน" },
    { id: "approve", label: "คิวอนุมัติ" },
    { id: "live", label: "Live meeting" },
    { id: "docs", label: "เอกสาร Auditor" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">กิจกรรมและคะแนน</h1>
      <p className="text-gray-500 mb-6">
        การตั้งค่ากิจกรรมต่างๆ
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-bold border ${
              tab === t.id
                ? "bg-[var(--primary-blue)] text-white border-[var(--primary-blue)]"
                : "bg-white border-gray-200 text-[var(--primary-blue)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-3">{message}</p>}
      {loading && <p className="text-sm text-gray-500 mb-3">กำลังโหลด...</p>}

      {tab === "tasks" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
            <h2 className="font-bold text-[var(--primary-blue)]">
              {draft.id ? "แก้ไขภารกิจ" : "สร้างภารกิจใหม่"}
            </h2>
            <p className="text-xs text-gray-500">
              ภารกิจใหม่จะถูกสร้างเป็น <strong>ปิดใช้งาน</strong> เสมอ — หากเปิดใช้งาน ต้องไปเปิดที่ list ด้านล่าง
            </p>

            <label className="block text-sm font-semibold">ชื่อภารกิจ</label>
            <input
              className={inputClass}
              value={draft.activity_project_name}
              onChange={(e) => setDraft((d) => ({ ...d, activity_project_name: e.target.value }))}
              placeholder="เช่น รายงานภาคเรียน 1"
              disabled={Boolean(draft.id)}
            />
            {draft.activity_project_id && (
              <p className="text-xs text-gray-400 font-mono">Project ID: {draft.activity_project_id}</p>
            )}

            <div className="rounded-xl border border-gray-100 p-4 space-y-2">
              <p className="text-sm font-semibold text-[var(--primary-blue)]">
                ช่องที่จะให้ผู้ใช้ต้องกรอกเมื่อส่งรายงาน
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.include_report_name}
                  onChange={(e) => setDraft((d) => ({ ...d, include_report_name: e.target.checked }))}
                />
                ชื่อรายงาน
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.include_detail}
                  onChange={(e) => setDraft((d) => ({ ...d, include_detail: e.target.checked }))}
                />
                รายละเอียด
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.include_deadline}
                  onChange={(e) => setDraft((d) => ({ ...d, include_deadline: e.target.checked }))}
                />
                กำหนดส่ง
              </label>
              {draft.include_deadline && (
                <input
                  type="datetime-local"
                  className={inputClass}
                  value={draft.report_deadline}
                  onChange={(e) => setDraft((d) => ({ ...d, report_deadline: e.target.value }))}
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.include_video_url}
                  onChange={(e) => setDraft((d) => ({ ...d, include_video_url: e.target.checked }))}
                />
                ลิงก์วิดีโอ
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.include_doc_url}
                  onChange={(e) => setDraft((d) => ({ ...d, include_doc_url: e.target.checked }))}
                />
                ลิงก์เอกสาร
              </label>
            </div>

            <label className="block text-sm font-semibold">คะแนน</label>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={draft.score_points}
              onChange={(e) => setDraft((d) => ({ ...d, score_points: Number(e.target.value) }))}
            />

            {draft.id && (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={draft.is_open}
                  onChange={(e) => setDraft((d) => ({ ...d, is_open: e.target.checked }))}
                />
                เปิดใช้งานภารกิจนี้
              </label>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveTask()}
                className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold"
              >
                บันทึก
              </button>
              {draft.id && (
                <button
                  type="button"
                  onClick={() => setDraft(emptyDraft())}
                  className="rounded-full border px-5 py-2.5 font-bold"
                >
                  ยกเลิกแก้ไข
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y">
            <div className="p-4 text-sm font-bold text-[var(--primary-blue)]">รายการภารกิจทั้งหมด</div>
            {tasks.map((t) => (
              <div key={t.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-[var(--primary-blue)]">
                    {t.activity_project_name || t.report_name}{" "}
                    <span className="text-xs font-normal text-gray-500">
                      {t.is_open ? "· เปิด" : "· ปิด"} · {t.score_points} คะแนน
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">ID: {t.activity_project_id || "—"}</div>
                  <div className="text-xs text-gray-500">
                    ส่ง {t.submission_count} · รอ {t.pending_count} · ผ่าน {t.approved_count}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!t.is_open && (
                    <button
                      type="button"
                      className="text-sm font-bold text-emerald-700 underline"
                      onClick={() => {
                        if (!adminToken) return;
                        void adminUpsertActivityTask(adminToken, {
                          id: t.id,
                          is_open: true,
                          activity_project_id: t.activity_project_id,
                          report_name: t.report_name,
                          include_report_name: t.include_report_name,
                          include_detail: t.include_detail,
                          include_deadline: t.include_deadline,
                          include_video_url: t.include_video_url,
                          include_doc_url: t.include_doc_url,
                          score_points: t.score_points,
                          activity_year: t.activity_year,
                          report_deadline: t.report_deadline || null,
                        }).then(() => reload());
                      }}
                    >
                      เปิดใช้งาน
                    </button>
                  )}
                  {t.is_open && (
                    <button
                      type="button"
                      className="text-sm font-bold text-amber-700 underline"
                      onClick={() => {
                        if (!adminToken) return;
                        void adminUpsertActivityTask(adminToken, {
                          id: t.id,
                          is_open: false,
                          activity_project_id: t.activity_project_id,
                          report_name: t.report_name,
                          include_report_name: t.include_report_name,
                          include_detail: t.include_detail,
                          include_deadline: t.include_deadline,
                          include_video_url: t.include_video_url,
                          include_doc_url: t.include_doc_url,
                          score_points: t.score_points,
                          activity_year: t.activity_year,
                          report_deadline: t.report_deadline || null,
                        }).then(() => reload());
                      }}
                    >
                      ปิด
                    </button>
                  )}
                  <button type="button" className="text-sm font-bold underline" onClick={() => editTask(t)}>
                    แก้ไข
                  </button>
                  <button
                    type="button"
                    className="text-sm font-bold text-[var(--accent-red)]"
                    onClick={() => {
                      if (!adminToken || !confirm("ลบภารกิจนี้?")) return;
                      void adminDeleteActivityTask(adminToken, t.id).then(() => reload());
                    }}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
            {!tasks.length && !loading && <p className="p-4 text-sm text-gray-500">ยังไม่มีภารกิจ</p>}
          </div>
        </div>
      )}

      {tab === "approve" && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            อนุมัติแล้วสถานะผู้ใช้เป็น <span className="font-semibold text-emerald-700">ผ่าน</span> และได้คะแนน ·
            ไม่อนุมัติจะส่งกลับเป็น <span className="font-semibold">แบบร่าง</span> พร้อมแจ้งเตือนผู้ใช้เมื่อเข้าสู่ระบบครั้งถัดไป
          </p>
          <div className="bg-white rounded-2xl border divide-y">
            {pending.map((row) => (
              <div key={row.id} className="p-4 space-y-2">
                <div className="font-bold text-sm">
                  {row.first_name} {row.last_name} · {row.school_name}
                </div>
                <div className="text-xs text-gray-500">
                  {row.activity_project_name || row.report_name} · {row.score_points} คะแนน
                </div>
                {row.video_url && (
                  <a href={row.video_url} target="_blank" rel="noreferrer" className="text-xs underline block break-all">
                    วิดีโอ: {row.video_url}
                  </a>
                )}
                {row.doc_url && (
                  <a href={row.doc_url} target="_blank" rel="noreferrer" className="text-xs underline block break-all">
                    เอกสาร: {row.doc_url}
                  </a>
                )}
                <input
                  className={inputClass}
                  placeholder="หมายเหตุ"
                  value={note[row.id] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [row.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-xs font-bold"
                    onClick={() => {
                      if (!adminToken) return;
                      void adminReviewSubmission(adminToken, row.id, true, note[row.id]).then((r) => {
                        if (!r.ok) setError(r.error);
                        else void reloadPending();
                      });
                    }}
                  >
                    อนุมัติ
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-red-600 text-white px-4 py-1.5 text-xs font-bold"
                    onClick={() => {
                      if (!adminToken) return;
                      void adminReviewSubmission(adminToken, row.id, false, note[row.id]).then((r) => {
                        if (!r.ok) setError(r.error);
                        else void reloadPending();
                      });
                    }}
                    title="ส่งกลับเป็นแบบร่างและแจ้งเตือนผู้ใช้"
                  >
                    ไม่อนุมัติ (กลับแบบร่าง)
                  </button>
                </div>
              </div>
            ))}
            {!pending.length && <p className="p-4 text-sm text-gray-500">ไม่มีรายการรออนุมัติ</p>}
          </div>
          {pendingTotal > pageSize && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                type="button"
                className="rounded-full border px-3 py-1 font-bold disabled:opacity-40"
                disabled={pendingPage <= 1}
                onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
              >
                ก่อนหน้า
              </button>
              <span>
                หน้า {pendingPage} / {pendingPages} ({pendingTotal} รายการ)
              </span>
              <button
                type="button"
                className="rounded-full border px-3 py-1 font-bold disabled:opacity-40"
                disabled={pendingPage >= pendingPages}
                onClick={() => setPendingPage((p) => p + 1)}
              >
                ถัดไป
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "live" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border p-6 space-y-3">
            <h2 className="font-bold text-[var(--primary-blue)]">ตั้งค่า Live meeting</h2>
            <input
              className={inputClass}
              placeholder="ชื่อ"
              value={liveDraft.title || ""}
              onChange={(e) => setLiveDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <input
              className={inputClass}
              placeholder="Live URL"
              value={liveDraft.youtube_url || ""}
              onChange={(e) => setLiveDraft((d) => ({ ...d, youtube_url: e.target.value }))}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="datetime-local"
                className={inputClass}
                value={liveDraft.window_start || ""}
                onChange={(e) => setLiveDraft((d) => ({ ...d, window_start: e.target.value }))}
              />
              <input
                type="datetime-local"
                className={inputClass}
                value={liveDraft.window_end || ""}
                onChange={(e) => setLiveDraft((d) => ({ ...d, window_end: e.target.value }))}
              />
            </div>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={liveDraft.score_points ?? 0}
              onChange={(e) => setLiveDraft((d) => ({ ...d, score_points: Number(e.target.value) }))}
            />
            <button
              type="button"
              onClick={() => void saveLive()}
              className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold"
            >
              บันทึก Live
            </button>
          </div>
          <div className="bg-white rounded-2xl border divide-y">
            {lives.map((m) => {
              const expired = Boolean(m.window_end && new Date(m.window_end).getTime() < Date.now());
              return (
                <div key={m.id} className="p-4 flex justify-between gap-3">
                  <div>
                    <div className="font-bold flex flex-wrap items-center gap-2">
                      {m.title}
                      {expired && (
                        <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                          หมดเวลา
                        </span>
                      )}
                      {!m.is_active && (
                        <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                          ปิดใช้งาน
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 break-all">{m.youtube_url}</div>
                  </div>
                  <button
                    type="button"
                    className="text-sm font-bold text-[var(--accent-red)]"
                    onClick={() => {
                      if (!adminToken || !confirm("ลบ?")) return;
                      void adminDeleteLiveMeeting(adminToken, m.id).then(() => reload());
                    }}
                  >
                    ลบ
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "docs" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border p-6 space-y-3">
            <h2 className="font-bold text-[var(--primary-blue)]">
              {docDraft.id ? "แก้ไขเอกสาร" : "เพิ่มเอกสาร Auditor"}
            </h2>
            <Combobox
              label="เขต"
              value={docDraft.district_id}
              options={districtOptions}
              placeholder="ค้นหา / เลือกเขต"
              allLabel="— เลือกเขต —"
              onChange={(v) => setDocDraft((d) => ({ ...d, district_id: v }))}
            />
            <input
              className={inputClass}
              placeholder="ชื่อเอกสาร"
              value={docDraft.title}
              onChange={(e) => setDocDraft((d) => ({ ...d, title: e.target.value }))}
            />
            <input
              className={inputClass}
              placeholder="URL ไฟล์ (เช่น www.example.com หรือ https://…)"
              value={docDraft.file_url}
              onChange={(e) => setDocDraft((d) => ({ ...d, file_url: e.target.value }))}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void saveDoc()}
                className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold"
              >
                {docDraft.id ? "บันทึกการแก้ไข" : "บันทึกเอกสาร"}
              </button>
              {docDraft.id && (
                <button
                  type="button"
                  className="rounded-full border px-5 py-2.5 font-bold"
                  onClick={() => setDocDraft({ id: "", district_id: "", title: "", file_url: "" })}
                >
                  ยกเลิก
                </button>
              )}
            </div>
          </div>
          <div className="bg-white rounded-2xl border p-4 space-y-3">
            <Combobox
              label="กรองรายการตามเขต"
              value={docFilterDistrict}
              options={districtOptions}
              placeholder="ทุกเขต"
              allLabel="ทุกเขต"
              onChange={setDocFilterDistrict}
            />
            <div className="divide-y border rounded-xl">
              {filteredDocs.map((d) => (
                <div key={d.id} className="p-4 flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-bold">{d.title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {districtNameById.get(d.district_id) || d.district_id}
                    </div>
                    {d.file_url && (
                      <a
                        href={normalizeExternalUrl(d.file_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline text-[var(--primary-blue)] break-all"
                      >
                        {d.file_url}
                      </a>
                    )}
                  </div>
                  <div className="flex gap-3 items-start">
                    <button
                      type="button"
                      className="text-sm font-bold text-[var(--primary-blue)]"
                      onClick={() =>
                        setDocDraft({
                          id: d.id,
                          district_id: d.district_id,
                          title: d.title,
                          file_url: d.file_url || "",
                        })
                      }
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="text-sm font-bold text-[var(--accent-red)]"
                      onClick={() => {
                        if (!adminToken || !confirm("ลบ?")) return;
                        void adminDeleteAuditorDocument(adminToken, d.id).then(() => reload());
                      }}
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              ))}
              {!filteredDocs.length && (
                <p className="p-4 text-sm text-gray-500">ยังไม่มีเอกสาร</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function AdminActivitiesPage() {
  return (
    <AuthGuard requireAdmin>
      <ActivitiesContent />
    </AuthGuard>
  );
}
