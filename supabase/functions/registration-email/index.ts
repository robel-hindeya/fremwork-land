// Sends the "You're in." confirmation when someone registers for an event.
// Called by a database trigger (pg_net) on every new row in public.event_registrations.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   required, from resend.com → API Keys
//   EMAIL_FROM       optional, default "Fremwork <events@fremwork.com>" (domain must be verified in Resend)
//   SITE_URL         optional, default https://www.fremwork.com (logo and links)
//   EVENT_TIMEZONE   optional, default Africa/Addis_Ababa; EVENT_TZ_LABEL default EAT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { renderHtml, renderText, subject } from './email.ts';

const DEFAULT_PREP = [
  'A laptop or desktop and a stable internet connection',
  'An AI tool account of your choice and a GitHub account',
  'One small project idea you care about',
];

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const SB_URL = env('SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { registration_id, secret } = await req.json().catch(() => ({}));
  if (!registration_id || !secret) return json({ error: 'Bad request' }, 400);

  // The trigger sends a secret kept in Supabase Vault; check it before doing anything.
  const ok = await rest('rpc/check_registration_webhook', { method: 'POST', body: JSON.stringify({ p_secret: secret }) });
  if (ok !== true) return json({ error: 'Forbidden' }, 403);

  const rows = await rest(
    `event_registrations?id=eq.${encodeURIComponent(registration_id)}&select=id,name,email,confirmation_sent_at,events(title,starts_at,when_label,length_label,location,prep_items)`,
  );
  const reg = rows?.[0];
  if (!reg) return json({ error: 'Registration not found' }, 404);
  if (reg.confirmation_sent_at) return json({ skipped: 'already sent' });

  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return json({ skipped: 'RESEND_API_KEY is not set' });

  // The website API may send this confirmation too. Claim it atomically so only one side sends.
  const claimed = await rest(`event_registrations?id=eq.${reg.id}&confirmation_sent_at=is.null`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ confirmation_sent_at: new Date().toISOString() }),
  });
  if (!Array.isArray(claimed) || !claimed.length) return json({ skipped: 'already sent' });

  const input = {
    name: reg.name,
    event: reg.events,
    siteUrl: env('SITE_URL', 'https://www.fremwork.com'),
    timeZone: env('EVENT_TIMEZONE', 'Africa/Addis_Ababa'),
    tzLabel: env('EVENT_TZ_LABEL', 'EAT'),
    prep: Array.isArray(reg.events?.prep_items) && reg.events.prep_items.length ? reg.events.prep_items : DEFAULT_PREP,
  };

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `registration-fn-${reg.id}` },
    body: JSON.stringify({
      from: env('EMAIL_FROM', 'Fremwork <events@fremwork.com>'),
      to: [reg.email],
      subject: subject(reg.events),
      html: renderHtml(input),
      text: renderText(input),
    }),
  });
  const result = await send.json().catch(() => ({}));
  if (!send.ok) {
    console.error('Resend error', send.status, result);
    await rest(`event_registrations?id=eq.${reg.id}`, { method: 'PATCH', body: JSON.stringify({ confirmation_sent_at: null, confirmation_error: `${send.status}: ${result?.message ?? 'send failed'}` }) });
    return json({ error: result?.message ?? 'send failed' }, 502);
  }
  await rest(`event_registrations?id=eq.${reg.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ confirmation_error: null }),
  });
  return json({ sent: true, id: result?.id });
});
