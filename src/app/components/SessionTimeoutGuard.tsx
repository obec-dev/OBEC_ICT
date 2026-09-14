"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";

/** Auto-logout after this many ms of no user interaction. */
const INACTIVITY_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
];

/**
 * Ends candidate/admin sessions after 5 minutes of inactivity.
 * Shows a Thai security notice modal; OK redirects to landing (/).
 */
export function SessionTimeoutGuard() {
  const { session, hydrated, logout } = useIctStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showModal, setShowModal] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(() => {
    clearTimer();
    if (!session || showModal) return;
    timerRef.current = setTimeout(() => {
      logout({ redirect: false });
      setShowModal(true);
    }, INACTIVITY_MS);
  }, [clearTimer, logout, session, showModal]);

  useEffect(() => {
    if (!hydrated || !session || showModal) {
      clearTimer();
      return;
    }

    armTimer();
    const onActivity = () => armTimer();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }
    return () => {
      clearTimer();
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
    };
  }, [armTimer, clearTimer, hydrated, session, showModal]);

  const handleOk = () => {
    setShowModal(false);
    window.location.href = "/";
  };

  if (!showModal) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700 p-6 shadow-xl">
        <h2
          id="session-timeout-title"
          className="text-lg font-bold text-[var(--primary-blue)] dark:text-white mb-3"
        >
          หมดเวลาเซสชัน
        </h2>
        <p className="text-sm text-gray-700 dark:text-white leading-relaxed mb-6">
          ท่านไม่ได้ดำเนินการใดๆ เป็นเวลา 5 นาที ระบบจะทำการออกจากระบบเพื่อความปลอดภัย
        </p>
        <button
          type="button"
          onClick={handleOk}
          className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3 font-bold hover:opacity-90"
        >
          OK
        </button>
      </div>
    </div>
  );
}
