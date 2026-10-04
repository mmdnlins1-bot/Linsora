const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

// 40. Gate de acesso pago do Linsora (fonte de verdade: public.subscriptions).
// profiles.plan NUNCA libera acesso; localStorage/cache/estado JS tampouco.
// window.grantAppAccess não existe mais (removido); a entrada passa pelo gate.

const MENSAL_URL = 'https://pay.hotmart.com/V107831993J?off=7xk5d8xd';
const ANUAL_URL = 'https://pay.hotmart.com/V107831993J?off=32op71oh';

test.describe('40. Gate de acesso pago', () => {
  test.beforeEach(async ({ page }) => {
    // Usuário conhecido (fora do funil de primeiro acesso): a flag impede
    // o redirect para a landing e o boot decide a rota pelo gate/sessão.
    await page.addInitScript(() => {
      try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) { /* ignora */ }
    });
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
  });

  async function canEnter(page, sub) {
    return page.evaluate((s) => window.supabaseRepo.canEnterWithSubscription(s), sub);
  }

  async function stubGate(page, result) {
    await page.evaluate((r) => {
      window.supabaseRepo.checkSubscriptionAccess = async () => r;
    }, result);
  }

  async function setStoreUser(page, user) {
    await page.evaluate((u) => {
      window.linsoraStore.state.user = u;
    }, user);
  }

  async function refreshAccess(page) {
    return page.evaluate(() => window.LinsoraAccess.refreshAccess());
  }

  test('1. sem subscription bloqueia', async ({ page }) => {
    expect(await canEnter(page, null)).toBe(false);
    expect(await canEnter(page, undefined)).toBe(false);
  });

  test('2. active sem current_period_end libera', async ({ page }) => {
    expect(await canEnter(page, { status: 'active', current_period_end: null })).toBe(true);
  });

  test('3. active com periodo futuro libera', async ({ page }) => {
    expect(await canEnter(page, { status: 'active', current_period_end: '2099-01-01T00:00:00.000Z' })).toBe(true);
  });

  test('4. active com periodo expirado bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'active', current_period_end: '2020-01-01T00:00:00.000Z' })).toBe(false);
  });

  test('5. canceled com periodo futuro libera', async ({ page }) => {
    expect(await canEnter(page, { status: 'canceled', current_period_end: '2099-01-01T00:00:00.000Z' })).toBe(true);
  });

  test('6. canceled com periodo expirado bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'canceled', current_period_end: '2020-01-01T00:00:00.000Z' })).toBe(false);
  });

  test('7. canceled sem periodo bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'canceled', current_period_end: null })).toBe(false);
  });

  test('8. pending bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'pending', current_period_end: null })).toBe(false);
  });

  test('9. past_due bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'past_due', current_period_end: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });

  test('10. expired bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'expired', current_period_end: null })).toBe(false);
  });

  test('11. refunded bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'refunded', current_period_end: null })).toBe(false);
  });

  test('12. chargeback bloqueia', async ({ page }) => {
    expect(await canEnter(page, { status: 'chargeback', current_period_end: null })).toBe(false);
  });

  test('13. erro na consulta bloqueia com mensagem de retry', async ({ page }) => {
    await stubGate(page, { state: 'error', reason: 'query-failed' });
    await setStoreUser(page, { id: 'u-erro', name: 'E', email: 'e@e.com' });
    expect(await refreshAccess(page)).toBe('error');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#subscriptionMessage')).toContainText('conexão');
  });

  test('14. profiles.plan PRO sem subscription bloqueia', async ({ page }) => {
    await stubGate(page, { state: 'blocked', reason: 'no-subscription' });
    await setStoreUser(page, { id: 'u-pro', name: 'P', email: 'p@p.com', plan: 'PRO' });
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    expect(await canEnter(page, { status: 'pending', plan: 'PRO' })).toBe(false);
    expect(await canEnter(page, { status: 'active', plan: 'FREE' })).toBe(true);
  });

  test('15. valores locais e cache nao liberam acesso', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({ id: 'usr_local_x' }));
      localStorage.setItem('LINSORA_DB_CACHE_usr_local_x', JSON.stringify({ user: { id: 'usr_local_x', plan: 'PRO' } }));
      localStorage.setItem('LINSORA_REGISTERED_USERS', JSON.stringify({}));
      window.linsoraStore.state.user = { id: 'usr_local_x', name: 'L', email: 'l@l.com', plan: 'PRO' };
      window.supabaseRepo.supabase = {};
    });
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('16. window.grantAppAccess nao existe mais', async ({ page }) => {
    expect(await page.evaluate(() => typeof window.grantAppAccess)).toBe('undefined');
    expect(await page.evaluate(() => typeof window.LinsoraAccess?.refreshAccess)).toBe('function');
  });

  test('17. sessao valida com subscription valida abre o app', async ({ page }) => {
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        from: () => ({
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({
                data: [{ status: 'active', current_period_end: null, plan: 'mensal' }],
                error: null,
              }),
            }),
          }),
        }),
      };
      window.linsoraStore.state.user = { id: 'u-valido', name: 'V', email: 'v@v.com' };
    });
    expect(await refreshAccess(page)).toBe('granted');
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('18. logout continua funcionando', async ({ page }) => {
    await login(page);
    await expect(page.locator('#appMain')).toBeVisible();
    await page.click('.nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#btnLogout')).toBeVisible();
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('19. login e cadastro pelo formulario funcionam', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Novo Gate');
    await page.fill('#authEmail', 'gate_novo@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.fill('#authConfirmPassword', '123456');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('20. links mensal e anual apontam para os checkouts reais', async ({ page }) => {
    await expect(page.locator('#btnSubscribeMensal')).toHaveAttribute('href', MENSAL_URL);
    await expect(page.locator('#btnSubscribeAnual')).toHaveAttribute('href', ANUAL_URL);
    await expect(page.locator('#subscriptionScreen h2')).toContainText('ainda não está ativo');
  });

  // Boot com sessão restaurada: semeia sessão local, instala stubs via
  // add_init_script (sobrevivem ao reload) e recarrega para o boot real.
  async function seedBootSession(page, uid) {
    await page.evaluate((id) => {
      localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
      localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({ id, name: 'Boot', email: 'boot@linsora.com.br' }));
      localStorage.setItem(`LINSORA_DB_CACHE_${id}`, JSON.stringify({
        user: { id, name: 'Boot', email: 'boot@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [],
        pixKeys: [], fixedBills: [], recurringBills: [], occurrences: [],
      }));
    }, uid);
  }

  async function installBootStubs(page, scriptedChecks, claimResult) {
    await page.addInitScript(({ scripted, claim }) => {
      window.__claimCalls__ = 0;
      window.__gateScript__ = [...scripted];
      window.__claimResult__ = claim;
      const wrap = () => {
        const repo = window.supabaseRepo;
        if (repo && !repo.__testWrapped) {
          repo.__testWrapped = true;
          repo.checkSubscriptionAccess = async () => {
            if (window.__gateScript__.length) return window.__gateScript__.shift();
            return { state: 'blocked', reason: 'sem-roteiro' };
          };
          repo.claimSubscription = async () => {
            window.__claimCalls__ += 1;
            return window.__claimResult__;
          };
        }
      };
      if (window.supabaseRepo) wrap();
      const iv = setInterval(() => {
        wrap();
        if (window.supabaseRepo && window.supabaseRepo.__testWrapped) clearInterval(iv);
      }, 20);
    }, { scripted: scriptedChecks, claim: claimResult });
  }

  async function claimCalls(page) {
    return page.evaluate(() => window.__claimCalls__ || 0);
  }

  async function waitBootRoute(page) {
    await page.waitForFunction(() => {
      const noHidden = (el) => el && !el.classList.contains('hidden');
      return noHidden(document.getElementById('appMain')) ||
             noHidden(document.getElementById('subscriptionScreen'));
    }, { timeout: 15000 });
  }

  test('21. boot restaurado com ativa entra sem claim', async ({ page }) => {
    const uid = 'aaaaaaaa-1111-4222-8333-444444444444';
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await seedBootSession(page, uid);
    await installBootStubs(page, [{ state: 'granted' }], { success: true, claimed: false });
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await waitBootRoute(page);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
    expect(await claimCalls(page)).toBe(0);
    const storeId = await page.evaluate(() => window.linsoraStore.state.user && window.linsoraStore.state.user.id);
    expect(storeId).toBe(uid);
  });

  test('22. boot bloqueado com orfao faz claim e libera', async ({ page }) => {
    const uid = 'bbbbbbbb-1111-4222-8333-444444444444';
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await seedBootSession(page, uid);
    await installBootStubs(
      page,
      [{ state: 'blocked', reason: 'no-subscription' }, { state: 'granted' }],
      { success: true, claimed: true, status: 'active', plan: 'mensal' }
    );
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await waitBootRoute(page);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
    expect(await claimCalls(page)).toBe(1);
  });

  test('23. boot bloqueado sem compra continua bloqueado', async ({ page }) => {
    const uid = 'cccccccc-1111-4222-8333-444444444444';
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await seedBootSession(page, uid);
    await installBootStubs(
      page,
      [{ state: 'blocked', reason: 'no-subscription' }, { state: 'blocked', reason: 'no-subscription' }],
      { success: true, claimed: false }
    );
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await waitBootRoute(page);
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#subscriptionMessage')).toContainText('mesmo e-mail');
    expect(await claimCalls(page)).toBe(1);
  });

  test('24. claim no boot executa no maximo uma vez', async ({ page }) => {
    const uid = 'dddddddd-1111-4222-8333-444444444444';
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await seedBootSession(page, uid);
    await installBootStubs(
      page,
      [{ state: 'blocked', reason: 'no-subscription' }, { state: 'granted' }],
      { success: true, claimed: true, status: 'active', plan: 'anual' }
    );
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await waitBootRoute(page);
    await expect(page.locator('#appMain')).toBeVisible();
    expect(await claimCalls(page)).toBe(1);
  });

  test('25. erro na API do claim mantem fail-closed no boot', async ({ page }) => {
    const uid = 'eeeeeeee-1111-4222-8333-444444444444';
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await seedBootSession(page, uid);
    await installBootStubs(
      page,
      [{ state: 'blocked', reason: 'no-subscription' }],
      { success: false, transportError: true }
    );
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await waitBootRoute(page);
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#subscriptionMessage')).toContainText('conexão');
    expect(await claimCalls(page)).toBe(1);
  });

  // Trial de 24h: distingue "sem assinatura + sem trial" (blocked, regra
  // atual) de "sem assinatura + trial válido" (granted, reason trial).
  async function installTrialGate(page, subRow, rpcRows) {
    await page.evaluate(([row, rpc]) => {
      const chainResult = { data: row ? [row] : [], error: null };
      window.supabaseRepo.supabase = {
        from: () => ({
          select: () => ({ eq: () => ({ limit: () => Promise.resolve(chainResult) }) }),
        }),
        rpc: async () => ({ data: rpc, error: null }),
      };
      window.linsoraStore.state.user = { id: 'ffffffff-1111-4222-8333-444444444444', name: 'T', email: 't@t.com' };
    }, [subRow, rpcRows]);
  }

  test('26. sem assinatura + sem trial = blocked (regra atual)', async ({ page }) => {
    await installTrialGate(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('27. sem assinatura + trial válido = granted (reason trial)', async ({ page }) => {
    await installTrialGate(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-10-01T12:00:00.000Z', trial_ends_at: '2026-10-02T12:00:00.000Z' },
      [{ trial_valid: true, trial_ends_at: '2026-10-02T12:00:00.000Z' }]);
    expect(await refreshAccess(page)).toBe('granted');
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('28. sem assinatura + trial expirado = blocked', async ({ page }) => {
    await installTrialGate(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: '2026-09-01T12:00:00.000Z' },
      [{ trial_valid: false, trial_ends_at: '2026-09-01T12:00:00.000Z' }]);
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });
});
