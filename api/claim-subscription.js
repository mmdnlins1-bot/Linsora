/**
 * ============================================================================
 * LINSORA — CLAIM DE ASSINATURA PÓS-COMPRA (fluxo compra-antes-do-cadastro)
 * Rota: POST /api/claim-subscription (Vercel Serverless Function)
 * ============================================================================
 *
 * Permite que um usuário recém-cadastrado vincule eventos Hotmart órfãos
 * (compra feita antes da conta existir) à sua conta, usando SOMENTE o
 * e-mail da sessão autenticada — nunca valores enviados pelo frontend.
 *
 * Fluxo:
 * - Exige Authorization: Bearer <access_token> (ausente/inválido -> 401).
 * - Valida o token no Supabase Auth e extrai id + email da sessão.
 * - Busca eventos órfãos (user_id IS NULL) e filtra pelos que pertencem ao
 *   e-mail da sessão (data.subscriber.email, senão data.buyer.email).
 * - Considera somente eventos conhecidos; ignora SWITCH_PLAN e desconhecidos.
 * - Ordena pelo tempo real do evento (creation_date, senão approved_date;
 *   nunca received_at) e aplica o estado mais recente (plano por offer code
 *   com fallback exato de nome, como no webhook).
 * - UPSERT da subscription por user_id (merge, sem apagar campos) e vínculo
 *   dos eventos órfãos correspondentes (user_id + subscription_id).
 * - Idempotente: repetição não duplica nada (UNIQUE em user_id/event_id).
 *
 * Segurança:
 * - NENHUM segredo neste arquivo (só nomes de env, sem padrão).
 * - service_role SOMENTE no servidor, e SOMENTE em subscription_events e
 *   subscriptions (allowlist). Nunca no frontend, nunca em logs.
 * - user_id/email do body são IGNORADOS como autoridade.
 * - Log só com metadados seguros (sem token, chave, e-mail ou payload).
 * - Sem dependências novas: fetch nativo do runtime.
 */
'use strict';

const ALLOWED_WRITE_TABLES = ['subscription_events', 'subscriptions'];
const ALLOWED_READ_TABLES = ['subscription_events', 'subscriptions'];

const STATUS_BY_EVENT = {
  PURCHASE_APPROVED: 'active',
  PURCHASE_DELAYED: 'pending',
  PURCHASE_CANCELED: 'canceled',
  PURCHASE_REFUNDED: 'refunded',
  PURCHASE_CHARGEBACK: 'chargeback',
  CHARGEBACK: 'chargeback',
  SUBSCRIPTION_CANCELLATION: 'canceled',
};

function safeLog(fields) {
  try {
    console.log('[ClaimSubscription]', JSON.stringify(fields));
  } catch (e) {
    // Nunca quebrar o handler por causa do log.
  }
}

function asText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value) {
  const text = asText(value);
  return text ? text.toLowerCase() : null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseHotmartDate(value) {
  let date = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value);
  } else if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    date = /^[0-9]+$/.test(trimmed) ? new Date(Number(trimmed)) : new Date(trimmed);
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date.toISOString();
}

// E-mail do evento para vinculação: subscriber primeiro, buyer depois.
// Mesma prioridade do webhook; nunca texto arbitrário fora desses campos.
function eventEmail(raw) {
  const data = asObject(raw && raw.data) || {};
  const subscriber = asObject(data.subscriber) || {};
  const buyer = asObject(data.buyer) || {};
  return normalizeEmail(subscriber.email) || normalizeEmail(buyer.email);
}

function eventTime(raw) {
  const data = asObject(raw && raw.data) || {};
  const purchase = asObject(data.purchase) || {};
  return (
    parseHotmartDate(raw && raw.creation_date) ||
    parseHotmartDate(purchase.approved_date) ||
    null
  );
}

function resolvePlan(raw, env) {
  const data = asObject(raw && raw.data) || {};
  const purchase = asObject(data.purchase) || {};
  const offer = asObject(purchase.offer) || {};
  const subscription = asObject(data.subscription) || {};
  const planObj = asObject(subscription.plan) || {};
  const offerCode = asText(offer.code);
  const mensalOffer = asText(env.HOTMART_OFFER_MENSAL);
  const anualOffer = asText(env.HOTMART_OFFER_ANUAL);
  if (offerCode && mensalOffer && offerCode === mensalOffer) return 'mensal';
  if (offerCode && anualOffer && offerCode === anualOffer) return 'anual';
  const normalized = (asText(planObj.name) || '').toLowerCase();
  if (normalized === 'mensal' || normalized === 'plano mensal') return 'mensal';
  if (normalized === 'anual' || normalized === 'plano anual') return 'anual';
  return null;
}

function extractCodes(raw) {
  const data = asObject(raw && raw.data) || {};
  const purchase = asObject(data.purchase) || {};
  const subscription = asObject(data.subscription) || {};
  const subscriber = asObject(subscription.subscriber) || {};
  const dataSubscriber = asObject(data.subscriber) || {};
  const buyer = asObject(data.buyer) || {};
  return {
    buyerUcode: asText(buyer.ucode),
    subscriberCode: asText(dataSubscriber.code) || asText(subscriber.code),
    approvedDate: parseHotmartDate(purchase.approved_date),
    nextChargeDate:
      parseHotmartDate(data.date_next_charge) ||
      parseHotmartDate(purchase.date_next_charge) ||
      parseHotmartDate(subscription.date_next_charge),
  };
}

function pickBearerToken(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const raw = headers.authorization || headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function createDb({ baseUrl, serviceKey, fetchImpl }) {
  async function call(method, table, { query = '', body, prefer } = {}) {
    const allowed = method === 'GET' ? ALLOWED_READ_TABLES : ALLOWED_WRITE_TABLES;
    if (!allowed.includes(table)) {
      throw new Error('tabela_nao_permitida:' + table);
    }
    const headers = {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    return fetchImpl(baseUrl.replace(/\/+$/, '') + '/rest/v1/' + table + query, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function readJson(resp, context) {
    if (!resp) throw new Error('supabase_' + context + ':sem-resposta');
    if (resp.status === 204) return null;
    if (!resp.ok) throw new Error('supabase_' + context + ':' + resp.status);
    try {
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  async function ensureOk(resp, context) {
    if (!resp) throw new Error('supabase_' + context + ':sem-resposta');
    if (!resp.ok) throw new Error('supabase_' + context + ':' + resp.status);
    return resp.status;
  }

  return {
    // Valida o access_token do usuário no Supabase Auth. Retorna {id,email}
    // ou null quando inválido. Nunca confia em valores do frontend.
    async validateUserToken(token) {
      const resp = await fetchImpl(baseUrl.replace(/\/+$/, '') + '/auth/v1/user', {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: 'Bearer ' + token,
        },
      });
      if (!resp || resp.status === 401 || resp.status === 403) return null;
      if (!resp.ok) throw new Error('supabase_auth_validate:' + resp.status);
      let user = null;
      try {
        user = await resp.json();
      } catch (e) {
        user = null;
      }
      const id = user && (asText(user.id) || asText(user.sub));
      const email = user && normalizeEmail(user.email);
      if (!id || !email) return null;
      // P2: o claim exige e-mail confirmado. A confirmação é lida
      // server-side na identidade validada pelo token (nunca do body).
      const confirmedAt = user && (user.email_confirmed_at || user.confirmed_at);
      if (!confirmedAt) return { id, email, unconfirmed: true };
      return { id, email };
    },

    async listOrphanEvents() {
      const resp = await call('GET', 'subscription_events', {
        query:
          '?select=id,hotmart_event_id,event_type,user_id,subscription_id,plan,status_after,raw' +
          '&user_id=is.null&order=received_at.desc&limit=1000',
      });
      const rows = (await readJson(resp, 'orphan_lookup')) || [];
      return Array.isArray(rows) ? rows : [];
    },

    async upsertSubscription(row) {
      const resp = await call('POST', 'subscriptions', {
        query: '?on_conflict=user_id',
        body: row,
        prefer: 'resolution=merge-duplicates,return=representation',
      });
      const rows = await readJson(resp, 'subscription_upsert');
      const created = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (!created || !created.id) throw new Error('supabase_subscription_upsert:sem-retorno');
      return created;
    },

    async linkEvent(eventId, userId, subscriptionId, plan, statusAfter) {
      const resp = await call('PATCH', 'subscription_events', {
        query: '?hotmart_event_id=eq.' + encodeURIComponent(eventId),
        body: {
          user_id: userId,
          subscription_id: subscriptionId,
          plan,
          status_after: statusAfter,
        },
        prefer: 'return=representation',
      });
      await ensureOk(resp, 'event_link');
    },
  };
}

async function claimSubscription(req, res, deps) {
  const options = deps && typeof deps === 'object' ? deps : {};
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  try {
    if (!req || req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const supabaseUrl = env.LINSORA_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'service_not_configured' });
    }

    const token = pickBearerToken(req.headers);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'missing_token' });
    }

    const db = createDb({ baseUrl: supabaseUrl, serviceKey, fetchImpl });
    const sessionUser = await db.validateUserToken(token);
    if (!sessionUser) {
      return res.status(401).json({ ok: false, error: 'invalid_token' });
    }
    // P2: usuário ainda não confirmado não pode reivindicar assinatura.
    // Recusa segura antes de qualquer leitura/vínculo de compra.
    if (sessionUser.unconfirmed) {
      safeLog({
        claimed: false, at: new Date().toISOString(),
        reason: 'email-not-confirmed',
      });
      return res.status(403).json({ ok: false, error: 'email-not-confirmed' });
    }

    // Órfãos da sessão autenticada: somente eventos relevantes cujo e-mail
    // (subscriber, senão buyer) coincide com o e-mail validado no token.
    const orphans = await db.listOrphanEvents();
    const mine = orphans.filter((row) => {
      const type = asText(row.event_type);
      if (!type || !(type in STATUS_BY_EVENT)) return false;
      return eventEmail(row.raw) === sessionUser.email;
    });
    if (mine.length === 0) {
      safeLog({
        claimed: false, at: new Date().toISOString(),
        reason: 'no-matching-purchase',
      });
      return res.status(200).json({ ok: true, claimed: false });
    }

    // Estado mais recente aplicável (nunca received_at): dated desc, dateless
    // por último. Sem datas suficientes para ordenar, não inventa vigência.
    const withTime = mine
      .map((row) => ({ row, time: eventTime(row.raw) }))
      .filter((item) => item.time !== null)
      .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
    const dateless = mine.filter((row) => eventTime(row.raw) === null);
    const ordered = withTime.map((item) => item.row).concat(dateless);
    const selected = ordered[0];
    const selectedType = asText(selected.event_type);
    const status = STATUS_BY_EVENT[selectedType];
    const plan = resolvePlan(selected.raw, env);
    if (!plan) {
      safeLog({
        claimed: false, at: new Date().toISOString(),
        reason: 'plan-undetermined',
      });
      return res.status(200).json({ ok: true, claimed: false });
    }

    const codes = extractCodes(selected.raw);
    const row = {
      user_id: sessionUser.id,
      email: sessionUser.email,
      plan,
      status,
    };
    if (codes.buyerUcode) row.hotmart_buyer_ucode = codes.buyerUcode;
    if (codes.subscriberCode) row.hotmart_subscriber_code = codes.subscriberCode;
    if (codes.approvedDate) row.current_period_start = codes.approvedDate;
    if (codes.nextChargeDate) row.current_period_end = codes.nextChargeDate;
    const subscription = await db.upsertSubscription(row);

    for (const item of mine) {
      const itemType = asText(item.event_type);
      const itemStatus = STATUS_BY_EVENT[itemType] || null;
      const itemPlan = resolvePlan(item.raw, env);
      await db.linkEvent(item.hotmart_event_id, sessionUser.id, subscription.id, itemPlan, itemStatus);
    }

    safeLog({
      claimed: true, at: new Date().toISOString(),
      status, plan, events: mine.length,
    });
    return res.status(200).json({ ok: true, claimed: true, status, plan });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}

module.exports = claimSubscription;
