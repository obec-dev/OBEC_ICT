"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { AdminNav } from "@/app/components/AdminNav";
import { useIctStore } from "@/contexts/IctStore";
import {
  adminAuditStats,
  adminExportAuditLogs,
  adminListAuditLogs,
  adminListPurgeHistory,
  adminPurgeAuditLogs,
  type AuditLogRow,
  type AuditPurgeHistoryRow,
} from "@/lib/supabase/admin";
import { inputClass } from "@/lib/styles";
import { formatDateTimeTh } from "@/lib/siteSettings";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Prefer server Bangkok label; fall back to client Asia/Bangkok format. */
function formatAuditTime(value: string | null | undefined): string {
  if (!value) return "-";
  if (/GMT\+7|Asia\/Bangkok/i.test(value)) return value;
  return formatDateTimeTh(value) || value;
}

function bangkokStampForFilename(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function auditSummaryLabel(log: AuditLogRow): string {
  const s = log.summary?.trim();
  if (s) return s;
  const bits = [log.action, log.target_id].filter(Boolean);
  return bits.length ? bits.join(" · ") : log.action;
}

type SettingChange = { key: string; before: unknown; after: unknown };

function extractSettingChanges(data: unknown): SettingChange[] | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const changes = (data as { changes?: unknown }).changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const rows: SettingChange[] = [];
  for (const item of changes) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string") continue;
    rows.push({ key: row.key, before: row.before, after: row.after });
  }
  return rows.length ? rows : null;
}

function formatAuditJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function AuditDetailPanel({ log }: { log: AuditLogRow }) {
  const changes =
    extractSettingChanges(log.new_data) ?? extractSettingChanges(log.old_data);

  if (changes) {
    return (
      <div className="space-y-2 text-xs">
        <p className="font-semibold text-gray-700">ค่าที่เปลี่ยน</p>
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 font-semibold">key</th>
                <th className="px-3 py-2 font-semibold">ก่อน</th>
                <th className="px-3 py-2 font-semibold">หลัง</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.key} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{c.key}</td>
                  <td className="px-3 py-2 font-mono whitespace-pre-wrap break-all text-amber-800">
                    {formatAuditJson(c.before)}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-pre-wrap break-all text-emerald-800">
                    {formatAuditJson(c.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 text-xs">
      <div>
        <p className="font-semibold text-gray-700 mb-1">ก่อน (old_data)</p>
        <pre className="rounded-xl border border-gray-100 bg-white p-3 overflow-x-auto whitespace-pre-wrap break-all text-amber-900">
          {formatAuditJson(log.old_data)}
        </pre>
      </div>
      <div>
        <p className="font-semibold text-gray-700 mb-1">หลัง (new_data)</p>
        <pre className="rounded-xl border border-gray-100 bg-white p-3 overflow-x-auto whitespace-pre-wrap break-all text-emerald-900">
          {formatAuditJson(log.new_data)}
        </pre>
      </div>
    </div>
  );
}

function AuditContent() {
  const { adminToken } = useIctStore();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [history, setHistory] = useState<AuditPurgeHistoryRow[]>([]);
  const [stats, setStats] = useState<{
    total_logs: number;
    oldest_at: string | null;
    newest_at: string | null;
    purge_count: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError("");
    try {
      const [list, st, hist] = await Promise.all([
        adminListAuditLogs(adminToken, PAGE_SIZE, 0),
        adminAuditStats(adminToken),
        adminListPurgeHistory(adminToken),
      ]);
      setLogs(list);
      setHasMore(list.length >= PAGE_SIZE);
      setStats(st);
      setHistory(hist);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลด audit log ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = async () => {
    if (!adminToken || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const next = await adminListAuditLogs(adminToken, PAGE_SIZE, logs.length);
      setLogs((prev) => [...prev, ...next]);
      setHasMore(next.length >= PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดเพิ่มไม่สำเร็จ");
    } finally {
      setLoadingMore(false);
    }
  };

  const exportLogs = async () => {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const rows = await adminExportAuditLogs(adminToken);
      const filename = `audit-logs-${bangkokStampForFilename()}.json`;
      downloadJson(filename, {
        exported_at: formatAuditTime(new Date().toISOString()),
        timezone: "Asia/Bangkok (GMT+7)",
        count: rows.length,
        logs: rows,
      });
      setMessage(`ส่งออกแล้ว ${rows.length} รายการ → ไฟล์ ${filename} (เก็บไฟล์นี้ไว้เป็นข้อมูลอ้างอิงภายนอก)`);
      return filename;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งออกไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!adminToken) return;
    setError("");
    setMessage("");
    if (confirmText.trim() !== "PURGE") {
      setError("พิมพ์ PURGE ในช่องยืนยันก่อนล้าง log");
      return;
    }
    if (!confirm("จะส่งออกไฟล์ JSON ก่อน แล้วล้าง audit_logs ให้ว่าง — ดำเนินการต่อ?")) return;

    setBusy(true);
    try {
      const rows = await adminExportAuditLogs(adminToken);
      const filename = `audit-logs-before-purge-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      downloadJson(filename, {
        exported_at: new Date().toISOString(),
        purpose: "pre-purge backup",
        count: rows.length,
        logs: rows,
      });

      const result = await adminPurgeAuditLogs(adminToken, filename, "PURGE");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(
        `ล้าง log แล้ว ${result.purged_count} รายการ — เก็บไฟล์ ${filename} ไว้ภายนอก และมีประวัติการล้างในระบบ`
      );
      setConfirmText("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ล้าง log ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 animate-fade-in-up">
      <AdminNav />
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] mb-2">Audit logs</h1>
      <p className="text-gray-500 mb-6">
        บันทึกการกระทำของผู้ดูแล — ส่งออกเป็นไฟล์ภายนอกได้ และล้างตารางเมื่อเต็ม (คงประวัติการล้างไว้)
        <span className="block text-xs mt-1 text-gray-400">เวลาแสดงเป็น Asia/Bangkok (GMT+7)</span>
      </p>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-2xl font-extrabold text-[var(--primary-blue)]">{stats.total_logs}</div>
            <div className="text-xs text-gray-500 mt-1">รายการในฐานข้อมูล</div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-sm font-bold text-gray-800 break-all">{formatAuditTime(stats.oldest_at)}</div>
            <div className="text-xs text-gray-500 mt-1">เก่าสุด</div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-sm font-bold text-gray-800 break-all">{formatAuditTime(stats.newest_at)}</div>
            <div className="text-xs text-gray-500 mt-1">ใหม่สุด</div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-2xl font-extrabold text-amber-700">{stats.purge_count}</div>
            <div className="text-xs text-gray-500 mt-1">ครั้งที่เคยล้าง</div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 space-y-3">
        <h2 className="font-bold text-[var(--primary-blue)]">ส่งออก / ล้าง log</h2>
        <p className="text-sm text-gray-500">
          แนะนำ: กดส่งออกเก็บไฟล์ JSON ไว้ก่อนเสมอ การล้างจะดาวน์โหลด backup อัตโนมัติ แล้วลบแถวใน{" "}
          <code>audit_logs</code> ให้เหลือ 0 พร้อมบันทึกชื่อไฟล์ในประวัติการล้าง
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportLogs()}
            className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2.5 font-bold disabled:opacity-40"
          >
            ส่งออก JSON
          </button>
          <input
            className={`${inputClass} sm:max-w-xs`}
            placeholder='พิมพ์ PURGE เพื่อยืนยันล้าง'
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void purge()}
            className="rounded-full bg-[var(--accent-red)] text-white px-5 py-2.5 font-bold disabled:opacity-40"
          >
            ล้าง log ทั้งหมด
          </button>
        </div>
        {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
        {message && <p className="text-sm text-[var(--accent-green)] whitespace-pre-line">{message}</p>}
      </div>

      {loading ? (
        <p className="text-gray-500">กำลังโหลด...</p>
      ) : (
        <>
          <h2 className="font-bold text-[var(--primary-blue)] mb-3">
            รายการล่าสุด ({logs.length} แถว{stats ? ` / ทั้งหมด ~${stats.total_logs}` : ""})
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-[var(--primary-blue)] text-white">
                <tr>
                  <th className="text-left px-3 py-3 w-8" aria-label="expand" />
                  <th className="text-left px-3 py-3">เวลา</th>
                  <th className="text-left px-3 py-3">ผู้ดูแล</th>
                  <th className="text-left px-3 py-3">รายละเอียด</th>
                  <th className="text-left px-3 py-3">action</th>
                  <th className="text-left px-3 py-3">ตาราง</th>
                  <th className="text-left px-3 py-3">target</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const open = expandedId === log.log_id;
                  const hasPayload = log.old_data != null || log.new_data != null;
                  return (
                    <Fragment key={log.log_id}>
                      <tr className="border-t border-gray-100 align-top">
                        <td className="px-2 py-3">
                          <button
                            type="button"
                            disabled={!hasPayload}
                            aria-expanded={open}
                            onClick={() =>
                              setExpandedId((prev) => (prev === log.log_id ? null : log.log_id))
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-xs font-bold text-[var(--primary-blue)] disabled:opacity-30 disabled:cursor-default"
                            title={hasPayload ? (open ? "ซ่อนรายละเอียด" : "ดูก่อน/หลัง") : "ไม่มีข้อมูลก่อน/หลัง"}
                          >
                            {open ? "−" : "+"}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-xs whitespace-nowrap">{formatAuditTime(log.created_at)}</td>
                        <td className="px-3 py-3">{log.admin_username ?? "-"}</td>
                        <td className="px-3 py-3 text-gray-800 max-w-xs md:max-w-md">
                          <span className="line-clamp-2" title={auditSummaryLabel(log)}>
                            {auditSummaryLabel(log)}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-semibold whitespace-nowrap">{log.action}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{log.target_table}</td>
                        <td className="px-3 py-3 font-mono text-xs break-all">{log.target_id ?? "-"}</td>
                      </tr>
                      {open && (
                        <tr className="border-t border-gray-50 bg-slate-50/80">
                          <td colSpan={7} className="px-4 py-4">
                            <AuditDetailPanel log={log} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      ยังไม่มี log
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="mb-8 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-[var(--primary-blue)] disabled:opacity-40"
              >
                {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่มเติม (Load More)"}
              </button>
            </div>
          )}

          <h2 className="font-bold text-[var(--primary-blue)] mb-3">ประวัติการล้าง (อ้างอิงไฟล์ภายนอก)</h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-white">
                <tr>
                  <th className="text-left px-3 py-3">เมื่อ</th>
                  <th className="text-left px-3 py-3">โดย</th>
                  <th className="text-left px-3 py-3">จำนวนที่ลบ</th>
                  <th className="text-left px-3 py-3">ไฟล์ export</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.purge_id} className="border-t border-gray-100">
                    <td className="px-3 py-3 text-xs whitespace-nowrap">{formatAuditTime(h.created_at)}</td>
                    <td className="px-3 py-3">{h.admin_username ?? "-"}</td>
                    <td className="px-3 py-3 font-bold">{h.purged_count}</td>
                    <td className="px-3 py-3 font-mono text-xs break-all">{h.export_filename ?? "-"}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                      ยังไม่เคยล้าง log
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <AuthGuard requireAdmin requireRoles={["super_admin"]}>
      <AuditContent />
    </AuthGuard>
  );
}
