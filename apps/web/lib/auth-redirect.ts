import { NextResponse } from 'next/server';

/** Pages a sign-in link may continue to. Anything else falls back to the workspace handoff. */
const AFTER_SIGN_IN = ['/open-app', '/admin', '/set-password'];

export const safeNext = (value: string | null) => (value && AFTER_SIGN_IN.includes(value) ? value : '/open-app');

/**
 * Redirect within this site using a relative Location. Behind a proxy (Render, Cloudflare)
 * `request.url` is the internal address, e.g. https://localhost:10000, so an absolute URL built
 * from it sends people to localhost. The browser resolves a relative Location against the public
 * address it actually requested. Auth cookies set through next/headers are still attached.
 */
export function redirectWithinSite(pathAndQuery: string) {
  return new NextResponse(null, { status: 303, headers: { Location: pathAndQuery, 'Cache-Control': 'no-store' } });
}

export const loginWithError = (message: string) => redirectWithinSite(`/login?error=${encodeURIComponent(message)}`);
