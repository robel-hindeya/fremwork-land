'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const KEY = 'fw_vid';

/** A random id that stays in this browser, so the same person is counted once. */
function browserId(): string {
  const fresh = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)));
  let id = '';
  try { id = localStorage.getItem(KEY) || ''; } catch { /* storage blocked */ }
  if (!id) id = document.cookie.match(/(?:^|; )fw_vid=([0-9a-f-]{36})/)?.[1] || '';
  if (!id) id = fresh();
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ }
  document.cookie = `${KEY}=${id}; path=/; max-age=31536000; samesite=lax`;
  return id;
}

/** Puts a name on this browser's visitor after a sign-up or event registration. */
export function identifyVisitor(email: string) {
  try {
    getSupabaseBrowserClient()
      .rpc('identify_visitor', { p_browser_id: browserId(), p_email: email })
      .then(() => undefined, () => undefined);
  } catch { /* never block the form */ }
}

/**
 * Records the visit for Admin › Visitors. The database matches the person by
 * signed-in email, then this browser id, so refreshes never add anyone.
 */
export function VisitTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path.startsWith('/admin') || path.startsWith('/auth/') || path === '/open-app' || navigator.webdriver) return;
    const t = window.setTimeout(() => {
      const referrer = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : null;
      const cookie = document.cookie.match(/(?:^|; )fw_geo=([^;]*)/)?.[1];
      let geo: string[] = [];
      try { geo = cookie ? decodeURIComponent(cookie).split('|') : []; } catch { /* bad cookie */ }
      const q = new URLSearchParams(location.search);
      getSupabaseBrowserClient()
        .rpc('track_visit', {
          p_browser_id: browserId(), p_path: path, p_referrer: referrer,
          p_country: geo[0] || null, p_region: geo[1] || null, p_city: geo[2] || null,
          p_source: q.get('utm_source') || q.get('ref') || null,
        })
        .then(() => undefined, () => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [path]);
  return null;
}
