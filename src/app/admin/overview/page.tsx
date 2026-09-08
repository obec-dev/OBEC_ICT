"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import { adminOverviewStats, type AdminOverviewStats } from "@/lib/supabase/admin";

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

/** SVG Donut Chart component representing proportional status breakdowns */
function DonutChart({
  passed,
  failed,
  draft,
  notTaken,
  total,
}: {
  passed: number;
  failed: number;
  draft: number;
  notTaken: number;
  total: number;
}) {
  const safeTotal = total > 0 ? total : 1;
  const passedPct = Math.round((passed / safeTotal) * 100);
  const failedPct = Math.round((failed / safeTotal) * 100);
  const draftPct = Math.round((draft / safeTotal) * 100);
  const notTakenPct = Math.max(0, 100 - passedPct - failedPct - draftPct);

  // SVG Circle Dash Calculations (r = 40, circumference = 2 * PI * 40 = 251.32)
  const c = 251.32;
  const strokePassed = (passedPct / 100) * c;
  const strokeFailed = (failedPct / 100) * c;
  const strokeDraft = (draftPct / 100) * c;
  const strokeNotTaken = (notTakenPct / 100) * c;

  const offset1 = 0;
  const offset2 = -strokePassed;
  const offset3 = -(strokePassed + strokeFailed);
  const offset4 = -(strokePassed + strokeFailed + strokeDraft);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-around gap-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
      <div className="relative w-48 h-48 flex items-center justify-center shrink-0">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          {/* Base Background Track */}
          <circle cx="50" cy="50" r="40" stroke="#f3f4f6" strokeWidth="14" fill="transparent" />

          {/* Passed Slices (Emerald) */}
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#10b981"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokePassed} ${c - strokePassed}`}
            strokeDashoffset={offset1}
            className="transition-all duration-700"
          />

          {/* Failed Slices (Red) */}
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#ef4444"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeFailed} ${c - strokeFailed}`}
            strokeDashoffset={offset2}
            className="transition-all duration-700"
          />

          {/* Draft Slices (Amber) */}
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#f59e0b"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeDraft} ${c - strokeDraft}`}
            strokeDashoffset={offset3}
            className="transition-all duration-700"
          />

          {/* Not Taken Slices (Gray) */}
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="#9ca3af"
            strokeWidth="14"
            fill="transparent"
            strokeDasharray={`${strokeNotTaken} ${c - strokeNotTaken}`}
            strokeDashoffset={offset4}
            className="transition-all duration-700"
          />
        </svg>

        {/* Center Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-extrabold text-[var(--primary-blue)]">{passedPct}%</span>
          <span className="text-[11px] font-semibold text-gray-500">ผ่านการทดสอบ</span>
        </div>
      </div>

      {/* Legend Table */}
      <div className="space-y-3 w-full max-w-xs text-sm">
        <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-50 border border-emerald-100">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 inline-block" />
            <span className="font-bold text-emerald-900">ผู้ที่สอบผ่าน (Passed)</span>
          </div>
          <span className="font-extrabold text-emerald-900 tabular-nums">
            {passed} ({passedPct}%)
          </span>
        </div>

        <div className="flex items-center justify-between p-2 rounded-xl bg-red-50 border border-red-100">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-red-500 inline-block" />
            <span className="font-bold text-red-900">ผู้ที่ไม่ผ่านเกณฑ์ (Failed)</span>
          </div>
          <span className="font-extrabold text-red-900 tabular-nums">
            {failed} ({failedPct}%)
          </span>
        </div>

        <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50 border border-amber-100">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-amber-500 inline-block" />
            <span className="font-bold text-amber-900">กำลังทำ/ร่างคำตอบ (Draft)</span>
          </div>
          <span className="font-extrabold text-amber-900 tabular-nums">
            {draft} ({draftPct}%)
          </span>
        </div>

        <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-full bg-gray-400 inline-block" />
            <span className="font-bold text-gray-700">ยังไม่ได้สอบ (Not Taken)</span>
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
  const { adminToken, projects, examProgress, candidates } = useIctStore();
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || "ict-talent-2026");

  useEffect(() => {
    if (!adminToken) return;
    void adminOverviewStats(adminToken)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดภาพรวมไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [adminToken]);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  // Project Dashboard Calculations
  const eligibleCandidatesCount = candidates.length || (stats?.profiles_total ?? 0);
  const projectExams = examProgress.filter(
    (e) => e.project_id === selectedProjectId || (!e.project_id && selectedProjectId === "ict-talent-2026")
  );

  const passedCount = projectExams.filter((e) => e.passed === true).length;
  const failedCount = projectExams.filter((e) => e.status === "submitted" && e.passed === false).length;
  const draftCount = projectExams.filter((e) => e.status === "draft").length;
  const notTakenCount = Math.max(0, eligibleCandidatesCount - passedCount - failedCount - draftCount);

  const pct =
    stats && stats.schools_total > 0 ? Math.round((stats.schools_registered / stats.schools_total) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">แดชบอร์ดผู้ดูแลระบบ</h1>
          <p className="text-gray-500">ภาพรวมสถิติการลงทะเบียน และผลการประเมินการสอบรายโครงการ</p>
        </div>
        <Link href="/dashboard" className="text-sm font-bold text-[var(--primary-blue)] underline">
          เปิดแดชบอร์ดสาธารณะ (รายเขต)
        </Link>
      </div>

      {loading && <p className="text-gray-500 mb-4">กำลังโหลดสถิติ...</p>}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <div className="text-xs mt-1 opacity-80">
            หากยังไม่ได้รัน RPC ให้รันไฟล์ <code>supabase/admin_audit_and_overview.sql</code>
          </div>
        </div>
      )}

      {stats && (
        <>
          {/* General Registration Summary Cards */}
          <h2 className="text-lg font-bold text-[var(--primary-blue)] mb-3">การลงทะเบียนทั้งระบบ</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
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

          <div className="mb-8 rounded-2xl border border-gray-100 bg-white p-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-semibold text-gray-700">ความคืบหน้าโรงเรียนที่ลงทะเบียน</span>
              <span className="font-bold text-[var(--primary-blue)]">{pct}%</span>
            </div>
            <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent-green)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Project Summary Metrics & Donut Chart Section */}
          <div className="mb-8 border-t border-gray-200 pt-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-2xl font-extrabold text-[var(--primary-blue)] flex items-center gap-2">
                  <span>📊 Project Summary Metrics & Status Breakdown</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  สถิติผู้มีสิทธิสอบ ผู้สอบผ่าน และแผนภูมิ Donut Chart สัดส่วนการสอบรายโครงการ
                </p>
              </div>

              {/* Project Selector for Dashboard */}
              {projects.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-600">เลือกโครงการ:</span>
                  <select
                    className="rounded-full border border-gray-300 px-4 py-1.5 text-xs font-bold text-[var(--primary-blue)] bg-white shadow-xs"
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Project KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="ผู้มีสิทธิเข้าร่วมทดสอบ"
                value={eligibleCandidatesCount.toLocaleString()}
                hint="Total Eligible Candidates"
                tone="blue"
              />
              <StatCard
                label="ผู้ที่สอบผ่าน (Passed)"
                value={passedCount.toLocaleString()}
                hint={`เกณฑ์ผ่าน >= ${currentProject?.pass_threshold ?? 3} คะแนน`}
                tone="green"
              />
              <StatCard
                label="ผู้ที่ไม่ผ่านเกณฑ์ (Failed)"
                value={failedCount.toLocaleString()}
                hint="ตรวจคำตอบแล้ว"
                tone="red"
              />
              <StatCard
                label="ยังไม่ได้สอบ / ร่างคำตอบ"
                value={(draftCount + notTakenCount).toLocaleString()}
                hint="Pending & Not Taken"
                tone="gray"
              />
            </div>

            {/* Visual SVG Donut Chart */}
            <DonutChart
              passed={passedCount}
              failed={failedCount}
              draft={draftCount}
              notTaken={notTakenCount}
              total={eligibleCandidatesCount}
            />
          </div>
        </>
      )}
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
