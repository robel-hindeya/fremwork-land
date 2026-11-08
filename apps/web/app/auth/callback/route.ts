import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/** OAuth (Google) and password-reset links land here with a PKCE `code`. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/open-app';
  const next = ['/open-app', '/admin', '/set-password'].includes(nextParam) ? nextParam : '/open-app';

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  const reason = searchParams.get('error_description') || 'That sign-in link did not work. Try again.';
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);
}
