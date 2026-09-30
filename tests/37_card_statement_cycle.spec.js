const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 37. Etapa 2: extrato do cartão por fatura (ciclo real via closingDay).
// Relógio fixo em 05/09/2026: cartão com fechamento dia 10 abre em
// "Fatura de Setembro/2026" (ciclo 11/08–10/09, contém hoje).

const FIXED_NOW = new Date('2026-09-05T12:00:00-03:00');

test.describe('37. Extrato do cartão por fatura', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.clock.install({ time: FIXED_NOW });
    await page.reload();
    await login(page);
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  async function setupBank(page, balance) {
    await page.evaluate((bal) => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance: bal, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [];
      window.linsoraStore.state.cards = [];
      window.linsoraStore.state.occurrences = [];
      window.linsoraStore.state.recurringBills = [];
      window.selectedCardId = null;
      window.linsoraStore.persistState();
    }, balance);
  }

  async function addCard(page, name, closingDay) {
    await page.evaluate(async ({ name, closingDay }) => {
      await window.linsoraStore.addCard({ name, brand: name, limitTotal: 5000, closingDay, dueDay: 20 });
      await new Promise((r) => setTimeout(r, 5));
    }, { name, closingDay });
  }

  async function purchase(page, cardName, amount, description, date) {
    await page.evaluate(async ({ cardName, amount, description, date }) => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === cardName);
      await window.linsoraStore.addCardPurchase({ amount, description, category: 'Compras', date, card });
    }, { cardName, amount, description, date });
  }

  async function openStatement(page, cardName) {
    await page.evaluate(() => window.switchTab('tabCards'));
    await expect(page.locator('#tabCards')).toBeVisible();
    await page.evaluate((nm) => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === nm);
      window.LinsoraUI.selectCard(card.id);
    }, cardName);
    await page.locator('#btnCardMenuToggle').click();
    await page.locator('#btnViewCardStatement').click();
    await expect(page.locator('#modalCardStatement')).not.toHaveClass(/hidden/);
  }

  async function statementTexts(page) {
    return page.evaluate(() => ({
      label: document.getElementById('cardStatementCycleLabel').textContent,
      period: document.getElementById('cardStatementPeriod').textContent,
      total: document.getElementById('cardStatementTotal').textContent,
      items: Array.from(document.querySelectorAll('#cardStatementList .transaction-card .tx-title')).map((el) => el.textContent),
    }));
  }

  async function seedBoundaryCard(page) {
    await setupBank(page, 5000);
    await addCard(page, 'Fatura10', 10);
    await purchase(page, 'Fatura10', 10, 'Antes', '2026-07-10');
    await purchase(page, 'Fatura10', 100, 'Primeiro', '2026-07-11');
    await purchase(page, 'Fatura10', 50, 'Meio', '2026-08-01');
    await purchase(page, 'Fatura10', 25, 'Ultimo', '2026-08-10');
    await purchase(page, 'Fatura10', 200, 'Depois', '2026-08-11');
    await purchase(page, 'Fatura10', 300, 'Set-1', '2026-09-05');
  }

  test('1/10. Abrir o extrato seleciona o ciclo que contém hoje', async ({ page }) => {
    await seedBoundaryCard(page);
    await openStatement(page, 'Fatura10');
    const s = await statementTexts(page);
    expect(s.label).toBe('Fatura de Setembro/2026');
    expect(s.period).toBe('11/08/2026 a 10/09/2026');
  });

  test('2/3/4/5. Bordas do ciclo: primeiro/último entram, vizinhos não', async ({ page }) => {
    await seedBoundaryCard(page);
    const res = await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Fatura10');
      const inCycle = window.linsoraStore.getCardTransactionsForInvoice(card.id, '2026-07-11', '2026-08-10')
        .map((t) => t.description);
      return inCycle;
    });
    // Primeiro (11/07) e último (10/08) entram; um dia antes (10/07) e um dia
    // depois (11/08) ficam de fora.
    expect(res).toContain('Primeiro');
    expect(res).toContain('Ultimo');
    expect(res).not.toContain('Antes');
    expect(res).not.toContain('Depois');
  });

  test('6/11. Fatura de agosto: só lançamentos do ciclo, do recente ao antigo', async ({ page }) => {
    await seedBoundaryCard(page);
    await openStatement(page, 'Fatura10');
    await page.locator('#btnCardStatementPrev').click();
    const s = await statementTexts(page);
    expect(s.label).toBe('Fatura de Agosto/2026');
    expect(s.period).toBe('11/07/2026 a 10/08/2026');
    expect(s.items).toEqual(['Ultimo', 'Meio', 'Primeiro']);
    expect(s.total).toContain('175,00');
  });

  test('6b. Fatura de setembro soma somente o ciclo (500,00)', async ({ page }) => {
    await seedBoundaryCard(page);
    await openStatement(page, 'Fatura10');
    const s = await statementTexts(page);
    expect(s.items).toEqual(['Set-1', 'Depois']);
    expect(s.total).toContain('500,00');
    expect(s.total).toContain('Total da fatura');
  });

  test('7. Pagamento de fatura não aparece como compra', async ({ page }) => {
    await seedBoundaryCard(page);
    await page.evaluate(async () => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Fatura10');
      await window.linsoraStore.payCardAmount(card.id, 100);
    });
    await openStatement(page, 'Fatura10');
    const s = await statementTexts(page);
    expect(s.items).toEqual(['Set-1', 'Depois']);
    expect(s.total).toContain('500,00');
  });

  test('8. Navegação para fatura anterior funciona', async ({ page }) => {
    await seedBoundaryCard(page);
    await openStatement(page, 'Fatura10');
    await page.locator('#btnCardStatementPrev').click();
    await expect(page.locator('#cardStatementCycleLabel')).toHaveText('Fatura de Agosto/2026');
    await expect(page.locator('#cardStatementPeriod')).toHaveText('11/07/2026 a 10/08/2026');
    await page.locator('#btnCardStatementPrev').click();
    await expect(page.locator('#cardStatementCycleLabel')).toHaveText('Fatura de Julho/2026');
    await expect(page.locator('#cardStatementPeriod')).toHaveText('11/06/2026 a 10/07/2026');
  });

  test('9. Navegação para fatura seguinte funciona (inclusive futura)', async ({ page }) => {
    await seedBoundaryCard(page);
    await openStatement(page, 'Fatura10');
    await page.locator('#btnCardStatementNext').click();
    await expect(page.locator('#cardStatementCycleLabel')).toHaveText('Fatura de Outubro/2026');
    await expect(page.locator('#cardStatementPeriod')).toHaveText('11/09/2026 a 10/10/2026');
    // Fatura futura sem lançamentos: estado vazio + R$ 0,00.
    await expect(page.locator('#cardStatementList')).toContainText('Nenhum lançamento neste cartão');
    await expect(page.locator('#cardStatementTotal')).toContainText('R$ 0,00');
    // E volta para setembro.
    await page.locator('#btnCardStatementPrev').click();
    await expect(page.locator('#cardStatementCycleLabel')).toHaveText('Fatura de Setembro/2026');
  });

  test('11b. Fechamento 31 em fevereiro/2026 (mês curto)', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Fev31', 31);
    await purchase(page, 'Fev31', 80, 'FevFim', '2026-02-28');
    await purchase(page, 'Fev31', 90, 'Marco', '2026-03-01');
    await openStatement(page, 'Fev31');
    for (let i = 0; i < 7; i++) {
      await page.locator('#btnCardStatementPrev').click();
    }
    const s = await statementTexts(page);
    expect(s.label).toBe('Fatura de Fevereiro/2026');
    expect(s.period).toBe('01/02/2026 a 28/02/2026');
    expect(s.items).toEqual(['FevFim']);
    expect(s.total).toContain('80,00');
  });

  test('12. Cartão sem fechamento válido usa fallback 15', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'SemFecha', 10);
    await purchase(page, 'SemFecha', 60, 'Compra S', '2026-09-05');
    await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'SemFecha');
      card.closingDay = null;
      card.closing_day = null;
    });
    await openStatement(page, 'SemFecha');
    const s = await statementTexts(page);
    expect(s.label).toBe('Fatura de Setembro/2026');
    expect(s.period).toBe('16/08/2026 a 15/09/2026');
    expect(s.items).toEqual(['Compra S']);
  });

  test('13. Isolamento entre usuários continua funcionando', async ({ page }) => {
    await seedBoundaryCard(page);
    await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Fatura10');
      window.linsoraStore.state.transactions.unshift({
        id: 'tx_foreign', userId: 'other-user', type: 'DESPESA', description: 'Compra Estranha',
        amount: 999, category: 'Compras', date: '2026-09-05',
        account: 'Cartão Fatura10', cardId: card.id, status: 'CONCLUIDO',
      });
    });
    await openStatement(page, 'Fatura10');
    const s = await statementTexts(page);
    expect(s.items).toEqual(['Set-1', 'Depois']);
    expect(s.total).toContain('500,00');
  });

  test('14. Fatura sem lançamentos mostra estado vazio e R$ 0,00', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Vazio', 10);
    await openStatement(page, 'Vazio');
    await expect(page.locator('#cardStatementCycleLabel')).toHaveText('Fatura de Setembro/2026');
    await expect(page.locator('#cardStatementPeriod')).toHaveText('11/08/2026 a 10/09/2026');
    await expect(page.locator('#cardStatementList')).toContainText('Nenhum lançamento neste cartão');
    await expect(page.locator('#cardStatementTotal')).toContainText('R$ 0,00');
  });
});
