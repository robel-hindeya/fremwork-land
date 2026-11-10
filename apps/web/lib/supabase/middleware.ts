import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

/** Paths that need a signed-in user. Everything else is public. */
const PROTECTED = ['/admin', '/set-password'];

export async function updateSession(request: NextRequest) {
  // When a return URL is not in Supabase's Redirect URLs list, Supabase sends the visitor to the
  // Site URL root with ?code= (or ?error=). Finish the sign-in instead of showing the homepage.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === '/' && request.method === 'GET' && (searchParams.has('code') || searchParams.has('error_description'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    if (!url.searchParams.has('next')) url.searchParams.set('next', '/open-app');
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Refreshes the auth token. Do not put code between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + '/'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  if (user && (path === '/admin' || path.startsWith('/admin/'))) {
    const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (error || !profile || !['owner', 'admin'].includes(profile.role)) {
      const redirected = NextResponse.redirect(new URL('/open-app', request.url));
      response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
      return redirected;
    }
  }

  // City and region from Vercel's IP lookup, for Admin › Visitors (country is taken server-side).
  const geo = ['country', 'country-region', 'city'].map((k) => request.headers.get(`x-vercel-ip-${k}`) || '');
  if (geo.some(Boolean)) {
    response.cookies.set('fw_geo', geo.map((g) => { try { return decodeURIComponent(g); } catch { return g; } }).join('|'),
      { path: '/', sameSite: 'lax', maxAge: 3600 });
  }

  return response;
}
