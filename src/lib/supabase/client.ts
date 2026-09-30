import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Prefer browser-session cookies (cleared when the browser closes)
      cookieOptions: {
        path: "/",
        sameSite: "lax",
      },
    }
  );
}
