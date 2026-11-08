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
