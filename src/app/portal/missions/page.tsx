"use client";

import { useEffect, useState } from "react";
import { AuthGuard } from "@/app/components/AuthGuard";
import { ExamAccessGate } from "@/app/components/ExamAccessGate";
import { useIctStore } from "@/contexts/IctStore";
import { fetchMyMissions, submitMissionUrl } from "@/lib/supabase/data";
import { inputClass } from "@/lib/styles";
import type { UserMissionProgress } from "@/types/ict";

function MissionsContent() {
  const { currentCandidate } = useIctStore();
  const [missions, setMissions] = useState<UserMissionProgress[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!currentCandidate) return;
    setLoading(true);
    try {
      const rows = await fetchMyMissions(currentCandidate.id, currentCandidate.phone);
      setMissions(rows);
      const drafts: Record<string, string> = {};
      for (const m of rows) {
        const existing = m.submitted_data?.video_url;
        drafts[m.id] = typeof existing === "string" ? existing : "";
      }
      setUrlDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดภารกิจไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCandidate?.id]);

  const completed = missions.filter((m) => m.status === "completed").length;
  const total = missions.length;

  const saveUrl = async (missionId: string) => {
    if (!currentCandidate) return;
    setError("");
    setMessage("");
    const res = await submitMissionUrl(
      currentCandidate.id,
      currentCandidate.phone,
      missionId,
      urlDrafts[missionId] || ""
    );
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessage("บันทึกภารกิจสำเร็จ");
    await reload();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 animate-fade-in-up">
      <h1 className="text-3xl font-extrabold text-[var(--primary-blue)] dark:text-white mb-2">
        ภารกิจ (Missions)
      </h1>
      <p className="text-gray-500 dark:text-white/70 mb-6">
        ความคืบหน้าของคุณ:{" "}
        <span className="font-bold text-[var(--primary-blue)] dark:text-white">
          {completed}/{total} Missions Completed
        </span>
      </p>

      {error && <p className="text-sm text-[var(--accent-red)] mb-3">{error}</p>}
      {message && <p className="text-sm text-[var(--accent-green)] mb-3">{message}</p>}
      {loading && <p className="text-sm text-gray-400">กำลังโหลด...</p>}

      <div className="space-y-4">
        {missions.map((m) => (
          <div
            key={m.id}
            className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-950 p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs font-bold text-gray-400">#{m.sequence_order}</div>
                <h2 className="text-lg font-bold text-[var(--primary-blue)] dark:text-white">
                  {m.title}
                </h2>
                {m.description && (
                  <p className="text-sm text-gray-600 dark:text-white/70 mt-1">{m.description}</p>
                )}
              </div>
              <span
                className={`text-xs font-bold rounded-full px-3 py-1 ${
                  m.status === "completed"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                    : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                }`}
              >
                {m.status}
              </span>
            </div>

            {m.validation_type === "url_submission" && (
              <div className="mt-4 space-y-2">
                <label className="text-sm font-semibold dark:text-white">ลิงก์วิดีโอโรงเรียน</label>
                <input
                  className={inputClass}
                  type="url"
                  placeholder="https://..."
                  value={urlDrafts[m.id] ?? ""}
                  onChange={(e) =>
                    setUrlDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  onClick={() => void saveUrl(m.id)}
                  className="rounded-full bg-[var(--primary-blue)] text-white px-5 py-2 text-sm font-bold"
                >
                  บันทึกและทำเครื่องหมายสำเร็จ
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PortalMissionsPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <ExamAccessGate mode="missions">
        <MissionsContent />
      </ExamAccessGate>
    </AuthGuard>
  );
}
