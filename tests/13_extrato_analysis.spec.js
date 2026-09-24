const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('13. Extrato: categorias clicáveis + períodos', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
    await page.evaluate(() => {
      document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => {
        m.classList.add('hidden');
      });
    });
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
  });

  async function createTransaction(page, { type = 'DESPESA', amount, description, category, date }) {
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    if (type === 'RECEITA') {
      await page.click('#btnTypeIncome');
    }
    await page.fill('#txAmount', amount);
    await page.fill('#txDescription', description);
    if (category) {
      await page.selectOption('#txCategory', category);
    }
    if (date) {
      await page.fill('#txDate', date);
    }
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });
  }

  async function dateDaysAgo(page, days) {
    return page.evaluate((n) => {
      const d = new Date();
      const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
      const p = (v) => String(v).padStart(2, '0');
      return `${r.getFullYear()}-${p(r.getMonth() + 1)}-${p(r.getDate())}`;
    }, days);
  }

  test('CENÁRIO 6: sem movimentações exibe estado vazio e oculta análise', async ({ page }) => {
    await expect(page.locator('#extratoEmptyBlock')).toBeVisible();
    await expect(page.locator('#extratoEmptyBlock')).toContainText('Não há movimentações neste período.');
    await expect(page.locator('#extratoEmptyBlock')).toContainText('Adicione uma movimentação para começar a acompanhar sua vida financeira.');
    await expect(page.locator('#extratoAnalysisSection')).toHaveClass(/hidden/);
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisContainer')).toBeEmpty();
  });

  test('CENÁRIO 1: clicar em categoria filtra lista e resumo; remover restaura', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Cat' });
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Cat', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '15000', description: 'Uber Cat', category: 'Transporte' });

    await page.click('.category-variation-item:has-text("Alimentação")');

    await expect(page.locator('#categoryActiveRow')).toBeVisible();
    await expect(page.locator('#activeCategoryName')).toHaveText('Alimentação');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Alimentação');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Cat');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Uber Cat');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Salário Cat');
    await expect(page.locator('#periodExpense')).toContainText('R$ 300,00');
    await expect(page.locator('#periodIncome')).toContainText('R$ 0,00');

    await page.click('#btnActiveCategory');

    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise Financeira');
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Cat');
    await expect(page.locator('#fullTransactionsList')).toContainText('Salário Cat');
    await expect(page.locator('#periodExpense')).toContainText('R$ 450,00');
  });

  test('CENÁRIO 2: categoria respeita o período (Este mês e Últimos 30 dias)', async ({ page }) => {
    const prevDate = await page.evaluate(() => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const p = (v) => String(v).padStart(2, '0');
      return `${prev.getFullYear()}-${p(prev.getMonth() + 1)}-${p(prev.getDate())}`;
    });
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Mercado Mês Atual', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '20000', description: 'Mercado Mês Anterior', category: 'Alimentação', date: prevDate });

    await page.selectOption('#periodSelect', 'THIS_MONTH');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Mês Atual');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Mês Anterior');
    await expect(page.locator('#periodExpense')).toContainText('R$ 100,00');

    await page.click('.category-variation-item:has-text("Alimentação")');
    await expect(page.locator('#periodExpense')).toContainText('R$ 100,00');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Mês Anterior');

    await page.click('#btnActiveCategory');
    const oldDate = await dateDaysAgo(page, 40);
    await createTransaction(page, { type: 'DESPESA', amount: '5000', description: 'Lanche 40 dias', category: 'Lazer', date: oldDate });
    await page.selectOption('#periodSelect', 'LAST_30_DAYS');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Lanche 40 dias');
    await page.selectOption('#periodSelect', 'LAST_90_DAYS');
    await expect(page.locator('#fullTransactionsList')).toContainText('Lanche 40 dias');
  });

  test('CENÁRIO 3: período + tipo + categoria + busca combinados', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '200000', description: 'Salário Combinado' });
    await createTransaction(page, { type: 'DESPESA', amount: '12000', description: 'Mercado Central', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '8000', description: 'Padaria Pão', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '6000', description: 'Uber Combinado', category: 'Transporte' });

    await page.selectOption('#periodSelect', 'THIS_MONTH');
    await page.click('.chip-filter[data-value="DESPESA"]');
    await page.click('.category-variation-item:has-text("Alimentação")');
    await page.fill('#txSearchInput', 'mercado');

    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Central');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Padaria Pão');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Uber Combinado');
    // Resumo respeita período+tipo+categoria (busca textual filtra só a lista)
    await expect(page.locator('#periodExpense')).toContainText('R$ 200,00');
    await expect(page.locator('#periodIncome')).toContainText('R$ 0,00');

    await page.click('#btnClearFilters');
    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Combinado');
    await expect(page.locator('#fullTransactionsList')).toContainText('Salário Combinado');
  });

  test('CENÁRIO 4: todos os períodos carregam sem erro', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '50000', description: 'Receita Períodos' });
    const periods = ['TODAY', 'THIS_WEEK', 'LAST_7_DAYS', 'THIS_MONTH', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_YEAR', 'ALL'];
    for (const period of periods) {
      await page.selectOption('#periodSelect', period);
      await expect(page.locator('#extratoEmptyBlock')).toHaveClass(/hidden/);
      await expect(page.locator('#periodIncome')).toContainText('R$ 500,00');
      const showsComparison = await page.locator('#extratoAnalysisContainer').getByText('Comparado ao mês anterior').count();
      expect(showsComparison > 0).toBe(period === 'THIS_MONTH');
    }
  });

  test('CENÁRIO 5: período personalizado válido, vazio e inválido', async ({ page }) => {
    const today = await dateDaysAgo(page, 0);
    const tenAgo = await dateDaysAgo(page, 10);
    await createTransaction(page, { type: 'DESPESA', amount: '9000', description: 'Compra Período Custom', category: 'Outros', date: tenAgo });

    await page.selectOption('#periodSelect', 'CUSTOM');
    await expect(page.locator('#customPeriodRow')).toBeVisible();
    await page.fill('#customStart', tenAgo);
    await page.fill('#customEnd', today);
    await page.click('#btnApplyCustomPeriod');
    await expect(page.locator('#fullTransactionsList')).toContainText('Compra Período Custom');
    await expect(page.locator('#periodExpense')).toContainText('R$ 90,00');

    await page.fill('#customStart', '2020-01-01');
    await page.fill('#customEnd', '2020-01-31');
    await page.click('#btnApplyCustomPeriod');
    await expect(page.locator('#extratoEmptyBlock')).toBeVisible();
    await expect(page.locator('#extratoEmptyBlock')).toContainText('Não há movimentações neste período.');

    await page.fill('#customStart', today);
    await page.fill('#customEnd', tenAgo);
    await page.click('#btnApplyCustomPeriod');
    await expect(page.locator('#toastContainer')).toContainText('anterior à data inicial');
    await expect(page.locator('#extratoEmptyBlock')).toBeVisible();
  });

  test('Personalizado oculta ao trocar de período e preserva datas ao voltar', async ({ page }) => {
    const today = await dateDaysAgo(page, 0);
    const tenAgo = await dateDaysAgo(page, 10);
    await createTransaction(page, { type: 'DESPESA', amount: '9000', description: 'Compra Preserva', category: 'Outros', date: tenAgo });

    await page.selectOption('#periodSelect', 'CUSTOM');
    await expect(page.locator('#customPeriodRow')).toBeVisible();
    await page.fill('#customStart', tenAgo);
    await page.fill('#customEnd', today);
    await page.click('#btnApplyCustomPeriod');
    await expect(page.locator('#fullTransactionsList')).toContainText('Compra Preserva');

    await page.selectOption('#periodSelect', 'THIS_MONTH');
    await expect(page.locator('#customPeriodRow')).toHaveClass(/hidden/);

    await page.selectOption('#periodSelect', 'CUSTOM');
    await expect(page.locator('#customPeriodRow')).toBeVisible();
    await expect(page.locator('#customStart')).toHaveValue(tenAgo);
    await expect(page.locator('#customEnd')).toHaveValue(today);
    await expect(page.locator('#fullTransactionsList')).toContainText('Compra Preserva');
  });

  test('Cada categoria é um card independente e clicável', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Cards', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '15000', description: 'Uber Cards', category: 'Transporte' });
    await createTransaction(page, { type: 'DESPESA', amount: '5000', description: 'Cinema Cards', category: 'Lazer' });

    const cards = page.locator('.linsora-card.category-variation-item');
    await expect(cards).toHaveCount(3);

    await page.click('.linsora-card.category-variation-item:has-text("Transporte")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Transporte');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Transporte');
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Cards');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Cards');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Cinema Cards');
    await expect(page.locator('#periodExpense')).toContainText('R$ 150,00');

    await page.click('#btnActiveCategory');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Cards');
    await expect(page.locator('#fullTransactionsList')).toContainText('Cinema Cards');
    await expect(await page.locator('.linsora-card.category-variation-item').count()).toBe(3);
  });
});
