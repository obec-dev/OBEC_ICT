"use client";

import { useEffect, useState } from "react";
import { Kpi, Meter, TrendChart, pct } from "@/app/components/executive/widgets";
import { useIctStore } from "@/contexts/IctStore";
import {
  fetchExecutiveOpsDashboard,
  type ExecutiveOpsDashboard,
  type ExecutivePartnerStat,
  type ExecutiveSchoolActivity,
} from "@/lib/supabase/data";

export function BusinessDashboard() {
  const { session } = useIctStore();
  const loginId = session?.kind === "business" ? session.user.login_email : "";
  const name = session?.kind === "business" ? session.user.display_name : "";
  const position = session?.kind === "business" ? session.user.position : "";
  const [data, setData] = useState<ExecutiveOpsDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loginId) return;
    let cancelled = false;
    void fetchExecutiveOpsDashboard("business", loginId)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "โหลดไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [loginId]);

  const totals = data?.totals;
  const activeSchools = data?.active_schools ?? [];
  const inactiveSchools = data?.inactive_schools ?? [];
  const partners = data?.partners ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 animate-fade-in-up">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white">ภาพรวมโครงการ</h1>
          <p className="text-md text-gray-500 dark:text-white/70 mt-1">
            สวัสดีคุณ {name}
            {position ? ` - ${position}` : ""}            
          </p>
          <p className="text-sm text-gray-500 dark:text-white/70 mt-1">นี่คือภาพรวมของผู้ใช้งานทั้งหมด ความคืบหน้า และแนวโน้มของทุกโรงเรียน</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[var(--accent-red)] mb-4">
          {error}
          {error.includes("executive_ops_dashboard") ? " — รัน supabase/executive_dashboards_v1.sql" : ""}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="ผู้ใช้ที่ยังใช้งาน" value={totals?.active_users ?? "—"} hint="บัญชีที่ไม่ได้ถูกระงับ" accent="green" />
        <Kpi label="มีกิจกรรม 30 วัน" value={totals?.active_30d ?? "—"} hint="ลงทะเบียน เรียน หรือส่งข้อสอบ" />
        <Kpi
          label="โรงเรียนลงทะเบียน"
          value={totals ? `${pct(totals.registered_schools, totals.schools)}%` : "—"}
          hint={totals ? `${totals.registered_schools.toLocaleString()} / ${totals.schools.toLocaleString()}` : undefined}
        />
        <Kpi label="ผ่านข้อสอบ" value={totals?.exam_passed ?? "—"} hint="จากผู้ใช้ในระบบ" accent="amber" />
      </div>

      <div className="grid lg:grid-cols-5 gap-4 mb-6">
        <section className="lg:col-span-2 rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 space-y-4">
          <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">ช่องทางความคืบหน้า</h2>
          <Meter label="เริ่มเรียน" value={totals?.learn_started ?? 0} total={totals?.users ?? 0} />
          <Meter label="เรียนจบ" value={totals?.learn_completed ?? 0} total={totals?.users ?? 0} tone="green" />
          <Meter label="ส่งข้อสอบ" value={totals?.exam_submitted ?? 0} total={totals?.users ?? 0} tone="amber" />
          <Meter label="สอบผ่าน" value={totals?.exam_passed ?? 0} total={totals?.users ?? 0} tone="green" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-sm">
            <div>
              <div className="text-lg font-extrabold tabular-nums">{(totals?.registrations_30d ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">ผู้ใช้ใหม่ 30 วัน</div>
            </div>
            <div>
              <div className="text-lg font-extrabold tabular-nums">{(totals?.missions_completed ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">ภารกิจที่ทำสำเร็จ</div>
            </div>
            <div>
              <div className="text-lg font-extrabold tabular-nums">{(totals?.school_updates ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">โรงเรียนอัปเดตโปรไฟล์</div>
            </div>
            <div>
              <div className="text-lg font-extrabold tabular-nums">{(totals?.districts ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">เขตในระบบ</div>
            </div>
            <div>
              <div className="text-lg font-extrabold tabular-nums">{(totals?.partners ?? 0).toLocaleString()}</div>
              <div className="text-xs text-gray-500">Partner</div>
            </div>
          </div>
        </section>

        <section className="lg:col-span-3 rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5">
          <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white mb-1">แนวโน้ม 8 สัปดาห์</h2>
          <p className="text-xs text-gray-500 mb-4">ผู้ใช้ใหม่ เรียนจบ ส่งข้อสอบ และโรงเรียนที่อัปเดตข้อมูล</p>
          {data ? (
            <TrendChart
              points={data.trend}
              series={[
                { key: "registrations", label: "ผู้ใช้ใหม่", className: "bg-[var(--primary-blue)]" },
                { key: "learn_completed", label: "เรียนจบ", className: "bg-emerald-500" },
                { key: "exam_submitted", label: "ส่งข้อสอบ", className: "bg-amber-500" },
                { key: "school_updates", label: "อัปเดตโรงเรียน", className: "bg-[var(--accent-red)]" },
              ]}
            />
          ) : (
            <p className="text-sm text-gray-400 py-10 text-center">กำลังโหลดแนวโน้ม...</p>
          )}
        </section>
      </div>

      <PartnerSchoolsCard
        partners={partners}
        loading={!data}
        missingSql={Boolean(data && !data.has_partner_stats)}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <SchoolActivityCard
          title="โรงเรียนที่มีกิจกรรมมากที่สุด"
          hint="10 อันดับแรก จากลงทะเบียน เรียน ส่งข้อสอบ หรืออัปเดตโปรไฟล์ใน 30 วัน"
          schools={activeSchools}
          loading={!data}
          empty="ยังไม่มีโรงเรียนที่มีกิจกรรมในช่วงนี้"
          tone="active"
        />
        <SchoolActivityCard
          title="โรงเรียนที่ยังไม่มีกิจกรรม"
          hint="10 อันดับแรกที่ยังไม่มีกิจกรรมใน 30 วัน เรียงจากจำนวนผู้ใช้มากไปน้อย"
          schools={inactiveSchools}
          loading={!data}
          empty="ไม่มีโรงเรียนที่ไม่มีกิจกรรม"
          tone="idle"
        />
      </div>
      {data && activeSchools.length === 0 && inactiveSchools.length === 0 && totals && totals.schools > 0 && (
        <p className="text-xs text-gray-400 mt-3">หากยังไม่เห็นรายชื่อโรงเรียน ให้รัน supabase/executive_dashboards_v1.sql</p>
      )}
    </div>
  );
}

function PartnerSchoolsCard({
  partners,
  loading,
  missingSql,
}: {
  partners: ExecutivePartnerStat[];
  loading: boolean;
  missingSql: boolean;
}) {
  return (
    <section className="rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
        <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">โรงเรียนตาม Partner</h2>
        <p className="text-xs text-gray-500">จำนวนโรงเรียนที่เข้าร่วมโครงการ และยังไม่เข้าร่วม แยกตาม Partner</p>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-sm text-center text-gray-400">กำลังโหลด...</p>
      ) : missingSql ? (
        <p className="px-5 py-8 text-sm text-center text-gray-400">
          รัน supabase/executive_dashboards_v1.sql เพื่อดูสถิติ Partner
        </p>
      ) : partners.length === 0 ? (
        <p className="px-5 py-8 text-sm text-center text-gray-400">ยังไม่มีข้อมูล Partner</p>
      ) : (
        <PartnerStickChart partners={partners} />
      )}
    </section>
  );
}

function isObecPartner(name: string) {
  const label = name.trim().toLowerCase();
  return label === "obec" || label.includes("obec") || label.includes("สพฐ");
}

function PartnerStickChart({ partners }: { partners: ExecutivePartnerStat[] }) {
  const [hideObec, setHideObec] = useState(false);
  const obec = partners.filter((row) => isObecPartner(row.partner));
  const visible = hideObec ? partners.filter((row) => !isObecPartner(row.partner)) : partners;
  const max = Math.max(1, ...visible.map((row) => row.schools));
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-4 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
            <span className="size-2.5 rounded-sm bg-emerald-500" />
            เข้าร่วม
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-200">
            <span className="size-2.5 rounded-sm bg-amber-400" />
            ยังไม่เข้าร่วม
          </span>
        </div>
        {obec.length > 0 && (
          <button
            type="button"
            onClick={() => setHideObec((prev) => !prev)}
            className="rounded-full border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-[var(--primary-blue)] dark:text-white hover:bg-gray-50 dark:hover:bg-slate-900"
          >
            {hideObec ? "แสดง OBEC" : "ซ่อน OBEC"}
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="py-8 text-sm text-center text-gray-400">ไม่มี Partner อื่นนอกจาก OBEC</p>
      ) : (
      <div className="overflow-x-auto pb-1">
        <div className="flex items-end gap-3" style={{ minWidth: Math.max(visible.length * 76, 280) }}>
          {visible.map((row) => {
            const stick = Math.max((row.schools / max) * 100, row.schools > 0 ? 8 : 0);
            return (
              <div key={row.partner} className="flex min-w-[4.25rem] flex-1 flex-col items-center">
                <div className="mb-1 text-[10px] font-bold tabular-nums text-gray-500">{row.schools.toLocaleString()}</div>
                <div className="flex h-52 w-full items-end justify-center">
                  <div
                    className="flex w-9 flex-col justify-end overflow-hidden rounded-t-md sm:w-11"
                    style={{ height: `${stick}%` }}
                    title={`${row.partner}: เข้าร่วม ${row.participating.toLocaleString()} · ยังไม่เข้าร่วม ${row.not_participating.toLocaleString()}`}
                  >
                    {row.not_participating > 0 && (
                      <div
                        className="min-h-0 bg-amber-400"
                        style={{ flexGrow: row.not_participating, flexBasis: 0 }}
                      />
                    )}
                    {row.participating > 0 && (
                      <div
                        className="min-h-0 bg-emerald-500"
                        style={{ flexGrow: row.participating, flexBasis: 0 }}
                      />
                    )}
                  </div>
                </div>
                <div
                  className="mt-2 line-clamp-2 w-full text-center text-[10px] leading-tight text-gray-600 dark:text-white/70"
                  title={row.partner}
                >
                  {row.partner}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

function SchoolActivityCard({
  title,
  hint,
  schools,
  loading,
  empty,
  tone,
}: {
  title: string;
  hint: string;
  schools: ExecutiveSchoolActivity[];
  loading: boolean;
  empty: string;
  tone: "active" | "idle";
}) {
  return (
    <section className="rounded-3xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
        <h2 className="font-extrabold text-[var(--primary-blue)] dark:text-white">{title}</h2>
        <p className="text-xs text-gray-500">{hint}</p>
      </div>
      {loading ? (
        <p className="px-5 py-8 text-sm text-center text-gray-400">กำลังโหลด...</p>
      ) : schools.length === 0 ? (
        <p className="px-5 py-8 text-sm text-center text-gray-400">{empty}</p>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-slate-800">
          {schools.map((school, index) => (
            <li key={school.school_id || `${school.school_name}-${index}`} className="px-5 py-3 flex gap-3">
              <span
                className={`mt-0.5 w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-extrabold ${
                  tone === "active"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                }`}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-[var(--primary-blue)] dark:text-white truncate">
                  {school.school_name || school.school_id}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {[school.district_name, school.province].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-extrabold tabular-nums dark:text-white">
                  {tone === "active" ? school.activity.toLocaleString() : school.users.toLocaleString()}
                </div>
                <div className="text-[10px] text-gray-400">{tone === "active" ? "กิจกรรม" : "ผู้ใช้"}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
