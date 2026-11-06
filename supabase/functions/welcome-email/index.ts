// Sends the branded welcome email through Resend once a new account's email is confirmed.
// Called by a database trigger (pg_net) on auth.users. See migration 20261106120000_welcome_email.sql.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY      required, from resend.com → API Keys
//   WELCOME_EMAIL_FROM  optional, default "Fremwork <support@fremwork.com>" (domain must be verified in Resend)
//   SITE_URL            optional, default https://www.fremwork.com (logo)
//   APP_URL             optional, default https://fremai.vercel.app (button)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;
const SB_URL = env('SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const SANS = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function renderHtml(name: string, siteUrl: string, chatUrl: string) {
  const hello = name ? `Welcome, ${esc(name)}.` : 'Welcome to Fremwork.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Welcome to Fremwork</title>
</head>
<body style="margin:0;padding:0;background-color:#E9E9E6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your account is ready. Ask your first finance question.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E9E9E6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;border-radius:16px;overflow:hidden;background-color:#FFFFFF;">
<tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A;padding:26px 32px;">
<a href="${esc(siteUrl)}" style="text-decoration:none;"><img src="${esc(siteUrl)}/email/logo.png" width="150" alt="Fremwork" style="display:block;border:0;width:150px;height:auto;color:#FFFFFF;font-family:${SANS};font-size:20px;font-weight:600;"></a>
</td></tr>
<tr><td style="padding:36px 32px 32px;font-family:${SANS};color:#0A0A0A;">
<h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;letter-spacing:-0.02em;font-weight:600;">${hello}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#3A3A38;">Your account is ready. Fremwork is your AI finance team in one chat, so you can ask about cash, margin and overdue invoices in plain language.</p>
<p style="margin:0 0 8px;font-size:14px;font-weight:600;">Try asking:</p>
<p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#3A3A38;">How long will our cash last?</p>
<p style="margin:0 0 4px;font-size:14px;line-height:22px;color:#3A3A38;">Which invoices are overdue?</p>
<p style="margin:0 0 28px;font-size:14px;line-height:22px;color:#3A3A38;">Where did our spending go up this month?</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#0A0A0A" style="background-color:#0A0A0A;border-radius:6px;">
<a href="${esc(chatUrl)}" style="display:inline-block;padding:13px 24px;font-family:${SANS};font-size:15px;font-weight:500;color:#FFFFFF;text-decoration:none;">Open Fremwork AI</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #EDEDED;font-family:${SANS};font-size:12px;line-height:18px;color:#8C8C8C;">You are getting this because you created a Fremwork account.<br>Fremwork, your AI finance team in one chat.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

const renderText = (name: string, chatUrl: string) =>
  `${name ? `Welcome, ${name}.` : 'Welcome to Fremwork.'}

Your account is ready. Fremwork is your AI finance team in one chat, so you can ask about cash, margin and overdue invoices in plain language.

Try asking:
- How long will our cash last?
- Which invoices are overdue?
- Where did our spending go up this month?

Open Fremwork AI: ${chatUrl}

You are getting this because you created a Fremwork account.
`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { user_id, secret } = await req.json().catch(() => ({}));
  if (!user_id || !secret) return json({ error: 'Bad request' }, 400);

  // The trigger sends the shared webhook secret kept in Supabase Vault; check it before doing anything.
  const ok = await rest('rpc/check_registration_webhook', { method: 'POST', body: JSON.stringify({ p_secret: secret }) });
  if (ok !== true) return json({ error: 'Forbidden' }, 403);

  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) return json({ skipped: 'RESEND_API_KEY is not set' });

  const rows = await rest(`profiles?id=eq.${encodeURIComponent(user_id)}&select=id,email,full_name,welcome_sent_at`);
  const user = rows?.[0];
  if (!user) return json({ error: 'User not found' }, 404);
  if (user.welcome_sent_at) return json({ skipped: 'already sent' });

  const name = (user.full_name ?? '').trim();
  const chatUrl = `${env('APP_URL', 'https://fremai.vercel.app')}/chat`;
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `welcome-${user.id}` },
    body: JSON.stringify({
      from: env('WELCOME_EMAIL_FROM', 'Fremwork <support@fremwork.com>'),
      to: [user.email],
      subject: 'Welcome to Fremwork',
      html: renderHtml(name, env('SITE_URL', 'https://www.fremwork.com'), chatUrl),
      text: renderText(name, chatUrl),
    }),
  });
  const result = await send.json().catch(() => ({}));
  if (!send.ok) {
    console.error('Resend error', send.status, result);
    return json({ error: result?.message ?? 'send failed' }, 502);
  }
  await rest(`profiles?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify({ welcome_sent_at: new Date().toISOString() }) });
  return json({ sent: true, id: result?.id });
});
