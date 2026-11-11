"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import {
  clearReadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/supabase/notifications";
import type { AppNotification } from "@/types/ict";
import { formatDateTimeTh } from "@/lib/siteSettings";

const LOGIN_BANNER_KEY = "ict_notif_login_seen";

export function NotificationBell() {
  const { session, hydrated } = useIctStore();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState<AppNotification | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionKey =
    session?.kind === "candidate"
      ? `c:${session.candidate.id}`
      : session?.kind === "admin"
        ? `a:${session.admin.admin_id}`
        : session?.kind === "business" || session?.kind === "audit"
          ? `${session.kind}:${session.user.login_email}`
          : "";

  const reload = useCallback(async () => {
    if (!session) {
      setRows([]);
      setUnread(0);
      return;
    }
    try {
      const res = await listMyNotifications(session, 30);
      setRows(res.rows);
      setUnread(res.unread_count);
      setError("");
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดการแจ้งเตือนไม่สำเร็จ");
      return null;
    }
  }, [session]);

  useEffect(() => {
    if (!hydrated || !session) return;
    void reload().then((res) => {
      if (!res) return;
      const denied = res.rows.find((n) => n.is_unread && n.kind === "task_denied");
      if (!denied) return;
      const seenKey = `${LOGIN_BANNER_KEY}:${sessionKey}`;
      try {
        if (sessionStorage.getItem(seenKey) === denied.id) return;
        sessionStorage.setItem(seenKey, denied.id);
      } catch {
        /* ignore */
      }
      setBanner(denied);
    });
  }, [hydrated, session, sessionKey, reload]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!session) return null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="relative inline-flex items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-[var(--primary-blue)] dark:text-white"
        aria-label="การแจ้งเตือน"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          void reload();
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-[var(--accent-red)] text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 shadow-xl z-[70] overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
            <div className="font-extrabold text-sm text-[var(--primary-blue)] dark:text-white">การแจ้งเตือน</div>
            <div className="flex items-center gap-3 shrink-0">
              {unread > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--primary-blue)] underline"
                  onClick={() => {
                    void markAllNotificationsRead(session).then(() => void reload());
                  }}
                >
                  อ่านทั้งหมด
                </button>
              )}
              {rows.some((n) => !n.is_unread) && (
                <button
                  type="button"
                  className="text-xs font-semibold text-gray-500 underline"
                  onClick={() => {
                    void clearReadNotifications(session).then(() => void reload());
                  }}
                >
                  ลบที่อ่านแล้ว
                </button>
              )}
            </div>
          </div>
          {error && <p className="px-4 py-2 text-xs text-[var(--accent-red)]">{error}</p>}
          <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50 dark:divide-slate-800">
            {rows.map((n) => (
              <li key={n.id} className={`px-4 py-3 ${n.is_unread ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                <div className="text-sm font-bold text-gray-900 dark:text-white">{n.title}</div>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 whitespace-pre-wrap">{n.body}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <span className="text-[10px] text-gray-400">{formatDateTimeTh(n.created_at)}</span>
                  <div className="flex gap-2">
                    {n.is_unread && (
                      <button
                        type="button"
                        className="text-[10px] font-semibold underline"
                        onClick={() => {
                          void markNotificationRead(session, n.id).then(() => void reload());
                        }}
                      >
                        อ่านแล้ว
                      </button>
                    )}
                    {n.link_path && (
                      <Link
                        href={n.link_path}
                        className="text-[10px] font-semibold text-[var(--primary-blue)] underline"
                        onClick={() => {
                          void markNotificationRead(session, n.id);
                          setOpen(false);
                        }}
                      >
                        เปิด
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {!rows.length && (
              <li className="px-4 py-6 text-sm text-gray-500 text-center">ยังไม่มีการแจ้งเตือน</li>
            )}
          </ul>
        </div>
      )}

      {banner && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-950 border border-gray-100 dark:border-slate-700 p-6 shadow-2xl space-y-3">
            <h2 className="text-lg font-extrabold text-[var(--primary-blue)] dark:text-white">{banner.title}</h2>
            <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{banner.body}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {banner.link_path && (
                <Link
                  href={banner.link_path}
                  className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2 text-sm font-bold"
                  onClick={() => {
                    void markNotificationRead(session, banner.id).then(() => void reload());
                    setBanner(null);
                  }}
                >
                  ไปที่กิจกรรม
                </Link>
              )}
              <button
                type="button"
                className="rounded-full border px-5 py-2 text-sm font-bold"
                onClick={() => {
                  void markNotificationRead(session, banner.id).then(() => void reload());
                  setBanner(null);
                }}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
