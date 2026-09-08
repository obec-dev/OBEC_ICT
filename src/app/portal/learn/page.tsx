"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthGuard } from "@/app/components/AuthGuard";
import { useIctStore } from "@/contexts/IctStore";
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
};

function LearnContent() {
  const {
    currentCandidate,
    getWatchFor,
    saveWatchProgress,
    isAdmin,
    projects,
    videos,
    activeProjectId,
    setActiveProjectId,
  } = useIctStore();

  const currentProject = projects.find((p) => p.id === activeProjectId) || projects[0];
  const projectVideos = videos.filter((v) => v.project_id === (currentProject?.id || activeProjectId));

  const [selectedVideoId, setSelectedVideoId] = useState<string>("");

  useEffect(() => {
    if (projectVideos.length > 0 && !selectedVideoId) {
      setSelectedVideoId(projectVideos[0].id);
    }
  }, [projectVideos, selectedVideoId]);

  const activeVideo: ProjectVideo | undefined =
    projectVideos.find((v) => v.id === selectedVideoId) || projectVideos[0];

  const playerRef = useRef<YTPlayer | null>(null);
  const loadedVideoIdRef = useRef<string>("");
  const isAdminRef = useRef(isAdmin);

  // Simple 2-state tracking: started (ever played) and completed (reached end)
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoCompleted, setVideoCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const ytVideoId = activeVideo?.video_id || "YaG5SAw1n0c";
  const existing = currentCandidate ? getWatchFor(currentCandidate.id, ytVideoId) : undefined;

  // Sync existing DB state when video changes
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

  // Stable refs for save and end callbacks (avoids effect re-runs)
  const ytVideoIdRef = useRef(ytVideoId);
  const activeProjectIdRef = useRef(activeProjectId);
  const currentProjectIdRef = useRef(currentProject?.id);
  ytVideoIdRef.current = ytVideoId;
  activeProjectIdRef.current = activeProjectId;
  currentProjectIdRef.current = currentProject?.id;

  const onVideoStarted = useRef(async () => {
    setSaving(true);
    const result = await saveWatchProgress({
      video_id: ytVideoIdRef.current,
      project_id: currentProjectIdRef.current || activeProjectIdRef.current,
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
    try { dur = playerRef.current?.getDuration?.() || 0; } catch { /* ignore */ }
    const result = await saveWatchProgress({
      video_id: ytVideoIdRef.current,
      project_id: currentProjectIdRef.current || activeProjectIdRef.current,
      watched_seconds: dur,
      duration_seconds: dur,
      completed: true,
    });
    setSaving(false);
    if (result.ok) {
      setSaveMessage("บันทึกสถานะ: รับชมครบแล้ว ✓");
    } else {
      setSaveError(result.error);
    }
  });

  // Update the stable save refs whenever saveWatchProgress changes
  useEffect(() => {
    onVideoStarted.current = async () => {
      setSaving(true);
      const result = await saveWatchProgress({
        video_id: ytVideoIdRef.current,
        project_id: currentProjectIdRef.current || activeProjectIdRef.current,
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
      try { dur = playerRef.current?.getDuration?.() || 0; } catch { /* ignore */ }
      const result = await saveWatchProgress({
        video_id: ytVideoIdRef.current,
        project_id: currentProjectIdRef.current || activeProjectIdRef.current,
        watched_seconds: dur,
        duration_seconds: dur,
        completed: true,
      });
      setSaving(false);
      if (result.ok) {
        setSaveMessage("บันทึกสถานะ: รับชมครบแล้ว ✓");
      } else {
        setSaveError(result.error);
      }
    };
  }, [saveWatchProgress]);

  // Stable onStateChange ref
  const hasStartedSavedRef = useRef(false);
  const hasCompletedSavedRef = useRef(false);

  const onStateChange = useRef((event: { data: number }) => {
    if (event.data === 1) {
      // PLAYING
      setVideoStarted(true);
      if (!hasStartedSavedRef.current) {
        hasStartedSavedRef.current = true;
        void onVideoStarted.current();
      }
    } else if (event.data === 0) {
      // ENDED
      if (!hasCompletedSavedRef.current) {
        hasCompletedSavedRef.current = true;
        setVideoCompleted(true);
        void onVideoCompleted.current();
      }
    }
  });

  // One-time player init
  useEffect(() => {
    if (isAdminRef.current) return;

    const initPlayer = (videoId: string) => {
      const el = document.getElementById("youtube-player");
      if (!el) return;
      loadedVideoIdRef.current = videoId;
      playerRef.current = new window.YT.Player("youtube-player", {
        videoId,
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

    const currentVideoId = ytVideoId;

    if (window.YT && window.YT.Player) {
      initPlayer(currentVideoId);
    } else {
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      }
      window.onYouTubeIframeAPIReady = () => initPlayer(currentVideoId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // Video switching — only runs when ytVideoId truly changes
  useEffect(() => {
    if (!playerRef.current) return;
    if (loadedVideoIdRef.current === ytVideoId) return;
    try {
      if (typeof playerRef.current.cueVideoById === "function") {
        playerRef.current.cueVideoById(ytVideoId);
        loadedVideoIdRef.current = ytVideoId;
        // Reset tracking for the new video
        hasStartedSavedRef.current = false;
        hasCompletedSavedRef.current = false;
        setSaveMessage("");
        setSaveError("");
      }
    } catch {
      /* player not ready yet */
    }
  }, [ytVideoId]);

  const handleRewatch = () => {
    hasCompletedSavedRef.current = false;
    setVideoCompleted(false);
    try {
      playerRef.current?.seekTo?.(0, true);
      playerRef.current?.playVideo?.();
    } catch { /* ignore */ }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 animate-fade-in-up">
      {/* Header Banner */}
      <div className="bg-white/70 backdrop-blur-md p-8 rounded-3xl shadow-sm border border-white/60 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold text-[var(--accent-red)] uppercase tracking-wider bg-red-50 px-3 py-1 rounded-full border border-red-100 mb-2 inline-block">
              ศูนย์การเรียนรู้ออนไลน์
            </span>
            <h1 className="text-3xl font-extrabold text-[var(--primary-blue)]">
              {currentProject?.name || "บทเรียนสำหรับตัวแทน ICT Talent"}
            </h1>
            <p className="text-gray-600 text-sm mt-1">
              {currentProject?.description || "รับชมวิดีโอเพื่อเรียนรู้ตามความสะดวก (รับชมได้ไม่จำกัดจำนวนครั้ง)"}
            </p>
          </div>

          <Link
            href="/portal/exam"
            className="self-start md:self-center shrink-0 rounded-full bg-[var(--primary-blue)] text-white px-6 py-3 font-bold hover:bg-blue-900 transition-all shadow-md flex items-center gap-2"
          >
            <span>ไปยังหน้าข้อสอบ</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>

        {/* Project Selector if multiple projects */}
        {projects.length > 1 && (
          <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-gray-700">เลือกโครงการ/วิชา:</span>
            <div className="flex flex-wrap gap-2">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    setActiveProjectId(proj.id);
                    setSelectedVideoId("");
                  }}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                    (currentProject?.id || activeProjectId) === proj.id
                      ? "bg-[var(--primary-blue)] text-white shadow"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {proj.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Video Playlist Selector if multiple videos */}
      {projectVideos.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {projectVideos.map((v, index) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedVideoId(v.id)}
              className={`px-4 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-2 border transition-all ${
                activeVideo?.id === v.id
                  ? "border-[var(--primary-blue)] bg-blue-50/80 text-[var(--primary-blue)] shadow-sm"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
              }`}
            >
              <span>คลิปที่ {index + 1}: {v.title}</span>
              {v.is_mandatory && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  สำคัญสำหรับการสอบ
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Video Title & Status */}
      {activeVideo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <span>{activeVideo.title}</span>
            {activeVideo.is_mandatory && (
              <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-0.5 rounded-full">
                บังคับสำหรับรายวิชานี้
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {videoCompleted && (
              <span className="text-xs font-bold text-[var(--accent-green)] bg-green-50 border border-green-200 px-3 py-1 rounded-full flex items-center gap-1">
                ✓ รับชมครบแล้ว
              </span>
            )}
            {videoStarted && !videoCompleted && (
              <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full flex items-center gap-1">
                ▶ กำลังรับชม
              </span>
            )}
          </div>
        </div>
      )}

      {/* Video Player */}
      <div className="relative aspect-video overflow-hidden rounded-3xl bg-black shadow-2xl border-4 border-white/50">
        <div className="h-full w-full" id="youtube-player" />
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-5 rounded-2xl border border-white/60 shadow-sm">
        <div className="flex items-center gap-3">
          {videoCompleted && (
            <button
              type="button"
              onClick={handleRewatch}
              className="rounded-full bg-[var(--accent-green)] text-white px-6 py-2.5 text-sm font-extrabold hover:bg-emerald-700 transition-all shadow-sm flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>รับชมอีกครั้ง (Watch Again)</span>
            </button>
          )}
          {saving && (
            <span className="text-xs text-gray-400 animate-pulse">กำลังบันทึก...</span>
          )}
        </div>

        <Link
          href="/portal/exam"
          className="rounded-full border-2 border-[var(--primary-blue)] text-[var(--primary-blue)] px-6 py-2.5 text-sm font-bold hover:bg-blue-50 transition-all"
        >
          เข้าทำข้อสอบ →
        </Link>
      </div>

      {/* Status Messages */}
      {saveMessage && <p className="mt-3 text-sm text-[var(--accent-green)] font-semibold">{saveMessage}</p>}
      {saveError && <p className="mt-3 text-sm text-[var(--accent-red)] font-semibold">{saveError}</p>}
    </div>
  );
}

export default function LearnPage() {
  return (
    <AuthGuard>
      <LearnContent />
    </AuthGuard>
  );
}
