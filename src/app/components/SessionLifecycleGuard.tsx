"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIctStore } from "@/contexts/IctStore";
import {
  clearClientAuthState,
  clearLegacyPersistentAuth,
  isSessionIdleExpired,
  loginPathForSession,
  loginUrlWithReason,
  touchSessionActivity,
} from "@/lib/auth/sessionLifecycle";
import { readSession } from "@/lib/storage";

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "visibilitychange",
];

/**
 * - Session cookies + sessionStorage end auth when the tab/browser closes.
 * - On mount / visibility: if idle past the limit, hard sign-out → login with message.
 * - pagehide: scrub legacy persistent auth (do not wipe sessionStorage — refresh must keep the tab session).
 */
export function SessionLifecycleGuard() {
  const { hydrated, session, logout } = useIctStore();
  const router = useRouter();
  const pathname = usePathname();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || checkedRef.current) return;
    checkedRef.current = true;

    const stored = readSession();
    if (stored && isSessionIdleExpired()) {
      const path = loginPathForSession(stored, pathname?.startsWith("/admin"));
      logout({ redirect: false });
      clearClientAuthState();
      router.replace(loginUrlWithReason(path, "expired"));
      return;
    }

    if (stored || session) {
      touchSessionActivity();
    }
  }, [hydrated, logout, pathname, router, session]);

  useEffect(() => {
    if (!hydrated || !session) return;

    const onActivity = () => {
      if (document.visibilityState === "hidden") return;
      if (isSessionIdleExpired()) {
        const path = loginPathForSession(session, pathname?.startsWith("/admin"));
        logout({ redirect: false });
        clearClientAuthState();
        router.replace(loginUrlWithReason(path, "expired"));
        return;
      }
      touchSessionActivity();
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    const onPageHide = (event: PageTransitionEvent) => {
      // Keep sessionStorage for refresh / bfcache; only drop legacy localStorage auth.
      if (event.persisted) return;
      clearLegacyPersistentAuth();
    };

    const onBeforeUnload = () => {
      clearLegacyPersistentAuth();
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [hydrated, logout, pathname, router, session]);

  return null;
}
