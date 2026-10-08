/**
 * ============================================================================
 * LINSORA — AUTH EMAIL HOOK (Supabase Send Email Hook → Resend)
 * Rota: POST /api/send-auth-email (Vercel Serverless Function)
 * ============================================================================
 *
 * Futuro: configurado como "Send Email Hook → HTTPS" no Supabase Dashboard
 * (Auth → Hooks). O Supabase passa a delegar os e-mails de autenticação a
 * este endpoint, que envia via Resend com identidade visual Linsora.
 * HOOK DESATIVADO por padrão: nada aqui altera o fluxo atual de
 * confirmação/recovery (que segue pelos e-mails nativos do Supabase).
 *
 * Segurança:
 * - SOMENTE POST (outros métodos -> 405).
 * - Assinatura Standard Webhooks sobre o corpo BRUTO (antes do parse):
 *   headers webhook-id / webhook-timestamp / webhook-signature, segredo em
 *   SEND_EMAIL_HOOK_SECRET (formato do Dashboard: "v1,whsec_<base64>";
 *   o prefixo é removido aqui, como no exemplo oficial). Ausente/inválida
 *   -> 401, sem processar. Nada do payload é confiado antes disso.
 * - Corpo bruto: usa string/Buffer direto ou lê o stream Node antes de
 *   qualquer parse (o helper req.body da Vercel é lazy; nunca o tocamos
 *   antes). Corpo já parseado (objeto) NÃO é verificável -> 401 fail-closed.
 * - Links montados pela CONSTRUÇÃO OFICIAL (docs do Send Email Hook):
 *   <supabase>/auth/v1/verify?token=<token_hash>&type=<action>&redirect_to=...
 *   usando token_hash + redirect_to do payload. Nenhum token em link
 *   inventado; access/refresh token nunca aparecem.
 * - Recovery preserva o fluxo atual: redirect_to já aponta para
 *   /reset-password.html (valor passado em resetPasswordForEmail e ecoado
 *   no payload) -> a página com detectSessionInUrl:true funciona sem
 *   alteração.
 * - email_change segue a semântica oficial (atenção: token_hash_new casa
 *   com o e-mail ATUAL; token_hash casa com o NOVO).
 * - Tipos não implementados: 200 com skipped, SEM enviar e-mail errado.
 * - Logs NUNCA incluem: secret, tokens, URLs com token, payload completo,
 *   e-mail do usuário, chaves. Só metadados (step/tipo/razão).
 * - Rate limiting reutilizado de api/_rate-limit.js (IP + destinatário via
 *   HMAC, nunca e-mail em texto). Idempotência: Idempotency-Key do Resend
 *   com webhook-id quando presente; dedup persistente exigiria banco
 *   (documentado, não implementado aqui).
 *
 * Variáveis (TODAS SERVER-ONLY):
 * - SEND_EMAIL_HOOK_SECRET ...: segredo do Hook (Dashboard). Server-only.
 * - RESEND_API_KEY ............: envio via Resend. Server-only.
 * - AUTH_EMAIL_FROM ...........: remetente verificado. Server-only.
 * - AUTH_EMAIL_FROM_NAME ......: (opcional) nome de exibição.
 * - LINSORA_SUPABASE_URL ......: origem p/ /auth/v1/verify. Server-only.
 * - AUTH_EMAIL_APP_URL ........: (opcional) fallback p/ redirect recovery.
 */
'use strict';

const rateLimit = require('./_rate-limit');
const templates = require('./_auth-email-templates');

let WebhookImpl = null;
try {
  const swMod = require('standardwebhooks');
  WebhookImpl = swMod && (swMod.Webhook || (swMod.default && swMod.default.Webhook)) ? (swMod.Webhook || swMod.default.Webhook) : null;
} catch (e) { WebhookImpl = null; }

const SUPPORTED_TYPES = ['signup', 'recovery', 'password_changed_notification', 'email_change'];

function safeLog(fields) {
  try {
    console.log('[SendAuthEmail]', JSON.stringify(fields));
  } catch (e) { /* nunca quebrar por causa do log */ }
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
        return v == null ? null : String(Array.isArray(v) ? v[0] : v);
      }
    }
    return null;
  } catch (e) { return null; }
}

function normalizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  return s && s.indexOf('@') > 0 ? s : null;
}

/**
 * Corpo BRUTO para verificação da assinatura (Standard Webhooks assina os
 * bytes exatos recebidos). Ordem: string/Buffer direto; senão leitura do
 * stream Node ANTES de qualquer parse (o helper req.body da Vercel é lazy
 * e nunca é acessado antes daqui). Corpo já parseado (objeto) não é
 * verificável de forma confiável -> null (o chamador rejeita: fail-closed).
 */
async function readRawBody(req) {
  try {
    const b = req ? req.body : undefined;
    if (typeof b === 'string') return b;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b.toString('utf8');
    if (b !== undefined && b !== null && typeof b === 'object') return null;
    if (req && typeof req.on === 'function') {
      const text = await new Promise((resolve, reject) => {
        let done = false;
        const finish = (err, data) => {
          if (done) return;
          done = true;
          if (err) reject(err);
          else resolve(data);
        };
        try {
          if (req.readableEnded || req.destroyed) {
            finish(new Error('stream-consumed'));
            return;
          }
          const chunks = [];
          req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8')));
          req.on('end', () => {
            try { finish(null, Buffer.concat(chunks).toString('utf8')); }
            catch (e) { finish(e); }
          });
          req.on('error', (e) => finish(e || new Error('stream-error')));
        } catch (e) { finish(e); }
      });
      return text;
    }
    return null;
  } catch (e) { return null; }
}

function cleanHookSecret(secret) {
  return String(secret || '').replace(/^v1,whsec_/, '').replace(/^whsec_/, '').trim();
}

function resendHeaders(resendKey, idempotencyKey) {
  const h = {
    Authorization: 'Bearer ' + resendKey,
    'Content-Type': 'application/json',
  };
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

async function sendViaResend(resendKey, from, to, subject, text, html, idempotencyKey, fetchImpl) {
  let resp = null;
  try {
    resp = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: resendHeaders(resendKey, idempotencyKey),
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
  } catch (e) {
    return { ok: false, transport: true };
  }
  if (!resp || !resp.ok) return { ok: false };
  return { ok: true };
}

function verifyHost(env) {
  const base = getEnv(env, 'LINSORA_SUPABASE_URL');
  if (!base) return null;
  try {
    return String(base).replace(/\/+$/, '');
  } catch (e) { return null; }
}

// Construção OFICIAL (docs do Send Email Hook):
// <supabase>/auth/v1/verify?token=<token_hash>&type=<action>&redirect_to=...
function buildVerifyUrl(host, tokenHash, actionType, redirectTo) {
  const params = new URLSearchParams({
    token: String(tokenHash),
    type: String(actionType),
    redirect_to: String(redirectTo),
  });
  return host + '/auth/v1/verify?' + params.toString();
}

function formatFrom(name, email) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return String(email);
  return cleanName + ' <' + String(email) + '>';
}

async function handler(req, res, ctx) {
  ctx = ctx || {};
  const fetchImpl = ctx.fetchImpl || fetch;
  const env = ctx.env || process.env || {};
  const WebhookClass = (ctx && ctx.WebhookClass) || WebhookImpl;

  if (!res || typeof res.status !== 'function') return;
  if (String((req && req.method) || 'GET').toUpperCase() !== 'POST') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' });
    return;
  }

  // Rate limiting por IP (reutiliza api/_rate-limit.js; shadow não bloqueia).
  const rlScope = rateLimit.scopeFor(env);
  const rlIpKey = 'ip:' + rateLimit.getClientIp(req);
  await rateLimit.observe({
    scope: rlScope, endpoint: 'send-auth-email', bucket: 'authEmailIp', key: rlIpKey,
  });

  const hookSecret = getEnv(env, 'SEND_EMAIL_HOOK_SECRET');
  const resendKey = getEnv(env, 'RESEND_API_KEY');
  const fromEmail = getEnv(env, 'AUTH_EMAIL_FROM');
  const fromName = getEnv(env, 'AUTH_EMAIL_FROM_NAME') || '';
  if (!hookSecret || !resendKey || !fromEmail) {
    safeLog({ step: 'misconfigured' });
    res.status(503).json({ ok: false, error: 'auth-email-unconfigured' });
    return;
  }
  if (!WebhookClass) {
    safeLog({ step: 'misconfigured', reason: 'webhook-lib-unavailable' });
    res.status(503).json({ ok: false, error: 'auth-email-unconfigured' });
    return;
  }

  // 1. Assinatura sobre o corpo bruto — antes de qualquer parse/confiança.
  const rawBody = await readRawBody(req);
  const webhookId = getHeader(req, 'webhook-id');
  const webhookTimestamp = getHeader(req, 'webhook-timestamp');
  const webhookSignature = getHeader(req, 'webhook-signature');
  if (!rawBody || !webhookId || !webhookTimestamp || !webhookSignature) {
    safeLog({ step: 'rejected', reason: 'missing-signature' });
    res.status(401).json({ ok: false, error: 'invalid-signature' });
    return;
  }
  let verified = null;
  try {
    const wh = new WebhookClass(cleanHookSecret(hookSecret));
    verified = wh.verify(rawBody, {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': webhookSignature,
    });
  } catch (e) {
    safeLog({ step: 'rejected', reason: 'invalid-signature' });
    res.status(401).json({ ok: false, error: 'invalid-signature' });
    return;
  }
  if (!verified || typeof verified !== 'object') {
    safeLog({ step: 'rejected', reason: 'invalid-payload' });
    res.status(401).json({ ok: false, error: 'invalid-signature' });
    return;
  }

  // 2. Estruturas mínimas (só após assinatura válida).
  const user = verified.user && typeof verified.user === 'object' ? verified.user : null;
  const emailData = verified.email_data && typeof verified.email_data === 'object' ? verified.email_data : null;
  const toEmail = user ? normalizeEmail(user.email) : null;
  const actionType = emailData && typeof emailData.email_action_type === 'string'
    ? emailData.email_action_type.trim()
    : null;
  if (!toEmail || !actionType) {
    safeLog({ step: 'rejected', reason: 'bad-payload' });
    res.status(400).json({ ok: false, error: 'bad-payload' });
    return;
  }
  if (SUPPORTED_TYPES.indexOf(actionType) === -1) {
    // Tipos futuros/desconhecidos: reconhece sem enviar nada errado.
    safeLog({ step: 'skipped', type: actionType });
    res.status(200).json({ ok: true, skipped: 'unsupported-email-type' });
    return;
  }

  // 3. Rate limiting por destinatário (HMAC; nunca e-mail em texto).
  await rateLimit.observe({
    scope: rlScope, endpoint: 'send-auth-email', bucket: 'authEmailRecipient',
    key: 'rcpt:' + rateLimit.hashForLog(toEmail, env),
  });

  const host = verifyHost(env);
  const appUrl = getEnv(env, 'AUTH_EMAIL_APP_URL') || '';
  const from = formatFrom(fromName, fromEmail);
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? user.user_metadata : {};
  const displayName = templates.firstNameOf(meta.full_name || meta.name, toEmail);
  const idempotencyBase = 'linsora-authemail-' + actionType + '-' + String(webhookId);

  let jobs = [];
  if (actionType === 'signup') {
    if (!host || !emailData.token_hash || !emailData.redirect_to) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    const built = templates.buildSignup({
      name: displayName,
      confirmUrl: buildVerifyUrl(host, emailData.token_hash, 'signup', emailData.redirect_to),
    });
    jobs.push({ to: toEmail, subject: built.subject, text: built.text, html: built.html });
  } else if (actionType === 'recovery') {
    if (!host || !emailData.token_hash) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    // redirect_to ecoa o valor passado em resetPasswordForEmail
    // (/reset-password.html): o fluxo PASSWORD_RECOVERY segue intacto.
    const redirectTo = emailData.redirect_to || (appUrl ? String(appUrl).replace(/\/+$/, '') + '/reset-password.html' : null);
    if (!redirectTo) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    const built = templates.buildRecovery({
      recoveryUrl: buildVerifyUrl(host, emailData.token_hash, 'recovery', redirectTo),
    });
    jobs.push({ to: toEmail, subject: built.subject, text: built.text, html: built.html });
  } else if (actionType === 'password_changed_notification') {
    const built = templates.buildPasswordChanged();
    jobs.push({ to: toEmail, subject: built.subject, text: built.text, html: built.html });
  } else if (actionType === 'email_change') {
    // Semântica oficial (nomes invertidos por compatibilidade):
    // token_hash_new casa com o e-mail ATUAL; token_hash com o NOVO.
    if (!host) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    const hasCurrent = !!(emailData.token && emailData.token_hash_new);
    const hasNew = !!(emailData.token_new && emailData.token_hash);
    if (!hasCurrent && !hasNew) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    const redirectTo = emailData.redirect_to || (appUrl ? String(appUrl).replace(/\/+$/, '') + '/' : null);
    if (!redirectTo) {
      safeLog({ step: 'rejected', reason: 'bad-payload' });
      res.status(400).json({ ok: false, error: 'bad-payload' });
      return;
    }
    if (hasCurrent) {
      const built = templates.buildEmailChange({ newEmail: null, confirmUrl: null, toOldAddress: true });
      jobs.push({ to: toEmail, subject: built.subject, text: built.text, html: built.html });
    }
    if (hasNew) {
      const newEmail = user.new_email ? normalizeEmail(user.new_email) : null;
      if (!newEmail) {
        safeLog({ step: 'rejected', reason: 'bad-payload' });
        res.status(400).json({ ok: false, error: 'bad-payload' });
        return;
      }
      const built = templates.buildEmailChange({
        newEmail,
        confirmUrl: buildVerifyUrl(host, emailData.token_hash, 'email_change', redirectTo),
        toOldAddress: false,
      });
      jobs.push({ to: newEmail, subject: built.subject, text: built.text, html: built.html });
    }
  }

  if (jobs.length === 0) {
    safeLog({ step: 'skipped', type: actionType });
    res.status(200).json({ ok: true, skipped: 'nothing-to-send' });
    return;
  }

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const sent = await sendViaResend(
      resendKey, from, job.to, job.subject, job.text, job.html,
      idempotencyBase + (jobs.length > 1 ? '-' + String(i + 1) : ''),
      fetchImpl
    );
    if (!sent || !sent.ok) {
      safeLog({ step: 'provider-failed', type: actionType });
      res.status(502).json({ ok: false, error: 'auth-email-send-failed' });
      return;
    }
  }

  safeLog({ step: 'sent', type: actionType });
  res.status(200).json({ ok: true, sent: true });
}

module.exports = handler;
module.exports.buildVerifyUrl = buildVerifyUrl;
module.exports.SUPPORTED_TYPES = SUPPORTED_TYPES;
