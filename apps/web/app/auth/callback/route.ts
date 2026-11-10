import type { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { loginWithError, redirectWithinSite, safeNext } from '@/lib/auth-redirect';

/**
 * Google sign-in and password-reset links land here with a PKCE `code`.
 * The code is exchanged for a session; the Supabase SSR client stores it in cookies on this response.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  // Supabase reports cancelled or failed sign-ins as error / error_description.
  const providerError = searchParams.get('error_description') || searchParams.get('error');
  if (providerError) return loginWithError(providerError);
  if (!code) return loginWithError('That sign-in link did not work. Try again.');

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Usually the link was already used, expired, or sign-in started in another browser or on another domain.
    return loginWithError('That sign-in link did not work. Start again from this site.');
  }
  return redirectWithinSite(next);
}
