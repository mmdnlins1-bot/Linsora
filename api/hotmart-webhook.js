/**
 * ============================================================================
 * LINSORA — WEBHOOK HOTMART V2 (primeira versão: recepção sem processamento)
 * Rota: POST /api/hotmart-webhook (Vercel Serverless Function)
 * ============================================================================
 *
 * Escopo desta v1 (propositalmente mínimo):
 * - Aceita SOMENTE POST (outros métodos -> 405).
 * - Lê o header X-HOTMART-HOTTOK, mas NÃO valida ainda.
 * - Valida que o body é um JSON válido (inválido -> 400).
 * - NÃO grava nada no Supabase, NÃO processa compra, NÃO libera acesso.
 * - Registra no log técnico apenas metadados seguros da recepção.
 * - Responde 200 { ok: true } quando o POST é recebido corretamente.
 *
 * Segurança:
 * - NENHUM segredo neste arquivo (sem Hottok, sem service_role, sem tokens).
 * - A validação futura do Hottok usará a variável de ambiente HOTMART_HOTTOK
 *   (sem valor padrão, nunca hardcoded).
 * - O log NUNCA inclui: Hottok, senhas, service_role, tokens ou dados
 *   financeiros sensíveis do comprador (apenas tipo/id do evento + flags).
 */
'use strict';

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

async function hotmartWebhook(req, res) {
  try {
    if (!req || req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Lê o Hottok para uso futuro (validar contra process.env.HOTMART_HOTTOK).
    // Nesta versão: NÃO valida, NÃO registra em log, NÃO usa para nada.
    const hottok = pickHottok(req.headers);
    void hottok;

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
