import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const next = { ...(options || {}) } as Record<string, unknown>;
              delete next.maxAge;
              delete next.expires;
              cookieStore.set(name, value, next);
            });
          } catch {
            // ป้องกัน Error ตอนพยายามเซ็ต Cookie ผิดจังหวะ
          }
        },
      },
    }
  )
}