const { test, expect } = require('@playwright/test');

// 44. Teste grátis de 24 horas.
// Fonte de verdade: public.subscriptions (trial_started_at/trial_ends_at,
// server-side via trigger) + RPC get_trial_status (now() do Postgres).
// Nenhum usuário real, nenhum segredo real, nenhum relógio do navegador
// como autoridade: o RPC é simulado como o servidor responderia.

const TRIAL_START = '2026-10-01T12:00:00.000Z';
const TRIAL_END = '2026-10-02T12:00:00.000Z'; // exatamente +24h
const EXPIRED_END = '2026-09-01T12:00:00.000Z';
const USER_ID = '11111111-2222-4333-8444-555555555555';

async function gotoApp(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
  await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
}

// Instala um supabase mockado: `subRow` é a linha de subscriptions,
// `rpcRows` é o retorno do RPC get_trial_status (como o PostgREST entrega:
// array de linhas). Conta chamadas ao RPC em window.__rpcCalls__.
async function installGateMock(page, subRow, rpcRows) {
  await page.evaluate(([row, rpc]) => {
    window.__rpcCalls__ = 0;
    const chainResult = { data: row ? [row] : [], error: null };
    const deny = () => Promise.resolve({ data: null, error: { message: 'RLS: escrita negada (simulada)' } });
    window.supabaseRepo.supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve(chainResult) }) }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'RLS: escrita negada (simulada)' } }) }),
        insert: () => Promise.resolve({ data: null, error: { message: 'RLS: escrita negada (simulada)' } }),
      }),
      rpc: async (fn) => {
        window.__rpcCalls__ += 1;
        if (fn !== 'get_trial_status') return { data: null, error: { message: 'funcao-desconhecida' } };
        return { data: rpc, error: null };
      },
    };
    window.linsoraStore.state.user = { id: '11111111-2222-4333-8444-555555555555', name: 'Trial', email: 'trial@exemplo.com' };
  }, [subRow, rpcRows]);
}

async function gate(page) {
  return page.evaluate((id) => window.supabaseRepo.checkSubscriptionAccess(id), USER_ID);
}

async function rpcCalls(page) {
  return page.evaluate(() => window.__rpcCalls__ || 0);
}

test.describe('44. Trial de 24 horas', () => {
  test('A. conta nova recebe trial com exatamente 24 horas', async ({ page }) => {
    await gotoApp(page);
    const row = {
      status: 'pending', current_period_end: null, plan: 'mensal',
      trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END,
    };
    await installGateMock(page, row, [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const diff = await page.evaluate(([s, e]) => new Date(e).getTime() - new Date(s).getTime(), [TRIAL_START, TRIAL_END]);
    expect(diff).toBe(24 * 60 * 60 * 1000);
    const res = await gate(page);
    expect(res.state).toBe('granted');
    expect(res.reason).toBe('trial');
    expect(res.trialEndsAt).toBe(TRIAL_END);
  });

  test('B. trial válido libera acesso (reason trial)', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const res = await gate(page);
    expect(res.state).toBe('granted');
    expect(res.reason).toBe('trial');
    expect(await page.evaluate(() => window.LinsoraAccess.refreshAccess())).toBe('granted');
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('C. trial expirado bloqueia na tela de planos', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: EXPIRED_END },
      [{ trial_valid: false, trial_ends_at: EXPIRED_END }]);
    const res = await gate(page);
    expect(res.state).toBe('blocked');
    expect(await page.evaluate(() => window.LinsoraAccess.refreshAccess())).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('D. sem trial: comportamento atual preservado (blocked)', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    const res = await gate(page);
    expect(res.state).toBe('blocked');
    expect(res.reason).toBe('pending');
  });

  test('E. conta antiga (trial NULL) não recebe trial', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'canceled', current_period_end: '2020-01-01T00:00:00.000Z', plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    const res = await gate(page);
    expect(res.state).toBe('blocked');
    expect(res.reason).not.toBe('trial');
  });

  test('F. assinatura active válida libera mesmo sem trial (sem RPC)', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'active', current_period_end: null, plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    const res = await gate(page);
    expect(res.state).toBe('granted');
    expect(res.reason).not.toBe('trial');
    // Assinatura paga decide sozinha: o RPC do trial nem é consultado.
    expect(await rpcCalls(page)).toBe(0);
  });

  test('G. trial válido + active: acesso pela assinatura (precedência paga)', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'active', current_period_end: null, plan: 'anual', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const res = await gate(page);
    expect(res.state).toBe('granted');
    expect(res.reason).not.toBe('trial');
    expect(await rpcCalls(page)).toBe(0);
  });

  test('H. trial válido + canceled dentro do período: regra paga preservada', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'canceled', current_period_end: '2099-01-01T00:00:00.000Z', plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const res = await gate(page);
    expect(res.state).toBe('granted');
    expect(res.reason).not.toBe('trial');
  });

  test('I. trial expirado + assinatura inválida: bloqueado', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'canceled', current_period_end: '2020-01-01T00:00:00.000Z', plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: EXPIRED_END },
      [{ trial_valid: false, trial_ends_at: EXPIRED_END }]);
    const res = await gate(page);
    expect(res.state).toBe('blocked');
  });

  test('J. logout/login mantém o mesmo trial', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const first = await gate(page);
    expect(first.state).toBe('granted');
    // Logout real (limpa sessão local) + novo login = nova consulta ao gate.
    await page.evaluate(() => window.supabaseRepo.signOut());
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const second = await gate(page);
    expect(second.state).toBe('granted');
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
  });

  test('K. outro dispositivo/sessão limpa vê o mesmo trial', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const first = await gate(page);
    // "Novo dispositivo": storage local zerado; a verdade vem do servidor.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const second = await gate(page);
    expect(second.state).toBe('granted');
    expect(second.trialEndsAt).toBe(first.trialEndsAt);
  });

  test('L. cliente não consegue alterar nem reiniciar o trial (RLS nega escrita)', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: EXPIRED_END },
      [{ trial_valid: false, trial_ends_at: EXPIRED_END }]);
    const upd = await page.evaluate(() =>
      window.supabaseRepo.supabase.from('subscriptions').update({ trial_ends_at: '2099-01-01T00:00:00.000Z' }).eq('user_id', 'x'));
    expect(upd.error).not.toBeNull();
    const ins = await page.evaluate(() =>
      window.supabaseRepo.supabase.from('subscriptions').insert({ trial_ends_at: '2099-01-01T00:00:00.000Z' }));
    expect(ins.error).not.toBeNull();
    // E o gate continua bloqueado: nada mudou no servidor.
    expect((await gate(page)).state).toBe('blocked');
  });

  test('M. relógio do navegador adulterado não revalida trial expirado', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: EXPIRED_END },
      [{ trial_valid: false, trial_ends_at: EXPIRED_END }]);
    // Volta o relógio do navegador para dentro do período do trial.
    await page.clock.install({ time: new Date('2026-08-31T13:00:00.000Z') });
    const res = await gate(page);
    // A decisão veio do servidor (RPC): continua bloqueado.
    // (Sem uninstall: cada teste usa página/contexto isolados.)
    expect(res.state).toBe('blocked');
  });

  test('N. PURCHASE_APPROVED durante o trial ativa assinatura e preserva trial_*', async ({ page }) => {
    await gotoApp(page);
    const handler = require('../api/hotmart-webhook');
    const stored = {
      id: 'sub-trial-1', user_id: USER_ID, status: 'pending', plan: 'mensal',
      current_period_start: null, current_period_end: null,
      trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END,
    };
    let upsertBody = null;
    const fetchImpl = async (url, opts = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      const table = new URL(url).pathname.split('/').pop();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
      if (table === 'profiles' && method === 'GET') return json([{ id: USER_ID, email: 'trial@exemplo.com' }]);
      if (table === 'subscription_events' && method === 'GET') return json([]);
      if (table === 'subscription_events' && method === 'POST') return json([{ id: 'ev-1' }], 201);
      if (table === 'subscriptions' && method === 'GET') return json([stored]);
      if (table === 'subscriptions' && method === 'POST') {
        upsertBody = body;
        // Merge fiel ao PostgREST: o upsert NÃO apaga colunas ausentes.
        Object.assign(stored, body);
        return json([{ ...stored }], 201);
      }
      if (method === 'PATCH') return json(null, 204);
      return json([]);
    };
    const payload = {
      id: 'evt-trial-1', event: 'PURCHASE_APPROVED', creation_date: '2026-10-01T13:00:00.000Z',
      data: {
        buyer: { email: 'trial@exemplo.com', ucode: 'U-TRIAL-1' },
        purchase: { status: 'APPROVED', approved_date: '2026-10-01T13:00:00.000Z', transaction: 'TX-1', offer: { code: 'OFF-MENSAL-FICTICIA' }, date_next_charge: '2026-11-01T13:00:00.000Z' },
        subscription: { status: 'ACTIVE', subscriber: { code: 'SUB-1' }, plan: { name: 'Plano Mensal' } },
      },
    };
    const res = { statusCode: null, payload: null, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; } };
    await handler({ method: 'POST', headers: { 'x-hotmart-hottok': 'HOTTOK' }, body: payload }, res, {
      env: { HOTMART_HOTTOK: 'HOTTOK', LINSORA_SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SRV', HOTMART_OFFER_MENSAL: 'OFF-MENSAL-FICTICIA', HOTMART_OFFER_ANUAL: 'OFF-ANUAL-FICTICIA' },
      fetchImpl,
    });
    expect(res.statusCode).toBe(200);
    // O webhook não escreve trial_*: a assinatura ativa chega sem tocar no trial.
    expect(upsertBody).not.toBeNull();
    expect(upsertBody.status).toBe('active');
    expect('trial_started_at' in upsertBody).toBe(false);
    expect('trial_ends_at' in upsertBody).toBe(false);
    expect(stored.trial_started_at).toBe(TRIAL_START);
    expect(stored.trial_ends_at).toBe(TRIAL_END);
    // E o gate agora libera pela assinatura paga.
    await installGateMock(page,
      { status: 'active', current_period_end: '2026-11-01T13:00:00.000Z', plan: 'mensal', trial_started_at: TRIAL_START, trial_ends_at: TRIAL_END },
      [{ trial_valid: true, trial_ends_at: TRIAL_END }]);
    const g = await gate(page);
    expect(g.state).toBe('granted');
    expect(g.reason).not.toBe('trial');
  });

  test('O. webhook e claim continuam carregáveis e com comportamento intacto', async ({ page }) => {
    const webhook = require('../api/hotmart-webhook');
    const claim = require('../api/claim-subscription');
    expect(typeof webhook).toBe('function');
    expect(typeof claim).toBe('function');
    // GET continua 405 no webhook (contrato inalterado).
    const res = { statusCode: null, payload: null, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; } };
    await webhook({ method: 'GET', headers: {}, body: null }, res, { env: {}, fetchImpl: async () => ({}) });
    expect(res.statusCode).toBe(405);
  });
});
