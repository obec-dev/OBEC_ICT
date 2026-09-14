"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Kpi, Meter, TrendChart, pct } from "@/app/components/executive/widgets";
import { useIctStore } from "@/contexts/IctStore";
import { fetchExecutiveOpsDashboard, type ExecutiveOpsDashboard } from "@/lib/supabase/data";

export function AuditDashboard() {
  const { session } = useIctStore();
  const user = session?.kind === "audit" ? session.user : null;
  const [data, setData] = useState<ExecutiveOpsDashboard | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"coverage" | "updates" | "progress">("coverage");

  useEffect(() => {
    if (!user?.login_email) return;
    let cancelled = false;
    void fetchExecutiveOpsDashboard("audit", user.login_email)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.login_email, user?.assigned_districts]);

  const totals = data?.totals;
  const rows = useMemo(() => {
    const list = [...(data?.districts ?? [])];
    list.sort((a, b) => {
      if (sort === "updates") return b.school_updates_30d - a.school_updates_30d;
      if (sort === "progress") return pct(b.exam_submitted, b.users) - pct(a.exam_submitted, a.users);
      return pct(a.registered, a.schools) - pct(b.registered, b.schools);
    });
    return list;
  }, [data, sort]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 animate-fade-in-up">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white">เขตที่รับผิดชอบ</h1>
          <p className="text-md text-gray-500 dark:text-white/70 mt-1">
            สวัสดีคุณ {user?.display_name}
            {user?.position ? ` - ${user.position}` : ""}
          </p>
          <p className="text-sm text-gray-500 dark:text-white/70 mt-1">
          ขณะนี้คุณมีเขตภายใต้การดูแลอยู่ {user?.assigned_districts.length ?? 0} เขต
          </p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[var(--accent-red)] mb-4">
          {error}
          {error.includes("executive_ops_dashboard") ? " — รัน supabase/executive_dashboards_v1.sql" : ""}
        </p>
      )}

      {data?.needs_domains && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ยังไม่ได้กำหนดเขตที่รับผิดชอบ —{" "}
          <Link href="/portal/audit/profile" className="font-bold underline">
            ตั้งค่าเขตที่ดูแล
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="โรงเรียนในเขต" value={totals?.schools ?? "—"} hint={totals ? `ลงทะเบียน ${totals.registered_schools}` : undefined} />
        <Kpi label="ผู้ใช้ที่ใช้งาน" value={totals?.active_users ?? "—"} hint="ในเขตที่รับผิดชอบ" accent="green" />
        <Kpi label="อัปเดตโรงเรียน 30 วัน" value={totals?.school_updates_30d ?? "—"} hint="โปรไฟล์สถานศึกษา" accent="amber" />
        <Kpi
          label="ความคืบหน้าข้อสอบ"
          value={totals ? `${pct(totals.exam_submitted, totals.users)}%` : "—"}
          hint={totals ? `${totals.exam_submitted} ส่ง / ${totals.exam_passed} ผ่าน` : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-4 mb-6">
        <section className="lg:col-span-2 rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 space-y-4">
          <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">ความคืบหน้าผู้ใช้ในเขต</h2>
          <Meter label="โรงเรียนลงทะเบียน" value={totals?.registered_schools ?? 0} total={totals?.schools ?? 0} />
          <Meter label="เรียนจบ" value={totals?.learn_completed ?? 0} total={totals?.users ?? 0} tone="green" />
          <Meter label="ส่งข้อสอบ" value={totals?.exam_submitted ?? 0} total={totals?.users ?? 0} tone="amber" />
          <Meter label="สอบผ่าน" value={totals?.exam_passed ?? 0} total={totals?.users ?? 0} tone="green" />
          <p className="text-xs text-gray-500">
            มีกิจกรรมใน 30 วัน {(totals?.active_30d ?? 0).toLocaleString()} คน · ผู้ใช้ใหม่{" "}
            {(totals?.registrations_30d ?? 0).toLocaleString()}
          </p>
        </section>
        <section className="lg:col-span-3 rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
          <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white mb-1">แนวโน้มในเขตที่ดูแล</h2>
          <p className="text-xs text-gray-500 mb-4">ผู้ใช้ใหม่ การเรียนจบ การส่งข้อสอบ และโรงเรียนที่อัปเดตข้อมูล</p>
          {data ? (
            <TrendChart
              points={data.trend}
              series={[
                { key: "school_updates", label: "อัปเดตโรงเรียน", className: "bg-[var(--accent-red)]" },
                { key: "exam_submitted", label: "ส่งข้อสอบ", className: "bg-amber-500" },
                { key: "learn_completed", label: "เรียนจบ", className: "bg-emerald-500" },
                { key: "registrations", label: "ผู้ใช้ใหม่", className: "bg-[var(--primary-blue)]" },
              ]}
            />
          ) : (
            <p className="text-sm text-gray-400 py-10 text-center">กำลังโหลดแนวโน้ม...</p>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">รายเขต</h2>
            <p className="text-xs text-gray-500">เฉพาะเขตที่กำหนดในโปรไฟล์</p>
          </div>
          <select
            className="rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="coverage">เรียงตามความครอบคลุม</option>
            <option value="updates">เรียงตามอัปเดตโรงเรียน 30 วัน</option>
            <option value="progress">เรียงตามการส่งข้อสอบ</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-black text-left text-gray-600 dark:text-white">
              <tr>
                <th className="px-4 py-3">เขต</th>
                <th className="px-4 py-3">ลงทะเบียน</th>
                <th className="px-4 py-3">ผู้ใช้ใช้งาน</th>
                <th className="px-4 py-3">เรียนจบ / สอบ</th>
                <th className="px-4 py-3">อัปเดตโรงเรียน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.district_id || d.district_name} className="border-t border-gray-100 dark:border-slate-800 dark:text-white">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{d.district_name}</div>
                    <div className="text-xs text-gray-400">{d.province}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="tabular-nums font-semibold">{pct(d.registered, d.schools)}%</div>
                    <div className="h-1.5 mt-1 rounded-full bg-gray-100 dark:bg-slate-800 w-24">
                      <div className="h-full rounded-full bg-[var(--primary-blue)]" style={{ width: `${pct(d.registered, d.schools)}%` }} />
                    </div>
                    <div className="text-[11px] text-gray-400">{d.registered}/{d.schools}</div>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{d.active_users}/{d.users}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {d.learn_completed} / {d.exam_submitted}
                    <span className="text-xs text-gray-400"> ผ่าน {d.exam_passed}</span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {d.school_updates}
                    <span className="text-xs text-gray-400"> · 30 วัน {d.school_updates_30d}</span>
                  </td>
                </tr>
              ))}
              {data && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">ยังไม่มีเขตในความรับผิดชอบ</td>
                </tr>
              )}
              {!data && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">กำลังโหลด...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
