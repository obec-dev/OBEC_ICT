"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
import {
  creditSelfLearnVideo,
  listSelfLearnVideos,
  type SelfLearnVideo,
} from "@/lib/supabase/selfLearn";
import { normalizeExternalUrl } from "@/lib/url";

function ELearningContent() {
  const { session } = useIctStore();
  const candidate = session?.kind === "candidate" ? session.candidate : null;
  const [rows, setRows] = useState<SelfLearnVideo[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!candidate) return;
    setLoading(true);
    try {
      setRows(await listSelfLearnVideos(candidate.id, candidate.phone));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดวิดีโอไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [candidate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!candidate) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-600 mb-4">หน้า E-learning สำหรับผู้สมัครตัวแทน ICT Talent</p>
        <Link href="/" className="px-6 py-2.5 bg-[var(--primary-blue)] text-white rounded-full font-bold">
          กลับหน้าหลัก
        </Link>
      </div>
    );
  }

  const openVideo = (rawUrl: string) => {
    const url = normalizeExternalUrl(rawUrl);
    if (url) window.location.assign(url);
  };

  const onCredit = async (video: SelfLearnVideo) => {
    setBusy(video.id);
    setError("");
    setMessage("");
    const res = await creditSelfLearnVideo(candidate.id, candidate.phone, video.id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const url = normalizeExternalUrl(video.video_url);
    if (url) {
      window.location.assign(url);
      return;
    }
    setMessage(
      res.credited ? `รับชมและได้รับ +${res.points} คะแนน` : "บันทึกการรับชมแล้ว (คะแนนนี้เคยได้รับแล้ว)"
    );
    await reload();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in-up">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white">
          E-learning
        </h1>
        <p className="text-sm text-gray-500 mt-1">เรียนรู้ด้วยตนเองจากวิดีโอ</p>
      </div>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-emerald-700 mb-3">{message}</p>}
      {loading && <p className="text-sm text-gray-500">กำลังโหลด...</p>}

      <div className="space-y-3">
        {rows.map((v) => {
          const url = normalizeExternalUrl(v.video_url);
          return (
            <div
              key={v.id}
              className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5 space-y-2"
            >
              <div className="font-extrabold text-[var(--primary-blue)] dark:text-white">{v.title}</div>
              <div className="text-xs text-gray-500">{v.score_points} คะแนน</div>
              {v.credited ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-block text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                    ได้รับคะแนนแล้ว
                  </span>
                  {url && (
                    <button
                      type="button"
                      className="text-sm font-bold underline text-[var(--primary-blue)]"
                      onClick={() => openVideo(v.video_url)}
                    >
                      เปิดวิดีโออีกครั้ง
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy === v.id}
                  onClick={() => void onCredit(v)}
                  className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2 text-sm font-bold disabled:opacity-50"
                >
                  {busy === v.id ? "กำลังบันทึก..." : "เปิดวิดีโอและรับคะแนน"}
                </button>
              )}
            </div>
          );
        })}
        {!loading && !rows.length && (
          <p className="text-sm text-gray-500">ยังไม่มีวิดีโอที่เผยแพร่</p>
        )}
      </div>
    </div>
  );
}

export default function PortalELearningPage() {
  return (
    <AuthGuard>
      <ELearningContent />
    </AuthGuard>
  );
}
