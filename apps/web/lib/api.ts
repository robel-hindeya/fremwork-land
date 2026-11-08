import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { direct } from '@/lib/direct';

const CONFIGURED_API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
export const API_URL = CONFIGURED_API || 'http://localhost:4000';
/** No API address in production: talk to Supabase directly. Locally, try the dev API first. */
const API_DISABLED = !CONFIGURED_API && typeof window !== 'undefined' && window.location.hostname !== 'localhost';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; auth?: boolean; fallback?: boolean };

/**
 * Calls the NestJS API. With `auth: true` the current Supabase access token is sent
 * as a Bearer token; the API verifies it with Supabase before doing anything.
 */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = (opts.method || 'GET').toUpperCase();
  if (API_DISABLED && opts.fallback === false) throw new ApiError(503, 'Email sending needs the website API. Configure NEXT_PUBLIC_API_URL and the email service.');
  if (API_DISABLED) return direct<T>(method, path, opts.body);
  try {
    return await viaApi<T>(path, opts);
  } catch (err) {
    // API down, unreachable or misconfigured: serve the same request from Supabase.
    if (opts.fallback !== false && err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
      console.warn(`Fremwork API failed (${err.status}) for ${method} ${path}; using Supabase directly.`);
      return direct<T>(method, path, opts.body);
    }
    throw err;
  }
}

async function viaApi<T>(path: string, { body, auth, fallback: _fallback, headers, ...init }: Options = {}): Promise<T> {
  const h = new Headers(headers);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  if (auth) {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (token) h.set('Authorization', `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network error: the API is down, the URL is wrong, or CORS blocked the request.
    console.error(`Fremwork API not reachable at ${API_URL}. Check NEXT_PUBLIC_API_URL and the API's WEB_URL.`);
    throw new ApiError(0, 'We could not reach Fremwork right now. Try again in a minute.');
  }
  if (!res.ok) {
    let message = 'Something went wrong. Try again.';
    try {
      const j = await res.json();
      message = Array.isArray(j.message) ? j.message[0] : j.message || message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  const type = res.headers.get('content-type') || '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

/** Downloads a file from an authenticated API endpoint. */
export async function downloadFromApi(path: string, filename: string) {
  const csv = await api<string>(path, { auth: true });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Shared shapes returned by the API ----

export type EventType = 'WEBINAR' | 'WORKSHOP' | 'MEETUP' | 'OFFICE HOURS';

export interface PublicEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  length: string;
  whenLabel: string | null;
  startsAt: string | null;
  location: string;
  capacity: number;
}

export interface PublicSettings {
  acceptSignups: boolean;
  askCompany: boolean;
  requiredFields: Record<string, boolean>;
}

export interface Registration {
  id: number;
  eventId: string;
  cancelToken: string;
  answers: Record<string, string>;
}
