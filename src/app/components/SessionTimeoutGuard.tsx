"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIctStore } from "@/contexts/IctStore";
import {
  loginPathForSession,
  SESSION_ACTIVITY_EVENT,
  touchSessionActivity,
} from "@/lib/auth/sessionLifecycle";

/** Auto-logout after this many ms of no user interaction. */
const INACTIVITY_MS = 5 * 60 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
const WARN_AT_MS = INACTIVITY_MS - WARN_BEFORE_MS;

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
];

/**
 * Warns 1 minute before idle logout, then ends sessions after 5 minutes of inactivity.
 * Continue resets the idle timer; Logout now ends the session immediately.
 */
export function SessionTimeoutGuard() {
  const { session, hydrated, logout } = useIctStore();
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<"none" | "warn" | "expired">("none");
  const expiredSessionRef = useRef(session);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const forceLogout = useCallback(() => {
    expiredSessionRef.current = session;
    logout({ redirect: false, reason: "inactive" });
    setPhase("expired");
  }, [logout, session]);

  const armTimers = useCallback(() => {
    clearTimers();
    if (!session || phase !== "none") return;

    warnTimerRef.current = setTimeout(() => {
      setPhase("warn");
    }, WARN_AT_MS);

    logoutTimerRef.current = setTimeout(() => {
      forceLogout();
    }, INACTIVITY_MS);
  }, [clearTimers, forceLogout, phase, session]);

  useEffect(() => {
    if (!hydrated || !session || phase !== "none") {
      clearTimers();
      return;
    }

    armTimers();
    const onDomActivity = () => {
      touchSessionActivity();
      armTimers();
    };
    const onExternalActivity = () => armTimers();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onDomActivity, { passive: true });
    }
    window.addEventListener(SESSION_ACTIVITY_EVENT, onExternalActivity);

    return () => {
      clearTimers();
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onDomActivity);
      }
      window.removeEventListener(SESSION_ACTIVITY_EVENT, onExternalActivity);
    };
  }, [armTimers, clearTimers, hydrated, session, phase]);

  // While warn is open, still hard-logout at the original 5-minute mark.
  useEffect(() => {
    if (phase !== "warn" || !session) return;
    clearTimers();
    logoutTimerRef.current = setTimeout(() => {
      forceLogout();
    }, WARN_BEFORE_MS);
    return () => clearTimers();
  }, [phase, session, clearTimers, forceLogout]);

  const handleContinue = () => {
    touchSessionActivity();
    setPhase("none");
  };

  const handleLogoutNow = () => {
    forceLogout();
  };

  const handleExpiredOk = () => {
    setPhase("none");
    const path = loginPathForSession(expiredSessionRef.current);
    window.location.href = `${path}?reason=expired`;
  };

  if (phase === "none") return null;

  if (phase === "warn") {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-warn-title"
      >
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-700 p-6 shadow-xl">
          <h2
            id="session-warn-title"
            className="text-lg font-bold text-[var(--primary-blue)] dark:text-white mb-3"
          >
            เซสชันใกล้หมดเวลา
          </h2>
          <p className="text-sm text-gray-700 dark:text-white leading-relaxed mb-6">
            ท่านไม่ได้ดำเนินการใดๆ ใกล้ครบ 5 นาทีแล้ว ต้องการใช้งานต่อหรือออกจากระบบตอนนี้?
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handleContinue}
              className="flex-1 rounded-full bg-[var(--primary-blue)] text-white py-3 font-bold hover:opacity-90"
            >
              ใช้งานต่อ
            </button>
            <button
              type="button"
              onClick={handleLogoutNow}
              className="flex-1 rounded-full border border-gray-300 dark:border-slate-600 py-3 font-bold text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800"
            >
              ออกจากระบบตอนนี้
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          onClick={handleExpiredOk}
          className="w-full rounded-full bg-[var(--primary-blue)] text-white py-3 font-bold hover:opacity-90"
        >
          OK
        </button>
      </div>
    </div>
  );
}
