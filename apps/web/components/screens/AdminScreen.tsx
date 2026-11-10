'use client';

import { AdminEmailComposer } from '@/components/AdminEmailComposer';
import { Fragment } from 'react';
import Link from 'next/link';
import '@/styles/admin.css';
import { useCallback, useEffect, useRef, type ChangeEvent, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMergeState } from '@/components/fram/useMergeState';
import { api, downloadFromApi, type EventType } from '@/lib/api';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EMAIL_RE, formatShortDate, formatWhen, initials, timeAgo } from '@/lib/format';

type Status = 'waiting' | 'invited' | 'active';
interface Me { id: string; email: string; name: string; role: string; isAdmin: boolean }
interface WlEntry { id: number; name: string; email: string; company: string | null; role: string | null; status: Status; createdAt: string }
interface AdminEvent { id: string; type: EventType; title: string; description?: string; length: string; whenLabel: string | null; startsAt: string | null; location: string; capacity: number; published: boolean; registrations: number }
interface Reg { id: number; eventId: string; name: string; email: string; company: string | null; role: string | null; companySize: string | null; heardFrom: string | null; checkedIn: boolean }
interface Settings { acceptSignups: boolean; welcomeEmail: boolean; askCompany: boolean; alertInstant: boolean; alertDigest: boolean; notifyEmail: string; requiredFields: Record<string, boolean> }
interface Overview { weeks: number[]; activity: { kind: string; text: string; at: string }[] }
interface TeamMember { name: string; email: string; role: string }
interface Visitor { id: number; name: string | null; email: string | null; ip: string | null; userAgent: string | null; referrer: string | null; firstPath: string | null; lastPath: string | null; visits: number; firstSeen: string; lastSeen: string; country: string | null; region: string | null; city: string | null; source: string | null }

/** "Chrome · Windows" and "Desktop" from a user agent string. */
function device(ua: string | null) {
  const u = ua || '';
  const browser = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /SamsungBrowser/.test(u) ? 'Samsung Internet'
    : /Firefox\/|FxiOS/.test(u) ? 'Firefox' : /Chrome\/|CriOS/.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Other browser';
  const os = /Windows/.test(u) ? 'Windows' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android'
    : /Mac OS X|Macintosh/.test(u) ? 'macOS' : /CrOS/.test(u) ? 'ChromeOS' : /Linux/.test(u) ? 'Linux' : 'Other';
  const kind = /iPad|Tablet/.test(u) ? 'Tablet' : /Mobi|iPhone|Android/.test(u) ? 'Phone' : 'Desktop';
  return { browser, os, kind };
}
/** "Ethiopia" from "ET". */
function countryName(code: string | null) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return 'Unknown';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
/** Flag image (emoji flags do not show on Windows). */
const flagUrl = (code: string | null) => (code && /^[A-Z]{2}$/.test(code) ? `https://flagcdn.com/20x15/${code.toLowerCase()}.png` : '');
/** How someone found the site: "Google search", "LinkedIn", "Direct" … */
function sourceOf(referrer: string | null, utm: string | null) {
  const h = host(referrer);
  const known: [RegExp, string][] = [
    [/(^|\.)google\./, 'Google search'], [/(^|\.)bing\.com$/, 'Bing search'], [/duckduckgo\.com$/, 'DuckDuckGo search'],
    [/(^|\.)yahoo\./, 'Yahoo search'], [/yandex\./, 'Yandex search'], [/(^|\.)baidu\.com$/, 'Baidu search'],
    [/linkedin\.com$|lnkd\.in$/, 'LinkedIn'], [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram'], [/(^|\.)(x|twitter)\.com$|^t\.co$/, 'X'],
    [/instagram\.com$/, 'Instagram'], [/facebook\.com$|fb\.com$/, 'Facebook'], [/youtube\.com$/, 'YouTube'],
    [/(chatgpt\.com|openai\.com|claude\.ai|perplexity\.ai)$/, 'AI assistant'],
  ];
  if (h) return known.find(([re]) => re.test(h))?.[1] || h;
  if (utm) return utm.charAt(0).toUpperCase() + utm.slice(1);
  return 'Direct';
}
const host = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

const ROLES = ['Business owner', 'Finance officer', 'Analyst', 'Accountant', 'Manager', 'Other'];
const FORM_FIELDS = [
  { id: 'name', label: 'Full name', kind: 'TEXT', locked: true },
  { id: 'email', label: 'Email', kind: 'EMAIL', locked: true },
  { id: 'company', label: 'Company', kind: 'TEXT' },
  { id: 'role', label: 'What is your role?', kind: 'LIST' },
  { id: 'size', label: 'Company size', kind: 'LIST' },
  { id: 'heard', label: 'How did you hear about this event?', kind: 'LIST' },
];
const GLOW: Record<string, string> = { WEBINAR: 'rgba(198,244,50,0.9)', WORKSHOP: 'rgba(143,162,255,0.8)', MEETUP: 'rgba(245,165,36,0.7)', 'OFFICE HOURS': 'rgba(180,180,175,0.7)' };
const AVA = ['#C6F432', '#8FA2FF', '#1FA97133', '#EDEDED', '#F5A52455', '#E5484D33'];
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'M4 13h6V4H4z M14 20h6v-9h-6z M14 4h6v4h-6z M4 20h6v-3H4z' },
  { id: 'waitlist', label: 'Waitlist', icon: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M21 19v-1a4 4 0 0 0-3-3.9 M15.5 4.1a3 3 0 0 1 0 5.8' },
  { id: 'events', label: 'Events', icon: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M4 10h16 M8 3v4 M16 3v4' },
  { id: 'regs', label: 'Registrations', icon: 'M9 5h10 M9 12h10 M9 19h10 M4.5 5l1 1 2-2 M4.5 12l1 1 2-2 M4.5 19l1 1 2-2' },
  { id: 'visitors', label: 'Visitors', icon: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
] as const;
type Tab = (typeof TABS)[number]['id'];
const HEAD: Record<Tab, [string, string]> = {
  overview: ['Overview', 'How the waitlist and events are doing at a glance.'],
  waitlist: ['Waitlist', 'Everyone who joined from the website. Invite them when you are ready.'],
  events: ['Events', 'Create, publish and track the events on your Events page.'],
  regs: ['Registrations', 'Everyone who registered for an event, with their answers.'],
  visitors: ['Visitors', 'Everyone who opened the website, signed in or not. Each person counts once, so refreshing does not add to the total. Your team is not counted.'],
  settings: ['Settings', 'Waitlist, registration form, alerts and team.'],
};
const LABEL: Record<Status, 'Waiting' | 'Invited' | 'Active'> = { waiting: 'Waiting', invited: 'Invited', active: 'Active' };
const STATUS = {
  Waiting: { bg: '#F0F0ED', color: '#3A3A3A', dot: '#8C8C8C' },
  Invited: { bg: '#3D5AFE14', color: '#2A3FCC', dot: '#3D5AFE' },
  Active: { bg: '#1FA97118', color: '#137A50', dot: '#1FA971' },
};
const DOT: Record<string, string> = { waitlist: '#C6F432', registration: '#F5A524', invite: '#3D5AFE', event: '#1FA971', active: '#1FA971' };
const RANGES = [
  { id: 'day', label: 'Today', note: 'Today, by hour' },
  { id: '7', label: '7 days', note: 'Last 7 days' },
  { id: '15', label: '15 days', note: 'Last 15 days' },
  { id: '30', label: '30 days', note: 'Last 30 days' },
  { id: '60', label: '60 days', note: 'Last 60 days' },
] as const;
type Range = (typeof RANGES)[number]['id'];

/** Sign-ups bucketed by hour (today) or by day (last N days), in the admin's time zone. */
function signupBuckets(dates: string[], range: Range) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const md = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  if (range === 'day') {
    const start = startOfDay(now).getTime();
    const counts = Array(24).fill(0) as number[];
    dates.forEach((iso) => { const t = new Date(iso).getTime(); if (t >= start) counts[new Date(t).getHours()]++; });
    return counts.map((n, h) => ({ n, label: String(h).padStart(2, '0'), tip: `${String(h).padStart(2, '0')}:00`, show: h % 6 === 0 }));
  }
  const days = Number(range);
  const first = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
  const counts = Array(days).fill(0) as number[];
  dates.forEach((iso) => {
    const i = Math.round((startOfDay(new Date(iso)).getTime() - first.getTime()) / 864e5);
    if (i >= 0 && i < days) counts[i]++;
  });
  const every = days <= 7 ? 1 : days <= 15 ? 3 : days <= 30 ? 5 : 10;
  return counts.map((n, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    const label = days <= 7 ? d.toLocaleDateString('en-US', { weekday: 'short' }) : md(d);
    return { n, label, tip: d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }), show: (days - 1 - i) % every === 0 };
  });
}

const sw = (on: boolean) => ({ on: on ? 'true' : 'false', bg: on ? '#0A0A0A' : '#D6D6D2', left: on ? '19px' : '3px' });
const DEFAULT_SETTINGS: Settings = { acceptSignups: true, welcomeEmail: true, askCompany: true, alertInstant: true, alertDigest: false, notifyEmail: '', requiredFields: { name: true, email: true } };

/** Pre-fills the event panel for editing (date and time in the admin's local time zone). */
function editForm(e: AdminEvent): Record<string, string> {
  const d = e.startsAt ? new Date(e.startsAt) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id: e.id, title: e.title, type: e.type, desc: e.description || '', length: e.length || '',
    where: e.location, cap: String(e.capacity),
    date: d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '',
    time: d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '',
  };
}

/** Admin · ported from Admin.dc.html. Every list and action goes through the NestJS admin API. */
export function AdminScreen() {
  const router = useRouter();
  const [s, set, get] = useMergeState({
    emailOpen: false, emailRecipients: [] as string[],
    tab: 'overview' as Tab, q: '', wlFilter: 'All', sel: {} as Record<number, boolean>, regEv: 'all',
    me: null as Me | null, denied: false, loading: true,
    wl: [] as WlEntry[], events: [] as AdminEvent[], regs: [] as Reg[], overview: { weeks: [], activity: [] } as Overview,
    settings: DEFAULT_SETTINGS, team: [] as TeamMember[], visitors: [] as Visitor[],
    notifyEmail: '', inviteEmail: '', inviteErr: '', dirty: false,
    range: '30' as Range, drawer: false, ne: {} as Record<string, string>, neErr: '', toast: '',
  });
  const toastT = useRef(0);

  const flash = useCallback((msg: string) => {
    clearTimeout(toastT.current);
    set({ toast: msg });
    toastT.current = window.setTimeout(() => set({ toast: '' }), 2400);
  }, [set]);
  const fail = (err: unknown) => flash((err as Error).message || 'Something went wrong');

  const load = useCallback(async () => {
    try {
      const me = await api<Me>('/me', { auth: true });
      if (!me.isAdmin) return set({ me, denied: true, loading: false });
      const [overview, wl, events, regs, settings, team] = await Promise.all([
        api<Overview>('/admin/overview', { auth: true }),
        api<WlEntry[]>('/admin/waitlist', { auth: true }),
        api<AdminEvent[]>('/admin/events', { auth: true }),
        api<Reg[]>('/admin/registrations', { auth: true }),
        api<Settings>('/admin/settings', { auth: true }),
        api<TeamMember[]>('/admin/team', { auth: true }),
      ]);
      set({ me, overview, wl, events, regs, settings, team, notifyEmail: settings.notifyEmail || '', loading: false });
      api<Visitor[]>('/admin/visitors', { auth: true }).then((visitors) => set({ visitors }), () => undefined);
      const editId = new URLSearchParams(window.location.search).get('edit');
      const toEdit = editId ? events.find((e) => e.id === editId) : undefined;
      if (toEdit) set({ tab: 'events', drawer: true, neErr: '', ne: editForm(toEdit) });
    } catch (err) {
      set({ loading: false });
      fail(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);

  useEffect(() => { load(); return () => clearTimeout(toastT.current); }, [load]);

  const tab = s.tab;
  const evById: Record<string, AdminEvent> = Object.fromEntries(s.events.map((e) => [e.id, e]));
  const go = (t: Tab, extra: Partial<typeof s> = {}) => () => set({ tab: t, q: '', ...extra });
  const counts = { Waiting: 0, Invited: 0, Active: 0 };
  s.wl.forEach((r) => counts[LABEL[r.status]]++);
  const totalRegs = s.events.reduce((t, e) => t + e.registrations, 0);
  const published = s.events.filter((e) => e.published).length;
  const dash = (n: number) => (s.loading ? '–' : String(n));

  const q = s.q.toLowerCase();
  const shown = s.wl.filter((r) => {
    if (s.wlFilter !== 'All' && LABEL[r.status] !== s.wlFilter) return false;
    return !q || `${r.name} ${r.email} ${r.company ?? ''} ${r.role ?? ''}`.toLowerCase().includes(q);
  });
  const regs = s.regs.filter((r) => {
    if (s.regEv !== 'all' && r.eventId !== s.regEv) return false;
    return !q || `${r.name} ${r.email} ${r.company ?? ''}`.toLowerCase().includes(q);
  });
  const vq = s.visitors.filter((r) => !q || `${r.name ?? ''} ${r.email ?? ''} ${r.ip ?? ''} ${r.userAgent ?? ''} ${r.referrer ?? ''} ${r.lastPath ?? ''} ${countryName(r.country)} ${r.city ?? ''} ${sourceOf(r.referrer, r.source)}`.toLowerCase().includes(q));
  const tally = (keys: string[], flags?: Record<string, string>) => {
    const m: Record<string, number> = {};
    keys.forEach((k) => { m[k] = (m[k] || 0) + 1; });
    const rows = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const top = Math.max(1, ...rows.map((r) => r[1]));
    return rows.map(([label, n]) => ({ label, n, flag: flags?.[label] || '', w: Math.round((n / top) * 100) + '%' }));
  };
  const dayAgo = Date.now() - 864e5, weekAgo = Date.now() - 7 * 864e5;
  const selIds = Object.keys(s.sel).filter((k) => s.sel[+k]).map(Number);

  const invite = async (ids: number[]) => {
    // Invite emails are sent by the API with the service-role key. The direct Supabase fallback can only
    // flip the status, which would report "Invites sent" when nothing was sent, so it is not used here.
    const res = await api<{ invited: number; entries: WlEntry[] }>('/admin/waitlist/invite', { method: 'POST', auth: true, fallback: false, body: { ids } });
    const byId = Object.fromEntries(res.entries.map((e) => [e.id, e]));
    set({ wl: get().wl.map((r) => byId[r.id] || r) });
    return res.invited;
  };

  const saveSettings = async () => {
    const st = get();
    if (!st.dirty) return;
    try {
      const settings = await api<Settings>('/admin/settings', { method: 'PUT', auth: true, body: { ...st.settings, notifyEmail: st.notifyEmail.trim() } });
      set({ settings, dirty: false });
      flash('Settings saved');
    } catch (err) { fail(err); }
  };

  const buckets = signupBuckets(s.wl.map((r) => r.createdAt), s.range);
  const bmax = Math.max(1, ...buckets.map((b) => b.n));
  const rangeNote = RANGES.find((r) => r.id === s.range)!.note;
  const rc: Record<string, number> = {};
  s.wl.forEach((r) => { if (r.role) rc[r.role] = (rc[r.role] || 0) + 1; });
  const rmax = Math.max(1, ...ROLES.map((r) => rc[r] || 0));

  type Flag = 'acceptSignups' | 'welcomeEmail' | 'askCompany' | 'alertInstant' | 'alertDigest';
  const opt = (k: Flag, label: string, note: string) => {
    const t = sw(s.settings[k]);
    const toggle = () => {
      const next: Settings = { ...get().settings };
      next[k] = !next[k];
      set({ settings: next, dirty: true });
    };
    return { label, note, on: t.on, bg: t.bg, left: t.left, toggle };
  };

  // Template bindings for the ported markup (values mirror the design file's renderVals).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: Record<string, any> = {
    nav: TABS.map((t) => {
      const on = t.id === tab;
      const count = t.id === 'waitlist' ? String(s.wl.length) : t.id === 'events' ? String(s.events.length) : t.id === 'regs' ? String(totalRegs) : t.id === 'visitors' ? String(s.visitors.length) : '';
      return {
        label: t.label, short: t.id === 'regs' ? 'Sign-ups' : t.label, icon: t.icon, go: go(t.id), count: s.loading ? '' : count,
        current: on ? 'page' : 'false', selected: on ? 'true' : 'false',
        bg: on ? '#FFFFFF' : 'transparent', weight: on ? '600' : '400',
        chipBg: on ? '#0A0A0A' : '#FFFFFF', chipColor: on ? '#FFFFFF' : '#0A0A0A', chipBorder: on ? '#0A0A0A' : '#E2E2DF',
      };
    }),
    meName: s.me?.name || s.me?.email || '…', meIni: initials(s.me?.name || s.me?.email || '?'), meRole: s.me ? s.me.role.charAt(0).toUpperCase() + s.me.role.slice(1) : '',
    onLogout: async (e: MouseEvent) => {
      e.preventDefault();
      await getSupabaseBrowserClient().auth.signOut();
      router.push('/login');
      router.refresh();
    },
    crumb: 'ADMIN / ' + HEAD[tab][0].toUpperCase(),
    title: HEAD[tab][0], subtitle: HEAD[tab][1],
    isOverview: tab === 'overview', isWaitlist: tab === 'waitlist', isEvents: tab === 'events', isRegs: tab === 'regs', isVisitors: tab === 'visitors', isSettings: tab === 'settings',
    showSearch: tab === 'waitlist' || tab === 'regs' || tab === 'visitors',
    searchPh: tab === 'regs' ? 'Search attendees' : tab === 'visitors' ? 'Search name, email, IP, country' : 'Search name, email, company',
    q: s.q, onQ: (e: ChangeEvent<HTMLInputElement>) => set({ q: e.target.value }),
    showExport: tab === 'overview' || tab === 'waitlist' || tab === 'regs',
    showNewEvent: tab === 'events', showSave: tab === 'settings',
    saveLabel: s.dirty ? 'Save changes' : 'Saved',
    acceptWord: s.settings.acceptSignups ? 'open' : 'closed',
    acceptNote: s.settings.acceptSignups ? 'are being accepted' : 'are paused',
    goEvents: go('events'),
    onExport: async () => {
      try {
        if (tab === 'regs') {
          const p = new URLSearchParams({ eventId: s.regEv, q: s.q });
          await downloadFromApi(`/admin/registrations/export?${p}`, 'fremwork-registrations.csv');
          flash('Downloaded fremwork-registrations.csv');
        } else {
          const p = tab === 'waitlist' ? new URLSearchParams({ status: s.wlFilter, q: s.q }) : new URLSearchParams();
          await downloadFromApi(`/admin/waitlist/export?${p}`, 'fremwork-waitlist.csv');
          flash('Downloaded fremwork-waitlist.csv');
        }
      } catch (err) { fail(err); }
    },
    onNewEvent: () => set({ drawer: true, ne: { type: 'WEBINAR', where: 'Online', cap: '100', length: '60 min' }, neErr: '' }),
    onSave: saveSettings,
    toast: s.toast,

    // Overview
    stats: [
      { label: 'Waitlist sign-ups', value: dash(s.wl.length), note: counts.Waiting + ' waiting for an invite', dot: '#C6F432', go: go('waitlist') },
      { label: 'Invites sent', value: dash(counts.Invited + counts.Active), note: counts.Active + ' already active', dot: '#3D5AFE', go: go('waitlist', { wlFilter: 'Invited' }) },
      { label: 'Event registrations', value: dash(totalRegs), note: 'Across ' + s.events.length + ' events', dot: '#F5A524', go: go('regs') },
      { label: 'Published events', value: dash(published), note: s.events.length - published + ' in draft', dot: '#1FA971', go: go('events') },
    ],
    weeks: buckets.map((b) => ({ v: b.n, label: b.label, tip: b.tip, labelVis: b.show ? 'visible' : 'hidden', h: Math.max(4, Math.round((b.n / bmax) * 150)) + 'px' })),
    weekTotal: buckets.reduce((a, b) => a + b.n, 0),
    weekNote: rangeNote,
    barGap: buckets.length > 30 ? '2px' : buckets.length > 15 ? '4px' : '10px',
    weekAria: `Bar chart of waitlist sign-ups, ${rangeNote.toLowerCase()}: ` + buckets.map((b) => `${b.tip} ${b.n}`).join(', '),
    ranges: RANGES.map((r) => {
      const on = r.id === s.range;
      return { label: r.label, pick: () => set({ range: r.id }), pressed: on ? 'true' : 'false',
        bg: on ? '#0A0A0A' : '#FFFFFF', color: on ? '#FFFFFF' : '#0A0A0A', border: on ? '#0A0A0A' : '#E2E2DF' };
    }),
    roleMix: ROLES.map((r) => ({ role: r, n: rc[r] || 0, w: Math.round(((rc[r] || 0) / rmax) * 100) + '%' })).sort((a, b) => b.n - a.n),
    upcoming: s.events.filter((e) => e.published).slice(0, 4).map((e) => ({
      title: e.title, type: e.type.charAt(0) + e.type.slice(1).toLowerCase(), when: formatWhen(e.startsAt, e.whenLabel),
      count: e.registrations, cap: e.capacity, pct: Math.min(100, Math.round((e.registrations / e.capacity) * 100)) + '%',
    })),
    activity: s.overview.activity.map((a) => ({ text: a.text, when: timeAgo(a.at), dot: DOT[a.kind] || '#8C8C8C' })),

    // Waitlist
    wlFilters: ['All', 'Waiting', 'Invited', 'Active'].map((f) => {
      const on = s.wlFilter === f;
      return { label: f, n: f === 'All' ? s.wl.length : counts[f as keyof typeof counts], pressed: on ? 'true' : 'false',
        bg: on ? '#0A0A0A' : '#FFFFFF', color: on ? '#FFFFFF' : '#0A0A0A', border: on ? '#0A0A0A' : '#E2E2DF',
        go: () => set({ wlFilter: f, sel: {} }) };
    }),
    selCount: selIds.length || '',
    allSel: shown.length > 0 && shown.every((r) => s.sel[r.id]),
    onSelAll: (e: ChangeEvent<HTMLInputElement>) => {
      const sel = { ...get().sel };
      shown.forEach((r) => { sel[r.id] = e.target.checked; });
      set({ sel });
    },
    onClearSel: () => set({ sel: {} }),
    onInviteSel: async () => {
      try {
        const n = await invite(selIds);
        set({ sel: {} });
        flash(n ? `Invites sent to ${n}${n === 1 ? ' person' : ' people'}` : 'Everyone selected was already invited');
      } catch (err) { fail(err); }
    },
    wlEmpty: !s.loading && shown.length === 0,
    wlRows: shown.map((r) => {
      const label = LABEL[r.status];
      const st = STATUS[label];
      return {
        ...r, company: r.company || '—', role: r.role || '—', status: label, joined: formatShortDate(r.createdAt),
        ini: initials(r.name), avaBg: AVA[r.id % AVA.length], sel: !!s.sel[r.id], selLabel: 'Select ' + r.name,
        toggle: (e: ChangeEvent<HTMLInputElement>) => set({ sel: { ...get().sel, [r.id]: e.target.checked } }),
        stBg: st.bg, stColor: st.color, stDot: st.dot,
        actLabel: label === 'Waiting' ? 'Invite' : label === 'Invited' ? 'Resend' : 'View',
        act: async () => {
          try {
            if (label === 'Active') return flash(r.name + ' is an active user');
            await invite([r.id]);
            flash((label === 'Invited' ? 'Invite sent again to ' : 'Invite sent to ') + r.email);
          } catch (err) { fail(err); }
        },
      };
    }),

    // Events
    evCards: s.events.map((e) => ({
      type: e.type, length: e.length, title: e.title, when: formatWhen(e.startsAt, e.whenLabel), where: e.location, cap: e.capacity, count: e.registrations,
      pct: Math.min(100, Math.round((e.registrations / e.capacity) * 100)) + '%', glow: GLOW[e.type] || GLOW.WEBINAR,
      status: e.published ? 'Published' : 'Draft',
      stBg: e.published ? '#1FA97118' : '#F0F0ED', stColor: e.published ? '#137A50' : '#3A3A3A', stDot: e.published ? '#1FA971' : '#8C8C8C',
      pubLabel: e.published ? 'Unpublish' : 'Publish', pubClass: e.published ? 'btn-line' : 'btn-dark',
      viewRegs: go('regs', { regEv: e.id }),
      togglePub: async () => {
        try {
          const upd = await api<AdminEvent>(`/admin/events/${e.id}`, { method: 'PATCH', auth: true, body: { published: !e.published } });
          set({ events: get().events.map((x) => (x.id === e.id ? upd : x)) });
          flash(e.published ? e.title + ' moved to draft' : e.title + ' is live on the Events page');
        } catch (err) { fail(err); }
      },
      edit: () => set({ drawer: true, neErr: '', ne: editForm(e) }),
      remove: async () => {
        const regsNote = e.registrations ? ` Its ${e.registrations} registration${e.registrations === 1 ? '' : 's'} will be deleted too.` : '';
        if (!window.confirm(`Delete "${e.title}"? This cannot be undone.${regsNote}`)) return;
        try {
          await api(`/admin/events/${e.id}`, { method: 'DELETE', auth: true });
          set({ events: get().events.filter((x) => x.id !== e.id), regs: get().regs.filter((r) => r.eventId !== e.id) });
          flash(e.title + ' was deleted');
        } catch (err) { fail(err); }
      },
    })),
    drawer: s.drawer,
    ne: s.ne,
    neErr: s.neErr,
    neTitleBorder: s.neErr ? '#B42318' : '#E2E2DF',
    typeOptions: ['WEBINAR', 'WORKSHOP', 'MEETUP', 'OFFICE HOURS'].map((t) => ({ v: t })),
    neSet: Object.fromEntries(['title', 'type', 'date', 'time', 'where', 'cap', 'desc', 'length'].map((k) => [k,
      (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set({ ne: { ...get().ne, [k]: e.target.value }, neErr: k === 'title' ? '' : get().neErr }),
    ])) as Record<'title' | 'type' | 'date' | 'time' | 'where' | 'cap' | 'desc' | 'length', (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void>,
    stop: (e: MouseEvent) => e.stopPropagation(),
    onCloseDrawer: () => set({ drawer: false }),
    drawerTitle: s.ne.id ? 'Edit event' : 'New event',
    drawerNote: s.ne.id ? 'Changes go live on the Events page as soon as you save.' : 'It is saved as a draft. Publish it from the Events list when it is ready.',
    drawerAction: s.ne.id ? 'Save changes' : 'Create draft',
    onCreateEvent: async () => {
      const ne = get().ne;
      if (!(ne.title || '').trim()) return set({ neErr: 'Give the event a title.' });
      const startsAt = ne.date ? new Date(`${ne.date}T${ne.time || '09:00'}`).toISOString() : undefined;
      const body = {
        title: ne.title.trim(), type: ne.type || 'WEBINAR', startsAt, location: ne.where || 'Online',
        capacity: Math.max(1, parseInt(ne.cap, 10) || 100),
        description: (ne.desc || '').trim(), length: (ne.length || '').trim() || '60 min',
      };
      try {
        if (ne.id) {
          const ev = await api<AdminEvent>(`/admin/events/${ne.id}`, { method: 'PATCH', auth: true, body });
          set({ events: get().events.map((x) => (x.id === ne.id ? ev : x)), drawer: false });
          flash(ev.title + ' was updated');
        } else {
          const ev = await api<AdminEvent>('/admin/events', { method: 'POST', auth: true, body: { ...body, description: body.description || undefined } });
          set({ events: [ev, ...get().events], drawer: false });
          flash('Draft created. Publish it when you are ready.');
        }
      } catch (err) { fail(err); }
    },

    // Registrations
    regEv: s.regEv,
    onRegEv: (e: ChangeEvent<HTMLSelectElement>) => set({ regEv: e.target.value }),
    evOptions: [{ v: 'all', label: 'All events' }, ...s.events.map((e) => ({ v: e.id, label: e.title }))],
    regSummary: `${regs.length} shown · ${regs.filter((r) => r.checkedIn).length} checked in`,
    regEmpty: !s.loading && regs.length === 0,
    regRows: regs.map((r) => {
      const t = sw(r.checkedIn);
      return {
        name: r.name, email: r.email, company: r.company || '—', role: r.role || '—', size: r.companySize || '—', heard: r.heardFrom || '—',
        ini: initials(r.name), avaBg: AVA[r.id % AVA.length], event: evById[r.eventId]?.title || '',
        on: t.on, swBg: t.bg, swLeft: t.left, swLabel: 'Checked in: ' + r.name,
        toggle: async () => {
          const flip = (x: Reg) => (x.id === r.id ? { ...x, checkedIn: !r.checkedIn } : x);
          set({ regs: get().regs.map(flip) });
          try {
            await api(`/admin/registrations/${r.id}`, { method: 'PATCH', auth: true, body: { checkedIn: !r.checkedIn } });
          } catch (err) {
            set({ regs: get().regs.map((x) => (x.id === r.id ? { ...x, checkedIn: r.checkedIn } : x)) });
            fail(err);
          }
        },
      };
    }),

    // Visitors
    vStats: [
      { label: 'Unique visitors', value: dash(s.visitors.length), note: 'All time, one per person', dot: '#C6F432' },
      { label: 'Known by name', value: dash(s.visitors.filter((r) => r.name || r.email).length), note: 'Joined the waitlist, registered or signed in', dot: '#3D5AFE' },
      { label: 'Active today', value: dash(s.visitors.filter((r) => +new Date(r.lastSeen) > dayAgo).length), note: 'Last 24 hours', dot: '#F5A524' },
      { label: 'New this week', value: dash(s.visitors.filter((r) => +new Date(r.firstSeen) > weekAgo).length), note: 'First visit in the last 7 days', dot: '#1FA971' },
    ],
    vCountries: tally(vq.map((r) => countryName(r.country)), Object.fromEntries(vq.map((r) => [countryName(r.country), flagUrl(r.country)]))),
    vSources: tally(vq.map((r) => sourceOf(r.referrer, r.source))),
    vSummary: `${vq.length} shown · ${vq.reduce((t, r) => t + r.visits, 0)} visits`,
    vEmpty: !s.loading && vq.length === 0,
    vRows: vq.map((r) => {
      const d = device(r.userAgent);
      const from = sourceOf(r.referrer, r.source);
      return {
        who: r.name || r.email || 'Anonymous visitor', ip: r.ip || 'IP unknown', sub: r.name && r.email ? r.email : '',
        ini: r.name ? initials(r.name) : r.email ? initials(r.email.split('@')[0]) : '?',
        avaBg: r.name || r.email ? AVA[r.id % AVA.length] : '#EDEDED',
        browser: `${d.browser} · ${d.os}`, kind: d.kind,
        from, page: r.firstPath || '/',
        country: countryName(r.country), flag: flagUrl(r.country), place: [r.city, r.region && !/^\d+$/.test(r.region) ? r.region : null].filter(Boolean).join(', ') || '—',
        visits: r.visits, visitsLabel: r.visits === 1 ? "1 visit" : `${r.visits} visits`, seen: timeAgo(r.lastSeen), first: formatShortDate(r.firstSeen),
      };
    }),

    // Settings
    wlToggles: [
      opt('acceptSignups', 'Accept new sign-ups', 'Turn off to pause the waitlist form.'),
      opt('welcomeEmail', 'Send a welcome email', 'Sent right after someone joins.'),
      opt('askCompany', 'Ask for company name', 'Shows the Company field on the form.'),
    ],
    notifToggles: [
      opt('alertInstant', 'Alert me on every sign-up', 'One email per new person.'),
      opt('alertDigest', 'Daily summary', 'One email each morning instead.'),
    ],
    notifyEmail: s.notifyEmail,
    onNotify: (e: ChangeEvent<HTMLInputElement>) => set({ notifyEmail: e.target.value, dirty: true }),
    formRows: FORM_FIELDS.map((f) => {
      const on = !!f.locked || !!s.settings.requiredFields[f.id];
      const t = sw(on);
      return { label: f.label, kind: f.kind, on: t.on, bg: t.bg, left: t.left, locked: !!f.locked, swLabel: f.label + ' required',
        toggle: () => {
          if (f.locked) return;
          const st = get().settings;
          set({ settings: { ...st, requiredFields: { ...st.requiredFields, [f.id]: !st.requiredFields[f.id] } }, dirty: true });
        } };
    }),
    team: s.team.map((m, i) => ({ ...m, role: m.role.charAt(0).toUpperCase() + m.role.slice(1), ini: initials(m.name || m.email), bg: i === 0 ? '#0A0A0A' : '#EDEDED', fg: i === 0 ? '#FFFFFF' : '#0A0A0A' })),
    inviteEmail: s.inviteEmail,
    inviteErr: s.inviteErr,
    onInviteEmail: (e: ChangeEvent<HTMLInputElement>) => set({ inviteEmail: e.target.value, inviteErr: '' }),
    onInviteTeam: async () => {
      const em = get().inviteEmail.trim();
      if (!EMAIL_RE.test(em)) return set({ inviteErr: 'Enter a valid email address.' });
      try {
        // Needs the API: only it can send the Supabase invite email (see waitlist invite above).
        const m = await api<TeamMember>('/admin/team/invite', { method: 'POST', auth: true, fallback: false, body: { email: em } });
        set({ team: [...get().team.filter((x) => x.email !== m.email), m], inviteEmail: '' });
        flash('Invite sent to ' + em);
      } catch (err) { set({ inviteErr: (err as Error).message }); }
    },
  };

  if (s.denied) {
    return (
      <div className="pg-admin">
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Geist', system-ui, sans-serif", background: '#F4F4F2' }}>
          <div className="card" style={{ maxWidth: 420, padding: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 12, color: '#5E5E5E' }}>ADMIN</span>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em' }}>You do not have access yet.</h1>
            <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: '#5E5E5E' }}>Signed in as {s.me?.email}. Ask an owner to invite you from Admin › Settings › Team.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <Link href="/" className="btn btn-dark">Back to home</Link>
              <button type="button" className="btn btn-line" onClick={v.onLogout}>Log out</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
      <div className="pg-admin">
      <div className="adm">
      {/* Sidebar (desktop) */}
      <aside className="side" aria-label="Admin navigation">
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", color: "#0A0A0A", padding: "4px 8px 16px" }}>
      <span aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: "9px", background: "#C6F432", boxShadow: "inset 0 0 0 1px rgba(10,10,10,0.08)", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}><span style={{ width: "4px", height: "10px", borderRadius: "3px", background: "#0A0A0A" }}></span><span style={{ width: "4px", height: "10px", borderRadius: "3px", background: "#0A0A0A" }}></span></span>
      <span style={{ fontSize: "17px", fontWeight: "600", letterSpacing: "-0.02em" }}>Fremwork</span>
      <span style={{ marginLeft: "auto", fontFamily: "'Geist Mono', monospace", fontSize: "11px", color: "#5E5E5E", border: "1px solid #DCDCD8", borderRadius: "999px", padding: "2px 8px" }}>ADMIN</span>
      </Link>
      <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {(v.nav || []).map((n: any, n_i: number) => (<Fragment key={n_i}>
      <button type="button" className="navbtn" onClick={n.go} aria-current={n.current} style={{ background: n.bg, color: "#0A0A0A", fontWeight: n.weight }}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0A0A0A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon}></path></svg>
      <span style={{ flex: "1" }}>{n.label}</span>
      {n.count ? (<><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: "#5E5E5E" }}>{n.count}</span></>) : null}
      </button>
      </Fragment>))}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="card" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
      <span style={{ fontSize: "13px", fontWeight: "600" }}>Waitlist is {v.acceptWord}</span>
      <span style={{ fontSize: "12px", color: "#5E5E5E", lineHeight: "1.45" }}>New sign-ups {v.acceptNote}. Change this in Settings.</span>
      </div>
      <Link href="/" className="navbtn" style={{ textDecoration: "none", color: "#0A0A0A", background: "transparent" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0A0A0A" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>View website</Link>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 8px 2px", borderTop: "1px solid #E4E4E1" }}>
      <span className="ava" style={{ background: "#0A0A0A", color: "#FFFFFF" }}>{v.meIni}</span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: "0" }}><span style={{ fontSize: "14px", fontWeight: "500" }}>{v.meName}</span><span style={{ fontSize: "12px", color: "#5E5E5E" }}>{v.meRole}</span></span>
      <Link href="/login" onClick={v.onLogout} aria-label="Log out" style={{ marginLeft: "auto", display: "flex", padding: "6px", borderRadius: "8px" }}>
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#5E5E5E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3 M10 16l-4-4 4-4 M6 12h10"></path></svg></Link>
      </div>
      </div>
      </aside>
      <div style={{ minWidth: "0" }}>
      {/* Top bar (phone) */}
      <div className="mtop">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px 8px" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "9px", textDecoration: "none", color: "#0A0A0A" }}>
      <span aria-hidden="true" style={{ width: "28px", height: "28px", borderRadius: "8px", background: "#C6F432", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}><span style={{ width: "4px", height: "9px", borderRadius: "3px", background: "#0A0A0A" }}></span><span style={{ width: "4px", height: "9px", borderRadius: "3px", background: "#0A0A0A" }}></span></span>
      <span style={{ fontSize: "16px", fontWeight: "600", letterSpacing: "-0.02em" }}>Fremwork</span></Link>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", color: "#5E5E5E", border: "1px solid #DCDCD8", borderRadius: "999px", padding: "2px 8px" }}>ADMIN</span>
      <span className="ava" style={{ marginLeft: "auto", width: "30px", height: "30px", background: "#0A0A0A", color: "#FFFFFF" }}>{v.meIni}</span>
      </div>
      <div className="tabs-sc" role="tablist" aria-label="Admin sections" style={{ display: "flex", gap: "6px", overflowX: "auto", padding: "4px 16px 12px", scrollbarWidth: "none" }}>
      {(v.nav || []).map((n: any, n_i: number) => (<Fragment key={n_i}>
      <button type="button" role="tab" className="chip" onClick={n.go} aria-selected={n.selected} style={{ background: n.chipBg, color: n.chipColor, border: `1px solid ${n.chipBorder}` }}>{n.label}</button>
      </Fragment>))}
      </div>
      </div>
      <main className="main">
      <div className="head">
      <div>
      <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: "12px", color: "#5E5E5E", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>{v.crumb}</div>
      <h1 style={{ margin: "0", fontSize: "34px", fontWeight: "600", letterSpacing: "-0.03em", lineHeight: "1.1" }}>{v.title}</h1>
      <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#5E5E5E" }}>{v.subtitle}</p>
      </div>
      <AdminEmailComposer open={s.emailOpen} initialEmails={s.emailRecipients} onClose={() => set({ emailOpen: false })} />
      <div className="head-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn btn-line" onClick={() => set({ emailOpen: true, emailRecipients: [] })}>Email users</button>
      {v.showSearch ? (<>
      <label className="search"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="#5E5E5E" strokeWidth="1.6"></circle><path d="M10.5 10.5 L14 14" stroke="#5E5E5E" strokeWidth="1.6" strokeLinecap="round"></path></svg><input type="search" placeholder={v.searchPh} aria-label={v.searchPh} value={v.q} onChange={v.onQ} /></label>
      </>) : null}
      {v.showExport ? (<><button type="button" className="btn btn-line" onClick={v.onExport}><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#0A0A0A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11 M7 10l5 5 5-5 M5 20h14"></path></svg>Export CSV</button></>) : null}
      {v.showNewEvent ? (<><button type="button" className="btn btn-dark" onClick={v.onNewEvent}><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 V13.5 M2.5 8 H13.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round"></path></svg>New event</button></>) : null}
      {v.showSave ? (<><button type="button" className="btn btn-dark" onClick={v.onSave}>{v.saveLabel}</button></>) : null}
      </div>
      </div>
      {/* OVERVIEW */}
      {v.isOverview ? (<>
      <div className="stats">
      {(v.stats || []).map((s: any, s_i: number) => (<Fragment key={s_i}>
      <button type="button" className="card" onClick={s.go} style={{ textAlign: "left", fontFamily: "inherit", color: "#0A0A0A", padding: "18px", cursor: "pointer", display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#5E5E5E" }}>{s.label}<span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.dot }}></span></span>
      <span style={{ fontSize: "34px", fontWeight: "600", letterSpacing: "-0.03em", lineHeight: "1" }}>{s.value}</span>
      <span style={{ fontSize: "13px", color: "#5E5E5E" }}>{s.note}</span>
      </button>
      </Fragment>))}
      </div>
      <div className="two">
      <section className="card" style={{ padding: "20px" }} aria-labelledby="ch1">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
      <h2 id="ch1" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>Waitlist sign-ups</h2>
      <span style={{ fontSize: "13px", color: "#5E5E5E" }}>{v.weekNote} · {v.weekTotal} total</span>
      </div>
      <div role="group" aria-label="Time range" style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
      {(v.ranges || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <button type="button" className="chip" onClick={r.pick} aria-pressed={r.pressed} style={{ background: r.bg, color: r.color, border: `1px solid ${r.border}`, fontSize: "12px", padding: "5px 11px" }}>{r.label}</button>
      </Fragment>))}
      </div>
      <div className="bars" role="img" aria-label={v.weekAria} style={{ gap: v.barGap }}>
      {(v.weeks || []).map((w: any, w_i: number) => (<Fragment key={w_i}>
      <div className="bcol" style={{ minWidth: "0" }}><span className="tip">{w.tip}: {w.v} sign-up{w.v === 1 ? "" : "s"}</span><div className="bar" style={{ height: w.h }}></div><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", color: "#5E5E5E", visibility: w.labelVis, whiteSpace: "nowrap" }}>{w.label}</span></div>
      </Fragment>))}
      </div>
      </section>
      <section className="card" style={{ padding: "20px" }} aria-labelledby="ch2">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", marginBottom: "16px" }}>
      <h2 id="ch2" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>Who is joining</h2>
      <span style={{ fontSize: "13px", color: "#5E5E5E" }}>By role</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
      {(v.roleMix || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,120px) minmax(0,1fr) 28px", gap: "12px", alignItems: "center", fontSize: "13px" }}>
      <span className="ell">{r.role}</span><div className="hb"><i style={{ width: r.w }}></i></div><span style={{ textAlign: "right", fontFamily: "'Geist Mono', monospace" }}>{r.n}</span>
      </div>
      </Fragment>))}
      </div>
      </section>
      </div>
      <div className="two">
      <section className="card" style={{ padding: "6px 0 4px" }} aria-labelledby="ch3">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px 8px" }}>
      <h2 id="ch3" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>Upcoming events</h2>
      <button type="button" className="btn btn-line btn-sm" onClick={v.goEvents}>All events</button>
      </div>
      {(v.upcoming || []).map((e: any, e_i: number) => (<Fragment key={e_i}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: "16px", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #F0F0ED" }}>
      <div style={{ minWidth: "0" }}><div className="ell" style={{ fontSize: "14px", fontWeight: "500" }}>{e.title}</div><div style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "3px" }}>{e.type} · {e.when}</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}><span style={{ fontSize: "12px", color: "#5E5E5E", textAlign: "right" }}>{e.count} / {e.cap} seats</span><div className="fill"><i style={{ width: e.pct }}></i></div></div>
      </div>
      </Fragment>))}
      </section>
      <section className="card" style={{ padding: "6px 0 4px" }} aria-labelledby="ch4">
      <div style={{ padding: "14px 20px 8px" }}><h2 id="ch4" style={{ margin: "0", fontSize: "16px", fontWeight: "600" }}>Recent activity</h2></div>
      {(v.activity || []).map((a: any, a_i: number) => (<Fragment key={a_i}>
      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "11px 20px", borderTop: "1px solid #F0F0ED" }}>
      <span aria-hidden="true" style={{ width: "8px", height: "8px", marginTop: "6px", borderRadius: "50%", flex: "none", background: a.dot }}></span>
      <div style={{ minWidth: "0", flex: "1" }}><div style={{ fontSize: "14px", lineHeight: "1.4" }}>{a.text}</div><div style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{a.when}</div></div>
      </div>
      </Fragment>))}
      </section>
      </div>
      </>) : null}
      {/* WAITLIST */}
      {v.isWaitlist ? (<>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
      {(v.wlFilters || []).map((f: any, f_i: number) => (<Fragment key={f_i}>
      <button type="button" className="chip" onClick={f.go} aria-pressed={f.pressed} style={{ background: f.bg, color: f.color, border: `1px solid ${f.border}` }}>{f.label} <span style={{ opacity: ".6", fontFamily: "'Geist Mono', monospace", marginLeft: "4px" }}>{f.n}</span></button>
      </Fragment>))}
      </div>
      {v.selCount ? (<>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px 10px 18px", marginBottom: "12px", background: "#0A0A0A", borderColor: "#0A0A0A", color: "#FFFFFF", flexWrap: "wrap" }}>
      <span style={{ fontSize: "14px", flex: "1" }}>{v.selCount} selected</span>
      <button type="button" className="btn btn-sm" onClick={v.onClearSel} style={{ background: "transparent", color: "#FFFFFF", border: "1px solid #3A3A3A" }}>Clear</button>
      <button type="button" className="btn btn-sm" onClick={() => set({ emailOpen: true, emailRecipients: s.wl.filter((person) => s.sel[person.id]).map((person) => person.email) })}>Email selected</button>
      <button type="button" className="btn btn-sm" onClick={v.onInviteSel} style={{ background: "#C6F432", color: "#0A0A0A", border: "1px solid #C6F432" }}>Send invites</button>
      </div>
      </>) : null}
      <div className="card" style={{ overflow: "hidden" }}>
      <div className="thead wl">
      <input type="checkbox" aria-label="Select all shown" checked={v.allSel} onChange={v.onSelAll} style={{ width: "16px", height: "16px", accentColor: "#0A0A0A", margin: "0" }} />
      <span>PERSON</span><span className="c-co">COMPANY</span><span className="c-role">ROLE</span><span className="c-date">JOINED</span><span>STATUS</span><span className="c-act"></span>
      </div>
      {(v.wlRows || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div className="trow wl">
      <input type="checkbox" aria-label={r.selLabel} checked={r.sel} onChange={r.toggle} style={{ width: "16px", height: "16px", accentColor: "#0A0A0A", margin: "0" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: "0" }}>
      <span className="ava" style={{ background: r.avaBg }}>{r.ini}</span>
      <div style={{ minWidth: "0" }}><div className="ell" style={{ fontWeight: "500" }}>{r.name}</div><div className="ell" style={{ fontSize: "12px", color: "#5E5E5E" }}>{r.email}</div><div className="mmeta ell" style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{r.company} · {r.role} · {r.joined}</div></div>
      </div>
      <span className="c-co ell">{r.company}</span>
      <span className="c-role ell" style={{ color: "#5E5E5E" }}>{r.role}</span>
      <span className="c-date" style={{ color: "#5E5E5E", fontSize: "13px" }}>{r.joined}</span>
      <span><span className="pill" style={{ background: r.stBg, color: r.stColor }}><span className="dot" style={{ background: r.stDot }}></span>{r.status}</span></span>
      <span className="c-act" style={{ textAlign: "right" }}><button type="button" className="btn btn-line btn-sm" onClick={() => set({ emailOpen: true, emailRecipients: [r.email] })}>Email</button> <button type="button" className="btn btn-line btn-sm" onClick={r.act}>{r.actLabel}</button></span>
      </div>
      </Fragment>))}
      {v.wlEmpty ? (<>
      <div style={{ padding: "48px 20px", textAlign: "center", color: "#5E5E5E", fontSize: "14px" }}>No one matches that. Try a different search or filter.</div>
      </>) : null}
      </div>
      </>) : null}
      {/* EVENTS */}
      {v.isEvents ? (<>
      <div className="evgrid">
      {(v.evCards || []).map((e: any, e_i: number) => (<Fragment key={e_i}>
      <article className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", position: "relative", overflow: "hidden" }}>
      <span aria-hidden="true" style={{ position: "absolute", top: "-60px", right: "-60px", width: "180px", height: "180px", borderRadius: "50%", background: e.glow, filter: "blur(40px)", opacity: ".55" }}></span>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", position: "relative" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", letterSpacing: ".06em", color: "#5E5E5E" }}>{e.type} · {e.length}</span>
      <span className="pill" style={{ background: e.stBg, color: e.stColor }}><span className="dot" style={{ background: e.stDot }}></span>{e.status}</span>
      </div>
      <div style={{ position: "relative" }}><h3 style={{ margin: "0", fontSize: "18px", fontWeight: "600", letterSpacing: "-0.01em" }}>{e.title}</h3><p style={{ margin: "6px 0 0", fontSize: "13px", color: "#5E5E5E" }}>{e.when} · {e.where}</p></div>
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{e.count} registered</span><span style={{ color: "#5E5E5E" }}>{e.cap} seats</span></div>
      <div className="fill"><i style={{ width: e.pct }}></i></div>
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", position: "relative" }}>
      <button type="button" className="btn btn-line btn-sm" onClick={e.viewRegs}>View registrations</button>
      <button type="button" className={`btn btn-sm ${e.pubClass}`} onClick={e.togglePub}>{e.pubLabel}</button>
      <button type="button" className="btn btn-line btn-sm" onClick={e.edit} aria-label={`Edit ${e.title}`}>Edit</button>
      <button type="button" className="btn btn-sm" onClick={e.remove} aria-label={`Delete ${e.title}`} style={{ marginLeft: "auto", background: "#FFFFFF", color: "#B42318", border: "1px solid #F3C7C3" }}>Delete</button>
      </div>
      </article>
      </Fragment>))}
      </div>
      </>) : null}
      {/* REGISTRATIONS */}
      {v.isRegs ? (<>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px" }}>
      <label htmlFor="ev-filter" style={{ fontSize: "13px", color: "#5E5E5E" }}>Event</label>
      <div className="fld" style={{ position: "relative", minWidth: "260px", maxWidth: "100%" }}>
      <select id="ev-filter" value={v.regEv} onChange={v.onRegEv} style={{ appearance: "none", WebkitAppearance: "none", paddingRight: "36px", cursor: "pointer" }}>
      {(v.evOptions || []).map((o: any, o_i: number) => (<Fragment key={o_i}><option value={o.v}>{o.label}</option></Fragment>))}
      </select>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ position: "absolute", right: "13px", pointerEvents: "none" }}><path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="#5E5E5E" strokeWidth="1.6" strokeLinecap="round"></path></svg>
      </div>
      <span style={{ fontSize: "13px", color: "#5E5E5E" }}>{v.regSummary}</span>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
      <div className="thead rg"><span>ATTENDEE</span><span className="c-co">COMPANY</span><span className="c-role">ROLE</span><span className="c-size">SIZE</span><span className="c-heard">HEARD FROM</span><span className="c-ev">EVENT</span><span style={{ textAlign: "right" }}>CHECKED IN</span></div>
      {(v.regRows || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div className="trow rg">
      <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: "0" }}>
      <span className="ava" style={{ background: r.avaBg }}>{r.ini}</span>
      <div style={{ minWidth: "0" }}><div className="ell" style={{ fontWeight: "500" }}>{r.name}</div><div className="ell" style={{ fontSize: "12px", color: "#5E5E5E" }}>{r.email}</div><div className="mmeta ell" style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{r.event}</div></div>
      </div>
      <span className="c-co ell">{r.company}</span>
      <span className="c-role ell" style={{ color: "#5E5E5E" }}>{r.role}</span>
      <span className="c-size" style={{ color: "#5E5E5E" }}>{r.size}</span>
      <span className="c-heard ell" style={{ color: "#5E5E5E" }}>{r.heard}</span>
      <span className="c-ev ell" style={{ fontSize: "13px" }}>{r.event}</span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" className="sw" role="switch" aria-checked={r.on} aria-label={r.swLabel} onClick={r.toggle} style={{ background: r.swBg }}><span style={{ left: r.swLeft }}></span></button></span>
      </div>
      </Fragment>))}
      {v.regEmpty ? (<>
      <div style={{ padding: "48px 20px", textAlign: "center", color: "#5E5E5E", fontSize: "14px" }}>No registrations here yet.</div>
      </>) : null}
      </div>
      </>) : null}
      {/* VISITORS */}
      {v.isVisitors ? (<>
      <div className="stats" style={{ marginBottom: "14px" }}>
      {(v.vStats || []).map((st: any, st_i: number) => (<Fragment key={st_i}>
      <div className="card" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#5E5E5E" }}>{st.label}<span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: st.dot }}></span></span>
      <span style={{ fontSize: "34px", fontWeight: "600", letterSpacing: "-0.03em", lineHeight: "1" }}>{st.value}</span>
      <span style={{ fontSize: "13px", color: "#5E5E5E" }}>{st.note}</span>
      </div>
      </Fragment>))}
      </div>
      <div className="two" style={{ marginBottom: "14px" }}>
      {[{ id: 'vc1', title: 'Top countries', rows: v.vCountries }, { id: 'vc2', title: 'How they found you', rows: v.vSources }].map((b: any) => (<Fragment key={b.id}>
      <section className="card" style={{ padding: "20px" }} aria-labelledby={b.id}>
      <h2 id={b.id} style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: "600" }}>{b.title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
      {b.rows.map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,150px) minmax(0,1fr) 32px", gap: "12px", alignItems: "center", fontSize: "13px" }}>
      <span className="ell" style={{ display: "flex", alignItems: "center", gap: "7px" }}>{r.flag ? (<img src={r.flag} width={20} height={15} alt="" style={{ borderRadius: "2px", flex: "none", boxShadow: "0 0 0 1px rgba(10,10,10,0.08)" }} />) : null}<span className="ell">{r.label}</span></span><div className="hb"><i style={{ width: r.w }}></i></div><span style={{ textAlign: "right", fontFamily: "'Geist Mono', monospace" }}>{r.n}</span>
      </div>
      </Fragment>))}
      {b.rows.length ? null : (<span style={{ fontSize: "13px", color: "#5E5E5E" }}>No visitors yet.</span>)}
      </div>
      </section>
      </Fragment>))}
      </div>
      <div style={{ fontSize: "13px", color: "#5E5E5E", marginBottom: "10px" }}>{v.vSummary}</div>
      <div className="card" style={{ overflow: "hidden" }}>
      <div className="thead vs"><span>VISITOR</span><span className="c-loc">LOCATION</span><span className="c-br">BROWSER</span><span className="c-from">CAME FROM</span><span className="c-vis" style={{ textAlign: "right" }}>VISITS</span><span style={{ textAlign: "right" }}>LAST SEEN</span></div>
      {(v.vRows || []).map((r: any, r_i: number) => (<Fragment key={r_i}>
      <div className="trow vs">
      <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: "0" }}>
      <span className="ava" style={{ background: r.avaBg }}>{r.ini}</span>
      <div style={{ minWidth: "0" }}><div className="ell" style={{ fontWeight: "500" }}>{r.who}</div>{r.sub ? (<div className="ell" style={{ fontSize: "12px", color: "#3A3A38" }}>{r.sub}</div>) : null}<div className="ell" style={{ fontSize: "12px", color: "#5E5E5E", fontFamily: "'Geist Mono', monospace" }}>{r.ip}</div><div className="mmeta ell" style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{r.country} · {r.from} · {r.visitsLabel}</div></div>
      </div>
      <div className="c-loc" style={{ minWidth: "0" }}><div className="ell" style={{ display: "flex", alignItems: "center", gap: "7px" }}>{r.flag ? (<img src={r.flag} width={20} height={15} alt="" style={{ borderRadius: "2px", flex: "none", boxShadow: "0 0 0 1px rgba(10,10,10,0.08)" }} />) : null}<span className="ell">{r.country}</span></div><div className="ell" style={{ fontSize: "12px", color: "#5E5E5E" }}>{r.place}</div></div>
      <div className="c-br" style={{ minWidth: "0" }}><div className="ell">{r.browser}</div><div style={{ fontSize: "12px", color: "#5E5E5E" }}>{r.kind}</div></div>
      <div className="c-from" style={{ minWidth: "0" }}><div className="ell">{r.from}</div><div className="ell" style={{ fontSize: "12px", color: "#5E5E5E" }}>Landed on {r.page}</div></div>
      <span className="c-vis" style={{ textAlign: "right", fontFamily: "'Geist Mono', monospace" }}>{r.visits}</span>
      <div style={{ textAlign: "right" }}><div style={{ fontSize: "13px" }}>{r.seen}</div><div style={{ fontSize: "12px", color: "#5E5E5E" }}>First {r.first}</div></div>
      </div>
      </Fragment>))}
      {v.vEmpty ? (<>
      <div style={{ padding: "48px 20px", textAlign: "center", color: "#5E5E5E", fontSize: "14px" }}>No visitors yet. They appear here as soon as someone opens the website.</div>
      </>) : null}
      </div>
      </>) : null}
      {/* SETTINGS */}
      {v.isSettings ? (<>
      <div className="setgrid">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <section className="card" style={{ padding: "20px" }} aria-labelledby="st1">
      <h2 id="st1" style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "600" }}>Waitlist</h2>
      <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#5E5E5E" }}>How the Join the waitlist page behaves.</p>
      {(v.wlToggles || []).map((t: any, t_i: number) => (<Fragment key={t_i}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0", borderTop: "1px solid #F0F0ED" }}>
      <div style={{ flex: "1", minWidth: "0" }}><div style={{ fontSize: "14px", fontWeight: "500" }}>{t.label}</div><div style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{t.note}</div></div>
      <button type="button" className="sw" role="switch" aria-checked={t.on} aria-label={t.label} onClick={t.toggle} style={{ background: t.bg }}><span style={{ left: t.left }}></span></button>
      </div>
      </Fragment>))}
      </section>
      <section className="card" style={{ padding: "20px" }} aria-labelledby="st3">
      <h2 id="st3" style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "600" }}>Notifications</h2>
      <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#5E5E5E" }}>Where new sign-up and registration alerts go.</p>
      <label className="lbl" htmlFor="notify-email">Send alerts to</label>
      <div className="fld"><input id="notify-email" type="email" placeholder="team@company.com" value={v.notifyEmail} onChange={v.onNotify} /></div>
      {(v.notifToggles || []).map((t: any, t_i: number) => (<Fragment key={t_i}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 0 0", marginTop: "12px", borderTop: "1px solid #F0F0ED" }}>
      <div style={{ flex: "1", minWidth: "0" }}><div style={{ fontSize: "14px", fontWeight: "500" }}>{t.label}</div><div style={{ fontSize: "12px", color: "#5E5E5E", marginTop: "2px" }}>{t.note}</div></div>
      <button type="button" className="sw" role="switch" aria-checked={t.on} aria-label={t.label} onClick={t.toggle} style={{ background: t.bg }}><span style={{ left: t.left }}></span></button>
      </div>
      </Fragment>))}
      </section>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <section className="card" style={{ padding: "20px" }} aria-labelledby="st2">
      <h2 id="st2" style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "600" }}>Event registration form</h2>
      <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#5E5E5E" }}>Questions people answer when they register. Name and email are always required.</p>
      {(v.formRows || []).map((f: any, f_i: number) => (<Fragment key={f_i}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 0", borderTop: "1px solid #F0F0ED" }}>
      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: "11px", color: "#5E5E5E", border: "1px solid #E2E2DF", borderRadius: "6px", padding: "2px 6px", width: "50px", textAlign: "center", flex: "none" }}>{f.kind}</span>
      <span style={{ flex: "1", minWidth: "0", fontSize: "14px" }} className="ell">{f.label}</span>
      <span style={{ fontSize: "12px", color: "#5E5E5E" }}>Required</span>
      <button type="button" className="sw" role="switch" aria-checked={f.on} aria-label={f.swLabel} onClick={f.toggle} disabled={f.locked} style={{ background: f.bg }}><span style={{ left: f.left }}></span></button>
      </div>
      </Fragment>))}
      </section>
      <section className="card" style={{ padding: "20px" }} aria-labelledby="st4">
      <h2 id="st4" style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: "600" }}>Team</h2>
      <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#5E5E5E" }}>People who can open this admin.</p>
      {(v.team || []).map((m: any, m_i: number) => (<Fragment key={m_i}>
      <div style={{ display: "flex", alignItems: "center", gap: "11px", padding: "11px 0", borderTop: "1px solid #F0F0ED" }}>
      <span className="ava" style={{ background: m.bg, color: m.fg }}>{m.ini}</span>
      <div style={{ flex: "1", minWidth: "0" }}><div className="ell" style={{ fontSize: "14px", fontWeight: "500" }}>{m.name}</div><div className="ell" style={{ fontSize: "12px", color: "#5E5E5E" }}>{m.email}</div></div>
      <span className="pill" style={{ background: "#F0F0ED", color: "#0A0A0A" }}>{m.role}</span>
      </div>
      </Fragment>))}
      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
      <div className="fld" style={{ flex: "1", minWidth: "0" }}><input type="email" aria-label="Teammate email" placeholder="teammate@company.com" value={v.inviteEmail} onChange={v.onInviteEmail} /></div>
      <button type="button" className="btn btn-dark" onClick={v.onInviteTeam}>Invite</button>
      </div>
      {v.inviteErr ? (<><div style={{ fontSize: "12px", color: "#B42318", marginTop: "6px" }}>{v.inviteErr}</div></>) : null}
      </section>
      </div>
      </div>
      </>) : null}
      </main>
      </div>
      <nav className="abar" aria-label="Admin sections">
      {(v.nav || []).map((n: any, n_i: number) => (<Fragment key={n_i}>
      <button type="button" className="ab" onClick={n.go} aria-current={n.current}><span className="tb-ic"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={n.icon}></path></svg></span><span>{n.short}</span></button>
      </Fragment>))}
      </nav>
      </div>
      {/* New event drawer */}
      {v.drawer ? (<>
      <div className="scrim" onClick={v.onCloseDrawer}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title" onClick={v.stop}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h2 id="dr-title" style={{ margin: "0", fontSize: "20px", fontWeight: "600", letterSpacing: "-0.02em" }}>{v.drawerTitle}</h2>
      <button type="button" aria-label="Close" onClick={v.onCloseDrawer} style={{ width: "34px", height: "34px", borderRadius: "50%", border: "1px solid #E2E2DF", background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 L10 10 M10 2 L2 10" stroke="#0A0A0A" strokeWidth="1.6" strokeLinecap="round"></path></svg></button>
      </div>
      <p style={{ margin: "0", fontSize: "13px", color: "#5E5E5E" }}>{v.drawerNote}</p>
      <div><label className="lbl" htmlFor="ne-title">Title</label><div className="fld" style={{ borderColor: v.neTitleBorder }}><input id="ne-title" type="text" placeholder="Live demo: ask your numbers anything" value={v.ne.title} onChange={v.neSet.title} /></div>
      {v.neErr ? (<><div style={{ fontSize: "12px", color: "#B42318", marginTop: "6px" }}>{v.neErr}</div></>) : null}</div>
      <div><label className="lbl" htmlFor="ne-type">Type</label><div className="fld" style={{ position: "relative" }}><select id="ne-type" value={v.ne.type} onChange={v.neSet.type} style={{ appearance: "none", WebkitAppearance: "none", cursor: "pointer" }}>{(v.typeOptions || []).map((o: any, o_i: number) => (<Fragment key={o_i}><option value={o.v}>{o.v}</option></Fragment>))}</select><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ position: "absolute", right: "13px", pointerEvents: "none" }}><path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="#5E5E5E" strokeWidth="1.6" strokeLinecap="round"></path></svg></div></div>
      <div><label className="lbl" htmlFor="ne-desc">Description</label><div className="fld"><textarea id="ne-desc" rows={3} placeholder="What people will learn, who it is for." value={v.ne.desc || ''} onChange={v.neSet.desc} style={{ border: 0, outline: "none", background: "transparent", fontFamily: "inherit", fontSize: "14px", color: "#0A0A0A", width: "100%", padding: "11px 13px", resize: "vertical", boxSizing: "border-box" }} /></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
      <div><label className="lbl" htmlFor="ne-date">Date</label><div className="fld"><input id="ne-date" type="date" value={v.ne.date} onChange={v.neSet.date} /></div></div>
      <div><label className="lbl" htmlFor="ne-time">Time</label><div className="fld"><input id="ne-time" type="time" value={v.ne.time} onChange={v.neSet.time} /></div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "12px" }}>
      <div><label className="lbl" htmlFor="ne-where">Where</label><div className="fld"><input id="ne-where" type="text" placeholder="Online" value={v.ne.where} onChange={v.neSet.where} /></div></div>
      <div><label className="lbl" htmlFor="ne-cap">Seats</label><div className="fld"><input id="ne-cap" type="number" min="1" placeholder="100" value={v.ne.cap} onChange={v.neSet.cap} /></div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "12px" }}>
      <div><label className="lbl" htmlFor="ne-length">Length</label><div className="fld"><input id="ne-length" type="text" placeholder="60 min" value={v.ne.length || ''} onChange={v.neSet.length} /></div></div>
      </div>
      <div style={{ marginTop: "auto", display: "flex", gap: "10px", justifyContent: "flex-end", paddingTop: "8px" }}>
      <button type="button" className="btn btn-line" onClick={v.onCloseDrawer}>Cancel</button>
      <button type="button" className="btn btn-dark" onClick={v.onCreateEvent}>{v.drawerAction}</button>
      </div>
      </div>
      </div>
      </>) : null}
      {v.toast ? (<>
      <div className="toast" role="status"><span aria-hidden="true" style={{ width: "18px", height: "18px", borderRadius: "50%", background: "#C6F432", color: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", flex: "none" }}>✓</span>{v.toast}</div>
      </>) : null}
      </div>
  );
}
