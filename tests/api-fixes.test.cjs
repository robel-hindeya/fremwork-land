require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
createRequire(path.resolve('apps/api/package.json'))('reflect-metadata');
const { EmailService, escapeHtml } = require('../apps/api/src/email/email.service.ts');
const { EventsService } = require('../apps/api/src/events/events.module.ts');

const config = (env) => ({ get: (k) => env[k] });

function withFetch(fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ id: 'test-id' }), text: async () => '' }; };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}

test('registration email escapes names and dates before they reach the HTML template', () => withFetch(async (calls) => {
  const svc = new EmailService(config({ RESEND_API_KEY: 'test-key-not-real' }));
  const ok = await svc.sendRegistrationEmail({ to: 'a@example.invalid', name: '<a href="https://evil.example">Claim</a>', dates: '<img src=x>' });
  assert.equal(ok, true);
  const { html } = calls[0].body;
  assert.ok(!html.includes('<a href="https://evil.example">'), 'no injected link');
  assert.ok(!html.includes('<img src=x>'), 'no injected image');
  assert.ok(html.includes('&lt;a href=&quot;https://evil.example&quot;&gt;Claim&lt;/a&gt;'));
  assert.ok(calls[0].init.signal, 'provider call has a timeout');
  assert.equal(escapeHtml(`'"&<>`), '&#39;&quot;&amp;&lt;&gt;');
}));

test('cancel rejects malformed tokens with 404 instead of a database error', async () => {
  let touched = false;
  const db = { from: () => { touched = true; throw new Error('should not query'); } };
  const svc = new EventsService({ db }, {}, {});
  await assert.rejects(svc.cancel(1, 'not-a-uuid'), (e) => e.getStatus() === 404);
  await assert.rejects(svc.cancel(1, ''), (e) => e.getStatus() === 400);
  assert.equal(touched, false);
});

function claimDb(claimed) {
  const updates = [];
  const chain = (patch) => {
    const q = { eq: () => q, is: () => q, select: async () => ({ data: claimed ? [{ id: 7 }] : [], error: null }), then: (r) => r({ error: null }) };
    updates.push(patch);
    return q;
  };
  return { updates, db: { from: () => ({ update: chain }) } };
}

test('the API sends a registration confirmation only when it wins the claim', async () => {
  const sent = [];
  const email = { configured: true, sendRegistrationEmail: async (o) => { sent.push(o); return true; } };
  const won = claimDb(true);
  await new EventsService({ db: won.db }, {}, email).sendConfirmation(7, { to: 'a@example.invalid', name: 'A', dates: 'x', title: 'T' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotencyKey, 'registration-api-7');

  const lost = claimDb(false);
  await new EventsService({ db: lost.db }, {}, email).sendConfirmation(8, { to: 'b@example.invalid', name: 'B', dates: 'x', title: 'T' });
  assert.equal(sent.length, 1, 'the Edge Function already sent it');
});

test('a failed send releases the claim so the Edge Function can retry', async () => {
  const email = { configured: true, sendRegistrationEmail: async () => false };
  const c = claimDb(true);
  await new EventsService({ db: c.db }, {}, email).sendConfirmation(9, { to: 'c@example.invalid', name: 'C', dates: 'x', title: 'T' });
  assert.equal(c.updates.at(-1).confirmation_sent_at, null);
});
