'use client';

import Link from 'next/link';
import { FramSvg, type FramFace } from '@/components/fram/FramSvg';
import '@/styles/login.css';
import { useEffect, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Provider } from '@supabase/supabase-js';
import { useFram } from '@/components/fram/useFram';
import { useMergeState } from '@/components/fram/useMergeState';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EMAIL_RE } from '@/lib/format';

const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
const nextParam = () => {
  const n = new URLSearchParams(window.location.search).get('next');
  return n && ['/open-app', '/admin', '/set-password'].includes(n) ? n : null;
};

/** Log in · ported from Login.dc.html, backed by Supabase Auth. */
export function LoginScreen() {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [s, set, get] = useMergeState({
    email: '', password: '', peek: false, emailErr: '', passErr: '', notice: '', loading: false, done: false,
  });

  // Already signed in? Show the "You are in." state, as the design does after logging in.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) set({ done: true, email: data.user.email ?? '' });
    });
    const err = new URLSearchParams(window.location.search).get('error');
    if (err) set({ notice: err });
  }, [supabase, set]);

  const fram = useFram(s.done ? 'grin' : s.emailErr || s.passErr ? 'o' : '');

  const onSubmit = async (e?: FormEvent | MouseEvent) => {
    e?.preventDefault();
    const st = get();
    if (st.loading) return;
    const em = st.email.trim();
    const pw = st.password;
    const emailErr = !em ? 'Enter your email.' : EMAIL_RE.test(em) ? '' : 'Enter a valid email, like you@company.com.';
    const passErr = !pw ? 'Enter your password.' : pw.length < 8 ? 'Passwords are at least 8 characters.' : '';
    if (emailErr || passErr) return set({ emailErr, passErr, notice: '' });
    set({ loading: true, notice: '' });
    const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
    if (error) {
      return set({ loading: false, passErr: error.message === 'Invalid login credentials' ? 'That email and password do not match.' : error.message });
    }
    router.replace(nextParam() ?? '/open-app');
    router.refresh();
  };

  const onForgot = async (e: MouseEvent) => {
    e.preventDefault();
    const em = get().email.trim();
    if (!em || !EMAIL_RE.test(em)) return set({ notice: 'Enter your email above and we will send you a reset link.' });
    await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${siteUrl()}/auth/callback?next=/set-password` });
    set({ notice: `If ${em} has an account, a reset link is on its way.` });
  };

  const onSso = (provider: Provider) => async () => {
    const next = nextParam() ?? '/open-app';
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) set({ notice: `${error.message}. Use your email and password for now.` });
  };

  const onReset = async () => {
    await supabase.auth.signOut();
    set({ done: false, password: '', peek: false, notice: '' });
    router.refresh();
  };

  // Template bindings for the ported markup (values mirror the design file's renderVals).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: Record<string, any> = {
    ...fram,
    email: s.email, password: s.password,
    emailErr: s.emailErr, passErr: s.passErr,
    emailInvalid: s.emailErr ? 'true' : 'false', passInvalid: s.passErr ? 'true' : 'false',
    emailBorder: s.emailErr ? '#B42318' : '#E2E2DF', passBorder: s.passErr ? '#B42318' : '#E2E2DF',
    passType: s.peek ? 'text' : 'password',
    peekLabel: s.peek ? 'Hide password' : 'Show password', peekPressed: s.peek ? 'true' : 'false',
    peekSlash: s.peek ? 'M0 0' : 'M4 4 L20 20',
    loading: s.loading, submitLabel: s.loading ? 'Logging in…' : 'Log in',
    notice: s.notice,
    showForm: !s.done, done: s.done,
    onEmail: (e: ChangeEvent<HTMLInputElement>) => set({ email: e.target.value, emailErr: '', notice: '' }),
    onPass: (e: ChangeEvent<HTMLInputElement>) => set({ password: e.target.value, passErr: '', notice: '' }),
    onPeek: () => set({ peek: !get().peek }),
    onForgot, onSso, onSubmit, onReset,
  };

  return (
      <div className="pg-login">
      <div className="auth-wrap" onMouseMove={v.onMove} onMouseEnter={v.onEnter} onMouseLeave={v.onLeave} style={{ minHeight: "100vh", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(16px, 4vw, 48px)", fontFamily: "'Geist', system-ui, sans-serif", color: "#0A0A0A", background: "#E9E9E6" }}>
      <div className="auth-card" style={{ width: "100%", maxWidth: "1040px", minHeight: "620px", display: "flex", background: "#FFFFFF", borderRadius: "22px", padding: "10px", boxSizing: "border-box", boxShadow: "0 1px 2px rgba(10,10,10,0.04), 0 24px 60px rgba(10,10,10,0.08)" }}>
      {/* Left visual panel */}
      <div className="lside" style={{ position: "relative", flex: "0 0 46%", borderRadius: "16px", overflow: "hidden", background: "#F1F1EC", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "28px 30px 34px", boxSizing: "border-box" }}>
      <div aria-hidden="true" className="glow" style={{ position: "absolute", left: "-20%", top: "18%", width: "130%", height: "80%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.85), rgba(198,244,50,0.35) 55%, rgba(198,244,50,0) 100%)", filter: "blur(30px)" }}></div>
      <div aria-hidden="true" style={{ position: "absolute", right: "-25%", top: "-20%", width: "80%", height: "60%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.9), rgba(255,255,255,0))", filter: "blur(20px)" }}></div>
      <Link href="/" style={{ position: "relative", zIndex: "1", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", fontSize: "19px", letterSpacing: "-0.03em", textDecoration: "none", color: "#0A0A0A" }}><span aria-hidden="true" style={{ width: "14px", height: "14px", background: "#C6F432", boxShadow: "inset 0 0 0 2px #0A0A0A" }}></span>Fremwork</Link>
      <div style={{ position: "relative", zIndex: "1", width: "62%", alignSelf: "center", margin: "24px 0" }}>
      <FramSvg f={v as FramFace} label="Fram, the Fremwork character, waving hello" className="fram-svg" svgRef={v.setFram} onMouseDown={v.onPoke} style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }} />
      </div>
      <div style={{ position: "relative", zIndex: "1" }}>
      <p style={{ margin: "0", fontSize: "14px", color: "#3A3A38" }}>With Fremwork you can</p>
      <p style={{ margin: "10px 0 0", fontSize: "clamp(22px, 2.4vw, 28px)", lineHeight: "1.22", letterSpacing: "-0.02em", fontWeight: "500" }}>Ask your finance team anything, and leave with a clear next step.</p>
      </div>
      </div>
      {/* Right form panel */}
      <div className="auth-form" style={{ flex: "1 1 0", minWidth: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(28px, 5vw, 64px) clamp(20px, 5vw, 72px)" }}>
      <Link href="/" className="mob-brand" style={{ display: "none", alignSelf: "flex-start", alignItems: "center", gap: "8px", marginBottom: "28px", fontWeight: "600", fontSize: "19px", letterSpacing: "-0.03em", textDecoration: "none", color: "#0A0A0A" }}><span aria-hidden="true" style={{ width: "14px", height: "14px", background: "#C6F432", boxShadow: "inset 0 0 0 2px #0A0A0A" }}></span>Fremwork</Link>
      <div style={{ width: "100%", maxWidth: "360px" }}>
      {v.showForm ? (<>
      <div className="fade" style={{ display: "flex", flexDirection: "column" }}>
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><g stroke="#C6F432" strokeWidth="4.5" strokeLinecap="round"><path d="M15 3 V27"></path><path d="M4.6 9 L25.4 21"></path><path d="M4.6 21 L25.4 9"></path></g></svg>
      <h1 style={{ margin: "18px 0 0", fontSize: "30px", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "600" }}>Welcome back</h1>
      <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: "22px", color: "#8C8C8C" }}>Log in to ask your numbers anything, from cash and margin to overdue invoices, in one place.</p>
      <form onSubmit={v.onSubmit} noValidate style={{ marginTop: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
      <label htmlFor="login-email" style={{ fontSize: "13px", fontWeight: "500" }}>Your email</label>
      <div className="field" style={{ background: "#FFFFFF", border: `1px solid ${v.emailBorder}`, borderRadius: "6px" }}>
      <input id="login-email" type="email" autoComplete="email" placeholder="you@company.com" value={v.email} onChange={v.onEmail} aria-invalid={v.emailInvalid} style={{ width: "100%", boxSizing: "border-box", border: "0", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "15px", color: "#0A0A0A", padding: "12px 14px" }} />
      </div>
      {v.emailErr ? (<><span style={{ fontSize: "12px", color: "#B42318" }}>{v.emailErr}</span></>) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><label htmlFor="login-pass" style={{ fontSize: "13px", fontWeight: "500" }}>Password</label><a href="#forgot" className="lnk" onClick={v.onForgot} style={{ fontSize: "12px", color: "#5E5E5E" }}>Forgot?</a></div>
      <div className="field" style={{ display: "flex", alignItems: "center", background: "#FFFFFF", border: `1px solid ${v.passBorder}`, borderRadius: "6px", paddingRight: "4px" }}>
      <input id="login-pass" type={v.passType} autoComplete="current-password" placeholder="Your password" value={v.password} onChange={v.onPass} aria-invalid={v.passInvalid} style={{ width: "100%", boxSizing: "border-box", border: "0", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "15px", color: "#0A0A0A", padding: "12px 14px" }} />
      <button type="button" className="peek" onClick={v.onPeek} aria-label={v.peekLabel} aria-pressed={v.peekPressed} style={{ width: "34px", height: "34px", flex: "none", border: "0", borderRadius: "6px", background: "transparent", color: "#8C8C8C", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"></path><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6"></circle><path d={v.peekSlash} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"></path></svg>
      </button>
      </div>
      {v.passErr ? (<><span style={{ fontSize: "12px", color: "#B42318" }}>{v.passErr}</span></>) : null}
      </div>
      <button type="submit" className="btn-dark" style={{ marginTop: "10px", width: "100%", minHeight: "46px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontFamily: "inherit", fontSize: "15px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", border: "0", borderRadius: "6px", padding: "12px 20px", cursor: "pointer", transition: "background .2s", boxShadow: "0 10px 24px rgba(10,10,10,0.22), inset 0 1px 0 rgba(255,255,255,0.12)" }}>
      {v.loading ? (<><span className="spin" aria-hidden="true" style={{ width: "15px", height: "15px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#FFFFFF" }}></span></>) : null}
      {v.submitLabel}
      </button>
      </form>
      <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: "12px", margin: "26px 0 16px", fontSize: "12px", color: "#A3A3A0" }}><span style={{ flex: "1", height: "1px", background: "#EDEDED" }}></span>or<span style={{ flex: "1", height: "1px", background: "#EDEDED" }}></span></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "10px" }}>
      <button type="button" className="sso" onClick={v.onSso('google')} style={{ fontFamily: "inherit", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: "6px", padding: "11px 6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}><svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: "none" }}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z"></path><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.6 10.8l7.9-6.2z"></path><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6.3 0-11.6-4.2-13.5-10l-7.9 6.2C6.5 42.6 14.6 48 24 48z"></path></svg>Continue with Google</button>
      </div>
      {v.notice ? (<>
      <p className="fade" role="status" style={{ margin: "16px 0 0", fontSize: "13px", lineHeight: "20px", color: "#5E5E5E", background: "#F4F4F2", borderRadius: "6px", padding: "10px 12px" }}>{v.notice}</p>
      </>) : null}
      <p style={{ margin: "26px 0 0", textAlign: "center", fontSize: "13px", color: "#8C8C8C" }}>Don’t have an account? <Link href="/signup" className="accent-lnk">Sign up</Link></p>
      </div>
      </>) : null}
      {v.done ? (<>
      <div className="fade" role="status" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><g stroke="#C6F432" strokeWidth="4.5" strokeLinecap="round"><path d="M15 3 V27"></path><path d="M4.6 9 L25.4 21"></path><path d="M4.6 21 L25.4 9"></path></g></svg>
      <h1 style={{ margin: "18px 0 0", fontSize: "30px", lineHeight: "1.15", letterSpacing: "-0.03em", fontWeight: "600" }}>You are in.</h1>
      <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: "22px", color: "#8C8C8C" }}>Signed in as <strong style={{ color: "#0A0A0A", fontWeight: "600" }}>{v.email}</strong>. Your assistants are ready when you are.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "26px" }}>
      <Link href="/open-app" className="btn-dark" style={{ textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", borderRadius: "6px", padding: "12px 20px" }}>Open Fremwork AI</Link>
      <Link href="/admin" className="sso" style={{ textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: "6px", padding: "11px 20px" }}>Open admin</Link>
      <Link href="/" className="sso" style={{ textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: "6px", padding: "11px 20px" }}>Back to home</Link>
      <Link href="/set-password" className="sso" style={{ textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: "6px", padding: "11px 20px" }}>Change password</Link>
      <button type="button" className="sso" onClick={v.onReset} style={{ fontFamily: "inherit", fontSize: "14px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #EDEDED", borderRadius: "6px", padding: "11px 20px", cursor: "pointer" }}>Log out</button>
      </div>
      </div>
      </>) : null}
      </div>
      </div>
      </div>
      </div>
      </div>
  );
}
