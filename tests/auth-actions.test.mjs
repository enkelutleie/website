import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { authReturnURL, passwordIssue, registerAccount, requestPasswordReset, updatePassword, readAuthCallback } from '../src/auth-actions.mjs';
const input = { email: ' tenant@example.invalid ', password: 'long-enough', confirmation: 'long-enough', accepted: true };
const url = (suffix) => new URL(`https://enkelutleie.com/logg-inn/${suffix}`);

test('registration does not contact auth without explicit acceptance or matching strong passwords', async () => {
  const client = { auth: { signUp: () => { assert.fail('Must not register'); } } };
  await assert.rejects(registerAccount(client, { ...input, accepted: false }), /vilkårene/);
  await assert.rejects(registerAccount(client, { ...input, password: 'short' }), /8 tegn/);
  await assert.rejects(registerAccount(client, { ...input, confirmation: 'different' }), /ikke like/);
  await assert.rejects(registerAccount(client, { ...input, confirmation: undefined }), /ikke like/);
});
test('registration uses same Supabase account service and existing allowed callback', async () => {
  const result = { data: { user: { id: 'test-user' }, session: null }, error: null };
  const client = { auth: { signUp: async args => { assert.deepEqual(args, { email: 'tenant@example.invalid', password: input.password, options: { emailRedirectTo: authReturnURL } }); return result; } } };
  assert.equal(await registerAccount(client, input), result);
});
test('reset request needs only the trimmed email and returns server errors', async () => {
  const result = { error: { message: 'rate limit' } };
  const client = { auth: { resetPasswordForEmail: async (...args) => { assert.deepEqual(args, ['tenant@example.invalid', { redirectTo: authReturnURL }]); return result; } } };
  assert.equal(await requestPasswordReset(client, input.email), result);
});
test('password reset rejects mismatches and short passwords before any update', async () => {
  const client = { auth: { updateUser: () => assert.fail('Must not update') } };
  await assert.rejects(updatePassword(client, 'short', 'short'), /8 tegn/);
  await assert.rejects(updatePassword(client, input.password, 'other'), /ikke like/);
});
test('password update sends only password to authenticated SDK', async () => {
  const client = { auth: { updateUser: async args => { assert.deepEqual(args, { password: input.password }); return { error: null }; } } };
  assert.equal((await updatePassword(client, input.password, input.password)).error, null);
});
test('eight grapheme password matches native validation', () => {
  assert.ok(passwordIssue('👨‍👩‍👧‍👦'.repeat(7)));
  assert.equal(passwordIssue('👨‍👩‍👧‍👦'.repeat(8)), null);
});
test('PKCE recovery comes from SDK result rather than an untrusted URL flag', async () => {
  const session = { user: { id: 'test-user' } };
  let redirectType = 'recovery';
  const client = { auth: { exchangeCodeForSession: async code => { assert.equal(code, 'test-code'); return { data: { session, redirectType }, error: null }; } } };
  assert.equal((await readAuthCallback(client, url('?code=test-code'))).recovery, true);
  redirectType = null;
  assert.equal((await readAuthCallback(client, url('?code=test-code&flow=password-recovery'))).recovery, false);
});
test('flow marker alone never creates a recovery session', async () => {
  assert.deepEqual(await readAuthCallback({}, url('?flow=password-recovery')), { callback: false, recovery: false });
});
test('callback errors win over code and never exchange credentials', async () => {
  const result = await readAuthCallback({}, url('?code=unused&error_description=expired'));
  assert.equal(result.error.message, 'expired');
  assert.equal(result.callback, true);
});
test('expired exchange retains its error and yields no session', async () => {
  const error = { message: 'invalid code' };
  const client = { auth: { exchangeCodeForSession: async () => ({ data: { session: null }, error }) } };
  const result = await readAuthCallback(client, url('?code=expired'));
  assert.equal(result.error, error);
  assert.equal(result.data.session, null);
});
test('implicit callback requires both tokens and uses SDK session validation', async () => {
  assert.ok((await readAuthCallback({}, url('#access_token=test-access&type=recovery'))).error);
  const client = { auth: { setSession: async args => { assert.deepEqual(args, { access_token: 'test-access', refresh_token: 'test-refresh' }); return { data: { session: { user: { id: 'test-user' } } }, error: null }; } } };
  assert.equal((await readAuthCallback(client, url('#access_token=test-access&refresh_token=test-refresh&type=recovery'))).recovery, true);
});
test('both legal pages preserve the app documents paragraph text', () => {
  const decode = text => text.replace(/&amp;/g, '&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');
  const normalize = text => text.replace(/\*\*/g,'').replace(/\s+/g,' ').trim();
  // Normalized app legal documents, iOS 7a39eb52 (docs/legal).
  const expected = {
    vilkar: 'c977babb97439ca02c884498f860880e5fb9007bfa8cf7210e553e5eddeddd5a',
    personvern: '833250bfacee41d5b9ba8b706f9424c1422e5dce6b215ade4c481411f4b28006',
  };
  for (const slug of Object.keys(expected)) {
    const html = readFileSync(new URL(`../${slug}/index.html`, import.meta.url), 'utf8');
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)[1];
    const actual = normalize(decode(main.replace(/<\/?strong>/g,'').replace(/<a[^>]*>|<\/a>/g,'').replace(/<[^>]+>/g,' ')));
    assert.equal(createHash('sha256').update(actual).digest('hex'), expected[slug]);
  }
});

test('invalid email never triggers signup or recovery delivery', async () => {
  await assert.rejects(registerAccount({}, { ...input, email: 'invalid' }), /e-post/);
  await assert.rejects(requestPasswordReset({}, ''), /e-post/);
});
