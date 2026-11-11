"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { checkinLiveMeeting } from "@/lib/supabase/activity";
import { listPublicLiveMeetings } from "@/lib/supabase/liveMeetings";
import { formatDateTimeTh } from "@/lib/siteSettings";
import { normalizeExternalUrl } from "@/lib/url";
import type { LiveMeeting } from "@/types/ict";
import { useIctStore } from "@/contexts/IctStore";

export function LiveMeetingLanding() {
  const { session } = useIctStore();
  const [meetings, setMeetings] = useState<LiveMeeting[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listPublicLiveMeetings()
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch(() => {
        if (!cancelled) setMeetings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!meetings.length) return null;

  const candidate = session?.kind === "candidate" ? session.candidate : null;

  const onCheckinAndOpenLive = async (meetingId: string, youtubeUrl: string) => {
    if (!candidate) return;
    setError("");
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
    setError("Check-in สำเร็จ แต่ไม่พบลิงก์ Live");
  };

  return (
    <section className="max-w-6xl mx-auto px-4 mb-12 animate-fade-in-up">
      <div className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 shadow-[0_12px_40px_rgba(16,185,129,0.12)] overflow-hidden">
        <div className="px-6 md:px-8 pt-6 pb-2">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1">
            Live meeting
          </p>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--primary-blue)]">
            Live
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            กดปุ่มเพื่อ Check-in และเปิด Live
          </p>
          {error && <p className="text-sm text-[var(--accent-red)] mt-2">{error}</p>}
        </div>

        <div className="px-6 md:px-8 pb-6 pt-2 space-y-3">
          {meetings.map((m) => {
            const liveUrl = normalizeExternalUrl(m.youtube_url);
            return (
              <div
                key={m.id}
                className="rounded-2xl border border-white/80 bg-white/90 shadow-sm p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-extrabold text-gray-900 text-lg">{m.title}</h3>
                    {m.in_window ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold px-2.5 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden />
                        กำลังถ่ายทอด
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 text-amber-900 text-[11px] font-bold px-2.5 py-0.5">
                        เร็วๆ นี้
                      </span>
                    )}
                  </div>
                  <p className="text-xs md:text-sm text-gray-500">
                    {formatDateTimeTh(m.window_start)} – {formatDateTimeTh(m.window_end)}
                    {m.score_points > 0 ? ` · ${m.score_points} คะแนน` : ""}
                  </p>
                </div>
                <div className="shrink-0">
                  {m.in_window && liveUrl ? (
                    candidate ? (
                      <button
                        type="button"
                        disabled={busy === m.id}
                        onClick={() => void onCheckinAndOpenLive(m.id, m.youtube_url)}
                        className="rounded-full bg-emerald-600 text-white px-5 py-2.5 text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        {busy === m.id ? "กำลัง Check-in..." : "Check-in และเปิด Live"}
                      </button>
                    ) : (
                      <Link
                        href="/login"
                        className="rounded-full bg-emerald-600 text-white px-5 py-2.5 text-sm font-bold hover:bg-emerald-700 transition-colors inline-block"
                      >
                        เข้าสู่ระบบเพื่อ Check-in และเปิด Live
                      </Link>
                    )
                  ) : (
                    <span className="text-xs text-gray-500 font-medium">
                      อยู่นอกช่วงเวลา check-in
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
