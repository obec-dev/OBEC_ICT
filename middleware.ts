import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_ROLE_COOKIE,
  canAccessPath,
  homePathForAccessRole,
  isProtectedPath,
  parseAccessRoleCookie,
  type AccessRole,
} from "@/lib/auth/access";

/** Force Supabase auth cookies to be browser session cookies (no Max-Age / Expires). */
function asSessionCookieOptions(options?: Record<string, unknown>) {
  const next = { ...(options || {}) } as Record<string, unknown>;
  delete next.maxAge;
  delete next.expires;
  return next;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, asSessionCookieOptions(options))
          );
        },
      },
    }
  );

  // Keep Supabase auth cookie fresh when used
  await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Auth completion pages stay public
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/admin/login") ||
    pathname === "/" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/")
  ) {
    return supabaseResponse;
  }

  if (!isProtectedPath(pathname)) {
    return supabaseResponse;
  }

  const roleCookie = request.cookies.get(ACCESS_ROLE_COOKIE)?.value;
  const role: AccessRole = parseAccessRoleCookie(roleCookie);

  // Cookie present but path not allowed for this role → role home (or landing)
  if (role !== "guest" && !canAccessPath(role, pathname)) {
    const dest = homePathForAccessRole(role);
    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // No role cookie: do not serve portal/admin shells. AuthGuard still
  // checks the local session; data access stays on RPC checks.
  if (role === "guest") {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/admin") ? "/admin/login" : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
