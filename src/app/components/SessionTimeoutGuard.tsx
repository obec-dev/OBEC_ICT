"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import { loginPathForSession } from "@/lib/auth/sessionLifecycle";

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
 * Ends sessions after 5 minutes of inactivity.
 * Shows a Thai security notice; OK redirects to the matching login page.
 */
export function SessionTimeoutGuard() {
  const { session, hydrated, logout } = useIctStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showModal, setShowModal] = useState(false);
  const expiredSessionRef = useRef(session);

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
      expiredSessionRef.current = session;
      logout({ redirect: false, reason: "inactive" });
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
    const path = loginPathForSession(expiredSessionRef.current);
    window.location.href = `${path}?reason=expired`;
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
