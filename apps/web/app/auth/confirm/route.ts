import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { loginWithError, redirectWithinSite, safeNext } from '@/lib/auth-redirect';

/**
 * Email links that carry a `token_hash` (invites, sign-up confirmation, recovery).
 * The email templates in supabase/templates point here.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(searchParams.get('next'));

  if (tokenHash && type) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return redirectWithinSite(next);
  }
  return loginWithError('That link has expired. Ask for a new one.');
}
