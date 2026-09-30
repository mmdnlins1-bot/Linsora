const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 39. Webhook Hotmart V2 — Etapa 1 (recepção autenticada + registro comercial).
// Não usa navegador, servidor, Supabase real nem Hotmart real: o handler recebe
// req/res simulados e um fetch Supabase mockado via deps { env, fetchImpl }.
// Todos os segredos/valores aqui são FICTÍCIOS.
// Não altera nenhum teste existente (27, 28 e 30 a 38 intactos).

const handler = require('../api/hotmart-webhook');

const FAKE_HOTTOK = 'hottok-ficticio-de-teste-abc123';
const WRONG_HOTTOK = 'hottok-ficticio-errado-xyz789';
const FAKE_SERVICE_KEY = 'service-role-ficticia-para-testes-000';
const FAKE_SUPABASE_URL = 'https://supabase-ficticio.supabase.co';
const FAKE_OFFER_MENSAL = 'OFF-MENSAL-FICTICIA';
const FAKE_OFFER_ANUAL = 'OFF-ANUAL-FICTICIA';
const FAKE_EMAIL = 'compradora.ficticia@exemplo.com';
const FAKE_USER_ID = 'user-ficticio-0001';

function testEnv(overrides = {}) {
  const env = {
    HOTMART_HOTTOK: FAKE_HOTTOK,
    LINSORA_SUPABASE_URL: FAKE_SUPABASE_URL,
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

function makeReqRes({ method = 'POST', headers = {}, body = undefined } = {}) {
  const req = { method, headers, body };
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

// Mock do PostgREST com semântica fiel ao servidor real:
// - POST com return=representation -> 201 + corpo; PATCH com representation
//   -> 200 + corpo; PATCH sem representation (ou patch204:true) -> 204 SEM
//   corpo (json() lança, como no fetch real) — reproduz o comportamento que
//   o código precisa tolerar.
// - subscriptions mescla por user_id (merge-duplicates); eventos indexados
//   por hotmart_event_id (409 em duplicado); PATCH aplica no registro.
// - Opções: profile (objeto ou null), existingSubscription (pré-cadastrada),
//   failOn ("METODO tabela" que falha, ex. "GET profiles"), patch204 (força
//   204 vazio nos PATCHs), setFail(v) para alternar falha no meio do teste.
function makeSupabaseMock({ profile = null, existingSubscription = null, failOn = null, patch204 = false } = {}) {
  const state = {
    calls: [],
    eventInserts: [],
    eventPatches: [],
    subscriptionUpserts: [],
    subscriptionPatches: [],
    store: { events: new Map(), subs: new Map() },
  };
  if (existingSubscription && existingSubscription.user_id) {
    state.store.subs.set(existingSubscription.user_id, { ...existingSubscription });
  }
  const options = { failOn, patch204 };
  function matchEq(search, key) {
    const m = String(search || '').match(new RegExp('[?&]' + key + '=eq\\.([^&]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function emptyBody() {
    return {
      ok: true,
      status: 204,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    };
  }
  function jsonBody(data, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  }
  async function fetchImpl(url, options2 = {}) {
    const method = (options2.method || 'GET').toUpperCase();
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const body = options2.body ? JSON.parse(options2.body) : undefined;
    const preferHeaders = options2.headers || {};
    const prefer = preferHeaders.Prefer || preferHeaders.prefer || '';
    state.calls.push({ method, table, query: u.search, body, prefer });
    if (options.failOn && `${method} ${table}`.includes(options.failOn)) {
      return jsonBody({ message: 'falha-ficticia' }, 500);
    }
    if (table === 'profiles' && method === 'GET') {
      return jsonBody(profile ? [profile] : []);
    }
    if (table === 'subscriptions' && method === 'GET') {
      const uid = matchEq(u.search, 'user_id');
      const row = uid ? state.store.subs.get(uid) : null;
      return jsonBody(row ? [row] : []);
    }
    if (table === 'subscription_events' && method === 'GET') {
      const eid = matchEq(u.search, 'hotmart_event_id');
      const row = eid ? state.store.events.get(eid) : null;
      return jsonBody(row ? [row] : []);
    }
    if (table === 'subscription_events' && method === 'POST') {
      if (state.store.events.has(body.hotmart_event_id)) {
        return jsonBody({ message: 'duplicate' }, 409);
      }
      const row = { id: 'evt-row-ficticia-' + (state.store.events.size + 1), ...body };
      state.store.events.set(body.hotmart_event_id, row);
      state.eventInserts.push(body);
      return jsonBody([row], 201);
    }
    if (table === 'subscriptions' && method === 'POST') {
      const uid = body.user_id;
      const merged = { ...(state.store.subs.get(uid) || {}), ...body };
      if (!merged.id) merged.id = 'sub-row-ficticia-1';
      state.store.subs.set(uid, merged);
      state.subscriptionUpserts.push(body);
      return jsonBody([merged], 201);
    }
    const patchReply = () => {
      if (options.patch204 || String(prefer).indexOf('return=representation') < 0) return emptyBody();
      return jsonBody([]);
    };
    if (table === 'subscription_events' && (method === 'PATCH' || method === 'PUT')) {
      const eid = matchEq(u.search, 'hotmart_event_id');
      const row = eid ? state.store.events.get(eid) : null;
      if (row) Object.assign(row, body);
      state.eventPatches.push({ query: u.search, body });
      return patchReply();
    }
    if (table === 'subscriptions' && (method === 'PATCH' || method === 'PUT')) {
      const uid = matchEq(u.search, 'user_id');
      const row = uid ? state.store.subs.get(uid) : null;
      if (row) Object.assign(row, body);
      state.subscriptionPatches.push({ query: u.search, body });
      return patchReply();
    }
    return jsonBody({ message: 'rota-nao-mapeada' }, 400);
  }
  return { state, fetchImpl, setFail(v) { options.failOn = v; } };
}

function purchasePayload(overrides = {}) {
  const base = {
    id: 'evt-ficticio-0001',
    event: 'PURCHASE_APPROVED',
    version: '2.0.0',
    data: {
      buyer: { email: FAKE_EMAIL, name: 'Compradora Ficticia', ucode: 'UCODE-FICTICIO-1' },
      purchase: {
        transaction: 'HP-FICTICIA-0001',
        status: 'APPROVED',
        approved_date: 1780000000000,
        date_next_charge: 1782592000000,
        offer: { code: FAKE_OFFER_MENSAL },
      },
      subscription: {
        subscriber: { code: 'SUB-FICTICIO-1' },
        plan: { name: 'Mensal' },
        status: 'ACTIVE',
      },
    },
  };
  return { ...base, ...overrides };
}

function authedBody(overrides) {
  return {
    headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
    body: purchasePayload(overrides),
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

test.describe('39. Webhook Hotmart (Etapa 1)', () => {
  test('1. POST sem Hottok retorna 401', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({ body: purchasePayload() });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'missing_hottok' });
    expect(mock.state.calls).toHaveLength(0);
  });

  test('2. Hottok incorreto retorna 401', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': WRONG_HOTTOK },
      body: purchasePayload(),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'invalid_hottok' });
    expect(mock.state.calls).toHaveLength(0);
  });

  test('3. segredo ausente no ambiente retorna 500', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes(authedBody());
    await handler(req, res, { env: testEnv({ HOTMART_HOTTOK: undefined }), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(500);
    expect(res.payload.ok).toBe(false);
    expect(mock.state.calls).toHaveLength(0);
  });

  test('4. LINSORA_SUPABASE_URL ausente retorna 500', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes(authedBody());
    await handler(req, res, { env: testEnv({ LINSORA_SUPABASE_URL: undefined }), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(500);
    expect(mock.state.calls).toHaveLength(0);
  });

  test('5. JSON invalido apos autenticacao retorna 400', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: '{json-invalido',
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(400);
    expect(mock.state.calls).toHaveLength(0);
  });

  test('6. GET retorna 405', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({ method: 'GET' });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(405);
    expect(res.headersSent.Allow).toBe('POST');
    expect(mock.state.calls).toHaveLength(0);
  });

  test('7. PURCHASE_APPROVED com usuario existente faz upsert mensal active', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody());
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert.user_id).toBe(FAKE_USER_ID);
    expect(upsert.email).toBe(FAKE_EMAIL);
    expect(upsert.plan).toBe('mensal');
    expect(upsert.status).toBe('active');
    expect(mock.state.eventPatches).toHaveLength(1);
    expect(mock.state.eventPatches[0].body.subscription_id).toBe('sub-row-ficticia-1');
    expect(mock.state.eventPatches[0].body.status_after).toBe('active');
  });

  test('8. usuario inexistente gera evento orfao, 200 e nenhuma subscription', async () => {
    const mock = makeSupabaseMock({ profile: null });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-orfao' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.eventInserts[0].user_id).toBeNull();
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    expect(mock.state.subscriptionPatches).toHaveLength(0);
  });

  test('9. PURCHASE_DELAYED mapeia para pending', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-delayed', event: 'PURCHASE_DELAYED' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].status).toBe('pending');
    expect(mock.state.eventPatches[0].body.status_after).toBe('pending');
  });

  test('10. PURCHASE_CANCELED mapeia para canceled sem excluir', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-canceled', event: 'PURCHASE_CANCELED' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].status).toBe('canceled');
    const tables = mock.state.calls.map((c) => c.table);
    expect(tables).not.toContain('profiles_delete');
  });

  test('11. PURCHASE_REFUNDED mapeia para refunded', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-refunded', event: 'PURCHASE_REFUNDED' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].status).toBe('refunded');
  });

  test('12. PURCHASE_CHARGEBACK mapeia para chargeback', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-chargeback', event: 'PURCHASE_CHARGEBACK' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].status).toBe('chargeback');
  });

  test('13. anual pelo offer code', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-anual' });
    payload.data.purchase.offer.code = FAKE_OFFER_ANUAL;
    payload.data.subscription.plan.name = 'Anual';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('anual');
  });

  test('14. offer desconhecida sem assinatura existente nao inventa plano', async () => {
    const mock = makeSupabaseMock({
      profile: { id: FAKE_USER_ID, email: FAKE_EMAIL },
      existingSubscription: null,
    });
    const payload = purchasePayload({ id: 'evt-ficticio-sem-plano' });
    payload.data.purchase.offer.code = 'OFF-DESCONHECIDA-FICTICIA';
    payload.data.subscription.plan.name = 'Plano Misterioso Ficticio';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    expect(mock.state.subscriptionPatches).toHaveLength(0);
  });

  test('15. offer desconhecida com assinatura existente atualiza so o status', async () => {
    const mock = makeSupabaseMock({
      profile: { id: FAKE_USER_ID, email: FAKE_EMAIL },
      existingSubscription: { id: 'sub-row-ficticia-1', user_id: FAKE_USER_ID, status: 'active' },
    });
    const payload = purchasePayload({ id: 'evt-ficticio-plano-ausente', event: 'PURCHASE_CANCELED' });
    payload.data.purchase.offer.code = 'OFF-DESCONHECIDA-FICTICIA';
    payload.data.subscription.plan.name = 'Plano Misterioso Ficticio';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    expect(mock.state.subscriptionPatches).toHaveLength(1);
    expect(mock.state.subscriptionPatches[0].body.status).toBe('canceled');
    expect(mock.state.subscriptionPatches[0].body).not.toHaveProperty('plan');
  });

  test('16. evento duplicado tem efeito unico', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const env = testEnv();
    const first = makeReqRes(authedBody({ id: 'evt-ficticio-duplicado' }));
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.statusCode).toBe(200);
    const second = makeReqRes(authedBody({ id: 'evt-ficticio-duplicado' }));
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(second.res.payload).toEqual({ ok: true });
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.eventPatches).toHaveLength(1);
  });

  test('17. buyer ucode e subscriber code persistidos', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-codigos' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert.hotmart_buyer_ucode).toBe('UCODE-FICTICIO-1');
    expect(upsert.hotmart_subscriber_code).toBe('SUB-FICTICIO-1');
  });

  test('18. vigencia usa somente campos reais do payload', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-vigencia' });
    delete payload.data.purchase.date_next_charge;
    delete payload.data.purchase.approved_date;
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert).not.toHaveProperty('current_period_start');
    expect(upsert).not.toHaveProperty('current_period_end');
  });

  test('19. vigencia preenchida quando campos reais existem', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-vigencia-2' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert.current_period_start).toBe(new Date(1780000000000).toISOString());
    expect(upsert.current_period_end).toBe(new Date(1782592000000).toISOString());
  });

  test('20. evento desconhecido registra sem alterar assinatura', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-desconhecido', event: 'EVENTO_FICTICIO_DESCONHECIDO' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    expect(mock.state.subscriptionPatches).toHaveLength(0);
  });

  test('21. body sem id retorna 400', async () => {
    const mock = makeSupabaseMock();
    const payload = purchasePayload();
    delete payload.id;
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(400);
    expect(mock.state.calls).toHaveLength(0);
  });

  test('22. e-mail com maiusculas e espacos e normalizado na busca', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-email' });
    payload.data.buyer.email = '  Compradora.Ficticia@Exemplo.COM  ';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const lookup = mock.state.calls.find((c) => c.table === 'profiles');
    expect(lookup.query).toContain(encodeURIComponent(FAKE_EMAIL));
    expect(mock.state.subscriptionUpserts[0].email).toBe(FAKE_EMAIL);
  });

  test('23. Supabase fora retorna 500 sem mascarar', async () => {
    const mock = makeSupabaseMock({
      profile: { id: FAKE_USER_ID, email: FAKE_EMAIL },
      failOn: 'GET profiles',
    });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-erro' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ ok: false, error: 'internal_error' });
  });

  test('24. toca somente tabelas permitidas', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-escopo' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const tables = new Set(mock.state.calls.map((c) => c.table));
    for (const t of tables) {
      expect(['profiles', 'subscription_events', 'subscriptions'], t).toContain(t);
    }
  });

  test('25. Hottok e service key ficticios nunca aparecem nos logs', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-log' }));
    const logs = await captureLogs(() => handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl }));
    expect(res.statusCode).toBe(200);
    expect(logs).not.toContain(FAKE_HOTTOK);
    expect(logs).not.toContain(WRONG_HOTTOK);
    expect(logs).not.toContain(FAKE_SERVICE_KEY);
    expect(logs).not.toContain(FAKE_EMAIL);
    expect(logs).not.toContain('HP-FICTICIA-0001');
  });

  test('26. nenhum segredo no codigo e sem acesso ao app', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'api', 'hotmart-webhook.js'),
      'utf8'
    );
    // service_role / SUPABASE_SERVICE_ROLE_KEY podem aparecer em comentarios
    // (documentacao); em codigo executavel, a UNICA ocorrencia permitida e o
    // nome da variavel de ambiente (leitura via process.env). Remove comentarios
    // e o nome da env antes de verificar valores literais.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    const scrubbed = code.split('SUPABASE_SERVICE_ROLE_KEY').join('');
    expect(scrubbed.toLowerCase()).not.toContain('service_role');
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(code).not.toMatch(/sk_(live|test)_/);
    expect(code).not.toMatch(/hottok\s*[:=]\s*['"][^'"]+['"]/i);
    expect(code).not.toMatch(/HOTMART_HOTTOK\s*\|\|/);
    expect(code).toContain('HOTMART_HOTTOK');
    // Env lida via objeto injetavel (testes) com fallback para process.env.
    expect(code).toContain('LINSORA_SUPABASE_URL');
    expect(code).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(code).toContain('options.env || process.env');
    expect(code).toContain('timingSafeEqual');
    // O endpoint nao toca no aplicativo: sem imports de js/, store ou telas.
    expect(code).not.toContain('../js');
    expect(code).not.toContain('linsoraStore');
    expect(code).not.toContain('grantAppAccess');
    for (const t of ['accounts', 'cards', 'transactions', 'goals', 'fixed_bills', 'recurring']) {
      expect(code).not.toContain(`'${t}'`);
    }
  });

  test('27. PATCH 204 sem corpo nao vira 500', async () => {
    const mock = makeSupabaseMock({
      profile: { id: FAKE_USER_ID, email: FAKE_EMAIL },
      patch204: true,
    });
    const { req, res } = makeReqRes(authedBody({ id: 'evt-ficticio-204' }));
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.eventPatches).toHaveLength(1);
  });

  test('28. duplicado completo nao escreve nada', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const env = testEnv();
    const first = makeReqRes(authedBody({ id: 'evt-ficticio-completo' }));
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.statusCode).toBe(200);
    const before = {
      upserts: mock.state.subscriptionUpserts.length,
      eventPatches: mock.state.eventPatches.length,
      subPatches: mock.state.subscriptionPatches.length,
      inserts: mock.state.eventInserts.length,
    };
    const second = makeReqRes(authedBody({ id: 'evt-ficticio-completo' }));
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(second.res.payload).toEqual({ ok: true });
    expect(mock.state.subscriptionUpserts).toHaveLength(before.upserts);
    expect(mock.state.eventPatches).toHaveLength(before.eventPatches);
    expect(mock.state.subscriptionPatches).toHaveLength(before.subPatches);
    expect(mock.state.eventInserts).toHaveLength(before.inserts);
  });

  test('29. duplicado incompleto retoma o processamento', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const env = testEnv();
    mock.setFail('POST subscriptions');
    const first = makeReqRes(authedBody({ id: 'evt-ficticio-retomar' }));
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.statusCode).toBe(500);
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    mock.setFail(null);
    const second = makeReqRes(authedBody({ id: 'evt-ficticio-retomar' }));
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(second.res.payload).toEqual({ ok: true });
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts[0].status).toBe('active');
    const stored = mock.state.store.events.get('evt-ficticio-retomar');
    expect(stored.subscription_id).toBe('sub-row-ficticia-1');
  });

  test('30. renovacao atualiza sem duplicar subscription', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const env = testEnv();
    const first = makeReqRes(authedBody({ id: 'evt-ficticio-reno-1' }));
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.statusCode).toBe(200);
    const secondPayload = purchasePayload({ id: 'evt-ficticio-reno-2' });
    secondPayload.data.purchase.transaction = 'HP-FICTICIA-0002';
    secondPayload.data.purchase.approved_date = 1785270400000;
    secondPayload.data.purchase.date_next_charge = 1787862400000;
    delete secondPayload.data.buyer.ucode;
    const second = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: secondPayload,
    });
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(mock.state.eventInserts).toHaveLength(2);
    expect(mock.state.subscriptionUpserts).toHaveLength(2);
    for (const u of mock.state.subscriptionUpserts) {
      expect(u.user_id).toBe(FAKE_USER_ID);
    }
    expect(mock.state.store.subs.size).toBe(1);
    const stored = mock.state.store.subs.get(FAKE_USER_ID);
    expect(stored.current_period_end).toBe(new Date(1787862400000).toISOString());
    expect(mock.state.subscriptionUpserts[1]).not.toHaveProperty('hotmart_buyer_ucode');
    expect(stored.hotmart_buyer_ucode).toBe('UCODE-FICTICIO-1');
  });

  test('31. approved_date ausente nao cria period_start', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-sem-approved' });
    delete payload.data.purchase.approved_date;
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert).not.toHaveProperty('current_period_start');
    expect(upsert.current_period_end).toBe(new Date(1782592000000).toISOString());
  });

  test('32. date_next_charge ausente nao cria period_end', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-sem-next' });
    delete payload.data.purchase.date_next_charge;
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert.current_period_start).toBe(new Date(1780000000000).toISOString());
    expect(upsert).not.toHaveProperty('current_period_end');
  });

  test('33. offer envs ausentes usam fallback exato do plan.name', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-fallback' });
    payload.data.purchase.offer.code = 'OFF-QUALQUER-FICTICIA';
    payload.data.subscription.plan.name = 'Anual';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    const env = testEnv({ HOTMART_OFFER_MENSAL: undefined, HOTMART_OFFER_ANUAL: undefined });
    await handler(req, res, { env, fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('anual');
  });

  test('34. JSON valido que nao e objeto retorna 400', async () => {
    const mock = makeSupabaseMock();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: '"so-uma-string-valida"',
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ ok: false, error: 'invalid_json' });
    expect(mock.state.calls).toHaveLength(0);
  });

  // Fixture fictícia de SUBSCRIPTION_CANCELLATION: SEM data.buyer — o e-mail
  // vem de data.subscriber.email e a vigência de data.date_next_charge.
  function cancellationPayload({ id = 'evt-ficticio-cancel-1', data = null } = {}) {
    return {
      id,
      event: 'SUBSCRIPTION_CANCELLATION',
      version: '2.0.0',
      data: data || {
        subscriber: { email: FAKE_EMAIL, name: 'Compradora Ficticia', code: 'SUB-FICTICIO-1' },
        subscription: { plan: { name: 'Mensal' }, status: 'CANCELLED' },
        date_next_charge: 1782592000000,
      },
    };
  }

  test('35. SUBSCRIPTION_CANCELLATION vincula pelo subscriber.email e cancela', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload(),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
    const lookup = mock.state.calls.find((c) => c.table === 'profiles');
    expect(lookup.query).toContain(encodeURIComponent(FAKE_EMAIL));
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    const upsert = mock.state.subscriptionUpserts[0];
    expect(upsert.user_id).toBe(FAKE_USER_ID);
    expect(upsert.status).toBe('canceled');
    expect(upsert.hotmart_subscriber_code).toBe('SUB-FICTICIO-1');
    expect(mock.state.store.subs.size).toBe(1);
    expect(mock.state.eventPatches[0].body.subscription_id).toBe('sub-row-ficticia-1');
  });

  test('36. SUBSCRIPTION_CANCELLATION sem usuario vira orfao', async () => {
    const mock = makeSupabaseMock({ profile: null });
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload({ id: 'evt-ficticio-cancel-orfao' }),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.eventInserts[0].user_id).toBeNull();
    expect(mock.state.subscriptionUpserts).toHaveLength(0);
    expect(mock.state.subscriptionPatches).toHaveLength(0);
  });

  test('37. cancelamento com date_next_charge grava period_end', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload({ id: 'evt-ficticio-cancel-vig' }),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].current_period_end).toBe(
      new Date(1782592000000).toISOString()
    );
  });

  test('38. cancelamento sem date_next_charge nao apaga period_end', async () => {
    const mock = makeSupabaseMock({
      profile: { id: FAKE_USER_ID, email: FAKE_EMAIL },
      existingSubscription: {
        id: 'sub-row-ficticia-1',
        user_id: FAKE_USER_ID,
        status: 'active',
        current_period_end: '2026-12-31T00:00:00.000Z',
      },
    });
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload({
        id: 'evt-ficticio-cancel-sem-vig',
        data: {
          subscriber: { email: FAKE_EMAIL, code: 'SUB-FICTICIO-1' },
          subscription: { plan: { name: 'Mensal' }, status: 'CANCELLED' },
        },
      }),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0]).not.toHaveProperty('current_period_end');
    expect(mock.state.store.subs.get(FAKE_USER_ID).current_period_end).toBe(
      '2026-12-31T00:00:00.000Z'
    );
    expect(mock.state.store.subs.get(FAKE_USER_ID).status).toBe('canceled');
  });

  test('39. cancelamento duplicado e idempotente', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const env = testEnv();
    const payload = () => ({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload({ id: 'evt-ficticio-cancel-dup' }),
    });
    const first = makeReqRes(payload());
    await handler(first.req, first.res, { env, fetchImpl: mock.fetchImpl });
    expect(first.res.statusCode).toBe(200);
    const second = makeReqRes(payload());
    await handler(second.req, second.res, { env, fetchImpl: mock.fetchImpl });
    expect(second.res.statusCode).toBe(200);
    expect(second.res.payload).toEqual({ ok: true });
    expect(mock.state.eventInserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
  });

  test('40. buyer.email divergente nao desvia a vinculacao do cancelamento', async () => {    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: cancellationPayload({
        id: 'evt-ficticio-cancel-buyer',
        data: {
          buyer: { email: 'outro.email.ficticio@exemplo.com' },
          subscriber: { email: FAKE_EMAIL, code: 'SUB-FICTICIO-1' },
          subscription: { plan: { name: 'Mensal' }, status: 'CANCELLED' },
          date_next_charge: 1782592000000,
        },
      }),
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    const lookup = mock.state.calls.find((c) => c.table === 'profiles');
    expect(lookup.query).toContain(encodeURIComponent(FAKE_EMAIL));
    expect(lookup.query).not.toContain(encodeURIComponent('outro.email.ficticio@exemplo.com'));
    expect(mock.state.subscriptionUpserts[0].email).toBe(FAKE_EMAIL);
    expect(mock.state.subscriptionUpserts[0].status).toBe('canceled');
  });

  test('41. plan.name "Plano Mensal" exato resulta em mensal', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-plano-nome-m' });
    payload.data.purchase.offer.code = 'OFF-DESCONHECIDA-FICTICIA';
    payload.data.subscription.plan.name = 'Plano Mensal';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('mensal');
  });

  test('42. plan.name "Plano Anual" exato resulta em anual', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-plano-nome-a' });
    payload.data.purchase.offer.code = 'OFF-DESCONHECIDA-FICTICIA';
    payload.data.subscription.plan.name = 'Plano Anual';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('anual');
  });

  test('43. offer code correspondente tem prioridade sobre plan.name', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-offer-prio' });
    payload.data.purchase.offer.code = FAKE_OFFER_MENSAL;
    payload.data.subscription.plan.name = 'Plano Anual';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('mensal');
  });

  test('44. offer ausente usa fallback do plan.name', async () => {
    const mock = makeSupabaseMock({ profile: { id: FAKE_USER_ID, email: FAKE_EMAIL } });
    const payload = purchasePayload({ id: 'evt-ficticio-sem-offer' });
    delete payload.data.purchase.offer;
    payload.data.subscription.plan.name = 'Plano Anual';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_HOTTOK },
      body: payload,
    });
    await handler(req, res, { env: testEnv(), fetchImpl: mock.fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(mock.state.subscriptionUpserts).toHaveLength(1);
    expect(mock.state.subscriptionUpserts[0].plan).toBe('anual');
  });
});
