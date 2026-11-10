/** Message shown when Supabase Auth cannot be reached (offline, blocked, or the service is down). */
export const UNREACHABLE = 'We could not reach Fremwork right now. Check your connection and try again.';

/** True for network failures, as opposed to answers from Supabase such as "wrong password". */
export function isNetworkError(error: { name?: string; status?: number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.name === 'AuthRetryableFetchError' || error.status === 0 || /failed to fetch|network|load failed/i.test(error.message || '');
}

/** Plain-language message for a Supabase Auth error, never a raw browser network message. */
export function authMessage(error: { name?: string; status?: number; message?: string }): string {
  return isNetworkError(error) ? UNREACHABLE : error.message || 'Something went wrong. Try again.';
}
