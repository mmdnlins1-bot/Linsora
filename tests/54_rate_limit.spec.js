const { test, expect } = require('@playwright/test');

// 54. Rate limiting distribuído em SHADOW MODE.
// Tudo mockado: Redis/Ratelimit falsos injetados via createScope overrides
// ou setTestScope. Sem Upstash real, sem rede, sem segredos reais.

const rateLimit = require('../api/_rate-limit');
const claimHandler = require('../api/claim-subscription');

const FAKE_ENV = {
  LINSORA_SUPABASE_URL: 'https://supabase-ficticia-ratelimit.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-ficticia-rl-000',
  WELCOME_HOOK_SECRET: 'hook-secret-ficticio-rl-000',
  HOTMART_HOTTOK: 'hottok-ficticio-rl-000',
  UPSTASH_REDIS_REST_URL: 'https://ficticia.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token-ficticio-rl-000',
  RATE_LIMIT_SHADOW_MODE: 'true',
};

function makeFakes(options = {}) {
  const calls = [];
  const mode = options.mode || 'allow'; // 'allow' | 'deny' | 'throw'
  class FakeRedis {
    constructor(config) { this.config = config; }
  }
  class FakeRatelimit {
    constructor({ redis, limiter, prefix }) {
      this.redis = redis;
      this.limiter = limiter;
      this.prefix = prefix;
    }
    static slidingWindow(max, window) { return { max, window }; }
    async limit(key) {
      calls.push({ prefix: this.prefix, key });
      if (mode === 'throw') throw new Error('redis-ficticio-indisponivel');
      if (mode === 'deny') {
        return { success: false, limit: 1, remaining: 0, reset: Date.now() + 60000 };
      }
      return { success: true, limit: 100, remaining: 99, reset: Date.now() + 60000 };
    }
  }
  return { calls, FakeRedis, FakeRatelimit };
}

function scopeWith(options) {
  const { calls, FakeRedis, FakeRatelimit } = makeFakes(options);
  const scope = rateLimit.createScope(FAKE_ENV, { RedisClass: FakeRedis, RatelimitClass: FakeRatelimit });
  return { scope, calls };
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

// Mock mínimo do claim: usuário confirmado + 1 órfão correspondente.
function makeClaimFetch() {
  const state = { upserts: 0 };
  async function fetchImpl(url, options = {}) {
    const method = String((options && options.method) || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (url.indexOf('/auth/v1/user') !== -1) {
      return { ok: true, status: 200, json: async () => ({ id: 'user-ficticio-rl-1', email: 'rl@exemplo.com', email_confirmed_at: '2026-01-01T00:00:00.000Z' }) };
    }
    if (url.indexOf('/rest/v1/subscription_events') !== -1 && method === 'GET') {
      return {
        ok: true, status: 200,
        json: async () => [{
          id: 'row-1', hotmart_event_id: 'evt-rl-1', event_type: 'PURCHASE_APPROVED',
          user_id: null, subscription_id: null, plan: null, status_after: null,
          raw: {
            id: 'evt-rl-1', event: 'PURCHASE_APPROVED', creation_date: 1780000000000,
            data: {
              buyer: { email: 'rl@exemplo.com', ucode: 'U1' },
              purchase: { approved_date: 1780000000000, date_next_charge: 1782592000000, offer: { code: 'OFF-M' } },
              subscription: { subscriber: { code: 'S1' }, plan: { name: 'Mensal' } },
            },
          },
        }],
      };
    }
    if (url.indexOf('/rest/v1/subscriptions') !== -1 && method === 'POST') {
      state.upserts += 1;
      return { ok: true, status: 201, json: async () => [{ id: 'sub-rl-1', ...body }] };
    }
    if (url.indexOf('/rest/v1/subscription_events') !== -1) {
      return { ok: true, status: 200, json: async () => [] };
    }
    throw new Error('fetch inesperado: ' + url);
  }
  return { state, fetchImpl };
}

test.describe('54. Rate limiting em shadow mode', () => {
  test.afterEach(() => {
    rateLimit.clearTestScope();
  });

  test('limites iniciais conferem com a especificação', async () => {
    expect(rateLimit.LIMITS.claimUser).toEqual({ max: 20, window: '1 m' });
    expect(rateLimit.LIMITS.claimIp).toEqual({ max: 60, window: '1 m' });
    expect(rateLimit.LIMITS.welcomeUser).toEqual({ max: 10, window: '1 m' });
    expect(rateLimit.LIMITS.welcomeIp).toEqual({ max: 60, window: '1 m' });
    expect(rateLimit.LIMITS.welcomeBadSecretIp).toEqual({ max: 5, window: '1 m' });
    expect(rateLimit.LIMITS.webhookIp).toEqual({ max: 300, window: '1 m' });
  });

  test('shadow é o padrão; só desliga com valor explícito', async () => {
    expect(rateLimit.isShadowMode({})).toBe(true);
    expect(rateLimit.isShadowMode({ RATE_LIMIT_SHADOW_MODE: 'true' })).toBe(true);
    expect(rateLimit.isShadowMode({ RATE_LIMIT_SHADOW_MODE: 'false' })).toBe(false);
  });

  test('limite por user_id: negado registra wouldBlock sem bloquear', async () => {
    const { scope, calls } = scopeWith({ mode: 'deny' });
    expect(scope.available).toBe(true);
    const out = await rateLimit.observe({ scope, endpoint: 'claim-subscription', bucket: 'claimUser', key: 'user:abc' });
    expect(out.allowed).toBe(true);
    expect(out.wouldBlock).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].prefix).toBe('linsora:rl:claimUser');
  });

  test('limite por IP: negado registra wouldBlock sem bloquear', async () => {
    const { scope } = scopeWith({ mode: 'deny' });
    const out = await rateLimit.observe({ scope, endpoint: 'hotmart-webhook', bucket: 'webhookIp', key: 'ip:1.2.3.4' });
    expect(out.allowed).toBe(true);
    expect(out.wouldBlock).toBe(true);
  });

  test('bucket de segredo inválido do welcome existe e observa', async () => {
    const { scope, calls } = scopeWith({ mode: 'allow' });
    const out = await rateLimit.observe({ scope, endpoint: 'send-welcome', bucket: 'welcomeBadSecretIp', key: 'ip:9.9.9.9' });
    expect(out.allowed).toBe(true);
    expect(out.wouldBlock).toBe(false);
    expect(calls[0].prefix).toBe('linsora:rl:welcomeBadSecretIp');
  });

  test('shadow nunca bloqueia o endpoint mesmo com limiter negando tudo', async () => {
    const { calls, FakeRedis, FakeRatelimit } = makeFakes({ mode: 'deny' });
    const denyScope = rateLimit.createScope(FAKE_ENV, { RedisClass: FakeRedis, RatelimitClass: FakeRatelimit });
    rateLimit.setTestScope(denyScope);
    try {
      const fake = makeClaimFetch();
      const res = mockRes();
      await claimHandler(
        { method: 'POST', headers: { Authorization: 'Bearer tok-ficticio' }, body: {} },
        res,
        { env: FAKE_ENV, fetchImpl: fake.fetchImpl }
      );
      expect(res.statusCode).toBe(200);
      expect(res.payload).toEqual({ ok: true, claimed: true, status: 'active', plan: 'mensal' });
      expect(fake.state.upserts).toBe(1);
      expect(calls.length).toBeGreaterThanOrEqual(2); // bucket IP + bucket user
    } finally {
      rateLimit.clearTestScope();
    }
  });

  test('Redis indisponível: fail-open, endpoint funciona, loga disponibilidade', async () => {
    const { FakeRedis, FakeRatelimit } = makeFakes({ mode: 'throw' });
    const scope = rateLimit.createScope(FAKE_ENV, { RedisClass: FakeRedis, RatelimitClass: FakeRatelimit });
    let out = null;
    const logs = await captureLogs(async () => {
      out = await rateLimit.observe({ scope, endpoint: 'send-welcome', bucket: 'welcomeIp', key: 'ip:1.1.1.1' });
    });
    expect(out.allowed).toBe(true);
    expect(out.unavailable).toBe(true);
    expect(logs).toContain('rate-limit-unavailable');

    // Endpoint continua funcionando com Redis fora do ar.
    rateLimit.setTestScope(scope);
    try {
      const fake = makeClaimFetch();
      const res = mockRes();
      await claimHandler(
        { method: 'POST', headers: { Authorization: 'Bearer tok-ficticio' }, body: {} },
        res,
        { env: FAKE_ENV, fetchImpl: fake.fetchImpl }
      );
      expect(res.statusCode).toBe(200);
      expect(res.payload.claimed).toBe(true);
    } finally {
      rateLimit.clearTestScope();
    }
  });

  test('sem variáveis Upstash: indisponível, nunca bloqueia, nunca 500', async () => {
    const scope = rateLimit.createScope({ LINSORA_SUPABASE_URL: 'https://x.supabase.co' }, {});
    expect(scope.available).toBe(false);
    const out = await rateLimit.observe({ scope, endpoint: 'claim-subscription', bucket: 'claimIp', key: 'ip:2.2.2.2' });
    expect(out).toEqual({ allowed: true, wouldBlock: false, unavailable: true });
  });

  test('logs nunca contêm secrets, tokens ou e-mail', async () => {
    const { scope } = scopeWith({ mode: 'deny' });
    const logs = await captureLogs(async () => {
      await rateLimit.observe({ scope, endpoint: 'send-welcome', bucket: 'welcomeIp', key: 'ip:3.3.3.3' });
      await rateLimit.observe({
        scope, endpoint: 'send-welcome', bucket: 'welcomeUser', key: 'user:uid-ficticio-1',
      });
    });
    expect(logs).not.toContain(FAKE_ENV.UPSTASH_REDIS_REST_TOKEN);
    expect(logs).not.toContain(FAKE_ENV.UPSTASH_REDIS_REST_URL);
    expect(logs).not.toContain(FAKE_ENV.SUPABASE_SERVICE_ROLE_KEY);
    expect(logs).not.toContain(FAKE_ENV.WELCOME_HOOK_SECRET);
    expect(logs).not.toContain('3.3.3.3');
    expect(logs).not.toContain('uid-ficticio-1');
    expect(logs).not.toContain('rl@exemplo.com');
    expect(logs).toContain('[RateLimit]');
  });

  test('e-mail e Authorization nunca são chaves', async () => {
    expect(rateLimit.isUnsafeKey('alguem@exemplo.com')).toBe(true);
    expect(rateLimit.isUnsafeKey('Bearer tok-abc-123')).toBe(true);
    expect(rateLimit.isUnsafeKey('')).toBe(true);
    expect(rateLimit.isUnsafeKey('user:abc-123')).toBe(false);
    const { scope, calls } = scopeWith({ mode: 'allow' });
    const out = await rateLimit.observe({ scope, endpoint: 'claim-subscription', bucket: 'claimUser', key: 'vitima@exemplo.com' });
    expect(out.skipped).toBe(true);
    expect(out.allowed).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('contrato futuro do 429: status, corpo e Retry-After', async () => {
    const res = mockRes();
    rateLimit.sendRateLimited(res, Date.now() + 45000);
    expect(res.statusCode).toBe(429);
    expect(res.payload).toEqual({ ok: false, error: 'rate-limited' });
    expect(res.headersSent['Retry-After']).toBeDefined();
  });

  test('IP do cliente: x-forwarded-for (primeiro) com fallback', async () => {
    expect(rateLimit.getClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })).toBe('1.2.3.4');
    expect(rateLimit.getClientIp({ headers: { 'X-Forwarded-For': '9.9.9.9' } })).toBe('9.9.9.9');
    expect(rateLimit.getClientIp({ headers: { 'x-real-ip': '7.7.7.7' } })).toBe('7.7.7.7');
    expect(rateLimit.getClientIp({ headers: {} })).toBe('unknown');
  });
});
