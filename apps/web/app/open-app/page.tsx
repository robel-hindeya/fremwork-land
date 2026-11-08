 'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SUPABASE_URL } from '@/lib/supabase/config';
import { APP_URL } from '@/lib/app-url';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/** Move the session in a POST body, never in a URL, history entry, or referrer. */
export default function OpenAppPage() {
  const started = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const supabase = getSupabaseBrowserClient();
    void (async () => {
      const target = new URL('/api/auth/session', APP_URL);
      if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) {
        throw new Error('The workspace URL is not configured securely.');
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return window.location.replace('/login');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return window.location.replace('/login');
      supabase.auth.stopAutoRefresh();
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = target.href;
      for (const [name, value] of Object.entries({ access_token: session.access_token, refresh_token: session.refresh_token })) {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      // Forget this site's copy without revoking the session being transferred.
      // Restrict deletion to this project's cookies, including SSR chunk suffixes.
      const cookiePrefix = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
      document.cookie.split('; ').map((c) => c.split('=')[0])
        .filter((name) => name === cookiePrefix || name.startsWith(cookiePrefix + '.'))
        .forEach((name) => { document.cookie = `${name}=; Max-Age=0; path=/`; });
      form.submit();
    })().catch(() => setError('We could not open your workspace. Please log in again.'));
  }, []);
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: "'Geist', system-ui, sans-serif" }}>
    {error ? <p role="alert">{error} <Link href="/login">Log in</Link></p> : <p role="status">Opening Fremwork AI…</p>}
  </div>;
}
