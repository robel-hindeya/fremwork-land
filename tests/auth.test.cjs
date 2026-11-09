require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const server = require('../apps/web/lib/supabase/server.ts');
const { GET: callback } = require('../apps/web/app/auth/callback/route.ts');
const { GET: confirm } = require('../apps/web/app/auth/confirm/route.ts');

test('successful PKCE and email confirmation default to workspace, with safe recovery and explicit admin paths', async () => {
  server.getSupabaseServerClient = async () => ({ auth: {
    exchangeCodeForSession: async () => ({ error: null }), verifyOtp: async () => ({ error: null }),
  } });
  for (const [handler, params] of [[callback, 'code=one-time-test-code'], [confirm, 'token_hash=one-time-test-hash&type=email']]) {
    for (const [next, expected] of [['', '/open-app'], ['//evil.example', '/open-app'], ['/\\evil.example', '/open-app'], ['/admin', '/admin'], ['/set-password', '/set-password']]) {
      const request = new NextRequest(`https://fremwork.com/auth/callback?${params}&next=${encodeURIComponent(next || '/open-app')}`);
      const response = await handler(request);
      assert.equal(response.headers.get('location'), `https://fremwork.com${expected}`);
    }
  }
});

test('expired or invalid callback credentials return safely to login', async () => {
  server.getSupabaseServerClient = async () => ({ auth: {
    exchangeCodeForSession: async () => ({ error: { message: 'expired' } }), verifyOtp: async () => ({ error: { message: 'expired' } }),
  } });
  for (const handler of [callback, confirm]) {
    const response = await handler(new NextRequest('https://fremwork.com/auth/callback?code=expired&token_hash=expired&type=email'));
    assert.match(response.headers.get('location'), /^https:\/\/fremwork.com\/login\?error=/);
  }
});

test('canonical Supabase settings override stale named project aliases', () => {
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_FREMWORK_SUPABASE_URL', 'NEXT_PUBLIC_FREMWORK_SUPABASE_KEY'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const modulePath = require.resolve('../apps/web/lib/supabase/config.ts');
  try {
    names.forEach((name) => delete process.env[name]); delete require.cache[modulePath];
    assert.equal(require(modulePath).SUPABASE_URL, 'https://jwznteirgsnebvtswppu.supabase.co');
    process.env.NEXT_PUBLIC_FREMWORK_SUPABASE_URL = 'https://stale.example';
    process.env.NEXT_PUBLIC_FREMWORK_SUPABASE_KEY = 'stale-public-test-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://canonical.example';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'canonical-public-test-key';
    delete require.cache[modulePath];
    assert.equal(require(modulePath).SUPABASE_URL, 'https://canonical.example');
    assert.equal(require(modulePath).SUPABASE_KEY, 'canonical-public-test-key');
  } finally {
    for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    delete require.cache[modulePath];
  }
});
