'use client';

import { useEffect, useRef } from 'react';
import { APP_URL } from '@/lib/app-url';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Hands the signed-in session to Fremwork AI. The app is on another domain, so cookies can't be
 * shared: the tokens go in the URL hash (never sent to a server) to the app's /auth/callback.
 *
 * Supabase rotates refresh tokens and revokes the session if an old one is reused, so only one
 * site may hold it. This site forgets its copy locally. signOut() would end the session for both.
 */
export default function OpenAppPage() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    getSupabaseBrowserClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) return window.location.replace('/login');

      const expiresIn = session.expires_at ? session.expires_at - Math.floor(Date.now() / 1000) : session.expires_in;
      const hash = new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: String(expiresIn),
      });

      document.cookie.split('; ').map((c) => c.split('=')[0]).filter((name) => name.startsWith('sb-'))
        .forEach((name) => { document.cookie = `${name}=; Max-Age=0; path=/`; });

      window.location.replace(`${APP_URL}/auth/callback#${hash}`);
    });
  }, []);

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: "'Geist', system-ui, sans-serif", color: '#5E5E5E', fontSize: '14px' }}>
      <p role="status">Opening Fremwork AI…</p>
    </div>
  );
}
