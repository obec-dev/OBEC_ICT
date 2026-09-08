"use client";

import { useCallback, useEffect, useState } from "react";
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

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError("");
    try {
      const [list, st, hist] = await Promise.all([
        adminListAuditLogs(adminToken, 150, 0),
        adminAuditStats(adminToken),
        adminListPurgeHistory(adminToken),
      ]);
      setLogs(list);
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

  const exportLogs = async () => {
    if (!adminToken) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const rows = await adminExportAuditLogs(adminToken);
      const filename = `audit-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      downloadJson(filename, {
        exported_at: new Date().toISOString(),
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
      </p>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-2xl font-extrabold text-[var(--primary-blue)]">{stats.total_logs}</div>
            <div className="text-xs text-gray-500 mt-1">รายการในฐานข้อมูล</div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-sm font-bold text-gray-800 break-all">{stats.oldest_at ?? "-"}</div>
            <div className="text-xs text-gray-500 mt-1">เก่าสุด</div>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-4">
            <div className="text-sm font-bold text-gray-800 break-all">{stats.newest_at ?? "-"}</div>
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
          <h2 className="font-bold text-[var(--primary-blue)] mb-3">รายการล่าสุด (150 แถว)</h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto mb-8">
            <table className="w-full text-sm">
              <thead className="bg-[var(--primary-blue)] text-white">
                <tr>
                  <th className="text-left px-3 py-3">เวลา</th>
                  <th className="text-left px-3 py-3">ผู้ดูแล</th>
                  <th className="text-left px-3 py-3">action</th>
                  <th className="text-left px-3 py-3">ตาราง</th>
                  <th className="text-left px-3 py-3">target</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.log_id} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-3 text-xs whitespace-nowrap">{log.created_at}</td>
                    <td className="px-3 py-3">{log.admin_username ?? "-"}</td>
                    <td className="px-3 py-3 font-semibold">{log.action}</td>
                    <td className="px-3 py-3">{log.target_table}</td>
                    <td className="px-3 py-3 font-mono text-xs break-all">{log.target_id ?? "-"}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      ยังไม่มี log
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

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
                    <td className="px-3 py-3 text-xs whitespace-nowrap">{h.created_at}</td>
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
