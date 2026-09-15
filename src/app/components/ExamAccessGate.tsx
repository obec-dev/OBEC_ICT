"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import { candidateCanAccessMissions } from "@/lib/examAccess";

/** Redirect passed candidates away from learn/exam; others away from missions. */
export function ExamAccessGate({
  mode,
  children,
}: {
  mode: "learn-exam" | "missions";
  children: React.ReactNode;
}) {
  const { session, examProgress, examProgressReady, projects, hydrated } = useIctStore();
  const router = useRouter();
  const passed = candidateCanAccessMissions(session, examProgress, projects);

  useEffect(() => {
    if (!hydrated || !examProgressReady || session?.kind !== "candidate") return;
    if (mode === "learn-exam" && passed) {
      router.replace("/portal/missions");
      return;
    }
    if (mode === "missions" && !passed) {
      router.replace("/portal/learn");
    }
  }, [examProgressReady, hydrated, mode, passed, router, session?.kind]);

  if (!hydrated || !examProgressReady) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-sm text-gray-400">
        กำลังโหลด...
      </div>
    );
  }

  if (mode === "learn-exam" && passed) return null;
  if (mode === "missions" && !passed) return null;
  return <>{children}</>;
}
