'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { FramSvg, type FramFace } from '@/components/fram/FramSvg';
import '@/styles/home.css';
import { useEffect, useMemo, useRef, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';
import { faceFrom, useBlinkWave } from '@/components/fram/useFram';
import type { FramMood } from '@/components/fram/FramSvg';
import { useMergeState } from '@/components/fram/useMergeState';
import { CHATS, PRODUCTS, POINTS, TAGS, type ChatMsg } from '@/components/screens/home-content';

/** Canned replies for the demo chat. Swap for a call to your assistant API when it is ready. */
function replyFor(idx: number, text: string): ChatMsg {
  const c = CHATS[idx];
  const t = text.toLowerCase();
  if (/help|what can you|who are you|what do you do/.test(t)) return { agent: c.helpIntro, lines: c.skills, plain: true };
  if (/^(hi|hello|hey)\b/.test(t)) return { agent: `Hi. I am your ${c.name}. Ask me anything about ${c.topics}.` };
  for (const a of c.answers) if (new RegExp(a.k).test(t)) return { agent: a.text, lines: a.lines };
  return {
    agent: 'Good question. Once your accounts are connected I will answer that with the figures, where they came from and a recommendation. For now, try one of these:',
    lines: c.suggest.slice(1).map((q) => ({ k: q, v: 'ask me' })),
    plain: true,
  };
}

const mm = (q: string) => window.matchMedia?.(q).matches ?? false;

/** Homepage · ported from Main.dc.html. */
export function HomeScreen() {
  const { blink, wave, triggerWave, env } = useBlinkWave();
  const [s, set, get] = useMergeState({
    ex: 0, ey: 0, mood: 'smile' as FramMood, squint: false, cardTx: 0, cardTy: 0, cardRot: 0,
    chatIdx: 0, chatFlip: false, draft: '',
    extra: {} as Record<number, ChatMsg[]>, pending: {} as Record<number, boolean>,
  });
  const r = useRef({ raf: 0, pending: null as null | (() => void), idle: 0, mood: 0, hold: false, lastY: 0, lastT: 0, scrollPending: true });
  const tileEl = useRef<HTMLSpanElement | null>(null);
  const msgEl = useRef<HTMLDivElement | null>(null);

  const frame = (fn: () => void) => {
    const st = r.current;
    st.pending = fn;
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => { st.raf = 0; const p = st.pending; st.pending = null; p?.(); });
  };

  const center = (which?: 'card') => {
    if (which === 'card') {
      const big = document.querySelector('.pg-home .fram-big');
      if (!big) return null;
      const b = big.getBoundingClientRect();
      const st = get();
      return { x: b.left - st.cardTx + b.width * 0.517, y: b.top - st.cardTy + b.height * 0.477, size: b.width * 0.5 };
    }
    const el = tileEl.current;
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width * 0.49, y: b.top + b.height * 0.56, size: b.width };
  };

  const fromPointer = (x: number, y: number, which?: 'card') => {
    const c = center(which);
    if (!c) return;
    const dx = x - c.x, dy = y - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const m = Math.min(1, dist / 280);
    let mood: FramMood = 'smile', squint = false;
    if (dist < c.size * 0.42) { mood = 'grin'; squint = true; } else if (dist > 640) mood = 'flat';
    if (r.current.hold) { mood = 'o'; squint = false; }
    const next: Partial<typeof s> = { ex: (dx / dist) * 24 * m, ey: (dy / dist) * 20 * m, mood, squint };
    if (which === 'card') {
      const cl = (val: number, a: number) => Math.max(-a, Math.min(a, val));
      next.cardTx = cl(dx * 0.06, 32); next.cardTy = cl(dy * 0.05, 18); next.cardRot = cl(dx * 0.012, 5);
    }
    set(next);
  };

  // Touch devices: Fram reacts to scrolling instead of the pointer.
  useEffect(() => {
    const st = r.current;
    st.lastY = window.scrollY; st.lastT = Date.now();
    let onScroll: (() => void) | undefined;
    if (!mm('(hover: hover) and (pointer: fine)')) {
      const fromScroll = () => {
        const y = window.scrollY, t = Date.now();
        const vel = Math.abs(y - st.lastY) / Math.max(16, t - st.lastT);
        const up = y < st.lastY;
        st.lastY = y; st.lastT = t;
        const p = Math.max(0, Math.min(1, y / 700));
        const ey = up && vel > 0.2 ? -16 : -8 + p * 28;
        const top = y < 24;
        const mood: FramMood = vel > 1.4 ? 'o' : top ? 'grin' : 'smile';
        set({ ex: 0, ey: Math.min(20, ey), mood, squint: top && mood !== 'o' });
        clearTimeout(st.mood);
        st.mood = window.setTimeout(() => {
          const atTop = window.scrollY < 24;
          const pp = Math.max(0, Math.min(1, window.scrollY / 700));
          set({ mood: atTop ? 'grin' : 'smile', squint: atTop, ey: Math.min(20, -8 + pp * 28) });
        }, 260);
      };
      onScroll = () => frame(fromScroll);
      window.addEventListener('scroll', onScroll, { passive: true });
      fromScroll();
      triggerWave();
    }
    return () => {
      if (onScroll) window.removeEventListener('scroll', onScroll);
      clearTimeout(st.idle); clearTimeout(st.mood);
      if (st.raf) cancelAnimationFrame(st.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the chat scrolled to the newest message.
  useEffect(() => {
    if (r.current.scrollPending && msgEl.current) {
      msgEl.current.scrollTop = msgEl.current.scrollHeight;
      r.current.scrollPending = false;
    }
  });

  const sendText = (text: string) => {
    const idx = get().chatIdx;
    r.current.scrollPending = true;
    set((st) => ({ extra: { ...st.extra, [idx]: [...(st.extra[idx] || []), { you: text }] }, pending: { ...st.pending, [idx]: true } }));
    window.setTimeout(() => {
      r.current.scrollPending = true;
      set((st) => ({ extra: { ...st.extra, [idx]: [...(st.extra[idx] || []), replyFor(idx, text)] }, pending: { ...st.pending, [idx]: false } }));
    }, 1100);
  };

  const pointerHandlers = (which?: 'card') => {
    const rest = which === 'card'
      ? { ex: 0, ey: 0, mood: 'smile' as FramMood, squint: false, cardTx: 0, cardTy: 0, cardRot: 0 }
      : { ex: 0, ey: 0, mood: 'smile' as FramMood, squint: false };
    return {
      move: (e: MouseEvent) => {
        if (!env.current.fine) return;
        const { clientX: x, clientY: y } = e;
        frame(() => fromPointer(x, y, which));
        clearTimeout(r.current.idle);
        r.current.idle = window.setTimeout(() => set(rest), 3500);
      },
      enter: () => {
        if (!env.current.fine) return;
        if (Date.now() - env.current.lastWave > 6000) triggerWave();
      },
      leave: () => {
        if (!env.current.fine) return;
        clearTimeout(r.current.idle);
        r.current.pending = null;
        set(rest);
      },
      down: (e: MouseEvent) => {
        if (!env.current.fine) return;
        const { clientX: x, clientY: y } = e;
        r.current.hold = true;
        set({ mood: 'o', squint: false });
        clearTimeout(r.current.mood);
        r.current.mood = window.setTimeout(() => { r.current.hold = false; fromPointer(x, y, which); }, 520);
      },
    };
  };
  const hero = pointerHandlers();
  const card = pointerHandlers('card');

  const face = useMemo(() => faceFrom({ ex: s.ex, ey: s.ey, mood: s.mood, squint: s.squint, blink, wave }), [s.ex, s.ey, s.mood, s.squint, blink, wave]);
  const sections = useMemo(() => PRODUCTS.map((p, i) => ({
    id: p.id, name: p.name, desc: p.desc, color: p.color, tag: TAGS[p.id], dir: i % 2 ? 'row-reverse' : 'row',
    points: POINTS[p.id].map((t) => ({ text: t })),
    chat: p.chat.map((m) => {
      const you = 'you' in m;
      return { text: 'you' in m ? m.you : m.agent, align: you ? 'flex-end' : 'flex-start', bg: you ? '#0A0A0A' : '#F0F0EE', color: you ? '#FFFFFF' : '#0A0A0A', radius: you ? '16px 16px 4px 16px' : '16px 16px 16px 4px' };
    }),
  })), []);

  const idx = s.chatIdx;
  const c = CHATS[idx];
  const msgs = s.extra[idx] || [];

  // Template bindings for the ported markup (values mirror the design file's renderVals).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: Record<string, any> = {
    ...face,
    sections,
    chats: CHATS.map((ch, i) => {
      const on = i === idx;
      const ex = s.extra[i] || [];
      const last = ex[ex.length - 1];
      return {
        name: ch.name, time: ex.length ? 'Now' : '', preview: last ? last.you || last.agent : ch.preview, color: ch.color,
        bg: on ? 'rgba(10,10,10,0.08)' : 'transparent', current: on ? 'true' : 'false',
        chipBg: on ? '#FFFFFF' : 'transparent', chipBorder: on ? '#0A0A0A' : '#E2E2DF',
        go: () => { r.current.scrollPending = true; set({ chatIdx: i, chatFlip: !get().chatFlip }); },
      };
    }),
    chat: {
      name: c.name, role: c.role, color: c.color, preview: c.preview,
      suggest: c.suggest.map((q) => ({ text: q, go: () => sendText(q) })),
      msgs: msgs.map((m) => ({
        isStamp: false, isYou: !!m.you, isAgent: !!m.agent, text: m.you || m.agent,
        lines: (m.lines || []).map((l) => ({ k: l.k, v: l.v, mark: m.plain ? '' : '✓' })),
      })),
    },
    chatEmpty: !msgs.length && !s.pending[idx],
    chatPending: s.pending[idx] === true,
    chatPlaceholder: 'Message ' + c.name,
    draft: s.draft,
    sendBg: s.draft.trim() ? '#0A0A0A' : '#C9C9C6',
    onDraft: (e: ChangeEvent<HTMLInputElement>) => set({ draft: e.target.value }),
    onSend: (e: FormEvent) => {
      e.preventDefault();
      const text = get().draft.trim();
      if (!text) return;
      set({ draft: '' });
      sendText(text);
    },
    setMsgs: (el: HTMLDivElement | null) => { msgEl.current = el; },
    setTile: (el: HTMLSpanElement | null) => { tileEl.current = el; },
    chatFade: s.chatFlip ? 'tfade-b' : 'tfade-a',
    onMove: hero.move, onEnter: hero.enter, onLeave: hero.leave, onDown: hero.down,
    onMove2: card.move, onEnter2: card.enter, onLeave2: card.leave, onDown2: card.down,
    cardTx: s.cardTx.toFixed(1), cardTy: s.cardTy.toFixed(1), cardRot: s.cardRot.toFixed(2),
  };

  return (
      <div className="pg-home">
      <div style={{ fontFamily: "'Geist', system-ui, sans-serif", color: "#0A0A0A", background: "#FAFAF8", fontVariantNumeric: "tabular-nums", overflowX: "clip" }}>
      {/* NAV */}
      <header style={{ position: "sticky", top: "0", zIndex: "20", padding: "14px 16px 0" }}>
      <nav aria-label="Main" className="softnav" style={{ position: "relative", maxWidth: "1120px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "8px 8px 8px 28px" }}>
      <a href="#top" style={{ display: "flex", alignItems: "center", gap: "10px", color: "#0A0A0A", textDecoration: "none", fontWeight: "600", fontSize: "20px", letterSpacing: "-0.03em" }}>Fremwork</a>
      <div className="navlinks" style={{ gap: "8px" }}>
      <Link href="/" className="navi" aria-current="page" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "84px", padding: "8px 12px 10px", textDecoration: "none", fontSize: "13px", fontWeight: "600", color: "#0A0A0A" }}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}><path d="M3.5 11 L12 4 L20.5 11 M5.5 9.5 V20 H18.5 V9.5 M10 20 V14.5 H14 V20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path></svg><span>Home</span><span aria-hidden="true" style={{ position: "absolute", bottom: "2px", left: "50%", width: "4px", height: "4px", marginLeft: "-2px", borderRadius: "50%", background: "#0A0A0A", opacity: "1" }}></span></Link>
      <Link href="/events" className="navi" style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", minWidth: "84px", padding: "8px 12px 10px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#8C8C8C" }}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}><path d="M4.5 6 H19.5 V20 H4.5 Z M4.5 10.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"></path></svg><span>Events</span><span aria-hidden="true" style={{ position: "absolute", bottom: "2px", left: "50%", width: "4px", height: "4px", marginLeft: "-2px", borderRadius: "50%", background: "#0A0A0A", opacity: "0" }}></span></Link>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <Link href="/login" className="navi desk-login" style={{ color: "#5E5E5E", textDecoration: "none", fontSize: "14px", fontWeight: "500", padding: "12px 16px" }}>Log in</Link>
      <Link href="/login" className="desk-cta" style={{ background: "#0A0A0A", color: "#FFFFFF", textDecoration: "none", fontSize: "14px", fontWeight: "500", padding: "14px 22px", borderRadius: "999px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)", whiteSpace: "nowrap" }}>Sign Up</Link>
      </div>
      </nav>
      </header>
      {/* HERO */}
      <section id="top" onMouseMove={v.onMove} onMouseEnter={v.onEnter} onMouseLeave={v.onLeave} onMouseDown={v.onDown} style={{ padding: "72px 16px 0", overflow: "hidden" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
      <h1 style={{ margin: "24px 0 0", fontSize: "clamp(40px, 7vw, 92px)", lineHeight: "1.04", letterSpacing: "-0.045em", fontWeight: "600", color: "#0A0A0A", background: "#FAFAF8" }}>One <span className="tile" ref={v.setTile} style={{ display: "inline-block", width: "1.3em", margin: "0 0.06em 0 0.1em", verticalAlign: "-0.16em" }}><FramSvg f={v as FramFace} label="Fram, the Fremwork character, waving" style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }} bob /></span> chat.<br />A whole <span className="bubble" style={{ position: "relative", display: "inline-block", margin: "14px 4px 6px 0", padding: "0.04em 0.28em 0.1em", background: "#C6F432", border: "3px solid #0A0A0A", color: "#0A0A0A", transform: "rotate(-3deg)" }}>finance team<span aria-hidden="true" style={{ position: "absolute", left: "18%", bottom: "-15px", width: "22px", height: "22px", background: "#C6F432", borderRight: "3px solid #0A0A0A", borderBottom: "3px solid #0A0A0A", transform: "skewX(-24deg) rotate(45deg) scale(.7,1)", transformOrigin: "center" }}></span></span>.</h1>
      <p style={{ margin: "28px auto 0", maxWidth: "860px", fontSize: "18px", lineHeight: "28px", color: "#5E5E5E", textAlign: "center" }}>Fremwork is an AI financial assistant for business owners and finance teams. Ask a question about your <span style={{ whiteSpace: "nowrap" }}>finances. Get a clear answer.</span></p>
      {/* App window preview (macOS, light) */}
      <div style={{ width: "100%", margin: "64px 0 104px", textAlign: "left" }}>
      <div style={{ background: "#FFFFFF", borderRadius: "14px", overflow: "hidden", boxShadow: "0 0 0 1px rgba(10,10,10,0.09), 0 24px 60px rgba(10,10,10,0.12), 0 6px 16px rgba(10,10,10,0.06)", display: "flex", height: "640px", color: "#0A0A0A" }} className="chatwin">
      <div className="win-side" style={{ width: "290px", flex: "none", background: "#F4F4F2", borderRight: "1px solid #E4E4E1", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px 12px" }}>
      <div aria-hidden="true" style={{ display: "flex", gap: "8px" }}><span style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#FF5F57", boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)" }}></span><span style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#FEBC2E", boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)" }}></span><span style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#28C840", boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.12)" }}></span></div>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 V13.5 M2.5 8 H13.5" stroke="#5E5E5E" strokeWidth="1.6" strokeLinecap="round"></path></svg>
      </div>
      <div style={{ margin: "2px 12px 12px", display: "flex", alignItems: "center", gap: "8px", borderRadius: "8px", background: "rgba(10,10,10,0.06)", padding: "7px 10px", fontSize: "13px", color: "#5E5E5E" }}>
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="#5E5E5E" strokeWidth="1.6"></circle><path d="M10.5 10.5 L14 14" stroke="#5E5E5E" strokeWidth="1.6" strokeLinecap="round"></path></svg>Search
      </div>
      <div role="list" aria-label="Finance assistants" style={{ flex: "1", minHeight: "0", overflowY: "auto", display: "flex", flexDirection: "column", padding: "0 8px", gap: "2px" }}>
      {(v.chats || []).map((c: any, c_i: number) => (<Fragment key={c_i}>
      <button type="button" role="listitem" onClick={c.go} aria-current={c.current} className="chat-item" style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", textAlign: "left", fontFamily: "inherit", color: "#0A0A0A", background: c.bg, border: "0", borderRadius: "10px", padding: "9px 10px", cursor: "pointer" }}>
      <span aria-hidden="true" style={{ width: "38px", height: "38px", flex: "none", borderRadius: "11px", background: c.color, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}><span style={{ width: "5px", height: "11px", borderRadius: "3px", background: "#0A0A0A" }}></span><span style={{ width: "5px", height: "11px", borderRadius: "3px", background: "#0A0A0A" }}></span></span>
      <span style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}><span style={{ fontSize: "14px", fontWeight: "600" }}>{c.name}</span><span style={{ fontSize: "12px", color: "#5E5E5E" }}>{c.time}</span></span>
      <span style={{ fontSize: "13px", color: "#5E5E5E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.preview}</span>
      </span>
      </button>
      </Fragment>))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", borderTop: "1px solid #E4E4E1" }}>
      <span aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: "50%", background: "#0A0A0A", color: "#FFFFFF", fontSize: "11px", fontWeight: "600", display: "flex", alignItems: "center", justifyContent: "center" }}>AJ</span>
      <span style={{ fontSize: "14px", fontWeight: "500" }}>Andrio John</span>
      </div>
      </div>
      <div style={{ flex: "1", minWidth: "0", display: "flex", flexDirection: "column", background: "#FFFFFF" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #EDEDED", background: "rgba(250,250,248,0.9)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <span aria-hidden="true" style={{ width: "26px", height: "26px", borderRadius: "8px", background: v.chat.color, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}><span style={{ width: "3px", height: "8px", borderRadius: "2px", background: "#0A0A0A" }}></span><span style={{ width: "3px", height: "8px", borderRadius: "2px", background: "#0A0A0A" }}></span></span>
      <span style={{ fontSize: "14px", fontWeight: "600" }}>{v.chat.name}</span>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.06em", color: "#5E5E5E" }}>{v.chat.role}</span>
      </div>
      </div>
      <div className="mob-bots" role="tablist" aria-label="Choose an assistant" style={{ gap: "8px", overflowX: "auto", padding: "10px 14px", borderBottom: "1px solid #EDEDED", background: "#F4F4F2", scrollbarWidth: "none" }}>
      {(v.chats || []).map((c: any, c_i: number) => (<Fragment key={c_i}>
      <button type="button" role="tab" aria-selected={c.current} onClick={c.go} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: "8px", fontFamily: "inherit", fontSize: "13px", fontWeight: "600", color: "#0A0A0A", background: c.chipBg, border: `1px solid ${c.chipBorder}`, borderRadius: "999px", padding: "5px 12px 5px 5px", cursor: "pointer" }}><span aria-hidden="true" style={{ width: "24px", height: "24px", borderRadius: "8px", background: c.color, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}><span style={{ width: "3px", height: "8px", borderRadius: "2px", background: "#0A0A0A" }}></span><span style={{ width: "3px", height: "8px", borderRadius: "2px", background: "#0A0A0A" }}></span></span>{c.name}</button>
      </Fragment>))}
      </div>
      <div className={v.chatFade} ref={v.setMsgs} aria-live="polite" style={{ flex: "1", minHeight: "0", overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {v.chatEmpty ? (<>
      <div style={{ flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", textAlign: "center", padding: "24px 0" }}>
      <span aria-hidden="true" style={{ width: "56px", height: "56px", borderRadius: "16px", background: v.chat.color, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}><span style={{ width: "6px", height: "16px", borderRadius: "3px", background: "#0A0A0A" }}></span><span style={{ width: "6px", height: "16px", borderRadius: "3px", background: "#0A0A0A" }}></span></span>
      <span style={{ fontSize: "18px", fontWeight: "600", letterSpacing: "-0.01em" }}>Ask the {v.chat.name}</span>
      <span style={{ fontSize: "14px", color: "#5E5E5E" }}>{v.chat.preview}</span>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", marginTop: "8px", maxWidth: "460px" }}>
      {(v.chat.suggest || []).map((q: any, q_i: number) => (<Fragment key={q_i}>
      <button type="button" className="chat-sug" onClick={q.go} style={{ fontFamily: "inherit", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "999px", padding: "8px 14px", cursor: "pointer" }}>{q.text}</button>
      </Fragment>))}
      </div>
      </div>
      </>) : null}
      {(v.chat.msgs || []).map((m: any, m_i: number) => (<Fragment key={m_i}>
      {m.isStamp ? (<>
      <div style={{ alignSelf: "center", fontSize: "11px", fontWeight: "500", color: "#8C8C8C", padding: "6px 0 2px" }}>{m.text}</div>
      </>) : null}
      {m.isYou ? (<>
      <div style={{ alignSelf: "flex-end", maxWidth: "70%", background: "#0A0A0A", color: "#FFFFFF", padding: "9px 14px", borderRadius: "18px 18px 6px 18px", fontSize: "14px", lineHeight: "21px" }}>{m.text}</div>
      </>) : null}
      {m.isAgent ? (<>
      <div style={{ alignSelf: "flex-start", maxWidth: "76%", background: "#F0F0EE", color: "#0A0A0A", padding: "10px 14px", borderRadius: "18px 18px 18px 6px", fontSize: "14px", lineHeight: "22px", display: "flex", flexDirection: "column", gap: "2px" }}>
      <span>{m.text}</span>
      {(m.lines || []).map((ln: any, ln_i: number) => (<Fragment key={ln_i}>
      <span><span style={{ color: "#127A4D", fontWeight: "600" }}>{ln.mark}</span> <strong style={{ fontWeight: "600" }}>{ln.k}</strong> <span style={{ color: "#8C8C8C" }}>→</span> {ln.v}</span>
      </Fragment>))}
      </div>
      </>) : null}
      </Fragment>))}
      {v.chatPending ? (<>
      <div className="tfade-a" style={{ alignSelf: "flex-start", background: "#F0F0EE", borderRadius: "18px 18px 18px 6px", padding: "13px 16px", display: "flex", gap: "5px" }} aria-label="Assistant is typing">
      <span className="tdot" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#8C8C8C" }}></span><span className="tdot" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#8C8C8C", animationDelay: ".15s" }}></span><span className="tdot" style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#8C8C8C", animationDelay: ".3s" }}></span>
      </div>
      </>) : null}
      </div>
      <form onSubmit={v.onSend} className="chat-form" style={{ margin: "0 20px 18px", display: "flex", alignItems: "center", gap: "8px", border: "1px solid #E2E2DF", borderRadius: "999px", background: "#FFFFFF", padding: "5px", boxShadow: "0 1px 2px rgba(10,10,10,0.04)" }}>
      <button type="button" aria-label="Attach a file" className="chat-icon" style={{ width: "34px", height: "34px", flex: "none", border: "0", borderRadius: "50%", background: "#F0F0EE", color: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 V13.5 M2.5 8 H13.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"></path></svg></button>
      <label htmlFor="chat-input" style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>Message {v.chat.name}</label>
      <input id="chat-input" type="text" autoComplete="off" value={v.draft} onChange={v.onDraft} placeholder={v.chatPlaceholder} style={{ flex: "1", minWidth: "0", background: "transparent", border: "0", outline: "none", color: "#0A0A0A", fontFamily: "inherit", fontSize: "14px", padding: "8px 4px" }} />
      <button type="submit" aria-label="Send message" className="chat-send" style={{ width: "34px", height: "34px", flex: "none", border: "0", borderRadius: "50%", background: v.sendBg, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background .2s" }}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13 V3 M3.5 7.5 L8 3 L12.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></button>
      </form>
      </div>
      </div>
      </div>
      </div>
      </section>
      {/* SIGN UP CTA (top) */}
      <section aria-labelledby="cta-title-top" style={{ padding: "24px 16px 24px" }}>
      <div style={{ position: "relative", maxWidth: "1180px", margin: "0 auto", overflow: "hidden", borderRadius: "24px", background: "#F1F1EC", border: "1px solid #E6E6E3", padding: "clamp(48px, 6vw, 80px) clamp(20px, 4vw, 56px)" }}>
      <div aria-hidden="true" className="pglow" style={{ position: "absolute", left: "12%", top: "8%", width: "76%", height: "110%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.75), rgba(198,244,50,0.25) 55%, rgba(198,244,50,0) 100%)", filter: "blur(34px)" }}></div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center" }}>
      <h2 id="cta-title-top" style={{ margin: "0", fontSize: "clamp(30px, 3.6vw, 48px)", lineHeight: "1.1", letterSpacing: "-0.035em", fontWeight: "600" }}>Put a finance team in your chat.</h2>
      <p style={{ margin: "0", fontSize: "16px", lineHeight: "24px", color: "#3A3A38" }}>Create your account and start asking in minutes.</p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", marginTop: "18px" }}>
      <Link href="/login" className="cta-dark" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", borderRadius: "999px", padding: "14px 24px" }}>Sign Up</Link>
      <Link href="/events" className="cta-light" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "999px", padding: "13px 24px" }}>Events</Link>
      </div>
      </div>
      </div>
      </section>
      {/* MEET FRAM (light card) */}
      <section onMouseMove={v.onMove2} onMouseEnter={v.onEnter2} onMouseLeave={v.onLeave2} onMouseDown={v.onDown2} style={{ background: "#FAFAF8", padding: "120px 16px 24px", overflowX: "clip" }}>
      <div className="fram-card" style={{ position: "relative", maxWidth: "1240px", margin: "0 auto", boxSizing: "border-box", background: "#EDEDED", border: "1px solid #E2E2DF", padding: "64px 56px", clipPath: "inset(-400px -400px 0 -400px)" }}>
      <div style={{ position: "relative", zIndex: "1", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(30px, 3vw, 40px)", lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "600", color: "#0A0A0A" }}>Ask Fremwork like you would ask a teammate.</h2>
      <p style={{ margin: "0", fontSize: "17px", lineHeight: "28px", color: "#5E5E5E" }}>Message it about cash, margin, spend or overdue invoices in plain language. Fremwork reads your figures, explains what changed and ends every answer with a recommendation you can act on.</p>
      <a href="#product" style={{ alignSelf: "flex-start", marginTop: "8px", color: "#0A0A0A", textDecoration: "none", fontSize: "15px", fontWeight: "500", borderBottom: "1px solid #0A0A0A", paddingBottom: "2px" }}>See how it works →</a>
      </div>
      <FramSvg f={v as FramFace} label="Fram, the Fremwork character, peeking in" className="fram-big" style={{ transform: `translate(${v.cardTx}px, ${v.cardTy}px) rotate(${v.cardRot}deg)`, transformOrigin: "50% 85%", transition: "transform 420ms cubic-bezier(.2,.8,.2,1)" }} bob />
      </div>
      </section>
      {/* FEATURES */}
      <section id="product" style={{ padding: "104px 16px 8px", scrollMarginTop: "110px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "16px 40px" }}>
      <h2 style={{ margin: "0", fontSize: "clamp(32px, 3.8vw, 52px)", lineHeight: "1.06", letterSpacing: "-0.035em", fontWeight: "600" }}>Everything your finance<br />team does, in one chat.</h2>
      <p style={{ margin: "0", maxWidth: "400px", fontSize: "16px", lineHeight: "26px", color: "#5E5E5E" }}>Ask in plain language. See the figure behind every answer. Leave with a next step.</p>
      </div>
      </section>
      {/* Product sections */}
      {(v.sections || []).map((p: any, p_i: number) => (<Fragment key={p_i}>
      <section id={`home-${p.id}`} style={{ padding: "48px 16px", scrollMarginTop: "110px" }}>
      <div style={{ maxWidth: "1120px", margin: "0 auto", display: "flex", flexWrap: "wrap", flexDirection: p.dir, alignItems: "center", gap: "40px 64px", borderTop: "1px solid #E6E6E3", paddingTop: "56px" }}>
      <div style={{ flex: "1 1 380px", minWidth: "0", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: "9px", background: p.color, boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}><span style={{ width: "3px", height: "9px", borderRadius: "2px", background: "#0A0A0A" }}></span><span style={{ width: "3px", height: "9px", borderRadius: "2px", background: "#0A0A0A" }}></span></span><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#5E5E5E" }}>{p.tag}</span></div>
      <h2 style={{ margin: "0", fontSize: "clamp(30px, 3.4vw, 44px)", lineHeight: "1.08", letterSpacing: "-0.03em", fontWeight: "600" }}>{p.name}</h2>
      <p style={{ margin: "0", maxWidth: "460px", fontSize: "17px", lineHeight: "27px", color: "#5E5E5E" }}>{p.desc}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
      {(p.points || []).map((pt: any, pt_i: number) => (<Fragment key={pt_i}>
      <span style={{ display: "flex", gap: "10px", fontSize: "15px", lineHeight: "22px" }}><span aria-hidden="true" style={{ color: "#127A4D", fontWeight: "700" }}>✓</span>{pt.text}</span>
      </Fragment>))}
      </div>
      <Link href="/login" className="mall" style={{ alignSelf: "flex-start", marginTop: "8px", fontSize: "14px", fontWeight: "600" }}>Sign Up →</Link>
      </div>
      <div aria-hidden="true" style={{ flex: "1 1 420px", minWidth: "0", background: "#FFFFFF", border: "1px solid #E6E6E3", borderRadius: "20px", padding: "22px", boxSizing: "border-box", minHeight: "320px", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "10px", boxShadow: "0 18px 44px rgba(10,10,10,0.06)" }}>
      <span style={{ alignSelf: "flex-start", marginBottom: "auto", fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: "0.08em", fontWeight: "500", color: "#8C8C8C" }}>ASK FREMWORK</span>
      {(p.chat || []).map((c: any, c_i: number) => (<Fragment key={c_i}>
      <div style={{ alignSelf: c.align, maxWidth: "80%", background: c.bg, color: c.color, borderRadius: c.radius, padding: "10px 14px", fontSize: "14px", lineHeight: "21px" }}>{c.text}</div>
      </Fragment>))}
      </div>
      </div>
      </section>
      </Fragment>))}
      <div style={{ height: "64px" }}></div>
      {/* SIGN UP CTA */}
      <section aria-labelledby="cta-title" style={{ padding: "72px 16px 104px" }}>
      <div style={{ position: "relative", maxWidth: "1180px", margin: "0 auto", overflow: "hidden", borderRadius: "24px", background: "#F1F1EC", border: "1px solid #E6E6E3", padding: "clamp(48px, 6vw, 80px) clamp(20px, 4vw, 56px)" }}>
      <div aria-hidden="true" className="pglow" style={{ position: "absolute", left: "12%", top: "8%", width: "76%", height: "110%", borderRadius: "50%", background: "radial-gradient(closest-side, rgba(198,244,50,0.75), rgba(198,244,50,0.25) 55%, rgba(198,244,50,0) 100%)", filter: "blur(34px)" }}></div>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", textAlign: "center" }}>
      <h2 id="cta-title" style={{ margin: "0", fontSize: "clamp(30px, 3.6vw, 48px)", lineHeight: "1.1", letterSpacing: "-0.035em", fontWeight: "600" }}>Put a finance team in your chat.</h2>
      <p style={{ margin: "0", fontSize: "16px", lineHeight: "24px", color: "#3A3A38" }}>Create your account and start asking in minutes.</p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px", marginTop: "18px" }}>
      <Link href="/login" className="cta-dark" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#FFFFFF", background: "#0A0A0A", borderRadius: "999px", padding: "14px 24px" }}>Sign Up</Link>
      <Link href="/events" className="cta-light" style={{ textDecoration: "none", fontSize: "15px", fontWeight: "500", color: "#0A0A0A", background: "#FFFFFF", border: "1px solid #E2E2DF", borderRadius: "999px", padding: "13px 24px" }}>Events</Link>
      </div>
      </div>
      </div>
      </section>
      {/* FOOTER */}
      <footer className="foot" style={{ borderTop: "1px solid #EDEDED", background: "#FFFFFF", padding: "40px 16px 0", overflow: "hidden" }}>
      <div style={{ maxWidth: "1280px", margin: "0 auto 36px", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: "16px" }}>
      <nav aria-label="Social media" style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a href="https://www.linkedin.com/company/fremworkhq/" target="_blank" rel="noopener noreferrer" className="social" aria-label="Fremwork on LinkedIn" style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #E6E6E3", borderRadius: "999px", padding: "8px 14px" }}>LinkedIn<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 7 L7 3 M3.5 3 H7 V6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"></path></svg></a>
      <a href="https://x.com/fremworkhq" target="_blank" rel="noopener noreferrer" className="social" aria-label="Fremwork on X" style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #E6E6E3", borderRadius: "999px", padding: "8px 14px" }}>X<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 7 L7 3 M3.5 3 H7 V6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"></path></svg></a>
      <a href="https://www.instagram.com/fremworkhq" target="_blank" rel="noopener noreferrer" className="social" aria-label="Fremwork on Instagram" style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #E6E6E3", borderRadius: "999px", padding: "8px 14px" }}>Instagram<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 7 L7 3 M3.5 3 H7 V6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"></path></svg></a>
      <a href="https://t.me/fremwork" target="_blank" rel="noopener noreferrer" className="social" aria-label="Fremwork on Telegram" style={{ display: "inline-flex", alignItems: "center", gap: "6px", textDecoration: "none", fontSize: "13px", fontWeight: "500", color: "#0A0A0A", background: "#FAFAF8", border: "1px solid #E6E6E3", borderRadius: "999px", padding: "8px 14px" }}>Telegram<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 7 L7 3 M3.5 3 H7 V6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"></path></svg></a>
      </nav>
      </div>
      <div style={{ maxWidth: "1280px", margin: "0 auto", height: "0.8em", overflow: "hidden", fontSize: "clamp(72px, 19.5vw, 280px)", lineHeight: "0.98", fontWeight: "600", letterSpacing: "-0.06em", textAlign: "center", whiteSpace: "nowrap", userSelect: "none", background: "linear-gradient(180deg, #B4B4B4 0%, #D9D9D9 45%, #FFFFFF 95%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Fremwork</div>
      </footer>
      <div className="tb-space" aria-hidden="true"></div>
      <nav className="tabbar" aria-label="Main">
      <Link href="/" className="tb" aria-current="page"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11 L12 4 L20.5 11 M5.5 9.5 V20 H18.5 V9.5 M10 20 V14.5 H14 V20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Home</span></Link>
      <Link href="/events" className="tb"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6 H19.5 V20 H4.5 Z M4.5 10.5 H19.5 M8.5 3.5 V7.5 M15.5 3.5 V7.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Events</span></Link>
      <Link href="/login" className="tb tb-join"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6 V18 M6 12 H18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Sign Up</span></Link>
      <Link href="/login" className="tb"><span className="tb-ic"><svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20.5a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"></path></svg></span><span>Log in</span></Link>
      </nav>
      </div>
      </div>
  );
}
