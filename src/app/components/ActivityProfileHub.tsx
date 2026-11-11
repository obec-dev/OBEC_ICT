"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Candidate, ScoreRankRow } from "@/types/ict";
import {
  checkinLiveMeeting,
  fetchMyActivityHub,
  fetchScoreRanking,
} from "@/lib/supabase/activity";
import {
  creditSelfLearnVideo,
  listSelfLearnVideos,
  type SelfLearnVideo,
} from "@/lib/supabase/selfLearn";
import { formatDateTimeTh } from "@/lib/siteSettings";
import { normalizeExternalUrl } from "@/lib/url";

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

function taskCta(status?: string) {
  if (status === "approved") return "ดูรายละเอียด";
  if (status === "draft" || status === "rejected") return "แก้แบบร่าง / ส่งต่อ";
  if (status === "pending") return "ดู / แก้ไขรายงาน";
  return "สร้างรายงาน";
}

export function ActivityProfileHub({ candidate }: { candidate: Candidate }) {
  const [hub, setHub] = useState<Awaited<ReturnType<typeof fetchMyActivityHub>> | null>(null);
  const [ranking, setRanking] = useState<{
    top: ScoreRankRow[];
    me: { total_score: number; rank: number | null; in_top: boolean };
  } | null>(null);
  const [selfLearn, setSelfLearn] = useState<SelfLearnVideo[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError("");
    try {
      const [h, r, videos] = await Promise.all([
        fetchMyActivityHub(candidate.id, candidate.phone),
        fetchScoreRanking(candidate.id, candidate.phone, 10),
        listSelfLearnVideos(candidate.id, candidate.phone).catch(() => [] as SelfLearnVideo[]),
      ]);
      setHub(h);
      setRanking(r);
      setSelfLearn(videos);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "โหลดไม่สำเร็จ — รัน supabase/activity_ux_polish_v1.sql"
      );
    }
  }, [candidate.id, candidate.phone]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const displayName =
    `${candidate.title_other_th || candidate.title_th || ""} ${candidate.first_name} ${candidate.last_name}`.trim();

  const onCheckinAndOpenLive = async (meetingId: string, youtubeUrl: string) => {
    setBusy(meetingId);
    const res = await checkinLiveMeeting(candidate.id, candidate.phone, meetingId);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const url = normalizeExternalUrl(youtubeUrl);
    if (url) {
      window.location.assign(url);
      return;
    }
    setMessage(`Check-in สำเร็จ (+${res.points} คะแนน)`);
    await reload();
  };

  const onCreditSelfLearn = async (video: SelfLearnVideo) => {
    setBusy(video.id);
    setError("");
    const res = await creditSelfLearnVideo(candidate.id, candidate.phone, video.id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const url = normalizeExternalUrl(video.video_url);
    if (url) {
      window.location.assign(url);
      return;
    }
    setMessage(res.credited ? `ได้รับคะแนนวิดีโอ +${res.points}` : "บันทึกการรับชมแล้ว");
    await reload();
  };

  const topRows = (ranking?.top ?? []).filter((r) => r.rank <= 10);

  return (
    <div className="space-y-8 mb-10">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b3d6e] via-[#145a9e] to-[#1d7ac4] text-white p-6 md:p-8 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-sm text-white/70 mb-1">โปรไฟล์กิจกรรม</p>
            <h2 className="text-2xl md:text-3xl font-extrabold">{displayName}</h2>
            <p className="mt-2 text-sm text-white/85">
              {hub?.school_name || "—"}
              {hub?.district_name ? ` · ${hub.district_name}` : ""}
            </p>
          </div>
          <div className="md:text-right shrink-0 rounded-2xl bg-white/15 px-6 py-4 backdrop-blur-sm border border-white/20">
            <div className="text-xs uppercase tracking-wide text-white/70">คะแนนรวม</div>
            <div className="text-4xl font-black tabular-nums">{hub?.total_score ?? "—"}</div>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)]">{message}</p>}

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
          <div className="text-xs text-gray-500 font-semibold mb-1">ระบบคะแนน</div>
          <div className="text-3xl font-extrabold text-[var(--primary-blue)] tabular-nums">
            {hub?.total_score ?? 0}
          </div>
        </div>
        <div className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
          <div className="text-xs text-gray-500 font-semibold mb-1">
            ผลลัพท์ ปี {hub?.activity_year ?? "—"}
          </div>
          <div className="text-3xl font-extrabold text-emerald-700 tabular-nums">
            {hub?.performance_pct ?? 0}%
          </div>
          <p className="text-xs text-gray-500 mt-1">
            ผ่าน {hub?.tasks_approved ?? 0} / {hub?.tasks_total ?? 0} ภารกิจ
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 md:p-6">
        <h3 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white mb-4">
          Check-in
        </h3>
        <div className="space-y-3">
          {(hub?.live_meetings ?? []).map((m) => {
            const liveUrl = normalizeExternalUrl(m.youtube_url);
            return (
              <div key={m.id} className="rounded-xl border p-4 space-y-2">
                <div className="font-bold">{m.title}</div>
                <div className="text-xs text-gray-500">
                  {formatDateTimeTh(m.window_start)} – {formatDateTimeTh(m.window_end)} · {m.score_points}{" "}
                  คะแนน
                </div>
                {m.checked_in ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-block text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                      Check in แล้ว
                    </span>
                    {liveUrl && (
                      <a
                        href={liveUrl}
                        className="text-sm font-bold underline text-[var(--primary-blue)]"
                      >
                        เปิด YouTube Live
                      </a>
                    )}
                  </div>
                ) : m.in_window ? (
                  <button
                    type="button"
                    disabled={busy === m.id || !liveUrl}
                    onClick={() => void onCheckinAndOpenLive(m.id, m.youtube_url)}
                    className="rounded-full bg-emerald-600 text-white px-5 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {busy === m.id ? "กำลัง Check-in..." : "Check-in และเปิด Live"}
                  </button>
                ) : (
                  <span className="text-xs text-gray-500">อยู่นอกช่วงเวลา check-in</span>
                )}
              </div>
            );
          })}
          {!hub?.live_meetings?.length && (
            <p className="text-sm text-gray-500">ยังไม่มี Live ที่เปิดอยู่</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 md:p-6">
        <h3 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white mb-4">
          ภารกิจที่มอบหมาย
        </h3>
        <div className="space-y-3">
          {(hub?.tasks ?? []).map((t) => (
            <Link
              key={t.id}
              href={`/portal/activity/task/${t.id}`}
              className="block rounded-xl border border-gray-100 dark:border-slate-800 p-4 hover:border-[var(--primary-blue)] transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-[var(--primary-blue)] dark:text-white">
                    {t.activity_project_name || t.report_name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.score_points} คะแนน
                    {t.include_deadline && t.report_deadline
                      ? ` · กำหนดส่ง ${formatDateTimeTh(t.report_deadline)}`
                      : ""}
                  </div>
                </div>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full border ${statusColor(t.submission_status)}`}
                >
                  {statusLabel(t.submission_status)}
                </span>
              </div>
              <div className="mt-3 text-sm font-bold text-[var(--primary-blue)] underline">
                {taskCta(t.submission_status)} →
              </div>
            </Link>
          ))}
          {!hub?.tasks?.length && (
            <p className="text-sm text-gray-500">ยังไม่มีภารกิจที่เปิดอยู่</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white">
            E-learning
          </h3>
          <Link
            href="/portal/e-learning"
            className="text-sm font-bold underline text-[var(--primary-blue)]"
          >
            ไปหน้า E-learning
          </Link>
        </div>
        <div className="space-y-3">
          {selfLearn.slice(0, 5).map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-50 dark:border-slate-800 px-3 py-3"
            >
              <div>
                <div className="font-semibold text-sm">{v.title}</div>
                <div className="text-xs text-gray-500">{v.score_points} คะแนน</div>
              </div>
              {v.credited ? (
                <button
                  type="button"
                  className="rounded-full border border-emerald-600 text-emerald-700 px-4 py-1.5 text-xs font-bold"
                  onClick={() => {
                    const url = normalizeExternalUrl(v.video_url);
                    if (url) window.location.assign(url);
                  }}
                >
                  เปิดวิดีโออีกครั้ง
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === v.id}
                  onClick={() => void onCreditSelfLearn(v)}
                  className="rounded-full border border-[var(--primary-blue)] text-[var(--primary-blue)] px-4 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  เปิดวิดีโอและรับคะแนน
                </button>
              )}
            </div>
          ))}
          {!selfLearn.length && (
            <p className="text-sm text-gray-500">ยังไม่มีวิดีโอ E-learning ที่เผยแพร่</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 md:p-6">
        <h3 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white mb-4">
          อันดับคะแนน Top 10
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">ชื่อ</th>
                <th className="py-2 pr-2">โรงเรียน</th>
                <th className="py-2 text-right">คะแนน</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((r) => (
                <tr
                  key={r.profile_id}
                  className={`border-b border-gray-50 dark:border-slate-800 ${r.is_me ? "bg-sky-50 dark:bg-sky-950/40 font-bold" : ""}`}
                >
                  <td className="py-2 pr-2 tabular-nums">{r.rank}</td>
                  <td className="py-2 pr-2">
                    {r.first_name} {r.last_name}
                    {r.is_me ? " (คุณ)" : ""}
                  </td>
                  <td className="py-2 pr-2 text-gray-500">{r.school_name || "—"}</td>
                  <td className="py-2 text-right tabular-nums">{r.total_score}</td>
                </tr>
              ))}
              {ranking && !ranking.me.in_top && ranking.me.rank != null && (
                <tr className="bg-amber-50 dark:bg-amber-950/30 font-bold border-t-2 border-amber-200">
                  <td className="py-2 pr-2 tabular-nums">{ranking.me.rank}</td>
                  <td className="py-2 pr-2" colSpan={2}>
                    อันดับของคุณ
                  </td>
                  <td className="py-2 text-right tabular-nums">{ranking.me.total_score}</td>
                </tr>
              )}
            </tbody>
          </table>
          {!topRows.length && <p className="text-sm text-gray-500 py-2">ยังไม่มีคะแนนในระบบ</p>}
        </div>
      </section>
    </div>
  );
}
