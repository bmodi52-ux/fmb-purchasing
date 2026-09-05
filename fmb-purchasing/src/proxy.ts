import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (export `proxy`, not
// `middleware`). This refreshes the Supabase session cookie on every
// navigation so server components always see a valid session.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // `getClaims()` rather than `getUser()`: it still refreshes an expired
  // session (it reads through `getSession()`, which renews and re-sets the
  // cookies), but once the Supabase project is on asymmetric JWT signing keys
  // it verifies the token's signature locally against a cached JWKS instead of
  // spending a network round trip to the Auth server on every navigation.
  // On a project still using the legacy symmetric secret it falls back to
  // `getUser()` internally, so this is safe either way — just not yet faster.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
