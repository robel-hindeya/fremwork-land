'use client';

import Link from 'next/link';
import { FramSvg, type FramFace } from '@/components/fram/FramSvg';
import '@/styles/login.css';
import { useEffect, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useFram } from '@/components/fram/useFram';
import { useMergeState } from '@/components/fram/useMergeState';
import { identifyVisitor } from '@/components/VisitTracker';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EMAIL_RE } from '@/lib/format';
import { authMessage, isNetworkError, UNREACHABLE } from '@/lib/auth-errors';

// Always return to the domain the visitor is on: the PKCE verifier cookie lives there.
const siteUrl = () => window.location.origin;
const callback = () => `${siteUrl()}/auth/callback?next=/open-app`;
const EXISTS = 'An account with that email already exists. Log in instead.';

const inputStyle: CSSProperties = { width: '100%', boxSizing: 'border-box', border: '0', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: '15px', color: '#0A0A0A', padding: '12px 14px' };
const labelStyle: CSSProperties = { fontSize: '13px', fontWeight: 500 };
const fieldWrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '7px' };
const errStyle: CSSProperties = { fontSize: '12px', color: '#B42318' };
const brandStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '19px', letterSpacing: '-0.03em', textDecoration: 'none', color: '#0A0A0A' };
const brandMark = <span aria-hidden="true" style={{ width: '14px', height: '14px', background: '#C6F432', boxShadow: 'inset 0 0 0 2px #0A0A0A' }}></span>;
const asterisk = <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><g stroke="#C6F432" strokeWidth="4.5" strokeLinecap="round"><path d="M15 3 V27"></path><path d="M4.6 9 L25.4 21"></path><path d="M4.6 21 L25.4 9"></path></g></svg>;

/** Create an account · same layout as the login screen, backed by Supabase Auth. */
export function SignupScreen() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [s, set, get] = useMergeState({
    name: '', company: '', email: '', password: '', peek: false,
    nameErr: '', emailErr: '', passErr: '', notice: '', loading: false, sent: false,
  });

  // Already signed in? Go straight to the app.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/open-app');
    });
  }, [supabase, router]);

  const fram = useFram(s.sent ? 'grin' : s.nameErr || s.emailErr || s.passErr ? 'o' : '');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const st = get();
    if (st.loading) return;
    const name = st.name.trim();
    const company = st.company.trim();
    const em = st.email.trim();
    const pw = st.password;
    const nameErr = name ? '' : 'Enter your name.';
    const emailErr = !em ? 'Enter your email.' : EMAIL_RE.test(em) ? '' : 'Enter a valid email, like you@company.com.';
    const passErr = !pw ? 'Choose a password.' : pw.length < 8 ? 'Passwords are at least 8 characters.' : '';
    if (nameErr || emailErr || passErr) return set({ nameErr, emailErr, passErr, notice: '' });

    set({ loading: true, notice: '' });
    const { data, error } = await supabase.auth.signUp({
      email: em,
      password: pw,
      options: { data: { name, company }, emailRedirectTo: callback() },
    });
    if (error) {
      const taken = error.code === 'user_already_exists';
      const limited = error.status === 429;
      return set({ loading: false, notice: taken ? EXISTS : limited ? 'Too many sign-ups right now. Wait a while and try again.' : authMessage(error) });
    }
    // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
    if (!data.session && data.user?.identities?.length === 0) return set({ loading: false, notice: EXISTS });

    identifyVisitor(em);
    if (data.session) return router.replace('/open-app');
    set({ loading: false, sent: true });
  };

  const onGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback() } });
    if (error) set({ notice: isNetworkError(error) ? UNREACHABLE : `${authMessage(error)}. Use your email and a password for now.` });
  };

  const field = (borderErr: string) => ({ background: '#FFFFFF', border: `1px solid ${borderErr ? '#B42318' : '#E2E2DF'}`, borderRadius: '6px' });

  return (
    <div className="pg-login">
      <div className="auth-wrap" onMouseMove={fram.onMove} onMouseEnter={fram.onEnter} onMouseLeave={fram.onLeave} style={{ minHeight: '100vh', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px, 4vw, 48px)', fontFamily: "'Geist', system-ui, sans-serif", color: '#0A0A0A', background: '#E9E9E6' }}>
        <div className="auth-card" style={{ width: '100%', maxWidth: '1040px', minHeight: '620px', display: 'flex', background: '#FFFFFF', borderRadius: '22px', padding: '10px', boxSizing: 'border-box', boxShadow: '0 1px 2px rgba(10,10,10,0.04), 0 24px 60px rgba(10,10,10,0.08)' }}>
          <div className="lside" style={{ position: 'relative', flex: '0 0 46%', borderRadius: '16px', overflow: 'hidden', background: '#F1F1EC', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '28px 30px 34px', boxSizing: 'border-box' }}>
            <div aria-hidden="true" className="glow" style={{ position: 'absolute', left: '-20%', top: '18%', width: '130%', height: '80%', borderRadius: '50%', background: 'radial-gradient(closest-side, rgba(198,244,50,0.85), rgba(198,244,50,0.35) 55%, rgba(198,244,50,0) 100%)', filter: 'blur(30px)' }}></div>
            <Link href="/" style={{ ...brandStyle, position: 'relative', zIndex: 1, alignSelf: 'flex-start' }}>{brandMark}Fremwork</Link>
            <div style={{ position: 'relative', zIndex: 1, width: '62%', alignSelf: 'center', margin: '24px 0' }}>
              <FramSvg f={fram as unknown as FramFace} label="Fram, the Fremwork character, waving hello" className="fram-svg" svgRef={fram.setFram} onMouseDown={fram.onPoke} style={{ display: 'block', width: '100%', height: 'auto', overflow: 'visible' }} />
            </div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#3A3A38' }}>With Fremwork you can</p>
              <p style={{ margin: '10px 0 0', fontSize: 'clamp(22px, 2.4vw, 28px)', lineHeight: 1.22, letterSpacing: '-0.02em', fontWeight: 500 }}>Ask your finance team anything, and leave with a clear next step.</p>
            </div>
          </div>
          <div className="auth-form" style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'clamp(28px, 5vw, 64px) clamp(20px, 5vw, 72px)' }}>
            <Link href="/" className="mob-brand" style={{ ...brandStyle, display: 'none', alignSelf: 'flex-start', marginBottom: '28px' }}>{brandMark}Fremwork</Link>
            <div style={{ width: '100%', maxWidth: '360px' }}>
              {s.sent ? (
                <div className="fade" role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  {asterisk}
                  <h1 style={{ margin: '18px 0 0', fontSize: '30px', lineHeight: 1.15, letterSpacing: '-0.03em', fontWeight: 600 }}>Check your email</h1>
                  <p style={{ margin: '10px 0 0', fontSize: '14px', lineHeight: '22px', color: '#8C8C8C' }}>We sent a confirmation link to <strong style={{ color: '#0A0A0A', fontWeight: 600 }}>{s.email.trim()}</strong>. Open it in this browser and you will go straight to Fremwork AI.</p>
                  <Link href="/login" className="sso" style={{ marginTop: '26px', textDecoration: 'none', fontSize: '14px', fontWeight: 500, color: '#0A0A0A', background: '#FAFAF8', border: '1px solid #EDEDED', borderRadius: '6px', padding: '11px 20px' }}>Back to log in</Link>
                </div>
              ) : (
                <div className="fade" style={{ display: 'flex', flexDirection: 'column' }}>
                  {asterisk}
                  <h1 style={{ margin: '18px 0 0', fontSize: '30px', lineHeight: 1.15, letterSpacing: '-0.03em', fontWeight: 600 }}>Create your account</h1>
                  <p style={{ margin: '10px 0 0', fontSize: '14px', lineHeight: '22px', color: '#8C8C8C' }}>Ask your numbers anything, from cash and margin to overdue invoices, in one place.</p>
                  <form onSubmit={onSubmit} noValidate style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={fieldWrap}>
                      <label htmlFor="su-name" style={labelStyle}>Your name</label>
                      <div className="field" style={field(s.nameErr)}><input id="su-name" autoComplete="name" placeholder="Your name" value={s.name} onChange={(e: ChangeEvent<HTMLInputElement>) => set({ name: e.target.value, nameErr: '', notice: '' })} aria-invalid={!!s.nameErr} style={inputStyle} /></div>
                      {s.nameErr ? <span style={errStyle}>{s.nameErr}</span> : null}
                    </div>
                    <div style={fieldWrap}>
                      <label htmlFor="su-company" style={labelStyle}>Company <span style={{ color: '#8C8C8C', fontWeight: 400 }}>(optional)</span></label>
                      <div className="field" style={field('')}><input id="su-company" autoComplete="organization" placeholder="Your company" value={s.company} onChange={(e: ChangeEvent<HTMLInputElement>) => set({ company: e.target.value })} style={inputStyle} /></div>
                    </div>
                    <div style={fieldWrap}>
                      <label htmlFor="su-email" style={labelStyle}>Your email</label>
                      <div className="field" style={field(s.emailErr)}><input id="su-email" type="email" autoComplete="email" placeholder="you@company.com" value={s.email} onChange={(e: ChangeEvent<HTMLInputElement>) => set({ email: e.target.value, emailErr: '', notice: '' })} aria-invalid={!!s.emailErr} style={inputStyle} /></div>
                      {s.emailErr ? <span style={errStyle}>{s.emailErr}</span> : null}
                    </div>
                    <div style={fieldWrap}>
                      <label htmlFor="su-pass" style={labelStyle}>Password</label>
                      <div className="field" style={{ ...field(s.passErr), display: 'flex', alignItems: 'center', paddingRight: '4px' }}>
                        <input id="su-pass" type={s.peek ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={s.password} onChange={(e: ChangeEvent<HTMLInputElement>) => set({ password: e.target.value, passErr: '', notice: '' })} aria-invalid={!!s.passErr} style={inputStyle} />
                        <button type="button" className="peek" onClick={() => set({ peek: !get().peek })} aria-label={s.peek ? 'Hide password' : 'Show password'} aria-pressed={s.peek} style={{ width: '34px', height: '34px', flex: 'none', border: 0, borderRadius: '6px', background: 'transparent', color: '#8C8C8C', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"></path><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6"></circle><path d={s.peek ? 'M0 0' : 'M4 4 L20 20'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"></path></svg>
                        </button>
                      </div>
                      {s.passErr ? <span style={errStyle}>{s.passErr}</span> : null}
                    </div>
                    <button type="submit" className="btn-dark" style={{ marginTop: '8px', width: '100%', minHeight: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontFamily: 'inherit', fontSize: '15px', fontWeight: 500, color: '#FFFFFF', background: '#0A0A0A', border: 0, borderRadius: '6px', padding: '12px 20px', cursor: 'pointer', transition: 'background .2s', boxShadow: '0 10px 24px rgba(10,10,10,0.22), inset 0 1px 0 rgba(255,255,255,0.12)' }}>
                      {s.loading ? <span className="spin" aria-hidden="true" style={{ width: '15px', height: '15px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#FFFFFF' }}></span> : null}
                      {s.loading ? 'Creating your account…' : 'Sign Up'}
                    </button>
                  </form>
                  <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '22px 0 14px', fontSize: '12px', color: '#A3A3A0' }}><span style={{ flex: 1, height: '1px', background: '#EDEDED' }}></span>or<span style={{ flex: 1, height: '1px', background: '#EDEDED' }}></span></div>
                  <button type="button" className="sso" onClick={onGoogle} style={{ fontFamily: 'inherit', fontSize: '13px', fontWeight: 500, color: '#0A0A0A', background: '#FAFAF8', border: '1px solid #EDEDED', borderRadius: '6px', padding: '11px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: 'none' }}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z"></path><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"></path><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.5 42.6 14.6 48 24 48z"></path></svg>Continue with Google</button>
                  {s.notice ? <p className="fade" role="status" style={{ margin: '16px 0 0', fontSize: '13px', lineHeight: '20px', color: '#5E5E5E', background: '#F4F4F2', borderRadius: '6px', padding: '10px 12px' }}>{s.notice}</p> : null}
                  <p style={{ margin: '22px 0 0', textAlign: 'center', fontSize: '13px', color: '#8C8C8C' }}>Already have an account? <Link href="/login" className="accent-lnk">Log in</Link></p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
