"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import {
  AnalyticsReportsPanel,
  ExamResultsExportPanel,
} from "@/app/components/AdminReportingPanel";
import { useIctStore } from "@/contexts/IctStore";
import { getSiteProject } from "@/lib/siteSettings";
import {
  adminMissionProgressStats,
  adminOverviewStats,
  isAdminUnauthorized,
  type AdminOverviewStats,
} from "@/lib/supabase/admin";

function StatCard({
  label,
  value,
  hint,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "blue" | "green" | "red" | "amber" | "gray";
}) {
  const tones = {
    blue: "border-blue-100 bg-blue-50/60 text-[var(--primary-blue)]",
    green: "border-emerald-100 bg-emerald-50/60 text-emerald-800",
    red: "border-red-100 bg-red-50/60 text-red-700",
    amber: "border-amber-100 bg-amber-50/60 text-amber-800",
    gray: "border-gray-100 bg-gray-50 text-gray-700",
  };
  return (
    <div className={`rounded-2xl border p-5 ${tones[tone]}`}>
      <div className="text-3xl font-extrabold tabular-nums">{value}</div>
      <div className="text-sm font-semibold mt-1 opacity-90">{label}</div>
      {hint && <div className="text-xs mt-2 opacity-70">{hint}</div>}
    </div>
  );
}

function DonutChart({
  submitted,
  draft,
  notTaken,
  total,
}: {
  submitted: number;
  draft: number;
  notTaken: number;
  total: number;
}) {
  const safeTotal = total > 0 ? total : 1;
  const submittedPct = Math.round((submitted / safeTotal) * 100);
  const draftPct = Math.round((draft / safeTotal) * 100);
  const notTakenPct = Math.max(0, 100 - submittedPct - draftPct);

  const c = 251.32;
  const strokeSubmitted = (submittedPct / 100) * c;
  const strokeDraft = (draftPct / 100) * c;
  const strokeNotTaken = (notTakenPct / 100) * c;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-around gap-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
      <div className="relative w-48 h-48 flex items-center justify-center shrink-0">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" stroke="#f3f4f6" strokeWidth="14" fill="transparent" />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#112652"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeSubmitted} ${c - strokeSubmitted}`}
            strokeDashoffset={0}
            className="transition-all duration-700"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#f59e0b"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeDraft} ${c - strokeDraft}`}
            strokeDashoffset={-strokeSubmitted}
            className="transition-all duration-700"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#9ca3af"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeNotTaken} ${c - strokeNotTaken}`}
            strokeDashoffset={-(strokeSubmitted + strokeDraft)}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-extrabold text-[var(--primary-blue)]">{submittedPct}%</span>
          <span className="text-[11px] font-semibold text-gray-500">ส่งข้อสอบแล้ว</span>
        </div>
      </div>

      <div className="space-y-3 w-full max-w-xs text-sm">
        <div className="flex items-center justify-between p-2 rounded-xl bg-blue-50 border border-blue-100">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-[var(--primary-blue)] inline-block" />
            <span className="font-bold text-[var(--primary-blue)]">ส่งข้อสอบแล้ว</span>
          </div>
          <span className="font-extrabold tabular-nums">
            {submitted} ({submittedPct}%)
          </span>
        </div>
        <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50 border border-amber-100">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-amber-500 inline-block" />
            <span className="font-bold text-amber-900">กำลังทำ / ฉบับร่าง</span>
          </div>
          <span className="font-extrabold text-amber-900 tabular-nums">
            {draft} ({draftPct}%)
          </span>
        </div>
        <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-gray-400 inline-block" />
            <span className="font-bold text-gray-700">ยังไม่ได้เริ่มสอบ</span>
          </div>
          <span className="font-extrabold text-gray-700 tabular-nums">
            {notTaken} ({notTakenPct}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function OverviewContent() {
  const { adminToken, projects, logout } = useIctStore();
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [missionStats, setMissionStats] = useState<{
    total_missions: number;
    total_users: number;
    completed_pairs: number;
    avg_completed_per_user: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const siteProject = useMemo(() => getSiteProject(projects), [projects]);
  const projectId = siteProject?.id;

  const loadStats = async (opts?: { soft?: boolean }) => {
    if (!adminToken) return;
    if (opts?.soft) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [overview, missions] = await Promise.all([
        adminOverviewStats(adminToken, projectId),
        adminMissionProgressStats(adminToken).catch(() => null),
      ]);
      setStats(overview);
      setMissionStats(missions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดภาพรวมไม่สำเร็จ");
      if (isAdminUnauthorized(err)) {
        window.setTimeout(() => logout(), 1200);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadStats();
    // Re-fetch when returning to the tab so counters stay fresh (no long-lived stale cache)
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadStats({ soft: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when token/project changes
  }, [adminToken, projectId, logout]);

  // Exam counters MUST come from admin_overview_stats RPC — IctStore.examProgress /
  // candidates are portal-session only and stay empty for admin logins (always zeros).
  const eligible = stats?.profiles_total ?? 0;
  const finishedCount = stats?.exam_submitted ?? 0;
  const inProgressCount = stats?.exam_draft ?? 0;
  const partialCount = stats?.exam_partial ?? 0;
  const passedCount = stats?.exam_passed ?? 0;
  const failedCount = stats?.exam_failed ?? 0;
  const notTakenCount = Math.max(0, eligible - finishedCount - inProgressCount);

  const pct =
    stats && stats.schools_total > 0
      ? Math.round((stats.schools_registered / stats.schools_total) * 100)
      : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up admin-surface">
      <AdminNav />

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">ภาพรวมผู้ดูแลระบบ</h1>
          <p className="text-gray-500 dark:text-white/80">
            {siteProject ? siteProject.name : "ติดตามการลงทะเบียนและผลการทดสอบ"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loading || refreshing || !adminToken}
            onClick={() => void loadStats({ soft: true })}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
          >
            {refreshing ? "กำลังรีเฟรช..." : "รีเฟรชสถิติ"}
          </button>
          <Link href="/dashboard" className="text-sm font-bold text-[var(--primary-blue)] dark:text-white underline">
            เปิดแดชบอร์ดสาธารณะ (รายเขต)
          </Link>
        </div>
      </div>

      {loading && <p className="text-gray-500 mb-4 mt-6">กำลังโหลดสถิติ...</p>}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Part 1 */}
          <section className="mb-12">
            <h2 className="text-xl font-extrabold text-[var(--primary-blue)] mb-1">ติดตามการลงทะเบียน</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">ภาพรวมการลงทะเบียนโรงเรียนและผู้สมัครทั้งระบบ</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <StatCard label="โรงเรียนทั้งหมด" value={stats.schools_total.toLocaleString()} tone="blue" />
              <StatCard
                label="ลงทะเบียนแล้ว"
                value={stats.schools_registered.toLocaleString()}
                hint={`${pct}% ของโรงเรียนทั้งหมด`}
                tone="green"
              />
              <StatCard label="เขตพื้นที่" value={stats.districts_total.toLocaleString()} tone="blue" />
              <StatCard
                label="ผู้สมัครทั้งหมด"
                value={stats.profiles_total.toLocaleString()}
                hint={`วันนี้ +${stats.profiles_today.toLocaleString()} คน`}
                tone="amber"
              />
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white dark:bg-black p-5">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-semibold text-gray-700 dark:text-white">ความคืบหน้าโรงเรียนที่ลงทะเบียน</span>
                <span className="font-bold text-[var(--primary-blue)] dark:text-white">{pct}%</span>
              </div>
              <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent-green)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </section>

          {missionStats && (
            <section className="mb-12">
              <h2 className="text-xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-1">
                ความคืบหน้าภารกิจ (Missions)
              </h2>
              <p className="text-xs text-gray-500 dark:text-white/70 mb-4">
                เฉลี่ยภารกิจที่ทำสำเร็จต่อผู้ใช้
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="ภารกิจที่เปิดใช้" value={missionStats.total_missions} tone="blue" />
                <StatCard label="ผู้ใช้ที่มีสิทธิ์" value={missionStats.total_users} tone="gray" />
                <StatCard
                  label="การทำสำเร็จทั้งหมด"
                  value={missionStats.completed_pairs}
                  tone="green"
                />
                <StatCard
                  label="เฉลี่ยต่อผู้ใช้"
                  value={`${missionStats.avg_completed_per_user}/${missionStats.total_missions || 0}`}
                  hint="Missions Completed (avg)"
                  tone="amber"
                />
              </div>
            </section>
          )}

          {/* Part 2 */}
          <section className="border-t border-gray-200 pt-10">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-[var(--primary-blue)] mb-1">
                  ติดตามผลการทดสอบ
                </h2>
                <p className="text-xs text-gray-500 dark:text-slate-400">ติดตามสถานะการสอบและผลการผ่านเกณฑ์</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <StatCard label="ผู้มีสิทธิ์สอบ" value={eligible.toLocaleString()} tone="blue" />
              <StatCard
                label="กำลังทำข้อสอบ / ฉบับร่าง"
                value={inProgressCount.toLocaleString()}
                hint={
                  partialCount > 0
                    ? `รวมส่งบางบท ${partialCount.toLocaleString()} คน`
                    : "สถานะ draft ใน exam_progress"
                }
                tone="amber"
              />
              <StatCard
                label="ส่งข้อสอบแล้ว"
                value={finishedCount.toLocaleString()}
                tone="gray"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <StatCard
                label="สอบผ่าน"
                value={passedCount.toLocaleString()}
                tone="green"
              />
              <StatCard
                label="ยังไม่ผ่านเกณฑ์"
                value={failedCount.toLocaleString()}
                tone="red"
              />
            </div>

            <DonutChart
              submitted={finishedCount}
              draft={inProgressCount}
              notTaken={notTakenCount}
              total={eligible}
            />

            <ExamResultsExportPanel />
          </section>

          <AnalyticsReportsPanel />
        </>
      )}

      {!stats && !loading && <AnalyticsReportsPanel />}
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["admin", "super_admin"]}>
      <OverviewContent />
    </AuthGuard>
  );
}
