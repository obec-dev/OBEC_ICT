"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ActivityAuditorPanel } from "@/app/components/executive/ActivityAuditorPanel";
import { Kpi, Meter, TrendChart, pct } from "@/app/components/executive/widgets";
import { useIctStore } from "@/contexts/IctStore";
import {
  fetchAuditorDistrictSchools,
  fetchAuditorDocuments,
  type AuditorDistrictSchool,
} from "@/lib/supabase/activity";
import { listMyNotifications } from "@/lib/supabase/notifications";
import { fetchExecutiveOpsDashboard, type ExecutiveOpsDashboard } from "@/lib/supabase/data";
import { formatDateTimeTh } from "@/lib/siteSettings";

type SchoolSort = "activity" | "users" | "score";

function latestUserActivityTs(school: AuditorDistrictSchool): number {
  let best = 0;
  for (const u of school.users) {
    if (!u.recent_activity_at) continue;
    const ts = new Date(u.recent_activity_at).getTime();
    if (!Number.isNaN(ts) && ts > best) best = ts;
  }
  return best;
}

function sortSchools(list: AuditorDistrictSchool[], schoolSort: SchoolSort): AuditorDistrictSchool[] {
  const next = [...list];
  next.sort((a, b) => {
    if (schoolSort === "users") return b.user_count - a.user_count;
    if (schoolSort === "score") return b.max_user_score - a.max_user_score;
    return latestUserActivityTs(b) - latestUserActivityTs(a);
  });
  return next.map((school) => ({
    ...school,
    users:
      schoolSort === "activity"
        ? [...school.users].sort((a, b) => {
            const at = a.recent_activity_at ? new Date(a.recent_activity_at).getTime() : 0;
            const bt = b.recent_activity_at ? new Date(b.recent_activity_at).getTime() : 0;
            return bt - at;
          })
        : school.users,
  }));
}

function latestActivityIso(schools: AuditorDistrictSchool[]): string | null {
  let best: string | null = null;
  let bestTs = 0;
  for (const s of schools) {
    for (const u of s.users) {
      if (!u.recent_activity_at) continue;
      const ts = new Date(u.recent_activity_at).getTime();
      if (!Number.isNaN(ts) && ts > bestTs) {
        bestTs = ts;
        best = u.recent_activity_at;
      }
    }
  }
  return best;
}

export function AuditDashboard() {
  const { session } = useIctStore();
  const user = session?.kind === "audit" ? session.user : null;
  const [data, setData] = useState<ExecutiveOpsDashboard | null>(null);
  const [error, setError] = useState("");
  const [expandedDistrict, setExpandedDistrict] = useState<Record<string, boolean>>({});
  const [schoolsByDistrict, setSchoolsByDistrict] = useState<Record<string, AuditorDistrictSchool[]>>(
    {}
  );
  const [schoolsLoading, setSchoolsLoading] = useState<Record<string, boolean>>({});
  const [showAllSchools, setShowAllSchools] = useState(false);
  const [schoolSort, setSchoolSort] = useState<SchoolSort>("activity");
  const [docCount, setDocCount] = useState(0);
  const [newDocCount, setNewDocCount] = useState(0);

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

  useEffect(() => {
    if (!user?.login_email || !session || session.kind !== "audit") return;
    let cancelled = false;
    void Promise.all([
      fetchAuditorDocuments(user.login_email),
      listMyNotifications(session, 50).catch(() => ({ unread_count: 0, rows: [] as { is_unread: boolean; kind: string }[] })),
    ]).then(([docs, notif]) => {
      if (cancelled) return;
      setDocCount(docs.length);
      setNewDocCount(notif.rows.filter((n) => n.is_unread && n.kind === "auditor_document").length);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.login_email, session]);

  const loadDistrictSchools = async (districtId: string) => {
    if (!user?.login_email || schoolsByDistrict[districtId] || schoolsLoading[districtId]) return;
    setSchoolsLoading((s) => ({ ...s, [districtId]: true }));
    try {
      const schools = await fetchAuditorDistrictSchools(user.login_email, districtId);
      setSchoolsByDistrict((m) => ({ ...m, [districtId]: schools }));
    } catch {
      setSchoolsByDistrict((m) => ({ ...m, [districtId]: [] }));
    } finally {
      setSchoolsLoading((s) => ({ ...s, [districtId]: false }));
    }
  };

  // Prefetch schools so district "last activity" column can fill (auditors are usually 1 district).
  useEffect(() => {
    if (!user?.login_email || !data?.districts?.length) return;
    for (const d of data.districts) {
      const id = d.district_id || d.district_name;
      void loadDistrictSchools(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login_email, data?.districts]);

  const toggleDistrict = async (districtId: string) => {
    const next = !expandedDistrict[districtId];
    setExpandedDistrict((e) => ({ ...e, [districtId]: next }));
    if (next) await loadDistrictSchools(districtId);
  };

  const totals = data?.totals;
  const rows = data?.districts ?? [];

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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Kpi label="โรงเรียนในเขต" value={totals?.schools ?? "—"} hint={totals ? `ลงทะเบียน ${totals.registered_schools}` : undefined} />
        <Kpi label="ผู้ใช้ที่ใช้งาน" value={totals?.active_users ?? "—"} hint="ในเขตที่รับผิดชอบ" accent="green" />
        <Link
          href="/portal/audit/documents"
          className={`rounded-2xl border p-4 block transition-colors hover:border-[var(--primary-blue)] ${
            newDocCount > 0
              ? "border-amber-200 bg-amber-50"
              : "border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950"
          }`}
        >
          <div className="text-2xl md:text-3xl font-extrabold tabular-nums text-[var(--primary-blue)] dark:text-white">
            {docCount.toLocaleString()}
          </div>
          <div className="text-sm font-semibold mt-1 text-gray-700 dark:text-white">เอกสาร</div>
          <div className="text-xs text-gray-400 mt-1">
            {newDocCount > 0 ? `เอกสารใหม่ ${newDocCount} รายการ` : "คลังเอกสารจาก Admin"}
          </div>
          <div className="text-xs font-bold text-[var(--primary-blue)] mt-2">ดูคลังเอกสาร →</div>
        </Link>
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
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">รายเขต</h2>
          <p className="text-xs text-gray-500">เฉพาะเขตที่กำหนดในโปรไฟล์ — เรียงโรงเรียนได้เมื่อขยายแถว</p>
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
                <th className="px-4 py-3">กิจกรรมล่าสุด</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const id = d.district_id || d.district_name;
                const open = expandedDistrict[id];
                const schools = schoolsByDistrict[id] ?? [];
                const districtLastActivity = latestActivityIso(schools);
                return (
                  <Fragment key={id}>
                    <tr
                      className="border-t border-gray-100 dark:border-slate-800 dark:text-white cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                      onClick={() => void toggleDistrict(id)}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-semibold flex items-center gap-2">
                          <span className="text-xs text-gray-400">{open ? "▾" : "▸"}</span>
                          {d.district_name}
                        </div>
                        <div className="text-xs text-gray-400 pl-5">{d.province}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="tabular-nums font-semibold">{pct(d.registered, d.schools)}%</div>
                        <div className="h-1.5 mt-1 rounded-full bg-gray-100 dark:bg-slate-800 w-24">
                          <div
                            className="h-full rounded-full bg-[var(--primary-blue)]"
                            style={{ width: `${pct(d.registered, d.schools)}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {d.registered}/{d.schools}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {d.active_users}/{d.users}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {d.learn_completed} / {d.exam_submitted}
                        <span className="text-xs text-gray-400"> ผ่าน {d.exam_passed}</span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {d.school_updates}
                        <span className="text-xs text-gray-400"> · 30 วัน {d.school_updates_30d}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        {schoolsLoading[id] && !districtLastActivity
                          ? "กำลังโหลด..."
                          : formatDateTimeTh(districtLastActivity) || "—"}
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/80 dark:bg-slate-900/50">
                        <td colSpan={6} className="px-6 py-3">
                          {schoolsLoading[id] && (
                            <p className="text-xs text-gray-400">กำลังโหลดโรงเรียน...</p>
                          )}
                          {!schoolsLoading[id] && (
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={showAllSchools}
                                    onChange={(e) => setShowAllSchools(e.target.checked)}
                                  />
                                  แสดงทุกโรงเรียน
                                </label>
                                <select
                                  className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                                  value={schoolSort}
                                  onChange={(e) => setSchoolSort(e.target.value as SchoolSort)}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <option value="activity">เรียงตามกิจกรรมล่าสุด</option>
                                  <option value="users">เรียงตามจำนวนผู้ใช้</option>
                                  <option value="score">เรียงตามคะแนนสูงสุด</option>
                                </select>
                              </div>
                              <ul className="space-y-2">
                                {sortSchools(
                                  showAllSchools
                                    ? schools
                                    : schools.filter((s) => s.is_registered),
                                  schoolSort
                                ).map((s) => (
                                  <li
                                    key={s.school_id}
                                    className="text-sm border border-gray-100 dark:border-slate-800 rounded-xl px-3 py-2 bg-white dark:bg-slate-950"
                                  >
                                    <div className="flex flex-wrap justify-between gap-2">
                                      <span className="font-medium">
                                        {s.school_name}
                                        <span className="text-xs text-gray-400 font-normal">
                                          {" "}
                                          · {s.school_id}
                                        </span>
                                      </span>
                                      <span className="text-xs text-gray-500 tabular-nums text-right">
                                        {s.user_count} ผู้ใช้ · คะแนนสูงสุด {s.max_user_score}
                                        {s.is_registered ? " · ลงทะเบียนแล้ว" : " · ยังไม่ลงทะเบียน"}
                                      </span>
                                    </div>
                                    {s.users.length > 0 && (
                                      <ul className="mt-2 space-y-0.5 border-t border-gray-50 dark:border-slate-800 pt-2">
                                        <li className="flex justify-between gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide pb-1">
                                          <span>ผู้ใช้</span>
                                          <span className="flex gap-4">
                                            <span className="w-16 text-right">คะแนน</span>
                                            <span className="w-36 text-right">กิจกรรมล่าสุด</span>
                                          </span>
                                        </li>
                                        {s.users.map((u) => (
                                          <li
                                            key={u.profile_id}
                                            className="flex justify-between gap-2 text-xs text-gray-600 dark:text-gray-300"
                                          >
                                            <span>
                                              {u.first_name} {u.last_name}
                                            </span>
                                            <span className="flex gap-4 items-baseline shrink-0">
                                              <span className="w-16 text-right tabular-nums font-semibold">
                                                {u.score}
                                              </span>
                                              <span className="w-36 text-right text-[11px] text-gray-400 whitespace-nowrap">
                                                {formatDateTimeTh(u.recent_activity_at) || "—"}
                                              </span>
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                ))}
                                {!schools.filter((s) => showAllSchools || s.is_registered).length && (
                                  <li className="text-xs text-gray-400">
                                    {showAllSchools
                                      ? "ไม่มีโรงเรียนในเขตนี้"
                                      : "ไม่มีโรงเรียนที่ลงทะเบียน — เปิด “แสดงทุกโรงเรียน” เพื่อดูทั้งหมด"}
                                  </li>
                                )}
                              </ul>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {data && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    ยังไม่มีเขตในความรับผิดชอบ
                  </td>
                </tr>
              )}
              {!data && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    กำลังโหลด...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ActivityAuditorPanel />
    </div>
  );
}
