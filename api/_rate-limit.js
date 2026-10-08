/**
 * ============================================================================
 * LINSORA — RATE LIMITING DISTRIBUÍDO (SHADOW MODE)
 * Módulo compartilhado dos endpoints server-side (claim-subscription,
 * send-welcome, hotmart-webhook). Usa Upstash Redis + @upstash/ratelimit.
 * ============================================================================
 *
 * MODO ATUAL: SHADOW (observação, sem bloqueio).
 * - Calcula se a requisição excederia o limite e registra metadados seguros.
 * - NUNCA retorna 429 e NUNCA bloqueia: o processamento sempre continua.
 * - Para ativar o bloqueio no futuro: RATE_LIMIT_SHADOW_MODE=false no
 *   ambiente + checar `decision.shouldBlock` nos handlers.
 *
 * GARANTIAS:
 * - Fail-open: Redis ausente/indisponível ou erro interno => permite tudo
 *   e registra `rate-limit-unavailable`. Nunca quebra o endpoint, nunca 500.
 * - Sem PII nos logs: chaves são HMAC-SHA256 truncado (salt = segredo de
 *   servidor já existente; nenhum secret novo). Nunca IP/e-mail/user_id
 *   crus, Authorization, tokens ou segredos.
 * - E-mail e Authorization NUNCA são chaves: `isUnsafeKey()` recusa valores
 *   com '@' ou prefixo Bearer (fail-safe: pula a checagem, permite, loga).
 * - Sem fallback em memória (não seria correto em serverless distribuído).
 */
'use strict';

const crypto = require('crypto');

let RedisImpl = null;
let RatelimitImpl = null;
try {
  const redisMod = require('@upstash/redis');
  RedisImpl = redisMod && redisMod.Redis ? redisMod.Redis : null;
} catch (e) { RedisImpl = null; }
try {
  const rlMod = require('@upstash/ratelimit');
  RatelimitImpl = rlMod && (rlMod.Ratelimit || rlMod.default) ? (rlMod.Ratelimit || rlMod.default) : null;
} catch (e) { RatelimitImpl = null; }

// Limites iniciais (janela deslizante de 1 minuto). Conservadores; calibrar
// com 1-2 semanas de logs em shadow antes de ativar bloqueio.
const LIMITS = {
  claimUser: { max: 20, window: '1 m' },
  claimIp: { max: 60, window: '1 m' },
  welcomeUser: { max: 10, window: '1 m' },
  welcomeIp: { max: 60, window: '1 m' },
  welcomeBadSecretIp: { max: 5, window: '1 m' },
  webhookIp: { max: 300, window: '1 m' },
};

function isShadowMode(env) {
  try {
    const raw = env && env.RATE_LIMIT_SHADOW_MODE;
    if (typeof raw === 'string') {
      const v = raw.trim().toLowerCase();
      if (v === 'false' || v === '0' || v === 'no') return false;
      if (v === 'true' || v === '1' || v === 'yes') return true;
    }
  } catch (e) { /* padrão seguro abaixo */ }
  return true;
}

function getEnvName(env, name) {
  try {
    const v = env && env[name];
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
  } catch (e) { return null; }
}

// Salt do HMAC: segredo de servidor JÁ existente (nenhum secret novo).
// O salt nunca é impresso; só o HMAC truncado aparece nos logs.
function hmacSalt(env) {
  return (
    getEnvName(env, 'SUPABASE_SERVICE_ROLE_KEY') ||
    getEnvName(env, 'WELCOME_HOOK_SECRET') ||
    getEnvName(env, 'HOTMART_HOTTOK') ||
    'linsora-rate-limit-fallback-salt'
  );
}

function hashForLog(value, env) {
  try {
    return crypto
      .createHmac('sha256', hmacSalt(env))
      .update(String(value), 'utf8')
      .digest('hex')
      .slice(0, 16);
  } catch (e) { return 'unhashable'; }
}

// Recusa chaves que pareçam e-mail ou credencial (fail-safe: pula o check).
function isUnsafeKey(key) {
  try {
    const s = String(key || '');
    if (!s) return true;
    if (s.indexOf('@') !== -1) return true;
    if (/^\s*Bearer\s+/i.test(s)) return true;
    return false;
  } catch (e) { return true; }
}

function getClientIp(req) {
  try {
    const headers = (req && req.headers) || {};
    for (const name of ['x-forwarded-for', 'x-real-ip']) {
      for (const k of Object.keys(headers)) {
        if (String(k).toLowerCase() === name) {
          const raw = headers[k];
          const first = String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim();
          if (first) return first;
        }
      }
    }
    return 'unknown';
  } catch (e) { return 'unknown'; }
}

function safeLog(fields) {
  try {
    console.log('[RateLimit]', JSON.stringify(fields));
  } catch (e) { /* nunca quebrar por causa do log */ }
}

// Escopo (Redis + limiters). `overrides` existe para testes mockarem tudo:
// { RedisClass, RatelimitClass }. Nunca lança.
function createScope(env, overrides) {
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const RedisClass = ov.RedisClass !== undefined ? ov.RedisClass : RedisImpl;
  const RatelimitClass = ov.RatelimitClass !== undefined ? ov.RatelimitClass : RatelimitImpl;
  const url = getEnvName(env, 'UPSTASH_REDIS_REST_URL');
  const token = getEnvName(env, 'UPSTASH_REDIS_REST_TOKEN');
  if (!RedisClass || !RatelimitClass || !url || !token) {
    return { available: false, env: env || {} };
  }
  try {
    const redis = new RedisClass({ url, token });
    const limiters = {};
    for (const name of Object.keys(LIMITS)) {
      const spec = LIMITS[name];
      limiters[name] = new RatelimitClass({
        redis,
        limiter: RatelimitClass.slidingWindow(spec.max, spec.window),
        prefix: 'linsora:rl:' + name,
      });
    }
    return { available: true, env: env || {}, redis, limiters };
  } catch (e) {
    return { available: false, env: env || {} };
  }
}

// Observa um bucket. SEMPRE permite o processamento continuar (shadow ou
// indisponível). Retorna { allowed, wouldBlock, remaining, reset }. Nunca lança.
async function observe(args) {
  const a = args && typeof args === 'object' ? args : {};
  const { scope, endpoint, bucket, key } = a;
  const env = (scope && scope.env) || {};
  try {
    if (!scope || !scope.available || !scope.limiters || !scope.limiters[bucket]) {
      safeLog({ endpoint: endpoint || 'unknown', bucket: bucket || 'unknown', allowed: true, reason: 'rate-limit-unavailable' });
      return { allowed: true, wouldBlock: false, unavailable: true };
    }
    if (isUnsafeKey(key)) {
      safeLog({ endpoint: endpoint || 'unknown', bucket: bucket || 'unknown', allowed: true, reason: 'unsafe-key-skipped' });
      return { allowed: true, wouldBlock: false, skipped: true };
    }
    let result = null;
    try {
      result = await scope.limiters[bucket].limit(String(key));
    } catch (e) {
      safeLog({ endpoint: endpoint || 'unknown', bucket: bucket || 'unknown', allowed: true, reason: 'rate-limit-unavailable' });
      return { allowed: true, wouldBlock: false, unavailable: true };
    }
    const denied = !result || result.success !== true;
    safeLog({
      endpoint: endpoint || 'unknown',
      bucket: bucket || 'unknown',
      keyHash: hashForLog(key, env),
      allowed: true,
      wouldBlock: denied,
      remaining: result && typeof result.remaining === 'number' ? result.remaining : null,
      reset: result && typeof result.reset === 'number' ? result.reset : null,
    });
    return {
      allowed: true,
      wouldBlock: denied,
      remaining: result ? result.remaining : null,
      reset: result ? result.reset : null,
    };
  } catch (e) {
    try {
      safeLog({ endpoint: 'unknown', bucket: 'unknown', allowed: true, reason: 'rate-limit-unavailable' });
    } catch (ignored) { /* noop */ }
    return { allowed: true, wouldBlock: false, unavailable: true };
  }
}

// Contrato FUTURO do 429 (não usado em shadow mode). Exportado para que o
// formato já seja contratual e testável antes da ativação.
function sendRateLimited(res, reset) {
  try {
    let retryAfter = 60;
    if (typeof reset === 'number' && reset > Date.now()) {
      retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    }
    try {
      if (res && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(retryAfter));
    } catch (e) { /* header opcional */ }
    return res.status(429).json({ ok: false, error: 'rate-limited' });
  } catch (e) {
    try { return res.status(429).json({ ok: false, error: 'rate-limited' }); } catch (ignored) { return undefined; }
  }
}

// Seam exclusivo para testes mockarem o escopo (nunca usado em produção).
let testScopeOverride = null;
function setTestScope(scope) { testScopeOverride = scope || null; }
function clearTestScope() { testScopeOverride = null; }
function scopeFor(env, overrides) {
  if (testScopeOverride) return testScopeOverride;
  return createScope(env, overrides);
}

module.exports = {
  LIMITS,
  isShadowMode,
  getClientIp,
  hashForLog,
  isUnsafeKey,
  createScope,
  scopeFor,
  setTestScope,
  clearTestScope,
  observe,
  sendRateLimited,
};
