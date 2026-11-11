"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  auditorReviewSubmission,
  fetchAuditorActivityDashboard,
  fetchAuditorPending,
  fetchAuditorSchoolRadar,
  type AuditorPendingRow,
  type AuditorRadarSchool,
} from "@/lib/supabase/activity";
import { useIctStore } from "@/contexts/IctStore";
import { normalizeExternalUrl } from "@/lib/url";

function statusDot(status?: string | null) {
  if (status === "approved") return "bg-emerald-500";
  if (status === "pending") return "bg-amber-400";
  return "bg-slate-300";
}

const PAGE_SIZE = 10;

export function ActivityAuditorPanel() {
  const { session } = useIctStore();
  const user = session?.kind === "audit" ? session.user : null;
  const email = user?.login_email ?? "";

  const [error, setError] = useState("");
  const [dash, setDash] = useState<Awaited<ReturnType<typeof fetchAuditorActivityDashboard>> | null>(
    null
  );
  const [radar, setRadar] = useState<{
    tasks: { id: string; report_name: string; activity_project_name?: string | null }[];
    schools: AuditorRadarSchool[];
    tasks_total: number;
  } | null>(null);
  const [taskFilter, setTaskFilter] = useState<string>("");
  const [pending, setPending] = useState<AuditorPendingRow[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingPage, setPendingPage] = useState(1);
  const [canApprove, setCanApprove] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [radarOpen, setRadarOpen] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    if (!email) return;
    setError("");
    try {
      const [d, r, p] = await Promise.all([
        fetchAuditorActivityDashboard(email),
        fetchAuditorSchoolRadar(email, taskFilter || null),
        fetchAuditorPending(email, pendingPage, PAGE_SIZE),
      ]);
      setDash(d);
      setRadar({ tasks: r.tasks, schools: r.schools, tasks_total: r.tasks_total });
      setCanApprove(p.auditor_can_approve);
      if (p.auditor_can_approve) {
        setPending(p.rows);
        setPendingTotal(p.total);
      } else {
        setPending([]);
        setPendingTotal(0);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "โหลดไม่สำเร็จ — รัน supabase/activity_ux_polish_v1.sql"
      );
    }
  }, [email, taskFilter, pendingPage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maxBar = useMemo(() => {
    const rows = dash?.projects ?? [];
    return Math.max(1, ...rows.map((p) => p.passed + p.not_passed));
  }, [dash]);

  const pendingPages = Math.max(1, Math.ceil(pendingTotal / PAGE_SIZE));

  const schoolsWithUsers = useMemo(
    () => (radar?.schools ?? []).filter((s) => s.users.length > 0),
    [radar]
  );

  if (!user) return null;

  return (
    <div className="space-y-8 mt-10 border-t border-gray-100 dark:border-slate-800 pt-10">
      <div>
        <h2 className="text-2xl font-extrabold text-[var(--primary-blue)] dark:text-white">
          ติดตามกิจกรรมผู้ใช้
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          เขตความดูแล: {dash?.district_name || dash?.district_id || "ยังไม่กำหนด"}
        </p>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}

      {dash?.needs_district && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ยังไม่ได้กำหนดเขต — ติดต่อผู้ดูแลระบบ (Auditor ไม่สามารถแก้เขตเองได้)
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="โรงเรียนในเขต" value={dash?.stats.schools ?? "—"} />
        <Stat label="ผู้ใช้ในเขต" value={dash?.stats.users ?? "—"} />
        {canApprove && (
          <Stat label="รออนุมัติ" value={dash?.stats.pending_submissions ?? "—"} accent />
        )}
      </div>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
        <h3 className="font-extrabold text-[var(--primary-blue)] dark:text-white mb-4">
          แดชบอร์ดตามโครงการ (ผ่าน vs ยังไม่ผ่าน)
        </h3>
        <div className="space-y-4">
          {(dash?.projects ?? []).map((p) => {
            const total = p.passed + p.not_passed || 1;
            const passPct = (p.passed / maxBar) * 100;
            const failPct = (p.not_passed / maxBar) * 100;
            return (
              <div key={p.project_id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold">{p.project_name}</span>
                  <span className="text-xs text-gray-500">
                    ผ่าน {p.passed} · ยังไม่ผ่าน {p.not_passed} ({Math.round((p.passed / total) * 100)}%)
                  </span>
                </div>
                <div className="flex h-7 rounded-lg overflow-hidden bg-slate-100">
                  <div className="bg-emerald-500 transition-all" style={{ width: `${passPct}%` }} />
                  <div className="bg-slate-300 transition-all" style={{ width: `${failPct}%` }} />
                </div>
              </div>
            );
          })}
          {!dash?.projects?.length && (
            <p className="text-sm text-gray-500">ยังไม่มีภารกิจผูกโครงการ</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
        <button
          type="button"
          className="w-full flex flex-wrap items-center justify-between gap-3 text-left"
          onClick={() => setRadarOpen((v) => !v)}
          aria-expanded={radarOpen}
        >
          <h3 className="font-extrabold text-[var(--primary-blue)] dark:text-white">
            ความคืบหน้าภารกิจ
          </h3>
          <span className="text-xs text-gray-500 font-semibold">
            {radarOpen ? "ย่อ ▾" : `ขยาย ▸ (${schoolsWithUsers.length} โรงเรียน)`}
          </span>
        </button>

        {radarOpen && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <select
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              >
                <option value="">ทุกภารกิจ</option>
                {(radar?.tasks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.activity_project_name || t.report_name || t.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              {schoolsWithUsers.map((s) => {
                const open = expanded[s.school_id];
                return (
                  <div key={s.school_id} className="border border-gray-100 dark:border-slate-800 rounded-xl">
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 font-semibold flex justify-between"
                      onClick={() => setExpanded((e) => ({ ...e, [s.school_id]: !open }))}
                    >
                      <span>
                        {s.school_name}{" "}
                        <span className="text-xs font-normal text-gray-500">({s.users.length} คน)</span>
                      </span>
                      <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <ul className="px-4 pb-3 space-y-1.5 border-t border-gray-50 dark:border-slate-800 pt-2">
                        {s.users.map((u) => (
                          <li key={u.profile_id} className="flex items-center justify-between text-sm gap-2">
                            <span className="flex items-center gap-2">
                              {taskFilter ? (
                                <span
                                  className={`inline-block w-2.5 h-2.5 rounded-full ${statusDot(u.status)}`}
                                />
                              ) : null}
                              {u.first_name} {u.last_name}
                            </span>
                            <span className="text-xs tabular-nums text-gray-500">
                              {taskFilter
                                ? u.status === "approved"
                                  ? "ผ่าน"
                                  : u.status === "pending"
                                    ? "รออนุมัติ"
                                    : "ยังไม่ส่ง"
                                : `${u.done ?? 0}/${u.total ?? radar?.tasks_total ?? 0}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {!schoolsWithUsers.length && (
                <p className="text-sm text-gray-500">ไม่มีโรงเรียนที่มีผู้ใช้ในเขตนี้</p>
              )}
            </div>
          </div>
        )}
      </section>

      {canApprove && (
        <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
          <h3 className="font-extrabold text-[var(--primary-blue)] dark:text-white mb-4">
            คิวอนุมัติรายงาน
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            อนุมัติ → สถานะผู้ใช้เป็นผ่าน + ได้คะแนน · ไม่อนุมัติ → กลับเป็นแบบร่างและแจ้งเตือนผู้ใช้เมื่อเข้าสู่ระบบ
          </p>
          <div className="space-y-3">
            {pending.map((row) => (
              <div key={row.id} className="rounded-xl border p-4 space-y-2">
                <div className="font-bold text-sm">
                  {row.first_name} {row.last_name} · {row.school_name}
                </div>
                <div className="text-xs text-gray-500">
                  {row.report_name} · {row.score_points} คะแนน
                </div>
                {(row.video_url || row.report_url) && (
                  <a
                    href={normalizeExternalUrl(row.video_url || row.report_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline break-all block"
                  >
                    วิดีโอ: {row.video_url || row.report_url}
                  </a>
                )}
                {(row.doc_url || row.file_path) && (
                  <a
                    href={normalizeExternalUrl(row.doc_url || row.file_path)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline break-all block"
                  >
                    เอกสาร: {row.doc_url || row.file_path}
                  </a>
                )}
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="หมายเหตุ (ถ้ามี)"
                  value={note[row.id] ?? ""}
                  onChange={(e) => setNote((n) => ({ ...n, [row.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-xs font-bold"
                    onClick={() => {
                      void auditorReviewSubmission(email, row.id, true, note[row.id]).then((r) => {
                        if (!r.ok) setError(r.error);
                        else void reload();
                      });
                    }}
                  >
                    อนุมัติ
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-red-600 text-white px-4 py-1.5 text-xs font-bold"
                    title="ส่งกลับเป็นแบบร่างและแจ้งเตือนผู้ใช้"
                    onClick={() => {
                      void auditorReviewSubmission(email, row.id, false, note[row.id]).then((r) => {
                        if (!r.ok) setError(r.error);
                        else void reload();
                      });
                    }}
                  >
                    ไม่อนุมัติ (กลับแบบร่าง)
                  </button>
                </div>
              </div>
            ))}
            {!pending.length && <p className="text-sm text-gray-500">ไม่มีรายการรออนุมัติ</p>}
          </div>
          {pendingTotal > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 text-sm mt-4">
              <button
                type="button"
                className="rounded-full border px-3 py-1 font-bold disabled:opacity-40"
                disabled={pendingPage <= 1}
                onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
              >
                ก่อนหน้า
              </button>
              <span>
                หน้า {pendingPage} / {pendingPages}
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
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent
          ? "border-amber-200 bg-amber-50"
          : "border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950"
      }`}
    >
      <div className="text-xs text-gray-500 font-semibold">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums text-[var(--primary-blue)] dark:text-white mt-1">
        {value}
      </div>
    </div>
  );
}
