import type { IctPersistedState, SessionUser } from "@/types/ict";
import { syncAccessRoleCookie } from "@/lib/auth/access";
import {
  AUTH_SESSION_KEY,
  clearLegacyPersistentAuth,
  touchSessionActivity,
} from "@/lib/auth/sessionLifecycle";

export const STORAGE_KEYS = {
  state: "ict_platform_state",
  session: AUTH_SESSION_KEY,
  consent: "ict_register_consent",
} as const;

export function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function readPersistedState(): IctPersistedState | null {
  return readJson<IctPersistedState>(STORAGE_KEYS.state);
}

export function writePersistedState(state: IctPersistedState) {
  writeJson(STORAGE_KEYS.state, { ...state, examProgress: [] });
}

/** Drop saved exam answers from local cache. Answers must come from the database, not the browser. */
export function clearStoredExamAnswers() {
  if (typeof window === "undefined") return;
  const state = readPersistedState();
  if (!state?.examProgress?.length) return;
  writePersistedState({ ...state, examProgress: [] });
}

/**
 * Auth session is sessionStorage-only so closing the tab/window ends the login.
 * Any legacy localStorage session is discarded (force re-login).
 */
export function readSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  clearLegacyPersistentAuth();
  return readSessionJson<SessionUser>(STORAGE_KEYS.session);
}

export function writeSession(session: SessionUser | null) {
  if (typeof window === "undefined") return;
  clearLegacyPersistentAuth();
  if (!session) {
    try {
      sessionStorage.removeItem(STORAGE_KEYS.session);
      sessionStorage.removeItem("ict_session_activity");
    } catch {
      /* ignore */
    }
    syncAccessRoleCookie(null);
    return;
  }
  writeSessionJson(STORAGE_KEYS.session, session);
  syncAccessRoleCookie(session);
  touchSessionActivity();
}
