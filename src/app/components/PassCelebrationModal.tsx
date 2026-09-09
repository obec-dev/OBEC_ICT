"use client";

import { useEffect, useMemo, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import { getSiteProject } from "@/lib/siteSettings";

function dismissKey(profileId: string, projectId: string) {
  return `ict_pass_dismissed_${profileId}_${projectId}`;
}

export function PassCelebrationModal() {
  const { session, hydrated, projects, getExamFor } = useIctStore();
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const siteProject = useMemo(() => getSiteProject(projects), [projects]);
  const candidate = session?.kind === "candidate" ? session.candidate : null;

  const exam = candidate && siteProject ? getExamFor(candidate.id, siteProject.id) : undefined;
  const shouldCelebrate =
    hydrated &&
    Boolean(candidate) &&
    Boolean(siteProject?.enable_results_visibility) &&
    exam?.status === "submitted" &&
    exam.passed === true &&
    Boolean(exam.graded_at);

  useEffect(() => {
    if (!shouldCelebrate || !candidate || !siteProject) {
      setOpen(false);
      return;
    }
    try {
      if (localStorage.getItem(dismissKey(candidate.id, siteProject.id)) === "1") {
        setOpen(false);
        return;
      }
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, [shouldCelebrate, candidate, siteProject]);

  if (!open || !candidate || !siteProject) return null;

  const close = () => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(dismissKey(candidate.id, siteProject.id), "1");
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-emerald-100 dark:border-emerald-900 animate-scale-up">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 18 }).map((_, i) => (
            <span
              key={i}
              className="absolute confetti-piece"
              style={{
                left: `${(i * 37) % 100}%`,
                animationDelay: `${(i % 8) * 0.12}s`,
                background:
                  i % 3 === 0 ? "#34d399" : i % 3 === 1 ? "#fbbf24" : "#60a5fa",
              }}
            />
          ))}
        </div>

        <div className="relative p-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl shadow-inner animate-float">
            🏆
          </div>
          <h2 className="text-2xl font-extrabold text-emerald-800 dark:text-emerald-300 mb-2">
            ยินดีด้วย!
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
            ท่านผ่านการทดสอบโครงการ
            <br />
            <span className="font-bold text-[var(--primary-blue)]">{siteProject.name}</span>
            {" "}เรียบร้อยแล้ว
          </p>

          <label className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-emerald-600"
            />
            ไม่ต้องแสดงข้อความนี้อีก
          </label>

          <button
            type="button"
            onClick={close}
            className="mt-5 w-full rounded-full bg-emerald-600 text-white py-3 font-bold hover:bg-emerald-700 transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
