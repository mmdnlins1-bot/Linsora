/**
 * ============================================================================
 * LINSORA — WEBHOOK HOTMART V2 (Etapa 1: recepção autenticada + registro
 * comercial, SEM bloqueio/liberação de acesso do aplicativo)
 * Rota: POST /api/hotmart-webhook (Vercel Serverless Function)
 * ============================================================================
 *
 * Fluxo desta etapa:
 * - Aceita SOMENTE POST (outros métodos -> 405).
 * - Exige HOTMART_HOTTOK / LINSORA_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   (qualquer ausente -> 500, sem processar).
 * - Exige o header X-HOTMART-HOTTOK (ausente -> 401).
 * - Compara com crypto.timingSafeEqual (divergente -> 401, sem processar).
 * - Valida JSON (inválido -> 400) e exige body.id (ausente -> 400).
 * - Registra o evento em public.subscription_events (idempotente por
 *   hotmart_event_id: reenvio de evento completo -> 200 sem tocar em nada;
 *   reenvio de evento incompleto -> retoma o processamento idempotente).
 * - Localiza o usuário pelo e-mail do comprador (service_role, leitura em
 *   public.profiles). Sem usuário: evento órfão (user_id NULL), 200, sem
 *   criar assinatura e sem liberar acesso.
 * - Com usuário + evento conhecido + plano determinável: UPSERT em
 *   public.subscriptions por user_id (UNIQUE) e vínculo no evento.
 * - Eventos desconhecidos ou sem plano determinável: só o evento, 200.
 * - Falhas técnicas reais (Supabase fora, erro de escrita) -> 500.
 *
 * Segurança:
 * - NENHUM segredo neste arquivo (Hottok/service_role só via env, sem padrão).
 * - service_role escreve SOMENTE em subscription_events e subscriptions
 *   (allowlist aplicada no acesso ao PostgREST; nunca tabelas financeiras).
 * - O log NUNCA inclui: Hottok, service_role, payload completo, senhas,
 *   tokens ou dados financeiros do comprador (só metadados seguros).
 * - Sem dependências novas: usa fetch nativo do runtime contra o PostgREST.
 */
'use strict';

const crypto = require('crypto');

// Tabelas que o service_role pode tocar NESTE endpoint (defesa em profundidade;
// as tabelas financeiras nunca entram aqui).
const ALLOWED_WRITE_TABLES = ['subscription_events', 'subscriptions'];
const ALLOWED_READ_TABLES = ['profiles', 'subscriptions', 'subscription_events'];

// Eventos Hotmart conhecidos -> status comercial. Qualquer outro evento é
// registrado sem alterar assinatura. SUBSCRIPTION_CANCELLATION atualiza para
// canceled e preserva a linha (nunca apaga a subscription).
const STATUS_BY_EVENT = {
  PURCHASE_APPROVED: 'active',
  PURCHASE_DELAYED: 'pending',
  PURCHASE_CANCELED: 'canceled',
  PURCHASE_REFUNDED: 'refunded',
  PURCHASE_CHARGEBACK: 'chargeback',
  SUBSCRIPTION_CANCELLATION: 'canceled',
};

function safeLog(fields) {
  try {
    console.log('[HotmartWebhook]', JSON.stringify(fields));
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

/**
 * Converte datas da Hotmart (epoch ms, string numérica ou ISO) para ISO.
 * Retorna null quando ausente/inválida. Nunca inventa datas.
 */
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

/**
 * Extração defensiva dos campos do Webhook V2. Campos ausentes viram null;
 * nada é inventado. O payload completo vai para subscription_events.raw.
 *
 * E-mail do comprador: eventos de compra usam data.buyer.email;
 * SUBSCRIPTION_CANCELLATION usa data.subscriber.email (com fallback para
 * data.buyer.email se o primeiro estiver ausente). Em ambos os casos,
 * normalização trim + lowercase. Nunca ucode/transaction/sck.
 * Subscriber code: data.subscriber.code (cancelamento) com fallback para
 * data.subscription.subscriber.code (compras) — dado comercial, nunca auth.
 * Vigência: data.date_next_charge (cancelamento) tem prioridade, depois
 * purchase/subscription.date_next_charge. Nunca calcula datas.
 */
function extractEvent(body) {
  const eventType = asText(body.event);
  const data = asObject(body.data) || {};
  const buyer = asObject(data.buyer) || {};
  const dataSubscriber = asObject(data.subscriber) || {};
  const purchase = asObject(data.purchase) || {};
  const offer = asObject(purchase.offer) || {};
  const subscription = asObject(data.subscription) || {};
  const subscriber = asObject(subscription.subscriber) || {};
  const planObj = asObject(subscription.plan) || {};
  const buyerEmailNorm = normalizeEmail(buyer.email);
  const subscriberEmailNorm = normalizeEmail(dataSubscriber.email);
  return {
    hotmartEventId: asText(body.id),
    eventType,
    buyerEmail:
      eventType === 'SUBSCRIPTION_CANCELLATION'
        ? subscriberEmailNorm || buyerEmailNorm
        : buyerEmailNorm,
    buyerUcode: asText(buyer.ucode),
    transaction: asText(purchase.transaction),
    purchaseStatus: asText(purchase.status),
    offerCode: asText(offer.code),
    subscriberCode: asText(dataSubscriber.code) || asText(subscriber.code),
    subscriptionStatus: asText(subscription.status),
    planName: asText(planObj.name),
    approvedDate: parseHotmartDate(purchase.approved_date),
    nextChargeDate:
      parseHotmartDate(data.date_next_charge) ||
      parseHotmartDate(purchase.date_next_charge) ||
      parseHotmartDate(subscription.date_next_charge),
    raw: body,
  };
}

/**
 * Determina 'mensal'|'anual' com segurança: primeiro pelo offer code
 * (comparado às envs), depois SOMENTE por match exato do plan.name.
 * Retorna null quando não é possível determinar (não inventa plano).
 */
function resolvePlan(offerCode, planName, env) {
  const mensalOffer = asText(env.HOTMART_OFFER_MENSAL);
  const anualOffer = asText(env.HOTMART_OFFER_ANUAL);
  if (offerCode && mensalOffer && offerCode === mensalOffer) return 'mensal';
  if (offerCode && anualOffer && offerCode === anualOffer) return 'anual';
  const normalized = (planName || '').trim().toLowerCase();
  if (normalized === 'mensal' || normalized === 'anual') return normalized;
  return null;
}

/**
 * Cliente mínimo do PostgREST via fetch nativo (sem novas dependências).
 * Escrita restrita às tabelas comerciais; leitura a profiles/subscriptions.
 */
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

  // readJson é tolerante a 204/corpo vazio (retorna null em vez de lançar);
  // chamadas que precisam do corpo validam o retorno. Erros HTTP reais
  // (!ok fora 204) continuam lançando exceção -> 500, sem máscara.
  async function readJson(resp, context) {
    if (!resp) {
      throw new Error('supabase_' + context + ':sem-resposta');
    }
    if (resp.status === 204) return null;
    if (!resp.ok) {
      throw new Error('supabase_' + context + ':' + resp.status);
    }
    try {
      return await resp.json();
    } catch (e) {
      return null;
    }
  }

  // Para escritas que não precisam do corpo (PATCH): valida o status sem
  // tentar ler JSON, então 204 vazio do PostgREST é sucesso, não erro.
  async function ensureOk(resp, context) {
    if (!resp) {
      throw new Error('supabase_' + context + ':sem-resposta');
    }
    if (!resp.ok) {
      throw new Error('supabase_' + context + ':' + resp.status);
    }
    return resp.status;
  }

  return {
    async findUserByEmail(email) {
      const resp = await call('GET', 'profiles', {
        query: '?select=id,email&email=eq.' + encodeURIComponent(email),
      });
      const rows = (await readJson(resp, 'profiles_lookup')) || [];
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    async getEventByEventId(eventId) {
      const resp = await call('GET', 'subscription_events', {
        query:
          '?select=id,hotmart_event_id,event_type,user_id,subscription_id,plan,status_after' +
          '&hotmart_event_id=eq.' +
          encodeURIComponent(eventId),
      });
      const rows = (await readJson(resp, 'event_lookup')) || [];
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    // Retorna { duplicate: true } quando hotmart_event_id já existe (409).
    async insertEvent(row) {
      const resp = await call('POST', 'subscription_events', {
        body: row,
        prefer: 'return=representation',
      });
      if (resp.status === 409) return { duplicate: true };
      const rows = await readJson(resp, 'event_insert');
      return { duplicate: false, row: Array.isArray(rows) ? rows[0] : null };
    },

    async patchEventByEventId(eventId, patch) {
      const resp = await call('PATCH', 'subscription_events', {
        query: '?hotmart_event_id=eq.' + encodeURIComponent(eventId),
        body: patch,
        prefer: 'return=representation',
      });
      await ensureOk(resp, 'event_patch');
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

    async getSubscriptionByUserId(userId) {
      const resp = await call('GET', 'subscriptions', {
        query: '?select=id,user_id,status&user_id=eq.' + encodeURIComponent(userId),
      });
      const rows = (await readJson(resp, 'subscription_lookup')) || [];
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    async patchSubscriptionByUserId(userId, patch) {
      const resp = await call('PATCH', 'subscriptions', {
        query: '?user_id=eq.' + encodeURIComponent(userId),
        body: patch,
        prefer: 'return=representation',
      });
      await ensureOk(resp, 'subscription_patch');
    },
  };
}

function emailDomain(email) {
  if (!email || email.indexOf('@') < 0) return null;
  return email.slice(email.lastIndexOf('@') + 1).slice(0, 64);
}

async function linkEvent(db, eventId, userId, subscriptionId, plan, statusAfter) {
  await db.patchEventByEventId(eventId, {
    user_id: userId,
    subscription_id: subscriptionId,
    plan,
    status_after: statusAfter,
  });
}

// Caminho principal: upsert completo (só campos presentes; o merge por
// user_id nunca apaga colunas que o payload não trouxe).
async function doFullUpsert(db, ev, user, plan, statusAfter) {
  const row = {
    user_id: user.id,
    email: ev.buyerEmail,
    plan,
    status: statusAfter,
  };
  if (ev.buyerUcode) row.hotmart_buyer_ucode = ev.buyerUcode;
  if (ev.subscriberCode) row.hotmart_subscriber_code = ev.subscriberCode;
  if (ev.approvedDate) row.current_period_start = ev.approvedDate;
  if (ev.nextChargeDate) row.current_period_end = ev.nextChargeDate;
  const subscription = await db.upsertSubscription(row);
  await linkEvent(db, ev.hotmartEventId, user.id, subscription.id, plan, statusAfter);
  return subscription;
}

// Plano indeterminável com assinatura existente: atualiza SOMENTE o status
// (+ códigos/vigência presentes). Nunca inventa plano.
async function doStatusOnlyPatch(db, ev, user, existingSubId, statusAfter) {
  const patch = { status: statusAfter };
  if (ev.buyerUcode) patch.hotmart_buyer_ucode = ev.buyerUcode;
  if (ev.subscriberCode) patch.hotmart_subscriber_code = ev.subscriberCode;
  if (ev.approvedDate) patch.current_period_start = ev.approvedDate;
  if (ev.nextChargeDate) patch.current_period_end = ev.nextChargeDate;
  await db.patchSubscriptionByUserId(user.id, patch);
  await linkEvent(db, ev.hotmartEventId, user.id, existingSubId, null, statusAfter);
}

async function hotmartWebhook(req, res, deps) {
  const options = deps && typeof deps === 'object' ? deps : {};
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  try {
    if (!req || req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Config essencial (sem padrão, nunca hardcoded). Ausente -> 500.
    // URL reutiliza a mesma variável de produção do projeto
    // (LINSORA_SUPABASE_URL); a chave admin continua separada
    // (SUPABASE_SERVICE_ROLE_KEY) e a anon key nunca é usada aqui.
    const expectedHottok = env.HOTMART_HOTTOK;
    const supabaseUrl = env.LINSORA_SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!expectedHottok || !supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'service_not_configured' });
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
    if (!parsed.ok || !asObject(parsed.value)) {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    const body = parsed.value;

    const ev = extractEvent(body);
    if (!ev.hotmartEventId) {
      return res.status(400).json({ ok: false, error: 'missing_event_id' });
    }

    const db = createDb({ baseUrl: supabaseUrl, serviceKey, fetchImpl });

    // Localiza o usuário pelo e-mail (somente leitura). Sem e-mail ou sem
    // cadastro: evento órfão, sem criar assinatura e sem liberar acesso.
    let user = null;
    if (ev.buyerEmail) {
      user = await db.findUserByEmail(ev.buyerEmail);
    }

    const statusAfter = ev.eventType ? STATUS_BY_EVENT[ev.eventType] || null : null;
    const plan = resolvePlan(ev.offerCode, ev.planName, env);
    const knownEvent = statusAfter !== null;

    // Registro idempotente: 409 (hotmart_event_id UNIQUE) = reenvio.
    // Em vez de retornar imediatamente, verifica se o evento anterior ficou
    // incompleto (ex.: falha entre insert e upsert) e, se ainda processável,
    // retoma com o payload atual (operações idempotentes: nunca duplica
    // evento nem cria segunda subscription — user_id é UNIQUE).
    const inserted = await db.insertEvent({
      hotmart_event_id: ev.hotmartEventId,
      event_type: ev.eventType || 'UNKNOWN',
      user_id: user ? user.id : null,
      subscription_id: null,
      plan,
      status_after: statusAfter,
      raw: ev.raw,
    });
    if (inserted.duplicate) {
      const existing = await db.getEventByEventId(ev.hotmartEventId);
      let resumed = false;
      // Só retoma quando há o que completar: usuário localizado agora, evento
      // conhecido e linha ainda sem vínculo. Órfão real (sem usuário) e evento
      // desconhecido continuam como estão; já-vinculado não é tocado.
      if (existing && user && knownEvent && !existing.subscription_id) {
        if (plan) {
          await doFullUpsert(db, ev, user, plan, statusAfter);
          resumed = true;
        } else {
          const existingSub = await db.getSubscriptionByUserId(user.id);
          if (existingSub) {
            await doStatusOnlyPatch(db, ev, user, existingSub.id, statusAfter);
            resumed = true;
          }
        }
      }
      safeLog({
        received: true, method: 'POST', at: new Date().toISOString(),
        event: ev.eventType, webhookId: ev.hotmartEventId,
        duplicate: true, resumed,
      });
      return res.status(200).json({ ok: true });
    }

    if (user && knownEvent) {
      if (plan) {
        await doFullUpsert(db, ev, user, plan, statusAfter);
        safeLog({
          received: true, method: 'POST', at: new Date().toISOString(),
          event: ev.eventType, webhookId: ev.hotmartEventId,
          userFound: true, emailDomain: emailDomain(ev.buyerEmail),
          plan, statusAfter,
        });
        return res.status(200).json({ ok: true });
      }

      // Plano indeterminável: nunca inventar. Se já existir assinatura,
      // atualiza SOMENTE o status (+ códigos/vigência presentes); senão,
      // mantém só o evento para revisão.
      const existing = await db.getSubscriptionByUserId(user.id);
      if (existing) {
        await doStatusOnlyPatch(db, ev, user, existing.id, statusAfter);
      }
      safeLog({
        received: true, method: 'POST', at: new Date().toISOString(),
        event: ev.eventType, webhookId: ev.hotmartEventId,
        userFound: true, emailDomain: emailDomain(ev.buyerEmail),
        plan: null, statusAfter, planUndetermined: true,
      });
      return res.status(200).json({ ok: true });
    }

    // Órfão (sem usuário) ou evento desconhecido: só o evento, 200.
    safeLog({
      received: true, method: 'POST', at: new Date().toISOString(),
      event: ev.eventType, webhookId: ev.hotmartEventId,
      userFound: !!user, emailDomain: emailDomain(ev.buyerEmail),
      plan, statusAfter, orphan: !user, unknownEvent: !knownEvent,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Falhas técnicas reais (Supabase fora, erro de escrita) -> 500.
    // Nunca mascarar erro técnico como sucesso.
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}

module.exports = hotmartWebhook;
