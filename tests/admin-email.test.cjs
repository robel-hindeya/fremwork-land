require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
apiRequire('reflect-metadata');
const { GUARDS_METADATA } = apiRequire('@nestjs/common/constants');
const { SupabaseAuthGuard } = require('../apps/api/src/auth/supabase-auth.guard.ts');
const { AdminGuard } = require('../apps/api/src/auth/admin.guard.ts');
const { AdminEmailService, AdminEmailController } = require('../apps/api/src/email/admin-email.module.ts');
const { EmailService } = require('../apps/api/src/email/email.service.ts');

const user = { id: 'test-admin-id', role: 'owner' };
const uuid = 'ae9d1676-38a8-44cf-9d46-e11d285749f5';
const message = (patch = {}) => ({ requestId: uuid, emails: ['alice@example.invalid'], subject: 'Test only', format: 'html', body: '<h1>Test update</h1>', ...patch });
function database(contacts = { profiles: [{ email: 'Alice@EXAMPLE.invalid', full_name: 'Alice' }], waitlist_entries: [{ email: 'alice@example.invalid', name: 'Alice' }, { email: 'bob@example.invalid', name: 'Bob' }], event_registrations: [{ email: 'bob@example.invalid', name: 'Bob' }] }) {
  const campaigns = new Map();
  const state = { campaigns, failInsert: false, failLookup: false, queries: [] };
  state.db = { from(table) {
    state.queries.push(table);
    if (table !== 'admin_email_campaigns') return { select: () => ({ order: () => ({ range: async (start, end) => ({ data: (contacts[table] || []).slice(start, end + 1), error: null }) }) }) };
    return {
      select: () => ({ eq: (_key, id) => ({ maybeSingle: async () => ({ data: campaigns.get(id) || null, error: state.failLookup ? { code: 'db_unavailable' } : null }) }) }),
      insert: async (row) => {
        if (state.failInsert) return { error: { code: 'db_unavailable' } };
        if (campaigns.has(row.id)) return { error: { code: '23505' } };
        campaigns.set(row.id, structuredClone(row)); return { error: null };
      },
      update: (patch) => ({ eq: async (_key, id) => { Object.assign(campaigns.get(id), patch); return { error: null }; } }),
    };
  } };
  return state;
}
function service(db = database(), sendBatch = async () => {}) {
  return { db, svc: new AdminEmailService(db, { configured: true, sendBatch }) };
}

test('admin email endpoints require both authenticated Supabase identity and database admin role', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, AdminEmailController);
  assert.deepEqual(guards, [SupabaseAuthGuard, AdminGuard]);
  const ctx = (role) => ({ switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) });
  assert.throws(() => new AdminGuard().canActivate(ctx('member')));
  assert.equal(new AdminGuard().canActivate(ctx('owner')), true);
});

test('all contacts includes each source, normalizes addresses, deduplicates and paginates', async () => {
  const { svc } = service();
  const contacts = await svc.contacts();
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts[0], { email: 'alice@example.invalid', name: 'Alice', sources: ['Registered user', 'Waitlist'] });
  const many = Array.from({ length: 1002 }, (_, i) => ({ email: `user${i}@example.invalid`, full_name: `User ${i}` }));
  const paged = service(database({ profiles: many }));
  assert.equal((await paged.svc.contacts()).length, 1002);
});

test('HTML reaches the provider unchanged and duplicate requests never send twice', async () => {
  const batches = [];
  const { svc } = service(database(), async (...args) => batches.push(args));
  const draft = message({ emails: ['ALICE@example.invalid', 'alice@example.invalid', 'bob@example.invalid'] });
  const result = await svc.send(draft, user);
  assert.equal(result.accepted, 2); assert.equal(result.status, 'completed');
  assert.equal(batches.length, 1);
  assert.equal(batches[0][0][0].html, draft.body);
  assert.deepEqual(batches[0][0].map((item) => item.to), ['alice@example.invalid', 'bob@example.invalid']);
  assert.match(batches[0][1], new RegExp(uuid));
  await svc.send(draft, user);
  assert.equal(batches.length, 1);
  await assert.rejects(svc.send({ ...draft, subject: 'Another message' }, user), /already used/);
});

test('rejects invalid content, unknown recipients and unavailable audit before sending', async () => {
  let sends = 0;
  const { svc, db } = service(database(), async () => sends++);
  for (const patch of [{ subject: ' ' }, { subject: 'Hi\r\nBcc: victim' }, { body: '' }, { body: 'é'.repeat(60000) }, { requestId: 'invalid' }, { emails: [] }, { emails: ['unknown@example.invalid'] }]) {
    await assert.rejects(svc.send(message(patch), user));
  }
  db.failInsert = true;
  await assert.rejects(svc.send(message(), user), /audit could not be saved/);
  assert.equal(sends, 0);
});

test('provider failure persists an uncertain result and retry does not duplicate the batch', async () => {
  let sends = 0;
  const { svc, db } = service(database(), async () => { sends++; throw new Error('provider_timeout'); });
  const result = await svc.send(message(), user);
  assert.equal(result.status, 'failed'); assert.equal(result.uncertain, true);
  assert.equal(db.campaigns.get(uuid).status, 'failed');
  await svc.send(message(), user);
  assert.equal(sends, 1);
});

test('Resend gets separate private messages and an idempotency key; missing configuration fails closed', async () => {
  const old = global.fetch;
  const config = { get: (key) => ({ RESEND_API_KEY: 'test-only-provider-key', EMAIL_FROM: 'Test <test@example.invalid>' })[key] };
  let calls = 0;
  global.fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://api.resend.com/emails/batch');
    assert.equal(init.headers['Idempotency-Key'], 'test-campaign');
    const messages = JSON.parse(init.body);
    assert.deepEqual(messages.map((item) => item.to), [['alice@example.invalid'], ['bob@example.invalid']]);
    assert.equal(messages[0].html, '<h1>Hi</h1>');
    return Response.json({ data: [{ id: 'fake-1' }, { id: 'fake-2' }] });
  };
  try {
    await new EmailService(config).sendBatch([{ to: 'alice@example.invalid', subject: 'Test', html: '<h1>Hi</h1>' }, { to: 'bob@example.invalid', subject: 'Test', text: 'Hi' }], 'test-campaign');
    await assert.rejects(new EmailService({ get: () => '' }).sendBatch([], 'test'), /not_configured/);
    assert.equal(calls, 1);
  } finally { global.fetch = old; }
});

test('partial batch failure reports only confirmed acceptances and never replays on retry', async () => {
  const contacts = Array.from({ length: 101 }, (_, i) => ({ email: `contact${i}@example.invalid`, full_name: `Test ${i}` }));
  let batches = 0;
  const { svc } = service(database({ profiles: contacts }), async () => { if (++batches === 2) throw new Error('timeout'); });
  const draft = message({ emails: contacts.map((contact) => contact.email) });
  const result = await svc.send(draft, user);
  assert.equal(result.accepted, 100); assert.equal(result.total, 101); assert.equal(result.status, 'failed');
  await svc.send(draft, user);
  assert.equal(batches, 2);
});

test('concurrent submissions share a durable unique claim', async () => {
  let batches = 0;
  const { svc } = service(database(), async () => { batches++; });
  const results = await Promise.allSettled([svc.send(message(), user), svc.send(message(), user)]);
  assert.equal(batches, 1);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
});
