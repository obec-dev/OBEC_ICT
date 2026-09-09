"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * Admin JWT/token sessions are separate; inactivity still clears the client session.
 */
export function SessionTimeoutGuard() {
  const { session, hydrated, logout } = useIctStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(() => {
    clearTimer();
    if (!session) return;
    timerRef.current = setTimeout(() => {
      logout();
    }, INACTIVITY_MS);
  }, [clearTimer, logout, session]);

  useEffect(() => {
    if (!hydrated || !session) {
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
  }, [armTimer, clearTimer, hydrated, session]);

  return null;
}
