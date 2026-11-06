'use client';

import { Fragment } from 'react';
import { identifyVisitor } from '@/components/VisitTracker';
import Link from 'next/link';
import { APP_LOGIN_URL } from '@/lib/app-url';
import { FramSvg, type FramFace } from '@/components/fram/FramSvg';
import '@/styles/events.css';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useFram } from '@/components/fram/useFram';
import { useMergeState } from '@/components/fram/useMergeState';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { api, type EventType, type PublicEvent, type PublicSettings, type Registration } from '@/lib/api';
import { EMAIL_RE, formatWhen } from '@/lib/format';

// Registration questions. Two kinds: 'text' (also 'email') for typed answers, 'select' for a dropdown.
const TELEGRAM_URL = 'https://t.me/fremwork';
const TG_KEY = 'fw_tg_joined';
// Which ones are required comes from Admin › Settings (name and email always are).
const FORM_FIELDS = [
  { id: 'name', label: 'Full name', type: 'text', placeholder: 'Andrio John', auto: 'name' },
  { id: 'email', label: 'Email', type: 'email', placeholder: 'you@company.com', auto: 'email' },
  { id: 'company', label: 'Company', type: 'text', placeholder: 'Your business', auto: 'organization' },
  { id: 'role', label: 'What is your role?', type: 'select', placeholder: 'Select one', options: ['Business owner', 'Finance officer', 'Analyst', 'Accountant', 'Manager', 'Other'] },
  { id: 'size', label: 'Company size', type: 'select', placeholder: 'Select one', options: ['Just me', '2–10', '11–50', '51–200', '200+'] },
  { id: 'heard', label: 'How did you hear about this event?', type: 'select', placeholder: 'Select one', options: ['Friend or colleague', 'LinkedIn', 'X (Twitter)', 'Newsletter', 'Search', 'Other'] },
] as const;
const GLOW: Record<EventType, string> = { WEBINAR: 'rgba(198,244,50,0.8)', WORKSHOP: 'rgba(143,162,255,0.7)', MEETUP: 'rgba(245,165,36,0.6)', 'OFFICE HOURS': 'rgba(180,180,175,0.6)' };
const TAG_BG: Record<EventType, string> = { WEBINAR: '#C6F432', WORKSHOP: '#DCE3FF', MEETUP: '#FFE7C2', 'OFFICE HOURS': '#EDEDED' };
const KIND: Record<EventType, string> = { WEBINAR: 'Webinars', WORKSHOP: 'Workshops', MEETUP: 'Meetups', 'OFFICE HOURS': 'Office hours' };
const FILTERS = ['All', 'Webinars', 'Workshops', 'Meetups', 'Office hours'];
const STORE = 'fremwork.registrations';

function loadRegs(): Record<string, Registration> {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
}
function saveRegs(r: Record<string, Registration>) {
  try { localStorage.setItem(STORE, JSON.stringify(r)); } catch {}
}

/** A calendar file for events that have a real date. */
function downloadIcs(e: PublicEvent) {
  if (!e.startsAt) return false;
  const start = new Date(e.startsAt);
  const mins = parseInt(e.length, 10) || 60;
  const end = new Date(start.getTime() + mins * 60000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fremwork//Events//EN', 'BEGIN:VEVENT', `UID:${e.id}@fremwork`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${e.title}`, `LOCATION:${e.location}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'fremwork-event.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Events · ported from Events.dc.html. Events come from the API; registrations post to it. */
export function EventsScreen({ initialEvents, settings }: { initialEvents: PublicEvent[]; settings: PublicSettings | null }) {
  // Admins see Edit and Delete on each card; deleted events disappear without a reload.
  const [admin, setAdmin] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  const events = initialEvents.filter((e) => !removed.includes(e.id));
  useEffect(() => {
    getSupabaseBrowserClient().auth.getUser().then(({ data }) => {
      if (!data.user) return;
      api<{ isAdmin: boolean }>('/me', { auth: true }).then((me) => setAdmin(!!me.isAdmin)).catch(() => {});
    });
  }, []);
  const required = { ...(settings?.requiredFields || {}), name: true, email: true } as Record<string, boolean>;
  const [s, set, get] = useMergeState({
    filter: 'All', listFlip: false,
    regOpen: -1, regSuccess: false, regLoading: false, regFormErr: '', calNote: false, tgJoined: false, tgErr: false,
    fv: {} as Record<string, string>, regErr: {} as Record<string, string>,
    reg: {} as Record<string, Registration>,
  });
  const okT = useRef(0);

  useEffect(() => {
    let tgJoined = false;
    try { tgJoined = localStorage.getItem(TG_KEY) === '1'; } catch { /* storage blocked */ }
    set({ reg: loadRegs(), tgJoined });
    return () => clearTimeout(okT.current);
  }, [set]);
  useEffect(() => {
    if (s.regOpen < 0) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') set({ regOpen: -1 }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.regOpen, set]);

  const reg = s.reg;
  const fram = useFram(events[0] && reg[events[0].id] ? 'grin' : '');

  const card = (e: PublicEvent, i: number) => {
    const on = !!reg[e.id];
    return {
      id: e.id, editHref: `/admin?edit=${e.id}`,
      remove: async () => {
        if (!window.confirm(`Delete "${e.title}"? This cannot be undone. Its registrations are deleted too.`)) return;
        try {
          await api(`/admin/events/${e.id}`, { method: 'DELETE', auth: true });
          setRemoved((r) => [...r, e.id]);
        } catch (err) {
          window.alert((err as Error).message);
        }
      },
      type: e.type, title: e.title, desc: e.description, length: e.length,
      when: formatWhen(e.startsAt, e.whenLabel), where: e.location, tagBg: TAG_BG[e.type] || '#EDEDED',
      toggle: () => set({ regOpen: i, regErr: {}, regFormErr: '', calNote: false }),
      pressed: on ? 'true' : 'false', btnLabel: on ? 'You’re in ✓' : 'Register',
      btnBg: on ? '#FFFFFF' : '#0A0A0A', btnColor: on ? '#0A0A0A' : '#FFFFFF',
    };
  };

  const onRegSubmit = async (e?: FormEvent | MouseEvent) => {
    e?.preventDefault();
    const st = get();
    if (st.regLoading) return;
    const ev = events[st.regOpen];
    const errs: Record<string, string> = {};
    let bad = false;
    FORM_FIELDS.forEach((f) => {
      const val = (st.fv[f.id] || '').trim();
      if (required[f.id] && !val) { errs[f.id] = f.type === 'select' ? 'Choose an option.' : 'This field is required.'; bad = true; }
      else if (f.type === 'email' && val && !EMAIL_RE.test(val)) { errs[f.id] = 'Enter a valid email, like you@company.com.'; bad = true; }
    });
    if (bad || !st.tgJoined) {
      return set({ regErr: errs, tgErr: !st.tgJoined,
        regFormErr: bad ? 'Please fill in the required fields to register.' : 'Join our Telegram channel to finish registering.' });
    }
    set({ regLoading: true, regFormErr: '' });
    try {
      const answers: Record<string, string> = Object.fromEntries(
        FORM_FIELDS.map((f): [string, string] => [f.id, (st.fv[f.id] || '').trim()]).filter(([, val]) => val),
      );
      const r = await api<Registration>(`/events/${ev.id}/registrations`, { method: 'POST', body: answers });
      const next = { ...get().reg, [ev.id]: { ...r, answers } };
      saveRegs(next);
      if (answers.email) identifyVisitor(answers.email);
      set({ reg: next, regLoading: false, regSuccess: true });
      clearTimeout(okT.current);
      okT.current = window.setTimeout(() => set({ regSuccess: false, regOpen: -1 }), 2000);
    } catch (err) {
      set({ regLoading: false, regFormErr: (err as Error).message });
    }
  };

  const onRegCancel = async () => {
    const st = get();
    const ev = events[st.regOpen];
    const r = st.reg[ev.id];
    if (r) {
      try { await api(`/registrations/${r.id}?token=${encodeURIComponent(r.cancelToken)}`, { method: 'DELETE' }); } catch {}
    }
    const next = { ...st.reg };
    delete next[ev.id];
    saveRegs(next);
    set({ reg: next });
  };

  const list: ReturnType<typeof card>[] = [];
  events.forEach((e, i) => { if (s.filter === 'All' || KIND[e.type] === s.filter) list.push(card(e, i)); });
  const ri = s.regOpen;
  const RE = events[ri >= 0 ? ri : 0];
  const open = ri >= 0 && !!RE;
  const isReg = open && !!reg[RE.id];
  const data: Record<string, string> = (open && reg[RE.id]?.answers) || {};

  // Template bindings for the ported markup (values mirror the design file's renderVals).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: Record<string, any> = {
    ...fram,
    isAdmin: admin,
    featured: events[0]
      ? card(events[0], 0)
      : { type: 'SOON', title: 'New events are on the way', when: 'Dates coming soon', where: 'Online', toggle: () => {}, pressed: 'false', btnLabel: 'Check back soon', btnBg: '#FFFFFF', btnColor: '#0A0A0A' },
    events: list,
    empty: list.length === 0,
    listFade: s.listFlip ? 'fade' : 'fade2',
    filters: FILTERS.map((f) => {
      const on = f === s.filter;
      return { label: f, pick: () => set({ filter: f, listFlip: !get().listFlip }), pressed: on ? 'true' : 'false', bg: on ? '#0A0A0A' : '#FFFFFF', color: on ? '#FFFFFF' : '#0A0A0A', border: on ? '#0A0A0A' : '#E2E2DF' };
    }),
    regOpen: open,
    re: RE
      ? { title: RE.title, type: RE.type, when: formatWhen(RE.startsAt, RE.whenLabel), where: RE.location, length: RE.length, tagBg: TAG_BG[RE.type] || '#EDEDED', glow: GLOW[RE.type] || 'rgba(198,244,50,0.7)' }
      : { title: '', type: '', when: '', where: '', length: '', tagBg: '', glow: '' },
    regSuccess: open && s.regSuccess,
    regFormErr: s.regFormErr,
    regForm: open && !isReg && !s.regSuccess,
    regTicket: isReg && !s.regSuccess,
    regLoading: s.regLoading,
    regBtn: s.regLoading ? 'Registering…' : 'Register',
    tgUrl: TELEGRAM_URL,
    tgJoined: s.tgJoined,
    tgBorder: s.tgErr ? '#B42318' : s.tgJoined ? '#1FA971' : '#E2E2DF',
    tgErr: s.tgErr && !s.tgJoined,
    onTgJoin: () => {
      try { localStorage.setItem(TG_KEY, '1'); } catch { /* storage blocked */ }
      set({ tgJoined: true, tgErr: false, regFormErr: '' });
    },
    regFields: FORM_FIELDS.map((f) => {
      const val = s.fv[f.id] || '';
      const err = s.regErr[f.id] || '';
      return {
        domId: 'reg-' + f.id, label: f.label, reqMark: required[f.id] ? '*' : '', reqColor: '#B42318',
        isText: f.type !== 'select', isSelect: f.type === 'select', inputType: f.type === 'select' ? 'text' : f.type,
        auto: 'auto' in f ? (f.auto as string) : 'off', placeholder: f.placeholder, value: val, selColor: val ? '#0A0A0A' : '#A3A3A0',
        options: ('options' in f ? (f.options as readonly string[]) : []).map((o) => ({ v: o })),
        onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
          const st = get();
          set({ fv: { ...st.fv, [f.id]: e.target.value }, regErr: { ...st.regErr, [f.id]: '' }, regFormErr: '' });
        },
        err, invalid: err ? 'true' : 'false', border: err ? '#B42318' : '#E2E2DF',
      };
    }),
    rt: { email: data.email || '', rows: FORM_FIELDS.filter((f) => data[f.id]).map((f) => ({ k: f.label, v: data[f.id] })) },
    calNote: s.calNote,
    onRegClose: () => { clearTimeout(okT.current); set({ regOpen: -1, regSuccess: false }); },
    onRegBackdrop: (e: MouseEvent) => { if (e.target === e.currentTarget) set({ regOpen: -1 }); },
    onRegKey: (e: KeyboardEvent) => { if (e.key === 'Escape') set({ regOpen: -1 }); },
    onAddCal: (e: MouseEvent) => { e.preventDefault(); if (!(RE && downloadIcs(RE))) set({ calNote: true }); },
    onRegSubmit, onRegCancel,
  };

  return (
      <div className="pg-events">
      <div onMouseMove={v.onMove} onMouseEnter={v.onEnter} onMouseLeave={v.onLeave} style={{ minHeight: "100vh", fontFamily: "'Geist', system-ui, sans-serif", color: "#0A0A0A", background: "#FAFAF8", fontVariantNumeric: "tabular-nums", overflowX: "clip" }}>
      <header style={{ position: "sticky", top: "0", zIndex: "20", padding: "14px 16px 0" }}>
      <nav aria-label="Main" className="softnav" style={{ position: "relative", maxWidth: "1120px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "8px 8px 8px 28px" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", color: "#0A0A0A", textDecoration: "none", fontWeight: "600", fontSize: "20px", letterSpacing: "-0.03em" }}>Fremwork</Link>
      <div className="navlinks" style={{ gap: "8px" }}>
      <Link href="/" className="navi" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "84px", padding: "8px 12px 10px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#8C8C8C" }}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}><path d="M3.5 11 L12 4 L20.5 11 M5.5 9.5 V20 H18.5 V9.5 M10 20 V14.5 H14 V20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path></svg><span>Home</span><span aria-hidden="true" style={{ position: "absolute", bottom: "2px", left: "50%", width: "4px", height: "4px", marginLeft: "-2px", borderRadius: "50%", background: "#0A0A0A", opacity: "0" }}></span></Link>
      <Link href="/events" className="navi" aria-current="page" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "84px", padding: "8px 12px 10px", textDecoration: "none", fontSize: "13px", fontWeight: "600", color: "#0A0A0A" }}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}><path d="M4.5 6 H19.5 V20 H4.5 Z M4.5 10.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path></svg><span>Events</span><span aria-hidden="true" style={{ position: "absolute", bottom: "2px", left: "50%", width: "4px", height: "4px", marginLeft: "-2px", borderRadius: "50%", background: "#0A0A0A", opacity: "1" }}></span></Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <Link href={APP_LOGIN_URL} className="navi desk-login" style={{ color: "#5E5E5E", textDecoration: "none", fontSize: "14px", fontWeight: "500", padding: "12px 16px" }}>Log in</Link>
      <Link href="/signup" className="desk-cta" style={{ background: "#0A0A0A", color: "#FFFFFF", textDecoration: "none", fontSize: "14px", fontWeight: "500", padding: "14px 22px", borderRadius: "999px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)", whiteSpace: "nowrap" }}>Sign Up</Link>
      </div>
      </nav>
      </header>
      {/* Hero */}
      <section style={{ padding: "72px 16px 56px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "40px 56px" }}>
      <div style={{ flex: "1 1 420px", minWidth: "0" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#0A0A0A", background: "#C6F432", padding: "5px 12px", borderRadius: "999px" }}>EVENTS</span>
      <h1 style={{ margin: "22px 0 0", fontSize: "clamp(40px, 5.6vw, 72px)", lineHeight: "1.02", letterSpacing: "-0.045em", fontWeight: "600" }}>Run your finance<br />with AI.</h1>
      <p style={{ margin: "20px 0 0", maxWidth: "440px", fontSize: "18px", lineHeight: "28px", color: "#5E5E5E" }}>Live demos, workshops and meetups for business owners and finance teams. Free to join, with time for your questions.</p>
      </div>
      <div style={{ flex: "1 1 440px", minWidth: "0", position: "relative", borderRadius: "20px", overflow: "hidden", background: "#F1F1EC", border: "1px solid #E6E6E3", padding: "28px", boxSizing: "border-box", display: "flex", gap: "20px", alignItems: "flex-end" }}>
      <div aria-hidden="true" className="glow" style={{ position: "absolute", left: "-10%", top: "10%", width: "120%", height: "90%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.8), rgba(198,244,50,0.3) 55%, rgba(198,244,50,0) 100%)", filter: "blur(30px)" }}></div>
      <div style={{ position: "relative", zIndex: "1", flex: "1 1 0", minWidth: "0", display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#5E5E5E" }}>NEXT UP · {v.featured.type}</span>
      <span style={{ fontSize: "26px", lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "600" }}>{v.featured.title}</span>
      <span style={{ fontSize: "14px", color: "#3A3A38" }}>{v.featured.when} · {v.featured.where}</span>
      <div style={{ marginTop: "8px" }}><button type="button" className="reg" onClick={v.featured.toggle} aria-pressed={v.featured.pressed} style={{ fontFamily: "inherit", fontSize: "14px", fontWeight: "500", color: v.featured.btnColor, background: v.featured.btnBg, border: "1px solid #0A0A0A", borderRadius: "6px", padding: "10px 16px", cursor: "pointer" }}>{v.featured.btnLabel}</button></div>
      {v.isAdmin && v.featured.id ? (<div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><Link href={v.featured.editHref} className="reg" style={{ flex: 1, textAlign: "center", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "6px", padding: "8px 12px" }}>Edit</Link><button type="button" className="reg" onClick={v.featured.remove} style={{ flex: 1, fontFamily: "inherit", fontSize: "13px", fontWeight: "500", color: "#B42318", background: "#FFFFFF", border: "1px solid #F3C7C3", borderRadius: "6px", padding: "8px 12px", cursor: "pointer" }}>Delete</button></div>) : null}
      </div>
      <div style={{ position: "relative", zIndex: "1", width: "38%", flex: "none" }}>
      <FramSvg f={v as FramFace} label="Fram, the Fremwork character, waving hello" className="fram-svg" svgRef={v.setFram} onMouseDown={v.onPoke} style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }} />
      </div>
      </div>
      </div>
      </section>
      {/* Filters + list */}
      <section style={{ padding: "0 16px 112px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "16px", borderTop: "1px solid #E6E6E3", paddingTop: "28px" }}>
      <h2 style={{ margin: "0", fontSize: "28px", letterSpacing: "-0.025em", fontWeight: "600" }}>Upcoming events</h2>
      <div role="group" aria-label="Filter events" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
      {(v.filters || []).map((f: any, f_i: number) => (<Fragment key={f_i}>
      <button type="button" className="fchip" aria-pressed={f.pressed} onClick={f.pick} style={{ fontFamily: "inherit", fontSize: "13px", fontWeight: "500", color: f.color, background: f.bg, border: `1px solid ${f.border}`, borderRadius: "999px", padding: "8px 14px", cursor: "pointer" }}>{f.label}</button>
      </Fragment>))}
      </div>
      </div>
      <div className={v.listFade} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "16px" }}>
      {(v.events || []).map((e: any, e_i: number) => (<Fragment key={e_i}>
      <article className="ecard" style={{ background: "#FFFFFF", border: "1px solid #E6E6E3", borderRadius: "16px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#0A0A0A", background: e.tagBg, padding: "4px 9px", borderRadius: "999px" }}>{e.type}</span>
      <span style={{ fontSize: "12px", color: "#8C8C8C" }}>{e.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: "1" }}>
      <h3 style={{ margin: "0", fontSize: "20px", lineHeight: "1.25", letterSpacing: "-0.015em", fontWeight: "600" }}>{e.title}</h3>
      <p style={{ margin: "0", fontSize: "14px", lineHeight: "22px", color: "#5E5E5E" }}>{e.desc}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "14px", borderTop: "1px solid #EDEDED", fontSize: "13px", color: "#3A3A38" }}>
      <span>{e.when}</span>
      <span style={{ color: "#8C8C8C" }}>{e.where}</span>
      </div>
      <button type="button" className="reg" onClick={e.toggle} aria-pressed={e.pressed} style={{ fontFamily: "inherit", fontSize: "14px", fontWeight: "500", color: e.btnColor, background: e.btnBg, border: "1px solid #0A0A0A", borderRadius: "6px", padding: "10px 16px", cursor: "pointer" }}>{e.btnLabel}</button>
      {v.isAdmin && e.id ? (<div style={{ display: "flex", gap: "8px", marginTop: "8px" }}><Link href={e.editHref} className="reg" style={{ flex: 1, textAlign: "center", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "6px", padding: "8px 12px" }}>Edit</Link><button type="button" className="reg" onClick={e.remove} style={{ flex: 1, fontFamily: "inherit", fontSize: "13px", fontWeight: "500", color: "#B42318", background: "#FFFFFF", border: "1px solid #F3C7C3", borderRadius: "6px", padding: "8px 12px", cursor: "pointer" }}>Delete</button></div>) : null}
      </article>
      </Fragment>))}
      </div>
      {v.empty ? (<>
      <p style={{ margin: "0", padding: "40px 0", textAlign: "center", fontSize: "15px", color: "#5E5E5E" }}>No events of this type right now. Check back soon.</p>
      </>) : null}
      </div>
      </section>
      {/* Registration modal (Luma style) */}
      {v.regOpen ? (<>
      <div className="reg-back" onClick={v.onRegBackdrop} onKeyDown={v.onRegKey} style={{ position: "fixed", inset: "0", zIndex: "60", background: "rgba(10,10,10,0.35)", WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", boxSizing: "border-box" }}>
      <div role="dialog" aria-modal="true" aria-label={`Register for ${v.re.title}`} className="reg-pop" style={{ position: "relative", width: "100%", maxWidth: "500px", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "#FFFFFF", borderRadius: "22px", boxShadow: "0 40px 100px rgba(10,10,10,0.3)" }}>
      <button type="button" aria-label="Close" onClick={v.onRegClose} className="reg-x" style={{ position: "absolute", top: "14px", right: "14px", zIndex: "2", width: "34px", height: "34px", border: "0", borderRadius: "50%", background: "rgba(255,255,255,0.85)", color: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"></path></svg></button>
      <div style={{ position: "relative", height: "150px", overflow: "hidden", borderRadius: "22px 22px 0 0", background: "#F1F1EC" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: "-10%", top: "-10%", width: "120%", height: "160%", borderRadius: "50%", background: `radial-gradient(closest-side, ${v.re.glow}, rgba(241,241,236,0) 75%)`, filter: "blur(18px)" }}></div>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0", backgroundImage: "radial-gradient(rgba(10,10,10,0.07) 1px, transparent 1px)", backgroundSize: "6px 6px" }}></div>
      <span style={{ position: "absolute", left: "22px", bottom: "18px", fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#0A0A0A", background: v.re.tagBg, padding: "4px 10px", borderRadius: "999px" }}>{v.re.type}</span>
      </div>
      <div style={{ padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <h2 style={{ margin: "0", fontSize: "24px", lineHeight: "1.2", letterSpacing: "-0.025em", fontWeight: "600" }}>{v.re.title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", borderRadius: "9px", border: "1px solid #E6E6E3", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24"><path d="M4.5 6 H19.5 V20 H4.5 Z M4.5 10.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5" fill="none" stroke="#0A0A0A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: "14px", fontWeight: "600" }}>{v.re.when}</span><span style={{ fontSize: "13px", color: "#8C8C8C" }}>{v.re.length}</span></span></div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", borderRadius: "9px", border: "1px solid #E6E6E3", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 21 C12 21 5 14.5 5 9.5 a7 7 0 0 1 14 0 C19 14.5 12 21 12 21 Z" fill="none" stroke="#0A0A0A" strokeWidth="1.7" strokeLinejoin="round"></path><circle cx="12" cy="9.5" r="2.5" fill="none" stroke="#0A0A0A" strokeWidth="1.7"></circle></svg></span><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: "14px", fontWeight: "600" }}>{v.re.where}</span><span style={{ fontSize: "13px", color: "#8C8C8C" }}>Link sent after you register</span></span></div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span aria-hidden="true" style={{ width: "36px", height: "36px", flex: "none", borderRadius: "9px", background: "#C6F432", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}><span style={{ width: "3px", height: "9px", borderRadius: "2px", background: "#0A0A0A" }}></span><span style={{ width: "3px", height: "9px", borderRadius: "2px", background: "#0A0A0A" }}></span></span><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: "13px", color: "#8C8C8C" }}>Hosted by</span><span style={{ fontSize: "14px", fontWeight: "600" }}>Fremwork</span></span></div>
      </div>
      {v.regSuccess ? (<>
      <div role="status" aria-live="assertive" className="ok-pop" style={{ position: "relative", overflow: "hidden", border: "1px solid #E6E6E3", borderRadius: "16px", padding: "30px 20px 26px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center", background: "#F1F1EC" }}>
      <div aria-hidden="true" style={{ position: "absolute", left: "10%", top: "-30%", width: "80%", height: "140%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.75), rgba(198,244,50,0) 75%)", filter: "blur(16px)" }}></div>
      <span aria-hidden="true" className="ok-check" style={{ position: "relative", width: "58px", height: "58px", borderRadius: "50%", background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="26" height="26" viewBox="0 0 24 24"><path className="ok-tick" d="M5 12.5 L10 17 L19 7.5" fill="none" stroke="#C6F432" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"></path></svg></span>
      <span style={{ position: "relative", fontSize: "20px", fontWeight: "600", letterSpacing: "-0.02em" }}>Successfully registered!</span>
      <span style={{ position: "relative", fontSize: "15px", lineHeight: "22px", color: "#3A3A38", maxWidth: "340px" }}>Check your email. We sent your confirmation to <strong style={{ color: "#0A0A0A", fontWeight: "600" }}>{v.rt.email}</strong>.</span>
      <span aria-hidden="true" style={{ position: "absolute", left: "0", bottom: "0", height: "3px", width: "100%", background: "rgba(10,10,10,0.08)" }}><span className="ok-bar" style={{ display: "block", height: "100%", background: "#0A0A0A", transformOrigin: "left center" }}></span></span>
      </div>
      </>) : null}
      {v.regForm ? (<>
      <div style={{ border: "1px solid #E6E6E3", borderRadius: "16px", overflow: "hidden" }}>
      <div style={{ background: "#FAFAF8", borderBottom: "1px solid #EDEDED", padding: "10px 16px", fontSize: "13px", fontWeight: "600", color: "#5E5E5E" }}>Registration</div>
      <form onSubmit={v.onRegSubmit} noValidate style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
      <p style={{ margin: "0", fontSize: "14px", lineHeight: "21px", color: "#3A3A38" }}>Welcome! To join the event, please register below.</p>
      {(v.regFields || []).map((f: any, f_i: number) => (<Fragment key={f_i}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label htmlFor={f.domId} style={{ fontSize: "13px", fontWeight: "500", color: "#0A0A0A" }}>{f.label}<span style={{ color: f.reqColor }}> {f.reqMark}</span></label>
      {f.isText ? (<>
      <div className="rfield" style={{ display: "flex", alignItems: "center", background: "#FFFFFF", border: `1px solid ${f.border}`, borderRadius: "10px" }}><input id={f.domId} type={f.inputType} autoComplete={f.auto} placeholder={f.placeholder} value={f.value} onChange={f.onChange} aria-invalid={f.invalid} style={{ width: "100%", boxSizing: "border-box", border: "0", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "15px", color: "#0A0A0A", padding: "11px 13px" }} /></div>
      </>) : null}
      {f.isSelect ? (<>
      <div className="rfield" style={{ position: "relative", display: "flex", alignItems: "center", background: "#FFFFFF", border: `1px solid ${f.border}`, borderRadius: "10px" }}>
      <select id={f.domId} value={f.value} onChange={f.onChange} aria-invalid={f.invalid} style={{ width: "100%", boxSizing: "border-box", border: "0", outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "15px", padding: "11px 13px", appearance: "none", WebkitAppearance: "none", paddingRight: "38px", cursor: "pointer", color: f.selColor }}>
      <option value="">{f.placeholder}</option>
      {(f.options || []).map((o: any, o_i: number) => (<Fragment key={o_i}>
      <option value={o.v}>{o.v}</option>
      </Fragment>))}
      </select>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 10 10" style={{ position: "absolute", right: "14px", top: "50%", marginTop: "-6px", pointerEvents: "none" }}><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="#5E5E5E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
      </div>
      </>) : null}
      {f.err ? (<><span style={{ fontSize: "12px", color: "#B42318" }}>{f.err}</span></>) : null}
      </div>
      </Fragment>))}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span id="reg-tg-label" style={{ fontSize: "13px", fontWeight: "500", color: "#0A0A0A" }}>Join our Telegram<span style={{ color: "#B42318" }}> *</span></span>
      <div role="group" aria-labelledby="reg-tg-label" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", border: `1px solid ${v.tgBorder}`, borderRadius: "10px", padding: "12px 13px", background: v.tgJoined ? "#1FA9710D" : "#FFFFFF" }}>
      <span aria-hidden="true" style={{ width: "34px", height: "34px", flex: "none", borderRadius: "50%", background: "#229ED9", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24"><path d="M21.5 4.3 2.9 11.5c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.4-1.5ZM9.3 14.5l-.4 4.1-1.6-5 9.9-6.2c.5-.3.9-.1.5.2l-8.4 6.9Z" fill="#FFFFFF"></path></svg></span>
      <span style={{ flex: "1", minWidth: "160px", fontSize: "13px", lineHeight: "19px", color: "#3A3A38" }}>{v.tgJoined ? "Thanks for joining. Event updates and the join link are shared there." : "Event updates and the join link are shared in our Telegram channel. Join it to register."}</span>
      {v.tgJoined ? (<span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: "600", color: "#137A50" }}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 L10 17 L19 7.5" fill="none" stroke="#137A50" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"></path></svg>Joined</span>) : (<a href={v.tgUrl} target="_blank" rel="noopener noreferrer" onClick={v.onTgJoin} style={{ display: "inline-flex", alignItems: "center", gap: "8px", textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#FFFFFF", background: "#229ED9", borderRadius: "999px", padding: "9px 16px", whiteSpace: "nowrap" }}>Join Telegram</a>)}
      </div>
      {v.tgErr ? (<span style={{ fontSize: "12px", color: "#B42318" }}>Tap Join Telegram first.</span>) : null}
      </div>
      {v.regFormErr ? (<><p role="alert" style={{ margin: "0", fontSize: "13px", color: "#B42318", background: "#FEF3F2", borderRadius: "8px", padding: "8px 12px" }}>{v.regFormErr}</p></>) : null}
      <button type="button" onClick={v.onRegSubmit} className="reg-go" style={{ marginTop: "4px", width: "100%", minHeight: "46px", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", fontFamily: "inherit", fontSize: "15px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", border: "0", borderRadius: "10px", cursor: "pointer" }}>
      {v.regLoading ? (<><span className="spin" aria-hidden="true" style={{ width: "15px", height: "15px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#FFFFFF" }}></span></>) : null}
      {v.regBtn}
      </button>
      </form>
      </div>
      </>) : null}
      {v.regTicket ? (<>
      <div className="fade" role="status" style={{ border: "1px solid #E6E6E3", borderRadius: "16px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px", background: "#F1F1EC", borderBottom: "1px dashed #D6D6D2" }}>
      <span aria-hidden="true" style={{ width: "40px", height: "40px", borderRadius: "12px", background: "#C6F432", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 12.5 L10 17 L19 7.5" fill="none" stroke="#0A0A0A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"></path></svg></span>
      <span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: "18px", fontWeight: "600", letterSpacing: "-0.01em" }}>You’re in</span><span style={{ fontSize: "13px", color: "#5E5E5E" }}>A confirmation is on its way to {v.rt.email}.</span></span>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
      {(v.rt.rows || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", fontSize: "13px" }}><span style={{ color: "#8C8C8C" }}>{r.k}</span><span style={{ fontWeight: "500", textAlign: "right" }}>{r.v}</span></div>
      </Fragment>))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "0 16px 16px" }}>
      <a href="#calendar" onClick={v.onAddCal} className="reg-go" style={{ flex: "1 1 160px", textAlign: "center", textDecoration: "none", fontSize: "14px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", borderRadius: "10px", padding: "11px 14px" }}>Add to calendar</a>
      <button type="button" onClick={v.onRegCancel} className="reg-ghost" style={{ flex: "1 1 160px", fontFamily: "inherit", fontSize: "14px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "10px", padding: "10px 14px", cursor: "pointer" }}>Cancel registration</button>
      </div>
      {v.calNote ? (<><p style={{ margin: "0", padding: "0 16px 14px", fontSize: "12px", color: "#8C8C8C" }}>Calendar invites go out once the date is confirmed.</p></>) : null}
      </div>
      </>) : null}
      </div>
      </div>
      </div>
      </>) : null}
      <footer style={{ borderTop: "1px solid #EDEDED", background: "#FFFFFF", padding: "40px 16px 0", overflow: "hidden" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto", height: "0.8em", overflow: "hidden", fontSize: "clamp(72px, 19.5vw, 280px)", lineHeight: "0.98", fontWeight: "600", letterSpacing: "-0.06em", textAlign: "center", whiteSpace: "nowrap", userSelect: "none", background: "linear-gradient(180deg, #B4B4B4 0%, #D9D9D9 45%, #FFFFFF 95%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Fremwork</div>
      </footer>
      <div className="tb-space" aria-hidden="true"></div>
      <nav className="tabbar" aria-label="Main">
      <Link href="/" className="tb"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11 L12 4 L20.5 11 M5.5 9.5 V20 H18.5 V9.5 M10 20 V14.5 H14 V20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Home</span></Link>
      <Link href="/events" className="tb" aria-current="page"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6 H19.5 V20 H4.5 Z M4.5 10.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Events</span></Link>
      <Link href="/signup" className="tb tb-join"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6 V18 M6 12 H18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Sign Up</span></Link>
      <Link href={APP_LOGIN_URL} className="tb"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20.5a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Log in</span></Link>
      </nav>
      </div>
      </div>
  );
}
