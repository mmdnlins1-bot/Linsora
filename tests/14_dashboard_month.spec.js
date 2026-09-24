const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('14. Dashboard mensal (mês calendário atual)', () => {

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
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  async function createTransaction(page, { type = 'DESPESA', amount, description, category, date }) {
    await page.click('#btnFabNewTransaction');
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

  async function monthKeys(page) {
    return page.evaluate(() => {
      const now = new Date();
      const p = (v) => String(v).padStart(2, '0');
      const cur = `${now.getFullYear()}-${p(now.getMonth() + 1)}`;
      const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const prev = `${prevDate.getFullYear()}-${p(prevDate.getMonth() + 1)}-15`;
      return { cur, prev };
    });
  }

  test('A/B: mês atual entra, mês anterior não entra no hero', async ({ page }) => {
    const { prev } = await monthKeys(page);
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Mês' });
    await createTransaction(page, { type: 'DESPESA', amount: '40000', description: 'Mercado Mês', category: 'Alimentação' });
    await createTransaction(page, { type: 'RECEITA', amount: '900000', description: 'Bônus Antigo', date: prev });
    await createTransaction(page, { type: 'DESPESA', amount: '500000', description: 'Viagem Antiga', category: 'Lazer', date: prev });

    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 1.000,00');
    await expect(page.locator('#monthExpenseAmount')).toContainText('R$ 400,00');
    await expect(page.locator('#monthBalanceAmount')).toContainText('R$ 600,00');
  });

  test('C: transação futura não entra no mês atual', async ({ page }) => {
    const future = await page.evaluate(() => {
      const d = new Date();
      const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 10);
      const p = (v) => String(v).padStart(2, '0');
      return `${r.getFullYear()}-${p(r.getMonth() + 1)}-${p(r.getDate())}`;
    });
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Hoje' });
    await createTransaction(page, { type: 'DESPESA', amount: '700000', description: 'Conta Futura', category: 'Moradia', date: future });

    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 1.000,00');
    await expect(page.locator('#monthExpenseAmount')).toContainText('R$ 0,00');
  });

  test('D: ano diferente com mesmo mês não entra (virada de ano)', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '25000', description: 'Compra 2020', category: 'Outros', date: '2020-06-15' });
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Hoje D' });

    const body = await page.locator('#tabDashboard').innerText();
    expect(body).not.toMatch(/NaN|Infinity/);
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 1.000,00');
    await expect(page.locator('#monthExpenseAmount')).toContainText('R$ 0,00');
  });

  test('E: mês sem movimentações resulta em zeros, sem NaN/Infinity', async ({ page }) => {
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 0,00');
    await expect(page.locator('#monthExpenseAmount')).toContainText('R$ 0,00');
    await expect(page.locator('#monthBalanceAmount')).toContainText('R$ 0,00');
    const body = await page.locator('#tabDashboard').innerText();
    expect(body).not.toMatch(/NaN|Infinity/);
  });

  test('F: hero mensal, patrimônio atual e sem Variação no Mês', async ({ page }) => {
    const { prev } = await monthKeys(page);
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Hero' });
    await createTransaction(page, { type: 'RECEITA', amount: '900000', description: 'Bônus Antigo Hero', date: prev });

    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 1.000,00');
    await expect(page.locator('#totalNetWorthMain')).toContainText('R$ 0,00');
    await expect(page.locator('#netWorthVariationBadge')).toHaveCount(0);
  });

  test('G: resumo usa economizado e comprometimento mensais', async ({ page }) => {
    const { prev } = await monthKeys(page);
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Resumo' });
    await createTransaction(page, { type: 'DESPESA', amount: '40000', description: 'Mercado Resumo', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '500000', description: 'Obra Antiga', category: 'Moradia', date: prev });

    const resumo = page.locator('#resumoWidgetsContainer');
    await expect(resumo).toContainText('40%');
    await expect(resumo).toContainText('R$ 600,00');
  });

  test('H: donut mostra somente despesas do mês', async ({ page }) => {
    const { prev } = await monthKeys(page);
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Mercado Donut', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '90000', description: 'Hotel Antigo', category: 'Lazer', date: prev });

    const legend = page.locator('#categoryLegendGrid');
    await expect(legend).toContainText('Alimentação');
    await expect(legend).not.toContainText('Lazer');
  });

  test('I: insights usam dados mensais, sem markdown literal', async ({ page }) => {
    const { prev } = await monthKeys(page);
    await createTransaction(page, { type: 'DESPESA', amount: '900000', description: 'Obra Antiga Insight', category: 'Moradia', date: prev });
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Insight' });
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Mercado Insight', category: 'Alimentação' });

    const body = page.locator('#smartInsightBody');
    await expect(body).toContainText('Boa Margem Financeira');
    await expect(body).not.toContainText('Alerta de Orçamento');
    const html = await body.innerHTML();
    expect(html).not.toContain('**');
  });

  test('J: empty-state sem Ações Rápidas e com texto final', async ({ page }) => {
    const empty = page.locator('#recentTransactionsList');
    await expect(empty).toContainText('Você ainda não tem movimentações neste período.');
    await expect(empty).toContainText('Toque no botão + para registrar uma receita ou despesa.');
    await expect(empty).not.toContainText('Ações Rápidas');
  });

  test('K: cards de movimentação acessíveis por teclado', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '5000', description: 'Café Teclado', category: 'Alimentação' });

    const card = page.locator('#recentTransactionsList .transaction-card').first();
    await expect(card).toHaveAttribute('role', 'button');
    await expect(card).toHaveAttribute('tabindex', '0');
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#modalTransactionDetails')).toBeVisible();
    await page.evaluate(() => document.getElementById('modalTransactionDetails')?.classList.add('hidden'));

    await card.focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#modalTransactionDetails')).toBeVisible();
  });
});
