const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 57. Auth Email Hook (Supabase Send Email Hook → Resend).
// Assinatura REAL via `standardwebhooks` (valores fictícios).
// Resend mockado. Nenhum e-mail real, nenhum segredo real.

const { Webhook } = require('standardwebhooks');
const handler = require('../api/send-auth-email');

const FAKE_HOOK_SECRET_B64 = Buffer.from('ficticio-hook-32bytes-para-testes!!').toString('base64');
const ENV = {
  SEND_EMAIL_HOOK_SECRET: 'v1,whsec_' + FAKE_HOOK_SECRET_B64,
  RESEND_API_KEY: 're_ficticia_auth_email_testes',
  AUTH_EMAIL_FROM: 'Linsora <ola@exemplo.com.br>',
  AUTH_EMAIL_FROM_NAME: '',
  LINSORA_SUPABASE_URL: 'https://supabase-ficticia-authemail.supabase.co',
  AUTH_EMAIL_APP_URL: 'https://app-exemplo.com',
};

const USER_ID = '11111111-2222-4333-8444-555555555555';
const USER_EMAIL = 'cadastro.ficticio@exemplo.com';
const NEW_EMAIL = 'novo.ficticio@exemplo.com';

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headersSent: {},
    setHeader(k, v) { this.headersSent[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
  };
}

function baseEmailData(overrides) {
  return Object.assign({
    token: '123456',
    token_hash: 'hashficticio1234567890abcdef',
    redirect_to: 'https://app-exemplo.com/?email_confirmed=1',
    email_action_type: 'signup',
    site_url: 'https://app-exemplo.com',
    token_new: '',
    token_hash_new: '',
  }, overrides || {});
}

function basePayload(actionType, emailDataOverrides, userOverrides) {
  return {
    user: Object.assign({
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: USER_EMAIL,
      user_metadata: { full_name: 'Ana Souza' },
    }, userOverrides || {}),
    email_data: baseEmailData(Object.assign({ email_action_type: actionType }, emailDataOverrides || {})),
  };
}

// Assina o payload BRUTO exatamente como o Supabase faria.
function signedReq(payloadObj, secretB64, headerOverrides) {
  const raw = JSON.stringify(payloadObj);
  const wh = new Webhook(secretB64);
  const id = 'msg-ficticia-' + Math.floor(Math.random() * 1000000);
  const sig = wh.sign(id, new Date(), raw);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    method: 'POST',
    headers: Object.assign({
      'webhook-id': id,
      'webhook-timestamp': ts,
      'webhook-signature': sig,
    }, headerOverrides || {}),
    body: raw,
  };
}

function makeResend(options) {
  const opts = options || {};
  const calls = [];
  async function fetchImpl(url, reqOpts) {
    calls.push({ url, headers: (reqOpts && reqOpts.headers) || {}, body: reqOpts && reqOpts.body ? JSON.parse(reqOpts.body) : undefined });
    if (opts.fail) {
      return { ok: false, status: 500, json: async () => ({ error: 'ficticio' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'em-ficticio-auth-1' }) };
  }
  return { calls, fetchImpl };
}

async function captureLogs(fn) {
  const out = [];
  const orig = console.log;
  console.log = (...args) => out.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return out.join('\n');
}

test.describe('57. Auth Email Hook → Resend', () => {
  test('1. GET rejeitado com 405', async () => {
    const fake = makeResend();
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, body: null }, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(405);
    expect(fake.calls).toHaveLength(0);
  });

  test('2. POST sem assinatura rejeitado com 401', async () => {
    const fake = makeResend();
    const res = mockRes();
    await handler(
      { method: 'POST', headers: {}, body: JSON.stringify(basePayload('signup')) },
      res, { env: ENV, fetchImpl: fake.fetchImpl }
    );
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'invalid-signature' });
    expect(fake.calls).toHaveLength(0);
  });

  test('3. assinatura inválida rejeitada com 401', async () => {
    const fake = makeResend();
    const req = signedReq(basePayload('signup'), FAKE_HOOK_SECRET_B64);
    req.headers['webhook-signature'] = 'v1,assinatura-ficticia-invalida';
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });

  test('4. payload assinado sem estruturas mínimas rejeitado com 400', async () => {
    const fake = makeResend();
    const req = signedReq({ user: { id: USER_ID }, email_data: {} }, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ ok: false, error: 'bad-payload' });
    expect(fake.calls).toHaveLength(0);
  });

  test('5. signup válido envia com link oficial de verificação', async () => {
    const fake = makeResend();
    const payload = basePayload('signup');
    const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.body.to).toEqual([USER_EMAIL]);
    expect(call.body.subject).toBe('Confirme seu cadastro no Linsora');
    expect(call.body.from).toBe(ENV.AUTH_EMAIL_FROM);
    expect(call.body.html).toContain('/auth/v1/verify?');
    expect(call.body.html).toContain('token=' + payload.email_data.token_hash.slice(0, 12));
    expect(call.body.html).toContain('type=signup');
    expect(call.body.html).toContain('email_confirmed');
    expect(call.headers['Idempotency-Key']).toContain('linsora-authemail-signup-');
    expect(call.body.text).toContain('https://supabase-ficticia-authemail.supabase.co/auth/v1/verify?');
  });

  test('6. recovery válido preserva redirect para reset-password.html', async () => {
    const fake = makeResend();
    const recoveryUrl = 'https://app-exemplo.com/reset-password.html';
    const payload = basePayload('recovery', { redirect_to: recoveryUrl });
    const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    const call = fake.calls[0];
    expect(call.body.subject).toBe('Redefina sua senha do Linsora');
    expect(call.body.html).toContain('type=recovery');
    expect(call.body.html).toContain(encodeURIComponent(recoveryUrl));
  });

  test('7. password_changed_notification: sem link, sem token, com orientação', async () => {
    const fake = makeResend();
    const payload = basePayload('password_changed_notification', { token: '', token_hash: '' });
    const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    const call = fake.calls[0];
    expect(call.body.subject).toBe('Sua senha foi alterada no Linsora');
    expect(call.body.html).not.toContain('<a ');
    expect(call.body.html).not.toContain('/auth/v1/verify');
    expect(call.body.text).toContain('redefinir sua senha imediatamente');
  });

  test('8. email_change seguro: 2 e-mails com mapeamento oficial invertido', async () => {
    const fake = makeResend();
    const payload = basePayload('email_change', {
      token: '111111', token_hash_new: 'hashatual1234567890abcdef',
      token_new: '222222', token_hash: 'hashnovo1234567890abcdef12',
    }, { new_email: NEW_EMAIL });
    const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    expect(fake.calls).toHaveLength(2);
    // 1º: endereço ATUAL com (token, token_hash_new), sem link de confirmação.
    expect(fake.calls[0].body.to).toEqual([USER_EMAIL]);
    expect(fake.calls[0].body.html).not.toContain('/auth/v1/verify');
    // 2º: endereço NOVO com (token_new, token_hash) e link oficial.
    expect(fake.calls[1].body.to).toEqual([NEW_EMAIL]);
    expect(fake.calls[1].body.html).toContain('token=hashnovo1234567890abcdef12');
    expect(fake.calls[1].body.html).toContain('type=email_change');
  });

  test('8b. email_change simples: 1 e-mail para o endereço novo', async () => {
    const fake = makeResend();
    const payload = basePayload('email_change', {
      token: '', token_hash_new: '', token_new: '333333', token_hash: 'hashnovo9999abcd',
    }, { new_email: NEW_EMAIL });
    const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].body.to).toEqual([NEW_EMAIL]);
  });

  test('9. evento desconhecido: 200 sem enviar nada errado', async () => {
    const fake = makeResend();
    const req = signedReq(basePayload('magiclink'), FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, skipped: 'unsupported-email-type' });
    expect(fake.calls).toHaveLength(0);
  });

  test('10/11/12/13. token, token_hash, secret e RESEND_API_KEY fora dos logs', async () => {
    const fake = makeResend();
    const payload = basePayload('recovery', { token_hash: 'hashsigiloso777', token: '999888' });
    const logs = await captureLogs(async () => {
      const req = signedReq(payload, FAKE_HOOK_SECRET_B64);
      const res = mockRes();
      await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
      expect(res.statusCode).toBe(200);
    });
    expect(logs).not.toContain('hashsigiloso777');
    expect(logs).not.toContain('999888');
    expect(logs).not.toContain(FAKE_HOOK_SECRET_B64);
    expect(logs).not.toContain(ENV.RESEND_API_KEY);
    expect(logs).not.toContain(USER_EMAIL);
    expect(logs).toContain('[SendAuthEmail]');
  });

  test('14. falha do Resend tratada com 502 sem vazar nada', async () => {
    const fake = makeResend({ fail: true });
    const logs = await captureLogs(async () => {
      const req = signedReq(basePayload('signup'), FAKE_HOOK_SECRET_B64);
      const res = mockRes();
      await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
      expect(res.statusCode).toBe(502);
      expect(res.payload).toEqual({ ok: false, error: 'auth-email-send-failed' });
    });
    expect(logs).not.toContain(ENV.RESEND_API_KEY);
  });

  test('15. corpo já parseado (objeto) é rejeitado fail-closed', async () => {
    const fake = makeResend();
    const res = mockRes();
    await handler(
      { method: 'POST', headers: { 'webhook-id': 'x', 'webhook-timestamp': '1', 'webhook-signature': 'v1,y' }, body: basePayload('signup') },
      res, { env: ENV, fetchImpl: fake.fetchImpl }
    );
    expect(res.statusCode).toBe(401);
    expect(fake.calls).toHaveLength(0);
  });

  test('15b. corpo via stream Node é verificado e aceito', async () => {
    const fake = makeResend();
    const raw = JSON.stringify(basePayload('signup'));
    const req = signedReq({ __placeholder: true }, FAKE_HOOK_SECRET_B64);
    // Reassina o corpo real que viajará pelo stream.
    const wh = new Webhook(FAKE_HOOK_SECRET_B64);
    const id = 'msg-stream-ficticia-1';
    req.headers['webhook-id'] = id;
    req.headers['webhook-signature'] = wh.sign(id, new Date(), raw);
    req.headers['webhook-timestamp'] = String(Math.floor(Date.now() / 1000));
    const listeners = {};
    req.body = undefined;
    req.readableEnded = false;
    req.destroyed = false;
    req.on = (ev, fn) => {
      listeners[ev] = listeners[ev] || [];
      listeners[ev].push(fn);
      if (ev === 'end') {
        setImmediate(() => {
          (listeners.data || []).forEach((fn2) => fn2(Buffer.from(raw.slice(0, 40), 'utf8')));
          (listeners.data || []).forEach((fn2) => fn2(Buffer.from(raw.slice(40), 'utf8')));
          (listeners.end || []).forEach((fn2) => fn2());
        });
      }
      return req;
    };
    const res = mockRes();
    await handler(req, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    expect(fake.calls).toHaveLength(1);
  });

  test('16. frontend não contém secrets do hook', async () => {
    for (const rel of ['index.html', 'js/app.js', 'js/supabase-client.js', 'reset-password.html']) {
      const src = readSource(rel);
      expect(src).not.toContain('SEND_EMAIL_HOOK_SECRET');
      expect(src).not.toContain('RESEND_API_KEY');
      expect(src).not.toContain('standardwebhooks');
    }
    const apiSrc = readSource('api/send-auth-email.js');
    expect(apiSrc).not.toMatch(/re_[A-Za-z0-9_-]{10,}/);
    expect(apiSrc).not.toContain(FAKE_HOOK_SECRET_B64);
  });

  test('17. fluxo de recovery existente intacto', async () => {
    const recoveryPage = readSource('reset-password.html');
    expect(recoveryPage).toContain('detectSessionInUrl: true');
    expect(recoveryPage).toContain('PASSWORD_RECOVERY');
    expect(recoveryPage).toContain('updateUser');
    const client = readSource('js/supabase-client.js');
    expect(client).toContain('resetPasswordForEmail');
    expect(client).toContain('reset-password.html');
  });

  test('18. fluxo de confirmação existente intacto', async () => {
    const client = readSource('js/supabase-client.js');
    expect(client).toContain('emailRedirectTo');
    expect(client).toContain('email_confirmed=1');
    const app = readSource('js/app.js');
    expect(app).toContain('email_confirmed');
    expect(app).toContain('exchangeCodeForSession');
    const hook = readSource('api/send-auth-email.js');
    expect(hook).not.toContain('handle_welcome_email');
    expect(hook).not.toContain('welcome_emails');
  });

  test('env ausente retorna 503 sem vazar detalhe', async () => {
    const fake = makeResend();
    const req = signedReq(basePayload('signup'), FAKE_HOOK_SECRET_B64);
    const res = mockRes();
    await handler(req, res, { env: {}, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ ok: false, error: 'auth-email-unconfigured' });
    expect(fake.calls).toHaveLength(0);
  });
});
