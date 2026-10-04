const { test, expect } = require('@playwright/test');

// 45. Indicador visual de status da conta (Trial 24h vs Premium).
// Somente UX: o gate (checkSubscriptionAccess/canEnterWithSubscription/
// checkTrialAccess) continua sendo a única autoridade de acesso.
// Nenhum usuário real, nenhum segredo real.

const USER_ID = '11111111-2222-4333-8444-555555555555';

// endsAt determinístico: agora + 23h55min (+45s de margem contra truncamento).
function futureEndsAt() {
  return new Date(Date.now() + ((23 * 60 + 55) * 60 * 1000) + 45000).toISOString();
}
function trialRow(endsAt) {
  const start = new Date(new Date(endsAt).getTime() - 24 * 60 * 60 * 1000).toISOString();
  return {
    status: 'pending', current_period_end: null, plan: 'mensal',
    trial_started_at: start, trial_ends_at: endsAt,
  };
}

async function gotoApp(page) {
  // Usuário conhecido (fora do funil de primeiro acesso): a flag impede
  // o redirect para a landing antes do boot expor o store.
  await page.addInitScript(() => {
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) { /* ignora */ }
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo && window.LinsoraAccountStatus,
    { timeout: 10000 }
  );
  await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo && window.LinsoraAccountStatus,
    { timeout: 10000 }
  );
}

// Mesmo mock de gate do 44_trial: linha de subscriptions + retorno do RPC.
async function installGateMock(page, subRow, rpcRows) {
  await page.evaluate(([row, rpc]) => {
    const chainResult = { data: row ? [row] : [], error: null };
    window.supabaseRepo.supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve(chainResult) }) }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'negada' } }) }),
        insert: () => Promise.resolve({ data: null, error: { message: 'negada' } }),
      }),
      rpc: async (fn) => {
        if (fn !== 'get_trial_status') return { data: null, error: { message: 'funcao-desconhecida' } };
        return { data: rpc, error: null };
      },
    };
    window.linsoraStore.state.user = { id: '11111111-2222-4333-8444-555555555555', name: 'Trial', email: 'trial@exemplo.com' };
  }, [subRow, rpcRows]);
}

async function refreshAccess(page) {
  return page.evaluate(() => window.LinsoraAccess.refreshAccess());
}

async function openProfile(page) {
  await page.click('.nav-item[data-tab="tabProfile"]');
  await expect(page.locator('#tabProfile')).toBeVisible();
}

test.describe('45. Status visual da conta (trial x premium)', () => {
  test('00. badge nasce neutro/oculto (sem flash de Premium)', async ({ page }) => {
    await gotoApp(page);
    const badge = page.locator('#accountStatusBadge');
    await expect(badge).toHaveClass(/hidden/);
    expect(await badge.textContent()).toBe('Conta');
    await expect(page.locator('#accountTrialInfo')).toHaveClass(/hidden/);
    // Legado removido do HTML: nunca mais "Conta PRO Premium".
    expect(await page.locator('#tabProfile').textContent()).not.toContain('Conta PRO Premium');
  });

  test('01. trial ativo mostra TESTE GRÁTIS', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    expect(await refreshAccess(page)).toBe('granted');
    await openProfile(page);
    const badge = page.locator('#accountStatusBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('TESTE GRÁTIS');
    await expect(badge).toHaveClass(/warning/);
  });

  test('02. trial ativo não mostra CONTA PREMIUM', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    expect(await page.locator('#tabProfile').textContent()).not.toContain('CONTA PREMIUM');
    expect(await page.locator('#tabProfile').textContent()).not.toContain('Conta PRO Premium');
  });

  test('03. trial ativo mostra countdown', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    await expect(page.locator('#accountTrialInfo')).toBeVisible();
    await expect(page.locator('#accountTrialCountdown')).toContainText('23h 55min');
  });

  test('04. countdown usa o trialEndsAt do gate', async ({ page }) => {
    await gotoApp(page);
    const endsAtA = futureEndsAt();
    await installGateMock(page, trialRow(endsAtA), [{ trial_valid: true, trial_ends_at: endsAtA }]);
    await refreshAccess(page);
    const textA = await page.locator('#accountTrialCountdown').textContent();
    expect(textA).toContain('23h 55min');
    // Troca o trialEndsAt no servidor: o texto acompanha sem nova lógica.
    const endsAtB = new Date(Date.now() + (5 * 60 + 3) * 60 * 1000 + 30000).toISOString();
    await installGateMock(page, trialRow(endsAtB), [{ trial_valid: true, trial_ends_at: endsAtB }]);
    await refreshAccess(page);
    await expect(page.locator('#accountTrialCountdown')).toContainText('5h 03min');
    // E equivale à função pura aplicada ao valor do gate.
    const expected = await page.evaluate(([e]) => window.formatTrialRemaining(e), [endsAtB]);
    expect(expected).toContain('5h 03min');
  });

  test('05. trial ativo mostra Ver planos; CTA abre planos com retorno', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    await expect(page.locator('#btnViewPlans')).toBeVisible();
    await page.click('#btnViewPlans');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#btnBackToApp')).toBeVisible();
    // Volta ao app: o gate (ainda válido) decide, não o botão.
    await page.click('#btnBackToApp');
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('06. assinatura ativa mostra CONTA PREMIUM sem trial', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'active', current_period_end: null, plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    expect(await refreshAccess(page)).toBe('granted');
    await openProfile(page);
    const badge = page.locator('#accountStatusBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('CONTA PREMIUM');
    await expect(badge).toHaveClass(/success/);
    await expect(page.locator('#accountTrialInfo')).toBeHidden();
    await expect(page.locator('#accountTrialCountdown')).toBeHidden();
    await expect(page.locator('#btnViewPlans')).toBeHidden();
  });

  test('07. cancelada ainda vigente mostra CONTA PREMIUM', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'canceled', current_period_end: '2099-01-01T00:00:00.000Z', plan: 'anual', trial_started_at: null, trial_ends_at: null },
      []);
    expect(await refreshAccess(page)).toBe('granted');
    await openProfile(page);
    await expect(page.locator('#accountStatusBadge')).toContainText('CONTA PREMIUM');
    await expect(page.locator('#accountTrialInfo')).toBeHidden();
  });

  test('08. profiles.plan PRO sem acesso pago NÃO mostra Premium', async ({ page }) => {
    await gotoApp(page);
    await installGateMock(page,
      { status: 'canceled', current_period_end: '2020-01-01T00:00:00.000Z', plan: 'mensal', trial_started_at: null, trial_ends_at: null },
      []);
    await page.evaluate(() => {
      window.linsoraStore.state.user = { id: '11111111-2222-4333-8444-555555555555', name: 'P', email: 'p@p.com', plan: 'PRO' };
    });
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#accountStatusBadge')).toBeHidden();
    expect(await page.locator('#tabProfile').textContent()).not.toContain('CONTA PREMIUM');
  });

  test('09. cache local com plan PRO não promove a Premium', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      localStorage.setItem('LINSORA_DB_CACHE_usr_local_x', JSON.stringify({ user: { id: 'usr_local_x', plan: 'PRO' } }));
      window.linsoraStore.state.user = { id: 'usr_local_x', name: 'L', email: 'l@l.com', plan: 'PRO' };
      window.supabaseRepo.supabase = {};
    });
    const state = await refreshAccess(page);
    expect(state).not.toBe('granted');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#accountStatusBadge')).toBeHidden();
  });

  test('10. trial expirado bloqueia na tela de planos', async ({ page }) => {
    await gotoApp(page);
    const expired = '2026-09-01T12:00:00.000Z';
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: expired },
      [{ trial_valid: false, trial_ends_at: expired }]);
    expect(await refreshAccess(page)).toBe('blocked');
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#accountStatusBadge')).toBeHidden();
  });

  test('11. countdown zerado revalida e não concede acesso', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    expect(await refreshAccess(page)).toBe('granted');
    expect((await page.evaluate(() => window.LinsoraAccountStatus.state())).hasCountdownTimer).toBe(true);
    // Servidor passa a negar (trial acabou de verdade lá).
    const expired = '2026-09-01T12:00:00.000Z';
    await installGateMock(page,
      { status: 'pending', current_period_end: null, plan: 'mensal', trial_started_at: '2026-08-31T12:00:00.000Z', trial_ends_at: expired },
      [{ trial_valid: false, trial_ends_at: expired }]);
    await page.evaluate(() => {
      window.__refreshCalls__ = 0;
      const orig = window.LinsoraAccess.refreshAccess.bind(window.LinsoraAccess);
      window.LinsoraAccess.refreshAccess = async () => {
        window.__refreshCalls__ += 1;
        return orig();
      };
    });
    // Render com trialEndsAt no passado: deve revalidar, nunca liberar sozinho.
    await page.evaluate(() => window.LinsoraAccountStatus.render({
      state: 'granted', reason: 'trial', trialEndsAt: new Date(Date.now() - 60000).toISOString(),
    }));
    await expect(page.locator('#subscriptionScreen')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    expect(await page.evaluate(() => window.__refreshCalls__)).toBeGreaterThanOrEqual(1);
  });

  test('12. compra durante o trial muda a UI para Premium', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    await expect(page.locator('#accountStatusBadge')).toContainText('TESTE GRÁTIS');
    // Webhook aprovou: gate passa a responder pela assinatura paga.
    await installGateMock(page,
      { status: 'active', current_period_end: '2026-11-01T13:00:00.000Z', plan: 'mensal', trial_started_at: '2026-10-01T12:00:00.000Z', trial_ends_at: endsAt },
      [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    await expect(page.locator('#accountStatusBadge')).toContainText('CONTA PREMIUM');
    await expect(page.locator('#accountTrialInfo')).toBeHidden();
    await expect(page.locator('#btnViewPlans')).toBeHidden();
  });

  test('13. logout limpa timers e neutraliza o badge', async ({ page }) => {
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    expect((await page.evaluate(() => window.LinsoraAccountStatus.state())).hasCountdownTimer).toBe(true);
    await openProfile(page);
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();
    const st = await page.evaluate(() => window.LinsoraAccountStatus.state());
    expect(st.hasCountdownTimer).toBe(false);
    expect(st.hasRevalidateTimer).toBe(false);
    expect(st.endsAt).toBeNull();
    await expect(page.locator('#accountStatusBadge')).toBeHidden();
    await expect(page.locator('#accountTrialInfo')).toBeHidden();
  });

  test('14. layout mobile contém o indicador (390px)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    const endsAt = futureEndsAt();
    await installGateMock(page, trialRow(endsAt), [{ trial_valid: true, trial_ends_at: endsAt }]);
    await refreshAccess(page);
    await openProfile(page);
    const badgeBox = await page.locator('#accountStatusBadge').boundingBox();
    const infoBox = await page.locator('#accountTrialInfo').boundingBox();
    expect(badgeBox).not.toBeNull();
    expect(infoBox).not.toBeNull();
    for (const box of [badgeBox, infoBox]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  });

  test('15. formatTrialRemaining é pura e sem segundos', async ({ page }) => {
    await gotoApp(page);
    const r = await page.evaluate(() => ({
      full: window.formatTrialRemaining('2026-10-02T12:00:00.000Z', new Date('2026-10-01T12:05:00.000Z').getTime()),
      short: window.formatTrialRemaining('2026-10-01T12:42:00.000Z', new Date('2026-10-01T12:00:00.000Z').getTime()),
      subMin: window.formatTrialRemaining('2026-10-01T12:00:30.000Z', new Date('2026-10-01T12:00:00.000Z').getTime()),
      over: window.formatTrialRemaining('2026-09-01T12:00:00.000Z', new Date('2026-10-01T12:00:00.000Z').getTime()),
      invalid: window.formatTrialRemaining('nao-data'),
    }));
    expect(r.full).toBe('Seu teste termina em 23h 55min');
    expect(r.short).toBe('Seu teste termina em 42min');
    expect(r.subMin).toBe('Seu teste termina em menos de 1min');
    expect(r.over).toBe('Seu teste terminou');
    expect(r.invalid).toBe('');
    // Hora final usa relógio local só como texto.
    const endLabel = await page.evaluate(() => {
      const d = new Date();
      d.setHours(14, 58, 0, 0);
      if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
      return window.formatTrialEndTime(d.toISOString());
    });
    expect(endLabel).toMatch(/Termina (hoje|em \d{2}\/\d{2}) às 14:58/);
  });
});
