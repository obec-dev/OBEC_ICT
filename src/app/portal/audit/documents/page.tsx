"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
import { fetchAuditorDocuments } from "@/lib/supabase/activity";
import { listMyNotifications, markNotificationRead } from "@/lib/supabase/notifications";
import { normalizeExternalUrl } from "@/lib/url";
import { formatDateTimeTh } from "@/lib/siteSettings";

function AuditorDocumentsInner() {
  const { session } = useIctStore();
  const user = session?.kind === "audit" ? session.user : null;
  const email = user?.login_email ?? "";
  const [docs, setDocs] = useState<Awaited<ReturnType<typeof fetchAuditorDocuments>>>([]);
  const [error, setError] = useState("");
  const [newCount, setNewCount] = useState(0);

  const reload = useCallback(async () => {
    if (!email || !session) return;
    setError("");
    try {
      const [doc, notif] = await Promise.all([
        fetchAuditorDocuments(email),
        listMyNotifications(session, 50).catch(() => ({ unread_count: 0, rows: [] })),
      ]);
      setDocs(doc);
      const unreadDocs = notif.rows.filter((n) => n.is_unread && n.kind === "auditor_document");
      setNewCount(unreadDocs.length);
      // Mark document notifications read when opening the library
      for (const n of unreadDocs) {
        void markNotificationRead(session, n.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดเอกสารไม่สำเร็จ");
    }
  }, [email, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
      <Link href="/portal/audit" className="text-sm font-semibold text-[var(--primary-blue)]">
        ← กลับแดชบอร์ด
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--primary-blue)]">คลังเอกสาร</h1>
        <p className="text-sm text-gray-500 mt-1">
          เอกสารที่ Admin มอบให้เขตของคุณ
          {newCount > 0 ? ` · มีเอกสารใหม่ ${newCount} รายการ` : ""}
        </p>
      </div>
      {error && <p className="text-sm text-[var(--accent-red)]">{error}</p>}
      <ul className="bg-white dark:bg-slate-950 rounded-2xl border border-gray-100 dark:border-slate-800 divide-y">
        {docs.map((d) => {
          const href = normalizeExternalUrl(d.file_url);
          return (
            <li key={d.id} className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-[var(--primary-blue)] dark:text-white">{d.title}</div>
                {d.created_at && (
                  <div className="text-xs text-gray-400 mt-1">{formatDateTimeTh(d.created_at)}</div>
                )}
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold underline text-[var(--primary-blue)]"
                >
                  เปิดเอกสาร
                </a>
              ) : (
                <span className="text-xs text-gray-400">ไม่มีลิงก์</span>
              )}
            </li>
          );
        })}
        {!docs.length && (
          <li className="px-5 py-8 text-sm text-gray-500 text-center">ยังไม่มีเอกสารในเขตนี้</li>
        )}
      </ul>
    </div>
  );
}

export default function AuditorDocumentsPage() {
  return (
    <AuthGuard requireAudit>
      <AuditorDocumentsInner />
    </AuthGuard>
  );
}
