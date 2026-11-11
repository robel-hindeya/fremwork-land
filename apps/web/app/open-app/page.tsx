'use client';

import { useEffect, useState } from 'react';
import { workspaceUrl } from '@/lib/app-url';

/**
 * Sends the visitor to the Fremwork AI workspace's own sign-in page. Sessions are never handed
 * from this site to the workspace: a page that auto-submits tokens to another domain is what
 * phishing kits do, and Google Safe Browsing flagged the workspace for receiving them. The
 * workspace signs users in itself (password, or Google via its own /auth/callback).
 */
export default function OpenAppPage() {
  const [target, setTarget] = useState('');
  useEffect(() => {
    const url = new URL('/sign-in', workspaceUrl());
    setTarget(url.href);
    window.location.replace(url.href);
  }, []);
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: "'Geist', system-ui, sans-serif" }}>
    <p role="status">Opening Fremwork AI… {target && <a href={target}>Continue</a>}</p>
  </div>;
}
