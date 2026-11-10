'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { authMessage } from '@/lib/auth-errors';
import '@/styles/login.css';

/**
 * Not in the design canvas: the page invite and password-reset links land on.
 * Built from the Log in screen's card, field and button styles.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setLoading(true);
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password: pw });
    setLoading(false);
    if (error) return setErr(authMessage(error));
    router.replace('/admin');
    router.refresh();
  };

  const field = { width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 15, color: '#0A0A0A', padding: '12px 14px' } as const;

  return (
    <div className="pg-login">
      <div className="auth-wrap" style={{ minHeight: '100vh', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 4vw, 48px)', fontFamily: "'Geist', system-ui, sans-serif", color: '#0A0A0A', background: '#E9E9E6' }}>
        <div className="auth-card" style={{ width: '100%', maxWidth: 480, display: 'flex', background: '#FFFFFF', borderRadius: 22, padding: 10, boxSizing: 'border-box', boxShadow: '0 1px 2px rgba(10,10,10,0.04), 0 24px 60px rgba(10,10,10,0.08)' }}>
          <div className="auth-form" style={{ flex: 1, padding: 'clamp(28px, 5vw, 56px)' }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28, fontWeight: 600, fontSize: 19, letterSpacing: '-0.03em', textDecoration: 'none', color: '#0A0A0A' }}>
              <span aria-hidden="true" style={{ width: 14, height: 14, background: '#C6F432', boxShadow: 'inset 0 0 0 2px #0A0A0A' }} />
              Fremwork
            </Link>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.03em', fontWeight: 600 }}>Set a new password</h1>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: '22px', color: '#8C8C8C' }}>Choose the password you will use to log in to Fremwork from now on.</p>
            <form onSubmit={onSubmit} noValidate style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="sp-1" style={{ fontSize: 13, fontWeight: 500 }}>New password</label>
                <div className="field" style={{ background: '#FFFFFF', border: '1px solid #E2E2DF', borderRadius: 6 }}>
                  <input id="sp-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} style={field} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label htmlFor="sp-2" style={{ fontSize: 13, fontWeight: 500 }}>Type it again</label>
                <div className="field" style={{ background: '#FFFFFF', border: '1px solid #E2E2DF', borderRadius: 6 }}>
                  <input id="sp-2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(''); }} style={field} />
                </div>
              </div>
              {err ? <span role="alert" style={{ fontSize: 12, color: '#B42318' }}>{err}</span> : null}
              <button type="submit" className="btn-dark" disabled={loading} style={{ marginTop: 10, width: '100%', minHeight: 46, fontFamily: 'inherit', fontSize: 15, fontWeight: 500, color: '#FFFFFF', background: '#0A0A0A', border: 0, borderRadius: 6, cursor: 'pointer' }}>
                {loading ? 'Saving…' : 'Save password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
