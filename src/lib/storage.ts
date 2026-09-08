import type { IctPersistedState, SessionUser } from "@/types/ict";

export const STORAGE_KEYS = {
  state: "ict_platform_state",
  session: "ict_platform_session",
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

export function readPersistedState(): IctPersistedState | null {
  return readJson<IctPersistedState>(STORAGE_KEYS.state);
}

export function writePersistedState(state: IctPersistedState) {
  writeJson(STORAGE_KEYS.state, state);
}

export function readSession(): SessionUser | null {
  return readJson<SessionUser>(STORAGE_KEYS.session);
}

export function writeSession(session: SessionUser | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    localStorage.removeItem(STORAGE_KEYS.session);
    return;
  }
  writeJson(STORAGE_KEYS.session, session);
}
