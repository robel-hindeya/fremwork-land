// Runs every migration in supabase/migrations against a real Postgres engine (PGlite, in-process)
// and checks the row-level security rules. Supabase-managed schemas are stubbed in supabase-stubs.sql.
// No network, no Supabase project and no credentials are used.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrations = path.join(root, 'supabase/migrations');
let db;

const uid = { owner: '00000000-0000-4000-8000-000000000001', member: '00000000-0000-4000-8000-000000000002', other: '00000000-0000-4000-8000-000000000003' };

/** Runs fn as a Supabase API role, with JWT claims and request headers, rolled back afterwards. */
async function as(role, claims, fn, headers = {}) {
  let result;
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
      [JSON.stringify(claims ?? {}), JSON.stringify(headers)]);
    await tx.exec(`set local role ${role}`);
    result = await fn(tx);
    await tx.exec('reset role');
    throw Object.assign(new Error('rollback'), { rollback: true });
  }).catch((e) => { if (!e.rollback) throw e; });
  return result;
}
const anon = (fn, headers) => as('anon', { role: 'anon' }, fn, headers);
const user = (id, email, fn) => as('authenticated', { sub: id, email, role: 'authenticated' }, fn);
const rows = async (tx, sql, params) => (await tx.query(sql, params)).rows;
/** Expects the statement to fail, inside a savepoint so the surrounding transaction keeps working. */
async function fails(tx, sql, params, re) {
  await tx.exec("savepoint expect_error");
  await assert.rejects(tx.query(sql, params), re);
  await tx.exec("rollback to savepoint expect_error");
}

before(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(readFileSync(path.join(root, 'tests/db/supabase-stubs.sql'), 'utf8'));
  for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrations, file), 'utf8')
      .replace(/create extension if not exists pg_net[^;]*;/i, '-- pg_net is stubbed in tests');
    try { await db.exec(sql); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  }
  await db.exec(readFileSync(path.join(root, 'supabase/seed.sql'), 'utf8'));
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values
    ($1, 'owner@example.invalid', now()), ($2, 'member@example.invalid', now()), ($3, 'other@example.invalid', now())`,
  [uid.owner, uid.member, uid.other]);
  await db.query(`update public.profiles set role = 'owner' where id = $1`, [uid.owner]);
});

test('every migration and the seed apply cleanly in order', async () => {
  const t = await rows(db, `select count(*)::int n from pg_tables where schemaname = 'public'`);
  assert.ok(t[0].n >= 8);
  const noRls = await rows(db, `select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
  assert.deepEqual(noRls, [], 'every public table has RLS enabled');
});

test('anonymous visitors only see published events and public settings', async () => {
  await anon(async (tx) => {
    for (const t of ['waitlist_entries', 'event_registrations', 'profiles', 'app_settings', 'team_invites', 'site_visitors']) {
      assert.equal((await rows(tx, `select * from public.${t}`)).length, 0, `${t} is hidden from anon`);
    }
    const events = await rows(tx, 'select published from public.events');
    assert.ok(events.length > 0 && events.every((e) => e.published));
    assert.equal((await rows(tx, 'select * from public.published_events()')).length, events.length);
    assert.equal((await rows(tx, 'select public.public_settings() s'))[0].s.acceptSignups, true);
    await fails(tx, `select * from public.admin_email_campaigns`, [], /permission denied/);
  });
});

test('anonymous writes only go through the narrow public functions', async () => {
  await anon(async (tx) => {
    await fails(tx, `insert into public.waitlist_entries (name, email) values ('X', 'x@example.invalid')`, [], /row-level security/);
    await fails(tx, `insert into public.events (title) values ('X')`, [], /row-level security/);
    assert.equal((await tx.query(`update public.app_settings set accept_signups = false`)).affectedRows, 0);
    await tx.query(`select public.join_waitlist('Test Person', 'test@example.invalid', 'Co', 'Analyst')`);
    await fails(tx, `select public.join_waitlist('Test', 'not-an-email', null, 'Analyst')`, [], /valid email/);
    await fails(tx, `select public.check_registration_webhook('guess')`, [], /permission denied/);
  });
});

test('members see only their own profile and cannot touch admin data', async () => {
  await user(uid.member, 'member@example.invalid', async (tx) => {
    const p = await rows(tx, 'select id from public.profiles');
    assert.deepEqual(p.map((r) => r.id), [uid.member]);
    assert.equal((await rows(tx, 'select * from public.waitlist_entries')).length, 0);
    assert.equal((await rows(tx, 'select * from public.event_registrations')).length, 0);
    assert.equal((await tx.query(`update public.profiles set role = 'owner' where id = $1`, [uid.member])).affectedRows, 0);
    assert.equal((await tx.query(`update public.events set title = 'hacked'`)).affectedRows, 0);
    assert.equal((await tx.query(`delete from public.events`)).affectedRows, 0);
    await fails(tx, `insert into public.team_invites (email) values ('me2@example.invalid')`, [], /row-level security/);
  });
});

test('owners and admins read and manage everything', async () => {
  await user(uid.owner, 'owner@example.invalid', async (tx) => {
    assert.equal((await rows(tx, 'select * from public.profiles')).length, 3);
    assert.ok((await rows(tx, 'select * from public.waitlist_entries')).length >= 12);
    const all = await rows(tx, 'select published from public.events');
    assert.ok(all.some((e) => !e.published), 'admins see drafts');
    await tx.query(`insert into public.events (title) values ('Admin test event')`);
    assert.equal((await tx.query(`update public.events set capacity = 5 where title = 'Admin test event'`)).affectedRows, 1);
    assert.equal((await tx.query(`delete from public.events where title = 'Admin test event'`)).affectedRows, 1);
  });
});

test('a team invite grants its role only after the email is confirmed', async () => {
  await db.query(`insert into public.team_invites (email, role) values ('newadmin@example.invalid', 'admin')`);
  const id = (await rows(db, `insert into auth.users (email) values ('newadmin@example.invalid') returning id`))[0].id;
  assert.equal((await rows(db, 'select role from public.profiles where id = $1', [id]))[0].role, 'member');
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [id]);
  assert.equal((await rows(db, 'select role from public.profiles where id = $1', [id]))[0].role, 'admin');
  // Accepted invites never re-grant to a later account with the same address.
  await db.query('delete from auth.users where id = $1', [id]);
  const again = (await rows(db, `insert into auth.users (email, email_confirmed_at) values ('newadmin@example.invalid', now()) returning id`))[0].id;
  assert.equal((await rows(db, 'select role from public.profiles where id = $1', [again]))[0].role, 'member');
});

test('event capacity, duplicate registrations and cancel tokens are enforced', async () => {
  const ev = (await rows(db, `insert into public.events (title, capacity, published) values ('Tiny', 1, true) returning id`))[0].id;
  const reg = await anon(async (tx) => {
    const r = (await rows(tx, `select public.register_for_event($1, '{"name":"A","email":"a@example.invalid"}') j`, [ev]))[0].j;
    await fails(tx, `select public.register_for_event($1, '{"name":"A","email":"A@example.invalid"}')`, [ev], /already registered|full/);
    await fails(tx, `select public.register_for_event($1, '{"name":"B","email":"b@example.invalid"}')`, [ev], /full/);
    const wrong = (await rows(tx, `select public.cancel_registration($1, gen_random_uuid()) j`, [r.id]))[0].j;
    assert.equal(wrong.ok, false);
    const right = (await rows(tx, `select public.cancel_registration($1, $2) j`, [r.id, r.cancelToken]))[0].j;
    assert.equal(right.ok, true);
    return r;
  });
  assert.ok(reg.id);
});

test('registration emails are queued to this project URL from Vault', async () => {
  await db.query(`select vault.create_secret('https://example-ref.supabase.co/', 'project_url')`);
  const ev = (await rows(db, `select id from public.events where published limit 1`))[0].id;
  await db.query(`insert into public.event_registrations (event_id, name, email) values ($1, 'Q', 'queue@example.invalid')`, [ev]);
  const last = (await rows(db, 'select url, body from net.requests order by id desc limit 1'))[0];
  assert.equal(last.url, 'https://example-ref.supabase.co/functions/v1/registration-email');
  assert.ok(last.body.secret, 'webhook secret from Vault is attached');
});

test('anonymous visit tracking is capped per IP to protect free-plan storage', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Mozilla/5.0 test' };
  await anon((tx) => tx.query(`select public.track_visit(gen_random_uuid(), '/')`), headers); // anon may call it
  // Count as the database owner (anon cannot read the table), outside a rolled-back transaction.
  await db.query(`select set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
  for (let i = 0; i < 70; i++) await db.query(`select public.track_visit(gen_random_uuid(), '/')`);
  const n = (await rows(db, `select count(*)::int n from public.site_visitors where ip = '203.0.113.9'`))[0].n;
  assert.equal(n, 60);
  await db.query(`select set_config('request.headers', '', false)`);
});

test('supabase/setup/full-setup.sql is current and applies to a fresh database', async () => {
  const setup = readFileSync(path.join(root, 'supabase/setup/full-setup.sql'), 'utf8');
  for (const f of readdirSync(migrations).filter((x) => x.endsWith('.sql'))) {
    assert.ok(setup.includes(readFileSync(path.join(migrations, f), 'utf8').trim()), `${f} is in full-setup.sql (run pnpm db:setup-sql)`);
  }
  const fresh = await PGlite.create({ extensions: { pgcrypto } });
  await fresh.exec(readFileSync(path.join(root, 'tests/db/supabase-stubs.sql'), 'utf8'));
  await fresh.exec(setup.replace(/create extension if not exists pg_net[^;]*;/i, '-- pg_net is stubbed in tests'));
  const n = (await fresh.query(`select count(*)::int n from pg_tables where schemaname = 'public' and rowsecurity`)).rows[0].n;
  assert.equal(n, 8);
  await fresh.close();
});
