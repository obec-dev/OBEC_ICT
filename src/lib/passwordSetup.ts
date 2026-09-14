const SETUP_KEY = "ict_password_setup_verified";

/** Wipe any leftover verify cache. Never persist phone, national ID, or a verified flag. */
export function clearPasswordSetup() {
  try {
    sessionStorage.removeItem(SETUP_KEY);
    localStorage.removeItem(SETUP_KEY);
  } catch {
    /* ignore */
  }
}
