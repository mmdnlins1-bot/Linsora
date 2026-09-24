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
