const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('13. Extrato com Análise Financeira', () => {

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

  test('Cenário 1: sem movimentações exibe estado vazio e oculta análise', async ({ page }) => {
    await expect(page.locator('#extratoEmptyBlock')).toBeVisible();
    await expect(page.locator('#extratoEmptyBlock')).toContainText('Não há movimentações neste período.');
    await expect(page.locator('#extratoEmptyBlock')).toContainText('Adicione uma movimentação para começar a acompanhar sua vida financeira.');
    await expect(page.locator('#extratoAnalysisSection')).toHaveClass(/hidden/);
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisContainer')).toBeEmpty();
  });

  test('Cenário 2: entradas e saídas geram resumo, análise e comparação', async ({ page }) => {
    const prevDate = await page.evaluate(() => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      return prev.toISOString().split('T')[0];
    });

    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Análise' });
    await createTransaction(page, { type: 'DESPESA', amount: '40000', description: 'Mercado Análise', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '20000', description: 'Gasolina Mês Anterior', category: 'Transporte', date: prevDate });

    // Resumo do período (Todo Período por padrão)
    await expect(page.locator('#periodIncome')).toContainText('R$ 1.000,00');
    await expect(page.locator('#periodExpense')).toContainText('R$ 600,00');
    await expect(page.locator('#periodBalance')).toContainText('R$ 400,00');
    await expect(page.locator('#extratoEmptyBlock')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisSection')).not.toHaveClass(/hidden/);

    // Filtro mensal: esconde o lançamento do mês anterior e mostra comparação
    await page.click('.chip-filter[data-value="THIS_MONTH"]');
    await expect(page.locator('.chip-filter[data-value="THIS_MONTH"]')).toHaveClass(/active/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Análise');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Gasolina Mês Anterior');
    await expect(page.locator('#periodExpense')).toContainText('R$ 400,00');

    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis).toContainText('Equilibrado');
    await expect(analysis).toContainText('Entradas x Saídas');
    await expect(analysis).toContainText('Comparado ao mês anterior');
    await expect(analysis).toContainText('R$ 200,00');

    // Voltar para Todo Período: comparação some, lançamento anterior reaparece
    await page.click('.chip-filter[data-value="ALL"]');
    await expect(page.locator('#fullTransactionsList')).toContainText('Gasolina Mês Anterior');
    await expect(analysis).not.toContainText('Comparado ao mês anterior');
  });

  test('Cenário 3: distribuição mostra somente categorias com movimento', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Distribuição', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '15000', description: 'Uber Distribuição', category: 'Transporte' });

    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis).toContainText('Distribuição dos gastos');
    await expect(analysis).toContainText('Alimentação');
    await expect(analysis).toContainText('Transporte');
    await expect(analysis).toContainText('Concentração de gastos');
    await expect(await analysis.locator('.category-variation-item').count()).toBe(2);
  });
});
