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

  test('CENÁRIO 1: clicar em categoria filtra lista e oculta o resumo; remover restaura', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Cat' });
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Cat', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '15000', description: 'Uber Cat', category: 'Transporte' });

    await expect(page.locator('#periodSummaryBar')).not.toHaveClass(/hidden/);
    await expect(page.locator('#periodExpense')).toContainText('R$ 450,00');

    await page.click('.category-variation-item:has-text("Alimentação")');

    await expect(page.locator('#categoryActiveRow')).toBeVisible();
    await expect(page.locator('#activeCategoryName')).toHaveText('Alimentação');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Alimentação');
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Cat');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Uber Cat');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Salário Cat');
    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis.locator('.extrato-cat-total')).toContainText('R$ 300,00');
    await expect(analysis.locator('.extrato-cat-count')).toContainText('1 movimentação');
    await expect(analysis).not.toContainText('Déficit no período');

    await page.click('#btnActiveCategory');

    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise Financeira');
    await expect(page.locator('#periodSummaryBar')).not.toHaveClass(/hidden/);
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
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
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
    // Resumo Entradas/Saídas/Saldo fica oculto com categoria; análise traz fatos + contexto
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    const analysis3 = page.locator('#extratoAnalysisContainer');
    await expect(analysis3.locator('.extrato-cat-total')).toContainText('R$ 200,00');
    await expect(analysis3.locator('.extrato-cat-count')).toContainText('2 movimentações');
    const tail3 = page.locator('#extratoAnalysisTail');
    await expect(tail3).toContainText('Resultado do período');
    await expect(tail3).toContainText('+R$ 1.740,00');

    await page.click('#btnClearFilters');
    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(3);
    await expect(page.locator('#btnToggleMovements')).toContainText('Ver todas (4)');
    await page.click('#btnToggleMovements');
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
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Cards');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Cards');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Cinema Cards');
    const analysisT = page.locator('#extratoAnalysisContainer');
    await expect(analysisT.locator('.extrato-cat-total')).toContainText('R$ 150,00');
    await expect(analysisT.locator('.extrato-cat-count')).toContainText('1 movimentação');

    await page.click('#btnActiveCategory');
    await expect(page.locator('#periodSummaryBar')).not.toHaveClass(/hidden/);
    await expect(page.locator('#periodExpense')).toContainText('R$ 500,00');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Cards');
    await expect(page.locator('#fullTransactionsList')).toContainText('Cinema Cards');
    await expect(await page.locator('.linsora-card.category-variation-item').count()).toBe(3);
  });

  test('Categoria usa contexto do período: sem déficit fictício, com participação real', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '500000', description: 'Salário Contexto' });
    await createTransaction(page, { type: 'DESPESA', amount: '52000', description: 'Mercado Contexto', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '617000', description: 'Viagem Contexto', category: 'Transporte' });

    await expect(page.locator('#periodIncome')).toContainText('R$ 5.000,00');
    await expect(page.locator('#periodExpense')).toContainText('R$ 6.690,00');
    await expect(page.locator('#periodBalance')).toContainText('-R$ 1.690,00');

    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');

    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    const analysis = page.locator('#extratoAnalysisContainer');
    const tail = page.locator('#extratoAnalysisTail');
    await expect(analysis.locator('.extrato-cat-total')).toContainText('R$ 520,00');
    await expect(analysis.locator('.extrato-cat-count')).toContainText('1 movimentação');
    await expect(analysis).toContainText('Alimentação representa');
    await expect(analysis).toContainText('8%');
    await expect(tail).toContainText('Resultado do período');
    await expect(tail).toContainText('-R$ 1.690,00');

    await page.click('#btnActiveCategory');
    await page.click('.linsora-card.category-variation-item:has-text("Transporte")');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Transporte');
    await expect(page.locator('#periodSummaryBar')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Viagem Contexto');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Contexto');
    await expect(analysis.locator('.extrato-cat-total')).toContainText('R$ 6.170,00');

    await page.click('#btnActiveCategory');
    await expect(page.locator('#periodSummaryBar')).not.toHaveClass(/hidden/);
    await expect(page.locator('#periodBalance')).toContainText('-R$ 1.690,00');
  });

  test('Categoria sem movimento no novo período é removida com aviso', async ({ page }) => {
    const prevDate = await page.evaluate(() => {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      const p = (v) => String(v).padStart(2, '0');
      return `${prev.getFullYear()}-${p(prev.getMonth() + 1)}-${p(prev.getDate())}`;
    });
    await createTransaction(page, { type: 'DESPESA', amount: '7000', description: 'Show Antigo', category: 'Lazer', date: prevDate });
    await createTransaction(page, { type: 'DESPESA', amount: '3000', description: 'Café Atual', category: 'Alimentação' });

    await page.selectOption('#periodSelect', 'ALL');
    await page.click('.linsora-card.category-variation-item:has-text("Lazer")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Lazer');

    await page.selectOption('#periodSelect', 'THIS_MONTH');
    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#toastContainer')).toContainText('Sem movimentações');
  });

  test('Layout do período: desktop amplo, mobile empilhado, sem overflow', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Base Layout', category: 'Outros' });

    await page.setViewportSize({ width: 1280, height: 800 });
    const desktopSelect = await page.locator('#periodSelect').boundingBox();
    expect(desktopSelect.width).toBeGreaterThan(600);
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(desktopOverflow).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.selectOption('#periodSelect', 'CUSTOM');
    await expect(page.locator('#customPeriodRow')).toBeVisible();
    const mobileBoxes = await page.evaluate(() => {
      const rectOf = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { top: r.top, height: r.height };
      };
      return { start: rectOf('customStart'), end: rectOf('customEnd'), btn: rectOf('btnApplyCustomPeriod') };
    });
    expect(mobileBoxes.start.height).toBeGreaterThanOrEqual(40);
    expect(mobileBoxes.end.top).toBeGreaterThanOrEqual(mobileBoxes.start.top + mobileBoxes.start.height);
    expect(mobileBoxes.btn.top).toBeGreaterThanOrEqual(mobileBoxes.end.top + mobileBoxes.end.height);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(mobileOverflow).toBe(true);
  });

  test('Categoria selecionada: análise, movimentações, distribuição e resultado', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Mercado Ordem', category: 'Alimentação' });
    await expect(page.locator('#extratoMovementsTitle')).toHaveText('Movimentações');

    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Alimentação');
    await expect(page.locator('#extratoMovementsTitle')).toHaveText('Movimentações de Alimentação');
    const order = await page.evaluate(() => {
      const pos = (id) => {
        const els = Array.from(document.querySelectorAll('#tabTransactions .section-block'));
        return els.findIndex((el) => el.contains(document.getElementById(id)));
      };
      return {
        analysis: pos('extratoAnalysisContainer'),
        movs: pos('fullTransactionsList'),
        tail: pos('extratoAnalysisTail'),
      };
    });
    expect(order.analysis).toBeGreaterThanOrEqual(0);
    expect(order.movs).toBeGreaterThan(order.analysis);
    expect(order.tail).toBeGreaterThan(order.movs);
    await expect(page.locator('#extratoAnalysisTail')).toContainText('Distribuição dos gastos');
    await expect(page.locator('#extratoAnalysisTail')).toContainText('Resultado do período');

    await page.click('#btnActiveCategory');
    await expect(page.locator('#extratoMovementsTitle')).toHaveText('Movimentações');
    const orderBack = await page.evaluate(() => {
      const analysis = document.getElementById('extratoAnalysisSection');
      const movs = document.getElementById('extratoMovementsSection');
      return movs.compareDocumentPosition(analysis);
    });
    expect(orderBack & 4).toBeTruthy();
  });

  test('Resultado do período: saídas negativas, saldo correto e neutro no zero', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '500000', description: 'Salário Sinal' });
    await createTransaction(page, { type: 'DESPESA', amount: '200000', description: 'Aluguel Sinal', category: 'Moradia' });

    await expect(page.locator('#periodIncome')).toContainText('R$ 5.000,00');
    await expect(page.locator('#periodExpense')).toContainText('-R$ 2.000,00');
    await expect(page.locator('#periodExpense')).toHaveClass(/negative/);
    await expect(page.locator('#periodBalance')).toContainText('R$ 3.000,00');
    await expect(page.locator('#periodBalance')).toHaveClass(/positive/);
    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis).toContainText('Equilibrado');
    await expect(analysis).toContainText('Entradas x Saídas');

    await createTransaction(page, { type: 'DESPESA', amount: '300000', description: 'Viagem Zero', category: 'Lazer' });
    await expect(page.locator('#periodBalance')).toContainText('R$ 0,00');
    await expect(page.locator('#periodBalance')).not.toHaveClass(/positive/);
    await expect(page.locator('#periodBalance')).not.toHaveClass(/negative/);
  });

  test('Filtro Despesas: somente saídas, resumo próprio, sem diagnóstico geral', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Tipo' });
    await createTransaction(page, { type: 'DESPESA', amount: '40000', description: 'Mercado Tipo', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Uber Tipo', category: 'Transporte' });

    await page.click('.chip-filter[data-value="DESPESA"]');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Tipo');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Salário Tipo');
    await expect(page.locator('#typeSummaryValue')).toContainText('-R$ 500,00');
    await expect(page.locator('#typeSummaryCount')).toContainText('2 movimentações');
    await expect(page.locator('#periodSummaryBar')).not.toContainText('Entradas');
    await expect(page.locator('#periodIncome')).toHaveCount(0);
    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis).not.toContainText('Déficit no período');
    await expect(analysis).not.toContainText('Entradas x Saídas');
    await expect(analysis).not.toContainText('Suas entradas cobrem');
    await expect(analysis).toContainText('Distribuição dos gastos');

    await page.click('.chip-filter[data-value="all"]');
    await expect(page.locator('#periodIncome')).toContainText('R$ 1.000,00');
    await expect(page.locator('#periodExpense')).toContainText('-R$ 500,00');
    await expect(analysis).toContainText('Equilibrado');
  });

  test('Filtro Receitas: somente entradas, resumo próprio, sem análise incompleta', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Rec' });
    await createTransaction(page, { type: 'DESPESA', amount: '40000', description: 'Mercado Rec', category: 'Alimentação' });

    await page.click('.chip-filter[data-value="RECEITA"]');
    await expect(page.locator('#fullTransactionsList')).toContainText('Salário Rec');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Rec');
    await expect(page.locator('#typeSummaryValue')).toContainText('R$ 1.000,00');
    await expect(page.locator('#typeSummaryCount')).toContainText('1 movimentação');
    await expect(page.locator('#periodSummaryBar')).not.toContainText('Saídas');
    await expect(page.locator('#periodExpense')).toHaveCount(0);
    await expect(page.locator('#extratoAnalysisSection')).toHaveClass(/hidden/);

    await page.click('.chip-filter[data-value="all"]');
    await expect(page.locator('#periodIncome')).toContainText('R$ 1.000,00');
  });

  test('Despesas + Alimentação e Receitas + categoria incompatível', async ({ page }) => {
    await createTransaction(page, { type: 'RECEITA', amount: '100000', description: 'Salário Comb2' });
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Comb2', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '15000', description: 'Uber Comb2', category: 'Transporte' });

    await page.click('.chip-filter[data-value="DESPESA"]');
    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Comb2');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Uber Comb2');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Salário Comb2');
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise de Alimentação');

    await page.click('#btnActiveCategory');
    await page.click('.chip-filter[data-value="RECEITA"]');
    await page.click('.chip-filter[data-value="all"]');
    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');
    await page.click('.chip-filter[data-value="RECEITA"]');
    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#toastContainer')).toContainText('Sem movimentações');
    await expect(page.locator('#fullTransactionsList')).toContainText('Salário Comb2');
  });

  test('Comparação da categoria com o mês anterior (menos, mais, igual, sem base)', async ({ page }) => {
    const prevDate = await page.evaluate(() => {
      const now = new Date();
      const len = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      const d = Math.min(now.getDate(), len);
      const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const p = (v) => String(v).padStart(2, '0');
      return `${y}-${p(m + 1)}-${p(d)}`;
    });
    await createTransaction(page, { type: 'DESPESA', amount: '65000', description: 'Mercado Anterior', category: 'Alimentação', date: prevDate });
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Mercado Atual A', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '22000', description: 'Mercado Atual B', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '30000', description: 'Gasolina Anterior', category: 'Transporte', date: prevDate });
    await createTransaction(page, { type: 'DESPESA', amount: '36000', description: 'Gasolina Atual', category: 'Transporte' });
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Cinema Anterior', category: 'Lazer', date: prevDate });
    await createTransaction(page, { type: 'DESPESA', amount: '10000', description: 'Cinema Atual', category: 'Lazer' });
    await createTransaction(page, { type: 'DESPESA', amount: '5000', description: 'Curso Atual', category: 'Educação' });

    await page.selectOption('#periodSelect', 'THIS_MONTH');
    const analysis = page.locator('#extratoAnalysisContainer');

    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');
    await expect(analysis).toContainText('Comparação com o mês anterior');
    await expect(analysis).toContainText('Você gastou 20% menos com Alimentação neste mês.');
    await expect(analysis).toContainText('R$ 130,00 a menos');
    await expect(analysis).toContainText('Mês anterior');
    await expect(analysis).toContainText('R$ 650,00');
    await expect(analysis).toContainText('Este mês');
    await expect(analysis).toContainText('R$ 520,00');
    await expect(analysis.locator('.extrato-cat-total')).toContainText('R$ 520,00');
    await expect(analysis.locator('.extrato-cat-count')).toContainText('2 movimentações');

    await page.click('#btnActiveCategory');
    await page.click('.linsora-card.category-variation-item:has-text("Transporte")');
    await expect(analysis).toContainText('Você gastou 20% a mais com Transporte neste mês.');
    await expect(analysis).toContainText('R$ 60,00 a mais');
    await expect(analysis).toContainText('Mês anterior');
    await expect(analysis).toContainText('R$ 300,00');
    await expect(analysis).toContainText('Este mês');
    await expect(analysis).toContainText('R$ 360,00');

    await page.click('#btnActiveCategory');
    await page.click('.linsora-card.category-variation-item:has-text("Lazer")');
    await expect(analysis).toContainText('Você gastou o mesmo valor com Lazer neste mês.');

    await page.click('#btnActiveCategory');
    await page.click('.linsora-card.category-variation-item:has-text("Educação")');
    await expect(analysis).toContainText('Não houve gastos com Educação no período anterior.');
    await expect(analysis).toContainText('Este mês');
    await expect(analysis).toContainText('R$ 50,00');
    const analysisText = await analysis.innerText();
    expect(analysisText).not.toMatch(/Infinity|NaN/);
  });

  test('Participação usa as saídas totais do período como denominador', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '52000', description: 'Mercado Share', category: 'Alimentação' });
    await createTransaction(page, { type: 'DESPESA', amount: '48000', description: 'Uber Share', category: 'Transporte' });

    await page.click('.linsora-card.category-variation-item:has-text("Alimentação")');
    const analysis = page.locator('#extratoAnalysisContainer');
    await expect(analysis).toContainText('52%');
    await expect(analysis).toContainText('das suas despesas neste período');
  });

  test('Visão resumida mostra no máximo 3 movimentações com Ver todas', async ({ page }) => {
    await createTransaction(page, { type: 'DESPESA', amount: '1000', description: 'Item Um Resumo', category: 'Outros' });
    await createTransaction(page, { type: 'DESPESA', amount: '2000', description: 'Item Dois Resumo', category: 'Outros' });
    await createTransaction(page, { type: 'DESPESA', amount: '3000', description: 'Item Três Resumo', category: 'Outros' });
    await createTransaction(page, { type: 'DESPESA', amount: '4000', description: 'Item Quatro Resumo', category: 'Outros' });
    await createTransaction(page, { type: 'DESPESA', amount: '5000', description: 'Item Cinco Resumo', category: 'Outros' });

    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(3);
    await expect(page.locator('#btnToggleMovements')).toBeVisible();
    await expect(page.locator('#btnToggleMovements')).toContainText('Ver todas (5)');

    await page.click('#btnToggleMovements');
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(5);
    await expect(page.locator('#btnToggleMovements')).toContainText('Ver menos');

    await page.click('#btnToggleMovements');
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(3);

    await page.click('.linsora-card.category-variation-item:has-text("Outros")');
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(3);
    await expect(page.locator('#btnToggleMovements')).toContainText('Ver todas (5)');
    await page.click('#btnToggleMovements');
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(5);
    await page.click('#btnToggleMovements');
    await page.click('#btnActiveCategory');
    await expect(page.locator('#fullTransactionsList .transaction-card')).toHaveCount(3);
  });
});
