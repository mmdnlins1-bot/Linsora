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

  test('Deve alternar pílulas de período e métrica do gráfico de fluxo de caixa', async ({ page }) => {
    // Pílulas de período
    const pillWeekly = page.locator('#periodPillsSelector .period-pill[data-period="weekly"]');
    await pillWeekly.click();
    await expect(pillWeekly).toHaveClass(/active/);

    const pillDaily = page.locator('#periodPillsSelector .period-pill[data-period="daily"]');
    await pillDaily.click();
    await expect(pillDaily).toHaveClass(/active/);

    // Pílulas de métrica
    const metricIncomes = page.locator('#metricPillsSelector .period-pill[data-metric="incomes"]');
    await metricIncomes.click();
    await expect(metricIncomes).toHaveClass(/active/);
  });

  test('Deve exibir indicador de saúde financeira condicional', async ({ page }) => {
    const healthWidget = page.locator('#healthScoreWidget');
    await expect(healthWidget).toBeVisible();
  });
});
