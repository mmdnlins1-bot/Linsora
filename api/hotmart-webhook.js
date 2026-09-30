/**
 * ============================================================================
 * LINSORA — WEBHOOK HOTMART V2 (primeira versão: recepção sem processamento)
 * Rota: POST /api/hotmart-webhook (Vercel Serverless Function)
 * ============================================================================
 *
 * Escopo desta versão (recepção autenticada, sem processamento):
 * - Aceita SOMENTE POST (outros métodos -> 405).
 * - Exige o segredo configurado em process.env.HOTMART_HOTTOK (ausente -> 500).
 * - Exige o header X-HOTMART-HOTTOK (ausente -> 401).
 * - Compara com crypto.timingSafeEqual (divergente -> 401, sem processar).
 * - Valida que o body é um JSON válido (inválido -> 400).
 * - NÃO grava nada no Supabase, NÃO processa compra, NÃO libera acesso.
 * - Registra no log técnico apenas metadados seguros da recepção.
 * - Responde 200 { ok: true } quando o POST autenticado é recebido.
 *
 * Segurança:
 * - NENHUM segredo neste arquivo (sem Hottok, sem service_role, sem tokens).
 * - A validação futura do Hottok usará a variável de ambiente HOTMART_HOTTOK
 *   (sem valor padrão, nunca hardcoded).
 * - O log NUNCA inclui: Hottok, senhas, service_role, tokens ou dados
 *   financeiros sensíveis do comprador (apenas tipo/id do evento + flags).
 */
'use strict';

const crypto = require('crypto');

function safeLog(fields) {
  try {
    console.log('[HotmartWebhook]', JSON.stringify(fields));
  } catch (e) {
    // Nunca quebrar o handler por causa do log.
  }
}

function pickHottok(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const value = headers['x-hotmart-hottok'];
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseBody(body) {
  if (body === undefined || body === null) return { ok: false };
  if (typeof body === 'string') {
    if (body.trim() === '') return { ok: false };
    try {
      return { ok: true, value: JSON.parse(body) };
    } catch (e) {
      return { ok: false };
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    const text = body.toString('utf8');
    if (text.trim() === '') return { ok: false };
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false };
    }
  }
  if (typeof body === 'object') return { ok: true, value: body };
  return { ok: false };
}

/**
 * Comparação em tempo constante (crypto nativo do runtime Node/Vercel).
 * Retorna false para tipos/comprimentos diferentes sem vazar o segredo.
 */
function secretsMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function hotmartWebhook(req, res) {
  try {
    if (!req || req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Segredo exclusivamente da variável de ambiente (lido por requisição,
    // sem valor padrão e nunca hardcoded). Ausente -> 500, sem processar.
    const expectedHottok = process.env.HOTMART_HOTTOK;
    if (!expectedHottok) {
      return res.status(500).json({ ok: false, error: 'hottok_not_configured' });
    }

    // Header ausente -> 401, sem processar.
    const hottok = pickHottok(req.headers);
    if (!hottok) {
      return res.status(401).json({ ok: false, error: 'missing_hottok' });
    }

    // Hottok divergente -> 401, sem processar. O valor recebido NUNCA é logado.
    if (!secretsMatch(hottok, expectedHottok)) {
      return res.status(401).json({ ok: false, error: 'invalid_hottok' });
    }

    const parsed = parseBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    const payload = parsed.value;

    // Log técnico seguro: somente metadados (tipo/id do evento + flags).
    // Nunca: Hottok, segredos, tokens, senhas ou dados financeiros do comprador.
    const eventName = payload && typeof payload === 'object' ? payload.event : undefined;
    const webhookId = payload && typeof payload === 'object' ? payload.id : undefined;
    safeLog({
      received: true,
      method: 'POST',
      at: new Date().toISOString(),
      event: typeof eventName === 'string' ? eventName.slice(0, 64) : null,
      webhookId: typeof webhookId === 'string' ? webhookId.slice(0, 128) : null,
      hasHottok: pickHottok(req.headers) !== null,
    });

    // v1: sem persistência, sem processamento de compra, sem liberação de acesso.
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}

module.exports = hotmartWebhook;
