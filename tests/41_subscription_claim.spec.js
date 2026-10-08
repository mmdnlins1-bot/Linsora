const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 41. Claim de assinatura pós-compra (compra antes do cadastro).
// Isolated: handler invocado com req/res simulados + fetch Supabase mockado
// via deps { env, fetchImpl }. Sem Supabase/Hotmart reais, sem segredos reais.

const handler = require('../api/claim-subscription');

const FAKE_URL = 'https://supabase-ficticio.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-ficticia-para-testes-000';
const FAKE_OFFER_MENSAL = 'OFF-MENSAL-FICTICIA';
const FAKE_OFFER_ANUAL = 'OFF-ANUAL-FICTICIA';
const FAKE_TOKEN = 'token-ficticio-de-sessao-abc123';
const TOKEN_USER_ID = 'auth-user-ficticio-0001';
const TOKEN_EMAIL = 'compradora.ficticia@exemplo.com';

function testEnv(overrides = {}) {
  const env = {
    LINSORA_SUPABASE_URL: FAKE_URL,
    SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY,
    HOTMART_OFFER_MENSAL: FAKE_OFFER_MENSAL,
    HOTMART_OFFER_ANUAL: FAKE_OFFER_ANUAL,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function makeReqRes({ method = 'POST', headers = null, body = undefined } = {}) {
  const req = {
    method,
    headers: headers === null ? { Authorization: 'Bearer ' + FAKE_TOKEN } : headers,
    body,
  };
  const res = {
    statusCode: null,
    payload: null,
    headersSent: {},
    setHeader(k, v) { this.headersSent[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
  };
  return { req, res };
}

// Mock PostgREST + Auth com store em memória (merge por user_id/event_id).
function makeSupabaseMock({ orphans = [], badToken = false, unconfirmed = false } = {}) {
  const state = {
    calls: [],
    upserts: [],
    patches: [],
    store: { events: new Map(), subs: new Map() },
  };
  for (const o of orphans) {
    state.store.events.set(o.hotmart_event_id, { ...o });
  }
  function jsonBody(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  }
  function emptyBody() {
    return {
      ok: true,
      status: 204,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    };
  }
  async function fetchImpl(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : undefined;
    const preferHeaders = options.headers || {};
    const prefer = preferHeaders.Prefer || preferHeaders.prefer || '';
    state.calls.push({ method, table, path: u.pathname, query: u.search, body });
    if (u.pathname.endsWith('/auth/v1/user')) {
      if (badToken) return jsonBody({ message: 'invalid' }, 401);
      // Por padrão o usuário do token está CONFIRMADO (fluxo atual).
      // Com unconfirmed:true, simula e-mail ainda não confirmado.
      if (unconfirmed) return jsonBody({ id: TOKEN_USER_ID, email: TOKEN_EMAIL });
      return jsonBody({ id: TOKEN_USER_ID, email: TOKEN_EMAIL, email_confirmed_at: '2026-01-01T00:00:00.000Z' });
    }
    if (table === 'subscription_events' && method === 'GET') {
      const onlyOrphans = u.search.includes('user_id=is.null');
      const rows = Array.from(state.store.events.values()).filter(
        (r) => !onlyOrphans || r.user_id === null || r.user_id === undefined
      );
      return jsonBody(rows);
    }
    if (table === 'subscriptions' && method === 'POST') {
      const uid = body.user_id;
      const merged = { ...(state.store.subs.get(uid) || {}), ...body };
      if (!merged.id) merged.id = 'sub-row-ficticia-1';
      state.store.subs.set(uid, merged);
      state.upserts.push(body);
      return jsonBody([merged], 201);
    }
    if (table === 'subscription_events' && (method === 'PATCH' || method === 'PUT')) {
      const m = u.search.match(/hotmart_event_id=eq\.([^&]*)/);
      const row = m ? state.store.events.get(decodeURIComponent(m[1])) : null;
      if (row) Object.assign(row, body);
      state.patches.push({ query: u.search, body });
      if (String(prefer).indexOf('return=representation') < 0) return emptyBody();
      return jsonBody([]);
    }
    return jsonBody({ message: 'rota-nao-mapeada' }, 400);
  }
  return { state, fetchImpl };
}

function orphanRow({ id, event, email, ucode = 'UCODE-FICTICIO-1', subscriber = 'SUB-FICTICIO-1', offer = FAKE_OFFER_MENSAL, planName = 'Mensal', creation = 1780000000000, approved = 1780000000000, next = 1782592000000 } = {}) {
  return {
    id: 'row-' + id,
    hotmart_event_id: id,
    event_type: event,
    user_id: null,
    subscription_id: null,
    plan: null,
    status_after: null,
    raw: {
      id,
      event,
      creation_date: creation,
      data: {
        buyer: { email, ucode },
        purchase: {
          transaction: 'HP-' + id,
          approved_date: approved,
          date_next_charge: next,
          offer: { code: offer },
        },
        subscription: { subscriber: { code: subscriber }, plan: { name: planName } },
      },
    },
  };
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

test.describe('41. Claim de assinatura pos-compra', () => {
  test('1. GET rejeitado com 405', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({ method: 'GET' });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(405);
    expect(res.payload.ok).toBe(false);
    expect(mock.state.calls).toHaveLength(0);
  });

  test('2. ausencia de Authorization rejeitada com 401', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({ headers: {} });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'missing_token' });
  });

  test('3. user_id e email do body sao ignorados', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-ign', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({
      body: { user_id: 'atacante-ficticio', email: 'atacante@exemplo.com' },
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload.claimed).toBe(true);
    expect(mock.state.upserts).toHaveLength(1);
    expect(mock.state.upserts[0].user_id).toBe(TOKEN_USER_ID);
    expect(mock.state.upserts[0].email).toBe(TOKEN_EMAIL);
  });

  test('4. sem compra correspondente retorna claimed=false', async () => {
    const mock = makeSupabaseMock({ orphans: [] });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: false });
    expect(mock.state.upserts).toHaveLength(0);
  });

  test('5. orfao aprovado vincula ao usuario', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-claim-1', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'mensal' });
    expect(mock.state.upserts).toHaveLength(1);
    expect(mock.state.patches).toHaveLength(1);
    const stored = mock.state.store.events.get('evt-ficticio-claim-1');
    expect(stored.user_id).toBe(TOKEN_USER_ID);
    expect(stored.subscription_id).toBe('sub-row-ficticia-1');
  });

  test('6. cancelado mais recente prevalece sobre aprovado antigo', async () => {
    const mock = makeSupabaseMock({
      orphans: [
        orphanRow({ id: 'evt-ficticio-old-ap', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL, creation: 1777000000000, approved: 1777000000000, next: 1779592000000 }),
        { ...orphanRow({ id: 'evt-ficticio-new-ca', event: 'SUBSCRIPTION_CANCELLATION', email: TOKEN_EMAIL, creation: 1781000000000 }), raw: undefined },
      ],
    });
    // Ajusta o raw do cancelamento (sem purchase aprovado antigo).
    const cancelRow = mock.state.store.events.get('evt-ficticio-new-ca');
    cancelRow.raw = {
      id: 'evt-ficticio-new-ca',
      event: 'SUBSCRIPTION_CANCELLATION',
      creation_date: 1781000000000,
      data: {
        subscriber: { email: TOKEN_EMAIL, code: 'SUB-FICTICIO-1' },
        subscription: { plan: { name: 'Mensal' } },
        date_next_charge: 1782592000000,
      },
    };
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: true, status: 'canceled', plan: 'mensal' });
  });

  test('7. antigo nao sobrescreve estado mais novo', async () => {
    const mock = makeSupabaseMock({
      orphans: [
        orphanRow({ id: 'evt-ficticio-new-ap', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL, creation: 1781000000000, approved: 1781000000000, next: 1783592000000 }),
        orphanRow({ id: 'evt-ficticio-old-ca', event: 'PURCHASE_CANCELED', email: TOKEN_EMAIL, creation: 1777000000000, approved: 1777000000000, next: 1779592000000 }),
      ],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'mensal' });
    expect(mock.state.store.subs.get(TOKEN_USER_ID).current_period_end).toBe(
      new Date(1783592000000).toISOString()
    );
  });

  test('8. claim repetido e idempotente', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-rep', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const env = testEnv();
    const first = makeReqRes({});
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'mensal' });
    const second = makeReqRes({});
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(second.res.payload).toEqual({ ok: true, claimed: false });
    expect(mock.state.upserts).toHaveLength(1);
    expect(mock.state.store.subs.size).toBe(1);
  });

  test('9. e-mail diferente nao vincula', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-outro', event: 'PURCHASE_APPROVED', email: 'outra.pessoa@exemplo.com' })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: false });
    expect(mock.state.upserts).toHaveLength(0);
    expect(mock.state.patches).toHaveLength(0);
  });

  test('10. plano mensal reconhecido', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-m', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL, offer: FAKE_OFFER_MENSAL, planName: 'Mensal' })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'mensal' });
  });

  test('11. plano anual reconhecido', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-a', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL, offer: FAKE_OFFER_ANUAL, planName: 'Anual' })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'anual' });
  });

  test('12. token invalido rejeitado com 401', async () => {
    const mock = makeSupabaseMock({ badToken: true });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'invalid_token' });
  });

  test('13. env ausente retorna 500', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(500);
    expect(res.payload.ok).toBe(false);
  });

  test('14. SWITCH_PLAN ignorado para assinatura', async () => {
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-sw', event: 'SWITCH_PLAN', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, claimed: false });
    expect(mock.state.upserts).toHaveLength(0);
  });

  test('14b. usuario NAO confirmado e recusado sem vincular', async () => {
    const mock = makeSupabaseMock({
      unconfirmed: true,
      orphans: [orphanRow({ id: 'evt-ficticio-nao-confirmado', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({});
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ ok: false, error: 'email-not-confirmed' });
    expect(mock.state.upserts).toHaveLength(0);
    expect(mock.state.patches).toHaveLength(0);
  });

  test('14c. usuario NAO confirmado com body adulterado continua recusado', async () => {
    const mock = makeSupabaseMock({
      unconfirmed: true,
      orphans: [orphanRow({ id: 'evt-ficticio-nao-conf-2', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({
      body: { user_id: 'atacante-ficticio', email: 'atacante@exemplo.com' },
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(403);
    expect(res.payload).toEqual({ ok: false, error: 'email-not-confirmed' });
    expect(mock.state.upserts).toHaveLength(0);
    expect(mock.state.patches).toHaveLength(0);
  });

  test('15. segredos nunca aparecem no codigo nem nos logs', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'api', 'claim-subscription.js'),
      'utf8'
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    const scrubbed = code.split('SUPABASE_SERVICE_ROLE_KEY').join('').split('LINSORA_SUPABASE_URL').join('');
    expect(scrubbed.toLowerCase()).not.toContain('service_role');
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(code).not.toMatch(/sk_(live|test)_/);
    const mock = makeSupabaseMock({
      orphans: [orphanRow({ id: 'evt-ficticio-log', event: 'PURCHASE_APPROVED', email: TOKEN_EMAIL })],
    });
    const { req, res } = makeReqRes({});
    const logs = await captureLogs(() => handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl }));
    expect(res.statusCode).toBe(200);
    expect(logs).not.toContain(FAKE_SERVICE_KEY);
    expect(logs).not.toContain(TOKEN_EMAIL);
  });

  test('16. cliente sem sessao retorna erro controlado', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.supabaseRepo, { timeout: 10000 });
    const result = await page.evaluate(() => {
      window.supabaseRepo.supabase = null;
      return window.supabaseRepo.claimSubscription();
    });
    expect(result.success).toBe(false);
  });

  test('17. cliente envia token e interpreta resposta', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.supabaseRepo, { timeout: 10000 });
    await page.route('/api/claim-subscription', async (route) => {
      const auth = route.request().headers().authorization || '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, claimed: auth.startsWith('Bearer tok-ficticio'), status: 'active', plan: 'mensal' }),
      });
    });
    const result = await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          getSession: async () => ({ data: { session: { access_token: 'tok-ficticio-123' } }, error: null }),
        },
      };
      return window.supabaseRepo.claimSubscription();
    });
    expect(result).toEqual({ success: true, claimed: true, status: 'active', plan: 'mensal' });
    await page.unroute('/api/claim-subscription');
  });
});
