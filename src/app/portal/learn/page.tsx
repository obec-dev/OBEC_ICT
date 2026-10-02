"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { ExamAccessGate } from "@/app/components/ExamAccessGate";
import { PeriodClosedNotice } from "@/app/components/PeriodClosedNotice";
import { useIctStore } from "@/contexts/IctStore";
import {
  lessonQuizHref,
  lessonQuizStatusLabel,
  pairVideosWithExamParts,
  sectionAnswerStatus,
} from "@/lib/lessonExamMap";
import { getSiteProject } from "@/lib/siteSettings";
import type { ProjectVideo } from "@/types/ict";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: {
      Player: new (id: string, options: Record<string, unknown>) => YTPlayer;
      PlayerState: { ENDED: number; PLAYING: number };
    };
  }
}

type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  cueVideoById: (videoId: string) => void;
  loadVideoById: (videoId: string) => void;
  destroy?: () => void;
};

function LearnContent() {
  const {
    currentCandidate,
    getWatchFor,
    getExamFor,
    saveWatchProgress,
    isAdmin,
    projects,
    videos,
    questions,
    ensureLearningContent,
  } = useIctStore();

  useEffect(() => {
    void ensureLearningContent();
  }, [ensureLearningContent]);

  const currentProject = useMemo(() => getSiteProject(projects), [projects]);
  const projectVideos = useMemo(
    () => videos.filter((v) => v.project_id === currentProject?.id),
    [videos, currentProject?.id]
  );
  const projectQuestions = useMemo(
    () => questions.filter((q) => q.project_id === currentProject?.id),
    [questions, currentProject?.id]
  );
  const lessonPairs = useMemo(
    () => pairVideosWithExamParts(projectVideos, projectQuestions),
    [projectVideos, projectQuestions]
  );
  const exam = currentCandidate ? getExamFor(currentCandidate.id, currentProject?.id) : undefined;
  const examLocked = exam?.status === "submitted";

  const [selectedVideoId, setSelectedVideoId] = useState<string>("");

  useEffect(() => {
    if (projectVideos.length === 0) return;
    const stillValid = projectVideos.some((v) => v.id === selectedVideoId);
    if (!selectedVideoId || !stillValid) {
      setSelectedVideoId(projectVideos[0].id);
    }
  }, [projectVideos, selectedVideoId]);

  const activeVideo: ProjectVideo | undefined =
    projectVideos.find((v) => v.id === selectedVideoId) || projectVideos[0];

  const playerRef = useRef<YTPlayer | null>(null);
  const playerHostId = "youtube-player";

  const [videoStarted, setVideoStarted] = useState(false);
  const [videoCompleted, setVideoCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const ytVideoId = activeVideo?.video_id || "";
  const existing = currentCandidate && ytVideoId ? getWatchFor(currentCandidate.id, ytVideoId) : undefined;

  useEffect(() => {
    if (existing?.completed) {
      setVideoStarted(true);
      setVideoCompleted(true);
    } else if (existing?.watched_seconds && existing.watched_seconds > 0) {
      setVideoStarted(true);
      setVideoCompleted(false);
    } else {
      setVideoStarted(false);
      setVideoCompleted(false);
    }
  }, [existing, ytVideoId]);

  const ytVideoIdRef = useRef(ytVideoId);
  const currentProjectIdRef = useRef(currentProject?.id);
  ytVideoIdRef.current = ytVideoId;
  currentProjectIdRef.current = currentProject?.id;

  const hasStartedSavedRef = useRef(false);
  const hasCompletedSavedRef = useRef(false);

  const onVideoStarted = useRef(async () => {
    setSaving(true);
    const result = await saveWatchProgress({
      video_id: ytVideoIdRef.current,
      project_id: currentProjectIdRef.current,
      watched_seconds: 1,
      duration_seconds: 0,
      completed: false,
    });
    setSaving(false);
    if (!result.ok) setSaveError(result.error);
  });

  const onVideoCompleted = useRef(async () => {
    setSaving(true);
    let dur = 0;
    try {
      dur = playerRef.current?.getDuration?.() || 0;
    } catch {
      /* ignore */
    }
    const result = await saveWatchProgress({
      video_id: ytVideoIdRef.current,
      project_id: currentProjectIdRef.current,
      watched_seconds: dur,
      duration_seconds: dur,
      completed: true,
    });
    setSaving(false);
    if (result.ok) {
      setSaveMessage("✓ รับชมครบแล้ว");
    } else {
      setSaveError(result.error);
    }
  });

  useEffect(() => {
    onVideoStarted.current = async () => {
      setSaving(true);
      const result = await saveWatchProgress({
        video_id: ytVideoIdRef.current,
        project_id: currentProjectIdRef.current,
        watched_seconds: 1,
        duration_seconds: 0,
        completed: false,
      });
      setSaving(false);
      if (!result.ok) setSaveError(result.error);
    };
    onVideoCompleted.current = async () => {
      setSaving(true);
      let dur = 0;
      try {
        dur = playerRef.current?.getDuration?.() || 0;
      } catch {
        /* ignore */
      }
      const result = await saveWatchProgress({
        video_id: ytVideoIdRef.current,
        project_id: currentProjectIdRef.current,
        watched_seconds: dur,
        duration_seconds: dur,
        completed: true,
      });
      setSaving(false);
      if (result.ok) {
        setSaveMessage("✓ รับชมครบแล้ว");
      } else {
        setSaveError(result.error);
      }
    };
  }, [saveWatchProgress]);

  const onStateChange = useRef((event: { data: number }) => {
    if (event.data === 1) {
      setVideoStarted(true);
      if (!hasStartedSavedRef.current) {
        hasStartedSavedRef.current = true;
        void onVideoStarted.current();
      }
    } else if (event.data === 0) {
      if (!hasCompletedSavedRef.current) {
        hasCompletedSavedRef.current = true;
        setVideoCompleted(true);
        void onVideoCompleted.current();
      }
    }
  });

  // Create / recreate player whenever the YouTube video id changes
  useEffect(() => {
    if (isAdmin || !ytVideoId) return;

    let cancelled = false;

    const destroyPlayer = () => {
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };

    const createPlayer = () => {
      if (cancelled) return;
      const el = document.getElementById(playerHostId);
      if (!el) return;
      destroyPlayer();
      // Ensure a clean host node for YT.Player
      el.innerHTML = "";
      hasStartedSavedRef.current = Boolean(existing?.completed || (existing?.watched_seconds ?? 0) > 0);
      hasCompletedSavedRef.current = Boolean(existing?.completed);
      setSaveMessage("");
      setSaveError("");

      playerRef.current = new window.YT.Player(playerHostId, {
        videoId: ytVideoId,
        playerVars: {
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: (event: { data: number }) => onStateChange.current(event),
        },
      });
    };

    const ensureApi = () => {
      if (window.YT?.Player) {
        // Wait one frame so keyed host remount is in the DOM
        requestAnimationFrame(() => createPlayer());
        return;
      }
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        if (!cancelled) createPlayer();
      };
    };

    ensureApi();

    return () => {
      cancelled = true;
      destroyPlayer();
    };
    // existing is intentionally omitted — progress sync is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytVideoId, isAdmin]);

  if (!currentProject) {
    return (
      <PeriodClosedNotice
        title="ยังไม่มีบทเรียนที่เปิดใช้งาน"
        status={{
          open: false,
          reason: "inactive",
          start: null,
          end: null,
          message: "ขณะนี้ไม่มีโครงการที่เปิดให้เข้าเรียน",
        }}
        homeHref="/"
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in-up">
      <div className="bg-white/70 backdrop-blur-md p-8 rounded-3xl shadow-sm border border-white/60 mb-8">
        <div>
          <span className="text-xs font-bold text-[var(--accent-red)] uppercase tracking-wider bg-red-50 px-3 py-1 rounded-full border border-red-100 mb-2 inline-block">
            บทเรียนและแบบทดสอบ
          </span>
          <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">
            {currentProject.name || "บทเรียนสำหรับตัวแทน ICT Talent"}
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            {currentProject.description ||
              "รับชมวิดีโอแต่ละบท แล้วทำแบบทดสอบประจำบทเรียนนั้น — สลับบทได้จากหน้านี้อย่างเดียว"}
          </p>
        </div>
      </div>

      {lessonPairs.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white/80 dark:bg-slate-950/80 shadow-sm divide-y divide-slate-100 dark:divide-slate-800">
          {lessonPairs.map(({ video: v, part, lessonIndex }) => {
            const watch = currentCandidate ? getWatchFor(currentCandidate.id, v.video_id) : undefined;
            const done = Boolean(watch?.completed);
            const inProgress = !done && Boolean(watch?.watched_seconds && watch.watched_seconds > 0);
            const quizStatus = part ? sectionAnswerStatus(part, exam?.answers, exam) : "empty";
            const selected = activeVideo?.id === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVideoId(v.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  selected
                    ? "bg-blue-50/90 dark:bg-slate-900 border-l-4 border-l-[var(--primary-blue)]"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900/60 border-l-4 border-l-transparent"
                }`}
              >
                <span className="shrink-0 w-8 h-8 rounded-lg bg-[var(--primary-blue)] text-white text-xs font-extrabold flex items-center justify-center">
                  {lessonIndex}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">
                    บทเรียนที่ {lessonIndex}: {v.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] font-bold">
                    {v.is_mandatory && <span className="text-amber-700">สำคัญ</span>}
                    {done && <span className="text-emerald-700">✓ รับชมครบ</span>}
                    {inProgress && <span className="text-blue-600">▶ กำลังรับชม</span>}
                    {part && quizStatus === "submitted" && (
                      <span className="text-emerald-700">✓ ส่งแบบทดสอบแล้ว</span>
                    )}
                    {part && quizStatus === "complete" && (
                      <span className="text-amber-700">ตอบครบ · ยังไม่ส่ง</span>
                    )}
                    {part && quizStatus === "in_progress" && (
                      <span className="text-amber-700">◐ กำลังทำแบบทดสอบ</span>
                    )}
                    {!part && <span className="text-gray-400">ยังไม่มีแบบทดสอบ</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {activeVideo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2">
            <span>{activeVideo.title}</span>
            {activeVideo.is_mandatory && (
              <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-0.5 rounded-full">
                บังคับสำหรับรายวิชานี้
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {videoCompleted && (
              <span className="text-xs font-bold text-[var(--accent-green)] bg-green-50 border border-green-200 px-3 py-1 rounded-full">
                ✓ รับชมครบแล้ว
              </span>
            )}
            {videoStarted && !videoCompleted && (
              <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full">
                ▶ กำลังรับชม
              </span>
            )}
          </div>
        </div>
      )}

      <div className="relative aspect-video overflow-hidden rounded-3xl bg-black shadow-2xl border-4 border-white/50">
        {ytVideoId ? (
          <div key={ytVideoId} className="h-full w-full">
            <div className="h-full w-full" id={playerHostId} />
          </div>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-white/70 text-sm">ไม่มีวิดีโอ</div>
        )}
      </div>

      <div className="mt-6 space-y-4 bg-white/70 backdrop-blur-md p-5 rounded-2xl border border-white/60 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {saving && <span className="text-xs text-gray-400 animate-pulse">กำลังบันทึก...</span>}
          {!saving && saveMessage && (
            <span className="text-sm text-[var(--accent-green)] font-semibold">{saveMessage}</span>
          )}
        </div>

        {(() => {
          const activePair = lessonPairs.find((pair) => pair.video.id === activeVideo?.id);
          if (!activePair) return null;
          const quizStatus = activePair.part
            ? sectionAnswerStatus(activePair.part, exam?.answers, exam)
            : "empty";
          return (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-t border-gray-100 pt-4">
              <div>
                <p className="text-sm font-bold text-[var(--primary-blue)]">
                  แบบทดสอบประจำบทเรียนที่ {activePair.lessonIndex}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {activePair.part
                    ? `${activePair.part.title} · ${lessonQuizStatusLabel(quizStatus)}`
                    : "ยังไม่ได้ผูกแบบทดสอบกับวิดีโอนี้ — ผู้ดูแลควรแมปวิดีโอ ↔ บทเรียนในหน้าจัดการโครงการ"}
                </p>
              </div>
              {activePair.part ? (
                <Link
                  href={lessonQuizHref(
                    activePair.video.id,
                    activePair.lessonIndex,
                    activePair.part?.id
                  )}
                  className={`inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-bold shadow-md transition-all ${
                    examLocked || quizStatus === "submitted"
                      ? "bg-gray-200 text-gray-600"
                      : "bg-[var(--primary-blue)] text-white hover:bg-blue-900"
                  }`}
                >
                  {examLocked || quizStatus === "submitted"
                    ? "ดูแบบทดสอบประจำบทเรียนนี้"
                    : quizStatus === "complete"
                      ? "ส่ง / แก้ไขแบบทดสอบประจำบทเรียนนี้"
                      : quizStatus === "in_progress"
                        ? "ทำแบบทดสอบประจำบทเรียนนี้ต่อ"
                        : "ทำแบบทดสอบประจำบทเรียนนี้"}
                </Link>
              ) : (
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-4 py-2">
                  ยังไม่มีแบบทดสอบสำหรับบทนี้
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {saveError && <p className="mt-3 text-sm text-[var(--accent-red)] font-semibold">{saveError}</p>}
    </div>
  );
}

export default function LearnPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <ExamAccessGate mode="learn-exam">
        <LearnContent />
      </ExamAccessGate>
    </AuthGuard>
  );
}
