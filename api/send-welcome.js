/**
 * ============================================================================
 * LINSORA — E-MAIL DE BOAS-VINDAS PÓS-CONFIRMAÇÃO (server-side)
 * Rota: POST /api/send-welcome (Vercel Serverless Function)
 * ============================================================================
 *
 * Arquitetura (fluxo principal, 100% server-side):
 *   auth.users.email_confirmed_at NULL -> NOT NULL
 *   → trigger SQL (WHEN na transição) — ver supabase_migration_welcome_email.sql
 *   → pg_net POST { user_id, email } + x-welcome-secret
 *   → este endpoint → revalidação via Auth Admin API → claim atômico
 *   → Resend (Idempotency-Key determinística) → marca sent.
 *
 * Garantias:
 * - NENHUM segredo neste arquivo (só NOMES de env). Chaves ficam em env
 *   do servidor (Vercel → Project → Settings → Environment Variables).
 * - Dupla autenticação de entrada:
 *   A) server-to-server do trigger: header `x-welcome-secret` igual a
 *      WELCOME_HOOK_SECRET (comparação timing-safe). Fluxo principal.
 *   B) contingência autenticada: `Authorization: Bearer <access_token>`
 *      de usuário confirmado (ex.: reenvio manual futuro). O frontend NÃO
 *      chama este endpoint no fluxo normal de login.
 * - Nunca confia cegamente no body: no modo (A) revalida o usuário na
 *   Auth Admin API com service_role (existe? email_confirmed_at? e-mail
 *   confere?). Conta não confirmada recebe 403 e nenhum e-mail sai.
 * - Idempotência em camadas (at-least-once no transporte, idempotência
 *   no processamento — NÃO se afirma "exactly once"):
 *   1) claim ATÔMICO em public.welcome_emails (uma única instrução
 *      UPDATE com WHERE status IN (pending,failed) + lease; quem não
 *      recebe linha de volta não envia);
 *   2) marcador persistente pending->sending->sent|failed (sobrevive a
 *      retry do pg_net; nunca depende de localStorage/navegador);
 *   3) Idempotency-Key `linsora-welcome-<user_id>` no Resend.
 * - Ordem correta: sent_at/status=sent SÓ após 200 do Resend. Falha do
 *   provedor → status=failed + last_error (sem segredo), lease liberado,
 *   retry posterior permitido. Nunca responde falso sucesso.
 *
 * Variáveis de ambiente (TODAS SERVER-ONLY, nunca VITE_/NEXT_PUBLIC_):
 * - LINSORA_SUPABASE_URL ....: URL do projeto. Server-only.
 * - SUPABASE_SERVICE_ROLE_KEY : valida usuário (Admin API) + acessa
 *   public.welcome_emails via REST. Server-only. Nunca no navegador.
 * - WELCOME_HOOK_SECRET ......: segredo trigger→Vercel (mesmo valor do
 *   Vault `welcome_hook_secret`). Server-only.
 * - RESEND_API_KEY ...........: chave do Resend. Server-only. Ausente =>
 *   503 sem envio (sem simulação).
 * - WELCOME_FROM_EMAIL .......: remetente verificado. Server-only.
 * - WELCOME_APP_URL ..........: (opcional) link "Abrir o Linsora".
 */
'use strict';

const crypto = require('crypto');
const rateLimit = require('./_rate-limit');

const WELCOME_SUBJECT = 'Bem-vindo ao Linsora! Sua conta foi criada';

// Lease do claim: se quem adquiriu 'sending' morrer sem finalizar, um retry
// após este período pode reassumir. Curto o bastante para não travar o
// welcome; longo o bastante para não colidir com um envio em andamento.
const CLAIM_LEASE_MINUTES = 10;

const STATUS = {
  PENDING: 'pending',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
};

function safeLog(fields) {
  try {
    console.log('[SendWelcome]', JSON.stringify(fields));
  } catch (e) { /* nunca quebrar por causa do log */ }
}

function firstNameOf(fullName, email) {
  const base = String(fullName || '').trim().split(/\s+/)[0];
  if (base) return base;
  const local = String(email || '').split('@')[0].trim();
  return local || 'bem-vindo';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTexts(name) {
  const text =
    'Olá, ' + name + '!\n\n' +
    'Seja bem-vindo ao Linsora.\n\n' +
    'Sua conta foi criada com sucesso e você já pode começar a organizar ' +
    'sua vida financeira de forma simples e inteligente.\n\n' +
    'Durante seu período de teste, você poderá conhecer os principais ' +
    'recursos do Linsora e acompanhar sua vida financeira em um só lugar.\n\n' +
    'Estamos felizes em ter você com a gente.\n\n' +
    'Equipe Linsora';
  return text;
}

function buildHtml(name, appUrl) {
  const safeName = escapeHtml(name);
  const safeApp = escapeHtml(appUrl || '');
  const cta = safeApp
    ? '<p style="margin:24px 0;"><a href="' + safeApp + '" style="display:inline-block;padding:12px 24px;border-radius:10px;background:#10B981;color:#ffffff;text-decoration:none;font-weight:700;">Abrir o Linsora</a></p>'
    : '';
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A;max-width:560px;margin:0 auto;">' +
    '<h1 style="font-size:22px;">Olá, ' + safeName + '!</h1>' +
    '<p>Seja bem-vindo ao Linsora.</p>' +
    '<p>Sua conta foi criada com sucesso e você já pode começar a organizar ' +
    'sua vida financeira de forma simples e inteligente.</p>' +
    '<p>Durante seu período de teste, você poderá conhecer os principais ' +
    'recursos do Linsora e acompanhar sua vida financeira em um só lugar.</p>' +
    '<p>Estamos felizes em ter você com a gente.</p>' +
    cta +
    '<p style="color:#64748B;font-size:13px;">Equipe Linsora</p>' +
    '</div>'
  );
}

function getEnv(env, name) {
  try {
    const v = env && env[name];
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
  } catch (e) { return null; }
}

function getHeader(req, name) {
  try {
    const headers = (req && req.headers) || {};
    const wanted = String(name).toLowerCase();
    for (const key of Object.keys(headers)) {
      if (String(key).toLowerCase() === wanted) {
        const v = headers[key];
        return v == null ? null : String(v);
      }
    }
    return null;
  } catch (e) { return null; }
}

function getBearer(req) {
  const h = getHeader(req, 'authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Comparação timing-safe (nunca early-return por prefixo). */
function secretsEqual(provided, expected) {
  try {
    if (!provided || !expected) return false;
    const a = Buffer.from(String(provided), 'utf8');
    const b = Buffer.from(String(expected), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) { return false; }
}

function parseBody(req) {
  try {
    const b = req && req.body;
    if (!b) return {};
    if (typeof b === 'string') {
      try { return JSON.parse(b); } catch (e) { return {}; }
    }
    if (typeof b === 'object') return b;
    return {};
  } catch (e) { return {}; }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  return s && s.indexOf('@') > 0 ? s : null;
}

function restHeaders(serviceKey, prefer) {
  const h = {
    apikey: serviceKey,
    Authorization: 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

async function readJsonSafe(resp) {
  try { return await resp.json(); } catch (e) { return null; }
}

/** Valida access_token de usuário via Auth API (modo contingência). */
async function validateUserToken(supabaseUrl, accessToken, fetchImpl) {
  const url = String(supabaseUrl).replace(/\/+$/, '') + '/auth/v1/user';
  let resp = null;
  try {
    resp = await fetchImpl(url, {
      method: 'GET',
      headers: { apikey: 'anon', Authorization: 'Bearer ' + accessToken },
    });
  } catch (e) { return { ok: false }; }
  if (!resp || !resp.ok) return { ok: false };
  const user = await readJsonSafe(resp);
  if (!user || !user.id || !user.email) return { ok: false };
  const confirmedAt = user.email_confirmed_at || user.confirmed_at || null;
  if (!confirmedAt) return { ok: false, unconfirmed: true, id: user.id };
  const meta = user.user_metadata || {};
  return {
    ok: true,
    id: user.id,
    email: user.email,
    name: meta.full_name || meta.name || String(user.email).split('@')[0],
  };
}

/** Revalida o usuário via Auth Admin API com service_role (modo trigger). */
async function adminGetUser(supabaseUrl, serviceKey, userId, fetchImpl) {
  const url = String(supabaseUrl).replace(/\/+$/, '') + '/auth/v1/admin/users/' + encodeURIComponent(userId);
  let resp = null;
  try {
    resp = await fetchImpl(url, { method: 'GET', headers: restHeaders(serviceKey) });
  } catch (e) { return { ok: false, transport: true }; }
  if (!resp) return { ok: false, transport: true };
  if (resp.status === 404) return { ok: false, notFound: true };
  if (!resp.ok) return { ok: false };
  const user = await readJsonSafe(resp);
  if (!user || String(user.id || '') !== String(userId) || !user.email) return { ok: false };
  const confirmedAt = user.email_confirmed_at || user.confirmed_at || null;
  if (!confirmedAt) return { ok: false, unconfirmed: true, id: user.id };
  const meta = user.user_metadata || user.raw_user_meta_data || {};
  return {
    ok: true,
    id: user.id,
    email: user.email,
    name: meta.full_name || meta.name || String(user.email).split('@')[0],
  };
}

function tableUrl(supabaseUrl) {
  return String(supabaseUrl).replace(/\/+$/, '') + '/rest/v1/welcome_emails';
}

/** Garante a linha de controle (idempotente; conflito = já existe). */
async function ensureRow(supabaseUrl, serviceKey, userId, fetchImpl) {
  try {
    await fetchImpl(tableUrl(supabaseUrl), {
      method: 'POST',
      headers: restHeaders(serviceKey, 'resolution=ignore-duplicates'),
      body: JSON.stringify({ user_id: userId, status: STATUS.PENDING }),
    });
  } catch (e) { /* linha pode já existir; o claim decide */ }
  return true;
}

async function getRow(supabaseUrl, serviceKey, userId, fetchImpl) {
  try {
    const resp = await fetchImpl(
      tableUrl(supabaseUrl) + '?user_id=eq.' + encodeURIComponent(userId) + '&select=status,attempts,claimed_at,sent_at',
      { method: 'GET', headers: restHeaders(serviceKey) }
    );
    if (!resp || !resp.ok) return null;
    const rows = await readJsonSafe(resp);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
    return null;
  } catch (e) { return null; }
}

/**
 * Claim ATÔMICO do processamento em UMA única instrução:
 * só transita pending|failed (com lease ausente ou expirado) -> sending.
 * Retorna true somente para quem recebeu a linha de volta (dono do claim).
 * Concorrentes simultâneos recebem zero linhas e NÃO enviam.
 * Nenhum `if (!sent)` em JavaScript decide isso — o banco decide.
 */
async function acquireClaim(supabaseUrl, serviceKey, userId, nowIso, leaseCutoffIso, fetchImpl) {
  const query =
    '?user_id=eq.' + encodeURIComponent(userId) +
    '&status=in.(' + STATUS.PENDING + ',' + STATUS.FAILED + ')' +
    '&or=(claimed_at.is.null,claimed_at.lt.' + encodeURIComponent(leaseCutoffIso) + ')';
  try {
    const resp = await fetchImpl(tableUrl(supabaseUrl) + query, {
      method: 'PATCH',
      headers: restHeaders(serviceKey, 'return=representation'),
      body: JSON.stringify({ status: STATUS.SENDING, claimed_at: nowIso, updated_at: nowIso }),
    });
    if (!resp || !resp.ok) return { claimed: false, transportError: true };
    const rows = await readJsonSafe(resp);
    if (Array.isArray(rows) && rows.length > 0) return { claimed: true, row: rows[0] };
    return { claimed: false };
  } catch (e) {
    return { claimed: false, transportError: true };
  }
}

/** Contador best-effort de tentativas (não participa da correção do claim). */
async function bumpAttempts(supabaseUrl, serviceKey, userId, nowIso, fetchImpl) {
  try {
    const row = await getRow(supabaseUrl, serviceKey, userId, fetchImpl);
    const next = (row && typeof row.attempts === 'number' ? row.attempts : 0) + 1;
    await fetchImpl(tableUrl(supabaseUrl) + '?user_id=eq.' + encodeURIComponent(userId), {
      method: 'PATCH',
      headers: restHeaders(serviceKey),
      body: JSON.stringify({ attempts: next, updated_at: nowIso }),
    });
  } catch (e) { /* contador opcional: nunca bloqueia o envio */ }
}

/** Marca enviado SOMENTE após 200 do Resend (e só o dono do claim finaliza). */
async function markSent(supabaseUrl, serviceKey, userId, nowIso, fetchImpl) {
  try {
    const resp = await fetchImpl(
      tableUrl(supabaseUrl) + '?user_id=eq.' + encodeURIComponent(userId) + '&status=eq.' + STATUS.SENDING,
      {
        method: 'PATCH',
        headers: restHeaders(serviceKey, 'return=representation'),
        body: JSON.stringify({ status: STATUS.SENT, sent_at: nowIso, claimed_at: null, last_error: null, updated_at: nowIso }),
      }
    );
    if (!resp || !resp.ok) return false;
    const rows = await readJsonSafe(resp);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
}

/** Falha do provedor: volta para failed, libera o lease, registra erro (sem segredo). */
async function markFailed(supabaseUrl, serviceKey, userId, nowIso, message, fetchImpl) {
  try {
    await fetchImpl(
      tableUrl(supabaseUrl) + '?user_id=eq.' + encodeURIComponent(userId) + '&status=eq.' + STATUS.SENDING,
      {
        method: 'PATCH',
        headers: restHeaders(serviceKey),
        body: JSON.stringify({
          status: STATUS.FAILED,
          claimed_at: null,
          last_error: String(message || 'welcome-send-failed').slice(0, 300),
          updated_at: nowIso,
        }),
      }
    );
  } catch (e) { /* estado sending + lease expira sozinho; retry futuro reassume */ }
  return true;
}

async function sendViaResend(resendKey, fromEmail, appUrl, account, idempotencyKey, fetchImpl) {
  const name = firstNameOf(account.name, account.email);
  let resp = null;
  try {
    resp = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + resendKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [account.email],
        subject: WELCOME_SUBJECT,
        text: buildTexts(name),
        html: buildHtml(name, appUrl),
        headers: { 'X-Linsora-Event': 'welcome', 'X-Linsora-Idempotency': idempotencyKey },
      }),
    });
  } catch (e) {
    return { ok: false, transport: true };
  }
  if (!resp || !resp.ok) return { ok: false };
  return { ok: true };
}

async function handler(req, res, ctx) {
  ctx = ctx || {};
  const fetchImpl = ctx.fetchImpl || fetch;
  const env = ctx.env || process.env || {};

  if (!res || typeof res.status !== 'function') return;
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' });
    return;
  }

  // Rate limiting (SHADOW: só observa, nunca bloqueia).
  const rlScope = rateLimit.scopeFor(env);
  const rlIpKey = 'ip:' + rateLimit.getClientIp(req);
  await rateLimit.observe({
    scope: rlScope, endpoint: 'send-welcome', bucket: 'welcomeIp', key: rlIpKey,
  });

  const supabaseUrl = getEnv(env, 'LINSORA_SUPABASE_URL');
  const serviceKey = getEnv(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const hookSecret = getEnv(env, 'WELCOME_HOOK_SECRET');
  const resendKey = getEnv(env, 'RESEND_API_KEY');
  const fromEmail = getEnv(env, 'WELCOME_FROM_EMAIL');
  const appUrl = getEnv(env, 'WELCOME_APP_URL') || '';

  if (!supabaseUrl || !serviceKey) {
    safeLog({ step: 'misconfigured', reason: 'missing-supabase-server-env' });
    res.status(503).json({ ok: false, error: 'welcome-provider-unconfigured', detail: 'Configuração do servidor incompleta.' });
    return;
  }
  // Provedor ausente: NÃO simula envio (etapa externa pendente).
  if (!resendKey || !fromEmail) {
    safeLog({ step: 'unconfigured' });
    res.status(503).json({
      ok: false,
      error: 'welcome-provider-unconfigured',
      detail: 'Configure RESEND_API_KEY e WELCOME_FROM_EMAIL no servidor para ativar o envio.',
    });
    return;
  }

  // 1. Autenticação de entrada: segredo do trigger OU Bearer de usuário.
  const providedSecret = getHeader(req, 'x-welcome-secret');
  const hookAuthed = hookSecret && secretsEqual(providedSecret, hookSecret);
  const token = getBearer(req);
  if (!hookAuthed && !token) {
    res.status(401).json({ ok: false, error: 'missing-credentials' });
    return;
  }
  if (providedSecret && !hookAuthed) {
    // Segredo presente porém incorreto: rejeita sem revelar o motivo exato.
    // Bucket dedicado a tentativas inválidas (SHADOW: só observa).
    await rateLimit.observe({
      scope: rlScope, endpoint: 'send-welcome', bucket: 'welcomeBadSecretIp', key: rlIpKey,
    });
    res.status(401).json({ ok: false, error: 'invalid-credentials' });
    return;
  }

  // 2. Identidade alvo + 3/4. revalidação server-side (nunca confia no body).
  let account = null;
  if (hookAuthed) {
    const body = parseBody(req);
    const bodyId = body && body.user_id;
    const bodyEmail = body && normalizeEmail(body.email);
    if (!isUuid(bodyId) || !bodyEmail) {
      res.status(400).json({ ok: false, error: 'bad-body' });
      return;
    }
    let admin = null;
    try {
      admin = await adminGetUser(supabaseUrl, serviceKey, bodyId, fetchImpl);
    } catch (e) {
      admin = { ok: false, transport: true };
    }
    if (!admin || !admin.ok) {
      if (admin && admin.notFound) {
        res.status(404).json({ ok: false, error: 'user-not-found' });
        return;
      }
      if (admin && admin.unconfirmed) {
        safeLog({ step: 'blocked-unconfirmed' });
        res.status(403).json({ ok: false, error: 'email-not-confirmed' });
        return;
      }
      res.status(401).json({ ok: false, error: 'invalid-credentials' });
      return;
    }
    if (normalizeEmail(admin.email) !== bodyEmail) {
      res.status(403).json({ ok: false, error: 'email-mismatch' });
      return;
    }
    account = admin;
  } else {
    let validated = null;
    try {
      validated = await validateUserToken(supabaseUrl, token, fetchImpl);
    } catch (e) {
      validated = { ok: false };
    }
    if (!validated || !validated.ok) {
      if (validated && validated.unconfirmed) {
        safeLog({ step: 'blocked-unconfirmed' });
        res.status(403).json({ ok: false, error: 'email-not-confirmed' });
        return;
      }
      res.status(401).json({ ok: false, error: 'invalid-token' });
      return;
    }
    account = validated;
  }

  // Rate limiting por usuário revalidado (SHADOW: só observa, nunca bloqueia).
  await rateLimit.observe({
    scope: rlScope, endpoint: 'send-welcome', bucket: 'welcomeUser',
    key: 'user:' + String(account.id),
  });

  const nowIso = new Date().toISOString();
  const leaseCutoffIso = new Date(Date.now() - CLAIM_LEASE_MINUTES * 60 * 1000).toISOString();
  const idempotencyKey = 'linsora-welcome-' + String(account.id);

  // 5. Claim atômico (o banco decide quem envia; concorrentes perdem aqui).
  await ensureRow(supabaseUrl, serviceKey, account.id, fetchImpl);
  let claim = null;
  try {
    claim = await acquireClaim(supabaseUrl, serviceKey, account.id, nowIso, leaseCutoffIso, fetchImpl);
  } catch (e) {
    claim = { claimed: false, transportError: true };
  }
  if (!claim || !claim.claimed) {
    if (claim && claim.transportError) {
      res.status(502).json({ ok: false, error: 'welcome-state-unavailable' });
      return;
    }
    // 6. Sem claim: ou já enviado (sucesso sem reenvio) ou outro worker
    // está enviando com lease válido (409: retry posterior seguro).
    const row = await getRow(supabaseUrl, serviceKey, account.id, fetchImpl);
    if (row && row.status === STATUS.SENT) {
      res.status(200).json({ ok: true, already: true });
      return;
    }
    res.status(409).json({ ok: false, error: 'already-processing' });
    return;
  }
  await bumpAttempts(supabaseUrl, serviceKey, account.id, nowIso, fetchImpl);

  // 7. Envio (somente o dono do claim chega aqui).
  const sent = await sendViaResend(resendKey, fromEmail, appUrl, account, idempotencyKey, fetchImpl);

  if (sent && sent.ok) {
    // 8. Marca enviado SOMENTE após 200 do Resend.
    await markSent(supabaseUrl, serviceKey, account.id, nowIso, fetchImpl);
    safeLog({ step: 'sent' });
    res.status(200).json({ ok: true, sent: true });
    return;
  }
  // 9/10. Falha do provedor: NÃO marca sent, libera lease, registra erro.
  await markFailed(supabaseUrl, serviceKey, account.id, nowIso, sent && sent.transport ? 'resend-transport-error' : 'welcome-send-failed', fetchImpl);
  safeLog({ step: 'provider-failed' });
  res.status(502).json({ ok: false, error: 'welcome-send-failed' });
}

module.exports = handler;
module.exports.WELCOME_SUBJECT = WELCOME_SUBJECT;
module.exports.buildTexts = buildTexts;
module.exports.STATUS = STATUS;
module.exports.CLAIM_LEASE_MINUTES = CLAIM_LEASE_MINUTES;
