const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('02. Dashboard & Métricas Principais', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve exibir cards de Saldo, Receita, Despesa e Patrimônio', async ({ page }) => {
    await expect(page.locator('#monthBalanceAmount')).toBeVisible();
    await expect(page.locator('#monthIncomeAmount')).toBeVisible();
    await expect(page.locator('#monthExpenseAmount')).toBeVisible();
    await expect(page.locator('#totalNetWorthMain')).toBeVisible();
  });

  test('Deve alternar Modo Privacidade (Ocultar/Exibir valores)', async ({ page }) => {
    const balanceEl = page.locator('#monthBalanceAmount');
    const initialText = await balanceEl.textContent();

    // Clicar no botão do olho no topo
    await page.evaluate(() => document.getElementById('btnTogglePrivacy')?.click());

    await expect(balanceEl).toContainText('••••••');
    await expect(page.locator('#iconEyeClosed')).toBeVisible();

    // Reverter privacidade
    await page.evaluate(() => document.getElementById('btnTogglePrivacy')?.click());
    await expect(balanceEl).toHaveText(initialText);
  });

  test('Garante que o card Fluxo de Caixa Real foi removido da tela inicial', async ({ page }) => {
    await expect(page.locator('#cashFlowRealCard')).not.toBeVisible();
    await expect(page.locator('#periodPillsSelector')).not.toBeVisible();
  });

  test('Deve exibir indicador de saúde financeira condicional', async ({ page }) => {
    const healthWidget = page.locator('#healthScoreWidget');
    await expect(healthWidget).toBeVisible();
  });

  test('FABs com tamanhos, gap, safe-area e visibilidade por aba corretos', async ({ page }) => {
    const metrics = await page.evaluate(() => {
      const css = (id, prop) => parseFloat(getComputedStyle(document.getElementById(id))[prop]);
      const fabBottom = css('btnFabNewTransaction', 'bottom');
      const fabHeight = css('btnFabNewTransaction', 'height');
      const fabWidth = css('btnFabNewTransaction', 'width');
      const micBottom = css('btnFabVoice', 'bottom');
      const micHeight = css('btnFabVoice', 'height');
      const micWidth = css('btnFabVoice', 'width');
      const tabsPad = parseFloat(getComputedStyle(document.querySelector('.tabs-container')).paddingBottom);
      return { fabBottom, fabHeight, fabWidth, micBottom, micHeight, micWidth, tabsPad };
    });
    expect(metrics.fabWidth).toBe(52);
    expect(metrics.fabHeight).toBe(52);
    expect(metrics.micHeight).toBe(52);
    expect(metrics.micWidth).toBe(52);
    expect(metrics.micBottom - (metrics.fabBottom + metrics.fabHeight)).toBeGreaterThanOrEqual(12);
    expect(metrics.micBottom - (metrics.fabBottom + metrics.fabHeight)).toBeLessThanOrEqual(16);
    expect(metrics.tabsPad).toBeGreaterThanOrEqual(140);

    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#btnFabNewTransaction')).toHaveClass(/hidden/);
    await expect(page.locator('#btnFabVoice')).toHaveClass(/hidden/);
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await expect(page.locator('#btnFabNewTransaction')).toBeVisible();
    await expect(page.locator('#btnFabVoice')).toBeVisible();

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      expect(overflow).toBe(true);
      const inView = await page.evaluate(() => {
        const r = document.getElementById('btnFabNewTransaction').getBoundingClientRect();
        return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
      });
      expect(inView).toBe(true);
    }
  });

  test('FABs com o mesmo contorno visual nos temas escuro e claro', async ({ page }) => {
    const borders = () => page.evaluate(() => {
      const b = (id) => {
        const s = getComputedStyle(document.getElementById(id));
        return { w: s.borderTopWidth, s: s.borderTopStyle, c: s.borderTopColor };
      };
      return { fab: b('btnFabNewTransaction'), mic: b('btnFabVoice') };
    });

    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    const dark = await borders();
    expect(dark.fab).toEqual(dark.mic);
    expect(dark.fab.w).toBe('3px');
    expect(dark.fab.s).toBe('solid');

    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    const light = await borders();
    expect(light.fab).toEqual(light.mic);
    expect(light.fab.w).toBe('3px');
    expect(light.fab.c).toBe('rgb(255, 255, 255)');

    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Ações Rápidas removidas: Início carrega sem os 6 tiles, com FABs e navegação', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await expect(page.locator('#tabDashboard')).toBeVisible();
    await expect(page.locator('#monthBalanceAmount')).toBeVisible();

    await expect(page.locator('#btnQuickIncome')).toHaveCount(0);
    await expect(page.locator('#btnQuickExpense')).toHaveCount(0);
    await expect(page.locator('#btnQuickPix')).toHaveCount(0);
    await expect(page.locator('#btnQuickCardPay')).toHaveCount(0);
    await expect(page.locator('#btnQuickAddGoal')).toHaveCount(0);
    await expect(page.locator('#btnQuickVoice')).toHaveCount(0);

    await expect(page.locator('#btnFabNewTransaction')).toBeVisible();
    await expect(page.locator('#btnFabVoice')).toBeVisible();

    await page.click('#btnFabNewTransaction');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.evaluate(() => document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden')));

    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
    await page.click('.bottom-nav .nav-item[data-tab="tabCards"]');
    await expect(page.locator('#tabCards')).toBeVisible();
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
  });
});
